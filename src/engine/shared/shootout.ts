/**
 * Shootout shooter model, shared by both engines.
 *
 * A shootout isn't the whole forward corps averaged together — the coach sends
 * his snipers, best first, and a fourth-liner never touches the puck unless the
 * thing drags into the double digits. So we rank the forwards by shootout ability
 * (finishing hands with a puck-skill kicker for the dekes) and send them in
 * order; each attempt is that specific shooter against the goalie. Roster
 * construction now matters — a team with three genuine finishers is dangerous in
 * the skills competition; a one-star, thin-depth club is only good for a round or
 * two.
 */
import type { CompositeRatings, Player } from '@domain'

/** A shooter's shootout ability: finishing, with a puck-control (deke) kicker. */
export function shootoutSkill(c: CompositeRatings): number {
  return c.scoring * 0.7 + c.puckControl * 0.3
}

/** Forwards ranked best-first. Deterministic id tie-break keeps seeded games
 *  reproducible. */
export function shootoutOrder(forwards: Player[]): Player[] {
  return [...forwards].sort(
    (a, b) =>
      shootoutSkill(b.composites) - shootoutSkill(a.composites) ||
      ((a.id as string) < (b.id as string) ? -1 : 1)
  )
}

// Base per-attempt conversion, tuned so the top shooters convert at the real
// NHL shootout clip (~33%) against a league-average goalie — lower than the old
// coefficient because we now feed in the BEST shooters, not the roster average.
const SHOOTOUT_BASE = 0.29

/** P(goal) for a shooter (shootoutSkill units) vs a goalie (goaltending), both
 *  normalized to the league average. */
export function shootoutGoalChance(skill: number, goaltending: number, leagueAvg: number): number {
  const p = SHOOTOUT_BASE * (skill / leagueAvg) * (2 - goaltending / leagueAvg)
  return p < 0.1 ? 0.1 : p > 0.6 ? 0.6 : p
}
