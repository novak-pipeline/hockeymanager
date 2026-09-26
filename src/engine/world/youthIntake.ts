/**
 * YOUTH INTAKE — the world renews itself.
 *
 * The imported world was a snapshot: nothing ever put a 16-year-old into the
 * OHL, J20 or MHL, so the draft pool ran dry after ~2 drafts and every class
 * after that was a faceless synthetic list (no nation, never played junior).
 * Each summer this pass refills every junior/prep club with a new cohort of
 * 16–17-year-olds from that league's own nations (plus a realistic import
 * share), with per-nation name pools, hometowns, heights, handedness,
 * personality and a hidden ceiling drawn from a calibrated per-nation talent
 * curve. They PLAY (the world quick-sim already runs these leagues), develop
 * through the existing development model, and reach the draft at 18 — so every
 * future class is real, scouted and varied.
 *
 * Calibration (docs/LIVING-WORLD-RENEWAL.md): the nation talent multipliers are
 * tuned so the top-224 of a cohort matches the real NHL draft mix — 2023–25
 * drafts: Canada 38.6%, USA 20.8%, Sweden 11.4%, Russia 10.1%, Finland 6.1%,
 * Czechia 4.6%, Slovakia 1.8%, Belarus 1.5%, Germany/Switzerland ~1.0% each
 * (Wikipedia "Draftees based on nationality", 2023/2024/2025 NHL entry drafts).
 * The ceiling quantile table matches the imported (real) 2026 class: top pick
 * ~92, 10th ~75, 32nd ~65, class median ~50.
 *
 * Pure given its inputs + Rng. Creates players; mutates team rosters.
 */
import type { Competition, Player, PlayerId, Position, Team, TeamId } from '@domain'
import type { PlayerRole } from '@domain'
import { synthesiseAttributes } from '@data/modSchema'
import { generateNationName } from '@data/nationNames'
import { computeComposites } from '@engine/ratings/composites'
import { canonicalLeagueKey } from '@engine/league/leagueStrength'
import type { Rng } from '@engine/shared/rng'

/* ───────────────────────── league youth profiles ───────────────────────── */

export type YouthLeagueKind = 'junior' | 'college'

export interface LeagueYouthProfile {
  kind: YouthLeagueKind
  /** Oldest age allowed to play here (after the summer birthday). */
  ageLimit: number
  /** Roster the intake refills toward. */
  target: number
  /** Intake ages, weighted. Empty = no newgen intake (college recruits instead). */
  intakeAges: ReadonlyArray<readonly [number, number]>
  /** Nation pool mix for newgens, weighted (pool keys from nationNames). */
  mix: ReadonlyArray<readonly [string, number]>
  /** Share of the mix that is an import (drawn from IMPORT_MIX). */
  importShare: number
}

/** Where a league's imports come from (weighted by real import pipelines). */
const IMPORT_MIX: ReadonlyArray<readonly [string, number]> = [
  ['Czechia', 20], ['Slovakia', 16], ['Russia', 10], ['Sweden', 9], ['Finland', 7], ['Germany', 8],
  ['Latvia', 9], ['Switzerland', 5], ['Norway', 5], ['Denmark', 5], ['Austria', 3], ['Belarus', 3],
]

const CHL_MIX = [['Canada', 82], ['United States', 18]] as const
const P = (
  kind: YouthLeagueKind, ageLimit: number, target: number,
  intakeAges: ReadonlyArray<readonly [number, number]>, mix: ReadonlyArray<readonly [string, number]>, importShare: number,
): LeagueYouthProfile => ({ kind, ageLimit, target, intakeAges, mix, importShare })

/**
 * Per-league youth profile, keyed by canonical league key. Age limits follow the
 * real leagues (CHL: 20-year-old overagers allowed, out at 21; USHL/NAHL/BCHL
 * junior A through 20; NTDP is U17/U18; European U20 loops through 20; NCAA
 * players graduate by 24). Nation mixes are the source DB's own league mixes.
 */
