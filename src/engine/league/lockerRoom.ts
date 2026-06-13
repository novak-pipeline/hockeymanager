/**
 * Locker-room hierarchy, chemistry, and personality dynamics.
 *
 * Produces a JSON-safe LockerRoomState per team. The career layer holds one
 * entry per team in its snapshot (Array<[teamId, LockerRoomState]>), following
 * the same optional-additive-field pattern as scouting (ScoutingState).
 *
 * Integration seam for the sim:
 *   The integrator composes chemistryModifier on top of effectiveResolve from
 *   condition.ts — both wrap the base resolver, so chemistry and condition stack
 *   multiplicatively without this module touching the sim loop. Example wiring:
 *
 *     const condResolve = effectiveResolve(baseResolver)
 *     const onIceIds = [...] // ids of players on the current shift
 *     const chemMult = chemistryModifier(lockerState, onIceIds)
 *     // apply chemMult to the resolved composites at the call site
 *
 * Determinism: every stochastic decision flows through the caller's seeded Rng.
 * Callers must iterate players in a stable order so a given seed always replays
 * the same league history.
 *
 * Ruleset-awareness: nothing in this module assumes a draft, trade-deadline, or
 * any other ruleset-specific event exists. Those are handled by callers.
 */

import type { Player, Lines } from '@domain'
import type { Rng } from '@engine/shared/rng'
import { overall } from '@engine/ratings/composites'

/* ─────────────────────── public types ─────────────────────── */

export interface Relationship {
  a: string
  b: string
  kind: 'friendship' | 'mentorship' | 'feud'
  /** 0–100 */
  strength: number
  sinceYear: number
}

/**
 * Full locker-room state for one team. JSON-safe (no Maps/classes/functions).
 * Embedded in CareerSnapshot as an optional additive field.
 */
export interface LockerRoomState {
  captainId: string | null
  /** Up to 2 alternate-captain ids. */
  alternateIds: string[]
  /** [playerId, 0-100] influence in the room. */
  influence: Array<[string, number]>
  relationships: Relationship[]
  /**
   * "idA|idB" (sorted) → 0-100 on-ice familiarity for linemates/pairs.
   * Higher = better chemistry when these players share a line.
   */
  familiarity: Array<[string, number]>
  /** Overall room mood, 0–100. */
  roomMorale: number
}

/* ─────────────────────── news-seed type ─────────────────────── */

/** Returned by tick/departure functions; the career layer pushes these. */
export interface NewsSeed {
  category: 'league' | 'milestone'
  headline: string
  body: string
  playerId?: string
  teamId?: string
}

/** Narrative arc seed returned alongside news seeds. */
export interface ArcSeed {
  kind: 'feud' | 'mentorship'
  playerIds: string[]
  summary: string
}

/* ─────────────────────── helpers ─────────────────────── */

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v

/**
 * Leadership score used for captaincy/influence (~0–60 scale). Prefers the
 * source DB's explicit leadership rating (1–99) when present — mapped onto the
 * same scale and blended with loyalty/determination — otherwise falls back to
 * the professionalism + loyalty + determination personality proxy.
 */
function leadershipScore(p: Player): number {
  const { professionalism, loyalty, determination } = p.personality
  if (p.leadership !== undefined) {
    return (p.leadership / 99) * 40 + (loyalty + determination) / 2
  }
  return professionalism + loyalty + determination
}

/** Simple "tenure proxy" combining age with leadership traits. */
function captainScore(p: Player): number {
  // Age proxy (older = more seniority) + weighted personality
  return p.age * 2 + leadershipScore(p)
}

/**
 * Captaincy hierarchy gate: a player can wear the "C" only once he has the
 * standing for it. Established players (24+) qualify on the usual score; younger
 * players need to be genuine room leaders, and a true prospect (≤21) needs to be
 * exceptional — a Crosby/McDavid-type — to leapfrog the veterans. Prevents a
 * rookie being handed the captaincy the moment he walks in.
 */
function isCaptainEligible(p: Player): boolean {
  if (p.position === 'G') return false
  if (p.age >= 24) return true
  const lead = leadershipScore(p)
  if (p.age >= 22) return lead >= 36 // young but a recognised leader
  return lead >= 44 // ≤21: only an exceptional young leader
}

