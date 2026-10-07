// The lore deck: fourteen archetypes, the two poles of seven measured spectra.
// Card I and II are opposites, III and IV, and so on.

export interface DeckCard {
  key: string
  numeral: string
  name: string
  tagline: string
  lore: string
  signs: string
  enemy: string
  /** The rule, in words, that makes this card yours. */
  measured: string
}

export const DECK: DeckCard[] = [
  {
    key: 'editor',
    numeral: 'I',
    name: 'The Editor',
    tagline: 'You let agents draft. Then you cut.',
    lore: 'The Editor treats every first attempt as a draft. They read the diff, find the one thing that is wrong, and say so within minutes. They barely write code anymore, but nothing ships without passing through them.',
    signs: '“No.” “Actually.” “Not like that.” A redirect a few minutes after every attempt.',
    enemy: 'An agent that rewrites the whole file to change one line.',
    measured: 'More of your follow-ups redirect the agent than the typical 15%, and that is the most unusual thing about you.',
  },
  {
    key: 'delegator',
    numeral: 'II',
    name: 'The Delegator',
    tagline: 'You hand it off and let it ride.',
    lore: 'The Delegator gives the job and walks away. Few redirects, few check-ins, a lot of trust. Either their prompts are excellent or nobody is checking the work, and only the diff knows which.',
    signs: '“go ahead.” “do it.” Long gaps between messages.',
    enemy: 'Coming back to four hundred changed files.',
    measured: 'Fewer of your follow-ups redirect the agent than the typical 15%, and that is the most unusual thing about you.',
  },
  {
    key: 'architect',
    numeral: 'III',
    name: 'The Architect',
    tagline: 'You think in specs.',
    lore: 'Before the agent writes a line, the Architect has written four paragraphs: edge cases, file names, what not to touch. Agents love them because nothing is left to guess. Their prompts are longer than some of the code they get back.',
    signs: 'Prompts with headings. “Make sure.” A spec in the first message.',
    enemy: 'A prompt box that only shows three lines.',
    measured: 'Your typical prompt runs well past the usual 20 words, and that is the most unusual thing about you.',
  },
  {
    key: 'sniper',
    numeral: 'IV',
    name: 'The Sniper',
    tagline: 'Six words. Ship it.',
    lore: 'The Sniper does not explain. “fix the auth bug.” “make it faster.” “deploy.” They have learned exactly how little an agent needs, and they are usually right. When they are wrong, they send six more words.',
    signs: 'One-line prompts. No punctuation. “continue.”',
    enemy: 'The agent asking a clarifying question.',
    measured: 'Your typical prompt is far shorter than the usual 20 words, and that is the most unusual thing about you.',
  },
  {
    key: 'night',
    numeral: 'V',
    name: 'The Night Shift',
    tagline: 'Your best work happens after dark.',
    lore: 'The Night Shift does the real work after the Slack goes quiet. Their agents run at 2am because they do. The code is often good. The commit messages less so.',
    signs: 'A peak hour after 10pm. Prompts that start with “ok one more thing.”',
    enemy: 'Morning standup.',
    measured: 'Most of your prompts land between 6pm and 6am, well past an even split.',
  },
  {
    key: 'day',
    numeral: 'VI',
    name: 'The Nine-to-Fiver',
    tagline: 'Agents clock in when you do.',
    lore: 'Steady hours, steady output. The Nine-to-Fiver treats agents like coworkers on the same schedule. It is the most sustainable card in the deck, and the least likely to have shouted at a model at 3am.',
    signs: 'A peak in the early afternoon. Quiet weekends.',
    enemy: 'An agent run still going at 6pm.',
    measured: 'Most of your prompts land between 6am and 6pm, and nothing else about you is as unusual.',
  },
  {
    key: 'conductor',
    numeral: 'VII',
    name: 'The Conductor',
    tagline: 'Many projects, one baton.',
    lore: 'The Conductor has five repos open and an agent in each. They switch contexts so the agents do not have to, and they pick the instrument for the part: Codex here, Claude there.',
    signs: 'Several projects past fifty prompts. The same repo on both tools.',
    enemy: 'Forgetting which terminal is which.',
    measured: 'Your prompts spread across far more projects than the usual three.',
  },
  {
    key: 'loyalist',
    numeral: 'VIII',
    name: 'The Monogamist',
    tagline: 'One project. All in.',
    lore: 'One codebase, all year. The Monogamist knows every corner of it and the agent is just catching up. Their most-edited file has been edited more times than most people’s whole repo.',
    signs: 'One project with most of the prompts. A file the agent keeps coming back to.',
    enemy: 'A second project.',
    measured: 'Your prompts concentrate in fewer projects than almost anyone’s.',
  },
  {
    key: 'marathoner',
    numeral: 'IX',
    name: 'The Marathoner',
    tagline: 'You stay in the thread until it’s done.',
    lore: 'The Marathoner never starts a new thread. Hundreds of prompts, days of context, one conversation that becomes a shared memory. When it finally ends, it is because the thing shipped.',
    signs: 'Threads with hundreds of prompts. “Remember when we…”',
    enemy: 'Context compaction.',
    measured: 'Your threads run far longer than the usual eight prompts.',
  },
  {
    key: 'sprinter',
    numeral: 'X',
    name: 'The Sprinter',
    tagline: 'New thread, new problem, gone.',
    lore: 'Clean context every time. The Sprinter opens a thread, gets the answer, closes it. Small scopes, fast exits, no baggage.',
    signs: 'Lots of short threads. Very few follow-ups.',
    enemy: 'A thread that will not stay small.',
    measured: 'Your threads end far sooner than the usual eight prompts.',
  },
  {
    key: 'volcano',
    numeral: 'XI',
    name: 'The Volcano',
    tagline: 'You say what everyone’s thinking. In caps.',
    lore: 'The Volcano is calm until the third time the same bug comes back. Then it is all caps. They swear at agents the way people swear at printers: often, sincerely, without malice. The agents fix it faster anyway.',
    signs: '“wtf.” Messages in ALL CAPS. A redirect with a swear in it.',
    enemy: '“You’re absolutely right!”',
    measured: 'You swear far more than the usual one prompt in a hundred, and that is the most unusual thing about you.',
  },
  {
    key: 'monk',
    numeral: 'XII',
    name: 'The Monk',
    tagline: 'Not one swear. Not even at Codex.',
    lore: 'Infinite patience. The Monk explains the bug a fourth time in the same calm voice. Agents get feedback on their work and never on their mood, and somehow that works too.',
    signs: 'Zero swears. “please” and “thank you.”',
    enemy: 'Nothing. That is the point.',
    measured: 'You almost never swear, and nothing else about you is as unusual.',
  },
  {
    key: 'foreman',
    numeral: 'XIII',
    name: 'The Foreman',
    tagline: 'You give the order; the crew works for an hour.',
    lore: 'The Foreman writes the job and the agent works for an hour. Long unattended runs, dozens of actions per prompt, one person supervising a crew. Their agents log more hours than they do.',
    signs: 'Agent turns measured in hours. “Let me know when it’s done.”',
    enemy: 'Coming back to a run that stopped at minute two to ask a question.',
    measured: 'Each prompt buys far more agent work than the usual two and a half minutes.',
  },
  {
    key: 'pair',
    numeral: 'XIV',
    name: 'The Pair Programmer',
    tagline: 'You stay in the loop, turn by turn.',
    lore: 'Short turns, constant back and forth. The Pair Programmer is in the chair the whole time, steering every few minutes. Nothing goes far off course, because nothing goes far.',
    signs: 'Agent turns under a minute. Quick follow-ups.',
    enemy: 'Being asked to step away while it runs.',
    measured: 'Each prompt buys less agent work than almost anyone’s: you stay in the loop.',
  },
]

