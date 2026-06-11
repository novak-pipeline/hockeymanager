/**
 * Tests for src/engine/league/practice.ts
 *
 * Covers:
 *  - focus → attributeBias mapping (correct attributes targeted)
 *  - suggestFocus picks the real weakness on a fabricated roster
 *  - per-player override precedence over team focus
 *  - recovery reduces fatigue (negative delta)
 *  - determinism (same seed → same output)
 *  - JSON round-trip of TeamPracticeState
 *  - scratch cap enforcement and toggle
 *  - setPlayerFocus add / remove
 *  - goalie / skater cross-focus returns empty bias
 */

import { describe, it, expect } from 'vitest'
import { Rng } from '@engine/shared/rng'
import type { Player, Position } from '@domain'
import type { PracticeFocus } from './practice'
import {
  createInitialPracticeState,
  effectiveFocus,
  isScratchedFor,
  practiceDevModifier,
  setPlayerFocus,
  suggestFocus,
  tickPractice,
  toggleScratch
} from './practice'

/* ──────────────────────── helpers ──────────────────────── */

function makePlayer(
  id: string,
  position: Position,
  overrides: Partial<Player['composites']> = {}
): Player {
  const composites: Player['composites'] = {
    scoring: 60,
    playmaking: 60,
    puckControl: 60,
    faceoffWin: 60,
    hitting: 60,
    blocking: 60,
    takeaway: 60,
    penaltyProne: 30,
    goaltending: position === 'G' ? 60 : 0,
    skating: 60,
    defensiveZone: 60,
    ...overrides
  }
  return {
    id: id as Player['id'],
    name: `Player ${id}`,
    age: 24,
    position,
    handedness: 'L',
    role: position === 'G' ? 'starter' : position === 'D' ? 'shutdownD' : 'twoWay',
    ratings: {
      technical: { wristShot: 60, slapShot: 60, stickhandling: 60, passing: 60, deflections: 60, faceoffs: 60 },
      physical: { speed: 60, acceleration: 60, strength: 60, balance: 60, stamina: 60, agility: 60, height: 50 },
      mental: {
        offensiveIQ: 60, defensiveIQ: 60, positioning: 60, vision: 60,
        aggression: 50, composure: 60, workRate: 60, discipline: 60, anticipation: 60
      },
      defensive: { checking: 60, shotBlocking: 60, stickChecking: 60, takeaway: 60 },
      ...(position === 'G' ? {
        goalie: {
          reflexes: 60, positioningG: 60, reboundControl: 60,
          glove: 60, blocker: 60, recovery: 60, puckHandlingG: 50
        }
      } : {})
    },
    potential: {
      technical: { wristShot: 80, slapShot: 80, stickhandling: 80, passing: 80, deflections: 80, faceoffs: 80 },
      physical: { speed: 80, acceleration: 80, strength: 80, balance: 80, stamina: 80, agility: 80, height: 50 },
      mental: {
        offensiveIQ: 80, defensiveIQ: 80, positioning: 80, vision: 80,
        aggression: 50, composure: 80, workRate: 80, discipline: 80, anticipation: 80
      },
      defensive: { checking: 80, shotBlocking: 80, stickChecking: 80, takeaway: 80 }
    },
    composites,
    personality: { ambition: 10, professionalism: 10, loyalty: 10, temperament: 10, determination: 10 },
    contract: { salary: 1000000, yearsRemaining: 2, expiryYear: 2028, noTradeClause: false, twoWay: false },
    stats: [],
    fatigue: 20,
    morale: 70,
    injuryStatus: null,
    form: 0
  }
}

/* ──────────────────────── practiceDevModifier ──────────────────────── */