/**
 * Order skaters as captaincy candidates: eligible players first (by score),
 * then everyone else as a fallback so a captain is always chosen.
 */
function captainCandidates(skaters: Player[], scoreOf: (p: Player) => number): Player[] {
  const eligible = skaters.filter(isCaptainEligible)
  const pool = eligible.length > 0 ? eligible : skaters
  return [...pool].sort((a, b) => scoreOf(b) - scoreOf(a))
}

/**
 * Compute influence for one player (0–100).
 * Factors: age (seniority), overall rating, and leadership personality.
 */
function computeInfluence(p: Player): number {
  const ovr = overall(p.composites, p.position)
  // age influence plateaus around 35+
  const ageFactor = clamp((p.age - 18) / 17, 0, 1) // 0 at 18, 1 at 35+
  const personalityFactor = leadershipScore(p) / 60 // max 60 points
  return clamp(
    Math.round(ovr * 0.5 + ageFactor * 25 + personalityFactor * 25),
    1,
    100
  )
}

/** Sort two player ids and join with "|" to produce a stable pair key. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function getFamiliarity(state: LockerRoomState, keyAB: string): number {
  for (const [k, v] of state.familiarity) {
    if (k === keyAB) return v
  }
  return 0
}

function setFamiliarity(state: LockerRoomState, keyAB: string, value: number): void {
  const clamped = clamp(value, 0, 100)
  for (const entry of state.familiarity) {
    if (entry[0] === keyAB) {
      entry[1] = clamped
      return
    }
  }
  state.familiarity.push([keyAB, clamped])
}

function getInfluence(state: LockerRoomState, playerId: string): number {
  for (const [id, v] of state.influence) {
    if (id === playerId) return v
  }
  return 0
}

function setInfluence(state: LockerRoomState, playerId: string, value: number): void {
  const clamped = clamp(value, 0, 100)
  for (const entry of state.influence) {
    if (entry[0] === playerId) {
      entry[1] = clamped
      return
    }
  }
  state.influence.push([playerId, clamped])
}

function findRelationship(
  state: LockerRoomState,
  a: string,
  b: string
): Relationship | undefined {
  return state.relationships.find(
    (r) => (r.a === a && r.b === b) || (r.a === b && r.b === a)
  )
}

/** True when the two players share any even-strength line. */
function shareEVLine(lines: Lines, idA: string, idB: string): boolean {
  for (const line of lines.forwards) {
    if (line.includes(idA) && line.includes(idB)) return true
  }
  for (const pair of lines.defensePairs) {
    if (pair.includes(idA) && pair.includes(idB)) return true
  }
  return false
}

/* ─────────────────────── init ─────────────────────── */

/**
 * Build a fresh LockerRoomState from a roster.
 *
 * - Captain = player with highest (captainScore) excluding goalies.
 * - Two alternates = next highest by captainScore (excluding captain, no goalies preferred
 *   but may include D).
 * - Influence seeded from age/overall/personality.
 * - 1–3 seed relationships from personality compatibility.
 */
