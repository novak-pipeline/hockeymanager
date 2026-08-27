/**
 * THE AFFILIATE'S PLAYOFF RUN.
 *
 * Playtest 2026-08-26 §E1: "In real life Kyle Dubas attends the AHL playoffs to
 * watch the prospects." The farm played a full season and then simply stopped —
 * no bracket, no champion, nothing for the GM's own kids to win. So a run down
 * there could never mean anything, and the reference the user gave had nowhere
 * to land.
 *
 * This is deliberately small: an eight-team, best-of-five bracket resolved in
 * one deterministic pass at the moment the NHL playoffs begin. The farm is a
 * subplot, and a subplot does not need its own day-by-day calendar — it needs a
 * result, a story, and a reason for the GM to care about the names in it.
 *
 * Pure + deterministic + JSON-safe. The caller supplies the seeding and a
 * game-level winner function (so the real quick-sim decides the hockey); this
 * module owns the bracket shape and the prose.
 */

import type { Rng } from '@engine/shared/rng'

/* ────────────────────────── types ────────────────────────── */

export interface FarmSeed {
  teamId: string
  name: string
  abbr: string
  /** 1 = best regular-season record. */
  seed: number
}

export interface FarmSeries {
  round: number
  /** Round name for the prose: 'Quarter-final' | 'Semi-final' | 'Final'. */
  roundLabel: string
  highTeamId: string
  lowTeamId: string
  highWins: number
  lowWins: number
  winnerTeamId: string
}

export interface FarmPlayoffResult {
  year: number
  series: FarmSeries[]
  championTeamId: string
  championName: string
  /** How far the user's affiliate went, when the user has one in the field. */
  userRun?: {
    teamId: string
    name: string
    /** 'missed' | 'quarter' | 'semi' | 'final' | 'champion' */
    finish: FarmFinish
    roundsWon: number
  }
}

export type FarmFinish = 'missed' | 'quarter' | 'semi' | 'final' | 'champion'

/** Wins needed to take a best-of-five. */
export const FARM_SERIES_WINS = 3
/** Clubs in the field. */
export const FARM_FIELD_SIZE = 8

const ROUND_LABELS = ['Quarter-final', 'Semi-final', 'Final'] as const

/* ────────────────────────── the bracket ────────────────────────── */

/**
 * Run the whole bracket. `playGame(homeId, awayId, gameIndex)` returns the
 * winning team id — the caller wires this to the real quick-sim so the farm
 * plays actual hockey rather than a coin weighted by seed.
 */