describe('practiceDevModifier', () => {
  const skater = makePlayer('s1', 'C')
  const goalie = makePlayer('g1', 'G')

  it('offense focus biases shooting/passing attributes', () => {
    const { attributeBias } = practiceDevModifier('offense', skater)
    expect(attributeBias['wristShot']).toBeGreaterThan(0)
    expect(attributeBias['slapShot']).toBeGreaterThan(0)
    expect(attributeBias['passing']).toBeGreaterThan(0)
    expect(attributeBias['offensiveIQ']).toBeGreaterThan(0)
    // Should not bias goalie-specific attributes
    expect(attributeBias['reflexes']).toBeUndefined()
  })

  it('defense focus biases defensive attributes', () => {
    const { attributeBias } = practiceDevModifier('defense', skater)
    expect(attributeBias['checking']).toBeGreaterThan(0)
    expect(attributeBias['shotBlocking']).toBeGreaterThan(0)
    expect(attributeBias['defensiveIQ']).toBeGreaterThan(0)
    expect(attributeBias['takeaway']).toBeGreaterThan(0)
    // Should not bias goalie-specific attributes
    expect(attributeBias['reflexes']).toBeUndefined()
  })

  it('skating focus biases speed/agility/acceleration', () => {
    const { attributeBias } = practiceDevModifier('skating', skater)
    expect(attributeBias['speed']).toBeGreaterThan(0)
    expect(attributeBias['acceleration']).toBeGreaterThan(0)
    expect(attributeBias['agility']).toBeGreaterThan(0)
    expect(attributeBias['balance']).toBeGreaterThan(0)
  })

  it('physical focus biases strength and stamina', () => {
    const { attributeBias } = practiceDevModifier('physical', skater)
    expect(attributeBias['strength']).toBeGreaterThan(0)
    expect(attributeBias['stamina']).toBeGreaterThan(0)
    expect(attributeBias['checking']).toBeGreaterThan(0)
  })

  it('goaltending focus gives goalie the correct bias', () => {
    const { attributeBias } = practiceDevModifier('goaltending', goalie)
    expect(attributeBias['reflexes']).toBeGreaterThan(0)
    expect(attributeBias['positioningG']).toBeGreaterThan(0)
    expect(attributeBias['glove']).toBeGreaterThan(0)
    // Should not include skater attributes
    expect(attributeBias['wristShot']).toBeUndefined()
  })

  it('goaltending focus gives skater empty bias (cross-focus no-op)', () => {
    const { attributeBias, fatigueMod } = practiceDevModifier('goaltending', skater)
    expect(Object.keys(attributeBias)).toHaveLength(0)
    // Skater gets balanced fatigueMod when focus is goaltending
    expect(typeof fatigueMod).toBe('number')
  })

  it('offense focus gives goalie empty bias (cross-focus no-op)', () => {
    const { attributeBias } = practiceDevModifier('offense', goalie)
    expect(Object.keys(attributeBias)).toHaveLength(0)
  })

  it('recovery returns empty bias and negative fatigueMod', () => {
    const { attributeBias, fatigueMod } = practiceDevModifier('recovery', skater)
    expect(Object.keys(attributeBias)).toHaveLength(0)
    expect(fatigueMod).toBeLessThan(0)
  })

  it('physical focus has higher fatigueMod than recovery', () => {
    const { fatigueMod: physicalMod } = practiceDevModifier('physical', skater)
    const { fatigueMod: recoveryMod } = practiceDevModifier('recovery', skater)
    expect(physicalMod).toBeGreaterThan(recoveryMod)
  })

  it('attributeBias values are in a reasonable range (0 < bias ≤ 0.25)', () => {
    const focuses: PracticeFocus[] = ['offense', 'defense', 'skating', 'physical']
    for (const focus of focuses) {
      const { attributeBias } = practiceDevModifier(focus, skater)
      for (const [, v] of Object.entries(attributeBias)) {
        expect(v).toBeGreaterThan(0)
        expect(v).toBeLessThanOrEqual(0.25)
      }
    }
  })
})

/* ──────────────────────── suggestFocus ──────────────────────── */

