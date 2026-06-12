/**
 * Tests for the rivalries module.
 *
 * Covers:
 *  - Division pairs are seeded with intensity >= 30.
 *  - Intensity rises on one-goal games, chippy games, and playoff meetings.
 *  - A new rivalry forms after enough repeated chippy/close meetings.
 *  - Flash news is rate-limited (fires at most once per year per pairing).
 *  - decayIntensity reduces intensity and respects DECAY_FLOOR.
 *  - MAX_RIVALRIES bound is enforced.
 *  - All results are deterministic with the same seed.
 *  - State is JSON round-trip safe.
 *  - gameIntensity returns correct factor and label.
 */

import { describe, it, expect } from 'vitest'
import { Rng, deriveSeed } from '@engine/shared/rng'
import {
  seedRivalries,
  registerGame,
  gameIntensity,
  decayIntensity,
  rivalryBetween,
  type RivalriesState,
} from './rivalries'

/* ────────────────── fixtures ────────────────── */

/** Build a small league: 4 divisions × 4 teams each = 16 teams. */
function makeTeams(numDivisions = 4, teamsPerDiv = 4) {
  const teams: Array<{ teamId: string; divisionId: string; conferenceId: string }> = []
  for (let d = 0; d < numDivisions; d++) {
    const confId = `conf${Math.floor(d / 2)}`
    for (let t = 0; t < teamsPerDiv; t++) {
      teams.push({
        teamId: `t${d * teamsPerDiv + t}`,
        divisionId: `div${d}`,
        conferenceId: confId,
      })
    }
  }
  return teams
}

function makeRng(seed = 42) {
  return new Rng(seed)
}

/* ────────────────── seedRivalries ────────────────── */

describe('seedRivalries', () => {
  it('returns a valid RivalriesState with rivalries array', () => {
    const state = seedRivalries({ teams: makeTeams(), rng: makeRng() })
    expect(Array.isArray(state.rivalries)).toBe(true)
    expect(state.rivalries.length).toBeGreaterThan(0)
  })

  it('all same-division pairs are seeded with intensity >= 30', () => {
    const teams = makeTeams(4, 4) // 4 divs × 4 teams → 6 pairs per div = 24 div pairs
    const state = seedRivalries({ teams, rng: makeRng() })

    // Collect all same-division pairs.
    const byDiv = new Map<string, string[]>()
    for (const t of teams) {
      const b = byDiv.get(t.divisionId) ?? []
      b.push(t.teamId)
      byDiv.set(t.divisionId, b)
    }

    for (const members of byDiv.values()) {
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const r = rivalryBetween(state, members[i]!, members[j]!)
          expect(r, `${members[i]} vs ${members[j]} should have a rivalry`).not.toBeNull()
          expect(r!.intensity).toBeGreaterThanOrEqual(30)
          expect(r!.reasons).toContain('division')
        }
      }
    }
  })

  it('includes some cross-division marquee rivalries', () => {
    const teams = makeTeams(4, 4)
    const state = seedRivalries({ teams, rng: makeRng() })

    // At least one pairing whose teams come from different divisions.
    const byDiv = new Map(teams.map((t) => [t.teamId, t.divisionId]))
    const crossDiv = state.rivalries.filter((r) => byDiv.get(r.teamA) !== byDiv.get(r.teamB))
    expect(crossDiv.length).toBeGreaterThan(0)
  })

  it('total rivalries is bounded (never more than 40)', () => {
    const teams = makeTeams(4, 5) // 20 teams → many pairs
    const state = seedRivalries({ teams, rng: makeRng() })
    expect(state.rivalries.length).toBeLessThanOrEqual(40)
  })

  it('is deterministic with the same seed', () => {
    const teams = makeTeams()
    const s1 = seedRivalries({ teams, rng: new Rng(99) })
    const s2 = seedRivalries({ teams, rng: new Rng(99) })
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2))
  })

  it('produces different results with a different seed', () => {
    const teams = makeTeams()
    const s1 = seedRivalries({ teams, rng: new Rng(1) })
    const s2 = seedRivalries({ teams, rng: new Rng(2) })
    // At least the cross-division picks should differ.
    expect(JSON.stringify(s1)).not.toBe(JSON.stringify(s2))
  })
})

