import { useState, useRef, useEffect, useCallback } from 'react'
import { overallToStars } from '../../engine/ratings/composites'
import type { TacticsView, LinesUpdate } from '../../worker/protocol'
import type {
  LinesView,
  LineSlotView,
  LineSynergyView,
  CoachSuggestionView,
  StyleFitView,
  PlayerBadge,
} from '../../engine/career/views'
import type {
  TeamTactics,
  ForecheckSystem,
  DefensiveZoneCoverage,
  PowerPlayFormation,
  PenaltyKillFormation,
  BreakoutSystem,
  NzOffensiveSystem,
  NzDefensiveSystem,
  OzEntry,
  DZoneStructure,
  FaceoffPlay,
  ShotTargeting,
  PersonalTactics,
} from '@domain'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { bumpRefresh, toast } from '../components/store'
import { useClient, useScreenData } from '../hooks/useSim'
import { PlayerFace } from '../components/PlayerFace'

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
 * - scratch → scratch: no-op (same player, or reorder — we keep scratches unordered)
 */
function applyDrop(l: LinesView, src: SlotAddr, dst: SlotAddr, draggedPlayer: PlayerBadge): void {
  if (src.kind === 'scratch' && dst.kind === 'scratch') return // no-op

  if (src.kind === 'slot' && dst.kind === 'scratch') {
    // Bench the dragged player
    setAtAddr(l, src, null)
    addToScratches(l, draggedPlayer)
    return
  }

  if (src.kind === 'scratch' && dst.kind === 'slot') {
    // Place from scratches into a slot
    const displaced = getAtAddr(l, dst)
    removeFromScratches(l, draggedPlayer.playerId)
    setAtAddr(l, dst, draggedPlayer)
    if (displaced) addToScratches(l, displaced)
    return
  }

  if (src.kind === 'slot' && dst.kind === 'slot') {
    // Move or swap
    const dstPlayer = getAtAddr(l, dst)
    setAtAddr(l, src, dstPlayer) // may be null (move) or another player (swap)
    setAtAddr(l, dst, draggedPlayer)
  }
}

/* ── Synergy badge ── */

function synergyColor(score: number): string {
  if (score >= 70) return 'var(--success)'
  if (score >= 50) return 'var(--accent2)'
  return 'var(--danger)'
}

interface SynergyBadgeProps {
  synergy: LineSynergyView
  lineLabel: string
}

function SynergyBadge({ synergy, lineLabel }: SynergyBadgeProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const color = synergyColor(synergy.score)

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="btn btn-ghost btn-sm"
        style={{
          gap: 4,
          padding: '2px 8px',
          borderColor: color,
          color,
          fontSize: 11,
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 700,
        }}
        title={`${lineLabel} synergy — click to expand`}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ fontSize: 9, opacity: 0.8 }}>SYN</span>
        {synergy.score}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '110%',
            left: 0,
            zIndex: 50,
            minWidth: 260,
            background: 'var(--bg2)',
            border: `1px solid ${color}`,
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--sp-3)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}
        >
          <div
            className="row-between"
            style={{ marginBottom: 'var(--sp-2)' }}
          >
            <span style={{ fontWeight: 700, fontSize: 12, color }}>
              Line synergy: {synergy.score}/100
            </span>
            <button
              className="btn btn-ghost"
              style={{ padding: '0 4px', fontSize: 11 }}
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>
          <div
            style={{
              height: 4,
              borderRadius: 2,
              background: 'var(--bg0)',
              marginBottom: 'var(--sp-2)',
            }}
          >
            <div
              style={{
                width: `${synergy.score}%`,
                height: '100%',
                borderRadius: 2,
                background: color,
              }}
            />
          </div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {synergy.notes.map((note, i) => (
              <li key={i} className="muted small" style={{ marginBottom: 2 }}>
                {note}
              </li>
            ))}
          </ul>
          <div className="muted small" style={{ marginTop: 'var(--sp-2)', opacity: 0.6 }}>
            Multiplier: ×{synergy.multiplier.toFixed(3)}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Coach's recommendation panel ── */

interface CoachPanelProps {
  suggestion: CoachSuggestionView
  styleFit: StyleFitView
  onApply: () => Promise<void>
  applying: boolean
}

