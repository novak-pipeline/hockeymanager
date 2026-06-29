import { describe, it, expect } from 'vitest'
import { deriveConsistency, applyConsistency, consistencyLabel } from './consistency'

describe('consistency — deriveConsistency', () => {
  it('is deterministic for the same inputs and within 1–20', () => {
    const a = deriveConsistency('nhl-8478402', 70, 60)
    const b = deriveConsistency('nhl-8478402', 70, 60)
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(1)
    expect(a).toBeLessThanOrEqual(20)
  })

  it('varies across different player ids', () => {
    const vals = new Set(
      Array.from({ length: 50 }, (_, i) => deriveConsistency(`p-${i}`, 55, 55))
    )
    expect(vals.size).toBeGreaterThan(5) // a real spread, not a constant
  })

  it('composed, determined players trend more consistent', () => {
    // Average over many ids to wash out the per-id hash jitter.
    const mean = (composure: number, det: number): number => {
      let s = 0
      for (let i = 0; i < 200; i++) s += deriveConsistency(`x-${i}`, composure, det)
      return s / 200
    }
    expect(mean(90, 90)).toBeGreaterThan(mean(20, 20))
  })
})

describe('consistency — applyConsistency', () => {
  it('is an exact no-op when consistency is absent', () => {
    for (const r of [4.0, 5.6, 6.3, 8.0]) {
      expect(applyConsistency(r, undefined, 0.0)).toBe(r)
      expect(applyConsistency(r, undefined, 0.99)).toBe(r)
    }
  })

  it('clamps output to the 5.0–9.5 band', () => {
    expect(applyConsistency(9.5, 1, 0.999)).toBeLessThanOrEqual(9.5)
    expect(applyConsistency(5.0, 1, 0.0)).toBeGreaterThanOrEqual(5.0)
  })

  it('low consistency swings ratings far more than high consistency', () => {
    const spread = (consistency: number): number => {
      let lo = Infinity
      let hi = -Infinity
      for (let i = 0; i <= 20; i++) {
        const v = applyConsistency(5.6, consistency, i / 20)
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }
      return hi - lo
    }
    expect(spread(3)).toBeGreaterThan(spread(18))
  })

  it('a highly consistent player lands near his true level', () => {
    // At consistency 20 the swing term is 0; only the small reliable bump applies.
    expect(Math.abs(applyConsistency(5.6, 20, 0.5) - 5.6)).toBeLessThanOrEqual(0.5)
  })
})

describe('consistency — consistencyLabel', () => {
  it('maps the range to distinct qualitative reads', () => {
    const labels = new Set([2, 6, 9, 13, 17].map(consistencyLabel))
    expect(labels.size).toBe(5)
  })
})
