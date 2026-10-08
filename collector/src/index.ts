// lore's collector on Cloudflare: takes anonymous stats, serves the public index built from
// them, keeps the get-paid waitlist. Nothing else.
//
//   POST /v1/stats            validated against lore's own allowlist, queued, never logged
//   GET  /v1/index            the index, rebuilt every ten minutes from counters, cached
//   POST /v1/waitlist         an email, in its own table
//   POST /v1/waitlist/remove  takes an email off it
//
// No IP is stored: the rate limiter reads it at the edge and lore keeps nothing of it. Rows
// keep the month they arrived, not the time. Raw rows go to R2 for 13 months; the index
// itself comes from counters, so it never reads rows back. A refused payload isn't kept:
// it only adds one to a count of refusals by month and the first field that failed.
//
// Sized for the Workers free plan: one D1 statement per month per queue batch (50 queries
// an invocation), point lookups for the cron (no table scans), and the index's KV keys
// written only when the index changes.

import { aggregateCounts, countRow } from '../../src/pipeline/indexAgg.ts'
import { MAX_BODY, RANKED, rejectReason, STATS_SCHEMA, validateStats } from '../../src/pipeline/stats.ts'

interface Env {
  DB: D1Database
  STATS: Queue<{ month: string; stats: unknown }>
  RAW: R2Bucket
  INDEX: KVNamespace
  LIMIT: RateLimit
}

/** Runs a slice needs before it's shown, and new runs a month needs before its index changes. */
const K = 25
/** Months raw rows are kept, and so the months the cron looks at. */
const WINDOW = 13
/** Bytes of [key, n] JSON per counters statement: half D1's 2 MB cap on a value, several times a full batch. */
const MAX_JSON = 1_000_000
const month = () => new Date().toISOString().slice(0, 7)
/** This month and the n - 1 before it, newest first: "2026-10", "2026-09", … */
const lastMonths = (n: number, now = new Date()) =>
  Array.from({ length: n }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7))
const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } })
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' }

const tooLarge = () => Object.assign(new Error('too large'), { status: 413 })

/** The body as JSON, counted in bytes ("€" is three) and never read past MAX_BODY. */
async function body(req: Request): Promise<any> {
  if (Number(req.headers.get('content-length')) > MAX_BODY) throw tooLarge()
  const buf = new Uint8Array(MAX_BODY)
  let size = 0
  const reader = req.body?.getReader()
  while (reader) {
    const { done, value } = await reader.read()
    if (done) break
    if (size + value.byteLength > MAX_BODY) {
      await reader.cancel()
      throw tooLarge()
    }
    buf.set(value, size)
    size += value.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(buf.subarray(0, size)))
  } catch {
    throw Object.assign(new Error('bad json'), { status: 400 })
  }
}

/**
 * One more refusal of this kind this month, after the reply: a field name (rejectReason), never
 * the payload or the request. A failed write (the table not made yet) changes nothing.
 */
const REJECT = 'INSERT INTO rejects (month, reason, n) VALUES (?1, ?2, 1) ON CONFLICT(month, reason) DO UPDATE SET n = n + 1'
const reject = (env: Env, ctx: ExecutionContext, reason: string) =>
  ctx.waitUntil(env.DB.prepare(REJECT).bind(month(), reason).run().catch(() => {}))

