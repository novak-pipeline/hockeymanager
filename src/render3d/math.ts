/**
 * Pure math helpers for the 3D rink renderer — no THREE dependency so they can
 * be unit-tested in a Node environment.
 *
 * Coordinate conventions
 * ──────────────────────
 * Domain: normalized rink space  x ∈ [-1,1] (left→right goal), y ∈ [-1,1]
 * World:  three.js scene (y-up)   wx = x*100, wz = y*42.5  (1 unit = 1 ft)
 */

/** Convert normalized rink x → world X (feet along the length). */
export function normXtoWorld(nx: number): number {
  return nx * 100
}

/** Convert normalized rink y → world Z (feet across the width). */
export function normYtoWorld(ny: number): number {
  return ny * 42.5
}

/** Convert a normalized {x,y} pair to a {wx, wz} world pair. */
export function normToWorld(nx: number, ny: number): { wx: number; wz: number } {
  return { wx: normXtoWorld(nx), wz: normYtoWorld(ny) }
}

// ── critically-damped spring follow ─────────────────────────────────────────

export interface Spring1D {
  pos: number
  vel: number
}

/**
 * Step a critically-damped spring toward `target` in `dt` seconds.
 * `halfLife` is the approximate time for the gap to halve (seconds).
 * Returns the updated spring state — caller reassigns or mutates.
 */
export function springStep(
  spring: Spring1D,
  target: number,
  dt: number,
  halfLife: number
): Spring1D {
  if (dt <= 0) return spring
  // omega for critical damping from half-life
  const omega = Math.LN2 / halfLife
  const exp = Math.exp(-omega * dt)
  const d = spring.pos - target
  const vel = (spring.vel + omega * d) * exp - omega * d * exp
  const pos = target + (d + (spring.vel + omega * d) * dt) * exp
  // Re-derive a numerically stable form:
  // pos(t) = target + (d + vel0*dt) * e^(-omega*dt)   [critically damped approx]
  const newPos = target + (d + spring.vel * dt) * exp
  const newVel = (spring.vel - omega * (d + spring.vel * dt)) * exp
  void pos
  void vel
  return { pos: newPos, vel: newVel }
}

// ── angle helpers ────────────────────────────────────────────────────────────

/** Wrap an angle to [-π, π]. */
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
}

/**
 * Damped angle follow — spring-steps an angle spring toward `target` while
 * always taking the shortest angular path.
 */
export function angleSpringStep(
  spring: Spring1D,
  target: number,
  dt: number,
  halfLife: number
): Spring1D {
  const delta = wrapAngle(target - spring.pos)
  const adjusted = spring.pos + delta
  const next = springStep({ pos: adjusted, vel: spring.vel }, spring.pos + delta, dt, halfLife)
  return { pos: wrapAngle(next.pos), vel: next.vel }
}

// ── jersey-number hash ───────────────────────────────────────────────────────

/**
 * Deterministic jersey number 1–99 from a PlayerId string.
 * Stable across frames so the number never flickers during a game.
 */
export function jerseyNumber(playerId: string): number {
  let h = 5381
  for (let i = 0; i < playerId.length; i++) {
    h = (h * 33) ^ playerId.charCodeAt(i)
    h = h >>> 0
  }
  return (h % 99) + 1
}

// ── event-cue extraction ─────────────────────────────────────────────────────

import type { GameStream } from '@domain'
import { isEvent } from '@domain'
import { absTime } from '@render2d/timeline'

export type CueKind = 'shot' | 'save' | 'goal' | 'hit'

export interface EventCue {
  kind: CueKind
  absT: number
  /** Normalized rink x-coordinate of the event (for net side detection). */
  nx: number
  /** Normalized rink y-coordinate. */
  ny: number
  /** PlayerId of the primary actor (scorer, goalie, hitter). */
  actorId: string
}

/** Extract cue timestamps from a GameStream using the same absTime convention as timeline.ts. */
export function extractCues(stream: GameStream): EventCue[] {
  const cues: EventCue[] = []
  for (const ev of stream) {
    if (isEvent(ev, 'shot')) {
      cues.push({
        kind: 'shot',
        absT: absTime(ev.period, ev.t),
        nx: ev.from.x,
        ny: ev.from.y,
        actorId: ev.shooter
      })
    } else if (isEvent(ev, 'save')) {
      cues.push({
        kind: 'save',
        absT: absTime(ev.period, ev.t),
        nx: ev.pos.x,
        ny: ev.pos.y,
        actorId: ev.goalie
      })
    } else if (isEvent(ev, 'goal')) {
      cues.push({
        kind: 'goal',
        absT: absTime(ev.period, ev.t),
        nx: ev.pos.x,
        ny: ev.pos.y,
        actorId: ev.scorer
      })
    } else if (isEvent(ev, 'hit')) {
      cues.push({
        kind: 'hit',
        absT: absTime(ev.period, ev.t),
        nx: ev.pos.x,
        ny: ev.pos.y,
        actorId: ev.by
      })
    }
  }
  return cues
}

// ── camera target helpers ────────────────────────────────────────────────────

export type CameraPreset = 'broadcast' | 'overhead' | 'endzone' | 'follow'

export interface CameraTarget {
  px: number
  py: number
  pz: number
  lx: number
  ly: number
  lz: number
}

/**
 * Compute a static camera world-position and look-at from a preset and an
 * optional "puck world x" for the broadcast x-follow.
 */
export function cameraTargetFor(preset: CameraPreset, puckWx: number): CameraTarget {
  switch (preset) {
    case 'broadcast':
      return { px: puckWx * 0.35, py: 40, pz: -75, lx: puckWx * 0.35, ly: 0, lz: 0 }
    case 'overhead':
      return { px: 0, py: 120, pz: 0, lx: 0, ly: 0, lz: 0 }
    case 'endzone':
      return { px: 0, py: 20, pz: -95, lx: 0, ly: 2, lz: 0 }
    case 'follow':
      return { px: puckWx, py: 30, pz: -60, lx: puckWx, ly: 0, lz: 0 }
  }
}

// ── skating animation helpers ────────────────────────────────────────────────

/** Body bob offset (y) for a skater based on elapsed time and speed. */
export function skaterBob(time: number, speed: number): number {
  return Math.sin(time * 8 * Math.max(0.2, speed)) * 0.08 * Math.min(1, speed)
}

/** Leg swing angle for a skater (oscillates around 0, scaled by speed). */
export function legSwingAngle(time: number, speed: number): number {
  return Math.sin(time * 8 * Math.max(0.2, speed)) * 0.4 * Math.min(1, speed)
}
