import { describe, expect, it } from 'vitest'
import type { Player } from '@domain'
import { generateLeague } from '@data'
import { buildPlayerComp } from './playerComp'

function pool(seed: number): Player[] {
  return [...generateLeague({ seed }).players.values()]
}

describe('buildPlayerComp', () => {
  it('is gated by scouting knowledge', () => {
    const players = pool(1)
    const prospect = players.find((p) => p.position !== 'G')!
    expect(buildPlayerComp({ prospect, pool: players, knowledge: 40 })).toBeNull()
  })

  it('produces a "Shades of" comp from established DB players', () => {
    const players = pool(2)
    const prospect = players.find((p) => p.position !== 'G')!
    const comp = buildPlayerComp({ prospect, pool: players, knowledge: 100 })
    expect(comp).not.toBeNull()
    expect(comp!.names.length).toBeGreaterThanOrEqual(1)
    expect(comp!.names).not.toContain(prospect.name)
    expect(comp!.summary.startsWith('Shades of')).toBe(true)
  })

  it('is deterministic for the same inputs', () => {
    const players = pool(3)
    const prospect = players.find((p) => p.position !== 'G')!
    const a = buildPlayerComp({ prospect, pool: players, knowledge: 100 })
    const b = buildPlayerComp({ prospect, pool: players, knowledge: 100 })
    expect(a).toEqual(b)
  })

  it('comps a goalie against goalies only', () => {
    const players = pool(4)
    const g = players.find((p) => p.position === 'G')!
    const comp = buildPlayerComp({ prospect: g, pool: players, knowledge: 100 })
    if (comp) {
      for (const name of comp.names) {
        const c = players.find((p) => p.name === name)!
        expect(c.position).toBe('G')
      }
    }
  })
})
