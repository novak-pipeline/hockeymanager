/**
 * DataHubScreen — SciSports / StatsCentre-style analytics hub.
 *
 * Four sections:
 *  1. Team Profile  — percentile polygon (PercentileRadar) for the user's team.
 *  2. League Tables — sortable team analytics table with percentile colour bars.
 *  3. Player Scatter — SVG Expected Attacking Output chart (xA/60 × xG/60).
 *  4. Player Leaders — leaderboards for xG/60, xA/60, and finishing.
 *
 * Renders safely with zero/empty data (pre-season, no games played).
 * Shot-location heat maps are deferred (require per-shot coordinate aggregation
 * that was not included in Phase 1 data collection).
 */

import { useState } from 'react'
import type { DataHubView, TeamAnalyticsRow, PlayerAnalyticsRow } from '../../worker/protocol'
import { Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'
import { useNav } from '../components/NavContext'

/* ═══════════════════════════════════════════════════════════════════
   1.  PercentileRadar — generic SVG polygon over labelled 0–100 axes
   ═══════════════════════════════════════════════════════════════════ */

interface RadarAxis {
  key: string
  label: string
  /** Raw value shown in the tooltip label (already formatted). */
  rawLabel: string
  /** 0–100 percentile — the actual spoke length. */
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

  /** Angle for axis i, starting from top (12 o'clock), clockwise. */
  function axisAngle(i: number): number {
    return (Math.PI * 2 * i) / n - Math.PI / 2
  }

  /** Point on a spoke at a given 0–100 fraction of r. */
  function spokePoint(i: number, pctile: number): [number, number] {
    const t = axisAngle(i)
    const scale = Math.max(0, Math.min(100, pctile)) / 100
    return [cx + r * scale * Math.cos(t), cy + r * scale * Math.sin(t)]
  }

  /** Full-radius vertex for background rings. */
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

  /** Percentile → colour (green high, amber mid, red low). */
  function pctileColor(p: number): string {
    if (p >= 66) return 'var(--green)'
    if (p >= 33) return 'var(--amber)'
    return 'var(--red)'
  }

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
        {/* Background rings */}
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

        {/* Ring percentage labels on the right axis (axis 0 direction) */}
        {rings.map((frac, ri) => {
          const [lx, ly] = vertex(0, frac)
          return (
            <text
              key={ri}
              x={lx + 3}
              y={ly + 3}
              fontSize={8}
              fill="var(--muted)"
              fontFamily="inherit"
              opacity={0.7}
            >
              {ringLabels[ri]}
            </text>
          )
        })}

        {/* Axis spokes */}
        {axes.map((_, i) => {
          const [vx, vy] = vertex(i, 1)
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={vx}
              y2={vy}
              stroke="var(--line)"
              strokeWidth={1}
              opacity={0.6}
            />
          )
        })}

        {/* Filled polygon */}
        <polygon
          points={polyStr(fillPts)}
          fill="var(--violet)"
          fillOpacity={0.18}
          stroke="var(--violet)"
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* Vertex dots */}
        {fillPts.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={4}
            fill={pctileColor(axes[i]!.percentile)}
            stroke="var(--bg1)"
            strokeWidth={1}
          />
        ))}

        {/* Axis labels + raw value + percentile */}
        {axes.map((ax, i) => {
          const angle = axisAngle(i)
          const labelR = r + 28
          const lx = cx + labelR * Math.cos(angle)
          const ly = cy + labelR * Math.sin(angle)

          const textAnchor =
            Math.abs(angle + Math.PI / 2) < 0.25 || Math.abs(angle - Math.PI / 2) < 0.25
              ? 'middle'
              : lx < cx - 4
              ? 'end'
              : 'start'

          return (
            <g key={ax.key}>
              {/* Axis label */}
              <text
                x={lx}
                y={ly - 6}
                textAnchor={textAnchor}
                fontSize={9}
                fontWeight={700}
                fill="var(--muted)"
                fontFamily="inherit"
                style={{ textTransform: 'uppercase' }}
                letterSpacing="0.5"
              >
                {ax.label}
              </text>
              {/* Raw value */}
              <text
                x={lx}
                y={ly + 6}
                textAnchor={textAnchor}
                fontSize={9}
                fontWeight={600}
                fill="var(--text)"
                fontFamily="inherit"
              >
                {ax.rawLabel}
              </text>
              {/* Percentile chip */}
              <text
                x={lx}
                y={ly + 17}
                textAnchor={textAnchor}
                fontSize={8}
                fontWeight={700}
                fill={pctileColor(ax.percentile)}
                fontFamily="inherit"
              >
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
   2.  buildRadarAxes — maps TeamAnalyticsRow → PercentileRadar axes
   ═══════════════════════════════════════════════════════════════════ */

function buildTeamRadarAxes(row: TeamAnalyticsRow): RadarAxis[] {
  return [
    {
      key: 'gf',
      label: 'GF/60',
      rawLabel: row.gfPer60.toFixed(2),
      percentile: row.gfPctile,
    },
    {
      key: 'xgf',
      label: 'xGF/60',
      rawLabel: row.xgfPer60.toFixed(2),
      percentile: row.xgfPctile,
    },
    {
      key: 'shots',
      label: 'Shots/60',
      rawLabel: row.shotsPer60.toFixed(1),
      percentile: row.shotsPctile,
    },
    {
      key: 'pp',
      label: 'PP%',
      rawLabel: `${(row.ppPct * 100).toFixed(1)}%`,
      percentile: row.ppPctile,
    },
    {
      key: 'pk',
      label: 'PK%',
      rawLabel: `${(row.pkPct * 100).toFixed(1)}%`,
      percentile: row.pkPctile,
    },
    {
      key: 'suppress',
      label: 'Suppress',
      rawLabel: row.shotsAgainstPer60.toFixed(1),
      percentile: row.shotsAgainstPctile,
    },
    {
      key: 'xga',
      label: 'xGA/60↓',
      rawLabel: row.xgaPer60.toFixed(2),
      percentile: row.xgaPctile,
    },
    {
      key: 'ga',
      label: 'GA/60↓',
      rawLabel: row.gaPer60.toFixed(2),
      percentile: row.gaPctile,
    },
  ]
}

/* ═══════════════════════════════════════════════════════════════════
   3.  PercentileBar — thin inline bar coloured green/amber/red
   ═══════════════════════════════════════════════════════════════════ */

function PercentileBar({ value }: { value: number }): JSX.Element {
  const pct = Math.max(0, Math.min(100, value))
  const color =
    pct >= 66 ? 'var(--green)' :
    pct >= 33 ? 'var(--amber)' :
    'var(--red)'
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        width: '100%',
      }}
    >
      <div
        className="meter"
        style={{ flex: 1, height: 5 }}
      >
        <div
          className="meter-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color,
          minWidth: 26,
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {Math.round(pct)}
      </span>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   4.  TeamLeagueTable — sortable analytics table
   ═══════════════════════════════════════════════════════════════════ */

type TeamSortKey = 'gfPer60' | 'gaPer60' | 'xgfPer60' | 'xgaPer60' | 'shotsPer60' | 'shotsAgainstPer60' | 'ppPct' | 'pkPct'

interface ColDef {
  key: TeamSortKey
  label: string
  format: (row: TeamAnalyticsRow) => string
  pctileKey: keyof TeamAnalyticsRow
  /** True when lower is better (invert display arrow). */
  lowerBetter?: boolean
}

const TEAM_COLS: ColDef[] = [
  { key: 'gfPer60',           label: 'GF/60',     format: (r) => r.gfPer60.toFixed(2),                    pctileKey: 'gfPctile' },
  { key: 'gaPer60',           label: 'GA/60',     format: (r) => r.gaPer60.toFixed(2),                    pctileKey: 'gaPctile',           lowerBetter: true },
  { key: 'xgfPer60',          label: 'xGF/60',    format: (r) => r.xgfPer60.toFixed(2),                   pctileKey: 'xgfPctile' },
  { key: 'xgaPer60',          label: 'xGA/60',    format: (r) => r.xgaPer60.toFixed(2),                   pctileKey: 'xgaPctile',          lowerBetter: true },
  { key: 'shotsPer60',        label: 'SF/60',     format: (r) => r.shotsPer60.toFixed(1),                 pctileKey: 'shotsPctile' },
  { key: 'shotsAgainstPer60', label: 'SA/60',     format: (r) => r.shotsAgainstPer60.toFixed(1),          pctileKey: 'shotsAgainstPctile', lowerBetter: true },
  { key: 'ppPct',             label: 'PP%',       format: (r) => `${(r.ppPct * 100).toFixed(1)}%`,        pctileKey: 'ppPctile' },
  { key: 'pkPct',             label: 'PK%',       format: (r) => `${(r.pkPct * 100).toFixed(1)}%`,        pctileKey: 'pkPctile' },
]

function TeamLeagueTable({
  teams,
  userTeamId,
}: {
  teams: TeamAnalyticsRow[]
  userTeamId: string
}): JSX.Element {
  const [sortKey, setSortKey] = useState<TeamSortKey>('xgfPer60')
  const [sortAsc, setSortAsc] = useState(false)

  function handleSort(key: TeamSortKey): void {
    if (key === sortKey) {
      setSortAsc((a) => !a)
    } else {
      setSortKey(key)
      setSortAsc(false)
    }
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
                  <span style={{ fontWeight: isUser ? 700 : 500 }}>
                    {row.teamAbbr}
                  </span>
                  <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 6 }}>
                    {row.teamName}
                  </span>
                </td>
                <td className="num" style={{ color: 'var(--muted)', fontSize: 12 }}>{row.gamesPlayed}</td>
                {TEAM_COLS.map((c) => {
                  const thisPctile = row[c.pctileKey] as number
                  const isActive = c.key === sortKey
                  return (
                    <td key={c.key} className="num">
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                        <span
                          style={{
                            fontVariantNumeric: 'tabular-nums',
                            fontSize: 12,
                            fontWeight: isActive ? 700 : 400,
                          }}
                        >
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
    return (
      <div style={{ color: 'var(--muted)', fontSize: 12, padding: 'var(--sp-3)' }}>
        No player data yet — play some games first.
      </div>
    )
  }

  const W = 480
  const H = 340
  const PAD = { top: 24, right: 24, bottom: 40, left: 48 }
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  // Axis extents with a bit of padding
  const allXA = players.map((p) => p.xAPer60)
  const allXG = players.map((p) => p.xgPer60)
  const xMin = 0
  const xMax = Math.max(1, ...allXA) * 1.1
  const yMin = 0
  const yMax = Math.max(1, ...allXG) * 1.1

  function toSvgX(v: number): number {
    return PAD.left + ((v - xMin) / (xMax - xMin)) * plotW
  }
  function toSvgY(v: number): number {
    return PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH
  }

  const midX = (xMin + xMax) / 2
  const midY = (yMin + yMax) / 2
  const qLineX = toSvgX(midX)
  const qLineY = toSvgY(midY)

  // Quadrant label positions
  const quadrants = [
    { label: 'High xG + High Creation', x: toSvgX(xMax * 0.75), y: toSvgY(yMax * 0.87), anchor: 'middle' },
    { label: 'High xG + Low Creation',  x: toSvgX(xMin + (midX - xMin) * 0.5), y: toSvgY(yMax * 0.87), anchor: 'middle' },
    { label: 'Low xG + High Creation',  x: toSvgX(xMax * 0.75), y: toSvgY(yMin + (midY - yMin) * 0.5), anchor: 'middle' },
    { label: 'Low xG + Low Creation',   x: toSvgX(xMin + (midX - xMin) * 0.5), y: toSvgY(yMin + (midY - yMin) * 0.5), anchor: 'middle' },
  ]

  // Axis tick helpers
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
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        style={{ display: 'block', overflow: 'visible' }}
        aria-label="Player expected attacking output scatter"
      >
        {/* Plot background */}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={plotH}
          fill="var(--bg2)"
          rx={4}
        />

        {/* Quadrant guide lines */}
        <line x1={qLineX} y1={PAD.top} x2={qLineX} y2={PAD.top + plotH} stroke="var(--line)" strokeWidth={1} strokeDasharray="4 3" />
        <line x1={PAD.left} y1={qLineY} x2={PAD.left + plotW} y2={qLineY} stroke="var(--line)" strokeWidth={1} strokeDasharray="4 3" />

        {/* Quadrant labels */}
        {quadrants.map((q, i) => (
          <text
            key={i}
            x={q.x}
            y={q.y}
            textAnchor={q.anchor as 'middle'}
            fontSize={8}
            fill="var(--muted)"
            fontFamily="inherit"
            opacity={0.6}
          >
            {q.label}
          </text>
        ))}

        {/* X axis ticks + labels */}
        {xTicks().map((v) => {
          const sx = toSvgX(v)
          return (
            <g key={v}>
              <line x1={sx} y1={PAD.top + plotH} x2={sx} y2={PAD.top + plotH + 4} stroke="var(--line)" strokeWidth={1} />
              <text x={sx} y={PAD.top + plotH + 14} textAnchor="middle" fontSize={8} fill="var(--muted)" fontFamily="inherit">
                {v.toFixed(1)}
              </text>
            </g>
          )
        })}

        {/* Y axis ticks + labels */}
        {yTicks().map((v) => {
          const sy = toSvgY(v)
          return (
            <g key={v}>
              <line x1={PAD.left - 4} y1={sy} x2={PAD.left} y2={sy} stroke="var(--line)" strokeWidth={1} />
              <text x={PAD.left - 6} y={sy + 3} textAnchor="end" fontSize={8} fill="var(--muted)" fontFamily="inherit">
                {v.toFixed(1)}
              </text>
            </g>
          )
        })}

        {/* Axis titles */}
        <text
          x={PAD.left + plotW / 2}
          y={H - 4}
          textAnchor="middle"
          fontSize={9}
          fontWeight={600}
          fill="var(--muted)"
          fontFamily="inherit"
        >
          xA/60 (Shot Creation)
        </text>
        <text
          x={12}
          y={PAD.top + plotH / 2}
          textAnchor="middle"
          fontSize={9}
          fontWeight={600}
          fill="var(--muted)"
          fontFamily="inherit"
          transform={`rotate(-90, 12, ${PAD.top + plotH / 2})`}
        >
          xG/60 (Shot Quality)
        </text>

        {/* Player dots */}
        {players.map((p) => {
          const isUser = userTeamAbbrs.has(p.teamAbbr)
          const sx = toSvgX(p.xAPer60)
          const sy = toSvgY(p.xgPer60)
          return (
            <g key={p.playerId}>
              <circle
                cx={sx}
                cy={sy}
                r={isUser ? 5.5 : 4}
                fill={isUser ? 'var(--violet)' : 'var(--bg3)'}
                stroke={isUser ? 'var(--violet-h)' : 'var(--line)'}
                strokeWidth={isUser ? 1.5 : 1}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) => {
                  const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                  setTooltip({ x: sx, y: sy, row: p })
                }}
                onMouseLeave={() => setTooltip(null)}
                onClick={() => onPlayerClick(p.playerId)}
              />
              {/* Label user's players */}
              {isUser && (
                <text
                  x={sx + 7}
                  y={sy + 4}
                  fontSize={8}
                  fontWeight={700}
                  fill="var(--violet-h)"
                  fontFamily="inherit"
                  style={{ pointerEvents: 'none' }}
                >
                  {p.name.split(' ').pop()}
                </text>
              )}
            </g>
          )
        })}

        {/* Tooltip */}
        {tooltip && (
          <g>
            <rect
              x={Math.min(tooltip.x + 8, W - 130)}
              y={Math.max(tooltip.y - 36, PAD.top)}
              width={122}
              height={44}
              fill="var(--bg1)"
              stroke="var(--line)"
              rx={4}
            />
            <text
              x={Math.min(tooltip.x + 14, W - 124)}
              y={Math.max(tooltip.y - 20, PAD.top + 14)}
              fontSize={9}
              fontWeight={700}
              fill="var(--text)"
              fontFamily="inherit"
            >
              {tooltip.row.name} ({tooltip.row.teamAbbr})
            </text>
            <text
              x={Math.min(tooltip.x + 14, W - 124)}
              y={Math.max(tooltip.y - 8, PAD.top + 26)}
              fontSize={8}
              fill="var(--muted)"
              fontFamily="inherit"
            >
              {`xG/60: ${tooltip.row.xgPer60.toFixed(2)}  xA/60: ${tooltip.row.xAPer60.toFixed(2)}`}
            </text>
            <text
              x={Math.min(tooltip.x + 14, W - 124)}
              y={Math.max(tooltip.y + 4, PAD.top + 36)}
              fontSize={8}
              fill="var(--muted)"
              fontFamily="inherit"
            >
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
                    <button
                      type="button"
                      className="player-link"
                      style={{ fontWeight: isUser ? 700 : 400, fontSize: 12 }}
                      onClick={() => onPlayerClick(row.playerId)}
                    >
                      {row.name}
                    </button>
                  </td>
                  <td style={{ color: 'var(--muted)', fontSize: 11 }}>{row.teamAbbr}</td>
                  <td className="num" style={{ color: 'var(--muted)', fontSize: 11 }}>{row.gamesPlayed}</td>
                  <td className="num" style={{ fontWeight: 700, fontSize: 12, color: isUser ? 'var(--violet-h)' : 'var(--text)' }}>
                    {format(row)}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--muted)', textAlign: 'center', padding: 'var(--sp-3)' }}>
                  No data yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   7.  xA/60 leader table (derived from xgLeaders, sorted by xAPer60)
   ═══════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════
   8.  TeamProfilePanel
   ═══════════════════════════════════════════════════════════════════ */

function TeamProfilePanel({ row }: { row: TeamAnalyticsRow }): JSX.Element {
  const axes = buildTeamRadarAxes(row)
  return (
    <Panel title="Team Profile — League Percentiles">
      <div style={{ display: 'flex', gap: 'var(--sp-5)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Radar */}
        <PercentileRadar axes={axes} size={300} />

        {/* Axis stat list */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <div
            style={{
              fontSize: 11,
              color: 'var(--muted)',
              marginBottom: 'var(--sp-3)',
              lineHeight: 1.5,
            }}
          >
            Each spoke = league percentile (100 = best).
            <br />
            GA/60 and xGA/60 are <em>inverted</em> — higher spoke = better defence.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {axes.map((ax) => (
              <div
                key={ax.key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '90px 1fr 36px',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {ax.label}
                </span>
                <PercentileBar value={ax.percentile} />
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--muted)',
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {ax.rawLabel}
                </span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 'var(--sp-4)', fontSize: 11, color: 'var(--muted)' }}>
            GP: {row.gamesPlayed}
          </div>
        </div>
      </div>
    </Panel>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   9.  DataHubScreen — root
   ═══════════════════════════════════════════════════════════════════ */

export function DataHubScreen(): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const { data, loading, error } = useScreenData<DataHubView>(
    () => client.getDataHub(),
    (r) => (r.type === 'dataHub' ? r.dataHub : null)
  )

  function navigateToPlayer(playerId: string): void {
    nav.navigate('player', { playerId })
  }

  return (
    <section className="stack">
      <ScreenHeader title="Analytics Hub">
        <span className="muted small">SciSports-style league analytics · All rates per 60 min</span>
      </ScreenHeader>

      <ScreenStateNotices
        loading={loading && !data}
        error={error}
        empty={!loading && !error && !data}
        emptyText="No analytics data available."
      />

      {data && <DataHubBody hub={data} onPlayerClick={navigateToPlayer} />}
    </section>
  )
}

/* ─── Body (split out to keep DataHubScreen clean) ─── */

function DataHubBody({
  hub,
  onPlayerClick,
}: {
  hub: DataHubView
  onPlayerClick: (playerId: string) => void
}): JSX.Element {
  // Build set of user-team abbreviations for highlighting.
  // The view marks userTeam explicitly; all players on that team share its abbr.
  const userTeamAbbrs = new Set([hub.userTeam.teamAbbr])

  // xA/60 leaderboard: sort xgLeaders by xAPer60 desc
  const xaLeaders = [...hub.xgLeaders].sort((a, b) => b.xAPer60 - a.xAPer60)

  return (
    <div className="stack">
      {/* ── Section 1: Team Profile radar ── */}
      <TeamProfilePanel row={hub.userTeam} />

      {/* ── Section 2: League Team Tables ── */}
      <Panel title="League Team Analytics — click a column header to sort">
        <TeamLeagueTable teams={hub.allTeams} userTeamId={hub.userTeam.teamId} />
      </Panel>

      {/* ── Section 3: Player Scatter ── */}
      <Panel title="Expected Attacking Output — Forwards (xA/60 × xG/60)">
        <div style={{ marginBottom: 'var(--sp-2)', fontSize: 11, color: 'var(--muted)' }}>
          Violet dots = your players. Click any dot to open the player profile. Hover for details.
          Quadrant lines at league median. Deferred: shot-location heat maps (requires per-shot coordinate data).
        </div>
        <div style={{ overflowX: 'auto' }}>
          <PlayerScatter
            players={hub.xgLeaders}
            userTeamAbbrs={userTeamAbbrs}
            onPlayerClick={onPlayerClick}
          />
        </div>
      </Panel>

      {/* ── Section 4: Player Leader Tables ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 'var(--sp-4)',
        }}
      >
        <PlayerLeaderTable
          rows={hub.xgLeaders}
          label="xG/60"
          format={(r) => r.xgPer60.toFixed(2)}
          userTeamAbbrs={userTeamAbbrs}
          onPlayerClick={onPlayerClick}
        />
        <PlayerLeaderTable
          rows={xaLeaders}
          label="xA/60"
          format={(r) => r.xAPer60.toFixed(2)}
          userTeamAbbrs={userTeamAbbrs}
          onPlayerClick={onPlayerClick}
        />
        <PlayerLeaderTable
          rows={hub.finishingLeaders}
          label="Finishing"
          format={(r) => `${r.finishing >= 0 ? '+' : ''}${r.finishing.toFixed(2)}`}
          userTeamAbbrs={userTeamAbbrs}
          onPlayerClick={onPlayerClick}
        />
      </div>
    </div>
  )
}
