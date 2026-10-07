// lore-collector: receives anonymous stats and serves the index built from them, and keeps the
// get-paid waitlist. Nothing else.
//   POST /v1/stats            anonymous aggregate statistics (validated allowlist)
//   GET  /v1/index            the public index
//   POST /v1/waitlist         an email, kept apart from stats
//   POST /v1/waitlist/remove  takes an email off the list
// It never records IP addresses, user agents or exact receive times for stats.
// If you deploy it behind a proxy, turn off that proxy's access logs too.

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { aggregate } from '../pipeline/indexAgg.ts'
import { RANKED, STATS_SCHEMA, validateStats } from '../pipeline/stats.ts'

const MAX_BODY = 16 * 1024 // a stats payload is about 2 KB


function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const port = Number(arg('port', process.env.PORT || '8787'))
const host = arg('host', process.env.HOST || '127.0.0.1')
const dataDir = path.resolve(arg('data', process.env.LORE_COLLECTOR_DATA || './collector-data'))
fs.mkdirSync(dataDir, { recursive: true })

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('too large'), { status: 413 }))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(Object.assign(new Error('bad json'), { status: 400 }))
      }
    })
  })
}

const month = () => new Date().toISOString().slice(0, 7)

/** Minimum contributors before any slice of the public index is published. */
const K = Number(process.env.LORE_INDEX_MIN || 25)

/**
 * The public index: aggregates over anonymous stats, never individual rows. A
 * slice (a model, a type) appears only once at least K runs contribute to it.
 *
 * One month at a time: a machine sends at most once a month, and each payload describes
 * its whole history, so pooling months would count the same history again and again.
 * The latest month with K runs is published; its runs are machines that month, not people.
 */
function buildIndex() {
  const file = path.join(dataDir, 'stats.jsonl')
  const all: { month: string; stats: any }[] = fs.existsSync(file)
    ? fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((r) => r.stats?.schema === STATS_SCHEMA)
    : []
  const months = [...new Set(all.map((r) => r.month))].sort().reverse()
  const pick = months.find((m) => all.filter((r) => r.month === m).length >= K) ?? months[0] ?? month()
  const rows = all.filter((r) => r.month === pick).map((r) => r.stats)
  const agg = aggregate(rows, K)
  return {
    minimumPerSlice: K,
    published: rows.length >= K,
    month: pick,
    ...agg,
    // bucket counts per ranked metric, so a report can place itself (empty until K runs)
    ranks: Object.fromEntries(RANKED.filter(({ key }) => agg.dist[key]).map(({ key }) => [key, agg.dist[key]])),
  }
}

// The waitlist: emails only, in their own file, never joined with stats rows. The day someone
// joined, not the time, so a signup can't be matched to a stats row by when it arrived.
const listFile = path.join(dataDir, 'waitlist.json')
const waitlist: Record<string, { day: string }> = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, 'utf8')) : {}
const saveList = () => fs.writeFileSync(listFile, JSON.stringify(waitlist))
const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/
const emailOf = (b: any) => (typeof b?.email === 'string' && b.email.length <= 254 && EMAIL.test(b.email.trim()) ? b.email.trim().toLowerCase() : null)

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://collector')
    // the website posts the waitlist form from its own origin
    if (url.pathname.startsWith('/v1/waitlist')) {
      res.setHeader('access-control-allow-origin', '*')
      res.setHeader('access-control-allow-headers', 'content-type')
      if (req.method === 'OPTIONS') return send(res, 204, {})
    }
    if (req.method === 'POST' && url.pathname === '/v1/waitlist') {
      const body = await readBody(req)
      const email = emailOf(body)
      if (!email) return send(res, 400, { error: 'bad email' })
      waitlist[email] = { day: new Date().toISOString().slice(0, 10) }
      saveList()
      return send(res, 201, { ok: true })
    }
    if (req.method === 'POST' && url.pathname === '/v1/waitlist/remove') {
      const email = emailOf(await readBody(req))
      if (!email) return send(res, 400, { error: 'bad email' })
      delete waitlist[email]
      saveList()
      return send(res, 200, { ok: true })
    }
    if (req.method === 'GET' && url.pathname === '/v1/health') return send(res, 200, { ok: true })

    if (req.method === 'POST' && url.pathname === '/v1/stats') {
      const body = await readBody(req)
      const errs = validateStats(body)
      if (errs.length) return send(res, 400, { error: errs })
      // Month only: exact receive times could re-identify a run.
      fs.appendFileSync(path.join(dataDir, 'stats.jsonl'), JSON.stringify({ month: month(), stats: body }) + '\n')
      return send(res, 202, { ok: true })
    }

    if (req.method === 'GET' && url.pathname === '/v1/index') {
      res.setHeader('access-control-allow-origin', '*')
      return send(res, 200, buildIndex())
    }

    if (req.method === 'GET' && url.pathname === '/v1/summary') {
      const statsLines = fs.existsSync(path.join(dataDir, 'stats.jsonl')) ? fs.readFileSync(path.join(dataDir, 'stats.jsonl'), 'utf8').split('\n').filter(Boolean).length : 0
      return send(res, 200, { stats: statsLines, waitlist: Object.keys(waitlist).length })
    }

    send(res, 404, { error: 'not found' })
  } catch (e: any) {
    send(res, e?.status || 500, { error: e?.message || 'error' })
  }
})

server.listen(port, host, () => {
  console.log(`lore-collector listening on http://${host}:${port}  (data: ${dataDir})`)
})
