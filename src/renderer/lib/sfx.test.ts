/**
 * Unit tests for sfx.ts pure helper functions.
 *
 * AudioContext is NOT available in Vitest/Node; every test here only exercises
 * the exported pure functions that contain no browser APIs.
 */
import { describe, it, expect } from 'vitest'
import { adsrValue, clamp, dangerToSnapGain, dangerToWhooshGain, crowdFrequency } from './sfx'

// ── clamp ──────────────────────────────────────────────────────────────────

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5)
  })
  it('clamps below lower bound', () => {
    expect(clamp(-1, 0, 1)).toBe(0)
  })
  it('clamps above upper bound', () => {
    expect(clamp(2, 0, 1)).toBe(1)
  })
  it('handles equal bounds', () => {
    expect(clamp(5, 5, 5)).toBe(5)
  })
})

// ── adsrValue ──────────────────────────────────────────────────────────────

describe('adsrValue', () => {
  // parameters: attack=0.1, decay=0.1, sustain=0.7, release=0.2, total=1.0
  const A = 0.1, D = 0.1, S = 0.7, R = 0.2, T = 1.0

  it('returns 0 at t<0', () => {
    expect(adsrValue(-0.01, A, D, S, R, T)).toBe(0)
  })

  it('returns 0 at t=0 (attack start)', () => {
    expect(adsrValue(0, A, D, S, R, T)).toBe(0)
  })

  it('returns 1 at peak (end of attack)', () => {
    expect(adsrValue(A, A, D, S, R, T)).toBeCloseTo(1, 5)
  })

  it('returns sustain level at sustain phase', () => {
    // At t = attack + decay = 0.2, gain should equal sustain
    const v = adsrValue(A + D, A, D, S, R, T)
    expect(v).toBeCloseTo(S, 4)
  })

  it('stays at sustain level in the middle', () => {
    // t = 0.5 is well within sustain
    expect(adsrValue(0.5, A, D, S, R, T)).toBeCloseTo(S, 4)
  })

  it('approaches 0 at the end of release', () => {
    // t = T (end), release should finish at 0
    const v = adsrValue(T, A, D, S, R, T)
    expect(v).toBeCloseTo(0, 4)
  })

  it('is monotonically falling during release', () => {
    const releaseStart = T - R
    const v1 = adsrValue(releaseStart, A, D, S, R, T)
    const v2 = adsrValue(releaseStart + R / 2, A, D, S, R, T)
    const v3 = adsrValue(T, A, D, S, R, T)
    expect(v1).toBeGreaterThan(v2)
    expect(v2).toBeGreaterThan(v3)
  })

  it('is monotonically rising during attack', () => {
    const v1 = adsrValue(0, A, D, S, R, T)
    const v2 = adsrValue(A / 2, A, D, S, R, T)
    const v3 = adsrValue(A, A, D, S, R, T)
    expect(v1).toBeLessThan(v2)
    expect(v2).toBeLessThan(v3)
  })
})

// ── dangerToSnapGain ───────────────────────────────────────────────────────

describe('dangerToSnapGain', () => {
  it('returns 0.4 at danger=0', () => {
    expect(dangerToSnapGain(0)).toBeCloseTo(0.4, 5)
  })

  it('returns 1.0 at danger=1', () => {
    expect(dangerToSnapGain(1)).toBeCloseTo(1.0, 5)
  })

  it('is strictly increasing between 0 and 1', () => {
    const v0 = dangerToSnapGain(0)
    const v05 = dangerToSnapGain(0.5)
    const v1 = dangerToSnapGain(1)
    expect(v0).toBeLessThan(v05)
    expect(v05).toBeLessThan(v1)
  })

  it('clamps danger below 0', () => {
    expect(dangerToSnapGain(-0.5)).toBe(dangerToSnapGain(0))
  })

  it('clamps danger above 1', () => {
    expect(dangerToSnapGain(1.5)).toBe(dangerToSnapGain(1))
  })
})

// ── dangerToWhooshGain ────────────────────────────────────────────────────

describe('dangerToWhooshGain', () => {
  it('returns 0 at danger=0', () => {
    expect(dangerToWhooshGain(0)).toBeCloseTo(0, 5)
  })

  it('returns 0.35 at danger=1', () => {
    expect(dangerToWhooshGain(1)).toBeCloseTo(0.35, 5)
  })

  it('is strictly increasing between 0 and 1', () => {
    expect(dangerToWhooshGain(0.3)).toBeLessThan(dangerToWhooshGain(0.8))
  })

  it('clamps out-of-range values', () => {
    expect(dangerToWhooshGain(-1)).toBe(dangerToWhooshGain(0))
    expect(dangerToWhooshGain(2)).toBe(dangerToWhooshGain(1))
  })
})

// ── crowdFrequency ────────────────────────────────────────────────────────

describe('crowdFrequency', () => {
  it('returns 300 Hz at level=0', () => {
    expect(crowdFrequency(0)).toBeCloseTo(300, 5)
  })

  it('returns 1200 Hz at level=1', () => {
    expect(crowdFrequency(1)).toBeCloseTo(1200, 5)
  })

  it('is monotonically increasing', () => {
    expect(crowdFrequency(0.25)).toBeLessThan(crowdFrequency(0.75))
  })

  it('clamps below 0', () => {
    expect(crowdFrequency(-1)).toBe(crowdFrequency(0))
  })

  it('clamps above 1', () => {
    expect(crowdFrequency(2)).toBe(crowdFrequency(1))
  })
})

// ── MatchSfx construction guard ────────────────────────────────────────────

describe('MatchSfx (construction guard)', () => {
  it('can be imported without throwing in Node (no AudioContext)', async () => {
    // Dynamic import ensures no top-level AudioContext access
    const { MatchSfx } = await import('./sfx')
    expect(() => new MatchSfx()).not.toThrow()
  })

  it('all public methods are no-ops when AudioContext is absent', async () => {
    const { MatchSfx } = await import('./sfx')
    const sfx = new MatchSfx()
    // None of these should throw in a Node environment
    expect(() => sfx.setEnabled(true)).not.toThrow()
    expect(() => sfx.setEnabled(false)).not.toThrow()
    expect(() => sfx.setVolume(0.5)).not.toThrow()
    expect(() => sfx.resume()).not.toThrow()
    expect(() => sfx.pass()).not.toThrow()
    expect(() => sfx.shot(0.8)).not.toThrow()
    expect(() => sfx.save()).not.toThrow()
    expect(() => sfx.goalHorn()).not.toThrow()
    expect(() => sfx.whistle()).not.toThrow()
    expect(() => sfx.puckDrop()).not.toThrow()
    expect(() => sfx.crowd(0.5)).not.toThrow()
    expect(() => sfx.dispose()).not.toThrow()
  })
})
