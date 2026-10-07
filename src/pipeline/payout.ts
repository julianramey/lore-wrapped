// A rough guess at what someone's agent work might be worth if lore's paid program existed
// today. Deliberately loose and labeled as a guess: the program isn't built, and no buyer
// has set a price. Pure, so the report can show its working.

/** What labs pay for one curated coding task (Epoch AI, "State of RL environments", 2026). */
export const TASK_PRICE: [number, number] = [200, 2000]
/** Assumed share of candidates a buyer would accept. */
export const ACCEPTED: [number, number] = [0.2, 0.4]
/** Assumed share of the price that reaches the person whose work it is. */
export const SHARE = 0.5

const nice = (x: number) => (x < 1000 ? Math.round(x / 10) * 10 : x < 10_000 ? Math.round(x / 100) * 100 : Math.round(x / 1000) * 1000)

/**
 * Candidates are conversations where a failing test later passed on real work: the closest
 * thing in a history to a task a lab can check. None yet means no estimate.
 */
export function payEstimate(redGreen: number): { tasks: number; low: number; high: number } | null {
  if (!redGreen) return null
  return { tasks: redGreen, low: nice(redGreen * ACCEPTED[0] * TASK_PRICE[0] * SHARE), high: nice(redGreen * ACCEPTED[1] * TASK_PRICE[1] * SHARE) }
}
