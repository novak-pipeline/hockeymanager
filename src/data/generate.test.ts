import { describe, expect, it } from 'vitest'
import { overall } from '@engine/ratings/composites'
import { generateLeague } from './generate'

describe('generateLeague', () => {
  it('is deterministic for a given seed', () => {
    const a = generateLeague({ seed: 1 })
    const b = generateLeague({ seed: 1 })
    expect(a.league.teams).toEqual(b.league.teams)
    const firstA = a.players.get(a.league.players[0])!
    const firstB = b.players.get(b.league.players[0])!
    expect(firstA.name).toEqual(firstB.name)
    expect(firstA.composites).toEqual(firstB.composites)
  })

  it('different seeds produce different leagues', () => {
    const a = generateLeague({ seed: 1 })
    const b = generateLeague({ seed: 2 })
    const nameA = a.players.get(a.league.players[0])!.name
    const nameB = b.players.get(b.league.players[0])!.name
    expect(nameA).not.toEqual(nameB)
  })

  it('builds the requested structure', () => {
    const { league, teams, players } = generateLeague({ seed: 7, teamCount: 16 })
    expect(league.teams).toHaveLength(16)
    expect(teams.size).toBe(16)
    expect(league.conferences).toHaveLength(2)
    expect(league.divisions).toHaveLength(4)
    // 16 teams × (14 F + 7 D + 2 G) = 368 players.
    expect(players.size).toBe(16 * 23)
    expect(league.players).toHaveLength(16 * 23)
  })

  it('assigns every team to a division, divisions evenly split', () => {
    const { league } = generateLeague({ seed: 3 })
    const assigned = league.divisions.flatMap((d) => d.teamIds)
    expect(assigned).toHaveLength(16)
    expect(new Set(assigned).size).toBe(16)
    for (const d of league.divisions) expect(d.teamIds).toHaveLength(4)
  })

  it('gives each team complete, valid lines', () => {
    const { league, teams, players } = generateLeague({ seed: 11 })
    for (const teamId of league.teams) {
      const team = teams.get(teamId)!
      expect(team.lines.forwards).toHaveLength(4)
      expect(team.lines.defensePairs).toHaveLength(3)
      expect(team.lines.goalies).toHaveLength(2)
      // Every id in the lines must belong to a real player on the roster.
      const ids = [
        ...team.lines.forwards.flat(),
        ...team.lines.defensePairs.flat(),
        ...team.lines.goalies
      ]
      for (const id of ids) {
        expect(players.has(id)).toBe(true)
        expect(team.roster).toContain(id)
      }
    }
  })

  it('produces a schedule where each team plays a balanced count', () => {
    const { league } = generateLeague({ seed: 5, teamCount: 16, roundRobins: 4 })
    const counts = new Map<string, number>()
    for (const g of league.schedule) {
      counts.set(g.homeTeamId, (counts.get(g.homeTeamId) ?? 0) + 1)
      counts.set(g.awayTeamId, (counts.get(g.awayTeamId) ?? 0) + 1)
    }
    // 4 round-robins × 15 opponents = 60 games each.
    for (const teamId of league.teams) expect(counts.get(teamId)).toBe(60)
    // No team scheduled against itself.
    for (const g of league.schedule) expect(g.homeTeamId).not.toBe(g.awayTeamId)
  })

  it('produces a spread of player abilities (stars and scrubs)', () => {
    const { players } = generateLeague({ seed: 99 })
    const overalls = [...players.values()].map((p) => overall(p.composites, p.position))
    const max = Math.max(...overalls)
    const min = Math.min(...overalls)
    expect(max - min).toBeGreaterThan(25)
  })

  it('rejects odd or too-small team counts', () => {
    expect(() => generateLeague({ seed: 1, teamCount: 15 })).toThrow()
    expect(() => generateLeague({ seed: 1, teamCount: 2 })).toThrow()
  })
})
