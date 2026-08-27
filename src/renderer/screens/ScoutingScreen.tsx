/**
 * Scouting hub — FM-style scout deployment.
 *
 * Each scout gets a SCOPE (a nation/region, a league, the next opponent, the
 * draft class or free agents) and a FOCUS (youth / senior / all). Coverage is
 * reported by nation and by league (with a youth split), and a job market lets
 * the GM hire and release scouts.
 */
import { useEffect, useRef, useState } from 'react'
import type { ScoutingView, WorkerResponse } from '../../worker/protocol'
import type {
  ScoutCardView, ScoutCoverageRow, ScoutFindView, ScoutingBriefingView,
  PlayerSearchQuery, PlayerSearchView, PlayerReadBand,
} from '../../engine/career/views'
import type { ScoutTarget, ScoutFocus } from '@domain/scouting'
import { PlayerLink, useNav } from '../components/NavContext'
import { PlayerFace } from '../components/PlayerFace'
import { fmtDate, fmtMoney } from '../components/format'
import { FlagIcon } from '../components/FlagIcon'
import { ScoutGlobe, type GlobeNation } from '../components/ScoutGlobe'
import { Icon } from '../components/primitives'
import { Icons } from '../components/icons'
import type { LucideIcon } from 'lucide-react'
import { Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'
import { toast } from '../components/store'
import { bumpRefresh, useUiStore } from '../components/store'

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
        <p className="muted small">Your scouts have not filed from anywhere yet — assign them and coverage builds week by week.</p>
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

/* ── shared bits ───────────────────────────────────────────────────────────── */

const REC_COLOR: Record<'A+' | 'A' | 'B' | 'C' | 'D', string> = {
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
      <HeaderCard
        label="Nations Covered"
        value={`${data.scoutedNations.length}`}
        sub={data.scoutedNations.slice(0, 3).join(', ') || 'no brief reaches a league yet'}
      />
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

/** Fog-aware star cell: a dash where the department has no read to give. */
function ReadStars({ value, accent }: { value: number | null; accent?: boolean }): JSX.Element {
  if (value === null) {
    return <span className="muted" style={{ fontSize: 11 }} title="Your scouts have not seen enough of him to hold an opinion">—</span>
  }
  return (
    <span style={{ color: accent ? 'var(--accent, #f5b301)' : 'var(--muted)', letterSpacing: 1, fontSize: 12 }}>
      {stars5(value) || '–'}
    </span>
  )
}

/**
 * The GM's own watch list. It starts EMPTY — the whole point of C1 — so the
 * empty state has to teach the mechanic rather than apologise for the absence.
 */
function WatchListPanel({ data, onUnwatch, onNote }: {
  data: ScoutingView
  onUnwatch: (playerId: string) => void
  onNote: (playerId: string, note: string) => void
}): JSX.Element {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const rows = data.watchList
  return (
    <Panel title={`Watch List${rows.length ? ` (${rows.length}/${data.watchCap})` : ''}`}>
      {rows.length === 0 ? (
        <div className="muted" style={{ padding: '18px 8px', lineHeight: 1.65, maxWidth: 720 }}>
          <div style={{ marginBottom: 6 }}><Icon size={24} color="var(--muted)"><Icons.Milestone /></Icon></div>
          <div style={{ color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}>Nobody on it yet — and that is the point.</div>
          Right-click any player in the game and choose <b>Watch this player</b>, or hit
          <b> ☆ Watch</b> on his profile. A pin is an instruction, not a bookmark: your scouts
          give watched players the front of their day whatever their brief says, and a watched
          man's file never goes stale. That bandwidth comes out of your regional coverage, so
          pin the names you actually intend to act on.
        </div>
      ) : (
        <>
          <p className="muted small" style={{ marginTop: -4, marginBottom: 8 }}>
            Your scouts prioritise these names over their standing brief, and their files never decay.
            Least-known first — the top of this list is the work still to do.
          </p>
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Player</th><th className="num">Pos</th><th className="num">Age</th><th>Club</th>
                  <th>Current</th><th>Potential</th><th style={{ width: 140 }}>Read</th>
                  <th>Watching since</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.playerId}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        {r.nationality && <FlagIcon nationality={r.nationality} size={15} />}
                        <PlayerLink playerId={r.playerId} name={r.name} />
                        {r.draftLabel && <span className="chip" style={{ fontSize: 9 }}>{r.draftLabel}</span>}
                      </span>
                      <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.35 }}>
                        {r.progressNote}
                        {r.scoutNames.length > 0 && <> · seen by {r.scoutNames.join(', ')}</>}
                      </div>
                      {editing === r.playerId ? (
                        <div className="row" style={{ gap: 4, marginTop: 4 }}>
                          <input
                            autoFocus className="input" value={draft} onChange={(e) => setDraft(e.target.value)}
                            placeholder="Your note on him…"
                            style={{ fontSize: 11, padding: '3px 6px', flex: 1, background: 'var(--bg0)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 4 }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { onNote(r.playerId, draft); setEditing(null) } }}
                          />
                          <button className="btn btn-sm" onClick={() => { onNote(r.playerId, draft); setEditing(null) }}>Save</button>
                        </div>
                      ) : (
                        <div style={{ fontSize: 10.5, marginTop: 2 }}>
                          <a className="link" style={{ cursor: 'pointer' }} onClick={() => { setEditing(r.playerId); setDraft(r.note ?? '') }}>
                            {r.note ? `“${r.note}”` : '+ add a note'}
                          </a>
                        </div>
                      )}
                    </td>
                    <td className="num muted">{r.position}</td>
                    <td className="num muted">{r.age}</td>
                    <td className="muted small">{r.teamAbbr}</td>
                    <td><ReadStars value={r.currentStars} /></td>
                    <td><ReadStars value={r.potentialStars} accent /></td>
                    <td>
                      <KnowledgeBar value={r.knowledge} small />
                      {r.knowledge !== r.knowledgeAtAdd && (
                        <div className="muted" style={{ fontSize: 10 }}>was {r.knowledgeAtAdd}%</div>
                      )}
                    </td>
                    <td className="muted small">{fmtDate(r.addedDate)}</td>
                    <td className="num">
                      <button className="btn btn-ghost btn-sm" title="Stop watching" onClick={() => onUnwatch(r.playerId)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  )
}

function OverviewTab({ data, onUnwatch, onNote }: {
  data: ScoutingView
  onUnwatch: (playerId: string) => void
  onNote: (playerId: string, note: string) => void
}): JSX.Element {
  return (
    <div className="stack">
      <HeaderStrip data={data} />
      <WatchListPanel data={data} onUnwatch={onUnwatch} onNote={onNote} />
      <ScoutAssignmentList scouts={data.scouts} />
    </div>
  )
}

/** Every nation the globe should mark — covered ones AND the blind spots, which
 *  are just as much a fact about your department as the coverage is. */
function buildGlobeNations(data: ScoutingView): GlobeNation[] {
  const out: GlobeNation[] = data.nationCoverage.map((c) => ({
    nation: c.nation ?? c.label,
    knowledge: c.avgKnowledge,
    covered: c.scoutNames.length > 0 || data.scoutedNations.includes(c.nation ?? c.label),
    playerCount: c.playerCount,
    youthCount: c.youthCount,
    scoutNames: c.scoutNames,
  }))
  // North America is carried by the NHL/AHL/CHL rows rather than a nation row.
  const na = data.leagueCoverage.filter((r) => !r.nation || r.nation === 'North America')
  if (na.length && !out.some((o) => o.nation === 'North America')) {
    const players = na.reduce((s, r) => s + r.playerCount, 0)
    const youth = na.reduce((s, r) => s + r.youthCount, 0)
    const know = players ? Math.round(na.reduce((s, r) => s + r.avgKnowledge * r.playerCount, 0) / players) : 0
    out.push({
      nation: 'North America', knowledge: know, covered: na.some((r) => r.scoutNames.length > 0),
      playerCount: players, youthCount: youth,
      scoutNames: [...new Set(na.flatMap((r) => r.scoutNames))],
    })
  }
  for (const n of data.scoutedNations) {
    if (!out.some((m) => m.nation === n)) {
      out.push({ nation: n, knowledge: 0, covered: true, playerCount: 0, youthCount: 0, scoutNames: [] })
    }
  }
  return out
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
      {find.fitNotes && find.fitNotes.length > 0 && (
        <div className="small" style={{ display: 'flex', gap: 6, lineHeight: 1.45 }}>
          <span style={{ color: FIT_TONE_COLOR[find.fitNotes[0]!.tone], fontSize: 9, paddingTop: 2 }}>{FIT_TONE_MARK[find.fitNotes[0]!.tone]}</span>
          <span className="muted">{find.fitNotes[0]!.text}</span>
        </div>
      )}
      <div className="muted small" style={{ borderTop: '1px solid var(--line)', paddingTop: 6, display: 'flex', justifyContent: 'space-between' }}>
        <span>Flagged by {find.scoutName}</span><span>{find.foundDate}</span>
      </div>
    </div>
  )
}

type TriageAction = 'shortlist' | 'unshortlist' | 'pass' | 'rescout'

const FIT_TONE_COLOR: Record<'plus' | 'minus' | 'note', string> = {
  plus: 'var(--success)',
  minus: 'var(--amber, #f59e0b)',
  note: 'var(--muted)',
}
const FIT_TONE_MARK: Record<'plus' | 'minus' | 'note', string> = { plus: '▲', minus: '▼', note: '◆' }

/** The scout's WHY — his standout pros/cons behind the letter grade (#17). */
function ProsConsBlock({ find }: { find: ScoutFindView }): JSX.Element | null {
  const pros = find.pros ?? []
  const cons = find.cons ?? []
  if (pros.length === 0 && cons.length === 0) return null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: cons.length > 0 ? '1fr 1fr' : '1fr', gap: 'var(--sp-3)', margin: '8px 0 2px' }}>
      <div>
        {pros.map((s, i) => (
          <div key={i} className="small" style={{ display: 'flex', gap: 6, marginBottom: 3, lineHeight: 1.45 }}>
            <span style={{ color: 'var(--success)', fontWeight: 700 }}>+</span><span>{s}</span>
          </div>
        ))}
      </div>
      {cons.length > 0 && (
        <div>
          {cons.map((s, i) => (
            <div key={i} className="small" style={{ display: 'flex', gap: 6, marginBottom: 3, lineHeight: 1.45 }}>
              <span style={{ color: 'var(--danger, #d8584f)', fontWeight: 700 }}>−</span><span>{s}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Squad-weighted verdict lines — would he actually play HERE? (#17) */
function FitNotesBlock({ find }: { find: ScoutFindView }): JSX.Element | null {
  const notes = find.fitNotes ?? []
  if (notes.length === 0) return null
  return (
    <div style={{ borderTop: '1px dashed var(--line)', marginTop: 6, paddingTop: 6 }}>
      <div className="muted" style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 3 }}>Fit with our squad</div>
      {notes.map((n, i) => (
        <div key={i} className="small" style={{ display: 'flex', gap: 6, marginBottom: 3, lineHeight: 1.45 }}>
          <span style={{ color: FIT_TONE_COLOR[n.tone], fontSize: 9, paddingTop: 2 }}>{FIT_TONE_MARK[n.tone]}</span>
          <span>{n.text}</span>
        </div>
      ))}
    </div>
  )
}

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
          <div style={{ fontWeight: 900, fontSize: 30, color, lineHeight: 1 }} title={`The scout's grade — his reasons are spelled out below`}>{f.grade}</div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-5)', margin: '10px 0' }}>
          <div><div className="muted" style={{ fontSize: 10 }}>CURRENT</div><div style={{ color: 'var(--muted)', letterSpacing: 1 }}>{stars5(f.currentStars) || '–'}</div></div>
          <div><div className="muted" style={{ fontSize: 10 }}>POTENTIAL</div><div style={{ color: 'var(--accent, #f5b301)', letterSpacing: 1 }}>{stars5(f.potentialStars) || '–'}</div></div>
          <div><div className="muted" style={{ fontSize: 10 }}>KNOWLEDGE</div><div style={{ fontWeight: 700 }}>{f.knowledge}%</div></div>
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{f.reason}</div>
        <ProsConsBlock find={f} />
        <FitNotesBlock find={f} />
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
/* ── the department briefing (C2) ──────────────────────────────────────────── */

function DeltaChip({ value }: { value: number }): JSX.Element | null {
  if (!value) return null
  const up = value > 0
  return (
    <span style={{ color: up ? 'var(--success)' : 'var(--danger, #d8584f)', fontSize: 10.5, fontWeight: 700, marginLeft: 5 }}>
      {up ? '▲' : '▼'}{Math.abs(value).toFixed(1)}
    </span>
  )
}

function CoveragePct({ value }: { value: number }): JSX.Element {
  const color = value >= 60 ? 'var(--success)' : value >= 30 ? 'var(--accent, #f5b301)' : 'var(--danger, #d8584f)'
  return <span style={{ color, fontWeight: 700, fontSize: 12 }}>{value}%</span>
}

/**
 * What the department actually knows, and what it doesn't. The Centre used to
 * open with one line about roster needs; this is the briefing a chief scout owes
 * his GM — bandwidth, class coverage, the beats that are covered, the pools that
 * are not, the prospects his own staff are arguing about, and what moved since
 * the last month-start.
 */
function DepartmentBriefing({ b, rosterNeeds }: { b: ScoutingBriefingView; rosterNeeds: string[] }): JSX.Element {
  const nav = useNav()
  return (
    <Panel title="Department Briefing">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-4)', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 340px', minWidth: 300 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{b.headline}</div>
          <div className="muted small" style={{ lineHeight: 1.5 }}>{b.strain}</div>

          <div style={{ marginTop: 'var(--sp-3)' }}>
            <div className="muted" style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 3 }}>Draft class coverage</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, height: 7, background: 'var(--bg0)', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--line)' }}>
                <div style={{
                  width: `${Math.max(1, b.classCoverage.pct)}%`, height: '100%',
                  background: b.classCoverage.pct >= 45 ? 'var(--success)' : b.classCoverage.pct >= 15 ? 'var(--accent, #f5b301)' : 'var(--danger, #d8584f)',
                }} />
              </div>
              <CoveragePct value={b.classCoverage.pct} />
            </div>
            <div className="muted small" style={{ marginTop: 4, lineHeight: 1.5 }}>{b.classCoverage.line}</div>
          </div>

          {rosterNeeds.length > 0 && (
            <div className="muted small" style={{ marginTop: 'var(--sp-3)', lineHeight: 1.5 }}>
              Your roster is thin at <b style={{ color: 'var(--success)' }}>{rosterNeeds.join(', ')}</b> — need-fillers float to the top of the queue below.
            </div>
          )}

          <div style={{ marginTop: 'var(--sp-3)' }}>
            <div className="muted" style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 }}>By position, this class</div>
            <table className="table" style={{ fontSize: 11 }}>
              <tbody>
                {b.needCoverage.map((n) => (
                  <tr key={n.group}>
                    <td style={{ fontWeight: n.need ? 700 : 400, color: n.need ? 'var(--accent, #f5b301)' : undefined }}>
                      {n.group}{n.need && ' ●'}
                    </td>
                    <td className="num muted">{n.tracked} scouted</td>
                    <td className="muted" style={{ fontSize: 10.5 }}>{n.line}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ flex: '1 1 300px', minWidth: 280 }}>
          <div className="muted" style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 }}>Where your eyes are</div>
          {b.covering.length === 0 ? (
            <div className="muted small">
              No league in the database has a single player in it your department could look at.
            </div>
          ) : (
            <table className="table" style={{ fontSize: 11 }}>
              <tbody>
                {b.covering.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.label}
                      <div className="muted" style={{ fontSize: 10 }}>
                        {c.scoutNames.length ? c.scoutNames.join(', ') : 'passive knowledge only'}
                      </div>
                    </td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      <CoveragePct value={c.knowledge} /><DeltaChip value={c.delta} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="muted" style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', margin: '14px 0 4px' }}>Blind spots</div>
          {b.blindSpots.length === 0 ? (
            <div className="muted small">
              No sizeable youth pool is going completely unwatched — either your briefs reach them all,
              or this database has no feeder leagues to watch.
            </div>
          ) : (
            <table className="table" style={{ fontSize: 11 }}>
              <tbody>
                {b.blindSpots.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        {c.nation && <FlagIcon nationality={c.nation} size={12} />}{c.label}
                      </span>
                      <div className="muted" style={{ fontSize: 10 }}>{c.playerCount.toLocaleString()} players, nobody assigned</div>
                    </td>
                    <td className="num"><CoveragePct value={c.knowledge} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ flex: '1 1 300px', minWidth: 280 }}>
          <div className="muted" style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 }}>
            Since {b.since ? b.since : 'last month'}
          </div>
          {b.changes.length === 0 ? (
            <div className="muted small">
              {b.since ? 'Nothing has moved. A department with nobody deployed produces a very quiet report.' : 'No month-start snapshot yet — the first one files at the turn of the month.'}
            </div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, lineHeight: 1.65 }}>
              {b.changes.map((c, i) => (
                <li key={i} style={{ color: (c.delta ?? 0) < 0 ? 'var(--danger, #d8584f)' : 'var(--text)' }}>{c.text}</li>
              ))}
            </ul>
          )}

          <div className="muted" style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', margin: '14px 0 4px' }}>The room disagrees</div>
          {b.disagreements.length === 0 ? (
            <div className="muted small">
              Your scouts are lined up on everyone they have seen — which mostly means they have not seen enough different players yet.
            </div>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {b.disagreements.map((d) => (
                <div key={d.playerId} style={{ padding: '6px 8px', background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>
                    <a className="link" style={{ cursor: 'pointer' }} onClick={() => nav.navigate('player', { playerId: d.playerId })}>{d.name}</a>
                    <span className="muted" style={{ fontWeight: 400 }}> · {d.position} · {d.age} · {d.teamAbbr}</span>
                    <span className="chip" style={{ fontSize: 9, marginLeft: 6 }}>{d.spread} spots apart</span>
                  </div>
                  <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.45 }}>{d.line}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Panel>
  )
}

function ScoutingCentreTab({ finds, rosterNeeds, briefing, dismissedCount, onTriage }: {
  finds: ScoutFindView[]
  rosterNeeds: string[]
  briefing: ScoutingBriefingView
  /** All-time count of prospects the GM has passed on (for the end-of-board tally). */
  dismissedCount: number
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

  // The stack ENDS (#17): skipping past the last card reaches a close-out state
  // instead of clamping back onto the final report forever.
  const current = idx < queue.length ? queue[idx] : undefined

  const act = (action: TriageAction, pid: string): void => {
    void onTriage(action, pid)
    // Track/Pass remove the card from the queue, so the same index shows the next
    // one; a re-scout keeps him in the queue, so step forward to move on.
    if (action === 'rescout') setIdx((i) => i + 1)
  }

  const reviewedTally = (
    <>
      <b>{shortlist.length}</b> on your shortlist, <b>{dismissedCount}</b> passed on
    </>
  )

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <DepartmentBriefing b={briefing} rosterNeeds={rosterNeeds} />
      <Panel title="Scouting Centre">
        {finds.length === 0 ? (
          <div className="muted" style={{ padding: '24px 8px', textAlign: 'center', lineHeight: 1.6 }}>
            <div style={{ marginBottom: 6 }}><Icon size={24} color="var(--muted)"><Icons.Scouting /></Icon></div>
            Your scouts haven't surfaced anyone yet. Point them at youth leagues and the
            draft class under <b>Recruitment Focus</b> — their finds arrive here (and in
            a weekly digest in your inbox).
          </div>
        ) : !current ? (
          <div className="muted" style={{ padding: '24px 8px', textAlign: 'center', lineHeight: 1.6 }}>
            <div style={{ marginBottom: 6 }}><Icon size={24} color="var(--green)"><Icons.Check /></Icon></div>
            <div style={{ color: 'var(--text)', fontWeight: 600, marginBottom: 2 }}>
              That's the board reviewed — {reviewedTally}.
            </div>
            {queue.length > 0 ? (
              <>
                You skipped <b>{queue.length}</b> report{queue.length === 1 ? '' : 's'} without a call.{' '}
                <button className="btn btn-ghost btn-sm" onClick={() => setIdx(0)}>Go through them again</button>
              </>
            ) : (
              <>New finds will appear here as your scouts get to know them.</>
            )}
          </div>
        ) : (
          <>
            {/* Progress + position filter */}
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
              <span className="muted small">Report <b>{idx + 1}</b> of <b>{queue.length}</b> awaiting your call</span>
              <div className="row" style={{ gap: 4 }}>
                {(['ALL', 'F', 'D', 'G'] as const).map((p) => (
                  <button key={p} className={`chip${posFilter === p ? ' chip-accent' : ''}`} style={{ cursor: 'pointer', border: 'none', fontSize: 11 }} onClick={() => { setPosFilter(p); setIdx(0) }}>{p}</button>
                ))}
              </div>
            </div>

            <ReportCard find={current} />

            {/* Triage actions */}
            <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 'var(--sp-3)' }}>
              <button
                className="btn btn-primary"
                title="Puts him on your watch list — his file stops decaying and your scouts prioritise him"
                onClick={() => act('shortlist', current.playerId)}
              >★ Track him</button>
              <button className="btn" onClick={() => act('rescout', current.playerId)} title="Send your best-fit scout back for a deeper read" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon size={14}><Icons.Scouting /></Icon> Take another look</button>
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
            Nobody tracked yet. Hit <b>★ Track him</b> on a report to pin a prospect here — and onto
            your watch list, where your scouts will keep going back to him.
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

/* ── Players: the whole-database search (C3) ───────────────────────────────── */

const POS_CHIPS: Array<{ key: string; label: string }> = [
  { key: 'C', label: 'C' }, { key: 'LW', label: 'LW' }, { key: 'RW', label: 'RW' },
  { key: 'D', label: 'D' }, { key: 'G', label: 'G' },
]
const CONTRACT_CHIPS: Array<{ key: 'signed' | 'expiring' | 'freeAgent' | 'unsigned'; label: string }> = [
  { key: 'signed', label: 'Under contract' },
  { key: 'expiring', label: 'Expiring' },
  { key: 'freeAgent', label: 'Free agent' },
  { key: 'unsigned', label: 'Unsigned junior' },
]
const SORTS: Array<{ key: NonNullable<PlayerSearchQuery['sort']>; label: string }> = [
  { key: 'potential', label: 'Potential (our read)' },
  { key: 'current', label: 'Current ability' },
  { key: 'points', label: 'Points this season' },
  { key: 'knowledge', label: 'How well we know him' },
  { key: 'age', label: 'Age' },
  { key: 'salary', label: 'Salary' },
  { key: 'name', label: 'Name' },
]

const READ_COLOR: Record<PlayerReadBand, string> = {
  exact: 'var(--success)',
  strong: 'var(--success)',
  partial: 'var(--accent, #f5b301)',
  glimpse: 'var(--amber, #f59e0b)',
  unscouted: 'var(--muted)',
}

function Chip({ on, label, onClick, title }: { on: boolean; label: string; onClick: () => void; title?: string }): JSX.Element {
  return (
    <button type="button" title={title} className={`chip${on ? ' chip-accent' : ''}`}
      style={{ cursor: 'pointer', border: 'none', fontSize: 11 }} onClick={onClick}>{label}</button>
  )
}

function NumField({ label, value, onChange, width = 62, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; width?: number; placeholder?: string
}): JSX.Element {
  return (
    <label className="small muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {label}
      <input
        value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode="numeric"
        style={{ width, padding: '3px 6px', fontSize: 12, background: 'var(--bg0)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 4 }}
      />
    </label>
  )
}

/**
 * The Players tab. Previously a pre-answered "Acquisition Targets" list sorted by
 * value; now a query tool over the whole database that obeys the fog — an
 * unscouted player shows a dash where his grades would be, and the footer says
 * out loud how much of the result set you are actually able to judge.
 */
function PlayerSearchTab({ scouts, onToggleWatch, onScoutPlayer }: {
  scouts: ScoutCardView[]
  onToggleWatch: (playerId: string) => void
  onScoutPlayer: (scoutId: string, playerId: string) => void
}): JSX.Element {
  const client = useClient()
  const [text, setText] = useState('')
  const [positions, setPositions] = useState<string[]>([])
  const [contracts, setContracts] = useState<Array<'signed' | 'expiring' | 'freeAgent' | 'unsigned'>>([])
  const [ageMin, setAgeMin] = useState('')
  const [ageMax, setAgeMax] = useState('')
  const [maxSalary, setMaxSalary] = useState('')
  const [minPot, setMinPot] = useState('')
  const [minCur, setMinCur] = useState('')
  const [nation, setNation] = useState('')
  const [league, setLeague] = useState('')
  const [hand, setHand] = useState('')
  const [scoutedOnly, setScoutedOnly] = useState(false)
  const [watchedOnly, setWatchedOnly] = useState(false)
  const [draftOnly, setDraftOnly] = useState(false)
  const [excludeOwn, setExcludeOwn] = useState(true)
  const [sort, setSort] = useState<NonNullable<PlayerSearchQuery['sort']>>('potential')
  const [desc, setDesc] = useState(true)
  const [page, setPage] = useState(0)
  const [view, setView] = useState<PlayerSearchView | null>(null)
  const [busy, setBusy] = useState(false)
  const version = useUiStore((s) => s.version)

  const num = (v: string): number | undefined => {
    const n = Number(v.replace(/[^0-9.]/g, ''))
    return v.trim() === '' || Number.isNaN(n) ? undefined : n
  }
  const query: PlayerSearchQuery = {
    ...(text.trim() ? { text: text.trim() } : {}),
    ...(positions.length ? { positions } : {}),
    ...(contracts.length ? { contracts } : {}),
    ...(num(ageMin) !== undefined ? { ageMin: num(ageMin)! } : {}),
    ...(num(ageMax) !== undefined ? { ageMax: num(ageMax)! } : {}),
    ...(num(maxSalary) !== undefined ? { maxSalary: num(maxSalary)! * 1_000_000 } : {}),
    ...(num(minPot) !== undefined ? { minPotentialStars: num(minPot)! } : {}),
    ...(num(minCur) !== undefined ? { minCurrentStars: num(minCur)! } : {}),
    ...(nation ? { nations: [nation] } : {}),
    ...(league ? { leagueIds: [league] } : {}),
    ...(hand ? { handedness: hand } : {}),
    ...(scoutedOnly ? { scoutedOnly: true } : {}),
    ...(watchedOnly ? { watchedOnly: true } : {}),
    ...(draftOnly ? { draftEligibleOnly: true } : {}),
    ...(excludeOwn ? { excludeOwn: true } : {}),
    sort, desc, offset: page * 60, limit: 60,
  }
  // The serialized query IS the dependency — every filter feeds into it, so one
  // string covers all sixteen controls without a dependency list that lies.
  // `version` is the global refresh bus: pinning a player has to re-run the search.
  const key = JSON.stringify(query) + `|${version}`
  const latest = useRef(query)
  latest.current = query

  useEffect(() => {
    let live = true
    setBusy(true)
    // Debounced: the name box fires this on every keystroke, and on an imported
    // 11k-player world each query is a full scan in the worker. 160ms is under
    // the threshold where a filter feels laggy and well over a typing burst.
    const t = setTimeout(() => {
      void client.searchPlayers(latest.current).then((r) => {
        if (!live) return
        if (r.type === 'playerSearch') setView(r.playerSearch)
        setBusy(false)
      })
    }, 160)
    return () => { live = false; clearTimeout(t) }
  }, [key, client])

  const toggle = <T,>(arr: T[], v: T, set: (a: T[]) => void): void => {
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])
    setPage(0)
  }
  const reset = (): void => {
    setText(''); setPositions([]); setContracts([]); setAgeMin(''); setAgeMax('')
    setMaxSalary(''); setMinPot(''); setMinCur(''); setNation(''); setLeague(''); setHand('')
    setScoutedOnly(false); setWatchedOnly(false); setDraftOnly(false); setExcludeOwn(true)
    setSort('potential'); setDesc(true); setPage(0)
  }

  const total = view?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / 60))

  /** A clickable column header — click to sort by it, click again to flip. */
  const SortTh = ({ col, num, children }: {
    col: NonNullable<PlayerSearchQuery['sort']>; num?: boolean; children: React.ReactNode
  }): JSX.Element => (
    <th
      className={`sortable${num ? ' num' : ''}`}
      onClick={() => {
        if (sort === col) setDesc((d) => !d)
        else { setSort(col); setDesc(col !== 'name' && col !== 'age') }
        setPage(0)
      }}
      title={`Sort by ${col}`}
    >
      {children}{sort === col ? (desc ? ' ▼' : ' ▲') : ''}
    </th>
  )

  return (
    <div className="stack">
      <Panel title="Player Search">
        <p className="muted small" style={{ marginTop: -4, marginBottom: 10 }}>
          Every player in the database, on your terms. What you can <i>judge</i> is another matter:
          ability and ceiling are your department&apos;s read, so a player nobody has watched comes
          back as a name, an age and a scoresheet.
        </p>

        {/* Row 1 — name + positions + age */}
        <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--sp-2)' }}>
          <input
            value={text} onChange={(e) => { setText(e.target.value); setPage(0) }} placeholder="Search by name…"
            style={{ minWidth: 210, padding: '5px 9px', fontSize: 12, background: 'var(--bg0)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 4 }}
          />
          <span style={{ width: 1, height: 16, background: 'var(--line)' }} />
          {POS_CHIPS.map((p) => (
            <Chip key={p.key} on={positions.includes(p.key)} label={p.label} onClick={() => toggle(positions, p.key, setPositions)} />
          ))}
          <span style={{ width: 1, height: 16, background: 'var(--line)' }} />
          <NumField label="Age" value={ageMin} onChange={(v) => { setAgeMin(v); setPage(0) }} placeholder="any" width={52} />
          <NumField label="to" value={ageMax} onChange={(v) => { setAgeMax(v); setPage(0) }} placeholder="any" width={52} />
          <label className="small muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Shoots
            <select className="select" value={hand} onChange={(e) => { setHand(e.target.value); setPage(0) }} style={{ fontSize: 12 }}>
              <option value="">Any</option><option value="L">Left</option><option value="R">Right</option>
            </select>
          </label>
        </div>

        {/* Row 2 — league / nation / contract */}
        <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--sp-2)' }}>
          <label className="small muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            League
            <select className="select" value={league} onChange={(e) => { setLeague(e.target.value); setPage(0) }} style={{ fontSize: 12, maxWidth: 150 }}>
              <option value="">Any league</option>
              {(view?.facets.leagues ?? []).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </label>
          <label className="small muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Nation
            <select className="select" value={nation} onChange={(e) => { setNation(e.target.value); setPage(0) }} style={{ fontSize: 12, maxWidth: 150 }}>
              <option value="">Any nation</option>
              {(view?.facets.nations ?? []).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <span style={{ width: 1, height: 16, background: 'var(--line)' }} />
          {CONTRACT_CHIPS.map((c) => (
            <Chip key={c.key} on={contracts.includes(c.key)} label={c.label} onClick={() => toggle(contracts, c.key, setContracts)} />
          ))}
          <NumField label="Cap hit ≤ $M" value={maxSalary} onChange={(v) => { setMaxSalary(v); setPage(0) }} placeholder="any" width={54} />
        </div>

        {/* Row 3 — our-read filters + sort */}
        <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>
          <NumField label="Min potential ★" value={minPot} onChange={(v) => { setMinPot(v); setPage(0) }} placeholder="any" width={46} />
          <NumField label="Min current ★" value={minCur} onChange={(v) => { setMinCur(v); setPage(0) }} placeholder="any" width={46} />
          <Chip on={scoutedOnly} label="Scouted only" title="Hide players we have no real read on" onClick={() => { setScoutedOnly((v) => !v); setPage(0) }} />
          <Chip on={watchedOnly} label="On my watch list" onClick={() => { setWatchedOnly((v) => !v); setPage(0) }} />
          <Chip on={draftOnly} label="Draft eligible" onClick={() => { setDraftOnly((v) => !v); setPage(0) }} />
          <Chip on={excludeOwn} label="Exclude my org" onClick={() => { setExcludeOwn((v) => !v); setPage(0) }} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>Reset</button>
          <label className="small muted" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Sort
            <select className="select" value={sort} onChange={(e) => { setSort(e.target.value as NonNullable<PlayerSearchQuery['sort']>); setPage(0) }} style={{ fontSize: 12 }}>
              {SORTS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDesc((d) => !d); setPage(0) }}>{desc ? '▼ High to low' : '▲ Low to high'}</button>
        </div>
      </Panel>

      <Panel title={`Results${view ? ` — ${total.toLocaleString()} match${total === 1 ? '' : 'es'}` : ''}`}>
        {view && <p className="muted small" style={{ marginTop: -4, marginBottom: 8 }}>{view.fogNote}</p>}
        {busy && !view && <p className="muted small">Searching the database…</p>}
        {view && view.rows.length === 0 && <p className="muted small">Nothing matches. Loosen a filter.</p>}
        {view && view.rows.length > 0 && (
          <>
            <div className="table-wrap" style={{ maxHeight: 520, overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th></th>
                    <SortTh col="name">Player</SortTh>
                    <th className="num">Pos</th>
                    <SortTh col="age" num>Age</SortTh>
                    <th className="num">Sh</th>
                    <th>Club</th><th>Lge</th><th>Contract</th>
                    <SortTh col="salary" num>Cap hit</SortTh>
                    <th className="num" title="Games played this season — public information">GP</th>
                    <th className="num">G</th><th className="num">A</th>
                    <SortTh col="points" num>P</SortTh>
                    <SortTh col="current">Current</SortTh>
                    <SortTh col="potential">Potential</SortTh>
                    <SortTh col="knowledge">Our read</SortTh>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((r) => (
                    <tr key={r.playerId} style={r.watched ? { background: 'rgba(245,179,1,0.06)' } : undefined}>
                      <td className="num">
                        <button
                          className="btn btn-ghost btn-sm" style={{ padding: '0 5px', color: r.watched ? 'var(--accent, #f5b301)' : 'var(--muted)' }}
                          title={r.watched ? 'On your watch list — click to remove' : 'Add to your watch list'}
                          onClick={() => onToggleWatch(r.playerId)}
                        >{r.watched ? '★' : '☆'}</button>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          {r.nationality && <FlagIcon nationality={r.nationality} size={15} />}
                          <PlayerLink playerId={r.playerId} name={r.name} />
                          {r.draftEligible && <span className="chip" style={{ fontSize: 9 }}>Draft</span>}
                        </span>
                      </td>
                      <td className="num muted">{r.position}</td>
                      <td className="num muted">{r.age}</td>
                      <td className="num muted">{r.handedness}</td>
                      <td className="muted small">{r.teamAbbr}</td>
                      <td className="muted small">{r.leagueAbbr ?? '—'}</td>
                      <td className="muted small">{r.contractLabel}</td>
                      <td className="num small">{r.salary > 0 ? fmtMoney(r.salary) : '—'}</td>
                      <td className="num muted small">{r.gp || '—'}</td>
                      <td className="num muted small">{r.gp ? r.goals : '—'}</td>
                      <td className="num muted small">{r.gp ? r.assists : '—'}</td>
                      <td className="num small" style={{ fontWeight: 700 }}>{r.gp ? r.points : '—'}</td>
                      <td><ReadStars value={r.currentStars} /></td>
                      <td><ReadStars value={r.potentialStars} accent /></td>
                      <td className="small" style={{ color: READ_COLOR[r.read] }} title={`${r.knowledge}% knowledge`}>{r.readLabel}</td>
                      <td className="num">
                        {scouts.length > 0 && <ScoutPickerCell playerId={r.playerId} scouts={scouts} onPick={onScoutPlayer} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center', marginTop: 'var(--sp-2)' }}>
              <button type="button" className="btn btn-sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>← Previous</button>
              <span className="muted small">Page {page + 1} of {pages}</span>
              <button type="button" className="btn btn-sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next →</button>
              <span className="muted small" style={{ marginLeft: 'auto' }}>
                ☆ pins him to your watch list · <b>Scout ▾</b> sends a named scout at him · right-click for the full menu.
              </span>
            </div>
          </>
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
  icon: LucideIcon
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
            <Icon size={16}><focus.icon /></Icon>
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
    ...(data.hasDraftClass ? [{ key: 'draftClass', target: { kind: 'draftClass' as const }, icon: Icons.Draft, label: 'Draft Class', desc: "Scout this year's draft-eligible prospects", band: 'youth' as ScoutFocus }] : []),
    { key: 'nextOpponent', target: { kind: 'nextOpponent' }, icon: Icons.Rivalry, label: 'Next Opponent', desc: data.nextOpponentName ? `Advance-scout ${data.nextOpponentName}` : 'Advance-scout your next game', band: 'all' },
    { key: 'ownProspects', target: { kind: 'ownProspects' }, icon: Icons.Home, label: 'Our Players & Prospects', desc: 'Keep internal reads current for lineup & development calls', band: 'all' },
    { key: 'freeAgents', target: { kind: 'freeAgents' }, icon: Icons.Briefcase, label: 'Free Agents', desc: 'Track available UFAs/RFAs on the market', band: 'senior' },
  ]

  // Derive a focus for any scout on a nation/league/team not already listed.
  const derived: FocusDef[] = []
  for (const s of data.scouts) {
    const key = focusKey(s.target)
    if (canonical.some((f) => f.key === key) || extra.some((f) => f.key === key) || derived.some((f) => f.key === key)) continue
    if (s.target.kind === 'nation' || s.target.kind === 'competition' || s.target.kind === 'team' || s.target.kind === 'division' || s.target.kind === 'player') {
      derived.push({
        key, target: s.target,
        icon: s.target.kind === 'nation' ? Icons.Globe : s.target.kind === 'player' ? Icons.Person : Icons.Trophy,
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
      setExtra((prev) => [...prev, { key, target, icon: target.kind === 'nation' ? Icons.Globe : Icons.Trophy, label, desc: `Deep coverage — ${label}`, ...(nation ? { nation } : {}), band: 'all' }])
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
            onClick={onAutoAssign}
            title="Chief Scout auto-assigns every scout: specialists to their region, the rest across the draft class, free agents, next opponent and your own prospects"
            style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon size={14}><Icons.Settings /></Icon> Chief Scout: auto-assign all
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

/**
 * The globe, with the department's beats down its right-hand side. The globe on
 * its own left half the panel empty and gave the user nothing to click; this
 * pairs it with the ranked list and wires the two together — pick a beat and the
 * world spins round to it.
 */
function CoverageGlobePanel({ data }: { data: ScoutingView }): JSX.Element {
  const [focus, setFocus] = useState<string | null>(null)
  const nations = buildGlobeNations(data)
  const covered = nations.filter((n) => n.covered).sort((a, b) => b.knowledge - a.knowledge)
  const dark = nations
    .filter((n) => !n.covered && n.youthCount > 0)
    .sort((a, b) => b.youthCount * (100 - b.knowledge) - a.youthCount * (100 - a.knowledge))
    .slice(0, 6)

  const Row = ({ n, blind }: { n: GlobeNation; blind?: boolean }): JSX.Element => (
    <button
      type="button"
      className="btn-ghost"
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', borderRadius: 5 }}
      title="Spin the globe to this country"
      onClick={() => setFocus(n.nation)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
        <FlagIcon nationality={n.nation} size={13} />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.nation}</span>
        <span style={{ fontWeight: 700, color: blind ? 'var(--danger, #d8584f)' : n.knowledge >= 50 ? 'var(--success)' : 'var(--accent, #f5b301)' }}>
          {n.knowledge}%
        </span>
      </div>
      <div className="muted" style={{ fontSize: 10 }}>
        {blind
          ? `${n.youthCount.toLocaleString()} draft-age players, nobody watching`
          : n.scoutNames.length ? n.scoutNames.join(', ') : 'passive knowledge only'}
      </div>
    </button>
  )

  return (
    <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'stretch', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 520px', minWidth: 380 }}>
        <ScoutGlobe nations={nations} homeNation="North America" focusNation={focus} onPick={setFocus} height={430} />
      </div>
      <div style={{ flex: '0 1 300px', minWidth: 250 }}>
        <Panel title="Where your eyes are">
          {covered.length === 0
            ? <p className="muted small" style={{ margin: 0 }}>Nobody is deployed anywhere. Every country on that globe is dark.</p>
            : covered.map((n) => <Row key={n.nation} n={n} />)}
          {dark.length > 0 && (
            <>
              <div className="muted" style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', margin: '12px 0 4px' }}>
                Blind spots
              </div>
              {dark.map((n) => <Row key={n.nation} n={n} blind />)}
            </>
          )}
        </Panel>
      </div>
    </div>
  )
}

/* ── main screen ───────────────────────────────────────────────────────────── */

export type FmTab = 'overview' | 'centre' | 'players' | 'focus' | 'coverage'

/** Last scouting response, valid for the ui-store `version` it was fetched at. */
let scoutingViewCache: { version: number; res: WorkerResponse } | null = null

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
    async () => {
      // All five sidebar tabs render from this one view, and switching tabs
      // remounts the screen (App keys the route wrapper by nav.screen) — so
      // without a cache every tab click re-asked the worker to rebuild the
      // whole scouting world. `version` is the global refresh bus: it bumps on
      // any world mutation (continue/advance/assignments/trades), so a hit can
      // only return exactly what an identical refetch would.
      const version = useUiStore.getState().version
      if (scoutingViewCache && scoutingViewCache.version === version) return scoutingViewCache.res
      const res = await client.getScouting()
      if (res.type === 'scouting') scoutingViewCache = { version, res }
      return res
    },
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
  const handleToggleWatch = async (playerId: string): Promise<void> => {
    const res = await client.toggleWatchPlayer(playerId)
    if (res.type === 'error') { toast(res.message, 'error') } else { bumpRefresh(); refetch() }
  }
  const handleWatchNote = async (playerId: string, note: string): Promise<void> => {
    const res = await client.setWatchNote(playerId, note)
    if (res.type === 'error') { toast(res.message, 'error') } else { bumpRefresh(); refetch() }
  }

  return (
    <section className="stack">
      <ScreenHeader title={TAB_TITLE[tab]} />
      <ScreenStateNotices loading={loading} error={error} empty={!data} emptyText="No scouting data." />

      {data && tab === 'overview' && (
        <OverviewTab
          data={data}
          onUnwatch={(pid) => { void handleToggleWatch(pid) }}
          onNote={(pid, note) => { void handleWatchNote(pid, note) }}
        />
      )}

      {data && tab === 'centre' && (
        <ScoutingCentreTab
          finds={data.recommendations}
          rosterNeeds={data.rosterNeeds}
          briefing={data.briefing}
          dismissedCount={data.dismissedCount ?? 0}
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
        <PlayerSearchTab
          scouts={data.scouts}
          onToggleWatch={(pid) => { void handleToggleWatch(pid) }}
          onScoutPlayer={(sid, pid) => { void handleScoutPlayer(sid, pid) }}
        />
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
          <CoverageGlobePanel data={data} />
          <div className="grid grid-2" style={{ gap: 'var(--sp-4)' }}>
            <CoverageTable title="Coverage by Nation" rows={data.nationCoverage} />
            <CoverageTable title="Coverage by League" rows={data.leagueCoverage} />
          </div>
        </div>
      )}
    </section>
  )
}
