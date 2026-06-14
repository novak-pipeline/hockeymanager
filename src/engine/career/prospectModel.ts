/**
 * Prospect projection model — an NHLe-based, data-science-style projection of a
 * draft prospect's NHL outcome, in the spirit of public NHL-equivalency /
 * prospect-projection work (Desjardins/Vollman NHLe + Tyrrell/TopDownHockey
 * projection models).
 *
 * The pipeline mirrors those models:
 *   1. Convert raw scoring to an NHL-EQUIVALENT rate via a league factor (NHLe).
 *   2. Age-curve it to a PROJECTED PEAK — a draft-age player's production grows
 *      to its NHL peak, the younger the larger the multiplier.
 *   3. Map the projected peak through logistic curves to OUTCOME PROBABILITIES:
 *      P(plays in the NHL) and P(becomes an impact/"star" player), with separate
 *      forward / defenceman thresholds (defencemen score less for the same value).
 *
 * Pure + deterministic. This is a transparent parametric model (not trained
 * weights), calibrated so the outputs read like real projection cards.
 */

export interface ProspectProjection {
  /** NHL-equivalent points over 82 games at the player's CURRENT production. */
  nhleNow: number
  /** Projected NHL peak points/82 after age-curve growth. */
  projectedPeak: number
  /** Probability he becomes a regular NHLer (0–100). */
  pNHLer: number
  /** Probability he becomes an impact/"star" player (0–100). */
  pStar: number
}

export interface ProjectInput {
  /** Points per game in his league (blend of this + last season). */
  ppg: number
  /** League NHLe factor in (0,1] (see nhleFactorByAbbrev). */
  leagueFactor: number
  age: number
  isD: boolean
  /**
   * Estimation noise in projected-peak points (0 = a perfect read). A weaker
   * analytics department reads the projection less precisely; scale this by your
   * Data Analyst's quality. Applied as a deterministic per-player perturbation.
   */
  noise?: number
  /** Stable seed for the noise perturbation (e.g. playerId + phase). */
  seed?: string
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const logistic = (x: number, mid: number, slope: number): number => 1 / (1 + Math.exp(-(x - mid) / slope))

/** Deterministic [-1, 1) from a string (FNV-1a). Exported for reuse (consensus
 *  scouting error on the draft board). */
export function hashSigned(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return ((h >>> 0) / 0xffffffff) * 2 - 1
}

/**
 * Age multiplier from draft-age production to NHL peak. A 17-year-old's scoring
 * rate roughly doubles to his peak; the curve flattens to ~1.0 by mid-20s.
 */
function peakMultiplier(age: number): number {
  if (age <= 16) return 2.15
  if (age >= 27) return 1.0
  // Smooth decay ~2.0 at 17 → 1.0 at 27.
  return clamp(2.0 - (age - 17) * 0.1, 1.0, 2.0)
}

/** Project a prospect's NHL outcome from his production, league, age, position. */
export function projectProspect(input: ProjectInput): ProspectProjection {
  const { ppg, leagueFactor, age, isD } = input
  const nhleNow = Math.max(0, ppg) * 82 * Math.max(0.05, leagueFactor)
  const noisePts = (input.noise ?? 0) * hashSigned(input.seed ?? `${ppg}:${age}`)
  const projectedPeak = Math.max(0, nhleNow * peakMultiplier(age) + noisePts)

  // Outcome thresholds anchored to NHL production tiers (points/82 at peak),
  // not tuned by feel. A forward who projects to a 4th-line/bottom-six peak
  // (~24 pts) is a coin-flip NHL regular; a ~58-pt peak (solid top-six) is the
  // "star"/impact midpoint. Defencemen produce less for the same value, so both
  // midpoints drop: ~16 pts = borderline bottom-pair regular, ~40 pts = clear
  // top-pair/PP-quarterback impact. Slopes set so the curve spans roughly one
  // production tier (≈ ±1 line) from 12%→88%.
  const nhlerMid = isD ? 16 : 24
  const nhlerSlope = isD ? 6 : 8
  const starMid = isD ? 40 : 58
  const starSlope = isD ? 8 : 10

  const pNHLer = Math.round(logistic(projectedPeak, nhlerMid, nhlerSlope) * 100)
  const pStar = Math.round(logistic(projectedPeak, starMid, starSlope) * 100)

  return {
    nhleNow: Math.round(nhleNow),
    projectedPeak: Math.round(projectedPeak),
    pNHLer,
    pStar,
  }
}
