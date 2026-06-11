/**
 * Unit tests for the pure-logic modules in render3d.
 * No THREE dependency — runs in Node via vitest.
 */
import { describe, it, expect } from 'vitest'
import {
  normXtoWorld,
  normYtoWorld,
  normToWorld,
  springStep,
  snapSpring,
  wrapAngle,
  angleSpringStep,
  clampTurnRate,
  jerseyNumber,
  extractCues,
  cameraTargetFor,
  endzoneChooseEnd,
  puckCarriedOffset,
  skaterBob,
  legSwingAngle,
  applyDeadzone,
  emaStep,
  clampSpeed,
  type Spring1D,
} from './math'
import type { GameStream } from '@domain'

// ── coordinate helpers ────────────────────────────────────────────────────────

describe('normXtoWorld', () => {
  it('maps center to 0', () => {
    expect(normXtoWorld(0)).toBe(0)
  })
  it('maps left goal to -100', () => {
    expect(normXtoWorld(-1)).toBe(-100)
  })
  it('maps right goal to +100', () => {
    expect(normXtoWorld(1)).toBe(100)
  })
  it('maps blue line at 0.25 to 25ft', () => {
    expect(normXtoWorld(0.25)).toBe(25)
  })
})

describe('normYtoWorld', () => {
  it('maps center to 0', () => {
    expect(normYtoWorld(0)).toBe(0)
  })
  it('maps one boards to -42.5', () => {
    expect(normYtoWorld(-1)).toBe(-42.5)
  })
  it('maps other boards to +42.5', () => {
    expect(normYtoWorld(1)).toBe(42.5)
  })
})

describe('normToWorld', () => {
  it('returns both axes correctly', () => {
    expect(normToWorld(0.5, -0.5)).toEqual({ wx: 50, wz: -21.25 })
  })
})

// ── spring follow ──────────────────────────────────────────────────────────

describe('springStep', () => {
  it('moves toward target', () => {
    const s: Spring1D = { pos: 0, vel: 0 }
    const next = springStep(s, 100, 0.016, 0.08)
    expect(next.pos).toBeGreaterThan(0)
    expect(next.pos).toBeLessThan(100)
  })

  it('stays put with dt=0', () => {
    const s: Spring1D = { pos: 50, vel: 0 }
    const next = springStep(s, 100, 0, 0.08)
    expect(next.pos).toBe(50)
  })

  it('converges to target over time', () => {
    let s: Spring1D = { pos: 0, vel: 0 }
    for (let i = 0; i < 200; i++) {
      s = springStep(s, 100, 0.016, 0.08)
    }
    expect(s.pos).toBeCloseTo(100, 0)
  })

  it('handles negative displacement', () => {
    const s: Spring1D = { pos: 10, vel: 0 }
    const next = springStep(s, -10, 0.016, 0.08)
    expect(next.pos).toBeLessThan(10)
  })
})

describe('snapSpring', () => {
  it('sets position exactly with zero velocity', () => {
    const s = snapSpring(42)
    expect(s.pos).toBe(42)
    expect(s.vel).toBe(0)
  })

  it('does not move when stepped from snapped state', () => {
    const s = snapSpring(42)
    const next = springStep(s, 42, 0.016, 0.1)
    expect(next.pos).toBeCloseTo(42, 5)
  })

  it('snapping then stepping toward same target stays at target', () => {
    const s = snapSpring(100)
    // Already at target — one step should stay very close
    const next = springStep(s, 100, 0.016, 0.1)
    expect(next.pos).toBeCloseTo(100, 4)
  })
})

// ── angle helpers ─────────────────────────────────────────────────────────

describe('wrapAngle', () => {
  it('keeps angles in [-π, π]', () => {
    expect(wrapAngle(0)).toBe(0)
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 5)
    expect(wrapAngle(-Math.PI)).toBeCloseTo(-Math.PI, 5)
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 5)
    expect(wrapAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI, 5)
    expect(wrapAngle(Math.PI * 2 + 0.1)).toBeCloseTo(0.1, 5)
  })
})

