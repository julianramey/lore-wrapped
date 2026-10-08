// Persona simulator: writes realistic agent histories (Claude Code, Codex, Gemini CLI,
// OpenCode, Pi, Copilot CLI, Qwen Code) for very different kinds of people into throwaway
// home folders, runs lore on each one exactly as a user would, and flags anything that reads
// wrong. The formats mirror what the tools write (per-block assistant records with repeated
// usage, token_count events, re-appended Gemini messages, OpenCode's SQLite tables, Copilot's
// running session totals, prompt history, stats-cache, subagents, 30-day cleanup), so the
// adapters get exercised too.
//
//   node scripts/personas.ts                 all personas, summary table
//   node scripts/personas.ts --only newbie   some of them
//   node scripts/personas.ts --out <dir>     where the homes and reports go (default: tmp)

import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildStats, MAX_BODY, NOTICE, OSES, validateStats } from '../src/pipeline/stats.ts'

// ───────────────────────── randomness, seeded per persona

function rng(seed: string) {
  let a = crypto.createHash('sha1').update(seed).digest().readUInt32LE(0)
  const next = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const r = {
    next,
    chance: (p: number) => next() < p,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    /** Log-normal around a median. */
    around: (median: number, spread = 0.6) => median * Math.exp(spread * gauss()),
    weighted: (w: number[]) => {
      const s = w.reduce((x, y) => x + y, 0)
      let u = next() * s
      for (let i = 0; i < w.length; i++) if ((u -= w[i]) <= 0) return i
      return w.length - 1
    },
    id: () => crypto.createHash('sha1').update(String(next())).digest('hex'),
    uuid: () => {
      const h = crypto.createHash('sha1').update(String(next())).digest('hex')
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
    },
  }
  function gauss() {
    return Math.sqrt(-2 * Math.log(next() || 1e-9)) * Math.cos(2 * Math.PI * next())
  }
  return r
}
type Rng = ReturnType<typeof rng>

// ───────────────────────── who

type Lang = 'en' | 'es' | 'zh'
type Os = 'mac' | 'linux' | 'windows'

type Agent = 'claude' | 'codex' | 'gemini' | 'opencode' | 'pi' | 'copilot' | 'qwen'
const SOURCE_OF: Record<Agent, string> = { claude: 'claude-code', codex: 'codex', gemini: 'gemini', opencode: 'opencode', pi: 'pi', copilot: 'copilot', qwen: 'qwen' }
const MODELS: Record<Agent, string[]> = {
  claude: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5'],
  codex: ['gpt-5.6-sol', 'gpt-5.5'],
  gemini: ['gemini-2.5-pro', 'gemini-3.5-flash'],
  opencode: ['anthropic/claude-sonnet-4-5', 'openai/gpt-5.1-codex'],
  pi: ['claude-opus-4-5', 'gpt-5.2'],
  copilot: ['claude-sonnet-4.5', 'gpt-5.1-codex'],
  qwen: ['qwen3-coder-plus'],
}

interface Persona {
  key: string
  label: string
  /** Share of threads in each tool. */
  claude: number
  codex: number
  /** Other agents' shares, next to claude and codex. */
  mix?: Partial<Record<Agent, number>>
  /** History span ending today, in days, and the chance a day in it is active. */
  days: number
  active: number
  perDay: number
  /** Relative weight of each hour of the day. */
  hours: number[]
  weekend: number
  projects: number
  words: number
  steer: number
  approve: number
  swear: number
  please: number
  caps: number
  perThread: number
  agentMin: number
  tools: number
  lang?: Lang
  os?: Os
  /** Claude Code deletes transcripts older than this (its default is 30). */
  retention?: number
  subagents?: number
  automated?: number
  interrupts?: number
  claudeModels?: string[]
  codexModels?: string[]
  /** No history directories at all. */
  empty?: boolean
  /** Prompt history and stats only: every transcript already deleted. */
  historyOnly?: boolean
}

const DAY_HOURS = [0, 0, 0, 0, 0, 0, 0.2, 0.6, 1.4, 2.2, 2.6, 2.4, 1.6, 2.2, 2.6, 2.6, 2.2, 1.6, 0.8, 0.5, 0.4, 0.3, 0.2, 0.1]
const NIGHT_HOURS = [2.2, 2, 1.6, 1, 0.5, 0.2, 0, 0, 0, 0.1, 0.3, 0.6, 0.8, 0.9, 1, 1, 1, 1.2, 1.5, 2, 2.5, 2.8, 3, 2.8]
const EVENING_HOURS = [0.3, 0.1, 0, 0, 0, 0, 0, 0.1, 0.3, 0.4, 0.4, 0.5, 0.6, 0.5, 0.4, 0.4, 0.6, 1, 1.8, 2.6, 2.8, 2.4, 1.6, 0.8]

const base: Omit<Persona, 'key' | 'label'> = {
  claude: 0.5,
  codex: 0.5,
  days: 120,
  active: 0.6,
  perDay: 25,
  hours: DAY_HOURS,
  weekend: 0.4,
  projects: 3,
  words: 18,
  steer: 0.1,
  approve: 0.15,
  swear: 0.01,
  please: 0.04,
  caps: 0.005,
  perThread: 12,
  agentMin: 1.5,
  tools: 3,
}

