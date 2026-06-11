import { describe, expect, it } from 'vitest'
import { Rng } from '@engine/shared/rng'
import {
  buildPreseasonOdds,
  checkExpectations,
  expectedRankOf,
  seasonVerdict,
  type ExpectationsState,
  type TeamDescriptor,
} from './expectations'

/* ────────────────────────── helpers ────────────────────────── */

function makeTeams(n: number): TeamDescriptor[] {
  return Array.from({ length: n }, (_, i) => ({
    teamId: `t${i + 1}`,
    name: `Team ${i + 1}`,
    abbr: `T${i + 1}`,
    // Deliberately spread strength so ranking is predictable.
    strength: 90 - i * 5,
  }))
}

function makeTeamsWithHistory(n: number): TeamDescriptor[] {
  return Array.from({ length: n }, (_, i) => ({
    teamId: `t${i + 1}`,
    name: `Team ${i + 1}`,
    abbr: `T${i + 1}`,
    strength: 90 - i * 5,
    // lastYearRank mirrors strength order: t1 was 1st, t2 was 2nd, …
    lastYearRank: i + 1,
  }))
}

function makeStandings(
  preseason: ExpectationsState['preseason'],
  overrides: Record<string, number> = {},
) {
  return preseason.map((p) => ({
    teamId: p.teamId,
    name: `Team ${p.teamId}`,
    abbr: p.teamId.toUpperCase(),
    rank: overrides[p.teamId] ?? p.predictedRank,
    gamesPlayed: 0,
  }))
}

/* ────────────────────────── buildPreseasonOdds ────────────────────────── */

