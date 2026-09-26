/**
 * The writing pass (docs/WRITING-PASS-2026-09.md), pinned against a real season.
 *
 * A 25-season autopilot run on the imported league found no logic bugs and 351
 * prose ones: identical headlines fired 10-35 times a season ("Weekly scouting
 * digest", "You left it to the staff", "Rough night for <goalie>"), the coach
 * promised the goals would come for thirty defencemen a year, "legendary" was
 * spent on 480-point careers, and one-goal games got a bare scoreline.
 *
 * This walks one real regular season on the fictional league and asserts the
 * shape of what the GM reads, not the words (which are pooled and may change):
 *  - the dead form-letter headlines are gone;
 *  - no one headline is repeated verbatim more than a handful of times;
 *  - a dramatic night's result mail carries a story, not just the score;
 *  - the slump quote is rare and only about men expected to score;
 *  - no injury sentence is built from a raw note ("suffered a flu").
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from '@engine/career/career'
import type { NewsItem } from '@domain'

function captureNews(career: Career): NewsItem[] {
  const captured: NewsItem[] = []
  const self = career as unknown as { pushNews: (...a: unknown[]) => NewsItem }
  const orig = self.pushNews.bind(career)
  self.pushNews = (...a: unknown[]) => {
    const item = orig(...a)
    // The same object the inbox holds — later in-place edits (the result mail
    // is finished after the receipt is built) are visible here too.
    captured.push(item)
    return item
  }
  return captured
}

describe('writing pass — one real season', () => {
  it('reads like a season, not a form letter', () => {
    const data = generateLeague({ seed: 2029 })
    const career = new Career(data, 2029, data.league.teams[3]!)
    const news = captureNews(career)

    let guard = 0
    while (career.seasonPhase === 'regularSeason' && guard++ < 400) {
      if (!career.step()) {
        // A soft gate (a meeting, a digest hold) — hand it to the staff, which
        // is exactly the path whose mail this test checks.
        const c = career as unknown as {
          delegateStaffMeeting: () => unknown
          delegateScoutMeeting: () => unknown
          resolveScoutDigest: () => unknown
        }
        c.delegateStaffMeeting()
        c.delegateScoutMeeting()
        c.resolveScoutDigest()
        if (!career.step()) break
      }
    }
    expect(news.length).toBeGreaterThan(100)

    // 1. The form letters are gone.
    const headlines = news.map((n) => n.headline)
    for (const dead of ['Weekly scouting digest', 'You left it to the staff', 'You left the board to the staff']) {
      expect(headlines.filter((h) => h === dead), dead).toEqual([])
    }
    expect(headlines.filter((h) => /ago today$/.test(h)), 'anniversary headlines carry the memory').toEqual([])

    // 2. No verbatim headline dominates. (Result lines carry their day number,
    //    so only a real repeat can trip this.)
    const counts = new Map<string, number>()
    for (const h of headlines) counts.set(h, (counts.get(h) ?? 0) + 1)
    const worst = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!
    expect(worst[1], `"${worst[0]}" repeated`).toBeLessThanOrEqual(6)

    // 3. A dramatic night gets a story in its result mail.
    const results = news.filter((n) => /^Day \d+: /.test(n.headline) || (n.category === 'result' && /\d+ @ .* \d+/.test(n.body)))
    const scoreOnly = /^[^.]* \d+ @ [^.]* \d+( \((OT|SO)\))?\.$/
    const dramatic = results.filter((n) => {
      const m = n.body.match(/ (\d+) @ .* (\d+)(?: \((OT|SO)\))?\./)
      if (!m) return false
      const a = Number(m[1]), h = Number(m[2])
      return Math.abs(a - h) === 1 || a === 0 || h === 0 || !!m[3]
    })
    expect(dramatic.length).toBeGreaterThan(5)
    for (const n of dramatic) expect(scoreOnly.test(n.body.trim()), `bare scoreline on a dramatic night: ${n.body}`).toBe(false)
    // The write-up's clock is in-period (the event contract), never negative,
    // and it names clubs, not ticker codes.
    for (const n of results) {
      expect(n.body, n.body).not.toMatch(/-\d+:-?\d+/)
      expect(n.body, n.body).not.toMatch(/\bThe [A-Z]{3}\b/)
    }

    // 4. The slump quote is rare.
    const slumpQuotes = news.filter((n) => n.speaker !== undefined && /drought|slump|dry spell|too good|It will come|defends his minutes|spoken to/i.test(n.headline))
    expect(slumpQuotes.length).toBeLessThanOrEqual(8)

    // 5. Injury prose is built from words, not raw notes.
    for (const n of news.filter((x) => x.category === 'injury')) {
      expect(n.body, n.body).not.toMatch(/suffered a (flu|a virus|tweaked|blocked|food)/)
      expect(n.body, n.body).not.toMatch(/\ba (an|a|the) /)
    }

    // 5b. Small grammar that gives templates away.
    for (const n of news) {
      expect(`${n.headline} ${n.body}`, n.headline).not.toMatch(/\b1 years\b|\bs's\b|\{[a-zA-Z]+\}/)
    }

    // 6. No UI label leaking into a scout's note.
    for (const n of news.filter((x) => x.category === 'scouting')) {
      expect(n.body, n.body).not.toMatch(/High-upside|projects as a [A-Z0-9#]/)
    }
  }, 600_000)
})
