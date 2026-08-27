/**
 * Training camp (Offseason 2.0) — the EHM-style camp week rendered as one
 * screen with tabs: Overview (the Blue/Red camp roster + dates), Camp Schedule
 * (day beats), Scrimmage Stats (the accumulating box score), Coach Reports
 * (the staff's per-player verdicts), and Cut Day (the roster calls are yours).
 * Sending a waiver-required veteran down runs REAL waivers.
 *
 * Artwork slot: assets/scenes/camp-rink.png (CSS fallback otherwise).
 */
import { useEffect, useState } from 'react'
import type { WorkerResponse } from '../../worker/protocol'
import { Backdrop } from './BoardMeetingScreen'
import { useShellActions } from '../components/ActionsContext'
import { PlayerFace } from '../components/PlayerFace'
import { PlayerLink, useNav } from '../components/NavContext'
import { Icon } from '../components/primitives'
import { Icons } from '../components/icons'
import { Notice } from '../components/ui'
import { toast } from '../components/store'
import { useClient, useScreenData } from '../hooks/useSim'
import { SortHeaders, sortColumns, useTableSort } from '../components/sortable'
import type { CampGoalieLine, CampSkaterLine, TrainingCampView as CampView } from '../../engine/career/views'

const CAMP_SKATER_COLS = sortColumns<CampSkaterLine>()([
  { key: 'name', label: 'Player', value: (s) => s.name },
  { key: 'position', label: 'Pos', value: (s) => s.position },
  { key: 'team', label: 'Team', value: (s) => s.team },
  { key: 'gp', label: 'GP', value: (s) => s.gp, align: 'right' },
  { key: 'g', label: 'G', value: (s) => s.g, align: 'right' },
  { key: 'a', label: 'A', value: (s) => s.a, align: 'right' },
  { key: 'p', label: 'P', value: (s) => s.p, align: 'right' },
  { key: 'plusMinus', label: '+/–', value: (s) => s.plusMinus, align: 'right' },
  { key: 'pim', label: 'PIM', value: (s) => s.pim, align: 'right' },
  { key: 'sog', label: 'SOG', value: (s) => s.sog, align: 'right' },
  { key: 'rating', label: 'Av R', value: (s) => s.rating, align: 'right', title: "The coach's average rating out of 10" },
])

const CAMP_GOALIE_COLS = sortColumns<CampGoalieLine>()([
  { key: 'name', label: 'Goalie', value: (g) => g.name },
  { key: 'team', label: 'Team', value: (g) => g.team },
  { key: 'mins', label: 'Mins', value: (g) => g.mins, align: 'right' },
  { key: 'ga', label: 'GA', value: (g) => g.ga, align: 'right', initialDir: 'asc' },
  { key: 'saves', label: 'SV', value: (g) => g.saves, align: 'right' },
  { key: 'gaa', label: 'GAA', value: (g) => g.gaa, align: 'right', initialDir: 'asc' },
  { key: 'svPct', label: 'SV%', value: (g) => g.svPct, align: 'right' },
  { key: 'rating', label: 'Av R', value: (g) => g.rating, align: 'right' },
])

type CampDecision = CampView['decisions'][number]

const CAMP_DECISION_COLS = sortColumns<CampDecision>()([
  { key: 'face', label: '' },
  { key: 'name', label: 'Player', value: (d) => d.name },
  { key: 'age', label: 'Age', value: (d) => d.age, align: 'right', initialDir: 'asc' },
  { key: 'plan', label: "The coach's verdict", value: (d) => (d.coachPlan === 'nhl' ? 1 : 0), title: 'Up first, then the men he is sending down' },
  { key: 'call', label: 'Your call' },
])

/** Stable identities so the sort hooks are not handed new arrays each render. */
const NO_SKATERS: CampSkaterLine[] = []
const NO_GOALIES: CampGoalieLine[] = []

type TrainingCampView = Extract<WorkerResponse, { type: 'trainingCamp' }>['camp']
type Tab = 'overview' | 'schedule' | 'scrimmage' | 'reports' | 'cuts'

const CARD: React.CSSProperties = {
  background: 'rgba(8,10,15,0.85)', backdropFilter: 'blur(6px)',
  border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8,
}

const REC_META: Record<string, { label: string; color: string }> = {
  keep: { label: 'Make the roster', color: 'var(--success, #4caf7d)' },
  sign: { label: 'Sign him', color: 'var(--success, #4caf7d)' },
  develop: { label: 'Send to develop', color: 'var(--amber, #d6a056)' },
  watch: { label: 'On the bubble', color: 'var(--muted)' },
}

