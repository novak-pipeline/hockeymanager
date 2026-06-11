/**
 * THE DIRECTOR — *what happens next*.
 *
 * A watched game is no longer a soup of per-tick probabilities: play advances
 * as a chain of sampled BEATS (breakout → regroup → entry → cycle → point shot
 * → rebound scramble → freeze → faceoff …). The director is a seeded
 * semi-Markov sampler over that chain. Its transition weights and hazard rates
 * are derived from `CALIBRATION_TARGETS.sequences` — aggregates computed from
 * real NHL play-by-play (offsides/icings/freezes per game, zone-time shares,
 * entry and rush-shot rates, whistle cadence) — with hardcoded NHL-shaped
 * fallbacks used until that optional field lands in targets.json.
 *
 * Team strength, tactics (forecheck / pace / passRisk / shotEagerness), and
 * strength state (PP/PK/pulled) modulate the weights: better teams sample more
 * offensive-zone beats; a trap team suppresses opponent carry entries; a PP
 * samples shot beats more eagerly. The director decides only WHAT happens —
 * HOW it looks is the choreographer's job (playbook.ts), and shot OUTCOMES
 * stay with the calibrated xG machinery in fullSim.ts.
 */
import { CALIBRATION_TARGETS } from '@calibrate'
import type { Rng } from '@engine/shared/rng'
import { clamp } from './types'

/**
 * FROZEN SHAPE (shared with the calibration importer): per-game sequence /
 * rhythm aggregates from real NHL play-by-play. Optional on
 * CalibrationTargets — `sequenceTargets()` falls back when absent.
 */
export interface SequenceTargets {
  /** Whole-game stoppage counts, both teams combined. */
  stoppagesPerGame: { offside: number; icing: number; goalieFreeze: number; other: number }
  /** Share of event-activity time by rink third (attacking-team perspective). */
  zoneTimeShare: { offensive: number; neutral: number; defensive: number }
  /** Offensive-zone entries leading to at least one recorded event. */
  entriesPerTeamPer60: number
  /** Unblocked attempts per such entry. */
  shotsPerEntry: number
  /** Share of shots within 6s of the zone-entry proxy. */
  rushShotShare: number
  /** Share of shots within 3s of a previous save/shot. */
  reboundShotShare: number
  meanSecondsBetweenStoppages: number
  /** Share of faceoffs by dot zone (home-team perspective collapsed to thirds). */
  faceoffZoneMix: { offensive: number; neutral: number; defensive: number }
}

/** NHL-shaped fallbacks, used until the data importer fills `.sequences`. */
export const FALLBACK_SEQUENCES: SequenceTargets = {
  stoppagesPerGame: { offside: 4.5, icing: 7, goalieFreeze: 11, other: 8 },
  zoneTimeShare: { offensive: 0.38, neutral: 0.24, defensive: 0.38 },
  entriesPerTeamPer60: 55,
  shotsPerEntry: 1.55,
  rushShotShare: 0.3,
  reboundShotShare: 0.07,
  meanSecondsBetweenStoppages: 95,
  faceoffZoneMix: { offensive: 0.31, neutral: 0.38, defensive: 0.31 }
}

/** The sequence targets the engine runs on (real data when present). */
export function sequenceTargets(): SequenceTargets {
  const seq = (CALIBRATION_TARGETS as unknown as { sequences?: SequenceTargets }).sequences
  return seq ?? FALLBACK_SEQUENCES
}

/** Context the director reads when a carrier hits the offensive blue line. */
export interface EntryCtx {
  /** Feet of room the nearest defending body ahead is giving the carrier. */
  gapFt: number
  /** Carrier puck/skating skill normalized to league average (≈1). */
  skill: number
  pace: number
  passRisk: number
  /** Defending team runs the neutral-zone trap → suppress carry entries. */
  oppTrap: boolean
  /** Attacking team is shorthanded → mostly just dump it deep. */
  shorthanded: boolean
  /** Roster-strength edge of the attacker over the defender, ≈ −0.5..0.5. */
  edge: number
}

export type EntryPick = 'carry' | 'dump' | 'offside'

/** Context for sampling the next offensive-zone beat off the cycle. */
export interface OzCtx {
  /** A point man (D) is on the ice and in position for a low-to-high play. */
  hasPointMan: boolean
  /** tactics.shotEagerness mapped to ≈0.7–1.3. */
  eagerness: number
  /** PP/PK/pulled shot-rate multiplier (1 at even strength). */
  strengthMult: number
  /** Roster-strength edge, ≈ −0.5..0.5: better teams keep the cycle alive. */
  edge: number
}

export type OzPick = 'cycle' | 'pointShot' | 'seamOneTimer' | 'wraparound'

// Hazard denominators, measured from the engine itself (decision/settled
// ticks per game in each situation), then frozen — same technique as
// DECISION_TICKS_PER_GAME in fullSim.ts. Retune there, not per-feature.
const SETTLED_TICKS_PER_GAME = 12800
const DEEP_POSSESSION_TICKS_PER_GAME = 4700

export class Director {
  readonly seq: SequenceTargets
  private readonly rng: Rng

