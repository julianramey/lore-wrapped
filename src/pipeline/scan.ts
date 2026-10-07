import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { ADAPTER_VERSION, CACHE_DIR, privateDir } from '../config.ts'
import { discoverClaude, discoverClaudeDesktop, parseClaudeFile, type DiscoveredFile } from '../sources/claude.ts'
import { discoverOpenClaw, discoverPi, parseOpenClawFile, parsePiFile } from '../sources/pi.ts'
import { discoverOpenCode, parseOpenCodeFile } from '../sources/opencode.ts'
import { discoverQwen, parseQwenFile } from '../sources/qwen.ts'
import { discoverCopilot, parseCopilotFile } from '../sources/copilot.ts'
import { promptKey, recoverClaudeHistory } from '../sources/claudeHistory.ts'
import { readClaudeFirstUse, readClaudePlan, readClaudeStats, type ClaudeStats } from '../sources/claudeStats.ts'
import { codexTitles, discoverCodex, parseCodexFile } from '../sources/codex.ts'
import { discoverGemini, nameGeminiProjects, parseGeminiFile, recoverGeminiLogs } from '../sources/gemini.ts'
import { perSource, SOURCE_KEYS, SOURCES } from '../sources/registry.ts'
import { discoverRoots, type Root, type Roots } from '../sources/roots.ts'
import { mergeUsage } from '../sources/common.ts'
import type { FileOutcome, SourceCoverage, SourceName, ThreadRecord, UsageLedger, UsageRow } from '../types.ts'
import { dayKey } from '../util/text.ts'
import { sha1 } from '../util/hash.ts'

export interface ScanResult {
  threads: ThreadRecord[]
  coverage: SourceCoverage[]
  scannedAt: number
  scanMs: number
  filesParsed: number
  filesFromCache: number
  bytesParsed: number
  claudeStats: ClaudeStats | null
  /** The Claude plan this machine is signed in with, e.g. "claude-max-20x". */
  claudePlan: string | null
  /** When Claude Code was first launched here, from its own config; can predate any prompt on disk. */
  claudeFirstUse: number | null
  usage: UsageLedger
}

export interface ScanProgress {
  phase: 'discover' | 'parse' | 'done'
  done: number
  total: number
  bytesDone: number
  bytesTotal: number
}

interface Job {
  source: SourceName
  df: DiscoveredFile
}

/** Where each agent keeps history, how to list its files, and how to read one. */
const ADAPTERS: Record<SourceName, { roots: (r: Roots) => Root[]; discover: (roots: Root[]) => DiscoveredFile[]; parse: (df: DiscoveredFile) => Promise<FileOutcome>; home: string }> = {
  'claude-code': { roots: (r) => r.claude, discover: discoverClaude, parse: parseClaudeFile, home: '.claude' },
  codex: { roots: (r) => r.codex, discover: discoverCodex, parse: parseCodexFile, home: '.codex' },
  gemini: { roots: (r) => r.gemini, discover: discoverGemini, parse: parseGeminiFile, home: '.gemini' },
  pi: { roots: (r) => r.pi, discover: discoverPi, parse: parsePiFile, home: path.join('.pi', 'agent', 'sessions') },
  openclaw: { roots: (r) => r.openclaw, discover: discoverOpenClaw, parse: parseOpenClawFile, home: '.openclaw' },
  opencode: { roots: (r) => r.opencode, discover: (rs) => discoverOpenCode(rs, 'opencode'), parse: (df) => parseOpenCodeFile(df, 'opencode'), home: path.join('.local', 'share', 'opencode') },
  kilo: { roots: (r) => r.kilo, discover: (rs) => discoverOpenCode(rs, 'kilo'), parse: (df) => parseOpenCodeFile(df, 'kilo'), home: path.join('.local', 'share', 'kilo') },
  qwen: { roots: (r) => r.qwen, discover: discoverQwen, parse: parseQwenFile, home: '.qwen' },
  copilot: { roots: (r) => r.copilot, discover: discoverCopilot, parse: parseCopilotFile, home: '.copilot' },
}

export function parseJob(job: Job): Promise<FileOutcome> {
  return ADAPTERS[job.source].parse(job.df)
}

function cachePath(file: string) {
  return path.join(CACHE_DIR, sha1(file) + '.json')
}

function readCache(df: DiscoveredFile): FileOutcome | null {
  try {
    const c = JSON.parse(fs.readFileSync(cachePath(df.file), 'utf8'))
    if (c.v === ADAPTER_VERSION && c.size === df.size && c.mtimeMs === df.mtimeMs) return c.outcome
  } catch {
    /* miss */
  }
  return null
}

