/**
 * Training camp — the BATTLES camp (depth audit 2026-09 §5).
 *
 * Camp is a handful of named, contested roster spots ("3 forwards for the last
 * 2 spots", "Backup goalie"), each decided by games the sim actually plays: two
 * Blue-Red scrimmages, then two preseason games against real clubs. Every
 * contender carries the coach's prior plus what camp showed; the bars move
 * after every beat and the verdicts quote the box score. Three presses: camp
 * opens, the Blue-Red games, the preseason (landing on cut day). On cut day the
 * GM makes the calls — who wins each battle — with the real waiver risk shown
 * for anyone sent down. "Let the coach run camp" delegates the lot.
 *
 * Artwork slot: assets/scenes/camp-rink.png (CSS fallback otherwise).
 */
import { useEffect, useMemo, useState } from 'react'
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
import type {
  CampBattle,
  CampBattleContender,
  CampGoalieLine,
  CampSkaterLine,
  TrainingCampView as CampView,
} from '../../engine/career/views'

const CAMP_SKATER_COLS = sortColumns<CampSkaterLine>()([
  { key: 'name', label: 'Player', value: (s) => s.name },
  { key: 'position', label: 'Pos', value: (s) => s.position },
  { key: 'team', label: 'Side', value: (s) => s.team },
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
  { key: 'team', label: 'Side', value: (g) => g.team },
  { key: 'mins', label: 'Mins', value: (g) => g.mins, align: 'right' },
  { key: 'ga', label: 'GA', value: (g) => g.ga, align: 'right', initialDir: 'asc' },
  { key: 'saves', label: 'SV', value: (g) => g.saves, align: 'right' },
  { key: 'gaa', label: 'GAA', value: (g) => g.gaa, align: 'right', initialDir: 'asc' },
  { key: 'svPct', label: 'SV%', value: (g) => g.svPct, align: 'right' },
  { key: 'rating', label: 'Av R', value: (g) => g.rating, align: 'right' },
])

const NO_SKATERS: CampSkaterLine[] = []
const NO_GOALIES: CampGoalieLine[] = []

type TrainingCampView = Extract<WorkerResponse, { type: 'trainingCamp' }>['camp']
type Tab = 'battles' | 'stats' | 'reports' | 'roster'
type Decision = CampView['decisions'][number]
type Place = 'nhl' | 'ahl'

const CARD: React.CSSProperties = {
  background: 'rgba(8,10,15,0.86)', backdropFilter: 'blur(6px)',
  border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8,
}
const ACCENT = 'rgb(var(--accent-rgb, 108,92,231))'
const GOOD = 'var(--success, #4caf7d)'
const BAD = 'var(--danger, #e0575b)'
const WARN = 'var(--amber, #d6a056)'

const REC_META: Record<string, { label: string; color: string }> = {
  keep: { label: 'Make the roster', color: GOOD },
  sign: { label: 'Sign him', color: GOOD },
  develop: { label: 'Send to develop', color: WARN },
  watch: { label: 'On the bubble', color: 'var(--muted)' },
}

const CUT_DAY = 8

/** The three beats of camp, plus cut day. */
const BEATS: Array<{ key: string; label: string; doneFrom: number }> = [
  { key: 'open', label: 'Camp opens', doneFrom: 2 },
  { key: 'scrim', label: 'Blue-Red games', doneFrom: 3 },
  { key: 'pre', label: 'Preseason', doneFrom: 8 },
  { key: 'cut', label: 'Cut day', doneFrom: 99 },
]

function beatIndex(day: number): number {
  return day >= CUT_DAY ? 3 : day >= 3 ? 2 : day >= 2 ? 1 : 0
}

