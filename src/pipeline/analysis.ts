// The optional model pass: the written story for the recap. It takes a small selected
// packet, never raw history, and caches by content hash so a rerun costs nothing.

import fs from 'node:fs'
import path from 'node:path'
import { LORE_HOME } from '../config.ts'
import type { Example, Report } from '../report-types.ts'
import { isFeatureSafe } from '../util/safety.ts'
import { clip } from '../util/text.ts'
import { sha1 } from '../util/hash.ts'
import { spreadPick } from './facts.ts'
import { callModel, type LlmResult, type PlanWindow, type ProviderId, type Usage } from './llm.ts'

const ANALYSIS_VERSION = 4
const DIR = path.join(LORE_HOME, 'analysis')

export interface NarrativeCite {
  id: string
  example: Example
}

/** A plain recap, or a roast: the same counted facts, read with a raised eyebrow. */
export type Tone = 'recap' | 'roast'

export interface Narrative {
  tone?: Tone
  headline: string
  dek: string
  paragraphs: { text: string; cites: string[] }[]
  observations: { label: string; text: string; cites: string[] }[]
  examples: NarrativeCite[]
  provider: ProviderId
  model: string
  usage: Usage
  ms: number
  packetChars: number
  createdAt: number
  dropped: number
  windows: PlanWindow[]
  calls: number
  cached?: boolean
}

const NARRATIVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'dek', 'paragraphs', 'observations'],
  properties: {
    headline: { type: 'string', description: 'At most 10 words.' },
    dek: { type: 'string', description: 'One sentence, at most 30 words.' },
    paragraphs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'cites'],
        properties: { text: { type: 'string', description: '2-3 sentences.' }, cites: { type: 'array', items: { type: 'string' }, description: 'Example ids only, like "e3". Counted facts need no citation.' } },
      },
    },
    observations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'text', 'cites'],
        properties: { label: { type: 'string', description: 'At most 4 words.' }, text: { type: 'string', description: 'One sentence.' }, cites: { type: 'array', items: { type: 'string' }, description: 'Example ids only, like "e3". Counted facts need no citation.' } },
      },
    },
  },
}

const NARRATIVE_SYSTEM = `You write a short, specific recap of how one person worked with AI agents, from facts computed locally on their machine.
Rules:
- Use only the facts and examples given. Counted numbers are exact; never invent numbers, projects, or events.
- Claims about the person's behavior go with example ids ("e1" to "e8") in the "cites" array; counted facts need no citation, so never put fact names there. Never write ids like "e3" in the text itself.
- Read every key name literally. "median" is not "average"; a share of prompts is not a share of days; steers and mid-turn stops are different counts.
- Sentence case for the headline. Each paragraph says something the numbers alone don't: what the examples show about how this person works.
- Second person, plain and vivid. No hype words, no emojis, no exclamation marks.
- Do not call active days "hours worked". Do not judge which model is better; model counts are usage only.
- A correction shows the person redirected an agent, not that they were right. Describe judgment, not outcomes.
- Return only JSON matching the schema.`

const ROAST_SYSTEM = `${NARRATIVE_SYSTEM}
Tone: a friendly roast, the kind a sharp colleague gives at a farewell lunch. Dry, teasing, specific.
- Every jab lands on a habit the facts or examples show (how often they redirect, the hours, the swearing, the prompts they keep repeating, what the agents kept telling them, the bill). Each one cites its example or names its counted number.
- Never aim at the person's intelligence, worth, looks, identity, health or mood, and never at anyone else. Roast the habits, not the human.
- No slurs. Quote a swear word only if it's in the facts. No emojis, no exclamation marks.
- End warm: the last paragraph says what the habits add up to, still in a teasing voice.`

function narrativeExamples(r: Report): NarrativeCite[] {
  const pool: Example[] = []
  for (const p of r.projects.slice(0, 6)) pool.push(...p.asks.filter((e) => e.safe).slice(0, 2))
  pool.push(...r.steering.examples.filter((e) => e.safe))
  for (const t of r.steering.themes.slice(0, 3)) pool.push(...t.examples.filter((e) => e.safe).slice(-1))
  const unique = [...new Map(pool.map((e) => [`${e.ref.thread}:${e.ref.ev}`, e])).values()]
  return spreadPick(unique, (e) => e.at, 8).map((e, i) => ({ id: `e${i + 1}`, example: e }))
}

