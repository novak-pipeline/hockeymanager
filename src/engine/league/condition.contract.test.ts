/**
 * The "contract year" effect: contractMotivation is a small, season-long
 * multiplier read from a player's deal and personality, and the sim actually
 * reads it (through effectiveResolve). These pin the shape — walk-year players
 * press for the payday (most of all pending UFAs), fresh-signed low-pro players
 * coast a touch, true pros and mid-deal players are neutral — and confirm it
 * moves on-ice ratings.
 */
import { describe, expect, it } from 'vitest'
import type { Contract, Personality, Player, Position, RawAttributes, SeasonStats } from '@domain'
import { asPlayerId } from '@domain'
import { computeComposites } from '@engine/ratings/composites'
import { contractMotivation, effectiveResolve } from './condition'

let nextId = 1
const pid = (): ReturnType<typeof asPlayerId> => asPlayerId(`p${nextId++}`)

function rawAttrs(val = 70): RawAttributes {
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

function make(opts: { age?: number; contract: Partial<Contract>; personality?: Partial<Personality> }): Player {
  const id = pid()
  const ratings = rawAttrs(70)
  const personality: Personality = {
    ambition: 10, professionalism: 10, loyalty: 10, temperament: 10, determination: 10, ...opts.personality
  }
  return {
    id, name: `Player ${id}`, age: opts.age ?? 26, position: 'W' as Position, handedness: 'L',
    role: 'twoWay', ratings, potential: ratings, composites: computeComposites(ratings, 'twoWay', 'W'),
    personality,
    contract: { salary: 4e6, yearsRemaining: 3, expiryYear: 2028, noTradeClause: false, twoWay: false, ...opts.contract },
    stats: [{ ...stats }], fatigue: 0, morale: 60, injuryStatus: null, form: 0
  }
}

describe('contractMotivation — shape', () => {
  it('boosts an ambitious pending-UFA in his walk year', () => {
    const p = make({ age: 30, contract: { yearsRemaining: 1 }, personality: { ambition: 20 } })
    expect(contractMotivation(p)).toBeGreaterThan(1.02)
  })

  it('gives a smaller push to a young RFA-to-be than a pending UFA', () => {
    const ufa = make({ age: 30, contract: { yearsRemaining: 1 }, personality: { ambition: 20 } })
    const rfa = make({ age: 23, contract: { yearsRemaining: 1 }, personality: { ambition: 20 } })
    expect(contractMotivation(rfa)).toBeGreaterThan(1) // still motivated
    expect(contractMotivation(rfa)).toBeLessThan(contractMotivation(ufa))
  })

  it('a low-ambition walk-year player is neutral, never penalised', () => {
    const p = make({ age: 30, contract: { yearsRemaining: 1 }, personality: { ambition: 4 } })
    expect(contractMotivation(p)).toBe(1)
  })

  it('a low-professionalism player fresh off a long deal coasts a touch', () => {
    const p = make({ contract: { yearsRemaining: 5 }, personality: { professionalism: 3 } })
    expect(contractMotivation(p)).toBeLessThan(1)
    expect(contractMotivation(p)).toBeGreaterThan(0.97)
  })

  it('a true pro on a long deal does not coast', () => {
    const p = make({ contract: { yearsRemaining: 5 }, personality: { professionalism: 18 } })
    expect(contractMotivation(p)).toBe(1)
  })

  it('a player in the middle of his deal is neutral', () => {
    const p = make({ contract: { yearsRemaining: 3 }, personality: { ambition: 20, professionalism: 3 } })
    expect(contractMotivation(p)).toBe(1)
  })
})

describe('contract year — the sim reads it', () => {
  it('a motivated walk-year star resolves above his flat rating', () => {
    const walkYear = make({ age: 30, contract: { yearsRemaining: 1 }, personality: { ambition: 20 } })
    const midDeal = make({ age: 30, contract: { yearsRemaining: 3 }, personality: { ambition: 20 } })
    const resolve = effectiveResolve((id) => (id === walkYear.id ? walkYear : midDeal))
    // Same ratings and condition; only the contract situation differs.
    expect(resolve(walkYear.id).composites.scoring).toBeGreaterThan(resolve(midDeal.id).composites.scoring)
  })
})
