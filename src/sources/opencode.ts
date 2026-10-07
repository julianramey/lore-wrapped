// OpenCode, and Kilo CLI (its fork), keep every session in one SQLite database:
// ~/.local/share/opencode/opencode.db (opencode-<channel>.db for other release channels) and
// ~/.local/share/kilo/kilo.db. Before 1.2.0 (Feb 2026) OpenCode wrote a tree of JSON files
// under storage/, and the migration left it in place, so both are read and each session,
// message and reply counts once by its id. Child sessions are subagents started by the
// task tool: their tokens count, their prompts aren't the person's.

import fs from 'node:fs'
import path from 'node:path'
import type { FileOutcome, ThreadRecord, UsageRow } from '../types.ts'
import { openReadOnly, rows, tableNames } from '../util/sqlite.ts'
import { projectFromCwd } from '../util/project.ts'
import { sha1 } from '../util/hash.ts'
import { canonicalModel } from '../pipeline/modelName.ts'
import type { DiscoveredFile } from './claude.ts'
import { ThreadBuilder, stripInjected } from './common.ts'
import type { Root } from './roots.ts'
import { lines, patchStats, prefix, relPath } from './tools.ts'

export type OpenCodeFlavor = 'opencode' | 'kilo'

const stat = (file: string) => {
  try {
    return fs.statSync(file)
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

/**
 * The databases in each data folder (with their WAL, which holds recent writes) and each
 * session file of the legacy tree. A legacy session's messages live in their own folder,
 * whose time moves when one is added.
 */
export function discoverOpenCode(roots: Root[], flavor: OpenCodeFlavor): DiscoveredFile[] {
  const out: DiscoveredFile[] = []
  const db = new RegExp(`^(?:${flavor}|opencode)(?:-[\\w.-]+)?\\.db$`)
  for (const r of roots) {
    for (const f of list(r.dir)) {
      if (!f.isFile() || !db.test(f.name)) continue
      const file = path.join(r.dir, f.name)
      const main = stat(file)
      const wal = stat(`${file}-wal`)
      if (main) out.push({ file, size: main.size + (wal?.size ?? 0), mtimeMs: Math.max(main.mtimeMs, wal?.mtimeMs ?? 0), archived: false, subagentByPath: false })
    }
    const sessions = path.join(r.dir, 'storage', 'session')
    for (const p of list(sessions)) {
      if (!p.isDirectory()) continue
      for (const f of list(path.join(sessions, p.name))) {
        if (!f.isFile() || !f.name.endsWith('.json')) continue
        const file = path.join(sessions, p.name, f.name)
        const st = stat(file)
        const msgs = stat(path.join(r.dir, 'storage', 'message', f.name.slice(0, -5)))
        if (st) out.push({ file, size: st.size, mtimeMs: Math.max(st.mtimeMs, msgs?.mtimeMs ?? 0), archived: false, subagentByPath: false })
      }
    }
  }
  return out
}

/** OpenCode's file and shell tools: edit, multiedit, write, apply_patch, bash. */
function openCodeTool(name: string, input: any, cwd: string) {
  const e = { edits: [] as [string, number, number][], cmds: [] as string[], diff: '' }
  if (!input || typeof input !== 'object') return e
  const file = typeof input.filePath === 'string' ? input.filePath : ''
  const rel = relPath(file, cwd)
  if ((name === 'edit' || name === 'multiedit') && file) {
    const pairs: { oldString?: string; newString?: string }[] = Array.isArray(input.edits) ? input.edits : [input]
    e.edits.push([rel, pairs.reduce((a, p) => a + lines(p.newString), 0), pairs.reduce((a, p) => a + lines(p.oldString), 0)])
    e.diff = `*** Update File: ${rel}\n${pairs.map((p) => `@@\n${prefix(p.oldString, '-')}\n${prefix(p.newString, '+')}`).join('\n')}`
  } else if (name === 'write' && file) {
    e.edits.push([rel, lines(input.content), 0])
    e.diff = `*** Add File: ${rel}\n${prefix(input.content, '+')}`
  } else if (name === 'apply_patch' && typeof input.patchText === 'string') {
    e.edits.push(...patchStats(input.patchText, cwd))
    e.diff = input.patchText
  } else if (name === 'bash' && typeof input.command === 'string') e.cmds.push(input.command.slice(0, 200))
  return e
}

interface Msg {
  id: string
  t: number
  role: 'user' | 'assistant' | string
  data: any
  parts: any[]
}

interface Session {
  id: string
  parent: string | null
  cwd: string
  title: string
  created: number
  msgs: Msg[]
}

/** One session's thread and usage rows; subagent sessions give usage only. */
function build(s: Session, flavor: OpenCodeFlavor, file: string): { thread: ThreadRecord | null; usage: UsageRow[] } {
  const b = new ThreadBuilder()
  const usage: UsageRow[] = []
  let first = Infinity
  let last = 0
  s.msgs.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1))
  s.msgs.forEach((m, i) => {
    const ln = i + 1
    if (m.t) {
      first = Math.min(first, m.t)
      last = Math.max(last, m.t)
    }
    if (m.role === 'user') {
      // parts the harness added (file contents, reminders) are marked synthetic
      const text = stripInjected(
        m.parts
          .filter((p) => p?.type === 'text' && !p.synthetic && !p.ignored && typeof p.text === 'string')
          .map((p) => p.text)
          .join('\n'),
      )
      if (text) b.human({ t: m.t, id: sha1(`${flavor}|${m.id}`), text, ln })
      return
    }
    if (m.role !== 'assistant') return
    const d = m.data
    const model = typeof d.modelID === 'string' && d.modelID ? canonicalModel(d.modelID) : undefined
    b.countModel(model)
    const id = `${s.id}:${m.id}`
    for (const p of m.parts) {
      if (p?.type === 'text' && typeof p.text === 'string' && !p.synthetic) b.agentText(m.t, id, ln, p.text, model)
      else if (p?.type === 'tool') b.agentTool(m.t, id, ln, String(p.tool || ''), model, openCodeTool(String(p.tool || ''), p.state?.input, s.cwd))
    }
    const done = Number(d.time?.completed) || 0
    if (done > m.t) b.agentDuration(done - m.t)
    if (d.error?.name === 'MessageAbortedError') b.interrupt()
    const k = d.tokens
    if (k && typeof k === 'object') {
      // OpenCode keeps cache reads and writes out of `input`, and reasoning out of `output`
      const write = Math.max(0, Number(k.cache?.write) || 0)
      const fresh = Math.max(0, Number(k.input) || 0) + write
      const cached = Math.max(0, Number(k.cache?.read) || 0)
      const out = Math.max(0, Number(k.output) || 0) + Math.max(0, Number(k.reasoning) || 0)
      if (fresh || cached || out) {
        usage.push([`o|${m.id}`, model || 'unknown', m.t, fresh, cached, out, write])
        b.agentTokens(model, fresh, cached, out, write)
      }
    }
  })
  const events = b.finish()
  if (s.parent || !events.some((e) => e.k === 'h')) return { thread: null, usage }
  return {
    usage,
    thread: {
      id: s.id,
      source: flavor,
      surface: 'cli',
      file,
      archived: false,
      cwd: s.cwd,
      project: s.cwd ? projectFromCwd(s.cwd) : 'unknown',
      title: s.title || undefined,
      startedAt: first === Infinity ? s.created : first,
      endedAt: last || s.created,
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
      warnings: [],
    },
  }
}

