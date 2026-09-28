/**
 * Development camp 2.0 — three days that matter. Day 1 testing ranks every
 * prospect on real ability; day 2's scrimmages are played by the match engine;
 * day 3 the staff argue each kid's week and the GM makes the calls: sign an
 * entry-level deal or keep his rights, send him back to junior/Europe or
 * assign him to the AHL, sign or release a tryout — and up to three summer
 * development programmes. Continue walks the week; delegating hands every
 * call to the staff.
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
import { Icon } from '../components/primitives'
import { Icons } from '../components/icons'
import { CHOICE_LABEL } from '../../engine/career/devCamp'

type DevCampView = Extract<WorkerResponse, { type: 'devCamp' }>['devCamp']

const GRADE_COLOR: Record<string, string> = {
  A: 'var(--green, #2ea043)',
  B: 'var(--amber, #d6a056)',
  C: 'var(--red, #e05555)',
}

const CARD: React.CSSProperties = {
  background: 'rgba(8,10,15,0.86)', backdropFilter: 'blur(6px)',
  border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8,
}
const ACCENT = 'rgb(var(--accent-rgb, 108,92,231))'
const FOCI: Array<[string, string]> = [
  ['offense', 'Offence'], ['defense', 'Defensive game'], ['skating', 'Skating'], ['physical', 'Strength'], ['goaltending', 'Goaltending'],
]
const READINESS: Record<string, { label: string; color: string }> = {
  nhl: { label: 'Pushing for the NHL', color: 'var(--green, #2ea043)' },
  ahl: { label: 'Ready for the AHL', color: 'var(--amber, #d6a056)' },
  junior: { label: 'Another year in junior', color: 'var(--muted)' },
}
type Camper = NonNullable<DevCampView>['invitees'][number]
type Filter = 'calls' | 'all' | 'picks'

export function DevCampScreen(): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const actions = useShellActions()
  const [editingInvites, setEditingInvites] = useState(false)
  const [filter, setFilter] = useState<Filter>('calls')
  const { data: fetched, loading } = useScreenData<DevCampView>(
    () => client.getDevCamp(),
    (r) => (r.type === 'devCamp' ? r.devCamp : null)
  )
  const [camp, setCamp] = useState<DevCampView>(null)
  useEffect(() => { setCamp(fetched ?? null) }, [fetched])

  // Once camp has wrapped, don't strand the GM on an empty scene.
  useEffect(() => {
    if (!loading && !fetched) nav.navigate('dashboard')
  }, [loading, fetched, nav])

  async function choose(playerId: string, choice: string | null): Promise<void> {
    const r = await client.setDevCampChoice(playerId, choice)
    if (r.type === 'devCamp') setCamp(r.devCamp)
    else if (r.type === 'error') toast(r.message, 'error')
  }
  async function program(playerId: string, focus: string | null): Promise<void> {
    const r = await client.setDevCampFocus(playerId, focus)
    if (r.type === 'devCamp') setCamp(r.devCamp)
    else if (r.type === 'error') toast(r.message, 'error')
  }

  if (loading && !camp) return <Notice kind="info">The kids are lacing up…</Notice>
  if (!camp) return <section className="stack"><Notice kind="info">Development camp has wrapped for the summer.</Notice></section>

  const day = camp.day
  const calls = camp.invitees.filter((p) => (p.options ?? []).length > 0)
  const byShowing = [...camp.invitees].sort((a, b) => (b.showing ?? 0) - (a.showing ?? 0) || a.name.localeCompare(b.name))
  const shown = filter === 'calls'
    ? byShowing.filter((p) => (p.options ?? []).length > 0 || p.focus)
    : filter === 'picks' ? byShowing.filter((p) => p.drafted) : byShowing
  const programs = camp.invitees.filter((p) => p.focus).length
  const BEATS = ['Arrival & testing', 'Scrimmages', 'Reads & calls']
  const nextLabel = day === 1 ? 'Play the scrimmages' : day === 2 ? 'Hear the reads and make the calls' : 'Close camp with these calls'
  const callCount = calls.length + camp.invitees.filter((p) => p.focus && (p.options ?? []).length === 0).length
  const FILTERS: Array<[Filter, string]> = [
    ['calls', `Calls & programmes (${callCount})`],
    ['picks', `Your picks (${camp.invitees.filter((p) => p.drafted).length})`],
    ['all', `Everyone (${camp.invitees.length})`],
  ]

  return (
    <section style={{ height: '100%' }}>
      <Backdrop scene="dev-camp-rink">
        <div className="row-between" style={{ alignItems: 'flex-start', marginBottom: 'var(--sp-3)', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--muted)' }}>Development camp · {camp.invitees.length} prospects</div>
            <h2 style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 800 }}>
              {day === 1 ? 'Testing day — the numbers are in' : day === 2 ? 'The scrimmages are in' : 'The reads are final — the calls are yours'}
            </h2>
          </div>
          <div className="row" style={{ gap: 'var(--sp-4)' }}>
            {camp.cast.map((c) => (
              <div key={c.name} style={{ textAlign: 'center' }}>
                <PlayerFace faceId={c.faceId} name={c.name} size={40} />
                <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2 }}>{c.name}</div>
                <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase' }}>{c.title}</div>
              </div>
            ))}
          </div>
        </div>

        {/* the week, and the one way on */}
        <div style={{ ...CARD, padding: '10px 14px', marginBottom: 'var(--sp-3)' }}>
          <div className="row" style={{ gap: 0, alignItems: 'stretch', flexWrap: 'wrap' }}>
            {BEATS.map((label, i) => {
              const done = i + 1 < day
              const cur = i + 1 === day
              return (
                <div key={label} style={{ flex: '1 1 160px', minWidth: 0, paddingRight: 10 }}>
                  <div style={{ height: 4, borderRadius: 2, background: done || cur ? ACCENT : 'rgba(255,255,255,0.14)', marginBottom: 6 }} />
                  <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                    {done && <Icon size={14} color="var(--green, #2ea043)"><Icons.Check /></Icon>}
                    <span style={{ fontSize: 12, fontWeight: cur ? 800 : 600, color: cur ? 'var(--text)' : 'var(--muted)' }}>{label}</span>
                  </div>
                  {i === 1 && (camp.results ?? []).map((r, k) => <div key={k} className="small">{r}</div>)}
                </div>
              )
            })}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center', alignItems: 'flex-end', minWidth: 230 }}>
              <button className="btn btn-primary" disabled={actions.busy || (day === 1 && editingInvites)} onClick={actions.continueGame}>{nextLabel}</button>
              <button
                className="btn btn-ghost btn-sm"
                title="The staff play the rest of camp and make every call on their own recommendation"
                onClick={() => void (async () => { await client.skipDevCamp(); nav.navigate('dashboard') })()}
              >
                Let the staff run camp
              </button>
            </div>
          </div>
          <div className="small muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
            {day === 1 && <>Every prospect ran the same drills today, ranked against the camp on his real ability. Tomorrow they scrimmage — every kid dresses.</>}
            {day === 2 && <>The scrimmages were played by the match engine. Tomorrow the staff argue each kid&apos;s week and recommend a call.</>}
            {day === 3 && <>Each call defaults to the staff&apos;s recommendation — change any you disagree with. {calls.length} call{calls.length === 1 ? '' : 's'} to make · {programs} of {camp.focusSlots ?? 3} summer programmes set. Continue closes camp and the calls land.</>}
          </div>
        </div>

        {day === 1 && editingInvites && <DevCampInviteEditor client={client} onClose={() => setEditingInvites(false)} />}

        {!(day === 1 && editingInvites) && (
          <>
            <div className="row" style={{ gap: 6, marginBottom: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center' }}>
              {FILTERS.map(([id, label]) => (
                <button key={id} className={`chip${filter === id ? ' chip-accent' : ''}`} style={{ cursor: 'pointer', border: 'none', fontSize: 12, padding: '5px 12px' }} onClick={() => setFilter(id)}>{label}</button>
              ))}
              <span style={{ flex: 1 }} />
              {day === 1 && (
                <button className="btn btn-ghost btn-sm" onClick={() => setEditingInvites(true)}>Manage invites</button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 'var(--sp-3)' }}>
              {shown.map((p) => (
                <CamperCard key={p.playerId} p={p} day={day} standout={camp.coachStandout?.playerId === p.playerId}
                  slotsLeft={(camp.focusSlots ?? 3) - programs}
                  onChoose={(c) => void choose(p.playerId, c)} onFocus={(f) => void program(p.playerId, f)} />
              ))}
              {shown.length === 0 && (
                <div style={{ ...CARD, padding: '12px 14px', fontSize: 13 }} className="muted">
                  {filter === 'calls'
                    ? 'No contract calls yet — they come on the last day, with the staff’s reads. Summer programmes can be set from “Everyone”.'
                    : 'Nobody here.'}
                </div>
              )}
            </div>
          </>
        )}
      </Backdrop>
    </section>
  )
}

