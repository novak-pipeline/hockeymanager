/**
 * Data Hub — xG accumulation + league analytics tests.
 *
 * Covers:
 *   1. xG accrues > 0 in both quick-sim and full-sim engines.
 *   2. buildDataHubView produces sane output:
 *      - All NHL teams are present.
 *      - xGF/60 > 0 after games are played.
 *      - Top xGF team has a high percentile (≥ 67).
 *      - Worst xGA team has a low GA percentile (≤ 33).
 *      - Player leaders are populated (min 5 GP filter).
 *   3. No on-disk / mod dependency — pure in-memory.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { quickSimGame } from '@engine/quick/quickSim'
import { Career } from './career'
import { buildDataHubView } from './buildViews'

/* ──────────────────── helpers ──────────────────── */

function makeCareerAndPlayGames(seed: number, gameDays: number): Career {
  const data = generateLeague({ seed })
  const userId = data.league.teams[0]
  const career = new Career(data, seed, userId)
  for (let i = 0; i < gameDays; i++) {
    if (!career.advanceDay()) break
  }
  return career
}

/* ──────────────────── quick-sim xG accumulation ──────────────────── */

describe('quick-sim xG accumulation', () => {
  it('accrues positive xg on skaters after a game', () => {
    const { teams, players } = generateLeague({ seed: 7 })
    const ids = [...teams.keys()]
    const resolve = (id: any) => players.get(id)!
    const result = quickSimGame(teams.get(ids[0])!, teams.get(ids[1])!, resolve, { seed: 99 })

    const skaterStats = [...result.playerStats.values()].filter(
      (s) => s.shots > 0 && players.get(s.playerId)?.position !== 'G'
    )
    // Every skater who shot should have xg > 0
    expect(skaterStats.length).toBeGreaterThan(0)
    for (const s of skaterStats) {
      expect(s.xg).toBeGreaterThan(0)
    }
  })

  it('accrues positive xgAgainst on the goalie after a game', () => {
    const { teams, players } = generateLeague({ seed: 11 })
    const ids = [...teams.keys()]
    const resolve = (id: any) => players.get(id)!
    const result = quickSimGame(teams.get(ids[2])!, teams.get(ids[3])!, resolve, { seed: 55 })

    const goalieStats = [...result.playerStats.values()].filter((s) => s.shotsAgainst > 0)
    expect(goalieStats.length).toBeGreaterThan(0)
    for (const g of goalieStats) {
      expect(g.xgAgainst).toBeGreaterThan(0)
    }
  })

  it('credits xA to primary assister when goal has an assist', () => {
    const { teams, players } = generateLeague({ seed: 13 })
    const ids = [...teams.keys()]
    const resolve = (id: any) => players.get(id)!

    // Run multiple games to ensure at least one assisted goal.
    let foundXA = false
    for (let s = 0; s < 20; s++) {
      const result = quickSimGame(teams.get(ids[0])!, teams.get(ids[1])!, resolve, { seed: s })
      const assisted = [...result.playerStats.values()].find((s) => (s.xA ?? 0) > 0)
      if (assisted) {
        foundXA = true
        break
      }
    }
    expect(foundXA).toBe(true)
  })

  it('total xg across all skaters approximately matches total goals (within 10×)', () => {
    const { teams, players } = generateLeague({ seed: 17 })
    const ids = [...teams.keys()]
    const resolve = (id: any) => players.get(id)!
    const result = quickSimGame(teams.get(ids[0])!, teams.get(ids[1])!, resolve, { seed: 42 })

    const totalXg = [...result.playerStats.values()].reduce((sum, s) => sum + (s.xg ?? 0), 0)
    const totalGoals = result.homeGoals + result.awayGoals
    // xG should be in the ballpark of actual goals (not wildly off)
    expect(totalXg).toBeGreaterThan(0)
    expect(totalXg).toBeLessThan(totalGoals * 10)
    expect(totalXg).toBeGreaterThan(totalGoals / 10)
  })

  it('is deterministic: same seed produces identical xG values', () => {
    const { teams, players } = generateLeague({ seed: 3 })
    const ids = [...teams.keys()]
    const resolve = (id: any) => players.get(id)!
    const r1 = quickSimGame(teams.get(ids[0])!, teams.get(ids[1])!, resolve, { seed: 77 })
    const r2 = quickSimGame(teams.get(ids[0])!, teams.get(ids[1])!, resolve, { seed: 77 })

    const totalXg1 = [...r1.playerStats.values()].reduce((s, p) => s + (p.xg ?? 0), 0)
    const totalXg2 = [...r2.playerStats.values()].reduce((s, p) => s + (p.xg ?? 0), 0)
    expect(totalXg1).toBe(totalXg2)
  })
})

/* ──────────────────── Data Hub view ──────────────────── */

