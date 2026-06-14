/**
 * Raw attributes → composite ratings (docs/ARCHITECTURE.md §3).
 *
 * The sim engine NEVER reads raw attributes — it reads the composites this
 * module produces. That indirection is the whole point: calibration re-tunes
 * these weights without touching the sim loop.
 *
 * All weights here are first-pass estimates. The calibration harness (build
 * step #5) will overwrite the COEFFICIENTS table with data-fit values; keep the
 * shape stable so that swap is a data change, not a code change.
 */
import type {
  CompositeRatings,
  RawAttributes,
  Rating
} from '@domain'
import type { PlayerRole, Position } from '@domain'

type Flat = Record<string, number>

/** Flatten the grouped raw attributes into one lookup for weighted sums. */
function flatten(raw: RawAttributes): Flat {
  const f: Flat = {
    ...raw.technical,
    ...raw.physical,
    ...raw.mental,
    ...raw.defensive
  }
  if (raw.goalie) Object.assign(f, raw.goalie)
  return f
}

/** Weighted average of named attributes; missing attrs count as 0 weight. */
function weighted(flat: Flat, weights: Record<string, number>): Rating {
  let sum = 0
  let total = 0
  for (const key in weights) {
    const w = weights[key]
    const v = flat[key]
    if (v === undefined) continue
    sum += v * w
    total += w
  }
  return total === 0 ? 0 : sum / total
}

const clamp = (v: number): Rating => (v < 0 ? 0 : v > 100 ? 100 : v)

/**
 * penaltyProne needs signed terms (discipline lowers it, aggression raises it),
 * which a normalized weighted average can't express — so it has its own formula
 * centered on 50 (league-average tendency).
 */
function penaltyProneFrom(flat: Flat): Rating {
  const aggression = flat.aggression ?? 50
  const discipline = flat.discipline ?? 50
  const composure = flat.composure ?? 50
  return clamp(50 + 0.6 * (aggression - 50) - 0.6 * (discipline - 50) - 0.2 * (composure - 50))
}

/**
 * Per-composite attribute weights. Each composite is a weighted average of the
 * raw attributes that feed it. Tune via calibration.
 */
const SKATER_WEIGHTS: Record<keyof CompositeRatings, Record<string, number>> = {
  scoring: { wristShot: 3, slapShot: 2, deflections: 1, offensiveIQ: 2, composure: 1, anticipation: 1 },
  playmaking: { passing: 3, vision: 3, offensiveIQ: 2, stickhandling: 1 },
  puckControl: { stickhandling: 3, balance: 2, agility: 1, composure: 1 },
  faceoffWin: { faceoffs: 4, strength: 1, anticipation: 1 },
  hitting: { checking: 3, strength: 2, aggression: 2, speed: 1 },
  blocking: { shotBlocking: 4, defensiveIQ: 1, workRate: 1, positioning: 1 },
  takeaway: { takeaway: 3, stickChecking: 2, anticipation: 2, defensiveIQ: 1 },
  penaltyProne: {}, // computed by penaltyProneFrom() — needs signed terms
  goaltending: {}, // skaters have no goaltending
  skating: { speed: 3, acceleration: 2, agility: 2, balance: 1, stamina: 1 },
  defensiveZone: { defensiveIQ: 3, positioning: 2, stickChecking: 1, shotBlocking: 1, anticipation: 1 }
}

const GOALIE_WEIGHTS: Record<string, number> = {
  reflexes: 3,
  positioningG: 3,
  glove: 2,
  blocker: 2,
  reboundControl: 2,
  recovery: 2,
  composure: 1,
  anticipation: 1
}

/**
 * Role modifiers: additive nudges (in rating points) applied after the weighted
 * base. They express how a role emphasizes certain composites — a sniper shoots
 * better than their raw attributes alone suggest, a shutdown D defends better.
 */
const ROLE_MODIFIERS: Partial<Record<PlayerRole, Partial<CompositeRatings>>> = {
  sniper: { scoring: 6, playmaking: -2 },
  playmaker: { playmaking: 6, scoring: -1 },
  twoWay: { defensiveZone: 4, takeaway: 3 },
  powerForward: { hitting: 5, scoring: 2, puckControl: -1 },
  enforcer: { hitting: 8, penaltyProne: 6, scoring: -6, playmaking: -4 },
  offensiveD: { scoring: 4, playmaking: 4, defensiveZone: -3 },
  shutdownD: { defensiveZone: 6, takeaway: 4, blocking: 3, scoring: -4 },
  stayAtHomeD: { blocking: 5, defensiveZone: 4, hitting: 3, scoring: -5, playmaking: -4 }
}

