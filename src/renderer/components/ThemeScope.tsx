/**
 * ThemeScope — scoped CSS variable override for team colors.
 *
 * Wraps a subtree in a <div> that sets:
 *   --team-primary      : the team's primary color (brightened for dark-bg legibility)
 *   --team-secondary    : the team's secondary color (similarly adjusted)
 *   --team-accent       : full-opacity primary hex, for text/icon use
 *   --team-accent-dim   : primary at ~12% opacity, for background tints
 *   --team-accent-border: primary at ~35% opacity, for borders/underlines
 *
 * Pass `colors` as a { primary, secondary } object with 0xRRGGBB ints.
 * When `colors` is absent the wrapper is transparent (no extra div, no token override).
 *
 * useTeamColors(teamId) — hook that resolves a teamId to its { primary, secondary }
 * by fetching the leagueTeams view. Returns undefined while loading.
 */
import { useMemo } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { LeagueTeamsView } from '../../worker/protocol'
import { useClient, useScreenData } from '../hooks/useSim'

/** Hook: resolves a teamId to its TeamColors by reading leagueTeams. */
export function useTeamColors(teamId: string): { primary: number; secondary: number } | undefined {
  const client = useClient()
  const { data } = useScreenData<LeagueTeamsView>(
    () => client.getLeagueTeams(),
    (r) => (r.type === 'leagueTeams' ? r.teams : null)
  )
  return useMemo(() => {
    if (!data) return undefined
    const all = [...data.nhl, ...data.ahl]
    return all.find((t) => t.teamId === teamId)?.colors
  }, [data, teamId])
}

/** Convert a 0xRRGGBB integer to { r, g, b } channels (0–255). */
function intToRgb(color: number): { r: number; g: number; b: number } {
  return {
    r: (color >> 16) & 0xff,
    g: (color >> 8) & 0xff,
    b: color & 0xff,
  }
}

/** Perceived lightness (0–1) via relative luminance approximation. */
function luminance(r: number, g: number, b: number): number {
  // fast approximation (not true sRGB gamma but adequate for UI clamping)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/**
 * Ensure the color is bright enough to read as an accent on the dark (bg0=#0d0a16)
 * background. If perceived luminance < 0.18 we boost it by blending toward white
 * until it's legible.  Very bright colors (luminance > 0.85) are dimmed slightly
 * to avoid harsh glare.
 */
function ensureReadable(r: number, g: number, b: number): { r: number; g: number; b: number } {
  const lum = luminance(r, g, b)
  if (lum < 0.18) {
    // Blend toward #b0a8cc (light indigo-white) so it's visible on dark panels
    const t = Math.min(1, (0.18 - lum) / 0.18) * 0.7
    return {
      r: Math.round(r + (176 - r) * t),
      g: Math.round(g + (168 - g) * t),
      b: Math.round(b + (204 - b) * t),
    }
  }
  if (lum > 0.85) {
    // Blend toward a slightly dimmed version
    const t = (lum - 0.85) / 0.15 * 0.3
    return {
      r: Math.round(r - r * t),
      g: Math.round(g - g * t),
      b: Math.round(b - b * t),
    }
  }
  return { r, g, b }
}

function toHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/** Convert a 0xRRGGBB int to a legible #hex string on dark backgrounds. */
export function teamColorHex(color: number): string {
  const { r, g, b } = intToRgb(color)
  const adj = ensureReadable(r, g, b)
  return toHex(adj.r, adj.g, adj.b)
}

interface ThemeScopeProps {
  colors?: { primary: number; secondary: number }
  children: ReactNode
  style?: CSSProperties
  className?: string
}

/**
 * Scoped team-color provider.  When `colors` is present, sets CSS vars on a
 * wrapping div so descendants can use var(--team-primary), var(--team-secondary),
 * and var(--team-accent).  When absent, renders children directly.
 */
export function ThemeScope({ colors, children, style, className }: ThemeScopeProps): JSX.Element {
  if (!colors) {
    if (style || className) {
      return <div style={style} className={className}>{children}</div>
    }
    return <>{children}</>
  }

  const { r: pr, g: pg, b: pb } = intToRgb(colors.primary)
  const primaryAdj = ensureReadable(pr, pg, pb)
  const primaryHex = toHex(primaryAdj.r, primaryAdj.g, primaryAdj.b)

  const { r: sr, g: sg, b: sb } = intToRgb(colors.secondary)
  const secondaryAdj = ensureReadable(sr, sg, sb)
  const secondaryHex = toHex(secondaryAdj.r, secondaryAdj.g, secondaryAdj.b)

  const vars: CSSProperties = {
    '--team-primary': primaryHex,
    '--team-secondary': secondaryHex,
    // Accent = primary at reduced opacity for backgrounds
    '--team-accent': `rgba(${primaryAdj.r},${primaryAdj.g},${primaryAdj.b},0.85)`,
    '--team-accent-dim': `rgba(${primaryAdj.r},${primaryAdj.g},${primaryAdj.b},0.12)`,
    '--team-accent-border': `rgba(${primaryAdj.r},${primaryAdj.g},${primaryAdj.b},0.35)`,
    ...style,
  } as CSSProperties

  return (
    <div style={vars} className={className}>
      {children}
    </div>
  )
}
