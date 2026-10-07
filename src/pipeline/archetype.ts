// Archetypes: one pole of a measured spectrum, chosen by how far you sit toward it.
// Every bar, letter and badge maps to a stated rule over counted facts.

import type { Archetype, Badge, Deep, Report, Spectrum } from '../report-types.ts'
import { barPosition, CALIBRATION, CLOCK_SPLIT, CODE_AXES, DECK, deckCard, zScore } from './deck.ts'
import { twinOf } from './twins.ts'
const pct = (x: number) => `${Math.round(x * 100)}%`
const n = (x: number) => Math.round(x).toLocaleString('en-US')

interface Def {
  key: string
  name: string
  tagline: string
  spectrum: string
  pole: 0 | 1
  /** Some poles are the common default; they need to be further out to win. */
  weight: number
  description: (r: Report) => string
  superpower: (r: Report) => string
  blindSpot: (r: Report) => string
}

const topTheme = (r: Report) => r.steering.themes[0]?.label.toLowerCase() ?? 'something'

const DEFS: Def[] = [
  {
    key: 'editor', name: 'The Editor', tagline: 'You let agents draft. Then you cut.', spectrum: 'control', pole: 1, weight: 1,
    description: (r) => `${pct(r.steering.rate)} of your follow-ups redirect the agent, most often to say “${topTheme(r)}.” You treat the first attempt as a draft, never the answer.`,
    superpower: (r) => `You catch drift early: a median of ${fmtSec(r.deep.timeToSteer.medianSec)} from the agent's attempt to your redirect.`,
    blindSpot: (r) => `${n(r.totals.steers)} redirects is a lot of rework. The opening ask is the cheapest place to say what you'll end up correcting.`,
  },
  {
    key: 'delegator', name: 'The Delegator', tagline: 'You hand it off and let it ride.', spectrum: 'control', pole: 0, weight: 1,
    description: (r) => `Only ${pct(r.steering.rate)} of your follow-ups redirect the agent. You give the job, then you move on to the next one.`,
    superpower: (r) => `Agents took ${r.deep.work.actionsPerPrompt.toFixed(1)} actions per prompt without you stepping in.`,
    blindSpot: () => `Low steering can mean great prompts, or work nobody checked. Only the diffs know which.`,
  },
  {
    key: 'architect', name: 'The Architect', tagline: 'You think in specs.', spectrum: 'briefing', pole: 1, weight: 1,
    description: (r) => `Your typical prompt runs ${r.style.medianWords} words and one in ten passes ${r.style.p90Words}. You front-load the thinking so the agent doesn't have to guess.`,
    superpower: (r) => `Long briefs, ${pct(r.steering.approvalsShare)} short approvals: when you've specified it, you sign off fast.`,
    blindSpot: () => `Some of those paragraphs could be a file the agent reads every time.`,
  },
  {
    key: 'sniper', name: 'The Sniper', tagline: 'Six words. Ship it.', spectrum: 'briefing', pole: 0, weight: 1,
    description: (r) => `Your typical prompt is ${r.style.medianWords} words and ${pct(r.style.oneLinerShare)} are one-liners. You trust the agent to fill in the rest.`,
    superpower: (r) => `Speed. ${n(r.totals.prompts)} prompts and almost none of them wasted words.`,
    blindSpot: (r) => `Short asks and a ${pct(r.steering.rate)} steer rate: some of those corrections were context you didn't send.`,
  },
  {
    key: 'night', name: 'The Night Shift', tagline: 'Your best work happens after dark.', spectrum: 'clock', pole: 1, weight: 1,
    description: (r) => `${pct(r.rhythm.afterHoursShare)} of your prompts land between 6pm and 6am, and ${pct(r.rhythm.nightShare)} after 10pm. The agents don't sleep, so neither do you.`,
    superpower: () => `No meetings, no Slack, just you and a terminal.`,
    blindSpot: () => `Check the 2am commits in daylight.`,
  },
  {
    key: 'day', name: 'The Nine-to-Fiver', tagline: 'Agents clock in when you do.', spectrum: 'clock', pole: 0, weight: 1,
    description: (r) => `You peak at ${hour(r.rhythm.peakHour)}, and ${pct(1 - r.rhythm.afterHoursShare)} of your prompts land between 6am and 6pm.`,
    superpower: () => `Sustainable. You'll still be doing this next year.`,
    blindSpot: () => `Long agent runs could work through your evenings while you don't.`,
  },
  {
    key: 'conductor', name: 'The Conductor', tagline: 'Many projects, one baton.', spectrum: 'range', pole: 1, weight: 1,
    description: (r) => `${r.projects.filter((p) => p.prompts >= 50).length} projects got at least 50 prompts. You keep several codebases moving at once.`,
    superpower: (r) => `${r.deep.crossTool.projectsOnBoth} projects run on more than one agent: you pick the instrument for the part.`,
    blindSpot: () => `Context switching has a cost even when the agent pays most of it.`,
  },
  {
    key: 'loyalist', name: 'The Monogamist', tagline: 'One project. All in.', spectrum: 'range', pole: 0, weight: 1,
    description: (r) => `${r.projects[0]?.name ?? 'One project'} took ${pct((r.projects[0]?.prompts ?? 0) / Math.max(1, r.totals.prompts))} of everything you sent.`,
    superpower: () => `Depth. You know this codebase better than any agent ever will.`,
    blindSpot: () => `Everything rides on one repo.`,
  },
  {
    key: 'marathoner', name: 'The Marathoner', tagline: "You stay in the thread until it's done.", spectrum: 'stamina', pole: 1, weight: 1,
    description: (r) => `You average ${Math.round(r.totals.prompts / Math.max(1, r.totals.threads))} prompts per thread; your longest ran ${r.deepest[0]?.prompts ?? 0} prompts.`,
    superpower: () => `Persistence. You don't abandon problems halfway.`,
    blindSpot: () => `Past a few hundred turns, a fresh thread with a summary often beats a long memory.`,
  },
  {
    key: 'sprinter', name: 'The Sprinter', tagline: 'New thread, new problem, gone.', spectrum: 'stamina', pole: 0, weight: 1,
    description: (r) => `You average ${Math.round(r.totals.prompts / Math.max(1, r.totals.threads))} prompts per thread across ${n(r.totals.threads)} threads. Short, scoped, done.`,
    superpower: () => `Clean context every time.`,
    blindSpot: () => `Some threads end before you've checked the result.`,
  },
  {
    key: 'volcano', name: 'The Volcano', tagline: "You say what everyone's thinking. In caps.", spectrum: 'temper', pole: 1, weight: 1,
    description: (r) => `${n(r.deep.swear.prompts)} of your prompts include a swear${r.deep.swear.words[0] ? `, “${r.deep.swear.words[0].word}” ${n(r.deep.swear.words[0].count)} times` : ''}, and ${n(r.deep.swear.allCaps)} are in all caps.`,
    superpower: (r) => `Nothing broken slips past you: ${pct(r.deep.swear.inSteers / Math.max(1, r.deep.swear.prompts))} of your swearing lands in a correction.`,
    blindSpot: () => `The agent doesn't get scared. The file name and the error message fix it faster.`,
  },
  {
    key: 'monk', name: 'The Monk', tagline: 'Not one swear. Not even at Codex.', spectrum: 'temper', pole: 0, weight: 1,
    description: (r) => `${n(r.totals.prompts)} prompts and ${r.deep.swear.prompts ? `only ${n(r.deep.swear.prompts)}` : 'not one'} with a swear in them.`,
    superpower: () => `Calm under a broken build.`,
    blindSpot: () => `Nobody can tell when you're actually blocked.`,
  },
  {
    key: 'foreman', name: 'The Foreman', tagline: 'You give the order; the crew works for an hour.', spectrum: 'leash', pole: 1, weight: 1,
    description: (r) => `Each prompt bought ${r.deep.work.agentMinutesPerPrompt.toFixed(1)} minutes of agent work, ${n(r.deep.work.agentHours)} hours in total.`,
    superpower: (r) => `Leverage: your longest single hand-off ran ${Math.round(r.deep.work.longestTurn?.min ?? 0)} minutes without you.`,
    blindSpot: () => `Long unattended runs need a way to check what came back.`,
  },
  {
    key: 'pair', name: 'The Pair Programmer', tagline: 'You stay in the loop, turn by turn.', spectrum: 'leash', pole: 0, weight: 1,
    description: (r) => `Agents worked a median of ${r.deep.work.medianTurnMin.toFixed(1)} minutes per turn before you were back.`,
    superpower: () => `Tight loops; nothing goes far off course.`,
    blindSpot: () => `Bigger tasks could run unattended while you think about the next one.`,
  },
]

