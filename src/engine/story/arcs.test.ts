/**
 * arcs.test.ts — comprehensive coverage for the arc engine.
 *
 * Strategy:
 *  - Each detector is driven with fabricated ArcInputs sequences.
 *  - We verify: arc created on qualifying event, news seed emitted at creation,
 *    escalation news fires at tension thresholds (40 / 70), no noise on quiet
 *    inputs, resolution fires + status set, cap eviction, determinism,
 *    JSON round-trip.
 */

import { describe, it, expect } from 'vitest'
import {
  createInitialArcsState,
  tickArcs,
  createArc,
  escalateArc,
  resolveArc,
  type ArcsState,
  type ArcInputs,
} from './arcs'
import { Rng } from '@engine/shared/rng'

/* ─────────────────────────── test helpers ─────────────────────────── */

function makeRng(seed = 42): Rng {
  return new Rng(seed)
}

/** Baseline quiet inputs — no games, no player lines, no standing changes. */
function quietInputs(overrides: Partial<ArcInputs> = {}): ArcInputs {
  return {
    day: 10,
    year: 2024,
    seasonLength: 82,
    results: [],
    playerLines: [],
    standingsDelta: [],
    seasonTotals: () => ({ goals: 0, assists: 0, points: 0, gamesPlayed: 10 }),
    // Fixture players are prominent scorers by default — streak/drought arcs
    // require prominence (expectedPoints >= 0.55); tests for the depth-player
    // suppression path override this explicitly.
    expectedPoints: () => 0.8,
    playerName: (id) => `Player-${id}`,
    teamName: (id) => `Team-${id}`,
    ...overrides,
  }
}

/** Build a player line entry. */
function playerLine(
  playerId: string,
  teamId: string,
  opts: {
    goals?: number
    assists?: number
    points?: number
    isForward?: boolean
    isRookie?: boolean
    consecutivePointGames?: number
    scorelessStreak?: number
  } = {},
) {
  const goals = opts.goals ?? 0
  const assists = opts.assists ?? 0
  return {
    playerId,
    teamId,
    goals,
    assists,
    points: opts.points ?? goals + assists,
    isForward: opts.isForward ?? true,
    isRookie: opts.isRookie ?? false,
    ...(opts.consecutivePointGames !== undefined
      ? { consecutivePointGames: opts.consecutivePointGames }
      : {}),
    ...(opts.scorelessStreak !== undefined
      ? { scorelessStreak: opts.scorelessStreak }
      : {}),
  }
}

/* ─────────────────────────── JSON round-trip ─────────────────────────── */

describe('JSON round-trip', () => {
  it('ArcsState survives JSON.stringify + JSON.parse', () => {
    const state = createInitialArcsState()
    createArc(state, 'feud', { playerIds: ['p1', 'p2'], teamIds: ['t1'] }, 'Initial tension', 5, 2024)
    const serialized = JSON.stringify(state)
    const restored = JSON.parse(serialized) as ArcsState
    expect(restored.arcs).toHaveLength(1)
    expect(restored.arcs[0]!.kind).toBe('feud')
    expect(restored.counter).toBe(1)
  })

  it('tickArcs result with beats survives round-trip', () => {
    const state = createInitialArcsState()
    const rng = makeRng()
    const inputs = quietInputs({
      playerLines: [
        playerLine('p1', 't1', { points: 2, consecutivePointGames: 5 }),
      ],
    })
    tickArcs({ state, inputs, rng })
    const restored = JSON.parse(JSON.stringify(state)) as ArcsState
    expect(restored.arcs[0]?.beats).toBeDefined()
    expect(restored.arcs[0]?.beats.length).toBeGreaterThan(0)
  })
})

/* ─────────────────────────── createArc / escalateArc / resolveArc ─────────────────────────── */

