/**
 * Press schedule — deterministic season-long calendar of recurring media reports.
 *
 * Design:
 *  - Pure functions; no randomness, no wall-clock.
 *  - Reports fire at well-defined points in the season lifecycle (regular-season
 *    match-day index, playoff entry, or offseason stage transition).
 *  - Persistence uses a `PressScheduleState` object stored in `storyMisc`; all
 *    fields are optional so older saves safely default to "nothing fired yet".
 *  - Callers pass the state in and get a mutated copy back alongside any jobs
 *    to queue.
 *
 * Cadence:
 *   seasonPreview    — match day index 0 (very first match day of the season)
 *   powerRankings    — index 0 + every MONTHLY_INTERVAL indices (~monthly)
 *   monthlyReport    — every MONTHLY_INTERVAL match-day indices, offset by half
 *   playoffPreview   — on entering the playoffs phase (once per season)
 *   awardsNight      — on entering offseason 'awards' stage
 *   draftPreview     — on entering offseason 'draft' stage
 *   seasonReview     — on entering offseason 'preseason' stage (season truly over)
 */

import type { PressSheetKind } from './factSheet'

export interface PressScheduleState {
  /** Match-day index of the last powerRankings report (avoids double-fire). */
  lastPowerRankingsIdx: number
  /** Match-day index of the last monthlyReport (avoids double-fire). */
  lastMonthlyReportIdx: number
  /** True once seasonPreview has been fired this season. */
  seasonPreviewFired: boolean
  /** True once playoffPreview has been fired this season. */
  playoffPreviewFired: boolean
  /** True once awardsNight has been fired this season. */
  awardsNightFired: boolean
  /** True once draftPreview has been fired this season. */
  draftPreviewFired: boolean
  /** True once seasonReview has been fired this season. */
  seasonReviewFired: boolean
}

export function initialPressScheduleState(): PressScheduleState {
  return {
    lastPowerRankingsIdx: -1,
    lastMonthlyReportIdx: -1,
    seasonPreviewFired: false,
    playoffPreviewFired: false,
    awardsNightFired: false,
    draftPreviewFired: false,
    seasonReviewFired: false,
  }
}

/** Merge a persisted (possibly partial) snapshot back to a full state. */
export function hydratePressScheduleState(saved: Partial<PressScheduleState> | undefined): PressScheduleState {
  const def = initialPressScheduleState()
  if (!saved) return def
  return {
    lastPowerRankingsIdx: saved.lastPowerRankingsIdx ?? def.lastPowerRankingsIdx,
    lastMonthlyReportIdx: saved.lastMonthlyReportIdx ?? def.lastMonthlyReportIdx,
    seasonPreviewFired: saved.seasonPreviewFired ?? def.seasonPreviewFired,
    playoffPreviewFired: saved.playoffPreviewFired ?? def.playoffPreviewFired,
    awardsNightFired: saved.awardsNightFired ?? def.awardsNightFired,
    draftPreviewFired: saved.draftPreviewFired ?? def.draftPreviewFired,
    seasonReviewFired: saved.seasonReviewFired ?? def.seasonReviewFired,
  }
}

// Each "month" is approximately 14 match days (roughly a real month of hockey).
const MONTHLY_INTERVAL = 14

// Power rankings are refreshed every month-ish. Offset from monthly reports so
// they don't land on the same day.
const POWER_RANKINGS_INTERVAL = MONTHLY_INTERVAL

// Monthly reports start at index MONTHLY_INTERVAL/2 so they're offset from rankings.
const MONTHLY_OFFSET = Math.floor(MONTHLY_INTERVAL / 2)

/**
 * Called once per match day during the regular season.
 * Returns the list of report kinds to fire, and mutates the state.
 */
export function checkRegularSeasonReports(
  pressIdx: number,
  state: PressScheduleState
): PressSheetKind[] {
  const toFire: PressSheetKind[] = []

  // Season preview + initial power rankings on the very first match day.
  if (pressIdx === 0 && !state.seasonPreviewFired) {
    toFire.push('seasonPreview')
    state.seasonPreviewFired = true
    toFire.push('powerRankings')
    state.lastPowerRankingsIdx = 0
  }

  // Power rankings: every POWER_RANKINGS_INTERVAL match days after the first.
  if (pressIdx > 0 && pressIdx - state.lastPowerRankingsIdx >= POWER_RANKINGS_INTERVAL) {
    toFire.push('powerRankings')
    state.lastPowerRankingsIdx = pressIdx
  }

  // Monthly report: every MONTHLY_INTERVAL match days, offset by MONTHLY_OFFSET from rankings.
  if (
    pressIdx >= MONTHLY_OFFSET &&
    pressIdx - state.lastMonthlyReportIdx >= MONTHLY_INTERVAL
  ) {
    toFire.push('monthlyReport')
    state.lastMonthlyReportIdx = pressIdx
  }

  return toFire
}

/** Called when the career enters the playoffs phase. Returns kinds to fire (once). */
export function checkPlayoffEntry(state: PressScheduleState): PressSheetKind[] {
  if (state.playoffPreviewFired) return []
  state.playoffPreviewFired = true
  return ['playoffPreview']
}

/** Called when the career enters the offseason 'awards' stage. Returns kinds to fire (once). */
export function checkAwardsStage(state: PressScheduleState): PressSheetKind[] {
  if (state.awardsNightFired) return []
  state.awardsNightFired = true
  return ['awardsNight']
}

/** Called when the career enters the offseason 'draft' stage. Returns kinds to fire (once). */
export function checkDraftStage(state: PressScheduleState): PressSheetKind[] {
  if (state.draftPreviewFired) return []
  state.draftPreviewFired = true
  return ['draftPreview']
}

/** Called when the career enters the offseason 'preseason' stage (season is truly done). Returns kinds to fire (once). */
export function checkPreseasonStage(state: PressScheduleState): PressSheetKind[] {
  if (state.seasonReviewFired) return []
  state.seasonReviewFired = true
  return ['seasonReview']
}
