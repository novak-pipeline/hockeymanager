import { describe, it, expect } from 'vitest'
import type { GameStream, GoalEvent, ShotEvent, SaveEvent, PenaltyEvent, HitEvent, StoppageEvent, FaceoffEvent } from '@domain'
import { generateCommentary } from './commentary'

// ── helpers ───────────────────────────────────────────────────────────────────

const NAMES: Record<string, string> = {
  p1: 'John Smith',
  p2: 'Marc Dupont',
  p3: 'Erik Lindstrom',
  g1: 'Carlos Reyes',
  g2: 'James White',
}

const names = (id: string): string => NAMES[id] ?? id
const isHome = (id: string): boolean => ['p1', 'p2', 'g1'].includes(id)
const abbrs = { home: 'FLC', away: 'STM' }

function goalEvent(
  period: number,
  t: number,
  scorer: string,
  assists: string[],
  strength: GoalEvent['strength'] = 'ev'
): GoalEvent {
  return { type: 'goal', period, t, scorer: scorer as GoalEvent['scorer'], assists: assists as GoalEvent['assists'], strength, pos: { x: 0, y: 0 } }
}

function shotEvent(period: number, t: number, shooter: string, danger: number): ShotEvent {
  return { type: 'shot', period, t, shooter: shooter as ShotEvent['shooter'], from: { x: 0, y: 0 }, target: { x: 0, y: 0 }, danger }
}

function saveEvent(period: number, t: number, goalie: string, rebound = false): SaveEvent {
  return { type: 'save', period, t, goalie: goalie as SaveEvent['goalie'], rebound, pos: { x: 0, y: 0 } }
}

function penaltyEvent(period: number, t: number, player: string, infraction: string): PenaltyEvent {
  return { type: 'penalty', period, t, player: player as PenaltyEvent['player'], infraction, minutes: 2 }
}

function hitEvent(period: number, t: number, by: string, on: string): HitEvent {
  return { type: 'hit', period, t, by: by as HitEvent['by'], on: on as HitEvent['on'], pos: { x: 0, y: 0 } }
}

function gameEndEvent(period: number, t: number): StoppageEvent {
  return { type: 'gameEnd', period, t }
}

function periodEndEvent(period: number, t: number): StoppageEvent {
  return { type: 'periodEnd', period, t }
}

function faceoffEvent(period: number, t: number, winner: string): FaceoffEvent {
  return {
    type: 'faceoff', period, t,
    winner: winner as FaceoffEvent['winner'],
    zone: 'neutral',
    pos: { x: 0, y: 0 }
  }
}

// ── determinism ───────────────────────────────────────────────────────────────

describe('generateCommentary determinism', () => {
  it('returns identical output for the same stream across multiple calls', () => {
    const stream: GameStream = [
      shotEvent(1, 300, 'p1', 0.7),
      goalEvent(1, 600, 'p1', ['p2']),
      penaltyEvent(2, 200, 'p3', 'hooking'),
      gameEndEvent(3, 1200),
    ]

    const a = generateCommentary(stream, names, isHome, abbrs)
    const b = generateCommentary(stream, names, isHome, abbrs)
    expect(a).toEqual(b)
  })
})

// ── goal lines ────────────────────────────────────────────────────────────────

describe('goal commentary', () => {
  it('goal line contains scorer surname and score', () => {
    const stream: GameStream = [goalEvent(1, 600, 'p1', ['p2'])]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    const goalLine = lines.find((l) => l.importance === 3)
    expect(goalLine).toBeDefined()
    expect(goalLine!.text).toContain('Smith')
    expect(goalLine!.text).toContain('1-0')
  })

  it('two goals give correct running score', () => {
    const stream: GameStream = [
      goalEvent(1, 300, 'p1', []),
      goalEvent(1, 600, 'p3', []),
    ]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    const goals = lines.filter((l) => l.importance === 3)
    expect(goals[0].text).toContain('1-0')
    expect(goals[1].text).toContain('1-1')
  })

  it('PP marker is flagged in goal text', () => {
    const stream: GameStream = [goalEvent(1, 300, 'p1', [], 'pp')]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    const g = lines.find((l) => l.importance === 3)!
    expect(g.text.toLowerCase()).toContain('pp')
  })

  it('shorthanded goal is flagged', () => {
    const stream: GameStream = [goalEvent(1, 300, 'p1', [], 'sh')]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    const g = lines.find((l) => l.importance === 3)!
    expect(g.text.toLowerCase()).toContain('shorthanded')
  })

  it('goal scorer full name used first time, surname only in same period', () => {
    const stream: GameStream = [
      goalEvent(1, 300, 'p1', []),
      shotEvent(1, 400, 'p1', 0.8),
    ]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    const goalLine = lines.find((l) => l.importance === 3)!
    // First mention: full name
    expect(goalLine.text).toContain('John Smith')

    // Shot after goal in same period: surname only
    const shotLine = lines.find((l) => l.absT > goalLine.absT && l.text.includes('Smith'))
    expect(shotLine).toBeDefined()
    // Should NOT re-introduce full "John Smith" on the second event
    // (the shot line should use surname only: "Smith")
    if (shotLine) {
      // Check that "John Smith" doesn't appear again (i.e., only surname is used)
      const fullNameCount = (shotLine.text.match(/John Smith/g) ?? []).length
      expect(fullNameCount).toBe(0)
    }
  })
})

