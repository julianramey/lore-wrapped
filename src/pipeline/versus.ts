// "lore vs": compare with a friend without a server. Each report carries a short code with
// only what the comparison needs, coarsely: your card, where you sit on the seven spectra
// (quarter steps of a standard deviation), and the order of magnitude of your prompts.
// Nothing in it names a project, a model, a word or a date. Pure, so the browser uses it.

import { DECK } from './deck.ts'

export const VS_AXES = ['control', 'briefing', 'clock', 'range', 'stamina', 'temper', 'leash'] as const
type Axis = (typeof VS_AXES)[number]

export interface VsProfile {
  card: string
  /** Where each dot sits, in standard deviations from the bar's middle, in quarter steps. */
  z: Record<Axis, number>
  /** Prompts on record, to the nearest power of two. */
  prompts: number
}

const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const checksum = (s: string) => B36[[...s].reduce((a, ch, i) => a + B36.indexOf(ch) * (i + 1), 0) % 36]

/** Where a dot sits, as standard deviations: the inverse of the bar position (deck.ts barPosition). */
export const zOfBar = (value: number) => Math.log(value / (1 - value)) / 1.1

/** Your code, from where your dots sit on the bars (the clock's bar splits at 50/50, as shown). */
export function vsCode(card: string, spectra: { key: string; value: number }[], prompts: number): string {
  const i = Math.max(0, DECK.findIndex((d) => d.key === card))
  const q = (z: number) => B36[Math.round((Math.max(-3, Math.min(3, z)) + 3) * 4)]
  const body = `1${B36[i]}${VS_AXES.map((a) => q(zOfBar(spectra.find((s) => s.key === a)?.value ?? 0.5))).join('')}${B36[Math.min(35, Math.round(Math.log2(prompts + 1)))]}`
  return `LORE-${body}${checksum(body)}`
}

/** A friend's profile from their code; null for anything that isn't one. */
export function readVsCode(text: string): VsProfile | null {
  const m = text.trim().toUpperCase().match(/LORE-([0-9A-Z]{11})/)
  if (!m) return null
  const body = m[1].slice(0, 10)
  if (body[0] !== '1' || checksum(body) !== m[1][10]) return null
  const card = DECK[B36.indexOf(body[1])]
  if (!card) return null
  const z = Object.fromEntries(VS_AXES.map((a, i) => [a, B36.indexOf(body[2 + i]) / 4 - 3])) as Record<Axis, number>
  if (Object.values(z).some((v) => v > 3)) return null
  return { card: card.key, z, prompts: Math.round(2 ** B36.indexOf(body[9]) - 1) }
}

/** What leaning right on each spectrum looks like, after "You" or "They". */
const AWARDS: Record<Axis, string> = {
  control: 'steer harder',
  briefing: 'write longer prompts',
  clock: 'work later',
  range: 'juggle more projects',
  stamina: 'stay in a thread longer',
  temper: 'swear more',
  leash: 'hand off for longer',
}

export interface VsResult {
  /** How close the two sets of dots sit on the seven bars, 0–100. */
  sync: number
  /** The clear differences, biggest first: who leans further right on each. */
  awards: { axis: Axis; you: boolean; text: string; gap: number }[]
}

export function compareVs(you: VsProfile, them: VsProfile): VsResult {
  const gaps = VS_AXES.map((axis) => ({ axis, d: you.z[axis] - them.z[axis] }))
  const mean = gaps.reduce((s, g) => s + Math.min(3, Math.abs(g.d)), 0) / gaps.length
  return {
    sync: Math.round(100 * (1 - mean / 3)),
    awards: gaps
      .filter((g) => Math.abs(g.d) >= 0.5)
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
      .map((g) => ({ axis: g.axis, you: g.d > 0, text: AWARDS[g.axis], gap: Math.abs(g.d) })),
  }
}
