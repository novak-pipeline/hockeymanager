import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { quickSimGame } from './quickSim'
import { simSeason, sortStandings } from './season'

describe('quickSimGame', () => {
  it('is deterministic for a given seed', () => {
    const { teams, players } = generateLeague({ seed: 1 })
    const ids = [...teams.keys()]
    const resolve = (id: any) => players.get(id)!
    const a = quickSimGame(teams.get(ids[0])!, teams.get(ids[1])!, resolve, { seed: 42 })
    const b = quickSimGame(teams.get(ids[0])!, teams.get(ids[1])!, resolve, { seed: 42 })
    expect(a.homeGoals).toBe(b.homeGoals)
    expect(a.awayGoals).toBe(b.awayGoals)
    expect(a.stream.length).toBe(b.stream.length)
  })

  it('never ends a single game in a tie', () => {
    const { teams, players } = generateLeague({ seed: 4 })
    const ids = [...teams.keys()]
    const resolve = (id: any) => players.get(id)!
    for (let s = 0; s < 50; s++) {
      const r = quickSimGame(teams.get(ids[0])!, teams.get(ids[1])!, resolve, { seed: s })
      expect(r.homeGoals).not.toBe(r.awayGoals)
    }
  })

  it('emits a coherent sparse stream (goals match the box score)', () => {
    const { teams, players } = generateLeague({ seed: 8 })
    const ids = [...teams.keys()]
    const resolve = (id: any) => players.get(id)!
    const r = quickSimGame(teams.get(ids[2])!, teams.get(ids[5])!, resolve, { seed: 123 })
    const goalEvents = r.stream.filter((e) => e.type === 'goal').length
    // Shootout adds one goal to the result that is not a stream goal event.
    const expected = r.decidedBy === 'shootout' ? r.homeGoals + r.awayGoals - 1 : r.homeGoals + r.awayGoals
    expect(goalEvents).toBe(expected)
    expect(r.stream.some((e) => e.type === 'gameEnd')).toBe(true)
  })
})

describe('simSeason', () => {
  it('plays every scheduled game and fills results', () => {
    const data = generateLeague({ seed: 2025 })
    const result = simSeason(data, 2025)
    expect(result.gamesPlayed).toBe(data.league.schedule.length)
    for (const g of data.league.schedule) expect(g.result).not.toBeNull()
  })

  it('produces standings with conserved wins/losses and sane points', () => {
    const data = generateLeague({ seed: 77 })
    const games = data.league.schedule.length
    const { standings } = simSeason(data, 77)

    const totalWins = standings.reduce((s, r) => s + r.wins, 0)
    const totalNonWins = standings.reduce((s, r) => s + r.losses + r.overtimeLosses, 0)
    expect(totalWins).toBe(games)
    expect(totalNonWins).toBe(games)

    // Each team plays 60; total points between 2/game (all reg) and 3/game.
    for (const r of standings) expect(r.gamesPlayed).toBe(60)
    const totalPoints = standings.reduce((s, r) => s + r.points, 0)
    expect(totalPoints).toBeGreaterThanOrEqual(2 * games)
    expect(totalPoints).toBeLessThanOrEqual(3 * games)
  })

  it('standings are sorted by points descending', () => {
    const data = generateLeague({ seed: 5 })
    const { standings } = simSeason(data, 5)
    for (let i = 1; i < standings.length; i++) {
      expect(standings[i - 1].points).toBeGreaterThanOrEqual(standings[i].points)
    }
    // A real league has separation between best and worst.
    expect(standings[0].points - standings[standings.length - 1].points).toBeGreaterThan(10)
  })

  it('scoring lands in a plausible range', () => {
    const data = generateLeague({ seed: 31 })
    const { standings } = simSeason(data, 31)
    const totalGoals = standings.reduce((s, r) => s + r.goalsFor, 0)
    const teamGames = standings.reduce((s, r) => s + r.gamesPlayed, 0)
    const goalsPerTeamPerGame = totalGoals / teamGames
    // NHL is ~3.1; a first-pass uncalibrated engine should at least be 1.5–5.
    expect(goalsPerTeamPerGame).toBeGreaterThan(1.5)
    expect(goalsPerTeamPerGame).toBeLessThan(5)
  })

  it('is fully deterministic for a given seed', () => {
    const a = generateLeague({ seed: 9 })
    const b = generateLeague({ seed: 9 })
    const sa = simSeason(a, 555).standings
    const sb = simSeason(b, 555).standings
    expect(sa.map((r) => [r.teamId, r.points, r.goalsFor])).toEqual(
      sb.map((r) => [r.teamId, r.points, r.goalsFor])
    )
  })

  it('sortStandings does not mutate its input', () => {
    const data = generateLeague({ seed: 12 })
    simSeason(data, 12)
    const before = data.league.season.standings.map((r) => r.teamId)
    const sorted = sortStandings(data.league.season.standings)
    expect(data.league.season.standings.map((r) => r.teamId)).toEqual(before)
    expect(sorted).toHaveLength(before.length)
  })
})
