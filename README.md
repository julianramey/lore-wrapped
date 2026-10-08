# lore

[![npm](https://img.shields.io/npm/v/lore-wrapped)](https://www.npmjs.com/package/lore-wrapped)
[![CI](https://github.com/julianramey/lore-wrapped/actions/workflows/ci.yml/badge.svg)](https://github.com/julianramey/lore-wrapped/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/julianramey/lore-wrapped)](LICENSE)

Wrapped for your coding agents: a local recap of your Claude Code, Codex, Gemini CLI and other agent history.

[Quick start](#quick-start) • [Privacy](#privacy) • [What it reads](#what-it-reads) • [Usage](#usage) • [Development](#development)

<p align="center">
  <img src="https://raw.githubusercontent.com/julianramey/lore-wrapped/main/docs/card.png" width="320" alt="A lore share card from a fictional sample run: card XI, The Volcano">
</p>

## Quick start

```bash
npx lore-wrapped
```

Needs Node 22.13+. Reads the agent history already on your machine and opens your report on `127.0.0.1`. No account, and no model calls unless you ask.

```bash
npx.cmd lore-wrapped                  # Windows PowerShell (its default policy blocks npx.ps1)
bunx lore-wrapped                     # or: pnpm dlx lore-wrapped
npx github:julianramey/lore-wrapped   # straight from GitHub, built on your machine
```

To read the code first: `git clone https://github.com/julianramey/lore-wrapped && cd lore-wrapped && npm install && npm start`.

## What you get

- **Your card**: one of 14 in the lore deck, dealt from how you work, with a four-letter code.
- **Your twin**: the builder whose way of working points the same way as yours.
- **Since your last run**: new prompts, new projects, and whether your card changed.
- **Share cards**: posts and stories with counts and your card. No code, quotes or project names.
- **The year**: every day as a contribution graph, by agent.
- **The records**: longest streak and session, busiest day, latest night, and rock bottom.
- **The branches**: your projects as a git graph.
- **Your models**: the models that did the most work, what each cost, and how often you redirected it.
- **The bill**: what your tokens would cost at API prices, next to what your plans cost. You guess first.
- **In your words**: your most repeated prompt, your most used word, and the swear jar.
- **Where you rank**: your Claude Code spend per day against Anthropic's published numbers, then the lore index.
- **The lore**: moments you forgot, from the first prompt of every project to the file that wouldn't die.
- **The deep dive**: seven spectra, agent hours, lines, languages and commands, each with its definition.
- **Versus a friend**: swap short codes and see how in sync you are. No server involved.
- **The data**: every number behind the report, and a calendar reminder for the 1st of the month.

## Privacy

| What | Where it goes |
| --- | --- |
| Your history: prompts, replies, code, paths, project names | Stays on your machine, except what the optional story sends when you click it. Parsed copies are cached in `~/.lore`, readable only by you. The report runs on `127.0.0.1` and opens from a one-time link. |
| Anonymous counts (every field below) | Sent to lore's collector when you run lore. Running it again the same month doesn't send again. Nothing runs in the background. |
| Repo stats (off unless you turn them on) | Only after `npx lore-wrapped stats repos on`: counts across the repos your agents edited, with no names, paths, URLs or authors. |
| The public index | Downloaded from lore's collector (`GET /v1/index`) when the report opens, to rank you on your machine. Nothing about you is sent. It still happens with stats off; `--offline` skips it. |
| The optional written story | Only when you click for it, through your own Claude or Codex CLI on your own plan. It gets lore's numbers, your top project names, and up to 8 short prompt excerpts and 5 phrases you repeat, with secrets, emails, URLs and paths redacted. For Codex, lore also reads your plan's rate-limit window before and after (via `codex app-server`) to show what the call cost. |
| Your email | Only if you join the waitlist. Kept in its own list, separate from the stats. |

**Why the counts:** they rank you (the report downloads the public index and compares on your machine) and build the public lore index. No account or install id, no IP kept, and raw rows are never published or sold.

**The server:** you can't inspect a server from your machine, so its code is public. [`collector/`](collector) is exactly what runs at `api.lore-wrapped.com`, a Cloudflare Worker of about 250 lines (`src/index.ts`). It stores each payload with the month it arrived (raw rows kept 13 months) and counters. Every 10 minutes it rebuilds the index from the counters, published only from 25+ runs, with a new snapshot only after 25+ new runs. A refused payload isn't kept: it only adds one to a count of refusals by month and the first field that failed. No IPs or user agents are stored, and no raw row is ever published or sold. Tests are in `collector/test`.

**Turn it off:**

```bash
npx lore-wrapped stats        # print this run's exact payload
npx lore-wrapped stats off    # stop sending, on every run (stats on to resume)
npx lore-wrapped --offline    # nothing leaves the machine: no stats, no index, no model calls
```

Also off with `--no-stats`, `DO_NOT_TRACK=1`, `LORE_NO_STATS=1`, or Claude Code's `DISABLE_TELEMETRY` and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`. CI never sends, and neither do piped runs, unless a coding agent is running lore for you (Claude Code, Codex, Gemini CLI, Qwen Code, OpenCode and Kilo mark the commands they run).

**Every field:** the collector rejects anything not on this list. `node scripts/readme-fields.ts` writes this table from `src/pipeline/indexAgg.ts`, and a test fails if the code sends a field that isn't here.

| Field | What it is |
| --- | --- |
| `schema` | which version of this list the payload follows |
| `client` | the lore version that sent it |
| `sources` | which agents you use (Claude Code, Codex, …), no versions or accounts |
| `history_months` | how many months of history lore could read |
| `threads` | how many conversations |
| `prompts` | how many prompts you sent |
| `active_days` | how many days you used agents |
| `projects` | how many projects (just the number, no names) |
| `median_prompt_words` | how many words a typical prompt runs |
| `steer_rate` | the share of your follow-ups that redirect the agent |
| `approval_rate` | the share of your follow-ups that are short approvals (“yes”, “go”) |
| `interrupts_per_100` | how often you stop an agent mid-turn, per 100 prompts |
| `night_share` | the share of prompts sent between 10pm and 4am |
| `weekend_share` | the share of prompts sent on weekends |
| `model_share` | which model families did your work, as rounded shares |
| `steer_themes` | what your redirects are about, from a fixed list (“it’s broken”, “simplify”…) |
| `steer_by_model` | how often each model family gets redirected |
| `intents` | what opening prompts ask for, from a fixed list (fix, build, explain…) |
| `archetype` | your card in the lore deck |
| `type_code` | your four-letter code |
| `agent_hours` | hours agents worked for you, as timed in your history |
| `lines_added` | lines agents wrote |
| `high_effort_share` | the share of agent turns at the highest effort setting |
| `swear_per_100_by_tool` | swears per 100 prompts, per agent |
| `median_seconds_to_steer` | how many seconds you typically take to redirect after a reply |
| `api_usd` | what your tokens would cost at API list prices, in dollars |
| `swear_per_100` | swears per 100 prompts |
| `please_per_100` | prompts with a “please”, per 100 |
| `thanks_per_100` | prompts with a “thanks”, per 100 |
| `caps_per_100` | all-caps prompts, per 100 |
| `top_swear` | your most used swear, only from lore’s fixed list, or “none” |
| `twin` | which builder your way of working points toward |
| `top_reply` | your most repeated prompt, only if it’s a short stock reply (“yes”, “continue”…), otherwise “none” |
| `longest_session_hours` | your longest session, in hours |
| `streak_days` | your longest daily streak, in days |
| `tokens` | tokens processed |
| `subagent_token_share` | the share of tokens spent by subagents |
| `agent_seconds_per_prompt` | seconds of agent work per prompt |
| `actions_per_prompt` | tool calls per prompt |
| `cache_share` | the share of tokens that were cached context |
| `tokens_per_prompt` | tokens per prompt |
| `steers` | how many redirects in total |
| `switches_after_steer` | how often you switched agents right after redirecting one |
| `interrupt_by_model` | how often each model family gets stopped mid-turn |
| `test_run_share` | the share of conversations where an agent ran your tests |
| `red_green_threads` | conversations where a test failed and later passed |
| `long_threads` | conversations with 2+ hours of agent work or 100+ tool calls |
| `spec_prompt_share` | the share of opening prompts that run 100 words or more |
| `edit_langs` | which languages agents edited, as rounded shares of lines, from a fixed list |
| `mcp_kinds` | which kinds of MCP tools agents used (issue tracker, database, browser…), from a fixed list, without server names |
| `os` | macOS, Linux, Windows or WSL |
| `first_run_month` | the month lore first ran on this machine, so we can tell new runs from returning ones without an id |
| `lore_runs` | how many times lore has run on this machine |
| `notice` | which version of the privacy notice was in effect |
| `repos` | how many git repos agents edited in *(repo stats only)* |
| `repos_tests` | how many of them have a test suite *(repo stats only)* |
| `repos_ci` | how many have CI config *(repo stats only)* |
| `repos_container` | how many have a Dockerfile, compose file, devcontainer or Nix file *(repo stats only)* |
| `agent_md` | how many have an AGENTS.md, CLAUDE.md or GEMINI.md *(repo stats only)* |
| `repo_frameworks` | which frameworks appear, from a fixed list, without package names *(repo stats only)* |
| `repo_files` | how many repos fall in each size range by tracked files *(repo stats only)* |
| `repo_age` | how many repos fall in each age range since their first commit *(repo stats only)* |
| `remote_hosts` | how many repos are on GitHub, GitLab, Bitbucket, Azure, elsewhere or nowhere; the URL stays on your machine *(repo stats only)* |
| `license_families` | how many repos are permissive, copyleft, other or unlicensed *(repo stats only)* |
| `team_size` | how many repos had 1, 2–5, 6–20 or 21+ authors in 90 days; only the counts are sent, not the authors *(repo stats only)* |
| `kept_rate` | the share of recent agent edits committed within 72 hours *(repo stats only)* |
| `revert_rate` | the share of those commits reverted within 14 days *(repo stats only)* |

**Audit us:** paste this into Claude Code, Codex or any agent you trust.

```text
Audit the npm package lore-wrapped before I run it. Assume it might be lying to me.
1. Get the code without running it: `npm pack lore-wrapped`, then unpack the .tgz into a scratch folder (or clone its GitHub repo).
2. Find every network call (fetch, http, https, net, dns, WebSocket, and any child process that could reach the network) and every file it reads or writes outside that folder.
3. For each one: what data, sent where, when, and what triggers it.
4. Compare that with the Privacy section of the package's README.md and flag anything it sends that isn't listed there. What the server does with it is in the GitHub repo's collector/ folder.
5. Run `npx lore-wrapped stats` and check that the printed payload is all the code would send.
6. Rate each finding none, low, medium or high risk, then give me a one-line verdict: is it safe to run, and what should I turn off?
```

## What it reads

| Agent | Location | Notes |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/*/*.jsonl` | SDK-driven sessions excluded; `subagents/` read for token counts and time only |
| Claude Code prompt history | `~/.claude/history.jsonl` | Never cleaned up, so sessions Claude deleted after 30 days come back as prompts-only threads, with no agent time on record (agent hours show as a floor, plus an estimate) |
| Claude Code stats | `~/.claude/stats-cache.json` | Tokens by model and day, for days whose transcripts are gone |
| Claude plan | `~/.claude.json` | Only the plan type and rate-limit tier, for the plan cost, and `firstStartTime`, for when you started |
| Claude Desktop Code | `~/Library/Application Support/Claude/claude-code-sessions` | Joined to the CLI transcript by `cliSessionId`; Windows and Linux app data too |
| Codex (CLI, IDE, desktop) | `~/.codex/sessions`, `archived_sessions` | Subagents read for token counts and task times only; `exec`/SDK runs excluded |
| Gemini CLI | `~/.gemini/tmp/*/chats/session-*.json[l]`, `logs.json` | Messages folded by id; deleted chats come back as prompts from `logs.json` |
| OpenCode | `~/.local/share/opencode/opencode*.db`, `storage/` | Read-only SQLite, plus the pre-1.2 JSON tree; child sessions for token counts only |
| Kilo CLI | `~/.local/share/kilo/kilo*.db` | OpenCode's format |
| GitHub Copilot CLI | `~/.copilot/session-state/*/events.jsonl` | Tokens from each session's running totals |
| Qwen Code | `~/.qwen/projects/*/chats/*.jsonl` | Usage from assistant records only |
| Pi | `~/.pi/agent/sessions/*/*.jsonl` | Branches and forks counted once by entry id |
| OpenClaw | `~/.openclaw` (or `~/.clawdbot`, `~/.moltbot`): `agents/*/agent/openclaw-agent.sqlite`, `agents/*/sessions/*.jsonl` | Pi's format; chat envelopes and heartbeats dropped |

Each path honors the agent's own override: `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME`, `OPENCODE_DATA_DIR`, `KILO_DB`, `COPILOT_HOME`, `QWEN_HOME`, `PI_CODING_AGENT_DIR`, `OPENCLAW_STATE_DIR`, `XDG_DATA_HOME`.

On Windows lore also reads WSL distros, and inside WSL your Windows profile (`--no-wsl` skips both). Main threads only: hidden reasoning, tool output and injected context never enter the report, and forked history counts once.

## Usage

```bash
npx lore-wrapped                  # scan, then open the report
npx lore-wrapped stats            # print the exact anonymous payload
npx lore-wrapped stats off|on     # stop or resume sending it, on every run
npx lore-wrapped stats repos on   # also send repo counts (repos off to stop)
npx lore-wrapped manifesto        # what lore is for
npx lore-wrapped --json           # the full report as JSON; nothing is sent

# Options
--offline          # nothing leaves the machine: no stats, no index, no model calls
--no-stats         # don't send stats this run
--no-ai            # never call a model
--no-open          # don't open a browser
--no-anim          # plain output, no terminal animation
--port <n>         # port for the local report (default: random)
--endpoint <url>   # where stats go and the index comes from
--no-wsl           # on Windows, don't look inside WSL distros
-v, --version
-h, --help
```

Installed globally (`npm i -g lore-wrapped`), the command is also `lore`. The link lore prints opens the report in one browser; run lore again for a fresh one. Over SSH, lore prints the link and an `ssh -L` line instead of opening a browser.

## Why it's fast

21 GB of history in about 3 seconds, under a second once cached.

- **Skips most bytes**: files stream as raw bytes, and only the first 768 bytes of a line decide whether it gets parsed.
- **Uses every core**: files parse in a `worker_threads` pool.
- **Remembers**: threads are cached by file size and mtime, so a second run rereads only what changed.
- **Plain code**: the analysis is rules over counts. No model runs unless you ask for the story.

## Node API

```ts
import { scan, buildReport } from 'lore-wrapped'

const { report } = buildReport(await scan())
console.log(report.archetype.name, report.deep.work.agentHours)
```

The same local pipeline the CLI runs. Nothing in it sends data.

## Development

```bash
git clone https://github.com/julianramey/lore-wrapped && cd lore-wrapped
npm install                # installs and builds
npm test                   # node --test over the TypeScript sources
npm run typecheck
npm start                  # node dist/cli.js; npm start -- stats passes flags
node scripts/personas.ts   # simulated users, every agent format
```

```
src/sources/      one adapter per agent, and where each keeps history
src/pipeline/     scan, classify, facts, deep, spend, deck, lore, stats
src/terminal.ts   the live terminal pane
src/server/       the local report server
web/              the report UI (Preact)
scripts/          build, the README field table, simulated users
test/             node --test suites
collector/        the stats API at api.lore-wrapped.com, a Cloudflare Worker, and its tests
```

## Coming next

Get paid when AI labs want tasks from your history. `npx lore-wrapped manifesto` has the plan.

## License

[MIT](LICENSE). Questions, or lore for your team: [inquiries@lore-wrapped.com](mailto:inquiries@lore-wrapped.com)