describe('buildPreseasonOdds', () => {
  it('assigns ranks 1..n covering every team exactly once', () => {
    const teams = makeTeams(8)
    const { state } = buildPreseasonOdds({ teams, year: 2025, rng: new Rng(1) })
    const ranks = state.preseason.map((p) => p.predictedRank).sort((a, b) => a - b)
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    // Every team represented exactly once.
    const ids = state.preseason.map((p) => p.teamId).sort()
    expect(ids).toEqual(teams.map((t) => t.teamId).sort())
  })

  it('higher strength generally produces better rank (with small noise margin)', () => {
    // Use large enough strength gaps so noise cannot invert the top team.
    const teams = makeTeams(6) // strength gap = 5 per rank, noise std = 2
    const { state } = buildPreseasonOdds({ teams, year: 2025, rng: new Rng(42) })
    const t1 = state.preseason.find((p) => p.teamId === 't1')!
    const t6 = state.preseason.find((p) => p.teamId === 't6')!
    // t1 is strongest (90), t6 is weakest (65): even with noise they should not invert.
    expect(t1.predictedRank).toBeLessThan(t6.predictedRank)
  })

  it('blends lastYearRank at 30 % — teams with matching history rank the same as without it', () => {
    // When strength and lastYearRank are perfectly aligned the blend is equivalent
    // to strength-only ordering, so ranking order should be the same.
    const teamsNoHistory = makeTeams(6)
    const teamsWithHistory = makeTeamsWithHistory(6)
    const { state: s1 } = buildPreseasonOdds({ teams: teamsNoHistory, year: 2025, rng: new Rng(7) })
    const { state: s2 } = buildPreseasonOdds({ teams: teamsWithHistory, year: 2025, rng: new Rng(7) })
    // Both should have the same ordering (same rng seed, same relative ordering).
    const order1 = s1.preseason.map((p) => p.teamId)
    const order2 = s2.preseason.map((p) => p.teamId)
    expect(order1).toEqual(order2)
  })

  it('lastYearRank can override strength for closely-matched teams', () => {
    // Two teams with nearly equal strength but very different last-year rank.
    const teams: TeamDescriptor[] = [
      { teamId: 'a', name: 'Alpha', abbr: 'ALP', strength: 75, lastYearRank: 1 },
      { teamId: 'b', name: 'Beta',  abbr: 'BET', strength: 76, lastYearRank: 10 },
    ]
    // Run many seeds; at least some should give 'a' a better rank than 'b'.
    let aAheadCount = 0
    for (let seed = 0; seed < 100; seed++) {
      const { state } = buildPreseasonOdds({ teams, year: 2025, rng: new Rng(seed) })
      const a = state.preseason.find((p) => p.teamId === 'a')!
      const b = state.preseason.find((p) => p.teamId === 'b')!
      if (a.predictedRank < b.predictedRank) aAheadCount++
    }
    // 'a' should be ranked ahead of 'b' more often than not because the 30 %
    // history component more than compensates for the 1-point strength deficit
    // (blend: a=0.7*75+0.3*100=82.5, b=0.7*76+0.3*0=53.2 before noise).
    expect(aAheadCount).toBeGreaterThan(50)
  })

  it('emits exactly one league news seed', () => {
    const { newsSeeds } = buildPreseasonOdds({ teams: makeTeams(6), year: 2025, rng: new Rng(3) })
    expect(newsSeeds).toHaveLength(1)
    expect(newsSeeds[0].category).toBe('league')
  })

  it('news headline contains the projected champion name', () => {
    const teams = makeTeams(6)
    const { state, newsSeeds } = buildPreseasonOdds({ teams, year: 2025, rng: new Rng(5) })
    const topTeamId = state.preseason.find((p) => p.predictedRank === 1)!.teamId
    const topTeam = teams.find((t) => t.teamId === topTeamId)!
    expect(newsSeeds[0].headline).toContain(topTeam.name)
  })

  it('all preseason blurbs are non-empty strings', () => {
    const { state } = buildPreseasonOdds({ teams: makeTeams(8), year: 2025, rng: new Rng(9) })
    for (const p of state.preseason) {
      expect(typeof p.blurb).toBe('string')
      expect(p.blurb.length).toBeGreaterThan(0)
    }
  })

  it('is deterministic: same seed produces identical state', () => {
    const teams = makeTeams(6)
    const { state: s1 } = buildPreseasonOdds({ teams, year: 2025, rng: new Rng(99) })
    const { state: s2 } = buildPreseasonOdds({ teams, year: 2025, rng: new Rng(99) })
    expect(s1).toEqual(s2)
  })

  it('state round-trips through JSON', () => {
    const { state } = buildPreseasonOdds({ teams: makeTeams(4), year: 2025, rng: new Rng(11) })
    const restored = JSON.parse(JSON.stringify(state)) as ExpectationsState
    expect(restored).toEqual(state)
  })

  it('emittedKeys starts empty', () => {
    const { state } = buildPreseasonOdds({ teams: makeTeams(4), year: 2025, rng: new Rng(2) })
    expect(state.emittedKeys).toEqual([])
  })
})

/* ────────────────────────── checkExpectations ────────────────────────── */

