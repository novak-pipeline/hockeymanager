import { overallToStars } from '../../engine/ratings/composites'

/**
 * Ability shown as a 5-star rating (half-steps), converted from the 0–100 overall.
 * We never surface the raw overall number anywhere in the UI — only stars — so this
 * is the single place ability is rendered.
 *
 * Playtest 2026-08-26 §F3: *"star-rating colours (gold/green/grey) are unexplained
 * and not intuitive."* Two things were wrong. The palette had two golds one shade
 * apart, so four tiers rendered as three; and nothing anywhere said what a colour
 * meant, so the reader had to reverse-engineer a threshold from a hue. Both are
 * fixed here: one ordered ramp on the app's own house scale (green = best, amber
 * = middle, grey = fringe — the same direction as staff ratings and roster fit),
 * and a tooltip that names the tier in scouting English instead of repeating the
 * number the reader can already count.
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

export function OverallStars({ value, size = 12 }: { value: number; size?: number }): JSX.Element {
  const stars = overallToStars(value)
  const tier = starTier(stars)
  const full = Math.floor(stars)
  const half = stars - full >= 0.5
  const empty = Math.max(0, 5 - full - (half ? 1 : 0))
  return (
    <span
      style={{ color: tier.color, fontSize: size, letterSpacing: -1, lineHeight: 1, whiteSpace: 'nowrap' }}
      title={`${tier.label} — ${tier.blurb} (${stars} of 5)`}
    >
      {'★'.repeat(full)}{half ? '½' : ''}<span style={{ opacity: 0.28 }}>{'★'.repeat(empty)}</span>
    </span>
  )
}

/**
 * The key for the colours above. Put it under any table where stars are the
 * column a GM reads down — a legend the reader can see beats a tooltip they
 * have to go looking for.
 */
export function StarsLegend({ style }: { style?: React.CSSProperties }): JSX.Element {
  return (
    <div
      className="muted small"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', ...style }}
    >
      <span style={{ opacity: 0.8 }}>Ability:</span>
      {STAR_TIERS.map((t) => (
        <span key={t.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title={t.blurb}>
          <span style={{ color: t.color, fontSize: 11, letterSpacing: -1 }}>★★★</span>
          <span>{t.label}</span>
        </span>
      ))}
    </div>
  )
}
