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
import type { DekeKind, XY } from '@domain'
import { shotXg } from '@engine/full/fullSim'
import type { Body, MoveCmd } from './physics'
import { speedOf } from './physics'
import { BLUE_X, GOAL_X, boardsClamp, distToBoards } from './rink'
import {
  BREAKOUT,
  CYCLE,
  CYCLE_POINT,
  FOUR_ATTACK,
  FOUR_DEFEND,
  PK_TRIANGLE,
  PP_5V3,
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
import { other, rDef, rLevel, type CarrierAction, type Side, type World } from './world'

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
const r01 = rLevel

// ---------------------------------------------------------------------------
// Tunables — measured against the realism scorecard / calibration suite.
// ---------------------------------------------------------------------------

/** Multiplier on the value of shooting (the shot-volume lever). */


/**
 * The offensive-zone value model. Holding the puck in their zone is worth the
 * CONTINUATION of the possession (a chance will come: VAL.oz) plus part of
 * what a shot from the spot is worth (VAL.kPos · xG, the spot's option value).
 * A shot is worth its finish (VAL.shoot · xG through the lane) plus what it
 * keeps: rebounds, tips and retrievals with bodies at the net (VAL.keep · oz).
 * So a carrier with a lane from a decent spot SHOOTS (it beats holding), and
 * a carrier who drives into a crowded house risks the whole continuation
 * value on a low-retention carry. That is what brings shots out to range.
 */
export const VAL = { oz: 0.09, kPos: 0.15, shoot: 0.9, keep: 0.25, noise: 0.5, nz: 0.009, nzExp: 1, passShot: 0.5, tip: 0.012, tipKeep: 0.3, pointKeep: 2, laneRead: 0.75, angleZero: 90, behindNet: 0.85, transMaxX: 70, transBack: 0.003, rushNoBackX: 0, regroupMaxX: 20, ozBack: 0.008 }
/**
 * D safety (gap discipline): how far ahead a defenceman reads an attacker
 * coming at him (s), the base gap (ft) plus gap per ft/s of the attacker's
 * speed toward our net, and the margin (s) by which a D must win a loose-puck
 * race above the safety line before he steps up for it.
 */
export const D_SAFETY = { look: 2, gap: 12, gapPerV: 0.5, stepUpMargin: 1.3, pinchMaxX: 55, gapLead: 0.5, looseGuard: 1 }
/** Support-skater motion loops around a spot: radius (ft) and angular speed (rad/s). */
export const DRIFT = { rAtk: 12, rDef: 5, omAtk: 1.1, omDef: 0.9 }
/**
 * In close: the radius (ft) around their net where a carrier may not dawdle,
 * the seconds he may hold it there before he must act, the per-second cost of
 * holding, and his minimum carry speed there (share of top speed).
 */
export const INCLOSE = { radius: 30, deadline: 1.0, holdCost: 0.02, minSpeed: 0.8, protectSpeed: 0.72 }
/** Defending the house: the on-puck man engages (no containing) inside this radius of our net (ft). */
export const DZ = { engageFt: 30 }
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
    // Behind the goal line nothing can be made (no shot, the net in the way):
    // it is worth less than the same puck in front — you pass through, you
    // don't set up shop there.
    if (adv > GOAL_X - 1) return VAL.oz * VAL.behindNet
    return VAL.oz + VAL.kPos * xgAt(x, y, a)
  }
  // Outside their zone: the value of territory rises toward their blue line
  // (joining the zone value there), so a turnover deep in your own end costs
  // the other side's whole zone possession.
  const f = clamp((adv + 100) / 125, 0, 1)
  return 0.004 + VAL.nz * Math.pow(f, VAL.nzExp)
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
export function isBackFt(fx: number, fy: number, tx: number, ty: number, a: number, tanMargin = 0.364): boolean {
  // Same definition as the realism scorecard: ≥ 3 ft long and more than 110°
  // off the attack direction.
  const dx = (tx - fx) * a
  const dy = Math.abs(ty - fy)
  return Math.hypot(dx, dy) >= 3 && dx < 0 && -dx > dy * tanMargin
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

/**
 * What a shot by `c` from (x, y) is worth right now: the finish through the
 * lane, plus what a shot KEEPS (rebounds, retrievals — more with bodies at the
 * net), plus the tip/screen play a net-front teammate makes of a shot from
 * distance, minus the turnover a blocked shot hands back. Used for the
 * carrier's own shot and, at a pass target, for "pass it to the man who can
 * shoot" (low-to-high to the point, the seam one-timer).
 */
export function shotValue(me: Side, opps: readonly Body[], c: Body, x: number, y: number, eager: number, tight: boolean, goalie?: Body): number {
  const a = me.a
  const xg = xgAt(x, y, a)
  // Bodies in the lane to the net take shots away.
  let lane = 1
  const nx = a * GOAL_X
  const L = Math.max(Math.hypot(nx - x, -y), 1)
  // (The shooter reads the lane with the same odds the sim will resolve it
  // by — so he walks the line to open a lane instead of firing into shins.)
  for (const o of opps) {
    const s1 = ((o.x - x) * (nx - x) + (o.y - y) * -y) / L
    if (s1 < 3 || s1 > L - 5) continue
    const d = Math.abs(-(o.x - x) * (-y / L) + (o.y - y) * ((nx - x) / L))
    lane *= 1 - blockChance(o, d, false) * VAL.laneRead
  }
  // A man on him in tight will lift his stick.
  if (tight) for (const o of opps) if (Math.hypot(o.x - x, o.y - y) < 3.4) lane *= 0.6
  // Jammed in on top of the goalie (no deke, no rebound): he has the angle.
  if (L < 7) lane *= DEKE.tightShot
  // The shooter reads his chance against THIS goalie (the scale of a league's
  // ratings cancels out: a sniper vs an average goalie is the same edge in
  // any league).
  const raw = (c.player.ratings.technical.wristShot + c.player.composites.scoring) / 2
  const shooter = clamp(0.5 + (raw - (goalie?.player.composites.goaltending ?? raw + 4.5) + 4.5) / 60, 0, 1)
  // From distance, a shot through traffic is a PLAY: a teammate at the
  // net-front makes tips, screens and rebounds, and the puck stays in the
  // zone. That is why D shoot from the point.
  let tips = 0
  if (L > 32) for (const b of me.skaters) if (b !== c && Math.hypot(b.x - nx, b.y) < 14) tips++
  tips = Math.min(tips, 2)
  // From the point every teammate is BELOW the shot: they are first to the
  // rebound and the retrieval, so a point shot keeps the puck in the zone
  // far more often than a shot from the half-wall.
  let below = 0
  if (L > 45) for (const b of me.skaters) if (b !== c && (b.x - x) * a > 15) below++
  const turnover = (1 - lane) * 0.6 * posValue(x, y, -a)
  // A shot from a bad angle makes no play: the goalie steers it to the
  // corner, nobody can tip it. The rebound/tip value fades past ~45°.
  const angle = (Math.atan2(Math.abs(y), Math.max(Math.abs(nx - x), 0.1)) * 180) / Math.PI
  const play = clamp((VAL.angleZero - angle) / (VAL.angleZero - 40), 0, 1)
  return (
    xg * lane * (0.7 + shooter * 0.6) * eager * VAL.shoot +
    (VAL.keep + tips * VAL.tipKeep + (L > 45 ? VAL.pointKeep * (below / 4) : 0)) * VAL.oz * lane * play +
    tips * VAL.tip * lane * play -
    turnover
  )
}

/**
 * Dekes. `base` / `baseG` set the average success against a defender / the
 * goalie; `k` is how steeply skill decides it; `value` scales how attractive
 * a move is to the carrier (the frequency lever); `beatG` is the finish
 * multiplier on a goalie who bit.
 */
export const DEKE = { base: -2.8, baseG: -1.6, k: 7, lunge: 0.02, belief: 0.25, valueS: 1.1, valueG: 0.35, goalieRoom: 10, beatG: 1.6, minS: 0.4, maxS: 0.7, creaseRet: 0.45, tightShot: 0.6 }

/** The carrier's hands for a 1-on-1 move (0..1): stickhandling first, then feet and hockey sense. */
export function dekeSkill(c: Body): number {
  const t = c.player.ratings
  return 0.45 * r01(t.technical.stickhandling) + 0.25 * r01(c.player.composites.puckControl) + 0.15 * r01(t.physical.agility) + 0.15 * r01(t.mental.offensiveIQ)
}

/** Chance a deke beats `o` (a skater, or the goalie). */
export function dekeChance(c: Body, o: Body, goalie: boolean): number {
  const atk = dekeSkill(c)
  if (goalie) {
    const g = 0.6 * r01(o.player.ratings.goalie?.positioningG ?? o.player.composites.goaltending) + 0.4 * r01(o.player.ratings.mental.anticipation)
    return sigmoid((atk - g) * DEKE.k + DEKE.baseG)
  }
  const d = 0.25 * rDef(o.player.ratings.mental.positioning) + 0.2 * rDef(o.player.ratings.defensive.stickChecking) + 0.15 * r01(o.player.ratings.mental.defensiveIQ) + 0.4 * r01(o.player.composites.takeaway)
  // A defender who is lunging at you (closing fast) is easier to beat.
  const ux = (c.x - o.x) / Math.max(Math.hypot(c.x - o.x, c.y - o.y), 0.1)
  const uy = (c.y - o.y) / Math.max(Math.hypot(c.x - o.x, c.y - o.y), 0.1)
  const closing = (o.vx - c.vx) * ux + (o.vy - c.vy) * uy
  return sigmoid((atk - d) * DEKE.k + DEKE.base + clamp(closing - 6, 0, 10) * DEKE.lunge)
}

/** Shot blocking: per-body chance scale for a body square in the lane. */
export const SHOT_BLOCK = { base: 1.85 }

/** Chance a body `d` ft off the shot line (between shooter and net) blocks it. */
export function blockChance(o: Body, d: number, slap: boolean): number {
  const w = d < 2 ? 1 : d < 4 ? 0.5 : d < 6 ? 0.18 : 0
  if (w === 0) return 0
  return clamp(SHOT_BLOCK.base * w * (0.55 + rDef(o.player.ratings.defensive.shotBlocking) * 0.8) * (slap ? 1.1 : 1), 0, 0.9)
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
  // (A mate gliding at the line counts: he will be over it before the puck.)
  const offsideMate = adv < BLUE_X && me.skaters.some((b) => b !== c && b.x * a + Math.max(0, b.vx * a) * 0.5 > BLUE_X + 0.5)
  // He has to be able to STOP short of the line at his speed (a hockey stop
  // from 22 ft/s takes ~15 ft), so the cap moves back as he comes faster.
  const vIn = Math.max(0, c.vx * a)
  const capX = BLUE_X - 5 - (vIn * vIn) / (2 * c.caps.brake * 0.5)
  const lineCap = (x: number): number => (offsideMate && x * a > capX ? a * capX : x)

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
    opts.push({ ev: shotValue(me, opps, c, c.x, c.y, eager, true, opp.goalie), act: { kind: 'shoot' } })
  }

  // --- Carry (8 headings) ---
  {
    const toNet = adv > BLUE_X
    const baseAng = toNet ? Math.atan2(0 - c.y, a * GOAL_X - c.x) : Math.atan2(0, a)
    const angs = [0, 0.5, -0.5, 1.05, -1.05, 1.7, -1.7, Math.PI]
    const look = clamp(sp * 0.9 + 8, 10, 22)
    const puckSkill = r01(c.player.composites.puckControl)
    // In close (within 30 ft of their net) there is no dawdling: he keeps his
    // feet moving, and once he has had it there for INCLOSE.deadline seconds he
    // must shoot, deke, pass — or curl back out high with speed (the cycle),
    // never a slow circle in front of the goalie.
    const dNetC = Math.hypot(a * GOAL_X - c.x, c.y)
    const inClose = dNetC < INCLOSE.radius && !opp.pulled
    const heldClose = inClose && w.nearBy === c && w.nearSince >= 0 ? w.t - w.nearSince : 0
    const mustAct = heldClose > INCLOSE.deadline
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
      const qClose = Math.hypot(a * GOAL_X - qx, qy) < INCLOSE.radius
      if (mustAct && (protect || qClose)) continue
      let retEff = protect ? clamp(ret + 0.25 * puckSkill, 0, 0.97) : ret
      // Skating the puck into the crease is skating it into the goalie: he
      // pokes it or smothers it. In close you deke him or you shoot.
      if (!opp.pulled && Math.hypot(a * GOAL_X - qx, qy) < 9) retEff *= DEKE.creaseRet
      const v = posValue(qx, qy, a)
      const cost = posValue(qx, qy, -a)
      // Holding it in close costs a little more every moment (the box closes).
      const ev = retEff * v - (1 - retEff) * cost * 0.9 - (inClose && qClose ? INCLOSE.holdCost * heldClose : 0)
      const urg = me.tactics.tempo.pace * 0.4 + (adv < BLUE_X ? 0.55 : 0.35) + (pressure > 0.5 ? 0.2 : 0) + (inClose ? 0.3 : 0)
      opts.push({
        ev: ev + (protect ? -0.002 : 0),
        act: {
          kind: 'carry',
          protect,
          cmd: {
            tx: qx,
            ty: qy,
            // Protecting is skating AWAY with the body between, not standing on it.
            speed: protect ? c.caps.top * INCLOSE.protectSpeed : c.caps.top * clamp(0.55 + urg * 0.4, inClose ? INCLOSE.minSpeed : 0.55, 0.95),
            // Holding up at the line for a mate to tag up: stop short of it.
            arrive: offsideMate && qx * a >= capX - 1,
            urgency: inClose ? 1 : clamp(urg, 0.3, 1),
            // (Protecting = skating away from the pressure with the body between:
            // he faces where he is going, never backpedals with the puck.)
          }
        }
      })
    }
  }

  // --- Deke: a 1-on-1 move on the man in his path, or on the goalie. ---
  if (adv > -BLUE_X && !offsideMate && !opp.pulled) {
    const inZone = adv > BLUE_X
    const toX = inZone ? a * GOAL_X - c.x : a
    const toY = inZone ? -c.y : 0
    const toL = Math.max(Math.hypot(toX, toY), 0.1)
    let man: Body | null = null
    let md = Infinity
    for (const o of opps) {
      const dx = o.x - c.x
      const dy = o.y - c.y
      const d = Math.hypot(dx, dy)
      if (d > 13 || d < 2 || dx * a < 1) continue
      // In his lane: the man is between him and where he is going.
      if ((dx * toX + dy * toY) / (d * toL) < 0.6) continue
      if (d < md) {
        md = d
        man = o
      }
    }
    if (man && sp > 8) {
      const p = dekeChance(c, man, false)
      // Beat him and the ice behind him is his; lose it and they have it here.
      const side = c.y >= man.y ? 1 : -1
      const bx = clamp(man.x + a * 12, -GOAL_X + 2, GOAL_X - 4)
      const by = clamp(man.y + side * 7, -38, 38)
      // Players trust their hands: the READ of a move is braver than its odds
      // (more so for the ones with the hands), so dekes get tried and fail too.
      const pb = clamp(p + DEKE.belief * (0.5 + dekeSkill(c)), 0, 0.97)
      const ev = (pb * posValue(bx, by, a) - (1 - pb) * posValue(c.x, c.y, -a) * 0.9) * DEKE.valueS
      // The move fits the space: wide around a man who is inside him with
      // room on the outside; a toe drag on a man in stick reach; otherwise a
      // shoulder fake or the forehand-backhand.
      const roomOut = distToBoards(c.x, c.y) > 9
      const move: DekeKind =
        roomOut && Math.abs(man.y) < Math.abs(c.y) ? 'wide' : md < 6 ? 'toeDrag' : w.rng.next() < 0.5 ? 'shoulderFake' : 'forehandBackhand'
      opts.push({ ev, act: { kind: 'deke', on: man, goalie: false, move, p, dir: move === 'wide' ? (c.y >= 0 ? 1 : -1) : side } })
    }
    // The goalie: in close with nobody on him, or alone on a breakaway.
    const g = opp.goalie
    const dNet = Math.hypot(a * GOAL_X - c.x, c.y)
    let nearAny = Infinity
    for (const o of opps) nearAny = Math.min(nearAny, Math.hypot(o.x - c.x, o.y - c.y))
    if (inZone && dNet < 22 && dNet > 7 && Math.abs(c.y) < 20 && nearAny > DEKE.goalieRoom) {
      const p = dekeChance(c, g, true)
      // A goalie who bit is out of his net: the finish is from the doorstep.
      const xgIn = xgAt(a * (GOAL_X - 7), c.y >= 0 ? -3 : 3, a)
      const pb = clamp(p + DEKE.belief * (0.5 + dekeSkill(c)), 0, 0.97)
      const ev = (pb * xgIn * DEKE.beatG * VAL.shoot + (1 - pb) * 0.15 * VAL.oz) * DEKE.valueG
      const move: DekeKind = w.rng.next() < 0.6 ? 'forehandBackhand' : 'shoulderFake'
      opts.push({ ev, act: { kind: 'deke', on: g, goalie: true, move, p, dir: c.y >= 0 ? -1 : 1 } })
    }
  }

  // --- Pass ---
  {
    // A regroup (back to the D, D-to-D) is allowed anywhere short of their
    // blue line — when it is not the rush.
    const backOkBase = adv <= VAL.regroupMaxX
    const mates = me.skaters.filter((b) => b !== c)
    const infos = mates.map((r) => {
      const d0 = Math.hypot(r.x - c.x, r.y - c.y)
      const speed = clamp(38 + d0 * 0.6 + r01(c.player.ratings.technical.passing) * 10, 40, 88)
      const tf = d0 / speed
      const R = {
        x: clamp(r.x + r.vx * tf, -97, 97),
        y: clamp(r.y + r.vy * tf, -40, 40)
      }
      // Judged from the PUCK (on the blade, a stride ahead) and with a 10°
      // margin under the 110° line, so a "lateral" feed never reads as a back
      // pass on the scoresheet.
      const back = isBackFt(w.puck.x, w.puck.y, R.x, R.y, a, 0.176)
      const open = nearestTo(opps, R.x, R.y).d
      return { r, speed, R, back, open, d0 }
    })
    const hasForward = infos.some((f) => !f.back && f.open > 6)
    // Transition: we won it < 8 s ago and haven't set up in their zone yet —
    // the play goes forward (a back pass is only the pressured bail-out).
    // (Same test as the scorecard: won outside their zone, already moved ≥ 15
    // ft up ice — a D-to-D right after a retrieval is still allowed.)
    const transition = w.t - w.possSince < 8 && w.possStartAdv < BLUE_X && adv > w.possStartAdv + 12 && adv < VAL.transMaxX
    // In alone / numbers: nobody (or fewer of them) goal-side of the carrier.
    let goalSide = 0
    for (const o of opps) if (o.x * a > c.x * a) goalSide++
    const breakaway = goalSide === 0 && adv > -BLUE_X
    // Settled in their zone (not a rush), low-to-high to an open point man is
    // a real play (the scorecard's OZ back-pass band is 12–40%); on the rush
    // and in transition it is only the pressured bail-out.
    const settledOz = adv > BLUE_X && !transition
    // Past the red line on the rush there is no bail-out back pass at all:
    // a pressured carrier protects it, chips it in or takes the hit.
    const backOk = (backOkBase && !transition) || settledOz || (pressed && !hasForward && !breakaway && !(transition && adv > VAL.rushNoBackX))
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
      // A pass to a man who can SHOOT from where he takes it is worth his shot
      // (low-to-high to a point man with a screen in front, the seam feed).
      const radv = f.R.x * a
      if (radv > BLUE_X && radv < GOAL_X - 1 && !opp.pulled) v = Math.max(v, shotValue(me, opps, f.r, f.R.x, f.R.y, eager, false, opp.goalie) * VAL.passShot)
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
      if (f.back) ev -= transition ? VAL.transBack : adv > BLUE_X ? VAL.ozBack : 0.003
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

  // Nothing left (in close past his deadline, behind the net): curl out high.
  if (opts.length === 0) {
    return { kind: 'carry', protect: false, cmd: { tx: a * 50, ty: clamp(c.y * 0.6, -30, 30), speed: c.caps.top * 0.9, arrive: false, urgency: 0.9 } }
  }
  // Decision quality: good readers take the best option nearly every time.
  const T = (0.0004 + (1 - reading) * 0.0022 + pressure * 0.0012 * (1 - r01(m.composure))) * VAL.noise
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
  const n = me.skaters.length
  const m = opp.skaters.length
  if (withPuck) {
    if (me.powerPlay && px > BLUE_X) return n - m >= 2 ? PP_5V3 : powerPlay(me.tactics.specialTeams.powerPlay)
    if (px < -BLUE_X) return BREAKOUT
    if (px < BLUE_X) return TRANSITION
    if (w.t - me.entryAt < RUSH_WINDOW) return RUSH
    // 4-on-4: more ice — two D up top, two forwards working low and the slot.
    if (n === 4 && m === 4) return FOUR_ATTACK
    return px < 55 ? CYCLE_POINT : CYCLE
  }
  if (me.shorthanded && px < -10) return n <= 3 ? PK_TRIANGLE : penaltyKill(me.tactics.specialTeams.penaltyKill)
  if (px > BLUE_X) return forecheck(me.tactics.forecheck)
  if (px > -BLUE_X) return NZ_DEFENSE
  // 4-on-4 in our end: a tight box.
  if (n === 4 && m === 4) return FOUR_DEFEND
  return DZ_ZONE
}

