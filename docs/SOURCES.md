# Storage and subscription facts

Checked 2026-10-05 on macOS. Paths and schemas can change by version;
these are observed files, not a promise that every past conversation survives.

## Local history

| Source | Where | What we know |
| --- | --- | --- |
| Codex local transcripts | `$CODEX_HOME/sessions/` and `archived_sessions/`; default `~/.codex/` | JSONL includes session metadata, user/assistant messages, tool events, and turn context. CLI and desktop-originated sessions coexist. |
| Codex indexes | `~/.codex/state_5.sqlite`, `thread_history_1.sqlite` on this installation | Thread metadata and projected turns/items. Indexes can overlap transcripts; do not count them twice. |
| Claude Code main sessions | `~/.claude/projects/<project>/<session>.jsonl` | User/assistant messages, tool blocks, timestamps, model metadata, and workspace context. |
| Claude Code subagents | Nested `subagents/` directories under the project history | Excluded from conversation: they do not describe additional human conversations. Read only for the token usage on their assistant records, which is real spend. |
| Claude input history | `~/.claude/history.jsonl` | Input/history index; not a substitute for full transcripts. |
| ChatGPT desktop / local Work | `~/.codex/`; desktop state in `.codex-global-state.json` | Installed app code binds local Work routes to Codex session IDs. All 84 desktop-listed projectless thread IDs matched the thread index and existing JSONL files. This does not establish complete cloud-chat coverage or identify all 84 as Work sessions. |
| Claude Desktop Code | `~/Library/Application Support/Claude/claude-code-sessions/<account>/<org>/local_*.json` | Metadata's `cliSessionId` joins to `~/.claude/projects/<project>/<session>.jsonl`. The one desktop record here matched a 13.4 MB transcript and reports 84 completed turns. Deduplicate against CLI history. |
| Claude Cowork | `~/Library/Application Support/Claude/local-agent-mode-sessions/<account>/<org>/` | Installed code retains JSON task metadata and associated task files, with transcripts under `<task-dir>/.claude/projects/`. No local task records or JSONL files were found under this root here. |
| Ordinary ChatGPT / Claude chats | Official account export where available | A complete local archive was not established. Browser caches are not sufficient evidence of retained history. |

Observed transcript files: **1,790 active + 36 archived Codex**, **62 main
Claude Code + 591 Claude subagent**. Of the 1,826 Codex files, session metadata
explicitly marks 1,074 as subagents. The remaining 752 files are not all
confirmed main conversations: the shallow metadata check classified 722
other traces and left 30 unclassified. Resolve metadata without reading
subagent bodies. Counts are not unique human tasks and can change while apps run.

The premature recap selected only 100 recent files and omitted archives.
Its 95 sessions were a preview, not the machine's total history.

Local storage does not mean complete or permanent storage. Codex supports
ephemeral runs; Claude supports disabling session persistence. Deleted,
unretained, remotely stored, or missing history cannot be reconstructed just
because a subscription exists. Transcripts also do not preserve every
referenced file or a runnable historical environment.