export const PERSONAS: Persona[] = [
  { ...base, key: 'newbie', label: 'first week, Claude only, 30 prompts', claude: 1, codex: 0, days: 7, active: 0.6, perDay: 7, projects: 1, words: 24, perThread: 5, steer: 0.08, approve: 0.1 },
  { ...base, key: 'typical', label: 'four months, both tools, the priors', days: 120 },
  { ...base, key: 'codex-power', label: 'Codex only, terse, steers a lot, 5 months', claude: 0, codex: 1, days: 150, active: 0.8, perDay: 70, words: 9, steer: 0.22, approve: 0.25, projects: 2, perThread: 30, agentMin: 2.5, codexModels: ['gpt-5.6-sol', 'gpt-5.5', 'gpt-6-astra'] },
  { ...base, key: 'claude-30d', label: 'Claude only for 8 months, default 30-day cleanup', claude: 1, codex: 0, days: 240, active: 0.7, perDay: 40, retention: 30, subagents: 0.15 },
  { ...base, key: 'architect', label: 'long, polite prompts, weekdays only', days: 90, weekend: 0, words: 85, please: 0.45, steer: 0.04, approve: 0.05, perThread: 6, projects: 2, agentMin: 4 },
  { ...base, key: 'volcano', label: 'nights, swears, caps, redirects', hours: NIGHT_HOURS, swear: 0.14, caps: 0.06, steer: 0.28, interrupts: 0.08, words: 11 },
  { ...base, key: 'conductor', label: 'a dozen projects, short sessions', projects: 12, perThread: 4, days: 100, active: 0.7, perDay: 30 },
  { ...base, key: 'marathoner', label: 'a few giant threads', perThread: 180, projects: 1, days: 60, perDay: 60, active: 0.85 },
  { ...base, key: 'autopilot', label: 'hands work off for 15 minutes at a time', agentMin: 15, tools: 25, perDay: 8, approve: 0.4, steer: 0.03, subagents: 0.3 },
  { ...base, key: 'spanish', label: 'writes to agents in Spanish', lang: 'es', steer: 0.15, swear: 0.04 },
  { ...base, key: 'chinese', label: 'writes to agents in Chinese', lang: 'zh', steer: 0.15, swear: 0.03, please: 0.2 },
  { ...base, key: 'windows', label: 'Windows paths, both tools', os: 'windows', hours: EVENING_HOURS },
  { ...base, key: 'linux', label: 'Linux home, Codex mostly', os: 'linux', claude: 0.2, codex: 0.8 },
  { ...base, key: 'automation', label: 'mostly SDK/exec automation, a little by hand', automated: 0.7, perDay: 20 },
  { ...base, key: 'history-only', label: 'every Claude transcript already deleted', claude: 1, codex: 0, historyOnly: true, days: 200 },
  { ...base, key: 'empty', label: 'no agent history at all', empty: true },
  { ...base, key: 'gemini', label: 'Gemini CLI only, three months', claude: 0, codex: 0, mix: { gemini: 1 }, days: 90 },
  { ...base, key: 'opencode', label: 'OpenCode with Claude and GPT through one CLI', claude: 0, codex: 0, mix: { opencode: 1 }, days: 100, steer: 0.14 },
  { ...base, key: 'five-tools', label: 'Claude, Codex, Copilot, Pi and Qwen side by side', claude: 0.35, codex: 0.25, mix: { copilot: 0.15, pi: 0.15, qwen: 0.1 }, projects: 5 },
  { ...base, key: 'model-hopper', label: 'Claude on every new model for a year and a half', claude: 1, codex: 0, days: 540, active: 0.4, perDay: 15, claudeModels: ['claude-3-5-sonnet-20241022', 'claude-3-7-sonnet-20250219', 'claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-opus-4-1-20250805', 'claude-sonnet-4-5-20250929', 'claude-opus-4-5-20251101', 'claude-haiku-4-5-20251001', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-opus-5', 'claude-sonnet-5', 'claude-opus-5-5'] },
  { ...base, key: 'auto-heavy', label: 'SDK and exec jobs every day, a dozen prompts by hand', automated: 0.995, perDay: 30, days: 90, active: 0.9, agentMin: 6, tools: 30 },
  { ...base, key: 'older-models', label: 'Claude on Sonnet 4.5 and Opus 4.1, last year', claude: 1, codex: 0, days: 200, claudeModels: ['claude-sonnet-4-5-20250929', 'claude-opus-4-1-20250805', 'claude-sonnet-4-5-20250929'] },
]

// ───────────────────────── what they say

const NOUNS: Record<Lang, string[]> = {
  en: ['login page', 'checkout flow', 'settings screen', 'API client', 'search bar', 'onboarding', 'dashboard', 'webhook handler', 'pricing table', 'mobile nav', 'auth middleware', 'CSV export', 'cron job', 'image upload'],
  es: ['página de login', 'flujo de pago', 'pantalla de ajustes', 'cliente de la API', 'buscador', 'onboarding', 'panel', 'webhook', 'tabla de precios', 'menú móvil'],
  zh: ['登录页面', '支付流程', '设置页面', 'API 客户端', '搜索框', '仪表盘', '价格表'],
}
const ASKS: Record<Lang, ((n: string) => string)[]> = {
  en: [
    (n) => `the ${n} is broken in prod, users get a blank screen after login. find out why and fix it`,
    (n) => `add pagination to the ${n}, 25 per page, keep the current sort`,
    (n) => `build a ${n} that matches the rest of the app`,
    (n) => `review the ${n} and tell me what you'd change before we launch`,
    (n) => `explain how the ${n} works, I didn't write it`,
    (n) => `make the ${n} look better on mobile, the spacing is off`,
    (n) => `plan how we should restructure the ${n}, don't write code yet`,
    (n) => `write tests for the ${n}`,
  ],
  es: [
    (n) => `la ${n} está rota en producción, arréglala por favor`,
    (n) => `añade paginación a la ${n}, 25 por página`,
    (n) => `construye un ${n} que encaje con el resto de la app`,
    (n) => `revisa el ${n} y dime qué cambiarías`,
    (n) => `explícame cómo funciona el ${n}`,
  ],
  zh: [(n) => `${n}在生产环境报错了，帮我修复`, (n) => `给${n}添加分页，每页25条`, (n) => `创建一个新的${n}`, (n) => `解释一下${n}是怎么工作的`, (n) => `帮我审查一下${n}的代码`],
}
const STEERS: Record<Lang, string[]> = {
  en: ['no, that broke the build', "that's not what I asked for", "actually, don't touch the database layer", 'still not working', 'revert that, the old version was fine', 'why did you change the styles?', "you missed the edge case where the list is empty", 'wait, use the existing helper instead', 'this is too complex, simplify it', 'no, run the tests first and prove it works', 'it still crashes on submit'],
  es: ['no, eso rompió el build', 'eso no es lo que pedí', 'sigue sin funcionar', 'revierte eso', 'esto es demasiado complejo, simplifícalo', 'espera, usa el helper que ya existe'],
  zh: ['不对，构建失败了', '这不是我要的', '还是不行', '撤销刚才的修改', '等等，用现有的函数', '又报错了'],
}
const APPROVALS: Record<Lang, string[]> = {
  en: ['yes', 'continue', 'looks good', 'perfect', 'ok', 'go ahead', 'do it', 'great, ship it', 'yes please'],
  es: ['sí', 'dale', 'perfecto', 'continúa', 'vale', 'genial'],
  zh: ['好的', '继续', '可以', '好', '谢谢', '完美'],
}
const FOLLOWUPS: Record<Lang, ((n: string) => string)[]> = {
  en: [(n) => `now do the same for the ${n}`, () => 'can you also add a loading state?', () => 'what about error handling?', (n) => `next, hook it up to the ${n}`, () => 'add a test for that', () => 'update the readme too'],
  es: [(n) => `ahora haz lo mismo con el ${n}`, () => '¿puedes añadir un estado de carga?', () => '¿y el manejo de errores?'],
  zh: [(n) => `现在对${n}做同样的事`, () => '再加一个加载状态', () => '错误处理呢？'],
}
const SWEARS: Record<Lang, string[]> = { en: ['fuck', 'wtf', 'shit', 'damn'], es: ['joder', 'mierda', 'hostia'], zh: ['卧槽', '妈的'] }
const PROJECT_NAMES = ['orbit', 'kettle', 'saffron', 'ledgerly', 'pinecone-ui', 'tidepool', 'quill', 'fernway', 'basalt', 'marigold', 'cobalt-api', 'harbor', 'nimbus', 'juniper']

/** Pad or trim a prompt toward a target word count with plausible detail. */
function sized(r: Rng, text: string, target: number, lang: Lang): string {
  if (lang === 'zh') return text
  const pad = lang === 'es' ? ['y que funcione en móvil', 'sin romper los tests', 'usa el mismo estilo', 'el usuario no debería notar nada'] : ['and make sure it works on mobile', 'without breaking the existing tests', 'keep the same naming style', 'the user should not notice anything changed', 'check the logs from yesterday for context', 'the design spec is in the figma file']
  const words = text.split(' ')
  while (words.length < target) words.push(...r.pick(pad).split(' '))
  return words.slice(0, Math.max(3, Math.round(target))).join(' ')
}

// ───────────────────────── where

function homeOf(o: Os) {
  return o === 'windows' ? 'C:\\Users\\ana' : o === 'linux' ? '/home/sam' : '/Users/alex'
}
function cwdOf(o: Os, project: string) {
  return o === 'windows' ? `C:\\Users\\ana\\code\\${project}` : o === 'linux' ? `/home/sam/dev/${project}` : `/Users/alex/code/${project}`
}
/** Claude Code's project folder name: every non-alphanumeric becomes a dash. */
const claudeDir = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-')

// ───────────────────────── writing histories

interface Turn {
  t: number
  text: string
  kind: 'ask' | 'steer' | 'approve' | 'followup'
  interrupted: boolean
  agentMs: number
  tools: number
}
interface Thread {
  tool: Agent
  project: string
  cwd: string
  id: string
  model: string
  automated: boolean
  turns: Turn[]
}

function plan(p: Persona, r: Rng, now: number): Thread[] {
  const lang = p.lang || 'en'
  const os2 = p.os || 'mac'
  const projects = PROJECT_NAMES.slice(0, p.projects)
  // a few projects get most of the work
  const pw = projects.map((_, i) => 1 / (i + 1) ** 1.1)
  const threads: Thread[] = []
  let open: Thread | null = null
  let ctxLeft = 0
  const start = now - p.days * 86400e3
  for (let d = 0; d < p.days; d++) {
    const day = new Date(start + d * 86400e3)
    const weekend = day.getDay() === 0 || day.getDay() === 6
    if (!r.chance(p.active * (weekend ? p.weekend : 1))) continue
    let budget = Math.max(1, Math.round(r.around(p.perDay, 0.5)))
    let t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), r.weighted(p.hours), r.int(0, 59)).getTime()
    while (budget > 0 && t < now) {
      if (!open || ctxLeft <= 0 || r.chance(0.08)) {
        const shares: [Agent, number][] = [['claude', p.claude], ['codex', p.codex], ...(Object.entries(p.mix || {}) as [Agent, number][])]
        const tool = shares[r.weighted(shares.map((x) => x[1]))][0]
        const project = projects[r.weighted(pw)]
        open = {
          tool,
          project,
          cwd: cwdOf(os2, project),
          id: r.uuid(),
          model: r.pick(tool === 'claude' ? p.claudeModels || MODELS.claude : tool === 'codex' ? p.codexModels || MODELS.codex : MODELS[tool]),
          automated: r.chance(p.automated || 0),
          turns: [],
        }
        threads.push(open)
        ctxLeft = Math.max(1, Math.round(r.around(p.perThread, 0.7)))
      }
      const first = open.turns.length === 0
      const noun = r.pick(NOUNS[lang])
      let kind: Turn['kind'] = 'ask'
      let text: string
      if (first) text = sized(r, r.pick(ASKS[lang])(noun), r.around(p.words, 0.5), lang)
      else {
        const u = r.next()
        if (u < p.steer) {
          kind = 'steer'
          text = r.pick(STEERS[lang])
        } else if (u < p.steer + p.approve) {
          kind = 'approve'
          text = r.pick(APPROVALS[lang])
        } else {
          kind = 'followup'
          text = sized(r, r.pick(FOLLOWUPS[lang])(noun), r.around(p.words * 0.7, 0.5), lang)
        }
      }
      if (r.chance(p.please)) text = lang === 'es' ? `${text}, por favor` : lang === 'zh' ? `请${text}` : r.chance(0.5) ? `please ${text}` : `${text}, thanks`
      if (r.chance(p.swear)) text = r.chance(0.5) ? `${r.pick(SWEARS[lang])}, ${text}` : `${text} ${r.pick(SWEARS[lang])}`
      if (r.chance(p.caps)) text = text.toUpperCase()
      const agentMs = Math.round(r.around(p.agentMin, 0.8) * 60e3)
      open.turns.push({ t, text, kind, interrupted: kind === 'steer' && r.chance(p.interrupts || 0.02), agentMs, tools: Math.round(r.around(p.tools, 0.7)) })
      t += agentMs + r.around(90, 0.9) * 1000
      budget--
      ctxLeft--
    }
  }
  return threads
}

