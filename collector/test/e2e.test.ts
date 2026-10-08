// The collector end to end, entirely in memory: POST /v1/stats → queue → R2 + D1 counters →
// cron → KV index → GET /v1/index → the CLI's own rank. No wrangler, no workerd, no network,
// nothing in production: D1 is node:sqlite loaded with collector/schema.sql, and R2, KV, the
// queue, the rate limiter and the edge cache are small shims with the same calls.
//   npm test                 from the repo root, with lore's own tests (Node 22.13+)
//   cd collector && npm test  just these

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-collector-e2e-'))
after(() => fs.rmSync(TMP, { recursive: true, force: true }))
// lore's local server reads ~/.lore at import; keep it away from the real one
process.env.LORE_HOME = path.join(TMP, 'lore-home')

const { default: worker } = await import('../src/index.ts')
const { aggregate, countRow, holds, REPO_FIELDS } = await import('../../src/pipeline/indexAgg.ts')
const { RANKED, STATS_SCHEMA, topShare, validateStats } = await import('../../src/pipeline/stats.ts')

const K = 25
/** Months of raw rows kept, and so of months the cron looks at. */
const WINDOW = 13
const THIS_MONTH = new Date().toISOString().slice(0, 7)
/** The month n before this one, the way the cron counts them: monthsAgo(1) is last month. */
const monthsAgo = (n: number, d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1)).toISOString().slice(0, 7)
const TODAY = new Date().toISOString().slice(0, 10)
const ORIGIN = 'https://api.lore-wrapped.com'

// ───────────────────────── a sample run: ten fictional months of history, through the real pipeline

/** One run's report and the payload it sends, repo stats included. Deterministic, and nobody's data. */
async function makeSample(): Promise<{ report: any; stats: any }> {
  const { buildReport } = await import('../../src/pipeline/facts.ts')
  const { ledgerFromThreads } = await import('../../src/pipeline/scan.ts')
  const { buildStats } = await import('../../src/pipeline/stats.ts')
  let s = 20261007
  const r = () => (s = (s * 48271) % 2147483647) / 2147483647
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
  const logn = (median: number, spread: number) => median * Math.exp((r() + r() + r() - 1.5) * spread)
  const FILES: Record<string, string[]> = {
    shop: ['src/cart.ts', 'src/api/orders.ts', 'web/Checkout.tsx'],
    app: ['App/FeedView.swift', 'App/Sync.swift'],
    ingest: ['cmd/ingest/main.go', 'sql/events.sql'],
    reports: ['etl/rollup.py', 'docs/metrics.md'],
  }
  const ASKS = ['fix the checkout total, it goes negative with a coupon', 'add a csv export to the orders page', 'explain how the sync job retries', 'write tests for the rate limiter', 'refactor the auth middleware, it does too much', 'plan the move to the new queue, options first']
  const STEERS = ["no, don't add a dependency for that", 'still broken, same error on refresh', 'too complicated, simplify it', 'revert that, it broke the build', "that's not what i asked, keep the old api"]
  const SWEARS = ['wtf, why is it calling the api twice', 'this is still fucking broken', 'shit, that wiped the fixtures']
  const MORE = ['now the same for the admin page', 'run the tests again', 'add a loading state', 'please update the docs too', 'thanks. now the empty state', 'looks good, ship it']
  const MODELS = { 'claude-code': ['claude-opus-5-5', 'claude-sonnet-5-5'], codex: ['gpt-6.1-sol', 'gpt-5.6-sol'] } as const
  const END = Date.UTC(2026, 9, 1)
  const threads: any[] = []
  for (let day = Date.UTC(2025, 11, 1, 13); day < END; day += 86_400_000) {
    if (r() > 0.75) continue
    for (let n = 1 + Math.floor(r() * 4); n > 0; n--) {
      const i = threads.length
      const project = pick(Object.keys(FILES))
      const source = r() < 0.5 ? 'codex' : 'claude-code'
      const model = pick(MODELS[source])
      const events: any[] = []
      const tokens: Record<string, { in: number; cached: number; out: number }> = {}
      const efforts: Record<string, number> = {}
      let [t, agentMs, added, removed, interrupts, toolCalls] = [day + r() * 12 * 3_600_000, 0, 0, 0, 0, 0]
      const prompts = Math.max(2, Math.min(120, Math.round(logn(10, 1))))
      for (let k = 0; k < prompts; k++) {
        const roll = r()
        const afterInterrupt = k > 0 && roll < 0.05
        if (afterInterrupt) interrupts++
        const text = k === 0 ? pick(ASKS) : roll < 0.15 ? pick(STEERS) : roll < 0.22 ? pick(SWEARS) : pick(MORE)
        events.push({ k: 'h', t, id: `h${i}-${k}`, text, ln: 2 * k + 1, ...(afterInterrupt ? { afterInterrupt } : {}) })
        const ms = Math.round(Math.min(4 * 3_600_000, logn(70_000, 1.4)))
        const tools = Math.round(logn(8, 0.9))
        const edits: [string, number, number][] = r() < 0.7 ? [[pick(FILES[project]), Math.round(logn(28, 1)), Math.round(logn(9, 1))]] : []
        for (const [, a, d] of edits) [added, removed] = [added + a, removed + d]
        const tok: [number, number, number] = [Math.round(logn(9000, 0.6)), Math.round(logn(1_200_000, 0.6)), Math.round(logn(1600, 0.7))]
        const used = (tokens[model] ||= { in: 0, cached: 0, out: 0 })
        ;[used.in, used.cached, used.out] = [used.in + tok[0], used.cached + tok[1], used.out + tok[2]]
        const effort = pick(['high', 'medium', 'xhigh'])
        efforts[effort] = (efforts[effort] || 0) + 1
        const cmds = tools ? [pick(['npm test', 'go test ./...', 'pytest -q', 'git diff --stat'])] : []
        events.push({ k: 'a', t: t + ms, id: `a${i}-${k}`, text: 'Done, and the tests pass.', tools, toolNames: tools ? ['exec', 'apply_patch'] : [], model, ln: 2 * k + 2, ms, edits, cmds, tok, effort })
        ;[agentMs, toolCalls, t] = [agentMs + ms, toolCalls + tools, t + ms + Math.round(logn(120_000, 1))]
      }
      threads.push({ id: `sample-${i}`, source, surface: 'cli', file: `/sample/${source}/${i}.jsonl`, archived: false, cwd: `/sample/${project}`, project, startedAt: events[0].t, endedAt: t, events, models: { [model]: prompts }, toolCalls, interrupts, slashCommands: 0, tokens, agentMs, linesAdded: added, linesRemoved: removed, efforts, planModeTurns: 0, warnings: [] })
    }
  }
  const scan = { threads, coverage: [], scannedAt: END, scanMs: 1, filesParsed: threads.length, filesFromCache: 0, bytesParsed: 0, claudeStats: null, claudePlan: null, claudeFirstUse: null, usage: ledgerFromThreads(threads) }
  const { report } = buildReport(scan as any)
  const repoShape = { repos: 4, tests: 3, ci: 2, container: 1, agentMd: 2, frameworks: ['next', 'react'], files: { '100_999': 2, '1k_9k': 2 }, age: { '3_12mo': 1, '1_3y': 3 }, hosts: { github: 3, none: 1 }, licenses: { none: 3, permissive: 1 }, team: { solo: 3, '2_5': 1 }, outcomes: { checked: 24, committed: 14, reverted: 1 } }
  return { report, stats: buildStats({ ...report, repoShape }) }
}
const SAMPLE = await makeSample()
const BASE = SAMPLE.stats

