import type { EvidenceView, Example, Report } from '../../src/report-types.ts'

declare global {
  interface Window {
    __LORE__: { token: string }
  }
}

export type ProviderId = 'claude' | 'codex'
export interface Provider {
  id: ProviderId
  label: string
  available: boolean
  model: string
  note: string
  /** Set when the user switched model calls off for this run. */
  off?: string
}
export interface Usage {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  costUsd?: number
}
export interface PlanWindow {
  name: string
  before: number | null
  after: number | null
}
export interface Receipt {
  id: string
  at: number
  action: 'narrative'
  provider: ProviderId
  model: string
  calls: number
  ms: number
  usage: Usage
  windows: PlanWindow[]
  cached: boolean
}
export interface Narrative {
  tone?: 'recap' | 'roast'
  headline: string
  dek: string
  paragraphs: { text: string; cites: string[] }[]
  observations: { label: string; text: string; cites: string[] }[]
  examples: { id: string; example: Example }[]
  provider: ProviderId
  model: string
  usage: Usage
  ms: number
  createdAt: number
  dropped: number
  stale?: boolean
}
export interface StatsStatus {
  repoStats: boolean
  enabled: boolean
  endpoint: string
  payload: Record<string, unknown>
  state: 'sent' | 'already-sent' | 'disabled' | 'no-endpoint' | 'failed' | 'pending' | 'first-run'
  detail: string
  lastSentMonth: string | null
}
export interface Budget {
  used: number
  limit: number
  busy: boolean
}
export interface Boot {
  report: Report
  narrative: Narrative | null
  providers: Provider[]
  stats: StatsStatus
  budget: Budget
  endpoint: string
  receipts: Receipt[]
}

export interface Ranks {
  available: boolean
  runs: number
  rows: { key: string; label: string; value: number; top: number | null }[]
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'x-lore-token': window.__LORE__.token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json as T
}

export const api = {
  boot: () => call<Boot>('GET', '/api/report'),
  evidence: (thread: string, ev: number) => call<EvidenceView>('GET', `/api/evidence?thread=${encodeURIComponent(thread)}&ev=${ev}`),
  reveal: (thread: string) => call('POST', '/api/reveal', { thread }),
  narrative: (provider: ProviderId, tone: 'recap' | 'roast' = 'recap') => call<{ narrative: Narrative; receipt: Receipt | null; budget: Budget }>('POST', '/api/narrative', { provider, tone }),
  ranks: () => call<Ranks>('GET', '/api/ranks'),
  keepHistory: () => call<{ ok: boolean; file: string }>('POST', '/api/keep-history'),
  sendStats: () => call<StatsStatus>('POST', '/api/stats/send'),
  toggleStats: (enabled: boolean) => call<StatsStatus>('POST', '/api/stats/toggle', { enabled }),
  toggleRepoStats: (enabled: boolean) => call<StatsStatus>('POST', '/api/stats/repos', { enabled }),
  joinWaitlist: (email: string) => call<{ ok: boolean }>('POST', '/api/waitlist', { email }),
}
