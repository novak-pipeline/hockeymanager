import { useEffect, useMemo, useRef, useState } from 'react'
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
} from '../../engine/career/views'
import { assetValueTier } from '../../engine/league/trades'
import { PlayerLink, useNav } from '../components/NavContext'
import { PlayerFace } from '../components/PlayerFace'
import { TeamCrest } from '../components/Crest'
import { OverallStars } from '../components/Stars'
import { Notice, Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { Icon } from '../components/primitives'
import { Icons } from '../components/icons'
import { fmtMoney } from '../components/format'
import { useClient, useScreenData } from '../hooks/useSim'
import { useUserTeamId } from '../components/UserTeamContext'
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

/**
 * Trade value, read as a METER rather than a decimal.
 *
 * A bare `22.9` reads like a spreadsheet and implies a precision the model does
 * not have, so the primary read is a tier word ("Core piece", "Star") over a
 * segmented bar, EA-NHL style.
 *
 * Playtest 2026-08-26 §D2: the number and the model's own factor list were
 * still one hover away — *"that information shouldn't be visible to the
 * player"* — which put the raw 0–100 overall back on screen (the one number
 * this game deliberately never shows; see components/Stars.tsx) alongside the
 * exact points the AI weighs. Replacing the decimal with a bar and then
 * smuggling the decimal back into its tooltip defeated the change. The hover
 * now says what the bar means in words and nothing more: a GM knows a Core
 * piece from a Depth piece; he does not get the engine's ledger.
 */
const TIER_COLOR = (tier: number): string =>
  tier >= 6 ? 'var(--success)'
  : tier >= 5 ? 'var(--accent, #f5b301)'
  : tier >= 3 ? 'var(--accent2, #e0b341)'
  : 'var(--muted)'

const METER_SEGMENTS = 6

/**
 * What each tier means around the league, in one clause. No figures.
 * Indexed by the tier number `assetValueTier` returns, so the clause always
 * elaborates the label beside it rather than quietly disagreeing with it
 * (6 Franchise · 5 Star · 4 Top-line · 3 Core piece · 2 Roster player ·
 * 1 Depth · 0 Fringe — see TIER_BANDS in engine/league/trades.ts).
 */
const TIER_BLURB: Record<number, string> = {
  6: 'the man you build a club around; it would take a haul',
  5: 'a bona fide star; clubs would empty the cupboard',
  4: 'drives a top line or a top pair',
  3: 'the sort of name a deal gets built around',
  2: 'an everyday body, not a centrepiece',
  1: 'a useful add-on to a bigger package',
  0: 'a throw-in',
}

function ValueMeter(props: {
  value?: number | undefined
  estimated?: boolean | undefined
  title?: string | undefined
  /** Hide the tier word — for tight rows where the bar alone carries it. */
  compact?: boolean | undefined
}): JSX.Element | null {
  if (props.value === undefined) return null
  const { tier, label, fill } = assetValueTier(props.value)
  const color = TIER_COLOR(tier)
  const lit = Math.max(1, Math.round(fill * METER_SEGMENTS))
  const hover = [
    props.title,
    `${label} — ${TIER_BLURB[tier] ?? 'a throw-in'}${props.estimated ? '. Your scouts are still guessing at him.' : ''}`,
  ].filter(Boolean).join('\n')
  return (
    <span
      title={hover}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'help', whiteSpace: 'nowrap' }}
    >
      {!props.compact && (
        <span style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: '0.2px' }}>
          {props.estimated ? '~' : ''}{label}
        </span>
      )}
      <span style={{ display: 'inline-flex', gap: 1.5, alignItems: 'center' }} aria-hidden>
        {Array.from({ length: METER_SEGMENTS }, (_, i) => (
          <span
            key={i}
            style={{
              width: 4,
              height: 9,
              borderRadius: 1,
              background: i < lit ? color : 'var(--line)',
              opacity: i < lit ? (props.estimated ? 0.6 : 1) : 0.55,
            }}
          />
        ))}
      </span>
    </span>
  )
}

function PlayerChip(props: {
  name: string
  playerId: string
  salary: number
  yearsRemaining: number
  noTradeClause?: boolean | undefined
  /** Trade value on the shared asset-value scale (same currency as pick value). */
  value?: number | undefined
  badge?: PlayerBadge | undefined
}): JSX.Element {
  return (
    <div
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
      <ValueMeter value={props.value} compact title="Trade value" />
      {props.noTradeClause && <span className="chip chip-danger" style={{ fontSize: 10 }}>NTC</span>}
    </div>
  )
}

