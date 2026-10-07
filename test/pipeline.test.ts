import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { classifyHuman } from '../src/pipeline/classify.ts'
import { findCandidates, toPayload } from '../src/pipeline/episodes.ts'
import { classifyThread } from '../src/pipeline/classify.ts'
import { makeRedactor } from '../src/pipeline/redact.ts'
import { deal, spectraOf, type Metrics } from '../src/pipeline/archetype.ts'
import { CALIBRATION } from '../src/pipeline/deck.ts'
import { TWINS, twinOf } from '../src/pipeline/twins.ts'
import { buildSpend, costOf } from '../src/pipeline/spend.ts'
import { ledgerFromThreads } from '../src/pipeline/scan.ts'
import { publicModel, topShare, validateStats } from '../src/pipeline/stats.ts'
import { recoverClaudeHistory } from '../src/sources/claudeHistory.ts'
import { keepClaudeHistory } from '../src/sources/claudeStats.ts'
import { parseClaudeFile } from '../src/sources/claude.ts'
import { parseCodexFile } from '../src/sources/codex.ts'
import type { HumanEvent, ThreadRecord } from '../src/types.ts'
import { perSource } from '../src/sources/registry.ts'
import { scanLines } from '../src/util/lines.ts'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-test-'))
const write = (name: string, lines: unknown[]) => {
  const f = path.join(tmp, name)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n')
  const st = fs.statSync(f)
  return { file: f, size: st.size, mtimeMs: st.mtimeMs, archived: false, subagentByPath: /[\\/]subagents[\\/]/.test(f) }
}

test('scanLines skips huge lines without assembling them and keeps lines across chunks', async () => {
  const big = 'x'.repeat(3 << 20) // 3 MB, spans several 1 MB chunks
  const f = path.join(tmp, 'lines.jsonl')
  fs.writeFileSync(f, `{"keep":1}\n{"skip":"${big}"}\n{"keep":2,"pad":"${'y'.repeat(1 << 20)}"}\n{"keep":3}`)
  const kept: number[] = []
  await scanLines(
    f,
    (head) => head.includes('"keep"'),
    (line, ln) => {
      const o = JSON.parse(line.toString())
      kept.push(o.keep)
      assert.equal(typeof ln, 'number')
    },
  )
  assert.deepEqual(kept, [1, 2, 3])
})

test('Claude adapter keeps typed prompts and drops injected, tool, meta and peer records', async () => {
  const base = { sessionId: 'S1', cwd: '/Users/me/proj', entrypoint: 'cli', isSidechain: false }
  const df = write('claude/proj/S1.jsonl', [
    { ...base, type: 'user', uuid: 'u1', timestamp: '2026-01-01T10:00:00Z', message: { role: 'user', content: 'build the login page' } },
    { ...base, type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T10:00:05Z', message: { id: 'm1', model: 'claude-x', content: [{ type: 'thinking', thinking: 'SECRET REASONING' }, { type: 'text', text: 'Done, added a form.' }, { type: 'tool_use', name: 'Edit', input: {} }] } },
    { ...base, type: 'user', uuid: 't1', timestamp: '2026-01-01T10:00:06Z', toolUseResult: {}, message: { role: 'user', content: [{ tool_use_id: 'x', type: 'tool_result', content: 'ok' }] } },
    { ...base, type: 'user', uuid: 'r1', timestamp: '2026-01-01T10:00:07Z', isMeta: true, message: { role: 'user', content: 'meta stuff' } },
    { ...base, type: 'user', uuid: 'p1', timestamp: '2026-01-01T10:00:08Z', origin: { kind: 'peer' }, message: { role: 'user', content: 'message from another agent' } },
    { ...base, type: 'user', uuid: 'i1', timestamp: '2026-01-01T10:00:09Z', message: { role: 'user', content: '[Request interrupted by user]' } },
    { ...base, type: 'user', uuid: 'u2', timestamp: '2026-01-01T10:00:10Z', message: { role: 'user', content: '<system-reminder>ignore me</system-reminder>no, use the existing auth helper' } },
    { type: 'ai-title', sessionId: 'S1', aiTitle: 'Login page' },
  ])
  const o = await parseClaudeFile(df)
  assert.equal(o.kind, 'thread')
  const t = (o as any).thread as ThreadRecord
  const humans = t.events.filter((e) => e.k === 'h') as HumanEvent[]
  assert.deepEqual(
    humans.map((h) => h.text),
    ['build the login page', 'no, use the existing auth helper'],
  )
  assert.equal(humans[1].afterInterrupt, true)
  assert.equal(t.title, 'Login page')
  assert.equal(t.toolCalls, 1)
  assert.ok(!JSON.stringify(t).includes('SECRET REASONING'), 'reasoning must never be read into events')
})

test('Claude subagent files count their tokens, each reply once, and never become threads', async () => {
  const u = { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 }
  const reply = (id: string, block: object, usage = u) => ({ type: 'assistant', isSidechain: true, timestamp: '2026-01-02T10:00:00Z', message: { id, model: 'claude-x', content: [block], usage } })
  const df = write('claude/proj/S1/subagents/agent-1.jsonl', [
    'this is not even json',
    { type: 'user', isSidechain: true, timestamp: '2026-01-02T09:59:00Z', message: { role: 'user', content: 'subagent task' } },
    // one reply written as three records (thinking, text, tool call), the first with a partial output count
    reply('m1', { type: 'thinking', thinking: 'x' }, { ...u, output_tokens: 3 }),
    reply('m1', { type: 'text', text: 'y' }),
    reply('m1', { type: 'tool_use', name: 'Read', input: {} }),
    reply('m2', { type: 'text', text: 'z' }),
  ])
  const o = await parseClaudeFile(df)
  assert.equal(o.kind, 'subagent')
  const usage = (o as any).usage
  assert.deepEqual(
    usage.rows.map((r: any[]) => [r[0], r[3], r[4], r[5], r[6]]),
    [
      ['c|m1', 110, 1000, 50, 100],
      ['c|m2', 110, 1000, 50, 100],
    ],
  )
  // Claude Code's own way: every record, repeats included
  assert.equal(Object.values(usage.raw).reduce((a: number, d: any) => a + d['claude-x'], 0), 1160 * 4 - 47)
  // its working time, keyed by reply: the task came a minute before the first one
  assert.deepEqual(usage.time, [['c|m1', 60_000]])
})

test('Codex adapter reads main threads, skips subagents from metadata, strips injected context, counts each call once', async () => {
  const meta = (extra: object) => ({ timestamp: '2026-02-01T00:00:00Z', type: 'session_meta', payload: { id: 'C1', cwd: '/Users/me/app', originator: 'codex-tui', source: 'cli', ...extra } })
  const rec = (t: string, id: string, last: number, cached = 0) => ({ timestamp: t, type: 'token_usage_record', payload: { response_id: id, usage: { input_tokens: last - 10, cached_input_tokens: cached, output_tokens: 10, total_tokens: last } } })
  const tc = (t: string, total: number, last: number, cached = 0) => ({ timestamp: t, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: total - 10, cached_input_tokens: cached, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: total }, last_token_usage: { input_tokens: last - 10, cached_input_tokens: cached, output_tokens: 10, total_tokens: last } } } })
  const sub = write('codex/sub.jsonl', [
    meta({ id: 'C2', source: { subagent: { thread_spawn: { parent_thread_id: 'C1' } } } }),
    { timestamp: '2026-02-01T00:00:01Z', type: 'turn_context', payload: { model: 'gpt-x' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'subagent task' }] } },
    rec('2026-02-01T00:00:02Z', 'r1', 500),
    tc('2026-02-01T00:00:02Z', 500, 500),
    tc('2026-02-01T00:00:03Z', 500, 500), // repeated: nothing new was billed
    rec('2026-02-01T00:00:04Z', 'r2', 700, 400),
    tc('2026-02-01T00:00:04Z', 1200, 700, 400),
    rec('2026-02-01T00:00:05Z', 'r3', 900), // the compaction call: a record with no token_count
  ])
  const so = await parseCodexFile(sub)
  assert.equal(so.kind, 'subagent')
  assert.deepEqual(
    (so as any).usage.rows.map((r: any[]) => [r[0].slice(0, 2), r[1], r[3], r[4], r[5]]),
    [
      ['x|', 'gpt-x', 490, 0, 10],
      ['x|', 'gpt-x', 290, 400, 10],
      ['r|', 'gpt-x', 890, 0, 10],
    ],
  )

  const df = write('codex/main.jsonl', [
    meta({}),
    { timestamp: '2026-02-01T00:00:01Z', type: 'turn_context', payload: { model: 'gpt-x' } },
    { timestamp: '2026-02-01T00:00:01Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>\n<cwd>/x</cwd>\n</environment_context>' }] } },
    { timestamp: '2026-02-01T00:00:02Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for /x\nbe nice' }] } },
    { timestamp: '2026-02-01T00:00:03Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fix the flaky test' }] } },
    { timestamp: '2026-02-01T00:00:04Z', type: 'response_item', payload: { type: 'reasoning', summary: [], content: 'HIDDEN' } },
    { timestamp: '2026-02-01T00:00:05Z', type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{}' } },
    { timestamp: '2026-02-01T00:00:06Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'I retried the test.' }] } },
    { timestamp: '2026-02-01T00:00:07Z', type: 'event_msg', payload: { type: 'turn_aborted' } },
    { timestamp: '2026-02-01T00:00:08Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: "don't retry, find the race" }] } },
  ])
  const o = await parseCodexFile(df)
  assert.equal(o.kind, 'thread')
  const t = (o as any).thread as ThreadRecord
  const humans = t.events.filter((e) => e.k === 'h') as HumanEvent[]
  assert.deepEqual(
    humans.map((h) => h.text),
    ['fix the flaky test', "don't retry, find the race"],
  )
  assert.equal(humans[1].afterInterrupt, true)
  assert.equal(t.models['gpt-x'], 1)
  assert.equal(t.toolCalls, 1)
  assert.ok(!JSON.stringify(t).includes('HIDDEN'))
})

