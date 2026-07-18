import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import type { TentpoleView, TradeEvaluation, TradesView } from '../../worker/protocol'
import type {
  PickAssetView,
  PlayerBadge,
  TradeAssessmentView,
  TradeDraftAsset,
  TradeDraftView,
  TradeInterestView,
  TradeOfferView,
  TradePartnerView,
  TradeRumorView,
  ValueDriver,
} from '../../engine/career/views'
import { PlayerLink, useNav } from '../components/NavContext'
import { PlayerFace } from '../components/PlayerFace'
import { TeamCrest } from '../components/Crest'
import { OverallStars } from '../components/Stars'
import { Notice, Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { Icon } from '../components/primitives'
import { Icons } from '../components/icons'
import { fmtMoney } from '../components/format'
import { useClient, useScreenData } from '../hooks/useSim'
import { toast } from '../components/store'

// ─── asset chips ──────────────────────────────────────────────────────────────

function OvrLabel({ badge }: { badge: PlayerBadge }): JSX.Element | null {
  if (badge.scouted && !badge.scouted.exact) {
    return (
      <span style={{ opacity: 0.6 }} title="Fog-of-war estimate">
        <OverallStars value={Math.round((badge.scouted.overallLo + badge.scouted.overallHi) / 2)} />
      </span>
    )
  }
  if (!badge.scouted) return null
  return <OverallStars value={badge.overall} />
}

// ─── per-asset trade value ──────────────────────────────────────────────────

/** Multi-line hover breakdown of the factors behind an asset's value. */
function driversTitle(drivers?: ValueDriver[], header?: string): string {
  const rows = (drivers ?? []).map(
    (d) => `${d.tone === 'up' ? '▲' : d.tone === 'down' ? '▼' : '·'} ${d.label}`,
  )
  return [header, ...rows].filter(Boolean).join('\n')
}

/** Compact mono value pill; hover reveals the drivers. Shows "~" when the value
 *  is a fog-of-war estimate for an unscouted opponent. */
function ValuePill(props: {
  value?: number
  drivers?: ValueDriver[]
  estimated?: boolean
  title?: string
}): JSX.Element | null {
  if (props.value === undefined) return null
  return (
    <span
      className="mono"
      title={driversTitle(props.drivers, props.title)}
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: '1px 6px',
        borderRadius: 4,
        background: 'rgba(var(--accent-rgb),0.12)',
        border: '1px solid rgba(var(--accent-rgb),0.3)',
        color: 'var(--accent)',
        whiteSpace: 'nowrap',
        cursor: 'help',
      }}
    >
      {props.estimated ? '~' : ''}
      {props.value.toFixed(1)}
    </span>
  )
}

function PlayerChip(props: {
  name: string
  playerId: string
  salary: number
  yearsRemaining: number
  noTradeClause?: boolean
  /** Trade value on the shared asset-value scale (same currency as pick value). */
  value?: number
  badge?: PlayerBadge
}): JSX.Element {
  return (
    <div
      title={props.value !== undefined ? `Trade value: ${props.value}` : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        background: 'var(--bg2)',
        border: '1px solid var(--line)',
        borderRadius: 6,
        fontSize: 12,
        whiteSpace: 'nowrap',
      }}
    >
      <PlayerLink playerId={props.playerId} name={props.name} />
      {props.badge && <OvrLabel badge={props.badge} />}
      <span style={{ color: 'var(--muted)' }}>
        {fmtMoney(props.salary)} / {props.yearsRemaining}yr
      </span>
      {props.value !== undefined && (
        <span style={{ color: 'var(--muted)', fontSize: 10 }}>· {props.value}</span>
      )}
      {props.noTradeClause && <span className="chip chip-danger" style={{ fontSize: 10 }}>NTC</span>}
    </div>
  )
}

function PickChip(props: { pick: PickAssetView }): JSX.Element {
  const { pick } = props
  return (
    <span
      title={driversTitle(pick.drivers, pick.viaAbbr ? `Originally ${pick.viaAbbr}'s pick` : undefined)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 10px',
        background: 'rgba(var(--accent-rgb),0.10)',
        border: '1px solid rgba(var(--accent-rgb),0.35)',
        borderRadius: 6,
        fontSize: 12,
        color: 'var(--accent)',
        whiteSpace: 'nowrap',
      }}
    >
      {pick.label}
      {pick.viaAbbr && (
        <span style={{ color: 'var(--muted)', fontSize: 10 }}>(via {pick.viaAbbr})</span>
      )}
      <span className="mono" style={{ color: 'var(--muted)', fontSize: 10 }}>{pick.value.toFixed(1)}</span>
    </span>
  )
}

// ─── trade side summary (receive / give) ──────────────────────────────────────

function TradeSideChips(props: {
  players: Array<PlayerBadge & { salary: number; yearsRemaining: number; noTradeClause?: boolean; value?: number }>
  picks: PickAssetView[]
  label: string
  labelColor?: string
}): JSX.Element {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.6px',
          color: props.labelColor ?? 'var(--muted)',
          marginBottom: 6,
        }}
      >
        {props.label}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {props.players.map((p) => (
          <PlayerChip
            key={p.playerId}
            playerId={p.playerId}
            name={p.name}
            salary={p.salary}
            yearsRemaining={p.yearsRemaining}
            noTradeClause={p.noTradeClause}
            value={p.value}
            badge={p}
          />
        ))}
        {props.picks.map((pk) => (
          <PickChip key={pk.id} pick={pk} />
        ))}
        {props.players.length === 0 && props.picks.length === 0 && (
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
        )}
      </div>
    </div>
  )
}

// ─── incoming offer card ───────────────────────────────────────────────────────

