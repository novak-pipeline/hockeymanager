import type { ScheduleEntryView, ScheduleView } from '../../worker/protocol'
import { crestColor, fmtDate } from '../components/format'
import { Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

/** Fixtures grouped by month; next game highlighted; results shown as chips. */
export function ScheduleScreen(): JSX.Element {
  const client = useClient()
  const { data, loading, error } = useScreenData<ScheduleView>(
    () => client.getSchedule(),
    (r) => (r.type === 'schedule' ? r.schedule : null)
  )

  return (
    <section className="stack">
      <ScreenHeader title="Schedule" />
      <ScreenStateNotices
        loading={loading && !data}
        error={error}
        empty={!loading && !error && !data}
        emptyText="No schedule yet."
      />
      {data && <ScheduleBody entries={data.entries} />}
    </section>
  )
}

/* ── internal ── */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function monthKey(iso: string): string {
  // '2026-10-12' → '2026-10'
  return iso.slice(0, 7)
}

function monthLabel(key: string): string {
  const [year, mon] = key.split('-')
  const idx = Number(mon) - 1
  return `${MONTH_NAMES[idx] ?? key} ${year}`
}

function groupByMonth(entries: ScheduleEntryView[]): Array<{ key: string; rows: ScheduleEntryView[] }> {
  const map = new Map<string, ScheduleEntryView[]>()
  for (const e of entries) {
    const k = monthKey(e.date)
    let arr = map.get(k)
    if (!arr) { arr = []; map.set(k, arr) }
    arr.push(e)
  }
  return Array.from(map.entries()).map(([key, rows]) => ({ key, rows }))
}

function resultChip(entry: ScheduleEntryView): JSX.Element | null {
  if (!entry.result) return <span className="muted">—</span>
  const r = entry.result
  const label = r.won
    ? r.decidedBy === 'overtime' ? 'W (OT)' : r.decidedBy === 'shootout' ? 'W (SO)' : 'W'
    : r.decidedBy === 'overtime' ? 'OTL'    : r.decidedBy === 'shootout' ? 'SOL'     : 'L'
  const cls = r.won ? 'chip chip-success' : r.decidedBy !== 'regulation' ? 'chip chip-warn' : 'chip chip-danger'
  const score = `${r.homeGoals}–${r.awayGoals}`
  return <span className={cls}>{label} · {score}</span>
}

function ScheduleBody(props: { entries: ScheduleEntryView[] }): JSX.Element {
  const groups = groupByMonth(props.entries)
  const played = props.entries.filter((e) => e.result !== null).length
  const total = props.entries.length
  const wins = props.entries.filter((e) => e.result?.won).length
  const losses = props.entries.filter((e) => e.result && !e.result.won && e.result.decidedBy === 'regulation').length
  const otl = props.entries.filter((e) => e.result && !e.result.won && e.result.decidedBy !== 'regulation').length

  return (
    <div className="stack">
      <div className="row" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
        <div className="stat">
          <div className="stat-value">{played}<span className="muted" style={{ fontSize: 16 }}>/{total}</span></div>
          <div className="stat-label">Games played</div>
        </div>
        {played > 0 && (
          <div className="stat">
            <div className="stat-value">{wins}–{losses}–{otl}</div>
            <div className="stat-label">W – L – OTL</div>
          </div>
        )}
      </div>

      {groups.map((g) => (
        <Panel key={g.key} title={monthLabel(g.key)}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>H/A</th>
                  <th>Opponent</th>
                  <th className="num">Result</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((e) => (
                  <tr
                    key={e.gameId}
                    className={e.isNext ? 'is-user' : undefined}
                  >
                    <td className="muted">{fmtDate(e.date)}</td>
                    <td>
                      <span className={e.home ? 'chip chip-accent' : 'chip'}>
                        {e.home ? 'H' : 'A'}
                      </span>
                    </td>
                    <td>
                      <span className="row" style={{ gap: 'var(--sp-2)' }}>
                        <span
                          className="crest"
                          style={{
                            background: crestColor(e.opponentTeamId),
                            width: 20,
                            height: 20,
                            fontSize: 9,
                            border: 'none',
                          }}
                        >
                          {e.opponentAbbr.slice(0, 2)}
                        </span>
                        {e.opponentName}
                        {e.isNext && <span className="chip chip-warn" style={{ fontSize: 10 }}>Next</span>}
                      </span>
                    </td>
                    <td className="num">{resultChip(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
    </div>
  )
}
