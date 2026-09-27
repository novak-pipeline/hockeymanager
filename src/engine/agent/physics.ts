/**
 * M1 — PHYSICS & MOVEMENT for the agent engine (feet, seconds).
 *
 * Skating is a momentum model, not a steer-to-waypoint twitch:
 *   - Longitudinal thrust falls off as speed rises (a real skater's power
 *     curve), braking is a hockey stop (strong, but only along the line of
 *     travel — you can't carve and stop at once), and a gliding skater slows
 *     only by ice friction.
 *   - Lateral (turning) acceleration is grip-limited, so the TURN RADIUS GROWS
 *     WITH SPEED (r = v²/grip): 10 ft at 15 ft/s, ~35 ft at 30 ft/s.
 *   - Commands are tracked through a time constant (tau) that depends on
 *     urgency: a player drifting into position corrects gently (small,
 *     calm accelerations), a player racing for a puck uses everything he has.
 *     That is what removes the old near-max-acceleration twitch.
 *   - Facing is separate from velocity and turns at a finite yaw rate: a
 *     defenceman skates BACKWARD facing the play (at reduced top speed and
 *     thrust) and has to pivot to turn and race.
 *   - Stamina: hard skating drains a shift energy that caps speed and thrust —
 *     the tired end of a long shift is visibly slower.
 * Bodies occupy space: overlapping skaters are separated and exchange momentum
 * (an inelastic collision), the boards stop them, the nets are obstacles.
 * Collisions are reported so the physical game (M3) can read real contacts.
 *
 * The puck is a physical object too: carried on the blade (a stick-length in
 * front, working side to side), or loose/passed/shot with real speeds, ice
 * friction, board and net bounces (restitution), and flight height for chips
 * and clears that can leave the rink.
 */
import type { Player } from '@domain'
import { boardsClamp, netPush } from './rink'

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
const r100 = (v: number | undefined): number => clamp(v ?? 50, 0, 100)

/** Physical capabilities derived from ratings. */
export interface Caps {
  /** Forward top speed, ft/s (24–34: NHL range, same mapping as the old engine). */
  top: number
  /** Backward top speed, ft/s. */
  topBack: number
  /** Thrust from a standstill, ft/s². */
  accel: number
  /** Hockey-stop deceleration, ft/s². */
  brake: number
  /** Max lateral (turning) acceleration, ft/s². */
  grip: number
  /** Yaw rate at rest, rad/s (falls with speed). */
  yaw: number
}

export const MIN_TOP_FT = 25
export const MAX_TOP_FT = 35.5

export function capsFor(p: Player): Caps {
  const skating = r100(p.composites.skating)
  const ph = p.ratings.physical
  const top = MIN_TOP_FT + (skating / 100) * (MAX_TOP_FT - MIN_TOP_FT)
  return {
    top,
    topBack: top * 0.68,
    accel: 10 + r100(ph.acceleration) * 0.08,
    brake: 12 + r100(ph.agility) * 0.07,
    grip: 16 + r100(ph.agility) * 0.08,
    yaw: 6 + r100(ph.agility) * 0.03
  }
}

/** A skater's physical body. */
export interface Body {
  player: Player
  x: number
  y: number
  vx: number
  vy: number
  /** Facing (unit vector) — separate from velocity. */
  hx: number
  hy: number
  radius: number
  /** Mass in lb (equipment included). */
  mass: number
  caps: Caps
  /** Shift energy 0..1 (1 = fresh). */
  energy: number
  /** Last applied acceleration magnitude, ft/s² (motion-quality telemetry). */
  accMag: number
  /** Seconds left knocked off balance (after a hit) — no thrust, no control. */
  stun: number
}

export function makeBody(p: Player, x: number, y: number, faceX: number): Body {
  const kg = p.weightKg ?? 88 + (r100(p.ratings.physical.strength) - 50) * 0.25
  return {
    player: p,
    x,
    y,
    vx: 0,
    vy: 0,
    hx: faceX >= 0 ? 1 : -1,
    hy: 0,
    radius: 1.35,
    mass: kg * 2.2046 + 25,
    caps: capsFor(p),
    energy: 1,
    accMag: 0,
    stun: 0
  }
}

