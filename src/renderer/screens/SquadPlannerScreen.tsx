/**
 * SquadPlannerScreen — FM-style Squad Planner: an Experience Matrix (position
 * group × career stage) plus a Squad Report (depth verdicts, age profile and a
 * plain-English summary). Read-only.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SquadPlannerView, PlannerPlayer, PositionDepth, RoleBoardView } from '../../worker/protocol'
import type { RoleBoardRow } from '../../engine/career/views'
import type { SquadStatus } from '../../domain/player'
import { PlayerLink } from '../components/NavContext'
import { PlayerFace } from '../components/PlayerFace'
import { OverallStars } from '../components/Stars'
import { ProgressTable } from '../components/ProgressTable'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'
import { toast } from '../components/store'

// #188 roles tab: fixed display order for the squad-status dropdown.
const ROLE_ORDER: SquadStatus[] = ['keyPlayer', 'coreStarter', 'rotation', 'topProspect', 'prospect', 'surplus']

/** Bulk squad-role board — set every player's role here instead of right-clicking
 *  each one. Auto-seeds sensible roles on first open. */
function RolesTab(): JSX.Element {
  const client = useClient()
  const [view, setView] = useState<RoleBoardView | null>(null)
  const [busy, setBusy] = useState(false)
  const seeded = useRef(false)

  const apply = useCallback((r: { type: string; roleBoard?: RoleBoardView }) => {
    if (r.type === 'roleBoard' && r.roleBoard) setView(r.roleBoard)
  }, [])

  const load = useCallback(async () => {
    const r = await client.getRoleBoard()
    if (r.type === 'roleBoard') {
      // Auto-assign roles the first time the tab opens on an unconfigured squad,
      // so the board "begins with" sensible roles the GM can then tweak.
      if (!seeded.current && r.roleBoard.unassigned === r.roleBoard.rows.length && r.roleBoard.rows.length > 0) {
        seeded.current = true
        apply(await client.autoAssignSquadRoles(false))
      } else {
        setView(r.roleBoard)
      }
    }
  }, [client, apply])
  useEffect(() => { void load() }, [load])

  async function setRole(playerId: string, status: SquadStatus | null): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      await client.setSquadStatus(playerId, status)
      apply(await client.getRoleBoard())
    } finally { setBusy(false) }
  }
  async function autoAssign(overwrite: boolean): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const r = await client.autoAssignSquadRoles(overwrite)
      apply(r)
      if (r.type === 'roleBoard') toast(`Assigned ${r.assigned ?? 0} role${r.assigned === 1 ? '' : 's'}.`, 'success')
    } finally { setBusy(false) }
  }

  if (!view) return <Notice kind="info">Loading roles…</Notice>

  const Row = ({ r }: { r: RoleBoardRow }): JSX.Element => {
    const mismatch = r.squadStatus !== undefined && r.squadStatus !== r.suggested
    return (
      <tr>
        <td>
          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            <PlayerFace faceId={r.faceId} name={r.name} size={24} />
            <PlayerLink playerId={r.playerId} name={r.name} />
            {!r.onNhl && <span className="chip" style={{ fontSize: 9 }}>AHL</span>}
          </div>
        </td>
        <td className="muted">{r.position}</td>
        <td className="num muted">{r.age}</td>
        <td className="num"><OverallStars value={r.overall} /></td>
        <td>
          <select className="select" style={{ fontSize: 12 }} value={r.squadStatus ?? ''} disabled={busy}
            onChange={(e) => void setRole(r.playerId, e.target.value === '' ? null : (e.target.value as SquadStatus))}>
            <option value="">— Unassigned —</option>
            {ROLE_ORDER.map((s) => <option key={s} value={s}>{view.labels[s]}</option>)}
          </select>
        </td>
        <td className="small muted" title="The engine's recommendation from ability, age and depth">
          {view.labels[r.suggested]}
          {mismatch && (
            <button className="btn btn-xs btn-ghost" style={{ marginLeft: 6 }} disabled={busy}
              onClick={() => void setRole(r.playerId, r.suggested)} title="Apply the suggestion">↩</button>
          )}
        </td>
      </tr>
    )
  }

  return (
    <Panel title="Squad Roles">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <div className="muted small">
          Set the role you expect each player to fill — the coach's lineup honours it and morale tracks whether you keep the promise.
          {view.unassigned > 0 && <span style={{ color: 'var(--amber, #f59e0b)', marginLeft: 6 }}>{view.unassigned} unassigned</span>}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm" disabled={busy} onClick={() => void autoAssign(false)}>Auto-assign unset</button>
          <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void autoAssign(true)}>Re-suggest all</button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Player</th><th>Pos</th><th className="num">Age</th><th className="num">Ability</th><th>Role</th><th>Suggested</th></tr>
          </thead>
          <tbody>{view.rows.map((r) => <Row key={r.playerId} r={r} />)}</tbody>
        </table>
      </div>
    </Panel>
  )
}

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

  const [tab, setTab] = useState<'planner' | 'roles' | 'progress'>('planner')

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
        <button type="button" className={`btn btn-sm${tab === 'roles' ? ' btn-primary' : ''}`} onClick={() => setTab('roles')}>Roles</button>
        <button type="button" className={`btn btn-sm${tab === 'progress' ? ' btn-primary' : ''}`} onClick={() => setTab('progress')}>Team Progress</button>
      </div>

      {tab === 'roles' && <RolesTab />}

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
                    <td style={{ color: verdictColor(dp.verdict), fontWeight: 700, fontSize: 12 }}
                      title="Judged on your best players at the position vs every other club — the note spells out the inputs">
                      {dp.verdict}
                    </td>
                    <td className="small muted">
                      {dp.note}
                      {dp.detail && (
                        <div style={{ marginTop: 2, color: 'var(--text)' }}
                          title="NHL-calibre = a dependable everyday NHL player by our staff's read">
                          {dp.detail}
                        </div>
                      )}
                    </td>
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
          <div style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 8 }}>
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
