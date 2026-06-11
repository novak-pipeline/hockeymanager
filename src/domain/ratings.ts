/**
 * Two-layer attribute model (see docs/ARCHITECTURE.md §3).
 *
 *  - RawAttributes are 0–100 scout-visible numbers, grouped FM-style.
 *  - CompositeRatings are derived from raw attributes + role and are the ONLY
 *    thing the sim engine reads. This indirection lets calibration re-tune the
 *    raw→composite formulas without touching the sim loop.
 */

/** 0–100. */
export type Rating = number

export interface TechnicalAttributes {
  wristShot: Rating
  slapShot: Rating
  stickhandling: Rating
  passing: Rating
  deflections: Rating
  faceoffs: Rating
}

export interface PhysicalAttributes {
  speed: Rating
  acceleration: Rating
  strength: Rating
  balance: Rating
  stamina: Rating
  agility: Rating
  height: Rating
}

export interface MentalAttributes {
  offensiveIQ: Rating
  defensiveIQ: Rating
  positioning: Rating
  vision: Rating
  aggression: Rating
  composure: Rating
  workRate: Rating
  discipline: Rating
  anticipation: Rating
}

export interface DefensiveAttributes {
  checking: Rating
  shotBlocking: Rating
  stickChecking: Rating
  takeaway: Rating
}

/** Only meaningful for goalies; absent on skaters. */
export interface GoalieAttributes {
  reflexes: Rating
  positioningG: Rating
  reboundControl: Rating
  glove: Rating
  blocker: Rating
  recovery: Rating
  puckHandlingG: Rating
}

export interface RawAttributes {
  technical: TechnicalAttributes
  physical: PhysicalAttributes
  mental: MentalAttributes
  defensive: DefensiveAttributes
  goalie?: GoalieAttributes
}

/**
 * Derived ratings the sim engine consumes. Computed by engine/ratings from
 * RawAttributes + the player's role. The engine never touches RawAttributes.
 */
export interface CompositeRatings {
  scoring: Rating
  playmaking: Rating
  puckControl: Rating
  faceoffWin: Rating
  hitting: Rating
  blocking: Rating
  takeaway: Rating
  penaltyProne: Rating
  goaltending: Rating
  skating: Rating
  defensiveZone: Rating
}