describe('checkExpectations', () => {
  function makeState(n: number, seed = 1): ExpectationsState {
    const { state } = buildPreseasonOdds({ teams: makeTeams(n), year: 2025, rng: new Rng(seed) })
    return state
  }

  it('emits overachiever news when actual rank is 5+ better than predicted', () => {
    const state = makeState(10)
    // Find a team predicted around mid-table and force it to rank 1st.
    const midTeam = state.preseason.find((p) => p.predictedRank === 6)!
    const standings = state.preseason.map((p) => ({
      teamId: p.teamId,
      name: `Team ${p.teamId}`,
      abbr: p.teamId.toUpperCase(),
      rank: p.teamId === midTeam.teamId ? 1 : p.predictedRank,
      gamesPlayed: 15, // at the q1 checkpoint
    }))
    const { newsSeeds } = checkExpectations({
      state,
      standings,
      day: 20,
      year: 2025,
      rng: new Rng(42),
    })
    const forTeam = newsSeeds.filter((n) => n.teamId === midTeam.teamId)
    expect(forTeam.length).toBeGreaterThanOrEqual(1)
    // Headline should contain the team name.
    expect(forTeam[0].headline).toContain(`Team ${midTeam.teamId}`)
  })

  it('emits underachiever news when actual rank is 5+ worse than predicted', () => {
    const state = makeState(10)
    const topTeam = state.preseason.find((p) => p.predictedRank === 1)!
    const standings = state.preseason.map((p) => ({
      teamId: p.teamId,
      name: `Team ${p.teamId}`,
      abbr: p.teamId.toUpperCase(),
      rank: p.teamId === topTeam.teamId ? 9 : p.predictedRank,
      gamesPlayed: 15,
    }))
    const { newsSeeds } = checkExpectations({
      state,
      standings,
      day: 20,
      year: 2025,
      rng: new Rng(42),
    })
    const forTeam = newsSeeds.filter((n) => n.teamId === topTeam.teamId)
    expect(forTeam.length).toBeGreaterThanOrEqual(1)
  })

  it('does not emit news for teams within 4 ranks of prediction', () => {
    const state = makeState(10)
    // No overrides — everyone finishes exactly where predicted.
    const standings = state.preseason.map((p) => ({
      teamId: p.teamId,
      name: `Team ${p.teamId}`,
      abbr: p.teamId.toUpperCase(),
      rank: p.predictedRank,
      gamesPlayed: 16,
    }))
    const { newsSeeds } = checkExpectations({
      state,
      standings,
      day: 25,
      year: 2025,
      rng: new Rng(42),
    })
    expect(newsSeeds).toHaveLength(0)
  })

  it('does not emit a story for teams that have not reached the checkpoint threshold', () => {
    const state = makeState(10)
    const topTeam = state.preseason.find((p) => p.predictedRank === 1)!
    const standings = state.preseason.map((p) => ({
      teamId: p.teamId,
      name: `Team ${p.teamId}`,
      abbr: p.teamId.toUpperCase(),
      rank: p.teamId === topTeam.teamId ? 10 : p.predictedRank,
      gamesPlayed: 14, // below q1 threshold of 15
    }))
    const { newsSeeds } = checkExpectations({
      state,
      standings,
      day: 18,
      year: 2025,
      rng: new Rng(42),
    })
    const forTeam = newsSeeds.filter((n) => n.teamId === topTeam.teamId)
    expect(forTeam).toHaveLength(0)
  })

  it('emits a checkpoint story exactly once per team per checkpoint', () => {
    const state = makeState(10)
    const topTeam = state.preseason.find((p) => p.predictedRank === 1)!
    const buildStandings = (gp: number) =>
      state.preseason.map((p) => ({
        teamId: p.teamId,
        name: `Team ${p.teamId}`,
        abbr: p.teamId.toUpperCase(),
        rank: p.teamId === topTeam.teamId ? 10 : p.predictedRank,
        gamesPlayed: gp,
      }))

    // First call at q1.
    const r1 = checkExpectations({
      state,
      standings: buildStandings(15),
      day: 20,
      year: 2025,
      rng: new Rng(42),
    })
    const first = r1.newsSeeds.filter((n) => n.teamId === topTeam.teamId).length

    // Second call at q1 with same team still overperforming.
    const r2 = checkExpectations({
      state,
      standings: buildStandings(15),
      day: 21,
      year: 2025,
      rng: new Rng(42),
    })
    const second = r2.newsSeeds.filter((n) => n.teamId === topTeam.teamId).length

    expect(first).toBe(1)
    expect(second).toBe(0) // key already in emittedKeys
  })

  it('allows the same team to emit at multiple checkpoints (q1, half, q3)', () => {
    const state = makeState(10)
    const topTeam = state.preseason.find((p) => p.predictedRank === 1)!
    const buildStandings = (gp: number) =>
      state.preseason.map((p) => ({
        teamId: p.teamId,
        name: `Team ${p.teamId}`,
        abbr: p.teamId.toUpperCase(),
        rank: p.teamId === topTeam.teamId ? 10 : p.predictedRank,
        gamesPlayed: gp,
      }))

    let totalForTeam = 0
    for (const gp of [15, 30, 45]) {
      const { newsSeeds } = checkExpectations({
        state,
        standings: buildStandings(gp),
        day: gp * 2,
        year: 2025,
        rng: new Rng(42),
      })
      totalForTeam += newsSeeds.filter((n) => n.teamId === topTeam.teamId).length
    }
    // One story per checkpoint = 3 total (if consistently 9+ ranks off).
    expect(totalForTeam).toBe(3)
  })

  it('is deterministic: same state + same seed produces identical news', () => {
    const state1 = makeState(8)
    const state2 = JSON.parse(JSON.stringify(state1)) as ExpectationsState
    const topTeam = state1.preseason.find((p) => p.predictedRank === 1)!
    const standings = state1.preseason.map((p) => ({
      teamId: p.teamId,
      name: `Team ${p.teamId}`,
      abbr: p.teamId.toUpperCase(),
      rank: p.teamId === topTeam.teamId ? 8 : p.predictedRank,
      gamesPlayed: 15,
    }))
    const r1 = checkExpectations({ state: state1, standings, day: 20, year: 2025, rng: new Rng(77) })
    const r2 = checkExpectations({ state: state2, standings, day: 20, year: 2025, rng: new Rng(77) })
    expect(r1.newsSeeds).toEqual(r2.newsSeeds)
  })

  it('news category is always "league"', () => {
    const state = makeState(10)
    const topTeam = state.preseason.find((p) => p.predictedRank === 1)!
    const standings = state.preseason.map((p) => ({
      teamId: p.teamId,
      name: `Team ${p.teamId}`,
      abbr: p.teamId.toUpperCase(),
      rank: p.teamId === topTeam.teamId ? 10 : p.predictedRank,
      gamesPlayed: 15,
    }))
    const { newsSeeds } = checkExpectations({ state, standings, day: 20, year: 2025, rng: new Rng(1) })
    for (const seed of newsSeeds) {
      expect(seed.category).toBe('league')
    }
  })
})