/* ────────────────── rivalryBetween ────────────────── */

describe('rivalryBetween', () => {
  it('returns null for an unknown pairing', () => {
    const state: RivalriesState = { rivalries: [] }
    expect(rivalryBetween(state, 'tA', 'tB')).toBeNull()
  })

  it('is symmetric: (A,B) === (B,A)', () => {
    const teams = makeTeams(1, 2)
    const state = seedRivalries({ teams, rng: makeRng() })
    const ab = rivalryBetween(state, teams[0]!.teamId, teams[1]!.teamId)
    const ba = rivalryBetween(state, teams[1]!.teamId, teams[0]!.teamId)
    expect(ab).not.toBeNull()
    expect(ab).toBe(ba) // same object reference
  })
})

/* ────────────────── registerGame ────────────────── */

describe('registerGame', () => {
  it('increases intensity for a one-goal game between rivals', () => {
    const teams = makeTeams(1, 2) // same division
    const state = seedRivalries({ teams, rng: makeRng() })
    const tA = teams[0]!.teamId
    const tB = teams[1]!.teamId
    const before = rivalryBetween(state, tA, tB)!.intensity

    registerGame({
      state,
      teamA: tA,
      teamB: tB,
      goalsA: 2,
      goalsB: 1, // one-goal
      penaltyMinutesA: 2,
      penaltyMinutesB: 2,
      year: 2026,
      rng: makeRng(),
    })

    const after = rivalryBetween(state, tA, tB)!.intensity
    expect(after).toBeGreaterThan(before)
  })

  it('increases intensity for a chippy game (high PIM)', () => {
    const teams = makeTeams(1, 2)
    const state = seedRivalries({ teams, rng: makeRng() })
    const tA = teams[0]!.teamId
    const tB = teams[1]!.teamId
    const before = rivalryBetween(state, tA, tB)!.intensity

    registerGame({
      state,
      teamA: tA,
      teamB: tB,
      goalsA: 5,
      goalsB: 1, // not close, but chippy
      penaltyMinutesA: 14,
      penaltyMinutesB: 10, // combined = 24 >= 20
      year: 2026,
      rng: makeRng(),
    })

    const after = rivalryBetween(state, tA, tB)!.intensity
    expect(after).toBeGreaterThan(before)
    expect(rivalryBetween(state, tA, tB)!.reasons).toContain('chippy games')
  })

  it('increases intensity more for a playoff meeting', () => {
    const teams = makeTeams(1, 2)
    const stateRegular = seedRivalries({ teams, rng: makeRng() })
    const statePlayoff = seedRivalries({ teams, rng: makeRng() })
    const tA = teams[0]!.teamId
    const tB = teams[1]!.teamId
    const base = rivalryBetween(stateRegular, tA, tB)!.intensity

    const regularArgs = {
      state: stateRegular,
      teamA: tA,
      teamB: tB,
      goalsA: 3,
      goalsB: 1,
      penaltyMinutesA: 2,
      penaltyMinutesB: 2,
      year: 2026,
      rng: makeRng(),
    }
    registerGame(regularArgs)

    registerGame({
      state: statePlayoff,
      teamA: tA,
      teamB: tB,
      goalsA: 3,
      goalsB: 1,
      penaltyMinutesA: 2,
      penaltyMinutesB: 2,
      wasPlayoff: true,
      year: 2026,
      rng: makeRng(),
    })

    const afterRegular = rivalryBetween(stateRegular, tA, tB)!.intensity - base
    const afterPlayoff = rivalryBetween(statePlayoff, tA, tB)!.intensity - base
    expect(afterPlayoff).toBeGreaterThan(afterRegular)
    expect(rivalryBetween(statePlayoff, tA, tB)!.reasons).toContain('playoff history')
  })

  it('creates a new rivalry after repeated chippy/close meetings', () => {
    const state: RivalriesState = { rivalries: [] }
    const tA = 'tX'
    const tB = 'tY'

    // No rivalry at start.
    expect(rivalryBetween(state, tA, tB)).toBeNull()

    const base = {
      state,
      teamA: tA,
      teamB: tB,
      goalsA: 2,
      goalsB: 1, // close
      penaltyMinutesA: 12,
      penaltyMinutesB: 10, // chippy (combined 22)
      year: 2026,
      rng: makeRng(),
    }

    // After first meeting a sentinel entry may appear at intensity 0.
    registerGame({ ...base })
    registerGame({ ...base })
    const result3 = registerGame({ ...base })

    // By the third chippy/close meeting the rivalry should be formed with intensity > 0.
    const r = rivalryBetween(state, tA, tB)
    expect(r).not.toBeNull()
    expect(r!.intensity).toBeGreaterThan(0)
    // A formation news seed should have been emitted.
    const formationSeed = result3.newsSeeds.find((s) => s.headline.includes('rivalry is born'))
    expect(formationSeed).toBeDefined()
  })

  it('emits a flash news item when crossing 60 threshold', () => {
    const state: RivalriesState = {
      rivalries: [
        {
          teamA: 'tA',
          teamB: 'tB',
          intensity: 56,
          reasons: ['division'],
          meetings: 10,
        },
      ],
    }

    // A chippy one-goal game should push it over 60 (+4 close + +5 chippy = +9 → 65).
    const result = registerGame({
      state,
      teamA: 'tA',
      teamB: 'tB',
      goalsA: 2,
      goalsB: 1,
      penaltyMinutesA: 14,
      penaltyMinutesB: 10,
      year: 2026,
      rng: makeRng(),
    })

    expect(result.flashed).toBe(true)
    const flashSeed = result.newsSeeds.find((s) => s.headline.includes('rivalry ignites'))
    expect(flashSeed).toBeDefined()
  })

  it('flash news is rate-limited to once per year', () => {
    const state: RivalriesState = {
      rivalries: [
        {
          teamA: 'tA',
          teamB: 'tB',
          intensity: 56,
          reasons: ['division'],
          meetings: 10,
        },
      ],
    }

    const gameArgs = {
      state,
      teamA: 'tA',
      teamB: 'tB',
      goalsA: 2,
      goalsB: 1,
      penaltyMinutesA: 14,
      penaltyMinutesB: 10,
      year: 2026,
      rng: makeRng(),
    }

    const result1 = registerGame(gameArgs)
    expect(result1.flashed).toBe(true)

    // Same year — should not flash again even if we somehow drop intensity and re-cross.
    // Force intensity just below threshold again to test the rate-limit.
    rivalryBetween(state, 'tA', 'tB')!.intensity = 56

    const result2 = registerGame(gameArgs)
    expect(result2.flashed).toBe(false)
    expect(result2.newsSeeds.filter((s) => s.headline.includes('rivalry ignites'))).toHaveLength(0)
  })

  it('flash news fires again in a new year', () => {
    const state: RivalriesState = {
      rivalries: [
        {
          teamA: 'tA',
          teamB: 'tB',
          intensity: 56,
          reasons: ['division'],
          meetings: 10,
          lastFlashYear: 2025,
        },
      ],
    }

    const result = registerGame({
      state,
      teamA: 'tA',
      teamB: 'tB',
      goalsA: 2,
      goalsB: 1,
      penaltyMinutesA: 14,
      penaltyMinutesB: 10,
      year: 2026, // new year
      rng: makeRng(),
    })

    expect(result.flashed).toBe(true)
  })

  it('intensity is capped at 100', () => {
    const state: RivalriesState = {
      rivalries: [
        {
          teamA: 'tA',
          teamB: 'tB',
          intensity: 98,
          reasons: ['division', 'playoff history'],
          meetings: 20,
        },
      ],
    }

    registerGame({
      state,
      teamA: 'tA',
      teamB: 'tB',
      goalsA: 2,
      goalsB: 1,
      penaltyMinutesA: 14,
      penaltyMinutesB: 10,
      wasPlayoff: true,
      year: 2026,
      rng: makeRng(),
    })

    const r = rivalryBetween(state, 'tA', 'tB')!
    expect(r.intensity).toBeLessThanOrEqual(100)
  })

  it('unremarkable game between non-rivals creates no new entry', () => {
    const state: RivalriesState = { rivalries: [] }

    registerGame({
      state,
      teamA: 'tX',
      teamB: 'tY',
      goalsA: 5,
      goalsB: 1, // blowout
      penaltyMinutesA: 2,
      penaltyMinutesB: 2, // clean
      year: 2026,
      rng: makeRng(),
    })

    expect(state.rivalries).toHaveLength(0)
  })

  it('is deterministic', () => {
    const base = () => ({
      rivalries: [
        {
          teamA: 'tA',
          teamB: 'tB',
          intensity: 50,
          reasons: ['division'] as RivalryReason[],
          meetings: 5,
        },
      ],
    })
    // Need to import the type properly for this cast.
    type RivalryReason = 'division' | 'playoff history' | 'chippy games' | 'close races'

    const s1 = base()
    const s2 = base()
    const args = (s: typeof s1) => ({
      state: s,
      teamA: 'tA',
      teamB: 'tB',
      goalsA: 2,
      goalsB: 1,
      penaltyMinutesA: 14,
      penaltyMinutesB: 10,
      year: 2026,
      rng: new Rng(77),
    })

    registerGame(args(s1))
    registerGame(args(s2))

    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2))
  })
})

