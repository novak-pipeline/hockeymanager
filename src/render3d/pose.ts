/**
 * Procedural athlete kinematics — pure math (no THREE) so every number that
 * drives the 3D skaters is unit-testable.
 *
 * Rig convention (body space): +Z = forward, +Y = up, +X = the player's LEFT
 * (three.js right-handed: facing +Z with +Y up, the left hand is on +X).
 *
 * Angles are SEMANTIC here (flex > 0 = thigh swings forward, abduct > 0 =
 * leg swings out to that leg's side, lean > 0 = torso pitches forward,
 * bodyRoll > 0 = whole body banks toward the player's left). athlete.ts maps
 * them onto three.js Euler signs.
 */

export interface V3 {
  x: number
  y: number
  z: number
}

/** Rig proportions in feet (6'1" skater, ~0.35 ft of boot+blade). */
export const RIG = {
  thigh: 1.5,
  shin: 1.45,
  skate: 0.38,
  hipHalfWidth: 0.36,
  pelvisH: 0.55,
  torsoH: 2.05,
  shoulderHalfWidth: 0.78,
  upperArm: 1.05,
  forearm: 0.98,
  neck: 0.22,
  headR: 0.36,
  stickLen: 5.1,
} as const

export interface LegPose {
  /** Hip flexion (rad). + = thigh forward. */
  flex: number
  /** Hip abduction (rad). + = leg out to its own side. */
  abduct: number
  /** Knee bend (rad, >= 0). */
  knee: number
  /** Ankle correction so the blade stays flat on the ice (rad). */
  ankle: number
  /** Shin splay about the knee's forward axis (goalie butterfly flare). */
  splay: number
}

export interface BodyPose {
  left: LegPose
  right: LegPose
  /** Height of the hip joints above the ice (ft). */
  hipHeight: number
  /** Torso forward pitch from vertical (rad). */
  lean: number
  /** Shoulder rotation relative to hips (rad, + = toward left). */
  torsoYaw: number
  /** Torso side bend (rad). */
  torsoRoll: number
  /** Whole-body bank into a turn (rad, + = toward the player's left). */
  bodyRoll: number
  /** Lateral stick-blade sway (ft, + = left). */
  stickSway: number
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * Vertical drop from the hip joint to the ankle for a leg pose (sagittal FK,
 * foreshortened by abduction). Always > 0 for sane poses.
 */
export function legDrop(leg: LegPose, thigh: number = RIG.thigh, shin: number = RIG.shin): number {
  // splay rotates the shin about the (near-vertical) thigh axis, so it does
  // not change the vertical drop
  const sag = thigh * Math.cos(leg.flex) + shin * Math.cos(leg.flex - leg.knee)
  return sag * Math.cos(leg.abduct)
}

/** Stride cadence (Hz) for a normalized speed 0..1. Zero when standing still. */
export function strideRateHz(speed01: number): number {
  const s = clamp(speed01, 0, 1)
  if (s < 0.05) return 0
  return 0.9 + 1.1 * s
}

/**
 * Advance the stride phase. Phase is integrated (not `time * speed`) so a
 * change of speed never makes the legs jump — the old sin(time*speed) form
 * teleported the phase whenever speed changed.
 */
export function advanceStridePhase(phase: number, speed01: number, dt: number): number {
  if (dt <= 0) return phase
  const p = phase + 2 * Math.PI * strideRateHz(speed01) * dt
  return p % (2 * Math.PI)
}

function strideLeg(p: number, s: number): LegPose {
  const crouchFlex = 0.3 + 0.3 * s
  const crouchKnee = 0.5 + 0.45 * s
  const push = Math.max(0, Math.sin(p)) * s
  const recov = Math.max(0, -Math.sin(p)) * s
  const flex = crouchFlex - 0.45 * push + 0.3 * recov
  const knee = crouchKnee - 0.35 * push + 0.5 * recov
  return {
    flex,
    abduct: 0.06 + 0.42 * push + 0.04 * recov,
    knee,
    ankle: knee - flex,
    splay: 0,
  }
}

/**
 * Skating pose for a skater.
 * @param phase    stride phase (rad) from advanceStridePhase
 * @param speed01  normalized speed 0..1
 * @param turnRate heading change rate (rad/s, + = turning toward the left)
 */
export function skaterPose(phase: number, speed01: number, turnRate: number): BodyPose {
  const s = clamp(speed01, 0, 1)
  const left = strideLeg(phase, s)
  const right = strideLeg(phase + Math.PI, s)
  const hipHeight = Math.max(legDrop(left), legDrop(right)) + RIG.skate
  return {
    left,
    right,
    hipHeight,
    lean: 0.22 + 0.5 * s,
    torsoYaw: 0.14 * s * Math.sin(phase),
    torsoRoll: 0.05 * s * Math.sin(phase),
    bodyRoll: clamp(turnRate * 0.16 * (0.3 + s), -0.4, 0.4),
    stickSway: 0.35 * s * Math.sin(phase),
  }
}

/** Goalie pose: blend 0 = upright ready stance, 1 = full butterfly. */
export function goaliePose(butterfly: number): BodyPose {
  const b = clamp(butterfly, 0, 1)
  // ease so the drop is quick and the recovery settles
  const e = b * b * (3 - 2 * b)
  const leg = (): LegPose => {
    const flex = lerp(0.72, 0.3, e)
    const knee = lerp(1.0, 1.62, e)
    return {
      flex,
      abduct: lerp(0.3, -0.1, e),
      knee,
      ankle: knee - flex,
      splay: lerp(0, 1.15, e),
    }
  }
  const left = leg()
  const right = leg()
  const ready = legDrop(left) + RIG.skate
  const fly = RIG.thigh * Math.cos(left.flex) * Math.cos(left.abduct) + 0.36
  return {
    left,
    right,
    hipHeight: b === 0 ? ready : lerp(ready, fly, e),
    lean: lerp(0.38, 0.12, e),
    torsoYaw: 0,
    torsoRoll: 0,
    bodyRoll: 0,
    stickSway: 0,
  }
}

// ── facing ──────────────────────────────────────────────────────────────────

function wrap(a: number): number {
  let x = a
  while (x > Math.PI) x -= 2 * Math.PI
  while (x < -Math.PI) x += 2 * Math.PI
  return x
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * Where a skater's body should face. The engine only gives positions, so:
 *   - the puck carrier faces where he skates (his blade leads the puck);
 *   - a skater gliding slowly squares up to the puck;
 *   - a skater moving AWAY from the play at modest speed is backing up
 *     (defenders skating backwards) and keeps facing the puck.
 * Blended with smoothsteps — continuous in every input, so no swivel-flicker
 * at a threshold. Returns null when there is nothing to face (carrier idle).
 */
export function facingTarget(velAngle: number, speedFt: number, puckAngle: number, isCarrier: boolean): number | null {
  if (isCarrier) return speedFt > 1.5 ? velAngle : null
  const diff = Math.abs(wrap(velAngle - puckAngle))
  const back = smoothstep(1.9, 2.4, diff) * (1 - smoothstep(18, 24, speedFt))
  const w = smoothstep(4, 10, speedFt) * (1 - back)
  return wrap(puckAngle + wrap(velAngle - puckAngle) * w)
}

// ── two-bone IK ─────────────────────────────────────────────────────────────

const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const scale = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k })
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z
const len = (a: V3) => Math.sqrt(dot(a, a))