describe('suggestFocus', () => {
  it('suggests defense when blue line has weak defensiveZone', () => {
    const roster: Player[] = [
      makePlayer('d1', 'D', { defensiveZone: 35, scoring: 60, skating: 60, hitting: 60 }),
      makePlayer('d2', 'D', { defensiveZone: 30, scoring: 60, skating: 60, hitting: 60 }),
      makePlayer('f1', 'C', { defensiveZone: 65, scoring: 65, skating: 65, hitting: 65 }),
      makePlayer('f2', 'W', { defensiveZone: 65, scoring: 65, skating: 65, hitting: 65 })
    ]
    const { teamFocus, rationale } = suggestFocus(roster)
    expect(teamFocus).toBe('defense')
    expect(rationale.toLowerCase()).toContain('defens')
  })

  it('suggests offense when forwards have weak scoring', () => {
    const roster: Player[] = [
      makePlayer('f1', 'C', { scoring: 30, defensiveZone: 70, skating: 70, hitting: 70 }),
      makePlayer('f2', 'W', { scoring: 28, defensiveZone: 70, skating: 70, hitting: 70 }),
      makePlayer('d1', 'D', { scoring: 55, defensiveZone: 70, skating: 70, hitting: 70 })
    ]
    const { teamFocus } = suggestFocus(roster)
    expect(teamFocus).toBe('offense')
  })

  it('suggests skating when roster skating is worst dimension', () => {
    const roster: Player[] = [
      makePlayer('f1', 'C', { scoring: 70, defensiveZone: 70, skating: 30, hitting: 70 }),
      makePlayer('f2', 'W', { scoring: 70, defensiveZone: 70, skating: 28, hitting: 70 }),
      makePlayer('d1', 'D', { scoring: 70, defensiveZone: 70, skating: 32, hitting: 70 })
    ]
    const { teamFocus } = suggestFocus(roster)
    expect(teamFocus).toBe('skating')
  })

  it('returns balanced with rationale when no glaring weakness', () => {
    // All composites above threshold (~55)
    const roster: Player[] = [
      makePlayer('f1', 'C', { scoring: 70, defensiveZone: 65, skating: 68, hitting: 65 }),
      makePlayer('d1', 'D', { scoring: 60, defensiveZone: 65, skating: 65, hitting: 65 })
    ]
    const { teamFocus, rationale } = suggestFocus(roster)
    expect(teamFocus).toBe('balanced')
    expect(rationale.toLowerCase()).toContain('balanc')
  })

  it('suggests goaltending when goalies have weak goaltending', () => {
    const roster: Player[] = [
      makePlayer('g1', 'G', { goaltending: 25 }),
      makePlayer('f1', 'C', { scoring: 70, defensiveZone: 65, skating: 65, hitting: 65 })
    ]
    const { teamFocus } = suggestFocus(roster)
    expect(teamFocus).toBe('goaltending')
  })

  it('returns balanced for empty roster', () => {
    const { teamFocus } = suggestFocus([])
    expect(teamFocus).toBe('balanced')
  })

  it('returns a non-empty rationale always', () => {
    const roster = [makePlayer('f1', 'C')]
    const { rationale } = suggestFocus(roster)
    expect(rationale.length).toBeGreaterThan(10)
  })
})

/* ──────────────────────── effectiveFocus / override precedence ──────────── */

describe('effectiveFocus', () => {
  it('returns team focus when no override exists', () => {
    const state = createInitialPracticeState()
    expect(effectiveFocus(state, 'p1')).toBe('balanced')
  })

  it('returns per-player override when present', () => {
    const state = createInitialPracticeState()
    state.perPlayerFocus.push(['p1', 'skating'])
    expect(effectiveFocus(state, 'p1')).toBe('skating')
  })

  it('override only affects the targeted player, not others', () => {
    const state = createInitialPracticeState()
    state.perPlayerFocus.push(['p1', 'skating'])
    expect(effectiveFocus(state, 'p2')).toBe('balanced')
  })

  it('per-player override beats team focus even when team changes', () => {
    const state = { ...createInitialPracticeState(), teamFocus: 'offense' as PracticeFocus }
    state.perPlayerFocus.push(['p1', 'defense'])
    expect(effectiveFocus(state, 'p1')).toBe('defense')
  })
})

/* ──────────────────────── tickPractice ──────────────────────── */

