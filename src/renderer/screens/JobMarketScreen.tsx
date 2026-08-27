/**
 * Job Market — hire staff from the open market: head coaches (with roster-fit
 * preview) and scouts. Firing the head coach installs an interim until you hire.
 */
import type { ScoutingView, CoachMarketView } from '../../worker/protocol'
import type { ScoutMarketRow } from '../../engine/career/views'
import { fmtMoney } from '../components/format'
import { FlagIcon } from '../components/FlagIcon'
import { PlayerFace } from '../components/PlayerFace'
import { Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'
import { toast, bumpRefresh } from '../components/store'

function fitColor(fit: number): string {
  if (fit >= 78) return 'var(--success)'
  if (fit >= 66) return 'var(--accent, #f5b301)'
  if (fit >= 55) return 'var(--amber, #f59e0b)'
  return 'var(--danger)'
}

function CoachMarketPanel({
  market, busy, onFire, onHire,
}: {
  market: CoachMarketView
  busy: boolean
  onFire: () => void
  onHire: (coachId: string) => void
}): JSX.Element {
  return (
    <Panel title="Head Coaches for Hire">
      <div
        className="row-between"
        style={{
          gap: 'var(--sp-3)', alignItems: 'center', marginBottom: 'var(--sp-3)',
          padding: 'var(--sp-2) var(--sp-3)', background: 'var(--bg2)', borderRadius: 'var(--radius-sm)',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Current head coach</div>
          <div style={{ fontWeight: 700 }}>{market.currentCoachName}</div>
          <div className="small">
            <span style={{ color: 'var(--accent)' }}>{market.currentSystemLabel}</span>
            <span className="muted"> · roster fit </span>
            <span style={{ color: fitColor(market.currentRosterFit), fontWeight: 700 }}>{market.currentRosterFit}/100</span>
          </div>
        </div>
        <button className="btn btn-sm" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} disabled={busy} onClick={onFire}>
          Fire coach
        </button>
      </div>

      <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Coach</th><th>System</th><th className="num">Ability</th><th className="num">Roster fit</th><th></th>
            </tr>
          </thead>
          <tbody>
            {market.entries.map((c) => (
              <tr key={c.coachId}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <PlayerFace faceId={c.faceId} name={c.name} size={24} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{c.name}</div>
                      <div className="muted small" style={{ textTransform: 'capitalize' }}>{c.demeanor}</div>
                    </div>
                  </div>
                </td>
                <td className="small">
                  <div style={{ fontWeight: 600 }}>{c.systemLabel}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{c.fitBlurb}</div>
                </td>
                <td className="num">{c.rating}</td>
                <td className="num" style={{ color: fitColor(c.rosterFit), fontWeight: 700 }}>
                  {c.fitLabel} · {c.rosterFit}
                </td>
                <td className="num">
                  <button className="btn btn-ghost small" disabled={busy} onClick={() => onHire(c.coachId)}>Hire</button>
                </td>
              </tr>
            ))}
            {market.entries.length === 0 && (
              <tr><td colSpan={5} className="muted small">No coaches available right now.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function ScoutMarketTable({ rows, full, onHire }: {
  rows: ScoutMarketRow[]
  full: boolean
  onHire: (candidateId: string) => void
}): JSX.Element {
  if (rows.length === 0) {
    return <p className="muted small">No scouts available to hire right now.</p>
  }
  return (
    <div className="table-wrap" style={{ maxHeight: 480, overflowY: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th>Scout</th><th>Specialty</th><th className="num">Ability</th><th className="num">Judgment</th><th className="num">Salary</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td style={{ fontWeight: 600 }}>{c.name}</td>
              <td className="small">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  {c.specialtyNation && <FlagIcon nationality={c.specialtyNation} size={13} />}
                  {c.specialtyNation ?? 'Generalist'}
                </span>
              </td>
              <td className="num">{c.rating}</td>
              <td className="num muted">{c.judgment}</td>
              <td className="num small">{fmtMoney(c.salary)}/yr</td>
              <td className="num">
                <button className="btn btn-ghost small" disabled={full} onClick={() => onHire(c.id)}>Hire</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function JobMarketScreen(): JSX.Element {
  const client = useClient()
  const { data, loading, error, refetch } = useScreenData<ScoutingView>(
    () => client.getScouting(),
    (r) => (r.type === 'scouting' ? r.scouting : null)
  )
  const { data: coachMarket, loading: coachLoading, refetch: refetchCoaches } = useScreenData<CoachMarketView>(
    () => client.getCoachMarket(),
    (r) => (r.type === 'coachMarket' ? r.market : null)
  )

  const handleHire = async (candidateId: string): Promise<void> => {
    const res = await client.hireScout(candidateId)
    if (res.type === 'error') { toast(res.message, 'error') } else { toast('Scout hired', 'success'); bumpRefresh(); refetch() }
  }

  const handleFireCoach = async (): Promise<void> => {
    const res = await client.fireCoach()
    if (res.type === 'coachHireResult') { toast(res.message, res.ok ? 'info' : 'error'); bumpRefresh(); refetchCoaches() }
    else if (res.type === 'error') toast(res.message, 'error')
  }

  const handleHireCoach = async (coachId: string): Promise<void> => {
    const res = await client.hireCoach(coachId)
    if (res.type === 'coachHireResult') { toast(res.message, res.ok ? 'success' : 'error'); bumpRefresh(); refetchCoaches() }
    else if (res.type === 'error') toast(res.message, 'error')
  }

  const full = !!data && data.scouts.length >= data.maxScouts

  return (
    <section className="stack">
      <ScreenHeader title="Job Market" />

      {coachMarket && (
        <CoachMarketPanel
          market={coachMarket}
          busy={coachLoading}
          onFire={() => { void handleFireCoach() }}
          onHire={(id) => { void handleHireCoach(id) }}
        />
      )}

      <ScreenStateNotices loading={loading} error={error} empty={!data} emptyText="No market data." />
      {data && (
        <Panel title={`Scouts for Hire (${data.scouts.length}/${data.maxScouts} employed)`}>
          {full && <p className="muted small" style={{ marginBottom: 8 }}>Your scouting department is full — release a scout (from the Scouting screen) to hire another.</p>}
          <ScoutMarketTable rows={data.scoutMarket} full={full} onHire={(id) => { void handleHire(id) }} />
        </Panel>
      )}
    </section>
  )
}
