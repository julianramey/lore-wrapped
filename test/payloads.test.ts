// Every payload a real history can produce is one the collector accepts: built the way the
// client builds it (buildReport → buildStats with this machine's facts), validated the way the
// collector validates it (after a JSON round trip), and under the collector's MAX_BODY. Tiny
// and huge histories, each agent alone, every OS, odd clocks and languages, and reports with
// NaN, Infinity or negative numbers where a bug upstream could leave them.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { Machine } from '../src/pipeline/stats.ts'
import type { ThreadRecord } from '../src/types.ts'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-payloads-'))
process.env.LORE_HOME = path.join(tmp, 'home')
const { buildReport } = await import('../src/pipeline/facts.ts')
const { ledgerFromThreads } = await import('../src/pipeline/scan.ts')
const { buildStats, validateStats, rejectReason, MAX_BODY, NOTICE, OSES } = await import('../src/pipeline/stats.ts')
const { countRun, machineFacts } = await import('../src/pipeline/upload.ts')
const { SOURCE_KEYS } = await import('../src/sources/registry.ts')

const THIS_MONTH = new Date().toISOString().slice(0, 7)
const MACHINES: Machine[] = [
  ...OSES.map((o): Machine => ({ os: o, firstRunMonth: THIS_MONTH, runs: 1, notice: NOTICE })),
  { os: 'linux', firstRunMonth: '2026-10', runs: 99_999, notice: NOTICE },
]
const REPO_EMPTY = { repos: 0, tests: 0, ci: 0, container: 0, agentMd: 0, frameworks: [], files: { under_100: 0, '100_999': 0, '1k_9k': 0, '10k_plus': 0 }, age: { under_3mo: 0, '3_12mo': 0, '1_3y': 0, '3y_plus': 0 }, hosts: { none: 0, github: 0, gitlab: 0, bitbucket: 0, azure: 0, other: 0 }, licenses: { permissive: 0, copyleft: 0, other: 0, none: 0 }, team: { solo: 0, '2_5': 0, '6_20': 0, '21_plus': 0 }, outcomes: { checked: 0, committed: 0, reverted: 0 } }
const REPO_FULL = { repos: 30, tests: 20, ci: 15, container: 9, agentMd: 12, frameworks: ['django', 'dotnet', 'express', 'fastapi', 'flask', 'laravel', 'next', 'rails', 'react', 'spring', 'terraform'], files: { under_100: 3, '100_999': 10, '1k_9k': 12, '10k_plus': 5 }, age: { under_3mo: 9, '3_12mo': 8, '1_3y': 7, '3y_plus': 6 }, hosts: { none: 2, github: 20, gitlab: 3, bitbucket: 1, azure: 1, other: 3 }, licenses: { permissive: 10, copyleft: 2, other: 3, none: 15 }, team: { solo: 20, '2_5': 5, '6_20': 4, '21_plus': 1 }, outcomes: { checked: 40, committed: 29, reverted: 3 } }

/** The collector's verdict on what this client would send, and its size in bytes. */
function verdict(report: any, machine = MACHINES[0]) {
  const payload = buildStats(report, machine)
  const wire = JSON.stringify(payload)
  return { payload, errs: validateStats(JSON.parse(wire)), bytes: Buffer.byteLength(wire) }
}
function assertSendable(name: string, report: any) {
  for (const repoShape of [undefined, REPO_EMPTY, REPO_FULL])
    for (const m of MACHINES) {
      const { errs, bytes } = verdict({ ...report, repoShape }, m)
      assert.deepEqual(errs, [], `${name} (${m.os}${repoShape ? `, ${repoShape.repos} repos` : ''})`)
      assert.ok(bytes <= MAX_BODY, `${name}: ${bytes} bytes`)
    }
}

// ───────────────────────── histories, as the adapters would hand them over

interface Opts {
  sources: string[]
  prompts: number
  perThread?: number
  /** Per source; null for a harness that records no model. */
  models?: Record<string, string | null> | ((i: number) => string)
  timed?: boolean
  tokens?: number
  text?: (i: number) => string
  exts?: string[]
  spanDays?: number
  replies?: boolean
  recovered?: boolean
  approx?: boolean
  start?: number
  turnMs?: number
  windows?: boolean
  efforts?: string[]
  cmds?: string[]
}
const MODELS: Record<string, string | null> = {
  'claude-code': 'claude-sonnet-5-5', codex: 'gpt-5.6-sol', gemini: 'gemini-2.5-pro', pi: 'claude-opus-4-5', openclaw: 'anthropic/claude-opus-4-5',
  opencode: 'anthropic/claude-sonnet-4-5', kilo: 'kilo/x-ai/grok-code-fast-1', qwen: 'qwen3-coder-plus', copilot: 'claude-sonnet-4.5',
}
const ASKS = ['fix the login bug', 'add a csv export to the orders page', 'explain how the retry works', 'write tests for the parser', 'refactor the auth middleware']
const MORE = ['yes', 'continue', 'now the admin page', 'no, that broke the build', 'run the tests again', 'thanks']

