// Episode candidates: a scoped moment where a person redirected an agent, with the
// context before it and what followed. Local code finds and ranks them; the owner
// decides what, if anything, leaves the machine.

import type { EvidenceRef } from '../report-types.ts'
import type { AgentEvent, EditStat, HumanEvent, SourceName, ThreadRecord } from '../types.ts'
import { hasSlur, hasProfanity, looksPasted } from '../util/safety.ts'
import { clip, monthKey, wordCount } from '../util/text.ts'
import { sha1 } from '../util/hash.ts'
import { STEER_THEMES, type ClassifiedThread } from './classify.ts'
import { readTurnDiff } from './diffs.ts'
import { threadKey } from './facts.ts'
import { gitOutcome, type GitSignal } from './git.ts'
import type { RedactionCounts } from './redact.ts'
import { DEFAULT_PRICING, valueEpisode, type EpisodeValue, type Pricing } from './value.ts'

export interface EpisodeTurn {
  role: 'human' | 'agent'
  text: string
  tools?: number
  toolNames?: string[]
}

export interface Change {
  files: EditStat[]
  diff: string
}

export interface EpisodeCandidate {
  id: string
  thread: string
  title: string
  project: string
  source: SourceName
  model?: string
  at: number
  score: number
  why: string[]
  opening: string | null
  context: EpisodeTurn[]
  attemptChange: Change | null
  steer: { text: string; afterInterrupt: boolean; themes: string[]; rule: string }
  response: EpisodeTurn | null
  revisedChange: Change | null
  next: { text: string; kind: string } | null
  git: GitSignal | null
  value: EpisodeValue | null
  evidence: { observed: string[]; expressedApproval: string | null; verifiedOutcome: null }
  missing: string[]
  refs: EvidenceRef[]
}

export interface EpisodeFunnel {
  steers: number
  withAttempt: number
  withCodeBefore: number
  withCodePair: number
  shortlisted: number
}

/** Exactly what an approved episode uploads. No project names, ids, paths, hashes or exact times. */
export interface EpisodePayload {
  schema: 'lore.episode.v2'
  level: 'steering_trace' | 'artifact_linked'
  source: SourceName
  model: string | null
  month: string
  opening: string | null
  context: EpisodeTurn[]
  attempt_change: { files: { path: string; added: number; removed: number }[]; diff: string } | null
  steer: { text: string; after_interrupt: boolean; themes: string[] }
  response: EpisodeTurn | null
  revised_change: { files: { path: string; added: number; removed: number }[]; diff: string } | null
  next: { text: string; kind: string } | null
  evidence: {
    observed: string[]
    expressed_approval: string | null
    git: { committed: boolean; minutes_after: number | null; files_matched: number; later_changes_14d: number | null; reverted: boolean | null; basis: string } | null
    verified_outcome: null
  }
  missing_context: string[]
  redactions: RedactionCounts
  analysis: Record<string, unknown> | null
}

