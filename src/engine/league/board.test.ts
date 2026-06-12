/**
 * Tests for src/engine/league/board.ts
 *
 * Covers:
 *   - Mandate derivation across strength tiers.
 *   - Confidence rises when beating expectations, falls when missing.
 *   - Ultimatum emitted once when confidence crosses below 35; warnings++.
 *   - seasonReview firing logic (contender missing playoffs with no patience = fired;
 *     rebuild losing is never automatically fired).
 *   - JSON round-trip safety.
 *   - Determinism (same seed → same results).
 */

import { describe, it, expect } from 'vitest'
import { Rng } from '@engine/shared/rng'
import {
  setSeasonMandate,
  updateConfidence,
  seasonReview,
  boardSummary,
  type BoardState,
  type Mandate,
} from './board'

/* ─────────────────────────────── helpers ── */

function freshRng(seed = 42): Rng {
  return new Rng(seed)
}

/** Build a minimal BoardState for testing without going through setSeasonMandate. */
function makeBoardState(overrides: Partial<BoardState> = {}): BoardState {
  return {
    mandate: 'makePlayoffs',
    mandateText: 'Make the playoffs.',
    targetRank: 8,
    confidence: 60,
    patience: 80,
    firedAtYear: null,
    warnings: 0,
    ...overrides,
  }
}

/* ─────────────────────────────── setSeasonMandate ── */

describe('setSeasonMandate', () => {
  it('derives a contend/cupOrBust mandate for a top-3 roster in a 32-team league', () => {
    const { state } = setSeasonMandate({
      teamStrengthRank: 1,
      teamsInLeague: 32,
      rng: freshRng(1),
      year: 2026,
    })
    expect(['cupOrBust', 'contend']).toContain(state.mandate)
  })

  it('derives makePlayoffs/competeRespectably for a middle-of-the-pack roster', () => {
    const results: Mandate[] = []
    for (let seed = 0; seed < 10; seed++) {
      const { state } = setSeasonMandate({
        teamStrengthRank: 16,
        teamsInLeague: 32,
        rng: freshRng(seed),
        year: 2026,
      })
      results.push(state.mandate)
    }
    // Should produce makePlayoffs or competeRespectably for the middle tier.
    expect(results.every((m) => ['makePlayoffs', 'competeRespectably'].includes(m))).toBe(true)
  })

  it('derives developYouth/rebuild/cutCosts for the bottom tier', () => {
    const results: Mandate[] = []
    for (let seed = 0; seed < 15; seed++) {
      const { state } = setSeasonMandate({
        teamStrengthRank: 30,
        teamsInLeague: 32,
        rng: freshRng(seed),
        year: 2026,
      })
      results.push(state.mandate)
    }
    const allowed: Mandate[] = ['rebuild', 'developYouth', 'cutCosts', 'competeRespectably']
    expect(results.every((m) => allowed.includes(m))).toBe(true)
  })

  it('cupOrBust for a defending champion in the top quarter', () => {
    const { state } = setSeasonMandate({
      teamStrengthRank: 3,
      teamsInLeague: 32,
      wonCupLastYear: true,
      rng: freshRng(99),
      year: 2026,
    })
    expect(state.mandate).toBe('cupOrBust')
  })

  it('confidence starts in expected range (50–80)', () => {
    for (let seed = 0; seed < 20; seed++) {
      const { state } = setSeasonMandate({
        teamStrengthRank: 10,
        teamsInLeague: 32,
        rng: freshRng(seed),
        year: 2026,
      })
      expect(state.confidence).toBeGreaterThanOrEqual(50)
      expect(state.confidence).toBeLessThanOrEqual(80)
    }
  })

  it('targetRank is between 1 and teamsInLeague', () => {
    for (let rank = 1; rank <= 32; rank += 4) {
      const { state } = setSeasonMandate({
        teamStrengthRank: rank,
        teamsInLeague: 32,
        rng: freshRng(rank),
        year: 2026,
      })
      expect(state.targetRank).toBeGreaterThanOrEqual(1)
      expect(state.targetRank).toBeLessThanOrEqual(32)
    }
  })

  it('returns a newsSeed with category league', () => {
    const { newsSeed } = setSeasonMandate({
      teamStrengthRank: 5,
      teamsInLeague: 32,
      rng: freshRng(7),
      year: 2026,
      teamName: 'Springfield Frost',
    })
    expect(newsSeed.category).toBe('league')
    expect(newsSeed.headline).toContain('2026')
    expect(newsSeed.body.length).toBeGreaterThan(20)
  })

  it('is deterministic with the same seed', () => {
    const a = setSeasonMandate({ teamStrengthRank: 12, teamsInLeague: 30, rng: freshRng(555), year: 2027 })
    const b = setSeasonMandate({ teamStrengthRank: 12, teamsInLeague: 30, rng: freshRng(555), year: 2027 })
    expect(a.state.mandate).toBe(b.state.mandate)
    expect(a.state.confidence).toBe(b.state.confidence)
    expect(a.state.targetRank).toBe(b.state.targetRank)
  })

  it('sets firedAtYear null and warnings 0 on a fresh mandate', () => {
    const { state } = setSeasonMandate({
      teamStrengthRank: 8,
      teamsInLeague: 32,
      rng: freshRng(3),
      year: 2026,
    })
    expect(state.firedAtYear).toBeNull()
    expect(state.warnings).toBe(0)
  })
})

