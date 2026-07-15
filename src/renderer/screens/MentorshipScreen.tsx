import { useState } from 'react'
import type { MentorshipView } from '../../worker/protocol'
import { Notice, Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'
import { toast } from '../components/store'

export function MentorshipScreen(): JSX.Element {
  const client = useClient()
  const { data, loading, error, refetch } = useScreenData<MentorshipView>(
    () => client.getMentorships(),
    (r) => (r.type === 'mentorships' ? r.mentorships : null)
  )
  const [mentor, setMentor] = useState('')
  const [mentee, setMentee] = useState('')
  const [busy, setBusy] = useState(false)

  const assign = async (): Promise<void> => {
    if (!mentor || !mentee) {
      toast('Pick both a mentor and a mentee.', 'info')
      return
    }
    setBusy(true)
    const r = await client.assignMentor(mentee, mentor)
    setBusy(false)
    if (r.type === 'error') toast(r.message, 'error')
    else {
      if (r.type === 'ok' && r.note) toast(r.note, 'success')
      setMentor('')
      setMentee('')
      refetch()
    }
  }

  const clear = async (menteeId: string): Promise<void> => {
    setBusy(true)
    const r = await client.clearMentor(menteeId)
    setBusy(false)
    if (r.type === 'error') toast(r.message, 'error')
    else refetch()
  }

  return (
    <section className="stack">
      <ScreenHeader title="Mentorship" />
      <ScreenStateNotices loading={loading} error={error} />
      {data && (
        <>
          <Panel title="Pair a veteran with a young player">
            <div className="muted small" style={{ marginBottom: 10 }}>
              A seasoned veteran takes a young player under his wing, accelerating his
              development. Mentor must be a roster veteran; mentee a player aged 23 or under.
            </div>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={mentor} onChange={(e) => setMentor(e.target.value)} className="select">
                <option value="">— Mentor (veteran) —</option>
                {data.eligibleMentors.map((m) => (
                  <option key={m.playerId} value={m.playerId}>{m.name} ({m.position}, {m.age})</option>
                ))}
              </select>
              <span className="muted">mentors</span>
              <select value={mentee} onChange={(e) => setMentee(e.target.value)} className="select">
                <option value="">— Mentee (young player) —</option>
                {data.eligibleMentees.map((m) => (
                  <option key={m.playerId} value={m.playerId}>{m.name} ({m.position}, {m.age})</option>
                ))}
              </select>
              <button className="btn btn-primary" disabled={busy} onClick={assign}>Pair them up</button>
            </div>
          </Panel>

          <Panel title="Active mentorships">
            {data.pairs.length === 0 ? (
              <Notice kind="info">No mentorships yet. Pair a veteran with a prospect to speed his growth.</Notice>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Mentor</th><th>Mentee</th><th /></tr>
                  </thead>
                  <tbody>
                    {data.pairs.map((p) => (
                      <tr key={p.mentee.playerId}>
                        <td>{p.mentor.name} <span className="muted small">({p.mentor.position}, {p.mentor.age})</span></td>
                        <td>{p.mentee.name} <span className="muted small">({p.mentee.position}, {p.mentee.age})</span></td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn" disabled={busy} onClick={() => clear(p.mentee.playerId)}>Dissolve</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </section>
  )
}
