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
 *               picks the open ice around it with a lane from the carrier.
 *   defence   — one presser (forecheck F1 / DZ on-puck / NZ gap-control D),
 *               everyone else in a role of the system's shape, covering the
 *               attacker in his area (zone) or his man (man coverage) —
 *               each attacker claimed by one man — the lane man steps into
 *               shooting lanes, loose pucks are raced.
 *
 * W3 S1: roles and jobs persist between triggers (plans.ts); the 0.25 s think
 * checks the triggers and executes the jobs.
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
import { PLAN, planOf, setJob, type JobKind, type Plan } from './plans'
import { ACTION_FLOOR } from './constraints'
import { pathAt, pathZ, predictPuck, type PuckPath } from './puckPath'
import {
  BREAKOUT_OUTLET,
  BREAKOUT_TABLES,
  DZ_GAP,
  DZ_TABLES,
  FORECHECK_CAP,
  MAN_COVER,
  SYSTEM_TILT,
  TRANSITION_STRETCH,
  breakoutShape,
  dZoneShape,
  forecheckShape,
  pickBreakout,
  transitionShape,
  S4_DEV
} from './systems'
import type { BreakoutPlan } from '@engine/league/coachProfile'
import { IN_TIGHT, PP_PATIENCE, S5_DEV, carrierTilt, tilted } from './carrierTilt'

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
// W3 S5: VAL.shoot 0.66 -> 0.43 (the one scalar this slice changes; see W3-LOG S5).
// W3 S6: VAL.shoot 0.43 -> 0.35, compensates for the S6 puck keeping possessions
// alive: the swept pickup check (a puck through a man's reach between two
// substeps is his to try) and the lively boards (rims keep their pace) took the
// coach-systems run to 34.1 shots and 3.56 goals a team-game (see W3-LOG S6).
// Compensates for the S5 carrier no longer burning his possessions in ping-pong
// and for rushes that now attack the net (+3.6 shots, +0.45 goals a team-game on
// the coach-systems run), on top of the coach systems' own excess found in S4
// (3.49). The carrier values his own finish lower, so he passes up the
// marginal chance in the slot and keeps the puck.
export const VAL = { keepRoute: 3, minCarry: 4, oneTimerV: 1.8, otMinX: 50, otMinY: 14, otMaxY: 32, nzBack: 0.0015, carryKeep: 0.004, oz: 0.11, kPos: 0.15, shoot: 0.35, keep: 0.18, noise: 0.5, nz: 0.009, nzExp: 1, passShot: 0.5, tip: 0.012, tipKeep: 0.3, pointKeep: 1.2, laneRead: 0.95, angleZero: 90, behindNet: 0.85, transMaxX: 70, transBack: 0.003, rushNoBackX: 0, regroupMaxX: 20, ozBack: 0.008 }
/**
 * D safety (gap discipline): how far ahead a defenceman reads an attacker
 * coming at him (s), the base gap (ft) plus gap per ft/s of the attacker's
 * speed toward our net, and the margin (s) by which a D must win a loose-puck
 * race above the safety line before he steps up for it.
 */
export const D_SAFETY = { look: 2, gap: 12, gapPerV: 0.5, stepUpMargin: 1.3, pinchMaxX: 55, gapLead: 0.5, looseGuard: 1 }
/** Shape tuning: where the breakout hands over to the neutral-zone lanes (x in the attack frame), and the target-smoothing time constant (s). */
export const SHAPE_TUNING = { breakoutX: -25, smooth: 0.45 }
/**
 * In close: the radius (ft) around their net where a carrier may not dawdle,
 * the seconds he may hold it there before he must act, the per-second cost of
 * holding, and his minimum carry speed there (share of top speed).
 */
export const INCLOSE = { radius: IN_TIGHT.radiusFt, deadline: IN_TIGHT.capS, holdCost: 0.02, minSpeed: 0.8, protectSpeed: 0.72 }
/**
 * W3 S5, the carrier's pass has to GAIN something (owner: "pass ping-pong").
 * A pass gains if it moves the puck `gainFt` toward their net, or puts it on a
 * stick where it is worth `valueGain` more than on his own (a shot, the seam),
 * or gets it to a man `openGainFt` more open than he is, or bails him out of
 * real pressure. A pass that gains none of these costs `noGainK` of what it is
 * worth; handing it straight back to the man who fed him (within `backS`) and
 * gaining nothing costs `pingBackK` more. The carrier still makes the pass when
 * it is clearly his best play; the sideways give-and-take with nothing in it
 * goes.
 */
export const PROGRESS = { gainFt: 10, valueGain: 0.08, openGainFt: 6, reliefPressure: 0.55, noGainK: 0, pingBackK: 0.6, backS: 4 }
/**
 * W3 S5, rushes (owner: "breakaway skated into the corner"). On a breakaway
 * (nobody goal-side) and an odd-man rush the carrier attacks the net: his
 * carry headings aim at the slot from the red line on, each worth `netK` of the
 * chance waiting where it ends; a destination below the dots out wide
 * (`cornerAdv`, `cornerY`) or behind the goal line costs `cornerCost` (and on a
 * breakaway is not a carry at all); the move on the goalie is open to him with
 * a chaser behind (not goal-side) and is worth `dekeK` more; inside `finishFt`
 * of the net on a breakaway he finishes (shoot or deke) rather than skating on.
 */
export const RUSH_PLAY = { slotFt: 24, netK: 0.6, oddNetK: 0.25, cornerCost: 0.03, cornerY: 22, cornerAdv: 69, dekeK: 1.5, finishFt: 24, window: 4.5, trailFt: 15, finishK: 0.43 / 0.35 }
// W3 S6: RUSH_PLAY.finishK = 0.43 / 0.35 keeps the S5 value of the finish on a
// breakaway (shot, move, the carry toward the chance) while VAL.shoot 0.43 -> 0.35
// trims the marginal in-zone shot: it compensates for that cut, so the S5
// breakaway play is unchanged (W3-LOG S6).
/** Defending the house: the on-puck man engages (no containing) inside this radius of our net (ft). */
export const DZ = { engageFt: 30 }
/** Seconds after a zone entry that play is still a "rush". */
const RUSH_WINDOW = 4.5
/** Stick reach from the body centre, ft. */
export const REACH = 5

/**
 * W3 S6: the loose puck. `atFeetS`: a man whose intercept on the puck's path
 * is this close in time has it at his feet and plays it (ahead of the claim
 * and the D safety line) when the claimed man is `atFeetMargin` s later.
 */
export const PUCK_PLAY = { atFeetS: 0.3, atFeetMargin: 0.5 }
/** W3 S6 dev switches (measurement only; all on in play). */
export const S6_DEV = { path: true, atFeet: true, bodies: true, swept: true, rebound: true, misses: true, goalieRead: true }

/**
 * W3 S6: the man who wins the race to a free puck by the predicted path (the
 * earliest intercept, stick reach included, over every skater offered), for
 * the race-won metric.
 */
export function raceLeader(w: World, bodies: readonly Body[]): { b: Body; t: number } | null {
  const pp = sharedPath(w)
  let best: { b: Body; t: number } | null = null
  for (const b of bodies) {
    let tb = Infinity
    for (let t = 0; t <= 2.4; t += 0.15) {
      if (pathZ(pp, t) > 3) continue
      const p = boardsClamp(pathAt(pp, t).x, pathAt(pp, t).y, 1.5)
      if (stickTime(b, p.x, p.y) <= t) {
        tb = t
        break
      }
    }
    if (tb === Infinity) {
      const p = pathAt(pp, 2.4)
      tb = 2.4 + reachTime(b, p.x, p.y)
    }
    if (!best || tb < best.t) best = { b, t: tb }
  }
  return best
}

/**
 * W3 S6: seconds for a body to get his stick (REACH) on point (x, y): his
 * skating time to the nearest point of the reach circle round it, so a man
 * already within reach is there now (the S5 form, reachTime - REACH/top, sent a
 * man standing 4 ft from the puck on a 0.5 s "race").
 */
export function stickTime(b: Body, x: number, y: number): number {
  const d = Math.hypot(x - b.x, y - b.y)
  if (d <= REACH) return 0
  const k = (d - REACH) / d
  return reachTime(b, b.x + (x - b.x) * k, b.y + (y - b.y) * k)
}

/** One predicted path per world tick (both sides think on the same puck). */
const pathCache = new WeakMap<World, { t: number; x: number; y: number; vx: number; vy: number; p: PuckPath }>()
export function sharedPath(w: World): PuckPath {
  const pk = w.puck
  const c = pathCache.get(w)
  if (c && c.t === w.t && c.x === pk.x && c.y === pk.y && c.vx === pk.vx && c.vy === pk.vy) return c.p
  const p = predictPuck(pk)
  pathCache.set(w, { t: w.t, x: pk.x, y: pk.y, vx: pk.vx, vy: pk.vy, p })
  return p
}

