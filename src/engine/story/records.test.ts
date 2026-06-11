import { describe, expect, it } from 'vitest'
import {
  archiveSeason,
  emptyRecords,
  inductHallOfFame,
  recordWatch,
  registerRetirements,
  type RecordsState,
  type SeasonLine,
} from './records'

/* ────────────────────────── helpers ────────────────────────── */

function skaterLine(
  overrides: Partial<SeasonLine> & { playerId: string; name: string },
): SeasonLine {
  return {
    playerId: overrides.playerId,
    name: overrides.name,
    teamAbbr: overrides.teamAbbr ?? 'TST',
    position: overrides.position ?? 'C',
    goals: overrides.goals ?? 0,
    assists: overrides.assists ?? 0,
    points: overrides.points ?? (overrides.goals ?? 0) + (overrides.assists ?? 0),
    gamesPlayed: overrides.gamesPlayed ?? 82,
    goalieWins: 0,
    savePct: 0,
    shotsAgainst: 0,
  }
}

function goalieLine(
  overrides: Partial<SeasonLine> & { playerId: string; name: string },
): SeasonLine {
  return {
    playerId: overrides.playerId,
    name: overrides.name,
    teamAbbr: overrides.teamAbbr ?? 'TST',
    position: 'G',
    goals: 0,
    assists: 0,
    points: 0,
    gamesPlayed: overrides.gamesPlayed ?? 60,
    goalieWins: overrides.goalieWins ?? 0,
    savePct: overrides.savePct ?? 0.900,
    shotsAgainst: overrides.shotsAgainst ?? 1800,
  }
}

function archiveWith(
  state: RecordsState,
  year: number,
  lines: SeasonLine[],
  opts: {
    champion?: { teamId: string; name: string } | null
    presidentsName?: string | null
    userRank?: number
    awards?: Array<{ award: string; playerId: string; name: string; teamAbbr: string; value: string }>
  } = {},
) {
  return archiveSeason({
    state,
    year,
    champion: opts.champion ?? null,
    presidentsName: opts.presidentsName ?? null,
    userRank: opts.userRank ?? 5,
    seasonLines: lines,
    awards: opts.awards ?? [],
  })
}

/* ────────────────────────── emptyRecords ────────────────────────── */

describe('emptyRecords', () => {
  it('returns all empty boards', () => {
    const s = emptyRecords()
    expect(s.singleSeason.goals).toHaveLength(0)
    expect(s.singleSeason.assists).toHaveLength(0)
    expect(s.singleSeason.points).toHaveLength(0)
    expect(s.singleSeason.wins).toHaveLength(0)
    expect(s.singleSeason.savePct).toHaveLength(0)
    expect(s.career.goals).toHaveLength(0)
    expect(s.career.assists).toHaveLength(0)
    expect(s.career.points).toHaveLength(0)
    expect(s.career.gamesPlayed).toHaveLength(0)
    expect(s.seasons).toHaveLength(0)
    expect(s.awards).toHaveLength(0)
    expect(s.retiredLegends).toHaveLength(0)
    expect(s.emittedPaceKeys).toHaveLength(0)
  })

  it('is JSON-safe (round-trips through JSON.stringify)', () => {
    const s = emptyRecords()
    const rt = JSON.parse(JSON.stringify(s)) as RecordsState
    expect(rt).toEqual(s)
  })
})

/* ────────────────────────── archiveSeason — single-season boards ────────────────────────── */