export function initLockerRoom(args: {
  roster: Player[]
  year: number
  rng: Rng
}): LockerRoomState {
  const { roster, year, rng } = args

  /* ── captain & alternates (hierarchy-gated) ── */
  const skaters = roster.filter((p) => p.position !== 'G')
  const sorted = captainCandidates(skaters, captainScore)

  const captain = sorted[0] ?? null
  const captainId = captain?.id ?? null

  const altCandidates = sorted.filter((p) => p.id !== captainId)
  const alternateIds: string[] = altCandidates.slice(0, 2).map((p) => p.id)

  /* ── influence ── */
  const influence: Array<[string, number]> = roster.map((p) => [
    p.id,
    computeInfluence(p),
  ])

  /* ── seed relationships ── */
  const relationships: Relationship[] = []
  const candidatePairs: Array<[Player, Player]> = []

  // Only consider first 15 skaters to keep pairing manageable
  const eligible = skaters.slice(0, 15)
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      candidatePairs.push([eligible[i], eligible[j]])
    }
  }

  // Shuffle pairs so seed relationships aren't always the first pairing
  rng.shuffle(candidatePairs)

  const mentorships = new Set<string>()
  const feudPairs = new Set<string>()
  const friendPairs = new Set<string>()

  for (const [pa, pb] of candidatePairs) {
    if (relationships.length >= 3) break

    const key = pairKey(pa.id, pb.id)
    const ageDiff = Math.abs(pa.age - pb.age)
    const olderP = pa.age >= pb.age ? pa : pb
    const youngerP = pa.age < pb.age ? pa : pb

    // Mentorship: veteran (age diff ≥ 5) + veteran has high professionalism
    if (
      !mentorships.has(olderP.id) &&
      ageDiff >= 5 &&
      olderP.personality.professionalism >= 14 &&
      youngerP.age <= 25 &&
      rng.chance(0.4)
    ) {
      relationships.push({
        a: olderP.id,
        b: youngerP.id,
        kind: 'mentorship',
        strength: rng.range(20, 50),
        sinceYear: year,
      })
      mentorships.add(olderP.id)
      continue
    }

    // Feud: both high temperament (≥ 14) and both high ambition (≥ 14)
    if (
      !feudPairs.has(key) &&
      pa.personality.temperament >= 14 &&
      pb.personality.temperament >= 14 &&
      pa.personality.ambition >= 14 &&
      pb.personality.ambition >= 14 &&
      rng.chance(0.35)
    ) {
      relationships.push({
        a: pa.id,
        b: pb.id,
        kind: 'feud',
        strength: rng.range(10, 40),
        sinceYear: year,
      })
      feudPairs.add(key)
      continue
    }

    // Friendship: similar age (diff ≤ 3) + both high loyalty (≥ 13).
    // Team-first players (high teamwork from the DB) bond more readily; absent
    // teamwork on fictional players leaves the base 0.35 chance unchanged.
    const twBonus =
      pa.teamwork !== undefined && pb.teamwork !== undefined
        ? Math.max(0, (pa.teamwork + pb.teamwork) / 2 - 50) / 100 * 0.3
        : 0
    if (
      !friendPairs.has(key) &&
      ageDiff <= 3 &&
      pa.personality.loyalty >= 13 &&
      pb.personality.loyalty >= 13 &&
      rng.chance(0.35 + twBonus)
    ) {
      relationships.push({
        a: pa.id,
        b: pb.id,
        kind: 'friendship',
        strength: rng.range(20, 55),
        sinceYear: year,
      })
      friendPairs.add(key)
    }
  }

  return {
    captainId,
    alternateIds,
    influence,
    relationships,
    familiarity: [],
    roomMorale: 60,
  }
}

/* ─────────────────────── tick ─────────────────────── */

const FAMILIARITY_GAIN_PER_GAME = 2
const FAMILIARITY_DECAY = 0.5
const FEUD_ESCALATION_RATE = 4
const MENTORSHIP_GROWTH_RATE = 3
const LOSING_STREAK_THRESHOLD = 4

/**
 * Advance locker-room state by one match day (game or rest day).
 *
 * Returns news seeds and arc seeds (the career layer decides whether to
 * promote arc seeds to full narrative arcs).
 */
