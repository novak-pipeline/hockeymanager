/**
 * The rating LEVEL a game's outcomes are read against.
 *
 * Both simulation engines turn ratings into rates by comparing them with a
 * league baseline (LEAGUE_AVG = 50 on the scale the engines were calibrated
 * on: the generated fictional league, whose dressed skaters average ~57 on
 * (scoring + puckControl + skating) / 3). The imported real-roster database
 * sits ~9 points higher across the board, so read against the same baseline
 * every player looks like a star and the whole world scores ~30% too much.
 *
 * gameLevelAvg shifts the baseline by how far tonight's two dressed rosters
 * sit from the calibration league. Inside a ±DEAD_ZONE band it returns the
 * baseline untouched, so the calibration league (and every lever measured on
 * it) sims exactly as before; only a league on a different rating SCALE moves.
 * It is symmetric for the two teams, so the talent gap between them — which
 * decides who wins — is unchanged; only the league-wide scoring level is.
 */
import type { Player, PlayerId, Team } from '@domain'

/** Mean (scoring + puckControl + skating) / 3 of the generated calibration league's dressed skaters. */
export const CALIBRATION_LEVEL = 57.2
const DEAD_ZONE = 4

export function gameLevelAvg(home: Team, away: Team, resolve: (id: PlayerId) => Player, base = 50): number {
  let s = 0
  let n = 0
  for (const t of [home, away]) {
    for (const id of [...t.lines.forwards.flat(), ...t.lines.defensePairs.flat()]) {
      let p: Player | undefined
      try {
        p = resolve(id)
      } catch {
        p = undefined
      }
      if (!p) continue
      s += (p.composites.scoring + p.composites.puckControl + p.composites.skating) / 3
      n++
    }
  }
  if (n === 0) return base
  const d = s / n - CALIBRATION_LEVEL
  return Math.abs(d) <= DEAD_ZONE ? base : base + d
}
