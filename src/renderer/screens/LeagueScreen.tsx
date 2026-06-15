/**
 * LeagueScreen — EHM-style mega-screen for the League section.
 *
 * Sub-tabs: Overview | Standings | Schedule | Player Stats | Team Stats |
 *           Transactions | Scoreboard | History | Scouting | Draft | Offseason | Playoffs
 *
 * The Overview tab is new; the rest re-parent existing screens.
 */
import { useState } from 'react'
import type {
  LeagueLeadersView,
  LeagueStatsView,
  ScoreboardView,
  StandingsView,
  TransactionsView,
} from '../../worker/protocol'
import { PlayerLink } from '../components/NavContext'
import { Notice, Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { TeamCrest } from '../components/Crest'
import { useClient, useScreenData } from '../hooks/useSim'
import { StandingsScreen } from './StandingsScreen'
import { StatsScreen } from './StatsScreen'
import { LeagueStatsTableScreen } from './LeagueStatsTableScreen'
import { HistoryScreen } from './HistoryScreen'
import { ScoutingScreen } from './ScoutingScreen'
import { DraftRankingsScreen } from './DraftRankingsScreen'
import { DraftScreen } from './DraftScreen'
import { OffseasonScreen } from './OffseasonScreen'
import { PlayoffsScreen } from './PlayoffsScreen'
import { ScheduleScreen } from './ScheduleScreen'

type LeagueTab =
  | 'leagueOverview'
  | 'standings'
  | 'leagueSchedule'
  | 'stats'
  | 'leagueLeaders'
  | 'leagueTeamStats'
  | 'leagueTransactions'
  | 'leagueScoreboard'
  | 'leagueHistory'
  | 'scouting'
  | 'scoutingCentre'
  | 'scoutingPlayers'
  | 'scoutingFocus'
  | 'scoutingCoverage'
  | 'scoutingDraft'
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
    case 'leagueOverview':     return <LeagueOverviewTab />
    case 'standings':          return <StandingsScreen />
    case 'leagueSchedule':     return <LeagueScheduleTab />
    case 'stats':              return <LeagueStatsTableScreen />
    case 'leagueLeaders':      return <StatsScreen />
    case 'leagueTeamStats':    return <LeagueTeamStatsTab />
    case 'leagueTransactions': return <LeagueTransactionsTab />
    case 'leagueScoreboard':   return <LeagueScoreboardTab />
    case 'leagueHistory':      return <HistoryScreen />
    case 'scouting':           return <ScoutingScreen tab="overview" />
    case 'scoutingCentre':     return <ScoutingScreen tab="centre" />
    case 'scoutingPlayers':    return <ScoutingScreen tab="players" />
    case 'scoutingFocus':      return <ScoutingScreen tab="focus" />
    case 'scoutingCoverage':   return <ScoutingScreen tab="coverage" />
    case 'scoutingDraft':      return <DraftRankingsScreen />
    case 'draft':              return <DraftScreen />
    case 'offseason':          return <OffseasonScreen />
    case 'playoffs':           return <PlayoffsScreen />
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
                  <TeamCrest
                    className="crest"
                    teamId={row.teamId}
                    abbr={row.abbreviation.slice(0, 2)}
                    style={{ width: 18, height: 18, fontSize: 8, flexShrink: 0 }}
                  />
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

/* ══════════════════════════════════════════════════════════════
   TEAM STATS TAB — PP% / PK% special-teams table
   ══════════════════════════════════════════════════════════════ */

function LeagueTeamStatsTab(): JSX.Element {
  const client = useClient()

  const { data, loading, error } = useScreenData<LeagueStatsView>(
    () => client.getLeagueStats(),
    (r) => (r.type === 'leagueStats' ? r.stats : null)
  )

  return (
    <section className="stack">
      <ScreenHeader title="Team Stats" />
      <ScreenStateNotices
        loading={loading && !data}
        error={error}
        empty={!loading && !error && !data}
        emptyText="No team stats yet — play some games first."
      />
      {data && data.specialTeams.length > 0 && (
        <Panel title="Special Teams">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Team</th>
                  <th className="num">PP Goals</th>
                  <th className="num">PP Opp</th>
                  <th className="num">PP%</th>
                  <th className="num">PK Kills</th>
                  <th className="num">Times SH</th>
                  <th className="num">PK%</th>
                </tr>
              </thead>
              <tbody>
                {data.specialTeams.map((row, i) => (
                  <tr key={row.teamId}>
                    <td>
                      <span className={i < 3 ? 'rank-chip top3' : 'rank-chip'}>
                        {i + 1}
                      </span>
                    </td>
                    <td>
                      <span className="row" style={{ gap: 5 }}>
                        <TeamCrest
                          className="crest"
                          teamId={row.teamId}
                          abbr={row.teamAbbr.slice(0, 2)}
                          style={{ width: 18, height: 18, fontSize: 8, flexShrink: 0 }}
                        />
                        {row.teamAbbr}
                        <span className="muted small">{row.teamName}</span>
                      </span>
                    </td>
                    <td className="num">{row.ppGoals}</td>
                    <td className="num">{row.ppOpportunities}</td>
                    <td className="num">
                      <strong style={{ color: ppColor(row.ppPct) }}>
                        {(row.ppPct * 100).toFixed(1)}%
                      </strong>
                    </td>
                    <td className="num">{row.pkKills}</td>
                    <td className="num">{row.timesShorthanded}</td>
                    <td className="num">
                      <strong style={{ color: pkColor(row.pkPct) }}>
                        {(row.pkPct * 100).toFixed(1)}%
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="muted small" style={{ marginTop: 'var(--sp-2)' }}>
            Sorted by PP% descending. PK% = kills / times shorthanded.
          </div>
        </Panel>
      )}
      {data && data.specialTeams.length === 0 && (
        <Notice kind="info">No penalty data yet. Play some games to populate special-teams stats.</Notice>
      )}
    </section>
  )
}

function ppColor(pct: number): string {
  if (pct >= 0.22) return 'var(--green)'
  if (pct >= 0.17) return 'var(--text)'
  return 'var(--red)'
}

function pkColor(pct: number): string {
  if (pct >= 0.82) return 'var(--green)'
  if (pct >= 0.77) return 'var(--text)'
  return 'var(--red)'
}

/* ══════════════════════════════════════════════════════════════
   TRANSACTIONS TAB — trade / signing ledger
   ══════════════════════════════════════════════════════════════ */

const KIND_CHIP: Record<string, string> = {
  trade:    'chip chip-warn',
  signing:  'chip chip-success',
  release:  'chip chip-danger',
  draft:    'chip chip-violet',
  callup:   'chip',
  waiver:   'chip',
}

const KIND_LABEL: Record<string, string> = {
  trade:    'Trade',
  signing:  'Signing',
  release:  'Release',
  draft:    'Draft',
  callup:   'Call-up',
  waiver:   'Waiver',
}

function LeagueTransactionsTab(): JSX.Element {
  const client = useClient()

  const { data, loading, error } = useScreenData<TransactionsView>(
    () => client.getTransactions(100),
    (r) => (r.type === 'transactions' ? r.transactions : null)
  )

  return (
    <section className="stack">
      <ScreenHeader title="Transactions" />
      <ScreenStateNotices
        loading={loading && !data}
        error={error}
        empty={!loading && !error && !data}
        emptyText="No transactions recorded yet."
      />
      {data && data.items.length === 0 && (
        <Notice kind="info">No transactions yet this season.</Notice>
      )}
      {data && data.items.length > 0 && (
        <Panel title="Recent Transactions">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Type</th>
                  <th>Teams</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {[...data.items].reverse().map((tx) => (
                  <tr key={tx.id}>
                    <td className="muted mono" style={{ whiteSpace: 'nowrap' }}>
                      Day {tx.day}
                    </td>
                    <td>
                      <span className={KIND_CHIP[tx.kind] ?? 'chip'} style={{ fontSize: 10 }}>
                        {KIND_LABEL[tx.kind] ?? tx.kind}
                      </span>
                    </td>
                    <td>
                      <span className="muted small">
                        {tx.teamNames.join(' / ')}
                      </span>
                    </td>
                    <td style={{ maxWidth: 400 }}>
                      <span style={{ fontSize: 13 }}>{tx.summary}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </section>
  )
}

/* ══════════════════════════════════════════════════════════════
   SCOREBOARD TAB — league-wide scores for a selected day
   ══════════════════════════════════════════════════════════════ */

function LeagueScoreboardTab(): JSX.Element {
  const client = useClient()
  const [selectedDay, setSelectedDay] = useState<number | null>(null)

  const { data, loading, error, refetch } = useScreenData<ScoreboardView>(
    () => selectedDay !== null ? client.getScoreboard(selectedDay) : client.getScoreboard(),
    (r) => (r.type === 'scoreboard' ? r.scoreboard : null)
  )

  function handleDayJump(delta: number): void {
    const base = selectedDay ?? (data?.day ?? 1)
    const next = Math.max(1, base + delta)
    setSelectedDay(next)
    refetch()
  }

  return (
    <section className="stack">
      <ScreenHeader title="Scoreboard" />
      <ScreenStateNotices
        loading={loading && !data}
        error={error}
        empty={!loading && !error && !data}
        emptyText="No scoreboard data yet."
      />

      {data && (
        <>
          {/* Day navigation */}
          <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'center' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => handleDayJump(-1)}
              disabled={loading}
            >
              ← Prev day
            </button>
            <span style={{ fontWeight: 600 }}>Day {data.day}</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => handleDayJump(+1)}
              disabled={loading}
            >
              Next day →
            </button>
          </div>

          {data.entries.length === 0 ? (
            <Notice kind="info">No games scheduled on day {data.day}.</Notice>
          ) : (
            <Panel title={`Results — Day ${data.day}`}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: 'var(--sp-3)',
                }}
              >
                {data.entries.map((entry) => (
                  <ScoreCard key={entry.gameId} entry={entry} />
                ))}
              </div>
            </Panel>
          )}
        </>
      )}
    </section>
  )
}

function ScoreCard(props: {
  entry: ScoreboardView['entries'][number]
}): JSX.Element {
  const { entry } = props
  const homeWon = entry.final && entry.homeGoals > entry.awayGoals
  const awayWon = entry.final && entry.awayGoals > entry.homeGoals

  return (
    <div
      style={{
        background: 'var(--bg2)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--sp-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sp-1)',
      }}
    >
      {/* Away team */}
      <div className="row-between" style={{ gap: 'var(--sp-2)' }}>
        <span
          style={{
            fontWeight: awayWon ? 700 : 400,
            color: awayWon ? 'var(--text)' : 'var(--muted)',
          }}
        >
          {entry.awayAbbr}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 18,
            fontWeight: awayWon ? 700 : 400,
            color: awayWon ? 'var(--violet-h)' : 'var(--muted)',
          }}
        >
          {entry.awayGoals}
        </span>
      </div>

      {/* Home team */}
      <div className="row-between" style={{ gap: 'var(--sp-2)' }}>
        <span
          style={{
            fontWeight: homeWon ? 700 : 400,
            color: homeWon ? 'var(--text)' : 'var(--muted)',
          }}
        >
          {entry.homeAbbr}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 18,
            fontWeight: homeWon ? 700 : 400,
            color: homeWon ? 'var(--violet-h)' : 'var(--muted)',
          }}
        >
          {entry.homeGoals}
        </span>
      </div>

      {/* Status */}
      <div style={{ marginTop: 'var(--sp-1)' }}>
        {entry.final ? (
          <span className="chip chip-success" style={{ fontSize: 10 }}>Final</span>
        ) : (
          <span className="chip" style={{ fontSize: 10 }}>Scheduled</span>
        )}
      </div>
    </div>
  )
}
