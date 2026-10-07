// The lore index, built from anonymous stats rows: a median for every number and share, the
// whole distribution of every number (in steps of 1, 2, 5, 10, 20, 50…), counts for every
// fixed-list answer, and per-key medians for the maps. A slice shows only once K runs
// contribute to it, and thin steps merge with their neighbors, so no single run can be picked
// out. Rows themselves are never published. Pure: the collector runs it over everyone's rows, the site
// over the seed.

/** Which stats fields are which, for validation and for the index. */
export const FIELDS = {
  shares: ['steer_rate', 'approval_rate', 'night_share', 'weekend_share', 'high_effort_share', 'subagent_token_share', 'cache_share', 'test_run_share', 'spec_prompt_share', 'kept_rate', 'revert_rate'],
  ints: { interrupts_per_100: 50, please_per_100: 100, thanks_per_100: 100, caps_per_100: 50 } as Record<string, number>,
  /** exact numbers; the index shows them as distributions, never one run's value */
  numbers: [
    'history_months',
    'threads',
    'prompts',
    'active_days',
    'projects',
    'median_prompt_words',
    'agent_hours',
    'lines_added',
    'median_seconds_to_steer',
    'api_usd',
    'swear_per_100',
    'longest_session_hours',
    'streak_days',
    'tokens',
    'agent_seconds_per_prompt',
    'actions_per_prompt',
    'tokens_per_prompt',
    'steers',
    'switches_after_steer',
    'red_green_threads',
    'long_threads',
    'lore_runs',
    'repos',
    'repos_tests',
    'repos_ci',
    'repos_container',
    'agent_md',
  ],
  enums: ['archetype', 'type_code', 'twin', 'top_swear', 'top_reply', 'os', 'notice', 'first_run_month'],
  /** key → share */
  maps: ['model_share', 'steer_themes', 'steer_by_model', 'intents', 'swear_per_100_by_tool', 'interrupt_by_model', 'edit_langs'],
  /** key → a count (presence lists send 1) */
  counts: ['mcp_kinds', 'repo_frameworks', 'repo_files', 'repo_age', 'remote_hosts', 'license_families', 'team_size'],
} as const

/**
 * Sent only when someone turns on repo stats (`lore stats repos on`): counts across the git
 * repos agents edited in. Off by default because it means reading the repos, not just the
 * agents' history.
 */
export const REPO_FIELDS = ['repos', 'repos_tests', 'repos_ci', 'repos_container', 'agent_md', 'repo_frameworks', 'repo_files', 'repo_age', 'remote_hosts', 'license_families', 'team_size', 'kept_rate', 'revert_rate'] as const

/**
 * Every field a run sends, in plain words: the privacy page prints this list, and a test
 * fails if a field is sent without one. Numbers are exact, shares are rounded to 5%, and
 * named values come from short fixed lists.
 */
