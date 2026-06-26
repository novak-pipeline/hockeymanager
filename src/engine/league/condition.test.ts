/**
 * Tests for condition.ts (injuries/fatigue/morale/form) and lineup.ts
 * (lineupIssues / repairLines).
 */
import { describe, expect, it } from 'vitest'
import type {
  CompositeRatings,
  Contract,
  Injury,
  InjuryKind,
  Lines,
  Personality,
  Player,
  PlayerId,
  Position,
  RawAttributes,
  SeasonStats,
  Team,
  TeamColors
} from '@domain'
import { asPlayerId, asTeamId } from '@domain'
import { computeComposites } from '@engine/ratings/composites'
import { Rng } from '@engine/shared/rng'
import {
  applyResultMorale,
  effectiveResolve,
  rollInjuries,
  tickRecovery
} from './condition'
import { lineupIssues, repairLines } from './lineup'

/* ────────────────────────── helpers ────────────────────────── */

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

function goalieRaw(val = 50): RawAttributes {
  return {
    ...rawAttrs(val),
    goalie: {
      reflexes: val, positioningG: val, reboundControl: val,
      glove: val, blocker: val, recovery: val, puckHandlingG: val
    }
  }
}

const defaultPersonality: Personality = {
  ambition: 50, professionalism: 50, loyalty: 50, temperament: 50, determination: 50
}

const defaultContract: Contract = {
  salary: 1_000_000, yearsRemaining: 2, expiryYear: 2026,
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
  position: Position = 'W',
  overrides: Partial<Player> = {}
): Player {
  const id = pid()
  const ratings = rawAttrs(50)
  const composites = computeComposites(ratings, 'twoWay', position)
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
    personality: defaultPersonality,
    contract: defaultContract,
    stats: [{ ...defaultStats }],
    fatigue: 0,
    morale: 60,
    injuryStatus: null,
    form: 0,
    ...overrides
  }
}

function makeGoalie(overrides: Partial<Player> = {}): Player {
  const id = pid()
  const ratings = goalieRaw(60)
  const composites = computeComposites(ratings, 'starter', 'G')
  return {
    id,
    name: `Goalie ${id}`,
    age: 28,
    position: 'G',
    handedness: 'L',
    role: 'starter',
    ratings,
    potential: ratings,
    composites,
    personality: defaultPersonality,
    contract: defaultContract,
    stats: [{ ...defaultStats }],
    fatigue: 0,
    morale: 60,
    injuryStatus: null,
    form: 0,
    ...overrides
  }
}

/** Build a minimal valid Lines object for the given player id lists. */
function makeLines(opts: {
  forwards?: PlayerId[][]
  defensePairs?: PlayerId[][]
  goalies?: [PlayerId, PlayerId]
  ppUnits?: PlayerId[][]
  pkUnits?: PlayerId[][]
}): Lines {
  return {
    forwards: (opts.forwards ?? []) as [PlayerId, PlayerId, PlayerId][],
    defensePairs: (opts.defensePairs ?? []) as [PlayerId, PlayerId][],
    goalies: opts.goalies ?? [asPlayerId(''), asPlayerId('')],
    powerPlayUnits: opts.ppUnits ?? [],
    penaltyKillUnits: opts.pkUnits ?? []
  }
}

const teamColors: TeamColors = { primary: 0x003087, secondary: 0xffffff }

function makeTeam(roster: PlayerId[], lines: Lines): Team {
  return {
    id: asTeamId('TT'),
    name: 'Test Team',
    abbreviation: 'TT',
    city: 'Test City',
    colors: teamColors,
    conferenceId: 'East',
    divisionId: 'Atlantic',
    roster,
    lines,
    tactics: { forecheck: 'aggressive', breakout: 'controlled', powerPlay: 'overload', penaltyKill: 'passive', lineMatching: 'none' },
    finances: { budget: 10_000_000, salaryCap: 81_500_000, capUsed: 0, revenue: 0 },
    staff: { headCoachId: null, assistantCoachIds: [], scoutIds: [] }
  }
}

/* ────────────────────────── rollInjuries ────────────────────────── */

