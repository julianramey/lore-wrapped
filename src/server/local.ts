// The local report server. Binds to 127.0.0.1 only. The link lore prints carries a one-time
// code in its fragment (never sent in a request); the page trades it once for an HttpOnly
// session cookie. Every API call needs that cookie, a localhost Host header and no foreign
// Origin, so other users on the machine and other web pages can't reach the report.

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { saveConfig, type LoreConfig } from '../config.ts'
import { cachedNarrative, latestNarrative, writeNarrative, type Narrative, type Tone } from '../pipeline/analysis.ts'
import type { ClassifiedThread } from '../pipeline/classify.ts'
import { detectProviders, type ProviderId } from '../pipeline/llm.ts'
import { host, launch, revealCommand } from '../util/platform.ts'
import { measured, recentReceipts } from '../pipeline/receipts.ts'
import { buildStats, RANKED, topShare } from '../pipeline/stats.ts'
import { keepClaudeHistory } from '../sources/claudeStats.ts'
import { repoShape } from '../pipeline/supply.ts'
import { sendStatsIfDue, statsStatus, type StatsStatus } from '../pipeline/upload.ts'
import { evidenceView } from '../pipeline/evidence.ts'
import type { Report } from '../report-types.ts'
import type { ThreadRecord } from '../types.ts'

/** One total budget of model calls per run. */
export const MODEL_CALL_BUDGET = 3
/** How long the printed link's code works, if no browser used it yet. */
const CODE_TTL_MS = 10 * 60_000

export interface ServerState {
  report: Report
  classified: ClassifiedThread[]
  cfg: LoreConfig
  stats: StatsStatus
  webDir: string
}

