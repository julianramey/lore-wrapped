import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import type { Example } from '../src/report-types.ts'
import type { ThreadRecord } from '../src/types.ts'

// this test's own LORE_HOME and temp folder, set before lore's modules read them
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'lore-sec-')))
const HOME = (process.env.LORE_HOME = path.join(tmp, 'home'))
const TEMP = path.join(tmp, 'temp')
fs.mkdirSync(TEMP)
process.env.TMPDIR = process.env.TEMP = process.env.TMP = TEMP
const posix = process.platform !== 'win32'

// what 0.4.0 left behind: an open folder, open files
const old = [path.join(HOME, 'state.json'), path.join(HOME, 'cache', 'threads-v14', 'x.json')]
fs.mkdirSync(path.dirname(old[1]), { recursive: true })
for (const f of old) fs.writeFileSync(f, '{}')
for (const d of [HOME, path.join(HOME, 'cache'), path.dirname(old[1])]) fs.chmodSync(d, 0o755)
for (const f of old) fs.chmodSync(f, 0o644)

const { startServer } = await import('../src/server/local.ts')
const { buildReport } = await import('../src/pipeline/facts.ts')
const { ledgerFromThreads, scan } = await import('../src/pipeline/scan.ts')
const { saveConfig, writeState } = await import('../src/config.ts')
const { measured } = await import('../src/pipeline/receipts.ts')
const { writeNarrative } = await import('../src/pipeline/analysis.ts')
const { callModel } = await import('../src/pipeline/llm.ts')
const { git } = await import('../src/pipeline/git.ts')

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

test('the report page carries no secret; the printed link signs in one browser, once', async () => {
  const webDir = path.join(tmp, 'web')
  fs.mkdirSync(webDir)
  fs.copyFileSync(new URL('../web/index.html', import.meta.url), path.join(webDir, 'index.html'))
  const srv = await startServer({ report: report(), classified: [], cfg: { endpoint: '', ai: false, offline: true } as any, stats: {} as any, webDir })
  try {
    const link = new URL(srv.url)
    const code = new URLSearchParams(link.hash.slice(1)).get('k')!
    assert.ok(code.length >= 24)
    const at = (p: string, init: RequestInit = {}) => fetch(new URL(p, link), init)
    const signIn = (body: object, cookie = '') => at('/api/session', { method: 'POST', body: JSON.stringify(body), headers: cookie ? { cookie } : {} })

    // anyone on the machine can load the page: it has nothing to steal
    const page = await (await at('/')).text()
    assert.match(page, /<div id="app">/)
    assert.ok(!page.includes(code) && !page.includes('__LORE'))
    assert.equal((await at('/api/report')).status, 403)
    assert.equal((await at('/api/evidence?thread=x')).status, 403)
    assert.equal((await signIn({ code: 'guess' })).status, 403)

    const first = await signIn({ code })
    assert.equal(first.status, 200)
    const set = first.headers.get('set-cookie')!
    assert.match(set, /^lore_\d+=[\w-]{40,}; HttpOnly; SameSite=Strict; Path=\/$/)
    const cookie = set.split(';')[0]
    assert.equal((await at('/api/report', { headers: { cookie } })).status, 200, 'and every reload after')

    // a second browser with the same link is turned away; the first, opening it again, isn't
    const second = await signIn({ code })
    assert.equal(second.status, 403)
    assert.equal((await second.json()).error, 'This link was already used. Run lore again for a fresh one.')
    assert.equal((await signIn({ code }, cookie)).status, 200)

    // a page on another origin, another port of 127.0.0.1 included, can't use the cookie
    assert.equal((await at('/api/report', { headers: { cookie, origin: 'http://127.0.0.1:1' } })).status, 403)
    assert.equal((await at('/api/report', { headers: { cookie, origin: link.origin } })).status, 200)
  } finally {
    srv.close()
  }
})

