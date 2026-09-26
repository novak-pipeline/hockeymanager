/**
 * THE WAGE INDEX — the league economy moves with the cap
 * (docs/LIVING-WORLD-ECONOMY-AND-AI.md).
 *
 * The ceiling compounds ~4.5% a year (`CAP_GROWTH`). Before this module every
 * price in the game — contract asks, the "fair salary" curve trade value reads,
 * the league minimum, entry-level deals, offer-sheet compensation tiers, world
 * contracts — was in fixed dollars, so by the mid-2030s a club could hold every
 * star it had and the cap stopped binding (the audit's root cause of the 7-Cup
 * autopilot dynasty).
 *
 * Every price is now quoted in "base-year dollars" and multiplied by
 * `wageIndex()` = today's ceiling / the ceiling the league started with. Year
 * one is byte-identical (index 1.0); after that, salaries grow with the cap and
 * the squeeze persists forever.
 *
 * The index (and the ask modifier) is process-global on purpose: `askTerms` has
 * ~20 call sites and the trade-value curve is read everywhere. The owning
 * Career installs both on construction, on load and on every `step()`, so the
 * values always describe the career being simulated. With no career installed
 * the index is 1.0 and the modifier is neutral — pure-function tests are
 * unaffected.
 */
import type { Player } from '@domain'

let currentIndex = 1
let currentTalentShift = 0
let askModifier: ((p: Player) => number) | null = null

/**
 * THE TALENT ANCHOR. Prices follow a player's standing in TODAY's league, not
 * an absolute overall: if the league's top-end talent drifts down over decades
 * (aging imports, thinner classes), a player who is now the 20th-best in the
 * league still asks what the 20th-best asked in the base year. This is the
 * overall-points shift (base top-end mean − today's), bounded.
 */
export function talentShift(): number {
  return currentTalentShift
}

export function setTalentShift(shift: number): void {
  currentTalentShift = Number.isFinite(shift) ? Math.max(-4, Math.min(10, shift)) : 0
}

/** Today's ceiling as a multiple of the ceiling the league opened with. */
export function wageIndex(): number {
  return currentIndex
}

/** Install the index (the Career calls this; tests may too). Clamped sane. */
export function setWageIndex(index: number): void {
  currentIndex = Number.isFinite(index) && index > 0 ? Math.max(0.5, Math.min(8, index)) : 1
}

/** A per-player multiplier on the market ask — performance-sensitive asks
 *  (contract-year breakouts, rings, slumps). Installed by the Career, which is
 *  the only layer that can see the season just played. */
export function setAskModifier(fn: ((p: Player) => number) | null): void {
  askModifier = fn
}

export function askModifierFor(p: Player): number {
  if (!askModifier) return 1
  const m = askModifier(p)
  return Number.isFinite(m) ? Math.max(0.8, Math.min(1.35, m)) : 1
}

/** A base-year dollar amount in today's money, rounded to $25k. */
export function indexed(baseDollars: number): number {
  return Math.round((baseDollars * currentIndex) / 25_000) * 25_000
}
