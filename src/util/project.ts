// Project names from working directories. Reads the filesystem (to find a folder's git repo),
// so it lives apart from the pure text helpers.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { baseName, normPath } from './text.ts'

/** A home directory on macOS, Linux, Windows, WSL, or a WSL distro seen from Windows (normalized). */
const HOME_DIR = /^(\/Users\/[^/]+|\/home\/[^/]+|\/root|[a-z]:\/Users\/[^/]+|\/mnt\/[a-z]\/Users\/[^/]+|\/\/wsl(?:\.localhost|\$)\/[^/]+\/(?:home\/[^/]+|root))$/i
/** Folders that aren't projects: temp dirs, Claude Desktop's no-folder workspaces, Codex app chats with no project. */
const SCRATCH = /^\/(private\/)?(tmp|var\/folders)(\/|$)|\/AppData\/Local\/Temp(\/|$)|\/Claude\/scratch-workspaces(\/|$)|\/Documents\/Codex\/\d{4}-\d{2}-\d{2}(\/|$)/i

const gitRoots = new Map<string, string | null>()
/**
 * The repo a folder belongs to, when it still exists here: a monorepo's packages/web is
 * one project, and a linked worktree is its main repo. Stops below the home folder, so a
 * dotfiles repo in ~ can't swallow everything.
 */
function gitRoot(dir: string): string | null {
  if (gitRoots.has(dir)) return gitRoots.get(dir)!
  let found: string | null = null
  let d = dir
  for (let i = 0; i < 12 && d && !HOME_DIR.test(d) && d !== path.dirname(d); i++, d = path.dirname(d)) {
    const git = path.join(d, '.git')
    let st: fs.Stats | null = null
    try {
      st = fs.statSync(git)
    } catch {
      continue
    }
    if (st.isFile()) {
      // a linked worktree: "gitdir: /path/to/repo/.git/worktrees/<name>"
      const m = fs.readFileSync(git, 'utf8').match(/gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/]/)
      found = m ? normPath(m[1]) : d
    } else found = d
    break
  }
  gitRoots.set(dir, found)
  return found
}

/**
 * A project name from a working directory: worktrees and monorepo folders fold into their
 * repo, the home directory and scratch folders get readable names.
 */
export function projectFromCwd(cwd: string): string {
  if (!cwd) return 'unknown'
  let p = normPath(cwd)
  // Codex app worktrees: $CODEX_HOME/worktrees/<id>/<repo>
  const cwt = p.match(/\/\.codex\/worktrees\/[^/]+\/([^/]+)/)
  if (cwt) return cwt[1]
  // Claude worktrees: <repo>/.claude/worktrees/<name>
  const wt = p.match(/^(.*?)\/\.claude\/worktrees\//)
  if (wt) p = wt[1]
  if (normPath(os.homedir()) === p || HOME_DIR.test(p)) return '~'
  if (SCRATCH.test(p)) return 'scratch'
  const root = gitRoot(p)
  if (root && root !== p && !HOME_DIR.test(root)) p = root
  return baseName(p) || p
}

