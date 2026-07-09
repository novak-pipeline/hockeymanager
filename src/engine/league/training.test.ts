/**
 * #170 Training regimen — the practice-focus attribute bias threaded into the
 * development engines. Guards two properties:
 *   1. Absent bias is byte-identical to the pre-training behaviour (calibration).
 *   2. A focus reallocates growth — targeted attributes climb faster, the rest
 *      drag (the opportunity cost of specialising).
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { developPlayers } from './offseason'
import { tickInSeasonDevelopment } from './inSeasonDevelopment'
import { Rng } from '@engine/shared/rng'
import type { Player, PlayerId } from '@domain'

/** A young player with headroom to grow (potential cranked above current). */
function youngProspect(): Player {
  const data = generateLeague({ seed: 616 })
  const p = [...data.players.values()]
    .filter((x) => x.position !== 'G' && x.age <= 22)
    .sort((a, b) => a.age - b.age)[0]!
  const clone = structuredClone(p)
  // Guarantee a real gap on both a targeted and an untargeted attribute.
  clone.ratings.technical.wristShot = 55
  clone.potential.technical.wristShot = 85
  clone.ratings.defensive.checking = 55
  clone.potential.defensive.checking = 85
  return clone
}

function runOffseason(p: Player, bias?: (id: PlayerId) => Partial<Record<string, number>> | undefined): Player {
  const clone = structuredClone(p)
  const players = new Map<PlayerId, Player>([[clone.id, clone]])
  developPlayers({
    players,
    gamesPlayedById: () => 60,
    year: 2025,
    rng: new Rng(123),
    attributeBias: bias,
  })
  return players.get(clone.id)!
}

describe('training regimen — offseason development bias (#170)', () => {
  it('is byte-identical when no bias is supplied (calibration preserved)', () => {
    const p = youngProspect()
    const noArg = runOffseason(p)
    const undefinedBias = runOffseason(p, () => undefined)
    expect(undefinedBias.ratings).toEqual(noArg.ratings)
  })

  it('a focus grows the targeted attribute faster and drags the rest', () => {
    const p = youngProspect()
    const neutral = runOffseason(p)
    const focused = runOffseason(p, () => ({ wristShot: 0.2 }))
    // Targeted attribute climbs at least as much (a real gap ⇒ strictly more).
    expect(focused.ratings.technical.wristShot).toBeGreaterThanOrEqual(neutral.ratings.technical.wristShot)
    expect(focused.ratings.technical.wristShot).toBeGreaterThan(p.ratings.technical.wristShot)
    // Untargeted attribute develops no faster than neutral (the opportunity cost).
    expect(focused.ratings.defensive.checking).toBeLessThanOrEqual(neutral.ratings.defensive.checking)
  })
})

describe('training regimen — in-season development bias (#170)', () => {
  function runInSeason(p: Player, bias?: (id: PlayerId) => Partial<Record<string, number>> | undefined): Player {
    const clone = structuredClone(p)
    const players = new Map<PlayerId, Player>([[clone.id, clone]])
    tickInSeasonDevelopment({
      players,
      developIds: new Set([clone.id]),
      gamesPlayedById: () => 40,
      rng: new Rng(77),
      attributeBias: bias,
    })
    return players.get(clone.id)!
  }

  it('is byte-identical when no bias is supplied', () => {
    const p = youngProspect()
    const noArg = runInSeason(p)
    const undefinedBias = runInSeason(p, () => undefined)
    expect(undefinedBias.ratings).toEqual(noArg.ratings)
  })

  it('reallocates the micro-pass toward the focus', () => {
    const p = youngProspect()
    const neutral = runInSeason(p)
    const focused = runInSeason(p, () => ({ wristShot: 0.2 }))
    expect(focused.ratings.technical.wristShot).toBeGreaterThanOrEqual(neutral.ratings.technical.wristShot)
    expect(focused.ratings.defensive.checking).toBeLessThanOrEqual(neutral.ratings.defensive.checking)
  })
})
