import { useState } from 'react'
import type { WaiverWireRowView } from '../../engine/career/views'
import { PlayerLink } from '../components/NavContext'
import { Notice, Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { fmtMoney } from '../components/format'
import { OverallStars } from '../components/Stars'
import { useClient, useScreenData } from '../hooks/useSim'
import { toast } from '../components/store'

function deadlineLabel(days: number): string {
  if (days <= 0) return 'Clears on next sim'
  return `${days} day${days === 1 ? '' : 's'} to claim`
}

function WaiverRow(props: { row: WaiverWireRowView; onRefetch: () => void }): JSX.Element {
  const client = useClient()
  const { row } = props
  const [busy, setBusy] = useState(false)

  const claim = async (): Promise<void> => {
    setBusy(true)
    const r = await client.claimWaiver(row.playerId)
    setBusy(false)
    if (r.type === 'error') toast(r.message, 'error')
    else {
      if (r.type === 'ok' && r.note) toast(r.note, 'success')
      props.onRefetch()
    }
  }

  return (
    <tr>
      <td>
        <PlayerLink playerId={row.playerId} name={row.name} />
        <span className="muted small" style={{ marginLeft: 8 }}>{row.position} · {row.age}</span>
      </td>
      <td className="num"><OverallStars value={row.overall} /></td>
      <td>{row.fromTeamAbbr}</td>
      <td className="num">{fmtMoney(row.salary)}</td>
      <td className="num">{row.yearsRemaining}yr{row.twoWay ? ' · 2-way' : ''}</td>
      <td>
        <span className={row.claimDeadlineInDays <= 0 ? 'chip chip-warn' : 'muted small'}>
          {deadlineLabel(row.claimDeadlineInDays)}
        </span>
      </td>
      <td style={{ textAlign: 'right' }}>
        {row.canClaim ? (
          <button className="btn btn-primary" disabled={busy} onClick={claim}>Claim</button>
        ) : (
          <span className="muted small" title={row.blockReason}>{row.blockReason}</span>
        )}
      </td>
    </tr>
  )
}

export function WaiverWireScreen(): JSX.Element {
  const client = useClient()
  const { data, loading, error, refetch } = useScreenData<WaiverWireRowView[]>(
    () => client.getWaiverWire(),
    (r) => (r.type === 'waiverWire' ? r.waiverWire : null)
  )

  return (
    <section>
      <ScreenHeader title="Waiver Wire" />
      <ScreenStateNotices loading={loading} error={error} />
      {data && (
        <Panel title="Players on waivers">
          <div className="muted small" style={{ marginBottom: 8 }}>
            Rival clubs have exposed these players on waivers. Claim one to add him and his
            contract to your roster — you must have the cap space and a roster spot. If no
            one claims him before the window closes, he clears to his club's AHL affiliate.
          </div>
          {data.length === 0 ? (
            <Notice kind="info">No players are on the waiver wire right now. Check back as the season rolls on.</Notice>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th className="num">OVR</th>
                    <th>From</th>
                    <th className="num">Salary</th>
                    <th className="num">Term</th>
                    <th>Window</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.map((row) => (
                    <WaiverRow key={row.playerId} row={row} onRefetch={refetch} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </section>
  )
}
