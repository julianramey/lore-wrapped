// What each optional model action cost, measured on the person's own plan.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { LORE_HOME, privateDir } from '../config.ts'
import { readCodexLimits, type PlanWindow, type ProviderId, type Usage } from './llm.ts'

export interface RunReceipt {
  id: string
  at: number
  action: 'narrative'
  provider: ProviderId
  model: string
  calls: number
  ms: number
  usage: Usage
  windows: PlanWindow[]
  cached: boolean
}

const FILE = path.join(LORE_HOME, 'runs.jsonl')

/** Runs a model action and records what it cost. Codex windows are read before and after. */
export async function measured<T extends { usage: Usage; ms: number; model: string; calls: number; windows: PlanWindow[]; cached?: boolean }>(
  action: RunReceipt['action'],
  provider: ProviderId,
  fn: () => Promise<T>,
): Promise<{ result: T; receipt: RunReceipt }> {
  const before = provider === 'codex' ? await readCodexLimits() : null
  const result = await fn()
  const after = provider === 'codex' && !result.cached ? await readCodexLimits() : before
  const label = (mins: number) => (mins >= 10000 ? 'Codex weekly window' : mins >= 250 ? 'Codex 5-hour window' : 'Codex window')
  const windows: PlanWindow[] =
    provider === 'codex'
      ? before || after
        ? [{ name: label((after || before)!.windowMins), before: before?.used ?? null, after: after?.used ?? null }]
        : []
      : result.windows
  const receipt: RunReceipt = { id: crypto.randomUUID().slice(0, 8), at: Date.now(), action, provider, model: result.model, calls: result.calls, ms: result.ms, usage: result.usage, windows, cached: !!result.cached }
  if (!receipt.cached) {
    try {
      privateDir(LORE_HOME)
      fs.appendFileSync(FILE, JSON.stringify(receipt) + '\n', { mode: 0o600 })
    } catch {
      /* receipts are informational */
    }
  }
  return { result, receipt }
}

export function recentReceipts(limit = 12): RunReceipt[] {
  try {
    return fs
      .readFileSync(FILE, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .slice(-limit)
      .reverse()
  } catch {
    return []
  }
}
