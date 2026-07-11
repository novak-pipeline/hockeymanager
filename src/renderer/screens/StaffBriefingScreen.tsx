/**
 * The convened bi-weekly Staff Meeting — the interactive war-room.
 *
 * Your staff read the live roster and table concrete proposals; you pick one
 * option per item and the engine applies the real consequence (a line move, a
 * rest, a call-up, a tactical shift). "Let the AGM handle it" applies each item's
 * safe default. Blocking gate: the App routes you here on the bi-weekly cadence.
 *
 * Artwork slot: assets/scenes/staff-meeting.png (CSS boardroom fallback).
 */
import { useEffect, useState } from 'react'
import type { StaffMeetingView } from '../../worker/protocol'
import { Backdrop } from './BoardMeetingScreen'
import { PlayerFace } from '../components/PlayerFace'
import { Notice } from '../components/ui'
import { useNav } from '../components/NavContext'
import { useClient } from '../hooks/useSim'
import { bumpRefresh, toast } from '../components/store'

export function StaffBriefingScreen(): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const [view, setView] = useState<StaffMeetingView | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [picks, setPicks] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    void client.getStaffMeeting().then((r) => {
      if (!alive) return
      setLoading(false)
      if (r.type === 'staffMeeting' && r.staffMeeting) {
        setView(r.staffMeeting)
        // Default each item to the staff's safe default until the GM decides.
        setPicks(Object.fromEntries(r.staffMeeting.proposals.map((p) => [p.id, p.defaultOptionId])))
      }
    })
    return () => { alive = false }
  }, [client])

  async function resolve(kind: 'submit' | 'delegate'): Promise<void> {
    if (busy) return
    setBusy(true)
    const r = kind === 'submit'
      ? await client.submitStaffMeeting(picks)
      : await client.delegateStaffMeeting()
    setBusy(false)
    if (r.type === 'staffMeetingResult') {
      toast(r.summary, r.applied.length ? 'success' : 'info')
      bumpRefresh()
      nav.navigate('dashboard')
    } else if (r.type === 'error') {
      toast(r.message ?? 'Could not resolve the meeting.', 'error')
    }
  }

  if (loading) return <Notice kind="info">Gathering the staff…</Notice>
  if (!view) {
    return (
      <section className="stack">
        <Notice kind="info">No staff meeting is in session right now.</Notice>
        <button className="btn btn-ghost" onClick={() => nav.navigate('dashboard')}>← Back</button>
      </section>
    )
  }

  return (
    <Backdrop scene="staff-meeting">
      <div className="stack" style={{ gap: 'var(--sp-4)', maxWidth: 780 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--muted)' }}>
            Staff Meeting
          </div>
          <h2 style={{ margin: '2px 0 4px', fontSize: 24, fontWeight: 800 }}>The coaches’ room</h2>
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>{view.opening}</div>
        </div>

        {view.proposals.map((p) => (
          <div key={p.id} className="panel" style={{ padding: 'var(--sp-4)' }}>
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <PlayerFace faceId={p.speaker.faceId} name={p.speaker.name} size={44} />
              <div className="stack" style={{ gap: 6, flex: 1, minWidth: 0 }}>
                <div>
                  <span style={{ fontWeight: 700 }}>{p.speaker.name}</span>
                  <span className="muted" style={{ fontSize: 11.5 }}> · {p.speaker.title}</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{p.title}</div>
                {p.intro.map((line, i) => (
                  <div key={i} style={{ fontSize: 13, lineHeight: 1.55, fontStyle: 'italic', color: 'var(--text)' }}>
                    “{line}”
                  </div>
                ))}
                <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 4 }}>
                  {p.options.map((o) => {
                    const sel = picks[p.id] === o.id
                    return (
                      <button
                        key={o.id}
                        className={`btn btn-sm${sel ? ' btn-primary' : ''}`}
                        disabled={busy}
                        title={o.detail}
                        onClick={() => setPicks((prev) => ({ ...prev, [p.id]: o.id }))}
                      >
                        {o.label}
                      </button>
                    )
                  })}
                </div>
                {/* The receipt for the current pick. */}
                {(() => {
                  const chosen = p.options.find((o) => o.id === picks[p.id])
                  return chosen ? (
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>→ {chosen.detail}</div>
                  ) : null
                })()}
              </div>
            </div>
          </div>
        ))}

        <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={busy} onClick={() => void resolve('submit')}>
            {busy ? 'Working…' : 'Confirm decisions'}
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => void resolve('delegate')}>
            Let the AGM handle it
          </button>
        </div>
      </div>
    </Backdrop>
  )
}
