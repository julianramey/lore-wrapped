// The shape of the code agents worked in, for the opt-in part of the stats: counts across
// the git repos where agents edited files, never one repo's row. Read-only git and file
// checks with a time limit on each; nothing here names a repo, a path, an author or a
// remote, and authors' emails are only counted, in memory.

import fs from 'node:fs'
import path from 'node:path'
import type { RepoShape } from '../report-types.ts'
import type { ThreadRecord } from '../types.ts'
import { git, gitOutcome } from './git.ts'

import { AGES, FILE_SIZES, FRAMEWORKS, HOSTS, LICENSES, TEAMS } from './vocab.ts'

export { AGES, FILE_SIZES, FRAMEWORKS, HOSTS, LICENSES, TEAMS }
const MANIFESTS = /(^|\/)(package\.json|pyproject\.toml|requirements[^/]*\.txt|Gemfile|composer\.json|pom\.xml|build\.gradle(\.kts)?|pubspec\.yaml)$/
const TESTS = /(^|\/)(tests?|__tests__|spec|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py|rb|exs)$|(^|\/)test_[^/]+\.py$|Tests?\.(swift|kt|java|cs)$/
const CI = /^(\.github\/workflows\/|\.gitlab-ci\.yml$|\.circleci\/|azure-pipelines\.yml$|Jenkinsfile$|\.buildkite\/|bitbucket-pipelines\.yml$)/
const CONTAINER = /(^|\/)(Dockerfile[^/]*|(docker-)?compose\.ya?ml|flake\.nix|shell\.nix)$|^\.devcontainer\//
const AGENT_MD = /(^|\/)(AGENTS|CLAUDE|GEMINI)\.md$/
const LICENSE = /^(LICEN[CS]E|COPYING)(\.[a-z]+)?$/i

const hostOf = (url: string): (typeof HOSTS)[number] => {
  if (!url) return 'none'
  if (/github\.com[:/]/.test(url)) return 'github'
  if (/gitlab\.com[:/]/.test(url)) return 'gitlab'
  if (/bitbucket\.org[:/]/.test(url)) return 'bitbucket'
  if (/dev\.azure\.com|visualstudio\.com/.test(url)) return 'azure'
  return 'other'
}
const licenseOf = (text: string | null): (typeof LICENSES)[number] => {
  if (text === null) return 'none'
  if (/GNU (AFFERO |LESSER )?GENERAL PUBLIC|Mozilla Public License|Eclipse Public License|European Union Public/i.test(text)) return 'copyleft'
  if (/MIT License|Permission is hereby granted|Apache License|BSD|ISC License|Unlicense|zlib|Creative Commons Zero/i.test(text)) return 'permissive'
  return 'other'
}
const fileSize = (n: number) => FILE_SIZES[n < 100 ? 0 : n < 1000 ? 1 : n < 10_000 ? 2 : 3]
const age = (ms: number) => AGES[ms < 91 * 864e5 ? 0 : ms < 365 * 864e5 ? 1 : ms < 3 * 365 * 864e5 ? 2 : 3]
const team = (n: number) => TEAMS[n <= 1 ? 0 : n <= 5 ? 1 : n <= 20 ? 2 : 3]

const read = (file: string, bytes = 4096): string | null => {
  try {
    const fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(bytes)
    const n = fs.readSync(fd, buf, 0, bytes, 0)
    fs.closeSync(fd)
    return buf.subarray(0, n).toString('utf8')
  } catch {
    return null
  }
}

/** A few at a time, so a machine with many repos isn't swamped. */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const j = i++
      out[j] = await fn(items[j])
    }
  }))
  return out
}

const MAX_REPOS = 30
const MAX_OUTCOMES = 40

export async function repoShape(threads: ThreadRecord[], now = Date.now()): Promise<RepoShape> {
  // the repos agents edited in, most recent first
  const edited = threads.filter((t) => t.cwd && t.events.some((e) => e.k === 'a' && e.edits?.length)).sort((a, b) => b.endedAt - a.endedAt)
  const cwds = [...new Set(edited.map((t) => t.cwd))].filter((c) => fs.existsSync(c)).slice(0, 80)
  const tops = [...new Set((await pool(cwds, 6, (c) => git(c, ['rev-parse', '--show-toplevel']))).map((x) => x?.trim()).filter((x): x is string => !!x))].slice(0, MAX_REPOS)

  const shape: RepoShape = {
    repos: tops.length,
    tests: 0,
    ci: 0,
    container: 0,
    agentMd: 0,
    frameworks: [],
    files: Object.fromEntries(FILE_SIZES.map((k) => [k, 0])),
    age: Object.fromEntries(AGES.map((k) => [k, 0])),
    hosts: Object.fromEntries(HOSTS.map((k) => [k, 0])),
    licenses: Object.fromEntries(LICENSES.map((k) => [k, 0])),
    team: Object.fromEntries(TEAMS.map((k) => [k, 0])),
    outcomes: { checked: 0, committed: 0, reverted: 0 },
  }
  const fws = new Set<string>()
  await pool(tops, 4, async (top) => {
    const ls = await git(top, ['ls-files', '-z'], 64 << 20)
    const files = ls ? ls.split('\0').filter(Boolean) : []
    shape.files[fileSize(ls === null ? 10_000 : files.length)]++
    if (files.some((f) => TESTS.test(f))) shape.tests++
    if (files.some((f) => CI.test(f))) shape.ci++
    if (files.some((f) => CONTAINER.test(f))) shape.container++
    if (files.some((f) => AGENT_MD.test(f))) shape.agentMd++
    const manifests = files.filter((f) => MANIFESTS.test(f) && f.split('/').length <= 3).slice(0, 12).map((f) => read(path.join(top, f), 64 * 1024) || '').join('\n')
    for (const [key, file, dep] of FRAMEWORKS) if ((file && files.some((f) => file.test(f))) || (dep && dep.test(manifests))) fws.add(key)

    const roots = (await git(top, ['log', '--max-parents=0', '--format=%ct'])) || ''
    const first = Math.min(...roots.split('\n').filter(Boolean).map((x) => Number(x) * 1000))
    if (Number.isFinite(first)) shape.age[age(now - first)]++
    const authors = (await git(top, ['log', '--since=90.days.ago', '--format=%ae'])) || ''
    shape.team[team(new Set(authors.split('\n').filter(Boolean)).size)]++
    const remote = ((await git(top, ['remote'])) || '').split('\n').filter(Boolean)
    const url = remote.length ? ((await git(top, ['remote', 'get-url', remote.includes('origin') ? 'origin' : remote[0]])) || '').trim() : ''
    shape.hosts[hostOf(url)]++
    const lic = files.find((f) => LICENSE.test(f))
    shape.licenses[licenseOf(lic ? read(path.join(top, lic)) : null)]++
  })
  shape.frameworks = [...fws].sort()

  // kept and reverted: did the files an agent changed get committed within 72 hours?
  const recent = edited.filter((t) => now - t.endedAt < 90 * 864e5).slice(0, MAX_OUTCOMES)
  const outcomes = await pool(recent, 4, (t) => {
    const last = [...t.events].reverse().find((e) => e.k === 'a' && e.edits?.length)
    const files = last && last.k === 'a' ? (last.edits || []).map(([f]) => f) : []
    return gitOutcome(t.cwd, files, last?.t || t.endedAt)
  })
  for (const o of outcomes) {
    if (!o) continue
    shape.outcomes.checked++
    if (o.committed) shape.outcomes.committed++
    if (o.reverted) shape.outcomes.reverted++
  }
  return shape
}
