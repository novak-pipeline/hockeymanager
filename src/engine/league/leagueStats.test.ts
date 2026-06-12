/**
 * Tests for leagueStats.ts — special-teams accumulation, transaction ledger,
 * and daily scoreboard.
 */

import { describe, it, expect } from 'vitest'
import {
  accumulateSpecialTeams,
  finalizeSpecialTeams,
  emptyLedger,
  recordTransaction,
  buildScoreboard,
  type SpecialTeamsEntries,
} from './leagueStats'
import type { GameOutcome } from '@engine/shared/outcome'
import type { ScheduledGame } from '@domain'

/* ────────────────────────── helpers ────────────────────────── */

function makeOutcome(overrides: Partial<GameOutcome> = {}): GameOutcome {
  return {
    homeTeamId: 'home',
    awayTeamId: 'away',
    homeGoals: 0,
    awayGoals: 0,
    decidedBy: 'regulation',
    stream: [],
    playerStats: new Map(),
    ...overrides,
  }
}

const HOME = 'team-home'
const AWAY = 'team-away'

function penaltyEvent(team: 'home' | 'away', t = 100) {
  return {
    type: 'penalty' as const,
    t,
    period: 1,
    player: { id: 'p1', team },
    infraction: 'hooking',
    minutes: 2,
  }
}

function ppGoalEvent(scoringTeam: 'home' | 'away', t = 200) {
  return {
    type: 'goal' as const,
    t,
    period: 1,
    scorer: { id: 'p2', team: scoringTeam },
    assists: [],
    strength: 'pp' as const,
    pos: { x: 0, y: 0 },
  }
}

function evGoalEvent(scoringTeam: 'home' | 'away', t = 200) {
  return {
    type: 'goal' as const,
    t,
    period: 1,
    scorer: { id: 'p2', team: scoringTeam },
    assists: [],
    strength: 'ev' as const,
    pos: { x: 0, y: 0 },
  }
}

/* ────────────────────────── special teams ────────────────────────── */