let seed = 11
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
/** Roughly lognormal around x, so runs spread over several steps. */
const around = (x: number, spread: number) => x * Math.exp((rnd() + rnd() + rnd() - 1.5) * spread)
const int = (x: number) => Math.max(0, Math.round(x))
const dec = (x: number) => Math.max(0, Math.round(x * 10) / 10)
const share = (max = 20) => Math.round(rnd() * max) / 20

/** One valid payload: the sample run with its numbers moved around. */
function payload(o: { repo?: boolean; os?: string; archetype?: string } = {}) {
  const s = structuredClone(BASE)
  s.prompts = int(around(BASE.prompts, 1.2))
  s.threads = int(around(BASE.threads, 1.2))
  s.active_days = Math.min(365, int(around(BASE.active_days, 0.6)))
  s.agent_hours = dec(around(BASE.agent_hours, 1.2))
  s.api_usd = int(around(BASE.api_usd, 1.2))
  s.lines_added = int(around(BASE.lines_added, 1.2))
  s.tokens = int(around(BASE.tokens, 1.2))
  s.swear_per_100 = dec(around(BASE.swear_per_100, 0.8))
  s.streak_days = int(around(BASE.streak_days, 0.8))
  s.steer_rate = share(10)
  s.night_share = share(8)
  s.interrupts_per_100 = Math.floor(rnd() * 20)
  s.os = o.os ?? 'darwin'
  s.archetype = o.archetype ?? 'volcano'
  if (!o.repo) for (const k of REPO_FIELDS) delete s[k]
  assert.deepEqual(validateStats(s), [], 'the generator makes valid payloads')
  return s
}

// ───────────────────────── Cloudflare bindings, in memory

/**
 * D1 over node:sqlite, with D1's own limits (developers.cloudflare.com/d1/platform/limits):
 * 100 bound parameters and 100 KB of SQL per statement, 2 MB per string or blob.
 */
function makeD1() {
  const db = new DatabaseSync(':memory:')
  db.exec(fs.readFileSync(path.join(HERE, '../schema.sql'), 'utf8'))
  // failWhen: fail (once) the first batch with a statement this matches, after running it all
  const log = {
    statements: 0,
    maxParams: 0,
    maxSqlBytes: 0,
    maxValueBytes: 0,
    sql: [] as string[],
    batches: [] as number[],
    failWhen: null as null | ((s: { sql: string; params: unknown[] }) => boolean),
  }
  const bytes = (p: unknown) => (typeof p === 'string' ? Buffer.byteLength(p) : p instanceof Uint8Array ? p.byteLength : 0)
  const exec = (sql: string, params: unknown[], mode: 'all' | 'run' | 'first') => {
    if (params.length > 100) throw new Error(`D1_ERROR: too many SQL variables (${params.length})`)
    if (Buffer.byteLength(sql) > 100_000) throw new Error('D1_ERROR: statement too long')
    if (params.some((p) => bytes(p) > 2_000_000)) throw new Error('D1_ERROR: string or blob too big')
    if (params.some((p) => p === undefined)) throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported")
    log.statements++
    log.sql.push(sql)
    log.maxParams = Math.max(log.maxParams, params.length)
    log.maxSqlBytes = Math.max(log.maxSqlBytes, Buffer.byteLength(sql))
    log.maxValueBytes = Math.max(log.maxValueBytes, ...params.map(bytes))
    const st = db.prepare(sql)
    if (mode === 'first') return st.get(...(params as any[])) ?? null
    if (mode === 'all') return { success: true, results: st.all(...(params as any[])), meta: {} }
    const info = st.run(...(params as any[]))
    return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }
  }
  const stmt = (sql: string, params: unknown[] = []): any => ({
    sql,
    params,
    bind: (...p: unknown[]) => stmt(sql, p),
    all: async () => exec(sql, params, 'all'),
    run: async () => exec(sql, params, 'run'),
    first: async (col?: string) => {
      const row: any = exec(sql, params, 'first')
      return row && col ? row[col] : row
    },
  })
  return {
    db,
    log,
    binding: {
      prepare: (sql: string) => stmt(sql),
      /** D1 runs a batch as one transaction: all or nothing. */
      batch: async (stmts: any[]) => {
        log.batches.push(stmts.length)
        const fail = log.failWhen && stmts.some(log.failWhen)
        if (fail) log.failWhen = null
        db.exec('BEGIN')
        try {
          const out = stmts.map((s) => exec(s.sql, s.params, /^\s*select/i.test(s.sql) ? 'all' : 'run'))
          if (fail) throw new Error('D1_ERROR: injected failure')
          db.exec('COMMIT')
          return out
        } catch (e) {
          db.exec('ROLLBACK')
          throw e
        }
      },
    },
  }
}

function makeEnv() {
  const d1 = makeD1()
  const r2 = new Map<string, string>()
  const kv = new Map<string, string>()
  const kvReads = { n: 0 }
  const kvWrites = { n: 0 }
  const sent: any[] = []
  const hits = new Map<string, number>()
  const env = {
    DB: d1.binding,
    RAW: {
      put: async (key: string, value: string) => {
        r2.set(key, String(value))
        return { key }
      },
      get: async (key: string) => (r2.has(key) ? { text: async () => r2.get(key)! } : null),
    },
    INDEX: {
      get: async (key: string) => {
        kvReads.n++
        return kv.get(key) ?? null
      },
      put: async (key: string, value: string) => {
        assert.ok(value.length < 25 * 1024 * 1024, 'KV values stay under 25 MiB')
        kvWrites.n++
        kv.set(key, value)
      },
    },
    STATS: {
      // the real queue serializes with structured clone and caps a message at 128 KB
      send: async (body: unknown) => {
        assert.ok(JSON.stringify(body).length < 128 * 1024, 'queue messages stay under 128 KB')
        sent.push(structuredClone(body))
      },
    },
    // the deployed limiter: 10 a minute per key
    LIMIT: {
      limit: async ({ key }: { key: string }) => {
        hits.set(key, (hits.get(key) || 0) + 1)
        return { success: hits.get(key)! <= 10 }
      },
    },
  }
  return { env: env as any, d1, r2, kv, kvReads, kvWrites, sent }
}
type Env = ReturnType<typeof makeEnv>

