// Read-only git checks: did an agent's changed files get committed soon after, and were
// they reverted or reworked later? Matches state their basis.

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export interface GitSignal {
  committed: boolean
  minutesAfter: number | null
  subject: string | null
  /** Local only: never uploaded. */
  commit: string | null
  filesMatched: number
  laterChanges14d: number | null
  reverted: boolean | null
  basis: string
}

/**
 * A read-only git command, or null when it fails or runs past four seconds. Nothing is
 * fetched: in a partial clone, git would otherwise download missing objects from the remote
 * (GIT_NO_LAZY_FETCH from git 2.44, no protocols before that), and it never asks for credentials.
 */
export function git(cwd: string, args: string[], maxBuffer = 4 << 20): Promise<string | null> {
  const env = { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' }
  return new Promise((resolve) => {
    execFile('git', ['-c', 'protocol.allow=never', '-C', cwd, ...args], { timeout: 4000, maxBuffer, env }, (err, stdout) => resolve(err ? null : stdout))
  })
}

interface Commit {
  hash: string
  at: number
  subject: string
  files: string[]
}

function parseLog(out: string): Commit[] {
  const commits: Commit[] = []
  for (const block of out.split('\x1e').map((b) => b.trim()).filter(Boolean)) {
    const [head, ...files] = block.split('\n')
    const [hash, ct, ...subj] = head.split('\t')
    commits.push({ hash, at: Number(ct) * 1000, subject: subj.join('\t'), files: files.filter(Boolean) })
  }
  return commits.sort((a, b) => a.at - b.at)
}

export async function gitOutcome(cwd: string, files: string[], at: number): Promise<GitSignal | null> {
  if (!cwd || !files.length || !fs.existsSync(cwd)) return null
  const top = (await git(cwd, ['rev-parse', '--show-toplevel']))?.trim()
  if (!top) return null
  const rel = [...new Set(files.map((f) => (path.isAbsolute(f) ? path.relative(top, f) : path.relative(top, path.join(cwd, f)))).filter((f) => f && !f.startsWith('..')))]
  if (!rel.length) return null
  const since = Math.floor(at / 1000) - 60
  const window = 72 * 3600
  const log = await git(top, ['log', '--all', `--since=@${since}`, `--until=@${since + window}`, '--format=%x1e%H%x09%ct%x09%s', '--name-only', '--', ...rel])
  if (log === null) return null
  const first = parseLog(log).find((c) => c.at >= at - 60_000)
  const basis = 'a commit touching the same files within 72 hours of the steer'
  if (!first) return { committed: false, minutesAfter: null, subject: null, commit: null, filesMatched: 0, laterChanges14d: null, reverted: null, basis }
  const touched = first.files.filter((f) => rel.includes(f))
  const later = await git(top, ['log', '--all', `--since=@${Math.floor(first.at / 1000) + 1}`, `--until=@${Math.floor(first.at / 1000) + 14 * 86400}`, '--format=%x1e%H%x09%ct%x09%s', '--name-only', '--', ...touched])
  const laterCommits = later ? parseLog(later).filter((c) => c.hash !== first.hash) : []
  const reverted = laterCommits.some((c) => /^revert/i.test(c.subject) && (c.subject.includes(first.subject.slice(0, 40)) || c.subject.includes(first.hash.slice(0, 7))))
  return {
    committed: true,
    minutesAfter: Math.max(0, Math.round((first.at - at) / 60000)),
    subject: first.subject.slice(0, 120),
    commit: first.hash.slice(0, 10),
    filesMatched: touched.length,
    laterChanges14d: later ? laterCommits.length : null,
    reverted: later ? reverted : null,
    basis,
  }
}
