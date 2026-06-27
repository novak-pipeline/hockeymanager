/**
 * Fanbase / attendance flywheel: how engaged the club's supporters are (0–100).
 * Winning, deep playoff runs and stars pull fans in; missing the playoffs and
 * prolonged losing pushes them away. Fan interest feeds the owner's budget, so a
 * sustained tank quietly shrinks your war chest — the financial teeth behind a
 * rebuild. Pure + deterministic + JSON-safe; the career layer owns the value,
 * timing, and budget application.
 */

export interface FanSeasonInput {
  /** 1 = best. */
  finalRank: number
  /** teams in the league. */
  n: number
  madePlayoffs: boolean
  wonCup: boolean
  /** True while ownership has sanctioned a rebuild — fans stay patient longer. */
  rebuilding: boolean
}

/**
 * Season-end change in fan interest. Success lifts it; missing the playoffs and
 * bottom-feeding erode it — but a sanctioned rebuild halves the erosion (the fans
 * understand the plan), so you can tear down without instantly emptying the
 * building. It never fully stops the bleed, though: tank long enough and they
 * drift away regardless.
 */
export function fanInterestDelta(r: FanSeasonInput): number {
  let d = 0
  if (r.wonCup) d += 18
  else if (r.finalRank <= Math.ceil(r.n * 0.1)) d += 10 // top ~10%
  else if (r.madePlayoffs) d += 5
  if (!r.madePlayoffs) d -= 7
  if (r.finalRank > Math.ceil(r.n * 0.8)) d -= 7 // bottom ~20%
  // A sanctioned rebuild softens the negative side only (patience, not apathy).
  if (r.rebuilding && d < 0) d = Math.round(d * 0.5)
  return d
}

/**
 * Budget multiplier from fan interest: an engaged fanbase fills the building and
 * the owner opens the chequebook; an empty barn tightens it. 0.78× at 0 interest,
 * 1.0× near the ~60 baseline, 1.22× at 100.
 */
export function budgetFactor(interest: number): number {
  const i = Math.max(0, Math.min(100, interest))
  return 0.78 + (i / 100) * 0.44
}

export function fanInterestLabel(interest: number): string {
  if (interest >= 85) return 'Fever pitch — the building is rocking'
  if (interest >= 70) return 'Buzzing — strong support'
  if (interest >= 55) return 'Engaged — solid backing'
  if (interest >= 40) return 'Lukewarm — patience wearing'
  if (interest >= 25) return 'Restless — empty seats creeping in'
  return 'Apathetic — the fans have checked out'
}