// ── importance mapping ────────────────────────────────────────────────────────

describe('importance mapping', () => {
  it('goal has importance 3', () => {
    const stream: GameStream = [goalEvent(1, 300, 'p1', [])]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    expect(lines.some((l) => l.importance === 3)).toBe(true)
  })

  it('high-danger shot has importance >= 2', () => {
    const stream: GameStream = [shotEvent(1, 300, 'p1', 0.9)]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    expect(lines.some((l) => l.importance >= 2)).toBe(true)
  })

  it('low-danger shot has importance 1', () => {
    const stream: GameStream = [shotEvent(1, 300, 'p1', 0.1)]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    expect(lines.every((l) => l.importance === 1)).toBe(true)
  })

  it('penalty has importance 2', () => {
    const stream: GameStream = [penaltyEvent(1, 300, 'p3', 'tripping')]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    expect(lines.some((l) => l.importance === 2)).toBe(true)
  })

  it('gameEnd has importance 3', () => {
    const stream: GameStream = [gameEndEvent(3, 1200)]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    expect(lines.some((l) => l.importance === 3)).toBe(true)
  })
})

// ── speech field ──────────────────────────────────────────────────────────────

describe('speech field', () => {
  it('speech field has no em-dashes', () => {
    const stream: GameStream = [goalEvent(1, 300, 'p1', ['p2'])]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    for (const l of lines) {
      expect(l.speech).not.toContain('—')
    }
  })

  it('speech field has no ellipses', () => {
    const stream: GameStream = [shotEvent(1, 300, 'p1', 0.2)]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    for (const l of lines) {
      expect(l.speech).not.toContain('...')
    }
  })
})

// ── clock & period ────────────────────────────────────────────────────────────

describe('clock and period fields', () => {
  it('period field matches the event period', () => {
    const stream: GameStream = [
      shotEvent(1, 300, 'p1', 0.5),
      shotEvent(2, 300, 'p2', 0.5),
      shotEvent(3, 300, 'p3', 0.5),
    ]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    const periods = lines.map((l) => l.period)
    expect(periods).toContain(1)
    expect(periods).toContain(2)
    expect(periods).toContain(3)
  })

  it('clock is formatted as MM:SS', () => {
    const stream: GameStream = [shotEvent(1, 300, 'p1', 0.5)]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    for (const l of lines) {
      expect(l.clock).toMatch(/^\d+:\d{2}$/)
    }
  })

  it('absT is non-negative', () => {
    const stream: GameStream = [
      shotEvent(1, 0, 'p1', 0.5),
      shotEvent(2, 600, 'p2', 0.5),
    ]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    for (const l of lines) {
      expect(l.absT).toBeGreaterThanOrEqual(0)
    }
  })
})

// ── period-start faceoffs ─────────────────────────────────────────────────────

describe('faceoff commentary', () => {
  it('emits a line for period-start faceoff (t < 5)', () => {
    const stream: GameStream = [faceoffEvent(1, 0, 'p1')]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0].text).toContain('Smith')
  })

  it('emits a puck-drop line for a mid-period faceoff (t >= 5)', () => {
    const stream: GameStream = [faceoffEvent(1, 600, 'p1')]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    // Mid-game faceoffs now emit a "puck drops" line
    expect(lines.length).toBe(1)
    // The line should mention "puck" or "drops" or similar — not the winner name
    const lower = lines[0].text.toLowerCase()
    expect(lower.match(/puck|drops|underway|faceoff|resume/)).toBeTruthy()
  })
})

// ── period-end recap ──────────────────────────────────────────────────────────

