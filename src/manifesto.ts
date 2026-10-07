// The manifesto, once: `lore manifesto` prints it in the terminal and the website renders
// the same text at /manifesto. Inline `code` and **bold** work in both; links only on the web
// (the terminal shows their text).

export interface ManifestoSection {
  title: string
  status?: string
  paras: string[]
  /** Shown on the website only (links to its other pages). */
  webOnly?: boolean
  /** Website-only HTML placed after the section's text, by name (the waitlist form). */
  slot?: string
}

export const MANIFESTO_COMMAND = 'npx lore-wrapped manifesto'
export const MANIFESTO_HEADLINE = 'your agents remember everything.'

export const MANIFESTO: ManifestoSection[] = [
  {
    title: 'DESCRIPTION',
    paras: [
      'software is written in conversation now. you ask. the agent writes code. you say “no, not like that.” it tries again.',
      'heavy users do this thousands of times a year. every turn gets saved as plain text on their own machine. almost nobody reads it. some agents delete it after thirty days.',
      '**you did all that work. you should get to look at it.**',
      'lore reads it on your machine. one command. about three seconds. no account.',
      'your year: your card, your hours, your bill, the moments you forgot. your history never leaves your laptop.',
      '**the recap is free. it stays free.**',
    ],
  },
  {
    title: 'WHY IT’S WORTH SOMETHING',
    paras: [
      'ai labs train agents on coding tasks. the best ones come from actual work.',
      'an actual repo. something a person actually asked for. tests that prove it’s done. the moment someone said “that’s wrong” and steered the agent back.',
      '**you can’t scrape that from the internet. it only exists on machines like yours.**',
    ],
  },
  {
    title: 'GETTING PAID',
    status: 'being built',
    slot: 'waitlist',
    paras: [
      'labs already pay **$200 to $2,000 for one good coding task** like that, and more for an exclusive one ([epoch ai, 2026](https://epoch.ai/gradient-updates/state-of-rl-envs)). they can’t get enough.',
      'your history is full of them. every time your agent turned a failing test green on something you actually needed, that’s one.',
      '**the floor: your agent work pays for your agent plan. the ceiling: thousands of dollars, for work you already did.**',
      'one task could cover a month of claude or codex. a heavy year holds dozens. and if your company signs on, its whole codebase could earn tens of thousands.',
      'you pick what to sell. you see every byte first. you get paid.',
    ],
  },
  {
    title: 'WHAT WE TAKE TODAY',
    paras: [
      'when you run lore, at most once a month: anonymous counts. how many prompts. how often you redirect. which models you use. nothing runs in the background.',
      '**never a word you typed. never a file or a name. never a row published or sold.**',
      'those counts rank your report, build the public index, and tell us which kinds of work are worth paying for.',
      'every field: `npx lore-wrapped stats`. stop it: `npx lore-wrapped stats off`.',
    ],
  },
  {
    title: 'SEE ALSO',
    webOnly: true,
    paras: ['[privacy](privacy/), [the index](live/), [the deck](deck/)'],
  },
  {
    title: 'BUGS',
    paras: ['your agents forget. Claude Code deletes transcripts after 30 days by default.', 'run lore once a month, or let the report keep a year.'],
  },
]

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The manifesto as HTML for the website; links resolve against `root`, and `slots` fill named places. */
export function manifestoHtml(root: string, slots: Record<string, string> = {}): string {
  const inline = (t: string) =>
    escapeHtml(t)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[(.+?)\]\((.+?)\)/g, (_, text, href) => (/^https?:/.test(href) ? `<a href="${href}" target="_blank" rel="noopener">${text}</a>` : `<a href="${root}${href}">${text}</a>`))
  return MANIFESTO.map(
    (s) => `<section>
  <h2>${escapeHtml(s.title)}${s.status ? ` <span class="man-status">status: ${escapeHtml(s.status)}</span>` : ''}</h2>
  ${s.paras.map((p) => `<p>${inline(p)}</p>`).join('\n  ')}${s.slot && slots[s.slot] ? `\n  ${slots[s.slot]}` : ''}
</section>`,
  ).join('\n')
}

/** The manifesto for a terminal, wrapped to `width`, with optional styling functions. */
export function manifestoText(width = 76, style: { bold: (s: string) => string; dim: (s: string) => string; accent: (s: string) => string } = { bold: (s) => s, dim: (s) => s, accent: (s) => s }): string {
  const wrap = (t: string, indent: number) => {
    const words = t.split(' ')
    const lines: string[] = []
    let cur = ''
    for (const w of words) {
      if (cur && cur.length + 1 + w.length > width - indent) {
        lines.push(cur)
        cur = w
      } else cur = cur ? `${cur} ${w}` : w
    }
    if (cur) lines.push(cur)
    return lines.map((l) => ' '.repeat(indent) + l)
  }
  const plain = (t: string) => t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1').replace(/\[(.+?)\]\(.+?\)/g, '$1')
  const out: string[] = ['', `  ${style.bold(MANIFESTO_HEADLINE)}`, '']
  for (const s of MANIFESTO.filter((x) => !x.webOnly)) {
    out.push(`  ${style.accent(s.title)}${s.status ? style.dim(`  status: ${s.status}`) : ''}`)
    for (const p of s.paras) {
      const lines = wrap(plain(p), 6)
      // a fully bold paragraph prints bold; inline bold only shows on the web
      out.push(...(/^\*\*[^*]+\*\*$/.test(p) ? lines.map((l) => style.bold(l)) : lines), '')
    }
  }
  return out.join('\n')
}
