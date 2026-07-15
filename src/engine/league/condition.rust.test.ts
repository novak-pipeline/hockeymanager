/**
 * Match rust: a player returning from a long injury layoff should come back a
 * step slow and round into form over a few games, not snap instantly to 100%.
 * These pin the whole ramp: a long absence sets rust on heal, a short one does
 * not, the sim reads a dampened player while rusty, and playing games (not
 * resting) is what burns the rust off.
 */
import { describe, expect, it } from 'vitest'
import type { Injury, Player, Position, RawAttributes, SeasonStats } from '@domain'
import { asPlayerId } from '@domain'
import { computeComposites } from '@engine/ratings/composites'
import { Rng } from '@engine/shared/rng'
import { effectiveResolve, tickRecovery } from './condition'

let nextId = 1
const pid = (): ReturnType<typeof asPlayerId> => asPlayerId(`p${nextId++}`)

function rawAttrs(val = 60): RawAttributes {
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

const stats: SeasonStats = {
  season: 2025, teamId: 'T1', gamesPlayed: 0,
  ev: { goals: 0, assists: 0, shots: 0, timeOnIce: 0 },
  pp: { goals: 0, assists: 0, shots: 0, timeOnIce: 0 },
  pk: { goals: 0, assists: 0, shots: 0, timeOnIce: 0 },
  plusMinus: 0, penaltyMinutes: 0, saves: 0, shotsAgainst: 0, goalsAgainst: 0, shutouts: 0
}

function makePlayer(over: Partial<Player> = {}): Player {
  const id = pid()
  const ratings = rawAttrs(70)
  const composites = computeComposites(ratings, 'twoWay', 'W')
  return {
    id, name: `Player ${id}`, age: 27, position: 'W' as Position, handedness: 'L',
    role: 'twoWay', ratings, potential: ratings, composites,
    personality: { ambition: 50, professionalism: 50, loyalty: 50, temperament: 50, determination: 50 },
    contract: { salary: 1e6, yearsRemaining: 2, expiryYear: 2026, noTradeClause: false, twoWay: false },
    stats: [{ ...stats }], fatigue: 0, morale: 60, injuryStatus: null, form: 0, ...over
  }
}

function injury(gamesRemaining: number, totalGames = gamesRemaining): Injury {
  return { kind: 'lowerBody', gamesRemaining, description: 'test', totalGames }
}

/** Heal a player who has `n` games left by ticking rest days until cleared. */
function healOut(p: Player): ReturnType<typeof tickRecovery> {
  const rng = new Rng(7)
  let last = tickRecovery({ players: [p], playedToday: new Set(), rng })
  while (p.injuryStatus !== null) last = tickRecovery({ players: [p], playedToday: new Set(), rng })
  return last
}

describe('match rust — heal', () => {
  it('a long layoff returns a player rusty, scaled to the absence', () => {
    const p = makePlayer({ injuryStatus: injury(1, 12) }) // one day left, was out 12
    const res = healOut(p)
    expect(p.injuryStatus).toBeNull()
    expect(p.rustGames).toBeGreaterThan(0)
    expect(res.returns.map((r) => r.id)).toContain(p.id)
    expect(res.returns[0].rustGames).toBe(p.rustGames)
  })

  it('a longer absence means more rust (up to the cap)', () => {
    const shortish = makePlayer({ injuryStatus: injury(1, 6) })
    const long = makePlayer({ injuryStatus: injury(1, 20) })
    healOut(shortish)
    healOut(long)
    expect(long.rustGames!).toBeGreaterThan(shortish.rustGames!)
    expect(long.rustGames!).toBeLessThanOrEqual(6) // capped
  })

  it('a day-to-day tweak leaves no rust', () => {
    const p = makePlayer({ injuryStatus: injury(1, 3) }) // under the 5-game threshold
    const res = healOut(p)
    expect(p.injuryStatus).toBeNull()
    expect(p.rustGames ?? 0).toBe(0)
    expect(res.returns).toHaveLength(0)
  })
})

describe('match rust — sim impact and burn-off', () => {
  it('the sim reads a rusty player below his true rating', () => {
    const sharp = makePlayer()
    const rusty = makePlayer({ rustGames: 6 })
    const resolve = effectiveResolve((id) => (id === sharp.id ? sharp : rusty))
    const sharpScoring = resolve(sharp.id).composites.scoring
    const rustyScoring = resolve(rusty.id).composites.scoring
    expect(rustyScoring).toBeLessThan(sharpScoring)
  })

  it('playing games burns off rust; resting does not', () => {
    const p = makePlayer({ rustGames: 3 })
    const rng = new Rng(3)
    // A rest day should NOT reduce rust (you round into shape by playing).
    tickRecovery({ players: [p], playedToday: new Set(), rng })
    expect(p.rustGames).toBe(3)
    // Three games played clears it exactly.
    for (let g = 0; g < 3; g++) tickRecovery({ players: [p], playedToday: new Set([p.id]), rng })
    expect(p.rustGames ?? 0).toBe(0)
  })

  it('is fully sharp again once rust is gone', () => {
    const p = makePlayer({ rustGames: 2 })
    const rng = new Rng(1)
    tickRecovery({ players: [p], playedToday: new Set([p.id]), rng })
    tickRecovery({ players: [p], playedToday: new Set([p.id]), rng })
    expect(p.rustGames ?? 0).toBe(0)
    // Reset the other condition axes so we isolate rust: an un-rusty player at
    // baseline condition must resolve identically to a never-injured baseline.
    p.fatigue = 0; p.morale = 60; p.form = 0
    const resolve = effectiveResolve(() => p)
    const baseline = makePlayer()
    const baseResolve = effectiveResolve(() => baseline)
    expect(resolve(p.id).composites.scoring).toBe(baseResolve(baseline.id).composites.scoring)
  })
})