export const FIELD_DOCS: Record<string, string> = {
  schema: 'which version of this list the payload follows',
  client: 'the lore version that sent it',
  sources: 'which agents you use (Claude Code, Codex, …), no versions or accounts',
  history_months: 'how many months of history lore could read',
  threads: 'how many conversations',
  prompts: 'how many prompts you sent',
  active_days: 'how many days you used agents',
  projects: 'how many projects (never their names)',
  median_prompt_words: 'how many words a typical prompt runs',
  steer_rate: 'the share of your follow-ups that redirect the agent',
  approval_rate: 'the share of your follow-ups that are short approvals (“yes”, “go”)',
  interrupts_per_100: 'how often you stop an agent mid-turn, per 100 prompts',
  night_share: 'the share of prompts sent between 10pm and 4am',
  weekend_share: 'the share of prompts sent on weekends',
  model_share: 'which model families did your work, as rounded shares',
  steer_themes: 'what your redirects are about, from a fixed list (“it’s broken”, “simplify”…)',
  steer_by_model: 'how often each model family gets redirected',
  intents: 'what opening prompts ask for, from a fixed list (fix, build, explain…)',
  archetype: 'your card in the lore deck',
  type_code: 'your four-letter code',
  agent_hours: 'hours agents worked for you',
  lines_added: 'lines agents wrote',
  high_effort_share: 'the share of agent turns at the highest effort setting',
  swear_per_100_by_tool: 'swears per 100 prompts, per agent',
  median_seconds_to_steer: 'how many seconds you typically take to redirect after a reply',
  api_usd: 'what your tokens would cost at API list prices, in dollars',
  swear_per_100: 'swears per 100 prompts',
  please_per_100: 'prompts with a “please”, per 100',
  thanks_per_100: 'prompts with a “thanks”, per 100',
  caps_per_100: 'all-caps prompts, per 100',
  top_swear: 'your most used swear, only from lore’s fixed list, or “none”',
  twin: 'which builder your way of working points toward',
  top_reply: 'your most repeated prompt, only if it’s a short stock reply (“yes”, “continue”…), otherwise “none”',
  longest_session_hours: 'your longest session, in hours',
  streak_days: 'your longest daily streak, in days',
  tokens: 'tokens processed',
  subagent_token_share: 'the share of tokens spent by subagents',
  agent_seconds_per_prompt: 'seconds of agent work per prompt',
  actions_per_prompt: 'tool calls per prompt',
  cache_share: 'the share of tokens that were cached context',
  tokens_per_prompt: 'tokens per prompt',
  steers: 'how many redirects in total',
  switches_after_steer: 'how often you switched agents right after redirecting one',
  interrupt_by_model: 'how often each model family gets stopped mid-turn',
  // v5: what the work looks like as tasks someone could check
  test_run_share: 'the share of conversations where an agent ran your tests',
  red_green_threads: 'conversations where a test failed and later passed',
  long_threads: 'conversations with 2+ hours of agent work or 100+ tool calls',
  spec_prompt_share: 'the share of opening prompts that run 100 words or more',
  edit_langs: 'which languages agents edited, as rounded shares of lines, from a fixed list',
  mcp_kinds: 'which kinds of MCP tools agents used (issue tracker, database, browser…), from a fixed list, never server names',
  os: 'macOS, Linux, Windows or WSL',
  first_run_month: 'the month lore first ran on this machine, so we can tell new runs from returning ones without an id',
  lore_runs: 'how many times lore has run on this machine',
  notice: 'which version of the privacy notice was in effect (never whether you were asked, which would hint at where you live)',
  // v5, only with repo stats on: counts across the repos agents edited in, never one repo
  repos: 'how many git repos agents edited in (repo stats only)',
  repos_tests: 'how many of them have a test suite (repo stats only)',
  repos_ci: 'how many have CI config (repo stats only)',
  repos_container: 'how many have a Dockerfile, compose file, devcontainer or Nix file (repo stats only)',
  agent_md: 'how many have an AGENTS.md, CLAUDE.md or GEMINI.md (repo stats only)',
  repo_frameworks: 'which frameworks appear, from a fixed list, never package names (repo stats only)',
  repo_files: 'how many repos fall in each size range by tracked files (repo stats only)',
  repo_age: 'how many repos fall in each age range since their first commit (repo stats only)',
  remote_hosts: 'how many repos are on GitHub, GitLab, Bitbucket, Azure, elsewhere or nowhere; never the URL (repo stats only)',
  license_families: 'how many repos are permissive, copyleft, other or unlicensed (repo stats only)',
  team_size: 'how many repos had 1, 2–5, 6–20 or 21+ authors in 90 days; authors are counted, never sent (repo stats only)',
  kept_rate: 'the share of recent agent edits committed within 72 hours (repo stats only)',
  revert_rate: 'the share of those commits reverted within 14 days (repo stats only)',
}

/** The fields every run sends, without repo stats. */
export const DEFAULT_FIELDS = Object.keys(FIELD_DOCS).filter((k) => !(REPO_FIELDS as readonly string[]).includes(k))

export interface IndexAgg {
  runs: number
  /** Runs a slice needs before it's shown. */
  k: number
  /** field → median, for shares and per-100 counts */
  median: Record<string, number>
  /** field → bucket → runs */
  dist: Record<string, Record<string, number>>
  /** field → everyone's runs added up ("lore users ran 1.2T tokens") */
  totals: Record<string, number>
  /** field → the 10th, 25th, 50th, 75th and 90th percentile */
  quantiles: Record<string, [number, number, number, number, number]>
  /** field → the answers enough runs gave, with their share of all runs */
  enums: Record<string, { key: string; share: number }[]>
  /** field → per-key medians, for keys enough runs report */
  maps: Record<string, { key: string; runs: number; median: number }[]>
}

const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

