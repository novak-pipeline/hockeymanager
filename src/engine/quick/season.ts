/**
 * Season runner (build step #2 — the gate). Plays every scheduled game with the
 * quick-sim engine, writes results back onto the schedule, and accumulates the
 * standings table plus season-long per-player totals.
 *
 * "Can sim a season, produce standings" is what proves the world works.
 */
import type { LeagueData } from '@data/generate'
import type { PlayerId, Standing, TeamId } from '@domain'
import { deriveSeed } from '@engine/shared/rng'
import { mergePlayerStats, type GameOutcome, type GamePlayerStat } from '@engine/shared/outcome'
import { quickSimGame } from './quickSim'

export interface SeasonSimResult {
  standings: Standing[]
  playerTotals: Map<PlayerId, GamePlayerStat>
  gamesPlayed: number
}

const WIN_POINTS = 2
const OTL_POINTS = 1

function freshStanding(teamId: TeamId): Standing {
  return {
    teamId,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    overtimeLosses: 0,
    points: 0,
    goalsFor: 0,
    goalsAgainst: 0
  }
}

function applyResult(
  standings: Map<TeamId, Standing>,
  res: GameOutcome
): void {
  const home = standings.get(res.homeTeamId)!
  const away = standings.get(res.awayTeamId)!
  home.gamesPlayed++
  away.gamesPlayed++
  home.goalsFor += res.homeGoals
  home.goalsAgainst += res.awayGoals
  away.goalsFor += res.awayGoals
  away.goalsAgainst += res.homeGoals

  const homeWon = res.homeGoals > res.awayGoals
  const extra = res.decidedBy !== 'regulation'
  if (homeWon) {
    home.wins++
    home.points += WIN_POINTS
    if (extra) {
      away.overtimeLosses++
      away.points += OTL_POINTS
    } else {
      away.losses++
    }
  } else {
    away.wins++
    away.points += WIN_POINTS
    if (extra) {
      home.overtimeLosses++
      home.points += OTL_POINTS
    } else {
      home.losses++
    }
  }
}

/** NHL tiebreak: points, then wins, then goal differential. */
export function sortStandings(standings: Standing[]): Standing[] {
  return [...standings].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (b.wins !== a.wins) return b.wins - a.wins
    return b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst)
  })
}

/**
 * Simulate the full scheduled season. Mutates each ScheduledGame.result and the
 * league's standings; also returns the sorted standings and player totals.
 *
 * `keepStreams` (default false) discards the per-game event streams to save
 * memory — the season runner only needs box-score outcomes. Set true if a
 * caller wants to inspect streams.
 */
export function simSeason(
  data: LeagueData,
  seed: number,
  keepStreams = false
): SeasonSimResult {
  const { league, teams, players } = data
  const resolve = (id: PlayerId) => {
    const p = players.get(id)
    if (!p) throw new Error(`unknown player ${id}`)
    return p
  }

  const standings = new Map<TeamId, Standing>()
  for (const teamId of league.teams) standings.set(teamId, freshStanding(teamId))

  const playerTotals = new Map<PlayerId, GamePlayerStat>()
  let gamesPlayed = 0

  for (const game of league.schedule) {
    const home = teams.get(game.homeTeamId)!
    const away = teams.get(game.awayTeamId)!
    const res = quickSimGame(home, away, resolve, {
      seed: gameSeed(seed, league.season.year, game.id)
    })

    game.result = {
      homeGoals: res.homeGoals,
      awayGoals: res.awayGoals,
      decidedBy: res.decidedBy
    }
    applyResult(standings, res)
    mergePlayerStats(playerTotals, res.playerStats)
    gamesPlayed++
    if (!keepStreams) res.stream.length = 0
  }

  const sorted = sortStandings([...standings.values()])
  league.season.standings = sorted
  return { standings: sorted, playerTotals, gamesPlayed }
}

/** Cheap deterministic hash of a game id string into a uint32 (FNV-1a). */
function hashId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Deterministic per-game seed. Used by BOTH the full-season runner and the
 * day-by-day career manager so the same season seed yields identical games
 * regardless of how the season is advanced.
 */
export function gameSeed(seasonSeed: number, year: number, gameId: string): number {
  return deriveSeed(seasonSeed, year, hashId(gameId))
}

export { applyResult as applyGameResult, mergePlayerStats }
