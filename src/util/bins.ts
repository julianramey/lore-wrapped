// Running the person's own `claude` and `codex` on any OS. On Windows, npm installs them as
// .cmd shims that Node can't spawn without a shell, and a shell would need every argument
// quoted, so a shim is run through the JavaScript file it wraps instead.

import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** The full path of a command on PATH (with PATHEXT on Windows), or null. */
export function resolveBin(name: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  const dirs = (env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean)
  const exts = platform === 'win32' ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : ['']
  for (const d of dirs) {
    for (const e of exts) {
      const p = path.join(d, name + e.toLowerCase())
      try {
        if (fs.statSync(p).isFile()) return p
      } catch {
        /* not here */
      }
    }
  }
  return null
}

/** How to run a command with arguments, without a shell. Null when it isn't installed. */
export function binCommand(name: string, args: string[], platform: NodeJS.Platform = process.platform): { cmd: string; args: string[] } | null {
  const bin = resolveBin(name, process.env, platform)
  if (!bin) return null
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(bin)) return { cmd: bin, args }
  // an npm shim: `"%dp0%\node_modules\…\cli.js" %*` → run that file with this Node
  try {
    const m = fs.readFileSync(bin, 'utf8').match(/"%~?dp0%?\\?([^"]+\.(?:c|m)?js)"/i)
    if (m) return { cmd: process.execPath, args: [path.join(path.dirname(bin), m[1]), ...args] }
  } catch {
    /* fall through */
  }
  // anything else: cmd.exe, with each argument quoted
  const q = (a: string) => `"${a.replace(/"/g, '""')}"`
  return { cmd: 'cmd.exe', args: ['/d', '/s', '/c', `"${[q(bin), ...args.map(q)].join(' ')}"`] }
}

export function spawnBin(name: string, args: string[], opts: Parameters<typeof spawn>[2]): ChildProcess {
  const c = binCommand(name, args)
  if (!c) throw Object.assign(new Error(`${name} not found on PATH`), { code: 'ENOENT' })
  return spawn(c.cmd, c.args, { ...opts, windowsHide: true, windowsVerbatimArguments: c.cmd === 'cmd.exe' })
}

/** Stops a child and anything it started (a shim's real process on Windows). */
export function killTree(child: ChildProcess) {
  if (process.platform === 'win32' && child.pid) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {})
      return
    } catch {
      /* fall back */
    }
  }
  child.kill('SIGTERM')
}
