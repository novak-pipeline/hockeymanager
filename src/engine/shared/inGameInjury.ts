/**
 * In-game injuries — the moment a player goes down and doesn't return.
 *
 * Injuries used to exist only as a post-game dice roll: nobody ever left a game
 * hurt, and a watched third period never featured a shortened bench. Now some
 * injuries happen ON the ice: the victim is done for the night (his team plays
 * the rest of the game without him) and the career layer turns the departure
 * into a guaranteed injury with the usual severity distributions — so you saw
 * it happen instead of reading about it after.
 *
 * Like fights and goalie nights, the schedule derives from a stable hash of the
 * game seed: zero main-rng cost, so games without an in-game injury replay
 * byte-for-byte.
 */
import { Rng, deriveSeed } from './rng'

/** Games with a mid-game injury departure (either team) ≈ 1 in 5. */
const IN_GAME_INJURY_RATE = 0.2
const EARLIEST = 60
const LATEST = 3540

const INJURY_KEY = 0x1263a7

export interface InGameInjuryPlan {
  /** Absolute regulation second the player goes down. */
  atSecond: number
  /** Which bench loses a man. */
  homeSide: boolean
}

export function rollInGameInjury(gameSeed: number): InGameInjuryPlan | null {
  const rng = new Rng(deriveSeed(gameSeed, INJURY_KEY))
  if (!rng.chance(IN_GAME_INJURY_RATE)) return null
  return { atSecond: Math.floor(rng.float(EARLIEST, LATEST)), homeSide: rng.chance(0.5) }
}

/** Victim-pick rng — same hash family, never the game's main stream. */
export function inGameInjuryRngFor(gameSeed: number): Rng {
  return new Rng(deriveSeed(gameSeed, INJURY_KEY, 1))
}

/** Fragile players (low balance) go down more; the sturdiest are ~3× safer. */
export function fragilityWeight(balance: number): number {
  return 1 + Math.max(0, 70 - balance) / 35
}
