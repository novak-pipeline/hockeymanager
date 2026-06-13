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
import { useState, useCallback, useEffect, useRef } from 'react'
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
} from '../../engine/career/views'
import { RADAR_AXES } from '../../engine/career/views'
import type { SquadView } from '../../engine/career/views'
import { useNav } from '../components/NavContext'
import { fmtMoney, fmtToi } from '../components/format'
import { Notice, Panel, ScreenHeader } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'
import { PlayerFace } from '../components/PlayerFace'
import { RadarChart } from '../components/RadarChart'
import { ThemeScope } from '../components/ThemeScope'

/* ═══════════════════════════ TAB DEFINITION ═══════════════════════════ */

type TabId = 'profile' | 'positions' | 'information' | 'contract' | 'history' | 'scout'

const TABS: { id: TabId; label: string }[] = [
  { id: 'profile',     label: 'Profile' },
  { id: 'positions',   label: 'Positions & Roles' },
  { id: 'information', label: 'Information' },
  { id: 'contract',    label: 'Contract' },
  { id: 'history',     label: 'History' },
  { id: 'scout',       label: 'Scout Report' },
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
                background: 'rgba(139,92,246,0.18)',
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

/**
 * Maps a 0–99 overall to a 0–5 star rating rounded to the nearest 0.5.
 *   star = clamp(overall / 20, 0, 5) → 99 ≈ 5, 80 = 4, 60 = 3, 40 = 2, 20 = 1
 * Rounded to nearest 0.5 so half-stars are supported.
 */
function overallToStars(overall: number): number {
  const raw = Math.max(0, Math.min(5, overall / 20))
  return Math.round(raw * 2) / 2
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
  return (
    <span title={`${count}/5 potential`} style={{ letterSpacing: 2 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} style={{ color: i < count ? 'var(--accent2)' : 'var(--line)', fontSize: 13 }}>★</span>
      ))}
    </span>
  )
}

function ConditionBar({ value }: { value: number }): JSX.Element {
  const pct = Math.max(0, Math.min(100, value))
  const cls = pct < 50 ? 'meter-fill over' : pct < 75 ? 'meter-fill warn' : 'meter-fill'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="meter" style={{ width: 80, height: 6 }}>
        <div className={cls} style={{ width: `${pct}%` }} />
      </div>
      <span className="small muted">{pct}%</span>
    </div>
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
  if (g === 'A+' || g === 'A') return 'var(--success)'
  if (g === 'B+' || g === 'B') return 'rgba(52,211,153,0.85)'
  if (g === 'C+' || g === 'C') return 'var(--accent2)'
  return 'var(--danger)'
}

function ReportCardRow({ label, grade }: { label: string; grade: ReportGrade }): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderTop: '1px solid var(--line)' }}>
      <span className="muted small">{label}</span>
      <span style={{ fontWeight: 700, fontSize: 14, color: gradeColor(grade), minWidth: 28, textAlign: 'right' }}>{grade}</span>
    </div>
  )
}

