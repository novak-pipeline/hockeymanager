import type { XY, Zone } from './geometry'
import type { PlayerRef, TeamRef } from './ids'

/**
 * THE KEYSTONE (see docs/ARCHITECTURE.md §4).
 *
 * Everything reads from this stream. Both engines emit it; both renderers, the
 * box-score builder, and the calibrator consume it. This contract must not need
 * a rewrite — variants may be ADDED over time, but existing variant shapes are
 * frozen.
 *
 *   - The full-fidelity engine emits the dense stream (positions on every
 *     event → animatable).
 *   - The quick-sim engine emits a sparse subset of the SAME type (shots, goals,
 *     penalties; no carry/pass positions) — same contract, less resolution.
 *
 * Renderers never compute outcomes. They interpolate positions between events
 * and play canned animations keyed off `type`. That rule is enforced here by
 * the type system: a renderer is handed `GameEvent[]` and nothing else.
 */

/** Strength state a goal was scored under. */
export type GoalStrength = 'ev' | 'pp' | 'sh' | 'en'

/**
 * Fields on every event.
 *   t      — game-clock seconds elapsed within the period.
 *   period — 1..3 for regulation, 4+ for overtime periods.
 */
export interface GameEventBase {
  t: number
  period: number
}

export type FaceoffEvent = GameEventBase & {
  type: 'faceoff'
  zone: Zone
  winner: PlayerRef
  pos: XY
}

export type CarryEvent = GameEventBase & {
  type: 'carry'
  player: PlayerRef
  from: XY
  to: XY
}

export type PassEvent = GameEventBase & {
  type: 'pass'
  from: PlayerRef
  to: PlayerRef
  a: XY
  b: XY
  completed: boolean
}

export type ShotEvent = GameEventBase & {
  type: 'shot'
  shooter: PlayerRef
  from: XY
  target: XY
  /** 0..1 shot quality; drives sim outcome AND renderer drama cues. */
  danger: number
}

export type SaveEvent = GameEventBase & {
  type: 'save'
  goalie: PlayerRef
  rebound: boolean
  pos: XY
}

export type GoalEvent = GameEventBase & {
  type: 'goal'
  scorer: PlayerRef
  assists: PlayerRef[]
  strength: GoalStrength
  pos: XY
}

export type HitEvent = GameEventBase & {
  type: 'hit'
  by: PlayerRef
  on: PlayerRef
  pos: XY
}

export type PenaltyEvent = GameEventBase & {
  type: 'penalty'
  player: PlayerRef
  infraction: string
  minutes: number
}

export type TakeawayEvent = GameEventBase & {
  type: 'takeaway'
  by: PlayerRef
  from: PlayerRef
  pos: XY
}

export type GiveawayEvent = GameEventBase & {
  type: 'giveaway'
  player: PlayerRef
  pos: XY
}

export type BlockedShotEvent = GameEventBase & {
  type: 'blockedShot'
  shooter: PlayerRef
  blocker: PlayerRef
  pos: XY
}

export type LineChangeEvent = GameEventBase & {
  type: 'lineChange'
  team: TeamRef
  onIce: PlayerRef[]
}

/** Why play stopped — additive optional field; consumers must tolerate absence. */
export type StoppageReason = 'offside' | 'icing' | 'goalieFreeze' | 'penalty' | 'goal' | 'other'

export type StoppageEvent = GameEventBase & {
  type: 'whistle' | 'periodEnd' | 'gameEnd'
  pos?: XY
  reason?: StoppageReason
}

/** One skater's position at a single tick. */
export interface SkaterSnapshot {
  player: PlayerRef
  pos: XY
}

/**
 * A positional snapshot of the whole sheet at one tick. Only the full-fidelity
 * engine emits these (the quick-sim omits them). Renderers interpolate puck and
 * skater positions between consecutive frames; discrete events (shot/goal/hit)
 * are layered on top as animation cues.
 */
export type FrameEvent = GameEventBase & {
  type: 'frame'
  home: SkaterSnapshot[]
  away: SkaterSnapshot[]
  homeGoalie: SkaterSnapshot
  awayGoalie: SkaterSnapshot
  puck: XY
  puckCarrier: PlayerRef | null
}

export type GameEvent =
  | FaceoffEvent
  | CarryEvent
  | PassEvent
  | ShotEvent
  | SaveEvent
  | GoalEvent
  | HitEvent
  | PenaltyEvent
  | TakeawayEvent
  | GiveawayEvent
  | BlockedShotEvent
  | LineChangeEvent
  | StoppageEvent
  | FrameEvent

export type GameEventType = GameEvent['type']

/** A full game (or a slice of one) as the ordered stream every consumer reads. */
export type GameStream = GameEvent[]

/** Narrowing helper for consumers that switch on a single variant. */
export const isEvent = <T extends GameEventType>(
  ev: GameEvent,
  type: T
): ev is Extract<GameEvent, { type: T }> => ev.type === type
