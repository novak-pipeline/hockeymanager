import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from './career'

describe('searchAll (command palette)', () => {
  const data = generateLeague({ seed: 55 })
  const career = new Career(data, 55, data.league.teams[0])

  it('finds players by name substring, prefix matches first', () => {
    const anyPlayer = [...data.players.values()][0]!
    const q = anyPlayer.name.split(' ')[1]!.slice(0, 4)
    const res = career.searchAll(q)
    expect(res.players.length).toBeGreaterThan(0)
    expect(res.players.every((p) => p.name.toLowerCase().includes(q.toLowerCase()))).toBe(true)
    expect(res.players.length).toBeLessThanOrEqual(8)
  })

  it('finds teams by name or abbreviation', () => {
    const team = data.teams.get(data.league.teams[0])!
    const byAbbr = career.searchAll(team.abbreviation.toLowerCase())
    expect(byAbbr.teams.some((t) => t.teamId === (team.id as string))).toBe(true)
  })

  it('returns nothing for sub-2-char queries', () => {
    expect(career.searchAll('a')).toEqual({ players: [], teams: [] })
  })
})
