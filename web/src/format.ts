import type { Report } from '../../src/report-types.ts'
import { SOURCES } from '../../src/sources/registry.ts'
export const n = (x: number) => Math.round(x).toLocaleString('en-US')
export const pct = (x: number, digits = 0) => (x > 0 && x * 100 < 0.5 * Math.pow(10, -digits) ? `<${digits ? Math.pow(10, -digits) : 1}%` : `${(x * 100).toFixed(digits)}%`)

/** 1.2k, 31.5B — for big counts in headlines. */
export function big(x: number): string {
  if (x >= 1e9) return `${(x / 1e9).toFixed(1)}B`
  if (x >= 1e6) return `${(x / 1e6).toFixed(x >= 1e7 ? 0 : 1)}M`
  if (x >= 1e4) return `${Math.round(x / 1e3)}k`
  if (x >= 1e3) return `${(x / 1e3).toFixed(1)}k`
  return n(x)
}
export const money = (x: number) => `$${x >= 1000 ? n(x) : x.toFixed(x < 1 ? 3 : 2)}`

export const fmtDate = (t: number | string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) =>
  new Date(typeof t === 'string' ? `${t.slice(0, 10)}T12:00:00` : t).toLocaleDateString('en-US', opts)
export const fmtMonth = (t: number | string) => fmtDate(t, { month: 'short', year: 'numeric' })
export const shortMonth = (t: number) => {
  const d = new Date(t)
  return `${d.toLocaleString('en-US', { month: 'short' })} ’${String(d.getFullYear()).slice(2)}`
}

/**
 * The months every number covers: the first prompt on record to the last. A tool may have been
 * installed earlier (coverage.firstUse: Claude Code's first launch), but nothing from before the
 * first prompt is counted, so the report's "since" and every share card's dates start here.
 */
export const since = (r: Pick<Report, 'coverage'>) => shortMonth(r.coverage.from)
export const period = (r: Pick<Report, 'coverage'>) => `${since(r)} — ${shortMonth(r.coverage.to)}`

export function hourLabel(h: number): string {
  if (h === 0) return '12am'
  if (h === 12) return 'noon'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}
export const dur = (min: number) => (min >= 90 ? `${(min / 60).toFixed(1)}h` : `${Math.round(min)}m`)
export const secs = (s: number) => (s < 90 ? `${Math.round(s)}s` : `${(s / 60).toFixed(1)}m`)

export const SOURCE_LABEL: Record<string, string> = Object.fromEntries(SOURCES.map((s) => [s.key, s.label]))
export const sourceVar = (s: string) => `var(--${SOURCES.find((x) => x.key === s)?.color ?? 'claude'})`

export function oneIn(x: number): string {
  if (x <= 0) return 'none'
  const k = Math.round(1 / x)
  return k <= 1 ? 'nearly all' : `1 in ${k}`
}
export const plural = (k: number, one: string, many = `${one}s`) => `${n(k)} ${k === 1 ? one : many}`
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
