// API-equivalent spend: what your tokens would have cost at each provider's published
// list price, from every API reply on disk (subagents included), each counted once.
// Unknown models count tokens, not dollars.

import type { ClaudeStats } from '../sources/claudeStats.ts'
import { SOURCE_KEYS, sourceIndex } from '../sources/registry.ts'
import type { SourceName, ThreadRecord, UsageLedger } from '../types.ts'
import { dayKey } from '../util/text.ts'
import { canonicalModel } from './modelName.ts'

export const PRICES_AS_OF = '2026-10-06'
export const PRICE_SOURCES = {
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  openai: 'https://developers.openai.com/api/docs/pricing',
  google: 'https://ai.google.dev/gemini-api/docs/pricing',
}

/** USD per million tokens: input, output, cache read, cache write (null: billed as input). */
const PRICES: Record<string, [number, number, number, number | null]> = {
  'claude-3-5-haiku': [0.8, 4, 0.08, 1],
  'claude-3-5-sonnet': [3, 15, 0.3, 3.75],
  'claude-3-7-sonnet': [3, 15, 0.3, 3.75],
  'claude-sonnet-4': [3, 15, 0.3, 3.75],
  'claude-sonnet-4-5': [3, 15, 0.3, 3.75],
  'claude-opus-4': [15, 75, 1.5, 18.75],
  'claude-opus-4-1': [15, 75, 1.5, 18.75],
  'claude-opus-4-5': [5, 25, 0.5, 6.25],
  'claude-opus-4-6': [5, 25, 0.5, 6.25],
  'claude-opus-4-7': [5, 25, 0.5, 6.25],
  'claude-opus-4-8': [5, 25, 0.5, 6.25],
  'claude-opus-5': [5, 25, 0.5, 6.25],
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-sonnet-4-6': [3, 15, 0.3, 3.75],
  'claude-sonnet-5': [2, 10, 0.2, 2.5],
  'claude-sonnet-5-5': [2, 10, 0.2, 2.5],
  'claude-haiku-4-5': [1, 5, 0.1, 1.25],
  'claude-fable-5': [10, 50, 1, 12.5],
  'claude-fable-5-1': [10, 50, 0.25, 12.5],
  // OpenAI lists a cache-write price only from GPT-5.6 on; before that writes bill as input.
  'gpt-4o': [2.5, 10, 1.25, null],
  'gpt-4.1': [2, 8, 0.5, null],
  'gpt-4.1-mini': [0.4, 1.6, 0.1, null],
  'o3': [2, 8, 0.5, null],
  'o4-mini': [1.1, 4.4, 0.275, null],
  'gpt-5': [1.25, 10, 0.125, null],
  'gpt-5-mini': [0.25, 2, 0.025, null],
  'gpt-5-nano': [0.05, 0.4, 0.005, null],
  'gpt-5-codex': [1.25, 10, 0.125, null],
  'gpt-5.1': [1.25, 10, 0.125, null],
  'gpt-5.1-codex': [1.25, 10, 0.125, null],
  'gpt-5.1-codex-max': [1.25, 10, 0.125, null],
  'gpt-5.1-codex-mini': [0.25, 2, 0.025, null],
  'gpt-5.2': [1.75, 14, 0.175, null],
  'gpt-5.2-codex': [1.75, 14, 0.175, null],
  'gpt-5.3-codex': [1.75, 14, 0.175, null],
  'gpt-5.4': [2.5, 15, 0.25, null],
  'gpt-5.4-mini': [0.75, 4.5, 0.075, null],
  'gpt-5.4-nano': [0.2, 1.25, 0.02, null],
  'gpt-5.5': [5, 30, 0.5, null],
  'gpt-5.6-sol': [4, 20, 0.4, 5],
  'gpt-5.6-luna': [0.2, 1.2, 0.02, 0.25],
  'gpt-5.6-terra': [2, 12, 0.2, 2.5],
  'gpt-6-astra': [10, 50, 1, 12.5],
  'gpt-6-sol': [2, 10, 0.2, 2.5],
  'gpt-6-luna': [0.1, 0.5, 0.01, 0.125],
  'gpt-6.1-sol': [2, 10, 0.1, 2.5],
  // Gemini: paid tier, prompts up to 200k tokens; thinking is billed as output. Flash models
  // carry Google's introductory prices through Dec 31, 2026.
  'gemini-2.5-pro': [1.25, 10, 0.125, null],
  'gemini-2.5-flash': [0.3, 2.5, 0.03, null],
  'gemini-2.5-flash-lite': [0.1, 0.4, 0.01, null],
  'gemini-3-flash-preview': [0.5, 3, 0.05, null],
  'gemini-3.1-pro-preview': [2, 12, 0.2, null],
  'gemini-3.1-flash-lite': [0.25, 1.5, 0.025, null],
  'gemini-3.5-flash': [1.5, 9, 0.15, null],
  'gemini-3.5-flash-lite': [0.3, 2.5, 0.03, null],
  'gemini-3.6-flash': [0.75, 3.75, 0.075, null],
  'gemini-3.7-flash': [0.75, 3.75, 0.075, null],
  'gemini-3.8-flash': [0.75, 3.75, 0.075, null],
}

