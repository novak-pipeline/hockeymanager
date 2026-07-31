/**
 * LEVER LAB, PART 2 — the levers that pay off in DEVELOPMENT rather than in a
 * game result: practice focus, individual training focus, mentorship, and how
 * much a player actually plays.
 *
 * Same discipline as leverLab.ts: seeded, mirrored, and measured. The unit here
 * is **overall rating points gained across one season**, plus the movement in
 * the specific composite a focus is supposed to target — because a focus that
 * grows the same total but reallocates it is still doing its job, and a focus
 * that moves neither is decoration.
 *
 * The season model mirrors what career.ts actually runs:
 *   13 bi-weekly `tickInSeasonDevelopment` passes (day % 14 during the regular
 *   season) followed by one `developPlayers` summer pass at growthScale 0.65.
 */
import { generateLeague } from '@data/generate'
import type { Player, PlayerId } from '@domain'
import { computeComposites, overall } from '@engine/ratings/composites'
import { tickInSeasonDevelopment } from '@engine/league/inSeasonDevelopment'
import { developPlayers } from '@engine/league/offseason'
import { practiceDevModifier, type PracticeFocus } from '@engine/league/practice'
import { Rng } from '@engine/shared/rng'

/** Bi-weekly in-season passes in one regular season (career.ts: day % 14). */
export const IN_SEASON_PASSES = 13
/** career.ts passes this so the summer pass only delivers the remaining share. */
export const OFFSEASON_GROWTH_SCALE = 0.65

export interface DevArm {
  /** Team-wide practice focus. */
  focus?: PracticeFocus
  /** Locker-room / mentorship development multiplier (1 = none, 1.15 = full mentor). */
  devModifier?: number
  /** Games played this season — drives the ice-time factor in both dev engines. */
  gamesPlayed?: number
  /**
   * Production relative to expectation (1.0 = exactly as expected). The dev
   * engines have no TOI input, so this is the ONLY channel through which where a
   * player is deployed can reach his development: a prospect in the top six
   * out-produces his expectation, one buried on the fourth line does not.
   */
  perfRatio?: number
}

export interface DevOutcome {
  players: number
  /** Mean overall-rating points gained per player over the season. */
  ovrGain: number
  /** Mean change in each named composite. */
  composite: Record<string, number>
}

const TRACKED = [
  'scoring',
  'playmaking',
  'defensiveZone',
  'skating',
  'hitting',
  'takeaway',
  'puckControl',
] as const

/**
 * Which players a lever can actually reach.
 *
 *  'nhl'       — U23 skaters ON an NHL roster. This is the ONLY cohort the TEAM
 *                practice focus touches (career.practiceAttributeBias skips
 *                anyone outside the user's NHL club unless he has an explicit
 *                individual plan). They are also, by construction, the young
 *                players closest to their ceiling — mean room to grow ≈ 2 pts.
 *  'prospects' — every U23 skater in the world with real room left (the farm,
 *                juniors, Europe). An individual development plan (#174)
 *                follows these players; the team regimen does not.
 */
export type CohortKind = 'nhl' | 'prospects'

export function developmentCohort(seed = 99, kind: CohortKind = 'nhl', maxAge = 23): Map<PlayerId, Player> {
  const data = generateLeague({ seed })
  const cohort = new Map<PlayerId, Player>()
  if (kind === 'nhl') {
    for (const t of data.league.teams) {
      for (const id of data.teams.get(t)!.roster) {
        const p = data.players.get(id)!
        if (p.position === 'G' || p.age > maxAge) continue
        cohort.set(id, structuredClone(p))
      }
    }
    return cohort
  }
  const onNhl = new Set<string>()
  for (const t of data.league.teams) for (const id of data.teams.get(t)!.roster) onNhl.add(id as string)
  for (const [id, p] of data.players) {
    if (p.position === 'G' || p.age > maxAge) continue
    if (onNhl.has(id as string)) continue
    cohort.set(id, structuredClone(p))
  }
  return cohort
}

/** Mean room left to the ceiling, in overall points — the headroom any dev
 *  lever has to work with for this cohort. */
export function cohortHeadroom(cohort: Map<PlayerId, Player>): number {
  let sum = 0
  for (const p of cohort.values()) {
    sum += overall(computeComposites(p.potential, p.role, p.position), p.position) - overall(p.composites, p.position)
  }
  return sum / Math.max(1, cohort.size)
}

