/**
 * Season Wrapped through a real Career: a full season is played, the draft
 * closes the league year, and the Wrapped that comes out is built from the
 * settled result — the champion straight from the bracket. Also: the spring
 * champion press piece is only written about the user's club when the user
 * actually won, and the yearbook survives a save/load (and old saves load).
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { NewsItem } from '@domain'
import { Career } from '@engine/career/career'

function playToDraftClose(career: Career): void {
  let guard = 0
  const startYear = career.year
  while (guard++ < 400) {
    if (career.getWrappedPending()) return
    if (career.draftPending()) { career.autoDraft(); continue }
    if (career.year !== startYear) return
    if (!career.step()) break
  }
}

describe('Season Wrapped — a real season', () => {
  const data = generateLeague({ seed: 5150 })
  const userId = data.league.teams[5]!
  const career = new Career(data, 5150, userId)
  playToDraftClose(career)
  const internals = career as unknown as {
    playoffs: { championTeamId: string | null } | null
    news: NewsItem[]
  }

  it('fires once, at the close of the draft, with the bracket champion', () => {
    const w = career.getWrappedPending()
    expect(w).not.toBeNull()
    expect(w!.year).toBe(career.year)
    const champId = internals.playoffs?.championTeamId ?? null
    expect(champId).not.toBeNull()
    expect(w!.champion?.id).toBe(champId)
    if (champId !== (userId as string)) {
      expect(w!.cards.find((c) => c.kind === 'champion')?.team?.id).toBe(champId)
      expect(w!.tagline).not.toBe('Champions')
    }
    // Bookends + 1..14 real cards; the first overall pick is always a story.
    expect(w!.cards[0]!.kind).toBe('cover')
    expect(w!.cards[w!.cards.length - 1]!.kind).toBe('outro')
    expect(w!.cards.some((c) => c.kind === 'firstOverall')).toBe(true)
    expect(w!.cards.some((c) => c.kind === 'awards')).toBe(true)
  })

  it('the champion press piece is only about the user when the user won', () => {
    const champId = internals.playoffs?.championTeamId ?? null
    const pieces = internals.news.filter((n) => n.press?.kind === 'champion')
    if (champId === (userId as string)) expect(pieces.length).toBe(1)
    else expect(pieces).toEqual([])
    // And no press line anywhere claims the user's club won it when it didn't.
    if (champId !== (userId as string)) {
      const userName = career.getDashboard().userTeam.name
      const lies = internals.news.filter((n) => n.press && new RegExp(`${userName} are champions`).test(`${n.headline} ${n.body}`))
      expect(lies.map((n) => n.headline)).toEqual([])
    }
  })

  it('is seen once, then lives in the yearbook', () => {
    const y = career.getWrappedPending()!.year
    career.markWrappedSeen(y)
    expect(career.getWrappedPending()).toBeNull()
    const book = career.getWrappedYearbook()
    expect(book.years.map((r) => r.year)).toEqual([y])
    expect(career.getWrappedYear(y)?.cards.length).toBeGreaterThan(2)
  })

  it('survives a save/load round-trip, and an older save loads with an empty yearbook', () => {
    const snap = career.exportSnapshot('wrapped-test', '2027-01-01T00:00:00Z')
    const back = Career.fromSnapshot(snap)
    expect(back.getWrappedYearbook().years.length).toBe(1)
    const old = structuredClone(snap)
    delete (old as { wrapped?: unknown }).wrapped
    const legacy = Career.fromSnapshot(old)
    expect(legacy.getWrappedYearbook().years).toEqual([])
    expect(legacy.getWrappedPending()).toBeNull()
  })
})
