// Shapes shared by the local server and the browser report.

import type { Spend } from './pipeline/spend.ts'
import type { SourceCoverage, SourceName, Surface } from './types.ts'

export type { Spend }

export interface EvidenceRef {
  /** `${source}:${threadId}` */
  thread: string
  /** Index into the thread's events. */
  ev: number
}

export interface Example {
  ref: EvidenceRef
  text: string
  project: string
  at: number
  source: SourceName
  /** False when the text has a slur; featured spots skip these. Swearing is fine. */
  safe: boolean
}

/** Counted extras the agents' own stats screens don't show. */
export interface Extras {
  /** Agent replies read for catchphrases. */
  replies: number
  /** What agents kept saying back, once per reply. */
  catchphrases: { key: string; label: string; count: number; byModel: Record<string, number>; firstMonth: string; lastMonth: string }[]
  /** The prompt whose turn cost the most at API prices (main thread; subagents not split out). */
  priciest: { usd: number; words: number; model: string | null; example: Example } | null
  /** The shortest prompt (six words or fewer) that led to the most new lines. */
  bestValue: { lines: number; words: number; example: Example } | null
  /** Words you typed against lines agents wrote. */
  leverage: { words: number; lines: number; perWord: number } | null
  /** The most agent turns running at the same moment, across threads and tools. */
  parallel: { peak: number; at: number } | null
}

export interface ProjectFact {
  name: string
  prompts: number
  threads: number
  activeDays: number
  first: number
  last: number
  steers: number
  steerRate: number
  sources: SourceName[]
  topThemes: string[]
  asks: Example[]
  /** Prompts per week (Monday date → count), for the branch graph. */
  weeks: Record<string, number>
  /** The first and last prompt, for the branch graph's labels. */
  firstAsk?: Example
  lastWords?: Example
}

export interface ThemeFact {
  key: string
  label: string
  blurb: string
  count: number
  share: number
  examples: Example[]
}

export interface Moment {
  kind: string
  title: string
  detail: string
  example: Example
}

export interface DeepThread {
  key: string
  title: string
  project: string
  source: SourceName
  prompts: number
  steers: number
  days: number
  from: number
  to: number
  ref: EvidenceRef
}

export interface Spectrum {
  key: string
  /** Left and right pole names, e.g. Delegator ↔ Editor. */
  left: string
  right: string
  /** Bar position: 0.5 is typical; never quite 0 or 1. */
  value: number
  /** Standard deviations from typical, on a log scale; negative leans left. */
  z: number
  metric: string
  /** The typical value, e.g. "typical 10%". */
  typical: string
  /** The rule that maps the metric onto the bar. */
  rule: string
}

export interface Badge {
  key: string
  label: string
  why: string
}

export interface Archetype {
  key: string
  /** Position in the lore deck, I–XIV. */
  numeral: string
  name: string
  tagline: string
  lore: string
  signs: string
  enemy: string
  measured: string
  /** Four-letter type from the main spectra, e.g. "EANC". */
  code: string
  codeLegend: { letter: string; word: string; axis: string; means: string; rule: string }[]
  description: string
  superpower: string
  blindSpot: string
  why: string
  /** Every archetype's score, highest first, for the "% match" list. */
  matches: { key: string; name: string; score: number }[]
  spectra: Spectrum[]
  badges: Badge[]
  /** The builder you work most like, by the direction of your spectra. */
  /** The builder whose public way of working points the same way as yours. */
  twin: {
    key: string
    name: string
    known: string
    why: string
    match: number
    also: { key: string; name: string; match: number }[]
    /** Their defining traits, you and them as bar positions on the same spectra. */
    axes: { key: string; left: string; right: string; you: number; them: number }[]
  }
}

export interface CountRow {
  key: string
  label: string
  count: number
  share: number
  examples?: string[]
}

/** Counts across the repos agents edited in (only computed when repo stats are on). */
export interface RepoShape {
  repos: number
  /** Repos with a test suite, CI config, a container or dev-env file, an AGENTS.md-style file. */
  tests: number
  ci: number
  container: number
  agentMd: number
  /** Frameworks seen in any of them, from a fixed list. */
  frameworks: string[]
  /** Repo counts by tracked-file count, first-commit age, remote host, license family, and authors in 90 days. */
  files: Record<string, number>
  age: Record<string, number>
  hosts: Record<string, number>
  licenses: Record<string, number>
  team: Record<string, number>
  /** Recent agent-edit threads checked against git: committed within 72 h, reverted within 14 days. */
  outcomes: { checked: number; committed: number; reverted: number }
}