// ---------------------------------------------------------------------------
// Value model
// ---------------------------------------------------------------------------

export function xgAt(x: number, y: number, a: number): number {
  // The shared xG surface folds |dx|: a puck BEHIND the goal line read as the
  // mirror spot in front of it (6 ft behind the net = 6 ft in the slot). No
  // angle there (W3 S3).
  if (x * a > GOAL_X - 0.5) return 0.002
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
export const DEKE = { base: -2.8, baseG: -1.6, k: 7, lunge: 0.02, belief: 0.25, valueS: 1.1, valueG: 0.35, goalieRoom: 10, beatG: 1.6, minS: ACTION_FLOOR.stick.deke.min, maxS: ACTION_FLOOR.stick.deke.max, creaseRet: 0.6, tightShot: 0.85 }

/** The carrier's hands for a 1-on-1 move (0..1): stickhandling first, then feet and hockey sense. */
export function dekeSkill(c: Body): number {
  const t = c.player.ratings
  return 0.45 * r01(t.technical.stickhandling) + 0.25 * r01(c.player.composites.puckControl) + 0.15 * r01(t.physical.agility) + 0.15 * r01(t.mental.offensiveIQ)
}

/** Chance a deke beats `o` (a skater, or the goalie). */
/** A goalie's read of a deke (0..1): positioning and anticipation. */
export function dekeGoalieRead(o: Body): number {
  return 0.6 * r01(o.player.ratings.goalie?.positioningG ?? o.player.composites.goaltending) + 0.4 * r01(o.player.ratings.mental.anticipation)
}

/** A defender's read of a deke (0..1): positioning, stick, hockey sense, takeaway. */
export function dekeDefRead(o: Body): number {
  return 0.2 * rDef(o.player.ratings.mental.positioning) + 0.1 * rDef(o.player.ratings.defensive.stickChecking) + 0.1 * r01(o.player.ratings.mental.defensiveIQ) + 0.6 * r01(o.player.composites.takeaway)
}

/**
 * Tonight's average deke hands / defender read / goalie read (set per period
 * by the sim). A deke is decided by how much better the carrier's hands are
 * than THIS game's average, against how much better the defender's read is
 * than its average — so a league whose rating families sit at different
 * levels (the imported data vs the generated league) dekes the same way.
 * DEKE_REF holds the NHL (imported) gaps between the families.
 */
export const DEKE_LEVEL = { atk: 0.694, def: 0.626, goalie: 0.656 }
const DEKE_REF = { def: 0.694 - 0.626, goalie: 0.694 - 0.656 }

export function dekeChance(c: Body, o: Body, goalie: boolean): number {
  const atk = dekeSkill(c) - DEKE_LEVEL.atk
  if (goalie) {
    const g = dekeGoalieRead(o) - DEKE_LEVEL.goalie
    return sigmoid((atk - g + DEKE_REF.goalie) * DEKE.k + DEKE.baseG)
  }
  const d = dekeDefRead(o) - DEKE_LEVEL.def - DEKE_REF.def
  // A defender who is lunging at you (closing fast) is easier to beat.
  const ux = (c.x - o.x) / Math.max(Math.hypot(c.x - o.x, c.y - o.y), 0.1)
  const uy = (c.y - o.y) / Math.max(Math.hypot(c.x - o.x, c.y - o.y), 0.1)
  const closing = (o.vx - c.vx) * ux + (o.vy - c.vy) * uy
  return sigmoid((atk - d) * DEKE.k + DEKE.base + clamp(closing - 6, 0, 10) * DEKE.lunge)
}

/** Shot blocking: per-body chance scale for a body square in the lane. */
export const SHOT_BLOCK = { base: 1.5 }

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
  // W3 S4: the play his system calls (systems.ts): in our zone the breakout
  // this possession runs, in the neutral zone the regroup / stretch.
  const table = me.team.table
  const bo: BreakoutPlan | null = S4_DEV.tilts && table && BREAKOUT_TABLES.has(table) && adv < -BLUE_X ? (me.team.breakout?.plan ?? null) : null
  const outlet = bo ? BREAKOUT_OUTLET[bo] : null
  const stretchTable = S4_DEV.tilts && table === TRANSITION_STRETCH
  const pb = me.playbook
  const entryK = !S4_DEV.tilts ? 1 : pb.entry === 'dump' ? SYSTEM_TILT.entryDump : pb.entry === 'carry' ? SYSTEM_TILT.entryCarry : 1
  // W3 S5: the situation tilt (score and time, PP/PK, pressure, zone: carrierTilt.ts)
  const tilt = carrierTilt({ lead: me.sim.goals - opp.sim.goals, progress: w.progress, powerPlay: me.powerPlay, shorthanded: me.shorthanded, pressure, adv }, pb)
  // W3 S5: the rush read. A breakaway: nobody of theirs goal-side of him past
  // the red line. An odd-man rush: more of us in on it than them back, on the
  // way in or just in.
  // (goal-side: nearer their net than he is - by x alone, a man cycling in the
  // corner below their D read as "alone")
  let goalSideN = 0
  for (const o of opps) if (o.x * a > c.x * a) goalSideN++
  const dNetMe = Math.hypot(a * GOAL_X - c.x, c.y)
  let netSideN = 0
  for (const o of opps) if (Math.hypot(a * GOAL_X - o.x, o.y) < dNetMe + 2) netSideN++
  let inOnIt = 1
  for (const b of me.skaters) if (b !== c && b.x * a >= adv - RUSH_PLAY.trailFt && b.x * a > 0) inOnIt++
  // a rush: from the red line to the top of their circles, coming in (not a set play in their zone)
  const live = S5_DEV.rush && !opp.pulled && !me.powerPlay && adv > -10 && adv < GOAL_X - 4 && c.vx * a > 4
  const breakaway = live && netSideN === 0 && goalSideN === 0
  const oddMan = live && !breakaway && adv < GOAL_X - RUSH_PLAY.slotFt && netSideN <= 2 && inOnIt > netSideN && (adv < BLUE_X || w.t - me.entryAt < RUSH_PLAY.window)
  const inCorner = (x: number, y: number): boolean => (x * a > RUSH_PLAY.cornerAdv && Math.abs(y) > RUSH_PLAY.cornerY) || x * a > GOAL_X - 2

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
    // (the power play's patience: the weight follows the quality of the chance)
    const patience = me.powerPlay && S5_DEV.tilt ? clamp(xgAt(c.x, c.y, a) / PP_PATIENCE.xgRef, PP_PATIENCE.lo, PP_PATIENCE.hi) : 1
    opts.push({ ev: tilted(shotValue(me, opps, c, c.x, c.y, eager, true, opp.goalie) * (breakaway ? RUSH_PLAY.finishK : 1), tilt.shoot * patience), act: { kind: 'shoot' } })
  }

  // --- Carry (8 headings) ---
  {
    // (W3 S5: on a rush he goes at the net from the red line on, not up his own lane into the corner)
    const toNet = adv > BLUE_X || breakaway || oddMan
    // (alone, he cuts to the middle: his line is at the slot, not the post he is wide of)
    const aimX = breakaway && adv < GOAL_X - RUSH_PLAY.slotFt ? a * (GOAL_X - RUSH_PLAY.slotFt) : a * GOAL_X
    const aimY = breakaway ? clamp(c.y * 0.25, -6, 6) : 0
    const baseAng = toNet ? Math.atan2(aimY - c.y, aimX - c.x) : Math.atan2(0, a)
    const angs = breakaway ? [0, 0.3, -0.3, 0.6, -0.6] : [0, 0.5, -0.5, 1.05, -1.05, 1.7, -1.7, Math.PI]
    const netK = breakaway ? RUSH_PLAY.netK : oddMan ? RUSH_PLAY.oddNetK : 0
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
      // A heading the boards or the line cut to nothing is no carry at all
      // (it would be a man standing on the wall with the puck).
      if (Math.hypot(qx - c.x, qy - c.y) < VAL.minCarry) continue
      const tc = Math.hypot(qx - c.x, qy - c.y) / Math.max(sp * 0.5 + c.caps.top * 0.45, 10)
      const ret = retention(c, { x: qx, y: qy }, tc, opps)
      const protect = da === Math.PI
      const qClose = Math.hypot(a * GOAL_X - qx, qy) < INCLOSE.radius
      const qCorner = inCorner(qx, qy)
      // Past the in-tight cap he shoots, passes or WALKS OUT: away from the
      // net by a stride, never behind the goal line (W3 S5: it used to be any
      // spot 30 ft out, and from below the dots that was the far corner).
      const dq = Math.hypot(a * GOAL_X - qx, qy)
      if (mustAct && (S5_DEV.walkOut ? protect || (qClose && dq < dNetC + IN_TIGHT.walkOutFt) || qx * a > GOAL_X - 2 || (qCorner && dq < dNetC + IN_TIGHT.walkOutFt) : protect || qClose)) continue
      // A breakaway is not taken to the corner, and inside the finish range he
      // shoots or makes his move on the goalie rather than skating on (W3 S5).
      if (breakaway && (qCorner || dNetC < RUSH_PLAY.finishFt)) continue
      // ... and he never drifts wider on one: every stride is toward the middle
      if (breakaway && Math.abs(c.y) > 8 && Math.abs(qy) > Math.abs(c.y) + 1) continue
      let retEff = protect ? clamp(ret + 0.25 * puckSkill, 0, 0.97) : ret
      // Skating the puck into the crease is skating it into the goalie: he
      // pokes it or smothers it. In close you deke him or you shoot.
      if (!opp.pulled && Math.hypot(a * GOAL_X - qx, qy) < 9) retEff *= DEKE.creaseRet
      // (on a rush the chance waiting at the end of the carry is part of its
      // value - read at the finishing range, so it rewards the lane to the
      // middle, not skating the puck into the goalie)
      let rushV = 0
      if (netK > 0 && !qCorner) {
        const k = dq < RUSH_PLAY.finishFt ? RUSH_PLAY.finishFt / Math.max(dq, 0.5) : 1
        rushV = netK * xgAt(a * GOAL_X - (a * GOAL_X - qx) * k, qy * k, a) * VAL.shoot * (breakaway ? RUSH_PLAY.finishK : 1)
      }
      const v = posValue(qx, qy, a) + rushV
      const cost = posValue(qx, qy, -a)
      // Holding it in close costs a little more every moment (the box closes).
      let ev = retEff * v - (1 - retEff) * cost * 0.9 * tilt.risk - (inClose && qClose ? INCLOSE.holdCost * heldClose : 0)
      ev = tilted(ev, protect ? tilt.protect : tilt.carry) - (oddMan && qCorner ? RUSH_PLAY.cornerCost : 0)
      const urg = me.tactics.tempo.pace * 0.4 + (adv < BLUE_X ? 0.55 : 0.35) + (pressure > 0.5 ? 0.2 : 0) + (inClose ? 0.3 : 0)
      // Momentum: a man skating with it keeps going the way he is going
      // (a new heading every look is a man who never gets up to speed).
      const keep = sp > 4 ? VAL.carryKeep * Math.max(0, ((qx - c.x) * c.vx + (qy - c.y) * c.vy) / (Math.hypot(qx - c.x, qy - c.y) * sp + 1e-6)) : 0
      // the wheel: the D skates it round the net and up out of our end
      const wheel = bo === 'wheel' && c.player.position === 'D' && (qx - c.x) * a > 3 ? SYSTEM_TILT.wheelCarry : 0
      opts.push({
        ev: ev + keep + wheel + (protect ? -0.002 : 0),
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
      const ev = tilted((pb * posValue(bx, by, a) - (1 - pb) * posValue(c.x, c.y, -a) * 0.9 * tilt.risk) * DEKE.valueS, tilt.deke)
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
    // (W3 S5: alone with a chaser behind him - nobody goal-side - the move is still on)
    if (inZone && dNet < 22 && dNet > 7 && Math.abs(c.y) < 20 && (nearAny > DEKE.goalieRoom || breakaway)) {
      const p = dekeChance(c, g, true)
      // A goalie who bit is out of his net: the finish is from the doorstep.
      const xgIn = xgAt(a * (GOAL_X - 7), c.y >= 0 ? -3 : 3, a)
      const pb = clamp(p + DEKE.belief * (0.5 + dekeSkill(c)), 0, 0.97)
      const ev = tilted((pb * xgIn * DEKE.beatG * VAL.shoot * (breakaway ? RUSH_PLAY.finishK : 1) + (1 - pb) * 0.15 * VAL.oz) * DEKE.valueG * (breakaway ? RUSH_PLAY.dekeK : 1), tilt.deke)
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
    // W3 S5: what the puck is worth on HIS stick (the bar a pass has to clear) and how open he is
    const curV = adv > BLUE_X && adv < GOAL_X - 1 && !opp.pulled ? Math.max(cur, shotValue(me, opps, c, c.x, c.y, eager, false, opp.goalie) * VAL.passShot) : cur
    const myOpen = nearestTo(opps, c.x, c.y).d
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
    const alone = goalSideN === 0 && adv > -BLUE_X
    // Settled in their zone (not a rush), low-to-high to an open point man is
    // a real play (the scorecard's OZ back-pass band is 12–40%); on the rush
    // and in transition it is only the pressured bail-out.
    const settledOz = adv > BLUE_X && !transition
    // Past the red line on the rush there is no bail-out back pass at all:
    // a pressured carrier protects it, chips it in or takes the hit.
    const backOk = (backOkBase && !transition) || settledOz || (pressed && !hasForward && !alone && !(transition && adv > VAL.rushNoBackX))
    for (const f of infos) {
      if (f.back && !backOk) continue
      // On a breakaway only a clearly forward pass (the 2-on-0 feed) is a play.
      if (alone && (f.R.x - c.x) * a < 4) continue
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
        f.R.x * a > VAL.otMinX && Math.abs(f.R.y) >= VAL.otMinY && Math.abs(f.R.y) < VAL.otMaxY && Math.sign(f.R.y || 1) !== Math.sign(c.y || 1) && Math.abs(c.y) > 8
      const oneTimer = royal && f.open > 7
      if (oneTimer) v *= VAL.oneTimerV * tilt.seam
      // W3 S5: does this pass GAIN anything (PROGRESS)? Territory, a better
      // stick for the puck to be on, a man more open than he is while he is
      // being closed down, or the bail-out under real pressure.
      const gains =
        !S5_DEV.progress ||
        (f.R.x - c.x) * a >= PROGRESS.gainFt ||
        v >= curV * (1 + PROGRESS.valueGain) + 0.001 ||
        (myOpen < 12 && f.open - myOpen >= PROGRESS.openGainFt) ||
        (pressure >= PROGRESS.reliefPressure && f.open > 10) ||
        oneTimer
      // Open ice at the receiver is worth more (time to make the next play).
      // A covered man (a defender on his hip) is not really open: he'll be
      // tied up or stripped before he can do anything with it.
      v *= clamp(f.open / 11, 0.2, 1.2)
      const cost = posValue(f.R.x, f.R.y, -a)
      let ev = comp * v - (1 - comp) * cost * 0.8 * tilt.risk
      if (!gains) {
        ev -= PROGRESS.noGainK * tilt.progress * Math.max(v, 0)
        // straight back to the man who just gave it to him: the ping-pong
        if (w.fedBy && w.fedBy.b === f.r && w.t - w.fedBy.t < PROGRESS.backS) ev -= PROGRESS.pingBackK * tilt.progress * Math.max(v, 0)
      }
      ev = tilted(ev, tilt.pass)
      if (f.back) ev -= transition ? VAL.transBack : adv > BLUE_X ? VAL.ozBack : VAL.nzBack
      // W3 S4: the system's play — the breakout's outlet, the stretch man
      const role = me.roles.get(f.r)
      if (outlet !== null && role === outlet) ev += SYSTEM_TILT.outlet
      if (stretchTable && role === 'LANE_WEAK') ev += SYSTEM_TILT.stretch
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
      // (W3 S4: the system's entry style and its dump-and-change regroup)
      const sysK = entryK * (S4_DEV.tilts && pb.regroup === 'dumpChange' ? SYSTEM_TILT.dumpChange : 1)
      opts.push({ ev: tilted(ev * (0.8 + dumping * 0.4) * (ev > 0 ? sysK : 1 / sysK), tilt.dump), act: { kind: 'dump', at, speed: rimSpeed(c, at, 1.35), lift: 0 } })
    }
    if (adv >= -BLUE_X - 5 && adv <= 2 && pressure > 0.35 && !offsideMate) {
      // Met in the neutral zone: chip it past the man into the space behind
      // him and skate onto it (or for a teammate to chase) — the NZ chip.
      const side = c.y >= 0 ? 1 : -1
      const at = { x: c.x + a * 32, y: clamp(c.y + side * 6, -38, 38) }
      let chase = 0
      for (const r of me.skaters) chase = Math.max(chase, 1 - clamp(reachTime(r, at.x, at.y) / 3, 0, 1))
      const ev = (0.3 + chase * 0.35) * posValue(at.x, at.y, a) - 0.5 * posValue(at.x, at.y, -a)
      opts.push({ ev: tilted(ev, tilt.chip), act: { kind: 'dump', at, speed: rimSpeed(c, at, 1.2), lift: 4 } })
    }
    if (adv < -BLUE_X) {
      // Get it out: chip it off the glass to the neutral-zone boards; a PK
      // (or a desperate man) fires it down the ice.
      const side = c.y >= 0 ? 1 : -1
      const chipAt = { x: a * 8, y: side * 40 }
      const ev = 0.4 * posValue(chipAt.x, chipAt.y, a) - 0.5 * posValue(chipAt.x, chipAt.y, -a) * 0.8
      // (W3 S4: the rim breakout takes it off the boards up the strong side)
      opts.push({ ev: tilted(ev - (pressure < 0.4 ? 0.004 : 0), tilt.chip) + (bo === 'rim' ? SYSTEM_TILT.rim : 0), act: { kind: 'dump', at: chipAt, speed: rimSpeed(c, chipAt, 0.9), lift: 9 } })
      if (me.shorthanded) {
        const at = { x: a * 90, y: clamp(c.y, -20, 20) }
        opts.push({ ev: tilted(0.012, tilt.chip), act: { kind: 'dump', at, speed: 85, lift: 0 } })
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
// Everyone else — W3 S1: plans, triggers and claims (plans.ts)
// ---------------------------------------------------------------------------

/** Pick the role table for a side with the puck at `px` (attack frame). */
function supportTable(w: World, me: Side, withPuck: boolean, px: number): RoleSpot[] {
  const opp = other(w, me)
  if (me.ot && !me.powerPlay) return withPuck ? OT_ATTACK : OT_DEFEND
  const n = me.skaters.length
  const m = opp.skaters.length
  // W3 S4: 5-on-5 the shapes come from the team's playbook (systems.ts);
  // special teams, 4-on-4 and 3-on-3 keep their own tables (S8).
  // (by strength, not head count: a change on the fly has a man too many for a moment)
  const evenFive = S4_DEV.tables && !me.powerPlay && !me.shorthanded && !me.pulled && !opp.pulled && !(n === 4 && m === 4) && n >= 5 && m >= 5
  if (withPuck) {
    if (me.powerPlay && px > BLUE_X) return n - m >= 2 ? PP_5V3 : powerPlay(me.tactics.specialTeams.powerPlay)
    if (px < SHAPE_TUNING.breakoutX) return evenFive ? breakoutShape(me.team.breakout?.plan ?? 'up') : BREAKOUT
    if (px < BLUE_X) return evenFive ? transitionShape(me.playbook.regroup, regrouping(w, me)) : TRANSITION
    if (w.t - me.entryAt < RUSH_WINDOW) return RUSH
    // 4-on-4: more ice — two D up top, two forwards working low and the slot.
    if (n === 4 && m === 4) return FOUR_ATTACK
    return px < 55 ? CYCLE_POINT : CYCLE
  }
  if (me.shorthanded && px < -10) return n <= 3 ? PK_TRIANGLE : penaltyKill(me.tactics.specialTeams.penaltyKill)
  if (px > BLUE_X) return evenFive ? forecheckShape(me.playbook) : forecheck(me.tactics.forecheck)
  // the trap holds its 1-3-1 (the shell its 1-4) until the puck is over the red line
  if (evenFive && S4_DEV.trapHold && px > 0 && FORECHECK_CAP[me.playbook.forecheck] < Infinity) return forecheckShape(me.playbook)
  if (px > -BLUE_X) return NZ_DEFENSE
  // 4-on-4 in our end: a tight box.
  if (n === 4 && m === 4) return FOUR_DEFEND
  return evenFive ? dZoneShape(me.playbook.dZone) : DZ_ZONE
}

/**
 * The neutral-zone regroup (W3 S4): a defenceman has it short of the red
 * line, or the carrier has turned back toward his own end. The forwards then
 * swing back to come again with speed (systems.ts REGROUP).
 */
function regrouping(w: World, me: Side): boolean {
  const c = w.carrier
  if (!c || w.control !== me) return false
  const cx = c.x * me.a
  if (cx > 8) return false
  return c.player.position === 'D' || c.vx * me.a < -2
}

/**
 * The shape, sticky across its thresholds: the puck must be PLAN.lineHyst ft
 * past a line (blue, red, the breakout handover, the top of the circles)
 * before the team changes shape — a puck sitting on a line no longer flips
 * five men between two tables every think.
 */
function pickTable(w: World, me: Side, withPuck: boolean): RoleSpot[] {
  const px = w.puck.x * me.a
  const t0 = supportTable(w, me, withPuck, px)
  const prev = me.team.table
  if (prev && t0 !== prev) {
    if (supportTable(w, me, withPuck, px + PLAN.lineHyst) === prev || supportTable(w, me, withPuck, px - PLAN.lineHyst) === prev) return prev as RoleSpot[]
  }
  return t0
}

const TABLE_IDS = new WeakMap<object, number>()
let tableSeq = 0
function tableId(t: readonly RoleSpot[]): number {
  const id = TABLE_IDS.get(t)
  if (id !== undefined) return id
  TABLE_IDS.set(t, ++tableSeq)
  return tableSeq
}

/** Role assignment: hysteresis on a man's current role (ft of skating it is worth keeping), and whether to solve the whole shape at once. */
export const ROLE_ASSIGN = { keep: 12, optimal: 1 }

/** Assign roles (the least total skating), with hysteresis on current roles. */
function assignRoles(me: Side, pool: Body[], table: readonly RoleSpot[], targets: Map<string, XY>): Map<Body, RoleSpot> {
  const out = new Map<Body, RoleSpot>()
  const free = new Set(pool)
  // Fewer men than roles (4-on-4, a shorthanded rush, the carrier is a D):
  // drop FORWARD roles first. The D roles are the safety valve — a table cut
  // from the end would otherwise send a defenceman to the net-front and
  // leave nobody back.
  let used: readonly RoleSpot[] = table
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
  const costOf = (b: Body, spot: RoleSpot): number => {
    const tgt = targets.get(spot.role)!
    const isD = b.player.position === 'D'
    let cost = Math.hypot(b.x - tgt.x, b.y - tgt.y)
    if (spot.pos === 'F' && isD) cost += 30
    if (spot.pos === 'D' && !isD) cost += 30
    if (me.plans.get(b)?.role === spot.role) cost -= ROLE_ASSIGN.keep
    return cost
  }
  // The shape as a whole: the assignment with the least total skating (all
  // permutations — five men at most), so nobody crosses the ice to take a
  // spot a teammate is standing next to.
  const men = [...free]
  if (ROLE_ASSIGN.optimal && men.length <= 5 && used.length <= 6 && men.length > 0 && men.length <= used.length) {
    const k = Math.min(men.length, used.length)
    let bestCost = Infinity
    let bestPick: number[] = []
    const pick: number[] = []
    const usedSpot = new Array(used.length).fill(false)
    const rec = (i: number, acc: number): void => {
      if (acc >= bestCost) return
      if (i === k) {
        bestCost = acc
        bestPick = pick.slice()
        return
      }
      for (let j = 0; j < used.length; j++) {
        if (usedSpot[j]) continue
        usedSpot[j] = true
        pick.push(j)
        rec(i + 1, acc + costOf(men[i], used[j]) + ROLE_ASSIGN.keep)
        pick.pop()
        usedSpot[j] = false
      }
    }
    rec(0, 0)
    for (let i = 0; i < k; i++) out.set(men[i], used[bestPick[i]])
    return out
  }
  for (const spot of used) {
    if (free.size === 0) break
    let best: Body | null = null
    let bc = Infinity
    for (const b of free) {
      const cost = costOf(b, spot)
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
  // Extra bodies (6 skaters vs a 5-role table) take the first role again.
  for (const b of free) out.set(b, table[0])
  return out
}

/**
 * W3 S4, the net-front screen: a shot from beyond `minShotFt` brings the
 * net-front man onto its line, `outFt` from the goal line (the goalie's
 * eyes); the box-out pair (agentSim) is the defence's answer. Calibrate.
 */
export const SCREEN = { minShotFt: 45, outFt: 6 }

/**
 * W3 S4, the 2-1-2's second forechecker: with their carrier below `fromX`
 * (our attack frame), F2 sits in the lane to the carrier's nearest outlet
 * (beyond `outletX`), `laneK` of the way from the outlet to the carrier, and
 * never above `deepX` (two men in deep is what a 2-1-2 is).
 */
export const SYSTEM_HUNT = { fromX: 35, outletX: 30, laneK: 0.3, deepX: 66 }

/** Roles that own the net front (box out the man there when they cover nobody else). */
export const NET_ROLES = new Set(['DZ_WD', 'PK_NET', 'PK_LOW_W', 'PK3_LOW_W', 'B4_LOW_W', 'OT_SLOT'])

/** Distance from p to the segment a→b. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const L2 = dx * dx + dy * dy
  const s = L2 > 1e-9 ? clamp(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1) : 0
  return Math.hypot(px - (ax + dx * s), py - (ay + dy * s))
}

/** Track where (and since when) a man has been standing: a move of more than 2.5 ft restarts it. */
function noteStill(p: Plan, b: Body, t: number): void {
  if (Math.hypot(b.x - p.stillX, b.y - p.stillY) > 2.5) {
    p.stillX = b.x
    p.stillY = b.y
    p.stillSince = t
  }
}

/**
 * Support: get open. Around his role spot a man picks the point with the most
 * room and the clearest lane from the carrier, and skates to it; he holds the
 * pick (PLAN.openHoldS) unless another is clearly better, and a man who has
 * been standing PLAN.idleS seconds moves on to the next best (no idling in
 * the slot). This replaces the old drift loops: motion with a purpose.
 */
function getOpen(w: World, me: Side, opps: readonly Body[], b: Body, base: XY, carrier: XY, lateralOnly: boolean): XY {
  const p = planOf(me.plans, b, w.t)
  const st = PLAN.openStep
  const cands = lateralOnly
    ? [{ dx: 0, dy: 0 }, { dx: 0, dy: 8 }, { dx: 0, dy: -8 }]
    : [{ dx: 0, dy: 0 }, { dx: st, dy: 0 }, { dx: -st, dy: 0 }, { dx: 0, dy: st }, { dx: 0, dy: -st }]
  const score = (c: { dx: number; dy: number }): number => {
    const x = base.x + c.dx
    const y = base.y + c.dy
    let room = 14
    let lane = 10
    for (const o of opps) {
      room = Math.min(room, Math.hypot(o.x - x, o.y - y))
      lane = Math.min(lane, segDist(o.x, o.y, carrier.x, carrier.y, x, y))
    }
    return room + lane * 0.5 - 0.12 * Math.hypot(x - b.x, y - b.y)
  }
  noteStill(p, b, w.t)
  const idle = w.t - p.stillSince > PLAN.supportIdleS
  const cur = p.open
  let best = cands[0]
  let bs = -Infinity
  for (const c of cands) {
    // Idle: move on — to open ice a real stride away, not the spot he is on.
    if (idle && Math.hypot(base.x + c.dx - b.x, base.y + c.dy - b.y) < 5) continue
    const s = score(c)
    if (s > bs) {
      bs = s
      best = c
    }
  }
  if (!cur || idle || (bs > score(cur) + PLAN.openMargin && w.t - cur.at >= PLAN.openHoldS)) {
    p.open = { dx: best.dx, dy: best.dy, at: w.t }
    if (idle) p.stillSince = w.t
  }
  return { x: base.x + p.open!.dx, y: base.y + p.open!.dy }
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
  const tp = me.team
  const plans = me.plans
  const weHaveIt = w.control === me && carrier !== null
  const theyHaveIt = w.control === opp && carrier !== null
  const loose = carrier === null
  // Shape follows the last team in control while the puck is loose/in flight.
  const shapeWithPuck = weHaveIt || (loose && (w.flightSide ?? w.lastTouch) === me)
  // The strong side is sticky: it flips only once the puck is well across the
  // middle (a puck on the dot line used to mirror the whole shape every think).
  if (Math.abs(puck.y) > PLAN.strongFlipFt) tp.strong = puck.y > 0 ? 1 : -1
  const side = tp.strong
  // W3 S4: each possession runs one breakout from the playbook, drawn when it starts.
  if (weHaveIt && tp.breakout?.poss !== w.possSince) tp.breakout = { plan: pickBreakout(me.playbook, Math.round(w.possSince * 20) * 2 + (a > 0 ? 1 : 0)), poss: w.possSince }

  for (const b of [...plans.keys()]) if (!me.skaters.includes(b)) plans.delete(b)
  for (const b of me.leaving) setJob(plans, b, w.t, 'change')
  if (carrier && me.skaters.includes(carrier)) setJob(plans, carrier, w.t, 'carry')

  const pool = me.skaters.filter((b) => b !== carrier && !me.leaving.has(b))
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

  // --- Loose puck: the man with the earliest intercept races it.
  const chasers = new Set<Body>()
  /** Their pass we cannot beat to the puck: we play the man it is going to. */
  let receiver: Body | null = null
  if (loose) {
    // Read the puck's path: every skater finds the earliest point on it he
    // can get to first (an intercept — cutting off a rim, stepping up to keep
    // a chip in at the line), and the man with the earliest intercept goes.
    const psp = Math.hypot(puck.vx, puck.vy)
    // W3 S6: the real path (puckPath.ts: the sim's own puck physics, round the
    // corners and off the end boards and the glass), not a straight slide
    // clamped at the boards. The S5 straight path is kept behind S6_DEV.path.
    const pp = S6_DEV.path ? sharedPath(w) : null
    const path = (t: number): XY => {
      if (pp) {
        const q = pathAt(pp, t)
        const h = boardsClamp(q.x, q.y, 1.5)
        return { x: h.x, y: h.y }
      }
      if (psp < 0.5) return { x: puck.x, y: puck.y }
      const tt = Math.min(t, psp / 4.5)
      const d = psp * tt - 0.5 * 4.5 * tt * tt
      const h = boardsClamp(puck.x + (puck.vx / psp) * d, puck.y + (puck.vy / psp) * d, 1.5)
      return { x: h.x, y: h.y }
    }
    const intercept = (b: Body): { t: number; p: XY } => {
      for (let t = 0; t <= 2.4; t += 0.15) {
        // a puck in the air above the sticks cannot be played there (S6)
        if (pp && pathZ(pp, t) > 3) continue
        const p = path(t)
        if ((pp ? stickTime(b, p.x, p.y) : reachTime(b, p.x, p.y) - REACH / Math.max(b.caps.top, 1)) <= t) return { t, p }
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
      let first = sorted.find(mayChase)
      // The race is claimed: the man already going keeps it unless another is clearly first.
      const prev = tp.chaser
      if (first && prev && prev !== first && icpt.has(prev) && mayChase(prev) && icpt.get(prev)!.t <= icpt.get(first)!.t + PLAN.chaseKeepS) first = prev
      // W3 S6 (owner: "players ignoring a puck right in front of them"): a
      // puck he can have on his stick in a beat is his to play, whoever had
      // the claim and whatever the D safety line says - nobody skates past a
      // puck at his feet.
      if (S6_DEV.atFeet) {
        // at his feet: the puck's path comes within stick reach of where he
        // is going within atFeetS (by distance - the intercept time's reach
        // correction is too crude for a man standing next to it)
        const feetT = (b: Body): number => {
          for (let t = 0; t <= PUCK_PLAY.atFeetS + 1e-9; t += 0.1) {
            if (pp && pathZ(pp, t) > 3) continue
            const q = path(t)
            if (Math.hypot(b.x + b.vx * t - q.x, b.y + b.vy * t - q.y) <= REACH) return t
          }
          return Infinity
        }
        let feet: Body | undefined
        let ft = Infinity
        for (const b of eligible) {
          const t = feetT(b)
          if (t < ft || (t === ft && feet && Math.hypot(b.x - puck.x, b.y - puck.y) < Math.hypot(feet.x - puck.x, feet.y - puck.y))) {
            ft = t
            feet = b
          }
        }
        // the man already on it keeps it while the puck is at his feet too (no flip-flopping claim)
        if (prev && prev === first && feetT(prev) < Infinity) feet = prev
        if (feet && feet !== first && ft < Infinity && (!first || icpt.get(first)!.t > ft + PUCK_PLAY.atFeetMargin)) first = feet
      }
      // Their pass in flight: race it only when we get there about when their
      // receiver does. Otherwise nobody chases a puck that is already his — we
      // play the man (W3-LOG: a D skating off to the far boards after a pass
      // that was never his).
      if (first && w.passTo && opp.skaters.includes(w.passTo) && icpt.get(first)!.t >= intercept(w.passTo).t + PLAN.contestS) {
        receiver = w.passTo
        first = undefined
      }
      if (first) chasers.add(first)
    }
    tp.chaser = chasers.size > 0 ? [...chasers][0] : null
    for (const b of chasers) {
      const ip = icpt.get(b)?.p ?? { x: puck.x, y: puck.y }
      let tx = ip.x
      let ty = ip.y
      // A pass led to a man in motion: if he keeps skating his line the puck
      // meets him (it was aimed where he'd be) — he takes it in stride instead
      // of pulling up on the intercept point to wait for it.
      if (b === w.passTo && speedOf(b) > 6) {
        let miss = Infinity
        for (let tt = 0; tt <= 1.2; tt += 0.05) {
          const pp = path(tt)
          miss = Math.min(miss, Math.hypot(pp.x - (b.x + b.vx * tt), pp.y - (b.y + b.vy * tt)))
        }
        if (miss < VAL.keepRoute) {
          tx = b.x + b.vx
          ty = b.y + b.vy
        }
      }
      let h: XY = boardsClamp(tx, ty, 1.5)
      // A puck behind the net, a man in front of it: he goes round the post,
      // not into the back of the cage (two chasers pushing on the net while
      // the puck sits behind it, everybody else waiting, was a stall).
      const gx = Math.sign(h.x) * GOAL_X
      if (Math.abs(h.x) > GOAL_X - 0.5 && Math.abs(b.x) < GOAL_X + 0.5 && Math.sign(b.x) === Math.sign(h.x) && Math.abs(h.y) < 7 && Math.abs(b.y) < 9) {
        const sy = Math.abs(b.y) > 1 ? Math.sign(b.y) : Math.sign(h.y || 1)
        let wp = { x: gx + Math.sign(gx) * 1.5, y: sy * 7.5 }
        // W3 S6: wedged in the crease between the goalie and the cage: step out
        // to the side in front of the goal line first (he pressed on the cage
        // while the puck sat behind it)
        if (S6_DEV.atFeet && Math.abs(b.y) < 5.5 && Math.abs(b.x) > GOAL_X - 4) wp = { x: gx - Math.sign(gx) * 2.5, y: sy * 8 }
        if (Math.hypot(wp.x - b.x, wp.y - b.y) > 2) h = wp
      }
      const far = Math.hypot(h.x - b.x, h.y - b.y) > 45
      cmds.set(b, { tx: h.x, ty: h.y, speed: b.caps.top * (far ? 1 : 0.9), arrive: false, urgency: 1 })
      me.roles.set(b, 'CHASE')
      setJob(plans, b, w.t, 'chase', null, 'CHASE')
    }
  } else tp.chaser = null

  // --- The threat: their carrier, or the man their pass is going to.
  const threat: Body | null = theyHaveIt ? carrier : receiver
  const ownNetX = -a * GOAL_X
  let presser: Body | null = null
  // An odd-man rush with one man back: he plays the pass, not the carrier.
  let lone: Body | null = null
  let second: Body | null = null
  if (threat) {
    const tx = threat.x * a
    if (tx < 15 && tx > -70 && threat.vx * a < -4 && !me.shorthanded && !me.ot) {
      const back = pool.filter((b) => !chasers.has(b) && b.x * a < tx - 3)
      const rush = opp.skaters.filter((o) => o !== threat && o.x * a < tx + 12 && o.x * a > -82 && o.vx * a < 0)
      if (back.length === 1 && rush.length >= 1) {
        lone = back[0]
        second = rush.reduce((p, q) => (q.x * a < p.x * a ? q : p))
      }
    }
    // The man closest to him, right there, takes him (a man fresh off the
    // bench included: he reads the puck before he looks for his spot).
    let near: Body | null = null
    let nd = Infinity
    for (const b of pool) {
      if (chasers.has(b) || b === lone) continue
      const d = Math.hypot(b.x - threat.x, b.y - threat.y)
      if (d < nd) {
        nd = d
        near = b
      }
    }
    if (near && nd < PLAN.engageFt) presser = near
    else if (!lone) {
      let bestT = Infinity
      for (const b of pool) {
        if (chasers.has(b) || b === lone) continue
        let tt = reachTime(b, threat.x, threat.y)
        // Men already between the carrier and our net are better pressers; a
        // man chasing from behind can't stop him (he backchecks instead).
        if ((b.x - threat.x) * -a > 0) tt -= 0.3
        else tt += 0.9
        // Deep in their end the forwards forecheck (F1) and the D hold the line.
        // A D may pinch down the wall to the top of the circles, never below
        // it (a D chasing into their corner leaves nobody back).
        if (b.player.position === 'D' && threat.x * a > 10) tt += 0.7
        if (b.player.position === 'D' && threat.x * a > D_SAFETY.pinchMaxX && pool.some((q) => q.player.position !== 'D' && !chasers.has(q))) continue
        if (b === me.presser) tt -= 0.4
        if (tt < bestT) {
          bestT = tt
          presser = b
        }
      }
    }
  }
  me.presser = presser
  if (presser && threat) {
    const cx = threat.x
    const cy = threat.y
    const dNet = Math.hypot(ownNetX - cx, -cy)
    const ux = (ownNetX - cx) / Math.max(dNet, 1)
    const uy = -cy / Math.max(dNet, 1)
    const cAdvForUs = cx * a // carrier position in OUR attack frame
    const pp = me.tactics.puckPressure ?? 0.5
    const gc = me.tactics.gapControl ?? 0.5
    const isD = presser.player.position === 'D'
    const behind = (presser.x - cx) * a > 2
    const dP = Math.hypot(presser.x - cx, presser.y - cy)
    // W3 S4: how deep this forecheck sends F1 (the trap steers from the top of
    // the circles, the shell waits at their blue line; 2-1-2 / 1-2-2 go in).
    const fcCap = S4_DEV.trapHold && !me.powerPlay && !me.shorthanded && !me.ot && !opp.pulled ? FORECHECK_CAP[me.playbook.forecheck] : Infinity
    if (cAdvForUs > fcCap - 3 && cAdvForUs > BLUE_X) {
      // Contain: hold the middle at the cap, shaded to the puck side, facing
      // him — make him come up the ice into the system, take the middle away.
      cmds.set(presser, { tx: a * fcCap, ty: clamp(cy * 0.45, -22, 22), speed: presser.caps.top * 0.85, arrive: true, urgency: 0.8, faceX: cx, faceY: cy })
    } else if (behind && dP < 16 && cAdvForUs < BLUE_X) {
      // On him from behind (the backcheck on the puck): skate onto his hip,
      // stick on the puck — don't circle round to get in front.
      cmds.set(presser, { tx: cx + threat.vx * 0.35, ty: cy + threat.vy * 0.35, speed: presser.caps.top, arrive: false, urgency: 1 })
    } else if (cAdvForUs < BLUE_X && cAdvForUs > -BLUE_X - 5 && isD && !me.shorthanded) {
      // Neutral-ice gap control: back off at a gap that shrinks with the
      // system's gap setting, facing the carrier (backward skating).
      const csp = speedOf(threat)
      const gap = clamp((10 + csp * 0.55) * (1.25 - gc * 0.5), 8, 30)
      // Hold the gap on where he is GOING (his speed carries him half a
      // second on while you react), and only read him backward while you
      // can still match his speed that way — a carrier coming faster than a
      // D can backpedal is met by a D who has pivoted and is skating.
      const lead = D_SAFETY.gapLead
      const backOk = csp < presser.caps.topBack * 0.85
      cmds.set(presser, {
        tx: cx + threat.vx * lead + ux * gap,
        ty: (cy + threat.vy * lead) * 0.8 + uy * gap,
        speed: presser.caps.top,
        arrive: true,
        urgency: 1,
        ...((dP > 16 && backOk) || csp < 10 ? { faceX: cx, faceY: cy } : {})
      })
    } else {
      // On the puck: take the inside (between him and the net). CONTAIN at a
      // stick-and-a-half gap, and only close to engage when the carrier is
      // vulnerable — pinned on the wall, slow, or turned away from our net
      // (the moment to strip him or finish him).
      const onWall = distToBoards(cx, cy) < 5
      const csp = speedOf(threat)
      const turnedAway = threat.hx * ux + threat.hy * uy < -0.2
      // Inside the house (near our net) there is no containing: the man on
      // the puck closes and takes the body/stick before the carrier can
      // walk in or circle the net for seconds.
      const inHouse = Math.hypot(ownNetX - cx, cy) < DZ.engageFt
      const vulnerable = onWall || csp < 7 || turnedAway || inHouse
      // A carrier standing still gets no respect: the man on him steps INTO
      // him (body and stick) instead of waiting a stick-length away.
      const inside = vulnerable ? 3.2 : clamp(10 - pp * 4, 6, 10)
      cmds.set(presser, {
        tx: cx + ux * inside + threat.vx * 0.25,
        ty: cy + uy * inside + threat.vy * 0.25,
        speed: presser.caps.top * (0.75 + pp * 0.25),
        arrive: !vulnerable,
        urgency: 0.75 + pp * 0.25,
        // Face him while he's slow or still coming; once he has speed on
        // you, skate WITH him (angling him to the wall), not backward.
        ...(csp < 12 || dP > 16 ? { faceX: cx, faceY: cy } : {})
      })
    }
    me.roles.set(presser, 'ONPUCK')
    setJob(plans, presser, w.t, 'puck', null, 'ONPUCK')
    // Stick check when the puck is on a blade within reach.
    if (theyHaveIt && Math.hypot(presser.x - puck.x, presser.y - puck.y) < REACH) out.pokes.push(presser)
  }
  if (lone && second && threat) {
    // The one man back on a 2-on-1: take away the pass and give the shooter
    // the outside — goal-side, between the two, shaded to the pass lane.
    const gap = clamp(10 + speedOf(threat) * 0.4, 10, 22)
    const mx = Math.max(Math.min(threat.x * a, second.x * a) - gap, -84)
    const my = clamp(threat.y * 0.4 + second.y * 0.6, -30, 30)
    cmds.set(lone, { tx: a * mx, ty: my, speed: lone.caps.top, arrive: true, urgency: 1, faceX: threat.x, faceY: threat.y })
    me.roles.set(lone, 'ODD_D')
    setJob(plans, lone, w.t, 'twoOnOne', null, 'ODD_D')
  }

  // --- Everyone else: a role in the shape, a job in the role.
  const rest = pool.filter((b) => !chasers.has(b) && b !== presser && b !== lone)
  if (rest.length === 0) return
  const table = pickTable(w, me, shapeWithPuck)
  const targets = new Map<string, XY>()
  for (const s of table) targets.set(s.role, spotTarget(s, a, side, puck.x, puck.y))
  // The man on the puck (and the man back on an odd-man rush) vacate the
  // role nearest them, so the others keep the jobs that are left.
  let used: readonly RoleSpot[] = table
  if (!shapeWithPuck) {
    for (const m of [presser, lone]) {
      if (!m || used.length <= rest.length) continue
      const at = m === presser && threat ? threat : m
      let bi = -1
      let bd = Infinity
      used.forEach((s, i) => {
        const tg = targets.get(s.role)!
        const d = Math.hypot(tg.x - at.x, tg.y - at.y)
        if (d < bd) {
          bd = d
          bi = i
        }
      })
      if (bi >= 0) used = used.filter((_, i) => i !== bi)
    }
  }
  // Re-plan only on a trigger: possession, the shape, the carrier (or their
  // receiver), the men in the pool, a man lost far from his job, a man with
  // no role in this shape (fresh off the bench).
  const key = `${shapeWithPuck ? 'A' : 'D'}|${tableId(table)}|${(w.passTo ?? carrier)?.player.id ?? '-'}|${rest.map((b) => b.player.id).sort().join(',')}`
  const replan = tp.force || key !== tp.key || rest.some((b) => !used.some((s) => s.role === plans.get(b)?.role))
  let roles: Map<Body, RoleSpot>
  if (replan) {
    roles = assignRoles(me, rest, used, targets)
    tp.key = key
    tp.at = w.t
    tp.force = false
    tp.table = table
    for (const [b, s] of roles) planOf(plans, b, w.t).role = s.role
  } else {
    roles = new Map(rest.map((b) => [b, used.find((s) => s.role === plans.get(b)!.role)!] as [Body, RoleSpot]))
  }

  // --- Coverage claims: every attacker is covered by at most one man.
  const marks = new Map<Body, Body>()
  const covering = !shapeWithPuck && !me.shorthanded && (DZ_TABLES.has(table) || table === NZ_DEFENSE || table === FOUR_DEFEND)
  if (covering) {
    const rush = table === NZ_DEFENSE
    // W3 S4: the playbook's coverage (man rides the point men; the collapse is zone coverage held in the house)
    const pbz = !S4_DEV.man && me.playbook.dZone === 'man' ? 'zone' : me.playbook.dZone
    const mode = pbz === 'man' ? 'man' : pbz === 'collapse' ? 'zone' : (me.tactics.dZoneCoverage ?? 'zone')
    const gapK = DZ_GAP[pbz]
    const atts = opp.skaters.filter((o) => o !== threat && !opp.leaving.has(o) && (rush ? o.x * a < 30 : o.x * a < -BLUE_X + 10))
    const danger = (o: Body): number => (rush ? -o.x * a : xgAt(o.x, o.y, opp.a) * 100)
    const anchorOf = (b: Body): XY => targets.get(roles.get(b)!.role) ?? b
    const feasible = (b: Body, o: Body): boolean => {
      // (a man already on him keeps him a little longer: exit radius > entry radius)
      const p0 = plans.get(b)
      const ex = p0?.job === 'mark' && p0.mark === o ? PLAN.areaExitFt : 0
      if (rush) return Math.hypot(b.x - o.x, b.y - o.y) < 45 + ex && (b.x - o.x) * a < 20 + ex
      const dNet = Math.hypot(o.x - ownNetX, o.y)
      const an = anchorOf(b)
      const dAn = Math.hypot(an.x - o.x, an.y - o.y)
      // Man coverage still keeps a man home: the net-front role only takes a man in the house.
      if (NET_ROLES.has(roles.get(b)!.role)) return dAn < PLAN.netArea + ex
      // the collapse leaves the points alone (W3 S4)
      if (dNet > gapK.reach + ex) return false
      // man-to-man (the playbook's) follows his man out to the point
      if (pbz === 'man') return dNet < MAN_COVER.pointFt + ex
      if (mode === 'man' || (mode === 'hybrid' && dNet < 30)) return dNet < (mode === 'man' ? 42 : 30) + ex
      // His area — or a man he is already on (a pick-up stays his).
      return dAn < PLAN.zoneArea + ex || Math.hypot(b.x - o.x, b.y - o.y) < PLAN.onManFt + ex
    }
    const cost = (b: Body, o: Body): number => {
      const an = rush || mode === 'man' ? b : anchorOf(b)
      const p = plans.get(b)
      return Math.hypot(an.x - o.x, an.y - o.y) - (p?.job === 'mark' && p.mark === o ? PLAN.markMargin : 0)
    }
    // A mark held for less than markHoldS stays (no flip-flopping).
    for (const b of rest) {
      const p = plans.get(b)
      if (p?.job === 'mark' && p.mark && atts.includes(p.mark) && feasible(b, p.mark) && w.t - p.since < PLAN.markHoldS) marks.set(b, p.mark)
    }
    const taken = new Set(marks.values())
    for (const o of atts.filter((q) => !taken.has(q)).sort((p, q) => danger(q) - danger(p))) {
      let best: Body | null = null
      let bc = Infinity
      for (const b of rest) {
        if (marks.has(b) || !feasible(b, o)) continue
        const c = cost(b, o)
        if (c < bc) {
          bc = c
          best = b
        }
      }
      if (best) marks.set(best, o)
    }
  }
  // A coverage man in our end with nobody in his area is the SPARE: he plays
  // the puck — the low support goal-side of the carrier (the designed second
  // man; never while a man is open, since an open man is somebody's mark), or
  // the support on a loose puck. Exit test "idle in a dangerous area"
  // (W3-DESIGN item 2): a spare who has stood PLAN.idleS seconds picks up the
  // nearest attacker nobody has. The net-front role keeps the net front.
  const spare = new Set<Body>()
  for (const b of rest) noteStill(planOf(plans, b, w.t), b, w.t)
  if (covering && table !== NZ_DEFENSE) {
    const taken = new Set(marks.values())
    for (const b of rest) {
      if (marks.has(b) || NET_ROLES.has(roles.get(b)!.role)) continue
      if (Math.hypot(b.x - ownNetX, b.y) > 40 || opp.skaters.some((o) => o !== threat && Math.hypot(o.x - b.x, o.y - b.y) < 8)) continue
      const p = plans.get(b)!
      if (w.t - p.stillSince >= PLAN.idleS) {
        let pick: Body | null = null
        let pd = PLAN.pickUpFt
        for (const o of opp.skaters) {
          if (o === threat || taken.has(o) || opp.leaving.has(o)) continue
          const d = Math.hypot(o.x - b.x, o.y - b.y)
          if (d < pd) {
            pd = d
            pick = o
          }
        }
        p.stillSince = w.t
        if (pick) {
          marks.set(b, pick)
          taken.add(pick)
          continue
        }
      }
      spare.add(b)
    }
  }

  // The shooting-lane man: when their carrier can shoot, a man covering nobody steps into the lane.
  let laneMan: Body | null = null
  if (theyHaveIt && carrier && carrier.x * opp.a > BLUE_X + 5) {
    const xg = xgAt(carrier.x, carrier.y, opp.a)
    if (xg > 0.025) {
      const lx = carrier.x + (ownNetX - carrier.x) * 0.3
      const ly = carrier.y * 0.7
      // (the man already in the lane keeps it unless another is clearly nearer)
      let bd = 25
      for (const b of rest) {
        if (marks.has(b)) continue
        const d = Math.hypot(b.x - lx, b.y - ly) - (plans.get(b)?.job === 'lane' ? 8 : 0)
        if (d < bd) {
          bd = d
          laneMan = b
        }
      }
    }
  }

  // Their man closest to our crease (within 18 ft) — the net-front threat.
  let netFront: Body | null = null
  {
    let bd = 18
    for (const o of opp.skaters) {
      if (o === carrier || opp.leaving.has(o)) continue
      const d = Math.hypot(o.x - ownNetX, o.y)
      if (d < bd) {
        bd = d
        netFront = o
      }
    }
  }
  const inZone = puck.x * a >= BLUE_X

  for (const b of rest) {
    const spot = roles.get(b)!
    me.roles.set(b, spot.role)
    let t = targets.get(spot.role)!
    let urgency = spot.urgency
    let faceX: number | undefined
    let faceY: number | undefined
    let job: JobKind = 'spot'
    let mk: Body | null = marks.get(b) ?? null
    if (mk) {
      job = 'mark'
      if (table === NZ_DEFENSE) {
        // Rush defence: goal-side and inside of the man, a gap that grows
        // with his speed at us — never out wide of him on the far boards.
        const gap = clamp(6 + Math.max(0, -mk.vx * a) * 0.4, 6, 16)
        t = { x: mk.x - a * gap, y: mk.y * 0.88 }
        urgency = 0.9
      } else {
        // In our zone: goal-side of him, tight in the house; a man further
        // out (the points) is covered from the slot side of his lane — the
        // winger stays between him and the house, he does not chase him to
        // the blue line and leave the slot empty.
        const d = Math.hypot(ownNetX - mk.x, mk.y)
        const gk = DZ_TABLES.has(table) && (S4_DEV.man || me.playbook.dZone !== 'man') ? DZ_GAP[me.playbook.dZone] : DZ_GAP.zone
        const gap = d < 18 ? 2.6 : clamp(3 + (d - 30) * PLAN.laneGapK * gk.k, 3, gk.cap)
        t = { x: mk.x + ((ownNetX - mk.x) / Math.max(d, 1)) * gap, y: mk.y + (-mk.y / Math.max(d, 1)) * gap }
        // (man-to-man: he goes WITH his man, at once - not a drift into a zone spot)
        urgency = d < 25 ? 0.85 : S4_DEV.man && me.playbook.dZone === 'man' && DZ_TABLES.has(table) ? MAN_COVER.urgency : 0.7
      }
      faceX = puck.x
      faceY = puck.y
    } else if (!shapeWithPuck && NET_ROLES.has(spot.role) && netFront && ![...marks.values()].includes(netFront)) {
      // Box out the net-front man: goal-side of him, between him and the crease.
      const dx = ownNetX - netFront.x
      const dy = -netFront.y
      const d = Math.max(Math.hypot(dx, dy), 1)
      t = { x: netFront.x + (dx / d) * 2.6, y: netFront.y + (dy / d) * 2.6 }
      urgency = 0.8
      faceX = puck.x
      faceY = puck.y
      job = 'mark'
      mk = netFront
    } else if (S4_DEV.hunt && spot.role === 'F2_DEEP' && threat && threat.x * a > SYSTEM_HUNT.fromX) {
      // W3 S4, the 2-1-2's second man in deep: he takes away the carrier's
      // first outlet (the D-to-D, the man on the wall) — in that lane, close
      // to the outlet, so the carrier has nobody to move it to.
      let o: Body | null = null
      let od = Infinity
      for (const q of opp.skaters) {
        if (q === threat || opp.leaving.has(q) || q.x * a < SYSTEM_HUNT.outletX) continue
        const d = Math.hypot(q.x - threat.x, q.y - threat.y)
        if (d < od) {
          od = d
          o = q
        }
      }
      if (o) {
        // (two in deep: never above the deep line, wherever the outlet stands)
        const lx = Math.max((o.x + (threat.x - o.x) * SYSTEM_HUNT.laneK) * a, SYSTEM_HUNT.deepX)
        t = { x: a * lx, y: o.y + (threat.y - o.y) * SYSTEM_HUNT.laneK }
        urgency = 0.95
        faceX = threat.x
        faceY = threat.y
        job = 'lane'
        mk = o
      }
    } else if (b === laneMan && carrier) {
      // Take away the lane — and inside 35 ft, when every man in the slot is
      // covered, collapse ONTO the carrier (the shell: a body goal-side of
      // him, the designed second man on the puck). With a man open in the
      // slot he stays in the lane a third of the way in: two on the carrier
      // and nobody on the open man is the double-team the owner saw.
      const dN = Math.hypot(ownNetX - carrier.x, carrier.y)
      const covered = [...marks.values()]
      const slotOpen = opp.skaters.some((o) => o !== carrier && Math.hypot(o.x - ownNetX, o.y) < 30 && !covered.includes(o))
      const f = dN < 35 && !slotOpen ? clamp(5 / Math.max(dN, 1), 0.1, 0.5) : 0.3
      t = { x: carrier.x + (ownNetX - carrier.x) * f, y: carrier.y + (0 - carrier.y) * f }
      urgency = dN < 35 ? 1 : 0.85
      faceX = carrier.x
      faceY = carrier.y
      job = 'lane'
    } else if (spare.has(b) && (threat || loose)) {
      // The spare man: low support on the puck, goal-side of it.
      const q = threat ?? puck
      const dN = Math.max(Math.hypot(ownNetX - q.x, q.y), 1)
      const k = threat ? 7 : 10
      t = { x: q.x + ((ownNetX - q.x) / dN) * k, y: q.y + (-q.y / dN) * k }
      urgency = 0.85
      faceX = q.x
      faceY = q.y
      job = 'lane'
    } else if (shapeWithPuck) {
      job = 'support'
      // A point man walks the LINE, holding the blue line from inside the
      // zone: he is the outlet and the shooter up top.
      const onPoint = inZone && b.player.position === 'D' && t.x * a < 45
      // (The net-front man holds the net front, and screens a shot from distance.)
      if (S4_DEV.screen && spot.role === 'NET_FRONT' && inZone && carrier && carrier !== b && me.playbook.screen > 0) {
        // W3 S4: the screen. With the puck up top (a shot from distance) the
        // net-front man stands on the shot line a stride off the crease, his
        // back to the goalie: as far onto it as the system asks.
        const nx = a * GOAL_X
        const L = Math.hypot(carrier.x - nx, carrier.y)
        if (L > SCREEN.minShotFt) {
          const sx = nx + ((carrier.x - nx) / L) * SCREEN.outFt
          const sy = (carrier.y / L) * SCREEN.outFt
          const k = clamp(me.playbook.screen, 0, 1)
          t = { x: t.x + (sx - t.x) * k, y: t.y + (sy - t.y) * k }
          job = 'screen'
          urgency = Math.max(urgency, 0.8)
          faceX = carrier.x
          faceY = carrier.y
        }
      } else if (!(spot.role === 'NET_FRONT' && inZone)) {
        // (a loose puck of ours: open ice relative to the puck)
        t = getOpen(w, me, opp.skaters, b, t, carrier ?? puck, onPoint)
        // He skates to his open ice with intent and stops on it — not a
        // creep that never quite arrives (the "standing" look).
        if (Math.hypot(t.x - b.x, t.y - b.y) > 3) urgency = Math.max(urgency, PLAN.supportUrgency)
      }
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
    // Defenders read the play facing the puck in their own half — but when a
    // carrier is coming with speed they pivot and skate (backward is slow).
    const rushing = theyHaveIt && carrier !== null && speedOf(carrier) > 15 && Math.hypot(carrier.x - b.x, carrier.y - b.y) < 40
    if (!shapeWithPuck && faceX === undefined && puck.x * a < 0 && !rushing) {
      faceX = puck.x
      faceY = puck.y
    }
    // D never let a man behind them: when they have it (or it's loose off
    // their stick), a defenceman stays goal-side of their deepest attacker —
    // where that attacker WILL be, not where he is.
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
    // Exit test: a man who cannot get near his job for a while re-plans.
    const plan = setJob(plans, b, w.t, job, mk, spot.role)
    if (dist > PLAN.lostFt) {
      if (plan.lostSince < 0) plan.lostSince = w.t
      else if (w.t - plan.lostSince > PLAN.lostS) {
        tp.force = true
        plan.lostSince = -1
      }
    } else plan.lostSince = -1
    // Far from the target → skate; close → settle into it.
    const speed = b.caps.top * (backcheck ? 0.97 : clamp(0.5 + urgency * 0.5 + dist / 120, 0.4, 0.96))
    cmds.set(b, {
      tx: h.x,
      ty: h.y,
      speed,
      arrive: true,
      // (support skating to new open ice keeps its intent: below 0.85 the
      // legs only glide — the creep that reads as a man standing still)
      urgency: job === 'support' && dist > 3 && urgency >= PLAN.supportUrgency ? urgency : clamp(urgency * (dist > 25 ? 1.1 : 0.8), 0.2, 1),
      ...(faceX !== undefined ? { faceX, faceY } : {})
    })
  }
}