test('agent time: Codex task durations, interrupted ones too, idle stretches out; older Codex read from timestamps', async () => {
  const meta = (id: string, version: string) => ({ timestamp: '2026-02-01T00:00:00Z', type: 'session_meta', payload: { id, cwd: '/Users/me/app', originator: 'codex_cli_rs', source: 'cli', cli_version: version } })
  const user = (t: string, text: string) => ({ timestamp: t, type: 'response_item', payload: { type: 'message', id: `msg_${t}`, role: 'user', content: [{ type: 'input_text', text }] } })
  const say = (t: string, text: string) => ({ timestamp: t, type: 'response_item', payload: { type: 'message', id: `msg_${t}`, role: 'assistant', content: [{ type: 'output_text', text }] } })
  const call = (t: string) => ({ timestamp: t, type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{}', call_id: 'c1' } })
  const out = (t: string) => ({ timestamp: t, type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: 'ok' } })
  const ev = (t: string, payload: object) => ({ timestamp: t, type: 'event_msg', payload })
  const min = (o: any) => o.thread.events.filter((e: any) => e.k === 'a').map((e: any) => [e.ms / 60_000, !!e.clock])

  const recorded = (await parseCodexFile(
    write('codex/timed.jsonl', [
      meta('N1', '0.150.0'),
      user('2026-09-01T10:00:00Z', 'migrate the database'),
      ev('2026-09-01T10:00:00Z', { type: 'task_started', turn_id: 't1' }),
      call('2026-09-01T10:10:00Z'),
      out('2026-09-01T10:40:00Z'), // a 30-minute command is work
      say('2026-09-01T13:10:00Z', 'Migrated.'), // then 2.5 hours with nothing: the laptop slept
      ev('2026-09-01T13:10:00Z', { type: 'task_complete', turn_id: 't1', duration_ms: 190 * 60_000 }),
      user('2026-09-01T13:20:00Z', 'and seed it'),
      ev('2026-09-01T13:20:00Z', { type: 'task_started', turn_id: 't2' }),
      call('2026-09-01T13:21:00Z'),
      ev('2026-09-01T13:26:00Z', { type: 'turn_aborted', turn_id: 't2', reason: 'interrupted', duration_ms: 6 * 60_000 }),
    ]),
  )) as any
  assert.deepEqual(min(recorded), [[190 - 120, false], [6, false]], 'only the first 30 minutes of the idle stretch count; a stopped task ran until you stopped it')
  assert.equal(recorded.thread.interrupts, 1)
  assert.deepEqual(recorded.usage.time.map((x: any[]) => x[0]), ['t1', 't2'], 'turn ids, so a subagent replaying them is not counted twice')

  // before 0.119 Codex wrote no duration, and closed a task only when the next prompt came
  const older = (await parseCodexFile(
    write('codex/old.jsonl', [
      meta('O1', '0.45.0'),
      user('2026-02-01T10:00:00Z', 'fix the build'),
      ev('2026-02-01T10:00:00Z', { type: 'task_started' }),
      call('2026-02-01T10:01:00Z'),
      out('2026-02-01T10:04:00Z'),
      say('2026-02-01T10:05:00Z', 'Fixed.'),
      user('2026-02-01T11:30:00Z', 'now the tests'),
      ev('2026-02-01T11:30:00Z', { type: 'task_complete' }),
      ev('2026-02-01T11:30:00Z', { type: 'task_started' }),
      say('2026-02-01T11:32:00Z', 'Done.'),
    ]),
  )) as any
  assert.deepEqual(min(older), [[5, true], [2, true]], 'from the prompt to the last agent event, not to the next prompt')
})

test('agent time: Claude turn durations lose idle stretches; without any, timestamps, and only for your prompts', async () => {
  const base = { cwd: '/Users/me/proj', entrypoint: 'cli', isSidechain: false }
  const u = (sid: string, uuid: string, t: string, content: string, extra = {}) => ({ ...base, sessionId: sid, type: 'user', uuid, timestamp: t, message: { role: 'user', content }, ...extra })
  const a = (sid: string, uuid: string, t: string, id: string, block: object) => ({ ...base, sessionId: sid, type: 'assistant', uuid, timestamp: t, message: { id, model: 'claude-x', content: [block] } })
  const text = (s: string) => ({ type: 'text', text: s })
  const min = (o: any) => o.thread.events.filter((e: any) => e.k === 'a').map((e: any) => [e.ms / 60_000, !!e.clock])
  const timed = (await parseClaudeFile(
    write('claude/time/T1.jsonl', [
      u('T1', 'u1', '2026-09-01T10:00:00Z', 'refactor the parser'),
      a('T1', 'a1', '2026-09-01T10:05:00Z', 'm1', text('Two subagents are on it.')),
      a('T1', 'a2', '2026-09-01T11:35:00Z', 'm2', text('Done.')), // 90 minutes waiting on them; their time counts apart
      { ...base, sessionId: 'T1', type: 'system', subtype: 'turn_duration', durationMs: 95.5 * 60_000, timestamp: '2026-09-01T11:35:30Z' },
    ]),
  )) as any
  assert.deepEqual(min(timed), [[35.5, false]])
  const untimed = (await parseClaudeFile(
    write('claude/time/T2.jsonl', [
      u('T2', 'v1', '2026-09-02T10:00:00Z', 'add a --json flag'),
      a('T2', 'b1', '2026-09-02T10:02:00Z', 'n1', { type: 'tool_use', id: 'x', name: 'Edit', input: {} }),
      a('T2', 'b2', '2026-09-02T10:03:00Z', 'n2', text('Added.')),
      u('T2', 'v2', '2026-09-02T10:20:00Z', 'a message from another agent', { origin: { kind: 'peer' } }),
      a('T2', 'b3', '2026-09-02T10:50:00Z', 'n3', text('Answered the other agent.')),
      u('T2', 'v3', '2026-09-02T11:00:00Z', 'thanks'),
      a('T2', 'b4', '2026-09-02T11:01:00Z', 'n4', text('Anytime.')),
    ]),
  )) as any
  assert.deepEqual(min(untimed), [[3, true], [1, true]], 'work for another agent is not time on your prompt')
})

test('agent hours are a floor when prompts have no record of the agent, with an estimate from their pace', async () => {
  const { buildReport } = await import('../src/pipeline/facts.ts')
  const t0 = Date.UTC(2026, 3, 1, 9)
  const thread = (i: number, recovered: boolean): ThreadRecord => ({
    id: `p${i}`, source: 'claude-code', surface: 'cli', file: '/x', archived: false, cwd: '/p/alpha', project: 'alpha',
    startedAt: t0 + i * 86_400_000, endedAt: t0 + i * 86_400_000 + 3_600_000, models: {}, toolCalls: 0, interrupts: 0, slashCommands: 0,
    tokens: {}, agentMs: 0, linesAdded: 0, linesRemoved: 0, efforts: {}, planModeTurns: 0, warnings: [], recovered: recovered || undefined,
    // three prompts ten minutes apart; timed ones bought 5 minutes of agent work each
    events: [0, 1, 2].flatMap((k) => {
      const t = t0 + i * 86_400_000 + k * 600_000
      const h = { k: 'h' as const, t, id: `h${i}-${k}`, text: 'keep going on the importer', ln: 1 }
      return recovered ? [h] : [h, { k: 'a' as const, t: t + 300_000, id: `a${i}-${k}`, text: 'ok', tools: 1, toolNames: [], ln: 2, ms: 300_000 }]
    }),
  })
  const threads = [thread(0, false), thread(1, false), thread(2, true), thread(3, true)]
  const scan = { threads, coverage: [], scannedAt: 0, scanMs: 1, filesParsed: 4, filesFromCache: 0, bytesParsed: 0, claudeStats: null, claudePlan: null, usage: { ...ledgerFromThreads(threads), subagentMs: { ...perSource(() => 0), 'claude-code': 7_200_000 } } }
  const w = buildReport(scan as any).report.deep.work
  assert.equal(w.agentHours, 0.5)
  assert.equal(w.agentHoursFloor, true)
  // timed: 30 minutes of work over 40 minutes between prompts; the rebuilt ones spent 40 too
  assert.equal(w.agentHoursEst, 0.5 + 0.75 * (40 / 60))
  assert.equal(w.subagentHours, 2)
})

test('classification is rule-based and explains itself', () => {
  const h = (text: string, afterInterrupt = false): HumanEvent => ({ k: 'h', t: 0, id: 'x', text, ln: 1, afterInterrupt })
  assert.equal(classifyHuman(h('build me a dashboard'), true).kind, 'ask')
  assert.equal(classifyHuman(h('no, that broke the build'), false).kind, 'steer')
  assert.equal(classifyHuman(h('this is way too complicated, simplify it'), false).kind, 'steer')
  assert.equal(classifyHuman(h('add a footer please'), true).kind, 'ask')
  assert.equal(classifyHuman(h('perfect, ship it'), false).kind, 'approve')
  assert.equal(classifyHuman(h('now add a footer'), false).kind, 'followup')
  assert.equal(classifyHuman(h('ok now do the same for the mobile layout'), false).kind, 'followup')
  assert.equal(classifyHuman(h('add a footer', true), false).kind, 'steer')
  assert.ok(classifyHuman(h('too complicated, simplify'), false).themes.includes('simplify'))
})

test('redaction removes secrets, contact details, paths, project names and the username', () => {
  const user = os.userInfo().username
  const redact = makeRedactor({ projectNames: ['aurelia'] })
  const counts: Record<string, number> = {}
  const out = redact(
    `key sk-proj-abcdefghijklmnopqrstuv and STRIPE_SECRET=sk_live_abcdefghij1234 mail me at a@b.co, see /Users/${user}/aurelia/src/app.tsx or https://aurelia.app/x, server 10.0.0.1, ${user} built Aurelia`,
    counts,
  )
  for (const leak of ['sk-proj', 'sk_live', 'a@b.co', '/Users/', 'https://', '10.0.0.1', 'aurelia', 'Aurelia']) assert.ok(!out.includes(leak), `leaked ${leak}: ${out}`)
  assert.ok(!new RegExp(`\\b${user}\\b`, 'i').test(out))
  assert.ok(out.includes('[path .tsx]'))
  assert.ok(counts.secret >= 2 && counts.email === 1 && counts.url === 1)
})

test('stats validation accepts only the exact allowlist', () => {
  const ok = {
    schema: 'lore.stats.v5',
    client: '0.1.0',
    sources: ['codex'],
    history_months: 8,
    threads: 73,
    prompts: 1840,
    active_days: 44,
    projects: 4,
    median_prompt_words: 27,
    steer_rate: 0.15,
    approval_rate: 0.05,
    interrupts_per_100: 4,
    night_share: 0.1,
    weekend_share: 0.2,
    model_share: { 'gpt-5.5': 0.6, other: 0.1 },
    steer_themes: { broken: 0.2 },
    steer_by_model: { 'gpt-5.5': 0.15 },
    intents: { fix: 0.2, build: 0.1 },
    archetype: 'editor',
    type_code: 'ESLC',
    agent_hours: 162.4,
    lines_added: 21950,
    high_effort_share: 0.3,
    swear_per_100_by_tool: { codex: 4 },
    api_usd: 2310,
    swear_per_100: 5.2,
    median_seconds_to_steer: 74,
    please_per_100: 12,
    thanks_per_100: 3,
    caps_per_100: 2,
    top_swear: 'fuck',
    twin: 'amodei',
    top_reply: 'continue',
    longest_session_hours: 3.5,
    streak_days: 19,
    tokens: 3_400_000_000,
    subagent_token_share: 0.25,
    agent_seconds_per_prompt: 138,
    actions_per_prompt: 7.3,
    cache_share: 0.95,
    tokens_per_prompt: 412_000,
    steers: 312,
    switches_after_steer: 2,
    interrupt_by_model: { 'gpt-5.5': 0.05 },
    test_run_share: 0.35,
    red_green_threads: 11,
    long_threads: 3,
    spec_prompt_share: 0.1,
    edit_langs: { typescript: 0.6, python: 0.15 },
    mcp_kinds: { browser: 1, database: 1 },
    os: 'darwin',
    first_run_month: '2026-10',
    lore_runs: 4,
    notice: 'n1',
  }
  assert.deepEqual(validateStats(ok), [])
  // repo stats ride along only as a whole, from fixed lists, with counts capped at 3
  const repo = {
    repos: 9,
    repos_tests: 5,
    repos_ci: 3,
    repos_container: 1,
    agent_md: 2,
    repo_frameworks: { next: 1, rails: 1 },
    repo_files: { '1k_9k': 3, '100_999': 2 },
    repo_age: { '1_3y': 3 },
    remote_hosts: { github: 3, none: 2 },
    license_families: { none: 3 },
    team_size: { solo: 3, '2_5': 1 },
    kept_rate: 0.25,
    revert_rate: 0,
  }
  assert.deepEqual(validateStats({ ...ok, ...repo }), [])
  assert.ok(validateStats({ ...ok, repos: 9 }).includes('missing repo_frameworks'))
  assert.ok(validateStats({ ...ok, ...repo, repo_frameworks: { '@acme/billing': 1 } }).includes('bad repo_frameworks.@acme/billing'))
  assert.ok(validateStats({ ...ok, ...repo, team_size: { solo: 40000 } }).includes('bad team_size.solo'), 'counts stay plausible')
  assert.ok(validateStats({ ...ok, prompts: 1840.5 }).includes('bad prompts'), 'counts are whole')
  assert.ok(validateStats({ ...ok, tokens: 1e16 }).includes('bad tokens'), 'nothing past a real ceiling')
  assert.ok(validateStats({ ...ok, mcp_kinds: { 'acme-internal-mcp': 1 } }).includes('bad mcp_kinds.acme-internal-mcp'))
  assert.ok(validateStats({ ...ok, edit_langs: { klingon: 0.5 } }).includes('bad edit_langs.klingon'))
  assert.ok(validateStats({ ...ok, notice: 'n1.x' }).includes('bad notice'), 'only the notice version, nothing more')
  // single words only from fixed lists: a private prompt or a slur can never ride along
  assert.ok(validateStats({ ...ok, top_reply: 'deploy aurelia to prod' }).includes('bad top_reply'))
  assert.ok(validateStats({ ...ok, top_swear: 'anything' }).includes('bad top_swear'))
  assert.ok(validateStats({ ...ok, twin: 'my boss' }).includes('bad twin'))
  assert.ok(validateStats({ ...ok, project: 'aurelia' }).includes('unexpected field project'))
  assert.ok(validateStats({ ...ok, steer_rate: 0.123 }).includes('bad steer_rate'), 'shares must be rounded to 5%')
  assert.ok(validateStats({ ...ok, steer_themes: { 'my secret project': 0.1 } }).length > 0)
  assert.ok(validateStats({ ...ok, type_code: 'aurelia' }).includes('bad type_code'))
  // a custom deployment's name can say anything, so only public model names leave
  assert.ok(validateStats({ ...ok, model_share: { 'acme-confidential-prod-employee-jane': 0.6 } }).includes('bad model_share.acme-confidential-prod-employee-jane'))
  assert.equal(publicModel('acme-confidential-prod-employee-jane'), 'other')
  assert.equal(publicModel('us.anthropic.claude-opus-4-5-20251101-v1:0'), 'claude-opus-4-5')
})

test('episodes: candidates come from steers, payloads are redacted and stay local', () => {
  const t: ThreadRecord = {
    id: 'T',
    source: 'codex',
    surface: 'cli',
    file: '/x',
    archived: false,
    cwd: '/Users/me/aurelia',
    project: 'aurelia',
    startedAt: 0,
    endedAt: 10,
    models: {},
    toolCalls: 3,
    interrupts: 1,
    slashCommands: 0,
    tokens: {},
    agentMs: 0,
    linesAdded: 0,
    linesRemoved: 0,
    efforts: {},
    planModeTurns: 0,
    warnings: [],
    events: [
      { k: 'h', t: 1, id: 'h1', text: 'add rate limiting to the aurelia api', ln: 1 },
      { k: 'a', t: 2, id: 'a1', text: 'Added a Redis-backed limiter in /Users/me/aurelia/src/limit.ts', tools: 2, toolNames: ['apply_patch'], ln: 2, model: 'gpt-x', edits: [['src/limit.ts', 40, 0]] },
      { k: 'h', t: 3, id: 'h2', text: "no, don't add redis, keep it in memory for now, way simpler", ln: 3, afterInterrupt: true },
      { k: 'a', t: 4, id: 'a2', text: 'Switched to an in-memory token bucket.', tools: 1, toolNames: ['apply_patch'], ln: 4, edits: [['src/limit.ts', 12, 38]] },
      { k: 'h', t: 5, id: 'h3', text: 'perfect', ln: 5 },
    ],
  }
  const { candidates, funnel } = findCandidates([classifyThread(t)])
  const c = candidates[0]
  assert.ok(c, 'expected a candidate')
  assert.equal(funnel.withCodePair, 1)
  assert.ok(c.attemptChange && c.revisedChange, 'code before and after the steer')
  assert.match(c.steer.text, /keep it in memory/)
  assert.equal(c.evidence.expressedApproval !== null, true)
  assert.equal(c.evidence.verifiedOutcome, null)
  const payload = toPayload(c, makeRedactor({ projectNames: ['aurelia'] }))
  assert.equal(payload.level, 'artifact_linked')
  assert.ok(!JSON.stringify(payload).toLowerCase().includes('aurelia'))
  assert.ok(!JSON.stringify(payload).includes('/Users/'))
})

test('tool inputs become edits and commands, including patches inside Codex exec code', async () => {
  const { codexTool, claudeTool } = await import('../src/sources/tools.ts')
  const js = 'const patch = "*** Begin Patch\\n*** Update File: /repo/a.ts\\n@@\\n-old\\n+new\\n+more\\n*** End Patch";\nawait tools.exec_command({"cmd":"npm test","workdir":"/repo"});'
  const e = codexTool('custom_tool_call', 'exec', { input: js }, '/repo')
  assert.deepEqual(e.edits, [['a.ts', 2, 1]])
  assert.deepEqual(e.cmds, ['npm test'])
  const shell = codexTool('function_call', 'shell', { arguments: JSON.stringify({ command: ['bash', '-lc', 'git status'] }) }, '/repo')
  assert.deepEqual(shell.cmds, ['git status'])
  const edit = claudeTool('Edit', { file_path: '/repo/b.ts', old_string: 'a\nb', new_string: 'c' }, '/repo')
  assert.deepEqual(edit.edits, [['b.ts', 1, 2]])
})

test('a full report from synthetic threads produces valid anonymous stats and a type', async () => {
  const { buildReport } = await import('../src/pipeline/facts.ts')
  const { buildStats } = await import('../src/pipeline/stats.ts')
  const mk = (i: number, project: string): ThreadRecord => ({
    id: `t${i}`, source: i % 2 ? 'codex' : 'claude-code', surface: 'cli', file: '/x', archived: false, cwd: `/p/${project}`, project,
    startedAt: Date.UTC(2026, 0, 1 + i), endedAt: Date.UTC(2026, 0, 1 + i, 1), models: { m: 2 }, toolCalls: 4, interrupts: 0, slashCommands: 0,
    tokens: { m: { in: 1000, cached: 500000, out: 900 } }, agentMs: 600_000, linesAdded: 10, linesRemoved: 2, efforts: { high: 2 }, planModeTurns: 0, warnings: [],
    events: [
      { k: 'h', t: Date.UTC(2026, 0, 1 + i, 0, 1), id: `h${i}a`, text: 'fix the broken login page please', ln: 1 },
      { k: 'a', t: Date.UTC(2026, 0, 1 + i, 0, 5), id: `a${i}a`, text: 'Fixed.', tools: 3, toolNames: [], model: 'm', ln: 2, ms: 240_000, edits: [['src/login.ts', 12, 3]], cmds: ['npm test'] },
      { k: 'h', t: Date.UTC(2026, 0, 1 + i, 0, 7), id: `h${i}b`, text: 'no, that broke the build, what the fuck', ln: 3 },
      { k: 'a', t: Date.UTC(2026, 0, 1 + i, 0, 9), id: `a${i}b`, text: 'Reverted and fixed properly.', tools: 2, toolNames: [], model: 'm', ln: 4, ms: 120_000, edits: [['src/login.ts', 4, 4]] },
    ],
  })
  const threads = Array.from({ length: 12 }, (_, i) => mk(i, ['alpha', 'beta', 'gamma'][i % 3]))
  const scan = { threads, coverage: [], scannedAt: 0, scanMs: 1, filesParsed: 12, filesFromCache: 0, bytesParsed: 0, claudeStats: null, claudePlan: null, usage: ledgerFromThreads(threads) }
  const { report } = buildReport(scan as any)
  assert.ok(report.archetype.name && /^[DE][SA][LN][FC]$/.test(report.archetype.code))
  assert.equal(report.deep.swear.words[0].word, 'fuck')
  assert.ok(report.deep.work.agentHours > 0 && report.deep.work.linesAdded === 12 * 16)
  assert.deepEqual(validateStats(buildStats(report)), [])
  // the privacy page prints a plain description of every field a run sends, repo stats included
  const { FIELD_DOCS } = await import('../src/pipeline/indexAgg.ts')
  const withRepos = {
    ...report,
    repoShape: { repos: 3, tests: 2, ci: 1, container: 0, agentMd: 1, frameworks: ['next'], files: { under_100: 1, '1k_9k': 2 }, age: { '1_3y': 3 }, hosts: { github: 3 }, licenses: { none: 3 }, team: { solo: 3 }, outcomes: { checked: 6, committed: 3, reverted: 1 } },
  }
  assert.deepEqual(validateStats(buildStats(withRepos)), [])
  const sent = Object.keys(buildStats(withRepos))
  assert.deepEqual(sent.filter((k) => !FIELD_DOCS[k]), [], 'fields sent without a description')
  assert.deepEqual(Object.keys(FIELD_DOCS).filter((k) => !sent.includes(k)), [], 'descriptions for fields no longer sent')
  // and the README's privacy table lists every one, since the audit prompt checks against it
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  assert.deepEqual(sent.filter((k) => !readme.includes(`| \`${k}\` |`)), [], 'fields sent but missing from the README')

  // since your last run: compared against the latest run at least a day old
  const { markOf, recordRun, sinceLast } = await import('../src/pipeline/since.ts')
  const now = markOf(report)
  const hourAgo = { ...now, at: report.generatedAt - 3_600_000 }
  assert.equal(sinceLast(report, [hourAgo]), null)
  const runs = recordRun(recordRun([], { ...now, at: report.generatedAt - 3 * 86_400_000, prompts: now.prompts - 5, projects: now.projects - 1, card: 'other', cardName: 'The Other' }), hourAgo)
  const since = sinceLast(report, runs)!
  assert.equal(since.prompts, 5)
  assert.equal(since.projects, 1)
  assert.deepEqual(since.card, { from: 'The Other', to: report.archetype.name })
  assert.equal(since.twin, null)
})

test('the report and the share cards date the year from the first prompt on record', async () => {
  const { buildReport } = await import('../src/pipeline/facts.ts')
  const { since, period } = await import('../web/src/format.ts')
  const day = (d: number) => new Date(2025, 6, 1 + d, 14).getTime()
  const threads: ThreadRecord[] = Array.from({ length: 12 }, (_, i) => ({
    id: `t${i}`, source: 'claude-code', surface: 'cli', file: '/x', archived: false, cwd: '/p/alpha', project: 'alpha',
    startedAt: day(i * 5), endedAt: day(i * 5) + 3_600_000, models: { m: 2 }, toolCalls: 2, interrupts: 0, slashCommands: 0,
    tokens: { m: { in: 1000, cached: 0, out: 900 } }, agentMs: 600_000, linesAdded: 1, linesRemoved: 0, efforts: {}, planModeTurns: 0, warnings: [],
    events: [
      { k: 'h', t: day(i * 5) + 60_000, id: `h${i}`, text: 'add a settings page', ln: 1 },
      { k: 'a', t: day(i * 5) + 300_000, id: `a${i}`, text: 'Done.', tools: 2, toolNames: [], model: 'm', ln: 2, ms: 240_000 },
    ],
  }))
  // Claude Code was first launched in June, but its prompts before July are gone
  const claudeFirstUse = new Date(2025, 5, 3, 9).getTime()
  const scan = { threads, coverage: [], scannedAt: 0, scanMs: 1, filesParsed: 12, filesFromCache: 0, bytesParsed: 0, claudeStats: null, claudePlan: null, claudeFirstUse, usage: ledgerFromThreads(threads) }
  const { report } = buildReport(scan as any)
  assert.equal(report.coverage.firstUse['claude-code'], claudeFirstUse)
  assert.deepEqual(report.coverage.gap && [report.coverage.gap.from, report.coverage.gap.to], [claudeFirstUse, report.coverage.recordFrom['claude-code']])
  assert.equal(since(report), 'Jul ’25')
  assert.equal(period(report), 'Jul ’25 — Aug ’25')
})

test('episode value: a code pair that was committed and approved outranks a bare redirect', async () => {
  const { valueEpisode } = await import('../src/pipeline/value.ts')
  const base: any = {
    steer: { text: "no, don't add redis, keep it in memory for now, way simpler", afterInterrupt: true, themes: [], rule: 'contains a correction phrase' },
    context: [{ role: 'human', text: 'add rate limiting' }],
    evidence: { expressedApproval: 'Next message: “perfect”' },
    attemptChange: { files: [['a.ts', 10, 0]], diff: '' },
    revisedChange: { files: [['a.ts', 3, 9]], diff: '' },
    git: { committed: true, minutesAfter: 4, reverted: false, laterChanges14d: 1 },
  }
  const strong = valueEpisode(base)
  const bare = valueEpisode({ ...base, attemptChange: null, revisedChange: null, git: null, evidence: { expressedApproval: null }, steer: { ...base.steer, text: 'no', afterInterrupt: false } })
  assert.equal(strong.tier, 'Gold')
  assert.ok(strong.usd > bare.usd && bare.tier === 'Trace')
  assert.ok(strong.signals.some((s) => s.label.includes('committed')))
})

test('the lore finds origins, quiet spells and habits with real quotes', async () => {
  const { buildLore } = await import('../src/pipeline/lore.ts')
  const { classifyThread } = await import('../src/pipeline/classify.ts')
  const day = (d: number, h = 14) => new Date(2026, 0, d, h).getTime()
  const t: ThreadRecord = {
    id: 'x', source: 'codex', surface: 'cli', file: '/x', archived: false, cwd: '/p/alpha', project: 'alpha', startedAt: day(1), endedAt: day(20), models: {}, toolCalls: 0, interrupts: 0, slashCommands: 0,
    tokens: {}, agentMs: 0, linesAdded: 0, linesRemoved: 0, efforts: {}, planModeTurns: 0, warnings: [],
    events: [
      { k: 'h', t: day(1), id: '1', text: 'build me a tiny habit tracker please', ln: 1 },
      ...Array.from({ length: 10 }, (_, i) => ({ k: 'h' as const, t: day(2, 9 + i), id: `c${i}`, text: 'continue', ln: 2 + i })),
      { k: 'h', t: day(20, 3), id: 'late', text: 'ok one more thing before i sleep, fix the streak bug', ln: 30 },
    ],
  }
  const { lore } = buildLore({ deep: { work: { topFiles: [], longestTurn: null } } } as any, [classifyThread(t)])
  const keys = lore.map((e) => e.key)
  assert.ok(keys.includes('origin-alpha') && keys.includes('quiet') && keys.includes('repeat') && keys.includes('latest'))
  assert.match(lore.find((e) => e.key === 'repeat')!.title, /continue/)
})

test('deleted Claude sessions come back from prompt history, without double-counting surviving ones', async () => {
  const t0 = Date.parse('2026-01-05T15:00:00Z')
  const { file } = write('claude-home/history.jsonl', [
    { display: 'build the onboarding flow', timestamp: t0, project: '/Users/me/app', sessionId: 'gone-1' },
    { display: 'no, revert that and keep the old modal', timestamp: t0 + 60_000, project: '/Users/me/app', sessionId: 'gone-1' },
    { display: '/clear', timestamp: t0 + 90_000, project: '/Users/me/app', sessionId: 'gone-1' },
    { display: 'already counted', timestamp: t0 + 120_000, project: '/Users/me/app', sessionId: 'on-disk' },
    { display: 'no session id here', timestamp: t0 + 180_000, project: '/Users/me/other' },
  ])
  const rec = await recoverClaudeHistory(new Set(['on-disk']), new Set(), file)
  assert.equal(rec.onDisk, 1)
  assert.equal(rec.prompts, 3)
  const gone = rec.threads.find((t) => t.id === 'gone-1')!
  assert.equal(gone.project, 'app')
  assert.equal(gone.recovered, true)
  assert.equal(gone.slashCommands, 1)
  assert.deepEqual(
    gone.events.map((e) => e.ln),
    [1, 2],
  )
  // the agent replies are gone, but every prompt after the first still followed one
  const kinds = classifyThread(gone).humans.map((h) => h.c.kind)
  assert.deepEqual(kinds, ['ask', 'steer'])
})

test('API-equivalent cost prices cache writes, maps dated snapshots, and refuses unknown models', () => {
  const t = { in: 1_000_000, cached: 10_000_000, out: 100_000, write: 400_000 }
  // opus 5.5: $4 in, $20 out, $0.20 cache read, $5 cache write per million
  assert.equal(costOf('claude-opus-5-5', t)!.toFixed(2), (0.6 * 4 + 0.4 * 5 + 10 * 0.2 + 0.1 * 20).toFixed(2))
  assert.equal(costOf('claude-haiku-4-5-20251001', { in: 1e6, cached: 0, out: 0, write: 0 }), 1)
  assert.equal(costOf('codex-auto-review', t), null)
  // writes cached for an hour cost twice the input price, not the five-minute write price
  assert.equal(costOf('claude-opus-5-5', { ...t, write1h: 100_000 })!.toFixed(2), (0.6 * 4 + 0.3 * 5 + 0.1 * 8 + 10 * 0.2 + 0.1 * 20).toFixed(2))
  // OpenAI has no write premium, so an hour-long write is just input
  assert.equal(costOf('gpt-5.5', { in: 1e6, cached: 0, out: 0, write: 1e6, write1h: 1e6 }), costOf('gpt-5.5', { in: 1e6, cached: 0, out: 0, write: 0 }))
})

test('the pay estimate is a loose range from conversations a test could check, and nothing without them', async () => {
  const { payEstimate } = await import('../src/pipeline/payout.ts')
  assert.equal(payEstimate(0), null)
  // 48 candidates: 20% accepted at $200 with half to you, up to 40% at $2,000
  assert.deepEqual(payEstimate(48), { tasks: 48, low: 960, high: 19_000 })
})

test('rank comes from a published distribution, never from thin air', () => {
  const dist = { '0-99': 10, '100-499': 10, '500-999': 5 }
  // the bottom of the 100-499 step: 10 runs below, so 60% at or above
  assert.equal(topShare(100, dist)!.toFixed(2), '0.60')
  // halfway through the top step, on the log scale the steps grow on (√(500·1000) ≈ 707)
  assert.equal(topShare(707, dist)!.toFixed(2), '0.10')
  assert.equal(topShare(5000, dist), null)
  assert.equal(topShare(50, {}), null)
  // a step merged for privacy still places a run inside it
  assert.equal(topShare(3162, { '0-999': 30, '1000-9999': 30 })!.toFixed(2), '0.25')
  // the step from 0 reads linearly
  assert.equal(topShare(50, dist)!.toFixed(2), '0.80')
  // with few runs in, one step spans decades; a typical run lands mid-step, not near the bottom
  // (read linearly, 10,000 in 2000-49999 came out as "top 83%")
  assert.equal(topShare(10_000, { '2000-49999': 30 })!.toFixed(2), '0.50')
})

test('the index from counters matches the index from rows: exact counts, percentiles within a bin', async () => {
  const { aggregate, aggregateCounts, countRow, FIELDS } = await import('../src/pipeline/indexAgg.ts')
  let seed = 3
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
  const rows = Array.from({ length: 300 }, () => {
    const r: any = {}
    for (const f of FIELDS.shares) r[f] = Math.round(rnd() * 20) / 20
    for (const f of Object.keys(FIELDS.ints)) r[f] = Math.floor(rnd() * 30)
    for (const f of FIELDS.numbers) r[f] = rnd() < 0.05 ? 0 : Math.round(10 ** (rnd() * 6))
    r.archetype = pick(['volcano', 'monk', 'editor', 'sniper'])
    r.os = pick(['darwin', 'linux', 'windows'])
    r.model_share = { 'gpt-5.5': Math.round(rnd() * 20) / 20, other: 0.1 }
    r.repo_files = { under_100: 1 + Math.floor(rnd() * 3) }
    return r
  })
  const c = new Map<string, number>()
  for (const r of rows) countRow(c, r)
  const a = aggregate(rows, 25)
  const b = aggregateCounts(c, 25)
  assert.equal(b.runs, 300)
  assert.deepEqual(b.dist, a.dist)
  for (const f of FIELDS.numbers) assert.ok(Math.abs(b.totals[f] - a.totals[f]) < 0.5, `total ${f}`)
  for (const f of [...FIELDS.shares, ...Object.keys(FIELDS.ints)]) assert.equal(b.median[f], a.median[f], `median ${f}`)
  const byKey = (xs: { key: string }[]) => [...xs].sort((x, y) => x.key.localeCompare(y.key))
  assert.deepEqual(byKey(b.enums.archetype), byKey(a.enums.archetype))
  assert.deepEqual(byKey(b.maps.model_share), byKey(a.maps.model_share))
  assert.deepEqual(byKey(b.maps.repo_files), byKey(a.maps.repo_files))
  // numbers: a percentile lands in the right ~10% bin
  for (const f of ['prompts', 'tokens', 'agent_hours']) {
    const [exact, est] = [a.quantiles[f], b.quantiles[f]]
    exact.forEach((x, i) => assert.ok(x === 0 ? est[i] === 0 : Math.abs(est[i] / x - 1) < 0.12, `${f} p${i}: ${est[i]} vs ${x}`))
  }
})

test('the index never publishes a bucket thinner than K runs: thin ones join a neighbor', async () => {
  const { aggregate, mergeThin } = await import('../src/pipeline/indexAgg.ts')
  // 24 common runs and one rare one: the rare bucket must not stand alone
  assert.deepEqual(mergeThin({ '0-99': 24, '5000-9999': 1 }, 25), { '0-9999': 25 })
  assert.deepEqual(mergeThin({ '0-99': 30, '100-499': 3, '500-999': 26, '1000+': 2 }, 25), { '0-99': 30, '100+': 31 })
  const rows = Array.from({ length: 25 }, (_, i) => ({ prompts: i === 0 ? 31_000 : 1200 + i }))
  const agg = aggregate(rows, 25)
  assert.ok(Object.values(agg.dist.prompts).every((n) => n >= 25))
})

test('a number fewer than K runs send (repo stats are opt-in) gets no distribution, from rows or counters', async () => {
  const { aggregate, aggregateCounts, countRow } = await import('../src/pipeline/indexAgg.ts')
  // 30 runs publish, but only 3 of them turned repo stats on
  const rows = Array.from({ length: 30 }, (_, i) => ({ prompts: 1000 + i, ...(i < 3 ? { repos: 4 + i } : {}) }))
  const c = new Map<string, number>()
  for (const r of rows) countRow(c, r)
  for (const agg of [aggregate(rows, 25), aggregateCounts(c, 25)]) {
    assert.deepEqual(agg.dist.prompts, { '1000-1999': 30 })
    assert.equal(agg.dist.repos, undefined)
    assert.equal(agg.median.repos, undefined)
    assert.equal(agg.totals.repos, undefined)
  }
})

test('keeping a year of Claude history keeps every other setting and never clobbers a broken file', () => {
  const dir = path.join(tmp, 'claude-settings')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ theme: 'dark', permissions: { allow: ['Bash(ls)'] } }))
  keepClaudeHistory(365, dir)
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))
  assert.deepEqual(after, { theme: 'dark', permissions: { allow: ['Bash(ls)'] }, cleanupPeriodDays: 365 })
  fs.writeFileSync(path.join(dir, 'settings.json'), '{ not json')
  assert.throws(() => keepClaudeHistory(365, dir), /left it alone/)
  assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), '{ not json')
})