/**
 * How each spectrum is scored: a log-scale distance from a typical heavy agent user, in
 * standard deviations. `typical` is the midpoint of the bar and the letter threshold; `p90`
 * is roughly the 90th percentile. These are priors until the lore index has real medians.
 */
/**
 * A typical heavy agent user and the 90th percentile, per spectrum. Sources and reasoning
 * are in the README's calibration notes: Anthropic's Claude Code telemetry, SWE-chat,
 * TraceLab and commit-time studies. They become real medians once the lore index has them.
 */
export const CALIBRATION: Record<string, { typical: number; p90: number; offset: number; logit?: boolean }> = {
  control: { typical: 0.15, p90: 0.32, offset: 0.01 }, // share of follow-ups that redirect
  briefing: { typical: 20, p90: 60, offset: 0 }, // median words per prompt
  clock: { typical: 0.35, p90: 0.62, offset: 0, logit: true }, // share of prompts 6pm–6am
  range: { typical: 3, p90: 6, offset: 0 }, // effective projects, last 90 days
  stamina: { typical: 8, p90: 25, offset: 0 }, // prompts per thread
  temper: { typical: 1, p90: 6, offset: 0.5 }, // swears per 100 prompts
  leash: { typical: 2.5, p90: 10, offset: 0.3 }, // agent minutes per prompt
}