const iso = (t: number) => new Date(t).toISOString()

interface Usage {
  model: string
  t: number
  fresh: number
  cached: number
  write: number
  out: number
}

function writeClaude(p: Persona, r: Rng, home: string, threads: Thread[], now: number) {
  const root = path.join(home, '.claude')
  const projectsDir = path.join(root, 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  const history: string[] = []
  // Claude Code's stats count every record, repeats included
  const daily = new Map<string, Record<string, number>>()
  const activity = new Map<string, number>()
  const modelUsage: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }> = {}
  const dk = (t: number) => {
    const d = new Date(t)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const lastComputed = dk(now - 2 * 86400e3)
  const countRaw = (u: Usage) => {
    const day = (daily.get(dk(u.t)) || daily.set(dk(u.t), {}).get(dk(u.t)))!
    day[u.model] = (day[u.model] || 0) + u.fresh + u.cached + u.write + u.out
    // like Claude Code, its all-time totals run through the last day it computed
    if (dk(u.t) > lastComputed) return
    const m = (modelUsage[u.model] ||= { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 })
    m.inputTokens += u.fresh
    m.outputTokens += u.out
    m.cacheReadInputTokens += u.cached
    m.cacheCreationInputTokens += u.write
  }
  const cutoff = p.retention ? now - p.retention * 86400e3 : -Infinity
  for (const th of threads.filter((x) => x.tool === 'claude')) {
    const lines: string[] = []
    const common = { cwd: th.cwd, sessionId: th.id, version: '2.3.1', gitBranch: 'main', userType: 'external', entrypoint: th.automated ? 'sdk-ts' : 'cli', isSidechain: false }
    let parent: string | null = null
    let ctx = 9000
    const rec = (o: object) => {
      const uuid = r.uuid()
      lines.push(JSON.stringify({ parentUuid: parent, ...common, ...o, uuid }))
      parent = uuid
    }
    lines.push(JSON.stringify({ type: 'ai-title', sessionId: th.id, aiTitle: `${th.project}: ${th.turns[0].text.split(' ').slice(0, 5).join(' ')}` }))
    for (const turn of th.turns) {
      if (turn.interrupted) rec({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] }, timestamp: iso(turn.t - 2000) })
      rec({ type: 'user', message: { role: 'user', content: turn.text }, timestamp: iso(turn.t), ...(th.automated ? { origin: { kind: 'sdk' } } : {}) })
      activity.set(dk(turn.t), (activity.get(dk(turn.t)) || 0) + 1)
      if (!th.automated) history.push(JSON.stringify({ display: turn.text, pastedContents: {}, timestamp: turn.t, project: th.cwd, sessionId: th.id }))
      // the agent loops: one API reply per step, each written as one record per block
      const steps = Math.max(1, turn.tools)
      for (let s = 0; s < steps; s++) {
        const at = turn.t + Math.round(((s + 1) / (steps + 1)) * turn.agentMs)
        ctx = Math.min(180000, ctx + r.int(300, 3000))
        const u: Usage = { model: th.model, t: at, fresh: r.int(3, 40), cached: ctx, write: r.int(200, 2500), out: r.int(80, 1400) }
        const msgId = `msg_${r.id().slice(0, 24)}`
        const usage = { input_tokens: u.fresh, cache_creation_input_tokens: u.write, cache_read_input_tokens: u.cached, output_tokens: u.out, service_tier: 'standard' }
        const last = s === steps - 1
        const file = `src/${r.pick(['app', 'lib', 'components', 'server'])}/${r.pick(['index', 'auth', 'utils', 'page', 'api'])}.ts`
        const blocks: object[] = [{ type: 'thinking', thinking: '…', signature: 'x' }]
        if (last) blocks.push({ type: 'text', text: 'Done. I updated the code and ran the tests.' })
        else if (p.subagents && r.chance(p.subagents)) blocks.push({ type: 'tool_use', id: `toolu_${r.id().slice(0, 20)}`, name: 'Task', input: { description: 'investigate', prompt: 'look into it' } })
        else if (r.chance(0.45)) blocks.push({ type: 'tool_use', id: `toolu_${r.id().slice(0, 20)}`, name: 'Edit', input: { file_path: `${th.cwd}/${file}`, old_string: 'const a = 1\n', new_string: 'const a = 2\nconst b = 3\n' } })
        else blocks.push({ type: 'tool_use', id: `toolu_${r.id().slice(0, 20)}`, name: 'Bash', input: { command: r.pick(['npm test', 'npm run build', 'git status', 'ls src']) } })
        for (const [bi, b] of blocks.entries()) {
          // early records of a streamed reply can carry a partial output count
          const uu = bi === 0 && blocks.length > 1 && r.chance(0.1) ? { ...usage, output_tokens: 1 } : usage
          rec({ type: 'assistant', message: { id: msgId, type: 'message', role: 'assistant', model: th.model, content: [b], stop_reason: last ? 'end_turn' : 'tool_use', usage: uu }, requestId: `req_${r.id().slice(0, 24)}`, timestamp: iso(at) })
          countRaw({ ...u, out: uu.output_tokens })
          if ((b as any).type === 'tool_use') rec({ type: 'user', message: { role: 'user', content: [{ tool_use_id: (b as any).id, type: 'tool_result', content: 'ok' }] }, toolUseResult: { stdout: 'ok' }, timestamp: iso(at + 500) })
        }
        if ((blocks[1] as any)?.name === 'Task') {
          // a subagent transcript of its own, under the session's folder
          const sub: string[] = []
          for (let k = 0; k < r.int(2, 6); k++) {
            const su: Usage = { model: 'claude-haiku-4-5-20251001', t: at + k * 4000, fresh: r.int(3, 30), cached: r.int(8000, 40000), write: r.int(200, 2000), out: r.int(100, 900) }
            sub.push(JSON.stringify({ parentUuid: null, isSidechain: true, userType: 'external', cwd: th.cwd, sessionId: th.id, type: 'assistant', message: { id: `msg_${r.id().slice(0, 24)}`, role: 'assistant', model: su.model, content: [{ type: 'text', text: 'found it' }], usage: { input_tokens: su.fresh, cache_creation_input_tokens: su.write, cache_read_input_tokens: su.cached, output_tokens: su.out } }, uuid: r.uuid(), timestamp: iso(su.t) }))
            countRaw(su)
          }
          if (th.turns[th.turns.length - 1].t >= cutoff && !p.historyOnly) {
            const dir = path.join(projectsDir, claudeDir(th.cwd), th.id, 'subagents')
            fs.mkdirSync(dir, { recursive: true })
            fs.writeFileSync(path.join(dir, `agent-${r.id().slice(0, 8)}.jsonl`), sub.join('\n') + '\n')
          }
        }
      }
      rec({ type: 'system', subtype: 'turn_duration', durationMs: turn.agentMs, isMeta: false, timestamp: iso(turn.t + turn.agentMs) })
    }
    // Claude Code cleans up transcripts older than its retention; prompt history stays
    const lastT = th.turns[th.turns.length - 1].t
    if (lastT < cutoff || p.historyOnly) continue
    const dir = path.join(projectsDir, claudeDir(th.cwd))
    fs.mkdirSync(dir, { recursive: true })
    const f = path.join(dir, `${th.id}.jsonl`)
    fs.writeFileSync(f, lines.join('\n') + '\n')
    fs.utimesSync(f, new Date(lastT), new Date(lastT))
  }
  history.sort((a, b) => JSON.parse(a).timestamp - JSON.parse(b).timestamp)
  fs.writeFileSync(path.join(root, 'history.jsonl'), history.join('\n') + (history.length ? '\n' : ''))
  const days = [...activity.keys()].sort()
  if (!days.length) return
  fs.writeFileSync(
    path.join(root, 'stats-cache.json'),
    JSON.stringify({
      version: 2,
      lastComputedDate: lastComputed,
      dailyActivity: days.filter((d) => d <= lastComputed).map((date) => ({ date, messageCount: activity.get(date)! * 6, sessionCount: 1, toolCallCount: activity.get(date)! * 3 })),
      dailyModelTokens: [...daily.entries()].filter(([d]) => d <= lastComputed).map(([date, tokensByModel]) => ({ date, tokensByModel })),
      modelUsage,
      totalSessions: threads.filter((x) => x.tool === 'claude').length,
      totalMessages: [...activity.values()].reduce((a, b) => a + b, 0) * 6,
      firstSessionDate: `${days[0]}T09:00:00.000Z`,
    }),
  )
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ firstStartTime: `${days[0]}T08:00:00.000Z`, numStartups: 40 }))
}