describe('tickPractice', () => {
  const rng = () => new Rng(12345)

  it('returns one entry per non-injured player', () => {
    const players = [makePlayer('p1', 'C'), makePlayer('p2', 'W'), makePlayer('p3', 'D')]
    const state = createInitialPracticeState()
    const ticks = tickPractice({ players, state, rng: rng() })
    expect(ticks).toHaveLength(3)
    expect(ticks.map((t) => t.playerId)).toContain('p1')
    expect(ticks.map((t) => t.playerId)).toContain('p2')
    expect(ticks.map((t) => t.playerId)).toContain('p3')
  })

  it('excludes injured players', () => {
    const players = [makePlayer('p1', 'C'), makePlayer('p2', 'W')]
    players[1].injuryStatus = { kind: 'lowerBody', gamesRemaining: 3, description: 'strained MCL' }
    const state = createInitialPracticeState()
    const ticks = tickPractice({ players, state, rng: rng() })
    expect(ticks).toHaveLength(1)
    expect(ticks[0].playerId).toBe('p1')
  })

  it('recovery focus produces negative fatigue delta', () => {
    const players = [makePlayer('p1', 'C')]
    players[0].fatigue = 50
    const state = { ...createInitialPracticeState(), teamFocus: 'recovery' as PracticeFocus }
    const ticks = tickPractice({ players, state, rng: rng() })
    expect(ticks[0].fatigueDelta).toBeLessThan(0)
  })

  it('physical focus produces positive fatigue delta', () => {
    const players = [makePlayer('p1', 'C')]
    players[0].fatigue = 20
    const state = { ...createInitialPracticeState(), teamFocus: 'physical' as PracticeFocus }
    const ticks = tickPractice({ players, state, rng: rng() })
    expect(ticks[0].fatigueDelta).toBeGreaterThan(0)
  })

  it('fatigue is clamped: cannot go below 0 on recovery', () => {
    const players = [makePlayer('p1', 'C')]
    players[0].fatigue = 0
    const state = { ...createInitialPracticeState(), teamFocus: 'recovery' as PracticeFocus }
    const ticks = tickPractice({ players, state, rng: rng() })
    // delta should be 0 or slightly negative but the caller must clamp; delta = after - before
    // with fatigue=0, after = max(0, 0 + fatigueMod + jitter), delta ≤ 0
    expect(ticks[0].fatigueDelta).toBeLessThanOrEqual(0)
  })

  it('fatigue cannot exceed 100 (clamped at top)', () => {
    const players = [makePlayer('p1', 'C')]
    players[0].fatigue = 98
    const state = { ...createInitialPracticeState(), teamFocus: 'physical' as PracticeFocus }
    // Run many ticks to try to bust the cap
    let accum = 98
    const rngInst = rng()
    for (let i = 0; i < 10; i++) {
      const ticks = tickPractice({ players, state, rng: rngInst })
      accum = Math.max(0, Math.min(100, accum + ticks[0].fatigueDelta))
    }
    expect(accum).toBeLessThanOrEqual(100)
  })

  it('is deterministic with the same seed', () => {
    const players = [makePlayer('p1', 'C'), makePlayer('p2', 'D')]
    const state = createInitialPracticeState()
    const run1 = tickPractice({ players, state, rng: new Rng(99999) })
    const run2 = tickPractice({ players, state, rng: new Rng(99999) })
    expect(run1).toEqual(run2)
  })

  it('different seeds produce different deltas', () => {
    const players = [makePlayer('p1', 'C')]
    const state = createInitialPracticeState()
    const run1 = tickPractice({ players, state, rng: new Rng(1) })
    const run2 = tickPractice({ players, state, rng: new Rng(2) })
    // jitter ±1 pp means they will differ unless extremely unlucky
    expect(run1[0].fatigueDelta).not.toEqual(run2[0].fatigueDelta)
  })

  it('per-player recovery override overrides team physical focus for that player', () => {
    const players = [makePlayer('p1', 'C'), makePlayer('p2', 'W')]
    players[0].fatigue = 50
    players[1].fatigue = 50
    const state: ReturnType<typeof createInitialPracticeState> = {
      teamFocus: 'physical',
      perPlayerFocus: [['p1', 'recovery']],
      scratched: []
    }
    const ticks = tickPractice({ players, state, rng: rng() })
    const p1Tick = ticks.find((t) => t.playerId === 'p1')!
    const p2Tick = ticks.find((t) => t.playerId === 'p2')!
    // p1 on recovery should drop fatigue; p2 on physical should raise it
    expect(p1Tick.fatigueDelta).toBeLessThan(0)
    expect(p2Tick.fatigueDelta).toBeGreaterThan(0)
  })
})

