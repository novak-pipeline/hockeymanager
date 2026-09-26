/**
 * Gap #7 — the Continue loop stops for decisions and stories, not for noise.
 *
 * The failure this guards against is the quiet one: a rule that stops for
 * everything feels identical to a rule that stops for nothing worth reading, and
 * the GM pays a click per day either way.
 */
import { describe, expect, it } from 'vitest'
import type { NewsItem } from '@domain/news'
import { receiptWorthAStop, shouldHoldOverlay, worthAStop, STOP_SALIENCE } from './cadence'

const item = (over: Partial<NewsItem>): NewsItem => ({
  id: 'n1', day: 5, year: 2029, category: 'league',
  headline: 'h', body: 'b', read: false, ...over,
})

describe('worthAStop', () => {
  it('ignores ambient league churn — the 30% of days that stopped for nothing', () => {
    expect(worthAStop(item({ category: 'league' }))).toBe(false)
  })

  it('PHASE 0: stops for decisions and payoffs — contracts, milestones, awards, draft, playoffs', () => {
    for (const category of ['contract', 'draft', 'award', 'milestone', 'playoffs'] as const) {
      expect(worthAStop(item({ category }))).toBe(true)
    }
  })

  it('PHASE 0: scouting reports, press columns, depth injuries and trade-desk mail stream past', () => {
    for (const category of ['scouting', 'injury', 'trade', 'result'] as const) {
      expect(worthAStop(item({ category }))).toBe(false)
    }
    expect(worthAStop(item({ press: { byline: 'A — B', kind: 'weekly' } }))).toBe(false)
    // Your own man's slump quote is colour, not a stop (unless it is a first).
    expect(worthAStop(item({ category: 'contract', reach: 'ownClub' }))).toBe(false)
  })

  it('stops for a notable story — rare, or highly salient (key-man injuries carry salience)', () => {
    expect(worthAStop(item({ rare: true }))).toBe(true)
    expect(worthAStop(item({ category: 'injury', salience: 60 }))).toBe(true)
    expect(worthAStop(item({ salience: STOP_SALIENCE }))).toBe(true)
    // Just under the bar stays silent, so the threshold is a real edge.
    expect(worthAStop(item({ salience: STOP_SALIENCE - 1 }))).toBe(false)
  })
})

describe('the social feed is read, not stopped for (PHASE 0)', () => {
  it('a highly-scored feed post in the inbox streams past; a first-of-its-kind one still stops', () => {
    expect(worthAStop(item({ authorId: 'analyst', salience: 80 }))).toBe(false)
    expect(worthAStop(item({ authorId: 'insider', salience: 95, rare: true }))).toBe(true)
  })
})

describe('receiptWorthAStop (PHASE 0)', () => {
  const r = (homeGoals: number, awayGoals: number, over: Partial<{ playoff: boolean; storyline: string | null }> = {}) =>
    ({ playoff: false, homeGoals, awayGoals, storyline: null, ...over })

  it('a routine result rides on the next match-day frame', () => {
    expect(receiptWorthAStop(r(3, 2))).toBe(false)
    expect(receiptWorthAStop(r(2, 4))).toBe(false)
  })

  it('a result that IS a story stops: playoffs, the chronicle, blowouts, shutouts, the season finale', () => {
    expect(receiptWorthAStop(r(3, 2, { playoff: true }))).toBe(true)
    expect(receiptWorthAStop(r(3, 2, { storyline: 'Revenge served' }))).toBe(true)
    expect(receiptWorthAStop(r(6, 2))).toBe(true)
    expect(receiptWorthAStop(r(1, 5))).toBe(true)
    expect(receiptWorthAStop(r(2, 0))).toBe(true)
    expect(receiptWorthAStop(r(0, 1))).toBe(true)
    expect(receiptWorthAStop(r(3, 2), true)).toBe(true)
  })
})

describe('shouldHoldOverlay', () => {
  it('closes on a genuinely quiet day', () => {
    expect(shouldHoldOverlay([], false)).toBe(false)
  })

  it('closes when the only mail is league churn', () => {
    expect(shouldHoldOverlay([item({}), item({ id: 'n2' })], false)).toBe(false)
  })

  it('holds when one real item hides among the churn', () => {
    expect(shouldHoldOverlay([item({}), item({ id: 'n2', category: 'contract' })], false)).toBe(true)
  })

  it('always holds after a user game, however quiet the mail', () => {
    // The receipts ARE the stop — this must not be filterable by news rules.
    expect(shouldHoldOverlay([], true)).toBe(true)
    expect(shouldHoldOverlay([item({})], true)).toBe(true)
  })
})
