/**
 * DataHubScreen — SciSports / StatsCentre-style analytics hub.
 *
 * Two scopes:
 *   LEAGUE — whole-league analytics: team radar, sortable team table,
 *             player scatter, player leader tables.
 *   TEAM   — one-club deep-dive: team profile radar + category tabs
 *             (Overview / Offense / Defence / Power Play / Penalty Kill /
 *             Goaltending), each showing relevant team + player metrics
 *             with league percentile/rank context.
 *
 * Category tabs are only active in TEAM scope. The team picker defaults
 * to the user's own team but allows any NHL club.
 */

import { useState, useEffect, useRef } from 'react'
import type {
  DataHubView,
  TeamDataHubView,
  TeamAnalyticsRow,
  PlayerAnalyticsRow,
  TeamPlayerAnalyticsRow,
  GoalieAnalyticsRow,
} from '../../worker/protocol'
import { Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'
import { useNav } from '../components/NavContext'

/* ═══════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════ */

function pctileColor(p: number): string {
  if (p >= 66) return 'var(--green)'
  if (p >= 33) return 'var(--amber)'
  return 'var(--red)'
}

function rankColor(rank: number, total: number): string {
  const pct = 1 - (rank - 1) / Math.max(total - 1, 1)
  return pctileColor(pct * 100)
}

/* ═══════════════════════════════════════════════════════════════════
   1.  PercentileRadar — generic SVG polygon over labelled 0–100 axes
   ═══════════════════════════════════════════════════════════════════ */

interface RadarAxis {
  key: string
  label: string
  rawLabel: string
  percentile: number
}

interface PercentileRadarProps {
  axes: RadarAxis[]
  size?: number
  title?: string
}

function PercentileRadar({ axes, size = 280, title }: PercentileRadarProps): JSX.Element {
  const n = axes.length
  const cx = size / 2
  const cy = size / 2
  const r = size * 0.34

  function axisAngle(i: number): number {
    return (Math.PI * 2 * i) / n - Math.PI / 2
  }

  function spokePoint(i: number, pctile: number): [number, number] {
    const t = axisAngle(i)
    const scale = Math.max(0, Math.min(100, pctile)) / 100
    return [cx + r * scale * Math.cos(t), cy + r * scale * Math.sin(t)]
  }

  function vertex(i: number, frac: number): [number, number] {
    const t = axisAngle(i)
    return [cx + r * frac * Math.cos(t), cy + r * frac * Math.sin(t)]
  }

  function polyStr(pts: [number, number][]): string {
    return pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  }

  const rings = [0.25, 0.5, 0.75, 1.0]
  const ringLabels = ['25', '50', '75', '100']
  const fillPts = axes.map((ax, i) => spokePoint(i, ax.percentile))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      {title && (
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--violet-h)', textTransform: 'uppercase', letterSpacing: 1 }}>
          {title}
        </div>
      )}
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        aria-label="Team percentile radar chart"
        style={{ display: 'block', overflow: 'visible' }}
      >
        {rings.map((frac, ri) => {
          const ringPts = Array.from({ length: n }, (_, i) => vertex(i, frac))
          return (
            <polygon
              key={ri}
              points={polyStr(ringPts)}
              fill="none"
              stroke="var(--line)"
              strokeWidth={1}
              opacity={0.7}
            />
          )
        })}
        {rings.map((frac, ri) => {
          const [lx, ly] = vertex(0, frac)
          return (
            <text key={ri} x={lx + 3} y={ly + 3} fontSize={8} fill="var(--muted)" fontFamily="inherit" opacity={0.7}>
              {ringLabels[ri]}
            </text>
          )
        })}
        {axes.map((_, i) => {
          const [vx, vy] = vertex(i, 1)
          return <line key={i} x1={cx} y1={cy} x2={vx} y2={vy} stroke="var(--line)" strokeWidth={1} opacity={0.6} />
        })}
        <polygon
          points={polyStr(fillPts)}
          fill="var(--violet)"
          fillOpacity={0.18}
          stroke="var(--violet)"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {fillPts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={4} fill={pctileColor(axes[i]!.percentile)} stroke="var(--bg1)" strokeWidth={1} />
        ))}
        {axes.map((ax, i) => {
          const angle = axisAngle(i)
          const labelR = r + 28
          const lx = cx + labelR * Math.cos(angle)
          const ly = cy + labelR * Math.sin(angle)
          const textAnchor =
            Math.abs(angle + Math.PI / 2) < 0.25 || Math.abs(angle - Math.PI / 2) < 0.25
              ? 'middle'
              : lx < cx - 4 ? 'end' : 'start'
          return (
            <g key={ax.key}>
              <text x={lx} y={ly - 6} textAnchor={textAnchor} fontSize={9} fontWeight={700} fill="var(--muted)" fontFamily="inherit" style={{ textTransform: 'uppercase' }} letterSpacing="0.5">
                {ax.label}
              </text>
              <text x={lx} y={ly + 6} textAnchor={textAnchor} fontSize={9} fontWeight={600} fill="var(--text)" fontFamily="inherit">
                {ax.rawLabel}
              </text>
              <text x={lx} y={ly + 17} textAnchor={textAnchor} fontSize={8} fontWeight={700} fill={pctileColor(ax.percentile)} fontFamily="inherit">
                {Math.round(ax.percentile)}th %ile
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   2.  buildRadarAxes — TeamAnalyticsRow → PercentileRadar axes
   ═══════════════════════════════════════════════════════════════════ */

function buildTeamRadarAxes(row: TeamAnalyticsRow): RadarAxis[] {
  return [
    { key: 'gf',       label: 'GF/60',     rawLabel: row.gfPer60.toFixed(2),                   percentile: row.gfPctile },
    { key: 'xgf',      label: 'xGF/60',    rawLabel: row.xgfPer60.toFixed(2),                  percentile: row.xgfPctile },
    { key: 'shots',    label: 'Shots/60',  rawLabel: row.shotsPer60.toFixed(1),                 percentile: row.shotsPctile },
    { key: 'pp',       label: 'PP%',       rawLabel: `${(row.ppPct * 100).toFixed(1)}%`,        percentile: row.ppPctile },
    { key: 'pk',       label: 'PK%',       rawLabel: `${(row.pkPct * 100).toFixed(1)}%`,        percentile: row.pkPctile },
    { key: 'suppress', label: 'Suppress',  rawLabel: row.shotsAgainstPer60.toFixed(1),          percentile: row.shotsAgainstPctile },
    { key: 'xga',      label: 'xGA/60↓',  rawLabel: row.xgaPer60.toFixed(2),                   percentile: row.xgaPctile },
    { key: 'ga',       label: 'GA/60↓',   rawLabel: row.gaPer60.toFixed(2),                    percentile: row.gaPctile },
  ]
}

/* ═══════════════════════════════════════════════════════════════════
   3.  PercentileBar
   ═══════════════════════════════════════════════════════════════════ */

function PercentileBar({ value }: { value: number }): JSX.Element {
  const pct = Math.max(0, Math.min(100, value))
  const color = pctileColor(pct)
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, width: '100%' }}>
      <div className="meter" style={{ flex: 1, height: 5 }}>
        <div className="meter-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, color, minWidth: 26, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {Math.round(pct)}
      </span>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   4.  TeamLeagueTable — sortable analytics table (LEAGUE scope)
   ═══════════════════════════════════════════════════════════════════ */

type TeamSortKey = 'gfPer60' | 'gaPer60' | 'xgfPer60' | 'xgaPer60' | 'shotsPer60' | 'shotsAgainstPer60' | 'ppPct' | 'pkPct'

interface ColDef {
  key: TeamSortKey
  label: string
  format: (row: TeamAnalyticsRow) => string
  pctileKey: keyof TeamAnalyticsRow
  lowerBetter?: boolean
}

const TEAM_COLS: ColDef[] = [
  { key: 'gfPer60',           label: 'GF/60',  format: (r) => r.gfPer60.toFixed(2),               pctileKey: 'gfPctile' },
  { key: 'gaPer60',           label: 'GA/60',  format: (r) => r.gaPer60.toFixed(2),               pctileKey: 'gaPctile',           lowerBetter: true },
  { key: 'xgfPer60',          label: 'xGF/60', format: (r) => r.xgfPer60.toFixed(2),              pctileKey: 'xgfPctile' },
  { key: 'xgaPer60',          label: 'xGA/60', format: (r) => r.xgaPer60.toFixed(2),              pctileKey: 'xgaPctile',          lowerBetter: true },
  { key: 'shotsPer60',        label: 'SF/60',  format: (r) => r.shotsPer60.toFixed(1),            pctileKey: 'shotsPctile' },
  { key: 'shotsAgainstPer60', label: 'SA/60',  format: (r) => r.shotsAgainstPer60.toFixed(1),     pctileKey: 'shotsAgainstPctile', lowerBetter: true },
  { key: 'ppPct',             label: 'PP%',    format: (r) => `${(r.ppPct * 100).toFixed(1)}%`,   pctileKey: 'ppPctile' },
  { key: 'pkPct',             label: 'PK%',    format: (r) => `${(r.pkPct * 100).toFixed(1)}%`,   pctileKey: 'pkPctile' },
]

function TeamLeagueTable({ teams, userTeamId }: { teams: TeamAnalyticsRow[]; userTeamId: string }): JSX.Element {
  const [sortKey, setSortKey] = useState<TeamSortKey>('xgfPer60')
  const [sortAsc, setSortAsc] = useState(false)

  function handleSort(key: TeamSortKey): void {
    if (key === sortKey) setSortAsc((a) => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  const col = TEAM_COLS.find((c) => c.key === sortKey) ?? TEAM_COLS[2]!
  const sorted = [...teams].sort((a, b) => {
    const diff = (a[sortKey] as number) - (b[sortKey] as number)
    return sortAsc ? diff : -diff
  })

  function sortIndicator(key: TeamSortKey): string {
    if (key !== sortKey) return ''
    return sortAsc ? ' ▲' : ' ▼'
  }

  return (
    <div className="table-wrap">
      <table className="table" style={{ minWidth: 720 }}>
        <thead>
          <tr>
            <th style={{ width: 32, textAlign: 'center' }}>#</th>
            <th style={{ minWidth: 140 }}>Team</th>
            <th style={{ width: 36, textAlign: 'right' }}>GP</th>
            {TEAM_COLS.map((c) => (
              <th
                key={c.key}
                style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none', minWidth: 72 }}
                onClick={() => handleSort(c.key)}
                title={c.lowerBetter ? `${c.label} (lower is better)` : c.label}
              >
                {c.label}{sortIndicator(c.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, idx) => {
            const isUser = row.teamId === userTeamId
            const pctile = row[col.pctileKey] as number
            return (
              <tr key={row.teamId} className={isUser ? 'is-user' : ''}>
                <td className="num" style={{ color: 'var(--muted)', fontSize: 11 }}>{idx + 1}</td>
                <td>
                  <span style={{ fontWeight: isUser ? 700 : 500 }}>{row.teamAbbr}</span>
                  <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 6 }}>{row.teamName}</span>
                </td>
                <td className="num" style={{ color: 'var(--muted)', fontSize: 12 }}>{row.gamesPlayed}</td>
                {TEAM_COLS.map((c) => {
                  const thisPctile = row[c.pctileKey] as number
                  const isActive = c.key === sortKey
                  return (
                    <td key={c.key} className="num">
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                        <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: isActive ? 700 : 400 }}>
                          {c.format(row)}
                        </span>
                        <PercentileBar value={thisPctile} />
                      </div>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   5.  PlayerScatter — SVG Expected Attacking Output chart
   ═══════════════════════════════════════════════════════════════════ */

function PlayerScatter({
  players,
  userTeamAbbrs,
  onPlayerClick,
}: {
  players: PlayerAnalyticsRow[]
  userTeamAbbrs: Set<string>
  onPlayerClick: (playerId: string) => void
}): JSX.Element {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; row: PlayerAnalyticsRow } | null>(null)

  if (players.length === 0) {
    return <div style={{ color: 'var(--muted)', fontSize: 12, padding: 'var(--sp-3)' }}>No player data yet — play some games first.</div>
  }

  const W = 480
  const H = 340
  const PAD = { top: 24, right: 24, bottom: 40, left: 48 }
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const allXA = players.map((p) => p.xAPer60)
  const allXG = players.map((p) => p.xgPer60)
  const xMin = 0
  const xMax = Math.max(1, ...allXA) * 1.1
  const yMin = 0
  const yMax = Math.max(1, ...allXG) * 1.1

  function toSvgX(v: number): number { return PAD.left + ((v - xMin) / (xMax - xMin)) * plotW }
  function toSvgY(v: number): number { return PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH }

  const midX = (xMin + xMax) / 2
  const midY = (yMin + yMax) / 2
  const qLineX = toSvgX(midX)
  const qLineY = toSvgY(midY)

  const quadrants = [
    { label: 'High xG + High Creation', x: toSvgX(xMax * 0.75), y: toSvgY(yMax * 0.87), anchor: 'middle' },
    { label: 'High xG + Low Creation',  x: toSvgX(xMin + (midX - xMin) * 0.5), y: toSvgY(yMax * 0.87), anchor: 'middle' },
    { label: 'Low xG + High Creation',  x: toSvgX(xMax * 0.75), y: toSvgY(yMin + (midY - yMin) * 0.5), anchor: 'middle' },
    { label: 'Low xG + Low Creation',   x: toSvgX(xMin + (midX - xMin) * 0.5), y: toSvgY(yMin + (midY - yMin) * 0.5), anchor: 'middle' },
  ]

  function xTicks(): number[] {
    const step = xMax > 4 ? 1 : 0.5
    const ticks: number[] = []
    for (let v = 0; v <= xMax; v += step) ticks.push(parseFloat(v.toFixed(2)))
    return ticks
  }
  function yTicks(): number[] {
    const step = yMax > 4 ? 1 : 0.5
    const ticks: number[] = []
    for (let v = 0; v <= yMax; v += step) ticks.push(parseFloat(v.toFixed(2)))
    return ticks
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block', overflow: 'visible' }} aria-label="Player expected attacking output scatter">
        <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="var(--bg2)" rx={4} />
        <line x1={qLineX} y1={PAD.top} x2={qLineX} y2={PAD.top + plotH} stroke="var(--line)" strokeWidth={1} strokeDasharray="4 3" />
        <line x1={PAD.left} y1={qLineY} x2={PAD.left + plotW} y2={qLineY} stroke="var(--line)" strokeWidth={1} strokeDasharray="4 3" />
        {quadrants.map((q, i) => (
          <text key={i} x={q.x} y={q.y} textAnchor={q.anchor as 'middle'} fontSize={8} fill="var(--muted)" fontFamily="inherit" opacity={0.6}>{q.label}</text>
        ))}
        {xTicks().map((v) => {
          const sx = toSvgX(v)
          return (
            <g key={v}>
              <line x1={sx} y1={PAD.top + plotH} x2={sx} y2={PAD.top + plotH + 4} stroke="var(--line)" strokeWidth={1} />
              <text x={sx} y={PAD.top + plotH + 14} textAnchor="middle" fontSize={8} fill="var(--muted)" fontFamily="inherit">{v.toFixed(1)}</text>
            </g>
          )
        })}
        {yTicks().map((v) => {
          const sy = toSvgY(v)
          return (
            <g key={v}>
              <line x1={PAD.left - 4} y1={sy} x2={PAD.left} y2={sy} stroke="var(--line)" strokeWidth={1} />
              <text x={PAD.left - 6} y={sy + 3} textAnchor="end" fontSize={8} fill="var(--muted)" fontFamily="inherit">{v.toFixed(1)}</text>
            </g>
          )
        })}
        <text x={PAD.left + plotW / 2} y={H - 4} textAnchor="middle" fontSize={9} fontWeight={600} fill="var(--muted)" fontFamily="inherit">xA/60 (Shot Creation)</text>
        <text x={12} y={PAD.top + plotH / 2} textAnchor="middle" fontSize={9} fontWeight={600} fill="var(--muted)" fontFamily="inherit" transform={`rotate(-90, 12, ${PAD.top + plotH / 2})`}>xG/60 (Shot Quality)</text>
        {players.map((p) => {
          const isUser = userTeamAbbrs.has(p.teamAbbr)
          const sx = toSvgX(p.xAPer60)
          const sy = toSvgY(p.xgPer60)
          return (
            <g key={p.playerId}>
              <circle
                cx={sx} cy={sy} r={isUser ? 5.5 : 4}
                fill={isUser ? 'var(--violet)' : 'var(--bg3)'}
                stroke={isUser ? 'var(--violet-h)' : 'var(--line)'}
                strokeWidth={isUser ? 1.5 : 1}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setTooltip({ x: sx, y: sy, row: p })}
                onMouseLeave={() => setTooltip(null)}
                onClick={() => onPlayerClick(p.playerId)}
              />
              {isUser && (
                <text x={sx + 7} y={sy + 4} fontSize={8} fontWeight={700} fill="var(--violet-h)" fontFamily="inherit" style={{ pointerEvents: 'none' }}>
                  {p.name.split(' ').pop()}
                </text>
              )}
            </g>
          )
        })}
        {tooltip && (
          <g>
            <rect x={Math.min(tooltip.x + 8, W - 130)} y={Math.max(tooltip.y - 36, PAD.top)} width={122} height={44} fill="var(--bg1)" stroke="var(--line)" rx={4} />
            <text x={Math.min(tooltip.x + 14, W - 124)} y={Math.max(tooltip.y - 20, PAD.top + 14)} fontSize={9} fontWeight={700} fill="var(--text)" fontFamily="inherit">
              {tooltip.row.name} ({tooltip.row.teamAbbr})
            </text>
            <text x={Math.min(tooltip.x + 14, W - 124)} y={Math.max(tooltip.y - 8, PAD.top + 26)} fontSize={8} fill="var(--muted)" fontFamily="inherit">
              {`xG/60: ${tooltip.row.xgPer60.toFixed(2)}  xA/60: ${tooltip.row.xAPer60.toFixed(2)}`}
            </text>
            <text x={Math.min(tooltip.x + 14, W - 124)} y={Math.max(tooltip.y + 4, PAD.top + 36)} fontSize={8} fill="var(--muted)" fontFamily="inherit">
              {`G/60: ${tooltip.row.goalsPer60.toFixed(2)}  Fin: ${tooltip.row.finishing >= 0 ? '+' : ''}${tooltip.row.finishing.toFixed(2)}`}
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   6.  PlayerLeaderTable — compact leaderboard for one stat
   ═══════════════════════════════════════════════════════════════════ */

function PlayerLeaderTable({
  rows,
  label,
  format,
  userTeamAbbrs,
  onPlayerClick,
}: {
  rows: PlayerAnalyticsRow[]
  label: string
  format: (r: PlayerAnalyticsRow) => string
  userTeamAbbrs: Set<string>
  onPlayerClick: (playerId: string) => void
}): JSX.Element {
  return (
    <Panel title={label}>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 26 }}>#</th>
              <th>Player</th>
              <th style={{ width: 40 }}>Tm</th>
              <th style={{ width: 36, textAlign: 'right' }}>GP</th>
              <th style={{ width: 60, textAlign: 'right' }}>{label}</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 15).map((row, idx) => {
              const isUser = userTeamAbbrs.has(row.teamAbbr)
              return (
                <tr key={row.playerId} className={isUser ? 'is-user' : ''}>
                  <td className="num" style={{ color: 'var(--muted)', fontSize: 11 }}>{idx + 1}</td>
                  <td>
                    <button type="button" className="player-link" style={{ fontWeight: isUser ? 700 : 400, fontSize: 12 }} onClick={() => onPlayerClick(row.playerId)}>
                      {row.name}
                    </button>
                  </td>
                  <td style={{ color: 'var(--muted)', fontSize: 11 }}>{row.teamAbbr}</td>
                  <td className="num" style={{ color: 'var(--muted)', fontSize: 11 }}>{row.gamesPlayed}</td>
                  <td className="num" style={{ fontWeight: 700, fontSize: 12, color: isUser ? 'var(--violet-h)' : 'var(--text)' }}>{format(row)}</td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={5} style={{ color: 'var(--muted)', textAlign: 'center', padding: 'var(--sp-3)' }}>No data yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   7.  TeamProfilePanel (shared between scopes)
   ═══════════════════════════════════════════════════════════════════ */

function TeamProfilePanel({ row }: { row: TeamAnalyticsRow }): JSX.Element {
  const axes = buildTeamRadarAxes(row)
  return (
    <Panel title="Team Profile — League Percentiles">
      <div style={{ display: 'flex', gap: 'var(--sp-5)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <PercentileRadar axes={axes} size={300} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 'var(--sp-3)', lineHeight: 1.5 }}>
            Each spoke = league percentile (100 = best).
            <br />GA/60 and xGA/60 are <em>inverted</em> — higher spoke = better defence.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {axes.map((ax) => (
              <div key={ax.key} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 36px', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{ax.label}</span>
                <PercentileBar value={ax.percentile} />
                <span style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{ax.rawLabel}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 'var(--sp-4)', fontSize: 11, color: 'var(--muted)' }}>GP: {row.gamesPlayed}</div>
        </div>
      </div>
    </Panel>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   8.  TEAM SCOPE — category tab components
   ═══════════════════════════════════════════════════════════════════ */

type Category = 'overview' | 'offense' | 'defence' | 'powerplay' | 'penaltykill' | 'goaltending'

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'overview',     label: 'Overview' },
  { id: 'offense',      label: 'Offense' },
  { id: 'defence',      label: 'Defence' },
  { id: 'powerplay',    label: 'Power Play' },
  { id: 'penaltykill',  label: 'Penalty Kill' },
  { id: 'goaltending',  label: 'Goaltending' },
]

/* ── Stat box: a big single metric with rank/percentile ── */
function StatBox({
  label,
  value,
  subLabel,
  rank,
  total,
  lowerBetter,
}: {
  label: string
  value: string
  subLabel?: string
  rank?: number
  total?: number
  lowerBetter?: boolean
}): JSX.Element {
  const rankColor_ = rank !== undefined && total !== undefined
    ? rankColor(lowerBetter ? rank : rank, total)
    : 'var(--muted)'
  return (
    <div style={{
      background: 'var(--bg2)',
      borderRadius: 6,
      padding: 'var(--sp-3) var(--sp-4)',
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      minWidth: 110,
    }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>{value}</div>
      {rank !== undefined && total !== undefined && (
        <div style={{ fontSize: 10, fontWeight: 700, color: rankColor_ }}>
          #{rank} in league{lowerBetter ? ' (lower better)' : ''}
        </div>
      )}
      {subLabel && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{subLabel}</div>}
    </div>
  )
}

/* ── Generic sortable player table for team scope ── */
type PlayerSortKey = keyof TeamPlayerAnalyticsRow

interface PlayerColDef {
  key: PlayerSortKey
  label: string
  format: (r: TeamPlayerAnalyticsRow) => string
  width?: number
}

function TeamPlayerTable({
  rows,
  cols,
  title,
  onPlayerClick,
}: {
  rows: TeamPlayerAnalyticsRow[]
  cols: PlayerColDef[]
  title: string
  onPlayerClick: (playerId: string) => void
}): JSX.Element {
  const [sortKey, setSortKey] = useState<PlayerSortKey>(cols[cols.length - 1]!.key)
  const [sortAsc, setSortAsc] = useState(false)

  function handleSort(key: PlayerSortKey): void {
    if (key === sortKey) setSortAsc((a) => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey]
    const bv = b[sortKey]
    if (typeof av === 'number' && typeof bv === 'number') {
      return sortAsc ? av - bv : bv - av
    }
    return 0
  })

  function sortIndicator(key: PlayerSortKey): string {
    if (key !== sortKey) return ''
    return sortAsc ? ' ▲' : ' ▼'
  }

  return (
    <Panel title={title}>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 26 }}>#</th>
              <th>Player</th>
              <th style={{ width: 28 }}>Pos</th>
              <th style={{ width: 36, textAlign: 'right' }}>GP</th>
              {cols.map((c) => (
                <th
                  key={c.key as string}
                  style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none', minWidth: c.width ?? 56 }}
                  onClick={() => handleSort(c.key)}
                >
                  {c.label}{sortIndicator(c.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, idx) => (
              <tr key={row.playerId}>
                <td className="num" style={{ color: 'var(--muted)', fontSize: 11 }}>{idx + 1}</td>
                <td>
                  <button type="button" className="player-link" style={{ fontSize: 12 }} onClick={() => onPlayerClick(row.playerId)}>
                    {row.name}
                  </button>
                </td>
                <td style={{ color: 'var(--muted)', fontSize: 11 }}>{row.position}</td>
                <td className="num" style={{ color: 'var(--muted)', fontSize: 11 }}>{row.gamesPlayed}</td>
                {cols.map((c) => (
                  <td key={c.key as string} className="num" style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: c.key === sortKey ? 700 : 400 }}>
                    {c.format(row)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4 + cols.length} style={{ color: 'var(--muted)', textAlign: 'center', padding: 'var(--sp-3)' }}>No data yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/* ── Goalie table ── */
function GoalieTable({
  rows,
  title,
  onPlayerClick,
}: {
  rows: GoalieAnalyticsRow[]
  title: string
  onPlayerClick: (playerId: string) => void
}): JSX.Element {
  type GSortKey = keyof GoalieAnalyticsRow
  const [sortKey, setSortKey] = useState<GSortKey>('savePct')
  const [sortAsc, setSortAsc] = useState(false)

  function handleSort(key: GSortKey): void {
    if (key === sortKey) setSortAsc((a) => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey]
    const bv = b[sortKey]
    if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av
    return 0
  })

  const cols: { key: GSortKey; label: string; format: (r: GoalieAnalyticsRow) => string }[] = [
    { key: 'wins',        label: 'W',    format: (r) => String(r.wins) },
    { key: 'losses',      label: 'L',    format: (r) => String(r.losses) },
    { key: 'savePct',     label: 'SV%',  format: (r) => r.savePct.toFixed(3) },
    { key: 'gaa',         label: 'GAA',  format: (r) => r.gaa.toFixed(2) },
    { key: 'saves',       label: 'SV',   format: (r) => String(r.saves) },
    { key: 'shotsAgainst',label: 'SA',   format: (r) => String(r.shotsAgainst) },
  ]

  return (
    <Panel title={title}>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 26 }}>#</th>
              <th>Goalie</th>
              <th style={{ width: 36, textAlign: 'right' }}>GP</th>
              {cols.map((c) => (
                <th key={c.key as string} style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none', minWidth: 50 }} onClick={() => handleSort(c.key)}>
                  {c.label}{sortKey === c.key ? (sortAsc ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, idx) => (
              <tr key={row.playerId}>
                <td className="num" style={{ color: 'var(--muted)', fontSize: 11 }}>{idx + 1}</td>
                <td>
                  <button type="button" className="player-link" style={{ fontSize: 12 }} onClick={() => onPlayerClick(row.playerId)}>
                    {row.name}
                  </button>
                </td>
                <td className="num" style={{ color: 'var(--muted)', fontSize: 11 }}>{row.gamesPlayed}</td>
                {cols.map((c) => (
                  <td key={c.key as string} className="num" style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: c.key === sortKey ? 700 : 400 }}>
                    {c.format(row)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={3 + cols.length} style={{ color: 'var(--muted)', textAlign: 'center', padding: 'var(--sp-3)' }}>No goalie data yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/* ── Category: Overview ── */
function CategoryOverview({ hub, onPlayerClick }: { hub: TeamDataHubView; onPlayerClick: (id: string) => void }): JSX.Element {
  const userTeamAbbrs = new Set([hub.team.teamAbbr])
  const xaLeaders = [...hub.players].sort((a, b) => b.xAPer60 - a.xAPer60)
  const forwards = hub.players.filter((p) => p.position !== 'G' && p.position !== 'D')
  return (
    <div className="stack">
      <TeamProfilePanel row={hub.team} />
      <Panel title="Expected Attacking Output — Forwards (xA/60 × xG/60)">
        <div style={{ marginBottom: 'var(--sp-2)', fontSize: 11, color: 'var(--muted)' }}>
          Click any dot to open the player profile. Hover for details. Quadrant lines at league median.
        </div>
        <div style={{ overflowX: 'auto' }}>
          <PlayerScatter players={forwards} userTeamAbbrs={userTeamAbbrs} onPlayerClick={onPlayerClick} />
        </div>
      </Panel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--sp-4)' }}>
        <PlayerLeaderTable rows={hub.players} label="xG/60" format={(r) => r.xgPer60.toFixed(2)} userTeamAbbrs={userTeamAbbrs} onPlayerClick={onPlayerClick} />
        <PlayerLeaderTable rows={xaLeaders} label="xA/60" format={(r) => r.xAPer60.toFixed(2)} userTeamAbbrs={userTeamAbbrs} onPlayerClick={onPlayerClick} />
        <PlayerLeaderTable rows={[...hub.players].sort((a, b) => b.finishing - a.finishing)} label="Finishing" format={(r) => `${r.finishing >= 0 ? '+' : ''}${r.finishing.toFixed(2)}`} userTeamAbbrs={userTeamAbbrs} onPlayerClick={onPlayerClick} />
      </div>
    </div>
  )
}

/* ── Category: Offense ── */
function CategoryOffense({ hub, onPlayerClick }: { hub: TeamDataHubView; onPlayerClick: (id: string) => void }): JSX.Element {
  const allTeams = hub.allTeams
  const team = hub.team
  const gfRank = [...allTeams].sort((a, b) => b.gfPer60 - a.gfPer60).findIndex((r) => r.teamId === team.teamId) + 1
  const xgfRank = [...allTeams].sort((a, b) => b.xgfPer60 - a.xgfPer60).findIndex((r) => r.teamId === team.teamId) + 1
  const sfRank = [...allTeams].sort((a, b) => b.shotsPer60 - a.shotsPer60).findIndex((r) => r.teamId === team.teamId) + 1
  const n = allTeams.length

  const skaters = hub.players.filter((p) => p.position !== 'G')
  const scorers = [...skaters].sort((a, b) => b.goalsPer60 - a.goalsPer60)
  const shooters = [...skaters].sort((a, b) => b.shootingPct - a.shootingPct)

  const offCols: PlayerColDef[] = [
    { key: 'goalsPer60',  label: 'G/60',    format: (r) => r.goalsPer60.toFixed(2) },
    { key: 'xgPer60',     label: 'xG/60',   format: (r) => r.xgPer60.toFixed(2) },
    { key: 'xAPer60',     label: 'xA/60',   format: (r) => r.xAPer60.toFixed(2) },
    { key: 'shootingPct', label: 'SH%',     format: (r) => `${(r.shootingPct * 100).toFixed(1)}%` },
    { key: 'finishing',   label: 'Fin',     format: (r) => `${r.finishing >= 0 ? '+' : ''}${r.finishing.toFixed(2)}` },
  ]

  return (
    <div className="stack">
      <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <StatBox label="GF/60" value={team.gfPer60.toFixed(2)} rank={gfRank} total={n} />
        <StatBox label="xGF/60" value={team.xgfPer60.toFixed(2)} rank={xgfRank} total={n} />
        <StatBox label="SF/60" value={team.shotsPer60.toFixed(1)} rank={sfRank} total={n} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center' }}>
          <PercentileBar value={team.gfPctile} />
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>GF/60 %ile</div>
          <PercentileBar value={team.xgfPctile} />
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>xGF/60 %ile</div>
        </div>
      </div>
      <TeamPlayerTable rows={skaters} cols={offCols} title="Skaters — Offensive Output" onPlayerClick={onPlayerClick} />
    </div>
  )
}

/* ── Category: Defence ── */
function CategoryDefence({ hub, onPlayerClick }: { hub: TeamDataHubView; onPlayerClick: (id: string) => void }): JSX.Element {
  const allTeams = hub.allTeams
  const team = hub.team
  const gaRank = [...allTeams].sort((a, b) => a.gaPer60 - b.gaPer60).findIndex((r) => r.teamId === team.teamId) + 1
  const xgaRank = [...allTeams].sort((a, b) => a.xgaPer60 - b.xgaPer60).findIndex((r) => r.teamId === team.teamId) + 1
  const saRank = [...allTeams].sort((a, b) => a.shotsAgainstPer60 - b.shotsAgainstPer60).findIndex((r) => r.teamId === team.teamId) + 1
  const n = allTeams.length

  const skaters = hub.players.filter((p) => p.position !== 'G')
  const defCols: PlayerColDef[] = [
    { key: 'blockedShots', label: 'BLK',  format: (r) => String(r.blockedShots) },
    { key: 'takeaways',    label: 'TKA',  format: (r) => String(r.takeaways) },
    { key: 'plusMinus',    label: '+/-',  format: (r) => `${r.plusMinus >= 0 ? '+' : ''}${r.plusMinus}` },
  ]

  return (
    <div className="stack">
      <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <StatBox label="GA/60" value={team.gaPer60.toFixed(2)} rank={gaRank} total={n} lowerBetter />
        <StatBox label="xGA/60" value={team.xgaPer60.toFixed(2)} rank={xgaRank} total={n} lowerBetter />
        <StatBox label="SA/60" value={team.shotsAgainstPer60.toFixed(1)} rank={saRank} total={n} lowerBetter />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center' }}>
          <PercentileBar value={team.gaPctile} />
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>GA/60 %ile</div>
          <PercentileBar value={team.xgaPctile} />
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>xGA/60 %ile</div>
        </div>
      </div>
      <TeamPlayerTable rows={skaters} cols={defCols} title="Skaters — Defensive Output" onPlayerClick={onPlayerClick} />
    </div>
  )
}

/* ── Category: Power Play ── */
function CategoryPowerPlay({ hub, onPlayerClick }: { hub: TeamDataHubView; onPlayerClick: (id: string) => void }): JSX.Element {
  const allTeams = hub.allTeams
  const team = hub.team
  const ppRank = [...allTeams].sort((a, b) => b.ppPct - a.ppPct).findIndex((r) => r.teamId === team.teamId) + 1
  const n = allTeams.length
  const st = hub.specialTeams

  const ppProducers = [...hub.players].sort((a, b) => b.ppPoints - a.ppPoints)
  const ppCols: PlayerColDef[] = [
    { key: 'ppGoals',   label: 'PPG',  format: (r) => String(r.ppGoals) },
    { key: 'ppAssists', label: 'PPA',  format: (r) => String(r.ppAssists) },
    { key: 'ppPoints',  label: 'PPP',  format: (r) => String(r.ppPoints) },
  ]

  return (
    <div className="stack">
      <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <StatBox label="PP%" value={`${(st.ppPct * 100).toFixed(1)}%`} rank={ppRank} total={n} />
        <StatBox label="PP Goals" value={String(st.ppGoals)} subLabel={`of ${st.ppOpportunities} opp.`} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center' }}>
          <PercentileBar value={team.ppPctile} />
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>PP% league %ile</div>
        </div>
      </div>
      <TeamPlayerTable rows={ppProducers} cols={ppCols} title="Power-Play Leaders" onPlayerClick={onPlayerClick} />
    </div>
  )
}

/* ── Category: Penalty Kill ── */
function CategoryPenaltyKill({ hub }: { hub: TeamDataHubView }): JSX.Element {
  const allTeams = hub.allTeams
  const team = hub.team
  const pkRank = [...allTeams].sort((a, b) => b.pkPct - a.pkPct).findIndex((r) => r.teamId === team.teamId) + 1
  const n = allTeams.length
  const st = hub.specialTeams

  return (
    <div className="stack">
      <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <StatBox label="PK%" value={`${(st.pkPct * 100).toFixed(1)}%`} rank={pkRank} total={n} />
        <StatBox label="PK Kills" value={String(st.pkKills)} subLabel={`of ${st.timesShorthanded} sit.`} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center' }}>
          <PercentileBar value={team.pkPctile} />
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>PK% league %ile</div>
        </div>
      </div>
      <div style={{ color: 'var(--muted)', fontSize: 12, padding: 'var(--sp-3)' }}>
        Shorthanded player-level scoring splits are tracked at team level only. Individual shorthanded production will be surfaced in a future update.
      </div>
    </div>
  )
}

/* ── Category: Goaltending ── */
function CategoryGoaltending({ hub, onPlayerClick }: { hub: TeamDataHubView; onPlayerClick: (id: string) => void }): JSX.Element {
  const allGoalies = hub.allGoalies
  const teamGoalies = hub.goalies
  const n = allGoalies.length

  // Find best SV% among team goalies for rank context
  const teamBestSvPct = teamGoalies.length > 0 ? Math.max(...teamGoalies.map((g) => g.savePct)) : 0
  const svRank = [...allGoalies].sort((a, b) => b.savePct - a.savePct).findIndex((g) => g.savePct <= teamBestSvPct + 0.0001 && g.savePct >= teamBestSvPct - 0.0001) + 1

  const teamGAA = teamGoalies.length > 0 ? teamGoalies.reduce((s, g) => s + g.gaa, 0) / teamGoalies.length : 0

  return (
    <div className="stack">
      <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <StatBox label="Best SV%" value={teamBestSvPct > 0 ? teamBestSvPct.toFixed(3) : '—'} rank={svRank > 0 && n > 0 ? svRank : undefined} total={n} />
        <StatBox label="Team GAA" value={teamGAA > 0 ? teamGAA.toFixed(2) : '—'} lowerBetter />
        <StatBox label="Team SV%" value={hub.team.gamesPlayed > 0
          ? (() => {
              const totalSaves = teamGoalies.reduce((s, g) => s + g.saves, 0)
              const totalSA = teamGoalies.reduce((s, g) => s + g.shotsAgainst, 0)
              return totalSA > 0 ? (totalSaves / totalSA).toFixed(3) : '—'
            })()
          : '—'}
        />
      </div>
      <GoalieTable rows={teamGoalies} title="Team Goalies" onPlayerClick={onPlayerClick} />
    </div>
  )
}

/* ── Category tabs container ── */
function TeamCategoryTabs({ hub, onPlayerClick }: { hub: TeamDataHubView; onPlayerClick: (id: string) => void }): JSX.Element {
  const [category, setCategory] = useState<Category>('overview')

  return (
    <div className="stack">
      {/* Tab strip */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--line)', paddingBottom: 0 }}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setCategory(cat.id)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: category === cat.id ? '2px solid var(--violet)' : '2px solid transparent',
              padding: '6px 14px',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: category === cat.id ? 700 : 400,
              color: category === cat.id ? 'var(--violet-h)' : 'var(--muted)',
              marginBottom: -1,
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {category === 'overview'    && <CategoryOverview    hub={hub} onPlayerClick={onPlayerClick} />}
      {category === 'offense'     && <CategoryOffense     hub={hub} onPlayerClick={onPlayerClick} />}
      {category === 'defence'     && <CategoryDefence     hub={hub} onPlayerClick={onPlayerClick} />}
      {category === 'powerplay'   && <CategoryPowerPlay   hub={hub} onPlayerClick={onPlayerClick} />}
      {category === 'penaltykill' && <CategoryPenaltyKill hub={hub} />}
      {category === 'goaltending' && <CategoryGoaltending hub={hub} onPlayerClick={onPlayerClick} />}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   9.  LEAGUE scope body (existing layout)
   ═══════════════════════════════════════════════════════════════════ */

function LeagueScopeBody({
  hub,
  onPlayerClick,
}: {
  hub: DataHubView
  onPlayerClick: (playerId: string) => void
}): JSX.Element {
  const userTeamAbbrs = new Set([hub.userTeam.teamAbbr])
  const xaLeaders = [...hub.xgLeaders].sort((a, b) => b.xAPer60 - a.xAPer60)

  return (
    <div className="stack">
      <TeamProfilePanel row={hub.userTeam} />
      <Panel title="League Team Analytics — click a column header to sort">
        <TeamLeagueTable teams={hub.allTeams} userTeamId={hub.userTeam.teamId} />
      </Panel>
      <Panel title="Expected Attacking Output — Forwards (xA/60 × xG/60)">
        <div style={{ marginBottom: 'var(--sp-2)', fontSize: 11, color: 'var(--muted)' }}>
          Violet dots = your players. Click any dot to open the player profile. Hover for details.
          Quadrant lines at league median.
        </div>
        <div style={{ overflowX: 'auto' }}>
          <PlayerScatter players={hub.xgLeaders} userTeamAbbrs={userTeamAbbrs} onPlayerClick={onPlayerClick} />
        </div>
      </Panel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--sp-4)' }}>
        <PlayerLeaderTable rows={hub.xgLeaders} label="xG/60" format={(r) => r.xgPer60.toFixed(2)} userTeamAbbrs={userTeamAbbrs} onPlayerClick={onPlayerClick} />
        <PlayerLeaderTable rows={xaLeaders} label="xA/60" format={(r) => r.xAPer60.toFixed(2)} userTeamAbbrs={userTeamAbbrs} onPlayerClick={onPlayerClick} />
        <PlayerLeaderTable rows={hub.finishingLeaders} label="Finishing" format={(r) => `${r.finishing >= 0 ? '+' : ''}${r.finishing.toFixed(2)}`} userTeamAbbrs={userTeamAbbrs} onPlayerClick={onPlayerClick} />
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   10.  Team picker (TEAM scope)
   ═══════════════════════════════════════════════════════════════════ */

function TeamPicker({
  teams,
  selectedId,
  onChange,
}: {
  teams: TeamAnalyticsRow[]
  selectedId: string
  onChange: (teamId: string) => void
}): JSX.Element {
  return (
    <select
      value={selectedId}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: 'var(--bg2)',
        border: '1px solid var(--line)',
        borderRadius: 4,
        color: 'var(--text)',
        fontSize: 12,
        padding: '4px 8px',
        cursor: 'pointer',
      }}
    >
      {[...teams].sort((a, b) => a.teamName.localeCompare(b.teamName)).map((t) => (
        <option key={t.teamId} value={t.teamId}>{t.teamAbbr} — {t.teamName}</option>
      ))}
    </select>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   11.  DataHubScreen — root
   ═══════════════════════════════════════════════════════════════════ */

type Scope = 'league' | 'team'

/**
 * TeamDataHubBody — self-contained team-scope analytics for one club.
 * Fetches its own TeamDataHubView keyed on teamId so it can be embedded
 * directly on the Team page (not just under the League → Analytics tab).
 */
export function TeamDataHubBody({ teamId }: { teamId: string }): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const [teamData, setTeamData] = useState<TeamDataHubView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seqRef = useRef(0)

  useEffect(() => {
    if (!teamId) return
    const seq = ++seqRef.current
    setLoading(true)
    setError(null)
    client.getTeamDataHub(teamId).then((res) => {
      if (seq !== seqRef.current) return
      if (res.type === 'teamDataHub') {
        setTeamData(res.teamDataHub)
      } else if (res.type === 'error') {
        setError(res.message)
      }
      setLoading(false)
    }).catch((err: unknown) => {
      if (seq !== seqRef.current) return
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    })
  }, [teamId])

  function navigateToPlayer(playerId: string): void {
    nav.navigate('player', { playerId })
  }

  return (
    <section className="stack">
      <ScreenHeader title="Analytics Hub">
        <span className="muted small">SciSports-style team analytics · All rates per 60 min</span>
      </ScreenHeader>
      <ScreenStateNotices
        loading={loading && !teamData}
        error={error}
        empty={!loading && !error && !teamData}
        emptyText="No analytics data yet — play some games first."
      />
      {teamData && (
        <div className="stack">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{teamData.team.teamName}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{teamData.team.gamesPlayed} games played</div>
            </div>
          </div>
          <TeamCategoryTabs hub={teamData} onPlayerClick={navigateToPlayer} />
        </div>
      )}
    </section>
  )
}

export function DataHubScreen(): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const [scope, setScope] = useState<Scope>('league')
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)

  // League data via the standard hook (re-fetches on game advance)
  const { data: leagueData, loading: leagueLoading, error: leagueError } = useScreenData<DataHubView>(
    () => client.getDataHub(),
    (r) => (r.type === 'dataHub' ? r.dataHub : null)
  )

  // Default selectedTeamId to user's team once league data loads
  useEffect(() => {
    if (leagueData && selectedTeamId === null) {
      setSelectedTeamId(leagueData.userTeam.teamId)
    }
  }, [leagueData, selectedTeamId])

  const effectiveTeamId = selectedTeamId ?? leagueData?.userTeam.teamId ?? ''

  // Team data: manual fetch keyed on scope + teamId so it refreshes when either changes
  const [teamData, setTeamData] = useState<TeamDataHubView | null>(null)
  const [teamLoading, setTeamLoading] = useState(false)
  const [teamError, setTeamError] = useState<string | null>(null)
  const teamSeqRef = useRef(0)

  useEffect(() => {
    if (scope !== 'team' || !effectiveTeamId) return
    const seq = ++teamSeqRef.current
    setTeamLoading(true)
    setTeamError(null)
    client.getTeamDataHub(effectiveTeamId).then((res) => {
      if (seq !== teamSeqRef.current) return
      if (res.type === 'teamDataHub') {
        setTeamData(res.teamDataHub)
        setTeamLoading(false)
      } else if (res.type === 'error') {
        setTeamError(res.message)
        setTeamLoading(false)
      }
    }).catch((err: unknown) => {
      if (seq !== teamSeqRef.current) return
      setTeamError(err instanceof Error ? err.message : String(err))
      setTeamLoading(false)
    })
  }, [scope, effectiveTeamId])

  function navigateToPlayer(playerId: string): void {
    nav.navigate('player', { playerId })
  }

  const loading = scope === 'league' ? leagueLoading : teamLoading
  const error = scope === 'league' ? leagueError : teamError

  return (
    <section className="stack">
      <ScreenHeader title="Analytics Hub">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
          {/* Scope toggle */}
          <div style={{ display: 'flex', borderRadius: 4, border: '1px solid var(--line)', overflow: 'hidden' }}>
            {(['league', 'team'] as Scope[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                style={{
                  background: scope === s ? 'var(--violet)' : 'var(--bg2)',
                  border: 'none',
                  padding: '4px 14px',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 700,
                  color: scope === s ? '#fff' : 'var(--muted)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                {s === 'league' ? 'League' : 'Team'}
              </button>
            ))}
          </div>
          {/* Team picker — only visible in team scope */}
          {scope === 'team' && leagueData && effectiveTeamId && (
            <TeamPicker
              teams={leagueData.allTeams}
              selectedId={effectiveTeamId}
              onChange={(id) => setSelectedTeamId(id)}
            />
          )}
          <span className="muted small">SciSports-style league analytics · All rates per 60 min</span>
        </div>
      </ScreenHeader>

      <ScreenStateNotices
        loading={loading && !(scope === 'league' ? leagueData : teamData)}
        error={error}
        empty={!loading && !error && !(scope === 'league' ? leagueData : teamData)}
        emptyText="No analytics data available."
      />

      {scope === 'league' && leagueData && (
        <LeagueScopeBody hub={leagueData} onPlayerClick={navigateToPlayer} />
      )}

      {scope === 'team' && teamData && (
        <div className="stack">
          {/* Team header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{teamData.team.teamName}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{teamData.team.gamesPlayed} games played</div>
            </div>
          </div>
          <TeamCategoryTabs hub={teamData} onPlayerClick={navigateToPlayer} />
        </div>
      )}
    </section>
  )
}
