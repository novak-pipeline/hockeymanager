/**
 * The convened recurring Scout Meeting — the recruitment desk's briefing.
 *
 * Your Head of Scouting walks the room through the department's board: the RISERS
 * and FALLERS where your staff sit off the public consensus, the COVERAGE GAPS
 * you're thin on, and flagged prospects awaiting a call. You act — track a riser,
 * or refocus a scout onto a gap — and the engine applies the real consequence.
 * "Let the Head of Scouting handle it" applies each item's safe default.
 *
 * Blocking gate: the App routes you here on the monthly cadence.
 *
 * The room speaks ONE VOICE AT A TIME. It used to open the whole agenda at once —
 * the host's greeting and every scout's pitch queued back to back over a page that
 * already showed all of it in writing — which read as noise and left the GM with
 * nothing to do while it played. Now the meeting advances item by item: one man
 * speaks, you answer him, and only then does the next one start. The following
 * item is pre-synthesised while the current one talks, so moving on is instant.
 */
import { useEffect, useState } from 'react'
import type { ScoutMeetingView } from '../../worker/protocol'
import { Backdrop } from './BoardMeetingScreen'
import { PlayerFace } from '../components/PlayerFace'
import { Linkify } from '../components/Linkify'
import { PlayerLink } from '../components/NavContext'
import { Icon } from '../components/primitives'
import { Icons } from '../components/icons'
import { Notice } from '../components/ui'
import { useNav } from '../components/NavContext'
import { useClient } from '../hooks/useSim'
import { bumpRefresh, toast } from '../components/store'
import { speakAs, speakScene, prewarmSpeech, cancelSpeech, type SceneLine } from '../lib/speak'

