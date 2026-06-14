import type { GameId, LeagueId, PlayerId, TeamId } from './ids'

export interface Division {
  id: string
  name: string
  teamIds: TeamId[]
}

export interface Conference {
  id: string
  name: string
  divisionIds: string[]
}

export interface ScheduledGame {
  id: GameId
  season: number
  day: number
  homeTeamId: TeamId
  awayTeamId: TeamId
  /** Set once played; null while pending. */
  result: GameResult | null
}

export interface GameResult {
  homeGoals: number
  awayGoals: number
  decidedBy: 'regulation' | 'overtime' | 'shootout'
}

export interface Standing {
  teamId: TeamId
  gamesPlayed: number
  wins: number
  losses: number
  overtimeLosses: number
  points: number
  goalsFor: number
  goalsAgainst: number
}

export interface DraftProspect {
  playerId: PlayerId
  /** Pre-draft scouting consensus, 1 = best available. */
  rank: number
}

export interface DraftClass {
  year: number
  prospects: DraftProspect[]
}

export interface SeasonState {
  year: number
  standings: Standing[]
  /** Free-text league news feed; structured events come later. */
  news: string[]
}

/**
 * Sim/UI fidelity for a competition in the wider world, EHM/FBM-style:
 *  - 'active'    — the league you manage in (the NHL): full match fidelity.
 *  - 'simulated' — quick-sim with standings + per-player counting stats and
 *                  active roster/FA AI (feeders & majors: AHL, CHL, NCAA, Euro).
 *  - 'background'— navigable rosters + light results, minimal sim (obscure tiers).
 * All tiers still track enough per-player production to feed development.
 */
export type CompetitionTier = 'active' | 'simulated' | 'background'

/**
 * A league in the wider hockey world beyond the managed NHL — its feeders (AHL/
 * ECHL/CHL/USHL/NCAA) and the international leagues (KHL/SHL/Liiga/…). The NHL
 * itself stays represented by League's own teams/schedule/season; `competitions`
 * carries the additional, scoutable, developing world. Additive — absent on old
 * saves and tolerated everywhere.
 */
export interface Competition {
  id: string
  name: string
  abbrev: string
  /** Host nation (display + scouting region). */
  nation: string
  /** Division level within its nation: 1 = top tier, 2, 3 … */
  level: number
  /** EHM league reputation (~0–20; higher = stronger). */
  reputation: number
  /** NHL-equivalency strength factor in (0,1]; NHL = 1.0. See leagueStrength.ts. */
  strength: number
  /** How deeply this league is simulated/shown. */
  tier: CompetitionTier
  /** Parent/affiliate competition id (e.g. an AHL league's NHL parent), if any. */
  parentId?: string
  /** Junior age cap, if a junior league — drives prospect eligibility. */
  upperAgeLimit?: number
  teamIds: TeamId[]
  schedule: ScheduledGame[]
  standings: Standing[]
}

export interface League {
  id: LeagueId
  name: string
  conferences: Conference[]
  divisions: Division[]
  teams: TeamId[]
  /** All players, including free agents and prospects. */
  players: PlayerId[]
  schedule: ScheduledGame[]
  draftClasses: DraftClass[]
  season: SeasonState
  /**
   * AHL affiliate team ids. These teams live in LeagueData.teams but are
   * intentionally excluded from `teams` so existing NHL standings/schedule/
   * draft loops never see them. Absent on old saves (tolerated everywhere).
   */
  ahlTeams?: TeamId[]
  /**
   * Scheduled games for the AHL tier. Built by buildSchedule over ahlTeams.
   * Simmed by advanceDay via quickSimGame; never watched in v1.
   */
  ahlSchedule?: ScheduledGame[]
  /**
   * Current-season standings for the AHL tier, one row per ahlTeam.
   * Initialised as fresh Standing objects; updated in parallel with NHL standings.
   */
  ahlStandings?: Standing[]
  /**
   * The wider hockey world: feeders + international leagues beyond the NHL,
   * each a quick-sim/background competition with its own teams/schedule/
   * standings/strength. Additive — absent on old saves and on the
   * generated (non-mod) league. Teams referenced here live in LeagueData.teams.
   */
  competitions?: Competition[]
}