describe('accumulateSpecialTeams', () => {
  it('starts from empty entries and counts a PP opportunity and shorthanded situation', () => {
    const outcome = makeOutcome({
      stream: [penaltyEvent('away')], // away takes penalty → home gets PP, away goes SH
    })
    const result = accumulateSpecialTeams({
      existing: [],
      outcome,
      homeTeamId: HOME,
      awayTeamId: AWAY,
    })
    const map = new Map(result)
    expect(map.get(HOME)?.ppOpp).toBe(1)
    expect(map.get(HOME)?.shTimes).toBe(0)
    expect(map.get(AWAY)?.shTimes).toBe(1)
    expect(map.get(AWAY)?.ppOpp).toBe(0)
  })

  it('credits a PP goal to the scoring team and marks ppGoalsAgainst for the penalised team', () => {
    const outcome = makeOutcome({
      stream: [
        penaltyEvent('away'), // away takes penalty, home on PP
        ppGoalEvent('home'),  // home scores on the PP
      ],
    })
    const result = accumulateSpecialTeams({
      existing: [],
      outcome,
      homeTeamId: HOME,
      awayTeamId: AWAY,
    })
    const map = new Map(result)
    expect(map.get(HOME)?.ppGoals).toBe(1)
    expect(map.get(AWAY)?.ppGoalsAgainst).toBe(1)
    // Away was short once and conceded one — pkKills = 0
    expect(map.get(AWAY)?.pkKills).toBe(0)
  })

  it('counts a killed penalty when no PP goal is scored', () => {
    const outcome = makeOutcome({
      stream: [
        penaltyEvent('home'), // home takes penalty, away on PP, no goal → PK kill for home
      ],
    })
    const result = accumulateSpecialTeams({
      existing: [],
      outcome,
      homeTeamId: HOME,
      awayTeamId: AWAY,
    })
    const map = new Map(result)
    expect(map.get(HOME)?.shTimes).toBe(1)
    expect(map.get(HOME)?.pkKills).toBe(1)
    expect(map.get(HOME)?.ppGoalsAgainst).toBe(0)
  })

  it('does not count even-strength goals as PP goals', () => {
    const outcome = makeOutcome({
      stream: [evGoalEvent('home')],
    })
    const result = accumulateSpecialTeams({
      existing: [],
      outcome,
      homeTeamId: HOME,
      awayTeamId: AWAY,
    })
    const map = new Map(result)
    expect(map.get(HOME)?.ppGoals ?? 0).toBe(0)
  })

  it('accumulates across multiple games by merging into existing entries', () => {
    // Game 1: home takes penalty, away scores on PP
    const outcome1 = makeOutcome({
      stream: [penaltyEvent('home'), ppGoalEvent('away')],
    })
    const after1 = accumulateSpecialTeams({
      existing: [],
      outcome: outcome1,
      homeTeamId: HOME,
      awayTeamId: AWAY,
    })

    // Game 2: away takes penalty, home kills it
    const outcome2 = makeOutcome({
      stream: [penaltyEvent('away')],
    })
    const after2 = accumulateSpecialTeams({
      existing: after1,
      outcome: outcome2,
      homeTeamId: HOME,
      awayTeamId: AWAY,
    })

    const map = new Map(after2)
    // Home: was SH once (conceded), then on PP once (killed)
    expect(map.get(HOME)?.shTimes).toBe(1)
    expect(map.get(HOME)?.ppGoalsAgainst).toBe(1)
    expect(map.get(HOME)?.pkKills).toBe(0)
    expect(map.get(HOME)?.ppOpp).toBe(1)
    expect(map.get(HOME)?.ppGoals).toBe(0)

    // Away: was on PP once (scored), then was SH once (killed)
    expect(map.get(AWAY)?.ppGoals).toBe(1)
    expect(map.get(AWAY)?.ppOpp).toBe(1)
    expect(map.get(AWAY)?.shTimes).toBe(1)
    expect(map.get(AWAY)?.pkKills).toBe(1)
  })

  it('is non-destructive — does not mutate the input entries', () => {
    const existing: SpecialTeamsEntries = [[HOME, { ppGoals: 2, ppOpp: 5, pkKills: 3, shTimes: 4, ppGoalsAgainst: 1 }]]
    const original = JSON.stringify(existing)
    accumulateSpecialTeams({
      existing,
      outcome: makeOutcome({ stream: [penaltyEvent('home')] }),
      homeTeamId: HOME,
      awayTeamId: AWAY,
    })
    expect(JSON.stringify(existing)).toBe(original)
  })
})

describe('finalizeSpecialTeams', () => {
  it('computes PP% correctly', () => {
    const entries: SpecialTeamsEntries = [
      [HOME, { ppGoals: 3, ppOpp: 10, pkKills: 8, shTimes: 10, ppGoalsAgainst: 2 }],
    ]
    const [row] = finalizeSpecialTeams(entries)
    expect(row.ppPct).toBeCloseTo(0.3)
  })

  it('returns 0 PP% when there are no PP opportunities (divide-by-zero guard)', () => {
    const entries: SpecialTeamsEntries = [
      [HOME, { ppGoals: 0, ppOpp: 0, pkKills: 0, shTimes: 0, ppGoalsAgainst: 0 }],
    ]
    const [row] = finalizeSpecialTeams(entries)
    expect(row.ppPct).toBe(0)
    expect(row.pkPct).toBe(0)
  })

  it('computes PK% correctly', () => {
    const entries: SpecialTeamsEntries = [
      [HOME, { ppGoals: 0, ppOpp: 0, pkKills: 7, shTimes: 10, ppGoalsAgainst: 3 }],
    ]
    const [row] = finalizeSpecialTeams(entries)
    expect(row.pkPct).toBeCloseTo(0.7)
    expect(row.timesShorthanded).toBe(10)
  })

  it('sorts by PP% descending', () => {
    const entries: SpecialTeamsEntries = [
      ['t1', { ppGoals: 1, ppOpp: 10, pkKills: 8, shTimes: 10, ppGoalsAgainst: 2 }],
      ['t2', { ppGoals: 4, ppOpp: 10, pkKills: 7, shTimes: 10, ppGoalsAgainst: 3 }],
      ['t3', { ppGoals: 2, ppOpp: 10, pkKills: 9, shTimes: 10, ppGoalsAgainst: 1 }],
    ]
    const result = finalizeSpecialTeams(entries)
    expect(result[0].teamId).toBe('t2')
    expect(result[1].teamId).toBe('t3')
    expect(result[2].teamId).toBe('t1')
  })

  it('round-trips through JSON serialization', () => {
    const entries: SpecialTeamsEntries = [
      [HOME, { ppGoals: 3, ppOpp: 10, pkKills: 8, shTimes: 10, ppGoalsAgainst: 2 }],
      [AWAY, { ppGoals: 2, ppOpp: 8, pkKills: 6, shTimes: 8, ppGoalsAgainst: 2 }],
    ]
    const before = finalizeSpecialTeams(entries)
    const json = JSON.stringify(before)
    const after = JSON.parse(json)
    expect(after).toEqual(before)
  })

  it('includes all required fields in output', () => {
    const entries: SpecialTeamsEntries = [
      [HOME, { ppGoals: 2, ppOpp: 8, pkKills: 6, shTimes: 8, ppGoalsAgainst: 2 }],
    ]
    const [row] = finalizeSpecialTeams(entries)
    expect(typeof row.teamId).toBe('string')
    expect(typeof row.ppGoals).toBe('number')
    expect(typeof row.ppOpportunities).toBe('number')
    expect(typeof row.ppPct).toBe('number')
    expect(typeof row.pkKills).toBe('number')
    expect(typeof row.timesShorthanded).toBe('number')
    expect(typeof row.pkPct).toBe('number')
  })
})

