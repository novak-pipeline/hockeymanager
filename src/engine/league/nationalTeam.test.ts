import { describe, expect, it } from 'vitest'
import type { Player } from '@domain'
import { generateLeague } from '@data'
import { selectNationalTeam, rosterStrength, nationInfo } from './nationalTeam'

describe('nationInfo', () => {
  it('returns profile fields for known nations and a blank for unknowns', () => {
    expect(nationInfo('Canada')).toEqual({ capital: 'Ottawa', continent: 'North America', languages: ['English', 'French'] })
    expect(nationInfo('Sweden').continent).toBe('Europe')
    expect(nationInfo('Atlantis')).toEqual({ capital: '', continent: '', languages: [] })
  })
})

/** A deep player pool (one "nation") drawn from a generated league. */
function pool(seed: number): Player[] {
  return [...generateLeague({ seed }).players.values()]
}

describe('selectNationalTeam', () => {
  it('selects a position-balanced 23-man roster (14F / 7D / 2G)', () => {
    const players = pool(1)
    const picks = selectNationalTeam(players)
    expect(picks.filter((p) => p.slot === 'F').length).toBe(14)
    expect(picks.filter((p) => p.slot === 'D').length).toBe(7)
    expect(picks.filter((p) => p.slot === 'G').length).toBe(2)
    expect(picks.length).toBe(23)
  })

  it('honours the U20 age cap', () => {
    const players = pool(2)
    const u20 = selectNationalTeam(players, { maxAge: 19 })
    for (const pick of u20) expect(pick.player.age).toBeLessThanOrEqual(19)
  })

  it('picks the best available — senior strength >= U20 strength', () => {
    const players = pool(3)
    const senior = selectNationalTeam(players)
    const u20 = selectNationalTeam(players, { maxAge: 19 })
    // Senior pool is unrestricted, so it can only be at least as strong.
    expect(rosterStrength(senior)).toBeGreaterThanOrEqual(rosterStrength(u20))
  })
})