function PickChip(props: { pick: PickAssetView }): JSX.Element {
  const { pick } = props
  return (
    <span
      title={pick.viaAbbr ? `Originally ${pick.viaAbbr}'s pick` : undefined}
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
      <ValueMeter value={pick.value} compact />
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
      {/* A deal the club cannot legally complete stays on the desk — it may fit
          again once salary moves — but the button that would throw is closed. */}
      {offer.blockedReason && <Notice kind="warn">{offer.blockedReason}</Notice>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn btn-primary"
          disabled={busy || !!offer.blockedReason}
          title={offer.blockedReason}
          onClick={doAccept}
        >
          Accept
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() => props.onCounter(offer)}
          title="Open the builder with every player and pick from this deal already selected, so you can tweak it and send it back"
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

/**
 * A counter's starting point: the partner and EVERY asset from the offer being
 * countered — players and picks on both sides.
 *
 * Playtest 2026-08-26 §D1: *"countering should start from what was proposed."*
 * The picks were the hole: a deal built around a 1st and a 3rd re-opened with
 * only the bodies ticked, so countering a pick-heavy offer meant rebuilding it
 * from memory. `nonce` forces a re-seed if another counter comes in mid-edit.
 */
interface TradeSeed {
  /** Why the builder was pre-loaded — the banner reads differently for each. */
  reason: 'counter' | 'enquiry'
  partnerId: string
  myPlayerIds: string[]
  myPickIds: string[]
  theirPlayerIds: string[]
  theirPickIds: string[]
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
  const [myPickIds, setMyPickIds] = useState<Set<string>>(new Set(props.seed?.myPickIds ?? []))
  const [theirPlayerIds, setTheirPlayerIds] = useState<Set<string>>(new Set(props.seed?.theirPlayerIds ?? []))
  const [theirPickIds, setTheirPickIds] = useState<Set<string>>(new Set(props.seed?.theirPickIds ?? []))

  // True while the board on screen is still the one we were handed. Cleared the
  // moment the GM wipes it or picks a different club, so the banner explaining
  // where the board came from cannot outlive the board it describes.
  const [seedLive, setSeedLive] = useState(!!props.seed)

  // Re-seed when a NEW counter arrives while the builder is already mounted.
  const seedNonce = props.seed?.nonce
  useEffect(() => {
    if (!props.seed) return
    setPartnerId(props.seed.partnerId)
    setMyPlayerIds(new Set(props.seed.myPlayerIds))
    setTheirPlayerIds(new Set(props.seed.theirPlayerIds))
    setMyPickIds(new Set(props.seed.myPickIds))
    setTheirPickIds(new Set(props.seed.theirPickIds))
    setSeedLive(true)
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
    setSeedLive(false)
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

  // §D1: say out loud that the board was loaded from somewhere, so the ticked
  // boxes read as "their proposal" rather than as leftovers from a past session.
  const seededName = props.seed && seedLive
    ? data.partners.find((p) => p.teamId === props.seed!.partnerId)?.teamName
    : undefined

  return (
    <div className="stack">
      {seededName && (
        <Notice kind="info">
          {props.seed!.reason === 'counter' ? (
            <>
              Countering <b>{seededName}</b>'s offer — every player and pick they proposed is already
              on the board. Adjust what you like and send it back.
            </>
          ) : (
            <>
              Enquiring with <b>{seededName}</b> — the man you clicked is already asked for.
              Put something of yours beside it.
            </>
          )}
        </Notice>
      )}
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
                        <ValueMeter
                          value={p.tradeValue}
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
                        <span title={pk.viaAbbr ? `Originally ${pk.viaAbbr}'s pick` : undefined}>
                          {pk.label}
                          {pk.viaAbbr && <span style={{ opacity: 0.7, fontSize: 10 }}> (via {pk.viaAbbr})</span>}
                          <span style={{ marginLeft: 5, display: 'inline-flex', verticalAlign: 'middle' }}>
                            <ValueMeter value={pk.value} compact />
                          </span>
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
                        <ValueMeter
                          value={p.tradeValue}
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
                        <span title={pk.viaAbbr ? `Originally ${pk.viaAbbr}'s pick` : undefined}>
                          {pk.label}
                          {pk.viaAbbr && <span style={{ opacity: 0.7, fontSize: 10 }}> (via {pk.viaAbbr})</span>}
                          <span style={{ marginLeft: 5, display: 'inline-flex', verticalAlign: 'middle' }}>
                            <ValueMeter value={pk.value} compact />
                          </span>
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
function ValueBalance({ give }: { give: number; receive: number }): JSX.Element {
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
        <ValueMeter value={props.total} title={`${props.label} — package total`} />
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
            <span className="row" style={{ gap: 6, alignItems: 'center', flexShrink: 0 }}>
              <ValueMeter value={a.value} estimated={a.estimated} />
              {/* A2: the partner's own read, shown only where it actually
                  differs — a silent agreement needs no annotation. */}
              {a.partnerValue !== undefined && Math.abs(a.partnerValue - a.value) / Math.max(a.value, 1) >= 0.08 && (
                <span
                  title={a.partnerValue > a.value ? 'They rate him higher than the market does' : 'They rate him lower than the market does'}
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    padding: '0 4px',
                    borderRadius: 3,
                    cursor: 'help',
                    color: a.partnerValue > a.value ? 'var(--success)' : 'var(--danger)',
                    border: `1px solid ${a.partnerValue > a.value ? 'var(--success)' : 'var(--danger)'}`,
                    opacity: 0.85,
                  }}
                >
                  THEM {a.partnerValue > a.value ? '▲' : '▼'}
                </span>
              )}
            </span>
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
              style={{ fontSize: 11, fontWeight: 700, color: draft.net >= 0 ? 'var(--success)' : 'var(--danger)' }}
              title={draft.net >= 0
                ? 'On paper you come out of this ahead'
                : 'On paper you are giving up the better of it'}
            >
              {draft.net >= 0 ? 'IN YOUR FAVOUR' : 'AGAINST YOU'}
            </span>
          </div>
          {total > 0 && <ValueBalance give={draft.giveTotal / total} receive={draft.receiveTotal / total} />}

          {/* A2: the same deal on the partner's book. A market-even package can
              still be a loser to a club whose posture prices your side down —
              this is the line that says so out loud. */}
          {draft.lensLine && draft.partnerGiveTotal !== undefined && draft.partnerReceiveTotal !== undefined && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--line)' }}>
              <div className="row-between" style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 3 }}>
                <span style={{ fontWeight: 700, letterSpacing: '0.4px' }}>THEIR BOOK</span>
                <span className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <ValueMeter value={draft.partnerGiveTotal} compact title="What they think your side is worth" />
                  <span style={{ opacity: 0.5 }}>vs</span>
                  <ValueMeter value={draft.partnerReceiveTotal} compact title="What they think their side is worth" />
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{draft.lensLine}</div>
            </div>
          )}

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

/* ── §D3: the trade block, browsable ──────────────────────────────────────
 *
 * Playtest 2026-08-26 §D3: *"the trade block is one long list."* It was: every
 * name in the league on the move, in a flat table sorted by heat, with the
 * player's position and age as the only facts about him. Nothing said what he
 * costs, how long he's signed for, whether he's a rental, or whether he plays
 * a position this club is short at — so the only way to shop was to click into
 * thirty profiles.
 *
 * The board now carries all of that on the card, and the list can be cut down
 * to the men worth a phone call: by position, by whether he fills a hole here,
 * by whether he's a rental, by whether he fits under the cap. What's left is
 * grouped by how live the name is, because "who is actually available right
 * now" is the first question at a deadline.
 */

/** How live a name is. The grouping a GM reads the block in. */
const HEAT_BANDS = [
  { key: 'hot', min: 70, title: 'Available now', blurb: "clubs are taking calls — these deals can happen today" },
  { key: 'warm', min: 40, title: 'Listening', blurb: 'the right offer would get a conversation' },
  { key: 'cool', min: 0, title: 'Quiet chatter', blurb: "his name is out there, but nobody's shopping him hard" },
] as const

type BlockFilter = 'all' | 'F' | 'D' | 'G'

function posGroup(position: string | undefined): BlockFilter {
  if (position === 'G') return 'G'
  if (position === 'D') return 'D'
  return 'F'
}

/** One name on the block, with everything a GM shops on. */
function BlockCard(props: {
  r: TradeRumorView
  nearDeadline: boolean
  capSpace: number | undefined
  onEnquire: (r: TradeRumorView) => void
  canEnquire: boolean
}): JSX.Element {
  const { r } = props
  const nav = useNav()
  const userTeamId = useUserTeamId()
  // The block is league-wide, so your own name can be on it — which is news in
  // itself. You cannot trade with yourself, so that row loses its Enquire.
  const isYours = r.teamId === userTeamId
  const overCap = props.capSpace !== undefined && r.salary !== undefined && r.salary > props.capSpace
  return (
    <div
      style={{
        display: 'flex', gap: 10, padding: '10px 12px', minWidth: 0,
        background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)',
      }}
    >
      <PlayerFace faceId={r.faceId} name={r.playerName} size={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="player-link" onClick={() => nav.navigate('player', { playerId: r.playerId })}>
            {r.playerName}
          </button>
          {r.overall !== undefined && (
            r.scouted && !r.scouted.exact
              ? <span style={{ opacity: 0.6 }} title="Your scouts are still working on him">
                  <OverallStars value={Math.round((r.scouted.overallLo + r.scouted.overallHi) / 2)} />
                </span>
              : <OverallStars value={r.overall} />
          )}
          {isYours && (
            <span className="chip chip-warn" style={{ fontSize: 9 }} title="The league thinks you are shopping him">
              YOUR PLAYER
            </span>
          )}
          {r.fitsNeed && !isYours && (
            <span className="chip chip-success" style={{ fontSize: 9 }} title="He plays a position your club is thin at">
              FITS A NEED
            </span>
          )}
          {r.expiring && (
            <span className="chip chip-warn" style={{ fontSize: 9 }} title="Deal expires this summer — a rental unless you re-sign him">
              RENTAL
            </span>
          )}
        </div>
        <div className="muted small" style={{ marginTop: 2 }}>
          {r.position ?? '—'}{r.age !== undefined ? ` · ${r.age}` : ''} · {r.teamName ?? r.teamAbbr}
        </div>
        <div className="row" style={{ gap: 8, marginTop: 5, alignItems: 'center', flexWrap: 'wrap' }}>
          {r.salary !== undefined && (
            <span
              className="small"
              style={{ color: overCap ? 'var(--danger)' : 'var(--text)', whiteSpace: 'nowrap' }}
              title={overCap ? 'More than your cap space — you would have to send money back' : 'Cap hit'}
            >
              {fmtMoney(r.salary)}
              {r.yearsRemaining !== undefined && <span className="muted"> / {r.yearsRemaining}yr</span>}
            </span>
          )}
          <ValueMeter value={r.tradeValue} estimated={r.valueEstimated} compact title="What he costs to prise loose" />
          <HeatBar heat={r.heat} nearDeadline={props.nearDeadline} />
        </div>
      </div>
      {props.canEnquire && !isYours && (
        <button
          className="btn btn-ghost"
          style={{ alignSelf: 'center', fontSize: 11, whiteSpace: 'nowrap' }}
          onClick={() => props.onEnquire(r)}
          title={`Open the builder with ${r.teamAbbr} on the other side and ${r.playerName} already asked for`}
        >
          Enquire
        </button>
      )}
    </div>
  )
}

function RumorMillPanel(props: {
  rumors: TradeRumorView[]
  deadlineDay: number
  deadlinePassed: boolean
  currentDay: number
  lastDeadlineRecap: TentpoleView['lastDeadlineRecap']
  /** Cap space, so "can I even fit him" is a filter and not a guess. */
  capSpace?: number | undefined
  /** Open the builder against this club with the player already selected. */
  onEnquire?: ((r: TradeRumorView) => void) | undefined
}): JSX.Element {
  const { rumors, deadlineDay, deadlinePassed, currentDay, lastDeadlineRecap } = props
  const daysToDeadline = deadlineDay - currentDay

  const [pos, setPos] = useState<BlockFilter>('all')
  const [needsOnly, setNeedsOnly] = useState(false)
  const [rentalsOnly, setRentalsOnly] = useState(false)
  const [affordableOnly, setAffordableOnly] = useState(false)
  const [search, setSearch] = useState('')

  const shown = useMemo(() => rumors.filter((r) => {
    if (pos !== 'all' && posGroup(r.position) !== pos) return false
    if (needsOnly && !r.fitsNeed) return false
    if (rentalsOnly && !r.expiring) return false
    if (affordableOnly && props.capSpace !== undefined && (r.salary ?? 0) > props.capSpace) return false
    if (search && !r.playerName.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [rumors, pos, needsOnly, rentalsOnly, affordableOnly, search, props.capSpace])

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

  const bands = HEAT_BANDS.map((band, i) => {
    const upper = i === 0 ? Infinity : HEAT_BANDS[i - 1]!.min
    return { band, rows: shown.filter((r) => r.heat >= band.min && r.heat < upper).sort((a, b) => b.heat - a.heat) }
  }).filter((g) => g.rows.length > 0)

  const chip = (active: boolean, label: string, onClick: () => void, title: string): JSX.Element => (
    <button
      key={label}
      type="button"
      className={`chip${active ? ' chip-accent' : ''}`}
      style={{ cursor: 'pointer', border: 'none', fontSize: 11 }}
      onClick={onClick}
      title={title}
    >
      {label}
    </button>
  )

  return (
    <Panel title="The trade block">
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

      {rumors.length === 0 ? (
        <span className="muted small">Nobody is on the block right now. Names appear as clubs give up on their seasons.</span>
      ) : (
        <>
          <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--sp-3)' }}>
            {(['all', 'F', 'D', 'G'] as const).map((p) =>
              chip(pos === p, p === 'all' ? 'All' : p, () => setPos(p), p === 'all' ? 'Every name on the block' : `${p} only`))}
            <span style={{ width: 1, height: 16, background: 'var(--line)', margin: '0 4px' }} />
            {chip(needsOnly, 'Fits a need', () => setNeedsOnly((v) => !v), 'Only positions your club is thin at')}
            {chip(rentalsOnly, 'Rentals', () => setRentalsOnly((v) => !v), 'Only men whose deals expire this summer')}
            {props.capSpace !== undefined
              && chip(affordableOnly, 'Fits my cap', () => setAffordableOnly((v) => !v), `Only cap hits under ${fmtMoney(props.capSpace)}`)}
            <input
              className="input"
              placeholder="Search name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginLeft: 'auto', width: 160, padding: '4px 10px', fontSize: 12 }}
            />
          </div>

          {shown.length === 0 ? (
            <span className="muted small">
              No name on the block matches that. Loosen a filter — the market is what it is.
            </span>
          ) : (
            <div className="stack" style={{ gap: 'var(--sp-4)' }}>
              {bands.map(({ band, rows }) => (
                <div key={band.key}>
                  <div className="row" style={{ gap: 8, alignItems: 'baseline', marginBottom: 'var(--sp-2)' }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{band.title}</span>
                    <span className="muted small">{rows.length} · {band.blurb}</span>
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                      gap: 'var(--sp-2)',
                    }}
                  >
                    {rows.map((r) => (
                      <BlockCard
                        key={r.playerId}
                        r={r}
                        nearDeadline={nearDeadline}
                        capSpace={props.capSpace}
                        canEnquire={!!props.onEnquire}
                        onEnquire={(x) => props.onEnquire?.(x)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
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
      reason: 'counter',
      partnerId: offer.receive.teamId,
      myPlayerIds: offer.give.players.map((p) => p.playerId),
      myPickIds: offer.give.picks.map((pk) => pk.id),
      theirPlayerIds: offer.receive.players.map((p) => p.playerId),
      theirPickIds: offer.receive.picks.map((pk) => pk.id),
      nonce: Date.now(),
    })
    setTab('build')
    void client.rejectTrade(offer.offerId).then(refetch)
  }

  /** §D3: pick a name off the block and the builder opens on his club with him
   *  already asked for — the block is a shopping list, so it has to buy. */
  function enquireOn(r: TradeRumorView): void {
    setSeed({
      reason: 'enquiry',
      partnerId: r.teamId,
      myPlayerIds: [],
      myPickIds: [],
      theirPlayerIds: [r.playerId],
      theirPickIds: [],
      nonce: Date.now(),
    })
    setTab('build')
  }

  /** A6 escape (bar B2.2): the AGM works the phones and passes on the lot, so a
   *  desk full of offers can be cleared without answering each card. */
  const [declining, setDeclining] = useState(false)
  async function declineAll(): Promise<void> {
    setDeclining(true)
    const r = await client.declineAllTradeOffers()
    setDeclining(false)
    if (r.type === 'error') toast(r.message, 'error')
    else if (r.type === 'shopResult') toast(r.message)
    refetch()
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
                <>
                  {/* Playtest A6 / bar B2.2: a standing offer holds Continue, so it
                      needs a one-click way out that isn't "answer every card". */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      className="btn btn-ghost"
                      disabled={declining}
                      onClick={() => { void declineAll() }}
                      title="Hand the phones to your Assistant GM — he passes on every standing offer"
                    >
                      {declining ? 'Calling back…' : 'Let the AGM handle it — decline all'}
                    </button>
                  </div>
                  {data.incoming.map((offer) => (
                    <OfferCard key={offer.offerId} offer={offer} currentDay={currentDay} onAction={refetch} onCounter={counterOffer} />
                  ))}
                </>
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
                  capSpace={data.myCapSpace}
                  onEnquire={data.tradingOpen ? enquireOn : undefined}
                />
              : <Notice kind="info">The trade block is quiet — no names on the move yet.</Notice>
          )}
        </>
      )}
    </section>
  )
}
