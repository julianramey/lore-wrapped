// The deep dive: what agents actually did for you, what it cost, how hard you pushed
// them, and how you talk to them. Everything here is counted from local logs.

import type { CountRow, Deep, Example } from '../report-types.ts'
import type { ClaudeStats } from '../sources/claudeStats.ts'
import { TEST_CMD, extOf } from '../sources/tools.ts'
import type { HumanEvent, SourceName, ThreadRecord } from '../types.ts'
import { perSource, SOURCE_KEYS } from '../sources/registry.ts'
import { INTENTS_X, PLEASE, SWEARS_X, THANKS } from '../util/lang.ts'
import { hasSlur, isShouting, looksPasted } from '../util/safety.ts'
import { clip, dayKey, weekKey, wordCount } from '../util/text.ts'
import type { ClassifiedThread } from './classify.ts'

const key = (t: ThreadRecord) => `${t.source}:${t.id}`
const ex = (t: ThreadRecord, idx: number, n = 240): Example => {
  const e = t.events[idx] as HumanEvent
  return { ref: { thread: key(t), ev: idx }, text: clip(e.text, n), project: t.project, at: e.t, source: t.source, safe: !hasSlur(e.text) }
}
const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** Lockfiles and build output inflate line counts without saying anything about the work. */
const GENERATED = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|Gemfile\.lock|composer\.lock|go\.sum)$|(^|\/)(dist|build|out|\.next|node_modules|coverage|vendor)\/|\.(min\.(js|css)|map|snap)$/

const LANG: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', rs: 'Rust', go: 'Go', swift: 'Swift', kt: 'Kotlin', java: 'Java', rb: 'Ruby', php: 'PHP',
  c: 'C', h: 'C', cpp: 'C++', cc: 'C++', cs: 'C#', sql: 'SQL', css: 'CSS', scss: 'CSS', html: 'HTML',
  md: 'Markdown', mdx: 'Markdown', json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', sh: 'Shell', zsh: 'Shell',
  vue: 'Vue', svelte: 'Svelte', dart: 'Dart', lua: 'Lua', ex: 'Elixir', exs: 'Elixir', tf: 'Terraform', prisma: 'Prisma',
}

/** Each language's key in the anonymous stats. */
export const LANG_KEYS: Record<string, string> = Object.fromEntries(
  [...new Set(Object.values(LANG))].map((l) => [l, l.toLowerCase().replace('c++', 'cpp').replace('c#', 'csharp')]),
)

/** What an MCP server is for, from its name: a fixed list, so no server name ever leaves. */
export const MCP_KINDS: [string, RegExp][] = [
  ['issue_tracker', /linear|jira|atlassian|github|gitlab|asana|clickup|shortcut|trello|youtrack/],
  ['error_monitor', /sentry|datadog|honeycomb|rollbar|bugsnag|newrelic|grafana|posthog/],
  ['database', /postgres|supabase|sqlite|mysql|mongo|neon|prisma|planetscale|redis|firebase|bigquery|snowflake|clickhouse|(^|[-_])db($|[-_])/],
  ['browser', /playwright|puppeteer|chrome|browser|selenium/],
  ['docs', /context7|docs|notion|confluence|deepwiki|mintlify|obsidian/],
  ['chat', /slack|discord|teams|gmail|mail|telegram/],
  ['design', /figma|canva|sketch|penpot|framer/],
  ['cloud', /aws|gcp|google-cloud|azure|vercel|cloudflare|netlify|render|fly|railway|kubernetes|k8s|terraform|heroku|docker/],
]
export const mcpKind = (server: string) => MCP_KINDS.find(([, re]) => re.test(server.toLowerCase()))?.[0] ?? 'other'

