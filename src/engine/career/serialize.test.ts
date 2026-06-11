import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { CareerSnapshot } from './views'
import {
  deserializeLeagueData,
  deserializeMap,
  serializeLeagueData,
  serializeMap,
  validateSnapshot
} from './serialize'

describe('serializeMap / deserializeMap', () => {
  it('round-trips a string-keyed map through JSON', () => {
    const map = new Map<string, { points: number }>([
      ['t0', { points: 12 }],
      ['t1', { points: 7 }]
    ])
    const restored = deserializeMap<string, { points: number }>(
      JSON.parse(JSON.stringify(serializeMap(map)))
    )
    expect(restored).toEqual(map)
    expect([...restored.keys()]).toEqual(['t0', 't1'])
  })

  it('handles the empty map', () => {
    expect(deserializeMap(serializeMap(new Map()))).toEqual(new Map())
  })
})

describe('serializeLeagueData / deserializeLeagueData', () => {
  it('round-trips a generated league through JSON without loss', () => {
    const data = generateLeague({ seed: 42 })
    const json = JSON.stringify(serializeLeagueData(data))
    const restored = deserializeLeagueData(JSON.parse(json))

    expect(restored.league).toEqual(data.league)
    expect(restored.teams).toEqual(data.teams)
    expect(restored.players).toEqual(data.players)
  })

  it('rebuilds real Maps with the original iteration order', () => {
    const data = generateLeague({ seed: 7 })
    const restored = deserializeLeagueData(
      JSON.parse(JSON.stringify(serializeLeagueData(data)))
    )
    expect(restored.teams).toBeInstanceOf(Map)
    expect(restored.players).toBeInstanceOf(Map)
    expect([...restored.teams.keys()]).toEqual([...data.teams.keys()])
    expect([...restored.players.keys()]).toEqual([...data.players.keys()])
  })

  it('preserves nested player state (ratings, contract, lines)', () => {
    const data = generateLeague({ seed: 11 })
    const restored = deserializeLeagueData(
      JSON.parse(JSON.stringify(serializeLeagueData(data)))
    )
    const teamId = data.league.teams[0]
    const team = data.teams.get(teamId)!
    const restoredTeam = restored.teams.get(teamId)!
    expect(restoredTeam.lines).toEqual(team.lines)

    const playerId = team.roster[0]
    const player = data.players.get(playerId)!
    const restoredPlayer = restored.players.get(playerId)!
    expect(restoredPlayer.ratings).toEqual(player.ratings)
    expect(restoredPlayer.composites).toEqual(player.composites)
    expect(restoredPlayer.contract).toEqual(player.contract)
  })
})

/** A minimal structurally-valid snapshot built around a real generated league. */
function makeSnapshot(): CareerSnapshot {
  const data = generateLeague({ seed: 1 })
  return {
    version: 1,
    savedAt: '2026-06-10T00:00:00.000Z',
    saveName: 'Test Career',
    seed: 1,
    userTeamId: data.league.teams[0],
    phase: 'regularSeason',
    currentDay: 5,
    year: 2025,
    leagueData: serializeLeagueData(data),
    standings: [['t0', { wins: 3 }]],
    playerTotals: [['p0', { goals: 2 }]],
    gamesPlayed: [['t0', 5]],
    news: [],
    newsCounter: 0,
    playoffs: null,
    offseason: null,
    picks: [],
    history: []
  }
}

describe('validateSnapshot', () => {
  it('accepts a valid snapshot and returns it typed', () => {
    const snap = makeSnapshot()
    const validated = validateSnapshot(JSON.parse(JSON.stringify(snap)))
    expect(validated.saveName).toBe('Test Career')
    expect(validated.version).toBe(1)
  })

  it('survives the full save round trip: snapshot → JSON → validate → deserialize', () => {
    const data = generateLeague({ seed: 23 })
    const snap = { ...makeSnapshot(), leagueData: serializeLeagueData(data) }
    const validated = validateSnapshot(JSON.parse(JSON.stringify(snap)))
    const restored = deserializeLeagueData(validated.leagueData)
    expect(restored.teams).toEqual(data.teams)
    expect(restored.players).toEqual(data.players)
    expect(restored.league).toEqual(data.league)
  })

  it('rejects non-objects', () => {
    expect(() => validateSnapshot(null)).toThrow(/invalid snapshot/)
    expect(() => validateSnapshot('save')).toThrow(/invalid snapshot/)
    expect(() => validateSnapshot([1, 2])).toThrow(/invalid snapshot/)
  })

  it('rejects a wrong or missing version', () => {
    expect(() => validateSnapshot({ ...makeSnapshot(), version: 2 })).toThrow(/version/)
    const { version: _version, ...rest } = makeSnapshot()
    expect(() => validateSnapshot(rest)).toThrow(/version/)
  })

  it('rejects missing required fields by name', () => {
    const { saveName: _saveName, ...noName } = makeSnapshot()
    expect(() => validateSnapshot(noName)).toThrow(/"saveName"/)

    const { leagueData: _leagueData, ...noLeague } = makeSnapshot()
    expect(() => validateSnapshot(noLeague)).toThrow(/leagueData/)

    const { playoffs: _playoffs, ...noPlayoffs } = makeSnapshot()
    expect(() => validateSnapshot(noPlayoffs)).toThrow(/"playoffs"/)
  })

  it('rejects wrong field types', () => {
    expect(() => validateSnapshot({ ...makeSnapshot(), seed: 'abc' })).toThrow(/"seed"/)
    expect(() => validateSnapshot({ ...makeSnapshot(), phase: 'preseason' })).toThrow(/"phase"/)
    expect(() => validateSnapshot({ ...makeSnapshot(), news: 'none' })).toThrow(/"news"/)
    expect(() => validateSnapshot({ ...makeSnapshot(), playoffs: 'no' })).toThrow(/"playoffs"/)
  })

  it('rejects malformed map entry arrays', () => {
    expect(() =>
      validateSnapshot({ ...makeSnapshot(), standings: [['t0', 1], 'bogus'] })
    ).toThrow(/"standings"\[1\]/)
    expect(() =>
      validateSnapshot({ ...makeSnapshot(), gamesPlayed: [['t0', 'five']] })
    ).toThrow(/"gamesPlayed"\[0\]/)

    const snap = makeSnapshot()
    const corruptLeague = {
      ...snap,
      leagueData: { ...snap.leagueData, players: [[42, {}]] }
    }
    expect(() => validateSnapshot(corruptLeague)).toThrow(/"players"\[0\]/)
  })
})
