/**
 * PhoneCallOverlay — the "living phone".
 *
 * When somebody needs the GM's ear, the phone rings in the corner. You answer and
 * the caller SPEAKS — in his own voice, saying only what he'd actually say — and
 * you can take it into the room (deep-links to where you respond) or hang up.
 * Callers ring in priority order:
 *   • the club OWNER, when he has a directive (rare, top stakes);
 *   • a rival GM with a BLOCKBUSTER trade offer (a deal touching a ≥78-OVR
 *     piece — routine offers stay in the Trades tab, only these ring); and
 *   • a PLAYER (or his agent, the owner, a reporter) with something to say.
 *
 * Two rules keep it honest, both enforced in lib/phoneCalls.ts:
 *   1. It rings only when someone is genuinely on the line. An authored dilemma
 *      that is pure narration ("Two clubs have called about him…") is a scene in
 *      your office, not a call, and stays in the inbox where its news item points.
 *   2. It speaks only spoken words — never the card's narration or its UI hints.
 *
 * Latency: neural synthesis runs on the renderer's main thread, so the opening of
 * the line is synthesised WHILE THE PHONE IS RINGING and the card is painted
 * before speech is started. Answering is then immediate rather than a multi-second
 * freeze (see lib/kokoroVoice.ts for the measurements).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InboxView, OwnerRequestView } from '../../worker/protocol'
import type { StaffView, TradesView } from '@engine/career/views'
import { useClient, useScreenData } from '../hooks/useSim'
import { useNav } from './NavContext'
import { PlayerFace } from './PlayerFace'
import { Icon } from './primitives'
import { Icons } from './icons'
import { speakAs, cancelSpeech, prewarmSpeech } from '../lib/speak'
import { pickCall, type PhoneCall } from '../lib/phoneCalls'

const SEEN_KEY = 'hockey.phone.seen'

/** Quiet time after you put the handset down before anyone else may ring. Without
 *  it, hanging up on one caller instantly rang the next in priority order — which
 *  is how three open items turned into the phone never leaving your ear. */
const COOLDOWN_MS = 45_000

/** How long after the phone appears before we synthesise the opening line. Long
 *  enough for the card's entrance animation to finish (synthesis blocks the main
 *  thread), short enough that a fast answer still lands on a warm cache. */
const PREWARM_DELAY_MS = 700

/**
 * Call ids are per-career counters (`i0`, `o1`, …) that restart from zero every
 * time you begin a new game — so a seen-set carried across careers silently
 * swallowed the new one's calls. Cleared when a career starts (see App).
 */
export function resetPhoneSeen(): void {
  try { localStorage.removeItem(SEEN_KEY) } catch { /* ignore */ }
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
  const [dismissed, setDismissed] = useState<string[]>([])
  // Bumped when the cooldown expires so the next caller can come through.
  const [, setCooldownTick] = useState(0)
  const quietUntil = useRef(0)

  const call = useMemo<PhoneCall | null>(() => {
    const seen = seenSet()
    for (const id of dismissed) seen.add(id)
    return pickCall({ ownerReq: ownerReq ?? null, trades, inbox, staff, seen })
  }, [inbox, ownerReq, staff, trades, dismissed])

  // Hold the line for the cooldown after a hang-up, then re-check.
  const now = Date.now()
  const quiet = now < quietUntil.current
  useEffect(() => {
    if (!quiet) return
    const t = window.setTimeout(() => setCooldownTick((n) => n + 1), quietUntil.current - Date.now() + 50)
    return () => clearTimeout(t)
  }, [quiet])

  const live = quiet ? null : call

  // A different caller means a different call: never leave the card sitting in
  // the "on the line" state showing a man who was never answered (and who would
  // then never ring or speak).
  const shownId = useRef<string | null>(null)
  if (shownId.current !== (live?.id ?? null)) {
    shownId.current = live?.id ?? null
    if (answered) setAnswered(false)
  }

  // Ring while it's unanswered — and spend the ring synthesising the opening of
  // what he's about to say, so Answer doesn't pay for it. Held back a beat so the
  // synthesis (which blocks the main thread) lands after the card has animated in
  // rather than stuttering its entrance.
  const ringStopRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    ringStopRef.current?.()
    if (!live || answered) { ringStopRef.current = null; return }
    const stopRing = playPhoneRing()
    const warm = window.setTimeout(
      () => prewarmSpeech(live.voice, live.spoken, { seed: live.callerName }),
      PREWARM_DELAY_MS,
    )
    ringStopRef.current = () => { stopRing(); clearTimeout(warm) }
    return () => { ringStopRef.current?.(); ringStopRef.current = null }
  }, [live?.id, live?.voice, live?.spoken, live?.callerName, answered])

  const speakIt = useCallback((c: PhoneCall) => {
    speakAs(c.voice, c.spoken, { seed: c.callerName, importance: 3 })
  }, [])

  // A deferred "speak on answer" that a hang-up in the same beat must be able to
  // call off, or the handset talks after you've put it down.
  const deferredSpeak = useRef<number | null>(null)
  const cancelDeferredSpeak = (): void => {
    if (deferredSpeak.current !== null) { clearTimeout(deferredSpeak.current); deferredSpeak.current = null }
  }

  if (!live) return null

  const answer = (): void => {
    setAnswered(true)
    // Paint the answered card BEFORE synthesis starts. Neural synthesis blocks
    // the main thread; starting it inside the click handler meant React's render
    // was queued behind it and the card visibly hung until the whole message had
    // been synthesised. Two frames' grace is inaudible and keeps the UI honest
    // even on a cold (un-prewarmed) line.
    cancelDeferredSpeak()
    deferredSpeak.current = window.setTimeout(() => {
      deferredSpeak.current = null
      speakIt(live)
    }, 32)
  }
  const hangUp = (act: boolean): void => {
    cancelDeferredSpeak()
    cancelSpeech()
    markSeen(live.id)
    setAnswered(false)
    setDismissed((d) => [...d, live.id])
    quietUntil.current = Date.now() + COOLDOWN_MS
    if (act) nav.navigate(live.actionTarget)
  }

  return (
    <div style={OVERLAY}>
      <style>{RING_CSS}</style>
      <div className={answered ? 'phone-card' : 'phone-card phone-ringing'} style={CARD}>
        <div style={{ textAlign: 'center' }}>
          <div className={answered ? '' : 'phone-face'} style={{ display: 'inline-block' }}>
            <PlayerFace faceId={live.faceId} name={live.callerName} size={72} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, marginTop: 8 }}>{live.callerName}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {answered
              ? `${live.callerRole} · on the line`
              : <><Icon size={14}><Icons.Phone /></Icon> Incoming call · {live.callerRole}</>}
          </div>
        </div>
        {answered ? (
          <>
            <div style={{ fontSize: 13.5, lineHeight: 1.55, fontStyle: 'italic', marginTop: 10, maxHeight: 220, overflowY: 'auto' }}>
              “{live.spoken}”
            </div>
            <div className="row" style={{ gap: 8, marginTop: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-primary" onClick={() => hangUp(true)}>{live.actionLabel}</button>
              <button
                className="btn btn-sm btn-ghost"
                title="Hear it again"
                onClick={() => speakIt(live)}
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
