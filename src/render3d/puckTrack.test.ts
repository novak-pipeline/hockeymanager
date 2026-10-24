import { describe, it, expect } from 'vitest'
import { PUCK_CATCHUP_FTS, clampToRink, gameStepDt, puckTrackStep, type PuckTrack } from './math'
import { capStep } from './lineChange'

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

  it('a pass or rim leaving a blade drawn behind the sim puck never speeds up past it (W3 S8, reel S7 VT20)', () => {
    // red before: the drawn blade 2 ft behind the sim's puck at the release; the
    // correction bled off on top of the puck's travel - 66 -> ~78 ft/s drawn
    const dt = 1 / 60
    let s: PuckTrack = { x: -2, z: 0, cx: 0, cz: 0, key: 'p7' }
    let tx = 0
    let v = 66
    let prevDrawn = s.x
    let maxOver = -Infinity
    for (let i = 0; i < 60; i++) {
      s = puckTrackStep(s, tx, 0, '', dt)
      if (i > 0) maxOver = Math.max(maxOver, (s.x - prevDrawn) / dt - v)
      prevDrawn = s.x
      v = Math.max(0, v - 4 * dt) // ice friction
      tx += v * dt
    }
    // never faster than the sim's puck (beyond the slow catch-up creep)
    expect(maxOver).toBeLessThanOrEqual(PUCK_CATCHUP_FTS + 1e-6)
    // and still on it once the puck has slowed / been on its way a second
    expect(Math.abs(s.x - tx)).toBeLessThan(2.01)
  })
})

describe('gameStepDt (W3 S8, reel S7 VT2: men drawn at the bench door while the sim had them at the faceoff)', () => {
  it('a rig capped at a skater\'s speed keeps up with the sim through a fast-forwarded stoppage', () => {
    // the sim skates a man 68 ft from his door to the faceoff at 25 ft/s game,
    // the viewer plays the dead time at 10x: red before (capped per wall s, the
    // rig ended ~60 ft behind), within a stride after
    const dt = 1 / 60
    const speed = 10
    const run = (step: (d: number) => number): number => {
      let x = 0
      let t = 0
      // a third of a wall second: the sim man is at his spot
      for (let i = 0; i < 20; i++) {
        t = Math.min(68, t + 25 * dt * speed)
        x = capStep(x, 0, t, 0, step(dt), 40).x
      }
      return t - x
    }
    expect(run((d) => d)).toBeGreaterThan(50)
    expect(run((d) => gameStepDt(d, speed, true))).toBeLessThan(1)
    // paused (or a seek) the wall dt is all there is
    expect(gameStepDt(dt, 10, false)).toBe(dt)
    expect(gameStepDt(dt, 0.5, true)).toBe(dt)
  })
})

describe('clampToRink (W3 S8, reel S7 VT20: the drawn puck 1 ft outside the corner boards)', () => {
  it('keeps a corner point inside the rounded boards and leaves the sheet alone', () => {
    const c = clampToRink(-91.5, -36)
    const d = Math.hypot(Math.abs(c.x) - 72, Math.abs(c.z) - 14.5)
    expect(d).toBeLessThanOrEqual(28 - 0.2 + 1e-9)
    expect(c.x).toBeLessThan(0)
    expect(c.z).toBeLessThan(0)
    expect(clampToRink(10, 5)).toEqual({ x: 10, z: 5 })
    expect(clampToRink(91, 0.5)).toEqual({ x: 91, z: 0.5 })
    expect(clampToRink(120, 0).x).toBeCloseTo(99.8, 6)
  })
})

import { capLookYaw, followHeadingStep } from './math'

describe('camera angular-speed guard (D1)', () => {
  it('capLookYaw never turns the view faster than the cap', () => {
    const cam = { x: 0, z: 0 }
    let prev: number | null = 0
    const dt = 1 / 60
    const cap = Math.PI / 3 // 60°/s
    // the look target jumps to the opposite side
    for (let i = 0; i < 30; i++) {
      const r = capLookYaw(cam, { x: 0, z: -30 }, prev, dt, cap)
      expect(Math.abs(Math.atan2(Math.sin(r.yaw - prev!), Math.cos(r.yaw - prev!)))).toBeLessThanOrEqual(cap * dt + 1e-9)
      prev = r.yaw
    }
    // a cut (prev null) passes straight through
    expect(capLookYaw(cam, { x: 0, z: -30 }, null, dt, cap).yaw).toBeCloseTo(Math.PI, 6)
  })

  it('followHeadingStep pans at ≤ 35°/s and CUTS on a sustained reversal instead of orbiting', () => {
    let h = { yaw: 0, reversedFor: 0 }
    const dt = 1 / 60
    // a 60° change of direction: a bounded pan
    let maxRate = 0
    for (let i = 0; i < 120; i++) {
      const n = followHeadingStep(h, Math.PI / 3, dt)
      maxRate = Math.max(maxRate, Math.abs(n.yaw - h.yaw) / dt)
      expect(n.cut).toBe(false)
      h = n
    }
    expect(maxRate).toBeLessThanOrEqual((35 * Math.PI) / 180 + 1e-9)
    // play reverses: hold, then one cut
    let cuts = 0
    const start = h.yaw
    for (let i = 0; i < 60; i++) {
      const n = followHeadingStep(h, start + Math.PI, dt)
      if (n.cut) cuts++
      else expect(n.yaw).toBeCloseTo(h.yaw, 9)
      h = n
    }
    expect(cuts).toBe(1)
  })
})