function hour(h: number) {
  return h === 0 ? 'midnight' : h === 12 ? 'noon' : h < 12 ? `${h}am` : `${h - 12}pm`
}
function fmtSec(s: number) {
  return s < 90 ? `${Math.round(s)} seconds` : `${(s / 60).toFixed(1)} minutes`
}

export type Metrics = Record<'control' | 'briefing' | 'clock' | 'range' | 'stamina' | 'temper' | 'leash', number | null>

/** The seven raw numbers a card is dealt from. */
export function metricsOf(r: Report, deep: Deep): Metrics {
  const shares = recentShares(r)
  const total = shares.reduce((a, b) => a + b, 0) || 1
  const entropy = -shares.reduce((s, x) => s + (x / total) * Math.log(x / total), 0)
  return {
    control: r.steering.rate,
    briefing: r.style.medianWords,
    clock: r.rhythm.afterHoursShare ?? r.rhythm.nightShare,
    range: Math.exp(entropy),
    stamina: r.totals.prompts / Math.max(1, r.totals.threads),
    temper: deep.swear.per100,
    leash: deep.work.timedTurns ? deep.work.agentMinutesPerPrompt : null,
  }
}

/**
 * How much evidence each metric rests on, and how much it takes to trust it: a score
 * is scaled by n / (n + k), so a first week's 4 follow-ups can't pin anyone to an extreme.
 */
