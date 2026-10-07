// What an episode is likely worth, from signals a buyer would care about. The price
// is lore's test price times a quality tier until a buyer sets real prices; the
// collector can publish a pricing table that replaces these defaults.

import type { EpisodeCandidate } from './episodes.ts'
import { looksPasted } from '../util/safety.ts'
import { wordCount } from '../util/text.ts'

export type Tier = 'Trace' | 'Solid' | 'Strong' | 'Gold'

export interface Pricing {
  base: number
  multipliers: Record<Tier, number>
  source: string
}

export interface EpisodeValue {
  score: number
  tier: Tier
  usd: number
  signals: { label: string; points: number }[]
  basis: string
}

/** The flat test price from WEDGE.md, scaled by tier. Not a buyer offer. */
export const DEFAULT_PRICING: Pricing = { base: 5, multipliers: { Trace: 0.5, Solid: 1, Strong: 2, Gold: 3 }, source: 'lore test price' }

export function valueEpisode(c: EpisodeCandidate, pricing: Pricing = DEFAULT_PRICING): EpisodeValue {
  const signals: { label: string; points: number }[] = []
  const add = (label: string, points: number) => signals.push({ label, points })
  if (c.attemptChange && c.revisedChange) add('code before and after your redirect', 30)
  else if (c.attemptChange || c.revisedChange) add('code on one side of the redirect', 12)
  if (c.git?.committed) {
    if (c.git.reverted) add('committed, later reverted', 8)
    else {
      add(`committed ${c.git.minutesAfter} min later`, 20)
      if (c.git.laterChanges14d !== null && c.git.laterChanges14d <= 3) add('stable for 14 days', 5)
    }
  }
  const w = wordCount(c.steer.text)
  if (w >= 8 && w <= 150) add('a redirect with real reasoning', 15)
  else if (w >= 4) add('a short redirect', 6)
  if (c.steer.afterInterrupt) add('you stopped the agent mid-turn', 5)
  if (!c.steer.rule.startsWith('sent right after')) add('a correction in your words', 5)
  if (c.evidence.expressedApproval) add('you approved what came next', 10)
  if (c.context.some((x) => x.role === 'human')) add('the original ask is included', 5)
  if (looksPasted(c.steer.text)) add('redirect is mostly pasted output', -15)
  const score = Math.max(0, Math.min(100, signals.reduce((s, x) => s + x.points, 0)))
  const tier: Tier = score >= 85 ? 'Gold' : score >= 65 ? 'Strong' : score >= 40 ? 'Solid' : 'Trace'
  const usd = Math.round(pricing.base * pricing.multipliers[tier] * 100) / 100
  return { score, tier, usd, signals, basis: `${pricing.source}: $${pricing.base} × ${pricing.multipliers[tier]} for ${tier}` }
}