describe('archiveSeason — single-season boards', () => {
  it('inserts goals into the board, best first', () => {
    const state = emptyRecords()
    archiveWith(state, 2001, [
      skaterLine({ playerId: 'p1', name: 'Alpha', goals: 45 }),
      skaterLine({ playerId: 'p2', name: 'Bravo', goals: 50 }),
      skaterLine({ playerId: 'p3', name: 'Charlie', goals: 40 }),
    ])
    expect(state.singleSeason.goals[0]!.value).toBe(50)
    expect(state.singleSeason.goals[1]!.value).toBe(45)
    expect(state.singleSeason.goals[2]!.value).toBe(40)
  })

  it('keeps only top 10 entries per board', () => {
    const state = emptyRecords()
    const lines = Array.from({ length: 15 }, (_, i) =>
      skaterLine({ playerId: `p${i}`, name: `P${i}`, goals: i + 1 }),
    )
    archiveWith(state, 2001, lines)
    expect(state.singleSeason.goals).toHaveLength(10)
    expect(state.singleSeason.goals[0]!.value).toBe(15)
    expect(state.singleSeason.goals[9]!.value).toBe(6)
  })

  it('accumulates across multiple seasons', () => {
    const state = emptyRecords()
    archiveWith(state, 2001, [
      skaterLine({ playerId: 'p1', name: 'A', goals: 40 }),
    ])
    archiveWith(state, 2002, [
      skaterLine({ playerId: 'p2', name: 'B', goals: 55 }),
    ])
    expect(state.singleSeason.goals[0]!.value).toBe(55)
    expect(state.singleSeason.goals[1]!.value).toBe(40)
  })

  it('qualifies goalie save-pct only when shotsAgainst >= 600', () => {
    const state = emptyRecords()
    archiveWith(state, 2001, [
      goalieLine({ playerId: 'g1', name: 'Goalie1', savePct: 0.950, shotsAgainst: 599 }),
      goalieLine({ playerId: 'g2', name: 'Goalie2', savePct: 0.920, shotsAgainst: 600 }),
    ])
    // g1 did NOT qualify (only 599 shots), g2 did
    expect(state.singleSeason.savePct).toHaveLength(1)
    expect(state.singleSeason.savePct[0]!.playerId).toBe('g2')
  })

  it('includes goalie wins on wins board', () => {
    const state = emptyRecords()
    archiveWith(state, 2001, [
      goalieLine({ playerId: 'g1', name: 'Goalie1', goalieWins: 44 }),
      goalieLine({ playerId: 'g2', name: 'Goalie2', goalieWins: 38 }),
    ])
    expect(state.singleSeason.wins[0]!.value).toBe(44)
    expect(state.singleSeason.wins[1]!.value).toBe(38)
  })

  it('skaters do not appear on goalie boards and vice versa', () => {
    const state = emptyRecords()
    archiveWith(state, 2001, [
      skaterLine({ playerId: 'p1', name: 'Skater', goals: 50 }),
      goalieLine({ playerId: 'g1', name: 'Goalie', goalieWins: 40, shotsAgainst: 1800 }),
    ])
    // wins board: only goalie
    expect(state.singleSeason.wins.every((e) => e.playerId === 'g1')).toBe(true)
    // goals board: only skater
    expect(state.singleSeason.goals.every((e) => e.playerId === 'p1')).toBe(true)
  })

  it('appends SeasonArchive with correct champion and leaders', () => {
    const state = emptyRecords()
    archiveWith(state, 2001, [
      skaterLine({ playerId: 'p1', name: 'Alpha', goals: 40, assists: 50, points: 90 }),
      skaterLine({ playerId: 'p2', name: 'Bravo', goals: 55, assists: 20, points: 75 }),
      goalieLine({ playerId: 'g1', name: 'Goalie', goalieWins: 44 }),
    ], {
      champion: { teamId: 'teamA', name: 'Team A' },
      presidentsName: 'Team B',
      userRank: 3,
    })
    expect(state.seasons).toHaveLength(1)
    const arch = state.seasons[0]!
    expect(arch.year).toBe(2001)
    expect(arch.championTeamId).toBe('teamA')
    expect(arch.championName).toBe('Team A')
    expect(arch.presidentsTeamName).toBe('Team B')
    expect(arch.userTeamRank).toBe(3)
    expect(arch.leaders.points!.playerId).toBe('p1')
    expect(arch.leaders.goals!.playerId).toBe('p2')
    expect(arch.leaders.wins!.playerId).toBe('g1')
  })

  it('appends awards to the awards list', () => {
    const state = emptyRecords()
    archiveWith(state, 2001, [], {
      awards: [
        { award: 'MVP', playerId: 'p1', name: 'Alpha', teamAbbr: 'TST', value: '90 PTS' },
      ],
    })
    expect(state.awards).toHaveLength(1)
    expect(state.awards[0]!.award).toBe('MVP')
    expect(state.awards[0]!.year).toBe(2001)
  })
})

