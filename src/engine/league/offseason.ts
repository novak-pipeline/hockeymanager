/**
 * Offseason machinery: player development & aging, retirements, and the draft
 * (class generation, order building, AI selection).
 *
 * Determinism is sacred: every stochastic decision flows through the caller's
 * seeded Rng, so the same league state + seed always produces the same
 * offseason. All returned shapes are JSON-safe (no Maps, no class instances).
 *
 * Development model (FM-style, tuned later by calibration):
 *  - Branching uses the age of the season just played (pre-increment).
 *  - Under 26: every attribute closes a fraction of its gap to potential. The
 *    rate scales with age (younger = faster), personality (ambition /
 *    professionalism / determination), and games played last season.
 *  - 26–29: the plateau — ratings hold.
 *  - 30+: physical attributes decline first (speed/acceleration/agility/
 *    stamina fastest), technical/defensive from 32, mental holds longest
 *    (from 35). Decline steepens past 33.
 *
 * Performance-relative development (Story Wave 1):
 *  - A performance ratio (actual P/G vs expected P/G) further multiplies
 *    development. Over-performers grow faster; under-performers are stunted
 *    (U26) or decline faster (29+). Determination personality dampens bust
 *    spirals. Confidence swings (morale changes) are emitted as news seeds
 *    for the top league-wide swings.
 */
import {
  asPlayerId,
  type Contract,
  type DraftClass,
  type DraftPick,
  type DraftProspect,
  type DraftState,
  type GoalieAttributes,
  type Personality,
  type Player,
  type PlayerId,
  type PlayerRole,
  type Position,
  type RawAttributes,
  type SeasonStats,
  type Team,
  type TeamId
} from '@domain'
import { FIRST_NAMES, LAST_NAMES } from '@data'
import { computeComposites, invalidatePotentialRating, overall } from '@engine/ratings/composites'
import { analystEdge } from '@engine/league/draftRankings'
import { UNTARGETED_FOCUS_DRAG } from '@engine/league/practice'
import type { Rng } from '@engine/shared/rng'

/* ────────────────────────── shared helpers ────────────────────────── */

const clampRating = (v: number): number => Math.round(v < 1 ? 1 : v > 99 ? 99 : v)

/**
 * The attribute group interfaces have no index signature, but development
 * mutates them generically — this cast is the one sanctioned escape hatch.
 */
type MutableGroup = Record<string, number>
const asGroup = (g: object): MutableGroup => g as MutableGroup

/** Skater + goalie groups in a stable order, so ratings/potential zip up. */
function groupsOf(raw: RawAttributes): MutableGroup[] {
  const groups = [
    asGroup(raw.technical),
    asGroup(raw.physical),
    asGroup(raw.mental),
    asGroup(raw.defensive)
  ]
  if (raw.goalie) groups.push(asGroup(raw.goalie))
  return groups
}

/* ────────────────────────── development & aging ────────────────────────── */

/** Physical attributes that erode fastest with age. */
const FAST_DECLINE = new Set(['speed', 'acceleration', 'agility', 'stamina'])

/**
 * Close a fraction (`rate`, jittered per attribute) of each attribute's gap to
 * potential. Monotone non-decreasing and hard-capped at potential.
 *
 * `attributeBias` (#170) reallocates growth by practice focus: a raw-attribute
 * key present in the map grows at `rate * (1 + bias)`, everything else at
 * `rate * (1 - UNTARGETED_DRAG)`. Passing `undefined` (no focus / balanced /
 * AI teams) leaves the rate untouched — and since the multiplier consumes no
 * RNG, the result is identical to before, preserving calibration.
 */
function applyGrowth(
  ratings: RawAttributes,
  potential: RawAttributes,
  rate: number,
  rng: Rng,
  attributeBias?: Partial<Record<string, number>>
): void {
  const curGroups = groupsOf(ratings)
  const potGroups = groupsOf(potential)
  const n = Math.min(curGroups.length, potGroups.length)
  for (let g = 0; g < n; g++) {
    const cur = curGroups[g]
    const pot = potGroups[g]
    for (const key of Object.keys(cur)) {
      const ceiling = pot[key]
      if (ceiling === undefined) continue
      const gap = ceiling - cur[key]
      if (gap <= 0) continue
      const focusMult = attributeBias ? 1 + (attributeBias[key] ?? -UNTARGETED_FOCUS_DRAG) : 1
      const r = Math.min(0.85, rate * Math.max(0, focusMult) * rng.float(0.75, 1.25))
      cur[key] = Math.max(cur[key], Math.min(ceiling, Math.round(cur[key] + gap * r)))
    }
  }
}

/**
 * Age-related erosion. Rates are rating points per year before per-attribute
 * jitter; monotone non-increasing and floored at 1. Height never changes.
 */
