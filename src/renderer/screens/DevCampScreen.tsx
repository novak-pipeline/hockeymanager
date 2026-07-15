/**
 * Development camp (Season Rhythm M3) — early July, the practice rink. The
 * whole prospect pool skates for a week; the coaching staff file their reads
 * on every kid and name their own camp standout. The GM watches and closes
 * the book. One scene, real effects, and the world moves on.
 *
 * Artwork slot: assets/scenes/dev-camp-rink.png (CSS fallback otherwise).
 */
import { useEffect, useState } from 'react'
import type { WorkerResponse, DevCampInvitesView } from '../../worker/protocol'
import { Backdrop } from './BoardMeetingScreen'
import { useShellActions } from '../components/ActionsContext'
import { PlayerFace } from '../components/PlayerFace'
import { PlayerLink, useNav } from '../components/NavContext'
import { Notice } from '../components/ui'
import { toast } from '../components/store'
import { useClient, useScreenData } from '../hooks/useSim'
import type { SimClient } from '../../worker/client'

type DevCampView = Extract<WorkerResponse, { type: 'devCamp' }>['devCamp']

const GRADE_COLOR: Record<string, string> = {
  A: 'var(--green, #2ea043)',
  B: 'var(--amber, #d6a056)',
  C: 'var(--red, #e05555)',
}