/* ────────────────────────── archiveSeason — record-breaking news ────────────────────────── */

describe('archiveSeason — record-breaking news seeds', () => {
  it('emits news when a top-3 record is broken', () => {
    const state = emptyRecords()
    // Fill top-3 first
    archiveWith(state, 2001, [
      skaterLine({ playerId: 'p1', name: 'A', goals: 50 }),
      skaterLine({ playerId: 'p2', name: 'B', goals: 48 }),
      skaterLine({ playerId: 'p3', name: 'C', goals: 45 }),
    ])
    // Now a player betters the 3rd-place mark
    const result = archiveWith(state, 2002, [
      skaterLine({ playerId: 'p4', name: 'D', goals: 46 }),
    ])
    const goalNews = result.newsSeeds.filter((n) => n.headline.includes('goal'))
    expect(goalNews).toHaveLength(1)
  })

  it('does NOT emit news for a value below top-3', () => {
    const state = emptyRecords()
    archiveWith(state, 2001, [
      skaterLine({ playerId: 'p1', name: 'A', goals: 50 }),
      skaterLine({ playerId: 'p2', name: 'B', goals: 48 }),
      skaterLine({ playerId: 'p3', name: 'C', goals: 45 }),
    ])
    const result = archiveWith(state, 2002, [
      skaterLine({ playerId: 'p4', name: 'D', goals: 40 }),
    ])
    expect(result.newsSeeds.filter((n) => n.headline.includes('goal'))).toHaveLength(0)
  })

  it('marks it as all-time record when beating the top entry', () => {
    const state = emptyRecords()
    archiveWith(state, 2001, [
      skaterLine({ playerId: 'p1', name: 'A', goals: 50 }),
      skaterLine({ playerId: 'p2', name: 'B', goals: 48 }),
      skaterLine({ playerId: 'p3', name: 'C', goals: 45 }),
    ])
    const result = archiveWith(state, 2002, [
      skaterLine({ playerId: 'p4', name: 'D', goals: 61 }),
    ])
    const news = result.newsSeeds.find((n) => n.headline.includes('goal'))!
    expect(news.headline).toMatch(/all-time league record/)
  })

  it('mentions "top-3 league mark" for 2nd or 3rd-place breaks', () => {
    const state = emptyRecords()
    archiveWith(state, 2001, [
      skaterLine({ playerId: 'p1', name: 'A', goals: 60 }),
      skaterLine({ playerId: 'p2', name: 'B', goals: 55 }),
      skaterLine({ playerId: 'p3', name: 'C', goals: 50 }),
    ])
    const result = archiveWith(state, 2002, [
      skaterLine({ playerId: 'p4', name: 'D', goals: 52 }),
    ])
    const news = result.newsSeeds.find((n) => n.headline.includes('goal'))!
    expect(news.headline).toMatch(/top-3 league mark/)
  })

  it('news seed has correct category and playerId', () => {
    const state = emptyRecords()
    archiveWith(state, 2001, [
      skaterLine({ playerId: 'p1', name: 'A', goals: 50 }),
      skaterLine({ playerId: 'p2', name: 'B', goals: 48 }),
      skaterLine({ playerId: 'p3', name: 'C', goals: 45 }),
    ])
    const result = archiveWith(state, 2002, [
      skaterLine({ playerId: 'p4', name: 'D', goals: 52 }),
    ])
    const news = result.newsSeeds.find((n) => n.headline.includes('goal'))!
    expect(news.category).toBe('milestone')
    expect(news.playerId).toBe('p4')
  })
})

/* ────────────────────────── archiveSeason — career boards ────────────────────────── */

