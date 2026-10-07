import { VERSION } from '../config.ts'
import type { DeepThread, Example, Moment, ProjectFact, Report, ThemeFact } from '../report-types.ts'
import type { HumanEvent, SourceName, Surface, ThreadRecord } from '../types.ts'
import { CJK, STOPWORDS_X } from '../util/lang.ts'
import { isFeatureSafe, isShouting, hasProfanity, looksPasted } from '../util/safety.ts'
import { clip, dayKey, monthKey, stripPlaceholders, weekKey, wordCount } from '../util/text.ts'
import { pickArchetype } from './archetype.ts'
import { STEER_THEMES, classifyThread, type ClassifiedThread } from './classify.ts'
import { buildDeep } from './deep.ts'
import { buildLore } from './lore.ts'
import type { ScanResult } from './scan.ts'
import { modelStats } from './models.ts'
import { perSource, SOURCE_KEYS, sourceIndex, sourceLabel } from '../sources/registry.ts'
import { buildExtras } from './extras.ts'
import { buildSpend, type PlanInfo } from './spend.ts'

const DAY = 86_400_000
export const threadKey = (t: ThreadRecord) => `${t.source}:${t.id}`


export const DEFINITIONS: Record<string, string> = {
  thread: 'A main conversation with an agent. Subagent transcripts, automated (SDK/exec) runs and copied fork history are excluded.',
  prompt: 'A message you sent. Harness-injected context, tool results, slash commands and messages from other agents are excluded.',
  words: 'Words you wrote in prompts. Pasted logs, JSON and SQL output are left out, and any one prompt counts for at most 600 words.',
  heated: 'Prompts in all caps or with profanity. Frustration usually means something failed more than once.',
  activeDays: 'Calendar days (local time) with at least one prompt. Not hours worked: idle time between messages is never counted.',
  streak: 'Longest run of consecutive active days.',
  steer: 'A follow-up that redirects the agent: sent right after an interruption, opening with "no / actually / wait…", or containing a correction phrase. A rule-based reading, not a judgment of who was right.',
  approval: 'A short follow-up that opens with "yes / perfect / go ahead…". Expressed approval only; it does not prove the work was correct.',
  steerRate: 'Steers divided by all follow-ups (every prompt after the agent first replied).',
  interrupt: 'Times you stopped the agent mid-turn.',
  model: "Share of agent messages written by each model. This is usage, not quality: it reflects what you chose, not how well a model did.",
  toolCalls: 'Actions agents took on your behalf (shell commands, edits, searches) in main threads.',
  phrase: 'Three-to-five-word phrases you used in at least four different threads.',
  night: 'Prompts sent between 10pm and 4am local time.',
  agentHours:
    "Agent working time as each harness recorded it (Claude Code's turn durations, Codex's task durations, interrupted tasks included). Where a harness recorded none (Codex before 0.119, most other agents), it runs from your prompt through the agent's last event. Either way, a stretch with no agent activity counts for at most 30 minutes (a laptop asleep, a wait on subagents). Prompts whose transcripts are gone have no agent time on record, so with many of them the total is a floor. Not your time.",
  agentHoursEst:
    'Agent hours plus an estimate for the prompts with none on record: the time from each to your next prompt in the same conversation (at most 30 minutes), at the share of that time agents worked in your timed conversations. A rough guide, not a measurement.',
  subagentHours: 'Time subagents worked (Claude Code subagents, Codex spawned agents), from their own transcripts, each turn once. They work alongside the main agent, so these hours are on top of agent hours.',
  lines: 'Lines added and removed by agent edits and patches. Lockfiles and build output are left out. Claude edits count old and new text, so a one-line change counts as +1/−1.',
  tokens: "Tokens each harness logged: fresh input, cached input (re-read context, much cheaper) and output.",
  claudeCost: "API-equivalent cost Claude Code computed for its own sessions at list prices. On a subscription you didn't pay this; it's what the same usage would cost through the API.",
  limits: 'Codex logs how much of your plan window each turn used. A week at 100% means you hit the weekly limit.',
  swear: 'Prompts containing a swear word (fuck, shit, damn, wtf…). Slurs are never counted or shown.',
  steerByModel: "Steer rate for follow-ups to each model's work. Models were used at different times on different tasks, so this describes your history, not the models.",
  intent: 'What a conversation opened by asking for, from the first keyword family the opening prompt matches (fix, review, explain, plan, design, data, refactor, deploy, tests, writing, change, build).',
}

