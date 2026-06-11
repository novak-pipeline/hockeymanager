import { useState } from 'react'
import type { TentpoleView, TradeEvaluation, TradesView } from '../../worker/protocol'
import type {
  PickAssetView,
  PlayerBadge,
  TradeOfferView,
  TradePartnerView,
  TradeRumorView,
} from '../../engine/career/views'
import { PlayerLink, useNav } from '../components/NavContext'
import { Notice, Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { fmtMoney } from '../components/format'
import { useClient, useScreenData } from '../hooks/useSim'
import { toast } from '../components/store'

// ─── asset chips ──────────────────────────────────────────────────────────────

function OvrLabel({ badge }: { badge: PlayerBadge }): JSX.Element | null {
  if (badge.scouted && !badge.scouted.exact) {
    return (
      <span className="muted small" style={{ color: 'var(--muted)' }}>
        {badge.scouted.overallLo}–{badge.scouted.overallHi}
      </span>
    )
  }
  if (!badge.scouted) return null
  return <span className="muted small">{badge.overall}</span>
}

function PlayerChip(props: {
  name: string
  playerId: string
  salary: number
  yearsRemaining: number
  noTradeClause?: boolean
  badge?: PlayerBadge
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
      {props.noTradeClause && <span className="chip chip-danger" style={{ fontSize: 10 }}>NTC</span>}
    </div>
  )
}

function PickChip(props: { pick: PickAssetView }): JSX.Element {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 10px',
        background: 'rgba(139,92,246,0.10)',
        border: '1px solid rgba(139,92,246,0.35)',
        borderRadius: 6,
        fontSize: 12,
        color: 'var(--accent)',
        whiteSpace: 'nowrap',
      }}
    >
      {props.pick.label}
    </span>
  )
}

// ─── trade side summary (receive / give) ──────────────────────────────────────

