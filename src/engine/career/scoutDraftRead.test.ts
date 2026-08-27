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
    // A4: the wording is drawn from a pool, so pin the DIRECTION, not a phrase.
    expect(r.blurb).toMatch(/higher on him|ahead of a consensus|before the rankings|in his favour|came away sold/)
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
//
// A4 (playtest 2026-08-26): the note is now drawn from authored variant pools —
// "the board" was every third word in the scouting layer. These tests therefore
// pin the INVARIANTS (both numbers named, the direction of the disagreement, no
// broken plurals) rather than one blessed sentence, and add a test that the
// pools actually produce range.
describe('scoutBoardNote', () => {
  const base = { ourRank: 38, consensusRank: 20, verdict: 'lower' as const, seen: true }

  it('always names both rankings, so the two numbers are never bare', () => {
    for (const verdict of ['higher', 'inline', 'lower'] as const) {
      for (const playerId of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
        const s = scoutBoardNote({ ...base, verdict, playerId })
        expect(s).toMatch(/#38/)
        expect(s).toMatch(/#20/)
      }
    }
  })

  it('an unseen prospect is a placeholder, whichever frame he draws', () => {
    for (const playerId of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      const s = scoutBoardNote({ ...base, seen: false, playerId })
      expect(s).toMatch(/#38/)
      expect(s).toMatch(/#20/)
      // It must read as an absence of opinion, not as one.
      expect(s).toMatch(/[Ll]ight viewings|for want of one of our own|has seen enough|[Uu]nwatched/)
      expect(s).not.toMatch(/interviews well|maturity and attitude|two-way game/)
    }
  })

  it('explains a ▼ on a prospect whose CEILING we rate just as highly — the 5★ case', () => {
    // We are lower on the board but not on the player: the disagreement is about
    // the field, and the sentence has to say so rather than imply we dislike him.
    for (const playerId of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      const s = scoutBoardNote({ ...base, playerId, ourCeiling: 84, analystCeiling: 84 })
      expect(s).toMatch(/other prospect|other name|about the field|ahead of him|as highly as anyone/)
      // Never the flat "we are lower on the player" reading.
      expect(s).not.toMatch(/cooler on him|questions|lags behind/)
    }
  })

  it('gives a concrete reason when we genuinely rate the player lower', () => {
    for (const playerId of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      const s = scoutBoardNote({
        ...base, playerId, ourCeiling: 64, analystCeiling: 80, twoWayAdj: -2, intangibleAdj: 0,
      })
      expect(s).toMatch(/away from the puck|flatter|hole in his game/)
    }
  })

  it('says how much earlier we would take a prospect we like', () => {
    const s = scoutBoardNote({
      ourRank: 12, consensusRank: 30, verdict: 'higher', seen: true, twoWayAdj: 2, playerId: 'x',
    })
    expect(s).toMatch(/#12/)
    expect(s).toMatch(/#30/)
  })

  it('reads as agreement when the boards line up', () => {
    for (const playerId of ['a', 'b', 'c', 'd', 'e']) {
      const s = scoutBoardNote({ ourRank: 21, consensusRank: 20, verdict: 'inline', seen: true, playerId })
      expect(s).toMatch(/rounding error|same story|tracks the industry|the way the rest of the industry|not arguing|no appetite/)
    }
  })

  it('never says "1 spots" / "1 prospects" / "1 names"', () => {
    for (const playerId of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      for (const verdict of ['higher', 'lower'] as const) {
        const s = scoutBoardNote({
          ourRank: 19, consensusRank: 20, verdict, seen: true, playerId,
          ourCeiling: 80, analystCeiling: 80,
        })
        expect(s).not.toMatch(/\b1 (spots|prospects|names)\b/)
      }
    }
  })

  // The whole point of A4: two prospects in the same state must not read
  // identically, and one prospect must read identically every time (a view
  // rebuilds this on every render — the card cannot flicker).
  it('varies across prospects and is stable for one', () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10']
    // A generic state (small gap, no standout reason) draws from the widest
    // pool; a highly specific state narrows the register but must still vary.
    const generic = { ourRank: 22, consensusRank: 25, verdict: 'higher' as const, seen: true }
    const wide = ids.map((playerId) => scoutBoardNote({ ...generic, playerId }))
    expect(new Set(wide).size).toBeGreaterThanOrEqual(3)
    const notes = ids.map((playerId) => scoutBoardNote({ ...base, playerId, verdict: 'higher' }))
    expect(new Set(notes).size).toBeGreaterThanOrEqual(2)
    for (const playerId of ids) {
      const a = scoutBoardNote({ ...base, playerId, verdict: 'higher' })
      const b = scoutBoardNote({ ...base, playerId, verdict: 'higher' })
      expect(a).toBe(b)
    }
  })

  it('never leaves an unfilled slot in a rendered note', () => {
    for (const seen of [true, false]) {
      for (const verdict of ['higher', 'inline', 'lower'] as const) {
        for (const playerId of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
          const s = scoutBoardNote({
            ...base, verdict, seen, playerId,
            ourRole: 'Top-six F', theirRole: 'Middle-six F',
            intangibleAdj: 2, twoWayAdj: 0, ourCeiling: 70, analystCeiling: 78,
          })
          expect(s).not.toMatch(/\{[a-zA-Z]/)
        }
      }
    }
  })
})