/* ────────────────────────── full pipeline: accumulate → finalize ────────────────────────── */

describe('special teams pipeline (accumulate + finalize)', () => {
  it('computes correct PP% and PK% from a multi-game stream', () => {
    // Scenario:
    //  Game A: away takes 2 penalties, home scores 1 PP goal (home 1/2 PP, away 0/1 kills)
    //  Game B: home takes 1 penalty, away scores 1 PP goal (home 0/1 kills, away 1/1 PP)
    const gameA = makeOutcome({
      stream: [
        penaltyEvent('away', 100),
        ppGoalEvent('home', 200),  // home scores one PP goal
        penaltyEvent('away', 300), // second penalty, home kills it (no pp goal)
      ],
    })
    const gameB = makeOutcome({
      stream: [
        penaltyEvent('home', 100),
        ppGoalEvent('away', 200), // away scores one PP goal
      ],
    })

    const after1 = accumulateSpecialTeams({ existing: [], outcome: gameA, homeTeamId: HOME, awayTeamId: AWAY })
    const after2 = accumulateSpecialTeams({ existing: after1, outcome: gameB, homeTeamId: HOME, awayTeamId: AWAY })
    const final = finalizeSpecialTeams(after2)
    const homeRow = final.find((r) => r.teamId === HOME)!
    const awayRow = final.find((r) => r.teamId === AWAY)!

    // Home: 1 PP goal in 2 PP opps = 50%
    expect(homeRow.ppGoals).toBe(1)
    expect(homeRow.ppOpportunities).toBe(2)
    expect(homeRow.ppPct).toBeCloseTo(0.5)

    // Home: was SH once, conceded 1 PP goal → 0 kills
    expect(homeRow.timesShorthanded).toBe(1)
    expect(homeRow.pkKills).toBe(0)
    expect(homeRow.pkPct).toBe(0)

    // Away: 1 PP goal in 1 PP opp = 100%
    expect(awayRow.ppGoals).toBe(1)
    expect(awayRow.ppOpportunities).toBe(1)
    expect(awayRow.ppPct).toBeCloseTo(1.0)

    // Away: was SH twice, conceded 1 PP goal → 1 kill = 50% PK
    expect(awayRow.timesShorthanded).toBe(2)
    expect(awayRow.pkKills).toBe(1)
    expect(awayRow.pkPct).toBeCloseTo(0.5)
  })
})

/* ────────────────────────── transaction ledger ────────────────────────── */