function applyDecline(ratings: RawAttributes, seasonAge: number, rng: Rng): void {
  const fast = 1.2 + Math.max(0, seasonAge - 33) * 0.9
  const slowPhysical = fast * 0.45
  const technical = seasonAge >= 32 ? 0.5 + Math.max(0, seasonAge - 33) * 0.4 : 0
  const mental = seasonAge >= 35 ? 0.3 + (seasonAge - 35) * 0.25 : 0

  const drop = (group: MutableGroup, key: string, rate: number): void => {
    if (rate <= 0) return
    const next = Math.round(group[key] - rate * rng.float(0.5, 1.5))
    group[key] = Math.max(1, Math.min(group[key], next))
  }

  const phys = asGroup(ratings.physical)
  for (const key of Object.keys(phys)) {
    if (key === 'height') continue
    drop(phys, key, FAST_DECLINE.has(key) ? fast : slowPhysical)
  }
  for (const key of Object.keys(ratings.technical)) drop(asGroup(ratings.technical), key, technical)
  for (const key of Object.keys(ratings.defensive)) drop(asGroup(ratings.defensive), key, technical)
  if (ratings.goalie) {
    for (const key of Object.keys(ratings.goalie)) drop(asGroup(ratings.goalie), key, technical)
  }
  for (const key of Object.keys(ratings.mental)) drop(asGroup(ratings.mental), key, mental)
}

function toGamesLookup(
  src: Map<PlayerId, number> | ((id: PlayerId) => number)
): (id: PlayerId) => number {
  if (typeof src === 'function') return src
  const map = src
  return (id) => map.get(id) ?? 0
}

/**
 * Boom/bust ceiling drift for young players (≤23). A player's potential is NOT a
 * fixed promise: each developmental year his ceiling can drift up or down,
 * driven by his work ethic (ambition/professionalism/determination), how he
 * performed vs expectation, and a luck term. Over a few seasons this compounds
 * into realistic outcomes — most prospects land near their projection, a minority
 * bust well below it, and a rare few break out above it (including low-rated
 * players who "pop"). Mutates p.potential (the growth cap) and p.basePotential
 * (the projection anchor). Returns the overall-equivalent drift this year.
 */
/**
 * Persistent per-player development arc — a hidden, stable trait (seeded by id)
 * for how well a player converts opportunity into growth. Most land near 1.0; a
 * tail under-develops (busts) and a tail over-achieves. This is what makes two
 * prospects with the SAME true ceiling end up in different places — outcomes are
 * a distribution, not a deterministic march to potential. Center-weighted via
 * the average of two hashes; bounded [0.55, 1.4].
 */
function devArc(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  const a = ((h >>> 0) / 0xffffffff)
  h ^= 0x9e3779b9; h = Math.imul(h, 0x85ebca6b)
  const b = ((h >>> 0) / 0xffffffff)
  const t = (a + b) / 2 // triangular, centered at 0.5
  return 0.40 + t * 1.15 // [0.40, 1.55] — wide enough for real bust/boom variance
}

function driftYouthCeiling(
  p: Player,
  seasonAge: number,
  perfRatio: number,
  hadSample: boolean,
  rng: Rng
): number {
  if (seasonAge > 23) return 0
  const persona =
    (p.personality.ambition + p.personality.professionalism + p.personality.determination) / 3
  const personaBias = (persona - 11) * 0.18 // hard workers trend up, low-motor down
  let perfBias = 0
  if (hadSample) {
    if (perfRatio > 1.4) perfBias = Math.min(4, (perfRatio - 1.4) * 5) // exceeding → ceiling up
    else if (perfRatio < 0.7) perfBias = Math.max(-4, (perfRatio - 0.7) * 6) // failing → down
  }
  // Slight negative mean: more prospects fall short of their ceiling than exceed
  // it (busts outnumber breakouts), matching real draft outcomes.
  const luck = rng.normal(-0.5, 2.2)
  // The hidden "analyst edge" pays out here — a stable factor the PUBLIC board read
  // (and your scouts, reading raw tools, didn't), so an analyst darling tends to
  // rise and an analyst fade tends to slip. Modest per-offseason; accumulates over
  // the development window. This is what lets the analysts be right vs your scouts.
  const edgeBias = analystEdge(p.id as unknown as string) * 1.2
  const youthMult = seasonAge <= 19 ? 1 : seasonAge <= 21 ? 0.8 : 0.55
  const delta = Math.round((personaBias + perfBias + luck + edgeBias) * youthMult)
  if (delta === 0) return 0

  const curOvr = overall(p.composites, p.position)
  for (const g of groupsOf(p.potential)) {
    for (const k in g) {
      if (k === 'height') continue
      g[k] = Math.max(1, Math.min(99, g[k] + delta))
    }
  }
  invalidatePotentialRating(p.potential)
  if (p.basePotential !== undefined) {
    p.basePotential = Math.max(curOvr, Math.min(99, Math.round(p.basePotential + delta)))
  }
  return delta
}

/**
 * Calibrated expected points-per-game curve for skaters, parameterised by
 * overall rating (0–100), position, and role. Defensemen produce ~55% of
 * forward output. Representative anchors (forward):
 *
 *   ovr 50  W  → 0.35 P/G
 *   ovr 60  C  → 0.55 P/G
 *   ovr 70  C  → 0.80 P/G
 *   ovr 80  C  → 1.05 P/G
 *   ovr 90  C  → 1.30 P/G
 *
 * Centermen get a small playmaking bonus (+0.05) versus wings.
 * Goalies are not handled here; pass 0.92 (league-average sv%) or equivalent.
 *
 * RULESET-AWARE: this is a supply of numbers, not a policy — callers can
 * substitute a different curve by passing the expectations arg to developPlayers.
 */
