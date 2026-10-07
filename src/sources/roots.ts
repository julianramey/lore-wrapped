// Where agent history lives on this machine. Claude Code and Codex keep it under the home
// directory on every OS, but people move it (CLAUDE_CONFIG_DIR, CODEX_HOME, XDG), Claude
// Desktop keeps its session records per OS, and on Windows half of it can sit inside a WSL
// distro. One function finds all of it, from inputs a test can fake.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isWsl } from '../util/platform.ts'

export interface Root {
  dir: string
  /** Where it came from, for the coverage line: "" on this OS, "WSL Ubuntu", "Windows". */
  where: string
}

export interface Roots {
  /** `.claude` directories: projects/, history.jsonl, stats-cache.json, settings.json. */
  claude: Root[]
  /** `.codex` directories: sessions/, archived_sessions/, session_index.jsonl. */
  codex: Root[]
  /** `.gemini` directories: tmp/<project>/chats, tmp/<project>/logs.json. */
  gemini: Root[]
  /** Pi session folders: --<cwd>--/<ts>_<uuid>.jsonl. */
  pi: Root[]
  /** OpenClaw state folders (and its earlier names): agents/<agent>/{sessions,agent}. */
  openclaw: Root[]
  /** OpenCode data folders: opencode*.db, and the storage/ tree from before 1.2. */
  opencode: Root[]
  /** Kilo CLI data folders: kilo*.db. */
  kilo: Root[]
  /** Qwen Code folders: projects/<cwd>/chats/*.jsonl. */
  qwen: Root[]
  /** GitHub Copilot CLI folders: session-state/<session>/events.jsonl. */
  copilot: Root[]
  /** Claude Desktop's Code-session records (metadata joined to transcripts). */
  claudeDesktop: string[]
}

export interface DiscoverOptions {
  env?: NodeJS.ProcessEnv
  home?: string
  platform?: NodeJS.Platform
  wsl?: boolean
  /** Homes inside WSL distros, as Windows sees them. Injected in tests. */
  wslHomes?: () => Root[]
  /** Skip WSL (--no-wsl). */
  noWsl?: boolean
}

const exists = (p: string) => {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}
const dirs = (p: string) => {
  try {
    return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(p, d.name))
  } catch {
    return []
  }
}
/** "a,b" env lists, as ccusage accepts them too. */
const list = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])
const real = (p: string) => {
  try {
    return fs.realpathSync.native(p)
  } catch {
    return p
  }
}

