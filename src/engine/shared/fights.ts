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

/** Carried heat (shared/heat.ts fightHeatInput) of 1 adds this much to the rate. */
const HEAT_MULT = 0.8
/** … and pushes tonight's fights later: the times are drawn as u^(1/(1+HEAT_LATE·heat)). */
const HEAT_LATE = 1.5

/**
 * Times (absolute regulation seconds, ascending) at which tonight boils over.
 *
 * `heat` (additive, 0..1) is the history the two clubs carry into the game
 * from earlier meetings (league/heatLedger.ts through heat.fightHeatInput,
 * zero unless there is real history). It raises the rate a little and skews
 * the times toward the third period: bad blood builds through a night. Heat 0
 * draws exactly the old plan.
 */
export function rollFightPlan(gameSeed: number, intensity: number, heat = 0): number[] {
  const rng = new Rng(deriveSeed(gameSeed, FIGHT_KEY))
  const h = Math.max(0, Math.min(1, heat))
  const lambda = FIGHTS_PER_GAME * (1 + INTENSITY_MULT * Math.max(0, Math.min(1, intensity)) + HEAT_MULT * h)
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
  for (let i = 0; i < n; i++) {
    if (h <= 0) times.push(Math.floor(rng.float(EARLIEST, LATEST)))
    else times.push(Math.floor(EARLIEST + (LATEST - EARLIEST) * Math.pow(rng.next(), 1 / (1 + HEAT_LATE * h))))
  }
  return times.sort((a, b) => a - b)
}

/** The rng both engines use for combatant picks — derived from the same hash so
 *  it never touches the game's main stream. */
export function fightRngFor(gameSeed: number): Rng {
  return new Rng(deriveSeed(gameSeed, FIGHT_KEY, 1))
}