function narrativePacket(r: Report, examples: NarrativeCite[]) {
  const month = (t: number) => new Date(t).toLocaleString('en', { month: 'short', year: 'numeric' })
  // Keys say exactly what each number is, so the model can't conflate them.
  return {
    period: `${month(r.coverage.from)} – ${month(r.coverage.to)}`,
    tools: r.bySource.filter((s) => s.threads).map((s) => ({ tool: s.label, threads: s.threads, promptsSent: s.prompts })),
    counts: {
      conversations: r.totals.threads,
      promptsSent: r.totals.prompts,
      activeDays: r.totals.activeDays,
      daysInPeriod: r.totals.spanDays,
      projects: r.totals.projects,
      followUpMessages: r.totals.followups,
      steersRedirectingTheAgent: r.totals.steers,
      shortApprovals: r.totals.approvals,
      timesYouStoppedTheAgentMidTurn: r.totals.interrupts,
      agentActionsTaken: r.totals.toolCalls,
    },
    longestStreakOfConsecutiveActiveDays: r.streak.days,
    busiestDay: { date: r.busiestDay.date, promptsThatDay: r.busiestDay.prompts, mainProjects: r.busiestDay.projects },
    topProjects: r.projects.slice(0, 6).map((p) => ({ name: p.name, promptsSent: p.prompts, activeDays: p.activeDays, percentOfFollowUpsThatWereSteers: Math.round(p.steerRate * 100), from: month(p.first), to: month(p.last) })),
    steering: {
      percentOfFollowUpsThatRedirectTheAgent: Math.round(r.steering.rate * 100),
      percentOfFollowUpsThatAreShortApprovals: Math.round(r.steering.approvalsShare * 100),
      mostCommonSteerThemes: r.steering.themes.slice(0, 4).map((t) => ({ theme: t.label, steers: t.count })),
    },
    rhythm: {
      peakHourOfDay: r.rhythm.peakHour,
      percentOfPromptsSentBetween10pmAnd4am: Math.round(r.rhythm.nightShare * 100),
      percentOfPromptsSentOnWeekends: Math.round(r.rhythm.weekendShare * 100),
    },
    medianWordsPerPrompt: r.style.medianWords,
    voice: {
      promptsWithASwear: r.deep.swear.prompts,
      swearsPer100Prompts: Math.round(r.deep.swear.per100 * 10) / 10,
      mostUsedSwear: r.deep.swear.words[0] ? { word: r.deep.swear.words[0].word, times: r.deep.swear.words[0].count } : null,
      whatTheAgentsKeptTellingYou: (r.extras?.catchphrases || []).slice(0, 3).map((c) => ({ phrase: c.label, times: c.count })),
    },
    records: {
      longestSessionMinutes: r.records.longestSession?.minutes ?? null,
      roughestDay: r.records.rockBottom ? { date: r.records.rockBottom.date, swears: r.records.rockBottom.swears, allCapsPrompts: r.records.rockBottom.caps, redirects: r.records.rockBottom.steers } : null,
      mostAgentsRunningAtOnce: r.extras?.parallel?.peak ?? null,
      priciestPrompt: r.extras?.priciest ? { apiEquivalentUsd: Math.round(r.extras.priciest.usd * 100) / 100, words: r.extras.priciest.words } : null,
      linesOfCodePerWordYouTyped: r.extras?.leverage ? Math.round(r.extras.leverage.perWord * 10) / 10 : null,
      apiEquivalentBillUsd: Math.round(r.spend.totalUsd),
    },
    signaturePhrases: r.phrases.filter((p) => p.safe).slice(0, 5).map((p) => ({ phrase: p.text, threadsUsedIn: p.threads })),
    playfulLabel: { name: r.archetype.name, rule: r.archetype.why },
    examples: examples.map((c) => ({ id: c.id, project: c.example.project, month: month(c.example.at), text: clip(c.example.text, 260) })),
  }
}

