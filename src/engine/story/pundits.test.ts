import { describe, it, expect } from 'vitest'
import {
  seedPundits,
  normalizePundits,
  rapportDelta,
  applyPunditAnswer,
  punditStanding,
  punditRead,
  coverageTilt,
  mediaStandingSummary,
  relationOf,
  PUNDIT_PERSONAS,
  type PunditState,
} from './pundits'

describe('pundits — seed + normalize', () => {
  it('seeds one neutral relationship per persona', () => {
    const s = seedPundits()
    expect(s.pundits).toHaveLength(PUNDIT_PERSONAS.length)
    for (const rel of s.pundits) {
      expect(rel.rapport).toBe(0)
      expect(rel.interactions).toBe(0)
    }
  })

  it('normalize backfills a missing persona and clamps stray values', () => {
    const partial: PunditState = {
      pundits: [{ personaId: 'beat', rapport: 999, interactions: -4 }],
    }
    const s = normalizePundits(partial)
    expect(s.pundits).toHaveLength(PUNDIT_PERSONAS.length)
    expect(relationOf(s, 'beat').rapport).toBe(100) // clamped
    expect(relationOf(s, 'beat').interactions).toBe(0) // floored
    expect(relationOf(s, 'national').rapport).toBe(0) // backfilled
  })

  it('normalize survives undefined / garbage', () => {
    expect(normalizePundits(undefined).pundits).toHaveLength(PUNDIT_PERSONAS.length)
    expect(normalizePundits(null).pundits).toHaveLength(PUNDIT_PERSONAS.length)
  })
})

describe('pundits — rapport model', () => {
  it('praise and measured help; deflecting hurts across the board', () => {
    for (const p of PUNDIT_PERSONAS) {
      expect(rapportDelta(p, 'deflecting')).toBeLessThan(0)
      expect(rapportDelta(p, 'praise')).toBeGreaterThan(0)
    }
  })

  it('the homer loves fire; the national sees through it', () => {
    expect(rapportDelta('homer', 'fiery')).toBeGreaterThan(0)
    expect(rapportDelta('national', 'fiery')).toBeLessThan(0)
    // the national values composure more than the homer does
    expect(rapportDelta('national', 'measured')).toBeGreaterThan(rapportDelta('homer', 'measured'))
  })

  it('applyPunditAnswer mutates state, clamps, and reports the shift', () => {
    const s = seedPundits()
    const r = applyPunditAnswer(s, 'homer', 'praise', 12)
    expect(r.delta).toBe(rapportDelta('homer', 'praise'))
    expect(r.rapportAfter).toBe(r.rapportBefore + r.delta)
    expect(relationOf(s, 'homer').interactions).toBe(1)
    expect(relationOf(s, 'homer').lastTone).toBe('praise')
    expect(relationOf(s, 'homer').lastDay).toBe(12)
  })

  it('repeated praise drives an ally; repeated dodging drives a feud', () => {
    const s = seedPundits()
    for (let i = 0; i < 20; i++) applyPunditAnswer(s, 'homer', 'praise', i)
    expect(punditStanding(relationOf(s, 'homer').rapport)).toBe('Ally')
    expect(relationOf(s, 'homer').rapport).toBe(100) // clamped, never overflows

    const t = seedPundits()
    for (let i = 0; i < 20; i++) applyPunditAnswer(t, 'beat', 'deflecting', i)
    expect(punditStanding(relationOf(t, 'beat').rapport)).toBe('Feud')
    expect(relationOf(t, 'beat').rapport).toBe(-100)
  })

  it('flags the exchange that crosses a standing boundary', () => {
    const s = seedPundits()
    let crossings = 0
    for (let i = 0; i < 12; i++) {
      const r = applyPunditAnswer(s, 'homer', 'praise', i)
      if (r.crossedBoundary) crossings += 1
    }
    // neutral → friendly → ally is at least two boundary crossings
    expect(crossings).toBeGreaterThanOrEqual(2)
  })
})

describe('pundits — standing + reads', () => {
  it('standing bands map monotonically', () => {
    expect(punditStanding(80)).toBe('Ally')
    expect(punditStanding(30)).toBe('Friendly')
    expect(punditStanding(0)).toBe('Neutral')
    expect(punditStanding(-30)).toBe('Critic')
    expect(punditStanding(-80)).toBe('Feud')
  })

  it('reads are non-empty and name the pundit', () => {
    const s = seedPundits()
    applyPunditAnswer(s, 'beat', 'praise', 1)
    const read = punditRead(relationOf(s, 'beat'))
    expect(read).toContain('Sam Carver')
    expect(read.length).toBeGreaterThan(10)
  })

  it('coverageTilt is 0 at neutral and signed with rapport', () => {
    const s = seedPundits()
    expect(coverageTilt(s, 'beat')).toBe(0)
    applyPunditAnswer(s, 'homer', 'praise', 1)
    expect(coverageTilt(s, 'homer')).toBeGreaterThan(0)
  })

  it('summary names the strongest ally and chief critic', () => {
    const s = seedPundits()
    for (let i = 0; i < 20; i++) applyPunditAnswer(s, 'homer', 'praise', i)
    for (let i = 0; i < 20; i++) applyPunditAnswer(s, 'national', 'deflecting', i)
    const sum = mediaStandingSummary(s)
    expect(sum.ally).toBe('homer')
    expect(sum.critic).toBe('national')
  })

  it('summary is empty when everyone is neutral', () => {
    const sum = mediaStandingSummary(seedPundits())
    expect(sum.ally).toBeNull()
    expect(sum.critic).toBeNull()
  })
})
