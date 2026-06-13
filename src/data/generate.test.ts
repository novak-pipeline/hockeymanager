import { describe, expect, it } from 'vitest'
import { overall } from '@engine/ratings/composites'
import { generateLeague } from './generate'
import type { Player } from '@domain'

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
    // NHL teams only in league.teams.
    expect(league.teams).toHaveLength(16)
    // teams map includes both NHL (16) and AHL affiliates (16).
    expect(teams.size).toBe(32)
    expect(league.conferences).toHaveLength(2)
    expect(league.divisions).toHaveLength(4)
    // NHL: 16 × 23 = 368 players. AHL: 16 × 20 = 320.
    const nhlPlayerCount = 16 * 23
    const ahlPlayerCount = 16 * 20 // AHL_FORWARDS(12) + AHL_DEFENSE(6) + AHL_GOALIES(2)
    expect(players.size).toBe(nhlPlayerCount + ahlPlayerCount)
    // league.players lists only NHL players (AHL players are on AHL rosters).
    expect(league.players).toHaveLength(nhlPlayerCount)
  })

  it('generates AHL affiliates linked to NHL parents', () => {
    const { league, teams } = generateLeague({ seed: 7, teamCount: 16 })
    // One affiliate per NHL team.
    expect(league.ahlTeams).toHaveLength(16)
    expect(league.ahlSchedule).toBeDefined()
    expect(league.ahlStandings).toHaveLength(16)
    // Every AHL team is in the teams map and linked correctly.
    for (const ahlId of league.ahlTeams!) {
      const ahlTeam = teams.get(ahlId)!
      expect(ahlTeam).toBeDefined()
      expect(ahlTeam.tier).toBe('ahl')
      expect(ahlTeam.parentTeamId).toBeDefined()
      // The NHL parent must point back.
      const nhlTeam = teams.get(ahlTeam.parentTeamId!)!
      expect(nhlTeam.affiliateId).toBe(ahlId)
      expect(league.teams).toContain(ahlTeam.parentTeamId)
      // AHL team must NOT be in NHL teams list.
      expect(league.teams).not.toContain(ahlId)
    }
  })

  it('AHL schedule has no self-games and AHL standings initialized', () => {
    const { league } = generateLeague({ seed: 7 })
    for (const g of league.ahlSchedule!) {
      expect(g.homeTeamId).not.toBe(g.awayTeamId)
      expect(g.result).toBeNull()
      expect(league.ahlTeams).toContain(g.homeTeamId)
      expect(league.ahlTeams).toContain(g.awayTeamId)
    }
    for (const s of league.ahlStandings!) {
      expect(s.gamesPlayed).toBe(0)
      expect(league.ahlTeams).toContain(s.teamId)
    }
  })

  it('AHL players are genuinely lower-rated than NHL players on average', () => {
    const { league, teams, players } = generateLeague({ seed: 42 })
    const getOverall = (p: Player) => overall(p.composites, p.position)
    const nhlOveralls: number[] = []
    for (const tid of league.teams) {
      const team = teams.get(tid)!
      for (const pid of team.roster) {
        nhlOveralls.push(getOverall(players.get(pid)!))
      }
    }
    const ahlOveralls: number[] = []
    for (const tid of league.ahlTeams!) {
      const team = teams.get(tid)!
      for (const pid of team.roster) {
        ahlOveralls.push(getOverall(players.get(pid)!))
      }
    }
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length
    expect(avg(ahlOveralls)).toBeLessThan(avg(nhlOveralls))
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
