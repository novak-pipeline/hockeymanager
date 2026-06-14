import { describe, expect, it } from 'vitest'
import type { Player } from '@domain'
import { generateLeague } from '@data'
import { buildPlayerComp, isPrePrime } from './playerComp'

function pool(seed: number): Player[] {
  return [...generateLeague({ seed }).players.values()]
}

/** A young, pre-prime skater suitable for comping. */
function prospectFrom(players: Player[]): Player {
  return players.find((p) => p.position !== 'G' && isPrePrime(p)) ?? players[0]!
}

describe('isPrePrime', () => {
  it('treats young players as pre-prime', () => {
    const p = { age: 19, composites: {}, ratings: { mental: {} } } as unknown as Player
    expect(isPrePrime(p)).toBe(true)
  })
})

describe('buildPlayerComp', () => {
  it('is gated by scouting knowledge', () => {
    const players = pool(1)
    const prospect = prospectFrom(players)
    expect(buildPlayerComp({ prospect, pool: players, knowledge: 40 })).toBeNull()
  })

  it('produces a "Shades of" comp from established DB players', () => {
    const players = pool(2)
    const prospect = prospectFrom(players)
    const comp = buildPlayerComp({ prospect, pool: players, knowledge: 100 })
    expect(comp).not.toBeNull()
    expect(comp!.names.length).toBeGreaterThanOrEqual(1)
    expect(comp!.names).not.toContain(prospect.name)
    expect(comp!.summary.startsWith('Shades of')).toBe(true)
  })

  it('drops the comp once a player has hit his prime', () => {
    const players = pool(2)
    // An established prime player (age 25+ at/near ceiling) → no comp.
    const prime = players.find((p) => p.position !== 'G' && !isPrePrime(p))
    if (prime) {
      expect(buildPlayerComp({ prospect: prime, pool: players, knowledge: 100 })).toBeNull()
    }
  })

  it('is deterministic for the same inputs', () => {
    const players = pool(3)
    const prospect = prospectFrom(players)
    const a = buildPlayerComp({ prospect, pool: players, knowledge: 100 })
    const b = buildPlayerComp({ prospect, pool: players, knowledge: 100 })
    expect(a).toEqual(b)
  })
})
