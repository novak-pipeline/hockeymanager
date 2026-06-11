/**
 * playerRating.test.ts
 *
 * Tests for the pure helpers in playerRating.ts.
 * No engine imports; no seeded Rng needed (all deterministic).
 */

import { describe, it, expect } from 'vitest'
import {
  emptyExtended,
  mergeExtended,
  gameRating,
  goalieGameRating,
  formString,
  seasonAvgRating,
  teamLeaders,
  type ExtendedStatLine,
  type TeamLeadersEntry,
} from './playerRating'

/* ─────────────────────────── emptyExtended ─────────────────────────── */

describe('emptyExtended', () => {
  it('returns all-zero stat line', () => {
    const e = emptyExtended()
    const fields: (keyof ExtendedStatLine)[] = [
      'goals', 'assists', 'shots', 'penaltyMinutes', 'toi', 'plusMinus',
      'hits', 'blockedShots', 'takeaways', 'giveaways',
      'saves', 'shotsAgainst', 'goalsAgainst',
    ]
    for (const f of fields) {
      expect(e[f], `field ${f}`).toBe(0)
    }
  })
})

/* ─────────────────────────── mergeExtended ──────────────────────────── */

describe('mergeExtended', () => {
  it('accumulates all fields', () => {
    const total = emptyExtended()
    const game: ExtendedStatLine = {
      goals: 1, assists: 2, shots: 4, penaltyMinutes: 2, toi: 900,
      plusMinus: 1, hits: 3, blockedShots: 2, takeaways: 1, giveaways: 1,
      saves: 0, shotsAgainst: 0, goalsAgainst: 0,
    }
    mergeExtended(total, game)
    expect(total.goals).toBe(1)
    expect(total.assists).toBe(2)
    expect(total.shots).toBe(4)
    expect(total.penaltyMinutes).toBe(2)
    expect(total.toi).toBe(900)
    expect(total.plusMinus).toBe(1)
    expect(total.hits).toBe(3)
    expect(total.blockedShots).toBe(2)
    expect(total.takeaways).toBe(1)
    expect(total.giveaways).toBe(1)
  })

  it('accumulates over multiple calls', () => {
    const total = emptyExtended()
    const game: ExtendedStatLine = {
      goals: 1, assists: 0, shots: 2, penaltyMinutes: 0, toi: 600,
      plusMinus: 0, hits: 1, blockedShots: 0, takeaways: 0, giveaways: 0,
      saves: 0, shotsAgainst: 0, goalsAgainst: 0,
    }
    mergeExtended(total, game)
    mergeExtended(total, game)
    expect(total.goals).toBe(2)
    expect(total.shots).toBe(4)
    expect(total.toi).toBe(1200)
  })

  it('returns the total reference', () => {
    const total = emptyExtended()
    const result = mergeExtended(total, emptyExtended())
    expect(result).toBe(total)
  })
})

/* ─────────────────────────── gameRating (skater) ───────────────────── */

