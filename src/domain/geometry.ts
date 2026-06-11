/**
 * Rink coordinate system shared by the engine and every renderer.
 *
 * Origin (0,0) is center ice. The rink is normalized to the unit square so a
 * renderer can scale it to any pixel size without the engine knowing about
 * resolution:
 *   x ∈ [-1, 1]  left goal (-1) → right goal (+1)
 *   y ∈ [-1, 1]  one boards (-1) → other boards (+1)
 *
 * Real-rink proportions (NHL 200ft × 85ft) are applied by the renderer when it
 * maps the unit square to pixels; the engine reasons in normalized space only.
 */
export interface XY {
  x: number
  y: number
}

/** Zones are defined relative to the team in possession, not a fixed end. */
export type Zone = 'offensive' | 'neutral' | 'defensive'

/** Real NHL rink dimensions in feet, for renderer aspect-ratio math. */
export const RINK_LENGTH_FT = 200
export const RINK_WIDTH_FT = 85
export const RINK_ASPECT = RINK_LENGTH_FT / RINK_WIDTH_FT