const emptyComposites = (): CompositeRatings => ({
  scoring: 0,
  playmaking: 0,
  puckControl: 0,
  faceoffWin: 0,
  hitting: 0,
  blocking: 0,
  takeaway: 0,
  penaltyProne: 0,
  goaltending: 0,
  skating: 0,
  defensiveZone: 0
})

/**
 * Compute the composite ratings the sim reads from a player's raw attributes,
 * role, and position. Cache the result on the Player (Player.composites) and
 * recompute only when raw attributes change.
 */
export function computeComposites(
  raw: RawAttributes,
  role: PlayerRole,
  position: Position
): CompositeRatings {
  const flat = flatten(raw)
  const out = emptyComposites()

  if (position === 'G') {
    out.goaltending = clamp(weighted(flat, GOALIE_WEIGHTS))
    // A goalie's skating still matters a little for puck-handling/positioning.
    out.skating = clamp(weighted(flat, SKATER_WEIGHTS.skating) * 0.6)
    return out
  }

  for (const key in SKATER_WEIGHTS) {
    const k = key as keyof CompositeRatings
    out[k] = weighted(flat, SKATER_WEIGHTS[k])
  }
  out.penaltyProne = penaltyProneFrom(flat)

  const mods = ROLE_MODIFIERS[role]
  if (mods) {
    for (const key in mods) {
      const k = key as keyof CompositeRatings
      out[k] += mods[k] as number
    }
  }

  for (const key in out) {
    const k = key as keyof CompositeRatings
    out[k] = clamp(out[k])
  }
  return out
}

/**
 * Single 0–100 overall summarising a player, for sorting rosters and depth
 * charts. Position-aware. Not read by the sim — UI/roster convenience only.
 */
export function overall(c: CompositeRatings, position: Position): Rating {
  if (position === 'G') return Math.round(c.goaltending)
  if (position === 'D') {
    return Math.round(
      0.30 * c.defensiveZone +
        0.18 * c.skating +
        0.15 * c.takeaway +
        0.12 * c.blocking +
        0.13 * c.playmaking +
        0.12 * c.scoring
    )
  }
  // Forwards.
  return Math.round(
    0.30 * c.scoring +
      0.25 * c.playmaking +
      0.18 * c.skating +
      0.12 * c.puckControl +
      0.15 * c.defensiveZone
  )
}

/**
 * Authoritative display rating (0–100). When the player carries a source-DB
 * `baseOverall` (a properly-weighted rating that captures intangibles the
 * composite formula under-values), anchor to it — mostly the DB rating, with a
 * minority pull from the live composites so development/aging still move it.
 * Generated players (no baseOverall) fall back to the composite overall.
 *
 * This is why a 38-year-old franchise centre still reads as elite: his DB rating
 * stays high even though the composite formula would dock him for declined
 * defensive/positional numbers.
 */
export function ratedOverall(p: {
  composites: CompositeRatings
  position: Position
  baseOverall?: number
}): number {
  const computed = overall(p.composites, p.position)
  if (p.baseOverall === undefined) return computed
  return Math.round(0.7 * p.baseOverall + 0.3 * computed)
}

/**
 * Authoritative potential rating (0–100). Anchors to the source-DB
 * `basePotential` (ceiling) when present; else derives from potential composites.
 */
export function ratedPotential(p: {
  potential: RawAttributes
  role: PlayerRole
  position: Position
  basePotential?: number
}): number {
  const computed = overall(computeComposites(p.potential, p.role, p.position), p.position)
  if (p.basePotential === undefined) return computed
  return Math.round(0.7 * p.basePotential + 0.3 * computed)
}

/**
 * Age-aware ceiling (0–100): how good a player can still BECOME, not just his
 * raw potential. Inside the development window (≤20) the full ceiling stands;
 * from 21–24 the remaining upside fades; from 25 on a player has reached his
 * level, so his ceiling is simply his current ability. This stops a 30-year-old
 * fourth-liner from projecting growth into a "middle-six key player".
 */
export function agedPotential(p: {
  composites: CompositeRatings
  potential: RawAttributes
  role: PlayerRole
  position: Position
  age: number
  baseOverall?: number
  basePotential?: number
}): number {
  const cur = ratedOverall(p)
  const ceiling = Math.max(cur, ratedPotential(p))
  if (p.age <= 20) return ceiling
  if (p.age >= 25) return cur
  const frac = (25 - p.age) / 5 // 21 → 0.8 … 24 → 0.2
  return Math.round(cur + (ceiling - cur) * frac)
}
