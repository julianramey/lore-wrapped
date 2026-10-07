// Gemini CLI: ~/.gemini/tmp/<project>/chats/session-*.json (older builds rewrite one JSON
// file per session) or .jsonl (since late 2026: a metadata line, then message records that
// are re-appended whole each time tokens or tool calls land, plus $set/$patch/$rewindTo
// edits). Chats don't record the working folder, only sha256 of it, so the folder comes
// from hashing the parents of files its tools touched. logs.json in each project folder
// keeps every prompt, so sessions whose chats are gone come back prompts-only.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { FileOutcome, HumanEvent, ThreadRecord, UsageRow } from '../types.ts'
import { parseJson, scanLines } from '../util/lines.ts'
import { projectFromCwd } from '../util/project.ts'
import { sha1 } from '../util/hash.ts'
import type { DiscoveredFile } from './claude.ts'
import { ThreadBuilder, stripInjected } from './common.ts'
import type { Root } from './roots.ts'
import { lines, prefix } from './tools.ts'

export function discoverGemini(roots: Root[]): DiscoveredFile[] {
  const out: DiscoveredFile[] = []
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (depth < 3) walk(p, depth + 1)
      } else if (/^session-.*\.jsonl?$/.test(e.name) || (depth > 0 && e.name.endsWith('.jsonl'))) {
        try {
          const st = fs.statSync(p)
          out.push({ file: p, size: st.size, mtimeMs: st.mtimeMs, archived: false, subagentByPath: depth > 0 })
        } catch {
          /* gone mid-walk */
        }
      }
    }
  }
  for (const r of roots) for (const proj of safeDirs(path.join(r.dir, 'tmp'))) walk(path.join(proj, 'chats'), 0)
  return out
}

