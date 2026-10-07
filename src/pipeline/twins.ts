// Who you work most like: a builder whose well-documented way of working points the same
// way as yours across the seven spectra. Each profile is a rough reading of a public
// reputation, with its sources, not a measurement of the person; the match is cosine
// similarity in z-space. Not affiliated with or endorsed by anyone listed.

import type { Spectrum } from '../report-types.ts'
import { barPosition } from './deck.ts'

type Axis = 'control' | 'briefing' | 'clock' | 'range' | 'stamina' | 'temper' | 'leash'

export interface Twin {
  key: string
  name: string
  /** What they're known for, the part that matches the profile. Documented, not invented. */
  known: string
  profile: Partial<Record<Axis, number>>
  /** Where the reading comes from, so anyone can check it. */
  sources: string[]
}

const WP = (page: string) => `https://en.wikipedia.org/wiki/${page}`

export const TWINS: Twin[] = [
  { key: 'torvalds', name: 'Linus Torvalds', known: 'Has run Linux since 1991, now mostly merging what others write, and says bluntly what he won’t take.', profile: { control: 1.5, range: -1.5, stamina: 1, temper: 1.2, leash: 0.6 }, sources: [WP('Linus_Torvalds')] },
  { key: 'karpathy', name: 'Andrej Karpathy', known: 'Coined “vibe coding”: say what you want, accept the diff, let the model run.', profile: { control: -1.5, leash: 1.4, temper: -0.8 }, sources: [WP('Vibe_coding'), 'https://fortune.com/2026/03/21/andrej-karpathy-openai-cofounder-ai-agents-coding-state-of-psychosis-openclaw/'] },
  { key: 'hotz', name: 'George Hotz', known: 'Known for marathon coding livestreams, hands on the keyboard, opinions out loud.', profile: { clock: 1, stamina: 1.2, leash: -1, temper: 0.9, briefing: -0.5 }, sources: [WP('George_Hotz')] },
  { key: 'woz', name: 'Steve Wozniak', known: 'Designed the Apple I and II largely himself, much of it after hours.', profile: { leash: -1.4, clock: 1, temper: -1, range: -0.6, stamina: 0.8 }, sources: [WP('Steve_Wozniak')] },
  { key: 'gates', name: 'Bill Gates', known: 'In Microsoft’s early years, read the code himself and worked through the night.', profile: { control: 1.2, clock: 1, stamina: 1, temper: 0.5, leash: -0.5 }, sources: [WP('Bill_Gates')] },
  { key: 'huang', name: 'Jensen Huang', known: 'Runs NVIDIA with about 60 direct reports and no one-on-ones.', profile: { leash: 1.4, stamina: 1.2, range: 0.8, briefing: 0.4 }, sources: [WP('Jensen_Huang')] },
  { key: 'musk', name: 'Elon Musk', known: 'Runs several companies at once with short, direct orders, often late at night.', profile: { range: 1.4, briefing: -1, clock: 0.8, control: 0.9, temper: 0.7, leash: 0.6 }, sources: [WP('Elon_Musk')] },
  { key: 'jobs', name: 'Steve Jobs', known: 'Known for saying no to almost everything and sending work back until it was right.', profile: { control: 1.4, range: -1, temper: 0.8, briefing: -0.3, leash: -0.6 }, sources: [WP('Steve_Jobs')] },
  { key: 'bezos', name: 'Jeff Bezos', known: 'Replaced slide decks with six-page memos, hands work to small teams, and keeps early mornings free of meetings.', profile: { briefing: 1.5, leash: 0.9, clock: -1 }, sources: [WP('Jeff_Bezos')] },
  { key: 'zuckerberg', name: 'Mark Zuckerberg', known: 'Built Facebook on “move fast and break things”, all in on one company.', profile: { stamina: -1.3, range: -1, control: -0.6, briefing: -0.5 }, sources: [WP('Mark_Zuckerberg')] },
  { key: 'chesky', name: 'Brian Chesky', known: 'Runs Airbnb in the details; his account of it is what Paul Graham’s “Founder Mode” essay was written about.', profile: { control: 1, briefing: 0.6, leash: -1.2 }, sources: ['https://paulgraham.com/foundermode.html', 'https://www.lennysnewsletter.com/p/brian-cheskys-contrarian-approach'] },
  { key: 'altman', name: 'Sam Altman', known: 'Runs OpenAI while chairing Helion and backing hundreds of startups, keeps his mornings free of meetings, and delegates by what each person is good at.', profile: { range: 1.3, leash: 1, clock: -1, temper: -0.5 }, sources: ['https://blog.samaltman.com/productivity', WP('Sam_Altman')] },
  { key: 'thiel', name: 'Peter Thiel', known: 'Co-founded PayPal, Palantir and Founders Fund, backs many companies at once, and leaves founders in charge: his fund says it has never removed one.', profile: { range: 1.2, leash: 1.1, control: -0.8 }, sources: [WP('Peter_Thiel'), 'https://web.archive.org/web/2014/http://www.foundersfund.com/the-future', WP('Alex_Karp')] },
  { key: 'karp', name: 'Alex Karp', known: 'Has run Palantir since 2004, writes shareholder letters that quote philosophers, and says bluntly what he thinks of his critics.', profile: { temper: 1.3, range: -1, briefing: 0.9 }, sources: [WP('Alex_Karp'), 'https://fortune.com/2025/10/16/palantir-ceo-alex-karp-interview-shareholder-letters'] },
  { key: 'ellison', name: 'Larry Ellison', known: 'Has driven Oracle’s technology since co-founding it in 1977, is still its CTO in his eighties, and is known for fierce public rivalries.', profile: { stamina: 1.2, temper: 1 }, sources: [WP('Larry_Ellison'), 'https://www.infoworld.com/article/2240556/oracle-ceo-larry-ellison-steps-down-as-ceo-catz-hurd-named-coceos.html'] },
  { key: 'amodei', name: 'Dario Amodei', known: 'Writes long essays, briefs all of Anthropic every two weeks from a three- or four-page document, and has one direct report, with the day-to-day handed to his co-founder.', profile: { briefing: 1.5, leash: 0.9, range: -0.7 }, sources: ['https://www.darioamodei.com/essay/the-adolescence-of-technology', 'https://fortune.com/2026/06/18/anthropic-ceo-dario-amodei-one-direct-report-unconventional-management-structure-start-up-success/', 'https://fortune.com/2026/02/26/anthropic-ceo-dario-amodei-leadership-style-csuite-communication-tech-ai-dario-vision-quest/'] },
]

