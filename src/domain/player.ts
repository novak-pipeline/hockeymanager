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
}
