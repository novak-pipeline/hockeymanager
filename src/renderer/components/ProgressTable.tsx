/**
 * Shared progress table — players' season ability/ceiling change with trend
 * arrows. Used by the Development Center (U23) and the Squad Planner (whole
 * roster) "Progress" tabs.
 */
import type { ProgressRowView } from '../../engine/career/progressView'
import { overallToStars } from '@engine/ratings/composites'
import { PlayerLink } from './NavContext'

/** Star string from a 0–100 rating — we never surface the raw number to the GM. */
function starStr(overall: number): string {
  const s = overallToStars(overall) // 0.5–5 in half steps
  const full = Math.floor(s)
  const half = s - full >= 0.5
  return '★'.repeat(full) + (half ? '½' : '') || '½'
}

/** Trend arrow only — no numeric magnitude (ability/potential values stay hidden). */
function Delta({ value, trend }: { value: number; trend: 'up' | 'down' | 'steady' }): JSX.Element {
  const up = value > 0 || (value === 0 && trend === 'up')
  const down = value < 0 || (value === 0 && trend === 'down')
  if (!up && !down) return <span className="muted" style={{ fontSize: 11 }}>—</span>
  return (
    <span style={{ color: up ? 'var(--success, #4caf72)' : 'var(--danger, #d8584f)', fontWeight: 700, fontSize: 12 }}>
      {up ? '▲' : '▼'}
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
            <td style={{ textAlign: 'center', fontWeight: 700, letterSpacing: -1 }}>{starStr(r.overall)}</td>
            <td style={{ textAlign: 'center' }}><Delta value={r.overallDelta} trend={r.overallTrend} /></td>
            <td style={{ textAlign: 'center', color: 'var(--violet-h)', fontWeight: 700, letterSpacing: -1 }}>{starStr(r.potential)}</td>
            <td style={{ textAlign: 'center' }}><Delta value={r.potentialDelta} trend={r.potentialTrend} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
