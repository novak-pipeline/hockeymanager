import type { GameId, TeamId } from './ids'

/**
 * Playoff bracket state. Lives on the Career (not League) so the regular-season
 * League shape stays untouched. Serialized verbatim into saves — keep JSON-safe
 * (no Maps, no class instances).
 *
 * Playoff games never end in a shootout: tied games play repeated sudden-death
 * overtime periods (engines accept a `rules: 'playoff'` option for this).
 */

export type SeriesStatus = 'scheduled' | 'inProgress' | 'finished'

export interface SeriesGameResult {
  gameId: GameId
  /** 1-based game number within the series. */
  gameNumber: number
  homeTeamId: TeamId
  awayTeamId: TeamId
  homeGoals: number
  awayGoals: number
  decidedBy: 'regulation' | 'overtime'
}

export interface PlayoffSeries {
  id: string
  /** 1-based round number. */
  round: number
  /** Higher seed holds home-ice advantage (2-2-1-1-1 pattern). */
  highSeedTeamId: TeamId
  lowSeedTeamId: TeamId
  highSeedWins: number
  lowSeedWins: number
  games: SeriesGameResult[]
  status: SeriesStatus
  winnerTeamId: TeamId | null
}

export interface PlayoffRound {
  round: number
  /** Display name, e.g. "Conference Semifinals", "League Final". */
  name: string
  series: PlayoffSeries[]
}

export interface PlayoffsState {
  year: number
  /** Series length, e.g. 7 for best-of-seven. */
  bestOf: number
  rounds: PlayoffRound[]
  /** 1-based round currently in progress. */
  currentRound: number
  championTeamId: TeamId | null
}
