/**
 * Coach tactical profile: a deep, hockey-authentic identity for a head coach.
 *
 * Every head coach believes in a way of playing. Those beliefs live here as a
 * set of 0–1 axes plus a named SYSTEM (1-3-1 trap, 2-1-2 forecheck, etc.) and a
 * plain-English philosophy. The profile is DERIVED, never hand-set:
 *   - real imported coaches → from their EHM tendency attributes (attacking,
 *     directness, physical, freeRoles, lineMatching, powerplay, penaltyKill,
 *     tactics; 1–20 each), so the system reflects how the real coach actually
 *     plays;
 *   - generated / unsigned coaches → synthesised from rating + judgment +
 *     demeanor + specialty, with stable per-id jitter so the result is
 *     deterministic and needs no persistence.
 *
 * This module is pure and deterministic (no wall-clock, no unseeded RNG). It is
 * the keystone of the coach overhaul: later phases map a profile to the engine-
 * wired TeamTactics (profileToTactics) and grade roster fit (coachFit).
 */

import type { StaffMember, StaffAttributes } from './staff'
import type { TeamStyleKind } from './archetypes'
import { teamStyleFit, styleMatch } from './archetypes'
import type { Rng } from '@engine/shared/rng'
import type {
  Player,
  TeamTactics,
  ForecheckSystem,
  DefensiveZoneCoverage,
  PowerPlayFormation,
  PenaltyKillFormation,
} from '@domain'

/* ─────────────────────────── system taxonomy ─────────────────────────── */

/**
 * The seven named systems a coach can run. Each is a recognisable NHL identity,
 * not a vague label — the depth the GM should feel when scouting a coach.
 */
export type CoachSystemId =
  | 'lowEventTrap'        // 1-3-1 neutral-zone trap, controlled breakout, block shots
  | 'aggressiveForecheck' // 2-1-2 heavy pursuit, dump-and-chase, hunt turnovers
  | 'speedTransition'     // 1-2-2, stretch breakout, attack off the rush
  | 'cyclePossession'     // grind it low, controlled entries, F1 down on the cycle
  | 'structuredTwoWay'    // 1-2-2 forecheck, contain D-zone, low-risk north-south
  | 'runAndGun'           // all-out attack, high pinch, shoot on sight
  | 'defensiveShell'      // collapse the D-zone, passive NZ, protect the slot

/** Denormalised, display-ready names for a coach's system across all phases of play. */
export interface CoachSystem {
  id: CoachSystemId
  label: string
  forecheckName: string
  breakoutName: string
  nzName: string
  dZoneName: string
  ppName: string
  pkName: string
  paceName: string
  blurb: string
}

/**
 * A coach's tactical beliefs. Axes are 0–1, neutral at 0.5; the named identity
 * (`system`, `meta`, `philosophy`) is derived from the axes for display.
 */
export interface CoachProfile {
  system: CoachSystemId
  /** One-line plain-English summary, e.g. "Defence-first puck-possession coach". */
  philosophy: string
  /** Forecheck pursuit + physical risk. */
  aggression: number
  /** Game pace — low-event vs run-and-gun. */
  tempo: number
  /** Attack commitment / mentality. */
  offence: number
  /** System rigidity vs free roles (high = structured). */
  structure: number
  /** How high/hard the team pressures the puck. */
  forecheckDepth: number
  /** Pinch, stretch passes, carry-in entries. */
  riskTolerance: number
  /** Special-teams competence. */
  ppCompetence: number
  pkCompetence: number
  /** Tactician quality — scales system coherence and how hard he resists the GM. */
  tacticsKnowledge: number
  /** Denormalised system metadata for display. */
  meta: CoachSystem
}

