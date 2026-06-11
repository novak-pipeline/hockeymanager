/**
 * THE PLAYBOOK — *how a beat looks*.
 *
 * The director (director.ts) decides WHAT happens; this file is the
 * choreographer that renders each beat as an authored, visually legible play:
 * role-based waypoint routes layered over the base team shapes in
 * formations.ts, executed through the same speed-capped steer() movement (the
 * per-tick displacement invariant is untouched — these are only TARGETS).
 *
 * Authored plays:
 *   BREAKOUT_WHEEL     D retrieves behind his net and wheels up the wall;
 *                      wingers post the half-walls, C swings low (base shape).
 *   BREAKOUT_RIM       under forecheck heat: carrier hugs the strong-side
 *                      wall and rims it rather than skating into pressure.
 *   NZ_REGROUP         D-to-D lateral settle, lanes filled, weak-side
 *                      stretch option when passRisk allows (base shape).
 *   ENTRY_CARRY_WIDE   carrier drives the dot lane; every trailer is clamped
 *                      ONSIDE — nobody crosses the line before the puck.
 *   ENTRY_DUMP_CHASE   cross-corner rim, designated F1 sprints the race.
 *   OFFSIDE_FAIL       the failure made readable: a winger flies the zone
 *                      ahead of the puck while the carrier hits the line late.
 *   OZ_CYCLE           wall–corner–net rotation with a net-front body and the
 *                      D walking the line / pinching per tactics (base shape).
 *   POINT_SHOT_SCREEN  D walks the middle of the line; one F plants a
 *                      net-front screen, another fills the tip/rebound lane.
 *   SEAM_ONE_TIMER     weak-side F sneaks to the back-door slot for the
 *                      royal-road feed.
 *   RUSH_ODDMAN        2-on-1 / 3-on-2 lanes filled at full speed (base rush
 *                      shape; the defending D gap-control in formations.ts).
 *   WRAPAROUND_JAM     carrier dives below the goal line and wraps to the far
 *                      post while the forwards crash.
 *   REBOUND_CRASH      both wingers attack the blue paint on a loose rebound.
 *   DZ_CLEAR           under siege: get it out (breakout shape, no frills).
 *
 * The defending side simultaneously runs its counter-template from
 * formations.ts: DZ box+1 / man coverage, 1-2-2 / 2-1-2 / trap forechecks,
 * PK box / diamond, rush gap control — and PP umbrella / 1-3-1 / overload plus
 * FACEOFF setups at the nine dots live there too.
 */
import type { TeamTactics, XY } from '@domain'
import type { MoveOrder } from './movement'
import { attackerOrders } from './formations'
import { clamp, O_BLUE, type Phase, type Unit } from './types'

export type PlayId =
  | 'BREAKOUT_WHEEL'
  | 'BREAKOUT_RIM'
  | 'NZ_REGROUP'
  | 'ENTRY_CARRY_WIDE'
  | 'ENTRY_DUMP_CHASE'
  | 'OFFSIDE_FAIL'
  | 'OZ_CYCLE'
  | 'POINT_SHOT_SCREEN'
  | 'SEAM_ONE_TIMER'
  | 'RUSH_ODDMAN'
  | 'WRAPAROUND_JAM'
  | 'REBOUND_CRASH'
  | 'DZ_CLEAR'

/** The base team shape each play is choreographed on top of. */
export function phaseForPlay(play: PlayId): Phase {
  switch (play) {
    case 'BREAKOUT_WHEEL':
    case 'BREAKOUT_RIM':
    case 'DZ_CLEAR':
      return 'breakout'
    case 'NZ_REGROUP':
      return 'neutral'
    case 'ENTRY_CARRY_WIDE':
    case 'ENTRY_DUMP_CHASE':
    case 'OFFSIDE_FAIL':
      return 'entry'
    case 'RUSH_ODDMAN':
      return 'rush'
    default:
      return 'cycle'
  }
}

export interface PlayCtx {
  unit: Unit
  /** Attack direction sign: this team shoots at the net at x = a. */
  a: number
  puck: XY
  /** Index of the carrier in unit.skaters, -1 when the puck is loose/in flight. */
  carrierIdx: number
  tactics: TeamTactics
  /** True man advantage with the puck established in the zone → PP set play. */
  ppSetup: boolean
  /** Game-clock seconds (deterministic sway). */
  t: number
  play: PlayId
  /** Ticks elapsed in the current beat — sequences routes within a play. */
  beatTicks: number
  /** Strong side (sign of puck.y) frozen at beat start. */
  side: number
  /** Play-specific featured skater (offside winger, seam receiver, F1 chaser). */
  targetIdx: number
  /** Regroup dwell: the carrier settles in neutral ice instead of attacking. */
  hold: boolean
}

/**
 * Orders for the attacking five: the base formation shape for the play's
 * phase, then the play's authored waypoint overrides on top.
 */
