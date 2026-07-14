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
import { PlayerLink, useNav } from '../components/NavContext'
import { PlayerFace } from '../components/PlayerFace'
import { fmtMoney } from '../components/format'
import { FlagIcon } from '../components/FlagIcon'
import { WorldMap, type WorldMapNation } from '../components/WorldMap'
import { Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'
import { toast } from '../components/store'
import { bumpRefresh } from '../components/store'

/** Clickable scout name → his profile page. */
function ScoutLink({ scoutId, name }: { scoutId: string; name: string }): JSX.Element {
  const nav = useNav()
  return (
    <a className="link" style={{ cursor: 'pointer', fontWeight: 'inherit' }} onClick={() => nav.navigate('scoutProfile', { scoutId })}>
      {name}
    </a>
  )
}

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
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const match = (label: string): boolean => q === '' || label.toLowerCase().includes(q)
  const close = (): void => { setOpen(false); setQuery('') }
  const Group = ({ label }: { label: string }): JSX.Element => (
    <div className="muted small" style={{ padding: '7px 10px 2px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
  )
  const Item = ({ label, target }: { label: string; target: ScoutTarget }): JSX.Element => (
    <button
      type="button"
      className="btn-ghost"
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 13 }}
      onClick={() => { onAssign(target); close() }}
    >
      {label}
    </button>
  )

  const nations = view.nations.filter((n) => match(n.label))
  const competitions = view.competitions.filter((c) => match(c.label))
  const priorities: Array<{ label: string; target: ScoutTarget }> = [
    { label: 'Our players & prospects', target: { kind: 'ownProspects' } },
    { label: 'Next opponent', target: { kind: 'nextOpponent' } },
    ...(view.hasDraftClass ? [{ label: 'Whole draft class', target: { kind: 'draftClass' as const } }] : []),
    { label: 'Free agents', target: { kind: 'freeAgents' } },
  ].filter((p) => match(p.label))
  const nothing = priorities.length + nations.length + competitions.length === 0

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="btn btn-ghost small"
        onClick={() => (open ? close() : setOpen(true))}
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
          {/* Type-to-filter so the brief isn't a giant scrolling list. */}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter regions & leagues…"
            style={{
              position: 'sticky', top: 0, zIndex: 1, width: '100%', boxSizing: 'border-box',
              padding: '7px 10px', background: 'var(--bg0)', border: 'none',
              borderBottom: '1px solid var(--line)', color: 'var(--text)', fontSize: 12,
            }}
          />
          {priorities.length > 0 && <Group label="Priorities" />}
          {priorities.map((p) => <Item key={`prio-${p.label}`} label={p.label} target={p.target} />)}

          {nations.length > 0 && <Group label="Regions" />}
          {nations.map((n) => (
            <Item key={`nation-${n.id}`} label={n.label} target={{ kind: 'nation', nation: n.id }} />
          ))}

          {competitions.length > 0 && <Group label="Leagues" />}
          {competitions.map((c) => (
            <Item key={`comp-${c.id}`} label={c.label} target={{ kind: 'competition', competitionId: c.id }} />
          ))}

          {nothing && <div className="muted small" style={{ padding: '8px 12px' }}>No match for “{query}”.</div>}
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
          type="button"
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

type PosFilter = 'any' | 'F' | 'D' | 'G'

function SegControl<T extends string | number>({ options, value, onPick }: {
  options: Array<{ key: T; label: string }>; value: T; onPick: (v: T) => void
}): JSX.Element {
  return (
    <div className="row" style={{ gap: 4 }}>
      {options.map((o) => (
        <button key={String(o.key)} type="button" className={`chip${value === o.key ? ' chip-accent' : ''}`}
          style={{ cursor: 'pointer', border: 'none', fontSize: 11, flex: 1 }} onClick={() => onPick(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ScoutCard(props: {
  scout: ScoutCardView
  view: ScoutingView
  onAssign: (scoutId: string, target: ScoutTarget, focus: ScoutFocus, positionFilter: PosFilter, minPotentialStars: number) => void
  onFire: (scoutId: string) => void
  canFire: boolean
  /** When true the brief controls are shown inline (no per-card Edit toggle) —
   *  used in the Advanced panel so every knob is directly clickable. */
  defaultExpanded?: boolean
}): JSX.Element {
  const { scout, view, onAssign, onFire, canFire } = props
  const apply = (patch: { target?: ScoutTarget; focus?: ScoutFocus; positionFilter?: PosFilter; minPotentialStars?: number }): void =>
    onAssign(
      scout.scoutId,
      patch.target ?? scout.target,
      patch.focus ?? scout.focus,
      patch.positionFilter ?? scout.positionFilter,
      patch.minPotentialStars ?? scout.minPotentialStars,
    )
  const [editing, setEditing] = useState(props.defaultExpanded ?? false)
  const ratingColor =
    scout.rating >= 80 ? 'var(--success)' :
    scout.rating >= 65 ? 'var(--accent)' :
    'var(--muted)'
  const focusLabel = scout.focus === 'youth' ? 'U23' : scout.focus === 'senior' ? 'Senior' : 'All ages'
  const posLabel = scout.positionFilter === 'any' ? 'All pos' : scout.positionFilter
  const potLabel = scout.minPotentialStars >= 4 ? '4★+' : scout.minPotentialStars >= 3 ? '3★+' : null
  const speedColor = scout.readSpeed === 'Fast' ? 'var(--success)' : scout.readSpeed === 'Steady' ? 'var(--accent)' : 'var(--danger, #d8584f)'

  return (
    <div className="panel" style={{ background: 'var(--bg2)', padding: '8px var(--sp-3)' }}>
      {/* Compact summary row (always visible) */}
      <div style={{ display: 'grid', gridTemplateColumns: '34px 1.4fr 1.6fr auto', gap: 'var(--sp-3)', alignItems: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: ratingColor, textAlign: 'center' }} title={`Ability ${scout.rating}${scout.judgment !== undefined ? ` · JA ${scout.judgment}` : ''}`}>
          {scout.rating}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <ScoutLink scoutId={scout.scoutId} name={scout.name} />
          </div>
          <div className="muted small" style={{ marginTop: 1, display: 'flex', alignItems: 'center', gap: 5 }}>
            {scout.specialtyNation && <FlagIcon nationality={scout.specialtyNation} size={12} />}
            {scout.specialtyNation ? `${scout.specialtyNation} specialist` : 'Generalist'}
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scout.assignmentLabel}</div>
          <div className="muted small" style={{ marginTop: 1 }}>
            {focusLabel} · {posLabel}{potLabel ? ` · ${potLabel}` : ''} · {scout.coverage} covered ·{' '}
            <span style={{ color: speedColor }}>{scout.readSpeed}</span>
          </div>
        </div>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          {!props.defaultExpanded && (
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing((e) => !e)} title="Edit this scout's brief">
              {editing ? 'Done' : 'Edit'}
            </button>
          )}
          <button
            className="btn btn-ghost btn-sm"
            disabled={!canFire}
            title={canFire ? 'Release this scout' : 'You must keep at least one scout'}
            style={{ color: canFire ? 'var(--danger, #d8584f)' : 'var(--muted)' }}
            onClick={() => onFire(scout.scoutId)}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Expanded editor (on demand) */}
      {editing && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-3)', marginTop: 'var(--sp-3)', paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--line)' }}>
          <div>
            <div className="muted small" style={{ marginBottom: 4 }} title="Narrow the brief to a region or league for faster, sharper reads">Region / League</div>
            <ScopeDropdown scout={scout} view={view} onAssign={(target) => apply({ target })} />
          </div>
          <div>
            <div className="muted small" style={{ marginBottom: 4 }}>Age focus</div>
            <FocusControl focus={scout.focus} onFocus={(f) => apply({ focus: f })} />
          </div>
          <div>
            <div className="muted small" style={{ marginBottom: 4 }}>Position</div>
            <SegControl<PosFilter>
              options={[{ key: 'any', label: 'Any' }, { key: 'F', label: 'F' }, { key: 'D', label: 'D' }, { key: 'G', label: 'G' }]}
              value={scout.positionFilter}
              onPick={(positionFilter) => apply({ positionFilter })}
            />
          </div>
          <div>
            <div className="muted small" style={{ marginBottom: 4 }} title="Only surface prospects whose potential meets this star rating">Minimum potential to flag</div>
            <SegControl<number>
              options={[{ key: 0, label: 'Any' }, { key: 3, label: '3★' }, { key: 4, label: '4★' }]}
              value={scout.minPotentialStars >= 4 ? 4 : scout.minPotentialStars >= 3 ? 3 : 0}
              onPick={(minPotentialStars) => apply({ minPotentialStars })}
            />
          </div>
        </div>
      )}
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
  const [draftOnly, setDraftOnly] = useState(false)
  const [sort, setSort] = useState<ScoutSort>('rec')

  const positions = ['ALL', 'C', 'LW', 'RW', 'D', 'G']
  const recOrder: Record<string, number> = { 'A+': 0, A: 1, B: 2, C: 3, D: 4 }
  let view = rows.filter((r) =>
    (pos === 'ALL' || r.position === pos) &&
    (!topOnly || r.rec === 'A+' || r.rec === 'A') &&
    (!draftOnly || r.draftEligible))
  view = [...view].sort((a, b) => {
    switch (sort) {
      case 'potential': return b.potentialStars - a.potentialStars
      case 'current': return b.currentStars - a.currentStars
      case 'age': return a.age - b.age
      case 'knowledge': return b.knowledge - a.knowledge
      default: return b.targetScore - a.targetScore || recOrder[a.rec]! - recOrder[b.rec]!
    }
  })

  return (
    <Panel title={`Acquisition Targets (${view.length})`}>
      <p className="muted small" style={{ marginTop: -4, marginBottom: 8 }}>
        Ranked by target value — youth and upside you could realistically acquire. Established
        stars are deprioritised (scouting just keeps your read on them current).
      </p>
      <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', marginBottom: 'var(--sp-2)', alignItems: 'center' }}>
        {positions.map((p) => (
          <button key={p} className={`chip${pos === p ? ' chip-accent' : ''}`} style={{ cursor: 'pointer', border: 'none', fontSize: 11 }} onClick={() => setPos(p)}>{p}</button>
        ))}
        <span style={{ width: 1, height: 16, background: 'var(--line)', margin: '0 4px' }} />
        <button className={`chip${topOnly ? ' chip-accent' : ''}`} style={{ cursor: 'pointer', border: 'none', fontSize: 11 }} onClick={() => setTopOnly((t) => !t)}>Top targets only</button>
        <button className={`chip${draftOnly ? ' chip-accent' : ''}`} style={{ cursor: 'pointer', border: 'none', fontSize: 11 }} onClick={() => setDraftOnly((d) => !d)}>Draft eligibles</button>
        <label className="small muted" style={{ marginLeft: 'auto' }}>Sort:&nbsp;
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as ScoutSort)} style={{ fontSize: 12 }}>
            <option value="rec">Target value</option>
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
                <th>Draft</th><th>Current</th><th>Potential</th><th className="num">Know.</th><th className="num">Salary</th>
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
                  <td className="small" style={{ color: r.draftEligible ? 'var(--accent2, #e0b341)' : 'var(--muted)' }}>{r.draftLabel ?? (r.draftEligible ? 'Eligible' : '—')}</td>
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
                <td style={{ fontWeight: 600 }}><ScoutLink scoutId={s.scoutId} name={s.name} /><div className="muted small">Scout{s.specialtyNation ? ` · ${s.specialtyNation} specialist` : ''}</div></td>
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
          <div className="muted small">
            {find.age} · {find.position} · {find.teamAbbr}
            {find.draftLabel && <> · <span style={{ color: 'var(--accent2, #e0b341)' }}>{find.draftLabel}</span></>}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 800, fontSize: 22, color }}>{find.grade}</div>
          {find.fitsNeed && (
            <span className="chip" style={{ fontSize: 9, background: 'rgba(52,211,153,0.18)', border: '1px solid var(--success)', color: 'var(--success)' }}>
              Fills a need
            </span>
          )}
        </div>
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