const json = (v: unknown) => {
  try {
    return typeof v === 'string' ? JSON.parse(v) : null
  } catch {
    return null
  }
}

function outcome(sessions: Session[], flavor: OpenCodeFlavor, file: string): FileOutcome {
  const threads: ThreadRecord[] = []
  const rows: UsageRow[] = []
  const subRows: UsageRow[] = []
  for (const s of sessions) {
    const { thread, usage } = build(s, flavor, file)
    if (thread) threads.push(thread)
    ;(s.parent ? subRows : rows).push(...usage)
  }
  const usage = { rows, subRows }
  return threads.length ? { kind: 'threads', threads, usage } : { kind: 'empty', usage }
}

/** The database: sessions, then each session's messages and parts. */
function readDb(file: string, flavor: OpenCodeFlavor): FileOutcome {
  const db = openReadOnly(file)
  if (!db) return { kind: 'error', message: `could not open the ${flavor === 'kilo' ? 'Kilo' : 'OpenCode'} database (lore needs Node 22.13 or newer)` }
  try {
    const tables = tableNames(db)
    if (!tables.has('session')) return { kind: 'empty' }
    const sessions = rows<{ id: string; parent_id: string | null; directory: string | null; title: string | null; time_created: number }>(db, 'SELECT id, parent_id, directory, title, time_created FROM session')
    const out: Session[] = []
    for (const r of sessions) {
      const s: Session = { id: r.id, parent: r.parent_id || null, cwd: r.directory || '', title: r.title || '', created: Number(r.time_created) || 0, msgs: [] }
      const byId = new Map<string, Msg>()
      if (tables.has('message')) {
        for (const m of rows<{ id: string; time_created: number; data: string }>(db, 'SELECT id, time_created, data FROM message WHERE session_id = ?', r.id)) {
          const d = json(m.data) || {}
          const msg = { id: m.id, t: Number(d.time?.created) || Number(m.time_created) || 0, role: d.role, data: d, parts: [] }
          byId.set(m.id, msg)
          s.msgs.push(msg)
        }
        // tool outputs can be large and lore never reads them
        for (const p of rows<{ message_id: string; data: string }>(
          db,
          "SELECT message_id, CASE WHEN json_valid(data) THEN json_remove(data, '$.state.output', '$.state.metadata', '$.state.attachments') ELSE data END AS data FROM part WHERE session_id = ? ORDER BY id",
          r.id,
        ))
          byId.get(p.message_id)?.parts.push(json(p.data))
      }
      // newer builds also keep typed messages; read them for sessions the classic tables lack
      if (!s.msgs.length && tables.has('session_message')) {
        for (const m of rows<{ id: string; type: string; time_created: number; data: string }>(db, 'SELECT id, type, time_created, data FROM session_message WHERE session_id = ? ORDER BY seq', r.id)) {
          const d = json(m.data) || {}
          const t = Number(m.time_created) || 0
          if (m.type === 'user') s.msgs.push({ id: m.id, t, role: 'user', data: d, parts: [{ type: 'text', text: d.text }] })
          else if (m.type === 'assistant')
            s.msgs.push({
              id: m.id,
              t,
              role: 'assistant',
              data: { modelID: d.model?.id, tokens: d.tokens, time: { completed: d.time?.completed }, error: d.error },
              parts: (Array.isArray(d.content) ? d.content : []).map((c: any) => (c?.type === 'tool' ? { type: 'tool', tool: c.name, state: { input: c.state?.input } } : c)),
            })
        }
      }
      out.push(s)
    }
    return outcome(out, flavor, file)
  } finally {
    db.close()
  }
}

