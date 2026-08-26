/**
 * PRESSURE — what it costs you when the building turns.
 *
 * Playtest 2026-08-26 §E3: "no pressure from fans or ownership". Expectations
 * already existed (the board mandate, the media's preseason pick); what was
 * missing was the CONSEQUENCE layer — a fanbase that reacts to results against
 * those expectations while the season is still running, and an owner whose
 * patience is spent by an angry building rather than by arithmetic alone.
 *
 * The model is deliberately slow. A fanbase turns over weeks, not overnight, so
 * mood eases toward its target rather than snapping to it, and a beat only
 * reaches the inbox when the mood CROSSES a band it has not visited this season.
 * At most a handful of pressure stories a year — the user's own constraint was
 * "don't spam it".
 *
 * Design rules (shared with the rest of the story layer):
 *   - Pure functions, no side effects, no wall-clock, no unseeded randomness.
 *   - JSON-safe state (no Maps, no classes).
 *   - Ruleset-aware: season length and league size arrive as arguments.
 */

import type { Rng } from '@engine/shared/rng'
import type { NewsCategory } from '@domain/news'

/* ────────────────────────── types ────────────────────────── */

/** Serializable; embedded as an optional field on CareerSnapshot. */
export interface PressureState {
  /** Season this mood belongs to. Rebuilt each September. */
  year: number
  /** 0–100 in-season fan mood. Seeded from carry-over fan interest. */
  mood: number
  /** Bands already reported on this season, so a story never repeats. */
  emittedBands: string[]
  /** Checkpoints spent in the bottom two bands — the owner is counting too. */
  hostileChecks: number
  /** Team games played at the last checkpoint, so we sample, not stream. */
  lastCheckGames: number
}

export type PressureBand = 'backing' | 'content' | 'restless' | 'angry' | 'mutinous'

export interface PressureNewsSeed {
  category: NewsCategory
  headline: string
  body: string
  teamId?: string
}

export interface PressureUpdate {
  newsSeeds: PressureNewsSeed[]
  /** Board patience to burn this checkpoint (0 when the fans are fine). */
  patienceDrain: number
  band: PressureBand
  /** True when a checkpoint was actually sampled this call. */
  checked: boolean
}

/** Games between pressure checkpoints. Sampling, not streaming. */
export const PRESSURE_CHECK_EVERY = 10
/** Fraction of the season that must be played before the fans have a verdict. */
const PRESSURE_WARMUP = 0.15

/* ────────────────────────── the model ────────────────────────── */

/**
 * Points percentage a club finishing at `targetRank` would typically post.
 * Anchored on the real NHL spread: a Presidents-Trophy pace is around .680, a
 * last-place team around .390, and the curve between them is close to linear in
 * rank. Ruleset-aware through `n`.
 */
export function expectedPointsPct(targetRank: number, n: number): number {
  const t = (Math.max(1, Math.min(n, targetRank)) - 1) / Math.max(1, n - 1) // 0 best → 1 worst
  return 0.680 - t * 0.290
}

export function bandOf(mood: number): PressureBand {
  if (mood >= 75) return 'backing'
  if (mood >= 58) return 'content'
  if (mood >= 40) return 'restless'
  if (mood >= 24) return 'angry'
  return 'mutinous'
}

export function pressureLabel(band: PressureBand): string {
  switch (band) {
    case 'backing':  return 'Behind you — the building believes'
    case 'content':  return 'Content — the fans are along for the ride'
    case 'restless': return 'Restless — the grumbling has started'
    case 'angry':    return 'Angry — the boos are audible'
    case 'mutinous': return 'Mutinous — they want you gone'
  }
}

/** Fresh mood for a new season, seeded from where the fanbase was left. */
export function freshPressure(year: number, fanInterest: number): PressureState {
  // September optimism: even a jaded fanbase starts a season a little above
  // where last year left it, and nobody starts at the extremes.
  const start = Math.max(30, Math.min(82, Math.round(fanInterest * 0.75 + 22)))
  return { year, mood: start, emittedBands: [], hostileChecks: 0, lastCheckGames: 0 }
}

/**
 * Sample the mood at a checkpoint. Returns silently (checked: false) between
 * checkpoints and during the warm-up — fifteen percent of a season is not a
 * verdict, and the fans know it.
 */
