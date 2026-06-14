import { describe, expect, it } from 'vitest'
import { analystProjection, analystRank, ceilingRole, draftEligibility, type RankInput } from './draftRankings'

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
  it('handles an eligible prospect who missed the published board', () => {
    const s = analystProjection({ ...base, eligibility: 'eligible' })
    expect(s).toMatch(/outside their published board/)
  })
})