export function attackPlayOrders(c: PlayCtx): MoveOrder[] {
  const { unit, a, puck, carrierIdx, play, beatTicks, side, targetIdx } = c
  const orders = attackerOrders({
    unit,
    a,
    phase: phaseForPlay(play),
    puck,
    carrierIdx,
    tactics: c.tactics,
    ppSetup: c.ppSetup,
    t: c.t
  })
  // The PP set play (umbrella / 1-3-1 / overload) overrides everything.
  if (c.ppSetup) return orders
  const adv = puck.x * a

  switch (play) {
    case 'BREAKOUT_WHEEL': {
      // The retrieving D wheels BEHIND the net first, then up the wall —
      // the most recognizable breakout in hockey.
      if (carrierIdx >= 0 && beatTicks < 7 && adv < -0.55) {
        orders[carrierIdx] = { tx: -a * 0.9, ty: side * 0.18, urgency: 0.75 }
      }
      break
    }
    case 'BREAKOUT_RIM': {
      // Under pressure: hug the strong-side wall and get it moving north.
      if (carrierIdx >= 0) {
        orders[carrierIdx] = { tx: -a * 0.35, ty: side * 0.78, urgency: 0.85 }
      }
      break
    }
    case 'NZ_REGROUP': {
      // While the regroup dwell holds, the carrier settles laterally (the
      // D-to-D look) instead of forcing the line; then the unit attacks.
      if (carrierIdx >= 0 && c.hold && adv < 0.12) {
        orders[carrierIdx] = {
          tx: a * 0.06,
          ty: clamp(puck.y - side * 0.25, -0.5, 0.5),
          urgency: 0.55
        }
      }
      break
    }
    case 'ENTRY_CARRY_WIDE': {
      // Carrier attacks the dot lane at speed. Trailers are already clamped
      // onside by the base shape (nobody's target crosses the line before
      // the puck) — re-assert it here so the template enforces the rule.
      if (carrierIdx >= 0) {
        orders[carrierIdx] =
          adv < 0.45
            ? { tx: a * 0.6, ty: side * 0.52, urgency: 0.95 }
            : { tx: a * 0.8, ty: side * 0.22, urgency: 0.95 }
      }
      if (adv < O_BLUE) {
        unit.skaters.forEach((_, i) => {
          if (i !== carrierIdx && orders[i].tx * a > 0.22) {
            orders[i] = { ...orders[i], tx: a * 0.22 }
          }
        })
      }
      break
    }
    case 'ENTRY_DUMP_CHASE': {
      // F1 sprints the cross-corner race the instant the rim goes in.
      if (targetIdx >= 0 && targetIdx !== carrierIdx) {
        orders[targetIdx] = { tx: a * 0.88, ty: -side * 0.6, urgency: 1 }
      }
      break
    }
    case 'OFFSIDE_FAIL': {
      // The readable failure: the designated winger flies the zone ahead of
      // the puck (deliberately NOT onside-clamped) while the carrier arrives
      // at the line a beat late.
      if (targetIdx >= 0 && targetIdx !== carrierIdx) {
        orders[targetIdx] = { tx: a * 0.52, ty: -side * 0.35, urgency: 1 }
      }
      if (carrierIdx >= 0) {
        orders[carrierIdx] = { tx: a * 0.3, ty: side * 0.5, urgency: 0.6 }
      }
      break
    }
    case 'POINT_SHOT_SCREEN': {
      // D walks to the middle of the line; F1 plants the screen in the
      // goalie's eyes; F2 lurks at the tip/rebound lane.
      const fwds: number[] = []
      unit.skaters.forEach((_, i) => {
        if (i !== carrierIdx && unit.slots[i] < 3) fwds.push(i)
      })
      if (fwds[0] !== undefined) orders[fwds[0]] = { tx: a * 0.86, ty: 0.02, urgency: 0.85 }
      if (fwds[1] !== undefined) orders[fwds[1]] = { tx: a * 0.78, ty: -side * 0.16, urgency: 0.8 }
      if (carrierIdx >= 0 && unit.slots[carrierIdx] >= 3) {
        orders[carrierIdx] = { tx: a * 0.32, ty: side * 0.1, urgency: 0.6 }
      }
      break
    }
    case 'SEAM_ONE_TIMER': {
      // The receiver sneaks back-door across the royal road; the carrier
      // holds the wall to freeze the box before threading the feed.
      if (targetIdx >= 0 && targetIdx !== carrierIdx) {
        orders[targetIdx] = { tx: a * 0.64, ty: -side * 0.28, urgency: 0.9 }
      }
      if (carrierIdx >= 0) {
        orders[carrierIdx] = { tx: a * 0.62, ty: side * 0.6, urgency: 0.5 }
      }
      break
    }
    case 'WRAPAROUND_JAM': {
      // Dive below the goal line, then wrap hard to the far post.
      if (carrierIdx >= 0) {
        orders[carrierIdx] =
          adv < 0.82 || beatTicks < 6
            ? { tx: a * 0.94, ty: side * 0.22, urgency: 0.9 }
            : { tx: a * 0.9, ty: -side * 0.04, urgency: 1 }
      }
      break
    }
    case 'REBOUND_CRASH': {
      // Everyone not on the puck attacks the blue paint.
      let crashed = 0
      unit.skaters.forEach((_, i) => {
        if (i === carrierIdx || unit.slots[i] >= 3) return
        orders[i] = { tx: a * 0.82, ty: crashed === 0 ? -0.12 : 0.12, urgency: 1 }
        crashed++
      })
      break
    }
    default:
      break
  }
  return orders
}
