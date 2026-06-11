/**
 * Tactics (see docs/ARCHITECTURE.md §5). Configurable per team, per line, and
 * per player. Tactics feed the sim by modulating event probabilities and by
 * positioning players on the ice between events — they never decide outcomes
 * directly.
 */

export type ForecheckSystem = '1-2-2' | '2-1-2' | 'trap'
export type DefensiveZoneCoverage = 'man' | 'zone' | 'hybrid'
export type PowerPlayFormation = 'umbrella' | '1-3-1' | 'overload'
export type PenaltyKillFormation = 'box' | 'diamond' | 'aggressive'

/**
 * Player roles weight which composites the sim emphasizes and how the player
 * behaves positionally.
 */
export type PlayerRole =
  | 'sniper'
  | 'playmaker'
  | 'twoWay'
  | 'powerForward'
  | 'enforcer'
  | 'offensiveD'
  | 'shutdownD'
  | 'stayAtHomeD'
  | 'starter'
  | 'backup'

/** 0–1 sliders. */
export interface TempoSettings {
  pace: number
  passRisk: number
  shotEagerness: number
  defensivePinch: number
}

export interface SpecialTeamsTactics {
  powerPlay: PowerPlayFormation
  penaltyKill: PenaltyKillFormation
}

export interface TeamTactics {
  forecheck: ForecheckSystem
  dZoneCoverage: DefensiveZoneCoverage
  tempo: TempoSettings
  specialTeams: SpecialTeamsTactics
  /** Match a specific forward line against the opponent's top line when able. */
  lineMatching: boolean
}