export function TrainingCampScreen(): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const actions = useShellActions()
  const [tab, setTab] = useState<Tab>('battles')
  const [placements, setPlacements] = useState<Record<string, Place>>({})
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState<string[] | null>(null)
  const { data: fetched, loading, refetch } = useScreenData<TrainingCampView>(
    () => client.getTrainingCamp(),
    (r) => (r.type === 'trainingCamp' ? r.camp : null)
  )
  const [camp, setCamp] = useState<TrainingCampView>(null)
  useEffect(() => { setCamp(fetched ?? null) }, [fetched])
  const skaterSort = useTableSort(camp?.scrimmage?.skaters ?? NO_SKATERS, CAMP_SKATER_COLS, { key: null })
  const goalieSort = useTableSort(camp?.scrimmage?.goalies ?? NO_GOALIES, CAMP_GOALIE_COLS, { key: null })

  // Every call starts at the coach's plan; a fresh beat re-reads it.
  useEffect(() => {
    if (!camp) return
    const init: Record<string, Place> = {}
    for (const d of camp.decisions) init[d.playerId] = d.coachPlan
    setPlacements(init)
  }, [camp])

  // Camp has broken with no cut-day report to show: back to the dashboard.
  useEffect(() => {
    if (!loading && !camp && !fetched && !notes) nav.navigate('dashboard')
  }, [loading, camp, fetched, notes, nav])

  async function breakCamp(): Promise<void> {
    if (!camp || busy) return
    setBusy(true)
    const res = await client.submitTrainingCamp(Object.entries(placements).map(([playerId, place]) => ({ playerId, place })))
    setBusy(false)
    if (res.type === 'error') { toast(res.message ?? 'Could not break camp.', 'error'); return }
    if (res.type === 'trainingCamp' && res.notes) setNotes(res.notes)
  }

  async function delegate(): Promise<void> {
    if (!camp || busy) return
    setBusy(true)
    const res = await client.delegateTrainingCamp()
    setBusy(false)
    if (res.type === 'error') { toast(res.message ?? 'The coach could not take over.', 'error'); return }
    if (res.type === 'trainingCamp' && res.notes) setNotes(res.notes)
  }

  async function toggleLook(playerId: string): Promise<void> {
    if (!camp) return
    const cur = camp.look ?? []
    const next = cur.includes(playerId) ? cur.filter((x) => x !== playerId) : [...cur, playerId]
    if (next.length > 2) { toast('Two looks at most — the coach has a lineup to run.', 'error'); return }
    const res = await client.setCampLook(next)
    if (res.type === 'error') { toast(res.message ?? 'Could not set the look.', 'error'); return }
    if (res.type === 'trainingCamp') setCamp(res.camp)
  }

  async function advance(): Promise<void> {
    await actions.continueGame()
    refetch()
  }

  if (loading && !camp) return <Notice kind="info">The coach is finishing his notes…</Notice>

  if (notes) {
    return (
      <section style={{ height: '100%' }}>
        <Backdrop scene="camp-rink">
          <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--muted)' }}>Cut day</div>
          <h2 style={{ margin: '2px 0 var(--sp-3)', fontSize: 22, fontWeight: 800 }}>Camp breaks — this is your team</h2>
          <div className="stack" style={{ gap: 6, maxWidth: 760, marginBottom: 'var(--sp-4)' }}>
            {notes.map((n, i) => {
              const bad = /claimed|could not|stays with the farm|without a deal/.test(n)
              const good = /won “|makes the team|earns a contract/.test(n)
              return (
                <div key={i} className="row" style={{ ...CARD, padding: '8px 12px', fontSize: 13, gap: 8, alignItems: 'flex-start', borderColor: bad ? BAD : CARD.border as string }}>
                  <Icon size={16} color={bad ? BAD : good ? GOOD : 'var(--muted)'}>{bad ? <Icons.Warning /> : good ? <Icons.Check /> : <Icons.Dot />}</Icon>
                  <span>{n}</span>
                </div>
              )
            })}
          </div>
          <button className="btn btn-primary" onClick={() => nav.navigate('dashboard')}>To opening night</button>
        </Backdrop>
      </section>
    )
  }

  if (!camp) {
    return <section className="stack"><Notice kind="info">Camp has broken — the roster is set for opening night.</Notice></section>
  }

  const campDay = camp.campDay ?? CUT_DAY
  const atCutDay = campDay >= CUT_DAY
  const battles = camp.battles ?? []
  const others = camp.decisions.filter((d) => !d.battleId)
  const fmtDate = (iso?: string): string => {
    if (!iso) return ''
    const d = new Date(iso + 'T00:00:00Z')
    return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]} ${d.getUTCDate()}`
  }
  const bi = beatIndex(campDay)
  const title = atCutDay
    ? 'Cut day — the calls are yours'
    : bi === 2 ? 'The Blue-Red games are in' : 'The battles are named'
  const nextLabel = campDay < 3 ? 'Play the Blue-Red scrimmages' : 'Play the preseason games'

  return (
    <section style={{ height: '100%' }}>
      <Backdrop scene="camp-rink">
        <div className="row-between" style={{ alignItems: 'flex-start', marginBottom: 'var(--sp-3)', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--muted)' }}>
              Training camp{camp.startISO ? ` · ${fmtDate(camp.startISO)} – ${fmtDate(camp.endISO)}` : ''}
            </div>
            <h2 style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 800 }}>{title}</h2>
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

        {/* the camp's beats, with every game's real result */}
        <div style={{ ...CARD, padding: '10px 14px', marginBottom: 'var(--sp-3)' }}>
          <div className="row" style={{ gap: 0, alignItems: 'stretch' }}>
            {BEATS.map((b, i) => {
              const done = i < bi
              const cur = i === bi
              const games = (camp.games ?? []).filter((g) => (b.key === 'scrim' && g.kind === 'scrimmage') || (b.key === 'pre' && g.kind === 'preseason'))
              return (
                <div key={b.key} style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
                  <div style={{ height: 4, borderRadius: 2, background: done || cur ? ACCENT : 'rgba(255,255,255,0.14)', opacity: cur ? 1 : done ? 0.7 : 1, marginBottom: 6 }} />
                  <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                    {done && <Icon size={14} color={GOOD}><Icons.Check /></Icon>}
                    <span style={{ fontSize: 12, fontWeight: cur ? 800 : 600, color: cur ? 'var(--text)' : 'var(--muted)' }}>{b.label}</span>
                  </div>
                  {games.map((g) => (
                    <div key={g.label} className="small" style={{ marginTop: 2, color: 'var(--text)' }} title={g.label}>
                      <span className="muted">{g.kind === 'scrimmage' ? g.label.replace('The ', '') : g.label.replace('Preseason ', '')}:</span> {g.result}
                    </div>
                  ))}
                  {b.key === 'pre' && games.length === 0 && (camp.schedule ?? []).filter((s) => s.activity.startsWith('Preseason')).map((s) => (
                    <div key={s.label} className="small muted" style={{ marginTop: 2 }}>{s.activity.replace('Preseason: ', '')}</div>
                  ))}
                </div>
              )
            })}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center', alignItems: 'flex-end', minWidth: 210 }}>
              {atCutDay ? (
                <>
                  <button className="btn btn-primary" disabled={busy} onClick={() => void breakCamp()}>Break camp with these calls</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy} title="Break camp with the coach's calls as they stand" onClick={() => void delegate()}>Take the coach's calls</button>
                </>
              ) : (
                <>
                  <button className="btn btn-primary" disabled={actions.busy || busy} onClick={() => void advance()}>{nextLabel}</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy} title="The coach plays the remaining games and makes every call — waivers and all" onClick={() => void delegate()}>Let the coach run camp</button>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="row" style={{ gap: 6, marginBottom: 'var(--sp-3)', flexWrap: 'wrap' }}>
          {([['battles', `Battles (${battles.length})`], ['stats', 'Camp stats'], ['reports', 'Coach reports'], ['roster', 'Camp roster']] as Array<[Tab, string]>).map(([id, label]) => (
            <button key={id} className={`chip${tab === id ? ' chip-accent' : ''}`} style={{ cursor: 'pointer', border: 'none', fontSize: 12, padding: '5px 12px' }} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'battles' && (
          <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="stack" style={{ gap: 'var(--sp-3)', flex: '2 1 560px', minWidth: 0 }}>
              {battles.length === 0 && (
                <div style={{ ...CARD, padding: '14px 16px', fontSize: 13, lineHeight: 1.5 }}>
                  No contested spots this year — the depth chart is settled. Camp is about sharpness; the calls below are clear ones.
                </div>
              )}
              {battles.map((b) => (
                <BattleCard
                  key={b.id}
                  battle={b}
                  read={camp.reads?.[b.id]}
                  atCutDay={atCutDay}
                  placements={placements}
                  setPlace={(id, place) => setPlacements((p) => ({ ...p, [id]: place }))}
                  look={camp.look ?? []}
                  onLook={(id) => void toggleLook(id)}
                />
              ))}
            </div>
            <div className="stack" style={{ gap: 'var(--sp-3)', flex: '1 1 300px', minWidth: 0 }}>
              {atCutDay && <OpeningNight camp={camp} placements={placements} />}
              <OtherCalls decisions={others} atCutDay={atCutDay} placements={placements} setPlace={(id, place) => setPlacements((p) => ({ ...p, [id]: place }))} />
            </div>
          </div>
        )}

        {tab === 'stats' && (
          <CampStats camp={camp} skaterSort={skaterSort} goalieSort={goalieSort} />
        )}

        {tab === 'reports' && (
          <div className="stack" style={{ gap: 'var(--sp-2)', maxWidth: 980 }}>
            {(camp.reports ?? []).length === 0 && (
              <div style={{ ...CARD, padding: '14px 16px', fontSize: 13, lineHeight: 1.5 }}>
                The coaches file their reports after the preseason games, on cut day. Until then the battle cards carry their running read.
              </div>
            )}
            {(camp.reports ?? []).map((r) => {
              const m = REC_META[r.recommendation] ?? REC_META.watch!
              return (
                <div key={r.playerId} style={{ ...CARD, padding: '10px 14px' }}>
                  <div className="row-between" style={{ marginBottom: 4 }}>
                    <span className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <PlayerFace faceId={r.faceId} name={r.name} size={28} />
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

        {tab === 'roster' && <CampRoster camp={camp} />}
      </Backdrop>
    </section>
  )
}

/* ─────────────────────────── a battle ─────────────────────────── */

function BattleCard(props: {
  battle: CampBattle
  read: string | undefined
  atCutDay: boolean
  placements: Record<string, Place>
  setPlace: (id: string, place: Place) => void
  look: string[]
  onLook: (id: string) => void
}): JSX.Element {
  const { battle: b, atCutDay, placements } = props
  const played = b.contenders.some((c) => c.lines.length > 0)
  // One scale for the whole battle so the bars compare.
  const vals = b.contenders.flatMap((c) => [c.prior, c.score])
  const lo = Math.min(...vals) - 1.5
  const hi = Math.max(...vals) + 1.5
  const pct = (v: number): number => Math.max(0, Math.min(100, ((v - lo) / Math.max(0.1, hi - lo)) * 100))
  const winners = b.contenders.filter((c) => c.winning)
  const losers = b.contenders.filter((c) => !c.winning)
  const cutScore = winners.length > 0 && losers.length > 0 ? (winners[winners.length - 1]!.score + losers[0]!.score) / 2 : null
  const picked = b.contenders.filter((c) => (placements[c.playerId] ?? (c.winning ? 'nhl' : 'ahl')) === 'nhl').length
  const exposed = b.contenders.filter((c) => c.current === 'nhl' && c.waiverRequired && (placements[c.playerId] ?? (c.winning ? 'nhl' : 'ahl')) === 'ahl')

  return (
    <div style={{ ...CARD, padding: '12px 14px' }}>
      <div className="row-between" style={{ alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Icon size={18} color={ACCENT}><Icons.Rivalry /></Icon>
          <span style={{ fontSize: 15, fontWeight: 800 }}>{b.label}</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="chip" style={{ fontSize: 10 }}>{b.slots} spot{b.slots === 1 ? '' : 's'}</span>
          {b.waiverTrap && (
            <span className="chip chip-warn" style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 4 }} title="A waiver-bound incumbent against a waiver-exempt challenger: the kid can go down for free, the veteran cannot">
              <Icon size={14}><Icons.Waivers /></Icon> Waiver trap
            </span>
          )}
        </div>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        {b.contenders.map((c) => (
          <ContenderRow
            key={c.playerId}
            c={c}
            pct={pct}
            cutPct={cutScore !== null ? pct(cutScore) : null}
            played={played}
            atCutDay={atCutDay}
            place={placements[c.playerId] ?? (c.winning ? 'nhl' : 'ahl')}
            setPlace={(p) => props.setPlace(c.playerId, p)}
            looked={props.look.includes(c.playerId)}
            onLook={() => props.onLook(c.playerId)}
          />
        ))}
      </div>

      {props.read && (
        <div className="row small" style={{ gap: 8, marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)', lineHeight: 1.5, alignItems: 'flex-start' }}>
          <Icon size={16} color="var(--muted)"><Icons.Interview /></Icon>
          <span style={{ fontStyle: 'italic' }}>{props.read}</span>
        </div>
      )}
      {atCutDay && (
        <div className="small" style={{ marginTop: 8, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ color: picked === b.slots ? GOOD : WARN, fontWeight: 700 }}>
            {picked} of {b.slots} spot{b.slots === 1 ? '' : 's'} filled
          </span>
          {exposed.map((c) => (
            <span key={c.playerId} style={{ color: c.claimedBy ? BAD : 'var(--muted)' }}>
              {c.claimedBy ? `${c.name} to the AHL: ${c.claimedBy} would claim him on waivers` : `${c.name} to the AHL: he would clear waivers`}
            </span>
          ))}
        </div>
      )}
      {!atCutDay && (
        <div className="small muted" style={{ marginTop: 8 }}>
          {played ? 'The preseason games are next — every contender dresses.' : 'Give up to two men the look: top-six minutes (or the start in goal). More ice is more chance to shine, and to be exposed.'}
        </div>
      )}
    </div>
  )
}

function ContenderRow(props: {
  c: CampBattleContender
  pct: (v: number) => number
  cutPct: number | null
  played: boolean
  atCutDay: boolean
  place: Place
  setPlace: (p: Place) => void
  looked: boolean
  onLook: () => void
}): JSX.Element {
  const { c, pct, played, atCutDay, place } = props
  const inNow = atCutDay ? place === 'nhl' : c.winning
  const up = c.evidence > 0
  const a = pct(c.prior)
  const s = pct(c.score)
  return (
    <div className="row" style={{ gap: 10, alignItems: 'center', opacity: inNow ? 1 : 0.82 }}>
      <PlayerFace faceId={c.faceId} name={c.name} size={34} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <PlayerLink playerId={c.playerId} name={c.name} />
          <span className="muted small">{c.position} · {c.age}</span>
          <span className={`chip${c.tryout ? ' chip-violet' : c.current === 'nhl' ? '' : ' chip-accent'}`} style={{ fontSize: 9 }}>
            {c.tryout ? 'PTO' : c.current === 'nhl' ? 'NHL' : 'AHL'}
          </span>
          {c.current === 'nhl' && c.waiverRequired && (
            <span className={`chip ${c.claimedBy ? 'chip-danger' : ''}`} style={{ fontSize: 9 }} title={c.claimedBy ? `Needs waivers — ${c.claimedBy} is first in line to claim him (${c.claimants ?? 1} club${(c.claimants ?? 1) === 1 ? '' : 's'} would)` : 'Needs waivers — no club would claim him today'}>
              WV{c.claimedBy ? ` · ${c.claimedBy}` : ' · clears'}
            </span>
          )}
          {props.looked && <span className="chip chip-warn" style={{ fontSize: 9 }}>Given the look</span>}
        </div>
        {/* the tug bar: coach's prior, then camp's push or pull on it */}
        <div style={{ position: 'relative', height: 8, marginTop: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 4 }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(a, s)}%`, background: inNow ? ACCENT : 'rgba(255,255,255,0.35)', borderRadius: 4 }} />
          {played && Math.abs(s - a) > 0.3 && (
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${Math.min(a, s)}%`, width: `${Math.abs(s - a)}%`, background: up ? GOOD : BAD, opacity: 0.85, borderRadius: 2 }} />
          )}
          {props.cutPct !== null && (
            <div title="The cut line" style={{ position: 'absolute', top: -3, bottom: -3, left: `${props.cutPct}%`, width: 2, background: 'rgba(255,255,255,0.75)' }} />
          )}
        </div>
        <div className="small" style={{ marginTop: 3, lineHeight: 1.4 }}>
          {played ? (
            <>
              <span style={{ color: up ? GOOD : c.evidence < 0 ? BAD : 'var(--muted)', fontWeight: 700, marginRight: 6 }}>
                {c.evidence > 0 ? '+' : c.evidence < 0 ? '−' : '±'}{Math.abs(c.evidence).toFixed(1)} camp
              </span>
              <span className="muted">He {c.cite}.</span>
            </>
          ) : (
            <span className="muted">{c.winning ? "Holds a spot on the coach's opening chart." : 'Chasing a spot.'}</span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', minWidth: 96 }}>
        {atCutDay ? (
          <div className="row" style={{ gap: 4 }}>
            <button className={`btn btn-sm${place === 'nhl' ? ' btn-primary' : ''}`} onClick={() => props.setPlace('nhl')} title={c.tryout ? 'Sign him to a one-year, league-minimum deal' : 'He makes the team'}>
              {c.tryout ? 'Sign' : 'In'}
            </button>
            <button className={`btn btn-sm${place === 'ahl' ? ' btn-primary' : ''}`} onClick={() => props.setPlace('ahl')} title={c.tryout ? 'End the tryout' : c.current === 'nhl' && c.waiverRequired ? (c.claimedBy ? `Waivers: ${c.claimedBy} would claim him` : 'Waivers: he would clear') : 'To the AHL'}>
              {c.tryout ? 'Release' : 'Out'}
            </button>
          </div>
        ) : (
          <>
            <span className="small" style={{ fontWeight: 700, color: c.winning ? GOOD : 'var(--muted)' }}>{c.winning ? 'In' : 'Out'}</span>
            <button className={`btn btn-sm${props.looked ? ' btn-primary' : ' btn-ghost'}`} style={{ fontSize: 10, padding: '2px 8px' }} onClick={props.onLook} title="Skate him in the top six (or start him in goal) in the next camp games">
              {props.looked ? 'Looking' : 'Give the look'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────── side panels ─────────────────────────── */

function OpeningNight({ camp, placements }: { camp: NonNullable<TrainingCampView>; placements: Record<string, Place> }): JSX.Element {
  const counts = useMemo(() => {
    const n = { F: camp.nhlNow?.F ?? 0, D: camp.nhlNow?.D ?? 0, G: camp.nhlNow?.G ?? 0 }
    for (const d of camp.decisions) {
      const grp = d.position === 'G' ? 'G' : d.position === 'D' ? 'D' : 'F'
      const want = placements[d.playerId] ?? d.coachPlan
      if (d.tryout) { if (want === 'nhl') n[grp]++; continue }
      if (want === 'nhl' && d.current === 'ahl') n[grp]++
      if (want === 'ahl' && d.current === 'nhl') n[grp]--
    }
    return n
  }, [camp, placements])
  const total = counts.F + counts.D + counts.G
  const ok = total <= 23 && counts.F >= 12 && counts.D >= 6 && counts.G >= 2
  return (
    <div style={{ ...CARD, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>Opening night</div>
      <div className="row" style={{ gap: 14, alignItems: 'baseline' }}>
        <span style={{ fontSize: 26, fontWeight: 800, color: ok ? 'var(--text)' : BAD }}>{total}</span>
        <span className="small muted">{counts.F} F · {counts.D} D · {counts.G} G</span>
      </div>
      <div className="small" style={{ marginTop: 4, color: ok ? 'var(--muted)' : BAD }}>
        {ok ? 'A legal 23-man roster.' : total > 23 ? `Over the 23-man limit — the league's roster rule will send ${total - 23} down worst-first.` : 'Short at a position — the league will call up the best affordable man.'}
      </div>
    </div>
  )
}

