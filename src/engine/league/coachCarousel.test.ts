/**
 * Tests for src/engine/league/coachCarousel.ts (Playtest 2026-08-26 §E3).
 *
 * The carousel must be an EVENT, not weather: capped league-wide, never in the
 * first weeks, never for a club doing what it was projected to do, and never
 * for a bench nobody has had time to judge.
 */
import { describe, it, expect } from 'vitest'
import { Rng } from '@engine/shared/rng'
import {
  MAX_MIDSEASON_FIRINGS,
  MIDSEASON_MIN_GAMES,
  midSeasonFirings,
  offseasonFirings,
  seatHeat,
  type CoachSeat,
} from './coachCarousel'

function seat(o: Partial<CoachSeat> & { teamId: string }): CoachSeat {
  return {
    teamName: `Club ${o.teamId}`,
    teamAbbr: o.teamId.toUpperCase(),
    coachId: `c-${o.teamId}`,
    coachName: `Coach ${o.teamId}`,
    tenure: 2,
    predictedRank: 10,
    currentRank: 10,
    pointsPct: 0.520,
    gamesPlayed: 40,
    ...o,
  }
}

/** A club in genuine freefall: picked 4th, sitting 30th, banking nothing. */
const collapsing = (id: string): CoachSeat =>
  seat({ teamId: id, predictedRank: 4, currentRank: 30, pointsPct: 0.330, gamesPlayed: 44 })

/** A club doing exactly what was asked of it. */
const steady = (id: string): CoachSeat =>
  seat({ teamId: id, predictedRank: 12, currentRank: 11, pointsPct: 0.545, gamesPlayed: 44 })

describe('seatHeat', () => {
  it('is hot for a collapse and cold for a club meeting expectations', () => {
    expect(seatHeat(collapsing('a'), 32)).toBeGreaterThan(0.7)
    expect(seatHeat(steady('b'), 32)).toBeLessThan(0.2)
  })

  it('does not blame a coach hired weeks ago as hard as a lifer', () => {
    // A moderate slide, so neither reading is clamped at the ceiling.
    const slipping = seat({ teamId: 'a', predictedRank: 10, currentRank: 22, pointsPct: 0.450 })
    const rookie = { ...slipping, tenure: 0 }
    const lifer = { ...slipping, tenure: 6 }
    expect(seatHeat(rookie, 32)).toBeLessThan(seatHeat(lifer, 32))
  })

  it('spares a club underperforming its rank while still banking points', () => {
    const s = seat({ teamId: 'c', predictedRank: 2, currentRank: 12, pointsPct: 0.600 })
    expect(seatHeat(s, 32)).toBeLessThan(0.62)
  })
})

