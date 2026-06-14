/**
 * In-season player development.
 *
 * EHM/FM model development continuously, not as a single summer jump: a player's
 * current ability drifts every few weeks based on how much he plays, how he's
 * performing versus expectation, his age, and his work ethic. This module is
 * that continuous driver — a small micro-pass run on a roughly bi-weekly cadence
 * during the regular season. The offseason pass (`developPlayers`) remains the
 * consolidation step; when in-season development is active the offseason scales
 * its growth down (see `developPlayers`'s `growthScale`) so a player's annual
 * total stays in a calibrated band.
 *
 * Two governors keep this stable and deterministic:
 *  - A per-season *budget* (in overall points) caps how far a player can move
 *    in-season regardless of how many passes run, so a long season or a short
 *    one converge to roughly the same total.
 *  - All randomness flows through the caller's seeded Rng.
 *
 * The visible payoff is FM-style live trend arrows: a developing prospect's
 * ability and ceiling arrows tick up across the season, a fading veteran's tick
 * down — without waiting for the offseason.
 */
import {
  type Player,
  type PlayerId,
  type Position,
  type RawAttributes,
} from '@domain'
import { computeComposites, overall } from '@engine/ratings/composites'
import type { Rng } from '@engine/shared/rng'

/* ── group helpers (mirror offseason.ts; kept private to this module) ── */

type MutableGroup = Record<string, number>
const asGroup = (g: object): MutableGroup => g as MutableGroup

function groupsOf(raw: RawAttributes): MutableGroup[] {
  const groups = [
    asGroup(raw.technical),
    asGroup(raw.physical),
    asGroup(raw.mental),
    asGroup(raw.defensive),
  ]
  if (raw.goalie) groups.push(asGroup(raw.goalie))
  return groups
}

const FAST_DECLINE = new Set(['speed', 'acceleration', 'agility', 'stamina'])

/**
 * Per-season ceiling for how far a player may move in-season (signed overall
 * points). Positive for the young (toward their potential), ~0 in the prime,
 * negative for veterans (gentle erosion). Young budgets scale with the room
 * left to their ceiling, so a raw prospect with a high projection can climb
 * meaningfully while a near-finished one barely moves.
 */
function seasonBudget(seasonAge: number, gapOverall: number): number {
  if (seasonAge >= 30) {
    // Gentle in-season decline, steepening past 32.
    return -(0.6 + Math.max(0, seasonAge - 32) * 0.4)
  }
  if (seasonAge >= 26) return 0 // plateau — in-season movement comes from the offseason only
  const ageW =
    seasonAge <= 18 ? 1.0 : seasonAge <= 20 ? 0.85 : seasonAge <= 22 ? 0.65 : seasonAge <= 24 ? 0.45 : 0.25
  return ageW * Math.min(gapOverall, 10) * 0.22
}

/** Close a small fraction of each attribute's gap to potential (jittered). */
function microGrowth(ratings: RawAttributes, potential: RawAttributes, rate: number, rng: Rng): void {
  const cur = groupsOf(ratings)
  const pot = groupsOf(potential)
  const n = Math.min(cur.length, pot.length)
  for (let g = 0; g < n; g++) {
    for (const key of Object.keys(cur[g])) {
      const ceiling = pot[g][key]
      if (ceiling === undefined) continue
      const gap = ceiling - cur[g][key]
      if (gap <= 0) continue
      const r = Math.min(0.4, rate * rng.float(0.7, 1.3))
      cur[g][key] = Math.max(cur[g][key], Math.min(ceiling, Math.round(cur[g][key] + gap * r)))
    }
  }
}

/** Erode attributes by a small per-pass amount (scaled-down age decline). */
function microDecline(ratings: RawAttributes, seasonAge: number, rate: number, rng: Rng): void {
  const fast = (1.2 + Math.max(0, seasonAge - 33) * 0.9) * rate
  const slowPhysical = fast * 0.45
  const technical = (seasonAge >= 32 ? 0.5 + Math.max(0, seasonAge - 33) * 0.4 : 0) * rate
  const mental = (seasonAge >= 35 ? 0.3 + (seasonAge - 35) * 0.25 : 0) * rate

  const drop = (group: MutableGroup, key: string, amt: number): void => {
    if (amt <= 0) return
    const next = group[key] - amt * rng.float(0.5, 1.5)
    group[key] = Math.max(1, Math.min(group[key], next))
  }
  const phys = asGroup(ratings.physical)
  for (const key of Object.keys(phys)) {
    if (key === 'height') continue
    drop(phys, key, FAST_DECLINE.has(key) ? fast : slowPhysical)
  }
  for (const key of Object.keys(ratings.technical)) drop(asGroup(ratings.technical), key, technical)
  for (const key of Object.keys(ratings.defensive)) drop(asGroup(ratings.defensive), key, technical)
  if (ratings.goalie) for (const key of Object.keys(ratings.goalie)) drop(asGroup(ratings.goalie), key, technical)
  for (const key of Object.keys(ratings.mental)) drop(asGroup(ratings.mental), key, mental)
}

/**
 * Run one in-season development micro-pass over the active rosters.
 *
 * @returns the number of players whose ability moved this pass.
 */
