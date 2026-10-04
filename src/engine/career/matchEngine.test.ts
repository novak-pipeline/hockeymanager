import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from './career'

// W2 (docs/gameplan-2026-09-28): the user's games always play on the agent engine.
describe('watched-game engine', () => {
  it("plays the user's games on the agent engine", () => {
    const data = generateLeague({ seed: 91 })
    const career = new Career(data, 91, data.league.teams[0]!)
    const gp = (): number => career.getStandings().overall.find((r) => r.teamId === (data.league.teams[0] as string))?.gamesPlayed ?? 0
    let game = null
    for (let i = 0; i < 40 && !game; i++) {
      game = career.watchNext()
      if (!game) career.step()
    }
    expect(gp()).toBeGreaterThan(0)
    // agent-engine fingerprints: additive fields only it emits
    expect(game!.stream.some((e) => e.type === 'missedShot' || (e.type === 'lineChange' && e.onTheFly !== undefined))).toBe(true)
  })
})
