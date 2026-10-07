// Programmatic API: the same local pipeline the CLI runs, for scripts and other tools.
//
//   import { scan, buildReport } from 'lore-wrapped'
//   const { report } = buildReport(await scan())
//
// Everything runs locally. Nothing here sends data anywhere.

export { scan, type ScanResult, type ScanProgress } from './pipeline/scan.ts'
export { buildReport, DEFINITIONS } from './pipeline/facts.ts'
export { findCandidates, enrichCandidates, toPayload, type EpisodeCandidate, type EpisodePayload, type EpisodeFunnel } from './pipeline/episodes.ts'
export { makeRedactor } from './pipeline/redact.ts'
export { buildStats, validateStats, STATS_SCHEMA, type AnonStats } from './pipeline/stats.ts'
export { classifyHuman, classifyThread, STEER_THEMES } from './pipeline/classify.ts'
export { ARCHETYPES } from './pipeline/archetype.ts'
export { VERSION } from './config.ts'
export type * from './report-types.ts'
export type * from './types.ts'
