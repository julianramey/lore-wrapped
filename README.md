# lore

**Wrapped, for your coding agents.**

```bash
npx lore-wrapped
```

<img src="https://raw.githubusercontent.com/julianramey/lore-wrapped/main/docs/card.png" width="320" alt="A lore share card from a fictional sample run: card XI, The Volcano">

**Your agents remember everything.** Every prompt. Every "no, not like that." Every late night.

It's all on your disk as plain text. Nobody reads it.

**You did all that work. You should get to look at it.**

One command. About three seconds. Your year, dealt as a card.

## What you get

- **Your card.** One of fourteen in the lore deck, dealt from how you actually work.
- **Your twin.** The builder whose way of working points the same way as yours.
- **The bill.** What your tokens would cost at API prices. You guess first.
- **The swear jar.** Your swear of choice, counted. You said it first.
- **Your year.** Every day, every agent, every streak, your latest night.
- **The lore.** First prompts, last words, the file that wouldn't die.
- **Share cards.** Posts and stories, ready to go. Counts and your card, never your code.

Reads **Claude Code, Codex, Gemini CLI, OpenCode, Copilot CLI, Qwen Code, Pi, OpenClaw and Kilo CLI**.

Free. MIT. No account.

## Fast

- **21 GB of history in about 3 seconds.** Under a second once cached.
- **Streams raw bytes.** It checks the first 768 bytes of each line and only parses the lines it needs.
- **Every core.** Files parse in a `worker_threads` pool.
- **Cached** by file size and mtime. A second run rereads only what changed.
- **No model in the loop.** The analysis is plain code over counts.

## Privacy

**Your history stays on your machine.** The report runs on `127.0.0.1` behind a per-run token.

**No model calls**, unless you ask for the optional written story. That runs through your own Claude or Codex CLI, on your own plan.

**Anonymous counts, for the public index.** When you run lore, at most once a month, it sends counts like how many prompts, how often you redirect and which models. Never a word you typed, a file, a path or a name. Never in the background. Raw rows are never published or sold.

```bash
npx lore-wrapped stats       # print the exact payload
npx lore-wrapped stats off   # stop sending it, on every run
npx lore-wrapped --offline   # nothing leaves the machine at all
```

Also off with `--no-stats`, `DO_NOT_TRACK=1`, `LORE_NO_STATS=1`, Claude Code's `DISABLE_TELEMETRY` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, and in CI or piped runs. In the EU, the UK and Switzerland, lore asks first.

<details>
<summary>Every field it sends</summary>

The collector rejects anything not on this list. The table is written from `src/pipeline/indexAgg.ts` by `node scripts/readme-fields.ts`, and a test fails if the code sends a field that isn't here. Sending starts with your second run. To rank you, the report downloads the public index and compares on your machine.

Two things go out only when you choose them: repo stats (`npx lore-wrapped stats repos on`, counts across the repos your agents edited, never a name, path or URL), and your email, if you join the waitlist in the report (its own list, never linked to stats).

| Field | What it is |
| --- | --- |
| `schema` | which version of this list the payload follows |
| `client` | the lore version that sent it |
| `sources` | which agents you use (Claude Code, Codex, …), no versions or accounts |
| `history_months` | how many months of history lore could read |
| `threads` | how many conversations |
| `prompts` | how many prompts you sent |
| `active_days` | how many days you used agents |
| `projects` | how many projects (never their names) |
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
| `agent_hours` | hours agents worked for you |
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
| `mcp_kinds` | which kinds of MCP tools agents used (issue tracker, database, browser…), from a fixed list, never server names |
| `os` | macOS, Linux, Windows or WSL |
| `first_run_month` | the month lore first ran on this machine, so we can tell new runs from returning ones without an id |
| `lore_runs` | how many times lore has run on this machine |
| `notice` | which version of the privacy notice was in effect (never whether you were asked, which would hint at where you live) |
| `repos` | how many git repos agents edited in *(repo stats only)* |
| `repos_tests` | how many of them have a test suite *(repo stats only)* |
| `repos_ci` | how many have CI config *(repo stats only)* |
| `repos_container` | how many have a Dockerfile, compose file, devcontainer or Nix file *(repo stats only)* |
| `agent_md` | how many have an AGENTS.md, CLAUDE.md or GEMINI.md *(repo stats only)* |
| `repo_frameworks` | which frameworks appear, from a fixed list, never package names *(repo stats only)* |
| `repo_files` | how many repos fall in each size range by tracked files *(repo stats only)* |
| `repo_age` | how many repos fall in each age range since their first commit *(repo stats only)* |
| `remote_hosts` | how many repos are on GitHub, GitLab, Bitbucket, Azure, elsewhere or nowhere; never the URL *(repo stats only)* |
| `license_families` | how many repos are permissive, copyleft, other or unlicensed *(repo stats only)* |
| `team_size` | how many repos had 1, 2–5, 6–20 or 21+ authors in 90 days; authors are counted, never sent *(repo stats only)* |
| `kept_rate` | the share of recent agent edits committed within 72 hours *(repo stats only)* |
| `revert_rate` | the share of those commits reverted within 14 days *(repo stats only)* |

</details>

