import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export { VERSION } from './version.ts'
import { VERSION } from './version.ts'

/** Bump when adapter output changes so cached threads are re-parsed. */
export const ADAPTER_VERSION = 15

export const LORE_HOME = process.env.LORE_HOME || path.join(os.homedir(), '.lore')
export const CACHE_DIR = path.join(LORE_HOME, 'cache', `threads-v${ADAPTER_VERSION}`)
export const STATE_FILE = path.join(LORE_HOME, 'state.json')
export const CONFIG_FILE = path.join(LORE_HOME, 'config.json')

/** lore's collector: takes anonymous stats, serves the index. LORE_ENDPOINT or `--endpoint` overrides it. */
export const DEFAULT_ENDPOINT = 'https://api.lore-wrapped.com'

export interface LoreConfig {
  endpoint: string
  stats: boolean
  /** What turned stats off, for the status line: a flag, an env signal or the config file. */
  statsOff?: string
  /** In the EU, UK and Switzerland stats wait for a yes; true until one is given (or a no). */
  askFirst?: boolean
  /** Also send counts across the repos agents edited in (`lore stats repos on`). Off unless chosen. */
  repoStats?: boolean
  /** Optional model calls (the written story) through the user's own CLI. */
  ai: boolean
  /** Nothing leaves the machine: no stats, no index, no uploads, no model calls. */
  offline: boolean
}

/**
 * Any one of these turns stats off: lore's own switch, the cross-tool DO_NOT_TRACK, Claude
 * Code's own telemetry switches (if you told Claude Code not to phone home, lore won't
 * either), and CI, where a run isn't a person.
 */
export const STATS_OFF = ['LORE_NO_STATS', 'DO_NOT_TRACK', 'DISABLE_TELEMETRY', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CI']

/**
 * Whether this machine's timezone is in the EU/EEA, the UK or Switzerland, where a notice isn't
 * consent: lore asks before sending there. Checked locally from the system timezone; never sent.
 */
export function asksFirst(tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''): boolean {
  return /^Europe\//.test(tz) || /^(Atlantic\/(Canary|Madeira|Azores|Reykjavik|Faroe)|Asia\/(Nicosia|Famagusta)|Arctic\/Longyearbyen)$/.test(tz)
}

export function loadConfig(overrides: Partial<LoreConfig> = {}): LoreConfig {
  let file: Partial<LoreConfig> = {}
  try {
    file = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  } catch {
    /* no config yet */
  }
  const env = (k: string) => !!process.env[k] && process.env[k] !== '0' && process.env[k] !== 'false'
  const offline = overrides.offline ?? (env('LORE_OFFLINE') || file.offline === true)
  const signal = STATS_OFF.find(env)
  const askFirst = file.stats === undefined && asksFirst()
  const statsOff = offline ? '--offline' : overrides.stats === false ? '--no-stats' : signal ?? (file.stats === false ? CONFIG_FILE : askFirst ? 'no answer yet (here lore asks first)' : undefined)
  return {
    endpoint: offline ? '' : (overrides.endpoint ?? process.env.LORE_ENDPOINT ?? file.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, ''),
    stats: !statsOff && (overrides.stats ?? file.stats ?? true),
    statsOff,
    askFirst: askFirst && !offline && !signal && overrides.stats !== false,
    repoStats: file.repoStats === true,
    ai: offline ? false : (overrides.ai ?? (env('LORE_NO_AI') ? false : (file.ai ?? true))),
    offline,
  }
}

let tightened = false
/**
 * lore's folder holds parsed history, so it's this user's alone: folders 0700, files 0600
 * (POSIX; Windows ignores modes). Versions before 0.4.1 made them 0755 and 0644, so the
 * first write that finds the folder open to others tightens everything already in it.
 */
export function privateDir(dir: string) {
  if (!tightened && process.platform !== 'win32') {
    tightened = true
    try {
      if (fs.statSync(LORE_HOME).mode & 0o077) tighten(LORE_HOME)
    } catch {
      /* not there yet, or not ours to change */
    }
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
}
function tighten(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) tighten(p)
    else if (e.isFile()) fs.chmodSync(p, 0o600)
  }
  fs.chmodSync(dir, 0o700)
}

export function readState(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

export function writeState(patch: Record<string, any>) {
  privateDir(LORE_HOME)
  const next = { ...readState(), ...patch }
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), { mode: 0o600 })
}

/** Saves a preference to ~/.lore/config.json, keeping the others. */
export function saveConfig(patch: Partial<LoreConfig>) {
  let cur: Record<string, unknown> = {}
  try {
    cur = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  } catch {
    /* first preference */
  }
  privateDir(LORE_HOME)
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...cur, ...patch }, null, 2), { mode: 0o600 })
}
