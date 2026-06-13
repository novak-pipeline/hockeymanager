/**
 * interview.test.ts — deterministic interview answers from traits.
 */
import { describe, it, expect } from 'vitest'
import type { Player } from '@domain'
import { answerInterviewQuestion, INTERVIEW_QUESTIONS } from './interview'

function makePlayer(p: Partial<{
  id: string
  ambition: number
  professionalism: number
  loyalty: number
  temperament: number
  determination: number
  pressure: number
  adaptability: number
}>): Player {
  return {
    id: (p.id ?? 'p1') as unknown as Player['id'],
    name: 'Test Player',
    age: 24,
    position: 'C',
    handedness: 'L',
    role: 'twoWay',
    personality: {
      ambition: p.ambition ?? 10,
      professionalism: p.professionalism ?? 10,
      loyalty: p.loyalty ?? 10,
      temperament: p.temperament ?? 10,
      determination: p.determination ?? 10,
    },
    contract: { salary: 1, yearsRemaining: 2, expiryYear: 2030, noTradeClause: false, twoWay: false },
    stats: [],
    fatigue: 0,
    morale: 60,
    injuryStatus: null,
    form: 0,
    ...(p.pressure !== undefined ? { pressure: p.pressure } : {}),
    ...(p.adaptability !== undefined ? { adaptability: p.adaptability } : {}),
  } as unknown as Player
}

describe('answerInterviewQuestion', () => {
  it('a highly ambitious player gives a high-ambition read', () => {
    const a = answerInterviewQuestion(makePlayer({ ambition: 19 }), 'goals')
    expect(a).not.toBeNull()
    expect(a!.trait).toBe('ambition')
    expect(a!.reveal.toLowerCase()).toContain('best')
  })

  it('a low-ambition player gives a content read', () => {
    const a = answerInterviewQuestion(makePlayer({ ambition: 3 }), 'goals')
    expect(a!.reveal.toLowerCase()).toContain('content')
  })

  it('probes a hidden trait (pressure) the GM can’t see in ratings', () => {
    const a = answerInterviewQuestion(makePlayer({ pressure: 19 }), 'bigMoments')
    expect(a!.trait).toBe('pressure')
    expect(a!.answer.length).toBeGreaterThan(0)
  })

  it('is deterministic for the same player + question', () => {
    const p = makePlayer({ determination: 17 })
    expect(answerInterviewQuestion(p, 'drive')).toEqual(answerInterviewQuestion(p, 'drive'))
  })

  it('returns null for an unknown question', () => {
    expect(answerInterviewQuestion(makePlayer({}), 'nope')).toBeNull()
  })

  it('every question id resolves to an answer', () => {
    const p = makePlayer({})
    for (const q of INTERVIEW_QUESTIONS) {
      expect(answerInterviewQuestion(p, q.id), q.id).not.toBeNull()
    }
  })
})
