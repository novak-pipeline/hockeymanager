/**
 * Game-rules variants shared by both engines.
 *
 *   regularSeason — 3 periods, one 5-minute sudden-death OT, then a shootout.
 *   playoff       — 3 periods, then repeated 20-minute sudden-death OT periods
 *                   until someone scores; shootouts never happen.
 *
 * Both engines accept `rules` in their options ({ seed, rules? }) and default
 * to 'regularSeason' when omitted.
 */
export type GameRules = 'regularSeason' | 'playoff'

/**
 * Playoff hockey scores less than the regular season — tighter checking, more
 * blocked shots, desperation defense, a shorter leash on mistakes. Real NHL
 * playoff goals-per-game run roughly 8–12% below the regular-season rate. Both
 * engines multiply their per-shot goal probability by this in the postseason, so
 * playoff series are the tense, goaltending-and-defense affairs they should be.
 */
export function playoffScoringMult(rules: GameRules): number {
  return rules === 'playoff' ? 0.88 : 1
}
