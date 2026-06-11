/**
 * Scouting domain types — JSON-safe, no Maps.
 *
 * ScoutingState is the serialized form that goes into CareerSnapshot. All
 * knowledge values are kept as an entry array so structured-clone and
 * JSON.stringify both work without any helpers.
 */

/** 0–100 knowledge of a player: 100 = exact ratings visible, 0 = total mystery. */
export type KnowledgeValue = number

/**
 * What a scout is currently watching. One of four mutually-exclusive targets.
 * JSON-safe: no discriminated union tricks, just a simple tagged object.
 */
export type ScoutTarget =
  | { kind: 'team';       teamId: string }
  | { kind: 'division';   divisionId: string }
  | { kind: 'draftClass' }
  | { kind: 'freeAgents' }

export interface ScoutAssignment {
  scoutId: string
  name: string
  /** 50–90 scout quality; higher quality → faster knowledge gain. */
  rating: number
  target: ScoutTarget
}

/**
 * Full scouting state for one career. Serialized as entry arrays so it round-
 * trips cleanly through JSON.stringify / structured clone.
 *
 * knowledge: [playerId, 0..100][] — absent means 0.
 */
export interface ScoutingState {
  knowledge: Array<[string, KnowledgeValue]>
  assignments: ScoutAssignment[]
}
