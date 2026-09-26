/**
 * Unit tests for the pure helpers behind the 3D graphics upgrade:
 * kit palette, athlete kinematics (stride / goalie / IK / facing),
 * presentation envelopes, rounded-rink geometry.
 */
import { describe, it, expect } from 'vitest'
import { kitFor, luminance, shade, mix, rgb, css } from './palette'
import {
  RIG,
  legDrop,
  strideRateHz,
  advanceStridePhase,
  skaterPose,
  goaliePose,
  solveTwoBone,
  celebrationWeight,
  crowdExcitement,
  facingTarget,
} from './pose'
import { rinkOutline, outlineLength, roundedRectPerimeter, sweepProfile, stationsAlong } from './rinkShape'
import { cameraFovFor, celebrationTarget, cameraTargetFor, softDeadzone, emaStep, springStep, clampSpeed, type Spring1D } from './math'
import { mulberry32 } from './rng'

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

// ── palette ─────────────────────────────────────────────────────────────────

describe('kit palette', () => {
  it('visitors wear white with team-colored trim (NHL convention)', () => {
    const k = kitFor(0xc8102e, 'away')
    expect(luminance(k.jersey)).toBeGreaterThan(0.9)
    expect(k.trim).toBe(0xc8102e)
    expect(k.number).toBe(0xc8102e)
  })

  it('home wears the team color', () => {
    expect(kitFor(0x1f4fbf, 'home').jersey).toBe(0x1f4fbf)
  })

  it('home and away sweaters always contrast strongly, even for similar team colors', () => {
    for (const [a, b] of [[0x1f4fbf, 0x2a5cc8], [0xc8102e, 0xb01020], [0x111111, 0x222222]] as const) {
      const h = kitFor(a, 'home').jersey
      const w = kitFor(b, 'away').jersey
      expect(Math.abs(luminance(h) - luminance(w))).toBeGreaterThan(0.4)
    }
  })

  it('breezers are darker than the sweater color (no more channel-bleed colors)', () => {
    for (const c of [0x1f4fbf, 0xffcc00, 0x00a0e0, 0xc8102e]) {
      const k = kitFor(c, 'home')
      expect(luminance(k.pants)).toBeLessThan(luminance(c))
      // hue family preserved: the dominant channel stays dominant
      const src = rgb(c)
      const dst = rgb(k.pants)
      const maxI = src.indexOf(Math.max(...src))
      expect(dst[maxI]).toBe(Math.max(...dst))
    }
  })

  it('a light home color gets dark numbers so they stay readable', () => {
    const k = kitFor(0xffe14d, 'home')
    expect(luminance(k.number)).toBeLessThan(luminance(k.jersey))
  })

  it('color helpers', () => {
    expect(shade(0x808080, 0.5)).toBe(0x404040)
    expect(mix(0x000000, 0xffffff, 0.5)).toBe(0x808080)
    expect(css(0x0a0b0c)).toBe('#0a0b0c')
  })
})

// ── stride ──────────────────────────────────────────────────────────────────

