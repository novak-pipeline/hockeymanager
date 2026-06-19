/**
 * DevelopmentScreen — FM-style Development Center: the org's young / high-upside
 * players across the NHL roster and the AHL affiliate, with a current/potential
 * star read, projection tier and a plain-English development note. Read-only.
 */
import { useState } from 'react'
import type { DevelopmentCenterView, DevelopmentRow } from '../../worker/protocol'
import { PlayerLink } from '../components/NavContext'
import { PlayerFace } from '../components/PlayerFace'
import { ProgressTable } from '../components/ProgressTable'
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

function RosterAdviceLine({ m }: { m: DevelopmentCenterView['rosterAdvice']['callUps'][number] }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', borderTop: '1px solid var(--line)' }}>
      <PlayerFace faceId={m.faceId} name={m.name} size={20} />
      <PlayerLink playerId={m.playerId} name={m.name} />
      <span className="muted small">{m.position}</span>
      <Stars value={m.currentStars} muted />
      <span className="muted small" style={{ marginLeft: 'auto', fontStyle: 'italic' }}>{m.reason}</span>
    </div>
  )
}

export function DevelopmentScreen(props: { teamId?: string } = {}): JSX.Element {
  const client = useClient()
  // User-club scoped; teamId accepted for future per-team use.
  void props.teamId
  const { data, loading, error } = useScreenData<DevelopmentCenterView>(
    () => client.getDevelopment(),
    (r) => (r.type === 'development' ? r.development : null)
  )

  const [tab, setTab] = useState<'prospects' | 'system' | 'progress'>('prospects')
  const [adviceOpen, setAdviceOpen] = useState(false)

  if (error) return <Notice kind="warn">{error}</Notice>
  if (loading && !data) return <Notice kind="info">Loading development centre…</Notice>
  if (!data) return <Notice kind="info">No development data.</Notice>
  const d = data
  const adviceCount = d.rosterAdvice.callUps.length + d.rosterAdvice.sendDowns.length

  return (
    <section className="stack">
      <ScreenHeader title="Development Center">
        <span className="muted small">
          {d.count} prospects tracked · {d.highCeiling} high-ceiling
        </span>
      </ScreenHeader>

      {/* Ask the coach to set the NHL roster — reveals his recommended moves. */}
      <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'center' }}>
        <button type="button" className="btn btn-sm" onClick={() => setAdviceOpen((v) => !v)}>
          {adviceOpen ? 'Hide roster advice' : 'Ask coach to set roster'}
        </button>
        <span className="muted small">
          {adviceCount === 0 ? 'Your coach is happy with the NHL roster as set.' : `Coach suggests ${adviceCount} move${adviceCount === 1 ? '' : 's'}.`}
        </span>
      </div>

      {adviceOpen && (
        <Panel title="Coach's Roster Recommendation">
          {adviceCount === 0 ? (
            <div className="muted small">The best 23 are already up — no call-ups or send-downs recommended.</div>
          ) : (
            <div className="grid grid-2" style={{ gap: 'var(--sp-4)' }}>
              <div>
                <div className="field-label" style={{ color: 'var(--success)' }}>Call up to NHL</div>
                {d.rosterAdvice.callUps.length === 0 ? (
                  <div className="muted small" style={{ marginTop: 4 }}>None.</div>
                ) : d.rosterAdvice.callUps.map((m) => (
                  <RosterAdviceLine key={m.playerId} m={m} />
                ))}
              </div>
              <div>
                <div className="field-label" style={{ color: 'var(--accent2, #e0b341)' }}>Send down to AHL</div>
                {d.rosterAdvice.sendDowns.length === 0 ? (
                  <div className="muted small" style={{ marginTop: 4 }}>None.</div>
                ) : d.rosterAdvice.sendDowns.map((m) => (
                  <RosterAdviceLine key={m.playerId} m={m} />
                ))}
              </div>
            </div>
          )}
          <div className="muted" style={{ fontSize: 10.5, marginTop: 8, fontStyle: 'italic' }}>
            Advice only — make the moves yourself on the Squad screen (call-up / send-down).
          </div>
        </Panel>
      )}

      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <button type="button" className={`btn btn-sm${tab === 'prospects' ? ' btn-primary' : ''}`} onClick={() => setTab('prospects')}>Prospects</button>
        <button type="button" className={`btn btn-sm${tab === 'system' ? ' btn-primary' : ''}`} onClick={() => setTab('system')}>In Your System ({d.systemElsewhere.length})</button>
        <button type="button" className={`btn btn-sm${tab === 'progress' ? ' btn-primary' : ''}`} onClick={() => setTab('progress')}>U23 Progress</button>
      </div>

      {tab === 'progress' && (
        <Panel title="U23 Progress — season ability & ceiling change">
          <div className="muted small" style={{ marginBottom: 8 }}>
            How your under-23 organisation players have developed this season (biggest risers first).
          </div>
          <ProgressTable rows={d.progress} />
        </Panel>
      )}

      {tab === 'prospects' && (
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
                  <td style={{ color: tierColor(r.tier), fontWeight: 600, fontSize: 12 }}>{r.projection}</td>
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
      )}

      {tab === 'system' && (
      <Panel title="In Your System — rights held, playing elsewhere">
        <div className="muted small" style={{ marginBottom: 8 }}>
          Players whose NHL rights your club holds but who skate outside your NHL/AHL rosters — juniors,
          college, or Europe. They join the farm as they turn pro.
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Player</th>
                <th className="num">Pos</th>
                <th className="num">Age</th>
                <th>Club</th>
                <th>Current</th>
                <th>Potential</th>
                <th>Projection</th>
                <th>Development</th>
              </tr>
            </thead>
            <tbody>
              {d.systemElsewhere.map((r) => (
                <tr key={r.playerId}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <PlayerFace faceId={r.faceId} name={r.name} size={22} />
                      <PlayerLink playerId={r.playerId} name={r.name} />
                    </span>
                  </td>
                  <td className="num muted">{r.position}</td>
                  <td className="num muted">{r.age}</td>
                  <td className="muted small">{r.clubAbbrev ?? '—'}</td>
                  <td><Stars value={r.currentStars} muted /></td>
                  <td><Stars value={r.potentialStars} /></td>
                  <td style={{ color: tierColor(r.tier), fontWeight: 600, fontSize: 12 }}>{r.projection}</td>
                  <td className="small muted">{r.note}</td>
                </tr>
              ))}
              {d.systemElsewhere.length === 0 && (
                <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 'var(--sp-4)' }}>No rights-held players outside your NHL/AHL rosters yet — they'll appear here as you draft.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      )}
    </section>
  )
}
