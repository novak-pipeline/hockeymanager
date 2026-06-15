/**
 * Job Market — hire staff from the open market. Currently the scout market
 * (moved out of the Scouting screen); structured to grow to coaches/analysts.
 */
import type { ScoutingView } from '../../worker/protocol'
import type { ScoutMarketRow } from '../../engine/career/views'
import { fmtMoney } from '../components/format'
import { FlagIcon } from '../components/FlagIcon'
import { Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'
import { toast, bumpRefresh } from '../components/store'

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

  const handleHire = async (candidateId: string): Promise<void> => {
    const res = await client.hireScout(candidateId)
    if (res.type === 'error') { toast(res.message, 'error') } else { toast('Scout hired', 'success'); bumpRefresh(); refetch() }
  }

  const full = !!data && data.scouts.length >= data.maxScouts

  return (
    <section className="stack">
      <ScreenHeader title="Job Market" />
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