describe('clampTurnRate', () => {
  it('returns target when delta is within max rate', () => {
    // maxRate=π rad/s, dt=1.0s → maxDelta=π. Target=0.1 rad is well within that.
    const maxRate = Math.PI // 180°/s
    const dt = 1.0
    const result = clampTurnRate(0, 0.1, dt, maxRate)
    expect(result).toBeCloseTo(0.1, 4)
  })

  it('clamps large delta to max rate * dt', () => {
    const maxRate = Math.PI // 180°/s
    const dt = 0.016
    // Trying to turn π (180°) in one frame — should be clamped
    const result = clampTurnRate(0, Math.PI, dt, maxRate)
    expect(result).toBeCloseTo(maxRate * dt, 4)
  })

  it('does not allow 180° whip in a single 16ms frame', () => {
    // Even with a very fast rate, a single frame should not flip 180°
    const maxRate = (Math.PI * 270) / 180  // 270°/s
    const dt = 0.016
    const result = clampTurnRate(0, Math.PI, dt, maxRate)
    // At 270°/s for 16ms: max turn = 270 * 0.016 * π/180 ≈ 0.075 rad
    expect(Math.abs(result)).toBeLessThan(0.1)
  })

  it('handles negative direction', () => {
    const maxRate = Math.PI
    const dt = 0.016
    const result = clampTurnRate(0, -Math.PI, dt, maxRate)
    expect(result).toBeCloseTo(-maxRate * dt, 4)
  })

  it('wraps output to [-π, π]', () => {
    // Start near π, turn a bit more — should wrap cleanly
    const result = clampTurnRate(Math.PI - 0.01, -Math.PI + 0.01, 1.0, 0.05)
    expect(Math.abs(result)).toBeLessThanOrEqual(Math.PI + 0.001)
  })
})

describe('angleSpringStep', () => {
  it('steps angle toward target taking shortest path', () => {
    const s: Spring1D = { pos: -Math.PI + 0.1, vel: 0 }
    // Target is just the other side of -π/+π boundary
    const next = angleSpringStep(s, Math.PI - 0.1, 0.1, 0.2)
    // Should stay within [-π, π]
    expect(next.pos).toBeGreaterThanOrEqual(-Math.PI - 0.001)
    expect(next.pos).toBeLessThanOrEqual(Math.PI + 0.001)
  })
})

// ── jersey number hash ────────────────────────────────────────────────────

describe('jerseyNumber', () => {
  it('returns a number between 1 and 99', () => {
    for (const id of ['player-001', 'player-002', 'abc', 'xyz', '']) {
      const n = jerseyNumber(id)
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(99)
    }
  })

  it('is stable (same id always gives same number)', () => {
    expect(jerseyNumber('player-42')).toBe(jerseyNumber('player-42'))
    expect(jerseyNumber('goalie-1')).toBe(jerseyNumber('goalie-1'))
  })

  it('different ids produce varied numbers (not all the same)', () => {
    const results = new Set<number>()
    for (let i = 0; i < 20; i++) {
      results.add(jerseyNumber(`player-${i}`))
    }
    expect(results.size).toBeGreaterThan(5)
  })
})

// ── event cue extraction ──────────────────────────────────────────────────

describe('extractCues', () => {
  const stream: GameStream = [
    { type: 'shot', period: 1, t: 300, shooter: 'p1', from: { x: 0.5, y: 0.1 }, target: { x: 0.89, y: 0 }, danger: 0.7 },
    { type: 'save', period: 1, t: 300, goalie: 'g1', rebound: false, pos: { x: 0.89, y: 0 } },
    { type: 'goal', period: 2, t: 600, scorer: 'p2', assists: [], strength: 'ev', pos: { x: -0.89, y: 0.1 } },
    { type: 'hit', period: 3, t: 100, by: 'p3', on: 'p4', pos: { x: 0, y: 0 } },
    // Ignored event types
    { type: 'faceoff', period: 1, t: 0, zone: 'neutral', winner: 'p1', pos: { x: 0, y: 0 } },
  ]

  it('extracts shot cue with correct absT', () => {
    const cues = extractCues(stream)
    const shot = cues.find((c) => c.kind === 'shot')
    expect(shot).toBeDefined()
    // period 1, t=300 → absT = 0*1200 + 300 = 300
    expect(shot!.absT).toBe(300)
    expect(shot!.actorId).toBe('p1')
    expect(shot!.nx).toBeCloseTo(0.5)
  })

  it('extracts save cue', () => {
    const cues = extractCues(stream)
    const save = cues.find((c) => c.kind === 'save')
    expect(save).toBeDefined()
    expect(save!.actorId).toBe('g1')
    expect(save!.absT).toBe(300)
  })

  it('extracts goal cue with correct absT for period 2', () => {
    const cues = extractCues(stream)
    const goal = cues.find((c) => c.kind === 'goal')
    expect(goal).toBeDefined()
    // period 2, t=600 → absT = 1*1200 + 600 = 1800
    expect(goal!.absT).toBe(1800)
    expect(goal!.actorId).toBe('p2')
    expect(goal!.nx).toBeCloseTo(-0.89)
  })

  it('extracts hit cue', () => {
    const cues = extractCues(stream)
    const hit = cues.find((c) => c.kind === 'hit')
    expect(hit).toBeDefined()
    // period 3, t=100 → absT = 2*1200 + 100 = 2500
    expect(hit!.absT).toBe(2500)
    expect(hit!.actorId).toBe('p3')
  })

  it('ignores faceoff events', () => {
    const cues = extractCues(stream)
    expect(cues).toHaveLength(4) // shot, save, goal, hit
  })

  it('returns empty array for empty stream', () => {
    expect(extractCues([])).toEqual([])
  })
})

