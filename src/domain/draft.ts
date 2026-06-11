import type { PlayerId, TeamId } from './ids'

/**
 * Draft-pick ownership and draft-day state. Picks are tradeable assets; the
 * pick's slot in the order is determined by `originalTeamId`'s finish, while
 * `ownerTeamId` makes the selection. Lives on the Career, JSON-safe for saves.
 */

export interface DraftPick {
  year: number
  /** 1-based round. */
  round: number
  /** Team whose standings position determines this pick's slot. */
  originalTeamId: TeamId
  /** Current owner (changes via trades). */
  ownerTeamId: TeamId
}

export interface DraftSelection {
  /** 1-based overall pick number. */
  overallPick: number
  teamId: TeamId
  playerId: PlayerId
}

export interface DraftState {
  year: number
  /** Full pick order across all rounds, worst regular-season finish first. */
  order: DraftPick[]
  /** Selections made so far; parallel prefix of `order`. */
  selections: DraftSelection[]
}

/** Offseason proceeds through these stages in order. */
export type OffseasonStage = 'awards' | 'draft' | 'resign' | 'freeAgency' | 'preseason'

export interface OffseasonState {
  /** The season year that just ended. */
  year: number
  stage: OffseasonStage
  /** Populated during the 'draft' stage. */
  draft: DraftState | null
  /** Day counter within the free-agency window (signings resolve day by day). */
  faDay: number
}
