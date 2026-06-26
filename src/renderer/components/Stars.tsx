import { overallToStars } from '../../engine/ratings/composites'

/**
 * Ability shown as a 5-star rating (half-steps), converted from the 0–100 overall.
 * We never surface the raw overall number anywhere in the UI — only stars — so this
 * is the single place ability is rendered. The tooltip is the star value (x/5), not
 * the underlying number.
 */
export function OverallStars({ value, size = 12 }: { value: number; size?: number }): JSX.Element {
  const stars = overallToStars(value)
  const color =
    stars >= 4.5 ? 'var(--success)' :
    stars >= 3.5 ? 'var(--accent, #f5b301)' :
    stars >= 2.5 ? 'var(--accent2, #e0b341)' :
    'var(--muted)'
  const full = Math.floor(stars)
  const half = stars - full >= 0.5
  const empty = Math.max(0, 5 - full - (half ? 1 : 0))
  return (
    <span style={{ color, fontSize: size, letterSpacing: -1, lineHeight: 1, whiteSpace: 'nowrap' }} title={`${stars}/5`}>
      {'★'.repeat(full)}{half ? '½' : ''}<span style={{ opacity: 0.28 }}>{'★'.repeat(empty)}</span>
    </span>
  )
}