/** Run one season of development over a fresh copy of the cohort. */
export function runDevSeason(base: Map<PlayerId, Player>, arm: DevArm, seed = 4242): DevOutcome {
  const players = new Map<PlayerId, Player>()
  for (const [id, p] of base) players.set(id, structuredClone(p))
  const ids = new Set(players.keys())
  const gp = arm.gamesPlayed ?? 70

  const before = new Map<PlayerId, { ovr: number; comp: Record<string, number> }>()
  for (const [id, p] of players) {
    before.set(id, {
      ovr: overall(p.composites, p.position),
      comp: Object.fromEntries(TRACKED.map((k) => [k, p.composites[k]])),
    })
  }

  const bias = (id: PlayerId): Partial<Record<string, number>> | undefined => {
    if (!arm.focus || arm.focus === 'balanced') return undefined
    const p = players.get(id)
    if (!p) return undefined
    const { attributeBias } = practiceDevModifier(arm.focus, p)
    if (arm.focus !== 'recovery' && Object.keys(attributeBias).length === 0) return undefined
    return attributeBias
  }
  const devMod = (): number => arm.devModifier ?? 1
  // Both dev engines compute perfRatio = points / gamesPlayed / expectation, so
  // an expectation of 1.0 makes points-per-game the ratio directly.
  const perf = arm.perfRatio === undefined
    ? undefined
    : (id: PlayerId) => ({
        points: arm.perfRatio! * gp,
        gamesPlayed: gp,
        position: players.get(id)!.position,
      })
  const expectations = arm.perfRatio === undefined ? undefined : (): number => 1

  for (let pass = 0; pass < IN_SEASON_PASSES; pass++) {
    tickInSeasonDevelopment({
      players,
      developIds: ids,
      gamesPlayedById: () => Math.round((gp * (pass + 1)) / IN_SEASON_PASSES),
      rng: new Rng(seed + pass * 977),
      devModifier: devMod,
      attributeBias: bias,
      ...(perf ? { performance: perf, expectations: expectations! } : {}),
    })
  }
  developPlayers({
    players,
    gamesPlayedById: () => gp,
    year: 2026,
    rng: new Rng(seed + 50_000),
    devModifier: devMod,
    growthScale: OFFSEASON_GROWTH_SCALE,
    attributeBias: bias,
    ...(perf ? { performance: perf, expectations: expectations! } : {}),
  })

  let ovrGain = 0
  const comp: Record<string, number> = Object.fromEntries(TRACKED.map((k) => [k, 0]))
  for (const [id, p] of players) {
    const b = before.get(id)!
    ovrGain += overall(p.composites, p.position) - b.ovr
    for (const k of TRACKED) comp[k] += p.composites[k] - b.comp[k]!
  }
  const n = Math.max(1, players.size)
  for (const k of TRACKED) comp[k] /= n
  return { players: players.size, ovrGain: ovrGain / n, composite: comp }
}

export interface DevLeverResult {
  id: string
  name: string
  surface: string
  contrast: string
  /** Δ overall points per player per season, arm A minus arm B. */
  ovrDelta: number
  /** Δ per composite, arm A minus arm B. */
  compositeDelta: Record<string, number>
  /** The composite the lever claims to target, and its measured movement. */
  targeted?: { key: string; delta: number }
  a: DevOutcome
  b: DevOutcome
}

export function measureDevLever(spec: {
  id: string
  name: string
  surface: string
  contrast: string
  a: DevArm
  b: DevArm
  targets?: keyof DevOutcome['composite'] | string
}, cohort: Map<PlayerId, Player>, seed = 4242): DevLeverResult {
  const a = runDevSeason(cohort, spec.a, seed)
  const b = runDevSeason(cohort, spec.b, seed)
  const compositeDelta: Record<string, number> = {}
  for (const k of Object.keys(a.composite)) compositeDelta[k] = a.composite[k]! - b.composite[k]!
  return {
    id: spec.id,
    name: spec.name,
    surface: spec.surface,
    contrast: spec.contrast,
    ovrDelta: a.ovrGain - b.ovrGain,
    compositeDelta,
    ...(spec.targets ? { targeted: { key: spec.targets, delta: compositeDelta[spec.targets] ?? 0 } } : {}),
    a,
    b,
  }
}

/**
 * The development levers, as the GM meets them.
 *
 * Deliberately paired against the neutral default ('balanced' focus, no mentor,
 * a full season of games) so each number reads as "what this choice buys you
 * over doing nothing".
 */
export const DEV_LEVERS = [
  {
    id: 'd-focus-offense',
    name: 'Team practice focus: Offense',
    surface: 'Training → team focus',
    contrast: "'offense'  vs  'balanced'",
    a: { focus: 'offense' as PracticeFocus },
    b: { focus: 'balanced' as PracticeFocus },
    targets: 'scoring',
  },
  {
    id: 'd-focus-defense',
    name: 'Team practice focus: Defense',
    surface: 'Training → team focus',
    contrast: "'defense'  vs  'balanced'",
    a: { focus: 'defense' as PracticeFocus },
    b: { focus: 'balanced' as PracticeFocus },
    targets: 'defensiveZone',
  },
  {
    id: 'd-focus-skating',
    name: 'Team practice focus: Skating',
    surface: 'Training → team focus',
    contrast: "'skating'  vs  'balanced'",
    a: { focus: 'skating' as PracticeFocus },
    b: { focus: 'balanced' as PracticeFocus },
    targets: 'skating',
  },
  {
    id: 'd-focus-physical',
    name: 'Team practice focus: Physical',
    surface: 'Training → team focus',
    contrast: "'physical'  vs  'balanced'",
    a: { focus: 'physical' as PracticeFocus },
    b: { focus: 'balanced' as PracticeFocus },
    targets: 'hitting',
  },
  {
    id: 'd-focus-recovery',
    name: 'Team practice focus: Recovery',
    surface: 'Training → team focus',
    contrast: "'recovery'  vs  'balanced'",
    a: { focus: 'recovery' as PracticeFocus },
    b: { focus: 'balanced' as PracticeFocus },
    targets: 'scoring',
  },
  {
    id: 'd-mentorship',
    name: 'Mentorship pairing',
    surface: 'Development → assign mentor',
    contrast: 'mentored (devModifier 1.15)  vs  unmentored (1.00)',
    a: { devModifier: 1.15 },
    b: { devModifier: 1.0 },
    targets: 'scoring',
  },
  {
    id: 'd-deployment',
    name: 'Deployment (top-six minutes vs fourth-line minutes)',
    surface: 'Tactics → line board',
    contrast: 'producing 1.5× expectation  vs  0.7× — the only channel deployment has',
    a: { perfRatio: 1.5 },
    b: { perfRatio: 0.7 },
    targets: 'scoring',
  },
  {
    id: 'd-icetime',
    name: 'Playing him (games dressed)',
    surface: 'Tactics → line board / scratches',
    contrast: 'full season (82 GP)  vs  press box (5 GP)',
    a: { gamesPlayed: 82 },
    b: { gamesPlayed: 5 },
    targets: 'scoring',
  },
]