export function DevCampScreen(): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const actions = useShellActions()
  const [busy, setBusy] = useState(false)
  const [editingInvites, setEditingInvites] = useState(false)
  const { data: camp, loading } = useScreenData<DevCampView>(
    () => client.getDevCamp(),
    (r) => (r.type === 'devCamp' ? r.devCamp : null)
  )

  // Once camp has wrapped, don't strand the GM on an empty scene — the sim has
  // moved on, so send them back to the dashboard rather than showing this as a
  // default view.
  useEffect(() => {
    if (!loading && !camp) nav.navigate('dashboard')
  }, [loading, camp, nav])

  async function closeCamp(): Promise<void> {
    if (busy) return
    setBusy(true)
    const res = await client.submitDevCamp()
    setBusy(false)
    if (res.type === 'error') { toast(res.message ?? 'Could not resolve camp.', 'error'); return }
    toast('Camp closed — the staff filed their reads.', 'info')
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
            July — Development Camp · Day {camp.day} of 3
          </div>
          <h2 style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 800 }}>
            {camp.day === 1 ? 'Arrival day — the future walks in' : camp.day === 2 ? `Scrimmage day — ${camp.scoreline ?? 'White vs Blue'}` : 'Wrap day — the reads are final'}
          </h2>
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
          {camp.day === 1 && (
            <>The organisation&apos;s kids hit the ice this week — this year&apos;s picks included. The
            staff take their first looks today; <b>tomorrow they scrimmage</b>, for real, with a box score.</>
          )}
          {camp.day === 2 && (
            <>A full intra-squad game — <b>{camp.scoreline}</b>. The lines below are real production.
            The staff file final grades tomorrow, and name their camp standout.</>
          )}
          {camp.day === 3 && (
            <>The week is done and the grades below argue from the scrimmage sheet.{' '}
            {camp.coachStandout
              ? <>The staff&apos;s standout is <b>{camp.coachStandout.name}</b> — he {camp.coachStandout.reason}.</>
              : <>The staff have filed their reads on the whole group.</>}
            </>
          )}
        </div>

        {/* #182 invite editor — on arrival day the GM curates who skates */}
        {camp.day === 1 && editingInvites && (
          <DevCampInviteEditor client={client} onClose={() => setEditingInvites(false)} />
        )}

        {/* the invitees — sorted by grade, densest tier first, so the pool
            reads as tiers rather than an undifferentiated scroll */}
        {!(camp.day === 1 && editingInvites) && (() => {
          const rank: Record<string, number> = { A: 0, B: 1, C: 2 }
          const pts = (p: DevCampView['invitees'][number]) => (p.line ? p.line.g * 2 + p.line.a : -1)
          const sorted = [...camp.invitees].sort(
            (a, b) => (rank[a.grade] ?? 3) - (rank[b.grade] ?? 3) || pts(b) - pts(a) || a.name.localeCompare(b.name)
          )
          const counts: Record<string, number> = { A: 0, B: 0, C: 0 }
          for (const p of camp.invitees) counts[p.grade] = (counts[p.grade] ?? 0) + 1
          const picks = camp.invitees.filter((p) => p.drafted).length
          // Drop the repeated boilerplate tail — keep the first, telling clause.
          const shortRead = (r: string): string => {
            const s = (r.split(/\s[—–]\s|\. /)[0] ?? r).trim().replace(/\.$/, '')
            return s.length > 48 ? s.slice(0, 46) + '…' : s
          }
          return (
            <div style={{ maxWidth: 880, marginBottom: 'var(--sp-4)' }}>
              {/* distribution — scan the shape of the class at a glance */}
              <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: 'wrap', fontSize: 11, alignItems: 'center' }}>
                <span className="muted">{camp.invitees.length} skaters at camp:</span>
                {(['A', 'B', 'C'] as const).map((g) => (
                  <span key={g} className="chip" style={{ fontSize: 10, borderColor: GRADE_COLOR[g], color: GRADE_COLOR[g] }}>
                    {counts[g] ?? 0} · {g === 'A' ? 'standing out' : g === 'B' ? 'on track' : 'behind'}
                  </span>
                ))}
                {picks > 0 && <span className="chip chip-accent" style={{ fontSize: 10 }}>{picks} of your picks</span>}
              </div>
              <div
                className="table-wrap"
                style={{ background: 'rgba(8,10,15,0.85)', backdropFilter: 'blur(6px)', borderRadius: 8, maxHeight: '44vh', overflowY: 'auto' }}
              >
                <table className="table" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 24 }}></th><th>Player</th><th className="num">Age</th>
                      {camp.day >= 2 && <th className="num">G-A</th>}
                      <th className="num">Grade</th><th>Read</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((p) => {
                      const isStandout = camp.coachStandout?.playerId === p.playerId
                      return (
                        <tr key={p.playerId} style={isStandout ? { background: 'rgba(var(--accent-rgb),0.14)' } : undefined}>
                          <td><PlayerFace faceId={p.faceId} name={p.name} size={22} /></td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <PlayerLink playerId={p.playerId} name={p.name} /> <span className="muted" style={{ fontSize: 10 }}>{p.position}</span>
                            {p.drafted && <span className="chip chip-accent" style={{ fontSize: 8, marginLeft: 5 }}>PICK</span>}
                            {isStandout && <span className="chip chip-success" style={{ fontSize: 8, marginLeft: 5 }}>★</span>}
                          </td>
                          <td className="num muted">{p.age}</td>
                          {camp.day >= 2 && (
                            <td
                              className="num mono"
                              title={p.line ? `${p.line.g}G ${p.line.a}A · ${p.line.sog} SOG (${p.line.squad})` : undefined}
                            >
                              {p.line ? `${p.line.g}-${p.line.a}` : p.position === 'G' ? 'G' : '—'}
                            </td>
                          )}
                          <td className="num"><span style={{ fontWeight: 800, color: GRADE_COLOR[p.grade] }}>{p.grade}</span></td>
                          <td className="muted" style={{ maxWidth: 280, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={p.read}>
                            {shortRead(p.read)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}

        <div className="row" style={{ gap: 'var(--sp-3)' }}>
          {camp.day === 1 && (
            <button className="btn btn-ghost" onClick={() => setEditingInvites((v) => !v)}>
              {editingInvites ? 'Done with invites' : 'Manage invites'}
            </button>
          )}
          {camp.day < 3 ? (
            <button className="btn btn-primary" disabled={actions.busy || (camp.day === 1 && editingInvites)} onClick={actions.continueGame}>
              {camp.day === 1 ? 'Run the scrimmage ▶' : 'Hear the final reads ▶'}
            </button>
          ) : (
            <button className="btn btn-primary" disabled={busy} onClick={() => void closeCamp()}>
              Close the book on camp
            </button>
          )}
          <button
            className="btn btn-ghost"
            title="The staff will run the rest of camp and file a report"
            onClick={() => void (async () => { await client.skipDevCamp(); nav.navigate('dashboard') })()}
          >
            Leave it to the staff
          </button>
        </div>
      </Backdrop>
    </section>
  )
}

/** #182: the dev-camp invite editor — the staff's auto list, with the GM free to
 *  cut names and add prospects or young tryout invites from the system. */
function DevCampInviteEditor({ client, onClose }: { client: SimClient; onClose: () => void }): JSX.Element {
  const [invites, setInvites] = useState<DevCampInvitesView | null>(null)
  const [search, setSearch] = useState('')

  async function load(): Promise<void> {
    const r = await client.getDevCampInvites()
    if (r.type === 'devCampInvites') setInvites(r.invites)
  }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function toggle(playerId: string): Promise<void> {
    const r = await client.toggleDevCampInvite(playerId)
    if (r.type === 'devCampInviteResult') {
      setInvites(r.invites)
      if (!r.ok && r.message) toast(r.message, 'error')
    } else if (r.type === 'error') toast(r.message, 'error')
  }

  const panel: React.CSSProperties = {
    background: 'rgba(8,10,15,0.9)', backdropFilter: 'blur(6px)',
    border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, padding: 12,
  }
  const listBox: React.CSSProperties = { maxHeight: '40vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }
  const avail = (invites?.available ?? []).filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{ maxWidth: 880, marginBottom: 'var(--sp-4)' }}>
      <div className="row-between" style={{ marginBottom: 8, alignItems: 'center' }}>
        <span style={{ fontWeight: 700 }}>Camp invites — the staff picked {invites?.invited.length ?? 0}; add or cut as you like</span>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>Done</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Invited */}
        <div style={panel}>
          <div className="muted small" style={{ marginBottom: 6 }}>Invited ({invites?.invited.length ?? 0})</div>
          <div style={listBox}>
            {(invites?.invited ?? []).map((p) => (
              <div key={p.playerId} className="row" style={{ gap: 8, alignItems: 'center' }}>
                <PlayerFace faceId={p.faceId} name={p.name} size={22} />
                <span style={{ flex: 1, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <PlayerLink playerId={p.playerId} name={p.name} /> <span className="muted" style={{ fontSize: 10 }}>{p.position}·{p.age}</span>
                  {!p.org && <span className="chip" style={{ fontSize: 8, marginLeft: 4 }}>TRYOUT</span>}
                </span>
                <button className="btn btn-sm" title="Cut from camp" onClick={() => void toggle(p.playerId)}>✕</button>
              </div>
            ))}
          </div>
        </div>
        {/* Available */}
        <div style={panel}>
          <div className="row-between" style={{ marginBottom: 6, alignItems: 'center' }}>
            <span className="muted small">Available prospects &amp; tryouts</span>
            <input className="input" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)}
              style={{ width: 130, padding: '3px 8px', fontSize: 11 }} />
          </div>
          <div style={listBox}>
            {avail.map((p) => (
              <div key={p.playerId} className="row" style={{ gap: 8, alignItems: 'center' }}>
                <PlayerFace faceId={p.faceId} name={p.name} size={22} />
                <span style={{ flex: 1, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <PlayerLink playerId={p.playerId} name={p.name} /> <span className="muted" style={{ fontSize: 10 }}>{p.position}·{p.age}</span>
                  {!p.org && <span className="chip" style={{ fontSize: 8, marginLeft: 4 }}>TRYOUT</span>}
                </span>
                <button className="btn btn-sm btn-primary" title="Invite to camp" onClick={() => void toggle(p.playerId)}>+</button>
              </div>
            ))}
            {avail.length === 0 && <span className="muted small">No more eligible young players to invite.</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