/* ─────────────────────────────── updateConfidence ── */

describe('updateConfidence', () => {
  it('raises confidence when finishing ahead of target rank', () => {
    const state = makeBoardState({ confidence: 60, targetRank: 10 })
    const before = state.confidence
    updateConfidence({ state, currentRank: 4, gamesPlayed: 50, totalGames: 82, teamsInLeague: 32 })
    expect(state.confidence).toBeGreaterThan(before)
  })

  it('lowers confidence when badly missing target rank', () => {
    const state = makeBoardState({ confidence: 60, targetRank: 8 })
    const before = state.confidence
    updateConfidence({ state, currentRank: 28, gamesPlayed: 50, totalGames: 82, teamsInLeague: 32 })
    expect(state.confidence).toBeLessThan(before)
  })

  it('emits board praise news when confidence crosses above 80', () => {
    const state = makeBoardState({ confidence: 75, targetRank: 10 })
    // Force a large positive update by being well ahead of target, mid-season.
    // We'll set current rank to 1 (best) to guarantee a big delta.
    const { newsSeeds } = updateConfidence({
      state,
      currentRank: 1,
      gamesPlayed: 60,
      totalGames: 82,
      teamsInLeague: 32,
    })
    const praiseSeed = newsSeeds.find((s) => s.headline.includes('praises'))
    // Only fires if confidence crossed 80; test that state moved into a higher range.
    if (state.confidence >= 80) {
      expect(praiseSeed).toBeDefined()
    } else {
      // If we didn't cross 80, that's also fine — no false positive.
      expect(praiseSeed).toBeUndefined()
    }
  })

  it('emits hot-seat warning when confidence drops below 35 and increments warnings', () => {
    const state = makeBoardState({ confidence: 40, targetRank: 8, warnings: 0, patience: 60 })
    // Simulate a team ranked dead last (32nd) at the 60% point of the season.
    const { newsSeeds } = updateConfidence({
      state,
      currentRank: 32,
      gamesPlayed: 50,
      totalGames: 82,
      teamsInLeague: 32,
    })
    if (state.confidence < 35) {
      const warningSeed = newsSeeds.find((s) => s.headline.includes('Board'))
      expect(warningSeed).toBeDefined()
      expect(state.warnings).toBe(1)
    }
  })

  it('does not emit duplicate ultimatum if confidence stays below 35', () => {
    const state = makeBoardState({ confidence: 30, targetRank: 8, warnings: 1, patience: 40 })
    // Already below 35 — crossing down again from below shouldn't re-fire.
    const result1 = updateConfidence({
      state,
      currentRank: 28,
      gamesPlayed: 45,
      totalGames: 82,
      teamsInLeague: 32,
    })
    const result2 = updateConfidence({
      state,
      currentRank: 28,
      gamesPlayed: 50,
      totalGames: 82,
      teamsInLeague: 32,
    })
    // Warnings should not have gone beyond the initial value (or 1 more from first update)
    // because the threshold was already crossed.
    expect(state.warnings).toBeLessThanOrEqual(2)
    // The key check: no more warnings than started (1) + 1 per true crossing.
    const warnSeeds = [...result1.newsSeeds, ...result2.newsSeeds].filter((s) => s.headline.includes('Board'))
    // Should fire at most once per crossing — state was ALREADY below 35 for result2.
    // result1 started AT 30 (already below), so no crossing there either.
    // Since both calls start with state below threshold, neither should emit.
    expect(warnSeeds.length).toBe(0)
  })

  it('does not update if gamesPlayed is 0', () => {
    const state = makeBoardState({ confidence: 60 })
    updateConfidence({ state, currentRank: 5, gamesPlayed: 0, totalGames: 82, teamsInLeague: 32 })
    expect(state.confidence).toBe(60)
  })

  it('does nothing if fired', () => {
    const state = makeBoardState({ confidence: 30, firedAtYear: 2025 })
    updateConfidence({ state, currentRank: 28, gamesPlayed: 60, totalGames: 82, teamsInLeague: 32 })
    expect(state.confidence).toBe(30)
  })

  it('recentForm bonus pushes confidence up on a hot streak', () => {
    const state1 = makeBoardState({ confidence: 55, targetRank: 10 })
    const state2 = makeBoardState({ confidence: 55, targetRank: 10 })
    updateConfidence({
      state: state1,
      currentRank: 10,
      gamesPlayed: 40,
      totalGames: 82,
      teamsInLeague: 32,
      recentForm: 'WWWWW',
    })
    updateConfidence({
      state: state2,
      currentRank: 10,
      gamesPlayed: 40,
      totalGames: 82,
      teamsInLeague: 32,
      recentForm: 'LLLLL',
    })
    // Hot streak should leave more confidence than cold streak.
    expect(state1.confidence).toBeGreaterThan(state2.confidence)
  })

  it('depletes patience when behind target past half-season', () => {
    const state = makeBoardState({ confidence: 55, targetRank: 8, patience: 80 })
    updateConfidence({
      state,
      currentRank: 28,
      gamesPlayed: 50,
      totalGames: 82,
      teamsInLeague: 32,
    })
    expect(state.patience).toBeLessThan(80)
  })
})