export function expectedPointsFor(ovr: number, position: Position, _role: PlayerRole): number {
  if (position === 'G') {
    // Goalies use save-percentage expectations; fallback to a neutral 1.0 ratio.
    return 0.915
  }
  // Linear interpolation: 0.35 P/G at ovr 50 → 1.30 P/G at ovr 90 (forward).
  // Clamped to a reasonable range so fringe call-ups and legends don't break the math.
  const forwardBase = 0.35 + ((Math.max(40, Math.min(99, ovr)) - 50) / 40) * 0.95
  const posBonus = position === 'C' ? 0.05 : 0
  const defensemenScale = position === 'D' ? 0.55 : 1.0
  return Math.max(0.05, (forwardBase + posBonus) * defensemenScale)
}

/**
 * Annual development pass over every player: age +1, contract year burned,
 * attributes grown/declined per the model above, composites recomputed
 * (mandatory — they are a cache of ratings), fatigue cleared and form
 * regressed toward 0 for the new season.
 *
 * Optional performance args (back-compat: existing callers pass none):
 *  - performance(id)    → { points, gamesPlayed, position, toiPerGame? }
 *  - expectations(id)   → expected P/G (supply via expectedPointsFor())
 *  - devModifier(id)    → locker-room mentorship multiplier [0.9–1.15], default 1
 *
 * Returns seeds for league news: the biggest overall risers ('breakout') and
 * fallers ('decline'), at most five of each league-wide. Additionally emits
 * 'confidenceBoost' and 'crisisOfConfidence' seeds for the top 4 league-wide
 * performance-driven morale swings (requires performance arg to be present).
 */
