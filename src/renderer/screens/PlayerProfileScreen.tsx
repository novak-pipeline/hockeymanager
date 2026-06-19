/**
 * Player Profile — tabbed FM-style view.
 *
 * Tabs:
 *   1. Profile   — face/bio header, attribute groups, radar + stat bars, personality reads, status
 *   2. Positions — position(s), role, archetype/descriptor suitability
 *   3. Information — birthplace, nationality, honours, draft status, international record
 *   4. Contract  — salary, cap hit, buried cap hit, FA status, expiry, clauses
 *   5. History   — season-by-season stat table
 *   6. Scout Report — fogged personality reads framed as a scout's write-up + projection
 *
 * Compare control on the Profile tab: pick a second player from the squad
 * (dropdown) → overlays their radar via client.compareRadar() and shows
 * key-stat lines side by side.
 */
import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import type { PlayerProfileView, CompareRadarView } from '../../worker/protocol'
import type {
  SkaterSeasonLine,
  GoalieSeasonLine,
  ArchetypeInfo,
  ReportCard,
  ReportGrade,
  MindsetView,
  InterviewView,
  ScoutPanel,
  ScoutRead,
  RiskBand,
  PlayerTrait,
  TraitRarity,
} from '../../engine/career/views'
import { RADAR_AXES } from '../../engine/career/views'
import type { SquadView } from '../../engine/career/views'
import { useNav, TeamLink, PlayerLink } from '../components/NavContext'
import { fmtMoney, fmtToi, moraleWord, moraleColor } from '../components/format'
import { FlagIcon } from '../components/FlagIcon'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'
import { overallToStars } from '../../engine/ratings/composites'
import { toast, bumpRefresh } from '../components/store'
import { PlayerFace } from '../components/PlayerFace'
import { RadarChart } from '../components/RadarChart'
import { ThemeScope } from '../components/ThemeScope'

/* ── Scout this player: send a scout straight from the profile ───────────────── */
function ScoutPlayerButton({ playerId, client }: { playerId: string; client: ReturnType<typeof useClient> }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [scouts, setScouts] = useState<Array<{ scoutId: string; name: string; rating: number }>>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)

  async function toggle(): Promise<void> {
    if (!open && !loaded) {
      const res = await client.getScouting()
      if (res.type === 'scouting') {
        setScouts(res.scouting.scouts.map((s) => ({ scoutId: s.scoutId, name: s.name, rating: s.rating })))
      }
      setLoaded(true)
    }
    setOpen((o) => !o)
  }
  async function pick(scoutId: string, name: string): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const res = await client.assignScout(scoutId, { kind: 'player', playerId }, 'all')
      if (res.type === 'error') toast(res.message, 'error')
      else { toast(`${name} assigned to watch this player.`, 'success'); bumpRefresh() }
    } finally { setBusy(false); setOpen(false) }
  }
  return (
    <span style={{ position: 'relative' }}>
      <button className="btn btn-primary small" onClick={() => void toggle()}>🔍 Scout Player</button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 60, background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: 6, minWidth: 200, boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
          <div className="muted small" style={{ padding: '6px 10px 2px', fontWeight: 700 }}>Send a scout to watch him</div>
          {scouts.length === 0 ? (
            <div className="muted small" style={{ padding: '4px 12px 8px' }}>No scouts on staff — hire one in Staff › Job Market.</div>
          ) : scouts.map((s) => (
            <button key={s.scoutId} className="btn-ghost" style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px', fontSize: 12 }}
              onClick={() => void pick(s.scoutId, s.name)}>
              {s.name} <span className="muted">({s.rating})</span>
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

/* ═══════════════════════════ TAB DEFINITION ═══════════════════════════ */

type TabId = 'profile' | 'positions' | 'information' | 'contract' | 'history' | 'scout' | 'opinion'

const TABS: { id: TabId; label: string }[] = [
  { id: 'profile',     label: 'Profile' },
  { id: 'positions',   label: 'Positions & Roles' },
  { id: 'information', label: 'Information' },
  { id: 'contract',    label: 'Contract' },
  { id: 'history',     label: 'History' },
  { id: 'scout',       label: 'Scout Report' },
  { id: 'opinion',     label: 'Progress' },
]

/* ═══════════════════════════ SUB-COMPONENTS ═══════════════════════════ */

function ArchetypeChip({ archetype }: { archetype: ArchetypeInfo | undefined }): JSX.Element | null {
  if (!archetype) return null
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--sp-2)',
        background: 'var(--violet-dim)',
        border: '1px solid var(--accent)',
        borderRadius: 'var(--radius-sm)',
        padding: '3px 10px',
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--violet-h)',
      }}
      title={archetype.descriptors.length > 0 ? archetype.descriptors.join(' · ') : archetype.label}
    >
      {archetype.label}
      {archetype.descriptors.length > 0 && (
        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {archetype.descriptors.slice(0, 3).map((d) => (
            <span
              key={d}
              style={{
                background: 'rgba(var(--accent-rgb),0.18)',
                borderRadius: 3,
                padding: '1px 5px',
                fontSize: 10,
                color: 'var(--muted)',
                fontWeight: 500,
              }}
            >
              {d}
            </span>
          ))}
        </span>
      )}
    </span>
  )
}

/* Star rating uses the canonical NHL-calibrated scale (see overallToStars in
 * @engine/ratings/composites): 1★ below-NHL, 2★ AHL, 3★ regular, 4★ good, 5★ great. */

/** FM-style improving/declining trend arrow. Green ▲ rising, red ▼ falling,
 *  nothing when steady (keeps the UI quiet for the majority who aren't moving). */
function TrendArrow({
  trend,
  size = 12,
  title,
}: {
  trend: 'up' | 'down' | 'steady'
  size?: number
  title?: string
}): JSX.Element | null {
  if (trend === 'steady') return null
  const up = trend === 'up'
  return (
    <span
      title={title ?? (up ? 'Improving' : 'Declining')}
      style={{ fontSize: size, lineHeight: 1, color: up ? 'var(--good, #4ade80)' : 'var(--bad, #f87171)' }}
    >
      {up ? '▲' : '▼'}
    </span>
  )
}

/** Renders a 5-star display supporting half-stars (★ / ½★ / ☆). */
function StarRating({
  stars,
  fogged = false,
  size = 20,
}: {
  stars: number
  fogged?: boolean
  size?: number
}): JSX.Element {
  const filled = Math.floor(stars)
  const half = stars - filled >= 0.5
  return (
    <span
      title={fogged ? 'Approximate rating' : `${stars}/5`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 1, opacity: fogged ? 0.65 : 1 }}
    >
      {Array.from({ length: 5 }, (_, i) => {
        if (i < filled) {
          return (
            <span key={i} style={{ fontSize: size, color: 'var(--accent2)', lineHeight: 1 }}>★</span>
          )
        }
        if (i === filled && half) {
          /* Half-star: overlay a clipped full star on an empty star. */
          return (
            <span key={i} style={{ fontSize: size, position: 'relative', display: 'inline-block', lineHeight: 1, color: 'var(--line)' }}>
              ★
              <span style={{
                position: 'absolute', left: 0, top: 0, width: '50%', overflow: 'hidden',
                color: 'var(--accent2)', display: 'inline-block',
              }}>★</span>
            </span>
          )
        }
        return (
          <span key={i} style={{ fontSize: size, color: 'var(--line)', lineHeight: 1 }}>★</span>
        )
      })}
    </span>
  )
}

function PotentialStars({ count }: { count: number }): JSX.Element {
  // Render halves like StarRating so the POTENTIAL tile and the "Our ceiling"
  // row (which both bind the same number) never disagree visually.
  const filled = Math.floor(count)
  const half = count - filled >= 0.5
  return (
    <span title={`${count}/5 potential`} style={{ letterSpacing: 2 }}>
      {Array.from({ length: 5 }, (_, i) => {
        if (i < filled) return <span key={i} style={{ color: 'var(--accent2)', fontSize: 13 }}>★</span>
        if (i === filled && half) {
          return (
            <span key={i} style={{ fontSize: 13, position: 'relative', display: 'inline-block', lineHeight: 1, color: 'var(--line)' }}>
              ★
              <span style={{ position: 'absolute', left: 0, top: 0, width: '50%', overflow: 'hidden', color: 'var(--accent2)', display: 'inline-block' }}>★</span>
            </span>
          )
        }
        return <span key={i} style={{ color: 'var(--line)', fontSize: 13 }}>★</span>
      })}
    </span>
  )
}

/** FM-style condition heart: green → yellow → orange → red as fitness drops. */
function conditionColor(pct: number): string {
  if (pct >= 90) return 'var(--success, #22c55e)'
  if (pct >= 75) return '#a3e635' // yellow-green
  if (pct >= 55) return 'var(--amber, #f59e0b)'
  if (pct >= 35) return '#fb923c' // orange
  return 'var(--danger, #ef4444)'
}

function ConditionHeart({ value, size = 18 }: { value: number; size?: number }): JSX.Element {
  const pct = Math.max(0, Math.min(100, value))
  const color = conditionColor(pct)
  return (
    <span
      title={`Condition ${pct}%`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" aria-label="condition" style={{ display: 'block' }}>
        <path
          d="M12 21s-7.5-4.9-10-9.6C.6 8.4 2.1 5 5.4 5c2 0 3.4 1.1 4.3 2.4l.4.6.4-.6C11.4 6.1 12.8 5 14.8 5c3.3 0 4.8 3.4 3.4 6.4C19.5 16.1 12 21 12 21z"
          fill={color}
        />
      </svg>
    </span>
  )
}

/**
 * EHM-style 1–20 attribute row: label + slim bar + colour-coded number.
 *
 * Mapping 0–99 → 1–20: round(v/5) clamped [1, 20].
 * Fog: when masked show "?" and a grey band across the lo–hi range.
 *
 * Colour tiers (EHM convention):
 *   17–20 → strong green (--success)
 *   14–16 → green
 *   8–13  → amber (--accent2)
 *   1–7   → red (--danger)
 */
function to20(v: number): number {
  return Math.max(1, Math.min(20, Math.round(v / 5)))
}

function attrColor20(v20: number): string {
  if (v20 >= 17) return 'var(--success)'
  if (v20 >= 14) return 'rgba(52,211,153,0.85)'
  if (v20 >= 8) return 'var(--accent2)'
  return 'var(--danger)'
}

function AttrBar({
  label,
  value,
  lo,
  hi,
  masked,
}: {
  label: string
  value: number
  lo?: number
  hi?: number
  masked?: boolean
}): JSX.Element {
  /* FM-style: attribute name on the left, a colour-coded number on the right.
     No bars — clean and scannable. Fogged attributes show a lo–hi range. */
  const row = (right: JSX.Element): JSX.Element => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, padding: '1.5px 0' }}>
      <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {right}
    </div>
  )

  if (masked && lo !== undefined && hi !== undefined && lo !== hi) {
    return row(<span className="mono muted" style={{ fontSize: 12, fontWeight: 600 }}>{to20(lo)}–{to20(hi)}</span>)
  }

  const v20 = to20(value)
  return row(<span className="mono" style={{ color: attrColor20(v20), fontWeight: 700, fontSize: 13, minWidth: 16, textAlign: 'right' }}>{v20}</span>)
}

