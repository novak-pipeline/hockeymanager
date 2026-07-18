/**
 * Deadline Day — the tentpole hub, staged while the sim is held on deadline day.
 *
 * Distinct from every other screen: a red countdown header, your posture + cap,
 * and three live panels read straight off the market —
 *   • YOUR PHONE — concrete offers rival GMs have tabled for your players right
 *     now (accept / counter / decline in place);
 *   • THE BLOCK — the league-wide "who's being shopped" board with asking prices;
 *   • THE WIRE — a live feed of AI-vs-AI deals as they land through the day.
 *
 * Everything here is real: the offers are acceptable {@link TradeOfferView}s, the
 * block is every selling club's movable veterans, and the wire is the actual
 * transaction ledger. When you continue, the window closes.
 */
import { useState } from 'react'
import type { DeadlineDayView, ShoppedPlayerView, TradeOfferView } from '../../engine/career/views'
import { Backdrop } from './BoardMeetingScreen'
import { PlayerFace } from '../components/PlayerFace'
import { PlayerLink, useNav } from '../components/NavContext'
import { Icon } from '../components/primitives'
import { Icons } from '../components/icons'
import { Notice } from '../components/ui'
import { fmtMoney } from '../components/format'
import { useClient, useScreenData } from '../hooks/useSim'
import { toast } from '../components/store'

const CARD_BG = 'rgba(8,10,15,0.85)'
const PANEL_BORDER = '1px solid rgba(255,255,255,0.12)'

// ─── your phone: a concrete incoming offer ──────────────────────────────────────

function OfferCall(props: { offer: TradeOfferView; onAction: () => void }): JSX.Element {
  const { offer } = props
  const client = useClient()
  const nav = useNav()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // The player of yours they're calling about (headlines the card + the face).
  const headliner = offer.give.players[0]

  async function act(kind: 'accept' | 'decline'): Promise<void> {
    setBusy(true)
    setErr(null)
    const r = kind === 'accept' ? await client.acceptTrade(offer.offerId) : await client.rejectTrade(offer.offerId)
    setBusy(false)
    if (r.type === 'error') { setErr(r.message); return }
    toast(kind === 'accept' ? 'Deal done.' : 'Passed.', kind === 'accept' ? 'success' : 'info')
    props.onAction()
  }

  const receiveBits = [
    ...offer.receive.players.map((p) => p.name),
    ...offer.receive.picks.map((pk) => pk.label),
  ]

  return (
    <div style={{ background: CARD_BG, border: PANEL_BORDER, borderRadius: 10, padding: '12px 14px' }}>
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        {headliner && <PlayerFace faceId={headliner.faceId} name={headliner.name} size={44} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Icon size={14}><Icons.Phone /></Icon> {offer.receive.teamAbbr} want {headliner ? <PlayerLink playerId={headliner.playerId} name={headliner.name} /> : 'a deal'}
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>{offer.receive.teamName}</div>
        </div>
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.5, margin: '8px 0', fontStyle: 'italic', color: 'var(--muted)' }}>
        “{offer.message}”
      </div>
      <div style={{ fontSize: 12.5, marginBottom: 10 }}>
        <span style={{ color: 'var(--success)' }}>You get:</span> {receiveBits.join(', ') || 'future considerations'}
      </div>
      {err && <Notice kind="warn">{err}</Notice>}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => act('accept')}>Accept</button>
        <button className="btn btn-sm" disabled={busy} onClick={() => nav.navigate('trades')} title="Open the trade office to counter">Counter →</button>
        <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => act('decline')}>Pass</button>
      </div>
    </div>
  )
}

// ─── the block: one shopped player row ──────────────────────────────────────────

function ShoppedRow(props: { p: ShoppedPlayerView }): JSX.Element {
  const { p } = props
  return (
    <tr>
      <td>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <PlayerFace faceId={p.faceId} name={p.name} size={30} />
          <div>
            <PlayerLink playerId={p.playerId} name={p.name} />
            <span className="muted small"> {p.position} · {p.age}</span>
          </div>
        </div>
      </td>
      <td className="muted">{p.teamAbbr}</td>
      <td className="small">
        {p.rental
          ? <span className="chip chip-warn" style={{ fontSize: 10 }}>rental</span>
          : <span className="muted">{p.yearsRemaining}yr · {fmtMoney(p.salary)}</span>}
      </td>
      <td className="small">{p.asking}</td>
      <td className="num muted small">{p.value.toFixed(0)}</td>
    </tr>
  )
}

