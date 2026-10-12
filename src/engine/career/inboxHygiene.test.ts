/**
 * Inbox hygiene (loop audit 3 F16 + F11): unread mail files itself by shelf
 * life, other clubs' routine news folds into one daily digest, decisions on
 * your club stay prominent, and another club's sub-replacement waiver
 * placement is not mail at all.
 */
import { describe, expect, it } from 'vitest'
import type { NewsItem } from '@domain/news'
import { generateLeague } from '@data/generate'
import { Career } from './career'
import {
  INBOX_SHELF_DAYS,
  daysBetween,
  digestMembers,
  fileStaleMail,
  foldDigests,
  inboxPriority,
} from './inboxHygiene'

let id = 0
function item(over: Partial<NewsItem>): NewsItem {
  return {
    id: `t${id++}`, day: 10, year: 2026, category: 'league', headline: 'Something happened', body: 'Body.',
    read: false, ...over,
  }
}
const OURS = 'us'
const involves = (n: NewsItem): boolean => n.teamId === OURS

describe('inbox priority and shelf life', () => {
  it('a decision on your club is high; the same mail about another club is not', () => {
    expect(inboxPriority(item({ category: 'contract', teamId: OURS }), true)).toBe('high')
    expect(inboxPriority(item({ category: 'contract', teamId: 'them' }), false)).toBe('normal')
    expect(inboxPriority(item({ category: 'result', teamId: OURS }), true)).toBe('low')
    expect(inboxPriority(item({ category: 'league', salience: 60 }), false)).toBe('high')
  })

  it('unread mail files itself once past its shelf, and not a day before', () => {
    // Match day 10 of 2026 = Oct 10, 2026.
    const low = item({ category: 'result', teamId: OURS })
    const high = item({ category: 'contract', teamId: OURS })
    fileStaleMail([low, high], '2026-10-13', involves)
    expect(low.read).toBe(false) // exactly 3 days: still on the shelf
    fileStaleMail([low, high], '2026-10-14', involves)
    expect(low.read).toBe(true)
    expect(high.read).toBe(false)
    expect(INBOX_SHELF_DAYS.high).toBe(30)
    fileStaleMail([high], '2026-11-09', involves)
    expect(high.read).toBe(false)
    fileStaleMail([high], '2026-11-10', involves)
    expect(high.read).toBe(true)
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3)
  })
})

describe('daily digest', () => {
  it("folds one day's other-club routine items into one item; reading it reads them all", () => {
    const a = item({ teamId: 'x', headline: 'Smith losing a step', digest: true })
    const b = item({ teamId: 'y', headline: 'Jones retires', digest: true })
    const mine = item({ teamId: OURS, category: 'contract', headline: 'Your man signs' })
    const other = item({ teamId: 'z', day: 11, headline: 'Lone item on another day', digest: true })
    // Untagged mail about other clubs is never folded: tag at the write site.
    const untagged = item({ teamId: 'q', headline: 'FRENZY: $58M committed as free agency opens' })
    const out = foldDigests([a, mine, b, other, untagged], involves)
    expect(out.map((n) => n.id)).toEqual(['dg-2026-10-10', mine.id, other.id, untagged.id])
    const dg = out[0]!
    expect(dg.headline).toBe('Around the league, Oct 10: 2 items from other clubs')
    expect(dg.body.split('\n')).toEqual(['Smith losing a step', 'Jones retires'])
    expect(dg.read).toBe(false)
    expect(digestMembers(dg.id, [a, mine, b, other], involves).sort()).toEqual([a.id, b.id].sort())
  })
})

describe('inbox in the career', () => {
  it('stays under 60 unread through two months of a delegated season', () => {
    const data = generateLeague({ seed: 2029 })
    const career = new Career(data, 2029, data.league.teams[3]!)
    let maxUnread = 0
    for (let d = 0; d < 60; d++) {
      career.advance(1)
      maxUnread = Math.max(maxUnread, career.getInbox().unread)
    }
    // Before the hygiene pass this seed sat at 157 unread by day 60.
    expect(maxUnread).toBeLessThan(60)
    const inbox = career.getInbox()
    expect(career.getDashboard().unreadNews).toBe(inbox.unread)
    // Important mail is flagged so it can be listed first.
    for (const iid of inbox.important ?? []) {
      expect(inbox.items.find((n) => n.id === iid)?.read).toBe(false)
    }
  }, 120_000)

  it("another club's sub-replacement waiver placement never reaches the inbox (F11)", () => {
    const data = generateLeague({ seed: 2030 })
    const career = new Career(data, 2030, data.league.teams[0]!)
    for (let d = 0; d < 50; d++) career.advance(1)
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const c = career as any
    const raw = c.news.filter((n: NewsItem) => /placed on waivers by/.test(n.headline))
    expect(raw.length, 'the AI wire did place players').toBeGreaterThan(0)
    for (const n of raw) expect(n.reach === 'ambient' || (n.salience ?? 0) >= 55).toBe(true)
    const inInbox = career.getInbox().items.filter((n) => /placed on waivers by/.test(n.headline) || /placed on waivers by/.test(n.body))
    for (const n of inInbox) expect((n.salience ?? 0) >= 55 || n.id.startsWith('dg-')).toBe(true)
  }, 120_000)
})
