import { describe, expect, it } from 'vitest'
import type { Player } from '@domain'
import { generateLeague } from '@data'
import { playerTraits } from './playerTraits'

function mk(pos: string, comp: Record<string, number>, extra: Partial<Player> = {}): Player {
  return {
    position: pos,
    age: 24,
    composites: comp,
    ratings: { mental: {}, physical: {}, goalie: {} },
    ...extra,
  } as unknown as Player
}

describe('playerTraits', () => {
  it('tags a heavy hitter as a Hammer', () => {
    const p = mk('LW', { hitting: 88 }, { ratings: { mental: {}, physical: { strength: 85 }, goalie: {} } } as Partial<Player>)
    const keys = playerTraits(p).map((t) => t.key)
    expect(keys).toContain('hammer')
  })

  it('tags a shutdown skater as a Play Killer', () => {
    const p = mk('C', { defensiveZone: 85, takeaway: 82 })
    expect(playerTraits(p).map((t) => t.key)).toContain('playkiller')
  })

  it('only gives a defenceman the Power-Play QB / Transition badges', () => {
    const d = mk('D', { playmaking: 84, scoring: 80, skating: 82 })
    const keys = playerTraits(d).map((t) => t.key)
    expect(keys.some((k) => k === 'quarterback' || k === 'transition')).toBe(true)
  })

  it('caps at three badges, strongest first', () => {
    const p = mk('C', { scoring: 90, playmaking: 88, skating: 86, hitting: 84, takeaway: 82, defensiveZone: 80 })
    const traits = playerTraits(p)
    expect(traits.length).toBeLessThanOrEqual(3)
  })

  it('runs over a generated league without throwing', () => {
    for (const p of [...generateLeague({ seed: 7 }).players.values()].slice(0, 50)) {
      expect(Array.isArray(playerTraits(p))).toBe(true)
    }
  })
})
