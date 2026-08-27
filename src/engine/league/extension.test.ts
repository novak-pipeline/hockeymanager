/**
 * Tests for src/engine/league/extension.ts (Playtest 2026-08-26 §E2).
 *
 * The finding was a scene that offered an action the game refused. These guard
 * the rule layer that makes it real: the window, the term ceiling, the money
 * coming out of NEXT season, and a discount that genuinely expires.
 */
import { describe, it, expect } from 'vitest'
import type { Player } from '@domain'
import {
  EXTENSION_WINDOW_FRACTION,
  MAX_EXTENSION_YEARS,
  committedNextSeason,
  describeExtension,
  discountMultiplier,
  extensionEligibility,
  fitsNextSeason,
  pruneDiscounts,
  type ExtensionDiscount,
  type PendingExtension,
} from './extension'

/** Minimal player stand-in — only the contract and identity fields are read. */
function mkPlayer(id: string, yearsRemaining: number, salary = 4_000_000): Player {
  return {
    id,
    name: `Player ${id}`,
    contract: { salary, yearsRemaining, expiryYear: 2030, noTradeClause: false, twoWay: false },
  } as unknown as Player
}

const base = {
  onOwnRoster: true,
  seasonFraction: 0.6,
  inRegularSeason: true,
  alreadyExtended: false,
}

describe('extensionEligibility', () => {
  it('opens for your own player in the final year, past the window', () => {
    const r = extensionEligibility({ ...base, player: mkPlayer('p1', 1) })
    expect(r.eligible).toBe(true)
    expect(r.reason.length).toBeGreaterThan(10)
  })

  it('refuses a player with years left on his deal, and says why', () => {
    const r = extensionEligibility({ ...base, player: mkPlayer('p1', 3) })
    expect(r.eligible).toBe(false)
    expect(r.block).toBe('notFinalYear')
    expect(r.reason).toMatch(/final year/i)
  })

  it('refuses before the window opens, and opens exactly at the threshold', () => {
    const early = extensionEligibility({
      ...base, player: mkPlayer('p1', 1), seasonFraction: EXTENSION_WINDOW_FRACTION - 0.01,
    })
    expect(early.eligible).toBe(false)
    expect(early.block).toBe('windowClosed')
    expect(
      extensionEligibility({ ...base, player: mkPlayer('p1', 1), seasonFraction: EXTENSION_WINDOW_FRACTION }).eligible
    ).toBe(true)
  })

  it('refuses outside the regular season', () => {
    const r = extensionEligibility({ ...base, player: mkPlayer('p1', 1), inRegularSeason: false })
    expect(r.eligible).toBe(false)
    expect(r.block).toBe('wrongPhase')
  })

  it('refuses another club’s player', () => {
    const r = extensionEligibility({ ...base, player: mkPlayer('p1', 1), onOwnRoster: false })
    expect(r.eligible).toBe(false)
    expect(r.block).toBe('notYourPlayer')
  })

  it('refuses a second extension while one is already banked', () => {
    const r = extensionEligibility({ ...base, player: mkPlayer('p1', 1), alreadyExtended: true })
    expect(r.eligible).toBe(false)
    expect(r.block).toBe('alreadyExtended')
    expect(r.reason).toMatch(/next season/i)
  })

  it('every refusal carries a sentence — a blocked action is never silent', () => {
    const blocks = [
      extensionEligibility({ ...base, player: mkPlayer('p1', 3) }),
      extensionEligibility({ ...base, player: mkPlayer('p1', 1), onOwnRoster: false }),
      extensionEligibility({ ...base, player: mkPlayer('p1', 1), seasonFraction: 0.1 }),
      extensionEligibility({ ...base, player: mkPlayer('p1', 1), inRegularSeason: false }),
      extensionEligibility({ ...base, player: mkPlayer('p1', 1), alreadyExtended: true }),
    ]
    for (const b of blocks) {
      expect(b.eligible).toBe(false)
      expect(b.reason.trim().length).toBeGreaterThan(15)
    }
  })
})

