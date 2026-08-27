/**
 * The Deadline War Room (Season Rhythm M4) — staged while the sim holds on
 * deadline day. Everything on screen is read from the LIVE market: your
 * posture, your cap sheet, real rental targets on selling clubs (with the GM
 * you'd be calling), or — if you're the seller — the contending GMs hungriest
 * for your expiring veterans.
 *
 * Artwork slot: assets/scenes/war-room.png (CSS fallback otherwise).
 */
import type { WorkerResponse } from '../../worker/protocol'
import { Backdrop } from './BoardMeetingScreen'
import { PlayerFace } from '../components/PlayerFace'
import { PlayerLink, useNav } from '../components/NavContext'
import { Icon } from '../components/primitives'
import { Icons } from '../components/icons'
import { Notice } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'
import { SortHeaders, sortColumns, useTableSort } from '../components/sortable'

type WarRoomTarget = NonNullable<Extract<WorkerResponse, { type: 'warRoom' }>['warRoom']>['targets'][number]

const WAR_ROOM_TARGET_COLS = sortColumns<WarRoomTarget>()([
  { key: 'name', label: 'Player', value: (t) => t.name },
  { key: 'age', label: 'Age', value: (t) => t.age, align: 'right', initialDir: 'asc' },
  { key: 'club', label: 'Club', value: (t) => t.teamAbbr },
  { key: 'gm', label: 'The man to call', value: (t) => t.gmName },
])

/** Stable identity so the sort hook is not handed a new array each render. */
const NO_TARGETS: WarRoomTarget[] = []

type WarRoomView = Extract<WorkerResponse, { type: 'warRoom' }>['warRoom']

export function WarRoomScreen(): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const { data: room, loading } = useScreenData<WarRoomView>(
    () => client.getWarRoom(),
    (r) => (r.type === 'warRoom' ? r.warRoom : null)
  )
  const { sorted, sortKey, dir, sortBy } = useTableSort(room?.targets ?? NO_TARGETS, WAR_ROOM_TARGET_COLS, { key: null })

  if (loading) return <Notice kind="info">The staff are gathering…</Notice>
  if (!room) {
    return (
      <section className="stack">
        <Notice kind="info">The war room is empty — it only assembles on deadline day.</Notice>
      </section>
    )
  }

  return (
    <section style={{ height: '100%' }}>
      <Backdrop scene="war-room">
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--danger, #e05555)' }}>
            ⏰ Trade deadline — the window closes when you continue
          </div>
          <h2 style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 800 }}>The War Room</h2>
        </div>

        {/* the staff around the table */}
        <div className="row" style={{ gap: 'var(--sp-5)', marginBottom: 'var(--sp-4)' }}>
          {room.cast.map((c) => (
            <div key={c.id} style={{ textAlign: 'center' }}>
              <PlayerFace faceId={c.faceId} name={c.name} size={52} />
              <div style={{ fontSize: 12, fontWeight: 700, marginTop: 3 }}>{c.name}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>{c.title}</div>
            </div>
          ))}
        </div>

        {/* the briefing */}
        <div className="stack" style={{ gap: 'var(--sp-2)', maxWidth: 780, marginBottom: 'var(--sp-4)' }}>
          <div style={{ background: 'rgba(10,12,18,0.86)', backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, padding: '10px 14px', fontSize: 14, lineHeight: 1.55 }}>
            <b>The stance:</b> {room.stance}
          </div>
          <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <span className="chip" style={{ fontSize: 12 }}>{room.capLine}</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>
            Coach: “{room.coachLine}”
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>
            AGM: “{room.agmLine}”
          </div>
        </div>

        {/* the board: targets or suitors */}
        {room.targets.length > 0 && (
          <div style={{ maxWidth: 780, marginBottom: 'var(--sp-4)' }}>
            <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--accent, #d6a056)', marginBottom: 6 }}>
              Realistic targets — expiring deals on selling clubs
            </div>
            <div className="table-wrap" style={{ background: 'rgba(8,10,15,0.85)', backdropFilter: 'blur(6px)', borderRadius: 8 }}>
              <table className="table">
                <thead>
                  <tr><SortHeaders columns={WAR_ROOM_TARGET_COLS} sortKey={sortKey} dir={dir} onSort={sortBy} /></tr>
                </thead>
                <tbody>
                  {sorted.map((t) => (
                    <tr key={t.playerId}>
                      <td><PlayerLink playerId={t.playerId} name={t.name} /> <span className="muted small">{t.position}</span></td>
                      <td className="num muted">{t.age}</td>
                      <td className="muted">{t.teamAbbr}</td>
                      <td className="small">{t.gmName} <span className="muted">— {t.gmStyle}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {room.suitors.length > 0 && (
          <div style={{ maxWidth: 780, marginBottom: 'var(--sp-4)' }}>
            <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--accent, #d6a056)', marginBottom: 6 }}>
              The phones are ringing — contenders with interest
            </div>
            <div className="stack" style={{ gap: 6 }}>
              {room.suitors.map((s2, i) => (
                <div key={i} style={{ background: 'rgba(8,10,15,0.85)', backdropFilter: 'blur(6px)', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
                  <Icon size={14}><Icons.Phone /></Icon> <b>{s2.gmName}</b> ({s2.teamAbbr}) <span className="muted">— {s2.gmStyle} —</span> asking about <b>{s2.wantsName}</b>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="row" style={{ gap: 'var(--sp-3)' }}>
          <button className="btn btn-primary" onClick={() => nav.navigate('trades')}>
            Open the trade office →
          </button>
          <button className="btn btn-ghost" onClick={() => nav.navigate('dashboard')}
            title="The deadline passes when you next continue">
            Stand pat
          </button>
        </div>
      </Backdrop>
    </section>
  )
}
