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
import type { Player, PlayerId, TeamId } from '@domain'
import type { ScoutingState, ScoutAssignment, ScoutTarget, ScoutFocus } from '@domain/scouting'
import { ratedOverall } from '@engine/ratings/composites'
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

/** Best judgment (0–100) of any scout who has watched a player; 0 if none. */
export function judgmentOf(state: ScoutingState, playerId: string): number {
  if (!state.judgment) return 0
  for (const [id, j] of state.judgment) if (id === playerId) return j
  return 0
}

function recordJudgment(state: ScoutingState, playerId: string, j: number): void {
  if (!state.judgment) state.judgment = []
  for (const entry of state.judgment) {
    if (entry[0] === playerId) { if (j > entry[1]) entry[1] = j; return }
  }
  state.judgment.push([playerId, j])
}

/** Read accuracy 0–1 for masking: blends the best scout's judgment with a neutral
 *  floor (players you haven't actively scouted read at ~neutral quality). */
export function accuracyOf(state: ScoutingState, playerId: string): number {
  const j = judgmentOf(state, playerId)
  if (j <= 0) return 0.5
  return Math.max(0, Math.min(1, j / 100))
}

/** The scout ids who have personally watched a player (from per-scout history). */
export function scoutsWhoSaw(state: ScoutingState, playerId: string): string[] {
  const out: string[] = []
  for (const [sid, pids] of state.scoutHistory ?? []) {
    if (pids.includes(playerId)) out.push(sid)
  }
  return out
}

/** Every player id a given scout has personally watched. */
export function playersSeenByScout(state: ScoutingState, scoutId: string): string[] {
  for (const [sid, pids] of state.scoutHistory ?? []) {
    if (sid === scoutId) return pids
  }
  return []
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
  attrKey: string,
  /** 0–1 read quality from the scout who watched him (judgment). 0.5 = neutral.
   *  A sharp scout (→1) tightens the band and shrinks the bias; a poor one (→0)
   *  widens it — so WHO scouts a player matters, not just how much. */
  accuracy = 0.5
): { lo: number; hi: number } {
  if (knowledge >= 95) return { lo: value, hi: value }

  // Better judgment narrows the band (0.7×) ; weaker judgment widens it (1.3×).
  const widthFactor = 1.3 - 0.6 * Math.max(0, Math.min(1, accuracy))
  const width = bandWidth(knowledge) * widthFactor
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
  playerId: string,
  accuracy = 0.5
): { lo: number; hi: number } {
  return maskAttribute(ovr, knowledge, playerId, '__overall__', accuracy)
}

/**
 * Masked CEILING (potential) — same fog model on a SEPARATE '__potential__'
 * channel, so a scout's read of a prospect's ceiling can be off in a different
 * direction (and by a different amount) than his read of current ability. This
 * is what stops the profile from leaking a prospect's true potential before he's
 * been scouted: an unseen kid's ceiling shows as a wide, biased band that sharpens
 * (and de-biases) as your scouts log viewings. Exact at knowledge >= 95.
 */
export function maskedCeiling(
  ceiling: number,
  knowledge: number,
  playerId: string,
  accuracy = 0.5
): { lo: number; hi: number } {
  return maskAttribute(ceiling, knowledge, playerId, '__potential__', accuracy)
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
  const first = FIRST_NAMES[rng.int(FIRST_NAMES.length)]!
  const last = LAST_NAMES[rng.int(LAST_NAMES.length)]!
  return `${first} ${last}`
}

/** Nations a scout can specialise in (a small knowledge bonus there). */
export const SCOUT_SPECIALTY_NATIONS = ['Canada', 'USA', 'Sweden', 'Finland', 'Russia', 'Czechia'] as const

/** Annual salary for a scout of the given quality (rounded to the nearest 1k). */
export function scoutSalary(rating: number): number {
  return Math.round((140_000 + Math.max(0, rating - 45) * 12_000) / 1000) * 1000
}

/** Roll a scout's hidden attributes deterministically from the rng. */
function scoutAttributes(rng: Rng): { rating: number; judgment: number; specialtyNation?: string } {
  const rating = Math.max(45, Math.min(92, Math.round(rng.normal(64, 12))))
  const judgment = Math.max(45, Math.min(95, Math.round(rng.normal(68, 12))))
  // ~60% of scouts have a national specialty.
  const spec = rng.range(0, 9) < 6 ? SCOUT_SPECIALTY_NATIONS[rng.int(SCOUT_SPECIALTY_NATIONS.length)] : undefined
  return spec ? { rating, judgment, specialtyNation: spec } : { rating, judgment }
}

