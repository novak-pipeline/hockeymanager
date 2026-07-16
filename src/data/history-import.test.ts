/**
 * Real club/league history import — parse, pass-through, and record-book seeding.
 *
 * An imported DB carries actual Stanley Cup champions and franchise records
 * (Gretzky's 215-point season, etc.). This suite checks the chain end to end:
 *   history block → modSchema validate → LeagueData.importedHistory →
 *   Career seeds the record book from the truth. Generated leagues, with no
 *   imported history, keep their fabricated past.
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateModDatabase, loadModDatabase, type ModDatabase } from './modSchema'
import { generateLeague } from './generate'
import { seedRecordsFromHistory, type ImportedHistory } from '@engine/story/records'
import { Career } from '@engine/career/career'

/* ── a minimal history block referencing two named clubs ── */
const HISTORY: ImportedHistory = {
  clubRecords: [
    { club: 'Alpha Aces', type: 'Most points in a season', year: 1986, value: 215, player: 'Great One' },
    { club: 'Beta Bears', type: 'Most points in a season', year: 2001, value: 120, player: 'Mid Star' },
    { club: 'Alpha Aces', type: 'Most goals in a season', year: 1982, value: 92, player: 'Great One' },
    { club: 'Alpha Aces', type: 'Most career points', year: 1999, value: 1850, player: 'Great One' },
    { club: 'Beta Bears', type: 'Most career points', year: 2010, value: 600, player: 'Mid Star' },
    // A junior/other-league club that is NOT in the league — must be excluded.
    { club: 'Junior Juniors', type: 'Most points in a season', year: 2015, value: 500, player: 'Ineligible' },
  ],
  competitionHistory: [
    { competition: 'The Big League', year: 2023, champion: 'Alpha Aces', runnerUp: 'Beta Bears', third: '', regularChampion: 'Beta Bears' },
    { competition: 'The Big League', year: 2024, champion: 'Beta Bears', runnerUp: 'Alpha Aces', third: '', regularChampion: 'Alpha Aces' },
    // A different competition whose champions don't overlap → not chosen.
    { competition: 'Some Other League', year: 2024, champion: 'Nowhere United', runnerUp: '', third: '', regularChampion: '' },
  ],
}

const TEAMS = [
  { id: 't0', abbreviation: 'ALP', name: 'Alpha Aces' },
  { id: 't1', abbreviation: 'BET', name: 'Beta Bears' },
]

describe('seedRecordsFromHistory', () => {
  it('builds the record book from real franchise records + champions', () => {
    const state = seedRecordsFromHistory({ history: HISTORY, teams: TEAMS, currentYear: 2025 })

    // Single-season points board: top mark is the real 215, junior club excluded.
    expect(state.singleSeason.points[0]?.value).toBe(215)
    expect(state.singleSeason.points[0]?.playerName).toBe('Great One')
    expect(state.singleSeason.points.some((e) => e.value === 500)).toBe(false)
    expect(state.singleSeason.goals[0]?.value).toBe(92)

    // Career points board seeded from real career records.
    expect(state.career.points[0]?.value).toBe(1850)

    // Champions from the overlapping competition, sorted, with resolved team ids.
    expect(state.seasons.map((s) => s.year)).toEqual([2023, 2024])
    expect(state.seasons.find((s) => s.year === 2023)?.championName).toBe('Alpha Aces')
    expect(state.seasons.find((s) => s.year === 2023)?.championTeamId).toBe('t0')
    expect(state.seasons.find((s) => s.year === 2023)?.presidentsTeamName).toBe('Beta Bears')

    // The elite career scorer becomes a Hall-of-Fame legend.
    const legend = state.retiredLegends.find((l) => l.name === 'Great One')
    expect(legend?.hallOfFame).toBe(true)
  })

  it('returns an empty book when no competition overlaps the current clubs', () => {
    const state = seedRecordsFromHistory({
      history: { clubRecords: [], competitionHistory: HISTORY.competitionHistory },
      teams: [{ id: 't9', abbreviation: 'ZZZ', name: 'Ghost Team' }],
      currentYear: 2025,
    })
    expect(state.seasons).toEqual([])
  })
})

describe('modSchema — history block', () => {
  it('parses history leniently, dropping malformed rows, and passes it through the loader', () => {
    const mod = {
      ...makeFixtureMod(4),
      history: {
        clubRecords: [
          { club: 'City0 Nickname0', type: 'Most points in a season', year: 1986, value: 215, player: 'Great One' },
          { club: '', type: 'bad', year: 0, value: 0, player: '' }, // dropped: no club/type
        ],
        competitionHistory: [
          { competition: 'The Big League', year: 2024, champion: 'City0 Nickname0', runnerUp: '', third: '', regularChampion: '' },
          { competition: '', year: 0, champion: '', runnerUp: '', third: '', regularChampion: '' }, // dropped
        ],
      },
    } as unknown as ModDatabase

    const parsed = validateModDatabase(mod)
    expect(parsed.history?.clubRecords).toHaveLength(1)
    expect(parsed.history?.clubRecords[0]?.value).toBe(215)
    expect(parsed.history?.competitionHistory).toHaveLength(1)

    // The loader carries it onto LeagueData for the Career to seed from.
    const data = loadModDatabase(parsed, { seed: 3 })
    expect(data.importedHistory?.clubRecords[0]?.player).toBe('Great One')
  })

  it('omits history when the mod has none (generated-league path)', () => {
    const parsed = validateModDatabase(makeFixtureMod(4))
    expect(parsed.history).toBeUndefined()
    expect(loadModDatabase(parsed, { seed: 3 }).importedHistory).toBeUndefined()
  })
})

