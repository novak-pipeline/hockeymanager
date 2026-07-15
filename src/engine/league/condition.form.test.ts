/**
 * Earned form: `formDeltaFromGame` must make hot/cold streaks a product of
 * on-ice production (measured against a player's caliber), not the pure random
 * walk that `tickRecovery` layers on top. These tests pin the direction and
 * magnitude of the delta, and simulate season-length pipelines to confirm
 * streaks actually build, stay bounded to ±5, and remain rare enough that the
 * "hot" (≥3) / "cold" (≤-3) thresholds the rest of the app reads still mean
 * something.
 */
import { describe, expect, it } from 'vitest'
import type { Player, Position, RawAttributes, SeasonStats } from '@domain'
import { asPlayerId } from '@domain'
import { computeComposites } from '@engine/ratings/composites'
import { emptyStat, type GamePlayerStat } from '@engine/shared/outcome'
import { Rng } from '@engine/shared/rng'
import { formDeltaFromGame, tickRecovery } from './condition'

let nextId = 1
const pid = (): ReturnType<typeof asPlayerId> => asPlayerId(`p${nextId++}`)

function rawAttrs(val = 50): RawAttributes {
  return {
    technical: { wristShot: val, slapShot: val, stickhandling: val, passing: val, deflections: val, faceoffs: val },
    physical: { speed: val, acceleration: val, strength: val, balance: val, stamina: val, agility: val, height: val },
    mental: {
      offensiveIQ: val, defensiveIQ: val, positioning: val, vision: val, aggression: val,
      composure: val, workRate: val, discipline: val, anticipation: val
    },
    defensive: { checking: val, shotBlocking: val, stickChecking: val, takeaway: val }
  }
}
function goalieRaw(val = 60): RawAttributes {
  return {
    ...rawAttrs(val),
    goalie: { reflexes: val, positioningG: val, reboundControl: val, glove: val, blocker: val, recovery: val, puckHandlingG: val }
  }
}

const stats: SeasonStats = {
  season: 2025, teamId: 'T1', gamesPlayed: 0,
  ev: { goals: 0, assists: 0, shots: 0, timeOnIce: 0 },
  pp: { goals: 0, assists: 0, shots: 0, timeOnIce: 0 },
  pk: { goals: 0, assists: 0, shots: 0, timeOnIce: 0 },
  plusMinus: 0, penaltyMinutes: 0, saves: 0, shotsAgainst: 0, goalsAgainst: 0, shutouts: 0
}

function makePlayer(position: Position, attr: number, over: Partial<Player> = {}): Player {
  const id = pid()
  const ratings = position === 'G' ? goalieRaw(attr) : rawAttrs(attr)
  const composites = computeComposites(ratings, position === 'G' ? 'starter' : 'twoWay', position)
  return {
    id, name: `Player ${id}`, age: 25, position, handedness: 'L',
    role: position === 'G' ? 'starter' : 'twoWay', ratings, potential: ratings, composites,
    personality: { ambition: 50, professionalism: 50, loyalty: 50, temperament: 50, determination: 50 },
    contract: { salary: 1e6, yearsRemaining: 2, expiryYear: 2026, noTradeClause: false, twoWay: false },
    stats: [{ ...stats }], fatigue: 0, morale: 60, injuryStatus: null, form: 0, ...over
  }
}

function line(id: ReturnType<typeof asPlayerId>, over: Partial<GamePlayerStat>): GamePlayerStat {
  return { ...emptyStat(id), toi: 17 * 60, ...over }
}

