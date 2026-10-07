// Display names for model ids. Pure, so the browser can use it too.

/** "claude-opus-5-5" → "Claude Opus 5.5", "gpt-5.6-sol" → "GPT-5.6 Sol". */
export function prettyModel(m: string): string {
  const id = m.replace(/-\d{8}$/, '')
  const cap = (w: string) => (w === 'codex' ? 'Codex' : w[0].toUpperCase() + w.slice(1))
  if (id.startsWith('claude-')) {
    const [family, ...ver] = id.slice(7).split('-')
    return `Claude ${cap(family)}${ver.length ? ` ${ver.join('.')}` : ''}`
  }
  const gpt = id.match(/^gpt-([\d.]+)(?:-(.*))?$/)
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? ` ${gpt[2].split('-').map(cap).join(' ')}` : ''}`
  return id.split('-').map(cap).join(' ')
}

/** Model ids without dates or deployment suffixes, so a share can't hint at an account. */
export function modelFamily(m: string): string {
  return m
    .toLowerCase()
    .replace(/-\d{8}$/, '')
    .replace(/[^a-z0-9.-]/g, '')
    .slice(0, 40)
}

/**
 * One spelling per model, whichever harness logged it: "anthropic/claude-sonnet-4.5",
 * "us.anthropic.claude-sonnet-4-5-20250929-v1:0", "claude-sonnet-4-5@20250929" and
 * "claude-sonnet-4-5-20250929" are all "claude-sonnet-4-5".
 */
export function canonicalModel(m: string): string {
  let id = m.trim().toLowerCase()
  id = id.replace(/^.*\//, '') // router prefixes: openrouter/anthropic/…, github-copilot/…
  id = id.replace(/^(?:[a-z]{2,4}\.)?anthropic\./, '').replace(/-v\d+(?::\d+)?$/, '') // Bedrock
  id = id.replace(/@.*$/, '') // Vertex
  id = id.replace(/-\d{8}$/, '').replace(/-1m(?:-internal)?$/, '') // Copilot's internal long-context ids
  if (id.startsWith('claude-')) id = id.replace(/(\d)\.(\d)/g, '$1-$2')
  return id
}
