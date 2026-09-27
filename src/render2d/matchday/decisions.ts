/**
 * The intermission DECISION hook (Track P #2, second half).
 *
 * FM's half-time is a decision point: a team talk, a tactical tweak, a
 * substitution. Hockey's version is the intermission — lines, tactics, the
 * goalie, a word to the room. This file is where those plug in.
 *
 * They are NOT offered yet, on purpose. The watched game is fully simulated
 * before playback starts (UX audit F-1), so nothing chosen at an intermission
 * could change what happens next; offering the controls would be a lie. When
 * the watched game is simulated period by period (MATCH-ENGINE-PLAN Track P
 * #1, "segmented live sim"), the sim side implements `IntermissionDecisionPort`
 * and passes it to the viewer; the intermission screen renders a slot only
 * when the port says it is live and the slot is available.
 *
 * Pure types + data; DOM-free.
 */

export type IntermissionDecisionKind = 'lines' | 'tactics' | 'goalie' | 'roomMessage'

/** A word to the room — FM's team talk, hockey-sized. */
export type RoomMessageTone = 'praise' | 'calm' | 'demand' | 'challenge'

/** One decision the GM makes at an intermission. */
export type IntermissionDecision =
  /** Reshuffle the forward lines / D pairs for the next period (player ids by slot). */
  | { kind: 'lines'; forwardLines: string[][]; defencePairs: string[][] }
  /** Tactical sliders for the next period (same keys the Tactics screen edits). */
  | { kind: 'tactics'; changes: Record<string, number> }
  /** Change goalies for the next period. */
  | { kind: 'goalie'; goalieId: string }
  /** Address the room; optionally single one player out. */
  | { kind: 'roomMessage'; tone: RoomMessageTone; targetPlayerId?: string }

export interface IntermissionDecisionSlot {
  kind: IntermissionDecisionKind
  label: string
  /** False until segmented simulation can honour it. */
  available: boolean
  /** Why it's unavailable (for logs/tests; the UI does not advertise it). */
  reason?: string
}

const NOT_YET = 'The watched game is simulated in one pass; intermission decisions need segmented simulation (Track P #1).'

/** The four decision slots, all unavailable on the current engine path. */
export const INTERMISSION_DECISION_SLOTS: IntermissionDecisionSlot[] = [
  { kind: 'lines', label: 'Lines', available: false, reason: NOT_YET },
  { kind: 'tactics', label: 'Tactics', available: false, reason: NOT_YET },
  { kind: 'goalie', label: 'Goalie', available: false, reason: NOT_YET },
  { kind: 'roomMessage', label: 'Talk to the room', available: false, reason: NOT_YET },
]

/**
 * What a segmented sim hands the viewer. `live` is true only when the rest of
 * the game has NOT been simulated yet, so a decision really changes it; `apply`
 * resolves once the next period has been simulated with the decisions in
 * effect (the viewer then receives the longer stream and plays on).
 */
export interface IntermissionDecisionPort {
  readonly live: boolean
  slots(period: number): IntermissionDecisionSlot[]
  apply(period: number, decisions: IntermissionDecision[]): Promise<void>
}