/** caches.default: one store per test run; cleared by fresh(). */
const edge = new Map<string, Response>()
;(globalThis as any).caches = {
  default: {
    match: async (req: Request) => edge.get(req.url)?.clone(),
    put: async (req: Request, res: Response) => void edge.set(req.url, res),
  },
}

let ipSeq = 0
/** Each client from its own address (the limiter only sees it as a key). */
const nextIp = () => `198.51.100.${++ipSeq}`

async function call(e: Env, p: string, o: { method?: string; body?: unknown; raw?: string; ip?: string; headers?: Record<string, string> } = {}) {
  const waits: Promise<unknown>[] = []
  const ctx = { waitUntil: (pr: Promise<unknown>) => void waits.push(pr), passThroughOnException() {} }
  const method = o.method || (o.body !== undefined || o.raw !== undefined ? 'POST' : 'GET')
  const req = new Request(ORIGIN + p, {
    method,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': o.ip || nextIp(), ...o.headers },
    body: o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined),
  })
  const res: Response = await worker.fetch(req, e.env, ctx as any)
  await Promise.all(waits)
  return res
}

/** Message ids: a redelivered message keeps its id, as on the real queue. */
const ids = new WeakMap<object, string>()
let idSeq = 0
const idOf = (body: object) => ids.get(body) ?? (ids.set(body, (++idSeq).toString(16).padStart(32, '0')), ids.get(body)!)

/** Delivers what the queue holds as one batch, the way the consumer would get it. */
async function flush(e: Env, bodies = e.sent.splice(0)) {
  let acked = false
  const batch = {
    queue: 'lore-stats',
    messages: bodies.map((body) => ({ id: idOf(body), timestamp: new Date(), attempts: 1, body, ack() {}, retry() {} })),
    ackAll: () => void (acked = true),
    retryAll() {},
  }
  await worker.queue(batch as any, e.env)
  return { acked, batch }
}

const cron = (e: Env) => worker.scheduled({ cron: '*/10 * * * *', scheduledTime: Date.now(), noRetry() {} } as any, e.env)
const index = (e: Env) => JSON.parse(e.kv.get('index')!)

/** A month's counters as D1 holds them. */
const dbCounts = (e: Env, month: string) =>
  Object.fromEntries((e.d1.db.prepare('SELECT k, n FROM counts WHERE month = ? ORDER BY k').all(month) as any[]).map((r) => [r.k, r.n]))
