/**
 * Quick-sim rate calibration — the counterpart to `full/calibration.test.ts`.
 *
 * The full engine has been held to the NHL-derived targets since it was built;
 * the quick-sim never was, and had drifted to 3.57 goals and 11.3 sh% per team
 * per game against targets of 3.07 and 10.2%. That matters more than it looks:
 * the quick-sim plays every background game, so the whole league's statistics
 * were inflated relative to the games the user actually watches, and the two
 * engines are supposed to be interchangeable.
 *
 * Tolerance is 10% — tighter than the full engine's 20%, because the quick-sim
 * has far fewer moving parts and averages over many more games here.
 */
import { describe, expect, it } from 'vitest'
import type { Player, PlayerId } from '@domain'
import { generateLeague } from '@data/generate'
import { CALIBRATION_TARGETS } from '@calibrate/index'
import { quickSimGame } from './quickSim'

describe('quick-sim calibration', () => {
  const data = generateLeague({ seed: 99 })
  const resolve = (id: PlayerId): Player => {
    const p = data.players.get(id)
    if (!p) throw new Error(`unknown player ${id}`)
    return p
  }
  const teams = data.league.teams
  const games = 400
  const counts: Record<string, number> = {}
  for (let i = 0; i < games; i++) {
    const home = data.teams.get(teams[i % teams.length])!
    const away = data.teams.get(teams[(i + 1) % teams.length])!
    for (const e of quickSimGame(home, away, resolve, { seed: 5000 + i }).stream) {
      counts[e.type] = (counts[e.type] ?? 0) + 1
    }
  }
  const per = (t: string): number => (counts[t] ?? 0) / (games * 2)

  const near = (got: number, target: number, tolerance = 0.1): void => {
    expect(got).toBeGreaterThan(target * (1 - tolerance))
    expect(got).toBeLessThan(target * (1 + tolerance))
  }

  it('scores at the NHL rate', () => {
    near(per('goal'), CALIBRATION_TARGETS.perTeamPerGame.goals)
  })

  it('shoots at the NHL rate', () => {
    near(per('shot'), CALIBRATION_TARGETS.perTeamPerGame.shotsOnGoal)
  })

  it('converts at the NHL shooting percentage', () => {
    near(per('goal') / per('shot'), CALIBRATION_TARGETS.shooting.shootingPct)
  })
})
