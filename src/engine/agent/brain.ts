/**
 * M2 — AGENTS THAT THINK.
 *
 * Every skater re-reads the ice several times a second and picks what to do
 * from his ROLE (templates.ts) × the COACH'S SYSTEM (tactics) × the SITUATION
 * (puck, bodies, score state) × his ATTRIBUTES:
 *
 *   carrier   — evaluates carrying into space (8 headings), every pass option,
 *               a shot, a dump/chip; each valued as expected goal value using
 *               the xG surface in the zone and an advancement value elsewhere,
 *               minus the cost of losing the puck where it would be lost. His
 *               choice is a softmax whose sharpness is his decision-making, his
 *               read of options behind him depends on vision, and his execution
 *               error on skill and pressure — so mistakes EMERGE.
 *   support   — holds his role spot relative to the puck, stays onside, and
 *               slides off it to open a passing lane.
 *   defence   — one presser (forecheck F1 / DZ on-puck / NZ gap-control D),
 *               everyone else in the system's spots (zone or man coverage),
 *               the lane man steps into shooting lanes, loose pucks are raced.
 *
 * Only decides; the sim executes (physics, pass/shot resolution, rules).
 */
import type { XY } from '@domain'
import { shotXg } from '@engine/full/fullSim'
import type { Body, MoveCmd } from './physics'
import { speedOf } from './physics'
import { BLUE_X, GOAL_X, boardsClamp, distToBoards } from './rink'
import {
  BREAKOUT,
  CYCLE,
  CYCLE_POINT,
  DZ_ZONE,
  NZ_DEFENSE,
  OT_ATTACK,
  OT_DEFEND,
  RUSH,
  TRANSITION,
  forecheck,
  penaltyKill,
  powerPlay,
  spotTarget,
  type RoleSpot
} from './templates'
import { other, type CarrierAction, type Side, type World } from './world'

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
const r01 = (v: number | undefined): number => clamp((v ?? 50) / 100, 0, 1)

// ---------------------------------------------------------------------------
// Tunables — measured against the realism scorecard / calibration suite.
// ---------------------------------------------------------------------------

/** Multiplier on the value of shooting (the shot-volume lever). */

/** Value of a teammate at the net-front for a shot from distance (tip/screen/rebound). */
export const TIP_VALUE = { value: 0.012 }
export const SHOOT_BIAS = { value: 0.355 }
/** Seconds after a zone entry that play is still a "rush". */
const RUSH_WINDOW = 4.5
/** Stick reach from the body centre, ft. */
export const REACH = 5

// ---------------------------------------------------------------------------
// Value model
// ---------------------------------------------------------------------------

export function xgAt(x: number, y: number, a: number): number {
  return shotXg({ x: x / 100, y: y / 42.5 }, a)
}

/** Expected value of having the puck at (x,y) for the side attacking `a`. */
export function posValue(x: number, y: number, a: number): number {
  const adv = x * a
  // In the zone: the possession is worth a base (a chance will come) plus
  // part of what a shot from here is worth — holding a spot is worth LESS
  // than shooting from it once the spot is dangerous enough, which is what
  // makes carriers shoot from range instead of skating everyone to the crease.
  if (adv >= BLUE_X) {
    if (adv > GOAL_X) return 0.014
    return 0.012 + 0.6 * xgAt(x, y, a)
  }
  return 0.004 + (0.009 * (adv + 100)) / 125
}

/** Rough seconds for a body to reach a point (current momentum + thrust). */
export function reachTime(b: Body, x: number, y: number): number {
  const dx = x - b.x
  const dy = y - b.y
  const d = Math.hypot(dx, dy)
  if (d < 0.5) return 0
  const v0 = Math.max(0, (dx * b.vx + dy * b.vy) / d)
  const top = b.caps.top * 0.92
  const acc = b.caps.accel
  const ta = Math.max(0, (top - v0) / acc)
  const da = ((v0 + top) / 2) * ta
  if (d <= da) return (-v0 + Math.sqrt(v0 * v0 + 2 * acc * d)) / acc
  return ta + (d - da) / top
}

function nearestTo(bodies: readonly Body[], x: number, y: number): { b: Body | null; d: number } {
  let best: Body | null = null
  let bd = Infinity
  for (const b of bodies) {
    const d = Math.hypot(b.x - x, b.y - y)
    if (d < bd) {
      bd = d
      best = b
    }
  }
  return { b: best, d: bd }
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z))
}

/** Pressure on a carrier: 0 (free) … 1 (defender on him, closing). */
export function pressureOn(c: Body, opps: readonly Body[]): number {
  let p = 0
  for (const o of opps) {
    const d = Math.hypot(o.x - c.x, o.y - c.y)
    if (d > 16) continue
    const ux = (c.x - o.x) / Math.max(d, 0.1)
    const uy = (c.y - o.y) / Math.max(d, 0.1)
    const closing = (o.vx - c.vx) * ux + (o.vy - c.vy) * uy
    p = Math.max(p, clamp(1 - d / 16 + clamp(closing, 0, 12) / 40, 0, 1))
  }
  return p
}