function ReportCardPanel({ card, isGoalie }: { card: ReportCard; isGoalie: boolean }): JSX.Element {
  return (
    <div>
      <ReportCardRow label="Hockey Sense" grade={card.hockeyIQ} />
      <ReportCardRow label="Skating" grade={card.skating} />
      {isGoalie
        ? <ReportCardRow label="Goaltending" grade={card.goaltending ?? 'C'} />
        : <>
            <ReportCardRow label="Shot / Scoring" grade={card.shotScoring} />
            <ReportCardRow label="Puck Handling" grade={card.puckhandling} />
            <ReportCardRow label="Defence" grade={card.defence} />
            <ReportCardRow label="Physicality" grade={card.physicality} />
          </>}
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

/* ── Interview panel: ask questions to reveal hidden qualities ── */
function InterviewPanel({
  interview,
  playerId,
  client,
  onChanged,
}: {
  interview: InterviewView
  playerId: string
  client: ReturnType<typeof useClient>
  onChanged: () => void
}): JSX.Element {
  const [busy, setBusy] = useState(false)

  async function ask(questionId: string): Promise<void> {
    if (busy) return
    setBusy(true)
    await client.conductInterview(playerId, questionId)
    setBusy(false)
    onChanged()
  }

  return (
    <Panel title="Interview">
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        {interview.answers.length === 0 && (
          <span className="muted small">
            Sit down with the player — pick a question to learn what raw ratings don’t show.
          </span>
        )}
        {interview.answers.map((a) => (
          <div key={a.questionId} style={{ borderLeft: '3px solid var(--violet-h)', paddingLeft: 'var(--sp-3)' }}>
            <div className="muted small" style={{ fontStyle: 'italic' }}>{a.prompt}</div>
            <div style={{ fontSize: 13, lineHeight: 1.5, margin: '2px 0' }}>{a.answer}</div>
            <div className="small" style={{ color: 'var(--violet-h)', fontWeight: 700 }}>
              Read: {a.reveal}
            </div>
          </div>
        ))}
        {interview.available.length > 0 && (
          <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
            {interview.available.map((q) => (
              <button
                key={q.id}
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() => void ask(q.id)}
                title="Ask this question"
              >
                {q.prompt}
              </button>
            ))}
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
      {/* ── Bio header strip ── */}
      <div style={{ borderTop: '3px solid var(--team-primary, transparent)', borderRadius: 'var(--radius) var(--radius) 0 0', overflow: 'hidden' }}>
      <Panel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 'var(--sp-5)', alignItems: 'start' }}>
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            {/* Face + identity chips */}
            <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-3)', alignItems: 'center' }}>
              <PlayerFace faceId={d.faceId} name={d.name} size={72} teamColor={d.teamColors?.primary} />
              <div className="stack" style={{ gap: 'var(--sp-2)' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--team-primary, var(--text))' }}>{d.name}</div>
                <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
                  <span className="chip chip-accent">{d.position}</span>
                  <span className="chip">{d.handedness} shot</span>
                  <span className="chip">{d.age} yrs</span>
                  {d.teamName
                    ? <span className="chip">{d.teamName}</span>
                    : <span className="chip chip-warn">Free agent</span>}
                  {d.bio.jerseyNumber !== undefined && (
                    <span className="chip">#{d.bio.jerseyNumber}</span>
                  )}
                  {d.bio.nationality && <span className="chip">{d.bio.nationality}</span>}
                  <ArchetypeChip archetype={d.archetype} />
                </div>
                {/* Height / weight */}
                {(d.bio.heightCm !== undefined || d.bio.weightKg !== undefined) && (
                  <span className="muted small">
                    {d.bio.heightCm !== undefined && `${d.bio.heightCm} cm`}
                    {d.bio.heightCm !== undefined && d.bio.weightKg !== undefined && ' · '}
                    {d.bio.weightKg !== undefined && `${d.bio.weightKg} kg`}
                  </span>
                )}
              </div>
            </div>

            {/* Star rating + potential + status */}
            <div className="row" style={{ gap: 'var(--sp-5)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="stat">
                {d.scouted && !d.scouted.exact ? (
                  <>
                    {/* Fogged: show star range derived from lo/hi band */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <StarRating stars={overallToStars(d.scouted.overallLo)} fogged size={18} />
                      <span className="muted small">–</span>
                      <StarRating stars={overallToStars(d.scouted.overallHi)} fogged size={18} />
                    </div>
                    <div className="stat-label" style={{ marginTop: 4 }}>
                      Rating
                      <span className="chip chip-warn" style={{ marginLeft: 6, fontSize: 9 }}>
                        {d.scouted.knowledge}%
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <StarRating stars={overallToStars(d.overall)} size={22} />
                    <div className="stat-label" style={{ marginTop: 4 }}>Rating</div>
                  </>
                )}
              </div>
              <div className="stack" style={{ gap: 'var(--sp-1)' }}>
                <PotentialStars count={d.potentialStars} />
                <span className="muted small">Potential</span>
              </div>
              <div className="stack" style={{ gap: 'var(--sp-1)' }}>
                <span style={{ fontSize: 20, fontWeight: 700 }}>
                  {d.condition}<span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>/100</span>
                </span>
                <span className="muted small">Condition</span>
                <ConditionBar value={d.condition} />
              </div>
              <div className="stack" style={{ gap: 'var(--sp-1)' }}>
                <span style={{ fontSize: 20, fontWeight: 700 }}>{d.morale}</span>
                <span className="muted small">Morale</span>
              </div>
              <div className="stack" style={{ gap: 'var(--sp-1)' }}>
                <span style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: d.form > 2 ? 'var(--success)' : d.form < -2 ? 'var(--danger)' : 'var(--text)',
                }}>
                  {d.form > 0 ? `+${d.form}` : d.form}
                </span>
                <span className="muted small">Form</span>
              </div>
            </div>
          </div>

          {/* Contract summary */}
          {d.profileContract ? (
            <div className="panel" style={{ minWidth: 200, background: 'var(--bg2)' }}>
              <div className="panel-title">Contract</div>
              <div className="stat">
                <div className="stat-value" style={{ fontSize: 22 }}>{fmtMoney(d.profileContract.salary)}</div>
                <div className="stat-label">per year</div>
              </div>
              {d.profileContract.capHit !== d.profileContract.salary && (
                <div className="muted small" style={{ marginTop: 4 }}>
                  Cap hit: {fmtMoney(d.profileContract.capHit)}
                </div>
              )}
              <div className="muted small" style={{ marginTop: 'var(--sp-2)' }}>
                {d.profileContract.yearsRemaining} yr{d.profileContract.yearsRemaining !== 1 ? 's' : ''} remaining
                · expires {d.profileContract.expiryYear}
              </div>
              <div className="meter" style={{ marginTop: 'var(--sp-3)' }}>
                <div className="meter-fill" style={{ width: `${Math.max(0, Math.min(100, d.profileContract.salary / 12_000_000 * 100))}%` }} />
              </div>
              <div className="muted small" style={{ marginTop: 4 }}>
                {((d.profileContract.salary / 83_500_000) * 100).toFixed(1)}% of cap
              </div>
              {d.profileContract.freeAgentStatus && (
                <span className="chip chip-warn" style={{ marginTop: 6 }}>{d.profileContract.freeAgentStatus}</span>
              )}
              {d.profileContract.noTradeClause && <span className="chip chip-warn" style={{ marginTop: 4 }}>NTC</span>}
              {d.profileContract.twoWay && <span className="chip" style={{ marginTop: 4 }}>2-way</span>}
            </div>
          ) : d.contract ? (
            <div className="panel" style={{ minWidth: 200, background: 'var(--bg2)' }}>
              <div className="panel-title">Contract</div>
              <div className="stat">
                <div className="stat-value" style={{ fontSize: 22 }}>{fmtMoney(d.contract.salary)}</div>
                <div className="stat-label">per year</div>
              </div>
              <div className="muted small" style={{ marginTop: 'var(--sp-2)' }}>
                {d.contract.yearsRemaining} yr{d.contract.yearsRemaining !== 1 ? 's' : ''} remaining
                · expires {d.contract.expiryYear}
              </div>
            </div>
          ) : (
            <div className="panel" style={{ minWidth: 180, background: 'var(--bg2)' }}>
              <div className="panel-title">Contract</div>
              <span className="muted small">No contract</span>
            </div>
          )}
        </div>
      </Panel>
      </div>

      {/* ── Attribute groups + Ratings card ── */}
      <div className="grid grid-2">
        {/* Attribute groups */}
        <div className="stack">
          {d.attributeGroups.map((group) => (
            <Panel key={group.name} title={group.name}>
              <div className="stack" style={{ gap: 6 }}>
                {group.attributes.map((a) => (
                  <AttrBar
                    key={a.label}
                    label={a.label}
                    value={a.value}
                    lo={a.lo}
                    hi={a.hi}
                    masked={a.masked}
                  />
                ))}
              </div>
            </Panel>
          ))}

          {/* Composites */}
          {d.composites.length > 0 && (
            <Panel title="Composites">
              <div className="stack" style={{ gap: 8 }}>
                {d.composites.map((c) => (
                  <AttrBar key={c.label} label={c.label} value={c.value} />
                ))}
              </div>
            </Panel>
          )}
        </div>

        {/* Radar + compare */}
        <div>
          <CompareControl
            currentId={d.playerId}
            currentName={d.name}
            currentRadar={d.radar}
            onCompare={(id) => { void handleCompare(id) }}
            compareResult={compareResult}
            comparing={comparing}
            squadRows={squadRows}
          />
        </div>
      </div>

      {/* ── Status cards ── */}
      {d.injury && (
        <Notice kind="danger">
          Injured: {d.injury.description} — {d.injury.gamesRemaining} game{d.injury.gamesRemaining !== 1 ? 's' : ''} remaining
        </Notice>
      )}

      {/* Personality archetype — the headline character read */}
      {d.personalityType && (
        <div
          className="panel"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sp-3)',
            padding: 'var(--sp-3) var(--sp-4)',
            borderLeft: '3px solid var(--violet-h)',
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 800,
              color: 'var(--violet-h)',
              whiteSpace: 'nowrap',
            }}
          >
            {d.personalityType.label}
          </span>
          <span className="muted small" style={{ lineHeight: 1.4 }}>
            {d.personalityType.blurb}
          </span>
        </div>
      )}

      {/* Mark for staff-meeting discussion */}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <MarkForMeeting playerId={d.playerId} client={client} />
      </div>

      {/* System fit — how well the player suits the team's current tactics */}
      {d.systemFit && (() => {
        const s = d.systemFit.score
        const color = s >= 80 ? 'var(--success)' : s >= 66 ? 'var(--green)' : s >= 50 ? 'var(--accent2, var(--violet-h))' : 'var(--danger)'
        return (
          <div
            className="panel"
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', padding: 'var(--sp-3) var(--sp-4)' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 54 }}>
              <span className="mono" style={{ fontSize: 20, fontWeight: 800, color }}>{s}</span>
              <span className="muted" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 }}>Fit</span>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color }}>
                {d.systemFit.label} · {d.systemFit.styleLabel}
              </div>
              <div className="muted small" style={{ lineHeight: 1.4 }}>{d.systemFit.reason}</div>
            </div>
          </div>
        )
      })()}

      {/* Interview — choose questions to reveal hidden qualities */}
      {d.interview && (
        <InterviewPanel
          interview={d.interview}
          playerId={d.playerId}
          client={client}
          onChanged={onChanged}
        />
      )}

      {/* Mindset panel — staff-gathered outlook */}
      {d.mindset && <MindsetPanel mindset={d.mindset} />}

      {/* Season snapshot (current season only for the Profile tab quick view) */}
      {d.seasons.length > 0 && (() => {
        const cur = d.seasons[0]!
        return (
          <Panel title="This Season">
            {isGoalie && cur.goalie ? (
              <div className="row" style={{ gap: 'var(--sp-5)', flexWrap: 'wrap' }}>
                {[
                  { label: 'GP', value: cur.goalie.gamesPlayed },
                  { label: 'W', value: cur.goalie.wins },
                  { label: 'L', value: cur.goalie.losses },
                  { label: 'SV%', value: `.${Math.round(cur.goalie.savePct * 1000)}` },
                  { label: 'GAA', value: cur.goalie.goalsAgainstAverage.toFixed(2) },
                  { label: 'SO', value: cur.goalie.shutouts },
                ].map(({ label, value }) => (
                  <div key={label} className="stat">
                    <div className="stat-value" style={{ fontSize: 20 }}>{value}</div>
                    <div className="stat-label">{label}</div>
                  </div>
                ))}
              </div>
            ) : cur.skater ? (
              <div className="row" style={{ gap: 'var(--sp-5)', flexWrap: 'wrap' }}>
                {[
                  { label: 'GP', value: cur.skater.gamesPlayed },
                  { label: 'G', value: cur.skater.goals },
                  { label: 'A', value: cur.skater.assists },
                  { label: 'PTS', value: cur.skater.points },
                  { label: '±', value: cur.skater.plusMinus > 0 ? `+${cur.skater.plusMinus}` : cur.skater.plusMinus },
                  { label: 'TOI/g', value: fmtToi(cur.skater.toiPerGame) },
                ].map(({ label, value }) => (
                  <div key={label} className="stat">
                    <div className="stat-value" style={{ fontSize: 20 }}>{value}</div>
                    <div className="stat-label">{label}</div>
                  </div>
                ))}
              </div>
            ) : (
              <span className="muted small">No games played</span>
            )}
          </Panel>
        )
      })()}
    </div>
  )
}

