/**
 * Offseason 3.0 — the NEEDS board (the primary offseason surface).
 *
 * The owner: "the trade screen, free agent screen have always felt like giant
 * lists that i dont want". So the summer opens on what the roster is MISSING
 * for next season — "a 2nd-pair LHD", "a backup G", "$6.2M of cap space" — each
 * with three to five real answers: free agents with the actual bids against
 * you, trade targets with their club's stance and price, your own expiring
 * men, and for a cap need the contracts that would clear it. The full lists
 * are still one click away ("Browse all").
 */
import { useState } from 'react'
import type { NeedCandidateView, OffseasonNeedsView } from '../../engine/career/views'
import { needsFor, type NeedInContext, type NeedsContext } from '../../engine/career/offseasonNeeds'
import { presetForNeed } from '../lib/playerSearchFilters'
import { PlayerLink, useNav } from './NavContext'
import { PlayerFace } from './PlayerFace'
import { OverallStars } from './Stars'
import { Icon } from './primitives'
import { Icons } from './icons'
import { fmtMoney } from './format'
import { toast } from './store'
import { useClient, useScreenData } from '../hooks/useSim'

const SEVERITY: Record<1 | 2 | 3, { label: string; color: string }> = {
  3: { label: 'Priority', color: 'var(--danger, #e0575b)' },
  2: { label: 'Should fix', color: 'var(--amber, #d6a056)' },
  1: { label: 'Worth a look', color: 'var(--muted)' },
}

const STANDING: Record<'leading' | 'competitive' | 'trailing', { label: string; color: string }> = {
  leading: { label: 'You lead', color: 'var(--success, #4caf7d)' },
  competitive: { label: 'Neck and neck', color: 'var(--amber, #d6a056)' },
  trailing: { label: 'Trailing', color: 'var(--danger, #e0575b)' },
}

const KIND: Record<NeedCandidateView['kind'], { label: string; cls: string }> = {
  fa: { label: 'Free agent', cls: 'chip-accent' },
  trade: { label: 'Trade', cls: 'chip-violet' },
  resign: { label: 'Your player', cls: 'chip-success' },
  move: { label: 'Your contract', cls: 'chip-warn' },
}

/** The needs board, context-aware: the Free Agents desk shows free-agent
 *  answers (and your own re-sign candidates), the Trade Centre trade answers
 *  (and, for a cap need, the contracts that clear it), the offseason overview
 *  both, grouped. `onBrowse` is the "Browse all" escape hatch. */
export function NeedsBoard(props: { context: NeedsContext; onBrowse?: () => void; browseLabel?: string; compact?: boolean }): JSX.Element | null {
  const client = useClient()
  const { data, refetch } = useScreenData<OffseasonNeedsView>(
    () => client.getOffseasonNeeds(),
    (r) => (r.type === 'offseasonNeeds' ? r.needs : null)
  )
  if (!data) return null
  const room = data.capCeiling - data.committed
  return (
    <div className="panel" style={{ padding: 'var(--sp-3)' }}>
      <div className="row-between" style={{ alignItems: 'flex-start', gap: 'var(--sp-3)', flexWrap: 'wrap', marginBottom: 'var(--sp-3)' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--muted)' }}>Next season · what the roster is missing</div>
          <div style={{ fontSize: 17, fontWeight: 800, marginTop: 2 }}>{data.headline}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="small muted">Cap room next season</div>
          <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: room < 0 ? 'var(--danger)' : 'var(--text)' }}>{fmtMoney(room)}</div>
          <div className="small muted">{fmtMoney(data.committed)} of {fmtMoney(data.capCeiling)} committed</div>
        </div>
      </div>
      {data.needs.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 'var(--sp-3)' }}>
          {needsFor(data.needs, props.context).map((n) => (
            <NeedCard key={n.id} need={n} context={props.context} capRoom={room} marketOpen={data.marketOpen} grouped={props.context === 'all'} compact={props.compact === true} onChanged={refetch} />
          ))}
        </div>
      )}
      {props.onBrowse && (
        <div style={{ marginTop: 'var(--sp-3)', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" onClick={props.onBrowse}>{props.browseLabel ?? 'Browse all'}</button>
        </div>
      )}
    </div>
  )
}