const safeDirs = (d: string) => {
  try {
    return fs
      .readdirSync(d, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(d, e.name))
  } catch {
    return []
  }
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

/** The project folder whose sha256 is the chat's projectHash, found among the parents of touched files. */
export function folderFor(hash: string, files: string[]): string {
  if (!hash) return ''
  const seen = new Set<string>()
  for (const f of files) {
    for (let d = path.dirname(f); d && d !== path.dirname(d) && !seen.has(d); d = path.dirname(d)) {
      seen.add(d)
      if (sha256(d) === hash) return d
    }
  }
  return ''
}

interface Message {
  id: string
  timestamp: string
  type: string
  content?: unknown
  toolCalls?: { name?: string; args?: any; status?: string }[]
  tokens?: { input?: number; output?: number; cached?: number; thoughts?: number }
  model?: string
}

const textOf = (c: unknown): string =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c
          .map((p: any) => (typeof p === 'string' ? p : typeof p?.text === 'string' ? p.text : ''))
          .filter(Boolean)
          .join('\n')
      : ''

/** Gemini's file tools as edits and commands, like the other adapters' tool effects. Qwen Code
 * (a fork) renamed replace to edit and added exec. */
export function geminiTool(name: string, args: any, cwd: string) {
  if (name === 'edit') name = 'replace'
  if (name === 'exec') name = 'run_shell_command'
  const e = { edits: [] as [string, number, number][], cmds: [] as string[], diff: '' }
  if (!args || typeof args !== 'object') return e
  const file = String(args.file_path || '')
  const rel = cwd && file.startsWith(cwd + path.sep) ? file.slice(cwd.length + 1) : file
  if (name === 'replace' && file) {
    e.edits.push([rel, lines(args.new_string), lines(args.old_string)])
    e.diff = `*** Update File: ${rel}\n@@\n${prefix(args.old_string, '-')}\n${prefix(args.new_string, '+')}`
  } else if (name === 'write_file' && file) {
    e.edits.push([rel, lines(args.content), 0])
    e.diff = `*** Add File: ${rel}\n${prefix(args.content, '+')}`
  } else if (name === 'run_shell_command' && typeof args.command === 'string') e.cmds.push(args.command.slice(0, 200))
  return e
}

/** A chat's metadata and messages in time order, folded by id; null when the file is unreadable. */
async function readChat(file: string): Promise<{ meta: any; msgs: Message[]; bad: number } | null> {
  let meta: any = null
  const byId = new Map<string, Message>()
  const order: string[] = []
  let bad = 0
  const put = (m: Message) => {
    if (!m?.id) return
    if (!byId.has(m.id)) order.push(m.id)
    byId.set(m.id, m)
  }

  if (file.endsWith('.json')) {
    // older builds: the whole conversation, rewritten on every message
    let o: any = null
    try {
      o = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      return null
    }
    meta = o
    for (const m of Array.isArray(o?.messages) ? o.messages : []) put(m)
  } else {
    // newer builds: append-only records, folded by id (last write wins); rewound messages
    // leave the transcript but their tokens were still spent
    await scanLines(
      file,
      () => true,
      (line, ln) => {
        const o = parseJson(line)
        if (!o) return void bad++
        if (ln === 1 && o.sessionId) return void (meta = o)
        if (o.$set && typeof o.$set === 'object') return void (meta = { ...meta, ...o.$set })
        if (o.$patch) {
          const p = o.$patch
          if (p.id && byId.has(p.id) && p.updates) byId.set(p.id, { ...byId.get(p.id)!, ...p.updates })
          return
        }
        if (o.$rewindTo) return
        put(o)
      },
    )
  }
  const msgs = order.map((id) => byId.get(id)!).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  return { meta, msgs, bad }
}

/** Where a message sits, for evidence links and diffs: its place in time order, after the header. */
const lnOf = (i: number) => i + 2

export async function parseGeminiFile(df: DiscoveredFile): Promise<FileOutcome> {
  const chat = await readChat(df.file)
  if (!chat) return { kind: 'error', message: 'unreadable chat file' }
  const { meta, msgs, bad } = chat
  if (!meta?.sessionId) return bad ? { kind: 'error', message: 'unreadable session metadata' } : { kind: 'empty' }

  const touched = msgs.flatMap((m) => (m.toolCalls || []).map((c) => String(c?.args?.file_path || c?.args?.dir_path || '')).filter((f) => path.isAbsolute(f)))
  const cwd = folderFor(String(meta.projectHash || ''), touched)
  const usage: UsageRow[] = []
  const b = new ThreadBuilder()
  let firstT = Infinity
  let lastT = 0
  msgs.forEach((m, i) => {
    const t = Date.parse(m.timestamp) || 0
    const ln = lnOf(i)
    if (t) {
      firstT = Math.min(firstT, t)
      lastT = Math.max(lastT, t)
    }
    if (m.type === 'user') {
      const text = stripInjected(textOf(m.content))
      if (text && !text.startsWith('/')) b.human({ t, id: sha1(`gemini|${meta.sessionId}|${m.id}`), text, ln })
    } else if (m.type === 'gemini') {
      const model = m.model
      b.countModel(model)
      const text = textOf(m.content)
      if (text) b.agentText(t, `${meta.sessionId}:${m.id}`, ln, text, model)
      for (const c of m.toolCalls || []) b.agentTool(t, `${meta.sessionId}:${m.id}`, ln, String(c?.name || ''), model, geminiTool(String(c?.name || ''), c?.args, cwd))
      const k = m.tokens
      if (k) {
        // input includes cached; thoughts are billed as output
        const cached = k.cached || 0
        const fresh = Math.max(0, (k.input || 0) - cached)
        const out = (k.output || 0) + (k.thoughts || 0)
        b.agentTokens(model, fresh, cached, out)
        usage.push([`g|${meta.sessionId}|${m.id}`, model || 'unknown', t, fresh, cached, out, 0, 0])
      }
    } else if (m.type === 'info' && /cancel/i.test(textOf(m.content))) b.interrupt()
  })

  if (meta.kind === 'subagent' || df.subagentByPath) return { kind: 'subagent', usage: { rows: usage } }
  const events = b.finish()
  if (!events.some((e) => e.k === 'h')) return { kind: 'empty', usage: { rows: usage } }
  const thread: ThreadRecord = {
    id: meta.sessionId,
    source: 'gemini',
    surface: 'cli',
    file: df.file,
    archived: false,
    cwd,
    cwdHash: String(meta.projectHash || '') || undefined,
    project: cwd ? projectFromCwd(cwd) : 'unknown',
    startedAt: firstT === Infinity ? Date.parse(meta.startTime) || df.mtimeMs : firstT,
    endedAt: lastT || Date.parse(meta.lastUpdated) || df.mtimeMs,
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
    warnings: bad ? [`${bad} unparseable lines skipped`] : [],
  }
  return { kind: 'thread', thread, usage: { rows: usage } }
}

/**
 * Prompts from each project's logs.json, for sessions with no chat file left (Gemini deletes
 * chats after 30 days by default). Prompts only: what you typed, when, in which project.
 */
export function recoverGeminiLogs(roots: Root[], known: Set<string>, seenText: Set<string>, promptKey: (text: string, t: number) => string): ThreadRecord[] {
  const out: ThreadRecord[] = []
  for (const r of roots) {
    for (const proj of safeDirs(path.join(r.dir, 'tmp'))) {
      let rows: any[] = []
      try {
        rows = JSON.parse(fs.readFileSync(path.join(proj, 'logs.json'), 'utf8'))
      } catch {
        continue
      }
      const bySession = new Map<string, HumanEvent[]>()
      for (const [i, x] of (Array.isArray(rows) ? rows : []).entries()) {
        const text = typeof x?.message === 'string' ? x.message.trim() : ''
        const t = Date.parse(x?.timestamp)
        if (x?.type !== 'user' || !text || !Number.isFinite(t) || text.startsWith('/') || !x.sessionId || known.has(x.sessionId) || seenText.has(promptKey(text, t))) continue
        const evs = bySession.get(x.sessionId) || []
        evs.push({ k: 'h', t, id: sha1(`gemini-log|${x.sessionId}|${x.messageId ?? i}|${text}`), text, ln: i + 1 })
        bySession.set(x.sessionId, evs)
      }
      for (const [id, events] of bySession) {
        events.sort((a, b) => a.t - b.t)
        out.push({
          id,
          source: 'gemini',
          surface: 'cli',
          file: path.join(proj, 'logs.json'),
          archived: false,
          cwd: '',
          cwdHash: path.basename(proj),
          project: 'unknown',
          recovered: true,
          startedAt: events[0].t,
          endedAt: events[events.length - 1].t,
          events,
          models: {},
          toolCalls: 0,
          interrupts: 0,
          slashCommands: 0,
          tokens: {},
          agentMs: 0,
          linesAdded: 0,
          linesRemoved: 0,
          efforts: {},
          planModeTurns: 0,
          warnings: [],
        })
      }
    }
  }
  return out
}

/** Names Gemini projects whose folder is known elsewhere: any cwd lore saw whose sha256 matches. */
export function nameGeminiProjects(threads: ThreadRecord[]) {
  const byHash = new Map<string, string>()
  for (const t of threads) if (t.cwd) byHash.set(sha256(t.cwd), t.cwd)
  for (const t of threads) {
    if (t.source !== 'gemini' || t.cwd || !t.cwdHash) continue
    const cwd = byHash.get(t.cwdHash)
    if (cwd) {
      t.cwd = cwd
      t.project = projectFromCwd(cwd)
    }
  }
}

/** The changes one agent turn made, re-read for an episode's review. */
export async function geminiTurnDiffs(file: string, cwd: string, from: number, to: number): Promise<string[]> {
  const chat = await readChat(file)
  if (!chat) return []
  return chat.msgs.flatMap((m, i) => (lnOf(i) >= from && lnOf(i) <= to && m.type === 'gemini' ? (m.toolCalls || []).map((c) => geminiTool(String(c?.name || ''), c?.args, cwd).diff) : []))
}
