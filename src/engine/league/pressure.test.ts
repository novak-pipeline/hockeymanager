/**
 * Tests for src/engine/league/pressure.ts — the in-season fan-mood layer
 * (Playtest 2026-08-26 §E3).
 *
 * The two things worth guarding: the mood must MOVE with results against
 * expectation, and it must not SPAM — one story per band per season, sampled at
 * checkpoints rather than every advance.
 */
import { describe, it, expect } from 'vitest'
import { Rng } from '@engine/shared/rng'
import {
  PRESSURE_CHECK_EVERY,
  bandOf,
  expectedPointsPct,
  freshPressure,
  pressureLabel,
  updatePressure,
  type PressureState,
} from './pressure'

const rng = (): Rng => new Rng(2026)

function run(
  state: PressureState,
  o: {
    gamesPlayed: number
    points: number
    currentRank?: number
    targetRank?: number
    inPlayoffSpot?: boolean
    rebuilding?: boolean
    recentForm?: string
  },
): ReturnType<typeof updatePressure> {
  return updatePressure({
    state,
    teamName: 'Springfield Frost',
    teamId: 't1',
    currentRank: o.currentRank ?? 20,
    targetRank: o.targetRank ?? 8,
    teamsInLeague: 32,
    gamesPlayed: o.gamesPlayed,
    totalGames: 82,
    points: o.points,
    inPlayoffSpot: o.inPlayoffSpot ?? false,
    rebuilding: o.rebuilding ?? false,
    ...(o.recentForm !== undefined ? { recentForm: o.recentForm } : {}),
    rng: rng(),
  })
}

describe('expectedPointsPct', () => {
  it('puts a first-place target near a real Presidents-Trophy pace', () => {
    expect(expectedPointsPct(1, 32)).toBeCloseTo(0.680, 3)
  })
  it('puts a last-place target near a real basement pace', () => {
    expect(expectedPointsPct(32, 32)).toBeCloseTo(0.390, 3)
  })
  it('is monotonic — a worse target always asks for fewer points', () => {
    for (let r = 1; r < 32; r++) {
      expect(expectedPointsPct(r, 32)).toBeGreaterThan(expectedPointsPct(r + 1, 32))
    }
  })
})

describe('bands', () => {
  it('covers the whole 0–100 range with a label each', () => {
    for (let m = 0; m <= 100; m += 1) {
      expect(pressureLabel(bandOf(m)).length).toBeGreaterThan(5)
    }
  })
})

describe('updatePressure cadence', () => {
  it('says nothing during the first 15% of the season', () => {
    const s = freshPressure(2026, 60)
    const r = run(s, { gamesPlayed: 8, points: 2 })
    expect(r.checked).toBe(false)
    expect(r.newsSeeds).toHaveLength(0)
  })

  it('samples only once per checkpoint interval', () => {
    const s = freshPressure(2026, 60)
    const first = run(s, { gamesPlayed: 20, points: 10 })
    expect(first.checked).toBe(true)
    // One more game is not a new checkpoint.
    expect(run(s, { gamesPlayed: 21, points: 10 }).checked).toBe(false)
    expect(run(s, { gamesPlayed: 20 + PRESSURE_CHECK_EVERY, points: 12 }).checked).toBe(true)
  })

  it('tells each band story at most once a season', () => {
    const s = freshPressure(2026, 60)
    let stories = 0
    for (let gp = 20; gp <= 80; gp += PRESSURE_CHECK_EVERY) {
      // A catastrophic season, sustained: the mood should bottom out and stay there.
      stories += run(s, { gamesPlayed: gp, points: Math.round(gp * 0.55), currentRank: 32 }).newsSeeds.length
    }
    // 'angry' and 'mutinous' at most — never the same headline twice.
    expect(stories).toBeLessThanOrEqual(2)
  })
})

describe('updatePressure direction', () => {
  it('turns the building against you when the club badly misses its target', () => {
    const s = freshPressure(2026, 60)
    const start = s.mood
    for (let gp = 20; gp <= 60; gp += PRESSURE_CHECK_EVERY) {
      run(s, { gamesPlayed: gp, points: Math.round(gp * 0.6), currentRank: 30, targetRank: 6 })
    }
    expect(s.mood).toBeLessThan(start)
    expect(['angry', 'mutinous']).toContain(bandOf(s.mood))
  })

  it('wins the building over when the club beats its target', () => {
    const s = freshPressure(2026, 55)
    const start = s.mood
    for (let gp = 20; gp <= 60; gp += PRESSURE_CHECK_EVERY) {
      run(s, {
        gamesPlayed: gp, points: Math.round(gp * 1.5), currentRank: 2, targetRank: 14,
        inPlayoffSpot: true, recentForm: 'WWWWWWWWWW',
      })
    }
    expect(s.mood).toBeGreaterThan(start)
    expect(bandOf(s.mood)).toBe('backing')
  })

  it('turns slowly — one bad checkpoint cannot empty the building', () => {
    const s = freshPressure(2026, 85)
    const start = s.mood
    run(s, { gamesPlayed: 20, points: 6, currentRank: 32, targetRank: 1 })
    expect(start - s.mood).toBeLessThan(40)
    expect(bandOf(s.mood)).not.toBe('mutinous')
  })
})

describe('updatePressure consequences', () => {
  it('bills the owner patience when the fans turn, and nothing when they have not', () => {
    const happy = freshPressure(2026, 80)
    const good = run(happy, {
      gamesPlayed: 20, points: 30, currentRank: 2, targetRank: 10, inPlayoffSpot: true,
    })
    expect(good.patienceDrain).toBe(0)

    const sour = freshPressure(2026, 35)
    let drained = 0
    for (let gp = 20; gp <= 60; gp += PRESSURE_CHECK_EVERY) {
      drained += run(sour, { gamesPlayed: gp, points: Math.round(gp * 0.5), currentRank: 31, targetRank: 4 }).patienceDrain
    }
    expect(drained).toBeGreaterThan(0)
  })

  it('halves the bill during a board-sanctioned rebuild — they were told the plan', () => {
    const mk = (): PressureState => freshPressure(2026, 35)
    const normal = mk()
    const rebuild = mk()
    let a = 0
    let b = 0
    for (let gp = 20; gp <= 60; gp += PRESSURE_CHECK_EVERY) {
      const o = { gamesPlayed: gp, points: Math.round(gp * 0.5), currentRank: 31, targetRank: 20 }
      a += run(normal, o).patienceDrain
      b += run(rebuild, { ...o, rebuilding: true }).patienceDrain
    }
    expect(b).toBeLessThan(a)
    expect(rebuild.mood).toBeGreaterThan(normal.mood)
  })
})

describe('determinism + JSON safety', () => {
  it('same inputs → same mood and same headline', () => {
    const a = freshPressure(2026, 60)
    const b = freshPressure(2026, 60)
    const ra = run(a, { gamesPlayed: 30, points: 14, currentRank: 30, targetRank: 5 })
    const rb = run(b, { gamesPlayed: 30, points: 14, currentRank: 30, targetRank: 5 })
    expect(a.mood).toBe(b.mood)
    expect(ra.newsSeeds[0]?.headline).toBe(rb.newsSeeds[0]?.headline)
  })

  it('round-trips through JSON unchanged', () => {
    const s = freshPressure(2026, 71)
    run(s, { gamesPlayed: 30, points: 20, currentRank: 25, targetRank: 8 })
    const back = JSON.parse(JSON.stringify(s)) as PressureState
    expect(back).toEqual(s)
  })
})