describe('gameRating', () => {
  const baseArgs = {
    goals: 0,
    assists: 0,
    shots: 1,
    hits: 1,
    blockedShots: 0,
    takeaways: 0,
    giveaways: 0,
    plusMinus: 0,
    penaltyMinutes: 0,
    toi: 900,
    position: 'C' as const,
  }

  it('returns a number in [0, 10]', () => {
    const r = gameRating(baseArgs)
    expect(r).toBeGreaterThanOrEqual(0)
    expect(r).toBeLessThanOrEqual(10)
  })

  it('typical forward game is near 6.0', () => {
    const r = gameRating(baseArgs)
    expect(r).toBeGreaterThan(5)
    expect(r).toBeLessThan(7)
  })

  it('monotonic in goals — more goals = higher rating', () => {
    // Use minimal base stats so we do not prematurely hit the cap.
    const minBase = { ...baseArgs, shots: 0, hits: 0, toi: 600 }
    const r0 = gameRating({ ...minBase, goals: 0 })
    const r1 = gameRating({ ...minBase, goals: 1 })
    const r2 = gameRating({ ...minBase, goals: 2 })
    const r3 = gameRating({ ...minBase, goals: 3 })
    expect(r1).toBeGreaterThan(r0)
    expect(r2).toBeGreaterThan(r1)
    expect(r3).toBeGreaterThan(r2)
  })

  it('monotonic in assists — more assists = higher rating', () => {
    const r0 = gameRating({ ...baseArgs, assists: 0 })
    const r1 = gameRating({ ...baseArgs, assists: 1 })
    const r2 = gameRating({ ...baseArgs, assists: 2 })
    expect(r1).toBeGreaterThan(r0)
    expect(r2).toBeGreaterThan(r1)
  })

  it('dominant game (hat-trick + 2 assists) rates 9+', () => {
    const r = gameRating({ ...baseArgs, goals: 3, assists: 2, shots: 6, toi: 1400 })
    expect(r).toBeGreaterThanOrEqual(9)
  })

  it('giveaways reduce rating', () => {
    const clean = gameRating({ ...baseArgs, giveaways: 0 })
    const messy = gameRating({ ...baseArgs, giveaways: 4 })
    expect(messy).toBeLessThan(clean)
  })

  it('penalty minutes reduce rating', () => {
    const clean = gameRating({ ...baseArgs, penaltyMinutes: 0 })
    const penalised = gameRating({ ...baseArgs, penaltyMinutes: 6 })
    expect(penalised).toBeLessThan(clean)
  })

  it('D gets more from blockedShots than F', () => {
    const forwardRating = gameRating({ ...baseArgs, blockedShots: 4, position: 'W' })
    const defenseRating = gameRating({ ...baseArgs, blockedShots: 4, position: 'D' })
    expect(defenseRating).toBeGreaterThan(forwardRating)
  })

  it('D gets more from takeaways than F', () => {
    const forwardRating = gameRating({ ...baseArgs, takeaways: 4, position: 'C' })
    const defenseRating = gameRating({ ...baseArgs, takeaways: 4, position: 'D' })
    expect(defenseRating).toBeGreaterThan(forwardRating)
  })

  it('higher TOI increases rating', () => {
    const low = gameRating({ ...baseArgs, goals: 1, toi: 600 })
    const high = gameRating({ ...baseArgs, goals: 1, toi: 1400 })
    expect(high).toBeGreaterThan(low)
  })

  it('plusMinus = 0 is valid (optional param)', () => {
    const argsNoPM = { ...baseArgs }
    delete (argsNoPM as Partial<typeof argsNoPM>).plusMinus
    expect(() => gameRating(argsNoPM)).not.toThrow()
  })

  it('is deterministic', () => {
    const r1 = gameRating(baseArgs)
    const r2 = gameRating(baseArgs)
    expect(r1).toBe(r2)
  })

  it('caps at 10 for impossible inputs', () => {
    const r = gameRating({
      ...baseArgs,
      goals: 10, assists: 10, shots: 20, hits: 10,
      blockedShots: 10, takeaways: 10, toi: 3600,
    })
    expect(r).toBe(10)
  })

  it('floors at 0 for terrible inputs', () => {
    const r = gameRating({
      ...baseArgs,
      goals: 0, assists: 0, shots: 0, hits: 0,
      blockedShots: 0, takeaways: 0,
      giveaways: 50, penaltyMinutes: 30, toi: 60,
    })
    expect(r).toBe(0)
  })
})

/* ─────────────────────────── goalieGameRating ───────────────────────── */

describe('goalieGameRating', () => {
  it('returns a number in [0, 10]', () => {
    const r = goalieGameRating({ saves: 25, shotsAgainst: 27, goalsAgainst: 2, win: true, shutout: false })
    expect(r).toBeGreaterThanOrEqual(0)
    expect(r).toBeLessThanOrEqual(10)
  })

  it('shutout win rates very high (9+)', () => {
    const r = goalieGameRating({ saves: 30, shotsAgainst: 30, goalsAgainst: 0, win: true, shutout: true })
    expect(r).toBeGreaterThanOrEqual(9)
  })

  it('terrible outing (< .850 SV%, loss) rates low', () => {
    const r = goalieGameRating({ saves: 17, shotsAgainst: 22, goalsAgainst: 5, win: false, shutout: false })
    expect(r).toBeLessThan(5.5)
  })

  it('more saves with same GA = higher rating', () => {
    const fewer = goalieGameRating({ saves: 18, shotsAgainst: 22, goalsAgainst: 4, win: false, shutout: false })
    const more = goalieGameRating({ saves: 30, shotsAgainst: 34, goalsAgainst: 4, win: false, shutout: false })
    // 30/34 (.882) > 18/22 (.818) → higher
    expect(more).toBeGreaterThan(fewer)
  })

  it('more GA (same shots) = lower rating', () => {
    const good = goalieGameRating({ saves: 28, shotsAgainst: 30, goalsAgainst: 2, win: true, shutout: false })
    const bad = goalieGameRating({ saves: 25, shotsAgainst: 30, goalsAgainst: 5, win: false, shutout: false })
    expect(good).toBeGreaterThan(bad)
  })

  it('win bonus: identical saves, win > loss', () => {
    const won = goalieGameRating({ saves: 25, shotsAgainst: 27, goalsAgainst: 2, win: true, shutout: false })
    const lost = goalieGameRating({ saves: 25, shotsAgainst: 27, goalsAgainst: 2, win: false, shutout: false })
    expect(won).toBeGreaterThan(lost)
  })

  it('handles zero shots against gracefully', () => {
    const win = goalieGameRating({ saves: 0, shotsAgainst: 0, goalsAgainst: 0, win: true, shutout: false })
    const loss = goalieGameRating({ saves: 0, shotsAgainst: 0, goalsAgainst: 0, win: false, shutout: false })
    expect(win).toBeGreaterThan(loss)
    expect(win).toBeGreaterThanOrEqual(0)
    expect(loss).toBeGreaterThanOrEqual(0)
  })

  it('is deterministic', () => {
    const args = { saves: 22, shotsAgainst: 25, goalsAgainst: 3, win: false, shutout: false }
    expect(goalieGameRating(args)).toBe(goalieGameRating(args))
  })
})