export type Evidence = Partial<Record<keyof Metrics, number>>
const TRUST: Record<keyof Metrics, number> = { control: 30, briefing: 20, clock: 30, range: 40, stamina: 8, temper: 60, leash: 20 }

export function evidenceOf(r: Report, deep: Deep): Evidence {
  const p = r.totals.prompts
  return { control: r.totals.followups, briefing: p, clock: p, range: p, stamina: r.totals.threads, temper: p, leash: deep.work.timedTurns }
}

/**
 * Prompts per project over the last 90 days of activity: how many projects you run at once,
 * not how long your history is. Falls back to all time when the recent window is thin.
 */
function recentShares(r: Report): number[] {
  const real = r.projects.filter((p) => p.name !== 'scratch' && p.name !== '~')
  const last = Math.max(0, ...real.map((p) => p.last))
  const from = new Date(last - 90 * 86400e3).toISOString().slice(0, 10)
  const recent = real.map((p) => Object.entries(p.weeks || {}).reduce((s, [w, k]) => (w >= from ? s + k : s), 0)).filter((x) => x > 0)
  return recent.reduce((a, b) => a + b, 0) >= 30 ? recent : real.map((p) => p.prompts)
}

export function spectraOf(m: Metrics, n: Evidence = {}): Spectrum[] {
  const c = CALIBRATION
  const mk = (key: keyof Metrics, left: string, right: string, metric: string, typical: string): Spectrum => {
    const x = m[key]
    const e = n[key]
    const trust = e == null ? 1 : e / (e + TRUST[key])
    const z = x == null ? 0 : zScore(key, x) * trust
    // the clock's bar (and its letter) splits at 50/50; its score still measures from typical
    const shown = key === 'clock' && x != null ? zScore(key, x, CLOCK_SPLIT) * trust : z
    return { key, left, right, z, value: barPosition(shown), metric, typical, rule: `distance from ${typical.replace(/^typical /, 'a typical ')}, in standard deviations` }
  }
  const v = (k: keyof Metrics) => m[k] ?? 0
  return [
    mk('control', 'Delegator', 'Editor', `${pct(v('control'))} of follow-ups redirect`, `typical ${pct(c.control.typical)}`),
    mk('briefing', 'Sniper', 'Architect', `${Math.round(v('briefing'))} words per prompt (median)`, `typical ${c.briefing.typical} words`),
    mk('clock', 'Day shift', 'Night shift', `${pct(v('clock'))} of prompts 6pm–6am`, 'an even split is 50%'),
    mk('range', 'Monogamist', 'Conductor', `${v('range').toFixed(1)} effective projects`, `typical ${c.range.typical}`),
    mk('stamina', 'Sprinter', 'Marathoner', `${v('stamina').toFixed(0)} prompts per thread`, `typical ${c.stamina.typical}`),
    mk('temper', 'Monk', 'Volcano', `${v('temper').toFixed(1)} swears per 100 prompts`, `typical ${c.temper.typical}`),
    mk('leash', 'Pair programmer', 'Foreman', `${v('leash').toFixed(1)} agent-minutes per prompt`, `typical ${c.leash.typical} min`),
  ]
}

export const computeSpectra = (r: Report, deep: Deep) => spectraOf(metricsOf(r, deep), evidenceOf(r, deep))

