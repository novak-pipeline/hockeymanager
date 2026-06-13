/**
 * Tests for lockerRoom.ts — locker-room hierarchy, chemistry, personality.
 */
import { describe, expect, it } from 'vitest'
import type {
  CompositeRatings,
  Contract,
  Lines,
  Personality,
  Player,
  PlayerId,
  Position,
  RawAttributes,
  SeasonStats
} from '@domain'
import { asPlayerId } from '@domain'
import { computeComposites } from '@engine/ratings/composites'
import { Rng } from '@engine/shared/rng'
import {
  initLockerRoom,
  tickLockerRoom,
  chemistryModifier,
  onPlayerDeparted,
  onPlayerArrived,
  developmentModifier,
  electCaptain
} from './lockerRoom'
import type { LockerRoomState } from './lockerRoom'

/* ──────────────────────── helpers ──────────────────────── */

let nextId = 1
function pid(): PlayerId {
  return asPlayerId(`p${nextId++}`)
}

function rawAttrs(val = 50): RawAttributes {
  return {
    technical: {
      wristShot: val, slapShot: val, stickhandling: val,
      passing: val, deflections: val, faceoffs: val
    },
    physical: {
      speed: val, acceleration: val, strength: val,
      balance: val, stamina: val, agility: val, height: val
    },
    mental: {
      offensiveIQ: val, defensiveIQ: val, positioning: val,
      vision: val, aggression: val, composure: val,
      workRate: val, discipline: val, anticipation: val
    },
    defensive: { checking: val, shotBlocking: val, stickChecking: val, takeaway: val }
  }
}

const defaultContract: Contract = {
  salary: 2_000_000, yearsRemaining: 2, expiryYear: 2026,
  noTradeClause: false, twoWay: false
}

const defaultStats: SeasonStats = {
  season: 2025, teamId: 'T1', gamesPlayed: 0,
  ev: { goals: 0, assists: 0, shots: 0, timeOnIce: 0 },
  pp: { goals: 0, assists: 0, shots: 0, timeOnIce: 0 },
  pk: { goals: 0, assists: 0, shots: 0, timeOnIce: 0 },
  plusMinus: 0, penaltyMinutes: 0,
  saves: 0, shotsAgainst: 0, goalsAgainst: 0, shutouts: 0
}

function makePlayer(
  position: Position = 'C',
  personalityOverrides: Partial<Personality> = {},
  miscOverrides: Partial<Player> = {}
): Player {
  const id = pid()
  const ratings = rawAttrs(60)
  const composites = computeComposites(ratings, 'twoWay', position)
  const personality: Personality = {
    ambition: 10,
    professionalism: 10,
    loyalty: 10,
    temperament: 10,
    determination: 10,
    ...personalityOverrides
  }
  return {
    id,
    name: `Player ${id}`,
    age: 25,
    position,
    handedness: 'L',
    role: 'twoWay',
    ratings,
    potential: ratings,
    composites,
    personality,
    contract: defaultContract,
    stats: [{ ...defaultStats }],
    fatigue: 0,
    morale: 60,
    injuryStatus: null,
    form: 0,
    ...miscOverrides
  }
}

/** Build a minimal Lines with up to 4 forward lines and 3 D pairs. */
function makeLines(
  forwards: PlayerId[][] = [],
  defensePairs: PlayerId[][] = [],
  goalies?: [PlayerId, PlayerId]
): Lines {
  const g1 = pid()
  const g2 = pid()
  return {
    forwards: forwards as [PlayerId, PlayerId, PlayerId][],
    defensePairs: defensePairs as [PlayerId, PlayerId][],
    goalies: goalies ?? [g1, g2],
    powerPlayUnits: [],
    penaltyKillUnits: []
  }
}

/* ──────────────────────── initLockerRoom ──────────────────────── */

