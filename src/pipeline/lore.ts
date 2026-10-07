// The lore: specific moments from your history you have probably forgotten. Each
// entry is found by a rule and links to the message behind it.

import type { SourceName } from '../types.ts'
import type { Era, Example, LoreEntry, Report } from '../report-types.ts'
import type { HumanEvent, ThreadRecord } from '../types.ts'
import { PLEASE, THANKS } from '../util/lang.ts'
import { hasSlur, looksPasted } from '../util/safety.ts'
import { clip, dayKey, monthKey, wordCount, stripPlaceholders } from '../util/text.ts'
import type { ClassifiedThread } from './classify.ts'
import { prettyModel } from './modelName.ts'
import { sourceLabel } from '../sources/registry.ts'

const DAY = 86_400_000
const key = (t: ThreadRecord) => `${t.source}:${t.id}`
const ex = (t: ThreadRecord, idx: number, n = 220): Example => {
  const e = t.events[idx] as HumanEvent
  return { ref: { thread: key(t), ev: idx }, text: clip(e.text, n), project: t.project, at: e.t, source: t.source, safe: !hasSlur(e.text) }
}
const fmt = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const time = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(' ', '')
const quotable = (s: string) => !hasSlur(s) && !looksPasted(s) && wordCount(s) >= 3 && wordCount(s) <= 120

interface P {
  t: ThreadRecord
  idx: number
  ev: HumanEvent
}

