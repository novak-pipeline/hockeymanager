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
  const newPos = target + (d + spring.vel * dt) * exp
  const newVel = (spring.vel - omega * (d + spring.vel * dt)) * exp
  return { pos: newPos, vel: newVel }
}

/**
 * Snap a spring immediately to a value with zero velocity.
 * Use on seek or camera-mode switch to avoid rubber-band flight.
 */
export function snapSpring(value: number): Spring1D {
  return { pos: value, vel: 0 }
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

/**
 * Clamp how fast an orientation can turn in one frame.
 * `maxRateRadPerSec` prevents 180° body-whips when a player direction reverses.
 * Returns the new angle after applying at most maxRate * dt rotation toward target.
 */
export function clampTurnRate(
  current: number,
  target: number,
  dt: number,
  maxRateRadPerSec: number
): number {
  const delta = wrapAngle(target - current)
  const maxDelta = maxRateRadPerSec * dt
  const clamped = Math.max(-maxDelta, Math.min(maxDelta, delta))
  return wrapAngle(current + clamped)
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
 * Endzone side selection with hysteresis.
 *
 * Returns +1 (positive-X net / right end) or -1 (negative-X net / left end).
 * Only flips when the puck crosses CENTER-ICE (±hysteresisThreshold feet from
 * center), which prevents camera thrashing in the neutral zone.
 *
 * State is managed by the caller:
 *   - pass currentSide (the last returned value)
 *   - pass puckWx (world X of puck)
 * Returns the new side (may equal currentSide if no flip occurred).
 */
export function endzoneChooseEnd(
  currentSide: 1 | -1,
  puckWx: number,
  hysteresisThreshold = 15
): 1 | -1 {
  // Only commit to a new side once the puck has clearly crossed center ice.
  if (puckWx > hysteresisThreshold) return 1
  if (puckWx < -hysteresisThreshold) return -1
  return currentSide
}

/**
 * Compute camera world-position and look-at for each preset.
 *
 * broadcast  — elevated side view with damped x-follow of the puck.
 * overhead   — true top-down, rink fills frame (y ≈ 110).
 * endzone    — behind the current attacking net; endzoneActiveSide must be
 *              updated separately via endzoneChooseEnd before calling.
 * follow     — behind-and-above the puck carrier along their velocity vector;
 *              carrierAngle is the carrier's world-space Y-rotation (radians).
 *
 * Positions in world feet (1 unit = 1 ft).
 */
export function cameraTargetFor(
  preset: CameraPreset,
  puckWx: number,
  opts: {
    endzoneActiveSide?: 1 | -1
    carrierAngle?: number
    carrierWx?: number
    carrierWz?: number
  } = {}
): CameraTarget {
  switch (preset) {
    case 'broadcast': {
      // Damped x-follow: camera and look-at both track puck x at 35% amplitude.
      const fx = puckWx * 0.35
      return { px: fx, py: 40, pz: -75, lx: fx, ly: 0, lz: 0 }
    }

    case 'overhead': {
      // True top-down — camera directly above center, looking straight down.
      // Slight x-follow so long-side rushes stay visible (10% amplitude, heavy damping applied by caller).
      const fx = puckWx * 0.10
      return { px: fx, py: 110, pz: 0, lx: fx, ly: 0, lz: 0 }
    }

    case 'endzone': {
      // Position behind the net the puck is attacking toward.
      // side +1 = camera behind positive-X net (i.e. the right end), looking toward negative-X.
      // side -1 = camera behind negative-X net, looking toward positive-X.
      const side = opts.endzoneActiveSide ?? -1
      // Place camera ~10ft behind the end boards (boards at ±100ft), centered on Z.
      const camX = side * 110
      // Z position: slight offset so we see the crease from just off center
      const camZ = 0
      const lookX = 0          // look toward center ice
      return { px: camX, py: 14, pz: camZ, lx: lookX, ly: 2, lz: 0 }
    }

    case 'follow': {
      // Behind-and-above the puck carrier along their velocity/heading vector.
      // fallback to puck position if no carrier info.
      const angle = opts.carrierAngle ?? 0
      const wx = opts.carrierWx ?? puckWx
      const wz = opts.carrierWz ?? 0
      // 28ft back along the -velocity direction, 12ft up
      const backDist = 28
      const upY = 12
      const bx = wx - Math.sin(angle) * backDist
      const bz = wz - Math.cos(angle) * backDist
      // Clamp camera inside rink bounds (boards at ±101ft X, ±43.5ft Z)
      const clampedBx = Math.max(-101, Math.min(101, bx))
      const clampedBz = Math.max(-43.5, Math.min(43.5, bz))
      return {
        px: clampedBx, py: upY, pz: clampedBz,
        lx: wx, ly: 1, lz: wz
      }
    }
  }
}

// ── skating animation helpers ────────────────────────────────────────────────

/**
 * Body bob offset (y) for a skater based on elapsed time and speed.
 * Returns exactly 0 at speed 0 — no idle bouncing.
 */
export function skaterBob(time: number, speed: number): number {
  if (speed <= 0) return 0
  // Bob frequency scales linearly with speed; magnitude ramps up with speed.
  return Math.sin(time * 8 * speed) * 0.08 * Math.min(1, speed)
}

/** Leg swing angle for a skater (oscillates around 0, scaled by speed). */
export function legSwingAngle(time: number, speed: number): number {
  if (speed <= 0) return 0
  return Math.sin(time * 8 * speed) * 0.4 * Math.min(1, speed)
}

/**
 * World-space offset for the puck when carried, relative to the carrier's
 * body center.  Places the puck at the stick blade side rather than body
 * center, 1 ft to the right (from the player's perspective) and ~3 ft ahead.
 *
 * Returns {dx, dz} in world feet; caller rotates by the carrier's Y angle.
 */
export function puckCarriedOffset(angle: number): { dx: number; dz: number } {
  // Stick is on the player's right side (positive local X) and slightly ahead.
  // Local-space offset: right = +1 ft, forward = +3 ft along facing direction.
  const localX = 1.2
  const localZ = 3.0
  const sin = Math.sin(angle)
  const cos = Math.cos(angle)
  return {
    dx: localX * cos + localZ * sin,
    dz: -localX * sin + localZ * cos,
  }
}
