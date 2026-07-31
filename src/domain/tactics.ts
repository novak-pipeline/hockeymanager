/**
 * Tactics (see docs/ARCHITECTURE.md §5). Configurable per team, per line, and
 * per player. Tactics feed the sim by modulating event probabilities and by
 * positioning players on the ice between events — they never decide outcomes
 * directly.
 */

export type ForecheckSystem = '1-2-2' | '2-1-2' | 'trap'
export type DefensiveZoneCoverage = 'man' | 'zone' | 'hybrid'
export type PowerPlayFormation = 'umbrella' | '1-3-1' | 'overload'
export type PenaltyKillFormation = 'box' | 'diamond' | 'aggressive'

/** EHM-style forecheck variants (setable intent; 1-2-2 / 2-1-2 already exist). */
export type ForecheckVariant = '1-2-2' | '3-2' | '1-4-trap'

/** EHM-style breakout system. */
export type BreakoutSystem = 'wheel' | 'rim' | 'reverse'

/** Neutral-zone offensive system. */
export type NzOffensiveSystem = 'stretch' | 'overload' | 'controlled'

/** Neutral-zone defensive system. */
export type NzDefensiveSystem = 'standard' | 'trap' | 'aggressive'

/** Offensive-zone entry preference. */
export type OzEntry = 'carry' | 'dump' | 'mixed'

/** Defensive-zone structure. */
export type DZoneStructure = 'collapse' | 'contain' | 'aggressive'

/** Faceoff play in the offensive or defensive zone. */
export type FaceoffPlay = 'standard' | 'wheel' | 'tie-up' | 'quick-strike'

/** Shot targeting — where shots are directed. */
export type ShotTargeting = 'corners' | 'high-glove' | 'blocker' | 'five-hole' | 'mixed'

/**
 * Player roles weight which composites the sim emphasizes and how the player
 * behaves positionally.
 */
export type PlayerRole =
  | 'sniper'
  | 'playmaker'
  | 'twoWay'
  | 'powerForward'
  | 'enforcer'
  | 'offensiveD'
  | 'shutdownD'
  | 'stayAtHomeD'
  | 'starter'
  | 'backup'

/** 0–1 sliders. */
export interface TempoSettings {
  pace: number
  passRisk: number
  shotEagerness: number
  defensivePinch: number
}

export interface SpecialTeamsTactics {
  powerPlay: PowerPlayFormation
  penaltyKill: PenaltyKillFormation
}

/**
 * Per-player personal tactics instructions (EHM Additional Options).
 * All optional; absent = no override (use team defaults).
 *
 * DEAD AS OF THE #154 LEVER AUDIT. No engine file reads `tactics.personalTactics`
 * — not one field of it, including the two below that a stale comment used to
 * label "ENGINE-WIRED". `leverStaticAudit.test.ts` proves this every run.
 *
 * The type is kept (saves and mods carry it) but MUST NOT be surfaced as a
 * control until it is wired and measured. Shipping a slider that does nothing is
 * the single failure that dragged our closest competitor to a Mixed rating.
 */
export interface PersonalTactics {
  /** DEAD — unread. Bias toward shooting more / passing more (−1 pass, +1 shoot). */
  shootVsPass?: -1 | 0 | 1
  /** DEAD — unread. Whether this player engages in fights. */
  fighting?: 'will-fight' | 'avoid' | 'default'
  /** DEAD — unread. Carry the puck or dump it in on zone entries. */
  entryStyle?: 'carry' | 'dump' | 'default'
  /** DEAD — unread. Whether this player joins the rush or holds back. */
  rushJoin?: 'join' | 'sit-back' | 'default'
  /** DEAD — unread. Shadow a specific opponent — playerId of the target. */
  shadowTarget?: string
}

export interface TeamTactics {
  forecheck: ForecheckSystem
  dZoneCoverage: DefensiveZoneCoverage
  tempo: TempoSettings
  specialTeams: SpecialTeamsTactics
  /** Match a specific forward line against the opponent's top line when able. */
  lineMatching: boolean

  // ── EHM-depth fields (all optional; defaults = today's effective behaviour) ──

  /**
   * DEAD (#154) — no engine file reads this. Mentality: how aggressively the
   * team pushes offense vs. sits back. 0 = very defensive, 0.5 = balanced,
   * 1 = all-out attack. Do not surface as a control until it is wired AND
   * measured by the lever harness.
   */
  mentality?: number

