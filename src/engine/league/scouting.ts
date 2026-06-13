/**
 * Pure scouting engine — no side-effects, no wall-clock, no unseeded RNG.
 *
 * Responsibilities:
 *   createInitialScouting  — build a fresh ScoutingState for a new career
 *   tickScouting           — advance knowledge one match day
 *   knowledgeOf            — look up knowledge for a player (0 if absent)
 *   maskAttribute          — return a deterministic lo/hi band for a hidden attribute
 *   maskedOverall          — same for overall rating
 */
import type { Player, PlayerId, Team, TeamId } from '@domain'
import type { ScoutingState, ScoutAssignment, ScoutTarget } from '@domain/scouting'
import { overall } from '@engine/ratings/composites'
import { Rng } from '@engine/shared/rng'
import { FIRST_NAMES, LAST_NAMES } from '@data/names'

/* ────────────────────────── small helpers ────────────────────────── */

/** Read knowledge for a player from the serialized entry array. */
export function knowledgeOf(state: ScoutingState, playerId: string): number {
  for (const [id, k] of state.knowledge) {
    if (id === playerId) return k
  }
  return 0
}

function setKnowledge(state: ScoutingState, playerId: string, value: number): void {
  const clamped = Math.max(0, Math.min(100, value))
  for (const entry of state.knowledge) {
    if (entry[0] === playerId) {
      entry[1] = clamped
      return
    }
  }
  state.knowledge.push([playerId, clamped])
}

/**
 * Raise (or lower) a player's knowledge by a delta, clamped 0–100. Used by
 * non-scout knowledge sources such as conducting an interview. Returns the new value.
 */
export function addKnowledge(state: ScoutingState, playerId: string, delta: number): number {
  const next = Math.max(0, Math.min(100, knowledgeOf(state, playerId) + delta))
  setKnowledge(state, playerId, next)
  return next
}

/** Deterministic 32-bit hash combining two numbers. Used for stable per-player-per-attr offsets. */
function deterministicHash(a: number, b: number): number {
  // FNV-1a inspired mixing — cheap, deterministic, no RNG needed
  let h = 2166136261
  h ^= (a & 0xff); h = (h * 16777619) >>> 0
  h ^= ((a >>> 8) & 0xff); h = (h * 16777619) >>> 0
  h ^= ((a >>> 16) & 0xff); h = (h * 16777619) >>> 0
  h ^= ((a >>> 24) & 0xff); h = (h * 16777619) >>> 0
  h ^= (b & 0xff); h = (h * 16777619) >>> 0
  h ^= ((b >>> 8) & 0xff); h = (h * 16777619) >>> 0
  h ^= ((b >>> 16) & 0xff); h = (h * 16777619) >>> 0
  h ^= ((b >>> 24) & 0xff); h = (h * 16777619) >>> 0
  return h
}

/**
 * Derive a stable numeric key from a player id string.
 * We just sum char-codes with positional multipliers — fast and consistent.
 */
function playerIdHash(playerId: string): number {
  let h = 5381
  for (let i = 0; i < playerId.length; i++) {
    h = ((h << 5) + h + playerId.charCodeAt(i)) >>> 0
  }
  return h
}

/**
 * Similarly, a stable numeric key for an attribute label string.
 */
function attrKeyHash(attrKey: string): number {
  let h = 5381
  for (let i = 0; i < attrKey.length; i++) {
    h = ((h << 5) + h + attrKey.charCodeAt(i)) >>> 0
  }
  return h
}

/* ────────────────────────── masking ────────────────────────── */

/**
 * Band width by knowledge level:
 *   k >= 95 → exact (width 0)
 *   k  = 80 → ±3  (width 6)
 *   k  = 60 → ±6  (width 12)
 *   k  = 20 → ±15 (width 30)
 *   k  =  0 → ±20 (width 40)
 *
 * Interpolated linearly between breakpoints.
 */
function bandWidth(knowledge: number): number {
  if (knowledge >= 95) return 0
  if (knowledge >= 80) return Math.round(6 * (1 - (knowledge - 80) / 15))
  if (knowledge >= 60) return Math.round(6 + 6 * ((80 - knowledge) / 20))
  if (knowledge >= 20) return Math.round(12 + 18 * ((60 - knowledge) / 40))
  return Math.round(30 + 10 * ((20 - knowledge) / 20))
}