export const SYSTEM_META: Record<CoachSystemId, CoachSystem> = {
  lowEventTrap: {
    id: 'lowEventTrap',
    label: 'Low-Event Trap',
    forecheckName: '1-3-1 Neutral-Zone Trap',
    breakoutName: 'Controlled / reverse',
    nzName: '1-3-1 trap',
    dZoneName: 'Collapsing box +1',
    ppName: 'Umbrella',
    pkName: 'Passive box',
    paceName: 'Low-event',
    blurb: 'Clogs the neutral zone, forces dumps, and wins on the margins. Frustrating to play against.',
  },
  aggressiveForecheck: {
    id: 'aggressiveForecheck',
    label: 'Heavy Forecheck',
    forecheckName: '2-1-2 pressure',
    breakoutName: 'Up-quick (chip & chase)',
    nzName: 'Aggressive 2-1-2',
    dZoneName: 'Man-to-man',
    ppName: 'Overload',
    pkName: 'Aggressive 1-3',
    paceName: 'High-tempo',
    blurb: 'Two men in deep, hunts pucks in the offensive zone, lives on forced turnovers.',
  },
  speedTransition: {
    id: 'speedTransition',
    label: 'Speed & Transition',
    forecheckName: '1-2-2 contain',
    breakoutName: 'Stretch (long outlet)',
    nzName: '1-2-2 with stretch',
    dZoneName: 'Hybrid',
    ppName: '1-3-1',
    pkName: 'Diamond',
    paceName: 'Up-tempo',
    blurb: 'Defends to counter — quick outlets and odd-man rushes off the carry.',
  },
  cyclePossession: {
    id: 'cyclePossession',
    label: 'Cycle & Possession',
    forecheckName: '2-1-2 cycle',
    breakoutName: 'Controlled (5-man)',
    nzName: 'Controlled regroup',
    dZoneName: 'Zone',
    ppName: 'Overload',
    pkName: 'Box',
    paceName: 'Measured',
    blurb: 'Holds the puck down low, grinds shifts in the corners, wears teams out.',
  },
  structuredTwoWay: {
    id: 'structuredTwoWay',
    label: 'Structured Two-Way',
    forecheckName: '1-2-2 forecheck',
    breakoutName: 'Controlled',
    nzName: '1-2-2 contain',
    dZoneName: 'Hybrid',
    ppName: 'Umbrella',
    pkName: 'Box',
    paceName: 'Balanced',
    blurb: 'Disciplined north-south hockey, manages risk, rarely beats itself.',
  },
  runAndGun: {
    id: 'runAndGun',
    label: 'Run-and-Gun',
    forecheckName: '2-1-2 all-out',
    breakoutName: 'Stretch (high risk)',
    nzName: 'Aggressive attack',
    dZoneName: 'Aggressive',
    ppName: '1-3-1',
    pkName: 'Aggressive 1-3',
    paceName: 'Run-and-gun',
    blurb: 'Trades chances all night — pinches hard, shoots on sight, entertainment over structure.',
  },
  defensiveShell: {
    id: 'defensiveShell',
    label: 'Defensive Shell',
    forecheckName: '1-4 passive',
    breakoutName: 'Safe rim / off the glass',
    nzName: 'Passive 1-3-1',
    dZoneName: 'Collapse to the slot',
    ppName: 'Umbrella',
    pkName: 'Passive box',
    paceName: 'Low-event',
    blurb: 'Sits back, protects the house, and dares opponents to beat him from the outside.',
  },
}

/** What roster composition each system is built to exploit (for scouting/UI). */
export const SYSTEM_FAVORS: Record<CoachSystemId, string> = {
  lowEventTrap: 'Favours mobile, hockey-smart defencemen and disciplined two-way forwards. Masks thin scoring depth by keeping games low-event.',
  aggressiveForecheck: 'Favours fast, relentless forwards and puck-hounding wingers who win battles down low. Demands conditioning and depth.',
  speedTransition: 'Favours elite skating and skilled puck-movers who attack off the rush. Rewards offensive defencemen who join the play.',
  cyclePossession: 'Favours big, strong forwards and puck-moving D who hold the o-zone and grind shifts in the corners.',
  structuredTwoWay: 'Favours balanced, versatile two-way players. Low-risk and adaptable — fits almost any roster.',
  runAndGun: 'Favours high-end scorers and offensive defencemen. Trades chances all night, so you need the firepower to win them.',
  defensiveShell: 'Favours shot-blocking, stay-at-home defenders and a strong goalie. Built to protect leads, not chase games.',
}

/** Bridge each system to the existing 4-kind fit machinery in archetypes.ts. */
export const SYSTEM_TO_STYLE_KIND: Record<CoachSystemId, TeamStyleKind> = {
  lowEventTrap: 'trap',
  defensiveShell: 'trap',
  structuredTwoWay: 'balanced',
  cyclePossession: 'cycleGrind',
  aggressiveForecheck: 'cycleGrind',
  speedTransition: 'speedSkill',
  runAndGun: 'speedSkill',
}

/* ─────────────────────────── helpers ─────────────────────────── */

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))
const clampAxis = (v: number): number => Math.max(0.05, Math.min(0.95, v))
/** EHM 1–20 → 0–1; undefined → neutral 0.5. */
const norm20 = (v: number | undefined): number => (v === undefined ? 0.5 : clamp01((v - 1) / 19))

/**
 * Stable per-id float in [0,1). Same algorithm as staff.ts/scouting.ts so the
 * jitter is reproducible across saves without persisting anything.
 */
function stableFloat(id: string, salt: number): number {
  let h = 5381
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) >>> 0
  h = (Math.imul(h ^ (salt >>> 0), 0x9e3779b1) + 0x85ebca77) >>> 0
  return (h >>> 0) / 4294967296
}

/* ─────────────────────────── system selection ─────────────────────────── */

/**
 * Map the belief axes to a named system. Ordered, authentic decision tree:
 * the most distinctive identities are tested first, with a balanced default.
 */