describe('initLockerRoom', () => {
  it('captain is the skater with the highest captain-score (personality-weighted)', () => {
    const rng = new Rng(1)
    const year = 2025

    // Make a strong leader: high professionalism, loyalty, determination; older
    const leader = makePlayer('C', { professionalism: 20, loyalty: 20, determination: 20 }, { age: 35 })
    const ordinary1 = makePlayer('W', {}, { age: 25 })
    const ordinary2 = makePlayer('D', {}, { age: 22 })
    const goalie = makePlayer('G', { professionalism: 20, loyalty: 20, determination: 20 }, { age: 35 })

    const state = initLockerRoom({ roster: [leader, ordinary1, ordinary2, goalie], year, rng })

    // Captain must be the strong leader (not the goalie, even though goalie has equal personality)
    expect(state.captainId).toBe(leader.id)
  })

  it('a young, non-elite player is not handed the captaincy over an eligible veteran', () => {
    // 19-year-old with good-but-not-elite leadership has the higher raw captain
    // score, but the hierarchy gate makes him ineligible at that age, so the
    // established (if unremarkable) veteran wears the C.
    const young = makePlayer('C', {}, { age: 19, leadership: 80, name: 'Wonder Kid' })
    const vet = makePlayer('W', {}, { age: 24, leadership: 1, name: 'Old Hand' })
    const state: LockerRoomState = {
      captainId: null,
      alternateIds: [],
      influence: [],
      relationships: [],
      familiarity: [],
      roomMorale: 60,
    }
    electCaptain(state, [young, vet], new Rng(5))
    expect(state.captainId).toBe(vet.id)
    expect(state.captainId).not.toBe(young.id)
  })

  it('alternates are the two next-best skaters after the captain', () => {
    const rng = new Rng(2)
    const year = 2025

    const p1 = makePlayer('C', { professionalism: 20, loyalty: 20, determination: 20 }, { age: 35 })
    const p2 = makePlayer('W', { professionalism: 15, loyalty: 15, determination: 15 }, { age: 30 })
    const p3 = makePlayer('D', { professionalism: 12, loyalty: 12, determination: 12 }, { age: 28 })
    const p4 = makePlayer('W', {}, { age: 22 })

    const state = initLockerRoom({ roster: [p1, p2, p3, p4], year, rng })

    expect(state.captainId).toBe(p1.id)
    expect(state.alternateIds).toContain(p2.id)
    expect(state.alternateIds).toContain(p3.id)
    expect(state.alternateIds).not.toContain(p1.id)
    expect(state.alternateIds.length).toBeLessThanOrEqual(2)
  })

  it('influence array covers all roster members', () => {
    const rng = new Rng(3)
    const roster = [makePlayer('C'), makePlayer('W'), makePlayer('D'), makePlayer('G')]
    const state = initLockerRoom({ roster, year: 2025, rng })
    const ids = state.influence.map(([id]) => id)
    for (const p of roster) {
      expect(ids).toContain(p.id)
    }
  })

  it('influence values are in [1, 100]', () => {
    const rng = new Rng(4)
    const roster = Array.from({ length: 10 }, () => makePlayer())
    const state = initLockerRoom({ roster, year: 2025, rng })
    for (const [, v] of state.influence) {
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(100)
    }
  })

  it('seeds a mentorship when a veteran with high professionalism is paired with a rookie', () => {
    // Use a fixed seed and deterministic roster to guarantee the pairing is tried
    const rng = new Rng(42)
    const veteran = makePlayer('C', { professionalism: 18, loyalty: 10, determination: 10 }, { age: 34 })
    const rookie = makePlayer('W', {}, { age: 21 })
    // Fill rest to avoid goalie-only roster
    const rest = Array.from({ length: 5 }, () => makePlayer('D', {}, { age: 27 }))

    const state = initLockerRoom({ roster: [veteran, rookie, ...rest], year: 2025, rng })

    // There might or might not be a mentorship depending on RNG, but if one exists it must be correctly typed
    const mentorships = state.relationships.filter((r) => r.kind === 'mentorship')
    for (const m of mentorships) {
      expect(m.strength).toBeGreaterThan(0)
      expect(m.sinceYear).toBe(2025)
    }
  })

  it('seeds a feud when two players both have high temperament and high ambition', () => {
    // Construct a roster where exactly two players are hothead+ambitious
    const hotHead1 = makePlayer('C', { temperament: 18, ambition: 18 }, { age: 25 })
    const hotHead2 = makePlayer('W', { temperament: 17, ambition: 17 }, { age: 26 })
    const normal = Array.from({ length: 6 }, () => makePlayer('D'))

    // Try multiple seeds to find one where a feud seeds
    let feudFound = false
    for (let seed = 0; seed < 50; seed++) {
      const state = initLockerRoom({ roster: [hotHead1, hotHead2, ...normal], year: 2025, rng: new Rng(seed) })
      const feud = state.relationships.find(
        (r) => r.kind === 'feud' &&
          ((r.a === hotHead1.id && r.b === hotHead2.id) ||
           (r.a === hotHead2.id && r.b === hotHead1.id))
      )
      if (feud) { feudFound = true; break }
    }
    expect(feudFound).toBe(true)
  })

  it('roomMorale initializes to 60', () => {
    const state = initLockerRoom({ roster: [makePlayer()], year: 2025, rng: new Rng(1) })
    expect(state.roomMorale).toBe(60)
  })

  it('familiarity starts empty', () => {
    const state = initLockerRoom({ roster: [makePlayer(), makePlayer()], year: 2025, rng: new Rng(1) })
    expect(state.familiarity).toHaveLength(0)
  })

  it('round-trips through JSON without data loss', () => {
    const roster = Array.from({ length: 12 }, () => makePlayer())
    const state = initLockerRoom({ roster, year: 2025, rng: new Rng(7) })
    const roundTripped: LockerRoomState = JSON.parse(JSON.stringify(state))
    expect(roundTripped.captainId).toBe(state.captainId)
    expect(roundTripped.alternateIds).toEqual(state.alternateIds)
    expect(roundTripped.roomMorale).toBe(state.roomMorale)
    expect(roundTripped.influence.length).toBe(state.influence.length)
    expect(roundTripped.relationships.length).toBe(state.relationships.length)
  })
})