/**
 * Return a deterministic { lo, hi } band for one attribute value.
 *
 * The band midpoint is BIASED away from the true value by a stable per-player-
 * per-attr hash offset — so the midpoint does not reveal the truth even for
 * medium knowledge. lo/hi are clamped to [1, 99].
 *
 * When knowledge >= 95 returns { lo: value, hi: value } (exact).
 */
export function maskAttribute(
  value: number,
  knowledge: number,
  playerId: string,
  attrKey: string
): { lo: number; hi: number } {
  if (knowledge >= 95) return { lo: value, hi: value }

  const width = bandWidth(knowledge)
  const half = width / 2

  // Stable bias: −half .. +half, derived from player+attr hash
  const pidH = playerIdHash(playerId)
  const akH = attrKeyHash(attrKey)
  const combined = deterministicHash(pidH, akH)
  // Map to [-half, +half] with some asymmetry (bias away from center)
  const normalised = (combined % 1000) / 1000  // 0..0.999
  const bias = (normalised - 0.5) * half * 1.4 // -0.7*half .. +0.7*half

  const mid = Math.round(value + bias)
  const lo = Math.max(1, Math.round(mid - half))
  const hi = Math.min(99, Math.round(mid + half))

  return { lo, hi }
}

/**
 * Masked overall — same logic applied to an overall rating (1-99 clamp).
 */
export function maskedOverall(
  ovr: number,
  knowledge: number,
  playerId: string
): { lo: number; hi: number } {
  return maskAttribute(ovr, knowledge, playerId, '__overall__')
}

/* ────────────────────────── initial state ────────────────────────── */

const SCOUT_NAMES = [
  ['Viktor', 'Sandstrom'],
  ['Pavel', 'Novak'],
  ['Finn', 'Murphy'],
  ['Kasper', 'Lindqvist'],
  ['Rasmus', 'Berg'],
  ['Owen', 'Doyle'],
  ['Jonas', 'Eriksson'],
]

function generateScoutName(rng: Rng, index: number): string {
  if (index < SCOUT_NAMES.length) {
    return `${SCOUT_NAMES[index]![0]} ${SCOUT_NAMES[index]![1]}`
  }
  const first = FIRST_NAMES[rng.int(0, FIRST_NAMES.length - 1)]!
  const last = LAST_NAMES[rng.int(0, LAST_NAMES.length - 1)]!
  return `${first} ${last}`
}

export interface CreateScoutingArgs {
  userTeamId: string
  teams: Map<TeamId, { roster: PlayerId[] }>
  players: Map<PlayerId, Player>
  rng: Rng
  /** league.draftClasses to identify draft prospects */
  draftProspectIds?: Set<string>
}

/**
 * Build the initial ScoutingState for a new career.
 *
 * - 3 scouts, ratings 55–75, all assigned to watch the user's division
 * - Own roster: knowledge 100
 * - Other rostered players: 25–40 (public reputation, overall-based noise)
 * - Draft prospects: 5–15
 */
export function createInitialScouting(args: CreateScoutingArgs): ScoutingState {
  const { userTeamId, teams, players, rng } = args
  const draftProspectIds = args.draftProspectIds ?? new Set<string>()

  // Build scouts — assign each to a different opponent team by default so they
  // immediately start building knowledge of rivals. If there are fewer than 3
  // opponent teams (shouldn't happen in a real league), fall back to the user team.
  const opponentTeamIds = [...teams.keys()]
    .map((id) => id as string)
    .filter((id) => id !== userTeamId)
  const assignments: ScoutAssignment[] = []
  for (let i = 0; i < 3; i++) {
    const name = generateScoutName(rng, i)
    const rating = rng.range(55, 75)
    const targetTeamId = opponentTeamIds[i % opponentTeamIds.length] ?? userTeamId
    assignments.push({
      scoutId: `scout-${i}`,
      name,
      rating,
      target: { kind: 'team', teamId: targetTeamId },
    })
  }

  // Build initial knowledge
  const knowledge: Array<[string, number]> = []

  // Collect user roster
  const userTeam = teams.get(userTeamId as TeamId)
  const userRosterSet = new Set<string>(
    userTeam ? userTeam.roster.map((id) => id as string) : []
  )

  // Overall-based public reputation for non-user players (adds believability)
  for (const [pid, player] of players) {
    const pidStr = pid as string
    if (userRosterSet.has(pidStr)) {
      knowledge.push([pidStr, 100])
    } else if (draftProspectIds.has(pidStr)) {
      knowledge.push([pidStr, rng.range(5, 15)])
    } else {
      // Public info: roughly correlated with overall so elite players are more known
      const ovr = overall(player.composites, player.position)
      const base = ovr >= 80 ? 35 : ovr >= 65 ? 28 : 20
      const noise = rng.range(-5, 5)
      knowledge.push([pidStr, Math.max(5, Math.min(45, base + noise))])
    }
  }

  return { knowledge, assignments }
}