describe('archiveSeason — career accumulation', () => {
  it('accumulates goals/assists/points across multiple seasons for the same player', () => {
    const state = emptyRecords()
    archiveWith(state, 2001, [
      skaterLine({ playerId: 'p1', name: 'Gretzky', goals: 50, assists: 80, points: 130, gamesPlayed: 80 }),
    ])
    archiveWith(state, 2002, [
      skaterLine({ playerId: 'p1', name: 'Gretzky', goals: 45, assists: 70, points: 115, gamesPlayed: 80 }),
    ])
    const careerGoals = state.career.goals.find((e) => e.playerId === 'p1')!
    const careerAssists = state.career.assists.find((e) => e.playerId === 'p1')!
    const careerPoints = state.career.points.find((e) => e.playerId === 'p1')!
    const careerGames = state.career.gamesPlayed.find((e) => e.playerId === 'p1')!
    expect(careerGoals.value).toBe(95)
    expect(careerAssists.value).toBe(150)
    expect(careerPoints.value).toBe(245)
    expect(careerGames.value).toBe(160)
  })

  it('ranks career board best first', () => {
    const state = emptyRecords()
    // p1: 3 seasons of 30G each = 90G career
    // p2: 1 season of 50G = 50G career
    for (let y = 2001; y <= 2003; y++) {
      archiveWith(state, y, [
        skaterLine({ playerId: 'p1', name: 'A', goals: 30 }),
        skaterLine({ playerId: 'p2', name: 'B', goals: 50 / 3 }), // ~16 each year
      ])
    }
    expect(state.career.goals[0]!.playerId).toBe('p1')
  })

  it('career top-10 cap is maintained', () => {
    const state = emptyRecords()
    for (let i = 0; i < 15; i++) {
      archiveWith(state, 2001 + i, [
        skaterLine({ playerId: `p${i}`, name: `P${i}`, goals: i + 1 }),
      ])
    }
    expect(state.career.goals.length).toBeLessThanOrEqual(10)
  })

  it('goalies are NOT accumulated into career skater boards', () => {
    const state = emptyRecords()
    archiveWith(state, 2001, [
      goalieLine({ playerId: 'g1', name: 'Goalie', goalieWins: 40, shotsAgainst: 1800 }),
    ])
    expect(state.career.goals.find((e) => e.playerId === 'g1')).toBeUndefined()
    expect(state.career.points.find((e) => e.playerId === 'g1')).toBeUndefined()
  })
})

/* ────────────────────────── JSON round-trip ────────────────────────── */

describe('JSON round-trip', () => {
  it('full state round-trips through JSON.stringify / JSON.parse', () => {
    const state = emptyRecords()
    archiveWith(state, 2001, [
      skaterLine({ playerId: 'p1', name: 'Alpha', goals: 52, assists: 60, points: 112 }),
      goalieLine({ playerId: 'g1', name: 'Goalie', goalieWins: 40, savePct: 0.921, shotsAgainst: 1800 }),
    ], {
      champion: { teamId: 'T1', name: 'Team One' },
      awards: [{ award: 'MVP', playerId: 'p1', name: 'Alpha', teamAbbr: 'TST', value: '112 PTS' }],
    })
    registerRetirements({
      state,
      retirees: [{ playerId: 'p1', name: 'Alpha', careerGoals: 52, careerAssists: 60, careerPoints: 112, careerGames: 82 }],
      year: 2002,
    })
    const rt = JSON.parse(JSON.stringify(state)) as RecordsState
    expect(rt).toEqual(state)
    expect(rt.singleSeason.goals[0]!.value).toBe(52)
    expect(rt.seasons[0]!.championTeamId).toBe('T1')
    expect(rt.retiredLegends[0]!.careerPoints).toBe(112)
  })
})

/* ────────────────────────── recordWatch ────────────────────────── */