function OfferCard(props: {
  offer: TradeOfferView
  currentDay: number
  onAction: () => void
  /** Open the builder pre-loaded with this deal to send a counter back. */
  onCounter: (offer: TradeOfferView) => void
}): JSX.Element {
  const { offer } = props
  const client = useClient()
  const [busy, setBusy] = useState(false)
  const [mutErr, setMutErr] = useState<string | null>(null)

  async function doAccept() {
    setBusy(true)
    setMutErr(null)
    const r = await client.acceptTrade(offer.offerId)
    setBusy(false)
    if (r.type === 'error') {
      setMutErr(r.message)
    } else {
      toast('Trade accepted.', 'success')
      props.onAction()
    }
  }

  async function doReject() {
    setBusy(true)
    setMutErr(null)
    const r = await client.rejectTrade(offer.offerId)
    setBusy(false)
    if (r.type === 'error') {
      setMutErr(r.message)
    } else {
      toast('Offer declined.')
      props.onAction()
    }
  }

  const daysLeft = offer.expiresOnDay - props.currentDay
  const expLabel = daysLeft <= 0 ? 'Expires today' : `Expires in ${daysLeft}d`

  return (
    <Panel>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 8 }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{offer.receive.teamName}</span>
          <span style={{ marginLeft: 8, color: 'var(--muted)', fontSize: 12 }}>
            {offer.receive.teamAbbr}
          </span>
        </div>
        <span
          className={daysLeft <= 2 ? 'chip chip-danger' : 'chip chip-warn'}
          style={{ fontSize: 10 }}
        >
          {expLabel}
        </span>
      </div>

      <div
        style={{
          background: 'var(--bg0)',
          border: '1px solid var(--line)',
          borderRadius: 6,
          padding: '8px 12px',
          marginBottom: 12,
          color: 'var(--muted)',
          fontSize: 13,
          fontStyle: 'italic',
        }}
      >
        "{offer.message}"
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
        <TradeSideChips
          players={offer.receive.players}
          picks={offer.receive.picks}
          label="You receive"
          labelColor="var(--success)"
        />
        <div
          style={{
            width: 1,
            background: 'var(--line)',
            alignSelf: 'stretch',
          }}
        />
        <TradeSideChips
          players={offer.give.players}
          picks={offer.give.picks}
          label="You give up"
          labelColor="var(--danger)"
        />
      </div>

      {mutErr && <Notice kind="warn">{mutErr}</Notice>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" disabled={busy} onClick={doAccept}>
          Accept
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() => props.onCounter(offer)}
          title="Open the builder pre-loaded with this deal so you can tweak it and send it back"
        >
          Counter
        </button>
        <button className="btn btn-danger" disabled={busy} onClick={doReject}>
          Decline
        </button>
      </div>
    </Panel>
  )
}

// ─── trade evaluation result ───────────────────────────────────────────────────

function EvalPanel(props: {
  evaluation: TradeEvaluation
  onAcceptCounter: (offer: TradeOfferView) => void
  onRejectCounter: (offerId: string) => void
  onDismiss: () => void
  currentDay: number
}): JSX.Element {
  const { evaluation } = props
  const client = useClient()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (evaluation.verdict === 'pending') {
    // #184: the GM took it under advisement — no instant handshake. The real
    // answer lands in the inbox after a day or two of sim time.
    return (
      <Panel>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            background: 'rgba(214,160,86,0.12)',
            border: '1px solid rgba(214,160,86,0.4)',
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 20 }}>⏳</span>
          <span style={{ color: 'var(--amber, #d6a056)', fontWeight: 700, fontSize: 15 }}>
            Under advisement
          </span>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 12px' }}>{evaluation.message}</p>
        <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 12px' }}>
          Sim forward — his answer (completed, a counter, or a pass) arrives in your inbox.
        </p>
        <button className="btn btn-ghost" onClick={props.onDismiss}>
          Done
        </button>
      </Panel>
    )
  }

  if (evaluation.verdict === 'accept') {
    return (
      <Panel>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            background: 'rgba(95,208,104,0.1)',
            border: '1px solid rgba(95,208,104,0.35)',
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          <Icon size={20} color="var(--success)"><Check /></Icon>
          <span style={{ color: 'var(--success)', fontWeight: 700, fontSize: 15 }}>
            Trade accepted!
          </span>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 12px' }}>{evaluation.message}</p>
        <button className="btn btn-ghost" onClick={props.onDismiss}>
          Done
        </button>
      </Panel>
    )
  }

  if (evaluation.verdict === 'reject') {
    return (
      <Panel>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            background: 'rgba(224,108,117,0.1)',
            border: '1px solid rgba(224,108,117,0.35)',
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 20 }}>✗</span>
          <span style={{ color: 'var(--danger)', fontWeight: 700, fontSize: 15 }}>
            Proposal rejected
          </span>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 12px' }}>{evaluation.message}</p>
        <button className="btn btn-ghost" onClick={props.onDismiss}>
          Back
        </button>
      </Panel>
    )
  }

  // counter-offer
  const counter = evaluation.counter!
  const daysLeft = counter.expiresOnDay - props.currentDay

  async function acceptCounter() {
    setBusy(true)
    setErr(null)
    const r = await client.acceptTrade(counter.offerId)
    setBusy(false)
    if (r.type === 'error') {
      setErr(r.message)
    } else {
      toast('Trade accepted.', 'success')
      props.onAcceptCounter(counter)
    }
  }

  async function rejectCounter() {
    setBusy(true)
    setErr(null)
    const r = await client.rejectTrade(counter.offerId)
    setBusy(false)
    if (r.type === 'error') {
      setErr(r.message)
    } else {
      props.onRejectCounter(counter.offerId)
    }
  }

  return (
    <Panel>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          background: 'rgba(255,210,74,0.08)',
          border: '1px solid rgba(255,210,74,0.35)',
          borderRadius: 6,
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 18 }}>↔</span>
        <span style={{ color: 'var(--accent2)', fontWeight: 700, fontSize: 15 }}>
          Counter-offer from {counter.receive.teamName}
        </span>
        <span className="chip chip-warn" style={{ fontSize: 10, marginLeft: 'auto' }}>
          {daysLeft <= 0 ? 'Expires today' : `Expires in ${daysLeft}d`}
        </span>
      </div>

      <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 14px', fontStyle: 'italic' }}>
        "{evaluation.message}"
      </p>

      <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
        <TradeSideChips
          players={counter.receive.players}
          picks={counter.receive.picks}
          label="You receive"
          labelColor="var(--success)"
        />
        <div style={{ width: 1, background: 'var(--line)', alignSelf: 'stretch' }} />
        <TradeSideChips
          players={counter.give.players}
          picks={counter.give.picks}
          label="You give up"
          labelColor="var(--danger)"
        />
      </div>

      {err && <Notice kind="warn">{err}</Notice>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" disabled={busy} onClick={acceptCounter}>
          Accept counter
        </button>
        <button className="btn btn-danger" disabled={busy} onClick={rejectCounter}>
          Decline
        </button>
      </div>
    </Panel>
  )
}