function writeCache(df: DiscoveredFile, outcome: FileOutcome) {
  try {
    fs.writeFileSync(cachePath(df.file), JSON.stringify({ v: ADAPTER_VERSION, size: df.size, mtimeMs: df.mtimeMs, outcome }), { mode: 0o600 })
  } catch {
    /* cache is an optimization */
  }
}

/** Parses files on a small worker pool; the main thread stays free for progress output. */
async function runPool(jobs: Job[], workerUrl: URL | null, onDone: (job: Job, o: FileOutcome) => void) {
  if (!jobs.length) return
  // Windows: antivirus scans every read, so more workers mostly contend
  const n = workerUrl ? Math.max(1, Math.min(os.availableParallelism?.() ?? os.cpus().length, process.platform === 'win32' ? 4 : 8, jobs.length)) : 0
  if (n === 0) {
    for (const j of jobs) onDone(j, await parseJob(j).catch((e) => ({ kind: 'error', message: String(e?.message || e) }) as FileOutcome))
    return
  }
  // Largest first so one giant file doesn't finish last on its own.
  const queue = [...jobs].sort((a, b) => b.df.size - a.df.size)
  await new Promise<void>((resolve, reject) => {
    let active = 0
    const workers: Worker[] = []
    const next = (w: Worker) => {
      const job = queue.shift()
      if (!job) {
        w.terminate()
        if (--active === 0) resolve()
        return
      }
      ;(w as any).job = job
      w.postMessage(job)
    }
    for (let i = 0; i < n; i++) {
      const w = new Worker(workerUrl!, { workerData: { loreWorker: true } })
      workers.push(w)
      active++
      w.on('message', (o: FileOutcome) => {
        onDone((w as any).job, o)
        next(w)
      })
      w.on('error', reject)
      next(w)
    }
  })
}