describe('emptyLedger', () => {
  it('returns an empty ledger with counter=0', () => {
    const ledger = emptyLedger()
    expect(ledger.items).toHaveLength(0)
    expect(ledger.counter).toBe(0)
  })

  it('is JSON-safe', () => {
    const ledger = emptyLedger()
    expect(JSON.parse(JSON.stringify(ledger))).toEqual(ledger)
  })
})

describe('recordTransaction', () => {
  it('adds a transaction and increments the counter', () => {
    const ledger = emptyLedger()
    const { ledger: l2, transaction } = recordTransaction(ledger, {
      day: 42,
      year: 2026,
      kind: 'signing',
      teamIds: ['t1'],
      summary: 'Player A signed',
    })
    expect(l2.items).toHaveLength(1)
    expect(l2.counter).toBe(1)
    expect(transaction.id).toMatch(/^tx-2026-/)
    expect(transaction.day).toBe(42)
    expect(transaction.year).toBe(2026)
    expect(transaction.kind).toBe('signing')
    expect(transaction.summary).toBe('Player A signed')
  })

  it('is non-destructive — does not mutate the input ledger', () => {
    const ledger = emptyLedger()
    const snapshot = JSON.stringify(ledger)
    recordTransaction(ledger, { day: 1, year: 2026, kind: 'trade', teamIds: ['t1', 't2'], summary: 'Deal done' })
    expect(JSON.stringify(ledger)).toBe(snapshot)
  })

  it('generates unique IDs for multiple transactions', () => {
    let ledger = emptyLedger()
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      const { ledger: next, transaction } = recordTransaction(ledger, {
        day: i,
        year: 2026,
        kind: 'callup',
        teamIds: ['t1'],
        summary: `Callup ${i}`,
      })
      ids.push(transaction.id)
      ledger = next
    }
    expect(new Set(ids).size).toBe(5)
    expect(ledger.counter).toBe(5)
  })

  it('prunes to MAX_LEDGER_SIZE (300) oldest entries first', () => {
    let ledger = emptyLedger()
    for (let i = 0; i < 305; i++) {
      const { ledger: next } = recordTransaction(ledger, {
        day: i % 100,
        year: 2026,
        kind: 'waiver',
        teamIds: ['t1'],
        summary: `Waiver ${i}`,
      })
      ledger = next
    }
    expect(ledger.items).toHaveLength(300)
    expect(ledger.counter).toBe(305)
    // The first 5 entries (counter 1–5) should have been pruned.
    expect(ledger.items[0].id).toBe('tx-2026-000006')
    expect(ledger.items[299].id).toBe('tx-2026-000305')
  })

  it('round-trips the ledger through JSON', () => {
    let ledger = emptyLedger()
    ;({ ledger } = recordTransaction(ledger, { day: 1, year: 2026, kind: 'draft', teamIds: ['t1'], summary: 'Pick made' }))
    ;({ ledger } = recordTransaction(ledger, { day: 2, year: 2026, kind: 'release', teamIds: ['t2'], summary: 'Cut' }))
    const restored = JSON.parse(JSON.stringify(ledger))
    expect(restored).toEqual(ledger)
  })

  it('stores a copy of teamIds (no shared references)', () => {
    const teamIds = ['t1', 't2']
    const { ledger } = recordTransaction(emptyLedger(), { day: 1, year: 2026, kind: 'trade', teamIds, summary: 'Deal' })
    teamIds.push('mutated')
    expect(ledger.items[0].teamIds).toHaveLength(2)
  })
})

/* ────────────────────────── daily scoreboard ────────────────────────── */

function makeSchedule(games: Array<{
  id: string
  day: number
  homeTeamId: string
  awayTeamId: string
  result?: { homeGoals: number; awayGoals: number; decidedBy: 'regulation' | 'overtime' | 'shootout' }
}>): ScheduledGame[] {
  return games.map((g) => ({
    id: g.id,
    season: 2026,
    day: g.day,
    homeTeamId: g.homeTeamId,
    awayTeamId: g.awayTeamId,
    result: g.result ?? null,
  }))
}

const teamAbbrs: Record<string, string> = {
  t1: 'AAA',
  t2: 'BBB',
  t3: 'CCC',
  t4: 'DDD',
}
const abbr = (id: string) => teamAbbrs[id] ?? id
const name = (id: string) => id