function OtherCalls(props: { decisions: Decision[]; atCutDay: boolean; placements: Record<string, Place>; setPlace: (id: string, p: Place) => void }): JSX.Element | null {
  if (props.decisions.length === 0) return null
  return (
    <div style={{ ...CARD, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>Clear calls · outside the battles</div>
      <div className="stack" style={{ gap: 8 }}>
        {props.decisions.map((d) => {
          const want = props.placements[d.playerId] ?? d.coachPlan
          return (
            <div key={d.playerId} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <PlayerFace faceId={d.faceId} name={d.name} size={26} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <PlayerLink playerId={d.playerId} name={d.name} />
                  <span className="muted small">{d.position} · {d.age}</span>
                  {d.tryout && <span className="chip chip-violet" style={{ fontSize: 9 }}>PTO</span>}
                  {d.waiverRequired && d.current === 'nhl' && <span className={`chip ${d.claimedBy ? 'chip-danger' : ''}`} style={{ fontSize: 9 }}>WV{d.claimedBy ? ` · ${d.claimedBy}` : ''}</span>}
                </div>
                <div className="small muted" style={{ lineHeight: 1.4, marginTop: 2 }}>{d.line}</div>
              </div>
              {props.atCutDay ? (
                <div className="row" style={{ gap: 4 }}>
                  <button className={`btn btn-sm${want === 'nhl' ? ' btn-primary' : ''}`} onClick={() => props.setPlace(d.playerId, 'nhl')}>{d.tryout ? 'Sign' : 'NHL'}</button>
                  <button className={`btn btn-sm${want === 'ahl' ? ' btn-primary' : ''}`} onClick={() => props.setPlace(d.playerId, 'ahl')}>{d.tryout ? 'Release' : 'AHL'}</button>
                </div>
              ) : (
                <span className="small" style={{ fontWeight: 700, color: d.coachPlan === 'nhl' ? GOOD : 'var(--muted)', whiteSpace: 'nowrap' }}>
                  {d.tryout ? (d.coachPlan === 'nhl' ? 'Sign' : 'Release') : d.coachPlan === 'nhl' ? 'Up' : 'Down'}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface SortState<Row, K extends string> { sorted: Row[]; sortKey: K | null; dir: 'asc' | 'desc'; sortBy: (k: K) => void }
type SkKey = (typeof CAMP_SKATER_COLS)[number]['key']
type GKey = (typeof CAMP_GOALIE_COLS)[number]['key']

function CampStats({ camp, skaterSort, goalieSort }: {
  camp: NonNullable<TrainingCampView>
  skaterSort: SortState<CampSkaterLine, SkKey>
  goalieSort: SortState<CampGoalieLine, GKey>
}): JSX.Element {
  if (!camp.scrimmage || camp.scrimmage.results.length === 0) {
    return (
      <div style={{ ...CARD, padding: '14px 16px', fontSize: 13, lineHeight: 1.5, maxWidth: 760 }}>
        No camp games yet — the Blue-Red scrimmages come first. Every game is played by the match engine; the box score builds here.
      </div>
    )
  }
  return (
    <div className="stack" style={{ gap: 'var(--sp-3)', maxWidth: 1000 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {(camp.games ?? []).map((g) => (
          <span key={g.label} className="chip" style={{ fontSize: 11 }}>{g.label}: {g.result}</span>
        ))}
      </div>
      <div style={{ ...CARD }}>
        <table className="table">
          <thead><tr><SortHeaders columns={CAMP_SKATER_COLS} sortKey={skaterSort.sortKey} dir={skaterSort.dir} onSort={skaterSort.sortBy} /></tr></thead>
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
                <td className="num" style={{ fontWeight: 700 }}>{s.rating.toFixed(1)}</td>
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
                  <td className="num" style={{ fontWeight: 700 }}>{g.rating.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function CampRoster({ camp }: { camp: NonNullable<TrainingCampView> }): JSX.Element {
  const blue = (camp.roster ?? []).filter((r) => r.team === 'Blue')
  const red = (camp.roster ?? []).filter((r) => r.team === 'Red')
  return (
    <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'flex-start', maxWidth: 1000 }}>
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
  )
}