test('cards move with the data: each extreme deals its own card, and no card dominates a varied crowd', () => {
  const typical: Metrics = { control: 0.1, briefing: 20, clock: 0.5, range: 3, stamina: 12, temper: 1.5, leash: 1.5 }
  const top = (m: Partial<Metrics>) => deal(spectraOf({ ...typical, ...m }))[0].def.key
  assert.equal(top({ control: 0.4 }), 'editor')
  assert.equal(top({ control: 0.01 }), 'delegator')
  assert.equal(top({ briefing: 150 }), 'architect')
  assert.equal(top({ briefing: 4 }), 'sniper')
  assert.equal(top({ clock: 0.9 }), 'night')
  assert.equal(top({ range: 12 }), 'conductor')
  assert.equal(top({ range: 1 }), 'loyalist')
  assert.equal(top({ stamina: 120 }), 'marathoner')
  assert.equal(top({ stamina: 2 }), 'sprinter')
  assert.equal(top({ temper: 20 }), 'volcano')
  assert.equal(top({ leash: 30 }), 'foreman')
  assert.equal(top({ leash: 0.1 }), 'pair')
  // a little swearing doesn't make a volcano when something else stands out more
  assert.equal(top({ temper: 3, range: 8 }), 'conductor')

  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd())
  const draw = (k: string) => {
    const c = CALIBRATION[k]
    const sd = Math.log((c.p90 + c.offset) / (c.typical + c.offset)) / 1.2816
    return Math.max(0, (c.typical + c.offset) * Math.exp(sd * gauss()) - c.offset)
  }
  const counts: Record<string, number> = {}
  const N = 3000
  for (let i = 0; i < N; i++) {
    const m: Metrics = { control: Math.min(1, draw('control')), briefing: draw('briefing'), clock: 1 / (1 + Math.exp(-(Math.log(0.3 / 0.7) + 0.9 * gauss()))), range: Math.max(1, draw('range')), stamina: Math.max(1, draw('stamina')), temper: rnd() < 0.3 ? 0 : draw('temper'), leash: draw('leash') }
    const k = deal(spectraOf(m))[0].def.key
    counts[k] = (counts[k] || 0) + 1
  }
  assert.equal(Object.keys(counts).length, 14)
  for (const [k, v] of Object.entries(counts)) assert.ok(v / N > 0.025 && v / N < 0.13, `${k} dealt to ${((v / N) * 100).toFixed(1)}%`)
})