export async function scan(opts: { workerUrl?: URL | null; onProgress?: (p: ScanProgress) => void; roots?: Roots } = {}): Promise<ScanResult> {
  const t0 = Date.now()
  privateDir(CACHE_DIR)
  opts.onProgress?.({ phase: 'discover', done: 0, total: 0, bytesDone: 0, bytesTotal: 0 })

  const roots = opts.roots ?? discoverRoots()
  const desktop = discoverClaudeDesktop(roots.claudeDesktop)
  const titles = codexTitles(roots.codex)
  const where = (rs: Root[], fallback: string) => (rs.length ? rs.map((r) => (r.where ? `${r.dir} (${r.where})` : r.dir)).join(', ') : fallback)

  const cov = Object.fromEntries(
    SOURCES.map((s) => {
      const rs = ADAPTERS[s.key].roots(roots)
      return [s.key, emptyCoverage(s.key, s.label, where(rs, path.join(os.homedir(), ADAPTERS[s.key].home)), rs.length > 0)]
    }),
  ) as Record<SourceName, SourceCoverage>
  const all: Job[] = SOURCE_KEYS.flatMap((source) => ADAPTERS[source].discover(ADAPTERS[source].roots(roots)).map((df) => ({ source, df })))
  for (const j of all) {
    cov[j.source].files++
    cov[j.source].bytes += j.df.size
    if (j.df.archived) cov[j.source].archivedFiles++
  }

  const outcomes = new Map<string, { job: Job; o: FileOutcome }>()
  const toParse: Job[] = []
  let fromCache = 0
  for (const j of all) {
    const c = readCache(j.df)
    if (c) {
      outcomes.set(j.df.file, { job: j, o: c })
      fromCache++
    } else toParse.push(j)
  }

  const bytesTotal = toParse.reduce((s, j) => s + j.df.size, 0)
  let done = 0
  let bytesDone = 0
  const report = () => opts.onProgress?.({ phase: 'parse', done, total: toParse.length, bytesDone, bytesTotal })
  report()
  await runPool(toParse, opts.workerUrl ?? null, (job, o) => {
    outcomes.set(job.df.file, { job, o })
    if (o.kind !== 'error') writeCache(job.df, o)
    done++
    bytesDone += job.df.size
    report()
  })

  // Collect, then deduplicate copied history: forks and resumes repeat earlier records
  // with the same ids. Shared history counts once; new branches stay distinct.
  const threads: ThreadRecord[] = []
  const replies = new Map<string, { source: SourceName; row: UsageRow; sub: boolean }>()
  const claudeRaw: UsageLedger['claudeRaw'] = {}
  // a usage record keyed only by its totals is a copy only inside the same family of sessions:
  // two unrelated sessions can reach the same totals
  const parentOf = new Map<string, string | undefined>()
  for (const { o } of outcomes.values()) if (o.kind !== 'error' && o.usage?.lineage) parentOf.set(o.usage.lineage.id, o.usage.lineage.parent)
  const rootOf = (id: string) => {
    let cur = id
    for (let i = 0; i < 32 && parentOf.get(cur); i++) cur = parentOf.get(cur)!
    return cur
  }
  for (const { job, o } of outcomes.values()) {
    if (o.kind !== 'error' && o.usage) {
      const subRows = new Set(o.usage.subRows)
      const root = o.usage.lineage ? rootOf(o.usage.lineage.id) : null
      for (const row of [...o.usage.rows, ...subRows]) {
        const sub = o.kind === 'subagent' || subRows.has(row)
        const key = root && row[0].startsWith('x|') ? `x|${root}|${row[0].slice(2)}` : row[0]
        const prev = replies.get(key)
        replies.set(key, prev ? { source: prev.source, row: mergeUsage(prev.row, row), sub: prev.sub && sub } : { source: job.source, row, sub })
      }
      for (const [day, byModel] of Object.entries(o.usage.raw || {})) {
        const d = (claudeRaw[day] ||= {})
        for (const [m, v] of Object.entries(byModel)) d[m] = (d[m] || 0) + v
      }
    }
    const c = cov[job.source]
    if (o.kind === 'subagent') c.subagentFiles++
    else if (o.kind === 'empty') c.emptyFiles++
    else if (o.kind === 'error') c.warnings.push(`${path.basename(job.df.file)}: ${o.message}`)
    else if (o.kind === 'threads') threads.push(...o.threads)
    else threads.push(o.thread)
  }
  threads.sort((a, b) => a.startedAt - b.startedAt)

  const seenThread = new Set<string>()
  const seenHuman = new Set<string>()
  const kept: ThreadRecord[] = []
  for (const th of threads) {
    const c = cov[th.source]
    const key = `${th.source}:${th.id}`
    if (seenThread.has(key)) {
      c.duplicateThreads++
      continue
    }
    seenThread.add(key)
    const events = []
    let dropping = false
    for (const e of th.events) {
      if (e.k === 'h') {
        dropping = seenHuman.has(e.id)
        seenHuman.add(e.id)
      }
      if (!dropping) events.push(e)
    }
    if (!events.some((e) => e.k === 'h')) {
      c.duplicateThreads++
      continue
    }
    th.events = events
    if (th.source === 'codex' && !th.title) th.title = titles.get(th.id)
    if (th.source === 'claude-code' && desktop.has(th.id) && th.surface !== 'automated') {
      th.surface = 'desktop'
      th.title = th.title || desktop.get(th.id)?.title
    }
    if (th.surface === 'automated') {
      c.automatedThreads++
      continue
    }
    if (th.surface === 'desktop') c.desktopThreads++
    c.mainThreads++
    c.firstAt = Math.min(c.firstAt ?? Infinity, th.startedAt)
    c.lastAt = Math.max(c.lastAt ?? 0, th.endedAt)
    for (const w of th.warnings) c.warnings.push(`${th.project}: ${w}`)
    kept.push(th)
  }

  // Sessions Claude Code already deleted come back as prompts-only threads.
  const known = new Set<string>()
  const seenText = new Set<string>()
  for (const th of threads) if (th.source === 'claude-code') known.add(th.id)
  for (const th of kept) for (const e of th.events) if (e.k === 'h') seenText.add(promptKey(e.text, e.t))
  const rec = { threads: [] as ThreadRecord[], prompts: 0 }
  for (const r of roots.claude) {
    const one = await recoverClaudeHistory(known, seenText, path.join(r.dir, 'history.jsonl'))
    rec.threads.push(...one.threads)
    rec.prompts += one.prompts
  }
  if (rec.threads.length) {
    const c = cov['claude-code']
    c.recoveredThreads = rec.threads.length
    c.recoveredPrompts = rec.prompts
    for (const th of rec.threads) {
      c.firstAt = Math.min(c.firstAt ?? Infinity, th.startedAt)
      c.lastAt = Math.max(c.lastAt ?? 0, th.endedAt)
      kept.push(th)
    }
    kept.sort((a, b) => a.startedAt - b.startedAt)
  }

  // Gemini deletes chats after 30 days too; its per-project prompt log keeps the rest.
  const geminiKnown = new Set(threads.filter((th) => th.source === 'gemini').map((th) => th.id))
  const geminiRec = recoverGeminiLogs(roots.gemini, geminiKnown, seenText, promptKey)
  if (geminiRec.length) {
    const c = cov.gemini
    c.recoveredThreads = geminiRec.length
    c.recoveredPrompts = geminiRec.reduce((a, th) => a + th.events.length, 0)
    for (const th of geminiRec) {
      c.firstAt = Math.min(c.firstAt ?? Infinity, th.startedAt)
      c.lastAt = Math.max(c.lastAt ?? 0, th.endedAt)
      kept.push(th)
    }
    kept.sort((a, b) => a.startedAt - b.startedAt)
  }
  // a Gemini chat knows only sha256 of its folder; another agent may have been there too
  nameGeminiProjects(kept)

  const joined = [...desktop.keys()].filter((id) => kept.some((t) => t.source === 'claude-code' && t.id === id)).length
  if (desktop.size > joined) {
    cov['claude-code'].warnings.push(
      `${desktop.size - joined} Claude desktop session${desktop.size - joined === 1 ? ' has' : 's have'} no matching main transcript on disk (empty, automated, or not retained).`,
    )
  }
  for (const c of Object.values(cov)) {
    if (!c.found) c.warnings.unshift(`${c.label} history not found at ${c.root}`)
  }

  opts.onProgress?.({ phase: 'done', done, total: toParse.length, bytesDone, bytesTotal })
  return {
    threads: kept,
    coverage: Object.values(cov),
    scannedAt: Date.now(),
    scanMs: Date.now() - t0,
    filesParsed: toParse.length,
    filesFromCache: fromCache,
    bytesParsed: bytesTotal,
    claudeStats: readClaudeStats(roots.claude.map((r) => r.dir)),
    claudePlan: readClaudePlan(roots.claude.map((r) => r.dir)),
    claudeFirstUse: readClaudeFirstUse(roots.claude.map((r) => r.dir)),
    usage: ledgerOf(
      replies,
      claudeRaw,
      all.filter((j) => j.source === 'claude-code').map((j) => j.df),
    ),
  }
}

