import { describe, it, expect } from 'vitest'
import { puckTrackStep, type PuckTrack } from './math'

describe('puckTrackStep (audit C2: the drawn puck must not trail the stream)', () => {
  it('a loose puck at shot speed is drawn exactly where the stream puts it', () => {
    let s: PuckTrack = { x: 0, z: 0, cx: 0, cz: 0, key: '' }
    const dt = 1 / 60
    let maxLag = 0
    for (let i = 1; i <= 60; i++) {
      const tx = 130 * i * dt // 130 ft/s slap shot
      s = puckTrackStep(s, tx, 0, '', dt)
      maxLag = Math.max(maxLag, Math.abs(s.x - tx))
    }
    expect(maxLag).toBe(0)
  })

  it('a carried→loose handoff blends out within ~0.2 s and never trails a moving puck', () => {
    const dt = 1 / 60
    // carried at the blade (x = 1), then released: the stream puck is at 0 and flies at 100 ft/s
    let s: PuckTrack = { x: 1, z: 0, cx: 0, cz: 0, key: 'p1' }
    const errs: number[] = []
    for (let i = 0; i < 20; i++) {
      const tx = 100 * i * dt
      s = puckTrackStep(s, tx, 0, '', dt)
      errs.push(Math.abs(s.x - tx))
    }
    expect(errs[0]).toBeLessThan(1)
    expect(errs[12]!).toBeLessThan(0.05)
    // the error only ever shrinks
    for (let i = 1; i < errs.length; i++) expect(errs[i]!).toBeLessThanOrEqual(errs[i - 1]! + 1e-9)
  })

  it('a stoppage reset (a big jump across a handoff) snaps, never slides across the ice', () => {
    const s = puckTrackStep({ x: 80, z: 10, cx: 0, cz: 0, key: 'p1' }, 0, 0, '', 1 / 60)
    expect(s.x).toBe(0)
    expect(s.z).toBe(0)
  })

  it('dt = 0 (seek) snaps to the target', () => {
    const s = puckTrackStep({ x: 5, z: 5, cx: 3, cz: 3, key: 'a' }, 1, 2, 'b', 0)
    expect(s).toEqual({ x: 1, z: 2, cx: 0, cz: 0, key: 'b' })
  })
})
