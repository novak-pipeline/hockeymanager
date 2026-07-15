/**
 * Hidden "Consistency" trait (EHM-style, 1–20).
 *
 * Consistency is how reliably a player performs to his ability night to night.
 * It is semi-hidden — scouts only hint at it — and it shapes the spread of a
 * player's per-game ratings rather than the calibrated sim event stream:
 *   - LOW consistency  → wide game-to-game swings + a slightly lower achievable
 *                        average (he can't sustain his ceiling),
 *   - HIGH consistency → tight spread + a small reliable bump.
 *
 * Pure + deterministic + JSON-safe. The sim engines never read this; only the
 * career layer's post-game rating step does, so adding it is calibration-safe.
 */

const FNV_OFFSET = 2166136261
const FNV_PRIME = 16777619

/** Stable 0..1 hash of a string (FNV-1a), independent of any RNG stream. */
function hash01(s: string): number {
  let h = FNV_OFFSET
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, FNV_PRIME)
  }
  return ((h >>> 0) % 100000) / 100000
}

/**
 * Derive a hidden consistency (1–20) for a player WITHOUT consuming any RNG —
 * so it can be assigned during league generation without perturbing the
 * generation stream (and the byte-identical sim calibration). Composed,
 * determined players trend a little more reliable, but most of the value is a
 * stable per-player hash so it reads as a genuine hidden trait.
 */
export function deriveConsistency(seed: string, composure?: number, determination?: number): number {
  const jitter = hash01(seed) // 0..1
  const ment = ((composure ?? 50) * 0.6 + (determination ?? 50) * 0.4) / 100 // 0..1
  const blended = 0.6 * jitter + 0.4 * ment // 0..1
  return Math.max(1, Math.min(20, Math.round(2 + blended * 16))) // ~2..18, centred ~10–11
}

const SWING_MAX = 1.2 // rating points of game-to-game swing at consistency = 1
const BIAS_MAX = 0.6 // reliable bump / erratic drag at the extremes

/**
 * Adjust a raw 5.0–9.5 game rating for the player's hidden consistency, given a
 * deterministic uniform draw `noise01` in [0,1) supplied by the caller (keeps
 * this pure). Absent consistency → returned unchanged (exact no-op), so players
 * without the trait behave exactly as before.
 */
export function applyConsistency(rating: number, consistency: number | undefined, noise01: number): number {
  if (consistency === undefined) return rating
  const c = Math.max(0, Math.min(1, (consistency - 1) / 19)) // 0..1
  const bias = (c - 0.5) * BIAS_MAX // reliable +, erratic −
  const swing = (1 - c) * SWING_MAX // erratic players swing more
  const n = noise01 * 2 - 1 // [-1, 1)
  const adj = rating + bias + n * swing
  return Math.max(5.0, Math.min(9.5, Math.round(adj * 10) / 10))
}

/** A scout's qualitative read of a consistency value (it's never shown raw). */
export function consistencyLabel(c: number): string {
  if (c >= 16) return 'Brings it almost every night — rock-solid reliable'
  if (c >= 12) return 'Dependable — rarely turns in an off night'
  if (c >= 9) return 'Streaky — runs hot and cold'
  if (c >= 5) return 'Erratic — big swings from game to game'
  return 'Wildly inconsistent — a coin flip on any given night'
}