export const LEAGUE_YOUTH: Readonly<Record<string, LeagueYouthProfile>> = {
  OHL: P('junior', 20, 24, [[16, 8], [17, 2]], CHL_MIX, 0.08),
  WHL: P('junior', 20, 24, [[16, 8], [17, 2]], [['Canada', 85], ['United States', 15]], 0.07),
  QMJHL: P('junior', 20, 24, [[16, 8], [17, 2]], [['Canada-QC', 72], ['Canada', 22], ['United States', 6]], 0.08),
  USHL: P('junior', 20, 24, [[16, 3], [17, 6]], [['United States', 88], ['Canada', 12]], 0.07),
  NTDP: P('junior', 17, 24, [[16, 1]], [['United States', 1]], 0),
  NAHL: P('junior', 20, 24, [[17, 5], [18, 3]], [['United States', 90], ['Canada', 10]], 0.05),
  BCHL: P('junior', 20, 24, [[16, 3], [17, 5]], [['Canada', 70], ['United States', 30]], 0.04),
  MHL: P('junior', 20, 25, [[17, 7], [16, 3]], [['Russia', 91], ['Belarus', 5], ['Kazakhstan', 4]], 0.01),
  J20: P('junior', 20, 24, [[16, 5], [17, 5]], [['Sweden', 93], ['Norway', 4], ['Denmark', 3]], 0.02),
  U20SM: P('junior', 20, 24, [[16, 5], [17, 5]], [['Finland', 1]], 0.04),
  CZEJR: P('junior', 20, 24, [[16, 5], [17, 5]], [['Czechia', 94], ['Slovakia', 6]], 0.02),
  SVKJR: P('junior', 20, 24, [[16, 5], [17, 5]], [['Slovakia', 1]], 0.03),
  DNL: P('junior', 20, 24, [[16, 6], [17, 4]], [['Germany', 88], ['Austria', 7], ['Switzerland', 5]], 0.03),
  NCAA: P('college', 23, 26, [], [], 0),
}

/** The youth profile for a competition, or undefined (a senior league). */
export function youthProfileOf(comp: Pick<Competition, 'abbrev' | 'name'>): LeagueYouthProfile | undefined {
  return LEAGUE_YOUTH[canonicalLeagueKey(comp.abbrev, comp.name)]
}

/* ───────────────────────── nation talent ───────────────────────── */

/**
 * How deep a nation's elite tail runs, relative to the average cohort (1.0).
 * Multiplies the chance a kid lands in any given top fraction of the ceiling
 * curve. Calibrated so the top of a world cohort reproduces the real draft
 * mix (see file header) given each nation's junior capacity in the world.
 */
export const NATION_TALENT: Readonly<Record<string, number>> = {
  'Canada': 1.85, 'Canada-QC': 1.55, 'United States': 1.05, 'Sweden': 1.9, 'Finland': 1.2,
  'Russia': 0.35, 'Czechia': 0.75, 'Slovakia': 0.3, 'Germany': 0.25, 'Switzerland': 0.9,
  'Latvia': 0.55, 'Norway': 0.5, 'Denmark': 0.45, 'Austria': 0.4, 'Belarus': 0.6,
  'Kazakhstan': 0.3, 'Slovenia': 0.35,
}

/**
 * Ceiling (potential overall, computed-composite scale) by top fraction of a
 * world birth-cohort (~1,000 kids). Anchored to the real imported 2026 class.
 */
const PA_QUANTILES: ReadonlyArray<readonly [number, number]> = [
  [0, 97], [0.001, 91], [0.004, 82], [0.01, 74], [0.03, 64], [0.06, 58], [0.1, 54],
  [0.2, 50], [0.35, 46], [0.5, 43], [0.75, 39], [0.9, 36], [1, 31],
]

/** Interpolated ceiling for a top fraction in [0,1]. */
export function ceilingAtFraction(f: number): number {
  const x = Math.max(0, Math.min(1, f))
  for (let i = 1; i < PA_QUANTILES.length; i++) {
    const [f1, v1] = PA_QUANTILES[i]!
    if (x <= f1) {
      const [f0, v0] = PA_QUANTILES[i - 1]!
      const t = (x - f0) / Math.max(1e-9, f1 - f0)
      return v0 + (v1 - v0) * t
    }
  }
  return PA_QUANTILES[PA_QUANTILES.length - 1]![1]
}