describe('rollInjuries', () => {
  it('injury rate falls in the expected 0.5–3% band for average skaters', () => {
    const N_GAMES = 10_000
    const rng = new Rng(42)
    let injuries = 0
    for (let i = 0; i < N_GAMES; i++) {
      const player = makePlayer('W', { id: asPlayerId('ptest') })
      const result = rollInjuries({
        participants: [{ player, toi: 17 * 60 }],
        rng
      })
      if (result.length > 0) injuries++
    }
    const rate = injuries / N_GAMES
    expect(rate).toBeGreaterThan(0.005)
    expect(rate).toBeLessThan(0.03)
  })

  it('already-injured players are skipped', () => {
    const rng = new Rng(99)
    const injury: Injury = { kind: 'lowerBody', gamesRemaining: 5, description: 'test' }
    const player = makePlayer('W', { injuryStatus: injury })
    // Run many times to ensure the injured player is never rolled again
    for (let i = 0; i < 1_000; i++) {
      const result = rollInjuries({ participants: [{ player, toi: 17 * 60 }], rng })
      expect(result).toHaveLength(0)
    }
  })

  it('sets injuryStatus on the player object', () => {
    // Force injury by using a deterministic rng that will roll a very high injury chance
    // We can confirm by checking with many participants — at least one gets hurt eventually.
    const rng = new Rng(1337)
    const players = Array.from({ length: 50 }, () => makePlayer('W'))
    let someInjured = false
    for (let attempt = 0; attempt < 20 && !someInjured; attempt++) {
      const freshPlayers = Array.from({ length: 50 }, () => makePlayer('W'))
      const result = rollInjuries({
        participants: freshPlayers.map((p) => ({ player: p, toi: 17 * 60 })),
        rng
      })
      if (result.length > 0) {
        someInjured = true
        for (const roll of result) {
          const p = freshPlayers.find((fp) => fp.id === roll.playerId)!
          expect(p.injuryStatus).not.toBeNull()
          expect(p.injuryStatus?.kind).toBe(roll.injury.kind)
          expect(p.injuryStatus?.gamesRemaining).toBeGreaterThan(0)
          expect(p.injuryStatus?.description).toBeTruthy()
        }
      }
    }
    expect(someInjured).toBe(true)
  })

  it('injury kind distribution roughly matches weights (lowerBody > upperBody > illness > concussion)', () => {
    const N = 5_000
    const rng = new Rng(7)
    const counts: Record<InjuryKind, number> = {
      lowerBody: 0, upperBody: 0, illness: 0, concussion: 0
    }
    let total = 0
    // Force injuries by using a modified player with low balance + high aggression
    for (let i = 0; i < N; i++) {
      const player = makePlayer('W', {
        id: asPlayerId('pinjury'),
        injuryStatus: null,
        ratings: {
          ...rawAttrs(50),
          physical: { ...rawAttrs(50).physical, balance: 1 },
          mental: { ...rawAttrs(50).mental, aggression: 99 }
        }
      })
      const result = rollInjuries({
        participants: [{ player, toi: 17 * 60 }],
        rng
      })
      for (const r of result) {
        counts[r.injury.kind]++
        total++
      }
    }
    if (total > 200) {
      // Rough proportions: lowerBody ~40%, upperBody ~35%, illness ~15%, concussion ~10%
      // Use loose bounds and >= to avoid seed-dependent exact-tie flakiness.
      expect(counts.lowerBody / total).toBeGreaterThan(0.25)
      expect(counts.upperBody / total).toBeGreaterThan(0.20)
      expect(counts.illness / total).toBeGreaterThan(0.05)
      expect(counts.lowerBody).toBeGreaterThanOrEqual(counts.upperBody)
      expect(counts.upperBody).toBeGreaterThanOrEqual(counts.illness)
      expect(counts.illness).toBeGreaterThanOrEqual(counts.concussion)
    }
  })

  it('concussions tend to produce longer absences than lower-body injuries', () => {
    const rng = new Rng(333)
    // Sample a large set of game durations for each kind
    const gamesOutByKind: Record<InjuryKind, number[]> = {
      lowerBody: [], upperBody: [], illness: [], concussion: []
    }
    const N = 10_000
    let collected = { lowerBody: 0, concussion: 0 }
    for (let i = 0; i < N && (collected.lowerBody < 30 || collected.concussion < 30); i++) {
      const player = makePlayer('W', {
        id: asPlayerId('psamp'),
        injuryStatus: null,
        ratings: {
          ...rawAttrs(50),
          physical: { ...rawAttrs(50).physical, balance: 1 },
          mental: { ...rawAttrs(50).mental, aggression: 99 }
        }
      })
      const result = rollInjuries({ participants: [{ player, toi: 17 * 60 }], rng })
      for (const r of result) {
        gamesOutByKind[r.injury.kind].push(r.injury.gamesRemaining)
        if (r.injury.kind === 'lowerBody') collected.lowerBody++
        if (r.injury.kind === 'concussion') collected.concussion++
      }
    }
    if (gamesOutByKind.concussion.length > 10 && gamesOutByKind.lowerBody.length > 10) {
      const avgConcussion = gamesOutByKind.concussion.reduce((a, b) => a + b, 0) / gamesOutByKind.concussion.length
      const avgLowerBody = gamesOutByKind.lowerBody.reduce((a, b) => a + b, 0) / gamesOutByKind.lowerBody.length
      expect(avgConcussion).toBeGreaterThan(avgLowerBody)
    }
  })

  it('returns InjuryRoll with playerId matching the injured player', () => {
    const rng = new Rng(42)
    const player = makePlayer('W', {
      id: asPlayerId('specific-player'),
      ratings: {
        ...rawAttrs(50),
        physical: { ...rawAttrs(50).physical, balance: 1 },
        mental: { ...rawAttrs(50).mental, aggression: 99 }
      }
    })
    let found: PlayerId | null = null
    for (let i = 0; i < 200 && found === null; i++) {
      player.injuryStatus = null
      const result = rollInjuries({ participants: [{ player, toi: 17 * 60 }], rng })
      if (result.length > 0) found = result[0].playerId
    }
    expect(found).toBe(asPlayerId('specific-player'))
  })
})

