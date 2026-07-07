/**
 * Development camp (Season Rhythm M3) — early July, the practice rink. The
 * org's kids skate for a week; the staff hand you their reads; you name the
 * camp standout. One decision, real effects, and the world moves on.
 *
 * Artwork slot: assets/scenes/dev-camp-rink.png (CSS fallback otherwise).
 */
import { useState } from 'react'
import type { WorkerResponse } from '../../worker/protocol'
import { Backdrop } from './BoardMeetingScreen'
import { PlayerFace } from '../components/PlayerFace'
import { PlayerLink, useNav } from '../components/NavContext'
import { Notice } from '../components/ui'
import { toast } from '../components/store'
import { useClient, useScreenData } from '../hooks/useSim'

type DevCampView = Extract<WorkerResponse, { type: 'devCamp' }>['devCamp']

const GRADE_COLOR: Record<string, string> = {
  A: 'var(--green, #2ea043)',
  B: 'var(--amber, #d6a056)',
  C: 'var(--red, #e05555)',
}

export function DevCampScreen(): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { data: camp, loading } = useScreenData<DevCampView>(
    () => client.getDevCamp(),
    (r) => (r.type === 'devCamp' ? r.devCamp : null)
  )

  async function nameStandout(): Promise<void> {
    if (!picked || busy) return
    setBusy(true)
    const res = await client.submitDevCamp(picked)
    setBusy(false)
    if (res.type === 'error') { toast(res.message ?? 'Could not resolve camp.', 'error'); return }
    toast('Camp standout named — the staff will build his summer around it.', 'info')
    nav.navigate('dashboard')
  }

  if (loading) return <Notice kind="info">The kids are lacing up…</Notice>
  if (!camp) {
    return (
      <section className="stack">
        <Notice kind="info">Development camp has wrapped for the summer.</Notice>
      </section>
    )
  }

  return (
    <section style={{ height: '100%' }}>
      <Backdrop scene="dev-camp-rink">
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--accent, #d6a056)' }}>
            July — Development Camp
          </div>
          <h2 style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 800 }}>The future, on one sheet of ice</h2>
        </div>

        {/* the staff on the glass */}
        <div className="row" style={{ gap: 'var(--sp-5)', marginBottom: 'var(--sp-4)' }}>
          {camp.cast.map((c) => (
            <div key={c.name} style={{ textAlign: 'center' }}>
              <PlayerFace faceId={c.faceId} name={c.name} size={52} />
              <div style={{ fontSize: 12, fontWeight: 700, marginTop: 3 }}>{c.name}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>{c.title}</div>
            </div>
          ))}
        </div>

        <div style={{ maxWidth: 860, marginBottom: 'var(--sp-3)', background: 'rgba(10,12,18,0.86)', backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, padding: '10px 14px', fontSize: 13, lineHeight: 1.5 }}>
          A week of skates, drills and scrimmages is done. The staff's reads are in —
          pick <b>one player to name camp standout</b>. It goes on his wall, and your
          scouts' book on him gets a real chapter.
        </div>

        {/* the invitees */}
        <div style={{ maxWidth: 860, marginBottom: 'var(--sp-4)' }}>
          <div className="table-wrap" style={{ background: 'rgba(8,10,15,0.85)', backdropFilter: 'blur(6px)', borderRadius: 8 }}>
            <table className="table">
              <thead>
                <tr><th></th><th>Player</th><th className="num">Age</th><th>Camp</th><th>The staff&apos;s read</th><th></th></tr>
              </thead>
              <tbody>
                {camp.invitees.map((p) => (
                  <tr key={p.playerId} style={picked === p.playerId ? { background: 'rgba(var(--accent-rgb),0.14)' } : undefined}>
                    <td><PlayerFace faceId={p.faceId} name={p.name} size={28} /></td>
                    <td>
                      <PlayerLink playerId={p.playerId} name={p.name} />{' '}
                      <span className="muted small">{p.position}</span>
                      {p.drafted && <span className="chip chip-accent" style={{ fontSize: 9, marginLeft: 6 }}>YOUR PICK</span>}
                    </td>
                    <td className="num muted">{p.age}</td>
                    <td><span style={{ fontWeight: 800, color: GRADE_COLOR[p.grade] }}>{p.grade}</span></td>
                    <td className="small" style={{ maxWidth: 380 }}>{p.read}</td>
                    <td>
                      <button
                        className={`btn btn-sm${picked === p.playerId ? ' btn-primary' : ''}`}
                        onClick={() => setPicked(p.playerId)}
                      >
                        {picked === p.playerId ? 'Standout ✓' : 'Pick'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="row" style={{ gap: 'var(--sp-3)' }}>
          <button className="btn btn-primary" disabled={!picked || busy} onClick={() => void nameStandout()}>
            Name the camp standout
          </button>
          <button
            className="btn btn-ghost"
            title="The staff will run camp and file a report"
            onClick={() => void (async () => { await client.skipDevCamp(); nav.navigate('dashboard') })()}
          >
            Leave it to the staff
          </button>
        </div>
      </Backdrop>
    </section>
  )
}