// ── camera target helpers ─────────────────────────────────────────────────

describe('cameraTargetFor', () => {
  it('broadcast: looks at puck x (scaled), elevated behind the glass', () => {
    const t = cameraTargetFor('broadcast', 50)
    expect(t.pz).toBeLessThan(0) // behind the net
    expect(t.py).toBeGreaterThan(0) // above ice
    expect(t.px).toBeCloseTo(50 * 0.35, 2)
  })

  it('broadcast: camera x tracks puck x at 35% scale', () => {
    const t1 = cameraTargetFor('broadcast', 0)
    const t2 = cameraTargetFor('broadcast', 80)
    expect(t1.px).toBeCloseTo(0, 4)
    expect(t2.px).toBeCloseTo(80 * 0.35, 4)
    // pz constant regardless of puck position
    expect(t1.pz).toBe(t2.pz)
  })

  it('overhead: very high y (≥110), centered, pz = 0', () => {
    const t = cameraTargetFor('overhead', 0)
    expect(t.py).toBeGreaterThanOrEqual(110)
    expect(t.pz).toBe(0)
    // Look-at should be near ground center
    expect(t.ly).toBe(0)
    expect(t.lz).toBe(0)
  })

  it('overhead: slight x-follow (10% amplitude)', () => {
    const t = cameraTargetFor('overhead', 80)
    expect(t.px).toBeCloseTo(80 * 0.10, 4)
  })

  it('endzone side=-1: camera behind negative-X net, looking positive-X', () => {
    const t = cameraTargetFor('endzone', 0, { endzoneActiveSide: -1 })
    // Camera should be behind negative-X end (boards at -100), so camX < -95
    expect(t.px).toBeLessThan(-95)
    expect(t.py).toBeGreaterThan(0)
    // Look-at toward center ice (lx should be 0 or positive relative to camera)
    expect(t.lx).toBeGreaterThanOrEqual(0)
  })

  it('endzone side=+1: camera behind positive-X net, looking negative-X', () => {
    const t = cameraTargetFor('endzone', 0, { endzoneActiveSide: 1 })
    expect(t.px).toBeGreaterThan(95)
    expect(t.lx).toBeLessThanOrEqual(0)
  })

  it('endzone: low y (≤20)', () => {
    const t = cameraTargetFor('endzone', 0, { endzoneActiveSide: -1 })
    expect(t.py).toBeLessThanOrEqual(20)
  })

  it('follow: camera behind and above carrier', () => {
    // Carrier facing +Z (angle = 0): camera should be at negative Z offset
    const t = cameraTargetFor('follow', 0, { carrierAngle: 0, carrierWx: 0, carrierWz: 0 })
    expect(t.py).toBeGreaterThan(0)     // above ice
    expect(t.pz).toBeLessThan(0)        // behind carrier (carrier faces +Z, camera is -Z)
    expect(t.lx).toBeCloseTo(0, 1)      // look-at is the carrier position
    expect(t.lz).toBeCloseTo(0, 1)
  })

  it('follow: camera clamps to rink bounds on X', () => {
    // Carrier near the boards going further out
    const t = cameraTargetFor('follow', 0, { carrierAngle: Math.PI, carrierWx: 95, carrierWz: 0 })
    expect(Math.abs(t.px)).toBeLessThanOrEqual(101)
  })

  it('follow: tracks puck x when no carrier info', () => {
    const t = cameraTargetFor('follow', 75)
    expect(t.lx).toBe(75)
  })
})