export function TrainingCampScreen(): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const actions = useShellActions()
  const [tab, setTab] = useState<Tab>('overview')
  const [placements, setPlacements] = useState<Record<string, 'nhl' | 'ahl'>>({})
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState<string[] | null>(null)
  const { data: camp, loading } = useScreenData<TrainingCampView>(
    () => client.getTrainingCamp(),
    (r) => (r.type === 'trainingCamp' ? r.camp : null)
  )
  const skaterSort = useTableSort(camp?.scrimmage?.skaters ?? NO_SKATERS, CAMP_SKATER_COLS, { key: null })
  const goalieSort = useTableSort(camp?.scrimmage?.goalies ?? NO_GOALIES, CAMP_GOALIE_COLS, { key: null })

  useEffect(() => {
    if (!camp) return
    const init: Record<string, 'nhl' | 'ahl'> = {}
    for (const d of camp.decisions) init[d.playerId] = d.coachPlan
    setPlacements(init)
  }, [camp])

  // Camp's broken and there's no cut-day report to show — don't strand the GM
  // on an empty scene; the season has started, so return to the dashboard.
  useEffect(() => {
    if (!loading && !camp && !notes) nav.navigate('dashboard')
  }, [loading, camp, notes, nav])

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
    return (
      <section style={{ height: '100%' }}>
        <Backdrop scene="camp-rink">
          <h2 style={{ margin: '0 0 var(--sp-3)', fontSize: 22, fontWeight: 800 }}>Camp breaks</h2>
          <div className="stack" style={{ gap: 6, maxWidth: 720, marginBottom: 'var(--sp-4)' }}>
            {notes.map((n, i) => (
              <div key={i} style={{ ...CARD, border: n.includes('claimed') ? '1px solid var(--red, #e05555)' : CARD.border, padding: '8px 12px', fontSize: 13 }}>{n}</div>
            ))}
          </div>
          <button className="btn btn-primary" onClick={() => nav.navigate('dashboard')}>To opening night →</button>
        </Backdrop>
      </section>
    )
  }

  if (!camp) {
    return <section className="stack"><Notice kind="info">Camp has broken — the roster is set for opening night.</Notice></section>
  }

  const blue = (camp.roster ?? []).filter((r) => r.team === 'Blue')
  const red = (camp.roster ?? []).filter((r) => r.team === 'Red')
  const campDay = camp.campDay ?? 8
  const CUT_DAY = 8
  const atCutDay = campDay >= CUT_DAY
  const todaysBeat = camp.schedule?.[campDay - 1]
  const fmtDate = (iso?: string): string => {
    if (!iso) return ''
    const d = new Date(iso + 'T00:00:00Z')
    return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]} ${d.getUTCDate()}`
  }

  const TABS: Array<[Tab, string]> = [
    ['overview', 'Overview'],
    ['schedule', 'Camp Schedule'],
    ['scrimmage', 'Scrimmage Stats'],
    ['reports', 'Coach Reports'],
    ['cuts', 'Cut Day'],
  ]

  return (
    <section style={{ height: '100%' }}>
      <Backdrop scene="camp-rink">
        <div className="row-between" style={{ alignItems: 'flex-start', marginBottom: 'var(--sp-3)' }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--muted)' }}>
              Training camp{camp.startISO ? ` · ${fmtDate(camp.startISO)} – ${fmtDate(camp.endISO)}` : ''}
            </div>
            <h2 style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 800 }}>Camp is on the ice</h2>
          </div>
          <div className="row" style={{ gap: 'var(--sp-4)' }}>
            {camp.cast.map((c) => (
              <div key={c.name} style={{ textAlign: 'center' }}>
                <PlayerFace faceId={c.faceId} name={c.name} size={44} />
                <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2 }}>{c.name}</div>
                <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase' }}>{c.title}</div>
              </div>
            ))}
          </div>
        </div>

        {/* day cadence strip: where we are in the week + advance */}
        <div style={{ ...CARD, padding: '9px 14px', marginBottom: 'var(--sp-3)' }}>
          <div className="row-between" style={{ alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--muted)' }}>
                Day {Math.min(campDay, CUT_DAY)} of {CUT_DAY}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{todaysBeat?.activity ?? 'Final Cuts'}</div>
            </div>
            {/* 8-pip progress */}
            <div className="row" style={{ gap: 4 }}>
              {Array.from({ length: CUT_DAY }, (_, i) => (
                <span
                  key={i}
                  title={camp.schedule?.[i]?.activity}
                  style={{
                    width: 22, height: 5, borderRadius: 3,
                    background: i < campDay ? 'rgb(var(--accent-rgb, 108,92,231))' : 'rgba(255,255,255,0.15)',
                  }}
                />
              ))}
            </div>
            {atCutDay ? (
              <button className="btn btn-primary" onClick={() => setTab('cuts')}>It&apos;s cut day — set the roster →</button>
            ) : (
              <button className="btn btn-primary" disabled={actions.busy} onClick={actions.continueGame}>
                Advance to Day {campDay + 1} →
              </button>
            )}
          </div>
        </div>

        {/* tab bar */}
        <div className="row" style={{ gap: 6, marginBottom: 'var(--sp-3)', flexWrap: 'wrap' }}>
          {TABS.map(([id, label]) => {
            const locked = id === 'cuts' && !atCutDay
            return (
              <button
                key={id}
                className={`chip${tab === id ? ' chip-accent' : ''}`}
                style={{ cursor: 'pointer', border: 'none', fontSize: 12, padding: '5px 12px', opacity: locked ? 0.5 : 1 }}
                onClick={() => setTab(id)}
              >
                {locked && <Icon size={14}><Icons.Lock /></Icon>} {label}{id === 'cuts' && camp.decisions.length > 0 ? ` (${camp.decisions.length})` : ''}
              </button>
            )
          })}
        </div>

        <div style={{ maxWidth: 1000 }}>
          {tab === 'overview' && (
            <div className="stack" style={{ gap: 'var(--sp-3)' }}>
              <div style={{ ...CARD, padding: '10px 14px', fontSize: 13, lineHeight: 1.5 }}>
                Camp is underway. The roster is split into two intra-squad teams — <b style={{ color: '#5b8dff' }}>Blue</b> and{' '}
                <b style={{ color: '#e05555' }}>Red</b> — competing across the week. Watch the scrimmage stats and the coaches&apos;
                reports, then make your calls on <b>Cut Day</b>.
              </div>
              <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
                {([['Blue', blue, '#5b8dff'], ['Red', red, '#e05555']] as const).map(([name, list, color]) => (
                  <div key={name} style={{ ...CARD, flex: 1, minWidth: 0, padding: '8px 12px' }}>
                    <div style={{ fontWeight: 800, color, marginBottom: 6 }}>Team {name} <span className="muted small" style={{ fontWeight: 400 }}>· {list.length}</span></div>
                    <div className="stack" style={{ gap: 2 }}>
                      {list.map((r) => (
                        <div key={r.playerId} className="row-between small" style={{ padding: '2px 0' }}>
                          <span className="row" style={{ gap: 6, alignItems: 'center', minWidth: 0 }}>
                            <PlayerFace faceId={r.faceId} name={r.name} size={20} />
                            <PlayerLink playerId={r.playerId} name={r.name} />
                            <span className="muted" style={{ fontSize: 10 }}>{r.position} · {r.age}</span>
                          </span>
                          {r.status !== 'On Roster' && <span className="chip" style={{ fontSize: 9 }}>{r.status}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'schedule' && (
            <div style={{ ...CARD }}>
              <table className="table">
                <thead><tr><th>Day</th><th>Activity</th><th>Information</th></tr></thead>
                <tbody>
                  {(camp.schedule ?? []).map((s, i) => {
                    const dayNo = i + 1
                    const isToday = dayNo === Math.min(campDay, CUT_DAY)
                    const done = dayNo < campDay
                    return (
                      <tr key={i} style={isToday ? { background: 'rgba(var(--accent-rgb, 108,92,231), 0.12)' } : done ? undefined : { opacity: 0.5 }}>
                        <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                          {isToday ? '▶ ' : done ? '✓ ' : ''}{s.label}
                        </td>
                        <td style={{ fontWeight: 600 }}>{s.activity}</td>
                        <td className="muted small">{done || isToday ? (s.info ?? '—') : 'Upcoming'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'scrimmage' && camp.scrimmage && camp.scrimmage.results.length === 0 && (
            <div style={{ ...CARD, padding: '14px 16px', fontSize: 13, lineHeight: 1.5 }}>
              No scrimmages have been played yet — the first intra-squad game is on <b>Day 2</b>. The box score
              accumulates here as the week goes on.
            </div>
          )}
          {tab === 'scrimmage' && camp.scrimmage && camp.scrimmage.results.length > 0 && (
            <div className="stack" style={{ gap: 'var(--sp-3)' }}>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {camp.scrimmage.results.map((r, i) => (
                  <span key={i} className="chip" style={{ fontSize: 11 }}>Scrimmage {i + 1}: {r}</span>
                ))}
              </div>
              <div style={{ ...CARD }}>
                <table className="table">
                  <thead>
                    <tr>
                      <SortHeaders columns={CAMP_SKATER_COLS} sortKey={skaterSort.sortKey} dir={skaterSort.dir} onSort={skaterSort.sortBy} />
                    </tr>
                  </thead>
                  <tbody>
                    {skaterSort.sorted.map((s) => (
                      <tr key={s.playerId}>
                        <td><span className="row" style={{ gap: 6, alignItems: 'center' }}><PlayerFace faceId={s.faceId} name={s.name} size={20} /><PlayerLink playerId={s.playerId} name={s.name} /></span></td>
                        <td className="muted small">{s.position}</td>
                        <td className="small" style={{ color: s.team === 'Blue' ? '#5b8dff' : '#e05555' }}>{s.team}</td>
                        <td className="num">{s.gp}</td><td className="num">{s.g}</td><td className="num">{s.a}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{s.p}</td>
                        <td className="num">{s.plusMinus > 0 ? `+${s.plusMinus}` : s.plusMinus}</td>
                        <td className="num">{s.pim}</td><td className="num">{s.sog}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{s.rating.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {camp.scrimmage.goalies.length > 0 && (
                <div style={{ ...CARD }}>
                  <table className="table">
                    <thead><tr><SortHeaders columns={CAMP_GOALIE_COLS} sortKey={goalieSort.sortKey} dir={goalieSort.dir} onSort={goalieSort.sortBy} /></tr></thead>
                    <tbody>
                      {goalieSort.sorted.map((g) => (
                        <tr key={g.playerId}>
                          <td><span className="row" style={{ gap: 6, alignItems: 'center' }}><PlayerFace faceId={g.faceId} name={g.name} size={20} /><PlayerLink playerId={g.playerId} name={g.name} /></span></td>
                          <td className="small" style={{ color: g.team === 'Blue' ? '#5b8dff' : '#e05555' }}>{g.team}</td>
                          <td className="num">{g.mins}</td><td className="num">{g.ga}</td><td className="num">{g.saves}</td>
                          <td className="num">{g.gaa.toFixed(2)}</td><td className="num">{g.svPct.toFixed(3)}</td>
                          <td className="num" style={{ fontWeight: 700 }}>{g.rating.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'reports' && (
            <div className="stack" style={{ gap: 'var(--sp-2)' }}>
              {(camp.reports ?? []).length === 0 && (
                <div style={{ ...CARD, padding: '14px 16px', fontSize: 13, lineHeight: 1.5 }}>
                  The coaches file their per-player reports at the <b>end of camp</b> (Day 7), once they&apos;ve seen the
                  scrimmages and the week of practice. Nothing filed yet — keep advancing.
                </div>
              )}
              {(camp.reports ?? []).map((r) => {
                const m = REC_META[r.recommendation] ?? REC_META.watch
                return (
                  <div key={r.playerId} style={{ ...CARD, padding: '10px 14px' }}>
                    <div className="row-between" style={{ marginBottom: 4 }}>
                      <span className="row" style={{ gap: 8, alignItems: 'center' }}>
                        <PlayerFace faceId={r.faceId} name={r.name} size={30} />
                        <PlayerLink playerId={r.playerId} name={r.name} />
                        <span className="muted small">{r.position}</span>
                        {r.tryout && <span className="chip" style={{ fontSize: 9 }}>PTO</span>}
                      </span>
                      <span className="chip" style={{ fontSize: 10, color: m.color, borderColor: m.color }}>{m.label}</span>
                    </div>
                    <div className="small" style={{ lineHeight: 1.5 }}>{r.verdict}</div>
                  </div>
                )
              })}
            </div>
          )}

          {tab === 'cuts' && (
            atCutDay ? (
              <CutDay camp={camp} placements={placements} setPlacements={setPlacements} busy={busy} onBreak={() => void breakCamp()} onLater={() => nav.navigate('dashboard')} />
            ) : (
              <div style={{ ...CARD, padding: '14px 16px', fontSize: 13, lineHeight: 1.5 }}>
                <b>Cut day isn&apos;t here yet.</b> The coaches are still running the week and filing their reads —
                you make the roster calls on <b>Day {CUT_DAY}</b>. Keep advancing camp (Day {campDay} of {CUT_DAY} so far).
                <div style={{ marginTop: 10 }}>
                  <button className="btn btn-primary" disabled={actions.busy} onClick={actions.continueGame}>Advance to Day {campDay + 1} →</button>
                </div>
              </div>
            )
          )}
        </div>
      </Backdrop>
    </section>
  )
}

function CutDay({ camp, placements, setPlacements, busy, onBreak, onLater }: {
  camp: TrainingCampView
  placements: Record<string, 'nhl' | 'ahl'>
  setPlacements: React.Dispatch<React.SetStateAction<Record<string, 'nhl' | 'ahl'>>>
  busy: boolean
  onBreak: () => void
  onLater: () => void
}): JSX.Element {
  const nhlDelta = camp.decisions.reduce((n, d) => {
    const want = placements[d.playerId] ?? d.coachPlan
    return n + (want === 'nhl' && d.current === 'ahl' ? 1 : 0) - (want === 'ahl' && d.current === 'nhl' ? 1 : 0)
  }, 0)
  const decisionSort = useTableSort(camp.decisions, CAMP_DECISION_COLS, { key: null })

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      <div style={{ ...CARD, padding: '10px 14px', fontSize: 13, lineHeight: 1.5 }}>
        The battles have verdicts. Every row defaults to the coach&apos;s plan — overrule him where you disagree.{' '}
        <b style={{ display: 'inline-flex', alignItems: 'center', gap: 4, verticalAlign: 'text-bottom' }}><Icon size={14} color="var(--amber)"><Icons.Warning /></Icon> Waiver-required players sent down can be claimed by any club, for nothing.</b>{' '}
        <span className="muted">PTO invitees either earn a league-minimum deal or return to the open market.</span>
        {nhlDelta !== 0 && <span className="muted"> (Net NHL change: {nhlDelta > 0 ? `+${nhlDelta}` : nhlDelta})</span>}
      </div>
      <div style={{ ...CARD }}>
        <table className="table">
          <thead><tr><SortHeaders columns={CAMP_DECISION_COLS} sortKey={decisionSort.sortKey} dir={decisionSort.dir} onSort={decisionSort.sortBy} /></tr></thead>
          <tbody>
            {decisionSort.sorted.map((d) => {
              const want = placements[d.playerId] ?? d.coachPlan
              return (
                <tr key={d.playerId}>
                  <td><PlayerFace faceId={d.faceId} name={d.name} size={28} /></td>
                  <td>
                    <PlayerLink playerId={d.playerId} name={d.name} /> <span className="muted small">{d.position}</span>
                    {d.tryout && <span className="chip chip-violet" style={{ fontSize: 9, marginLeft: 6 }} title="Professional tryout — unsigned, must earn a contract">PTO</span>}
                    {d.waiverRequired && <span className="chip chip-danger" style={{ fontSize: 9, marginLeft: 6 }}>WV</span>}
                  </td>
                  <td className="num muted">{d.age}</td>
                  <td className="small" style={{ maxWidth: 360 }}>{d.coachPlan === 'nhl' ? '▲ ' : '▼ '}{d.line}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {d.tryout ? (
                        <>
                          <button className={`btn btn-sm${want === 'nhl' ? ' btn-primary' : ''}`} title="Sign him to a one-year, league-minimum deal" onClick={() => setPlacements((p) => ({ ...p, [d.playerId]: 'nhl' }))}>Sign</button>
                          <button className={`btn btn-sm${want === 'ahl' ? ' btn-primary' : ''}`} title="End the tryout — he returns to the open market" onClick={() => setPlacements((p) => ({ ...p, [d.playerId]: 'ahl' }))}>Release</button>
                        </>
                      ) : (
                        <>
                          <button className={`btn btn-sm${want === 'nhl' ? ' btn-primary' : ''}`} onClick={() => setPlacements((p) => ({ ...p, [d.playerId]: 'nhl' }))}>NHL</button>
                          <button className={`btn btn-sm${want === 'ahl' ? ' btn-primary' : ''}`} title={d.waiverRequired ? 'He must clear waivers — any club can claim him.' : undefined} onClick={() => setPlacements((p) => ({ ...p, [d.playerId]: 'ahl' }))}>{d.waiverRequired ? <>AHL <Icon size={14} color="var(--amber)"><Icons.Warning /></Icon></> : 'AHL'}</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ gap: 'var(--sp-3)' }}>
        <button className="btn btn-primary" disabled={busy} onClick={onBreak}>Break camp with this roster</button>
        <button className="btn btn-ghost" title="Sim on and the coach applies his plan as-is" onClick={onLater}>Decide later</button>
      </div>
    </div>
  )
}