function example(t: ThreadRecord, idx: number, n = 280): Example {
  const ev = t.events[idx] as HumanEvent
  return { ref: { thread: threadKey(t), ev: idx }, text: clip(ev.text, n), project: t.project, at: ev.t, source: t.source, safe: isFeatureSafe(ev.text) }
}

export function buildReport(scan: ScanResult): { report: Report; classified: ClassifiedThread[] } {
  const threads = scan.threads.filter((t) => !t.approxTimes || t.events.length) // legacy threads keep approximate times
  const classified = threads.map(classifyThread)

  let prompts = 0
  let words = 0
  let heated = 0
  let agentTurns = 0
  let toolCalls = 0
  let interrupts = 0
  let slash = 0
  const kinds = { ask: 0, steer: 0, approve: 0, followup: 0 }
  const days = new Map<string, number>()
  const daysBySource = new Map<string, number[]>()
  const repeats = new Map<string, { text: string; count: number; threads: Set<string>; first: number; last: number; at: { t: ThreadRecord; idx: number } }>()
  const dayProjects = new Map<string, Map<string, number>>()
  const hours = new Array(24).fill(0)
  const weekdays = new Array(7).fill(0)
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0))
  const months = new Map<string, number[]>()
  const wordsList: number[] = []
  let questions = 0
  let oneLiners = 0
  const themeHits = new Map<string, { t: ThreadRecord; idx: number }[]>()
  const steerExamples: { t: ThreadRecord; idx: number; score: number }[] = []
  const surfaces: Record<Surface, number> = { cli: 0, desktop: 0, ide: 0, chat: 0, automated: 0 }
  const bySource = new Map<SourceName, { prompts: number; threads: number; first: number | null; last: number | null }>()
  let longest: { t: ThreadRecord; idx: number; w: number } | null = null
  let firstP: { t: ThreadRecord; idx: number } | null = null
  let latestP: { t: ThreadRecord; idx: number } | null = null

  type At = { t: ThreadRecord; idx: number }
  type ProjAcc = { prompts: number; threads: Set<string>; days: Set<string>; first: number; last: number; steers: number; follow: number; sources: Set<SourceName>; themes: Map<string, number>; asks: At[]; weeks: Map<string, number>; firstAt?: At; lastAt?: At }
  const proj = new Map<string, ProjAcc>()
  const modelCounts = new Map<string, { n: number; source: SourceName }>()

  for (const { thread: t, humans } of classified) {
    surfaces[t.surface]++
    const bs = bySource.get(t.source) || { prompts: 0, threads: 0, first: null, last: null }
    bs.threads++
    bySource.set(t.source, bs)
    toolCalls += t.toolCalls
    interrupts += t.interrupts
    slash += t.slashCommands
    agentTurns += t.events.filter((e) => e.k === 'a').length
    for (const [m, n] of Object.entries(t.models)) {
      const cur = modelCounts.get(m) || { n: 0, source: t.source }
      cur.n += n
      modelCounts.set(m, cur)
    }
    const p: ProjAcc = proj.get(t.project) ?? { prompts: 0, threads: new Set(), days: new Set(), first: Infinity, last: 0, steers: 0, follow: 0, sources: new Set(), themes: new Map(), asks: [], weeks: new Map() }
    proj.set(t.project, p)
    p.threads.add(threadKey(t))
    p.sources.add(t.source)

    for (const { ev, idx, c } of humans) {
      prompts++
      bs.prompts++
      bs.first = Math.min(bs.first ?? Infinity, ev.t)
      bs.last = Math.max(bs.last ?? 0, ev.t)
      const w = wordCount(ev.text)
      const pasted = looksPasted(ev.text)
      if (!pasted) words += Math.min(w, 600)
      if (hasProfanity(ev.text) || isShouting(ev.text)) heated++
      wordsList.push(w)
      if (/\?\s*$/.test(ev.text.trim())) questions++
      if (w <= 8) oneLiners++
      kinds[c.kind]++
      const d = new Date(ev.t)
      const dk = dayKey(ev.t)
      days.set(dk, (days.get(dk) || 0) + 1)
      const ds = daysBySource.get(dk) || SOURCE_KEYS.map(() => 0)
      ds[sourceIndex(t.source)]++
      daysBySource.set(dk, ds)
      // Word-for-word repeats: short prompts you kept sending.
      if (w <= 30 && !pasted) {
        const norm = stripPlaceholders(ev.text).toLowerCase().replace(/[.!?,\s]+$/, '').trim()
        if (norm && !norm.startsWith('/')) {
          const r = repeats.get(norm) || { text: stripPlaceholders(ev.text), count: 0, threads: new Set(), first: ev.t, last: ev.t, at: { t, idx } }
          r.count++
          r.threads.add(threadKey(t))
          r.first = Math.min(r.first, ev.t)
          r.last = Math.max(r.last, ev.t)
          repeats.set(norm, r)
        }
      }
      const dp = dayProjects.get(dk) || new Map()
      dp.set(t.project, (dp.get(t.project) || 0) + 1)
      dayProjects.set(dk, dp)
      if (!t.approxTimes) {
        hours[d.getHours()]++
        weekdays[(d.getDay() + 6) % 7]++
        grid[(d.getDay() + 6) % 7][d.getHours()]++
      }
      const mk = monthKey(ev.t)
      const mo = months.get(mk) || SOURCE_KEYS.map(() => 0)
      mo[sourceIndex(t.source)]++
      months.set(mk, mo)

      p.prompts++
      p.days.add(dk)
      const wk = weekKey(ev.t)
      p.weeks.set(wk, (p.weeks.get(wk) || 0) + 1)
      const plain = !pasted && isFeatureSafe(ev.text) && w >= 3
      const atT = (x: At) => (x.t.events[x.idx] as HumanEvent).t
      if (plain && (!p.firstAt || ev.t < atT(p.firstAt))) p.firstAt = { t, idx }
      if (plain && (!p.lastAt || ev.t > atT(p.lastAt))) p.lastAt = { t, idx }
      p.first = Math.min(p.first, ev.t)
      p.last = Math.max(p.last, ev.t)
      if (c.kind === 'ask' && w >= 6 && w <= 400 && isFeatureSafe(ev.text)) p.asks.push({ t, idx })
      if (c.kind !== 'ask') p.follow++
      if (c.kind === 'steer') {
        p.steers++
        for (const th of c.themes) {
          p.themes.set(th, (p.themes.get(th) || 0) + 1)
          const list = themeHits.get(th) || []
          list.push({ t, idx })
          themeHits.set(th, list)
        }
        if (w >= 6 && w <= 90 && !pasted) steerExamples.push({ t, idx, score: (ev.afterInterrupt ? 2 : 0) + Math.min(w, 40) / 20 + c.themes.length })
      }
      const featurable = !pasted && isFeatureSafe(ev.text) && w >= 4
      if (w <= 1500 && featurable && isProse(ev.text) && (!longest || w > longest.w)) longest = { t, idx, w }
      if (featurable && (!firstP || ev.t < (firstP.t.events[firstP.idx] as HumanEvent).t)) firstP = { t, idx }
      if (featurable && (!latestP || ev.t > (latestP.t.events[latestP.idx] as HumanEvent).t)) latestP = { t, idx }
    }
  }

  // Calendar facts
  const dayKeys = [...days.keys()].sort()
  const streak = longestStreak(dayKeys)
  let busiest = { date: '', prompts: 0, projects: [] as string[] }
  for (const [d, n] of days) if (n > busiest.prompts) busiest = { date: d, prompts: n, projects: [] }
  if (busiest.date) busiest.projects = [...(dayProjects.get(busiest.date) || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => x[0])
  // Day keys are local dates; parse them as local noon, not UTC midnight.
  const localDay = (k: string) => new Date(`${k}T12:00:00`).getTime()
  const from = dayKeys.length ? localDay(dayKeys[0]) : Date.now()
  const to = dayKeys.length ? localDay(dayKeys[dayKeys.length - 1]) : Date.now()
  const timed = hours.reduce((a, b) => a + b, 0) || 1
  const night = [22, 23, 0, 1, 2, 3].reduce((s, h) => s + hours[h], 0)
  const early = [5, 6, 7].reduce((s, h) => s + hours[h], 0)
  const weekend = weekdays[5] + weekdays[6]

  // Projects, ranked by how much of you went into them
  const projects: ProjectFact[] = [...proj.entries()]
    .filter(([, p]) => p.prompts > 0)
    .map(([name, p]) => ({
      name,
      prompts: p.prompts,
      threads: p.threads.size,
      activeDays: p.days.size,
      first: p.first,
      last: p.last,
      steers: p.steers,
      steerRate: p.follow ? p.steers / p.follow : 0,
      sources: [...p.sources],
      topThemes: [...p.themes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0]),
      asks: spreadPick(p.asks, (x) => (x.t.events[x.idx] as HumanEvent).t, 3).map((x) => example(x.t, x.idx, 220)),
      weeks: Object.fromEntries(p.weeks),
      firstAsk: p.firstAt && example(p.firstAt.t, p.firstAt.idx, 160),
      lastWords: p.lastAt && example(p.lastAt.t, p.lastAt.idx, 160),
    }))
    .sort((a, b) => b.prompts - a.prompts)

  const followups = kinds.steer + kinds.approve + kinds.followup
  const themes: ThemeFact[] = STEER_THEMES.map((d) => {
    const hits = themeHits.get(d.key) || []
    return {
      key: d.key,
      label: d.label,
      blurb: d.blurb,
      count: hits.length,
      share: kinds.steer ? hits.length / kinds.steer : 0,
      examples: spreadPick(
        hits.filter((h) => wordCount((h.t.events[h.idx] as HumanEvent).text) <= 80),
        (h) => (h.t.events[h.idx] as HumanEvent).t,
        4,
      ).map((h) => example(h.t, h.idx, 240)),
    }
  })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)

  const totalModel = [...modelCounts.values()].reduce((s, m) => s + m.n, 0) || 1
  const models = [...modelCounts.entries()]
    .map(([model, m]) => ({ model, messages: m.n, share: m.n / totalModel, source: m.source }))
    .sort((a, b) => b.messages - a.messages)

  const deepest: DeepThread[] = classified
    .map(({ thread: t, humans }) => {
      const firstIdx = humans[0]?.idx ?? 0
      return {
        key: threadKey(t),
        title: t.title || clip((t.events[firstIdx] as HumanEvent).text, 70),
        project: t.project,
        source: t.source,
        prompts: humans.length,
        steers: humans.filter((h) => h.c.kind === 'steer').length,
        days: new Set(humans.map((h) => dayKey(h.ev.t))).size,
        from: humans[0]?.ev.t ?? t.startedAt,
        to: humans[humans.length - 1]?.ev.t ?? t.endedAt,
        ref: { thread: threadKey(t), ev: firstIdx },
      }
    })
    .sort((a, b) => b.prompts - a.prompts)
    .slice(0, 6)

  const sortedWords = [...wordsList].sort((a, b) => a - b)
  const q = (p: number) => sortedWords[Math.min(sortedWords.length - 1, Math.floor(sortedWords.length * p))] || 0
  const steerEx = spreadPick(steerExamples.sort((a, b) => b.score - a.score).slice(0, 60), (s) => (s.t.events[s.idx] as HumanEvent).t, 6).map((s) => example(s.t, s.idx, 240))

  const report: Report = {
    version: VERSION,
    generatedAt: Date.now(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    coverage: {
      sources: scan.coverage,
      scanMs: scan.scanMs,
      filesParsed: scan.filesParsed,
      filesFromCache: scan.filesFromCache,
      sampled: false,
      from,
      to,
      surfaces,
      ...firstUseOf(bySource, scan.claudeFirstUse),
    },
    totals: {
      threads: threads.length,
      prompts,
      words,
      heated,
      agentTurns,
      toolCalls,
      activeDays: days.size,
      spanDays: Math.round((to - from) / DAY) + 1,
      projects: projects.length,
      interrupts,
      slashCommands: slash,
      asks: kinds.ask,
      steers: kinds.steer,
      approvals: kinds.approve,
      followups,
    },
    bySource: SOURCE_KEYS.map((s) => ({ source: s, label: sourceLabel(s), prompts: 0, threads: 0, first: null, last: null, ...bySource.get(s) })),
    streak,
    busiestDay: busiest,
    rhythm: {
      hours,
      weekdays,
      grid,
      peakHour: hours.indexOf(Math.max(...hours)),
      nightShare: night / timed,
      afterHoursShare: [18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5].reduce((s, h) => s + hours[h], 0) / timed,
      weekendShare: weekend / timed,
      earlyShare: early / timed,
    },
    months: [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, by]) => ({ month, by })),
    calendar: Object.fromEntries(days),
    calendarBySource: Object.fromEntries(daysBySource),
    quotes: [...repeats.values()]
      .filter((r) => r.count >= 3 && r.threads.size >= 2 && isFeatureSafe(r.text))
      .sort((a, b) => b.count - a.count)
      .slice(0, 16)
      .map((r) => ({ text: clip(r.text, 140), count: r.count, threads: r.threads.size, first: r.first, last: r.last, example: example(r.at.t, r.at.idx, 140) })),
    spend: null as unknown as Report['spend'],
    extras: null as unknown as Report['extras'],
    favoriteModels: [],
    records: records(classified),
    topWords: topWords(classified, projects.map((p) => p.name)),
    projects: projects.slice(0, 16),
    models,
    steering: {
      rate: followups ? kinds.steer / followups : 0,
      interruptsPer100: prompts ? (interrupts / prompts) * 100 : 0,
      approvalsShare: followups ? kinds.approve / followups : 0,
      themes,
      examples: steerEx,
    },
    style: {
      medianWords: q(0.5),
      p90Words: q(0.9),
      oneLinerShare: prompts ? oneLiners / prompts : 0,
      questionShare: prompts ? questions / prompts : 0,
      longest: longest ? example(longest.t, longest.idx, 360) : null,
      first: firstP ? example(firstP.t, firstP.idx, 280) : null,
      latest: latestP ? example(latestP.t, latestP.idx, 280) : null,
    },
    phrases: signaturePhrases(classified),
    deepest,
    moments: [],
    archetype: null as unknown as Report['archetype'],
    deep: null as unknown as Report['deep'],
    lore: [],
    eras: [],
    definitions: DEFINITIONS,
  }
  report.moments = pickMoments(report, classified)
  report.deep = buildDeep(classified, prompts, scan.claudeStats)
  report.deep.work.subagentHours = Object.values(scan.usage.subagentMs || {}).reduce((a, b) => a + b, 0) / 3.6e6
  report.spend = buildSpend(threads, scan.claudeStats, plansFor(report, scan.claudePlan), scan.usage)
  // one count of tokens everywhere: the ledger's, each API reply once
  const byModel = report.spend.models.map((m) => ({ model: m.model, input: m.input, cached: m.cached, output: m.output, total: m.tokens, source: m.source }))
  report.deep.tokens = {
    ...report.deep.tokens,
    input: byModel.reduce((a, m) => a + m.input, 0),
    cached: byModel.reduce((a, m) => a + m.cached, 0),
    output: byModel.reduce((a, m) => a + m.output, 0),
    byModel: byModel.sort((a, b) => b.total - a.total),
  }
  report.favoriteModels = modelStats(classified, report.spend, scan.claudeStats)
  report.extras = buildExtras(classified, report.totals.words, report.deep.work.linesAdded)
  report.archetype = pickArchetype(report, report.deep)
  Object.assign(report, buildLore(report, classified))
  return { report, classified }
}