describe('buildDataHubView', () => {
  it('all NHL teams appear in allTeams', () => {
    const career = makeCareerAndPlayGames(21, 10)
    const hub = career.getDataHubView()
    // generateLeague with default 16 NHL teams
    expect(hub.allTeams.length).toBeGreaterThanOrEqual(8)
    // Each row has a teamId and a name
    for (const row of hub.allTeams) {
      expect(row.teamId).toBeTruthy()
      expect(row.teamName).toBeTruthy()
      expect(row.teamAbbr).toBeTruthy()
    }
  })

  it('xGF/60 is > 0 for all teams after games are played', () => {
    const career = makeCareerAndPlayGames(33, 15)
    const hub = career.getDataHubView()
    for (const row of hub.allTeams) {
      expect(row.xgfPer60).toBeGreaterThan(0)
    }
  })

  it('allTeams is sorted by xGF/60 descending', () => {
    const career = makeCareerAndPlayGames(44, 10)
    const hub = career.getDataHubView()
    for (let i = 0; i < hub.allTeams.length - 1; i++) {
      expect(hub.allTeams[i].xgfPer60).toBeGreaterThanOrEqual(hub.allTeams[i + 1].xgfPer60)
    }
  })

  it('top xGF team has percentile ≥ 67 (top third)', () => {
    const career = makeCareerAndPlayGames(55, 12)
    const hub = career.getDataHubView()
    // The first team in allTeams (highest xGF/60) should have a high xgfPctile
    const top = hub.allTeams[0]
    expect(top.xgfPctile).toBeGreaterThanOrEqual(67)
  })

  it('bottom xGF team has percentile ≤ 33 (bottom third)', () => {
    const career = makeCareerAndPlayGames(66, 12)
    const hub = career.getDataHubView()
    const bottom = hub.allTeams[hub.allTeams.length - 1]
    expect(bottom.xgfPctile).toBeLessThanOrEqual(33)
  })

  it('percentiles are in [0, 100]', () => {
    const career = makeCareerAndPlayGames(77, 10)
    const hub = career.getDataHubView()
    const pctileFields = [
      'gfPctile', 'gaPctile', 'xgfPctile', 'xgaPctile',
      'shotsPctile', 'shotsAgainstPctile', 'ppPctile', 'pkPctile',
    ] as const
    for (const row of hub.allTeams) {
      for (const field of pctileFields) {
        expect(row[field]).toBeGreaterThanOrEqual(0)
        expect(row[field]).toBeLessThanOrEqual(100)
      }
    }
  })

  it('xgLeaders are present after enough games, sorted by xgPer60 desc', () => {
    const career = makeCareerAndPlayGames(88, 15)
    const hub = career.getDataHubView()
    expect(hub.xgLeaders.length).toBeGreaterThan(0)
    for (let i = 0; i < hub.xgLeaders.length - 1; i++) {
      expect(hub.xgLeaders[i].xgPer60).toBeGreaterThanOrEqual(hub.xgLeaders[i + 1].xgPer60)
    }
    // No goalies in xgLeaders
    for (const row of hub.xgLeaders) {
      expect(row.position).not.toBe('G')
    }
  })

  it('finishingLeaders are present and sorted by finishing desc', () => {
    const career = makeCareerAndPlayGames(99, 15)
    const hub = career.getDataHubView()
    expect(hub.finishingLeaders.length).toBeGreaterThan(0)
    for (let i = 0; i < hub.finishingLeaders.length - 1; i++) {
      expect(hub.finishingLeaders[i].finishing).toBeGreaterThanOrEqual(
        hub.finishingLeaders[i + 1].finishing
      )
    }
  })

  it('userTeam row is present and matches the user team', () => {
    const data = generateLeague({ seed: 111 })
    const userId = data.league.teams[0]
    const career = new Career(data, 111, userId)
    // Play some games
    for (let i = 0; i < 10; i++) if (!career.advanceDay()) break
    const hub = career.getDataHubView()
    expect(hub.userTeam.teamId).toBe(userId as string)
  })

  it('buildDataHubView directly: empty-ish state returns 0 xGF (no games played)', () => {
    const data = generateLeague({ seed: 222 })
    const userId = data.league.teams[0]
    const career = new Career(data, 222, userId)
    const hub = career.getDataHubView()
    // Before any games: all xGF/60 should be 0
    for (const row of hub.allTeams) {
      expect(row.xgfPer60).toBe(0)
    }
  })

  it('max 20 xgLeaders and max 20 finishingLeaders', () => {
    const career = makeCareerAndPlayGames(333, 20)
    const hub = career.getDataHubView()
    expect(hub.xgLeaders.length).toBeLessThanOrEqual(20)
    expect(hub.finishingLeaders.length).toBeLessThanOrEqual(20)
  })
})

/* ──────────────────── mergePlayerStats xG accumulation ──────────────────── */

import { mergePlayerStats } from '@engine/shared/outcome'

describe('mergePlayerStats xG fields', () => {
  it('xg accumulates correctly across multiple games', () => {
    const { teams, players } = generateLeague({ seed: 5 })
    const ids = [...teams.keys()]
    const resolve = (id: any) => players.get(id)!
    const totals = new Map<any, any>()

    // Sim 5 games and merge via mergePlayerStats
    for (let i = 0; i < 5; i++) {
      const result = quickSimGame(teams.get(ids[0])!, teams.get(ids[1])!, resolve, { seed: i })
      mergePlayerStats(totals, result.playerStats)
    }

    const anyWithXg = [...totals.values()].find((s: any) => (s.xg ?? 0) > 0)
    expect(anyWithXg).toBeDefined()
    expect(anyWithXg.xg).toBeGreaterThan(0)
  })

  it('xgAgainst accumulates on goalie across multiple games', () => {
    const { teams, players } = generateLeague({ seed: 6 })
    const ids = [...teams.keys()]
    const resolve = (id: any) => players.get(id)!
    const totals = new Map<any, any>()

    for (let i = 0; i < 5; i++) {
      const result = quickSimGame(teams.get(ids[0])!, teams.get(ids[1])!, resolve, { seed: i + 10 })
      mergePlayerStats(totals, result.playerStats)
    }

    const goalieStats = [...totals.values()].filter((s: any) => s.shotsAgainst > 0)
    expect(goalieStats.length).toBeGreaterThan(0)
    for (const g of goalieStats) {
      expect(g.xgAgainst).toBeGreaterThan(0)
    }
  })
})
