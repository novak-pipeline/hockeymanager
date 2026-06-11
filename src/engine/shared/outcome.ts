/**
 * The box-score contract shared by BOTH sim engines.
 *
 * The quick-sim and the full-fidelity engine produce the same `GameOutcome`:
 * a final score, how it was decided, the per-player stat line, and a
 * `GameStream` (sparse from quick-sim, dense + positional from full-sim). The
 * career/season layer applies an outcome the same way regardless of which engine
 * produced it — so the user's watched game and the background games stay
 * perfectly consistent.
 */
import type { GameStream, PlayerId, TeamId } from '@domain'

export interface GamePlayerStat {
  playerId: PlayerId
  goals: number
  assists: number
  shots: number
  penaltyMinutes: number
  /** Time on ice, seconds. */
  toi: number
  // Goalie-only; 0 for skaters.
  saves: number
  shotsAgainst: number
  goalsAgainst: number
}

export type DecidedBy = 'regulation' | 'overtime' | 'shootout'

export interface GameOutcome {
  homeTeamId: TeamId
  awayTeamId: TeamId
  homeGoals: number
  awayGoals: number
  decidedBy: DecidedBy
  stream: GameStream
  playerStats: Map<PlayerId, GamePlayerStat>
}

export function emptyStat(playerId: PlayerId): GamePlayerStat {
  return {
    playerId,
    goals: 0,
    assists: 0,
    shots: 0,
    penaltyMinutes: 0,
    toi: 0,
    saves: 0,
    shotsAgainst: 0,
    goalsAgainst: 0
  }
}

export function mergePlayerStats(
  totals: Map<PlayerId, GamePlayerStat>,
  game: Map<PlayerId, GamePlayerStat>
): void {
  for (const [id, s] of game) {
    let t = totals.get(id)
    if (!t) {
      t = emptyStat(id)
      totals.set(id, t)
    }
    t.goals += s.goals
    t.assists += s.assists
    t.shots += s.shots
    t.penaltyMinutes += s.penaltyMinutes
    t.toi += s.toi
    t.saves += s.saves
    t.shotsAgainst += s.shotsAgainst
    t.goalsAgainst += s.goalsAgainst
  }
}
