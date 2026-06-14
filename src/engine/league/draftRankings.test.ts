import { describe, expect, it } from 'vitest'
import { analystRank, type RankInput } from './draftRankings'

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
