import fs from 'node:fs'
import path from 'node:path'
import type { FileOutcome, FileUsage, Surface, ThreadRecord, UsageRow } from '../types.ts'
import { parseJson, scanLines } from '../util/lines.ts'
import { dayKey } from '../util/text.ts'
import { projectFromCwd } from '../util/project.ts'
import { ThreadBuilder, mergeUsage, stripInjected } from './common.ts'
import type { Root } from './roots.ts'
import { TEST_CMD, TEST_FAILED, claudeTool } from './tools.ts'


export interface DiscoveredFile {
  file: string
  size: number
  mtimeMs: number
  archived: boolean
  /** Known to be a subagent from its location alone; its body is never opened. */
  subagentByPath: boolean
}

export function discoverClaude(roots: Root[]): DiscoveredFile[] {
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
        if (depth < 8) walk(p, depth + 1)
      } else if (e.name.endsWith('.jsonl') && !e.name.includes('.orphaned-')) {
        // set-aside copies (.orphaned-…) repeat a session that's already here
        let st: fs.Stats
        try {
          st = fs.statSync(p)
        } catch {
          continue // locked, or deleted by Claude's cleanup mid-walk
        }
        const subagent = /[\\/]subagents[\\/]/.test(p) || e.name.startsWith('agent-')
        out.push({ file: p, size: st.size, mtimeMs: st.mtimeMs, archived: false, subagentByPath: subagent })
      }
    }
  }
  for (const r of roots) walk(path.join(r.dir, 'projects'), 0)
  return out
}

/** Desktop Code sessions are metadata pointing at a CLI transcript; we join, never double count. */
export function discoverClaudeDesktop(roots: string[]): Map<string, { title?: string; cwd?: string }> {
  const map = new Map<string, { title?: string; cwd?: string }>()
  const dirs = roots.flatMap((root) => safeReaddir(root).flatMap((account) => safeReaddir(path.join(root, account)).map((org) => path.join(root, account, org))))
  for (const dir of dirs) {
    for (const f of safeReaddir(dir)) {
      if (!/^local_.*\.json$/.test(f)) continue
      try {
        const o = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
        if (o.cliSessionId) map.set(o.cliSessionId, { title: o.title, cwd: o.cwd })
      } catch {
        /* unreadable metadata is reported as missing coverage, not fatal */
      }
    }
  }
  return map
}

function safeReaddir(d: string): string[] {
  try {
    return fs.readdirSync(d)
  } catch {
    return []
  }
}

function surfaceFor(entrypoint: string | undefined): Surface {
  if (!entrypoint) return 'cli'
  if (entrypoint.startsWith('sdk')) return 'automated'
  if (entrypoint.includes('desktop')) return 'desktop'
  if (entrypoint.includes('vscode') || entrypoint.includes('jetbrains') || entrypoint.includes('ide')) return 'ide'
  return 'cli'
}

/**
 * Collects token usage from assistant records. Claude Code writes one record per content
 * block of a reply (thinking, text, each tool call), each repeating the reply's usage; the
 * API billed it once, so a reply is keyed by its message id. `raw` keeps the
 * repeated sum per day too, which is how Claude Code's own counter adds it up.
 */
function usageCollector() {
  const rows = new Map<string, UsageRow>()
  const raw: Record<string, Record<string, number>> = {}
  return {
    add(o: any) {
      const msg = o?.message
      const u = msg?.usage
      if (!u || !msg.id || msg.model === '<synthetic>') return
      const model = String(msg.model || 'unknown')
      const t = Date.parse(o.timestamp) || 0
      const write = u.cache_creation_input_tokens || 0
      const row: UsageRow = [`c|${msg.id}`, model, t, (u.input_tokens || 0) + write, u.cache_read_input_tokens || 0, u.output_tokens || 0, write, Math.min(write, u.cache_creation?.ephemeral_1h_input_tokens || 0)]
      if (t) {
        const day = (raw[dayKey(t)] ||= {})
        day[model] = (day[model] || 0) + row[3] + row[4] + row[5]
      }
      // a reply streamed over several records can carry a partial count on the early ones
      const prev = rows.get(row[0])
      rows.set(row[0], prev ? mergeUsage(prev, row) : row)
    },
    result: (): FileUsage => ({ rows: [...rows.values()], raw }),
  }
}

