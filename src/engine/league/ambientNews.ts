/**
 * Ambient league milestone news — pure story flavour that makes the league feel
 * alive (hot/cold team streaks). No sim or calibration impact; the career layer
 * tracks the streak counters and decides when to surface these.
 */

/**
 * A hot/cold streak headline + body when a team's run hits a notable threshold
 * (6 games, then every 2 after — 6, 8, 10, …), else null. `streak` is signed:
 * positive = consecutive wins, negative = winless run (losses incl. OT). Pure
 * and deterministic.
 */
export function streakMilestone(
  teamName: string,
  streak: number
): { headline: string; body: string } | null {
  const n = Math.abs(streak)
  if (n < 6 || n % 2 !== 0) return null
  if (streak > 0) {
    return {
      headline: `${teamName} ride a ${n}-game winning streak`,
      body: `${teamName} have reeled off ${n} straight — the hottest team in the league right now.`,
    }
  }
  return {
    headline: `${teamName} skid to ${n} straight losses`,
    body: `It's gone cold for ${teamName}: ${n} consecutive games without a win, and the pressure is mounting.`,
  }
}