describe('the discount', () => {
  const d = (playerId: string, year: number, mult: number): ExtensionDiscount => ({
    playerId, year, mult, note: 'note',
  })

  it('is 1 (no concession) when the camp never offered one', () => {
    expect(discountMultiplier([], 'p1', 2028)).toBe(1)
    expect(discountMultiplier([d('p2', 2028, 0.85)], 'p1', 2028)).toBe(1)
  })

  it('applies in the season it was offered', () => {
    expect(discountMultiplier([d('p1', 2028, 0.87)], 'p1', 2028)).toBeCloseTo(0.87)
  })

  it('LAPSES when the season turns — that was the whole premise of the scene', () => {
    expect(discountMultiplier([d('p1', 2028, 0.87)], 'p1', 2029)).toBe(1)
    expect(pruneDiscounts([d('p1', 2028, 0.87)], 2029)).toHaveLength(0)
    expect(pruneDiscounts([d('p1', 2029, 0.87)], 2029)).toHaveLength(1)
  })

  it('gives the club the best of any overlapping offers', () => {
    expect(discountMultiplier([d('p1', 2028, 0.92), d('p1', 2028, 0.84)], 'p1', 2028)).toBeCloseTo(0.84)
  })
})

describe('next-season cap', () => {
  const pending = (playerId: string, salary: number): PendingExtension => ({
    playerId, salary, years: 5, signedYear: 2028, startYear: 2029,
    clause: 'none', signingBonusPct: 0, noTradeClause: false,
  })

  it('counts only contracts that still pay next season', () => {
    const roster = [
      mkPlayer('a', 3, 5_000_000), // pays next year
      mkPlayer('b', 1, 9_000_000), // expiring — does not
      mkPlayer('c', 2, 2_000_000), // pays next year
    ]
    expect(committedNextSeason({ roster, pending: [] })).toBe(7_000_000)
  })

  it('replaces an extended player’s current salary with the extension', () => {
    const roster = [mkPlayer('a', 1, 900_000), mkPlayer('b', 4, 3_000_000)]
    const committed = committedNextSeason({ roster, pending: [pending('a', 8_000_000)] })
    expect(committed).toBe(11_000_000)
  })

  it('does not double-count a player who is both under contract and extended', () => {
    const roster = [mkPlayer('a', 3, 5_000_000)]
    expect(committedNextSeason({ roster, pending: [pending('a', 7_000_000)] })).toBe(7_000_000)
  })

  it('includes dead money already scheduled against next season', () => {
    const roster = [mkPlayer('a', 2, 1_000_000)]
    expect(committedNextSeason({ roster, pending: [], deadCapNextSeason: 2_500_000 })).toBe(3_500_000)
  })

  it('fitsNextSeason answers with the room, not just yes/no', () => {
    const roster = [mkPlayer('a', 3, 60_000_000)]
    const r = fitsNextSeason({ roster, pending: [], salary: 30_000_000, cap: 85_000_000 })
    expect(r.fits).toBe(false)
    expect(r.committed).toBe(60_000_000)
    expect(r.room).toBe(25_000_000)
    expect(fitsNextSeason({ roster, pending: [], salary: 25_000_000, cap: 85_000_000 }).fits).toBe(true)
  })
})

describe('receipt', () => {
  it('names the money, the term and the season it starts', () => {
    const e: PendingExtension = {
      playerId: 'p1', salary: 7_250_000, years: 6, signedYear: 2028, startYear: 2029,
      clause: 'modified', signingBonusPct: 20, noTradeClause: true,
    }
    const s = describeExtension(e, 'Georgi Ivanov')
    expect(s).toContain('Georgi Ivanov')
    expect(s).toContain('$7.25M')
    expect(s).toContain('6 years')
    expect(s).toContain('2029')
    expect(s).toContain('modified no-trade clause')
  })

  it('caps term at what a club may give its own player', () => {
    expect(MAX_EXTENSION_YEARS).toBe(8)
  })
})
