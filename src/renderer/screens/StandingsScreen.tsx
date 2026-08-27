import { Fragment, useMemo, useState } from 'react'
import type { AhlStandingsView, LeagueTeamsView, StandingsView } from '../../worker/protocol'
import type { StandingRowView } from '../../engine/career/views'
import { Notice, Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { CrestView } from '../components/Crest'
import { useClient, useScreenData } from '../hooks/useSim'
import { useNav } from '../components/NavContext'
import { useUserTeamId } from '../components/UserTeamContext'
import { SortHeaders, sortColumns, useTableSort } from '../components/sortable'

/** Wins in the last five, so "who's hot" is a column you can actually order by. */
function lastFiveWins(value: string): number {
  return value.split('').filter((c) => c === 'W').length
}

/** 'W3' → +3, 'L2' → −2, so the streak column orders hottest-to-coldest. */
function streakValue(streak: string): number {
  const n = Number.parseInt(streak.slice(1), 10)
  if (!Number.isFinite(n)) return 0
  return streak.startsWith('W') ? n : streak.startsWith('L') ? -n : 0
}

/** A standings row plus the place it holds, so "#" survives re-ordering. */
type RankedStanding = StandingRowView & { rank: number }

const STANDINGS_COLS = sortColumns<RankedStanding>()([
  { key: 'rank', label: '#', value: (r) => r.rank, initialDir: 'asc', style: { width: 32 }, title: 'League position — click to return to standings order' },
  { key: 'name', label: 'Team', value: (r) => r.name },
  { key: 'gamesPlayed', label: 'GP', value: (r) => r.gamesPlayed, align: 'right' },
  { key: 'wins', label: 'W', value: (r) => r.wins, align: 'right' },
  { key: 'losses', label: 'L', value: (r) => r.losses, align: 'right' },
  { key: 'overtimeLosses', label: 'OTL', value: (r) => r.overtimeLosses, align: 'right' },
  { key: 'points', label: 'PTS', value: (r) => r.points, align: 'right' },
  { key: 'goalsFor', label: 'GF', value: (r) => r.goalsFor, align: 'right' },
  { key: 'goalsAgainst', label: 'GA', value: (r) => r.goalsAgainst, align: 'right' },
  { key: 'diff', label: 'DIFF', value: (r) => r.goalsFor - r.goalsAgainst, align: 'right' },
  { key: 'streak', label: 'Streak', value: (r) => streakValue(r.streak), title: 'Current run — sorts hottest first' },
  { key: 'lastFive', label: 'L5', value: (r) => lastFiveWins(r.lastFive), title: 'Wins in the last five' },
])

type TabId = 'overall' | 'conference' | 'division' | 'ahl'

/** Full league standings: Overall / Conference / Division / AHL tabs. */
export function StandingsScreen(): JSX.Element {
  const client = useClient()
  const { data, loading, error } = useScreenData<StandingsView>(
    () => client.getStandings(),
    (r) => (r.type === 'standings' ? r.standings : null)
  )
  const { data: ahlData, loading: ahlLoading, error: ahlError } = useScreenData<AhlStandingsView>(
    () => client.getAhlStandings(),
    (r) => (r.type === 'ahlStandings' ? r.standings : null)
  )
  const [tab, setTab] = useState<TabId>('overall')
  // per-conference subtab when on "conference" view
  const [confIdx, setConfIdx] = useState(0)
  // per-division subtab when on "division" view
  const [divIdx, setDivIdx] = useState(0)

  return (
    <section className="stack">
      <ScreenHeader title="Standings" />
      <ScreenStateNotices
        loading={loading && !data}
        error={error}
        empty={!loading && !error && !data}
        emptyText="No standings yet."
      />
      {data && (
        <StandingsBody
          data={data}
          tab={tab}
          setTab={setTab}
          confIdx={confIdx}
          setConfIdx={setConfIdx}
          divIdx={divIdx}
          setDivIdx={setDivIdx}
          ahlData={ahlData}
          ahlLoading={ahlLoading}
          ahlError={ahlError}
        />
      )}
    </section>
  )
}

/* ── internal ── */

function StandingsBody(props: {
  data: StandingsView
  tab: TabId
  setTab: (t: TabId) => void
  confIdx: number
  setConfIdx: (i: number) => void
  divIdx: number
  setDivIdx: (i: number) => void
  ahlData: AhlStandingsView | null
  ahlLoading: boolean
  ahlError: string | null
}): JSX.Element {
  const { data, tab, setTab, confIdx, setConfIdx, divIdx, setDivIdx, ahlData, ahlLoading, ahlError } = props

  return (
    <div className="stack">
      <div className="tabs">
        {(['overall', 'conference', 'division', 'ahl'] as TabId[]).map((t) => (
          <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t === 'overall' ? 'Overall' : t === 'conference' ? 'Conference' : t === 'division' ? 'Division' : 'AHL'}
          </button>
        ))}
      </div>

      {tab === 'overall' && (
        <Panel title="League standings">
          <StandingsTable rows={data.overall} playoffLine={null} />
        </Panel>
      )}

      {tab === 'conference' && (
        <div className="stack">
          {data.conferences.length > 1 && (
            <div className="tabs" style={{ borderBottom: 'none', marginBottom: 0 }}>
              {data.conferences.map((c, i) => (
                <button
                  key={c.name}
                  className={`tab${confIdx === i ? ' active' : ''}`}
                  onClick={() => setConfIdx(i)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {data.conferences[confIdx] && (
            <Panel title={data.conferences[confIdx].name}>
              <StandingsTable rows={data.conferences[confIdx].rows} playoffLine={4} />
            </Panel>
          )}
        </div>
      )}

      {tab === 'division' && (
        <div className="stack">
          {data.divisions.length > 1 && (
            <div className="tabs" style={{ borderBottom: 'none', marginBottom: 0 }}>
              {data.divisions.map((d, i) => (
                <button
                  key={d.name}
                  className={`tab${divIdx === i ? ' active' : ''}`}
                  onClick={() => setDivIdx(i)}
                >
                  {d.name}
                </button>
              ))}
            </div>
          )}
          {data.divisions[divIdx] && (
            <Panel title={`${data.divisions[divIdx].name} · ${data.divisions[divIdx].conferenceName}`}>
              <StandingsTable rows={data.divisions[divIdx].rows} playoffLine={null} />
            </Panel>
          )}
        </div>
      )}

      {tab === 'ahl' && (
        <div className="stack">
          {ahlError && <Notice kind="warn">{ahlError}</Notice>}
          {ahlLoading && !ahlData && <Notice kind="info">Loading AHL standings…</Notice>}
          {ahlData && ahlData.rows.length === 0 && (
            <Notice kind="info">No AHL affiliates have been generated for this league.</Notice>
          )}
          {ahlData && ahlData.rows.length > 0 && (
            <Panel title="AHL Affiliate League">
              <StandingsTable rows={ahlData.rows} playoffLine={null} />
            </Panel>
          )}
        </div>
      )}
    </div>
  )
}

/** The standings table itself; playoffLine inserts a visual divider after that rank. */
function StandingsTable(props: {
  rows: StandingRowView[]
  playoffLine: number | null
}): JSX.Element {
  const { rows, playoffLine } = props
  const nav = useNav()
  const userTeamId = useUserTeamId()
  const client = useClient()
  const { data: leagueTeams } = useScreenData<LeagueTeamsView>(
    () => client.getLeagueTeams(),
    (r) => (r.type === 'leagueTeams' ? r.teams : null)
  )
  const colorOf = useMemo(() => {
    const m = new Map<string, { primary: number; secondary: number }>()
    if (leagueTeams) for (const t of [...leagueTeams.nhl, ...leagueTeams.ahl]) if (t.colors) m.set(t.teamId, t.colors)
    return m
  }, [leagueTeams])

  // Rank is a property of the STANDINGS, not of the row's position on screen —
  // sort by goals-for and a club must still show the place it actually holds.
  // The playoff cut-line is only meaningful in standings order, so it hides
  // whenever the table is arranged by something else.
  const ranked = useMemo<RankedStanding[]>(() => rows.map((r, i) => ({ ...r, rank: i + 1 })), [rows])
  const { sorted, sortKey, dir, sortBy } = useTableSort(ranked, STANDINGS_COLS, { key: null })
  const inStandingsOrder = sortKey === null || (sortKey === 'rank' && dir === 'asc')

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <SortHeaders columns={STANDINGS_COLS} sortKey={sortKey} dir={dir} onSort={sortBy} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <Fragment key={row.teamId}>
              {playoffLine !== null && inStandingsOrder && i === playoffLine && (
                <tr style={{ pointerEvents: 'none' }}>
                  <td
                    colSpan={12}
                    style={{
                      padding: 0,
                      borderTop: '2px solid var(--accent)',
                      lineHeight: 0,
                    }}
                  />
                </tr>
              )}
              <tr className={row.teamId === userTeamId ? 'is-user' : undefined}>
                <td className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{row.rank}</td>
                <td>
                  <span className="row" style={{ gap: 'var(--sp-2)' }}>
                    <CrestView
                      className="crest"
                      teamId={row.teamId}
                      abbr={row.abbreviation.slice(0, 2)}
                      {...(colorOf.get(row.teamId) ? { colors: colorOf.get(row.teamId)! } : {})}
                      style={{ width: 20, height: 20, fontSize: 9, flexShrink: 0 }}
                    />
                    <button
                      type="button"
                      className="player-link"
                      onClick={() =>
                        row.teamId === userTeamId
                          ? nav.navigate('squad')
                          : nav.navigate('squad', { teamId: row.teamId })
                      }
                    >
                      {row.name}
                    </button>
                    <span className="muted small">{row.abbreviation}</span>
                  </span>
                </td>
                <td className="num">{row.gamesPlayed}</td>
                <td className="num">{row.wins}</td>
                <td className="num">{row.losses}</td>
                <td className="num">{row.overtimeLosses}</td>
                <td className="num"><strong>{row.points}</strong></td>
                <td className="num">{row.goalsFor}</td>
                <td className="num">{row.goalsAgainst}</td>
                <td className="num">
                  <DiffCell diff={row.goalsFor - row.goalsAgainst} />
                </td>
                <td>
                  <StreakChip streak={row.streak} />
                </td>
                <td>
                  <LastFiveDots value={row.lastFive} />
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DiffCell(props: { diff: number }): JSX.Element {
  const { diff } = props
  const color = diff > 0 ? 'var(--success)' : diff < 0 ? 'var(--danger)' : 'var(--muted)'
  return (
    <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>
      {diff > 0 ? `+${diff}` : diff}
    </span>
  )
}

function StreakChip(props: { streak: string }): JSX.Element {
  const { streak } = props
  const cls = streak.startsWith('W')
    ? 'chip chip-success'
    : streak.startsWith('L')
    ? 'chip chip-danger'
    : 'chip chip-warn'
  return <span className={cls}>{streak}</span>
}

function LastFiveDots(props: { value: string }): JSX.Element {
  const letters = props.value.split('').filter((c) => c === 'W' || c === 'L' || c === 'O')
  if (letters.length === 0) return <span className="muted">—</span>
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {letters.map((c, i) => {
        const bg =
          c === 'W' ? 'var(--success)' : c === 'L' ? 'var(--danger)' : 'var(--accent2)'
        return (
          <span
            key={i}
            title={c === 'W' ? 'Win' : c === 'L' ? 'Loss' : 'OT Loss'}
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: bg,
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
        )
      })}
    </span>
  )
}