/** Subagent transcripts: never part of the conversation, but their tokens are real. */
async function parseClaudeUsageOnly(df: DiscoveredFile): Promise<FileOutcome> {
  const usage = usageCollector()
  await scanLines(
    df.file,
    (head) => head.includes('"role":"assistant"') || head.includes('"type":"assistant"'),
    (line) => {
      const o = parseJson(line)
      if (o?.type === 'assistant') usage.add(o)
    },
  )
  return { kind: 'subagent', usage: usage.result() }
}

/** What Claude Code records when you say no to a tool call. */
const REJECTED = "doesn't want to proceed with this tool use"

export async function parseClaudeFile(df: DiscoveredFile): Promise<FileOutcome> {
  if (df.subagentByPath) return parseClaudeUsageOnly(df)
  const usage = usageCollector()
  const b = new ThreadBuilder()
  let sessionId = path.basename(df.file, '.jsonl')
  let cwd = ''
  let title: string | undefined
  let customTitle: string | undefined
  let entrypoint: string | undefined
  let sdkPrompts = 0
  let humanPrompts = 0
  let slash = 0
  let sidechainOnly = true
  let sawRecord = false
  let firstT = Infinity
  let lastT = 0
  let bad = 0
  let costUsd: number | undefined
  let planModeTurns = 0
  let branch: string | undefined
  const seenMsgIds = new Set<string>()
  // test commands the agent ran, waiting for their result
  const pendingTests = new Set<string>()

  await scanLines(
    df.file,
    (head) => {
      // tool results are large and not human, except a rejected tool call (that's you saying
      // no) and the result of a test run (did it pass?)
      if (head.includes('"tool_use_id"')) return head.includes(REJECTED) || [...pendingTests].some((id) => head.includes(id))
      return (
        head.includes('"role":"assistant"') ||
        head.includes('"type":"assistant"') ||
        head.includes('"type":"user"') ||
        head.includes('"type":"ai-title"') ||
        head.includes('"type":"custom-title"') ||
        head.includes('"subtype":"turn_duration"') ||
        head.includes('"type":"cost-state"')
      )
    },
    (line, ln) => {
      const o = parseJson(line)
      if (!o) {
        bad++
        return
      }
      if (o.type === 'ai-title') {
        title = o.aiTitle || title
        return
      }
      if (o.type === 'custom-title') {
        customTitle = o.customTitle || customTitle
        return
      }
      if (o.type === 'cost-state') {
        // Claude Code's own running API-equivalent total for the session.
        if (typeof o.totalCostUSD === 'number') costUsd = Math.max(costUsd || 0, o.totalCostUSD)
        return
      }
      if (o.type === 'system') {
        if (o.subtype === 'turn_duration' && !o.isSidechain) b.agentDuration(Number(o.durationMs) || 0)
        return
      }
      if (o.type !== 'user' && o.type !== 'assistant') return
      sawRecord = true
      if (o.type === 'assistant') usage.add(o)
      if (o.isSidechain) return
      sidechainOnly = false
      if (o.sessionId) sessionId = o.sessionId
      if (!cwd && o.cwd) cwd = o.cwd
      if (!entrypoint && o.entrypoint) entrypoint = o.entrypoint
      if (o.gitBranch && o.gitBranch !== 'HEAD') branch = o.gitBranch
      const t = Date.parse(o.timestamp) || 0
      if (t) {
        firstT = Math.min(firstT, t)
        lastT = Math.max(lastT, t)
      }

      if (o.type === 'assistant') {
        const msg = o.message || {}
        const model = msg.model
        const id = o.uuid || `${sessionId}:${ln}`
        for (const c of Array.isArray(msg.content) ? msg.content : []) {
          if (c?.type === 'text' && typeof c.text === 'string') b.agentText(t, id, ln, c.text, model)
          else if (c?.type === 'tool_use') {
            b.agentTool(t, id, ln, String(c.name || ''), model, claudeTool(String(c.name || ''), c.input, cwd))
            if (c.name === 'Bash' && c.id && TEST_CMD.test(String(c.input?.command || ''))) pendingTests.add(c.id)
          }
          // thinking/redacted_thinking blocks are deliberately ignored
        }
        // One API message spans several records that repeat its usage; count it once.
        if (msg.id && !seenMsgIds.has(msg.id)) {
          seenMsgIds.add(msg.id)
          b.countModel(model)
          const u = msg.usage
          if (u && model !== '<synthetic>') b.agentTokens(model, (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0), u.cache_read_input_tokens || 0, u.output_tokens || 0, u.cache_creation_input_tokens || 0, u.cache_creation?.ephemeral_1h_input_tokens || 0)
          b.effort(o.perTurnEffort || o.effort)
        }
        return
      }

      // user record
      if (Array.isArray(o.message?.content) && o.message.content.some((x: any) => x?.type === 'tool_result')) {
        if (JSON.stringify(o.message.content).includes(REJECTED)) b.interrupt()
        for (const r of o.message.content) {
          if (r?.type !== 'tool_result' || !pendingTests.delete(r.tool_use_id)) continue
          const text = typeof r.content === 'string' ? r.content : Array.isArray(r.content) ? String(r.content[0]?.text || '') : ''
          // a run sent to the background has no outcome yet
          if (!/running in background/i.test(text)) b.testResult(!r.is_error && !/^Exit code [1-9]/.test(text) && !TEST_FAILED.test(text))
        }
        return
      }
      if (o.isMeta || o.isCompactSummary || o.toolUseResult || o.isVisibleInTranscriptOnly) return
      // origin/turnOrigin say who started the turn. Desktop prompts arrive with
      // promptSource "sdk" but origin "human", so promptSource is only a fallback.
      const origin: string | undefined = o.origin?.kind ?? o.turnOrigin
      if (origin) {
        if (origin !== 'human') {
          if (origin === 'sdk') sdkPrompts++
          return
        }
      } else {
        if (o.promptSource === 'system') return
        if (o.promptSource === 'sdk') sdkPrompts++
      }

      const c = o.message?.content
      let text = ''
      if (typeof c === 'string') text = c
      else if (Array.isArray(c)) {
        if (c.some((x: any) => x?.type === 'tool_result')) return
        text = c
          .filter((x: any) => x?.type === 'text')
          .map((x: any) => x.text)
          .join('\n')
      }
      if (!text) return
      if (text.startsWith('[Request interrupted by user')) {
        b.interrupt()
        return
      }
      if (text.includes('<command-name>')) {
        slash++
        return
      }
      const clean = stripInjected(text)
      if (!clean) return
      humanPrompts++
      if (o.permissionMode === 'plan') planModeTurns++
      b.human({ t, id: o.uuid || `${sessionId}:${ln}`, text: clean, ln })
    },
  )

  if (!sawRecord) return bad ? { kind: 'error', message: `${bad} unparseable lines` } : { kind: 'empty' }
  if (sidechainOnly) return { kind: 'subagent', usage: usage.result() }
  const events = b.finish()
  if (!events.some((e) => e.k === 'h')) return { kind: 'empty', usage: usage.result() }

  let surface = surfaceFor(entrypoint)
  if (sdkPrompts > 0 && sdkPrompts >= humanPrompts / 2) surface = 'automated'
  const thread: ThreadRecord = {
    id: sessionId,
    source: 'claude-code',
    surface,
    file: df.file,
    archived: false,
    cwd,
    project: projectFromCwd(cwd),
    title: customTitle || title,
    startedAt: firstT === Infinity ? df.mtimeMs : firstT,
    endedAt: lastT || df.mtimeMs,
    events,
    models: b.models,
    toolCalls: b.toolCalls,
    interrupts: b.interrupts,
    slashCommands: slash,
    tokens: b.tokens,
    costUsd,
    agentMs: b.agentMs,
    linesAdded: b.linesAdded,
    linesRemoved: b.linesRemoved,
    tests: b.tests.runs ? b.tests : undefined,
    efforts: b.efforts,
    planModeTurns,
    git: branch ? { branch } : undefined,
    warnings: bad ? [`${bad} unparseable lines skipped`] : [],
  }
  return { kind: 'thread', thread, usage: usage.result() }
}
