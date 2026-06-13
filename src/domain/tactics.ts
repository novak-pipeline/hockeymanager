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
 * These are SETABLE INTENT — they are stored and displayed but only a subset
 * is wired into the engine (clearly marked below). The rest influence future
 * sim depth without changing current calibrated output.
 */
export interface PersonalTactics {
  /** Bias toward shooting more / passing more (−1 = pass more, 0 = default, +1 = shoot more). */
  shootVsPass?: -1 | 0 | 1
  /** Whether this player engages in fights. */
  fighting?: 'will-fight' | 'avoid' | 'default'
  /**
   * Carry the puck or dump it in on zone entries.
   * ENGINE-WIRED: shifts entry carry/dump split for this player.
   */
  entryStyle?: 'carry' | 'dump' | 'default'
  /**
   * Whether this player joins the rush or holds back.
   * ENGINE-WIRED: affects rush-join probability in counter-attacks.
   */
  rushJoin?: 'join' | 'sit-back' | 'default'
  /** Shadow a specific opponent — playerId of the target. */
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
   * Mentality: how aggressively the team pushes offense vs. sits back.
   * 0 = very defensive, 0.5 = balanced (DEFAULT), 1 = all-out attack.
   * Setable intent only — influences future coaching/style systems.
   */
  mentality?: number

  /**
   * Aggressiveness: physical play intensity.
   * 0 = disciplined, 0.5 = balanced (DEFAULT), 1 = very physical.
   * ENGINE-WIRED at default 0.5 → multiplier 1.0 on HIT_P and PENALTY_P.
   */
  aggressiveness?: number

  /**
   * Backchecking: how hard forwards skate back defensively.
   * 0 = float, 0.5 = normal (DEFAULT), 1 = hard back.
   * Setable intent — influences defensive formation depth in future.
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
   * Tempo: overall pace of play at the team strategy level.
   * 0 = slow-it-down, 0.5 = normal (DEFAULT), 1 = up-tempo.
   * Setable intent (fine-grained tempo already in TempoSettings.pace).
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

  // ── Positional systems (setable intent, displayed in UI) ──

  /** Breakout system. Default: 'wheel'. */
  breakout?: BreakoutSystem

  /** Neutral-zone offensive system. Default: 'controlled'. */
  nzOffensive?: NzOffensiveSystem

  /** Neutral-zone defensive system. Default: 'standard'. */
  nzDefensive?: NzDefensiveSystem

  /** Zone-entry preference. Default: 'mixed'. */
  ozEntry?: OzEntry

  /** Forecheck variant (maps to existing ForecheckSystem but with EHM labels). */
  forecheckVariant?: ForecheckVariant

  /** Defensive-zone structure. Default: 'contain'. */
  dZoneStructure?: DZoneStructure

  /** Offensive-zone faceoff play. Default: 'standard'. */
  offensiveFaceoff?: FaceoffPlay

  /** Defensive-zone faceoff play. Default: 'standard'. */
  defensiveFaceoff?: FaceoffPlay

  /** Shot targeting. Default: 'mixed'. */
  shotTargeting?: ShotTargeting

  /**
   * Per-player personal tactics. Keys are playerIds.
   * Absent player = no personal instruction (use team defaults).
   */
  personalTactics?: Record<string, PersonalTactics>
}
