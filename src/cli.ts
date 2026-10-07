import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { VERSION, loadConfig, readState, saveConfig, writeState } from './config.ts'
import { buildReport } from './pipeline/facts.ts'
import { scan } from './pipeline/scan.ts'
import { markOf, recordRun, sinceLast } from './pipeline/since.ts'
import { fortune } from './fortunes.ts'
import { manifestoText } from './manifesto.ts'
import { SOURCES } from './sources/registry.ts'
import { discoverRoots } from './sources/roots.ts'
import { buildStats } from './pipeline/stats.ts'
import { repoShape } from './pipeline/supply.ts'
import { countRun, machineFacts, sendStatsIfDue, type StatsStatus } from './pipeline/upload.ts'
import { startServer } from './server/local.ts'
import { finalBlock, livePane, paint, stopPane } from './terminal.ts'
import { host, launch, openCommand } from './util/platform.ts'

const HELP = `
  lore — your work with AI agents, reconstructed from local history

  Usage
    lore                 scan, then open your report in the browser
    lore stats           print the exact anonymous stats this run would send
    lore stats off|on    stop or resume sending them, on every run
    lore stats repos on  also send counts across the repos agents edited in
                         (tests, CI, sizes, ages, hosts; no names or paths)
    lore manifesto       what lore is for, and how it will make money
    lore --json          print the full local report as JSON (nothing is sent)

  Options
    --port <n>           port for the local report (default: random)
    --no-open            don't open a browser
    --no-stats           don't send anonymous stats this run (also off with
                         DO_NOT_TRACK, LORE_NO_STATS, CI, or Claude Code's
                         DISABLE_TELEMETRY / CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC)
    --no-ai              never call a model: the optional story is switched off
    --offline            nothing leaves this machine: no stats, no index, no
                         model calls
    --no-anim            plain output, no terminal animation
    --no-wsl             on Windows, don't look inside WSL distros for history
    --endpoint <url>     where anonymous stats go and the index comes from
    -v, --version
    -h, --help

  Privacy
    Your history and the report stay on this machine, except what the
    optional story sends to your own Claude or Codex when you click it.
    Anonymous counts (every field: \`lore stats\`) are sent when you run
    lore. Running it again the same month doesn't send again. Nothing runs
    in the background.
    Turn it off with \`lore stats off\`, --no-stats or DO_NOT_TRACK=1.
`

