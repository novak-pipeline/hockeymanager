import { describe, expect, it } from 'vitest'
import type { Competition, Player, PlayerId, TeamId } from '@domain'
import { generateLeague } from '@data'
import { buildCompetitions, type RawCompetition } from '@data/leagueWorld'
import { initWorldSimState, resetWorldSim, simWorldDay, worldMatchDays } from './worldSim'

/** Build a small simulated competition over a slice of a generated league's
 *  teams, so quickSimGame has real rosters to play with. */
function fixture(seed: number): {
  competitions: Competition[]
  teams: Map<TeamId, ReturnType<typeof generateLeague>['teams'] extends Map<TeamId, infer T> ? T : never>
  resolve: (id: PlayerId) => Player
} {
  const lg = generateLeague({ seed })
  const teamIds = lg.league.teams.slice(0, 6)
  const comps: RawCompetition[] = [
    { id: 'shl', name: 'Swedish Hockey League', abbrev: 'SHL', nation: 'Sweden', level: 1, reputation: 17 },
  ]
  const membership = teamIds.map((teamId) => ({ teamId, competitionId: 'shl' }))
  const competitions = buildCompetitions({ comps, membership, season: 2025 })
  const resolve = (id: PlayerId): Player => {
    const p = lg.players.get(id)
    if (!p) throw new Error(`no player ${id}`)
    return p
  }
  return { competitions, teams: lg.teams, resolve }
}

describe('worldSim', () => {
  it('accrues standings and per-player stats as simulated leagues play', () => {
    const { competitions, teams, resolve } = fixture(11)
    const state = initWorldSimState(competitions)
    const days = worldMatchDays(competitions)
    expect(days.length).toBeGreaterThan(0)
    let total = 0
    for (const d of days) total += simWorldDay({ competitions, day: d, teams, resolve, state, seedBase: 999, year: 2025 }).gamesPlayed
    expect(total).toBe(competitions[0]!.schedule.length)

    const shl = competitions[0]!
    // Every team played a full slate; GP equals games played per team.
    const gpSum = shl.standings.reduce((s, st) => s + st.gamesPlayed, 0)
    expect(gpSum).toBe(total * 2) // each game adds a GP to two teams
    // Points were awarded.
    expect(shl.standings.some((s) => s.points > 0)).toBe(true)
    // Players accumulated games + some production.
    expect(state.gp.size).toBeGreaterThan(0)
    expect([...state.totals.values()].some((t) => t.goals + t.assists > 0)).toBe(true)
  })

  it('writes results back onto the schedule', () => {
    const { competitions, teams, resolve } = fixture(12)
    const state = initWorldSimState(competitions)
    for (const d of worldMatchDays(competitions)) simWorldDay({ competitions, day: d, teams, resolve, state, seedBase: 7, year: 2025 })
    expect(competitions[0]!.schedule.every((g) => g.result !== null)).toBe(true)
  })

  it('is deterministic for the same seed base', () => {
    const a = fixture(13)
    const b = fixture(13)
    const sa = initWorldSimState(a.competitions)
    const sb = initWorldSimState(b.competitions)
    for (const d of worldMatchDays(a.competitions)) simWorldDay({ competitions: a.competitions, day: d, teams: a.teams, resolve: a.resolve, state: sa, seedBase: 42, year: 2025 })
    for (const d of worldMatchDays(b.competitions)) simWorldDay({ competitions: b.competitions, day: d, teams: b.teams, resolve: b.resolve, state: sb, seedBase: 42, year: 2025 })
    expect(a.competitions[0]!.standings).toEqual(b.competitions[0]!.standings)
  })

  it('resetWorldSim clears standings, stats and results', () => {
    const { competitions, teams, resolve } = fixture(14)
    const state = initWorldSimState(competitions)
    for (const d of worldMatchDays(competitions)) simWorldDay({ competitions, day: d, teams, resolve, state, seedBase: 1, year: 2025 })
    resetWorldSim(state, competitions)
    expect(competitions[0]!.standings.every((s) => s.gamesPlayed === 0 && s.points === 0)).toBe(true)
    expect(competitions[0]!.schedule.every((g) => g.result === null)).toBe(true)
    expect(state.gp.size).toBe(0)
    expect(state.totals.size).toBe(0)
  })

  it('ignores background-tier leagues (no schedule, no sim)', () => {
    const lg = generateLeague({ seed: 15 })
    const comps: RawCompetition[] = [
      { id: 'lbl', name: 'Lower Bush League', abbrev: 'LBL', nation: 'Latvia', level: 3, reputation: 5 },
    ]
    const membership = lg.league.teams.slice(0, 6).map((teamId) => ({ teamId, competitionId: 'lbl' }))
    const competitions = buildCompetitions({ comps, membership, season: 2025 })
    expect(competitions[0]!.tier).toBe('background')
    const state = initWorldSimState(competitions)
    expect(state.standings.size).toBe(0)
    expect(worldMatchDays(competitions)).toHaveLength(0)
  })
})