/** Every card scored: how far past typical you sit toward its pole, weighted. Highest first. */
export function deal(spectra: Spectrum[]) {
  const sp = (k: string) => spectra.find((s) => s.key === k)!
  return DEFS.map((def) => {
    const z = sp(def.spectrum).z
    return { def, score: Math.max(0, def.pole === 1 ? z : -z) * def.weight, lean: Math.abs(sp(def.spectrum).value - 0.5) * 2 }
  }).sort((a, b) => b.score - a.score)
}

function badges(r: Report, d: Deep): Badge[] {
  const out: Badge[] = []
  const total = r.bySource.reduce((a, s) => a + s.prompts, 0)
  const main = r.bySource.filter((s) => s.prompts >= 0.2 * total && total > 0)
  const tests = d.work.commands.categories.find((c) => c.key === 'test')?.share ?? 0
  if (r.rhythm.nightShare >= 0.25) out.push({ key: 'owl', label: 'Night owl', why: `${pct(r.rhythm.nightShare)} of prompts after 10pm` })
  if (r.rhythm.weekendShare >= 0.3) out.push({ key: 'weekend', label: 'Weekend warrior', why: `${pct(r.rhythm.weekendShare)} of prompts on weekends` })
  if (main.length >= 2) out.push({ key: 'bilingual', label: main.length > 2 ? 'Multi-tool' : 'Two-tool', why: `${main.map((s) => s.label).join(' and ')} each over 20% of prompts` })
  if (d.effort.highShare >= 0.3) out.push({ key: 'effort', label: 'Max effort', why: `${pct(d.effort.highShare)} of agent turns at xhigh or above` })
  if (r.streak.days >= 14) out.push({ key: 'streak', label: `${r.streak.days}-day streak`, why: `${r.streak.from} to ${r.streak.to} without a day off` })
  if (d.swear.per100 >= 3) out.push({ key: 'mouth', label: 'Potty mouth', why: `${d.swear.per100.toFixed(1)} swears per 100 prompts` })
  if (d.limits && d.limits.weeksAtLimit + d.limits.windowsAtLimit > 0) out.push({ key: 'limit', label: 'Limit breaker', why: `hit a Codex usage limit ${d.limits.windowsAtLimit} time${d.limits.windowsAtLimit === 1 ? '' : 's'}` })
  if (d.crossTool.switches >= 5) out.push({ key: 'switch', label: 'Rage switcher', why: `switched tools right after a redirect ${d.crossTool.switches} times` })
  if (d.work.linesAdded >= 100_000) out.push({ key: 'shipper', label: 'Six-figure shipper', why: `${n(d.work.linesAdded)} lines added by agents` })
  if (tests >= 0.08) out.push({ key: 'tests', label: 'Test runner', why: `${pct(tests)} of agent commands were tests` })
  const usd = r.spend?.totalUsd ?? 0
  if (usd >= 1000) out.push({ key: 'whale', label: usd >= 10_000 ? 'Five-figure tab' : 'Four-figure tab', why: `$${n(usd)} of API-equivalent usage` })
  return out
}

export function pickArchetype(r: Report, d: Deep): Archetype {
  const spectra = computeSpectra(r, d)
  const sp = (k: string) => spectra.find((s) => s.key === k)!
  // Your card is the trait where you're furthest from typical; common defaults need a bit more.
  const scored = deal(spectra)
  const top = scored[0].def
  const code = CODE_AXES.map((ax) => {
    const [right, left] = Object.keys(ax.letters)
    return sp(ax.spectrum).value >= 0.5 ? right : left
  }).join('')
  const legend = code.split('').map((l, i) => {
    const ax = CODE_AXES[i]
    const word = (ax.letters as Record<string, string>)[l]
    const s = sp(ax.spectrum)
    return { letter: l, word, axis: ax.axis, means: `${word}: ${s.metric}`, rule: `${(ax.rules as Record<string, string>)[l]} (yours: ${s.metric}; ${s.typical})` }
  })
  const card = deckCard(top.key)!
  return {
    key: top.key,
    numeral: card.numeral,
    name: top.name,
    tagline: top.tagline,
    lore: card.lore,
    signs: card.signs,
    enemy: card.enemy,
    measured: card.measured,
    code,
    codeLegend: legend,
    description: top.description(r),
    superpower: top.superpower(r),
    blindSpot: top.blindSpot(r),
    why: `Your strongest lean is ${spectra.find((s) => s.key === top.spectrum)!.metric}.`,
    matches: scored.filter((s) => s.score > 0).slice(0, 5).map((s) => ({ key: s.def.key, name: s.def.name, score: Math.round(s.lean * 100) })),
    spectra,
    badges: badges(r, d),
    twin: twinOf(spectra),
  }
}

export const ARCHETYPES = DECK
