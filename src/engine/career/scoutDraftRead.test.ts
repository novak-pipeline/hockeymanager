import { describe, expect, it } from 'vitest'
import type { Player } from '@domain'
import { buildScoutDraftRead, scoutBoardNote } from './scoutDraftRead'

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

  it('a higher ceiling read never reads as "more cautious" (verdict matches the displayed role)', () => {
    // A sleeper: our scouts grade his ceiling clearly above the board, but he has
    // makeup concerns. The ceiling read must drive the verdict — we can't show a
    // higher ceiling role AND call ourselves more cautious.
    const p = mk({ professionalism: 18, determination: 22, ambition: 25, temperament: 22 })
    const r = buildScoutDraftRead({
      player: p, knowledge: 90, analystRank: 50, interviews: 1,
      scoutsCeiling: 74, scoutsRole: '2nd-pair D',
      analystCeiling: 66, analystRole: 'Depth D',
    })!
    expect(r.verdict).not.toBe('lower')
    expect(r.blurb).toMatch(/higher|ceiling/)
  })

  it('a clearly lower ceiling read reads as more cautious', () => {
    const p = mk({ professionalism: 60, determination: 60, ambition: 55 })
    const r = buildScoutDraftRead({
      player: p, knowledge: 90, analystRank: 30, interviews: 1,
      scoutsCeiling: 62, scoutsRole: 'Depth D',
      analystCeiling: 76, analystRole: 'Top-pair D',
    })!
    expect(r.verdict).toBe('lower')
  })
})

// E2 (playtest 2026-07-31): a prospect showed 5★ potential AND a staff recommend
// on the same row as a bare "#38 ▼", with no explanation. The note is what turns
// that from an apparent contradiction into a stated scouting position.
describe('scoutBoardNote', () => {
  const base = { ourRank: 38, consensusRank: 20, verdict: 'lower' as const, seen: true }

  it('always names both rankings, so the two numbers are never bare', () => {
    for (const verdict of ['higher', 'inline', 'lower'] as const) {
      const s = scoutBoardNote({ ...base, verdict })
      expect(s).toMatch(/#38/)
      expect(s).toMatch(/#20/)
    }
  })

  it('explains a ▼ on a prospect whose CEILING we rate just as highly — the 5★ case', () => {
    // We are lower on the board but not on the player: the disagreement is about
    // the field, and the sentence has to say so rather than imply we dislike him.
    const s = scoutBoardNote({ ...base, ourCeiling: 84, analystCeiling: 84 })
    expect(s).toMatch(/ceiling as highly as anyone/)
    expect(s).toMatch(/18 other prospects/)
    expect(s).not.toMatch(/lower on him/)
  })

  it('gives a concrete reason when we genuinely rate the player lower', () => {
    const s = scoutBoardNote({
      ...base, ourCeiling: 64, analystCeiling: 80, twoWayAdj: -2, intangibleAdj: 0,
    })
    expect(s).toMatch(/lower on him than the consensus/)
    expect(s).toMatch(/away from the puck/)
    expect(s).toMatch(/let him slide/)
  })

  it('says how much earlier we would take a prospect we like', () => {
    const s = scoutBoardNote({
      ourRank: 12, consensusRank: 30, verdict: 'higher', seen: true, twoWayAdj: 2,
    })
    expect(s).toMatch(/higher on him than the consensus/)
    expect(s).toMatch(/18 spots earlier/)
  })

  it('flags an unseen prospect as a placeholder rather than an opinion', () => {
    const s = scoutBoardNote({ ...base, seen: false })
    expect(s).toMatch(/[Ll]ight viewings/)
    expect(s).toMatch(/placeholder/)
  })

  it('reads as agreement when the boards line up', () => {
    const s = scoutBoardNote({ ourRank: 21, consensusRank: 20, verdict: 'inline', seen: true })
    expect(s).toMatch(/lines up with the consensus/)
  })

  it('never says "1 spots" / "1 prospects"', () => {
    expect(scoutBoardNote({ ourRank: 19, consensusRank: 20, verdict: 'higher', seen: true })).toMatch(/1 spot earlier/)
    expect(scoutBoardNote({ ourRank: 21, consensusRank: 20, verdict: 'lower', seen: true, ourCeiling: 80, analystCeiling: 80 }))
      .toMatch(/1 other prospect they/)
  })
})
