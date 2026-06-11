/**
 * Team shapes — where every skater WANTS to be, given the possession phase,
 * the tactics of both teams, and the strength state. This is the file that
 * makes a watched game read as hockey:
 *
 *   - Breakouts: retrieving D, partner net-front, wingers on the half-walls,
 *     center swinging low for support.
 *   - Neutral zone: lanes filled left/middle/right with a weak-side stretch
 *     option; defenders gap up at their line (or clog it, if trapping).
 *   - Offensive zone: a real cycle — corner/half-wall/point stations, net-front
 *     screen, D walking the blue line (pinching down if the tactic says so).
 *   - Power plays deploy visibly distinct umbrella / 1-3-1 / overload shapes;
 *     penalty kills hold a box or diamond collapsed to the puck side.
 *   - Defensive zone coverage is zone (box+1 collapsing on the puck) or man
 *     (each skater shadows a counterpart); forechecks are 1-2-2 / 2-1-2 / trap.
 *   - On a rush the defending D play GAP CONTROL — they retreat between the
 *     carrier and their net instead of magnetizing to the puck — and the
 *     forwards backcheck at full speed.
 *
 * Orders are returned per skater index, aligned with unit.skaters.
 */
import type {
  ForecheckSystem,
  PenaltyKillFormation,
  PowerPlayFormation,
  TeamTactics,
  XY
} from '@domain'
import type { MoveOrder } from './movement'
import { clamp, O_BLUE, type Phase, type RSkater, type Unit } from './types'

// ---------------------------------------------------------------------------
// Attacking team
// ---------------------------------------------------------------------------

export interface AttackCtx {
  unit: Unit
  /** Attack direction sign: this team shoots at the net at x = a. */
  a: number
  phase: Phase
  puck: XY
  /** Index of the carrier in unit.skaters, -1 when the puck is loose/in flight. */
  carrierIdx: number
  tactics: TeamTactics
  /** True man advantage with the puck established in the zone → set play. */
  ppSetup: boolean
  /** Game-clock seconds, for deterministic sway (players never stand still). */
  t: number
}

/** PP set-play spots per formation, keyed by formation slot [LW,C,RW,LD,RD]. */
function ppSpots(f: PowerPlayFormation, a: number, side: number): XY[] {
  switch (f) {
    case 'umbrella':
      // High point man at the top of the umbrella, flankers at the circles,
      // two bodies at/below the dots for screens and rebounds.
      return [
        { x: a * 0.52, y: -0.58 },
        { x: a * 0.82, y: -0.08 },
        { x: a * 0.52, y: 0.58 },
        { x: a * 0.3, y: 0 },
        { x: a * 0.76, y: 0.32 }
      ]
    case '1-3-1':
      return [
        { x: a * 0.58, y: -0.6 },
        { x: a * 0.87, y: 0.03 },
        { x: a * 0.58, y: 0.6 },
        { x: a * 0.3, y: 0 },
        { x: a * 0.62, y: 0.02 }
      ]
    default:
      // Overload: stack the puck side, one backdoor body at the weak post.
      return [
        { x: a * 0.5, y: side * 0.68 },
        { x: a * 0.82, y: side * 0.5 },
        { x: a * 0.66, y: -side * 0.06 },
        { x: a * 0.33, y: side * 0.22 },
        { x: a * 0.8, y: -side * 0.28 }
      ]
  }
}