export interface Deep {
  /** What the work looks like as tasks someone could check. */
  tasks: {
    /** Threads where an agent did anything. */
    agentThreads: number
    /** …where it ran a test command. */
    tested: number
    /** …where a test failed and later passed (Claude Code and Codex record results). */
    redGreen: number
    /** …that ran 2+ hours of agent time or 100+ tool calls. */
    long: number
    /** Opening prompts that are asks, and how many run 100+ words. */
    openings: number
    specOpenings: number
    /** MCP server kinds the agents called, from a fixed list. */
    mcpKinds: string[]
  }
  work: {
    /** Agent time on record: each harness's turn timings, or its timestamps where it recorded none. */
    agentHours: number
    agentHoursBySource: Record<SourceName, number>
    /** Over 5% of prompts have no agent time on record (their transcripts are gone), so agentHours is a floor. */
    agentHoursFloor: boolean
    /** agentHours plus an estimate for the prompts with none on record, from their pace. */
    agentHoursEst: number
    /** Subagents' working time, each turn once; alongside the main agents, so not in agentHours. */
    subagentHours: number
    timedTurns: number
    medianTurnMin: number
    longestTurn: { min: number; project: string; title: string; ref: EvidenceRef } | null
    /** Tool calls per prompt, over prompts in threads with recorded replies. */
    actionsPerPrompt: number
    agentMinutesPerPrompt: number
    /** What the per-prompt numbers divide by: all prompts, those with recorded replies, those with turn times. */
    perPromptBasis: { prompts: number; observed: number; timed: number }
    linesAdded: number
    linesRemoved: number
    filesTouched: number
    languages: { lang: string; lines: number; files: number }[]
    topFiles: { file: string; project: string; turns: number; lines: number }[]
    commands: { total: number; categories: CountRow[]; top: { cmd: string; count: number }[] }
  }
  tokens: {
    input: number
    cached: number
    output: number
    byModel: { model: string; input: number; cached: number; output: number; total: number; source: SourceName }[]
  }
  limits: {
    plan: string | null
    weeklyPeaks: { week: string; used: number }[]
    weeksAtLimit: number
    windowsAtLimit: number
  } | null
  effort: { levels: CountRow[]; highShare: number; planModeTurns: number }
  /** Prompts that say please, and that say thanks. */
  manners: { please: number; thanks: number }
  swear: {
    prompts: number
    per100: number
    words: { word: string; count: number }[]
    bySource: { source: SourceName; count: number; per100: number }[]
    byProject: { project: string; count: number; per100: number }[]
    allCaps: number
    loudest: Example | null
    first: Example | null
    worstDay: { date: string; count: number } | null
    inSteers: number
  }
  steeringByModel: { model: string; source: SourceName; followups: number; steers: number; rate: number; interrupts: number }[]
  timeToSteer: { medianSec: number; fastest: Example | null; samples: number }
  chains: { longest: number; example: Example | null; recoveredShare: number }
  intents: CountRow[]
  crossTool: { projectsOnBoth: number; switches: number; example: { from: SourceName; to: SourceName; project: string; at: number; ref: EvidenceRef } | null }
  retention: {
    claudeSince: string | null
    claudeSessions: number
    transcriptSince: number | null
    transcriptSessions: number
    retentionDays: number
    configured: boolean
    missingDays: number
    /** Days Claude's own stats saw activity but whose transcripts are gone: date → messages. */
    ghostDays: Record<string, number>
  } | null
}

export interface LoreEntry {
  key: string
  /** Short category, e.g. "Origins", "Last seen". */
  kicker: string
  title: string
  body: string
  at: number
  /** True for facts about the whole record (a habit, a total) rather than a moment. */
  undated?: boolean
  example?: Example
}

export interface Era {
  month: string
  project: string
  /** Null when most of the month's prompts have no recorded model. */
  model: string | null
  /** The tool behind most of the month's prompts. */
  tool?: string
  prompts: number
}