/**
 * The clock's bar and letter split at an even 50%, so "Night" means most prompts land at
 * night; its card and twin scores still measure from the typical 35%.
 */
export const CLOCK_SPLIT = { typical: 0.5, p90: 0.75 }

/** Standard deviations from typical, clamped to ±3. */
export function zScore(key: string, x: number, against?: { typical: number; p90: number }): number {
  const c = against ? { ...CALIBRATION[key], ...against } : CALIBRATION[key]
  // shares of a whole (like night vs day) use log-odds; counts and rates use a log ratio
  const f = c.logit ? (v: number) => Math.log(Math.min(0.99, Math.max(0.01, v)) / (1 - Math.min(0.99, Math.max(0.01, v)))) : (v: number) => Math.log(Math.max(0, v) + c.offset)
  const z = (f(x) - f(c.typical)) / ((f(c.p90) - f(c.typical)) / 1.2816)
  return Math.max(-3, Math.min(3, z))
}

/** Where a z-score sits on a bar: typical in the middle, never pinned to an end. */
export const barPosition = (z: number) => 1 / (1 + Math.exp(-1.1 * z))

/** The four letters of a type code: one per main spectrum, split at the typical value. */
export const CODE_AXES = [
  {
    axis: 'How you steer',
    spectrum: 'control',
    letters: { E: 'Editor', D: 'Delegator' },
    rule: 'E when 15% or more of follow-ups redirect the agent',
    rules: { E: '15% or more of your follow-ups redirect the agent', D: 'under 15% of your follow-ups redirect the agent' },
  },
  {
    axis: 'How you brief',
    spectrum: 'briefing',
    letters: { A: 'Architect', S: 'Sniper' },
    rule: 'A when your median prompt is 20 words or more',
    rules: { A: 'your median prompt is 20 words or more', S: 'your median prompt is under 20 words' },
  },
  {
    axis: 'When you work',
    spectrum: 'clock',
    letters: { N: 'Night', L: 'Daylight' },
    rule: 'N when most of your prompts land 6pm–6am',
    rules: { N: 'most of your prompts land between 6pm and 6am', L: 'most of your prompts land between 6am and 6pm' },
  },
  {
    axis: 'How wide you go',
    spectrum: 'range',
    letters: { C: 'Conductor', F: 'Focused' },
    rule: 'C when your prompts spread across 3 or more effective projects',
    rules: { C: 'your prompts spread across 3 or more effective projects', F: 'your prompts stay within 3 effective projects' },
  },
] as const

export const deckCard = (key: string) => DECK.find((d) => d.key === key)
