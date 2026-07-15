import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { repairLines } from './lineup'

describe('repairLines — malformed/missing lines (imported data)', () => {
  it('does not throw when a team has no lines object, and rebuilds from the roster', () => {
    const data = generateLeague({ seed: 41 })
    const team = data.league.teams
      .map((id) => data.teams.get(id)!)
      .find((t) => t.roster.length >= 20)!
    // Simulate an imported team that never got a lines object.
    ;(team as { lines?: unknown }).lines = undefined
    expect(() => repairLines(team, data.players)).not.toThrow()
    // A legal structure was synthesised and filled: 4 forward lines, 3 pairs, a starter.
    expect(team.lines.forwards.length).toBe(4)
    expect(team.lines.defensePairs.length).toBe(3)
    const starter = team.lines.goalies[0]
    expect(starter && (starter as string).length > 0).toBe(true)
  })

  it('tolerates a lines object with broken arrays', () => {
    const data = generateLeague({ seed: 42 })
    const team = data.league.teams
      .map((id) => data.teams.get(id)!)
      .find((t) => t.roster.length >= 20)!
    ;(team as { lines: unknown }).lines = { forwards: null, defensePairs: undefined, goalies: null } as unknown as (typeof team)['lines']
    expect(() => repairLines(team, data.players)).not.toThrow()
    expect(team.lines.forwards.length).toBe(4)
    expect(Array.isArray(team.lines.goalies)).toBe(true)
  })
})

// Reference PlayerId so the import is used even if the assertions change.
export type _PidRef = PlayerId