function writeCodex(p: Persona, r: Rng, home: string, threads: Thread[]) {
  for (const th of threads.filter((x) => x.tool === 'codex')) {
    const t0 = th.turns[0].t
    const d = new Date(t0)
    const dir = path.join(home, '.codex', 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
    fs.mkdirSync(dir, { recursive: true })
    const lines: string[] = []
    const ev = (t: number, type: string, payload: object) => lines.push(JSON.stringify({ timestamp: iso(t), type, payload }))
    ev(t0 - 1000, 'session_meta', { id: th.id, timestamp: iso(t0 - 1000), cwd: th.cwd, originator: th.automated ? 'codex_exec' : 'codex_cli_rs', cli_version: '0.61.0', source: th.automated ? 'exec' : 'cli', git: { branch: 'main', commit_hash: r.id().slice(0, 40) } })
    ev(t0 - 900, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: `<environment_context>\n  <cwd>${th.cwd}</cwd>\n</environment_context>` }] })
    ev(t0 - 800, 'turn_context', { cwd: th.cwd, model: th.model, effort: r.pick(['medium', 'high', 'xhigh']), approval_policy: 'on-request' })
    const tot = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 }
    let ctx = 12000
    for (const turn of th.turns) {
      ev(turn.t, 'event_msg', { type: 'task_started', model_context_window: 272000 })
      ev(turn.t, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: turn.text }] })
      const steps = Math.max(1, turn.tools)
      for (let s = 0; s < steps; s++) {
        const at = turn.t + Math.round(((s + 1) / (steps + 1)) * turn.agentMs)
        if (s < steps - 1) {
          if (r.chance(0.4)) ev(at, 'response_item', { type: 'custom_tool_call', name: 'apply_patch', call_id: `call_${r.id().slice(0, 12)}`, input: `*** Begin Patch\n*** Update File: src/${r.pick(['app', 'lib'])}/${r.pick(['index', 'auth', 'api'])}.ts\n@@\n-const a = 1\n+const a = 2\n+const b = 3\n*** End Patch` })
          else ev(at, 'response_item', { type: 'function_call', name: 'shell', call_id: `call_${r.id().slice(0, 12)}`, arguments: JSON.stringify({ command: ['bash', '-lc', r.pick(['npm test', 'rg auth src', 'git diff', 'npm run build'])] }) })
        } else ev(at, 'response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done: updated the code and ran the tests.' }] })
        ctx = Math.min(250000, ctx + r.int(500, 4000))
        const last = { input_tokens: ctx, cached_input_tokens: Math.round(ctx * 0.92), output_tokens: r.int(80, 1500), reasoning_output_tokens: 0, total_tokens: 0 }
        last.reasoning_output_tokens = Math.round(last.output_tokens * 0.4)
        last.total_tokens = last.input_tokens + last.output_tokens
        for (const k of Object.keys(tot) as (keyof typeof tot)[]) tot[k] += last[k]
        const tc = { type: 'token_count', info: { total_token_usage: { ...tot }, last_token_usage: last, model_context_window: 272000 }, rate_limits: { primary: { used_percent: r.int(1, 90), window_minutes: 300 }, plan_type: 'plus' } }
        ev(at + 200, 'event_msg', tc)
        // Codex sometimes repeats a count when nothing new was billed
        if (r.chance(0.3)) ev(at + 400, 'event_msg', tc)
      }
      if (turn.interrupted) ev(turn.t + turn.agentMs, 'event_msg', { type: 'turn_aborted', reason: 'interrupted' })
      ev(turn.t + turn.agentMs, 'event_msg', { type: 'task_complete', duration_ms: turn.agentMs })
    }
    fs.writeFileSync(path.join(dir, `rollout-${iso(t0).slice(0, 19).replace(/:/g, '-')}-${th.id}.jsonl`), lines.join('\n') + '\n')
  }
}