/** Roll a newgen's ceiling for a nation (talent multiplies elite odds). */
export function rollCeiling(rng: Rng, poolKey: string): number {
  const talent = NATION_TALENT[poolKey] ?? 0.4
  const f = rng.next() / talent
  return Math.round(ceilingAtFraction(f))
}

/* ───────────────────────── physical / style by nation ───────────────────────── */

const HEIGHT_ADJ: Readonly<Record<string, number>> = {
  'Sweden': 1.2, 'Finland': 0.8, 'Czechia': 1, 'Slovakia': 0.8, 'Latvia': 1.5, 'Switzerland': -1,
  'Canada-QC': -0.5, 'Russia': 0, 'Germany': 0.5,
}
const LEFT_SHARE: Readonly<Record<string, number>> = {
  'Canada': 0.64, 'Canada-QC': 0.66, 'United States': 0.58, 'Sweden': 0.72, 'Finland': 0.74,
  'Russia': 0.76, 'Czechia': 0.72, 'Slovakia': 0.72, 'Germany': 0.66, 'Switzerland': 0.68,
}

const FORWARD_ROLES: PlayerRole[] = ['sniper', 'playmaker', 'twoWay', 'powerForward', 'enforcer']
const FORWARD_ROLE_WEIGHTS = [3, 3, 3, 2, 0.6]
const DEFENSE_ROLES: PlayerRole[] = ['offensiveD', 'shutdownD', 'stayAtHomeD']

function weighted<T>(rng: Rng, items: ReadonlyArray<readonly [T, number]>): T {
  let total = 0
  for (const [, w] of items) total += w
  let r = rng.next() * total
  for (const [v, w] of items) {
    r -= w
    if (r < 0) return v
  }
  return items[items.length - 1]![0]
}

function rollPosition(rng: Rng): Position {
  return weighted<Position>(rng, [['C', 25], ['W', 31], ['D', 32], ['G', 12]])
}

/* ───────────────────────── one newgen ───────────────────────── */

export interface NewgenArgs {
  rng: Rng
  id: PlayerId
  /** Season year he joins (his first junior season). */
  year: number
  age: number
  poolKey: string
  /** League he joins (drives junior preference + his amateur deal length). */
  profile: LeagueYouthProfile
  leagueKey: string
  /** Names already used this intake (no identical twins). */
  taken?: Set<string>
  /** Force a position (keeps a club's goalie pipeline alive). */
  position?: Position
}

