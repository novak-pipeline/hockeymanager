/**
 * The Yearbook — every Season Wrapped this save has produced, newest first.
 * A long career becomes a history book: each tile is one league year (your
 * finish, the champion, the headlines), and opening it replays the full card
 * deck exactly as it was written that summer (docs/SEASON-WRAPPED.md).
 */
import type { WrappedYearbookRow, WrappedYearbookView } from '../../worker/protocol'
import { useClient, useScreenData } from '../hooks/useSim'
import { CrestView } from '../components/Crest'
import { ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useWrappedUi } from '../components/WrappedOverlay'
import '../components/wrapped.css'

function hex(c: number): string {
  return `#${(c >>> 0).toString(16).padStart(6, '0').slice(-6)}`
}

function Tile(props: { row: WrappedYearbookRow; isNew: boolean; onOpen: () => void }): JSX.Element {
  const { row } = props
  return (
    <button
      className="yb-tile"
      style={{ ['--wr-a' as string]: hex(row.userTeam.primary) }}
      onClick={props.onOpen}
      aria-label={`Open Season Wrapped ${row.seasonLabel}`}
    >
      {props.isNew && <span className="yb-new">NEW</span>}
      <div className="yb-season">{row.seasonLabel}</div>
      <div className="yb-tag">{row.tagline} · {row.record}</div>
      <ul className="yb-heads">
        {row.headlines.map((h, i) => <li key={i}>{h}</li>)}
      </ul>
      <div className="yb-foot">
        {row.champion ? (
          <span className="yb-champ">
            <CrestView teamId={row.champion.id} abbr={row.champion.abbr}
              colors={{ primary: row.champion.primary, secondary: row.champion.secondary }} className="wr-crest" />
            Champion: {row.champion.name}
          </span>
        ) : <span>No champion crowned</span>}
        <span>{row.cardCount} cards</span>
      </div>
    </button>
  )
}

/** The tile grid on its own (also used by the dev preview page). */
export function YearbookGrid(props: { rows: WrappedYearbookRow[]; pendingYear: number | null; onOpen: (year: number) => void }): JSX.Element {
  return (
    <div className="yb-grid">
      {props.rows.map((row) => (
        <Tile key={row.year} row={row} isNew={props.pendingYear === row.year} onOpen={() => props.onOpen(row.year)} />
      ))}
    </div>
  )
}

export function YearbookScreen(): JSX.Element {
  const client = useClient()
  const openYear = useWrappedUi((s) => s.openYear)
  const { data, loading, error } = useScreenData<WrappedYearbookView>(
    () => client.getYearbook(),
    (r) => (r.type === 'yearbook' ? r.yearbook : null)
  )
  const years = data?.years ?? []
  return (
    <div className="screen">
      <ScreenHeader title="Yearbook" />
      <p className="muted" style={{ marginTop: -4, marginBottom: 16, maxWidth: 640 }}>
        Every season you have run, wrapped the week the draft closed it: your year, the league’s year, the history
        made and the calls that aged well or badly. Open one to replay it.
      </p>
      <ScreenStateNotices
        loading={loading && !data}
        error={error}
        empty={!loading && years.length === 0}
        emptyText="Nothing here yet. Your first Season Wrapped arrives when the entry draft closes out a season you played."
      />
      <YearbookGrid rows={years} pendingYear={data?.pendingYear ?? null} onOpen={openYear} />
    </div>
  )
}
