// Re-reads one agent turn's tool calls from its source lines to recover the actual
// change it made. Only used for the handful of episodes shown for review.

import { geminiTurnDiffs } from '../sources/gemini.ts'
import { piTurnDiffs } from '../sources/pi.ts'
import { claudeTool, codexTool } from '../sources/tools.ts'
import type { AgentEvent, ThreadRecord } from '../types.ts'
import { parseJson, scanLines } from '../util/lines.ts'

const MAX_DIFF = 7000

export async function readTurnDiff(t: ThreadRecord, ev: AgentEvent): Promise<string> {
  if (!ev.edits?.length) return ''
  const from = ev.ln
  const to = ev.lnEnd ?? ev.ln
  const parts: string[] = []
  if (t.source === 'gemini') parts.push(...(await geminiTurnDiffs(t.file, t.cwd, from, to)))
  else if (t.source === 'pi' || t.source === 'openclaw') parts.push(...(await piTurnDiffs(t.file, t.cwd, from, to)))
  else await scanLines(
    t.file,
    (head, ln) => {
      if (ln > to) return 'stop'
      if (ln < from) return false
      return t.source === 'claude-code' ? head.includes('"role":"assistant"') || head.includes('"type":"assistant"') : /"type":"(function_call|custom_tool_call)"/.test(head)
    },
    (line) => {
      const o = parseJson(line)
      if (!o) return
      if (t.source === 'claude-code') {
        for (const c of o.message?.content || []) if (c?.type === 'tool_use') parts.push(claudeTool(String(c.name), c.input, t.cwd).diff)
      } else {
        const p = o.payload || o
        parts.push(codexTool(String(p.type), String(p.name || ''), p, t.cwd).diff)
      }
    },
  )
  const diff = parts.filter(Boolean).join('\n')
  return diff.length > MAX_DIFF ? diff.slice(0, MAX_DIFF) + `\n… ${diff.length - MAX_DIFF} more characters omitted` : diff
}
