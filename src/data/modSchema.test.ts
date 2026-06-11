/**
 * Tests for modSchema — validation, loading, determinism, and sim-ability.
 */
import { describe, expect, it } from 'vitest'
import { validateModDatabase, loadModDatabase, type ModDatabase, type ModTeam, type ModPlayer } from './modSchema'
import { quickSimGame } from '@engine/quick/quickSim'

/* ─────────────────────────── Fixture helpers ─────────────────────────── */

/** Minimal valid skater. */
function makeSkater(i: number, position: 'C' | 'W' | 'D' = 'W'): ModPlayer {
  return {
    externalId: `ext-player-${i}`,
    name: `Player ${i}`,
    age: 25,
    position,
    handedness: 'L',
    overall: 60
  }
}

/** Minimal valid goalie. */
function makeGoalie(i: number): ModPlayer {
  return {
    externalId: `ext-goalie-${i}`,
    name: `Goalie ${i}`,
    age: 28,
    position: 'G',
    handedness: 'L',
    overall: 70
  }
}

/** Build an array of 23 players: 4C + 9W + 7D + 2G (= 20 skaters + 2 goalies). */
function makeRoster(teamIndex: number): ModPlayer[] {
  const players: ModPlayer[] = []
  const base = teamIndex * 100
  for (let i = 0; i < 4; i++) players.push(makeSkater(base + i, 'C'))
  for (let i = 0; i < 9; i++) players.push(makeSkater(base + 10 + i, 'W'))
  for (let i = 0; i < 7; i++) players.push(makeSkater(base + 20 + i, 'D'))
  players.push(makeGoalie(base + 30))
  players.push(makeGoalie(base + 31))
  return players
}

/** Minimal valid team. */
function makeTeam(i: number): ModTeam {
  return {
    externalId: `ext-team-${i}`,
    city: `City${i}`,
    nickname: `Nickname${i}`,
    abbreviation: `T${String(i).padStart(2, '0')}`,
    primary: '#1A2B3C',
    secondary: '#4D5E6F',
    players: makeRoster(i)
  }
}

/** Build a valid ModDatabase with `teamCount` teams, split evenly across 2 conferences × 1 division. */
function makeFixtureMod(teamCount = 4): ModDatabase {
  const half = teamCount / 2
  return {
    formatVersion: 1,
    meta: { name: 'Fixture League', author: 'Test', season: '2024-25' },
    conferences: [
      {
        name: 'Eastern',
        divisions: [
          {
            name: 'Atlantic',
            teams: Array.from({ length: half }, (_, i) => makeTeam(i))
          }
        ]
      },
      {
        name: 'Western',
        divisions: [
          {
            name: 'Pacific',
            teams: Array.from({ length: half }, (_, i) => makeTeam(half + i))
          }
        ]
      }
    ]
  }
}

/* ─────────────────────────── Validation: acceptance ─────────────────────────── */

describe('validateModDatabase — valid input', () => {
  it('accepts the minimal valid fixture with 4 teams', () => {
    const db = makeFixtureMod(4)
    expect(() => validateModDatabase(db)).not.toThrow()
  })

  it('returns a typed ModDatabase with correct structure', () => {
    const db = makeFixtureMod(4)
    const validated = validateModDatabase(db)
    expect(validated.formatVersion).toBe(1)
    expect(validated.meta.name).toBe('Fixture League')
    expect(validated.conferences).toHaveLength(2)
    expect(validated.conferences[0].divisions[0].teams).toHaveLength(2)
  })

  it('accepts optional meta fields', () => {
    const db = makeFixtureMod(4)
    db.meta.author = 'Community User'
    db.meta.season = '2024-25'
    expect(() => validateModDatabase(db)).not.toThrow()
    const v = validateModDatabase(db)
    expect(v.meta.author).toBe('Community User')
    expect(v.meta.season).toBe('2024-25')
  })

  it('accepts players with explicit per-attribute overrides', () => {
    const db = makeFixtureMod(4)
    // Add attribute overrides to first player on first team.
    const team = db.conferences[0].divisions[0].teams[0]
    team.players[0] = {
      ...team.players[0],
      attributes: {
        wristShot: 85,
        speed: 90,
        defensiveIQ: 55
      }
    }
    expect(() => validateModDatabase(db)).not.toThrow()
  })

  it('accepts players with explicit potential and contract', () => {
    const db = makeFixtureMod(4)
    const team = db.conferences[0].divisions[0].teams[0]
    team.players[0] = {
      ...team.players[0],
      potential: 85,
      contract: { salary: 5_000_000, years: 3 }
    }
    expect(() => validateModDatabase(db)).not.toThrow()
  })

  it('accepts players with faceId and teams with logoId', () => {
    const db = makeFixtureMod(4)
    const team = db.conferences[0].divisions[0].teams[0]
    team.logoId = 'nhl-team-10'
    team.players[0] = { ...team.players[0], faceId: 'nhl-8478402' }
    expect(() => validateModDatabase(db)).not.toThrow()
  })

  it('accepts a larger league (16 teams)', () => {
    const db = makeFixtureMod(16)
    expect(() => validateModDatabase(db)).not.toThrow()
  })
})

