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
import type { Rng } from '@engine/shared/rng'
import { quickSimGame } from '@engine/quick/quickSim'
import { rollInjuries } from '@engine/league/condition'
import { applyGameResult, gameSeed, mergePlayerStats } from '@engine/quick/season'
import type { GamePlayerStat } from '@engine/shared/outcome'

export interface WorldSimState {
  /** competitionId → (teamId → live Standing, shared with the Competition). */
  standings: Map<string, Map<TeamId, Standing>>
  /** Player → games played across all simulated competitions this season. */
  gp: Map<PlayerId, number>
  /** Player → accumulated stat line across all simulated competitions. */
  totals: Map<PlayerId, GamePlayerStat>
  /** competitionId → average skater rating, the baseline its scoring is judged
   *  against (so a weaker league's stars still produce realistic totals).
   *  Computed lazily on first sim day and cleared each season (ratings drift). */
  leagueAvg: Map<string, number>
}

/** Build sim state from the world's competitions, reusing each league's own
 *  Standing objects so they update in place. */
export function initWorldSimState(competitions: Competition[]): WorldSimState {
  const standings = new Map<string, Map<TeamId, Standing>>()
  for (const comp of competitions) {
    if (comp.tier !== 'simulated') continue
    standings.set(comp.id, new Map(comp.standings.map((s) => [s.teamId, s])))
  }
  return { standings, gp: new Map(), totals: new Map(), leagueAvg: new Map() }
}

/** Average skater offensive rating across a competition's rosters — the baseline
 *  its scoring is judged against. Clamped so a degenerate pool can't push scoring
 *  off the rails; falls back to the NHL average when a comp has no resolvable
 *  skaters. Mirrors the quick-sim's `offense` metric (scoring 0.6 / playmaking 0.4). */
function competitionLeagueAvg(
  standings: Map<TeamId, Standing>,
  teams: Map<TeamId, Team>,
  resolve: (id: PlayerId) => Player
): number {
  let sum = 0
  let n = 0
  for (const teamId of standings.keys()) {
    const team = teams.get(teamId)
    if (!team) continue
    for (const pid of team.roster) {
      let p: Player | undefined
      try { p = resolve(pid) } catch { p = undefined }
      if (!p || p.position === 'G') continue
      sum += p.composites.scoring * 0.6 + p.composites.playmaking * 0.4
      n++
    }
  }
  if (n === 0) return 50
  // PARTIAL normalization: blend the league's own average toward the global NHL
  // baseline rather than using it raw. Full normalization makes every league score
  // alike and over-credits weak-league producers (it inverted the draft board's
  // mid/late outcome ordering); a 0.6 blend still lifts a junior loop's leaders to
  // realistic totals without destabilising the calibrated draft model.
  const raw = sum / n
  const blended = 50 + (raw - 50) * 0.6
  return Math.max(40, Math.min(52, blended))
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
  state.leagueAvg.clear()
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
  /** When provided, prospects/players in these leagues can get injured too. */
  rng?: Rng
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
    // Per-league scoring baseline (lazily computed, cached for the season) so a
    // weaker league's best players still put up realistic point totals.
    let lgAvg = args.state.leagueAvg.get(comp.id)
    if (lgAvg === undefined) {
      lgAvg = competitionLeagueAvg(standings, args.teams, args.resolve)
      args.state.leagueAvg.set(comp.id, lgAvg)
    }
    for (const game of comp.schedule) {
      if (game.day !== args.day) continue
      const home = args.teams.get(game.homeTeamId)
      const away = args.teams.get(game.awayTeamId)
      if (!home || !away) continue
      const res = quickSimGame(home, away, args.resolve, {
        seed: gameSeed(args.seedBase, args.year, game.id),
        leagueAvg: lgAvg,
      })
      game.result = { homeGoals: res.homeGoals, awayGoals: res.awayGoals, decidedBy: res.decidedBy }
      applyGameResult(standings, res)
      mergePlayerStats(args.state.totals, res.playerStats)
      for (const [pid, s] of res.playerStats) {
        if (s.toi > 0) args.state.gp.set(pid, (args.state.gp.get(pid) ?? 0) + 1)
      }
      if (args.rng) {
        const participants = [...res.playerStats]
          .filter(([, s]) => s.toi > 0)
          .map(([pid, s]) => ({ player: args.resolve(pid), toi: s.toi }))
        rollInjuries({ participants, rng: args.rng })
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
