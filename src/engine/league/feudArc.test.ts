/**
 * The feud arc's pure rules (story audit 2026-10 §4): cause detection from the
 * lines, the rate limits, and words that name a dated cause.
 */
import { describe, expect, it } from 'vitest'
import {
  FEUD_MAX_PER_SEASON,
  aScore,
  detectRoleTaken,
  feudOptions,
  feudOutcome,
  feudSceneText,
  freshFeudState,
  mayRaiseFeud,
  type FeudArc,
  type FeudCause,
  type FeudChoice,
} from './feudArc'

const N = { a: 'Eeli Lundell', b: 'Gus Forsling', coach: 'Paul Maurice', captain: 'Sasha Barkov' }

function arc(over: Partial<FeudArc> = {}): FeudArc {
  const cause: FeudCause = { kind: 'roleTaken', aId: 'a', bId: 'b', year: 2026, day: 34, date: '2026-11-03', slot: 'first line' }
  return {
    id: 'fa0', interactionId: 'i0', aId: 'a', bId: 'b', cause, status: 'cooling',
    raisedYear: 2026, raisedDay: 34, raisedDate: '2026-11-03', gamesApart: 0, gamesNeeded: 8, escalations: 0, ...over,
  }
}

describe('cause detection', () => {
  it('a top-six man who drops while a teammate takes his tier is a role taken; a reshuffle below is not', () => {
    const prev = new Map([['a', 1], ['b', 2], ['c', 3], ['d', 4]])
    const now = new Map([['a', 2], ['b', 1], ['c', 4], ['d', 3]])
    const g = (): 'F' => 'F'
    // a lost line 1 to b. c (third line) dropping to the fourth is depth churn.
    expect(detectRoleTaken(prev, now, g)).toEqual([{ aId: 'a', bId: 'b', slot: 'first line' }])
  })

  it('positions do not cross: a defenceman cannot take a forward line', () => {
    const prev = new Map([['f', 1], ['d', 2]])
    const now = new Map([['f', 2], ['d', 1]])
    expect(detectRoleTaken(prev, now, (id) => (id === 'd' ? 'D' : 'F'))).toEqual([])
  })
})

describe('rate rules', () => {
  it('at most two a season, a month apart, one on the desk at a time', () => {
    const st = freshFeudState()
    expect(mayRaiseFeud(st, 'a', 'b', 2026, 10)).toBe(true)
    st.arcs.push(arc({ status: 'raised', raisedDay: 10 }))
    expect(mayRaiseFeud(st, 'c', 'd', 2026, 50)).toBe(false) // one on the desk
    st.arcs[0]!.status = 'cooling'
    expect(mayRaiseFeud(st, 'c', 'd', 2026, 30)).toBe(false) // too soon
    expect(mayRaiseFeud(st, 'c', 'd', 2026, 41)).toBe(true)
    st.arcs.push(arc({ id: 'fa1', aId: 'c', bId: 'd', raisedDay: 41 }))
    expect(st.arcs.filter((x) => x.raisedYear === 2026)).toHaveLength(FEUD_MAX_PER_SEASON)
    expect(mayRaiseFeud(st, 'e', 'f', 2026, 120)).toBe(false) // season quota spent
    expect(mayRaiseFeud(st, 'e', 'f', 2027, 5)).toBe(true) // new season
  })

  it('the same pair only comes back when their last arc escalated', () => {
    const st = freshFeudState()
    st.arcs.push(arc({ status: 'resolved', raisedYear: 2025 }))
    expect(mayRaiseFeud(st, 'b', 'a', 2026, 40)).toBe(false)
    st.arcs[0]!.status = 'escalated'
    expect(mayRaiseFeud(st, 'b', 'a', 2026, 40)).toBe(true)
  })
})

describe('the words', () => {
  const causes: FeudCause[] = [
    { kind: 'roleTaken', aId: 'a', bId: 'b', year: 2026, day: 34, date: '2026-11-03', slot: 'first line' },
    { kind: 'contractEnvy', aId: 'a', bId: 'b', year: 2026, day: 0, date: '2026-07-05', bMoney: '$6.5 million', aMoney: '$2.5 million', aPoints: 41, bPoints: 30 },
    { kind: 'captaincy', aId: 'a', bId: 'b', year: 2026, day: 0, date: '2026-09-23', aWasAlternate: true },
    { kind: 'publicComment', aId: 'a', bId: 'b', year: 2026, day: 12, date: '2026-10-12', quote: 'Forsling has been our best defenceman' },
    { kind: 'badNight', aId: 'a', bId: 'b', year: 2026, day: 40, date: '2026-11-09', aPlusMinus: -3, bPlusMinus: -2, score: '8–1', opponent: 'Boston', unit: 'pair' },
  ]

  it('every scene names its dated cause in the first sentence, with no unfilled slots', () => {
    for (const cause of causes) {
      for (let i = 0; i < 6; i++) {
        const text = feudSceneText({ id: `fa${i}`, cause }, N)
        const first = text.split(/(?<=[.!?]["”]?)\s/)[0]!
        expect(first, cause.kind).toMatch(/(Nov 3|Jul 5|Sep 23|Oct 12|Nov 9)/)
        expect(text).not.toMatch(/\{|\}|undefined|NaN/)
        expect(text).toContain('Paul Maurice shuts your door')
      }
    }
    expect(feudSceneText({ id: 'x', cause: causes[0]! }, N)).toMatch(/^On Nov 3 Gus Forsling took Eeli Lundell's place on the first line\./)
  })

  it('a bad night reads like a box score: plus-minus, the score, the opponent, the date', () => {
    expect(feudSceneText({ id: 'x', cause: causes[4]! }, N)).toMatch(
      /^Eeli Lundell finished minus-3 and Gus Forsling minus-2 on the same pair in the 8–1 loss to Boston on Nov 9\./)
    expect(aScore('8–1')).toBe('an 8–1')
    expect(aScore('5–2')).toBe('a 5–2')
    expect(aScore('11–4')).toBe('an 11–4')
  })

  it('a second scene for an escalated pair quotes the first', () => {
    const prev = arc({ status: 'escalated', choice: 'split', decidedDate: '2026-11-04', escalatedDate: '2026-12-01' })
    const text = feudSceneText({ id: 'fa9', cause: causes[0]!, escalatedDate: '2026-12-01', previousArcId: 'fa0' }, N, prev)
    expect(text.startsWith('You split them on Nov 4. They were back on the same line on Dec 1.')).toBe(true)
  })

  it('the options include the captain only when he is a third party, and every receipt is filled', () => {
    expect(feudOptions(N, true).map((o) => o.id)).toEqual(['split', 'backA', 'backB', 'captain', 'shop'])
    const { a, b, coach } = N
    expect(feudOptions({ a, b, coach }, false).map((o) => o.id)).toEqual(['split', 'backA', 'backB', 'shop'])
    for (const c of ['split', 'backA', 'backB', 'captain', 'shop'] as FeudChoice[]) {
      for (const worked of [true, false]) {
        const t = feudOutcome(c, N, worked)
        expect(t).not.toMatch(/\{|\}|undefined/)
        expect(t.length).toBeGreaterThan(20)
      }
    }
    // The receipt matches the act: "tell him to sort it out" can't read as "appreciated being heard".
    expect(feudOutcome('backA', N)).toMatch(/you're with Lundell/)
    expect(feudOutcome('captain', N, false)).toMatch(/didn't take/)
  })
})
