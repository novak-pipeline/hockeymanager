import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from './career'

// Settings → Match engine: the user's games can be played by the agent engine (beta).
describe('match engine preference', () => {
  it('defaults to classic and plays the user\'s games on the agent engine when chosen', () => {
    const data = generateLeague({ seed: 91 })
    const career = new Career(data, 91, data.league.teams[0]!)
    expect(career.getMatchEngine()).toBe('classic')
    career.setMatchEngine('agent')
    expect(career.getMatchEngine()).toBe('agent')
    // play until the user has a game on the books — it must complete on the agent engine
    const gp = (): number => career.getStandings().overall.find((r) => r.teamId === (data.league.teams[0] as string))?.gamesPlayed ?? 0
    for (let i = 0; i < 30 && gp() === 0; i++) career.step()
    expect(gp()).toBeGreaterThan(0)
  })
})
