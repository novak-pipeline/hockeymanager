/**
 * Shootout shooter model: coaches send their best finishers first, and a specific
 * shooter faces the goalie each attempt — so roster construction (having real
 * snipers) decides the skills competition, not the roster average.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { CompositeRatings, Player } from '@domain'
import { shootoutOrder, shootoutSkill, shootoutGoalChance } from './shootout'

const comp = (over: Partial<CompositeRatings>): CompositeRatings => ({
  scoring: 50, playmaking: 50, puckControl: 50, faceoffWin: 50, hitting: 50, blocking: 50,
  takeaway: 50, penaltyProne: 50, goaltending: 50, skating: 50, defensiveZone: 50, ...over,
})

describe('shootoutSkill / shootoutGoalChance', () => {
  it('a better finisher converts more; a better goalie stops more', () => {
    const sniper = shootoutSkill(comp({ scoring: 88, puckControl: 80 }))
    const grinder = shootoutSkill(comp({ scoring: 40, puckControl: 45 }))
    expect(sniper).toBeGreaterThan(grinder)
    expect(shootoutGoalChance(sniper, 55, 50)).toBeGreaterThan(shootoutGoalChance(grinder, 55, 50))
    expect(shootoutGoalChance(sniper, 75, 50)).toBeLessThan(shootoutGoalChance(sniper, 45, 50))
  })

  it('stays inside a sane per-attempt band', () => {
    expect(shootoutGoalChance(99, 1, 50)).toBeLessThanOrEqual(0.6)
    expect(shootoutGoalChance(1, 99, 50)).toBeGreaterThanOrEqual(0.1)
  })

  it('lands the top shooters near the real NHL shootout clip (~30-33%)', () => {
    // Realistic: a genuine sniper against a starting-calibre goalie.
    const p = shootoutGoalChance(shootoutSkill(comp({ scoring: 78, puckControl: 70 })), 61, 50)
    expect(p).toBeGreaterThan(0.27)
    expect(p).toBeLessThan(0.40)
  })
})

describe('shootoutOrder', () => {
  it('ranks the real snipers first and is deterministic', () => {
    const data = generateLeague({ seed: 7 })
    const team = data.teams.get(data.league.teams[0])!
    const fwds: Player[] = team.lines.forwards.flat().map((id) => data.players.get(id)!)
    const order = shootoutOrder(fwds)
    // Best-first: each shooter is at least as skilled as the next.
    for (let i = 1; i < order.length; i++) {
      expect(shootoutSkill(order[i - 1].composites)).toBeGreaterThanOrEqual(shootoutSkill(order[i].composites))
    }
    // The top shooter is the roster's best, not the line-1 default order.
    const best = fwds.reduce((b, p) => (shootoutSkill(p.composites) > shootoutSkill(b.composites) ? p : b))
    expect(order[0].id).toBe(best.id)
    // Deterministic.
    expect(shootoutOrder(fwds).map((p) => p.id)).toEqual(order.map((p) => p.id))
  })

  it('a roster of snipers out-shoots a roster of grinders', () => {
    const sniperTeam = Array.from({ length: 12 }, (_, i) => shootoutSkill(comp({ scoring: 82 - i, puckControl: 75 })))
    const grinderTeam = Array.from({ length: 12 }, (_, i) => shootoutSkill(comp({ scoring: 48 - i, puckControl: 45 })))
    const rate = (skills: number[]): number =>
      skills.slice(0, 3).reduce((s, k) => s + shootoutGoalChance(k, 60, 50), 0) / 3
    expect(rate(sniperTeam)).toBeGreaterThan(rate(grinderTeam) + 0.1)
  })
})