function TabPositions({ d }: { d: PlayerProfileView }): JSX.Element {
  return (
    <div className="stack">
      <Panel title="Position & Role">
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
            <span className="muted small" style={{ width: 90 }}>Position</span>
            <span className="chip chip-accent" style={{ fontSize: 13, padding: '4px 14px' }}>{d.position}</span>
          </div>
          <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
            <span className="muted small" style={{ width: 90 }}>Role</span>
            <span className="chip" style={{ fontSize: 13, padding: '4px 14px' }}>{d.role}</span>
          </div>
          {d.handedness && (
            <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
              <span className="muted small" style={{ width: 90 }}>Shot</span>
              <span className="chip">{d.handedness} shot</span>
            </div>
          )}
        </div>
      </Panel>

      {d.archetype && (
        <Panel title="Archetype">
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <ArchetypeChip archetype={d.archetype} />
            {d.archetype.descriptors.length > 0 && (
              <div>
                <div className="panel-title" style={{ marginBottom: 6 }}>Style traits</div>
                <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
                  {d.archetype.descriptors.map((desc) => (
                    <span key={desc} className="chip">{desc}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Panel>
      )}

      {/* Composites as suitability indicators */}
      {d.composites.length > 0 && (
        <Panel title="Composites">
          <div className="stack" style={{ gap: 8 }}>
            {d.composites.map((c) => (
              <AttrBar key={c.label} label={c.label} value={c.value} />
            ))}
          </div>
        </Panel>
      )}
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
      <Panel title="Draft Status">
        <InfoRow
          label="NHL Draft"
          value={h.nhlDrafted ? 'Drafted' : h.nhlDraftEligible ? 'Draft eligible' : 'Not eligible'}
        />
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
              <InfoRow label="Current rep." value={h.currentReputation > 0 ? repTier(h.currentReputation) : undefined} />
              <InfoRow label="World rep." value={h.worldReputation > 0 ? repTier(h.worldReputation) : undefined} />
            </>
          )}
        </Panel>
      )}
    </div>
  )
}

/** EHM-style reputation tier from a 0–200 reputation rating. A GM reads "World
 *  Class", not a raw number. */
function repTier(v: number): string {
  if (v <= 0) return 'Unknown'
  if (v < 40) return 'Obscure'
  if (v < 75) return 'Regional'
  if (v < 110) return 'National'
  if (v < 140) return 'Continental'
  if (v < 165) return 'World Class'
  if (v < 185) return 'Superstar'
  return 'Global Icon'
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
                <td className="muted">{season.teamAbbr}</td>
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

      {/* Name + take */}
      <div className="stack" style={{ gap: 2 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{read.scoutName}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{read.take}</span>
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
            {/* NHL comp */}
            {panel.comp && (
              <div style={{
                marginTop: 4,
                padding: '6px 10px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--panel2)',
                border: '1px solid var(--line)',
              }}>
                <span className="muted small">Plays like </span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{panel.comp.name}</span>
                <span className="muted small"> — {panel.comp.blurb}</span>
              </div>
            )}
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

function TabScout({ d }: { d: PlayerProfileView }): JSX.Element {
  const sr = d.scoutReport
  const isGoalie = d.position === 'G'

  // Tier chip colour
  const tierColor =
    sr.tier === 'Star' ? 'var(--accent)' :
    sr.tier === 'Key' ? 'var(--cyan)' :
    sr.tier === 'Core' ? 'var(--success)' :
    sr.tier === 'Prospect' ? 'var(--violet-h)' :
    'var(--muted)'

  const v = d.scoutVerdict

  return (
    <div className="stack">
      {/* ── FM-style Overall Report ── */}
      {v && (
        <Panel title="Overall Report">
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            {/* Verdict banner */}
            <div
              style={{
                background: 'rgba(34,197,94,0.12)',
                border: '1px solid rgba(34,197,94,0.4)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--sp-3) var(--sp-4)',
                fontWeight: 700,
                color: 'var(--success)',
              }}
            >
              {v.recommendation}
            </div>

            {/* Ability + best role */}
            <div className="row" style={{ gap: 'var(--sp-5)', flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <div className="muted small">Current ability</div>
                <StarRating stars={v.currentStars} size={18} />
              </div>
              <div>
                <div className="muted small">Potential</div>
                <StarRating stars={v.potentialStars} fogged size={18} />
              </div>
              <div>
                <div className="muted small">Best role</div>
                <div style={{ fontWeight: 700, color: 'var(--violet-h)' }}>{v.bestRole}</div>
              </div>
            </div>

            {/* Pros / Cons */}
            <div className="grid grid-2" style={{ gap: 'var(--sp-4)' }}>
              <div>
                <div className="field-label" style={{ color: 'var(--success)' }}>Pros</div>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {v.pros.length > 0 ? v.pros.map((s, i) => (
                    <li key={i} style={{ fontSize: 13, lineHeight: 1.6 }}>{s}</li>
                  )) : <li className="muted small" style={{ listStyle: 'none', marginLeft: -18 }}>No standout strengths.</li>}
                </ul>
              </div>
              <div>
                <div className="field-label" style={{ color: 'var(--danger)' }}>Cons</div>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {v.cons.length > 0 ? v.cons.map((s, i) => (
                    <li key={i} style={{ fontSize: 13, lineHeight: 1.6 }}>{s}</li>
                  )) : <li className="muted small" style={{ listStyle: 'none', marginLeft: -18 }}>No notable weaknesses.</li>}
                </ul>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {/* ── Scout's Assessment header ── */}
      <Panel title="Scout's Assessment">
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          {/* Rating + potential */}
          <div className="row" style={{ gap: 'var(--sp-5)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="stat">
              {d.scouted && !d.scouted.exact ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <StarRating stars={overallToStars(d.scouted.overallLo)} fogged size={20} />
                  <span className="muted small">–</span>
                  <StarRating stars={overallToStars(d.scouted.overallHi)} fogged size={20} />
                  <span className="chip chip-warn" style={{ marginLeft: 6, fontSize: 9 }}>
                    {sr.knowledge}% scouted
                  </span>
                </div>
              ) : (
                <StarRating stars={overallToStars(d.overall)} size={22} />
              )}
              <div className="stat-label" style={{ marginTop: 4 }}>Rating</div>
            </div>
            <div className="stack" style={{ gap: 'var(--sp-1)' }}>
              <PotentialStars count={d.potentialStars} />
              <span className="muted small">Ceiling</span>
            </div>
            {/* Projection tier chip */}
            <span style={{
              display: 'inline-block',
              padding: '3px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(0,0,0,0.25)',
              border: `1px solid ${tierColor}`,
              color: tierColor,
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: 0.5,
            }}>
              {sr.tierLabel}
            </span>
          </div>

          {/* Season outlook */}
          <span className="muted small" style={{ fontStyle: 'italic' }}>
            {sr.seasonProjection.line}
          </span>
        </div>
      </Panel>

      {/* ── General Impressions prose ── */}
      <Panel title="General Impressions">
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.75, color: 'var(--text)' }}>
          {sr.generalImpressions}
        </p>
        {sr.knowledge < 50 && (
          <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>
            Scout knowledge is limited at {sr.knowledge}%. Assign a scout to this player for a more complete picture.
          </p>
        )}
      </Panel>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        {/* ── Report card ── */}
        <Panel title="Report Card">
          <ReportCardPanel card={sr.reportCard} isGoalie={isGoalie} />
        </Panel>

        {/* ── Radar axes ── */}
        <Panel title="Radar Axes">
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
      </div>

      {/* ── Multi-scout panel ── */}
      <ScoutPanelBlock panel={d.scoutPanel} />
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
      {activeTab === 'scout' && <TabScout d={d} />}
    </section>
    </ThemeScope>
  )
}
