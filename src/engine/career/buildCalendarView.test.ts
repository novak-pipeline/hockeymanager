import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from './career'
import { dayToDateISO } from './views'

describe('buildCalendarView', () => {
  it('returns a calendar with game entries for every user fixture', () => {
    const data = generateLeague({ seed: 42 })
    const userId = data.league.teams[0]!
    const career = new Career(data, 42, userId)

    const cal = career.getCalendarView()

    expect(cal.year).toBe(career.getDashboard().year)

    // Count user fixtures in the raw schedule.
    const userFixtures = data.league.schedule.filter(
      (g) => g.homeTeamId === userId || g.awayTeamId === userId
    )
    const gameEntries = cal.entries.filter((e) => e.kind === 'game')
    expect(gameEntries.length).toBe(userFixtures.length)
  })

  it('places games on the correct dateISO derived from dayToDateISO', () => {
    const data = generateLeague({ seed: 7 })
    const userId = data.league.teams[1]!
    const career = new Career(data, 7, userId)

    const cal = career.getCalendarView()
    const year = cal.year

    // Pick the first game entry and verify its dateISO matches dayToDateISO.
    const firstGame = cal.entries.find((e) => e.kind === 'game')
    expect(firstGame).toBeDefined()
    if (firstGame && firstGame.kind === 'game') {
      const expected = dayToDateISO(year, firstGame.day)
      expect(firstGame.dateISO).toBe(expected)
    }
  })

  it('marks exactly one game as isNext at season start', () => {
    const data = generateLeague({ seed: 13 })
    const userId = data.league.teams[2]!
    const career = new Career(data, 13, userId)

    const cal = career.getCalendarView()
    const nextGames = cal.entries.filter((e) => e.kind === 'game' && e.isNext)
    expect(nextGames.length).toBe(1)
  })

  it('includes key-date entries for season boundaries and trade deadline', () => {
    const data = generateLeague({ seed: 99 })
    const userId = data.league.teams[0]!
    const career = new Career(data, 99, userId)

    const cal = career.getCalendarView()
    const keyLabels = cal.entries
      .filter((e) => e.kind === 'keydate')
      .map((e) => (e.kind === 'keydate' ? e.label : ''))

    expect(keyLabels).toContain('Season Begins')
    expect(keyLabels).toContain('Trade Deadline')
    expect(keyLabels).toContain('Regular Season Ends')
  })

  it('entries are sorted chronologically', () => {
    const data = generateLeague({ seed: 55 })
    const userId = data.league.teams[0]!
    const career = new Career(data, 55, userId)

    const cal = career.getCalendarView()
    for (let i = 1; i < cal.entries.length; i++) {
      expect(cal.entries[i]!.dateISO >= cal.entries[i - 1]!.dateISO).toBe(true)
    }
  })

  it('played games have a result with the correct winner flag', () => {
    const data = generateLeague({ seed: 22 })
    const userId = data.league.teams[3]!
    const career = new Career(data, 22, userId)

    // Advance several match days so some results exist.
    for (let i = 0; i < 5; i++) career.advanceDay()

    const cal = career.getCalendarView()
    const played = cal.entries.filter(
      (e): e is Extract<typeof e, { kind: 'game' }> => e.kind === 'game' && e.result !== null
    )
    expect(played.length).toBeGreaterThan(0)

    for (const entry of played) {
      const r = entry.result!
      // won must correctly reflect home/away perspective.
      const userIsHome = entry.home
      const userGoals = userIsHome ? r.homeGoals : r.awayGoals
      const oppGoals  = userIsHome ? r.awayGoals : r.homeGoals
      expect(r.won).toBe(userGoals > oppGoals)
    }
  })
})