export function tickLockerRoom(args: {
  state: LockerRoomState
  roster: Player[]
  lines: Lines
  /** True on game days. */
  playedToday: boolean
  won?: boolean
  rng: Rng
  day: number
  year: number
  /** Count of consecutive losses leading into today (caller tracks). */
  losingStreak?: number
}): { newsSeeds: NewsSeed[]; arcSeeds: ArcSeed[] } {
  const { state, roster, lines, playedToday, won, rng, day, year, losingStreak = 0 } = args
  const newsSeeds: NewsSeed[] = []
  const arcSeeds: ArcSeed[] = []

  const rosterMap = new Map<string, Player>(roster.map((p) => [p.id, p]))

  /* ── familiarity: gain for current EV linemates/pairs ── */
  if (playedToday) {
    // Collect all current EV pairs
    const activeLinemates = new Set<string>()

    for (const line of lines.forwards) {
      for (let i = 0; i < line.length; i++) {
        for (let j = i + 1; j < line.length; j++) {
          const key = pairKey(line[i], line[j])
          activeLinemates.add(key)
        }
      }
    }
    for (const pair of lines.defensePairs) {
      const key = pairKey(pair[0], pair[1])
      activeLinemates.add(key)
    }

    // Gain for active pairs
    for (const key of activeLinemates) {
      const current = getFamiliarity(state, key)
      setFamiliarity(state, key, current + FAMILIARITY_GAIN_PER_GAME)
    }

    // Decay for all existing pairs NOT on the current lines
    for (const entry of state.familiarity) {
      if (!activeLinemates.has(entry[0])) {
        entry[1] = clamp(entry[1] - FAMILIARITY_DECAY, 0, 100)
      }
    }
  }

  /* ── relationships evolve ── */
  for (const rel of state.relationships) {
    const pa = rosterMap.get(rel.a)
    const pb = rosterMap.get(rel.b)
    if (!pa || !pb) continue

    if (rel.kind === 'feud') {
      const onSameLine = shareEVLine(lines, rel.a, rel.b)
      // Feuds escalate when both high-temperament players share a line and team is losing
      if (playedToday && won === false && onSameLine && losingStreak >= 2) {
        rel.strength = clamp(rel.strength + rng.range(1, FEUD_ESCALATION_RATE), 0, 100)
      } else if (playedToday && won === true) {
        // Wins slightly cool feuds
        rel.strength = clamp(rel.strength - rng.range(0, 2), 0, 100)
      }
    } else if (rel.kind === 'mentorship') {
      if (playedToday) {
        // Mentorships deepen with game time together
        const onSameLine = shareEVLine(lines, rel.a, rel.b)
        const delta = onSameLine ? MENTORSHIP_GROWTH_RATE : 1
        rel.strength = clamp(rel.strength + rng.range(0, delta), 0, 100)
      }
    } else if (rel.kind === 'friendship') {
      if (playedToday) {
        // Friendships slowly strengthen with shared wins, weaken with prolonged losing
        const delta = won === true ? 1 : won === false ? -1 : 0
        rel.strength = clamp(rel.strength + delta, 0, 100)
      }
    }
  }

  /* ── roomMorale follows results, weighted by captain's morale ── */
  if (playedToday) {
    const captainMorale =
      state.captainId !== null
        ? (rosterMap.get(state.captainId)?.morale ?? state.roomMorale)
        : state.roomMorale

    // Captain influence: blend captain's morale toward the room
    const captainWeight = 0.2
    const baseDelta = won === true ? 3 : won === false ? -3 : 0
    const captainLift = (captainMorale - state.roomMorale) * captainWeight * 0.5
    state.roomMorale = clamp(
      Math.round(state.roomMorale + baseDelta + captainLift),
      0,
      100
    )
  }

  /* ── rare events (~1/30 game days) ── */
  if (playedToday && rng.chance(1 / 30)) {
    // Pick which kind of rare event occurs
    const roll = rng.int(3)

    if (roll === 0) {
      // Feud flare-up: pick an existing feud or two hot-tempered players
      const feuds = state.relationships.filter((r) => r.kind === 'feud')
      if (feuds.length > 0) {
        const feud = rng.pick(feuds)
        feud.strength = clamp(feud.strength + rng.range(5, 15), 0, 100)
        const pa = rosterMap.get(feud.a)
        const pb = rosterMap.get(feud.b)
        if (pa && pb) {
          newsSeeds.push({
            category: 'league',
            headline: `Tensions flare between ${pa.name} and ${pb.name}`,
            body: `Sources close to the locker room report a heated exchange between ${pa.name} and ${pb.name}.`,
            playerId: feud.a,
          })
          arcSeeds.push({
            kind: 'feud',
            playerIds: [feud.a, feud.b],
            summary: `Feud between ${pa.name} and ${pb.name} escalated on day ${day}.`,
          })
        }
      }
    } else if (roll === 1) {
      // New mentorship formed between a veteran and a young player
      const veterans = roster.filter((p) => p.age >= 30 && p.personality.professionalism >= 13)
      const rookies = roster.filter((p) => p.age <= 23)
      if (veterans.length > 0 && rookies.length > 0) {
        const vet = rng.pick(veterans)
        const rookie = rng.pick(rookies)
        if (vet.id !== rookie.id) {
          const existing = findRelationship(state, vet.id, rookie.id)
          if (!existing) {
            state.relationships.push({
              a: vet.id,
              b: rookie.id,
              kind: 'mentorship',
              strength: rng.range(10, 30),
              sinceYear: year,
            })
            newsSeeds.push({
              category: 'milestone',
              headline: `${vet.name} takes ${rookie.name} under his wing`,
              body: `Veteran ${vet.name} has been spotted giving extra time to ${rookie.name} in practice.`,
              playerId: rookie.id,
            })
            arcSeeds.push({
              kind: 'mentorship',
              playerIds: [vet.id, rookie.id],
              summary: `${vet.name} formed a mentorship with ${rookie.name} on day ${day}.`,
            })
          }
        }
      }
    } else {
      // Leadership meeting after a prolonged losing streak
      if (losingStreak >= LOSING_STREAK_THRESHOLD && state.captainId !== null) {
        const cap = rosterMap.get(state.captainId)
        if (cap) {
          // Meeting has a small positive morale effect
          state.roomMorale = clamp(state.roomMorale + rng.range(2, 6), 0, 100)
          newsSeeds.push({
            category: 'league',
            headline: `${cap.name} calls closed-door meeting`,
            body: `Captain ${cap.name} addressed the team after the recent skid, calling for a refocus.`,
            playerId: cap.id,
          })
        }
      }
    }
  }

  return { newsSeeds, arcSeeds }
}