/** One agent turn as model calls: tool steps, then a closing reply, each with its own usage. */
function stepsOf(r: Rng, turn: Turn, ctx: { n: number }) {
  const n = Math.max(1, turn.tools)
  return Array.from({ length: n }, (_, s) => {
    ctx.n = Math.min(200000, ctx.n + r.int(500, 3000))
    const last = s === n - 1
    return {
      at: turn.t + Math.round(((s + 1) / (n + 1)) * turn.agentMs),
      last,
      edit: !last && r.chance(0.45),
      file: `src/${r.pick(['app', 'lib', 'server'])}/${r.pick(['index', 'auth', 'api'])}.ts`,
      cmd: r.pick(['npm test', 'npm run build', 'git status']),
      id: r.uuid(),
      fresh: r.int(200, 3000),
      cached: ctx.n,
      write: r.int(0, 1500),
      out: r.int(80, 1400),
    }
  })
}
const REPLY = 'Done: updated the code and ran the tests.'
const write = (file: string, lines: unknown[]) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n')
}

/** Gemini CLI (Oct 2026 JSONL): a message is appended again once its tokens land. */
function writeGemini(r: Rng, home: string, threads: Thread[]) {
  const logs = new Map<string, object[]>()
  for (const th of threads.filter((x) => x.tool === 'gemini')) {
    const hash = crypto.createHash('sha256').update(th.cwd).digest('hex')
    const lines: object[] = [{ sessionId: th.id, projectHash: hash, startTime: iso(th.turns[0].t), lastUpdated: iso(th.turns[th.turns.length - 1].t), kind: 'main' }]
    const ctx = { n: 8000 }
    for (const turn of th.turns) {
      if (turn.interrupted) lines.push({ id: r.uuid(), timestamp: iso(turn.t - 2000), type: 'info', content: 'Request cancelled.' })
      const uid = r.uuid()
      lines.push({ id: uid, timestamp: iso(turn.t), type: 'user', content: turn.text })
      if (!th.automated) (logs.get(hash) || logs.set(hash, []).get(hash)!).push({ sessionId: th.id, messageId: uid, type: 'user', message: turn.text, timestamp: iso(turn.t) })
      for (const s of stepsOf(r, turn, ctx)) {
        const toolCalls = s.last ? [] : s.edit ? [{ name: 'replace', args: { file_path: path.join(th.cwd, s.file), old_string: 'const a = 1', new_string: 'const a = 2\nconst b = 3' } }] : [{ name: 'run_shell_command', args: { command: s.cmd } }]
        const msg = { id: s.id, timestamp: iso(s.at), type: 'gemini', content: s.last ? REPLY : '', model: th.model, toolCalls }
        lines.push(msg, { ...msg, tokens: { input: s.fresh + s.cached, cached: s.cached, output: s.out, thoughts: r.int(0, 300), tool: 0, total: s.fresh + s.cached + s.out } })
      }
    }
    write(path.join(home, '.gemini', 'tmp', hash, 'chats', `session-${iso(th.turns[0].t).slice(0, 16).replace(/:/g, '-')}-${th.id.slice(0, 8)}.jsonl`), lines)
  }
  for (const [hash, rows] of logs) write(path.join(home, '.gemini', 'tmp', hash, 'logs.json'), [JSON.stringify(rows)])
}