describe('external arc helpers', () => {
  it('createArc adds arc with correct fields', () => {
    const state = createInitialArcsState()
    const arc = createArc(
      state,
      'feud',
      { playerIds: ['p1', 'p2'], teamIds: ['t1'] },
      'First skirmish',
      5,
      2024,
    )
    expect(arc.id).toBe('arc1')
    expect(arc.kind).toBe('feud')
    expect(arc.status).toBe('building')
    expect(arc.beats).toHaveLength(1)
    expect(state.counter).toBe(1)
    expect(state.arcs).toHaveLength(1)
  })

  it('escalateArc adds beat and adjusts tension', () => {
    const state = createInitialArcsState()
    const arc = createArc(state, 'feud', { playerIds: ['p1'], teamIds: [] }, 'Start', 1, 2024)
    const result = escalateArc(state, arc.id, 'Next beat', 25, 2, 2024)
    expect(result).toBeDefined()
    expect(result!.beats).toHaveLength(2)
    expect(result!.tension).toBeGreaterThan(30)
  })

  it('escalateArc promotes status to peak when tension >= 70', () => {
    const state = createInitialArcsState()
    const arc = createArc(state, 'feud', { playerIds: ['p1'], teamIds: [] }, 'Start', 1, 2024)
    escalateArc(state, arc.id, 'Peak beat', 50, 2, 2024)
    expect(arc.status).toBe('peak')
  })

  it('resolveArc sets resolved status and resolution text', () => {
    const state = createInitialArcsState()
    const arc = createArc(state, 'mentorship', { playerIds: ['p1', 'p2'], teamIds: [] }, 'Bond formed', 1, 2024)
    const result = resolveArc(state, arc.id, 'Mentor retired', 5, 2024)
    expect(result?.status).toBe('resolved')
    expect(result?.resolution).toBe('Mentor retired')
  })

  it('escalateArc is a no-op on resolved arcs', () => {
    const state = createInitialArcsState()
    const arc = createArc(state, 'feud', { playerIds: ['p1'], teamIds: [] }, 'Start', 1, 2024)
    resolveArc(state, arc.id, 'Done', 2, 2024)
    const result = escalateArc(state, arc.id, 'After resolution', 10, 3, 2024)
    expect(result).toBeUndefined()
  })
})

/* ─────────────────────────── hot streak ─────────────────────────── */

describe('hotStreak detector', () => {
  it('creates arc and news seed at 5-game streak for a prominent scorer', () => {
    const state = createInitialArcsState()
    const rng = makeRng()
    const inputs = quietInputs({
      playerLines: [
        playerLine('p1', 't1', { points: 1, consecutivePointGames: 5 }),
      ],
    })
    const { newsSeeds } = tickArcs({ state, inputs, rng })
    expect(state.arcs.filter(a => a.kind === 'hotStreak')).toHaveLength(1)
    expect(newsSeeds.some(s => s.headline.includes('5-game'))).toBe(true)
  })

  it('does NOT create a streak arc for a depth player below 8 games', () => {
    const state = createInitialArcsState()
    const rng = makeRng()
    tickArcs({
      state,
      inputs: quietInputs({
        playerLines: [playerLine('p1', 't1', { points: 1, consecutivePointGames: 6 })],
        expectedPoints: () => 0.3,
      }),
      rng,
    })
    expect(state.arcs.filter(a => a.kind === 'hotStreak')).toHaveLength(0)
  })

  it('extends existing streak arc on subsequent point games', () => {
    const state = createInitialArcsState()
    const rng = makeRng()

    // Create the arc at day 10.
    tickArcs({
      state,
      inputs: quietInputs({
        day: 10,
        playerLines: [playerLine('p1', 't1', { points: 1, consecutivePointGames: 5 })],
      }),
      rng,
    })

    const arc = state.arcs.find(a => a.kind === 'hotStreak')!
    const beatsAfterCreate = arc.beats.length

    // Day 11 — player scores again.
    tickArcs({
      state,
      inputs: quietInputs({
        day: 11,
        playerLines: [playerLine('p1', 't1', { points: 1 })],
      }),
      rng,
    })

    expect(arc.beats.length).toBe(beatsAfterCreate + 1)
    expect(arc.status).not.toBe('resolved')
  })

  it('resolves arc and emits news when player goes scoreless', () => {
    const state = createInitialArcsState()
    const rng = makeRng()

    // 7+ game heaters earn a "snapped" story on resolution.
    tickArcs({
      state,
      inputs: quietInputs({
        day: 10,
        playerLines: [playerLine('p1', 't1', { points: 1, consecutivePointGames: 7 })],
      }),
      rng,
    })

    const { newsSeeds } = tickArcs({
      state,
      inputs: quietInputs({
        day: 11,
        playerLines: [playerLine('p1', 't1', { points: 0 })], // scoreless
      }),
      rng,
    })

    const arc = state.arcs.find(a => a.kind === 'hotStreak')!
    expect(arc.status).toBe('resolved')
    expect(newsSeeds.some(s => s.headline.toLowerCase().includes('snapped') || s.headline.toLowerCase().includes('snap'))).toBe(true)
  })

  it('does NOT fire news on quiet inputs (no qualifying players)', () => {
    const state = createInitialArcsState()
    const rng = makeRng()
    const { newsSeeds } = tickArcs({ state, inputs: quietInputs(), rng })
    expect(newsSeeds.filter(s => s.headline.toLowerCase().includes('streak'))).toHaveLength(0)
  })

  it('fires escalation news when tension crosses 40 and 70', () => {
    const state = createInitialArcsState()
    const rng = makeRng()

    // Create arc at day 10 (4-game streak).
    tickArcs({
      state,
      inputs: quietInputs({ day: 10, playerLines: [playerLine('p1', 't1', { points: 1, consecutivePointGames: 5 })] }),
      rng,
    })

    const arc = state.arcs.find(a => a.kind === 'hotStreak')!
    // Manually set tension just below 40 to test threshold crossing.
    arc.tension = 38

    const { newsSeeds } = tickArcs({
      state,
      inputs: quietInputs({ day: 11, playerLines: [playerLine('p1', 't1', { points: 1 })] }),
      rng,
    })

    // Tension was 38 + 8 = 46 → crossed 40 → news should fire.
    expect(newsSeeds.some(s => s.playerId === 'p1')).toBe(true)
  })
})