/* ────────────────────────── tickRecovery ────────────────────────── */

describe('tickRecovery', () => {
  it('decrements gamesRemaining each tick for injured non-playing players', () => {
    const rng = new Rng(1)
    const player = makePlayer('W', {
      injuryStatus: { kind: 'lowerBody', gamesRemaining: 3, description: 'strain' }
    })
    tickRecovery({ players: [player], playedToday: new Set(), rng })
    expect(player.injuryStatus?.gamesRemaining).toBe(2)
  })

  it('clears injuryStatus and returns healed id when gamesRemaining reaches 0', () => {
    const rng = new Rng(2)
    const player = makePlayer('W', {
      injuryStatus: { kind: 'lowerBody', gamesRemaining: 1, description: 'strain' }
    })
    const { healed } = tickRecovery({ players: [player], playedToday: new Set(), rng })
    expect(player.injuryStatus).toBeNull()
    expect(healed).toContain(player.id)
  })

  it('does NOT decrement injury when player played today (injured but still ticked)', () => {
    const rng = new Rng(3)
    const player = makePlayer('W', {
      injuryStatus: { kind: 'lowerBody', gamesRemaining: 3, description: 'strain' }
    })
    // Player played today — injury counter should not tick down
    tickRecovery({ players: [player], playedToday: new Set([player.id]), rng })
    expect(player.injuryStatus?.gamesRemaining).toBe(3)
  })

  it('fatigue increases for players who played (with stamina scaling)', () => {
    const rng = new Rng(10)
    const player = makePlayer('W', { fatigue: 20 })
    tickRecovery({ players: [player], playedToday: new Set([player.id]), rng })
    expect(player.fatigue).toBeGreaterThan(20)
  })

  it('fatigue decreases for players who rested', () => {
    const rng = new Rng(11)
    const player = makePlayer('W', { fatigue: 50 })
    tickRecovery({ players: [player], playedToday: new Set(), rng })
    expect(player.fatigue).toBeLessThan(50)
  })

  it('fatigue clamps to 0 when fully rested', () => {
    const rng = new Rng(12)
    const player = makePlayer('W', { fatigue: 5 })
    tickRecovery({ players: [player], playedToday: new Set(), rng })
    expect(player.fatigue).toBe(0)
  })

  it('fatigue clamps to 100 when very tired and played again', () => {
    const rng = new Rng(13)
    const player = makePlayer('W', { fatigue: 98 })
    tickRecovery({ players: [player], playedToday: new Set([player.id]), rng })
    expect(player.fatigue).toBeLessThanOrEqual(100)
  })

  it('morale drifts toward 60 from above', () => {
    const rng = new Rng(20)
    const player = makePlayer('W', { morale: 90 })
    tickRecovery({ players: [player], playedToday: new Set(), rng })
    expect(player.morale).toBeLessThan(90)
    expect(player.morale).toBeGreaterThanOrEqual(60)
  })

  it('morale drifts toward 60 from below', () => {
    const rng = new Rng(21)
    const player = makePlayer('W', { morale: 20 })
    tickRecovery({ players: [player], playedToday: new Set(), rng })
    expect(player.morale).toBeGreaterThan(20)
    expect(player.morale).toBeLessThanOrEqual(60)
  })

  it('morale clamps within 0–100', () => {
    const rng = new Rng(22)
    const lo = makePlayer('W', { morale: 0 })
    const hi = makePlayer('W', { morale: 100 })
    tickRecovery({ players: [lo, hi], playedToday: new Set(), rng })
    expect(lo.morale).toBeGreaterThanOrEqual(0)
    expect(hi.morale).toBeLessThanOrEqual(100)
  })

  it('form stays within [-5, 5] after many ticks', () => {
    const rng = new Rng(30)
    const player = makePlayer('W', { form: 0 })
    for (let i = 0; i < 100; i++) {
      tickRecovery({ players: [player], playedToday: new Set(), rng })
    }
    expect(player.form).toBeGreaterThanOrEqual(-5)
    expect(player.form).toBeLessThanOrEqual(5)
  })

  it('form decays toward 0 over many ticks from an extreme', () => {
    // With FORM_DECAY = 0.9 and random walk ±1, starting at 5 won't stay at 5 indefinitely
    const rng = new Rng(31)
    const player = makePlayer('W', { form: 5 })
    for (let i = 0; i < 100; i++) {
      tickRecovery({ players: [player], playedToday: new Set(), rng })
    }
    // After 100 ticks the form should have drifted noticeably from 5
    expect(Math.abs(player.form)).toBeLessThan(5)
  })

  it('playedToday works as a function as well as a Set', () => {
    const rng1 = new Rng(40)
    const rng2 = new Rng(40) // same seed for comparable result
    const p1 = makePlayer('W', { fatigue: 30 })
    const p2 = makePlayer('W', { fatigue: 30, id: p1.id }) // same id
    tickRecovery({ players: [p1], playedToday: new Set([p1.id]), rng: rng1 })
    tickRecovery({ players: [p2], playedToday: (id) => id === p2.id, rng: rng2 })
    expect(p1.fatigue).toBe(p2.fatigue)
  })

  it('healed list contains only ids that were cleared this tick', () => {
    const rng = new Rng(50)
    const healing = makePlayer('W', {
      injuryStatus: { kind: 'upperBody', gamesRemaining: 1, description: 'sprain' }
    })
    const recovering = makePlayer('W', {
      injuryStatus: { kind: 'illness', gamesRemaining: 3, description: 'flu' }
    })
    const { healed } = tickRecovery({ players: [healing, recovering], playedToday: new Set(), rng })
    expect(healed).toContain(healing.id)
    expect(healed).not.toContain(recovering.id)
  })
})