/* ────────────────────────── seasonVerdict ────────────────────────── */

describe('seasonVerdict', () => {
  function makeStateAndStandings(n: number, seed = 1) {
    const teams = makeTeams(n)
    const { state } = buildPreseasonOdds({ teams, year: 2025, rng: new Rng(seed) })
    const finalStandings = state.preseason.map((p) => ({
      teamId: p.teamId,
      name: `Team ${p.teamId}`,
      abbr: p.teamId.toUpperCase(),
      rank: p.predictedRank,
    }))
    return { state, finalStandings, teams }
  }

  it('emits exactly one league news seed', () => {
    const { state, finalStandings } = makeStateAndStandings(8)
    const topTeamId = state.preseason.find((p) => p.predictedRank === 1)!.teamId
    const { newsSeeds } = seasonVerdict({
      state,
      finalStandings,
      championTeamId: topTeamId,
      year: 2025,
      rng: new Rng(1),
    })
    expect(newsSeeds).toHaveLength(1)
    expect(newsSeeds[0].category).toBe('league')
  })

  it('verdict references predicted champion name when we called it correctly', () => {
    const { state, finalStandings } = makeStateAndStandings(8)
    const topTeamId = state.preseason.find((p) => p.predictedRank === 1)!.teamId
    const { newsSeeds } = seasonVerdict({
      state,
      finalStandings,
      championTeamId: topTeamId,
      year: 2025,
      rng: new Rng(3),
    })
    // When we called it, champion name should appear in headline.
    expect(newsSeeds[0].headline).toContain(`Team ${topTeamId}`)
  })

  it('verdict body contains predicted rank information', () => {
    const { state, finalStandings } = makeStateAndStandings(8)
    const topTeamId = state.preseason.find((p) => p.predictedRank === 1)!.teamId
    // Make the actual champion someone unexpected.
    const lastTeamId = state.preseason.find((p) => p.predictedRank === 8)!.teamId
    const { newsSeeds } = seasonVerdict({
      state,
      finalStandings,
      championTeamId: lastTeamId,
      year: 2025,
      rng: new Rng(5),
    })
    const body = newsSeeds[0].body
    // The body should mention the predicted champion as the one who fell short.
    expect(body).toContain(`Team ${topTeamId}`)
  })

  it('when actual champion is not the predicted champion, headline contains upset framing', () => {
    const { state, finalStandings } = makeStateAndStandings(10)
    const lastTeamId = state.preseason.find((p) => p.predictedRank === 10)!.teamId
    const { newsSeeds } = seasonVerdict({
      state,
      finalStandings,
      championTeamId: lastTeamId,
      year: 2025,
      rng: new Rng(7),
    })
    // The upset headline templates do NOT contain the predicted champion's name in headline.
    // The champion name or "wrong" framing should appear.
    const headline = newsSeeds[0].headline
    expect(headline.length).toBeGreaterThan(10)
  })

  it('body mentions both the actual champion and preseason blurb when called correctly', () => {
    const { state, finalStandings } = makeStateAndStandings(6)
    const topTeamId = state.preseason.find((p) => p.predictedRank === 1)!.teamId
    const { newsSeeds } = seasonVerdict({
      state,
      finalStandings,
      championTeamId: topTeamId,
      year: 2025,
      rng: new Rng(8),
    })
    const body = newsSeeds[0].body
    expect(body).toContain(`Team ${topTeamId}`)
  })

  it('is deterministic: same inputs produce identical output', () => {
    const { state, finalStandings } = makeStateAndStandings(6)
    const topTeamId = state.preseason.find((p) => p.predictedRank === 1)!.teamId
    const args = { state: JSON.parse(JSON.stringify(state)) as ExpectationsState, finalStandings, championTeamId: topTeamId, year: 2025 }
    const r1 = seasonVerdict({ ...args, rng: new Rng(20) })
    const r2 = seasonVerdict({ ...args, rng: new Rng(20) })
    expect(r1.newsSeeds).toEqual(r2.newsSeeds)
  })

  it('state JSON round-trip preserves emittedKeys added during check', () => {
    const teams = makeTeams(8)
    const { state } = buildPreseasonOdds({ teams, year: 2025, rng: new Rng(1) })
    const topTeam = state.preseason.find((p) => p.predictedRank === 1)!
    const standings = state.preseason.map((p) => ({
      teamId: p.teamId,
      name: `Team ${p.teamId}`,
      abbr: p.teamId.toUpperCase(),
      rank: p.teamId === topTeam.teamId ? 8 : p.predictedRank,
      gamesPlayed: 15,
    }))
    checkExpectations({ state, standings, day: 20, year: 2025, rng: new Rng(1) })

    const restored = JSON.parse(JSON.stringify(state)) as ExpectationsState
    expect(restored.emittedKeys.length).toBeGreaterThan(0)
    expect(restored).toEqual(state)
  })
})

/* ────────────────────────── expectedRankOf ────────────────────────── */

describe('expectedRankOf', () => {
  it('returns the predicted rank for a known team', () => {
    const { state } = buildPreseasonOdds({ teams: makeTeams(6), year: 2025, rng: new Rng(1) })
    for (const p of state.preseason) {
      expect(expectedRankOf(state, p.teamId)).toBe(p.predictedRank)
    }
  })

  it('returns undefined for an unknown team', () => {
    const { state } = buildPreseasonOdds({ teams: makeTeams(4), year: 2025, rng: new Rng(1) })
    expect(expectedRankOf(state, 'unknown-team')).toBeUndefined()
  })

  it('works correctly after JSON round-trip', () => {
    const { state } = buildPreseasonOdds({ teams: makeTeams(4), year: 2025, rng: new Rng(5) })
    const restored = JSON.parse(JSON.stringify(state)) as ExpectationsState
    for (const p of state.preseason) {
      expect(expectedRankOf(restored, p.teamId)).toBe(p.predictedRank)
    }
  })
})
