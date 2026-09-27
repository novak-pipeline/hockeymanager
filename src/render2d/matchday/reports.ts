/**
 * The match-day screens' data: the intermission report and the postgame.
 *
 * Both are pure functions of the stream fold (matchStats.ts) and the ratings
 * (ratings.ts); the turning point and the three-star ordering reuse the
 * postgame receipt's own logic (engine/career/matchNight.ts), so a watched
 * game and a simmed one name the same moment and the same stars.
 *
 * Pure and DOM-free.
 */
import { findTurningPoint, threeStars, type RatedGameLine, type TurningPointGoal } from '@engine/career/matchNight'
import type { ThreeStarView, TurningPointView } from '@engine/career/views'
import { assistantRead, type AssistantRead } from './assistant'
import type { IntermissionDecisionSlot } from './decisions'
import { INTERMISSION_DECISION_SLOTS } from './decisions'
import {
  computeMatchStats, periodName,
  type GoalSummary, type MatchIndex, type MatchStats, type PenaltySummary, type PlayerLine, type ShotPoint, type Side, type TeamStats,
} from './matchStats'
import { rateMatch, type PlayerRating } from './ratings'

export interface StarView extends ThreeStarView {
  side: Side
  /** Why: the rating's top drivers. */
  drivers: string[]
}

/** Three stars from the ratings, ordered by the receipt's own tiebreaks. */
export function starsFrom(ratings: PlayerRating[], index: MatchIndex): StarView[] {
  const lines: RatedGameLine[] = ratings.map((r) => ({
    playerId: r.playerId,
    name: r.name,
    teamAbbr: r.side === 'home' ? index.homeAbbr : index.awayAbbr,
    isGoalie: r.isGoalie,
    goals: r.line.goals,
    assists: r.line.assists,
    shots: r.line.shots,
    saves: r.line.saves,
    shotsAgainst: r.line.shotsAgainst,
    rating: r.rating,
  }))
  const byId = new Map(ratings.map((r) => [r.playerId, r]))
  return threeStars(lines).map((s) => {
    const r = byId.get(s.playerId)!
    return { ...s, side: r.side, drivers: r.drivers.filter((d) => d.delta > 0).map((d) => d.label) }
  })
}

export interface IntermissionReport {
  /** The period that just ended. */
  period: number
  /** "End of the 1st", "End of regulation", "End of OT". */
  title: string
  /** What comes next: "2nd period", "Overtime", "2nd overtime". */
  next: string
  home: number
  away: number
  /** Team stats for the period just played. */
  periodStats: { home: TeamStats; away: TeamStats }
  /** Team stats for the game so far. */
  gameStats: { home: TeamStats; away: TeamStats }
  /** Shots per period so far, for the "by period" strip. */
  shotsByPeriod: { home: number[]; away: number[] }
  /** Every goal so far (the scoring summary), chronological. */
  goals: GoalSummary[]
  /** Penalties in the period just played. */
  penalties: PenaltySummary[]
  stars: StarView[]
  assistant: AssistantRead
  /**
   * Where intermission decisions (lines, tactics, goalie, a word to the room)
   * plug in. Every slot reports `available: false` until the watched game is
   * simulated period by period — a decision made here cannot change a game the
   * engine already finished, so none is offered. See decisions.ts.
   */
  decisions: IntermissionDecisionSlot[]
}

function titleFor(period: number, index: MatchIndex): { title: string; next: string } {
  if (period < 3) return { title: `End of the ${periodName(period)}`, next: `${periodName(period + 1)} period` }
  if (period === 3) return { title: 'End of regulation', next: 'Overtime' }
  const n = period - 3
  const nextN = n + 1
  return {
    title: n === 1 ? 'End of overtime' : `End of the ${periodName(period)}`,
    next: index.lastPeriod > period ? (nextN === 2 ? '2nd overtime' : `${periodName(period + 1)}`) : 'Overtime',
  }
}

export function buildIntermission(index: MatchIndex, period: number, seed: string): IntermissionReport {
  const brk = index.intermissions.find((b) => b.period === period)
  // Fold to just before the next period's first event.
  const upTo = brk ? brk.absT - 1e-6 : (index.periodStarts.get(period) ?? (period - 1) * 1200) + 1200
  const game = computeMatchStats(index, upTo)
  const ratings = rateMatch(game)
  const blank = (list: TeamStats[]): TeamStats => list[period - 1] ?? list[list.length - 1]!
  const pHome = blank(game.byPeriod.home)
  const pAway = blank(game.byPeriod.away)
  const us = index.userSide === 'home' ? pHome : pAway
  const them = index.userSide === 'home' ? pAway : pHome
  const { title, next } = titleFor(period, index)
  return {
    period,
    title,
    next,
    home: game.home.goals,
    away: game.away.goals,
    periodStats: { home: pHome, away: pAway },
    gameStats: { home: game.home, away: game.away },
    shotsByPeriod: { home: game.byPeriod.home.map((t) => t.shots), away: game.byPeriod.away.map((t) => t.shots) },
    goals: game.goals,
    penalties: game.penalties.filter((p) => p.period === period),
    stars: starsFrom(ratings, index),
    assistant: assistantRead({ game, us, them, userSide: index.userSide, ratings, scope: 'period', period, seed }),
    decisions: INTERMISSION_DECISION_SLOTS,
  }
}