export const COMMAND_CATEGORIES: { key: string; label: string; re: RegExp }[] = [
  { key: 'test', label: 'Tests', re: TEST_CMD },
  { key: 'check', label: 'Type checks & lint', re: /\b(tsc|eslint|prettier|ruff|mypy|biome|lint|typecheck|clippy|swiftlint)\b/ },
  { key: 'build', label: 'Builds', re: /\b((npm|pnpm|yarn|bun)( run)? build|next build|vite build|esbuild|webpack|cargo build|go build|make|xcodebuild|gradle|swift build|dotnet build|msbuild)\b/i },
  { key: 'git', label: 'Git', re: /^\s*(git|gh)\b/ },
  { key: 'install', label: 'Installs', re: /\b((npm|pnpm|yarn|bun) (i|install|add)|pip3? install|brew install|cargo add|go get|pod install|winget install|choco install|scoop install|dotnet add)\b/i },
  { key: 'db', label: 'Database', re: /\b(psql|supabase|prisma|sqlite3|mysql|drizzle|migrat\w*)\b/ },
  { key: 'deploy', label: 'Deploys & cloud', re: /\b(vercel|netlify|wrangler|fly|railway|gcloud|aws|kubectl|docker|eas (build|submit|update)|heroku)\b/ },
  { key: 'http', label: 'HTTP calls', re: /\b(curl|wget|httpie)\b/ },
  { key: 'run', label: 'Running code', re: /^\s*(node|python3?|deno|bun|tsx|ts-node|ruby|go run|cargo run|(npm|pnpm|yarn) (run )?(dev|start))\b/ },
  { key: 'read', label: 'Reading & searching', re: /^\s*(rg|grep|find|fd|ls|cat|sed|head|tail|wc|tree|nl|awk|jq|pwd|stat|file|cd|echo|printf|which|du|diff|dir|type|where|findstr|Get-ChildItem|Get-Content|Select-String|Get-Item|Set-Location|Test-Path|gci|gc|sls)\b/i },
]