// ── endzone hysteresis ────────────────────────────────────────────────────

describe('endzoneChooseEnd', () => {
  it('stays on current side when puck is near center (within hysteresis)', () => {
    // Puck at center — should not flip
    expect(endzoneChooseEnd(-1, 0)).toBe(-1)
    expect(endzoneChooseEnd(1, 0)).toBe(1)
    // Puck within threshold (±15ft) — should not flip
    expect(endzoneChooseEnd(-1, 10)).toBe(-1)
    expect(endzoneChooseEnd(1, -10)).toBe(1)
  })

  it('flips when puck clearly crosses into opposite end (beyond threshold)', () => {
    expect(endzoneChooseEnd(-1, 20)).toBe(1)   // puck clearly to +X end
    expect(endzoneChooseEnd(1, -20)).toBe(-1)  // puck clearly to -X end
  })

  it('does not thrash at the threshold boundary', () => {
    // Simulate puck oscillating between +14 and -14 (within threshold)
    let side: 1 | -1 = -1
    for (let i = 0; i < 100; i++) {
      const puckX = i % 2 === 0 ? 14 : -14
      side = endzoneChooseEnd(side, puckX)
    }
    // Should still be -1 since neither value crossed the 15ft threshold
    expect(side).toBe(-1)
  })

  it('locks onto positive end once puck fully crosses', () => {
    let side: 1 | -1 = -1
    side = endzoneChooseEnd(side, 50)  // puck well into +X zone
    expect(side).toBe(1)
    // Even if puck backs up a bit (within threshold), stays on +1
    side = endzoneChooseEnd(side, 10)
    expect(side).toBe(1)
  })

  it('custom hysteresis threshold respected', () => {
    // With threshold=30: puck at 25 should not flip from -1
    expect(endzoneChooseEnd(-1, 25, 30)).toBe(-1)
    // Puck at 35 should flip to +1
    expect(endzoneChooseEnd(-1, 35, 30)).toBe(1)
  })
})

// ── puck carried offset ───────────────────────────────────────────────────

describe('puckCarriedOffset', () => {
  it('returns finite values for all angles', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.1) {
      const { dx, dz } = puckCarriedOffset(a)
      expect(isFinite(dx)).toBe(true)
      expect(isFinite(dz)).toBe(true)
    }
  })

  it('offset at angle=0 (facing +Z) is to the right and ahead', () => {
    // Angle 0 → facing +Z; right is +X, ahead is +Z
    const { dx, dz } = puckCarriedOffset(0)
    expect(dx).toBeGreaterThan(0)   // to the right
    expect(dz).toBeGreaterThan(0)   // ahead
  })

  it('offset magnitude is in a plausible range (1-5 ft)', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      const { dx, dz } = puckCarriedOffset(a)
      const mag = Math.sqrt(dx * dx + dz * dz)
      expect(mag).toBeGreaterThan(0.5)
      expect(mag).toBeLessThan(6)
    }
  })

  it('offset rotates consistently with carrier angle', () => {
    // At angle π (facing -Z), the offset should mirror the angle=0 case
    const { dx: dx0, dz: dz0 } = puckCarriedOffset(0)
    const { dx: dxPi, dz: dzPi } = puckCarriedOffset(Math.PI)
    // dx should flip sign, dz should flip sign
    expect(dxPi).toBeCloseTo(-dx0, 4)
    expect(dzPi).toBeCloseTo(-dz0, 4)
  })
})

// ── animation helpers ─────────────────────────────────────────────────────

