// The one internal event format. Every adapter produces ThreadRecords; everything
// downstream (facts, episodes, narrative, stats) reads only these.

import type { SourceName } from './sources/registry.ts'
export type { SourceName }

/** Where the conversation happened. `automated` threads were started by a program, not a person. */
/** Where a thread happened; `chat` is a personal agent reached through a messaging app. */
export type Surface = 'cli' | 'desktop' | 'ide' | 'chat' | 'automated'

export interface HumanEvent {
  k: 'h'
  /** Epoch ms. Approximate when the thread has `approxTimes`. */
  t: number
  /** Source-stable id used for deduplication (record uuid, or a content+time hash). */
  id: string
  text: string
  /** 1-based line in the source file, for "show me" links. */
  ln: number
  /** The person interrupted the agent right before sending this. */
  afterInterrupt?: boolean
}

/** One file changed in an agent turn: [path relative to the thread's cwd, lines added, lines removed]. */
export type EditStat = [string, number, number]

export interface AgentEvent {
  k: 'a'
  t: number
  id: string
  /** Visible assistant text for this turn, head + tail when long. Never reasoning. */
  text: string
  tools: number
  toolNames: string[]
  model?: string
  ln: number
  /** Last source line of this turn, so episodes can re-read its diffs on demand. */
  lnEnd?: number
  /** Agent working time for the turn, as the harness recorded it, or read from timestamps when `clock`. */
  ms?: number
  /** The harness recorded no durations: `ms` runs from the prompt through the turn's events, idle gaps left out. */
  clock?: true
  edits?: EditStat[]
  /** Shell commands the agent ran (clipped). */
  cmds?: string[]
  /** Tokens for this turn: [uncached input (incl. cache writes), cached input, output, cache writes]. */
  tok?: [number, number, number, number?, number?]
  effort?: string
}

export type ThreadEvent = HumanEvent | AgentEvent

export interface ThreadRecord {
  /** Canonical thread id (Claude session id, Codex thread id). */
  id: string
  source: SourceName
  surface: Surface
  file: string
  archived: boolean
  cwd: string
  /** Gemini CLI records only sha256(cwd); kept so the folder can be found among other agents' cwds. */
  cwdHash?: string
  project: string
  title?: string
  forkedFrom?: string
  approxTimes?: boolean
  startedAt: number
  endedAt: number
  events: ThreadEvent[]
  models: Record<string, number>
  toolCalls: number
  interrupts: number
  slashCommands: number
  /** Tokens by model: uncached input (incl. cache writes), cached input, output, cache writes. */
  tokens: Record<string, { in: number; cached: number; out: number; write?: number }>
  /** API-equivalent cost the harness itself computed (Claude Code's cost-state), when recorded. */
  costUsd?: number
  agentMs: number
  linesAdded: number
  linesRemoved: number
  efforts: Record<string, number>
  planModeTurns: number
  git?: { branch?: string; commit?: string; repo?: string }
  /** Test commands the agent ran, how many failed, and whether a failure later passed. */
  tests?: { runs: number; fails: number; redGreen: boolean }
  /** Codex plan-limit readings: [epoch ms, used percent, window minutes]. */
  limits?: { plan?: string; samples: [number, number, number][] }
  warnings: string[]
  /** Rebuilt from Claude Code's prompt history after its transcript was deleted: prompts only. */
  recovered?: boolean
}

/**
 * One API reply's token usage: [dedupe key, model, epoch ms, uncached input (incl. cache
 * writes), cached input, output, cache writes, of which one-hour cache writes]. Every file reports these, subagents
 * included, and the scan counts each key once across all files.
 */
export type UsageRow = [string, string, number, number, number, number, number, number?]

export interface FileUsage {
  rows: UsageRow[]
  /** A database's child sessions (spawned subagents): counted, but as subagent tokens. */
  subRows?: UsageRow[]
  /** Claude only: date → model → every usage record summed, repeats included, the way Claude Code's own counter adds them. */
  raw?: Record<string, Record<string, number>>
  /**
   * Agent working time in keyed slices [key, ms] (a Codex task by its turn id, a Claude reply by
   * its message id), so a subagent replaying its parent's turns counts each once. Main threads
   * report their keys only so subagent copies of them aren't counted as subagent work.
   */
  time?: [string, number][]
  /**
   * Codex only: this session and the one it came from (a fork's original, a subagent's
   * parent). Usage keyed by cumulative totals (`x|…`) only matches copies within one lineage.
   */
  lineage?: { id: string; parent?: string }
}

/**
 * Every API reply on disk, each counted once across all files (subagents and forks
 * included), summed by source, model and day.
 */
export interface UsageLedger {
  /** `write1h`: the part of `write` cached for an hour, which costs more than the default five minutes. */
  rows: { source: SourceName; model: string; day: string; in: number; cached: number; out: number; write: number; write1h: number; calls: number }[]
  /** Claude: day → model → every usage record summed, repeats included: Claude Code's own way of counting. */
  claudeRaw: Record<string, Record<string, number>>
  /** Oldest Claude transcript still on disk (by last write). Days after it are complete; older ones were cleaned up. */
  claudeOnDiskFrom: number | null
  /** Tokens spent by subagents, per source, each reply once. */
  subagentTokens: Record<SourceName, number>
  /** Subagent working time, per source, each turn once (copies of a parent's turns excluded). */
  subagentMs: Record<SourceName, number>
}

/** What an adapter reports about a file it looked at, whether or not it produced a thread. */
export type FileOutcome =
  | { kind: 'thread'; thread: ThreadRecord; usage?: FileUsage }
  /** A database holding many sessions (OpenCode, Kilo, OpenClaw). */
  | { kind: 'threads'; threads: ThreadRecord[]; usage?: FileUsage }
  | { kind: 'subagent'; usage?: FileUsage }
  | { kind: 'empty'; usage?: FileUsage }
  | { kind: 'error'; message: string }

export interface SourceCoverage {
  source: SourceName
  label: string
  root: string
  found: boolean
  files: number
  bytes: number
  archivedFiles: number
  /** Subagent transcripts: read for their token counts only, never as conversation. */
  subagentFiles: number
  automatedThreads: number
  emptyFiles: number
  duplicateThreads: number
  mainThreads: number
  desktopThreads: number
  firstAt: number | null
  lastAt: number | null
  /** Claude Code only: deleted sessions rebuilt from history.jsonl, and their prompts. */
  recoveredThreads?: number
  recoveredPrompts?: number
  warnings: string[]
}
