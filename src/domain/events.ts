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
  /** Additive (agent engine): the centre who lost the draw. */
  loser?: PlayerRef
  /**
   * Additive (agent engine): period clock (s) at which every skater was set
   * on his spot and the linesman could drop the puck — the lining-up phase
   * runs from the whistle to `setAt`, the drop is at `t`.
   */
  setAt?: number
  /** Additive (agent engine): neither centre won it clean — a tie-up / scrum at the dot before the puck squirts out. */
  tieUp?: boolean
}

export type CarryEvent = GameEventBase & {
  type: 'carry'
  player: PlayerRef
  from: XY
  to: XY
}

/** How a pass was played (additive; agent engine). */
export type PassKind = 'tape' | 'saucer' | 'stretch' | 'dToD' | 'drop' | 'rim' | 'oneTimerFeed'

export type PassEvent = GameEventBase & {
  type: 'pass'
  from: PlayerRef
  to: PlayerRef
  a: XY
  b: XY
  completed: boolean
  /** Additive (agent engine): release speed in mph. */
  speedMph?: number
  /** Additive (agent engine): what kind of pass it was. */
  kind?: PassKind
  /** Additive (agent engine): the opponent who picked it off, when not completed. */
  interceptedBy?: PlayerRef
}

/** How a shot was released (additive; agent engine). */
export type ShotType = 'wrist' | 'snap' | 'slap' | 'backhand' | 'oneTimer' | 'tip'

/** Where a shot came from, as the engine decided it (additive; agent engine). */
export type ShotOrigin = 'rush' | 'cycle' | 'point' | 'rebound' | 'oneTimer' | 'scramble'

export type ShotEvent = GameEventBase & {
  type: 'shot'
  shooter: PlayerRef
  from: XY
  target: XY
  /** 0..1 shot quality; drives sim outcome AND renderer drama cues. */
  danger: number
  /** Additive (agent engine): release type, speed in mph, origin, odd-man count. */
  shotType?: ShotType
  speedMph?: number
  origin?: ShotOrigin
  oddMan?: { attackers: number; defenders: number }
}

/**
 * Additive variant (agent engine): an unblocked attempt that MISSED the net —
 * wide, high, or off the iron. Not a shot on goal (box scores ignore it; the
 * NHL records ~14 per team-game).
 */
export type MissedShotEvent = GameEventBase & {
  type: 'missedShot'
  shooter: PlayerRef
  from: XY
  /** Where it went by the net (goal-line coordinates). */
  target: XY
  result: 'wide' | 'high' | 'post'
  shotType?: ShotType
  speedMph?: number
}

/**
 * Additive variant (agent engine): a contested puck — along the boards, in
 * front of the net, or loose — fought over by both teams, and who came out
 * with it (null when the whistle went first).
 */
export type BattleEvent = GameEventBase & {
  type: 'battle'
  kind: 'boards' | 'netFront' | 'loosePuck'
  pos: XY
  players: PlayerRef[]
  winner: PlayerRef | null
  durationS: number
}

/** The move a puck carrier puts on a defender or the goalie. */
export type DekeKind = 'forehandBackhand' | 'toeDrag' | 'shoulderFake' | 'wide'

/**
 * Additive variant (agent engine): a carrier's 1-on-1 move, emitted when the
 * move STARTS. It plays out over ~0.4–0.7 s of game time before the shot or
 * pass that follows it (renderers animate the stickhandle across that window).
 * `on` is the defender or goalie it was put on; `success` is whether he was
 * beaten (a failed deke ends in a poke check / takeaway or a smother).
 */
export type DekeEvent = GameEventBase & {
  type: 'deke'
  by: PlayerRef
  on?: PlayerRef
  kind: DekeKind
  success: boolean
  pos: XY
}

/**
 * Additive variant (agent engine): a defender's stick-reach attempt to take
 * the puck off a carrier (poke / stick lift / sweep), whether it worked or
 * not. A successful one is usually followed by a takeaway.
 */
export type PokeCheckEvent = GameEventBase & {
  type: 'pokeCheck'
  by: PlayerRef
  on: PlayerRef
  success: boolean
  pos: XY
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

/** What kind of check it was (additive; agent engine). */
export type HitKind = 'boards' | 'openIce' | 'finish' | 'battle'

export type HitEvent = GameEventBase & {
  type: 'hit'
  by: PlayerRef
  on: PlayerRef
  pos: XY
  /** Additive (agent engine): impact 0 (a bump) … 1 (a thunderous hit). */
  force?: number
  /** Additive (agent engine): boards pin / open ice / finishing a check / a battle collision. */
  kind?: HitKind
  /** Additive (agent engine): the target had the puck (or had just moved it). */
  targetHadPuck?: boolean
  /** Additive (agent engine): the target went off his feet (down for ~1–1.5 s). */
  knockdown?: boolean
  /** Additive (agent engine): the target was pinned against the boards after the hit. */
  pinned?: boolean
}

export type PenaltyEvent = GameEventBase & {
  type: 'penalty'
  player: PlayerRef
  infraction: string
  minutes: number
  /** Additive (agent engine): the player who drew the penalty. */
  drawnBy?: PlayerRef
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
  /** Additive (agent engine): changed during live play (true) vs at a whistle. */
  onTheFly?: boolean
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
  /**
   * Additive (agent engine): body facing in radians (atan2 in rink feet; 0 =
   * toward +x). Differs from the direction of travel when a defenceman skates
   * backward or a player pivots — renderers may use it to orient the rig.
   */
  facing?: number
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
  /** Additive (agent engine): puck height above the ice in feet (chips, saucers, clears). */
  puckZ?: number
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
  | MissedShotEvent
  | BattleEvent
  | DekeEvent
  | PokeCheckEvent

export type GameEventType = GameEvent['type']

/** A full game (or a slice of one) as the ordered stream every consumer reads. */
export type GameStream = GameEvent[]

/** Narrowing helper for consumers that switch on a single variant. */
export const isEvent = <T extends GameEventType>(
  ev: GameEvent,
  type: T
): ev is Extract<GameEvent, { type: T }> => ev.type === type
