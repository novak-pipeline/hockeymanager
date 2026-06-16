import { describe, expect, it } from 'vitest'
import type { Player } from '@domain'
import { buildScoutSummary, type ScoutSummaryArgs } from './scoutSummary'

/** Minimal player carrying the fields the summary reads. */
function mk(over: Partial<{ scoring: number; skating: number; vision: number }> = {}): Player {
  return {
    id: 'p1',
    name: 'Test Prospect',
    age: 18,
    position: 'RW',
    composites: {
      scoring: over.scoring ?? 70, playmaking: 65, skating: over.skating ?? 40,
      defensiveZone: 45, takeaway: 45, hitting: 40, blocking: 40,
    },
    ratings: {
      technical: { wristShot: over.scoring ?? 72, slapShot: 60, stickhandling: 64, passing: 66 },
      mental: { offensiveIQ: over.vision ?? 68, defensiveIQ: 45, vision: over.vision ?? 70, anticipation: 66, positioning: 45 },
      physical: { strength: 45 },
    },
    personality: { determination: 12, professionalism: 12, ambition: 12, loyalty: 10, temperament: 50 },
  } as unknown as Player
}

const base: ScoutSummaryArgs = {
  player: mk(),
  knowledge: 80,
  gamesPlayed: 40, goals: 25, assists: 35,
  leagueName: 'Western Hockey League',
  leagueScoringRank: 4,
  ceilingRole: 'Top-six F',
  riskBand: 'Medium',
  compNames: ['A.J. Hartwell'],
  eligibility: 'eligible',
  draftLabel: 'R1 · #14',
  draftYear: 2026,
}

describe('buildScoutSummary', () => {
  it('at low knowledge it is short and hedged', () => {
    const r = buildScoutSummary({ ...base, knowledge: 15 })
    expect(r.confidence).toBe('low')
    expect(r.paragraphs.length).toBe(1)
    expect(r.paragraphs[0]).toMatch(/limited viewings/i)
  })

  it('at high knowledge it is a full multi-paragraph report with production, projection + draft standing', () => {
    const r = buildScoutSummary(base)
    expect(r.confidence).toBe('high')
    expect(r.paragraphs.length).toBeGreaterThanOrEqual(3)
    const all = r.paragraphs.join(' ')
    expect(all).toMatch(/60 points/)            // production folded in
    expect(all).toMatch(/Western Hockey League/)
    expect(all).toMatch(/Top-six F/)            // our scouts' projection
    expect(all).toMatch(/R1 · #14/)             // draft standing
  })

  it('deepens with knowledge (more sections once well scouted)', () => {
    const sparse = buildScoutSummary({ ...base, knowledge: 15 })
    const full = buildScoutSummary({ ...base, knowledge: 90 })
    expect(full.paragraphs.length).toBeGreaterThan(sparse.paragraphs.length)
  })

  it('the pre-draft edition reads as a season recap with a verdict', () => {
    const r = buildScoutSummary({ ...base, preDraft: true })
    const all = r.paragraphs.join(' ')
    expect(all).toMatch(/finished the season/i)
    expect(all).toMatch(/Bottom line/i)
  })
})
