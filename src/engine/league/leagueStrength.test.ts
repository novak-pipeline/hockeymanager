import { describe, expect, it } from 'vitest'
import { leagueTranslationFactor, nhlEquivalent, type LeagueStrength } from './leagueStrength'

const L = (abbrev: string, level = 1, reputation = 15, name?: string): LeagueStrength =>
  name !== undefined ? { abbrev, level, reputation, name } : { abbrev, level, reputation }

describe('leagueTranslationFactor', () => {
  it('makes the NHL the 1.0 baseline', () => {
    expect(leagueTranslationFactor(L('NHL', 1, 20))).toBe(1)
  })

  it('orders the pipeline leagues realistically (NHL > KHL > SHL > AHL > OHL > USHL)', () => {
    const nhl = leagueTranslationFactor(L('NHL', 1, 20))
    const khl = leagueTranslationFactor(L('KHL', 1, 18))
    const shl = leagueTranslationFactor(L('SHL', 1, 17))
    const ahl = leagueTranslationFactor(L('AHL', 2, 15))
    const ohl = leagueTranslationFactor(L('OHL', 1, 12))
    const ushl = leagueTranslationFactor(L('USHL', 1, 10))
    expect(nhl).toBeGreaterThan(khl)
    expect(khl).toBeGreaterThan(shl)
    expect(shl).toBeGreaterThan(ahl)
    expect(ahl).toBeGreaterThan(ohl)
    expect(ohl).toBeGreaterThan(ushl)
  })

  it('always returns a factor in (0, 1]', () => {
    for (const s of [L('NHL', 1, 20), L('ECHL', 3, 13), L('???', 4, 0), L('???', 1, 25)]) {
      const f = leagueTranslationFactor(s)
      expect(f).toBeGreaterThan(0)
      expect(f).toBeLessThanOrEqual(1)
    }
  })

  it('resolves leagues by name keyword when the abbrev is unknown', () => {
    const byName = leagueTranslationFactor({ abbrev: 'ZZZ', level: 1, reputation: 9, name: 'American Hockey League' })
    expect(byName).toBe(leagueTranslationFactor(L('AHL', 2, 15)))
  })

  it('falls back to a reputation curve for unrecognised leagues, monotonic in reputation', () => {
    const weak = leagueTranslationFactor({ abbrev: 'XYZ', level: 1, reputation: 6 })
    const strong = leagueTranslationFactor({ abbrev: 'XYZ', level: 1, reputation: 16 })
    expect(strong).toBeGreaterThan(weak)
  })

  it('discounts lower division levels for unrecognised leagues', () => {
    const top = leagueTranslationFactor({ abbrev: 'XYZ', level: 1, reputation: 14 })
    const third = leagueTranslationFactor({ abbrev: 'XYZ', level: 3, reputation: 14 })
    expect(third).toBeLessThan(top)
  })
})

describe('nhlEquivalent', () => {
  it('translates production down for weaker leagues', () => {
    const ohlPpg = 1.2
    const ohlFactor = leagueTranslationFactor(L('OHL', 1, 12))
    const equiv = nhlEquivalent(ohlPpg, ohlFactor)
    // A 1.2 P/G junior scorer is worth far less than 1.2 in the NHL.
    expect(equiv).toBeLessThan(ohlPpg)
    expect(equiv).toBeGreaterThan(0)
  })

  it('leaves NHL production unchanged', () => {
    expect(nhlEquivalent(0.9, leagueTranslationFactor(L('NHL', 1, 20)))).toBe(0.9)
  })
})
