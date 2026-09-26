/**
 * THE FRONT-OFFICE CAROUSEL — AI clubs dismiss their general managers.
 *
 * The coaching carousel (coachCarousel.ts) turns benches over five-to-eight
 * times a year. General managers are a different animal: ownership gives a GM
 * a plan and years to run it, so a real NHL summer sees one to three GM
 * changes, almost always after the season and almost always after a run of
 * disappointment — not one bad year. This module decides which AI clubs make
 * that call.
 *
 * The case against a GM is SUSTAINED failure against expectation:
 *   - a "disappointing" season = finished well below the September projection,
 *     or missed the playoffs when projected into them, or finished in the
 *     league's basement while not in an acknowledged rebuild;
 *   - `missStreak` counts those seasons back to back (the career layer keeps it
 *     on the persona, so it survives save/load);
 *   - two in a row opens the case; three is usually the end; a long-tenured GM
 *     whose club is in the basement is exposed even on one.
 * Never in a GM's first two seasons, and a young rebuild is largely forgiven.
 *
 * Pure + deterministic + JSON-safe: seats in, dismissals out, seeded Rng only.
 */

import type { Rng } from '@engine/shared/rng'

export interface GmSeat {
  teamId: string
  teamName: string
  teamAbbr: string
  gmName: string
  /** Completed seasons in the job, INCLUDING the one just finished. */
  tenure: number
  /** Consecutive disappointing seasons, INCLUDING the one just finished. */
  missStreak: number
  /** Where the media picked them in September (1 = best). */
  predictedRank: number
  /** Where they finished (1 = best). */
  finalRank: number
  madePlayoffs: boolean
  /** The club reads as a rebuild (roster shape) — the owner knew what he bought. */
  rebuilding: boolean
}

export interface GmDismissal {
  teamId: string
  gmName: string
  headline: string
  body: string
  /** The probability the model assigned — surfaced for calibration only. */
  p: number
}

/** League-wide ceiling on AI GM dismissals in one summer. */
export const MAX_GM_DISMISSALS = 3
/** A GM is never judged before completing this many seasons. */
export const GM_MIN_TENURE = 2

/**
 * Was the season just finished a disappointment against expectation? The same
 * test the career layer uses to advance `missStreak`, exported so both sides
 * can never disagree about what counts.
 */
export function isDisappointingSeason(
  s: Pick<GmSeat, 'predictedRank' | 'finalRank' | 'madePlayoffs' | 'rebuilding'>,
  teamsInLeague: number
): boolean {
  const n = Math.max(2, teamsInLeague)
  const slide = s.finalRank - s.predictedRank
  // Well short of the projection: ~a fifth of the league (6 places in 32).
  if (slide >= Math.max(3, Math.round(n * 0.19))) return true
  // Projected into the playoffs comfortably and missed them.
  if (!s.madePlayoffs && s.predictedRank <= Math.floor(n * 0.4)) return true
  // The basement, when nobody sold the owner a rebuild.
  if (!s.rebuilding && s.finalRank > Math.ceil(n * 0.84)) return true
  return false
}

/** Probability the owner makes the change this summer, 0–1. */
export function dismissalOdds(seat: GmSeat, teamsInLeague: number): number {
  if (seat.tenure < GM_MIN_TENURE) return 0
  const n = Math.max(2, teamsInLeague)
  const basement = seat.finalRank > Math.ceil(n * 0.75)
  let p = 0
  // Calibrated on the imported 32-team league (docs/PRESSURE-AND-FIRINGS.md):
  // at 0.5/0.24/0.10 the league changed ~0.6 GMs a summer and at 0.6/0.38/0.16
  // ~0.8 — both under the NHL's 1–3. A single collapse (a third of the league
  // below the projection) is also a case for a GM with a few years in.
  const collapse = seat.finalRank - seat.predictedRank >= Math.round(n * 0.34)
  if (seat.missStreak >= 3) p = 0.65
  else if (seat.missStreak === 2) p = 0.45
  else if (seat.missStreak === 1 && seat.tenure >= 5 && basement) p = 0.2
  else if (seat.missStreak === 1 && seat.tenure >= 3 && collapse) p = 0.12
  if (p === 0) return 0
  // How bad the final season was sharpens the case.
  const slide = Math.max(0, seat.finalRank - seat.predictedRank) / (n - 1)
  p += slide * 0.25
  if (basement) p += 0.06
  // An owner who signed off on a rebuild gives it time — but not forever.
  if (seat.rebuilding) p *= seat.tenure <= 4 ? 0.3 : 0.7
  return Math.max(0, Math.min(0.7, p))
}

/** Decide the summer's GM dismissals, hottest seat first, capped league-wide. */
export function offseasonGmDismissals(args: {
  seats: GmSeat[]
  teamsInLeague: number
  rng: Rng
  maxDismissals?: number
}): GmDismissal[] {
  const { seats, teamsInLeague, rng } = args
  const cap = args.maxDismissals ?? MAX_GM_DISMISSALS
  const ranked = seats
    .map((seat) => ({ seat, p: dismissalOdds(seat, teamsInLeague) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || a.seat.teamId.localeCompare(b.seat.teamId))
  const out: GmDismissal[] = []
  for (const { seat, p } of ranked) {
    if (out.length >= cap) break
    if (!rng.chance(p)) continue
    out.push(buildDismissal(seat, p, rng))
  }
  return out
}

/** The hottest seat among the candidates — used when the league MUST have an
 *  opening (a fired user needs somewhere to go). Deterministic: no roll. */
export function hottestGmSeat(seats: GmSeat[], teamsInLeague: number): GmSeat | null {
  let best: { seat: GmSeat; score: number } | null = null
  for (const seat of seats) {
    if (seat.tenure < GM_MIN_TENURE) continue
    // Odds first; the worst finish breaks ties so a basement club is the fallback.
    const score = dismissalOdds(seat, teamsInLeague) * 100 + seat.finalRank / teamsInLeague
    if (!best || score > best.score || (score === best.score && seat.teamId < best.seat.teamId)) best = { seat, score }
  }
  return best?.seat ?? null
}

/* ────────────────────────── prose ────────────────────────── */

const ord = (v: number): string => {
  if (v % 100 >= 11 && v % 100 <= 13) return `${v}th`
  return `${v}${['th', 'st', 'nd', 'rd'][v % 10] ?? 'th'}`
}

const HEADS: ReadonlyArray<(t: string, g: string) => string> = [
  (t, g) => `${t} relieve general manager ${g} of his duties`,
  (t, g) => `${t} ownership moves on from GM ${g}`,
  (t, g) => `${g} out as ${t} general manager`,
]

export function buildDismissal(seat: GmSeat, p: number, rng: Rng): GmDismissal {
  const run =
    seat.missStreak >= 3
      ? `a ${seat.missStreak === 3 ? 'third' : `${seat.missStreak}th`} straight season short of what was promised`
      : seat.missStreak === 2
        ? 'a second straight season short of what was promised'
        : 'another season at the bottom of the league'
  const headline = HEADS[rng.int(HEADS.length)]!(seat.teamName, seat.gmName)
  const body =
    `${seat.teamName} have dismissed general manager ${seat.gmName} after ${seat.tenure} season${seat.tenure === 1 ? '' : 's'} in the job. ` +
    `Picked ${ord(seat.predictedRank)} in September, the club finished ${ord(seat.finalRank)}` +
    `${seat.madePlayoffs ? '' : ' and out of the playoffs'} — ${run}. ` +
    `Ownership begins a search for the man who will run the hockey department.`
  return { teamId: seat.teamId, gmName: seat.gmName, headline, body, p }
}
