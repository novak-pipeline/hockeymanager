/**
 * PhoneCallOverlay — the "living phone".
 *
 * When something serious needs the GM's ear, the phone rings in the corner. You
 * answer and the caller SPEAKS it in their own voice; you can take it into the
 * room (deep-links to where you respond) or hang up. Callers ring in priority
 * order:
 *   • the club OWNER, when he has a directive (rare, top stakes);
 *   • a rival GM with a BLOCKBUSTER trade offer (a deal touching a ≥78-OVR
 *     piece — routine offers stay in the Trades tab, only these ring); and
 *   • a PLAYER with a serious concern.
 *
 * Self-contained and renderer-only: reads the inbox / owner desk / staff via
 * useScreenData, tracks a "seen" set in localStorage so a call rings once, and
 * voices through speakAs.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { InboxView, OwnerRequestView } from '../../worker/protocol'
import type { StaffView, TradesView } from '@engine/career/views'
import { useClient, useScreenData } from '../hooks/useSim'
import { useNav } from './NavContext'
import { PlayerFace } from './PlayerFace'
import { Icon } from './primitives'
import { Icons } from './icons'
import { speakAs, cancelSpeech } from '../lib/speak'
import type { VoiceRole } from '../lib/voiceCast'

const SEEN_KEY = 'hockey.phone.seen'

/** Stable, compact hash of a string — for a seen-key on callers without an id. */
function hashStr(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** A gentle two-note "brring" via WebAudio — no asset, deliberately soft and
 *  short (a few rings, then silence) so it signals without nagging. Returns a
 *  stop function to call on answer / dismiss / unmount. */
function playPhoneRing(): () => void {
  let ctx: AudioContext | null = null
  const timers: number[] = []
  let stopped = false
  try {
    const AC = window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return () => {}
    ctx = new AC()
    void ctx.resume?.()
  } catch { return () => {} }
  const c = ctx
  const ringOnce = (): void => {
    if (stopped || c.state === 'closed') return
    const at = c.currentTime + 0.01
    for (const [t, freq] of [[0, 660], [0.16, 520]] as const) {
      const osc = c.createOscillator()
      const gain = c.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = at + t
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.1, start + 0.02) // soft peak
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22)
      osc.connect(gain).connect(c.destination)
      osc.start(start)
      osc.stop(start + 0.25)
    }
  }
  for (let i = 0; i < 3; i++) timers.push(window.setTimeout(ringOnce, i * 1700))
  return () => {
    stopped = true
    for (const id of timers) clearTimeout(id)
    try { void c.close() } catch { /* ignore */ }
  }
}

function seenSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}
function markSeen(id: string): void {
  const s = seenSet()
  s.add(id)
  try {
    // Keep the set bounded so it can't grow forever.
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-200)))
  } catch { /* ignore */ }
}

/** A unified incoming call, whoever is on the line. */
interface Call {
  id: string
  callerName: string
  callerRole: string
  faceId?: string
  voice: VoiceRole
  message: string
  actionLabel: string
  actionTarget: string
}

