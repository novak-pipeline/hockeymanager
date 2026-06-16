import { describe, expect, it } from 'vitest'
import { analystProjection, analystRank, ceilingRole, draftEligibility, draftRoundLabel, perceivedCeiling, productionPremium, projectionHedge, type RankInput } from './draftRankings'

describe('draftRoundLabel', () => {
  it('maps a full-ordering rank to a round/standing', () => {
    expect(draftRoundLabel(1)).toBe('R1 · #1')
    expect(draftRoundLabel(33)).toBe('R2 · #33')
    expect(draftRoundLabel(96)).toBe('R3 · #96')
    expect(draftRoundLabel(300)).toBe('Undrafted proj.')
    expect(draftRoundLabel(undefined)).toBe('Unranked')
    expect(draftRoundLabel(20, 'radar')).toBe('Future class')
  })
})

describe('draftEligibility', () => {
  it('buckets by age and excludes drafted / out-of-range', () => {
    expect(draftEligibility(13, false)).toBeNull()
    expect(draftEligibility(14, false)).toBe('radar')
    expect(draftEligibility(16, false)).toBe('radar')
    expect(draftEligibility(17, false)).toBe('eligible')
    expect(draftEligibility(18, false)).toBe('eligible')
    expect(draftEligibility(19, false)).toBe('reentry')
    expect(draftEligibility(20, false)).toBe('reentry')
    expect(draftEligibility(21, false)).toBeNull()
    expect(draftEligibility(18, true)).toBeNull() // already drafted
  })
})

const pool: RankInput[] = Array.from({ length: 40 }, (_, i) => ({
  id: `p${i}`,
  ceiling: 50 + (i % 20) * 2, // spread of ceilings
  current: 40 + (i % 15),
}))

describe('analystRank', () => {
  it('ranks higher-ceiling prospects near the top', () => {
    const order = analystRank(pool, 'final')
    const top = order.slice(0, 5).map((id) => pool.find((p) => p.id === id)!.ceiling)
    const bottom = order.slice(-5).map((id) => pool.find((p) => p.id === id)!.ceiling)
    const avg = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length
    expect(avg(top)).toBeGreaterThan(avg(bottom))
  })

  it('is deterministic within a phase', () => {
    expect(analystRank(pool, 'midseason')).toEqual(analystRank(pool, 'midseason'))
  })

  it('shuffles between phases (the board evolves)', () => {
    const prelim = analystRank(pool, 'preliminary')
    const final = analystRank(pool, 'final')
    expect(prelim).not.toEqual(final)
  })

  it('returns every prospect exactly once', () => {
    const order = analystRank(pool, 'preliminary')
    expect(new Set(order).size).toBe(pool.length)
  })

  it('fades goalies below an equal-ceiling skater', () => {
    const inputs: RankInput[] = [
      { id: 'g', ceiling: 90, current: 70, position: 'G' },
      { id: 'f', ceiling: 90, current: 70, position: 'C' },
    ]
    // Across phases the skater should consistently rank ahead of the goalie.
    for (const ph of ['preliminary', 'midseason', 'final'] as const) {
      expect(analystRank(inputs, ph).indexOf('f')).toBeLessThan(analystRank(inputs, ph).indexOf('g'))
    }
  })

  it('productionPremium rewards producers and dings non-producers', () => {
    // Strong junior producer (1.3 PPG forward in a 0.30-strength league) → real lift.
    expect(productionPremium(1.3, false, 0.30)).toBeGreaterThanOrEqual(6)
    // A defenceman needs less scoring to impress.
    expect(productionPremium(0.9, true, 0.30)).toBeGreaterThan(productionPremium(0.9, false, 0.30))
    // Low producer → negative.
    expect(productionPremium(0.3, false, 0.30)).toBeLessThan(0)
    // Same rate in a tougher league is worth more.
    expect(productionPremium(0.6, false, 0.50)).toBeGreaterThan(productionPremium(0.6, false, 0.25))
    // No sample → neutral.
    expect(productionPremium(0, false, 0.30)).toBe(0)
    // Bounded — production is a strong driver but still can't fully override pedigree.
    expect(productionPremium(3, false, 1)).toBeLessThanOrEqual(22)
  })

  it('production feeds the perceived ceiling', () => {
    expect(perceivedCeiling(70, 18, 8)).toBe(perceivedCeiling(70, 18, 0) + 8)
  })

  it('perceivedCeiling adds an optimism premium that fades with age', () => {
    // Younger prospects carry more hype above their true ceiling.
    expect(perceivedCeiling(70, 17)).toBeGreaterThan(perceivedCeiling(70, 20))
    expect(perceivedCeiling(70, 17)).toBeGreaterThan(70) // always optimistic vs truth
    expect(perceivedCeiling(99, 17)).toBe(99)            // clamped at the top
  })

  it('docks re-entry prospects vs equal first-time-eligible ones', () => {
    const inputs: RankInput[] = [
      { id: 're', ceiling: 85, current: 70, position: 'C', eligibility: 'reentry' },
      { id: 'el', ceiling: 85, current: 70, position: 'C', eligibility: 'eligible' },
    ]
    expect(analystRank(inputs, 'final').indexOf('el')).toBeLessThan(analystRank(inputs, 'final').indexOf('re'))
  })
})