describe('skating stride', () => {
  it('cadence is zero at rest and rises with speed', () => {
    expect(strideRateHz(0)).toBe(0)
    expect(strideRateHz(0.02)).toBe(0)
    expect(strideRateHz(0.5)).toBeLessThan(strideRateHz(1))
  })

  it('phase is integrated: a speed change never jumps the legs', () => {
    let p = 1
    const before = p
    p = advanceStridePhase(p, 0.2, 1 / 60)
    const small = p - before
    const p2 = advanceStridePhase(p, 1.0, 1 / 60)
    // one frame moves the phase by at most 2π·f·dt, whatever the speed history
    expect(small).toBeLessThan(2 * Math.PI * strideRateHz(0.2) / 60 + 1e-9)
    expect(p2 - p).toBeLessThan(2 * Math.PI * strideRateHz(1) / 60 + 1e-9)
  })

  it('standing still: both legs identical, no sway, no bank', () => {
    const b = skaterPose(1.3, 0, 0)
    expect(b.left).toEqual(b.right)
    expect(b.stickSway).toBe(0)
    expect(b.torsoYaw).toBe(0)
    expect(b.bodyRoll).toBe(0)
  })

  it('the lower (supporting) skate is always exactly on the ice — never below it', () => {
    for (let ph = 0; ph < Math.PI * 2; ph += 0.2) {
      for (const s of [0, 0.3, 0.7, 1]) {
        const b = skaterPose(ph, s, 0)
        const lowFoot = b.hipHeight - Math.max(legDrop(b.left), legDrop(b.right)) - RIG.skate
        expect(lowFoot).toBeCloseTo(0, 9)
        // the other skate is on or above the ice
        const otherFoot = b.hipHeight - Math.min(legDrop(b.left), legDrop(b.right)) - RIG.skate
        expect(otherFoot).toBeGreaterThanOrEqual(-1e-9)
      }
    }
  })

  it('legs alternate: at full speed one leg pushes out while the other recovers', () => {
    const b = skaterPose(Math.PI / 2, 1, 0)
    expect(b.left.abduct).toBeGreaterThan(b.right.abduct + 0.2)
    expect(b.right.knee).toBeGreaterThan(b.left.knee)
  })

  it('faster skating crouches lower and leans further forward', () => {
    const slow = skaterPose(0, 0.1, 0)
    const fast = skaterPose(0, 1, 0)
    expect(fast.lean).toBeGreaterThan(slow.lean)
    expect(fast.hipHeight).toBeLessThan(slow.hipHeight)
  })

  it('blade stays flat: ankle cancels the shin pitch', () => {
    const b = skaterPose(0.9, 0.8, 0)
    for (const l of [b.left, b.right]) expect(l.ankle).toBeCloseTo(l.knee - l.flex, 12)
  })

  it('banks into turns, bounded', () => {
    expect(skaterPose(0, 1, 2).bodyRoll).toBeGreaterThan(0)
    expect(skaterPose(0, 1, -2).bodyRoll).toBeLessThan(0)
    expect(Math.abs(skaterPose(0, 1, 50).bodyRoll)).toBeLessThanOrEqual(0.4)
  })
})

describe('goalie stance', () => {
  it('butterfly drops the hips and flares the pads', () => {
    const ready = goaliePose(0)
    const fly = goaliePose(1)
    expect(fly.hipHeight).toBeLessThan(ready.hipHeight - 0.8)
    expect(fly.left.splay).toBeGreaterThan(1)
    expect(ready.left.splay).toBe(0)
  })

  it('is continuous across the blend', () => {
    let prev = goaliePose(0).hipHeight
    for (let b = 0.05; b <= 1.0001; b += 0.05) {
      const h = goaliePose(b).hipHeight
      expect(Math.abs(h - prev)).toBeLessThan(0.25)
      prev = h
    }
  })
})

// ── IK ──────────────────────────────────────────────────────────────────────

describe('solveTwoBone', () => {
  const root = { x: 0, y: 5, z: 0 }
  it('keeps both bone lengths and reaches a reachable target', () => {
    const target = { x: 0.8, y: 3.8, z: 1.1 }
    const { elbow, hand } = solveTwoBone(root, target, 1.05, 0.98, { x: 2, y: 4, z: -1 })
    expect(dist(root, elbow)).toBeCloseTo(1.05, 6)
    expect(dist(elbow, hand)).toBeCloseTo(0.98, 6)
    expect(dist(hand, target)).toBeCloseTo(0, 6)
  })

  it('clamps an out-of-reach target onto the reach sphere (no stretched arm)', () => {
    const { elbow, hand } = solveTwoBone(root, { x: 10, y: 5, z: 0 }, 1, 1, { x: 0, y: 0, z: 0 })
    expect(dist(root, hand)).toBeLessThanOrEqual(2)
    expect(dist(root, elbow)).toBeCloseTo(1, 6)
  })

  it('bends toward the pole', () => {
    const { elbow } = solveTwoBone(root, { x: 0, y: 3.6, z: 0 }, 1, 1, { x: 5, y: 4.3, z: 0 })
    expect(elbow.x).toBeGreaterThan(0.3)
  })

  it('never produces NaN, even with a collinear pole or zero-length reach', () => {
    for (const t of [root, { x: 0, y: 3, z: 0 }]) {
      const { elbow, hand } = solveTwoBone(root, t, 1, 1, { x: 0, y: 1, z: 0 })
      for (const v of [elbow.x, elbow.y, elbow.z, hand.x, hand.y, hand.z]) expect(Number.isFinite(v)).toBe(true)
    }
  })
})

// ── facing ──────────────────────────────────────────────────────────────────

