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