function dedupe(roots: Root[], keep: (dir: string) => boolean): Root[] {
  const seen = new Set<string>()
  return roots.filter((r) => {
    if (!keep(r.dir)) return false
    const k = real(r.dir).toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

const isClaude = (d: string) => exists(path.join(d, 'projects')) || exists(path.join(d, 'history.jsonl'))
const isCodex = (d: string) => exists(path.join(d, 'sessions')) || exists(path.join(d, 'archived_sessions'))
const isGemini = (d: string) => exists(path.join(d, 'tmp'))
const isOpenClaw = (d: string) => exists(path.join(d, 'agents'))

/** Windows user profiles seen from inside WSL. */
function windowsHomesFromWsl(): Root[] {
  const skip = new Set(['public', 'default', 'default user', 'all users', 'defaultapppool'])
  return ['/mnt/c/Users'].flatMap((base) => dirs(base).filter((d) => !skip.has(path.basename(d).toLowerCase())).map((dir) => ({ dir, where: 'Windows' })))
}

/** Homes inside each WSL distro, through \\wsl.localhost. Never fatal; a few seconds at most. */
export function wslHomesFromWindows(): Root[] {
  let out: string
  try {
    out = execFileSync('wsl.exe', ['--list', '--quiet'], { env: { ...process.env, WSL_UTF8: '1' }, timeout: 3000, windowsHide: true }).toString('utf8')
  } catch {
    return []
  }
  return parseWslList(out).flatMap((distro) => {
    for (const base of [`\\\\wsl.localhost\\${distro}`, `\\\\wsl$\\${distro}`]) {
      if (!exists(base)) continue
      return [...dirs(path.join(base, 'home')), path.join(base, 'root')].map((dir) => ({ dir, where: `WSL ${distro}` }))
    }
    return []
  })
}

/** `wsl -l -q` output, UTF-8 or UTF-16 (older WSL), minus Docker's own distros. */
export function parseWslList(out: string): string[] {
  return out
    .replace(/\0/g, '')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !/^docker-desktop/i.test(s) && !/not installed|no installed distributions/i.test(s))
}

export function discoverRoots(o: DiscoverOptions = {}): Roots {
  const env = o.env ?? process.env
  const home = o.home ?? os.homedir()
  const platform = o.platform ?? process.platform
  const wsl = o.wsl ?? isWsl(env)
  const xdg = env.XDG_CONFIG_HOME || path.join(home, '.config')

  // other homes on this machine: Windows profiles from inside WSL, WSL distros from Windows
  const noWsl = o.noWsl ?? !!env.LORE_NO_WSL
  const others: Root[] = noWsl ? [] : wsl ? windowsHomesFromWsl() : platform === 'win32' ? (o.wslHomes ?? wslHomesFromWindows)() : []

  const claude = dedupe(
    [
      // CLAUDE_CONFIG_DIR first, but the default too: some versions still write there anyway
      ...list(env.CLAUDE_CONFIG_DIR).map((d) => ({ dir: d.replace(/[\\/]projects[\\/]?$/, ''), where: '' })),
      { dir: path.join(home, '.claude'), where: '' },
      { dir: path.join(xdg, 'claude'), where: '' },
      ...others.map((h) => ({ dir: path.join(h.dir, '.claude'), where: h.where })),
    ],
    isClaude,
  )
  const codex = dedupe(
    [...list(env.CODEX_HOME).map((dir) => ({ dir, where: '' })), { dir: path.join(home, '.codex'), where: '' }, ...others.map((h) => ({ dir: path.join(h.dir, '.codex'), where: h.where }))],
    isCodex,
  )

  // Gemini CLI: GEMINI_CLI_HOME replaces the home folder, so its data is GEMINI_CLI_HOME/.gemini;
  // under macOS's sandbox it moves to ~/.cache/.gemini
  const gemini = dedupe(
    [
      ...list(env.GEMINI_CLI_HOME).map((d) => ({ dir: path.join(d, '.gemini'), where: '' })),
      { dir: path.join(home, '.gemini'), where: '' },
      { dir: path.join(home, '.cache', '.gemini'), where: '' },
      ...others.map((h) => ({ dir: path.join(h.dir, '.gemini'), where: h.where })),
    ],
    isGemini,
  )

  // Pi: PI_CODING_AGENT_SESSION_DIR is the sessions folder itself; PI_CODING_AGENT_DIR holds one
  const pi = dedupe(
    [
      ...list(env.PI_CODING_AGENT_SESSION_DIR).map((dir) => ({ dir, where: '' })),
      ...list(env.PI_CODING_AGENT_DIR).map((d) => ({ dir: path.join(d, 'sessions'), where: '' })),
      { dir: path.join(home, '.pi', 'agent', 'sessions'), where: '' },
      ...others.map((h) => ({ dir: path.join(h.dir, '.pi', 'agent', 'sessions'), where: h.where })),
    ],
    exists,
  )
  // OpenClaw was Clawdbot, then Moltbot; `openclaw doctor` renames the folder, but not everyone ran it
  const openclaw = dedupe(
    [
      ...list(env.OPENCLAW_STATE_DIR).map((dir) => ({ dir, where: '' })),
      ...['.openclaw', '.clawdbot', '.moltbot', '.moldbot'].map((n) => ({ dir: path.join(home, n), where: '' })),
      ...others.map((h) => ({ dir: path.join(h.dir, '.openclaw'), where: h.where })),
    ],
    isOpenClaw,
  )

  // OpenCode and Kilo use XDG's data folder on every OS (~/.local/share, even on Windows)
  const dataHomes = [env.XDG_DATA_HOME, path.join(home, '.local', 'share'), ...(platform === 'win32' ? [env.APPDATA, env.LOCALAPPDATA] : [])].filter((d): d is string => !!d)
  const hasStore = (d: string) => {
    try {
      return exists(path.join(d, 'storage')) || fs.readdirSync(d).some((f) => f.endsWith('.db'))
    } catch {
      return false
    }
  }
  const opencode = dedupe(
    [...list(env.OPENCODE_DATA_DIR).map((dir) => ({ dir, where: '' })), ...dataHomes.map((d) => ({ dir: path.join(d, 'opencode'), where: '' })), ...others.map((h) => ({ dir: path.join(h.dir, '.local', 'share', 'opencode'), where: h.where }))],
    hasStore,
  )
  const kilo = dedupe(
    [...(env.KILO_DB ? [{ dir: path.dirname(env.KILO_DB), where: '' }] : []), ...dataHomes.map((d) => ({ dir: path.join(d, 'kilo'), where: '' })), ...others.map((h) => ({ dir: path.join(h.dir, '.local', 'share', 'kilo'), where: h.where }))],
    hasStore,
  )

  // Qwen Code: QWEN_RUNTIME_DIR, then QWEN_HOME, then ~/.qwen
  const qwen = dedupe(
    [...list(env.QWEN_RUNTIME_DIR), ...list(env.QWEN_HOME), path.join(home, '.qwen')].map((dir) => ({ dir, where: '' })).concat(others.map((h) => ({ dir: path.join(h.dir, '.qwen'), where: h.where }))),
    (d) => exists(path.join(d, 'projects')),
  )
  const copilot = dedupe(
    [...list(env.COPILOT_HOME), path.join(home, '.copilot')].map((dir) => ({ dir, where: '' })).concat(others.map((h) => ({ dir: path.join(h.dir, '.copilot'), where: h.where }))),
    (d) => exists(path.join(d, 'session-state')),
  )

  const desktop: string[] = []
  if (platform === 'darwin') desktop.push(path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code-sessions'))
  if (platform === 'win32') {
    // the Store (MSIX) install keeps app data in its own package folder
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    for (const pkg of dirs(path.join(local, 'Packages')).filter((d) => /[\\/]Claude_[^\\/]+$/.test(d))) desktop.push(path.join(pkg, 'LocalCache', 'Roaming', 'Claude', 'claude-code-sessions'))
    desktop.push(path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude-code-sessions'))
  }
  if (platform === 'linux') desktop.push(path.join(xdg, 'Claude', 'claude-code-sessions'))

  return { claude, codex, gemini, pi, openclaw, opencode, kilo, qwen, copilot, claudeDesktop: desktop.filter(exists) }
}

/**
 * Claude Code's global config files for a root: the one in the home folder above it, and
 * one beside it (CLAUDE_CONFIG_DIR puts it there). Both are read: a stale copy can sit in
 * either place, so callers take the plan from whichever has one and the earliest start.
 */
export function claudeConfigFiles(root: string): string[] {
  return [path.join(path.dirname(root), '.claude.json'), path.join(root, '.claude.json')].filter(exists)
}
