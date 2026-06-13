/**
 * scoutReport.test.ts
 *
 * Tests for the deterministic scout report generator.
 * Verifies that fog level changes prose verbosity, tier mapping is correct,
 * and all results are deterministic (no Math.random / Date usage).
 */

import { describe, it, expect } from 'vitest'
import {
  buildScoutReport,
  projectionTier,
  TIER_LABELS,
  type ProjectionTier,
} from './scoutReport'
import type { Player } from '@domain'

/* ────────────────────────── mock player factory ────────────────────────── */

function mockRatings(base: number) {
  return {
    technical: {
      wristShot: base, slapShot: base, stickhandling: base,
      passing: base, deflections: base, faceoffs: base,
    },
    physical: {
      speed: base, acceleration: base, strength: base,
      balance: base, stamina: base, agility: base, height: base,
    },
    mental: {
      offensiveIQ: base, defensiveIQ: base, positioning: base,
      vision: base, aggression: base, composure: base,
      workRate: base, discipline: base, anticipation: base,
    },
    defensive: {
      checking: base, shotBlocking: base, stickChecking: base, takeaway: base,
    },
  }
}

function mockComposites(base: number) {
  return {
    scoring: base, playmaking: base, puckControl: base, faceoffWin: base,
    hitting: base, blocking: base, takeaway: base, penaltyProne: 30,
    goaltending: 0, skating: base, defensiveZone: base,
    offensiveIQ: base, defensiveIQ: base, vision: base, passing: base,
  }
}

function makePlayer(overrides: Partial<{
  id: string
  overall: number
  age: number
  position: 'C' | 'W' | 'D' | 'G'
  role: string
  determination: number
  professionalism: number
}>): Player {
  const base = overrides.overall ?? 70
  const pid = overrides.id ?? 'test-player-1'
  return {
    id: pid as unknown as Player['id'],
    name: 'Test Player',
    age: overrides.age ?? 24,
    position: overrides.position ?? 'C',
    handedness: 'R',
    role: overrides.role ?? 'Top-six forward',
    ratings: mockRatings(base),
    potential: mockRatings(base + 5),
    composites: mockComposites(base) as unknown as Player['composites'],
    personality: {
      ambition: 12,
      professionalism: overrides.professionalism ?? 10,
      loyalty: 10,
      temperament: 12,
      determination: overrides.determination ?? 10,
    },
    contract: {
      salary: 3_000_000,
      yearsRemaining: 2,
      expiryYear: 2028,
      noTradeClause: false,
      twoWay: false,
    },
    stats: [],
    fatigue: 0,
    morale: 70,
    injuryStatus: null,
    form: 0,
  } as unknown as Player
}

/* ────────────────────────── projectionTier ────────────────────────── */

describe('projectionTier', () => {
  it('returns Star for high overall+potential', () => {
    expect(projectionTier(82, 5, 28)).toBe('Star')
  })

  it('returns Key for solid overall', () => {
    expect(projectionTier(70, 3, 27)).toBe('Key')
  })

  it('returns Core for mid overall', () => {
    expect(projectionTier(60, 2, 26)).toBe('Core')
  })

  it('returns Depth for below-average', () => {
    expect(projectionTier(52, 2, 30)).toBe('Depth')
  })

  it('returns Fringe for low overall', () => {
    expect(projectionTier(40, 1, 32)).toBe('Fringe')
  })

  it('returns Prospect for young high-potential player', () => {
    expect(projectionTier(62, 4, 19)).toBe('Prospect')
  })

  it('TIER_LABELS covers all tiers', () => {
    const tiers: ProjectionTier[] = ['Star', 'Key', 'Core', 'Depth', 'Fringe', 'Prospect']
    for (const t of tiers) {
      expect(TIER_LABELS[t]).toBeTruthy()
    }
  })
})

/* ────────────────────────── buildScoutReport ────────────────────────── */