describe('facingTarget', () => {
  it('carrier faces where he skates, and holds still when idle', () => {
    expect(facingTarget(1, 15, -2, true)).toBe(1)
    expect(facingTarget(1, 0.5, -2, true)).toBeNull()
  })

  it('a slow glider squares up to the puck', () => {
    expect(facingTarget(0, 1, 1.2, false)).toBeCloseTo(1.2, 6)
  })

  it('a fast skater faces his skating direction', () => {
    expect(facingTarget(0.4, 25, 0.9, false)).toBeCloseTo(0.4, 6)
  })

  it('backing up against the play keeps facing the puck (backward skating)', () => {
    // skating at +π, puck at 0 → he is retreating; faces the puck
    expect(facingTarget(Math.PI, 12, 0, false)).toBeCloseTo(0, 6)
  })

  it('is continuous in speed (no swivel flicker at a threshold)', () => {
    let prev = facingTarget(0.8, 0, 0, false)!
    for (let s = 0.25; s <= 30; s += 0.25) {
      const f = facingTarget(0.8, s, 0, false)!
      expect(Math.abs(f - prev)).toBeLessThan(0.12)
      prev = f
    }
  })
})

// ── presentation ────────────────────────────────────────────────────────────

describe('celebration + crowd envelopes', () => {
  it('celebration cam eases in and out — zero at both ends, never a hard cut', () => {
    expect(celebrationWeight(0)).toBe(0)
    expect(celebrationWeight(4.2)).toBe(0)
    expect(celebrationWeight(2)).toBe(1)
    let prev = 0
    for (let t = 0; t <= 4.2; t += 1 / 60) {
      const w = celebrationWeight(t)
      expect(Math.abs(w - prev)).toBeLessThan(0.05)
      prev = w
    }
  })

  it('crowd surges on a goal then settles', () => {
    expect(crowdExcitement(-1)).toBe(0)
    expect(crowdExcitement(0.25)).toBeCloseTo(1, 6)
    expect(crowdExcitement(10)).toBeLessThan(0.2)
    expect(crowdExcitement(Infinity)).toBe(0)
  })

  it('celebration framing is tighter and lower than the broadcast shot', () => {
    const b = cameraTargetFor('broadcast', 60)
    const c = celebrationTarget(60, 10)
    expect(c.fov).toBeLessThan(cameraFovFor('broadcast'))
    expect(c.py).toBeLessThan(b.py)
    expect(c.lx).toBe(60)
  })

  it('broadcast is the long lens', () => {
    expect(cameraFovFor('broadcast')).toBeLessThan(cameraFovFor('endzone'))
    expect(cameraFovFor('broadcast')).toBeLessThan(cameraFovFor('follow'))
  })
})

// ── calm camera ─────────────────────────────────────────────────────────────

describe('springStep is truly critically damped', () => {
  it('a step gap halves in exactly one half-life and never overshoots', () => {
    let s: Spring1D = { pos: 10, vel: 0 }
    const dt = 1 / 240
    let t = 0
    let crossed = -1
    for (let i = 0; i < 2400; i++) {
      s = springStep(s, 0, dt, 0.5)
      t += dt
      if (crossed < 0 && s.pos <= 5) crossed = t
      expect(s.pos).toBeGreaterThanOrEqual(-1e-9)
    }
    expect(crossed).toBeCloseTo(0.5, 2)
  })

  it('is frame-rate independent (exact solution, not an integrator)', () => {
    let a: Spring1D = { pos: 7, vel: -3 }
    let b: Spring1D = { pos: 7, vel: -3 }
    for (let i = 0; i < 60; i++) a = springStep(a, 1, 1 / 60, 0.3)
    for (let i = 0; i < 240; i++) b = springStep(b, 1, 1 / 240, 0.3)
    expect(a.pos).toBeCloseTo(b.pos, 9)
    expect(a.vel).toBeCloseTo(b.vel, 9)
  })
})