/* ─────────────────────── chemistry modifier ─────────────────────── */

/**
 * On-ice chemistry modifier for a unit of players (0.97–1.03).
 *
 * Composed on top of effectiveResolve from condition.ts by the integrator:
 *   const condResolve = effectiveResolve(baseResolver)
 *   const mult = chemistryModifier(lockerState, onIceIds)
 *   // integrator scales composites by mult at the call site
 *
 * Factors:
 *  - Average pairwise familiarity among the unit
 *  - Positive relationships (friendship/mentorship) add lift
 *  - Feuds subtract
 */
export function chemistryModifier(
  state: LockerRoomState,
  onIceIds: string[]
): number {
  if (onIceIds.length < 2) return 1

  let totalFamiliarity = 0
  let pairCount = 0
  let relBonus = 0

  for (let i = 0; i < onIceIds.length; i++) {
    for (let j = i + 1; j < onIceIds.length; j++) {
      const key = pairKey(onIceIds[i], onIceIds[j])
      totalFamiliarity += getFamiliarity(state, key)
      pairCount++

      const rel = findRelationship(state, onIceIds[i], onIceIds[j])
      if (rel) {
        const normalizedStrength = rel.strength / 100
        if (rel.kind === 'friendship') relBonus += 0.01 * normalizedStrength
        else if (rel.kind === 'mentorship') relBonus += 0.008 * normalizedStrength
        else if (rel.kind === 'feud') relBonus -= 0.015 * normalizedStrength
      }
    }
  }

  const avgFamiliarity = pairCount > 0 ? totalFamiliarity / pairCount : 0
  // familiarity 0 → -0.02, familiarity 50 → 0, familiarity 100 → +0.02
  const familiarityBonus = (avgFamiliarity - 50) / 50 * 0.02
  const raw = 1 + familiarityBonus + relBonus
  return clamp(raw, 0.97, 1.03)
}

/* ─────────────────────── player departure ─────────────────────── */

/**
 * Handle a player leaving the team (trade, waiver, buy-out, etc.).
 * Returns news seeds and a crisis flag that tells the integrator to call
 * electCaptain when the departing player was captain.
 */
export function onPlayerDeparted(
  state: LockerRoomState,
  playerId: string,
  rng: Rng
): { newsSeeds: NewsSeed[]; leadershipCrisis: boolean } {
  const newsSeeds: NewsSeed[] = []
  let leadershipCrisis = false

  const wasCapt = state.captainId === playerId
  const wasAlternate = state.alternateIds.includes(playerId)

  // Morale hit for losing a key figure
  const influence = getInfluence(state, playerId)
  const moralePenalty = wasCapt ? 10 : wasAlternate ? 5 : Math.round(influence / 20)
  state.roomMorale = clamp(state.roomMorale - moralePenalty - rng.range(0, 3), 0, 100)

  if (wasCapt) {
    leadershipCrisis = true
    state.captainId = null
    newsSeeds.push({
      category: 'league',
      headline: `Captain vacancy after departure`,
      body: `The team is without a captain following the departure. A new leader must be named.`,
      playerId,
    })
  } else if (wasAlternate) {
    state.alternateIds = state.alternateIds.filter((id) => id !== playerId)
    newsSeeds.push({
      category: 'league',
      headline: `Alternate captain departs`,
      body: `An alternate captain has left the team, creating a vacancy in the leadership group.`,
      playerId,
    })
  }

  // Remove from influence list
  state.influence = state.influence.filter(([id]) => id !== playerId)

  // Remove familiarity entries involving this player
  state.familiarity = state.familiarity.filter(([key]) => {
    const [a, b] = key.split('|')
    return a !== playerId && b !== playerId
  })

  // Remove relationships involving this player
  state.relationships = state.relationships.filter(
    (r) => r.a !== playerId && r.b !== playerId
  )

  return { newsSeeds, leadershipCrisis }
}

