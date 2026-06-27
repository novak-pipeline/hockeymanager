import { describe, it, expect } from 'vitest'
import { Rng } from '@engine/shared/rng'
import { generateOwnerRequest } from './ownerMeddling'

describe('ownerMeddling — generateOwnerRequest', () => {
  it('returns null when the owner stays out of it', () => {
    // chance 0 → never meddles.
    expect(generateOwnerRequest({ mandate: 'contend', year: 2025, day: 30, rng: new Rng(1), chance: 0 })).toBeNull()
  })

  it('produces a mandate-appropriate ask with sensible confidence swings', () => {
    const req = generateOwnerRequest({ mandate: 'cutCosts', year: 2025, day: 30, rng: new Rng(7), chance: 1 })
    expect(req).not.toBeNull()
    // cutCosts owners ask for housekeeping, not marquee signings.
    expect(['trimPayroll', 'developYouth']).toContain(req!.kind)
    expect(req!.acceptConfidence).toBeGreaterThan(0)
    expect(req!.declineConfidence).toBeLessThan(0)
  })

  it('win-now mandates push for playoffs or stars', () => {
    const req = generateOwnerRequest({ mandate: 'cupOrBust', year: 2025, day: 60, rng: new Rng(3), chance: 1 })
    expect(req).not.toBeNull()
    expect(['pushForPlayoffs', 'signMarketableStar', 'extendFanFavourite']).toContain(req!.kind)
  })

  it('is deterministic for the same seed', () => {
    const a = generateOwnerRequest({ mandate: 'makePlayoffs', year: 2025, day: 30, rng: new Rng(42), chance: 1 })
    const b = generateOwnerRequest({ mandate: 'makePlayoffs', year: 2025, day: 30, rng: new Rng(42), chance: 1 })
    expect(a).toEqual(b)
  })
})
