/**
 * The Preseason Board Meeting — the first MeetingScene (Season Rhythm M1).
 *
 * A cinematic, once-a-year scene: boardroom backdrop (CSS scene now; drop the
 * user's AI artwork at mods/<db>/scenes/boardroom.png later), the cast across
 * the table, dialogue that cites real numbers, and agenda items whose choices
 * are BETS — every commitment becomes a chronicle promise the owner will read
 * back to you in April.
 */
import { useEffect, useMemo, useState } from 'react'
import { getScene } from '../lib/mods'
import type { BoardMeetingScene, MeetingLine } from '../../worker/protocol'
import { PlayerFace } from '../components/PlayerFace'
import { Notice } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'
import { useNav } from '../components/NavContext'
import { bumpRefresh, toast } from '../components/store'

/* ── the room (CSS scene; artwork slot documented above) ── */

export function Backdrop({ children, scene = 'boardroom' }: { children: React.ReactNode; scene?: string }): JSX.Element {
  // User-supplied artwork (assets/scenes/<scene>.png) wins; the layered CSS
  // room below is the always-available fallback.
  const [art, setArt] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void getScene(scene).then((url) => { if (alive) setArt(url) })
    return () => { alive = false }
  }, [scene])
  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100%',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        // ONE property for both paths — mixing the `background` shorthand with
        // `backgroundImage` lets a React re-render's shorthand reset wipe the
        // freshly-set image. Gradients are images, so everything lives here.
        backgroundImage: art
          ? `linear-gradient(180deg, rgba(8,10,16,0.72) 0%, rgba(8,10,16,0.55) 40%, rgba(8,10,16,0.82) 100%), url(${art})`
          : [
            // night skyline through the window
            'radial-gradient(ellipse 60% 38% at 72% 18%, rgba(120,140,190,0.22), transparent 70%)',
            // warm boardroom lamp glow
            'radial-gradient(ellipse 45% 32% at 28% 30%, rgba(214,160,86,0.13), transparent 70%)',
            // the long table sheen
            'linear-gradient(178deg, transparent 55%, rgba(90,62,40,0.35) 68%, rgba(24,16,12,0.9) 100%)',
            // room base
            'linear-gradient(180deg, #10131c 0%, #151a26 45%, #171310 100%)',
          ].join(', '),
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundColor: '#10131c',
        boxShadow: 'inset 0 0 120px rgba(0,0,0,0.55)',
      }}
    >
      {/* window mullions, purely decorative (CSS room only) */}
      {!art && <div style={{ position: 'absolute', top: 0, left: '55%', right: '6%', height: '38%', display: 'flex', gap: 2, opacity: 0.25, pointerEvents: 'none' }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ flex: 1, borderLeft: '2px solid #0a0d14', borderBottom: '2px solid #0a0d14' }} />
        ))}
      </div>}
      <div style={{ position: 'relative', zIndex: 1, padding: 'var(--sp-5)' }}>{children}</div>
    </div>
  )
}

/* ── one spoken line, attributed ── */

function SpeechRow({ line, cast }: { line: MeetingLine; cast: BoardMeetingScene['cast'] }): JSX.Element {
  const who = cast.find((c) => c.id === line.speakerId)
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', maxWidth: 720 }}>
      <PlayerFace faceId={who?.faceId} name={who?.name ?? '?'} size={40} />
      <div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.6 }}>
          {who?.name} · {who?.title}
        </div>
        <div
          style={{
            background: 'rgba(255,255,255,0.055)',
            border: '1px solid rgba(255,255,255,0.09)',
            borderRadius: '4px 14px 14px 14px',
            padding: '10px 14px',
            fontSize: 14.5,
            lineHeight: 1.55,
          }}
        >
          {line.text}
        </div>
      </div>
    </div>
  )
}

/* ── main scene ── */

/** The AGM's safe answers, mirroring the engine's auto-resolve defaults. */
const SAFE: Record<string, string> = {
  objective: 'accept', direction: 'balance',
  'wc-payroll': 'shed', 'wc-rebuild': 'ride', 'wc-fans': 'wins', 'wc-invest': 'development',
}

