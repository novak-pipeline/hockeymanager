/**
 * Rink geometry for the agent engine, in real FEET (origin at center ice,
 * x goal-to-goal ±100, y boards-to-boards ±42.5) — the same orientation as the
 * normalized stream coordinates (x/100, y/42.5), so conversion is a scale.
 *
 * The sheet is a rounded rectangle (28-ft corner radius, NHL); nets sit on the
 * goal lines at x = ±89 (6 ft mouth, ~3.3 ft deep, extending toward the end
 * boards). Faceoff dots match the ones the renderers draw (the old engine's
 * normalized dots) so a whistle comes back to a dot the viewer can see.
 */
import type { XY } from '@domain'

export const HALF_X = 100
export const HALF_Y = 42.5
export const CORNER_R = 28
export const GOAL_X = 89
export const NET_HALF_W = 3
export const NET_DEPTH = 3.4
/** Offensive blue line, feet from center. */
export const BLUE_X = 25
/** Crease radius (semi-circle), feet. */
export const CREASE_R = 6

/** Faceoff dots (feet): center, four neutral-zone, four end-zone. */
export const DOT_EZ_X = 60
export const DOT_NZ_X = 20
export const DOT_Y = 23.4
export const CENTER: XY = { x: 0, y: 0 }
export const ALL_DOTS_FT: XY[] = [
  CENTER,
  { x: -DOT_NZ_X, y: -DOT_Y },
  { x: -DOT_NZ_X, y: DOT_Y },
  { x: DOT_NZ_X, y: -DOT_Y },
  { x: DOT_NZ_X, y: DOT_Y },
  { x: -DOT_EZ_X, y: -DOT_Y },
  { x: -DOT_EZ_X, y: DOT_Y },
  { x: DOT_EZ_X, y: -DOT_Y },
  { x: DOT_EZ_X, y: DOT_Y }
]

export const toNorm = (p: XY): XY => ({ x: p.x / HALF_X, y: p.y / HALF_Y })
export const toFt = (p: XY): XY => ({ x: p.x * HALF_X, y: p.y * HALF_Y })

export interface BoardHit {
  /** True when the point was outside the (inset) boards and was projected back. */
  hit: boolean
  x: number
  y: number
  /** Outward unit normal of the boards at the contact point. */
  nx: number
  ny: number
}

/**
 * Keep a point `margin` feet inside the boards. Returns the projected point
 * and the outward normal where it touched (hit=false → unchanged).
 */
export function boardsClamp(x: number, y: number, margin: number): BoardHit {
  const hx = HALF_X - margin
  const hy = HALF_Y - margin
  const r = Math.max(1, CORNER_R - margin)
  const cx = hx - r
  const cy = hy - r
  const sx = x < 0 ? -1 : 1
  const sy = y < 0 ? -1 : 1
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  if (ax > cx && ay > cy) {
    const dx = ax - cx
    const dy = ay - cy
    const d = Math.hypot(dx, dy)
    if (d <= r) return { hit: false, x, y, nx: 0, ny: 0 }
    const ux = dx / d
    const uy = dy / d
    return { hit: true, x: sx * (cx + ux * r), y: sy * (cy + uy * r), nx: sx * ux, ny: sy * uy }
  }
  if (ax > hx) return { hit: true, x: sx * hx, y, nx: sx, ny: 0 }
  if (ay > hy) return { hit: true, x, y: sy * hy, nx: 0, ny: sy }
  return { hit: false, x, y, nx: 0, ny: 0 }
}

/** Distance (ft) from a point to the nearest boards (0 at the boards). */
export function distToBoards(x: number, y: number): number {
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  const cx = HALF_X - CORNER_R
  const cy = HALF_Y - CORNER_R
  if (ax > cx && ay > cy) return CORNER_R - Math.hypot(ax - cx, ay - cy)
  return Math.min(HALF_X - ax, HALF_Y - ay)
}

/**
 * The net behind goal line `sign` as an obstacle box (ft): skaters and the
 * puck can't pass through it. Returns the pushed-out point, or null if clear.
 */
export function netPush(x: number, y: number, sign: number, pad: number): { x: number; y: number; nx: number; ny: number } | null {
  const x0 = GOAL_X - pad
  const x1 = GOAL_X + NET_DEPTH + pad
  const hy = NET_HALF_W + 0.4 + pad
  const ax = x * sign
  if (ax < x0 || ax > x1 || Math.abs(y) > hy) return null
  // Push out along the shallowest axis.
  const dFront = ax - x0
  const dBack = x1 - ax
  const dSide = hy - Math.abs(y)
  if (dSide <= dFront && dSide <= dBack) {
    const sy = y < 0 ? -1 : 1
    return { x, y: sy * hy, nx: 0, ny: sy }
  }
  if (dFront <= dBack) return { x: sign * x0, y, nx: -sign, ny: 0 }
  return { x: sign * x1, y, nx: sign, ny: 0 }
}
