// The numbers people screenshot that the agents' own /stats screens don't show: what your
// agents kept telling you, the prompt that cost the most and the one that did the most,
// how many words of yours became how many lines, and how many agents ran at once. All
// counted from transcripts; nothing estimated.

import type { Extras, Example } from '../report-types.ts'
import type { HumanEvent, ThreadRecord } from '../types.ts'
import { hasSlur, looksPasted } from '../util/safety.ts'
import { clip, wordCount } from '../util/text.ts'
import type { ClassifiedThread } from './classify.ts'
import { modelFamily } from './modelName.ts'
import { costOf } from './spend.ts'

/** What agents say back, counted once per reply. */
const CATCHPHRASES: { key: string; label: string; re: RegExp }[] = [
  { key: 'absolutely', label: 'You’re absolutely right', re: /you'?re absolutely right/i },
  { key: 'right', label: 'You’re right', re: /\byou'?re (?:right|correct)\b/i },
  { key: 'catch', label: 'Good catch', re: /\bgood catch\b/i },
  { key: 'perfect', label: 'Perfect!', re: /^perfect[!.]/i },
  { key: 'question', label: 'Great question', re: /\bgreat question\b/i },
  { key: 'sorry', label: 'Sorry about that', re: /\b(i apologi[sz]e|sorry (about|for) (that|the confusion)|my apologies)\b/i },
]

const key = (t: ThreadRecord) => `${t.source}:${t.id}`
const ex = (t: ThreadRecord, idx: number, n = 200): Example => {
  const e = t.events[idx] as HumanEvent
  return { ref: { thread: key(t), ev: idx }, text: clip(e.text, n), project: t.project, at: e.t, source: t.source, safe: !hasSlur(e.text) }
}
const month = (t: number) => new Date(t).toISOString().slice(0, 7)

export function buildExtras(classified: ClassifiedThread[], wordsTyped: number, linesAdded: number): Extras {
  const phrases = new Map<string, { count: number; byModel: Record<string, number>; first: number; last: number }>()
  let replies = 0
  let priciest: Extras['priciest'] = null
  let bestValue: Extras['bestValue'] = null
  // agent working spans across every thread, for "most agents at once"
  const spans: [number, number][] = []

  for (const { thread: t } of classified) {
    if (t.recovered) continue
    let turn: { idx: number; text: string; usd: number; lines: number; start: number; end: number; model?: string } | null = null
    const close = () => {
      if (!turn) return
      if (turn.end > turn.start) spans.push([turn.start, turn.end])
      const h = t.events[turn.idx] as HumanEvent
      const quotable = !looksPasted(h.text) && !hasSlur(h.text)
      if (quotable && turn.usd > (priciest?.usd ?? 0)) priciest = { usd: turn.usd, words: wordCount(h.text), model: turn.model ? modelFamily(turn.model) : null, example: ex(t, turn.idx) }
      const w = wordCount(h.text)
      if (quotable && w > 0 && w <= 6 && turn.lines > (bestValue?.lines ?? 0)) bestValue = { lines: turn.lines, words: w, example: ex(t, turn.idx) }
      turn = null
    }
    t.events.forEach((e, idx) => {
      if (e.k === 'h') {
        close()
        turn = { idx, text: e.text, usd: 0, lines: 0, start: e.t, end: e.t }
        return
      }
      replies++
      for (const p of CATCHPHRASES) {
        if (!p.re.test(e.text.slice(0, 600))) continue
        const cur = phrases.get(p.key) || { count: 0, byModel: {}, first: e.t, last: e.t }
        cur.count++
        const m = e.model ? modelFamily(e.model) : 'unknown'
        cur.byModel[m] = (cur.byModel[m] || 0) + 1
        cur.first = Math.min(cur.first, e.t)
        cur.last = Math.max(cur.last, e.t)
        phrases.set(p.key, cur)
      }
      if (!turn) return
      turn.end = Math.max(turn.end, e.t)
      if (e.tok && e.model) turn.usd += costOf(e.model, { in: e.tok[0], cached: e.tok[1], out: e.tok[2], write: e.tok[3] || 0, write1h: e.tok[4] || 0 }) ?? 0
      if (e.model) turn.model = e.model
      for (const [, a] of e.edits || []) turn.lines += a
    })
    close()
  }

  // the most turns running at the same moment, across threads and tools
  const marks = spans.flatMap(([a, b]): [number, number][] => [
    [a, 1],
    [b, -1],
  ])
  marks.sort((x, y) => x[0] - y[0] || x[1] - y[1])
  let live = 0
  let peak = 0
  let peakAt = 0
  for (const [at, d] of marks) {
    live += d
    if (live > peak) {
      peak = live
      peakAt = at
    }
  }

  return {
    replies,
    catchphrases: CATCHPHRASES.map((p) => ({ key: p.key, label: p.label, ...phrases.get(p.key)! }))
      .filter((p) => p.count > 0)
      .map((p) => ({ key: p.key, label: p.label, count: p.count, byModel: p.byModel, firstMonth: month(p.first), lastMonth: month(p.last) }))
      .sort((a, b) => b.count - a.count),
    priciest: priciest && (priciest as NonNullable<Extras['priciest']>).usd >= 0.5 ? priciest : null,
    bestValue: bestValue && (bestValue as NonNullable<Extras['bestValue']>).lines >= 50 ? bestValue : null,
    leverage: wordsTyped >= 200 && linesAdded >= 200 ? { words: wordsTyped, lines: linesAdded, perWord: linesAdded / wordsTyped } : null,
    parallel: peak >= 2 ? { peak, at: peakAt } : null,
  }
}