export function PhoneCallOverlay(): JSX.Element | null {
  const client = useClient()
  const nav = useNav()
  const { data: inbox } = useScreenData<InboxView>(
    () => client.getInbox(),
    (r) => (r.type === 'inbox' ? r.inbox : null),
  )
  const { data: ownerReq } = useScreenData<OwnerRequestView | null>(
    () => client.getOwnerRequest(),
    (r) => (r.type === 'ownerRequest' ? r.ownerRequest : null),
  )
  const { data: staff } = useScreenData<StaffView>(
    () => client.getTeamStaff(),
    (r) => (r.type === 'teamStaff' ? r.staff : null),
  )
  const { data: trades } = useScreenData<TradesView>(
    () => client.getTrades(),
    (r) => (r.type === 'trades' ? r.trades : null),
  )
  const [answered, setAnswered] = useState(false)
  const [dismissedId, setDismissedId] = useState<string | null>(null)

  // Who's on the line? The owner outranks a routine player concern.
  const call = useMemo<Call | null>(() => {
    const seen = seenSet()
    if (ownerReq) {
      const id = `owner:${hashStr(ownerReq.title + ownerReq.body)}`
      if (!seen.has(id) && id !== dismissedId) {
        return {
          id,
          callerName: staff?.owner.name ?? 'The Owner',
          callerRole: 'Club Owner',
          faceId: staff?.owner.faceId,
          voice: 'owner',
          message: ownerReq.body,
          actionLabel: 'Take it upstairs →',
          actionTarget: 'board',
        }
      }
    }
    // A rival GM on the line with a BLOCKBUSTER — an offer whose deal touches a
    // genuine piece (≥78 OVR on either side). Routine offers stay in the Trades
    // tab; only the phone-blowing-up ones ring. Highest business stakes after the
    // owner.
    const blockbuster = (trades?.incoming ?? []).find((o) => {
      const id = `trade:${o.offerId}`
      if (seen.has(id) || id === dismissedId) return false
      return [...o.receive.players, ...o.give.players].some((p) => p.overall >= 78)
    })
    if (blockbuster) {
      const headliner = [...blockbuster.receive.players, ...blockbuster.give.players]
        .sort((a, b) => b.overall - a.overall)[0]
      return {
        id: `trade:${blockbuster.offerId}`,
        callerName: `${blockbuster.receive.teamName} — front office`,
        callerRole: headliner ? `Trade offer · ${headliner.name}` : 'Trade offer',
        faceId: undefined,
        voice: 'gm',
        message: blockbuster.message,
        actionLabel: 'See the offer →',
        actionTarget: 'trades',
      }
    }
    const concern = (inbox?.interactions ?? []).find(
      (c) => c.severity === 'serious' && !seen.has(c.id) && c.id !== dismissedId,
    )
    if (concern) {
      return {
        id: concern.id,
        callerName: concern.playerName,
        callerRole: 'Player',
        faceId: concern.faceId,
        voice: 'player',
        message: concern.message,
        actionLabel: 'Talk it out →',
        actionTarget: 'inbox',
      }
    }
    return null
  }, [inbox, ownerReq, staff, trades, dismissedId])

  // Ring a gentle tone when a new call arrives; stop the moment it's answered.
  const ringStopRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    ringStopRef.current?.()
    ringStopRef.current = call && !answered ? playPhoneRing() : null
    return () => { ringStopRef.current?.(); ringStopRef.current = null }
  }, [call?.id, answered])

  if (!call) return null

  const answer = (): void => {
    setAnswered(true)
    speakAs(call.voice, call.message, { seed: call.callerName, importance: 3 })
  }
  const hangUp = (act: boolean): void => {
    cancelSpeech()
    markSeen(call.id)
    setAnswered(false)
    setDismissedId(call.id)
    if (act) nav.navigate(call.actionTarget)
  }

  return (
    <div style={OVERLAY}>
      <style>{RING_CSS}</style>
      <div className={answered ? 'phone-card' : 'phone-card phone-ringing'} style={CARD}>
        <div style={{ textAlign: 'center' }}>
          <div className={answered ? '' : 'phone-face'} style={{ display: 'inline-block' }}>
            <PlayerFace faceId={call.faceId} name={call.callerName} size={72} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, marginTop: 8 }}>{call.callerName}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {answered
              ? `${call.callerRole} · on the line`
              : <><Icon size={14}><Icons.Phone /></Icon> Incoming call · {call.callerRole}</>}
          </div>
        </div>
        {answered ? (
          <>
            <div style={{ fontSize: 13.5, lineHeight: 1.55, fontStyle: 'italic', marginTop: 10, maxHeight: 220, overflowY: 'auto' }}>
              “{call.message}”
            </div>
            <div className="row" style={{ gap: 8, marginTop: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-primary" onClick={() => hangUp(true)}>{call.actionLabel}</button>
              <button
                className="btn btn-sm btn-ghost"
                title="Hear it again"
                onClick={() => speakAs(call.voice, call.message, { seed: call.callerName })}
              ><Icon size={16}><Icons.Volume /></Icon></button>
              <button className="btn btn-sm btn-ghost" onClick={() => hangUp(false)}>Hang up</button>
            </div>
          </>
        ) : (
          <div className="row" style={{ gap: 10, marginTop: 14, justifyContent: 'center' }}>
            <button className="btn btn-sm btn-primary" onClick={answer}>Answer</button>
            <button className="btn btn-sm btn-ghost" onClick={() => hangUp(false)}>Decline</button>
          </div>
        )}
      </div>
    </div>
  )
}

const OVERLAY: React.CSSProperties = { position: 'fixed', right: 20, bottom: 20, zIndex: 900 }
const CARD: React.CSSProperties = {
  width: 280,
  background: 'linear-gradient(180deg, var(--panel, #161a24) 0%, var(--bg1, #0f121a) 100%)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 18,
  padding: '18px 16px',
  boxShadow: '0 18px 50px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)',
}

const RING_CSS = `
@keyframes phoneShake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-3px) rotate(-1deg)} 40%{transform:translateX(3px) rotate(1deg)} 60%{transform:translateX(-2px)} 80%{transform:translateX(2px)} }
@keyframes phoneGlow { 0%,100%{box-shadow:0 14px 44px rgba(0,0,0,0.55)} 50%{box-shadow:0 0 0 3px var(--accent,#f5b301), 0 14px 44px rgba(0,0,0,0.55)} }
@keyframes phoneFace { 0%,100%{transform:scale(1)} 50%{transform:scale(1.04)} }
.phone-ringing { animation: phoneShake 0.9s ease-in-out infinite, phoneGlow 1.4s ease-in-out infinite; }
.phone-face { animation: phoneFace 1.1s ease-in-out infinite; }
`
