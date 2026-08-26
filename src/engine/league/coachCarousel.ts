/**
 * THE COACHING CAROUSEL — other clubs fire people too.
 *
 * Playtest 2026-08-26 §E3: pressure is not real if it only ever points at the
 * user. In a live NHL season three or four benches change hands; a GM reads
 * about it, files it away, and knows the same arithmetic is being done about
 * him. This module decides which AI clubs pull the trigger and when.
 *
 * Two windows, deliberately different in temperament:
 *   - MID-SEASON: rare, and only for a genuine collapse — a club far below its
 *     own projection, on a bad points pace, with enough games played that it is
 *     the season and not a slow start. Capped league-wide per year.
 *   - OFFSEASON: the ordinary churn. A club that missed badly, or a long-tenured
 *     coach whose club has stopped improving, gets moved on.
 *
 * Pure + deterministic + JSON-safe: seats in, firings out, seeded Rng only. The
 * career layer owns the staff records, the news and the coach market.
 */

import type { Rng } from '@engine/shared/rng'
import type { NewsCategory } from '@domain/news'

/* ────────────────────────── types ────────────────────────── */

export interface CoachSeat {
  teamId: string
  teamName: string
  teamAbbr: string
  coachId: string
  coachName: string
  /** Completed seasons behind THIS bench. A first-year coach is 0. */
  tenure: number
  /** Where the media picked them in September (1 = best). */
  predictedRank: number
  /** Where they actually sit (1 = best). */
  currentRank: number
  /** Points banked / points available. */
  pointsPct: number
  gamesPlayed: number
  /** True when the club is running an announced rebuild — the bench is safe. */
  rebuilding?: boolean
}

export interface CoachFiring {
  teamId: string
  coachId: string
  coachName: string
  headline: string
  body: string
  category: NewsCategory
}

/** League-wide ceiling on in-season dismissals, so the carousel is an event. */
export const MAX_MIDSEASON_FIRINGS = 3
/** No bench moves before this many games — a slow start is not a season. */
export const MIDSEASON_MIN_GAMES = 22
/** Nor after this fraction of the season: past here a club rides it out. */
const MIDSEASON_MAX_FRACTION = 0.8

/* ────────────────────────── mid-season ────────────────────────── */

/**
 * How exposed is this bench, 0–1? Built from the two things a board actually
 * looks at: how far below the September projection the club has fallen, and
 * whether the points pace is genuinely bad in absolute terms. A coach who is
 * underperforming a projection while still banking points survives; a coach
 * doing both does not.
 */
export function seatHeat(seat: CoachSeat, teamsInLeague: number): number {
  const rankDrop = (seat.currentRank - seat.predictedRank) / Math.max(1, teamsInLeague - 1)
  // .500 is the waterline; .380 is a fireable pace anywhere.
  const paceGap = Math.max(0, 0.500 - seat.pointsPct) / 0.140
  const heat = Math.max(0, rankDrop) * 0.65 + Math.min(1.4, paceGap) * 0.55
  // A coach in his first month with a club is not the problem yet; a lifer is
  // the easiest change to make.
  const tenureTilt = seat.tenure === 0 ? -0.18 : seat.tenure >= 4 ? 0.10 : 0
  return Math.max(0, Math.min(1, heat + tenureTilt))
}

/**
 * Decide this club's mid-season fate. `alreadyFiredThisSeason` is the count of
 * benches already changed league-wide, so the cap is honoured across calls.
 */
export function midSeasonFirings(args: {
  seats: CoachSeat[]
  totalGames: number
  teamsInLeague: number
  alreadyFiredThisSeason: number
  rng: Rng
}): CoachFiring[] {
  const { seats, totalGames, teamsInLeague, alreadyFiredThisSeason, rng } = args
  if (alreadyFiredThisSeason >= MAX_MIDSEASON_FIRINGS) return []

  // Hottest seat first, so the club in real trouble is the one that moves.
  const ranked = seats
    .filter((s) => s.rebuilding !== true)
    .filter((s) => s.gamesPlayed >= MIDSEASON_MIN_GAMES)
    .filter((s) => s.gamesPlayed / Math.max(1, totalGames) <= MIDSEASON_MAX_FRACTION)
    .map((s) => ({ seat: s, heat: seatHeat(s, teamsInLeague) }))
    .filter((x) => x.heat >= 0.62)
    .sort((a, b) => b.heat - a.heat || a.seat.teamId.localeCompare(b.seat.teamId))

  const out: CoachFiring[] = []
  let budget = MAX_MIDSEASON_FIRINGS - alreadyFiredThisSeason
  for (const { seat, heat } of ranked) {
    if (budget <= 0) break
    // Even a scalding seat is not a certainty on any given check — boards
    // deliberate. Heat 0.62 → ~11 %, heat 1.0 → ~35 %.
    const p = Math.min(0.35, (heat - 0.55) * 0.75)
    if (!rng.chance(p)) continue
    out.push(buildFiring(seat, 'midseason', rng))
    budget -= 1
  }
  return out
}

