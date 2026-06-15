/**
 * Scouting hub — FM-style scout deployment.
 *
 * Each scout gets a SCOPE (a nation/region, a league, the next opponent, the
 * draft class or free agents) and a FOCUS (youth / senior / all). Coverage is
 * reported by nation and by league (with a youth split), and a job market lets
 * the GM hire and release scouts.
 */
import { useState } from 'react'
import type { ScoutingView } from '../../worker/protocol'
import type {
  ScoutCardView, ScoutedPlayerRow, ScoutCoverageRow, ScoutFindView,
} from '../../engine/career/views'
import type { ScoutTarget, ScoutFocus } from '@domain/scouting'
import { PlayerLink } from '../components/NavContext'
import { fmtMoney } from '../components/format'
import { FlagIcon } from '../components/FlagIcon'
import { WorldMap, type WorldMapNation } from '../components/WorldMap'
import { Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'
import { toast } from '../components/store'
import { bumpRefresh } from '../components/store'

/* ── knowledge bar ─────────────────────────────────────────────────────────── */

function KnowledgeBar({ value, small }: { value: number; small?: boolean }): JSX.Element {
  const pct = Math.max(0, Math.min(100, value))
  const color =
    pct >= 80 ? 'var(--success)' :
    pct >= 50 ? 'var(--accent)' :
    pct >= 25 ? 'var(--accent2)' :
    'var(--muted)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="meter" style={{ flex: 1, height: small ? 4 : 6 }}>
        <div className="meter-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="small mono" style={{ color, minWidth: 24, textAlign: 'right' }}>{pct}</span>
    </div>
  )
}

/* ── assignment: scope dropdown ────────────────────────────────────────────── */

