// Bounded model calls through the person's own signed-in CLI, only when it's signed in to a
// Claude or ChatGPT plan: API keys are stripped from its environment and an API-key sign-in
// is refused, so a call is never billed per token. One fixed operation, nothing persisted as
// a new session. Claude runs with tools off; Codex can't turn its shell off, so it runs
// read-only in an empty folder with its apps, plugins and browser off.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { VERSION } from '../config.ts'
import { codexHome } from '../sources/codex.ts'
import { killTree, resolveBin, spawnBin } from '../util/bins.ts'

export type ProviderId = 'claude' | 'codex'

export interface Provider {
  id: ProviderId
  label: string
  available: boolean
  model: string
  note: string
  /** Set when the user switched model calls off for this run. */
  off?: string
}

export interface Usage {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  /** Reported by the CLI where available; subscription runs are not billed in dollars. */
  costUsd?: number
}

/** A subscription quota window as the provider reports it, 0–100 percent used. */
export interface PlanWindow {
  name: string
  before: number | null
  after: number | null
}

export interface LlmResult<T> {
  provider: ProviderId
  model: string
  data: T
  usage: Usage
  ms: number
  /** Claude reports its windows during the call (after-values only). */
  windows: PlanWindow[]
}

const onPath = (bin: string) => !!resolveBin(bin)

/** Codex's own catalog names a fast, affordable model; prefer it over the person's default. */
function smallCodexModel(): string {
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(codexHome(), 'models_cache.json'), 'utf8'))
    const listed = (cache.models || []).filter((m: any) => m.visibility === 'list')
    const fast = listed.filter((m: any) => /fast|affordable|efficient/i.test(m.description || '')).sort((a: any, b: any) => a.priority - b.priority)
    if (fast[0]?.slug) return fast[0].slug
  } catch {
    /* fall through to the CLI default */
  }
  return ''
}

export function detectProviders(): Provider[] {
  const claude = onPath('claude')
  const codex = onPath('codex')
  const codexModel = codex ? smallCodexModel() : ''
  return [
    { id: 'claude', label: 'Claude', available: claude, model: 'haiku', note: claude ? 'One call through `claude -p`, only if it’s signed in to a Claude plan (API keys are never used).' : 'Claude Code CLI not found.' },
    { id: 'codex', label: 'Codex', available: codex, model: codexModel || 'default', note: codex ? 'One call through `codex exec`, only if it’s signed in with ChatGPT (API keys are never used).' : 'Codex CLI not found.' },
  ]
}

/** Credentials that would bill per token, or route the call somewhere else: never passed on. */
const KEY_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_API_KEY']
const planEnv = (extra: Record<string, string> = {}) => {
  const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: '1', ...extra }
  for (const k of KEY_ENV) delete env[k]
  return env
}