export interface ModelStat {
  model: string
  label: string
  source: SourceName
  /** Prompts this model answered, from transcripts still on disk. */
  prompts: number
  /** Share of all your tokens. */
  share: number
  threads: number
  days: number
  first: number
  last: number
  agentHours: number
  linesAdded: number
  tokens: number
  usd: number | null
  /** Share of follow-ups that redirected it; null under 30 follow-ups. */
  steerRate: number | null
  topProject: string
}

/** What changed since your last run on this machine, at least a day ago. */
export interface Since {
  at: number
  version: string
  prompts: number
  threads: number
  projects: number
  usd: number
  newProjects: string[]
  card: { from: string; to: string } | null
  code: { from: string; to: string } | null
  twin: { from: string; to: string } | null
  steer: { from: number; to: number }
  /** What's new in lore since that run's version. */
  notes: string[]
}

export interface Report {
  version: string
  generatedAt: number
  timezone: string
  coverage: {
    sources: SourceCoverage[]
    scanMs: number
    filesParsed: number
    filesFromCache: number
    sampled: boolean
    from: number
    to: number
    surfaces: Record<Surface, number>
    /** The earliest evidence each tool was used, even if no prompt from then survives. */
    firstUse: Record<SourceName, number | null>
    /** The first prompt lore can actually read, per tool. */
    recordFrom: Record<SourceName, number | null>
    /** Time a tool was in use but its prompts are gone (Claude Code before its prompt history). */
    gap: { source: SourceName; from: number; to: number } | null
  }
  totals: {
    threads: number
    prompts: number
    words: number
    heated: number
    agentTurns: number
    toolCalls: number
    activeDays: number
    spanDays: number
    projects: number
    interrupts: number
    slashCommands: number
    asks: number
    steers: number
    approvals: number
    followups: number
  }
  bySource: { source: SourceName; label: string; prompts: number; threads: number; first: number | null; last: number | null }[]
  streak: { days: number; from: string; to: string }
  busiestDay: { date: string; prompts: number; projects: string[] }
  rhythm: { hours: number[]; weekdays: number[]; grid: number[][]; peakHour: number; nightShare: number; weekendShare: number; earlyShare: number; /** 6pm–6am: the night half of the clock */ afterHoursShare: number }
  /** Prompts per month, by source in SOURCE_KEYS order. */
  months: { month: string; by: number[] }[]
  calendar: Record<string, number>
  /** date → prompts by source, in SOURCE_KEYS order */
  calendarBySource: Record<string, number[]>
  /** Personal bests, measured across both tools from prompts on record. */
  records: {
    /** Runs of prompts with no gap over 45 minutes. */
    sessions: number
    sessionHours: number
    longestSession: { minutes: number; prompts: number; from: number; to: number; project: string; example?: Example } | null
    /** The roughest day: swears, all-caps and redirects, counted. */
    rockBottom: { date: string; swears: number; caps: number; steers: number; prompts: number; example?: Example } | null
  }
  /** Your models, by tokens processed; details from transcripts still on disk. */
  favoriteModels: ModelStat[]
  /** Words you used most, stopwords and project names left out. */
  topWords: { word: string; count: number }[]
  /** Prompts you sent word for word, again and again. */
  quotes: { text: string; count: number; threads: number; first: number; last: number; example: Example }[]
  spend: Spend
  extras: Extras
  projects: ProjectFact[]
  models: { model: string; messages: number; share: number; source: SourceName }[]
  steering: { rate: number; interruptsPer100: number; approvalsShare: number; themes: ThemeFact[]; examples: Example[] }
  style: { medianWords: number; p90Words: number; oneLinerShare: number; questionShare: number; longest: Example | null; first: Example | null; latest: Example | null }
  phrases: { text: string; threads: number; count: number; safe: boolean; example: Example }[]
  deepest: DeepThread[]
  moments: Moment[]
  archetype: Archetype
  deep: Deep
  lore: LoreEntry[]
  eras: Era[]
  definitions: Record<string, string>
  since?: Since | null
  /** Counts across the repos agents edited in; only when repo stats are on. Local until sent as stats. */
  repoShape?: RepoShape
}

export interface EvidenceView {
  thread: string
  title: string
  project: string
  source: SourceName
  file: string
  focus: number
  events: { idx: number; k: 'h' | 'a'; t: number; text: string; tools?: number; toolNames?: string[]; ln: number; afterInterrupt?: boolean; kind?: string; rule?: string }[]
}
