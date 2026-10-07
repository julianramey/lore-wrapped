// Qwen Code: ~/.qwen/projects/<sanitized cwd>/chats/<session>.jsonl (and chats/archive/). A
// Gemini CLI fork that records like Claude Code: one JSON record per line with uuid,
// parentUuid, cwd and gitBranch, Gemini-style message parts, and usageMetadata on the one
// assistant record per model turn. Telemetry copies of that usage (system/ui_telemetry) and
// records Qwen wrote itself (goal runtime, notifications, cron) are skipped.

import fs from 'node:fs'
import path from 'node:path'
import type { FileOutcome, ThreadRecord, UsageRow } from '../types.ts'
import { parseJson, scanLines } from '../util/lines.ts'
import { projectFromCwd } from '../util/project.ts'
import { sha1 } from '../util/hash.ts'
import { canonicalModel } from '../pipeline/modelName.ts'
import type { DiscoveredFile } from './claude.ts'
import { ThreadBuilder, stripInjected } from './common.ts'
import { geminiTool } from './gemini.ts'
import type { Root } from './roots.ts'

const list = (dir: string) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

export function discoverQwen(roots: Root[]): DiscoveredFile[] {
  const out: DiscoveredFile[] = []
  for (const r of roots) {
    for (const p of list(path.join(r.dir, 'projects'))) {
      if (!p.isDirectory()) continue
      const chats = path.join(r.dir, 'projects', p.name, 'chats')
      for (const [dir, archived] of [
        [chats, false],
        [path.join(chats, 'archive'), true],
      ] as const) {
        for (const f of list(dir)) {
          if (!f.isFile() || !f.name.endsWith('.jsonl')) continue
          try {
            const st = fs.statSync(path.join(dir, f.name))
            out.push({ file: path.join(dir, f.name), size: st.size, mtimeMs: st.mtimeMs, archived, subagentByPath: false })
          } catch {
            /* gone mid-walk */
          }
        }
      }
    }
  }
  return out
}

const partsText = (parts: unknown) =>
  Array.isArray(parts)
    ? parts
        .filter((p: any) => typeof p?.text === 'string' && !p.thought)
        .map((p: any) => p.text)
        .join('\n')
    : ''

export async function parseQwenFile(df: DiscoveredFile): Promise<FileOutcome> {
  const b = new ThreadBuilder()
  const usage: UsageRow[] = []
  let id = ''
  let cwd = ''
  let branch = ''
  let title = ''
  let first = Infinity
  let last = 0
  let bad = 0
  await scanLines(
    df.file,
    () => true,
    (line, ln) => {
      const o = parseJson(line)
      if (!o) return void bad++
      const t = Date.parse(o.timestamp) || 0
      id ||= o.sessionId || ''
      cwd ||= o.cwd || ''
      branch ||= o.gitBranch || ''
      if (o.type === 'system') {
        if (o.subtype === 'custom_title' && typeof o.systemPayload?.customTitle === 'string') title = o.systemPayload.customTitle
        return
      }
      if (t) {
        first = Math.min(first, t)
        last = Math.max(last, t)
      }
      if (o.type === 'user') {
        // a person's prompt has no subtype and no provenance other than real_user
        if (o.subtype || (o.provenance && o.provenance !== 'real_user')) return
        const shown = o.systemPayload?.displayText
        const text = stripInjected(typeof shown === 'string' && shown ? shown : partsText(o.message?.parts))
        if (text && !text.startsWith('/')) b.human({ t, id: sha1(`qwen|${o.uuid}`), text, ln })
      } else if (o.type === 'assistant') {
        const model = o.model ? canonicalModel(o.model) : undefined
        b.countModel(model)
        const aid = `${id}:${o.uuid}`
        for (const p of Array.isArray(o.message?.parts) ? o.message.parts : []) {
          if (typeof p?.text === 'string' && !p.thought) b.agentText(t, aid, ln, p.text, model)
          else if (p?.functionCall) b.agentTool(t, aid, ln, String(p.functionCall.name || ''), model, geminiTool(String(p.functionCall.name || ''), p.functionCall.args, cwd))
        }
        const u = o.usageMetadata
        if (u) {
          // promptTokenCount includes cached tokens; thinking is billed as output
          const cached = u.cachedContentTokenCount || 0
          const fresh = Math.max(0, (u.promptTokenCount || 0) - cached)
          const out = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0)
          usage.push([`q|${o.uuid}`, model || 'unknown', t, fresh, cached, out, 0])
          b.agentTokens(model, fresh, cached, out)
        }
      } else if (o.type === 'tool_result' && o.toolCallResult?.status === 'cancelled') b.interrupt()
    },
  )
  if (!id) return bad ? { kind: 'error', message: 'unreadable chat file' } : { kind: 'empty' }
  const events = b.finish()
  if (!events.some((e) => e.k === 'h')) return { kind: 'empty', usage: { rows: usage } }
  const thread: ThreadRecord = {
    id,
    source: 'qwen',
    surface: 'cli',
    file: df.file,
    archived: df.archived,
    cwd,
    project: cwd ? projectFromCwd(cwd) : 'unknown',
    title: title || undefined,
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