export function BoardMeetingScreen({ variant = 'preseason' }: { variant?: 'preseason' | 'review' } = {}): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const isReview = variant === 'review'
  const { data: scene, loading } = useScreenData<BoardMeetingScene | null>(
    () => (isReview ? client.getSeasonReview() : client.getBoardMeeting()),
    (r) => (r.type === 'boardMeeting' ? r.scene : null)
  )

  const [choices, setChoices] = useState<Record<string, string>>({})
  const [closing, setClosing] = useState<{ lines: MeetingLine[]; summary: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // The current agenda item = first without an answer.
  const currentIdx = useMemo(
    () => (scene ? scene.agenda.findIndex((a) => !(a.id in choices)) : -1),
    [scene, choices]
  )

  const submit = async (finalChoices: Record<string, string>): Promise<void> => {
    setSubmitting(true)
    const res = isReview
      ? await client.submitSeasonReview(finalChoices['answer'] ?? '')
      : await client.submitBoardMeeting(finalChoices)
    setSubmitting(false)
    if (res.type === 'boardMeetingResult' && res.ok) {
      setClosing({ lines: res.lines, summary: res.summary })
      bumpRefresh()
    } else {
      toast('The meeting could not be held.', 'error')
      nav.navigate('dashboard')
    }
  }

  const pick = (itemId: string, optionId: string): void => {
    const next = { ...choices, [itemId]: optionId }
    setChoices(next)
    if (scene && scene.agenda.every((a) => a.id in next)) void submit(next)
  }

  const sendAgm = (): void => {
    if (!scene) return
    const safe: Record<string, string> = {}
    for (const item of scene.agenda) safe[item.id] = SAFE[item.id] ?? item.options[item.options.length - 1]!.id
    void submit(safe)
  }

  if (loading) return <Notice kind="info">Taking the elevator up…</Notice>
  if (!scene && !closing) {
    return (
      <section className="stack">
        <Notice kind="info">No board meeting is scheduled. The boardroom is dark.</Notice>
      </section>
    )
  }

  return (
    <section style={{ height: '100%' }}>
      <Backdrop scene={isReview ? 'boardroom-day' : 'boardroom'}>
        {/* header */}
        <div className="row-between" style={{ alignItems: 'flex-start', marginBottom: 'var(--sp-4)' }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--muted)' }}>
              Executive boardroom · {isReview ? 'April' : 'September'}
            </div>
            <h2 style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 800 }}>
              {isReview ? 'End-of-Season Review' : 'Preseason Board Meeting'}
            </h2>
          </div>
          {!closing && !isReview && (
            <button className="btn btn-ghost btn-sm" disabled={submitting} onClick={sendAgm}
              title="Skip the meeting — your assistant GM attends and plays every question safe">
              Send the AGM instead →
            </button>
          )}
        </div>

        {/* the table: cast */}
        {scene && (
          <div className="row" style={{ gap: 'var(--sp-5)', marginBottom: 'var(--sp-5)' }}>
            {scene.cast.map((c) => (
              <div key={c.id} style={{ textAlign: 'center' }}>
                <PlayerFace faceId={c.faceId} name={c.name} size={56} />
                <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 4 }}>{c.name}</div>
                <div style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{c.title}</div>
              </div>
            ))}
          </div>
        )}

        {/* closing: the owner's last words + what went on the record */}
        {closing ? (
          <div className="stack" style={{ gap: 'var(--sp-3)', maxWidth: 760 }}>
            {closing.lines.map((l, i) => (
              <SpeechRow key={i} line={l} cast={scene?.cast ?? [{ id: 'owner', name: 'The Owner', title: 'Owner' }]} />
            ))}
            <div
              style={{
                marginTop: 'var(--sp-3)', padding: 'var(--sp-3) var(--sp-4)',
                background: 'rgba(214,160,86,0.08)', border: '1px solid rgba(214,160,86,0.35)',
                borderRadius: 'var(--radius-sm)', fontSize: 13.5, lineHeight: 1.6,
              }}
            >
              <div style={{ fontSize: 10.5, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--accent, #d6a056)', marginBottom: 6 }}>
                📜 On the record
              </div>
              {closing.summary}
            </div>
            <div>
              <button className="btn btn-primary" onClick={() => nav.navigate('dashboard')}>
                Back to your office
              </button>
            </div>
          </div>
        ) : scene && (
          <div className="stack" style={{ gap: 'var(--sp-4)' }}>
            {/* opening lines always visible */}
            <div className="stack" style={{ gap: 'var(--sp-3)' }}>
              {scene.opening.map((l, i) => (
                <SpeechRow key={`open-${i}`} line={l} cast={scene.cast} />
              ))}
            </div>

            {/* resolved items: compact receipt row */}
            {scene.agenda.filter((a) => a.id in choices).map((a) => {
              const chosen = a.options.find((o) => o.id === choices[a.id])
              return (
                <div key={a.id} className="muted small" style={{ paddingLeft: 52 }}>
                  ✓ <b>{a.title}:</b> {chosen?.label}
                </div>
              )
            })}

            {/* current item: intro lines + choice cards */}
            {currentIdx >= 0 && (() => {
              const item = scene.agenda[currentIdx]!
              return (
                <div className="stack" style={{ gap: 'var(--sp-3)' }}>
                  <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--accent, #d6a056)', marginTop: 'var(--sp-2)' }}>
                    Item {currentIdx + 1} of {scene.agenda.length} — {item.title}
                  </div>
                  {item.intro.map((l, i) => (
                    <SpeechRow key={`i-${i}`} line={l} cast={scene.cast} />
                  ))}
                  <div className="stack" style={{ gap: 'var(--sp-2)', maxWidth: 720, marginLeft: 52 }}>
                    {item.options.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        disabled={submitting}
                        onClick={() => pick(item.id, o.id)}
                        style={{
                          textAlign: 'left', cursor: 'pointer',
                          background: 'rgba(255,255,255,0.04)',
                          border: '1px solid rgba(255,255,255,0.14)',
                          borderRadius: 'var(--radius-sm)', padding: '10px 14px', color: 'var(--text)',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent, #d6a056)'; e.currentTarget.style.background = 'rgba(214,160,86,0.07)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)'; e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                      >
                        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{o.label}</div>
                        <div className="muted" style={{ fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>{o.detail}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>
        )}
      </Backdrop>
    </section>
  )
}