function CoachPanel({ suggestion, styleFit, onApply, applying }: CoachPanelProps): JSX.Element {
  const fitColor = synergyColor(styleFit.fit)

  return (
    <Panel title="Coach's Recommendation">
      <div className="stack" style={{ gap: 'var(--sp-4)' }}>
        {/* Style fit meter */}
        <div>
          <div
            className="row-between"
            style={{ marginBottom: 'var(--sp-1)' }}
          >
            <span className="muted small">Current style fit</span>
            <span style={{ fontWeight: 700, fontSize: 12, color: fitColor }}>
              {styleFit.fit}/100
            </span>
          </div>
          <div
            style={{
              height: 6,
              borderRadius: 3,
              background: 'var(--bg0)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${styleFit.fit}%`,
                height: '100%',
                background: fitColor,
                borderRadius: 3,
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          {styleFit.advice.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {styleFit.advice.map((tip, i) => (
                <li key={i} className="muted small" style={{ marginBottom: 2 }}>
                  {tip}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Suggested style */}
        <div
          style={{
            background: 'var(--bg0)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--sp-3)',
          }}
        >
          <div className="row-between" style={{ marginBottom: 'var(--sp-2)' }}>
            <span
              style={{
                fontWeight: 700,
                fontSize: 13,
                color: 'var(--accent)',
              }}
            >
              {suggestion.styleLabel}
            </span>
            <span className="chip chip-accent" style={{ fontSize: 10 }}>
              Suggested
            </span>
          </div>
          <ul style={{ margin: '0 0 var(--sp-3)', paddingLeft: 18 }}>
            {suggestion.rationale.map((r, i) => (
              <li key={i} className="muted small" style={{ marginBottom: 3 }}>
                {r}
              </li>
            ))}
          </ul>
          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={onApply}
            disabled={applying}
          >
            {applying ? 'Applying…' : 'Apply suggestion'}
          </button>
        </div>
      </div>
    </Panel>
  )
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
    <span style={{ color, fontSize: 11, letterSpacing: -1, lineHeight: 1 }} title={`OVR: ${value}`}>
      {'★'.repeat(full)}
      {half ? '½' : ''}
      {'☆'.repeat(empty)}
    </span>
  )
}

/* ── Player picker modal ── */
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

/* ── Depth-chart dropdown ── */

interface DepthDropdownProps {
  /** Currently slotted player (may be null). */
  current: PlayerBadge | null
  /** Full roster sorted by overall desc. */
  roster: PlayerBadge[]
  onSelect: (p: PlayerBadge) => void
}

function DepthDropdown({ current, roster, onSelect }: DepthDropdownProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="btn btn-ghost btn-sm"
        style={{
          padding: '1px 4px',
          fontSize: 10,
          lineHeight: 1,
          color: 'var(--muted)',
          borderColor: 'transparent',
          minWidth: 0,
        }}
        title="Quick depth swap"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
      >
        ▾
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 60,
            minWidth: 220,
            maxHeight: 260,
            overflowY: 'auto',
            background: 'var(--bg2)',
            border: '1px solid var(--accent)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
            padding: '4px 0',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {roster.map((p) => (
            <button
              key={p.playerId}
              className="btn btn-ghost"
              style={{
                width: '100%',
                justifyContent: 'flex-start',
                gap: 6,
                padding: '4px 10px',
                fontSize: 12,
                borderRadius: 0,
                borderColor: 'transparent',
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

/**
 * Off-hand check (EHM handedness rules): a LW shoots best R-handed, RW best L;
 * LD best L-handed, RD best R. Returns a short reason when the player is on his
 * off-hand for that slot (a soft warning, not a block — versatile players cope).
 */
function offHandReason(slot: string, handedness: 'L' | 'R'): string | null {
  const s = slot.toUpperCase()
  if (s === 'LW' && handedness === 'L') return 'Off-hand wing (R preferred)'
  if (s === 'RW' && handedness === 'R') return 'Off-hand wing (L preferred)'
  if (s === 'LD' && handedness === 'R') return 'Off-side D (L preferred)'
  if (s === 'RD' && handedness === 'L') return 'Off-side D (R preferred)'
  return null
}

/* ── Slot button (DnD-aware, with face + depth dropdown) ── */

interface SlotButtonProps {
  slotDef: LineSlotView
  addr: SlotAddr & { kind: 'slot' }
  roster: PlayerBadge[]
  dragOver: boolean
  onClickSlot: () => void
  onDragStart: (addr: SlotAddr & { kind: 'slot' }) => void
  onDragOver: (addr: SlotAddr & { kind: 'slot' }) => void
  onDragLeave: () => void
  onDrop: (dst: SlotAddr & { kind: 'slot' }) => void
  onDepthSelect: (addr: SlotAddr & { kind: 'slot' }, player: PlayerBadge) => void
}

function SlotButton({
  slotDef,
  addr,
  roster,
  dragOver,
  onClickSlot,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDepthSelect,
}: SlotButtonProps): JSX.Element {
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
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onDragOver(addr)
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault()
        onDrop(addr)
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        minWidth: 128,
        padding: '6px 8px',
        gap: 2,
        background: dragOver
          ? 'rgba(var(--accent-rgb),0.18)'
          : p
            ? 'var(--bg2)'
            : 'var(--bg0)',
        border: dragOver
          ? '1px solid var(--accent)'
          : p
            ? '1px solid var(--line)'
            : '1px dashed rgba(139,149,166,0.4)',
        borderRadius: 'var(--radius-sm)',
        cursor: p ? 'grab' : 'default',
        transition: 'background 0.1s, border-color 0.1s',
        position: 'relative',
        userSelect: 'none',
      }}
    >
      {/* slot label row */}
      <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 4 }}>
        <span className="muted" style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 }}>
          {slotDef.slot}
        </span>
        {/* Depth dropdown caret */}
        <DepthDropdown
          current={p ?? null}
          roster={roster}
          onSelect={(chosen) => onDepthSelect(addr, chosen)}
        />
      </div>

      {/* player row */}
      {p ? (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', cursor: 'pointer' }}
          onClick={onClickSlot}
          title={`${slotDef.slot} — click to search/change`}
        >
          <PlayerFace faceId={p.faceId} name={p.name} size={24} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 90, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
              {(() => {
                const off = offHandReason(slotDef.slot, p.handedness)
                return off ? <span title={off} style={{ color: 'var(--amber, #f59e0b)', fontSize: 11, flexShrink: 0 }}>↔</span> : null
              })()}
            </div>
            <StarRating value={p.overall} />
          </div>
        </div>
      ) : (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', paddingTop: 2 }}
          onClick={onClickSlot}
          title={`${slotDef.slot} — click to assign player`}
        >
          <div style={{
            width: 24, height: 24, borderRadius: '50%',
            border: '1px dashed rgba(139,149,166,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <span className="muted" style={{ fontSize: 10 }}>+</span>
          </div>
          <span className="muted" style={{ fontSize: 11, fontStyle: 'italic' }}>Empty</span>
        </div>
      )}
    </div>
  )
}

/* ── Lines sub-section (DnD-aware) ── */

interface LinesSectionProps {
  title: string
  lines: LineSlotView[][]
  section: Section
  roster: PlayerBadge[]
  dragOverAddr: SlotAddr | null
  onClickSlot: (lineIdx: number, slotIdx: number) => void
  onDragStart: (addr: SlotAddr & { kind: 'slot' }) => void
  onDragOver: (addr: SlotAddr) => void
  onDragLeave: () => void
  onDrop: (dst: SlotAddr) => void
  onDepthSelect: (addr: SlotAddr & { kind: 'slot' }, player: PlayerBadge) => void
  synergies?: LineSynergyView[]
}

function LinesSection({
  title, lines, section, roster, dragOverAddr,
  onClickSlot, onDragStart, onDragOver, onDragLeave, onDrop, onDepthSelect,
  synergies,
}: LinesSectionProps): JSX.Element {
  function addrMatches(a: SlotAddr | null, b: SlotAddr): boolean {
    if (!a || a.kind !== b.kind) return false
    if (a.kind === 'slot' && b.kind === 'slot') {
      return a.section === b.section && a.lineIdx === b.lineIdx && a.slotIdx === b.slotIdx
    }
    return false
  }

  return (
    <div className="stack" style={{ gap: 'var(--sp-2)' }}>
      <div className="panel-title">{title}</div>
      {lines.map((line, li) => (
        <div key={li} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'stretch' }}>
            <span className="muted small" style={{ width: 24, textAlign: 'right', alignSelf: 'center' }}>
              {li + 1}
            </span>
            {line.map((slot, si) => {
              const addr: SlotAddr & { kind: 'slot' } = { kind: 'slot', section, lineIdx: li, slotIdx: si }
              return (
                <SlotButton
                  key={`${li}-${si}`}
                  slotDef={slot}
                  addr={addr}
                  roster={roster}
                  dragOver={addrMatches(dragOverAddr, addr)}
                  onClickSlot={() => onClickSlot(li, si)}
                  onDragStart={onDragStart}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={() => onDrop(addr)}
                  onDepthSelect={onDepthSelect}
                />
              )
            })}
            {synergies?.[li] && (
              <div style={{ alignSelf: 'center', marginLeft: 'var(--sp-1)' }}>
                <SynergyBadge
                  synergy={synergies[li]!}
                  lineLabel={`Line ${li + 1}`}
                />
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Goalies row (separate — goalies are a flat array, not lines[][]) ── */

interface GoaliesRowProps {
  goalies: LineSlotView[]
  roster: PlayerBadge[]
  dragOverAddr: SlotAddr | null
  onClickSlot: (idx: number) => void
  onDragStart: (addr: SlotAddr & { kind: 'slot' }) => void
  onDragOver: (addr: SlotAddr) => void
  onDragLeave: () => void
  onDrop: (dst: SlotAddr) => void
  onDepthSelect: (addr: SlotAddr & { kind: 'slot' }, player: PlayerBadge) => void
}

function GoaliesRow({
  goalies, roster, dragOverAddr,
  onClickSlot, onDragStart, onDragOver, onDragLeave, onDrop, onDepthSelect,
}: GoaliesRowProps): JSX.Element {
  function addrMatches(a: SlotAddr | null, si: number): boolean {
    if (!a || a.kind !== 'slot') return false
    return a.section === 'goalies' && a.lineIdx === si
  }

  return (
    <div className="stack" style={{ gap: 'var(--sp-2)' }}>
      <div className="panel-title">Goalies</div>
      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        {goalies.map((slot, si) => {
          const addr: SlotAddr & { kind: 'slot' } = { kind: 'slot', section: 'goalies', lineIdx: si, slotIdx: 0 }
          return (
            <SlotButton
              key={si}
              slotDef={slot}
              addr={addr}
              roster={roster}
              dragOver={addrMatches(dragOverAddr, si)}
              onClickSlot={() => onClickSlot(si)}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={() => onDrop(addr)}
              onDepthSelect={onDepthSelect}
            />
          )
        })}
      </div>
    </div>
  )
}

/* ── tactics slider ── */
function TacticSlider({
  label, value, onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 30px', alignItems: 'center', gap: 8 }}>
      <span className="muted small" style={{ textAlign: 'right' }}>{label}</span>
      <input
        type="range" min={0} max={1} step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent)' }}
      />
      <span className="small mono" style={{ textAlign: 'right' }}>{Math.round(value * 100)}</span>
    </div>
  )
}

/* ── EHM-depth slider (same layout as TacticSlider but with end labels) ── */
function EhmSlider({
  label, value, onChange, leftLabel, rightLabel,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  leftLabel?: string
  rightLabel?: string
}): JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 28px', alignItems: 'center', gap: 6 }}>
      <span className="muted small" style={{ textAlign: 'right', fontSize: 11 }}>{label}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <input
          type="range" min={0} max={1} step={0.05}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--accent)' }}
        />
        {(leftLabel || rightLabel) && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 9, color: 'var(--muted)', opacity: 0.7 }}>{leftLabel}</span>
            <span style={{ fontSize: 9, color: 'var(--muted)', opacity: 0.7 }}>{rightLabel}</span>
          </div>
        )}
      </div>
      <span className="small mono" style={{ textAlign: 'right', fontSize: 11 }}>{Math.round(value * 100)}</span>
    </div>
  )
}

/* ── Personal Tactics panel ── */
interface PersonalTacticsProps {
  player: PlayerBadge
  pt: PersonalTactics
  onChange: (pt: PersonalTactics) => void
  onClose: () => void
}

function PersonalTacticsPanel({ player, pt, onChange, onClose }: PersonalTacticsProps): JSX.Element {
  function set<K extends keyof PersonalTactics>(key: K, val: PersonalTactics[K]): void {
    onChange({ ...pt, [key]: val })
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        className="panel"
        style={{ width: 360, display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row-between">
          <span style={{ fontWeight: 700, fontSize: 13 }}>Personal Tactics — {player.name}</span>
          <button className="btn btn-ghost" style={{ padding: '2px 8px' }} onClick={onClose}>✕</button>
        </div>

        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          {/* Shoot vs Pass */}
          <div>
            <div className="field-label" style={{ marginBottom: 4 }}>Shoot vs Pass</div>
            <div className="row" style={{ gap: 'var(--sp-2)' }}>
              {([-1, 0, 1] as const).map((v) => (
                <button
                  key={v}
                  className={`btn btn-sm ${(pt.shootVsPass ?? 0) === v ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ flex: 1, fontSize: 11 }}
                  onClick={() => set('shootVsPass', v)}
                >
                  {v === -1 ? 'Pass more' : v === 0 ? 'Default' : 'Shoot more'}
                </button>
              ))}
            </div>
          </div>

          {/* Entry style (engine-wired) */}
          <div>
            <div className="field-label" style={{ marginBottom: 4 }}>Zone entry style <span className="chip chip-accent" style={{ fontSize: 9, padding: '1px 5px' }}>Engine</span></div>
            <div className="row" style={{ gap: 'var(--sp-2)' }}>
              {(['default', 'carry', 'dump'] as const).map((v) => (
                <button
                  key={v}
                  className={`btn btn-sm ${(pt.entryStyle ?? 'default') === v ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ flex: 1, fontSize: 11, textTransform: 'capitalize' }}
                  onClick={() => set('entryStyle', v)}
                >
                  {v === 'default' ? 'Default' : v === 'carry' ? 'Always carry' : 'Dump & chase'}
                </button>
              ))}
            </div>
          </div>

          {/* Rush join (engine-wired) */}
          <div>
            <div className="field-label" style={{ marginBottom: 4 }}>Rush join <span className="chip chip-accent" style={{ fontSize: 9, padding: '1px 5px' }}>Engine</span></div>
            <div className="row" style={{ gap: 'var(--sp-2)' }}>
              {(['default', 'join', 'sit-back'] as const).map((v) => (
                <button
                  key={v}
                  className={`btn btn-sm ${(pt.rushJoin ?? 'default') === v ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ flex: 1, fontSize: 11 }}
                  onClick={() => set('rushJoin', v)}
                >
                  {v === 'default' ? 'Default' : v === 'join' ? 'Join rush' : 'Sit back'}
                </button>
              ))}
            </div>
          </div>

          {/* Fighting */}
          <div>
            <div className="field-label" style={{ marginBottom: 4 }}>Fighting</div>
            <div className="row" style={{ gap: 'var(--sp-2)' }}>
              {(['default', 'will-fight', 'avoid'] as const).map((v) => (
                <button
                  key={v}
                  className={`btn btn-sm ${(pt.fighting ?? 'default') === v ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ flex: 1, fontSize: 11 }}
                  onClick={() => set('fighting', v)}
                >
                  {v === 'default' ? 'Default' : v === 'will-fight' ? 'Will fight' : 'Avoid'}
                </button>
              ))}
            </div>
          </div>

          <div className="muted small" style={{ opacity: 0.7, fontSize: 10, marginTop: -4 }}>
            Engine-wired instructions affect simulation. Others are set-able intent for future depth.
          </div>
        </div>
      </div>
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

  // Local draft state for lines + tactics
  const [draftLines, setDraftLines] = useState<LinesView | null>(null)
  const [draftTactics, setDraftTactics] = useState<TeamTactics | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [applying, setApplying] = useState(false)
  const [coachBuilding, setCoachBuilding] = useState(false)

  // Picker state
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerContext, setPickerContext] = useState<{
    section: 'forwards' | 'defense' | 'goalies' | 'pp' | 'pk'
    lineIdx: number
    slotIdx: number
  } | null>(null)

  // Personal tactics modal
  const [ptPlayer, setPtPlayer] = useState<PlayerBadge | null>(null)

  // DnD state
  const [dragSrc, setDragSrc] = useState<SlotAddr | null>(null)
  const [dragOverAddr, setDragOverAddr] = useState<SlotAddr | null>(null)
  // Payload carried during drag (set on dragstart, consumed on drop)
  const dragPayloadRef = useRef<DragPayload | null>(null)

  // When fresh data arrives and no local draft, sync from server
  const lines = draftLines ?? data?.lines ?? null
  const tactics = draftTactics ?? data?.tactics ?? null

  function markDirty(): void { setDirty(true) }

  // ── lines mutation helpers ──

  function setLines(updater: (l: LinesView) => LinesView): void {
    const base = lines ?? data?.lines
    if (!base) return
    setDraftLines(updater(deepCloneLines(base)))
    markDirty()
  }

  function openPicker(
    section: 'forwards' | 'defense' | 'goalies' | 'pp' | 'pk',
    lineIdx: number,
    slotIdx: number,
  ): void {
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

  // Build a healthy roster for the picker/dropdown sorted by overall desc.
  function buildRoster(): PlayerBadge[] {
    if (!data) return []
    const fromSlots = [
      ...data.lines.forwards.flat(),
      ...data.lines.defensePairs.flat(),
      ...data.lines.goalies
    ]
      .map((s) => s.player)
      .filter((p): p is PlayerBadge => p != null)
    const healthy = fromSlots.concat(data.lines.scratches)
    // deduplicate
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
    // Record the drag source so handleDrop can resolve it. The dragged player is
    // looked up from the slot at drop time (getAtAddr), so playerId is a
    // placeholder here. (Scratch chips set their own full payload on drag start.)
    dragPayloadRef.current = { src: addr, playerId: '' }
    setDragSrc(addr)
  }, [])

  const handleDragOver = useCallback((addr: SlotAddr) => {
    setDragOverAddr(addr)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOverAddr(null)
  }, [])

  function handleDrop(dst: SlotAddr): void {
    // Try to read from ref first (set in onDragStart handler), then from state
    const payload = dragPayloadRef.current
    dragPayloadRef.current = null
    setDragSrc(null)
    setDragOverAddr(null)

    if (!payload || !lines) return

    const src = payload.src
    // Same address — no-op
    if (
      src.kind === 'slot' && dst.kind === 'slot' &&
      src.section === dst.section && src.lineIdx === dst.lineIdx && src.slotIdx === dst.slotIdx
    ) return
    if (src.kind === 'scratch' && dst.kind === 'scratch' && src.playerId === dst.kind) return

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
    // Parse payload from dataTransfer (the ref approach works within same component tree,
    // but dataTransfer is the reliable cross-element channel)
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
  // Selecting a player from the depth dropdown should:
  // - If the selected player is already in a slot elsewhere, swap them.
  // - If the selected player is in scratches, place them (old slot occupant goes to scratches).
  // - Then set the target slot to the selected player.
  function handleDepthSelect(targetAddr: SlotAddr & { kind: 'slot' }, chosen: PlayerBadge): void {
    setLines((l) => {
      // Find where the chosen player currently lives
      let chosenSrc: SlotAddr | null = null

      // Search slots
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

      // Check scratches
      if (!chosenSrc && l.scratches.some((p) => p.playerId === chosen.playerId)) {
        chosenSrc = { kind: 'scratch', playerId: chosen.playerId }
      }

      if (!chosenSrc) return l // player not found (stale roster)

      applyDrop(l, chosenSrc, targetAddr, chosen)
      return l
    })
  }

  // ── tactics mutation helpers ──

  function setPersonalTactics(playerId: string, pt: PersonalTactics): void {
    setTacticsFn((t) => {
      const existing = t.personalTactics ?? {}
      return { ...t, personalTactics: { ...existing, [playerId]: pt } }
    })
  }

  // Tactics are owned by the head coach (set via staff-meeting suggestions),
  // so the GM can no longer edit the system directly. This is intentionally a
  // no-op; the System panel renders read-only and changes flow through
  // suggestToCoach instead. `updater` is accepted to keep call sites unchanged.
  function setTacticsFn(_updater: (t: TeamTactics) => TeamTactics): void {
    /* coach-owned: no direct GM edits */
  }

  // ── save / revert ──

  async function handleSave(): Promise<void> {
    if (!lines || !tactics || !dirty) return
    setSaving(true)
    try {
      const linesRes = await client.setLines(linesViewToUpdate(lines))
      if (linesRes.type === 'error') {
        toast(linesRes.message, 'error')
        setSaving(false)
        return
      }
      const tacRes = await client.setTactics(tactics)
      if (tacRes.type === 'error') {
        toast(tacRes.message, 'error')
        setSaving(false)
        return
      }
      toast('Tactics saved.', 'success')
      setDraftLines(null)
      setDraftTactics(null)
      setDirty(false)
      bumpRefresh()
    } catch {
      toast('Save failed.', 'error')
    } finally {
      setSaving(false)
    }
  }

  function handleRevert(): void {
    setDraftLines(null)
    setDraftTactics(null)
    setDirty(false)
    refetch()
  }

  async function handleApplyCoachSuggestion(): Promise<void> {
    if (!data) return
    setApplying(true)
    try {
      const res = await client.applyCoachSuggestion(data.coachSuggestion.suggestedTactics)
      if (res.type === 'error') {
        toast(res.message, 'error')
      } else {
        toast('Coach suggestion applied.', 'success')
        setDraftLines(null)
        setDraftTactics(null)
        setDirty(false)
        bumpRefresh()
      }
    } catch {
      toast('Failed to apply suggestion.', 'error')
    } finally {
      setApplying(false)
    }
  }

  async function handleCoachSetLines(): Promise<void> {
    setCoachBuilding(true)
    try {
      const res = await client.coachSetLines()
      if (res.type === 'error') {
        toast(res.message, 'error')
      } else if (res.type === 'coachLines') {
        setDraftLines(deepCloneLines(res.lines))
        setDirty(true)
        toast('Coach set the lines.', 'success')
      }
    } catch {
      toast('Failed to get coach lines.', 'error')
    } finally {
      setCoachBuilding(false)
    }
  }

  // ── picker data ──
  const pickerSlot = getPickerSlot()
  const roster = buildRoster()

  // Is the scratches area currently a drop target?
  const scratchDragOver = dragOverAddr?.kind === 'scratch'

  // Common DnD slot props builder for LinesSection/GoaliesRow
  // We pass the raw handlers since each slot needs to set up its own DnD via div props.
  // The sections pass through the addr-based callbacks; slot divs wire up native events.

  // Shared DnD callbacks passed to sub-components
  const dndHandlers = {
    dragOverAddr,
    onDragStart: handleDragStart,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDepthSelect: handleDepthSelect,
  }

  // Section slots call this with their address on drop. It must INVOKE the drop
  // (not return a handler) — sections wire it as onDrop(addr) directly.
  function makeSectionDropHandler(dst: SlotAddr & { kind: 'slot' }): void {
    handleDrop(dst)
  }

  // Override SlotButton to wire native drag events via wrapper div approach.
  // The sub-components (LinesSection, GoaliesRow) pass onDrop as a simple callback,
  // but we need access to the DragEvent for dataTransfer. We handle this by using
  // dragPayloadRef which is set in onDragStart — for same-window drags this always works.

  void dragSrc // referenced to avoid lint warning (used in dragPayloadRef logic)

  return (
    <section className="stack" style={{ paddingBottom: dirty ? 72 : 0 }}>
      <ScreenHeader title="Tactics &amp; Lines" />

      {error && <Notice kind="warn">{error}</Notice>}
      {loading && !data && <Notice kind="info">Loading…</Notice>}

      {data && lines && tactics && (
        <>
          {/* ── Issues ── */}
          {lines.issues.length > 0 && (
            <Notice kind="warn">
              <strong>Line issues:</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                {lines.issues.map((iss, i) => <li key={i}>{iss}</li>)}
              </ul>
            </Notice>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(500px,2fr) minmax(300px,1fr)', gap: 'var(--sp-4)', alignItems: 'start' }}>
            {/* ── LEFT: lines editor ── */}
            <div className="stack">
              <div className="row-between" style={{ marginBottom: -4 }}>
                <span className="panel-title" style={{ fontSize: 13, fontWeight: 700 }}>Lines</span>
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
              <Panel title="Lines">
                <div className="stack" style={{ gap: 'var(--sp-5)' }}>
                  <LinesSection
                    title="Forwards"
                    lines={lines.forwards}
                    section="forwards"
                    roster={roster}
                    {...dndHandlers}
                    onClickSlot={(li, si) => openPicker('forwards', li, si)}
                    onDrop={makeSectionDropHandler}
                    synergies={data.lineSynergies}
                  />
                  <LinesSection
                    title="Defence Pairs"
                    lines={lines.defensePairs}
                    section="defense"
                    roster={roster}
                    {...dndHandlers}
                    onClickSlot={(li, si) => openPicker('defense', li, si)}
                    onDrop={makeSectionDropHandler}
                    synergies={data.pairSynergies}
                  />

                  {/* Goalies */}
                  <GoaliesRow
                    goalies={lines.goalies}
                    roster={roster}
                    {...dndHandlers}
                    onClickSlot={(si) => openPicker('goalies', si, 0)}
                    onDrop={makeSectionDropHandler}
                  />
                </div>
              </Panel>

              <Panel title="Special Teams">
                <div className="stack" style={{ gap: 'var(--sp-5)' }}>
                  <LinesSection
                    title="Power Play"
                    lines={lines.powerPlayUnits}
                    section="pp"
                    roster={roster}
                    {...dndHandlers}
                    onClickSlot={(li, si) => openPicker('pp', li, si)}
                    onDrop={makeSectionDropHandler}
                  />
                  <LinesSection
                    title="Penalty Kill"
                    lines={lines.penaltyKillUnits}
                    section="pk"
                    roster={roster}
                    {...dndHandlers}
                    onClickSlot={(li, si) => openPicker('pk', li, si)}
                    onDrop={makeSectionDropHandler}
                  />
                </div>
              </Panel>

              {/* Depth pool / Scratches — drop target, grouped by position */}
              <div
                onDragOver={handleScratchDragOver}
                onDragLeave={() => setDragOverAddr(null)}
                onDrop={handleScratchDrop}
                style={{
                  borderRadius: 'var(--radius)',
                  border: scratchDragOver
                    ? '1px solid var(--accent)'
                    : '1px solid var(--line)',
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
                  // Group by position category
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
                                <span style={{ fontSize: 12 }}>{p.name}</span>
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

            {/* ── RIGHT: Coach's System (read-only info feed) ── */}
            <div className="stack">
              <div className="muted small" style={{ fontStyle: 'italic', lineHeight: 1.5 }}>
                Your head coach owns the system — below is a read-only view of what he’s running.
                To change it, make a suggestion in Front Office → Staff Meeting.
              </div>
              <div className="stack" style={{ pointerEvents: 'none', opacity: 0.85 }}>
              <Panel title="System">
                <div className="stack" style={{ gap: 'var(--sp-4)' }}>

                  {/* Forecheck */}
                  <div>
                    <label className="field-label">Forecheck</label>
                    <select
                      className="select"
                      value={tactics.forecheck}
                      onChange={(e) => setTacticsFn((t) => ({ ...t, forecheck: e.target.value as ForecheckSystem }))}
                    >
                      <option value="1-2-2">1-2-2 (passive)</option>
                      <option value="2-1-2">2-1-2 (aggressive)</option>
                      <option value="trap">Trap</option>
                    </select>
                  </div>

                  {/* D-zone coverage */}
                  <div>
                    <label className="field-label">D-zone coverage</label>
                    <select
                      className="select"
                      value={tactics.dZoneCoverage}
                      onChange={(e) => setTacticsFn((t) => ({ ...t, dZoneCoverage: e.target.value as DefensiveZoneCoverage }))}
                    >
                      <option value="man">Man-to-man</option>
                      <option value="zone">Zone</option>
                      <option value="hybrid">Hybrid</option>
                    </select>
                  </div>
                </div>
              </Panel>

              <Panel title="Tempo">
                <div className="stack" style={{ gap: 10 }}>
                  <TacticSlider
                    label="Pace"
                    value={tactics.tempo.pace}
                    onChange={(v) => setTacticsFn((t) => ({ ...t, tempo: { ...t.tempo, pace: v } }))}
                  />
                  <TacticSlider
                    label="Pass risk"
                    value={tactics.tempo.passRisk}
                    onChange={(v) => setTacticsFn((t) => ({ ...t, tempo: { ...t.tempo, passRisk: v } }))}
                  />
                  <TacticSlider
                    label="Shot eagerness"
                    value={tactics.tempo.shotEagerness}
                    onChange={(v) => setTacticsFn((t) => ({ ...t, tempo: { ...t.tempo, shotEagerness: v } }))}
                  />
                  <TacticSlider
                    label="Defensive pinch"
                    value={tactics.tempo.defensivePinch}
                    onChange={(v) => setTacticsFn((t) => ({ ...t, tempo: { ...t.tempo, defensivePinch: v } }))}
                  />
                </div>
              </Panel>

              <Panel title="Special Teams Formations">
                <div className="stack" style={{ gap: 'var(--sp-4)' }}>
                  <div>
                    <label className="field-label">Power play formation</label>
                    <select
                      className="select"
                      value={tactics.specialTeams.powerPlay}
                      onChange={(e) => setTacticsFn((t) => ({
                        ...t, specialTeams: { ...t.specialTeams, powerPlay: e.target.value as PowerPlayFormation }
                      }))}
                    >
                      <option value="umbrella">Umbrella</option>
                      <option value="1-3-1">1-3-1</option>
                      <option value="overload">Overload</option>
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Penalty kill formation</label>
                    <select
                      className="select"
                      value={tactics.specialTeams.penaltyKill}
                      onChange={(e) => setTacticsFn((t) => ({
                        ...t, specialTeams: { ...t.specialTeams, penaltyKill: e.target.value as PenaltyKillFormation }
                      }))}
                    >
                      <option value="box">Box</option>
                      <option value="diamond">Diamond</option>
                      <option value="aggressive">Aggressive</option>
                    </select>
                  </div>
                </div>
              </Panel>

              <Panel title="Matching">
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={tactics.lineMatching}
                    onChange={(e) => setTacticsFn((t) => ({ ...t, lineMatching: e.target.checked }))}
                    style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
                  />
                  <span>Line matching (shadow opponent's top line)</span>
                </label>
              </Panel>

              {/* ── EHM Style sliders ── */}
              <Panel title="Style">
                <div className="stack" style={{ gap: 10 }}>
                  <EhmSlider
                    label="Aggressiveness"
                    value={tactics.aggressiveness ?? 0.5}
                    onChange={(v) => setTacticsFn((t) => ({ ...t, aggressiveness: v }))}
                    leftLabel="Disciplined"
                    rightLabel="Physical"
                  />
                  <EhmSlider
                    label="Hitting"
                    value={tactics.hitting ?? 0.5}
                    onChange={(v) => setTacticsFn((t) => ({ ...t, hitting: v }))}
                    leftLabel="Avoid"
                    rightLabel="Punishing"
                  />
                  <EhmSlider
                    label="Puck pressure"
                    value={tactics.puckPressure ?? 0.5}
                    onChange={(v) => setTacticsFn((t) => ({ ...t, puckPressure: v }))}
                    leftLabel="Passive"
                    rightLabel="Swarming"
                  />
                  <EhmSlider
                    label="Gap control"
                    value={tactics.gapControl ?? 0.5}
                    onChange={(v) => setTacticsFn((t) => ({ ...t, gapControl: v }))}
                    leftLabel="Loose"
                    rightLabel="Tight"
                  />
                  <EhmSlider
                    label="Shooting"
                    value={tactics.shooting ?? 0.5}
                    onChange={(v) => setTacticsFn((t) => ({ ...t, shooting: v }))}
                    leftLabel="Patient"
                    rightLabel="Shoot on sight"
                  />
                  <EhmSlider
                    label="Passing"
                    value={tactics.passing ?? 0.5}
                    onChange={(v) => setTacticsFn((t) => ({ ...t, passing: v }))}
                    leftLabel="Individual"
                    rightLabel="High movement"
                  />
                  <EhmSlider
                    label="Dumping"
                    value={tactics.dumping ?? 0.5}
                    onChange={(v) => setTacticsFn((t) => ({ ...t, dumping: v }))}
                    leftLabel="Always carry"
                    rightLabel="Always dump"
                  />
                  <EhmSlider
                    label="Backchecking"
                    value={tactics.backchecking ?? 0.5}
                    onChange={(v) => setTacticsFn((t) => ({ ...t, backchecking: v }))}
                    leftLabel="Float"
                    rightLabel="Hard back"
                  />
                  <EhmSlider
                    label="Mentality"
                    value={tactics.mentality ?? 0.5}
                    onChange={(v) => setTacticsFn((t) => ({ ...t, mentality: v }))}
                    leftLabel="Defensive"
                    rightLabel="All-out attack"
                  />
                </div>
                <div className="muted small" style={{ marginTop: 8, opacity: 0.65, fontSize: 10 }}>
                  Bold items affect the sim; others are intent for future depth.
                </div>
              </Panel>

              {/* ── Positional systems ── */}
              <Panel title="Positional Systems">
                <div className="stack" style={{ gap: 'var(--sp-3)' }}>
                  <div>
                    <label className="field-label">Breakout</label>
                    <select
                      className="select"
                      value={tactics.breakout ?? 'wheel'}
                      onChange={(e) => setTacticsFn((t) => ({ ...t, breakout: e.target.value as BreakoutSystem }))}
                    >
                      <option value="wheel">Wheel</option>
                      <option value="rim">Rim</option>
                      <option value="reverse">Reverse</option>
                    </select>
                  </div>
                  <div>
                    <label className="field-label">NZ Offensive</label>
                    <select
                      className="select"
                      value={tactics.nzOffensive ?? 'controlled'}
                      onChange={(e) => setTacticsFn((t) => ({ ...t, nzOffensive: e.target.value as NzOffensiveSystem }))}
                    >
                      <option value="controlled">Controlled</option>
                      <option value="stretch">Stretch passes</option>
                      <option value="overload">Overload</option>
                    </select>
                  </div>
                  <div>
                    <label className="field-label">NZ Defensive</label>
                    <select
                      className="select"
                      value={tactics.nzDefensive ?? 'standard'}
                      onChange={(e) => setTacticsFn((t) => ({ ...t, nzDefensive: e.target.value as NzDefensiveSystem }))}
                    >
                      <option value="standard">Standard</option>
                      <option value="trap">Trap</option>
                      <option value="aggressive">Aggressive</option>
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Zone entry preference</label>
                    <select
                      className="select"
                      value={tactics.ozEntry ?? 'mixed'}
                      onChange={(e) => setTacticsFn((t) => ({ ...t, ozEntry: e.target.value as OzEntry }))}
                    >
                      <option value="mixed">Mixed</option>
                      <option value="carry">Carry in</option>
                      <option value="dump">Dump &amp; chase</option>
                    </select>
                  </div>
                  <div>
                    <label className="field-label">DZone structure</label>
                    <select
                      className="select"
                      value={tactics.dZoneStructure ?? 'contain'}
                      onChange={(e) => setTacticsFn((t) => ({ ...t, dZoneStructure: e.target.value as DZoneStructure }))}
                    >
                      <option value="contain">Contain</option>
                      <option value="collapse">Collapse</option>
                      <option value="aggressive">Aggressive</option>
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Shot targeting</label>
                    <select
                      className="select"
                      value={tactics.shotTargeting ?? 'mixed'}
                      onChange={(e) => setTacticsFn((t) => ({ ...t, shotTargeting: e.target.value as ShotTargeting }))}
                    >
                      <option value="mixed">Mixed</option>
                      <option value="corners">Corners</option>
                      <option value="high-glove">High glove</option>
                      <option value="blocker">Blocker side</option>
                      <option value="five-hole">Five-hole</option>
                    </select>
                  </div>
                </div>
              </Panel>

              {/* ── Faceoff plays ── */}
              <Panel title="Faceoff Plays">
                <div className="stack" style={{ gap: 'var(--sp-3)' }}>
                  <div>
                    <label className="field-label">Offensive zone</label>
                    <select
                      className="select"
                      value={tactics.offensiveFaceoff ?? 'standard'}
                      onChange={(e) => setTacticsFn((t) => ({ ...t, offensiveFaceoff: e.target.value as FaceoffPlay }))}
                    >
                      <option value="standard">Standard</option>
                      <option value="wheel">Wheel</option>
                      <option value="quick-strike">Quick strike</option>
                      <option value="tie-up">Tie-up</option>
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Defensive zone</label>
                    <select
                      className="select"
                      value={tactics.defensiveFaceoff ?? 'standard'}
                      onChange={(e) => setTacticsFn((t) => ({ ...t, defensiveFaceoff: e.target.value as FaceoffPlay }))}
                    >
                      <option value="standard">Standard</option>
                      <option value="tie-up">Tie-up</option>
                      <option value="wheel">Wheel</option>
                      <option value="quick-strike">Quick clear</option>
                    </select>
                  </div>
                </div>
              </Panel>

              {/* ── Personal Tactics (roster list) ── */}
              <Panel title="Personal Tactics">
                <div className="stack" style={{ gap: 6 }}>
                  <div className="muted small" style={{ opacity: 0.75, fontSize: 10, marginBottom: 2 }}>
                    Click a player to set individual instructions. Engine-wired instructions affect the sim.
                  </div>
                  {roster.slice(0, 20).map((p) => {
                    const pt = tactics.personalTactics?.[p.playerId]
                    const hasInstructions = pt && Object.values(pt).some((v) => v !== undefined && v !== 'default' && v !== 0)
                    return (
                      <button
                        key={p.playerId}
                        className="btn btn-ghost btn-sm"
                        style={{
                          justifyContent: 'flex-start',
                          gap: 6,
                          padding: '4px 8px',
                          borderColor: hasInstructions ? 'var(--accent)' : 'transparent',
                          background: hasInstructions ? 'rgba(var(--accent-rgb),0.08)' : undefined,
                          width: '100%',
                        }}
                        onClick={() => setPtPlayer(p)}
                      >
                        <PlayerFace faceId={p.faceId} name={p.name} size={18} />
                        <span className="muted" style={{ fontSize: 10, width: 22 }}>{p.position}</span>
                        <span style={{ flex: 1, fontSize: 12, textAlign: 'left' }}>{p.name}</span>
                        {hasInstructions && <span className="chip chip-accent" style={{ fontSize: 9, padding: '1px 5px' }}>Custom</span>}
                      </button>
                    )
                  })}
                </div>
              </Panel>

              </div>

              <CoachPanel
                suggestion={data.coachSuggestion}
                styleFit={data.styleFit}
                onApply={handleApplyCoachSuggestion}
                applying={applying}
              />
            </div>
          </div>

          {/* ── Sticky save bar ── */}
          {dirty && (
            <div
              style={{
                position: 'fixed', bottom: 0, left: 210, right: 0, zIndex: 30,
                background: 'var(--bg1)',
                borderTop: '1px solid var(--line)',
                padding: 'var(--sp-3) var(--sp-5)',
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                gap: 'var(--sp-3)',
              }}
            >
              <span className="muted small">You have unsaved changes.</span>
              <button className="btn" onClick={handleRevert} disabled={saving}>Revert</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          )}

          {/* ── Picker modal ── */}
          {pickerOpen && pickerContext && (
            <PlayerPicker
              slot={pickerSlot?.slot ?? pickerContext.section}
              current={pickerSlot?.player ?? null}
              roster={roster}
              onSelect={handlePickerSelect}
              onClose={() => setPickerOpen(false)}
            />
          )}

          {/* ── Personal Tactics modal ── */}
          {ptPlayer && tactics && (
            <PersonalTacticsPanel
              player={ptPlayer}
              pt={tactics.personalTactics?.[ptPlayer.playerId] ?? {}}
              onChange={(pt) => {
                setPersonalTactics(ptPlayer.playerId, pt)
              }}
              onClose={() => setPtPlayer(null)}
            />
          )}
        </>
      )}
    </section>
  )
}
