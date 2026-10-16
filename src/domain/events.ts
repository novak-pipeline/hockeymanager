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
  /**
   * Additive (agent engine, W3 S3): absolute PLAYBACK seconds since the opening
   * faceoff. The agent engine stops the period clock (`t`) at every whistle, as
   * the NHL does, while the line-up, the change and the celebration still take
   * real time on screen: `playT` keeps running through them. Consumers that
   * place events on a playback timeline (renderers, replays, detectors) use it
   * when present (see `playAbsT` in @domain/streamTime); box scores and clock
   * displays keep reading `t`. Absent → the event's place is period base + t.
   */
  playT?: number
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
  /** Additive (agent engine, W3 S3): `setAt` on the playback timeline (absolute s, like `playT`); the period clock is stopped while the men line up. */
  setPlayT?: number
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
  /** Additive (agent engine, W3 S2): seconds the passer was committed to the release before the puck left (its event time). */
  releaseS?: number
  /** Additive (agent engine, W3 S2): seconds the receiver needs to settle it (not his to use until then; one-timers 0). */
  settleS?: number
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
  /** Additive (agent engine, W2): seconds the shooter wound up (committed → release); renderers time the swing to it. */
  windupS?: number
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
  /** Additive (W2): seconds the shooter wound up (see ShotEvent.windupS). */
  windupS?: number
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
  /** Additive (agent engine, W3 S2): a tie-up's hold — both men committed this long before somebody won it. */
  holdS?: number
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
  /** Additive (agent engine, W3 S2): seconds the man hit is committed (stagger, fall and get-up, or pinned). */
  receiverS?: number
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

/**
 * What exactly stopped play (additive, agent engine, W3 S3) — finer than the
 * frozen `StoppageReason` union, which it leaves alone (owner decision: a
 * `detail` string, not a wider union). It also fixes where the faceoff goes
 * (NHL rule 76; see @engine/analysis/faceoffRule).
 */
export type StoppageDetail =
  | 'offsideCarried' // carried over the line with a man ahead: neutral-zone dot outside that zone
  | 'offsideTouch' // delayed offside, touched in the zone: neutral-zone dot outside that zone
  | 'offsideShot' // delayed offside, a shot on goal: the offending side's end
  | 'icing' // the icing side's end
  | 'goalieFreeze' // that goalie's end, the side the puck was on
  | 'puckOutOfPlay' // over the glass: nearest dot in that zone
  | 'boardPin' // frozen along the boards: nearest dot in that zone
  | 'misc' // high stick, hand pass, net off: nearest dot in that zone
  | 'penalty' // a penalty called: the offending side's end
  | 'fight' // a fight: nearest dot in that zone
  | 'goal' // centre ice

export type StoppageEvent = GameEventBase & {
  type: 'whistle' | 'periodEnd' | 'gameEnd'
  pos?: XY
  reason?: StoppageReason
  /** Additive (agent engine, W3 S3): see StoppageDetail. */
  detail?: StoppageDetail
  /** Additive (agent engine, W3 S3): the team whose infraction it was (offside, icing, a penalty) or whose goalie froze it. */
  team?: TeamRef
}

/**
 * Additive variant (agent engine, W3 S3): a team changed its tactics, lines or
 * goalie at a stop point (never in live play). `stop` is the stop point's index
 * in the game (every whistle and goal counts, from 0; intermissions are
 * `kind: 'period'`). Emitted when the change takes effect.
 */
export type TacticChangeEvent = GameEventBase & {
  type: 'tacticChange'
  team: TeamRef
  what: 'tactics' | 'lines' | 'goalie' | 'timeout'
  /** The tactics fields changed (what = 'tactics'). */
  fields?: string[]
  at: { kind: 'stop'; index: number } | { kind: 'period'; period: number }
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
  /**
   * Additive (agent engine, W3): the skater's role in his team's current shape
   * (e.g. "DZ_SD" strong-side D in the defensive zone). For detectors and a
   * future coaching overlay; renderers may ignore it.
   */
  role?: string
  /**
   * Additive (agent engine, W3): the job he is executing in that role, as a
   * short name ("puck", "chase", "mark:<player id>", "spot", "change"…). A
   * change of job is a re-plan; detectors count them (target flips).
   */
  job?: string
  /**
   * Additive (agent engine, W3 S2): the action he is committed to on this
   * frame (src/engine/agent/constraints.ts ActName: "windup", "release",
   * "pass", "receive", "deke", "poke", "lifted", "hit", "stagger",
   * "down", "pin", "pinned", "tieUp", "set", "save"), and ctT the
   * seconds into it. Absent = skating / free. Renderers may time clips to it.
   */
  act?: string
  actT?: number
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
  | TacticChangeEvent

export type GameEventType = GameEvent['type']

/** A full game (or a slice of one) as the ordered stream every consumer reads. */
export type GameStream = GameEvent[]

/** Narrowing helper for consumers that switch on a single variant. */
export const isEvent = <T extends GameEventType>(
  ev: GameEvent,
  type: T
): ev is Extract<GameEvent, { type: T }> => ev.type === type