describe('period end recap', () => {
  it('includes the score in period-end line', () => {
    const stream: GameStream = [
      goalEvent(1, 300, 'p1', []),
      periodEndEvent(1, 1200),
    ]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    const endLine = lines.find((l) => l.period === 1 && l.text.includes('FLC'))
    expect(endLine).toBeDefined()
    // Should mention "1-0" somewhere
    expect(endLine!.text).toContain('1-0')
  })
})

// ── whistle reason lines ──────────────────────────────────────────────────────

function whistleEvent(period: number, t: number, reason?: StoppageEvent['reason']): StoppageEvent {
  const ev: StoppageEvent = { type: 'whistle', period, t }
  if (reason !== undefined) return { ...ev, reason }
  return ev
}

describe('whistle reason commentary', () => {
  it('offside whistle emits an offside line', () => {
    const stream: GameStream = [whistleEvent(1, 300, 'offside')]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    expect(lines.length).toBe(1)
    expect(lines[0].text.toLowerCase()).toContain('offside')
  })

  it('icing whistle emits an icing line', () => {
    const stream: GameStream = [whistleEvent(1, 300, 'icing')]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    expect(lines.length).toBe(1)
    expect(lines[0].text.toLowerCase()).toContain('ic')
  })

  it('goalieFreeze whistle emits a freeze line', () => {
    const stream: GameStream = [whistleEvent(1, 300, 'goalieFreeze')]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    expect(lines.length).toBe(1)
    const lower = lines[0].text.toLowerCase()
    expect(lower.match(/goalie|freeze|frozen|smothers|covers|netminder/)).toBeTruthy()
  })

  it('goal-reason whistle is silent (goal commentary handles it)', () => {
    const stream: GameStream = [whistleEvent(1, 300, 'goal')]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    expect(lines.length).toBe(0)
  })

  it('whistle with no reason emits a generic play-stopped line', () => {
    const stream: GameStream = [whistleEvent(1, 300)]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    expect(lines.length).toBe(1)
  })

  it('all whistle reason lines have importance 1', () => {
    const reasons: Array<StoppageEvent['reason']> = ['offside', 'icing', 'goalieFreeze', 'penalty']
    for (const reason of reasons) {
      const stream: GameStream = [whistleEvent(1, 300, reason)]
      const lines = generateCommentary(stream, names, isHome, abbrs)
      expect(lines[0]?.importance).toBe(1)
    }
  })
})

// ── cluster trimming ──────────────────────────────────────────────────────────

describe('cluster trimming', () => {
  it('trims clusters of 3+ importance-1 lines within 5 s to at most 2', () => {
    // 5 low-danger shots within a 4-second window → cluster should be trimmed
    const stream: GameStream = [
      shotEvent(1, 300, 'p1', 0.1),
      shotEvent(1, 301, 'p2', 0.1),
      shotEvent(1, 302, 'p3', 0.1),
      shotEvent(1, 303, 'p1', 0.1),
      shotEvent(1, 304, 'p2', 0.1),
    ]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    // All are importance-1; within the 5-s window at most 2 should survive
    const imp1 = lines.filter((l) => l.importance === 1)
    expect(imp1.length).toBeLessThanOrEqual(2)
  })

  it('leaves importance-2+ lines untouched during cluster trim', () => {
    const stream: GameStream = [
      shotEvent(1, 300, 'p1', 0.8),  // importance 2
      shotEvent(1, 301, 'p2', 0.1),  // importance 1
      shotEvent(1, 302, 'p3', 0.1),  // importance 1
      shotEvent(1, 303, 'p1', 0.1),  // importance 1
    ]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    // The importance-2 line must survive
    expect(lines.filter((l) => l.importance >= 2).length).toBe(1)
  })

  it('does not trim when fewer than 3 lines in a 5-s window', () => {
    const stream: GameStream = [
      shotEvent(1, 300, 'p1', 0.1),
      shotEvent(1, 302, 'p2', 0.1),
    ]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    expect(lines.length).toBe(2)
  })
})

// ── output sorted by absT ─────────────────────────────────────────────────────

describe('output ordering', () => {
  it('lines are sorted ascending by absT', () => {
    const stream: GameStream = [
      goalEvent(3, 600, 'p1', []),
      shotEvent(1, 300, 'p2', 0.5),
      penaltyEvent(2, 100, 'p3', 'tripping'),
    ]
    const lines = generateCommentary(stream, names, isHome, abbrs)
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].absT).toBeGreaterThanOrEqual(lines[i - 1].absT)
    }
  })
})
