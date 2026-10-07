// GitHub Copilot CLI: ~/.copilot/session-state/<session>/events.jsonl (a flat <session>.jsonl
// before 1.0), one event per line: session.start (with the working folder), user.message,
// assistant.message (text and tool requests), tool.execution_*, and session.shutdown, which
// carries the session's token totals per model. Those totals are running sums that start over
// when a session resumes after a compaction, so each one is counted as what it added since
// the last; what a session spent between a resume and a compaction that reset the sums isn't
// in the log. COPILOT_HOME moves the whole folder.

import fs from 'node:fs'
import path from 'node:path'
import type { FileOutcome, ThreadRecord, UsageRow } from '../types.ts'
import { parseJson, scanLines } from '../util/lines.ts'
import { projectFromCwd } from '../util/project.ts'
import { sha1 } from '../util/hash.ts'
import { canonicalModel } from '../pipeline/modelName.ts'
import type { DiscoveredFile } from './claude.ts'
import { ThreadBuilder, stripInjected } from './common.ts'
import type { Root } from './roots.ts'
import { lines, prefix } from './tools.ts'

const list = (dir: string) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}
const stat = (file: string): DiscoveredFile | null => {
  try {
    const st = fs.statSync(file)
    return { file, size: st.size, mtimeMs: st.mtimeMs, archived: false, subagentByPath: false }
  } catch {
    return null
  }
}

export function discoverCopilot(roots: Root[]): DiscoveredFile[] {
  const out: DiscoveredFile[] = []
  for (const r of roots) {
    const state = path.join(r.dir, 'session-state')
    for (const e of list(state)) {
      const df = e.isDirectory() ? stat(path.join(state, e.name, 'events.jsonl')) : e.name.endsWith('.jsonl') ? stat(path.join(state, e.name)) : null
      if (df) out.push(df)
    }
  }
  return out
}

const pick = (o: any, ...keys: string[]) => {
  for (const k of keys) if (typeof o?.[k] === 'string') return o[k] as string
  return ''
}

/** Copilot's file and shell tools, under every argument spelling its versions have used. */
function copilotTool(name: string, rawArgs: unknown, cwd: string) {
  const e = { edits: [] as [string, number, number][], cmds: [] as string[], diff: '' }
  let args: any = rawArgs
  if (typeof rawArgs === 'string') {
    try {
      args = JSON.parse(rawArgs)
    } catch {
      return e
    }
  }
  if (!args || typeof args !== 'object') return e
  const file = pick(args, 'path', 'filePath', 'file_path')
  const rel = cwd && file.startsWith(cwd + path.sep) ? file.slice(cwd.length + 1) : file
  const oldText = pick(args, 'old_str', 'oldString', 'old_string')
  const newText = pick(args, 'new_str', 'newString', 'new_string')
  const whole = pick(args, 'file_text', 'content', 'contents')
  if (/edit|replace/.test(name) && file && (oldText || newText)) {
    e.edits.push([rel, lines(newText), lines(oldText)])
    e.diff = `*** Update File: ${rel}\n@@\n${prefix(oldText, '-')}\n${prefix(newText, '+')}`
  } else if (/create|write/.test(name) && file && whole) {
    e.edits.push([rel, lines(whole), 0])
    e.diff = `*** Add File: ${rel}\n${prefix(whole, '+')}`
  } else if (/bash|shell|terminal|powershell/.test(name)) {
    const cmd = pick(args, 'command', 'cmd')
    if (cmd) e.cmds.push(cmd.slice(0, 200))
  }
  return e
}

type Totals = { in: number; out: number; read: number; write: number }