describe('midSeasonFirings', () => {
  it('never moves a bench before the season has become the season', () => {
    const early = { ...collapsing('a'), gamesPlayed: MIDSEASON_MIN_GAMES - 1 }
    const out = midSeasonFirings({
      seats: [early], totalGames: 82, teamsInLeague: 32,
      alreadyFiredThisSeason: 0, rng: new Rng(1),
    })
    expect(out).toHaveLength(0)
  })

  it('never fires the coach of a club meeting its projection, however many rolls', () => {
    for (let s = 0; s < 60; s++) {
      const out = midSeasonFirings({
        seats: [steady('b')], totalGames: 82, teamsInLeague: 32,
        alreadyFiredThisSeason: 0, rng: new Rng(s),
      })
      expect(out).toHaveLength(0)
    }
  })

  it('never fires a club running an announced rebuild', () => {
    const rebuilding = { ...collapsing('a'), rebuilding: true }
    for (let s = 0; s < 40; s++) {
      expect(
        midSeasonFirings({
          seats: [rebuilding], totalGames: 82, teamsInLeague: 32,
          alreadyFiredThisSeason: 0, rng: new Rng(s),
        })
      ).toHaveLength(0)
    }
  })

  it('does fire someone, eventually, when clubs are collapsing', () => {
    const seats = ['a', 'b', 'c', 'd', 'e', 'f'].map(collapsing)
    let total = 0
    for (let s = 0; s < 40; s++) {
      total += midSeasonFirings({
        seats, totalGames: 82, teamsInLeague: 32,
        alreadyFiredThisSeason: 0, rng: new Rng(s),
      }).length
    }
    expect(total).toBeGreaterThan(0)
  })

  it('honours the league-wide cap across calls', () => {
    const seats = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(collapsing)
    for (let s = 0; s < 40; s++) {
      const out = midSeasonFirings({
        seats, totalGames: 82, teamsInLeague: 32,
        alreadyFiredThisSeason: 0, rng: new Rng(s),
      })
      expect(out.length).toBeLessThanOrEqual(MAX_MIDSEASON_FIRINGS)
    }
    expect(
      midSeasonFirings({
        seats, totalGames: 82, teamsInLeague: 32,
        alreadyFiredThisSeason: MAX_MIDSEASON_FIRINGS, rng: new Rng(3),
      })
    ).toHaveLength(0)
  })

  it('stops once the season is nearly over — a club rides out the last quarter', () => {
    const late = { ...collapsing('a'), gamesPlayed: 78 }
    for (let s = 0; s < 30; s++) {
      expect(
        midSeasonFirings({
          seats: [late], totalGames: 82, teamsInLeague: 32,
          alreadyFiredThisSeason: 0, rng: new Rng(s),
        })
      ).toHaveLength(0)
    }
  })

  it('writes a headline that names the club, the coach and the numbers', () => {
    const seats = ['a', 'b', 'c', 'd', 'e', 'f'].map(collapsing)
    let found = null
    for (let s = 0; s < 40 && !found; s++) {
      found = midSeasonFirings({
        seats, totalGames: 82, teamsInLeague: 32,
        alreadyFiredThisSeason: 0, rng: new Rng(s),
      })[0] ?? null
    }
    expect(found).not.toBeNull()
    expect(found!.headline).toContain(found!.coachName)
    expect(found!.body).toContain('30th')
    expect(found!.body).toContain('4th')
  })
})

describe('offseasonFirings', () => {
  it('moves on from clubs that finished well below projection', () => {
    const seats = ['a', 'b', 'c', 'd', 'e', 'f'].map(collapsing)
    let total = 0
    for (let s = 0; s < 25; s++) {
      total += offseasonFirings({ seats, teamsInLeague: 32, rng: new Rng(s) }).length
    }
    expect(total).toBeGreaterThan(0)
  })

  it('leaves a club that met its projection alone', () => {
    const seats = ['a', 'b', 'c'].map(steady)
    for (let s = 0; s < 40; s++) {
      expect(offseasonFirings({ seats, teamsInLeague: 32, rng: new Rng(s) })).toHaveLength(0)
    }
  })

  it('never turns over more than the cap in one summer', () => {
    const seats = Array.from({ length: 32 }, (_, i) => collapsing(`t${i}`))
    for (let s = 0; s < 20; s++) {
      const out = offseasonFirings({ seats, teamsInLeague: 32, rng: new Rng(s) })
      expect(out.length).toBeLessThanOrEqual(Math.max(2, Math.round(32 * 0.18)))
    }
  })

  it('rarely fires a coach hired the same year', () => {
    const rookies = ['a', 'b', 'c'].map((id) => ({ ...collapsing(id), tenure: 0 }))
    const lifers = ['a', 'b', 'c'].map((id) => ({ ...collapsing(id), tenure: 5 }))
    let r = 0
    let l = 0
    for (let s = 0; s < 40; s++) {
      r += offseasonFirings({ seats: rookies, teamsInLeague: 32, rng: new Rng(s) }).length
      l += offseasonFirings({ seats: lifers, teamsInLeague: 32, rng: new Rng(s) }).length
    }
    expect(r).toBeLessThan(l)
  })
})

describe('determinism', () => {
  it('same seats + same seed → identical firings', () => {
    const seats = ['a', 'b', 'c', 'd'].map(collapsing)
    const a = midSeasonFirings({
      seats, totalGames: 82, teamsInLeague: 32, alreadyFiredThisSeason: 0, rng: new Rng(12345),
    })
    const b = midSeasonFirings({
      seats, totalGames: 82, teamsInLeague: 32, alreadyFiredThisSeason: 0, rng: new Rng(12345),
    })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