/** What an agent asks his legs to do this instant. */
export interface MoveCmd {
  /** Target point (ft). */
  tx: number
  ty: number
  /** Desired cruising speed toward it (ft/s). */
  speed: number
  /** Decelerate to stop ON the target (vs. skate through it). */
  arrive: boolean
  /** 0 (drifting into shape) … 1 (all-out race). Sets the tracking time constant. */
  urgency: number
  /** Face this point instead of the direction of travel (backward skating, reading the play). */
  faceX?: number | undefined
  faceY?: number | undefined
  /** Finishing a check: skate through the man into the boards (no edge before the wall). */
  boardsOk?: boolean | undefined
}

const GLIDE_DECEL = 0.7
/** Energy drain per second at full thrust; recovery per second while coasting. */
const DRAIN = 0.022
const RECOVER = 0.004

export function speedOf(b: Body): number {
  return Math.hypot(b.vx, b.vy)
}

/** Current top speed allowing for fatigue and for skating backward. */
function currentCap(b: Body): number {
  const sp = speedOf(b)
  const tiredF = 0.82 + 0.18 * b.energy
  if (sp > 1) {
    const cosFV = (b.vx * b.hx + b.vy * b.hy) / sp
    if (cosFV < -0.34) return b.caps.topBack * tiredF
  }
  return b.caps.top * tiredF
}

/** Integrate one body for dt seconds under a command. */
export function stepBody(b: Body, cmd: MoveCmd, dt: number): void {
  if (b.stun > 0) {
    // Off balance: coasting, no control.
    b.stun = Math.max(0, b.stun - dt)
    const sp = speedOf(b)
    if (sp > 0) {
      const dec = Math.min(sp, 6 * dt)
      b.vx -= (b.vx / sp) * dec
      b.vy -= (b.vy / sp) * dec
    }
    b.x += b.vx * dt
    b.y += b.vy * dt
    b.accMag = 6
    return
  }
  const dx = cmd.tx - b.x
  const dy = cmd.ty - b.y
  const d = Math.hypot(dx, dy)
  let want = cmd.speed
  if (cmd.arrive) want = Math.min(want, Math.sqrt(2 * b.caps.brake * 0.5 * Math.max(0, d - 0.5)))
  if (d < 0.5) want = 0
  const cap = currentCap(b)
  want = Math.min(want, cap)
  let vdx = d > 1e-6 ? (dx / d) * want : 0
  let vdy = d > 1e-6 ? (dy / d) * want : 0
  // Skaters see the boards coming: the part of the wanted velocity that
  // runs INTO the boards is dropped half a second out, so the legs take the
  // speed off with an edge (within the normal limits) instead of the boards
  // stopping him dead. A man finishing a check skates through.
  if (!cmd.boardsOk) {
    const pr = boardsClamp(b.x + b.vx * 0.45, b.y + b.vy * 0.45, b.radius + 0.3)
    if (pr.hit) {
      const vn = vdx * pr.nx + vdy * pr.ny
      if (vn > 0) {
        vdx -= vn * pr.nx
        vdy -= vn * pr.ny
      }
    }
  }

  const tau = 1.6 - 1.25 * clamp(cmd.urgency, 0, 1)
  let ax = (vdx - b.vx) / tau
  let ay = (vdy - b.vy) / tau
  const sp = speedOf(b)
  const energyF = 0.7 + 0.3 * b.energy
  let thrust = 0
  if (sp > 3) {
    const ux = b.vx / sp
    const uy = b.vy / sp
    let at = ax * ux + ay * uy
    let an = -ax * uy + ay * ux
    const cosDes = want > 0.5 ? (vdx * ux + vdy * uy) / want : 1
    // Reversing direction at speed = hockey stop: brake along the line of
    // travel, no carving until the speed is scrubbed.
    if (cosDes < -0.3 && sp > 8) {
      at = -b.caps.brake
      an = 0
    } else {
      const avail = b.caps.accel * energyF * Math.max(0.12, 1 - (sp / Math.max(cap, 1)) ** 2)
      at = clamp(at, -b.caps.brake, avail)
      an = clamp(an, -b.caps.grip, b.caps.grip)
      // Friction circle: carving and driving share the same edges (crossovers
      // keep some thrust through a turn, but not all of it).
      const tot = Math.hypot(at, an)
      const lim = b.caps.grip * PHYS.circle
      if (tot > lim) {
        at *= lim / tot
        an *= lim / tot
      }
    }
    thrust = Math.max(0, at)
    ax = at * ux - an * uy
    ay = at * uy + an * ux
  } else {
    // Near a standstill a skater can push off in any direction.
    const m = Math.hypot(ax, ay)
    const lim = b.caps.accel * energyF * 1.1
    if (m > lim) {
      ax *= lim / m
      ay *= lim / m
    }
    thrust = Math.min(m, lim)
  }
  // Ice friction while gliding.
  if (sp > 0.05) {
    ax -= (b.vx / sp) * GLIDE_DECEL
    ay -= (b.vy / sp) * GLIDE_DECEL
  }
  b.vx += ax * dt
  b.vy += ay * dt
  let sp2 = speedOf(b)
  if (sp2 > cap) {
    // Over the cap because the cap just FELL (he turned to skate backward,
    // or tired): he bleeds the extra speed off at braking strength rather
    // than losing it in one step (an impossible, jerky deceleration). Above
    // his forward top speed it is a hard limit.
    const hard = b.caps.top * 1.02
    const target = sp2 > hard ? Math.max(cap, hard) : Math.max(cap, sp2 - b.caps.brake * dt)
    b.vx *= target / sp2
    b.vy *= target / sp2
    sp2 = target
  }
  b.x += b.vx * dt
  b.y += b.vy * dt
  b.accMag = Math.hypot(ax, ay)
  // Stamina: thrust costs, coasting recovers a little.
  b.energy = clamp(b.energy - (thrust / b.caps.accel) * DRAIN * dt + (thrust < 2 ? RECOVER * dt : 0), 0, 1)

  // Facing: toward the requested point, else along the direction of travel.
  let fx = b.hx
  let fy = b.hy
  if (cmd.faceX !== undefined && cmd.faceY !== undefined) {
    const qx = cmd.faceX - b.x
    const qy = cmd.faceY - b.y
    const q = Math.hypot(qx, qy)
    if (q > 0.5) {
      fx = qx / q
      fy = qy / q
    }
  } else if (sp2 > 2.5) {
    fx = b.vx / sp2
    fy = b.vy / sp2
  }
  turnFacing(b, fx, fy, dt)
}