export function tickInSeasonDevelopment(args: {
  players: Map<PlayerId, Player>
  /** Players eligible to develop in-season — typically the union of all team
   *  rosters (incl. farm). Excludes the foggy draft/junior pool, which develops
   *  only in the offseason. */
  developIds: Set<PlayerId>
  /** Season games played so far (NHL + farm combined). Drives the ice-time
   *  factor: heavy minutes develop fully, scratches stagnate. */
  gamesPlayedById: (id: PlayerId) => number
  rng: Rng
  /** Optional actual production so far (combined tiers). */
  performance?: (id: PlayerId) => {
    points: number
    gamesPlayed: number
    position: Position
    savePct?: number
  }
  /** Optional expected P/G (or sv% for goalies) — supply via expectedPointsFor. */
  expectations?: (id: PlayerId) => number
  /** Optional locker-room / coaching multiplier per player [~0.9–1.15]. */
  devModifier?: (id: PlayerId) => number
}): { developed: number } {
  const { players, developIds, gamesPlayedById, rng } = args
  let developed = 0

  for (const id of developIds) {
    const p = players.get(id)
    if (!p) continue
    const seasonAge = p.age
    const gp = gamesPlayedById(id)

    const potOvr = overall(computeComposites(p.potential, p.role, p.position), p.position)
    const beforeOvr = overall(p.composites, p.position)
    const gap = Math.max(0, potOvr - beforeOvr)

    const budget = seasonBudget(seasonAge, gap)
    const accrued = p.seasonDevAccrued ?? 0

    // ── performance multiplier (needs a real sample) ─────────────────────
    let perfMult = 1.0
    let perfRatio = 1.0
    let hadSample = false
    if (args.performance) {
      const perf = args.performance(id)
      if (perf.gamesPlayed >= 10) {
        const exp = args.expectations ? args.expectations(id) : undefined
        if (perf.position === 'G' && perf.savePct !== undefined && exp && exp > 0) {
          perfRatio = perf.savePct / exp
        } else if (exp && exp > 0) {
          perfRatio = perf.points / perf.gamesPlayed / exp
        }
        hadSample = true
        if (perfRatio > 1.3) perfMult = Math.min(1.4, 1 + (perfRatio - 1.3) * 0.6)
        else if (perfRatio < 0.7) perfMult = Math.max(0.6, 1 - (0.7 - perfRatio) * 0.6)
      }
    }
    const devMod = args.devModifier ? args.devModifier(id) : 1.0

    if (budget > 0 && accrued < budget) {
      // ── youth growth ───────────────────────────────────────────────────
      const persona =
        (p.personality.ambition + p.personality.professionalism + p.personality.determination) / 3
      const personaFactor = 0.6 + (persona / 20) * 0.6
      const gamesFactor = 0.35 + 0.65 * Math.min(1, gp / 50)
      const rate = 0.035 * personaFactor * gamesFactor * perfMult * devMod
      microGrowth(p.ratings, p.potential, rate, rng)
      p.composites = computeComposites(p.ratings, p.role, p.position)
      // The per-season budget gates future passes once exceeded, so a long
      // season can't over-develop even though a single pass may overshoot.
      const delta = overall(p.composites, p.position) - beforeOvr
      if (delta !== 0) {
        p.seasonDevAccrued = accrued + delta
        developed++
      }
      // Light ceiling drift for a young player who is clearly over/under his
      // expectation — his projection should react during the season too.
      if (hadSample && seasonAge <= 23) {
        const ceilDrift = inSeasonCeilingDrift(p, perfRatio, rng)
        if (ceilDrift !== 0) p.seasonCeilDrift = (p.seasonCeilDrift ?? 0) + ceilDrift
      }
    } else if (budget < 0 && accrued > budget) {
      // ── veteran erosion ─────────────────────────────────────────────────
      // Underperformers and the seldom-used decline a touch faster.
      const declRate = 0.16 * (perfRatio < 0.8 ? 1.3 : 1.0) * (gp < 20 ? 1.15 : 1.0)
      microDecline(p.ratings, seasonAge, declRate, rng)
      p.composites = computeComposites(p.ratings, p.role, p.position)
      const afterOvr = overall(p.composites, p.position)
      const delta = afterOvr - beforeOvr
      if (delta !== 0) {
        p.seasonDevAccrued = accrued + delta
        developed++
      }
    }

    // Live trend arrows reflect season-to-date movement.
    if (p.seasonDevAccrued !== undefined) p.devTrend = p.seasonDevAccrued
    if (p.seasonCeilDrift !== undefined) p.ceilingTrend = p.seasonCeilDrift
  }

  return { developed }
}

/**
 * Occasional in-season ceiling nudge for a young player whose results are far
 * from expectation. Small (±1) and probabilistic so projections evolve through
 * the year without thrashing. Mutates `p.potential` and `p.basePotential`.
 */
function inSeasonCeilingDrift(p: Player, perfRatio: number, rng: Rng): number {
  let delta = 0
  if (perfRatio > 1.5 && rng.chance(0.35)) delta = 1
  else if (perfRatio < 0.55 && rng.chance(0.3)) delta = -1
  if (delta === 0) return 0
  for (const g of groupsOf(p.potential)) {
    for (const k in g) {
      if (k === 'height') continue
      g[k] = Math.max(1, Math.min(99, g[k] + delta))
    }
  }
  if (p.basePotential !== undefined) {
    const curOvr = overall(p.composites, p.position)
    p.basePotential = Math.max(curOvr, Math.min(99, p.basePotential + delta))
  }
  return delta
}