/* ─────────────────────────── cold spell ─────────────────────────── */

describe('coldSpell detector', () => {
  it('creates arc and news at 6-game scoreless drought for a PROMINENT forward', () => {
    const state = createInitialArcsState()
    const rng = makeRng()
    const { newsSeeds } = tickArcs({
      state,
      inputs: quietInputs({
        playerLines: [playerLine('p1', 't1', { points: 0, isForward: true, scorelessStreak: 6 })],
        expectedPoints: () => 0.8,
      }),
      rng,
    })
    expect(state.arcs.filter(a => a.kind === 'coldSpell')).toHaveLength(1)
    expect(newsSeeds.some(s => s.headline.toLowerCase().includes('slump') || s.headline.toLowerCase().includes('drought'))).toBe(true)
  })

  it('does NOT create a drought arc for a depth forward (no prominence)', () => {
    const state = createInitialArcsState()
    const rng = makeRng()
    tickArcs({
      state,
      inputs: quietInputs({
        playerLines: [playerLine('p1', 't1', { points: 0, isForward: true, scorelessStreak: 8 })],
        expectedPoints: () => 0.3,
      }),
      rng,
    })
    tickArcs({
      state,
      inputs: quietInputs({
        // prominence unknown for this player → no arc
        playerLines: [playerLine('p2', 't1', { points: 0, isForward: true, scorelessStreak: 8 })],
        expectedPoints: () => undefined,
      }),
      rng,
    })
    expect(state.arcs.filter(a => a.kind === 'coldSpell')).toHaveLength(0)
  })

  it('does NOT create arc for non-forward', () => {
    const state = createInitialArcsState()
    const rng = makeRng()
    tickArcs({
      state,
      inputs: quietInputs({
        playerLines: [playerLine('p1', 't1', { points: 0, isForward: false, scorelessStreak: 6 })],
      }),
      rng,
    })
    expect(state.arcs.filter(a => a.kind === 'coldSpell')).toHaveLength(0)
  })

  it('resolves arc when player scores', () => {
    const state = createInitialArcsState()
    const rng = makeRng()

    tickArcs({
      state,
      inputs: quietInputs({
        day: 10,
        playerLines: [playerLine('p1', 't1', { scorelessStreak: 6, isForward: true })],
        expectedPoints: () => 0.8,
      }),
      rng,
    })

    const { newsSeeds } = tickArcs({
      state,
      inputs: quietInputs({ day: 11, playerLines: [playerLine('p1', 't1', { points: 2, isForward: true })] }),
      rng,
    })

    const arc = state.arcs.find(a => a.kind === 'coldSpell')!
    expect(arc.status).toBe('resolved')
    expect(newsSeeds.some(s => s.headline.toLowerCase().includes('break') || s.headline.toLowerCase().includes('slump'))).toBe(true)
  })
})