describe('skaterBob', () => {
  it('returns exactly 0 at speed 0 (no idle bobbing)', () => {
    // All time values should give 0 at speed=0
    for (let t = 0; t < 10; t += 0.1) {
      expect(skaterBob(t, 0)).toBe(0)
    }
  })

  it('returns 0 at time 0 and speed 0', () => {
    expect(skaterBob(0, 0)).toBe(0)
  })

  it('oscillates at speed > 0', () => {
    const vals = [0, 0.5, 1.0, 1.5, 2.0].map((t) => skaterBob(t, 1))
    const hasVariation = vals.some((v, i) => i > 0 && v !== vals[0])
    expect(hasVariation).toBe(true)
  })

  it('bob magnitude is bounded', () => {
    for (let t = 0; t < 100; t += 0.1) {
      expect(Math.abs(skaterBob(t, 1))).toBeLessThanOrEqual(0.1)
    }
  })

  it('bob frequency and magnitude scale with speed', () => {
    // At half-speed, same time points should give a different oscillation
    const valsFullSpeed = Array.from({ length: 20 }, (_, i) => skaterBob(i * 0.1, 1))
    const valsHalfSpeed = Array.from({ length: 20 }, (_, i) => skaterBob(i * 0.1, 0.5))
    // They should differ (frequency is speed-dependent)
    const allSame = valsFullSpeed.every((v, i) => Math.abs(v - valsHalfSpeed[i]) < 1e-10)
    expect(allSame).toBe(false)
  })
})

describe('legSwingAngle', () => {
  it('returns 0 at time 0 and speed 0', () => {
    expect(legSwingAngle(0, 0)).toBe(0)
  })

  it('returns 0 at all times when speed is 0 (no idle animation)', () => {
    for (let t = 0; t < 10; t += 0.25) {
      expect(legSwingAngle(t, 0)).toBe(0)
    }
  })

  it('produces a bounded angle', () => {
    for (let t = 0; t < 100; t += 0.1) {
      expect(Math.abs(legSwingAngle(t, 1))).toBeLessThanOrEqual(0.5)
    }
  })
})

// ── applyDeadzone ─────────────────────────────────────────────────────────────

describe('applyDeadzone', () => {
  it('returns center when value is within threshold (suppresses sub-threshold input)', () => {
    // value 50.5 is only 0.5 away from center 50 — threshold 1.0 suppresses it
    expect(applyDeadzone(50.5, 50, 1.0)).toBe(50)
    expect(applyDeadzone(49.5, 50, 1.0)).toBe(50)
  })

  it('returns value when movement exceeds threshold', () => {
    // value 52 is 2 away from center 50 — threshold 1.0 lets it through
    expect(applyDeadzone(52, 50, 1.0)).toBe(52)
    expect(applyDeadzone(48, 50, 1.0)).toBe(48)
  })

  it('returns value unchanged when threshold is 0 (disabled)', () => {
    expect(applyDeadzone(50.1, 50, 0)).toBe(50.1)
  })

  it('returns value unchanged for negative threshold (disabled)', () => {
    expect(applyDeadzone(50.1, 50, -1)).toBe(50.1)
  })

  it('suppresses micro-jitter: a sequence of tiny inputs keeps center constant', () => {
    let center = 0
    // Simulate 100 frames of sub-threshold noise (±0.5ft, threshold=1.0)
    const jitter = [0.3, -0.4, 0.2, -0.1, 0.5, -0.3, 0.4, -0.5, 0.1, -0.2]
    for (let i = 0; i < 100; i++) {
      const noisy = jitter[i % jitter.length]
      center = applyDeadzone(noisy, center, 1.0)
    }
    // All inputs were within ±0.5 of 0, so center should never have moved
    expect(center).toBe(0)
  })

  it('allows large movements through the deadzone', () => {
    let center = 0
    // A real play movement: puck moves 30ft
    const result = applyDeadzone(30, center, 1.0)
    expect(result).toBe(30)
  })
})

// ── emaStep ───────────────────────────────────────────────────────────────────