Official references: [Codex execution/persistence](https://learn.chatgpt.com/docs/developer-commands),
[Work local versus cloud history](https://learn.chatgpt.com/docs/whats-new),
[Claude CLI persistence options](https://code.claude.com/docs/en/cli-reference),
[Claude data export](https://support.claude.com/en/articles/9450526-export-your-claude-data).
Exact filesystem paths/counts above came from local inspection.

## Desktop access approach

Neither app was found to use local PostgreSQL for this history. ChatGPT's
inspected databases are SQLite; retained transcripts are JSONL. Claude's
verified desktop Code record is JSON metadata pointing to a JSONL transcript.
Codex app-server also offers `thread/read` with `includeTurns`, so try supported
history access before depending on database internals. Verify Work coverage
and deduplicate desktop/CLI sessions by their shared IDs.
[Stored thread access](https://learn.chatgpt.com/docs/app-server).

These checks read retained metadata, transcript structure, and installed app
code without running model analysis or uploading anything. Versions inspected:
ChatGPT `26.924.22138` (`com.openai.codex`), Claude `2.19675.0`.
Claude's installed code also contains portable history export/import support
for chats, Cowork, and Code; whether that feature is enabled in this account's
UI has not been checked. Desktop-only adapters remain optional until their
coverage is verified. No complete Cowork corpus was recovered on this Mac.

## Analyze using an existing subscription

**Codex:** signing in with ChatGPT provides subscription access; `codex exec`
supports non-interactive runs and structured output. A local invocation can
reuse the CLI's login without us reading or uploading its credentials.
Product authentication must use the supported integration: current docs
distinguish local/open-source app-server clients from commercial/hosted services
and recommend Sign in with ChatGPT. Settle the applicable route before release.
[Authentication](https://learn.chatgpt.com/docs/auth),
[execution](https://learn.chatgpt.com/docs/developer-commands),
[app-server integration and quota endpoints](https://learn.chatgpt.com/docs/app-server).

**Claude:** Anthropic's current June 15 update says Agent SDK, `claude -p`,
and third-party SDK app usage still draws from subscription limits. This
supersedes the separate-credit proposal further down the same page.
[Current subscription policy](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan).

Both CLIs are installed here. Their help confirms JSON output and non-interactive
execution. Claude's `--tools ""` can disable tools. Its `--bare` mode explicitly
does **not** reuse subscription OAuth, so it is not our subscription shortcut.
Its dollar budget option should not be treated as a subscription quota cap.
[Claude programmatic execution](https://code.claude.com/docs/en/headless).

Codex app-server exposes quota readings via `account/rateLimits/read` and
token activity via `account/usage/read`. Measure quota changes around batches;
concurrent user activity can affect the reading. A comparable supported Claude
programmatic quota reader has not been established here. Both integrations
need a measured trial; no exact percentage-of-plan estimate is established.

## Verified for lore v0.2 (2026-10-05)

- **Claude Code retention.** Transcripts older than `cleanupPeriodDays` (default 30) are deleted; this Mac has no setting, so 56 of 229 sessions remain. `~/.claude/stats-cache.json` keeps daily message counts, tokens by model, total sessions and the first session date, which lore uses for coverage and to estimate tokens for days whose transcripts are gone.
- **Claude Code transcripts** carry per-message `usage` (input, cache creation, cache read, output), `system`/`turn_duration` records with `durationMs`, `cost-state` records with Claude Code's own API-equivalent `totalCostUSD` and line counts, `perTurnEffort`, `permissionMode`, `gitBranch`, and full `Edit`/`Write`/`Bash` tool inputs.
- **Codex rollouts** carry `event_msg`/`token_count` with `last_token_usage`, `total_token_usage` and `rate_limits` (plan type, primary window `used_percent`, window minutes, credits); `task_complete` with `duration_ms`; `turn_context` with model and effort; `session_meta.git` with the starting commit. Commands appear in six shapes across versions (`shell`, `shell_command`, `exec_command`, `apply_patch`, heredoc patches, and `exec` JavaScript calling `tools.exec_command`).
- **Plan usage per run.** `claude -p --output-format stream-json --verbose` emits `rate_limit_event` with five-hour and seven-day utilization. `codex app-server` answers `account/rateLimits/read` with the primary window's `usedPercent`; lore reads it before and after a run. `codex exec --json` reports token usage but not quota.
- **Harness overhead.** A minimal `codex exec` reply used about 19k input tokens; a lore narrative used 3.0k in / 0.7k out on Claude Haiku with thinking off (`MAX_THINKING_TOKENS=0`), and 21k in on Codex.

## Verified for lore v0.4 (2026-10-06)

- `~/.claude/history.jsonl` (the prompt history the up arrow recalls) is not subject to `cleanupPeriodDays`. On the reference machine it went back a full year while transcripts on disk covered 30 days. Each line has `display`, `timestamp` (epoch ms), `project` (cwd) and, for nearly all, `sessionId`. Slash commands are recorded too; lore counts them separately.
- `~/.claude/stats-cache.json` keeps `modelUsage` per model (input, output, cache-read and cache-creation tokens; `costUSD` is 0 on subscription plans), `dailyActivity` (messages, sessions, tool calls per day) and `dailyModelTokens` (total tokens per model per day, all kinds). Daily tokens can start months after daily activity (Claude added them later). `lastComputedDate` lags a few days.
- **Claude Code counts a reply once per record.** A reply is written as one JSONL record per content block (thinking, text, each tool call), and every record repeats the reply's full `usage`. On this machine 17,186 of 18,624 multi-record replies repeat it exactly; the rest carry a partial output count on the early records. `stats-cache.json` sums every record (its daily totals match the per-record sum to the token on days with complete transcripts), so it runs about 2.1× the tokens the API billed. lore keys each reply by `message.id` across all files, subagents and forks included, and keeps the fullest count. For days whose transcripts are gone, it scales Claude's stats by the replies-to-records ratio measured per model on the transcripts still on disk, and labels the result an estimate. The report shows Claude Code's own figure next to lore's so the two reconcile.
- **Codex repeats token counts.** `token_count` events are re-emitted with an unchanged `total_token_usage` when nothing new was billed, and a forked or subagent rollout replays its parent's events with new timestamps. lore counts an event only when the running total moves and keys it by that running total, so a replay lands on the same key. `output_tokens` already includes `reasoning_output_tokens`.
- `~/.claude.json` → `oauthAccount.organizationType` (`claude_max`, `claude_pro`) and `userRateLimitTier` / `organizationRateLimitTier` (e.g. `default_claude_max_20x`) identify the plan. Nothing else in that file is read.
- API list prices were taken from Anthropic's and OpenAI's pricing pages on 2026-10-06 (`src/pipeline/spend.ts` links both). `codex-auto-review` and `gpt-5.3-codex-spark` have no public API price and are shown as tokens only. Plan prices: Claude Pro $20, Max 5x $100, Max 20x $200; ChatGPT Plus $20, Pro $100/$200/$500 (the logs don't say which), Business $25 a seat.
- Anthropic's Claude Code cost page now says enterprise deployments average about $13 per developer per active day, under $30 for 90% of users (code.claude.com/docs/en/costs). lore compares your API-equivalent median day against that and nothing else until the lore index has real data.

## Verified for lore v0.5 (2026-10-06)

Formats for the newer adapters come from each tool's own source where it is open, and from public multi-agent parsers (ccusage, codeburn, tokscale, agentsview, agent-sessions) where it isn't (Copilot CLI). Each adapter has a fixture test, and the persona simulator (`scripts/personas.ts`) writes every format end to end. Commits read, all on 2026-10-06:

| Repo | Commit |
| --- | --- |
| google-gemini/gemini-cli | `ef59c532f07fbb3a58dd68bac024ae217e9c73ce` |
| QwenLM/qwen-code | `ac497aeed956981e817b4301837866730359a65f` |
| anomalyco/opencode | `ecc4916b5a9608c30e6dd58a67f2137b594407ca` |
| Kilo-Org/kilocode | `b3b682428ac8e04693586efd3776c33390c8fa33` |
| openclaw/openclaw | `dd619529b24acf32cdf35258852e13cf9e9c4792` |
| earendil-works/pi | `eb326d265ae0b88489a6d10319307780df827cdf` |
| openai/codex | `9479e1fdb7396c3e3254f5e123489af829186893` |

- **Codex `token_usage_record`.** Since about 0.150 every model response also writes a top-level `token_usage_record` (`response_id`, `usage`, `turn_token_usage`, `thread_token_usage`) just before its `token_count`. Its `usage` equals the `token_count`'s `last_token_usage` call for call (46,577 pairs on the reference machine). 438 records had no `token_count` at all: the calls that compact the context. lore counts those from the record, keyed by `response_id`, and everything else from `token_count` as before.
- **Codex paginated rollouts.** Rollouts rewritten to `history_mode: "paginated"` no longer carry `event_msg/user_message`, but still carry `response_item` messages and tool calls, which is what lore reads.
- **Gemini CLI** (since Oct 2026) appends a message again whenever its tokens or tool results land; lore folds by message id. `tokens.input` includes `cached`; `thoughts` bill as output. `logs.json` per project keeps every prompt after chats are deleted.
- **OpenCode ≥1.2** keeps `session`, `message` and `part` tables (plus a newer `session_message`) in `opencode.db`. Message `tokens.input` excludes cache reads and writes, and `output` excludes `reasoning`. Child sessions (`parent_id`) are the task tool's subagents. The pre-1.2 `storage/` JSON tree is left in place by the migration.
- **Copilot CLI** `session.shutdown` carries running totals per model (`inputTokens` includes cache reads and writes; reasoning is inside `outputTokens`), repeated on each resume.
- **Qwen Code** writes one `assistant` record per model turn with `usageMetadata` (`promptTokenCount` includes `cachedContentTokenCount`), and a telemetry copy of the same usage as `system/ui_telemetry`, which lore ignores.
- **Pi / OpenClaw** assistant messages carry `usage {input, output, cacheRead, cacheWrite, cacheWrite1h?, totalTokens, cost}` with `input` excluding cache. OpenClaw wraps chat messages as `[Channel Sender (@handle) id:… +elapsed date time TZ] text` plus a `[message_id: …]` line, sends its own heartbeat and restart prompts as user messages, and mirrors delivered replies as `delivery-mirror` assistant messages with no tokens. On the reference machine's legacy `~/.clawdbot`: 209 typed prompts out of 359 user records.
- **Prices** for retired and older models (Claude Opus 4/4.1, Sonnet 4/4.5, Haiku 3.5; GPT-4.1, GPT-5, GPT-5.1, GPT-5.1-Codex/-Max/-Mini, o3, o4-mini) come from the same official pages; Claude 3.5/3.7 Sonnet, no longer listed, are priced at their last published rate and say so.