<details>
<summary>Don't trust us? Paste this into your agent</summary>

```text
Audit the npm package lore-wrapped before I run it. Assume it might be lying to me.
1. Get the code without running it: `npm pack lore-wrapped`, then unpack the .tgz into a scratch folder (or clone its GitHub repo).
2. Find every network call (fetch, http, https, net, dns, WebSocket, and any child process that could reach the network) and every file it reads or writes outside that folder.
3. For each one: what data, sent where, when, and what triggers it.
4. Compare that with the Privacy section of the package's README.md and flag anything it sends that isn't listed there.
5. Run `npx lore-wrapped stats` and check that the printed payload is all the code would send.
6. Rate each finding none, low, medium or high risk, then give me a one-line verdict: is it safe to run, and what should I turn off?
```

</details>

## Next: get paid for it

AI labs pay **$200 to $2,000 for one good coding task** ([Epoch AI, 2026](https://epoch.ai/gradient-updates/state-of-rl-envs)). Your history is full of them.

lore is building the way to sell yours. Floor: your agent work pays for your agent plan. Ceiling: thousands of dollars.

```bash
npx lore-wrapped manifesto
```

Questions, or want lore for your team? [inquiries@lore-wrapped.com](mailto:inquiries@lore-wrapped.com)

## Run it

```bash
npx lore-wrapped                      # from npm
npx github:julianramey/lore-wrapped   # straight from GitHub, built on your machine
```

Or read it first: `git clone https://github.com/julianramey/lore-wrapped && cd lore-wrapped && npm install && npm start`.

Node 22.13+. On Windows PowerShell: `npx.cmd lore-wrapped`.

```bash
npx lore-wrapped                  # scan and open the report
npx lore-wrapped stats            # print the exact anonymous payload
npx lore-wrapped stats off|on     # stop or resume sending it
npx lore-wrapped manifesto        # what lore is for
npx lore-wrapped --json           # the full report as JSON, nothing sent
npx lore-wrapped --offline        # no stats, no index, no model calls
npx lore-wrapped --no-ai          # never call a model
npx lore-wrapped --no-open --port 4747 --no-anim --no-wsl
```

Over SSH, it prints the report's address instead of opening a browser.

## Where it looks

Each agent's own history folder, honoring its override (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME`, `OPENCODE_DATA_DIR`, `COPILOT_HOME`, `QWEN_HOME`, `PI_CODING_AGENT_DIR`, `OPENCLAW_STATE_DIR`, `XDG_DATA_HOME`). On Windows it also reads WSL distros, and inside WSL your Windows profile. Main threads only; forked history counts once.

<details>
<summary>Every path, per agent</summary>

| Source | Location | Notes |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/*/*.jsonl` | SDK-driven sessions excluded; `subagents/` read for token counts only |
| Claude Code prompt history | `~/.claude/history.jsonl` | Never cleaned up; rebuilds deleted sessions as prompts-only threads |
| Claude Code stats | `~/.claude/stats-cache.json` | Tokens by model and day, to estimate days whose transcripts Claude already deleted |
| Claude plan | `~/.claude.json` | Only the plan type and rate-limit tier, for the plan-cost estimate |
| Claude Desktop Code | `~/Library/Application Support/Claude/claude-code-sessions` | Joined to the CLI transcript by `cliSessionId` |
| Codex (CLI, IDE, desktop) | `~/.codex/sessions`, `archived_sessions` | Subagents read for token counts only; `exec`/SDK runs excluded |
| Gemini CLI | `~/.gemini/tmp/*/chats/session-*.json[l]`, `logs.json` | Messages folded by id; deleted chats come back as prompts from `logs.json` |
| OpenCode | `~/.local/share/opencode/opencode*.db`, `storage/` | Read-only SQLite, plus the pre-1.2 JSON tree; child sessions for token counts only |
| Kilo CLI | `~/.local/share/kilo/kilo*.db` | OpenCode's format |
| GitHub Copilot CLI | `~/.copilot/session-state/*/events.jsonl` | Tokens from each session's running totals |
| Qwen Code | `~/.qwen/projects/*/chats/*.jsonl` | Usage from assistant records only |
| Pi | `~/.pi/agent/sessions/*/*.jsonl` | Branches and forks counted once by entry id |
| OpenClaw | `~/.openclaw` (or `~/.clawdbot`, `~/.moltbot`) | Pi's format; chat envelopes and heartbeats dropped |

</details>

## Hack on it

```bash
npm install          # installs and builds
npm test             # node --test over the TypeScript sources
npm run typecheck
npm start            # node dist/cli.js; npm start -- stats passes flags
node scripts/personas.ts   # simulated users, every agent format
```

```
src/sources/      one adapter per agent, and where each keeps history
src/pipeline/     scan, classify, facts, deep, spend, deck, lore, stats
src/terminal.ts   the live pane
src/server/       the local report server
src/collector/    a reference stats collector
web/              the report UI (Preact)
web/src/icons/    the deck's 3D objects, as signed-distance scenes
```

```ts
import { scan, buildReport } from 'lore-wrapped'

const { report } = buildReport(await scan())
console.log(report.archetype.name, report.deep.work.agentHours)
```

## License

MIT
