import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { quickSimGame } from '@engine/quick/quickSim'
import type { Player, Team } from '@domain'
import { coachFitMultiplier } from './coachProfile'

describe('coachFitMultiplier', () => {
  it('is neutral (1.0) at the styleMatch baseline of 70', () => {
    expect(coachFitMultiplier(70)).toBeCloseTo(1, 6)
  })
  it('nudges up for a strong fit and down for a poor fit, capped at ±1.5%', () => {
    expect(coachFitMultiplier(100)).toBeCloseTo(1.015, 6)
    expect(coachFitMultiplier(40)).toBeCloseTo(0.985, 6)
    expect(coachFitMultiplier(0)).toBeCloseTo(0.985, 6) // clamped
    expect(coachFitMultiplier(100) > coachFitMultiplier(40)).toBe(true)
  })
})

describe('coach-fit affects the sim', () => {
  function teamsFor(seed: number): { home: Team; away: Team; resolve: (id: Player['id']) => Player } {
    const { players, teams, league } = generateLeague({ seed })
    const home = teams.get(league.teams[0]!)!
    const away = teams.get(league.teams[1]!)!
    const resolve = (id: Player['id']): Player => players.get(id)!
    return { home, away, resolve }
  }

  it('produces byte-identical output when coachFit is absent (backward compatible)', () => {
    const a = teamsFor(5)
    const b = teamsFor(5)
    const resA = quickSimGame(a.home, a.away, a.resolve, { seed: 11 })
    const resB = quickSimGame(b.home, b.away, b.resolve, { seed: 11 })
    expect(JSON.stringify(resA)).toBe(JSON.stringify(resB))
  })

  it('a high-fit team out-scores the same team with a poor fit over many games', () => {
    let highGoals = 0
    let lowGoals = 0
    const N = 60
    for (let i = 0; i < N; i++) {
      const { home, away, resolve } = teamsFor(100 + i)
      // Same matchup + seed; only the home team's coach-fit differs.
      highGoals += quickSimGame({ ...home, coachFit: 100 }, away, resolve, { seed: 7000 + i }).homeGoals
      lowGoals += quickSimGame({ ...home, coachFit: 40 }, away, resolve, { seed: 7000 + i }).homeGoals
    }
    expect(highGoals).toBeGreaterThan(lowGoals)
  })
})