export function developPlayers(args: {
  players: Map<PlayerId, Player>
  gamesPlayedById: Map<PlayerId, number> | ((id: PlayerId) => number)
  year: number
  rng: Rng
  /** Optional: supply actual season stats per player. */
  performance?: (id: PlayerId) => {
    points: number
    gamesPlayed: number
    position: Position
    /** Goalie save percentage — used instead of P/G when position is 'G'. */
    savePct?: number
  }
  /** Optional: supply expected P/G (or expected sv% for goalies). Defaults to expectedPointsFor. */
  expectations?: (id: PlayerId) => number
  /** Optional: locker-room mentorship multiplier per player [0.9–1.15]. Defaults to 1. */
  devModifier?: (id: PlayerId) => number
  /** Optional: scale on the U26 growth rate, [0..1]. When in-season development
   *  is active the caller passes <1 so the summer pass only delivers the share
   *  not already gained continuously, keeping annual totals calibrated. Default 1. */
  growthScale?: number
  /** Optional (#170): per-player practice-focus attribute bias. Returning a map
   *  reallocates growth toward the targeted raw attributes (others drag); return
   *  undefined for players with no active focus (byte-identical to before). */
  attributeBias?: (id: PlayerId) => Partial<Record<string, number>> | undefined
}): { newsSeeds: Array<{ playerId: PlayerId; kind: 'breakout' | 'decline' | 'confidenceBoost' | 'crisisOfConfidence' }> } {
  const { players, rng } = args
  const gamesPlayed = toGamesLookup(args.gamesPlayedById)

  /** Confidence swings tracked for news-seed emission at the end. */
  interface ConfidenceEntry { playerId: PlayerId; swing: number }
  const confidenceSwings: ConfidenceEntry[] = []

  const deltas: Array<{ playerId: PlayerId; delta: number }> = []
  for (const p of players.values()) {
    if (p.retiredYear !== undefined) continue // a retired player is frozen — no aging/dev
    const before = overall(p.composites, p.position)
    const seasonAge = p.age
    p.age += 1
    p.contract.yearsRemaining = Math.max(0, p.contract.yearsRemaining - 1)

    // ── performance ratio ─────────────────────────────────────────────────
    // growthMult: multiplicative modifier on the base growth rate (U26).
    // declineExtraPass: whether to run a second decline pass (vet underperformers).
    let growthMult = 1.0
    let declineExtraPass = false
    let moraleSwing = 0
    let perfRatio = 1.0
    let hadSample = false

    if (args.performance) {
      const perf = args.performance(p.id)
      const gp = perf.gamesPlayed

      if (gp >= 20) {
        let ratio: number
        if (perf.position === 'G' && perf.savePct !== undefined) {
          // Goalie: ratio = actual sv% / expected sv%.
          const expSv = args.expectations
            ? args.expectations(p.id)
            : expectedPointsFor(overall(p.composites, p.position), p.position, p.role)
          ratio = expSv > 0 ? perf.savePct / expSv : 1.0
        } else {
          // Skater: ratio = actual P/G / expected P/G.
          const ppg = perf.points / gp
          const expPpg = args.expectations
            ? args.expectations(p.id)
            : expectedPointsFor(overall(p.composites, p.position), p.position, p.role)
          ratio = expPpg > 0 ? ppg / expPpg : 1.0
        }
        perfRatio = ratio
        hadSample = true

        const devMod = args.devModifier ? args.devModifier(p.id) : 1.0

        if (ratio > 1.35) {
          // Over-performer: growth multiplier up to +60%; confidence boost.
          const boost = Math.min(0.6, (ratio - 1.35) * 0.8 + 0.1)
          growthMult = (1.0 + boost) * devMod
          moraleSwing = 5
        } else if (ratio < 0.6) {
          // Under-performer: U26 growth stunted; 29+ decline accelerated.
          // Determination ≥ 15 floors the growth stunting at −25% (multiplier 0.75).
          const determination = p.personality.determination
          const stunFloor = determination >= 15 ? 0.75 : 0.5
          growthMult = stunFloor * devMod
          if (seasonAge >= 29) declineExtraPass = true
          moraleSwing = -5
        } else {
          // Neutral: still apply devModifier.
          growthMult = devMod
        }

        if (moraleSwing !== 0) {
          p.morale = Math.max(0, Math.min(100, p.morale + moraleSwing))
          confidenceSwings.push({ playerId: p.id, swing: moraleSwing })
        }
      } else {
        // Fewer than 20 games: still apply devModifier if present (e.g. mentor effect).
        growthMult = args.devModifier ? args.devModifier(p.id) : 1.0
      }
    } else if (args.devModifier) {
      // devModifier can be supplied without performance (mentorship alone).
      growthMult = args.devModifier(p.id)
    }

    // ── ceiling drift (boom/bust) then growth / decline ───────────────────
    // Revise the young player's ceiling first, so this year's growth chases the
    // updated target — a breakout opens new room, a bust shuts it down.
    p.ceilingTrend = driftYouthCeiling(p, seasonAge, perfRatio, hadSample, rng)

    // Goalies develop and age on a later curve than skaters: they keep growing
    // into their late 20s, hold a long prime, and don't start slipping until
    // their mid-30s. Skaters peak ~24–27 and decline from 30.
    const isGoalie = p.position === 'G'
    const peakAge = isGoalie ? 28 : 26
    const declineAge = isGoalie ? 33 : 30
    if (seasonAge < peakAge) {
      const persona =
        (p.personality.ambition + p.personality.professionalism + p.personality.determination) / 3
      const personaFactor = 0.5 + (persona / 20) * 0.8
      const gamesFactor = 0.6 + 0.4 * Math.min(1, gamesPlayed(p.id) / 60)
      const baseRate = 0.12 + 0.03 * (peakAge - seasonAge)
      const growthScale = args.growthScale ?? 1
      // Persistent per-player arc: busts under-develop, late bloomers over-develop.
      const arc = devArc(p.id as unknown as string)
      const bias = args.attributeBias ? args.attributeBias(p.id) : undefined
      applyGrowth(p.ratings, p.potential, baseRate * personaFactor * gamesFactor * growthMult * growthScale * arc, rng, bias)
    } else if (seasonAge >= declineAge) {
      // Goalie decline is also gentler — treat the curve as if they were a few
      // years younger so a 36-year-old netminder slips like a 33-year-old skater.
      const declineAgeEff = isGoalie ? seasonAge - 3 : seasonAge
      applyDecline(p.ratings, declineAgeEff, rng)
      // Second pass for vet underperformers (accelerated −50% decline).
      if (declineExtraPass) applyDecline(p.ratings, declineAgeEff, rng)
    }

    p.composites = computeComposites(p.ratings, p.role, p.position)
    p.fatigue = 0
    p.form *= 0.3
    if (Math.abs(p.form) < 0.25) p.form = 0
    // Clear the in-season accumulators: next season's continuous development
    // starts from zero, and the offseason trend below supersedes them.
    p.seasonDevAccrued = 0
    p.seasonCeilDrift = 0

    const devDelta = overall(p.composites, p.position) - before
    p.devTrend = devDelta
    deltas.push({ playerId: p.id, delta: devDelta })
  }

  const risers = deltas
    .filter((d) => d.delta >= 2)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5)
  const fallers = deltas
    .filter((d) => d.delta <= -2)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 5)

  // Top 4 league-wide confidence swings in each direction.
  const topBoosts = confidenceSwings
    .filter((e) => e.swing > 0)
    .sort((a, b) => b.swing - a.swing)
    .slice(0, 4)
  const topCrises = confidenceSwings
    .filter((e) => e.swing < 0)
    .sort((a, b) => a.swing - b.swing)
    .slice(0, 4)

  return {
    newsSeeds: [
      ...risers.map((d) => ({ playerId: d.playerId, kind: 'breakout' as const })),
      ...fallers.map((d) => ({ playerId: d.playerId, kind: 'decline' as const })),
      ...topBoosts.map((e) => ({ playerId: e.playerId, kind: 'confidenceBoost' as const })),
      ...topCrises.map((e) => ({ playerId: e.playerId, kind: 'crisisOfConfidence' as const }))
    ]
  }
}