/** The counters the same rows should add up to. */
const refCounts = (rows: any[]) => {
  const c = new Map<string, number>()
  for (const r of rows) countRow(c, r)
  return Object.fromEntries([...c].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}
const rawRows = (e: Env, month: string) =>
  [...e.r2]
    .filter(([k]) => k.startsWith(`raw/${month}/`))
    .flatMap(([, v]) => v.trim().split('\n').map((l) => JSON.parse(l)))

/** Posts rows the way clients do (each from its own address), then drains the queue. */
async function ingest(rows: any[], e = makeEnv()) {
  for (const r of rows) assert.equal((await call(e, '/v1/stats', { body: r })).status, 202)
  await flush(e)
  return e
}

/**
 * k-anonymity over a published index: every slice it shows has at least K contributing runs.
 * `rows` are the runs behind it, to count contributors per field.
 */
function assertKAnon(idx: any, rows: any[]) {
  const has = (f: string) => rows.filter((r) => typeof r[f] === 'number').length
  for (const [f, d] of Object.entries<Record<string, number>>(idx.dist)) {
    for (const [b, n] of Object.entries(d)) assert.ok(n >= K, `dist.${f}[${b}] has ${n} runs`)
    assert.ok(has(f) >= K, `dist.${f} is published from ${has(f)} runs`)
  }
  for (const [f, d] of Object.entries<Record<string, number>>(idx.ranks)) for (const [b, n] of Object.entries(d)) assert.ok(n >= K, `ranks.${f}[${b}] has ${n} runs`)
  for (const f of Object.keys(idx.median)) assert.ok(has(f) >= K, `median.${f} from ${has(f)} runs`)
  for (const f of Object.keys(idx.quantiles)) assert.ok(has(f) >= K, `quantiles.${f} from ${has(f)} runs`)
  for (const f of Object.keys(idx.totals)) assert.ok(has(f) >= K, `totals.${f} from ${has(f)} runs`)
  for (const [f, xs] of Object.entries<{ key: string; share: number }[]>(idx.enums))
    for (const x of xs) assert.ok(Math.round(x.share * idx.runs) >= K, `enums.${f}=${x.key} from ${Math.round(x.share * idx.runs)} runs`)
  for (const [f, xs] of Object.entries<{ key: string; runs: number }[]>(idx.maps)) for (const x of xs) assert.ok(x.runs >= K, `maps.${f}.${x.key} from ${x.runs} runs`)
}

const byKey = (xs: { key: string }[]) => [...xs].sort((a, b) => a.key.localeCompare(b.key))

// ───────────────────────── scenarios

test('a: 30 valid payloads are accepted, queued, and land in R2 and D1 for this month', async () => {
  const e = makeEnv()
  const rows = Array.from({ length: 30 }, () => payload())
  for (const r of rows) {
    const res = await call(e, '/v1/stats', { body: r })
    assert.equal(res.status, 202)
    assert.deepEqual(await res.json(), { ok: true })
  }
  assert.equal(e.sent.length, 30)
  // a message is the month and the payload: no address, no time
  for (const m of e.sent) assert.deepEqual(Object.keys(m).sort(), ['month', 'stats'])
  assert.ok(e.sent.every((m) => m.month === THIS_MONTH))

  const { acked } = await flush(e)
  assert.ok(acked, 'the batch is acknowledged')
  const keys = [...e.r2.keys()]
  assert.ok(keys.length >= 1 && keys.every((k) => new RegExp(`^raw/${THIS_MONTH}/[\\w-]+\\.jsonl$`).test(k)), keys.join(' '))
  const raw = rawRows(e, THIS_MONTH)
  assert.equal(raw.length, 30)
  assert.ok(raw.every((l) => l.month === THIS_MONTH))
  assert.deepEqual(raw.map((l) => l.stats), rows)

  assert.equal(dbCounts(e, THIS_MONTH).n, 30)
  // every counter, chunk boundaries included, is exactly what countRow says
  assert.deepEqual(dbCounts(e, THIS_MONTH), refCounts(rows))
  // the addresses the limiter saw are nowhere in storage
  const stored = JSON.stringify([...e.r2.values(), e.d1.db.prepare('SELECT * FROM counts').all()])
  assert.ok(!stored.includes('198.51.100.'), 'no IP is stored')
})

test('b: the cron publishes the index, and GET /v1/index serves it with CORS and cache headers', async () => {
  edge.clear()
  const rows = Array.from({ length: 30 }, () => payload())
  const e = await ingest(rows)

  // before the first cron: the placeholder, which the edge then keeps for up to 5 minutes
  const placeholder = { minimumPerSlice: K, published: false, runs: 0 }
  assert.deepEqual(await (await call(e, '/v1/index')).json(), placeholder)
  await cron(e)
  assert.deepEqual(await (await call(e, '/v1/index')).json(), placeholder, 'still cached right after the cron')
  edge.clear() // five minutes later
  const idx = index(e)
  assert.equal(idx.published, true)
  assert.equal(idx.runs, 30)
  assert.equal(idx.month, THIS_MONTH)
  assert.equal(idx.schema, STATS_SCHEMA)
  assert.equal(idx.minimumPerSlice, K)

  // the same index the row-by-row aggregate gives: counts exact, number percentiles within a ~10% bin
  const ref = aggregate(rows, K)
  assert.deepEqual(idx.dist, ref.dist)
  for (const f of ['steer_rate', 'night_share', 'interrupts_per_100', 'approval_rate']) assert.equal(idx.median[f], ref.median[f], f)
  for (const f of ['prompts', 'agent_hours', 'api_usd', 'tokens', 'lines_added', 'active_days', 'swear_per_100']) {
    assert.ok(Math.abs(idx.median[f] / ref.median[f] - 1) < 0.12, `median ${f}: ${idx.median[f]} vs ${ref.median[f]}`)
    assert.ok(Math.abs(idx.totals[f] - ref.totals[f]) < 0.5, `total ${f}`)
    assert.equal(idx.quantiles[f].length, 5)
    assert.ok(idx.quantiles[f].every((x: number, i: number, q: number[]) => i === 0 || x >= q[i - 1]), `${f} quantiles rise`)
  }
  for (const f of Object.keys(ref.enums)) assert.deepEqual(byKey(idx.enums[f]), byKey(ref.enums[f]), f)
  for (const f of Object.keys(ref.maps)) assert.deepEqual(byKey(idx.maps[f]), byKey(ref.maps[f]), f)
  assert.deepEqual(idx.enums.os, [{ key: 'darwin', share: 1 }])
  // every ranked metric is published, and its steps hold all 30 runs
  assert.deepEqual(Object.keys(idx.ranks).sort(), RANKED.map((r) => r.key).sort())
  for (const { key } of RANKED) {
    assert.deepEqual(idx.ranks[key], idx.dist[key])
    assert.equal(Object.values<number>(idx.ranks[key]).reduce((a, b) => a + b, 0), 30)
  }
  assertKAnon(idx, rows)

  const res = await call(e, '/v1/index')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/json')
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300')
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  assert.deepEqual(await res.json(), idx)
  // the next request comes from the edge cache, not KV
  const reads = e.kvReads.n
  const again = await call(e, '/v1/index')
  assert.deepEqual(await again.json(), idx)
  assert.equal(e.kvReads.n, reads, 'served from cache')
  assert.equal(again.headers.get('access-control-allow-origin'), '*')
})

test('c: under 25 runs nothing is published, and thin slices never leak once it is', async () => {
  edge.clear()
  const ten = Array.from({ length: 10 }, () => payload({ repo: true }))
  const e = await ingest(ten)
  await cron(e)
  const idx = index(e)
  assert.equal(idx.published, false)
  assert.equal(idx.runs, 10)
  for (const f of ['median', 'dist', 'totals', 'quantiles', 'enums', 'maps', 'ranks']) assert.deepEqual(idx[f], {}, f)
  assert.deepEqual(await (await call(e, '/v1/index')).json(), idx)

  // 30 runs where some answers are rare: 3 on Linux, 2 other cards, 3 with repo stats on
  const rows = Array.from({ length: 30 }, (_, i) => payload({ os: i < 3 ? 'linux' : 'darwin', archetype: i >= 28 ? 'monk' : 'volcano', repo: i >= 27 }))
  const e2 = await ingest(rows)
  await cron(e2)
  const pub = index(e2)
  assert.equal(pub.published, true)
  assertKAnon(pub, rows)
  assert.deepEqual(pub.enums.os.map((x: any) => x.key), ['darwin'])
  assert.deepEqual(pub.enums.archetype.map((x: any) => x.key), ['volcano'])
  for (const f of ['repos', 'repos_tests', 'repos_ci', 'repos_container', 'agent_md']) assert.equal(pub.dist[f], undefined, `dist.${f} from 3 runs`)
  for (const f of ['repo_frameworks', 'repo_files', 'repo_age', 'remote_hosts', 'license_families', 'team_size']) assert.deepEqual(pub.maps[f], [], f)
  for (const f of ['kept_rate', 'revert_rate']) assert.equal(pub.median[f], undefined, f)
  // the published text says nothing about the rare answers
  const text = JSON.stringify(pub)
  for (const s of ['linux', 'monk', '"repos"', 'github', 'solo']) assert.ok(!text.includes(s), `${s} leaks`)

  // with a full earlier month and a thin current one, the cron keeps showing the full month
  const e3 = makeEnv()
  await flush(e3, Array.from({ length: 30 }, () => ({ month: monthsAgo(1), stats: payload() })))
  await flush(e3, Array.from({ length: 10 }, () => ({ month: THIS_MONTH, stats: payload() })))
  await cron(e3)
  assert.equal(index(e3).month, monthsAgo(1))
  assert.equal(index(e3).published, true)
})

test('d: invalid payloads are refused with 400 or 413, nothing is queued, and each refusal is only counted', async () => {
  const e = makeEnv()
  let refused = 0
  const post = async (...a: Parameters<typeof call>) => {
    const res = await call(...a)
    if (res.status === 400 || res.status === 413) refused++
    return res
  }
  const good = payload({ repo: true })
  const without = (k: string) => Object.fromEntries(Object.entries(good).filter(([kk]) => kk !== k))
  const cases: [string, unknown, RegExp][] = [
    ['an unknown field', { ...good, email: 'someone@example.com' }, /unexpected field email/],
    ['another schema', { ...good, schema: 'lore.stats.v4' }, /bad schema/],
    ['a missing field', without('prompts'), /missing prompts/],
    ['a value over its MAX', { ...good, prompts: 1e8 + 1 }, /bad prompts/],
    ['tokens over its MAX', { ...good, tokens: 1e15 + 1 }, /bad tokens/],
    ['a per-100 count over its max', { ...good, interrupts_per_100: 51 }, /bad interrupts_per_100/],
    ['a fraction where a count goes', { ...good, prompts: 10.5 }, /bad prompts/],
    ['a negative number', { ...good, threads: -1 }, /bad threads/],
    ['a share off the 5% grid', { ...good, steer_rate: 0.123 }, /bad steer_rate/],
    ['a card not in the deck', { ...good, archetype: 'hacker' }, /bad archetype/],
    ['a private model name', { ...good, model_share: { 'acme-internal-7b': 0.5 } }, /bad model_share/],
    ['half of the repo stats', without('repos'), /missing repos/],
    ['a string for a number', { ...good, prompts: '7836' }, /bad prompts/],
    ['an array', [good], /not an object/],
    ['null', null, /not an object/],
    ['a prototype key', JSON.parse(JSON.stringify(good).replace('{', '{"__proto__":{"x":1},')), /unexpected field __proto__/],
  ]
  for (const [what, body, why] of cases) {
    const res = await post(e, '/v1/stats', { raw: JSON.stringify(body) })
    assert.equal(res.status, 400, what)
    const { error } = (await res.json()) as any
    assert.ok(error.some((x: string) => why.test(x)), `${what}: ${error}`)
  }
  for (const [what, raw] of [
    ['bad JSON', '{"schema": "lore.stats.v5",'],
    ['an empty body', ''],
  ]) {
    const res = await post(e, '/v1/stats', { raw })
    assert.equal(res.status, 400, what)
    assert.deepEqual(await res.json(), { error: 'bad json' })
  }
  const huge = await post(e, '/v1/stats', { raw: JSON.stringify({ ...good, pad: 'x'.repeat(16 * 1024) }) })
  assert.equal(huge.status, 413)
  assert.deepEqual(await huge.json(), { error: 'too large' })
  // 16 KB is bytes, not characters: 6,000 "€" are 6,000 characters and 18,000 bytes
  const euros = JSON.stringify({ ...good, pad: '€'.repeat(6000) })
  assert.ok(euros.length < 16 * 1024 && Buffer.byteLength(euros) > 16 * 1024)
  const multi = await post(e, '/v1/stats', { raw: euros })
  assert.equal(multi.status, 413)
  assert.deepEqual(await multi.json(), { error: 'too large' })
  // a body that says it's too large is refused before it's read
  const declared = await post(e, '/v1/stats', { raw: JSON.stringify(good), headers: { 'content-length': String(1 << 20) } })
  assert.equal(declared.status, 413)
  // and one just under the limit, in bytes, is read (then refused for its extra field)
  const under = JSON.stringify({ ...good, pad: '€'.repeat(Math.floor((16 * 1024 - Buffer.byteLength(JSON.stringify({ ...good, pad: '' }))) / 3)) })
  assert.ok(Buffer.byteLength(under) <= 16 * 1024)
  assert.equal((await post(e, '/v1/stats', { raw: under })).status, 400)
  assert.equal((await post(e, '/v1/stats', { method: 'GET' })).status, 404)
  assert.equal((await post(e, '/v1/stats', { method: 'PUT', raw: JSON.stringify(good) })).status, 404)

  // the limiter: the 11th post in a minute from one address is turned away before it's read
  const ip = '203.0.113.7'
  for (let i = 0; i < 10; i++) assert.equal((await post(e, '/v1/stats', { raw: '{', ip })).status, 400)
  assert.equal((await post(e, '/v1/stats', { body: good, ip })).status, 429)
  assert.equal(e.sent.length, 0, 'nothing invalid or limited was queued')
  assert.deepEqual(dbCounts(e, THIS_MONTH), {}, 'and no counter moved')
  // a refusal adds one to a count by month and its first field, and that's all that's kept
  const rejects = e.d1.db.prepare('SELECT month, reason, n FROM rejects ORDER BY reason').all() as any[]
  assert.equal(rejects.reduce((a, r) => a + r.n, 0), refused, 'every refusal counted once, the limited one not at all')
  assert.ok(rejects.every((r) => r.month === THIS_MONTH))
  const reasons = rejects.map((r) => r.reason)
  for (const r of ['unexpected field', 'bad schema', 'missing prompts', 'bad prompts', 'bad tokens', 'bad model_share', 'missing repos', 'not an object', 'bad json', 'too large']) assert.ok(reasons.includes(r), `${r} in ${reasons}`)
  assert.deepEqual(reasons.filter((r) => !/^(bad|missing) [a-z0-9_]+$|^(unexpected field|not an object|bad json|too large)$/.test(r)), [], 'a field name, never a value, a key or a name the sender made up')
  assert.equal(rejects.find((r) => r.reason === 'bad json').n, 12)
})

test('d2: refusals are counted by field name only, and a database without the table still refuses the same way', async () => {
  const e = makeEnv()
  const good = payload()
  const tooMany = Object.fromEntries(['claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-6', 'claude-opus-4-5', 'claude-sonnet-4-5', 'claude-sonnet-4', 'claude-opus-4-1', 'gpt-5', 'gpt-5-codex', 'gpt-5.1-codex', 'gpt-5.2-codex', 'gpt-5.3-codex', 'gpt-5.5'].map((m) => [m, 0.05]))
  for (const body of [
    { ...good, model_share: tooMany },
    { ...good, model_share: { 'acme-internal-7b': 0.5 } },
    { ...good, 'jane@acme.com': 1 },
    { ...good, tokens_per_prompt: 641916326 },
  ])
    assert.equal((await call(e, '/v1/stats', { body })).status, 400)
  const rows = e.d1.db.prepare('SELECT reason, n FROM rejects ORDER BY reason').all() as any[]
  assert.deepEqual(rows.map((r) => [r.reason, r.n]), [['bad model_share', 2], ['bad tokens_per_prompt', 1], ['unexpected field', 1]])

  // the deployed database before `wrangler d1 execute … --file schema.sql`: no rejects table
  const old = makeEnv()
  old.d1.db.exec('DROP TABLE rejects')
  const res = await call(old, '/v1/stats', { body: { ...good, prompts: -1 } })
  assert.equal(res.status, 400)
  assert.deepEqual(await res.json(), { error: ['bad prompts'] })
  assert.equal((await call(old, '/v1/stats', { raw: '{' })).status, 400)
  assert.equal((await call(old, '/v1/stats', { body: good })).status, 202)
})

test('e: the waitlist adds, dedupes, removes and refuses bad emails, with CORS; nothing reads a team flag', async () => {
  const e = makeEnv()
  for (const p of ['/v1/waitlist', '/v1/waitlist/remove']) {
    const pre = await call(e, p, { method: 'OPTIONS', headers: { origin: 'https://lore-wrapped.com', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } })
    assert.equal(pre.status, 204, p)
    assert.equal(pre.headers.get('access-control-allow-origin'), '*')
    assert.equal(pre.headers.get('access-control-allow-headers'), 'content-type')
  }

  // record every property the worker reads off a parsed body
  const reads = new Set<PropertyKey>()
  const parse = JSON.parse
  JSON.parse = ((text: string, rev?: any) => {
    const v = parse(text, rev)
    return v && typeof v === 'object' ? new Proxy(v, { get: (o, k) => (reads.add(k), Reflect.get(o, k)), has: (o, k) => (reads.add(k), Reflect.has(o, k)) }) : v
  }) as typeof JSON.parse
  let add: Response
  try {
    add = await call(e, '/v1/waitlist', { body: { email: '  Test.Person+lore@Example.COM ', team: true } })
  } finally {
    JSON.parse = parse
  }
  assert.equal(add.status, 201)
  assert.equal(add.headers.get('access-control-allow-origin'), '*')
  assert.ok(reads.has('email'))
  assert.ok(!reads.has('team'), 'the worker never reads team')
  const src = fs.readFileSync(path.join(HERE, '../src/index.ts'), 'utf8').replace(/\/\/.*$/gm, '')
  assert.ok(!/\.team\b|\[['"]team['"]\]|\bteam\s*[,}]\s*=|\{[^}]*\bteam\b[^}]*\}\s*=/.test(src), 'no code reads a team field')

  const list = () => e.d1.db.prepare('SELECT email, team, day FROM waitlist').all().map((r: any) => ({ ...r }))
  assert.deepEqual(list(), [{ email: 'test.person+lore@example.com', team: 0, day: TODAY }])
  // again, any case: still one row
  assert.equal((await call(e, '/v1/waitlist', { body: { email: 'test.person+lore@example.com', team: 1 } })).status, 201)
  assert.equal(list().length, 1)

  for (const email of ['not-an-email', 'a@b', 'a b@example.com', '@example.com', `${'x'.repeat(250)}@example.com`, 42, null]) {
    const res = await call(e, '/v1/waitlist', { body: { email } })
    assert.equal(res.status, 400, String(email))
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
    assert.deepEqual(await res.json(), { error: 'bad email' })
  }
  assert.equal((await call(e, '/v1/waitlist', { raw: 'nope' })).status, 400)
  assert.equal(list().length, 1)

  const rm = await call(e, '/v1/waitlist/remove', { body: { email: 'TEST.person+lore@example.com' } })
  assert.equal(rm.status, 200)
  assert.equal(rm.headers.get('access-control-allow-origin'), '*')
  assert.deepEqual(list(), [])
  assert.equal((await call(e, '/v1/waitlist/remove', { body: { email: 'test.person+lore@example.com' } })).status, 200, 'removing twice is fine')
  assert.equal(e.sent.length, 0, 'the waitlist never touches the stats queue')
})

test('f: a batch across two months lands in each, and counters add up across batches', async () => {
  const e = makeEnv()
  const sep1 = Array.from({ length: 12 }, () => payload())
  const oct1 = Array.from({ length: 20 }, () => payload({ repo: true }))
  const sep2 = Array.from({ length: 3 }, () => payload())
  const oct2 = Array.from({ length: 15 }, () => payload())
  const msgs = (rows: any[], month: string) => rows.map((stats) => ({ month, stats }))
  // interleaved, the way a batch at the turn of the month arrives
  const [SEP, OCT] = [monthsAgo(1), THIS_MONTH]
  const first = [...msgs(sep1, SEP), ...msgs(oct1, OCT)].sort(() => rnd() - 0.5)
  await flush(e, first)
  await flush(e, [...msgs(oct2, OCT), ...msgs(sep2, SEP)])
  // one statement per month, both months in one batch (one transaction), each time
  assert.deepEqual(e.d1.log.batches, [2, 2])
  assert.equal(e.d1.log.statements, 4)

  assert.deepEqual(rawRows(e, SEP).map((l) => l.stats).sort((a, b) => a.prompts - b.prompts), [...sep1, ...sep2].sort((a, b) => a.prompts - b.prompts))
  assert.deepEqual(rawRows(e, OCT).map((l) => l.stats).sort((a, b) => a.prompts - b.prompts), [...oct1, ...oct2].sort((a, b) => a.prompts - b.prompts))
  assert.ok(rawRows(e, SEP).every((l) => l.month === SEP))
  assert.deepEqual(dbCounts(e, SEP), refCounts([...sep1, ...sep2]))
  assert.deepEqual(dbCounts(e, OCT), refCounts([...oct1, ...oct2]))
  assert.equal(dbCounts(e, SEP).n, 15)
  assert.equal(dbCounts(e, OCT).n, 35)
  assert.equal(dbCounts(e, OCT)['s\tprompts'], [...oct1, ...oct2].reduce((a, r) => a + r.prompts * 10, 0))

  await cron(e)
  assert.equal(index(e).month, OCT, 'the latest month with 25+ runs')
  assert.equal(index(e).runs, 35)
})

test('f2: a full batch of 100 stays inside D1 limits, and a failed write never counts a row twice', async (t) => {
  const e = makeEnv()
  seed = 99
  const rows = Array.from({ length: 100 }, (_, i) => payload({ repo: i % 2 === 0, os: ['darwin', 'linux', 'windows', 'wsl'][i % 4], archetype: ['volcano', 'monk', 'editor', 'sniper', 'night'][i % 5] }))
  await flush(e, rows.map((stats) => ({ month: THIS_MONTH, stats })))
  assert.deepEqual(dbCounts(e, THIS_MONTH), refCounts(rows))
  t.diagnostic(`100 diverse rows: ${Object.keys(refCounts(rows)).length} counters, ${e.d1.log.statements} D1 statements, max ${e.d1.log.maxParams} params, max ${e.d1.log.maxSqlBytes} bytes of SQL, ${e.d1.log.maxValueBytes} bytes of counters`)
  // one statement for the month's counters, however many there are (the free plan allows 50
  // queries an invocation; 30 counters a statement made this one 15, and a real batch 100+)
  assert.equal(e.d1.log.statements, 1)
  assert.deepEqual(e.d1.log.batches, [1])
  assert.ok(e.d1.log.maxParams <= 100)

  // D1 fails once, after the first month's counters are in; the queue retries the same batch
  const f = makeEnv()
  const a = Array.from({ length: 5 }, () => payload())
  const b = Array.from({ length: 5 }, () => payload())
  const bodies = [...a.map((stats) => ({ month: '2026-09', stats })), ...b.map((stats) => ({ month: '2026-10', stats }))]
  f.d1.log.failWhen = (s) => s.params.includes('2026-10')
  await assert.rejects(flush(f, bodies))
  assert.deepEqual(f.d1.log.batches, [2], 'both months in one batch')
  // nothing may be half-counted after a failure...
  const half = dbCounts(f, '2026-09').n
  assert.equal(half, undefined, `2026-09 holds ${half} runs after a failed batch`)
  await flush(f, bodies)
  // ...and after the retry, every row counts exactly once
  assert.deepEqual(dbCounts(f, '2026-09'), refCounts(a), `2026-09 holds ${dbCounts(f, '2026-09').n} runs after a retry (was ${half} after the failure)`)
  assert.deepEqual(dbCounts(f, '2026-10'), refCounts(b))
  assert.equal(rawRows(f, '2026-09').length, 5, 'and the raw rows are not duplicated')
  assert.equal(rawRows(f, '2026-10').length, 5)
})

test('g: the CLI places its own run in the published index (src/server/local.ts ranks)', async (t) => {
  edge.clear()
  const { startServer } = await import('../../src/server/local.ts')
  const ENDPOINT = 'https://collector.test'
  const own = (await import('../../src/pipeline/stats.ts')).buildStats(SAMPLE.report) as any
  const webDir = path.join(TMP, 'web')
  fs.mkdirSync(webDir, { recursive: true })

  const placed = async (e: Env) => {
    // the CLI's fetch of {endpoint}/v1/index goes to this worker; everything else is real
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: any, init?: any) => {
      const u = String(input?.url ?? input)
      if (!u.startsWith(ENDPOINT)) return realFetch(input, init)
      return call(e, u.slice(ENDPOINT.length))
    }) as typeof fetch
    const srv = await startServer({ report: SAMPLE.report, classified: [], cfg: { endpoint: ENDPOINT, ai: false, offline: false } as any, stats: {} as any, webDir })
    try {
      // the printed link's one-time code, traded for the session cookie as the page does
      const session = await realFetch(new URL('/api/session', srv.url), { method: 'POST', body: JSON.stringify({ code: new URL(srv.url).hash.slice(3) }) })
      const res = await realFetch(new URL('/api/ranks', srv.url), { headers: { cookie: session.headers.get('set-cookie')!.split(';')[0] } })
      assert.equal(res.status, 200)
      return (await res.json()) as { available: boolean; runs: number; rows: { key: string; value: number; top: number | null }[] }
    } finally {
      srv.close()
      globalThis.fetch = realFetch
    }
  }

  // 30 runs: one step per metric, and the run still gets a place inside it
  seed = 5
  const thirty = Array.from({ length: 30 }, () => payload())
  const e30 = await ingest(thirty)
  await cron(e30)
  const r30 = await placed(e30)
  assert.equal(r30.runs, 30)
  assert.equal(r30.available, true)
  for (const row of r30.rows) {
    assert.equal(row.value, own[row.key])
    const top = topShare(own[row.key], index(e30).ranks[row.key])
    assert.equal(row.top, top, row.key)
    assert.ok(row.top != null && row.top > 0 && row.top <= 1, `${row.key}: ${row.top}`)
    const exact = thirty.filter((r) => r[row.key] >= row.value).length / thirty.length
    // one wide step per metric, so coarse, but a typical run lands mid-pack, not at the bottom
    assert.ok(Math.abs(row.top! - exact) < 0.15, `${row.key}: top ${row.top} vs exact ${exact}`)
    t.diagnostic(`30 runs, ${row.key} ${row.value}: top ${(row.top! * 100).toFixed(1)}% (exact ${(exact * 100).toFixed(1)}%) in ${JSON.stringify(index(e30).ranks[row.key])}`)
  }

  // 300 runs: finer steps, and the share lands near the exact one
  edge.clear()
  seed = 8
  const many = Array.from({ length: 300 }, () => payload())
  const e300 = await ingest(many)
  await cron(e300)
  const r300 = await placed(e300)
  assert.equal(r300.runs, 300)
  for (const row of r300.rows) {
    const exact = many.filter((r) => r[row.key] >= row.value).length / many.length
    assert.ok(row.top != null, `${row.key} is placed`)
    // right up to the step it falls in: off by at most that step's share of runs
    const dist = index(e300).ranks[row.key]
    const step = Object.entries<number>(dist).find(([b]) => holds(b, row.value))!
    assert.ok(Math.abs(row.top! - exact) <= step[1] / 300 + 1 / 300, `${row.key}: top ${row.top!.toFixed(3)} vs exact ${exact.toFixed(3)} (step ${step[0]}: ${step[1]} runs)`)
    t.diagnostic(`${row.key} ${row.value}: top ${(row.top! * 100).toFixed(1)}% (exact ${(exact * 100).toFixed(1)}%, step ${step[0]} of ${Object.keys(dist).length})`)
  }
})

test('f3: a month of counters is one statement up to ~1 MB of JSON, and splits past it, still in one transaction', async (t) => {
  // not valid payloads (the consumer trusts what the fetch handler let in), just many keys:
  // each row reports its own repo_files keys, so no counter is shared
  const wide = (keys: number) =>
    Array.from({ length: 100 }, (_, r) => ({ prompts: 1000 + r, repo_files: Object.fromEntries(Array.from({ length: keys }, (_, i) => [`row${r}-size-bucket-${i}`, 1 + (i % 7)])) }))

  const e = makeEnv()
  const some = wide(80) // 8,000+ counters, a few hundred KB
  await flush(e, some.map((stats) => ({ month: THIS_MONTH, stats })))
  t.diagnostic(`${Object.keys(refCounts(some)).length} counters: ${e.d1.log.statements} statement, ${e.d1.log.maxValueBytes} bytes of JSON`)
  assert.ok(e.d1.log.maxValueBytes > 300_000, `${e.d1.log.maxValueBytes} bytes`)
  assert.equal(e.d1.log.statements, 1)
  assert.deepEqual(dbCounts(e, THIS_MONTH), refCounts(some))

  const f = makeEnv()
  const lots = wide(400) // 40,000+ counters, about 1.8 MB
  await flush(f, lots.map((stats) => ({ month: THIS_MONTH, stats })))
  t.diagnostic(`${Object.keys(refCounts(lots)).length} counters: ${f.d1.log.statements} statements, at most ${f.d1.log.maxValueBytes} bytes of JSON each`)
  assert.ok(f.d1.log.statements > 1 && f.d1.log.statements <= 4)
  assert.deepEqual(f.d1.log.batches, [f.d1.log.statements], 'all in one batch')
  assert.ok(f.d1.log.maxValueBytes <= 1_000_000)
  assert.deepEqual(dbCounts(f, THIS_MONTH), refCounts(lots))
})

test('h: a published index only changes once 25 more runs are in, so no two snapshots single out a run', async () => {
  edge.clear()
  seed = 21
  const e = makeEnv()
  const rows: any[] = []
  /** every index KV held, in order, with how many runs had arrived when it was written */
  const snaps: { text: string; idx: any; arrived: number }[] = []
  // runs trickle in, 1 to 6 at a time, with the cron after each
  while (rows.length < 200) {
    const more = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => payload({ repo: rnd() < 0.3, os: rnd() < 0.2 ? 'linux' : 'darwin' }))
    rows.push(...more)
    await ingest(more, e)
    const writes = e.kvWrites.n
    await cron(e)
    const text = e.kv.get('index')!
    if (text !== snaps.at(-1)?.text) snaps.push({ text, idx: JSON.parse(text), arrived: rows.length })
    else assert.equal(e.kvWrites.n, writes, 'an unchanged index is not written again')
  }
  const pub = snaps.filter((s) => s.idx.published)
  assert.ok(pub.length >= 5, `${pub.length} published snapshots`)
  // before the first, only placeholders: a run count and nothing else
  for (const s of snaps.slice(0, snaps.indexOf(pub[0]))) {
    assert.ok(s.idx.runs < K)
    for (const f of ['median', 'dist', 'totals', 'quantiles', 'enums', 'maps', 'ranks']) assert.deepEqual(s.idx[f], {}, f)
  }
  assert.ok(pub[0].idx.runs >= K, 'the first index for a month needs K runs')
  for (let i = 1; i < pub.length; i++) {
    const [a, b] = [pub[i - 1].idx, pub[i].idx]
    assert.ok(b.runs - a.runs >= K, `snapshot ${i}: ${a.runs} → ${b.runs} runs`)
    // and it shows: every field each run sends moves by those K or more runs, never by one
    const sum = (d: Record<string, number>) => Object.values(d).reduce((x, y) => x + y, 0)
    for (const f of Object.keys(a.dist).filter((f) => !(REPO_FIELDS as readonly string[]).includes(f))) assert.equal(sum(b.dist[f]) - sum(a.dist[f]), b.runs - a.runs, f)
    assert.ok(snaps.indexOf(pub[i]) === snaps.indexOf(pub[i - 1]) + 1, 'no placeholder between two published indexes')
  }
  // each one is exactly the index of the runs in by then, and private on its own
  for (const s of pub) {
    assert.equal(s.idx.runs, s.arrived)
    const these = rows.slice(0, s.arrived)
    assert.deepEqual(s.idx.dist, aggregate(these, K).dist)
    assertKAnon(s.idx, these)
  }
  // the record beside it says what's up
  const meta = JSON.parse(e.kv.get('index:meta')!)
  assert.deepEqual(meta, { month: THIS_MONTH, runs: pub.at(-1)!.idx.runs, published: { [THIS_MONTH]: pub.at(-1)!.idx.runs } })
  // what GET /v1/index serves is the last published snapshot
  edge.clear()
  assert.deepEqual(await (await call(e, '/v1/index')).json(), pub.at(-1)!.idx)

  // a new month: its first index waits for K of its own runs, and the last month's stays up
  const g = makeEnv()
  await flush(g, Array.from({ length: 40 }, () => ({ month: monthsAgo(1), stats: payload() })))
  await cron(g)
  const last = g.kv.get('index')
  for (let n = 0; n < K - 1; n++) {
    await flush(g, [{ month: THIS_MONTH, stats: payload() }])
    await cron(g)
    assert.equal(g.kv.get('index'), last, `${n + 1} runs this month: last month's index stays`)
  }
  await flush(g, [{ month: THIS_MONTH, stats: payload() }])
  await cron(g)
  assert.equal(index(g).month, THIS_MONTH)
  assert.equal(index(g).runs, K)
  // late runs for last month never republish it once this month is up
  await flush(g, Array.from({ length: 60 }, () => ({ month: monthsAgo(1), stats: payload() })))
  await cron(g)
  assert.equal(index(g).month, THIS_MONTH)
  assert.equal(index(g).runs, K)
})

test('h2: the first cron after this deploy reads the last index off the index itself', async () => {
  // KV as the cron before this one left it: an index published at 30 runs, no record beside it
  const e = await ingest(Array.from({ length: 30 }, () => payload()))
  await cron(e)
  e.kv.delete('index:meta')
  const before = e.kv.get('index')
  await ingest([payload()], e)
  await cron(e)
  assert.equal(e.kv.get('index'), before, '31 runs: the 30-run index stays')
  await ingest(Array.from({ length: K - 2 }, () => payload()), e)
  await cron(e)
  assert.equal(index(e).runs, 30, '54 runs: still')
  await ingest([payload()], e)
  await cron(e)
  assert.equal(index(e).runs, 55)
  assert.deepEqual(JSON.parse(e.kv.get('index:meta')!).published, { [THIS_MONTH]: 55 })

  // a placeholder the old cron left is a starting point too, and K runs still publish
  const f = await ingest(Array.from({ length: 10 }, () => payload()))
  await cron(f)
  f.kv.delete('index:meta')
  await ingest(Array.from({ length: 15 }, () => payload()), f)
  await cron(f)
  assert.equal(index(f).published, true)
  assert.equal(index(f).runs, 25)
})

test('i: the cron finds months by primary key, looks back 13 months, and reads counters only to publish', async () => {
  const e = makeEnv()
  // a thin month each of the last 13, and a full one just past them
  for (let i = 0; i < WINDOW; i++) await flush(e, Array.from({ length: 3 }, () => ({ month: monthsAgo(i), stats: payload() })))
  await flush(e, Array.from({ length: 40 }, () => ({ month: monthsAgo(WINDOW), stats: payload() })))
  const from = e.d1.log.sql.length
  await cron(e)
  const sql = e.d1.log.sql.slice(from)
  assert.equal(sql.length, 1, 'one query when nothing is published')
  assert.equal(index(e).month, THIS_MONTH, `not ${monthsAgo(WINDOW)}, whose raw rows are gone`)
  assert.equal(index(e).published, false)
  assert.equal(index(e).runs, 3)

  // a full month inside the window is published; that takes the counters, by month
  await flush(e, Array.from({ length: 30 }, () => ({ month: monthsAgo(5), stats: payload() })))
  const from2 = e.d1.log.sql.length
  await cron(e)
  assert.equal(index(e).month, monthsAgo(5))
  assert.equal(index(e).runs, 33)
  const sql2 = e.d1.log.sql.slice(from2)
  assert.equal(sql2.length, 2)
  // neither query scans the table: the months by (month, k), the counters by month
  for (const q of [...sql, ...sql2]) {
    const plan = (e.d1.db.prepare(`EXPLAIN QUERY PLAN ${q}`).all() as any[]).map((r) => r.detail).join('; ')
    assert.ok(/SEARCH counts USING (COVERING )?INDEX sqlite_autoindex_counts_1 \(month=\?/.test(plan) && !/SCAN counts/.test(plan), `${q}: ${plan}`)
  }

  // nothing new: one point-lookup query, no KV writes
  const [q0, w0] = [e.d1.log.sql.length, e.kvWrites.n]
  await cron(e)
  assert.equal(e.d1.log.sql.length - q0, 1)
  assert.equal(e.kvWrites.n, w0)

  // the months it looks at, across a year end
  const months = Array.from({ length: WINDOW }, (_, i) => monthsAgo(i, new Date('2027-02-15T00:00:00Z')))
  assert.deepEqual([months[0], months[1], months[2], months.at(-1)], ['2027-02', '2027-01', '2026-12', '2026-02'])
})