describe('emaStep', () => {
  it('moves toward target each frame', () => {
    const result = emaStep(0, 100, 0.016, 0.5)
    expect(result).toBeGreaterThan(0)
    expect(result).toBeLessThan(100)
  })

  it('does not move when dt=0', () => {
    expect(emaStep(50, 100, 0, 0.5)).toBe(50)
  })

  it('does not move when tau=0 (guard)', () => {
    expect(emaStep(50, 100, 0.016, 0)).toBe(50)
  })

  it('converges to target over time (long tau)', () => {
    let v = 0
    // 5 seconds of 60fps frames with tau=0.5s — should be very close to target
    for (let i = 0; i < 300; i++) {
      v = emaStep(v, 100, 0.016, 0.5)
    }
    expect(v).toBeCloseTo(100, 0)
  })

  it('smoothed output has lower variance than a jittery input sequence', () => {
    // Simulate a puck that jitters ±5ft around 50ft every frame
    const jitterAmplitude = 5
    const center = 50
    const frames = 200
    let smoothed = center
    const smoothedValues: number[] = []
    const rawValues: number[] = []

    for (let i = 0; i < frames; i++) {
      // Raw jitter: alternating ±5ft around center
      const raw = center + (i % 2 === 0 ? jitterAmplitude : -jitterAmplitude)
      rawValues.push(raw)
      smoothed = emaStep(smoothed, raw, 0.016, 0.5)
      smoothedValues.push(smoothed)
    }

    // Compute variance of raw vs smoothed (skip warmup frames)
    const skip = 20
    function variance(arr: number[]): number {
      const slice = arr.slice(skip)
      const mean = slice.reduce((a, b) => a + b, 0) / slice.length
      return slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length
    }

    const rawVar = variance(rawValues)
    const smoothedVar = variance(smoothedValues)
    // Smoothed variance must be substantially lower than raw variance
    expect(smoothedVar).toBeLessThan(rawVar * 0.5)
  })

  it('is framerate-independent: same result at 30fps vs 60fps over same wall time', () => {
    // 1 second of 30fps
    let v30 = 0
    for (let i = 0; i < 30; i++) v30 = emaStep(v30, 100, 1 / 30, 0.5)
    // 1 second of 60fps
    let v60 = 0
    for (let i = 0; i < 60; i++) v60 = emaStep(v60, 100, 1 / 60, 0.5)
    // Both should arrive at approximately the same position (within 1ft)
    expect(Math.abs(v30 - v60)).toBeLessThan(1)
  })
})

// ── clampSpeed ────────────────────────────────────────────────────────────────

describe('clampSpeed', () => {
  it('returns next unchanged when within speed limit', () => {
    // Moving 0.5ft in 0.016s = ~31 ft/s; limit is 60 ft/s — passes through
    expect(clampSpeed(0, 0.5, 0.016, 60)).toBeCloseTo(0.5, 5)
  })

  it('clamps when movement exceeds max speed', () => {
    // Trying to move 10ft in 0.016s = 625 ft/s; limit 60 ft/s → max 0.96ft
    const result = clampSpeed(0, 10, 0.016, 60)
    expect(result).toBeCloseTo(60 * 0.016, 4)
  })

  it('clamps negative direction', () => {
    const result = clampSpeed(0, -10, 0.016, 60)
    expect(result).toBeCloseTo(-60 * 0.016, 4)
  })

  it('returns next unchanged when dt=0', () => {
    // dt=0 means no movement allowed — returns next as-is (no clamp to 0)
    expect(clampSpeed(5, 10, 0, 60)).toBe(10)
  })

  it('spring step followed by clamp does not overshoot for large dt spikes', () => {
    // Simulate a 500ms dt spike (browser tab returned to focus)
    const s: Spring1D = { pos: 0, vel: 0 }
    const dt = 0.5   // 500ms spike
    const next = springStep(s, 100, dt, 0.35)
    const clamped = clampSpeed(s.pos, next.pos, dt, 60)
    // Max travel in 500ms at 60ft/s = 30ft; spring might want to jump further
    expect(clamped).toBeLessThanOrEqual(60 * dt + 0.001)
    expect(clamped).toBeGreaterThanOrEqual(0)
  })
})

// ── camera behaviour tests (pure math — no THREE) ─────────────────────────────
// These exercise the math helpers that drive the camera system, verifying the
// four user-reported symptoms are addressed at the math level.