  /**
   * Aggressiveness: physical play intensity.
   * 0 = disciplined, 0.5 = balanced (DEFAULT), 1 = very physical.
   * ENGINE-WIRED at default 0.5 → multiplier 1.0 on HIT_P and PENALTY_P.
   */
  aggressiveness?: number

  /**
   * DEAD (#154) — no engine file reads this. Backchecking: how hard forwards
   * skate back defensively. 0 = float, 0.5 = normal, 1 = hard back.
   */
  backchecking?: number

  /**
   * Gap control: how tight defenders play the attacker in the neutral zone.
   * 0 = loose (let them in), 0.5 = standard (DEFAULT), 1 = tight.
   * ENGINE-WIRED: modulates carry-entry success at the blue line.
   */
  gapControl?: number

  /**
   * Puck pressure: how hard the team pressures in the opposing zone.
   * 0 = passive, 0.5 = standard (DEFAULT), 1 = swarming.
   * ENGINE-WIRED: multiplier on TAKEAWAY_P when pressuring.
   */
  puckPressure?: number

  /**
   * Hitting: propensity to deliver physical checks.
   * 0 = avoid contact, 0.5 = normal (DEFAULT), 1 = punishing.
   * ENGINE-WIRED: multiplier on HIT_P.
   */
  hitting?: number

  /**
   * DEAD (#154) — no engine file reads this. Overall pace of play at the team
   * strategy level. The engine's real pace lever is TempoSettings.pace.
   */
  tempoStyle?: number

  /**
   * Passing: preference for puck movement vs. individual play.
   * 0 = individual, 0.5 = balanced (DEFAULT), 1 = heavy puck movement.
   * ENGINE-WIRED: modulates passRisk multiplier.
   */
  passing?: number

  /**
   * Shooting: shoot-on-sight vs. look-for-the-pass.
   * 0 = patient, 0.5 = balanced (DEFAULT), 1 = shoot on sight.
   * ENGINE-WIRED: multiplier on shotEagerness in cycle beat.
   */
  shooting?: number

  /**
   * Dumping: how often to dump-and-chase vs. carry in.
   * 0 = always carry, 0.5 = mixed (DEFAULT), 1 = always dump.
   * ENGINE-WIRED: shifts carry/dump weight in sampleEntry.
   */
  dumping?: number

  // ── Positional systems — ALL DEAD (#154) ──
  //
  // The lever audit walked every field of this interface against the engine
  // sources. None of the nine below is read anywhere: they are labels a coach
  // profile writes and the staff-meeting screen displays, and they change no
  // outcome. `leverStaticAudit.test.ts` fails the build if that stops being
  // true in either direction, and docs/LEVER-AUDIT.md carries the reasoning.
  //
  // They are retained (saves, mods and the coach-profile display carry them)
  // but MUST NOT become GM-facing controls until they are wired and their real
  // effect is measured. See docs/LESSONS-ESPORTS-MANAGER.md for what happens to
  // a management game that ships decorative tactics.

  /** DEAD — unread. Breakout system. Default: 'wheel'. */
  breakout?: BreakoutSystem

  /** DEAD — unread. Neutral-zone offensive system. Default: 'controlled'. */
  nzOffensive?: NzOffensiveSystem

  /** DEAD — unread. Neutral-zone defensive system. Default: 'standard'. */
  nzDefensive?: NzDefensiveSystem

  /** DEAD — unread. Zone-entry preference. Default: 'mixed'. */
  ozEntry?: OzEntry

  /** DEAD — unread. Forecheck variant (EHM labels for ForecheckSystem). */
  forecheckVariant?: ForecheckVariant

  /** DEAD — unread. Defensive-zone structure. Default: 'contain'. */
  dZoneStructure?: DZoneStructure

  /** DEAD — unread. Offensive-zone faceoff play. Default: 'standard'. */
  offensiveFaceoff?: FaceoffPlay

  /** DEAD — unread. Defensive-zone faceoff play. Default: 'standard'. */
  defensiveFaceoff?: FaceoffPlay

  /** DEAD — unread. Shot targeting. Default: 'mixed'. */
  shotTargeting?: ShotTargeting

  /**
   * DEAD (#154) — unread by the engine. Per-player personal tactics, keyed by
   * playerId. See the PersonalTactics docstring above.
   */
  personalTactics?: Record<string, PersonalTactics>
}