const MAX_TEXT = 4000
const SECRETISH = /\b(sk|pk|rk)_(live|test)_|\bsk-[A-Za-z0-9]{12,}|\b(api[_-]?key|secret|password|token)\s*[:=]|pairing code/i
const STEER_START_HINT = /^(no|not|don'?t|stop|wait|actually|instead|wrong|why)\b/i

export function findCandidates(classified: ClassifiedThread[], limit = 20): { candidates: EpisodeCandidate[]; funnel: EpisodeFunnel } {
  const all: EpisodeCandidate[] = []
  const funnel: EpisodeFunnel = { steers: 0, withAttempt: 0, withCodeBefore: 0, withCodePair: 0, shortlisted: 0 }
  for (const ct of classified) {
    const t = ct.thread
    const humans = ct.humans
    for (let hi = 0; hi < humans.length; hi++) {
      const h = humans[hi]
      if (h.c.kind !== 'steer') continue
      funnel.steers++
      const prev = t.events[h.idx - 1]
      if (!prev || prev.k !== 'a') continue
      funnel.withAttempt++
      const steerText = h.ev.text
      const w = wordCount(steerText)
      if (hasSlur(steerText) || w < 4) continue

      // The instruction the agent was attempting: the human message before its attempt.
      const priorHuman = humans[hi - 1]
      const attempt = prev as AgentEvent
      const after = t.events[h.idx + 1]
      const response = after && after.k === 'a' ? (after as AgentEvent) : null
      const nextH = humans[hi + 1] && humans[hi + 1].idx === h.idx + 2 ? humans[hi + 1] : null
      const opening = humans[0] && humans[0].idx !== priorHuman?.idx ? humans[0] : null
      const before = attempt.edits?.length ? attempt.edits : null
      const afterEdits = response?.edits?.length ? response.edits : null
      if (before) funnel.withCodeBefore++
      if (before && afterEdits) funnel.withCodePair++

      const why: string[] = []
      let score = 0
      if (w >= 8 && w <= 150) {
        score += 1
        why.push('substantive steer')
      } else if (w > 150) score -= 1
      if (h.ev.afterInterrupt) {
        score += 1.5
        why.push('interrupted the agent')
      }
      if (!h.c.rule.startsWith('sent right after')) {
        score += 1
        why.push('correction in your words')
      } else if (STEER_START_HINT.test(steerText)) score += 0.5
      score += Math.min(1, h.c.themes.length * 0.5)
      if (before) {
        score += 1
        why.push('agent had changed code')
      } else if (attempt.tools > 0) score += 0.25
      if (response) {
        score += 0.75
        if (afterEdits) {
          score += 1.25
          why.push('agent changed code after your steer')
        }
      }
      if (before && afterEdits) {
        score += 1
        why.push('before/after code pair')
      }
      if (nextH) {
        if (nextH.c.kind === 'approve') {
          score += 1.5
          why.push('you approved what followed')
        } else if (nextH.c.kind === 'followup') score += 0.5
        else if (nextH.c.kind === 'steer') score -= 0.25
      }
      if (looksPasted(steerText)) score -= 1.5
      if (hasProfanity(steerText)) score -= 0.25
      if (SECRETISH.test(steerText)) score -= 2 // sharing credentials is not steering
      if (!priorHuman) score -= 0.5

      const context: EpisodeTurn[] = []
      if (priorHuman) context.push({ role: 'human', text: clipBlock(priorHuman.ev.text) })
      context.push({ role: 'agent', text: clipBlock(attempt.text), tools: attempt.tools, toolNames: uniq(attempt.toolNames).slice(0, 12) })

      const observed = ['You redirected the agent after its attempt.']
      if (h.ev.afterInterrupt) observed.push('You interrupted the agent mid-turn before redirecting.')
      if (response) observed.push(response.tools ? `The agent responded and took ${response.tools} action${response.tools === 1 ? '' : 's'}.` : 'The agent responded in text only.')
      const missing = ['Full repository state is not included.', 'Tool outputs (test results, command output) are not included.']
      if (!before) missing.push("The agent's attempt changed no files, so there's no before diff.")
      if (!response) missing.push('The transcript ends before the agent responded.')
      if (!nextH) missing.push('No later message shows whether the result was kept.')

      all.push({
        id: sha1(`${threadKey(t)}|${h.idx}`).slice(0, 12),
        thread: threadKey(t),
        title: t.title || clip((t.events[humans[0].idx] as HumanEvent).text, 70),
        project: t.project,
        source: t.source,
        model: attempt.model,
        at: h.ev.t,
        score,
        why,
        opening: opening ? clipBlock(opening.ev.text, 1200) : null,
        context,
        attemptChange: before ? { files: before, diff: '' } : null,
        steer: { text: clipBlock(steerText), afterInterrupt: !!h.ev.afterInterrupt, themes: h.c.themes, rule: h.c.rule },
        response: response ? { role: 'agent', text: clipBlock(response.text), tools: response.tools, toolNames: uniq(response.toolNames).slice(0, 12) } : null,
        revisedChange: afterEdits ? { files: afterEdits, diff: '' } : null,
        next: nextH ? { text: clipBlock(nextH.ev.text, 1200), kind: nextH.c.kind } : null,
        git: null,
        value: null,
        evidence: {
          observed,
          expressedApproval: nextH?.c.kind === 'approve' ? `Next message: “${clip(nextH.ev.text, 80)}”` : null,
          verifiedOutcome: null,
        },
        missing,
        refs: [priorHuman ? { thread: threadKey(t), ev: priorHuman.idx } : null, { thread: threadKey(t), ev: h.idx }].filter(Boolean) as EvidenceRef[],
      })
    }
  }

  // Greedy by score with diversity: one per thread, at most three per project.
  all.sort((a, b) => b.score - a.score)
  const out: EpisodeCandidate[] = []
  const perProject = new Map<string, number>()
  const threads = new Set<string>()
  for (const c of all) {
    if (threads.has(c.thread) || (perProject.get(c.project) || 0) >= 3) continue
    out.push(c)
    threads.add(c.thread)
    perProject.set(c.project, (perProject.get(c.project) || 0) + 1)
    if (out.length >= limit) break
  }
  funnel.shortlisted = out.length
  return { candidates: out, funnel }
}

/** Attaches the actual diffs and git signals. Reads only the lines of the turns involved. */
export async function enrichCandidates(candidates: EpisodeCandidate[], threads: Map<string, ThreadRecord>, pricing: Pricing = DEFAULT_PRICING): Promise<EpisodeCandidate[]> {
  await Promise.all(
    candidates.map(async (c) => {
      const t = threads.get(c.thread)
      if (!t) return
      const steerIdx = c.refs[c.refs.length - 1].ev
      const attempt = t.events[steerIdx - 1] as AgentEvent | undefined
      const response = t.events[steerIdx + 1] as AgentEvent | undefined
      try {
        if (c.attemptChange && attempt?.k === 'a') c.attemptChange.diff = await readTurnDiff(t, attempt)
        if (c.revisedChange && response?.k === 'a') c.revisedChange.diff = await readTurnDiff(t, response)
      } catch {
        /* a moved or rotated file: keep the counts */
      }
      const files = [...(c.revisedChange?.files || []), ...(c.attemptChange?.files || [])].map((f) => f[0])
      c.git = await gitOutcome(t.cwd, files, c.at).catch(() => null)
      if (c.git?.committed) {
        c.score += c.git.reverted ? 0.5 : 1
        c.why.push(c.git.reverted ? 'committed, later reverted' : `committed ${c.git.minutesAfter} min later`)
      }
      c.value = valueEpisode(c, pricing)
    }),
  )
  return candidates.sort((a, b) => (b.value?.score ?? 0) - (a.value?.score ?? 0) || b.score - a.score)
}

function clipBlock(s: string, n = MAX_TEXT): string {
  return s.length <= n ? s : s.slice(0, n).trimEnd() + ' […]'
}

const uniq = <T>(xs: T[]) => [...new Set(xs)]

export function themeLabel(key: string) {
  return STEER_THEMES.find((t) => t.key === key)?.label || key
}

export function toPayload(c: EpisodeCandidate, redact: (s: string, counts: RedactionCounts) => string, analysis: Record<string, unknown> | null = null): EpisodePayload {
  const counts: RedactionCounts = {}
  const r = (s: string) => redact(s, counts)
  const turn = (x: EpisodeTurn): EpisodeTurn => ({ ...x, text: r(x.text) })
  const change = (ch: Change | null) => (ch ? { files: ch.files.map(([f, a, rm]) => ({ path: r(f), added: a, removed: rm })), diff: r(ch.diff) } : null)
  const g = c.git
  return {
    schema: 'lore.episode.v2',
    level: c.attemptChange && c.revisedChange ? 'artifact_linked' : 'steering_trace',
    source: c.source,
    model: c.model || null,
    month: monthKey(c.at),
    opening: c.opening ? r(c.opening) : null,
    context: c.context.map(turn),
    attempt_change: change(c.attemptChange),
    steer: { text: r(c.steer.text), after_interrupt: c.steer.afterInterrupt, themes: c.steer.themes },
    response: c.response ? turn(c.response) : null,
    revised_change: change(c.revisedChange),
    next: c.next ? { text: r(c.next.text), kind: c.next.kind } : null,
    evidence: {
      observed: c.evidence.observed,
      expressed_approval: c.evidence.expressedApproval ? r(c.evidence.expressedApproval) : null,
      git: g ? { committed: g.committed, minutes_after: g.minutesAfter, files_matched: g.filesMatched, later_changes_14d: g.laterChanges14d, reverted: g.reverted, basis: g.basis } : null,
      verified_outcome: null,
    },
    missing_context: c.missing,
    redactions: counts,
    analysis,
  }
}