export function updatePressure(args: {
  state: PressureState
  teamName: string
  teamId?: string
  /** 1 = best. */
  currentRank: number
  targetRank: number
  teamsInLeague: number
  gamesPlayed: number
  totalGames: number
  points: number
  /** Most-recent-first W/L/O string; only the last ten matter. */
  recentForm?: string
  inPlayoffSpot: boolean
  /** Ownership signed off on a losing season — the fans were told the plan. */
  rebuilding: boolean
  rng: Rng
}): PressureUpdate {
  const {
    state, teamName, teamId, currentRank, targetRank, teamsInLeague: n,
    gamesPlayed, totalGames, points, recentForm, inPlayoffSpot, rebuilding, rng,
  } = args

  const idle: PressureUpdate = {
    newsSeeds: [], patienceDrain: 0, band: bandOf(state.mood), checked: false,
  }
  if (gamesPlayed <= 0 || totalGames <= 0) return idle
  if (gamesPlayed / totalGames < PRESSURE_WARMUP) return idle
  if (gamesPlayed - state.lastCheckGames < PRESSURE_CHECK_EVERY) return idle

  state.lastCheckGames = gamesPlayed

  const actualPct = points / (gamesPlayed * 2)
  const expectedPct = expectedPointsPct(targetRank, n)
  const paceGap = actualPct - expectedPct // ±0.15 is a huge miss either way

  let formBonus = 0
  if (recentForm !== undefined && recentForm.length > 0) {
    const recent = recentForm.slice(0, 10)
    const w = [...recent].filter((c) => c === 'W').length
    const l = [...recent].filter((c) => c === 'L').length
    formBonus = ((w - l) / recent.length) * 8
  }

  // The target the mood is heading for. Pace against the board's own target is
  // the spine; form and the playoff line are what a supporter actually feels.
  let target =
    56 +
    paceGap * 230 +
    formBonus +
    (inPlayoffSpot ? 6 : -8) +
    (currentRank === 1 ? 4 : 0)

  // A sanctioned rebuild does not make the fans happy — it makes them patient.
  // The floor rises; the ceiling does not.
  if (rebuilding) target = Math.max(target, 42)

  target = Math.max(0, Math.min(100, target))

  // Ease toward the target: a third of the gap per checkpoint, so it takes most
  // of a bad half-season to turn a full house into an empty one.
  const eased = state.mood + (target - state.mood) * 0.34
  state.mood = Math.max(0, Math.min(100, Math.round(eased)))

  const band = bandOf(state.mood)
  const newsSeeds: PressureNewsSeed[] = []

  // A beat fires once per band per season, and only for bands worth a story:
  // the two hostile ones, and the one where the building is genuinely behind you.
  const worthTelling = band === 'mutinous' || band === 'angry' || band === 'backing'
  if (worthTelling && !state.emittedBands.includes(band)) {
    state.emittedBands.push(band)
    newsSeeds.push(bandStory(band, { teamName, currentRank, targetRank, actualPct, rng, teamId }))
  }

  let patienceDrain = 0
  if (band === 'mutinous') {
    state.hostileChecks += 1
    patienceDrain = 4
  } else if (band === 'angry') {
    state.hostileChecks += 1
    patienceDrain = 2
  } else {
    state.hostileChecks = 0
  }
  // A rebuild the owner signed off on cannot be used against you by the crowd.
  if (rebuilding) patienceDrain = Math.floor(patienceDrain / 2)

  return { newsSeeds, patienceDrain, band, checked: true }
}

/* ────────────────────────── the prose ────────────────────────── */

const ord = (v: number): string => {
  if (v % 100 >= 11 && v % 100 <= 13) return `${v}th`
  return `${v}${['th', 'st', 'nd', 'rd'][v % 10] ?? 'th'}`
}

const MUTINOUS: ReadonlyArray<(t: string) => string> = [
  (t) => `Empty seats and a chant: ${t} supporters have had enough`,
  (t) => `"Sell the team" — the ${t} crowd turns on the front office`,
  (t) => `${t} fans stage a walkout in the third period`,
]

const ANGRY: ReadonlyArray<(t: string) => string> = [
  (t) => `Boos ring out at the ${t} home barn`,
  (t) => `The mood has soured on ${t}`,
  (t) => `${t} supporters are running out of patience`,
]

const BACKING: ReadonlyArray<(t: string) => string> = [
  (t) => `The building is rocking: ${t} fans have bought in`,
  (t) => `${t} sell out again as the city falls back in love`,
  (t) => `A full house and a standing ovation for ${t}`,
]

function bandStory(
  band: PressureBand,
  f: { teamName: string; currentRank: number; targetRank: number; actualPct: number; rng: Rng; teamId?: string | undefined },
): PressureNewsSeed {
  const { teamName, currentRank, targetRank, actualPct, rng, teamId } = f
  const pace = `${(actualPct * 100).toFixed(0)}% of available points`
  const gap = currentRank - targetRank

  let headline: string
  let body: string

  if (band === 'mutinous') {
    headline = MUTINOUS[rng.int(MUTINOUS.length)]!(teamName)
    body =
      `${teamName} sit ${ord(currentRank)} against a stated target of ${ord(targetRank)}, banking ${pace}. ` +
      `Sections of the lower bowl emptied before the horn tonight, and the ones who stayed made themselves heard. ` +
      `The front office is the target now, not the room.`
  } else if (band === 'angry') {
    headline = ANGRY[rng.int(ANGRY.length)]!(teamName)
    body =
      `${ord(currentRank)} in the league on ${pace}, with the board's target set at ${ord(targetRank)}. ` +
      (gap >= 8
        ? `That is not a slow start any more — it is the season. `
        : `The margin is small; the mood is not. `) +
      `Talk radio has moved on from the coach and started saying the general manager's name.`
  } else {
    headline = BACKING[rng.int(BACKING.length)]!(teamName)
    body =
      `${teamName} are ${ord(currentRank)} on ${pace}, comfortably ahead of a ${ord(targetRank)} target. ` +
      `Tickets are moving, the barn is loud, and the goodwill in the building is the kind you can spend later.`
  }

  return { category: 'league', headline, body, ...(teamId !== undefined ? { teamId } : {}) }
}
