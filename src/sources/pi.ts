// Pi (the coding agent) and OpenClaw (the personal agent built on it) share one transcript
// format: a session header, then entries linked by id/parentId, with assistant messages
// carrying exact per-call usage. Pi keeps a file per session in ~/.pi/agent/sessions;
// OpenClaw kept the same files under agents/<agent>/sessions (archived ones renamed
// .reset.<ts> or .deleted.<ts>) until 2026.8.1 moved them into a per-agent SQLite store.
// Branches and forks copy earlier entries into new files, so prompts and usage are keyed
// by entry id and counted once.

import fs from 'node:fs'
import path from 'node:path'
import type { FileOutcome, ThreadRecord, UsageRow } from '../types.ts'
import { parseJson, scanLines } from '../util/lines.ts'
import { openReadOnly, rows, tableNames, textOf } from '../util/sqlite.ts'
import { projectFromCwd } from '../util/project.ts'
import { sha1 } from '../util/hash.ts'
import { canonicalModel } from '../pipeline/modelName.ts'
import type { DiscoveredFile } from './claude.ts'
import { ThreadBuilder, stripInjected } from './common.ts'
import type { Root } from './roots.ts'
import { lines, prefix, relPath } from './tools.ts'

type Flavor = 'pi' | 'openclaw'

const stat = (file: string, extra: Partial<DiscoveredFile> = {}): DiscoveredFile | null => {
  try {
    const st = fs.statSync(file)
    return { file, size: st.size, mtimeMs: st.mtimeMs, archived: false, subagentByPath: false, ...extra }
  } catch {
    return null
  }
}
const list = (dir: string) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** Pi: sessions/--<cwd>--/<ts>_<uuid>.jsonl. Copies under subagent-artifacts/ are skipped. */
export function discoverPi(roots: Root[]): DiscoveredFile[] {
  const out: DiscoveredFile[] = []
  for (const r of roots) {
    for (const d of list(r.dir)) {
      if (!d.isDirectory() || d.name === 'subagent-artifacts') continue
      for (const f of list(path.join(r.dir, d.name))) {
        const df = f.isFile() && f.name.endsWith('.jsonl') ? stat(path.join(r.dir, d.name, f.name)) : null
        if (df) out.push(df)
      }
    }
  }
  return out
}

/**
 * OpenClaw: each agent's SQLite store (2026.8.1+) and its older per-session JSONL files,
 * including archived .reset/.deleted copies, which OpenClaw's own usage report counts too.
 * The store's WAL holds recent writes, so its size and time join the database's.
 */
export function discoverOpenClaw(roots: Root[]): DiscoveredFile[] {
  const out: DiscoveredFile[] = []
  for (const r of roots) {
    for (const a of list(path.join(r.dir, 'agents'))) {
      if (!a.isDirectory()) continue
      const db = path.join(r.dir, 'agents', a.name, 'agent', 'openclaw-agent.sqlite')
      const main = stat(db)
      if (main) {
        const wal = stat(`${db}-wal`)
        out.push({ ...main, size: main.size + (wal?.size ?? 0), mtimeMs: Math.max(main.mtimeMs, wal?.mtimeMs ?? 0) })
      }
      const dir = path.join(r.dir, 'agents', a.name, 'sessions')
      for (const f of list(dir)) {
        if (!f.isFile() || !/\.jsonl(?:\.(?:reset|deleted)\.[^/]+)?$/.test(f.name) || f.name.endsWith('.lock')) continue
        const df = stat(path.join(dir, f.name), { archived: !f.name.endsWith('.jsonl') })
        if (df) out.push(df)
      }
    }
  }
  return out
}

// ───────────────────────── what a person typed, on each surface

