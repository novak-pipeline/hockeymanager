/**
 * Presentation helpers for the calendar's multi-day windows (CalendarView.spans,
 * built by engine/career/seasonSpans — the same source the stage machine reads).
 * The Calendar screen, the Continue overlay's month grid and the dashboard's
 * week ahead all paint spans with these, so a window looks the same everywhere.
 */
import type { CalendarSpan } from '../../engine/career/views'

/** Colour per kind of window (rgb triplet, for rgba() washes). */
export const SPAN_RGB: Record<CalendarSpan['kind'], string> = {
  camp: '56,189,248',          // camps: cyan
  preseason: '96,165,250',     // preseason games: blue
  market: '74,222,128',        // the July market: green
  window: '214,160,86',        // contract windows (re-sign, arbitration): amber
  freeze: '148,163,184',       // roster / trade freezes: slate
  international: '244,114,182', // international breaks: pink
}

/** The spans that cover one date, longest-running first so bars stack stably. */
export function spansCovering(spans: readonly CalendarSpan[] | undefined, dateISO: string): CalendarSpan[] {
  return (spans ?? [])
    .filter((s) => s.startISO <= dateISO && dateISO <= s.endISO)
    .sort((a, b) => a.startISO.localeCompare(b.startISO) || b.endISO.localeCompare(a.endISO) || a.id.localeCompare(b.id))
}

function dayIndex(iso: string): number {
  return Math.round(Date.parse(iso + 'T00:00:00Z') / 86_400_000)
}

/** "3/8": which day of the window this date is. */
export function spanDayOf(span: CalendarSpan, dateISO: string): { n: number; of: number } {
  return { n: dayIndex(dateISO) - dayIndex(span.startISO) + 1, of: dayIndex(span.endISO) - dayIndex(span.startISO) + 1 }
}

/** Every 'YYYY-MM' a span touches (so the calendar can page to it). */
export function spanMonths(spans: readonly CalendarSpan[] | undefined): string[] {
  const out = new Set<string>()
  for (const s of spans ?? []) {
    let [y, m] = s.startISO.slice(0, 7).split('-').map(Number) as [number, number]
    const [ey, em] = s.endISO.slice(0, 7).split('-').map(Number) as [number, number]
    for (let guard = 0; guard < 24 && (y < ey || (y === ey && m <= em)); guard++) {
      out.add(`${y}-${String(m).padStart(2, '0')}`)
      m++
      if (m > 12) { m = 1; y++ }
    }
  }
  return [...out]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Jul 1–8" / "Dec 26 – Jan 5". */
export function spanRange(span: CalendarSpan): string {
  const [, sm, sd] = span.startISO.split('-').map(Number) as [number, number, number]
  const [, em, ed] = span.endISO.split('-').map(Number) as [number, number, number]
  return sm === em ? `${MONTHS[sm - 1]} ${sd}–${ed}` : `${MONTHS[sm - 1]} ${sd} – ${MONTHS[em - 1]} ${ed}`
}
