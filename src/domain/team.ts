import type { PlayerId, TeamId } from './ids'
import type { TeamTactics } from './tactics'

/**
 * Deployment of a roster into lines. Stored as player ids referencing the
 * team's roster; the engine resolves them to Player objects at sim time.
 */
export interface Lines {
  /** 4 forward lines, each [LW, C, RW]. */
  forwards: [PlayerId, PlayerId, PlayerId][]
  /** 3 defense pairs, each [LD, RD]. */
  defensePairs: [PlayerId, PlayerId][]
  /** [starter, backup]. */
  goalies: [PlayerId, PlayerId]
  powerPlayUnits: PlayerId[][]
  penaltyKillUnits: PlayerId[][]
}

export interface Finances {
  budget: number
  salaryCap: number
  capUsed: number
  revenue: number
}

export interface Staff {
  headCoachId: string | null
  assistantCoachIds: string[]
  scoutIds: string[]
}

/** Jersey/brand colors as 0xRRGGBB ints — shared by the 2D and 3D renderers. */
export interface TeamColors {
  primary: number
  secondary: number
}

export interface Team {
  id: TeamId
  name: string
  abbreviation: string
  city: string
  colors: TeamColors
  conferenceId: string
  divisionId: string
  roster: PlayerId[]
  lines: Lines
  tactics: TeamTactics
  finances: Finances
  staff: Staff
}
