/**
 * Unit tests for playbackDirector.ts — pure, node-safe.
 */
import { describe, it, expect } from 'vitest'
import type { GameStream, GoalEvent, ShotEvent, StoppageEvent, FaceoffEvent } from '@domain'
import { planFor, currentSpeed, nextActiveJump, SKIP_SPEED } from './playbackDirector'

// ── Helpers ───────────────────────────────────────────────────────────────────

function goal(period: number, t: number): GoalEvent {
  return {
    type: 'goal',
    period, t,
    scorer: 'p1' as GoalEvent['scorer'],
    assists: [],
    strength: 'ev',
    pos: { x: 0, y: 0 },
  }
}

function shot(period: number, t: number, danger: number): ShotEvent {
  return {
    type: 'shot',
    period, t,
    shooter: 'p1' as ShotEvent['shooter'],
    from: { x: 0, y: 0 },
    target: { x: 0, y: 0 },
    danger,
  }
}

function whistle(period: number, t: number): StoppageEvent {
  return { type: 'whistle', period, t }
}

function faceoff(period: number, t: number): FaceoffEvent {
  return {
    type: 'faceoff',
    period, t,
    winner: 'p1' as FaceoffEvent['winner'],
    zone: 'neutral',
    pos: { x: 0, y: 0 },
  }
}

function periodEnd(period: number): StoppageEvent {
  return { type: 'periodEnd', period, t: 1200 }
}

function gameEnd(): StoppageEvent {
  return { type: 'gameEnd', period: 3, t: 1200 }
}

// ── planFor: empty stream ─────────────────────────────────────────────────────

describe('planFor – empty stream', () => {
  it('returns empty array', () => {
    expect(planFor([], 'full')).toEqual([])
    expect(planFor([], 'extended')).toEqual([])
    expect(planFor([], 'key')).toEqual([])
  })
})

// ── planFor: full mode ─────────────────────────────────────────────────────────

describe('planFor – full mode', () => {
  it('covers [0, duration] with no gaps', () => {
    const stream: GameStream = [
      shot(1, 300, 0.3),
      goal(1, 600, ),
      periodEnd(1),
      gameEnd(),
    ]
    const plan = planFor(stream, 'full')
    expect(plan.length).toBeGreaterThan(0)
    // First segment starts at 0
    expect(plan[0].fromAbsT).toBe(0)
    // No gaps
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].fromAbsT).toBeCloseTo(plan[i - 1].toAbsT, 5)
    }
    // Last segment covers duration
    const last = plan[plan.length - 1]
    expect(last.toAbsT).toBeGreaterThan(0)
  })

  it('goal window plays at 1×', () => {
    // Goal at t=600 in period 1 → absT=600
    const stream: GameStream = [goal(1, 600)]
    const plan = planFor(stream, 'full')
    // At absT=600 (goal time), speed should be 1
    const spd = currentSpeed(plan, 600)
    expect(spd).toBe(1)
    // A few seconds before the goal: also 1×
    expect(currentSpeed(plan, 596)).toBe(1)
    // Well before the drama window: baseline speed
    expect(currentSpeed(plan, 100)).toBeGreaterThan(1)
  })

  it('high-danger shot window plays at 1×', () => {
    const stream: GameStream = [shot(1, 400, 0.8)]
    const plan = planFor(stream, 'full')
    // Shot at absT=400 — should be in drama window
    expect(currentSpeed(plan, 400)).toBe(1)
  })

  it('low-danger shot does not create a drama window', () => {
    // Use period 1 t=400, far from the period 3 close-game window.
    // We also need another event in period 3 so duration extends past
    // the drama-triggering "final 2 min" zone.
    const stream: GameStream = [shot(1, 400, 0.1), gameEnd()]
    const plan = planFor(stream, 'full')
    // At shot absT=400 (period 1, 400 s in), speed should be baseline (not 1×)
    const spd = currentSpeed(plan, 400)
    expect(spd).toBeGreaterThan(1)
  })

  it('dead time between whistle and faceoff is fast', () => {
    const stream: GameStream = [
      whistle(1, 300),
      faceoff(1, 305),
    ]
    const plan = planFor(stream, 'full')
    // Between whistle and faceoff: fast
    const spd = currentSpeed(plan, 302)
    expect(spd).toBeGreaterThan(1)
  })

  it('all segments have positive speed', () => {
    const stream: GameStream = [
      shot(1, 200, 0.7),
      goal(1, 600),
      whistle(1, 601),
      faceoff(1, 605),
      periodEnd(1),
    ]
    const plan = planFor(stream, 'full')
    for (const seg of plan) {
      expect(seg.speed).toBeGreaterThan(0)
    }
  })

  it('segments are sorted and non-overlapping', () => {
    const stream: GameStream = [
      shot(1, 200, 0.9),
      goal(1, 600),
      periodEnd(1),
      gameEnd(),
    ]
    const plan = planFor(stream, 'full')
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].fromAbsT).toBeGreaterThanOrEqual(plan[i - 1].toAbsT - 0.001)
    }
  })
})

// ── planFor: extended mode ─────────────────────────────────────────────────────