export function deriveSystem(p: {
  aggression: number
  tempo: number
  offence: number
  structure: number
  forecheckDepth: number
  riskTolerance: number
}): CoachSystemId {
  if (p.tempo < 0.35 && p.offence < 0.4 && p.structure > 0.55) return 'lowEventTrap'
  if (p.offence > 0.7 && p.riskTolerance > 0.6 && p.tempo > 0.6) return 'runAndGun'
  if (p.tempo > 0.6 && p.riskTolerance > 0.55) return 'speedTransition'
  if (p.aggression > 0.6 && p.forecheckDepth > 0.6) return 'aggressiveForecheck'
  if (p.offence > 0.55 && p.tempo < 0.55 && p.structure > 0.5) return 'cyclePossession'
  if (p.offence < 0.4 && p.structure > 0.6) return 'defensiveShell'
  return 'structuredTwoWay'
}

/** Compose a one-line philosophy from the system + the dominant belief. */
function describePhilosophy(system: CoachSystemId, axes: CoachAxes): string {
  const lean =
    axes.offence >= 0.62 ? 'attack-minded' :
    axes.offence <= 0.4 ? 'defence-first' :
    'two-way'
  const pace =
    axes.tempo >= 0.62 ? 'up-tempo' :
    axes.tempo <= 0.4 ? 'low-event' :
    'balanced-pace'
  const hand = axes.structure >= 0.6 ? 'structured' : axes.structure <= 0.4 ? 'read-and-react' : 'adaptable'
  return `${lean[0]!.toUpperCase()}${lean.slice(1)}, ${pace} ${hand} coach — ${SYSTEM_META[system].label.toLowerCase()}`
}

interface CoachAxes {
  aggression: number
  tempo: number
  offence: number
  structure: number
  forecheckDepth: number
  riskTolerance: number
  ppCompetence: number
  pkCompetence: number
  tacticsKnowledge: number
}

function assemble(axes: CoachAxes): CoachProfile {
  const system = deriveSystem(axes)
  return {
    system,
    philosophy: describePhilosophy(system, axes),
    meta: SYSTEM_META[system],
    ...axes,
  }
}

/* ─────────────────────────── derivation: real coaches ─────────────────────────── */

/** Whether a staff member carries any EHM tactical-tendency attribute. */
function hasTacticalAttributes(a: StaffAttributes | undefined): boolean {
  if (!a) return false
  return (
    a.attacking !== undefined || a.directness !== undefined || a.freeRoles !== undefined ||
    a.lineMatching !== undefined || a.penaltyKill !== undefined || a.physical !== undefined ||
    a.powerplay !== undefined || a.tactics !== undefined
  )
}

/** Derive a profile from a real coach's imported EHM attributes. */
export function deriveProfileFromAttributes(coach: StaffMember): CoachProfile {
  const a = coach.attributes ?? {}
  const attacking = norm20(a.attacking)
  const directness = norm20(a.directness)
  const physical = norm20(a.physical)
  const freeRoles = norm20(a.freeRoles)
  const tacticsAttr = a.tactics !== undefined ? norm20(a.tactics) : clamp01((coach.rating - 40) / 50)

  const axes: CoachAxes = {
    aggression: clampAxis(0.5 * directness + 0.5 * physical),
    tempo: clampAxis(0.5 * attacking + 0.5 * directness),
    offence: clampAxis(attacking),
    structure: clampAxis(1 - freeRoles),
    forecheckDepth: clampAxis(0.5 * directness + 0.5 * physical),
    riskTolerance: clampAxis(0.5 * attacking + 0.5 * freeRoles),
    ppCompetence: clampAxis(norm20(a.powerplay)),
    pkCompetence: clampAxis(norm20(a.penaltyKill)),
    tacticsKnowledge: clampAxis(tacticsAttr),
  }
  return assemble(axes)
}

/* ─────────────────────────── derivation: synthetic coaches ─────────────────────────── */

const DEMEANOR_NUDGE: Record<NonNullable<StaffMember['demeanor']>, Partial<CoachAxes>> = {
  fiery: { aggression: 0.16, tempo: 0.12, forecheckDepth: 0.12, structure: -0.1 },
  analytical: { structure: 0.14, tacticsKnowledge: 0.12, riskTolerance: -0.06 },
  pragmatic: { structure: 0.12, offence: -0.06, tempo: -0.06 },
  motivator: { offence: 0.12, aggression: 0.06 },
  calm: { structure: 0.08, tempo: -0.08 },
}

function specialtyNudge(specialty: string | undefined): Partial<CoachAxes> {
  switch (specialty) {
    case 'Offense': return { offence: 0.14, tempo: 0.08, ppCompetence: 0.14 }
    case 'Power Play': return { ppCompetence: 0.2, offence: 0.08 }
    case 'Defense': return { offence: -0.12, structure: 0.12 }
    case 'Penalty Kill': return { pkCompetence: 0.2, structure: 0.08 }
    case 'System': return { structure: 0.14, tacticsKnowledge: 0.12 }
    case 'Player Development': return { structure: 0.06 }
    default: return {}
  }
}

/**
 * Synthesize a plausible profile from rating/judgment/demeanor/specialty.
 * Jitter is stable per coach id (no rng draw consumed) so the profile recomputes
 * identically across save/load with zero extra persisted state. `rng` is accepted
 * for signature compatibility but intentionally unused.
 */
