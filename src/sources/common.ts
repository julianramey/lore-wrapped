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
    this.last = null
    const ev: HumanEvent = { k: 'h', ...e }
    if (this.pendingInterrupt) ev.afterInterrupt = true
    this.pendingInterrupt = false
    this.events.push(ev)
  }

  agentText(t: number, id: string, ln: number, text: string, model?: string) {
    const a = this.ensureAgent(t, id, ln, model)
    if (text.trim()) this.agentTexts.push(text.trim())
    a.t = Math.max(a.t, t)
  }

  agentTool(t: number, id: string, ln: number, name: string, model?: string, effect?: ToolEffect) {
    const a = this.ensureAgent(t, id, ln, model)
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

  /** Harness-recorded working time; it arrives after the turn's last message. */
  agentDuration(ms: number) {
    if (!(ms > 0)) return
    const a = this.agent || this.last
    if (a) a.ms = (a.ms || 0) + ms
    this.agentMs += ms
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
    if (!this.agent) return
    this.agent.text = headTail(this.agentTexts.join('\n\n'))
    this.events.push(this.agent)
    this.last = this.agent
    this.agent = null
    this.agentTexts = []
  }

  finish(): ThreadEvent[] {
    this.flushAgent()
    return this.events
  }
}

/** Two records of the same API reply: keep the fullest count of each kind. */
export function mergeUsage(a: UsageRow, b: UsageRow): UsageRow {
  return [a[0], a[1], Math.min(a[2] || b[2], b[2] || a[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5]), Math.max(a[6], b[6]), Math.max(a[7] || 0, b[7] || 0)]
}