  /** P(an "other" stoppage — puck out of play, net off, etc.) per settled tick. */
  readonly pOtherPerTick: number
  /** P(a hurried length-of-ice icing) per settled deep-own-end possession tick. */
  readonly pIcingPerTick: number
  /** P(an entry attempt dies offside) per blue-line decision. */
  readonly pOffsidePerEntry: number
  /** P(a clean entry turns into an immediate rush shot) — drives rushShotShare. */
  readonly pRushAfterEntry: number
  /** Base P(goalie freezes the puck | save) — drives goalieFreeze stoppages. */
  readonly freezeBase: number
  /** Per-settled-tick chance of an organic shot off the cycle (kind 'cycle'). */
  readonly cycleShotPerTick: number

  constructor(rng: Rng, seq: SequenceTargets = sequenceTargets()) {
    this.rng = rng
    this.seq = seq
    const R = CALIBRATION_TARGETS.perTeamPerGame
    const attemptsPerTeam = R.shotsOnGoal + R.blockedShots
    const entriesPerTeam = Math.max(20, seq.entriesPerTeamPer60)
    const savesPerGame = Math.max(20, 2 * (R.shotsOnGoal - R.goals))

    this.pOtherPerTick = seq.stoppagesPerGame.other / SETTLED_TICKS_PER_GAME
    this.pIcingPerTick = seq.stoppagesPerGame.icing / DEEP_POSSESSION_TICKS_PER_GAME
    // Per-team offsides over per-team entry attempts (attempts = entries + fails).
    const offPerTeam = seq.stoppagesPerGame.offside / 2
    this.pOffsidePerEntry = clamp((offPerTeam / (entriesPerTeam + offPerTeam)) * 0.9, 0.01, 0.25)
    // The 0.62 scalar reconciles "share of shots" with "per-entry sampling"
    // (counters and breakaways add rush shots the per-entry path doesn't see).
    // Measured against the engine, then frozen.
    this.pRushAfterEntry = clamp(((seq.rushShotShare * attemptsPerTeam) / entriesPerTeam) * 0.62, 0.05, 0.5)
    this.freezeBase = clamp(seq.stoppagesPerGame.goalieFreeze / savesPerGame, 0.05, 0.5)
    this.cycleShotPerTick = 0.005
  }

  /** P(goalie eats the puck) given net-front traffic (0..1) and rebound chaos. */
  pFreeze(netFront: number, offRebound: boolean): number {
    return clamp(this.freezeBase * (0.45 + netFront * 0.45) + (offRebound ? 0.04 : 0), 0.03, 0.6)
  }

  /**
   * Blue-line decision: carry it wide, dump-and-chase, or (rarely, at the
   * data-driven rate) botch the timing and go offside. Gap, skill, tactics,
   * the opposing trap, and the strength state all tilt the carry/dump split;
   * the offside share stays pinned to the NHL rate regardless of the mix.
   */
  sampleEntry(c: EntryCtx): EntryPick {
    const wCarry =
      1.15 *
      c.skill *
      clamp(c.gapFt / 28, 0.45, 1.7) *
      (0.7 + c.pace * 0.6) *
      (1 + c.edge * 0.5) *
      (c.oppTrap ? 0.55 : 1) *
      (c.shorthanded ? 0.35 : 1)
    const wDump =
      (0.5 + clamp(1 - c.gapFt / 32, 0, 1)) *
      (1.2 - c.passRisk * 0.4) *
      (c.oppTrap ? 1.4 : 1) *
      (c.shorthanded ? 3 : 1)
    const pOff = this.pOffsidePerEntry
    const wOffside = (wCarry + wDump) * (pOff / (1 - pOff))
    const r = this.rng.float(0, wCarry + wDump + wOffside)
    if (r < wOffside) return 'offside'
    if (r < wOffside + wDump) return 'dump'
    return 'carry'
  }

  /**
   * What the cycle flows into once its dwell expires: keep working the walls,
   * walk the line for a point shot through traffic, hit the seam for a
   * one-timer, or jam a wraparound. Shot beats scale with eagerness, the
   * strength state, and roster edge — that is where "better teams sample more
   * OZ beats" lives.
   */
  sampleOzBeat(c: OzCtx): OzPick {
    const s = c.eagerness * c.strengthMult * (0.85 + c.edge * 0.3)
    const wPoint = c.hasPointMan ? 0.085 * s : 0
    const wSeam = 0.065 * s
    const wWrap = 0.012 * s
    const wCycle = 0.88 * (1 + c.edge * 0.25)
    const r = this.rng.float(0, wPoint + wSeam + wWrap + wCycle)
    if (r < wPoint) return 'pointShot'
    if (r < wPoint + wSeam) return 'seamOneTimer'
    if (r < wPoint + wSeam + wWrap) return 'wraparound'
    return 'cycle'
  }

  /** Ticks a cycle beat holds before the director samples the next OZ beat. */
  cycleDwell(): number {
    return 12 + this.rng.int(14)
  }

  /** Ticks a neutral-zone regroup settles (D-to-D, stretch look) before attacking. */
  regroupDwell(pace: number): number {
    const base = 4 + this.rng.int(10)
    return Math.round(base * (1.35 - pace * 0.7))
  }
}
