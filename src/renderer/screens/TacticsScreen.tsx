import { Fragment, useState, useRef, useEffect, useCallback } from 'react'
import { overallToStars } from '../../engine/ratings/composites'
import type { TacticsView, LinesUpdate } from '../../worker/protocol'
import type { SquadView, StaffMeetingSummaryView } from '../../worker/protocol'
import type {
  LinesView,
  LineSlotView,
  LineSynergyView,
  PlayerBadge,
  SquadRowView,
} from '../../engine/career/views'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { toast } from '../components/store'
import { moraleColor, moraleWord } from '../components/format'
import { useClient, useScreenData } from '../hooks/useSim'
import { PlayerFace } from '../components/PlayerFace'
import { PlayerLink } from '../components/NavContext'

/* ── helpers ── */

function linesViewToUpdate(lines: LinesView): LinesUpdate {
  return {
    forwards: lines.forwards.map((line) => line.map((s) => s.player?.playerId ?? '')),
    defensePairs: lines.defensePairs.map((pair) => pair.map((s) => s.player?.playerId ?? '')),
    goalies: lines.goalies.map((s) => s.player?.playerId ?? ''),
    powerPlayUnits: lines.powerPlayUnits.map((unit) => unit.map((s) => s.player?.playerId ?? '')),
    penaltyKillUnits: lines.penaltyKillUnits.map((unit) => unit.map((s) => s.player?.playerId ?? '')),
  }
}

function deepCloneLines(lines: LinesView): LinesView {
  return JSON.parse(JSON.stringify(lines)) as LinesView
}

/* ── Drag-and-drop types ── */

/** Identifies a slot on the board. */
type SlotAddr =
  | { kind: 'slot'; section: Section; lineIdx: number; slotIdx: number }
  | { kind: 'scratch'; playerId: string }

type Section = 'forwards' | 'defense' | 'goalies' | 'pp' | 'pk'

/** JSON-serialisable payload carried via dataTransfer. */
interface DragPayload {
  src: SlotAddr
  playerId: string
  /** Set when dragged from the depth-chart list: locate the player wherever he is. */
  fromRoster?: boolean
}

/* ── Mutation helpers (pure) ── */

/** Return the slot array for a given section within a draft clone. */
function getSectionSlots(l: LinesView, section: Section): LineSlotView[][] {
  if (section === 'forwards') return l.forwards
  if (section === 'defense') return l.defensePairs
  if (section === 'pp') return l.powerPlayUnits
  if (section === 'pk') return l.penaltyKillUnits
  // goalies: wrap in [[...]] for uniform handling
  return [l.goalies]
}

/** Get the PlayerBadge at a slot address (from draft lines). */
function getAtAddr(l: LinesView, addr: SlotAddr): PlayerBadge | null {
  if (addr.kind === 'scratch') {
    return l.scratches.find((p) => p.playerId === addr.playerId) ?? null
  }
  const { section, lineIdx, slotIdx } = addr
  const rows = getSectionSlots(l, section)
  return rows[lineIdx]?.[slotIdx]?.player ?? null
}

/** Set the player at a slot address. */
function setAtAddr(l: LinesView, addr: SlotAddr, player: PlayerBadge | null): void {
  if (addr.kind === 'scratch') return // scratches are managed as a list, not by addr
  const { section, lineIdx, slotIdx } = addr
  if (section === 'goalies') {
    const slot = l.goalies[lineIdx]
    if (slot) slot.player = player
  } else {
    const rows = getSectionSlots(l, section)
    const slot = rows[lineIdx]?.[slotIdx]
    if (slot) slot.player = player
  }
}

/** Remove a player from scratches list. Returns true if found. */
function removeFromScratches(l: LinesView, playerId: string): boolean {
  const idx = l.scratches.findIndex((p) => p.playerId === playerId)
  if (idx === -1) return false
  l.scratches.splice(idx, 1)
  return true
}

/** Add a player to scratches list (dedup). */
function addToScratches(l: LinesView, player: PlayerBadge): void {
  if (!l.scratches.some((p) => p.playerId === player.playerId)) {
    l.scratches.push(player)
  }
}

/**
 * Apply a DnD move inside the draft lines.
 *
 * Rules:
 * - slot → empty slot: move
 * - slot → occupied slot: swap
 * - slot → scratches: bench (player goes to scratches, slot becomes empty)
 * - scratch → slot: place (if slot occupied, displaced player goes to scratches)
 * - scratch → scratch: no-op
 */
function applyDrop(l: LinesView, src: SlotAddr, dst: SlotAddr, draggedPlayer: PlayerBadge): void {
  if (src.kind === 'scratch' && dst.kind === 'scratch') return // no-op

  if (src.kind === 'slot' && dst.kind === 'scratch') {
    setAtAddr(l, src, null)
    addToScratches(l, draggedPlayer)
    return
  }

  if (src.kind === 'scratch' && dst.kind === 'slot') {
    const displaced = getAtAddr(l, dst)
    removeFromScratches(l, draggedPlayer.playerId)
    setAtAddr(l, dst, draggedPlayer)
    if (displaced) addToScratches(l, displaced)
    return
  }

  if (src.kind === 'slot' && dst.kind === 'slot') {
    const dstPlayer = getAtAddr(l, dst)
    setAtAddr(l, src, dstPlayer) // may be null (move) or another player (swap)
    setAtAddr(l, dst, draggedPlayer)
  }
}

/* ── Synergy → colour/word (green / yellow / red) ── */

function synergyColor(score: number): string {
  if (score >= 70) return 'var(--success)'
  if (score >= 50) return 'var(--amber, #f59e0b)'
  return 'var(--danger)'
}
function synergyWord(score: number): string {
  if (score >= 70) return 'Strong chemistry'
  if (score >= 50) return 'Workable chemistry'
  return 'Poor chemistry'
}

