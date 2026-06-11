/**
 * Calibration targets derived from real NHL play-by-play (build step #5).
 *
 * This module is the bridge between the calibration DEV TOOL (`importNhl.ts`,
 * which scrapes the free NHL API and writes `targets.json`) and the ENGINE,
 * which consumes the derived aggregates to drive event rates and shot danger
 * instead of hand-tuned constants.
 *
 * IMPORTANT (legal): only *aggregate math* is committed here. Raw NHL
 * play-by-play is cached to a gitignored dir and never checked in. We ship the
 * math, not the data.
 */
import rawTargets from './targets.json'

/** A binned empirical shot-danger (xG) surface: P(goal | unblocked attempt). */
export interface XgSurface {
  /** Distance-to-net bin edges, in feet (net at x = ±89). length = rows + 1. */
  distanceEdges: number[]
  /** Shot-angle bin edges, in degrees (0 = straight on). length = cols + 1. */
  angleEdges: number[]
  /** xg[d][a] = goals / unblocked-attempts in that distance×angle cell. */
  xg: number[][]
  /** Raw unblocked-attempt counts per cell (for confidence / re-weighting). */
  attempts: number[][]
}

/** Mean per-team-per-game counts for every event type the engine models. */
export interface EventRates {
  shotsOnGoal: number
  missedShots: number
  blockedShots: number
  goals: number
  hits: number
  takeaways: number
  giveaways: number
  faceoffs: number
  penalties: number
}

export interface CalibrationTargets {
  meta: {
    source: string
    season: string
    games: number
    generated: string
    note: string
  }
  /** League finishing/goaltending rates over all unblocked attempts. */
  shooting: {
    /** goals / shots-on-goal */
    shootingPct: number
    /** 1 - shootingPct, i.e. saves / shots-on-goal */
    savePct: number
    /** goals / unblocked-attempts (the surface's overall mean). */
    fenwickShootingPct: number
  }
  perTeamPerGame: EventRates
  xgSurface: XgSurface
}

export const CALIBRATION_TARGETS = rawTargets as CalibrationTargets

/** Look up empirical xG for a shot at (distanceFt, angleDeg) on the surface. */
export function lookupXg(
  surface: XgSurface,
  distanceFt: number,
  angleDeg: number,
  fallback = 0
): number {
  const d = binIndex(surface.distanceEdges, distanceFt)
  const a = binIndex(surface.angleEdges, angleDeg)
  return surface.xg[d]?.[a] ?? fallback
}

function binIndex(edges: number[], value: number): number {
  for (let i = 0; i < edges.length - 1; i++) {
    if (value < edges[i + 1]) return i
  }
  return edges.length - 2
}