describe('recordWatch', () => {
  function buildStateWithTopThree(): RecordsState {
    const state = emptyRecords()
    archiveWith(state, 2001, [
      skaterLine({ playerId: 'p1', name: 'A', goals: 60 }),
      skaterLine({ playerId: 'p2', name: 'B', goals: 55 }),
      skaterLine({ playerId: 'p3', name: 'C', goals: 50 }),
    ])
    return state
  }

  it('emits news when a player is on pace to beat top-3', () => {
    const state = buildStateWithTopThree()
    // Player with 30 goals and 5 assists (35 points) in 40 of 82 games
    // goals pace = (30/40)*82 = 61.5 > 50 (3rd on goals board) → fires
    // points pace = (35/40)*82 = 71.75 > 50 (3rd on points board) → also fires
    // assists pace = (5/40)*82 = 10.25 < 50 (3rd on assists board) → no fire
    // Test that at least the goals alert fires with the right player
    const result = recordWatch({
      state,
      seasonLines: [skaterLine({ playerId: 'pX', name: 'Rocket', goals: 30, assists: 5, points: 35, gamesPlayed: 40 })],
      year: 2002,
      teamGamesPlayed: 40,
      totalSeasonGames: 82,
    })
    const goalNews = result.newsSeeds.filter((n) => n.headline.includes('goal'))
    expect(goalNews).toHaveLength(1)
    expect(goalNews[0]!.headline).toMatch(/pace/)
    expect(goalNews[0]!.playerId).toBe('pX')
  })

  it('does NOT emit when fewer than 30 team games played', () => {
    const state = buildStateWithTopThree()
    const result = recordWatch({
      state,
      seasonLines: [skaterLine({ playerId: 'pX', name: 'Rocket', goals: 25 })],
      year: 2002,
      teamGamesPlayed: 29,
      totalSeasonGames: 82,
    })
    expect(result.newsSeeds).toHaveLength(0)
  })

  it('emits at most ONCE per player-stat-year combination', () => {
    const state = buildStateWithTopThree()
    const line = skaterLine({ playerId: 'pX', name: 'Rocket', goals: 30 })

    recordWatch({ state, seasonLines: [line], year: 2002, teamGamesPlayed: 40, totalSeasonGames: 82 })
    const second = recordWatch({ state, seasonLines: [line], year: 2002, teamGamesPlayed: 45, totalSeasonGames: 82 })
    expect(second.newsSeeds).toHaveLength(0)
  })

  it('emits again in a different year', () => {
    // Only goals pace fires (goals=30, assists=0, so points=30 which projects to 61.5 too)
    // Use assists only so exactly one stat fires
    // Actually rebuild with only goals board filled to top-3, leave assists/points empty
    const stateGoalsOnly = emptyRecords()
    archiveWith(stateGoalsOnly, 2001, [
      skaterLine({ playerId: 'p1', name: 'A', goals: 60, assists: 0, points: 60 }),
      skaterLine({ playerId: 'p2', name: 'B', goals: 55, assists: 0, points: 55 }),
      skaterLine({ playerId: 'p3', name: 'C', goals: 50, assists: 0, points: 50 }),
    ])
    // goals pace: (30/40)*82=61.5 > 50 (3rd) → fire goals
    // points pace: same as goals since no assists
    // Ensure 'once per key' logic: fire goals+points in year 2002
    const mkLine = () => skaterLine({ playerId: 'pX', name: 'Rocket', goals: 30, assists: 0, points: 30 })
    recordWatch({ state: stateGoalsOnly, seasonLines: [mkLine()], year: 2002, teamGamesPlayed: 40, totalSeasonGames: 82 })
    // In year 2003 the keys are different (different year), should fire again
    const second = recordWatch({ state: stateGoalsOnly, seasonLines: [mkLine()], year: 2003, teamGamesPlayed: 40, totalSeasonGames: 82 })
    // goals + points should both fire again in 2003
    expect(second.newsSeeds.length).toBeGreaterThanOrEqual(1)
    expect(second.newsSeeds.every((n) => n.playerId === 'pX')).toBe(true)
  })

  it('does NOT emit when pace is below top-3', () => {
    const state = buildStateWithTopThree()
    // pace = (20/40)*82 = 41 goals, below 50 (3rd)
    const result = recordWatch({
      state,
      seasonLines: [skaterLine({ playerId: 'pX', name: 'Rocket', goals: 20 })],
      year: 2002,
      teamGamesPlayed: 40,
      totalSeasonGames: 82,
    })
    expect(result.newsSeeds).toHaveLength(0)
  })

  it('does NOT emit when fewer than 3 entries on the board', () => {
    const state = emptyRecords()
    archiveWith(state, 2001, [
      skaterLine({ playerId: 'p1', name: 'A', goals: 60 }),
      skaterLine({ playerId: 'p2', name: 'B', goals: 55 }),
    ])
    // Board only has 2 entries — no top-3 threshold to beat
    const result = recordWatch({
      state,
      seasonLines: [skaterLine({ playerId: 'pX', name: 'Rocket', goals: 56 })],
      year: 2002,
      teamGamesPlayed: 40,
      totalSeasonGames: 82,
    })
    expect(result.newsSeeds).toHaveLength(0)
  })

  it('tracks goalie wins pace', () => {
    const state = emptyRecords()
    archiveWith(state, 2001, [
      goalieLine({ playerId: 'g1', name: 'A', goalieWins: 44 }),
      goalieLine({ playerId: 'g2', name: 'B', goalieWins: 42 }),
      goalieLine({ playerId: 'g3', name: 'C', goalieWins: 40 }),
    ])
    // pace for goalie: 22 wins in 40 games → (22/40)*82 = 45.1 wins > 40
    const result = recordWatch({
      state,
      seasonLines: [goalieLine({ playerId: 'gX', name: 'Hotshot', goalieWins: 22, shotsAgainst: 1200 })],
      year: 2002,
      teamGamesPlayed: 40,
      totalSeasonGames: 82,
    })
    const winsNews = result.newsSeeds.filter((n) => n.headline.includes('win'))
    expect(winsNews).toHaveLength(1)
  })

  it('is deterministic: same inputs produce same output', () => {
    const s1 = emptyRecords()
    const s2 = emptyRecords()
    const lines = [skaterLine({ playerId: 'p1', name: 'A', goals: 50 }),
      skaterLine({ playerId: 'p2', name: 'B', goals: 48 }),
      skaterLine({ playerId: 'p3', name: 'C', goals: 45 })]
    archiveWith(s1, 2001, lines)
    archiveWith(s2, 2001, lines)

    const r1 = recordWatch({ state: s1, seasonLines: [skaterLine({ playerId: 'pX', name: 'R', goals: 25 })], year: 2002, teamGamesPlayed: 40, totalSeasonGames: 82 })
    const r2 = recordWatch({ state: s2, seasonLines: [skaterLine({ playerId: 'pX', name: 'R', goals: 25 })], year: 2002, teamGamesPlayed: 40, totalSeasonGames: 82 })
    expect(r1.newsSeeds).toEqual(r2.newsSeeds)
  })
})