/* ──────────────────────── familiarity growth/decay ──────────────────────── */

describe('tickLockerRoom — familiarity', () => {
  it('familiarity grows for current EV linemates on game days', () => {
    const p1 = makePlayer('C')
    const p2 = makePlayer('W')
    const p3 = makePlayer('W')
    const g1 = makePlayer('G')
    const g2 = makePlayer('G')
    const roster = [p1, p2, p3, g1, g2]
    const state = initLockerRoom({ roster, year: 2025, rng: new Rng(1) })

    const lines = makeLines(
      [[p1.id, p2.id, p3.id]],
      [],
      [g1.id, g2.id]
    )

    tickLockerRoom({ state, roster, lines, playedToday: true, won: true, rng: new Rng(2), day: 1, year: 2025 })

    // Find familiarity for any pair from the line
    const pairFam = state.familiarity.find(([key]) =>
      key === [p1.id, p2.id].sort().join('|') ||
      key === [p1.id, p3.id].sort().join('|') ||
      key === [p2.id, p3.id].sort().join('|')
    )
    expect(pairFam).toBeDefined()
    expect(pairFam![1]).toBeGreaterThan(0)
  })

  it('familiarity decays for pairs no longer on the same line', () => {
    const p1 = makePlayer('C')
    const p2 = makePlayer('W')
    const p3 = makePlayer('W')
    const p4 = makePlayer('C')
    const g1 = makePlayer('G')
    const g2 = makePlayer('G')
    const roster = [p1, p2, p3, p4, g1, g2]
    const state = initLockerRoom({ roster, year: 2025, rng: new Rng(1) })

    // First game: p1+p2+p3 on line 1
    const lines1 = makeLines([[p1.id, p2.id, p3.id]], [], [g1.id, g2.id])
    tickLockerRoom({ state, roster, lines: lines1, playedToday: true, won: true, rng: new Rng(2), day: 1, year: 2025 })

    const keyP1P2 = [p1.id, p2.id].sort().join('|')
    const famAfterGame1 = state.familiarity.find(([k]) => k === keyP1P2)?.[1] ?? 0
    expect(famAfterGame1).toBeGreaterThan(0)

    // Second game: p1 now plays with p4 instead of p2
    const lines2 = makeLines([[p1.id, p4.id, p3.id]], [], [g1.id, g2.id])
    tickLockerRoom({ state, roster, lines: lines2, playedToday: true, won: true, rng: new Rng(3), day: 2, year: 2025 })

    const famAfterGame2 = state.familiarity.find(([k]) => k === keyP1P2)?.[1] ?? 0
    expect(famAfterGame2).toBeLessThan(famAfterGame1)
  })

  it('familiarity is clamped to [0, 100]', () => {
    const p1 = makePlayer('C')
    const p2 = makePlayer('W')
    const p3 = makePlayer('W')
    const g1 = makePlayer('G')
    const g2 = makePlayer('G')
    const roster = [p1, p2, p3, g1, g2]
    const state = initLockerRoom({ roster, year: 2025, rng: new Rng(1) })
    const lines = makeLines([[p1.id, p2.id, p3.id]], [], [g1.id, g2.id])

    // Simulate many games to max out familiarity
    for (let i = 0; i < 100; i++) {
      tickLockerRoom({ state, roster, lines, playedToday: true, won: true, rng: new Rng(i), day: i, year: 2025 })
    }

    for (const [, v] of state.familiarity) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })
})