// ─── partner dropdown (crest-rich, re-render-proof) ─────────────────────────────

function PartnerDropdown(props: {
  partners: TradePartnerView[]
  value: string
  onChange: (id: string) => void
}): JSX.Element {
  const { partners, value, onChange } = props
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])
  const cur = partners.find((p) => p.teamId === value)
  const crestStyle = { width: 20, height: 20, flexShrink: 0 }
  return (
    <div ref={ref} style={{ position: 'relative', maxWidth: 360 }}>
      <button
        type="button"
        className="select"
        onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer', textAlign: 'left' }}
      >
        <span className="row" style={{ gap: 8, alignItems: 'center', minWidth: 0 }}>
          {cur && <TeamCrest teamId={cur.teamId} abbr={cur.teamAbbr} style={crestStyle} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {cur ? `${cur.teamName} (${cur.teamAbbr})` : 'Select a team…'}
          </span>
        </span>
        <span className="muted" style={{ fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50,
            maxHeight: 340, overflowY: 'auto', background: 'var(--bg1)',
            border: '1px solid var(--line)', borderRadius: 8, boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
          }}
        >
          {partners.map((p) => (
            <button
              key={p.teamId}
              type="button"
              onClick={() => { onChange(p.teamId); setOpen(false) }}
              className="row"
              style={{
                width: '100%', gap: 8, alignItems: 'center', padding: '7px 12px',
                background: p.teamId === value ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
                border: 'none', color: 'var(--text)', cursor: 'pointer', textAlign: 'left', fontSize: 13,
              }}
            >
              <TeamCrest teamId={p.teamId} abbr={p.teamAbbr} style={crestStyle} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.teamName}</span>
              <span className="muted small">{p.teamAbbr}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── propose tab ──────────────────────────────────────────────────────────────

/** A counter's starting point: the partner + the players from the offer being
 *  countered. `nonce` forces a re-seed if another counter comes in mid-edit. */
interface TradeSeed {
  partnerId: string
  myPlayerIds: string[]
  theirPlayerIds: string[]
  nonce: number
}

function ProposeTab(props: {
  data: TradesView
  onRefetch: () => void
  currentDay: number
  /** When countering an incoming offer, the builder opens pre-loaded with that
   *  deal's players and partner so the GM can tweak it and send it back. */
  seed?: TradeSeed | null
}): JSX.Element {
  const client = useClient()
  const { data } = props

  const [partnerId, setPartnerId] = useState(props.seed?.partnerId ?? data.partners[0]?.teamId ?? '')
  const partner: TradePartnerView | undefined = data.partners.find((p) => p.teamId === partnerId)

  const [myPlayerIds, setMyPlayerIds] = useState<Set<string>>(new Set(props.seed?.myPlayerIds ?? []))
  const [myPickIds, setMyPickIds] = useState<Set<string>>(new Set())
  const [theirPlayerIds, setTheirPlayerIds] = useState<Set<string>>(new Set(props.seed?.theirPlayerIds ?? []))
  const [theirPickIds, setTheirPickIds] = useState<Set<string>>(new Set())

  // Re-seed when a NEW counter arrives while the builder is already mounted.
  const seedNonce = props.seed?.nonce
  useEffect(() => {
    if (!props.seed) return
    setPartnerId(props.seed.partnerId)
    setMyPlayerIds(new Set(props.seed.myPlayerIds))
    setTheirPlayerIds(new Set(props.seed.theirPlayerIds))
    setMyPickIds(new Set())
    setTheirPickIds(new Set())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedNonce])

  const [busy, setBusy] = useState(false)
  const [evalResult, setEvalResult] = useState<TradeEvaluation | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // Live per-asset value breakdown + verdicts (your AGM read, the market split,
  // the partner's projected answer) + the partner GM's non-binding "gauge
  // interest" read (only after you ask). All cleared as the deal changes.
  const [draft, setDraft] = useState<TradeDraftView | null>(null)
  const [interest, setInterest] = useState<TradeInterestView | null>(null)
  const [gauging, setGauging] = useState(false)

  const proposalPayload = (): {
    partnerTeamId: string; givePlayerIds: string[]; givePickIds: string[]
    receivePlayerIds: string[]; receivePickIds: string[]
  } => ({
    partnerTeamId: partnerId,
    givePlayerIds: [...myPlayerIds],
    givePickIds: [...myPickIds],
    receivePlayerIds: [...theirPlayerIds],
    receivePickIds: [...theirPickIds],
  })

  // Live assistant-GM read as you build. The partner's interest is stale the
  // moment the package changes, so drop it here — you re-gauge deliberately.
  useEffect(() => {
    setInterest(null)
    if (evalResult) return
    const anySide = myPlayerIds.size + myPickIds.size > 0 && theirPlayerIds.size + theirPickIds.size > 0
    if (!partnerId || !anySide) { setDraft(null); return }
    let cancelled = false
    const t = setTimeout(async () => {
      const r = await client.evaluateTradeDraft(proposalPayload())
      if (!cancelled && r.type === 'tradeDraft') setDraft(r.draft)
    }, 180)
    return () => { cancelled = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId, myPlayerIds, myPickIds, theirPlayerIds, theirPickIds, evalResult])

  async function handleGauge() {
    if (!partnerId) return
    setGauging(true)
    const r = await client.gaugeTradeInterest(proposalPayload())
    setGauging(false)
    if (r.type === 'tradeInterestRead') setInterest(r.read)
    else if (r.type === 'error') setErr(r.message)
  }

  function toggleSet<T>(set: Set<T>, val: T): Set<T> {
    const next = new Set(set)
    if (next.has(val)) next.delete(val)
    else next.add(val)
    return next
  }

  function resetSelections() {
    setMyPlayerIds(new Set())
    setMyPickIds(new Set())
    setTheirPlayerIds(new Set())
    setTheirPickIds(new Set())
    setEvalResult(null)
    setErr(null)
    setDraft(null)
    setInterest(null)
  }

  async function handlePropose() {
    if (!partnerId) return
    setBusy(true)
    setErr(null)
    setEvalResult(null)
    const r = await client.proposeTrade({
      partnerTeamId: partnerId,
      givePlayerIds: [...myPlayerIds],
      givePickIds: [...myPickIds],
      receivePlayerIds: [...theirPlayerIds],
      receivePickIds: [...theirPickIds],
    })
    setBusy(false)
    if (r.type === 'error') {
      setErr(r.message)
    } else if (r.type === 'tradeEvaluation') {
      setEvalResult(r.evaluation)
    } else {
      setErr('Unexpected response from worker.')
    }
  }

  // DEPTH 3: shop the single selected player around the whole league — every
  // club that needs him tables its best package, landing in the offers tab.
  async function handleShop(playerId: string) {
    setBusy(true)
    setErr(null)
    const r = await client.shopPlayer(playerId)
    setBusy(false)
    if (r.type === 'error') { setErr(r.message); return }
    if (r.type === 'shopResult') {
      toast(r.message, r.count > 0 ? 'success' : 'info')
      props.onRefetch()
    }
  }

  const hasSelections =
    myPlayerIds.size > 0 || myPickIds.size > 0 || theirPlayerIds.size > 0 || theirPickIds.size > 0

  return (
    <div className="stack">
      {/* partner selector — custom dropdown (a native <select>'s popup gets
          closed by the screen's periodic re-renders, so it wouldn't open
          reliably in-season). */}
      <Panel title="Trade partner">
        <PartnerDropdown
          partners={data.partners}
          value={partnerId}
          onChange={(id) => { setPartnerId(id); resetSelections() }}
        />
      </Panel>

      {partner && (
        <Panel title={`${partner.teamName} profile`}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13 }}>
            {partner.gmName && (
              <div>
                <span style={{ color: 'var(--muted)', fontSize: 11, display: 'block', marginBottom: 2 }}>General Manager</span>
                <span style={{ fontWeight: 700 }}>{partner.gmName}</span>
                {partner.gmStyle && <div className="muted" style={{ fontSize: 11 }}>{partner.gmStyle}</div>}
              </div>
            )}
            {partner.posture && (
              <div>
                <span style={{ color: 'var(--muted)', fontSize: 11, display: 'block', marginBottom: 2 }}>Stance</span>
                <span
                  className="chip"
                  title={partner.postureReason}
                  style={{
                    fontSize: 11, textTransform: 'capitalize',
                    color: partner.posture === 'contend' ? 'var(--success)' : partner.posture === 'rebuild' ? 'var(--amber, #f59e0b)' : undefined,
                  }}
                >
                  {partner.posture}
                </span>
              </div>
            )}
            <div>
              <span style={{ color: 'var(--muted)', fontSize: 11, display: 'block', marginBottom: 2 }}>Philosophy</span>
              <span className="chip" style={{ fontSize: 11 }}>{partner.philosophy}</span>
            </div>
            <div>
              <span style={{ color: 'var(--muted)', fontSize: 11, display: 'block', marginBottom: 2 }}>Cap space</span>
              <span style={{
                fontWeight: 600,
                color: partner.capSpace >= 0 ? 'var(--success)' : 'var(--danger)'
              }}>
                {partner.capSpace >= 0 ? '+' : ''}{fmtMoney(partner.capSpace)}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--muted)', fontSize: 11, display: 'block', marginBottom: 2 }}>Needs</span>
              {partner.needs.length === 0
                ? <span className="muted small">None identified</span>
                : partner.needs.map((n) => (
                  <span key={n} className="chip chip-warn" style={{ fontSize: 10, marginRight: 4 }}>{n}</span>
                ))}
            </div>
          </div>
        </Panel>
      )}

      {partner && (
        <div className="grid grid-2">
          {/* my assets */}
          <Panel title="My assets">
            <div style={{ marginBottom: 10 }}>
              <div className="panel-title" style={{ marginBottom: 6 }}>Players</div>
              <div className="stack" style={{ gap: 4 }}>
                {data.myPlayers.map((p) => {
                  const selected = myPlayerIds.has(p.playerId)
                  const ntc = p.noTradeClause
                  return (
                    <button
                      key={p.playerId}
                      type="button"
                      disabled={ntc}
                      onClick={() => !ntc && setMyPlayerIds(toggleSet(myPlayerIds, p.playerId))}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        padding: '5px 8px',
                        background: selected ? 'rgba(var(--accent-rgb),0.14)' : 'var(--bg0)',
                        border: selected ? '1px solid rgba(var(--accent-rgb),0.5)' : '1px solid var(--line)',
                        borderRadius: 6,
                        cursor: ntc ? 'not-allowed' : 'pointer',
                        opacity: ntc ? 0.5 : 1,
                        fontSize: 13,
                        color: 'var(--text)',
                        textAlign: 'left',
                        gap: 8,
                      }}
                    >
                      <span className="row" style={{ gap: 8, alignItems: 'center', minWidth: 0 }}>
                        <PlayerFace faceId={p.faceId} name={p.name} size={24} />
                        <span>
                          <PlayerLink playerId={p.playerId} name={p.name} />
                          <span style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 12 }}>
                            {p.position} · {p.age}
                          </span>
                        </span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                          {fmtMoney(p.salary)} / {p.yearsRemaining}yr
                        </span>
                        <ValuePill
                          value={p.tradeValue}
                          drivers={p.valueDrivers}
                          estimated={p.valueEstimated}
                          title={p.valueEstimated ? 'Your scouts’ estimate' : undefined}
                        />
                        {ntc && <span className="chip chip-danger" style={{ fontSize: 10 }}>NTC</span>}
                      </span>
                    </button>
                  )
                })}
              </div>
              {/* DEPTH 3: shop the one selected player around the whole league */}
              {myPlayerIds.size === 1 && (() => {
                const shopId = [...myPlayerIds][0]!
                const shopName = data.myPlayers.find((p) => p.playerId === shopId)?.name ?? 'him'
                return (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => void handleShop(shopId)}
                    style={{ marginTop: 8, width: '100%', fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    title="Solicit concrete offers for this player from every club that needs him"
                  >
                    <Icon size={14}><Icons.Megaphone /></Icon> Shop {shopName} around the league
                  </button>
                )
              })()}
            </div>
            {data.myPicks.length > 0 && (
              <div>
                <div className="panel-title" style={{ marginBottom: 6 }}>Picks</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {data.myPicks.map((pk) => {
                    const sel = myPickIds.has(pk.id)
                    return (
                      <button
                        key={pk.id}
                        type="button"
                        onClick={() => setMyPickIds(toggleSet(myPickIds, pk.id))}
                        style={{
                          padding: '3px 10px',
                          background: sel ? 'rgba(var(--accent-rgb),0.20)' : 'rgba(var(--accent-rgb),0.08)',
                          border: sel ? '1px solid rgba(var(--accent-rgb),0.6)' : '1px solid rgba(var(--accent-rgb),0.28)',
                          borderRadius: 6,
                          fontSize: 12,
                          color: 'var(--accent)',
                          cursor: 'pointer',
                        }}
                      >
                        <span title={driversTitle(pk.drivers, pk.viaAbbr ? `Originally ${pk.viaAbbr}'s pick` : undefined)}>
                          {pk.label}
                          {pk.viaAbbr && <span style={{ opacity: 0.7, fontSize: 10 }}> (via {pk.viaAbbr})</span>}
                          <span className="mono" style={{ marginLeft: 5, opacity: 0.7, fontSize: 10 }}>{pk.value.toFixed(1)}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </Panel>

          {/* partner assets */}
          <Panel title={`${partner.teamName} assets`}>
            <div style={{ marginBottom: 10 }}>
              <div className="panel-title" style={{ marginBottom: 6 }}>Players</div>
              <div className="stack" style={{ gap: 4 }}>
                {partner.players.map((p) => {
                  const selected = theirPlayerIds.has(p.playerId)
                  const ntc = p.noTradeClause
                  return (
                    <button
                      key={p.playerId}
                      type="button"
                      disabled={ntc}
                      onClick={() => !ntc && setTheirPlayerIds(toggleSet(theirPlayerIds, p.playerId))}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        padding: '5px 8px',
                        background: selected ? 'rgba(var(--accent-rgb),0.14)' : 'var(--bg0)',
                        border: selected ? '1px solid rgba(var(--accent-rgb),0.5)' : '1px solid var(--line)',
                        borderRadius: 6,
                        cursor: ntc ? 'not-allowed' : 'pointer',
                        opacity: ntc ? 0.5 : 1,
                        fontSize: 13,
                        color: 'var(--text)',
                        textAlign: 'left',
                        gap: 8,
                      }}
                    >
                      <span className="row" style={{ gap: 8, alignItems: 'center', minWidth: 0 }}>
                        <PlayerFace faceId={p.faceId} name={p.name} size={24} />
                        <span>
                        <PlayerLink playerId={p.playerId} name={p.name} />
                        <span style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 12 }}>
                          {p.position} · {p.age}
                        </span>
                        {p.scouted && (
                          <span className="chip" style={{ marginLeft: 6, fontSize: 10 }}>
                            {p.scouted.exact
                              ? <OverallStars value={p.overall} />
                              : (
                                <span style={{ opacity: 0.6 }} title="Fog-of-war estimate">
                                  <OverallStars value={Math.round((p.scouted.overallLo + p.scouted.overallHi) / 2)} />
                                </span>
                              )}
                          </span>
                        )}
                        </span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                          {fmtMoney(p.salary)} / {p.yearsRemaining}yr
                        </span>
                        <ValuePill
                          value={p.tradeValue}
                          drivers={p.valueDrivers}
                          estimated={p.valueEstimated}
                          title={p.valueEstimated ? 'Your scouts’ estimate' : undefined}
                        />
                        {ntc && <span className="chip chip-danger" style={{ fontSize: 10 }}>NTC</span>}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
            {partner.picks.length > 0 && (
              <div>
                <div className="panel-title" style={{ marginBottom: 6 }}>Picks</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {partner.picks.map((pk) => {
                    const sel = theirPickIds.has(pk.id)
                    return (
                      <button
                        key={pk.id}
                        type="button"
                        onClick={() => setTheirPickIds(toggleSet(theirPickIds, pk.id))}
                        style={{
                          padding: '3px 10px',
                          background: sel ? 'rgba(var(--accent-rgb),0.20)' : 'rgba(var(--accent-rgb),0.08)',
                          border: sel ? '1px solid rgba(var(--accent-rgb),0.6)' : '1px solid rgba(var(--accent-rgb),0.28)',
                          borderRadius: 6,
                          fontSize: 12,
                          color: 'var(--accent)',
                          cursor: 'pointer',
                        }}
                      >
                        <span title={driversTitle(pk.drivers, pk.viaAbbr ? `Originally ${pk.viaAbbr}'s pick` : undefined)}>
                          {pk.label}
                          {pk.viaAbbr && <span style={{ opacity: 0.7, fontSize: 10 }}> (via {pk.viaAbbr})</span>}
                          <span className="mono" style={{ marginLeft: 5, opacity: 0.7, fontSize: 10 }}>{pk.value.toFixed(1)}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* live deal balance: per-asset values, subtotals, verdicts + gauge */}
      {partner && !evalResult && (draft || interest) && (
        <DealDeskPanel
          draft={draft}
          interest={interest}
          gauging={gauging}
          canGauge={hasSelections && myPlayerIds.size + myPickIds.size > 0 && theirPlayerIds.size + theirPickIds.size > 0}
          onGauge={handleGauge}
        />
      )}

      {/* evaluation result */}
      {evalResult && (
        <EvalPanel
          evaluation={evalResult}
          currentDay={props.currentDay}
          onAcceptCounter={() => {
            setEvalResult(null)
            resetSelections()
            props.onRefetch()
          }}
          onRejectCounter={() => {
            setEvalResult(null)
          }}
          onDismiss={() => {
            setEvalResult(null)
            resetSelections()
            if (evalResult.verdict === 'accept') props.onRefetch()
          }}
        />
      )}

      {err && <Notice kind="warn">{err}</Notice>}

      {!evalResult && (
        <div className="stack" style={{ gap: 4 }}>
          <button
            className="btn btn-primary"
            disabled={busy || !hasSelections || !partnerId}
            onClick={handlePropose}
          >
            {busy ? 'Sending…' : 'Send official offer'}
          </button>
          {hasSelections && (
            <span className="muted" style={{ fontSize: 11 }}>
              They'll take a day or two to weigh it — expect an acceptance, a counter, or a pass by inbox.
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ─── the trade desk (assistant-GM read + gauge interest) ───────────────────────

const ASSESS_TONE: Record<TradeAssessmentView['tone'], string> = {
  love: 'var(--success)', good: 'var(--success)', fair: 'var(--muted)',
  caution: 'var(--amber, #f59e0b)', lopsided: 'var(--danger)', blocked: 'var(--danger)', empty: 'var(--muted)',
}
const INTEREST_TONE: Record<TradeInterestView['lean'], { color: string; label: string }> = {
  warm: { color: 'var(--success)', label: 'Interested' },
  tepid: { color: 'var(--amber, #f59e0b)', label: 'Wants more' },
  cool: { color: 'var(--muted)', label: 'Lukewarm' },
  blocked: { color: 'var(--danger)', label: 'Dealbreaker' },
}

/** A two-sided value gauge: how the package's value splits between what you give
 *  up (left) and what you get back (right). A rough read of who's winning the
 *  deal on paper — the AGM's line above says what to make of it. */
function ValueBalance({ give, receive }: { give: number; receive: number }): JSX.Element {
  const givePct = Math.round(give * 100)
  const receivePct = 100 - givePct
  // Green when we're getting the better of it, amber/red when we're overpaying.
  const rColor = receivePct >= 56 ? 'var(--success)' : receivePct >= 44 ? 'var(--muted)' : 'var(--danger)'
  return (
    <div style={{ marginTop: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>
        <span>You give · {givePct}%</span>
        <span>You get · {receivePct}%</span>
      </div>
      <div style={{ display: 'flex', height: 6, borderRadius: 999, overflow: 'hidden', background: 'var(--bg0)' }} title={`Value split — you give ${givePct}%, you receive ${receivePct}%`}>
        <div style={{ width: `${givePct}%`, background: 'rgba(255,255,255,0.18)' }} />
        <div style={{ width: `${receivePct}%`, background: rColor }} />
      </div>
    </div>
  )
}

const MARKET_TONE: Record<TradeDraftView['marketVerdict'], string> = {
  fair: 'var(--muted)', overpay: 'var(--danger)', fleece: 'var(--success)', empty: 'var(--muted)',
}
const PARTNER_TONE: Record<TradeDraftView['partnerVerdict'], { color: string; label: string }> = {
  accept: { color: 'var(--success)', label: 'They’d accept' },
  counter: { color: 'var(--amber, #f59e0b)', label: 'They’d want more' },
  reject: { color: 'var(--danger)', label: 'They’d reject' },
  blocked: { color: 'var(--danger)', label: 'Blocked' },
  empty: { color: 'var(--muted)', label: '' },
}

/** One side of the deal-balance breakdown: each asset with its value + a
 *  subtotal. Player rows carry a face; picks their provenance. */
function DealColumn(props: {
  label: string
  color: string
  assets: TradeDraftAsset[]
  total: number
}): JSX.Element {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="row-between" style={{ marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: props.color }}>
          {props.label}
        </span>
        <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: props.color }}>{props.total.toFixed(1)}</span>
      </div>
      <div className="stack" style={{ gap: 3 }}>
        {props.assets.length === 0 && <span className="muted small">—</span>}
        {props.assets.map((a) => (
          <div key={a.key} className="row-between" style={{ gap: 6, fontSize: 12 }}>
            <span className="row" style={{ gap: 5, alignItems: 'center', minWidth: 0 }}>
              {a.kind === 'player'
                ? <PlayerFace faceId={a.faceId} name={a.name} size={18} />
                : <span style={{ display: 'inline-flex', color: 'var(--muted)' }}><Icon size={14}><Icons.Ticket /></Icon></span>}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.name}
                {a.viaAbbr && <span className="muted" style={{ fontSize: 10 }}> (via {a.viaAbbr})</span>}
              </span>
            </span>
            <ValuePill value={a.value} drivers={a.drivers} estimated={a.estimated} />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The deal desk. As you build a package, every asset's value (the same points
 * the AI weighs) is broken out per side with subtotals and a NET; a plain
 * market read ("Fair" / "You're overpaying by ~X%") sits alongside the
 * partner's projected answer ("They'd reject this") and your AGM's take. The
 * "Gauge interest" button still pulls the club's non-binding word before you
 * commit — a warm read is not a yes; a real offer still gets slept on.
 */
function DealDeskPanel(props: {
  draft: TradeDraftView | null
  interest: TradeInterestView | null
  gauging: boolean
  canGauge: boolean
  onGauge: () => void
}): JSX.Element {
  const { draft, interest } = props
  const total = draft ? draft.giveTotal + draft.receiveTotal : 0
  return (
    <Panel title="Deal balance">
      {draft && (
        <>
          <div style={{ display: 'flex', gap: 14 }}>
            <DealColumn label="You give" color="var(--danger)" assets={draft.give} total={draft.giveTotal} />
            <div style={{ width: 1, background: 'var(--line)', alignSelf: 'stretch' }} />
            <DealColumn label="You get" color="var(--success)" assets={draft.receive} total={draft.receiveTotal} />
          </div>

          <div className="row-between" style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: MARKET_TONE[draft.marketVerdict] }}>{draft.marketLine}</span>
            <span
              className="mono"
              style={{ fontSize: 13, fontWeight: 700, color: draft.net >= 0 ? 'var(--success)' : 'var(--danger)' }}
              title="Net value swing in your favour (in trade points)"
            >
              NET {draft.net >= 0 ? '+' : ''}{draft.net.toFixed(1)}
            </span>
          </div>
          {total > 0 && <ValueBalance give={draft.giveTotal / total} receive={draft.receiveTotal / total} />}

          {draft.marketVerdict !== 'empty' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10 }}>
              <span style={{ display: 'inline-flex', color: 'var(--muted)', marginTop: 1 }}><Icon size={16}><Icons.Waivers /></Icon></span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{draft.agmName} · your read</div>
                <div style={{ fontSize: 13, color: ASSESS_TONE[draft.agmTone], fontWeight: 500 }}>{draft.agmLine}</div>
              </div>
            </div>
          )}

          {draft.partnerVerdict !== 'empty' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <span
                className="chip"
                style={{ fontSize: 10, fontWeight: 700, color: PARTNER_TONE[draft.partnerVerdict].color, borderColor: PARTNER_TONE[draft.partnerVerdict].color }}
              >
                {PARTNER_TONE[draft.partnerVerdict].label}
              </span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{draft.partnerLine}</span>
            </div>
          )}
        </>
      )}

      {interest ? (
        <div style={{
          borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 10, display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <span style={{ display: 'inline-flex', color: 'var(--muted)', marginTop: 1 }}><Icon size={18}><Icons.Phone /></Icon></span>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>you gauged their interest</span>
              <span className="chip" style={{ fontSize: 10, fontWeight: 700, color: INTEREST_TONE[interest.lean].color, borderColor: INTEREST_TONE[interest.lean].color }}>
                {INTEREST_TONE[interest.lean].label}
              </span>
            </div>
            <div style={{ fontSize: 13 }}>{interest.line}</div>
            {interest.lean !== 'blocked' && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, fontStyle: 'italic' }}>
                Just a read — nothing's official until you send it, and they'll take a day or two to answer for real.
              </div>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!props.canGauge || props.gauging}
          onClick={props.onGauge}
          style={{ fontSize: 12, width: '100%', marginTop: 10, borderTop: draft ? '1px solid var(--line)' : undefined }}
          title="Ask the other club how they feel about this package — without officially offering it"
        >
          {props.gauging ? 'Calling around…' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon size={14}><Icons.Phone /></Icon> Gauge their interest</span>}
        </button>
      )}
    </Panel>
  )
}

// ─── rumor mill ───────────────────────────────────────────────────────────────

/** Heat bar for a trade rumor (0–100). Pulses red near the deadline. */
function HeatBar(props: { heat: number; nearDeadline: boolean }): JSX.Element {
  const { heat, nearDeadline } = props
  const pct = Math.min(100, Math.max(0, heat))
  const color =
    pct >= 70
      ? nearDeadline
        ? 'var(--red)'
        : 'var(--orange)'
      : pct >= 40
      ? 'var(--amber)'
      : 'var(--muted)'
  return (
    <div
      style={{
        width: 64,
        height: 6,
        background: 'var(--bg3)',
        borderRadius: 999,
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          background: color,
          borderRadius: 999,
          transition: 'width 0.25s ease',
          ...(nearDeadline && pct >= 70
            ? { animation: 'rumor-pulse 1.4s ease-in-out infinite' }
            : {}),
        }}
      />
    </div>
  )
}

function RumorMillPanel(props: {
  rumors: TradeRumorView[]
  deadlineDay: number
  deadlinePassed: boolean
  currentDay: number
  lastDeadlineRecap: TentpoleView['lastDeadlineRecap']
}): JSX.Element {
  const { rumors, deadlineDay, deadlinePassed, currentDay, lastDeadlineRecap } = props
  const nav = useNav()
  const daysToDeadline = deadlineDay - currentDay

  const deadlineChipClass =
    deadlinePassed
      ? 'chip chip-danger'
      : daysToDeadline <= 3
      ? 'chip chip-danger'
      : daysToDeadline <= 7
      ? 'chip chip-warn'
      : 'chip chip-info'

  const deadlineLabel = deadlinePassed
    ? `Deadline passed (day ${deadlineDay})`
    : `Deadline: day ${deadlineDay} — ${daysToDeadline} day${daysToDeadline === 1 ? '' : 's'}`

  const nearDeadline = !deadlinePassed && daysToDeadline <= 5

  return (
    <Panel title="Rumor mill">
      {/* deadline chip */}
      <div className="row" style={{ marginBottom: 'var(--sp-3)', gap: 'var(--sp-2)' }}>
        <span className={deadlineChipClass} style={{ fontSize: 11 }}>
          {deadlineLabel}
        </span>
        {nearDeadline && (
          <span className="chip chip-danger" style={{ fontSize: 11 }}>
            Deadline approaching
          </span>
        )}
      </div>

      {/* deadline recap */}
      {deadlinePassed && lastDeadlineRecap && lastDeadlineRecap.length > 0 && (
        <DeadlineRecapCard recap={lastDeadlineRecap} />
      )}

      {/* rumor rows */}
      {rumors.length === 0 ? (
        <span className="muted small">No active trade rumors.</span>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Pos / Age</th>
                <th>Team</th>
                <th style={{ width: 120 }}>Heat</th>
                <th className="num" style={{ width: 60 }}>Since</th>
              </tr>
            </thead>
            <tbody>
              {[...rumors]
                .sort((a, b) => b.heat - a.heat)
                .map((r) => (
                  <tr key={r.playerId}>
                    <td>
                      <span className="row" style={{ gap: 8, alignItems: 'center' }}>
                        <PlayerFace faceId={r.faceId} name={r.playerName} size={26} />
                        <button
                          type="button"
                          className="player-link"
                          onClick={() => nav.navigate('player', { playerId: r.playerId })}
                        >
                          {r.playerName}
                        </button>
                      </span>
                    </td>
                    <td className="muted small">{r.position ?? '—'}{r.age !== undefined ? ` · ${r.age}` : ''}</td>
                    <td>
                      <span className="chip" style={{ fontSize: 11 }}>
                        {r.teamAbbr}
                      </span>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <HeatBar heat={r.heat} nearDeadline={nearDeadline} />
                        <span
                          className="muted small mono"
                          style={{ fontSize: 11, minWidth: 28, textAlign: 'right' }}
                        >
                          {r.heat}
                        </span>
                      </div>
                    </td>
                    <td className="num muted small">Day {r.sinceDay}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

/** Letter grade from a simple heuristic — more assets = better grade. */
function tradeGrade(gave: string[], received: string[]): string {
  const diff = received.length - gave.length
  if (diff >= 2) return 'A'
  if (diff === 1) return 'B+'
  if (diff === 0) return 'B'
  if (diff === -1) return 'C'
  return 'D'
}

function gradeColor(grade: string): string {
  if (grade.startsWith('A')) return 'var(--green)'
  if (grade.startsWith('B')) return 'var(--cyan)'
  if (grade.startsWith('C')) return 'var(--amber)'
  return 'var(--red)'
}

function DeadlineRecapCard(props: {
  recap: NonNullable<TentpoleView['lastDeadlineRecap']>
}): JSX.Element {
  return (
    <div style={{ marginBottom: 'var(--sp-3)' }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.8px',
          color: 'var(--violet-h)',
          marginBottom: 'var(--sp-2)',
        }}
      >
        Deadline recap — {props.recap.length} trade{props.recap.length !== 1 ? 's' : ''}
      </div>
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-2)',
          maxHeight: 280,
          overflowY: 'auto',
        }}
      >
        {props.recap.map((t, i) => {
          const gradeA = tradeGrade(t.aGave, t.bGave)
          const gradeB = tradeGrade(t.bGave, t.aGave)
          return (
            <div
              key={i}
              style={{
                background: 'var(--bg0)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 12px',
                fontSize: 12,
              }}
            >
              <div
                className="row-between"
                style={{ marginBottom: 6, fontWeight: 600, fontSize: 13 }}
              >
                <span>
                  <span style={{ color: 'var(--text)' }}>{t.teamAAbbr}</span>
                  <span className="muted" style={{ margin: '0 6px' }}>↔</span>
                  <span style={{ color: 'var(--text)' }}>{t.teamBAbbr}</span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <span style={{ color: gradeColor(gradeA), fontWeight: 700, fontSize: 12 }}>
                    {t.teamAAbbr}: {gradeA}
                  </span>
                  <span style={{ color: gradeColor(gradeB), fontWeight: 700, fontSize: 12 }}>
                    {t.teamBAbbr}: {gradeB}
                  </span>
                </span>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span className="muted" style={{ fontSize: 10 }}>{t.teamAAbbr} gives: </span>
                  {t.aGave.length > 0 ? (
                    t.aGave.map((asset, j) => (
                      <span
                        key={j}
                        className="chip"
                        style={{ fontSize: 10, marginRight: 3, marginBottom: 2 }}
                      >
                        {asset}
                      </span>
                    ))
                  ) : (
                    <span className="muted" style={{ fontSize: 11 }}>—</span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span className="muted" style={{ fontSize: 10 }}>{t.teamBAbbr} gives: </span>
                  {t.bGave.length > 0 ? (
                    t.bGave.map((asset, j) => (
                      <span
                        key={j}
                        className="chip"
                        style={{ fontSize: 10, marginRight: 3, marginBottom: 2 }}
                      >
                        {asset}
                      </span>
                    ))
                  ) : (
                    <span className="muted" style={{ fontSize: 11 }}>—</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── main screen ──────────────────────────────────────────────────────────────

type Tab = 'offers' | 'build' | 'block'

export function TradesScreen(): JSX.Element {
  const client = useClient()
  const { data, loading, error, refetch } = useScreenData<TradesView>(
    () => client.getTrades(),
    (r) => (r.type === 'trades' ? r.trades : null)
  )

  const { data: tentpoles } = useScreenData<TentpoleView>(
    () => client.getTentpoles(),
    (r) => (r.type === 'tentpoles' ? r.tentpoles : null)
  )

  const [tab, setTab] = useState<Tab>('offers')
  const [seed, setSeed] = useState<TradeSeed | null>(null)

  /** Counter an incoming offer: preload the builder with its players + partner,
   *  switch to the build tab, and clear the original offer off the desk. */
  function counterOffer(offer: TradeOfferView): void {
    setSeed({
      partnerId: offer.receive.teamId,
      myPlayerIds: offer.give.players.map((p) => p.playerId),
      theirPlayerIds: offer.receive.players.map((p) => p.playerId),
      nonce: Date.now(),
    })
    setTab('build')
    void client.rejectTrade(offer.offerId).then(refetch)
  }

  // infer currentDay from expiry info — use 0 as fallback
  const currentDay = 0
  const incomingCount = data?.incoming.length ?? 0
  const rumorCount = tentpoles?.rumors.length ?? 0

  return (
    <section className="stack">
      <ScreenHeader title="Trade Centre">
        {data && (
          <span className={data.tradingOpen ? 'chip chip-success' : 'chip chip-danger'}>
            {data.tradingOpen ? 'Trading open' : 'Deadline passed — frozen'}
          </span>
        )}
      </ScreenHeader>

      <ScreenStateNotices
        loading={loading && !data}
        error={error}
        empty={!loading && !error && !data}
        emptyText="No trade data yet."
      />

      {data && (
        <>
          {/* segmented tab bar */}
          <div className="tabs">
            <button className={`tab${tab === 'offers' ? ' active' : ''}`} onClick={() => setTab('offers')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon size={14}><Icons.Mail /></Icon> Offers{incomingCount > 0 && <span className="badge" style={{ marginLeft: 6 }}>{incomingCount}</span>}
            </button>
            <button
              className={`tab${tab === 'build' ? ' active' : ''}`}
              onClick={() => setTab('build')}
              disabled={!data.tradingOpen}
              title={data.tradingOpen ? undefined : 'The deadline has passed — no new deals.'}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icon size={14}><Icons.Wrench /></Icon> Build a Trade
            </button>
            <button className={`tab${tab === 'block' ? ' active' : ''}`} onClick={() => setTab('block')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon size={14}><Icons.Hot /></Icon> Trade Block{rumorCount > 0 && <span className="badge" style={{ marginLeft: 6 }}>{rumorCount}</span>}
            </button>
          </div>

          {tab === 'offers' && (
            <div className="stack">
              {!data.tradingOpen && (
                <Notice kind="warn">The trade deadline has passed. Trades are frozen for the rest of the season.</Notice>
              )}
              {data.incoming.length === 0 ? (
                <Notice kind="info">
                  No offers on your desk right now. Shop a player from <b>Build a Trade</b>, or watch the <b>Trade Block</b> for names on the move.
                </Notice>
              ) : (
                data.incoming.map((offer) => (
                  <OfferCard key={offer.offerId} offer={offer} currentDay={currentDay} onAction={refetch} onCounter={counterOffer} />
                ))
              )}
            </div>
          )}

          {tab === 'build' && (
            data.tradingOpen
              ? <ProposeTab data={data} onRefetch={refetch} currentDay={currentDay} seed={seed} />
              : <Notice kind="warn">The trade deadline has passed — no new deals until the offseason.</Notice>
          )}

          {tab === 'block' && (
            tentpoles
              ? <RumorMillPanel
                  rumors={tentpoles.rumors}
                  deadlineDay={tentpoles.deadlineDay}
                  deadlinePassed={tentpoles.deadlinePassed}
                  currentDay={currentDay}
                  lastDeadlineRecap={tentpoles.lastDeadlineRecap}
                />
              : <Notice kind="info">The trade block is quiet — no names on the move yet.</Notice>
          )}
        </>
      )}
    </section>
  )
}