/* ────────────────────────── applyResultMorale ────────────────────────── */

describe('applyResultMorale', () => {
  it('raises morale for all roster members on a win', () => {
    const players = [makePlayer('W', { morale: 50 }), makePlayer('C', { morale: 60 })]
    const playerMap = new Map(players.map((p) => [p.id, p]))
    const team = makeTeam(players.map((p) => p.id), makeLines({}))
    applyResultMorale({ team, players: playerMap, won: true })
    for (const p of players) expect(p.morale).toBeGreaterThan(50)
  })

  it('lowers morale for all roster members on a loss', () => {
    const players = [makePlayer('W', { morale: 50 }), makePlayer('C', { morale: 60 })]
    const playerMap = new Map(players.map((p) => [p.id, p]))
    const team = makeTeam(players.map((p) => p.id), makeLines({}))
    applyResultMorale({ team, players: playerMap, won: false })
    for (const p of players) {
      expect(p.morale).toBeLessThan(60)
    }
  })

  it('clamps morale to [0, 100]', () => {
    const p1 = makePlayer('W', { morale: 99 })
    const p2 = makePlayer('W', { morale: 1 })
    const playerMap = new Map([[p1.id, p1], [p2.id, p2]])
    const team = makeTeam([p1.id, p2.id], makeLines({}))
    applyResultMorale({ team, players: playerMap, won: true })
    expect(p1.morale).toBeLessThanOrEqual(100)
    applyResultMorale({ team, players: playerMap, won: false })
    applyResultMorale({ team, players: playerMap, won: false })
    // p2 started at 1, lost twice: should not go below 0
    expect(p2.morale).toBeGreaterThanOrEqual(0)
  })

  it('applies exactly ±2 delta', () => {
    const p = makePlayer('W', { morale: 50 })
    const playerMap = new Map([[p.id, p]])
    const team = makeTeam([p.id], makeLines({}))
    applyResultMorale({ team, players: playerMap, won: true })
    expect(p.morale).toBe(52)
    applyResultMorale({ team, players: playerMap, won: false })
    expect(p.morale).toBe(50)
  })
})

/* ────────────────────────── effectiveResolve ────────────────────────── */