describe('ceilingRole', () => {
  it('escalates the forward role with ceiling', () => {
    expect(ceilingRole(95, 'C')).toMatch(/franchise/)
    expect(ceilingRole(83, 'LW')).toMatch(/first-line/)
    expect(ceilingRole(72, 'RW')).toMatch(/middle-six/)
    expect(ceilingRole(50, 'C')).toMatch(/AHL|depth/)
  })
  it('uses position-specific language for D and G', () => {
    expect(ceilingRole(90, 'D')).toMatch(/#1 defenceman/)
    expect(ceilingRole(82, 'D')).toMatch(/top-pairing/)
    expect(ceilingRole(86, 'G')).toMatch(/franchise starting goaltender/)
    expect(ceilingRole(50, 'G')).toMatch(/goaltender/)
  })
})

describe('analystProjection', () => {
  const base = { name: 'Test Prospect', position: 'C', ceiling: 90, phaseLabel: 'Mid-season ranking', draftYear: 2027 }
  it('frames a radar (too-young) prospect without a board rank', () => {
    const s = analystProjection({ ...base, eligibility: 'radar' })
    expect(s).toMatch(/radar/)
    expect(s).toMatch(/franchise/)
  })
  it('cites the board rank for an eligible prospect', () => {
    const s = analystProjection({ ...base, eligibility: 'eligible', rank: 1 })
    expect(s).toMatch(/#1 in the 2027 class/)
    expect(s).toMatch(/franchise/)
  })
  it('flags a re-entry prospect as passed over', () => {
    const s = analystProjection({ ...base, eligibility: 'reentry', rank: 40 })
    expect(s).toMatch(/[Pp]assed over/)
  })
  it('reads an off-published-board prospect as a concrete projected round', () => {
    // Ranked ~#96 overall → a third-round projection, not a vague "off the board".
    const s = analystProjection({ ...base, eligibility: 'eligible', fullRank: 96 })
    expect(s).toMatch(/third-round pick/)
    expect(s).toMatch(/#96/)
  })
  it('handles an eligible prospect with no draftable projection at all', () => {
    const s = analystProjection({ ...base, eligibility: 'eligible' })
    expect(s).toMatch(/draftable prospect/)
  })

  it('hedges harder the deeper the projection', () => {
    expect(analystProjection({ ...base, eligibility: 'eligible', rank: 2 })).toMatch(/high-confidence/)
    expect(analystProjection({ ...base, eligibility: 'eligible', rank: 50 })).toMatch(/wide range of outcomes/)
  })
})

describe('projectionHedge', () => {
  it('is confident at the top and murky at the bottom', () => {
    expect(projectionHedge(1)).toMatch(/high-confidence/)
    expect(projectionHedge(20)).toMatch(/first-round/)
    expect(projectionHedge(50)).toMatch(/wide range/)
    expect(projectionHedge(120)).toMatch(/best guess/)
    expect(projectionHedge(undefined)).toMatch(/enormous/)
  })
})
