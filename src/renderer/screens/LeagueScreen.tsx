/**
 * LeagueScreen — EHM-style mega-screen for the League section.
 *
 * Sub-tabs: Overview | Standings | Schedule | Player Stats | History |
 *           Scouting | Draft | Offseason | Playoffs
 *
 * The Overview tab is new; the rest re-parent existing screens.
 */
import type {
  LeagueLeadersView,
  StandingsView,
} from '../../worker/protocol'
import { PlayerLink } from '../components/NavContext'
import { Notice, Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { crestColor } from '../components/format'
import { useClient, useScreenData } from '../hooks/useSim'
import { StandingsScreen } from './StandingsScreen'
import { StatsScreen } from './StatsScreen'
import { HistoryScreen } from './HistoryScreen'
import { ScoutingScreen } from './ScoutingScreen'
import { DraftScreen } from './DraftScreen'
import { OffseasonScreen } from './OffseasonScreen'
import { PlayoffsScreen } from './PlayoffsScreen'
import { ScheduleScreen } from './ScheduleScreen'

type LeagueTab =
  | 'leagueOverview'
  | 'standings'
  | 'leagueSchedule'
  | 'stats'
  | 'leagueHistory'
  | 'scouting'
  | 'draft'
  | 'offseason'
  | 'playoffs'

/* ── stat category metadata ── */
interface LeaderCategory {
  key: keyof LeagueLeadersView
  label: string
  unit: string
  decimals: number
}

const LEADER_CATEGORIES: LeaderCategory[] = [
  { key: 'goals',          label: 'Goals',            unit: 'G',    decimals: 0 },
  { key: 'assists',        label: 'Assists',           unit: 'A',    decimals: 0 },
  { key: 'points',         label: 'Points',            unit: 'PTS',  decimals: 0 },
  { key: 'plusMinus',      label: 'Plus/Minus',        unit: '±',    decimals: 0 },
  { key: 'goalsAgainstAvg', label: 'Goals Against Avg', unit: 'GAA',  decimals: 2 },
  { key: 'savePct',        label: 'Save %',            unit: 'SV%',  decimals: 3 },
]

/* ══════════════════════════════════════════════════════════════
   Root component
   ══════════════════════════════════════════════════════════════ */

export function LeagueScreen(props: { tab: LeagueTab }): JSX.Element {
  const { tab } = props

  switch (tab) {
    case 'leagueOverview': return <LeagueOverviewTab />
    case 'standings':      return <StandingsScreen />
    case 'leagueSchedule': return <LeagueScheduleTab />
    case 'stats':          return <StatsScreen />
    case 'leagueHistory':  return <HistoryScreen />
    case 'scouting':       return <ScoutingScreen />
    case 'draft':          return <DraftScreen />
    case 'offseason':      return <OffseasonScreen />
    case 'playoffs':       return <PlayoffsScreen />
  }
}

/* ══════════════════════════════════════════════════════════════
   OVERVIEW TAB — leader cards + conference standings
   ══════════════════════════════════════════════════════════════ */

function LeagueOverviewTab(): JSX.Element {
  const client = useClient()

  const { data: leaders, loading: loadingLeaders, error: errorLeaders } = useScreenData<LeagueLeadersView>(
    () => client.getLeagueLeaders(5),
    (r) => (r.type === 'leagueLeaders' ? r.leaders : null)
  )

  const { data: standings, loading: loadingStandings } = useScreenData<StandingsView>(
    () => client.getStandings(),
    (r) => (r.type === 'standings' ? r.standings : null)
  )

  return (
    <section className="stack">
      <ScreenHeader title="League Overview" />

      {errorLeaders && <Notice kind="warn">{errorLeaders}</Notice>}
      {loadingLeaders && !leaders && <Notice kind="info">Loading leaders…</Notice>}

      {leaders && (
        <Panel title="League leaders">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 'var(--sp-3)',
            }}
          >
            {LEADER_CATEGORIES.map((cat) => {
              const entries = leaders[cat.key]
              return (
                <LeaderCard
                  key={cat.key}
                  title={cat.label}
                  unit={cat.unit}
                  entries={entries}
                  decimals={cat.decimals}
                />
              )
            })}
          </div>
        </Panel>
      )}

      {standings && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
          {standings.conferences.map((conf) => (
            <Panel key={conf.name} title={`${conf.name} Conference`}>
              <ConferenceStandingsTable rows={conf.rows} />
            </Panel>
          ))}
        </div>
      )}
      {loadingStandings && !standings && <Notice kind="info">Loading standings…</Notice>}
    </section>
  )
}

