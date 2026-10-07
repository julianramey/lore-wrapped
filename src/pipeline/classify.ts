// Transparent, rule-based reading of what each human message did. These are
// heuristics, shown to the person with their definitions, never presented as fact.

import type { HumanEvent, ThreadRecord } from '../types.ts'
import { APPROVE_CJK, APPROVE_X, CONTINUES_X, STEER_ANY_CJK, STEER_ANY_X, STEER_START_CJK, STEER_START_X } from '../util/lang.ts'
import { wordCount } from '../util/text.ts'

export type HumanKind = 'ask' | 'steer' | 'approve' | 'followup'

export interface ThemeDef {
  key: string
  label: string
  /** One-line description shown next to the count. */
  blurb: string
  re: RegExp
}

export const STEER_THEMES: ThemeDef[] = [
  { key: 'simplify', label: 'Make it simpler', blurb: 'Cut complexity, scope creep, or bloat.', re: /\b(simpl\w*|too (complex|complicated|much)|over-?engineer\w*|overkill|minimal\w*|bloat\w*|leaner|less code|cleaner)\b/i },
  { key: 'broken', label: "It's broken", blurb: 'Pointed out bugs, errors, or failures.', re: /\b(broke|broken|bug\w*|error\w*|crash\w*|fail\w*|doesn'?t work|does not work|not working|regress\w*|exception)\b/i },
  { key: 'scope', label: 'Stay in your lane', blurb: 'Limited what the agent should touch.', re: /\b(don'?t (touch|change|modify|add|remove|delete)|leave (it|that|this|them|the)\b|out of scope|only (change|touch|edit|modify)|focus on|not (now|yet)|unrelated)\b/i },
  { key: 'design', label: 'Make it look right', blurb: 'Visual and UX corrections.', re: /\b(ugly|spacing|padding|margin|font|colou?r|layout|align\w*|looks? (bad|off|weird|wrong|cheap)|pixel|visual\w*|ui\b|ux\b|design)\b/i },
  { key: 'verify', label: 'Prove it works', blurb: 'Asked for tests, checks, or evidence.', re: /\b(test(s|ed|ing)?|verify|check (it|that|again)|make sure|confirm|run it|prove|did you (run|test|check))\b/i },
  { key: 'truth', label: 'Is that true?', blurb: 'Challenged claims or accuracy.', re: /\b(are you sure|hallucinat\w*|made (that|it|this) up|don'?t lie|lying|be honest|that'?s (not true|false|incorrect)|incorrect|inaccurate|fake)\b/i },
  { key: 'clarity', label: 'Say it plainly', blurb: 'Asked for clearer or shorter explanations.', re: /\b(explain|clarify|concise|shorter|tl;?dr|too long|plain (english|language)|what do you mean|confusing|confused)\b/i },
  { key: 'rethink', label: 'Rethink it', blurb: 'Rejected the approach entirely.', re: /\b(start over|from scratch|rethink|different approach|another approach|rewrite|wrong approach|scrap (it|this|that))\b/i },
  { key: 'action', label: 'Just do it', blurb: 'Pushed the agent to act instead of asking.', re: /\b(just do it|stop asking|don'?t ask|go ahead and|you decide|use your judgement|use your judgment|without asking)\b/i },
]

const STEER_START =
  /^(no|nope|nah|not\b|don'?t|do not|stop|wait|hold on|hmm+|ugh|actually|instead|wrong|revert|undo|why (did|are|is|would|do)|that'?s (not|wrong|incorrect)|this (is|isn'?t) (not|wrong|broken)|you (broke|missed|forgot|didn'?t|did not|still)|it'?s (still|not)|still|again|nothing (changed|happened)|i (said|meant|asked|told you))\b/i

const STEER_ANY =
  /\b(you broke|that broke|it broke|is broken|still (not|broken|failing|wrong|doesn'?t|the same)|doesn'?t work|does not work|not working|not what i (asked|meant|wanted|said)|that'?s not what|i (said|meant|asked for|told you)|revert (it|this|that|the)|undo (it|this|that|the)|roll ?back|too (complex|complicated|much|long|verbose|big)|over-?engineer\w*|rather than|instead of|why did you|why are you|you didn'?t|you forgot|you missed|go back to|should(n'?t| not) (have|be)|i don'?t (like|want)|not (right|correct))\b/i

const APPROVE =
  /^(yes|yep|yup|yeah|ya|ok(ay)?|k|great|perfect|nice|awesome|cool|good|lgtm|looks good|ship it|do it|go( ahead)?|continue|proceed|thanks|thank you|ty|sounds good|love (it|this)|amazing|beautiful|works|it works|that works|correct|exactly|sure)\b/i

const CONTINUES = /\?|\b(but|also|now|then|next|and (add|make|fix|change|update)|can you|could you|what|how|why|instead|add|make|fix|change|update|remove)\b/i

export interface Classified {
  kind: HumanKind
  themes: string[]
  /** Which rule fired, for the "why we counted this" tooltip. */
  rule: string
}

export function classifyHuman(ev: HumanEvent, isFirst: boolean): Classified {
  const text = ev.text.trim()
  const lead = text.slice(0, 280)
  const themes = STEER_THEMES.filter((t) => t.re.test(lead)).map((t) => t.key)
  if (isFirst) return { kind: 'ask', themes, rule: 'first message in the thread' }
  if (ev.afterInterrupt) return { kind: 'steer', themes, rule: 'sent right after interrupting the agent' }
  if (STEER_START.test(lead) || STEER_START_X.test(lead) || STEER_START_CJK.test(lead)) return { kind: 'steer', themes, rule: 'opens with a redirect ("no", "actually", "wait"…)' }
  if (STEER_ANY.test(lead) || STEER_ANY_X.test(lead) || STEER_ANY_CJK.test(lead)) return { kind: 'steer', themes, rule: 'contains a correction phrase' }
  if (APPROVE_CJK.test(lead)) return { kind: 'approve', themes, rule: 'short approval ("yes", "perfect", "go ahead"…)' }
  // "ok now do the mobile layout" is an instruction that happens to start with "ok".
  const words = wordCount(text)
  if ((APPROVE.test(lead) || APPROVE_X.test(lead)) && (words <= 5 || (words <= 14 && !CONTINUES.test(lead) && !CONTINUES_X.test(lead)))) return { kind: 'approve', themes, rule: 'short approval ("yes", "perfect", "go ahead"…)' }
  return { kind: 'followup', themes, rule: 'a new instruction or question' }
}

export interface ClassifiedThread {
  thread: ThreadRecord
  humans: { ev: HumanEvent; idx: number; c: Classified }[]
}

export function classifyThread(thread: ThreadRecord): ClassifiedThread {
  const humans: ClassifiedThread['humans'] = []
  // A recovered thread lost its agent replies, but one followed every prompt.
  let seenAgent = !!thread.recovered
  let first = true
  thread.events.forEach((ev, idx) => {
    if (ev.k === 'a') {
      seenAgent = true
      return
    }
    // A message before any agent reply is still part of the opening ask.
    const isFirst = first || !seenAgent
    humans.push({ ev, idx, c: classifyHuman(ev, isFirst) })
    first = false
  })
  return { thread, humans }
}