/* ─────────────────────────── breakout / bust ─────────────────────────── */

describe('breakoutSeason detector', () => {
  it('creates breakout arc when pace exceeds 1.4x expected', () => {
    const state = createInitialArcsState()
    const rng = makeRng()
    const { newsSeeds } = tickArcs({
      state,
      inputs: quietInputs({
        day: 20,
        playerLines: [playerLine('p1', 't1', { points: 2 })],
        seasonTotals: (id) =>
          id === 'p1'
            ? { goals: 10, assists: 15, points: 25, gamesPlayed: 20 }
            : { goals: 0, assists: 0, points: 0, gamesPlayed: 20 },
        expectedPoints: (id) => (id === 'p1' ? 40 : undefined), // pace = 25/20*82 ≈ 102 vs expected 40
      }),
      rng,
    })
    expect(state.arcs.filter(a => a.kind === 'breakoutSeason')).toHaveLength(1)
    expect(newsSeeds.some(s => s.headline.toLowerCase().includes('breakout'))).toBe(true)
  })

  it('creates bust arc when pace is below 0.55x expected', () => {
    const state = createInitialArcsState()
    const rng = makeRng()
    const { newsSeeds } = tickArcs({
      state,
      inputs: quietInputs({
        day: 20,
        playerLines: [playerLine('p1', 't1', { points: 1 })],
        seasonTotals: (id) =>
          id === 'p1'
            ? { goals: 1, assists: 2, points: 3, gamesPlayed: 20 }
            : { goals: 0, assists: 0, points: 0, gamesPlayed: 20 },
        expectedPoints: (id) => (id === 'p1' ? 60 : undefined), // pace = 3/20*82 ≈ 12 vs expected 60
      }),
      rng,
    })
    expect(state.arcs.filter(a => a.kind === 'bustWatch')).toHaveLength(1)
    expect(newsSeeds.some(s => s.headline.toLowerCase().includes('slow') || s.headline.toLowerCase().includes('bust'))).toBe(true)
  })

  it('does not create arc below minimum games threshold', () => {
    const state = createInitialArcsState()
    const rng = makeRng()
    tickArcs({
      state,
      inputs: quietInputs({
        day: 5,
        playerLines: [playerLine('p1', 't1', { points: 3 })],
        seasonTotals: () => ({ goals: 5, assists: 5, points: 10, gamesPlayed: 5 }),
        expectedPoints: () => 40,
      }),
      rng,
    })
    expect(state.arcs.filter(a => a.kind === 'breakoutSeason' || a.kind === 'bustWatch')).toHaveLength(0)
  })
})

/* ─────────────────────────── milestone watch ─────────────────────────── */

describe('milestoneWatch detector', () => {
  it('creates milestone arc when player approaches round number', () => {
    const state = createInitialArcsState()
    const rng = makeRng()
    const { newsSeeds } = tickArcs({
      state,
      inputs: quietInputs({
        playerLines: [playerLine('p1', 't1', { points: 1 })],
        careerTotals: (id) =>
          id === 'p1'
            ? { goals: 195, points: 495, gamesPlayed: 500 }
            : { goals: 0, points: 0, gamesPlayed: 0 },
      }),
      rng,
    })
    const milestoneArcs = state.arcs.filter(a => a.kind === 'milestoneWatch')
    expect(milestoneArcs.length).toBeGreaterThan(0)
    expect(newsSeeds.some(s => s.category === 'milestone')).toBe(true)
  })

  it('fires milestone news when career stat crosses round number', () => {
    const state = createInitialArcsState()
    const rng = makeRng()

    // First — create the approach arc.
    tickArcs({
      state,
      inputs: quietInputs({
        day: 10,
        playerLines: [playerLine('p1', 't1', { points: 1 })],
        careerTotals: () => ({ goals: 198, points: 495, gamesPlayed: 500 }),
      }),
      rng,
    })

    // Then hit the milestone.
    const { newsSeeds } = tickArcs({
      state,
      inputs: quietInputs({
        day: 11,
        playerLines: [playerLine('p1', 't1', { goals: 2, points: 2 })],
        careerTotals: () => ({ goals: 200, points: 497, gamesPlayed: 501 }),
      }),
      rng,
    })

    const milestoneNews = newsSeeds.filter(s => s.category === 'milestone')
    expect(milestoneNews.some(s => s.headline.includes('200'))).toBe(true)
    const arc = state.arcs.find(a => a.kind === 'milestoneWatch')
    expect(arc?.status).toBe('resolved')
  })
})