const SESSION_GAP = 45 * 60_000

/** Sessions and the roughest day, from every prompt on record across both tools. */
function records(classified: ClassifiedThread[]): Report['records'] {
  type P = { t: ThreadRecord; idx: number; ev: HumanEvent; kind: string }
  const all: P[] = []
  for (const { thread: t, humans } of classified) if (!t.approxTimes) for (const h of humans) all.push({ t, idx: h.idx, ev: h.ev, kind: h.c.kind })
  all.sort((a, b) => a.ev.t - b.ev.t)
  let sessions = 0
  let ms = 0
  let best: { from: number; to: number; i0: number; i1: number } | null = null
  for (let i = 0; i < all.length; ) {
    let j = i
    while (j + 1 < all.length && all[j + 1].ev.t - all[j].ev.t <= SESSION_GAP) j++
    sessions++
    const d = all[j].ev.t - all[i].ev.t
    ms += d
    if (!best || d > best.to - best.from) best = { from: all[i].ev.t, to: all[j].ev.t, i0: i, i1: j }
    i = j + 1
  }
  let longestSession: Report['records']['longestSession'] = null
  if (best && best.to > best.from) {
    const ps = all.slice(best.i0, best.i1 + 1)
    const proj = new Map<string, number>()
    for (const p of ps) proj.set(p.t.project, (proj.get(p.t.project) || 0) + 1)
    const opener = ps.find((p) => isFeatureSafe(p.ev.text) && !looksPasted(p.ev.text) && wordCount(p.ev.text) >= 3)
    longestSession = { minutes: (best.to - best.from) / 60_000, prompts: ps.length, from: best.from, to: best.to, project: [...proj.entries()].sort((a, b) => b[1] - a[1])[0][0], example: opener && example(opener.t, opener.idx, 220) }
  }
  // rock bottom: the day with the most heat (swears and caps count double)
  const days = new Map<string, { swears: number; caps: number; steers: number; prompts: number; hot?: P; heat: number }>()
  for (const p of all) {
    const k = dayKey(p.ev.t)
    const d = days.get(k) || { swears: 0, caps: 0, steers: 0, prompts: 0, heat: 0 }
    const sw = hasProfanity(p.ev.text)
    const cp = isShouting(p.ev.text)
    d.prompts++
    if (sw) d.swears++
    if (cp) d.caps++
    if (p.kind === 'steer') d.steers++
    const heat = (sw ? 2 : 0) + (cp ? 2 : 0) + (p.kind === 'steer' ? 1 : 0)
    if (heat >= 3 && isFeatureSafe(p.ev.text) && !looksPasted(p.ev.text) && wordCount(p.ev.text) <= 80 && (!d.hot || heat > d.heat)) {
      d.hot = p
      d.heat = heat
    }
    days.set(k, d)
  }
  const score = (d: { swears: number; caps: number; steers: number }) => d.swears * 2 + d.caps * 2 + d.steers
  const worst = [...days.entries()].filter(([, d]) => d.swears + d.caps > 0).sort((a, b) => score(b[1]) - score(a[1]))[0]
  return {
    sessions,
    sessionHours: ms / 3_600_000,
    longestSession,
    rockBottom: worst ? { date: worst[0], swears: worst[1].swears, caps: worst[1].caps, steers: worst[1].steers, prompts: worst[1].prompts, example: worst[1].hot && example(worst[1].hot.t, worst[1].hot.idx, 260) } : null,
  }
}

