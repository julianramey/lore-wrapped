// Opening things on someone else's machine: macOS, Windows, Linux desktops, WSL, headless
// servers and SSH sessions. Every command is chosen by a pure function and spawned without
// a shell, and a missing opener never crashes lore: it just prints the URL instead.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface Host {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  wsl: boolean
}

export function isWsl(env = process.env): boolean {
  if (process.platform !== 'linux') return false
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true
  if (/microsoft/i.test(os.release())) return true
  try {
    return fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')
  } catch {
    return false
  }
}

export const host = (): Host => ({ platform: process.platform, env: process.env, wsl: isWsl() })

/** Over SSH, or on a Linux box with no display: there's no browser to open here. */
export function headless(h: Host): boolean {
  if (h.env.SSH_CONNECTION || h.env.SSH_TTY) return true
  return h.platform === 'linux' && !h.wsl && !h.env.DISPLAY && !h.env.WAYLAND_DISPLAY
}

/** How to open a URL here, or null when nothing can. */
export function openCommand(url: string, h: Host): { cmd: string; args: string[]; cwd?: string } | null {
  if (headless(h)) return null
  if (h.platform === 'darwin') return { cmd: 'open', args: [url] }
  if (h.platform === 'win32') return { cmd: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] }
  if (h.wsl) return { cmd: '/mnt/c/Windows/System32/cmd.exe', args: ['/c', 'start', '""', url], cwd: '/mnt/c' }
  if (h.env.BROWSER) return { cmd: h.env.BROWSER, args: [url] }
  return { cmd: 'xdg-open', args: [url] }
}

/** How to show a file in the system file browser, or null. */
export function revealCommand(file: string, h: Host): { cmd: string; args: string[] } | null {
  if (h.platform === 'darwin') return { cmd: 'open', args: ['-R', file] }
  if (h.platform === 'win32') return { cmd: 'explorer.exe', args: [`/select,${file}`] }
  if (headless(h)) return null
  return { cmd: 'xdg-open', args: [path.dirname(file)] }
}

/** Runs a detached opener; false when there's none or it can't start. Never throws. */
export function launch(c: { cmd: string; args: string[]; cwd?: string } | null): boolean {
  if (!c) return false
  try {
    const child = spawn(c.cmd, c.args, { stdio: 'ignore', detached: true, windowsHide: true, cwd: c.cwd })
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}