export interface ScoutCandidate {
  id: string
  name: string
  rating: number
  judgment: number
  specialtyNation?: string
  salary: number
}

/**
 * The scout job market — a stable, deterministically-generated pool of hireable
 * scouts (regenerated from the same seed each call, like the analyst market).
 * The caller filters out anyone already on staff by id.
 */
export function generateScoutCandidates(rng: Rng, count = 6): ScoutCandidate[] {
  const out: ScoutCandidate[] = []
  for (let i = 0; i < count; i++) {
    const a = scoutAttributes(rng)
    out.push({
      id: `scout-mkt-${i}`,
      name: generateScoutName(rng, i + 16),
      rating: a.rating,
      judgment: a.judgment,
      ...(a.specialtyNation ? { specialtyNation: a.specialtyNation } : {}),
      salary: scoutSalary(a.rating),
    })
  }
  return out.sort((x, y) => y.rating - x.rating)
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
 * A player's "renown" (0–200): how widely known he is. Blends his reputation
 * (from the source DB) with his ability, so an inflated DB reputation can't make
 * a fringe player famous, and a quietly excellent player still registers. When
 * no DB reputation is present we fall back to ability alone.
 */
export function renownOf(player: Player): number {
  const ovr = ratedOverall(player)
  // Map overall 40→70, 99→~200 so ability contributes on the same 0–200 scale.
  const ovrRenown = 70 + (Math.max(40, Math.min(99, ovr)) - 40) * (130 / 59)
  const rep = (player as { currentReputation?: number }).currentReputation ?? 0
  return rep > 0 ? rep * 0.6 + ovrRenown * 0.4 : ovrRenown
}

/**
 * Initial scouting knowledge for a non-roster, non-prospect player, derived from
 * his renown. Established stars are essentially fully known; depth NHLers are
 * mostly known; AHL/fringe players stay foggier — the "gems" left to uncover.
 */
function renownKnowledge(renown: number, rng: Rng): number {
  let base: number
  if (renown >= 174) base = 92
  else if (renown >= 160) base = 84
  else if (renown >= 148) base = 74
  else if (renown >= 136) base = 64
  else if (renown >= 124) base = 54
  else if (renown >= 110) base = 45
  else base = 36
  return Math.max(20, Math.min(95, base + rng.range(-4, 4)))
}

/** The knowledge floor a player's REPUTATION alone sustains — you never forget a
 *  star entirely, but a prospect you stop watching fades toward obscurity.
 *  Deterministic (no rng); knowledge decays toward this, never below it. */
export function renownFloor(player: Player): number {
  const renown = renownOf(player)
  let base: number
  if (renown >= 174) base = 90
  else if (renown >= 160) base = 80
  else if (renown >= 148) base = 70
  else if (renown >= 136) base = 58
  else if (renown >= 124) base = 46
  else if (renown >= 110) base = 34
  else base = 22
  return base
}

/** How fast an unwatched player's knowledge fades toward his renown floor (per day). */
export const KNOWLEDGE_DECAY_PER_DAY = 0.07

/**
 * Build the initial ScoutingState for a new career.
 *
 * - 3 scouts, ratings 55–75, all assigned to watch the user's division
 * - Own roster: knowledge 100 (we know our own players well)
 * - Other rostered players: renown-driven (stars ~known, depth mostly known,
 *   AHL/fringe foggier)
 * - Draft prospects: 5–18 (this is where the fog and discovery live)
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
  void opponentTeamIds
  // Default deployment leans on youth discovery (the bulk of scouting). Advance-
  // scouting the next opponent (which files a pre-match inbox report) is opt-in —
  // the user re-aims a scout to Next Opponent from the Scouting screen.
  const defaults: Array<{ target: ScoutTarget; focus: ScoutFocus }> = [
    { target: { kind: 'draftClass' }, focus: 'youth' },
    { target: { kind: 'draftClass' }, focus: 'youth' },
    { target: { kind: 'draftClass' }, focus: 'youth' },
  ]
  const assignments: ScoutAssignment[] = defaults.map((d, i) => {
    const cand = scoutAttributes(rng)
    return {
      scoutId: `scout-${i}`,
      name: generateScoutName(rng, i),
      rating: cand.rating,
      judgment: cand.judgment,
      ...(cand.specialtyNation ? { specialtyNation: cand.specialtyNation } : {}),
      salary: scoutSalary(cand.rating),
      target: d.target,
      focus: d.focus,
    }
  })

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
      // Draft-eligible prospects are where the fog (and the discovery) lives.
      knowledge.push([pidStr, rng.range(5, 18)])
    } else {
      // Everyone else: known in proportion to renown (reputation + ability).
      knowledge.push([pidStr, renownKnowledge(renownOf(player), rng)])
    }
  }

  // Players already well-known at the start are not "discoveries" — seed them as
  // already-processed so the Scouting Centre begins EMPTY and only fills as scouts
  // raise foggy prospects past the discovery threshold during play.
  const seen = knowledge.filter(([, k]) => k >= DISCOVERY_THRESHOLD).map(([id]) => id)

  return { knowledge, assignments, recommendations: [], seen }
}

/** Knowledge a scout needs before he'll surface a player as a recommendation. */
export const DISCOVERY_THRESHOLD = 55

/* ────────────────────────── tick ────────────────────────── */

/** A league/competition as the scouting engine sees it (incl. synthetic NHL/AHL). */
export interface ScoutingCompetition {
  id: string
  nation: string
  teamIds: string[]
}

export interface TickScoutingArgs {
  state: ScoutingState
  userTeamId: string
  teams: Map<TeamId, { roster: PlayerId[]; divisionId?: string }>
  players: Map<PlayerId, Player>
  /** All draft-class prospect ids across all years */
  draftProspectIds: Set<string>
  /** Current FA pool (player ids not on any roster) */
  freeAgentIds: Set<string>
  /** Leagues for `competition` / `nation` scopes (synthetic 'nhl'/'ahl' included). */
  competitions?: ScoutingCompetition[]
  /** The user's next-opponent team id, for the `nextOpponent` scope. */
  nextOpponentId?: string | null
  /** Players never subject to knowledge decay (your own org — you always know them). */
  protectedIds?: Set<string>
  rng: Rng
}

/** 'youth' focus = U23 (≤23). A scout's focus narrows his target set. The single
 *  source of truth for the youth age boundary across scouting code. */
export const YOUTH_MAX_AGE = 23

/** How many players a scout can watch closely before he's spread thin. Inside
 *  this many, reads run at full speed; beyond it, per-player progress dilutes. */
export const SCOUT_CAPACITY = 60
/** Floor on the dilution factor, so even a continent-wide brief makes slow headway. */
export const SCOUT_DILUTION_FLOOR = 0.25
/** How many independent scout opinions a single prospect is worth chasing. Once
 *  this many of your scouts have filed a read, extra looks add little — spread the
 *  bandwidth to less-seen players instead. */
export const SCOUT_MAX_OPINIONS = 3

/** Qualitative read speed for a scope of the given size — for the UI. */
export function scoutReadSpeed(scopeSize: number): 'Fast' | 'Steady' | 'Thin' {
  if (scopeSize <= SCOUT_CAPACITY) return 'Fast'
  if (scopeSize <= SCOUT_CAPACITY * 3) return 'Steady'
  return 'Thin'
}
function passesFocus(player: Player, focus: ScoutFocus | undefined): boolean {
  if (!focus || focus === 'all') return true
  const youth = player.age <= YOUTH_MAX_AGE
  return focus === 'youth' ? youth : !youth
}

/** Does a player match a scout's position brief ('any'/'F'/'D'/'G'). */
export function passesPosition(player: Player, filter: 'any' | 'F' | 'D' | 'G' | undefined): boolean {
  if (!filter || filter === 'any') return true
  const pos = player.position as string
  const isG = pos === 'G'
  const isD = pos === 'D' || pos === 'LD' || pos === 'RD'
  if (filter === 'G') return isG
  if (filter === 'D') return isD
  return !isG && !isD // 'F'
}

/**
 * Advance scouting by one match day. Each scout's SCOPE (target) resolves to a
 * candidate set; his FOCUS (youth / senior / all) filters it; knowledge then
 * accrues at (rating / 25) ± noise, with diminishing returns above 80, and a
 * small bonus on players from his specialty nation.
 */
export function tickScouting(args: TickScoutingArgs): void {
  const { state, teams, players, draftProspectIds, freeAgentIds, rng } = args
  const competitions = args.competitions ?? []
  const nextOpponentId = args.nextOpponentId ?? null
  const protectedIds = args.protectedIds ?? new Set<string>()
  const watchedToday = new Set<string>()

  // Rostered player set (for freeAgents target)
  const rosteredIds = new Set<string>()
  for (const team of teams.values()) {
    for (const id of team.roster) rosteredIds.add(id as string)
  }

  // Divide-the-work: scouts on an IDENTICAL brief (same scope + focus + position)
  // split the player pool between them instead of all re-scouting the same names.
  // Five scouts on the draft class therefore cover ~5× the prospects (each takes a
  // disjoint stride), not the same forty. Scouts with distinct briefs are alone in
  // their group and keep the full pool.
  const briefKey = (a: ScoutAssignment): string =>
    `${a.target.kind}|${targetKeyOf(a.target)}|${a.focus ?? 'all'}|${a.positionFilter ?? 'any'}`
  const briefGroups = new Map<string, ScoutAssignment[]>()
  for (const a of state.assignments) {
    const k = briefKey(a)
    const arr = briefGroups.get(k)
    if (arr) arr.push(a)
    else briefGroups.set(k, [a])
  }

  // Per-scout history: every player each scout has personally watched. Built into
  // a Map of Sets for O(1) adds during the tick, then written back to the state's
  // entry-array form. Drives "only scouts who saw him have an opinion" + the
  // per-scout scouted list (vs the team-wide knowledge aggregate).
  const history = new Map<string, Set<string>>()
  for (const [sid, pids] of state.scoutHistory ?? []) history.set(sid, new Set(pids))
  const recordSeen = (scoutId: string, pid: string): void => {
    let set = history.get(scoutId)
    if (!set) { set = new Set(); history.set(scoutId, set) }
    set.add(pid)
  }

  // O(1) lookups for the working-set ordering (avoids O(n) scans per player):
  //  - knowAt: a snapshot of current knowledge (staleness within a day is fine).
  //  - opinions: how many scouts have ALREADY watched a player — so a scout who's
  //    finished his own slice gravitates to the players the FEWEST scouts have
  //    seen, building diverse second/third opinions instead of idling.
  const kIndex = new Map<string, number>()
  for (const [pid, k] of state.knowledge) kIndex.set(pid, k)
  const knowAt = (pid: string): number => kIndex.get(pid) ?? 0
  const seenCount = new Map<string, number>()
  for (const set of history.values()) for (const pid of set) seenCount.set(pid, (seenCount.get(pid) ?? 0) + 1)
  const opinions = (pid: string): number => seenCount.get(pid) ?? 0

  for (const scout of state.assignments) {
    const targetIds = resolveTarget(
      scout.target, teams, draftProspectIds, freeAgentIds, rosteredIds, competitions, nextOpponentId
    )
    // Bandwidth: a scout has finite attention. A narrow brief (one player, a team,
    // the next opponent) gets watched closely; cover a whole nation/league and he's
    // spread thin — per-player progress dilutes. This is what makes a tight
    // assignment a real choice vs "just scout the biggest region".
    const matched = targetIds.filter((pid) => {
      const pl = players.get(pid as PlayerId)
      return !!pl && passesFocus(pl, scout.focus) && passesPosition(pl, scout.positionFilter)
    })
    // Working set = his STRIDE first (his slice of a shared brief), then — once his
    // slice is saturated — SPILL OVER to other in-scope players to add a SECOND
    // OPINION, preferring the ones the fewest scouts have seen. So scouts divide the
    // pool while it's fresh, then converge so a prospect ends up assessed by several
    // independent scouts instead of each scout idling on a maxed slice.
    //  - A stride player is dropped only once team knowledge is maxed AND this scout
    //    has already filed his own read on him (nothing left for HIM to add).
    //  - An out-of-slice player is eligible for a second look if THIS scout hasn't
    //    seen him and he's under the opinion cap (a 4th scout on the same kid adds
    //    little — spread the looks around instead).
    const group = briefGroups.get(briefKey(scout))!
    const gSize = group.length
    const gIdx = gSize > 1 ? group.indexOf(scout) : 0
    const isMine = (i: number): boolean => gSize <= 1 || i % gSize === gIdx
    const myHistory = history.get(scout.scoutId)
    const iHaveSeen = (pid: string): boolean => myHistory?.has(pid) ?? false
    const mine: string[] = []
    const overflow: string[] = []
    matched.forEach((pid, i) => {
      const learnable = knowAt(pid) < 100
      if (isMine(i)) {
        if (learnable || !iHaveSeen(pid)) mine.push(pid)
      } else if (!iHaveSeen(pid) && opinions(pid) < SCOUT_MAX_OPINIONS) {
        overflow.push(pid)
      }
    })
    overflow.sort((a, b) => opinions(a) - opinions(b) || knowAt(a) - knowAt(b))
    const inScope = [...mine, ...overflow].slice(0, SCOUT_CAPACITY)
    for (const pid of inScope) watchedToday.add(pid)
    // Bandwidth dilutes per-player gain by his RESPONSIBILITY LOAD (the size of his
    // slice of the brief), not the capped daily working set — so a tight brief (one
    // player, a team) reads fast, while a scout responsible for a whole nation /
    // draft class is spread thin and reads each player slower.
    const strideCount = gSize <= 1 ? matched.length : Math.ceil(matched.length / gSize)
    const dilution = Math.max(SCOUT_DILUTION_FLOOR, Math.min(1, SCOUT_CAPACITY / Math.max(1, strideCount)))

    for (const pid of inScope) {
      const player = players.get(pid as PlayerId)!
      const current = knowledgeOf(state, pid)

      if (current >= 100) {
        // Team knowledge is maxed, but if THIS scout hasn't filed a read yet, his
        // look is a genuine second opinion — record it (and let a sharper scout's
        // judgment tighten the read) without further raising knowledge.
        if (!iHaveSeen(pid)) {
          recordJudgment(state, pid, scout.judgment ?? scout.rating)
          recordSeen(scout.scoutId, pid)
        }
        continue
      }

      const baseGain = scout.rating / 25
      const noise = (rng.range(0, 40) - 20) / 10  // -2.0 .. +2.0
      let gain = (baseGain + noise) * dilution
      // Knows his home market: faster reads on players from his specialty nation.
      if (scout.specialtyNation && player.nationality === scout.specialtyNation) gain *= 1.2

      // Diminishing returns
      if (current >= 90) gain *= 0.25
      else if (current >= 80) gain *= 0.5

      const next = Math.min(100, current + gain)
      if (next > current) {
        setKnowledge(state, pid, next)
        // Record the best judgment that has watched him — drives read accuracy.
        recordJudgment(state, pid, scout.judgment ?? scout.rating)
        // Log that THIS scout personally watched THIS player.
        recordSeen(scout.scoutId, pid)
      }
    }
  }

  // Write the per-scout history back to the serializable state.
  state.scoutHistory = [...history].map(([sid, set]) => [sid, [...set]])

  // ── Knowledge decay ──────────────────────────────────────────────────────
  // A read goes stale when no scout is watching: players not watched today (and
  // not on your own org) drift back toward what their reputation alone sustains.
  // This makes scouting an ongoing job, not one-and-done. Mutate entries in place
  // (the array IS the store) to avoid O(n) setKnowledge scans per player.
  for (const entry of state.knowledge) {
    const pid = entry[0]
    if (watchedToday.has(pid) || protectedIds.has(pid)) continue
    const player = players.get(pid as PlayerId)
    if (!player) continue
    const floor = renownFloor(player)
    if (entry[1] > floor) entry[1] = Math.max(floor, entry[1] - KNOWLEDGE_DECAY_PER_DAY)
  }
}

/** Stable key for the id-bearing part of a scope, so two scouts on the same
 *  brief group together for divide-the-work partitioning. */
function targetKeyOf(t: ScoutTarget): string {
  switch (t.kind) {
    case 'team': return t.teamId
    case 'division': return t.divisionId
    case 'competition': return t.competitionId
    case 'nation': return t.nation
    case 'player': return t.playerId
    default: return '' // nextOpponent / draftClass / freeAgents — keyed by kind alone
  }
}

function resolveTarget(
  target: ScoutTarget,
  teams: Map<TeamId, { roster: PlayerId[] }>,
  draftProspectIds: Set<string>,
  freeAgentIds: Set<string>,
  rosteredIds: Set<string>,
  competitions: ScoutingCompetition[],
  nextOpponentId: string | null
): string[] {
  const rostersOf = (teamIds: Iterable<string>): string[] => {
    const ids: string[] = []
    for (const tid of teamIds) {
      const team = teams.get(tid as TeamId)
      if (team) for (const id of team.roster) ids.push(id as string)
    }
    return ids
  }
  switch (target.kind) {
    case 'team': {
      const team = teams.get(target.teamId as TeamId)
      return team ? team.roster.map((id) => id as string) : []
    }
    case 'division': {
      const ids: string[] = []
      for (const [, team] of teams) {
        const t = team as { roster: PlayerId[]; divisionId?: string }
        if (t.divisionId === target.divisionId) {
          for (const id of t.roster) ids.push(id as string)
        }
      }
      return ids
    }
    case 'competition': {
      const comp = competitions.find((c) => c.id === target.competitionId)
      return comp ? rostersOf(comp.teamIds) : []
    }
    case 'nation': {
      const teamIds = new Set<string>()
      for (const c of competitions) if (c.nation === target.nation) for (const t of c.teamIds) teamIds.add(t)
      return rostersOf(teamIds)
    }
    case 'player':
      return [target.playerId]
    case 'nextOpponent':
      return nextOpponentId ? rostersOf([nextOpponentId]) : []
    case 'draftClass':
      return [...draftProspectIds]
    case 'freeAgents':
      return [...freeAgentIds].filter((id) => !rosteredIds.has(id))
  }
}

/* ────────────────────────── assignment mutation ────────────────────────── */

/**
 * Reassign one scout to a new scope (and optionally focus). Mutates in place.
 */
export function assignScout(
  state: ScoutingState,
  scoutId: string,
  target: ScoutTarget,
  focus?: ScoutFocus,
  opts?: { positionFilter?: 'any' | 'F' | 'D' | 'G'; minPotentialStars?: number }
): void {
  const scout = state.assignments.find((s) => s.scoutId === scoutId)
  if (!scout) throw new Error(`unknown scout ${scoutId}`)
  scout.target = target
  if (focus !== undefined) scout.focus = focus
  if (opts?.positionFilter !== undefined) scout.positionFilter = opts.positionFilter
  if (opts?.minPotentialStars !== undefined) scout.minPotentialStars = opts.minPotentialStars
}

/**
 * Hire a scout from the candidate market into the active staff. Mutates in place.
 * The new scout starts on a sensible default assignment (youth draft scouting).
 */
export function hireScout(state: ScoutingState, candidate: ScoutCandidate): void {
  if (state.assignments.some((s) => s.scoutId === candidate.id)) return
  state.assignments.push({
    scoutId: candidate.id,
    name: candidate.name,
    rating: candidate.rating,
    judgment: candidate.judgment,
    ...(candidate.specialtyNation ? { specialtyNation: candidate.specialtyNation } : {}),
    salary: candidate.salary,
    target: { kind: 'draftClass' },
    focus: 'youth',
  })
}

/** Release a scout from the active staff. Mutates in place. */
export function fireScout(state: ScoutingState, scoutId: string): void {
  const i = state.assignments.findIndex((s) => s.scoutId === scoutId)
  if (i >= 0) state.assignments.splice(i, 1)
}

/** A scout from the club's staff that can be deployed. */
export interface ScoutRosterMember {
  id: string
  name: string
  rating: number
  judgment?: number
  specialtyNation?: string
  salary?: number
}

/**
 * Reconcile the deployable scout roster to the club's actual staff scouts: one
 * assignment per staff scout, preserving each scout's existing target/focus and
 * refreshing his identity fields. New scouts get a sensible default deployment.
 * Mutates state in place.
 */
export function syncAssignmentsToScouts(state: ScoutingState, scouts: ScoutRosterMember[]): void {
  const byId = new Map(state.assignments.map((a) => [a.scoutId, a]))
  const next: ScoutAssignment[] = scouts.map((s) => {
    const ex = byId.get(s.id)
    const identity = {
      scoutId: s.id,
      name: s.name,
      rating: s.rating,
      ...(s.judgment !== undefined ? { judgment: s.judgment } : {}),
      ...(s.specialtyNation ? { specialtyNation: s.specialtyNation } : {}),
      ...(s.salary !== undefined ? { salary: s.salary } : {}),
    }
    if (ex) return {
      ...identity, target: ex.target, focus: ex.focus ?? 'all',
      ...(ex.positionFilter ? { positionFilter: ex.positionFilter } : {}),
      ...(ex.minPotentialStars !== undefined ? { minPotentialStars: ex.minPotentialStars } : {}),
    }
    // New scout defaults to youth draft discovery; advance-scouting is opt-in.
    return { ...identity, target: { kind: 'draftClass' } as ScoutTarget, focus: 'youth' as ScoutFocus }
  })
  state.assignments = next
}
