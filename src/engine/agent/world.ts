/**
 * Shared state types for the agent engine: the two sides on the ice, the puck,
 * and who controls it. Kept separate so the brain (decisions) and the sim
 * (rules, events, physics loop) can both read it without a module cycle.
 */
import type { DekeKind, TeamTactics, XY } from '@domain'
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
  /** Delayed offside against this side: its men in the zone must tag up. */
  delayedOffside: Side | null
  /** Clock time the side in control won the puck (transition detection). */
  possSince: number
  /** Where (x in the controlling side's attack frame, ft) that possession began. */
  possStartAdv: number
  /** Since when the current carrier has had the puck within 30 ft of the net he attacks (-1: not in close). */
  nearSince: number
  nearBy: Body | null
}

export type CarrierAction =
  | { kind: 'carry'; cmd: MoveCmd; protect: boolean }
  | { kind: 'pass'; to: Body; at: XY; speed: number; oneTimer: boolean }
  | { kind: 'shoot' }
  | { kind: 'dump'; at: XY; speed: number; lift: number }
  /** A 1-on-1 move on a defender (`goalie` false) or the goalie; `dir` is the side (±1) he goes to. */
  | { kind: 'deke'; on: Body; goalie: boolean; move: DekeKind; p: number; dir: number }

export function sideOf(w: World, b: Body): Side | null {
  for (const s of w.sides) if (s.skaters.includes(b) || s.goalie === b) return s
  return null
}

export function other(w: World, s: Side): Side {
  return w.sides[0] === s ? w.sides[1] : w.sides[0]
}

/**
 * The game's rating LEVEL. Outcomes that read a rating (pass aim, fumbles,
 * stick checks, blocks, misses…) read it relative to the level of the two
 * rosters on the ice, so a league whose ratings all sit lower (a fictional
 * or minor league) plays the same hockey as the NHL instead of a game full
 * of fumbles and missed passes. Set once per period by the sim; `REF` is the
 * NHL (imported real-roster) level.
 */
export const LEVEL = { offset: 0, def: 0 }
const LEVEL_REF = 66.5
/** NHL level of the checking family (stick checking, blocking, body checking, positioning). */
const LEVEL_DEF_REF = 59

export function levelOffset(players: readonly { composites: { scoring: number; puckControl: number; skating: number } }[]): number {
  if (players.length === 0) return 0
  let s = 0
  for (const p of players) s += (p.composites.scoring + p.composites.puckControl + p.composites.skating) / 3
  return s / players.length - LEVEL_REF
}

/**
 * Checking-family level: in the imported NHL data the defensive ratings sit
 * ~10 points under the offensive ones, in the generated league they do not,
 * so the two families get their own level (one offset would make the
 * generated league's checkers ten points too good).
 */
export function levelDefOffset(players: readonly { ratings: { defensive: { stickChecking: number; shotBlocking: number; checking: number }; mental: { positioning: number } } }[]): number {
  if (players.length === 0) return 0
  let s = 0
  for (const p of players) s += (p.ratings.defensive.stickChecking + p.ratings.defensive.shotBlocking + p.ratings.defensive.checking + p.ratings.mental.positioning) / 4
  return s / players.length - LEVEL_DEF_REF
}

/** A checking-family rating as 0..1, relative to the game's checking level. */
export function rDef(v: number | undefined): number {
  const x = ((v ?? 50) - LEVEL.def) / 100
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/** A 0–100 rating as 0..1, relative to the game's level. */
export function rLevel(v: number | undefined): number {
  const x = ((v ?? 50) - LEVEL.offset) / 100
  return x < 0 ? 0 : x > 1 ? 1 : x
}
