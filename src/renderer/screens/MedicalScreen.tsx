/**
 * MedicalScreen — FM-style Medical Center: per-player condition, fatigue,
 * current injury, and an injury-risk band. Read-only.
 */
import type { MedicalView, MedicalRow } from '../../worker/protocol'
import { PlayerLink } from '../components/NavContext'
import { PlayerFace } from '../components/PlayerFace'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

function riskColor(label: MedicalRow['riskLabel']): string {
  if (label === 'High') return 'var(--danger)'
  if (label === 'Increased') return 'var(--amber, #f59e0b)'
  return 'var(--success)'
}

function condColor(c: number): string {
  if (c >= 75) return 'var(--success)'
  if (c >= 50) return 'var(--amber, #f59e0b)'
  return 'var(--danger)'
}

export function MedicalScreen(props: { teamId?: string } = {}): JSX.Element {
  const client = useClient()
  // The getter is user-club scoped; teamId is accepted for future per-team use.
  void props.teamId
  const { data, loading, error } = useScreenData<MedicalView>(
    () => client.getMedical(),
    (r) => (r.type === 'medical' ? r.medical : null)
  )

  if (error) return <Notice kind="warn">{error}</Notice>
  if (loading && !data) return <Notice kind="info">Loading medical centre…</Notice>
  if (!data) return <Notice kind="info">No medical data.</Notice>
  const d = data

  return (
    <section className="stack">
      <ScreenHeader title="Medical Center">
        <span className="muted small">
          {d.injuredCount} injured · {d.rows.filter((r) => r.riskLabel === 'High').length} high-risk
        </span>
      </ScreenHeader>

      <Panel title="Risk Assessment">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Player</th>
                <th className="num">Pos</th>
                <th>Condition</th>
                <th>Status</th>
                <th>Injury Risk</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.playerId}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <PlayerFace faceId={r.faceId} name={r.name} size={22} />
                      <PlayerLink playerId={r.playerId} name={r.name} />
                    </span>
                  </td>
                  <td className="num muted">{r.position}</td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 120 }}>
                      <span className="meter" style={{ flex: 1, height: 6, maxWidth: 90 }}>
                        <span className="meter-fill" style={{ width: `${r.condition}%`, background: condColor(r.condition) }} />
                      </span>
                      <span className="small muted">{r.condition}%</span>
                    </span>
                  </td>
                  <td className="small">
                    {r.injuryDescription
                      ? <span style={{ color: 'var(--danger)' }}>{r.injuryDescription} ({r.injuryGamesRemaining}g)</span>
                      : <span className="muted">Fit</span>}
                  </td>
                  <td style={{ color: riskColor(r.riskLabel), fontWeight: 700, fontSize: 13 }}>{r.riskLabel}</td>
                </tr>
              ))}
              {d.rows.length === 0 && (
                <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 'var(--sp-4)' }}>No players.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </section>
  )
}
