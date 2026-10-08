// Anonymous aggregate statistics: counts and rounded shares, no text, paths, project
// names, session ids, device ids, or event times. The collector validates against this
// exact allowlist and rejects anything else, and publishes only aggregates, never rows.

import { VERSION } from '../version.ts'
import type { Report } from '../report-types.ts'
import type { SourceName } from '../types.ts'
import { ARCHETYPES } from './archetype.ts'
import { STEER_THEMES } from './classify.ts'
import { INTENTS, LANG_KEYS, MCP_KINDS, SWEARS } from './deep.ts'
import { isSource } from '../sources/registry.ts'
import { FIELDS, holds, REPO_FIELDS } from './indexAgg.ts'
import { canonicalModel } from './modelName.ts'
import { KNOWN_MODELS } from './spend.ts'
import { AGES, FILE_SIZES, FRAMEWORKS, HOSTS, LICENSES, TEAMS } from './vocab.ts'
import { TWINS } from './twins.ts'

export const STATS_SCHEMA = 'lore.stats.v5'

/** The privacy notice's version: bump it whenever the disclosure text changes. */
export const NOTICE = 'n1'
export const OSES = ['darwin', 'linux', 'windows', 'wsl'] as const

/** Facts about this machine rather than the history: where lore runs, and since when. */
export interface Machine {
  os: (typeof OSES)[number]
  /** YYYY-MM of lore's first run here. */
  firstRunMonth: string
  /** Lifetime runs here, this one included. */
  runs: number
  /** Which version of the privacy notice covered this payload. */
  notice: typeof NOTICE
}

/** The only replies a run can name as its most repeated prompt: short, generic, unidentifiable. */
export const REPLIES = ['yes', 'yep', 'ok', 'okay', 'continue', 'keep going', 'go', 'go ahead', 'do it', 'proceed', 'lgtm', 'sure', 'thanks', 'thank you', 'ship it', 'try again', 'fix it', 'commit', 'push', 'commit and push', 'run it', 'test it', 'next']

export interface AnonStats {
  schema: typeof STATS_SCHEMA
  client: string
  sources: SourceName[]
  history_months: number
  threads: number
  prompts: number
  active_days: number
  projects: number
  median_prompt_words: number
  steer_rate: number
  approval_rate: number
  interrupts_per_100: number
  night_share: number
  weekend_share: number
  model_share: Record<string, number>
  steer_themes: Record<string, number>
  /** Steer rate on follow-ups to each model family's work (only families with 100+ follow-ups, at most 24). */
  steer_by_model: Record<string, number>
  /** What opening prompts ask for, as shares of a fixed taxonomy. */
  intents: Record<string, number>
  archetype: string
  type_code: string
  agent_hours: number
  lines_added: number
  high_effort_share: number
  swear_per_100_by_tool: Record<string, number>
  median_seconds_to_steer: number
  api_usd: number
  swear_per_100: number
  // v4: for everyone
  please_per_100: number
  thanks_per_100: number
  caps_per_100: number
  /** The swear used most, from lore's fixed list, or "none". */
  top_swear: string
  /** The builder you work most like, by key. */
  twin: string
  /** The prompt sent most often, only when it's one of REPLIES; otherwise "none". */
  top_reply: string
  longest_session_hours: number
  streak_days: number
  tokens: number
  // v4: for the labs
  subagent_token_share: number
  agent_seconds_per_prompt: number
  actions_per_prompt: number
  cache_share: number
  tokens_per_prompt: number
  steers: number
  switches_after_steer: number
  /** Interrupt rate on follow-ups to each model family's work (100+ follow-ups, the same families). */
  interrupt_by_model: Record<string, number>
  // v5: tasks
  test_run_share: number
  red_green_threads: number
  long_threads: number
  spec_prompt_share: number
  edit_langs: Record<string, number>
  mcp_kinds: Record<string, number>
  // v5: the machine
  os: Machine['os']
  first_run_month: string
  lore_runs: number
  notice: Machine['notice']
  // v5, only with repo stats on
  repos?: number
  repos_tests?: number
  repos_ci?: number
  repos_container?: number
  agent_md?: number
  repo_frameworks?: Record<string, number>
  repo_files?: Record<string, number>
  repo_age?: Record<string, number>
  remote_hosts?: Record<string, number>
  license_families?: Record<string, number>
  team_size?: Record<string, number>
  kept_rate?: number
  revert_rate?: number
}