/** First use vs first prompt on record, per tool, and the gap between them for Claude Code. */
function firstUseOf(bySource: Map<SourceName, { first: number | null }>, claudeFirstUse: number | null) {
  const recordFrom = perSource<number | null>(() => null)
  for (const s of SOURCE_KEYS) recordFrom[s] = bySource.get(s)?.first ?? null
  const claudeFirst = claudeFirstUse != null && (recordFrom['claude-code'] == null || claudeFirstUse < recordFrom['claude-code']) ? claudeFirstUse : recordFrom['claude-code']
  const firstUse = { ...recordFrom, 'claude-code': claudeFirst }
  const gap = claudeFirst != null && recordFrom['claude-code'] != null && recordFrom['claude-code'] - claudeFirst > 7 * DAY ? { source: 'claude-code' as SourceName, from: claudeFirst, to: recordFrom['claude-code'] } : null
  return { firstUse, recordFrom, gap }
}

/** The plans this person is on, from Claude's config and Codex's own limit readings. */
function plansFor(r: Report, claude: string | null): PlanInfo[] {
  const out: PlanInfo[] = []
  if (claude && r.bySource[0].prompts) out.push({ source: 'claude-code', id: claude })
  const codex = r.deep.limits?.plan?.toLowerCase()
  if (codex) {
    const id = /pro/.test(codex) ? 'chatgpt-pro' : /plus/.test(codex) ? 'chatgpt-plus' : /team|business/.test(codex) ? 'chatgpt-business' : null
    if (id) out.push({ source: 'codex', id })
  }
  return out
}

