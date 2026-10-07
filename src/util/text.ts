

/** Claude Code's stand-ins for pasted text and images: what was pasted, not what you typed. */
const PLACEHOLDER = /\s*"?\[(?:pasted text|image)(?: #\d+)?(?: \+\d+ lines?)?\]"?/gi
export const stripPlaceholders = (s: string) => s.replace(PLACEHOLDER, ' ').replace(/\s+/g, ' ').trim()

const CJK_CHARS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu

let segmenter: Intl.Segmenter | null | undefined
/**
 * Words you typed: paste and image placeholders don't count. Chinese, Japanese and Korean
 * aren't written with spaces, so those prompts are split by the runtime's word segmenter
 * (about 1.6 characters a word if it isn't available).
 */
export function wordCount(s: string): number {
  const text = stripPlaceholders(s)
  CJK_CHARS.lastIndex = 0
  if (!CJK_CHARS.test(text)) {
    const m = text.match(/\S+/g)
    return m ? m.filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0
  }
  if (segmenter === undefined) segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null
  if (segmenter) {
    let n = 0
    for (const seg of segmenter.segment(text)) if (seg.isWordLike) n++
    return n
  }
  const cjk = (text.match(CJK_CHARS) || []).length
  const rest = text.replace(CJK_CHARS, ' ').match(/\S+/g)
  return (rest ? rest.filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0) + Math.round(cjk / 1.6)
}

/** Keeps the start and the end of long agent messages: the end is usually the summary. */
export function headTail(s: string, head = 400, tail = 1400): string {
  if (s.length <= head + tail + 20) return s
  return s.slice(0, head).trimEnd() + '\n\n[…]\n\n' + s.slice(-tail).trimStart()
}

export function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length <= n ? one : one.slice(0, n - 1).trimEnd() + '…'
}

/**
 * One spelling for a path written on any OS: drops the \\?\ prefix Codex writes on Windows,
 * maps Git Bash's /c/Users/… to c:/Users/…, lowercases the drive and uses forward slashes.
 */
export function normPath(p: string): string {
  let s = p.trim().replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '')
  s = s.replace(/\\/g, '/')
  s = s.replace(/^\/([a-zA-Z])\/(?=Users\/)/, (_, d) => `${d}:/`)
  s = s.replace(/^([A-Za-z]):\//, (_, d) => `${d.toLowerCase()}:/`)
  return s.length > 1 ? s.replace(/\/+$/, '') : s
}

/** The same, as a prefix to shorten to "~/". */
const HOME_PREFIX = /^(\/Users\/[^/]+|\/home\/[^/]+|[a-z]:\/Users\/[^/]+|\/mnt\/[a-z]\/Users\/[^/]+|\/\/wsl(?:\.localhost|\$)\/[^/]+\/(?:home\/[^/]+|root))\//i

/** The last part of a path written on any OS. */
export function baseName(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || p
}

/** A path for display: home shortened to "~/", forward slashes. */
export function tidyPath(p: string): string {
  return normPath(p).replace(HOME_PREFIX, '~/')
}

/** `file` relative to `cwd` when it's inside it, compared the way each OS does. */
export function relativeTo(file: string, cwd: string): string | null {
  const f = normPath(file)
  const c = normPath(cwd)
  const win = /^[a-z]:\//.test(c)
  const [ff, cc] = win ? [f.toLowerCase(), c.toLowerCase()] : [f, c]
  return c && ff.startsWith(cc + '/') ? f.slice(c.length + 1) : null
}

export function dayKey(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function weekKey(t: number): string {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // Monday
  return dayKey(d.getTime())
}

export function monthKey(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Text that a harness injected into the user role rather than a person typing it. */
export function isWrappedInTag(s: string): boolean {
  const t = s.trim()
  const m = t.match(/^<([a-zA-Z][\w:-]*)(?:\s[^>]*)?>/)
  if (!m) return false
  return t.endsWith(`</${m[1]}>`)
}
