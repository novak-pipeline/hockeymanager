import type { CSSProperties } from 'react'
import { overallToStars } from '../../engine/ratings/composites'

/**
 * Ability shown as a 5-star rating (half-steps), converted from the 0–100 overall.
 * We never surface the raw overall number anywhere in the UI — only stars — so this
 * is the single place stars are drawn.
 *
 * Playtest 2026-08-26 §F3: *"star-rating colours (gold/green/grey) are unexplained
 * and not intuitive."* Three things make stars self-explaining now:
 *
 *  1. COLOUR = TIER. One ordered ramp (green = best → grey = fringe, the house
 *     scale), named in scouting English in every tooltip and in the legend.
 *  2. SHAPE = WHAT IS BEING RATED. Ability is SOLID stars. Potential is OUTLINED
 *     stars — a ceiling, not a fact. The two can never be mistaken for each other
 *     even in greyscale, which the old "two golds one shade apart" could not do.
 *  3. UNCERTAINTY READS AS UNCERTAINTY. A scout's range (fog of war) draws solid
 *     to the low end and a STRIPED band to the high end; an unscouted player gets
 *     five dashed empty outlines and a "?" — never a low grade. Previously a
 *     fogged player showed the midpoint at 60% opacity, which looked exactly like
 *     a worse player.
 *
 * Stars are SVG, not the "★½" text glyphs they replaced: the glyph version mixed
 * a font's ★ with a "½" digit, so a 3½ read as "★★★½★" at a different baseline.
 */

/** The tier a star count falls in — the words a scout would actually use. */
export interface StarTier {
  label: string
  color: string
  /** What the tier means for a lineup, one clause. */
  blurb: string
}

/**
 * Ordered best → worst. The single source of truth for star colour and meaning.
 *
 * The five colours are literal, not tokens, and that is deliberate: the palette
 * this replaced reached for `var(--accent)` and `var(--accent2)` for two
 * adjacent tiers, and `--accent2` is an ALIAS of `--amber` — so two of the four
 * bands rendered in exactly the same pixel and the ramp silently lost a step.
 * A scale whose whole job is to be read at a glance cannot be one token
 * redefinition away from collapsing.
 */
export const STAR_TIERS: ReadonlyArray<StarTier & { min: number }> = [
  { min: 4.5, label: 'Elite',   color: '#34d399', blurb: 'a franchise player' },
  { min: 3.5, label: 'Top-six', color: '#9ad07a', blurb: 'drives a top line or top pair' },
  { min: 2.5, label: 'Regular', color: '#fbbf24', blurb: 'an everyday NHL body' },
  { min: 1.5, label: 'Depth',   color: '#e0803f', blurb: 'a fourth line or third pair' },
  { min: 0,   label: 'Fringe',  color: '#828c9e', blurb: 'AHL or a spare part' },
]

export function starTier(stars: number): StarTier {
  return STAR_TIERS.find((t) => stars >= t.min) ?? STAR_TIERS[STAR_TIERS.length - 1]!
}

/** "3½" style count, for tooltips. */
export function fmtStars(stars: number): string {
  const full = Math.floor(stars)
  const half = stars - full >= 0.5
  return half ? (full === 0 ? '½' : `${full}½`) : String(full)
}

const STAR_PATH =
  'M12 2.6l2.83 5.73 6.32.92-4.57 4.46 1.08 6.3L12 17.03l-5.66 2.98 1.08-6.3-4.57-4.46 6.32-.92z'

let uid = 0

export type StarKind = 'ability' | 'potential'

/**
 * The one star renderer. `value` is 0–5 in halves. With `hi` set, the stars from
 * `value` to `hi` are drawn as a striped range (a scout's uncertainty).
 */