function history(o: Opts) {
  const threads: ThreadRecord[] = []
  const per = o.perThread ?? 5
  const start = o.start ?? Date.UTC(2026, 8, 1, 14)
  const span = Math.max(1, o.spanDays ?? 30)
  for (let i = 0, left = o.prompts; left > 0; i++) {
    const n = Math.min(per, left)
    left -= n
    const source = o.sources[i % o.sources.length] as any
    const model = typeof o.models === 'function' ? o.models(i) : o.models && source in o.models ? o.models[source] : MODELS[source]
    const t0 = start + ((i * 7919) % (span * 24)) * 3_600_000
    const cwd = o.windows ? `C:\\Users\\dev\\code\\proj${i % 4}` : `/home/dev/proj${i % 4}`
    const events: any[] = []
    const tokens: ThreadRecord['tokens'] = {}
    const efforts: Record<string, number> = {}
    let [t, added] = [t0, 0]
    for (let k = 0; k < n; k++) {
      events.push({ k: 'h', t, id: `h${i}-${k}`, text: o.text ? o.text(i * per + k) : k === 0 ? ASKS[i % ASKS.length] : MORE[(i + k) % MORE.length], ln: 2 * k + 1, ...(k % 9 === 8 ? { afterInterrupt: true } : {}) })
      t += 30_000
      if (o.replies === false || o.recovered) continue
      const file = o.exts?.length ? `src${o.windows ? '\\' : '/'}f${k}.${o.exts[k % o.exts.length]}` : null
      const tok = o.tokens ?? 50_000
      if (model && tok) {
        const u = (tokens[model] ||= { in: 0, cached: 0, out: 0 })
        u.in += Math.round(tok * 0.1)
        u.cached += Math.round(tok * 0.85)
        u.out += Math.round(tok * 0.05)
      }
      const effort = o.efforts?.[k % o.efforts.length]
      if (effort) efforts[effort] = (efforts[effort] || 0) + 1
      if (file) added += 12
      const ms = o.turnMs ?? 120_000
      events.push({
        k: 'a', t, id: `a${i}-${k}`, text: 'Done.', tools: 3, toolNames: ['Bash', 'Edit'], ln: 2 * k + 2,
        ...(model ? { model } : {}), ...(o.timed === false ? {} : { ms }), ...(file ? { edits: [[file, 12, 3]] } : {}), ...(o.cmds ? { cmds: o.cmds } : {}), ...(effort ? { effort } : {}),
        ...(model && tok ? { tok: [Math.round(tok * 0.1), Math.round(tok * 0.85), Math.round(tok * 0.05)] } : {}),
      })
      t += o.timed === false ? 60_000 : ms
    }
    threads.push({
      id: `t${i}`, source, surface: 'cli', file: `/x/${i}`, archived: false, cwd, project: `proj${i % 4}`, startedAt: t0, endedAt: t, events,
      models: model ? { [model]: n } : {}, toolCalls: 3 * n, interrupts: 0, slashCommands: 0, tokens, agentMs: o.timed === false ? 0 : n * (o.turnMs ?? 120_000),
      linesAdded: added, linesRemoved: 0, efforts, planModeTurns: 0, warnings: [], ...(o.approx ? { approxTimes: true } : {}), ...(o.recovered ? { recovered: true } : {}),
    })
  }
  const scan = { threads, coverage: [], scannedAt: 0, scanMs: 1, filesParsed: threads.length, filesFromCache: 0, bytesParsed: 0, claudeStats: null, claudePlan: null, usage: ledgerFromThreads(threads) }
  return buildReport(scan as any).report
}

