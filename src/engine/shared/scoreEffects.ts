/**
 * Score effects — the single most robust pattern in NHL shot data.
 *
 * A trailing team pushes for offense (opens up, pinches, generates more shot
 * volume) while a leading team sits back to protect its lead. Real play-by-play
 * shows the trailing team taking ~54–56% of shot attempts, and the split widens
 * as the clock runs down. Both sim engines share this so a watched game and a
 * background game bend the same way.
 *
 * `scoreEffectMult` returns a multiplier on the ATTACKING team's shot-generation
 * rate. It is symmetric around a tie — a one-goal lead damps the leader by the
 * same amount a one-goal deficit lifts the chaser — so with roughly balanced
 * possession the TOTAL shot volume is conserved and the calibration targets are
 * undisturbed; only the *share* moves toward whoever is chasing. The effect is
 * scaled by how far the game has run: negligible at puck drop, full in the third.
 *
 * Deterministic: a pure function of the score and the clock, no Rng — so seeded
 * replays are byte-for-byte unchanged.
 */

// Per-goal swing in shot rate at full (late-game) strength. The chaser's push is
// a touch stronger than the leader's clamp: leading teams tend to be the better
// teams (they earned the lead), so a symmetric multiplier would cut more real
// shots off the stronger side and drag total volume down. Boosting the chaser
// slightly more keeps the TOTAL conserved while still tilting the share toward
// whoever is behind — which is exactly what the play-by-play shows.
const PER_GOAL_PUSH = 0.065 // trailing team: shoot more
const PER_GOAL_PROTECT = 0.04 // leading team: sit back
/** Behavior saturates past a two-goal margin (a 4-goal lead isn't 4× as passive). */
const MARGIN_CAP = 2

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * @param lead     attacker.goals − defender.goals (negative = attacker trailing)
 * @param progress fraction of regulation elapsed, 0 at puck drop → 1 at the horn
 * @returns        shot-rate multiplier for the attacking team (1 when tied)
 */
export function scoreEffectMult(lead: number, progress: number): number {
  if (lead === 0) return 1
  const margin = Math.max(-MARGIN_CAP, Math.min(MARGIN_CAP, lead))
  const timeWeight = 0.3 + 0.7 * clamp01(progress)
  // Leading (margin > 0) → <1 (protect); trailing (margin < 0) → >1 (push).
  const perGoal = margin < 0 ? PER_GOAL_PUSH : PER_GOAL_PROTECT
  return 1 - margin * perGoal * timeWeight
}
