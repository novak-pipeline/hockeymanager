/**
 * Per-game player ratings and team leaders.
 *
 * Pure functions only — no engine imports, no side effects, JSON-safe types
 * throughout. The career layer accumulates the raw counting stats
 * (hits/blockedShots/takeaways/giveaways) from the event stream; this module
 * only provides the shape, merge helpers, rating computation, and leaders view.
 *
 * Rating anchor: 5.6 (average NHL game). Range roughly 4.0–8.0.
 * Calibration:
 *   anchor 5.6 + (production + defense events − negatives + plusMinus bonus) × toiFactor
 *   toiFactor = toi/1200, clamped 0.4–1.4
 *   D get blockWeight 0.45 vs F 0.28, takeawayWeight 0.40 vs F 0.30
 */

import type { Position } from '@domain'

/* ────────────────────────── extended stat line ────────────────────────── */

/**
 * Extends GamePlayerStat with the four physical-play counters that the career
 * layer accumulates from the hit/blockedShot/takeaway/giveaway event stream.
 */
export interface ExtendedStatLine {
  playerId: string
  goals: number
  assists: number
  shots: number
  penaltyMinutes: number
  toi: number
  saves: number
  shotsAgainst: number
  goalsAgainst: number
  hits: number
  blockedShots: number
  takeaways: number
  giveaways: number
}

export function emptyExtended(playerId: string): ExtendedStatLine {
  return {
    playerId,
    goals: 0,
    assists: 0,
    shots: 0,
    penaltyMinutes: 0,
    toi: 0,
    saves: 0,
    shotsAgainst: 0,
    goalsAgainst: 0,
    hits: 0,
    blockedShots: 0,
    takeaways: 0,
    giveaways: 0,
  }
}

export function mergeExtended(total: ExtendedStatLine, game: ExtendedStatLine): void {
  total.goals += game.goals
  total.assists += game.assists
  total.shots += game.shots
  total.penaltyMinutes += game.penaltyMinutes
  total.toi += game.toi
  total.saves += game.saves
  total.shotsAgainst += game.shotsAgainst
  total.goalsAgainst += game.goalsAgainst
  total.hits += game.hits
  total.blockedShots += game.blockedShots
  total.takeaways += game.takeaways
  total.giveaways += game.giveaways
}

/* ────────────────────────── skater game rating ────────────────────────── */

export interface SkaterGameRatingArgs {
  position: Position
  goals: number
  assists: number
  shots: number
  hits: number
  blockedShots: number
  takeaways: number
  giveaways: number
  plusMinus: number
  /** Time on ice in seconds. */
  toi: number
}

/**
 * Compute a single 4.0–8.0 game rating for a skater.
 *
 * Calibration reference (average NHL game ≈ 5.6):
 *   - Goals: +1.2 each
 *   - Assists: +0.5 each
 *   - Shots: +0.06 each (beyond first 2)
 *   - Hits: +0.08 each (D: +0.10)
 *   - Blocked shots: D +0.45 each, F +0.28 each
 *   - Takeaways: D +0.40 each, F +0.30 each
 *   - Giveaways: -0.25 each
 *   - plusMinus: +0.12 per point
 *   - toiFactor = toi/1200, clamped [0.4, 1.4]
 */
export function gameRating(args: SkaterGameRatingArgs): number {
  const { position, goals, assists, shots, hits, blockedShots, takeaways, giveaways, plusMinus, toi } = args
  const isD = position === 'D'

  const blockWeight = isD ? 0.45 : 0.28
  const takeWeight = isD ? 0.40 : 0.30
  const hitWeight = isD ? 0.10 : 0.08

  // Production component
  const production =
    goals * 1.2 +
    assists * 0.5 +
    Math.max(0, shots - 2) * 0.06

  // Defence/physical component
  const defense =
    blockedShots * blockWeight +
    takeaways * takeWeight +
    hits * hitWeight

  // Negatives
  const negatives = giveaways * 0.25

  // Plus/minus bonus (small — avoids over-rewarding passengers on good lines)
  const pmBonus = plusMinus * 0.12

  // TOI factor: rewards players who earn their ice time; penalises no-shows
  const toiFactor = Math.max(0.4, Math.min(1.4, toi / 1200))

  const raw = 5.6 + (production + defense - negatives + pmBonus) * toiFactor
  return Math.max(4.0, Math.min(8.0, Math.round(raw * 10) / 10))
}

/* ────────────────────────── goalie game rating ────────────────────────── */

export interface GoalieGameRatingArgs {
  saves: number
  shotsAgainst: number
  goalsAgainst: number
  /** Time on ice in seconds. */
  toi: number
}

/**
 * Goalie version. Anchors at 5.6; save% above/below .900 drives most of the swing.
 *   svPct component: (savePct - 0.900) * 40 → ±4 for a perfect/terrible game
 *   goalsAgainst penalty: -0.20 each beyond 2
 *   workloadBoost: +0.30 for facing 30+ shots (busy = harder)
 */