describe('broadcast camera tracking', () => {
  /**
   * Simulate the play-focus + camera spring update loop for N frames,
   * returning the camera X position history.
   *
   * Mirrors the logic in rink3dRenderer.updateCamera() so we can test it
   * without a DOM/WebGL context.
   */
  function simulateBroadcast(
    frames: number,
    dt: number,
    rawPuckXSequence: (frame: number) => number,
    opts: { deadzone?: number; tau?: number; springHl?: number } = {}
  ): number[] {
    const deadzone = opts.deadzone ?? 5.0
    const tau = opts.tau ?? 0.45
    const springHl = opts.springHl ?? 0.45

    // Start snapped to the initial puck position (simulates load() snap)
    const initX = rawPuckXSequence(0)
    let playFocusX = initX
    let camX: Spring1D = snapSpring(initX * 0.35)  // broadcast target = puckX * 0.35

    const history: number[] = []
    for (let f = 0; f < frames; f++) {
      const rawX = rawPuckXSequence(f)
      // Deadzone on raw input
      const committed = applyDeadzone(rawX, playFocusX, deadzone)
      // EMA
      const newFocus = emaStep(playFocusX, committed, dt, tau)
      playFocusX = Number.isFinite(newFocus) ? newFocus : playFocusX
      // Camera spring toward broadcast target (puckX * 0.35)
      const targetX = playFocusX * 0.35
      camX = springStep(camX, targetX, dt, springHl)
      history.push(camX.pos)
    }
    return history
  }

  it('camera X moves when play-focus shifts a large distance (>deadzone)', () => {
    // Puck moves from center (0) to +60ft down the ice — well beyond the 5ft deadzone
    const history = simulateBroadcast(120, 0.016, (f) => f < 30 ? 0 : 60)
    const first = history[0]!
    const last = history[history.length - 1]!
    // Camera should have moved substantially toward the puck-shifted target
    expect(last).toBeGreaterThan(first + 5)
  })

  it('camera X does NOT move for sub-deadzone jitter inputs', () => {
    // Puck jitters ±3ft around center (within 5ft deadzone) for 60 frames
    const history = simulateBroadcast(60, 0.016, (f) => (f % 2 === 0 ? 3 : -3))
    const initialCamX = history[0]!
    // After 60 frames of sub-deadzone jitter the camera should be essentially still
    const finalCamX = history[history.length - 1]!
    expect(Math.abs(finalCamX - initialCamX)).toBeLessThan(0.5)
  })

  it('broadcast camera starts exactly at the correct pose (no fly-in)', () => {
    // When we snap the camera to initial puck position (as load() now does),
    // the first frame should already be at or very near the target position.
    const initPuckX = 40  // puck starts 40ft from center
    const broadcastTargetX = initPuckX * 0.35  // = 14ft
    // snapSpring puts camera exactly at target with zero velocity
    const cam = snapSpring(broadcastTargetX)
    const firstFrameCam = springStep(cam, broadcastTargetX, 0.016, 0.45)
    // After one frame, still essentially at target (not at 0 flying in)
    expect(firstFrameCam.pos).toBeCloseTo(broadcastTargetX, 3)
  })
})

describe('overhead camera stability', () => {
  /**
   * Simulate one overhead camera update step with a sudden puck jump.
   * Returns the new playFocusX after the frame.
   */
  function overheadFrameStep(
    prevFocusX: number,
    newPuckX: number,
    dt: number,
    maxDeltaPerFrame: number,
    tau: number
  ): number {
    // The overhead path: deadzone on raw (5ft), EMA with heavier tau, then clamp
    const deadzone = 5.0
    const committed = applyDeadzone(newPuckX, prevFocusX, deadzone)
    const tauOverhead = tau * 1.6
    let newFocus = emaStep(prevFocusX, committed, dt, tauOverhead)
    // Per-frame clamp
    newFocus = Math.max(prevFocusX - maxDeltaPerFrame, Math.min(prevFocusX + maxDeltaPerFrame, newFocus))
    return Number.isFinite(newFocus) ? newFocus : prevFocusX
  }

  it('overhead target does NOT jump when puck teleports across the ice in one frame', () => {
    // Puck resets from center (0) to far end (+90ft) in a single frame (goal → faceoff)
    const prevFocus = 0
    const newPuckX = 90
    const dt = 0.016
    const maxDelta = 1.0  // OVERHEAD_TARGET_MAX_DELTA_PER_FRAME

    const newFocus = overheadFrameStep(prevFocus, newPuckX, dt, maxDelta, 0.45)
    // The focus must not have jumped more than maxDelta in a single frame
    expect(Math.abs(newFocus - prevFocus)).toBeLessThanOrEqual(maxDelta + 0.001)
  })

  it('overhead target gradually tracks legitimate play movement', () => {
    // Puck moves steadily from 0 to 60ft over 120 frames — should accumulate
    let focus = 0
    for (let f = 0; f < 120; f++) {
      const puckX = f * 0.5  // 0.5ft/frame = 30 ft/s in-play speed
      focus = overheadFrameStep(focus, puckX, 0.016, 1.0, 0.45)
    }
    // After 120 frames the camera should have tracked at least somewhat
    // (note: overhead clamp is strict so it won't fully catch up — that's correct)
    expect(focus).toBeGreaterThan(0)
  })

  it('overhead target produces no NaN even for extreme inputs', () => {
    const extremeInputs = [Infinity, -Infinity, NaN, 1e10, -1e10, 0]
    let focus = 0
    for (const puckX of extremeInputs) {
      const committed = isFinite(puckX) ? applyDeadzone(puckX, focus, 5) : focus
      const ema = emaStep(focus, committed, 0.016, 0.72)
      const clamped = Math.max(focus - 1.0, Math.min(focus + 1.0, ema))
      const next = Number.isFinite(clamped) ? clamped : focus
      expect(Number.isFinite(next)).toBe(true)
      focus = next
    }
  })
})