describe('Career record-book seeding', () => {
  it('seeds from imported history when present', () => {
    const data = generateLeague({ seed: 909 })
    // Rewrite history to reference two real generated clubs so the overlap match
    // and record boards resolve against actual team ids/names.
    const t0 = data.teams.get(data.league.teams[0]!)!
    const t1 = data.teams.get(data.league.teams[1]!)!
    data.importedHistory = {
      clubRecords: [
        { club: t0.name, type: 'Most points in a season', year: 1986, value: 215, player: 'Great One' },
        { club: t1.name, type: 'Most career points', year: 2001, value: 1600, player: 'Old Legend' },
      ],
      competitionHistory: [
        { competition: 'League X', year: 2020, champion: t0.name, runnerUp: t1.name, third: '', regularChampion: t1.name },
      ],
    }
    const career = new Career(data, 909, data.league.teams[0]!) as any
    expect(career.recordsState.singleSeason.points[0].value).toBe(215)
    expect(career.recordsState.seasons.some((s: any) => s.year === 2020 && s.championTeamId === (t0.id as string))).toBe(true)
  })

  it('falls back to fabricated history for a generated league', () => {
    const data = generateLeague({ seed: 910 })
    expect(data.importedHistory).toBeUndefined()
    const career = new Career(data, 910, data.league.teams[0]!) as any
    // The fabricated seed always fills a past.
    expect(career.recordsState.seasons.length).toBeGreaterThan(0)
    expect(career.recordsState.retiredLegends.length).toBeGreaterThan(0)
  })
})

const REAL_DB = 'K:/Hockey Game/mods/nhl-ehm/database.json'
describe('real imported DB', () => {
  it.skipIf(!existsSync(REAL_DB))('cites actual NHL records and champions', () => {
    const mod = validateModDatabase(JSON.parse(readFileSync(REAL_DB, 'utf8')))
    expect(mod.history).toBeDefined()
    const data = loadModDatabase(mod, { seed: 1 })
    expect(data.importedHistory).toBeDefined()
    const seedTeams = data.league.teams.map((id) => {
      const t = data.teams.get(id)!
      return { id: id as string, abbreviation: t.abbreviation, name: t.name }
    })
    const state = seedRecordsFromHistory({ history: data.importedHistory!, teams: seedTeams, currentYear: 2026 })
    // Gretzky's 215-point season is the all-time single-season points mark.
    expect(state.singleSeason.points[0]?.value).toBe(215)
    // A real, recent champion appears in the season archive.
    expect(state.seasons.some((s) => s.year === 2024 && /Panthers/.test(s.championName ?? ''))).toBe(true)
  })
})

/* ── valid 4-team fixture (mirrors modSchema.test.ts) ── */
function makeRoster(teamIndex: number): unknown[] {
  const base = teamIndex * 100
  const skater = (i: number, position: string): unknown => ({
    externalId: `ext-player-${i}`, name: `Player ${i}`, age: 25, position, handedness: 'L', overall: 60,
  })
  const players: unknown[] = []
  for (let i = 0; i < 4; i++) players.push(skater(base + i, 'C'))
  for (let i = 0; i < 9; i++) players.push(skater(base + 10 + i, 'W'))
  for (let i = 0; i < 7; i++) players.push(skater(base + 20 + i, 'D'))
  players.push({ externalId: `ext-goalie-${base + 30}`, name: `Goalie ${base + 30}`, age: 28, position: 'G', handedness: 'L', overall: 70 })
  players.push({ externalId: `ext-goalie-${base + 31}`, name: `Goalie ${base + 31}`, age: 28, position: 'G', handedness: 'L', overall: 70 })
  return players
}
function makeTeam(i: number): unknown {
  return {
    externalId: `ext-team-${i}`, city: `City${i}`, nickname: `Nickname${i}`,
    abbreviation: `T${String(i).padStart(2, '0')}`, primary: '#1A2B3C', secondary: '#4D5E6F',
    players: makeRoster(i),
  }
}
function makeFixtureMod(teamCount = 4): ModDatabase {
  const half = teamCount / 2
  return {
    formatVersion: 1,
    meta: { name: 'Fixture League', author: 'Test', season: '2024-25' },
    conferences: [
      { name: 'Eastern', divisions: [{ name: 'Atlantic', teams: Array.from({ length: half }, (_, i) => makeTeam(i)) }] },
      { name: 'Western', divisions: [{ name: 'Pacific', teams: Array.from({ length: half }, (_, i) => makeTeam(half + i)) }] },
    ],
  } as unknown as ModDatabase
}