export function attackerOrders(c: AttackCtx): MoveOrder[] {
  const { unit, a, phase, puck, carrierIdx, tactics, t } = c
  const side = puck.y >= 0 ? 1 : -1
  const adv = puck.x * a
  const sway = (i: number, amp: number): number => amp * Math.sin(t * 0.7 + i * 2.1)
  const orders: MoveOrder[] = new Array(unit.skaters.length)

  // PP set play: hold the formation and walk it (small sway), carrier included.
  if (c.ppSetup) {
    const spots = ppSpots(tactics.specialTeams.powerPlay, a, side)
    const seen = new Map<number, number>()
    unit.skaters.forEach((_, i) => {
      const slot = unit.slots[i]
      const n = seen.get(slot) ?? 0
      seen.set(slot, n + 1)
      const s = spots[slot]
      orders[i] = {
        tx: s.x - a * n * 0.08,
        ty: s.y + n * 0.2 + sway(i, 0.05),
        urgency: i === carrierIdx ? 0.45 : 0.55
      }
    })
    return orders
  }

  // Sort helper: non-carrier forwards (slot < 3) for cycle/entry role handout.
  const fwdIdx: number[] = []
  const defIdx: number[] = []
  unit.skaters.forEach((_, i) => {
    if (i === carrierIdx) return
    if (unit.slots[i] < 3) fwdIdx.push(i)
    else defIdx.push(i)
  })

  const pinch = tactics.tempo.defensivePinch
  const passRisk = tactics.tempo.passRisk

  unit.skaters.forEach((r, i) => {
    const slot = unit.slots[i]

    if (i === carrierIdx) {
      orders[i] = carrierOrder(slot, phase, a, side, adv, puck, tactics, t)
      return
    }

    switch (phase) {
      case 'breakout': {
        // Wingers to the half-walls, C swings low for support, D net-front.
        if (slot === 0) orders[i] = { tx: -a * 0.5, ty: -0.74, urgency: 0.6 }
        else if (slot === 2) orders[i] = { tx: -a * 0.5, ty: 0.74, urgency: 0.6 }
        else if (slot === 1)
          orders[i] = { tx: -a * 0.6, ty: clamp(puck.y * 0.5, -0.4, 0.4) + sway(i, 0.06), urgency: 0.65 }
        else if (slot === 3) orders[i] = { tx: -a * 0.85, ty: -0.2, urgency: 0.6 }
        else orders[i] = { tx: -a * 0.85, ty: 0.2, urgency: 0.6 }
        break
      }
      case 'neutral': {
        // Fill three lanes with speed (pass-through waypoints — the lanes keep
        // moving up ice, nobody coasts to a stop in neutral ice); D trail; the
        // weak winger may stretch.
        const ahead = a * Math.min(adv + 0.25, 0.22)
        if (slot === 0) {
          const stretch = passRisk > 0.55 && side > 0
          orders[i] = { tx: stretch ? a * 0.22 : ahead, ty: -0.56, urgency: 0.75, through: true }
        } else if (slot === 2) {
          const stretch = passRisk > 0.55 && side < 0
          orders[i] = { tx: stretch ? a * 0.22 : ahead, ty: 0.56, urgency: 0.75, through: true }
        } else if (slot === 1)
          orders[i] = { tx: a * Math.min(adv + 0.14, 0.2), ty: sway(i, 0.1), urgency: 0.7, through: true }
        else if (slot === 3) orders[i] = { tx: a * (adv - 0.2), ty: -0.26, urgency: 0.65 }
        else orders[i] = { tx: a * (adv - 0.2), ty: 0.26, urgency: 0.65 }
        break
      }
      case 'entry':
      case 'rush': {
        // One F drives the net, one fills the weak wing, C (or 3rd F) trails;
        // D follow up to the line. Forward lanes are pass-through: speed is
        // carried into the zone, not bled off at the waypoint.
        if (slot < 3) {
          const rank = fwdIdx.indexOf(i)
          if (rank === 0) orders[i] = { tx: a * 0.78, ty: -side * 0.1, urgency: 0.95, through: true }
          else if (rank === 1) orders[i] = { tx: a * 0.6, ty: -side * 0.46, urgency: 0.9, through: true }
          else orders[i] = { tx: a * 0.38, ty: side * 0.14, urgency: 0.85 }
        } else {
          orders[i] = { tx: a * 0.26, ty: slot === 3 ? -0.3 : 0.3, urgency: 0.8 }
        }
        break
      }
      default: {
        // Cycle: low support near the puck, net-front screen, third F in the
        // slot; D walk the blue line (or pinch down the strong wall).
        if (slot < 3) {
          const rank = fwdIdx.indexOf(i)
          if (rank === 0) orders[i] = { tx: a * 0.85, ty: side * 0.42, urgency: 0.6 }
          else if (rank === 1) orders[i] = { tx: a * 0.79, ty: -side * 0.06 + sway(i, 0.04), urgency: 0.55 }
          else orders[i] = { tx: a * 0.62, ty: -side * 0.2, urgency: 0.55 }
        } else {
          const dy = slot === 3 ? -0.36 : 0.36
          const strongD = (side < 0 && slot === 3) || (side > 0 && slot === 4)
          if (strongD && pinch > 0.6 && adv > 0.55) {
            orders[i] = { tx: a * 0.56, ty: side * 0.66, urgency: 0.6 }
          } else {
            orders[i] = { tx: a * 0.3, ty: dy + sway(i, 0.09), urgency: 0.5 }
          }
        }
        break
      }
    }

    // Stay onside: never camp beyond the offensive blue line before the puck.
    // The clamp point is an ARRIVAL (through stripped): blowing through it at
    // full speed would overshoot across the line.
    if (adv < O_BLUE && orders[i].tx * a > 0.23) {
      orders[i] = { tx: a * 0.23, ty: orders[i].ty, urgency: orders[i].urgency }
    }
    void r
  })

  // Duplicate slots (6-skater units) spread out instead of stacking.
  const seen = new Map<number, number>()
  unit.skaters.forEach((_, i) => {
    const slot = unit.slots[i]
    const n = seen.get(slot) ?? 0
    seen.set(slot, n + 1)
    if (n > 0) orders[i] = { ...orders[i], ty: clamp(orders[i].ty + 0.24, -0.95, 0.95) }
  })
  return orders
}