/** Prices that may not match what you would have paid when you used the model. */
const PRICE_NOTES: Record<string, string> = {
  'claude-3-5-sonnet': 'retired; priced at its last published API price',
  'claude-3-7-sonnet': 'retired; priced at its last published API price',
  'gpt-5.6-sol': 'priced at OpenAI’s current promotional rate (through Nov 21, 2026); its regular price isn’t published',
}

const UNPRICED: Record<string, string> = {
  'codex-auto-review': 'Codex’s approval reviewer; not sold on the API',
  'gpt-5.3-codex-spark': 'never had a public API price',
  'gemini-3-pro-preview': 'retired preview; no longer on Google’s price list',
}

/** Every model lore knows by its public name, priced or not: the only model names stats may carry. */
export const KNOWN_MODELS: ReadonlySet<string> = new Set([...Object.keys(PRICES), ...Object.keys(UNPRICED)])

export interface Tok {
  in: number
  cached: number
  out: number
  write: number
  /** The part of `write` cached for an hour: Anthropic bills it at twice the input price. */
  write1h?: number
}

const base = canonicalModel

export function priceOf(model: string) {
  return PRICES[base(model)] || null
}

/** Dollars for a token bundle, or null when the model has no published price. */
export function costOf(model: string, t: Tok): number | null {
  const p = priceOf(model)
  if (!p) return null
  const [i, o, cr, cw] = p
  const write = Math.min(t.write, t.in)
  // five-minute writes at the listed write price, hour-long ones at 2× input (Anthropic)
  const hour = cw == null ? 0 : Math.min(t.write1h || 0, write)
  return ((t.in - write) * i + (write - hour) * (cw ?? i) + hour * 2 * i + t.cached * cr + t.out * o) / 1e6
}

export interface PlanInfo {
  source: SourceName
  /** Plan id, e.g. "claude-max-20x", "chatgpt-pro". */
  id: string
}

export interface Spend {
  asOf: string
  sources: typeof PRICE_SOURCES
  totalUsd: number
  /** Tokens processed: each API reply once. Includes `estTokens`. */
  tokens: number
  /** The part of `tokens` estimated from Claude Code's own stats, for days its transcripts are gone. */
  estTokens: number
  /** Tokens subagents spent, from their transcripts on disk (exact only). */
  subagentTokens: number
  cacheShare: number
  bySource: { source: SourceName; usd: number; tokens: number; estTokens: number }[]
  models: { model: string; source: SourceName; input: number; cached: number; output: number; write: number; tokens: number; est: number; usd: number | null; note?: string }[]
  /** API-equivalent dollars per ISO week (Monday), by source in SOURCE_KEYS order. `est`: Claude, estimated from its daily stats. */
  weekly: { week: string; by: number[]; est: number }[]
  /** First day Claude's spend can be placed on the calendar. */
  claudeDailyFrom: string | null
  /** First day every Claude reply is still on disk and counted one by one. */
  claudeExactFrom: string | null
  /** When Claude's own token stats begin; Claude usage before this isn't recorded anywhere. */
  claudeStatsFrom: string | null
  /** Estimated Claude dollars with no daily split (before Claude recorded daily counts). */
  claudeUndatedUsd: number
  /** All estimated Claude dollars, dated or not. */
  claudeEstUsd: number
  /**
   * Claude Code's own count, for reconciling with what it shows: it adds a reply's usage once
   * per record, and a reply is written as one record per block (thinking, text, each tool call).
   */
  claudeCounter: { counted: number; processed: number } | null
  /** Estimated plan cost: list price for each month you used the tool. A range when the tier is unknown. */
  plans: { source: SourceName; id: string; label: string; monthlyUsd: [number, number] | null; months: number; paidUsd: [number, number] | null }[]
  /** Median API-equivalent dollars per active Claude day, where a daily split exists. */
  claudePerActiveDay: number | null
}

