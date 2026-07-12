/**
 * PhoneCallOverlay — the "living phone".
 *
 * When a player has something serious to say (a serious concern), the phone
 * rings in the corner. You answer and he SPEAKS it in his own voice; you can
 * take it into the room (deep-links to the inbox to respond) or hang up. Built to
 * generalise later to incoming GM trade-offer calls.
 *
 * Self-contained and renderer-only: reads the inbox via useScreenData, tracks a
 * "seen" set in localStorage so a call rings once, and voices through speakAs.
 */
import { useMemo, useState } from 'react'
import type { InboxView } from '../../worker/protocol'
import { useClient, useScreenData } from '../hooks/useSim'
import { useNav } from './NavContext'
import { PlayerFace } from './PlayerFace'
import { speakAs, cancelSpeech } from '../lib/speak'

const SEEN_KEY = 'hockey.phone.seen'

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

export function PhoneCallOverlay(): JSX.Element | null {
  const client = useClient()
  const nav = useNav()
  const { data: inbox } = useScreenData<InboxView>(
    () => client.getInbox(),
    (r) => (r.type === 'inbox' ? r.inbox : null),
  )
  const [answered, setAnswered] = useState(false)
  const [dismissedId, setDismissedId] = useState<string | null>(null)

  // The caller: the first serious, unseen player concern.
  const call = useMemo(() => {
    const seen = seenSet()
    return (inbox?.interactions ?? []).find(
      (c) => c.severity === 'serious' && !seen.has(c.id) && c.id !== dismissedId,
    ) ?? null
  }, [inbox, dismissedId])

  if (!call) return null

  const answer = (): void => {
    setAnswered(true)
    speakAs('player', call.message, { seed: call.playerName, importance: 3 })
  }
  const hangUp = (goInbox: boolean): void => {
    cancelSpeech()
    markSeen(call.id)
    setAnswered(false)
    setDismissedId(call.id)
    if (goInbox) nav.navigate('inbox')
  }

  return (
    <div style={OVERLAY}>
      <style>{RING_CSS}</style>
      <div className={answered ? 'phone-card' : 'phone-card phone-ringing'} style={CARD}>
        <div style={{ textAlign: 'center' }}>
          <div className={answered ? '' : 'phone-face'} style={{ display: 'inline-block' }}>
            <PlayerFace faceId={call.faceId} name={call.playerName} size={72} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, marginTop: 8 }}>{call.playerName}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {answered ? 'On the line' : '📞 Incoming call…'}
          </div>
        </div>
        {answered ? (
          <>
            <div style={{ fontSize: 13.5, lineHeight: 1.55, fontStyle: 'italic', marginTop: 10 }}>
              “{call.message}”
            </div>
            <div className="row" style={{ gap: 8, marginTop: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-primary" onClick={() => hangUp(true)}>Talk it out →</button>
              <button
                className="btn btn-sm btn-ghost"
                title="Hear it again"
                onClick={() => speakAs('player', call.message, { seed: call.playerName })}
              >🔊</button>
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
  width: 260,
  background: 'var(--panel, #12151d)',
  border: '1px solid rgba(255,255,255,0.16)',
  borderRadius: 14,
  padding: 16,
  boxShadow: '0 14px 44px rgba(0,0,0,0.55)',
}

const RING_CSS = `
@keyframes phoneShake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-3px) rotate(-1deg)} 40%{transform:translateX(3px) rotate(1deg)} 60%{transform:translateX(-2px)} 80%{transform:translateX(2px)} }
@keyframes phoneGlow { 0%,100%{box-shadow:0 14px 44px rgba(0,0,0,0.55)} 50%{box-shadow:0 0 0 3px var(--accent,#f5b301), 0 14px 44px rgba(0,0,0,0.55)} }
@keyframes phoneFace { 0%,100%{transform:scale(1)} 50%{transform:scale(1.04)} }
.phone-ringing { animation: phoneShake 0.9s ease-in-out infinite, phoneGlow 1.4s ease-in-out infinite; }
.phone-face { animation: phoneFace 1.1s ease-in-out infinite; }
`