export function deriveSyntheticProfile(coach: StaffMember, rng?: Rng): CoachProfile {
  void rng
  const base = 0.5
  const axes: CoachAxes = {
    aggression: base,
    tempo: base,
    offence: base,
    structure: base,
    forecheckDepth: base,
    riskTolerance: base,
    ppCompetence: clamp01((coach.rating - 40) / 50),
    pkCompetence: clamp01((coach.rating - 40) / 50),
    tacticsKnowledge: clamp01((coach.rating - 40) / 50),
  }

  const apply = (nudge: Partial<CoachAxes>): void => {
    for (const k of Object.keys(nudge) as (keyof CoachAxes)[]) {
      axes[k] = axes[k] + (nudge[k] ?? 0)
    }
  }
  if (coach.demeanor) apply(DEMEANOR_NUDGE[coach.demeanor])
  apply(specialtyNudge(coach.specialty))

  // Stable per-id jitter, distinct salt per axis.
  const keys: (keyof CoachAxes)[] = [
    'aggression', 'tempo', 'offence', 'structure', 'forecheckDepth', 'riskTolerance',
  ]
  keys.forEach((k, i) => {
    axes[k] = clampAxis(axes[k] + (stableFloat(coach.id, 7000 + i) - 0.5) * 0.18)
  })
  axes.ppCompetence = clampAxis(axes.ppCompetence)
  axes.pkCompetence = clampAxis(axes.pkCompetence)
  axes.tacticsKnowledge = clampAxis(axes.tacticsKnowledge)

  return assemble(axes)
}

/* ─────────────────────────── public entry ─────────────────────────── */

/**
 * Build a head coach's tactical profile. Uses the real EHM attributes when the
 * coach carries any tactical tendency; otherwise synthesises one. Deterministic.
 */
export function buildCoachProfile(coach: StaffMember, rng?: Rng): CoachProfile {
  if (hasTacticalAttributes(coach.attributes)) return deriveProfileFromAttributes(coach)
  return deriveSyntheticProfile(coach, rng)
}

/* ─────────────────────────── profile → engine tactics ─────────────────────────── */

const SYSTEM_FORECHECK: Record<CoachSystemId, ForecheckSystem> = {
  lowEventTrap: 'trap',
  defensiveShell: 'trap',
  aggressiveForecheck: '2-1-2',
  cyclePossession: '2-1-2',
  runAndGun: '2-1-2',
  speedTransition: '1-2-2',
  structuredTwoWay: '1-2-2',
}
const SYSTEM_PP: Record<CoachSystemId, PowerPlayFormation> = {
  lowEventTrap: 'umbrella',
  defensiveShell: 'umbrella',
  structuredTwoWay: 'umbrella',
  aggressiveForecheck: 'overload',
  cyclePossession: 'overload',
  speedTransition: '1-3-1',
  runAndGun: '1-3-1',
}
const SYSTEM_PK: Record<CoachSystemId, PenaltyKillFormation> = {
  lowEventTrap: 'box',
  defensiveShell: 'box',
  structuredTwoWay: 'box',
  cyclePossession: 'box',
  speedTransition: 'diamond',
  aggressiveForecheck: 'aggressive',
  runAndGun: 'aggressive',
}

/** Continuous knob from a 0–1 axis: exactly 0.5 at a neutral 0.5 axis. */
/** Gain for the offence / risk sliders (see profileToTactics). */
const OFFENCE_GAIN = 0.6

function knob(axis: number, gain = 1.2): number {
  return clamp01(0.5 + (axis - 0.5) * gain)
}

function avgSkaterSpeed(roster: Player[]): number {
  const skaters = roster.filter((p) => p.position !== 'G')
  if (skaters.length === 0) return 55
  return skaters.reduce((s, p) => s + p.ratings.physical.speed, 0) / skaters.length
}

function dZoneFromStructure(structure: number): DefensiveZoneCoverage {
  if (structure >= 0.6) return 'zone'
  if (structure <= 0.4) return 'man'
  return 'hybrid'
}

/**
 * Map a coach's beliefs onto the engine-wired TeamTactics knobs, adapting to the
 * roster. Continuous knobs are neutral-preserving; the pace knob blends 65/35
 * toward the roster's natural style (teamStyleFit) so a possession coach pushes
 * pace with a fast roster but leans on the cycle with a slow one. A 1-2-2
 * forecheck is downgraded to 2-1-2 when the roster lacks the speed to trap high.
 */