/** Defender in stick reach and closing — the only license for an OZ back pass. */
export function realPressure(c: Body, opps: readonly Body[]): boolean {
  for (const o of opps) {
    const d = Math.hypot(o.x - c.x, o.y - c.y)
    if (d >= 8) continue
    if (d < 5) return true
    const ux = (c.x - o.x) / d
    const uy = (c.y - o.y) / d
    if ((o.vx - c.vx) * ux + (o.vy - c.vy) * uy > 1) return true
  }
  return false
}

/** Backward pass (same definition as the director engine's isBackwardPass, in ft). */
export function isBackFt(fx: number, fy: number, tx: number, ty: number, a: number): boolean {
  // Same definition as the realism scorecard: ≥ 3 ft long and more than 110°
  // off the attack direction.
  const dx = (tx - fx) * a
  const dy = Math.abs(ty - fy)
  return Math.hypot(dx, dy) >= 3 && dx < 0 && -dx > dy * 0.364
}

/**
 * Probability the carrier still has the puck when he arrives at q in `tc`
 * seconds: each defender who can get there first (plus stick reach) threatens.
 */
function retention(c: Body, q: XY, tc: number, opps: readonly Body[]): number {
  const skill = (r01(c.player.ratings.technical.stickhandling) + r01(c.player.composites.puckControl)) / 2
  let r = 1
  for (const o of opps) {
    const to = reachTime(o, q.x, q.y) - REACH / Math.max(o.caps.top, 1) + 0.2
    const margin = to - tc + (skill - 0.5) * 0.5
    r *= 1 - 0.93 * sigmoid(-margin * 3.5)
  }
  return r
}

/** Estimated completion probability of a pass from p to R at speed v. */
function passCompletion(p: XY, R: XY, v: number, passer: Body, opps: readonly Body[]): number {
  const dx = R.x - p.x
  const dy = R.y - p.y
  const L = Math.hypot(dx, dy)
  const tf = L / v
  let comp = clamp(0.97 - L / 380 + (r01(passer.player.ratings.technical.passing) - 0.5) * 0.08, 0.3, 0.99)
  for (const o of opps) {
    // Closest point of the lane to this defender.
    const s = L > 1e-6 ? clamp(((o.x - p.x) * dx + (o.y - p.y) * dy) / (L * L), 0.05, 1) : 1
    const qx = p.x + dx * s
    const qy = p.y + dy * s
    const dLane = Math.hypot(o.x - qx, o.y - qy)
    if (dLane > 22) continue
    const tDef = Math.max(0, dLane - REACH) / Math.max(o.caps.top * 0.8, 1) + 0.25
    const threat = sigmoid((s * tf - tDef) * 6)
    comp *= 1 - 0.55 * threat
  }
  return comp
}

/** Speed that sends a puck `d` ft to die around `at` (friction ≈ 4 ft/s²). */
function rimSpeed(c: Body, at: XY, k: number): number {
  const d = Math.hypot(at.x - c.x, at.y - c.y)
  return clamp(Math.sqrt(2 * 4 * d) * k + 6, 22, 80)
}

// ---------------------------------------------------------------------------
// Carrier
// ---------------------------------------------------------------------------

interface Option {
  ev: number
  act: CarrierAction
}

/**
 * The carrier's read. `me` is his side. Returns the chosen action.
 * `oneTimerReady` — he just took a pass in a shooting spot with his stick loaded.
 */
