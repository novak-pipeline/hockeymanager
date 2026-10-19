/**
 * W3 S6 — THE PUCK PATH PREDICTOR (docs/gameplan-2026-09-28/W3-DESIGN.md item 5).
 *
 * A short look-ahead of a free puck: a copy of it stepped forward with the
 * same physics the sim uses (physics.ts stepPuck: ice friction, flight, the
 * boards and glass, the posts and the cage, each surface by its row in
 * constraints.ts PUCK_SURFACE), with no randomness. Bodies are not in it (they
 * move; the races decide who gets there).
 *
 * Consumers: the loose-puck race (every man's earliest intercept on the real
 * path, round the corner and off the end boards, not a straight slide clamped
 * at the boards), the rim read, and the goalie's anticipation of a pass across
 * the slot.
 */
import type { XY } from '@domain'
import { stepPuck, type Puck } from './physics'

export interface PuckPathSample {
  /** Seconds from now. */
  t: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  /** Out of play (over the glass) at this sample: the path ends. */
  out?: boolean
}

export interface PuckPath {
  dt: number
  samples: PuckPathSample[]
}

/** The look-ahead the races use (s) and its step (the sim's substep). */
export const PUCK_PATH = { horizon: 2.4, dt: 0.05 } as const

/**
 * Step a copy of `p` forward `horizon` seconds. samples[0] is now; one sample
 * per `dt`. Stops early when the puck is dead still or leaves the rink.
 */
export function predictPuck(p: Readonly<Pick<Puck, 'x' | 'y' | 'z' | 'vx' | 'vy' | 'vz'>>, horizon: number = PUCK_PATH.horizon, dt: number = PUCK_PATH.dt): PuckPath {
  const q: Puck = { x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, carrier: null }
  const samples: PuckPathSample[] = [{ t: 0, x: q.x, y: q.y, z: q.z, vx: q.vx, vy: q.vy }]
  const n = Math.ceil(horizon / dt - 1e-9)
  for (let i = 1; i <= n; i++) {
    const res = stepPuck(q, dt)
    samples.push({ t: i * dt, x: q.x, y: q.y, z: q.z, vx: q.vx, vy: q.vy, ...(res === 'outOfPlay' ? { out: true } : {}) })
    if (res === 'outOfPlay') break
    if (q.z <= 0 && q.vz <= 0 && Math.hypot(q.vx, q.vy) < 0.05) break
  }
  return { dt, samples }
}

/** Where the predicted puck is `t` seconds from now (interpolated; held at the last sample). */
export function pathAt(path: PuckPath, t: number): XY {
  const s = path.samples
  if (t <= 0) return { x: s[0]!.x, y: s[0]!.y }
  const f = t / path.dt
  const i = Math.floor(f)
  if (i >= s.length - 1) {
    const l = s[s.length - 1]!
    return { x: l.x, y: l.y }
  }
  const a = s[i]!
  const b = s[i + 1]!
  const k = f - i
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
}

/** Height of the predicted puck `t` seconds from now. */
export function pathZ(path: PuckPath, t: number): number {
  const s = path.samples
  const i = Math.min(s.length - 1, Math.max(0, Math.round(t / path.dt)))
  return s[i]!.z
}
