import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FileOutcome, Surface, ThreadRecord, UsageRow } from '../types.ts'
import { parseJson, scanLines } from '../util/lines.ts'
import { projectFromCwd } from '../util/project.ts'
import { sha1 } from '../util/hash.ts'
import type { DiscoveredFile } from './claude.ts'
import type { Root } from './roots.ts'
import { ThreadBuilder, stripInjected } from './common.ts'
import { TEST_CMD, TEST_FAILED, codexTool } from './tools.ts'

/** The Codex home lore reads model metadata from: CODEX_HOME's first entry, else ~/.codex. */
export const codexHome = () => (process.env.CODEX_HOME || '').split(',')[0].trim() || path.join(os.homedir(), '.codex')

export function discoverCodex(roots: Root[]): DiscoveredFile[] {
  const out: DiscoveredFile[] = []
  const walk = (dir: string, archived: boolean, depth: number) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (depth < 5) walk(p, archived, depth + 1)
      } else if (e.name.endsWith('.jsonl')) {
        let st: fs.Stats
        try {
          st = fs.statSync(p)
        } catch {
          continue
        }
        out.push({ file: p, size: st.size, mtimeMs: st.mtimeMs, archived, subagentByPath: false })
      }
    }
  }
  for (const r of roots) {
    walk(path.join(r.dir, 'sessions'), false, 0)
    walk(path.join(r.dir, 'archived_sessions'), true, 0)
  }
  return out
}

function surfaceFor(meta: any): Surface {
  const src = meta?.source
  const originator = String(meta?.originator || '')
  if (src === 'exec' || originator.includes('sdk') || originator === 'codex_exec') return 'automated'
  if (originator === 'Codex Desktop') return 'desktop'
  if (src === 'vscode') return 'ide'
  return 'cli'
}

const textOf = (content: any): string =>
  Array.isArray(content)
    ? content
        .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
        .filter(Boolean)
        .join('\n')
    : typeof content === 'string'
      ? content
      : ''

/** Instructions and context Codex injects with the user role. */
function isInjectedUserText(s: string): boolean {
  return /^#\s*AGENTS\.md instructions/i.test(s) || /^<user_instructions>/.test(s)
}