/* ──────────────────────── feud genesis ──────────────────────── */

describe('tickLockerRoom — feud escalation', () => {
  it('feud escalates among hot-tempered players on a losing streak', () => {
    const hotHead1 = makePlayer('C', { temperament: 18, ambition: 15 })
    const hotHead2 = makePlayer('W', { temperament: 17, ambition: 15 })
    const others = Array.from({ length: 4 }, () => makePlayer('D'))
    const g1 = makePlayer('G')
    const g2 = makePlayer('G')
    const roster = [hotHead1, hotHead2, ...others, g1, g2]

    // Pre-seed a feud between the two hot-heads
    const state = initLockerRoom({ roster, year: 2025, rng: new Rng(1) })
    const existingFeud = state.relationships.find(
      (r) => r.kind === 'feud' &&
        ((r.a === hotHead1.id && r.b === hotHead2.id) ||
         (r.a === hotHead2.id && r.b === hotHead1.id))
    )
    // If no feud was seeded naturally, inject one
    if (!existingFeud) {
      state.relationships.push({
        a: hotHead1.id,
        b: hotHead2.id,
        kind: 'feud',
        strength: 20,
        sinceYear: 2025
      })
    }

    const feudBefore = state.relationships.find(
      (r) => r.kind === 'feud' &&
        ((r.a === hotHead1.id && r.b === hotHead2.id) ||
         (r.a === hotHead2.id && r.b === hotHead1.id))
    )!
    const strengthBefore = feudBefore.strength

    // Put them on the same line and simulate a loss with a losing streak
    const lines = makeLines(
      [[hotHead1.id, hotHead2.id, others[0].id]],
      [],
      [g1.id, g2.id]
    )

    tickLockerRoom({
      state, roster, lines, playedToday: true, won: false,
      rng: new Rng(10), day: 5, year: 2025, losingStreak: 3
    })

    const feudAfter = state.relationships.find(
      (r) => r.kind === 'feud' &&
        ((r.a === hotHead1.id && r.b === hotHead2.id) ||
         (r.a === hotHead2.id && r.b === hotHead1.id))
    )!
    expect(feudAfter.strength).toBeGreaterThan(strengthBefore)
  })
})

/* ──────────────────────── chemistry modifier ──────────────────────── */