function turnFacing(b: Body, fx: number, fy: number, dt: number): void {
  const cur = Math.atan2(b.hy, b.hx)
  const tgt = Math.atan2(fy, fx)
  let dA = tgt - cur
  while (dA > Math.PI) dA -= 2 * Math.PI
  while (dA < -Math.PI) dA += 2 * Math.PI
  const rate = b.caps.yaw * (1 - 0.45 * clamp(speedOf(b) / b.caps.top, 0, 1))
  const step = clamp(dA, -rate * dt, rate * dt)
  const na = cur + step
  b.hx = Math.cos(na)
  b.hy = Math.sin(na)
}

/** A body-to-body contact this step (for the physical game). */
export interface Contact {
  a: Body
  b: Body
  /** Closing speed along the contact normal before the collision, ft/s. */
  closing: number
  /** Contact normal a→b. */
  nx: number
  ny: number
}

/**
 * Bodies occupy space: separate overlapping skaters and exchange momentum
 * (inelastic). Returns the contacts where the pair was closing.
 */
/** Share of a contact impulse applied per substep (1 = instantaneous). */
export const CONTACT_SOFT = { k: 0.3 }
/** Friction circle: total edge force as a multiple of the lateral grip. */
export const PHYS = { circle: 1.0 }

export function resolveBodies(bodies: readonly Body[], out: Contact[]): void {
  const n = bodies.length
  for (let i = 0; i < n; i++) {
    const a = bodies[i]
    for (let j = i + 1; j < n; j++) {
      const b = bodies[j]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const rs = a.radius + b.radius
      if (Math.abs(dx) > rs || Math.abs(dy) > rs) continue
      const d = Math.hypot(dx, dy)
      if (d >= rs) continue
      const nx = d > 1e-6 ? dx / d : 1
      const ny = d > 1e-6 ? dy / d : 0
      const overlap = rs - d
      const ia = 1 / a.mass
      const ib = 1 / b.mass
      const sum = ia + ib
      a.x -= nx * overlap * (ia / sum)
      a.y -= ny * overlap * (ia / sum)
      b.x += nx * overlap * (ib / sum)
      b.y += ny * overlap * (ib / sum)
      const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny
      if (closing > 0) {
        const e = 0.15
        // Bodies absorb a contact over a few substeps (knees, shoulders, the
        // glide), not in one instant: part of the impulse per step.
        const jImp = (((1 + e) * closing) / sum) * CONTACT_SOFT.k
        a.vx -= jImp * ia * nx
        a.vy -= jImp * ia * ny
        b.vx += jImp * ib * nx
        b.vy += jImp * ib * ny
        out.push({ a, b, closing, nx, ny })
      }
    }
  }
}