/* ── Star rating (0–5, half-steps) on the canonical NHL-calibrated scale ── */
function StarRating({ value }: { value: number }): JSX.Element {
  const stars = overallToStars(value)
  const color =
    stars >= 4.5 ? 'var(--success)' :
    stars >= 3.5 ? 'var(--accent)' :
    stars >= 2.5 ? 'var(--accent2)' :
    'var(--muted)'
  const full = Math.floor(stars)
  const half = stars - full >= 0.5
  const empty = 5 - full - (half ? 1 : 0)
  return (
    <span style={{ color, fontSize: 11, letterSpacing: -1, lineHeight: 1, whiteSpace: 'nowrap' }} title={`${stars}/5`}>
      {'★'.repeat(full)}
      {half ? '½' : ''}
      {'☆'.repeat(empty)}
    </span>
  )
}

/**
 * Off-hand check (EHM handedness rules): a LW shoots best R-handed, RW best L;
 * LD best L-handed, RD best R. Returns a short reason when the player is on his
 * off-hand for that slot (a soft warning, not a block).
 */
function offHandReason(slot: string, handedness: 'L' | 'R'): string | null {
  const s = slot.toUpperCase()
  if (s === 'LW' && handedness === 'L') return 'Off-hand wing (R preferred)'
  if (s === 'RW' && handedness === 'R') return 'Off-hand wing (L preferred)'
  if (s === 'LD' && handedness === 'R') return 'Off-side D (L preferred)'
  if (s === 'RD' && handedness === 'L') return 'Off-side D (R preferred)'
  return null
}

/* ── Player picker modal (for assigning into an empty slot / search) ── */
interface PickerProps {
  slot: string
  current: PlayerBadge | null
  roster: PlayerBadge[]
  onSelect: (p: PlayerBadge | null) => void
  onClose: () => void
}