/* ────────────────────────── tick ────────────────────────── */

export interface TickScoutingArgs {
  state: ScoutingState
  userTeamId: string
  teams: Map<TeamId, { roster: PlayerId[]; divisionId?: string }>
  players: Map<PlayerId, Player>
  /** All draft-class prospect ids across all years */
  draftProspectIds: Set<string>
  /** Current FA pool (player ids not on any roster) */
  freeAgentIds: Set<string>
  rng: Rng
}

/**
 * Advance scouting by one match day.
 *
 * Each scout's assignment determines which players gain knowledge:
 *   team      → that team's roster
 *   division  → all teams in that division
 *   draftClass→ all known draft prospects
 *   freeAgents→ all free agents
 *
 * Knowledge gain per scout per player = (rating / 25) ± noise,
 * with diminishing returns above 80 (gain halved above 80, quartered above 90).
 */
export function tickScouting(args: TickScoutingArgs): void {
  const { state, teams, players, draftProspectIds, freeAgentIds, rng } = args

  // Build lookup: teamId → divisionId
  const teamDivision = new Map<string, string>()
  for (const [tid, team] of teams) {
    if ((team as { divisionId?: string }).divisionId) {
      teamDivision.set(tid as string, (team as { divisionId: string }).divisionId)
    }
  }

  // Build lookup: divisionId → teamIds
  const divisionTeams = new Map<string, string[]>()
  for (const [tid, divId] of teamDivision) {
    const arr = divisionTeams.get(divId) ?? []
    arr.push(tid)
    divisionTeams.set(divId, arr)
  }

  // Rostered player set (for freeAgents target)
  const rosteredIds = new Set<string>()
  for (const team of teams.values()) {
    for (const id of team.roster) rosteredIds.add(id as string)
  }

  for (const scout of state.assignments) {
    // Determine target player set
    const targetIds = resolveTarget(scout.target, teams, draftProspectIds, freeAgentIds, rosteredIds)

    for (const pid of targetIds) {
      if (!players.has(pid as PlayerId)) continue
      const current = knowledgeOf(state, pid)
      if (current >= 100) continue

      const baseGain = scout.rating / 25
      const noise = (rng.range(0, 40) - 20) / 10  // -2.0 .. +2.0
      let gain = baseGain + noise

      // Diminishing returns
      if (current >= 90) gain *= 0.25
      else if (current >= 80) gain *= 0.5

      const next = Math.min(100, current + gain)
      if (next > current) setKnowledge(state, pid, next)
    }
  }
}

function resolveTarget(
  target: ScoutTarget,
  teams: Map<TeamId, { roster: PlayerId[] }>,
  draftProspectIds: Set<string>,
  freeAgentIds: Set<string>,
  rosteredIds: Set<string>
): string[] {
  switch (target.kind) {
    case 'team': {
      const team = teams.get(target.teamId as TeamId)
      return team ? team.roster.map((id) => id as string) : []
    }
    case 'division': {
      const ids: string[] = []
      for (const [tid, team] of teams) {
        const t = team as { roster: PlayerId[]; divisionId?: string }
        if (t.divisionId === target.divisionId) {
          for (const id of t.roster) ids.push(id as string)
        }
      }
      return ids
    }
    case 'draftClass':
      return [...draftProspectIds]
    case 'freeAgents':
      return [...freeAgentIds].filter((id) => !rosteredIds.has(id))
  }
}

/* ────────────────────────── assignment mutation ────────────────────────── */

/**
 * Reassign one scout to a new target. Mutates state in place.
 */
export function assignScout(
  state: ScoutingState,
  scoutId: string,
  target: ScoutTarget
): void {
  const scout = state.assignments.find((s) => s.scoutId === scoutId)
  if (!scout) throw new Error(`unknown scout ${scoutId}`)
  scout.target = target
}