export function goalieGameRating(args: GoalieGameRatingArgs): number {
  const { saves, shotsAgainst, goalsAgainst, toi } = args
  if (shotsAgainst === 0 || toi < 600) return 5.0 // insufficient sample

  const savePct = saves / shotsAgainst
  const svComponent = (savePct - 0.9) * 40
  const gaPenalty = Math.max(0, goalsAgainst - 2) * 0.2
  const workload = shotsAgainst >= 30 ? 0.3 : 0

  const raw = 5.6 + svComponent - gaPenalty + workload
  return Math.max(4.0, Math.min(8.0, Math.round(raw * 10) / 10))
}

/* ────────────────────────── rolling ratings helpers ────────────────────────── */

/**
 * Produce an EHM-style form string from the last N per-game ratings.
 *
 * Ratings are bucketed: ≥7.0 → 'A', ≥6.0 → 'B', ≥5.5 → 'C', ≥4.5 → 'D', else 'F'.
 * Returns a string of up to 5 characters, newest first, e.g. "BABCA".
 * Returns "" when no ratings are available.
 */
export function formString(lastRatings: number[]): string {
  const bucket = (r: number): string => {
    if (r >= 7.0) return 'A'
    if (r >= 6.0) return 'B'
    if (r >= 5.5) return 'C'
    if (r >= 4.5) return 'D'
    return 'F'
  }
  return lastRatings
    .slice(-5) // last 5 games
    .reverse() // newest first
    .map(bucket)
    .join('')
}

/**
 * Season average rating from the rolling list.
 * Returns 0 when the list is empty.
 */
export function seasonAvgRating(ratings: number[]): number {
  if (ratings.length === 0) return 0
  const sum = ratings.reduce((s, r) => s + r, 0)
  return Math.round((sum / ratings.length) * 10) / 10
}

/* ────────────────────────── team leaders view ────────────────────────── */

export interface TeamLeadersEntry {
  playerId: string
  name: string
  teamAbbr: string
  position: Position
  /** The stat value already formatted/rounded for display. */
  value: number
}

export interface LeaderChip {
  label: string
  unit: string
  entries: TeamLeadersEntry[]
}

export interface TeamLeadersView {
  goals: LeaderChip
  assists: LeaderChip
  points: LeaderChip
  plusMinus: LeaderChip
  /** Per-game average rating (skaters with ≥1 game). */
  avgRating: LeaderChip
  /** Min-games qualified goalies. */
  savePct: LeaderChip
  goalsAgainstAvg: LeaderChip
}

export interface TeamLeadersRowInput {
  playerId: string
  name: string
  teamAbbr: string
  position: Position
  goals: number
  assists: number
  points: number
  plusMinus: number
  gamesPlayed: number
  /** Average game rating; 0 if no games. */
  avgRating: number
  /** For goalies only. */
  savePct?: number
  goalsAgainst?: number
  toi?: number
}

function topN(
  entries: TeamLeadersRowInput[],
  score: (e: TeamLeadersRowInput) => number,
  n = 3
): TeamLeadersEntry[] {
  return [...entries]
    .sort((a, b) => score(b) - score(a))
    .slice(0, n)
    .map((e) => ({
      playerId: e.playerId,
      name: e.name,
      teamAbbr: e.teamAbbr,
      position: e.position,
      value: Math.round(score(e) * 100) / 100,
    }))
}

/**
 * Build a TeamLeadersView from a list of player rows.
 * Typically called with the user team's roster entries for the EHM right-rail panel.
 */
export function teamLeaders(args: {
  entries: TeamLeadersRowInput[]
  /** Minimum games for goalie leaderboards (default 5). */
  minGpGoalie?: number
}): TeamLeadersView {
  const { entries, minGpGoalie = 5 } = args
  const skaters = entries.filter((e) => e.position !== 'G')
  const goalies = entries.filter((e) => e.position === 'G')
  const qualifiedGoalies = goalies.filter((e) => e.gamesPlayed >= minGpGoalie)

  return {
    goals: {
      label: 'Goals',
      unit: 'G',
      entries: topN(skaters, (e) => e.goals),
    },
    assists: {
      label: 'Assists',
      unit: 'A',
      entries: topN(skaters, (e) => e.assists),
    },
    points: {
      label: 'Points',
      unit: 'PTS',
      entries: topN(skaters, (e) => e.points),
    },
    plusMinus: {
      label: '+/-',
      unit: '+/-',
      entries: topN(skaters, (e) => e.plusMinus),
    },
    avgRating: {
      label: 'Rating',
      unit: 'AvR',
      entries: topN(
        entries.filter((e) => e.gamesPlayed > 0),
        (e) => e.avgRating
      ),
    },
    savePct: {
      label: 'Save %',
      unit: 'SV%',
      entries: topN(qualifiedGoalies, (e) => e.savePct ?? 0).map((e) => ({
        ...e,
        value: Math.round((e.value || 0) * 1000) / 1000,
      })),
    },
    goalsAgainstAvg: {
      label: 'GAA',
      unit: 'GAA',
      entries: topN(
        qualifiedGoalies.filter((e) => (e.toi ?? 0) > 0),
        // Lower is better → negate for topN sort
        (e) => -((e.goalsAgainst ?? 0) / ((e.toi ?? 1) / 3600))
      ).map((e) => ({
        ...e,
        // Restore positive value for display
        value: Math.round(-e.value * 100) / 100,
      })),
    },
  }
}
