/**
 * SVG hexagon radar chart for a six-axis RadarView.
 *
 * Labelled axes + value numbers on each vertex, optional second overlay series
 * for player comparison. All colours via CSS variables. Pure presentational —
 * no state, no side effects.
 */
import type { RadarView } from '../../engine/career/views'
import { RADAR_AXES } from '../../engine/career/views'

/* ── axis display labels ── */

const AXIS_LABELS: Record<string, string> = {
  hockeyIQ: 'Hockey IQ',
  skating: 'Skating',
  shot: 'Shot',
  offensiveZone: 'Off. Zone',
  defensiveZone: 'Def. Zone',
  physicality: 'Physical',
}

/* ── geometry helpers ── */

/** Angle for axis index i in a regular hexagon, starting from top. */
function axisAngle(i: number, total: number): number {
  return (Math.PI * 2 * i) / total - Math.PI / 2
}

/** (cx, cy, radius, value 0-99) → [x, y] */
function point(cx: number, cy: number, r: number, value: number, i: number, total: number): [number, number] {
  const t = axisAngle(i, total)
  const scale = value / 99
  return [cx + r * scale * Math.cos(t), cy + r * scale * Math.sin(t)]
}

/** Pure vertex on the outer ring at full radius. */
function vertex(cx: number, cy: number, r: number, i: number, total: number): [number, number] {
  const t = axisAngle(i, total)
  return [cx + r * Math.cos(t), cy + r * Math.sin(t)]
}

function polyPoints(pts: [number, number][]): string {
  return pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
}

/* ── component ── */

export interface RadarChartProps {
  /** Primary player radar. */
  radar: RadarView
  /** Optional compare overlay (different colour). */
  compareRadar?: RadarView
  /** Name of the compare player, shown in legend. */
  compareName?: string
  /** Name of the primary player, shown in legend if compare present. */
  primaryName?: string
  size?: number
}

export function RadarChart({
  radar,
  compareRadar,
  compareName,
  primaryName,
  size = 260,
}: RadarChartProps): JSX.Element {
  const n = RADAR_AXES.length // 6
  const cx = size / 2
  const cy = size / 2
  const r = size * 0.36 // ring radius
  const rings = [25, 50, 75, 99]

  // Build series points
  const primaryPts = RADAR_AXES.map((k, i) => point(cx, cy, r, radar[k], i, n))
  const comparePts = compareRadar
    ? RADAR_AXES.map((k, i) => point(cx, cy, r, compareRadar[k], i, n))
    : null

  // Axis line endpoints (full r)
  const axisEnds = RADAR_AXES.map((_, i) => vertex(cx, cy, r, i, n))

  return (
    <div>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        aria-label="Player radar chart"
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* ── background rings ── */}
        {rings.map((val) => {
          const ringPts = Array.from({ length: n }, (_, i) => vertex(cx, cy, r * (val / 99), i, n))
          return (
            <polygon
              key={val}
              points={polyPoints(ringPts)}
              fill="none"
              stroke="var(--line)"
              strokeWidth={1}
              opacity={0.6}
            />
          )
        })}

        {/* ── axis spokes ── */}
        {axisEnds.map(([x, y], i) => (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="var(--line)"
            strokeWidth={1}
            opacity={0.5}
          />
        ))}

        {/* ── compare overlay (drawn first, under primary) ── */}
        {comparePts && (
          <>
            <polygon
              points={polyPoints(comparePts)}
              fill="var(--cyan)"
              fillOpacity={0.12}
              stroke="var(--cyan)"
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
            {comparePts.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={3} fill="var(--cyan)" />
            ))}
          </>
        )}

        {/* ── primary fill ── */}
        <polygon
          points={polyPoints(primaryPts)}
          fill="var(--accent)"
          fillOpacity={0.18}
          stroke="var(--accent)"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {primaryPts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={3.5} fill="var(--accent)" />
        ))}

        {/* ── axis labels + values ── */}
        {RADAR_AXES.map((key, i) => {
          const angle = axisAngle(i, n)
          const labelR = r + 22
          const lx = cx + labelR * Math.cos(angle)
          const ly = cy + labelR * Math.sin(angle)
          const textAnchor =
            Math.abs(angle) < 0.2 || Math.abs(angle - Math.PI) < 0.2
              ? 'middle'
              : lx < cx - 4
              ? 'end'
              : 'start'
          const primaryVal = radar[key]
          const compareVal = compareRadar ? compareRadar[key] : null

          return (
            <g key={key}>
              {/* label */}
              <text
                x={lx}
                y={ly - 5}
                textAnchor={textAnchor}
                fontSize={9}
                fontWeight={600}
                fill="var(--muted)"
                fontFamily="inherit"
                letterSpacing="0.5"
                style={{ textTransform: 'uppercase' }}
              >
                {AXIS_LABELS[key] ?? key}
              </text>
              {/* value(s) */}
              {compareVal !== null ? (
                <text
                  x={lx}
                  y={ly + 8}
                  textAnchor={textAnchor}
                  fontSize={9}
                  fontWeight={700}
                  fill="var(--text)"
                  fontFamily="inherit"
                >
                  <tspan fill="var(--accent)">{primaryVal}</tspan>
                  <tspan fill="var(--muted)"> / </tspan>
                  <tspan fill="var(--cyan)">{compareVal}</tspan>
                </text>
              ) : (
                <text
                  x={lx}
                  y={ly + 8}
                  textAnchor={textAnchor}
                  fontSize={10}
                  fontWeight={700}
                  fill="var(--text)"
                  fontFamily="inherit"
                >
                  {primaryVal}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* ── legend (only shown in compare mode) ── */}
      {compareRadar && (
        <div
          style={{
            display: 'flex',
            gap: 16,
            justifyContent: 'center',
            marginTop: 6,
            fontSize: 11,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
            <span style={{ color: 'var(--muted)' }}>{primaryName ?? 'Player A'}</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--cyan)', display: 'inline-block' }} />
            <span style={{ color: 'var(--muted)' }}>{compareName ?? 'Player B'}</span>
          </span>
        </div>
      )}
    </div>
  )
}
