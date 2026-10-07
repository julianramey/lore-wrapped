// What changed since you last ran lore on this machine. Each run leaves one line per day in
// ~/.lore/state.json (a few counts, your card, your twin); the next run compares against the
// latest one at least a day old, so running twice in an afternoon doesn't report "+3
// prompts". Nothing here leaves the machine.

import type { Report, Since } from '../report-types.ts'

export interface RunMark {
  at: number
  version: string
  card: string
  cardName: string
  code: string
  twin: string
  twinName: string
  prompts: number
  threads: number
  steer: number
  usd: number
  projects: number
}

/** Notes for returning users, newest first: shown once to anyone whose last run was older. */
export const CHANGELOG: { version: string; notes: string[] }[] = []

const DAY = 86_400_000
const KEEP = 60

export function markOf(r: Report): RunMark {
  return {
    at: r.generatedAt,
    version: r.version,
    card: r.archetype.key,
    cardName: r.archetype.name,
    code: r.archetype.code,
    twin: r.archetype.twin.key,
    twinName: r.archetype.twin.name,
    prompts: r.totals.prompts,
    threads: r.totals.threads,
    steer: r.steering.rate,
    usd: r.spend.totalUsd,
    projects: r.totals.projects,
  }
}

/** The run history with this run recorded: one mark per calendar day, the latest kept. */
export function recordRun(marks: RunMark[] = [], mark: RunMark): RunMark[] {
  const day = (t: number) => new Date(t).toDateString()
  return [...marks.filter((m) => day(m.at) !== day(mark.at)), mark].sort((a, b) => a.at - b.at).slice(-KEEP)
}

const newer = (a: string, b: string) => {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
  return false
}

export function sinceLast(r: Report, marks: RunMark[] = []): Since | null {
  const base = [...marks].reverse().find((m) => m.at <= r.generatedAt - 0.8 * DAY && m.version)
  if (!base) return null
  const now = markOf(r)
  return {
    at: base.at,
    version: base.version,
    // transcripts Claude deleted since can shrink a total; a negative "new" reads as a bug
    prompts: Math.max(0, now.prompts - base.prompts),
    threads: Math.max(0, now.threads - base.threads),
    usd: Math.max(0, now.usd - base.usd),
    projects: Math.max(0, now.projects - base.projects),
    // named only among your top projects, which are the ones the report shows anyway
    newProjects: r.projects.filter((p) => p.first > base.at && p.name !== 'unknown').map((p) => p.name),
    card: base.card !== now.card ? { from: base.cardName, to: now.cardName } : null,
    code: base.code !== now.code ? { from: base.code, to: now.code } : null,
    twin: base.twin !== now.twin ? { from: base.twinName, to: now.twinName } : null,
    steer: { from: base.steer, to: now.steer },
    notes: CHANGELOG.filter((c) => newer(c.version, base.version) && !newer(c.version, r.version)).flatMap((c) => c.notes.map((n) => `${c.version}: ${n}`)),
  }
}