/** Eighteen months on each new model as it shipped, Claude Code and Codex side by side: thirteen families of about 8% each. */
const HOPPER = ['claude-sonnet-4-20250514', 'gpt-5', 'claude-opus-4-1-20250805', 'gpt-5-codex', 'claude-sonnet-4-5-20250929', 'gpt-5.1-codex', 'claude-opus-4-5-20251101', 'gpt-5.2-codex', 'claude-opus-4-6', 'gpt-5.3-codex', 'claude-opus-5', 'gpt-5.5', 'claude-opus-5-5']
const LANGS = ['ts', 'tsx', 'js', 'py', 'go', 'rs', 'swift', 'kt', 'java', 'rb', 'php', 'cs', 'cpp', 'c', 'sql', 'md', 'sh', 'yaml', 'json', 'html', 'css', 'vue', 'svelte', 'dart', 'ex', 'lua', 'tf', 'toml', 'prisma', 'zig', 'hs']

const CASES: [string, Opts][] = [
  ['one prompt', { sources: ['claude-code'], prompts: 1 }],
  ['one prompt, no reply on record', { sources: ['claude-code'], prompts: 1, replies: false }],
  ['two prompts', { sources: ['claude-code'], prompts: 2 }],
  ['two prompts in two conversations', { sources: ['codex'], prompts: 2, perThread: 1 }],
  ...SOURCE_KEYS.map((s): [string, Opts] => [`only ${s}`, { sources: [s], prompts: 40 }]),
  ...SOURCE_KEYS.map((s): [string, Opts] => [`only ${s}, one prompt`, { sources: [s], prompts: 1 }]),
  ...SOURCE_KEYS.map((s): [string, Opts] => [`only ${s}, no timings, no model, no tokens`, { sources: [s], prompts: 30, timed: false, models: { [s]: null }, tokens: 0 }]),
  ['all nine agents', { sources: SOURCE_KEYS, prompts: 900 }],
  ['zero follow-ups', { sources: ['claude-code'], prompts: 20, perThread: 1 }],
  ['zero swears', { sources: ['claude-code'], prompts: 20, text: () => 'please add a test' }],
  ['all caps', { sources: ['claude-code'], prompts: 50, text: (i) => (i % 2 ? 'FIX IT NOW' : 'WHY IS THIS STILL BROKEN') }],
  ['every prompt a swear', { sources: ['claude-code', 'codex'], prompts: 200, text: (i) => ['wtf', 'fuck this', 'shit', 'damn it', 'FUCKING FIX IT'][i % 5] }],
  ['only "yes"', { sources: ['claude-code'], prompts: 30, text: () => 'yes' }],
  ['only "Continue."', { sources: ['codex'], prompts: 30, text: () => 'Continue.' }],
  ['no agent timings at all', { sources: ['claude-code', 'codex'], prompts: 200, timed: false }],
  ['transcripts all deleted (history only)', { sources: ['claude-code'], prompts: 100, recovered: true }],
  ['approximate times', { sources: ['claude-code'], prompts: 40, approx: true }],
  ['no model known', { sources: ['claude-code', 'codex'], prompts: 100, models: { 'claude-code': null, codex: null } }],
  ['custom and local models', { sources: ['claude-code', 'codex', 'opencode'], prompts: 300, models: { 'claude-code': 'acme-internal-sonnet', codex: 'my-company/gpt-ft:abc', opencode: 'ollama/llama3.3:70b' } }],
  ['thirteen model families over eighteen months', { sources: ['claude-code', 'codex'], prompts: 3240, perThread: 6, spanDays: 540, start: Date.UTC(2025, 3, 1), models: (i) => HOPPER[Math.min(HOPPER.length - 1, Math.floor((i / 540) * HOPPER.length))] }],
  ['thirty model families with 100+ follow-ups each', { sources: ['opencode'], prompts: 4500, perThread: 15, models: (i) => ['claude-3-5-haiku', 'claude-3-5-sonnet', 'claude-3-7-sonnet', 'claude-sonnet-4', 'claude-sonnet-4-5', 'claude-opus-4', 'claude-opus-4-1', 'claude-opus-4-5', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5', 'claude-opus-5-5', 'claude-sonnet-4-6', 'claude-sonnet-5', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'gpt-4o', 'gpt-4.1', 'o3', 'o4-mini', 'gpt-5', 'gpt-5-mini', 'gpt-5-codex', 'gpt-5.1', 'gpt-5.2', 'gpt-5.4', 'gpt-5.5', 'gemini-2.5-pro', 'gemini-2.5-flash'][i % 30] }],
  ['Spanish', { sources: ['claude-code'], prompts: 60, text: (i) => ['arregla el login por favor', 'joder, sigue roto', 'gracias', 'sí'][i % 4] }],
  ['Chinese', { sources: ['codex'], prompts: 60, text: (i) => ['修复登录页面', '卧槽 还是不行', '谢谢', '继续'][i % 4] }],
  ['Japanese', { sources: ['claude-code'], prompts: 60, text: (i) => ['ログインを直して', 'まだ壊れてる', 'ありがとう', '続けて'][i % 4] }],
  ['emoji and empty prompts', { sources: ['claude-code'], prompts: 20, text: (i) => (i % 2 ? '👍' : '') }],
  ['Windows paths', { sources: ['claude-code', 'codex'], prompts: 100, windows: true, exts: ['ts', 'py', 'cs'] }],
  ['every language lore knows, and some it doesn’t', { sources: ['claude-code'], prompts: 400, exts: LANGS }],
  ['one line of one language', { sources: ['claude-code'], prompts: 1, exts: ['ts'] }],
  ['effort levels, tests run', { sources: ['codex'], prompts: 50, efforts: ['xhigh', 'low', 'max', 'ultra'], cmds: ['npm test', 'pytest -x'] }],
  ['a single 40-hour turn', { sources: ['codex'], prompts: 2, turnMs: 40 * 3_600_000 }],
  ['ten years of history', { sources: ['codex'], prompts: 500, spanDays: 3650, start: Date.UTC(2016, 0, 1) }],
  ['timestamps in the future', { sources: ['claude-code'], prompts: 5, start: Date.UTC(2027, 5, 1) }],
  ['timestamps at the epoch', { sources: ['claude-code'], prompts: 5, start: 0 }],
  // a few prompts typed by hand, thousands of SDK and exec runs: their tokens count, their prompts don't
  ['automation dwarfs typed prompts', { sources: ['claude-code'], prompts: 12, tokens: 4e9 }],
  ['a very heavy user: 100k prompts, 500B tokens, 10k hours', { sources: ['claude-code', 'codex'], prompts: 100_000, perThread: 50, tokens: 5e6, turnMs: 360_000, spanDays: 900, exts: ['ts', 'py', 'go', 'rs', 'swift', 'sql', 'md'] }],
]

test('every realistic history makes a payload the collector accepts, under its size limit, on every OS', () => {
  for (const [name, o] of CASES) assertSendable(name, history(o))
})

test('the histories that used to be refused: thirteen model families, and automation-heavy token counts', () => {
  const hopper = verdict(history(CASES.find(([n]) => n.startsWith('thirteen'))![1])).payload
  assert.equal(Object.keys(hopper.model_share).length, 12, 'the 12 largest families, not all 13')
  const wide = verdict(history(CASES.find(([n]) => n.startsWith('thirty'))![1])).payload
  assert.equal(Object.keys(wide.steer_by_model).length, 24, 'the 24 families with the most follow-ups')
  assert.deepEqual(Object.keys(wide.interrupt_by_model), Object.keys(wide.steer_by_model))
  const auto = verdict(history(CASES.find(([n]) => n.startsWith('automation'))![1])).payload
  assert.equal(auto.tokens_per_prompt, 1e8, 'at its ceiling, not past it')
  assert.ok(auto.tokens > 4e10, 'the total stays exact')
})

test('timezones from UTC−11 to UTC+14 change nothing that would be refused', () => {
  const was = process.env.TZ
  try {
    for (const tz of ['Pacific/Pago_Pago', 'America/St_Johns', 'UTC', 'Asia/Kathmandu', 'Pacific/Kiritimati']) {
      process.env.TZ = tz
      assertSendable(`TZ=${tz}`, history({ sources: ['claude-code', 'codex'], prompts: 300, start: Date.UTC(2025, 11, 31, 23) }))
    }
  } finally {
    if (was === undefined) delete process.env.TZ
    else process.env.TZ = was
  }
})

test('a first run, and a state file left odd by an older version, still make valid machine facts', () => {
  const report = history({ sources: ['claude-code'], prompts: 10 })
  fs.rmSync(process.env.LORE_HOME!, { recursive: true, force: true })
  const first = machineFacts()
  assert.deepEqual([first.runs, first.firstRunMonth], [1, `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`])
  assert.deepEqual(verdict(report, first).errs, [])
  // runs recorded without a time used to make "NaN-NaN" the first-run month, for good
  fs.mkdirSync(process.env.LORE_HOME!, { recursive: true })
  fs.writeFileSync(path.join(process.env.LORE_HOME!, 'state.json'), JSON.stringify({ runs: [{ version: '0.4.0' }, { at: 'yesterday' }] }))
  countRun()
  assert.match(machineFacts().firstRunMonth, /^20\d\d-\d\d$/)
  assert.deepEqual(verdict(report, machineFacts()).errs, [])
  for (const odd of [{ firstRunMonth: 'NaN-NaN' }, { firstRunMonth: '1970-01' }, { runs: NaN }, { runs: 1e12 }, { os: 'freebsd' }])
    assert.deepEqual(verdict(report, { ...first, ...odd } as any).errs, [], JSON.stringify(odd))
})

test('a number a bug upstream leaves NaN, infinite, negative or huge costs that field its precision, never the send', () => {
  const base: any = { ...history({ sources: ['claude-code', 'codex'], prompts: 300, exts: ['ts', 'py'], cmds: ['npm test'] }), repoShape: REPO_FULL }
  const PATHS = [
    'totals.spanDays', 'totals.threads', 'totals.prompts', 'totals.activeDays', 'totals.projects', 'totals.steers', 'models.0.share',
    'steering.themes.0.share', 'steering.rate', 'steering.approvalsShare', 'steering.interruptsPer100',
    'deep.steeringByModel.0.followups', 'deep.steeringByModel.0.steers', 'deep.steeringByModel.0.interrupts', 'deep.intents.0.share',
    'deep.swear.bySource.0.per100', 'deep.swear.per100', 'deep.swear.allCaps', 'deep.manners.please', 'deep.manners.thanks',
    'spend.tokens', 'spend.estTokens', 'spend.subagentTokens', 'spend.cacheShare', 'spend.totalUsd',
    'deep.tasks.tested', 'deep.tasks.agentThreads', 'deep.tasks.redGreen', 'deep.tasks.long', 'deep.tasks.specOpenings', 'deep.tasks.openings',
    'deep.work.languages.0.lines', 'deep.work.linesAdded', 'deep.work.agentHours', 'deep.work.agentMinutesPerPrompt', 'deep.work.actionsPerPrompt',
    'rhythm.nightShare', 'rhythm.weekendShare', 'style.medianWords', 'deep.effort.highShare', 'deep.timeToSteer.medianSec',
    'records.longestSession.minutes', 'streak.days', 'deep.crossTool.switches',
    'repoShape.repos', 'repoShape.tests', 'repoShape.files.under_100', 'repoShape.outcomes.checked', 'repoShape.outcomes.committed', 'repoShape.outcomes.reverted',
  ]
  const set = (o: any, p: string, v: unknown) => {
    const ks = p.split('.')
    const parent = ks.slice(0, -1).reduce((x, k) => x?.[k], o)
    assert.ok(parent && typeof parent === 'object', `no ${p} in the sample report`)
    parent[ks.at(-1)!] = v
  }
  for (const p of PATHS)
    for (const v of [NaN, Infinity, -Infinity, -1, -0.3, 0.123, 1.7, 1e300, 1e9 + 0.5, null, undefined]) {
      const r = structuredClone(base)
      set(r, p, v)
      assert.deepEqual(verdict(r).errs, [], `${p} = ${v}`)
    }
  // and names off lore's lists are dropped, never sent
  for (const [p, v] of [
    ['deep.tasks.mcpKinds', ['browser', 'acme-internal']], ['deep.work.languages.0.lang', 'constructor'], ['deep.work.languages.0.lang', '__proto__'],
    ['steering.themes.0.key', 'my secret project'], ['deep.intents.0.key', 'toString'], ['deep.swear.bySource.0.source', 'cursor'], ['deep.swear.words', [{ word: 'frick', count: 3 }]],
    ['bySource', [{ source: 'cursor', threads: 3 }]], ['repoShape.frameworks', ['@acme/billing']], ['repoShape.hosts', { github: 3, sourcehut: 1 }], ['repoShape.files', { under_100: 40_000 }],
  ] as [string, unknown][]) {
    const r = structuredClone(base)
    set(r, p, v)
    assert.deepEqual(verdict(r).errs, [], `${p} = ${JSON.stringify(v)}`)
  }
})

test('the collector counts a refusal by its first field, never a value, a key or a name the sender made up', () => {
  assert.equal(rejectReason(['bad model_share.acme-confidential-7b', 'bad prompts']), 'bad model_share')
  assert.equal(rejectReason(['unexpected field jane@acme.com']), 'unexpected field')
  assert.equal(rejectReason(['missing tokens_per_prompt']), 'missing tokens_per_prompt')
  assert.equal(rejectReason(['bad tokens_per_prompt']), 'bad tokens_per_prompt')
  assert.equal(rejectReason(['bad nonsense_field']), 'other')
  for (const r of ['not an object', 'bad json', 'too large']) assert.equal(rejectReason([r]), r)
  assert.equal(rejectReason([]), 'other')
})
