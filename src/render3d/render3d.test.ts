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
  wrapAngle,
  jerseyNumber,
  extractCues,
  cameraTargetFor,
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

  it('overhead: very high y, centered', () => {
    const t = cameraTargetFor('overhead', 0)
    expect(t.py).toBeGreaterThan(80)
    expect(t.px).toBe(0)
    expect(t.pz).toBe(0)
  })

  it('endzone: low and behind net', () => {
    const t = cameraTargetFor('endzone', 20)
    expect(t.pz).toBeLessThan(-80)
    expect(t.py).toBeGreaterThan(0)
  })

  it('follow: tracks puck x', () => {
    const t = cameraTargetFor('follow', 75)
    expect(t.px).toBe(75)
    expect(t.lx).toBe(75)
  })
})

// ── animation helpers ─────────────────────────────────────────────────────

describe('skaterBob', () => {
  it('returns 0 at speed 0', () => {
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
})

describe('legSwingAngle', () => {
  it('returns 0 at time 0 and speed 0', () => {
    expect(legSwingAngle(0, 0)).toBe(0)
  })

  it('produces a bounded angle', () => {
    for (let t = 0; t < 100; t += 0.1) {
      expect(Math.abs(legSwingAngle(t, 1))).toBeLessThanOrEqual(0.5)
    }
  })
})