const { dim, bold, accent } = paint
const n = (x: number) => Math.round(x).toLocaleString('en-US')

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}
function opt(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const args = process.argv.slice(2)
  if (flag('help') || args.includes('-h')) return void console.log(HELP)
  if (flag('version') || args.includes('-v')) return void console.log(VERSION)

  if (args[0] === 'manifesto') return void console.log(manifestoText(Math.min(process.stdout.columns || 80, 84) - 4, { bold, dim, accent }))
  // not in the help: an easter egg for people who read the source, or the website's terminals
  if (args[0] === 'fortune') return void console.log(`\n  ${fortune()}\n  ${dim('— lore')}\n`)
  if (args[0] === 'stats' && args[1] === 'repos' && (args[2] === 'on' || args[2] === 'off')) {
    saveConfig({ repoStats: args[2] === 'on' })
    return void console.log(args[2] === 'on' ? '\n  Repo stats are on: runs also send counts across the repos agents edited in. See them with `lore stats`.\n' : '\n  Repo stats are off. Runs send only the counts from your agents’ history.\n')
  }
  if (args[0] === 'stats' && (args[1] === 'off' || args[1] === 'on')) {
    saveConfig({ stats: args[1] === 'on' })
    return void console.log(args[1] === 'on' ? "\n  Anonymous stats are on: sent when you run lore. Running it again the same month doesn't send again. `lore stats off` stops them.\n" : '\n  Anonymous stats are off on this machine. `lore stats on` turns them back on.\n')
  }
  const cfg = loadConfig({ endpoint: opt('endpoint'), stats: flag('no-stats') ? false : undefined, ai: flag('no-ai') ? false : undefined, offline: flag('offline') || undefined })
  // a run whose output goes to a file or pipe is a script, not a person deciding to share
  if (cfg.stats && !process.stdout.isTTY) Object.assign(cfg, { stats: false, statsOff: 'a non-terminal run' })
  const quiet = flag('json') || args[0] === 'stats'
  const here = path.dirname(fileURLToPath(import.meta.url))
  const workerUrl = new URL('./worker.js', import.meta.url)

  const live = quiet || flag('no-anim') ? null : livePane(VERSION, workerUrl)
  const result = await scan({
    workerUrl,
    roots: discoverRoots({ noWsl: flag('no-wsl') || undefined }),
    onProgress: (p) => {
      if (p.phase === 'parse') live?.update(p.done, p.total, p.bytesDone, p.bytesTotal)
    },
  })
  live?.deal()

  const { report, classified } = buildReport(result)
  const runs = readState().runs
  report.since = sinceLast(report, runs)

  if (flag('json')) return void console.log(JSON.stringify(report, null, 2))
  // repo stats only when chosen: they read the repos themselves, not just the history
  if (cfg.repoStats && (cfg.stats || args[0] === 'stats')) report.repoShape = await repoShape(result.threads)
  if (args[0] === 'stats') return void console.log(JSON.stringify(buildStats(report, machineFacts()), null, 2))

  const t = report.totals
  const d = report.deep
  const w = d.work
  const sp = report.spend
  const big = (x: number) => (x >= 1e9 ? `${(x / 1e9).toFixed(1)}B` : x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e4 ? `${Math.round(x / 1e3)}k` : n(x))
  // agent hours are a floor when transcripts are gone: say how much was timed, and what the rest adds
  const about = (x: number) => n(x >= 1000 ? Math.round(x / 100) * 100 : Math.round(x / 10) * 10)
  const timing = [
    w.agentHoursFloor && `timed on ${Math.round((w.perPromptBasis.timed / w.perPromptBasis.prompts) * 100)}% of prompts`,
    w.agentHoursFloor && w.agentHoursEst >= w.agentHours * 1.05 && `~${about(w.agentHoursEst)} est. in all`,
    w.subagentHours >= 1 && `+${n(w.subagentHours)} in subagents`,
  ].filter(Boolean)
  const gb = result.coverage.reduce((s, c) => s + c.bytes, 0) / 1e9
  await live?.stop()
  if (t.prompts === 0) {
    console.log(`\n  No agent history found (lore reads ${SOURCES.map((x) => x.label).join(', ')}). Use one for a while, then run lore again.\n`)
    return
  }
  // The card itself stays face down until the report: the terminal doesn't spoil it.
  console.log(
    '\n' +
      finalBlock([
        `${bold('lore')} ${dim(`v${VERSION}`)}`,
        '',
        bold('Your card is ready.'),
        `${big(t.prompts)} prompts ${dim('·')} ${n(t.activeDays)} days ${dim('·')} ${n(t.threads)} conversations ${dim('on record')}`,
        `${n(w.agentHours)}${w.agentHoursFloor ? '+' : ''} agent hour${Math.round(w.agentHours) === 1 && !w.agentHoursFloor ? '' : 's'} ${dim('·')} ${sp.totalUsd >= 1 ? `$${big(sp.totalUsd)} API-equivalent ${dim('·')} ` : ''}${big(sp.tokens || d.tokens.input + d.tokens.cached + d.tokens.output)} tokens`,
        dim(timing.join(' · ')),
        dim(`${gb.toFixed(1)} GB of history in ${(result.scanMs / 1000).toFixed(1)}s · ${n(result.filesParsed)} parsed, ${n(result.filesFromCache)} cached · 0 model calls`),
        '',
      ]) +
      '\n',
  )

  for (const c of report.coverage.sources) {
    if (!c.found) {
      // the two lore was built around get a line either way; others only when present
      if (c.source === 'claude-code' || c.source === 'codex') console.log(`  ${dim('○')} ${c.label.padEnd(12)} ${dim('not found')}`)
      continue
    }
    const bits = [`${bold(n(c.mainThreads))} threads${c.recoveredThreads ? ' on disk' : ''}`]
    if (c.recoveredThreads) bits.push(`${bold(n(c.recoveredThreads))} rebuilt from your prompt history`)
    else bits.push(`${n(c.files)} files${c.archivedFiles ? ` (${n(c.archivedFiles)} archived)` : ''}`)
    const skipped = [c.automatedThreads && `${n(c.automatedThreads)} automated run${c.automatedThreads === 1 ? '' : 's'}`].filter(Boolean)
    console.log(`  ${accent('●')} ${c.label.padEnd(12)} ${bits.join(dim(' · '))}${skipped.length ? dim(` · skipped ${skipped.join(', ')}`) : ''}`)
  }
  const ret = d.retention
  if (ret && !ret.configured) console.log(`    ${dim(`! Claude Code deletes transcripts after ${ret.retentionDays} days. The report can keep a year from now on.`)}`)
  console.log('')

  countRun()
  const stats = await sendStatsIfDue(report, cfg)
  const statsLine: Record<StatsStatus['state'], string> = {
    // the run that sends says what it sent and how to see or stop it, the first run included
    sent: `sent: anonymous counts for the public index. ${dim('Counts only: no prompts, code, paths or names.')}`,
    'already-sent': `already sent this month`,
    disabled: `anonymous aggregate stats off ${dim(`(${cfg.statsOff || 'your config'})`)}`,
    'no-endpoint': `anonymous aggregate stats not sent ${dim('— no collector configured')}`,
    failed: `anonymous aggregate stats not sent ${dim(`— ${stats.detail}`)}`,
    pending: `anonymous aggregate stats pending`,
  }
  if (cfg.offline) console.log(`  ${dim('Offline')}  nothing leaves this machine: no stats, no index, no uploads, no model calls`)
  else {
    console.log(`  ${dim('Stats')}  ${statsLine[stats.state]}`)
    if (stats.state === 'sent')
      console.log(`         ${dim('See them:')} ${bold('npx lore-wrapped stats')} ${dim('· Stop:')} ${bold('npx lore-wrapped stats off')}`)
    if (!cfg.ai) console.log(`  ${dim('Models')} off: lore won't call a model this run`)
  }

  const sc = report.since
  if (sc) {
    const bits = [
      sc.prompts && `+${n(sc.prompts)} prompts`,
      sc.projects && `${n(sc.projects)} new project${sc.projects === 1 ? '' : 's'}`,
      sc.card && `${bold('a new card')} ${dim(`(was ${sc.card.from})`)}`,
      sc.twin && `a new twin ${dim(`(was ${sc.twin.from})`)}`,
    ].filter(Boolean)
    if (bits.length) console.log(`  ${dim(`Since ${new Date(sc.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`)}  ${bits.join(dim(' · '))}`)
  }

  const server = await startServer({ report, classified, cfg, stats, webDir: path.join(here, 'web') }, Number(opt('port') || 0))
  writeState({ runs: recordRun(runs, markOf(report)) })
  console.log(`\n  ${bold('Turn your card over')} ${accent(server.url)}`)
  console.log(`  ${dim('Runs only on this machine, in one browser. Press Ctrl+C to stop.')}\n`)

  if (flag('no-open') || !launch(openCommand(server.url, host()))) {
    const h = host()
    if (h.env.SSH_CONNECTION || h.env.SSH_TTY) {
      const port = new URL(server.url).port
      console.log(`  ${dim(`Over SSH? On your own machine run: ssh -L ${port}:127.0.0.1:${port} <this host>, then open ${server.url}`)}\n`)
    } else if (!flag('no-open')) console.log(`  ${dim('Open the link above in your browser.')}\n`)
  }
  const stop = () => {
    server.close()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

main().catch(async (e) => {
  await stopPane()
  console.error(`\n  lore failed: ${e?.stack || e}\n`)
  process.exit(1)
})