function BoardList({ title, rows, tone }: {
  title: string
  rows: ScoutMeetingView['risers']
  tone: 'up' | 'down'
}): JSX.Element | null {
  if (rows.length === 0) return null
  const color = tone === 'up' ? 'var(--success)' : 'var(--danger, #d8584f)'
  return (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div className="muted" style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 }}>
        {title}
      </div>
      <div className="stack" style={{ gap: 4 }}>
        {rows.map((r) => (
          <div key={r.playerId} className="row" style={{ justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <PlayerLink playerId={r.playerId} name={r.name} /> <span className="muted">{r.position}</span>
            </span>
            <span className="mono small" style={{ color, whiteSpace: 'nowrap' }}>{r.note}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

type Proposal = ScoutMeetingView['proposals'][number]

/** The scene line for one agenda item, cast to its own speaker. */
function lineFor(p: Proposal): SceneLine {
  return {
    role: 'scout',
    text: p.intro.join(' '),
    seed: p.speaker.name,
    ...(p.speaker.demeanor ? { traits: { gender: 'M' as const, demeanor: p.speaker.demeanor } } : {}),
  }
}

export function ScoutMeetingScreen(): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const [view, setView] = useState<ScoutMeetingView | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [picks, setPicks] = useState<Record<string, string>>({})
  /** 0 = the host's opening and the board; 1..n = the nth item, one per screen. */
  const [step, setStep] = useState(0)

  useEffect(() => {
    let alive = true
    void client.getScoutMeeting().then((r) => {
      if (!alive) return
      setLoading(false)
      if (r.type === 'scoutMeeting' && r.scoutMeeting) {
        setView(r.scoutMeeting)
        setPicks(Object.fromEntries(r.scoutMeeting.proposals.map((p) => [p.id, p.defaultOptionId])))
      }
    })
    return () => { alive = false }
  }, [client])

  useEffect(() => () => cancelSpeech(), [])

  const proposals = view?.proposals ?? []
  const current = step > 0 ? proposals[step - 1] : undefined
  const lastStep = proposals.length

  // Whoever is on this step speaks, and only them. Changing step cancels the
  // previous voice, so nobody ever talks over anybody.
  useEffect(() => {
    if (!view) return
    const items = view.proposals
    if (step === 0) {
      speakScene([{ role: 'scout', text: view.opening, seed: view.host.name }])
    } else {
      const p = items[step - 1]
      if (p) speakScene([lineFor(p)])
    }
    // Look-ahead: the NEXT speaker is synthesised while this one talks, so
    // pressing on doesn't buy a fresh silence. It queues behind the live line.
    const next = items[step]
    if (next) {
      const l = lineFor(next)
      prewarmSpeech(l.role, l.text, {
        ...(l.seed !== undefined ? { seed: l.seed } : {}),
        ...(l.traits !== undefined ? { traits: l.traits } : {}),
      })
    }
  }, [view, step])

  async function resolve(kind: 'submit' | 'delegate'): Promise<void> {
    if (busy) return
    setBusy(true)
    cancelSpeech()
    const r = kind === 'submit'
      ? await client.submitScoutMeeting(picks)
      : await client.delegateScoutMeeting()
    setBusy(false)
    if (r.type === 'scoutMeetingResult') {
      toast(r.summary, r.applied.length ? 'success' : 'info')
      bumpRefresh()
      nav.navigate('dashboard')
    } else if (r.type === 'error') {
      toast(r.message ?? 'Could not resolve the meeting.', 'error')
    }
  }

  if (loading) return <Notice kind="info">Gathering the scouts…</Notice>
  if (!view) {
    return (
      <section className="stack">
        <Notice kind="info">No scout meeting is in session right now.</Notice>
        <button className="btn btn-ghost" onClick={() => nav.navigate('dashboard')}>← Back</button>
      </section>
    )
  }

  return (
    <Backdrop scene="staff-meeting">
      <div className="stack" style={{ gap: 'var(--sp-4)', maxWidth: 780 }}>
        <div>
          <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
            <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--muted)', flex: 1 }}>
              Scout Meeting
            </div>
            {lastStep > 0 && (
              <div className="muted small" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {step === 0
                  ? `${lastStep} ${lastStep === 1 ? 'item' : 'items'} to get through`
                  : `Item ${step} of ${lastStep}`}
              </div>
            )}
          </div>
          <h2 style={{ margin: '2px 0 4px', fontSize: 24, fontWeight: 800 }}>The recruitment room</h2>
        </div>

        {/* Step 0 — the host opens, with the board as the backdrop to it. */}
        {step === 0 && (
          <>
            <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
              <div style={{ fontSize: 13.5, lineHeight: 1.5, flex: 1, fontStyle: 'italic' }}>
                <b style={{ fontStyle: 'normal' }}>{view.host.name}</b>
                <span className="muted" style={{ fontStyle: 'normal' }}> · {view.host.title}</span>
                {' — '}“<Linkify text={view.opening} />”
              </div>
              <button
                className="btn btn-sm btn-ghost"
                title="Hear it"
                onClick={() => speakAs('scout', view.opening, { seed: view.host.name, importance: 2 })}
              ><Icon size={16}><Icons.Volume /></Icon></button>
            </div>

            {(view.risers.length > 0 || view.fallers.length > 0) && (
              <div className="panel" style={{ padding: 'var(--sp-4)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Where our board sits vs the consensus</div>
                <div className="row" style={{ gap: 'var(--sp-5)', flexWrap: 'wrap' }}>
                  <BoardList title="We're higher on" rows={view.risers} tone="up" />
                  <BoardList title="We're lower on" rows={view.fallers} tone="down" />
                </div>
              </div>
            )}

            {view.gaps.length > 0 && (
              <div className="panel" style={{ padding: 'var(--sp-3) var(--sp-4)' }}>
                <span className="muted small">Coverage gaps: </span>
                {view.gaps.map((g, i) => (
                  <span key={i} className="chip" style={{ fontSize: 11, marginRight: 6 }}>{g}</span>
                ))}
              </div>
            )}

            {lastStep === 0 && (
              <Notice kind="info">Nothing needs a decision this month — the board's in good shape.</Notice>
            )}
          </>
        )}

        {/* Steps 1..n — one man, one pitch, one decision. */}
        {current && (
          <div className="panel" style={{ padding: 'var(--sp-4)' }}>
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <PlayerFace faceId={current.speaker.faceId} name={current.speaker.name} size={44} />
              <div className="stack" style={{ gap: 6, flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 6, alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 700 }}>{current.speaker.name}</span>
                  <span className="muted" style={{ fontSize: 11.5, flex: 1 }}> · {current.speaker.title}</span>
                  <button
                    className="btn btn-sm btn-ghost"
                    title="Hear the pitch"
                    onClick={() => {
                      const l = lineFor(current)
                      speakAs('scout', l.text, {
                        seed: current.speaker.name,
                        importance: 2,
                        ...(l.traits ? { traits: l.traits } : {}),
                      })
                    }}
                  ><Icon size={16}><Icons.Volume /></Icon></button>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{current.title}</div>
                {current.intro.map((line, i) => (
                  <div key={i} style={{ fontSize: 13, lineHeight: 1.55, fontStyle: 'italic', color: 'var(--text)' }}>
                    “<Linkify text={line} />”
                  </div>
                ))}
                <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 4 }}>
                  {current.options.map((o) => {
                    const sel = picks[current.id] === o.id
                    return (
                      <button
                        key={o.id}
                        className={`btn btn-sm${sel ? ' btn-primary' : ''}`}
                        disabled={busy}
                        title={o.detail}
                        onClick={() => setPicks((prev) => ({ ...prev, [current.id]: o.id }))}
                      >
                        {o.label}
                      </button>
                    )
                  })}
                </div>
                {(() => {
                  const chosen = current.options.find((o) => o.id === picks[current.id])
                  return chosen ? <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>→ {chosen.detail}</div> : null
                })()}
              </div>
            </div>
          </div>
        )}

        <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
          {step > 0 && (
            <button className="btn btn-ghost" disabled={busy} onClick={() => setStep((n) => n - 1)}>← Back</button>
          )}
          {step < lastStep ? (
            <button className="btn btn-primary" disabled={busy} onClick={() => setStep((n) => n + 1)}>
              {step === 0 ? 'First item →' : 'Next →'}
            </button>
          ) : (
            <button className="btn btn-primary" disabled={busy} onClick={() => void resolve('submit')}>
              {busy ? 'Working…' : lastStep === 0 ? 'Close the meeting' : 'Confirm decisions'}
            </button>
          )}
          <button className="btn btn-ghost" disabled={busy} onClick={() => void resolve('delegate')}>
            Let the Head of Scouting handle it
          </button>
        </div>
      </div>
    </Backdrop>
  )
}