/** Where the carrier skates the puck, by phase. */
function carrierOrder(
  slot: number,
  phase: Phase,
  a: number,
  side: number,
  adv: number,
  puck: XY,
  tactics: TeamTactics,
  t: number
): MoveOrder {
  const pace = tactics.tempo.pace
  switch (phase) {
    case 'breakout':
      // Skate it out up the side you retrieved on — with PURPOSE. Real teams
      // exit their zone in seconds; dawdling here is what skews zone time.
      // Pass-through: the exit waypoint is a gate, not a parking spot.
      return {
        tx: -a * 0.1,
        ty: clamp(puck.y * 0.7, -0.55, 0.55),
        urgency: 0.78 + pace * 0.22,
        through: true
      }
    case 'neutral':
      // Carry pace through neutral ice — never coast to a stop at center.
      return { tx: a * 0.32, ty: clamp(puck.y, -0.5, 0.5), urgency: 0.65 + pace * 0.3, through: true }
    case 'entry':
      // Drive wide around the D's gap, then cut toward the dot — at speed.
      return adv < 0.45
        ? { tx: a * 0.62, ty: side * 0.48, urgency: 0.9, through: true }
        : { tx: a * 0.8, ty: side * 0.18, urgency: 0.9, through: true }
    case 'rush':
      return adv < 0.4
        ? { tx: a * 0.6, ty: side * 0.4, urgency: 1, through: true }
        : { tx: a * 0.82, ty: side * 0.14, urgency: 1, through: true }
    default: {
      // Cycle: D at the point walk the line; forwards protect it on the wall
      // or curl off the corner; behind the net they hold and survey.
      if (adv < 0.45) return { tx: a * 0.3, ty: clamp(puck.y, -0.45, 0.45) + 0.1 * Math.sin(t), urgency: 0.4 }
      if (adv > 0.86 && Math.abs(puck.y) < 0.3) return { tx: a * 0.9, ty: -side * 0.16, urgency: 0.5 }
      void slot
      return { tx: a * 0.78, ty: side * 0.6, urgency: 0.5 }
    }
  }
}

// ---------------------------------------------------------------------------
// Defending team
// ---------------------------------------------------------------------------

export interface DefendCtx {
  unit: Unit
  /** The ATTACKER's attack sign — the defended net sits at x = a. */
  a: number
  /** The attacker's possession phase. */
  phase: Phase
  puck: XY
  attackers: RSkater[]
  /** Index of the carrier in `attackers`, -1 when loose. */
  carrierIdx: number
  tactics: TeamTactics
  pk: boolean
  rushOddMan: boolean
  t: number
}

