// Claude Code keeps its own aggregate stats (what /stats shows) after it deletes old
// transcripts. lore uses them only to report coverage and lifetime totals honestly;
// they never become prompts, steers or examples.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { claudeConfigFiles } from './roots.ts'

/** Where "keep a year" writes: the first Claude Code folder on this OS. */
export const defaultClaudeDir = () => (process.env.CLAUDE_CONFIG_DIR || '').split(',')[0].trim() || path.join(os.homedir(), '.claude')

export interface ClaudeStats {
  since: string | null
  totalSessions: number
  totalMessages: number
  /** date → messages (all roles) Claude counted that day */
  daily: Record<string, number>
  /** date → model → tokens (all kinds), for the days Claude recorded it */
  dailyTokens: Record<string, Record<string, number>>
  /** The last day these stats include. */
  lastComputed: string | null
  /** All-time tokens by model; `in` includes cache writes, `write` is that part. */
  tokensByModel: Record<string, { in: number; cached: number; out: number; write: number }>
  /** Transcript retention in days: Claude Code's cleanupPeriodDays, default 30. */
  retentionDays: number
  retentionConfigured: boolean
}

function readOne(dir: string): ClaudeStats | null {
  let raw: any
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, 'stats-cache.json'), 'utf8'))
  } catch {
    return null
  }
  let retentionDays = 30
  let retentionConfigured = false
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))
    if (typeof settings.cleanupPeriodDays === 'number') {
      retentionDays = settings.cleanupPeriodDays
      retentionConfigured = true
    }
  } catch {
    /* defaults */
  }
  const daily: Record<string, number> = {}
  for (const d of Array.isArray(raw.dailyActivity) ? raw.dailyActivity : []) if (d?.date) daily[d.date] = d.messageCount || 0
  const dailyTokens: ClaudeStats['dailyTokens'] = {}
  for (const d of Array.isArray(raw.dailyModelTokens) ? raw.dailyModelTokens : []) {
    if (d?.date && d.tokensByModel && typeof d.tokensByModel === 'object') dailyTokens[d.date] = d.tokensByModel
  }
  const tokensByModel: ClaudeStats['tokensByModel'] = {}
  for (const [model, u] of Object.entries<any>(raw.modelUsage || {})) {
    const write = u.cacheCreationInputTokens || 0
    tokensByModel[model] = { in: (u.inputTokens || 0) + write, cached: u.cacheReadInputTokens || 0, out: u.outputTokens || 0, write }
  }
  return {
    since: typeof raw.firstSessionDate === 'string' ? raw.firstSessionDate : null,
    totalSessions: raw.totalSessions || 0,
    totalMessages: raw.totalMessages || 0,
    daily,
    dailyTokens,
    lastComputed: typeof raw.lastComputedDate === 'string' ? raw.lastComputedDate : null,
    tokensByModel,
    retentionDays,
    retentionConfigured,
  }
}

/** Claude's own stats from every Claude Code folder found (this OS, WSL…), added together. */
export function readClaudeStats(dirs: string[] = [defaultClaudeDir()]): ClaudeStats | null {
  const all = dirs.map(readOne).filter((s): s is ClaudeStats => !!s)
  if (all.length <= 1) return all[0] ?? null
  const out = all[0]
  for (const s of all.slice(1)) {
    if (s.since && (!out.since || s.since < out.since)) out.since = s.since
    if (s.lastComputed && (!out.lastComputed || s.lastComputed > out.lastComputed)) out.lastComputed = s.lastComputed
    out.totalSessions += s.totalSessions
    out.totalMessages += s.totalMessages
    for (const [d, n] of Object.entries(s.daily)) out.daily[d] = (out.daily[d] || 0) + n
    for (const [d, byModel] of Object.entries(s.dailyTokens)) {
      const day = (out.dailyTokens[d] ||= {})
      for (const [m, n] of Object.entries(byModel)) day[m] = (day[m] || 0) + n
    }
    for (const [m, t] of Object.entries(s.tokensByModel)) {
      const cur = (out.tokensByModel[m] ||= { in: 0, cached: 0, out: 0, write: 0 })
      cur.in += t.in
      cur.cached += t.cached
      cur.out += t.out
      cur.write += t.write
    }
  }
  return out
}

/**
 * The Claude plan this machine is signed in with, from Claude Code's own config. Only the
 * plan type and rate-limit tier are read; nothing else in that file is touched.
 */
const configs = (dirs: string[]) =>
  [...new Set(dirs.flatMap(claudeConfigFiles))]
    .flatMap((f) => {
      try {
        return [JSON.parse(fs.readFileSync(f, 'utf8'))]
      } catch {
        return []
      }
    })

/** When Claude Code was first launched here (its own config), or null; the earliest across folders. */
export function readClaudeFirstUse(dirs: string[] = [defaultClaudeDir()]): number | null {
  const ts = configs(dirs)
    .map((c) => Date.parse(c?.firstStartTime))
    .filter(Number.isFinite)
  return ts.length ? Math.min(...ts) : null
}

export function readClaudePlan(dirs: string[] = [defaultClaudeDir()]): string | null {
  for (const cfg of configs(dirs)) {
    const a = cfg?.oauthAccount || {}
    const type = String(a.organizationType || '')
    const tier = String(a.userRateLimitTier || a.organizationRateLimitTier || '')
    if (type === 'claude_max') return /20x/.test(tier) ? 'claude-max-20x' : /5x/.test(tier) ? 'claude-max-5x' : 'claude-max'
    if (type === 'claude_pro') return 'claude-pro'
  }
  return null
}

/**
 * Keeps Claude Code transcripts for a year from now on: sets cleanupPeriodDays in its
 * settings, keeping every other key. Only runs when the person asks; refuses to touch a
 * settings file it can't parse.
 */
export function keepClaudeHistory(days = 365, dir = defaultClaudeDir()): { ok: true; file: string } {
  const file = path.join(dir, 'settings.json')
  let cur: Record<string, unknown> = {}
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8')
    try {
      cur = raw.trim() ? JSON.parse(raw) : {}
    } catch {
      throw new Error(`${file} isn't valid JSON, so lore left it alone. Add "cleanupPeriodDays": ${days} yourself.`)
    }
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) throw new Error(`${file} isn't a settings object, so lore left it alone.`)
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ ...cur, cleanupPeriodDays: days }, null, 2) + '\n')
  return { ok: true, file }
}