export function profileToTactics(profile: CoachProfile, roster: Player[], base: TeamTactics): TeamTactics {
  const fit = teamStyleFit({ roster })
  const fitPace = fit.suggestedTactics.tempo?.pace
  const profilePace = knob(profile.tempo)
  const pace = clamp01(fitPace === undefined ? profilePace : profilePace * 0.65 + fitPace * 0.35)

  let forecheck = SYSTEM_FORECHECK[profile.system]
  if (forecheck === '1-2-2' && avgSkaterSpeed(roster) < 58) forecheck = '2-1-2'

  return {
    ...base,
    forecheck,
    dZoneCoverage: dZoneFromStructure(profile.structure),
    // One personality axis drives several sliders here, and the sim's effects
    // stack — so the offence/risk sliders take a gentler gain (a strongly
    // offensive coach lands ~0.7, not 0.9+: that met another and produced
    // 100-shot, 20-goal games).
    tempo: {
      pace,
      passRisk: knob(profile.riskTolerance, OFFENCE_GAIN),
      shotEagerness: knob(profile.offence, OFFENCE_GAIN),
      defensivePinch: knob(profile.riskTolerance, OFFENCE_GAIN),
    },
    specialTeams: {
      powerPlay: SYSTEM_PP[profile.system],
      penaltyKill: SYSTEM_PK[profile.system],
    },
    // EHM-style sliders (engine-wired; neutral-preserving)
    aggressiveness: knob(profile.aggression),
    hitting: knob(profile.aggression),
    puckPressure: knob(profile.forecheckDepth),
    gapControl: knob(profile.structure),
    shooting: knob(profile.offence, OFFENCE_GAIN),
    passing: knob((profile.offence + profile.riskTolerance) / 2, OFFENCE_GAIN),
    dumping: knob(1 - profile.riskTolerance),
    mentality: knob(profile.offence, OFFENCE_GAIN),
  }
}

/* ─────────────────────────── coach ↔ roster fit ─────────────────────────── */

const NEUTRAL_TACTICS: TeamTactics = {
  forecheck: '1-2-2',
  dZoneCoverage: 'zone',
  tempo: { pace: 0.5, passRisk: 0.5, shotEagerness: 0.5, defensivePinch: 0.4 },
  specialTeams: { powerPlay: 'umbrella', penaltyKill: 'box' },
  lineMatching: false,
}

/**
 * How well a coach's system suits the roster (0–100; ~70 = serviceable baseline).
 * Reuses the calibrated styleMatch machinery against the tactics the coach would
 * actually run with this roster.
 */
export function coachFit(profile: CoachProfile, roster: Player[]): number {
  return styleMatch(roster, profileToTactics(profile, roster, NEUTRAL_TACTICS)).fit
}

/**
 * Convert a coach-fit score (0–100) into a small on-ice execution multiplier.
 * Neutral (1.0) at the styleMatch baseline of 70; a perfect fit nudges shot
 * conversion +1.5%, a poor fit −1.5%. Deliberately subtle — coaching is real but
 * modest, and the cap keeps calibration intact.
 */
export function coachFitMultiplier(fit: number): number {
  const v = Math.max(-1, Math.min(1, (fit - 70) / 30))
  return 1 + v * 0.015
}

/* ─────────────────────────── special-teams coaching ─────────────────────────── */

/**
 * What each PP scheme needs from its first unit. The fit term rewards a coach
 * whose system's formation happens to suit his personnel — and dings one whose
 * scheme fights them: an umbrella without a point bomber, a 1-3-1 without
 * seam passers, an overload without cycle hands.
 */
function ppFormationMetric(formation: PowerPlayFormation, unit: Player[]): number {
  if (unit.length === 0) return 50
  const avg = (pick: (p: Player) => number): number => unit.reduce((s, p) => s + pick(p), 0) / unit.length
  switch (formation) {
    case 'umbrella': {
      // Lives off the one-timer from the top: the best point shot on the unit.
      return Math.max(...unit.map((p) => p.ratings.technical.slapShot))
    }
    case '1-3-1':
      return avg((p) => p.composites.playmaking)
    case 'overload':
      return avg((p) => p.composites.puckControl)
  }
}

/**
 * The club's special-teams coaching edges, precomputed by the career layer onto
 * the Team (the coachFit pattern) and read by BOTH engines:
 *
 *   ppEdge — multiplier on the club's own power-play shot generation. Coach PP
 *            competence (±6%) plus formation-personnel fit (±3%): did his
 *            system's scheme land on what his PP1 can actually run?
 *   pkEdge — multiplier on the OPPONENT's shot rate while this club kills.
 *            Below 1 = strong kill. Competence only (±6%) — PK formation fit
 *            is a future refinement.
 *
 * Both centered on 1.0 at an average coach, so the league-wide PP% stays on
 * calibration; only the spread between well- and poorly-coached units grows.
 */
export function specialTeamsEdges(
  profile: CoachProfile,
  tactics: TeamTactics,
  ppUnit: Player[]
): { ppEdge: number; pkEdge: number } {
  const clampEdge = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
  let pp = 1 + (profile.ppCompetence - 0.5) * 0.12
  if (ppUnit.length > 0) {
    const chosen = ppFormationMetric(tactics.specialTeams.powerPlay, ppUnit)
    const best = Math.max(
      ppFormationMetric('umbrella', ppUnit),
      ppFormationMetric('1-3-1', ppUnit),
      ppFormationMetric('overload', ppUnit)
    )
    // 0 when the coach's scheme is the personnel-optimal one; up to −0.03 when
    // his system saddles the unit with the wrong look. A great tactician loses
    // less to a mismatch (he adapts the details).
    pp -= Math.min(0.03, ((best - chosen) / 25) * 0.03) * (1.3 - 0.6 * profile.tacticsKnowledge)
  }
  // Good killers suppress the opposing PP (multiplier on THEIR shot rate).
  const pk = 1 - (profile.pkCompetence - 0.5) * 0.12
  return { ppEdge: clampEdge(pp, 0.9, 1.1), pkEdge: clampEdge(pk, 0.9, 1.1) }
}