function ScopeDropdown(props: {
  scout: ScoutCardView
  view: ScoutingView
  onAssign: (target: ScoutTarget) => void
}): JSX.Element {
  const { scout, view, onAssign } = props
  const [open, setOpen] = useState(false)
  const Group = ({ label }: { label: string }): JSX.Element => (
    <div className="muted small" style={{ padding: '7px 10px 2px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
  )
  const Item = ({ label, target }: { label: string; target: ScoutTarget }): JSX.Element => (
    <button
      className="btn-ghost"
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 13 }}
      onClick={() => { onAssign(target); setOpen(false) }}
    >
      {label}
    </button>
  )

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="btn btn-ghost small"
        onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <span>{scout.assignmentLabel}</span>
        <span className="muted" style={{ fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 50,
            background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: 6,
            minWidth: 240, maxHeight: 360, overflowY: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <Group label="Priorities" />
          <Item label="Next opponent" target={{ kind: 'nextOpponent' }} />
          {view.hasDraftClass && <Item label="Whole draft class" target={{ kind: 'draftClass' }} />}
          <Item label="Free agents" target={{ kind: 'freeAgents' }} />

          {view.nations.length > 0 && <Group label="Regions" />}
          {view.nations.map((n) => (
            <Item key={`nation-${n.id}`} label={n.label} target={{ kind: 'nation', nation: n.id }} />
          ))}

          {view.competitions.length > 0 && <Group label="Leagues" />}
          {view.competitions.map((c) => (
            <Item key={`comp-${c.id}`} label={c.label} target={{ kind: 'competition', competitionId: c.id }} />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── assignment: focus segmented control ───────────────────────────────────── */

const FOCI: Array<{ key: ScoutFocus; label: string }> = [
  { key: 'youth', label: 'U23' },
  { key: 'senior', label: 'Senior' },
  { key: 'all', label: 'All' },
]

function FocusControl({ focus, onFocus }: { focus: ScoutFocus; onFocus: (f: ScoutFocus) => void }): JSX.Element {
  return (
    <div className="row" style={{ gap: 4 }}>
      {FOCI.map((f) => (
        <button
          key={f.key}
          className={`chip${focus === f.key ? ' chip-accent' : ''}`}
          style={{ cursor: 'pointer', border: 'none', fontSize: 11, flex: 1 }}
          onClick={() => onFocus(f.key)}
        >
          {f.label}
        </button>
      ))}
    </div>
  )
}

/* ── scout card ────────────────────────────────────────────────────────────── */

function ScoutCard(props: {
  scout: ScoutCardView
  view: ScoutingView
  onAssign: (scoutId: string, target: ScoutTarget, focus: ScoutFocus) => void
  onFire: (scoutId: string) => void
  canFire: boolean
}): JSX.Element {
  const { scout, view, onAssign, onFire, canFire } = props
  const ratingColor =
    scout.rating >= 80 ? 'var(--success)' :
    scout.rating >= 65 ? 'var(--accent)' :
    'var(--muted)'

  return (
    <div className="panel" style={{ background: 'var(--bg2)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 600 }}>{scout.name}</div>
          <div className="muted small" style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
            {scout.specialtyNation && <FlagIcon nationality={scout.specialtyNation} size={13} />}
            {scout.specialtyNation ? `${scout.specialtyNation} specialist` : 'Generalist'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: ratingColor }}>{scout.rating}</div>
          <div className="muted small">Ability{scout.judgment !== undefined ? ` · JA ${scout.judgment}` : ''}</div>
        </div>
      </div>

      <div>
        <div className="muted small" style={{ marginBottom: 4 }}>Region / League</div>
        <ScopeDropdown scout={scout} view={view} onAssign={(target) => onAssign(scout.scoutId, target, scout.focus)} />
      </div>

      <div>
        <div className="muted small" style={{ marginBottom: 4 }}>Focus</div>
        <FocusControl focus={scout.focus} onFocus={(f) => onAssign(scout.scoutId, scout.target, f)} />
      </div>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
        <span className="muted">Covering <b style={{ color: 'var(--text)' }}>{scout.coverage}</b> players</span>
        <span className="row" style={{ gap: 8, alignItems: 'center' }}>
          {scout.salary !== undefined && <span className="muted">{fmtMoney(scout.salary)}/yr</span>}
          <button
            className="btn btn-ghost small"
            disabled={!canFire}
            title={canFire ? 'Release this scout' : 'You must keep at least one scout'}
            style={{ color: canFire ? 'var(--danger, #d8584f)' : 'var(--muted)', padding: '2px 8px' }}
            onClick={() => onFire(scout.scoutId)}
          >
            Release
          </button>
        </span>
      </div>
    </div>
  )
}

/* ── coverage table ────────────────────────────────────────────────────────── */

function CoverageTable({ title, rows }: { title: string; rows: ScoutCoverageRow[] }): JSX.Element {
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <p className="muted small">No data yet.</p>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>{title.includes('Nation') ? 'Nation' : 'League'}</th>
                <th className="num">Players</th>
                <th style={{ width: 150 }}>All</th>
                <th style={{ width: 150 }}>Youth</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      {r.nation && <FlagIcon nationality={r.nation} size={14} />}
                      <span className="small">{r.label}</span>
                    </span>
                  </td>
                  <td className="num muted small">{r.playerCount}</td>
                  <td><KnowledgeBar value={r.avgKnowledge} small /></td>
                  <td><KnowledgeBar value={r.youthAvgKnowledge} small /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

/* ── scouted-players recommendations table ─────────────────────────────────── */

const REC_COLOR: Record<ScoutedPlayerRow['rec'], string> = {
  'A+': 'var(--success)',
  A: 'rgba(52,211,153,0.85)',
  B: 'var(--accent2)',
  C: 'var(--amber, #f59e0b)',
  D: 'var(--muted)',
}

function stars5(v: number): string {
  const full = Math.floor(v)
  return '★'.repeat(full) + (v - full >= 0.5 ? '½' : '')
}

type ScoutSort = 'rec' | 'potential' | 'current' | 'age' | 'knowledge'

function ScoutedTable({ rows, scouts, onScoutPlayer }: {
  rows: ScoutedPlayerRow[]
  scouts?: ScoutCardView[]
  onScoutPlayer?: (scoutId: string, playerId: string) => void
}): JSX.Element {
  const [pos, setPos] = useState<string>('ALL')
  const [topOnly, setTopOnly] = useState(false)
  const [sort, setSort] = useState<ScoutSort>('rec')

  const positions = ['ALL', 'C', 'LW', 'RW', 'D', 'G']
  const recOrder: Record<string, number> = { 'A+': 0, A: 1, B: 2, C: 3, D: 4 }
  let view = rows.filter((r) => (pos === 'ALL' || r.position === pos) && (!topOnly || r.rec === 'A+' || r.rec === 'A'))
  view = [...view].sort((a, b) => {
    switch (sort) {
      case 'potential': return b.potentialStars - a.potentialStars
      case 'current': return b.currentStars - a.currentStars
      case 'age': return a.age - b.age
      case 'knowledge': return b.knowledge - a.knowledge
      default: return recOrder[a.rec]! - recOrder[b.rec]! || b.potentialStars - a.potentialStars
    }
  })

  return (
    <Panel title={`Scouting Recommendations (${view.length})`}>
      <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', marginBottom: 'var(--sp-2)', alignItems: 'center' }}>
        {positions.map((p) => (
          <button key={p} className={`chip${pos === p ? ' chip-accent' : ''}`} style={{ cursor: 'pointer', border: 'none', fontSize: 11 }} onClick={() => setPos(p)}>{p}</button>
        ))}
        <span style={{ width: 1, height: 16, background: 'var(--line)', margin: '0 4px' }} />
        <button className={`chip${topOnly ? ' chip-accent' : ''}`} style={{ cursor: 'pointer', border: 'none', fontSize: 11 }} onClick={() => setTopOnly((t) => !t)}>Top targets only</button>
        <label className="small muted" style={{ marginLeft: 'auto' }}>Sort:&nbsp;
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as ScoutSort)} style={{ fontSize: 12 }}>
            <option value="rec">Recommendation</option>
            <option value="potential">Potential</option>
            <option value="current">Current</option>
            <option value="knowledge">Knowledge</option>
            <option value="age">Age</option>
          </select>
        </label>
      </div>
      {view.length === 0 ? (
        <p className="muted small">No scouted players yet — assign scouts to build intel.</p>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 460, overflowY: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Rec</th><th>Player</th><th className="num">Pos</th><th className="num">Age</th><th>Club</th>
                <th>Current</th><th>Potential</th><th className="num">Know.</th><th className="num">Value</th>
                {scouts && onScoutPlayer && <th></th>}
              </tr>
            </thead>
            <tbody>
              {view.map((r) => (
                <tr key={r.playerId}>
                  <td><span style={{ fontWeight: 800, color: REC_COLOR[r.rec] }}>{r.rec}</span></td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      {r.nationality && <FlagIcon nationality={r.nationality} size={15} />}
                      <PlayerLink playerId={r.playerId} name={r.name} />
                    </span>
                  </td>
                  <td className="num muted">{r.position}</td>
                  <td className="num muted">{r.age}</td>
                  <td className="muted small">{r.teamAbbr}</td>
                  <td style={{ color: 'var(--muted)', letterSpacing: 1, fontSize: 12 }}>{stars5(r.currentStars) || '–'}</td>
                  <td style={{ color: 'var(--accent, #f5b301)', letterSpacing: 1, fontSize: 12 }}>{stars5(r.potentialStars) || '–'}</td>
                  <td className="num muted small">{r.knowledge}%</td>
                  <td className="num small">{fmtMoney(r.salary)}</td>
                  {scouts && onScoutPlayer && (
                    <td className="num"><ScoutPickerCell playerId={r.playerId} scouts={scouts} onPick={onScoutPlayer} /></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

/* ── FM-style header strip ─────────────────────────────────────────────────── */

function HeaderCard({ label, value, sub }: { label: string; value: string; sub?: string }): JSX.Element {
  return (
    <div style={{ flex: 1, minWidth: 150, padding: '12px 16px', background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)' }}>
      <div className="muted" style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4, color: 'var(--accent, #f5b301)' }}>{value}</div>
      {sub && <div className="muted small" style={{ marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function knowledgeWord(k: number): string {
  return k >= 80 ? 'Excellent' : k >= 60 ? 'Good' : k >= 40 ? 'Average' : k >= 20 ? 'Limited' : 'Poor'
}

function HeaderStrip({ data }: { data: ScoutingView }): JSX.Element {
  const salaryTotal = data.scouts.reduce((s, c) => s + (c.salary ?? 0), 0)
  return (
    <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
      <HeaderCard label="Scouts on Assignment" value={`${data.activeScouts}/${data.scouts.length}`} sub={`Cap ${data.maxScouts}`} />
      <HeaderCard label="World Knowledge" value={knowledgeWord(data.worldKnowledge)} sub={`${data.worldKnowledge}% average`} />
      <HeaderCard label="Scouting Range" value="World" sub={`${data.nations.length} nations · ${data.competitions.length} leagues`} />
      <HeaderCard label="Nations Covered" value={`${data.scoutedNations.length}`} sub={data.scoutedNations.slice(0, 3).join(', ') || 'none yet'} />
      <HeaderCard label="Scouting Wages" value={fmtMoney(salaryTotal)} sub="per year" />
    </div>
  )
}

/* ── Overview: world map + assignment list ─────────────────────────────────── */

function ScoutAssignmentList({ scouts }: { scouts: ScoutCardView[] }): JSX.Element {
  return (
    <Panel title={`Scout Assignments (${scouts.length})`}>
      <p className="muted small" style={{ marginTop: -4, marginBottom: 10 }}>
        Each scout's current region/league focus. Re-aim them under Recruitment Focus.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Staff Member</th><th>Recruitment Focus</th><th className="num">Ability</th></tr></thead>
          <tbody>
            {scouts.map((s) => (
              <tr key={s.scoutId}>
                <td style={{ fontWeight: 600 }}>{s.name}<div className="muted small">Scout{s.specialtyNation ? ` · ${s.specialtyNation} specialist` : ''}</div></td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {s.focusNation && <FlagIcon nationality={s.focusNation} size={15} />}
                    <span>{s.assignmentLabel}</span>
                    <span className="chip" style={{ fontSize: 10 }}>{s.focusLabel}</span>
                  </span>
                </td>
                <td className="num" style={{ fontWeight: 700 }}>{s.rating}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function WatchListPanel({ data }: { data: ScoutingView }): JSX.Element {
  return (
    <Panel title="Watch List">
      {data.topGains.length === 0 ? (
        <p className="muted small">Assign scouts to start building intelligence.</p>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
          <table className="table">
            <thead><tr><th>Player</th><th>Pos</th><th className="num">Knowledge</th></tr></thead>
            <tbody>
              {data.topGains.map((p) => (
                <tr key={p.playerId}>
                  <td><PlayerLink playerId={p.playerId} name={p.name} /></td>
                  <td className="muted">{p.position}</td>
                  <td><KnowledgeBar value={p.knowledge} small /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function OverviewTab({ data }: { data: ScoutingView }): JSX.Element {
  return (
    <div className="stack">
      <HeaderStrip data={data} />
      <ScoutAssignmentList scouts={data.scouts} />
      <WatchListPanel data={data} />
    </div>
  )
}

function buildMapNations(data: ScoutingView): WorldMapNation[] {
  const map: WorldMapNation[] = data.nationCoverage.map((c) => ({
    nation: c.nation ?? c.label,
    scouted: data.scoutedNations.includes(c.nation ?? c.label),
    knowledge: c.avgKnowledge,
  }))
  for (const n of data.scoutedNations) {
    if (!map.some((m) => m.nation === n)) map.push({ nation: n, scouted: true, knowledge: 0 })
  }
  return map
}

/* ── Scouting Centre: surfaced recommendations (fills over time) ────────────── */

function FindCard({ find }: { find: ScoutFindView }): JSX.Element {
  const color = REC_COLOR[find.grade]
  return (
    <div className="panel" style={{ background: 'var(--bg2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {find.nationality && <FlagIcon nationality={find.nationality} size={15} />}
            <PlayerLink playerId={find.playerId} name={find.name} />
          </div>
          <div className="muted small">{find.age} · {find.position} · {find.teamAbbr}</div>
        </div>
        <div style={{ fontWeight: 800, fontSize: 22, color }}>{find.grade}</div>
      </div>
      <div style={{ display: 'flex', gap: 'var(--sp-4)' }}>
        <div><div className="muted" style={{ fontSize: 10 }}>CURRENT</div><div style={{ color: 'var(--muted)', letterSpacing: 1 }}>{stars5(find.currentStars) || '–'}</div></div>
        <div><div className="muted" style={{ fontSize: 10 }}>POTENTIAL</div><div style={{ color: 'var(--accent, #f5b301)', letterSpacing: 1 }}>{stars5(find.potentialStars) || '–'}</div></div>
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--text)' }}>{find.reason}</div>
      <div className="muted small" style={{ borderTop: '1px solid var(--line)', paddingTop: 6, display: 'flex', justifyContent: 'space-between' }}>
        <span>Flagged by {find.scoutName}</span><span>{find.foundDate}</span>
      </div>
    </div>
  )
}

function ScoutingCentreTab({ finds }: { finds: ScoutFindView[] }): JSX.Element {
  return (
    <Panel title={`Scout Recommendations (${finds.length})`}>
      {finds.length === 0 ? (
        <div className="muted" style={{ padding: '24px 8px', textAlign: 'center', lineHeight: 1.6 }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>🔍</div>
          Your scouts haven't surfaced anyone yet. Point them at youth leagues and the
          draft class under <b>Recruitment Focus</b> — as they get to know prospects,
          their finds will appear here (and land in your inbox).
        </div>
      ) : (
        <div className="grid grid-3" style={{ gap: 'var(--sp-4)' }}>
          {finds.map((f) => <FindCard key={f.playerId} find={f} />)}
        </div>
      )}
    </Panel>
  )
}

/* ── per-player "Scout" picker (assign a scout to one player) ───────────────── */

function ScoutPickerCell({ playerId, scouts, onPick }: {
  playerId: string
  scouts: ScoutCardView[]
  onPick: (scoutId: string, playerId: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative' }}>
      <button className="btn btn-ghost small" style={{ padding: '2px 8px' }} onClick={() => setOpen((o) => !o)}>Scout ▾</button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '100%', zIndex: 60, background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: 6, minWidth: 170, boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
          <div className="muted small" style={{ padding: '6px 10px 2px', fontWeight: 700 }}>Assign a scout</div>
          {scouts.map((s) => (
            <button key={s.scoutId} className="btn-ghost" style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 12 }}
              onClick={() => { onPick(s.scoutId, playerId); setOpen(false) }}>
              {s.name} <span className="muted">({s.rating})</span>
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

/* ── main screen ───────────────────────────────────────────────────────────── */

export type FmTab = 'overview' | 'centre' | 'players' | 'focus' | 'coverage'

const TAB_TITLE: Record<FmTab, string> = {
  overview: 'Scouting — Overview',
  centre: 'Scouting Centre',
  players: 'Scouting — Players',
  focus: 'Recruitment Focus',
  coverage: 'Scouting Coverage',
}

export function ScoutingScreen({ tab }: { tab: FmTab }): JSX.Element {
  const client = useClient()
  const { data, loading, error, refetch } = useScreenData<ScoutingView>(
    () => client.getScouting(),
    (r) => (r.type === 'scouting' ? r.scouting : null)
  )

  const handleAssign = async (scoutId: string, target: ScoutTarget, focus: ScoutFocus): Promise<void> => {
    const res = await client.assignScout(scoutId, target, focus)
    if (res.type === 'error') { toast(res.message, 'error') } else { bumpRefresh(); refetch() }
  }
  const handleFire = async (scoutId: string): Promise<void> => {
    const res = await client.fireScout(scoutId)
    if (res.type === 'error') { toast(res.message, 'error') } else { bumpRefresh(); refetch() }
  }
  const handleScoutPlayer = async (scoutId: string, playerId: string): Promise<void> => {
    const scout = data?.scouts.find((s) => s.scoutId === scoutId)
    const res = await client.assignScout(scoutId, { kind: 'player', playerId }, scout?.focus ?? 'all')
    if (res.type === 'error') { toast(res.message, 'error') } else { toast('Scout assigned to player', 'success'); bumpRefresh(); refetch() }
  }

  return (
    <section className="stack">
      <ScreenHeader title={TAB_TITLE[tab]} />
      <ScreenStateNotices loading={loading} error={error} empty={!data} emptyText="No scouting data." />

      {data && tab === 'overview' && <OverviewTab data={data} />}

      {data && tab === 'centre' && <ScoutingCentreTab finds={data.recommendations} />}

      {data && tab === 'players' && (
        <ScoutedTable rows={data.scoutedPlayers} scouts={data.scouts} onScoutPlayer={(sid, pid) => { void handleScoutPlayer(sid, pid) }} />
      )}

      {data && tab === 'focus' && (
        <Panel title={`Recruitment Focus — Scouting Department (${data.scouts.length}/${data.maxScouts})`}>
          <p className="muted small" style={{ marginTop: -4, marginBottom: 10 }}>Aim each scout at a region/league and set who they focus on. Hire more scouts under Staff → Job Market.</p>
          <div className="grid grid-3" style={{ gap: 'var(--sp-4)' }}>
            {data.scouts.map((scout) => (
              <ScoutCard
                key={scout.scoutId}
                scout={scout}
                view={data}
                canFire={data.scouts.length > 1}
                onAssign={(id, target, focus) => { void handleAssign(id, target, focus) }}
                onFire={(id) => { void handleFire(id) }}
              />
            ))}
          </div>
        </Panel>
      )}

      {data && tab === 'coverage' && (
        <div className="stack">
          <WorldMap nations={buildMapNations(data)} />
          <div className="grid grid-2" style={{ gap: 'var(--sp-4)' }}>
            <CoverageTable title="Coverage by Nation" rows={data.nationCoverage} />
            <CoverageTable title="Coverage by League" rows={data.leagueCoverage} />
          </div>
        </div>
      )}
    </section>
  )
}