describe('softDeadzone (calm broadcast follow)', () => {
  it('ignores motion inside the band', () => {
    expect(softDeadzone(3, 0, 6)).toBe(0)
    expect(softDeadzone(-5.9, 0, 6)).toBe(0)
  })

  it('follows only the excess beyond the band — continuous, no step', () => {
    expect(softDeadzone(6.5, 0, 6)).toBeCloseTo(0.5, 9)
    expect(softDeadzone(-10, 0, 6)).toBeCloseTo(-4, 9)
    // continuity across the band edge (the old hard deadzone jumped by `band`)
    const eps = 1e-6
    expect(Math.abs(softDeadzone(6 + eps, 0, 6) - softDeadzone(6 - eps, 0, 6))).toBeLessThan(1e-5)
  })

  it('full pipeline: a puck teleport (goal → centre-ice faceoff) becomes an even, overshoot-free pan', () => {
    // band → EMA → speed limit → critically damped spring, at 60 fps
    let focus = 80
    let cam: Spring1D = { pos: 80, vel: 0 }
    const dt = 1 / 60
    let maxStep = 0
    let prev = cam.pos
    let prevV = 0
    let maxAcc = 0
    for (let i = 0; i < 600; i++) {
      const committed = softDeadzone(0, focus, 6)
      focus = clampSpeed(focus, emaStep(focus, committed, dt, 0.9), dt, 40)
      cam = springStep(cam, focus, dt, 0.6)
      maxStep = Math.max(maxStep, Math.abs(cam.pos - prev))
      const v = (cam.pos - prev) / dt
      if (i > 0) maxAcc = Math.max(maxAcc, Math.abs(v - prevV) / dt)
      prevV = v
      prev = cam.pos
      expect(cam.pos).toBeGreaterThanOrEqual(6 - 1e-6) // never overshoots past the band edge
    }
    expect(maxStep / dt).toBeLessThan(70) // a pan, never a whip (old clamp was 60 ft/s on the camera)
    expect(maxAcc).toBeLessThan(120) // ft/s² — a smooth operator, not a whip-pan
  })
})

// ── rink geometry ───────────────────────────────────────────────────────────

describe('rounded rink outline', () => {
  const pts = rinkOutline(100, 42.5, 28, 16)

  it('matches the analytic rounded-rectangle perimeter (NHL 200×85, 28 ft corners)', () => {
    expect(outlineLength(pts)).toBeCloseTo(roundedRectPerimeter(100, 42.5, 28), 0)
  })

  it('stays inside the 200×85 box and touches every side', () => {
    const xs = pts.map((p) => p.x)
    const zs = pts.map((p) => p.z)
    expect(Math.max(...xs)).toBeCloseTo(100, 6)
    expect(Math.min(...xs)).toBeCloseTo(-100, 6)
    expect(Math.max(...zs)).toBeCloseTo(42.5, 6)
    expect(Math.min(...zs)).toBeCloseTo(-42.5, 6)
  })

  it('normals are unit length and point outward', () => {
    for (const p of pts) {
      expect(Math.hypot(p.nx, p.nz)).toBeCloseTo(1, 9)
      expect(p.x * p.nx + p.z * p.nz).toBeGreaterThan(0)
    }
  })

  it('corner points really are 28 ft from their corner centres', () => {
    const p = pts[8]! // mid first corner
    expect(Math.hypot(p.x - 72, p.z - 14.5)).toBeCloseTo(28, 6)
  })

  it('sweep produces a closed strip per profile segment', () => {
    const sw = sweepProfile(pts, [{ o: 0, y: 0 }, { o: 0, y: 3.5 }, { o: 0.75, y: 3.5 }], 96)
    const n = pts.length + 1
    expect(sw.positions.length).toBe(2 * n * 2 * 3)
    expect(sw.indices.length).toBe(2 * (n - 1) * 6)
    // every index in range
    const vcount = sw.positions.length / 3
    for (const i of sw.indices) expect(i).toBeLessThan(vcount)
    // u runs continuously to the full perimeter / period at the seam
    expect(sw.uvs[(n - 1) * 2 * 2]).toBeCloseTo(outlineLength(pts) / 96, 6)
  })

  it('stations are evenly spaced and lie on the outline', () => {
    const st = stationsAlong(pts, 8, 2)
    expect(st.length).toBe(Math.ceil((outlineLength(pts) - 2) / 8))
    for (const s of st) {
      const inBox = Math.abs(s.x) <= 100 + 1e-6 && Math.abs(s.z) <= 42.5 + 1e-6
      expect(inBox).toBe(true)
    }
  })
})

describe('rng', () => {
  it('is deterministic and in [0,1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 100; i++) {
      const v = a()
      expect(v).toBe(b())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
