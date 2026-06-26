/**
 * SquadPlannerScreen — FM-style Squad Planner: an Experience Matrix (position
 * group × career stage) plus a Squad Report (depth verdicts, age profile and a
 * plain-English summary). Read-only.
 */
import { useState } from 'react'
import type { SquadPlannerView, PlannerPlayer, PositionDepth } from '../../worker/protocol'
import { PlayerLink } from '../components/NavContext'
import { ProgressTable } from '../components/ProgressTable'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

function verdictColor(v: PositionDepth['verdict']): string {
  switch (v) {
    case 'Strong': return 'var(--success)'
    case 'Adequate': return 'var(--accent, #f5b301)'
    case 'Thin': return 'var(--amber, #f59e0b)'
    case 'Critical': return 'var(--danger)'
  }
}

function Cell(props: { players: PlannerPlayer[] }): JSX.Element {
  if (props.players.length === 0) return <span className="muted" style={{ opacity: 0.4 }}>—</span>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {props.players.map((p) => (
        <span key={p.playerId} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          <PlayerLink playerId={p.playerId} name={p.name} />
          <span className="muted" style={{ fontSize: 10 }}>{p.age}</span>
          {p.expiring && (
            <span title="Expiring deal" style={{ color: 'var(--amber, #f59e0b)', fontSize: 10 }}>⧗</span>
          )}
        </span>
      ))}
    </div>
  )
}

export function SquadPlannerScreen(props: { teamId?: string } = {}): JSX.Element {
  const client = useClient()
  void props.teamId // user-club scoped
  const { data, loading, error } = useScreenData<SquadPlannerView>(
    () => client.getSquadPlanner(),
    (r) => (r.type === 'squadPlanner' ? r.squadPlanner : null)
  )

  const [tab, setTab] = useState<'planner' | 'progress'>('planner')

  if (error) return <Notice kind="warn">{error}</Notice>
  if (loading && !data) return <Notice kind="info">Loading roster planner…</Notice>
  if (!data) return <Notice kind="info">No roster data.</Notice>
  const d = data
  const maxBand = Math.max(1, ...d.ageProfile.map((b) => b.count))

  return (
    <section className="stack">
      <ScreenHeader title="Roster Planner">
        <span className="muted small">Experience matrix · ⧗ = expiring deal</span>
      </ScreenHeader>

      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <button type="button" className={`btn btn-sm${tab === 'planner' ? ' btn-primary' : ''}`} onClick={() => setTab('planner')}>Planner</button>
        <button type="button" className={`btn btn-sm${tab === 'progress' ? ' btn-primary' : ''}`} onClick={() => setTab('progress')}>Team Progress</button>
      </div>

      {tab === 'progress' && (
        <Panel title="Team Progress — season ability & ceiling change">
          <div className="muted small" style={{ marginBottom: 8 }}>
            How the whole roster has developed this season — risers at the top, sliders at the bottom.
          </div>
          <ProgressTable rows={d.progress} />
        </Panel>
      )}

      {tab === 'planner' && (<>
      <Panel title="Experience Matrix">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Position</th>
                {d.stages.map((s) => <th key={s}>{s}</th>)}
              </tr>
            </thead>
            <tbody>
              {d.matrix.map((row) => (
                <tr key={row.group}>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{row.label}</td>
                  {d.stages.map((s) => (
                    <td key={s} style={{ verticalAlign: 'top' }}><Cell players={row.cells[s]} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid-2">
        <Panel title="Depth Report">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Position</th><th className="num">No.</th><th className="num">League rank</th><th>Verdict</th><th>Note</th></tr>
              </thead>
              <tbody>
                {d.depth.map((dp) => (
                  <tr key={dp.group}>
                    <td>{dp.label}</td>
                    <td className="num muted">{dp.count}</td>
                    <td className="num muted">{dp.rank != null && dp.outOf != null ? `${dp.rank} / ${dp.outOf}` : '—'}</td>
                    <td style={{ color: verdictColor(dp.verdict), fontWeight: 700, fontSize: 12 }}>{dp.verdict}</td>
                    <td className="small muted">{dp.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Age Profile">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 'var(--sp-2)' }}>
            {d.ageProfile.map((b) => (
              <div key={b.band} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="small" style={{ width: 80, textAlign: 'right' }}>{b.band}</span>
                <span className="meter" style={{ flex: 1, height: 10 }}>
                  <span className="meter-fill" style={{ width: `${(b.count / maxBand) * 100}%`, background: 'var(--violet, #8b5cf6)' }} />
                </span>
                <span className="small muted" style={{ width: 20 }}>{b.count}</span>
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
            {d.summary.map((s, i) => (
              <div key={i} className="small muted" style={{ marginBottom: 4 }}>• {s}</div>
            ))}
          </div>
        </Panel>
      </div>
      </>)}
    </section>
  )
}