/* ─────────────────────────── formString ────────────────────────────── */

describe('formString', () => {
  it('returns em-dash for empty array', () => {
    expect(formString([])).toBe('—')
  })

  it('formats single rating', () => {
    expect(formString([7.4])).toBe('7')
  })

  it('rounds to nearest integer', () => {
    expect(formString([6.5])).toBe('7')  // rounds up at .5
    expect(formString([6.4])).toBe('6')
  })

  it('clamps minimum to 1', () => {
    expect(formString([0, 0.1, 0.4])).toBe('1-1-1')
  })

  it('clamps maximum to 10', () => {
    expect(formString([10, 10.5, 9.9])).toBe('10-10-10')
  })

  it('truncates to last 5 ratings', () => {
    const ratings = [8, 7, 6, 5, 4, 3, 2]
    // slice(-5) = [4, 3, 2] ... wait: [6, 5, 4, 3, 2]
    expect(formString(ratings)).toBe('6-5-4-3-2')
  })

  it('with exactly 5 ratings shows all 5', () => {
    expect(formString([9, 9, 8, 9, 7])).toBe('9-9-8-9-7')
  })

  it('with fewer than 5 ratings shows all', () => {
    expect(formString([8, 6])).toBe('8-6')
  })

  it('most-recent game is last', () => {
    // [8, 7, 6, 5, 4] → "8-7-6-5-4"  (index 4 = most recent)
    const str = formString([8, 7, 6, 5, 4])
    const parts = str.split('-').map(Number)
    expect(parts[parts.length - 1]).toBe(4)
    expect(parts[0]).toBe(8)
  })
})

/* ─────────────────────────── seasonAvgRating ───────────────────────── */

describe('seasonAvgRating', () => {
  it('returns 0 for empty array', () => {
    expect(seasonAvgRating([])).toBe(0)
  })

  it('single value', () => {
    expect(seasonAvgRating([7.5])).toBe(7.5)
  })

  it('mean of multiple values', () => {
    expect(seasonAvgRating([6, 7, 8])).toBe(7)
  })

  it('rounds to 2 decimal places', () => {
    // (1 + 2 + 3) / 3 = 2.0 exactly — test a non-trivial case
    const avg = seasonAvgRating([6.1, 7.3, 8.4])
    // (21.8) / 3 = 7.2666... → 7.27
    expect(avg).toBe(7.27)
  })

  it('is deterministic', () => {
    const r = [6.0, 7.5, 8.2, 5.9]
    expect(seasonAvgRating(r)).toBe(seasonAvgRating(r))
  })
})

/* ─────────────────────────── teamLeaders ────────────────────────────── */

function makeSkater(
  id: string,
  name: string,
  overrides: Partial<ExtendedStatLine> & { avgRating?: number; gamesPlayed?: number } = {}
): TeamLeadersEntry {
  const { avgRating = 6.0, gamesPlayed = 20, ...lineOverrides } = overrides
  return {
    playerId: id,
    name,
    position: 'C',
    line: { ...emptyExtended(), ...lineOverrides },
    gamesPlayed,
    avgRating,
  }
}

function makeGoalie(
  id: string,
  name: string,
  savePct: number,
  gaa: number,
  gamesPlayed = 20
): TeamLeadersEntry {
  return {
    playerId: id,
    name,
    position: 'G',
    line: emptyExtended(),
    gamesPlayed,
    avgRating: 6.5,
    savePct,
    gaa,
  }
}

