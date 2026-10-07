// Your models, ranked by the tokens each one processed for you: the one measure that's
// complete for both tools (Claude's own stats keep all-time totals after transcripts are
// deleted). Prompts, hours and lines come from the transcripts still on disk.

import type { ModelStat, Spend } from '../report-types.ts'
import type { ClaudeStats } from '../sources/claudeStats.ts'
import { prettyModel } from './modelName.ts'
import { dayKey } from '../util/text.ts'
import type { ClassifiedThread } from './classify.ts'

export function modelStats(classified: ClassifiedThread[], spend: Spend, claudeStats: ClaudeStats | null = null): ModelStat[] {
  type Acc = { source: ModelStat['source']; prompts: number; threads: Set<string>; days: Set<string>; first: number; last: number; ms: number; lines: number; follow: number; steers: number; projects: Map<string, number> }
  const by = new Map<string, Acc>()
  for (const { thread: t, humans } of classified) {
    if (t.recovered) continue
    const kind = new Map(humans.map((h) => [h.idx, h.c.kind]))
    for (let i = 0; i < t.events.length; i++) {
      const e = t.events[i]
      if (e.k === 'a' && e.model) {
        const a = by.get(e.model)
        if (a) {
          a.ms += e.ms || 0
          for (const [, add] of e.edits || []) a.lines += add
        }
        continue
      }
      if (e.k !== 'h') continue
      // the model of the turn that answered this prompt
      let model: string | undefined
      for (let j = i + 1; j < t.events.length && t.events[j].k === 'a'; j++) model ||= (t.events[j] as { model?: string }).model
      if (!model || model === 'unknown') continue
      const a = by.get(model) || { source: t.source, prompts: 0, threads: new Set<string>(), days: new Set<string>(), first: e.t, last: e.t, ms: 0, lines: 0, follow: 0, steers: 0, projects: new Map<string, number>() }
      a.prompts++
      a.threads.add(t.id)
      a.days.add(dayKey(e.t))
      a.first = Math.min(a.first, e.t)
      a.last = Math.max(a.last, e.t)
      a.projects.set(t.project, (a.projects.get(t.project) || 0) + 1)
      const k = kind.get(i)
      if (k && k !== 'ask') a.follow++
      if (k === 'steer') a.steers++
      by.set(model, a)
    }
  }
  // Claude's daily stats know which days each model ran, beyond the transcripts on disk
  const statDays = new Map<string, string[]>()
  for (const [date, byModel] of Object.entries(claudeStats?.dailyTokens || {}))
    for (const [m, n] of Object.entries(byModel)) if (n > 0) statDays.set(m, [...(statDays.get(m) || []), date])
  const noon = (d: string) => new Date(`${d}T12:00:00`).getTime()
  const tokenTotal = spend.models.reduce((a, m) => a + m.tokens, 0) || 1
  return spend.models
    .filter((m) => m.model !== 'unknown' && m.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 6)
    .map((c) => {
      const a = by.get(c.model)
      const sd = statDays.get(c.model) || []
      const days = new Set([...(a?.days || []), ...sd])
      const firsts = [a?.first, ...sd.map(noon)].filter((x): x is number => !!x)
      const lasts = [a?.last, ...sd.map(noon)].filter((x): x is number => !!x)
      return {
        model: c.model,
        label: prettyModel(c.model),
        source: c.source,
        prompts: a?.prompts ?? 0,
        share: c.tokens / tokenTotal,
        threads: a?.threads.size ?? 0,
        days: days.size,
        first: firsts.length ? Math.min(...firsts) : 0,
        last: lasts.length ? Math.max(...lasts) : 0,
        agentHours: (a?.ms ?? 0) / 3_600_000,
        linesAdded: a?.lines ?? 0,
        tokens: c.tokens,
        usd: c.usd,
        steerRate: a && a.follow >= 30 ? a.steers / a.follow : null,
        topProject: a ? ([...a.projects.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '') : '',
      }
    })
}