export const INTENTS: { key: string; label: string; re: RegExp }[] = [
  { key: 'fix', label: 'Fix something broken', re: /\b(fix\w*|bug\w*|broken|error\w*|crash\w*|fail\w*|not working|doesn'?t work|issue)\b/i },
  { key: 'review', label: 'Review or audit', re: /\b(review|audit|assess|evaluate|look over|sanity check|double check)\b/i },
  { key: 'explain', label: 'Explain or investigate', re: /\b(explain|why|how (does|do|can|would)|what (is|are|does)|understand|investigate|look into|research|figure out|find out|where)\b/i },
  { key: 'plan', label: 'Plan or decide', re: /\b(plan|strategy|roadmap|idea\w*|brainstorm|approach|should (we|i)|thoughts|options|pros and cons|recommend)\b/i },
  { key: 'design', label: 'Design and UI', re: /\b(design|ui|ux|css|layout|styl\w*|landing|font|colou?r|animation|responsive|looks?|page|screen|button|card|modal)\b/i },
  { key: 'data', label: 'Data and SQL', re: /\b(sql|query|database|db|migration|schema|table|supabase|postgres|csv|analytics|rows?)\b/i },
  { key: 'refactor', label: 'Refactor or simplify', re: /\b(refactor|clean ?up|simplify|reorgani[sz]e|restructure|dedupe|consolidate)\b/i },
  { key: 'ops', label: 'Deploy and infra', re: /\b(deploy\w*|vercel|ci|docker|env|server|infra|domain|dns|cron|webhook|prod(uction)?)\b/i },
  { key: 'test', label: 'Tests', re: /\b(tests?|testing|coverage|e2e)\b/i },
  { key: 'writing', label: 'Writing and docs', re: /\b(write|draft|email|copy|docs?|readme|blog|post|tweet|pitch|message)\b/i },
  { key: 'change', label: 'Change something existing', re: /\b(update|change|edit|modify|remove|delete|move|replace|tweak|adjust|rename|make (it|this|the)|instead)\b/i },
  { key: 'build', label: 'Build something new', re: /\b(add|build|create|implement|make|set ?up|integrate|new|need)\b/i },
]

export const SWEARS: { word: string; re: RegExp }[] = [
  { word: 'fuck', re: /\bf+u+c+k+\w*/gi },
  { word: 'shit', re: /\bshit\w*|\bbullshit\b/gi },
  { word: 'damn', re: /\b(god)?damn\w*/gi },
  { word: 'wtf', re: /\bwtf+\b/gi },
  { word: 'ass', re: /\b(dumb)?ass(hole)?s?\b/gi },
  { word: 'bitch', re: /\bbitch\w*/gi },
  { word: 'crap', re: /\bcrap\w*/gi },
  { word: 'hell', re: /\bwhat the hell\b|\bhell no\b/gi },
  { word: 'stfu', re: /\bstfu\b/gi },
  ...SWEARS_X,
]

export function intentOf(text: string): string {
  const lead = text.slice(0, 400)
  return INTENTS.find((i) => i.re.test(lead) || INTENTS_X[i.key]?.test(lead))?.key ?? 'other'
}

export function commandCategory(cmd: string): string {
  return COMMAND_CATEGORIES.find((c) => c.re.test(cmd))?.key ?? 'other'
}

function rows(counts: Map<string, number>, defs: { key: string; label: string }[], total: number, examples?: Map<string, string[]>): CountRow[] {
  return [...counts.entries()]
    .map(([k, count]) => ({ key: k, label: defs.find((d) => d.key === k)?.label ?? 'Other', count, share: total ? count / total : 0, examples: examples?.get(k)?.slice(0, 4) }))
    .sort((a, b) => b.count - a.count)
}

export function buildDeep(classified: ClassifiedThread[], prompts: number, claudeStats: ClaudeStats | null): Deep {
  // ── work
  const agentMsBySource = perSource(() => 0)
  const turnMs: number[] = []
  let longest = null as { ms: number; t: ThreadRecord; idx: number } | null
  let actions = 0
  let linesAdded = 0
  let linesRemoved = 0
  const files = new Map<string, { project: string; turns: number; lines: number }>()
  const langs = new Map<string, { lines: number; files: Set<string> }>()
  const cmdCats = new Map<string, number>()
  const cmdExamples = new Map<string, string[]>()
  const cmdTop = new Map<string, number>()
  let cmdTotal = 0
  // ── limits
  let plan: string | null = null
  const weekly = new Map<string, number>()
  let windowsAtLimit = 0
  // ── effort
  const effort = new Map<string, number>()
  let planModeTurns = 0
  // ── swearing
  let swearPrompts = 0
  let pleasePrompts = 0
  let thanksPrompts = 0
  let allCaps = 0
  const words = new Map<string, number>()
  const swearBySource = new Map<SourceName, number>()
  const promptsBySource = new Map<SourceName, number>()
  const swearByProject = new Map<string, { n: number; prompts: number }>()
  const swearDays = new Map<string, number>()
  let loudest = null as { t: ThreadRecord; idx: number; len: number } | null
  let firstSwear = null as { t: ThreadRecord; idx: number; at: number } | null
  let swearInSteers = 0
  // ── steering by model, time to steer, chains
  const byModel = new Map<string, { source: SourceName; followups: number; steers: number; interrupts: number }>()
  const steerGaps: number[] = []
  let fastest = null as { t: ThreadRecord; idx: number; gap: number } | null
  let longestChain = null as { n: number; t: ThreadRecord; idx: number } | null
  let chains = 0
  let recovered = 0
  // ── tasks: how much of the work could be checked by a test, and how long it ran
  let agentThreads = 0
  let tested = 0
  let redGreen = 0
  let longThreads = 0
  let openings = 0
  let specOpenings = 0
  const mcp = new Set<string>()
  // per-prompt work only counts prompts where the work could be seen: rebuilt history has no
  // replies, and some agents don't record how long a turn took
  let observedPrompts = 0
  let timedPrompts = 0
  // ── intents
  const intents = new Map<string, number>()
  const intentExamples = new Map<string, string[]>()

  for (const { thread: t, humans } of classified) {
    promptsBySource.set(t.source, (promptsBySource.get(t.source) || 0) + humans.length)
    for (const [lvl, n] of Object.entries(t.efforts)) effort.set(lvl, (effort.get(lvl) || 0) + n)
    planModeTurns += t.planModeTurns
    if (t.limits) {
      plan = t.limits.plan || plan
      let prev = 0
      for (const [at, used, win] of t.limits.samples) {
        if (win >= 10000) weekly.set(weekKey(at), Math.max(weekly.get(weekKey(at)) || 0, used))
        if (used >= 100 && prev < 100) windowsAtLimit++
        prev = used
      }
    }

    // Tasks
    const turns = t.events.filter((e) => e.k === 'a')
    if (turns.length && !t.recovered) observedPrompts += humans.length
    if (turns.some((e) => e.ms)) timedPrompts += humans.length
    if (turns.length) {
      agentThreads++
      if (turns.some((e) => e.cmds?.some((c) => TEST_CMD.test(c)))) tested++
      if (t.tests?.redGreen) redGreen++
      if (t.agentMs >= 2 * 3.6e6 || t.toolCalls >= 100) longThreads++
      for (const e of turns) for (const n of e.toolNames) if (n.startsWith('mcp__')) mcp.add(mcpKind(n.split('__')[1] || ''))
    }
    const opening = humans[0]
    if (opening?.c.kind === 'ask' && !looksPasted(opening.ev.text)) {
      openings++
      if (wordCount(opening.ev.text) >= 100) specOpenings++
    }

    // Agent turns
    t.events.forEach((e, idx) => {
      if (e.k !== 'a') return
      actions += e.tools
      if (e.ms) {
        agentMsBySource[t.source] += e.ms
        turnMs.push(e.ms)
        if (!longest || e.ms > longest.ms) {
          // anchor the "show me" link on the human message that started this run
          let h = idx - 1
          while (h >= 0 && t.events[h].k !== 'h') h--
          if (h >= 0) longest = { ms: e.ms, t, idx: h }
        }
      }
      for (const [f, a, r] of e.edits || []) {
        if (GENERATED.test(f)) continue
        linesAdded += a
        linesRemoved += r
        const fk = `${t.project}/${f}`
        const cur = files.get(fk) || { project: t.project, turns: 0, lines: 0 }
        cur.turns++
        cur.lines += a + r
        files.set(fk, cur)
        const lang = LANG[extOf(f)]
        if (lang) {
          const l = langs.get(lang) || { lines: 0, files: new Set() }
          l.lines += a
          l.files.add(fk)
          langs.set(lang, l)
        }
      }
      for (const c of e.cmds || []) {
        cmdTotal++
        const cat = commandCategory(c)
        cmdCats.set(cat, (cmdCats.get(cat) || 0) + 1)
        const exs = cmdExamples.get(cat) || []
        if (exs.length < 4 && c.length < 70 && !exs.includes(c)) exs.push(c)
        cmdExamples.set(cat, exs)
        const short = c.split(/\s+/).slice(0, c.startsWith('git') || c.startsWith('npm') || c.startsWith('pnpm') ? 2 : 1).join(' ')
        cmdTop.set(short, (cmdTop.get(short) || 0) + 1)
      }
    })

    // Human messages
    let chain = 0
    let chainStart = -1
    humans.forEach((h) => {
      const text = h.ev.text
      if (h.c.kind === 'ask' && !looksPasted(text)) {
        const it = intentOf(text)
        intents.set(it, (intents.get(it) || 0) + 1)
        const exs = intentExamples.get(it) || []
        if (exs.length < 3 && wordCount(text) <= 30 && !hasSlur(text)) exs.push(clip(text, 120))
        intentExamples.set(it, exs)
      }
      if (PLEASE.test(text)) pleasePrompts++
      if (THANKS.test(text)) thanksPrompts++
      // Swearing: counted on every prompt you typed. Slurs are never counted or shown.
      let swore = false
      if (!hasSlur(text)) {
        for (const s of SWEARS) {
          const n = (text.match(s.re) || []).length
          if (n) {
            words.set(s.word, (words.get(s.word) || 0) + n)
            swore = true
          }
        }
        const shouting = isShouting(text)
        if (shouting) {
          allCaps++
          if (!looksPasted(text) && (!loudest || text.length > loudest.len) && text.length < 600) loudest = { t, idx: h.idx, len: text.length }
        }
      }
      if (swore) {
        swearPrompts++
        swearBySource.set(t.source, (swearBySource.get(t.source) || 0) + 1)
        const p = swearByProject.get(t.project) || { n: 0, prompts: 0 }
        p.n++
        swearByProject.set(t.project, p)
        swearDays.set(dayKey(h.ev.t), (swearDays.get(dayKey(h.ev.t)) || 0) + 1)
        if (h.c.kind === 'steer') swearInSteers++
        if (!firstSwear || h.ev.t < firstSwear.at) firstSwear = { t, idx: h.idx, at: h.ev.t }
      }
      const pp = swearByProject.get(t.project) || { n: 0, prompts: 0 }
      pp.prompts++
      swearByProject.set(t.project, pp)

      if (h.c.kind === 'ask') return
      // Which model's work you were responding to
      const prev = t.events[h.idx - 1]
      if (prev && prev.k === 'a' && prev.model) {
        const m = byModel.get(prev.model) || { source: t.source, followups: 0, steers: 0, interrupts: 0 }
        m.followups++
        if (h.c.kind === 'steer') m.steers++
        if (h.ev.afterInterrupt) m.interrupts++
        byModel.set(prev.model, m)
      }
      if (h.c.kind === 'steer') {
        if (prev && prev.k === 'a' && !t.approxTimes) {
          const gap = (h.ev.t - prev.t) / 1000
          if (gap >= 0 && gap < 6 * 3600) {
            steerGaps.push(gap)
            if (gap >= 2 && wordCount(text) >= 4 && !hasSlur(text) && (!fastest || gap < fastest.gap)) fastest = { t, idx: h.idx, gap }
          }
        }
        if (chain === 0) chainStart = h.idx
        chain++
        if (!longestChain || chain > longestChain.n) longestChain = { n: chain, t, idx: chainStart }
      } else {
        if (chain > 0) {
          chains++
          if (h.c.kind === 'approve') recovered++
        }
        chain = 0
      }
    })
  }

  // Cross-tool: the same project on more than one agent, and switching agents right after a steer.
  const byProject = new Map<string, ThreadRecord[]>()
  for (const c of classified) byProject.set(c.thread.project, [...(byProject.get(c.thread.project) || []), c.thread])
  let projectsOnBoth = 0
  let switches = 0
  let switchExample: Deep['crossTool']['example'] = null
  const kindsByThread = new Map(classified.map((c) => [key(c.thread), c.humans]))
  for (const [project, ts] of byProject) {
    if (project === 'scratch' || project === '~') continue
    if (new Set(ts.map((x) => x.source)).size < 2) continue
    projectsOnBoth++
    const sorted = [...ts].sort((a, b) => a.startedAt - b.startedAt)
    for (const a of sorted) {
      const hs = kindsByThread.get(key(a)) || []
      const lastH = hs[hs.length - 1]
      if (!lastH || lastH.c.kind !== 'steer') continue
      const b = sorted.find((x) => x.source !== a.source && x.startedAt > lastH.ev.t && x.startedAt - lastH.ev.t < 2 * 3600_000)
      if (b) {
        switches++
        const firstB = (kindsByThread.get(key(b)) || [])[0]
        if (firstB && (!switchExample || b.startedAt > switchExample.at)) switchExample = { from: a.source, to: b.source, project, at: b.startedAt, ref: { thread: key(b), ev: firstB.idx } }
      }
    }
  }

  const agentMs = Object.values(agentMsBySource).reduce((a, b) => a + b, 0)
  const totalEffort = [...effort.values()].reduce((a, b) => a + b, 0)
  const highEffort = ['xhigh', 'max', 'ultra'].reduce((s, k) => s + (effort.get(k) || 0), 0)
  const weeklyPeaks = [...weekly.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week, used]) => ({ week, used }))
  // real transcripts only: sessions rebuilt from prompt history have no replies, tools or models
  const transcriptClaude = classified.filter((c) => c.thread.source === 'claude-code' && !c.thread.recovered).map((c) => c.thread.startedAt)
  const firstTranscript = transcriptClaude.length ? Math.min(...transcriptClaude) : Infinity
  const ghost: Record<string, number> = {}
  for (const [d, n] of Object.entries(claudeStats?.daily || {})) if (n > 0 && new Date(`${d}T12:00:00`).getTime() < firstTranscript - 86400000) ghost[d] = n

  const deep: Deep = {
    work: {
      agentHours: agentMs / 3.6e6,
      agentHoursBySource: Object.fromEntries(SOURCE_KEYS.map((s) => [s, agentMsBySource[s] / 3.6e6])) as Record<SourceName, number>,
      timedTurns: turnMs.length,
      medianTurnMin: median(turnMs) / 60000,
      longestTurn: longest
        ? { min: longest.ms / 60000, project: longest.t.project, title: longest.t.title || clip((longest.t.events[longest.idx] as HumanEvent).text, 60), ref: { thread: key(longest.t), ev: longest.idx } }
        : null,
      actionsPerPrompt: observedPrompts ? actions / observedPrompts : 0,
      agentMinutesPerPrompt: timedPrompts ? agentMs / 60000 / timedPrompts : 0,
      perPromptBasis: { prompts, observed: observedPrompts, timed: timedPrompts },
      linesAdded,
      linesRemoved,
      filesTouched: files.size,
      languages: [...langs.entries()].map(([lang, v]) => ({ lang, lines: v.lines, files: v.files.size })).sort((a, b) => b.lines - a.lines).slice(0, 8),
      topFiles: [...files.entries()].map(([f, v]) => ({ file: f.slice(v.project.length + 1), project: v.project, turns: v.turns, lines: v.lines })).sort((a, b) => b.turns - a.turns).slice(0, 10),
      commands: {
        total: cmdTotal,
        categories: rows(cmdCats, [...COMMAND_CATEGORIES, { key: 'other', label: 'Other' }], cmdTotal, cmdExamples),
        top: [...cmdTop.entries()].map(([cmd, count]) => ({ cmd, count })).sort((a, b) => b.count - a.count).slice(0, 12),
      },
    },
    tasks: { agentThreads, tested, redGreen, long: longThreads, openings, specOpenings, mcpKinds: [...mcp].sort() },
    // filled in from the usage ledger, once spend is known
    tokens: { input: 0, cached: 0, output: 0, byModel: [] },
    limits: weeklyPeaks.length || windowsAtLimit ? { plan, weeklyPeaks, weeksAtLimit: weeklyPeaks.filter((w) => w.used >= 100).length, windowsAtLimit } : null,
    effort: {
      levels: rows(effort, [...effort.keys()].map((k) => ({ key: k, label: k })), totalEffort),
      highShare: totalEffort ? highEffort / totalEffort : 0,
      planModeTurns,
    },
    manners: { please: pleasePrompts, thanks: thanksPrompts },
    swear: {
      prompts: swearPrompts,
      per100: prompts ? (swearPrompts / prompts) * 100 : 0,
      words: [...words.entries()].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count),
      bySource: SOURCE_KEYS.filter((s) => promptsBySource.get(s))
        .map((s) => ({ source: s, count: swearBySource.get(s) || 0, per100: ((swearBySource.get(s) || 0) / (promptsBySource.get(s) || 1)) * 100 })),
      byProject: [...swearByProject.entries()]
        .filter(([, v]) => v.n > 0 && v.prompts >= 50)
        .map(([project, v]) => ({ project, count: v.n, per100: (v.n / v.prompts) * 100 }))
        .sort((a, b) => b.per100 - a.per100)
        .slice(0, 5),
      allCaps,
      loudest: loudest ? ex(loudest.t, loudest.idx, 300) : null,
      first: firstSwear ? ex(firstSwear.t, firstSwear.idx, 240) : null,
      worstDay: swearDays.size ? [...swearDays.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => b.count - a.count)[0] : null,
      inSteers: swearInSteers,
    },
    steeringByModel: [...byModel.entries()]
      .filter(([, v]) => v.followups >= 100)
      .map(([model, v]) => ({ model, source: v.source, followups: v.followups, steers: v.steers, rate: v.steers / v.followups, interrupts: v.interrupts }))
      .sort((a, b) => b.rate - a.rate),
    timeToSteer: { medianSec: median(steerGaps), fastest: fastest ? ex(fastest.t, fastest.idx) : null, samples: steerGaps.length },
    chains: { longest: longestChain?.n ?? 0, example: longestChain ? ex(longestChain.t, longestChain.idx) : null, recoveredShare: chains ? recovered / chains : 0 },
    intents: rows(intents, [...INTENTS, { key: 'other', label: 'Something else' }], [...intents.values()].reduce((a, b) => a + b, 0), intentExamples),
    crossTool: { projectsOnBoth, switches, example: switchExample },
    retention:
      claudeStats && claudeStats.totalSessions
        ? {
            claudeSince: claudeStats.since,
            claudeSessions: claudeStats.totalSessions,
            transcriptSince: transcriptClaude.length ? Math.min(...transcriptClaude) : null,
            transcriptSessions: transcriptClaude.length,
            retentionDays: claudeStats.retentionDays,
            configured: claudeStats.retentionConfigured,
            missingDays: Object.keys(ghost).length,
            ghostDays: ghost,
          }
        : null,
  }
  return deep
}
