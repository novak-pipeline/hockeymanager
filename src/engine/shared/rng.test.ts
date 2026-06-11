import { describe, expect, it } from 'vitest'
import { Rng, deriveSeed } from './rng'

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(12345)
    const b = new Rng(12345)
    const seqA = Array.from({ length: 20 }, () => a.next())
    const seqB = Array.from({ length: 20 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('produces different streams for different seeds', () => {
    const a = new Rng(1)
    const b = new Rng(2)
    expect(a.next()).not.toEqual(b.next())
  })

  it('next() stays in [0,1)', () => {
    const r = new Rng(7)
    for (let i = 0; i < 1000; i++) {
      const x = r.next()
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })

  it('range() is inclusive on both ends', () => {
    const r = new Rng(99)
    let sawMin = false
    let sawMax = false
    for (let i = 0; i < 2000; i++) {
      const x = r.range(1, 6)
      expect(x).toBeGreaterThanOrEqual(1)
      expect(x).toBeLessThanOrEqual(6)
      if (x === 1) sawMin = true
      if (x === 6) sawMax = true
    }
    expect(sawMin && sawMax).toBe(true)
  })

  it('chance() approximates the requested probability', () => {
    const r = new Rng(2024)
    let hits = 0
    const n = 20000
    for (let i = 0; i < n; i++) if (r.chance(0.3)) hits++
    expect(hits / n).toBeCloseTo(0.3, 1)
  })

  it('gaussian() has ~0 mean and ~1 stddev', () => {
    const r = new Rng(555)
    const n = 50000
    let sum = 0
    let sumSq = 0
    for (let i = 0; i < n; i++) {
      const g = r.gaussian()
      sum += g
      sumSq += g * g
    }
    const mean = sum / n
    const variance = sumSq / n - mean * mean
    expect(mean).toBeCloseTo(0, 1)
    expect(Math.sqrt(variance)).toBeCloseTo(1, 1)
  })

  it('shuffle is a permutation and deterministic', () => {
    const base = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    const a = new Rng(42).shuffle([...base])
    const b = new Rng(42).shuffle([...base])
    expect(a).toEqual(b)
    expect([...a].sort((x, y) => x - y)).toEqual(base)
  })

  it('deriveSeed is stable and key-sensitive', () => {
    expect(deriveSeed(1, 2, 3)).toEqual(deriveSeed(1, 2, 3))
    expect(deriveSeed(1, 2, 3)).not.toEqual(deriveSeed(1, 3, 2))
  })
})