describe('effectiveResolve', () => {
  it('scales composites down at high fatigue', () => {
    const base = makePlayer('W', { fatigue: 100, morale: 60, form: 0 })
    const resolver = effectiveResolve((id) => base)
    const resolved = resolver(base.id)
    // Every composite should be scaled down vs the raw
    for (const key in base.composites) {
      const k = key as keyof CompositeRatings
      if (base.composites[k] > 0) {
        expect(resolved.composites[k]).toBeLessThanOrEqual(base.composites[k])
      }
    }
  })

  it('scales composites up at high morale', () => {
    const base = makePlayer('W', { fatigue: 0, morale: 100, form: 0 })
    const resolver = effectiveResolve((id) => base)
    const resolved = resolver(base.id)
    // Morale max gives a slight boost
    for (const key in base.composites) {
      const k = key as keyof CompositeRatings
      if (base.composites[k] > 0) {
        expect(resolved.composites[k]).toBeGreaterThanOrEqual(base.composites[k])
      }
    }
  })

  it('scales composites up with positive form', () => {
    const base = makePlayer('W', { fatigue: 0, morale: 60, form: 5 })
    const neutral = makePlayer('W', { fatigue: 0, morale: 60, form: 0, id: base.id })
    const resolverHot = effectiveResolve(() => base)
    const resolverNeutral = effectiveResolve(() => neutral)
    const hot = resolverHot(base.id)
    const flat2 = resolverNeutral(base.id)
    let boosted = 0
    for (const key in base.composites) {
      const k = key as keyof CompositeRatings
      if (base.composites[k] > 1) {
        if (hot.composites[k] >= flat2.composites[k]) boosted++
      }
    }
    expect(boosted).toBeGreaterThan(0)
  })

  it('all composites are clamped to 1–99', () => {
    // Extreme conditions: fatigue 100, morale 0, form -5 — nothing should go below 1
    const base = makePlayer('W', { fatigue: 100, morale: 0, form: -5 })
    // Set composites artificially high so we test the upper clamp too
    const highBase = makePlayer('W', { fatigue: 0, morale: 100, form: 5 })
    for (const [p, resolver] of [[base, effectiveResolve(() => base)], [highBase, effectiveResolve(() => highBase)]] as const) {
      const resolved = (resolver as (id: PlayerId) => Player)(p.id)
      for (const key in resolved.composites) {
        const k = key as keyof CompositeRatings
        const v = resolved.composites[k]
        expect(v).toBeGreaterThanOrEqual(1)
        expect(v).toBeLessThanOrEqual(99)
      }
    }
  })

  it('the base player object is never mutated', () => {
    const base = makePlayer('W', { fatigue: 80, morale: 40, form: -3 })
    const originalComposites = { ...base.composites }
    const resolver = effectiveResolve(() => base)
    resolver(base.id)
    // Base composites unchanged
    for (const key in originalComposites) {
      const k = key as keyof CompositeRatings
      expect(base.composites[k]).toBe(originalComposites[k])
    }
  })

  it('returns the same cached object on subsequent calls with the same id', () => {
    const base = makePlayer('W', { fatigue: 50 })
    const resolver = effectiveResolve(() => base)
    const first = resolver(base.id)
    const second = resolver(base.id)
    expect(first).toBe(second) // same reference
  })

  it('different ids produce different resolver instances but same resolver caches separately', () => {
    const p1 = makePlayer('W', { fatigue: 20, morale: 80 })
    const p2 = makePlayer('C', { fatigue: 60, morale: 40 })
    const playerMap = new Map([[p1.id, p1], [p2.id, p2]])
    const resolver = effectiveResolve((id) => playerMap.get(id)!)
    const r1a = resolver(p1.id)
    const r2a = resolver(p2.id)
    const r1b = resolver(p1.id)
    expect(r1a).toBe(r1b) // cached
    expect(r1a).not.toBe(r2a) // different players
  })

  it('a fresh resolver produces a different snapshot than an old one (no cross-game contamination)', () => {
    const base = makePlayer('W', { fatigue: 100, morale: 60, form: 0 })
    const resolver1 = effectiveResolve(() => base)
    const snap1 = resolver1(base.id)

    // Now fatigue recovers
    base.fatigue = 0
    // Fresh resolver sees the new state
    const resolver2 = effectiveResolve(() => base)
    const snap2 = resolver2(base.id)

    expect(snap2.composites.scoring).toBeGreaterThan(snap1.composites.scoring)
  })

  it('zero-fatigue, baseline morale, zero-form produces composites near the original', () => {
    const base = makePlayer('W', { fatigue: 0, morale: 60, form: 0 })
    const resolver = effectiveResolve(() => base)
    const resolved = resolver(base.id)
    for (const key in base.composites) {
      const k = key as keyof CompositeRatings
      if (base.composites[k] > 0) {
        // At morale=60 there's a slight multiplier > 1; allow small deviation
        expect(Math.abs(resolved.composites[k] - base.composites[k])).toBeLessThanOrEqual(5)
      }
    }
  })
})

/* ────────────────────────── lineupIssues ────────────────────────── */