/** OpenCode ≥1.2: one SQLite database of sessions, messages and parts. */
async function writeOpenCode(r: Rng, home: string, threads: Thread[]) {
  const mine = threads.filter((x) => x.tool === 'opencode')
  if (!mine.length) return
  const { DatabaseSync } = await import('node:sqlite')
  const dir = path.join(home, '.local', 'share', 'opencode')
  fs.mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(path.join(dir, 'opencode.db'))
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, slug TEXT, directory TEXT, title TEXT, version TEXT, time_created INTEGER, time_updated INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);`)
  const ses = db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const msg = db.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)')
  const part = db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)')
  for (const th of mine) {
    const sid = `ses_${th.id.replace(/-/g, '')}`
    const [providerID, modelID] = th.model.split('/')
    ses.run(sid, 'proj', null, 'slug', th.cwd, `${th.project} work`, '1.4.2', th.turns[0].t, th.turns[th.turns.length - 1].t)
    const ctx = { n: 9000 }
    for (const turn of th.turns) {
      if (turn.interrupted) msg.run(`msg_${r.id().slice(0, 20)}`, sid, turn.t - 3000, turn.t, JSON.stringify({ role: 'assistant', time: { created: turn.t - 3000 }, modelID, providerID, error: { name: 'MessageAbortedError', data: {} }, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }))
      const uid = `msg_${r.id().slice(0, 20)}`
      msg.run(uid, sid, turn.t, turn.t, JSON.stringify({ role: 'user', time: { created: turn.t }, agent: 'build', model: { providerID, modelID } }))
      part.run(`prt_${r.id().slice(0, 20)}`, uid, sid, turn.t, turn.t, JSON.stringify({ type: 'text', text: turn.text }))
      for (const s of stepsOf(r, turn, ctx)) {
        const aid = `msg_${r.id().slice(0, 20)}`
        msg.run(aid, sid, s.at, s.at, JSON.stringify({ role: 'assistant', time: { created: s.at, completed: s.at + 4000 }, parentID: uid, modelID, providerID, mode: 'build', agent: 'build', path: { cwd: th.cwd, root: th.cwd }, cost: 0, tokens: { input: s.fresh, output: s.out, reasoning: r.int(0, 200), cache: { read: s.cached, write: s.write } } }))
        const data = s.last ? { type: 'text', text: REPLY } : s.edit ? { type: 'tool', tool: 'edit', callID: r.id().slice(0, 10), state: { status: 'completed', input: { filePath: path.join(th.cwd, s.file), oldString: 'const a = 1', newString: 'const a = 2\nconst b = 3' }, output: 'ok', metadata: {} } } : { type: 'tool', tool: 'bash', callID: r.id().slice(0, 10), state: { status: 'completed', input: { command: s.cmd }, output: 'ok', metadata: {} } }
        part.run(`prt_${r.id().slice(0, 20)}`, aid, sid, s.at, s.at, JSON.stringify(data))
      }
    }
  }
  db.close()
}

/** Pi: a JSONL tree per session with exact usage on each assistant message. */
function writePi(r: Rng, home: string, threads: Thread[]) {
  for (const th of threads.filter((x) => x.tool === 'pi')) {
    const lines: object[] = [{ type: 'session', version: 3, id: th.id, timestamp: iso(th.turns[0].t - 1000), cwd: th.cwd }]
    let parent: string | null = null
    const add = (o: object, t: number) => {
      const id = r.id().slice(0, 8)
      lines.push({ ...o, id, parentId: parent, timestamp: iso(t) })
      parent = id
    }
    add({ type: 'model_change', provider: th.model.startsWith('gpt') ? 'openai' : 'anthropic', modelId: th.model }, th.turns[0].t - 900)
    const ctx = { n: 7000 }
    for (const turn of th.turns) {
      if (turn.interrupted) add({ type: 'message', message: { role: 'assistant', model: th.model, content: [], stopReason: 'aborted', timestamp: turn.t - 2000, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } }, turn.t - 2000)
      add({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: turn.text }], timestamp: turn.t } }, turn.t)
      for (const s of stepsOf(r, turn, ctx)) {
        const tool = s.last ? null : s.edit ? { type: 'toolCall', id: s.id, name: 'edit', arguments: { path: path.join(th.cwd, s.file), edits: [{ oldText: 'const a = 1', newText: 'const a = 2\nconst b = 3' }] } } : { type: 'toolCall', id: s.id, name: 'bash', arguments: { command: s.cmd } }
        const usage = { input: s.fresh, output: s.out, cacheRead: s.cached, cacheWrite: s.write, totalTokens: s.fresh + s.out + s.cached + s.write, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
        add({ type: 'message', message: { role: 'assistant', provider: 'anthropic', model: th.model, content: tool ? [tool] : [{ type: 'text', text: REPLY }], usage, stopReason: tool ? 'toolUse' : 'stop', timestamp: s.at } }, s.at)
        if (tool) add({ type: 'message', message: { role: 'toolResult', toolCallId: s.id, toolName: tool.name, content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: s.at + 300 } }, s.at + 300)
      }
    }
    write(path.join(home, '.pi', 'agent', 'sessions', `--${th.cwd.replace(/[/\\:]/g, '-').replace(/^-+/, '')}--`, `${iso(th.turns[0].t).replace(/[:.]/g, '-')}_${th.id}.jsonl`), lines)
  }
}

/** Copilot CLI: events.jsonl with running token totals per model at each shutdown. */
function writeCopilot(r: Rng, home: string, threads: Thread[]) {
  for (const th of threads.filter((x) => x.tool === 'copilot')) {
    const lines: object[] = []
    const ev = (type: string, data: object, t: number) => lines.push({ type, data, id: r.uuid(), timestamp: iso(t), parentId: null })
    ev('session.start', { sessionId: th.id, selectedModel: th.model, context: { cwd: th.cwd, branch: 'main' } }, th.turns[0].t - 1000)
    const tot = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    const shutdown = (t: number) => ev('session.shutdown', { modelMetrics: { [th.model]: { usage: { ...tot }, requests: { count: 1 } } } }, t)
    const ctx = { n: 9000 }
    th.turns.forEach((turn, i) => {
      ev('user.message', { content: turn.text }, turn.t)
      for (const s of stepsOf(r, turn, ctx)) {
        const req = s.last ? [] : [{ toolCallId: s.id, name: s.edit ? 'edit' : 'bash', arguments: JSON.stringify(s.edit ? { path: path.join(th.cwd, s.file), old_str: 'const a = 1', new_str: 'const a = 2\nconst b = 3' } : { command: s.cmd }) }]
        ev('assistant.message', { messageId: s.id, content: s.last ? REPLY : '', toolRequests: req }, s.at)
        tot.inputTokens += s.fresh + s.cached
        tot.cacheReadTokens += s.cached
        tot.outputTokens += s.out
      }
      // a session resumed the next day shuts down twice; the second total includes the first
      if (i === Math.floor(th.turns.length / 2) && th.turns.length > 3) shutdown(turn.t + turn.agentMs + 1000)
    })
    const last = th.turns[th.turns.length - 1]
    shutdown(last.t + last.agentMs + 2000)
    write(path.join(home, '.copilot', 'session-state', th.id, 'events.jsonl'), lines)
  }
}

/** Qwen Code: Claude-like records with Gemini-style usage, plus telemetry copies to ignore. */
function writeQwen(r: Rng, home: string, threads: Thread[]) {
  for (const th of threads.filter((x) => x.tool === 'qwen')) {
    const lines: object[] = []
    let parent: string | null = null
    const rec = (o: object, t: number) => {
      const uuid = r.uuid()
      lines.push({ uuid, parentUuid: parent, sessionId: th.id, timestamp: iso(t), cwd: th.cwd, version: '0.9.1', gitBranch: 'main', ...o })
      parent = uuid
    }
    const ctx = { n: 6000 }
    for (const turn of th.turns) {
      rec({ type: 'user', message: { role: 'user', parts: [{ text: turn.text }] } }, turn.t)
      for (const s of stepsOf(r, turn, ctx)) {
        const parts = s.last ? [{ text: REPLY }] : [{ functionCall: { name: s.edit ? 'edit' : 'run_shell_command', args: s.edit ? { file_path: path.join(th.cwd, s.file), old_string: 'const a = 1', new_string: 'const a = 2\nconst b = 3' } : { command: s.cmd } } }]
        const usageMetadata = { promptTokenCount: s.fresh + s.cached, cachedContentTokenCount: s.cached, candidatesTokenCount: s.out, thoughtsTokenCount: r.int(0, 200), totalTokenCount: s.fresh + s.cached + s.out }
        rec({ type: 'assistant', model: th.model, message: { role: 'model', parts }, usageMetadata }, s.at)
        rec({ type: 'system', subtype: 'ui_telemetry', systemPayload: { uiEvent: { 'event.name': 'qwen-code.api_response', input_token_count: usageMetadata.promptTokenCount } } }, s.at + 10)
      }
    }
    write(path.join(home, '.qwen', 'projects', th.cwd.replace(/[^a-zA-Z0-9]/g, '-'), 'chats', `${th.id}.jsonl`), lines)
  }
}

// ───────────────────────── run lore on each and judge the result

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

interface Verdict {
  key: string
  ok: boolean
  prompts: string
  card: string
  twin: string
  spectra: string
  issues: string[]
}

function judge(p: Persona, threads: Thread[], report: any, ms: number): Verdict {
  const issues: string[] = []
  const human = threads.filter((t) => !t.automated)
  const turns = human.flatMap((t) => t.turns)
  const raw = JSON.stringify(report)
  for (const bad of ['NaN', 'Infinity', 'undefined', '[object Object]']) if (raw.includes(bad)) issues.push(`report text contains "${bad}" (${(raw.match(new RegExp(bad.replace(/[[\]]/g, '\\$&'), 'g')) || []).length}×)`)
  const got = report.totals?.prompts ?? 0
  if (Math.abs(got - turns.length) > Math.max(2, turns.length * 0.02)) issues.push(`prompts: wrote ${turns.length}, lore counted ${got}`)
  const steers = turns.filter((t, i) => t.kind === 'steer').length
  const followups = turns.filter((t) => t.kind !== 'ask').length
  const wantSteer = followups ? steers / followups : 0
  const gotSteer = report.steering?.rate ?? 0
  if (followups > 30 && Math.abs(gotSteer - wantSteer) > 0.06) issues.push(`steer rate: wrote ${(wantSteer * 100).toFixed(0)}%, lore measured ${(gotSteer * 100).toFixed(0)}%`)
  for (const agent of new Set(human.map((t) => t.tool))) {
    const wrote = human.filter((t) => t.tool === agent).reduce((a, t) => a + t.turns.length, 0)
    const counted = report.bySource?.find((s: any) => s.source === SOURCE_OF[agent])?.prompts ?? 0
    if (Math.abs(counted - wrote) > Math.max(2, wrote * 0.02)) issues.push(`${agent} prompts: wrote ${wrote}, lore counted ${counted}`)
  }
  // every model a mainstream provider sells should have a price
  const tokens = report.spend?.tokens || 0
  for (const m of report.spend?.models || []) if (m.usd == null && /^(claude|gpt|gemini|o\d)/.test(m.model) && m.tokens > tokens * 0.01) issues.push(`unpriced: ${m.model} (${Math.round((m.tokens / tokens) * 100)}% of tokens)`)
  const projects = new Set(human.map((t) => t.project)).size
  if (report.totals && projects && report.totals.projects !== projects) issues.push(`projects: wrote ${projects}, lore counted ${report.totals.projects}`)
  if (ms > 20000) issues.push(`slow: ${(ms / 1000).toFixed(1)}s`)
  const approvals = turns.filter((t) => t.kind === 'approve').length
  const gotApprove = report.totals?.approvals ?? 0
  if (approvals > 30 && Math.abs(gotApprove - approvals) / approvals > 0.25) issues.push(`approvals: wrote ${approvals}, lore counted ${gotApprove}`)
  const swears = turns.filter((t) => /fuck|wtf|shit|damn|joder|mierda|hostia|卧槽|妈的/i.test(t.text)).length
  const gotSwears = report.deep?.swear?.prompts ?? 0
  if (swears > 20 && Math.abs(gotSwears - swears) / swears > 0.25) issues.push(`swears: wrote ${swears}, lore counted ${gotSwears}`)
  const other = report.deep?.intents?.find((i: any) => i.key === 'other')?.share ?? 0
  if (other > 0.4) issues.push(`${Math.round(other * 100)}% of opening asks unclassified`)
  // the payload this run would send, from every OS, with repo stats off and on, as the collector sees it
  let statsErrs: string[] = []
  const repo = { repos: 0, tests: 0, ci: 0, container: 0, agentMd: 0, frameworks: [], files: {}, age: {}, hosts: {}, licenses: {}, team: {}, outcomes: { checked: 0, committed: 0, reverted: 0 } }
  try {
    for (const os of OSES)
      for (const repoShape of [undefined, repo]) {
        const wire = JSON.stringify(buildStats({ ...report, repoShape }, { os, firstRunMonth: new Date().toISOString().slice(0, 7), runs: 1, notice: NOTICE }))
        statsErrs.push(...validateStats(JSON.parse(wire)).map((e) => `${e} (${os})`))
        if (Buffer.byteLength(wire) > MAX_BODY) statsErrs.push(`${Buffer.byteLength(wire)} bytes (${os})`)
      }
  } catch (e: any) {
    statsErrs = [`buildStats threw: ${e.message}`]
  }
  if (statsErrs.length) issues.push(`stats invalid: ${statsErrs.slice(0, 3).join(', ')}`)
  const a = report.archetype
  return {
    key: p.key,
    ok: !issues.length,
    prompts: `${turns.length}→${got}`,
    card: a ? `${a.name} ${a.code}` : '—',
    twin: a?.twin ? `${a.twin.name} ${a.twin.match}%` : '—',
    spectra: a ? a.spectra.map((s: any) => `${s.key.slice(0, 4)} ${s.z >= 0 ? '+' : ''}${s.z.toFixed(1)}`).join(' ') : '',
    issues,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined)
  const out = path.resolve(opt('--out') || path.join(os.tmpdir(), 'lore-personas'))
  const only = opt('--only')?.split(',')
  const now = Date.now()
  const verdicts: Verdict[] = []
  for (const p of PERSONAS.filter((x) => !only || only.includes(x.key))) {
    const dir = path.join(out, p.key)
    fs.rmSync(dir, { recursive: true, force: true })
    const home = path.join(dir, 'home')
    fs.mkdirSync(home, { recursive: true })
    const r = rng(p.key)
    const threads = p.empty ? [] : plan(p, r, now)
    if (!p.empty) {
      if (p.claude > 0) writeClaude(p, r, home, threads, now)
      if (p.codex > 0) writeCodex(p, r, home, threads)
      writeGemini(r, home, threads)
      await writeOpenCode(r, home, threads)
      writePi(r, home, threads)
      writeCopilot(r, home, threads)
      writeQwen(r, home, threads)
    }
    const t0 = Date.now()
    let report: any = null
    let err = ''
    try {
      const stdout = execFileSync(process.execPath, [path.join(ROOT, 'dist/cli.js'), '--json'], {
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          LORE_HOME: path.join(dir, 'lore'),
          LORE_NO_STATS: '1',
          ...Object.fromEntries(['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'GEMINI_CLI_HOME', 'PI_CODING_AGENT_DIR', 'PI_CODING_AGENT_SESSION_DIR', 'OPENCLAW_STATE_DIR', 'OPENCODE_DATA_DIR', 'KILO_DB', 'QWEN_HOME', 'QWEN_RUNTIME_DIR', 'COPILOT_HOME'].map((k) => [k, ''])),
        },
        maxBuffer: 1 << 30,
      })
      report = JSON.parse(stdout.toString())
      fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 1))
    } catch (e: any) {
      err = String(e.stderr || e.message).split('\n').slice(0, 4).join(' ')
    }
    const v = report ? judge(p, threads, report, Date.now() - t0) : { key: p.key, ok: false, prompts: '—', card: '—', twin: '—', spectra: '', issues: [`lore failed: ${err}`] }
    verdicts.push(v)
    console.log(`${v.ok ? '✓' : '✗'} ${p.key.padEnd(13)} ${p.label}`)
    console.log(`    prompts ${v.prompts} · ${v.card} · twin ${v.twin}`)
    if (v.spectra) console.log(`    ${v.spectra}`)
    for (const i of v.issues) console.log(`    ! ${i}`)
  }
  console.log(`\n${verdicts.filter((v) => v.ok).length}/${verdicts.length} clean · homes and reports in ${out}`)
  if (verdicts.some((v) => !v.ok)) process.exitCode = 1
}

main()