/** Boards and nets stop bodies (never add displacement). */
export function constrainBody(b: Body): boolean {
  let hitBoards = false
  const h = boardsClamp(b.x, b.y, b.radius)
  if (h.hit) {
    hitBoards = true
    b.x = h.x
    b.y = h.y
    const vn = b.vx * h.nx + b.vy * h.ny
    if (vn > 0) {
      b.vx -= vn * h.nx
      b.vy -= vn * h.ny
      b.vx *= 0.96
      b.vy *= 0.96
    }
  }
  for (const s of [1, -1]) {
    const np = netPush(b.x, b.y, s, b.radius)
    if (np) {
      b.x = np.x
      b.y = np.y
      const vn = b.vx * np.nx + b.vy * np.ny
      if (vn < 0) {
        b.vx -= vn * np.nx
        b.vy -= vn * np.ny
      }
    }
  }
  return hitBoards
}

// ---------------------------------------------------------------------------
// The puck
// ---------------------------------------------------------------------------

export interface Puck {
  x: number
  y: number
  vx: number
  vy: number
  /** Height above the ice (ft) and vertical speed — chips, clears, flips. */
  z: number
  vz: number
  /** Body carrying it on his blade, or null when loose/in flight. */
  carrier: Body | null
}

/** Ice friction on a sliding puck (ft/s²). */
const PUCK_FRICTION = 4.5
/** Height of the boards; above this at the boards the puck hits glass. */
const BOARD_H = 3.5
const GLASS_H = 8

/** Where the blade (and the puck on it) is: a stick-length ahead, working side to side. */
export function bladePoint(b: Body, t: number, wobble = 1): { x: number; y: number } {
  const w = Math.sin(t * 5.3 + b.mass) * 0.7 * wobble
  return { x: b.x + b.hx * 2.3 - b.hy * w, y: b.y + b.hy * 2.3 + b.hx * w }
}

export type PuckStepResult = 'ok' | 'outOfPlay'

/**
 * Advance a free puck: friction, board bounces (restitution + tangential
 * scrub, so rims ride the boards around the corners), net bounces, flight.
 */
export function stepPuck(p: Puck, dt: number): PuckStepResult {
  // Flight.
  if (p.z > 0 || p.vz > 0) {
    p.vz -= 32 * dt
    p.z += p.vz * dt
    if (p.z <= 0) {
      p.z = 0
      // Lands and skips: lose some speed.
      p.vz = 0
      p.vx *= 0.8
      p.vy *= 0.8
    }
  }
  const sp = Math.hypot(p.vx, p.vy)
  if (sp > 0) {
    const dec = Math.min(sp, (p.z > 0 ? 0.3 : PUCK_FRICTION) * dt)
    p.vx -= (p.vx / sp) * dec
    p.vy -= (p.vy / sp) * dec
  }
  p.x += p.vx * dt
  p.y += p.vy * dt
  const h = boardsClamp(p.x, p.y, 0.3)
  if (h.hit) {
    if (p.z > GLASS_H) return 'outOfPlay'
    p.x = h.x
    p.y = h.y
    const vn = p.vx * h.nx + p.vy * h.ny
    if (vn > 0) {
      // Boards and glass soak up most of a head-on hit (pucks don't come off
      // the end wall at shot speed); a glancing rim keeps its pace along the wall.
      const e = p.z > BOARD_H ? 0.18 : 0.25
      p.vx -= (1 + e) * vn * h.nx
      p.vy -= (1 + e) * vn * h.ny
      p.vx *= 0.86
      p.vy *= 0.86
    }
    if (p.z > BOARD_H) p.vz = Math.min(p.vz, 0)
  }
  for (const s of [1, -1]) {
    if (p.z > 4) continue
    const np = netPush(p.x, p.y, s, 0.2)
    if (np) {
      p.x = np.x
      p.y = np.y
      const vn = p.vx * np.nx + p.vy * np.ny
      if (vn < 0) {
        p.vx -= 1.4 * vn * np.nx
        p.vy -= 1.4 * vn * np.ny
        p.vx *= 0.7
        p.vy *= 0.7
      }
    }
  }
  return 'ok'
}