/** Ids belong in `cites`, not in prose; strip any the model wrote inline anyway. */
export function stripInlineIds(text: string): string {
  const out = text
    .replace(/\s*\((?:e\d+(?:,\s*|\s+and\s+)?)+\)/g, '')
    .replace(/\b(?:[Ii]n|[Aa]s in|[Ss]ee)\s+(?:e\d+(?:,\s*|\s+and\s+)?)+,?\s*/g, '')
    .replace(/\be\d+\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return out.charAt(0).toUpperCase() + out.slice(1)
}

function cachePath(kind: string, key: string) {
  return path.join(DIR, `${kind}-${key}.json`)
}

const narrativeKey = (r: Report, provider: ProviderId, tone: Tone, packet = narrativePacket(r, narrativeExamples(r))) => sha1(JSON.stringify([ANALYSIS_VERSION, provider, tone, packet])).slice(0, 16)

export function cachedNarrative(r: Report, provider: ProviderId, tone: Tone = 'recap'): Narrative | null {
  const key = narrativeKey(r, provider, tone)
  try {
    return JSON.parse(fs.readFileSync(cachePath('narrative', key), 'utf8'))
  } catch {
    return null
  }
}

export function latestNarrative(): Narrative | null {
  try {
    const files = fs.readdirSync(DIR).filter((f) => f.startsWith('narrative-')).map((f) => ({ f, m: fs.statSync(path.join(DIR, f)).mtimeMs }))
    files.sort((a, b) => b.m - a.m)
    return files[0] ? JSON.parse(fs.readFileSync(path.join(DIR, files[0].f), 'utf8')) : null
  } catch {
    return null
  }
}

export async function writeNarrative(r: Report, provider: ProviderId, tone: Tone = 'recap'): Promise<Narrative> {
  const examples = narrativeExamples(r)
  const packet = narrativePacket(r, examples)
  const key = narrativeKey(r, provider, tone, packet)
  const cached = cachedNarrative(r, provider, tone)
  if (cached) return { ...cached, cached: true, calls: 0, windows: [] }

  const system = tone === 'roast' ? ROAST_SYSTEM : NARRATIVE_SYSTEM
  const prompt = `Facts and examples (JSON):\n${JSON.stringify(packet, null, 1)}\n\n${tone === 'roast' ? 'Write the roast.' : 'Write the recap.'}`
  const res: LlmResult<any> = await callModel(provider, system, prompt, NARRATIVE_SCHEMA)
  const ids = new Set(examples.map((e) => e.id))
  let dropped = 0
  const keep = (cites: unknown): string[] => {
    // models write "e3", "E3", "[e3]" or just "3"; all mean example e3
    const arr = Array.isArray(cites) ? cites.map((c) => String(c).match(/^\W*e?(\d+)\W*$/i)?.[1]).map((n) => (n ? `e${n}` : '')) : []
    const ok = [...new Set(arr.filter((c) => ids.has(c)))]
    dropped += arr.length - ok.length
    return ok
  }
  const d = res.data || {}
  const narrative: Narrative = {
    tone,
    headline: clip(String(d.headline || ''), 90),
    dek: clip(String(d.dek || ''), 240),
    paragraphs: (Array.isArray(d.paragraphs) ? d.paragraphs : []).slice(0, 3).map((p: any) => ({ text: stripInlineIds(String(p.text || '')), cites: keep(p.cites) })),
    observations: (Array.isArray(d.observations) ? d.observations : []).slice(0, 3).map((o: any) => ({ label: clip(String(o.label || ''), 40), text: stripInlineIds(String(o.text || '')), cites: keep(o.cites) })),
    examples,
    provider,
    model: res.model,
    usage: res.usage,
    ms: res.ms,
    packetChars: prompt.length + system.length,
    createdAt: Date.now(),
    dropped,
    windows: res.windows,
    calls: 1,
  }
  if (!narrative.headline || narrative.paragraphs.length === 0) throw new Error('The model returned an empty recap.')
  // Keep only text that is safe to show in a featured spot.
  if (!isFeatureSafe(narrative.headline)) narrative.headline = 'Your work with agents'
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(cachePath('narrative', key), JSON.stringify(narrative, null, 2))
  return narrative
}