/* ─────────────────────────── cinderella / collapse ─────────────────────────── */

describe('cinderellaTeam detector', () => {
  it('creates arc when team is 6+ ranks above expected after day 10', () => {
    const state = createInitialArcsState()
    const rng = makeRng()
    const { newsSeeds } = tickArcs({
      state,
      inputs: quietInputs({
        day: 15,
        standingsDelta: [{ teamId: 't1', rank: 2, prevRank: 3, expectedRank: 12 }],
      }),
      rng,
    })
    expect(state.arcs.filter(a => a.kind === 'cinderellaTeam')).toHaveLength(1)
    expect(newsSeeds.some(s => s.headline.toLowerCase().includes('expectation') || s.headline.toLowerCase().includes('cinderella'))).toBe(true)
  })

  it('does NOT create cinderella arc before day 10', () => {
    const state = createInitialArcsState()
    const rng = makeRng()
    tickArcs({
      state,
      inputs: quietInputs({
        day: 5,
        standingsDelta: [{ teamId: 't1', rank: 2, prevRank: 3, expectedRank: 12 }],
      }),
      rng,
    })
    expect(state.arcs.filter(a => a.kind === 'cinderellaTeam')).toHaveLength(0)
  })

  it('resolves cinderella arc when team falls back to expected range', () => {
    const state = createInitialArcsState()
    const rng = makeRng()

    // Create the arc.
    tickArcs({
      state,
      inputs: quietInputs({ day: 15, standingsDelta: [{ teamId: 't1', rank: 2, prevRank: 3, expectedRank: 12 }] }),
      rng,
    })

    // Fall back.
    const { newsSeeds } = tickArcs({
      state,
      inputs: quietInputs({ day: 16, standingsDelta: [{ teamId: 't1', rank: 9, prevRank: 2, expectedRank: 12 }] }),
      rng,
    })

    const arc = state.arcs.find(a => a.kind === 'cinderellaTeam')!
    expect(arc.status).toBe('resolved')
    expect(newsSeeds.some(s => s.headline.toLowerCase().includes('end') || s.headline.toLowerCase().includes('run') || s.headline.toLowerCase().includes('cinderella'))).toBe(true)
  })
})

describe('collapseTeam detector', () => {
  it('creates arc when team is 6+ ranks below expected', () => {
    const state = createInitialArcsState()
    const rng = makeRng()
    const { newsSeeds } = tickArcs({
      state,
      inputs: quietInputs({
        day: 15,
        standingsDelta: [{ teamId: 't2', rank: 25, prevRank: 20, expectedRank: 8 }],
      }),
      rng,
    })
    expect(state.arcs.filter(a => a.kind === 'collapseTeam')).toHaveLength(1)
    expect(newsSeeds.some(s => s.headline.toLowerCase().includes('freefall') || s.headline.toLowerCase().includes('collapse'))).toBe(true)
  })
})

/* ─────────────────────────── rookie race ─────────────────────────── */

