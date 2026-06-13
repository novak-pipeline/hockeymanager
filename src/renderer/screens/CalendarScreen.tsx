import { useState, useMemo } from 'react'
import type { CalendarEntry, CalendarView } from '../../worker/protocol'
import { crestColor } from '../components/format'
import { Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

/**
 * FM-style calendar month grid.
 * - Displays the user's season in a Mon–Sun weekly grid.
 * - Game cells show opponent, H/A tag, and result chip (W/OTL/L).
 * - Key-date chips (deadline, playoffs, season milestones) sit below games.
 * - Month back/forward nav; default landing = month of next unplayed game
 *   (or last game played if season complete).
 */
export function CalendarScreen(): JSX.Element {
  const client = useClient()
  const { data, loading, error } = useScreenData<CalendarView>(
    () => client.getCalendar(),
    (r) => (r.type === 'calendar' ? r.calendar : null)
  )

  return (
    <section className="stack">
      <ScreenHeader title="Calendar" />
      <ScreenStateNotices
        loading={loading && !data}
        error={error}
        empty={!loading && !error && !data}
        emptyText="No calendar yet."
      />
      {data && <CalendarBody calendar={data} />}
    </section>
  )
}

/* ── internal ────────────────────────────────────────────────── */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Mon = 0 … Sun = 6 column headers. */
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** '2026-10-12' → 0-based month index for the grid. */
function monthOf(iso: string): string { return iso.slice(0, 7) }

/** Parse '2026-10-12' into UTC Date. */
function isoToUTCDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1))
}

/** Mon-anchored day-of-week index: Mon=0, Tue=1…Sun=6. */
function monDow(date: Date): number {
  return (date.getUTCDay() + 6) % 7
}

/** List of distinct 'YYYY-MM' keys derived from entries, in order. */
function monthKeys(entries: CalendarEntry[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of entries) {
    const k = monthOf(e.dateISO)
    if (!seen.has(k)) { seen.add(k); out.push(k) }
  }
  return out
}

/** Given a 'YYYY-MM' key return the first Monday on or before the 1st. */
function firstCellDate(monthKey: string): Date {
  const [y, m] = monthKey.split('-').map(Number)
  const first = new Date(Date.UTC(y!, (m ?? 1) - 1, 1))
  const dow = monDow(first) // 0=Mon
  first.setUTCDate(first.getUTCDate() - dow)
  return first
}

/** Pad a number to 2 digits: 4 → '04'. */
function pad2(n: number): string { return String(n).padStart(2, '0') }

