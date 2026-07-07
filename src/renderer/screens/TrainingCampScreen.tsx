/**
 * Training camp — CUT DAY (Season Rhythm M3). The coach's battle verdicts are
 * in; the final roster calls are yours. Sending a waiver-required veteran down
 * runs REAL waivers — he can be claimed for nothing. The best 23 is not always
 * the safest 23.
 *
 * Artwork slot: assets/scenes/camp-rink.png (CSS fallback otherwise).
 */
import { useEffect, useState } from 'react'
import type { WorkerResponse } from '../../worker/protocol'
import { Backdrop } from './BoardMeetingScreen'
import { PlayerFace } from '../components/PlayerFace'
import { PlayerLink, useNav } from '../components/NavContext'
import { Notice } from '../components/ui'
import { toast } from '../components/store'
import { useClient, useScreenData } from '../hooks/useSim'

type TrainingCampView = Extract<WorkerResponse, { type: 'trainingCamp' }>['camp']

export function TrainingCampScreen(): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const [placements, setPlacements] = useState<Record<string, 'nhl' | 'ahl'>>({})
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState<string[] | null>(null)
  const { data: camp, loading } = useScreenData<TrainingCampView>(
    () => client.getTrainingCamp(),
    (r) => (r.type === 'trainingCamp' ? r.camp : null)
  )

  // Default every call to the coach's plan.
  useEffect(() => {
    if (!camp) return
    const init: Record<string, 'nhl' | 'ahl'> = {}
    for (const d of camp.decisions) init[d.playerId] = d.coachPlan
    setPlacements(init)
  }, [camp])

  async function breakCamp(): Promise<void> {
    if (!camp || busy) return
    setBusy(true)
    const res = await client.submitTrainingCamp(
      Object.entries(placements).map(([playerId, place]) => ({ playerId, place }))
    )
    setBusy(false)
    if (res.type === 'error') { toast(res.message ?? 'Could not break camp.', 'error'); return }
    if (res.type === 'trainingCamp' && res.notes) setNotes(res.notes)
  }

  if (loading) return <Notice kind="info">The coach is finishing his notes…</Notice>

  if (notes) {
    // The aftermath: what happened when camp broke (including any claims).
    return (
      <section style={{ height: '100%' }}>
        <Backdrop scene="camp-rink">
          <h2 style={{ margin: '0 0 var(--sp-3)', fontSize: 22, fontWeight: 800 }}>Camp breaks</h2>
          <div className="stack" style={{ gap: 6, maxWidth: 720, marginBottom: 'var(--sp-4)' }}>
            {notes.map((n, i) => (
              <div key={i} style={{ background: 'rgba(10,12,18,0.86)', backdropFilter: 'blur(6px)', border: n.includes('claimed') ? '1px solid var(--red, #e05555)' : '1px solid rgba(255,255,255,0.14)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
                {n}
              </div>
            ))}
          </div>
          <button className="btn btn-primary" onClick={() => nav.navigate('dashboard')}>
            To opening night →
          </button>
        </Backdrop>
      </section>
    )
  }

  if (!camp) {
    return (
      <section className="stack">
        <Notice kind="info">Camp has broken — the roster is set for opening night.</Notice>
      </section>
    )
  }

  const nhlDelta = camp.decisions.reduce((n, d) => {
    const want = placements[d.playerId] ?? d.coachPlan
    return n + (want === 'nhl' && d.current === 'ahl' ? 1 : 0) - (want === 'ahl' && d.current === 'nhl' ? 1 : 0)
  }, 0)

  return (
    <section style={{ height: '100%' }}>
      <Backdrop scene="camp-rink">
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--danger, #e05555)' }}>
            Training camp — cut day
          </div>
          <h2 style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 800 }}>Pick your 23</h2>
        </div>

        {/* the staff */}
        <div className="row" style={{ gap: 'var(--sp-5)', marginBottom: 'var(--sp-4)' }}>
          {camp.cast.map((c) => (
            <div key={c.name} style={{ textAlign: 'center' }}>
              <PlayerFace faceId={c.faceId} name={c.name} size={52} />
              <div style={{ fontSize: 12, fontWeight: 700, marginTop: 3 }}>{c.name}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>{c.title}</div>
            </div>
          ))}
        </div>

        <div style={{ maxWidth: 900, marginBottom: 'var(--sp-3)', background: 'rgba(10,12,18,0.86)', backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, padding: '10px 14px', fontSize: 13, lineHeight: 1.5 }}>
          The battles have verdicts. Every row defaults to the coach&apos;s plan — overrule him where
          you disagree. <b>⚠ Waiver-required players sent down can be claimed by any club, for nothing.</b>
          {nhlDelta !== 0 && (
            <span className="muted"> (Net NHL roster change from current: {nhlDelta > 0 ? `+${nhlDelta}` : nhlDelta})</span>
          )}
        </div>

        <div style={{ maxWidth: 900, marginBottom: 'var(--sp-4)' }}>
          <div className="table-wrap" style={{ background: 'rgba(8,10,15,0.85)', backdropFilter: 'blur(6px)', borderRadius: 8 }}>
            <table className="table">
              <thead>
                <tr><th></th><th>Player</th><th className="num">Age</th><th>The coach&apos;s verdict</th><th>Your call</th></tr>
              </thead>
              <tbody>
                {camp.decisions.map((d) => {
                  const want = placements[d.playerId] ?? d.coachPlan
                  return (
                    <tr key={d.playerId}>
                      <td><PlayerFace faceId={d.faceId} name={d.name} size={28} /></td>
                      <td>
                        <PlayerLink playerId={d.playerId} name={d.name} />{' '}
                        <span className="muted small">{d.position}</span>
                        {d.waiverRequired && <span className="chip chip-danger" style={{ fontSize: 9, marginLeft: 6 }}>WV</span>}
                      </td>
                      <td className="num muted">{d.age}</td>
                      <td className="small" style={{ maxWidth: 360 }}>
                        {d.coachPlan === 'nhl' ? '▲ ' : '▼ '}{d.line}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          <button
                            className={`btn btn-sm${want === 'nhl' ? ' btn-primary' : ''}`}
                            onClick={() => setPlacements((prev) => ({ ...prev, [d.playerId]: 'nhl' }))}
                          >
                            NHL
                          </button>
                          <button
                            className={`btn btn-sm${want === 'ahl' ? ' btn-primary' : ''}`}
                            title={d.waiverRequired ? 'He must clear waivers — any club can claim him.' : undefined}
                            onClick={() => setPlacements((prev) => ({ ...prev, [d.playerId]: 'ahl' }))}
                          >
                            {d.waiverRequired ? 'AHL ⚠' : 'AHL'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="row" style={{ gap: 'var(--sp-3)' }}>
          <button className="btn btn-primary" disabled={busy} onClick={() => void breakCamp()}>
            Break camp with this roster
          </button>
          <button
            className="btn btn-ghost"
            title="Sim on and the coach applies his plan as-is"
            onClick={() => nav.navigate('dashboard')}
          >
            Decide later
          </button>
        </div>
      </Backdrop>
    </section>
  )
}