describe('buildScoreboard', () => {
  it('returns only games on the requested day', () => {
    const schedule = makeSchedule([
      { id: 'g1', day: 5, homeTeamId: 't1', awayTeamId: 't2' },
      { id: 'g2', day: 5, homeTeamId: 't3', awayTeamId: 't4' },
      { id: 'g3', day: 6, homeTeamId: 't1', awayTeamId: 't3' },
    ])
    const board = buildScoreboard({ schedule, day: 5, teamName: name, teamAbbr: abbr })
    expect(board).toHaveLength(2)
    expect(board.map((e) => e.gameId)).toEqual(['g1', 'g2'])
  })

  it('marks completed games as final with correct scores', () => {
    const schedule = makeSchedule([
      {
        id: 'g1',
        day: 5,
        homeTeamId: 't1',
        awayTeamId: 't2',
        result: { homeGoals: 3, awayGoals: 1, decidedBy: 'regulation' },
      },
    ])
    const [entry] = buildScoreboard({ schedule, day: 5, teamName: name, teamAbbr: abbr })
    expect(entry.final).toBe(true)
    expect(entry.homeGoals).toBe(3)
    expect(entry.awayGoals).toBe(1)
    expect(entry.homeAbbr).toBe('AAA')
    expect(entry.awayAbbr).toBe('BBB')
  })

  it('marks pending games as non-final with 0–0 scores', () => {
    const schedule = makeSchedule([
      { id: 'g1', day: 5, homeTeamId: 't1', awayTeamId: 't2' },
    ])
    const [entry] = buildScoreboard({ schedule, day: 5, teamName: name, teamAbbr: abbr })
    expect(entry.final).toBe(false)
    expect(entry.homeGoals).toBe(0)
    expect(entry.awayGoals).toBe(0)
  })

  it('returns empty array when no games are scheduled on that day', () => {
    const schedule = makeSchedule([
      { id: 'g1', day: 10, homeTeamId: 't1', awayTeamId: 't2' },
    ])
    const board = buildScoreboard({ schedule, day: 5, teamName: name, teamAbbr: abbr })
    expect(board).toHaveLength(0)
  })

  it('is deterministic — same input produces same output', () => {
    const schedule = makeSchedule([
      { id: 'g1', day: 3, homeTeamId: 't1', awayTeamId: 't2', result: { homeGoals: 2, awayGoals: 2, decidedBy: 'overtime' } },
      { id: 'g2', day: 3, homeTeamId: 't3', awayTeamId: 't4' },
    ])
    const a = buildScoreboard({ schedule, day: 3, teamName: name, teamAbbr: abbr })
    const b = buildScoreboard({ schedule, day: 3, teamName: name, teamAbbr: abbr })
    expect(a).toEqual(b)
  })

  it('round-trips through JSON', () => {
    const schedule = makeSchedule([
      { id: 'g1', day: 5, homeTeamId: 't1', awayTeamId: 't2', result: { homeGoals: 4, awayGoals: 2, decidedBy: 'regulation' } },
    ])
    const board = buildScoreboard({ schedule, day: 5, teamName: name, teamAbbr: abbr })
    expect(JSON.parse(JSON.stringify(board))).toEqual(board)
  })

  it('handles a large slate of games (league-day simulation)', () => {
    const games = Array.from({ length: 16 }, (_, i) => ({
      id: `g${i}`,
      day: 20,
      homeTeamId: `home${i}`,
      awayTeamId: `away${i}`,
      result: i % 2 === 0
        ? { homeGoals: i, awayGoals: i + 1, decidedBy: 'regulation' as const }
        : undefined,
    }))
    const schedule = makeSchedule(games)
    const board = buildScoreboard({
      schedule,
      day: 20,
      teamName: name,
      teamAbbr: (id) => id.slice(0, 3).toUpperCase(),
    })
    expect(board).toHaveLength(16)
    expect(board.filter((e) => e.final)).toHaveLength(8)
    expect(board.filter((e) => !e.final)).toHaveLength(8)
  })
})
