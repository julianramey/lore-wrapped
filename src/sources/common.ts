import type { AgentEvent, HumanEvent, ThreadEvent, ThreadRecord, UsageRow } from '../types.ts'
import { headTail } from '../util/text.ts'
import { mergeEdits, type ToolEffect } from './tools.ts'

/** Removes harness-injected tag blocks (system reminders, IDE context, env context). */
export function stripInjected(text: string): string {
  let s = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
  // Codex IDE extensions prepend editor context; the person's words follow this marker.
  if (/^\s*# Context from my IDE setup/.test(s)) {
    const m = s.match(/## My request for Codex:\s*([\s\S]*)$/)
    s = m ? m[1] : ''
  }
  // Desktop paste blocks are content the person supplied, not words they typed.
  s = s.replace(/<pasted_content\b[^>]*>([\s\S]*?)<\/pasted_content\b[^>]*>/g, (_, body: string) => {
    const lines = body.trim().split('\n').length
    return `[pasted ${lines} line${lines === 1 ? '' : 's'}]`
  })
  // Leading blocks like <environment_context>…</environment_context> or <nexus-context>…</nexus-context>
  for (let i = 0; i < 8; i++) {
    const m = s.match(/^\s*<([a-zA-Z][\w:-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>\s*/)
    if (!m) break
    s = s.slice(m[0].length)
  }
  return s.trim()
}

/** The most agent time a gap between two events can hold; the rest of a longer gap is idle. */
export const IDLE_MS = 30 * 60_000

/**
 * Collects a thread's visible conversation. Agent output between two human messages
 * becomes one agent turn; reasoning never enters.
 */
export class ThreadBuilder {
  events: ThreadEvent[] = []
  models: Record<string, number> = {}
  tokens: ThreadRecord['tokens'] = {}
  efforts: Record<string, number> = {}
  toolCalls = 0
  interrupts = 0
  agentMs = 0
  linesAdded = 0
  linesRemoved = 0
  /** Test runs and their outcomes; red→green is a failure the agent later turned into a pass. */
  tests = { runs: 0, fails: 0, redGreen: false }
  /** False when the source's timestamps aren't real; then no time is read from them. */
  clock = true
  // agent time read from timestamps, for threads whose harness recorded no durations:
  // from the prompt through each agent event, each gap counting for at most IDLE_MS
  private clockAt = 0
  private clockMs = 0
  private clocked: [AgentEvent, number][] = []
  /** Every event time seen, to find idle stretches inside a recorded duration. */
  private times: number[] = []
  private pendingInterrupt = false
  private agent: AgentEvent | null = null
  private last: AgentEvent | null = null
  private agentTexts: string[] = []

  interrupt() {
    this.interrupts++
    this.pendingInterrupt = true
  }

  human(e: Omit<HumanEvent, 'k' | 'afterInterrupt'>) {
    this.flushAgent()
    this.clockAt = e.t
    if (e.t) this.times.push(e.t)
    this.last = null
    const ev: HumanEvent = { k: 'h', ...e }
    if (this.pendingInterrupt) ev.afterInterrupt = true
    this.pendingInterrupt = false
    this.events.push(ev)
  }

  agentText(t: number, id: string, ln: number, text: string, model?: string) {
    const a = this.ensureAgent(t, id, ln, model)
    this.tick(t)
    if (text.trim()) this.agentTexts.push(text.trim())
    a.t = Math.max(a.t, t)
  }

  agentTool(t: number, id: string, ln: number, name: string, model?: string, effect?: ToolEffect) {
    const a = this.ensureAgent(t, id, ln, model)
    this.tick(t)
    a.tools++
    this.toolCalls++
    if (name && a.toolNames.length < 40) a.toolNames.push(name)
    if (t) a.t = Math.max(a.t, t)
    if (effect?.edits.length) {
      a.edits = mergeEdits(a.edits || [], effect.edits)
      for (const [, add, rem] of effect.edits) {
        this.linesAdded += add
        this.linesRemoved += rem
      }
    }
    if (effect?.cmds.length) a.cmds = [...(a.cmds || []), ...effect.cmds].slice(0, 20)
  }

  /** The agent was still working at `t` (a harness event outside the visible messages). */
  tick(t: number) {
    if (t) this.times.push(t)
    if (!t || !this.clockAt || t <= this.clockAt) return
    this.clockMs += Math.min(t - this.clockAt, IDLE_MS)
    this.clockAt = t
  }

  /** The turn ended (at `t`, when the harness says so): nothing after it is work until a turn starts. */
  turnEnd(t = 0) {
    this.tick(t)
    this.clockAt = 0
  }

  /** A turn the harness started without a typed prompt (a task resumed, a slash command). */
  turnStart(t: number) {
    if (!this.clockAt) this.clockAt = t
  }

  /**
   * Harness-recorded working time; it arrives after the turn's last message, at `end` when known.
   * A stretch inside it with no event for over IDLE_MS (a laptop asleep, a wait on subagents,
   * whose own time is counted apart) is idle, and only its first IDLE_MS counts.
   */
  agentDuration(ms: number, end = 0) {
    if (end > 0 && ms > 0) ms -= this.idleIn(end - ms, end)
    if (!(ms > 0)) return
    const a = this.agent || this.last
    if (a) a.ms = (a.ms || 0) + ms
    this.agentMs += ms
  }

  private idleIn(from: number, to: number): number {
    let idle = 0
    let prev = to
    let seen = 0
    for (let i = this.times.length - 1; i >= 0 && this.times[i] >= from; i--) {
      const t = this.times[i]
      if (t > prev) continue
      idle += Math.max(0, prev - t - IDLE_MS)
      prev = t
      seen++
    }
    // with no event inside, there's nothing to tell idle from work
    return seen ? idle + Math.max(0, prev - from - IDLE_MS) : 0
  }

  /** `input` is uncached input including cache writes; `write` is the cache-write part of it. */
  agentTokens(model: string | undefined, input: number, cached: number, output: number, write = 0, write1h = 0) {
    this.sessionTokens(model, input, cached, output, write)
    const a = this.agent || this.last
    if (a) {
      const tok = (a.tok ||= [0, 0, 0, 0, 0])
      tok[0] += input
      tok[1] += cached
      tok[2] += output
      tok[3] = (tok[3] || 0) + write
      tok[4] = (tok[4] || 0) + write1h
    }
  }

  /** Tokens known only for the whole session (Copilot's shutdown totals): no single turn spent them. */
  sessionTokens(model: string | undefined, input: number, cached: number, output: number, write = 0) {
    const m = model && model !== '<synthetic>' ? model : 'unknown'
    const cur = (this.tokens[m] ||= { in: 0, cached: 0, out: 0, write: 0 })
    cur.in += input
    cur.cached += cached
    cur.out += output
    cur.write = (cur.write || 0) + write
  }

  testResult(passed: boolean) {
    this.tests.runs++
    if (!passed) this.tests.fails++
    else if (this.tests.fails) this.tests.redGreen = true
  }

  effort(level: string | undefined) {
    if (!level) return
    const a = this.agent || this.last
    if (a && !a.effort) {
      a.effort = level
      this.efforts[level] = (this.efforts[level] || 0) + 1
    }
  }

  countModel(model: string | undefined) {
    if (!model || model === '<synthetic>') return
    this.models[model] = (this.models[model] || 0) + 1
  }

  /** Marks the furthest source line belonging to the current agent turn. */
  touch(ln: number) {
    if (this.agent) this.agent.lnEnd = Math.max(this.agent.lnEnd || 0, ln)
  }

  private ensureAgent(t: number, id: string, ln: number, model?: string): AgentEvent {
    if (!this.agent) {
      this.agent = { k: 'a', t, id, text: '', tools: 0, toolNames: [], ln }
      this.agentTexts = []
    }
    this.agent.lnEnd = Math.max(this.agent.lnEnd || 0, ln)
    if (model && model !== '<synthetic>') this.agent.model = model
    return this.agent
  }

  flushAgent() {
    if (this.agent && this.clockMs > 0) this.clocked.push([this.agent, this.clockMs])
    this.clockMs = 0
    if (!this.agent) return
    this.agent.text = headTail(this.agentTexts.join('\n\n'))
    this.events.push(this.agent)
    this.last = this.agent
    this.agent = null
    this.agentTexts = []
  }

  finish(): ThreadEvent[] {
    this.flushAgent()
    // A harness that recorded no turn durations (an older Codex, Claude Code before it wrote
    // them, most other agents) still timestamped the work: read the time from there.
    if (!this.agentMs && this.clock) {
      for (const [a, ms] of this.clocked) {
        a.ms = ms
        a.clock = true
        this.agentMs += ms
      }
    }
    return this.events
  }
}

/** Two records of the same API reply: keep the fullest count of each kind. */
export function mergeUsage(a: UsageRow, b: UsageRow): UsageRow {
  return [a[0], a[1], Math.min(a[2] || b[2], b[2] || a[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5]), Math.max(a[6], b[6]), Math.max(a[7] || 0, b[7] || 0)]
}