export async function parseCopilotFile(df: DiscoveredFile): Promise<FileOutcome> {
  const b = new ThreadBuilder()
  const usage: UsageRow[] = []
  const prev = new Map<string, Totals>()
  let id = path.basename(df.file) === 'events.jsonl' ? path.basename(path.dirname(df.file)) : path.basename(df.file, '.jsonl')
  let cwd = ''
  let branch = ''
  let model: string | undefined
  let first = Infinity
  let last = 0
  let bad = 0
  let shutdowns = 0
  await scanLines(
    df.file,
    () => true,
    (line, ln) => {
      const o = parseJson(line)
      if (!o) return void bad++
      const d = o.data || {}
      const t = Date.parse(o.timestamp) || 0
      if (t) {
        first = Math.min(first, t)
        last = Math.max(last, t)
      }
      switch (o.type) {
        case 'session.start':
          id = d.sessionId || id
          cwd ||= d.context?.cwd || ''
          branch ||= d.context?.branch || ''
          model = d.selectedModel || model
          return
        case 'session.model_change':
          model = d.newModel || model
          return
        case 'user.message': {
          const text = stripInjected(typeof d.content === 'string' ? d.content : '')
          if (text && !text.startsWith('/')) b.human({ t, id: sha1(`copilot|${id}|${o.id || ln}`), text, ln })
          return
        }
        case 'assistant.message': {
          const m = d.model || model ? canonicalModel(d.model || model) : undefined
          b.countModel(m)
          const aid = `${id}:${d.messageId || o.id || ln}`
          if (typeof d.content === 'string' && d.content.trim()) b.agentText(t, aid, ln, d.content, m)
          for (const r of Array.isArray(d.toolRequests) ? d.toolRequests : []) b.agentTool(t, aid, ln, String(r?.name || r?.toolName || ''), m, copilotTool(String(r?.name || r?.toolName || ''), r?.arguments, cwd))
          return
        }
        case 'session.shutdown': {
          shutdowns++
          for (const [name, mm] of Object.entries<any>(d.modelMetrics || {})) {
            const u = mm?.usage || {}
            const cur: Totals = { in: Number(u.inputTokens) || 0, out: Number(u.outputTokens) || 0, read: Number(u.cacheReadTokens) || 0, write: Number(u.cacheWriteTokens) || 0 }
            const p = prev.get(name)
            // a smaller total means the sums started over; the new one is all new
            const fresh = p && cur.in >= p.in && cur.out >= p.out ? { in: cur.in - p.in, out: cur.out - p.out, read: Math.max(0, cur.read - p.read), write: Math.max(0, cur.write - p.write) } : cur
            prev.set(name, cur)
            // inputTokens includes cache reads and writes; reasoning is inside outputTokens
            const uncached = Math.max(0, fresh.in - fresh.read)
            if (!uncached && !fresh.read && !fresh.out) continue
            const m = canonicalModel(name)
            usage.push([`c|${id}|${name}|${shutdowns}`, m, t, uncached, fresh.read, fresh.out, Math.min(uncached, fresh.write)])
            b.sessionTokens(m, uncached, fresh.read, fresh.out, Math.min(uncached, fresh.write))
          }
          return
        }
      }
    },
  )
  if (!cwd) {
    // older sessions keep the folder only in workspace.yaml
    try {
      cwd = fs.readFileSync(path.join(path.dirname(df.file), 'workspace.yaml'), 'utf8').match(/^cwd:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '') || ''
    } catch {
      /* no workspace file */
    }
  }
  const events = b.finish()
  if (!events.some((e) => e.k === 'h')) return bad && !events.length ? { kind: 'error', message: 'unreadable session file' } : { kind: 'empty', usage: { rows: usage } }
  const thread: ThreadRecord = {
    id,
    source: 'copilot',
    surface: 'cli',
    file: df.file,
    archived: false,
    cwd,
    project: cwd ? projectFromCwd(cwd) : 'unknown',
    startedAt: first === Infinity ? df.mtimeMs : first,
    endedAt: last || df.mtimeMs,
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
    git: branch ? { branch } : undefined,
    warnings: bad ? [`${bad} unparseable lines skipped`] : [],
  }
  return { kind: 'thread', thread, usage: { rows: usage } }
}