function ledgerOf(replies: Map<string, { source: SourceName; row: UsageRow; sub?: boolean }>, claudeRaw: UsageLedger['claudeRaw'], claudeFiles: DiscoveredFile[]): UsageLedger {
  const sums = new Map<string, UsageLedger['rows'][number]>()
  const subagentTokens = perSource(() => 0)
  for (const { source, row, sub } of replies.values()) {
    const [, model, t, inp, cached, out, write, write1h = 0] = row
    if (sub) subagentTokens[source] += inp + cached + out
    const day = t ? dayKey(t) : ''
    const k = `${source}|${model}|${day}`
    const cur = sums.get(k) || { source, model, day, in: 0, cached: 0, out: 0, write: 0, write1h: 0, calls: 0 }
    cur.in += inp
    cur.cached += cached
    cur.out += out
    cur.write += write
    cur.write1h += write1h
    cur.calls++
    sums.set(k, cur)
  }
  return {
    rows: [...sums.values()].sort((a, b) => a.day.localeCompare(b.day)),
    claudeRaw,
    claudeOnDiskFrom: claudeFiles.length ? claudeFiles.reduce((a, f) => Math.min(a, f.mtimeMs), Infinity) : null,
    subagentTokens,
  }
}

/** A ledger from threads' own token counts, for synthetic histories that have no files. */
export function ledgerFromThreads(threads: ThreadRecord[]): UsageLedger {
  const replies = new Map<string, { source: SourceName; row: UsageRow }>()
  for (const th of threads) for (const e of th.events) if (e.k === 'a' && e.tok) replies.set(`${th.id}|${e.id}`, { source: th.source, row: [e.id, e.model || 'unknown', e.t, e.tok[0], e.tok[1], e.tok[2], e.tok[3] || 0, e.tok[4] || 0] })
  return ledgerOf(replies, {}, [])
}

function emptyCoverage(source: SourceName, label: string, root: string, found: boolean): SourceCoverage {
  return {
    source,
    label,
    root,
    found,
    files: 0,
    bytes: 0,
    archivedFiles: 0,
    subagentFiles: 0,
    automatedThreads: 0,
    emptyFiles: 0,
    duplicateThreads: 0,
    mainThreads: 0,
    desktopThreads: 0,
    firstAt: null,
    lastAt: null,
    warnings: [],
  }
}
