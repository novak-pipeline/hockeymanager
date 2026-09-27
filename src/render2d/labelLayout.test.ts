import { describe, expect, it } from 'vitest'
import { layoutLabels, type LabelRequest } from './labelLayout'

const req = (key: string, x: number, y: number, priority = 0): LabelRequest => ({ key, x, y, w: 60, h: 14, priority })

describe('layoutLabels (E1 / F-21: names never pile up)', () => {
  it('never returns two overlapping rects, however crowded the scrum', () => {
    const reqs = Array.from({ length: 10 }, (_, i) => req(`p${i}`, 300 + (i % 3) * 8, 200 + Math.floor(i / 3) * 5, i === 4 ? 10 : 0))
    const out = layoutLabels(reqs, { w: 800, h: 450 })
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!
        const b = out[j]!
        const sep = a.left >= b.left + b.w || b.left >= a.left + a.w || a.top >= b.top + b.h || b.top >= a.top + a.h
        expect(sep).toBe(true)
      }
    }
    // the carrier (priority 10) always keeps his default spot
    const c = out.find((p) => p.key === 'p4')!
    expect(c.dx).toBe(0)
    expect(c.dy).toBe(0)
    // a pile is thinned, not stacked into an unreadable tower
    expect(out.length).toBeLessThan(reqs.length)
  })

  it('leaves well-separated labels exactly where they asked to be', () => {
    const out = layoutLabels([req('a', 100, 100), req('b', 400, 100), req('c', 100, 300)], { w: 800, h: 450 })
    expect(out).toHaveLength(3)
    for (const p of out) expect([p.dx, p.dy]).toEqual([0, 0])
  })

  it('keeps labels inside the viewport', () => {
    const out = layoutLabels([req('edge', 5, 8)], { w: 800, h: 450 })
    expect(out[0]!.left).toBeGreaterThanOrEqual(0)
    expect(out[0]!.top).toBeGreaterThanOrEqual(0)
  })
})
