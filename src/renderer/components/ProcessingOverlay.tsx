/**
 * FM-style "Processing" overlay — pops up WHILE the sim advances to the next
 * stoppage instead of dumping the GM onto the calendar screen. It shows the day
 * being processed with a spinner, the next match, the messages that streamed in
 * on the advance, a trending headline, and a compact month calendar. The GM
 * presses Continue to roll on (streaming the next day's mail) or closes to
 * return to the screen they came from.
 *
 * Pure renderer: everything here is derived from existing views
 * (getDashboard / getInbox / getCalendar) — no engine or contract change.
 */
import { useEffect } from 'react'
import type { NewsItem } from '@domain/news'
import type { CalendarView, NextGameView } from '@engine/career/views'
import { Icon } from './primitives'
import { CategoryIcon, Icons } from './icons'

export interface ProcessingData {
  phase: 'running' | 'done'
  /** ISO of the (new) current in-world day. */
  dateISO?: string
  nextGame: NextGameView | null
  /** Messages that arrived on this advance. */
  incoming: NewsItem[]
  /** The one story to feature. */
  trending?: NewsItem | null
  calendar?: CalendarView | null
  teamInfo?: Record<string, { abbreviation: string; primaryColor: number }>
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat', 'Sun']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

/** "2035-01-12" → "Fri Jan 12th". Returns '' for a missing/bad ISO. */
function longDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]
  const mo = MONTHS[d.getMonth()].slice(0, 3)
  return `${wd} ${mo} ${ordinal(d.getDate())}`
}

/** Build a Monday-first month grid for the month containing `iso`. */
function monthMatrix(iso: string): { label: string; weeks: Array<Array<{ day: number; iso: string } | null>> } {
  const ref = new Date(`${iso}T00:00:00`)
  const year = ref.getFullYear()
  const month = ref.getMonth()
  const first = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  // JS getDay: 0=Sun..6=Sat → Monday-first offset.
  const lead = (first.getDay() + 6) % 7
  const cells: Array<{ day: number; iso: string } | null> = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const mm = String(month + 1).padStart(2, '0')
    const dd = String(d).padStart(2, '0')
    cells.push({ day: d, iso: `${year}-${mm}-${dd}` })
  }
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: Array<Array<{ day: number; iso: string } | null>> = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return { label: `${MONTHS[month]} ${year}`, weeks }
}