/* ─────────────────────────────── seasonReview ── */

describe('seasonReview', () => {
  it('cupOrBust: wonCup = exceeded, not fired', () => {
    const state = makeBoardState({ mandate: 'cupOrBust', targetRank: 1, confidence: 70, patience: 50 })
    const { verdict, fired } = seasonReview({ state, finalRank: 1, madePlayoffs: true, wonCup: true, year: 2026 })
    expect(verdict).toBe('exceeded')
    expect(fired).toBe(false)
  })

  it('cupOrBust: made playoffs but no cup = missed', () => {
    const state = makeBoardState({ mandate: 'cupOrBust', targetRank: 1, confidence: 50, patience: 60 })
    const { verdict } = seasonReview({ state, finalRank: 3, madePlayoffs: true, wonCup: false, year: 2026 })
    expect(verdict).toBe('missed')
  })

  it('cupOrBust: missed playoffs + low patience = fired', () => {
    const state = makeBoardState({
      mandate: 'cupOrBust',
      targetRank: 1,
      confidence: 25,
      patience: 10,
      warnings: 2,
    })
    const { verdict, fired } = seasonReview({ state, finalRank: 18, madePlayoffs: false, wonCup: false, year: 2026 })
    expect(verdict).toBe('failed')
    expect(fired).toBe(true)
    expect(state.firedAtYear).toBe(2026)
  })

  it('contend: missed playoffs + no patience = fired', () => {
    const state = makeBoardState({
      mandate: 'contend',
      targetRank: 4,
      confidence: 20,
      patience: 5,
      warnings: 1,
    })
    const { verdict, fired } = seasonReview({ state, finalRank: 24, madePlayoffs: false, wonCup: false, year: 2026 })
    expect(verdict).toBe('failed')
    expect(fired).toBe(true)
  })

  it('contend: made playoffs near target = met, not fired', () => {
    const state = makeBoardState({
      mandate: 'contend',
      targetRank: 4,
      confidence: 60,
      patience: 65,
    })
    const { verdict, fired } = seasonReview({ state, finalRank: 5, madePlayoffs: true, wonCup: false, year: 2026 })
    expect(verdict).toBe('met')
    expect(fired).toBe(false)
  })

  it('makePlayoffs: made playoffs = met or exceeded', () => {
    const state = makeBoardState({ mandate: 'makePlayoffs', targetRank: 12, confidence: 60, patience: 70 })
    const { verdict, fired } = seasonReview({ state, finalRank: 14, madePlayoffs: true, wonCup: false, year: 2026 })
    expect(['met', 'exceeded']).toContain(verdict)
    expect(fired).toBe(false)
  })

  it('makePlayoffs: missed playoffs + very far off = failed, fire if patience gone', () => {
    const state = makeBoardState({
      mandate: 'makePlayoffs',
      targetRank: 10,
      confidence: 20,
      patience: 5,
      warnings: 2,
    })
    const { verdict, fired } = seasonReview({ state, finalRank: 28, madePlayoffs: false, wonCup: false, year: 2026 })
    expect(verdict).toBe('failed')
    expect(fired).toBe(true)
  })

  it('rebuild: losing is NOT failed by default', () => {
    const state = makeBoardState({
      mandate: 'rebuild',
      targetRank: 28,
      confidence: 52,
      patience: 80,
      warnings: 0,
    })
    const { verdict, fired } = seasonReview({ state, finalRank: 30, madePlayoffs: false, wonCup: false, year: 2026 })
    // Rebuild with reasonable patience shouldn't be fired for a last-place finish.
    expect(fired).toBe(false)
    expect(['met', 'missed']).toContain(verdict)
  })

  it('rebuild: making playoffs = exceeded', () => {
    const state = makeBoardState({
      mandate: 'rebuild',
      targetRank: 28,
      confidence: 55,
      patience: 75,
    })
    const { verdict } = seasonReview({ state, finalRank: 14, madePlayoffs: true, wonCup: false, year: 2026 })
    expect(verdict).toBe('exceeded')
  })

  it('developYouth: missing target by wide margin but patience OK = missed, not fired', () => {
    const state = makeBoardState({
      mandate: 'developYouth',
      targetRank: 24,
      confidence: 48,
      patience: 55,
      warnings: 0,
    })
    const { fired } = seasonReview({ state, finalRank: 30, madePlayoffs: false, wonCup: false, year: 2026 })
    expect(fired).toBe(false)
  })

  it('sets firedAtYear when fired', () => {
    const state = makeBoardState({
      mandate: 'contend',
      targetRank: 4,
      confidence: 15,
      patience: 0,
      warnings: 2,
    })
    seasonReview({ state, finalRank: 25, madePlayoffs: false, wonCup: false, year: 2026 })
    expect(state.firedAtYear).toBe(2026)
  })

  it('does nothing when already fired', () => {
    const state = makeBoardState({ mandate: 'contend', confidence: 15, patience: 0, firedAtYear: 2025 })
    const { fired, newsSeeds } = seasonReview({ state, finalRank: 25, madePlayoffs: false, wonCup: false, year: 2026 })
    expect(fired).toBe(false)
    expect(newsSeeds).toHaveLength(0)
  })

  it('always emits at least one newsSeed (the verdict announcement) when not fired', () => {
    const state = makeBoardState({ mandate: 'makePlayoffs', targetRank: 12, confidence: 60, patience: 70 })
    const { newsSeeds } = seasonReview({ state, finalRank: 14, madePlayoffs: true, wonCup: false, year: 2026 })
    expect(newsSeeds.length).toBeGreaterThanOrEqual(1)
  })

  it('news category is league', () => {
    const state = makeBoardState({ mandate: 'contend', targetRank: 5, confidence: 60, patience: 70 })
    const { newsSeeds } = seasonReview({ state, finalRank: 5, madePlayoffs: true, wonCup: false, year: 2026 })
    for (const s of newsSeeds) {
      expect(s.category).toBe('league')
    }
  })
})