const PLAN_LABEL: Record<string, string> = {
  'claude-pro': 'Claude Pro',
  'claude-max': 'Claude Max',
  'claude-max-5x': 'Claude Max 5x',
  'claude-max-20x': 'Claude Max 20x',
  'chatgpt-plus': 'ChatGPT Plus',
  'chatgpt-pro': 'ChatGPT Pro',
  'chatgpt-business': 'ChatGPT Business',
}
/** Monthly list prices, billed monthly, as of PRICES_AS_OF. ChatGPT Pro has three tiers and the logs don't say which. */
export const PLAN_USD: Record<string, [number, number]> = {
  'claude-pro': [20, 20],
  'claude-max-5x': [100, 100],
  'claude-max-20x': [200, 200],
  'claude-max': [100, 200],
  'chatgpt-plus': [20, 20],
  'chatgpt-pro': [100, 500],
  'chatgpt-business': [25, 25],
}
export const PLAN_SOURCES = {
  claude: 'https://support.claude.com/en/articles/11049741-what-is-the-max-plan',
  chatgpt: 'https://learn.chatgpt.com/docs/pricing',
}
/** Anthropic's published figure for enterprise Claude Code deployments. */
export const CLAUDE_CODE_BENCHMARK = { avgPerActiveDay: 13, p90PerActiveDay: 30, url: 'https://code.claude.com/docs/en/costs' }

const weekOf = (t: number) => {
  const d = new Date(t)
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return dayKey(d.getTime())
}
const noon = (date: string) => new Date(`${date}T12:00:00`).getTime()
const DAY = 86400e3
const sum = (t: Tok) => t.in + t.cached + t.out

/**
 * Spend and tokens from the usage ledger: every API reply on disk, each once. Claude Code
 * deletes old transcripts, so for days they're gone, Claude's own stats stand in. Those count
 * a reply once per record, so they're scaled by the ratio measured on the transcripts still
 * here (replies ÷ records, per model) and labeled as an estimate.
 */
