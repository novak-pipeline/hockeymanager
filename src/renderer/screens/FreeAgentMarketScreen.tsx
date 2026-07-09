/**
 * The Free Agents tab (DEPTH 2) — the open market as its own destination,
 * like Scouting: filter chips, name search, shortlist stars, two-way interest
 * reads, honest decision clocks, and every row opens the negotiation room.
 * Lives in the sidebar year-round; outside the July window it shows what the
 * market IS (empty or leftovers) instead of pretending it doesn't exist.
 */
import { useState } from 'react'
import type { FinanceView } from '../../worker/protocol'
import type { RfaBoardView } from '../../engine/career/views'
import { PlayerLink, useNav } from '../components/NavContext'
import { Notice, Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { fmtMoney } from '../components/format'
import { OverallStars } from '../components/Stars'
import { PlayerFace } from '../components/PlayerFace'
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
  const { data: rfa, refetch: refetchRfa } = useScreenData<RfaBoardView>(
    () => client.getRfaBoard(),
    (r) => (r.type === 'rfaBoard' ? r.board : null)
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

  const askAgent = async (playerId: string): Promise<void> => {
    const r = await client.askFaAgent(playerId)
    if (r.type === 'agentRead') toast(r.text, 'info')
    else if (r.type === 'error') toast(r.message, 'error')
  }

  const offerSheet = async (playerId: string, salary: number, years: number): Promise<void> => {
    const r = await client.submitOfferSheet(playerId, salary, years)
    if (r.type === 'offerSheetResult') {
      toast(r.message, r.ok ? 'success' : r.matched ? 'info' : 'error')
      refetchRfa()
      refetchHub()
    } else if (r.type === 'error') toast(r.message, 'error')
  }

  const tableOffer = async (playerId: string, salary: number, years: number): Promise<void> => {
    const r = await client.submitFaOffer(playerId, salary, years)
    if (r.type === 'faOfferResult') { toast(r.message, r.ok ? 'success' : 'error'); refetchHub() }
    else if (r.type === 'error') toast(r.message, 'error')
  }

  const offseasonFa = hub?.windowOpen ?? false

  return (
    <section className="stack">
      <ScreenHeader title="Free Agents">
        <span className="muted small">The open market — every talk starts with his agent</span>
      </ScreenHeader>
      <ScreenStateNotices loading={loading && !hub} error={error} empty={false} emptyText="" />

      <CapLine finance={finance ?? null} />

      {rfa?.windowOpen && rfa.rows.length > 0 && (
        <Panel title={`Restricted free agents — offer-sheet targets (${rfa.rows.length})`}>
          <p className="muted small" style={{ marginTop: 0, marginBottom: 10 }}>
            These men are signed to rights but unsigned to terms. Tender an offer sheet and their
            club has one choice: match your number, or let him walk and take your draft picks as
            compensation. Overpay to make the match hurt.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 26 }} />
                  <th>Player</th>
                  <th>Pos / Age</th>
                  <th className="num">OVR</th>
                  <th>Rights</th>
                  <th>His ask</th>
                  <th>Your sheet</th>
                  <th>If they walk</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rfa.rows.map((t) => {
                  const capTight = t.offerSalary > (finance ? finance.salaryCap - finance.capUsed : 0)
                  return (
                    <tr key={t.playerId}>
                      <td>
                        <PlayerFace faceId={t.faceId} name={t.name} size={26} />
                      </td>
                      <td>
                        <PlayerLink playerId={t.playerId} name={t.name} />
                      </td>
                      <td className="muted small">
                        {t.position} · {t.age}
                      </td>
                      <td className="num">
                        <OverallStars overall={t.overall} />
                      </td>
                      <td className="small">{t.teamAbbr}</td>
                      <td className="mono small">
                        {fmtMoney(t.askSalary)} × {t.askYears}
                      </td>
                      <td className="mono small" style={{ color: capTight ? 'var(--danger)' : undefined }}>
                        {fmtMoney(t.offerSalary)} × {t.offerYears}
                      </td>
                      <td className="small muted">{t.compLabel}</td>
                      <td>
                        <button
                          className="btn btn-sm"
                          title={
                            capTight
                              ? 'You may not have the cap room to fit this sheet'
                              : `Tender ${fmtMoney(t.offerSalary)} × ${t.offerYears}`
                          }
                          onClick={() => void offerSheet(t.playerId, t.offerSalary, t.offerYears)}
                        >
                          Offer sheet
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

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
                      <td style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
                        <div className="muted">{fa.agentName}</div>
                        <button
                          onClick={() => void askAgent(fa.playerId)}
                          title="Ask his agent what the market looks like (he won't always say)"
                          style={{ background: 'none', border: 'none', padding: 0, marginTop: 1, cursor: 'pointer', fontSize: 10, color: 'var(--accent)' }}
                        >
                          ask the market →
                        </button>
                      </td>
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
                        <div className="stack" style={{ gap: 3, alignItems: 'flex-end' }}>
                          <button
                            className="btn btn-primary"
                            style={{ padding: '3px 12px', fontSize: 12, whiteSpace: 'nowrap' }}
                            onClick={() => nav.navigate('negotiation', { playerId: fa.playerId })}
                          >
                            {fa.inTalks ? 'Resume talks →' : 'Open talks →'}
                          </button>
                          {fa.pendingOffer ? (
                            <span className="chip chip-violet" style={{ fontSize: 9, whiteSpace: 'nowrap' }} title="You've tabled a standing offer — his camp is deciding">
                              ⏳ offered {fmtMoney(fa.pendingOffer.salary)}×{fa.pendingOffer.years} · ~{fa.pendingOffer.decidesInDays}d
                            </span>
                          ) : offseasonFa ? (
                            <button
                              className="btn btn-ghost"
                              style={{ padding: '2px 10px', fontSize: 10, whiteSpace: 'nowrap' }}
                              title="Table a standing offer at his ask — he'll weigh it against rivals and get back to you"
                              onClick={() => void tableOffer(fa.playerId, fa.askSalary, fa.askYears)}
                            >
                              Table offer (his ask)
                            </button>
                          ) : null}
                        </div>
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
