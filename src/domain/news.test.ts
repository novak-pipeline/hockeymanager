import { describe, expect, it } from 'vitest'
import { BREAKING_SALIENCE, FEED_TO_INBOX_SALIENCE, feedStoryReachesInbox, isBreakingNews } from './news'

/**
 * Playtest #13 introduced the BREAKING predicate. Playtest 2026-08-26 (A7)
 * found it "applied too loosely to mean anything": measured over four simmed
 * seasons the tag landed 21 times, and NINE of those were social posts from an
 * analytics bot, wearing it purely because that story pattern happened to be
 * firing for the first time in the save. Early in a save every pattern is
 * firing for the first time — `rare` is a novelty flag, and it was doing duty
 * as an importance flag.
 *
 * Two rules now: novelty is not magnitude, and a tweet is not a report.
 * Inbox ADMISSION is a separate, lower bar — relevance, not size.
 */
describe('isBreakingNews (A7)', () => {
  it('fires only at/above the salience threshold', () => {
    expect(isBreakingNews({ salience: BREAKING_SALIENCE })).toBe(true)
    expect(isBreakingNews({ salience: BREAKING_SALIENCE - 1 })).toBe(false)
    expect(isBreakingNews({ salience: 95 })).toBe(true)
  })

  it('never fires on items without a salience score', () => {
    expect(isBreakingNews({})).toBe(false)
  })

  it('novelty is not magnitude: rare alone is no longer breaking', () => {
    expect(isBreakingNews({ salience: 45, rare: true })).toBe(false)
    expect(isBreakingNews({ rare: true })).toBe(false)
    expect(isBreakingNews({ salience: 45, rare: false })).toBe(false)
  })

  it('a social post is never breaking news, however loud it is', () => {
    // "@puckmodel · BREAKING" was the tell. A post is a REACTION to news.
    expect(isBreakingNews({ salience: 95, channel: 'feed' })).toBe(false)
    expect(isBreakingNews({ salience: 95, rare: true, channel: 'feed' })).toBe(false)
    expect(isBreakingNews({ salience: 95, channel: 'wire' })).toBe(true)
  })

  it('the bar sits where the hand-authored tentpoles actually sit', () => {
    // Blockbuster trade column + elimination 85, deadline day 88, clinch 90,
    // all-time record 95. Those are the five or six a season the word is for.
    expect(BREAKING_SALIENCE).toBe(85)
    expect(BREAKING_SALIENCE).toBeGreaterThan(FEED_TO_INBOX_SALIENCE)
  })
})

describe('feedStoryReachesInbox — admission, not magnitude', () => {
  it('promotes a big or first-of-its-kind feed story onto the desk', () => {
    expect(feedStoryReachesInbox({ salience: FEED_TO_INBOX_SALIENCE })).toBe(true)
    expect(feedStoryReachesInbox({ salience: 45, rare: true })).toBe(true)
  })

  it('leaves ordinary chatter on the Feed', () => {
    expect(feedStoryReachesInbox({ salience: FEED_TO_INBOX_SALIENCE - 1 })).toBe(false)
    expect(feedStoryReachesInbox({})).toBe(false)
  })

  it('admission is a LOWER bar than the tag — a story can reach you unbolded', () => {
    const midBand = { salience: 82 }
    expect(feedStoryReachesInbox(midBand)).toBe(true)
    expect(isBreakingNews(midBand)).toBe(false)
  })
})
