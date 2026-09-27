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

/** Root of (1+x)·e^(−x) = ½ — converts a half-life into ω for critical damping. */
const CRIT_HALF_LIFE_X = 1.6783469900166612

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
  // EXACT critically-damped solution x(t) = (y0 + (v0 + ω·y0)·t)·e^(−ωt).
  // (The previous closed form dropped the ω·y0·t term, which made it
  // under-damped: it overshot moving targets — a camera/player wobble source.)
  // ω is chosen so a step gap really halves in `halfLife`: (1+x)e^(−x) = ½ → x ≈ 1.678.
  const omega = CRIT_HALF_LIFE_X / halfLife
  const exp = Math.exp(-omega * dt)
  const y0 = spring.pos - target
  const j1 = spring.vel + omega * y0
  const newPos = target + (y0 + j1 * dt) * exp
  const newVel = (spring.vel - omega * j1 * dt) * exp
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
    /** Play-focus Z (across the ice) — broadcast tilts slightly toward it. */
    puckWz?: number
  } = {}
): CameraTarget {
  switch (preset) {
    case 'broadcast': {
      // The real "high home" game camera: mounted high in the stands at
      // centre ice, well back from the glass, and it mostly PANS (the look-at
      // tracks the play at 80%) while the body only trucks a little (30%).
      // Paired with a long lens (cameraFovFor → 30°) this keeps the players
      // big and the perspective honest instead of a wide, distorted shot.
      // Geometry: near boards sit just above the bottom edge (no near-side
      // crowd in frame), far boards ~quarter-height from the top.
      const lz = 2 + (opts.puckWz ?? 0) * 0.25
      return { px: puckWx * 0.3, py: 50, pz: -100, lx: puckWx * 0.8, ly: 0, lz }
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

/** Vertical field of view (degrees) per camera preset — broadcast is a long lens. */
export function cameraFovFor(preset: CameraPreset): number {
  switch (preset) {
    case 'broadcast': return 30
    case 'overhead': return 45
    case 'endzone': return 50
    case 'follow': return 55
  }
}

/**
 * Goal-celebration framing: the same broadcast side, lower and tighter on the
 * scorer. Blended in by celebrationWeight (pose.ts) — never a hard cut.
 */
export function celebrationTarget(spotWx: number, spotWz: number): CameraTarget & { fov: number } {
  // A modest push-in from the same side as the game camera: a little lower,
  // a little tighter. Nothing here moves while the cue plays.
  return {
    px: spotWx * 0.5,
    py: 34,
    pz: -92,
    lx: spotWx,
    ly: 2,
    lz: spotWz,
    fov: 22,
  }
}

// ── play-focus smoothing helpers ─────────────────────────────────────────────

/**
 * Apply a deadzone around a reference center.
 *
 * If |value - center| is below `threshold`, returns `center` unchanged —
 * micro-movements inside the deadzone are suppressed so stationary cycles do
 * not cause camera jitter.  Once the value escapes the deadzone it is returned
 * as-is; the caller's spring then eases toward it naturally.
 *
 * `center` should be the spring's current position (camX.pos etc.), not a
 * fixed origin, so the deadzone travels with the camera.
 */
export function applyDeadzone(value: number, center: number, threshold: number): number {
  if (threshold <= 0) return value
  return Math.abs(value - center) < threshold ? center : value
}

/**
 * Soft dead-band follow: returns the point the focus should move toward so
 * that it trails `value` by at most `band`. Unlike applyDeadzone (a hard
 * step the moment the band is escaped → stop/start "stick-slip" pans), this
 * is continuous — the pan eases in from zero as the play leaves the band.
 */
export function softDeadzone(value: number, center: number, band: number): number {
  if (band <= 0) return value
  const d = value - center
  if (d > band) return value - band
  if (d < -band) return value + band
  return center
}

/**
 * Exponential moving average step — simpler alternative to a full spring when
 * only position (no velocity) matters.  Alpha is the per-second blend factor;
 * the effective time constant τ ≈ 1/alpha (in seconds).
 *
 * alpha = 1 − exp(−dt / tau)  gives framerate-independent behaviour.
 *
 * Use this for the play-focus smoother layer that sits between the raw puck
 * position and the camera spring, giving a longer time constant (~0.5 s) with
 * a single scalar state.
 */
export function emaStep(current: number, target: number, dt: number, tau: number): number {
  if (dt <= 0 || tau <= 0) return current
  const alpha = 1 - Math.exp(-dt / tau)
  return current + alpha * (target - current)
}

/**
 * Clamp the magnitude of a value to `maxSpeed` feet per second, given `dt`.
 * Prevents the camera from moving faster than a sane rate even if the spring
 * overshoots (e.g. on the very first frame after an oversized dt).
 */
export function clampSpeed(current: number, next: number, dt: number, maxFtPerSec: number): number {
  if (dt <= 0) return next
  const maxDelta = maxFtPerSec * dt
  const delta = next - current
  if (Math.abs(delta) <= maxDelta) return next
  return current + Math.sign(delta) * maxDelta
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
  // (athlete.ts CARRY_BLADE: the blade sits ~4 ft out front at a ~45° lie)
  const localX = 1.0
  const localZ = 4.1
  const sin = Math.sin(angle)
  const cos = Math.cos(angle)
  return {
    dx: localX * cos + localZ * sin,
    dz: -localX * sin + localZ * cos,
  }
}
