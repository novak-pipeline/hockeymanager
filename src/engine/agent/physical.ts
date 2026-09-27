/**
 * M3 — THE PHYSICAL GAME: hits come from real collisions.
 *
 * Deciding (decideHit, every think): a defender near the puck carrier — or the
 * man who just moved the puck (finishing the check) — lines him up when his
 * attributes (checking, aggression, strength), his role (power forward,
 * enforcer, shutdown D), the coach's hitting slider, the rivalry heat, the
 * target's situation (along the boards, head down with the puck) and his own
 * legs say so. The intent persists ~1.3 s: he skates THROUGH the man.
 *
 * Executing (resolveHit, on a body-body contact from physics): the force is the
 * real closing speed × the hitter's mass share. The target can see it coming
 * and bail/dodge (agility, anticipation), in which case the hitter whiffs and
 * is left out of position (stunned briefly). A landed hit knocks the target off
 * balance for a time scaled by force vs his balance/strength, can knock the
 * puck loose, and can draw a penalty from the ANGLE and FORCE — boarding
 * (from behind into the boards), charging (huge closing speed), interference
 * (the man didn't have the puck), elbowing (rare, undisciplined).
 */
import { BLUE_X, distToBoards } from './rink'
import type { HitKind } from '@domain'
import type { Rng } from '@engine/shared/rng'
import { speedOf, type Body, type Contact } from './physics'
import { other, type Side, type World } from './world'

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
const r01 = (v: number | undefined): number => clamp((v ?? 50) / 100, 0, 1)

export const HIT_TUNING = {
  /** Per-think chance scale that a willing defender commits to a check. */
  intentK: 0.011,
  /** Contact closing speed (ft/s) needed for a collision to count as a hit when unplanned. */
  incidentalClosing: 19,
  /** Minimum closing speed for a planned hit to land as a hit. */
  plannedClosing: 4.5,
  /** Penalty scale on dangerous hits. */
  penaltyK: 1.0
}

export interface HitIntent {
  target: Body
  until: number
}

export interface HitResult {
  hitter: Body
  victim: Body
  /** Impact in ft/s of effective closing speed, mass-weighted. */
  force: number
  boards: boolean
  loosePuck: boolean
  penalty: string | null
  planned: boolean
  kind: HitKind
  /** The victim had the puck, or had just moved it. */
  hadPuck: boolean
}

function roleBoost(b: Body): number {
  switch (b.player.role) {
    case 'enforcer':
      return 1.8
    case 'powerForward':
      return 1.45
    case 'shutdownD':
    case 'stayAtHomeD':
      return 1.3
    case 'sniper':
    case 'playmaker':
    case 'offensiveD':
      return 0.7
    default:
      return 1
  }
}

/** Willingness to throw a body check (0.2 … ~3). */
export function hitAppetite(b: Body, side: Side, intensity: number): number {
  const d = b.player.ratings.defensive
  const m = b.player.ratings.mental
  const base = 0.25 + r01(d.checking) * 0.9 + r01(m.aggression) * 0.6 + r01(b.player.ratings.physical.strength) * 0.3
  const slider = 0.5 + (side.tactics.hitting ?? 0.5)
  return base * roleBoost(b) * slider * (1 + intensity * 0.35) * (0.6 + 0.4 * b.energy)
}

/**
 * Should `b` (on side `s`) line somebody up this think? Returns the target and
 * records the intent, or null. Keeps an existing intent alive.
 */
export function decideHit(w: World, s: Side, b: Body, intents: Map<Body, HitIntent>, intensity = 0): Body | null {
  const cur = intents.get(b)
  if (cur) {
    if (w.t < cur.until && Math.hypot(cur.target.x - b.x, cur.target.y - b.y) < 22) return cur.target
    intents.delete(b)
  }
  if (b.stun > 0) return null
  const opp = other(w, s)
  // Target: their carrier, or the man who just got rid of it (finish the check).
  let target: Body | null = null
  if (w.control === opp && w.carrier) target = w.carrier
  else {
    let bestT = 0.9
    for (const o of opp.skaters) {
      const t0 = w.lastHad.get(o)
      if (t0 !== undefined && w.t - t0 < bestT && w.carrier !== o) {
        bestT = w.t - t0
        target = o
      }
    }
  }
  if (!target || target.stun > 0) return null
  const d = Math.hypot(target.x - b.x, target.y - b.y)
  if (d > 16 || d < 2) return null
  // Only from the front or the side — nobody commits to a check chasing a man
  // from behind (that is what gets called).
  const ux = (target.x - b.x) / d
  const uy = (target.y - b.y) / d
  const closing = (b.vx - target.vx) * ux + (b.vy - target.vy) * uy
  if (closing < -2) return null
  // Body checks happen along the walls (94% of NHL hits are within 10 ft of
  // the boards): open-ice hits are rare, pins on the wall are the staple.
  const boards = distToBoards(target.x, target.y) < 10 ? 2.2 : 0.12
  const withPuck = w.carrier === target ? 1 : 0.55
  // Defencemen finish their man in the corners and along their own wall.
  const dCorner = b.player.position === 'D' && target.x * s.a < -BLUE_X ? 1.7 : 1
  const p = HIT_TUNING.intentK * hitAppetite(b, s, intensity) * boards * withPuck * dCorner
  if (!w.rng.chance(clamp(p, 0, 0.8))) return null
  intents.set(b, { target, until: w.t + 1.3 })
  return target
}

