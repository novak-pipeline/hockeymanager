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
  /**
   * Mod-stable external key, e.g. "nhl-team-10". Set by mod loaders so
   * community database packs can reference teams by a stable identity.
   * Never read by the sim engine.
   */
  externalId?: string
  /**
   * Logo image key. Resolved by the UI to logos/<logoId>.png inside the
   * active mod folder. Absent = show a generated crest from team colors.
   */
  logoId?: string
  /**
   * League tier. Absent or 'nhl' = top-level NHL team (back-compat default).
   * 'ahl' = minor-league affiliate that lives in leagueData.teams but NOT in
   * league.teams; it appears in league.ahlTeams instead.
   */
  tier?: 'nhl' | 'ahl'
  /**
   * Set on AHL teams only. Points to the NHL parent's TeamId.
   * Drives call-up/send-down routing and UI grouping.
   */
  parentTeamId?: TeamId
  /**
   * Set on NHL teams only. Points to the AHL affiliate's TeamId.
   * Drives call-up/send-down routing and UI grouping.
   */
  affiliateId?: TeamId
  /** Home arena name from the source DB (display-only). */
  arena?: string
  /** Home arena capacity from the source DB (display-only). */
  arenaCapacity?: number
  /** Retired jersey numbers from the source DB (display-only). */
  retiredNumbers?: Array<{ number: number; player: string }>
}
