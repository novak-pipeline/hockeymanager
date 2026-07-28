/**
 * Gap #7 — the Continue loop stops for decisions and stories, not for noise.
 *
 * The failure this guards against is the quiet one: a rule that stops for
 * everything feels identical to a rule that stops for nothing worth reading, and
 * the GM pays a click per day either way.
 */
import { describe, expect, it } from 'vitest'
import type { NewsItem } from '@domain/news'
import { shouldHoldOverlay, worthAStop, STOP_SALIENCE } from './cadence'

const item = (over: Partial<NewsItem>): NewsItem => ({
  id: 'n1', day: 5, year: 2029, category: 'league',
  headline: 'h', body: 'b', read: false, ...over,
})

describe('worthAStop', () => {
  it('ignores ambient league churn — the 30% of days that stopped for nothing', () => {
    expect(worthAStop(item({ category: 'league' }))).toBe(false)
  })

  it('stops for anything touching the GM\'s own club', () => {
    for (const category of ['result', 'injury', 'trade', 'contract', 'draft', 'award', 'milestone'] as const) {
      expect(worthAStop(item({ category }))).toBe(true)
    }
  })

  it('stops for a notable league story — bylined, rare, or highly salient', () => {
    expect(worthAStop(item({ press: { byline: 'A — B', kind: 'weekly' } }))).toBe(true)
    expect(worthAStop(item({ rare: true }))).toBe(true)
    expect(worthAStop(item({ salience: STOP_SALIENCE }))).toBe(true)
    // Just under the bar stays silent, so the threshold is a real edge.
    expect(worthAStop(item({ salience: STOP_SALIENCE - 1 }))).toBe(false)
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
    expect(shouldHoldOverlay([item({}), item({ id: 'n2', category: 'injury' })], false)).toBe(true)
  })

  it('always holds after a user game, however quiet the mail', () => {
    // The receipts ARE the stop — this must not be filterable by news rules.
    expect(shouldHoldOverlay([], true)).toBe(true)
    expect(shouldHoldOverlay([item({})], true)).toBe(true)
  })
})