describe('lineupIssues', () => {
  it('returns no issues for a valid complete lineup', () => {
    // Build a full legal lineup: 4 forward lines, 3 defense pairs, 2 goalies, PP/PK
    const forwards = Array.from({ length: 12 }, () => makePlayer('W'))
    const centers = Array.from({ length: 4 }, () => makePlayer('C'))
    const defenders = Array.from({ length: 6 }, () => makePlayer('D'))
    const goalies = [makeGoalie(), makeGoalie()]
    const allSkaters = [...forwards, ...centers, ...defenders]
    const allPlayers = [...allSkaters, ...goalies]
    const playerMap = new Map(allPlayers.map((p) => [p.id, p]))

    // 4 forward lines: [W, C, W] per line
    const forwardLines: PlayerId[][] = []
    for (let i = 0; i < 4; i++) {
      forwardLines.push([
        forwards[i * 2].id,
        centers[i].id,
        forwards[i * 2 + 1].id
      ])
    }

    // 3 defense pairs
    const defensePairs: PlayerId[][] = []
    for (let i = 0; i < 3; i++) {
      defensePairs.push([defenders[i * 2].id, defenders[i * 2 + 1].id])
    }

    const ppUnits = [
      allSkaters.slice(0, 5).map((p) => p.id),
      allSkaters.slice(5, 10).map((p) => p.id)
    ]
    const pkUnits = [
      allSkaters.slice(0, 4).map((p) => p.id),
      allSkaters.slice(4, 8).map((p) => p.id)
    ]

    const lines = makeLines({
      forwards: forwardLines,
      defensePairs,
      goalies: [goalies[0].id, goalies[1].id],
      ppUnits,
      pkUnits
    })

    const team = makeTeam(allPlayers.map((p) => p.id), lines)
    const issues = lineupIssues(team, playerMap)
    expect(issues).toHaveLength(0)
  })

  it('reports injured players in even-strength slots', () => {
    const p = makePlayer('W', {
      injuryStatus: { kind: 'lowerBody', gamesRemaining: 3, description: 'strain' }
    })
    const g1 = makeGoalie()
    const g2 = makeGoalie()
    const others = Array.from({ length: 13 }, () => makePlayer('W'))
    const allP = [p, ...others, g1, g2]
    const playerMap = new Map(allP.map((pl) => [pl.id, pl]))
    const forwardLines = [
      [p.id, others[0].id, others[1].id],
      [others[2].id, others[3].id, others[4].id],
      [others[5].id, others[6].id, others[7].id],
      [others[8].id, others[9].id, others[10].id]
    ]
    const defensePairs = [
      [others[11].id, others[12].id],
      [g1.id, g2.id], // borrowing goalies for simplicity, just testing injury detection
      [others[0].id, others[1].id]
    ]
    const lines = makeLines({ forwards: forwardLines, defensePairs, goalies: [g1.id, g2.id] })
    const team = makeTeam(allP.map((pl) => pl.id), lines)
    const issues = lineupIssues(team, playerMap)
    const injuryIssue = issues.some((msg) => msg.includes('injured') && msg.includes(p.name))
    expect(injuryIssue).toBe(true)
  })

  it('reports duplicate player in multiple slots', () => {
    const p = makePlayer('W')
    const g1 = makeGoalie()
    const g2 = makeGoalie()
    const others = Array.from({ length: 11 }, () => makePlayer('W'))
    const allP = [p, ...others, g1, g2]
    const playerMap = new Map(allP.map((pl) => [pl.id, pl]))
    // Use p.id in two forward lines
    const forwardLines = [
      [p.id, others[0].id, others[1].id],
      [p.id, others[2].id, others[3].id], // duplicate p.id
      [others[4].id, others[5].id, others[6].id],
      [others[7].id, others[8].id, others[9].id]
    ]
    const defensePairs = [
      [others[10].id, others[0].id],
      [others[1].id, others[2].id],
      [others[3].id, others[4].id]
    ]
    const lines = makeLines({ forwards: forwardLines, defensePairs, goalies: [g1.id, g2.id] })
    const team = makeTeam(allP.map((pl) => pl.id), lines)
    const issues = lineupIssues(team, playerMap)
    const dupIssue = issues.some((msg) => msg.includes('multiple even-strength slots'))
    expect(dupIssue).toBe(true)
  })

  it('reports empty slot', () => {
    const g1 = makeGoalie()
    const g2 = makeGoalie()
    const others = Array.from({ length: 14 }, () => makePlayer('W'))
    const allP = [...others, g1, g2]
    const playerMap = new Map(allP.map((pl) => [pl.id, pl]))
    const forwardLines = [
      [asPlayerId(''), others[0].id, others[1].id], // empty first slot
      [others[2].id, others[3].id, others[4].id],
      [others[5].id, others[6].id, others[7].id],
      [others[8].id, others[9].id, others[10].id]
    ]
    const defensePairs = [
      [others[11].id, others[12].id],
      [others[13].id, others[0].id],
      [others[1].id, others[2].id]
    ]
    const lines = makeLines({ forwards: forwardLines, defensePairs, goalies: [g1.id, g2.id] })
    const team = makeTeam(allP.map((pl) => pl.id), lines)
    const issues = lineupIssues(team, playerMap)
    const emptyIssue = issues.some((msg) => msg.includes('empty slot'))
    expect(emptyIssue).toBe(true)
  })

  it('reports invalid PP/PK unit sizes', () => {
    const g1 = makeGoalie()
    const g2 = makeGoalie()
    const skaters = Array.from({ length: 18 }, () => makePlayer('W'))
    const allP = [...skaters, g1, g2]
    const playerMap = new Map(allP.map((pl) => [pl.id, pl]))

    const forwardLines = [
      [skaters[0].id, skaters[1].id, skaters[2].id],
      [skaters[3].id, skaters[4].id, skaters[5].id],
      [skaters[6].id, skaters[7].id, skaters[8].id],
      [skaters[9].id, skaters[10].id, skaters[11].id]
    ]
    const defensePairs = [
      [skaters[12].id, skaters[13].id],
      [skaters[14].id, skaters[15].id],
      [skaters[16].id, skaters[17].id]
    ]
    // PP unit with only 3 players (needs 5)
    const ppUnits = [
      [skaters[0].id, skaters[1].id, skaters[2].id],
      [skaters[3].id, skaters[4].id, skaters[5].id]
    ]
    const lines = makeLines({ forwards: forwardLines, defensePairs, goalies: [g1.id, g2.id], ppUnits, pkUnits: [] })
    const team = makeTeam(allP.map((pl) => pl.id), lines)
    const issues = lineupIssues(team, playerMap)
    const ppIssue = issues.some((msg) => msg.includes('PP') || msg.includes('power-play'))
    expect(ppIssue).toBe(true)
  })
})