test('the builder you work most like follows your traits, and every one of them is someone’s match', () => {
  const typical: Metrics = { control: 0.1, briefing: 20, clock: 0.3, range: 3, stamina: 12, temper: 1.5, leash: 1.5 }
  const like = (m: Partial<Metrics>) => twinOf(spectraOf({ ...typical, ...m })).key
  assert.equal(like({ control: 0.01, leash: 6, briefing: 8 }), 'karpathy')
  assert.equal(like({ briefing: 120, leash: 6, clock: 0.05 }), 'bezos')
  assert.equal(like({ range: 12, stamina: 3, briefing: 6, clock: 0.5 }), 'musk')
  assert.equal(like({ briefing: 120, leash: 6, range: 1 }), 'amodei')
  assert.equal(like({ range: 10, leash: 6, clock: 0.08, temper: 0 }), 'altman')
  assert.equal(like({ stamina: 40, temper: 8 }), 'ellison')
  assert.equal(like({ temper: 10, range: 1, briefing: 60 }), 'karp')
  assert.equal(like({ control: 0.35, range: 1, temper: 10, stamina: 30 }), 'torvalds')
  let seed = 11
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd())
  const draw = (k: string) => {
    const c = CALIBRATION[k]
    const sd = Math.log((c.p90 + c.offset) / (c.typical + c.offset)) / 1.2816
    return Math.max(0, (c.typical + c.offset) * Math.exp(sd * gauss()) - c.offset)
  }
  const counts: Record<string, number> = {}
  const N = 3000
  for (let i = 0; i < N; i++) {
    const m: Metrics = { control: Math.min(1, draw('control')), briefing: draw('briefing'), clock: 1 / (1 + Math.exp(-(Math.log(0.3 / 0.7) + 0.9 * gauss()))), range: Math.max(1, draw('range')), stamina: Math.max(1, draw('stamina')), temper: rnd() < 0.3 ? 0 : draw('temper'), leash: draw('leash') }
    const k = twinOf(spectraOf(m)).key
    counts[k] = (counts[k] || 0) + 1
  }
  assert.equal(Object.keys(counts).length, TWINS.length)
  for (const [k, v] of Object.entries(counts)) assert.ok(v / N > 0.01 && v / N < 0.15, `${k} matched ${((v / N) * 100).toFixed(1)}%`)
})