/** Mostly sentences: few symbol-heavy lines, the way a person writes rather than pastes. */
function isProse(raw: string): boolean {
  const s = raw.replace(/https?:\/\/\S+/g, '')
  if (s.length < raw.length * 0.8) return false // mostly links
  const letters = (s.match(/[a-z]/gi) || []).length
  if (letters / Math.max(1, s.length) < 0.72) return false
  const lines = s.split('\n').filter((l) => l.trim())
  const noisy = lines.filter((l) => (l.match(/[{}<>\[\]|=;:\\/]/g) || []).length > l.length * 0.08).length
  return noisy <= Math.max(1, lines.length * 0.15)
}

function longestStreak(sortedDays: string[]) {
  let best = { days: 0, from: '', to: '' }
  let runStart = 0
  for (let i = 0; i < sortedDays.length; i++) {
    if (i > 0 && new Date(`${sortedDays[i]}T12:00:00`).getTime() - new Date(`${sortedDays[i - 1]}T12:00:00`).getTime() > DAY * 1.5) runStart = i
    const len = i - runStart + 1
    if (len > best.days) best = { days: len, from: sortedDays[runStart], to: sortedDays[i] }
  }
  return best
}

/** Picks n items spread across time rather than only the latest or longest. */
export function spreadPick<T>(items: T[], at: (x: T) => number, n: number): T[] {
  if (items.length <= n) return [...items].sort((a, b) => at(a) - at(b))
  const sorted = [...items].sort((a, b) => at(a) - at(b))
  const out: T[] = []
  for (let i = 0; i < n; i++) out.push(sorted[Math.floor(((i + 0.5) * sorted.length) / n)])
  return out
}

