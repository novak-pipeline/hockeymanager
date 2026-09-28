import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from './career'
import { seasonSpans, spansOn } from './seasonSpans'
import type { CalendarSpan } from './views'

const covering = (spans: CalendarSpan[] | undefined, iso: string, id: string): boolean =>
  spansOn(spans ?? [], iso).some((s) => s.id.startsWith(id))

describe('multi-day windows — one source for the calendar and the clock', () => {
  it('the year\'s windows, each a real multi-day span', () => {
    const spans = seasonSpans({ seasonYear: 2026, matchDays: [1, 50, 100, 180], hasWorld: true, wjcDay: 87, seniorEvent: { label: 'Olympic', startDay: 131, days: 17 }, preseasonOpponents: ['BOS', 'MTL'] })
    const by = (p: string): CalendarSpan => spans.find((s) => s.id.startsWith(p))!
    expect(by('devcamp')).toMatchObject({ startISO: '2026-06-22', endISO: '2026-06-24' })
    expect(by('fa')).toMatchObject({ startISO: '2026-07-01', endISO: '2026-07-08' })
    expect(by('arb')).toMatchObject({ startISO: '2026-07-01', endISO: '2026-07-06' })
    expect(by('camp')).toMatchObject({ startISO: '2026-09-15', endISO: '2026-09-22' })
    expect(by('preseason').label).toBe('Preseason (BOS, MTL)')
    expect(by('holiday')).toMatchObject({ startISO: '2026-12-19', endISO: '2026-12-27' })
    expect(by('wjc')).toMatchObject({ startISO: '2026-12-26', endISO: '2027-01-05' })
    expect(by('senior').label).toBe('Olympic break')
    expect(by('tradefreeze').startISO > '2027-01-01').toBe(true)
    // No world → no international windows.
    expect(seasonSpans({ seasonYear: 2026, matchDays: [], hasWorld: false }).some((s) => s.kind === 'international')).toBe(false)
  })

  it('every beat the clock stamps falls inside the window the calendar paints for it', () => {
    const data = generateLeague({ seed: 515 })
    const c = new Career(data, 515, data.league.teams[0])
    c.startAtOffseason()
    const seen = new Set<string>()
    for (let i = 0; i < 60; i++) {
      const d = c.getDashboard()
      const cal = c.getCalendarView()
      if (d.devCampPending) { expect(covering(cal.spans, d.date, 'devcamp')).toBe(true); seen.add('devcamp') }
      if (c.getOffseason()?.stage === 'freeAgency') { expect(covering(cal.spans, d.date, 'fa')).toBe(true); seen.add('fa') }
      if (d.campPending) { expect(covering(cal.spans, d.date, 'camp')).toBe(true); seen.add('camp') }
      if (d.phase === 'regularSeason' && !d.campPending && d.day > 0) break
      c.step()
      if (c.getDashboard().captainsPending) c.nameCaptainByCoach()
    }
    expect([...seen].sort()).toEqual(['camp', 'devcamp', 'fa'])
  }, 60_000)

  it('the calendar paints the windows on every day, summer and season', () => {
    const data = generateLeague({ seed: 616 })
    const c = new Career(data, 616, data.league.teams[1])
    c.startAtOffseason()
    const cal = c.getCalendarView()
    const y = Number(cal.todayISO!.slice(0, 4))
    for (const d of ['22', '23', '24']) expect(covering(cal.spans, `${y}-06-${d}`, 'devcamp')).toBe(true)
    for (let d = 15; d <= 22; d++) expect(covering(cal.spans, `${y}-09-${d}`, 'camp')).toBe(true)
    expect(covering(cal.spans, `${y}-09-23`, 'camp')).toBe(false)
    expect(covering(cal.spans, `${y}-12-20`, 'holiday')).toBe(true)
    expect(cal.spans!.some((s) => s.id.startsWith('tradefreeze'))).toBe(true)
  })
})
