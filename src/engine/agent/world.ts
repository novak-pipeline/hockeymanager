/**
 * Shared state types for the agent engine: the two sides on the ice, the puck,
 * and who controls it. Kept separate so the brain (decisions) and the sim
 * (rules, events, physics loop) can both read it without a module cycle.
 */
import type { TeamTactics, XY } from '@domain'
import type { Rng } from '@engine/shared/rng'
import type { TeamSim } from '@engine/full/fullSim'
import type { Body, MoveCmd, Puck } from './physics'

export interface Side {
  sim: TeamSim
  /** Attack sign this period: this side shoots at the net at x = a·89. */
  a: number
  /** On-ice skaters, aligned with sim.unit.skaters. */
  skaters: Body[]
  /** Formation slot per skater [0 LW, 1 C, 2 RW, 3 LD, 4 RD]. */
  slots: number[]
  goalie: Body
  tactics: TeamTactics
  /** Current role per skater (template role name or 'ONPUCK'/'CHASE'). */
  roles: Map<Body, string>
  /** The skater assigned to pressure the carrier (defending), if any. */
  presser: Body | null
  /** Clock time of this side's last zone entry. */
  entryAt: number
  shorthanded: boolean
  powerPlay: boolean
  pulled: boolean
  /** 3-on-3 overtime. */
  ot: boolean
}

export interface World {
  t: number
  rng: Rng
  puck: Puck
  /** Skater carrying the puck (null = loose or in flight). */
  carrier: Body | null
  /** Side of the current carrier. */
  control: Side | null
  /** Last side to touch the puck (possession for shape purposes while loose). */
  lastTouch: Side | null
  sides: [Side, Side]
  /** A puck in flight that has an intended receiver (pass). */
  passTo: Body | null
  /** Side that owns a puck in flight (pass/shot/dump). */
  flightSide: Side | null
  /** A one-timer is set: the receiver shoots on arrival. */
  oneTimerFor: Body | null
  /** Clock time each skater last had the puck on his stick (interference, finishing checks). */
  lastHad: Map<Body, number>
}

export type CarrierAction =
  | { kind: 'carry'; cmd: MoveCmd; protect: boolean }
  | { kind: 'pass'; to: Body; at: XY; speed: number; oneTimer: boolean }
  | { kind: 'shoot' }
  | { kind: 'dump'; at: XY; speed: number; lift: number }

export function sideOf(w: World, b: Body): Side | null {
  for (const s of w.sides) if (s.skaters.includes(b) || s.goalie === b) return s
  return null
}

export function other(w: World, s: Side): Side {
  return w.sides[0] === s ? w.sides[1] : w.sides[0]
}