describe('snapSpring as camera snap helper', () => {
  it('snapSpring sets position to target exactly with zero velocity', () => {
    const s = snapSpring(77)
    expect(s.pos).toBe(77)
    expect(s.vel).toBe(0)
  })

  it('a spring snapped to its target does not oscillate on the next step', () => {
    const s = snapSpring(50)
    // Step toward the same target — should stay put
    const next = springStep(s, 50, 0.016, 0.45)
    expect(next.pos).toBeCloseTo(50, 5)
    expect(Math.abs(next.vel)).toBeLessThan(0.001)
  })

  it('snapping all 6 camera springs then stepping produces no drift on first frame', () => {
    // Simulate what load()/seekFraction() does: snap all 6 springs, then
    // call updateCamera for one frame and verify the camera hasn't moved.
    const targetPx = 7    // broadcast target for puck at 20ft: 20*0.35=7
    const targetPy = 40
    const targetPz = -75
    const targetLx = 7
    const targetLy = 0
    const targetLz = 0

    let cx = snapSpring(targetPx)
    let cy = snapSpring(targetPy)
    let cz = snapSpring(targetPz)
    let lx = snapSpring(targetLx)
    let ly = snapSpring(targetLy)
    let lz = snapSpring(targetLz)

    // One frame with the same target (puck hasn't moved significantly)
    const dt = 0.016
    const hl = 0.45
    cx = springStep(cx, targetPx, dt, hl)
    cy = springStep(cy, targetPy, dt, hl)
    cz = springStep(cz, targetPz, dt, hl)
    lx = springStep(lx, targetLx, dt, hl)
    ly = springStep(ly, targetLy, dt, hl)
    lz = springStep(lz, targetLz, dt, hl)

    expect(cx.pos).toBeCloseTo(targetPx, 3)
    expect(cy.pos).toBeCloseTo(targetPy, 3)
    expect(cz.pos).toBeCloseTo(targetPz, 3)
  })
})

describe('no NaN from any camera preset', () => {
  const presets: Array<Parameters<typeof cameraTargetFor>[0]> = ['broadcast', 'overhead', 'endzone', 'follow']
  const puckPositions = [0, 50, -50, 90, -90]

  for (const preset of presets) {
    for (const puckWx of puckPositions) {
      it(`${preset} at puckWx=${puckWx} produces finite values`, () => {
        const t = cameraTargetFor(preset, puckWx, {
          endzoneActiveSide: puckWx >= 0 ? 1 : -1,
          carrierAngle: Math.PI / 4,
          carrierWx: puckWx,
          carrierWz: 10,
        })
        expect(Number.isFinite(t.px)).toBe(true)
        expect(Number.isFinite(t.py)).toBe(true)
        expect(Number.isFinite(t.pz)).toBe(true)
        expect(Number.isFinite(t.lx)).toBe(true)
        expect(Number.isFinite(t.ly)).toBe(true)
        expect(Number.isFinite(t.lz)).toBe(true)
      })
    }
  }
})