/* ─────────────────────────── GM influence (gradual nudges) ─────────────────────────── */

/** Axis shifts a coach makes when he accepts a GM's tactical request. */
const DIRECTION_NUDGE: Record<string, Partial<CoachAxes>> = {
  faster: { tempo: 0.1, offence: 0.06, riskTolerance: 0.05, forecheckDepth: 0.04 },
  defensive: { tempo: -0.1, offence: -0.07, structure: 0.06, riskTolerance: -0.05 },
  physical: { aggression: 0.1, forecheckDepth: 0.06 },
  aggressiveForecheck: { forecheckDepth: 0.1, aggression: 0.06 },
  fitRoster: {}, // adopts roster-optimal tactics this season; philosophy unchanged
}

/**
 * Shift a coach's beliefs gradually toward a GM request he has accepted, then
 * re-derive his named system. Small (≤0.1/axis) so influence accumulates over
 * meetings rather than flipping the coach in one conversation.
 */
export function nudgeProfileForDirection(profile: CoachProfile, direction: string): CoachProfile {
  const axes: CoachAxes = {
    aggression: profile.aggression,
    tempo: profile.tempo,
    offence: profile.offence,
    structure: profile.structure,
    forecheckDepth: profile.forecheckDepth,
    riskTolerance: profile.riskTolerance,
    ppCompetence: profile.ppCompetence,
    pkCompetence: profile.pkCompetence,
    tacticsKnowledge: profile.tacticsKnowledge,
  }
  const nudge = DIRECTION_NUDGE[direction] ?? {}
  for (const k of Object.keys(nudge) as (keyof CoachAxes)[]) {
    axes[k] = clampAxis(axes[k] + (nudge[k] ?? 0))
  }
  return assemble(axes)
}

/* ─────────────────── W3 S4: the system on the ice (the agent engine) ─────────────────── */
//
// A coach's system is a PLAYBOOK the watched-game engine runs (W3-DESIGN item
// 3): which forecheck, which D-zone coverage, which breakouts (weighted, so a
// team still varies), how it regroups in the neutral zone, how it enters, and
// how hard its net-front man takes the goalie's eyes. The team's own tactics
// (the GM's choices, or the coach's own adaptation of them) override the
// system where they are set (owner-approved, W3-DESIGN §5 decision 4).

/** Forecheck: two deep (2-1-2), one deep and two at the hash marks (1-2-2), the neutral-zone trap (1-3-1), or one man and four back (1-4). */
export type ForecheckPlan = '1-2-2' | '2-1-2' | '1-3-1' | '1-4'
/** D-zone coverage: zone (box +1), man-to-man, or the collapse (the shell: five men in the house). */
export type DZonePlan = 'zone' | 'man' | 'collapse'
/** Breakouts: the strong-side winger up the wall, the D-to-D reverse behind the net, the D wheeling the net, the stretch pass, the rim off the boards. */
export type BreakoutPlan = 'up' | 'reverse' | 'wheel' | 'stretch' | 'rim'
/** Neutral-zone regroup: back through the D and attack with speed, hit a stretch man, or dump it in and change. */
export type RegroupPlan = 'controlled' | 'stretch' | 'dumpChange'
export type EntryPlan = 'carry' | 'dump' | 'mixed'
/** W3 S8, the power-play entry: the drop pass to a man coming with speed, the carry over the line, or dump it into the corner and retrieve. */
export type PpEntryPlan = 'drop' | 'carry' | 'dump'
export const PP_ENTRY_PLANS: readonly PpEntryPlan[] = ['drop', 'carry', 'dump']
/** W3 S8, the penalty-kill shape in the zone (the 'aggressive' formation is the box with the pressure up). */
export type PkShapePlan = 'box' | 'diamond'

export const BREAKOUT_PLANS: readonly BreakoutPlan[] = ['up', 'reverse', 'wheel', 'stretch', 'rim']