test('spend counts each reply once and scales Claude’s own stats down for days its transcripts are gone', () => {
  const row = (day: string, n: number) => ({ source: 'claude-code' as const, model: 'claude-x', day, in: n * 0.1, cached: n * 0.8, out: n * 0.1, write: 0, write1h: 0, calls: 1 })
  const ledger = {
    rows: [row('2026-09-10', 1e9)],
    // Claude Code's own count of those same replies: twice as much
    claudeRaw: { '2026-09-10': { 'claude-x': 2e9 } },
    claudeOnDiskFrom: Date.parse('2026-09-09T12:00:00'),
    subagentTokens: perSource(() => 0),
    subagentMs: perSource(() => 0),
  }
  const stats = {
    since: '2026-01-05T00:00:00Z', totalSessions: 1, totalMessages: 1, daily: {}, lastComputed: '2026-09-10', retentionDays: 30, retentionConfigured: false,
    dailyTokens: { '2026-09-01': { 'claude-x': 4e8 }, '2026-09-10': { 'claude-x': 2e9 } },
    tokensByModel: { 'claude-x': { in: 6e8, cached: 4.8e9, out: 6e8, write: 0 } },
  }
  const sp = buildSpend([], stats, [], ledger)
  // exact 1e9, Sep 1 estimated at 2e8, and the 3.6e9 before daily counts at 1.8e9
  assert.equal(sp.tokens, 3e9)
  assert.equal(sp.estTokens, 2e9)
  assert.deepEqual(sp.claudeCounter, { counted: 6e9, processed: 3e9 })
  assert.equal(sp.claudeExactFrom, '2026-09-10')
})

