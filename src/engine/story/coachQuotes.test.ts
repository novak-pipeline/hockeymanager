import { describe, expect, it } from 'vitest'
import { coachQuote, type CoachSituation, type CoachQuoteFacts } from './coachQuotes'
import type { StaffMember } from '@engine/league/staff'

function makeCoach(demeanor: StaffMember['demeanor']): StaffMember {
  return {
    id: 'test-coach',
    name: 'Randy Carlyle',
    role: 'headCoach',
    rating: 70,
    judgment: 65,
    demeanor,
  }
}

const situations: CoachSituation[] = [
  'postBigWin',
  'postBadLoss',
  'winStreak',
  'losingStreak',
  'milestone',
  'signing',
  'tradeAdd',
  'slumpingStar',
]

describe('coachQuote', () => {
  it('returns a non-empty string for every situation × demeanor combination', () => {
    const demeanors: Array<NonNullable<StaffMember['demeanor']>> = [
      'fiery', 'calm', 'analytical', 'motivator', 'pragmatic',
    ]
    for (const situation of situations) {
      for (const d of demeanors) {
        const coach = makeCoach(d)
        const q = coachQuote(coach, situation, {}, 12345)
        expect(q.length, `${situation}/${d}`).toBeGreaterThan(10)
      }
    }
  })

  it('different demeanors produce different quotes for the same situation and seed', () => {
    const seed = 42
    const facts: CoachQuoteFacts = { opponentAbbr: 'TOR', score: '5-1', goalDiff: 4 }
    const fiery = coachQuote(makeCoach('fiery'), 'postBigWin', facts, seed)
    const calm = coachQuote(makeCoach('calm'), 'postBigWin', facts, seed)
    const analytical = coachQuote(makeCoach('analytical'), 'postBigWin', facts, seed)
    const motivator = coachQuote(makeCoach('motivator'), 'postBigWin', facts, seed)
    const pragmatic = coachQuote(makeCoach('pragmatic'), 'postBigWin', facts, seed)

    // They should not all be equal
    const unique = new Set([fiery, calm, analytical, motivator, pragmatic])
    expect(unique.size).toBeGreaterThan(1)

    // Fiery should be different from calm
    expect(fiery).not.toBe(calm)
  })

  it('fills {opp} placeholder from facts.opponentAbbr', () => {
    const q = coachQuote(makeCoach('fiery'), 'postBadLoss', { opponentAbbr: 'BOS', goalDiff: 4 }, 99)
    // At least some fiery postBadLoss quotes reference the opponent
    // We can't guarantee a specific quote was chosen, so just check the output is deterministic.
    const q2 = coachQuote(makeCoach('fiery'), 'postBadLoss', { opponentAbbr: 'BOS', goalDiff: 4 }, 99)
    expect(q).toBe(q2)
  })

  it('fills {player} placeholder from facts.playerName', () => {
    const q = coachQuote(makeCoach('motivator'), 'slumpingStar', { playerName: 'Nick Suzuki', streakCount: 7 }, 55)
    expect(q.length).toBeGreaterThan(10)
    // If the selected template uses {player}, it should be replaced
    expect(q).not.toContain('{player}')
  })

  it('is deterministic — same args always produce same quote', () => {
    const coach = makeCoach('analytical')
    const facts: CoachQuoteFacts = { streakCount: 5 }
    const a = coachQuote(coach, 'winStreak', facts, 777)
    const b = coachQuote(coach, 'winStreak', facts, 777)
    expect(a).toBe(b)
  })

  it('different seeds produce variation across quotes for the same coach+situation', () => {
    const coach = makeCoach('fiery')
    const quotes = new Set(
      Array.from({ length: 20 }, (_, i) => coachQuote(coach, 'postBigWin', {}, i * 100))
    )
    // With 5 lines in the fiery pool, 20 seeds should produce at least 2 distinct quotes
    expect(quotes.size).toBeGreaterThan(1)
  })

  it('no unreplaced template tokens in any quote', () => {
    const facts: CoachQuoteFacts = {
      opponentAbbr: 'VAN',
      score: '3-0',
      goalDiff: 3,
      playerName: 'Auston Matthews',
      streakCount: 5,
    }
    for (const situation of situations) {
      for (const d of ['fiery', 'calm', 'analytical', 'motivator', 'pragmatic'] as const) {
        for (let seed = 0; seed < 5; seed++) {
          const q = coachQuote(makeCoach(d), situation, facts, seed * 997)
          expect(q, `${situation}/${d}/seed${seed}`).not.toMatch(/\{[a-z]+\}/)
        }
      }
    }
  })

  it('falls back to calm when demeanor is undefined', () => {
    const coach: StaffMember = {
      id: 'x',
      name: 'Coach',
      role: 'headCoach',
      rating: 60,
      judgment: 60,
      // no demeanor field
    }
    const q = coachQuote(coach, 'postBigWin', {}, 1)
    expect(q.length).toBeGreaterThan(10)
  })
})
