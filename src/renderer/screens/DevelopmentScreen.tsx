/**
 * DevelopmentScreen — FM-style Development Center: the org's young / high-upside
 * players across the NHL roster and the AHL affiliate, with a current/potential
 * star read, projection tier and a plain-English development note. Read-only.
 */
import type { DevelopmentCenterView, DevelopmentRow } from '../../worker/protocol'
import { PlayerLink } from '../components/NavContext'
import { PlayerFace } from '../components/PlayerFace'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

/** Render half-step stars out of 5. */
function Stars(props: { value: number; muted?: boolean }): JSX.Element {
  const full = Math.floor(props.value)
  const half = props.value - full >= 0.5
  const stars = '★'.repeat(full) + (half ? '½' : '')
  return (
    <span
      title={`${props.value} / 5`}
      style={{ color: props.muted ? 'var(--muted)' : 'var(--accent, #f5b301)', letterSpacing: 1, fontSize: 12 }}
    >
      {stars || '–'}
    </span>
  )
}

function tierColor(tier: DevelopmentRow['tier']): string {
  switch (tier) {
    case 'Star':
    case 'Prospect':
      return 'var(--accent, #f5b301)'
    case 'Key':
      return 'var(--violet, #8b5cf6)'
    case 'Core':
      return 'var(--success)'
    default:
      return 'var(--muted)'
  }
}

export function DevelopmentScreen(props: { teamId?: string } = {}): JSX.Element {
  const client = useClient()
  // User-club scoped; teamId accepted for future per-team use.
  void props.teamId
  const { data, loading, error } = useScreenData<DevelopmentCenterView>(
    () => client.getDevelopment(),
    (r) => (r.type === 'development' ? r.development : null)
  )

  if (error) return <Notice kind="warn">{error}</Notice>
  if (loading && !data) return <Notice kind="info">Loading development centre…</Notice>
  if (!data) return <Notice kind="info">No development data.</Notice>
  const d = data

  return (
    <section className="stack">
      <ScreenHeader title="Development Center">
        <span className="muted small">
          {d.count} prospects tracked · {d.highCeiling} high-ceiling
        </span>
      </ScreenHeader>

      <Panel title="Prospects (NHL + Affiliate)">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Player</th>
                <th className="num">Pos</th>
                <th className="num">Age</th>
                <th>Where</th>
                <th>Current</th>
                <th>Potential</th>
                <th>Projection</th>
                <th>Development</th>
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
                  <td className="num muted">{r.age}</td>
                  <td>
                    <span
                      className="chip"
                      style={{ fontSize: 10, background: r.location === 'AHL' ? 'var(--surface-2, #2a2a3a)' : undefined }}
                    >
                      {r.location}
                    </span>
                  </td>
                  <td><Stars value={r.currentStars} muted /></td>
                  <td><Stars value={r.potentialStars} /></td>
                  <td style={{ color: tierColor(r.tier), fontWeight: 600, fontSize: 12 }}>{r.tierLabel}</td>
                  <td className="small muted">{r.note}</td>
                </tr>
              ))}
              {d.rows.length === 0 && (
                <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 'var(--sp-4)' }}>No prospects in the system.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </section>
  )
}