/* ────────────────────────── registerRetirements ────────────────────────── */

describe('registerRetirements', () => {
  it('adds a legend when career points exceed threshold (400)', () => {
    const state = emptyRecords()
    const result = registerRetirements({
      state,
      retirees: [{ playerId: 'p1', name: 'Legend', careerGoals: 200, careerAssists: 210, careerPoints: 410, careerGames: 900 }],
      year: 2010,
    })
    expect(state.retiredLegends).toHaveLength(1)
    expect(state.retiredLegends[0]!.name).toBe('Legend')
    expect(state.retiredLegends[0]!.hallOfFame).toBe(false)
    expect(result.newsSeeds).toHaveLength(1)
    expect(result.newsSeeds[0]!.category).toBe('league')
  })

  it('does NOT add a player below threshold who is not on any career board', () => {
    const state = emptyRecords()
    const result = registerRetirements({
      state,
      retirees: [{ playerId: 'p1', name: 'Bench', careerGoals: 10, careerAssists: 10, careerPoints: 20, careerGames: 100 }],
      year: 2010,
    })
    expect(state.retiredLegends).toHaveLength(0)
    expect(result.newsSeeds).toHaveLength(0)
  })

  it('adds a legend who is on the career top-10 board even below points threshold', () => {
    const state = emptyRecords()
    // Manually insert the player onto the career points board
    state.career.points.push({ value: 350, playerId: 'p1', playerName: 'BoardGuy', teamAbbr: 'TST', year: 2005 })
    const result = registerRetirements({
      state,
      retirees: [{ playerId: 'p1', name: 'BoardGuy', careerGoals: 100, careerAssists: 250, careerPoints: 350, careerGames: 800 }],
      year: 2010,
    })
    expect(state.retiredLegends).toHaveLength(1)
    expect(result.newsSeeds).toHaveLength(1)
  })

  it('does not add duplicate legend entries', () => {
    const state = emptyRecords()
    registerRetirements({
      state,
      retirees: [{ playerId: 'p1', name: 'Legend', careerGoals: 200, careerAssists: 210, careerPoints: 410, careerGames: 900 }],
      year: 2010,
    })
    const second = registerRetirements({
      state,
      retirees: [{ playerId: 'p1', name: 'Legend', careerGoals: 200, careerAssists: 210, careerPoints: 410, careerGames: 900 }],
      year: 2011,
    })
    expect(state.retiredLegends).toHaveLength(1)
    expect(second.newsSeeds).toHaveLength(0)
  })

  it('includes career stats in news body', () => {
    const state = emptyRecords()
    const result = registerRetirements({
      state,
      retirees: [{ playerId: 'p1', name: 'Legend', careerGoals: 400, careerAssists: 500, careerPoints: 900, careerGames: 1200 }],
      year: 2010,
    })
    expect(result.newsSeeds[0]!.body).toMatch(/1200 games/)
    expect(result.newsSeeds[0]!.body).toMatch(/400 goals/)
  })

  it('mentions awards in retirement news body when present', () => {
    const state = emptyRecords()
    state.awards.push({ year: 2005, award: 'MVP', playerId: 'p1', playerName: 'Legend', teamAbbr: 'TST', value: '90 PTS' })
    const result = registerRetirements({
      state,
      retirees: [{ playerId: 'p1', name: 'Legend', careerGoals: 200, careerAssists: 210, careerPoints: 410, careerGames: 900 }],
      year: 2010,
    })
    expect(result.newsSeeds[0]!.body).toMatch(/MVP/)
  })
})