/* Skater / Goalie row helpers for the history table. */
function SkaterHistoryRow({ s }: { s: SkaterSeasonLine }): JSX.Element {
  return (
    <>
      <td className="num">{s.gamesPlayed}</td>
      <td className="num">{s.goals}</td>
      <td className="num">{s.assists}</td>
      <td className="num"><strong>{s.points}</strong></td>
      <td className="num" style={{ color: s.plusMinus > 0 ? 'var(--success)' : s.plusMinus < 0 ? 'var(--danger)' : undefined }}>
        {s.plusMinus > 0 ? `+${s.plusMinus}` : s.plusMinus}
      </td>
      <td className="num">{s.penaltyMinutes}</td>
      <td className="num">{fmtToi(s.toiPerGame)}</td>
      <td className="num">{s.ppGoals}+{s.ppAssists}</td>
    </>
  )
}

function GoalieHistoryRow({ g }: { g: GoalieSeasonLine }): JSX.Element {
  return (
    <>
      <td className="num">{g.gamesPlayed}</td>
      <td className="num">{g.wins}</td>
      <td className="num">{g.losses}</td>
      <td className="num">.{Math.round(g.savePct * 1000)}</td>
      <td className="num">{g.goalsAgainstAverage.toFixed(2)}</td>
      <td className="num">{g.shutouts}</td>
      <td className="num"></td>
      <td className="num"></td>
    </>
  )
}

/* Small info row used across Information + Contract tabs. */
function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }): JSX.Element | null {
  if (value === null || value === undefined || value === '') return null
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderTop: '1px solid var(--line)' }}>
      <span className="muted small">{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{value}</span>
    </div>
  )
}

/* ── Report card grade display ── */
function gradeColor(g: ReportGrade): string {
  if (g === 'A+' || g === 'A') return 'var(--success, #4caf72)'
  if (g === 'B+' || g === 'B') return 'rgba(52,211,153,0.9)'
  if (g === 'C+' || g === 'C') return 'var(--accent2, #e0b341)'
  if (g === 'D') return '#e08a3c'
  return 'var(--danger, #d8584f)'
}

/** Colour for the composite prospect grade (finer scale incl. A-/B-/C-). */
function prospectGradeColor(g: string): string {
  const c = g.charAt(0)
  if (c === 'A') return 'var(--success, #4caf72)'
  if (c === 'B') return 'rgba(52,211,153,0.9)'
  if (c === 'C') return 'var(--accent2, #e0b341)'
  if (c === 'D') return '#e08a3c'
  return 'var(--danger, #d8584f)'
}

/** The prospect-grade badge with a hover tooltip explaining what the scouts
 *  weighed (talent, team need, system fit, position, risk, value). */
function ProspectGradeBadge({ grade, pros, cons }: { grade: string; pros: string[]; cons: string[] }): JSX.Element {
  const [hover, setHover] = useState(false)
  const col = prospectGradeColor(grade)
  const hasWhy = pros.length > 0 || cons.length > 0
  return (
    <div style={{ position: 'relative', flex: '0 0 auto' }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div style={{
        width: 78, textAlign: 'center', padding: '12px 8px', borderRadius: 'var(--radius-md, 10px)',
        background: `${col}1f`, border: `1.5px solid ${col}`, cursor: hasWhy ? 'help' : 'default',
      }}>
        <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, color: col }}>{grade}</div>
        <div className="muted" style={{ fontSize: 8.5, letterSpacing: 0.6, marginTop: 5 }}>PROSPECT GRADE</div>
      </div>
      {hover && hasWhy && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 70, width: 300,
          background: 'var(--bg2)', border: '1px solid var(--line)', borderRadius: 8,
          padding: '10px 12px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          <div className="muted" style={{ fontSize: 10, letterSpacing: 0.5, marginBottom: 6 }}>WHAT THE SCOUTS WEIGHED</div>
          {pros.map((s, i) => (
            <div key={`p${i}`} style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--text)' }}>
              <span style={{ color: 'var(--success, #4caf72)', fontWeight: 800 }}>+</span> {s}
            </div>
          ))}
          {cons.map((s, i) => (
            <div key={`c${i}`} style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--text)' }}>
              <span style={{ color: 'var(--danger, #d8584f)', fontWeight: 800 }}>−</span> {s}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const GRADE_ORDER: ReportGrade[] = ['F', 'D', 'C', 'C+', 'B', 'B+', 'A', 'A+']
/** Bar fill fraction for a letter grade (F ≈ 0.13 … A+ = 1.0). */
function gradeFill(g: ReportGrade): number {
  return (GRADE_ORDER.indexOf(g) + 1) / GRADE_ORDER.length
}

/** One EP-style graded tile: area label, big letter grade, fill bar. */
function GradeTile({ label, grade }: { label: string; grade: ReportGrade }): JSX.Element {
  const color = gradeColor(grade)
  return (
    <div style={{
      flex: '1 1 0', minWidth: 78, textAlign: 'center',
      padding: '10px 6px 8px', borderRadius: 'var(--radius-sm)',
      background: 'rgba(255,255,255,0.025)', border: '1px solid var(--line)',
    }}>
      <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{grade}</div>
      <div className="muted" style={{ fontSize: 10, margin: '5px 0 6px', letterSpacing: 0.2 }}>{label}</div>
      <div style={{ height: 3, borderRadius: 2, background: 'var(--line)' }}>
        <div style={{ height: 3, borderRadius: 2, width: `${gradeFill(grade) * 100}%`, background: color }} />
      </div>
    </div>
  )
}

/** EP draft-guide-style graded attribute strip (letter grades, not numbers). */
function ReportCardStrip({ card, isGoalie }: { card: ReportCard; isGoalie: boolean }): JSX.Element {
  const tiles: Array<{ label: string; grade: ReportGrade }> = isGoalie
    ? [
        { label: 'Hockey Sense', grade: card.hockeyIQ },
        { label: 'Skating', grade: card.skating },
        { label: 'Goaltending', grade: card.goaltending ?? 'C' },
        { label: 'Physical', grade: card.physicality },
      ]
    : [
        { label: 'Hockey Sense', grade: card.hockeyIQ },
        { label: 'Skating', grade: card.skating },
        { label: 'Shot / Scoring', grade: card.shotScoring },
        { label: 'Puckhandling', grade: card.puckhandling },
        { label: 'Defence', grade: card.defence },
        { label: 'Physical', grade: card.physicality },
      ]
  return (
    <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
      {tiles.map((t) => <GradeTile key={t.label} label={t.label} grade={t.grade} />)}
    </div>
  )
}

/* ── Trait badges (EP-style hexagons, coloured by rarity) ── */
const RARITY_STYLE: Record<TraitRarity, { color: string; label: string; border: number; glow: boolean }> = {
  elite:   { color: '#f5c542', label: 'Elite',   border: 2,   glow: true },   // gold
  rare:    { color: '#b06cf0', label: 'Rare',    border: 2,   glow: true },   // purple
  notable: { color: '#4f8ef7', label: 'Notable', border: 1.5, glow: false },  // blue
  common:  { color: '#6f7891', label: 'Trait',   border: 1.5, glow: false },  // slate
}

/** One hexagon trait badge — rarity colour, rarity glow, icon, label, rarity tag. */
function TraitBadge({ trait, size = 56 }: { trait: PlayerTrait; size?: number }): JSX.Element {
  const hex = '50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%'
  const r = RARITY_STYLE[trait.rarity]
  const h = Math.round(size * 1.12)
  return (
    <div title={`${trait.label} — ${r.label} · ${trait.blurb}`} style={{ textAlign: 'center', width: size + 12 }}>
      <div style={{
        width: size, height: h, margin: '0 auto', position: 'relative',
        filter: r.glow ? `drop-shadow(0 0 6px ${r.color}66)` : 'none',
      }}>
        {/* rarity-coloured border layer */}
        <div style={{ position: 'absolute', inset: 0, clipPath: `polygon(${hex})`, background: r.color, zIndex: 0 }} />
        {/* inner fill with a faint rarity tint gradient */}
        <div style={{
          position: 'absolute', inset: r.border, clipPath: `polygon(${hex})`, zIndex: 1,
          background: `radial-gradient(circle at 50% 35%, ${r.color}33, var(--panel, #1a1d27) 75%)`,
        }} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
          <span style={{ fontSize: Math.round(size * 0.42) }}>{trait.icon}</span>
        </div>
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, color: r.color, marginTop: 4, lineHeight: 1.1 }}>{trait.label}</div>
      <div className="muted" style={{ fontSize: 8.5, letterSpacing: 0.4, marginTop: 1 }}>
        {trait.rarity === 'common' ? '' : r.label.toUpperCase()}
      </div>
    </div>
  )
}

/** A row of trait badges. */
function TraitBadges({ traits, size }: { traits: PlayerTrait[]; size?: number }): JSX.Element | null {
  if (traits.length === 0) return null
  return (
    <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
      {traits.map((t) => <TraitBadge key={t.key} trait={t} {...(size !== undefined ? { size } : {})} />)}
    </div>
  )
}

/** A bordered verdict tile (label over a value) for the report header. */
function VerdictTile({ label, children, accent }: { label: string; children: ReactNode; accent?: string }): JSX.Element {
  return (
    <div style={{
      flex: '1 1 0', minWidth: 110, textAlign: 'center',
      padding: '9px 10px', borderRadius: 'var(--radius-sm)',
      background: 'rgba(255,255,255,0.025)', border: `1px solid ${accent ?? 'var(--line)'}`,
    }}>
      <div className="muted" style={{ fontSize: 9, letterSpacing: 0.6, marginBottom: 5 }}>{label}</div>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 20 }}>{children}</div>
    </div>
  )
}