/** Assign roles greedily in priority order, with hysteresis on current roles. */
function assignRoles(me: Side, pool: Body[], table: RoleSpot[], targets: Map<string, XY>): Map<Body, RoleSpot> {
  const out = new Map<Body, RoleSpot>()
  const free = new Set(pool)
  // Fewer men than roles (4-on-4, a shorthanded rush, the carrier is a D):
  // drop FORWARD roles first. The D roles are the safety valve — a table cut
  // from the end would otherwise send a defenceman to the net-front and
  // leave nobody back.
  let used = table
  if (pool.length < table.length) {
    const nD = pool.filter((b) => b.player.position === 'D').length
    let keepD = Math.min(nD, table.filter((s) => s.pos === 'D').length)
    let keepOther = pool.length - keepD
    used = table.filter((s) => {
      if (s.pos === 'D' && keepD > 0) {
        keepD--
        return true
      }
      if (s.pos !== 'D' && keepOther > 0) {
        keepOther--
        return true
      }
      return false
    })
  }
  for (const spot of used) {
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
  const pos = rDef(b.player.ratings.mental.positioning)
  const ph = b.mass * 0.37
  // Hockey players never stand still: support skaters keep their feet moving
  // in loops around their spot (getting open, timing their route), defenders
  // shuffle and re-set. Weaker positional players also wander off the spot.
  const R = withPuck ? DRIFT.rAtk : DRIFT.rDef
  const om = withPuck ? DRIFT.omAtk : DRIFT.omDef
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

  // The D safety line (x in OUR attack frame): goal-side of every attacker's
  // projected position, with a gap that grows with his speed toward our net.
  let safety = Infinity
  // (Also while the puck is loose outside their zone — not a pass of ours in
  // flight, not a rebound they must keep in: a D does not leave the goal side for a
  // puck nobody has yet — the other team may get to it first.)
  const guard = !shapeWithPuck || (loose && (D_SAFETY.looseGuard === 1 || (D_SAFETY.looseGuard === 2 && w.passTo === null && puck.x * a < BLUE_X)))
  if (guard) {
    for (const o of opp.skaters) {
      const ox = o.x * a
      const vIn = Math.min(0, o.vx * a)
      safety = Math.min(safety, ox + vIn * D_SAFETY.look - (D_SAFETY.gap - vIn * D_SAFETY.gapPerV))
    }
    // A chip or rim coming up the ice: the D meet it from the goal side
    // (facing it), never chase it from behind with a winger on their heels.
    const pIn = Math.min(0, puck.vx * a)
    if (loose && pIn < -8) safety = Math.min(safety, puck.x * a + pIn * D_SAFETY.look * 0.5 - D_SAFETY.gap)
  }

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
    // A defenceman steps up for a loose puck above the safety line only when
    // he wins it clearly; otherwise the chip gets by him and he's beaten.
    // (Their fastest man's intercept is the race he'd lose.)
    let theirBest = Infinity
    if (!shapeWithPuck || loose) for (const o of opp.skaters) theirBest = Math.min(theirBest, intercept(o).t)
    const mayChase = (b: Body): boolean => {
      if (b.player.position !== 'D' || !guard) return true
      const ip = icpt.get(b)!
      if (ip.p.x * a <= safety) return true
      return ip.t + D_SAFETY.stepUpMargin < theirBest
    }
    if (w.passTo && sorted.includes(w.passTo)) {
      // The intended receiver meets the pass.
      chasers.add(w.passTo)
    } else {
      const first = sorted.find(mayChase)
      if (first) chasers.add(first)
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
      // A D may pinch down the wall to the top of the circles, never below
      // it (a D chasing into their corner leaves nobody back).
      if (b.player.position === 'D' && carrier.x * a > 10) tt += 0.7
      if (b.player.position === 'D' && carrier.x * a > D_SAFETY.pinchMaxX && pool.some((q) => q.player.position !== 'D' && !chasers.has(q))) continue
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
        // Hold the gap on where he is GOING (his speed carries him half a
        // second on while you react), and only read him backward while you
        // can still match his speed that way — a carrier coming faster than a
        // D can backpedal is met by a D who has pivoted and is skating.
        const lead = D_SAFETY.gapLead
        const backOk = csp < presser.caps.topBack * 0.85
        cmds.set(presser, {
          tx: cx + carrier.vx * lead + ux * gap,
          ty: (cy + carrier.vy * lead) * 0.8 + uy * gap,
          speed: presser.caps.top,
          arrive: true,
          urgency: 1,
          ...((Math.hypot(presser.x - cx, presser.y - cy) > 16 && backOk) || csp < 10 ? { faceX: cx, faceY: cy } : {})
        })
      } else {
        // On the puck: take the inside (between him and the net). CONTAIN at a
        // stick-and-a-half gap, and only close to engage when the carrier is
        // vulnerable — pinned on the wall, slow, or turned away from our net
        // (the moment to strip him or finish him).
        const onWall = distToBoards(cx, cy) < 5
        const csp = speedOf(carrier)
        const turnedAway = carrier.hx * ux + carrier.hy * uy < -0.2
        // Inside the house (near our net) there is no containing: the man on
        // the puck closes and takes the body/stick before the carrier can
        // walk in or circle the net for seconds.
        const inHouse = Math.hypot(ownNetX - cx, cy) < DZ.engageFt
        const vulnerable = onWall || csp < 7 || turnedAway || inHouse
        // A carrier standing still gets no respect: the man on him steps INTO
        // him (body and stick) instead of waiting a stick-length away.
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
    // Man-on-man still keeps a man home: whoever holds the net-front/slot
    // role stays in it, and nobody is dragged out to shadow a point man at the
    // blue line (the winger's zone spot covers his lane) — otherwise the
    // house empties and the other team walks in.
    const freeD = new Set(rest.filter((b) => roles.get(b)?.role !== 'D_NET' && roles.get(b)?.role !== 'B4_LOW_W'))
    const reach = me.tactics.dZoneCoverage === 'hybrid' ? 30 : 42
    for (const th of threats) {
      if (Math.hypot(th.o.x - ownNetX, th.o.y) > reach) continue
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
    } else if (!shapeWithPuck && (spot.role === 'D_NET' || spot.role === 'PK_NET' || spot.role === 'PK_LOW_W' || spot.role === 'PK3_LOW_W' || spot.role === 'B4_LOW_W' || spot.role === 'OT_SLOT') && netFront) {
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
      // A point man walks the LINE (lateral drift), holding the blue line
      // from inside the zone: he is the outlet and the shooter up top.
      const onPoint = shapeWithPuck && inZone && b.player.position === 'D' && t.x * a < 45
      t = { x: t.x + (onPoint ? 0 : dr.x), y: t.y + dr.y }
      if (onPoint && t.x * a < BLUE_X + 3) t = { x: a * (BLUE_X + 3), y: t.y }
      // Late to the line after the entry: get up there (the puck can come back).
      if (onPoint && b.x * a < BLUE_X + 2) urgency = Math.max(urgency, 0.95)
    }
    // Delayed offside against us: everyone in the zone skates out to tag up.
    if (w.delayedOffside === me && b.x * a > BLUE_X - 1) {
      t = { x: a * (BLUE_X - 4), y: b.y }
      urgency = 1
    }
    // Onside discipline: while the puck is outside the zone, attackers stay
    // (or get back) onside — the tag-up.
    if (shapeWithPuck && !inZone && t.x * a > BLUE_X - 3) t = { x: a * (BLUE_X - 4), y: t.y }
    if (shapeWithPuck && !inZone && b.x * a + Math.max(0, b.vx * a) * 0.6 > BLUE_X - 1) urgency = Math.max(urgency, 0.95)
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
    if (shapeWithPuck && !inZone && t.x * a > BLUE_X - 3) t = { x: a * (BLUE_X - 4), y: t.y }
    // Defenders read the play facing the puck in their own half — but when a
    // carrier is coming with speed they pivot and skate (backward is slow).
    const rushing = theyHaveIt && carrier !== null && speedOf(carrier) > 15 && Math.hypot(carrier.x - b.x, carrier.y - b.y) < 40
    if (!shapeWithPuck && faceX === undefined && puck.x * a < 0 && !rushing) {
      faceX = puck.x
      faceY = puck.y
    }
    // D never let a man behind them: when they have it (or it's loose off
    // their stick), a defenceman stays goal-side of their deepest attacker —
    // where that attacker WILL be, not where he is. A D who waits for the
    // winger to go by is beaten wide along the wall; he reads the breakout
    // and starts back as it starts.
    if (guard && b.player.position === 'D' && !mk && safety < Infinity) {
      if (t.x * a > safety) {
        const back = t.x * a - safety
        t = { x: a * Math.max(safety, -84), y: t.y }
        if (back > 8) urgency = Math.max(urgency, 0.95)
      }
    }
    // Caught up ice when they have it: BACKCHECK — sprint back goal-side.
    let backcheck = false
    if (theyHaveIt && carrier && (b.x - carrier.x) * a > 6) {
      backcheck = true
      urgency = 1
    }
    // Any stick within reach of their puck can go for it.
    // (A second stick joins in on a carrier who is standing still.)
    if (theyHaveIt && carrier && speedOf(carrier) < 7 && Math.hypot(b.x - puck.x, b.y - puck.y) < REACH && out.pokes.length < 2) out.pokes.push(b)
    const h = boardsClamp(t.x, t.y, 2)
    const dist = Math.hypot(h.x - b.x, h.y - b.y)
    // Far from the spot → skate; close → drift calmly into it.
    const speed = b.caps.top * (backcheck ? 0.97 : clamp(0.5 + urgency * 0.5 + dist / 120, 0.4, 0.96))
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
