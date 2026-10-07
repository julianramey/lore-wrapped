// Claude Code deletes transcripts after cleanupPeriodDays (30 by default), but its
// prompt history (~/.claude/history.jsonl, what the up arrow recalls) is never cleaned
// up. lore rebuilds each deleted session from it as a prompts-only thread: what you
// typed, when, and where. Agent replies, tools and tokens for those sessions are gone.

import fs from 'node:fs'
import type { HumanEvent, ThreadRecord } from '../types.ts'
import { scanLines } from '../util/lines.ts'
import { projectFromCwd } from '../util/project.ts'
import { sha1 } from '../util/hash.ts'


/** Without a session id, a gap this long starts a new conversation. */
const GAP_MS = 2 * 60 * 60 * 1000

export interface RecoveredHistory {
  threads: ThreadRecord[]
  /** Prompts in sessions whose transcripts are still on disk (already counted). */
  onDisk: number
  prompts: number
}

/** Matches a prompt across sources: its text and the minute it was sent. */
export const promptKey = (text: string, t: number) => `${Math.round(t / 60000)}@${text.trim().slice(0, 200)}`

/** Prompts-only threads for every history session not in `known` (session ids with a transcript). */
export async function recoverClaudeHistory(known: Set<string>, seenText: Set<string>, file: string): Promise<RecoveredHistory> {
  const out: RecoveredHistory = { threads: [], onDisk: 0, prompts: 0 }
  let st: fs.Stats
  try {
    st = fs.statSync(file)
  } catch {
    return out
  }
  if (!st.isFile()) return out

  type Row = { text: string; t: number; cwd: string; sid?: string; ln: number; slash: boolean }
  const rows: Row[] = []
  await scanLines(
    file,
    () => true,
    (line, ln) => {
      let r: any
      try {
        r = JSON.parse(line.toString('utf8'))
      } catch {
        return
      }
      const text = typeof r?.display === 'string' ? r.display.trim() : ''
      const t = Number(r?.timestamp)
      if (!text || !Number.isFinite(t)) return
      rows.push({ text, t, cwd: typeof r.project === 'string' ? r.project : '', sid: typeof r.sessionId === 'string' ? r.sessionId : undefined, ln, slash: text.startsWith('/') })
    },
  )
  rows.sort((a, b) => a.t - b.t)

  const groups = new Map<string, Row[]>()
  const lastByCwd = new Map<string, { key: string; t: number }>()
  for (const r of rows) {
    if (r.sid && known.has(r.sid)) {
      if (!r.slash) out.onDisk++
      continue
    }
    let key = r.sid
    if (!key) {
      const prev = lastByCwd.get(r.cwd)
      key = prev && r.t - prev.t < GAP_MS ? prev.key : `hist-${sha1(r.cwd + r.t).slice(0, 16)}`
      lastByCwd.set(r.cwd, { key, t: r.t })
    }
    const g = groups.get(key)
    if (g) g.push(r)
    else groups.set(key, [r])
  }

  for (const [id, g] of groups) {
    const events: HumanEvent[] = []
    let slash = 0
    for (const r of g) {
      if (r.slash) {
        slash++
        continue
      }
      // The same prompt can also be in a surviving transcript (a resumed or forked session).
      if (seenText.has(promptKey(r.text, r.t))) continue
      events.push({ k: 'h', t: r.t, id: `hist:${sha1(`${r.t}:${r.text}`).slice(0, 20)}`, text: r.text, ln: r.ln })
    }
    if (!events.length) continue
    out.prompts += events.length
    const cwd = g[0].cwd
    out.threads.push({
      id,
      source: 'claude-code',
      surface: 'cli',
      file,
      archived: false,
      cwd,
      project: projectFromCwd(cwd),
      startedAt: events[0].t,
      endedAt: events[events.length - 1].t,
      events,
      models: {},
      toolCalls: 0,
      interrupts: 0,
      slashCommands: slash,
      tokens: {},
      agentMs: 0,
      linesAdded: 0,
      linesRemoved: 0,
      efforts: {},
      planModeTurns: 0,
      warnings: [],
      recovered: true,
    })
  }
  return out
}
