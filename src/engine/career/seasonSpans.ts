/**
 * The hockey year's MULTI-DAY windows — one source of truth.
 *
 * The owner: "Every day of dev camp or training camp should be blocked out.
 * Same with anything else if it happens every day for 2 weeks." Before this,
 * the calendar knew only single key dates ("Training Camp Opens"), while the
 * stage machine stamped its beats from literals scattered through career.ts
 * (dev camp `21 + day`, camp `14 + day`, free agency `07-0N`…). Both now read
 * this module: the fiction clock asks it what date a beat falls on, and the
 * calendar asks it which windows cover a day.
 *
 * Pure: no career state. "Season year" Y is the year the season OPENS in
 * (October Y → April Y+1); its summer is June–September of Y.
 */
import { dayToDateISO } from './views'
import type { CalendarSpan } from './views'

/* ───────────────────────── the summer clock ───────────────────────── */

/** Development camp: three beats on three days (arrival, scrimmage, wrap). */
export const DEV_CAMP = { month: 6, firstDay: 22, days: 3 } as const
/** The June re-signing window: day 0 is the 27th, the QO deadline the 30th. */
export const RESIGN_WINDOW = { month: 6, firstDay: 27, lastDay: 30 } as const
/** Free agency: July 1 (morning = market day 0, noon = the frenzy) … day 8. */
export const FREE_AGENCY = { month: 7, firstDay: 1, days: 8 } as const
/** Arbitration: filings on July 1, the hearing on market day 6. */
export const ARBITRATION = { month: 7, filingDay: 1, hearingDay: 6 } as const
/** Training camp: Sep 15 (camp day 1) … Sep 22 (camp day 8 = cut day). */
export const TRAINING_CAMP = { month: 9, firstDay: 15, days: 8 } as const
/** The preseason board meeting: the morning after cut day. */
export const BOARD_MEETING = { month: 9, day: 23 } as const
/** The two preseason games, by camp day (see advanceBattleCamp). */
export const PRESEASON_GAME_CAMP_DAYS = [5, 7] as const
/** The NHL holiday roster freeze: Dec 19 – Dec 27. */
export const HOLIDAY_FREEZE = { month: 12, firstDay: 19, lastDay: 27 } as const
/** The World Juniors run Dec 26 – Jan 5. */
export const WORLD_JUNIORS_DAYS = 11