function LeaderCard(props: {
  title: string
  unit: string
  entries: LeagueLeadersView[keyof LeagueLeadersView]
  decimals: number
}): JSX.Element {
  const { entries, decimals } = props
  return (
    <div
      style={{
        background: 'var(--bg2)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--sp-3)',
        border: '1px solid var(--line)',
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.8px',
          color: 'var(--muted)',
          marginBottom: 'var(--sp-2)',
        }}
      >
        {props.title}
      </div>
      {(entries as Array<{ playerId: string; name: string; teamAbbr: string; value: number }>).map(
        (entry, idx) => (
          <div
            key={entry.playerId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--sp-2)',
              padding: '3px 0',
              borderBottom: idx < entries.length - 1 ? '1px solid var(--line)' : 'none',
            }}
          >
            {/* Rank + avatar */}
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: idx === 0 ? 'var(--violet)' : 'var(--bg3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 9,
                fontWeight: 700,
                color: idx === 0 ? '#fff' : 'var(--muted)',
                flexShrink: 0,
              }}
            >
              {idx + 1}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, minWidth: 0 }}>
                <PlayerLink
                  playerId={entry.playerId}
                  name={entry.name}
                  className="small"
                />
                <span className="muted" style={{ fontSize: 10, flexShrink: 0 }}>
                  {entry.teamAbbr}
                </span>
              </div>
            </div>
            <span
              className="mono"
              style={{
                fontWeight: idx === 0 ? 700 : 500,
                color: idx === 0 ? 'var(--violet-h)' : 'var(--text)',
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              {decimals > 0
                ? entry.value.toFixed(decimals).replace(/^0\./, '.')
                : entry.value}
            </span>
          </div>
        )
      )}
      {entries.length === 0 && (
        <span className="muted small">No data yet.</span>
      )}
    </div>
  )
}

function ConferenceStandingsTable(props: {
  rows: Array<{
    teamId: string
    name: string
    abbreviation: string
    gamesPlayed: number
    wins: number
    losses: number
    overtimeLosses: number
    points: number
    lastFive: string
  }>
}): JSX.Element {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th className="num">GP</th>
            <th className="num">W</th>
            <th className="num">L</th>
            <th className="num">OTL</th>
            <th className="num">PTS</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, i) => (
            <tr key={row.teamId}>
              <td>
                <span
                  className={i < 3 ? 'rank-chip top3' : i < 8 ? 'rank-chip top8' : 'rank-chip'}
                >
                  {i + 1}
                </span>
              </td>
              <td>
                <span className="row" style={{ gap: 5 }}>
                  <span
                    className="crest"
                    style={{
                      background: crestColor(row.teamId),
                      width: 18,
                      height: 18,
                      fontSize: 8,
                      border: 'none',
                      flexShrink: 0,
                    }}
                  >
                    {row.abbreviation.slice(0, 2)}
                  </span>
                  {row.abbreviation}
                </span>
              </td>
              <td className="num">{row.gamesPlayed}</td>
              <td className="num">{row.wins}</td>
              <td className="num">{row.losses}</td>
              <td className="num">{row.overtimeLosses}</td>
              <td className="num">
                <strong>{row.points}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   SCHEDULE TAB — re-parents ScheduleScreen (user schedule)
   ══════════════════════════════════════════════════════════════ */

function LeagueScheduleTab(): JSX.Element {
  return (
    <section className="stack">
      <Notice kind="info">
        League-wide schedule not available. Showing your club's fixtures below.
      </Notice>
      <ScheduleScreen />
    </section>
  )
}