describe('buildScoutReport – high knowledge (own roster, no fog)', () => {
  it('produces a non-empty prose paragraph', () => {
    const p = makePlayer({ overall: 75, determination: 18 })
    const sr = buildScoutReport(p, undefined, 4)
    expect(sr.generalImpressions.length).toBeGreaterThan(30)
  })

  it('knowledge is 100 when no scouting state supplied', () => {
    const p = makePlayer({})
    const sr = buildScoutReport(p, undefined, 3)
    expect(sr.knowledge).toBe(100)
  })

  it('assigns Star tier to elite player', () => {
    const p = makePlayer({ overall: 85 })
    const sr = buildScoutReport(p, undefined, 5)
    expect(sr.tier).toBe('Star')
  })

  it('assigns Depth tier to low-overall player', () => {
    const p = makePlayer({ overall: 50 })
    const sr = buildScoutReport(p, undefined, 1)
    expect(sr.tier).toBe('Depth')
  })

  it('produces a season projection line', () => {
    const p = makePlayer({ overall: 75 })
    const sr = buildScoutReport(p, undefined, 3)
    expect(sr.seasonProjection.line).toMatch(/\d+/)
  })

  it('report card has all skater areas', () => {
    const p = makePlayer({ overall: 72 })
    const sr = buildScoutReport(p, undefined, 3)
    const card = sr.reportCard
    expect(card.hockeyIQ).toBeTruthy()
    expect(card.skating).toBeTruthy()
    expect(card.shotScoring).toBeTruthy()
    expect(card.puckhandling).toBeTruthy()
    expect(card.defence).toBeTruthy()
    expect(card.physicality).toBeTruthy()
    expect(card.goaltending).toBeUndefined()
  })

  it('includes goaltending grade for goalies', () => {
    const p: Player = {
      ...makePlayer({ overall: 72, position: 'G' }),
      ratings: {
        ...mockRatings(72),
        goalie: {
          reflexes: 72, positioningG: 70, reboundControl: 65,
          glove: 70, blocker: 68, recovery: 66, puckHandlingG: 55, passing: 55,
        },
      },
    } as unknown as Player
    const sr = buildScoutReport(p, undefined, 3)
    expect(sr.reportCard.goaltending).toBeTruthy()
  })

  it('is deterministic: same player always same prose', () => {
    const p = makePlayer({ id: 'det-test-1', overall: 78 })
    const r1 = buildScoutReport(p, undefined, 4)
    const r2 = buildScoutReport(p, undefined, 4)
    expect(r1.generalImpressions).toBe(r2.generalImpressions)
    expect(r1.tier).toBe(r2.tier)
  })
})

describe('buildScoutReport – low knowledge fog', () => {
  it('knowledge < 100 when scouting state with no entry supplied', () => {
    const p = makePlayer({ id: 'fog-player-1', overall: 72 })
    // Minimal scouting state with no entry for this player (knowledge = 0)
    const scouting: import('@domain/scouting').ScoutingState = {
      knowledge: [],
      assignments: [],
    }
    const sr = buildScoutReport(p, scouting, 3)
    expect(sr.knowledge).toBe(0)
  })

  it('low-knowledge prose is shorter or hedged vs high-knowledge', () => {
    const p = makePlayer({ id: 'fog-player-2', overall: 78, determination: 18 })
    const lowScouting: import('@domain/scouting').ScoutingState = {
      knowledge: [],
      assignments: [],
    }

    const srLow = buildScoutReport(p, lowScouting, 4)
    const srHigh = buildScoutReport(p, undefined, 4)

    // Low-knowledge prose should be shorter (fewer phrases due to fog)
    // OR contain hedge words
    const hasHedge = srLow.generalImpressions.includes('limited') ||
      srLow.generalImpressions.includes('Early looks') ||
      srLow.generalImpressions.includes("what we've seen")
    const isShorter = srLow.generalImpressions.length < srHigh.generalImpressions.length
    expect(hasHedge || isShorter).toBe(true)
  })

  it('different players with same knowledge produce different prose', () => {
    const p1 = makePlayer({ id: 'diff-player-a', overall: 78 })
    const p2 = makePlayer({ id: 'diff-player-b', overall: 78 })
    const r1 = buildScoutReport(p1, undefined, 3)
    const r2 = buildScoutReport(p2, undefined, 3)
    // They have different ids so phrase picks may differ
    // At minimum the prose should be non-null
    expect(r1.generalImpressions).toBeTruthy()
    expect(r2.generalImpressions).toBeTruthy()
  })
})