/** Plain words for one end of each spectrum, for the "you both…" line. */
const SAY: Record<Axis, [string, string]> = {
  control: ['let the work through', 'send work back until it’s right'],
  briefing: ['keep it short', 'write it all out first'],
  clock: ['keep daylight hours', 'work into the night'],
  range: ['go deep on one thing', 'keep many projects going'],
  stamina: ['move fast and start fresh', 'stay with a problem for the long haul'],
  temper: ['stay calm', 'say exactly what you think'],
  leash: ['stay hands-on, turn by turn', 'hand off big chunks and let them run'],
}

const AXES: Axis[] = ['control', 'briefing', 'clock', 'range', 'stamina', 'temper', 'leash']

export function rankTwins(spectra: Spectrum[]) {
  const z = Object.fromEntries(spectra.map((s) => [s.key, Math.max(-2, Math.min(2, s.z))])) as Record<Axis, number>
  const norm = (v: number[]) => Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1
  const you = AXES.map((a) => z[a] ?? 0)
  return TWINS.map((t) => {
    const p = AXES.map((a) => t.profile[a] ?? 0)
    const sim = you.reduce((s, x, i) => s + x * p[i], 0) / (norm(you) * norm(p))
    // the traits you share most strongly, for the explanation
    const shared = AXES.map((a, i) => ({ a, c: you[i] * p[i], up: you[i] > 0 }))
      .filter((x) => x.c > 0.05)
      .sort((x, y) => y.c - x.c)
      .slice(0, 2)
      .map((x) => SAY[x.a][x.up ? 1 : 0])
    return { twin: t, sim, shared }
  }).sort((a, b) => b.sim - a.sim)
}

export function twinOf(spectra: Spectrum[]) {
  const [best, ...rest] = rankTwins(spectra)
  const pct = (sim: number) => Math.round(Math.max(0, sim) * 100)
  // the traits their reputation rests on, you and them on the same bars (the clock's bar
  // splits at 50/50 while profiles measure from a typical day, about 1 sd earlier)
  const axes = AXES.filter((a) => best.twin.profile[a] != null)
    .map((a) => {
      const s = spectra.find((x) => x.key === a)!
      const them = best.twin.profile[a]! - (a === 'clock' ? 1 : 0)
      return { key: a, left: s.left, right: s.right, you: s.value, them: barPosition(them), weight: Math.abs(best.twin.profile[a]!) }
    })
    .sort((x, y) => y.weight - x.weight)
    .slice(0, 3)
    .map(({ weight, ...x }) => x)
  return {
    key: best.twin.key,
    name: best.twin.name,
    known: best.twin.known,
    why: best.shared.length ? `You both ${best.shared.join(' and ')}.` : '',
    match: pct(best.sim),
    also: rest.slice(0, 2).map((r) => ({ key: r.twin.key, name: r.twin.name, match: pct(r.sim) })),
    axes,
  }
}
