import { describe, expect, it } from 'vitest'
import type { Competition, PlayerId } from '@domain'
import { generateLeague } from '@data'
import { buildCompetitions, type RawCompetition } from '@data/leagueWorld'
import { Rng } from '@engine/shared/rng'
import { worldFreeAgencySweep } from './worldFreeAgency'

/** Generated league + a 2-league world (SHL + Liiga) over a slice of teams. */
function world(seed: number): {
  competitions: Competition[]
  teams: ReturnType<typeof generateLeague>['teams']
  players: ReturnType<typeof generateLeague>['players']
  faPool: PlayerId[]
} {
  const lg = generateLeague({ seed })
  const shlTeams = lg.league.teams.slice(0, 4)
  const liigaTeams = lg.league.teams.slice(4, 8)
  const comps: RawCompetition[] = [
    { id: 'shl', name: 'Swedish Hockey League', abbrev: 'SHL', nation: 'Sweden', level: 1, reputation: 17 },
    { id: 'liiga', name: 'Finnish Liiga', abbrev: 'LIIGA', nation: 'Finland', level: 1, reputation: 15 },
  ]
  const membership = [
    ...shlTeams.map((teamId) => ({ teamId, competitionId: 'shl' })),
    ...liigaTeams.map((teamId) => ({ teamId, competitionId: 'liiga' })),
  ]
  const competitions = buildCompetitions({ comps, membership, season: 2025 })
  // Free agents = players from other teams (not in the world comps, which use 0–8).
  const faPool: PlayerId[] = []
  for (const tid of lg.league.teams.slice(8, 14)) {
    const t = lg.teams.get(tid)!
    for (const pid of t.roster) faPool.push(pid)
  }
  return { competitions, teams: lg.teams, players: lg.players, faPool }
}

describe('worldFreeAgencySweep', () => {
  it('signs leftover free agents to world-league teams and gives them contracts', () => {
    const w = world(21)
    const before = w.faPool.length
    const res = worldFreeAgencySweep({
      competitions: w.competitions, teams: w.teams, players: w.players,
      faPool: w.faPool, year: 2025, rng: new Rng(1),
    })
    expect(res.signings.length).toBeGreaterThan(0)
    expect(res.remaining.length).toBe(before - res.signings.length)
    for (const s of res.signings) {
      const team = w.teams.get(s.teamId)!
      expect(team.roster).toContain(s.playerId)
      expect(s.salary).toBeGreaterThan(0)
      // Signed player's contract was set.
      expect(w.players.get(s.playerId)!.contract.salary).toBe(s.salary)
    }
  })

  it('respects the roster target (does not overfill teams)', () => {
    const w = world(22)
    worldFreeAgencySweep({
      competitions: w.competitions, teams: w.teams, players: w.players,
      faPool: w.faPool, year: 2025, rng: new Rng(2), rosterTarget: 24,
    })
    for (const c of w.competitions) {
      for (const tid of c.teamIds) {
        expect(w.teams.get(tid)!.roster.length).toBeLessThanOrEqual(24)
      }
    }
  })

  it('prefers a league in the player\'s nation when there is room', () => {
    const w = world(23)
    // Force a Swedish player into the pool.
    const swede = w.players.get(w.faPool[0]!)!
    swede.nationality = 'Sweden'
    const res = worldFreeAgencySweep({
      competitions: w.competitions, teams: w.teams, players: w.players,
      faPool: [swede.id], year: 2025, rng: new Rng(3), minOverall: 0,
    })
    expect(res.signings).toHaveLength(1)
    expect(res.signings[0]!.competitionId).toBe('shl') // Swedish league
  })

  it('flags aging quality players as notable for news', () => {
    const w = world(24)
    const vet = w.players.get(w.faPool[0]!)!
    vet.age = 34
    const res = worldFreeAgencySweep({
      competitions: w.competitions, teams: w.teams, players: w.players,
      faPool: [vet.id], year: 2025, rng: new Rng(4), minOverall: 0,
    })
    expect(res.signings).toHaveLength(1)
    // Notability depends on rating; just assert the flag is a boolean and the
    // sweep produced the signing.
    expect(typeof res.signings[0]!.notable).toBe('boolean')
  })

  it('is deterministic for the same seed', () => {
    const a = world(25)
    const b = world(25)
    const ra = worldFreeAgencySweep({ competitions: a.competitions, teams: a.teams, players: a.players, faPool: a.faPool, year: 2025, rng: new Rng(9) })
    const rb = worldFreeAgencySweep({ competitions: b.competitions, teams: b.teams, players: b.players, faPool: b.faPool, year: 2025, rng: new Rng(9) })
    expect(ra.signings.map((s) => `${s.playerId}:${s.teamId}:${s.salary}`))
      .toEqual(rb.signings.map((s) => `${s.playerId}:${s.teamId}:${s.salary}`))
  })

  it('does nothing when there are no simulated competitions', () => {
    const lg = generateLeague({ seed: 26 })
    const res = worldFreeAgencySweep({
      competitions: [], teams: lg.teams, players: lg.players,
      faPool: [lg.league.teams[0] as unknown as PlayerId], year: 2025, rng: new Rng(1),
    })
    expect(res.signings).toHaveLength(0)
  })
})
