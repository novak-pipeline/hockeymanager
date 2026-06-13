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
import { Panel, ScreenHeader } from '../components/ui'
import { toast } from '../components/store'
import { useClient } from '../hooks/useSim'

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

  const loadAgenda = useCallback(async (): Promise<void> => {
    const res = await client.getAgenda()
    if (res.type === 'agenda') setAgenda(res.items.map((i) => ({ id: i.id, label: i.label })))
  }, [client])

  useEffect(() => { void loadAgenda() }, [loadAgenda])

  async function suggest(id: string): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const res = await client.suggestToCoach(id)
      if (res.type === 'coachResponse') setCoachReply({ accepted: res.accepted, response: res.response })
      else if (res.type === 'error') toast(res.message, 'error')
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
