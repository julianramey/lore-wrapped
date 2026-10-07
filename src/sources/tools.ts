// Parses agent tool inputs into edits and shell commands. Shared by both adapters and
// by episodes, which re-read a turn's raw diffs on demand.

import type { EditStat } from '../types.ts'
import { relativeTo, tidyPath } from '../util/text.ts'

export const lines = (s: unknown) => (typeof s === 'string' && s.length ? s.split(/\r?\n/).length : 0)

export function relPath(file: string, cwd: string): string {
  if (!file) return ''
  return (cwd && relativeTo(file, cwd)) || tidyPath(file)
}

/** A unified-style patch: Codex apply_patch text. Returns per-file +/- counts. */
export function patchStats(patch: string, cwd: string): EditStat[] {
  const out = new Map<string, [number, number]>()
  let file = ''
  for (const l of patch.split(/\r?\n/)) {
    const m = l.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/)
    if (m) {
      file = relPath(m[1].trim(), cwd)
      if (!out.has(file)) out.set(file, [0, 0])
      continue
    }
    if (!file || l.startsWith('***') || l.startsWith('@@')) continue
    const cur = out.get(file)!
    if (l.startsWith('+')) cur[0]++
    else if (l.startsWith('-')) cur[1]++
  }
  return [...out.entries()].map(([f, [a, r]]) => [f, a, r])
}

/** Patch strings embedded in Codex "exec" JavaScript, as string or template literals. */
export function patchesInJs(js: string): string[] {
  const out: string[] = []
  for (const m of js.matchAll(/"((?:[^"\\]|\\.)*\*\*\* Begin Patch(?:[^"\\]|\\.)*)"/g)) {
    try {
      out.push(JSON.parse(`"${m[1]}"`))
    } catch {
      /* not a JSON-compatible literal */
    }
  }
  for (const m of js.matchAll(/`(\*\*\* Begin Patch[\s\S]*?)`/g)) out.push(m[1])
  return out
}

export function commandsInJs(js: string): string[] {
  const out: string[] = []
  for (const m of js.matchAll(/"cmd"\s*:\s*("(?:[^"\\]|\\.)*")/g)) {
    try {
      out.push(JSON.parse(m[1]))
    } catch {
      /* skip */
    }
  }
  return out
}

export interface ToolEffect {
  edits: EditStat[]
  cmds: string[]
  /** Raw change text for episodes: a patch, or a synthesized before/after. */
  diff: string
}

const clipCmd = (c: string) => c.replace(/\s+/g, ' ').trim().slice(0, 160)

/** Claude Code tool_use blocks. */
/** A command that runs a test suite, across the common runners. */
export const TEST_CMD = /\b(jest|vitest|pytest|mocha|playwright|cypress|rspec|go test|cargo test|xcodebuild test|(npm|pnpm|yarn|bun)( run)? test|node --test|swift test|dotnet test|Invoke-Pester)\b/i
/** A test runner's failure summary: a nonzero exit code is often lost to `| tail`. */
export const TEST_FAILED = /\b[1-9]\d* (failed|failing|failures?|errors?)\b|^(# |ℹ )fail [1-9]|^FAILED\b|^--- FAIL|^FAIL\b|test result: FAILED|\*\* TEST FAILED \*\*/im

export function claudeTool(name: string, input: any, cwd: string): ToolEffect {
  const e: ToolEffect = { edits: [], cmds: [], diff: '' }
  if (!input || typeof input !== 'object') return e
  const file = relPath(String(input.file_path || input.notebook_path || ''), cwd)
  if (name === 'Edit' || name === 'MultiEdit') {
    const edits = name === 'Edit' ? [input] : Array.isArray(input.edits) ? input.edits : []
    let a = 0
    let r = 0
    const parts: string[] = []
    for (const ed of edits) {
      a += lines(ed.new_string)
      r += lines(ed.old_string)
      parts.push(prefix(ed.old_string, '-') + '\n' + prefix(ed.new_string, '+'))
    }
    e.edits.push([file, a, r])
    e.diff = `*** Update File: ${file}\n@@\n${parts.join('\n@@\n')}`
  } else if (name === 'Write') {
    e.edits.push([file, lines(input.content), 0])
    e.diff = `*** Add File: ${file}\n${prefix(input.content, '+')}`
  } else if (name === 'Bash' && typeof input.command === 'string') {
    e.cmds.push(clipCmd(input.command))
  }
  return e
}

/** Codex function_call / custom_tool_call payloads. */
export function codexTool(type: string, name: string, payload: any, cwd: string): ToolEffect {
  const e: ToolEffect = { edits: [], cmds: [], diff: '' }
  let args: any = payload.arguments
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      args = {}
    }
  }
  const input = typeof payload.input === 'string' ? payload.input : ''
  const raw: string[] = []
  const patches: string[] = []
  if (name === 'apply_patch') patches.push(input || args?.input || '')
  else if (name === 'shell' && Array.isArray(args?.command)) {
    const c = args.command.map(String)
    raw.push(c.length >= 3 && /^(ba|z)?sh$/.test(c[0]) ? c[c.length - 1] : c.join(' '))
  } else if (name === 'shell_command' && typeof args?.command === 'string') raw.push(args.command)
  else if (name === 'exec_command' && typeof args?.cmd === 'string') raw.push(args.cmd)
  else if (type === 'custom_tool_call' && name === 'exec' && input) {
    raw.push(...commandsInJs(input))
    patches.push(...patchesInJs(input))
  }
  for (const c of raw) {
    if (typeof c !== 'string') continue
    // Older Codex versions applied patches through a shell heredoc.
    const m = c.match(/\*\*\* Begin Patch[\s\S]*?\*\*\* End Patch/)
    if (m) patches.push(m[0])
    else e.cmds.push(clipCmd(c))
  }
  for (const p of patches) mergeEdits(e.edits, patchStats(p, cwd))
  e.diff = patches.join('\n')
  return e
}

export function prefix(s: unknown, p: string): string {
  if (typeof s !== 'string' || !s) return ''
  return s
    .split('\n')
    .map((l) => p + l)
    .join('\n')
}

export function mergeEdits(into: EditStat[], add: EditStat[]): EditStat[] {
  for (const [f, a, r] of add) {
    if (!f) continue
    const cur = into.find((x) => x[0] === f)
    if (cur) {
      cur[1] += a
      cur[2] += r
    } else into.push([f, a, r])
  }
  return into
}

export const extOf = (f: string) => (/\.([^./\\]+)$/.exec(f.split(/[\\/]/).pop() || '')?.[1] || '').toLowerCase()