test('paths from any OS: one spelling, the right project, nothing leaks into display', async () => {
  const { normPath, tidyPath, relativeTo } = await import('../src/util/text.ts')
  const { projectFromCwd } = await import('../src/util/project.ts')
  const { patchStats } = await import('../src/sources/tools.ts')
  const cases: [string, string][] = [
    ['/Users/me/code/app', 'app'],
    ['\\\\?\\C:\\Users\\Zoë Ö\\OneDrive - Corp\\Documents\\shop', 'shop'],
    ['c:/Users/ana/code/shop', 'shop'],
    ['C:\\Users\\ana', '~'],
    ['/c/Users/ana/code/shop', 'shop'],
    ['/mnt/c/Users/ana/code/shop', 'shop'],
    ['\\\\wsl.localhost\\Ubuntu\\home\\sam\\proj', 'proj'],
    ['/home/sam', '~'],
    ['/Users/me/.codex/worktrees/a1b2/lore', 'lore'],
    ['/Users/me/lore/.claude/worktrees/feature-x', 'lore'],
    ['/Users/me/Documents/Codex/2026-05-21/fix-thing', 'scratch'],
    ['C:\\Users\\ana\\AppData\\Local\\Temp\\tmp123', 'scratch'],
    ['/private/var/folders/x/T/abc', 'scratch'],
  ]
  for (const [cwd, want] of cases) assert.equal(projectFromCwd(cwd), want, cwd)
  assert.equal(normPath('\\\\?\\C:\\Repos\\x'), 'c:/Repos/x')
  assert.equal(tidyPath('C:\\Users\\ana\\code\\a.ts'), '~/code/a.ts')
  assert.equal(relativeTo('c:/Repos/x/src/a.ts', 'C:\\Repos\\x'), 'src/a.ts')
  assert.equal(relativeTo('/Users/me/A/b.ts', '/Users/me/a'), null, 'POSIX paths stay case-sensitive')
  // a patch written on Windows, CRLF line endings
  assert.deepEqual(patchStats('*** Begin Patch\r\n*** Update File: C:\\Repos\\x\\src\\a.ts\r\n@@\r\n-a\r\n+b\r\n+c\r\n*** End Patch', 'C:\\Repos\\x'), [['src/a.ts', 2, 1]])
})

test('finding history: env lists, XDG, WSL distros from Windows, Windows profiles from WSL', async () => {
  const { discoverRoots, parseWslList } = await import('../src/sources/roots.ts')
  const { openCommand } = await import('../src/util/platform.ts')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-home-'))
  const mk = (...p: string[]) => fs.mkdirSync(path.join(...p), { recursive: true })
  mk(home, '.claude', 'projects')
  mk(home, '.config', 'claude', 'projects')
  mk(home, 'alt-codex', 'sessions')
  mk(home, 'distro', 'home', 'sam', '.claude', 'projects')
  mk(home, 'distro', 'home', 'sam', '.codex', 'sessions')
  const roots = discoverRoots({
    env: { CODEX_HOME: path.join(home, 'alt-codex') },
    home,
    platform: 'win32',
    wsl: false,
    wslHomes: () => [{ dir: path.join(home, 'distro', 'home', 'sam'), where: 'WSL Ubuntu' }],
  })
  assert.deepEqual(roots.claude.map((r) => [path.relative(home, r.dir), r.where]), [['.claude', ''], [path.join('.config', 'claude'), ''], [path.join('distro', 'home', 'sam', '.claude'), 'WSL Ubuntu']])
  assert.deepEqual(roots.codex.map((r) => path.relative(home, r.dir)), ['alt-codex', path.join('distro', 'home', 'sam', '.codex')])
  assert.equal(discoverRoots({ env: {}, home, platform: 'win32', wsl: false, noWsl: true, wslHomes: () => [{ dir: path.join(home, 'distro', 'home', 'sam'), where: 'WSL Ubuntu' }] }).claude.length, 2, '--no-wsl skips distros')
  // wsl.exe -l -q: UTF-16 with a BOM on older WSL, Docker's distros dropped
  assert.deepEqual(parseWslList('\uFEFFU\0b\0u\0n\0t\0u\0\r\0\n\0d\0o\0c\0k\0e\0r\0-\0d\0e\0s\0k\0t\0o\0p\0\r\0\n\0'), ['Ubuntu'])
  // opening the report never needs a shell, and gives up quietly where there's no browser
  const url = 'http://127.0.0.1:4747/'
  assert.equal(openCommand(url, { platform: 'win32', env: {}, wsl: false })?.cmd, 'rundll32.exe')
  assert.equal(openCommand(url, { platform: 'linux', env: {}, wsl: false }), null)
  assert.equal(openCommand(url, { platform: 'darwin', env: { SSH_CONNECTION: '1 2 3 4' }, wsl: false }), null)
  assert.match(openCommand(url, { platform: 'linux', env: {}, wsl: true })!.cmd, /cmd\.exe$/)
})