/* ────────────────────────── retirements ────────────────────────── */

/**
 * Retirement is a hazard curve, never a verdict.
 *
 * The old model was a steep age table that hit 0.95 at 40 and floored at 0.90
 * past it, so no player in the world ever reached 41 and every franchise
 * forward hung them up on schedule at 38–39 — the same names, every save. Real
 * careers mostly end between 35 and 40 with a long tail: Ovechkin at 40, Perry
 * at 40, Marleau at 42, Thornton at 43, Chara at 45. Age sets the base rate;
 * what a player is *still doing* decides whether he beats it.
 *
 * Base annual hazard for a league-average skater with no other signal. Below
 * RETIREMENT_MIN_AGE nobody retires by age (the fringe washout below is the
 * only exit); past the top of the table the last entry holds.
 */
const RETIREMENT_MIN_AGE = 33
const RETIREMENT_BASE = [
  /* 33 */ 0.010, /* 34 */ 0.020, /* 35 */ 0.038, /* 36 */ 0.065, /* 37 */ 0.105,
  /* 38 */ 0.160, /* 39 */ 0.280, /* 40 */ 0.400, /* 41 */ 0.530, /* 42 */ 0.660,
  /* 43 */ 0.790, /* 44 */ 0.890, /* 45 */ 0.940, /* 46+ */ 0.970,
]

/**
 * Hard ceiling on the annual hazard by age: high but never certain at 40–41,
 * near-certain only in the early-to-mid 40s. No modifier stack can push a
 * 39-year-old past a coin flip — someone always has one more year in him.
 */
function retirementCeiling(age: number): number {
  if (age >= 45) return 0.99
  if (age >= 43) return 0.95
  if (age >= 41) return 0.85
  if (age >= 40) return 0.70
  return 0.55
}

/** A season's workload and production, as known at the moment retirements are
 *  rolled. Every field is optional — with no sample the curve falls back to age
 *  and ability alone (a fresh league's first summer, an imported body with no
 *  recorded season). */
export interface RetirementForm {
  /** Games played last season across every tier he appeared in. */
  gamesPlayed?: number | undefined
  /** Points last season (skaters). */
  points?: number | undefined
  /** Save percentage last season (goalies), 0–1. */
  savePct?: number | undefined
  /** Average time on ice per game, in seconds. */
  toiPerGame?: number | undefined
}

