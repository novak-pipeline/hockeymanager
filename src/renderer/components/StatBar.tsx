/**
 * Labelled horizontal progress bar for a single 0–99 attribute axis.
 *
 * Colour tiers match the existing AttrBar logic in the app:
 *   ≥ 85 → green (success)
 *   ≥ 70 → violet (accent)
 *   ≥ 55 → amber (accent2)
 *    < 55 → dim (muted / grey)
 *
 * Used in the Profile tab's Ratings card and anywhere a single numeric stat
 * needs a visual emphasis without a full attribute group.
 */

export interface StatBarProps {
  label: string
  value: number
  /** Max scale; defaults to 99. */
  max?: number
  /** Compact style: smaller font, thinner bar. */
  compact?: boolean
}

export function StatBar({ label, value, max = 99, compact = false }: StatBarProps): JSX.Element {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const color =
    value >= 85 ? 'var(--success)' :
    value >= 70 ? 'var(--accent)' :
    value >= 55 ? 'var(--accent2)' :
    'var(--muted)'

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: compact ? '90px 1fr 28px' : '100px 1fr 30px',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span
        style={{
          fontSize: compact ? 10 : 11,
          color: 'var(--muted)',
          textAlign: 'right',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <div
        className="meter"
        style={{ height: compact ? 5 : 6 }}
      >
        <div
          className="meter-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span
        style={{
          fontSize: compact ? 10 : 11,
          fontWeight: 700,
          color,
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  )
}
