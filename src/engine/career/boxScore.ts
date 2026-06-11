/**
 * Builds the post-game BoxScoreView from a GameOutcome. Pure presentation
 * assembly — every number comes from the outcome's stream/playerStats; nothing
 * is recomputed or re-simulated here.
 */
import type { GameEvent, Player, PlayerId, Team } from '@domain'
import { isEvent } from '@domain'
import { overall } from '@engine/ratings/composites'
import type { GameOutcome } from '@engine/shared/outcome'
import type {
  BoxScoreGoalieRow,
  BoxScoreSkaterRow,
  BoxScoreView,
  GoalLogRow,
  PenaltyLogRow,
} from './views'

function clockOf(t: number): string {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function buildBoxScore(
  outcome: GameOutcome,
  home: Team,
  away: Team,
  resolve: (id: PlayerId) => Player
): BoxScoreView {
  const homeIds = new Set(home.roster.map((id) => id as string))
  const isHome = (id: PlayerId): boolean => homeIds.has(id as string)
  const abbrOf = (id: PlayerId): string => (isHome(id) ? home.abbreviation : away.abbreviation)

  const periods = Math.max(
    3,
    outcome.stream.reduce((m, ev) => (ev.type === 'goal' ? Math.max(m, ev.period) : m), 3)
  )
  const homeByPeriod = new Array<number>(periods).fill(0)
  const awayByPeriod = new Array<number>(periods).fill(0)

  const goals: GoalLogRow[] = []
  const penalties: PenaltyLogRow[] = []
  let h = 0
  let a = 0
  let homeShots = 0
  let awayShots = 0

  for (const ev of outcome.stream) {
    if (isEvent(ev, 'shot')) {
      if (isHome(ev.shooter)) homeShots++
      else awayShots++
    } else if (isEvent(ev, 'goal')) {
      const onHome = isHome(ev.scorer)
      if (onHome) h++
      else a++
      const idx = Math.min(ev.period, periods) - 1
      if (onHome) homeByPeriod[idx]++
      else awayByPeriod[idx]++
      goals.push({
        period: ev.period,
        clock: clockOf(ev.t),
        teamAbbr: abbrOf(ev.scorer),
        scorer: resolve(ev.scorer).name,
        assists: ev.assists.map((id) => resolve(id).name),
        strength: ev.strength,
        homeScore: h,
        awayScore: a,
      })
    } else if (isEvent(ev, 'penalty')) {
      penalties.push({
        period: ev.period,
        clock: clockOf(ev.t),
        teamAbbr: abbrOf(ev.player),
        player: resolve(ev.player).name,
        infraction: ev.infraction,
        minutes: ev.minutes,
      })
    }
  }

  const skaterRow = (id: PlayerId): BoxScoreSkaterRow | null => {
    const stat = outcome.playerStats.get(id)
    if (!stat || stat.toi <= 0) return null
    const p = resolve(id)
    if (p.position === 'G') return null
    return {
      playerId: id as string,
      name: p.name,
      position: p.position,
      age: p.age,
      overall: overall(p.composites, p.position),
      goals: stat.goals,
      assists: stat.assists,
      shots: stat.shots,
      penaltyMinutes: stat.penaltyMinutes,
      toi: stat.toi,
    }
  }

  const goalieRow = (id: PlayerId): BoxScoreGoalieRow | null => {
    const stat = outcome.playerStats.get(id)
    if (!stat) return null
    const p = resolve(id)
    if (p.position !== 'G' || stat.shotsAgainst <= 0) return null
    return {
      playerId: id as string,
      name: p.name,
      position: p.position,
      age: p.age,
      overall: overall(p.composites, p.position),
      saves: stat.saves,
      shotsAgainst: stat.shotsAgainst,
      goalsAgainst: stat.goalsAgainst,
    }
  }

  const rows = (team: Team): { skaters: BoxScoreSkaterRow[]; goalies: BoxScoreGoalieRow[] } => ({
    skaters: team.roster
      .map(skaterRow)
      .filter((r): r is BoxScoreSkaterRow => r !== null)
      .sort((x, y) => y.goals + y.assists - (x.goals + x.assists) || y.toi - x.toi),
    goalies: team.roster.map(goalieRow).filter((r): r is BoxScoreGoalieRow => r !== null),
  })

  const homeRows = rows(home)
  const awayRows = rows(away)

  return {
    homeAbbr: home.abbreviation,
    awayAbbr: away.abbreviation,
    homeName: home.name,
    awayName: away.name,
    homeGoals: outcome.homeGoals,
    awayGoals: outcome.awayGoals,
    decidedBy: outcome.decidedBy,
    homeByPeriod,
    awayByPeriod,
    homeShots,
    awayShots,
    goals,
    penalties,
    homeSkaters: homeRows.skaters,
    awaySkaters: awayRows.skaters,
    homeGoalies: homeRows.goalies,
    awayGoalies: awayRows.goalies,
  }
}

/** Narrow re-export so callers don't need the events barrel for this check. */
export type { GameEvent }
