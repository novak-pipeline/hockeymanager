import { describe, it, expect } from 'vitest'
import type { GameStream, GoalEvent, ShotEvent, SaveEvent, PenaltyEvent, HitEvent } from '@domain'
import { buildHighlights, selectMode, type HighlightSegment } from './highlights'

// ── helpers ───────────────────────────────────────────────────────────────────

function goal(period: number, t: number): GoalEvent {
  return {
    type: 'goal', period, t,
    scorer: 'p1' as GoalEvent['scorer'],
    assists: [],
    strength: 'ev',
    pos: { x: 0, y: 0 },
  }
}

function shot(period: number, t: number, danger: number): ShotEvent {
  return {
    type: 'shot', period, t,
    shooter: 'p1' as ShotEvent['shooter'],
    from: { x: 0, y: 0 },
    target: { x: 0, y: 0 },
    danger,
  }
}

function save(period: number, t: number, rebound = false): SaveEvent {
  return {
    type: 'save', period, t,
    goalie: 'g1' as SaveEvent['goalie'],
    rebound,
    pos: { x: 0, y: 0 },
  }
}

function penalty(period: number, t: number): PenaltyEvent {
  return {
    type: 'penalty', period, t,
    player: 'p2' as PenaltyEvent['player'],
    infraction: 'tripping',
    minutes: 2,
  }
}

function hit(period: number, t: number): HitEvent {
  return {
    type: 'hit', period, t,
    by: 'p1' as HitEvent['by'],
    on: 'p2' as HitEvent['on'],
    pos: { x: 0, y: 0 },
  }
}

// ── empty stream ──────────────────────────────────────────────────────────────

describe('buildHighlights empty stream', () => {
  it('returns empty array for empty stream', () => {
    expect(buildHighlights([])).toEqual([])
  })
})

// ── goal segment ──────────────────────────────────────────────────────────────

describe('goal segments', () => {
  it('produces a segment with importance 3 and kind goal', () => {
    const segs = buildHighlights([goal(1, 600)])
    expect(segs).toHaveLength(1)
    expect(segs[0].kind).toBe('goal')
    expect(segs[0].importance).toBe(3)
  })

  it('window is -10s before, +6s after', () => {
    const segs = buildHighlights([goal(1, 600)])
    const at = 1200 - 1 * 1200 + 600  // period 1 = 0 base, at = 600
    expect(segs[0].startAbsT).toBe(590)
    expect(segs[0].endAbsT).toBe(606)
  })

  it('clamps start to 0 for early-period goals', () => {
    const segs = buildHighlights([goal(1, 5)])
    expect(segs[0].startAbsT).toBe(0)
  })
})

// ── chance segment ────────────────────────────────────────────────────────────

describe('chance segments', () => {
  it('produces segment for high-danger shot (danger >= 0.25)', () => {
    const segs = buildHighlights([shot(1, 300, 0.5)])
    expect(segs.some((s) => s.kind === 'chance')).toBe(true)
  })

  it('does not produce segment for low-danger shot (danger < 0.25)', () => {
    const segs = buildHighlights([shot(1, 300, 0.1)])
    expect(segs).toHaveLength(0)
  })

  it('window is -6s/+3s', () => {
    const segs = buildHighlights([shot(1, 300, 0.5)])
    expect(segs[0].startAbsT).toBe(294)
    expect(segs[0].endAbsT).toBe(303)
  })
})

// ── save / rebound segment ────────────────────────────────────────────────────

describe('save segments', () => {
  it('rebound:true save produces a segment', () => {
    const segs = buildHighlights([save(1, 300, true)])
    expect(segs.some((s) => s.kind === 'save')).toBe(true)
  })

  it('non-rebound save without preceding shot does not produce segment', () => {
    const segs = buildHighlights([save(1, 300, false)])
    expect(segs).toHaveLength(0)
  })

  it('non-rebound save within 3s of shot produces segment', () => {
    const stream: GameStream = [
      shot(1, 300, 0.1), // low danger — no chance segment for the shot itself
      save(1, 302, false), // 2s later — rebound detection fires
    ]
    const segs = buildHighlights(stream)
    expect(segs.some((s) => s.kind === 'save')).toBe(true)
  })
})

// ── penalty segment ───────────────────────────────────────────────────────────