export function decideCarrier(w: World, me: Side, c: Body): CarrierAction {
  const opp = other(w, me)
  const a = me.a
  const opps = opp.skaters
  const m = c.player.ratings.mental
  const adv = c.x * a
  const pressure = pressureOn(c, opps)
  const pressed = realPressure(c, opps)
  const reading = (r01(m.offensiveIQ) + r01(m.vision) + r01(m.composure)) / 3
  const opts: Option[] = []
  const eager = (0.7 + me.tactics.tempo.shotEagerness * 0.6) * (me.powerPlay ? 1.1 : 1)
  const cur = posValue(c.x, c.y, a)
  const sp = speedOf(c)

  // Teammates still offside: don't take the puck over the line yet.
  const offsideMate = adv < BLUE_X && me.skaters.some((b) => b !== c && b.x * a > BLUE_X + 0.5)
  const lineCap = (x: number): number =>
    offsideMate && x * a > BLUE_X - 1 ? a * (BLUE_X - 1.5) : x

  // --- Empty net: fire it from anywhere with a lane (mind the icing). ---
  if (opp.pulled && adv > -60 && adv < GOAL_X - 1) {
    const nx0 = a * GOAL_X
    const dist = Math.hypot(nx0 - c.x, c.y)
    let clear = 1
    for (const o of opps) {
      const L = Math.max(dist, 1)
      const s1 = ((o.x - c.x) * (nx0 - c.x) + (o.y - c.y) * -c.y) / (L * L)
      if (s1 < 0.03 || s1 > 1) continue
      const d = Math.hypot(o.x - (c.x + (nx0 - c.x) * s1), o.y - c.y * (1 - s1))
      if (d < 4) clear *= 0.35
    }
    const onTarget = clamp(1.05 - dist / 180, 0.3, 0.95)
    const icingRisk = adv < 0 && !me.shorthanded ? (1 - onTarget) * 0.02 : 0
    opts.push({ ev: 0.5 * onTarget * clear - icingRisk, act: { kind: 'shoot' } })
  }

  // --- Shoot ---
  if (adv > BLUE_X && adv < GOAL_X - 1 && !opp.pulled) {
    const xg = xgAt(c.x, c.y, a)
    // Bodies in the lane to the net take shots away.
    let lane = 1
    const nx = a * GOAL_X
    for (const o of opps) {
      const L = Math.hypot(nx - c.x, -c.y)
      const s = clamp(((o.x - c.x) * (nx - c.x) + (o.y - c.y) * -c.y) / (L * L), 0, 1)
      if (s < 0.05 || s > 0.92) continue
      const d = Math.hypot(o.x - (c.x + (nx - c.x) * s), o.y - (c.y - c.y * s))
      if (d < 3) lane *= 0.75
      else if (d < 6) lane *= 0.92
    }
    // A man on him in tight will lift his stick.
    for (const o of opps) if (Math.hypot(o.x - c.x, o.y - c.y) < 3.4) lane *= 0.6
    const shooter = (r01(c.player.ratings.technical.wristShot) + r01(c.player.composites.scoring)) / 2
    // A shot also keeps some of the possession (rebounds, retrievals).
    // From distance, a shot through traffic is a PLAY: a teammate at the
    // net-front makes tips, screens and rebounds, and the puck stays in the
    // zone. That is why D shoot from the point.
    const dNet = Math.hypot(a * GOAL_X - c.x, c.y)
    let tips = 0
    if (dNet > 32) for (const b of me.skaters) if (b !== c && Math.hypot(b.x - a * GOAL_X, b.y) < 14) tips++
    const ev = (xg * lane * (0.7 + shooter * 0.6) * eager + 0.005) * SHOOT_BIAS.value + Math.min(tips, 2) * TIP_VALUE.value * lane
    opts.push({ ev, act: { kind: 'shoot' } })
  }

  // --- Carry (8 headings) ---
  {
    const toNet = adv > BLUE_X
    const baseAng = toNet ? Math.atan2(0 - c.y, a * GOAL_X - c.x) : Math.atan2(0, a)
    const angs = [0, 0.5, -0.5, 1.05, -1.05, 1.7, -1.7, Math.PI]
    const look = clamp(sp * 0.9 + 8, 10, 22)
    const puckSkill = r01(c.player.composites.puckControl)
    for (const da of angs) {
      const ang = baseAng + da
      let qx = c.x + Math.cos(ang) * look
      let qy = c.y + Math.sin(ang) * look
      const h = boardsClamp(qx, qy, 3)
      qx = lineCap(h.x)
      qy = h.y
      if (qx * a > GOAL_X - 2 && Math.abs(qy) < 6) qx = a * (GOAL_X - 4)
      const tc = Math.hypot(qx - c.x, qy - c.y) / Math.max(sp * 0.5 + c.caps.top * 0.45, 10)
      const ret = retention(c, { x: qx, y: qy }, tc, opps)
      const protect = da === Math.PI
      const retEff = protect ? clamp(ret + 0.25 * puckSkill, 0, 0.97) : ret
      const v = posValue(qx, qy, a)
      const cost = posValue(qx, qy, -a)
      const ev = retEff * v - (1 - retEff) * cost * 0.9
      const urg = me.tactics.tempo.pace * 0.4 + (adv < BLUE_X ? 0.55 : 0.35) + (pressure > 0.5 ? 0.2 : 0)
      opts.push({
        ev: ev + (protect ? -0.002 : 0),
        act: {
          kind: 'carry',
          protect,
          cmd: {
            tx: qx,
            ty: qy,
            speed: protect ? 8 : c.caps.top * clamp(0.5 + urg * 0.4, 0.5, 0.9),
            arrive: false,
            urgency: clamp(urg, 0.3, 1),
            ...(protect ? { faceX: c.x - Math.cos(ang) * 10, faceY: c.y - Math.sin(ang) * 10 } : {})
          }
        }
      })
    }
  }

  // --- Pass ---
  {
    const backOkBase = adv <= 0
    const mates = me.skaters.filter((b) => b !== c)
    const infos = mates.map((r) => {
      const d0 = Math.hypot(r.x - c.x, r.y - c.y)
      const speed = clamp(38 + d0 * 0.6 + r01(c.player.ratings.technical.passing) * 10, 40, 88)
      const tf = d0 / speed
      const R = {
        x: clamp(r.x + r.vx * tf, -97, 97),
        y: clamp(r.y + r.vy * tf, -40, 40)
      }
      const back = isBackFt(c.x, c.y, R.x, R.y, a)
      const open = nearestTo(opps, R.x, R.y).d
      return { r, speed, R, back, open, d0 }
    })
    const hasForward = infos.some((f) => !f.back && f.open > 6)
    // Transition: we won it < 8 s ago and haven't set up in their zone yet —
    // the play goes forward (a back pass is only the pressured bail-out).
    // (Same test as the scorecard: won outside their zone, already moved ≥ 15
    // ft up ice — a D-to-D right after a retrieval is still allowed.)
    const transition = w.t - w.possSince < 8 && w.possStartAdv < BLUE_X && adv > w.possStartAdv + 12 && adv < 70
    // In alone / numbers: nobody (or fewer of them) goal-side of the carrier.
    let goalSide = 0
    for (const o of opps) if (o.x * a > c.x * a) goalSide++
    const breakaway = goalSide === 0 && adv > -BLUE_X
    // Settled in their zone (not a rush), low-to-high to an open point man is
    // a real play (the scorecard's OZ back-pass band is 12–40%); on the rush
    // and in transition it is only the pressured bail-out.
    const settledOz = adv > BLUE_X && !transition
    const backOk = (backOkBase && !transition) || settledOz || (pressed && !hasForward && !breakaway)
    for (const f of infos) {
      if (f.back && !backOk) continue
      // On a breakaway only a clearly forward pass (the 2-on-0 feed) is a play.
      if (breakaway && (f.R.x - c.x) * a < 4) continue
      // Offside: never feed a man already over the line ahead of the puck.
      if (f.R.x * a > BLUE_X && adv < BLUE_X - 0.5) continue
      if (f.d0 < 7) continue
      // Vision: a mate behind the carrier's shoulders is seen only sometimes.
      const vx = f.r.x - c.x
      const vy = f.r.y - c.y
      const cosF = (vx * c.hx + vy * c.hy) / Math.max(f.d0, 0.1)
      if (cosF < -0.35 && w.rng.next() > 0.25 + r01(m.vision) * 0.6) continue
      const comp = passCompletion({ x: c.x, y: c.y }, f.R, f.speed, c, opps)
      let v = posValue(f.R.x, f.R.y, a)
      // Across the royal road to a shooter: the one-timer look (goalie moving).
      const royal =
        f.R.x * a > 55 && Math.abs(f.R.y) < 16 && Math.sign(f.R.y || 1) !== Math.sign(c.y || 1) && Math.abs(c.y) > 8
      const oneTimer = royal && f.open > 7
      if (oneTimer) v *= 1.3
      // Open ice at the receiver is worth more (time to make the next play).
      // A covered man (a defender on his hip) is not really open: he'll be
      // tied up or stripped before he can do anything with it.
      v *= clamp(f.open / 11, 0.2, 1.2)
      const cost = posValue(f.R.x, f.R.y, -a)
      let ev = comp * v - (1 - comp) * cost * 0.8
      if (f.back) ev -= 0.003
      opts.push({ ev, act: { kind: 'pass', to: f.r, at: f.R, speed: f.speed, oneTimer } })
    }
  }

  // --- Dump / chip / clear ---
  {
    const dumping = me.tactics.dumping ?? 0.5
    if (adv > 2 && adv < BLUE_X + 2 && !offsideMate) {
      // Dump it in: rim to the far corner (or strong corner) for the chase.
      const side = c.y >= 0 ? -1 : 1
      const at = { x: a * 88, y: side * 30 }
      let chase = 0
      for (const r of me.skaters) if (r !== c) chase = Math.max(chase, 1 - clamp(reachTime(r, at.x, at.y) / 4, 0, 1))
      const ev = (0.25 + chase * 0.25) * posValue(a * 80, side * 30, a) - 0.45 * posValue(a * 80, side * 30, -a) * 0.6
      opts.push({ ev: ev * (0.8 + dumping * 0.4), act: { kind: 'dump', at, speed: rimSpeed(c, at, 1.35), lift: 0 } })
    }
    if (adv >= -BLUE_X - 5 && adv <= 2 && pressure > 0.35 && !offsideMate) {
      // Met in the neutral zone: chip it past the man into the space behind
      // him and skate onto it (or for a teammate to chase) — the NZ chip.
      const side = c.y >= 0 ? 1 : -1
      const at = { x: c.x + a * 32, y: clamp(c.y + side * 6, -38, 38) }
      let chase = 0
      for (const r of me.skaters) chase = Math.max(chase, 1 - clamp(reachTime(r, at.x, at.y) / 3, 0, 1))
      const ev = (0.3 + chase * 0.35) * posValue(at.x, at.y, a) - 0.5 * posValue(at.x, at.y, -a)
      opts.push({ ev, act: { kind: 'dump', at, speed: rimSpeed(c, at, 1.2), lift: 4 } })
    }
    if (adv < -BLUE_X) {
      // Get it out: chip it off the glass to the neutral-zone boards; a PK
      // (or a desperate man) fires it down the ice.
      const side = c.y >= 0 ? 1 : -1
      const chipAt = { x: a * 8, y: side * 40 }
      const ev = 0.4 * posValue(chipAt.x, chipAt.y, a) - 0.5 * posValue(chipAt.x, chipAt.y, -a) * 0.8
      opts.push({ ev: ev - (pressure < 0.4 ? 0.004 : 0), act: { kind: 'dump', at: chipAt, speed: rimSpeed(c, chipAt, 1.1), lift: 9 } })
      if (me.shorthanded) {
        const at = { x: a * 90, y: clamp(c.y, -20, 20) }
        opts.push({ ev: 0.012, act: { kind: 'dump', at, speed: 85, lift: 0 } })
      }
    }
  }

  // Decision quality: good readers take the best option nearly every time.
  const T = 0.0004 + (1 - reading) * 0.0022 + pressure * 0.0012 * (1 - r01(m.composure))
  let best = opts[0]
  for (const o of opts) if (o.ev > best.ev) best = o
  let sum = 0
  const ws = opts.map((o) => {
    const e = Math.exp((o.ev - best.ev) / T)
    sum += e
    return e
  })
  let r = w.rng.next() * sum
  for (let i = 0; i < opts.length; i++) {
    r -= ws[i]
    if (r <= 0) {
      return opts[i].act
    }
  }
  void cur
  return best.act
}

