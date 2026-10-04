/**
 * Press conference modal — polls getPresser on refresh-bus bump,
 * shows the question and allows the user to answer (with or without an
 * Anthropic key).
 *
 * WITH key: free-text answer → press:gradeAnswer → show room reaction →
 *           answerPresser(answer, gradedTone)
 * WITHOUT key: four tone buttons; "No comment" = deflecting to skip.
 */
import { useEffect, useRef, useState } from 'react'
import type { PressConferenceState, PressTone } from '@engine/story/factSheet'
import { PRESS_PERSONA_NAMES } from '@engine/story/factSheet'
import { Icons } from './icons'
import { useClient } from '../hooks/useSim'
import { Icon } from './primitives'
import { bumpRefresh } from './store'
import { getPressSettings } from '../lib/press'

type Phase = 'idle' | 'answering' | 'grading' | 'reacted' | 'submitting'

function pressApi() {
  const hockey = (window as unknown as { hockey?: { press?: {
    keyStatus(): Promise<{ present: boolean }>
    gradeAnswer(args: { question: string; answer: string }): Promise<
      | { ok: true; tone: string; reaction: string }
      | { ok: false; code: string; message: string }
    >
  } } }).hockey
  return hockey?.press ?? null
}

/** `hold` (loop audit F4): something else owns the screen — a scene room, the
 *  processing overlay, a ringing phone. The presser waits behind it rather
 *  than stacking a third layer on top. */
