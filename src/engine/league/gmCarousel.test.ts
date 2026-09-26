/**
 * Tests for src/engine/league/gmCarousel.ts (E3 front-office carousel).
 *
 * GM changes must be RARER than coaching changes and must follow SUSTAINED
 * failure against expectation — never one bad year, never a GM in his first
 * two seasons, and a young rebuild is largely forgiven.
 */
import { describe, it, expect } from 'vitest'
import { Rng } from '@engine/shared/rng'
import {
  GM_MIN_TENURE,
  MAX_GM_DISMISSALS,
  dismissalOdds,
  hottestGmSeat,
  isDisappointingSeason,
  offseasonGmDismissals,
  type GmSeat,
} from './gmCarousel'

const N = 32

function seat(o: Partial<GmSeat> & { teamId: string }): GmSeat {
  return {
    teamName: `Club ${o.teamId}`,
    teamAbbr: o.teamId.toUpperCase(),
    gmName: `GM ${o.teamId}`,
    tenure: 4,
    missStreak: 0,
    predictedRank: 12,
    finalRank: 12,
    madePlayoffs: true,
    rebuilding: false,
    ...o,
  }
}

describe('isDisappointingSeason', () => {
  it('flags a big slide, a missed projected berth, and an unplanned basement finish', () => {
    expect(isDisappointingSeason({ predictedRank: 8, finalRank: 16, madePlayoffs: true, rebuilding: false }, N)).toBe(true)
    expect(isDisappointingSeason({ predictedRank: 10, finalRank: 13, madePlayoffs: false, rebuilding: false }, N)).toBe(true)
    expect(isDisappointingSeason({ predictedRank: 29, finalRank: 30, madePlayoffs: false, rebuilding: false }, N)).toBe(true)
  })

  it('does not flag a club doing roughly what it was picked to do, or a planned rebuild at the bottom', () => {
    expect(isDisappointingSeason({ predictedRank: 12, finalRank: 14, madePlayoffs: true, rebuilding: false }, N)).toBe(false)
    expect(isDisappointingSeason({ predictedRank: 24, finalRank: 25, madePlayoffs: false, rebuilding: false }, N)).toBe(false)
    expect(isDisappointingSeason({ predictedRank: 29, finalRank: 31, madePlayoffs: false, rebuilding: true }, N)).toBe(false)
  })
})

describe('dismissalOdds', () => {
  it('never judges a GM before his second full season', () => {
    const s = seat({ teamId: 'a', tenure: GM_MIN_TENURE - 1, missStreak: 3, predictedRank: 3, finalRank: 30, madePlayoffs: false })
    expect(dismissalOdds(s, N)).toBe(0)
  })

  it('one bad year is not a case; two opens one; three is usually the end', () => {
    const base = { teamId: 'a', predictedRank: 8, finalRank: 20, madePlayoffs: false, tenure: 4 }
    expect(dismissalOdds(seat({ ...base, missStreak: 1 }), N)).toBe(0)
    const two = dismissalOdds(seat({ ...base, missStreak: 2 }), N)
    const three = dismissalOdds(seat({ ...base, missStreak: 3 }), N)
    expect(two).toBeGreaterThan(0.2)
    expect(three).toBeGreaterThan(two)
    expect(three).toBeGreaterThanOrEqual(0.5)
  })

  it('a long-tenured GM in the basement is exposed even on a single miss', () => {
    expect(dismissalOdds(seat({ teamId: 'a', tenure: 7, missStreak: 1, predictedRank: 20, finalRank: 29, madePlayoffs: false }), N)).toBeGreaterThan(0)
  })

  it('an owner who bought a rebuild gives it time', () => {
    const base = { teamId: 'a', tenure: 3, missStreak: 2, predictedRank: 22, finalRank: 31, madePlayoffs: false }
    expect(dismissalOdds(seat({ ...base, rebuilding: true }), N)).toBeLessThan(dismissalOdds(seat(base), N) * 0.5)
  })
})

describe('offseasonGmDismissals', () => {
  it('is capped league-wide and deterministic per seed', () => {
    const seats = Array.from({ length: 12 }, (_, i) =>
      seat({ teamId: `t${String(i).padStart(2, '0')}`, missStreak: 4, predictedRank: 3, finalRank: 28, madePlayoffs: false, tenure: 6 })
    )
    const a = offseasonGmDismissals({ seats, teamsInLeague: N, rng: new Rng(7) })
    const b = offseasonGmDismissals({ seats, teamsInLeague: N, rng: new Rng(7) })
    expect(a.length).toBeLessThanOrEqual(MAX_GM_DISMISSALS)
    expect(a.map((d) => d.teamId)).toEqual(b.map((d) => d.teamId))
    for (const d of a) {
      expect(d.headline).toContain(d.gmName)
      expect(d.body).not.toMatch(/undefined|NaN/)
    }
  })

  it('a league of GMs meeting expectations sees no dismissals at all', () => {
    const seats = Array.from({ length: 31 }, (_, i) => seat({ teamId: `t${i}`, predictedRank: i + 1, finalRank: i + 1, tenure: 8 }))
    expect(offseasonGmDismissals({ seats, teamsInLeague: N, rng: new Rng(1) })).toHaveLength(0)
  })

  it('lands in the NHL band (~1–3 a summer) for a plausible league', () => {
    // A league-like spread: a handful of clubs on a run of misses, most fine.
    let total = 0
    const summers = 400
    for (let y = 0; y < summers; y++) {
      const rng = new Rng(1000 + y)
      const seats: GmSeat[] = []
      for (let i = 0; i < 31; i++) {
        const predicted = i + 1
        const final = Math.max(1, Math.min(32, predicted + Math.round((rng.float(0, 1) - 0.5) * 16)))
        const streak = rng.chance(0.18) ? 2 + rng.int(2) : rng.chance(0.3) ? 1 : 0
        seats.push(seat({ teamId: `t${i}`, predictedRank: predicted, finalRank: final, madePlayoffs: final <= 16, missStreak: streak, tenure: 2 + rng.int(8) }))
      }
      total += offseasonGmDismissals({ seats, teamsInLeague: N, rng }).length
    }
    const perSummer = total / summers
    expect(perSummer).toBeGreaterThan(0.8)
    expect(perSummer).toBeLessThan(3)
  })
})

describe('hottestGmSeat', () => {
  it('names the seat with the strongest case, falling back to the basement', () => {
    const seats = [
      seat({ teamId: 'a', finalRank: 10 }),
      seat({ teamId: 'b', finalRank: 31, madePlayoffs: false }),
      seat({ teamId: 'c', tenure: 1, finalRank: 32, missStreak: 3 }),
    ]
    // c is protected by tenure; nobody has a live case, so the basement club goes.
    expect(hottestGmSeat(seats, N)?.teamId).toBe('b')
    seats.push(seat({ teamId: 'd', missStreak: 3, predictedRank: 4, finalRank: 20, madePlayoffs: false }))
    expect(hottestGmSeat(seats, N)?.teamId).toBe('d')
  })
})