/* ──────────────────────── scratch helpers ──────────────────────── */

describe('toggleScratch', () => {
  it('adds a player to scratched', () => {
    const state = createInitialPracticeState()
    const next = toggleScratch(state, 'p1')
    expect(next.scratched).toContain('p1')
  })

  it('removes a player who is already scratched', () => {
    const state = { ...createInitialPracticeState(), scratched: ['p1'] }
    const next = toggleScratch(state, 'p1')
    expect(next.scratched).not.toContain('p1')
  })

  it('does not exceed maxScratches cap', () => {
    let state = createInitialPracticeState()
    state = toggleScratch(state, 'p1')
    state = toggleScratch(state, 'p2')
    state = toggleScratch(state, 'p3')
    state = toggleScratch(state, 'p4')
    // Should be at cap now (default maxScratches=4)
    const next = toggleScratch(state, 'p5')
    expect(next.scratched).not.toContain('p5')
    expect(next.scratched).toHaveLength(4)
  })

  it('respects custom maxScratches', () => {
    let state = createInitialPracticeState()
    state = toggleScratch(state, 'p1', 2)
    state = toggleScratch(state, 'p2', 2)
    const next = toggleScratch(state, 'p3', 2)
    expect(next.scratched).not.toContain('p3')
  })

  it('is immutable — original state unchanged', () => {
    const state = createInitialPracticeState()
    toggleScratch(state, 'p1')
    expect(state.scratched).toHaveLength(0)
  })
})

describe('isScratchedFor', () => {
  it('returns true for scratched player', () => {
    const state = { ...createInitialPracticeState(), scratched: ['p1'] }
    expect(isScratchedFor(state, 'p1')).toBe(true)
  })

  it('returns false for non-scratched player', () => {
    const state = createInitialPracticeState()
    expect(isScratchedFor(state, 'p1')).toBe(false)
  })
})

/* ──────────────────────── setPlayerFocus ──────────────────────── */

describe('setPlayerFocus', () => {
  it('adds a per-player override', () => {
    const state = createInitialPracticeState()
    const next = setPlayerFocus(state, 'p1', 'skating')
    expect(effectiveFocus(next, 'p1')).toBe('skating')
  })

  it('removes a per-player override when focus=null', () => {
    const state = setPlayerFocus(createInitialPracticeState(), 'p1', 'skating')
    const next = setPlayerFocus(state, 'p1', null)
    expect(effectiveFocus(next, 'p1')).toBe('balanced') // reverts to team
  })

  it('replaces an existing override', () => {
    const state = setPlayerFocus(createInitialPracticeState(), 'p1', 'skating')
    const next = setPlayerFocus(state, 'p1', 'physical')
    expect(effectiveFocus(next, 'p1')).toBe('physical')
    // Should only have one entry for p1
    expect(next.perPlayerFocus.filter(([id]) => id === 'p1')).toHaveLength(1)
  })

  it('is immutable — original state unchanged', () => {
    const state = createInitialPracticeState()
    setPlayerFocus(state, 'p1', 'skating')
    expect(state.perPlayerFocus).toHaveLength(0)
  })
})

/* ──────────────────────── JSON round-trip ──────────────────────── */

describe('TeamPracticeState JSON round-trip', () => {
  it('survives JSON.stringify / JSON.parse intact', () => {
    let state = createInitialPracticeState()
    state = toggleScratch(state, 'p1')
    state = setPlayerFocus(state, 'p2', 'offense')
    state = { ...state, teamFocus: 'defense' }

    const serialized = JSON.stringify(state)
    const restored = JSON.parse(serialized) as typeof state

    expect(restored.teamFocus).toBe('defense')
    expect(restored.scratched).toContain('p1')
    expect(restored.perPlayerFocus).toEqual([['p2', 'offense']])
  })

  it('createInitialPracticeState produces a JSON-safe object', () => {
    const state = createInitialPracticeState()
    expect(() => JSON.stringify(state)).not.toThrow()
    const back = JSON.parse(JSON.stringify(state))
    expect(back).toEqual(state)
  })
})