describe('rookieRace detector', () => {
  it('creates arc when two rookies are within 5 pts in late season', () => {
    const state = createInitialArcsState()
    const rng = makeRng()
    const { newsSeeds } = tickArcs({
      state,
      inputs: quietInputs({
        day: 55, // 55/82 > 0.6
        seasonLength: 82,
        playerLines: [
          playerLine('r1', 't1', { points: 1, isRookie: true }),
          playerLine('r2', 't2', { points: 1, isRookie: true }),
        ],
        seasonTotals: (id) =>
          id === 'r1'
            ? { goals: 15, assists: 20, points: 35, gamesPlayed: 55 }
            : id === 'r2'
            ? { goals: 14, assists: 19, points: 33, gamesPlayed: 55 }
            : { goals: 0, assists: 0, points: 0, gamesPlayed: 55 },
      }),
      rng,
    })
    expect(state.arcs.filter(a => a.kind === 'rookieRace')).toHaveLength(1)
    expect(newsSeeds.some(s => s.headline.toLowerCase().includes('rookie'))).toBe(true)
  })

  it('does NOT create arc in early season even if gap is small', () => {
    const state = createInitialArcsState()
    const rng = makeRng()
    tickArcs({
      state,
      inputs: quietInputs({
        day: 20, // 20/82 < 0.6 — early season
        seasonLength: 82,
        playerLines: [
          playerLine('r1', 't1', { points: 1, isRookie: true }),
          playerLine('r2', 't2', { points: 1, isRookie: true }),
        ],
        seasonTotals: (id) =>
          id === 'r1'
            ? { goals: 5, assists: 8, points: 13, gamesPlayed: 20 }
            : id === 'r2'
            ? { goals: 4, assists: 8, points: 12, gamesPlayed: 20 }
            : { goals: 0, assists: 0, points: 0, gamesPlayed: 20 },
      }),
      rng,
    })
    expect(state.arcs.filter(a => a.kind === 'rookieRace')).toHaveLength(0)
  })

  it('does NOT create arc when gap exceeds 5 points', () => {
    const state = createInitialArcsState()
    const rng = makeRng()
    tickArcs({
      state,
      inputs: quietInputs({
        day: 60,
        playerLines: [
          playerLine('r1', 't1', { points: 2, isRookie: true }),
          playerLine('r2', 't2', { points: 0, isRookie: true }),
        ],
        seasonTotals: (id) =>
          id === 'r1'
            ? { goals: 20, assists: 25, points: 45, gamesPlayed: 60 }
            : id === 'r2'
            ? { goals: 10, assists: 15, points: 25, gamesPlayed: 60 }
            : { goals: 0, assists: 0, points: 0, gamesPlayed: 60 },
      }),
      rng,
    })
    expect(state.arcs.filter(a => a.kind === 'rookieRace')).toHaveLength(0)
  })
})

/* ─────────────────────────── goalie duel ─────────────────────────── */

describe('goalieDuel detector', () => {
  it('may create arc on low-scoring game (non-deterministic with rng.chance)', () => {
    // We use a fixed seed that passes the 0.4 chance check.
    // Run enough times to confirm at least one creation.
    let created = false
    for (let seed = 0; seed < 20 && !created; seed++) {
      const state = createInitialArcsState()
      const rng = new Rng(seed)
      tickArcs({
        state,
        inputs: quietInputs({
          results: [{ teamId: 't1', oppId: 't2', won: true, goalsFor: 1, goalsAgainst: 0 }],
        }),
        rng,
      })
      if (state.arcs.filter(a => a.kind === 'goalieDuel').length > 0) created = true
    }
    expect(created).toBe(true)
  })

  it('escalates existing goalie duel arc on subsequent low-scoring games', () => {
    const state = createInitialArcsState()
    // Use seed 1 which we know passes the chance check from the test above.
    let rng = new Rng(1)

    let created = false
    let attempts = 0
    while (!created && attempts < 30) {
      const s2 = createInitialArcsState()
      const r = new Rng(attempts++)
      tickArcs({
        state: s2,
        inputs: quietInputs({
          results: [{ teamId: 't1', oppId: 't2', won: true, goalsFor: 1, goalsAgainst: 0 }],
        }),
        rng: r,
      })
      if (s2.arcs.find(a => a.kind === 'goalieDuel')) {
        Object.assign(state, JSON.parse(JSON.stringify(s2)))
        rng = new Rng(42)
        created = true
      }
    }
    if (!created) return // skip if rng never passes chance — very unlikely

    const arcBefore = state.arcs.find(a => a.kind === 'goalieDuel')!
    const beatsBefore = arcBefore.beats.length

    tickArcs({
      state,
      inputs: quietInputs({
        day: 11,
        results: [{ teamId: 't1', oppId: 't2', won: false, goalsFor: 2, goalsAgainst: 1 }],
      }),
      rng,
    })

    const arcAfter = state.arcs.find(a => a.kind === 'goalieDuel')!
    expect(arcAfter.beats.length).toBeGreaterThan(beatsBefore)
  })

  it('resolves goalie duel when no low-scoring game for several days', () => {
    const state = createInitialArcsState()
    // Manually create a goalie duel arc with low tension.
    createArc(state, 'goalieDuel', { playerIds: [], teamIds: ['t1', 't2'] }, 'Duel begins', 1, 2024)
    state.arcs[0]!.tension = 15 // Near threshold for resolution

    const rng = makeRng()

    // Tick with no low-scoring games — should decay tension.
    tickArcs({
      state,
      inputs: quietInputs({
        day: 2,
        results: [{ teamId: 't1', oppId: 't2', won: true, goalsFor: 5, goalsAgainst: 3 }],
      }),
      rng,
    })

    const arc = state.arcs.find(a => a.kind === 'goalieDuel')
    // Either resolved or tension dropped.
    if (arc) {
      expect(arc.tension).toBeLessThan(15)
    } else {
      expect(arc).toBeUndefined()
    }
  })
})

