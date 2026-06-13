/**
 * personalityType.test.ts — personality archetype derivation.
 */
import { describe, it, expect } from 'vitest'
import type { Player } from '@domain'
import { personalityArchetype } from './personalityType'

function makePlayer(p: Partial<{
  ambition: number
  professionalism: number
  loyalty: number
  temperament: number
  determination: number
  leadership: number
  pressure: number
}>): Player {
  return {
    id: 'p1' as unknown as Player['id'],
    name: 'Test Player',
    age: 26,
    position: 'C',
    handedness: 'L',
    role: 'twoWay',
    personality: {
      ambition: p.ambition ?? 10,
      professionalism: p.professionalism ?? 10,
      loyalty: p.loyalty ?? 10,
      temperament: p.temperament ?? 10,
      determination: p.determination ?? 10,
    },
    contract: { salary: 1, yearsRemaining: 2, expiryYear: 2030, noTradeClause: false, twoWay: false },
    stats: [],
    fatigue: 0,
    morale: 60,
    injuryStatus: null,
    form: 0,
    ...(p.leadership !== undefined ? { leadership: p.leadership } : {}),
    ...(p.pressure !== undefined ? { pressure: p.pressure } : {}),
  } as unknown as Player
}

describe('personalityArchetype', () => {
  it('high leadership → Born Leader', () => {
    expect(personalityArchetype(makePlayer({ leadership: 95 })).key).toBe('leader')
  })

  it('low temperament → Volatile', () => {
    expect(personalityArchetype(makePlayer({ temperament: 4 })).key).toBe('volatile')
  })

  it('low loyalty + high ambition → Mercenary', () => {
    expect(personalityArchetype(makePlayer({ loyalty: 3, ambition: 16 })).key).toBe('mercenary')
  })

  it('very high professionalism → Model Professional', () => {
    expect(personalityArchetype(makePlayer({ professionalism: 18 })).key).toBe('modelPro')
  })

  it('high ambition + determination → Driven Winner', () => {
    expect(personalityArchetype(makePlayer({ ambition: 17, determination: 16 })).key).toBe('drivenWinner')
  })

  it('elite pressure → Big-Game Player', () => {
    expect(personalityArchetype(makePlayer({ pressure: 19 })).key).toBe('bigGame')
  })

  it('plain traits → Balanced Character', () => {
    expect(personalityArchetype(makePlayer({})).key).toBe('balanced')
  })

  it('always returns a label and blurb', () => {
    const a = personalityArchetype(makePlayer({ loyalty: 18 }))
    expect(a.label.length).toBeGreaterThan(0)
    expect(a.blurb.length).toBeGreaterThan(0)
  })
})