function PlayerPicker({ slot, current, roster, onSelect, onClose }: PickerProps): JSX.Element {
  const [search, setSearch] = useState('')
  const filtered = roster.filter((p) =>
    !search.trim() || p.name.toLowerCase().includes(search.toLowerCase())
  )
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 40,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        className="panel"
        style={{ width: 380, maxHeight: '70vh', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row-between">
          <span style={{ fontWeight: 700 }}>Pick {slot}</span>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: '2px 8px' }}>✕</button>
        </div>
        <input
          className="input"
          placeholder="Search…"
          value={search}
          autoFocus
          onChange={(e) => setSearch(e.target.value)}
        />
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {current && (
            <button
              className="btn btn-ghost"
              style={{ width: '100%', textAlign: 'left', marginBottom: 'var(--sp-1)' }}
              onClick={() => { onSelect(null); onClose() }}
            >
              <span className="muted small">Clear slot</span>
            </button>
          )}
          {filtered.map((p) => (
            <button
              key={p.playerId}
              className="btn btn-ghost"
              style={{
                width: '100%', textAlign: 'left', justifyContent: 'flex-start',
                background: current?.playerId === p.playerId ? 'rgba(var(--accent-rgb),0.14)' : undefined,
                borderColor: current?.playerId === p.playerId ? 'var(--accent)' : undefined,
                gap: 'var(--sp-3)', marginBottom: 2,
              }}
              onClick={() => { onSelect(p); onClose() }}
            >
              <PlayerFace faceId={p.faceId} name={p.name} size={22} />
              <span className="muted small" style={{ width: 28, textAlign: 'right' }}>{p.position}</span>
              <span style={{ flex: 1 }}>{p.name}</span>
              <StarRating value={p.overall} />
              <span className="muted small">{p.age}y</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="muted small" style={{ padding: '12px 8px' }}>No players found.</div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Depth-chart dropdown (per-position quick swap) ── */

interface DepthDropdownProps {
  current: PlayerBadge | null
  roster: PlayerBadge[]
  onSelect: (p: PlayerBadge) => void
}

function DepthDropdown({ current, roster, onSelect }: DepthDropdownProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="btn btn-ghost btn-sm"
        style={{
          padding: '1px 4px', fontSize: 10, lineHeight: 1,
          color: 'var(--muted)', borderColor: 'transparent', minWidth: 0,
        }}
        title="Quick depth swap"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
      >
        ▾
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 60,
            minWidth: 220, maxHeight: 260, overflowY: 'auto',
            background: 'var(--bg2)', border: '1px solid var(--accent)',
            borderRadius: 'var(--radius-sm)', boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
            padding: '4px 0',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {roster.map((p) => (
            <button
              key={p.playerId}
              className="btn btn-ghost"
              style={{
                width: '100%', justifyContent: 'flex-start', gap: 6, padding: '4px 10px',
                fontSize: 12, borderRadius: 0, borderColor: 'transparent',
                background: current?.playerId === p.playerId ? 'rgba(var(--accent-rgb),0.18)' : 'transparent',
                fontWeight: current?.playerId === p.playerId ? 600 : 400,
              }}
              onClick={() => { onSelect(p); setOpen(false) }}
            >
              <PlayerFace faceId={p.faceId} name={p.name} size={18} />
              <span className="muted" style={{ fontSize: 10, width: 24, flexShrink: 0 }}>{p.position}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              <StarRating value={p.overall} />
            </button>
          ))}
          {roster.length === 0 && (
            <div className="muted small" style={{ padding: '8px 10px' }}>No players available.</div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Rink backdrop (decorative SVG, stretches to fill its container) ── */

function RinkBackdrop(): JSX.Element {
  return (
    <svg
      viewBox="0 0 1000 600"
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: 0.4 }}
      aria-hidden
    >
      <defs>
        <linearGradient id="ice" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(120,170,225,0.12)" />
          <stop offset="55%" stopColor="rgba(120,170,225,0.05)" />
          <stop offset="100%" stopColor="rgba(120,170,225,0.10)" />
        </linearGradient>
      </defs>
      {/* ice sheet */}
      <rect x="6" y="6" width="988" height="588" rx="96" fill="url(#ice)" stroke="rgba(150,170,200,0.28)" strokeWidth="2" />
      {/* zone lines run horizontally across the sheet (blue lines + centre red) */}
      <rect x="6" y="208" width="988" height="4" fill="rgba(60,120,230,0.32)" />
      <rect x="6" y="388" width="988" height="4" fill="rgba(60,120,230,0.32)" />
      <rect x="6" y="298" width="988" height="4" fill="rgba(220,60,60,0.3)" />
      {/* centre faceoff circle + dot */}
      <circle cx="500" cy="300" r="64" fill="none" stroke="rgba(60,120,230,0.28)" strokeWidth="2" />
      <circle cx="500" cy="300" r="5" fill="rgba(220,60,60,0.4)" />
      {/* zone faceoff circles (texture only) */}
      {[300, 700].map((x) =>
        [110, 490].map((y) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="34" fill="none" stroke="rgba(220,60,60,0.2)" strokeWidth="2" />
        ))
      )}
    </svg>
  )
}

/* ── Synergy connector between two adjacent linemates ── */

function Connector({ synergy }: { synergy: LineSynergyView | null }): JSX.Element {
  const color = synergy ? synergyColor(synergy.score) : 'rgba(139,149,166,0.35)'
  const title = synergy
    ? `${synergyWord(synergy.score)} — ${synergy.score}/100\n${synergy.notes.join('\n')}`
    : undefined
  return (
    <div
      title={title}
      style={{
        flex: '1 1 auto', minWidth: 18, alignSelf: 'center', height: 4, borderRadius: 2,
        background: color,
        boxShadow: synergy ? `0 0 6px ${color}` : 'none',
      }}
    />
  )
}

/* ── Rink token (DnD-aware): face + name(link→profile) + stars + depth dropdown ── */

interface RinkTokenProps {
  slotDef: LineSlotView
  addr: SlotAddr & { kind: 'slot' }
  roster: PlayerBadge[]
  dragOver: boolean
  onOpenPicker: () => void
  onDragStart: (addr: SlotAddr & { kind: 'slot' }) => void
  onDragOver: (addr: SlotAddr & { kind: 'slot' }) => void
  onDragLeave: () => void
  onDrop: (dst: SlotAddr & { kind: 'slot' }) => void
  onDepthSelect: (addr: SlotAddr & { kind: 'slot' }, player: PlayerBadge) => void
}

function RinkToken({
  slotDef, addr, roster, dragOver,
  onOpenPicker, onDragStart, onDragOver, onDragLeave, onDrop, onDepthSelect,
}: RinkTokenProps): JSX.Element {
  const p = slotDef.player

  return (
    <div
      draggable={p !== null}
      onDragStart={(e) => {
        if (!p) return
        const payload: DragPayload = { src: addr, playerId: p.playerId }
        e.dataTransfer.setData('application/x-lineup-slot', JSON.stringify(payload))
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(addr)
      }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver(addr) }}
      onDragLeave={onDragLeave}
      onDrop={(e) => { e.preventDefault(); onDrop(addr) }}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
        minWidth: 130, padding: '6px 8px', gap: 2,
        background: dragOver
          ? 'rgba(var(--accent-rgb),0.22)'
          : p ? 'rgba(20,26,38,0.82)' : 'rgba(20,26,38,0.45)',
        border: dragOver
          ? '1px solid var(--accent)'
          : p ? '1px solid var(--line)' : '1px dashed rgba(139,149,166,0.4)',
        borderRadius: 'var(--radius-sm)',
        cursor: p ? 'grab' : 'default',
        backdropFilter: 'blur(1px)',
        transition: 'background 0.1s, border-color 0.1s',
        userSelect: 'none',
      }}
    >
      {/* slot label + depth caret */}
      <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 4 }}>
        <span className="muted" style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 }}>
          {slotDef.slot}
        </span>
        <DepthDropdown current={p ?? null} roster={roster} onSelect={(chosen) => onDepthSelect(addr, chosen)} />
      </div>

      {p ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
          <PlayerFace faceId={p.faceId} name={p.name} size={24} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, maxWidth: 96 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <PlayerLink playerId={p.playerId} name={p.name} />
              </span>
              {(() => {
                const off = offHandReason(slotDef.slot, p.handedness)
                return off ? <span title={off} style={{ color: 'var(--amber, #f59e0b)', fontSize: 11, flexShrink: 0 }}>↔</span> : null
              })()}
            </div>
            <StarRating value={p.overall} />
          </div>
        </div>
      ) : (
        <button
          className="btn btn-ghost btn-sm"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px', borderColor: 'transparent' }}
          onClick={onOpenPicker}
          title={`${slotDef.slot} — click to assign a player`}
        >
          <span style={{
            width: 24, height: 24, borderRadius: '50%', border: '1px dashed rgba(139,149,166,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <span className="muted" style={{ fontSize: 10 }}>+</span>
          </span>
          <span className="muted" style={{ fontSize: 11, fontStyle: 'italic' }}>Empty</span>
        </button>
      )}
    </div>
  )
}

/* ── A line / pair row: tokens joined by colour-coded synergy connectors ── */

interface TokenRowProps {
  slots: LineSlotView[]
  section: Section
  lineIdx: number
  label: string
  roster: PlayerBadge[]
  synergy: LineSynergyView | null
  dragOverAddr: SlotAddr | null
  onOpenPicker: (lineIdx: number, slotIdx: number) => void
  onDragStart: (addr: SlotAddr & { kind: 'slot' }) => void
  onDragOver: (addr: SlotAddr) => void
  onDragLeave: () => void
  onDrop: (dst: SlotAddr) => void
  onDepthSelect: (addr: SlotAddr & { kind: 'slot' }, player: PlayerBadge) => void
  /** Centre the tokens (defence pairs / goalies) instead of spanning the full width. */
  centered?: boolean
  /** Pack tokens together with no stretched chemistry connector (goalies, special teams). */
  packed?: boolean
}