export interface BoxSkaterRow {
  playerId: string
  name: string
  position: string
  goals: number
  assists: number
  points: number
  plusMinus: number
  shots: number
  hits: number
  blocks: number
  penaltyMinutes: number
  faceoffs: string
  toi: number
  rating: number
}

export interface BoxGoalieRow {
  playerId: string
  name: string
  shotsAgainst: number
  saves: number
  goalsAgainst: number
  savePct: number
  xga: number
  toi: number
  rating: number
}

export interface PostgameReport {
  homeAbbr: string
  awayAbbr: string
  home: number
  away: number
  userSide: Side
  won: boolean
  decidedBy: 'regulation' | 'overtime' | 'shootout'
  /** Goals per period, index 0 = 1st; OT periods appended. */
  goalsByPeriod: { home: number[]; away: number[] }
  shotsByPeriod: { home: number[]; away: number[] }
  totals: { home: TeamStats; away: TeamStats }
  goals: GoalSummary[]
  penalties: PenaltySummary[]
  stars: StarView[]
  turningPoint: TurningPointView | null
  /** Every rated player, best first. */
  ratings: PlayerRating[]
  box: {
    home: { skaters: BoxSkaterRow[]; goalies: BoxGoalieRow[] }
    away: { skaters: BoxSkaterRow[]; goalies: BoxGoalieRow[] }
  }
  shots: ShotPoint[]
}

function boxFor(side: Side, stats: MatchStats, ratings: PlayerRating[]): PostgameReport['box']['home'] {
  const rOf = new Map(ratings.map((r) => [r.playerId, r.rating]))
  const mine = stats.players.filter((l) => l.side === side && rOf.has(l.id))
  const skaters = mine
    .filter((l) => !l.isGoalie)
    .map((l: PlayerLine): BoxSkaterRow => ({
      playerId: l.id,
      name: l.name,
      position: l.position,
      goals: l.goals,
      assists: l.assists,
      points: l.goals + l.assists,
      plusMinus: l.plusMinus,
      shots: l.shots,
      hits: l.hits,
      blocks: l.blocks,
      penaltyMinutes: l.penaltyMinutes,
      faceoffs: l.faceoffLosses > 0 || l.faceoffWins > 0
        ? (l.faceoffLosses > 0 ? `${l.faceoffWins}-${l.faceoffLosses}` : `${l.faceoffWins}`)
        : '',
      toi: l.toi,
      rating: rOf.get(l.id) ?? 6,
    }))
    .sort((a, b) => b.points - a.points || b.goals - a.goals || b.toi - a.toi || a.name.localeCompare(b.name))
  const goalies = mine
    .filter((l) => l.isGoalie)
    .map((l): BoxGoalieRow => ({
      playerId: l.id,
      name: l.name,
      shotsAgainst: l.shotsAgainst,
      saves: l.saves,
      goalsAgainst: l.goalsAgainst,
      savePct: l.shotsAgainst > 0 ? l.saves / l.shotsAgainst : 0,
      xga: l.xga,
      toi: l.toi,
      rating: rOf.get(l.id) ?? 6,
    }))
    .sort((a, b) => b.toi - a.toi)
  return { skaters, goalies }
}

export function buildPostgame(index: MatchIndex): PostgameReport {
  const stats = computeMatchStats(index)
  const ratings = rateMatch(stats)
  const home = stats.home.goals
  const away = stats.away.goals
  const userSide = index.userSide
  const us = userSide === 'home' ? home : away
  const them = userSide === 'home' ? away : home
  // A level stream at the horn means the shootout decided it (the stream
  // carries no shootout goals); the watched game's result isn't in the stream,
  // so `won` is only claimed when the score says so.
  const decidedBy: PostgameReport['decidedBy'] = home === away
    ? 'shootout'
    : stats.goals.length > 0 && stats.goals[stats.goals.length - 1]!.period >= 4 ? 'overtime' : 'regulation'
  const tpGoals: TurningPointGoal[] = stats.goals.map((g) => ({
    period: g.period,
    t: g.absT - (index.periodStarts.get(g.period) ?? (g.period - 1) * 1200),
    scorerName: g.scorerName,
    byUser: g.side === userSide,
  }))
  const byPeriodGoals = (side: Side): number[] => stats.byPeriod[side].map((t) => t.goals)
  return {
    homeAbbr: index.homeAbbr,
    awayAbbr: index.awayAbbr,
    home,
    away,
    userSide,
    won: us > them,
    decidedBy,
    goalsByPeriod: { home: byPeriodGoals('home'), away: byPeriodGoals('away') },
    shotsByPeriod: { home: stats.byPeriod.home.map((t) => t.shots), away: stats.byPeriod.away.map((t) => t.shots) },
    totals: { home: stats.home, away: stats.away },
    goals: stats.goals,
    penalties: stats.penalties,
    stars: starsFrom(ratings, index),
    turningPoint: findTurningPoint(tpGoals, us > them, decidedBy),
    ratings,
    box: { home: boxFor('home', stats, ratings), away: boxFor('away', stats, ratings) },
    shots: stats.shots,
  }
}
