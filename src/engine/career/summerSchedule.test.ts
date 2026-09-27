import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from './career'

/**
 * Owner bug: "I can't see the schedule when I click continue — it's just an
 * empty calendar when it loads." Root cause: every summer view (the Continue
 * overlay's month grid, the Calendar and Schedule screens, the dashboard's
 * week ahead) read the FINISHED season's schedule — dated a year behind the
 * summer clock, and on a summer takeover never even played — because the
 * coming season's schedule was only built at the rollover in mid-September.
 */
describe('the summer shows the coming season', () => {
  it('from the takeover summer on, the calendar and schedule carry next season\'s fixtures', () => {
    const data = generateLeague({ seed: 515 })
    const c = new Career(data, 515, data.league.teams[0])
    c.startAtOffseason()
    const cal = c.getCalendarView()
    const today = cal.todayISO!
    const games = cal.entries.filter((e) => e.kind === 'game')
    expect(games.length).toBeGreaterThan(40)
    // Every fixture is AHEAD of the summer, none from the season gone by.
    for (const g of games) expect(g.dateISO > today).toBe(true)
    expect(games.every((g) => g.kind === 'game' && g.result === null)).toBe(true)
    expect(games.filter((g) => g.kind === 'game' && g.isNext)).toHaveLength(1)
    // The deadline mark belongs to the coming season too.
    const deadline = cal.entries.find((e) => e.kind === 'keydate' && e.label === 'Trade Deadline')
    expect(deadline && deadline.dateISO > today).toBe(true)
    // The schedule screen agrees.
    const sch = c.getSchedule() as unknown as { entries: Array<{ dateISO?: string; date?: string }> }
    expect(sch.entries.length).toBe(games.length)
  })

  it('what July shows is exactly what opens in October', () => {
    const data = generateLeague({ seed: 616 })
    const c = new Career(data, 616, data.league.teams[2])
    c.startAtOffseason()
    const preview = c.getCalendarView().entries
      .filter((e) => e.kind === 'game')
      .map((e) => (e.kind === 'game' ? `${e.gameId}@${e.dateISO}` : ''))
    for (let i = 0; i < 40 && c.getDashboard().phase === 'offseason'; i++) c.advanceOffseason()
    expect(c.getDashboard().phase).toBe('regularSeason')
    const live = c.getCalendarView().entries
      .filter((e) => e.kind === 'game')
      .map((e) => (e.kind === 'game' ? `${e.gameId}@${e.dateISO}` : ''))
    expect(live).toEqual(preview)
  }, 60_000)
})
