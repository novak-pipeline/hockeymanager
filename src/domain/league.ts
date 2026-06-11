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
}
