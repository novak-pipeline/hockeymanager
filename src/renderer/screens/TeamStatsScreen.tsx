/**
 * TeamStatsScreen — Team > Statistics tab.
 *
 * Shows the selected team's own players' season stats:
 * - Skaters: GP / G / A / P / +/- / PIM / SOG / TOI
 * - Goalies: GP / W / L / SV% / GAA / SO
 *
 * Sortable by column; player names link to their profile.
 */
import { useState } from 'react'
import type { TeamPlayerStatsView, TeamPlayerStatRow } from '../../worker/protocol'
import { PlayerLink } from '../components/NavContext'
import { Notice, Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

/* ── sort helpers ── */

type SkaterSort = 'name' | 'gp' | 'g' | 'a' | 'p' | 'pm' | 'pim' | 'sog' | 'toi'
type GoalieSort = 'name' | 'gp' | 'w' | 'l' | 'svpct' | 'gaa' | 'so'

function fmtToi(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtSvPct(v: number): string {
  if (v === 0) return '.000'
  return v.toFixed(3).replace(/^0/, '')
}

/* ── skaters table ── */

interface SkaterTableProps {
  rows: TeamPlayerStatRow[]
}

function SkaterTable({ rows }: SkaterTableProps): JSX.Element {
  const [sort, setSort] = useState<SkaterSort>('p')
  const [asc, setAsc] = useState(false)

  function toggle(col: SkaterSort): void {
    if (sort === col) setAsc((a) => !a)
    else { setSort(col); setAsc(false) }
  }

  const sorted = [...rows].sort((a, b) => {
    const s = a.skater
    const t = b.skater
    let diff = 0
    if (sort === 'name') diff = a.name.localeCompare(b.name)
    else if (sort === 'gp') diff = (s?.gamesPlayed ?? 0) - (t?.gamesPlayed ?? 0)
    else if (sort === 'g') diff = (s?.goals ?? 0) - (t?.goals ?? 0)
    else if (sort === 'a') diff = (s?.assists ?? 0) - (t?.assists ?? 0)
    else if (sort === 'p') diff = (s?.points ?? 0) - (t?.points ?? 0)
    else if (sort === 'pm') diff = (s?.plusMinus ?? 0) - (t?.plusMinus ?? 0)
    else if (sort === 'pim') diff = (s?.penaltyMinutes ?? 0) - (t?.penaltyMinutes ?? 0)
    else if (sort === 'sog') diff = (s?.shots ?? 0) - (t?.shots ?? 0)
    else if (sort === 'toi') diff = (s?.toiPerGame ?? 0) - (t?.toiPerGame ?? 0)
    return asc ? diff : -diff
  })

  function th(label: string, col: SkaterSort, numeric = true): JSX.Element {
    const active = sort === col
    return (
      <th
        className={numeric ? 'num' : ''}
        style={{ cursor: 'pointer', userSelect: 'none', color: active ? 'var(--accent)' : undefined }}
        onClick={() => toggle(col)}
      >
        {label}{active ? (asc ? ' ▲' : ' ▼') : ''}
      </th>
    )
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {th('Player', 'name', false)}
            <th className="num muted" style={{ fontSize: 11 }}>Pos</th>
            {th('GP', 'gp')}
            {th('G', 'g')}
            {th('A', 'a')}
            {th('P', 'p')}
            {th('+/-', 'pm')}
            {th('PIM', 'pim')}
            {th('SOG', 'sog')}
            {th('TOI', 'toi')}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const s = row.skater
            return (
              <tr key={row.playerId}>
                <td><PlayerLink playerId={row.playerId} name={row.name} /></td>
                <td className="num muted" style={{ fontSize: 11 }}>{row.position}</td>
                <td className="num">{s?.gamesPlayed ?? 0}</td>
                <td className="num">{s?.goals ?? 0}</td>
                <td className="num">{s?.assists ?? 0}</td>
                <td className="num"><strong>{s?.points ?? 0}</strong></td>
                <td className="num" style={{ color: (s?.plusMinus ?? 0) > 0 ? 'var(--success)' : (s?.plusMinus ?? 0) < 0 ? 'var(--danger)' : undefined }}>
                  {(s?.plusMinus ?? 0) > 0 ? `+${s!.plusMinus}` : s?.plusMinus ?? 0}
                </td>
                <td className="num">{s?.penaltyMinutes ?? 0}</td>
                <td className="num">{s?.shots ?? 0}</td>
                <td className="num">{fmtToi(s?.toiPerGame ?? 0)}</td>
              </tr>
            )
          })}
          {sorted.length === 0 && (
            <tr><td colSpan={10} className="muted">No skaters on roster.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

/* ── goalies table ── */

interface GoalieTableProps {
  rows: TeamPlayerStatRow[]
}

function GoalieTable({ rows }: GoalieTableProps): JSX.Element {
  const [sort, setSort] = useState<GoalieSort>('gp')
  const [asc, setAsc] = useState(false)

  function toggle(col: GoalieSort): void {
    if (sort === col) setAsc((a) => !a)
    else { setSort(col); setAsc(col === 'gaa') }
  }

  const sorted = [...rows].sort((a, b) => {
    const g = a.goalie
    const h = b.goalie
    let diff = 0
    if (sort === 'name') diff = a.name.localeCompare(b.name)
    else if (sort === 'gp') diff = (g?.gamesPlayed ?? 0) - (h?.gamesPlayed ?? 0)
    else if (sort === 'w') diff = (g?.wins ?? 0) - (h?.wins ?? 0)
    else if (sort === 'l') diff = (g?.losses ?? 0) - (h?.losses ?? 0)
    else if (sort === 'svpct') diff = (g?.savePct ?? 0) - (h?.savePct ?? 0)
    else if (sort === 'gaa') diff = (g?.goalsAgainstAverage ?? 0) - (h?.goalsAgainstAverage ?? 0)
    else if (sort === 'so') diff = (g?.shutouts ?? 0) - (h?.shutouts ?? 0)
    return asc ? diff : -diff
  })

  function th(label: string, col: GoalieSort, numeric = true): JSX.Element {
    const active = sort === col
    return (
      <th
        className={numeric ? 'num' : ''}
        style={{ cursor: 'pointer', userSelect: 'none', color: active ? 'var(--accent)' : undefined }}
        onClick={() => toggle(col)}
      >
        {label}{active ? (asc ? ' ▲' : ' ▼') : ''}
      </th>
    )
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {th('Goalie', 'name', false)}
            {th('GP', 'gp')}
            {th('W', 'w')}
            {th('L', 'l')}
            {th('SV%', 'svpct')}
            {th('GAA', 'gaa')}
            {th('SO', 'so')}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const g = row.goalie
            return (
              <tr key={row.playerId}>
                <td><PlayerLink playerId={row.playerId} name={row.name} /></td>
                <td className="num">{g?.gamesPlayed ?? 0}</td>
                <td className="num">{g?.wins ?? 0}</td>
                <td className="num">{g?.losses ?? 0}</td>
                <td className="num">{fmtSvPct(g?.savePct ?? 0)}</td>
                <td className="num">{(g?.goalsAgainstAverage ?? 0).toFixed(2)}</td>
                <td className="num">{g?.shutouts ?? 0}</td>
              </tr>
            )
          })}
          {sorted.length === 0 && (
            <tr><td colSpan={7} className="muted">No goalies on roster.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

/* ── root export ── */

export function TeamStatsScreen(props: { teamId: string }): JSX.Element {
  const { teamId } = props
  const client = useClient()
  const { data, loading, error } = useScreenData<TeamPlayerStatsView>(
    () => client.getTeamPlayerStats(teamId),
    (r) => (r.type === 'teamPlayerStats' ? r.stats : null)
  )

  return (
    <section className="stack">
      <ScreenHeader title="Team Statistics" />
      <ScreenStateNotices
        loading={loading && !data}
        error={error}
        empty={!loading && !error && !data}
        emptyText="No stats yet."
      />
      {data && (
        <>
          {data.skaters.length === 0 && data.goalies.length === 0 && (
            <Notice kind="info">No season statistics yet — play some games first.</Notice>
          )}
          {data.skaters.length > 0 && (
            <Panel title="Skaters">
              <SkaterTable rows={data.skaters} />
            </Panel>
          )}
          {data.goalies.length > 0 && (
            <Panel title="Goalies">
              <GoalieTable rows={data.goalies} />
            </Panel>
          )}
        </>
      )}
    </section>
  )
}