test('Gemini CLI: old and new chat files, re-appended messages folded, the folder found from its hash', async () => {
  const { parseGeminiFile, folderFor } = await import('../src/sources/gemini.ts')
  const crypto = await import('node:crypto')
  const project = '/Users/test/code/shop'
  const hash = crypto.createHash('sha256').update(project).digest('hex')
  const tok = { input: 1000, output: 50, cached: 600, thoughts: 20, tool: 0, total: 1070 }
  // older builds: one JSON file, rewritten whole
  const json = path.join(tmp, 'gemini', hash, 'chats', 'session-2025-11-28T08-34-aaaa.json')
  fs.mkdirSync(path.dirname(json), { recursive: true })
  fs.writeFileSync(
    json,
    JSON.stringify({
      sessionId: 'G1',
      projectHash: hash,
      startTime: '2025-11-28T08:34:00Z',
      lastUpdated: '2025-11-28T09:00:00Z',
      messages: [
        { id: 'u1', timestamp: '2025-11-28T08:34:10Z', type: 'user', content: 'fix the cart total' },
        { id: 'a1', timestamp: '2025-11-28T08:35:00Z', type: 'gemini', content: 'Fixed.', model: 'gemini-2.5-pro', tokens: tok, toolCalls: [{ name: 'replace', args: { file_path: path.join(project, 'src', 'cart.ts'), old_string: 'a', new_string: 'b\nc' } }] },
        { id: 'u2', timestamp: '2025-11-28T08:40:00Z', type: 'user', content: 'no, that broke checkout' },
      ],
    }),
  )
  const st = fs.statSync(json)
  const o = (await parseGeminiFile({ file: json, size: st.size, mtimeMs: st.mtimeMs, archived: false, subagentByPath: false })) as any
  assert.equal(o.kind, 'thread')
  assert.equal(o.thread.project, 'shop', 'the folder comes from hashing the parents of touched files')
  assert.deepEqual(o.thread.events.filter((e: any) => e.k === 'h').map((e: any) => e.text), ['fix the cart total', 'no, that broke checkout'])
  const { readTurnDiff } = await import('../src/pipeline/diffs.ts')
  assert.match(await readTurnDiff(o.thread, o.thread.events.find((e: any) => e.k === 'a')), /\*\*\* Update File: src\/cart\.ts/)
  assert.deepEqual(o.usage.rows.map((r: any[]) => [r[1], r[3], r[4], r[5]]), [['gemini-2.5-pro', 400, 600, 70]], 'input includes cached; thoughts bill as output')
  // newer builds: JSONL where a message is appended again when its tokens land, plus $patch edits
  const jsonl = path.join(tmp, 'gemini', hash, 'chats', 'session-2026-10-02T10-00-bbbb.jsonl')
  fs.writeFileSync(
    jsonl,
    [
      { sessionId: 'G2', projectHash: hash, startTime: '2026-10-02T10:00:00Z', lastUpdated: '2026-10-02T10:10:00Z', kind: 'main' },
      { id: 'u1', timestamp: '2026-10-02T10:00:10Z', type: 'user', content: 'add a dark mode' },
      { id: 'a1', timestamp: '2026-10-02T10:01:00Z', type: 'gemini', content: 'Working on it', model: 'gemini-3.5-flash' },
      { id: 'a1', timestamp: '2026-10-02T10:01:00Z', type: 'gemini', content: 'Working on it', model: 'gemini-3.5-flash', tokens: tok },
      { $patch: { id: 'a1', updates: { content: 'Done: dark mode added.' } } },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n') + '\n',
  )
  const st2 = fs.statSync(jsonl)
  const o2 = (await parseGeminiFile({ file: jsonl, size: st2.size, mtimeMs: st2.mtimeMs, archived: false, subagentByPath: false })) as any
  assert.equal(o2.usage.rows.length, 1, 'a re-appended message counts once')
  assert.equal(o2.thread.events.find((e: any) => e.k === 'a').text, 'Done: dark mode added.')
  assert.equal(folderFor(hash, ['/somewhere/else.ts']), '')
})

test('Pi and OpenClaw: one entry format, exact usage, forks counted once, chat wrapping and heartbeats dropped', async () => {
  const { parsePiFile, parseOpenClawFile, openclawText } = await import('../src/sources/pi.ts')
  const usage = { input: 40, output: 300, cacheRead: 9000, cacheWrite: 500, totalTokens: 9840, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
  const entries = [
    { type: 'session', version: 3, id: 'P1', timestamp: '2026-09-01T10:00:00Z', cwd: '/Users/test/code/blog' },
    { type: 'model_change', id: 'm1', parentId: null, timestamp: '2026-09-01T10:00:00Z', provider: 'anthropic', modelId: 'claude-sonnet-4-5' },
    { type: 'message', id: 'u1', parentId: 'm1', timestamp: '2026-09-01T10:00:05Z', message: { role: 'user', content: [{ type: 'text', text: 'add an rss feed' }], timestamp: 1788256805000 } },
    {
      type: 'message', id: 'a1', parentId: 'u1', timestamp: '2026-09-01T10:00:30Z',
      message: { role: 'assistant', provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', usage, stopReason: 'toolUse', timestamp: 1788256830000, content: [{ type: 'text', text: 'Adding it.' }, { type: 'toolCall', id: 't1', name: 'edit', arguments: { path: '/Users/test/code/blog/src/feed.ts', edits: [{ oldText: 'a', newText: 'b\nc\nd' }] } }] },
    },
    { type: 'message', id: 'r1', parentId: 'a1', timestamp: '2026-09-01T10:00:31Z', message: { role: 'toolResult', toolCallId: 't1', toolName: 'edit', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: 1788256831000 } },
    { type: 'message', id: 'u2', parentId: 'r1', timestamp: '2026-09-01T10:01:00Z', message: { role: 'user', content: 'no, use atom not rss', timestamp: 1788256860000 } },
  ]
  const o = (await parsePiFile(write('pi/--Users-test-code-blog--/2026-09-01T10-00-00_P1.jsonl', entries))) as any
  assert.equal(o.kind, 'thread')
  assert.equal(o.thread.project, 'blog')
  assert.deepEqual(o.thread.events.filter((e: any) => e.k === 'h').map((e: any) => e.text), ['add an rss feed', 'no, use atom not rss'])
  assert.deepEqual(o.usage.rows.map((r: any[]) => [r[1], r[3], r[4], r[5], r[6]]), [['claude-sonnet-4-5', 540, 9000, 300, 500]], 'cache writes join uncached input; model ids lose their date')
  assert.equal(o.thread.linesAdded, 3)
  const { readTurnDiff } = await import('../src/pipeline/diffs.ts')
  assert.match(await readTurnDiff(o.thread, o.thread.events.find((e: any) => e.k === 'a')), /\*\*\* Update File: src\/feed\.ts\n@@\n-a\n\+b\n\+c\n\+d/, 'an episode re-reads the edit')
  // a fork copies the parent's entries into a new file: same keys, so the scan counts them once
  const fork = (await parsePiFile(write('pi/--Users-test-code-blog--/2026-09-02T09-00-00_P2.jsonl', [{ ...entries[0], id: 'P2', parentSession: 'P1' }, ...entries.slice(1)]))) as any
  assert.equal(fork.usage.rows[0][0], o.usage.rows[0][0])
  assert.equal(fork.thread.events[0].id, o.thread.events[0].id)

  // OpenClaw: what the person sent, without the channel envelope; its own prompts aren't anyone's
  assert.equal(openclawText('[Telegram Ada (@ada) id:42 +5m 2026-01-02 10:00 PST] book the flight\n[message_id: 7]'), 'book the flight')
  assert.equal(openclawText('[Telegram Ada (@ada) id:42 2026-01-02 10:00 PST] Ada (@ada): and the hotel'), 'and the hotel')
  assert.equal(openclawText('Read HEARTBEAT.md if it exists (workspace context). Follow it strictly.'), null)
  assert.equal(openclawText('[Queued messages while agent was busy]\n\n---\nQueued #1\n[Telegram Ada (@ada) id:42 2026-01-02 10:00 PST] first\n[message_id: 8]\n---\nQueued #2\n[Telegram Ada (@ada) id:42 2026-01-02 10:01 PST] second\n[message_id: 9]'), 'first\nsecond')
  const claw = [
    { type: 'session', version: 3, id: 'C1', timestamp: '2026-01-02T18:00:00Z', cwd: '/Users/test/clawd' },
    { type: 'message', id: 'h1', parentId: null, timestamp: '2026-01-02T18:00:00Z', message: { role: 'user', content: [{ type: 'text', text: 'Read HEARTBEAT.md if it exists (workspace context).' }] } },
    { type: 'message', id: 'u1', parentId: 'h1', timestamp: '2026-01-02T18:01:00Z', message: { role: 'user', content: [{ type: 'text', text: '[Telegram Ada (@ada) id:42 +1m 2026-01-02 10:01 PST] summarize my inbox\n[message_id: 10]' }] } },
    { type: 'message', id: 'a1', parentId: 'u1', timestamp: '2026-01-02T18:01:30Z', message: { role: 'assistant', provider: 'anthropic', model: 'claude-opus-4-5', usage, content: [{ type: 'text', text: 'Three new emails.' }] } },
    { type: 'message', id: 'd1', parentId: 'a1', timestamp: '2026-01-02T18:01:31Z', message: { role: 'assistant', provider: 'clawdbot', model: 'delivery-mirror', usage: { ...usage, totalTokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, content: [{ type: 'text', text: 'Three new emails.' }] } },
  ]
  const c = (await parseOpenClawFile(write('claw/agents/main/sessions/C1.jsonl', claw))) as any
  assert.equal(c.thread.surface, 'chat')
  assert.deepEqual(c.thread.events.filter((e: any) => e.k === 'h').map((e: any) => e.text), ['summarize my inbox'])
  assert.deepEqual(Object.keys(c.thread.models), ['claude-opus-4-5'], 'a delivery mirror is not a model')

  // 2026.8.1+: the same entries in a per-agent SQLite store
  const { DatabaseSync } = await import('node:sqlite')
  const dbFile = path.join(tmp, 'claw2', 'agents', 'main', 'agent', 'openclaw-agent.sqlite')
  fs.mkdirSync(path.dirname(dbFile), { recursive: true })
  const db = new DatabaseSync(dbFile)
  db.exec('CREATE TABLE transcript_events (session_id TEXT NOT NULL, seq INTEGER NOT NULL, event_json TEXT, created_at INTEGER NOT NULL, event_zstd BLOB, PRIMARY KEY (session_id, seq))')
  const ins = db.prepare('INSERT INTO transcript_events (session_id, seq, event_json, created_at) VALUES (?, ?, ?, 0)')
  claw.forEach((e, i) => ins.run('C1', i, JSON.stringify(e)))
  db.close()
  const st = fs.statSync(dbFile)
  const s = (await parseOpenClawFile({ file: dbFile, size: st.size, mtimeMs: st.mtimeMs, archived: false, subagentByPath: false })) as any
  assert.equal(s.kind, 'threads')
  assert.deepEqual(s.threads[0].events.filter((e: any) => e.k === 'h').map((e: any) => e.text), ['summarize my inbox'])
  assert.equal(s.usage.rows[0][0], c.usage.rows[0][0], 'a session imported into the store counts once with its JSONL copy')
})

test('OpenCode and Kilo: the database and the pre-1.2 file tree, each reply once, child sessions as subagents', async () => {
  const { parseOpenCodeFile, discoverOpenCode } = await import('../src/sources/opencode.ts')
  const { DatabaseSync } = await import('node:sqlite')
  const dir = path.join(tmp, 'opencode-data')
  fs.mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(path.join(dir, 'opencode.db'))
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, slug TEXT, directory TEXT, title TEXT, version TEXT, time_created INTEGER, time_updated INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);`)
  const t0 = Date.UTC(2026, 8, 3, 9)
  const tokens = { input: 120, output: 400, reasoning: 100, cache: { read: 20000, write: 3000 } }
  db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('ses_1', 'p', null, 's', '/Users/test/code/api', 'Fix auth', '1.3.0', t0, t0)
  db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('ses_2', 'p', 'ses_1', 's', '/Users/test/code/api', 'subtask', '1.3.0', t0, t0)
  const msg = db.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)')
  const part = db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)')
  msg.run('msg_1', 'ses_1', t0, t0, JSON.stringify({ role: 'user', time: { created: t0 }, agent: 'build', model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' } }))
  part.run('prt_1', 'msg_1', 'ses_1', t0, t0, JSON.stringify({ type: 'text', text: 'the login token expires too early' }))
  part.run('prt_2', 'msg_1', 'ses_1', t0, t0, JSON.stringify({ type: 'text', text: 'Called the Read tool with: src/auth.ts', synthetic: true }))
  msg.run('msg_2', 'ses_1', t0 + 1000, t0, JSON.stringify({ role: 'assistant', time: { created: t0 + 1000, completed: t0 + 61000 }, modelID: 'claude-sonnet-4-5', providerID: 'anthropic', path: { cwd: '/Users/test/code/api', root: '/' }, cost: 0.2, tokens }))
  part.run('prt_3', 'msg_2', 'ses_1', t0, t0, JSON.stringify({ type: 'tool', tool: 'edit', callID: 'c1', state: { status: 'completed', input: { filePath: '/Users/test/code/api/src/auth.ts', oldString: 'ttl = 60', newString: 'ttl = 3600\nrefresh()' }, output: 'x'.repeat(5000), metadata: {} } }))
  part.run('prt_4', 'msg_2', 'ses_1', t0, t0, JSON.stringify({ type: 'text', text: 'Raised the TTL and added a refresh.' }))
  msg.run('msg_3', 'ses_2', t0 + 2000, t0, JSON.stringify({ role: 'assistant', time: { created: t0 + 2000 }, modelID: 'gpt-5.1-codex', providerID: 'openai', tokens }))
  db.close()
  const [dbFile] = discoverOpenCode([{ dir, where: '' }], 'opencode')
  const o = (await parseOpenCodeFile(dbFile, 'opencode')) as any
  assert.equal(o.kind, 'threads')
  assert.equal(o.threads.length, 1, 'the child session is a subagent, not a thread')
  const th = o.threads[0]
  assert.deepEqual(th.events.filter((e: any) => e.k === 'h').map((e: any) => e.text), ['the login token expires too early'], 'synthetic parts are the harness, not the person')
  assert.equal(th.project, 'api')
  assert.equal(th.linesAdded, 2)
  assert.equal(th.agentMs, 60000)
  assert.deepEqual(o.usage.rows.map((r: any[]) => [r[0], r[1], r[3], r[4], r[5], r[6]]), [['o|msg_2', 'claude-sonnet-4-5', 3120, 20000, 500, 3000]], 'writes join input, reasoning joins output')
  assert.deepEqual(o.usage.subRows.map((r: any[]) => r[1]), ['gpt-5.1-codex'])

  // the same session in the legacy tree counts once: same message ids
  const storage = path.join(dir, 'storage')
  const put = (p: string, v: unknown) => {
    fs.mkdirSync(path.dirname(path.join(storage, p)), { recursive: true })
    fs.writeFileSync(path.join(storage, p), JSON.stringify(v))
  }
  put('session/proj/ses_1.json', { id: 'ses_1', directory: '/Users/test/code/api', title: 'Fix auth', time: { created: t0 } })
  put('message/ses_1/msg_1.json', { id: 'msg_1', sessionID: 'ses_1', role: 'user', time: { created: t0 } })
  put('part/msg_1/prt_1.json', { id: 'prt_1', type: 'text', text: 'the login token expires too early' })
  put('message/ses_1/msg_2.json', { id: 'msg_2', sessionID: 'ses_1', role: 'assistant', time: { created: t0 + 1000 }, modelID: 'claude-sonnet-4-5', tokens })
  const legacy = discoverOpenCode([{ dir, where: '' }], 'opencode').find((d) => d.file.endsWith('.json'))!
  const l = (await parseOpenCodeFile(legacy, 'opencode')) as any
  assert.equal(l.threads[0].id, 'ses_1')
  assert.equal(l.threads[0].events[0].id, th.events[0].id)
  assert.equal(l.usage.rows[0][0], 'o|msg_2')
})

test('Qwen Code and Copilot CLI: typed prompts only, usage from the right records, session totals counted as increments', async () => {
  const { parseQwenFile } = await import('../src/sources/qwen.ts')
  const { parseCopilotFile } = await import('../src/sources/copilot.ts')
  const base = { sessionId: 'Q1', cwd: '/Users/test/code/cli', version: '0.9', gitBranch: 'main' }
  const q = (await parseQwenFile(
    write('qwen/projects/-users-test-code-cli/chats/Q1.jsonl', [
      { ...base, uuid: 'u1', parentUuid: null, timestamp: '2026-09-05T08:00:00Z', type: 'user', message: { role: 'user', parts: [{ text: 'add a --json flag' }] } },
      { ...base, uuid: 'a1', parentUuid: 'u1', timestamp: '2026-09-05T08:00:20Z', type: 'assistant', model: 'qwen3-coder-plus', message: { role: 'model', parts: [{ text: 'thinking…', thought: true }, { functionCall: { name: 'edit', args: { file_path: '/Users/test/code/cli/src/main.ts', old_string: 'a', new_string: 'b\nc' } } }] }, usageMetadata: { promptTokenCount: 5000, cachedContentTokenCount: 4000, candidatesTokenCount: 200, thoughtsTokenCount: 50, totalTokenCount: 5250 } },
      { ...base, uuid: 's1', parentUuid: 'a1', timestamp: '2026-09-05T08:00:21Z', type: 'system', subtype: 'ui_telemetry', systemPayload: { uiEvent: { 'event.name': 'qwen-code.api_response', input_token_count: 5000 } } },
      { ...base, uuid: 'g1', parentUuid: 's1', timestamp: '2026-09-05T08:01:00Z', type: 'user', subtype: 'goal_runtime', provenance: 'goal_runtime', message: { role: 'user', parts: [{ text: 'Continue toward the goal.' }] } },
    ]),
  )) as any
  assert.deepEqual(q.thread.events.filter((e: any) => e.k === 'h').map((e: any) => e.text), ['add a --json flag'], 'goal runtime prompts are Qwen’s, not the person’s')
  assert.deepEqual(q.usage.rows.map((r: any[]) => [r[1], r[3], r[4], r[5]]), [['qwen3-coder-plus', 1000, 4000, 250]], 'telemetry copies of usage are not counted again')
  assert.equal(q.thread.linesAdded, 2)

  const ev = (type: string, data: object, t: string) => ({ type, data, id: `${type}-${t}`, timestamp: t })
  const metrics = (inT: number, read: number, out: number) => ({ modelMetrics: { 'claude-sonnet-4.5': { usage: { inputTokens: inT, outputTokens: out, cacheReadTokens: read, cacheWriteTokens: 0 }, requests: { count: 1 } } } })
  const c = (await parseCopilotFile(
    write('copilot/session-state/C1/events.jsonl', [
      ev('session.start', { sessionId: 'C1', selectedModel: 'claude-sonnet-4.5', context: { cwd: '/Users/test/code/site', branch: 'main' } }, '2026-09-06T10:00:00Z'),
      ev('user.message', { content: 'make the header sticky' }, '2026-09-06T10:00:01Z'),
      ev('assistant.message', { messageId: 'm1', content: '', toolRequests: [{ toolCallId: 't1', name: 'edit', arguments: JSON.stringify({ path: '/Users/test/code/site/app.css', old_str: 'top: 0', new_str: 'position: sticky;\ntop: 0' }) }] }, '2026-09-06T10:00:05Z'),
      ev('session.shutdown', metrics(10000, 8000, 300), '2026-09-06T10:05:00Z'),
      ev('user.message', { content: 'also on mobile' }, '2026-09-07T09:00:00Z'),
      ev('session.shutdown', metrics(16000, 12000, 500), '2026-09-07T09:10:00Z'),
    ]),
  )) as any
  assert.equal(c.thread.project, 'site')
  assert.equal(c.thread.linesAdded, 2)
  assert.deepEqual(c.usage.rows.map((r: any[]) => [r[1], r[3], r[4], r[5]]), [
    ['claude-sonnet-4-5', 2000, 8000, 300],
    ['claude-sonnet-4-5', 2000, 4000, 200],
  ], 'a resumed session adds only what it spent since; inputTokens includes cache reads')
  assert.ok(c.thread.events.every((e: any) => !e.tok), 'session totals belong to no single turn')
})

test('lore vs: a code carries only the card, rounded dots and a prompt bucket, and survives a round trip', async () => {
  const { vsCode, readVsCode, compareVs } = await import('../src/pipeline/versus.ts')
  const { barPosition } = await import('../src/pipeline/deck.ts')
  const spectra = ['control', 'briefing', 'clock', 'range', 'stamina', 'temper', 'leash'].map((key, i) => ({ key, value: barPosition([-1.3, 0.2, 2.1, -0.4, 0, 1.6, -2.6][i]) }))
  const code = vsCode('volcano', spectra, 25000)
  assert.match(code, /^LORE-[0-9A-Z]{11}$/)
  const me = readVsCode(` ${code.toLowerCase()} `)!
  assert.equal(me.card, 'volcano')
  assert.deepEqual(Object.values(me.z), [-1.25, 0.25, 2, -0.5, 0, 1.5, -2.5], 'quarter steps')
  assert.equal(me.prompts, 32767, 'nearest power of two')
  assert.equal(readVsCode(code.slice(0, -1) + (code.endsWith('0') ? '1' : '0')), null, 'a typo fails the checksum')
  assert.equal(readVsCode('LORE-hello'), null)
  assert.equal(compareVs(me, me).sync, 100)
  const calm = { ...me, z: { ...me.z, temper: -1 } }
  const vs = compareVs(me, calm)
  assert.deepEqual(vs.awards.map((a) => [a.you, a.text]), [[true, 'swear more']])
})