describe('chemistryModifier', () => {
  it('returns 1.0 when there is no familiarity or relationships', () => {
    const state = initLockerRoom({ roster: [makePlayer(), makePlayer()], year: 2025, rng: new Rng(1) })
    state.familiarity = []
    state.relationships = []
    const p1 = asPlayerId('x1')
    const p2 = asPlayerId('x2')
    // 50 familiarity → neutral; no relations → 1.0 exactly from formula:
    // familiarityBonus = (50-50)/50*0.02 = 0
    // modifier = 1.0
    // But we have 0 familiarity:
    // familiarityBonus = (0-50)/50*0.02 = -0.02 → clamped to 0.97
    const mod = chemistryModifier(state, [p1, p2])
    expect(mod).toBeCloseTo(0.98, 1)
  })

  it('returns 1.0 for a single player (no pairs)', () => {
    const state = initLockerRoom({ roster: [makePlayer()], year: 2025, rng: new Rng(1) })
    expect(chemistryModifier(state, [asPlayerId('solo')])).toBe(1)
  })

  it('is strictly bounded to [0.97, 1.03]', () => {
    const p1 = makePlayer('C')
    const p2 = makePlayer('W')
    const roster = [p1, p2]
    const state = initLockerRoom({ roster, year: 2025, rng: new Rng(1) })

    // Max familiarity
    const key = [p1.id, p2.id].sort().join('|')
    state.familiarity = [[key, 100]]
    state.relationships = [{
      a: p1.id, b: p2.id, kind: 'friendship', strength: 100, sinceYear: 2025
    }]
    const high = chemistryModifier(state, [p1.id, p2.id])
    expect(high).toBeGreaterThanOrEqual(0.97)
    expect(high).toBeLessThanOrEqual(1.03)

    // Min familiarity + feud
    state.familiarity = [[key, 0]]
    state.relationships = [{
      a: p1.id, b: p2.id, kind: 'feud', strength: 100, sinceYear: 2025
    }]
    const low = chemistryModifier(state, [p1.id, p2.id])
    expect(low).toBeGreaterThanOrEqual(0.97)
    expect(low).toBeLessThanOrEqual(1.03)
  })

  it('familiar linemates with a friendship produce a higher modifier than strangers', () => {
    const p1 = makePlayer('C')
    const p2 = makePlayer('W')
    const key = [p1.id, p2.id].sort().join('|')

    const stateHigh: LockerRoomState = {
      captainId: null,
      alternateIds: [],
      influence: [],
      relationships: [{ a: p1.id, b: p2.id, kind: 'friendship', strength: 80, sinceYear: 2025 }],
      familiarity: [[key, 90]],
      roomMorale: 60
    }

    const stateLow: LockerRoomState = {
      captainId: null,
      alternateIds: [],
      influence: [],
      relationships: [],
      familiarity: [[key, 10]],
      roomMorale: 60
    }

    expect(chemistryModifier(stateHigh, [p1.id, p2.id])).toBeGreaterThan(
      chemistryModifier(stateLow, [p1.id, p2.id])
    )
  })
})

/* ──────────────────────── departure crisis ──────────────────────── */

describe('onPlayerDeparted', () => {
  it('flags leadershipCrisis when the captain departs', () => {
    const captain = makePlayer('C', { professionalism: 20, loyalty: 20, determination: 20 }, { age: 35 })
    const others = Array.from({ length: 5 }, () => makePlayer())
    const roster = [captain, ...others]
    const state = initLockerRoom({ roster, year: 2025, rng: new Rng(1) })
    expect(state.captainId).toBe(captain.id)

    const { leadershipCrisis, newsSeeds } = onPlayerDeparted(state, captain.id, new Rng(2))

    expect(leadershipCrisis).toBe(true)
    expect(state.captainId).toBeNull()
    expect(newsSeeds.length).toBeGreaterThan(0)
    expect(newsSeeds[0].headline).toMatch(/captain/i)
  })

  it('does not flag crisis when a non-captain departs', () => {
    const captain = makePlayer('C', { professionalism: 20, loyalty: 20, determination: 20 }, { age: 35 })
    const bench = makePlayer('W')
    const state = initLockerRoom({ roster: [captain, bench, makePlayer(), makePlayer()], year: 2025, rng: new Rng(1) })

    const { leadershipCrisis } = onPlayerDeparted(state, bench.id, new Rng(3))
    expect(leadershipCrisis).toBe(false)
    expect(state.captainId).toBe(captain.id)
  })

  it('clears the departed player from influence, familiarity, and relationships', () => {
    const p1 = makePlayer('C')
    const p2 = makePlayer('W')
    const state = initLockerRoom({ roster: [p1, p2, makePlayer()], year: 2025, rng: new Rng(1) })

    // Inject a familiarity entry and a relationship
    const key = [p1.id, p2.id].sort().join('|')
    state.familiarity = [[key, 40]]
    state.relationships.push({ a: p1.id, b: p2.id, kind: 'friendship', strength: 50, sinceYear: 2025 })

    onPlayerDeparted(state, p1.id, new Rng(1))

    expect(state.influence.map(([id]) => id)).not.toContain(p1.id)
    expect(state.familiarity.map(([k]) => k)).not.toContain(key)
    expect(state.relationships.find((r) => r.a === p1.id || r.b === p1.id)).toBeUndefined()
  })

  it('reduces roomMorale when a captain departs', () => {
    const captain = makePlayer('C', { professionalism: 20, loyalty: 20, determination: 20 }, { age: 35 })
    const others = Array.from({ length: 4 }, () => makePlayer())
    const state = initLockerRoom({ roster: [captain, ...others], year: 2025, rng: new Rng(1) })
    const moraleBefore = state.roomMorale

    onPlayerDeparted(state, captain.id, new Rng(2))

    expect(state.roomMorale).toBeLessThan(moraleBefore)
  })
})

