/**
 * National-team selection (#48). Picks a nation's best available roster from its
 * player pool, position-balanced like a real international squad (14 F / 7 D /
 * 2 G = 23). Used for both the senior team and the U20 (World Juniors) team —
 * the U20 caller just passes maxAge: 19.
 *
 * Pure given its inputs. Selection is purely merit-based (best current ability
 * per position); chemistry/coach preference can layer on later.
 */
import type { Player } from '@domain'
import { ratedOverall } from '@engine/ratings/composites'

export interface NationalTeamPick {
  player: Player
  /** 'F' | 'D' | 'G' bucket the player was selected into. */
  slot: 'F' | 'D' | 'G'
}

export interface SelectNationalTeamOptions {
  /** Inclusive max age (U20 = 19). Omit for the senior team. */
  maxAge?: number
  forwards?: number
  defensemen?: number
  goalies?: number
}

/** Select a position-balanced national-team roster, best-available per slot. */
export function selectNationalTeam(pool: Player[], opts: SelectNationalTeamOptions = {}): NationalTeamPick[] {
  const nF = opts.forwards ?? 14
  const nD = opts.defensemen ?? 7
  const nG = opts.goalies ?? 2
  const eligible = opts.maxAge !== undefined ? pool.filter((p) => p.age <= opts.maxAge!) : pool

  const byRating = (a: Player, b: Player): number => ratedOverall(b) - ratedOverall(a)
  const fwd = eligible.filter((p) => p.position === 'C' || p.position === 'W').sort(byRating).slice(0, nF)
  const def = eligible.filter((p) => p.position === 'D').sort(byRating).slice(0, nD)
  const gol = eligible.filter((p) => p.position === 'G').sort(byRating).slice(0, nG)

  return [
    ...fwd.map((player): NationalTeamPick => ({ player, slot: 'F' })),
    ...def.map((player): NationalTeamPick => ({ player, slot: 'D' })),
    ...gol.map((player): NationalTeamPick => ({ player, slot: 'G' })),
  ]
}

/** Average current ability of a selected roster — a quick squad-strength gauge. */
export function rosterStrength(picks: NationalTeamPick[]): number {
  if (picks.length === 0) return 0
  return Math.round(picks.reduce((s, p) => s + ratedOverall(p.player), 0) / picks.length)
}
