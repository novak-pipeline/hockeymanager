/**
 * Stick grips: how a skater holds his stick, chosen from what the SIM says he
 * is doing (never invented), and blended so a grip never pops.
 *
 * Real hockey grips (the owner's note after reel S1: "every player looks kind
 * of weird and unnatural holding the stick with one hand out in front"):
 *   carry    — two hands: puck on the blade, stickhandling, protecting it, and
 *              into / out of a shot or pass. Top hand on the knob at the hip,
 *              bottom hand a third of the way down, blade on the ice in front
 *              on the forehand side.
 *   relaxed  — two hands, no puck, moving at an ordinary pace: the same grip
 *              with the blade a little closer in.
 *   oneHand  — top hand only, skating hard without the puck or racing a loose
 *              one: the stick held across the body at the hip, blade low on
 *              the forehand side — never thrust out in front like a lance.
 *              The free arm swings with the stride.
 *   ready    — two hands, blade on the ice wide in the passing lane: a man
 *              marking an attacker, in a lane, the one man back, or a D
 *              skating backward against the rush.
 *   receive  — two hands, the blade square to the incoming pass.
 *   faceoff  — two hands low (the faceoff clips drive the body).
 * Shots and passes are the authored clips (animLayer); the grip under them is
 * `carry`, so a swing starts and ends in two hands.
 *
 * Pure (no THREE): unit-tested in gripState.test.ts.
 */

export const GRIP_STATES = ['carry', 'relaxed', 'oneHand', 'ready', 'receive', 'faceoff'] as const
export type GripState = (typeof GRIP_STATES)[number]
export type GripWeights = Record<GripState, number>

/** What the renderer knows about one skater this frame (all from the stream / its playback). */
export interface GripContext {
  /** The puck is on his blade (or he is mid wind-up). */
  carrying: boolean
  /** A shot / pass / deke / poke / stickhandle clip is playing on him. */
  stickClip: boolean
  /** A faceoff clip (crouch, wing set, draw, tie-up) is playing on him. */
  faceoff: boolean
  /** A completed pass to him is in flight. */
  receiving: boolean
  /** Ground speed, game ft/s. */
  speedFt: number
  /** 0..1 how much he is skating backward (facing away from his travel). */
  backward: number
  /** The other team has the puck. */
  defending: boolean
  /** The agent engine's job for him ("puck", "chase", "mark:<id>", "lane", "twoOnOne", …), if any. */
  job?: string | undefined
}

/** Speeds (ft/s) for the one-handed skate: in above `on`, back to two hands below `off`. */
export const ONE_HAND_SPEED = { on: 19, off: 15, chaseOn: 13 } as const

const DEFENSIVE_JOBS = new Set(['mark', 'lane', 'twoOnOne'])
const jobKind = (job?: string): string => (job ? job.split(':')[0]! : '')

/** The grip he should be in now. `prev` gives the one-hand speed its hysteresis. */
export function chooseGrip(c: GripContext, prev: GripState | null = null): GripState {
  if (c.faceoff) return 'faceoff'
  if (c.carrying || c.stickClip) return 'carry'
  if (c.receiving) return 'receive'
  const job = jobKind(c.job)
  // a D backing up against the rush, or a man covering (his mark, a lane, the odd-man rush)
  if (c.backward > 0.5 && c.speedFt > 2 && (c.defending || job === '')) return 'ready'
  if (DEFENSIVE_JOBS.has(job) && c.defending && c.speedFt < ONE_HAND_SPEED.on) return 'ready'
  // skating hard without the puck, or racing a loose puck
  const on = job === 'chase' ? ONE_HAND_SPEED.chaseOn : ONE_HAND_SPEED.on
  const fast = prev === 'oneHand' ? c.speedFt > ONE_HAND_SPEED.off : c.speedFt > on
  if (fast && c.backward < 0.3) return 'oneHand'
  return 'relaxed'
}

export const oneHot = (s: GripState): GripWeights => {
  const w = {} as GripWeights
  for (const k of GRIP_STATES) w[k] = k === s ? 1 : 0
  return w
}

/** Grip transitions: an exponential blend with this time constant (≈95% in 0.3 s). */
export const GRIP_TAU_S = 0.1