function NeedCard(props: { need: NeedInContext; context: NeedsContext; capRoom: number; marketOpen: boolean; grouped: boolean; compact: boolean; onChanged: () => void }): JSX.Element {
  const { need } = props
  const nav = useNav()
  const sev = SEVERITY[need.severity]
  const cap = props.compact ? 3 : 5
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--line)', borderLeft: `3px solid ${sev.color}`, borderRadius: 'var(--radius-sm)', padding: '10px 12px', minWidth: 0 }}>
      <div className="row-between" style={{ alignItems: 'center', gap: 8, marginBottom: 2 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center', minWidth: 0 }}>
          <Icon size={18} color={sev.color}>{need.kind === 'cap' ? <Icons.Money /> : need.group === 'G' ? <Icons.Shield /> : <Icons.Squad />}</Icon>
          <span style={{ fontSize: 15, fontWeight: 800 }}>{capitalise(need.label)}</span>
        </div>
        <span className="chip" style={{ fontSize: 10, color: sev.color, borderColor: sev.color }}>{sev.label}</span>
      </div>
      <div className="small muted" style={{ lineHeight: 1.45, marginBottom: 8 }}>{need.why}</div>
      <div className="stack" style={{ gap: 10 }}>
        {need.groups.filter((g) => g.candidates.length > 0).map((g) => (
          <div key={g.kind} className="stack" style={{ gap: 8 }}>
            {props.grouped && (
              <div style={{ fontSize: 10, letterSpacing: 1.3, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>{g.title}</div>
            )}
            {g.candidates.slice(0, cap).map((c) => <CandidateRow key={c.playerId} c={c} marketOpen={props.marketOpen} onChanged={props.onChanged} />)}
          </div>
        ))}
        {need.elsewhere && (
          <button
            type="button"
            className="small"
            onClick={() => nav.navigate(need.elsewhere!.screen)}
            style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', color: 'var(--muted)', fontStyle: 'italic', display: 'inline-flex', gap: 4, alignItems: 'center' }}
          >
            {need.elsewhere.text} <Icon size={14} color="var(--accent)"><Icons.ChevronRight /></Icon>
          </button>
        )}
        {need.criteria && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ alignSelf: 'flex-start', display: 'inline-flex', gap: 4, alignItems: 'center' }}
            title={`Search the whole database for ${need.label}, with the filters set from this need`}
            onClick={() => {
              const preset = presetForNeed(need, props.context, props.capRoom, Date.now())
              if (preset) nav.navigate('scoutingPlayers', { searchPreset: preset })
            }}
          >
            <Icon size={14}><Icons.Search /></Icon> See more
          </button>
        )}
      </div>
    </div>
  )
}

function CandidateRow(props: { c: NeedCandidateView; marketOpen: boolean; onChanged: () => void }): JSX.Element {
  const { c } = props
  const nav = useNav()
  const client = useClient()
  const [busy, setBusy] = useState(false)
  const kind = KIND[c.kind]
  async function tableOffer(): Promise<void> {
    setBusy(true)
    const r = await client.submitFaOffer(c.playerId, c.capHit, c.years)
    setBusy(false)
    if (r.type === 'faOfferResult') { toast(r.message, r.ok ? 'success' : 'error'); props.onChanged() }
    else if (r.type === 'error') toast(r.message, 'error')
  }
  return (
    <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
      <PlayerFace faceId={c.faceId} name={c.name} size={34} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <PlayerLink playerId={c.playerId} name={c.name} />
          <OverallStars value={c.overall} />
          <span className="muted small">{c.position}{c.position === 'D' || c.position === 'G' ? ` · ${c.hand}` : ''} · {c.age}</span>
          <span className={`chip ${kind.cls}`} style={{ fontSize: 9 }}>{kind.label}{c.teamAbbr ? ` · ${c.teamAbbr}` : ''}</span>
        </div>
        <div className="small" style={{ marginTop: 2, color: 'var(--text)', fontWeight: 600, display: 'flex', gap: 4, alignItems: 'center' }}>
          <Icon size={14} color={c.kind === 'move' ? 'var(--amber, #d6a056)' : 'var(--success, #4caf7d)'}>{c.kind === 'move' ? <Icons.Money /> : <Icons.Up />}</Icon>
          {c.fit}
        </div>
        <div className="small muted" style={{ lineHeight: 1.4 }}>
          <span className="mono" style={{ color: 'var(--text)' }}>{fmtMoney(c.capHit)} × {c.years}</span> · {c.cost}
          {c.yourOffer && <div style={{ color: STANDING[c.yourOffer.standing].color }}>Your offer: {c.yourOffer.note}</div>}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
        {c.kind === 'fa' && (
          <>
            <button className="btn btn-sm btn-primary" onClick={() => nav.navigate('negotiation', { playerId: c.playerId })}>Talks</button>
            {c.yourOffer ? (
              <span className="chip" style={{ fontSize: 9, color: STANDING[c.yourOffer.standing].color, borderColor: STANDING[c.yourOffer.standing].color }} title={c.yourOffer.note}>
                {STANDING[c.yourOffer.standing].label} · {fmtMoney(c.yourOffer.salary)}×{c.yourOffer.years}
              </span>
            ) : props.marketOpen && (
              <button className="btn btn-sm btn-ghost" disabled={busy} title="Table a standing offer at his ask — it goes into the same pile as the real bids" onClick={() => void tableOffer()}>Offer his ask</button>
            )}
          </>
        )}
        {c.kind === 'trade' && (
          <button className="btn btn-sm btn-primary" title={`Open the trade builder with ${c.teamAbbr ?? 'his club'}, asking for him`} onClick={() => nav.navigate('trades', { playerId: c.playerId, ...(c.teamId ? { teamId: c.teamId } : {}) })}>Enquire</button>
        )}
        {c.kind === 'resign' && (
          <button className="btn btn-sm btn-primary" onClick={() => nav.navigate('negotiation', { playerId: c.playerId })}>Re-sign</button>
        )}
        {c.kind === 'move' && (
          <button className="btn btn-sm" title="Put him on the block in the trade office" onClick={() => nav.navigate('trades', { playerId: c.playerId })}>Shop him</button>
        )}
      </div>
    </div>
  )
}

function capitalise(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s
}