/* ────────────────── gameIntensity ────────────────── */

describe('gameIntensity', () => {
  it('returns factor=0 and label=null for non-rivals', () => {
    const state: RivalriesState = { rivalries: [] }
    const result = gameIntensity(state, 'tA', 'tB')
    expect(result.factor).toBe(0)
    expect(result.label).toBeNull()
  })

  it('returns factor=0 for low-intensity rivals (below 60)', () => {
    const state: RivalriesState = {
      rivalries: [{ teamA: 'tA', teamB: 'tB', intensity: 45, reasons: ['division'], meetings: 5 }],
    }
    const result = gameIntensity(state, 'tA', 'tB')
    expect(result.factor).toBe(0)
    expect(result.label).toBeNull()
  })

  it('returns "Rivalry Night" label for intensity 60–79', () => {
    const state: RivalriesState = {
      rivalries: [{ teamA: 'tA', teamB: 'tB', intensity: 70, reasons: ['division'], meetings: 10 }],
    }
    const result = gameIntensity(state, 'tA', 'tB')
    expect(result.label).toBe('Rivalry Night')
    expect(result.factor).toBeGreaterThan(0)
    expect(result.factor).toBeLessThanOrEqual(1)
  })

  it('returns "Grudge Match" label for intensity >= 80', () => {
    const state: RivalriesState = {
      rivalries: [{ teamA: 'tA', teamB: 'tB', intensity: 85, reasons: ['division', 'playoff history'], meetings: 15 }],
    }
    const result = gameIntensity(state, 'tA', 'tB')
    expect(result.label).toBe('Grudge Match')
    expect(result.factor).toBeGreaterThan(0)
    expect(result.factor).toBeLessThanOrEqual(1)
  })

  it('is symmetric', () => {
    const state: RivalriesState = {
      rivalries: [{ teamA: 'tA', teamB: 'tB', intensity: 75, reasons: ['division'], meetings: 8 }],
    }
    const ab = gameIntensity(state, 'tA', 'tB')
    const ba = gameIntensity(state, 'tB', 'tA')
    expect(ab.factor).toBe(ba.factor)
    expect(ab.label).toBe(ba.label)
  })
})

