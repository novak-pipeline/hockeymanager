/**
 * Rink geometry in REAL FEET for the analyzer.
 *
 * The stream is in the normalized unit square (x ∈ [-1,1] goal-to-goal,
 * y ∈ [-1,1] boards-to-boards; see src/domain/geometry.ts). The analyzer works
 * in feet on a 200 × 85 sheet (origin centre ice) and — wherever a metric is
 * "from a team's point of view" — in that team's ATTACK FRAME: +X always points
 * at the net the team shoots on.
 */
import type { XY } from '@domain'

export const HALF_LENGTH_FT = 100
export const HALF_WIDTH_FT = 42.5
/** Goal line |x| in feet. */
export const GOAL_LINE_FT = 89
/** Blue line |x| in feet (inner edge used as the zone boundary). */
export const BLUE_LINE_FT = 25
export const CORNER_RADIUS_FT = 28
export const FT_PER_S_PER_MPH = 5280 / 3600

export function toFt(p: XY): XY {
  return { x: p.x * HALF_LENGTH_FT, y: p.y * HALF_WIDTH_FT }
}

/** Real-feet distance between two normalized points. */
export function distFt(a: XY, b: XY): number {
  return Math.hypot((a.x - b.x) * HALF_LENGTH_FT, (a.y - b.y) * HALF_WIDTH_FT)
}

/** Along-ice advancement in feet for a team attacking toward `sign` (+1/-1). */
export function advFt(p: XY, sign: number): number {
  return p.x * HALF_LENGTH_FT * sign
}

export type RinkThird = 'oz' | 'nz' | 'dz'

export function thirdOf(p: XY, sign: number): RinkThird {
  const a = advFt(p, sign)
  return a > BLUE_LINE_FT ? 'oz' : a < -BLUE_LINE_FT ? 'dz' : 'nz'
}

/** Shortest distance (ft) from a normalized point to the boards (rounded corners). */
export function boardDistFt(p: XY): number {
  const ax = Math.abs(p.x * HALF_LENGTH_FT)
  const ay = Math.abs(p.y * HALF_WIDTH_FT)
  const cx = HALF_LENGTH_FT - CORNER_RADIUS_FT
  const cy = HALF_WIDTH_FT - CORNER_RADIUS_FT
  if (ax > cx && ay > cy) return Math.max(0, CORNER_RADIUS_FT - Math.hypot(ax - cx, ay - cy))
  return Math.max(0, Math.min(HALF_LENGTH_FT - ax, HALF_WIDTH_FT - ay))
}

/**
 * Distance (ft) and angle (deg, 0 = straight on) of a shot to the net the
 * shooter attacks — the same geometry src/calibrate/importNhl.ts used to bin
 * the NHL xG surface, so the two heat maps are directly comparable.
 */
export function shotGeometry(p: XY, sign: number): { dist: number; angle: number } {
  const x = advFt(p, sign)
  const y = p.y * HALF_WIDTH_FT
  const dx = GOAL_LINE_FT - x
  const dist = Math.hypot(dx, y)
  const angle = (Math.atan2(Math.abs(y), Math.max(dx, 0.0001)) * 180) / Math.PI
  return { dist, angle }
}

export function binIndex(edges: readonly number[], value: number): number {
  for (let i = 0; i < edges.length - 1; i++) if (value < edges[i + 1]) return i
  return edges.length - 2
}