export function runFarmPlayoffs(args: {
  year: number
  /** Field, best record first. At least 2; the top FARM_FIELD_SIZE are used. */
  seeds: FarmSeed[]
  playGame: (homeTeamId: string, awayTeamId: string, gameIndex: number) => string
  /** The user's affiliate, when he has one. */
  userAffiliateId?: string | undefined
  rng: Rng
}): FarmPlayoffResult | null {
  const field = args.seeds.slice(0, FARM_FIELD_SIZE)
  // A bracket needs an even field of at least four; anything less is not a
  // playoff, it is a game, and the farm does not get a story for that.
  if (field.length < 4) return null
  const size = field.length >= 8 ? 8 : 4
  const bracket = field.slice(0, size)

  const nameOf = new Map(bracket.map((s) => [s.teamId, s.name]))
  const series: FarmSeries[] = []
  let alive = bracket.map((s) => s.teamId)
  let gameIndex = 0
  let round = 0
  const totalRounds = size === 8 ? 3 : 2

  while (alive.length > 1) {
    const label = ROUND_LABELS[ROUND_LABELS.length - (totalRounds - round)] ?? 'Round'
    const next: string[] = []
    for (let i = 0; i < alive.length / 2; i++) {
      const high = alive[i]!
      const low = alive[alive.length - 1 - i]!
      let hw = 0
      let lw = 0
      while (hw < FARM_SERIES_WINS && lw < FARM_SERIES_WINS) {
        // Home ice alternates 2-2-1 style, simplified: the higher seed hosts the
        // odd-numbered games. Enough to matter, not enough to model.
        const homeIsHigh = (hw + lw) % 2 === 0
        const winner = args.playGame(homeIsHigh ? high : low, homeIsHigh ? low : high, gameIndex++)
        if (winner === high) hw++
        else lw++
      }
      const winnerTeamId = hw > lw ? high : low
      series.push({
        round, roundLabel: label, highTeamId: high, lowTeamId: low,
        highWins: hw, lowWins: lw, winnerTeamId,
      })
      next.push(winnerTeamId)
    }
    alive = next
    round++
  }

  const championTeamId = alive[0]!
  const result: FarmPlayoffResult = {
    year: args.year,
    series,
    championTeamId,
    championName: nameOf.get(championTeamId) ?? championTeamId,
  }

  if (args.userAffiliateId !== undefined) {
    const inField = bracket.some((s) => s.teamId === args.userAffiliateId)
    const roundsWon = series.filter(
      (s) => s.winnerTeamId === args.userAffiliateId
    ).length
    result.userRun = {
      teamId: args.userAffiliateId,
      name: nameOf.get(args.userAffiliateId) ?? args.userAffiliateId,
      finish: finishOf(inField, roundsWon, totalRounds, championTeamId === args.userAffiliateId),
      roundsWon,
    }
  }
  // Keep the rng argument meaningful for callers that want a tiebreak seed
  // without reaching for the clock; the bracket itself is fully determined by
  // the seeding and playGame.
  void args.rng
  return result
}

function finishOf(inField: boolean, roundsWon: number, totalRounds: number, champion: boolean): FarmFinish {
  if (!inField) return 'missed'
  if (champion) return 'champion'
  if (roundsWon >= totalRounds - 1) return 'final'
  if (roundsWon >= totalRounds - 2) return 'semi'
  return 'quarter'
}

/* ────────────────────────── the prose ────────────────────────── */

export function farmFinishLabel(f: FarmFinish): string {
  switch (f) {
    case 'missed':   return 'missed the playoffs'
    case 'quarter':  return 'went out in the quarter-final'
    case 'semi':     return 'reached the semi-final'
    case 'final':    return 'lost the final'
    case 'champion': return 'won it all'
  }
}

/** The inbox recap of the affiliate's spring. */
export function farmRecap(r: FarmPlayoffResult, affiliateName?: string): { headline: string; body: string } {
  const run = r.userRun
  if (!run || run.finish === 'missed') {
    return {
      headline: `${r.championName} take the ${r.year} farm-league title`,
      body:
        `${r.championName} closed out the final to win the ${r.year} championship. ` +
        (affiliateName
          ? `${affiliateName} were not in the field — a spring your prospects spend at home is a spring they do not spend learning how to win.`
          : `Your organisation had nobody in the bracket.`),
    }
  }
  const heads: Record<Exclude<FarmFinish, 'missed'>, string> = {
    quarter:  `${run.name} out in the quarter-final`,
    semi:     `${run.name} reach the semi-final`,
    final:    `${run.name} lose the final`,
    champion: `${run.name} are champions`,
  }
  const tails: Record<Exclude<FarmFinish, 'missed'>, string> = {
    quarter:
      `A short run, but a run: your kids played meaningful hockey in May, which most of them had never done as professionals.`,
    semi:
      `Three rounds of playoff hockey for a group that is largely your next roster. The staff will tell you which of them grew and which of them disappeared.`,
    final:
      `They came within a series of it. For a nineteen-year-old, losing a final is a more useful education than winning a quarter-final.`,
    champion:
      `Your affiliate won a championship with your prospects on it. The rings are cheap; what it teaches them is not.`,
  }
  const f = run.finish
  return {
    headline: heads[f],
    body:
      `${tails[f]} ${r.championName} lifted the ${r.year} trophy` +
      (f === 'champion' ? `.` : `, ${run.roundsWon === 0 ? 'having gone through' : 'after'} a bracket your club was part of.`),
  }
}