export interface Playbook {
  /** The coach's system it came from (null: read off the tactics alone). */
  system: CoachSystemId | null
  forecheck: ForecheckPlan
  dZone: DZonePlan
  /** Relative weights: the breakout a possession runs is drawn from these. */
  breakout: Readonly<Record<BreakoutPlan, number>>
  regroup: RegroupPlan
  entry: EntryPlan
  /** 0..1: how far the strong-side D pinches down the wall on the forecheck. */
  pinch: number
  /** 0..1: how hard the net-front man screens a point shot. */
  screen: number
  /** The plays the team's tactics set over the system's own (forecheck, dZone, breakout, regroup, entry). */
  overrides: readonly string[]
  /** W3 S8: the power-play set-up in their zone (the team's special-teams tactics: the coach writes them, the GM may change them). */
  pp: PowerPlayFormation
  /** W3 S8: relative weights of the power-play entries (drawn once per power-play rush up the ice). */
  ppEntry: Readonly<Record<PpEntryPlan, number>>
  /** W3 S8: the penalty-kill shape in our zone. */
  pk: PkShapePlan
  /** W3 S8: 0..1, how hard the kill pressures the puck (≥ PK_PRESSURE_AGGRESSIVE reads as the aggressive kill). */
  pkPressure: number
}

/** W3 S8: a kill at or above this pressure is the aggressive (pressure) kill; below it, the passive one. */
export const PK_PRESSURE_AGGRESSIVE = 0.6

const PE = (drop: number, carry: number, dump: number): Record<PpEntryPlan, number> => ({ drop, carry, dump })
/**
 * W3 S8: each system's power-play entries and how hard it kills (our own
 * reading of the standard identities; the numbers are design, not measured).
 * The PP set-up and the kill's shape come from the team's special-teams
 * tactics (SYSTEM_PP / SYSTEM_PK write them from the system).
 */
export const SYSTEM_SPECIAL: Record<CoachSystemId, { ppEntry: Record<PpEntryPlan, number>; pkPressure: number }> = {
  lowEventTrap: { ppEntry: PE(0.3, 0.2, 0.5), pkPressure: 0.3 },
  aggressiveForecheck: { ppEntry: PE(0.2, 0.2, 0.6), pkPressure: 0.85 },
  speedTransition: { ppEntry: PE(0.5, 0.4, 0.1), pkPressure: 0.5 },
  cyclePossession: { ppEntry: PE(0.4, 0.2, 0.4), pkPressure: 0.45 },
  structuredTwoWay: { ppEntry: PE(0.45, 0.3, 0.25), pkPressure: 0.4 },
  runAndGun: { ppEntry: PE(0.5, 0.4, 0.1), pkPressure: 0.8 },
  defensiveShell: { ppEntry: PE(0.3, 0.2, 0.5), pkPressure: 0.15 },
}

const BO = (up: number, reverse: number, wheel: number, stretch: number, rim: number): Record<BreakoutPlan, number> => ({ up, reverse, wheel, stretch, rim })

/** Each system's playbook (our own reading of the standard NHL identities; the numbers are design, not measured). */
export const SYSTEM_PLAYBOOK: Record<CoachSystemId, Omit<Playbook, 'system' | 'overrides' | 'pp' | 'ppEntry' | 'pk' | 'pkPressure'>> = {
  lowEventTrap: { forecheck: '1-3-1', dZone: 'zone', breakout: BO(0.3, 0.5, 0.2, 0, 0), regroup: 'controlled', entry: 'dump', pinch: 0.15, screen: 0.4 },
  aggressiveForecheck: { forecheck: '2-1-2', dZone: 'man', breakout: BO(0.6, 0, 0, 0, 0.4), regroup: 'dumpChange', entry: 'dump', pinch: 0.8, screen: 0.7 },
  speedTransition: { forecheck: '1-2-2', dZone: 'zone', breakout: BO(0.3, 0, 0.2, 0.5, 0), regroup: 'stretch', entry: 'carry', pinch: 0.4, screen: 0.5 },
  cyclePossession: { forecheck: '2-1-2', dZone: 'zone', breakout: BO(0.3, 0.4, 0.3, 0, 0), regroup: 'controlled', entry: 'carry', pinch: 0.5, screen: 0.8 },
  structuredTwoWay: { forecheck: '1-2-2', dZone: 'zone', breakout: BO(0.5, 0.3, 0.2, 0, 0), regroup: 'controlled', entry: 'mixed', pinch: 0.35, screen: 0.5 },
  runAndGun: { forecheck: '2-1-2', dZone: 'man', breakout: BO(0.4, 0, 0, 0.6, 0), regroup: 'stretch', entry: 'carry', pinch: 0.9, screen: 0.5 },
  defensiveShell: { forecheck: '1-4', dZone: 'collapse', breakout: BO(0.4, 0, 0, 0, 0.6), regroup: 'dumpChange', entry: 'dump', pinch: 0.05, screen: 0.3 },
}

const FORECHECK_PLAN: Record<ForecheckSystem, ForecheckPlan> = { '1-2-2': '1-2-2', '2-1-2': '2-1-2', trap: '1-3-1' }

/**
 * The playbook a team runs tonight: its coach's system, with the team's own
 * tactics on top wherever they are set. The forecheck and the man/zone choice
 * always come from the tactics (the coach writes them from his system and the
 * GM can change them; the system only adds its flavour: the trap a shell sits
 * back in becomes a 1-4, its zone coverage the collapse). Breakout, regroup,
 * entry and D-zone structure override the system only when the tactics carry
 * them. Pure; the agent engine reads it.
 */
