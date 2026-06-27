import { describe, it, expect } from 'vitest'
import {
  createGMState,
  recordSeasonResult,
  reputationTier,
  endStint,
  startStint,
  currentStint,
  buildGMJobMarket,
} from './gmCareer'

describe('gmCareer — reputation', () => {
  it('starts unproven and rises with a Cup', () => {
    const gm = createGMState('Alex Mercer', 2025, 't1', 'TOR', 'Toronto')
    expect(gm.reputation).toBe(45)
    recordSeasonResult(gm, { wins: 55, losses: 27, madePlayoffs: true, wonCup: true, wonPresidents: false, finalRank: 2, n: 32 })
    expect(gm.reputation).toBeGreaterThan(45)
    expect(gm.cupWins).toBe(1)
    expect(gm.seasons).toBe(1)
    expect(currentStint(gm)!.wins).toBe(55)
  })

  it('falls when missing the playoffs and bottom-feeding', () => {
    const gm = createGMState('Sam Vpoor', 2025, 't1', 'X', 'X')
    const before = gm.reputation
    recordSeasonResult(gm, { wins: 20, losses: 62, madePlayoffs: false, wonCup: false, wonPresidents: false, finalRank: 31, n: 32 })
    expect(gm.reputation).toBeLessThan(before)
  })

  it('maps reputation to tiers', () => {
    expect(reputationTier(10)).toBe('Unproven')
    expect(reputationTier(45)).toBe('Journeyman')
    expect(reputationTier(55)).toBe('Respected')
    expect(reputationTier(70)).toBe('Established')
    expect(reputationTier(85)).toBe('Elite')
    expect(reputationTier(95)).toBe('Legendary')
  })

  it('clamps to [0,100] over a long bad run', () => {
    const gm = createGMState('Doomed', 2025, 't1', 'X', 'X')
    for (let i = 0; i < 40; i++) {
      recordSeasonResult(gm, { wins: 15, losses: 67, madePlayoffs: false, wonCup: false, wonPresidents: false, finalRank: 32, n: 32 })
    }
    expect(gm.reputation).toBeGreaterThanOrEqual(0)
    expect(gm.reputation).toBeLessThanOrEqual(100)
  })
})

describe('gmCareer — stints', () => {
  it('closes and opens stints on a move', () => {
    const gm = createGMState('Mover', 2025, 't1', 'A', 'Aces')
    endStint(gm, 2027, 'fired')
    expect(currentStint(gm)).toBeUndefined()
    expect(gm.stints[0]!.toYear).toBe(2027)
    expect(gm.stints[0]!.endReason).toBe('fired')
    startStint(gm, 2027, 't2', 'B', 'Bears')
    expect(currentStint(gm)!.teamAbbr).toBe('B')
  })
})

describe('gmCareer — job market', () => {
  const openings = [
    { teamId: 'elite', teamName: 'Elite', teamAbbr: 'EL', marketSize: 3, projectedRank: 2 },
    { teamId: 'weak', teamName: 'Weak', teamAbbr: 'WK', marketSize: 1, projectedRank: 30 },
    { teamId: 'self', teamName: 'Self', teamAbbr: 'ME', marketSize: 2, projectedRank: 10 },
  ]

  it('excludes the user club and sorts by stature', () => {
    const m = buildGMJobMarket({ openings, userTeamId: 'self', reputation: 60, n: 32 })
    expect(m.find((o) => o.teamId === 'self')).toBeUndefined()
    expect(m[0]!.teamId).toBe('elite') // best projected rank first
  })

  it('elite clubs court a strong reputation but snub a weak one', () => {
    const strong = buildGMJobMarket({ openings, userTeamId: 'self', reputation: 80, n: 32 })
    const weakRep = buildGMJobMarket({ openings, userTeamId: 'self', reputation: 30, n: 32 })
    expect(strong.find((o) => o.teamId === 'elite')!.interest).toBe('courting')
    expect(weakRep.find((o) => o.teamId === 'elite')!.interest).toBe('longshot')
    // A rebuilder is reachable even for a modest reputation.
    expect(weakRep.find((o) => o.teamId === 'weak')!.interest).not.toBe('courting')
  })
})