/** A legacy session file: storage/session/<project>/<id>.json, its messages and their parts. */
function readLegacy(file: string, flavor: OpenCodeFlavor): FileOutcome {
  const meta = json(fs.readFileSync(file, 'utf8'))
  if (!meta?.id) return { kind: 'error', message: 'unreadable session file' }
  const storage = path.dirname(path.dirname(path.dirname(file)))
  const s: Session = { id: meta.id, parent: meta.parentID || null, cwd: meta.directory || '', title: meta.title || '', created: Number(meta.time?.created) || 0, msgs: [] }
  const dir = path.join(storage, 'message', meta.id)
  for (const f of list(dir)) {
    if (!f.name.endsWith('.json')) continue
    const d = json(fs.readFileSync(path.join(dir, f.name), 'utf8'))
    if (!d) continue
    const id = d.id || f.name.slice(0, -5)
    const pdir = path.join(storage, 'part', id)
    const parts = list(pdir)
      .filter((p) => p.name.endsWith('.json'))
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .map((p) => json(fs.readFileSync(path.join(pdir, p.name), 'utf8')))
      .filter(Boolean)
    s.msgs.push({ id, t: Number(d.time?.created) || 0, role: d.role, data: d, parts })
  }
  return outcome([s], flavor, file)
}

export async function parseOpenCodeFile(df: DiscoveredFile, flavor: OpenCodeFlavor): Promise<FileOutcome> {
  return df.file.endsWith('.db') ? readDb(df.file, flavor) : readLegacy(df.file, flavor)
}
