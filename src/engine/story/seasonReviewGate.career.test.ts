/**
 * A2 — the season review may not be written about a season nobody played.
 *
 * Every new career begins at the SUMMER TAKEOVER (Career.startAtOffseason):
 * the day after a draft, in the offseason, with an untouched 0-0-0 league.
 * Advancing walks resign -> freeAgency -> preseason, and the press schedule
 * fires its season review on entering 'preseason'. The playtest save opened
 * with this in the inbox before a single puck had dropped:
 *
 *   "2025-2026 season review: Pittsburgh Penguins over-delivered on every
 *    expectation ... The Penguins finish at 0-0-0 (0 pts, 15th of 32). The
 *    preseason numbers had them 18th; they've beaten that projection by 3."
 *
 * Every clause of that is false. This test walks a real career through the
 * takeover offseason and proves no retrospective is written on the way.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from '@engine/career/career'
import type { NewsItem } from '@domain'

/** Every news beat the career has written so far (the inbox is capped; this
 *  reads the raw list, which is what the screens draw from). */
function allNews(career: Career): NewsItem[] {
  return (career as unknown as { news: NewsItem[] }).news
}

function gamesPlayed(career: Career): number {
  const standings = (career as unknown as { standings: Map<unknown, { gamesPlayed: number }> }).standings
  let n = 0
  for (const s of standings.values()) n += s.gamesPlayed
  return n
}

describe('A2 — no season review before a season', () => {
  it('a career walked from the summer takeover to opening night never writes one', () => {
    const data = generateLeague({ seed: 4141 })
    const career = new Career(data, 4141, data.league.teams[0]!)
    career.startAtOffseason()

    // Walk the whole takeover offseason. Guarded: a stage that refuses to
    // advance (a gate awaiting a UI decision) ends the walk rather than
    // spinning — we only need to reach opening night, or run out of stages.
    let guard = 0
    while (career.getDashboard().phase === 'offseason' && guard++ < 400) {
      if (!career.advanceOffseason()) break
    }

    expect(gamesPlayed(career)).toBe(0)
    const reviews = allNews(career).filter((n) => /season review/i.test(n.headline))
    expect(reviews.map((n) => n.headline)).toEqual([])
  })

  it('and nothing written before puck drop claims a record, a finish or a verdict', () => {
    const data = generateLeague({ seed: 4141 })
    const career = new Career(data, 4141, data.league.teams[0]!)
    career.startAtOffseason()
    let guard = 0
    while (career.getDashboard().phase === 'offseason' && guard++ < 400) {
      if (!career.advanceOffseason()) break
    }
    expect(gamesPlayed(career)).toBe(0)

    // The tells of a retrospective written over an empty book: an 0-0-0 record
    // line, a finishing position, or a verdict on a projection.
    const LIES = [
      /\b0–0–0\b/,
      /\b0-0-0\b/,
      /finish(?:es)? at\b/i,
      /campaign is complete/i,
      /places ahead of schedule/i,
      /beaten that projection/i,
      /below their preseason projection/i,
      /gap between expectation and reality/i,
    ]
    const offenders = allNews(career).filter((n) =>
      LIES.some((re) => re.test(n.headline) || re.test(n.body))
    )
    expect(offenders.map((n) => `${n.headline} :: ${n.body.slice(0, 120)}`)).toEqual([])
  })
})
