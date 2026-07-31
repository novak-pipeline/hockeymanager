/**
 * DEPLOYMENT VALUE (#154) — what the GM's line board is actually worth.
 *
 * The lever audit measured line assembly as the single biggest decision a GM
 * makes: stacking the best players in the most-used slots instead of the least
 * is worth roughly 24 standings points across an 82-game season. A lever that
 * big deserves a receipt, and a receipt needs a number the GM can watch move.
 *
 * That number is the ICE-TIME-WEIGHTED LINEUP RATING: every dressed skater's
 * overall, weighted by the share of the game his slot actually plays — using the
 * quick sim's own deployment weights, so this is not a parallel model of the
 * lineup but a read of the same one the engine uses.
 *
 *   weighted = Σ (slot share × player overall)
 *
 * A flat average treats the fourth line like the first; this does not. Move your
 * best winger from L4 to L1 and the number goes up, exactly as your goal
 * differential does.
 *
 * Pure, deterministic, no RNG.
 */
import type { Player, PlayerId, Team } from '@domain'
import { ratedOverall } from '@engine/ratings/composites'

/**
 * Even-strength deployment shares, mirroring quickSim's FWD_LINE_WEIGHTS and
 * DEF_PAIR_WEIGHTS. Kept as a local copy rather than an import because the sim's
 * constants are private to that module; the static test in the audit folder
 * asserts they stay in step.
 */
export const FWD_LINE_SHARES = [0.34, 0.28, 0.22, 0.16]
export const DEF_PAIR_SHARES = [0.42, 0.34, 0.24]

export interface DeploymentValue {
  /** Ice-time-weighted rating of the dressed skaters, 0–99. */
  weighted: number
  /** The best weighted rating reachable by reordering the SAME dressed skaters. */
  best: number
  /** The worst such arrangement — the other end of the lever. */
  worst: number
  /** How much of the available span this board captures, 0–1 (1 = optimal order). */
  efficiency: number
  /** Weighted points left on the table versus the best ordering of these men. */
  lost: number
  /**
   * Standings points per season the current ordering is giving away, using the
   * conversion measured by the lever harness. Rounded to one decimal.
   */
  pointsLost: number
}

/**
 * Standings points (per 82 games) per point of ice-time-weighted lineup rating.
 *
 * MEASURED, not guessed. Four different mirror rosters, 25,000 games each, one
 * bench stacked best-first and the other worst-first; for each roster we divide
 * the measured season-point swing by the weighted-rating gap between the two
 * arrangements:
 *
 *   roster 0: gap 5.20 → 23.9 pts → 4.60
 *   roster 1: gap 6.40 → 26.0 pts → 4.06
 *   roster 2: gap 7.70 → 33.5 pts → 4.35
 *   roster 3: gap 7.00 → 33.0 pts → 4.72
 *   pooled                          4.43
 *
 * deploymentValue.test.ts re-derives it from the live engine, so the number the
 * GM reads on his line board cannot silently drift away from what the sim pays.
 */
export const POINTS_PER_WEIGHTED_RATING = 4.43

const share = (kind: 'F' | 'D', line: number): number =>
  kind === 'F' ? (FWD_LINE_SHARES[line] ?? 0) : (DEF_PAIR_SHARES[line] ?? 0)

interface Slots {
  weights: number[]
  ratings: number[]
}

/** Slot-by-slot weights and the ratings currently filling them, for one group. */
function collect(
  lines: PlayerId[][],
  kind: 'F' | 'D',
  resolve: (id: PlayerId) => Player,
): Slots {
  const weights: number[] = []
  const ratings: number[] = []
  lines.forEach((line, i) => {
    for (const id of line) {
      if (!id) continue
      const p = resolve(id)
      if (!p) continue
      weights.push(share(kind, i))
      ratings.push(ratedOverall(p))
    }
  })
  return { weights, ratings }
}

/** Σ w·r / Σ w for a given pairing of weights to ratings. */
function weightedMean(weights: number[], ratings: number[]): number {
  let num = 0
  let den = 0
  for (let i = 0; i < weights.length; i++) {
    num += weights[i]! * ratings[i]!
    den += weights[i]!
  }
  return den > 0 ? num / den : 0
}

/**
 * Read a club's board.
 *
 * `best` and `worst` re-pair the SAME ratings against the SAME slot weights in
 * the most and least favourable order (by the rearrangement inequality, sorting
 * both ascending maximises the sum and opposing them minimises it), which is
 * exactly the span the audit measured. Forwards and defencemen are ordered
 * within their own groups so the comparison stays legal — no winger is imagined
 * onto the blue line.
 */
export function deploymentValue(team: Team, resolve: (id: PlayerId) => Player): DeploymentValue {
  const fwd = collect(team.lines.forwards, 'F', resolve)
  const def = collect(team.lines.defensePairs, 'D', resolve)
  const all = { weights: [...fwd.weights, ...def.weights], ratings: [...fwd.ratings, ...def.ratings] }
  if (all.weights.length === 0) {
    return { weighted: 0, best: 0, worst: 0, efficiency: 1, lost: 0, pointsLost: 0 }
  }

  const arrange = (g: Slots, dir: 1 | -1): Slots => ({
    weights: [...g.weights].sort((a, b) => a - b),
    ratings: [...g.ratings].sort((a, b) => (a - b) * dir),
  })
  const bestG = [arrange(fwd, 1), arrange(def, 1)]
  const worstG = [arrange(fwd, -1), arrange(def, -1)]
  const flat = (gs: Slots[]): Slots => ({
    weights: gs.flatMap((g) => g.weights),
    ratings: gs.flatMap((g) => g.ratings),
  })

  const weighted = weightedMean(all.weights, all.ratings)
  const bf = flat(bestG)
  const wf = flat(worstG)
  const best = weightedMean(bf.weights, bf.ratings)
  const worst = weightedMean(wf.weights, wf.ratings)
  const span = best - worst
  const lost = Math.max(0, best - weighted)
  return {
    weighted: Math.round(weighted * 10) / 10,
    best: Math.round(best * 10) / 10,
    worst: Math.round(worst * 10) / 10,
    efficiency: span > 0 ? Math.max(0, Math.min(1, (weighted - worst) / span)) : 1,
    lost: Math.round(lost * 100) / 100,
    pointsLost: Math.round(lost * POINTS_PER_WEIGHTED_RATING * 10) / 10,
  }
}