/* ── Mindset panel ── */
function mindsetToneColor(tone: MindsetView['tone']): string {
  if (tone === 'positive') return 'var(--success)'
  if (tone === 'negative') return 'var(--danger)'
  return 'var(--muted)'
}

function mindsetToneLabel(tone: MindsetView['tone']): string {
  if (tone === 'positive') return 'Positive'
  if (tone === 'negative') return 'Negative'
  return 'Neutral'
}

function clarityLabel(clarity: MindsetView['clarity']): string {
  if (clarity === 'clear') return 'Staff report'
  if (clarity === 'partial') return 'Staff believe'
  return 'Staff sense'
}

function MindsetPanel({ mindset }: { mindset: MindsetView }): JSX.Element {
  const toneColor = mindsetToneColor(mindset.tone)
  return (
    <Panel title="Mindset">
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        {/* Tone badge + clarity label */}
        <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: toneColor,
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 12, fontWeight: 700, color: toneColor }}>
            {mindsetToneLabel(mindset.tone)}
          </span>
          <span className="muted small">·</span>
          <span className="muted small">{clarityLabel(mindset.clarity)}</span>
        </div>

        {/* Thought lines */}
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          {mindset.lines.map((line, i) => (
            <div
              key={i}
              style={{
                fontSize: 13,
                lineHeight: 1.55,
                paddingLeft: 12,
                borderLeft: `2px solid ${i === 0 ? toneColor : 'var(--line)'}`,
                color: i === 0 ? 'var(--text)' : 'var(--muted)',
              }}
            >
              {line}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  )
}

/* ── Interview as a scheduled GM action (request → calendar → inbox report) ── */
function InterviewPanel({
  interview,
  scheduledDate,
  playerId,
  playerName,
  client,
  onChanged,
}: {
  interview: InterviewView
  scheduledDate?: string
  playerId: string
  playerName: string
  client: ReturnType<typeof useClient>
  onChanged: () => void
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const exhausted = interview.available.length === 0

  async function request(): Promise<void> {
    if (busy) return
    setBusy(true); setError(null)
    const res = await client.requestInterview(playerId)
    setBusy(false)
    if (res.type === 'error') setError(res.message ?? 'Could not schedule.')
    else onChanged()
  }

  const fmtDate = (iso: string): string =>
    new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  return (
    <Panel title="Player Interactions">
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        {/* Action row */}
        {scheduledDate ? (
          <div className="row" style={{ alignItems: 'center', gap: 'var(--sp-2)' }}>
            <span className="chip" style={{ background: 'rgba(108,92,231,0.18)', color: 'var(--violet-h)', fontWeight: 700 }}>
              🗓 Interview scheduled
            </span>
            <span className="muted small">{fmtDate(scheduledDate)} — your staff will file a report to your inbox.</span>
          </div>
        ) : (
          <div className="row" style={{ alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy || exhausted} onClick={() => void request()}>
              {busy ? 'Scheduling…' : 'Request Interview'}
            </button>
            <span className="muted small">
              {exhausted
                ? `Your staff have already interviewed ${playerName.split(' ')[0]} thoroughly.`
                : 'Books a sit-down on your calendar; the report lands in your inbox a few days later.'}
            </span>
          </div>
        )}
        {error && <span className="small" style={{ color: 'var(--danger)' }}>{error}</span>}

        {/* What we've learned so far — compact reveal chips */}
        {interview.answers.length > 0 && (
          <div>
            <div className="stat-label" style={{ marginBottom: 5 }}>What we’ve learned</div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
              {interview.answers.map((a) => (
                <span key={a.questionId} className="chip" style={{ fontSize: 10 }} title={`${a.prompt} — ${a.answer}`}>
                  {a.reveal}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Panel>
  )
}

/* ── Mark-for-meeting: queue a player topic for the next staff meeting ── */
const MEETING_TOPICS: { id: string; label: string }[] = [
  { id: 'form',        label: 'His recent form' },
  { id: 'iceTime',     label: 'His ice time / usage' },
  { id: 'role',        label: 'His best role' },
  { id: 'development', label: 'His development' },
  { id: 'tradeValue',  label: 'His trade value' },
]

function MarkForMeeting({
  playerId,
  client,
}: {
  playerId: string
  client: ReturnType<typeof useClient>
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function mark(topic: string): Promise<void> {
    setBusy(true)
    try {
      const res = await client.markForMeeting(playerId, topic)
      if (res.type === 'error') toast(res.message, 'error')
      else toast('Added to the staff-meeting agenda.', 'success')
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setOpen((o) => !o)}>
        Mark for meeting ▾
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', zIndex: 20, top: '100%', left: 0, marginTop: 4,
            background: 'var(--bg1)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.4)', minWidth: 200,
          }}
        >
          {MEETING_TOPICS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => void mark(t.id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: 13,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg2)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* Axis label map for the radar stat bars. */
const AXIS_LABELS: Record<string, string> = {
  hockeyIQ: 'Hockey IQ',
  skating: 'Skating',
  shot: 'Shot',
  offensiveZone: 'Off. Zone',
  defensiveZone: 'Def. Zone',
  physicality: 'Physical',
}

/* ═══════════════════════════ COMPARE CONTROL ═══════════════════════════ */

interface CompareControlProps {
  /** Current player (excluded from dropdown). */
  currentId: string
  currentName: string
  currentRadar: import('../../engine/career/views').RadarView
  /** Callback to trigger an async compare fetch. */
  onCompare: (playerId: string | null) => void
  compareResult: CompareRadarView | null
  comparing: boolean
  squadRows: Array<{ playerId: string; name: string; position: string }>
}

function CompareControl({
  currentId,
  currentName,
  currentRadar,
  onCompare,
  compareResult,
  comparing,
  squadRows,
}: CompareControlProps): JSX.Element {
  const [selected, setSelected] = useState<string>('')

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const id = e.target.value
    setSelected(id)
    onCompare(id || null)
  }

  const handleClear = (): void => {
    setSelected('')
    onCompare(null)
  }

  const others = squadRows.filter((r) => r.playerId !== currentId)

  return (
    <Panel title="Ratings">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-3)' }}>
        {/* Compare picker */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
          <label className="muted small" style={{ whiteSpace: 'nowrap' }}>Compare vs:</label>
          <select
            className="select"
            value={selected}
            onChange={handleChange}
            style={{ flex: 1, fontSize: 12 }}
          >
            <option value="">— no comparison —</option>
            {others.map((r) => (
              <option key={r.playerId} value={r.playerId}>
                {r.name} ({r.position})
              </option>
            ))}
          </select>
          {selected && (
            <button className="btn btn-ghost btn-sm" onClick={handleClear}>✕</button>
          )}
        </div>

        {/* Radar — shape only, no axis values */}
        {comparing ? (
          <span className="muted small">Loading comparison…</span>
        ) : (
          <RadarChart
            radar={currentRadar}
            compareRadar={compareResult?.playerB.radar}
            primaryName={currentName}
            compareName={compareResult?.playerB.name}
            size={240}
            showValues={false}
          />
        )}

        {/* Coarse 1–10 axis bars */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {RADAR_AXES.map((key) => (
            <AttrBar
              key={key}
              label={AXIS_LABELS[key] ?? key}
              value={currentRadar[key]}
            />
          ))}
        </div>

        {/* Compare key stats (when active) */}
        {compareResult && (
          <div style={{ width: '100%', borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <div className="panel-title" style={{ marginBottom: 8 }}>Key Stats vs {compareResult.playerB.name}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '4px 12px', fontSize: 12, alignItems: 'center' }}>
              {/* Rating stars (no exact number) */}
              <span style={{ textAlign: 'right' }}><StarRating stars={overallToStars(compareResult.playerA.overall)} size={13} /></span>
              <span className="muted" style={{ textAlign: 'center', fontSize: 10, textTransform: 'uppercase' }}>RTG</span>
              <span><StarRating stars={overallToStars(compareResult.playerB.overall)} size={13} /></span>
              {/* Skater stats */}
              {compareResult.playerA.skater && compareResult.playerB.skater && (
                <>
                  <span style={{ textAlign: 'right', color: 'var(--accent)' }}>{compareResult.playerA.skater.goals}</span>
                  <span className="muted" style={{ textAlign: 'center', fontSize: 10, textTransform: 'uppercase' }}>G</span>
                  <span style={{ color: 'var(--cyan)' }}>{compareResult.playerB.skater.goals}</span>

                  <span style={{ textAlign: 'right', color: 'var(--accent)' }}>{compareResult.playerA.skater.assists}</span>
                  <span className="muted" style={{ textAlign: 'center', fontSize: 10, textTransform: 'uppercase' }}>A</span>
                  <span style={{ color: 'var(--cyan)' }}>{compareResult.playerB.skater.assists}</span>

                  <span style={{ textAlign: 'right', fontWeight: 700, color: 'var(--accent)' }}>{compareResult.playerA.skater.points}</span>
                  <span className="muted" style={{ textAlign: 'center', fontSize: 10, textTransform: 'uppercase' }}>PTS</span>
                  <span style={{ fontWeight: 700, color: 'var(--cyan)' }}>{compareResult.playerB.skater.points}</span>
                </>
              )}
              {/* Goalie stats */}
              {compareResult.playerA.goalie && compareResult.playerB.goalie && (
                <>
                  <span style={{ textAlign: 'right', color: 'var(--accent)' }}>.{Math.round(compareResult.playerA.goalie.savePct * 1000)}</span>
                  <span className="muted" style={{ textAlign: 'center', fontSize: 10, textTransform: 'uppercase' }}>SV%</span>
                  <span style={{ color: 'var(--cyan)' }}>.{Math.round(compareResult.playerB.goalie.savePct * 1000)}</span>

                  <span style={{ textAlign: 'right', color: 'var(--accent)' }}>{compareResult.playerA.goalie.goalsAgainstAverage.toFixed(2)}</span>
                  <span className="muted" style={{ textAlign: 'center', fontSize: 10, textTransform: 'uppercase' }}>GAA</span>
                  <span style={{ color: 'var(--cyan)' }}>{compareResult.playerB.goalie.goalsAgainstAverage.toFixed(2)}</span>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </Panel>
  )
}

/* ═══════════════════════════ TAB PANELS ═══════════════════════════ */

function TabProfile({
  d,
  client,
  squadRows,
  onChanged,
}: {
  d: PlayerProfileView
  client: ReturnType<typeof useClient>
  squadRows: Array<{ playerId: string; name: string; position: string }>
  onChanged: () => void
}): JSX.Element {
  const [compareResult, setCompareResult] = useState<CompareRadarView | null>(null)
  const [comparing, setComparing] = useState(false)

  const handleCompare = useCallback(
    async (playerId: string | null): Promise<void> => {
      if (!playerId) {
        setCompareResult(null)
        return
      }
      setComparing(true)
      const res = await client.compareRadar(d.playerId, playerId)
      setComparing(false)
      if (res.type === 'compareRadar') setCompareResult(res.comparison)
    },
    [client, d.playerId]
  )

  const isGoalie = d.position === 'G'

  return (
    <div className="stack">
      {/* ════ FM HEADER BAND: photo | bio | contract | coach summary | abilities ════ */}
      <div className="pp-headband" style={{ borderTop: '3px solid var(--team-primary, var(--accent))' }}>
        {/* Photo — FM-style kit card */}
        <div
          className="pp-photo"
          style={d.teamColors ? { background: `linear-gradient(160deg, #${d.teamColors.primary.toString(16).padStart(6, '0')} 0%, rgba(0,0,0,0.35) 100%)` } : undefined}
        >
          {d.bio.jerseyNumber !== undefined && <div className="pp-photo-watermark">{d.bio.jerseyNumber}</div>}
          <PlayerFace faceId={d.faceId} name={d.name} size={96} teamColor={d.teamColors?.primary} />
          <div className="pp-photo-name">{d.name}</div>
        </div>

        {/* Bio */}
        <div className="pp-band-col">
          <div className="pp-band-row"><strong>{d.age}</strong><span className="muted"> years old</span></div>
          {d.bio.nationality && (
            <div className="pp-band-row" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <FlagIcon nationality={d.bio.nationality} size={20} />
              {d.bio.nationality}
            </div>
          )}
          {d.bio.birthplace && <div className="pp-band-row muted small">{d.bio.birthplace}</div>}
          <div className="pp-band-row muted small">{d.handedness}-handed shot</div>
          {d.honours.intlApps > 0 && (
            <div className="pp-band-row muted small">{d.honours.intlApps} caps / {d.honours.intlGoals} goals</div>
          )}
        </div>

        {/* Contract */}
        <div className="pp-band-col">
          <div className="pp-band-label">Contract</div>
          {d.teamName
            ? <div className="pp-band-row">Contracted to <strong>{d.teamName}</strong></div>
            : <div className="pp-band-row"><span className="chip chip-warn">Free agent</span></div>}
          {d.profileContract && (
            <>
              <div className="pp-band-row"><strong>{fmtMoney(d.profileContract.salary)}</strong><span className="muted small"> /yr</span></div>
              <div className="pp-band-row muted small">until {d.profileContract.expiryYear}</div>
              <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                {d.profileContract.noTradeClause && <span className="chip chip-warn" style={{ fontSize: 9 }}>NTC</span>}
                {d.profileContract.twoWay && <span className="chip" style={{ fontSize: 9 }}>2-way</span>}
                {d.profileContract.freeAgentStatus && <span className="chip chip-warn" style={{ fontSize: 9 }}>{d.profileContract.freeAgentStatus}</span>}
              </div>
            </>
          )}
        </div>

        {/* Coach summary */}
        <div className="pp-band-col">
          <div className="pp-band-label">Coach Summary</div>
          {d.scoutVerdict ? (
            <>
              <div className="pp-band-row small" style={{ lineHeight: 1.35 }}>{d.scoutVerdict.recommendation}</div>
              <div className="pp-band-row muted small">
                <span style={{ color: 'var(--success)' }}>{d.scoutVerdict.pros.length} Pros</span>
                {' · '}
                <span style={{ color: 'var(--danger)' }}>{d.scoutVerdict.cons.length} Cons</span>
              </div>
              <div className="pp-band-row muted small">Best as {d.scoutVerdict.bestRole}</div>
            </>
          ) : (
            <div className="pp-band-row muted small">Insufficient scouting.</div>
          )}
        </div>

        {/* Abilities */}
        <div className="pp-band-col pp-band-abilities">
          <div className="pp-ability">
            <div className="pp-band-label">Current Ability</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {d.scouted && !d.scouted.exact ? (
                <>
                  <StarRating stars={overallToStars(d.scouted.overallLo)} fogged size={15} />
                  <span className="muted small">–</span>
                  <StarRating stars={overallToStars(d.scouted.overallHi)} fogged size={15} />
                </>
              ) : (
                <StarRating stars={overallToStars(d.overall)} size={17} />
              )}
              <TrendArrow trend={d.overallTrend} />
            </div>
          </div>
          <div className="pp-ability">
            <div className="pp-band-label">Potential Ability</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <StarRating stars={d.potentialStars} fogged={!!(d.scouted && !d.scouted.exact)} size={17} />
              <TrendArrow trend={d.potentialTrend} title={d.potentialTrend === 'up' ? 'Ceiling trending up' : 'Ceiling trending down'} />
            </div>
            {d.potentialBand.hi > d.potentialBand.lo && (
              <div
                className="muted small"
                title="Realistic range of where his career could land — wide for unproven youth, narrowing as he proves out"
                style={{ marginTop: 2 }}
              >
                Range {d.potentialBand.lo === d.potentialBand.hi
                  ? `${d.potentialBand.lo}★`
                  : `${d.potentialBand.lo}–${d.potentialBand.hi}★`}
              </div>
            )}
          </div>
        </div>

        {/* Calling-card trait badges — full-width strip inside the identity card */}
        {d.scoutReport.traits.length > 0 && (
          <div style={{
            gridColumn: '1 / -1',
            display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-4)',
            borderTop: '1px solid var(--line)', paddingTop: 'var(--sp-3)', marginTop: 2,
          }}>
            <span className="pp-band-label" style={{ alignSelf: 'center', marginRight: 4 }}>Calling Cards</span>
            <TraitBadges traits={d.scoutReport.traits} size={46} />
          </div>
        )}
      </div>

      {/* Injury notice (full width, above body) */}
      {d.injury && (
        <Notice kind="danger">
          Injured: {d.injury.description} — {d.injury.gamesRemaining} game{d.injury.gamesRemaining !== 1 ? 's' : ''} remaining
        </Notice>
      )}

      {/* ════ MAIN BODY: positions | attributes | pros·cons ════ */}
      <div className="pp-body">

        {/* ── LEFT: positions + role & duty + vitals ── */}
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <Panel title="Position">
            <PositionRink positions={d.positions} />
            <div className="pp-pos-list">
              {d.positions.map((pp) => (
                <div key={pp.pos} className="pp-pos-row">
                  <span className="pp-pos-tag">{pp.pos}</span>
                  <span className="pp-pos-level" style={{ color: POS_LEVEL_COLOR[pp.level] }}>{pp.level}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Role & Duty">
            <div className="pp-role-row">
              <StarRating stars={5} size={11} />
              <span className="pp-role-name">{d.position}{d.role ? ` · ${d.role}` : ''}</span>
            </div>
            {d.archetype && (
              <>
                <div className="pp-role-row" style={{ marginTop: 6 }}>
                  <span style={{ fontWeight: 700, color: 'var(--violet-h)', fontSize: 12 }}>{d.archetype.label}</span>
                </div>
                {d.archetype.descriptors.length > 0 && (
                  <div className="row" style={{ flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                    {d.archetype.descriptors.map((desc) => (
                      <span key={desc} className="chip" style={{ fontSize: 10 }}>{desc}</span>
                    ))}
                  </div>
                )}
              </>
            )}
          </Panel>

          <Panel title="Status">
            <div className="pp-vitals">
              <div className="pp-vital">
                <ConditionHeart value={d.condition} size={20} />
                <div className="stat-label">Condition</div>
              </div>
              <div className="pp-vital">
                <div style={{ fontSize: 13, fontWeight: 700, color: moraleColor(d.morale) }}>{moraleWord(d.morale)}</div>
                <div className="stat-label">Morale</div>
              </div>
              <div className="pp-vital">
                <div style={{ fontSize: 15, fontWeight: 700, color: d.form > 2 ? 'var(--success)' : d.form < -2 ? 'var(--danger)' : 'var(--text)' }}>
                  {d.form > 0 ? `+${d.form}` : d.form}
                </div>
                <div className="stat-label">Form</div>
              </div>
            </div>
          </Panel>

          <Panel title={`This Season — ${d.seasons[0]?.year ?? ''}`}>
            <ThisSeasonStrip season={d.seasons[0]} isGoalie={isGoalie} />
          </Panel>
        </div>

        {/* ── CENTER: attributes (3 cols) + meta ── */}
        <Panel title="Attributes">
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${d.attributeGroups.length}, 1fr)`, gap: 'var(--sp-4)' }}>
            {d.attributeGroups.map((group) => (
              <div key={group.name}>
                <div className="pp-attr-head">{group.name}</div>
                {group.attributes.map((a) => {
                  const v20 = to20(a.value)
                  // Always show the scout's best estimate once scouted at all;
                  // an uncertain read is muted (and carries the lo–hi range on hover).
                  const band = a.masked && a.lo !== undefined && a.hi !== undefined
                    ? `Estimate — scouts peg him ${to20(a.lo)}–${to20(a.hi)}`
                    : undefined
                  return (
                    <div key={a.label} className="pp-attr-row">
                      <span className="pp-attr-name">{a.label}</span>
                      <span
                        className="pp-attr-val"
                        title={band}
                        style={{ color: a.masked ? 'var(--muted)' : attrColor20(v20) }}
                      >
                        {v20}{a.masked ? '*' : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {/* meta grid: hand / height / weight / personality / traits */}
          <div className="pp-meta-grid">
            <div><span className="pp-band-label">Preferred Hand</span><span>{d.handedness === 'L' ? 'Left' : 'Right'}</span></div>
            {d.bio.heightCm !== undefined && <div><span className="pp-band-label">Height</span><span>{d.bio.heightCm} cm</span></div>}
            {d.bio.weightKg !== undefined && <div><span className="pp-band-label">Weight</span><span>{d.bio.weightKg} kg</span></div>}
            <div><span className="pp-band-label">Personality</span><span>{d.personalityType?.label ?? '—'}</span></div>
          </div>
        </Panel>

        {/* ── RIGHT: evaluation — pros/cons, radar, fit, mindset ── */}
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <Panel>
            <div className="pp-proscons">
              <div>
                <div className="pp-pros-head">Pros</div>
                {d.scoutVerdict && d.scoutVerdict.pros.length > 0
                  ? d.scoutVerdict.pros.map((p) => <div key={p} className="pp-pro">✓ {p}</div>)
                  : <div className="muted small" style={{ padding: '4px 0' }}>—</div>}
              </div>
              <div>
                <div className="pp-cons-head">Cons</div>
                {d.scoutVerdict && d.scoutVerdict.cons.length > 0
                  ? d.scoutVerdict.cons.map((c) => <div key={c} className="pp-con">✕ {c}</div>)
                  : <div className="muted small" style={{ padding: '4px 0' }}>—</div>}
              </div>
            </div>
          </Panel>

          <CompareControl
            currentId={d.playerId}
            currentName={d.name}
            currentRadar={d.radar}
            onCompare={(id) => { void handleCompare(id) }}
            compareResult={compareResult}
            comparing={comparing}
            squadRows={squadRows}
          />

          {d.systemFit && (() => {
            const s = d.systemFit.score
            const color = s >= 80 ? 'var(--success)' : s >= 66 ? 'var(--green)' : s >= 50 ? 'var(--accent2, var(--violet-h))' : 'var(--danger)'
            return (
              <Panel title="System Fit">
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 46 }}>
                    <span className="mono" style={{ fontSize: 18, fontWeight: 800, color }}>{s}</span>
                    <span className="muted" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 }}>Fit</span>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color }}>{d.systemFit.label} · {d.systemFit.styleLabel}</div>
                    <div className="muted small" style={{ lineHeight: 1.4 }}>{d.systemFit.reason}</div>
                  </div>
                </div>
              </Panel>
            )
          })()}

          {d.mindset && <MindsetPanel mindset={d.mindset} />}

          {/* Interview as a scheduled GM action */}
          {d.interview && (
            <InterviewPanel
              interview={d.interview}
              {...(d.interviewScheduled !== undefined ? { scheduledDate: d.interviewScheduled } : {})}
              playerId={d.playerId}
              playerName={d.name}
              client={client}
              onChanged={onChanged}
            />
          )}

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <MarkForMeeting playerId={d.playerId} client={client} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Compact current-season stat tiles for the overview. */
function ThisSeasonStrip({ season, isGoalie }: { season: PlayerProfileView['seasons'][number] | undefined; isGoalie: boolean }): JSX.Element {
  if (!season) return <span className="muted small">No games yet this season.</span>
  const tiles = isGoalie && season.goalie
    ? [
        { label: 'GP', value: season.goalie.gamesPlayed },
        { label: 'W', value: season.goalie.wins },
        { label: 'L', value: season.goalie.losses },
        { label: 'SV%', value: `.${Math.round(season.goalie.savePct * 1000)}` },
        { label: 'GAA', value: season.goalie.goalsAgainstAverage.toFixed(2) },
        { label: 'SO', value: season.goalie.shutouts },
      ]
    : season.skater
      ? [
          { label: 'GP', value: season.skater.gamesPlayed },
          { label: 'G', value: season.skater.goals },
          { label: 'A', value: season.skater.assists },
          { label: 'PTS', value: season.skater.points },
          { label: '±', value: season.skater.plusMinus > 0 ? `+${season.skater.plusMinus}` : season.skater.plusMinus },
          { label: 'TOI/g', value: fmtToi(season.skater.toiPerGame) },
        ]
      : null
  if (!tiles) return <span className="muted small">No games yet this season.</span>
  return (
    <div className="row" style={{ gap: 'var(--sp-5, 28px)', flexWrap: 'wrap' }}>
      {tiles.map(({ label, value }) => (
        <div key={label} className="stat"><div className="stat-value" style={{ fontSize: 22 }}>{value}</div><div className="stat-label">{label}</div></div>
      ))}
    </div>
  )
}

const POS_LEVEL_COLOR: Record<string, string> = {
  Natural: 'var(--success)',
  Accomplished: 'rgba(52,211,153,0.85)',
  Competent: 'var(--accent2)',
  Unproved: 'var(--muted)',
}

const POS_SPOT: Record<string, [number, number]> = {
  G: [50, 86], D: [50, 68], LD: [34, 68], RD: [66, 68],
  C: [50, 42], LW: [26, 28], RW: [74, 28], W: [50, 28], F: [50, 34],
}

/** Rink with every position the player can play, dot-coloured by proficiency. */
function PositionRink({ positions }: { positions: Array<{ pos: string; level: string }> }): JSX.Element {
  return (
    <svg viewBox="0 0 100 100" width="100%" style={{ maxWidth: 190, display: 'block', margin: '0 auto' }}>
      <rect x="6" y="4" width="88" height="92" rx="16" fill="rgba(120,170,255,0.06)" stroke="var(--line)" strokeWidth="1.2" />
      <line x1="6" y1="50" x2="94" y2="50" stroke="#d0463b" strokeWidth="1.4" opacity="0.7" />
      <line x1="6" y1="34" x2="94" y2="34" stroke="#3b6dd0" strokeWidth="1.1" opacity="0.6" />
      <line x1="6" y1="66" x2="94" y2="66" stroke="#3b6dd0" strokeWidth="1.1" opacity="0.6" />
      <circle cx="50" cy="50" r="8" fill="none" stroke="#d0463b" strokeWidth="1" opacity="0.5" />
      {positions.map((pp) => {
        const [cx, cy] = POS_SPOT[pp.pos.toUpperCase()] ?? [50, 50]
        const col = POS_LEVEL_COLOR[pp.level] ?? 'var(--muted)'
        const natural = pp.level === 'Natural'
        return (
          <g key={pp.pos}>
            <circle cx={cx} cy={cy} r="7" fill={col} stroke="#fff" strokeWidth={natural ? 1.6 : 1} opacity={natural ? 1 : 0.85} />
            <text x={cx} y={cy + 2.6} textAnchor="middle" fontSize="6.5" fontWeight="700" fill="#fff">{pp.pos}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** Season-by-season stat table (skater or goalie columns). */
function SeasonStatsTable({ seasons, isGoalie }: { seasons: PlayerProfileView['seasons']; isGoalie: boolean }): JSX.Element {
  if (seasons.length === 0) return <span className="muted small">No games recorded.</span>
  return (
    <div className="table-wrap">
      <table className="table" style={{ fontSize: 12 }}>
        <thead>
          {isGoalie ? (
            <tr><th>Season</th><th>Tm</th><th className="num">GP</th><th className="num">W</th><th className="num">L</th><th className="num">SV%</th><th className="num">GAA</th><th className="num">SO</th></tr>
          ) : (
            <tr><th>Season</th><th>Tm</th><th className="num">GP</th><th className="num">G</th><th className="num">A</th><th className="num">P</th><th className="num">±</th><th className="num">TOI</th></tr>
          )}
        </thead>
        <tbody>
          {seasons.map((s, i) => {
            const yr = `${s.year}–${(s.year + 1) % 100}`
            if (isGoalie) {
              const g = s.goalie
              return (
                <tr key={i}>
                  <td>{yr}</td><td className="muted">{s.teamAbbr}</td>
                  <td className="num">{g?.gamesPlayed ?? '—'}</td><td className="num">{g?.wins ?? '—'}</td><td className="num">{g?.losses ?? '—'}</td>
                  <td className="num">{g ? `.${Math.round(g.savePct * 1000)}` : '—'}</td>
                  <td className="num">{g ? g.goalsAgainstAverage.toFixed(2) : '—'}</td><td className="num">{g?.shutouts ?? '—'}</td>
                </tr>
              )
            }
            const sk = s.skater
            return (
              <tr key={i}>
                <td>{yr}</td><td className="muted">{s.teamAbbr}</td>
                <td className="num">{sk?.gamesPlayed ?? '—'}</td><td className="num">{sk?.goals ?? '—'}</td><td className="num">{sk?.assists ?? '—'}</td>
                <td className="num"><strong>{sk?.points ?? '—'}</strong></td>
                <td className="num">{sk ? (sk.plusMinus > 0 ? `+${sk.plusMinus}` : sk.plusMinus) : '—'}</td>
                <td className="num">{sk ? fmtToi(sk.toiPerGame) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Career totals summed from the season lines. */
function CareerTotals({ seasons, isGoalie, avgRating }: { seasons: PlayerProfileView['seasons']; isGoalie: boolean; avgRating?: number }): JSX.Element {
  const ratingCell: Array<readonly [string, number | string]> =
    avgRating !== undefined ? [['AVR', avgRating.toFixed(2)]] : []
  if (isGoalie) {
    const t = seasons.reduce((a, s) => {
      if (s.goalie) { a.gp += s.goalie.gamesPlayed; a.w += s.goalie.wins; a.l += s.goalie.losses; a.so += s.goalie.shutouts }
      return a
    }, { gp: 0, w: 0, l: 0, so: 0 })
    const cells: Array<readonly [string, number | string]> = [['GP', t.gp], ['W', t.w], ['L', t.l], ['SO', t.so], ...ratingCell]
    return (
      <div className="row" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
        {cells.map(([label, value]) => (
          <div key={label} className="stat"><div className="stat-value" style={{ fontSize: 20 }}>{value}</div><div className="stat-label">{label}</div></div>
        ))}
      </div>
    )
  }
  const t = seasons.reduce((a, s) => {
    if (s.skater) { a.gp += s.skater.gamesPlayed; a.g += s.skater.goals; a.a += s.skater.assists; a.p += s.skater.points }
    return a
  }, { gp: 0, g: 0, a: 0, p: 0 })
  const cells: Array<readonly [string, number | string]> = [['GP', t.gp], ['G', t.g], ['A', t.a], ['P', t.p], ...ratingCell]
  return (
    <div className="row" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
      {cells.map(([label, value]) => (
        <div key={label} className="stat"><div className="stat-value" style={{ fontSize: 20 }}>{value}</div><div className="stat-label">{label}</div></div>
      ))}
    </div>
  )
}

/** Career honours as trophy badges (grouped by award, with a count + years tooltip). */
function TrophyBadges({ awards }: { awards: NonNullable<PlayerProfileView['awards']> }): JSX.Element {
  const byName = new Map<string, number[]>()
  for (const a of awards) {
    const arr = byName.get(a.award) ?? []
    arr.push(a.year)
    byName.set(a.award, arr)
  }
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
      {[...byName.entries()].map(([name, years]) => {
        const sorted = [...years].sort((a, b) => b - a)
        return (
          <div
            key={name}
            title={`${name} — ${sorted.join(', ')}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px',
              borderRadius: 8, background: 'var(--panel2)', border: '1px solid var(--accent2, #e0b341)',
              cursor: 'help',
            }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>🏆</span>
            <span style={{ fontSize: 12, fontWeight: 700 }}>{name}</span>
            {sorted.length > 1 && (
              <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent2, #e0b341)' }}>×{sorted.length}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function TabPositions({ d }: { d: PlayerProfileView }): JSX.Element {
  return (
    <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '230px 1fr', gap: 'var(--sp-3)', alignItems: 'start' }}>
      {/* Positions the player can play */}
      <Panel title="Positions">
        <PositionRink positions={d.positions} />
        <div className="pp-pos-list">
          {d.positions.map((pp) => (
            <div key={pp.pos} className="pp-pos-row">
              <span className="pp-pos-tag">{pp.pos}</span>
              <span className="pp-pos-level" style={{ color: POS_LEVEL_COLOR[pp.level] }}>{pp.level}</span>
            </div>
          ))}
        </div>
      </Panel>

      {/* Role & playing style */}
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        <Panel title="Role & Style">
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
              <span className="muted small" style={{ width: 80 }}>Role</span>
              <span className="chip chip-accent" style={{ fontSize: 13, padding: '4px 14px' }}>{d.role}</span>
            </div>
            <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
              <span className="muted small" style={{ width: 80 }}>Shot</span>
              <span className="chip">{d.handedness === 'L' ? 'Left' : 'Right'}-handed</span>
            </div>
            {d.archetype && (
              <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
                <span className="muted small" style={{ width: 80 }}>Archetype</span>
                <ArchetypeChip archetype={d.archetype} />
              </div>
            )}
          </div>
        </Panel>

        {d.archetype && d.archetype.descriptors.length > 0 && (
          <Panel title="Style Traits">
            <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
              {d.archetype.descriptors.map((desc) => (
                <span key={desc} className="chip">{desc}</span>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  )
}

function TabInformation({ d }: { d: PlayerProfileView }): JSX.Element {
  const h = d.honours
  const hasIntl = h.intlApps > 0
  const hasCups = h.stanleyCups > 0
  const hasRep = h.homeReputation > 0 || h.currentReputation > 0 || h.worldReputation > 0

  return (
    <div className="stack">
      {/* Bio */}
      <Panel title="Personal">
        <InfoRow label="Nationality" value={d.bio.nationality} />
        <InfoRow label="Birthplace" value={d.bio.birthplace} />
        <InfoRow label="Jersey number" value={d.bio.jerseyNumber !== undefined ? `#${d.bio.jerseyNumber}` : undefined} />
        <InfoRow label="Height" value={d.bio.heightCm !== undefined ? `${d.bio.heightCm} cm` : undefined} />
        <InfoRow label="Weight" value={d.bio.weightKg !== undefined ? `${d.bio.weightKg} kg` : undefined} />
        {!d.bio.nationality && !d.bio.birthplace && !d.bio.heightCm && !d.bio.weightKg && (
          <span className="muted small">No biographical data recorded.</span>
        )}
      </Panel>

      {/* Draft */}
      <Panel title="Draft">
        <InfoRow
          label="Status"
          value={h.nhlDrafted ? 'Drafted' : h.nhlDraftEligible ? 'Draft eligible' : 'Not eligible'}
        />
        {h.draftYear !== undefined && <InfoRow label="Year" value={h.draftYear} />}
        {h.draftRound !== undefined && <InfoRow label="Round" value={`Round ${h.draftRound}`} />}
        {h.draftOverall !== undefined && <InfoRow label="Overall pick" value={`#${h.draftOverall}`} />}
        {h.draftClub && <InfoRow label="Drafted by" value={h.draftClub} />}
        <InfoRow label="Junior preference" value={h.juniorPreference} />
      </Panel>

      {/* Honours */}
      {(hasCups || hasIntl || hasRep) && (
        <Panel title="Honours">
          {hasCups && (
            <InfoRow label="Stanley Cups" value={h.stanleyCups} />
          )}
          {hasIntl && (
            <>
              <InfoRow label="Intl appearances" value={h.intlApps} />
              <InfoRow label="Intl goals" value={h.intlGoals} />
              <InfoRow label="Intl assists" value={h.intlAssists} />
            </>
          )}
          {hasRep && (
            <>
              <InfoRow label="Home rep." value={h.homeReputation > 0 ? repTier(h.homeReputation) : undefined} />
              <InfoRow label="Current rep." value={h.currentReputation > 0 ? currentRepTier(h.currentReputation, d.overall) : undefined} />
              <InfoRow label="World rep." value={h.worldReputation > 0 ? repTier(h.worldReputation) : undefined} />
            </>
          )}
        </Panel>
      )}
    </div>
  )
}

/** EHM-style reputation tier from a 0–200 reputation rating. A GM reads "World
 *  Class", not a raw number.
 *
 *  Thresholds are calibrated to the real-roster DB, where NHL reputations cluster
 *  high (102–200, median ~143). The elite labels are pushed up so "World Class"
 *  and above stay rare (roughly the top tenth), not half the league. */
function repTier(v: number): string {
  if (v <= 0) return 'Unknown'
  if (v < 90) return 'Obscure'
  if (v < 118) return 'Regional'
  if (v < 138) return 'National'
  if (v < 158) return 'Continental'
  if (v < 175) return 'World Class'
  if (v < 190) return 'Superstar'
  return 'Global Icon'
}

/** Plain-English read of how well a player is known (0–100 scouting knowledge),
 *  instead of a raw percentage. */
function knowledgeProse(k: number): string {
  if (k >= 95) return 'Know him inside out'
  if (k >= 82) return 'Very well scouted'
  if (k >= 68) return 'Well scouted'
  if (k >= 52) return 'A decent read — could use another look'
  if (k >= 38) return 'A rough read so far'
  if (k >= 22) return 'Only had a few looks'
  return 'Barely scouted yet'
}

/** Map an overall (40–99) onto the 0–200 reputation scale (40→70, 99→200). */
function overallToRep(ovr: number): number {
  return 70 + (Math.max(40, Math.min(99, ovr)) - 40) * (130 / 59)
}

/**
 * Current-reputation tier blended with ability, so an inflated DB reputation
 * can't make an average journeyman read as "World Class". Ability gets 40% of
 * the say; the headline reputation keeps 60%.
 */
function currentRepTier(rep: number, overall: number): string {
  return repTier(rep * 0.6 + overallToRep(overall) * 0.4)
}

function TabContract({ d }: { d: PlayerProfileView }): JSX.Element {
  const pc = d.profileContract
  const c = d.contract

  if (!pc && !c) {
    return (
      <Panel>
        <span className="muted small">This player has no active contract.</span>
      </Panel>
    )
  }

  const salary = pc?.salary ?? c?.salary ?? 0
  const capHit = pc?.capHit ?? salary
  const yearsRem = pc?.yearsRemaining ?? c?.yearsRemaining ?? 0
  const expiryYear = pc?.expiryYear ?? c?.expiryYear ?? 0

  return (
    <div className="stack">
      <Panel title="Contract Details">
        <InfoRow label="Annual salary" value={fmtMoney(salary)} />
        <InfoRow label="Cap hit" value={fmtMoney(capHit)} />
        {pc?.buriedCapHit !== undefined && (
          <InfoRow label="Buried cap hit (minors)" value={fmtMoney(pc.buriedCapHit)} />
        )}
        <InfoRow label="Years remaining" value={yearsRem} />
        <InfoRow label="Expiry year" value={expiryYear} />
        <InfoRow label="FA status" value={pc?.freeAgentStatus ?? (c ? 'Under contract' : null)} />
        {pc?.rightsStatus && pc.freeAgentStatus === null && (
          <InfoRow label="Rights status" value={pc.rightsStatus === 'UFA' ? 'UFA at expiry' : `${pc.rightsStatus} (rights held)`} />
        )}
        <InfoRow label="No-trade clause" value={(pc?.noTradeClause ?? c?.noTradeClause) ? 'Yes' : null} />
        <InfoRow label="Two-way contract" value={(pc?.twoWay ?? c?.twoWay) ? 'Yes' : null} />
      </Panel>

      <Panel title="Cap Usage">
        <div className="meter" style={{ marginBottom: 8 }}>
          <div className="meter-fill" style={{ width: `${Math.max(0, Math.min(100, capHit / 83_500_000 * 100))}%` }} />
        </div>
        <span className="muted small">
          {fmtMoney(capHit)} of $83.5M cap · {((capHit / 83_500_000) * 100).toFixed(1)}%
        </span>
      </Panel>
    </div>
  )
}

function TabHistory({ d }: { d: PlayerProfileView }): JSX.Element {
  const isGoalie = d.position === 'G'

  if (d.seasons.length === 0) {
    return (
      <Panel>
        <span className="muted small">No season history recorded.</span>
      </Panel>
    )
  }

  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      <Panel title="Career Totals">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
          <CareerTotals seasons={d.seasons} isGoalie={isGoalie} {...(d.avgRating !== undefined ? { avgRating: d.avgRating } : {})} />
          {d.awards && d.awards.length > 0 && <TrophyBadges awards={d.awards} />}
        </div>
      </Panel>
    <Panel title="Career Stats">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Season</th>
              <th>Team</th>
              {isGoalie ? (
                <>
                  <th className="num">GP</th>
                  <th className="num">W</th>
                  <th className="num">L</th>
                  <th className="num">SV%</th>
                  <th className="num">GAA</th>
                  <th className="num">SO</th>
                  <th className="num"></th>
                  <th className="num"></th>
                </>
              ) : (
                <>
                  <th className="num">GP</th>
                  <th className="num">G</th>
                  <th className="num">A</th>
                  <th className="num">P</th>
                  <th className="num">±</th>
                  <th className="num">PIM</th>
                  <th className="num">TOI/g</th>
                  <th className="num">PP</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {d.seasons.map((season, i) => (
              <tr key={season.year} style={i === 0 ? { fontWeight: 600 } : undefined}>
                <td>{season.year}–{String(season.year + 1).slice(2)}</td>
                <td className="muted"><TeamLink teamId={season.teamId} name={season.teamAbbr} /></td>
                {season.goalie
                  ? <GoalieHistoryRow g={season.goalie} />
                  : season.skater
                    ? <SkaterHistoryRow s={season.skater} />
                    : <td colSpan={8} className="muted">—</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
    </div>
  )
}

/* ── Risk band colour ── */
function riskColor(band: RiskBand): string {
  if (band === 'High') return 'var(--danger)'
  if (band === 'Medium') return 'var(--accent2)'
  return 'var(--success)'
}

/* ── Individual scout read row ── */
function ScoutReadRow({ read }: { read: ScoutRead }): JSX.Element {
  const tierColor =
    read.tier === 'Star' ? 'var(--accent)' :
    read.tier === 'Key' ? 'var(--cyan)' :
    read.tier === 'Core' ? 'var(--success)' :
    read.tier === 'Prospect' ? 'var(--violet-h)' :
    'var(--muted)'

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '28px 1fr auto',
      alignItems: 'flex-start',
      gap: 10,
      padding: '8px 0',
      borderTop: '1px solid var(--line)',
    }}>
      {/* Face (resolves via the mod bridge; silhouette/initials fallback) */}
      <PlayerFace faceId={read.faceId} name={read.scoutName} size={28} />

      {/* Name + take + what he saw in a recent viewing */}
      <div className="stack" style={{ gap: 2 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{read.scoutName}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{read.take}</span>
        {read.watched && (
          <span style={{ fontSize: 11, color: 'var(--accent2, #e0b341)', fontStyle: 'italic', lineHeight: 1.5 }}>“{read.watched}”</span>
        )}
      </div>

      {/* Tier chip */}
      <span style={{
        fontSize: 10, fontWeight: 700, color: tierColor,
        border: `1px solid ${tierColor}`,
        borderRadius: 'var(--radius-sm)',
        padding: '2px 8px',
        whiteSpace: 'nowrap',
        alignSelf: 'center',
      }}>
        {read.tierLabel}
      </span>
    </div>
  )
}

/* ── Full scout panel block ── */
function ScoutPanelBlock({ panel }: { panel: ScoutPanel }): JSX.Element {
  const consensusTierColor =
    panel.consensusTier === 'Star' ? 'var(--accent)' :
    panel.consensusTier === 'Key' ? 'var(--cyan)' :
    panel.consensusTier === 'Core' ? 'var(--success)' :
    panel.consensusTier === 'Prospect' ? 'var(--violet-h)' :
    'var(--muted)'

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      {/* ── Scout reads list ── */}
      <Panel title="Scout Opinions">
        <div>
          {panel.reads.map((r) => (
            <ScoutReadRow key={r.scoutId} read={r} />
          ))}
        </div>
      </Panel>

      {/* ── Consensus + dissent + comp + risk ── */}
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Panel title="Consensus">
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            {/* Consensus tier */}
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>Scouts project:</span>
              <span style={{
                fontSize: 12, fontWeight: 700, color: consensusTierColor,
                border: `1px solid ${consensusTierColor}`,
                borderRadius: 'var(--radius-sm)',
                padding: '2px 10px',
              }}>
                {panel.consensusTierLabel}
              </span>
            </div>
            {/* Dissent note */}
            {panel.dissentNote && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--accent2)', lineHeight: 1.5 }}>
                {panel.dissentNote}
              </p>
            )}
            {!panel.dissentNote && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
                Scouts are in full agreement.
              </p>
            )}
            {/* Player comparable lives in the "Shades of …" line above (real-DB
                comp). We intentionally don't also show the archetype "Plays like"
                comp here — one comparable, not two competing ones. */}
          </div>
        </Panel>

        <Panel title="Risk Profile">
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span style={{
                display: 'inline-block',
                width: 10, height: 10, borderRadius: '50%',
                background: riskColor(panel.risk.band),
                flexShrink: 0,
              }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: riskColor(panel.risk.band) }}>
                {panel.risk.band} Risk
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
              {panel.risk.upsideNote}
            </p>
          </div>
        </Panel>
      </div>
    </div>
  )
}

function TabScout({ d, client }: { d: PlayerProfileView; client: ReturnType<typeof useClient> }): JSX.Element {
  const sr = d.scoutReport
  const isGoalie = d.position === 'G'
  const [reqBusy, setReqBusy] = useState(false)

  async function requestCoachReports(): Promise<void> {
    if (reqBusy) return
    setReqBusy(true)
    try {
      const res = await client.requestCoachReport(d.playerId)
      if (res.type === 'error') toast(res.message, 'error')
      else { toast('Coaching staff reports filed to your inbox.', 'success'); bumpRefresh() }
    } finally {
      setReqBusy(false)
    }
  }

  // Tier chip colour
  const tierColor =
    sr.tier === 'Star' ? 'var(--accent)' :
    sr.tier === 'Key' ? 'var(--cyan)' :
    sr.tier === 'Core' ? 'var(--success)' :
    sr.tier === 'Prospect' ? 'var(--violet-h)' :
    'var(--muted)'

  // PROJECTION tile: for a draft prospect, this is the MATURITY projection — the
  // ceiling role our scouts believe he tops out at (e.g. "Top-pair D") — not the
  // roster-value tier his current ability slots into. For an established player
  // there's no separate ceiling to show, so we keep the value tier.
  const isDraftProspect = !!d.analystProjection || sr.tier === 'Prospect'
  const projectionLabel = isDraftProspect && d.scoutsCeilingRole ? d.scoutsCeilingRole : sr.tierLabel
  const projectionColor = isDraftProspect ? 'var(--violet-h)' : tierColor
  const projectionBlurb = isDraftProspect && d.scoutsCeilingRole
    ? 'Our scouts’ projected ceiling — the role he tops out in if he develops as expected.'
    : sr.tierBlurb

  return (
    <div className="stack">
      {/* Scout-this-player action */}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <ScoutPlayerButton playerId={d.playerId} client={client} />
      </div>
      {/* The FM-style "Overall Report" (recommendation + Pros/Cons) lives on the
          Profile tab's Coach Summary — the Scout tab leads straight into the
          richer Scouting Report below, so the two no longer duplicate each other. */}

      {/* Coach reports request — projection itself lives in the verdict tiles
          (our scouts) and the Draft Projection panel (analysts vs your scouts).
          We deliberately don't show depth-chart slotting on other clubs. */}
      {d.rosterProjection && (
        <div className="row" style={{ alignItems: 'center', gap: 'var(--sp-3)' }}>
          <button type="button" className="btn btn-sm" disabled={reqBusy} onClick={requestCoachReports}>
            {reqBusy ? 'Requesting…' : 'Request coach reports'}
          </button>
          <span className="muted small">Your coaching staff file their reports to your inbox.</span>
        </div>
      )}

      {/* ── Scouting Report ── */}
      <Panel title="Scouting Report">
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          {/* Trait badges — the loud calling cards */}
          {sr.traits.length > 0 && (
            <div style={{ paddingBottom: 'var(--sp-1)', borderBottom: '1px solid var(--line)' }}>
              <TraitBadges traits={sr.traits} />
            </div>
          )}
          {/* Hero: prospect grade badge (hover for what was weighed) + elevator pitch.
              The badge only shows for prospects — the engine omits the grade for
              established players, so veterans don't get a misleading "PROSPECT GRADE". */}
          <div className="row" style={{ gap: 'var(--sp-4)', alignItems: 'center' }}>
            {d.prospectGrade && (
              <ProspectGradeBadge
                grade={d.prospectGrade.grade}
                pros={d.prospectGrade.pros}
                cons={d.prospectGrade.cons}
              />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontStyle: 'italic', lineHeight: 1.5, color: 'var(--text)' }}>
                “{sr.elevatorPitch}”
              </div>
              <div className="muted small" style={{ marginTop: 6 }}>{sr.seasonProjection.line}</div>
              {(d.prospectGrade?.pros.length || d.prospectGrade?.cons.length) ? (
                <div className="muted" style={{ fontSize: 10.5, marginTop: 4, fontStyle: 'italic' }}>Hover the grade for what the scouts weighed</div>
              ) : null}
            </div>
          </div>

          {/* Verdict tiles: current / potential / projection */}
          <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <VerdictTile label="CURRENT">
              {d.scouted && !d.scouted.exact ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <StarRating stars={overallToStars(d.scouted.overallLo)} fogged size={16} />
                  <span className="muted small">–</span>
                  <StarRating stars={overallToStars(d.scouted.overallHi)} fogged size={16} />
                </div>
              ) : (
                <StarRating stars={overallToStars(d.overall)} size={18} />
              )}
            </VerdictTile>
            <VerdictTile label="POTENTIAL">
              <PotentialStars count={d.potentialStars} />
            </VerdictTile>
            <VerdictTile label="PROJECTION" accent={projectionColor}>
              <span style={{ fontWeight: 700, fontSize: 13, color: projectionColor }}>
                {projectionLabel}
              </span>
            </VerdictTile>
          </div>

          {/* What the projection means, in hockey terms */}
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{projectionBlurb}</div>

          {/* Report card — EP-style graded strip */}
          <div>
            <div className="stat-label" style={{ marginBottom: 7 }}>Scouting Grades</div>
            <ReportCardStrip card={sr.reportCard} isGoalie={isGoalie} />
          </div>

          {/* "Shades of …" comparison — clickable comparables */}
          {d.scoutComp && (
            <div style={{
              padding: '9px 12px', borderRadius: 'var(--radius-sm)',
              background: 'rgba(255,255,255,0.03)', border: '1px solid var(--line)',
              fontSize: 12.5, lineHeight: 1.5,
            }}>
              <span style={{ fontWeight: 700, color: 'var(--accent2, #e0b341)' }}>Shades of · </span>
              {d.scoutComp.names.map((nm, i) => (
                <span key={d.scoutComp!.ids[i] ?? nm}>
                  {i > 0 && <span style={{ color: 'var(--muted)' }}> and </span>}
                  <PlayerLink playerId={d.scoutComp!.ids[i] ?? ''} name={nm} />
                </span>
              ))}
              {d.scoutComp.differentiator && (
                <span style={{ color: 'var(--text)' }}> — {d.scoutComp.differentiator}.</span>
              )}
            </div>
          )}

          {sr.knowledge < 68 && (
            <div className="muted" style={{ fontSize: 11, fontStyle: 'italic' }}>
              {knowledgeProse(sr.knowledge)} — these grades are estimates until your scouts log more viewings.
            </div>
          )}
        </div>
      </Panel>

      {/* ── Scouting Report prose — the living, evolving write-up ── */}
      <Panel title="Scout's Write-Up">
        {d.scoutSummary ? (
          <>
            <div className="muted small" style={{ marginBottom: 8 }}>
              {d.scoutSummary.confidence === 'high' ? 'Our scouts have a confident, well-formed read.'
                : d.scoutSummary.confidence === 'medium' ? 'A developing read — sharpening with more viewings.'
                : 'An early read — light on viewings so far.'}
            </div>
            <div className="stack" style={{ gap: 10 }}>
              {d.scoutSummary.paragraphs.map((para, i) => (
                <p key={i} style={{ margin: 0, fontSize: 13, lineHeight: 1.75, color: 'var(--text)' }}>{para}</p>
              ))}
            </div>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.75, color: 'var(--text)' }}>
            {sr.generalImpressions}
          </p>
        )}
      </Panel>

      {/* ── Formal pre-draft edition (season end, eligible prospects) ── */}
      {d.preDraftSummary && (
        <Panel title="Pre-Draft Report">
          <div className="stack" style={{ gap: 10, borderLeft: '3px solid var(--accent2, #e0b341)', paddingLeft: 'var(--sp-3)' }}>
            {d.preDraftSummary.paragraphs.map((para, i) => (
              <p key={i} style={{ margin: 0, fontSize: 13, lineHeight: 1.75, color: 'var(--text)' }}>{para}</p>
            ))}
          </div>
        </Panel>
      )}

      {/* ── Draft Projection (analyst consensus + your scouts) ── */}
      {d.analystProjection && (
        <Panel title="Draft Projection">
          <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
            <div style={{ width: 4, borderRadius: 2, background: 'var(--accent2, #e0b341)', flex: '0 0 auto' }} />
            <div style={{ flex: 1 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: 'var(--accent2, #e0b341)' }}>
                  NHL DRAFT ANALYSTS
                </div>
                {d.analystDraftLabel && (
                  <span className="chip chip-accent" style={{ fontSize: 11, fontWeight: 700 }}>{d.analystDraftLabel}</span>
                )}
              </div>
              {d.analystPotentialStars !== undefined && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span className="muted" style={{ fontSize: 11 }}>Their ceiling:</span>
                  <StarRating stars={d.analystPotentialStars} size={13} />
                </div>
              )}
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text)' }}>
                {d.analystProjection}
              </p>
            </div>
          </div>
          {d.scoutDraftRead && (
            <div style={{ display: 'flex', gap: 'var(--sp-3)', marginTop: 12 }}>
              <div style={{
                width: 4, borderRadius: 2, flex: '0 0 auto',
                background: d.scoutDraftRead.verdict === 'higher' ? 'var(--success, #4caf72)'
                  : d.scoutDraftRead.verdict === 'lower' ? 'var(--danger, #d8584f)' : 'var(--muted)',
              }} />
              <div>
                <div style={{
                  fontSize: 11, fontWeight: 700, letterSpacing: 0.5, marginBottom: 4,
                  color: d.scoutDraftRead.verdict === 'higher' ? 'var(--success, #4caf72)'
                    : d.scoutDraftRead.verdict === 'lower' ? 'var(--danger, #d8584f)' : 'var(--muted)',
                }}>
                  YOUR SCOUTS{d.scoutDraftRead.verdict === 'higher' ? ' ▲' : d.scoutDraftRead.verdict === 'lower' ? ' ▼' : ''}
                </div>
                {d.scoutsCeilingRole && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span className="muted" style={{ fontSize: 11 }}>Our ceiling:</span>
                    <StarRating stars={d.potentialStars} size={13} />
                    <span className="muted small">{d.scoutsCeilingRole}</span>
                  </div>
                )}
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: 'var(--text)' }}>
                  {d.scoutDraftRead.blurb}
                </p>
              </div>
            </div>
          )}
        </Panel>
      )}

      {/* ── Attribute profile ── */}
      <Panel title="Attribute Profile">
        <div className="stack" style={{ gap: 6 }}>
          {RADAR_AXES.map((key) => (
            <AttrBar
              key={key}
              label={AXIS_LABELS[key] ?? key}
              value={d.radar[key]}
            />
          ))}
        </div>
      </Panel>

      {/* ── Multi-scout panel — only when scouts have actually watched him ── */}
      {d.scoutPanel && <ScoutPanelBlock panel={d.scoutPanel} />}
    </div>
  )
}

/* ─────────────────────────── Opinion tab ─────────────────────────── */

function opinionNote(prev: { overall: number; potentialStars: number; knowledge: number }, cur: { overall: number; potentialStars: number; knowledge: number }): string | null {
  if (cur.potentialStars > prev.potentialStars) return 'Raised his ceiling'
  if (cur.potentialStars < prev.potentialStars) return 'Lowered his ceiling'
  if (cur.overall - prev.overall >= 3) return 'Trending up'
  if (cur.overall - prev.overall <= -3) return 'Trending down'
  if (cur.knowledge - prev.knowledge >= 12) return 'Getting a clearer read'
  return null
}

function TabOpinion({ d }: { d: PlayerProfileView }): JSX.Element {
  const timeline = d.opinionTimeline ?? []
  if (timeline.length === 0) {
    return (
      <Panel title="Progress Over Time">
        <span className="muted small">
          No progress history yet — it builds through the season as {d.name} plays, develops, and is scouted. Check back after a few weeks.
        </span>
      </Panel>
    )
  }

  // Sparkline of rated overall across the series.
  const W = 520, H = 90, PAD = 8
  const ovr = timeline.map((s) => s.overall)
  const lo = Math.min(...ovr) - 2, hi = Math.max(...ovr) + 2
  const span = Math.max(1, hi - lo)
  const x = (i: number) => PAD + (timeline.length === 1 ? W / 2 : (i / (timeline.length - 1)) * (W - 2 * PAD))
  const y = (v: number) => PAD + (1 - (v - lo) / span) * (H - 2 * PAD)
  const path = timeline.map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(s.overall).toFixed(1)}`).join(' ')

  const rows = [...timeline].reverse()

  return (
    <div className="stack">
      <Panel title="Rating Trend">
        <div className="muted small" style={{ marginBottom: 6 }}>Rated overall as the season has unfolded.</div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
          <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} />
          {timeline.map((s, i) => (
            <circle key={i} cx={x(i)} cy={y(s.overall)} r={2.5} fill="var(--violet-h)" />
          ))}
        </svg>
      </Panel>

      <Panel title="Progress Log">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th className="num">Overall</th>
                <th>Current</th>
                <th>Ceiling</th>
                <th>Read</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => {
                const prev = rows[i + 1]
                const note = prev ? opinionNote(prev, s) : 'First read'
                return (
                  <tr key={`${s.year}-${s.day}`}>
                    <td className="muted small">{s.year} · GD{s.day}</td>
                    <td className="num" style={{ fontWeight: 700 }}>{s.overall}</td>
                    <td><StarRating stars={s.currentStars} size={13} /></td>
                    <td><StarRating stars={s.potentialStars} size={13} /></td>
                    <td className="muted small">{knowledgeProse(s.knowledge)}</td>
                    <td className="small" style={{
                      color: note === 'Trending up' || note === 'Raised his ceiling' ? 'var(--success)'
                        : note === 'Trending down' || note === 'Lowered his ceiling' ? 'var(--danger)'
                        : 'var(--muted)',
                    }}>{note ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

/* ═══════════════════════════ MAIN SCREEN ═══════════════════════════ */

export function PlayerProfileScreen(props: { playerId: string }): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const [activeTab, setActiveTab] = useState<TabId>('profile')

  const { data, loading, error, refetch } = useScreenData<PlayerProfileView>(
    () => client.getPlayer(props.playerId),
    (r) => (r.type === 'player' ? r.player : null)
  )

  // When playerId prop changes (prev/next navigation), refetch player data.
  // Skip the initial mount since useScreenData already fires on mount.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.playerId])

  // Fetch squad for compare dropdown (best-effort; silently absent = empty list).
  const { data: squadData } = useScreenData<SquadView>(
    () => client.getSquad(),
    (r) => (r.type === 'squad' ? r.squad : null)
  )

  const squadRows = (squadData?.rows ?? []).map((r) => ({
    playerId: r.playerId,
    name: r.name,
    position: r.position,
  }))

  // Fetch the team roster for prev/next navigation.
  // We use manual state + effect so we can key the fetch off data?.teamId.
  const [rosterIds, setRosterIds] = useState<string[]>([])
  const teamIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!data?.teamId) {
      setRosterIds([])
      return
    }
    if (teamIdRef.current === data.teamId) return
    teamIdRef.current = data.teamId
    void (async () => {
      const res = await client.getTeamSquad(data.teamId!)
      if (res.type === 'squad') {
        setRosterIds(res.squad.rows.map((r) => r.playerId))
      }
    })()
  }, [client, data?.teamId])

  // Compute prev/next player in the roster.
  const currentIdx = rosterIds.indexOf(props.playerId)
  const hasPrevNext = rosterIds.length > 1 && currentIdx >= 0
  const prevId = hasPrevNext ? rosterIds[(currentIdx - 1 + rosterIds.length) % rosterIds.length]! : null
  const nextId = hasPrevNext ? rosterIds[(currentIdx + 1) % rosterIds.length]! : null

  if (error) {
    return (
      <section className="stack">
        <ScreenHeader title="Player">
          <button className="btn btn-ghost" onClick={() => nav.navigate('squad')}>← Squad</button>
        </ScreenHeader>
        <Notice kind="warn">{error}</Notice>
      </section>
    )
  }

  if (!data) {
    return (
      <section className="stack">
        <ScreenHeader title="Player">
          <button className="btn btn-ghost" onClick={() => nav.navigate('squad')}>← Squad</button>
        </ScreenHeader>
        <Notice kind="info">{loading ? 'Loading…' : 'Player not found.'}</Notice>
      </section>
    )
  }

  const d = data

  return (
    <ThemeScope colors={d.teamColors}>
    <section className="stack">
      {/* ── Page header ── */}
      <ScreenHeader title={d.name}>
        <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
          {hasPrevNext && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => nav.navigate('player', { playerId: prevId! })}
              title="Previous player on roster"
              aria-label="Previous player"
            >
              ◄
            </button>
          )}
          {hasPrevNext && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => nav.navigate('player', { playerId: nextId! })}
              title="Next player on roster"
              aria-label="Next player"
            >
              ►
            </button>
          )}
          <button className="btn btn-ghost small" onClick={() => nav.navigate('squad')}>← Squad</button>
        </div>
      </ScreenHeader>

      {/* ── Tabs ── */}
      <div className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      {activeTab === 'profile' && (
        <TabProfile d={d} client={client} squadRows={squadRows} onChanged={refetch} />
      )}
      {activeTab === 'positions' && <TabPositions d={d} />}
      {activeTab === 'information' && <TabInformation d={d} />}
      {activeTab === 'contract' && <TabContract d={d} />}
      {activeTab === 'history' && <TabHistory d={d} />}
      {activeTab === 'scout' && <TabScout d={d} client={client} />}
      {activeTab === 'opinion' && <TabOpinion d={d} />}
    </section>
    </ThemeScope>
  )
}