/* ────────────────────────── inductHallOfFame ────────────────────────── */

describe('inductHallOfFame', () => {
  it('inducts a legend exactly 3 seasons after retirement', () => {
    const state = emptyRecords()
    registerRetirements({
      state,
      retirees: [{ playerId: 'p1', name: 'Legend', careerGoals: 200, careerAssists: 210, careerPoints: 410, careerGames: 900 }],
      year: 2010,
    })
    // No induction in 2011 or 2012
    expect(inductHallOfFame(state, 2011)).toHaveLength(0)
    expect(inductHallOfFame(state, 2012)).toHaveLength(0)
    // Inducted in 2013 (2010 + 3)
    const seeds = inductHallOfFame(state, 2013)
    expect(seeds).toHaveLength(1)
    expect(seeds[0]!.category).toBe('award')
    expect(seeds[0]!.headline).toMatch(/Hall of Fame/)
    expect(seeds[0]!.playerId).toBe('p1')
  })

  it('sets hallOfFame = true after induction', () => {
    const state = emptyRecords()
    registerRetirements({
      state,
      retirees: [{ playerId: 'p1', name: 'Legend', careerGoals: 200, careerAssists: 210, careerPoints: 410, careerGames: 900 }],
      year: 2010,
    })
    inductHallOfFame(state, 2013)
    expect(state.retiredLegends[0]!.hallOfFame).toBe(true)
  })

  it('does not re-induct an already inducted legend', () => {
    const state = emptyRecords()
    registerRetirements({
      state,
      retirees: [{ playerId: 'p1', name: 'Legend', careerGoals: 200, careerAssists: 210, careerPoints: 410, careerGames: 900 }],
      year: 2010,
    })
    inductHallOfFame(state, 2013)
    const second = inductHallOfFame(state, 2013)
    expect(second).toHaveLength(0)
  })

  it('induction body mentions career stats and retirement year', () => {
    const state = emptyRecords()
    registerRetirements({
      state,
      retirees: [{ playerId: 'p1', name: 'Legend', careerGoals: 220, careerAssists: 310, careerPoints: 530, careerGames: 980 }],
      year: 2010,
    })
    const seeds = inductHallOfFame(state, 2013)
    const body = seeds[0]!.body
    expect(body).toMatch(/980 GP/)
    expect(body).toMatch(/220 G/)
    expect(body).toMatch(/530 PTS/)
    expect(body).toMatch(/2010/)  // retired year
  })

  it('induction body mentions awards when present', () => {
    const state = emptyRecords()
    state.awards.push({ year: 2008, award: 'MVP', playerId: 'p1', playerName: 'Legend', teamAbbr: 'TST', value: '100 PTS' })
    registerRetirements({
      state,
      retirees: [{ playerId: 'p1', name: 'Legend', careerGoals: 200, careerAssists: 210, careerPoints: 410, careerGames: 900 }],
      year: 2010,
    })
    const seeds = inductHallOfFame(state, 2013)
    expect(seeds[0]!.body).toMatch(/MVP/)
  })

  it('induction body mentions all-time records when held', () => {
    const state = emptyRecords()
    // Make p1 the all-time career points leader
    state.career.points.push({ value: 900, playerId: 'p1', playerName: 'Legend', teamAbbr: 'TST', year: 2008 })
    registerRetirements({
      state,
      retirees: [{ playerId: 'p1', name: 'Legend', careerGoals: 200, careerAssists: 210, careerPoints: 410, careerGames: 900 }],
      year: 2010,
    })
    const seeds = inductHallOfFame(state, 2013)
    expect(seeds[0]!.body).toMatch(/career points leader/)
  })

  it('handles multiple legends retiring in the same year', () => {
    const state = emptyRecords()
    registerRetirements({
      state,
      retirees: [
        { playerId: 'p1', name: 'Legend1', careerGoals: 200, careerAssists: 210, careerPoints: 410, careerGames: 900 },
        { playerId: 'p2', name: 'Legend2', careerGoals: 180, careerAssists: 250, careerPoints: 430, careerGames: 950 },
      ],
      year: 2010,
    })
    const seeds = inductHallOfFame(state, 2013)
    expect(seeds).toHaveLength(2)
  })
})