/** Ease the current weights toward the target grip over `dt` game seconds (dt 0 = snap). Sum stays 1. */
export function blendGrip(cur: GripWeights | null, target: GripState, dt: number, tau = GRIP_TAU_S): GripWeights {
  if (!cur || dt <= 0) return oneHot(target)
  const k = 1 - Math.exp(-dt / tau)
  let tot = 0
  for (const s of GRIP_STATES) {
    const v = cur[s] + ((s === target ? 1 : 0) - cur[s]) * k
    cur[s] = v < 1e-4 ? 0 : v
    tot += cur[s]
  }
  for (const s of GRIP_STATES) cur[s] /= tot || 1
  return cur
}

/** The dominant grip of a blend. */
export function dominantGrip(w: GripWeights): GripState {
  let best: GripState = 'relaxed'
  for (const s of GRIP_STATES) if (w[s] > w[best]) best = s
  return best
}

/**
 * What athlete.ts needs to place the stick and hands for a blend of grips:
 * the weights, the incoming pass direction (root frame, his own: +x = his
 * left, +z = his front; unit vector from his blade toward the passer) and the
 * stride swing (−1..1) the free arm follows.
 */
export interface GripInput {
  w: GripWeights
  incoming?: { x: number; z: number } | null
  armSwing?: number
  /**
   * Extra forward bend at the waist (rad) for the two-handed grips: a man with
   * the puck, reading a pass or playing the lane gets down over his stick, which
   * is what lets the bottom hand reach a third of the way down the shaft.
   */
  bend?: number
  /**
   * W3 S4: the carrier's puck where the SIM has it, on the ice in his root
   * frame (authored left-handed, like `incoming`). The carry grip puts the
   * blade on it: the sim's puck wins, the drawn blade bends to it.
   */
  puck?: { x: number; z: number } | null
}

/** The waist bend each grip asks for (rad), before an action clip takes the torso. */
export const GRIP_BEND: Record<GripState, number> = { carry: 0.5, receive: 0.45, ready: 0.5, relaxed: 0.3, oneHand: 0, faceoff: 0 }

export function gripBend(w: GripWeights): number {
  let b = 0
  for (const s of GRIP_STATES) b += w[s] * GRIP_BEND[s]
  return b
}

export interface Vec3 { x: number; y: number; z: number }

/** Per-grip stick geometry, authored left-handed (blade on his left, +X). */
export interface GripGeom {
  /** Blade centre on the ice (root frame, ft) before the full-length slide. */
  blade: Vec3
  /** Direction along the blade, heel → toe. */
  bladeDir: Vec3
}

const n2 = (x: number, z: number): Vec3 => {
  const l = Math.hypot(x, z) || 1
  return { x: x / l, y: 0, z: z / l }
}

/** Blade spots per grip (the carry matches math.puckCarriedOffset / CARRY_BLADE). */
export const GRIP_GEOM: Record<GripState, GripGeom> = {
  carry: { blade: { x: 1.0, y: 0.02, z: 4.1 }, bladeDir: n2(1, 0.28) },
  relaxed: { blade: { x: 0.9, y: 0.02, z: 3.6 }, bladeDir: n2(1, 0.28) },
  // across the body: the shaft runs from the top hand at his hip out to the forehand side, blade low
  oneHand: { blade: { x: 3.0, y: 0.18, z: 2.0 }, bladeDir: n2(1, 0.4) },
  // wide in the passing lane, blade flat and open
  ready: { blade: { x: 1.9, y: 0.02, z: 3.6 }, bladeDir: n2(1, 0.15) },
  receive: { blade: { x: 1.2, y: 0.02, z: 3.4 }, bladeDir: n2(1, 0.28) },
  faceoff: { blade: { x: 0.5, y: 0.02, z: 3.0 }, bladeDir: n2(1, 0.1) },
}

/**
 * The blade direction for a pass coming in from `incoming` (unit, root frame):
 * the blade runs perpendicular to the puck's path (square to it), toe out to
 * his forehand side.
 */
export function squareBladeDir(incoming: { x: number; z: number }): Vec3 {
  let x = incoming.z
  let z = -incoming.x
  if (x < 0) {
    x = -x
    z = -z
  }
  return n2(x, z)
}
