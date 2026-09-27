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
  /** Day counter within the June re-signing window (offers are answered over
   *  days, offer sheets run a live match clock). Optional so saves written
   *  before the window existed load as day 0. */
  resignDay?: number
  /** PHASE 0: which dated beat of the awards stage we are on (0/absent = not
   *  yet run; 1 lottery, 2 combine, 3 awards night). Optional for saves. */
  summerBeat?: number
  /** Offseason 3.0: the free-agent class as it stood at the market's open,
   *  richest ask first. A man's place in it sets his decision day (the top of
   *  the class goes on July 1 — the frenzy), stable as the pool thins.
   *  Optional: absent on older saves (the ask-based day is the fallback). */
  faClassOrder?: string[]
  /** Offseason 3.0: the July wire — every free-agent signing this summer, in
   *  order, with how many clubs bid and the reason he gave. Optional. */
  faWire?: FaWireEntry[]
}

export interface FaWireEntry {
  day: number
  playerId: string
  name: string
  position: string
  teamId: string
  teamAbbr: string
  salary: number
  years: number
  suitors?: number
  reason?: string
  /** True when he signed with the GM's club. */
  yours?: boolean
}