function CamperCard(props: { p: Camper; day: number; standout: boolean; slotsLeft: number; onChoose: (c: string | null) => void; onFocus: (f: string | null) => void }): JSX.Element {
  const { p, day } = props
  const rd = p.readiness ? READINESS[p.readiness] : undefined
  const showing = p.showing ?? 0
  const pct = Math.max(0, Math.min(100, ((showing + 5) / 10) * 100))
  return (
    <div style={{ ...CARD, padding: '10px 12px', borderColor: props.standout ? ACCENT : (CARD.border as string) }}>
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <PlayerFace faceId={p.faceId} name={p.name} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <PlayerLink playerId={p.playerId} name={p.name} />
            <span className="muted small">{p.position} · {p.age}</span>
            {p.drafted && <span className="chip chip-accent" style={{ fontSize: 9 }}>This year&apos;s pick</span>}
            {p.status === 'amateur' && <span className="chip" style={{ fontSize: 9 }}>{p.club ?? 'Rights held'}</span>}
            {p.status === 'tryout' && <span className="chip chip-violet" style={{ fontSize: 9 }}>Tryout</span>}
            {p.status === 'signed' && <span className="chip" style={{ fontSize: 9 }}>Signed</span>}
            {props.standout && <span className="chip chip-success" style={{ fontSize: 9 }}>Camp standout</span>}
          </div>
          {/* the week's showing: testing + the scrimmages */}
          <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 5 }}>
            <span style={{ fontWeight: 800, fontSize: 15, color: GRADE_COLOR[p.grade], width: 14 }}>{p.grade}</span>
            <div style={{ flex: 1, position: 'relative', height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3 }} title={`Showing ${showing > 0 ? '+' : ''}${showing.toFixed(1)}`}>
              <div style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: 'rgba(255,255,255,0.35)' }} />
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${Math.min(50, pct)}%`, width: `${Math.abs(pct - 50)}%`, background: showing >= 0 ? 'var(--green, #2ea043)' : 'var(--red, #e05555)', borderRadius: 3 }} />
            </div>
            {rd && <span className="small" style={{ color: rd.color, whiteSpace: 'nowrap' }}>{rd.label}</span>}
          </div>
          {/* the evidence */}
          <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
            {(p.drills ?? []).map((d) => (
              <span
                key={d.drill}
                className="chip"
                style={{ fontSize: 9, color: d.rank <= Math.ceil(d.of * 0.15) ? 'var(--green, #2ea043)' : d.rank > Math.floor(d.of * 0.85) ? 'var(--red, #e05555)' : undefined }}
                title={`${d.drill}: ${d.rank} of ${d.of}`}
              >
                {d.drill} {d.rank}/{d.of}
              </span>
            ))}
            {p.scrim && (
              <span className="chip" style={{ fontSize: 9 }}>
                {p.position === 'G'
                  ? `${(p.scrim.sa ?? 0) - (p.scrim.ga ?? 0)}/${p.scrim.sa ?? 0} saves`
                  : `${p.scrim.g}G ${p.scrim.a}A ${p.scrim.pm > 0 ? '+' : ''}${p.scrim.pm} · ${p.scrim.gp} GP`}
              </span>
            )}
          </div>
          {day >= 3 && p.staffRead && (
            <div className="row small" style={{ gap: 6, marginTop: 6, lineHeight: 1.45, alignItems: 'flex-start' }}>
              <Icon size={14} color="var(--muted)"><Icons.Interview /></Icon>
              <span style={{ fontStyle: 'italic' }}>{p.staffRead}</span>
            </div>
          )}
          {day < 3 && p.evidence && <div className="small muted" style={{ marginTop: 6 }}>He {p.evidence}.</div>}
        </div>
      </div>

      {/* the calls (wrap day) */}
      {day >= 3 && (p.options ?? []).length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {(p.options ?? []).map((o) => (
              <button key={o} className={`btn btn-sm${p.choice === o ? ' btn-primary' : ''}`} style={{ fontSize: 11 }} onClick={() => props.onChoose(o)}>
                {CHOICE_LABEL[o]}{p.recommended === o ? ' · staff' : ''}
              </button>
            ))}
          </div>
          {p.blocked && <div className="small muted" style={{ marginTop: 4 }}>{p.blocked}</div>}
        </div>
      )}
      {/* the summer programme */}
      {day >= 3 && (
        <div className="row small" style={{ gap: 6, marginTop: 8, alignItems: 'center' }}>
          <span className="muted">Summer programme:</span>
          <select
            className="input"
            value={p.focus ?? ''}
            onChange={(e) => props.onFocus(e.target.value || null)}
            style={{ padding: '2px 6px', fontSize: 11 }}
            disabled={!p.focus && props.slotsLeft <= 0}
            title={!p.focus && props.slotsLeft <= 0 ? 'Three programmes at most — clear one first' : 'Feeds his development all summer'}
          >
            <option value="">None</option>
            {FOCI.filter(([f]) => (p.position === 'G') === (f === 'goaltending')).map(([f, label]) => (
              <option key={f} value={f}>{label}{p.focusSuggested === f ? ' (staff)' : ''}</option>
            ))}
          </select>
        </div>
      )}
    </div>
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
                <button className="btn btn-sm" title="Cut from camp" onClick={() => void toggle(p.playerId)}>Cut</button>
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

