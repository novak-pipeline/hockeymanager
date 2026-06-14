/**
 * Player progress rows — how a player's ability and ceiling have moved this
 * season. Powers the player-profile "Progress" tab's roll-ups: a U23 view in the
 * Development Center and a whole-team view in the Squad Planner.
 *
 * Pure + deterministic. Season-to-date change comes from the development
 * accumulators (seasonDevAccrued / seasonCeilDrift); the arrow direction from
 * the recent-trend fields (devTrend / ceilingTrend).
 */
import type { Player } from '@domain'
import { agedPotential, ratedOverall } from '@engine/ratings/composites'

export type ProgressTrend = 'up' | 'down' | 'steady'

export interface ProgressRowView {
  playerId: string
  name: string
  position: string
  age: number
  /** Current ability, 0–100. */
  overall: number
  /** Projected ceiling, 0–100. */
  potential: number
  /** Season-to-date ability change (signed, rounded). */
  overallDelta: number
  /** Season-to-date ceiling change (signed, rounded). */
  potentialDelta: number
  overallTrend: ProgressTrend
  potentialTrend: ProgressTrend
  faceId?: number
}

function trend(delta: number | undefined): ProgressTrend {
  if (delta === undefined) return 'steady'
  if (delta >= 1) return 'up'
  if (delta <= -1) return 'down'
  return 'steady'
}

/** Build a progress row for one player. */
export function progressRow(p: Player): ProgressRowView {
  return {
    playerId: p.id as unknown as string,
    name: p.name,
    position: p.position,
    age: p.age,
    overall: Math.round(ratedOverall(p)),
    potential: Math.round(agedPotential(p)),
    overallDelta: Math.round(p.seasonDevAccrued ?? p.devTrend ?? 0),
    potentialDelta: Math.round(p.seasonCeilDrift ?? p.ceilingTrend ?? 0),
    overallTrend: trend(p.devTrend),
    potentialTrend: trend(p.ceilingTrend),
    ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
  }
}

/**
 * Build progress rows for a set of players, biggest movers first (risers atop,
 * sliders at the bottom), then by ability.
 */
export function buildProgressRows(players: Player[]): ProgressRowView[] {
  return players
    .map(progressRow)
    .sort((a, b) => b.overallDelta - a.overallDelta || b.overall - a.overall)
}
