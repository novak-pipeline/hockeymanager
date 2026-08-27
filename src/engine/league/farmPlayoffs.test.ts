/**
 * Tests for src/engine/league/farmPlayoffs.ts (Playtest 2026-08-26 §E1).
 *
 * The farm played a full season and then stopped. Now it has a bracket, so a
 * run down there can mean something — and the Dubas beat has somewhere to land.
 */
import { describe, expect, it } from 'vitest'
import { Rng } from '@engine/shared/rng'
import {
  FARM_SERIES_WINS,
  farmFinishLabel,
  farmRecap,
  runFarmPlayoffs,
  type FarmSeed,
} from './farmPlayoffs'

const seeds = (n: number): FarmSeed[] =>
  Array.from({ length: n }, (_, i) => ({
    teamId: `t${i + 1}`, name: `Club ${i + 1}`, abbr: `C${i + 1}`, seed: i + 1,
  }))

/** The better seed always wins — makes the bracket's shape readable. */
const chalk = (home: string, away: string): string => {
  const n = (id: string): number => Number(id.slice(1))
  return n(home) < n(away) ? home : away
}

describe('runFarmPlayoffs', () => {
  it('refuses to invent a bracket from too small a field', () => {
    expect(runFarmPlayoffs({ year: 2028, seeds: seeds(3), playGame: chalk, rng: new Rng(1) })).toBeNull()
  })

  it('runs an eight-team bracket to a single champion', () => {
    const r = runFarmPlayoffs({ year: 2028, seeds: seeds(8), playGame: chalk, rng: new Rng(1) })!
    expect(r).not.toBeNull()
    expect(r.series).toHaveLength(4 + 2 + 1)
    expect(r.championTeamId).toBe('t1')
    expect(r.championName).toBe('Club 1')
  })

  it('runs a four-team bracket when that is all the league has', () => {
    const r = runFarmPlayoffs({ year: 2028, seeds: seeds(4), playGame: chalk, rng: new Rng(1) })!
    expect(r.series).toHaveLength(2 + 1)
    expect(r.championTeamId).toBe('t1')
  })

  it('never plays a game after a series is decided', () => {
    const r = runFarmPlayoffs({ year: 2028, seeds: seeds(8), playGame: chalk, rng: new Rng(1) })!
    for (const s of r.series) {
      expect(Math.max(s.highWins, s.lowWins)).toBe(FARM_SERIES_WINS)
      expect(s.highWins + s.lowWins).toBeLessThanOrEqual(FARM_SERIES_WINS * 2 - 1)
      expect([s.highTeamId, s.lowTeamId]).toContain(s.winnerTeamId)
    }
  })

  it('labels the rounds so the prose can name them', () => {
    const r = runFarmPlayoffs({ year: 2028, seeds: seeds(8), playGame: chalk, rng: new Rng(1) })!
    expect(new Set(r.series.map((s) => s.roundLabel))).toEqual(
      new Set(['Quarter-final', 'Semi-final', 'Final'])
    )
  })

  it('is deterministic — same seeding and same games give the same bracket', () => {
    const a = runFarmPlayoffs({ year: 2028, seeds: seeds(8), playGame: chalk, rng: new Rng(9) })
    const b = runFarmPlayoffs({ year: 2028, seeds: seeds(8), playGame: chalk, rng: new Rng(9) })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('the user affiliate run', () => {
  const run = (affiliate: string, play = chalk) =>
    runFarmPlayoffs({ year: 2028, seeds: seeds(8), playGame: play, userAffiliateId: affiliate, rng: new Rng(3) })!

  it('reports champion for the club that wins it', () => {
    expect(run('t1').userRun).toEqual({ teamId: 't1', name: 'Club 1', finish: 'champion', roundsWon: 3 })
  })

  it('reports the losing finalist as "final"', () => {
    // With chalk, the 2 seed reaches the final and loses it.
    const r = run('t2').userRun!
    expect(r.finish).toBe('final')
    expect(r.roundsWon).toBe(2)
  })

  it('reports a first-round exit as "quarter"', () => {
    expect(run('t8').userRun!.finish).toBe('quarter')
  })

  it('reports a club outside the field as "missed"', () => {
    const r = runFarmPlayoffs({
      year: 2028, seeds: seeds(8), playGame: chalk, userAffiliateId: 'nowhere', rng: new Rng(3),
    })!
    expect(r.userRun!.finish).toBe('missed')
    expect(r.userRun!.roundsWon).toBe(0)
  })

  it('omits the run entirely when the club has no affiliate', () => {
    expect(runFarmPlayoffs({ year: 2028, seeds: seeds(8), playGame: chalk, rng: new Rng(3) })!.userRun).toBeUndefined()
  })
})

describe('prose', () => {
  it('labels every finish in words', () => {
    for (const f of ['missed', 'quarter', 'semi', 'final', 'champion'] as const) {
      expect(farmFinishLabel(f).length).toBeGreaterThan(8)
    }
  })

  it('writes a recap that is about the prospects, not the trophy', () => {
    const r = runFarmPlayoffs({
      year: 2028, seeds: seeds(8), playGame: chalk, userAffiliateId: 't2', rng: new Rng(3),
    })!
    const recap = farmRecap(r, 'Club 2')
    expect(recap.headline).toContain('Club 2')
    expect(recap.body.length).toBeGreaterThan(60)
  })

  it('still says something when your club was not in it', () => {
    const r = runFarmPlayoffs({
      year: 2028, seeds: seeds(8), playGame: chalk, userAffiliateId: 'nowhere', rng: new Rng(3),
    })!
    const recap = farmRecap(r, 'Your Farm')
    expect(recap.body).toContain('Your Farm')
  })
})