/** OpenClaw's own prompts to the agent: heartbeats, restarts, cron, memory flushes, metadata. */
const AUTOMATED = /^(?:Read HEARTBEAT\.md|Follow the heartbeat|GatewayRestart:|System: \[|Pre-compaction memory flush|[A-Z]\w+Info:\s*\n\s*\{)/

/** "[Telegram Ada (@ada) id:42 +5m 2026-01-02 10:00 PST] text" (and newer "…] Ada (@ada): text"). */
const ENVELOPE = /^\[([A-Z][\w-]*(?: [^\]\n]*?)?) \d{4}-\d\d-\d\d[^\]\n]*\]\s?(.*)$/

/**
 * The words a person sent through a chat channel, without OpenClaw's wrapping: the
 * envelope header, the message id line, attachment notes and the queued-message frame.
 * Null for messages OpenClaw wrote itself.
 */
export function openclawText(raw: string): string | null {
  const text = raw.replace(/\r\n/g, '\n').trim()
  if (!text || AUTOMATED.test(text)) return null
  const parts: string[] = []
  let cur: string[] | null = null
  let enveloped = false
  for (const line of text.split('\n')) {
    const env = line.match(ENVELOPE)
    if (env) {
      enveloped = true
      if (cur) parts.push(cur.join('\n'))
      // the sender label newer builds repeat before the body: "Ada (@ada): …"
      const label = env[1].replace(/^\S+\s+/, '').split(/\s+id:/)[0].trim()
      const body = label && env[2].startsWith(`${label}: `) ? env[2].slice(label.length + 2) : env[2]
      cur = [body]
      continue
    }
    if (/^\[message_id: [^\]]+\]$/.test(line) || /^\[media attached[^\]]*\]$/i.test(line)) continue
    if (/^\[Queued\b[^\]]*\]$/.test(line) || /^---$/.test(line) || /^Queued #\d+$/.test(line)) continue
    if (cur) cur.push(line)
    else if (!enveloped) cur = [line]
  }
  if (cur) parts.push(cur.join('\n'))
  const out = parts.map((p) => p.trim()).filter(Boolean).join('\n')
  return out || null
}

const contentText = (c: unknown): string =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c
          .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
          .map((p: any) => p.text)
          .join('\n')
      : ''

/** Pi's file and shell tools (OpenClaw calls its shell tool "exec"). */
function piTool(name: string, args: any, cwd: string) {
  const e = { edits: [] as [string, number, number][], cmds: [] as string[], diff: '' }
  if (!args || typeof args !== 'object') return e
  const file = typeof args.path === 'string' ? args.path : ''
  const rel = relPath(file, cwd)
  if (name === 'edit' && file) {
    const pairs: { oldText?: string; newText?: string }[] = Array.isArray(args.edits) ? args.edits : [args]
    let add = 0
    let rem = 0
    for (const p of pairs) {
      add += lines(p.newText)
      rem += lines(p.oldText)
    }
    e.edits.push([rel, add, rem])
    e.diff = `*** Update File: ${rel}\n${pairs.map((p) => `@@\n${prefix(p.oldText, '-')}\n${prefix(p.newText, '+')}`).join('\n')}`
  } else if (name === 'write' && file) {
    e.edits.push([rel, lines(args.content), 0])
    e.diff = `*** Add File: ${rel}\n${prefix(args.content, '+')}`
  } else if ((name === 'bash' || name === 'exec') && typeof args.command === 'string') e.cmds.push(args.command.slice(0, 200))
  return e
}

// ───────────────────────── one session, from file lines or database rows

class PiSession {
  b = new ThreadBuilder()
  usage: UsageRow[] = []
  header: any = null
  title = ''
  model: string | undefined
  first = Infinity
  last = 0
  bad = 0
  readonly flavor: Flavor
  readonly file: string
  constructor(flavor: Flavor, file: string) {
    this.flavor = flavor
    this.file = file
  }

