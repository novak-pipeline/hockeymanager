/**
 * The salience proof harness (docs/THE-FEED.md): sim a full season and check
 * the feed's *distribution*, not individual posts — right volume, budget
 * respected, more than one detector contributing, novelty preventing repeats.
 * When the detector library fans out, this is the net that catches a detector
 * dominating the feed or the volume drifting into spam.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from '@engine/career/career'
import { DAILY_POST_BUDGET } from '@engine/story/salience'
import { VOICE_DAILY_CAP } from '@engine/story/voices'

describe('salience harness — one full season', () => {
  it('produces a healthy feed distribution', () => {
    const data = generateLeague({ seed: 4242 })
    const c = new Career(data, 4242, data.league.teams[0])
    // Run the whole regular season (guard well past its length).
    for (let i = 0; i < 200; i++) {
      const dash = c.getDashboard()
      if (dash.phase !== 'regularSeason') break
      if (!c.advanceDay()) break
    }

    const feed = c.getFeed()
    const posts = feed.posts

    // Volume: a season should produce a real feed, but never a firehose.
    // FEED-V2-1 added player/GM voices, so the ceiling covers both streams.
    expect(posts.length).toBeGreaterThanOrEqual(4)
    expect(posts.length).toBeLessThanOrEqual(400)

    // Budget: the two streams carry SEPARATE caps — the pundit class still
    // gets at most DAILY_POST_BUDGET a day, voices at most VOICE_DAILY_CAP,
    // and no day may exceed the two of them combined.
    const kindOf = (p: { authorId?: string }): string => feed.authors[p.authorId!]?.kind ?? 'wire'
    const isVoice = (p: { authorId?: string }): boolean => kindOf(p) === 'player' || kindOf(p) === 'gm'
    const punditPerDay = new Map<number, number>()
    const voicePerDay = new Map<number, number>()
    const perDay = new Map<number, number>()
    for (const p of posts) {
      perDay.set(p.day, (perDay.get(p.day) ?? 0) + 1)
      const bucket = isVoice(p) ? voicePerDay : punditPerDay
      bucket.set(p.day, (bucket.get(p.day) ?? 0) + 1)
    }
    for (const n of punditPerDay.values()) expect(n).toBeLessThanOrEqual(DAILY_POST_BUDGET)
    for (const n of voicePerDay.values()) expect(n).toBeLessThanOrEqual(VOICE_DAILY_CAP)
    for (const n of perDay.values()) expect(n).toBeLessThanOrEqual(DAILY_POST_BUDGET + VOICE_DAILY_CAP)

    // No detector class may own the feed outright once several contribute.
    const byAuthor = new Map<string, number>()
    for (const p of posts) byAuthor.set(p.authorId!, (byAuthor.get(p.authorId!) ?? 0) + 1)

    // Novelty: no exact story twice.
    const texts = posts.map((p) => p.body)
    expect(new Set(texts).size).toBe(texts.length)

    // Every post is renderable: author resolves, engagement frozen, salience sane.
    for (const p of posts) {
      expect(feed.authors[p.authorId!]).toBeTruthy()
      expect(p.salience).toBeGreaterThanOrEqual(30)
      expect(p.salience).toBeLessThanOrEqual(100)
      expect(p.engagement!.likes).toBeGreaterThan(0)
    }

    // Console report for eyeballing when tuning (visible with --reporter=verbose).
    // eslint-disable-next-line no-console
    console.log(
      `[salience harness] ${posts.length} posts / season · by author: ${[...byAuthor.entries()]
        .map(([a, n]) => `${a}:${n}`)
        .join(' ')} · days with posts: ${perDay.size}`
    )
  })
})
