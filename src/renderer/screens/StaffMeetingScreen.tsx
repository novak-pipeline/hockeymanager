/**
 * StaffMeetingScreen — the GM's meeting with his staff.
 *
 * Two halves:
 *   1. Tactical direction — suggest a system change to the head coach, who decides
 *      whether to adopt it (he owns the tactics).
 *   2. Agenda — topics the GM marked from around the app (player profiles, etc.).
 *      Discussing one has the relevant staff member weigh in.
 *
 * Lives under Front Office. (Previously crammed onto the Tactics screen.)
 */
import { useCallback, useEffect, useState } from 'react'
import type { StaffMeetingSummaryView } from '../../worker/protocol'
import { Panel, ScreenHeader } from '../components/ui'
import { PlayerFace } from '../components/PlayerFace'
import { PlayerLink } from '../components/NavContext'
import { toast } from '../components/store'
import { useClient } from '../hooks/useSim'

function fitColor(fit: number): string {
  if (fit >= 78) return 'var(--success)'
  if (fit >= 66) return 'var(--accent, #f5b301)'
  if (fit >= 55) return 'var(--amber, #f59e0b)'
  return 'var(--danger)'
}
const ISSUE_META: Record<string, { label: string; color: string }> = {
  tired: { label: 'Tired', color: 'var(--danger)' },
  unhappy: { label: 'Unhappy', color: 'var(--amber, #f59e0b)' },
  slumping: { label: 'Slumping', color: 'var(--accent2, #e0b341)' },
}

const TACTIC_SUGGESTIONS: { id: string; label: string; detail: string }[] = [
  { id: 'fitRoster',           label: 'Play to our strengths',  detail: 'Set the system that best fits the players.' },
  { id: 'faster',              label: 'Play faster',            detail: 'Push the pace; attack in transition.' },
  { id: 'defensive',           label: 'Tighten up defensively', detail: 'Lower tempo; protect our end.' },
  { id: 'physical',            label: 'Play more physical',     detail: 'Heavy cycle; win the battles.' },
  { id: 'aggressiveForecheck', label: 'Forecheck aggressively', detail: 'Pressure the puck high (2-1-2).' },
]

interface AgendaRow { id: string; label: string }

