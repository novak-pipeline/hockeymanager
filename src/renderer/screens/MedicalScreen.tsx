/**
 * MedicalScreen — FM/FBM-style Medical Centre. The injured players are shown
 * with a body diagram that highlights the hurt region in red, plus the injury,
 * games remaining and an estimated return. A risk-assessment table for the full
 * roster sits below. Read-only.
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

type Region = 'head' | 'upper' | 'lower' | 'illness' | null

function regionOf(kind: MedicalRow['injuryKind']): Region {
  switch (kind) {
    case 'concussion': return 'head'
    case 'upperBody': return 'upper'
    case 'lowerBody': return 'lower'
    case 'illness': return 'illness'
    default: return null
  }
}

const HURT = 'var(--danger)'
const BODY = 'var(--surface-3, #3a3a4a)'
const ILL = 'var(--amber, #f59e0b)'

/** Minimal front-facing humanoid silhouette; the injured region glows red. */
function BodyDiagram(props: { region: Region; size?: number }): JSX.Element {
  const { region } = props
  const w = props.size ?? 96
  const h = w * 1.9
  const fill = (r: Exclude<Region, null>): string => {
    if (region === 'illness') return ILL
    return region === r ? HURT : BODY
  }
  const glow = (r: Exclude<Region, null>): { filter?: string } =>
    region === r ? { filter: 'drop-shadow(0 0 4px rgba(239,68,68,0.9))' } : {}

  return (
    <svg viewBox="0 0 100 190" width={w} height={h} aria-hidden>
      {/* head */}
      <circle cx="50" cy="18" r="14" fill={fill('head')} style={glow('head')} />
      {/* torso (upper) */}
      <rect x="33" y="34" width="34" height="52" rx="10" fill={fill('upper')} style={glow('upper')} />
      {/* arms (upper) */}
      <rect x="20" y="38" width="11" height="46" rx="5.5" fill={fill('upper')} style={glow('upper')} />
      <rect x="69" y="38" width="11" height="46" rx="5.5" fill={fill('upper')} style={glow('upper')} />
      {/* hips/legs (lower) */}
      <rect x="35" y="88" width="13" height="64" rx="6.5" fill={fill('lower')} style={glow('lower')} />
      <rect x="52" y="88" width="13" height="64" rx="6.5" fill={fill('lower')} style={glow('lower')} />
      {/* feet */}
      <rect x="34" y="152" width="15" height="9" rx="3" fill={fill('lower')} style={glow('lower')} />
      <rect x="51" y="152" width="15" height="9" rx="3" fill={fill('lower')} style={glow('lower')} />
    </svg>
  )
}

function InjuryCard(props: { row: MedicalRow }): JSX.Element {
  const r = props.row
  const region = regionOf(r.injuryKind)
  const weeks = r.injuryGamesRemaining !== undefined ? Math.max(1, Math.round(r.injuryGamesRemaining / 3)) : null
  return (
    <div
      style={{
        display: 'flex', gap: 14, alignItems: 'center',
        padding: 'var(--sp-3)', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
        background: 'var(--bg1)',
      }}
    >
      <BodyDiagram region={region} size={70} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <PlayerFace faceId={r.faceId} name={r.name} size={24} />
          <PlayerLink playerId={r.playerId} name={r.name} />
          <span className="muted small">· {r.position}</span>
        </div>
        <div style={{ color: HURT, fontWeight: 700, fontSize: 13 }}>
          {r.injuryDescription ?? 'Injured'}
        </div>
        <div className="small muted" style={{ marginTop: 2 }}>
          {r.injuryGamesRemaining ?? '?'} games remaining{weeks ? ` · ~${weeks} wk${weeks === 1 ? '' : 's'}` : ''}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <span className="meter" style={{ flex: 1, height: 6, maxWidth: 120 }}>
            <span className="meter-fill" style={{ width: `${r.condition}%`, background: condColor(r.condition) }} />
          </span>
          <span className="small muted">{r.condition}% fit</span>
        </div>
      </div>
    </div>
  )
}

export function MedicalScreen(props: { teamId?: string } = {}): JSX.Element {
  const client = useClient()
  void props.teamId
  const { data, loading, error } = useScreenData<MedicalView>(
    () => client.getMedical(),
    (r) => (r.type === 'medical' ? r.medical : null)
  )

  if (error) return <Notice kind="warn">{error}</Notice>
  if (loading && !data) return <Notice kind="info">Loading medical centre…</Notice>
  if (!data) return <Notice kind="info">No medical data.</Notice>
  const d = data
  const injured = d.rows.filter((r) => r.injuryDescription)

  return (
    <section className="stack">
      <ScreenHeader title="Medical Center">
        <span className="muted small">
          {d.injuredCount} injured · {d.rows.filter((r) => r.riskLabel === 'High').length} high-risk
        </span>
      </ScreenHeader>

      <Panel title="Treatment Room">
        {injured.length === 0 ? (
          <p className="muted small" style={{ padding: 'var(--sp-2)' }}>
            No players currently injured. A clean bill of health.
          </p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 'var(--sp-3)',
            }}
          >
            {injured.map((r) => <InjuryCard key={r.playerId} row={r} />)}
          </div>
        )}
      </Panel>

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