// ---------------------------------------------------------------------------
// Everyone else
// ---------------------------------------------------------------------------

/** Pick the role table for a side in this situation. */
function supportTable(w: World, me: Side, withPuck: boolean): RoleSpot[] {
  const opp = other(w, me)
  const a = me.a
  const px = w.puck.x * a
  if (me.ot && !me.powerPlay) return withPuck ? OT_ATTACK : OT_DEFEND
  if (withPuck) {
    if (me.powerPlay && px > BLUE_X) return powerPlay(me.tactics.specialTeams.powerPlay)
    if (px < -BLUE_X) return BREAKOUT
    if (px < BLUE_X) return TRANSITION
    if (w.t - me.entryAt < RUSH_WINDOW) return RUSH
    return px < 55 ? CYCLE_POINT : CYCLE
  }
  if (me.shorthanded && px < -10) return penaltyKill(me.tactics.specialTeams.penaltyKill)
  if (px > BLUE_X) return forecheck(me.tactics.forecheck)
  if (px > -BLUE_X) return NZ_DEFENSE
  void opp
  return DZ_ZONE
}

/** Assign roles greedily in priority order, with hysteresis on current roles. */
function assignRoles(me: Side, pool: Body[], table: RoleSpot[], targets: Map<string, XY>): Map<Body, RoleSpot> {
  const out = new Map<Body, RoleSpot>()
  const free = new Set(pool)
  for (const spot of table) {
    if (free.size === 0) break
    const tgt = targets.get(spot.role)!
    let best: Body | null = null
    let bc = Infinity
    for (const b of free) {
      const isD = b.player.position === 'D'
      let cost = Math.hypot(b.x - tgt.x, b.y - tgt.y)
      if (spot.pos === 'F' && isD) cost += 30
      if (spot.pos === 'D' && !isD) cost += 30
      if (me.roles.get(b) === spot.role) cost -= 12
      if (cost < bc) {
        bc = cost
        best = b
      }
    }
    if (best) {
      out.set(best, spot)
      free.delete(best)
    }
  }
  // Extra bodies (6 skaters vs a 5-role table) take the first role again, offset.
  for (const b of free) out.set(b, table[0])
  return out
}

