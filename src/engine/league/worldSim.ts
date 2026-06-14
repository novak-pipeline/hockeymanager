/**
 * Quick-sim for the wider hockey world. Generalises the AHL quick-sim pattern to
 * every 'simulated'-tier competition: on each match day it plays that day's
 * games via the shared quickSimGame, updates each league's standings, and
 * accrues per-player counting stats + games played. Background-tier leagues are
 * skipped (no schedule); the NHL ('active') is handled by the main career loop.
 *
 * The per-player totals/gp are deliberately tracked so a prospect's production in
 * ANY league — junior, college, Europe, the minors — can feed development,
 * weighted by that league's NHLe strength (see leagueStrength.ts). This is the
 * sim half of "performance in obscure leagues still factors into development".
 *
 * Pure given its inputs and seed; all randomness flows through gameSeed → Rng.
 * The state's Standing objects are the SAME references held on each Competition,
 * so a league's `standings` stays live as games are played.
 */
import type { Competition, Player, PlayerId, Position, Standing, Team, TeamId } from '@domain'
import { quickSimGame } from '@engine/quick/quickSim'
import { applyGameResult, gameSeed, mergePlayerStats } from '@engine/quick/season'
import type { GamePlayerStat } from '@engine/shared/outcome'

export interface WorldSimState {
  /** competitionId → (teamId → live Standing, shared with the Competition). */
  standings: Map<string, Map<TeamId, Standing>>
  /** Player → games played across all simulated competitions this season. */
  gp: Map<PlayerId, number>
  /** Player → accumulated stat line across all simulated competitions. */
  totals: Map<PlayerId, GamePlayerStat>
}

/** Build sim state from the world's competitions, reusing each league's own
 *  Standing objects so they update in place. */
export function initWorldSimState(competitions: Competition[]): WorldSimState {
  const standings = new Map<string, Map<TeamId, Standing>>()
  for (const comp of competitions) {
    if (comp.tier !== 'simulated') continue
    standings.set(comp.id, new Map(comp.standings.map((s) => [s.teamId, s])))
  }
  return { standings, gp: new Map(), totals: new Map() }
}

/** Zero a Standing row in place (season rollover). */
function clearStanding(s: Standing): void {
  s.gamesPlayed = 0
  s.wins = 0
  s.losses = 0
  s.overtimeLosses = 0
  s.points = 0
  s.goalsFor = 0
  s.goalsAgainst = 0
}

/** Reset the world for a new season: clear standings, stats, and game results. */
export function resetWorldSim(state: WorldSimState, competitions: Competition[]): void {
  for (const comp of competitions) {
    for (const s of comp.standings) clearStanding(s)
    for (const g of comp.schedule) g.result = null
  }
  state.gp.clear()
  state.totals.clear()
}

export interface SimWorldDayArgs {
  competitions: Competition[]
  day: number
  teams: Map<TeamId, Team>
  resolve: (id: PlayerId) => Player
  state: WorldSimState
  /** Distinct seed base so world games never collide with NHL/AHL game seeds. */
  seedBase: number
  year: number
}

/**
 * Play every simulated league's games scheduled on `day`. Returns how many games
 * were simmed. Standings + per-player totals/gp are updated in `state`; each
 * game's `result` is written back onto the schedule.
 */
export function simWorldDay(args: SimWorldDayArgs): { gamesPlayed: number } {
  let gamesPlayed = 0
  for (const comp of args.competitions) {
    if (comp.tier !== 'simulated') continue
    const standings = args.state.standings.get(comp.id)
    if (!standings) continue
    for (const game of comp.schedule) {
      if (game.day !== args.day) continue
      const home = args.teams.get(game.homeTeamId)
      const away = args.teams.get(game.awayTeamId)
      if (!home || !away) continue
      const res = quickSimGame(home, away, args.resolve, {
        seed: gameSeed(args.seedBase, args.year, game.id),
      })
      game.result = { homeGoals: res.homeGoals, awayGoals: res.awayGoals, decidedBy: res.decidedBy }
      applyGameResult(standings, res)
      mergePlayerStats(args.state.totals, res.playerStats)
      for (const [pid, s] of res.playerStats) {
        if (s.toi > 0) args.state.gp.set(pid, (args.state.gp.get(pid) ?? 0) + 1)
      }
      gamesPlayed++
    }
  }
  return { gamesPlayed }
}

/**
 * Combine a player's season production across every tier he played — NHL, AHL,
 * and the wider world — into a single line for the development engine. NHL and
 * AHL count 1:1 (preserving existing calibration); wider-world points are
 * translated to an NHL-equivalent rate by that league's strength factor, so
 * dominating a strong league means more than padding stats in a weak one. Games
 * played sum across all tiers (a player scratched everywhere stagnates).
 */
export function combinedDevProduction(args: {
  nhl?: GamePlayerStat
  ahl?: GamePlayerStat
  world?: GamePlayerStat
  nhlGp: number
  ahlGp: number
  worldGp: number
  /** NHLe factor for the wider-world league this player competed in (1 = NHL). */
  worldStrength: number
  position: Position
}): { points: number; gamesPlayed: number; position: Position; savePct?: number } {
  const { nhl, ahl, world, worldStrength, position } = args
  const goals = (nhl?.goals ?? 0) + (ahl?.goals ?? 0) + (world?.goals ?? 0) * worldStrength
  const assists = (nhl?.assists ?? 0) + (ahl?.assists ?? 0) + (world?.assists ?? 0) * worldStrength
  const saves = (nhl?.saves ?? 0) + (ahl?.saves ?? 0) + (world?.saves ?? 0)
  const shotsAgainst = (nhl?.shotsAgainst ?? 0) + (ahl?.shotsAgainst ?? 0) + (world?.shotsAgainst ?? 0)
  const gamesPlayed = args.nhlGp + args.ahlGp + args.worldGp
  const base = { points: goals + assists, gamesPlayed, position }
  return position === 'G' && shotsAgainst > 0 ? { ...base, savePct: saves / shotsAgainst } : base
}

/** All distinct match days across simulated competitions, ascending. */
export function worldMatchDays(competitions: Competition[]): number[] {
  const days = new Set<number>()
  for (const comp of competitions) {
    if (comp.tier !== 'simulated') continue
    for (const g of comp.schedule) days.add(g.day)
  }
  return [...days].sort((a, b) => a - b)
}