export async function startServer(state: ServerState, port = 0): Promise<{ url: string; close: () => void }> {
  // the printed link's one-time code, and the one browser session it turns into
  const code = crypto.randomBytes(18).toString('base64url')
  const codeExpires = Date.now() + CODE_TTL_MS
  let session = ''
  const threads = new Map<string, ThreadRecord>(state.classified.map((c) => [`${c.thread.source}:${c.thread.id}`, c.thread]))
  const byKey = new Map(state.classified.map((c) => [`${c.thread.source}:${c.thread.id}`, c]))
  const budget = { used: 0, limit: MODEL_CALL_BUDGET, busy: false }
  let narrative: (Narrative & { stale?: boolean }) | null = null
  for (const p of ['claude', 'codex'] as ProviderId[]) narrative = narrative || cachedNarrative(state.report, p)
  // History grows every session, so an exact match is rare. Show the latest recap,
  // labeled as written from older numbers, rather than spending a call on every run.
  if (!narrative) {
    const last = latestNarrative()
    if (last) narrative = { ...last, stale: true }
  }
  let listenPort = 0

  // --no-ai and --offline: the buttons say why, and the routes refuse
  const offWhy = state.cfg.offline ? 'Model calls are off for this run (--offline).' : 'Model calls are off for this run (--no-ai).'
  const providers = () => (state.cfg.ai ? detectProviders() : detectProviders().map((p) => ({ ...p, available: false, note: offWhy, off: offWhy })))
  const needAi = () => {
    if (!state.cfg.ai) throw httpError(403, offWhy)
  }

  const routes: Record<string, (req: http.IncomingMessage, body: any, url: URL) => Promise<any> | any> = {
    'GET /api/report': () => ({
      report: state.report,
      narrative: narrative || null,
      providers: providers(),
      stats: state.stats,
      budget,
      endpoint: state.cfg.endpoint,
      receipts: recentReceipts(),
    }),

    'GET /api/evidence': (_req, _b, url) => {
      const ct = byKey.get(url.searchParams.get('thread') || '')
      if (!ct) throw httpError(404, 'Unknown thread')
      return evidenceView(ct, Number(url.searchParams.get('ev') || 0))
    },

    'POST /api/reveal': (_req, body) => {
      const t = threads.get(String(body?.thread || ''))
      if (!t) throw httpError(404, 'Unknown thread')
      return { ok: launch(revealCommand(t.file, host())) }
    },

    'POST /api/narrative': async (_req, body) => {
      needAi()
      const provider: ProviderId = body?.provider === 'codex' ? 'codex' : 'claude'
      const tone: Tone = body?.tone === 'roast' ? 'roast' : 'recap'
      const cached = cachedNarrative(state.report, provider, tone)
      if (cached) return { narrative: (narrative = cached), receipt: null, budget }
      spend(budget, 1)
      try {
        const { result, receipt } = await measured('narrative', provider, () => writeNarrative(state.report, provider, tone))
        narrative = result
        return { narrative, receipt, budget }
      } finally {
        budget.busy = false
      }
    },

    'GET /api/receipts': () => ({ receipts: recentReceipts(30) }),
    'GET /api/ranks': () => ranks(state.report, state.cfg.endpoint),

    'POST /api/stats/send': async () => {
      state.stats = await sendStatsIfDue(state.report, state.cfg, true)
      return state.stats
    },

    'POST /api/keep-history': () => {
      const res = keepClaudeHistory(365)
      if (state.report.deep.retention) Object.assign(state.report.deep.retention, { retentionDays: 365, configured: true })
      return res
    },
    // the get-paid waitlist, only when someone submits it: the email goes to lore's list, alone
    'POST /api/waitlist': async (_req, body) => {
      const email = typeof body?.email === 'string' ? body.email.trim() : ''
      if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email) || email.length > 254) throw httpError(400, 'That doesn’t look like an email.')
      if (state.cfg.offline) throw httpError(400, 'Offline mode: nothing leaves this machine.')
      if (!state.cfg.endpoint) throw httpError(503, 'The waitlist opens with lore’s public launch.')
      const res = await fetch(`${state.cfg.endpoint}/v1/waitlist`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => null)
      if (!res?.ok) throw httpError(502, 'Couldn’t reach lore’s waitlist. Try again in a minute.')
      return { ok: true }
    },
    // repo stats are computed only once someone turns them on: they read the repos themselves
    'POST /api/stats/repos': async (_req, body) => {
      const on = !!body?.enabled
      state.cfg = { ...state.cfg, repoStats: on }
      try {
        saveConfig({ repoStats: on })
      } catch {
        /* preference still applies to this run */
      }
      state.report.repoShape = on ? await repoShape(state.classified.map((c) => c.thread)) : undefined
      state.stats = statsStatus(state.report, state.cfg)
      return state.stats
    },
    'POST /api/stats/toggle': (_req, body) => {
      state.cfg = { ...state.cfg, stats: !!body?.enabled }
      try {
        saveConfig({ stats: !!body?.enabled })
      } catch {
        /* preference still applies to this run */
      }
      state.stats = statsStatus(state.report, state.cfg)
      return state.stats
    },
  }

  const server = http.createServer(async (req, res) => {
    try {
      const host = String(req.headers.host || '')
      if (host !== `127.0.0.1:${listenPort}` && host !== `localhost:${listenPort}`) return send(res, 421, { error: 'Bad host' })
      const url = new URL(req.url || '/', `http://${host}`)
      if (!url.pathname.startsWith('/api/')) return serveStatic(res, state.webDir, url.pathname)
      // a page on another origin (another port on 127.0.0.1 too) can't act with the cookie
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return send(res, 403, { error: 'Cross-origin request' })
      // named per port, so two runs of lore at once keep their own sessions
      const name = `lore_${listenPort}`
      const signedIn = !!session && String(req.headers.cookie || '').split(/;\s*/).includes(`${name}=${session}`)
      if (req.method === 'POST' && url.pathname === '/api/session') {
        const body = await readBody(req)
        // the same browser opening the link again is already in
        if (!signedIn) {
          if (body?.code !== code) throw httpError(403, 'This link is from another run of lore. Open the latest link it printed.')
          if (session) throw httpError(403, 'This link was already used. Run lore again for a fresh one.')
          if (Date.now() > codeExpires) throw httpError(403, 'This link has expired. Run lore again for a fresh one.')
          session = crypto.randomBytes(32).toString('base64url')
          res.setHeader('set-cookie', `${name}=${session}; HttpOnly; SameSite=Strict; Path=/`)
        }
        return send(res, 200, { ok: true })
      }
      if (!signedIn) return send(res, 403, { error: 'Open the link lore printed in your terminal.' })
      const handler = routes[`${req.method} ${url.pathname}`]
      if (!handler) return send(res, 404, { error: 'Not found' })
      const body = req.method === 'POST' ? await readBody(req) : null
      send(res, 200, await handler(req, body, url))
    } catch (e: any) {
      send(res, e?.status || 500, { error: e?.message || String(e) })
    }
  })

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  listenPort = (server.address() as any).port
  return { url: `http://127.0.0.1:${listenPort}/#k=${code}`, close: () => server.close() }
}

/** Where this run sits in the public index. Reads the aggregate; sends nothing. */
async function ranks(r: Report, endpoint: string) {
  const own = buildStats(r) as unknown as Record<string, number>
  const rows = RANKED.map((m) => ({ key: m.key, label: m.label, value: own[m.key], top: null as number | null }))
  if (!endpoint) return { available: false, runs: 0, rows }
  try {
    const res = await fetch(`${endpoint}/v1/index`, { signal: AbortSignal.timeout(3000) })
    const idx = await res.json()
    for (const row of rows) row.top = idx.ranks?.[row.key] ? topShare(row.value, idx.ranks[row.key]) : null
    return { available: rows.some((x) => x.top != null), runs: Number(idx.runs) || 0, rows }
  } catch {
    return { available: false, runs: 0, rows }
  }
}

function spend(budget: { used: number; limit: number; busy: boolean }, n: number) {
  if (budget.busy) throw httpError(409, 'A model call is already running.')
  if (budget.used + n > budget.limit) throw httpError(429, `This run's model budget is used up (${budget.used}/${budget.limit} calls). Restart lore to run more.`)
  budget.used += n
  budget.busy = true
}

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status })
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(data)
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 2_000_000) {
        reject(httpError(413, 'Body too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(httpError(400, 'Bad JSON'))
      }
    })
  })
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }

function serveStatic(res: http.ServerResponse, dir: string, pathname: string) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const file = path.join(dir, path.normalize(rel))
  if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404)
    return res.end('Not found')
  }
  const ext = path.extname(file)
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'",
    'x-frame-options': 'DENY',
  })
  res.end(fs.readFileSync(file))
}