/**
 * Per-player, slowly varying positional error: a weak positional player finds
 * his spot less precisely (and wanders more). Deterministic from the clock.
 */
function drift(b: Body, t: number, withPuck: boolean): XY {
  const pos = r01(b.player.ratings.mental.positioning)
  const ph = b.mass * 0.37
  // Hockey players never stand still: support skaters keep their feet moving
  // in loops around their spot (getting open, timing their route), defenders
  // shuffle and re-set. Weaker positional players also wander off the spot.
  const R = withPuck ? 9 : 5
  const om = withPuck ? 1.5 : 1.2
  const err = (1 - pos) * 5
  return {
    x: Math.cos(t * om + ph) * R + Math.sin(t * 0.31 + ph) * err,
    y: Math.sin(t * om + ph) * R * 0.8 + Math.cos(t * 0.23 + ph * 1.7) * err * 0.8
  }
}

export interface ThinkOut {
  cmds: Map<Body, MoveCmd>
  /** Defender attempting a poke check this think. */
  pokes: Body[]
}

/**
 * Orders for every skater on `me` except the carrier (who is decided by
 * decideCarrier), given the current world.
 */
export function thinkSide(w: World, me: Side, out: ThinkOut): void {
  const opp = other(w, me)
  const a = me.a
  const puck = w.puck
  const carrier = w.carrier
  const weHaveIt = w.control === me && carrier !== null
  const theyHaveIt = w.control === opp && carrier !== null
  const loose = carrier === null
  // Shape follows the last team in control while the puck is loose/in flight.
  const shapeWithPuck = weHaveIt || (loose && (w.flightSide ?? w.lastTouch) === me)
  const side = Math.abs(puck.y) < 4 ? (me.roles.size > 0 ? 1 : 1) : puck.y > 0 ? 1 : -1

  const pool = me.skaters.filter((b) => b !== carrier)
  const cmds = out.cmds

  // --- Loose puck: the nearest man (two when it is deep in our end) races it.
  const chasers = new Set<Body>()
  if (loose) {
    // Read the puck's path: every skater finds the earliest point on it he
    // can get to first (an intercept — cutting off a rim, stepping up to keep
    // a chip in at the line), and the man with the earliest intercept goes.
    const psp = Math.hypot(puck.vx, puck.vy)
    const path = (t: number): XY => {
      if (psp < 0.5) return { x: puck.x, y: puck.y }
      const tt = Math.min(t, psp / 4.5)
      const d = psp * tt - 0.5 * 4.5 * tt * tt
      const h = boardsClamp(puck.x + (puck.vx / psp) * d, puck.y + (puck.vy / psp) * d, 1.5)
      return { x: h.x, y: h.y }
    }
    const intercept = (b: Body): { t: number; p: XY } => {
      for (let t = 0; t <= 2.4; t += 0.15) {
        const p = path(t)
        if (reachTime(b, p.x, p.y) - REACH / Math.max(b.caps.top, 1) <= t) return { t, p }
      }
      const p = path(2.4)
      return { t: 2.4 + reachTime(b, p.x, p.y), p }
    }
    const eligible = pool.filter((b) => !(w.delayedOffside === me && b.x * a > BLUE_X - 1))
    const icpt = new Map(eligible.map((b) => [b, intercept(b)] as [Body, { t: number; p: XY }]))
    const sorted = [...eligible].sort((p, q) => icpt.get(p)!.t - icpt.get(q)!.t)
    if (w.passTo && sorted.includes(w.passTo)) {
      // The intended receiver meets the pass.
      chasers.add(w.passTo)
    } else if (sorted[0]) {
      chasers.add(sorted[0])
    }
    for (const b of chasers) {
      const ip = icpt.get(b)?.p ?? { x: puck.x, y: puck.y }
      const h = boardsClamp(ip.x, ip.y, 1.5)
      const far = Math.hypot(h.x - b.x, h.y - b.y) > 45
      cmds.set(b, { tx: h.x, ty: h.y, speed: b.caps.top * (far ? 1 : 0.9), arrive: false, urgency: 1 })
      me.roles.set(b, 'CHASE')
    }
  }

  // --- The presser (defending).
  let presser: Body | null = null
  if (theyHaveIt && carrier) {
    const ownNetX = -a * GOAL_X
    let bestT = Infinity
    for (const b of pool) {
      if (chasers.has(b)) continue
      let tt = reachTime(b, carrier.x, carrier.y)
      // Men already between the carrier and our net are better pressers; a
      // man chasing from behind can't stop him (he backchecks instead).
      if ((b.x - carrier.x) * -a > 0) tt -= 0.3
      else tt += 0.9
      // Deep in their end the forwards forecheck (F1) and the D hold the line.
      if (b.player.position === 'D' && carrier.x * a > 10) tt += 0.7
      if (b === me.presser) tt -= 0.4
      if (tt < bestT) {
        bestT = tt
        presser = b
      }
    }
    me.presser = presser
    if (presser) {
      const cx = carrier.x
      const cy = carrier.y
      const dNet = Math.hypot(ownNetX - cx, -cy)
      const ux = (ownNetX - cx) / Math.max(dNet, 1)
      const uy = -cy / Math.max(dNet, 1)
      const cAdvForUs = cx * a // carrier position in OUR attack frame
      const pp = me.tactics.puckPressure ?? 0.5
      const gc = me.tactics.gapControl ?? 0.5
      const isD = presser.player.position === 'D'
      if (cAdvForUs < BLUE_X && cAdvForUs > -BLUE_X - 5 && isD && !me.shorthanded) {
        // Neutral-ice gap control: back off at a gap that shrinks with the
        // system's gap setting, facing the carrier (backward skating).
        const csp = speedOf(carrier)
        const gap = clamp((10 + csp * 0.55) * (1.25 - gc * 0.5), 8, 30)
        cmds.set(presser, {
          tx: cx + ux * gap,
          ty: cy * 0.8 + uy * gap,
          speed: presser.caps.top,
          arrive: true,
          urgency: 0.9,
          // Read him backward while he's far or slow; pivot and skate when he
          // comes at you with speed (backward you'd be beaten wide).
          ...(Math.hypot(presser.x - cx, presser.y - cy) > 16 || csp < 15 ? { faceX: cx, faceY: cy } : {})
        })
      } else {
        // On the puck: take the inside (between him and the net). CONTAIN at a
        // stick-and-a-half gap, and only close to engage when the carrier is
        // vulnerable — pinned on the wall, slow, or turned away from our net
        // (the moment to strip him or finish him).
        const onWall = distToBoards(cx, cy) < 5
        const csp = speedOf(carrier)
        const turnedAway = carrier.hx * ux + carrier.hy * uy < -0.2
        const vulnerable = onWall || csp < 4 || turnedAway
        const inside = vulnerable ? 3.2 : clamp(10 - pp * 4, 6, 10)
        cmds.set(presser, {
          tx: cx + ux * inside + carrier.vx * 0.25,
          ty: cy + uy * inside + carrier.vy * 0.25,
          speed: presser.caps.top * (0.75 + pp * 0.25),
          arrive: !vulnerable,
          urgency: 0.75 + pp * 0.25,
          // Face him while he's slow or still coming; once he has speed on
          // you, skate WITH him (angling him to the wall), not backward.
          ...(csp < 12 || Math.hypot(presser.x - cx, presser.y - cy) > 16 ? { faceX: cx, faceY: cy } : {})
        })
      }
      me.roles.set(presser, 'ONPUCK')
      // Stick check when the puck is on a blade within reach.
      const dp = Math.hypot(presser.x - puck.x, presser.y - puck.y)
      if (dp < REACH) out.pokes.push(presser)
    }
  } else {
    me.presser = null
  }

  // --- Everyone else: role spots.
  const rest = pool.filter((b) => !chasers.has(b) && b !== presser)
  if (rest.length === 0) return
  const table = supportTable(w, me, shapeWithPuck)
  const targets = new Map<string, XY>()
  for (const s of table) targets.set(s.role, spotTarget(s, a, side, puck.x, puck.y))
  const roles = assignRoles(me, rest, table, targets)
  const inZone = puck.x * a >= BLUE_X
  const ownNetX = -a * GOAL_X

  // Man coverage in our zone: mark the most dangerous attackers goal-side.
  const man =
    !shapeWithPuck &&
    puck.x * a < -BLUE_X &&
    !me.shorthanded &&
    (me.tactics.dZoneCoverage === 'man' || me.tactics.dZoneCoverage === 'hybrid')
  const marks = new Map<Body, Body>()
  if (man) {
    const threats = opp.skaters
      .filter((o) => o !== carrier)
      .map((o) => ({ o, xg: xgAt(o.x, o.y, opp.a) }))
      .sort((p, q) => q.xg - p.xg)
    const freeD = new Set(rest)
    for (const th of threats) {
      if (me.tactics.dZoneCoverage === 'hybrid' && Math.hypot(th.o.x - ownNetX, th.o.y) > 30) continue
      const n = nearestTo([...freeD], th.o.x, th.o.y)
      if (!n.b) break
      marks.set(n.b, th.o)
      freeD.delete(n.b)
    }
  }

  // The shooting-lane man: when their carrier can shoot, one of ours steps in.
  let laneMan: Body | null = null
  if (theyHaveIt && carrier && carrier.x * opp.a > BLUE_X + 5) {
    const xg = xgAt(carrier.x, carrier.y, opp.a)
    if (xg > 0.025) {
      const lx = carrier.x + (ownNetX - carrier.x) * 0.3
      const ly = carrier.y * 0.7
      const n = nearestTo(rest, lx, ly)
      if (n.b && n.d < 25) laneMan = n.b
    }
  }

  // Their man closest to our crease (within 18 ft) — the net-front threat.
  let netFront: Body | null = null
  {
    let bd = 18
    for (const o of opp.skaters) {
      if (o === carrier) continue
      const d = Math.hypot(o.x - ownNetX, o.y)
      if (d < bd) {
        bd = d
        netFront = o
      }
    }
  }

  for (const b of rest) {
    const spot = roles.get(b)!
    me.roles.set(b, spot.role)
    let t = targets.get(spot.role)!
    let urgency = spot.urgency
    let faceX: number | undefined
    let faceY: number | undefined
    const mk = marks.get(b)
    if (mk) {
      const d = Math.hypot(ownNetX - mk.x, -mk.y)
      t = { x: mk.x + ((ownNetX - mk.x) / Math.max(d, 1)) * 3.5, y: mk.y + (-mk.y / Math.max(d, 1)) * 3.5 }
      urgency = 0.7
      faceX = puck.x
      faceY = puck.y
    } else if (!shapeWithPuck && (spot.role === 'D_NET' || spot.role === 'PK_NET' || spot.role === 'PK_LOW_W' || spot.role === 'OT_SLOT') && netFront) {
      // Box out the net-front man: goal-side of him, between him and the crease.
      const dx = ownNetX - netFront.x
      const dy = -netFront.y
      const d = Math.max(Math.hypot(dx, dy), 1)
      t = { x: netFront.x + (dx / d) * 2.6, y: netFront.y + (dy / d) * 2.6 }
      urgency = 0.8
      faceX = puck.x
      faceY = puck.y
    } else if (b === laneMan && carrier) {
      // Take away the lane — and inside 35 ft, collapse ONTO the carrier:
      // a body goal-side of him, a stride in front, the second man on the puck.
      const dN = Math.hypot(ownNetX - carrier.x, carrier.y)
      const f = dN < 35 ? clamp(5 / Math.max(dN, 1), 0.1, 0.5) : 0.3
      t = { x: carrier.x + (ownNetX - carrier.x) * f, y: carrier.y + (0 - carrier.y) * f }
      urgency = dN < 35 ? 1 : 0.85
      faceX = carrier.x
      faceY = carrier.y
    } else {
      const dr = drift(b, w.t, shapeWithPuck)
      t = { x: t.x + dr.x, y: t.y + dr.y }
    }
    // Delayed offside against us: everyone in the zone skates out to tag up.
    if (w.delayedOffside === me && b.x * a > BLUE_X - 1) {
      t = { x: a * (BLUE_X - 4), y: b.y }
      urgency = 1
    }
    // Onside discipline: while the puck is outside the zone, attackers stay
    // (or get back) onside — the tag-up.
    if (shapeWithPuck && !inZone && t.x * a > BLUE_X - 1.5) t = { x: a * (BLUE_X - 2), y: t.y }
    if (shapeWithPuck && !inZone && b.x * a > BLUE_X) urgency = Math.max(urgency, 0.9)
    // Get open: slide off a spot a defender is sitting in / on the lane.
    if (weHaveIt && carrier) {
      const n = nearestTo(opp.skaters, t.x, t.y)
      if (n.b && n.d < 7) {
        const ox = t.x - n.b.x
        const oy = t.y - n.b.y
        const o = Math.max(Math.hypot(ox, oy), 0.1)
        t = { x: t.x + (ox / o) * (8 - n.d), y: t.y + (oy / o) * (8 - n.d) }
      }
    }
    // Defenders read the play facing the puck in their own half — but when a
    // carrier is coming with speed they pivot and skate (backward is slow).
    const rushing = theyHaveIt && carrier !== null && speedOf(carrier) > 15 && Math.hypot(carrier.x - b.x, carrier.y - b.y) < 40
    if (!shapeWithPuck && faceX === undefined && puck.x * a < 0 && !rushing) {
      faceX = puck.x
      faceY = puck.y
    }
    // D never let a man behind them: when they have it (or it's loose off
    // their stick), a defenceman stays goal-side of their deepest attacker.
    if (!shapeWithPuck && b.player.position === 'D' && !mk) {
      let deepest = Infinity
      for (const o of opp.skaters) deepest = Math.min(deepest, o.x * a)
      const cap = deepest - 6
      if (t.x * a > cap) t = { x: a * Math.max(cap, -84), y: t.y }
    }
    // Caught up ice when they have it: BACKCHECK — sprint back goal-side.
    let backcheck = false
    if (theyHaveIt && carrier && (b.x - carrier.x) * a > 6) {
      backcheck = true
      urgency = 1
    }
    // Any stick within reach of their puck can go for it.
    if (theyHaveIt && Math.hypot(b.x - puck.x, b.y - puck.y) < REACH && out.pokes.length < 2) out.pokes.push(b)
    const h = boardsClamp(t.x, t.y, 2)
    const dist = Math.hypot(h.x - b.x, h.y - b.y)
    // Far from the spot → skate; close → drift calmly into it.
    const speed = b.caps.top * (backcheck ? 0.97 : clamp(0.45 + urgency * 0.5 + dist / 150, 0.35, 0.9))
    cmds.set(b, {
      tx: h.x,
      ty: h.y,
      speed,
      arrive: true,
      urgency: clamp(urgency * (dist > 25 ? 1.1 : 0.8), 0.2, 1),
      ...(faceX !== undefined ? { faceX, faceY } : {})
    })
  }
  void distToBoards
}