/**
 * Elect a new captain from the given roster (e.g. after onPlayerDeparted
 * returned leadershipCrisis = true). Updates state.captainId and fills the
 * first vacancy in alternateIds. Returns news seeds.
 */
export function electCaptain(
  state: LockerRoomState,
  roster: Player[],
  rng: Rng
): NewsSeed[] {
  const newsSeeds: NewsSeed[] = []

  const skaters = roster.filter(
    (p) => p.position !== 'G' && p.id !== state.captainId
  )
  if (skaters.length === 0) return newsSeeds

  // Small random noise so it's not purely deterministic (coaching input).
  // Hierarchy-gated: only captain-eligible players are considered first.
  const noise = new Map<string, number>(skaters.map((p) => [p.id, rng.range(0, 5)]))
  const ordered = captainCandidates(skaters, (p) => captainScore(p) + (noise.get(p.id) ?? 0))

  const newCaptain = ordered[0]!
  const scored = ordered.map((p) => ({ p }))
  state.captainId = newCaptain.id

  // Fill alternate vacancies
  const remaining = scored.slice(1).map((s) => s.p)
  while (state.alternateIds.length < 2 && remaining.length > 0) {
    const next = remaining.shift()!
    if (!state.alternateIds.includes(next.id)) {
      state.alternateIds.push(next.id)
    }
  }

  newsSeeds.push({
    category: 'league',
    headline: `${newCaptain.name} named team captain`,
    body: `The coaching staff has designated ${newCaptain.name} as the new captain.`,
    playerId: newCaptain.id,
  })

  return newsSeeds
}

/* ─────────────────────── player arrival ─────────────────────── */

/**
 * Handle a player joining the team (trade, signing, recall, etc.).
 * New arrivals start with low familiarity and get their influence seeded.
 * Mutates state in place; no return value.
 */
export function onPlayerArrived(
  state: LockerRoomState,
  player: Player,
  _rng: Rng
): void {
  // Remove any stale entry first (re-signing a player)
  state.influence = state.influence.filter(([id]) => id !== player.id)

  // Influence from age/overall; slightly lower than incumbents (they're new)
  const base = computeInfluence(player)
  const arrivedInfluence = clamp(Math.round(base * 0.75), 1, 100)
  state.influence.push([player.id, arrivedInfluence])

  // Familiarity starts at 0 for all pairs (already absent from the array is fine,
  // but we explicitly do nothing — getFamiliarity returns 0 for missing keys)
}

/* ─────────────────────── development modifier ─────────────────────── */

/**
 * Per-player development speed modifier (0.9–1.15).
 *
 * Mentorship protégés gain a boost; feuding players suffer a drag. The
 * integrator passes this to the offseason development phase.
 */
export function developmentModifier(
  state: LockerRoomState,
  playerId: string
): number {
  let modifier = 1.0

  for (const rel of state.relationships) {
    const isA = rel.a === playerId
    const isB = rel.b === playerId
    if (!isA && !isB) continue

    const norm = rel.strength / 100

    if (rel.kind === 'mentorship') {
      // The protégé (b) gains; the mentor doesn't get a development boost
      if (isB) {
        modifier += 0.15 * norm // up to +0.15 at full strength
      }
    } else if (rel.kind === 'feud') {
      modifier -= 0.10 * norm // up to -0.10 at full strength
    }
    // Friendships have no direct development effect
  }

  return clamp(modifier, 0.9, 1.15)
}