/** One request per IP every few seconds is plenty for one payload per run; the IP isn't kept. */
async function limited(req: Request, env: Env) {
  const ip = req.headers.get('cf-connecting-ip') || 'unknown'
  const { success } = await env.LIMIT.limit({ key: ip })
  return !success
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)
    try {
      if (url.pathname.startsWith('/v1/waitlist') && req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

      if (req.method === 'GET' && url.pathname === '/v1/health') return json({ ok: true })

      if (req.method === 'GET' && url.pathname === '/v1/index') {
        const cache = caches.default
        const hit = await cache.match(req)
        if (hit) return hit
        const idx = (await env.INDEX.get('index')) || JSON.stringify({ minimumPerSlice: K, published: false, runs: 0 })
        const res = new Response(idx, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } })
        ctx.waitUntil(cache.put(req, res.clone()))
        return res
      }

      if (req.method === 'POST' && url.pathname === '/v1/stats') {
        if (await limited(req, env)) return json({ error: 'slow down' }, 429)
        const stats = await body(req).catch((e) => {
          if (e?.status) reject(env, ctx, rejectReason([e.message]))
          throw e
        })
        const errs = validateStats(stats)
        if (errs.length) {
          reject(env, ctx, rejectReason(errs))
          return json({ error: errs }, 400)
        }
        await env.STATS.send({ month: month(), stats })
        return json({ ok: true }, 202)
      }

      if (req.method === 'POST' && (url.pathname === '/v1/waitlist' || url.pathname === '/v1/waitlist/remove')) {
        if (await limited(req, env)) return json({ error: 'slow down' }, 429, cors)
        const b = await body(req)
        const email = typeof b?.email === 'string' && b.email.length <= 254 && EMAIL.test(b.email.trim()) ? b.email.trim().toLowerCase() : null
        if (!email) return json({ error: 'bad email' }, 400, cors)
        if (url.pathname.endsWith('/remove')) await env.DB.prepare('DELETE FROM waitlist WHERE email = ?').bind(email).run()
        else
          // team is a retired column (NOT NULL in the live table), so it's always 0
          await env.DB.prepare('INSERT INTO waitlist (email, team, day) VALUES (?, 0, ?) ON CONFLICT(email) DO NOTHING')
            .bind(email, new Date().toISOString().slice(0, 10))
            .run()
        return json({ ok: true }, url.pathname.endsWith('/remove') ? 200 : 201, cors)
      }

      return json({ error: 'not found' }, 404)
    } catch (e: any) {
      return json({ error: e?.status ? e.message : 'error' }, e?.status || 500)
    }
  },

  /**
   * A batch of stats: raw rows to R2 (kept 13 months), then every counter they add to. All
   * counters go in one D1 batch, which commits as one transaction: if anything fails, the
   * queue retries the whole batch and no row is counted twice (a batch spanning two months
   * used to commit the first month before the second could fail). A retried batch writes its
   * raw rows to the same keys, named by a hash of its message ids, instead of adding copies.
   */
  async queue(batch: MessageBatch<{ month: string; stats: unknown }>, env: Env) {
    const byMonth = new Map<string, { ids: string[]; rows: unknown[]; counts: Map<string, number> }>()
    for (const m of batch.messages) {
      const { month: mo, stats } = m.body
      const g = byMonth.get(mo) || { ids: [] as string[], rows: [] as unknown[], counts: new Map<string, number>() }
      g.ids.push(m.id)
      g.rows.push(stats)
      countRow(g.counts, stats)
      byMonth.set(mo, g)
    }
    const stmts: D1PreparedStatement[] = []
    for (const [mo, g] of byMonth) {
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(g.ids.sort().join('\n'))))
      const name = [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
      await env.RAW.put(`raw/${mo}/${name}.jsonl`, g.rows.map((r) => JSON.stringify({ month: mo, stats: r })).join('\n') + '\n')
      for (const pairs of counterLists([...g.counts])) stmts.push(env.DB.prepare(ADD_COUNTS).bind(mo, pairs))
    }
    if (stmts.length) await env.DB.batch(stmts)
    batch.ackAll()
  },

  /**
   * Every ten minutes: the index for the latest month with enough runs, from its counters.
   *
   * The index is exact, so two snapshots a single run apart would show that run's steps and
   * answers. A month's published index only changes once K more runs have come in since the
   * last one; until then the last one stays. The first index for a month needs K runs too.
   */
  async scheduled(_event: ScheduledController, env: Env) {
    // point lookups on the primary key, one per month rows are kept for; never a table scan
    const months = lastMonths(WINDOW)
    const found = await env.DB.prepare(`SELECT month, n FROM counts WHERE k = 'n' AND month IN (${months.map(() => '?').join(', ')})`)
      .bind(...months)
      .all<{ month: string; n: number }>()
    const runs = new Map((found.results || []).map((r) => [r.month, r.n]))
    const pick = months.find((m) => (runs.get(m) || 0) >= K) ?? months.find((m) => runs.has(m)) ?? months[0]
    const n = runs.get(pick) || 0

    const meta = await lastIndex(env)
    if (n >= K) {
      const before = meta?.published[pick]
      if (before !== undefined && n - before < K) return
    } else if (meta && meta.month === pick && meta.runs === n && !meta.published[pick]) return

    // under K runs every slice is empty, so the counters aren't read
    let counts = new Map([['n', n]])
    if (n >= K) {
      const rows = await env.DB.prepare('SELECT k, n FROM counts WHERE month = ?').bind(pick).all<{ k: string; n: number }>()
      counts = new Map((rows.results || []).map((r) => [r.k, r.n]))
    }
    const agg = aggregateCounts(counts, K)
    const index = {
      schema: STATS_SCHEMA,
      minimumPerSlice: K,
      published: agg.runs >= K,
      month: pick,
      ...agg,
      ranks: Object.fromEntries(RANKED.filter(({ key }) => agg.dist[key]).map(({ key }) => [key, agg.dist[key]])),
    }
    // the record first: if the index write then fails, the next one waits for K more runs
    // than the record says, which is more than the index that's still up
    const published = Object.fromEntries(Object.entries(meta?.published || {}).filter(([m]) => months.includes(m)))
    if (index.published) published[pick] = agg.runs
    const next: IndexMeta = { month: pick, runs: agg.runs, published }
    await env.INDEX.put('index:meta', JSON.stringify(next))
    await env.INDEX.put('index', JSON.stringify(index))
  },
}

/**
 * Adds a list of [key, n] to a month's counters in one statement, however many there are: D1
 * allows 100 bound values a query, and the free plan 50 queries an invocation, so a batch's
 * counters as rows of values could need a hundred statements. (`WHERE true` tells SQLite the
 * ON CONFLICT is the upsert's, not a join's.)
 */
const ADD_COUNTS = `INSERT INTO counts (month, k, n)
  SELECT ?1, j.value ->> 0, j.value ->> 1 FROM json_each(?2) AS j WHERE true
  ON CONFLICT(month, k) DO UPDATE SET n = n + excluded.n`

/** Counters as JSON lists of [key, n]: one list for any real batch, split in halves past MAX_JSON bytes. */
function counterLists(pairs: [string, number][]): string[] {
  const list = JSON.stringify(pairs)
  if (pairs.length < 2 || new TextEncoder().encode(list).byteLength <= MAX_JSON) return [list]
  const half = pairs.length >> 1
  return [...counterLists(pairs.slice(0, half)), ...counterLists(pairs.slice(half))]
}

/** What the cron last wrote to KV, kept beside the index as 'index:meta'. */
interface IndexMeta {
  /** the month and runs the index in KV shows */
  month: string
  runs: number
  /** month → runs in the last index published for it, for the months still kept */
  published: Record<string, number>
}

/** The last index's record; before there was one, read off the index itself. */
async function lastIndex(env: Env): Promise<IndexMeta | null> {
  const meta = await env.INDEX.get('index:meta')
  if (meta) return JSON.parse(meta)
  const idx = await env.INDEX.get('index')
  if (!idx) return null
  const { month: m, runs, published } = JSON.parse(idx)
  return { month: m, runs, published: published ? { [m]: runs } : {} }
}
