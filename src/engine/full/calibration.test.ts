/**
 * Calibration regression guard. The full engine's event rates are driven by
 * `@calibrate` targets derived from real NHL play-by-play; this test sims a
 * batch of games and asserts each event type lands near its NHL target, so a
 * future change to the engine that drifts the numbers off the data fails here.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { Player, PlayerId } from '@domain'
import { fullSimGame } from './fullSim'
import { CALIBRATION_TARGETS } from '@calibrate'

describe('full-sim calibration', () => {
  it('event rates track the NHL-derived targets', () => {
    const data = generateLeague({ seed: 99 })
    const resolve = (id: PlayerId): Player => {
      const p = data.players.get(id)
      if (!p) throw new Error(`unknown player ${id}`)
      return p
    }
    const teams = data.league.teams
    const counts: Record<string, number> = {}
    const games = 40
    for (let i = 0; i < games; i++) {
      const home = data.teams.get(teams[i % teams.length])!
      const away = data.teams.get(teams[(i + 1) % teams.length])!
      const out = fullSimGame(home, away, resolve, { seed: 5000 + i })
      for (const e of out.stream) counts[e.type] = (counts[e.type] ?? 0) + 1
    }
    const per = (t: string): number => (counts[t] ?? 0) / (games * 2)
    const R = CALIBRATION_TARGETS.perTeamPerGame

    // Measured per-team-per-game rates, printed so retuning has data to work
    // from (vitest shows this only on failure-ish verbose runs; cheap to keep).
    // eslint-disable-next-line no-console
    console.log(
      'full-sim rates/team/game:',
      ['goal', 'shot', 'blockedShot', 'hit', 'takeaway', 'giveaway', 'penalty', 'faceoff', 'pass']
        .map((t) => `${t}=${per(t).toFixed(2)}`)
        .join(' ')
    )

    // Each derived rate should land within 20% of the real-NHL target.
    const near = (got: number, target: number): void => {
      expect(got).toBeGreaterThan(target * 0.8)
      expect(got).toBeLessThan(target * 1.2)
    }
    near(per('goal'), R.goals)
    near(per('shot'), R.shotsOnGoal)
    near(per('blockedShot'), R.blockedShots)
    near(per('hit'), R.hits)
    near(per('takeaway'), R.takeaways)
    near(per('giveaway'), R.giveaways)
    near(per('penalty'), R.penalties)
  }, 240000)
})