const pad = (n: number): string => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`
const addDays = (isoDate: string, n: number): string => {
  const d = new Date(isoDate + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Dev camp beat 1..3 → its date. */
export function devCampDateISO(year: number, beat: number): string {
  const b = Math.min(DEV_CAMP.days, Math.max(1, beat))
  return iso(year, DEV_CAMP.month, DEV_CAMP.firstDay + b - 1)
}
/** Re-signing window day 0..4 → its date (day 4 rolls into July 1). */
export function resignDateISO(year: number, resignDay: number): string {
  const d = RESIGN_WINDOW.firstDay + resignDay
  return d > RESIGN_WINDOW.lastDay ? iso(year, FREE_AGENCY.month, FREE_AGENCY.firstDay) : iso(year, RESIGN_WINDOW.month, d)
}
/** Free-agency market day → its date (day 0 and day 1 are both July 1). */
export function faDateISO(year: number, faDay: number): string {
  return iso(year, FREE_AGENCY.month, Math.min(31, Math.max(FREE_AGENCY.firstDay, faDay)))
}
/** Training-camp day 1..8 → its date. */
export function campDateISO(year: number, campDay: number): string {
  return iso(year, TRAINING_CAMP.month, TRAINING_CAMP.firstDay + Math.min(TRAINING_CAMP.days, Math.max(1, campDay)) - 1)
}
export function boardMeetingDateISO(year: number): string {
  return iso(year, BOARD_MEETING.month, BOARD_MEETING.day)
}
/** Is this date inside the holiday roster freeze? */
export function inHolidayFreeze(dateISO: string): boolean {
  const [, m, d] = dateISO.split('-').map(Number) as [number, number, number]
  return m === HOLIDAY_FREEZE.month && d >= HOLIDAY_FREEZE.firstDay && d <= HOLIDAY_FREEZE.lastDay
}

/** The All-Star break: ~55% of the way through the regular season (early
 *  February on a real schedule). The calendar marks it and the season's act
 *  structure holds its midseason report there — one day, one source. */
export function allStarBreakDay(firstMatchDay: number, lastMatchDay: number): number {
  return firstMatchDay + Math.round((lastMatchDay - firstMatchDay) * 0.55)
}

/* ───────────────────────── the windows ───────────────────────── */

export interface SeasonSpanArgs {
  /** The year the season opens in (its summer is June–September of it). */
  seasonYear: number
  /** Regular-season match days of THIS season's schedule (day indices). */
  matchDays: number[]
  /** A world is loaded (World Juniors / senior events are played). */
  hasWorld: boolean
  /** The Olympic / Nations Cup winter, when this season has one. */
  seniorEvent?: { label: string; startDay: number; days: number } | null
  /** Day index of the World Juniors' opening (Dec 26). */
  wjcDay?: number
  /** Opponents of the two preseason games, when known. */
  preseasonOpponents?: string[]
}

/**
 * Every multi-day window of one hockey year, from its summer to its trade
 * freeze. Each span is a real window the game runs; the calendar paints it on
 * every day it covers.
 */
export function seasonSpans(a: SeasonSpanArgs): CalendarSpan[] {
  const y = a.seasonYear
  const out: CalendarSpan[] = []
  out.push({ id: `devcamp-${y}`, kind: 'camp', label: 'Development camp', startISO: devCampDateISO(y, 1), endISO: devCampDateISO(y, DEV_CAMP.days) })
  out.push({ id: `resign-${y}`, kind: 'window', label: 'Re-signing window', startISO: iso(y, RESIGN_WINDOW.month, RESIGN_WINDOW.firstDay), endISO: iso(y, RESIGN_WINDOW.month, RESIGN_WINDOW.lastDay) })
  out.push({ id: `fa-${y}`, kind: 'market', label: 'Free agency', startISO: faDateISO(y, FREE_AGENCY.firstDay), endISO: faDateISO(y, FREE_AGENCY.days) })
  out.push({ id: `arb-${y}`, kind: 'window', label: 'Arbitration', startISO: iso(y, ARBITRATION.month, ARBITRATION.filingDay), endISO: iso(y, ARBITRATION.month, ARBITRATION.hearingDay) })
  out.push({ id: `camp-${y}`, kind: 'camp', label: 'Training camp', startISO: campDateISO(y, 1), endISO: campDateISO(y, TRAINING_CAMP.days) })
  const pre = PRESEASON_GAME_CAMP_DAYS.map((d) => campDateISO(y, d))
  out.push({
    id: `preseason-${y}`, kind: 'preseason',
    label: a.preseasonOpponents && a.preseasonOpponents.length > 0 ? `Preseason (${a.preseasonOpponents.join(', ')})` : 'Preseason games',
    startISO: pre[0]!, endISO: pre[pre.length - 1]!,
  })
  out.push({ id: `holiday-${y}`, kind: 'freeze', label: 'Holiday roster freeze', startISO: iso(y, HOLIDAY_FREEZE.month, HOLIDAY_FREEZE.firstDay), endISO: iso(y, HOLIDAY_FREEZE.month, HOLIDAY_FREEZE.lastDay) })
  if (a.hasWorld) {
    const wjStart = a.wjcDay !== undefined ? dayToDateISO(y, a.wjcDay) : iso(y, 12, 26)
    out.push({ id: `wjc-${y}`, kind: 'international', label: 'World Juniors', startISO: wjStart, endISO: addDays(wjStart, WORLD_JUNIORS_DAYS - 1) })
    if (a.seniorEvent) {
      const s = dayToDateISO(y, a.seniorEvent.startDay)
      out.push({ id: `senior-${y}`, kind: 'international', label: `${a.seniorEvent.label} break`, startISO: s, endISO: addDays(s, a.seniorEvent.days - 1) })
    }
  }
  const days = [...a.matchDays].sort((p, q) => p - q)
  if (days.length > 0) {
    const last = days[days.length - 1]!
    const deadline = Math.floor(last * 0.75)
    if (deadline > 0 && deadline < last) {
      out.push({ id: `tradefreeze-${y}`, kind: 'freeze', label: 'Trade freeze (deadline passed)', startISO: dayToDateISO(y, deadline + 1), endISO: dayToDateISO(y, last) })
    }
  }
  return out
}

/** The spans covering one date, in a stable display order. */
export function spansOn(spans: CalendarSpan[], dateISO: string): CalendarSpan[] {
  return spans.filter((s) => s.startISO <= dateISO && dateISO <= s.endISO)
}