function TradeSideChips(props: {
  players: Array<PlayerBadge & { salary: number; yearsRemaining: number; noTradeClause?: boolean }>
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
          <span style={{ fontSize: 20 }}>✓</span>
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

// ─── propose tab ──────────────────────────────────────────────────────────────

function ProposeTab(props: {
  data: TradesView
  onRefetch: () => void
  currentDay: number
}): JSX.Element {
  const client = useClient()
  const { data } = props

  const [partnerId, setPartnerId] = useState(data.partners[0]?.teamId ?? '')
  const partner: TradePartnerView | undefined = data.partners.find((p) => p.teamId === partnerId)

  const [myPlayerIds, setMyPlayerIds] = useState<Set<string>>(new Set())
  const [myPickIds, setMyPickIds] = useState<Set<string>>(new Set())
  const [theirPlayerIds, setTheirPlayerIds] = useState<Set<string>>(new Set())
  const [theirPickIds, setTheirPickIds] = useState<Set<string>>(new Set())

  const [busy, setBusy] = useState(false)
  const [evalResult, setEvalResult] = useState<TradeEvaluation | null>(null)
  const [err, setErr] = useState<string | null>(null)

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

  const hasSelections =
    myPlayerIds.size > 0 || myPickIds.size > 0 || theirPlayerIds.size > 0 || theirPickIds.size > 0

  return (
    <div className="stack">
      {/* partner selector */}
      <Panel title="Trade partner">
        <select
          className="select"
          value={partnerId}
          onChange={(e) => {
            setPartnerId(e.target.value)
            resetSelections()
          }}
          style={{ maxWidth: 320 }}
        >
          {data.partners.map((p) => (
            <option key={p.teamId} value={p.teamId}>
              {p.teamName} ({p.teamAbbr})
            </option>
          ))}
        </select>
      </Panel>

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
                        background: selected ? 'rgba(139,92,246,0.14)' : 'var(--bg0)',
                        border: selected ? '1px solid rgba(139,92,246,0.5)' : '1px solid var(--line)',
                        borderRadius: 6,
                        cursor: ntc ? 'not-allowed' : 'pointer',
                        opacity: ntc ? 0.5 : 1,
                        fontSize: 13,
                        color: 'var(--text)',
                        textAlign: 'left',
                        gap: 8,
                      }}
                    >
                      <span>
                        <PlayerLink playerId={p.playerId} name={p.name} />
                        <span style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 12 }}>
                          {p.position} · {p.age}
                        </span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                          {fmtMoney(p.salary)} / {p.yearsRemaining}yr
                        </span>
                        {ntc && <span className="chip chip-danger" style={{ fontSize: 10 }}>NTC</span>}
                      </span>
                    </button>
                  )
                })}
              </div>
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
                          background: sel ? 'rgba(139,92,246,0.20)' : 'rgba(139,92,246,0.08)',
                          border: sel ? '1px solid rgba(139,92,246,0.6)' : '1px solid rgba(139,92,246,0.28)',
                          borderRadius: 6,
                          fontSize: 12,
                          color: 'var(--accent)',
                          cursor: 'pointer',
                        }}
                      >
                        {pk.label}
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
                  const ovrLabel = p.scouted && !p.scouted.exact
                    ? `${p.scouted.overallLo}–${p.scouted.overallHi}`
                    : String(p.overall)
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
                        background: selected ? 'rgba(139,92,246,0.14)' : 'var(--bg0)',
                        border: selected ? '1px solid rgba(139,92,246,0.5)' : '1px solid var(--line)',
                        borderRadius: 6,
                        cursor: ntc ? 'not-allowed' : 'pointer',
                        opacity: ntc ? 0.5 : 1,
                        fontSize: 13,
                        color: 'var(--text)',
                        textAlign: 'left',
                        gap: 8,
                      }}
                    >
                      <span>
                        <PlayerLink playerId={p.playerId} name={p.name} />
                        <span style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 12 }}>
                          {p.position} · {p.age}
                        </span>
                        {p.scouted && (
                          <span className="chip" style={{ marginLeft: 6, fontSize: 10 }}>
                            {ovrLabel}
                          </span>
                        )}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                          {fmtMoney(p.salary)} / {p.yearsRemaining}yr
                        </span>
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
                          background: sel ? 'rgba(139,92,246,0.20)' : 'rgba(139,92,246,0.08)',
                          border: sel ? '1px solid rgba(139,92,246,0.6)' : '1px solid rgba(139,92,246,0.28)',
                          borderRadius: 6,
                          fontSize: 12,
                          color: 'var(--accent)',
                          cursor: 'pointer',
                        }}
                      >
                        {pk.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </Panel>
        </div>
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
        <div>
          <button
            className="btn btn-primary"
            disabled={busy || !hasSelections || !partnerId}
            onClick={handlePropose}
          >
            {busy ? 'Sending…' : 'Propose trade'}
          </button>
        </div>
      )}
    </div>
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
                <th>Team</th>
                <th style={{ width: 80 }}>Heat</th>
                <th className="num" style={{ width: 60 }}>Since</th>
              </tr>
            </thead>
            <tbody>
              {[...rumors]
                .sort((a, b) => b.heat - a.heat)
                .map((r) => (
                  <tr key={r.playerId}>
                    <td>
                      <button
                        type="button"
                        className="player-link"
                        onClick={() => nav.navigate('player', { playerId: r.playerId })}
                      >
                        {r.playerName}
                      </button>
                    </td>
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

type Tab = 'incoming' | 'propose'

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

  const [tab, setTab] = useState<Tab>('incoming')

  // infer currentDay from expiry info — use 0 as fallback
  const currentDay = 0

  return (
    <section>
      <ScreenHeader title="Trades">
        {data && (
          <span className={data.tradingOpen ? 'chip chip-success' : 'chip chip-danger'}>
            {data.tradingOpen ? 'Trading open' : 'Trading closed'}
          </span>
        )}
      </ScreenHeader>

      <ScreenStateNotices
        loading={loading && !data}
        error={error}
        empty={!loading && !error && !data}
        emptyText="No trade data yet."
      />

      {/* Rumor mill panel — always shown when tentpoles available */}
      {tentpoles ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <RumorMillPanel
            rumors={tentpoles.rumors}
            deadlineDay={tentpoles.deadlineDay}
            deadlinePassed={tentpoles.deadlinePassed}
            currentDay={currentDay}
            lastDeadlineRecap={tentpoles.lastDeadlineRecap}
          />
        </div>
      ) : (
        !loading && (
          <div style={{ marginBottom: 'var(--sp-4)' }}>
            <Notice kind="warn">Rumor mill not available yet.</Notice>
          </div>
        )
      )}

      {data && !data.tradingOpen && (
        <Notice kind="warn" >
          The trade deadline has passed. Trades are frozen for the remainder of the season.
        </Notice>
      )}

      {data && (
        <>
          {!data.tradingOpen && <div style={{ marginBottom: 16 }} />}

          <div className="tabs">
            <button
              className={`tab${tab === 'incoming' ? ' active' : ''}`}
              onClick={() => setTab('incoming')}
            >
              Incoming offers
              {data.incoming.length > 0 && (
                <span className="badge" style={{ marginLeft: 6 }}>
                  {data.incoming.length}
                </span>
              )}
            </button>
            <button
              className={`tab${tab === 'propose' ? ' active' : ''}`}
              onClick={() => setTab('propose')}
              disabled={!data.tradingOpen}
            >
              Propose trade
            </button>
          </div>

          {tab === 'incoming' && (
            <div className="stack">
              {data.incoming.length === 0 ? (
                <Notice kind="info">No incoming offers at this time.</Notice>
              ) : (
                data.incoming.map((offer) => (
                  <OfferCard
                    key={offer.offerId}
                    offer={offer}
                    currentDay={currentDay}
                    onAction={refetch}
                  />
                ))
              )}
            </div>
          )}

          {tab === 'propose' && data.tradingOpen && (
            <ProposeTab data={data} onRefetch={refetch} currentDay={currentDay} />
          )}
        </>
      )}
    </section>
  )
}