export function StaffMeetingScreen(): JSX.Element {
  const client = useClient()
  const [busy, setBusy] = useState(false)
  const [coachReply, setCoachReply] = useState<{ accepted: boolean; response: string } | null>(null)
  const [agenda, setAgenda] = useState<AgendaRow[]>([])
  const [discussion, setDiscussion] = useState<{ speaker: string; speakerRole: string; opinion: string } | null>(null)
  const [summary, setSummary] = useState<StaffMeetingSummaryView | null>(null)

  const loadAgenda = useCallback(async (): Promise<void> => {
    const res = await client.getAgenda()
    if (res.type === 'agenda') setAgenda(res.items.map((i) => ({ id: i.id, label: i.label })))
  }, [client])

  const loadSummary = useCallback(async (): Promise<void> => {
    const res = await client.getStaffMeetingSummary()
    if (res.type === 'staffMeetingSummary') setSummary(res.summary)
  }, [client])

  useEffect(() => { void loadAgenda(); void loadSummary() }, [loadAgenda, loadSummary])

  async function suggest(id: string): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const res = await client.suggestToCoach(id)
      if (res.type === 'coachResponse') {
        setCoachReply({ accepted: res.accepted, response: res.response })
        if (res.accepted) await loadSummary() // system + fit may have shifted
      } else if (res.type === 'error') toast(res.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function discuss(id: string): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const res = await client.discussAgendaItem(id)
      if (res.type === 'discussion') {
        setDiscussion({ speaker: res.result.speaker, speakerRole: res.result.speakerRole, opinion: res.result.opinion })
        await loadAgenda()
      } else if (res.type === 'error') {
        toast(res.message, 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="stack">
      <ScreenHeader title="Staff Meeting">
        <span className="muted small">Set the agenda elsewhere with “Mark for meeting”.</span>
      </ScreenHeader>

      {/* Coach's system overview */}
      {summary && (
        <Panel title="The Coach’s System">
          <div className="row" style={{ gap: 'var(--sp-4)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'center', minWidth: 240, flex: '1 1 280px' }}>
              <PlayerFace faceId={summary.coachFaceId} name={summary.coachName} size={40} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{summary.coachName}</div>
                <div style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 13 }}>{summary.systemLabel}</div>
                <div className="muted small" style={{ lineHeight: 1.4 }}>{summary.philosophy}</div>
              </div>
            </div>
            <div style={{ flex: '1 1 320px', minWidth: 260 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', fontSize: 12 }}>
                {([
                  ['Forecheck', summary.forecheckName],
                  ['Breakout', summary.breakoutName],
                  ['Neutral zone', summary.nzName],
                  ['D-zone', summary.dZoneName],
                  ['Power play', summary.ppName],
                  ['Penalty kill', summary.pkName],
                  ['Pace', summary.paceName],
                ] as const).map(([k, v]) => (
                  <span key={k} style={{ display: 'contents' }}>
                    <span className="muted">{k}</span>
                    <span style={{ fontWeight: 600 }}>{v}</span>
                  </span>
                ))}
              </div>
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 200 }}>
              <div className="row-between" style={{ marginBottom: 4 }}>
                <span className="muted small">Roster fit</span>
                <span style={{ fontWeight: 700, color: fitColor(summary.rosterFit) }}>
                  {summary.fitLabel} · {summary.rosterFit}/100
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--bg0)', overflow: 'hidden', marginBottom: 6 }}>
                <div style={{ width: `${summary.rosterFit}%`, height: '100%', background: fitColor(summary.rosterFit) }} />
              </div>
              {summary.fitAdvice.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {summary.fitAdvice.slice(0, 3).map((a, i) => (
                    <li key={i} className="muted small" style={{ marginBottom: 2 }}>{a}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {summary.flagged.length > 0 && (
            <div style={{ borderTop: '1px solid var(--line)', marginTop: 'var(--sp-3)', paddingTop: 'var(--sp-3)' }}>
              <div className="muted small" style={{ marginBottom: 6 }}>
                Players the coach is watching — raise them on the agenda:
              </div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
                {summary.flagged.map((f) => {
                  const meta = ISSUE_META[f.issue]!
                  return (
                    <div key={f.playerId} className="chip" style={{ gap: 6, paddingLeft: 6 }} title={f.detail}>
                      <PlayerFace faceId={f.faceId} name={f.name} size={18} />
                      <PlayerLink playerId={f.playerId} name={f.name} />
                      <span style={{ color: meta.color, fontSize: 10, fontWeight: 700 }}>{meta.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </Panel>
      )}

      <div className="grid grid-2" style={{ gap: 'var(--sp-4)', alignItems: 'start' }}>
        {/* Agenda */}
        <Panel title="Agenda">
          {agenda.length === 0 ? (
            <div className="muted small">
              Nothing on the agenda. Use “Mark for meeting” on a player to raise a topic here.
            </div>
          ) : (
            <div className="stack" style={{ gap: 'var(--sp-2)' }}>
              {agenda.map((a) => (
                <div key={a.id} className="row-between" style={{ gap: 'var(--sp-2)' }}>
                  <span className="small" style={{ minWidth: 0 }}>{a.label}</span>
                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void discuss(a.id)}>
                    Discuss
                  </button>
                </div>
              ))}
            </div>
          )}
          {discussion && (
            <div
              style={{
                marginTop: 'var(--sp-3)', padding: 'var(--sp-2) var(--sp-3)',
                borderLeft: '3px solid var(--violet-h)', background: 'var(--bg2)',
                borderRadius: 'var(--radius-sm)', fontSize: 13, lineHeight: 1.5,
              }}
            >
              <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
                {discussion.speaker} · {discussion.speakerRole}
              </div>
              {discussion.opinion}
            </div>
          )}
        </Panel>

        {/* Tactical direction */}
        <Panel title="Tactical Direction">
          <div className="muted small" style={{ marginBottom: 'var(--sp-2)' }}>
            Your head coach owns the system. Suggest a direction — whether he adopts it
            depends on his judgement and how well it fits the roster.
          </div>
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            {TACTIC_SUGGESTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() => void suggest(s.id)}
                title={s.detail}
                style={{ justifyContent: 'flex-start', textAlign: 'left' }}
              >
                {s.label}
              </button>
            ))}
          </div>
          {coachReply && (
            <div
              style={{
                marginTop: 'var(--sp-3)', padding: 'var(--sp-2) var(--sp-3)',
                borderLeft: `3px solid ${coachReply.accepted ? 'var(--success)' : 'var(--muted)'}`,
                background: 'var(--bg2)', borderRadius: 'var(--radius-sm)', fontSize: 13, lineHeight: 1.5,
              }}
            >
              {coachReply.response}
            </div>
          )}
        </Panel>
      </div>
    </section>
  )
}
