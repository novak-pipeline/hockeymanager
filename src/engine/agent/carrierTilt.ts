/**
 * W3 S5 - THE PUCK CARRIER'S SITUATION TILT (W3-DESIGN item 4).
 *
 * `decideCarrier` (brain.ts) values every option - shoot, pass, carry, dump,
 * chip, protect, deke - as expected goal value. The tilt is a small vector of
 * weights on top of those values, read from one data table keyed by the
 * situation, so the same read plays differently trailing late, protecting a
 * lead, on the power play, killing a penalty, under pressure, in his own zone,
 * and in tight. The coach's playbook (S4) sets the neutral-zone entry; the
 * GM's sliders still multiply on top (brain.ts).
 *
 * A weight multiplies an option's value when it is positive and divides it
 * when it is negative (so "up" always means "more attractive"). `risk`
 * multiplies the turnover cost inside every option (how much he fears losing
 * it there). `progress` scales the no-gain pass cost (a pass has to gain
 * something: brain.ts PROGRESS). All sizes are "calibrate"; the direction of
 * each row is the design's.
 *
 * Score effect: the NHL's trailing teams out-shoot their opponents (~54-56% of
 * attempts, more late). The agent engine carried `scoreEffectMult` only as an
 * unused import; the tilt's score rows are the agent engine's score effect now
 * and the import is gone (the quick sim keeps its own).
 */
import type { Playbook } from '@engine/league/coachProfile'

export interface CarrierTilt {
  shoot: number
  pass: number
  carry: number
  /** Dump it in (the neutral-zone rim to their corner). */
  dump: number
  /** Chip it: past the man in the neutral zone, off the glass and out in ours, a PK clear. */
  chip: number
  protect: number
  deke: number
  /** Turnover-cost multiplier (fear of losing it where it would be lost). */
  risk: number
  /** One-timer / cross-seam feed value. */
  seam: number
  /** No-gain pass cost multiplier (brain.ts PROGRESS). */
  progress: number
}

/** Dev switches for the S5 ablations (teamPlay.measure TP_ABLATE turns one off at a time; never set in play). */
export const S5_DEV = { tilt: true, progress: true, rush: true, walkOut: true, face: true, tightSpeed: true }

export const NO_TILT: Readonly<CarrierTilt> = { shoot: 1, pass: 1, carry: 1, dump: 1, chip: 1, protect: 1, deke: 1, risk: 1, seam: 1, progress: 1 }

/** The situation table (directions from W3-DESIGN item 4; sizes calibrate). */
export const CARRIER_TILT: Readonly<Record<'trailingLate' | 'leadingLate' | 'powerPlay' | 'penaltyKill' | 'pressure' | 'ownZone', Partial<CarrierTilt>>> = {
  /** Down late: shoot more, take risks, don't throw it away on a dump. */
  trailingLate: { shoot: 1.3, risk: 0.7, dump: 0.75, carry: 1.05, progress: 1.3 },
  /** Up late: safe plays, chip it out and in, no low-percentage passes. */
  leadingLate: { shoot: 0.9, risk: 1.4, chip: 1.3, dump: 1.25, deke: 0.7 },
  /** Power play: patience - moving it around the box is the play (less no-gain cost), look for the seam. */
  powerPlay: { seam: 1.4, risk: 0.9, dump: 0.8, progress: 0.5 },
  /** Penalty kill: clear it; carry only into open ice. */
  penaltyKill: { chip: 1.4, carry: 0.85, deke: 0.5, risk: 1.3, shoot: 0.85 },
  /** Full pressure (scaled by the pressure 0..1): the simple play - nearest outlet, the chip; no dekes. */
  pressure: { deke: 0.55, chip: 1.25, pass: 1.08, protect: 1.15 },
  /** In his own zone: a turnover there is a goal against; glass-and-out is a play. */
  ownZone: { risk: 1.5, chip: 1.15, deke: 0.6 },
}

/**
 * In tight: the time cap (s) a carrier may hold the puck inside the home plate
 * before he must shoot, pass or walk out (VT16); how far out (ft) "in tight" runs;
 * and how much farther from the net (ft) a carry must end to count as walking it out.
 */
/**
 * Power-play patience: the shot's weight is scaled by how good the chance is,
 * xG over xgRef, within [lo, hi] - he passes up the low-percentage shot and
 * waits for the seam or the slot; the good one he takes.
 */
export const PP_PATIENCE = { xgRef: 0.06, lo: 0.75, hi: 1.35 }

export const IN_TIGHT = { capS: 1.0, radiusFt: 30, walkOutFt: 8 }

export interface CarrierSituation {
  /** Goals for minus against. */
  lead: number
  /** Share of regulation played, 0 at the opening draw, 1 at the end of the third (> 1 in OT). */
  progress: number
  powerPlay: boolean
  shorthanded: boolean
  /** Pressure on the carrier, 0..1 (brain.ts pressureOn). */
  pressure: number
  /** x in the attack frame (ft). */
  adv: number
}

/** How late it is for the score rows: nothing before the third, full by its last five minutes. */
export function lateness(progress: number): number {
  const p = progress > 1 ? 1 : progress
  return p < 2 / 3 ? 0 : Math.min(1, (p - 2 / 3) / 0.25)
}

function blend(t: CarrierTilt, row: Partial<CarrierTilt>, k: number): void {
  if (k <= 0) return
  for (const key of Object.keys(row) as (keyof CarrierTilt)[]) t[key] *= 1 + ((row[key] ?? 1) - 1) * k
}

/** The carrier's tilt for this situation (and, for the neutral zone, his playbook - applied in brain.ts as entryK). */
export function carrierTilt(sit: CarrierSituation, _playbook?: Playbook): CarrierTilt {
  const t: CarrierTilt = { ...NO_TILT }
  if (!S5_DEV.tilt) return t
  const late = lateness(sit.progress)
  // a one-goal game counts full; two goals still matter; past that it is garbage time
  const margin = Math.abs(sit.lead)
  const scoreK = margin === 0 ? 0 : margin <= 2 ? 1 : 0.4
  if (sit.lead < 0) blend(t, CARRIER_TILT.trailingLate, late * scoreK)
  if (sit.lead > 0) blend(t, CARRIER_TILT.leadingLate, late * scoreK)
  if (sit.powerPlay) blend(t, CARRIER_TILT.powerPlay, 1)
  if (sit.shorthanded) blend(t, CARRIER_TILT.penaltyKill, 1)
  blend(t, CARRIER_TILT.pressure, sit.pressure)
  if (sit.adv < -25) blend(t, CARRIER_TILT.ownZone, 1)
  return t
}

/** Apply a weight to an option value: up = more attractive whatever the sign. */
export function tilted(ev: number, k: number): number {
  return k === 1 ? ev : ev >= 0 ? ev * k : ev / k
}
