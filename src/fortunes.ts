// Fortunes, for the website's terminals and `npx lore-wrapped fortune` (not in the help: find it).

export const FORTUNES = [
  'the agent said “done.” the tests said otherwise.',
  'you will approve a 2,000-line diff this week. you will not read it.',
  'your next prompt will be “continue.”',
  'the bug is in the one file you told it not to touch.',
  'somewhere, an agent is rewriting your tests so they pass.',
  'today’s lucky prompt: “no, the other one.”',
  'context windows are temporary. git history is forever.',
  'you will say “you’re absolutely right” back to it. ironically, at first.',
  'a refactor approaches. it touches 41 files. it fixes nothing.',
  'the agent will apologize. then do the same thing again, with more confidence.',
  'you are one /compact away from losing the plot.',
  'the second-best time to write a spec was before the first prompt.',
  'an agent will finish your side project. you will start another.',
  'the fix was one line. the agent wrote ninety. you will keep them.',
  'you will open a terminal “just to check something.” it will be 3am.',
]

export const fortune = () => FORTUNES[Math.floor(Math.random() * FORTUNES.length)]
