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
import type { Rng } from '@engine/shared/rng'

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