export function ProcessingOverlay({
  data,
  onContinue,
  onClose,
  onOpenMessage,
  busy,
}: {
  data: ProcessingData
  onContinue: () => void
  onClose: () => void
  onOpenMessage: (item: NewsItem) => void
  busy: boolean
}): JSX.Element {
  const running = data.phase === 'running' || busy
  const ng = data.nextGame
  const trending = data.trending

  // FM-style keyboard flow: Enter rolls to the next day, Esc drops back to your
  // screen — but only once the day has finished processing (never mid-tick).
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (running) return
      if (e.key === 'Enter') { e.preventDefault(); onContinue() }
      else if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running, onContinue, onClose])

  // Index calendar entries by date for the mini month grid.
  const byDate = new Map<string, { games: number; keydates: number; won?: boolean | null }>()
  for (const e of data.calendar?.entries ?? []) {
    const slot = byDate.get(e.dateISO) ?? { games: 0, keydates: 0 }
    if (e.kind === 'game') { slot.games++; if (e.result) slot.won = e.result.won }
    else slot.keydates++
    byDate.set(e.dateISO, slot)
  }
  const todayISO = data.dateISO ?? data.calendar?.todayISO
  const grid = todayISO ? monthMatrix(todayISO) : null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 8000,
        background: 'rgba(3,6,18,0.72)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--sp-4)',
      }}
      onClick={() => { if (!running) onClose() }}
    >
      <div
        className="panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(1000px, 94vw)', maxHeight: '88vh', overflow: 'hidden',
          display: 'grid', gridTemplateColumns: '340px 1fr', gap: 0,
          border: '1px solid var(--violet-border, rgba(124,92,231,0.4))',
          background: 'var(--bg1)', borderRadius: 'var(--radius-lg, 14px)',
          boxShadow: 'var(--shadow-2, 0 24px 60px rgba(0,0,0,0.5))',
        }}
      >
        {/* ── left: processing rail ── */}
        <div
          style={{
            background: 'linear-gradient(180deg, rgba(124,92,231,0.22), rgba(124,92,231,0.06))',
            borderRight: '1px solid var(--border, rgba(255,255,255,0.08))',
            padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)',
            minHeight: 420,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.3, lineHeight: 1.1 }}>
              {longDate(todayISO) || 'Processing'}
            </div>
            <span
              aria-hidden
              style={{
                width: 20, height: 20, borderRadius: '50%',
                border: '2px solid rgba(255,255,255,0.25)', borderTopColor: 'var(--violet-h, #b9a7ff)',
                animation: running ? 'ovspin 0.7s linear infinite' : 'none',
                opacity: running ? 1 : 0.25, flex: '0 0 auto', marginTop: 4,
              }}
            />
          </div>

          {ng && (
            <div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--muted)', fontWeight: 700, marginBottom: 6 }}>
                Next match
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
                <Icon size={16}><Icons.Result /></Icon>
                <span>{ng.opponentName} <span className="muted">({ng.home ? 'Home' : 'Away'})</span></span>
              </div>
              <div className="muted small" style={{ marginTop: 3 }}>
                {ng.opponentRecord} · {ng.opponentSystem}{ng.rivalryLabel ? ` · ${ng.rivalryLabel}` : ''}
              </div>
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--border, rgba(255,255,255,0.08))', paddingTop: 'var(--sp-3)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', minHeight: 0, flex: 1 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--muted)', fontWeight: 700 }}>
              Incoming messages
            </div>
            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 2 }}>
              {data.incoming.length === 0 ? (
                <div className="muted small" style={{ padding: '10px 0' }}>
                  {running ? 'Simulating…' : 'A quiet day — nothing new in the inbox.'}
                </div>
              ) : (
                data.incoming.slice(0, 12).map((m) => (
                  <button
                    key={m.id}
                    className="anim-in"
                    onClick={() => onOpenMessage(m)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', width: '100%',
                      background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border, rgba(255,255,255,0.07))',
                      borderRadius: 'var(--radius-sm, 8px)', padding: '7px 9px', cursor: 'pointer', color: 'inherit',
                    }}
                  >
                    <CategoryIcon category={m.category} size={14} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {m.headline}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── right: trending + calendar ── */}
        <div style={{ padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', overflowY: 'auto', position: 'relative' }}>
          <button
            className="btn btn-ghost"
            onClick={onClose}
            title="Close (return to your screen)"
            style={{ position: 'absolute', top: 10, right: 10, width: 30, height: 30, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, fontSize: 18, lineHeight: 1 }}
          >
            &times;
          </button>

          {trending ? (
            <div className="card" style={{ padding: 'var(--sp-4)' }}>
              <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--violet-h, #b9a7ff)', fontWeight: 800, marginBottom: 8 }}>
                Trending
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                <CategoryIcon category={trending.category} size={18} />
                <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.3, lineHeight: 1.15 }}>
                  {trending.headline}
                </div>
              </div>
              <div className="muted" style={{ fontSize: 13, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {trending.body}
              </div>
              {trending.press?.byline && (
                <div className="muted small" style={{ marginTop: 8, fontStyle: 'italic' }}>{trending.press.byline}</div>
              )}
            </div>
          ) : (
            <div className="card" style={{ padding: 'var(--sp-4)' }}>
              <div className="muted" style={{ fontSize: 13 }}>No headlines today. On to the next.</div>
            </div>
          )}

          {grid && (
            <div className="card" style={{ padding: 'var(--sp-3)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--violet-h, #b9a7ff)', marginBottom: 8 }}>{grid.label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                {WEEKDAYS.map((w) => (
                  <div key={w} className="muted" style={{ fontSize: 10, textAlign: 'center', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, paddingBottom: 2 }}>{w}</div>
                ))}
                {grid.weeks.flat().map((cell, i) => {
                  if (!cell) return <div key={`e${i}`} />
                  const info = byDate.get(cell.iso)
                  const isToday = cell.iso === todayISO
                  return (
                    <div
                      key={cell.iso}
                      style={{
                        minHeight: 40, borderRadius: 6, padding: '4px 5px',
                        background: isToday ? 'var(--violet-h, #7c5ce7)' : 'rgba(255,255,255,0.03)',
                        border: isToday ? 'none' : '1px solid var(--border, rgba(255,255,255,0.06))',
                        color: isToday ? '#fff' : 'inherit',
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700, opacity: isToday ? 1 : 0.85 }}>{cell.day}</div>
                      {info && (
                        <div style={{ display: 'flex', gap: 3, marginTop: 3, flexWrap: 'wrap' }}>
                          {info.games > 0 && (
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: isToday ? '#fff' : info.won === true ? 'var(--green, #4ade80)' : info.won === false ? 'var(--red, #f87171)' : 'var(--cyan, #38bdf8)' }} />
                          )}
                          {info.keydates > 0 && (
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: isToday ? 'rgba(255,255,255,0.7)' : 'var(--amber, #fbbf24)' }} />
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-2)', marginTop: 'auto', paddingTop: 'var(--sp-2)' }}>
            <button className="btn btn-ghost" onClick={onClose} disabled={running}>Close</button>
            <button className="btn btn-primary" onClick={onContinue} disabled={running}>
              {running ? 'Processing…' : 'Continue'} <Icon size={14}><Icons.ChevronRight /></Icon>
            </button>
          </div>
        </div>
      </div>
      <style>{`@keyframes ovspin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