/** Metrics a run can be ranked on once enough people contribute. */
export const RANKED = [
  { key: 'prompts', label: 'prompts sent' },
  { key: 'agent_hours', label: 'hours of agent work' },
  { key: 'api_usd', label: 'API-equivalent spend' },
  { key: 'active_days', label: 'days with agents' },
  { key: 'lines_added', label: 'lines agents wrote' },
  { key: 'swear_per_100', label: 'swears per 100 prompts' },
] as const
export type RankKey = (typeof RANKED)[number]['key']

/**
 * Your share of runs at or above you, from a published distribution in steps (thin steps
 * merged): the runs below your step, plus your place inside it. Steps grow 1, 2, 5, 10…, so
 * that place is read on a log scale, the way the index places its percentiles: a merged step
 * can span decades ("2000-49999" while few runs are in), and read linearly it put a typical
 * run near the bottom. The step from 0 is read linearly.
 */
export function topShare(own: number, dist: Record<string, number>): number | null {
  const lo = (b: string) => Number(b.split(/[-+]/)[0])
  const runs = Object.values(dist).reduce((a, b) => a + b, 0)
  const mine = Object.keys(dist).find((b) => holds(b, own))
  if (!runs || !mine) return null
  const below = Object.entries(dist).filter(([b]) => lo(b) < lo(mine)).reduce((a, [, n]) => a + n, 0)
  const from = lo(mine)
  const top = mine.endsWith('+') ? from * 2 : Number(mine.split('-')[1]) + 1
  const at = from > 0 ? Math.log(own / from) / Math.log(top / from) : (own - from) / Math.max(1, top - from)
  const within = Math.min(1, Math.max(0, at))
  return Math.max(0.01, 1 - (below + dist[mine] * within) / runs)
}

/** Bytes of a payload the collector reads: a real one is about 2 KB, the largest it accepts under 5 KB. */
export const MAX_BODY = 16 * 1024

// What the collector accepts. buildStats fits every payload to these and validateStats checks
// them, so a history can cost a field its precision but never the whole send.
const THEME_KEYS = new Set(STEER_THEMES.map((t) => t.key))
const SWEAR_KEYS = new Set([...SWEARS.map((s) => s.word), 'none'])
const TWIN_KEYS = new Set([...TWINS.map((t) => t.key), 'none'])
const REPLY_KEYS = new Set([...REPLIES, 'none'])
const INTENT_KEYS = new Set([...INTENTS.map((i) => i.key), 'other'])
const ARCHETYPE_KEYS = new Set(ARCHETYPES.map((a) => a.key))
const MODEL_OK = (x: string) => x === 'other' || KNOWN_MODELS.has(x)
/** Ceilings no real history reaches: anything above is a bug or a forgery. Integers unless listed in DECIMALS. */
const MAX: Record<string, number> = { tokens: 1e15, tokens_per_prompt: 1e8, api_usd: 1e8, lines_added: 1e10, prompts: 1e8, threads: 1e7, steers: 1e8, agent_hours: 1e6 }
const ceiling = (k: string) => MAX[k] ?? 1e7
const DECIMALS = new Set(['agent_hours', 'swear_per_100', 'longest_session_hours', 'actions_per_prompt'])
/** Keys a map may carry: model shares 12, the other share maps 24, count maps 12 (each count 1 to 9999). */
const MODEL_KEYS = 12
const MAP_KEYS = 24
const COUNT_KEYS_MAX = 12
const COUNT_MAX = 9999
const MONTH = /^20\d\d-(0[1-9]|1[0-2])$/