export function aggregate(rows: any[], k: number): IndexAgg {
  const out: IndexAgg = { runs: rows.length, k, median: {}, dist: {}, totals: {}, quantiles: {}, enums: {}, maps: {} }
  if (rows.length < k) return out
  for (const f of [...FIELDS.shares, ...Object.keys(FIELDS.ints), ...FIELDS.numbers]) {
    const xs = rows.map((r) => r[f]).filter((x): x is number => typeof x === 'number')
    if (xs.length >= k) out.median[f] = med(xs)
  }
  // whole distributions in steps, but no step with fewer than K runs: a thin one joins its
  // neighbor ("1000-1999" and "2000-4999" become "1000-4999"), so nothing is dropped and
  // nobody stands out
  for (const f of FIELDS.numbers) {
    const xs = rows.map((r) => r[f]).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b)
    if (xs.length >= k) {
      out.totals[f] = Math.round(xs.reduce((a, b) => a + b, 0) * 10) / 10
      const q = (p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]
      out.quantiles[f] = [q(0.1), q(0.25), q(0.5), q(0.75), q(0.9)]
    }
    const d: Record<string, number> = {}
    for (const r of rows) if (typeof r[f] === 'number') d[step(r[f])] = (d[step(r[f])] || 0) + 1
    // a field fewer than K runs send (repo stats are opt-in) has no distribution at all:
    // merging can't make a step of K out of fewer runs
    if (xs.length >= k) out.dist[f] = mergeThin(d, k)
  }
  for (const f of FIELDS.enums) {
    const c = new Map<string, number>()
    for (const r of rows) if (typeof r[f] === 'string') c.set(r[f], (c.get(r[f]) || 0) + 1)
    out.enums[f] = [...c]
      .filter(([, n]) => n >= k)
      .map(([key, n]) => ({ key, share: n / rows.length }))
      .sort((a, b) => b.share - a.share)
  }
  for (const f of [...FIELDS.maps, ...FIELDS.counts]) {
    const by = new Map<string, number[]>()
    for (const r of rows) for (const [key, v] of Object.entries<unknown>(r[f] || {})) if (typeof v === 'number') by.set(key, [...(by.get(key) || []), v])
    out.maps[f] = [...by]
      .filter(([, v]) => v.length >= k)
      .map(([key, v]) => ({ key, runs: v.length, median: med(v) }))
      .sort((a, b) => b.median - a.median)
  }
  return out
}

/** The index's steps: 0, 1, 2, 5, 10, 20, 50… up to the trillions. */
export const STEPS = [0, ...Array.from({ length: 15 }, (_, e) => [1, 2, 5].map((m) => m * 10 ** e)).flat()]
/** A number's step, as a range label: 7836 → "5000-9999". */
export function step(x: number): string {
  for (let i = 0; i < STEPS.length - 1; i++) if (x < STEPS[i + 1]) return `${STEPS[i]}-${STEPS[i + 1] - 1}`
  return `${STEPS[STEPS.length - 1]}+`
}

const lo = (b: string) => Number(b.split(/[-+]/)[0])
const hi = (b: string) => (b.endsWith('+') ? Infinity : Number(b.split('-')[1]))

/** Joins neighboring buckets, lowest first, until every one has at least k runs. */
export function mergeThin(d: Record<string, number>, k: number): Record<string, number> {
  const sorted = Object.entries(d).sort((a, b) => lo(a[0]) - lo(b[0]))
  type Group = { from: string; to: string; n: number }
  const groups: Group[] = []
  let cur: Group | null = null
  for (const [b, n] of sorted) {
    const next: Group = cur ? { from: cur.from, to: b, n: cur.n + n } : { from: b, to: b, n }
    if (next.n >= k) {
      groups.push(next)
      cur = null
    } else cur = next
  }
  if (cur) {
    // what's left over joins the group below it
    const last = groups.pop()
    groups.push(last ? { from: last.from, to: cur.to, n: last.n + cur.n } : cur)
  }
  const label = (g: { from: string; to: string }) => (g.from === g.to ? g.from : g.to.endsWith('+') ? `${lo(g.from)}+` : `${lo(g.from)}-${hi(g.to)}`)
  return Object.fromEntries(groups.map((g) => [label(g), g.n]))
}

/** Whether a published (possibly merged) step holds a run's own value. */
export const holds = (published: string, own: number) => own >= lo(published) && own < hi(published) + 1

// ───────────────────────── the same index from counters, for a collector with millions of rows
//
// Every field is a small set of counters a row adds to: a count per value for shares, small
// counts and fixed-list answers (so their medians are exact), and for numbers a count per
// published step, a running total, and a count per fine bin (24 to a decade, about 10% wide)
// to place medians and percentiles. The collector keeps only these, so building the index
// never has to read the rows back.

const BINS = 24
const bin = (x: number) => (x <= 0 ? -999 : Math.floor(Math.log10(x) * BINS))
const binLo = (b: number) => (b === -999 ? 0 : 10 ** (b / BINS))
const binHi = (b: number) => (b === -999 ? 0 : 10 ** ((b + 1) / BINS))