/** PK spots per formation for F/D groups, collapsed slightly to the puck side. */
function pkOrder(
  f: PenaltyKillFormation,
  a: number,
  side: number,
  isFwd: boolean,
  rankInGroup: number,
  fwdCount: number
): { x: number; y: number } {
  if (fwdCount <= 1) {
    // 3-man kill: triangle — one F up top, two D at the posts.
    if (isFwd) return { x: a * 0.55, y: side * 0.06 }
    return { x: a * 0.83, y: rankInGroup === 0 ? -0.22 : 0.22 }
  }
  if (f === 'diamond') {
    if (isFwd) return rankInGroup === 0 ? { x: a * 0.48, y: side * 0.06 } : { x: a * 0.7, y: -side * 0.32 }
    return rankInGroup === 0 ? { x: a * 0.7, y: side * 0.34 } : { x: a * 0.87, y: 0 }
  }
  // box / aggressive: two up, two down.
  if (isFwd) return { x: a * 0.55, y: (rankInGroup === 0 ? -0.26 : 0.26) + side * 0.08 }
  return { x: a * 0.81, y: (rankInGroup === 0 ? -0.22 : 0.22) + side * 0.08 }
}

export function defenderOrders(c: DefendCtx): MoveOrder[] {
  const { unit, a, phase, puck, attackers, carrierIdx, tactics, pk, rushOddMan, t } = c
  const adv = puck.x * a
  const side = puck.y >= 0 ? 1 : -1
  const sway = (i: number, amp: number): number => amp * Math.sin(t * 0.6 + i * 1.9)
  const orders: MoveOrder[] = new Array(unit.skaters.length)
  const carrierPos = carrierIdx >= 0 ? attackers[carrierIdx].pos : puck

  const fwd: number[] = []
  const dee: number[] = []
  unit.skaters.forEach((_, i) => (unit.slots[i] < 3 ? fwd.push(i) : dee.push(i)))
  const byDistToPuck = (idxs: number[]): number[] =>
    [...idxs].sort(
      (x, y) =>
        (unit.skaters[x].pos.x - puck.x) ** 2 +
        (unit.skaters[x].pos.y * 0.18 - puck.y * 0.18) ** 2 -
        ((unit.skaters[y].pos.x - puck.x) ** 2 + (unit.skaters[y].pos.y * 0.18 - puck.y * 0.18) ** 2)
    )

  // --- Rush against: D gap control, forwards backcheck hard. -------------
  if (phase === 'rush' || (phase === 'entry' && rushOddMan)) {
    // Most dangerous off-puck attacker (deepest toward our net).
    let threatIdx = -1
    let threatAdv = -2
    attackers.forEach((r, i) => {
      if (i === carrierIdx) return
      const v = r.pos.x * a
      if (v > threatAdv) {
        threatAdv = v
        threatIdx = i
      }
    })
    const netX = a * 0.89
    const gapPoint = (from: XY, gapN: number): { x: number; y: number } => {
      const dx = netX - from.x
      const dy = 0 - from.y
      const len = Math.hypot(dx, dy) || 1
      return { x: from.x + (dx / len) * gapN, y: from.y + (dy / len) * gapN }
    }
    const dSorted = byDistToPuck(dee)
    unit.skaters.forEach((_, i) => {
      if (dSorted[0] === i) {
        const g = gapPoint(carrierPos, 0.16)
        orders[i] = { tx: g.x, ty: g.y, urgency: 1 }
      } else if (dSorted[1] === i && threatIdx >= 0) {
        const g = gapPoint(attackers[threatIdx].pos, 0.1)
        orders[i] = { tx: g.x, ty: g.y, urgency: 1 }
      } else if (unit.slots[i] < 3) {
        const lane = unit.slots[i] === 0 ? -0.4 : unit.slots[i] === 2 ? 0.4 : 0
        orders[i] = { tx: a * clamp(adv + 0.35, 0.2, 0.6), ty: lane, urgency: 1 }
      } else {
        const g = gapPoint(carrierPos, 0.22)
        orders[i] = { tx: g.x, ty: g.y, urgency: 1 }
      }
    })
    return orders
  }

  // --- Penalty kill in our zone: hold the box/diamond/triangle. ----------
  if (pk && adv > 0.4) {
    const f = tactics.specialTeams.penaltyKill
    const presser = f === 'aggressive' ? nearestOf(unit, puck) : -1
    fwd.forEach((i, rank) => {
      const s = pkOrder(f, a, side, true, rank, fwd.length)
      orders[i] = { tx: s.x, ty: s.y + sway(i, 0.03), urgency: 0.7 }
    })
    dee.forEach((i, rank) => {
      const s = pkOrder(f, a, side, false, rank, fwd.length)
      orders[i] = { tx: s.x, ty: s.y + sway(i, 0.03), urgency: 0.7 }
    })
    if (presser >= 0) orders[presser] = { tx: carrierPos.x, ty: carrierPos.y, urgency: 0.95 }
    return orders
  }

  // --- In-zone coverage (attacker established). ---------------------------
  if (adv > 0.3 && (phase === 'cycle' || phase === 'entry')) {
    if (tactics.dZoneCoverage === 'man') {
      // Each defender shadows a distinct attacker, body between man and net.
      const taken = new Set<number>()
      unit.skaters.forEach((r, i) => {
        let pick = -1
        let bd = Infinity
        attackers.forEach((atk, j) => {
          if (taken.has(j)) return
          const d = (r.pos.x - atk.pos.x) ** 2 + (r.pos.y - atk.pos.y) ** 2
          if (d < bd) {
            bd = d
            pick = j
          }
        })
        if (pick < 0) {
          orders[i] = { tx: a * 0.8, ty: 0, urgency: 0.7 }
          return
        }
        taken.add(pick)
        const m = attackers[pick].pos
        const toNetX = a * 0.89 - m.x
        const toNetY = -m.y
        const len = Math.hypot(toNetX, toNetY) || 1
        orders[i] = {
          tx: m.x + (toNetX / len) * 0.05,
          ty: m.y + (toNetY / len) * 0.05,
          urgency: pick === carrierIdx ? 0.95 : 0.8
        }
      })
      return orders
    }
    // Zone / hybrid: box+1 — nearest man pressures, four collapse on a box
    // shifted to the puck side.
    const presser = nearestOf(unit, puck)
    const spots = [
      { x: a * 0.52, y: -0.3 + side * 0.1 },
      { x: a * 0.52, y: 0.3 + side * 0.1 },
      { x: a * 0.8, y: -0.16 + side * 0.08 },
      { x: a * 0.8, y: 0.16 + side * 0.08 }
    ]
    let next = 0
    const fill = (i: number): void => {
      const s = spots[Math.min(next++, spots.length - 1)]
      // Collapse slightly toward the puck so the box breathes with the cycle.
      orders[i] = {
        tx: s.x + (puck.x - s.x) * 0.12,
        ty: s.y + (puck.y - s.y) * 0.12 + sway(i, 0.03),
        urgency: 0.7
      }
    }
    for (const i of fwd) if (i !== presser) fill(i)
    for (const i of dee) if (i !== presser) fill(i)
    if (presser >= 0) orders[presser] = { tx: carrierPos.x, ty: carrierPos.y, urgency: 0.95 }
    return orders
  }

  // --- Forecheck: the puck is deep in the attacker's own end. -------------
  if (adv < -0.25) {
    const f: ForecheckSystem = tactics.forecheck
    const fSorted = byDistToPuck(fwd)
    unit.skaters.forEach((_, i) => {
      const rank = fSorted.indexOf(i)
      if (rank === 0) {
        // F1 angles the puck carrier (trap only token-pressures).
        orders[i] =
          f === 'trap'
            ? { tx: -a * 0.34, ty: clamp(puck.y * 0.5, -0.4, 0.4), urgency: 0.55 }
            : { tx: carrierPos.x, ty: carrierPos.y, urgency: 0.9 }
      } else if (rank === 1) {
        if (f === '2-1-2') orders[i] = { tx: -a * 0.72, ty: -side * 0.4, urgency: 0.85 }
        else if (f === 'trap') orders[i] = { tx: -a * 0.02, ty: -0.4, urgency: 0.6 }
        else orders[i] = { tx: -a * 0.22, ty: -0.45, urgency: 0.65 }
      } else if (rank === 2) {
        if (f === '2-1-2') orders[i] = { tx: -a * 0.3, ty: sway(i, 0.08), urgency: 0.7 }
        else if (f === 'trap') orders[i] = { tx: -a * 0.02, ty: 0.4, urgency: 0.6 }
        else orders[i] = { tx: -a * 0.22, ty: 0.45, urgency: 0.65 }
      } else {
        // D hold the middle: higher up ice for 2-1-2, deep for the trap.
        const dy = unit.slots[i] === 3 ? -0.28 : 0.28
        const dx = f === '2-1-2' ? -0.02 : f === 'trap' ? 0.3 : 0.12
        orders[i] = { tx: a * dx, ty: dy, urgency: 0.6 }
      }
    })
    return orders
  }

  // --- Neutral zone: 1-2-2 backpressure or the trap's wall of bodies. -----
  const fSorted = byDistToPuck(fwd)
  unit.skaters.forEach((_, i) => {
    const rank = fSorted.indexOf(i)
    if (rank === 0) {
      orders[i] = { tx: carrierPos.x, ty: carrierPos.y, urgency: tactics.forecheck === 'trap' ? 0.7 : 0.85 }
    } else if (unit.slots[i] < 3) {
      const lane = rank === 1 ? -0.42 : 0.42
      const x = tactics.forecheck === 'trap' ? a * 0.08 : a * 0.02
      orders[i] = { tx: x, ty: lane, urgency: 0.7 }
    } else {
      // D gap up at the blue line, shading the carrier's lane.
      const dy = (unit.slots[i] === 3 ? -0.26 : 0.26) + side * 0.06
      orders[i] = { tx: a * clamp(adv + 0.28, 0.18, 0.45), ty: dy, urgency: 0.75 }
    }
  })
  return orders
}