/** A fully formed 16–17-year-old: name, hometown, body, style, ceiling. */
export function makeNewgen(a: NewgenArgs): Player {
  const { rng } = a
  const bio = generateNationName(rng, a.poolKey, a.taken)
  const rolled = rollPosition(rng)
  const position = a.position ?? rolled
  const ceiling = rollCeiling(rng, a.poolKey)
  // Current ability tracks the ceiling loosely at 16 (EHM CA scale ~26–40): the
  // best kids are already better, but plenty of late bloomers hide in the pack.
  const caliber = Math.max(18, Math.min(46, Math.round(19 + 0.2 * ceiling + rng.normal(0, 3.2) + (a.age - 16) * 2.5)))
  const ratings = synthesiseAttributes(rng, caliber, position, {})
  const potential = synthesiseAttributes(rng, Math.max(ceiling, caliber + 2), position, {})
  const role: PlayerRole =
    position === 'G' ? 'starter'
      : position === 'D' ? rng.pick(DEFENSE_ROLES)
        : weighted(rng, FORWARD_ROLES.map((r, i) => [r, FORWARD_ROLE_WEIGHTS[i]!] as const))
  const posAdj = position === 'G' ? 2.5 : position === 'D' ? 1.5 : 0
  const heightCm = Math.round(rng.normal(182.5 + (HEIGHT_ADJ[a.poolKey] ?? 0) + posAdj, 5.8))
  const weightKg = Math.round(0.86 * (heightCm - 100) + rng.normal(4, 5))
  const left = LEFT_SHARE[a.poolKey] ?? 0.66
  const years = Math.max(1, a.profile.ageLimit - a.age + 1)
  const t = (): number => rng.range(1, 20)
  const personality = { ambition: t(), professionalism: t(), loyalty: t(), temperament: t(), determination: t() }
  const na = a.poolKey === 'Canada' || a.poolKey === 'Canada-QC' || a.poolKey === 'United States'
  const juniorPreference =
    a.leagueKey === 'OHL' || a.leagueKey === 'WHL' || a.leagueKey === 'QMJHL' ? 'Major Junior'
      : na ? 'College' : 'Europe'
  const player: Player = {
    id: a.id,
    name: bio.name,
    age: a.age,
    position,
    handedness: rng.chance(left) ? 'L' : 'R',
    role,
    ratings,
    potential,
    composites: computeComposites(ratings, role, position),
    personality,
    contract: { salary: 0, yearsRemaining: years, expiryYear: a.year + years, noTradeClause: false, twoWay: false },
    stats: [],
    fatigue: 0,
    morale: rng.range(55, 80),
    injuryStatus: null,
    form: 0,
    externalId: `gen-${a.year}-${a.id as string}`,
    nationality: bio.nationality,
    birthplace: bio.birthplace,
    heightCm,
    weightKg,
    consistency: rng.range(4, 18),
    nhlDraftEligible: true,
    nhlDrafted: false,
    juniorPreference,
  }
  return player
}

/* ───────────────────────── the annual intake ───────────────────────── */

export interface IntakeResult {
  created: Player[]
  /** competitionId → newgens added. */
  byCompetition: Map<string, number>
}

/**
 * Refill every junior club toward its target with a new cohort. Each club takes
 * between 2 and 8 kids (a club that lost a big graduating class takes more).
 * Deterministic in `rng` and the input order.
 */
export function runYouthIntake(args: {
  competitions: Competition[]
  teams: Map<TeamId, Team>
  players: Map<PlayerId, Player>
  year: number
  rng: Rng
  nextId: () => PlayerId
  /** Career start: the imported world has almost no 16–17-year-olds, so the
   *  first intake seeds both cohorts at once (an even 16/17 split). */
  bootstrap?: boolean
}): IntakeResult {
  const { rng } = args
  const created: Player[] = []
  const byCompetition = new Map<string, number>()
  const taken = new Set<string>()
  for (const comp of args.competitions) {
    if (comp.tier !== 'simulated') continue
    const prof = youthProfileOf(comp)
    if (!prof || prof.kind !== 'junior' || prof.intakeAges.length === 0) continue
    const leagueKey = canonicalLeagueKey(comp.abbrev, comp.name)
    let added = 0
    for (const tid of comp.teamIds) {
      const team = args.teams.get(tid)
      if (!team) continue
      const n = args.bootstrap
        ? Math.max(4, Math.min(10, prof.target + 2 - team.roster.length))
        : Math.max(2, Math.min(8, prof.target - team.roster.length))
      // Keep the goalie pipeline alive: a club with <3 goalies takes one.
      let goalies = 0
      for (const pid of team.roster) if (args.players.get(pid)?.position === 'G') goalies++
      for (let i = 0; i < n; i++) {
        const poolKey = rng.chance(prof.importShare) ? weighted(rng, IMPORT_MIX) : weighted(rng, prof.mix)
        const age = args.bootstrap ? (i % 2 === 0 ? 17 : 16) : weighted(rng, prof.intakeAges)
        const p = makeNewgen({
          rng, id: args.nextId(), year: args.year, age, poolKey, profile: prof, leagueKey, taken,
          ...(i === 0 && goalies < 3 ? { position: 'G' as const } : {}),
        })
        if (p.position === 'G') goalies++
        args.players.set(p.id, p)
        team.roster.push(p.id)
        created.push(p)
        added++
      }
    }
    byCompetition.set(comp.id, added)
  }
  return { created, byCompetition }
}