const STOP = new Set(
  'a an the and or but if then so to of in on at for with from by as is are was were be been it its this that these those i you we they he she me my your our their them us do does did done can could should would will just also not no yes ok okay please let lets let\'s get got make sure some any all more most very really there here what when where which who how why up out into over about than too again now still like want need think know see use using one two way thing things im i\'m it\'s that\'s dont don\'t can\'t cant'.split(
    ' ',
  ),
)

const COMMON = new Set(
  'have has had having go going goes gonna would should then them its because even only after before into well being other each both same new back right first last next much many such own off down while through every something anything everything nothing someone thing stuff kind lot bit actually maybe probably already instead without within across between under above below around which whose whom were what whats there theres where heres here this they the and for with that you your are not but can all just from was has have will one get how use also now out its it\'s our more any don\'t didnt didn\'t doesnt doesn\'t isnt isn\'t wont won\'t ive i\'ve id i\'d ill i\'ll youre you\'re thats theyre we\'re were weve let\'s via etc yes yeah yep'.split(' '),
)

/** Your most used words: no stopwords, no project names, no slurs, nothing pasted. */
function topWords(classified: ClassifiedThread[], projectNames: string[]): Report['topWords'] {
  const skip = new Set(projectNames.flatMap((p) => p.toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean))
  const counts = new Map<string, number>()
  for (const { humans } of classified) {
    for (const { ev } of humans) {
      if (ev.text.length > 4000 || looksPasted(ev.text)) continue
      const toks = stripPlaceholders(ev.text)
        .toLowerCase()
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/\S*[\/\\]\S*/g, ' ')
        .match(/\p{L}[\p{L}'’]{2,}/gu)
      for (const w of toks || []) {
        // CJK runs have no spaces, so a "word" would be a whole sentence
        if (w.length > 24 || CJK.test(w) || STOP.has(w) || COMMON.has(w) || STOPWORDS_X.has(w) || skip.has(w) || !isFeatureSafe(w)) continue
        counts.set(w, (counts.get(w) || 0) + 1)
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24)
    .map(([word, count]) => ({ word, count }))
}

function signaturePhrases(classified: ClassifiedThread[]): Report['phrases'] {
  const counts = new Map<string, { threads: Set<string>; count: number; ex: { t: ThreadRecord; idx: number } }>()
  for (const { thread: t, humans } of classified) {
    for (const { ev, idx } of humans) {
      const text = stripPlaceholders(ev.text)
      if (text.length > 2500 || looksPasted(text)) continue
      const toks = text
        .toLowerCase()
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/\S*[\/\\]\S*/g, ' ') // paths
        .replace(/\S+\.[a-z0-9]{1,5}\b/g, ' ') // file names
        .match(/[a-z][a-z']*/g)
      if (!toks) continue
      const seenHere = new Set<string>()
      for (let n = 3; n <= 5; n++) {
        for (let i = 0; i + n <= toks.length; i++) {
          const g = toks.slice(i, i + n)
          if (STOP.has(g[0]) && g[0] !== 'make' && g[0] !== 'dont' && g[0] !== "don't") continue
          if (STOP.has(g[n - 1])) continue
          const content = g.filter((w) => !STOP.has(w) && w.length >= 3)
          if (content.length < 2) continue
          const key = g.join(' ')
          if (seenHere.has(key)) continue
          seenHere.add(key)
          const c = counts.get(key) || { threads: new Set(), count: 0, ex: { t, idx } }
          c.threads.add(threadKey(t))
          c.count++
          counts.set(key, c)
        }
      }
    }
  }
  const ranked = [...counts.entries()]
    .filter(([, c]) => c.threads.size >= 4)
    .map(([text, c]) => ({ text, threads: c.threads.size, count: c.count, score: c.threads.size * (1 + text.split(' ').length / 4), ex: c.ex }))
    .sort((a, b) => b.score - a.score)
  const content = (s: string) => new Set(s.split(' ').filter((w) => !STOP.has(w)))
  const out: typeof ranked = []
  for (const r of ranked) {
    const mine = content(r.text)
    // Skip near-duplicates: substrings, or phrases sharing three content words with one already chosen.
    if (out.some((o) => o.text.includes(r.text) || r.text.includes(o.text) || [...content(o.text)].filter((w) => mine.has(w)).length >= 3)) continue
    out.push(r)
    if (out.length >= 10) break
  }
  return out.map((r) => ({ text: r.text, threads: r.threads, count: r.count, safe: isFeatureSafe(r.text), example: example(r.ex.t, r.ex.idx, 220) }))
}

function pickMoments(r: Report, classified: ClassifiedThread[]): Moment[] {
  const out: Moment[] = []
  if (r.style.first) out.push({ kind: 'first', title: 'Where this history begins', detail: `Your earliest retained prompt, in ${r.style.first.project}.`, example: r.style.first })
  // Sharpest redirect: after an interruption, substantive, with a clear theme.
  let best: { t: ThreadRecord; idx: number; s: number } | null = null
  for (const { thread: t, humans } of classified) {
    for (const h of humans) {
      if (h.c.kind !== 'steer') continue
      const w = wordCount(h.ev.text)
      if (w < 8 || w > 70 || !isFeatureSafe(h.ev.text) || looksPasted(h.ev.text)) continue
      const s = (h.ev.afterInterrupt ? 3 : 0) + h.c.themes.length + Math.min(w, 40) / 20
      if (!best || s > best.s) best = { t, idx: h.idx, s }
    }
  }
  if (best) out.push({ kind: 'redirect', title: 'Your sharpest redirect', detail: `You stopped the agent and changed course in ${best.t.project}.`, example: example(best.t, best.idx, 280) })
  const deep = r.deepest[0]
  if (deep) {
    const t = classified.find((c) => threadKey(c.thread) === deep.key)
    const h = t?.humans.find((x) => isFeatureSafe(x.ev.text) && !looksPasted(x.ev.text) && wordCount(x.ev.text) >= 6)
    if (t && h) out.push({ kind: 'deep', title: "The thread you wouldn't let go", detail: `${deep.prompts} prompts over ${deep.days} day${deep.days === 1 ? '' : 's'} in ${deep.project}.`, example: example(t.thread, h.idx, 280) })
  }
  const topTheme = r.steering.themes[0]
  const themeEx = topTheme?.examples.filter((e) => e.safe).pop()
  if (topTheme && themeEx) out.push({ kind: 'theme', title: `Your most common steer: “${topTheme.label}”`, detail: `${topTheme.count} steers fit this pattern.`, example: themeEx })
  if (r.style.latest) out.push({ kind: 'latest', title: 'Where it stands now', detail: `Your most recent prompt, in ${r.style.latest.project}.`, example: r.style.latest })
  return out
}
