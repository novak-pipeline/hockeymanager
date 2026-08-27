/**
 * Shared progress table — players' season ability/ceiling change with trend
 * arrows. Used by the Development Center (U23) and the Squad Planner (whole
 * roster) "Progress" tabs.
 */
import type { ProgressRowView } from '../../engine/career/progressView'
import { overallToStars } from '@engine/ratings/composites'
import { PlayerLink } from './NavContext'
import { SortHeaders, sortColumns, useTableSort } from './sortable'

const PROGRESS_COLS = sortColumns<ProgressRowView>()([
  { key: 'name', label: 'Player', value: (r) => r.name, style: { textAlign: 'left' } },
  { key: 'position', label: 'Pos', value: (r) => r.position },
  { key: 'age', label: 'Age', value: (r) => r.age, initialDir: 'asc' },
  { key: 'overall', label: 'Ability', value: (r) => r.overall },
  { key: 'overallDelta', label: 'Δ', value: (r) => r.overallDelta, title: 'Season-to-date ability change' },
  { key: 'potential', label: 'Potential', value: (r) => r.potential },
  { key: 'potentialDelta', label: 'Δ', value: (r) => r.potentialDelta, title: 'Season-to-date ceiling change' },
])

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
  const { sorted, sortKey, dir, sortBy } = useTableSort(rows, PROGRESS_COLS, { key: null })
  if (rows.length === 0) {
    return <div className="muted small">No progress to show yet — it builds as the season is played.</div>
  }
  return (
    <table className="data-table" style={{ width: '100%' }}>
      <thead>
        <tr>
          <SortHeaders columns={PROGRESS_COLS} sortKey={sortKey} dir={dir} onSort={sortBy} />
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
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