function TokenRow({
  slots, section, lineIdx, label, roster, synergy, dragOverAddr,
  onOpenPicker, onDragStart, onDragOver, onDragLeave, onDrop, onDepthSelect, centered, packed,
}: TokenRowProps): JSX.Element {
  function isOver(si: number): boolean {
    const a = dragOverAddr
    if (!a || a.kind !== 'slot') return false
    return a.section === section && a.lineIdx === lineIdx && a.slotIdx === si
  }
  // Packed rows (goalies, special-teams units) are NOT chemistry lines, so the
  // tokens simply sit together with a small gap — no stretched connector.
  const inner: React.CSSProperties = packed
    ? { display: 'flex', gap: 10, flexWrap: 'wrap', flex: 1, minWidth: 0, padding: '0 8px', justifyContent: centered ? 'center' : 'flex-start' }
    : { display: 'flex', alignItems: 'stretch', flex: 1, minWidth: 0, padding: '0 8px', ...(centered ? { maxWidth: 560, margin: '0 auto' } : {}) }
  return (
    <div className="row" style={{ gap: 0, alignItems: 'stretch', width: '100%' }}>
      <span className="muted small" style={{ width: 22, textAlign: 'right', alignSelf: 'center', flexShrink: 0 }}>
        {label}
      </span>
      <div style={inner}>
        {slots.map((slot, si) => {
          const addr: SlotAddr & { kind: 'slot' } = { kind: 'slot', section, lineIdx, slotIdx: si }
          return (
            <Fragment key={si}>
              {!packed && si > 0 && <Connector synergy={synergy} />}
              <RinkToken
                slotDef={slot}
                addr={addr}
                roster={roster}
                dragOver={isOver(si)}
                onOpenPicker={() => onOpenPicker(lineIdx, si)}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={() => onDrop(addr)}
                onDepthSelect={onDepthSelect}
              />
            </Fragment>
          )
        })}
      </div>
      {synergy && !packed && (
        <span
          className="small"
          style={{ alignSelf: 'center', width: 116, flexShrink: 0, color: synergyColor(synergy.score), fontWeight: 600, fontSize: 11 }}
          title={synergy.notes.join('\n')}
        >
          {synergyWord(synergy.score)}
        </span>
      )}
    </div>
  )
}

/* ── Right-side depth chart (live morale / condition / form) ── */

function CondPip({ value }: { value: number }): JSX.Element {
  const color = value >= 85 ? 'var(--success)' : value >= 65 ? 'var(--amber, #f59e0b)' : 'var(--danger)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 36, height: 5, borderRadius: 3, background: 'var(--bg0)', overflow: 'hidden', display: 'inline-block' }}>
        <span style={{ display: 'block', width: `${Math.max(0, Math.min(100, value))}%`, height: '100%', background: color }} />
      </span>
    </span>
  )
}

function FormArrow({ value }: { value: number }): JSX.Element {
  if (value > 1.5) return <span style={{ color: 'var(--success)' }} title="In form">▲</span>
  if (value < -1.5) return <span style={{ color: 'var(--danger)' }} title="Out of form">▼</span>
  return <span className="muted" title="Steady">▬</span>
}

type DepthSortKey = 'name' | 'positions' | 'lineLabel' | 'overall' | 'condition' | 'form' | 'morale'

function depthVal(r: SquadRowView, key: DepthSortKey): number | string {
  switch (key) {
    case 'name': return r.name
    case 'positions': return r.positions
    case 'lineLabel': return r.lineLabel
    case 'overall': return r.overall
    case 'condition': return r.condition
    case 'form': return r.form
    case 'morale': return r.morale
  }
}