/* ────────────────── decayIntensity ────────────────── */

describe('decayIntensity', () => {
  it('reduces intensity by 8 per year', () => {
    const state: RivalriesState = {
      rivalries: [{ teamA: 'tA', teamB: 'tB', intensity: 50, reasons: ['division'], meetings: 5 }],
    }
    decayIntensity(state, 2027)
    expect(rivalryBetween(state, 'tA', 'tB')!.intensity).toBe(42)
  })

  it('never decays below 5 (DECAY_FLOOR)', () => {
    const state: RivalriesState = {
      rivalries: [{ teamA: 'tA', teamB: 'tB', intensity: 8, reasons: ['division'], meetings: 2 }],
    }
    decayIntensity(state, 2027)
    expect(rivalryBetween(state, 'tA', 'tB')!.intensity).toBeGreaterThanOrEqual(5)
  })

  it('applies to all rivalries', () => {
    const state: RivalriesState = {
      rivalries: [
        { teamA: 'tA', teamB: 'tB', intensity: 60, reasons: ['division'], meetings: 5 },
        { teamA: 'tC', teamB: 'tD', intensity: 40, reasons: ['chippy games'], meetings: 3 },
      ],
    }
    decayIntensity(state, 2027)
    expect(rivalryBetween(state, 'tA', 'tB')!.intensity).toBe(52)
    expect(rivalryBetween(state, 'tC', 'tD')!.intensity).toBe(32)
  })

  it('decayed rivalries can be re-ignited (playoff meeting after dormancy)', () => {
    const state: RivalriesState = {
      rivalries: [{ teamA: 'tA', teamB: 'tB', intensity: 10, reasons: ['division'], meetings: 8 }],
    }
    // Decay several years.
    decayIntensity(state, 2027)
    decayIntensity(state, 2028)
    const dormantIntensity = rivalryBetween(state, 'tA', 'tB')!.intensity
    expect(dormantIntensity).toBe(5) // floor

    // A playoff meeting re-ignites it.
    registerGame({
      state,
      teamA: 'tA',
      teamB: 'tB',
      goalsA: 3,
      goalsB: 2,
      penaltyMinutesA: 4,
      penaltyMinutesB: 4,
      wasPlayoff: true,
      year: 2029,
      rng: makeRng(),
    })

    expect(rivalryBetween(state, 'tA', 'tB')!.intensity).toBeGreaterThan(dormantIntensity)
  })
})