describe('formDeltaFromGame — skaters', () => {
  it('rewards a big offensive night', () => {
    const star = makePlayer('W', 85)
    const hatTrick = formDeltaFromGame(star, line(star.id, { goals: 3, shots: 6, plusMinus: 2 }))
    expect(hatTrick).toBeGreaterThan(0.9)
    const twoPoint = formDeltaFromGame(star, line(star.id, { goals: 1, assists: 1, shots: 3, plusMinus: 1 }))
    expect(twoPoint).toBeGreaterThan(0.3)
  })

  it("cools a star's quiet night more than a grinder's", () => {
    const star = makePlayer('W', 88)
    const grinder = makePlayer('W', 32)
    const quiet = { shots: 1, plusMinus: -1 }
    const starDelta = formDeltaFromGame(star, line(star.id, quiet))
    const grinderDelta = formDeltaFromGame(grinder, line(grinder.id, quiet))
    expect(starDelta).toBeLessThan(0)
    expect(starDelta).toBeLessThan(grinderDelta) // star punished harder
  })

  it('gives a depth scorer a real bump for chipping in', () => {
    const grinder = makePlayer('W', 34)
    const goalNight = formDeltaFromGame(grinder, line(grinder.id, { goals: 1, shots: 2, plusMinus: 1 }))
    expect(goalNight).toBeGreaterThan(0.3)
  })

  it('is bounded per game and deterministic', () => {
    const star = makePlayer('C', 90)
    const monster = line(star.id, { goals: 4, assists: 3, shots: 10, plusMinus: 4, takeaways: 5 })
    expect(formDeltaFromGame(star, monster)).toBeLessThanOrEqual(1.2)
    expect(formDeltaFromGame(star, monster)).toBe(formDeltaFromGame(star, monster))
    const disaster = line(star.id, { plusMinus: -5, giveaways: 6 })
    expect(formDeltaFromGame(star, disaster)).toBeGreaterThanOrEqual(-0.6)
  })
})

describe('formDeltaFromGame — goalies', () => {
  it('rewards a shutout and punishes a shelling', () => {
    const g = makePlayer('G', 65)
    const shutout = formDeltaFromGame(g, line(g.id, { toi: 3600, saves: 30, shotsAgainst: 30, goalsAgainst: 0 }))
    expect(shutout).toBeGreaterThan(0.6)
    const shelled = formDeltaFromGame(g, line(g.id, { toi: 3600, saves: 24, shotsAgainst: 30, goalsAgainst: 6 }))
    expect(shelled).toBeLessThan(-0.4)
  })

  it('barely moves on a light workload', () => {
    const g = makePlayer('G', 60)
    const lowVolume = formDeltaFromGame(g, line(g.id, { toi: 1200, saves: 8, shotsAgainst: 9, goalsAgainst: 1 }))
    expect(Math.abs(lowVolume)).toBeLessThan(0.25)
  })

  it('returns 0 for a goalie who faced nothing', () => {
    const g = makePlayer('G', 60)
    expect(formDeltaFromGame(g, line(g.id, { toi: 0, saves: 0, shotsAgainst: 0 }))).toBe(0)
  })
})

/** Drive the real pipeline: apply the game delta, then the daily
 *  random-walk+decay from tickRecovery, once per game, for a full season. */
function runSeason(player: Player, night: () => Partial<GamePlayerStat>, games = 40): number {
  const rng = new Rng(1234)
  for (let g = 0; g < games; g++) {
    player.form = Math.max(-5, Math.min(5, player.form + formDeltaFromGame(player, line(player.id, night()))))
    tickRecovery({ players: [player], playedToday: new Set([player.id]), rng })
    expect(player.form).toBeGreaterThanOrEqual(-5)
    expect(player.form).toBeLessThanOrEqual(5)
  }
  return player.form
}

describe('earned form — season-length streaks', () => {
  it('a sustained hot scorer climbs into "hot" territory', () => {
    const star = makePlayer('W', 80)
    const form = runSeason(star, () => ({ goals: 1, assists: 1, shots: 4, plusMinus: 1 }))
    expect(form).toBeGreaterThanOrEqual(3)
  })

  it('a slumping star drifts cold', () => {
    const star = makePlayer('W', 85)
    const form = runSeason(star, () => ({ shots: 1, plusMinus: -1 }))
    expect(form).toBeLessThanOrEqual(-2)
  })

  it('a player producing on pace keeps form near neutral', () => {
    // The honest invariant: performing at your own caliber neither heats you up
    // nor cools you down. A mid-six player alternates an above-pace night and a
    // below-pace one (mean game-score ≈ his baseline); form must hover, so
    // hot/cold stay rare and meaningful rather than the default state.
    // Track the season-long average: the ±1 daily random walk (tickRecovery)
    // spikes on its own, so we isolate *systematic* drift from my delta — an
    // on-pace player should average near zero, never trending hot or cold.
    const mid = makePlayer('C', 55)
    let sum = 0
    const rng = new Rng(99)
    for (let g = 0; g < 82; g++) {
      const s = g % 2 === 0 ? { assists: 1, shots: 1 } : { shots: 0 }
      mid.form = Math.max(-5, Math.min(5, mid.form + formDeltaFromGame(mid, line(mid.id, s))))
      tickRecovery({ players: [mid], playedToday: new Set([mid.id]), rng })
      sum += mid.form
    }
    expect(Math.abs(sum / 82)).toBeLessThan(1)
  })
})
