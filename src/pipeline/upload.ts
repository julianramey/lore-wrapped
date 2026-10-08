// The one thing that leaves the machine for our collector: anonymous aggregate stats, sent
// when you run lore. Running it again the same month doesn't send again. Nothing is
// scheduled: no run, no send.

import { VERSION, readState, writeState, type LoreConfig } from '../config.ts'
import { isWsl } from '../util/platform.ts'
import type { Report } from '../report-types.ts'
import { monthKey } from '../util/text.ts'
import { buildStats, MAX_BODY, NOTICE, validateStats, type AnonStats, type Machine } from './stats.ts'

export interface StatsStatus {
  enabled: boolean
  /** Whether counts across the repos agents edited in ride along (opt-in). */
  repoStats: boolean
  endpoint: string
  payload: AnonStats
  state: 'sent' | 'already-sent' | 'disabled' | 'no-endpoint' | 'failed' | 'pending'
  detail: string
  /** Why a send failed, in a few words: a field that failed validation, or the network. */
  why?: string
  lastSentMonth: string | null
}

async function post(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': `lore/${VERSION}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) throw Object.assign(new Error(`the collector answered ${res.status}${json?.error ? `: ${[].concat(json.error).join(', ')}` : ''}`), { answered: true })
  return json
}

/** Counts this run in lore's state file: the first-run month and the lifetime count feed the payload. */
export function countRun(now = Date.now()) {
  const st = readState()
  const times = [now, st.statsNoticeAt, ...(Array.isArray(st.runs) ? st.runs.map((r: any) => r?.at) : [])].filter((t) => Number.isFinite(t) && t > 0)
  writeState({ runCount: (st.runCount ?? (Array.isArray(st.runs) ? st.runs.length : 0)) + 1, firstRunMonth: st.firstRunMonth || monthKey(Math.min(...times)) })
}

/** This machine's facts for the payload: its OS family, and lore's own run history here. */
export function machineFacts(): Machine {
  const st = readState()
  const os = isWsl() ? 'wsl' : process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux'
  return { os, firstRunMonth: st.firstRunMonth || monthKey(Date.now()), runs: Math.max(1, st.runCount || 1), notice: NOTICE }
}

export function statsStatus(report: Report, cfg: LoreConfig): StatsStatus {
  const payload = buildStats(report, machineFacts())
  const last = readState().statsSentMonth ?? null
  const base = { enabled: cfg.stats, repoStats: !!cfg.repoStats, endpoint: cfg.endpoint, payload, lastSentMonth: last }
  if (!cfg.stats) return { ...base, state: 'disabled', detail: `Turned off by ${cfg.statsOff || 'your config'}.` }
  if (!cfg.endpoint) return { ...base, state: 'no-endpoint', detail: 'No collector configured, so nothing is sent.' }
  if (last === monthKey(Date.now())) return { ...base, state: 'already-sent', detail: `Already sent this month (${last}).` }
  return { ...base, state: 'pending', detail: 'Not sent yet this month.' }
}

/** The fields named in validation problems ("bad model_share.x" → "model_share"), never their values. */
const fieldsOf = (errs: string[]) => [...new Set(errs.map((e) => e.match(/^(?:bad|missing|unexpected field) ([^.\s]+)/)?.[1] ?? e))]
const notSent = (st: StatsStatus, why: string): StatsStatus => ({ ...st, state: 'failed', why, detail: `Not sent (${why}).` })

/**
 * Sends at most once per calendar month, so repeat runs don't inflate counts without needing
 * an id. The first run sends too, and the run that sends says so. A payload the collector
 * would refuse isn't sent at all, and the status names the field, so it's seen, not a silent 400.
 */
export async function sendStatsIfDue(report: Report, cfg: LoreConfig, force = false): Promise<StatsStatus> {
  const st = statsStatus(report, cfg)
  if (st.state !== 'pending' && !(force && st.state === 'already-sent')) return st
  const errs = validateStats(st.payload)
  if (errs.length) return notSent(st, `a field failed validation: ${fieldsOf(errs).join(', ')}`)
  const bytes = new TextEncoder().encode(JSON.stringify(st.payload)).byteLength
  if (bytes > MAX_BODY) return notSent(st, `${bytes} bytes, over the collector's ${MAX_BODY}`)
  try {
    await post(`${cfg.endpoint}/v1/stats`, st.payload)
    const month = monthKey(Date.now())
    writeState({ statsSentMonth: month })
    return { ...st, state: 'sent', detail: `Sent to ${cfg.endpoint}.`, lastSentMonth: month }
  } catch (e: any) {
    return notSent(st, e?.answered ? e.message : `could not reach the collector: ${e?.message || e}`)
  }
}