export function PressConference(props: { hold?: boolean; onLive?: (live: boolean) => void } = {}): JSX.Element | null {
  const client = useClient()
  const holdRef = useRef(false)
  holdRef.current = props.hold === true
  const [presser, setPresser] = useState<PressConferenceState | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [answer, setAnswer] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [reaction, setReaction] = useState('')
  const [gradedTone, setGradedTone] = useState<PressTone>('measured')
  const pollRef = useRef(false)

  const settings = getPressSettings()

  // Poll for presser on mount and when refresh bumps (via re-render).
  useEffect(() => {
    if (pollRef.current || !settings.pressersEnabled || holdRef.current) return
    pollRef.current = true
    void (async () => {
      try {
        const res = await client.getPresser()
        if (res.type === 'presser' && res.presser) {
          setPresser(res.presser)
          setPhase('answering')
          // Check if the key is available.
          const api = pressApi()
          if (api) {
            const status = await api.keyStatus().catch(() => ({ present: false }))
            setHasKey(status.present)
          }
        }
      } finally {
        pollRef.current = false
      }
    })()
  })

  const shown = !!presser && phase !== 'idle' && !(props.hold && phase === 'answering')
  const onLive = props.onLive
  useEffect(() => { onLive?.(shown) }, [onLive, shown])

  if (!presser || phase === 'idle') return null
  if (props.hold && phase === 'answering') return null

  async function handleTypedAnswer() {
    if (!presser || !answer.trim()) return
    setPhase('grading')
    const api = pressApi()
    if (api && hasKey) {
      const result = await api.gradeAnswer({ question: presser.question, answer: answer.trim() }).catch(() => ({
        ok: false as const, code: 'network', message: 'unknown'
      }))
      if (result.ok) {
        setGradedTone(result.tone as PressTone)
        setReaction(result.reaction)
        setPhase('reacted')
        return
      }
    }
    // Fallback: treat as measured
    setGradedTone('measured')
    setReaction('The room takes note.')
    setPhase('reacted')
  }

  async function handleToneButton(tone: PressTone) {
    if (!presser) return
    setPhase('submitting')
    await client.answerPresser(answer.trim() || 'No comment.', tone)
    setPresser(null)
    setPhase('idle')
    setAnswer('')
    bumpRefresh()
  }

  /** Presser v2: one of the authored answers (docs/MEDIA-BEAT.md). Each
   *  carries its own consequence; 'delegate' sends the PR director. */
  async function handleOption(optionId: string, tone: PressTone) {
    if (!presser) return
    setPhase('submitting')
    await client.answerPresser('', tone, optionId)
    setPresser(null)
    setPhase('idle')
    setAnswer('')
    bumpRefresh()
  }

  async function handleConfirmReaction() {
    if (!presser) return
    setPhase('submitting')
    await client.answerPresser(answer.trim(), gradedTone)
    setPresser(null)
    setPhase('idle')
    setAnswer('')
    bumpRefresh()
  }

  const TONE_BUTTONS: Array<{ tone: PressTone; label: string; color: string }> = [
    { tone: 'measured',   label: 'Measured',   color: 'var(--cyan)' },
    { tone: 'fiery',      label: 'Fiery',      color: 'var(--amber)' },
    { tone: 'praise',     label: 'Praise',     color: 'var(--green)' },
    { tone: 'deflecting', label: 'No comment', color: 'var(--muted)' },
  ]

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--sp-4)',
      }}
    >
      <div
        className="panel stack"
        style={{
          maxWidth: 540,
          width: '100%',
          padding: 'var(--sp-5)',
          border: '1px solid var(--violet-border)',
          background: 'var(--bg2)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <Icon size={20} color="var(--violet-h)"><Icons.Interview /></Icon>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--violet-h)', textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Press Conference
            </div>
            <div className="muted small">
              {presser.askedBy
                ? `${presser.askedBy.name} · ${presser.askedBy.outlet} — ${presser.context}`
                : presser.personaId
                  ? `${PRESS_PERSONA_NAMES[presser.personaId].name} · ${PRESS_PERSONA_NAMES[presser.personaId].outlet} — ${presser.context}`
                  : presser.context}
            </div>
          </div>
        </div>

        {/* Question */}
        <div
          style={{
            padding: 'var(--sp-4)',
            borderLeft: '3px solid var(--accent)',
            background: 'var(--bg3)',
            borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
            fontSize: 14,
            fontStyle: 'italic',
            lineHeight: 1.5,
          }}
        >
          "{presser.question}"
        </div>

        {/* Presser v2: authored answers about a named player / the coach / the season */}
        {phase === 'answering' && presser.options && presser.options.length > 0 && (
          <div className="stack">
            <div className="muted small">Your answer goes on the record:</div>
            {presser.options.map((o) => (
              <button key={o.id} className="btn presser-option" onClick={() => handleOption(o.id, o.tone)}>
                <span>{o.label}</span>
                <span className="presser-option-hint">{o.hint}</span>
              </button>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-ghost"
                onClick={() => handleOption('delegate', 'measured')}
                title="Your communications director takes the question. Nobody is quoted; nothing changes."
              >
                Send the PR director
              </button>
            </div>
          </div>
        )}

        {/* Answering phase */}
        {(phase === 'answering' || phase === 'grading') && !(presser.options && presser.options.length > 0) && (
          <>
            {hasKey ? (
              <div className="stack">
                <label className="field-label">Your response</label>
                <textarea
                  className="input"
                  style={{ resize: 'vertical', minHeight: 80, fontFamily: 'inherit', fontSize: 13 }}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Type your answer…"
                  disabled={phase === 'grading'}
                />
                <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost" onClick={() => handleToneButton('deflecting')}>
                    No comment
                  </button>
                  <button className="btn" onClick={handleTypedAnswer} disabled={!answer.trim() || phase === 'grading'}>
                    {phase === 'grading' ? 'Grading…' : 'Answer'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="stack">
                <div className="muted small">Choose a tone for your response:</div>
                <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                  {TONE_BUTTONS.map((tb) => (
                    <button
                      key={tb.tone}
                      className="btn"
                      style={{ color: tb.color, borderColor: tb.color }}
                      onClick={() => handleToneButton(tb.tone)}
                    >
                      {tb.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Reaction phase */}
        {phase === 'reacted' && (
          <div className="stack">
            <div
              style={{
                padding: 'var(--sp-3)',
                background: 'var(--bg3)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              <span style={{ color: 'var(--muted)', fontSize: 11, display: 'block', marginBottom: 4 }}>
                Tone: <strong style={{ color: 'var(--text)' }}>{gradedTone}</strong>
              </span>
              <span style={{ fontStyle: 'italic' }}>{reaction}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn" onClick={handleConfirmReaction}>
                Confirm
              </button>
            </div>
          </div>
        )}

        {phase === 'submitting' && (
          <div className="muted small">Applying effects…</div>
        )}
      </div>
    </div>
  )
}