describe('penalty segments', () => {
  it('produces a segment with importance 2 and kind penalty', () => {
    const segs = buildHighlights([penalty(1, 300)])
    expect(segs).toHaveLength(1)
    expect(segs[0].kind).toBe('penalty')
    expect(segs[0].importance).toBe(2)
  })

  it('window is -4s/+3s', () => {
    const segs = buildHighlights([penalty(1, 300)])
    expect(segs[0].startAbsT).toBe(296)
    expect(segs[0].endAbsT).toBe(303)
  })
})

// ── hit segment ───────────────────────────────────────────────────────────────

describe('hit segments', () => {
  it('produces segment with importance 1 and kind hit', () => {
    const segs = buildHighlights([hit(1, 300)])
    expect(segs).toHaveLength(1)
    expect(segs[0].kind).toBe('hit')
    expect(segs[0].importance).toBe(1)
  })
})

// ── merge overlapping ─────────────────────────────────────────────────────────

describe('overlapping segment merging', () => {
  it('merges two overlapping segments into one', () => {
    // Two hits close together — their windows overlap
    const stream: GameStream = [hit(1, 300), hit(1, 302)]
    const segs = buildHighlights(stream)
    expect(segs).toHaveLength(1)
  })

  it('keeps two non-overlapping segments separate', () => {
    const stream: GameStream = [hit(1, 100), hit(1, 500)]
    const segs = buildHighlights(stream)
    expect(segs).toHaveLength(2)
  })

  it('merged segment takes the higher importance', () => {
    // A hit (imp 1) overlapping a penalty (imp 2)
    // hit at t=300 → [298,302]; penalty at t=302 → [298,305]
    const stream: GameStream = [hit(1, 300), penalty(1, 302)]
    const segs = buildHighlights(stream)
    expect(segs.some((s) => s.importance >= 2)).toBe(true)
  })
})

// ── sorted output ─────────────────────────────────────────────────────────────

describe('output ordering', () => {
  it('segments are sorted ascending by startAbsT', () => {
    const stream: GameStream = [
      goal(3, 600),
      penalty(1, 300),
      hit(2, 200),
    ]
    const segs = buildHighlights(stream)
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].startAbsT).toBeGreaterThanOrEqual(segs[i - 1].startAbsT)
    }
  })
})

// ── selectMode ────────────────────────────────────────────────────────────────

describe('selectMode', () => {
  const segs: HighlightSegment[] = [
    { startAbsT: 0, endAbsT: 10, kind: 'goal', importance: 3 },
    { startAbsT: 50, endAbsT: 60, kind: 'chance', importance: 2 },
    { startAbsT: 100, endAbsT: 110, kind: 'hit', importance: 1 },
    { startAbsT: 200, endAbsT: 210, kind: 'penalty', importance: 2 },
  ]

  it('extended returns all segments', () => {
    expect(selectMode(segs, 'extended')).toHaveLength(4)
  })

  it('key returns only importance >= 2', () => {
    const key = selectMode(segs, 'key')
    expect(key).toHaveLength(3)
    expect(key.every((s) => s.importance >= 2)).toBe(true)
  })

  it('key includes goals', () => {
    const key = selectMode(segs, 'key')
    expect(key.some((s) => s.kind === 'goal')).toBe(true)
  })

  it('key excludes hits (importance 1)', () => {
    const key = selectMode(segs, 'key')
    expect(key.some((s) => s.kind === 'hit')).toBe(false)
  })
})

// ── multiple goals in a game ──────────────────────────────────────────────────

describe('full game scenario', () => {
  it('handles a full game stream without throwing', () => {
    const stream: GameStream = [
      shot(1, 100, 0.8),
      save(1, 101, true),
      goal(1, 400),
      penalty(1, 700),
      hit(2, 200),
      shot(2, 500, 0.3),
      goal(2, 800),
      hit(3, 300),
      goal(3, 1100),
    ]
    expect(() => buildHighlights(stream)).not.toThrow()
    const segs = buildHighlights(stream)
    expect(segs.length).toBeGreaterThan(0)
    // All goal segments should be present
    const goals = segs.filter((s) => s.kind === 'goal')
    expect(goals.length).toBeGreaterThanOrEqual(2) // some goals may merge with adjacent events
  })
})
