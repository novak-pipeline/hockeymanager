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

  it('every ask carries a first-person line the owner can actually say on the phone', () => {
    // The `body` is card prose — it describes the owner in the third person and
    // ends with UI consequence hints. Voicing that in his own mouth is what made
    // the living phone nonsense, so every template must also carry `spoken`.
    const MANDATES = [
      'cupOrBust', 'contend', 'makePlayoffs', 'competeRespectably', 'developYouth', 'rebuild', 'cutCosts',
    ] as const
    for (const mandate of MANDATES) {
      for (let seed = 0; seed < 12; seed++) {
        const req = generateOwnerRequest({ mandate, year: 2025, day: 30, rng: new Rng(seed), chance: 1 })
        if (!req) continue
        expect(req.spoken.length).toBeGreaterThan(60)
        expect(req.spoken).not.toMatch(/\bThe owner\b/)
        expect(req.spoken).not.toMatch(/pleases (him|ownership)|tests his patience|good PR/)
        expect(req.spoken).toMatch(/\b(I|I'm|I've|my)\b/)
      }
    }
  })

  it('is deterministic for the same seed', () => {
    const a = generateOwnerRequest({ mandate: 'makePlayoffs', year: 2025, day: 30, rng: new Rng(42), chance: 1 })
    const b = generateOwnerRequest({ mandate: 'makePlayoffs', year: 2025, day: 30, rng: new Rng(42), chance: 1 })
    expect(a).toEqual(b)
  })
})