/** Adds one stats row to a month's counters (key → count). Decimal totals are kept in tenths. */
export function countRow(c: Map<string, number>, row: any) {
  const inc = (k: string, by = 1) => c.set(k, (c.get(k) || 0) + by)
  inc('n')
  for (const f of [...FIELDS.shares, ...Object.keys(FIELDS.ints)]) if (typeof row[f] === 'number') inc(`v\t${f}\t${row[f]}`)
  for (const f of FIELDS.numbers) {
    const x = row[f]
    if (typeof x !== 'number') continue
    inc(`d\t${f}\t${step(x)}`)
    inc(`b\t${f}\t${bin(x)}`)
    inc(`s\t${f}`, Math.round(x * 10))
  }
  for (const f of FIELDS.enums) if (typeof row[f] === 'string') inc(`e\t${f}\t${row[f]}`)
  for (const f of [...FIELDS.maps, ...FIELDS.counts]) for (const [k, v] of Object.entries<unknown>(row[f] || {})) if (typeof v === 'number') inc(`m\t${f}\t${k}\t${v}`)
}

/** The value at the middle (or any) position of a histogram, the way `med` reads sorted values. */
function fromHistogram(h: [number, number][], at: number): number {
  let seen = 0
  for (const [v, n] of h.sort((a, b) => a[0] - b[0])) if ((seen += n) > at) return v
  return h.length ? h[h.length - 1][0] : 0
}

/** The index from a month's counters: the same shape and rules as `aggregate`. */
export function aggregateCounts(c: Map<string, number>, k: number): IndexAgg {
  const runs = c.get('n') || 0
  const out: IndexAgg = { runs, k, median: {}, dist: {}, totals: {}, quantiles: {}, enums: {}, maps: {} }
  if (runs < k) return out
  const groups = new Map<string, [string[], number][]>()
  for (const [key, n] of c) {
    const [kind, ...rest] = key.split('\t')
    if (kind === 'n') continue
    const g = `${kind}\t${rest[0]}`
    groups.set(g, [...(groups.get(g) || []), [rest.slice(1), n]])
  }
  const get = (kind: string, f: string) => groups.get(`${kind}\t${f}`) || []
  for (const f of [...FIELDS.shares, ...Object.keys(FIELDS.ints)]) {
    const h = get('v', f).map(([[v], n]) => [Number(v), n] as [number, number])
    const total = h.reduce((a, [, n]) => a + n, 0)
    if (total >= k) out.median[f] = fromHistogram(h, Math.floor(total / 2))
  }
  for (const f of FIELDS.numbers) {
    const d = Object.fromEntries(get('d', f).map(([[label], n]) => [label, n]))
    if (Object.values(d).reduce((a, b) => a + b, 0) >= k) out.dist[f] = mergeThin(d, k)
    const bins = get('b', f).map(([[b], n]) => [Number(b), n] as [number, number]).sort((a, b) => a[0] - b[0])
    const total = bins.reduce((a, [, n]) => a + n, 0)
    if (total < k) continue
    // a percentile: the bin it falls in, then geometrically across that bin
    const q = (p: number) => {
      const at = Math.min(total - 1, Math.floor(p * total))
      let seen = 0
      for (const [b, n] of bins) {
        if (seen + n > at) {
          if (b === -999) return 0
          const f2 = (at - seen + 0.5) / n
          const x = binLo(b) * (binHi(b) / binLo(b)) ** f2
          return x >= 100 ? Math.round(x) : Math.round(x * 10) / 10
        }
        seen += n
      }
      return 0
    }
    out.median[f] = q(0.5)
    out.quantiles[f] = [q(0.1), q(0.25), q(0.5), q(0.75), q(0.9)]
    out.totals[f] = (c.get(`s\t${f}`) || 0) / 10
  }
  for (const f of FIELDS.enums)
    out.enums[f] = get('e', f)
      .filter(([, n]) => n >= k)
      .map(([[key], n]) => ({ key, share: n / runs }))
      .sort((a, b) => b.share - a.share)
  for (const f of [...FIELDS.maps, ...FIELDS.counts]) {
    const by = new Map<string, [number, number][]>()
    for (const [[key, v], n] of get('m', f)) by.set(key, [...(by.get(key) || []), [Number(v), n]])
    out.maps[f] = [...by]
      .map(([key, h]) => ({ key, runs: h.reduce((a, [, n]) => a + n, 0), h }))
      .filter((x) => x.runs >= k)
      .map(({ key, runs: rn, h }) => ({ key, runs: rn, median: fromHistogram(h, Math.floor(rn / 2)) }))
      .sort((a, b) => b.median - a.median)
  }
  return out
}

/** A bucket's midpoint, for rough sums over a distribution ("about 1.2B tokens counted"). */
export function midpoint(b: string): number {
  if (b.endsWith('+')) return Number(b.slice(0, -1)) * 1.5
  const [lo, hi] = b.split('-').map(Number)
  return (lo + hi + 1) / 2
}