function dateToISO(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

function monthLabel(key: string): string {
  const [year, mon] = key.split('-')
  const idx = Number(mon) - 1
  return `${MONTH_NAMES[idx] ?? key} ${year}`
}

/* ── result chip ── */

interface ResultChipProps { entry: Extract<CalendarEntry, { kind: 'game' }> }

function ResultChip({ entry }: ResultChipProps): JSX.Element | null {
  const r = entry.result
  if (!r) return null
  let label: string
  let cls: string
  if (r.won) {
    label = r.decidedBy === 'overtime' ? 'W·OT' : r.decidedBy === 'shootout' ? 'W·SO' : 'W'
    cls = 'chip chip-success'
  } else if (r.decidedBy !== 'regulation') {
    label = 'OTL'
    cls = 'chip chip-warn'
  } else {
    label = 'L'
    cls = 'chip chip-danger'
  }
  const score = `${r.homeGoals}–${r.awayGoals}`
  return (
    <span className={cls} style={{ fontSize: 9, padding: '1px 4px', marginTop: 2 }}>
      {label} {score}
    </span>
  )
}

/* ── calendar body ── */

function CalendarBody({ calendar }: { calendar: CalendarView }): JSX.Element {
  const months = monthKeys(calendar.entries)

  // Default month: next unplayed game's month, else last game's month.
  const defaultMonth = useMemo((): string => {
    const nextEntry = calendar.entries.find(
      (e): e is Extract<CalendarEntry, { kind: 'game' }> => e.kind === 'game' && e.isNext
    )
    if (nextEntry) return monthOf(nextEntry.dateISO)
    const last = [...calendar.entries].reverse().find((e) => e.kind === 'game')
    if (last) return monthOf(last.dateISO)
    return months[0] ?? monthOf(new Date().toISOString())
  }, [calendar.entries, months])

  const [currentMonthKey, setCurrentMonthKey] = useState(defaultMonth)
  const currentIndex = months.indexOf(currentMonthKey)

  const canPrev = currentIndex > 0
  const canNext = currentIndex < months.length - 1

  // Index entries by dateISO for O(1) lookup.
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>()
    for (const e of calendar.entries) {
      const list = map.get(e.dateISO) ?? []
      list.push(e)
      map.set(e.dateISO, list)
    }
    return map
  }, [calendar.entries])

  // Build the grid of weeks for the current month.
  const weeks = useMemo((): string[][] => {
    const firstCell = firstCellDate(currentMonthKey)
    const [y, m] = currentMonthKey.split('-').map(Number)
    const lastDayOfMonth = new Date(Date.UTC(y!, (m ?? 1), 0)).getUTCDate()
    // We need enough rows to cover the month.
    const totalCells = 42 // 6 rows × 7 cols (safe for any month)
    const rows: string[][] = []
    let row: string[] = []
    for (let i = 0; i < totalCells; i++) {
      const d = new Date(firstCell)
      d.setUTCDate(firstCell.getUTCDate() + i)
      row.push(dateToISO(d))
      if (row.length === 7) {
        rows.push(row)
        row = []
        // Stop after we've passed the end of the month.
        if (d.getUTCDate() >= lastDayOfMonth && d.getUTCMonth() === (m ?? 1) - 1) break
      }
    }
    if (row.length > 0) {
      // Pad the last row to 7.
      while (row.length < 7) row.push('')
      rows.push(row)
    }
    return rows
  }, [currentMonthKey])

  const [y, mo] = currentMonthKey.split('-').map(Number)
  const monthNum = (mo ?? 1) - 1

  return (
    <div className="stack">
      {/* Month nav */}
      <div className="row" style={{ alignItems: 'center', gap: 'var(--sp-3)' }}>
        <button
          className="btn"
          onClick={() => setCurrentMonthKey(months[currentIndex - 1]!)}
          disabled={!canPrev}
          style={{ minWidth: 36 }}
        >
          ‹
        </button>
        <span style={{ fontWeight: 600, fontSize: 16, color: 'var(--text)', minWidth: 180, textAlign: 'center' }}>
          {monthLabel(currentMonthKey)}
        </span>
        <button
          className="btn"
          onClick={() => setCurrentMonthKey(months[currentIndex + 1]!)}
          disabled={!canNext}
          style={{ minWidth: 36 }}
        >
          ›
        </button>
        <span className="muted small" style={{ marginLeft: 'var(--sp-2)' }}>
          {calendar.year} season
        </span>
      </div>

      {/* Legend */}
      <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <span className="chip chip-success" style={{ fontSize: 10 }}>W = win</span>
        <span className="chip chip-warn"    style={{ fontSize: 10 }}>OTL = overtime loss</span>
        <span className="chip chip-danger"  style={{ fontSize: 10 }}>L = regulation loss</span>
        <span className="chip chip-violet"  style={{ fontSize: 10 }}>Key date</span>
      </div>

      {/* Grid */}
      <Panel title="">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                {DAY_LABELS.map((d) => (
                  <th
                    key={d}
                    style={{
                      padding: '4px 6px',
                      fontSize: 11,
                      color: 'var(--muted)',
                      fontWeight: 600,
                      textAlign: 'center',
                      borderBottom: '1px solid var(--line)',
                      width: '14.28%',
                    }}
                  >
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week, wi) => (
                <tr key={wi}>
                  {week.map((isoDate, di) => {
                    if (!isoDate) {
                      return <td key={di} style={cellStyle(false, false)} />
                    }
                    const cellDate = isoToUTCDate(isoDate)
                    const inMonth =
                      cellDate.getUTCFullYear() === y && cellDate.getUTCMonth() === monthNum
                    const cellEntries = byDate.get(isoDate) ?? []
                    const dayNum = cellDate.getUTCDate()
                    return (
                      <td key={di} style={cellStyle(inMonth, cellEntries.length > 0)}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {/* Day number */}
                          <span
                            style={{
                              fontSize: 11,
                              color: inMonth ? 'var(--muted)' : 'rgba(255,255,255,0.15)',
                              fontVariantNumeric: 'tabular-nums',
                              alignSelf: 'flex-end',
                              lineHeight: 1,
                            }}
                          >
                            {dayNum}
                          </span>

                          {/* Entries */}
                          {inMonth && cellEntries.map((entry, ei) => (
                            <CalendarCell key={ei} entry={entry} />
                          ))}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function cellStyle(inMonth: boolean, hasEntries: boolean): React.CSSProperties {
  return {
    verticalAlign: 'top',
    padding: '4px 5px',
    minHeight: 80,
    height: 88,
    border: '1px solid var(--line)',
    background: inMonth
      ? hasEntries ? 'rgba(139,92,246,0.04)' : 'var(--bg1)'
      : 'var(--bg0)',
  }
}

function CalendarCell({ entry }: { entry: CalendarEntry }): JSX.Element {
  if (entry.kind === 'keydate') {
    return (
      <span
        className="chip chip-violet"
        style={{ fontSize: 9, padding: '1px 4px', width: '100%', boxSizing: 'border-box' }}
      >
        {entry.label}
      </span>
    )
  }

  // game entry
  const isNext = entry.isNext
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        padding: '2px 3px',
        borderRadius: 3,
        background: isNext ? 'rgba(139,92,246,0.18)' : 'transparent',
        border: isNext ? '1px solid rgba(139,92,246,0.5)' : '1px solid transparent',
        boxSizing: 'border-box',
      }}
    >
      {/* H/A + opponent row */}
      <div className="row" style={{ gap: 3, alignItems: 'center', flexWrap: 'nowrap' }}>
        <span
          className={entry.home ? 'chip chip-accent' : 'chip'}
          style={{ fontSize: 8, padding: '0px 3px', flexShrink: 0 }}
        >
          {entry.home ? 'H' : 'A'}
        </span>
        <span
          className="crest"
          style={{
            background: crestColor(entry.opponentAbbr),
            width: 14,
            height: 14,
            fontSize: 6,
            border: 'none',
            flexShrink: 0,
          }}
        >
          {entry.opponentAbbr.slice(0, 2)}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: isNext ? 'var(--violet-h)' : 'var(--text)',
          }}
          title={entry.opponentName}
        >
          {entry.opponentAbbr}
        </span>
      </div>
      {/* Result chip or "Next" badge */}
      {entry.result ? (
        <ResultChip entry={entry} />
      ) : isNext ? (
        <span className="chip chip-warn" style={{ fontSize: 8, padding: '1px 3px' }}>Next</span>
      ) : null}
    </div>
  )
}
