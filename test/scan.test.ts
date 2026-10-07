import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

// the scan caches parsed files under LORE_HOME: keep this test's out of the real one
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-scan-'))
process.env.LORE_HOME = path.join(tmp, 'home')
const { scan } = await import('../src/pipeline/scan.ts')

const day = path.join(tmp, '.codex', 'sessions', '2026', '02', '01')
const session = (name: string, meta: object, totals: number[]) => {
  fs.mkdirSync(day, { recursive: true })
  const lines = [
    { timestamp: '2026-02-01T00:00:00Z', type: 'session_meta', payload: { cwd: '/x', originator: 'codex-tui', source: 'cli', ...meta } },
    { timestamp: '2026-02-01T00:00:01Z', type: 'turn_context', payload: { model: 'gpt-5.5' } },
    { timestamp: '2026-02-01T00:00:01Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `task ${name}` }] } },
    ...totals.map((total, i) => ({
      timestamp: `2026-02-01T00:0${i + 1}:00Z`,
      type: 'event_msg',
      payload: { type: 'token_count', info: { total_token_usage: { input_tokens: total - 10, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: total }, last_token_usage: { input_tokens: (total - (totals[i - 1] || 0)) - 10, cached_input_tokens: 0, output_tokens: 10, total_tokens: total - (totals[i - 1] || 0) } } },
    })),
  ]
  fs.writeFileSync(path.join(day, `rollout-${name}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
}

test('Codex usage: copies count once within a session family, look-alikes in unrelated sessions both count', async () => {
  session('a', { id: 'A' }, [500])
  session('b', { id: 'B' }, [500]) // unrelated, same totals by chance
  session('f', { id: 'F', forked_from_id: 'A' }, [500, 800]) // a fork of A: replays A's call, adds one
  session('g', { id: 'G', forked_from_id: 'F' }, [500, 800, 1100]) // a fork of the fork
  const empty = { dir: path.join(tmp, 'none'), where: '' }
  const r = await scan({ workerUrl: null, roots: { claude: [empty], codex: [{ dir: path.join(tmp, '.codex'), where: '' }], gemini: [], pi: [], openclaw: [], opencode: [], kilo: [], qwen: [], copilot: [], claudeDesktop: [] } })
  const calls = r.usage.rows.filter((x) => x.source === 'codex').reduce((a, x) => a + x.calls, 0)
  // A's call, B's call, F's new call, G's new call
  assert.equal(calls, 4)
})