type TriageAction = 'shortlist' | 'unshortlist' | 'pass' | 'rescout'

/** The full single-prospect report shown at the top of the triage flow. */
function ReportCard({ find }: { find: ScoutFindView }): JSX.Element {
  const f = find
  const color = REC_COLOR[f.grade]
  return (
    <div className="panel" style={{ background: 'var(--bg2)', padding: 'var(--sp-4)', display: 'flex', gap: 'var(--sp-4)' }}>
      <PlayerFace faceId={f.faceId} name={f.name} size={72} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {f.nationality && <FlagIcon nationality={f.nationality} size={16} />}
              <PlayerLink playerId={f.playerId} name={f.name} />
            </div>
            <div className="muted small" style={{ marginTop: 2 }}>
              {f.age} · {f.position} · {f.teamAbbr}
              {f.draftLabel && <> · <span style={{ color: 'var(--accent2, #e0b341)' }}>{f.draftLabel}</span></>}
              {f.fitsNeed && <> · <span style={{ color: 'var(--success)' }}>fills a need</span></>}
            </div>
          </div>
          <div style={{ fontWeight: 900, fontSize: 30, color, lineHeight: 1 }}>{f.grade}</div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-5)', margin: '10px 0' }}>
          <div><div className="muted" style={{ fontSize: 10 }}>CURRENT</div><div style={{ color: 'var(--muted)', letterSpacing: 1 }}>{stars5(f.currentStars) || '–'}</div></div>
          <div><div className="muted" style={{ fontSize: 10 }}>POTENTIAL</div><div style={{ color: 'var(--accent, #f5b301)', letterSpacing: 1 }}>{stars5(f.potentialStars) || '–'}</div></div>
          <div><div className="muted" style={{ fontSize: 10 }}>KNOWLEDGE</div><div style={{ fontWeight: 700 }}>{f.knowledge}%</div></div>
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{f.reason}</div>
        <div className="muted small" style={{ marginTop: 8, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
          Flagged by {f.scoutName} · {f.foundDate}
        </div>
      </div>
    </div>
  )
}

/**
 * FM-style Scouting Centre: triage one report at a time — Track it, Pass, or send
 * a scout back for another look — rather than a wall of cards. Tracked prospects
 * collect on the Shortlist below.
 */
function ScoutingCentreTab({ finds, rosterNeeds, onTriage }: {
  finds: ScoutFindView[]
  rosterNeeds: string[]
  onTriage: (action: TriageAction, playerId: string) => void | Promise<void>
}): JSX.Element {
  const nav = useNav()
  const [posFilter, setPosFilter] = useState<'ALL' | 'F' | 'D' | 'G'>('ALL')
  const [idx, setIdx] = useState(0)

  const isPos = (pos: string, f: 'F' | 'D' | 'G'): boolean => {
    const isG = pos === 'G', isD = pos === 'D' || pos === 'LD' || pos === 'RD'
    return f === 'G' ? isG : f === 'D' ? isD : (!isG && !isD)
  }
  const shortlist = finds.filter((f) => f.shortlisted)
  const queue = finds
    .filter((f) => !f.shortlisted)
    .filter((f) => posFilter === 'ALL' || isPos(f.position, posFilter))

  const clampedIdx = Math.min(idx, Math.max(0, queue.length - 1))
  const current = queue[clampedIdx]

  const act = (action: TriageAction, pid: string): void => {
    void onTriage(action, pid)
    // Track/Pass remove the card from the queue, so the same index shows the next
    // one; a re-scout keeps him in the queue, so step forward to move on.
    if (action === 'rescout') setIdx((i) => i + 1)
  }

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <Panel title="Scouting Centre">
        {rosterNeeds.length > 0 && (
          <p className="muted small" style={{ marginTop: -4, marginBottom: 10 }}>
            Your roster is thin at <b style={{ color: 'var(--success)' }}>{rosterNeeds.join(', ')}</b> — need-fillers float to the top of the queue.
          </p>
        )}
        {finds.length === 0 ? (
          <div className="muted" style={{ padding: '24px 8px', textAlign: 'center', lineHeight: 1.6 }}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>🔍</div>
            Your scouts haven't surfaced anyone yet. Point them at youth leagues and the
            draft class under <b>Recruitment Focus</b> — their finds arrive here (and in
            a weekly digest in your inbox).
          </div>
        ) : !current ? (
          <div className="muted" style={{ padding: '24px 8px', textAlign: 'center', lineHeight: 1.6 }}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>✅</div>
            You're all caught up — every flagged prospect has been triaged. New finds
            will appear here as your scouts get to know them.
          </div>
        ) : (
          <>
            {/* Progress + position filter */}
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
              <span className="muted small">Report <b>{clampedIdx + 1}</b> of <b>{queue.length}</b> awaiting your call</span>
              <div className="row" style={{ gap: 4 }}>
                {(['ALL', 'F', 'D', 'G'] as const).map((p) => (
                  <button key={p} className={`chip${posFilter === p ? ' chip-accent' : ''}`} style={{ cursor: 'pointer', border: 'none', fontSize: 11 }} onClick={() => { setPosFilter(p); setIdx(0) }}>{p}</button>
                ))}
              </div>
            </div>

            <ReportCard find={current} />

            {/* Triage actions */}
            <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 'var(--sp-3)' }}>
              <button className="btn btn-primary" onClick={() => act('shortlist', current.playerId)}>★ Track him</button>
              <button className="btn" onClick={() => act('rescout', current.playerId)} title="Send your best-fit scout back for a deeper read">🔍 Take another look</button>
              <button className="btn btn-ghost" onClick={() => setIdx((i) => i + 1)}>Skip →</button>
              <button className="btn btn-ghost" style={{ color: 'var(--danger, #d8584f)' }} onClick={() => act('pass', current.playerId)}>Pass</button>
              <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => nav.navigate('player', { playerId: current.playerId })}>Full profile →</button>
            </div>
          </>
        )}
      </Panel>

      {/* Shortlist — the prospects you chose to track */}
      <Panel title={`Shortlist${shortlist.length ? ` (${shortlist.length})` : ''}`}>
        {shortlist.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            Nobody tracked yet. Hit <b>★ Track him</b> on a report to pin a prospect here.
          </p>
        ) : (
          <div className="grid grid-3" style={{ gap: 'var(--sp-4)' }}>
            {shortlist.map((f) => (
              <div key={f.playerId} style={{ position: 'relative' }}>
                <FindCard find={f} />
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ position: 'absolute', top: 6, right: 6, padding: '0 6px' }}
                  title="Un-track"
                  onClick={() => onTriage('unshortlist', f.playerId)}
                >✕</button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
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

/* ── Recruitment Focus: focus-first deployment ─────────────────────────────── */

/** A scouting objective. Scouts get assigned TO a focus (not the other way round). */
interface FocusDef {
  key: string
  target: ScoutTarget
  icon: string
  label: string
  desc: string
  /** Nation the focus maps to (drives specialist fit), if any. */
  nation?: string
  /** Age band a scout inherits when assigned to this focus. */
  band: ScoutFocus
}

/** Stable key so a scout's current target maps onto exactly one focus card. */
function focusKey(t: ScoutTarget): string {
  switch (t.kind) {
    case 'nation': return `nation:${t.nation}`
    case 'competition': return `comp:${t.competitionId}`
    case 'team': return `team:${t.teamId}`
    case 'division': return `div:${t.divisionId}`
    case 'player': return `player:${t.playerId}`
    default: return t.kind
  }
}

/** How well a scout fits a focus — specialists shine on their nation, generalists
 *  are better spent on the utility briefs. Higher = better fit. */
function focusFit(scout: ScoutCardView, focus: FocusDef): number {
  let s = scout.rating + (scout.judgment ?? 60) * 0.25
  if (focus.nation) {
    if (scout.specialtyNation === focus.nation) s += 55
    else if (scout.specialtyNation) s -= 6
  } else if (scout.specialtyNation) {
    s -= 6
  }
  return s
}

/** Ranked scout picker — pick a well-fitting scout to add to a focus. */
function AssignScoutPicker({ focus, candidates, onAssign }: {
  focus: FocusDef
  /** All scouts NOT already on this focus, with their current focus label. */
  candidates: Array<{ scout: ScoutCardView; currentLabel: string }>
  onAssign: (scoutId: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ranked = [...candidates].sort((a, b) => focusFit(b.scout, focus) - focusFit(a.scout, focus))
  const best = ranked.length > 0 ? focusFit(ranked[0]!.scout, focus) : 0
  return (
    <span style={{ position: 'relative' }}>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen((o) => !o)}>＋ Assign scout</button>
      {open && (
        <div style={{
          position: 'absolute', left: 0, top: '100%', zIndex: 60, marginTop: 4,
          background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: 6,
          minWidth: 280, maxHeight: 340, overflowY: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}>
          <div className="muted small" style={{ padding: '7px 12px 3px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Best fit for {focus.label}
          </div>
          {ranked.length === 0 && <div className="muted small" style={{ padding: '6px 12px 10px' }}>Every scout is already on this focus.</div>}
          {ranked.map(({ scout, currentLabel }, i) => {
            const isBest = i === 0 && focusFit(scout, focus) >= best && (focus.nation ? scout.specialtyNation === focus.nation : true)
            return (
              <button
                key={scout.scoutId}
                type="button"
                className="btn-ghost"
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px' }}
                onClick={() => { onAssign(scout.scoutId); setOpen(false) }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {scout.specialtyNation && <FlagIcon nationality={scout.specialtyNation} size={12} />}
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{scout.name}</span>
                  <span className="muted small">({scout.rating})</span>
                  {isBest && <span className="chip" style={{ fontSize: 9, background: 'rgba(52,211,153,0.18)', border: '1px solid var(--success)', color: 'var(--success)', marginLeft: 'auto' }}>Best fit</span>}
                </div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {scout.specialtyNation ? `${scout.specialtyNation} specialist` : 'Generalist'} · currently: {currentLabel}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </span>
  )
}

const FOCUS_BAND_LABEL: Record<ScoutFocus, string> = { youth: 'U23', senior: 'Senior', all: 'All ages' }

function FocusCard({ focus, assigned, candidates, onAssign }: {
  focus: FocusDef
  assigned: ScoutCardView[]
  candidates: Array<{ scout: ScoutCardView; currentLabel: string }>
  onAssign: (scoutId: string, focus: FocusDef) => void
}): JSX.Element {
  const coverage = assigned.reduce((s, c) => s + c.coverage, 0)
  return (
    <div className="panel" style={{ background: 'var(--bg2)', padding: 'var(--sp-3)' }}>
      <div className="row-between" style={{ alignItems: 'flex-start', gap: 'var(--sp-3)' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 16 }}>{focus.icon}</span>
            {focus.nation && <FlagIcon nationality={focus.nation} size={14} />}
            {focus.label}
            <span className="chip" style={{ fontSize: 9 }}>{FOCUS_BAND_LABEL[focus.band]}</span>
          </div>
          <div className="muted small" style={{ marginTop: 2 }}>{focus.desc}</div>
        </div>
        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: assigned.length ? 'var(--accent, #f5b301)' : 'var(--muted)' }}>{assigned.length}</div>
          <div className="muted small">{assigned.length === 1 ? 'scout' : 'scouts'}{coverage > 0 ? ` · ~${coverage}` : ''}</div>
        </div>
      </div>

      {assigned.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 'var(--sp-2)' }}>
          {assigned.map((s) => (
            <span key={s.scoutId} className="chip" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {s.specialtyNation && <FlagIcon nationality={s.specialtyNation} size={11} />}
              <ScoutLink scoutId={s.scoutId} name={s.name} />
              <span className="muted">({s.rating})</span>
            </span>
          ))}
        </div>
      )}

      <div style={{ marginTop: 'var(--sp-2)' }}>
        <AssignScoutPicker focus={focus} candidates={candidates} onAssign={(id) => onAssign(id, focus)} />
      </div>
    </div>
  )
}

function RecruitmentFocusTab({ data, onAssign, onAutoAssign, scoutCardProps }: {
  data: ScoutingView
  onAssign: (scoutId: string, focus: FocusDef) => void
  onAutoAssign: () => void
  scoutCardProps: {
    onAssign: (scoutId: string, target: ScoutTarget, focus: ScoutFocus, positionFilter: PosFilter, minPotentialStars: number) => void
    onFire: (scoutId: string) => void
  }
}): JSX.Element {
  const [advanced, setAdvanced] = useState(false)
  const [extra, setExtra] = useState<FocusDef[]>([])
  const [adding, setAdding] = useState(false)

  // Canonical objectives — always offered even with zero scouts on them.
  const canonical: FocusDef[] = [
    ...(data.hasDraftClass ? [{ key: 'draftClass', target: { kind: 'draftClass' as const }, icon: '🏒', label: 'Draft Class', desc: "Scout this year's draft-eligible prospects", band: 'youth' as ScoutFocus }] : []),
    { key: 'nextOpponent', target: { kind: 'nextOpponent' }, icon: '🎯', label: 'Next Opponent', desc: data.nextOpponentName ? `Advance-scout ${data.nextOpponentName}` : 'Advance-scout your next game', band: 'all' },
    { key: 'ownProspects', target: { kind: 'ownProspects' }, icon: '🏠', label: 'Our Players & Prospects', desc: 'Keep internal reads current for lineup & development calls', band: 'all' },
    { key: 'freeAgents', target: { kind: 'freeAgents' }, icon: '💼', label: 'Free Agents', desc: 'Track available UFAs/RFAs on the market', band: 'senior' },
  ]

  // Derive a focus for any scout on a nation/league/team not already listed.
  const derived: FocusDef[] = []
  for (const s of data.scouts) {
    const key = focusKey(s.target)
    if (canonical.some((f) => f.key === key) || extra.some((f) => f.key === key) || derived.some((f) => f.key === key)) continue
    if (s.target.kind === 'nation' || s.target.kind === 'competition' || s.target.kind === 'team' || s.target.kind === 'division' || s.target.kind === 'player') {
      derived.push({
        key, target: s.target,
        icon: s.target.kind === 'nation' ? '🌍' : s.target.kind === 'player' ? '👤' : '🏆',
        label: s.assignmentLabel, desc: `Deep coverage — ${s.assignmentLabel}`,
        ...(s.focusNation ? { nation: s.focusNation } : {}), band: s.focus,
      })
    }
  }

  const focuses = [...canonical, ...derived, ...extra]
  const assignedFor = (f: FocusDef): ScoutCardView[] => data.scouts.filter((s) => focusKey(s.target) === f.key)
  const candidatesFor = (f: FocusDef): Array<{ scout: ScoutCardView; currentLabel: string }> =>
    data.scouts.filter((s) => focusKey(s.target) !== f.key).map((s) => ({ scout: s, currentLabel: s.assignmentLabel }))

  // "New focus" — add a nation or league objective, then assign scouts to it.
  const addFocus = (target: ScoutTarget, nation: string | undefined, label: string): void => {
    const key = focusKey(target)
    if (!focuses.some((f) => f.key === key)) {
      setExtra((prev) => [...prev, { key, target, icon: target.kind === 'nation' ? '🌍' : '🏆', label, desc: `Deep coverage — ${label}`, ...(nation ? { nation } : {}), band: 'all' }])
    }
    setAdding(false)
  }

  const idle = data.scouts.length - data.activeScouts

  return (
    <div className="stack">
      <Panel title={`Recruitment Focus — ${data.scouts.length} scout${data.scouts.length === 1 ? '' : 's'} (${data.maxScouts} cap)`}>
        <div className="row-between" style={{ marginTop: -4, marginBottom: 10, gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
          <p className="muted small" style={{ margin: 0, flex: 1 }}>
            Pick an objective and drop well-fitting scouts on it — no need to micromanage each one.
            The <b>Chief Scout</b> can deploy the whole department for you.{idle > 0 ? ` ${idle} scout${idle === 1 ? '' : 's'} idle.` : ''} Hire more under Staff → Job Market.
          </p>
          <button
            className="btn btn-sm"
            style={{ whiteSpace: 'nowrap' }}
            onClick={onAutoAssign}
            title="Chief Scout auto-assigns every scout: specialists to their region, the rest across the draft class, free agents, next opponent and your own prospects"
          >
            ⚙ Chief Scout: auto-assign all
          </button>
        </div>

        <div className="grid grid-2" style={{ gap: 'var(--sp-3)' }}>
          {focuses.map((f) => (
            <FocusCard key={f.key} focus={f} assigned={assignedFor(f)} candidates={candidatesFor(f)} onAssign={onAssign} />
          ))}
        </div>

        {/* New focus: target a specific nation / league */}
        <div style={{ marginTop: 'var(--sp-3)', paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--line)' }}>
          {adding ? (
            <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="small muted">Target a region or league:</span>
              <div style={{ minWidth: 240 }}>
                <NewFocusDropdown data={data} onPick={addFocus} />
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>＋ New focus (region / league)</button>
          )}
        </div>
      </Panel>

      {/* Advanced: per-scout briefs (position/min-star/age fine-tuning) */}
      <Panel title="Advanced — per-scout briefs">
        <div className="row-between" style={{ marginTop: -4, marginBottom: advanced ? 10 : 0, alignItems: 'center' }}>
          <p className="muted small" style={{ margin: 0 }}>Fine-tune an individual scout's age band, position brief and minimum potential to flag.</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdvanced((a) => !a)}>{advanced ? 'Hide' : 'Show'}</button>
        </div>
        {advanced && (
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            {data.scouts.map((scout) => (
              <ScoutCard
                key={scout.scoutId}
                scout={scout}
                view={data}
                canFire={data.scouts.length > 1}
                defaultExpanded
                onAssign={(id, target, focus, pos, minPot) => scoutCardProps.onAssign(id, target, focus, pos, minPot)}
                onFire={(id) => scoutCardProps.onFire(id)}
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

/** Compact region/league selector for creating a new focus. */
function NewFocusDropdown({ data, onPick }: {
  data: ScoutingView
  onPick: (target: ScoutTarget, nation: string | undefined, label: string) => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const match = (label: string): boolean => q === '' || label.toLowerCase().includes(q)
  const nations = data.nations.filter((n) => match(n.label))
  const competitions = data.competitions.filter((c) => match(c.label))
  return (
    <div style={{ position: 'relative', background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: 6, maxHeight: 300, overflowY: 'auto', minWidth: 240 }}>
      <input
        autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter regions & leagues…"
        style={{ position: 'sticky', top: 0, width: '100%', boxSizing: 'border-box', padding: '7px 10px', background: 'var(--bg0)', border: 'none', borderBottom: '1px solid var(--line)', color: 'var(--text)', fontSize: 12 }}
      />
      {nations.length > 0 && <div className="muted small" style={{ padding: '6px 10px 2px', fontWeight: 700 }}>REGIONS</div>}
      {nations.map((n) => (
        <button key={`n-${n.id}`} type="button" className="btn-ghost" style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 13 }}
          onClick={() => onPick({ kind: 'nation', nation: n.id }, n.id, n.label)}>{n.label}</button>
      ))}
      {competitions.length > 0 && <div className="muted small" style={{ padding: '6px 10px 2px', fontWeight: 700 }}>LEAGUES</div>}
      {competitions.map((c) => (
        <button key={`c-${c.id}`} type="button" className="btn-ghost" style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 13 }}
          onClick={() => onPick({ kind: 'competition', competitionId: c.id }, undefined, c.label)}>{c.label}</button>
      ))}
      {nations.length + competitions.length === 0 && <div className="muted small" style={{ padding: '8px 12px' }}>No match.</div>}
    </div>
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

  const handleAssign = async (scoutId: string, target: ScoutTarget, focus: ScoutFocus, positionFilter: PosFilter, minPotentialStars: number): Promise<void> => {
    try {
      const res = await client.assignScout(scoutId, target, focus, positionFilter, minPotentialStars)
      if (res.type === 'error') { toast(res.message, 'error') } else { bumpRefresh(); refetch() }
    } catch (e) {
      toast(`Scout assignment failed: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  }
  const handleAutoAssign = async (): Promise<void> => {
    try {
      const res = await client.autoAssignScouts()
      if (res.type === 'error') { toast(res.message, 'error') } else { toast('Chief Scout deployed the department.', 'success'); bumpRefresh(); refetch() }
    } catch (e) {
      toast(`Auto-assign failed: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
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

      {data && tab === 'centre' && (
        <ScoutingCentreTab
          finds={data.recommendations}
          rosterNeeds={data.rosterNeeds}
          onTriage={async (action, playerId) => {
            const res = await (
              action === 'shortlist' ? client.shortlistProspect(playerId)
              : action === 'unshortlist' ? client.unshortlistProspect(playerId)
              : action === 'pass' ? client.dismissProspect(playerId)
              : client.rescoutProspect(playerId)
            )
            if (res.type === 'error') { toast(res.message, 'error') } else {
              if (action === 'rescout') toast('Sent a scout back for a closer look.', 'success')
              bumpRefresh(); refetch()
            }
          }}
        />
      )}

      {data && tab === 'players' && (
        <ScoutedTable rows={data.scoutedPlayers} scouts={data.scouts} onScoutPlayer={(sid, pid) => { void handleScoutPlayer(sid, pid) }} />
      )}

      {data && tab === 'focus' && (
        <RecruitmentFocusTab
          data={data}
          onAssign={(scoutId, focus) => { void handleAssign(scoutId, focus.target, focus.band, 'any', 0) }}
          onAutoAssign={() => { void handleAutoAssign() }}
          scoutCardProps={{
            onAssign: (id, target, focus, pos, minPot) => { void handleAssign(id, target, focus, pos, minPot) },
            onFire: (id) => { void handleFire(id) },
          }}
        />
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
