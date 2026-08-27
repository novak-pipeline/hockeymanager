/**
 * The Free Agents tab (DEPTH 2) — the open market as its own destination,
 * like Scouting: filter chips, name search, shortlist stars, two-way interest
 * reads, honest decision clocks, and every row opens the negotiation room.
 * Lives in the sidebar year-round; outside the July window it shows what the
 * market IS (empty or leftovers) instead of pretending it doesn't exist.
 */
import { useMemo, useState } from 'react'
import type { FinanceView } from '../../worker/protocol'
import type { FaHubRowView, RfaBoardView, FaHubView, RfaTargetView } from '../../engine/career/views'
import { PlayerLink, useNav } from '../components/NavContext'
import { Notice, Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { fmtMoney } from '../components/format'
import { OverallStars } from '../components/Stars'
import { PlayerFace } from '../components/PlayerFace'
import { useClient, useScreenData } from '../hooks/useSim'
import { toast } from '../components/store'
import { SortHeaders, sortColumns, useTableSort } from '../components/sortable'

/** Offers already tabled, awaiting each camp. */
const STANDING_OFFER_COLS = sortColumns<FaHubRowView>()([
  { key: 'name', label: 'Player', value: (r) => r.name },
  { key: 'offer', label: 'Your offer', value: (r) => r.pendingOffer?.salary ?? null },
  { key: 'ask', label: 'His ask', value: (r) => r.askSalary },
  {
    key: 'standing',
    label: 'Standing',
    value: (r) => (r.pendingOffer?.standing === 'leading' ? 2 : r.pendingOffer?.standing === 'competitive' ? 1 : 0),
    title: 'Where your money sits against the field',
  },
  { key: 'decides', label: 'Decides', value: (r) => r.pendingOffer?.decidesInDays ?? null, initialDir: 'asc' },
  { key: 'read', label: 'Read' },
])

/** Rival RFAs you could prise loose with an offer sheet. */
const RFA_COLS = sortColumns<RfaTargetView>()([
  { key: 'face', label: '', style: { width: 26 } },
  { key: 'name', label: 'Player', value: (t) => t.name },
  { key: 'posAge', label: 'Pos / Age', value: (t) => t.age, initialDir: 'asc' },
  { key: 'overall', label: 'OVR', value: (t) => t.overall, align: 'right' },
  { key: 'rights', label: 'Rights', value: (t) => t.teamAbbr },
  { key: 'ask', label: 'His ask', value: (t) => t.askSalary },
  { key: 'sheet', label: 'Your sheet', value: (t) => t.offerSalary },
  { key: 'comp', label: 'If they walk', value: (t) => t.compLabel },
  { key: 'act', label: '' },
])

/** The open UFA market. */
const FA_MARKET_COLS = sortColumns<FaHubRowView>()([
  { key: 'star', label: '', value: (fa) => (fa.shortlisted ? 1 : 0), style: { width: 26 }, title: 'Shortlisted first' },
  { key: 'name', label: 'Player', value: (fa) => fa.name },
  { key: 'posAge', label: 'Pos / Age', value: (fa) => fa.age, initialDir: 'asc' },
  { key: 'overall', label: 'OVR', value: (fa) => fa.overall, align: 'right' },
  { key: 'ask', label: 'Their ask', value: (fa) => fa.askSalary },
  { key: 'agent', label: 'Agent', value: (fa) => fa.agentName },
  {
    key: 'interest',
    label: 'His interest in you',
    value: (fa) => (fa.interest === 'keen' ? 2 : fa.interest === 'warm' ? 1 : 0),
  },
  {
    key: 'clock',
    label: 'Clock',
    value: (fa) => fa.decidesInDays,
    initialDir: 'asc',
    title: 'Days before rival clubs can sign him out from under you',
  },
  { key: 'act', label: '' },
])

/** Stable identity so the sort hook is not handed a new array each render. */
const NO_RFA_ROWS: RfaTargetView[] = []

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

const STANDING_META: Record<'leading' | 'competitive' | 'trailing', { label: string; color: string }> = {
  leading: { label: 'Leading', color: 'var(--success, #4caf7d)' },
  competitive: { label: 'Contested', color: 'var(--amber, #d6a056)' },
  trailing: { label: 'Trailing', color: 'var(--danger, #e0575b)' },
}

/** #164: the GM's outstanding standing offers, with a leading/contested/trailing
 *  read on where each sits vs the rival field. Only shown when offers are live. */
function StandingOffersPanel({ hub }: { hub: FaHubView | null }): JSX.Element | null {
  const offers = useMemo(() => (hub?.rows ?? []).filter((r) => r.pendingOffer), [hub])
  const { sorted, sortKey, dir, sortBy } = useTableSort(offers, STANDING_OFFER_COLS, { key: null })
  if (offers.length === 0) return null
  return (
    <Panel title={`Your standing offers (${offers.length})`}>
      <p className="muted small" style={{ marginTop: 0, marginBottom: 10 }}>
        Offers you've tabled, awaiting each camp's decision. The read is honest — how your money
        stacks up against the field, not a fabricated rival bid.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <SortHeaders columns={STANDING_OFFER_COLS} sortKey={sortKey} dir={dir} onSort={sortBy} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const po = r.pendingOffer!
              const meta = STANDING_META[po.standing]
              return (
                <tr key={r.playerId}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <PlayerFace faceId={r.faceId} name={r.name} size={24} />
                      <PlayerLink playerId={r.playerId} name={r.name} />
                    </span>
                  </td>
                  <td className="mono small">{fmtMoney(po.salary)} × {po.years}</td>
                  <td className="mono small muted">{fmtMoney(r.askSalary)} × {r.askYears}</td>
                  <td>
                    <span className="chip" style={{ fontSize: 10, color: meta.color, borderColor: meta.color }}>
                      {meta.label}
                    </span>
                  </td>
                  <td className="small muted">{po.decidesInDays > 0 ? `~${po.decidesInDays}d` : 'today'}</td>
                  <td className="small muted" style={{ maxWidth: 320 }}>{po.standingNote}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

export function FreeAgentMarketScreen(): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const [posFilter, setPosFilter] = useState<'all' | 'F' | 'D' | 'G' | 'starred'>('all')
  const [search, setSearch] = useState('')
  // RFA offer-sheet targets are the niche/aggressive play — keep them collapsed
  // so the open UFA market (the primary signing flow) is the first thing you see.
  const [showRfa, setShowRfa] = useState(false)

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

  const rows = useMemo(() => (hub?.rows ?? []).filter((r) => {
    if (posFilter === 'starred' && !r.shortlisted) return false
    if (posFilter === 'F' && (r.position === 'D' || r.position === 'G')) return false
    if (posFilter === 'D' && r.position !== 'D') return false
    if (posFilter === 'G' && r.position !== 'G') return false
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [hub, posFilter, search])
  const marketSort = useTableSort(rows, FA_MARKET_COLS, { key: null })
  const rfaSort = useTableSort(rfa?.rows ?? NO_RFA_ROWS, RFA_COLS, { key: null })

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
      toast(r.message, r.ok ? (r.pending ? 'info' : 'success') : 'error')
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

      <StandingOffersPanel hub={hub} />

      {rfa?.windowOpen && rfa.rows.length > 0 && (
        <Panel title={`Restricted free agents — offer-sheet targets (${rfa.rows.length})`}>
          <button
            className="btn btn-sm"
            style={{ marginBottom: showRfa ? 10 : 0 }}
            onClick={() => setShowRfa((v) => !v)}
          >
            {showRfa ? 'Hide offer-sheet targets ▲' : `Show ${rfa.rows.length} offer-sheet targets ▼`}
          </button>
          {showRfa && (<>
          <p className="muted small" style={{ marginTop: 10, marginBottom: 10 }}>
            These men are signed to rights but unsigned to terms. Tender an offer sheet, the player
            signs it, and his club then has a <b>7-day window</b> to match your number — or let him
            walk and take your own draft picks as compensation. Overpay to make the match hurt.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <SortHeaders columns={RFA_COLS} sortKey={rfaSort.sortKey} dir={rfaSort.dir} onSort={rfaSort.sortBy} />
                </tr>
              </thead>
              <tbody>
                {rfaSort.sorted.map((t) => {
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
                        {t.pending ? (
                          <span
                            className="chip"
                            title={`Tendered ${fmtMoney(t.pending.salary)} × ${t.pending.years} — awaiting ${t.teamAbbr}'s decision`}
                            style={{ fontSize: 11, borderColor: 'var(--amber, #d6a056)', color: 'var(--amber, #d6a056)' }}
                          >
                            ⏳ {t.pending.daysLeft > 0 ? `${t.pending.daysLeft}d to match` : 'deciding…'}
                          </span>
                        ) : (
                          <button
                            className="btn btn-sm"
                            title={
                              capTight
                                ? 'You may not have the cap room to fit this sheet'
                                : `Tender ${fmtMoney(t.offerSalary)} × ${t.offerYears} — the club then gets the 7-day match window`
                            }
                            onClick={() => void offerSheet(t.playerId, t.offerSalary, t.offerYears)}
                          >
                            Offer sheet
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </>)}
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
                  <SortHeaders columns={FA_MARKET_COLS} sortKey={marketSort.sortKey} dir={marketSort.dir} onSort={marketSort.sortBy} />
                </tr>
              </thead>
              <tbody>
                {marketSort.sorted.map((fa) => {
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
                        {fa.askSoftened && <span className="chip" style={{ fontSize: 9, marginLeft: 6, color: 'var(--success)', borderColor: 'var(--success)' }} title="His camp is dropping the ask as the summer drags on">▼ softening</span>}
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
                            <span
                              className="chip"
                              style={{ fontSize: 9, whiteSpace: 'nowrap', color: STANDING_META[fa.pendingOffer.standing].color, borderColor: STANDING_META[fa.pendingOffer.standing].color }}
                              title={fa.pendingOffer.standingNote}
                            >
                              ⏳ {STANDING_META[fa.pendingOffer.standing].label} · {fmtMoney(fa.pendingOffer.salary)}×{fa.pendingOffer.years} · ~{fa.pendingOffer.decidesInDays}d
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