/* ────────────────── JSON round-trip ────────────────── */

describe('JSON round-trip', () => {
  it('RivalriesState survives JSON serialise/deserialise', () => {
    const teams = makeTeams()
    const state = seedRivalries({ teams, rng: makeRng() })

    // Run some games to enrich the state.
    const tA = teams[0]!.teamId
    const tB = teams[1]!.teamId
    registerGame({
      state,
      teamA: tA,
      teamB: tB,
      goalsA: 2,
      goalsB: 1,
      penaltyMinutesA: 14,
      penaltyMinutesB: 12,
      wasPlayoff: true,
      year: 2026,
      rng: makeRng(),
    })
    decayIntensity(state, 2027)

    const restored = JSON.parse(JSON.stringify(state)) as RivalriesState
    expect(restored.rivalries).toHaveLength(state.rivalries.length)
    expect(JSON.stringify(restored)).toBe(JSON.stringify(state))
  })
})

/* ────────────────── bounded count ────────────────── */

describe('MAX_RIVALRIES bound', () => {
  it('never exceeds 40 rivalries even after many game registrations', () => {
    // Start with a fully-seeded large league.
    const teams = makeTeams(4, 5) // 20 teams → lots of div pairs
    const state = seedRivalries({ teams, rng: makeRng() })

    // Register many games for random cross-division pairs.
    const rng = makeRng(99)
    for (let i = 0; i < 100; i++) {
      const tA = teams[rng.int(teams.length)]!.teamId
      const tB = teams[rng.int(teams.length)]!.teamId
      if (tA === tB) continue
      registerGame({
        state,
        teamA: tA,
        teamB: tB,
        goalsA: rng.int(6),
        goalsB: rng.int(6),
        penaltyMinutesA: rng.int(20),
        penaltyMinutesB: rng.int(20),
        wasPlayoff: rng.chance(0.1),
        year: 2026 + rng.int(3),
        rng: makeRng(i),
      })
    }

    expect(state.rivalries.length).toBeLessThanOrEqual(40)
  })
})