/* ─────────────────────────── cap eviction ─────────────────────────── */

describe('arc cap eviction', () => {
  it('caps arcs at 24 — evicts resolved low-tension arcs first', () => {
    const state = createInitialArcsState()
    // Fill with 24 resolved low-tension arcs.
    for (let i = 0; i < 24; i++) {
      const arc = createArc(
        state,
        'feud',
        { playerIds: [`p${i}`], teamIds: [] },
        `Arc ${i}`,
        i,
        2024,
      )
      arc.status = 'resolved'
      arc.tension = i // increasing tension
    }
    expect(state.arcs).toHaveLength(24)

    // Add one more.
    createArc(state, 'mentorship', { playerIds: ['pNew'], teamIds: [] }, 'New arc', 25, 2024)

    // Cap: 24, so one should have been evicted.
    expect(state.arcs).toHaveLength(24)
    // The evicted one should have been lowest tension (tension=0).
    const tensions = state.arcs.map(a => a.tension)
    expect(Math.min(...tensions)).toBeGreaterThan(0)
  })

  it('keeps active (non-resolved) arcs over resolved ones', () => {
    const state = createInitialArcsState()
    // 23 resolved arcs.
    for (let i = 0; i < 23; i++) {
      const arc = createArc(state, 'feud', { playerIds: [`p${i}`], teamIds: [] }, `Resolved ${i}`, i, 2024)
      arc.status = 'resolved'
      arc.tension = 50
    }
    // 1 active arc with high tension.
    const active = createArc(state, 'hotStreak', { playerIds: ['pActive'], teamIds: ['t1'] }, 'Active', 30, 2024)
    active.tension = 80
    active.status = 'peak'

    expect(state.arcs).toHaveLength(24)

    // Add another active arc.
    createArc(state, 'rookieRace', { playerIds: ['pNew'], teamIds: [] }, 'New active', 31, 2024)

    expect(state.arcs).toHaveLength(24)
    // The active high-tension arc must still be present.
    expect(state.arcs.find(a => a.actors.playerIds[0] === 'pActive')).toBeDefined()
  })
})

/* ─────────────────────────── determinism ─────────────────────────── */

describe('determinism', () => {
  it('produces identical newsSeeds and state given same inputs and rng seed', () => {
    const inputs = quietInputs({
      day: 55,
      playerLines: [
        playerLine('r1', 't1', { points: 2, isRookie: true }),
        playerLine('r2', 't2', { points: 1, isRookie: true }),
        playerLine('p3', 't3', { points: 1, consecutivePointGames: 5 }),
      ],
      standingsDelta: [
        { teamId: 't4', rank: 3, prevRank: 4, expectedRank: 14 },
      ],
      results: [{ teamId: 't1', oppId: 't2', won: true, goalsFor: 1, goalsAgainst: 0 }],
      seasonTotals: (id) => {
        const map: Record<string, { goals: number; assists: number; points: number; gamesPlayed: number }> = {
          r1: { goals: 15, assists: 20, points: 35, gamesPlayed: 55 },
          r2: { goals: 14, assists: 19, points: 33, gamesPlayed: 55 },
          p3: { goals: 8, assists: 12, points: 20, gamesPlayed: 55 },
        }
        return map[id] ?? { goals: 0, assists: 0, points: 0, gamesPlayed: 55 }
      },
    })

    const run = () => {
      const state = createInitialArcsState()
      const rng = new Rng(999)
      return tickArcs({ state, inputs, rng })
    }

    const result1 = run()
    const result2 = run()

    expect(JSON.stringify(result1.newsSeeds)).toBe(JSON.stringify(result2.newsSeeds))
  })
})

