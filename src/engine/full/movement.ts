/**
 * The skating model.
 *
 * Every skater has a velocity in real feet/second. Each tick he steers toward
 * a target with finite acceleration — no instant direction flips, so paths come
 * out as arcs — and his speed is hard-capped by a per-player top speed derived
 * from composites.skating (≈24–34 ft/s, the NHL range). Because position only
 * ever advances by velocity × dt and velocity never exceeds top speed, no
 * skater can move more than topSpeed × dt in one tick (the renderer-facing
 * displacement invariant; see fullSim.test.ts).
 */
import type { Player } from '@domain'
import type { Rng } from '@engine/shared/rng'
import { clamp, X_FT, Y_FT, type RSkater } from './types'

export const MIN_SPEED_FT = 24
export const MAX_SPEED_FT = 34

/** Per-player top skating speed in ft/s, from the skating composite. */
export function topSpeedFt(p: Player): number {
  return MIN_SPEED_FT + (clamp(p.composites.skating, 0, 100) / 100) * (MAX_SPEED_FT - MIN_SPEED_FT)
}

/** Acceleration in ft/s² — better skaters reach top speed sooner. */
function accelFt(p: Player): number {
  return 13 + (clamp(p.composites.skating, 0, 100) / 100) * 9
}

/** A movement objective: normalized target + how hard to skate for it (0..1). */
export interface MoveOrder {
  tx: number
  ty: number
  urgency: number
  /**
   * Pass-through waypoint: skate THROUGH the target at pace instead of
   * decelerating to settle on it. Used while a play is flowing (breakouts,
   * neutral-ice carries, entries, rushes) so carriers and lane-fillers keep
   * continuous speed — the "approach, stall, get swarmed" texture came from
   * every waypoint being treated as an arrival.
   */
  through?: boolean
}

/** Keep skaters off the boards/net line; targets are clamped into this box. */
const BX = 0.97
const BY = 0.95

/**
 * Steer one skater toward an order for one tick of `dt` seconds.
 *
 * The target is taken as-is (organic, low-frequency motion comes from the
 * sinusoidal `sway` in formations.ts). We deliberately do NOT add per-tick
 * random noise to the target: re-rolling white noise every tick made skaters
 * who were already near their spot flip direction each frame and visibly
 * vibrate. An "arrive" term decelerates the skater near his spot so he settles
 * instead of orbiting.
 */
export function steer(_rng: Rng, r: RSkater, o: MoveOrder, dt: number): void {
  const px = r.pos.x * X_FT
  const py = r.pos.y * Y_FT
  const tx = clamp(o.tx, -BX, BX) * X_FT
  const ty = clamp(o.ty, -BY, BY) * Y_FT
  const dx = tx - px
  const dy = ty - py
  const dist = Math.hypot(dx, dy)
  const top = topSpeedFt(r.player)
  const cap = top * clamp(o.urgency, 0.2, 1)
  // Arrive: ask for less speed as the target closes so the stop is smooth —
  // unless this is a pass-through waypoint, where pace is carried through it.
  const want = o.through ? cap : Math.min(cap, dist * 1.6)
  let dvx: number
  let dvy: number
  if (dist > 1e-6) {
    dvx = (dx / dist) * want - r.vel.x
    dvy = (dy / dist) * want - r.vel.y
  } else {
    dvx = -r.vel.x
    dvy = -r.vel.y
  }
  const dv = Math.hypot(dvx, dvy)
  const maxDv = accelFt(r.player) * dt
  if (dv > maxDv) {
    dvx *= maxDv / dv
    dvy *= maxDv / dv
  }
  r.vel.x += dvx
  r.vel.y += dvy
  const sp = Math.hypot(r.vel.x, r.vel.y)
  if (sp > top) {
    r.vel.x *= top / sp
    r.vel.y *= top / sp
  }
  let nx = px + r.vel.x * dt
  let ny = py + r.vel.y * dt
  // Boards: stop dead on contact (never adds displacement, only removes it).
  if (nx < -BX * X_FT) {
    nx = -BX * X_FT
    r.vel.x = 0
  } else if (nx > BX * X_FT) {
    nx = BX * X_FT
    r.vel.x = 0
  }
  if (ny < -BY * Y_FT) {
    ny = -BY * Y_FT
    r.vel.y = 0
  } else if (ny > BY * Y_FT) {
    ny = BY * Y_FT
    r.vel.y = 0
  }
  r.pos.x = nx / X_FT
  r.pos.y = ny / Y_FT
}