function nearestOf(unit: Unit, p: XY): number {
  let best = -1
  let bd = Infinity
  unit.skaters.forEach((r, i) => {
    const d = (r.pos.x - p.x) ** 2 + (r.pos.y - p.y) ** 2
    if (d < bd) {
      bd = d
      best = i
    }
  })
  return best
}

// ---------------------------------------------------------------------------
// Faceoff formations (used while play is dead — skaters SKATE to their dots)
// ---------------------------------------------------------------------------

/** Faceoff formation per slot: distance behind the dot and lateral offset. */
const FACEOFF_OFFSETS: Record<number, { back: number; side: number }> = {
  0: { back: 0.06, side: -0.14 },
  1: { back: 0.03, side: 0 },
  2: { back: 0.06, side: 0.14 },
  3: { back: 0.2, side: -0.1 },
  4: { back: 0.2, side: 0.1 }
}

/** The spot skater `i` of `unit` lines up at for a faceoff at `dot`. */
export function faceoffSpot(unit: Unit, i: number, attackSign: number, dot: XY, takerIdx: number): XY {
  if (i === takerIdx) return { x: dot.x - attackSign * 0.02, y: dot.y }
  // Count duplicate slots before i so doubled-up slots stagger backward.
  const slot = unit.slots[i]
  let dup = 0
  for (let j = 0; j < i; j++) if (unit.slots[j] === slot && j !== takerIdx) dup++
  const off = FACEOFF_OFFSETS[slot]
  return {
    x: clamp(dot.x - attackSign * (off.back + dup * 0.09), -0.95, 0.95),
    y: clamp(dot.y + off.side * (1 + dup * 0.6), -0.92, 0.92)
  }
}

export function faceoffOrders(unit: Unit, attackSign: number, dot: XY, takerIdx: number): MoveOrder[] {
  return unit.skaters.map((_, i) => {
    const s = faceoffSpot(unit, i, attackSign, dot, takerIdx)
    return { tx: s.x, ty: s.y, urgency: 0.75 }
  })
}
