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
