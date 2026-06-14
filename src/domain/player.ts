import type { PlayerId } from './ids'
import type { RawAttributes, CompositeRatings } from './ratings'
import type { PlayerRole } from './tactics'

export type Position = 'C' | 'W' | 'D' | 'G'
export type Handedness = 'L' | 'R'

/** FM-style personality; drives development, morale, and locker-room effects. */
export interface Personality {
  ambition: number
  professionalism: number
  loyalty: number
  temperament: number
  determination: number
}

export interface Contract {
  salary: number
  yearsRemaining: number
  expiryYear: number
  noTradeClause: boolean
  twoWay: boolean
}

export type InjuryKind = 'upperBody' | 'lowerBody' | 'concussion' | 'illness'

export interface Injury {
  kind: InjuryKind
  gamesRemaining: number
  description: string
}

/** Per-situation splits so PP/PK production is tracked separately from ev. */
export interface SituationStats {
  goals: number
  assists: number
  shots: number
  timeOnIce: number
}

export interface SeasonStats {
  season: number
  teamId: string
  gamesPlayed: number
  ev: SituationStats
  pp: SituationStats
  pk: SituationStats
  plusMinus: number
  penaltyMinutes: number
  /** Goalie-only fields are left at 0 for skaters. */
  saves: number
  shotsAgainst: number
  goalsAgainst: number
  shutouts: number
}

export interface Player {
  id: PlayerId
  name: string
  age: number
  position: Position
  handedness: Handedness
  role: PlayerRole
  /** Current ability. */
  ratings: RawAttributes
  /** Ceiling; drives development. */
  potential: RawAttributes
  /** Cached derived ratings the engine reads; recomputed when ratings change. */
  composites: CompositeRatings
  personality: Personality
  contract: Contract
  stats: SeasonStats[]
  /** 0–100, both intra-game and season-long. */
  fatigue: number
  morale: number
  injuryStatus: Injury | null
  /** Hot/cold streak modifier — the drama lever. */
  form: number
  /**
   * Mod-stable external key, e.g. "nhl-8478402". Set by mod loaders so
   * community roster packs can reference players by a stable identity that
   * survives name/rating changes. Never read by the sim engine.
   */
  externalId?: string
  /**
   * Facepack image key, e.g. "nhl-8478402". Resolved by the UI to
   * faces/<faceId>.png inside the active mod folder. Absent = show generated
   * silhouette.
   */
  faceId?: string
  /** Display-only bio fields, populated by mod loaders when the DB provides
   *  them. The sim engine never reads these. */
  nationality?: string
  birthplace?: string
  jerseyNumber?: number
  heightCm?: number
  weightKg?: number

  /**
   * Extended EHM-sourced attributes (1–99 each). Loaded by mods that supply
   * real-roster data; absent on fictional/generated players (sim uses fallbacks).
   *
   * Physical/style ratings:
   */
  /** Durability tendency; scales per-game injury chance. Absent = league average. */
  injuryProneness?: number
  /** Offseason fitness recovery rate; boosts fatigue recovery. Absent = normal. */
  naturalFitness?: number
  /** Physical strength in battles and puck protection. */
  fighting?: number
  /** Creative/unpredictable play tendency (nudges playmaking composites). */
  flair?: number
  /** Agitator/instigator tendency (nudges penalty minutes). */
  agitation?: number
  /** Skating mobility and positioning in motion. */
  movement?: number
  /** One-on-one effectiveness in tight spaces. */
  oneOnOnes?: number
  /** Positional flexibility across multiple roles. */
  versatility?: number
  /** Room leadership presence; used for captaincy/influence calculations. */
  leadership?: number
  /** Team-first cooperative tendency; feeds locker-room chemistry. */
  teamwork?: number

  /**
   * Personality-adjacent EHM attributes (1–20 scale, matching EHM's native
   * granularity). Distinct from the 1–99 gameplay attrs above.
   */
  /** Ability to adapt to new team/system quickly (1–20). */
  adaptability?: number
  /** Composure in high-stakes situations (1–20). */
  pressure?: number
  /** Fair-play and respect-for-opponents trait (1–20). */
  sportsmanship?: number

  /**
   * Career history counts. Populated by mod loaders; absent on fictional players.
   */
  /** Number of international appearances. */
  intlApps?: number
  /** International goals scored. */
  intlGoals?: number
  /** International assists. */
  intlAssists?: number
  /** Number of Stanley Cup championships. */
  stanleyCups?: number

  /**
   * Reputation ratings (0–200, stored as-is from the EHM DB).
   * Higher = more well-known in that geography.
   */
  homeReputation?: number
  currentReputation?: number
  worldReputation?: number

  /**
   * Draft status flags from the source DB.
   */
  /** Player is currently eligible for the NHL entry draft. */
  nhlDraftEligible?: boolean
  /** Player has already been drafted. */
  nhlDrafted?: boolean

  /** Preferred junior league / development pathway string from source DB. */
  juniorPreference?: string

  /**
   * Real season-by-season career history imported from the source DB. Newest
   * first. Absent on fictional players. Display-only — the sim never reads it.
   */
  careerHistory?: CareerSeasonRecord[]
}

/** One historical season row from the source DB (skater + goalie fields). */
export interface CareerSeasonRecord {
  year: number
  club: string
  league: string
  gamesPlayed: number
  goals: number
  assists: number
  penaltyMinutes: number
  plusMinus: number
  /** Goalie: minutes played. */
  minutes: number
  goalsAgainst: number
  shutouts: number
  wins: number
  losses: number
  otLosses: number
  saves: number
}
