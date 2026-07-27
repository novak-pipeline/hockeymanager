/**
 * Competitive balance — does a simmed season look like a real league?
 *
 * This is the test that catches the failure mode where the sim is individually
 * "correct" everywhere and still produces a world nobody would believe: the
 * generator used to stack talent hard enough that the best team finished 54-4
 * with a +250 goal differential, which distorts standings, playoff races,
 * awards and every counting stat downstream.
 *
 * The bands below are NHL reality, widened enough to absorb seed noise:
 *   best team   110-125 pts, goal differential  +60 .. +110
 *   worst team   55-70  pts, goal differential  -90 .. -135
 * (The real bottom does reach the mid-40s — 2023-24 San Jose finished 47 —
 * so the lower bound is deliberately permissive.)
 *
 * Everything is measured as a mean across seeds and scaled to an 82-game
 * season, so this stays stable while remaining sensitive to a real regression.
 * The dial is TEAM_CALIBER_SPREAD in `src/data/generate.ts`.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { CALIBRATION_TARGETS } from '@calibrate/index'
import { simSeason, sortStandings } from './season'

const SEEDS = [2026, 7, 99, 314, 1848]

interface Measured {
  bestPoints: number
  worstPoints: number
  bestGd: number
  worstGd: number
  goalsPerTeamPerGame: number
}

function measure(): Measured {
  const acc: Measured = {
    bestPoints: 0, worstPoints: 0, bestGd: 0, worstGd: 0, goalsPerTeamPerGame: 0,
  }
  for (const seed of SEEDS) {
    const data = generateLeague({ seed })
    const table = sortStandings([...simSeason(data, seed).standings.values()])
    const gp = table[0].gamesPlayed
    const per82 = 82 / gp
    const top = table[0]
    const bottom = table[table.length - 1]
    acc.bestPoints += top.points * per82
    acc.worstPoints += bottom.points * per82
    acc.bestGd += (top.goalsFor - top.goalsAgainst) * per82
    acc.worstGd += (bottom.goalsFor - bottom.goalsAgainst) * per82
    acc.goalsPerTeamPerGame += table.reduce((a, t) => a + t.goalsFor, 0) / (table.length * gp)
  }
  const n = SEEDS.length
  return {
    bestPoints: acc.bestPoints / n,
    worstPoints: acc.worstPoints / n,
    bestGd: acc.bestGd / n,
    worstGd: acc.worstGd / n,
    goalsPerTeamPerGame: acc.goalsPerTeamPerGame / n,
  }
}

describe('competitive balance', () => {
  const m = measure()

  it('does not produce a runaway best team', () => {
    expect(m.bestPoints).toBeGreaterThan(105)
    expect(m.bestPoints).toBeLessThan(130)
    expect(m.bestGd).toBeGreaterThan(55)
    expect(m.bestGd).toBeLessThan(135)
  })

  it('does not produce a hopeless worst team', () => {
    expect(m.worstPoints).toBeGreaterThan(45)
    expect(m.worstPoints).toBeLessThan(72)
    expect(m.worstGd).toBeLessThan(-60)
    expect(m.worstGd).toBeGreaterThan(-150)
  })

  it('holds league scoring at the NHL rate while the spread is realistic', () => {
    // Balance and scoring level are separable failures — a league can have the
    // right spread around the wrong mean. Pin both.
    const target = CALIBRATION_TARGETS.perTeamPerGame.goals
    expect(m.goalsPerTeamPerGame).toBeGreaterThan(target * 0.9)
    expect(m.goalsPerTeamPerGame).toBeLessThan(target * 1.1)
  })
})