/**
 * A body-body contact from the physics step. Returns a HitResult when the
 * contact is a check (planned, or a heavy incidental collision between
 * opponents), applying its consequences to the bodies; null otherwise.
 */
export function resolveHit(w: World, ct: Contact, intents: Map<Body, HitIntent>, rng: Rng, intensity = 0): HitResult | null {
  const sa = sideOfBody(w, ct.a)
  const sb = sideOfBody(w, ct.b)
  if (!sa || !sb || sa === sb) return null
  if (ct.a === sa.goalie || ct.b === sb.goalie) return null
  let hitter: Body
  let victim: Body
  let planned = false
  const ia = intents.get(ct.a)
  const ib = intents.get(ct.b)
  if (ia && ia.target === ct.b) {
    hitter = ct.a
    victim = ct.b
    planned = true
  } else if (ib && ib.target === ct.a) {
    hitter = ct.b
    victim = ct.a
    planned = true
  } else {
    if (ct.closing < HIT_TUNING.incidentalClosing) return null
    // Incidental contact only counts around the puck (a battle), not two men
    // brushing in open ice away from the play.
    const battling = (b: Body): boolean => w.carrier === b || w.t - (w.lastHad.get(b) ?? -99) < 0.6
    if (!battling(ct.a) && !battling(ct.b)) return null
    // A board battle is a hit; bumping in open ice isn't scored as one.
    if (distToBoards(ct.a.x, ct.a.y) > 9 && distToBoards(ct.b.x, ct.b.y) > 9) return null
    // Incidental: the faster-moving body into the other.
    const fa = speedOf(ct.a) * ct.a.mass
    const fb = speedOf(ct.b) * ct.b.mass
    hitter = fa >= fb ? ct.a : ct.b
    victim = hitter === ct.a ? ct.b : ct.a
  }
  if (planned && ct.closing < HIT_TUNING.plannedClosing) return null
  intents.delete(hitter)
  const hs = sideOfBody(w, hitter)!
  const massShare = hitter.mass / (hitter.mass + victim.mass)
  const force = ct.closing * massShare * 2 * (0.75 + r01(hitter.player.ratings.physical.strength) * 0.5)

  // The target sees it coming and slips it (planned hits only).
  if (planned) {
    const vp = victim.player.ratings
    const evade = 0.06 + r01(vp.physical.agility) * 0.14 + r01(vp.mental.anticipation) * 0.1 - (w.carrier === victim ? 0.06 : 0)
    if (rng.chance(clamp(evade, 0.02, 0.35))) {
      // Whiff: the hitter sails past, out of the play for a moment.
      hitter.stun = 0.5
      return null
    }
  }

  const boards = distToBoards(victim.x, victim.y) < 4.5
  // A glancing planned check in open ice is just a bump — only a real
  // open-ice hit (big force) is scored.
  if (planned && distToBoards(victim.x, victim.y) > 10 && force < 16) {
    victim.stun = Math.max(victim.stun, 0.15)
    return null
  }
  const bal = (r01(victim.player.ratings.physical.balance) + r01(victim.player.ratings.physical.strength)) / 2
  const hard = clamp((force - 6) / 20, 0, 1)
  victim.stun = Math.max(victim.stun, clamp(0.25 + hard * 1.1 - bal * 0.35 + (boards ? 0.25 : 0), 0.15, 1.6))
  victim.energy = Math.max(0, victim.energy - 0.02 - hard * 0.03)
  hitter.energy = Math.max(0, hitter.energy - 0.015)
  const loosePuck = w.carrier === victim && rng.chance(clamp(0.2 + hard * 0.55 - bal * 0.25 + (boards ? 0.1 : 0), 0.08, 0.85))

  // Penalties from angle and force.
  let penalty: string | null = null
  const disc = 1.3 - r01(hitter.player.ratings.mental.discipline) * 0.7
  const k = HIT_TUNING.penaltyK * disc * (1 + intensity * 0.3)
  const hadPuck = w.carrier === victim || w.t - (w.lastHad.get(victim) ?? -99) < 1.0
  // From behind: the hitter's travel is along the victim's facing (he never saw it).
  const hsp = Math.max(speedOf(hitter), 0.1)
  const behind = (hitter.vx * victim.hx + hitter.vy * victim.hy) / hsp > 0.55
  if (!hadPuck && planned && rng.chance(0.25 * k)) penalty = 'interference'
  else if (boards && behind && hard > 0.25 && rng.chance(0.1 * k)) penalty = 'boarding'
  else if (ct.closing > 22 && rng.chance(0.04 * k)) penalty = 'charging'
  else if (hard > 0.5 && rng.chance(0.015 * k)) penalty = 'elbowing'
  void hs
  const kind: HitKind = !planned ? 'battle' : boards ? 'boards' : w.carrier === victim ? 'openIce' : 'finish'
  return { hitter, victim, force, boards, loosePuck, penalty, planned, kind, hadPuck }
}

function sideOfBody(w: World, b: Body): Side | null {
  for (const s of w.sides) if (s.skaters.includes(b) || s.goalie === b) return s
  return null
}
