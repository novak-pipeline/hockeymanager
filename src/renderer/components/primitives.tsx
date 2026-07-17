/**
 * Design-system primitives — the small set of composable building blocks the
 * elevated screens compose from. Style lives in index.css (.card, .ui-stat,
 * .ui-badge, .ui-meter, .ui-sparkline, .ui-icon). Motion is CSS-driven and
 * respects prefers-reduced-motion.
 */
import type { CSSProperties, ReactNode } from 'react'

/* ── Card ──────────────────────────────────────────────────────────────── */

export function Card(props: {
  children: ReactNode
  /** adds hover lift + pointer affordance */
  interactive?: boolean
  /** accent rail on the left edge */
  railed?: boolean
  /** apply standard inner padding */
  pad?: boolean
  className?: string
  style?: CSSProperties
  onClick?: () => void
  title?: string
}): JSX.Element {
  const cls = [
    'card',
    props.interactive ? 'card-interactive' : '',
    props.railed ? 'card-railed' : '',
    props.pad ? 'card-pad' : '',
    props.className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cls} style={props.style} onClick={props.onClick} title={props.title}>
      {props.children}
    </div>
  )
}

export function CardHead(props: { eyebrow?: string; children?: ReactNode }): JSX.Element {
  return (
    <div className="card-head">
      {props.eyebrow !== undefined && <span className="card-eyebrow">{props.eyebrow}</span>}
      {props.children}
    </div>
  )
}

/* ── Icon ──────────────────────────────────────────────────────────────── */

/** Sizing/alignment wrapper around any SVG (lucide component or inline svg). */
export function Icon(props: {
  children: ReactNode
  size?: 14 | 16 | 18 | 20 | 24
  color?: string
  className?: string
  style?: CSSProperties
}): JSX.Element {
  const sizeCls = props.size ? `icon-${props.size}` : ''
  return (
    <span
      className={['ui-icon', sizeCls, props.className ?? ''].filter(Boolean).join(' ')}
      style={{ color: props.color, ...props.style }}
    >
      {props.children}
    </span>
  )
}

/* ── Stat ──────────────────────────────────────────────────────────────── */

export function Stat(props: {
  value: ReactNode
  label: ReactNode
  size?: 'sm' | 'md' | 'lg'
  delta?: { dir: 'up' | 'down' | 'flat'; text: ReactNode }
  className?: string
  style?: CSSProperties
}): JSX.Element {
  const valCls = ['ui-stat-value', props.size === 'lg' ? 'lg' : props.size === 'sm' ? 'sm' : '']
    .filter(Boolean)
    .join(' ')
  return (
    <div className={['ui-stat', props.className ?? ''].filter(Boolean).join(' ')} style={props.style}>
      <div className={valCls}>{props.value}</div>
      <div className="ui-stat-label">{props.label}</div>
      {props.delta && (
        <span className={`ui-stat-delta ${props.delta.dir}`}>
          {props.delta.dir === 'up' ? '▲' : props.delta.dir === 'down' ? '▼' : '•'} {props.delta.text}
        </span>
      )}
    </div>
  )
}

/* ── Badge ─────────────────────────────────────────────────────────────── */

type BadgeTone = 'solid' | 'soft' | 'success' | 'warn' | 'danger' | 'neutral'

export function Badge(props: {
  children: ReactNode
  tone?: BadgeTone
  className?: string
  style?: CSSProperties
  title?: string
}): JSX.Element {
  return (
    <span
      className={['ui-badge', props.tone ?? 'soft', props.className ?? ''].filter(Boolean).join(' ')}
      style={props.style}
      title={props.title}
    >
      {props.children}
    </span>
  )
}

/* ── Meter ─────────────────────────────────────────────────────────────── */

export function Meter(props: {
  /** 0..1 or set max explicitly */
  value: number
  max?: number
  color?: string
  height?: number
  className?: string
  style?: CSSProperties
}): JSX.Element {
  const max = props.max ?? 1
  const pct = Math.max(0, Math.min(100, (props.value / max) * 100))
  return (
    <div
      className={['ui-meter', props.className ?? ''].filter(Boolean).join(' ')}
      style={{ ...(props.height ? { height: props.height } : {}), ...props.style }}
    >
      <div
        className="ui-meter-fill"
        style={{ width: `${pct}%`, ...(props.color ? { background: props.color } : {}) }}
      />
    </div>
  )
}

/* ── Sparkline ─────────────────────────────────────────────────────────── */

/**
 * Minimal, dependency-free sparkline. Renders a smooth-ish polyline of the
 * given series scaled to fit, with an optional area fill and last-point dot.
 */
export function Sparkline(props: {
  data: number[]
  width?: number
  height?: number
  color?: string
  fill?: boolean
  strokeWidth?: number
  className?: string
  style?: CSSProperties
}): JSX.Element | null {
  const { data } = props
  const w = props.width ?? 120
  const h = props.height ?? 28
  const color = props.color ?? 'rgb(var(--accent-rgb))'
  const sw = props.strokeWidth ?? 1.75
  if (data.length === 0) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pad = sw + 1
  const stepX = data.length > 1 ? (w - pad * 2) / (data.length - 1) : 0
  const points = data.map((v, i) => {
    const x = pad + i * stepX
    const y = pad + (1 - (v - min) / range) * (h - pad * 2)
    return [x, y] as const
  })
  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const areaPath =
    props.fill && points.length > 1
      ? `${line} L${points[points.length - 1]![0].toFixed(1)},${(h - pad).toFixed(1)} L${points[0]![0].toFixed(1)},${(
          h - pad
        ).toFixed(1)} Z`
      : null
  const last = points[points.length - 1]!

  return (
    <svg
      className={['ui-sparkline', props.className ?? ''].filter(Boolean).join(' ')}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={props.style}
      aria-hidden
    >
      {areaPath && <path d={areaPath} fill={color} opacity={0.12} stroke="none" />}
      <path d={line} fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={sw + 0.5} fill={color} />
    </svg>
  )
}