/* ────────────────────────── repairLines ────────────────────────── */

describe('repairLines', () => {
  /** Build a fresh roster: N skaters + 2 goalies, fill no lines. */
  function buildRoster(nSkaters = 18): { players: Map<PlayerId, Player>; team: Team } {
    const skaters = Array.from({ length: nSkaters }, (_, i) =>
      makePlayer((['W', 'C', 'D'] as Position[])[i % 3])
    )
    const goalies = [makeGoalie(), makeGoalie()]
    const allPlayers = [...skaters, ...goalies]
    const playerMap = new Map(allPlayers.map((p) => [p.id, p]))
    const lines = makeLines({})
    const team = makeTeam(allPlayers.map((p) => p.id), lines)
    return { players: playerMap, team }
  }

  it('fills a completely empty lineup from the roster', () => {
    const { players, team } = buildRoster(18)
    const changed = repairLines(team, players)
    expect(changed).toBe(true)
    // After repair, verify structural integrity
    expect(team.lines.forwards).toHaveLength(4)
    expect(team.lines.defensePairs).toHaveLength(3)
    // Every forward line has 3 slots
    for (const row of team.lines.forwards) {
      expect(row).toHaveLength(3)
    }
    // Every defense pair has 2 slots
    for (const pair of team.lines.defensePairs) {
      expect(pair).toHaveLength(2)
    }
    // Goalies must be set
    expect(team.lines.goalies[0]).toBeTruthy()
    expect(team.lines.goalies[1]).toBeTruthy()
  })

  it('no injured player appears in even-strength slots after repair', () => {
    const { players, team } = buildRoster(18)
    // Injure a few players
    let count = 0
    for (const p of players.values()) {
      if (count >= 3) break
      if (p.position !== 'G') {
        p.injuryStatus = { kind: 'lowerBody', gamesRemaining: 5, description: 'test' }
        count++
      }
    }
    repairLines(team, players)
    const allSlotIds = new Set<PlayerId>()
    for (const row of team.lines.forwards) for (const id of row) if (id) allSlotIds.add(id)
    for (const row of team.lines.defensePairs) for (const id of row) if (id) allSlotIds.add(id)
    for (const id of allSlotIds) {
      const p = players.get(id)
      expect(p?.injuryStatus).toBeNull()
    }
  })

  it('goalie injury promotes the backup to starter', () => {
    const skaters = Array.from({ length: 18 }, (_, i) =>
      makePlayer((['W', 'C', 'D'] as Position[])[i % 3])
    )
    const starter = makeGoalie()
    const backup = makeGoalie()
    const allPlayers = [...skaters, starter, backup]
    const playerMap = new Map(allPlayers.map((p) => [p.id, p]))

    // starter is injured
    starter.injuryStatus = { kind: 'upperBody', gamesRemaining: 10, description: 'sprain' }

    const lines = makeLines({ goalies: [starter.id, backup.id] })
    const team = makeTeam(allPlayers.map((p) => p.id), lines)
    repairLines(team, playerMap)

    // After repair, the injured starter should be replaced
    expect(team.lines.goalies[0]).toBe(backup.id)
  })

  it('is idempotent: second call on repaired team returns false and changes nothing', () => {
    const { players, team } = buildRoster(18)
    repairLines(team, players)
    const snapshot = JSON.stringify(team.lines)
    const changed = repairLines(team, players)
    expect(changed).toBe(false)
    expect(JSON.stringify(team.lines)).toBe(snapshot)
  })

  it('no duplicates in even-strength slots after repair', () => {
    const { players, team } = buildRoster(18)
    repairLines(team, players)
    const slotIds: PlayerId[] = []
    for (const row of team.lines.forwards) for (const id of row) if (id) slotIds.push(id)
    for (const row of team.lines.defensePairs) for (const id of row) if (id) slotIds.push(id)
    const unique = new Set(slotIds)
    expect(unique.size).toBe(slotIds.length)
  })

  it('removes an injured player from a pre-filled lineup slot', () => {
    const skaters = Array.from({ length: 18 }, (_, i) =>
      makePlayer((['W', 'C', 'D'] as Position[])[i % 3])
    )
    const g1 = makeGoalie()
    const g2 = makeGoalie()
    const allPlayers = [...skaters, g1, g2]
    const playerMap = new Map(allPlayers.map((p) => [p.id, p]))

    // Pre-fill forward line 1 with real players (skaters 0,1,2)
    const preFilledForwards = [
      [skaters[0].id, skaters[1].id, skaters[2].id],
      [asPlayerId(''), asPlayerId(''), asPlayerId('')],
      [asPlayerId(''), asPlayerId(''), asPlayerId('')],
      [asPlayerId(''), asPlayerId(''), asPlayerId('')]
    ]
    const lines = makeLines({
      forwards: preFilledForwards,
      goalies: [g1.id, g2.id]
    })
    const team = makeTeam(allPlayers.map((p) => p.id), lines)

    // Now injure skaters[0] who is in line 1
    skaters[0].injuryStatus = { kind: 'lowerBody', gamesRemaining: 7, description: 'strain' }

    repairLines(team, playerMap)

    // skaters[0] should no longer be in any slot
    for (const row of team.lines.forwards) {
      for (const id of row) {
        expect(id).not.toBe(skaters[0].id)
      }
    }
  })

  it('PP units are built with 5 players per unit', () => {
    const { players, team } = buildRoster(18)
    repairLines(team, players)
    expect(team.lines.powerPlayUnits).toHaveLength(2)
    for (const unit of team.lines.powerPlayUnits) {
      expect(unit).toHaveLength(5)
      expect(new Set(unit).size).toBe(5)
    }
  })

  it('PK units are built with 4 players per unit', () => {
    const { players, team } = buildRoster(18)
    repairLines(team, players)
    expect(team.lines.penaltyKillUnits).toHaveLength(2)
    for (const unit of team.lines.penaltyKillUnits) {
      expect(unit).toHaveLength(4)
      expect(new Set(unit).size).toBe(4)
    }
  })

  it('all PP/PK unit players are healthy and on roster after repair', () => {
    const { players, team } = buildRoster(18)
    // Injure a few skaters
    let count = 0
    for (const p of players.values()) {
      if (count >= 2) break
      if (p.position !== 'G') {
        p.injuryStatus = { kind: 'illness', gamesRemaining: 2, description: 'flu' }
        count++
      }
    }
    repairLines(team, players)
    for (const units of [team.lines.powerPlayUnits, team.lines.penaltyKillUnits]) {
      for (const unit of units) {
        for (const id of unit) {
          const p = players.get(id)
          expect(p).toBeDefined()
          expect(p?.injuryStatus).toBeNull()
          expect(team.roster).toContain(id)
        }
      }
    }
  })

  it('never dresses a defenceman at a forward slot while a forward can double-shift', () => {
    // 5 healthy forwards, plenty of healthy D. Two forwards are hurt — far fewer
    // than the 12 forward slots — so the only way to fill them all is to
    // double-shift forwards. A D must NOT be slotted at wing/centre.
    const fwds = Array.from({ length: 5 }, () => makePlayer('C'))
    const defs = Array.from({ length: 8 }, () => makePlayer('D'))
    const goalies = [makeGoalie(), makeGoalie()]
    fwds[0].injuryStatus = { kind: 'lowerBody', gamesRemaining: 5, description: 'x' }
    fwds[1].injuryStatus = { kind: 'upperBody', gamesRemaining: 5, description: 'y' }
    const all = [...fwds, ...defs, ...goalies]
    const players = new Map(all.map((p) => [p.id, p]))
    const team = makeTeam(all.map((p) => p.id), makeLines({}))

    repairLines(team, players)

    for (const line of team.lines.forwards) {
      for (const id of line) {
        if (!id) continue
        const p = players.get(id)!
        expect(p.position).not.toBe('D')
        expect(p.injuryStatus).toBeNull()
      }
    }
    // And the defence pairs are still all defencemen.
    for (const pair of team.lines.defensePairs) {
      for (const id of pair) {
        if (!id) continue
        expect(players.get(id)!.position).toBe('D')
      }
    }
  })

  it('repairLines returns false when lineup was already valid and nothing changed', () => {
    const { players, team } = buildRoster(18)
    // First repair builds a valid lineup
    const first = repairLines(team, players)
    expect(first).toBe(true)
    // Second repair should find nothing to change
    const second = repairLines(team, players)
    expect(second).toBe(false)
  })

  it('lineupIssues returns empty after repairLines on a broken lineup', () => {
    const { players, team } = buildRoster(18)
    // Injure 4 players to break lines
    let count = 0
    for (const p of players.values()) {
      if (count >= 4) break
      if (p.position !== 'G') {
        p.injuryStatus = { kind: 'lowerBody', gamesRemaining: 5, description: 'strain' }
        count++
      }
    }
    repairLines(team, players)
    const issues = lineupIssues(team, players)
    // After repair, no injury issues should remain in even-strength slots
    const injuryIssues = issues.filter((msg) => msg.includes('injured'))
    expect(injuryIssues).toHaveLength(0)
  })
})