/* ────────────────────────── offseason ────────────────────────── */

/**
 * Summer churn. A club that finished well below its projection moves on, and a
 * long-tenured coach with nothing to show gets moved on too. Capped so the
 * league never turns over wholesale in one June.
 */
export function offseasonFirings(args: {
  seats: CoachSeat[]
  teamsInLeague: number
  rng: Rng
  /** Absolute ceiling for the summer. Defaults to a fifth of the league. */
  maxFirings?: number
}): CoachFiring[] {
  const { seats, teamsInLeague, rng } = args
  const cap = args.maxFirings ?? Math.max(2, Math.round(teamsInLeague * 0.18))

  const ranked = seats
    .filter((s) => s.rebuilding !== true)
    .map((s) => {
      const drop = (s.currentRank - s.predictedRank) / Math.max(1, teamsInLeague - 1)
      // Summer forgives less than midwinter: finishing below projection is the
      // whole case, and a long tenure with no progress is its own case.
      let p = Math.max(0, drop) * 0.85 + Math.max(0, 0.500 - s.pointsPct) * 1.6
      if (s.tenure >= 5 && s.currentRank > teamsInLeague / 2) p += 0.14
      if (s.tenure === 0) p *= 0.35 // you do not fire the man you just hired
      return { seat: s, p: Math.min(0.55, p) }
    })
    .filter((x) => x.p >= 0.10)
    .sort((a, b) => b.p - a.p || a.seat.teamId.localeCompare(b.seat.teamId))

  const out: CoachFiring[] = []
  for (const { seat, p } of ranked) {
    if (out.length >= cap) break
    if (!rng.chance(p)) continue
    out.push(buildFiring(seat, 'offseason', rng))
  }
  return out
}

/* ────────────────────────── the prose ────────────────────────── */

const ord = (v: number): string => {
  if (v % 100 >= 11 && v % 100 <= 13) return `${v}th`
  return `${v}${['th', 'st', 'nd', 'rd'][v % 10] ?? 'th'}`
}

const MID_HEADS: ReadonlyArray<(t: string, c: string) => string> = [
  (t, c) => `${t} fire head coach ${c}`,
  (t, c) => `${c} out in ${t} as the board loses patience`,
  (t, c) => `${t} make a change behind the bench: ${c} relieved`,
]

const SUMMER_HEADS: ReadonlyArray<(t: string, c: string) => string> = [
  (t, c) => `${t} part ways with ${c}`,
  (t, c) => `${c} will not return to the ${t} bench`,
  (t, c) => `${t} begin a coaching search after moving on from ${c}`,
]

function buildFiring(seat: CoachSeat, window: 'midseason' | 'offseason', rng: Rng): CoachFiring {
  const pace = `${(seat.pointsPct * 100).toFixed(0)}% of available points`
  const tenureLine =
    seat.tenure === 0
      ? `He does not see the end of his first season behind the bench.`
      : seat.tenure === 1
        ? `He lasted a season and change.`
        : `He leaves after ${seat.tenure} full seasons in the job.`

  const headline =
    window === 'midseason'
      ? MID_HEADS[rng.int(MID_HEADS.length)]!(seat.teamName, seat.coachName)
      : SUMMER_HEADS[rng.int(SUMMER_HEADS.length)]!(seat.teamName, seat.coachName)

  const body =
    window === 'midseason'
      ? `${seat.teamName} have dismissed ${seat.coachName} ${seat.gamesPlayed} games into the season. ` +
        `Picked ${ord(seat.predictedRank)} in September, they sit ${ord(seat.currentRank)} on ${pace}. ` +
        `${tenureLine} An interim takes the room until the summer.`
      : `${seat.teamName} will not bring ${seat.coachName} back. ` +
        `The club was projected ${ord(seat.predictedRank)} and finished ${ord(seat.currentRank)} on ${pace}. ` +
        `${tenureLine} His name joins the market.`

  return {
    teamId: seat.teamId,
    coachId: seat.coachId,
    coachName: seat.coachName,
    headline,
    body,
    category: 'league',
  }
}
