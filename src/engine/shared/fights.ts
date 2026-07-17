/**
 * Fights — scheduled per game from a stable hash, shared by both engines.
 *
 * Hockey's most distinctive physical event was missing entirely. A fight is a
 * coincidental five-minute major: correctly NO power play (majors substitute),
 * but both combatants sit for five minutes of game time, so their lines really
 * are weaker while they cool off — plus five PIM each and a penalty event in
 * the stream (`infraction: 'fighting'`).
 *
 * The schedule (how many fights tonight, and when) derives from a stable hash
 * of the game seed — the goalieNight pattern — so it consumes NONE of the
 * game's main rng stream: a game with no fights replays byte-for-byte as
 * before. Rivalry heat turns games up: a true grudge match fights ~3× as often
 * as a quiet Tuesday. Modern-NHL base rate ≈ 0.15 fights/game.
 */
import { Rng, deriveSeed } from './rng'

const FIGHTS_PER_GAME = 0.15
/** A full-heat rivalry (intensity 1) fights ~3× the base rate. */
const INTENSITY_MULT = 2
/** Fights happen in regulation, away from the opening/closing scramble. */
const EARLIEST = 120
const LATEST = 3480
/** Seconds a combatant sits (five-minute major). */
export const FIGHT_MAJOR_SECONDS = 300

const FIGHT_KEY = 0xf17f5

/** Times (absolute regulation seconds, ascending) at which tonight boils over. */
export function rollFightPlan(gameSeed: number, intensity: number): number[] {
  const rng = new Rng(deriveSeed(gameSeed, FIGHT_KEY))
  const lambda = FIGHTS_PER_GAME * (1 + INTENSITY_MULT * Math.max(0, Math.min(1, intensity)))
  // Knuth Poisson — lambda is tiny, this terminates immediately.
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= rng.next()
  } while (p > L)
  const n = k - 1
  const times: number[] = []
  for (let i = 0; i < n; i++) times.push(Math.floor(rng.float(EARLIEST, LATEST)))
  return times.sort((a, b) => a - b)
}

/** The rng both engines use for combatant picks — derived from the same hash so
 *  it never touches the game's main stream. */
export function fightRngFor(gameSeed: number): Rng {
  return new Rng(deriveSeed(gameSeed, FIGHT_KEY, 1))
}
