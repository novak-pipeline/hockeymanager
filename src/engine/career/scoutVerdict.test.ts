/**
 * scoutVerdict.test.ts — Overall Report verdict + pros/cons.
 */
import { describe, it, expect } from 'vitest'
import type { Player, Position, RawAttributes } from '@domain'
import { computeComposites } from '@engine/ratings/composites'
import { buildScoutVerdict } from './scoutVerdict'

function raw(v: number): RawAttributes {
  return {
    technical: { wristShot: v, slapShot: v, stickhandling: v, passing: v, deflections: v, faceoffs: v },
    physical: { speed: v, acceleration: v, strength: v, balance: v, stamina: v, agility: v, height: 50 },
    mental: { offensiveIQ: v, defensiveIQ: v, positioning: v, vision: v, aggression: v, composure: v, workRate: v, discipline: v, anticipation: v },
    defensive: { checking: v, shotBlocking: v, stickChecking: v, takeaway: v },
  }
}

function player(over: Partial<{ position: Position; v: number; age: number; temperament: number }>): Player {
  const v = over.v ?? 60
  const r = raw(v)
  return {
    id: 'p1' as unknown as Player['id'], name: 'Test', age: over.age ?? 26,
    position: over.position ?? 'C', handedness: 'L', role: 'twoWay',
    ratings: r, potential: r, composites: computeComposites(r, 'twoWay', over.position ?? 'C'),
    personality: { ambition: 10, professionalism: 10, loyalty: 10, temperament: over.temperament ?? 10, determination: 10 },
    contract: { salary: 1, yearsRemaining: 3, expiryYear: 2030, noTradeClause: false, twoWay: false },
    stats: [], fatigue: 0, morale: 60, injuryStatus: null, form: 0,
  } as unknown as Player
}

describe('buildScoutVerdict', () => {
  it('an elite player earns a strong recommendation and pros', () => {
    const v = buildScoutVerdict(player({ v: 90 }), 4.5, 5)
    expect(v.recommendation.toLowerCase()).toMatch(/marquee|excellent/)
    expect(v.pros.length).toBeGreaterThan(0)
    expect(v.bestRole.length).toBeGreaterThan(0)
  })

  it('a weak player is not recommended and shows cons', () => {
    const v = buildScoutVerdict(player({ v: 35 }), 1, 1)
    expect(v.recommendation.toLowerCase()).toMatch(/not worth|depth/)
    expect(v.cons.length).toBeGreaterThan(0)
  })

  it('an aging player gets an age con', () => {
    const v = buildScoutVerdict(player({ v: 70, age: 35 }), 3.5, 3)
    expect(v.cons.some((c) => /30/.test(c))).toBe(true)
  })

  it('a volatile player gets a temperament con', () => {
    const v = buildScoutVerdict(player({ v: 70, temperament: 4 }), 3.5, 3)
    expect(v.cons.some((c) => /volatile|discipline/i.test(c))).toBe(true)
  })

  it('caps pros at 6 and cons at 5', () => {
    const v = buildScoutVerdict(player({ v: 95 }), 5, 5)
    expect(v.pros.length).toBeLessThanOrEqual(6)
    expect(v.cons.length).toBeLessThanOrEqual(5)
  })
})
