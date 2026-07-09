import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { PlayerProfileView, WorkerResponse } from '../../worker/protocol'
import type { SquadStatus, TradeStatus } from '../../domain/player'
import { useClient } from '../hooks/useSim'
import { useNav } from './NavContext'
import { usePlayerMenu } from './playerMenuStore'
import { toast, bumpRefresh } from './store'

/**
 * #187: EHM-style right-click action menu for any player name. Opens at the
 * cursor (driven by `playerMenuStore`), fetches the player's profile to learn
 * which actions apply, and offers the common GM moves — view profile, offer a
 * contract, set squad status / trade posture (#188), roster moves, scout.
 *
 * Mounted once at the app root, inside NavContext, so every `<PlayerLink>` in
 * the app is menu-enabled without prop-threading.
 */
const SQUAD_OPTIONS: { value: SquadStatus; label: string }[] = [
  { value: 'keyPlayer', label: 'Key Player' },
  { value: 'coreStarter', label: 'Core Starter' },
  { value: 'rotation', label: 'Rotation' },
  { value: 'topProspect', label: 'Hot Prospect' },
  { value: 'prospect', label: 'Young Prospect' },
  { value: 'surplus', label: 'Surplus' },
]
const TRADE_OPTIONS: { value: TradeStatus; label: string }[] = [
  { value: 'untouchable', label: 'Untouchable' },
  { value: 'available', label: 'Available' },
  { value: 'listed', label: 'On the block' },
]

type SubMenu = null | 'squad' | 'trade'

export function PlayerActionMenu(): JSX.Element | null {
  const { open, playerId, name, x, y, close } = usePlayerMenu()
  const client = useClient()
  const nav = useNav()
  const ref = useRef<HTMLDivElement>(null)
  const [profile, setProfile] = useState<PlayerProfileView | null>(null)
  const [busy, setBusy] = useState(false)
  const [sub, setSub] = useState<SubMenu>(null)

  // Fetch the player's profile when the menu opens (fresh each time).
  useEffect(() => {
    if (!open) { setProfile(null); setSub(null); return }
    let live = true
    void client.getPlayer(playerId).then((r) => {
      if (live && r.type === 'player') setProfile(r.player)
    })
    return () => { live = false }
  }, [open, playerId, client])

  // Dismiss on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close() }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open, close])

  if (!open) return null

  const own = profile?.isOwn ?? false

  async function run(fn: () => Promise<WorkerResponse>, okMsg?: string): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const res = await fn()
      if (res.type === 'error') toast(res.message ?? 'Action failed.', 'error')
      else { if (okMsg) toast(okMsg, 'success'); bumpRefresh() }
    } finally { setBusy(false); close() }
  }

  const go = (screen: Parameters<typeof nav.navigate>[0]): void => { nav.navigate(screen, { playerId }); close() }

  // Clamp within the viewport.
  const menuW = 236
  const left = Math.min(x, window.innerWidth - menuW - 8)
  const top = Math.min(y, window.innerHeight - 320)

  const itemStyle: CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px',
    fontSize: 12, background: 'transparent', border: 'none', color: 'var(--text)', cursor: 'pointer',
  }

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed', left, top, zIndex: 200, minWidth: menuW,
        background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: 8,
        boxShadow: '0 8px 28px rgba(0,0,0,0.5)', padding: '4px 0', overflow: 'hidden',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div style={{ padding: '6px 12px 4px', fontWeight: 800, fontSize: 12, color: 'var(--violet-h)', borderBottom: '1px solid var(--line)' }}>
        {name}
      </div>

      {sub === null && (
        <>
          <button className="menu-item" style={itemStyle} onClick={() => go('player')}>View profile</button>
          {own && (
            <>
              <button className="menu-item" style={itemStyle} onClick={() => go('negotiation')}>Offer new contract…</button>
              <button className="menu-item" style={itemStyle} onClick={() => setSub('squad')}>
                Set squad role{profile?.squadStatusLabel ? ` (${profile.squadStatusLabel})` : ''} ▸
              </button>
              <button className="menu-item" style={itemStyle} onClick={() => setSub('trade')}>
                Trade status{profile?.tradeStatus ? ` (${profile.tradeStatus})` : ''} ▸
              </button>
              <div style={{ borderTop: '1px solid var(--line)', margin: '4px 0' }} />
              <button className="menu-item" style={itemStyle} disabled={busy}
                onClick={() => void run(() => client.callUp(playerId), `${name} recalled to the NHL.`)}>Recall to NHL</button>
              <button className="menu-item" style={itemStyle} disabled={busy}
                onClick={() => void run(() => client.sendDown(playerId), `${name} loaned to the AHL.`)}>Send to AHL (loan)</button>
            </>
          )}
          {!own && (
            <button className="menu-item" style={itemStyle} onClick={() => go('player')}>Scout &amp; view report</button>
          )}
        </>
      )}

      {sub === 'squad' && (
        <>
          <button className="menu-item" style={itemStyle} onClick={() => setSub(null)}>◂ Back</button>
          {SQUAD_OPTIONS.map((o) => (
            <button key={o.value} className="menu-item" style={itemStyle} disabled={busy}
              onClick={() => void run(() => client.setSquadStatus(playerId, o.value), `${name}: ${o.label}`)}>
              {profile?.squadStatus === o.value ? '● ' : '○ '}{o.label}
            </button>
          ))}
          <button className="menu-item" style={{ ...itemStyle, color: 'var(--text-dim)' }} disabled={busy}
            onClick={() => void run(() => client.setSquadStatus(playerId, null), 'Role cleared')}>Clear role</button>
        </>
      )}

      {sub === 'trade' && (
        <>
          <button className="menu-item" style={itemStyle} onClick={() => setSub(null)}>◂ Back</button>
          {TRADE_OPTIONS.map((o) => (
            <button key={o.value} className="menu-item" style={itemStyle} disabled={busy}
              onClick={() => void run(() => client.setTradeStatus(playerId, o.value), `Trade status: ${o.label}`)}>
              {profile?.tradeStatus === o.value ? '● ' : '○ '}{o.label}
            </button>
          ))}
          <button className="menu-item" style={{ ...itemStyle, color: 'var(--text-dim)' }} disabled={busy}
            onClick={() => void run(() => client.setTradeStatus(playerId, null), 'Trade status cleared')}>Clear</button>
        </>
      )}
    </div>
  )
}