/**
 * Analytic two-bone IK (shoulder → elbow → hand).
 * Returns the elbow and the reachable hand position (the target itself when
 * reachable, else the closest point on the reach sphere). `pole` is a point
 * the elbow should bend toward.
 */
export function solveTwoBone(root: V3, target: V3, a: number, b: number, pole: V3): { elbow: V3; hand: V3 } {
  const d = sub(target, root)
  let dist = len(d)
  const dir = dist > 1e-6 ? scale(d, 1 / dist) : { x: 0, y: -1, z: 0 }
  const minR = Math.abs(a - b) + 1e-4
  const maxR = a + b - 1e-4
  dist = clamp(dist, minR, maxR)
  const hand = add(root, scale(dir, dist))
  const cosA = clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1)
  const along = a * cosA
  const h = a * Math.sqrt(Math.max(0, 1 - cosA * cosA))
  // pole direction perpendicular to the root→hand axis
  const pv = sub(pole, root)
  let perp = sub(pv, scale(dir, dot(pv, dir)))
  let pl = len(perp)
  if (pl < 1e-6) {
    // pole collinear with the arm — pick any stable perpendicular
    perp = Math.abs(dir.y) < 0.9 ? { x: -dir.z, y: 0, z: dir.x } : { x: 1, y: 0, z: 0 }
    pl = len(perp)
  }
  perp = scale(perp, 1 / pl)
  const elbow = add(add(root, scale(dir, along)), scale(perp, h))
  return { elbow, hand }
}

// ── broadcast presentation ──────────────────────────────────────────────────

const smooth01 = (t: number) => {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

/**
 * Weight of the goal-celebration camera over the life of a goal cue:
 * eases in, holds, eases out — never a hard cut (the jiggle complaint).
 */
export function celebrationWeight(elapsed: number, total = 4.2, rampIn = 0.9, rampOut = 1.1): number {
  if (elapsed <= 0 || elapsed >= total) return 0
  if (elapsed < rampIn) return smooth01(elapsed / rampIn)
  if (elapsed > total - rampOut) return smooth01((total - elapsed) / rampOut)
  return 1
}

/** Crowd excitement envelope after a goal: instant surge, slow decay (0..1). */
export function crowdExcitement(sinceGoal: number): number {
  if (sinceGoal < 0) return 0
  if (sinceGoal < 0.25) return sinceGoal / 0.25
  return Math.exp(-(sinceGoal - 0.25) / 3.5)
}