const LANG_OK = new Set(Object.values(LANG_KEYS))
const MCP_OK = new Set([...MCP_KINDS.map(([k]) => k), 'other'])
const FW_OK = new Set(FRAMEWORKS.map(([k]) => k))
const COUNT_KEYS: Record<string, ReadonlySet<string>> = {
  mcp_kinds: MCP_OK,
  repo_frameworks: FW_OK,
  repo_files: new Set(FILE_SIZES),
  repo_age: new Set(AGES),
  remote_hosts: new Set(HOSTS),
  license_families: new Set(LICENSES),
  team_size: new Set(TEAMS),
}
const REPO = new Set<string>(REPO_FIELDS)
const NUMBER = (k: string, x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= ceiling(k) && (DECIMALS.has(k) ? Math.abs(Math.round(x * 10) - x * 10) < 1e-6 : Number.isInteger(x))
const SHARE = (x: unknown) => typeof x === 'number' && x >= 0 && x <= 1 && Math.abs(x * 20 - Math.round(x * 20)) < 1e-9
const ALLOWED = ['schema', 'client', 'sources', ...FIELDS.shares, ...Object.keys(FIELDS.ints), ...FIELDS.numbers, ...FIELDS.enums, ...FIELDS.maps, ...FIELDS.counts]

/** Exact, to a sensible precision: whole units, or one decimal for small rates and hours; never NaN, negative or past a ceiling. */
const finite = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
const int = (x: number, max = Infinity) => Math.min(max, Math.max(0, Math.round(finite(x))))
const dec = (x: number, max = Infinity) => Math.min(max, Math.max(0, Math.round(finite(x) * 10) / 10))
const round05 = (x: number) => Math.round(Math.min(1, Math.max(0, finite(x))) * 20) / 20
/** A share over a small denominator is coarser: under 5, quarters only. */
const roundShare = (num: number, den: number) => {
  const d = finite(den)
  if (d <= 0) return 0
  const x = Math.min(1, Math.max(0, finite(num) / d))
  return d < 5 ? Math.round(x * 4) / 4 : round05(x)
}
/** Largest first; ties by key, so the same history always sends the same keys. */
const largest = <T>(value: (x: T) => number) => (a: [string, T], b: [string, T]) => value(b[1]) - value(a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
/** A count map: keys from its fixed list, counts from 1 (zeros left out) to COUNT_MAX. */
const counts = (m: Record<string, number> | undefined, ok: ReadonlySet<string>) =>
  Object.fromEntries(Object.entries(m || {}).filter(([k, n]) => ok.has(k) && finite(n) >= 1).slice(0, COUNT_KEYS_MAX).map(([k, n]) => [k, int(n, COUNT_MAX)]))

/**
 * A model's public name, or "other". Custom deployments and internal endpoints can be named
 * anything (a company, a project, a person), so only names on lore's own list ever leave.
 * The collector checks against the same list; ship it before a client that adds models.
 */
export function publicModel(m: string): string {
  const id = canonicalModel(m)
  return KNOWN_MODELS.has(id) ? id : 'other'
}

/** Stand-in machine facts for payloads built outside a real run: the site's example, tests. */
export const exampleMachine = (r: Report): Machine => ({ os: 'darwin', firstRunMonth: new Date(r.generatedAt).toISOString().slice(0, 7), runs: 1, notice: NOTICE })

export function buildStats(r: Report, m: Machine = exampleMachine(r)): AnonStats {
  const prompts = finite(r.totals.prompts)
  const months = Math.max(1, Math.round(finite(r.totals.spanDays) / 30))
  // dated versions of one model add up first. A long history follows model releases, so it
  // can have more than 12 families at 5%: the 12 largest are sent.
  const fams = new Map<string, number>()
  for (const x of r.models) fams.set(publicModel(x.model), (fams.get(publicModel(x.model)) || 0) + finite(x.share))
  const modelShare: Record<string, number> = Object.fromEntries(
    [...fams]
      .sort(largest((v) => v))
      .map(([k, v]) => [k, round05(v)] as const)
      .filter(([, v]) => v >= 0.05)
      .slice(0, MODEL_KEYS),
  )
  const themes: Record<string, number> = {}
  for (const t of r.steering.themes) if (THEME_KEYS.has(t.key) && t.share >= 0.05) themes[t.key] = round05(t.share)
  // dated versions of one model add up, weighted by their follow-ups, before the rate; the 24
  // families with the most follow-ups are sent
  const byFam = new Map<string, { followups: number; steers: number; interrupts: number }>()
  for (const x of r.deep.steeringByModel) {
    const c = byFam.get(publicModel(x.model)) || { followups: 0, steers: 0, interrupts: 0 }
    c.followups += finite(x.followups)
    c.steers += finite(x.steers)
    c.interrupts += finite(x.interrupts)
    byFam.set(publicModel(x.model), c)
  }
  const steered = [...byFam].filter(([, c]) => c.followups > 0).sort(largest((c) => c.followups)).slice(0, MAP_KEYS)
  const steerByModel = Object.fromEntries(steered.map(([fam, c]) => [fam, round05(c.steers / c.followups)]))
  const interruptByModel = Object.fromEntries(steered.map(([fam, c]) => [fam, round05(c.interrupts / c.followups)]))
  const intents: Record<string, number> = {}
  for (const i of r.deep.intents) if (INTENT_KEYS.has(i.key) && i.share >= 0.05) intents[i.key] = round05(i.share)
  const swear: Record<string, number> = {}
  for (const s of r.deep.swear.bySource) if (isSource(s.source)) swear[s.source] = int(s.per100, 30)
  const per100 = (n: number, max: number) => int(prompts > 0 ? (finite(n) / prompts) * 100 : 0, max)
  const reply = (r.quotes[0]?.text || '').toLowerCase().replace(/[\s.!?…]+$/g, '').trim()
  const word = r.deep.swear.words[0]?.word || 'none'
  const twin = r.archetype.twin?.key || 'none'
  const tokens = finite(r.spend.tokens)
  const exact = tokens - finite(r.spend.estTokens)
  const tk = r.deep.tasks
  const rs = r.repoShape
  // languages as shares of the lines agents wrote, from lore's fixed list
  const lines = finite(r.deep.work.linesAdded)
  const langs: Record<string, number> = {}
  for (const l of [...r.deep.work.languages].sort((a, b) => finite(b.lines) - finite(a.lines))) {
    const share = round05(lines ? finite(l.lines) / lines : 0)
    const key = Object.hasOwn(LANG_KEYS, l.lang) ? LANG_KEYS[l.lang] : null
    if (share >= 0.05 && key && Object.keys(langs).length < MAP_KEYS) langs[key] = share
  }

  const out: AnonStats = {
    schema: STATS_SCHEMA,
    client: VERSION,
    sources: [...new Set(r.bySource.filter((s) => s.threads > 0).map((s) => s.source))].filter(isSource),
    history_months: int(months),
    threads: int(r.totals.threads),
    prompts: int(prompts),
    active_days: int(r.totals.activeDays),
    projects: int(r.totals.projects),
    median_prompt_words: int(r.style.medianWords),
    steer_rate: round05(r.steering.rate),
    approval_rate: round05(r.steering.approvalsShare),
    interrupts_per_100: int(r.steering.interruptsPer100, 50),
    night_share: round05(r.rhythm.nightShare),
    weekend_share: round05(r.rhythm.weekendShare),
    model_share: modelShare,
    steer_themes: themes,
    steer_by_model: steerByModel,
    intents,
    archetype: r.archetype.key,
    type_code: r.archetype.code,
    agent_hours: dec(r.deep.work.agentHours),
    lines_added: int(lines),
    high_effort_share: round05(r.deep.effort.highShare),
    swear_per_100_by_tool: swear,
    median_seconds_to_steer: int(r.deep.timeToSteer.medianSec),
    api_usd: int(r.spend.totalUsd),
    swear_per_100: dec(r.deep.swear.per100),
    please_per_100: per100(r.deep.manners.please, 100),
    thanks_per_100: per100(r.deep.manners.thanks, 100),
    caps_per_100: per100(r.deep.swear.allCaps, 50),
    top_swear: SWEAR_KEYS.has(word) ? word : 'none',
    twin: TWIN_KEYS.has(twin) ? twin : 'none',
    top_reply: REPLIES.includes(reply) ? reply : 'none',
    longest_session_hours: dec(finite(r.records.longestSession?.minutes) / 60),
    streak_days: int(r.streak.days),
    tokens: int(tokens),
    subagent_token_share: round05(exact > 0 ? finite(r.spend.subagentTokens) / exact : 0),
    agent_seconds_per_prompt: int(finite(r.deep.work.agentMinutesPerPrompt) * 60),
    actions_per_prompt: dec(r.deep.work.actionsPerPrompt),
    cache_share: round05(r.spend.cacheShare),
    // past its ceiling only when automated runs (SDK, exec) dwarf the prompts typed by hand
    tokens_per_prompt: int(prompts > 0 ? tokens / prompts : 0),
    steers: int(r.totals.steers),
    switches_after_steer: int(r.deep.crossTool.switches),
    interrupt_by_model: interruptByModel,
    test_run_share: roundShare(tk.tested, tk.agentThreads),
    red_green_threads: int(tk.redGreen),
    long_threads: int(tk.long),
    spec_prompt_share: roundShare(tk.specOpenings, tk.openings),
    edit_langs: langs,
    mcp_kinds: counts(Object.fromEntries(tk.mcpKinds.map((k) => [k, 1])), MCP_OK),
    os: OSES.includes(m.os) ? m.os : 'linux',
    first_run_month: MONTH.test(m.firstRunMonth) ? m.firstRunMonth : new Date().toISOString().slice(0, 7),
    lore_runs: int(m.runs),
    notice: m.notice,
    ...(rs
      ? {
          repos: int(rs.repos),
          repos_tests: int(rs.tests),
          repos_ci: int(rs.ci),
          repos_container: int(rs.container),
          agent_md: int(rs.agentMd),
          repo_frameworks: counts(Object.fromEntries(rs.frameworks.filter((k) => FW_OK.has(k)).slice(0, 8).map((k) => [k, 1])), FW_OK),
          repo_files: counts(rs.files, COUNT_KEYS.repo_files),
          repo_age: counts(rs.age, COUNT_KEYS.repo_age),
          remote_hosts: counts(rs.hosts, COUNT_KEYS.remote_hosts),
          license_families: counts(rs.licenses, COUNT_KEYS.license_families),
          team_size: counts(rs.team, COUNT_KEYS.team_size),
          kept_rate: roundShare(rs.outcomes.committed, rs.outcomes.checked),
          revert_rate: roundShare(rs.outcomes.reverted, rs.outcomes.committed),
        }
      : {}),
  }
  // every number to its ceiling, the one place they're all listed
  const o = out as unknown as Record<string, number>
  for (const k of FIELDS.numbers) if (k in o) o[k] = DECIMALS.has(k) ? dec(o[k], ceiling(k)) : int(o[k], ceiling(k))
  for (const [k, max] of Object.entries(FIELDS.ints)) o[k] = int(o[k], max)
  return out
}

/** Shared by client tests and the collector: returns a list of problems, empty when valid. */
export function validateStats(o: any): string[] {
  const errs: string[] = []
  if (!o || typeof o !== 'object' || Array.isArray(o)) return ['not an object']
  // repo stats come all together or not at all
  const withRepo = REPO_FIELDS.some((k) => k in o)
  const present = (k: string) => !REPO.has(k) || withRepo
  for (const k of Object.keys(o)) if (!ALLOWED.includes(k)) errs.push(`unexpected field ${k}`)
  for (const k of ALLOWED) if (present(k) && !(k in o)) errs.push(`missing ${k}`)
  if (o.schema !== STATS_SCHEMA) errs.push('bad schema')
  if (typeof o.client !== 'string' || !/^\d+\.\d+\.\d+$/.test(o.client)) errs.push('bad client')
  if (!Array.isArray(o.sources) || o.sources.some((s: unknown) => !isSource(s))) errs.push('bad sources')
  for (const k of FIELDS.numbers) if (present(k) && !NUMBER(k, o[k])) errs.push(`bad ${k}`)
  for (const k of FIELDS.shares) if (present(k) && !SHARE(o[k])) errs.push(`bad ${k}`)
  if (!OSES.includes(o.os)) errs.push('bad os')
  if (o.notice !== NOTICE) errs.push('bad notice')
  if (typeof o.first_run_month !== 'string' || !MONTH.test(o.first_run_month)) errs.push('bad first_run_month')
  for (const k of FIELDS.counts) {
    if (!present(k)) continue
    const m = o[k]
    if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).length > COUNT_KEYS_MAX) {
      errs.push(`bad ${k}`)
      continue
    }
    for (const [kk, v] of Object.entries(m)) if (!COUNT_KEYS[k].has(kk) || !Number.isInteger(v) || (v as number) < 1 || (v as number) > COUNT_MAX) errs.push(`bad ${k}.${kk}`)
  }
  for (const [k, max] of Object.entries(FIELDS.ints)) if (!Number.isInteger(o[k]) || o[k] < 0 || o[k] > max) errs.push(`bad ${k}`)
  if (!ARCHETYPE_KEYS.has(o.archetype)) errs.push('bad archetype')
  if (!SWEAR_KEYS.has(o.top_swear)) errs.push('bad top_swear')
  if (!TWIN_KEYS.has(o.twin)) errs.push('bad twin')
  if (!REPLY_KEYS.has(o.top_reply)) errs.push('bad top_reply')
  if (typeof o.type_code !== 'string' || !/^[DE][SA][LN][FC]$/.test(o.type_code)) errs.push('bad type_code')
  const shareMap = (k: string, keyOk: (x: string) => boolean, max = MAP_KEYS) => {
    const m = o[k]
    if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).length > max) return errs.push(`bad ${k}`)
    for (const [kk, v] of Object.entries(m)) if (!keyOk(kk) || !SHARE(v)) errs.push(`bad ${k}.${kk}`)
  }
  shareMap('steer_by_model', MODEL_OK)
  shareMap('interrupt_by_model', MODEL_OK)
  shareMap('intents', (x) => INTENT_KEYS.has(x))
  shareMap('edit_langs', (x) => LANG_OK.has(x))
  const sw = o.swear_per_100_by_tool
  if (!sw || typeof sw !== 'object') errs.push('bad swear_per_100_by_tool')
  else for (const [kk, v] of Object.entries(sw)) if (!isSource(kk) || !Number.isInteger(v) || (v as number) < 0 || (v as number) > 30) errs.push(`bad swear_per_100_by_tool.${kk}`)
  const ms = o.model_share
  if (!ms || typeof ms !== 'object' || Object.keys(ms).length > MODEL_KEYS) errs.push('bad model_share')
  else for (const [k, v] of Object.entries(ms)) if (!MODEL_OK(k) || !SHARE(v)) errs.push(`bad model_share.${k}`)
  const st = o.steer_themes
  if (!st || typeof st !== 'object') errs.push('bad steer_themes')
  else for (const [k, v] of Object.entries(st)) if (!THEME_KEYS.has(k) || !SHARE(v)) errs.push(`bad steer_themes.${k}`)
  return errs
}

/**
 * A refused payload's first problem, as a field name and nothing else: what the collector
 * counts, so a client bug shows up without logs. A map's keys and an unexpected field's name
 * are the sender's words, so they're never kept.
 */
export function rejectReason(errs: string[]): string {
  const e = errs[0] || ''
  if (e === 'not an object' || e === 'bad json' || e === 'too large') return e
  if (e.startsWith('unexpected field ')) return 'unexpected field'
  const m = e.match(/^(bad|missing) ([a-z0-9_]+)/)
  return m && ALLOWED.includes(m[2]) ? `${m[1]} ${m[2]}` : 'other'
}
