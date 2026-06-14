import { describe, expect, it } from 'vitest'
import {
  asPlayerId,
  type Player,
  type PlayerId,
  type PlayerRole,
  type Position,
  type RawAttributes,
} from '@domain'
import { computeComposites, overall } from '@engine/ratings/composites'
import { Rng } from '@engine/shared/rng'
import { tickInSeasonDevelopment } from './inSeasonDevelopment'

/* ── fixtures (mirror offseason.test.ts) ── */

function rawAll(v: number, goalie = false): RawAttributes {
  const raw: RawAttributes = {
    technical: { wristShot: v, slapShot: v, stickhandling: v, passing: v, deflections: v, faceoffs: v },
    physical: { speed: v, acceleration: v, strength: v, balance: v, stamina: v, agility: v, height: v },
    mental: { offensiveIQ: v, defensiveIQ: v, positioning: v, vision: v, aggression: v, composure: v, workRate: v, discipline: v, anticipation: v },
    defensive: { checking: v, shotBlocking: v, stickChecking: v, takeaway: v },
  }
  if (goalie) raw.goalie = { reflexes: v, positioningG: v, reboundControl: v, glove: v, blocker: v, recovery: v, puckHandlingG: v }
  return raw
}

interface Opts {
  id: string
  age: number
  current?: number
  potential?: number
  position?: Position
  personality?: number
}

function testPlayer(opts: Opts): Player {
  const position = opts.position ?? 'C'
  const current = opts.current ?? 50
  const ceiling = Math.max(current, opts.potential ?? current)
  const role: PlayerRole = position === 'G' ? 'starter' : position === 'D' ? 'shutdownD' : 'twoWay'
  const ratings = rawAll(current, position === 'G')
  const pers = opts.personality ?? 12
  return {
    id: asPlayerId(opts.id),
    name: `Test ${opts.id}`,
    age: opts.age,
    position,
    handedness: 'L',
    role,
    ratings,
    potential: rawAll(ceiling, position === 'G'),
    composites: computeComposites(ratings, role, position),
    personality: { ambition: pers, professionalism: pers, loyalty: pers, temperament: pers, determination: pers },
    contract: { salary: 1_000_000, yearsRemaining: 2, expiryYear: 2030, noTradeClause: false, twoWay: false },
    stats: [],
    fatigue: 30,
    morale: 60,
    injuryStatus: null,
    form: 0,
    basePotential: ceiling,
  }
}

function mapOf(...players: Player[]): Map<PlayerId, Player> {
  const m = new Map<PlayerId, Player>()
  for (const p of players) m.set(p.id, p)
  return m
}

/** Run `n` bi-weekly passes for a full set of players, all on active rosters. */
function runSeason(players: Map<PlayerId, Player>, seed: number, n = 12, gp = 50): void {
  const developIds = new Set<PlayerId>(players.keys())
  for (let i = 0; i < n; i++) {
    tickInSeasonDevelopment({
      players,
      developIds,
      gamesPlayedById: () => gp,
      rng: new Rng(seed + i * 31),
    })
  }
}

describe('tickInSeasonDevelopment', () => {
  it('grows a young player toward his potential across the season', () => {
    const p = testPlayer({ id: 'kid', age: 19, current: 55, potential: 85 })
    const players = mapOf(p)
    const before = overall(p.composites, p.position)
    runSeason(players, 1)
    const after = overall(p.composites, p.position)
    expect(after).toBeGreaterThan(before)
    // Trend arrow reflects season-to-date growth.
    expect(p.devTrend).toBeGreaterThan(0)
    expect(p.seasonDevAccrued).toBeGreaterThan(0)
  })

  it('caps in-season growth at the per-season budget (does not run away)', () => {
    const p = testPlayer({ id: 'kid', age: 18, current: 50, potential: 99 })
    const players = mapOf(p)
    const before = overall(p.composites, p.position)
    // Many extra passes must NOT keep growing without bound.
    runSeason(players, 2, 40)
    const gained = overall(p.composites, p.position) - before
    // Budget for an 18yo with a 10+ gap is ~2.2 overall; allow jitter overshoot.
    expect(gained).toBeGreaterThan(0)
    expect(gained).toBeLessThanOrEqual(5)
  })

  it('does not develop prime-age players in-season (plateau)', () => {
    const p = testPlayer({ id: 'prime', age: 27, current: 70, potential: 90 })
    const players = mapOf(p)
    const before = overall(p.composites, p.position)
    runSeason(players, 3, 20)
    expect(overall(p.composites, p.position)).toBe(before)
    expect(p.seasonDevAccrued ?? 0).toBe(0)
  })

  it('erodes a veteran slightly in-season (down arrow)', () => {
    const p = testPlayer({ id: 'vet', age: 35, current: 80, potential: 80 })
    const players = mapOf(p)
    const before = overall(p.composites, p.position)
    runSeason(players, 4, 20)
    const after = overall(p.composites, p.position)
    expect(after).toBeLessThan(before)
    expect(p.devTrend).toBeLessThan(0)
  })

  it('only develops players in the developIds set', () => {
    const onRoster = testPlayer({ id: 'a', age: 19, current: 55, potential: 85 })
    const offRoster = testPlayer({ id: 'b', age: 19, current: 55, potential: 85 })
    const players = mapOf(onRoster, offRoster)
    const beforeB = overall(offRoster.composites, offRoster.position)
    const developIds = new Set<PlayerId>([onRoster.id])
    for (let i = 0; i < 10; i++) {
      tickInSeasonDevelopment({ players, developIds, gamesPlayedById: () => 50, rng: new Rng(5 + i) })
    }
    expect(overall(onRoster.composites, onRoster.position)).toBeGreaterThan(55)
    expect(overall(offRoster.composites, offRoster.position)).toBe(beforeB)
  })

  it('develops a player who plays more faster than a scratch', () => {
    const player = testPlayer({ id: 'p', age: 19, current: 55, potential: 85 })
    const scratch = testPlayer({ id: 's', age: 19, current: 55, potential: 85 })
    const pMap = mapOf(player)
    const sMap = mapOf(scratch)
    for (let i = 0; i < 12; i++) {
      tickInSeasonDevelopment({ players: pMap, developIds: new Set([player.id]), gamesPlayedById: () => 60, rng: new Rng(7 + i) })
      tickInSeasonDevelopment({ players: sMap, developIds: new Set([scratch.id]), gamesPlayedById: () => 0, rng: new Rng(7 + i) })
    }
    const playerGain = overall(player.composites, player.position) - 55
    const scratchGain = overall(scratch.composites, scratch.position) - 55
    expect(playerGain).toBeGreaterThan(scratchGain)
  })

  it('is deterministic for the same seed', () => {
    const a = testPlayer({ id: 'x', age: 20, current: 60, potential: 88 })
    const b = testPlayer({ id: 'x', age: 20, current: 60, potential: 88 })
    runSeason(mapOf(a), 99)
    runSeason(mapOf(b), 99)
    expect(overall(a.composites, a.position)).toBe(overall(b.composites, b.position))
    expect(a.seasonDevAccrued).toBe(b.seasonDevAccrued)
  })
})