/** Everything the retirement curve looks at for one player. */
export interface RetirementInput {
  age: number
  /** Current ability, 0–100. */
  ovr: number
  position: Position
  role: PlayerRole
  /** Years left on his deal — a club paying him is a reason to keep playing. */
  yearsRemaining: number
  form?: RetirementForm | undefined
  /** Currently-injured games remaining, if any. */
  injuryGamesRemaining?: number | undefined
  /** EHM durability attribute (1–99); high = chronically fragile. */
  injuryProneness?: number | undefined
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/**
 * Annual probability that this player retires, as a product of an age hazard
 * and what the season just played says about him. Exported so the orphan sweep
 * in career.ts asks exactly the same question the offseason does.
 */
export function retirementProbability(input: RetirementInput): number {
  const { age, ovr, yearsRemaining } = input
  if (age < RETIREMENT_MIN_AGE) return 0
  const base = RETIREMENT_BASE[Math.min(RETIREMENT_BASE.length - 1, age - RETIREMENT_MIN_AGE)]

  // ── ability: a star at 38 is a very different bet than a fourth-liner ──
  let mult = clamp(1 + (63 - ovr) * 0.030, 0.45, 2.2)

  // ── contract status: an unsigned veteran is one un-returned call from done ──
  mult *= yearsRemaining >= 2 ? 0.35 : yearsRemaining === 1 ? 0.60 : 1.15

  const form = input.form
  const gp = form?.gamesPlayed
  if (gp !== undefined) {
    // ── availability: games missed is injury load and healthy-scratch in one ──
    mult *= gp >= 60 ? 0.78 : gp >= 40 ? 1.0 : gp >= 20 ? 1.35 : gp >= 1 ? 1.9 : 2.4

    if (gp >= 20) {
      // ── still productive? measured against what his rating should produce ──
      const expected = expectedPointsFor(ovr, input.position, input.role)
      let ratio = 1
      if (input.position === 'G') {
        if (form?.savePct !== undefined && expected > 0) ratio = form.savePct / expected
      } else if (form?.points !== undefined && expected > 0) {
        ratio = form.points / gp / expected
      }
      mult *= clamp(1 + (1 - ratio) * 0.9, 0.55, 1.8)
    }

    // ── ice time: a 37-year-old down to eight minutes a night is being eased out ──
    const toi = form?.toiPerGame
    if (toi !== undefined && gp >= 20 && input.position !== 'G') {
      mult *= toi >= 1080 ? 0.82 : toi >= 780 ? 1.0 : toi >= 540 ? 1.2 : 1.45
    }
  }

  // ── injury load: a long current absence, or a body that keeps breaking ──
  if ((input.injuryGamesRemaining ?? 0) >= 20) mult *= 1.3
  if ((input.injuryProneness ?? 0) >= 70) mult *= 1.1

  // Diminishing returns. Five reasons to keep playing should not multiply into
  // immortality — but every one of them must still move the number, so this is a
  // compression, never a floor that swallows the weaker signals whole.
  mult = Math.pow(clamp(mult, 0.05, 6), 0.7)
  // And every reason to keep playing is worth less the older he gets: being good
  // at 43 does not buy what being good at 35 buys. Without this taper the signals
  // compound into a protected elite who simply never ages out — the mirror image
  // of the bug this replaces.
  if (mult < 1) mult = 1 - (1 - mult) * clamp((44 - age) / 8, 0, 1)

  return clamp(base * mult, 0.004, retirementCeiling(age))
}

// A sub-replacement pro (below this overall) drifts out of the league — the
// classic AHL/ECHL tweener who never sticks and stops getting NHL looks. It
// starts in his late 20s and only gets likelier; genuine roster players (55+)
// never wash out this way. Distinct from retirement: he is not old, he is done.
const WASHOUT_OVR_CEIL = 55
const WASHOUT_MIN_AGE = 28

/** Annual chance a fringe player leaves pro hockey (goes to Europe, retires,
 *  falls off the map). Rises the weaker he is and the older he gets. */
export function washoutProbability(age: number, ovr: number): number {
  if (ovr >= WASHOUT_OVR_CEIL || age < WASHOUT_MIN_AGE) return 0
  const p = 0.04 + (WASHOUT_OVR_CEIL - ovr) * 0.01 + (age - WASHOUT_MIN_AGE) * 0.015
  return Math.min(0.35, p)
}

/** Last recorded season line, used as the form fallback when the caller has no
 *  live season to hand us. Skips AHL lines for an NHL player's workload read. */
export function retirementFormFromStats(p: Player): RetirementForm | undefined {
  let latest: SeasonStats | undefined
  for (const s of p.stats) {
    if ((s.league ?? 'nhl') === 'ahl') continue
    if (!latest || s.season >= latest.season) latest = s
  }
  if (!latest) return undefined
  const gp = latest.gamesPlayed
  const points =
    latest.ev.goals + latest.pp.goals + latest.pk.goals +
    latest.ev.assists + latest.pp.assists + latest.pk.assists
  const shots = latest.shotsAgainst
  return {
    gamesPlayed: gp,
    points,
    savePct: shots > 0 ? latest.saves / shots : undefined,
    toiPerGame: gp > 0 ? (latest.ev.timeOnIce + latest.pp.timeOnIce + latest.pk.timeOnIce) / gp : undefined,
  }
}

/**
 * Roll retirements. Retirees are removed from their team's roster array but
 * stay in the players map so history screens keep working — the caller is
 * responsible for excluding returned ids from future passes.
 *
 * Two exits, and a player takes whichever is likelier: the age hazard above
 * (33+), and the fringe washout (28+, sub-replacement). Neither is ever a
 * certainty before the mid-40s.
 */
export function processRetirements(args: {
  players: Map<PlayerId, Player>
  teams: Map<TeamId, Team>
  year: number
  rng: Rng
  /** Optional: the season just finished, which `p.stats` does not yet hold at
   *  rollover time. Absent → fall back to his most recent recorded season. */
  form?: (p: Player) => RetirementForm | undefined
}): { retired: PlayerId[] } {
  const { players, teams, rng } = args

  const teamOf = new Map<PlayerId, Team>()
  for (const team of teams.values()) {
    for (const pid of team.roster) teamOf.set(pid, team)
  }

  const retired: PlayerId[] = []
  const retire = (p: Player): void => {
    retired.push(p.id)
    // First-class retirement marker: frozen from future aging/dev passes and
    // excluded from the free-agent pool rebuild, so a retiree never silently
    // reappears or gets processed again. (offseason.ts / career.ts read this.)
    p.retiredYear = args.year
    const team = teamOf.get(p.id)
    if (team) team.roster = team.roster.filter((id) => id !== p.id)
  }
  for (const p of players.values()) {
    if (p.retiredYear !== undefined) continue // already retired — never re-process
    if (p.age < WASHOUT_MIN_AGE) continue
    const ovr = overall(p.composites, p.position)
    const washout = p.contract.yearsRemaining >= 2 ? 0 : washoutProbability(p.age, ovr)
    const byAge =
      p.age >= RETIREMENT_MIN_AGE
        ? retirementProbability({
            age: p.age,
            ovr,
            position: p.position,
            role: p.role,
            yearsRemaining: p.contract.yearsRemaining,
            form: args.form ? args.form(p) : retirementFormFromStats(p),
            injuryGamesRemaining: p.injuryStatus?.gamesRemaining,
            injuryProneness: p.injuryProneness,
          })
        : 0
    if (rng.chance(Math.max(byAge, washout))) retire(p)
  }
  return { retired }
}

/* ────────────────────────── draft classes ────────────────────────── */

const FORWARD_ROLES: PlayerRole[] = ['sniper', 'playmaker', 'twoWay', 'powerForward', 'enforcer']
const FORWARD_ROLE_WEIGHTS = [3, 3, 3, 2, 1]
const DEFENSE_ROLES: PlayerRole[] = ['offensiveD', 'shutdownD', 'stayAtHomeD']

function weightedRole(rng: Rng, roles: PlayerRole[], weights: number[]): PlayerRole {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng.float(0, total)
  for (let i = 0; i < roles.length; i++) {
    r -= weights[i]
    if (r <= 0) return roles[i]
  }
  return roles[roles.length - 1]
}

/** ~8 forwards : 4 defensemen : 1.5 goalies. */
function prospectPosition(rng: Rng): Position {
  const r = rng.float(0, 13.5)
  if (r < 8) return rng.chance(1 / 3) ? 'C' : 'W'
  if (r < 12) return 'D'
  return 'G'
}

/** One attribute drawn around the prospect's current caliber. */
const prospectAttr = (rng: Rng, caliber: number, spread = 6): number =>
  clampRating(rng.normal(caliber, spread))

/** Mirrors data/generate.ts construction so prospects are well-formed. */
function makeProspectAttributes(rng: Rng, caliber: number, position: Position): RawAttributes {
  const raw: RawAttributes = {
    technical: {
      wristShot: prospectAttr(rng, caliber),
      slapShot: prospectAttr(rng, caliber),
      stickhandling: prospectAttr(rng, caliber),
      passing: prospectAttr(rng, caliber),
      deflections: prospectAttr(rng, caliber),
      faceoffs: prospectAttr(rng, position === 'C' ? caliber + 5 : caliber - 10)
    },
    physical: {
      speed: prospectAttr(rng, caliber),
      acceleration: prospectAttr(rng, caliber),
      strength: prospectAttr(rng, caliber - 5),
      balance: prospectAttr(rng, caliber),
      stamina: prospectAttr(rng, caliber),
      agility: prospectAttr(rng, caliber),
      height: clampRating(rng.normal(50, 15))
    },
    mental: {
      offensiveIQ: prospectAttr(rng, caliber),
      defensiveIQ: prospectAttr(rng, caliber),
      positioning: prospectAttr(rng, caliber),
      vision: prospectAttr(rng, caliber),
      aggression: clampRating(rng.normal(50, 18)),
      composure: prospectAttr(rng, caliber),
      workRate: prospectAttr(rng, caliber),
      discipline: clampRating(rng.normal(55, 18)),
      anticipation: prospectAttr(rng, caliber)
    },
    defensive: {
      checking: prospectAttr(rng, caliber),
      shotBlocking: prospectAttr(rng, caliber),
      stickChecking: prospectAttr(rng, caliber),
      takeaway: prospectAttr(rng, caliber)
    }
  }
  if (position === 'G') {
    const g: GoalieAttributes = {
      reflexes: prospectAttr(rng, caliber),
      positioningG: prospectAttr(rng, caliber),
      reboundControl: prospectAttr(rng, caliber),
      glove: prospectAttr(rng, caliber),
      blocker: prospectAttr(rng, caliber),
      recovery: prospectAttr(rng, caliber),
      puckHandlingG: prospectAttr(rng, caliber - 8)
    }
    raw.goalie = g
  }
  return raw
}

/**
 * Prospect ceilings: one per-player upside roll, power-skewed so most picks
 * are modest (busts) and a rare few are generational, then per-attribute
 * variation around it. Always ≥ current.
 */
function makeProspectPotential(rng: Rng, current: RawAttributes): RawAttributes {
  const upside = 4 + Math.pow(rng.next(), 2.4) * 48
  const bump = (v: number): number => clampRating(v + upside * rng.float(0.55, 1.1))
  const bumpGroup = <T extends object>(g: T): T =>
    Object.fromEntries(Object.entries(g).map(([k, v]) => [k, bump(v as number)])) as T
  const pot: RawAttributes = {
    technical: bumpGroup(current.technical),
    physical: bumpGroup(current.physical),
    mental: bumpGroup(current.mental),
    defensive: bumpGroup(current.defensive)
  }
  if (current.goalie) pot.goalie = bumpGroup(current.goalie)
  return pot
}

function makeProspectPersonality(rng: Rng): Personality {
  const t = (): number => rng.range(1, 20)
  return {
    ambition: t(),
    professionalism: t(),
    loyalty: t(),
    temperament: t(),
    determination: t()
  }
}

function makeProspect(rng: Rng, id: PlayerId, year: number): Player {
  const position = prospectPosition(rng)
  const caliber = Math.min(60, Math.max(30, rng.normal(45, 7)))
  const raw = makeProspectAttributes(rng, caliber, position)
  const role: PlayerRole =
    position === 'G'
      ? 'starter'
      : position === 'D'
        ? rng.pick(DEFENSE_ROLES)
        : weightedRole(rng, FORWARD_ROLES, FORWARD_ROLE_WEIGHTS)
  const contract: Contract = {
    salary: 900000,
    yearsRemaining: 0,
    expiryYear: year,
    noTradeClause: false,
    twoWay: true
  }
  return {
    id,
    name: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`,
    age: rng.range(17, 18),
    position,
    handedness: rng.chance(0.65) ? 'L' : 'R',
    role,
    ratings: raw,
    potential: makeProspectPotential(rng, raw),
    composites: computeComposites(raw, role, position),
    personality: makeProspectPersonality(rng),
    contract,
    stats: [],
    fatigue: 0,
    morale: rng.range(50, 80),
    injuryStatus: null,
    form: 0
  }
}

/**
 * Generate a draft class: ages 17–18, modest current ability, high and varied
 * potential. Prospects are ranked by scouting consensus — true potential plus
 * rng noise — so the first overall pick is not always the actual best player.
 */
export function generateDraftClass(args: {
  year: number
  count: number
  rng: Rng
  nextPlayerNumber: () => number
}): { players: Player[]; draftClass: DraftClass } {
  const { year, count, rng, nextPlayerNumber } = args

  const players: Player[] = []
  for (let i = 0; i < count; i++) {
    players.push(makeProspect(rng, asPlayerId('p' + nextPlayerNumber()), year))
  }

  const consensus = players.map((p, i) => ({
    playerId: p.id,
    index: i,
    score: overall(computeComposites(p.potential, p.role, p.position), p.position) + rng.normal(0, 4)
  }))
  consensus.sort((a, b) => b.score - a.score || a.index - b.index)
  const prospects: DraftProspect[] = consensus.map((c, i) => ({ playerId: c.playerId, rank: i + 1 }))

  return { players, draftClass: { year, prospects } }
}

/**
 * Build a draft class from REAL, already-existing draft-eligible players (the
 * imported junior/college/European prospects living in the wider-world
 * competitions) rather than generating fictional ones. Ranks them by the same
 * scouting-consensus formula `generateDraftClass` uses — true potential plus
 * rng noise, so the top board slot isn't always the genuine best — and keeps
 * the top `count` to match the generated class size (the rest stay in junior,
 * undrafted / re-entry eligible next year). Creates no new players.
 */
export function buildDraftClassFromPlayers(args: {
  year: number
  eligible: Player[]
  count: number
  rng: Rng
}): DraftClass {
  const { year, eligible, count, rng } = args
  const consensus = eligible.map((p, i) => ({
    playerId: p.id,
    index: i,
    score: overall(computeComposites(p.potential, p.role, p.position), p.position) + rng.normal(0, 4),
  }))
  consensus.sort((a, b) => b.score - a.score || a.index - b.index)
  const prospects: DraftProspect[] = consensus
    .slice(0, Math.max(0, count))
    .map((c, i) => ({ playerId: c.playerId, rank: i + 1 }))
  return { year, prospects }
}

/* ────────────────────────── draft order & AI picks ────────────────────────── */

/**
 * Build the draft board for one year: picks ordered by round, then by the
 * ORIGINAL team's position in the worst-first standings (traded picks keep the
 * original slot; the owner makes the selection). Picks for other years or
 * rounds beyond `rounds` are ignored.
 */
export function buildDraftOrder(args: {
  year: number
  rounds: number
  picks: DraftPick[]
  standingsWorstFirst: TeamId[]
}): DraftState {
  const { year, rounds, picks, standingsWorstFirst } = args
  const slot = new Map<TeamId, number>(standingsWorstFirst.map((t, i) => [t, i]))
  const slotOf = (teamId: TeamId): number => slot.get(teamId) ?? Number.MAX_SAFE_INTEGER

  const order = picks
    .filter((p) => p.year === year && p.round >= 1 && p.round <= rounds)
    .slice()
    .sort((a, b) => a.round - b.round || slotOf(a.originalTeamId) - slotOf(b.originalTeamId))

  return { year, order, selections: [] }
}

/**
 * AI pick: best-player-available, biased by team need and with the occasional
 * reach a few spots down the board. `needBonus` (0+, optional) nudges a prospect
 * UP the board when his position is thin in the drafting org — it shifts the
 * effective rank by a few spots so a club fills holes without passing on a
 * clearly superior talent. Omitted → pure BPA-with-reach (unchanged).
 */
export function aiSelectProspect(args: {
  remaining: DraftProspect[]
  rng: Rng
  needBonus?: (p: DraftProspect) => number
  /** Per-club board variance (rank nudge, + = this club is higher on him). Lets
   *  each org keep its own slightly different board instead of all AI sharing the
   *  public consensus. Deterministic per (team, prospect). Omitted → consensus. */
  boardBias?: (p: DraftProspect) => number
}): DraftProspect {
  const { remaining, rng, needBonus, boardBias } = args
  const eff = (p: DraftProspect): number =>
    p.rank - (needBonus ? needBonus(p) : 0) - (boardBias ? boardBias(p) : 0)
  const board = [...remaining].sort((a, b) => eff(a) - eff(b) || a.rank - b.rank)
  // Mostly take the best available (need-adjusted); occasionally reach a spot or
  // two, rarely further. Real GMs don't routinely pass on the clear top of their
  // board — keep reaches shallow so AI picks read as sane.
  let i = 0
  while (i < board.length - 1 && i < 4 && rng.chance(0.22)) i++
  return board[i]
}
