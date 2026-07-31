import { useState } from 'react'
import type { LeaderRowView, StatsView } from '../../worker/protocol'
import { PlayerLink } from '../components/NavContext'
import { Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

type StatTab = 'points' | 'goals' | 'assists' | 'savePct' | 'goalsAgainstAvg' | 'wins'

const TAB_LABELS: Record<StatTab, string> = {
  points: 'Points',
  goals: 'Goals',
  assists: 'Assists',
  savePct: 'Save %',
  goalsAgainstAvg: 'GAA',
  wins: 'Wins',
}

/** League stat leaderboards: top-10 per category. */
export function StatsScreen(): JSX.Element {
  const client = useClient()
  const { data, loading, error } = useScreenData<StatsView>(
    () => client.getStats(),
    (r) => (r.type === 'stats' ? r.stats : null)
  )
  const [tab, setTab] = useState<StatTab>('points')

  return (
    <section className="stack">
      <ScreenHeader title="League Stats" />
      <ScreenStateNotices
        loading={loading && !data}
        error={error}
        empty={!loading && !error && !data}
        emptyText="No stats yet."
      />
      {data && (
        <StatsBody data={data} tab={tab} setTab={setTab} />
      )}
    </section>
  )
}

/* ── internal ── */

function StatsBody(props: {
  data: StatsView
  tab: StatTab
  setTab: (t: StatTab) => void
}): JSX.Element {
  const { data, tab, setTab } = props

  const boardMap: Record<StatTab, LeaderRowView[]> = {
    points: data.points,
    goals: data.goals,
    assists: data.assists,
    savePct: data.savePct,
    goalsAgainstAvg: data.goalsAgainstAvg,
    wins: data.wins,
  }

  const rows = boardMap[tab] ?? []

  return (
    <div className="stack">
      <div className="tabs">
        {(Object.keys(TAB_LABELS) as StatTab[]).map((t) => (
          <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <Panel title={`${TAB_LABELS[tab]} Leaders`}>
        {rows.length === 0 ? (
          <span className="muted">No games have been played yet — leaders fill in once the season is under way.</span>
        ) : (
          <Leaderboard rows={rows} tab={tab} />
        )}
      </Panel>
    </div>
  )
}

function formatValue(value: number, tab: StatTab): string {
  if (tab === 'savePct') return value.toFixed(3).replace(/^0/, '')
  if (tab === 'goalsAgainstAvg') return value.toFixed(2)
  return String(value)
}

function LeaderHeader(props: { tab: StatTab }): JSX.Element {
  const { tab } = props
  return (
    <thead>
      <tr>
        <th style={{ width: 32 }}>#</th>
        <th>Player</th>
        <th>Team</th>
        <th className="num">GP</th>
        <th className="num">{TAB_LABELS[tab]}</th>
      </tr>
    </thead>
  )
}

/** Medal palette for the podium (gold / silver / bronze). */
const MEDAL: Record<number, { ring: string; ink: string; bg: string }> = {
  0: { ring: '#facc15', ink: '#facc15', bg: 'rgba(250,204,21,0.14)' },
  1: { ring: '#cbd5e1', ink: '#cbd5e1', bg: 'rgba(203,213,225,0.12)' },
  2: { ring: '#d19a66', ink: '#d19a66', bg: 'rgba(209,154,102,0.14)' },
}

function RankBadge(props: { rank: number }): JSX.Element {
  const medal = MEDAL[props.rank]
  if (!medal) {
    return <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{props.rank + 1}</span>
  }
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 22, borderRadius: '50%',
        background: medal.bg, color: medal.ink, border: `1px solid ${medal.ring}`,
        fontSize: 11, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
      }}
    >
      {props.rank + 1}
    </span>
  )
}

function Leaderboard(props: { rows: LeaderRowView[]; tab: StatTab }): JSX.Element {
  const { rows, tab } = props
  const top10 = rows.slice(0, 10)

  return (
    <div className="table-wrap">
      <table className="table">
        <LeaderHeader tab={tab} />
        <tbody className="stagger">
          {top10.map((row, i) => (
            <tr key={row.playerId} className={i < 3 ? 'leader-row' : undefined}>
              <td><RankBadge rank={i} /></td>
              <td>
                <span className="row" style={{ gap: 'var(--sp-2)' }}>
                  <span className="muted" style={{ fontSize: 11, minWidth: 26 }}>{row.position}</span>
                  <PlayerLink playerId={row.playerId} name={row.name} />
                </span>
              </td>
              <td className="muted">{row.teamAbbr}</td>
              <td className="num">{row.gamesPlayed}</td>
              <td className="num">
                <strong style={i === 0 ? { color: 'var(--amber)' } : undefined}>{formatValue(row.value, tab)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
