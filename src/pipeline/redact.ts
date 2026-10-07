import os from 'node:os'

export interface RedactionCounts {
  [kind: string]: number
}

interface Rule {
  kind: string
  re: RegExp
  to: string | ((m: string, ...g: string[]) => string)
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Builds a redactor for this machine: generic secret/PII rules plus the person's own
 * project names and username. Sanitization runs locally; the review screen shows
 * every replacement before anything can leave.
 */
export function makeRedactor(opts: { projectNames: string[]; extraTerms?: string[] }) {
  const user = os.userInfo().username
  const names = [...new Set([...opts.projectNames, ...(opts.extraTerms || [])])]
    .filter((n) => n && n.length >= 3 && !['scratch', 'unknown', '~', 'src', 'app', 'web', 'api'].includes(n.toLowerCase()))
    .sort((a, b) => b.length - a.length)

  const rules: Rule[] = [
    { kind: 'secret', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, to: '[secret]' },
    {
      kind: 'secret',
      re: /\b(sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{10,}|[pr]k_(?:live|test)_[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}|SG\.[\w-]{16,}\.[\w-]{16,})\b/g,
      to: '[secret]',
    },
    {
      kind: 'secret',
      re: /\b((?:api[_-]?key|secret|token|password|passwd|pwd|auth|bearer|access[_-]?key|private[_-]?key)["']?\s*[:=]\s*["']?)([^\s"',;]{6,})/gi,
      to: (_m, k) => `${k}[secret]`,
    },
    { kind: 'secret', re: /\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/g, to: (_m, b) => `${b}[secret]` },
    { kind: 'connection', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@[^\s]+/gi, to: '[connection-string]' },
    { kind: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, to: '[email]' },
    { kind: 'url', re: /\bhttps?:\/\/[^\s)<>"'`\]]+/gi, to: '[url]' },
    {
      kind: 'path',
      // POSIX homes and system dirs, Git Bash (/c/Users), Windows drives with either slash,
      // the \\?\ prefix Codex writes on Windows, and WSL distros seen from Windows
      re: /(?:~|\/(?:Users|home|private|var|opt|tmp|Volumes|mnt|srv|etc|root|[a-z](?=\/Users\/)))(?:\/[^\s"'`:;,()<>\]]+)+|(?:\\\\\?\\)?[A-Za-z]:[\\/](?:[^\s"'`\\/]+[\\/])*[^\s"'`\\/]+|\\\\wsl(?:\.localhost|\$)\\[^\s"'`]+/g,
      to: (m) => {
        const ext = m.match(/\.([a-z0-9]{1,6})$/i)?.[1]
        return ext ? `[path .${ext}]` : '[path]'
      },
    },
    { kind: 'id', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, to: '[id]' },
    { kind: 'secret', re: /\b[A-Fa-f0-9]{32,}\b|\b[A-Za-z0-9+/_-]{40,}={0,2}(?=\s|$|["'`])/g, to: '[secret]' },
    { kind: 'ip', re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, to: '[ip]' },
    { kind: 'phone', re: /(?<!\w)(?:\+?\d{1,3}[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\w)/g, to: '[phone]' },
  ]
  if (names.length) rules.push({ kind: 'project', re: new RegExp(`\\b(${names.map(escape).join('|')})\\b`, 'gi'), to: '[project]' })
  if (user && user.length >= 3) rules.push({ kind: 'name', re: new RegExp(`\\b${escape(user)}\\b`, 'gi'), to: '[name]' })

  return function redact(text: string, counts: RedactionCounts = {}): string {
    let out = collapseCode(text, counts)
    for (const r of rules) {
      out = out.replace(r.re, (...args: any[]) => {
        counts[r.kind] = (counts[r.kind] || 0) + 1
        return typeof r.to === 'string' ? r.to : r.to(args[0], ...args.slice(1, -2))
      })
    }
    return out
  }
}

/** Long code blocks become a short head plus a line count. */
function collapseCode(text: string, counts: RedactionCounts): string {
  return text.replace(/```([^\n]*)\n([\s\S]*?)```/g, (m, lang: string, body: string) => {
    const lines = body.split('\n')
    if (lines.length <= 24) return m
    counts.code = (counts.code || 0) + 1
    return '```' + lang + '\n' + lines.slice(0, 8).join('\n') + `\n… ${lines.length - 8} more lines omitted\n` + '```'
  })
}
