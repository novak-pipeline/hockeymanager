/**
 * Radar model — six axes derived from composites (and raw attributes where needed).
 *
 * Formula (all inputs are 0–100 composite or raw values):
 *
 *   hockeyIQ      = avg(offensiveIQ, defensiveIQ, anticipation, vision)
 *                   — 4 raw mental attrs; captures reads/hockey sense
 *
 *   skating       = composites.skating
 *                   — already a clean weighted avg of speed/accel/agility/balance/stamina
 *
 *   shot          = composites.scoring
 *                   — wristShot × 3 + slapShot × 2 + deflections + offensiveIQ × 2 + composure + anticipation
 *
 *   offensiveZone = avg(composites.scoring, composites.playmaking, composites.puckControl)
 *                   — 3-composite average; covers all offensive on-ice contributions
 *
 *   defensiveZone = composites.defensiveZone
 *                   — defensive IQ, positioning, stick-checking, shot-blocking, anticipation
 *
 *   physicality   = avg(composites.hitting, raw.strength, raw.checking)
 *                   — hitting composite + two root physical-battle attrs for physical dominance
 *
 * All outputs are clamped to [0, 99] and rounded to integers.
 */
import type { CompositeRatings, RawAttributes } from '@domain'

/* ────────────────────────── types ────────────────────────── */

/** Six-axis radar breakdown. Each axis is 0–99. */
export interface RadarAxes {
  hockeyIQ: number
  skating: number
  shot: number
  offensiveZone: number
  defensiveZone: number
  physicality: number
}

/** Snapshot exported to the view layer (structured-clone-safe). */
export type RadarView = RadarAxes

/** Ordered axis names for rendering (display order). */
export const RADAR_AXES: ReadonlyArray<keyof RadarAxes> = [
  'hockeyIQ',
  'skating',
  'shot',
  'offensiveZone',
  'defensiveZone',
  'physicality',
] as const

/* ────────────────────────── implementation ────────────────────────── */

function clamp99(v: number): number {
  return Math.round(Math.max(0, Math.min(99, v)))
}

function avg(...values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((s, v) => s + v, 0) / values.length
}

/**
 * Compute the six-axis radar from a player's composites and raw attributes.
 * Safe for goalies — their composites.skating is non-zero; other axes will
 * be very low (goaltending not included; the goaltending composite is surfaced
 * separately on the profile).
 */
export function computeRadar(raw: RawAttributes, composites: CompositeRatings): RadarView {
  const mental = raw.mental
  const physical = raw.physical
  const defensive = raw.defensive

  const hockeyIQ = clamp99(
    avg(mental.offensiveIQ, mental.defensiveIQ, mental.anticipation, mental.vision)
  )

  const skating = clamp99(composites.skating)

  const shot = clamp99(composites.scoring)

  const offensiveZone = clamp99(avg(composites.scoring, composites.playmaking, composites.puckControl))

  const defensiveZone = clamp99(composites.defensiveZone)

  const physicality = clamp99(avg(composites.hitting, physical.strength, defensive.checking))

  return { hockeyIQ, skating, shot, offensiveZone, defensiveZone, physicality }
}