export function DeadlineDayScreen(): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const { data: dd, loading, refetch } = useScreenData<DeadlineDayView>(
    () => client.getDeadlineDay(),
    (r) => (r.type === 'deadlineDay' ? r.deadlineDay : null),
  )

  if (loading) return <Notice kind="info">The phones are lighting up…</Notice>
  if (!dd) {
    return (
      <section className="stack">
        <Notice kind="info">The deadline desk is dark — it only opens on deadline day.</Notice>
      </section>
    )
  }

  return (
    <section style={{ height: '100%' }}>
      <Backdrop scene="war-room">
        {/* urgency header */}
        <div style={{ marginBottom: 'var(--sp-3)' }}>
          <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--danger, #e05555)', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--red)', display: 'inline-block', flexShrink: 0 }} />
            Trade Deadline · Live — the window closes when you continue
          </div>
          <h2 style={{ margin: '2px 0 0', fontSize: 24, fontWeight: 900 }}>Deadline Day</h2>
        </div>

        {/* stance + cap */}
        <div className="stack" style={{ gap: 6, maxWidth: 820, marginBottom: 'var(--sp-3)' }}>
          <div style={{ background: 'rgba(10,12,18,0.86)', backdropFilter: 'blur(6px)', border: PANEL_BORDER, borderRadius: 8, padding: '9px 13px', fontSize: 13.5, lineHeight: 1.5 }}>
            <b style={{ color: dd.buying ? 'var(--success)' : 'var(--accent, #d6a056)' }}>{dd.buying ? 'BUYING' : 'THE STANCE'}:</b> {dd.stance}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="chip" style={{ fontSize: 12 }}>{dd.capLine}</span>
            <span className="muted small" style={{ fontStyle: 'italic' }}>Coach: “{dd.coachLine}”</span>
          </div>
        </div>

        {/* three live panels */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,0.9fr)', gap: 'var(--sp-3)', maxWidth: 1040, marginBottom: 'var(--sp-3)' }}>
          {/* YOUR PHONE */}
          <div>
            <div style={SECTION_LABEL}><Icon size={14}><Icons.Phone /></Icon> Your phone — offers on the desk {dd.incoming.length > 0 && <span className="badge">{dd.incoming.length}</span>}</div>
            <div className="muted small" style={{ marginBottom: 6, fontStyle: 'italic' }}>{dd.agmName} is fielding the calls.</div>
            <div className="stack" style={{ gap: 8 }}>
              {dd.incoming.length === 0 ? (
                <div style={{ ...EMPTY_BOX }}>No calls for your players yet. Shop someone in the trade office to drum up interest.</div>
              ) : (
                dd.incoming.map((o) => <OfferCall key={o.offerId} offer={o} onAction={refetch} />)
              )}
            </div>
          </div>

          {/* THE WIRE */}
          <div>
            <div style={SECTION_LABEL}><Icon size={14}><Icons.Broadcast /></Icon> The wire — deals around the league</div>
            <div className="stack" style={{ gap: 6, maxHeight: 360, overflowY: 'auto' }}>
              {dd.feed.length === 0 ? (
                <div style={EMPTY_BOX}>Quiet so far. The first deals of the day are coming.</div>
              ) : (
                dd.feed.map((f, i) => (
                  <div key={i} style={{ background: CARD_BG, border: PANEL_BORDER, borderRadius: 8, padding: '7px 11px', fontSize: 12.5, lineHeight: 1.45 }}>
                    <span className="muted small" style={{ float: 'right', marginLeft: 8 }}>{f.when}</span>
                    <span style={{ color: 'var(--accent, #d6a056)' }}>◆</span> {f.text}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* THE BLOCK */}
        <div style={{ maxWidth: 1040, marginBottom: 'var(--sp-3)' }}>
          <div style={SECTION_LABEL}><Icon size={14}><Icons.League /></Icon> The block — who's being shopped, league-wide</div>
          {dd.shopped.length === 0 ? (
            <div style={EMPTY_BOX}>No sellers have put names out yet.</div>
          ) : (
            <div className="table-wrap" style={{ background: CARD_BG, backdropFilter: 'blur(6px)', borderRadius: 8 }}>
              <table className="table">
                <thead>
                  <tr><th>Player</th><th>Club</th><th>Term</th><th>Asking</th><th className="num">Val</th></tr>
                </thead>
                <tbody>
                  {dd.shopped.map((p) => <ShoppedRow key={p.playerId} p={p} />)}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="row" style={{ gap: 'var(--sp-3)' }}>
          <button className="btn btn-primary" onClick={() => nav.navigate('trades')}>Open the trade office →</button>
          <button className="btn btn-ghost" onClick={() => nav.navigate('dashboard')} title="The deadline passes when you next continue">
            Stand pat — let the day ride
          </button>
        </div>
      </Backdrop>
    </section>
  )
}

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase',
  color: 'var(--accent, #d6a056)', marginBottom: 6, fontWeight: 700,
  display: 'flex', alignItems: 'center', gap: 5,
}
const EMPTY_BOX: React.CSSProperties = {
  background: CARD_BG, border: PANEL_BORDER, borderRadius: 8,
  padding: '10px 13px', fontSize: 12.5, color: 'var(--muted)',
}