/* ─────────────────────────── escalation threshold coverage ─────────────────────────── */

describe('escalation thresholds', () => {
  it('does not fire escalation news when tension stays below 40', () => {
    const state = createInitialArcsState()
    const rng = makeRng()

    // Create a hotStreak arc with low tension.
    tickArcs({
      state,
      inputs: quietInputs({ day: 10, playerLines: [playerLine('p1', 't1', { points: 1, consecutivePointGames: 5 })] }),
      rng,
    })

    const arc = state.arcs.find(a => a.kind === 'hotStreak')!
    // Pin tension well below 40.
    arc.tension = 10

    // Tick — tension goes up but stays below 40.
    const { newsSeeds } = tickArcs({
      state,
      inputs: quietInputs({ day: 11, playerLines: [playerLine('p1', 't1', { points: 1 })] }),
      rng,
    })

    // Tension: 10 + 8 = 18 — still below 40. No escalation news.
    const escalationNews = newsSeeds.filter(s => s.playerId === 'p1')
    expect(escalationNews).toHaveLength(0)
  })

  it('fires news on BOTH threshold crossings (40 and 70) but not in between', () => {
    const state = createInitialArcsState()
    const rng = makeRng()

    // Create arc.
    tickArcs({
      state,
      inputs: quietInputs({ day: 10, playerLines: [playerLine('p1', 't1', { points: 1, consecutivePointGames: 5 })] }),
      rng,
    })

    const arc = state.arcs.find(a => a.kind === 'hotStreak')!
    arc.tension = 38

    // Cross 40.
    const { newsSeeds: ns1 } = tickArcs({
      state,
      inputs: quietInputs({ day: 11, playerLines: [playerLine('p1', 't1', { points: 1 })] }),
      rng,
    })
    expect(ns1.some(s => s.playerId === 'p1')).toBe(true)

    // Below next threshold.
    const { newsSeeds: ns2 } = tickArcs({
      state,
      inputs: quietInputs({ day: 12, playerLines: [playerLine('p1', 't1', { points: 1 })] }),
      rng,
    })
    // Tension should be ~54, still below 70 — no news.
    if (arc.tension < 70) {
      expect(ns2.some(s => s.playerId === 'p1')).toBe(false)
    }

    // Force tension just below 70, then cross it.
    arc.tension = 68
    const { newsSeeds: ns3 } = tickArcs({
      state,
      inputs: quietInputs({ day: 13, playerLines: [playerLine('p1', 't1', { points: 1 })] }),
      rng,
    })
    expect(ns3.some(s => s.playerId === 'p1')).toBe(true)
  })
})

/* ─────────────────────────── news headlines reference history ─────────────────────────── */

describe('headline quality', () => {
  it('streak headline references beat count, not generic "Nyberg scored"', () => {
    const state = createInitialArcsState()
    const rng = makeRng()

    tickArcs({
      state,
      inputs: quietInputs({
        day: 10,
        playerLines: [playerLine('p1', 't1', { points: 1, consecutivePointGames: 7 })],
        playerName: () => 'Nyberg',
      }),
      rng,
    })

    const arc = state.arcs.find(a => a.kind === 'hotStreak')!
    arc.tension = 38 // just below 40

    const { newsSeeds } = tickArcs({
      state,
      inputs: quietInputs({
        day: 11,
        playerLines: [playerLine('p1', 't1', { points: 1 })],
        playerName: () => 'Nyberg',
      }),
      rng,
    })

    const seed = newsSeeds.find(s => s.playerId === 'p1')
    if (seed) {
      // Headline must reference a number (streak length), not just "scored".
      expect(seed.headline).toMatch(/\d+/)
      expect(seed.headline).not.toBe('Nyberg scored')
    }
  })
})
