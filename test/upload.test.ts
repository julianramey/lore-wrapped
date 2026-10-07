import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { ThreadRecord } from '../src/types.ts'

// what was sent this month lives under LORE_HOME: keep this test's out of the real one
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-upload-'))
process.env.LORE_HOME = path.join(tmp, 'home')
const { sendStatsIfDue } = await import('../src/pipeline/upload.ts')
const { buildReport } = await import('../src/pipeline/facts.ts')
const { ledgerFromThreads } = await import('../src/pipeline/scan.ts')

function report() {
  const mk = (i: number): ThreadRecord => ({
    id: `t${i}`, source: 'claude-code', surface: 'cli', file: '/x', archived: false, cwd: '/p/alpha', project: 'alpha',
    startedAt: Date.UTC(2026, 0, 1 + i), endedAt: Date.UTC(2026, 0, 1 + i, 1), models: { m: 2 }, toolCalls: 4, interrupts: 0, slashCommands: 0,
    tokens: { m: { in: 1000, cached: 500000, out: 900 } }, agentMs: 600_000, linesAdded: 10, linesRemoved: 2, efforts: {}, planModeTurns: 0, warnings: [],
    events: [
      { k: 'h', t: Date.UTC(2026, 0, 1 + i, 0, 1), id: `h${i}`, text: 'fix the login page', ln: 1 },
      { k: 'a', t: Date.UTC(2026, 0, 1 + i, 0, 5), id: `a${i}`, text: 'Fixed.', tools: 3, toolNames: [], model: 'm', ln: 2, ms: 240_000, edits: [['src/login.ts', 10, 2]] },
    ],
  })
  const threads = Array.from({ length: 6 }, (_, i) => mk(i))
  const scan = { threads, coverage: [], scannedAt: 0, scanMs: 1, filesParsed: 6, filesFromCache: 0, bytesParsed: 0, claudeStats: null, claudePlan: null, usage: ledgerFromThreads(threads) }
  return buildReport(scan as any).report
}

test('the first run sends the counts, later runs that month send nothing, and off means off', async () => {
  const posts: { url: string; body: unknown }[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    posts.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    return new Response('{"ok":true}', { status: 202 })
  }) as typeof fetch
  try {
    const r = report()
    const cfg = { endpoint: 'https://collector.test', stats: true, ai: false, offline: false } as any
    const first = await sendStatsIfDue(r, cfg)
    assert.equal(first.state, 'sent', first.detail)
    assert.deepEqual(posts, [{ url: 'https://collector.test/v1/stats', body: first.payload }])
    assert.equal((await sendStatsIfDue(r, cfg)).state, 'already-sent')
    assert.equal(posts.length, 1, 'at most once a month')

    // a fresh machine with stats turned off sends nothing, first run or not
    fs.rmSync(process.env.LORE_HOME!, { recursive: true, force: true })
    assert.equal((await sendStatsIfDue(r, { ...cfg, stats: false, statsOff: '--no-stats' })).state, 'disabled')
    assert.equal((await sendStatsIfDue(r, { ...cfg, endpoint: '' })).state, 'no-endpoint')
    assert.equal(posts.length, 1)
  } finally {
    globalThis.fetch = realFetch
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
