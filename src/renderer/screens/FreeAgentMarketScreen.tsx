/**
 * The Free Agents tab (DEPTH 2) — the open market as its own destination,
 * like Scouting: filter chips, name search, shortlist stars, two-way interest
 * reads, honest decision clocks, and every row opens the negotiation room.
 * Lives in the sidebar year-round; outside the July window it shows what the
 * market IS (empty or leftovers) instead of pretending it doesn't exist.
 */
import { useState } from 'react'
import type { FinanceView } from '../../worker/protocol'
import { PlayerLink, useNav } from '../components/NavContext'
import { Notice, Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { fmtMoney } from '../components/format'
import { OverallStars } from '../components/Stars'
import { useClient, useScreenData } from '../hooks/useSim'
import { toast } from '../components/store'

const INTEREST_META: Record<'keen' | 'warm' | 'cold', { label: string; color: string }> = {
  keen: { label: 'Keen', color: 'var(--success, #4caf7d)' },
  warm: { label: 'Warm', color: 'var(--amber, #d6a056)' },
  cold: { label: 'Cold', color: 'var(--muted)' },
}

function CapLine({ finance }: { finance: FinanceView | null }): JSX.Element | null {
  if (!finance) return null
  const pct = Math.min(100, (finance.capUsed / finance.salaryCap) * 100)
  const over = finance.capUsed > finance.salaryCap
  return (
    <div>
      <div className="row-between small" style={{ marginBottom: 3 }}>
        <span className="muted">Cap space</span>
        <span className="mono" style={{ color: over ? 'var(--danger)' : undefined }}>
          {fmtMoney(finance.salaryCap - finance.capUsed)} / {fmtMoney(finance.salaryCap)}
        </span>
      </div>
      <div style={{ height: 5, background: 'var(--bg0)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: over ? 'var(--danger)' : 'rgb(var(--accent-rgb, 108,92,231))' }} />
      </div>
    </div>
  )
}

export function FreeAgentMarketScreen(): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const [posFilter, setPosFilter] = useState<'all' | 'F' | 'D' | 'G' | 'starred'>('all')
  const [search, setSearch] = useState('')

  const { data: hub, loading, error, refetch: refetchHub } = useScreenData(
    () => client.getFaHub(),
    (r) => (r.type === 'faHub' ? r.faHub : null)
  )
  const { data: finance } = useScreenData<FinanceView>(
    () => client.getFinances(),
    (r) => (r.type === 'finances' ? r.finances : null)
  )

  const rows = (hub?.rows ?? []).filter((r) => {
    if (posFilter === 'starred' && !r.shortlisted) return false
    if (posFilter === 'F' && (r.position === 'D' || r.position === 'G')) return false
    if (posFilter === 'D' && r.position !== 'D') return false
    if (posFilter === 'G' && r.position !== 'G') return false
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const star = async (playerId: string): Promise<void> => {
    const r = await client.toggleFaShortlist(playerId)
    if (r.type === 'error') toast(r.message, 'error')
    else refetchHub()
  }

  return (
    <section className="stack">
      <ScreenHeader title="Free Agents">
        <span className="muted small">The open market — every talk starts with his agent</span>
      </ScreenHeader>
      <ScreenStateNotices loading={loading && !hub} error={error} empty={false} emptyText="" />

      <CapLine finance={finance ?? null} />

      {(hub?.rows ?? []).length === 0 ? (
        <Panel title="The open market">
          <Notice kind="info">
            The board is momentarily clear — the league's unsigned depth has all found homes.
            More names hit the market as clubs make cuts and clear cap space.
          </Notice>
        </Panel>
      ) : (
        <Panel title={`The open market — ${hub?.rows.length ?? 0} available`}>
          {/* triage bar */}
          <div className="row" style={{ gap: 6, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {(['all', 'F', 'D', 'G', 'starred'] as const).map((f) => (
              <button
                key={f}
                className={`chip${posFilter === f ? ' chip-accent' : ''}`}
                style={{ cursor: 'pointer', border: 'none', fontSize: 11 }}
                onClick={() => setPosFilter(f)}
              >
                {f === 'all' ? 'All' : f === 'starred' ? '★ Shortlist' : f === 'F' ? 'Forwards' : f === 'D' ? 'Defense' : 'Goalies'}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <input
              className="input"
              placeholder="Search name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 180, padding: '4px 10px', fontSize: 12 }}
            />
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 26 }} />
                  <th>Player</th>
                  <th>Pos / Age</th>
                  <th className="num">OVR</th>
                  <th>Their ask</th>
                  <th>Agent</th>
                  <th>His interest in you</th>
                  <th>Clock</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((fa) => {
                  const im = INTEREST_META[fa.interest]
                  const capTight = fa.askSalary > (hub?.capSpace ?? 0)
                  return (
                    <tr key={fa.playerId} style={fa.shortlisted ? { background: 'rgba(var(--accent-rgb, 108,92,231), 0.06)' } : undefined}>
                      <td>
                        <button
                          title={fa.shortlisted ? 'Remove from shortlist' : 'Track this player — you get told if someone signs him'}
                          onClick={() => void star(fa.playerId)}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, padding: 0,
                            color: fa.shortlisted ? 'var(--amber, #d6a056)' : 'var(--line)',
                          }}
                        >
                          ★
                        </button>
                      </td>
                      <td>
                        <PlayerLink playerId={fa.playerId} name={fa.name} />
                        {fa.hot && <span className="chip chip-danger" style={{ fontSize: 9, marginLeft: 6 }} title="Multiple clubs circling — he negotiates from strength">HOT</span>}
                        {fa.inTalks && <span className="chip chip-violet" style={{ fontSize: 9, marginLeft: 6 }}>in talks</span>}
                      </td>
                      <td style={{ color: 'var(--muted)' }}>{fa.position} · {fa.age}</td>
                      <td className="num"><OverallStars value={fa.overall} /></td>
                      <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        {fmtMoney(fa.askSalary)} × {fa.askYears}yr
                        {capTight && <div style={{ color: 'var(--danger)', fontSize: 10 }}>over your cap</div>}
                      </td>
                      <td className="muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{fa.agentName}</td>
                      <td style={{ fontSize: 11.5, maxWidth: 260 }}>
                        <span style={{ color: im.color, fontWeight: 700 }}>{im.label}</span>
                        <span className="muted" style={{ marginLeft: 6 }} title={fa.wants}>{fa.interestNote}</span>
                        {fa.rivals && fa.rivals.length > 0 && (
                          <div style={{ marginTop: 3, fontSize: 10, color: 'var(--muted)' }}>
                            <span style={{ color: fa.rivals.length >= 3 ? 'var(--danger)' : 'var(--muted)' }}>◦ circling: </span>
                            {fa.rivals.slice(0, 4).join(' · ')}{fa.rivals.length > 4 ? ` +${fa.rivals.length - 4}` : ''}
                          </div>
                        )}
                      </td>
                      <td>
                        {fa.decidesInDays <= 0
                          ? <span className="chip chip-danger" style={{ fontSize: 10 }}>any day</span>
                          : fa.decidesInDays <= 2
                            ? <span className="chip chip-warn" style={{ fontSize: 10 }}>~{fa.decidesInDays}d</span>
                            : <span className="chip" style={{ fontSize: 10 }}>~{fa.decidesInDays}d</span>}
                      </td>
                      <td>
                        <button
                          className="btn btn-primary"
                          style={{ padding: '3px 12px', fontSize: 12, whiteSpace: 'nowrap' }}
                          onClick={() => nav.navigate('negotiation', { playerId: fa.playerId })}
                        >
                          {fa.inTalks ? 'Resume talks →' : 'Open talks →'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={9} className="muted small" style={{ padding: 12 }}>No names match the filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </section>
  )
}