export function buildSpend(threads: ThreadRecord[], claudeStats: ClaudeStats | null, plans: PlanInfo[], ledger: UsageLedger): Spend {
  // one row per tool and model: the same model through two tools is two tools' spend
  const models = new Map<string, Tok & { model: string; source: SourceName; est: number }>()
  const weekly = new Map<string, { by: number[]; est: number }>()
  const claudeDay = new Map<string, number>()
  let claudeEstUsd = 0
  let claudeUndatedUsd = 0
  const add = (model: string, source: SourceName, t: Tok, day: string | null, est: boolean) => {
    const key = `${source}\u0000${model}`
    const cur = models.get(key) || { in: 0, cached: 0, out: 0, write: 0, write1h: 0, est: 0, model, source }
    cur.in += t.in
    cur.cached += t.cached
    cur.out += t.out
    cur.write += t.write
    cur.write1h = (cur.write1h || 0) + (t.write1h || 0)
    if (est) cur.est += sum(t)
    models.set(key, cur)
    const usd = costOf(model, t)
    if (!usd) return
    if (est) claudeEstUsd += usd
    if (!day) {
      claudeUndatedUsd += usd
      return
    }
    const k = weekOf(noon(day))
    const w = weekly.get(k) || { by: SOURCE_KEYS.map(() => 0), est: 0 }
    if (est) w.est += usd
    else w.by[sourceIndex(source)] += usd
    weekly.set(k, w)
    if (source === 'claude-code') claudeDay.set(day, (claudeDay.get(day) || 0) + usd)
  }

  const exact = ledger.rows.filter((r) => r.source === 'claude-code')
  // every source but Claude is exact; Claude's deleted days are estimated below
  for (const r of ledger.rows) if (r.source !== 'claude-code') add(r.model, r.source, r, r.day || null, false)

  // Claude Code's records per reply, measured on the transcripts still on disk
  const rawBy = new Map<string, number>()
  for (const byModel of Object.values(ledger.claudeRaw)) for (const [m, v] of Object.entries(byModel)) rawBy.set(m, (rawBy.get(m) || 0) + v)
  const exactBy = new Map<string, number>()
  for (const r of exact) exactBy.set(r.model, (exactBy.get(r.model) || 0) + sum(r))
  const rawAll = [...rawBy.values()].reduce((a, b) => a + b, 0)
  const globalRatio = rawAll >= 1e7 ? [...exactBy.values()].reduce((a, b) => a + b, 0) / rawAll : 1
  const ratio = (m: string) => ((rawBy.get(m) || 0) >= 5e8 ? (exactBy.get(m) || 0) / rawBy.get(m)! : globalRatio)

  // Claude's stats don't split a day's tokens by kind; each model's all-time mix does. They
  // don't say how long writes were cached either, so the transcripts' measured share stands in.
  const usage = claudeStats?.tokensByModel || {}
  const mixAll = Object.values(usage).reduce((a, t) => ({ in: a.in + t.in, cached: a.cached + t.cached, out: a.out + t.out, write: a.write + t.write }), { in: 0, cached: 0, out: 0, write: 0 })
  const hourShare = (m: string) => {
    const rs = exact.filter((r) => r.model === m)
    const of = (xs: typeof exact) => xs.reduce((a, r) => a + r.write, 0)
    const pick = of(rs) > 1e6 ? rs : exact
    return of(pick) ? pick.reduce((a, r) => a + (r.write1h || 0), 0) / of(pick) : 0
  }
  const split = (m: string, n: number): Tok => {
    const mix = usage[m] && sum(usage[m]) ? usage[m] : mixAll
    const tot = sum(mix) || 1
    const write = (n * mix.write) / tot
    return { in: (n * mix.in) / tot, cached: (n * mix.cached) / tot, out: (n * mix.out) / tot, write, write1h: write * hourShare(m) }
  }

  // If the transcripts reach back to Claude's own first session, nothing was cleaned up and
  // every day is exact. Otherwise days after the oldest transcript on disk are complete, and
  // older ones were partly deleted.
  const firstOnDisk = exact.reduce((m, r) => (r.day && r.day < m ? r.day : m), '9999')
  const complete = exact.length > 0 && !!claudeStats?.since && firstOnDisk <= claudeStats.since.slice(0, 10)
  const exactFrom = complete ? firstOnDisk : ledger.claudeOnDiskFrom ? dayKey(ledger.claudeOnDiskFrom + DAY) : null
  const daily = claudeStats?.dailyTokens || {}
  const replaced = new Set<string>()
  for (const [day, byModel] of Object.entries(daily)) {
    if (exactFrom && day >= exactFrom) continue
    const est = Object.entries(byModel).map(([m, n]) => [m, n * ratio(m)] as const)
    const onDisk = exact.filter((r) => r.day === day).reduce((a, r) => a + sum(r), 0)
    if (est.reduce((a, [, n]) => a + n, 0) <= onDisk) continue
    replaced.add(day)
    for (const [m, n] of est) if (n > 0) add(m, 'claude-code', split(m, n), day, true)
  }
  for (const r of exact) if (!replaced.has(r.day)) add(r.model, 'claude-code', r, r.day || null, false)

  // Before Claude recorded daily counts: its all-time totals, less every day accounted for above.
  if (claudeStats) {
    const last = claudeStats.lastComputed || ''
    for (const [m, t] of Object.entries(usage)) {
      let rest = sum(t)
      for (const byModel of Object.values(daily)) rest -= byModel[m] || 0
      for (const [day, byModel] of Object.entries(ledger.claudeRaw)) if (!daily[day] && exactFrom && day >= exactFrom && day <= last) rest -= byModel[m] || 0
      if (rest > 0) add(m, 'claude-code', split(m, rest * ratio(m)), null, true)
    }
  }

  const rows = [...models.values()]
    .map((t) => {
      const model = t.model
      const usd = costOf(model, t)
      return {
        model,
        source: t.source,
        input: Math.round(t.in),
        cached: Math.round(t.cached),
        output: Math.round(t.out),
        write: Math.round(t.write),
        tokens: Math.round(sum(t)),
        est: Math.round(t.est),
        usd,
        note: usd == null ? (model === 'unknown' ? 'the log doesn’t name the model' : UNPRICED[base(model)] || 'not in lore’s price list yet') : PRICE_NOTES[base(model)],
      }
    })
    .filter((r) => r.tokens > 0)
    .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1) || b.tokens - a.tokens)

  const bySource = SOURCE_KEYS.map((source) => {
    const rs = rows.filter((r) => r.source === source)
    return { source, usd: rs.reduce((s, r) => s + (r.usd || 0), 0), tokens: rs.reduce((s, r) => s + r.tokens, 0), estTokens: rs.reduce((s, r) => s + r.est, 0) }
  })
  const totalUsd = bySource.reduce((s, b) => s + b.usd, 0)
  const tokens = rows.reduce((s, r) => s + r.tokens, 0)
  const cached = rows.reduce((s, r) => s + r.cached, 0)

  // What Claude Code itself would show: its stats, plus every record since it last computed them.
  let counted = 0
  if (claudeStats) {
    counted = Object.values(usage).reduce((a, t) => a + sum(t), 0)
    for (const [day, byModel] of Object.entries(ledger.claudeRaw)) if (day > (claudeStats.lastComputed || '')) counted += Object.values(byModel).reduce((a, b) => a + b, 0)
  } else counted = rawAll

  // Plans: list price for each month you used that tool, over the same window the spend covers
  // (Claude's spend starts when its token stats do).
  const claudeFrom = claudeStats?.since ? Date.parse(claudeStats.since) : 0
  const months = Object.fromEntries(SOURCE_KEYS.map((k) => [k, new Set<string>()])) as Record<SourceName, Set<string>>
  for (const th of threads) for (const e of th.events) if (e.k === 'h' && (th.source !== 'claude-code' || e.t >= claudeFrom)) months[th.source].add(dayKey(e.t).slice(0, 7))
  const planRows = plans.map((p) => {
    const monthlyUsd = PLAN_USD[p.id] ?? null
    const n = months[p.source].size
    return { source: p.source, id: p.id, label: PLAN_LABEL[p.id] || p.id, monthlyUsd, months: n, paidUsd: monthlyUsd && ([monthlyUsd[0] * n, monthlyUsd[1] * n] as [number, number]) }
  })

  const perDay = [...claudeDay.values()].filter((v) => v > 0).sort((a, b) => a - b)
  const claudeTokens = bySource[0].tokens
  return {
    asOf: PRICES_AS_OF,
    sources: PRICE_SOURCES,
    totalUsd,
    tokens,
    estTokens: rows.reduce((s, r) => s + r.est, 0),
    subagentTokens: Object.values(ledger.subagentTokens).reduce((a, b) => a + b, 0),
    cacheShare: tokens ? cached / tokens : 0,
    bySource,
    models: rows,
    weekly: [...weekly.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week, v]) => ({ week, ...v })),
    claudeDailyFrom: [...claudeDay.keys()].sort()[0] || null,
    claudeExactFrom: exact.length ? exactFrom : null,
    claudeStatsFrom: claudeStats?.since ? claudeStats.since.slice(0, 10) : null,
    claudeUndatedUsd,
    claudeEstUsd,
    claudeCounter: counted > claudeTokens * 1.05 && claudeTokens > 0 ? { counted, processed: claudeTokens } : null,
    plans: planRows,
    claudePerActiveDay: perDay.length >= 7 ? perDay[Math.floor(perDay.length / 2)] : null,
  }
}
