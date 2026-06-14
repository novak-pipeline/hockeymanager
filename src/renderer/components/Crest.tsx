/**
 * Crest — a team's placeholder logo (coloured tile with its abbreviation),
 * painted in the team's real { primary, secondary } colours.
 *
 * - <CrestView> is pure: pass `colors` directly. Use it on list screens where
 *   rows already carry colours, so there's no per-crest fetch.
 * - <Crest> resolves a team's colours via useTeamColors (one fetch). Use it for
 *   single crests (topbar, headers) where colours aren't already in hand.
 */
import type { CSSProperties } from 'react'
import { crestColor } from './format'
import { crestStyle, useTeamColors } from './ThemeScope'

interface CrestViewProps {
  teamId: string
  abbr: string
  colors?: { primary: number; secondary: number }
  className?: string
  style?: CSSProperties
}

/** Pure crest — no data fetch. Pass `colors` to paint in team colours. */
export function CrestView({ teamId, abbr, colors, className, style }: CrestViewProps): JSX.Element {
  const paint = colors
    ? crestStyle(colors.primary, colors.secondary)
    : { background: crestColor(teamId), color: '#fff', borderColor: 'transparent' }
  return (
    <div
      className={className}
      style={{
        background: paint.background,
        color: paint.color,
        border: `1.5px solid ${paint.borderColor}`,
        ...style,
      }}
    >
      {abbr}
    </div>
  )
}

/** Self-resolving crest — fetches the team's colours (use for single crests). */
export function Crest({ teamId, abbr, className, style }: Omit<CrestViewProps, 'colors'>): JSX.Element {
  const colors = useTeamColors(teamId)
  return <CrestView teamId={teamId} abbr={abbr} {...(colors ? { colors } : {})} className={className} style={style} />
}