  private tokens(key: string, model: string | undefined, t: number, u: any) {
    if (!u || typeof u !== 'object') return
    const write = Math.max(0, u.cacheWrite || 0)
    const fresh = Math.max(0, u.input || 0) + write
    const cached = Math.max(0, u.cacheRead || 0)
    const out = Math.max(0, u.output || 0)
    if (!fresh && !cached && !out) return
    const m = model ? canonicalModel(model) : undefined
    this.usage.push([key, m || 'unknown', t, fresh, cached, out, write, Math.min(write, Math.max(0, u.cacheWrite1h || 0))])
    this.b.agentTokens(m, fresh, cached, out, write, u.cacheWrite1h || 0)
  }

  entry(o: any, ln: number) {
    if (!o || typeof o !== 'object') return void this.bad++
    const t = (typeof o.message?.timestamp === 'number' ? o.message.timestamp : 0) || Date.parse(o.timestamp) || 0
    if (t && o.type !== 'session') {
      this.first = Math.min(this.first, t)
      this.last = Math.max(this.last, t)
    }
    switch (o.type) {
      case 'session':
        this.header ||= o
        return
      case 'session_info':
        if (typeof o.name === 'string') this.title = o.name
        return
      case 'model_change':
        this.model = o.modelId || this.model
        return
      case 'usage':
      case 'compaction':
      case 'branch_summary':
        // calls the harness made on its own (cache warming, summaries) still cost tokens
        return this.tokens(`p|${o.id}|${o.timestamp}`, o.model || this.model, t, o.usage)
      case 'message':
        break
      default:
        return
    }
    const m = o.message || {}
    const sid = this.header?.id || this.file
    if (m.role === 'user') {
      const raw = contentText(m.content)
      const text = this.flavor === 'openclaw' ? openclawText(raw) : stripInjected(raw)
      if (text && !text.startsWith('/')) this.b.human({ t, id: sha1(`${this.flavor}|${o.id}|${t}`), text, ln })
    } else if (m.role === 'assistant') {
      // OpenClaw mirrors what it delivered to a chat as an assistant message; no model ran
      if (m.model === 'delivery-mirror' || m.provider === 'openclaw' || m.provider === 'clawdbot') return
      const model = m.model || this.model
      this.model = model
      const cm = model ? canonicalModel(model) : undefined
      this.b.countModel(cm)
      const id = `${sid}:${o.id}`
      for (const part of Array.isArray(m.content) ? m.content : []) {
        if (part?.type === 'text' && typeof part.text === 'string') this.b.agentText(t, id, ln, part.text, cm)
        else if (part?.type === 'toolCall') this.b.agentTool(t, id, ln, String(part.name || ''), cm, piTool(String(part.name || ''), part.arguments, this.header?.cwd || ''))
      }
      this.tokens(`p|${o.id}|${m.timestamp ?? o.timestamp}`, model, t, m.usage)
      if (m.stopReason === 'aborted') this.b.interrupt()
    }
  }

  finish(surface: ThreadRecord['surface']): FileOutcome {
    const usage = { rows: this.usage }
    if (!this.header?.id) return this.bad ? { kind: 'error', message: 'unreadable session header' } : { kind: 'empty', usage }
    const events = this.b.finish()
    if (!events.some((e) => e.k === 'h')) return { kind: 'empty', usage }
    const cwd = String(this.header.cwd || '')
    const b = this.b
    const thread: ThreadRecord = {
      id: this.header.id,
      source: this.flavor,
      surface,
      file: this.file,
      archived: /\.jsonl\.(?:reset|deleted)\./.test(this.file),
      cwd,
      project: cwd ? projectFromCwd(cwd) : 'unknown',
      title: this.title || undefined,
      forkedFrom: typeof this.header.parentSession === 'string' ? path.basename(this.header.parentSession, '.jsonl') : undefined,
      startedAt: this.first === Infinity ? Date.parse(this.header.timestamp) || 0 : this.first,
      endedAt: this.last || Date.parse(this.header.timestamp) || 0,
      events,
      models: b.models,
      toolCalls: b.toolCalls,
      interrupts: b.interrupts,
      slashCommands: 0,
      tokens: b.tokens,
      agentMs: b.agentMs,
      linesAdded: b.linesAdded,
      linesRemoved: b.linesRemoved,
      efforts: b.efforts,
      planModeTurns: 0,
      warnings: this.bad ? [`${this.bad} unparseable lines skipped`] : [],
    }
    return { kind: 'thread', thread, usage }
  }
}