export function playbookFor(system: CoachSystemId | string | null | undefined, tactics: TeamTactics): Playbook {
  const sys = system && system in SYSTEM_PLAYBOOK ? (system as CoachSystemId) : null
  const base = sys ? SYSTEM_PLAYBOOK[sys] : null
  const overrides: string[] = []
  let forecheck: ForecheckPlan = FORECHECK_PLAN[tactics.forecheck] ?? '1-2-2'
  if (sys && base && tactics.forecheck === SYSTEM_FORECHECK[sys]) forecheck = base.forecheck
  else if (sys) overrides.push('forecheck')
  let dZone: DZonePlan = tactics.dZoneCoverage === 'man' ? 'man' : base?.dZone === 'collapse' ? 'collapse' : 'zone'
  if (base && dZone !== base.dZone) overrides.push('dZone')
  if (tactics.dZoneStructure) {
    dZone = tactics.dZoneStructure === 'collapse' ? 'collapse' : tactics.dZoneStructure === 'aggressive' ? 'man' : 'zone'
    overrides.push('dZone')
  }
  let breakout: Record<BreakoutPlan, number> = { ...(base?.breakout ?? BO(0.5, 0.3, 0.2, 0, 0)) }
  if (tactics.breakout) {
    breakout = BO(0, 0, 0, 0, 0)
    breakout[tactics.breakout === 'rim' ? 'rim' : tactics.breakout === 'reverse' ? 'reverse' : 'wheel'] = 1
    overrides.push('breakout')
  }
  let regroup: RegroupPlan = base?.regroup ?? 'controlled'
  if (tactics.nzOffensive) {
    regroup = tactics.nzOffensive === 'stretch' ? 'stretch' : 'controlled'
    overrides.push('regroup')
  }
  let entry: EntryPlan = base?.entry ?? 'mixed'
  if (tactics.ozEntry) {
    entry = tactics.ozEntry
    overrides.push('entry')
  }
  // the pinch also reads the risk slider (profileToTactics writes it from riskTolerance)
  const pinch = clamp01(((base?.pinch ?? 0.35) + tactics.tempo.defensivePinch) / 2)
  // W3 S8: special teams. The set-up and the kill's shape are the tactics'
  // (the coach writes them from his system, the GM may change them); the
  // 'aggressive' formation is the box with the pressure up, and a box or a
  // diamond the GM picked over a pressure system's kills passively.
  const st = tactics.specialTeams ?? { powerPlay: 'umbrella', penaltyKill: 'box' }
  const special = sys ? SYSTEM_SPECIAL[sys] : null
  const pk: PkShapePlan = st.penaltyKill === 'diamond' ? 'diamond' : 'box'
  const basePress = special?.pkPressure ?? 0.4
  const pkPressure = st.penaltyKill === 'aggressive' ? Math.max(basePress, 0.8) : Math.min(basePress, PK_PRESSURE_AGGRESSIVE - 0.1)
  if (sys && st.powerPlay !== SYSTEM_PP[sys]) overrides.push('pp')
  if (sys && st.penaltyKill !== SYSTEM_PK[sys]) overrides.push('pk')
  return { system: sys, forecheck, dZone, breakout, regroup, entry, pinch, screen: base?.screen ?? 0.5, overrides: [...new Set(overrides)], pp: st.powerPlay, ppEntry: { ...(special?.ppEntry ?? PE(0.4, 0.3, 0.3)) }, pk, pkPressure }
}

/** The tactics a system's own playbook reads back unchanged (tests, dev scenarios): its forecheck and its man / zone choice. */
export function tacticsForSystem(system: CoachSystemId, base: TeamTactics): TeamTactics {
  return { ...base, forecheck: SYSTEM_FORECHECK[system], dZoneCoverage: SYSTEM_PLAYBOOK[system].dZone === 'man' ? 'man' : 'zone', specialTeams: { powerPlay: SYSTEM_PP[system], penaltyKill: SYSTEM_PK[system] } }
}

/**
 * The playbook a coach's profile runs with the tactics his system writes (no
 * GM changes). With a roster, the roster adaptation profileToTactics makes (a
 * 1-2-2 a slow team cannot skate becomes a 2-1-2) is included.
 */
export function systemPlaybook(profile: CoachProfile, roster?: Player[]): Playbook {
  const t: TeamTactics = roster
    ? profileToTactics(profile, roster, NEUTRAL_TACTICS)
    : {
        ...NEUTRAL_TACTICS,
        forecheck: SYSTEM_FORECHECK[profile.system],
        dZoneCoverage: dZoneFromStructure(profile.structure),
        tempo: { ...NEUTRAL_TACTICS.tempo, defensivePinch: knob(profile.riskTolerance, OFFENCE_GAIN) },
        specialTeams: { powerPlay: SYSTEM_PP[profile.system], penaltyKill: SYSTEM_PK[profile.system] },
      }
  return playbookFor(profile.system, t)
}
