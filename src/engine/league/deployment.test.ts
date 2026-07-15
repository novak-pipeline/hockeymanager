import { describe, it, expect } from 'vitest'
import { deploymentProfile } from './deployment'
import type { Player } from '@domain'

/** Minimal player stub with only the fields deploymentProfile reads. */
function mk(position: Player['position'], composites: Partial<Player['composites']>): Player {
  const base = {
    scoring: 40, playmaking: 40, puckControl: 40, faceoffWin: 40, hitting: 40,
    blocking: 40, takeaway: 40, penaltyProne: 40, skating: 40, defensiveZone: 40,
  }
  return {
    position,
    role: 'balanced',
    composites: { ...base, ...composites },
    ratings: { technical: {}, physical: {}, mental: {}, defensive: {} },
  } as unknown as Player
}

describe('deployment — suitability', () => {
  it('returns undefined for goalies', () => {
    expect(deploymentProfile(mk('G', {}))).toBeUndefined()
  })

  it('forwards get four buckets; a sniper grades high on scoring + PP, low on PK', () => {
    const sniper = mk('W', { scoring: 92, playmaking: 78, defensiveZone: 30, takeaway: 28 })
    const d = deploymentProfile(sniper)!
    expect(d.suitability.map((s) => s.key).sort()).toEqual(['checking', 'pk', 'pp', 'scoring'])
    const star = (k: string) => d.suitability.find((s) => s.key === k)!.stars
    expect(star('scoring')).toBeGreaterThan(star('checking'))
    expect(star('pp')).toBeGreaterThan(star('pk'))
    expect(d.bestFit === 'Scoring line' || d.bestFit === 'Power play').toBe(true)
  })

  it('a shutdown D grades high on shutdown + PK, low on offense', () => {
    const shutdownD = mk('D', { defensiveZone: 90, blocking: 85, takeaway: 80, hitting: 78, scoring: 25, playmaking: 28 })
    const d = deploymentProfile(shutdownD)!
    expect(d.suitability.map((s) => s.key).sort()).toEqual(['offense', 'pk', 'pp', 'shutdown'])
    const star = (k: string) => d.suitability.find((s) => s.key === k)!.stars
    expect(star('shutdown')).toBeGreaterThan(star('offense'))
    expect(star('pk')).toBeGreaterThan(star('pp'))
    expect(d.usageNote.toLowerCase()).toContain('defensive')
  })

  it('stars are clamped to 0..5 in half-steps', () => {
    const elite = mk('C', { scoring: 100, playmaking: 100, puckControl: 100 })
    const d = deploymentProfile(elite)!
    for (const s of d.suitability) {
      expect(s.stars).toBeGreaterThanOrEqual(0)
      expect(s.stars).toBeLessThanOrEqual(5)
      expect(Number.isInteger(s.stars * 2)).toBe(true) // half-step
    }
    expect(d.suitability.find((s) => s.key === 'pp')!.stars).toBe(5)
  })

  it('a two-way forward gets the "complete forward" note', () => {
    const twoWay = mk('C', { scoring: 76, playmaking: 74, defensiveZone: 82, takeaway: 78, hitting: 70 })
    const d = deploymentProfile(twoWay)!
    expect(d.usageNote.toLowerCase()).toContain('every situation')
  })

  it('is deterministic', () => {
    const p = mk('W', { scoring: 70, playmaking: 60 })
    expect(deploymentProfile(p)).toEqual(deploymentProfile(p))
  })
})