async function parseJsonl(df: DiscoveredFile, flavor: Flavor, surface: ThreadRecord['surface']): Promise<FileOutcome> {
  const s = new PiSession(flavor, df.file)
  await scanLines(
    df.file,
    () => true,
    (line, ln) => s.entry(parseJson(line), ln),
  )
  return s.finish(surface)
}

export const parsePiFile = (df: DiscoveredFile) => parseJsonl(df, 'pi', 'cli')

/** OpenClaw sessions arrive through chat channels unless they ran in a working folder. */
export async function parseOpenClawFile(df: DiscoveredFile): Promise<FileOutcome> {
  if (!df.file.endsWith('.sqlite')) return parseJsonl(df, 'openclaw', 'chat')
  const db = openReadOnly(df.file)
  if (!db) return { kind: 'error', message: 'could not open the OpenClaw store (lore needs Node 22.13 or newer)' }
  try {
    if (!tableNames(db).has('transcript_events')) return { kind: 'empty' }
    const threads: ThreadRecord[] = []
    const usage: UsageRow[] = []
    const ids = rows<{ session_id: string }>(db, 'SELECT DISTINCT session_id FROM transcript_events')
    for (const { session_id } of ids) {
      const s = new PiSession('openclaw', `${df.file}#${session_id}`)
      const evs = rows<{ seq: number; event_json: string | null; event_zstd: Uint8Array | null }>(db, 'SELECT seq, event_json, event_zstd FROM transcript_events WHERE session_id = ? ORDER BY seq', session_id)
      for (const e of evs) {
        let o: unknown = null
        try {
          o = JSON.parse(e.event_json ?? textOf(e.event_zstd, true))
        } catch {
          /* counted as unreadable below */
        }
        s.entry(o, e.seq + 1)
      }
      s.header ||= { id: session_id, timestamp: '' }
      const o = s.finish('chat')
      if (o.kind === 'thread') threads.push(o.thread)
      if (o.kind !== 'error') usage.push(...(o.usage?.rows ?? []))
    }
    return threads.length ? { kind: 'threads', threads, usage: { rows: usage } } : { kind: 'empty', usage: { rows: usage } }
  } finally {
    db.close()
  }
}

/** The changes one agent turn made, re-read for an episode's review from file lines or store rows. */
export async function piTurnDiffs(file: string, cwd: string, from: number, to: number): Promise<string[]> {
  const out: string[] = []
  const take = (o: any) => {
    if (o?.type !== 'message' || o.message?.role !== 'assistant') return
    for (const p of Array.isArray(o.message.content) ? o.message.content : []) if (p?.type === 'toolCall') out.push(piTool(String(p.name || ''), p.arguments, cwd).diff)
  }
  const store = file.indexOf('.sqlite#')
  if (store < 0) {
    await scanLines(
      file,
      (_head, ln) => (ln > to ? 'stop' : ln >= from),
      (line) => take(parseJson(line)),
    )
    return out
  }
  const db = openReadOnly(file.slice(0, store + 7))
  if (!db) return out
  try {
    // rows were numbered seq + 1 when the session was read
    for (const r of rows<{ event_json: string | null; event_zstd: Uint8Array | null }>(db, 'SELECT event_json, event_zstd FROM transcript_events WHERE session_id = ? AND seq BETWEEN ? AND ? ORDER BY seq', file.slice(store + 8), from - 1, to - 1)) {
      try {
        take(JSON.parse(r.event_json ?? textOf(r.event_zstd, true)))
      } catch {
        /* unreadable row */
      }
    }
  } finally {
    db.close()
  }
  return out
}