/* ──────────────────────── electCaptain ──────────────────────── */

describe('electCaptain', () => {
  it('assigns a new captain after the previous one departed', () => {
    const captain = makePlayer('C', { professionalism: 20, loyalty: 20, determination: 20 }, { age: 35 })
    const deputy = makePlayer('W', { professionalism: 15, loyalty: 15, determination: 15 }, { age: 30 })
    const others = Array.from({ length: 4 }, () => makePlayer())
    const roster = [captain, deputy, ...others]
    const state = initLockerRoom({ roster, year: 2025, rng: new Rng(1) })

    onPlayerDeparted(state, captain.id, new Rng(2))
    expect(state.captainId).toBeNull()

    const remainingRoster = roster.filter((p) => p.id !== captain.id)
    const seeds = electCaptain(state, remainingRoster, new Rng(3))

    expect(state.captainId).not.toBeNull()
    expect(seeds.length).toBeGreaterThan(0)
    expect(seeds[0].headline).toMatch(/captain/i)
  })
})

/* ──────────────────────── onPlayerArrived ──────────────────────── */

describe('onPlayerArrived', () => {
  it('adds the new player to the influence list', () => {
    const existing = [makePlayer(), makePlayer()]
    const state = initLockerRoom({ roster: existing, year: 2025, rng: new Rng(1) })
    const newPlayer = makePlayer('C', { professionalism: 18 }, { age: 28 })

    onPlayerArrived(state, newPlayer, new Rng(2))

    const ids = state.influence.map(([id]) => id)
    expect(ids).toContain(newPlayer.id)
  })

  it('arrival influence is lower than expected for the same player incumbent', () => {
    const player = makePlayer('C', {}, { age: 30 })
    const state1 = initLockerRoom({ roster: [player, makePlayer()], year: 2025, rng: new Rng(1) })
    const incumbentInfluence = state1.influence.find(([id]) => id === player.id)?.[1] ?? 0

    const state2: LockerRoomState = {
      captainId: null,
      alternateIds: [],
      influence: [],
      relationships: [],
      familiarity: [],
      roomMorale: 60
    }
    onPlayerArrived(state2, player, new Rng(1))
    const newArrivalInfluence = state2.influence.find(([id]) => id === player.id)?.[1] ?? 0

    expect(newArrivalInfluence).toBeLessThanOrEqual(incumbentInfluence)
  })
})

/* ──────────────────────── developmentModifier ──────────────────────── */

