/**
 * AUDIT P2 (#155) — quick-sim / full-sim parity harness.
 *
 * A keystone architecture invariant (CLAUDE.md #2): the full per-tick engine
 * (watched games) and the fast quick-sim (the background league) share the
 * attribute model and must produce statistically comparable outcomes — a season
 * the GM watches must not feel like a different league from the one simulated
 * around him. This runs the SAME matchups through both engines and asserts their
 * aggregate outcome rates agree within tolerance, and that both land in a
 * plausible hockey band.
 *
 * Tolerances were set from a measured baseline (240 games each, seed 99):
 *   full : goals/game 7.07 · home-win 48.3% · OT+SO 17.5%
 *   quick: goals/game 6.95 · home-win 45.4% · OT+SO 13.8%
 * so they pass comfortably today while still catching a real divergence (a
 * future change that pushes one engine off the other trips this).
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { Player, PlayerId } from '@domain'
import { fullSimGame } from '../full/fullSim'
import { quickSimGame } from './quickSim'

interface Rates {
  goalsPerGame: number
  homeWinPct: number
  /** Share of games decided past regulation (OT or shootout). */
  nonRegPct: number
}

function measure(
  sim: (home: import('@domain').Team, away: import('@domain').Team, seed: number) => { homeGoals: number; awayGoals: number; decidedBy: string },
  data: ReturnType<typeof generateLeague>,
  games: number,
): Rates {
  const teams = data.league.teams
  let goals = 0, homeWins = 0, nonReg = 0
  for (let i = 0; i < games; i++) {
    const home = data.teams.get(teams[i % teams.length]!)!
    const away = data.teams.get(teams[(i + 1) % teams.length]!)!
    const out = sim(home, away, 9000 + i)
    goals += out.homeGoals + out.awayGoals
    if (out.homeGoals > out.awayGoals) homeWins++
    if (out.decidedBy !== 'regulation') nonReg++
  }
  return { goalsPerGame: goals / games, homeWinPct: homeWins / games, nonRegPct: nonReg / games }
}

describe('quick-sim / full-sim parity (#155)', () => {
  const data = generateLeague({ seed: 99 })
  const resolve = (id: PlayerId): Player => {
    const p = data.players.get(id)
    if (!p) throw new Error(`unknown player ${id}`)
    return p
  }
  const GAMES = 200
  const full = measure((h, a, s) => fullSimGame(h, a, resolve, { seed: s }), data, GAMES)
  const quick = measure((h, a, s) => quickSimGame(h, a, resolve, { seed: s }), data, GAMES)

  it('both engines land in a plausible hockey band', () => {
    for (const r of [full, quick]) {
      // Total goals per game (both teams): NHL ~6; our calibration runs a touch
      // higher. A wide-but-real band catches a blown calibration.
      expect(r.goalsPerGame).toBeGreaterThan(5.0)
      expect(r.goalsPerGame).toBeLessThan(9.0)
      // Home ice is a modest edge, never a coin-flip runaway either way.
      expect(r.homeWinPct).toBeGreaterThan(0.40)
      expect(r.homeWinPct).toBeLessThan(0.58)
      // Roughly a fifth of games go past regulation.
      expect(r.nonRegPct).toBeGreaterThan(0.06)
      expect(r.nonRegPct).toBeLessThan(0.30)
    }
  })

  it('the two engines agree on scoring within tolerance', () => {
    // Quick-sim goals/game within 12% of the full engine's.
    const ratio = quick.goalsPerGame / full.goalsPerGame
    expect(ratio).toBeGreaterThan(0.88)
    expect(ratio).toBeLessThan(1.12)
  })

  it('the two engines agree on result shape within tolerance', () => {
    // Home-win share and OT/SO share track each other (≤ 10 percentage points).
    expect(Math.abs(quick.homeWinPct - full.homeWinPct)).toBeLessThan(0.10)
    expect(Math.abs(quick.nonRegPct - full.nonRegPct)).toBeLessThan(0.10)
  })
})
