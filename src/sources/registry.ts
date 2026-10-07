// Every agent lore can read, in one place: its key, its name, its color. The order is fixed
// (per-source arrays in the report follow it), and new agents go at the end. Pure, so the
// report and the site can use it too.

export const SOURCES = [
  { key: 'claude-code', label: 'Claude Code', short: 'Claude', color: 'claude' },
  { key: 'codex', label: 'Codex', short: 'Codex', color: 'codex' },
  { key: 'gemini', label: 'Gemini CLI', short: 'Gemini', color: 'gemini' },
  { key: 'pi', label: 'Pi', short: 'Pi', color: 'pi' },
  { key: 'openclaw', label: 'OpenClaw', short: 'OpenClaw', color: 'openclaw' },
  { key: 'opencode', label: 'OpenCode', short: 'OpenCode', color: 'opencode' },
  { key: 'kilo', label: 'Kilo CLI', short: 'Kilo', color: 'kilo' },
  { key: 'qwen', label: 'Qwen Code', short: 'Qwen', color: 'qwen' },
  { key: 'copilot', label: 'Copilot CLI', short: 'Copilot', color: 'copilot' },
] as const

export type SourceName = (typeof SOURCES)[number]['key']
export const SOURCE_KEYS: SourceName[] = SOURCES.map((s) => s.key)
export const isSource = (s: unknown): s is SourceName => SOURCE_KEYS.includes(s as SourceName)
export const sourceLabel = (s: string) => SOURCES.find((x) => x.key === s)?.label ?? s
/** A zero for every source, for per-source tallies. */
export const perSource = <T>(v: () => T): Record<SourceName, T> => Object.fromEntries(SOURCE_KEYS.map((k) => [k, v()])) as Record<SourceName, T>
/** Per-day and per-week counts are arrays in SOURCE_KEYS order. */
export const sourceIndex = (s: SourceName) => SOURCE_KEYS.indexOf(s)
