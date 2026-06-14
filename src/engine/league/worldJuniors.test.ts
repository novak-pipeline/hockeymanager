import { describe, expect, it } from 'vitest'
import type { PlayerId } from '@domain'
import { generateLeague } from '@data'
import { Rng } from '@engine/shared/rng'
import { runWorldJuniors } from './worldJuniors'

/** Generated players, with nationalities + ages forced so multiple nations can
 *  ice U20 teams. */
function u20World(seed: number): ReturnType<typeof generateLeague> {
  const lg = generateLeague({ seed })
  const nats = ['Canada', 'Sweden', 'Finland', 'USA']
  const ids = lg.league.players
  ids.forEach((pid, i) => {
    const p = lg.players.get(pid)
    if (!p) return
    p.nationality = nats[i % nats.length]!
    if (i % 3 === 0) p.age = 18 // make a third of the pool U20
  })
  return lg
}

describe('runWorldJuniors', () => {
  it('produces a medal table from the U20 pools', () => {
    const lg = u20World(1)
    const res = runWorldJuniors({ players: lg.players, rng: new Rng(7) })
    expect(res.contested).toBeGreaterThan(0)
    expect(res.gold).toBeTruthy()
    // Standings are a permutation finishing 1..N.
    res.standings.forEach((s, i) => expect(s.finish).toBe(i + 1))
    expect(res.standings[0]!.nation).toBe(res.gold)
  })

  it('names an all-tournament team of U20 standouts', () => {
    const lg = u20World(2)
    const res = runWorldJuniors({ players: lg.players, rng: new Rng(7), teamAbbrOf: () => 'TST' })
    expect(res.allStars.length).toBeGreaterThan(0)
    expect(res.allStars.length).toBeLessThanOrEqual(6)
    expect(res.allStars[0]!.teamAbbr).toBe('TST')
    // Best-first by stars.
    for (let i = 1; i < res.allStars.length; i++) {
      expect(res.allStars[i - 1]!.stars).toBeGreaterThanOrEqual(res.allStars[i]!.stars)
    }
  })

  it('is deterministic for the same seed', () => {
    const a = u20World(3)
    const b = u20World(3)
    const ra = runWorldJuniors({ players: a.players, rng: new Rng(9) })
    const rb = runWorldJuniors({ players: b.players, rng: new Rng(9) })
    expect(ra.standings.map((s) => s.nation)).toEqual(rb.standings.map((s) => s.nation))
  })

  it('returns an empty result when no nation can ice a U20 team', () => {
    const lg = generateLeague({ seed: 4 }) // no nationalities set
    const res = runWorldJuniors({ players: lg.players, rng: new Rng(1) })
    expect(res.contested).toBe(0)
    expect(res.gold).toBeNull()
  })
})