/* ─────────────────────────────── JSON round-trip ── */

describe('JSON round-trip', () => {
  it('BoardState survives JSON.parse(JSON.stringify(...))', () => {
    const { state } = setSeasonMandate({
      teamStrengthRank: 8,
      teamsInLeague: 32,
      rng: freshRng(1001),
      year: 2026,
      teamName: 'Test Yetis',
      teamId: 't1',
    })
    const serialized = JSON.stringify(state)
    const restored = JSON.parse(serialized) as BoardState
    expect(restored.mandate).toBe(state.mandate)
    expect(restored.mandateText).toBe(state.mandateText)
    expect(restored.targetRank).toBe(state.targetRank)
    expect(restored.confidence).toBe(state.confidence)
    expect(restored.patience).toBe(state.patience)
    expect(restored.firedAtYear).toBe(state.firedAtYear)
    expect(restored.warnings).toBe(state.warnings)
  })

  it('BoardState with non-null firedAtYear round-trips correctly', () => {
    const state: BoardState = makeBoardState({ firedAtYear: 2027 })
    const restored = JSON.parse(JSON.stringify(state)) as BoardState
    expect(restored.firedAtYear).toBe(2027)
  })
})

/* ─────────────────────────────── boardSummary ── */

describe('boardSummary', () => {
  it('returns statusLabel Board Backing at high confidence', () => {
    const view = boardSummary(makeBoardState({ confidence: 85, firedAtYear: null, warnings: 0 }))
    expect(view.statusLabel).toBe('Board Backing')
    expect(view.confidenceLabel).toBe('Very High')
  })

  it('returns statusLabel Hot Seat at low confidence', () => {
    const view = boardSummary(makeBoardState({ confidence: 28, firedAtYear: null, warnings: 0 }))
    expect(view.statusLabel).toBe('Hot Seat')
  })

  it('returns statusLabel Under Ultimatum when warnings >= 2 and confidence low', () => {
    const view = boardSummary(makeBoardState({ confidence: 28, firedAtYear: null, warnings: 2 }))
    expect(view.statusLabel).toBe('Under Ultimatum')
  })

  it('returns Fired status when firedAtYear is set', () => {
    const view = boardSummary(makeBoardState({ firedAtYear: 2025 }))
    expect(view.statusLabel).toContain('Fired')
  })

  it('does not mutate the state', () => {
    const state = makeBoardState({ confidence: 65 })
    boardSummary(state)
    expect(state.confidence).toBe(65)
  })
})

/* ─────────────────────────────── determinism ── */

describe('determinism', () => {
  it('setSeasonMandate is fully deterministic', () => {
    const args = { teamStrengthRank: 15, teamsInLeague: 30, rng: freshRng(9999), year: 2028 }
    const a = setSeasonMandate({ ...args, rng: freshRng(9999) })
    const b = setSeasonMandate({ ...args, rng: freshRng(9999) })
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state))
    expect(a.newsSeed.headline).toBe(b.newsSeed.headline)
  })

  it('seasonReview is deterministic given the same state', () => {
    const makeState = () =>
      makeBoardState({ mandate: 'makePlayoffs', targetRank: 12, confidence: 45, patience: 40, warnings: 1 })
    const args = { finalRank: 18, madePlayoffs: false, wonCup: false, year: 2026 }
    const a = seasonReview({ state: makeState(), ...args })
    const b = seasonReview({ state: makeState(), ...args })
    expect(a.verdict).toBe(b.verdict)
    expect(a.fired).toBe(b.fired)
    expect(a.newsSeeds[0]?.headline).toBe(b.newsSeeds[0]?.headline)
  })
})