export async function parseCodexFile(df: DiscoveredFile): Promise<FileOutcome> {
  const b = new ThreadBuilder()
  let meta: any = null
  let legacy = false
  let legacyStart = 0
  let model: string | undefined
  let effort: string | undefined
  let firstT = Infinity
  let lastT = 0
  let bad = 0
  let subagent = false
  let agentSeq = 0
  let planModeTurns = 0
  let plan: string | undefined
  const samples: [number, number, number][] = []
  // Codex repeats a token_count when nothing new was billed, and a fork replays its parent's
  // counts. A call is new only when the running total moves, and it's keyed by that running
  // total, so a replayed copy in another file lands on the same key.
  const usage: UsageRow[] = []
  let lastTotal = -1
  // Since 0.150 each model response also gets a token_usage_record, written just before its
  // token_count. A record whose token_count follows is the same call; one without (the call
  // that compacts the context gets none) is counted from the record, keyed by its response id.
  let pending: { id: string; t: number; u: any } | null = null
  const count = (key: string, t: number, u: any) => {
    const cached = u.cached_input_tokens || 0
    const fresh = Math.max(0, (u.input_tokens || 0) - cached)
    const write = Math.min(fresh, u.cache_write_input_tokens || 0)
    usage.push([key, model || 'unknown', t, fresh, cached, u.output_tokens || 0, write])
    if (!subagent) b.agentTokens(model, fresh, cached, u.output_tokens || 0, write)
  }
  const flush = () => {
    if (pending) count(`r|${pending.id}`, pending.t, pending.u)
    pending = null
  }
  const same = (a: any, b: any) => a.input_tokens === b.input_tokens && a.cached_input_tokens === b.cached_input_tokens && a.output_tokens === b.output_tokens && a.total_tokens === b.total_tokens

  // test commands the agent ran, waiting for their output
  const pendingTests = new Set<string>()
  const onTool = (t: number, ln: number, p: any) => {
    const name = String(p.name || p.type || '')
    const effect = codexTool(String(p.type), name, p, meta?.cwd || '')
    b.agentTool(t, `${df.file}:${ln}`, ln, name, model, effect)
    b.effort(effort)
    if (p.call_id && effect.cmds.some((c) => TEST_CMD.test(c))) pendingTests.add(String(p.call_id))
  }
  // a pass needs a clean exit code; a run still in progress has no outcome yet
  const onOutput = (p: any) => {
    if (!pendingTests.delete(String(p.call_id))) return
    const text = typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? '')
    const codes = [...text.matchAll(/exit_code\\?"?:\s*(\d+)|Process exited with code (\d+)|Exit code:? (\d+)/g)].map((m) => Number(m[1] ?? m[2] ?? m[3]))
    const failed = codes.some((c) => c !== 0) || TEST_FAILED.test(text)
    if (failed || codes.length) b.testResult(!failed)
  }

  await scanLines(
    df.file,
    (head, ln) => {
      if (ln === 1) return true
      if (head.includes('"type":"token_usage_record"')) return true
      if (subagent) return head.includes('"type":"turn_context"') || head.includes('"type":"token_count"')
      if (head.includes('"type":"response_item"')) {
        if (/"payload":\{"type":"(function_call|custom_tool_call)_output"/.test(head)) return [...pendingTests].some((id) => head.includes(id))
        return /"payload":\{"type":"(message|function_call|custom_tool_call|local_shell_call)"/.test(head)
      }
      if (head.includes('"type":"turn_context"')) return true
      if (head.includes('"type":"event_msg"')) return /"payload":\{"type":"(turn_aborted|token_count|task_complete|task_started)"/.test(head)
      if (legacy) return head.startsWith('{"type":"message"') || head.startsWith('{"type":"function_call"')
      return false
    },
    (line, ln) => {
      const o = parseJson(line)
      if (!o) {
        bad++
        return
      }
      if (ln === 1) {
        if (o.type === 'session_meta') {
          meta = o.payload || {}
          // subagents aren't part of the conversation; only their token counts are read
          if ((meta.source && typeof meta.source === 'object' && meta.source.subagent) || meta.thread_source === 'subagent') subagent = true
        } else if (o.id && o.timestamp) {
          legacy = true
          meta = { id: o.id, timestamp: o.timestamp, git: o.git }
          legacyStart = Date.parse(o.timestamp) || df.mtimeMs
        }
        return
      }

      let t: number
      let item: any
      if (legacy) {
        t = legacyStart + ln // order-preserving; real times aren't recorded in this format
        item = o
        if (o.type === 'function_call') return onTool(t, ln, o)
      } else {
        t = Date.parse(o.timestamp) || 0
        if (o.type === 'token_usage_record') {
          flush()
          const u = o.payload?.usage
          if (u && o.payload.response_id) pending = { id: String(o.payload.response_id), t, u }
          return
        }
        if (o.type === 'turn_context') {
          model = o.payload?.model || model
          effort = o.payload?.effort || o.payload?.reasoning_effort || effort
          return
        }
        if (o.type === 'event_msg') {
          const p = o.payload || {}
          if (p.type === 'turn_aborted') b.interrupt()
          else if (p.type === 'task_complete') b.agentDuration(Number(p.duration_ms) || 0)
          else if (p.type === 'task_started' && p.collaboration_mode_kind === 'plan') planModeTurns++
          else if (p.type === 'token_count') {
            const u = p.info?.last_token_usage
            const tot = p.info?.total_token_usage
            if (u && pending && same(pending.u, u)) pending = null
            else flush()
            if (u && (!tot || tot.total_tokens !== lastTotal)) {
              const key = tot ? `x|${tot.input_tokens},${tot.cached_input_tokens},${tot.output_tokens},${tot.reasoning_output_tokens},${tot.total_tokens}` : `x|${df.file}|${ln}`
              count(key, t, u)
              if (tot) lastTotal = tot.total_tokens
            }
            if (subagent) return
            const prim = p.rate_limits?.primary
            if (prim && typeof prim.used_percent === 'number') {
              plan = p.rate_limits.plan_type || plan
              const last = samples[samples.length - 1]
              if (!last || last[1] !== prim.used_percent) samples.push([t, prim.used_percent, prim.window_minutes || 0])
            }
          }
          return
        }
        if (subagent) return
        item = o.payload
        if (item?.type === 'function_call' || item?.type === 'custom_tool_call' || item?.type === 'local_shell_call') {
          b.touch(ln)
          return onTool(t, ln, item)
        }
        if (item?.type === 'function_call_output' || item?.type === 'custom_tool_call_output') return onOutput(item)
      }
      if (t) {
        firstT = Math.min(firstT, t)
        lastT = Math.max(lastT, t)
      }
      if (item?.type !== 'message') return

      const text = textOf(item.content)
      if (item.role === 'user') {
        if (!text) return
        if (/^<turn_aborted>/.test(text.trim())) {
          b.interrupt()
          return
        }
        if (isInjectedUserText(text.trim())) return
        const clean = stripInjected(text)
        if (!clean) return
        b.human({ t, id: sha1(`codex|${o.timestamp || ''}|${clean}`), text: clean, ln })
      } else if (item.role === 'assistant') {
        b.countModel(model)
        b.agentText(t, `${meta?.id || df.file}:a${agentSeq++}`, ln, text, model)
        b.effort(effort)
      }
      // developer/system roles are instructions, not conversation
    },
  )

  flush()
  // forks and subagents replay their ancestors' usage; the scan matches replays within a lineage only
  const lineage = meta?.id ? { id: String(meta.id), parent: meta.forked_from_id || meta.parent_thread_id || (meta.session_id && meta.session_id !== meta.id ? meta.session_id : undefined) } : undefined
  if (subagent) return { kind: 'subagent', usage: { rows: usage, lineage } }
  if (!meta) return bad ? { kind: 'error', message: 'unreadable session metadata' } : { kind: 'empty' }
  const events = b.finish()
  if (!events.some((e) => e.k === 'h')) return { kind: 'empty', usage: { rows: usage, lineage } }

  const cwd: string = meta.cwd || ''
  const repo = typeof meta.git?.repository_url === 'string' ? meta.git.repository_url : ''
  const repoName = repo ? path.basename(repo).replace(/\.git$/, '') : ''
  const thread: ThreadRecord = {
    id: meta.id || path.basename(df.file, '.jsonl'),
    source: 'codex',
    surface: surfaceFor(meta),
    file: df.file,
    archived: df.archived,
    cwd,
    project: cwd ? projectFromCwd(cwd) : repoName || 'unknown',
    forkedFrom: meta.forked_from_id || undefined,
    approxTimes: legacy || undefined,
    startedAt: firstT === Infinity ? Date.parse(meta.timestamp) || df.mtimeMs : firstT,
    endedAt: lastT || df.mtimeMs,
    events,
    models: b.models,
    toolCalls: b.toolCalls,
    interrupts: b.interrupts,
    slashCommands: 0,
    tokens: b.tokens,
    agentMs: b.agentMs,
    linesAdded: b.linesAdded,
    linesRemoved: b.linesRemoved,
    tests: b.tests.runs ? b.tests : undefined,
    efforts: b.efforts,
    planModeTurns,
    git: meta.git ? { branch: meta.git.branch || undefined, commit: meta.git.commit_hash || undefined, repo: repo || undefined } : undefined,
    limits: samples.length ? { plan, samples } : undefined,
    warnings: bad ? [`${bad} unparseable lines skipped`] : [],
  }
  return { kind: 'thread', thread, usage: { rows: usage, lineage } }
}

/** Codex keeps human-readable thread names in a small index next to the transcripts. */
export function codexTitles(roots: Root[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const r of roots) {
    try {
      for (const line of fs.readFileSync(path.join(r.dir, 'session_index.jsonl'), 'utf8').split(/\r?\n/)) {
        if (!line) continue
        try {
          const o = JSON.parse(line)
          if (o.id && o.thread_name) map.set(o.id, o.thread_name)
        } catch {
          /* skip */
        }
      }
    } catch {
      /* index is optional */
    }
  }
  return map
}