function run(cmd: string, args: string[], input: string, cwd: string, timeoutMs: number, env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnBin(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: planEnv(env) })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      killTree(child)
      reject(new Error(`${cmd} timed out after ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)
    child.stdout!.on('data', (d) => (stdout += d))
    child.stderr!.on('data', (d) => (stderr += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
    child.stdin!.end(input)
  })
}

function writeTemp(dir: string, name: string, text: string): string {
  const f = path.join(dir, name)
  fs.writeFileSync(f, text)
  return f
}

function workdir(): string {
  // An empty directory: no project instructions, nothing for the model to read.
  const d = path.join(os.tmpdir(), 'lore-analysis')
  fs.mkdirSync(d, { recursive: true })
  return d
}

const signedIn = new Map<ProviderId, Promise<string | null>>()
/** Null when the CLI is signed in to a plan; otherwise why lore won't use it. Checked once per run. */
export function planCheck(provider: ProviderId): Promise<string | null> {
  if (!signedIn.has(provider))
    signedIn.set(
      provider,
      (async () => {
        if (provider === 'claude') {
          const r = await run('claude', ['auth', 'status'], '', os.tmpdir(), 15_000).catch(() => null)
          let st: any = null
          try {
            st = JSON.parse(r?.stdout || '')
          } catch {
            /* an older CLI without auth status */
          }
          if (!st?.loggedIn) return 'Claude Code isn’t signed in. Run `claude auth login` with your Claude account.'
          if (st.authMethod !== 'claude.ai') return 'Claude Code is signed in with an API key or Console account, which bills per token. lore only uses a Claude plan.'
          return null
        }
        const r = await run('codex', ['login', 'status'], '', os.tmpdir(), 15_000).catch(() => null)
        const text = `${r?.stdout || ''}${r?.stderr || ''}`
        if (/using ChatGPT/i.test(text)) return null
        return /api key/i.test(text) ? 'Codex is signed in with an API key, which bills per token. lore only uses a ChatGPT sign-in.' : 'Codex isn’t signed in. Run `codex login` with your ChatGPT account.'
      })(),
    )
  return signedIn.get(provider)!
}

export async function callModel<T>(provider: ProviderId, system: string, prompt: string, schema: object, timeoutMs = 180_000): Promise<LlmResult<T>> {
  const refused = await planCheck(provider)
  if (refused) throw new Error(refused)
  const t0 = Date.now()
  const cwd = workdir()
  if (provider === 'claude') {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--model', 'haiku',
      '--effort', 'low',
      '--tools', '',
      '--no-session-persistence',
      '--strict-mcp-config',
      '--setting-sources', '',
      '--disable-slash-commands',
      // The schema goes in the prompt: --json-schema costs an extra tool-call turn. It goes
      // in a file because Windows caps a command line at 8,191 characters.
      '--system-prompt-file', writeTemp(cwd, 'system.txt', `${system}\n\nReturn only one JSON object, no code fences, matching this JSON Schema:\n${JSON.stringify(schema)}`),
    ]
    // Hidden thinking was most of the output on a short, fixed task; turn it off.
    const r = await run('claude', args, prompt, cwd, timeoutMs, { MAX_THINKING_TOKENS: '0' })
    let out: any = null
    let limits: any = null
    for (const line of r.stdout.split('\n')) {
      if (!line.startsWith('{')) continue
      try {
        const ev = JSON.parse(line)
        if (ev.type === 'result') out = ev
        else if (ev.type === 'rate_limit_event') limits = ev.rate_limit_info?.unifiedWindows || limits
      } catch {
        /* partial line */
      }
    }
    if (!out) throw new Error(`Claude returned no result (exit ${r.code}). ${clipErr(r.stderr || r.stdout)}`)
    if (out.is_error || out.subtype !== 'success') throw new Error(`Claude: ${clipErr(out.result || out.subtype || 'error')}`)
    const data = parseLoose(out.result)
    const u = out.usage || {}
    const model = Object.keys(out.modelUsage || {})[0] || 'haiku'
    const windows: PlanWindow[] = []
    for (const [k, label] of [['five_hour', 'Claude 5-hour window'], ['seven_day', 'Claude weekly window']] as const) {
      const w = limits?.[k]
      if (w && typeof w.utilization === 'number') windows.push({ name: label, before: null, after: Math.round(w.utilization * 1000) / 10 })
    }
    return {
      provider,
      model,
      data,
      usage: {
        inputTokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
        cachedInputTokens: u.cache_read_input_tokens || 0,
        outputTokens: u.output_tokens || 0,
        costUsd: out.total_cost_usd,
      },
      ms: Date.now() - t0,
      windows,
    }
  }

  const schemaFile = path.join(cwd, `schema-${process.pid}-${Date.now()}.json`)
  const outFile = path.join(cwd, `out-${process.pid}-${Date.now()}.json`)
  fs.writeFileSync(schemaFile, JSON.stringify(schema))
  const model = smallCodexModel()
  // `-c features.…` rather than --disable: an unknown name is ignored, not an error, as Codex renames them
  const off = ['apps', 'plugins', 'browser_use', 'browser_use_external', 'computer_use', 'in_app_browser'].flatMap((f) => ['-c', `features.${f}=false`])
  const args = ['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '--json', '--output-schema', schemaFile, '-o', outFile, '-C', cwd, '-c', 'model_reasoning_effort="low"', '-c', 'web_search="disabled"', ...off]
  if (model) args.push('-m', model)
  args.push('-')
  try {
    const r = await run('codex', args, `${system}\n\nDo not run commands or read files; answer only from the text below.\n\n${prompt}`, cwd, timeoutMs)
    let usage: Usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }
    for (const line of r.stdout.split('\n')) {
      if (!line.includes('usage')) continue
      try {
        const ev = JSON.parse(line)
        const u = ev.usage || ev.payload?.usage || ev.msg?.usage
        if (u) usage = { inputTokens: u.input_tokens || 0, cachedInputTokens: u.cached_input_tokens || 0, outputTokens: u.output_tokens || 0 } // already includes reasoning
      } catch {
        /* non-JSON progress line */
      }
    }
    if (!fs.existsSync(outFile)) throw new Error(`Codex produced no answer (exit ${r.code}). ${clipErr(r.stderr)}`)
    const data = parseLoose(fs.readFileSync(outFile, 'utf8'))
    return { provider, model: model || 'default', data, usage, ms: Date.now() - t0, windows: [] }
  } finally {
    fs.rmSync(schemaFile, { force: true })
    fs.rmSync(outFile, { force: true })
  }
}

function parseLoose(s: string): any {
  if (typeof s !== 'string') return s
  const t = s.trim().replace(/^```(?:json)?\s*/, '').replace(/```$/, '')
  try {
    return JSON.parse(t)
  } catch {
    const m = t.match(/\{[\s\S]*\}/)
    if (m) return JSON.parse(m[0])
    throw new Error('Model output was not JSON')
  }
}

const clipErr = (s: string) => String(s).replace(/\s+/g, ' ').trim().slice(0, 300)

/**
 * Reads the Codex plan window through the app-server, the supported route for
 * quota. Called before and after a run so the receipt shows what it cost.
 */
export function readCodexLimits(timeoutMs = 8000): Promise<{ used: number; windowMins: number; plan: string | null } | null> {
  return new Promise((resolve) => {
    let done = false
    let buf = ''
    let child: ReturnType<typeof spawnBin>
    try {
      child = spawnBin('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] })
    } catch {
      return resolve(null)
    }
    const finish = (v: { used: number; windowMins: number; plan: string | null } | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      child.kill()
      resolve(v)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    child.on('error', () => finish(null))
    child.stdout!.on('data', (d) => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        try {
          const o = JSON.parse(line)
          if (o.id === 1) {
            child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n')
            child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read' }) + '\n')
          } else if (o.id === 2) {
            const p = o.result?.rateLimits?.primary
            finish(p ? { used: p.usedPercent, windowMins: p.windowDurationMins, plan: o.result.rateLimits.planType ?? null } : null)
          }
        } catch {
          /* notification or partial line */
        }
      }
    })
    child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'lore', version: VERSION } } }) + '\n')
  })
}