/* ─────────────────────────── Validation: rejection ─────────────────────────── */

describe('validateModDatabase — invalid input', () => {
  it('rejects null/undefined', () => {
    expect(() => validateModDatabase(null)).toThrow(/ModDatabase/)
    expect(() => validateModDatabase(undefined)).toThrow(/ModDatabase/)
  })

  it('rejects wrong formatVersion', () => {
    const db = makeFixtureMod(4) as Record<string, unknown>
    db['formatVersion'] = 2
    expect(() => validateModDatabase(db)).toThrow(/formatVersion/)
  })

  it('rejects missing meta.name', () => {
    const db = makeFixtureMod(4)
    ;(db.meta as Record<string, unknown>)['name'] = ''
    expect(() => validateModDatabase(db)).toThrow(/meta\.name/)
  })

  it('rejects odd total team count', () => {
    // Build a 6-team mod (which passes the >= 4 check) then make it 5 by
    // removing one team to expose the even-count violation.
    const db = makeFixtureMod(6)
    db.conferences[1].divisions[0].teams.pop() // 6 → 5
    expect(() => validateModDatabase(db)).toThrow(/even/)
  })

  it('rejects fewer than 4 teams', () => {
    const db = makeFixtureMod(4)
    // Keep only 1 team per conference.
    db.conferences[0].divisions[0].teams = [makeTeam(0)]
    db.conferences[1].divisions[0].teams = [makeTeam(1)]
    expect(() => validateModDatabase(db)).toThrow(/team count/)
  })

  it('rejects a team with too few skaters', () => {
    const db = makeFixtureMod(4)
    const team = db.conferences[0].divisions[0].teams[0]
    // Keep only 16 skaters + 2 goalies (need 17+ skaters).
    const skaters = team.players.filter((p) => p.position !== 'G').slice(0, 16)
    const goalies = team.players.filter((p) => p.position === 'G')
    team.players = [...skaters, ...goalies]
    expect(() => validateModDatabase(db)).toThrow(/skaters/)
  })

  it('rejects a team with too few goalies', () => {
    const db = makeFixtureMod(4)
    const team = db.conferences[0].divisions[0].teams[0]
    const skaters = team.players.filter((p) => p.position !== 'G')
    const goalies = team.players.filter((p) => p.position === 'G').slice(0, 1)
    team.players = [...skaters, ...goalies]
    expect(() => validateModDatabase(db)).toThrow(/goalies/)
  })

  it('rejects invalid primary color', () => {
    const db = makeFixtureMod(4)
    db.conferences[0].divisions[0].teams[0].primary = 'red'
    expect(() => validateModDatabase(db)).toThrow(/#RRGGBB/)
  })

  it('rejects invalid secondary color', () => {
    const db = makeFixtureMod(4)
    db.conferences[0].divisions[0].teams[0].secondary = '1A2B3C'
    expect(() => validateModDatabase(db)).toThrow(/#RRGGBB/)
  })

  it('rejects abbreviation != 3 characters', () => {
    const db = makeFixtureMod(4)
    db.conferences[0].divisions[0].teams[0].abbreviation = 'TOOL'
    expect(() => validateModDatabase(db)).toThrow(/abbreviation/)
  })

  it('rejects attribute value out of range', () => {
    const db = makeFixtureMod(4)
    const team = db.conferences[0].divisions[0].teams[0]
    team.players[0] = { ...team.players[0], attributes: { wristShot: 100 } }
    expect(() => validateModDatabase(db)).toThrow(/wristShot/)
  })

  it('rejects unknown attribute key', () => {
    const db = makeFixtureMod(4)
    const team = db.conferences[0].divisions[0].teams[0]
    team.players[0] = {
      ...team.players[0],
      attributes: { someUnknownKey: 50 } as unknown as typeof team.players[0]['attributes']
    }
    expect(() => validateModDatabase(db)).toThrow(/unknown key/)
  })

  it('rejects overall out of range', () => {
    const db = makeFixtureMod(4)
    const team = db.conferences[0].divisions[0].teams[0]
    team.players[0] = { ...team.players[0], overall: 0 }
    expect(() => validateModDatabase(db)).toThrow(/overall/)
  })

  it('rejects age out of range', () => {
    const db = makeFixtureMod(4)
    const team = db.conferences[0].divisions[0].teams[0]
    team.players[0] = { ...team.players[0], age: 15 }
    expect(() => validateModDatabase(db)).toThrow(/age/)
  })

  it('rejects invalid position', () => {
    const db = makeFixtureMod(4)
    const team = db.conferences[0].divisions[0].teams[0]
    ;(team.players[0] as Record<string, unknown>)['position'] = 'X'
    expect(() => validateModDatabase(db)).toThrow(/position/)
  })

  it('rejects duplicate player externalId within a team', () => {
    const db = makeFixtureMod(4)
    const team = db.conferences[0].divisions[0].teams[0]
    team.players[1] = { ...team.players[1], externalId: team.players[0].externalId }
    expect(() => validateModDatabase(db)).toThrow(/duplicate player externalId/)
  })

  it('rejects duplicate team externalId across the mod', () => {
    const db = makeFixtureMod(4)
    db.conferences[1].divisions[0].teams[0].externalId =
      db.conferences[0].divisions[0].teams[0].externalId
    expect(() => validateModDatabase(db)).toThrow(/duplicate team externalId/)
  })

  it('rejects contract.years out of range', () => {
    const db = makeFixtureMod(4)
    const team = db.conferences[0].divisions[0].teams[0]
    team.players[0] = { ...team.players[0], contract: { salary: 3_000_000, years: 9 } }
    expect(() => validateModDatabase(db)).toThrow(/years/)
  })
})

/* ─────────────────────────── loadModDatabase ─────────────────────────── */

describe('loadModDatabase', () => {
  it('produces sim-able LeagueData (quickSimGame runs without throwing)', () => {
    const db = validateModDatabase(makeFixtureMod(4))
    const data = loadModDatabase(db, { seed: 42 })

    const ids = [...data.teams.keys()]
    const home = data.teams.get(ids[0])!
    const away = data.teams.get(ids[1])!
    const resolve = (id: any) => data.players.get(id)!

    // Should not throw, and must produce a valid result.
    const result = quickSimGame(home, away, resolve, { seed: 1 })
    expect(result.homeGoals + result.awayGoals).toBeGreaterThanOrEqual(1)
    expect(result.homeGoals).not.toBe(result.awayGoals)
  })

  it('is deterministic (same seed → same league)', () => {
    const db = validateModDatabase(makeFixtureMod(4))
    const a = loadModDatabase(db, { seed: 99 })
    const b = loadModDatabase(db, { seed: 99 })

    const idsA = [...a.players.keys()]
    const idsB = [...b.players.keys()]
    expect(idsA).toEqual(idsB)

    const firstA = a.players.get(idsA[0])!
    const firstB = b.players.get(idsB[0])!
    expect(firstA.ratings).toEqual(firstB.ratings)
    expect(firstA.composites).toEqual(firstB.composites)
  })

  it('different seeds produce different attribute rolls', () => {
    const db = validateModDatabase(makeFixtureMod(4))
    const a = loadModDatabase(db, { seed: 1 })
    const b = loadModDatabase(db, { seed: 2 })

    const pid = [...a.players.keys()][0]
    const pA = a.players.get(pid)!
    const pB = b.players.get(pid)!
    // Same name (from mod) but different synthesised attributes.
    expect(pA.name).toBe(pB.name)
    expect(pA.ratings.technical.wristShot).not.toBe(pB.ratings.technical.wristShot)
  })

  it('carries externalId and faceId through to Player', () => {
    const db = makeFixtureMod(4)
    db.conferences[0].divisions[0].teams[0].players[0] = {
      ...db.conferences[0].divisions[0].teams[0].players[0],
      externalId: 'nhl-8478402',
      faceId: 'face-8478402'
    }
    const validated = validateModDatabase(db)
    const data = loadModDatabase(validated, { seed: 1 })

    const player = [...data.players.values()].find((p) => p.externalId === 'nhl-8478402')
    expect(player).toBeDefined()
    expect(player!.faceId).toBe('face-8478402')
  })

  it('carries externalId and logoId through to Team', () => {
    const db = makeFixtureMod(4)
    db.conferences[0].divisions[0].teams[0].externalId = 'nhl-team-10'
    db.conferences[0].divisions[0].teams[0].logoId = 'logo-bos'
    const validated = validateModDatabase(db)
    const data = loadModDatabase(validated, { seed: 1 })

    const team = [...data.teams.values()].find((t) => t.externalId === 'nhl-team-10')
    expect(team).toBeDefined()
    expect(team!.logoId).toBe('logo-bos')
  })

  it('explicit per-attribute overrides are respected', () => {
    const db = makeFixtureMod(4)
    db.conferences[0].divisions[0].teams[0].players[0] = {
      ...db.conferences[0].divisions[0].teams[0].players[0],
      externalId: 'test-override-player',
      attributes: { wristShot: 95, speed: 92 }
    }
    const validated = validateModDatabase(db)
    const data = loadModDatabase(validated, { seed: 7 })

    const player = [...data.players.values()].find((p) => p.externalId === 'test-override-player')
    expect(player).toBeDefined()
    expect(player!.ratings.technical.wristShot).toBe(95)
    expect(player!.ratings.physical.speed).toBe(92)
  })

  it('explicit contract values are preserved', () => {
    const db = makeFixtureMod(4)
    db.conferences[0].divisions[0].teams[0].players[0] = {
      ...db.conferences[0].divisions[0].teams[0].players[0],
      externalId: 'contract-test-player',
      contract: { salary: 8_000_000, years: 4 }
    }
    const validated = validateModDatabase(db)
    const data = loadModDatabase(validated, { seed: 3, startYear: 2025 })

    const player = [...data.players.values()].find((p) => p.externalId === 'contract-test-player')
    expect(player).toBeDefined()
    expect(player!.contract.salary).toBe(8_000_000)
    expect(player!.contract.yearsRemaining).toBe(4)
    expect(player!.contract.expiryYear).toBe(2029)
  })

  it('produces correct conference/division structure', () => {
    const db = validateModDatabase(makeFixtureMod(4))
    const data = loadModDatabase(db, { seed: 5 })

    expect(data.league.conferences).toHaveLength(2)
    expect(data.league.divisions).toHaveLength(2)
    expect(data.league.teams).toHaveLength(4)
  })

  it('produces a non-empty schedule', () => {
    const db = validateModDatabase(makeFixtureMod(4))
    const data = loadModDatabase(db, { seed: 5, roundRobins: 2 })
    // 4 teams, 2 round-robins of 3 rounds each = 6 days × 2 games = 12 games.
    expect(data.league.schedule.length).toBeGreaterThan(0)
    for (const g of data.league.schedule) {
      expect(g.result).toBeNull()
      expect(g.homeTeamId).not.toBe(g.awayTeamId)
    }
  })

  it('all team rosters reference valid player ids', () => {
    const db = validateModDatabase(makeFixtureMod(4))
    const data = loadModDatabase(db, { seed: 10 })

    for (const team of data.teams.values()) {
      for (const pid of team.roster) {
        expect(data.players.has(pid)).toBe(true)
      }
    }
  })

  it('all line ids reference valid roster players', () => {
    const db = validateModDatabase(makeFixtureMod(4))
    const data = loadModDatabase(db, { seed: 11 })

    for (const team of data.teams.values()) {
      const ids = [
        ...team.lines.forwards.flat(),
        ...team.lines.defensePairs.flat(),
        ...team.lines.goalies
      ]
      for (const id of ids) {
        expect(data.players.has(id)).toBe(true)
        expect(team.roster).toContain(id)
      }
    }
  })

  it('league player list contains all players from all teams', () => {
    const db = validateModDatabase(makeFixtureMod(4))
    const data = loadModDatabase(db, { seed: 13 })

    const allRosterIds = new Set<string>()
    for (const team of data.teams.values()) {
      for (const pid of team.roster) allRosterIds.add(pid)
    }
    for (const pid of allRosterIds) {
      expect(data.league.players).toContain(pid)
    }
  })

  it('produces valid JSON (no Maps, classes, or functions in output)', () => {
    const db = validateModDatabase(makeFixtureMod(4))
    const data = loadModDatabase(db, { seed: 77 })

    // Spot-check that domain objects are plain.
    for (const player of data.players.values()) {
      const json = JSON.stringify(player)
      const back = JSON.parse(json)
      expect(back.name).toBe(player.name)
      expect(back.ratings.technical.wristShot).toBe(player.ratings.technical.wristShot)
    }
  })

  it('second goalie gets role "backup"', () => {
    const db = validateModDatabase(makeFixtureMod(4))
    const data = loadModDatabase(db, { seed: 20 })

    for (const team of data.teams.values()) {
      const goalies = team.roster
        .map((pid) => data.players.get(pid)!)
        .filter((p) => p.position === 'G')
      expect(goalies[0].role).toBe('starter')
      expect(goalies[1].role).toBe('backup')
    }
  })

  it('league name comes from mod meta', () => {
    const db = validateModDatabase(makeFixtureMod(4))
    const data = loadModDatabase(db, { seed: 1 })
    expect(data.league.name).toBe('Fixture League')
  })

  it('startYear propagates to season.year and schedule', () => {
    const db = validateModDatabase(makeFixtureMod(4))
    const data = loadModDatabase(db, { seed: 1, startYear: 2027 })
    expect(data.league.season.year).toBe(2027)
    for (const g of data.league.schedule) {
      expect(g.season).toBe(2027)
    }
  })
})

/* ─────────────────────────── Round-trip sim test ─────────────────────────── */

describe('modded league end-to-end sim', () => {
  it('quickSimGame on all team pairs never ties', () => {
    const db = validateModDatabase(makeFixtureMod(4))
    const data = loadModDatabase(db, { seed: 42 })
    const ids = [...data.teams.keys()]
    const resolve = (id: any) => data.players.get(id)!

    // Play every pair of teams.
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const home = data.teams.get(ids[i])!
        const away = data.teams.get(ids[j])!
        const r = quickSimGame(home, away, resolve, { seed: i * 100 + j })
        expect(r.homeGoals).not.toBe(r.awayGoals)
      }
    }
  })

  it('attribute overrides propagate into composite ratings used by sim', () => {
    const db = makeFixtureMod(4)
    // Give first player on first team a very high sniper build.
    db.conferences[0].divisions[0].teams[0].players[0] = {
      ...db.conferences[0].divisions[0].teams[0].players[0],
      externalId: 'elite-sniper',
      overall: 90,
      attributes: { wristShot: 99, slapShot: 99, offensiveIQ: 99 }
    }
    const validated = validateModDatabase(db)
    const data = loadModDatabase(validated, { seed: 99 })

    const sniper = [...data.players.values()].find((p) => p.externalId === 'elite-sniper')
    expect(sniper).toBeDefined()
    // Scoring composite should be high given perfect offensive attributes.
    expect(sniper!.composites.scoring).toBeGreaterThan(75)
  })
})