describe('planFor – extended mode', () => {
  it('covers [0, duration] with no gaps', () => {
    const stream: GameStream = [
      shot(1, 300, 0.8),
      goal(1, 600),
      gameEnd(),
    ]
    const plan = planFor(stream, 'extended')
    expect(plan[0].fromAbsT).toBe(0)
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].fromAbsT).toBeCloseTo(plan[i - 1].toAbsT, 5)
    }
  })

  it('active segments run at 1.5×', () => {
    const stream: GameStream = [goal(1, 600)]
    const plan = planFor(stream, 'extended')
    // Near the goal we should have an active segment
    const spd = currentSpeed(plan, 600)
    expect(spd).toBe(1.5)
  })

  it('gaps between highlights run at SKIP_SPEED', () => {
    const stream: GameStream = [
      goal(1, 200),
      goal(1, 1000),
    ]
    const plan = planFor(stream, 'extended')
    // Somewhere between the two goals (outside both windows): SKIP
    const spd = currentSpeed(plan, 600)
    expect(spd).toBe(SKIP_SPEED)
  })

  it('single-goal game has plan covering the goal', () => {
    const stream: GameStream = [goal(2, 300)]
    const plan = planFor(stream, 'extended')
    expect(plan.length).toBeGreaterThan(0)
    // absT of goal = (2-1)*1200 + 300 = 1500
    expect(currentSpeed(plan, 1500)).toBe(1.5)
  })
})

// ── planFor: key mode ──────────────────────────────────────────────────────────

describe('planFor – key mode', () => {
  it('active segments run at 1×', () => {
    const stream: GameStream = [goal(1, 600)]
    const plan = planFor(stream, 'key')
    expect(currentSpeed(plan, 600)).toBe(1)
  })

  it('non-goal, non-top-chance segments are skipped', () => {
    // hit has importance 1 → filtered out in 'key' mode
    const stream: GameStream = [
      { type: 'hit', period: 1, t: 200, by: 'p1' as any, on: 'p2' as any, pos: { x: 0, y: 0 } },
      goal(1, 800),
    ]
    const plan = planFor(stream, 'key')
    // At hit time (200s), we should be in a skip segment
    expect(currentSpeed(plan, 200)).toBe(SKIP_SPEED)
    // At goal time (800s), we should be active
    expect(currentSpeed(plan, 800)).toBe(1)
  })

  it('no-highlight stream produces a single skip segment', () => {
    // Only low-danger shots — no highlights at all
    const stream: GameStream = [
      shot(1, 100, 0.1),
      shot(1, 200, 0.1),
    ]
    const plan = planFor(stream, 'key')
    expect(plan.length).toBe(1)
    expect(plan[0].speed).toBe(SKIP_SPEED)
  })
})

// ── currentSpeed ──────────────────────────────────────────────────────────────

describe('currentSpeed', () => {
  it('returns correct speed within a segment', () => {
    const plan = [
      { fromAbsT: 0, toAbsT: 100, speed: 2 },
      { fromAbsT: 100, toAbsT: 200, speed: 1 },
      { fromAbsT: 200, toAbsT: 300, speed: 5 },
    ]
    expect(currentSpeed(plan, 50)).toBe(2)
    expect(currentSpeed(plan, 150)).toBe(1)
    expect(currentSpeed(plan, 250)).toBe(5)
  })

  it('returns 1 when absT is past the end', () => {
    const plan = [{ fromAbsT: 0, toAbsT: 100, speed: 3 }]
    expect(currentSpeed(plan, 200)).toBe(1)
  })

  it('returns 1 for empty plan', () => {
    expect(currentSpeed([], 50)).toBe(1)
  })

  it('uses < toAbsT boundary (exclusive end)', () => {
    const plan = [
      { fromAbsT: 0, toAbsT: 100, speed: 2 },
      { fromAbsT: 100, toAbsT: 200, speed: 4 },
    ]
    // At exactly 100, should be in the second segment
    expect(currentSpeed(plan, 100)).toBe(4)
    // At 99.9999, should be in the first
    expect(currentSpeed(plan, 99.9)).toBe(2)
  })
})

// ── nextActiveJump ────────────────────────────────────────────────────────────

describe('nextActiveJump', () => {
  const plan = [
    { fromAbsT: 0, toAbsT: 100, speed: SKIP_SPEED },    // skip
    { fromAbsT: 100, toAbsT: 200, speed: 1 },            // active
    { fromAbsT: 200, toAbsT: 300, speed: SKIP_SPEED },   // skip
    { fromAbsT: 300, toAbsT: 400, speed: 1.5 },          // active
    { fromAbsT: 400, toAbsT: 500, speed: SKIP_SPEED },   // skip (trailing)
  ]

  it('returns jump target when in a skip segment', () => {
    expect(nextActiveJump(plan, 50)).toEqual({ jumpToAbsT: 100 })
  })

  it('returns null when in an active segment', () => {
    expect(nextActiveJump(plan, 150)).toBeNull()
  })

  it('returns next active after mid-game skip', () => {
    expect(nextActiveJump(plan, 250)).toEqual({ jumpToAbsT: 300 })
  })

  it('returns null when in trailing skip with no more active segments', () => {
    expect(nextActiveJump(plan, 450)).toBeNull()
  })

  it('returns null for empty plan', () => {
    expect(nextActiveJump([], 50)).toBeNull()
  })
})
