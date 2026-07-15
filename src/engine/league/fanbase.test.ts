import { describe, it, expect } from 'vitest'
import { fanInterestDelta, budgetFactor, fanInterestLabel } from './fanbase'

describe('fanbase — fanInterestDelta', () => {
  it('a Cup run lifts interest; missing the playoffs and bottom-feeding erodes it', () => {
    expect(fanInterestDelta({ finalRank: 1, n: 32, madePlayoffs: true, wonCup: true, rebuilding: false })).toBeGreaterThan(0)
    expect(fanInterestDelta({ finalRank: 30, n: 32, madePlayoffs: false, wonCup: false, rebuilding: false })).toBeLessThan(0)
  })

  it('a sanctioned rebuild softens the erosion but never reverses it', () => {
    const base = { finalRank: 30, n: 32, madePlayoffs: false, wonCup: false }
    const normal = fanInterestDelta({ ...base, rebuilding: false })
    const rebuilding = fanInterestDelta({ ...base, rebuilding: true })
    expect(rebuilding).toBeGreaterThan(normal) // less negative
    expect(rebuilding).toBeLessThan(0) // still bleeding
  })

  it('a rebuild does not blunt the upside of a surprise good season', () => {
    const good = { finalRank: 2, n: 32, madePlayoffs: true, wonCup: false }
    expect(fanInterestDelta({ ...good, rebuilding: true })).toBe(fanInterestDelta({ ...good, rebuilding: false }))
  })
})

describe('fanbase — budgetFactor', () => {
  it('scales monotonically and brackets ~1.0 around the baseline', () => {
    expect(budgetFactor(0)).toBeLessThan(budgetFactor(60))
    expect(budgetFactor(60)).toBeLessThan(budgetFactor(100))
    expect(budgetFactor(0)).toBeGreaterThan(0.7)
    expect(budgetFactor(100)).toBeLessThan(1.3)
  })
  it('clamps out-of-range interest', () => {
    expect(budgetFactor(-50)).toBe(budgetFactor(0))
    expect(budgetFactor(150)).toBe(budgetFactor(100))
  })
})

describe('fanbase — fanInterestLabel', () => {
  it('maps the range to distinct reads', () => {
    expect(new Set([5, 30, 45, 60, 75, 90].map(fanInterestLabel)).size).toBe(6)
  })
})
