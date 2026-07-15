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

  it('resolves most overtimes in 3-on-3, not the shootout (open-ice OT)', () => {
    // Regular-season OT is a wide-open 3-on-3 that ends far more games than it
    // sends to a shootout. Over a broad sample of tied-after-regulation games,
    // a clear majority should be decided in overtime.
    let ot = 0
    let so = 0
    // Sample across several league draws so the OT/shootout split is stable, not
    // a one-seed coin flip.
    for (const seed of [3, 4, 5, 6]) {
      const { teams, players } = generateLeague({ seed })
      const ids = [...teams.keys()]
      const resolve = (id: any) => players.get(id)!
      for (let i = 0; i < ids.length; i++) {
        for (let j = 0; j < ids.length; j++) {
          if (i === j) continue
          const r = quickSimGame(teams.get(ids[i])!, teams.get(ids[j])!, resolve, { seed: 1000 * i + j })
          if (r.decidedBy === 'overtime') ot++
          else if (r.decidedBy === 'shootout') so++
        }
      }
    }
    const tied = ot + so
    expect(tied).toBeGreaterThan(50) // sanity: plenty of games reached OT
    expect(ot).toBeGreaterThan(so) // a majority end in 3-on-3, not the shootout
  })

  it('rotates goalies: the backup gets a realistic share of starts, not zero', () => {
    const { teams, players } = generateLeague({ seed: 7 })
    const ids = [...teams.keys()]
    const resolve = (id: any) => players.get(id)!
    const home = teams.get(ids[0])!
    const [starterId, backupId] = home.lines.goalies
    let starterStarts = 0
    let backupStarts = 0
    // 82 "games" for the home club (different opponents/seeds), counting who
    // actually faced shots each night.
    for (let s = 0; s < 82; s++) {
      const away = teams.get(ids[1 + (s % (ids.length - 1))])!
      const r = quickSimGame(home, away, resolve, { seed: 1000 + s })
      if ((r.playerStats.get(starterId)?.shotsAgainst ?? 0) > 0) starterStarts++
      else if ((r.playerStats.get(backupId)?.shotsAgainst ?? 0) > 0) backupStarts++
    }
    // Real NHL: a backup starts roughly 15–30 of 82. Assert he's genuinely used
    // and the starter still carries the load (no 82-0 split, no 41-41 split).
    expect(backupStarts).toBeGreaterThanOrEqual(8)
    expect(backupStarts).toBeLessThanOrEqual(38)
    expect(starterStarts).toBeGreaterThan(backupStarts)
  })

  it('tallies physical stats (hits/blocks/takeaways/giveaways), not all zeros', () => {
    const { teams, players } = generateLeague({ seed: 11 })
    const ids = [...teams.keys()]
    const resolve = (id: any) => players.get(id)!
    const home = teams.get(ids[0])!
    // Aggregate one team's box score over a handful of games.
    let hits = 0, blocks = 0, takes = 0, gives = 0, games = 0
    let dBlocks = 0, dCount = 0, fBlocks = 0, fCount = 0
    for (let s = 0; s < 30; s++) {
      const r = quickSimGame(home, teams.get(ids[1 + (s % (ids.length - 1))])!, resolve, { seed: 500 + s })
      games++
      for (const id of home.roster) {
        const st = r.playerStats.get(id)
        if (!st || (st.toi ?? 0) <= 0) continue
        hits += st.hits; blocks += st.blockedShots; takes += st.takeaways; gives += st.giveaways
        const isD = resolve(id).position === 'D'
        if (isD) { dBlocks += st.blockedShots; dCount++ } else { fBlocks += st.blockedShots; fCount++ }
      }
    }
    // Real NHL per-team-per-game bands: hits ~23, blocks ~17, takeaways ~6, giveaways ~8.
    expect(hits / games).toBeGreaterThan(10)
    expect(hits / games).toBeLessThan(40)
    expect(blocks / games).toBeGreaterThan(8)
    expect(takes / games).toBeGreaterThan(2)
    expect(gives / games).toBeGreaterThan(2)
    // Defencemen block more than forwards (per player).
    expect(dBlocks / Math.max(1, dCount)).toBeGreaterThan(fBlocks / Math.max(1, fCount))
  })

  it('spreads ice time realistically: the top line plays close to 2x the fourth', () => {
    const { teams, players } = generateLeague({ seed: 3 })
    const ids = [...teams.keys()]
    const resolve = (id: any) => players.get(id)!
    const home = teams.get(ids[0])!
    const line1 = home.lines.forwards[0]
    const line4 = home.lines.forwards[3]
    let toi1 = 0
    let toi4 = 0
    // 50 games — a ratio of averages over line minutes is noisy game-to-game, so
    // a bigger sample keeps this pinned to the true ~2.1x rather than one seed's
    // luck (score effects reshuffle the shot-rate RNG, which a tiny sample feels).
    for (let s = 0; s < 50; s++) {
      const r = quickSimGame(home, teams.get(ids[1 + (s % (ids.length - 1))])!, resolve, { seed: 700 + s })
      for (const id of line1) toi1 += r.playerStats.get(id)?.toi ?? 0
      for (const id of line4) toi4 += r.playerStats.get(id)?.toi ?? 0
    }
    const ratio = toi1 / Math.max(1, toi4)
    // Real NHL top-line vs fourth-line minutes run ~1.8-2.3x. (EV weights give
    // ~2.1x; special teams push it a touch higher.)
    expect(ratio).toBeGreaterThan(1.7)
    expect(ratio).toBeLessThan(2.6)
  })

  it('rides the starter in the playoffs (no rotation)', () => {
    const { teams, players } = generateLeague({ seed: 7 })
    const ids = [...teams.keys()]
    const resolve = (id: any) => players.get(id)!
    const home = teams.get(ids[0])!
    const backupId = home.lines.goalies[1]
    let backupStarts = 0
    for (let s = 0; s < 30; s++) {
      const away = teams.get(ids[1])!
      const r = quickSimGame(home, away, resolve, { seed: 2000 + s, rules: 'playoff' })
      if ((r.playerStats.get(backupId)?.shotsAgainst ?? 0) > 0) backupStarts++
    }
    expect(backupStarts).toBe(0)
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
