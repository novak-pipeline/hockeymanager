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

/**
 * Global team theme: recolours the whole app accent (the violet tokens) to the
 * MANAGED team's colours. Picks the more accent-able of primary/secondary (a
 * very dark primary like Pittsburgh's black falls back to the gold secondary),
 * brightens it for legibility, and overrides --violet / --violet-h / --accent.
 * Apply the returned object as inline style on the app shell root.
 */
/** RGB (0–255) → HSL (h 0–360, s/l 0–1). */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const R = r / 255, G = g / 255, B = b / 255
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min
  const l = (max + min) / 2
  let h = 0, s = 0
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    h = max === R ? (((G - B) / d) % 6) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s, l }
}

/** HSL → #hex. */
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return toHex(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255))
}

export function useGlobalTeamTheme(teamId: string): CSSProperties | undefined {
  const colors = useTeamColors(teamId)
  return useMemo(() => {
    if (!colors) return undefined
    const p = intToRgb(colors.primary)
    // Accent: a very dark primary (e.g. Pittsburgh black) reads as black on the
    // dark UI — fall back to the secondary for the accent so it's vivid.
    const chosen = luminance(p.r, p.g, p.b) < 0.22 ? colors.secondary : colors.primary
    const { r, g, b } = intToRgb(chosen)
    const a = ensureReadable(r, g, b)
    const hex = toHex(a.r, a.g, a.b)
    const hi = toHex(
      Math.round(a.r + (255 - a.r) * 0.38),
      Math.round(a.g + (255 - a.g) * 0.38),
      Math.round(a.b + (255 - a.b) * 0.38),
    )
    // Surfaces: tint the dark palette toward the team's PRIMARY hue (subtle, so it
    // stays a dark UI). A near-black primary → neutral charcoal (Pittsburgh = black).
    const ph = rgbToHsl(p.r, p.g, p.b)
    const sSurf = Math.min(ph.s, 0.30) * 0.55 // capped, low saturation for backgrounds
    return {
      '--accent-rgb': `${a.r}, ${a.g}, ${a.b}`,
      '--violet': hex,
      '--violet-h': hi,
      '--violet-dim': `rgba(${a.r},${a.g},${a.b},0.15)`,
      '--violet-glow': `0 4px 24px rgba(${a.r},${a.g},${a.b},0.12)`,
      '--accent': hex,
      '--team-primary': hex,
      '--bg0': hslToHex(ph.h, sSurf, 0.055),
      '--bg1': hslToHex(ph.h, sSurf, 0.085),
      '--bg2': hslToHex(ph.h, sSurf, 0.12),
      '--bg3': hslToHex(ph.h, sSurf, 0.16),
      '--line': hslToHex(ph.h, sSurf, 0.22),
      '--muted': hslToHex(ph.h, Math.min(ph.s, 0.18), 0.56),
    } as CSSProperties
  }, [colors])
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