function DepthChart({ squad, onRosterDragStart }: {
  squad: SquadView | null
  onRosterDragStart: (playerId: string) => void
}): JSX.Element {
  const [sort, setSort] = useState<{ key: DepthSortKey; dir: 1 | -1 }>({ key: 'overall', dir: -1 })

  if (!squad) {
    return <Panel title="Depth Chart"><div className="muted small">Loading roster…</div></Panel>
  }
  const groups: Array<{ label: string; rows: SquadRowView[] }> = [
    { label: 'Forwards', rows: squad.rows.filter((r) => r.position !== 'D' && r.position !== 'G') },
    { label: 'Defence', rows: squad.rows.filter((r) => r.position === 'D') },
    { label: 'Goalies', rows: squad.rows.filter((r) => r.position === 'G') },
  ]
  const cmp = (a: SquadRowView, b: SquadRowView): number => {
    const av = depthVal(a, sort.key)
    const bv = depthVal(b, sort.key)
    const d = typeof av === 'string' ? av.localeCompare(bv as string) : av - (bv as number)
    return d * sort.dir || b.overall - a.overall
  }
  for (const g of groups) g.rows.sort(cmp)

  // Numeric columns default to descending (best first); text columns to ascending.
  function clickHeader(key: DepthSortKey): void {
    setSort((s) => (s.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) } : { key, dir: key === 'name' || key === 'positions' || key === 'lineLabel' ? 1 : -1 }))
  }
  const arrow = (key: DepthSortKey): string => (sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '')
  const HEADERS: Array<[DepthSortKey, string]> = [
    ['name', 'Player'], ['positions', 'Pos'], ['lineLabel', 'Line'],
    ['overall', 'Ability'], ['condition', 'Cond'], ['form', 'Form'], ['morale', 'Morale'],
  ]

  return (
    <Panel title="Depth Chart">
      <div className="muted small" style={{ marginBottom: 'var(--sp-2)', opacity: 0.75 }}>
        Click a column to sort · drag a name onto the board to slot him in · click a name for the profile.
      </div>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              {HEADERS.map(([key, label]) => (
                <th
                  key={key}
                  onClick={() => clickHeader(key)}
                  style={{ cursor: 'pointer', userSelect: 'none', color: sort.key === key ? 'var(--accent)' : undefined }}
                  title={`Sort by ${label}`}
                >
                  {label}{arrow(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) =>
              g.rows.length === 0 ? null : (
                <>
                  <tr key={`hdr-${g.label}`} style={{ background: 'var(--surface-raised)' }}>
                    <td colSpan={7} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--muted)', padding: '5px 8px' }}>
                      {g.label}
                    </td>
                  </tr>
                  {g.rows.map((r) => {
                    const natural = r.positions.split(',')[0]?.trim() ?? ''
                    const extras = r.positions.split(',').slice(1).map((s) => s.trim()).filter(Boolean)
                    return (
                    <tr
                      key={r.playerId}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-lineup-slot', JSON.stringify({ fromRoster: true, playerId: r.playerId }))
                        e.dataTransfer.effectAllowed = 'move'
                        onRosterDragStart(r.playerId)
                      }}
                      style={{ cursor: 'grab', ...(r.injury ? { opacity: 0.65 } : {}) }}
                      title={`${r.name} — drag onto the board to slot him in`}
                    >
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <PlayerFace faceId={r.faceId} name={r.name} size={20} />
                          <div style={{ minWidth: 0 }}>
                            <PlayerLink playerId={r.playerId} name={r.name} />
                            {r.archetype && (
                              <div className="muted" style={{ fontSize: 10, lineHeight: 1.1 }}>{r.archetype.label}</div>
                            )}
                          </div>
                          {r.injury && <span title="Injured" style={{ color: 'var(--danger)', fontSize: 11 }}>＋</span>}
                        </div>
                      </td>
                      <td title={`Can play: ${r.positions}`} style={{ whiteSpace: 'nowrap' }}>
                        <span style={{ fontWeight: 600 }}>{natural}</span>
                        {extras.length > 0 && (
                          <span className="muted" style={{ fontSize: 10 }}> /{extras.join('/')}</span>
                        )}
                      </td>
                      <td><span className="chip" style={{ fontSize: 10 }}>{r.lineLabel}</span></td>
                      <td><StarRating value={r.overall} /></td>
                      <td><CondPip value={r.condition} /></td>
                      <td style={{ textAlign: 'center' }}><FormArrow value={r.form} /></td>
                      <td style={{ color: moraleColor(r.morale), fontWeight: 600 }}>{moraleWord(r.morale)}</td>
                    </tr>
                    )
                  })}
                </>
              )
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/* ── Coach system bar with hover info ── */

function SystemInfoBar({ summary }: { summary: StaffMeetingSummaryView }): JSX.Element {
  const [open, setOpen] = useState(false)
  const fitC = summary.rosterFit >= 66 ? 'var(--success)' : summary.rosterFit >= 55 ? 'var(--amber, #f59e0b)' : 'var(--danger)'
  const phases: Array<[string, string]> = [
    ['Forecheck', summary.forecheckName],
    ['Breakout', summary.breakoutName],
    ['Neutral zone', summary.nzName],
    ['D-zone', summary.dZoneName],
    ['Power play', summary.ppName],
    ['Penalty kill', summary.pkName],
    ['Pace', summary.paceName],
  ]
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div
        className="row"
        style={{
          gap: 12, alignItems: 'center', flexWrap: 'wrap', cursor: 'help',
          padding: '8px 12px', background: 'var(--bg2)', border: '1px solid var(--line)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <span className="muted small" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {summary.coachName}’s system
        </span>
        <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{summary.systemLabel}</span>
        <span style={{ color: 'var(--accent)', fontSize: 11, opacity: 0.8 }}>ⓘ</span>
        <span className="muted small">
          {summary.forecheckName} · {summary.dZoneName} D-zone · {summary.paceName}
        </span>
        <span className="small" style={{ marginLeft: 'auto', color: 'var(--muted)' }}>
          roster fit <strong style={{ color: fitC }}>{summary.rosterFit}/100</strong>
        </span>
      </div>

      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50,
            width: 'min(460px, 90vw)', background: 'var(--bg1)', border: '1px solid var(--accent)',
            borderRadius: 'var(--radius)', boxShadow: '0 12px 32px rgba(0,0,0,0.5)', padding: 'var(--sp-4)',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--accent)', marginBottom: 4 }}>
            {summary.systemLabel}
          </div>
          <div className="small" style={{ lineHeight: 1.5, marginBottom: 6 }}>{summary.systemBlurb}</div>
          <div className="small" style={{ lineHeight: 1.5, marginBottom: 'var(--sp-3)' }}>
            <span style={{ color: 'var(--success)', fontWeight: 600 }}>Favours: </span>
            <span className="muted">{summary.systemFavors}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', fontSize: 12 }}>
            {phases.map(([k, v]) => (
              <Fragment key={k}>
                <span className="muted">{k}</span>
                <span style={{ fontWeight: 600 }}>{v}</span>
              </Fragment>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 10, marginTop: 'var(--sp-3)', opacity: 0.7 }}>
            Your coach owns the system — influence it in Front Office → Staff Meeting, or change coaches in Staff → Job Market.
          </div>
        </div>
      )}
    </div>
  )
}

/* ── main component ── */

export function TacticsScreen(): JSX.Element {
  const client = useClient()
  const { data, loading, error, refetch } = useScreenData<TacticsView>(
    () => client.getTactics(),
    (r) => (r.type === 'tactics' ? r.tactics : null)
  )
  const { data: squad } = useScreenData<SquadView>(
    () => client.getSquad(),
    (r) => (r.type === 'squad' ? r.squad : null)
  )
  const { data: coachSummary } = useScreenData<StaffMeetingSummaryView>(
    () => client.getStaffMeetingSummary(),
    (r) => (r.type === 'staffMeetingSummary' ? r.summary : null)
  )

  // Optimistic local copy of the lines while a save round-trips. The board is
  // auto-saved on every change — there is no Save button. Cleared whenever fresh
  // server data arrives (which also carries recomputed, legalised lines).
  const [draftLines, setDraftLines] = useState<LinesView | null>(null)
  const [saving, setSaving] = useState(false)
  const [coachBuilding, setCoachBuilding] = useState(false)

  // Picker state
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerContext, setPickerContext] = useState<{ section: Section; lineIdx: number; slotIdx: number } | null>(null)

  // DnD state
  const [, setDragSrc] = useState<SlotAddr | null>(null)
  const [dragOverAddr, setDragOverAddr] = useState<SlotAddr | null>(null)
  const dragPayloadRef = useRef<DragPayload | null>(null)

  // When new server data lands, the optimistic copy is no longer needed —
  // synergies and any legalisation now come from the server.
  useEffect(() => { setDraftLines(null) }, [data])

  const lines = draftLines ?? data?.lines ?? null

  // Persist the lineup immediately (auto-save), then refresh to pull recomputed
  // line chemistry so the connectors recolour without any manual save.
  const persistLines = useCallback(async (next: LinesView): Promise<void> => {
    setSaving(true)
    try {
      const res = await client.setLines(linesViewToUpdate(next))
      if (res.type === 'error') { toast(res.message, 'error'); return }
      refetch()
    } catch {
      toast('Could not save the lineup.', 'error')
    } finally {
      setSaving(false)
    }
  }, [client, refetch])

  function setLines(updater: (l: LinesView) => LinesView): void {
    const base = lines ?? data?.lines
    if (!base) return
    const next = updater(deepCloneLines(base))
    setDraftLines(next) // optimistic — board updates instantly
    void persistLines(next) // auto-save + chemistry refresh
  }

  function openPicker(section: Section, lineIdx: number, slotIdx: number): void {
    setPickerContext({ section, lineIdx, slotIdx })
    setPickerOpen(true)
  }

  function getPickerSlot(): LineSlotView | null {
    if (!pickerContext || !lines) return null
    const { section, lineIdx, slotIdx } = pickerContext
    if (section === 'forwards') return lines.forwards[lineIdx]?.[slotIdx] ?? null
    if (section === 'defense') return lines.defensePairs[lineIdx]?.[slotIdx] ?? null
    if (section === 'goalies') return lines.goalies[lineIdx] ?? null
    if (section === 'pp') return lines.powerPlayUnits[lineIdx]?.[slotIdx] ?? null
    if (section === 'pk') return lines.penaltyKillUnits[lineIdx]?.[slotIdx] ?? null
    return null
  }

  function handlePickerSelect(player: PlayerBadge | null): void {
    if (!pickerContext) return
    setLines((l) => {
      const { section, lineIdx, slotIdx } = pickerContext
      const target =
        section === 'forwards' ? l.forwards[lineIdx]?.[slotIdx] :
        section === 'defense' ? l.defensePairs[lineIdx]?.[slotIdx] :
        section === 'goalies' ? l.goalies[lineIdx] :
        section === 'pp' ? l.powerPlayUnits[lineIdx]?.[slotIdx] :
        section === 'pk' ? l.penaltyKillUnits[lineIdx]?.[slotIdx] :
        null
      if (target) target.player = player
      return l
    })
  }

  // Healthy roster for picker/dropdown sorted by overall desc.
  function buildRoster(): PlayerBadge[] {
    if (!data) return []
    const fromSlots = [
      ...data.lines.forwards.flat(),
      ...data.lines.defensePairs.flat(),
      ...data.lines.goalies,
    ]
      .map((s) => s.player)
      .filter((p): p is PlayerBadge => p != null)
    const healthy = fromSlots.concat(data.lines.scratches)
    const seen = new Set<string>()
    const deduped = healthy.filter((p) => {
      if (seen.has(p.playerId)) return false
      seen.add(p.playerId)
      return true
    })
    return deduped.slice().sort((a, b) => b.overall - a.overall)
  }

  // ── DnD handlers ──
  const handleDragStart = useCallback((addr: SlotAddr & { kind: 'slot' }) => {
    dragPayloadRef.current = { src: addr, playerId: '' }
    setDragSrc(addr)
  }, [])

  const handleDragOver = useCallback((addr: SlotAddr) => { setDragOverAddr(addr) }, [])
  const handleDragLeave = useCallback(() => { setDragOverAddr(null) }, [])

  // A name dragged from the depth chart: locate-and-place on drop (see handleDrop).
  const handleRosterDragStart = useCallback((playerId: string) => {
    dragPayloadRef.current = { src: { kind: 'scratch', playerId: '' }, playerId, fromRoster: true }
  }, [])

  function handleDrop(dst: SlotAddr): void {
    const payload = dragPayloadRef.current
    dragPayloadRef.current = null
    setDragSrc(null)
    setDragOverAddr(null)
    if (!payload || !lines) return

    // Dragged from the depth-chart list → place that player into the target slot
    // (locating and vacating wherever he currently sits). Only valid onto a slot.
    if (payload.fromRoster) {
      if (dst.kind !== 'slot') return
      const chosen = buildRoster().find((p) => p.playerId === payload.playerId)
      if (chosen) handleDepthSelect(dst, chosen)
      return
    }

    const src = payload.src
    if (
      src.kind === 'slot' && dst.kind === 'slot' &&
      src.section === dst.section && src.lineIdx === dst.lineIdx && src.slotIdx === dst.slotIdx
    ) return

    setLines((l) => {
      const draggedPlayer = getAtAddr(l, src)
        ?? l.scratches.find((p) => p.playerId === payload.playerId)
        ?? null
      if (!draggedPlayer) return l
      applyDrop(l, src, dst, draggedPlayer)
      return l
    })
  }

  function handleScratchDragOver(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverAddr({ kind: 'scratch', playerId: '' })
  }

  function handleScratchDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    const raw = e.dataTransfer.getData('application/x-lineup-slot')
    if (!raw) return
    try {
      const payload = JSON.parse(raw) as DragPayload
      dragPayloadRef.current = payload
      handleDrop({ kind: 'scratch', playerId: '' })
    } catch {
      setDragSrc(null)
      setDragOverAddr(null)
    }
  }

  // ── Depth dropdown handler ──
  function handleDepthSelect(targetAddr: SlotAddr & { kind: 'slot' }, chosen: PlayerBadge): void {
    setLines((l) => {
      let chosenSrc: SlotAddr | null = null
      const sections: Section[] = ['forwards', 'defense', 'goalies', 'pp', 'pk']
      outer: for (const sec of sections) {
        if (sec === 'goalies') {
          for (let i = 0; i < l.goalies.length; i++) {
            if (l.goalies[i]?.player?.playerId === chosen.playerId) {
              chosenSrc = { kind: 'slot', section: 'goalies', lineIdx: i, slotIdx: 0 }
              break outer
            }
          }
        } else {
          const rows = getSectionSlots(l, sec)
          for (let li = 0; li < rows.length; li++) {
            const row = rows[li]
            if (!row) continue
            for (let si = 0; si < row.length; si++) {
              if (row[si]?.player?.playerId === chosen.playerId) {
                chosenSrc = { kind: 'slot', section: sec, lineIdx: li, slotIdx: si }
                break outer
              }
            }
          }
        }
      }
      if (!chosenSrc && l.scratches.some((p) => p.playerId === chosen.playerId)) {
        chosenSrc = { kind: 'scratch', playerId: chosen.playerId }
      }
      if (!chosenSrc) return l
      applyDrop(l, chosenSrc, targetAddr, chosen)
      return l
    })
  }

  async function handleCoachSetLines(): Promise<void> {
    setCoachBuilding(true)
    try {
      const res = await client.coachSetLines()
      if (res.type === 'error') {
        toast(res.message, 'error')
      } else if (res.type === 'coachLines') {
        const next = deepCloneLines(res.lines)
        setDraftLines(next)
        await persistLines(next) // auto-save the coach's lineup
        toast('Coach set the lines.', 'success')
      }
    } catch {
      toast('Failed to get coach lines.', 'error')
    } finally {
      setCoachBuilding(false)
    }
  }

  const pickerSlot = getPickerSlot()
  const roster = buildRoster()
  const scratchDragOver = dragOverAddr?.kind === 'scratch'

  const dnd = {
    dragOverAddr,
    onDragStart: handleDragStart,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDepthSelect: handleDepthSelect,
    onDrop: (dst: SlotAddr) => handleDrop(dst),
  }

  return (
    <section className="stack">
      <ScreenHeader title="Tactics &amp; Lines">
        <span className="muted small">
          Your coach owns the system — you set the lineup.{' '}
          <span style={{ color: saving ? 'var(--amber, #f59e0b)' : 'var(--success)' }}>
            {saving ? 'Saving…' : '✓ Auto-saved'}
          </span>
        </span>
      </ScreenHeader>

      {error && <Notice kind="warn">{error}</Notice>}
      {loading && !data && <Notice kind="info">Loading…</Notice>}

      {coachSummary && <SystemInfoBar summary={coachSummary} />}

      {data && lines && (
        <>
          {lines.issues.length > 0 && (
            <Notice kind="warn">
              <strong>Line issues:</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                {lines.issues.map((iss, i) => <li key={i}>{iss}</li>)}
              </ul>
            </Notice>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(520px,2fr) minmax(320px,1fr)', gap: 'var(--sp-4)', alignItems: 'start' }}>
            {/* ── LEFT: rink line board ── */}
            <div className="stack">
              <div className="row-between" style={{ marginBottom: -4 }}>
                <div className="row" style={{ gap: 12, alignItems: 'center' }}>
                  <span className="panel-title" style={{ fontSize: 13, fontWeight: 700 }}>Line Board</span>
                  {/* synergy legend */}
                  <span className="row small" style={{ gap: 10, alignItems: 'center', opacity: 0.85 }}>
                    {([['var(--success)', 'Strong'], ['var(--amber, #f59e0b)', 'OK'], ['var(--danger)', 'Poor']] as const).map(([c, label]) => (
                      <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                        <span style={{ width: 14, height: 4, borderRadius: 2, background: c, display: 'inline-block' }} />
                        <span className="muted">{label}</span>
                      </span>
                    ))}
                  </span>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 12, gap: 4, whiteSpace: 'nowrap', minWidth: 0 }}
                  onClick={() => { void handleCoachSetLines() }}
                  disabled={coachBuilding}
                  title="Let the head coach build the full lineup and scratch list"
                >
                  {coachBuilding ? 'Asking coach…' : 'Ask the coach to set lines'}
                </button>
              </div>

              {/* Even-strength rink */}
              <div style={{ position: 'relative', borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--line)', background: 'var(--bg1)', padding: 'var(--sp-4)' }}>
                <RinkBackdrop />
                <div className="stack" style={{ position: 'relative', zIndex: 1, gap: 'var(--sp-4)' }}>
                  <div className="stack" style={{ gap: 'var(--sp-2)' }}>
                    <div className="panel-title">Forward Lines</div>
                    {lines.forwards.map((line, li) => (
                      <TokenRow
                        key={li}
                        slots={line}
                        section="forwards"
                        lineIdx={li}
                        label={`${li + 1}`}
                        roster={roster}
                        synergy={data.lineSynergies?.[li] ?? null}
                        onOpenPicker={(l2, s2) => openPicker('forwards', l2, s2)}
                        {...dnd}
                      />
                    ))}
                  </div>
                  <div className="stack" style={{ gap: 'var(--sp-2)' }}>
                    <div className="panel-title">Defence Pairs</div>
                    {lines.defensePairs.map((pair, li) => (
                      <TokenRow
                        key={li}
                        slots={pair}
                        section="defense"
                        lineIdx={li}
                        label={`${li + 1}`}
                        roster={roster}
                        synergy={data.pairSynergies?.[li] ?? null}
                        onOpenPicker={(l2, s2) => openPicker('defense', l2, s2)}
                        centered
                        {...dnd}
                      />
                    ))}
                  </div>
                  <div className="stack" style={{ gap: 'var(--sp-2)' }}>
                    <div className="panel-title">Goaltenders</div>
                    <TokenRow
                      slots={lines.goalies}
                      section="goalies"
                      lineIdx={0}
                      label="G"
                      roster={roster}
                      synergy={null}
                      onOpenPicker={(_l2, s2) => openPicker('goalies', s2, 0)}
                      centered
                      packed
                      {...dnd}
                      onDrop={(dst) => handleDrop(dst)}
                    />
                  </div>
                </div>
              </div>

              {/* Special teams (units only — formation is coach-owned) */}
              <Panel title="Special Teams">
                <div className="stack" style={{ gap: 'var(--sp-4)' }}>
                  <div className="stack" style={{ gap: 'var(--sp-2)' }}>
                    <div className="panel-title">Power Play</div>
                    {lines.powerPlayUnits.map((unit, li) => (
                      <TokenRow
                        key={li}
                        slots={unit}
                        section="pp"
                        lineIdx={li}
                        label={`${li + 1}`}
                        roster={roster}
                        synergy={null}
                        onOpenPicker={(l2, s2) => openPicker('pp', l2, s2)}
                        packed
                        {...dnd}
                      />
                    ))}
                  </div>
                  <div className="stack" style={{ gap: 'var(--sp-2)' }}>
                    <div className="panel-title">Penalty Kill</div>
                    {lines.penaltyKillUnits.map((unit, li) => (
                      <TokenRow
                        key={li}
                        slots={unit}
                        section="pk"
                        lineIdx={li}
                        label={`${li + 1}`}
                        roster={roster}
                        synergy={null}
                        onOpenPicker={(l2, s2) => openPicker('pk', l2, s2)}
                        packed
                        {...dnd}
                      />
                    ))}
                  </div>
                </div>
              </Panel>

              {/* Depth pool / scratches — drop target */}
              <div
                onDragOver={handleScratchDragOver}
                onDragLeave={() => setDragOverAddr(null)}
                onDrop={handleScratchDrop}
                style={{
                  borderRadius: 'var(--radius)',
                  border: scratchDragOver ? '1px solid var(--accent)' : '1px solid var(--line)',
                  background: scratchDragOver ? 'rgba(var(--accent-rgb),0.08)' : 'var(--bg1)',
                  padding: 'var(--sp-4)',
                  transition: 'border-color 0.12s, background 0.12s',
                }}
              >
                <div className="panel-title" style={{ marginBottom: 'var(--sp-3)' }}>
                  Depth Pool — Scratches &amp; Extras
                  {scratchDragOver && <span style={{ color: 'var(--accent)', marginLeft: 6 }}>Drop to bench</span>}
                </div>
                {lines.scratches.length > 0 ? (() => {
                  const fwds = lines.scratches.filter((p) => p.position !== 'D' && p.position !== 'G')
                  const defs = lines.scratches.filter((p) => p.position === 'D')
                  const gols = lines.scratches.filter((p) => p.position === 'G')
                  const groups: Array<{ label: string; players: PlayerBadge[] }> = []
                  if (fwds.length) groups.push({ label: 'Forwards', players: fwds })
                  if (defs.length) groups.push({ label: 'Defence', players: defs })
                  if (gols.length) groups.push({ label: 'Goalies', players: gols })
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                      {groups.map((grp) => (
                        <div key={grp.label}>
                          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--muted)', marginBottom: 'var(--sp-1)' }}>
                            {grp.label}
                          </div>
                          <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
                            {grp.players.map((p) => (
                              <div
                                key={p.playerId}
                                className="chip"
                                draggable
                                onDragStart={(e) => {
                                  const payload: DragPayload = { src: { kind: 'scratch', playerId: p.playerId }, playerId: p.playerId }
                                  e.dataTransfer.setData('application/x-lineup-slot', JSON.stringify(payload))
                                  e.dataTransfer.effectAllowed = 'move'
                                  dragPayloadRef.current = payload
                                  setDragSrc({ kind: 'scratch', playerId: p.playerId })
                                }}
                                onDragEnd={() => { setDragSrc(null); setDragOverAddr(null) }}
                                style={{ cursor: 'grab', gap: 6, paddingLeft: 6, userSelect: 'none' }}
                                title={`${p.name} — drag to a slot`}
                              >
                                <PlayerFace faceId={p.faceId} name={p.name} size={20} />
                                <span className="muted" style={{ fontSize: 10 }}>{p.position}</span>
                                <PlayerLink playerId={p.playerId} name={p.name} />
                                <StarRating value={p.overall} />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })() : (
                  <div className="muted small" style={{ fontStyle: 'italic' }}>
                    {scratchDragOver ? 'Release to bench this player.' : 'All rostered players are dressed — drag a player here to scratch them.'}
                  </div>
                )}
              </div>
            </div>

            {/* ── RIGHT: depth chart ── */}
            <div className="stack">
              <DepthChart squad={squad} onRosterDragStart={handleRosterDragStart} />
            </div>
          </div>

          {/* picker modal */}
          {pickerOpen && pickerContext && (
            <PlayerPicker
              slot={pickerSlot?.slot ?? pickerContext.section}
              current={pickerSlot?.player ?? null}
              roster={roster}
              onSelect={handlePickerSelect}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </>
      )}
    </section>
  )
}