export function StarRating(props: {
  value: number
  hi?: number
  kind?: StarKind
  size?: number
  unknown?: boolean
  /** Override the tier colour (e.g. a muted secondary read). */
  color?: string
  title?: string
  /** Number of star slots (5; 1 for a legend swatch). */
  count?: number
  style?: CSSProperties
}): JSX.Element {
  const { value, kind = 'ability', size = 12, unknown = false } = props
  const hi = props.hi !== undefined && props.hi > value ? props.hi : undefined
  const tier = starTier(hi !== undefined ? (value + hi) / 2 : value)
  const color = props.color ?? (unknown ? 'var(--muted)' : tier.color)
  const id = `st${++uid}`
  const what = kind === 'potential' ? 'Potential' : 'Ability'
  const title =
    props.title ??
    (unknown
      ? `${what}: not scouted yet — no read on him`
      : hi !== undefined
        ? `${what}: somewhere between ${fmtStars(value)} and ${fmtStars(hi)} of 5 (${tier.label}) — scout him more to narrow it`
        : `${what}: ${tier.label} — ${tier.blurb} (${fmtStars(value)} of 5)`)
  const gap = Math.max(1, Math.round(size / 10))
  const count = props.count ?? 5
  const w = size * count + gap * (count - 1)
  const outlineOnly = kind === 'potential'
  return (
    <span
      className="star-rating"
      title={title}
      aria-label={title}
      role="img"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, lineHeight: 1, whiteSpace: 'nowrap', verticalAlign: 'middle', ...props.style }}
    >
      <svg width={w} height={size} viewBox={`0 0 ${w} ${size}`} aria-hidden style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <pattern id={`${id}h`} width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="1.4" height="3" fill={color} />
          </pattern>
        </defs>
        {Array.from({ length: count }, (_, i) => {
          const x = i * (size + gap)
          // How much of THIS star is solid, and how much is the striped range.
          const solid = unknown ? 0 : Math.max(0, Math.min(1, value - i))
          const band = hi === undefined || unknown ? 0 : Math.max(0, Math.min(1, hi - i)) - solid
          const starClip = `${id}s${i}`
          const litClip = `${id}l${i}`
          const s = size / 24
          const star = (extra: Record<string, unknown>): JSX.Element => (
            <path d={STAR_PATH} transform={`scale(${s})`} strokeLinejoin="round" {...extra} />
          )
          return (
            <g key={i} transform={`translate(${x} 0)`}>
              <clipPath id={starClip}>{star({})}</clipPath>
              <clipPath id={litClip}><rect x={0} y={0} width={size * (solid + band)} height={size} /></clipPath>
              {/* Empty slot: a faint solid star (ability), a faint outline (potential),
                  or a dashed outline (unscouted). */}
              {unknown
                ? star({ fill: 'none', stroke: color, strokeWidth: 1.5 / s, strokeDasharray: `${2.4 / s} ${1.8 / s}`, opacity: 0.75 })
                : outlineOnly
                  ? star({ fill: 'none', stroke: 'var(--star-empty, rgba(130,140,158,0.35))', strokeWidth: 1.5 / s })
                  : star({ fill: 'var(--star-empty, rgba(130,140,158,0.22))' })}
              {solid > 0 && (
                <rect clipPath={`url(#${starClip})`} x={0} y={0} width={size * solid} height={size}
                  fill={color} opacity={outlineOnly ? 0.18 : 1} />
              )}
              {band > 0 && (
                <rect clipPath={`url(#${starClip})`} x={size * solid} y={0} width={size * band} height={size} fill={`url(#${id}h)`} />
              )}
              {outlineOnly && solid + band > 0 && (
                <g clipPath={`url(#${litClip})`}>{star({ fill: 'none', stroke: color, strokeWidth: 1.7 / s })}</g>
              )}
            </g>
          )
        })}
      </svg>
      {unknown && <span style={{ color: 'var(--muted)', fontSize: Math.max(9, size - 2), fontWeight: 700 }}>?</span>}
    </span>
  )
}

/**
 * Ability stars from a 0–100 overall. Pass `lo`/`hi` (overalls) for a scout's
 * fogged range; `unknown` when there is no read at all.
 */
export function OverallStars(props: {
  value: number
  lo?: number
  hi?: number
  size?: number
  unknown?: boolean
}): JSX.Element {
  const { value, lo, hi, size = 12, unknown } = props
  if (lo !== undefined && hi !== undefined) {
    const a = overallToStars(lo)
    const b = overallToStars(hi)
    return <StarRating value={a} {...(b > a ? { hi: b } : {})} size={size} />
  }
  return <StarRating value={overallToStars(value)} size={size} {...(unknown ? { unknown } : {})} />
}

/** Potential (ceiling) stars — outlined, so they never read as ability. */
export function PotentialStars(props: { stars: number; hi?: number; size?: number; unknown?: boolean }): JSX.Element {
  return (
    <StarRating
      value={props.stars}
      kind="potential"
      size={props.size ?? 12}
      {...(props.hi !== undefined ? { hi: props.hi } : {})}
      {...(props.unknown ? { unknown: true } : {})}
    />
  )
}

/**
 * The key for the colours AND shapes above. Put it under any table where stars
 * are the column a GM reads down — a legend the reader can see beats a tooltip
 * they have to go looking for.
 */
export function StarsLegend({ style, showPotential = true }: { style?: CSSProperties; showPotential?: boolean }): JSX.Element {
  return (
    <div
      className="muted small star-legend"
      style={{ display: 'flex', flexWrap: 'wrap', columnGap: 14, rowGap: 6, alignItems: 'center', ...style }}
    >
      <span style={{ fontWeight: 600, color: 'var(--text)' }}>Stars</span>
      {STAR_TIERS.map((t) => (
        <span key={t.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} title={t.blurb}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: t.color, display: 'inline-block' }} />
          <span>{t.label}</span>
        </span>
      ))}
      <span style={{ width: 1, height: 12, background: 'var(--line)' }} />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} title="Solid stars: what he is today">
        <StarRating value={1} count={1} size={12} color="var(--text)" title="Ability" />
        ability
      </span>
      {showPotential && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} title="Outlined stars: what he could become">
          <StarRating value={1} count={1} kind="potential" size={12} color="var(--text)" title="Potential" />
          potential
        </span>
      )}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} title="Striped: your scouts' range — the more they watch, the narrower it gets">
        <StarRating value={0} hi={1} count={1} size={12} color="var(--text)" title="Scouting range" />
        scout's range
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} title="Not scouted: no read at all yet">
        <StarRating value={0} unknown count={1} size={12} title="Not scouted" />
        unscouted
      </span>
    </div>
  )
}