/* ────────────────────────── full multi-season integration ────────────────────────── */

describe('multi-season integration', () => {
  it('10-season career arc: records accumulate, pace fires, HoF inducts', () => {
    const state = emptyRecords()

    // Sim 10 seasons with a dominant player p1 and a goalie g1
    for (let y = 2001; y <= 2010; y++) {
      archiveWith(state, y, [
        skaterLine({ playerId: 'p1', name: 'Gretzky2', goals: 52 - y % 5, assists: 80 - y % 5, points: 132 - (y % 5) * 2, gamesPlayed: 82 }),
        skaterLine({ playerId: 'p2', name: 'Other', goals: 35, assists: 40, points: 75, gamesPlayed: 82 }),
        goalieLine({ playerId: 'g1', name: 'Brodeur2', goalieWins: 42, savePct: 0.920, shotsAgainst: 1800 }),
      ], {
        champion: { teamId: 'T1', name: 'Team One' },
        userRank: 1,
        awards: [{ award: 'MVP', playerId: 'p1', name: 'Gretzky2', teamAbbr: 'TST', value: `${132 - (y % 5) * 2} PTS` }],
      })
    }

    // p1 should be leading career points
    const careerLeader = state.career.points[0]!
    expect(careerLeader.playerId).toBe('p1')

    // g1 should be on goalie wins board
    expect(state.singleSeason.wins.some((e) => e.playerId === 'g1')).toBe(true)

    // Awards accumulated
    expect(state.awards.filter((a) => a.playerId === 'p1').length).toBe(10)

    // Retire p1 and verify legend + HoF
    registerRetirements({
      state,
      retirees: [{ playerId: 'p1', name: 'Gretzky2', careerGoals: careerLeader.value, careerAssists: 0, careerPoints: careerLeader.value, careerGames: 820 }],
      year: 2011,
    })
    expect(state.retiredLegends).toHaveLength(1)

    // HoF in 2014 (2011 + 3)
    expect(inductHallOfFame(state, 2013)).toHaveLength(0)
    const hof = inductHallOfFame(state, 2014)
    expect(hof).toHaveLength(1)
    expect(state.retiredLegends[0]!.hallOfFame).toBe(true)
  })
})