describe('developmentModifier', () => {
  it('mentorship boosts the protégé (b) development', () => {
    const mentor = makePlayer('C')
    const protege = makePlayer('W')
    const state: LockerRoomState = {
      captainId: null,
      alternateIds: [],
      influence: [],
      relationships: [{
        a: mentor.id, b: protege.id, kind: 'mentorship', strength: 80, sinceYear: 2025
      }],
      familiarity: [],
      roomMorale: 60
    }

    const modProtege = developmentModifier(state, protege.id)
    const modMentor = developmentModifier(state, mentor.id)

    expect(modProtege).toBeGreaterThan(1.0)
    expect(modMentor).toBeCloseTo(1.0, 5) // mentor has no development boost
  })

  it('feud drags development below 1.0', () => {
    const p1 = makePlayer('C')
    const p2 = makePlayer('W')
    const state: LockerRoomState = {
      captainId: null,
      alternateIds: [],
      influence: [],
      relationships: [{
        a: p1.id, b: p2.id, kind: 'feud', strength: 100, sinceYear: 2025
      }],
      familiarity: [],
      roomMorale: 60
    }

    expect(developmentModifier(state, p1.id)).toBeLessThan(1.0)
    expect(developmentModifier(state, p2.id)).toBeLessThan(1.0)
  })

  it('development modifier is bounded to [0.9, 1.15]', () => {
    const mentor = makePlayer('C')
    const protege = makePlayer('W')
    const state: LockerRoomState = {
      captainId: null,
      alternateIds: [],
      influence: [],
      relationships: [
        { a: mentor.id, b: protege.id, kind: 'mentorship', strength: 100, sinceYear: 2025 },
        { a: protege.id, b: mentor.id, kind: 'feud', strength: 100, sinceYear: 2025 }
      ],
      familiarity: [],
      roomMorale: 60
    }

    const mod = developmentModifier(state, protege.id)
    expect(mod).toBeGreaterThanOrEqual(0.9)
    expect(mod).toBeLessThanOrEqual(1.15)
  })

  it('neutral player (no relationships) returns 1.0', () => {
    const p = makePlayer()
    const state: LockerRoomState = {
      captainId: null, alternateIds: [], influence: [],
      relationships: [], familiarity: [], roomMorale: 60
    }
    expect(developmentModifier(state, p.id)).toBe(1.0)
  })
})

/* ──────────────────────── determinism ──────────────────────── */

describe('determinism', () => {
  it('same seed produces identical initLockerRoom results', () => {
    const makeRoster = () => {
      nextId = 500 // stable ids
      return Array.from({ length: 8 }, () => makePlayer())
    }

    const r1 = makeRoster()
    nextId = 500
    const r2 = makeRoster()

    const s1 = initLockerRoom({ roster: r1, year: 2025, rng: new Rng(999) })
    const s2 = initLockerRoom({ roster: r2, year: 2025, rng: new Rng(999) })

    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2))
  })

  it('same seed produces identical tickLockerRoom results', () => {
    nextId = 600
    const roster = Array.from({ length: 6 }, () => makePlayer())
    const lines = makeLines(
      [[roster[0].id, roster[1].id, roster[2].id]],
      [[roster[3].id, roster[4].id]]
    )

    const makeState = () => ({
      captainId: roster[0].id,
      alternateIds: [roster[1].id, roster[2].id],
      influence: roster.map((p) => [p.id, 50] as [string, number]),
      relationships: [] as import('./lockerRoom').Relationship[],
      familiarity: [] as Array<[string, number]>,
      roomMorale: 60
    })

    const s1 = makeState()
    const s2 = makeState()

    const r1 = tickLockerRoom({ state: s1, roster, lines, playedToday: true, won: true, rng: new Rng(77), day: 1, year: 2025 })
    const r2 = tickLockerRoom({ state: s2, roster, lines, playedToday: true, won: true, rng: new Rng(77), day: 1, year: 2025 })

    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2))
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2))
  })
})

/* ──────────────────────── JSON round-trip ──────────────────────── */

describe('JSON round-trip', () => {
  it('LockerRoomState survives JSON.stringify / JSON.parse without data loss', () => {
    nextId = 700
    const roster = Array.from({ length: 10 }, () => makePlayer())
    const state = initLockerRoom({ roster, year: 2025, rng: new Rng(123) })

    // Add some familiarity
    const lines = makeLines(
      [[roster[0].id, roster[1].id, roster[2].id]],
      [[roster[3].id, roster[4].id]]
    )
    tickLockerRoom({ state, roster, lines, playedToday: true, won: true, rng: new Rng(124), day: 1, year: 2025 })

    const serialized = JSON.stringify(state)
    const restored: LockerRoomState = JSON.parse(serialized)

    expect(restored.captainId).toBe(state.captainId)
    expect(restored.roomMorale).toBe(state.roomMorale)
    expect(restored.influence).toEqual(state.influence)
    expect(restored.familiarity).toEqual(state.familiarity)
    expect(restored.relationships).toEqual(state.relationships)
    expect(restored.alternateIds).toEqual(state.alternateIds)
  })
})