describe('teamLeaders', () => {
  const playerA = makeSkater('p1', 'Gretzky', { goals: 50, assists: 80, shots: 250, hits: 30, blockedShots: 5, takeaways: 40, penaltyMinutes: 10, plusMinus: 60 })
  const playerB = makeSkater('p2', 'Lemieux', { goals: 40, assists: 60, shots: 200, hits: 20, blockedShots: 8, takeaways: 30, penaltyMinutes: 60, plusMinus: 40 })
  const playerC = makeSkater('p3', 'Orr', { goals: 20, assists: 55, shots: 150, hits: 80, blockedShots: 120, takeaways: 50, penaltyMinutes: 100, plusMinus: 30, avgRating: 8.5 })
  const goalie = makeGoalie('g1', 'Roy', 0.935, 2.1)
  const badGoalie = makeGoalie('g2', 'Brodeur', 0.892, 3.4)

  const entries = [playerA, playerB, playerC, goalie, badGoalie]

  it('picks goals leader correctly', () => {
    const view = teamLeaders({ entries })
    expect(view.goals?.playerId).toBe('p1')
    expect(view.goals?.value).toBe(50)
  })

  it('picks assists leader correctly', () => {
    const view = teamLeaders({ entries })
    expect(view.assists?.playerId).toBe('p1')
    expect(view.assists?.value).toBe(80)
  })

  it('picks points leader correctly (goals + assists)', () => {
    const view = teamLeaders({ entries })
    // p1: 130, p2: 100, p3: 75
    expect(view.points?.playerId).toBe('p1')
    expect(view.points?.value).toBe(130)
  })

  it('picks plusMinus leader correctly', () => {
    const view = teamLeaders({ entries })
    expect(view.plusMinus?.playerId).toBe('p1')
    expect(view.plusMinus?.value).toBe(60)
  })

  it('picks PIM leader correctly', () => {
    const view = teamLeaders({ entries })
    // p3: 100 > p2: 60 > p1: 10
    expect(view.pim?.playerId).toBe('p3')
    expect(view.pim?.value).toBe(100)
  })

  it('picks shots on goal leader correctly', () => {
    const view = teamLeaders({ entries })
    expect(view.sog?.playerId).toBe('p1')
    expect(view.sog?.value).toBe(250)
  })

  it('picks hits leader correctly', () => {
    const view = teamLeaders({ entries })
    expect(view.hits?.playerId).toBe('p3')
    expect(view.hits?.value).toBe(80)
  })

  it('picks shot blocks leader correctly', () => {
    const view = teamLeaders({ entries })
    expect(view.shotBlocks?.playerId).toBe('p3')
    expect(view.shotBlocks?.value).toBe(120)
  })

  it('picks takeaways leader correctly', () => {
    const view = teamLeaders({ entries })
    expect(view.takeaways?.playerId).toBe('p3')
    expect(view.takeaways?.value).toBe(50)
  })

  it('picks savePct leader correctly (highest SV%)', () => {
    const view = teamLeaders({ entries })
    expect(view.savePct?.playerId).toBe('g1')
    expect(view.savePct?.value).toBeCloseTo(0.935)
  })

  it('picks GAA leader correctly (lowest GAA)', () => {
    const view = teamLeaders({ entries })
    expect(view.gaa?.playerId).toBe('g1')
    expect(view.gaa?.value).toBeCloseTo(2.1)
  })

  it('picks avgRating leader correctly', () => {
    const view = teamLeaders({ entries })
    // p3: 8.5, goalie: 6.5, others: 6.0
    expect(view.avgRating?.playerId).toBe('p3')
    expect(view.avgRating?.value).toBe(8.5)
  })

  it('returns null for category with all-zero values', () => {
    const allZero = [makeSkater('x', 'Nobody')]
    const view = teamLeaders({ entries: allZero })
    expect(view.goals).toBeNull()
    expect(view.assists).toBeNull()
  })

  it('returns null gaa/savePct when no goalies', () => {
    const skatersOnly = [playerA, playerB]
    const view = teamLeaders({ entries: skatersOnly })
    expect(view.gaa).toBeNull()
    expect(view.savePct).toBeNull()
  })

  it('respects minGpGoalie threshold', () => {
    const rookie = makeGoalie('g3', 'Rookie', 0.960, 1.5, 2) // only 2 GP
    const vet = makeGoalie('g4', 'Vet', 0.910, 2.8, 20)
    const view = teamLeaders({ entries: [rookie, vet], minGpGoalie: 10 })
    // Rookie excluded; vet wins (only qualified goalie)
    expect(view.savePct?.playerId).toBe('g4')
    expect(view.gaa?.playerId).toBe('g4')
  })

  it('is deterministic across multiple calls', () => {
    const v1 = teamLeaders({ entries })
    const v2 = teamLeaders({ entries })
    expect(v1.goals?.playerId).toBe(v2.goals?.playerId)
    expect(v1.gaa?.playerId).toBe(v2.gaa?.playerId)
  })
})
