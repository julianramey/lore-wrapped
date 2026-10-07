// Featured spots (cards, headline moments, share card) may quote your swearing: you
// said it first. Slurs never appear in a featured spot or a count.

import { SLURS_X } from './lang.ts'

const SLURS = /\b(n[i1]gg(a|er|as|ers|uh)|f[a4]gg?(ot|ots|y)?|retard(ed|s)?|tr[a4]nn(y|ies)|k[i1]ke|sp[i1]c|ch[i1]nk)\b/i
const PROFANITY = /\b(fuck\w*|shit\w*|bullshit|dumbass|ass(hole)?s?|bitch\w*|damn(it)?|goddamn\w*|crap|piss\w*|wtf|stfu|jesus christ)\b/i

export const hasSlur = (s: string) => SLURS.test(s) || SLURS_X.test(s)
export const hasProfanity = (s: string) => PROFANITY.test(s)

export function isFeatureSafe(s: string): boolean {
  return !hasSlur(s)
}

/** All-caps shouting: at least 4 words and 70% of letters uppercase. */
export function isShouting(s: string): boolean {
  // scripts with case only (Latin, Cyrillic, Greek…); CJK has no capitals to shout in
  const letters = s.replace(/[^\p{Lu}\p{Ll}]/gu, '')
  if (letters.length < 16) return false
  const upper = letters.replace(/[^\p{Lu}]/gu, '').length
  return upper / letters.length > 0.7 && (s.match(/(?<![\p{L}])\p{Lu}{2,}(?![\p{L}])/gu) || []).length >= 4
}

/** Pasted logs, JSON, SQL output: mostly not prose. */
export function looksPasted(s: string): boolean {
  const t = s.trim()
  if (/^(error|failed|traceback|uncaught|warning|exception|\[\d|\d{2}:\d{2}|at\s+\S+\s+\(|[\[{]\s*$)/im.test(t.slice(0, 60))) return true
  // letters in any script: a Japanese or Russian prompt is prose too
  const letters = (t.match(/\p{L}/gu) || []).length
  return letters / Math.max(1, t.length) < 0.6
}