test('the story: secrets out of every quote, a new private folder per call, removed after', async () => {
  // a stand-in `claude` on PATH that records what it was given
  const bin = path.join(tmp, 'bin')
  fs.mkdirSync(bin)
  const fake = path.join(bin, 'fake-claude.cjs')
  fs.writeFileSync(
    fake,
    `const fs = require('node:fs')
const args = process.argv.slice(2)
if (args[0] === 'auth') console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }))
else {
  let prompt = ''
  process.stdin.on('data', (d) => (prompt += d)).on('end', () => {
    const mode = (p) => fs.statSync(p).mode & 0o777
    const sys = args[args.indexOf('--system-prompt-file') + 1]
    fs.appendFileSync(process.env.LORE_FAKE_LOG, JSON.stringify({ cwd: process.cwd(), cwdMode: mode('.'), sysMode: mode(sys), prompt }) + '\\n')
    if (process.env.LORE_FAKE_FAIL) process.exit(1)
    const result = JSON.stringify({ headline: 'You steer early', dek: 'A dek.', paragraphs: [{ text: 'A paragraph.', cites: ['e1'] }], observations: [] })
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, usage: { input_tokens: 10, output_tokens: 5 }, modelUsage: { 'claude-haiku-4-5': {} } }))
  })
}
`,
  )
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'claude.cmd'), '@"%~dp0\\fake-claude.cjs" %*\r\n')
  const PATH = process.env.PATH
  process.env.PATH = bin + path.delimiter + PATH
  const log = (process.env.LORE_FAKE_LOG = path.join(tmp, 'calls.jsonl'))
  // the fixed folder 0.4.0 used, planted as a link to someone else's: it must not be touched
  const planted = path.join(tmp, 'planted')
  fs.mkdirSync(planted)
  fs.symlinkSync(planted, path.join(TEMP, 'lore-analysis'), 'junction')

  const r = report()
  const quote = (text: string, at: number): Example => ({ ref: { thread: `claude-code:t${at}`, ev: 0 }, text, project: 'alpha', at: Date.UTC(2026, 0, 1 + at), source: 'claude-code', safe: true })
  for (const p of r.projects) p.asks = []
  r.steering.examples = []
  r.steering.themes = []
  r.projects[0].asks = [quote('deploy it with sk-ant-api03-Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh, then email ops@acme.io the log from /Users/sam/acme/deploy.log', 1)]
  r.phrases = [{ text: 'ping me at sam@example.com', threads: 3, count: 4, safe: true, example: quote('ping me at sam@example.com', 2) }]
  try {
    await writeNarrative(r, 'claude')
    await writeNarrative(r, 'claude', 'roast')
    process.env.LORE_FAKE_FAIL = '1'
    await assert.rejects(callModel('claude', 'system', 'prompt', {}), /no result/)
  } finally {
    process.env.PATH = PATH
    delete process.env.LORE_FAKE_FAIL
  }

  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(calls.length, 3)
  for (const c of calls.slice(0, 2)) {
    assert.doesNotMatch(c.prompt, /sk-ant-|ops@acme\.io|sam@example\.com|\/Users\/sam/)
    assert.match(c.prompt, /deploy it with \[secret\], then email \[email\] the log from \[path \.log\]/)
    assert.match(c.prompt, /ping me at \[email\]/)
    assert.match(c.prompt, /"name": "alpha"/, 'project names stay')
  }
  for (const c of calls) {
    assert.equal(path.dirname(c.cwd), TEMP)
    assert.match(path.basename(c.cwd), /^lore-\w{6}$/)
    if (posix) assert.deepEqual([c.cwdMode, c.sysMode], [0o700, 0o600])
    assert.ok(!fs.existsSync(c.cwd), 'removed after, a failed call too')
  }
  assert.equal(new Set(calls.map((c) => c.cwd)).size, 3, 'never reused')
  assert.deepEqual(fs.readdirSync(planted), [], 'nothing written through the planted link')
  assert.deepEqual(fs.readdirSync(TEMP), ['lore-analysis'])
})

test('repo reads never fetch: a partial clone stays partial', async () => {
  const sh = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.test', ...args], { cwd, stdio: 'pipe' }).toString()
  const origin = path.join(tmp, 'origin')
  fs.mkdirSync(origin)
  sh(origin, 'init', '-q')
  fs.writeFileSync(path.join(origin, 'a.txt'), 'hello')
  sh(origin, 'add', '.')
  sh(origin, 'commit', '-qm', 'one')
  sh(origin, 'config', 'uploadpack.allowFilter', 'true')
  const clone = path.join(tmp, 'clone')
  sh(tmp, 'clone', '-q', '--filter=blob:none', '--no-checkout', pathToFileURL(origin).href, clone)
  assert.equal(await git(clone, ['cat-file', '-p', 'HEAD:a.txt']), null, 'lore’s read leaves the missing file missing')
  assert.equal(sh(clone, 'cat-file', '-p', 'HEAD:a.txt'), 'hello', 'where plain git fetches it')
})

// last: every write above has landed by now
test('lore’s folder is this user’s alone: folders 0700, files 0600, and 0.4.0’s tightened', { skip: !posix && 'POSIX modes' }, async () => {
  const claude = path.join(tmp, '.claude')
  fs.mkdirSync(path.join(claude, 'projects', 'p'), { recursive: true })
  fs.writeFileSync(path.join(claude, 'projects', 'p', 'S.jsonl'), JSON.stringify({ sessionId: 'S', cwd: '/p', type: 'user', uuid: 'u', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: 'hi' } }) + '\n')
  await scan({ workerUrl: null, roots: { claude: [{ dir: claude, where: '' }], codex: [], gemini: [], pi: [], openclaw: [], opencode: [], kilo: [], qwen: [], copilot: [], claudeDesktop: [] } })
  writeState({ runs: [] })
  saveConfig({ stats: false })
  await measured('narrative', 'claude', async () => ({ usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }, ms: 1, model: 'm', calls: 1, windows: [] }))

  const seen: string[] = []
  const walk = (p: string) => {
    const mode = fs.statSync(p).mode
    seen.push(path.relative(HOME, p))
    // umask can only take bits away: nothing for group or others is the rule either way
    assert.equal(mode & 0o077, 0, `${p} is ${(mode & 0o777).toString(8)}`)
    if (fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p)) walk(path.join(p, f))
  }
  walk(HOME)
  for (const f of ['state.json', 'config.json', 'runs.jsonl', 'analysis', 'cache']) assert.ok(seen.includes(f), f)
  assert.ok(seen.some((f) => /^cache[\\/]threads-v\d+[\\/]\w+\.json$/.test(f) && !f.includes('v14')), 'a cache file from this scan')
  assert.ok(seen.some((f) => /^analysis[\\/]narrative-/.test(f)), 'a story')
  // chmod isn't subject to umask: what 0.4.0 left is exactly 0600 and 0700 now
  for (const f of old) assert.equal(fs.statSync(f).mode & 0o777, 0o600)
  assert.equal(fs.statSync(HOME).mode & 0o777, 0o700)
  fs.rmSync(tmp, { recursive: true, force: true })
})
