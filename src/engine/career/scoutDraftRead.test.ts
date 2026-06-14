import { describe, expect, it } from 'vitest'
import type { Player } from '@domain'
import { buildScoutDraftRead } from './scoutDraftRead'

/** Minimal player carrying just the fields the read consumes. */
function mk(opts: {
  professionalism?: number; determination?: number; ambition?: number; temperament?: number
  scoring?: number; defensiveZone?: number; takeaway?: number; offensiveIQ?: number; defensiveIQ?: number
}): Player {
  return {
    age: 18,
    personality: {
      ambition: opts.ambition ?? 50,
      professionalism: opts.professionalism ?? 50,
      loyalty: 50,
      temperament: opts.temperament ?? 50,
      determination: opts.determination ?? 50,
    },
    composites: {
      scoring: opts.scoring ?? 50,
      defensiveZone: opts.defensiveZone ?? 50,
      takeaway: opts.takeaway ?? 50,
    },
    ratings: { mental: { offensiveIQ: opts.offensiveIQ ?? 50, defensiveIQ: opts.defensiveIQ ?? 50 } },
  } as unknown as Player
}

describe('buildScoutDraftRead', () => {
  it('returns null without enough viewings', () => {
    const p = mk({ professionalism: 90, determination: 90, ambition: 90 })
    expect(buildScoutDraftRead({ player: p, knowledge: 20, analystRank: 50, interviews: 3 })).toBeNull()
  })

  it('rates a mature, high-character deep prospect HIGHER than the board', () => {
    const p = mk({ professionalism: 95, determination: 95, ambition: 90 })
    const r = buildScoutDraftRead({ player: p, knowledge: 90, analystRank: 45, interviews: 3 })!
    expect(r.verdict).toBe('higher')
    expect(r.blurb).toMatch(/higher on him/)
  })

  it('flags concerns LOWER than the board for a poor-character prospect', () => {
    const p = mk({ professionalism: 15, determination: 20, ambition: 25, temperament: 20 })
    const r = buildScoutDraftRead({ player: p, knowledge: 90, analystRank: 45, interviews: 2 })!
    expect(r.verdict).toBe('lower')
  })

  it('agrees with the consensus at the very top of the board (no out-scouting #1)', () => {
    const p = mk({ professionalism: 95, determination: 95, ambition: 90 })
    const r = buildScoutDraftRead({ player: p, knowledge: 90, analystRank: 1, interviews: 3 })!
    expect(r.verdict).toBe('inline')
  })

  it('divergence grows the deeper the prospect is ranked', () => {
    const p = mk({ professionalism: 90, determination: 90, ambition: 85 })
    const top = buildScoutDraftRead({ player: p, knowledge: 90, analystRank: 3, interviews: 3 })!
    const deep = buildScoutDraftRead({ player: p, knowledge: 90, analystRank: 60, interviews: 3 })!
    expect(Math.abs(deep.delta)).toBeGreaterThan(Math.abs(top.delta))
  })
})
