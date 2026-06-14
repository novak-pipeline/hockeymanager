import type { CSSProperties } from 'react'

/**
 * Selectable UI theme presets. 'team' is handled live in the shell (recolours
 * to the managed club). The rest are fixed palettes: a neutral dark surface ramp
 * + a single accent colour. 'indigo' is the original look (undefined = defaults).
 */

export const THEME_OPTIONS: Array<{ id: string; label: string; swatch: string }> = [
  { id: 'team', label: 'Team Colours', swatch: 'var(--team-primary, #8b5cf6)' },
  { id: 'indigo', label: 'Classic Indigo', swatch: '#8b5cf6' },
  { id: 'slate', label: 'Slate Blue', swatch: '#38bdf8' },
  { id: 'crimson', label: 'Crimson', swatch: '#f43f5e' },
  { id: 'emerald', label: 'Emerald', swatch: '#34d399' },
  { id: 'gold', label: 'Gold', swatch: '#fbbf24' },
]

/** Neutral dark surface ramp shared by the fixed-accent presets (matches :root). */
const NEUTRAL = {
  '--bg0': '#0b0d11',
  '--bg1': '#14171e',
  '--bg2': '#1d212b',
  '--bg3': '#262c38',
  '--line': '#2c3340',
  '--muted': '#828c9e',
}

function preset(rgb: string, hex: string, hi: string, ink = '#fff'): CSSProperties {
  return {
    ...NEUTRAL,
    '--accent-rgb': rgb,
    '--violet': hex,
    '--violet-h': hi,
    '--accent': hex,
    '--accent-ink': ink,
    '--violet-dim': `rgba(${rgb}, 0.15)`,
    '--violet-glow': `0 4px 24px rgba(${rgb}, 0.10)`,
    '--team-primary': hex,
  } as CSSProperties
}

/** Fixed presets (team & indigo handled specially in the shell → not here). */
export const THEME_PRESETS: Record<string, CSSProperties | undefined> = {
  indigo: undefined,
  slate: preset('56, 189, 248', '#38bdf8', '#7dd3fc'),
  crimson: preset('244, 63, 94', '#fb5e76', '#fda4af'),
  emerald: preset('52, 211, 153', '#34d399', '#6ee7b7'),
  gold: preset('251, 191, 36', '#fbbf24', '#fde68a', '#10131a'),
}
