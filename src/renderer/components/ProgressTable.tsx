/**
 * Shared progress table — players' season ability/ceiling change with trend
 * arrows. Used by the Development Center (U23) and the Squad Planner (whole
 * roster) "Progress" tabs.
 */
import type { ProgressRowView } from '../../engine/career/progressView'
import { PlayerLink } from './NavContext'

function Delta({ value, trend }: { value: number; trend: 'up' | 'down' | 'steady' }): JSX.Element {
  if (value === 0 && trend === 'steady') return <span className="muted" style={{ fontSize: 11 }}>—</span>
  const up = value > 0 || (value === 0 && trend === 'up')
  const color = up ? 'var(--success, #4caf72)' : 'var(--danger, #d8584f)'
  return (
    <span style={{ color, fontWeight: 700, fontSize: 12 }}>
      {up ? '▲' : '▼'}{value !== 0 ? Math.abs(value) : ''}
    </span>
  )
}

export function ProgressTable({ rows }: { rows: ProgressRowView[] }): JSX.Element {
  if (rows.length === 0) {
    return <div className="muted small">No progress to show yet — it builds as the season is played.</div>
  }
  return (
    <table className="data-table" style={{ width: '100%' }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left' }}>Player</th>
          <th>Pos</th><th>Age</th>
          <th>Ability</th>
          <th title="Season-to-date ability change">Δ</th>
          <th>Potential</th>
          <th title="Season-to-date ceiling change">Δ</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.playerId}>
            <td><PlayerLink playerId={r.playerId} name={r.name} /></td>
            <td style={{ textAlign: 'center' }}>{r.position}</td>
            <td style={{ textAlign: 'center' }}>{r.age}</td>
            <td style={{ textAlign: 'center', fontWeight: 700 }}>{r.overall}</td>
            <td style={{ textAlign: 'center' }}><Delta value={r.overallDelta} trend={r.overallTrend} /></td>
            <td style={{ textAlign: 'center', color: 'var(--violet-h)', fontWeight: 700 }}>{r.potential}</td>
            <td style={{ textAlign: 'center' }}><Delta value={r.potentialDelta} trend={r.potentialTrend} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
