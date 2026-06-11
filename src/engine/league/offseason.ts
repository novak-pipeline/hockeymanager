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
  type Team,
  type TeamId
} from '@domain'
import { FIRST_NAMES, LAST_NAMES } from '@data'
import { computeComposites, overall } from '@engine/ratings/composites'
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
 */
function applyGrowth(ratings: RawAttributes, potential: RawAttributes, rate: number, rng: Rng): void {
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
      const r = Math.min(0.85, rate * rng.float(0.75, 1.25))
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
 * Annual development pass over every player: age +1, contract year burned,
 * attributes grown/declined per the model above, composites recomputed
 * (mandatory — they are a cache of ratings), fatigue cleared and form
 * regressed toward 0 for the new season.
 *
 * Returns seeds for league news: the biggest overall risers ('breakout') and
 * fallers ('decline'), at most five of each league-wide.
 */
export function developPlayers(args: {
  players: Map<PlayerId, Player>
  gamesPlayedById: Map<PlayerId, number> | ((id: PlayerId) => number)
  year: number
  rng: Rng
}): { newsSeeds: Array<{ playerId: PlayerId; kind: 'breakout' | 'decline' }> } {
  const { players, rng } = args
  const gamesPlayed = toGamesLookup(args.gamesPlayedById)

  const deltas: Array<{ playerId: PlayerId; delta: number }> = []
  for (const p of players.values()) {
    const before = overall(p.composites, p.position)
    const seasonAge = p.age
    p.age += 1
    p.contract.yearsRemaining = Math.max(0, p.contract.yearsRemaining - 1)

    if (seasonAge < 26) {
      const persona =
        (p.personality.ambition + p.personality.professionalism + p.personality.determination) / 3
      const personaFactor = 0.5 + (persona / 20) * 0.8
      const gamesFactor = 0.6 + 0.4 * Math.min(1, gamesPlayed(p.id) / 60)
      const baseRate = 0.12 + 0.03 * (26 - seasonAge)
      applyGrowth(p.ratings, p.potential, baseRate * personaFactor * gamesFactor, rng)
    } else if (seasonAge >= 30) {
      applyDecline(p.ratings, seasonAge, rng)
    }

    p.composites = computeComposites(p.ratings, p.role, p.position)
    p.fatigue = 0
    p.form *= 0.3
    if (Math.abs(p.form) < 0.25) p.form = 0

    deltas.push({ playerId: p.id, delta: overall(p.composites, p.position) - before })
  }

  const risers = deltas
    .filter((d) => d.delta >= 2)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5)
  const fallers = deltas
    .filter((d) => d.delta <= -2)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 5)
  return {
    newsSeeds: [
      ...risers.map((d) => ({ playerId: d.playerId, kind: 'breakout' as const })),
      ...fallers.map((d) => ({ playerId: d.playerId, kind: 'decline' as const }))
    ]
  }
}

/* ────────────────────────── retirements ────────────────────────── */

/** Base retirement probability by age 33..40; ramps to near-certain. */
const RETIREMENT_BASE = [0.03, 0.06, 0.12, 0.22, 0.35, 0.55, 0.75, 0.95]

function retirementProbability(age: number, ovr: number): number {
  const base = age > 40 ? 0.99 : RETIREMENT_BASE[age - 33]
  // Fringe players hang them up earlier; stars get a small benefit of doubt.
  const adjusted = base + Math.max(0, 60 - ovr) * 0.012 - Math.max(0, ovr - 78) * 0.006
  const floor = age > 40 ? 0.9 : 0.01
  return Math.min(0.995, Math.max(floor, adjusted))
}

/**
 * Roll retirements for everyone 33+. Retirees are removed from their team's
 * roster array but stay in the players map so history screens keep working —
 * the caller is responsible for excluding returned ids from future passes.
 * Players under contract for 2+ more years never retire before 38.
 */
export function processRetirements(args: {
  players: Map<PlayerId, Player>
  teams: Map<TeamId, Team>
  year: number
  rng: Rng
}): { retired: PlayerId[] } {
  const { players, teams, rng } = args

  const teamOf = new Map<PlayerId, Team>()
  for (const team of teams.values()) {
    for (const pid of team.roster) teamOf.set(pid, team)
  }

  const retired: PlayerId[] = []
  for (const p of players.values()) {
    if (p.age < 33) continue
    if (p.contract.yearsRemaining >= 2 && p.age < 38) continue
    if (!rng.chance(retirementProbability(p.age, overall(p.composites, p.position)))) continue
    retired.push(p.id)
    const team = teamOf.get(p.id)
    if (team) team.roster = team.roster.filter((id) => id !== p.id)
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
 * AI pick: heavily biased toward the best remaining consensus rank, with the
 * occasional reach a few spots down the board (never past ~8 spots).
 */
export function aiSelectProspect(args: { remaining: DraftProspect[]; rng: Rng }): DraftProspect {
  const { remaining, rng } = args
  const board = [...remaining].sort((a, b) => a.rank - b.rank)
  let i = 0
  while (i < board.length - 1 && i < 7 && rng.chance(0.42)) i++
  return board[i]
}