export function buildLore(r: Report, classified: ClassifiedThread[]): { lore: LoreEntry[]; eras: Era[] } {
  const all: P[] = []
  for (const c of classified) {
    if (c.thread.approxTimes) continue
    for (const h of c.humans) all.push({ t: c.thread, idx: h.idx, ev: h.ev })
  }
  all.sort((a, b) => a.ev.t - b.ev.t)
  const out: LoreEntry[] = []
  if (!all.length) return { lore: out, eras: [] }
  const end = all[all.length - 1].ev.t
  const firstQuotable = (ps: P[]) => ps.find((p) => quotable(p.ev.text))
  const lastQuotable = (ps: P[]) => [...ps].reverse().find((p) => quotable(p.ev.text))

  // Origins: how the biggest projects started
  const byProject = new Map<string, P[]>()
  for (const p of all) byProject.set(p.t.project, [...(byProject.get(p.t.project) || []), p])
  const big = [...byProject.entries()].filter(([name]) => name !== 'scratch' && name !== '~').sort((a, b) => b[1].length - a[1].length)
  // A project first seen soon after a tool's records begin may have started in the gap
  // before them; say "on record" there instead of claiming its first prompt.
  const recGap = r.coverage?.gap ?? null
  for (const [name, ps] of big.slice(0, 3)) {
    const first = firstQuotable(ps)
    if (!first) continue
    const unsure = recGap && ps[0].ev.t < recGap.to + 60 * DAY
    // one number per project across the report: the project table's count
    const count = (r.projects?.find((p) => p.name === name)?.prompts ?? ps.length).toLocaleString('en-US')
    out.push(
      unsure
        ? { key: `origin-${name}`, kicker: 'Origins', title: `${name}, as far back as lore can see`, body: `The earliest prompt on record for it, ${count} prompts ago. Claude Code’s prompts from before ${fmt(recGap.to)} weren’t kept, so it may go back further.`, at: first.ev.t, example: ex(first.t, first.idx) }
        : { key: `origin-${name}`, kicker: 'Origins', title: `How ${name} started`, body: `${count} prompts later, this was the first one.`, at: first.ev.t, example: ex(first.t, first.idx) },
    )
  }

  // Ghost projects: real effort, then silence
  for (const [name, ps] of big) {
    const last = ps[ps.length - 1]
    if (ps.length < 40 || end - last.ev.t < 30 * DAY) continue
    const q = lastQuotable(ps)
    if (!q) continue
    out.push({ key: `ghost-${name}`, kicker: 'Last seen', title: `The last thing you said to ${name}`, body: `${(r.projects?.find((p) => p.name === name)?.prompts ?? ps.length).toLocaleString('en-US')} prompts, then nothing for ${Math.round((end - last.ev.t) / DAY)} days.`, at: q.ev.t, example: ex(q.t, q.idx) })
    if (out.filter((e) => e.kicker === 'Last seen').length >= 2) break
  }

  // The quiet spell: the longest gap between active days, and what broke it
  const days = [...new Set(all.map((p) => dayKey(p.ev.t)))].sort()
  let gap = { days: 0, from: '', to: '' }
  for (let i = 1; i < days.length; i++) {
    const a = new Date(`${days[i - 1]}T12:00:00`).getTime()
    const b = new Date(`${days[i]}T12:00:00`).getTime()
    // a silence inside the window where a tool's prompts weren't kept isn't a real silence
    if (recGap && a < recGap.to && b > recGap.from) continue
    const d = Math.round((b - a) / DAY) - 1
    if (d > gap.days) gap = { days: d, from: days[i - 1], to: days[i] }
  }
  if (gap.days >= 4) {
    const back = firstQuotable(all.filter((p) => dayKey(p.ev.t) === gap.to))
    if (back) out.push({ key: 'quiet', kicker: 'The quiet spell', title: `${gap.days} days without a single prompt`, body: `You went quiet after ${fmt(new Date(`${gap.from}T12:00:00`).getTime())}. This is what you said when you came back.`, at: back.ev.t, example: ex(back.t, back.idx) })
  }

  // The latest night: the prompt furthest past midnight, before dawn
  const night = all.filter((p) => {
    const h = new Date(p.ev.t).getHours()
    return h >= 1 && h < 5 && quotable(p.ev.text)
  })
  const latest = night.sort((a, b) => minutesPastMidnight(b.ev.t) - minutesPastMidnight(a.ev.t))[0]
  if (latest) out.push({ key: 'latest', kicker: 'The latest night', title: `${time(latest.ev.t)}, still going`, body: `The latest you’ve been prompting${recGap ? ' on record' : ''}, on ${fmt(latest.ev.t)}.`, at: latest.ev.t, example: ex(latest.t, latest.idx) })

  // The marathon: the longest unbroken session (no gap over 45 minutes)
  let best = { ms: 0, start: 0, count: 0, project: '' }
  let s = 0
  for (let i = 1; i <= all.length; i++) {
    if (i === all.length || all[i].ev.t - all[i - 1].ev.t > 45 * 60_000) {
      const ms = all[i - 1].ev.t - all[s].ev.t
      if (ms > best.ms) {
        const counts = new Map<string, number>()
        for (let k = s; k < i; k++) counts.set(all[k].t.project, (counts.get(all[k].t.project) || 0) + 1)
        best = { ms, start: s, count: i - s, project: [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0] }
      }
      s = i
    }
  }
  if (best.ms >= 3 * 3600_000) {
    const p = all[best.start]
    const hours = Math.floor(best.ms / 3600_000)
    const mins = Math.round((best.ms % 3600_000) / 60000)
    out.push({ key: 'marathon', kicker: 'The marathon', title: `${hours}h ${mins}m without a break`, body: `${best.count} prompts on ${fmt(p.ev.t)}, never more than 45 minutes apart, mostly on ${best.project}. It started like this.`, at: p.ev.t, example: quotable(p.ev.text) ? ex(p.t, p.idx) : undefined })
  }

  // First contact with each tool, by the earliest evidence of use (Claude Code's own config
  // knows when it was first launched, even when those prompts are gone)
  const fu = r.coverage?.firstUse
  const order = (Object.entries(fu || {}) as [SourceName, number | null][]).filter((e): e is [SourceName, number] => e[1] != null).sort((a, b) => a[1] - b[1]).map(([s]) => s)
  const NTH = ['second', 'third', 'fourth', 'fifth', 'sixth']
  order.slice(1).forEach((next, k) => {
    const first = order[0]
    const firstPrompt = all.find((p) => p.t.source === next)
    const exact = r.coverage.recordFrom[next] === fu[next]
    const days = Math.round((fu[next]! - fu[first]!) / DAY)
    out.push({
      key: k ? `tool-${next}` : 'second-tool',
      kicker: `Enter the ${NTH[k] ?? 'next'} tool`,
      title: days < 1 ? `${sourceLabel(next)} joins the same day as ${sourceLabel(first)}` : `${sourceLabel(next)} joins, ${days} day${days === 1 ? '' : 's'} after ${sourceLabel(first)}`,
      body: `${sourceLabel(first)} since ${fmt(fu[first]!)}${first === 'claude-code' && recGap ? ' (first launched on this machine)' : ''}; ${exact ? `your first prompt to ${sourceLabel(next)} was on ${fmt(fu[next]!)}` : `${sourceLabel(next)} since ${fmt(fu[next]!)}`}.`,
      at: fu[next]!,
      example: exact && firstPrompt && quotable(firstPrompt.ev.text) ? ex(firstPrompt.t, firstPrompt.idx) : undefined,
    })
  })

  // Habits: the prompt you typed most, and your manners
  const repeats = new Map<string, number>()
  for (const p of all) {
    const norm = stripPlaceholders(p.ev.text).toLowerCase().replace(/[.!?]+$/, '')
    if (wordCount(norm) <= 6 && norm.length >= 2 && !hasSlur(norm)) repeats.set(norm, (repeats.get(norm) || 0) + 1)
  }
  const top = [...repeats.entries()].sort((a, b) => b[1] - a[1])[0]
  if (top && top[1] >= 8) out.push({ key: 'repeat', kicker: 'Habit', title: `You typed “${top[0]}” ${top[1].toLocaleString('en-US')} times`, body: 'Word for word. Your most repeated prompt.', at: end - 1, undated: true })
  const please = all.filter((p) => PLEASE.test(p.ev.text)).length
  const thanks = all.filter((p) => THANKS.test(p.ev.text)).length
  if (please + thanks >= 10) out.push({ key: 'manners', kicker: 'Manners', title: `${please.toLocaleString('en-US')} pleases, ${thanks.toLocaleString('en-US')} thank-yous`, body: please > thanks * 3 ? 'You ask nicely. You rarely say thanks.' : 'Polite to the machines, for when they remember.', at: end - 2, undated: true })

  // Records worth remembering
  const file = r.deep.work.topFiles[0]
  if (file && file.turns >= 20) out.push({ key: 'file', kicker: 'The file that wouldn’t die', title: `${file.file.split(/[\\/]/).pop()}, edited in ${file.turns} separate turns`, body: `${file.project}/${file.file}. ${file.lines.toLocaleString('en-US')} lines changed, a few at a time.`, at: end - 3, undated: true })
  const lt = r.deep.work.longestTurn
  if (lt && lt.min >= 60) out.push({ key: 'job', kicker: 'The longest job', title: `An agent worked ${(lt.min / 60).toFixed(1)} hours on one prompt`, body: `On “${lt.title}” in ${lt.project}, without you.`, at: end - 4, undated: true })

  // Eras: what you worked on, and with which model, month by month. A prompt's model is the
  // model of the turn that answered it. Sessions rebuilt from Claude's prompt history have
  // none, so a month only names a model when no unrecorded prompts could change the answer.
  const months = new Map<string, { projects: Map<string, number>; models: Map<string, number>; tools: Map<string, number>; prompts: number; known: number }>()
  for (const c of classified) {
    const ev = c.thread.events
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i]
      if (e.k !== 'h') continue
      const m = monthKey(e.t)
      const cur = months.get(m) || { projects: new Map(), models: new Map(), tools: new Map(), prompts: 0, known: 0 }
      cur.prompts++
      cur.projects.set(c.thread.project, (cur.projects.get(c.thread.project) || 0) + 1)
      cur.tools.set(c.thread.source, (cur.tools.get(c.thread.source) || 0) + 1)
      let model: string | undefined
      for (let j = i + 1; j < ev.length && ev[j].k === 'a'; j++) model ||= (ev[j] as { model?: string }).model
      if (model && model !== 'unknown') {
        cur.known++
        cur.models.set(model, (cur.models.get(model) || 0) + 1)
      }
      months.set(m, cur)
    }
  }
  const top1 = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const eras: Era[] = [...months.entries()]
    .filter(([, v]) => v.prompts > 0)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => {
      // name the month's model only if it stays on top even if every unrecorded prompt went to the runner-up
      const [first, second] = [...v.models.values()].sort((a, b) => b - a)
      const sure = first != null && first - (second ?? 0) > v.prompts - v.known
      return { month, project: top1(v.projects) || '', model: sure ? top1(v.models) : null, tool: sourceLabel(top1(v.tools) || 'claude-code'), prompts: v.prompts }
    })
  for (let i = 1; i < eras.length; i++) {
    const prev = eras[i - 1]
    const cur = eras[i]
    if (prev.model && cur.model && prev.model !== cur.model && cur.prompts >= 100 && !out.some((e) => e.key.startsWith('switch-') && Math.abs(e.at - Date.parse(`${cur.month}-01`)) < 60 * DAY)) {
      out.push({ key: `switch-${cur.month}`, kicker: 'The switch', title: `${prettyModel(cur.model)} takes over from ${prettyModel(prev.model)}`, body: `Your most-used model changed in ${new Date(`${cur.month}-15`).toLocaleString('en-US', { month: 'long', year: 'numeric' })}.`, at: Date.parse(`${cur.month}-01T12:00:00`) })
    }
  }

  out.sort((a, b) => a.at - b.at)
  return { lore: out, eras }
}

function minutesPastMidnight(t: number) {
  const d = new Date(t)
  return d.getHours() * 60 + d.getMinutes()
}
