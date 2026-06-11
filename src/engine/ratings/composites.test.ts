import { describe, expect, it } from 'vitest'
import type { RawAttributes } from '@domain'
import { computeComposites, overall } from './composites'

/** Build raw attributes with every field set to the same value, for control. */
function flat(value: number): RawAttributes {
  return {
    technical: { wristShot: value, slapShot: value, stickhandling: value, passing: value, deflections: value, faceoffs: value },
    physical: { speed: value, acceleration: value, strength: value, balance: value, stamina: value, agility: value, height: value },
    mental: { offensiveIQ: value, defensiveIQ: value, positioning: value, vision: value, aggression: value, composure: value, workRate: value, discipline: value, anticipation: value },
    defensive: { checking: value, shotBlocking: value, stickChecking: value, takeaway: value }
  }
}

describe('computeComposites', () => {
  it('maps uniform raw attributes to roughly the same composite level', () => {
    const c = computeComposites(flat(60), 'twoWay', 'C')
    // twoWay nudges some composites; base level should still hover near 60.
    expect(c.scoring).toBeGreaterThan(40)
    expect(c.scoring).toBeLessThan(80)
    expect(c.skating).toBeCloseTo(60, 0)
  })

  it('keeps every composite within 0..100', () => {
    for (const v of [0, 50, 100]) {
      const c = computeComposites(flat(v), 'enforcer', 'W')
      for (const key in c) {
        const x = c[key as keyof typeof c]
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(100)
      }
    }
  })

  it('role modifiers differentiate snipers from playmakers', () => {
    const raw = flat(70)
    const sniper = computeComposites(raw, 'sniper', 'W')
    const playmaker = computeComposites(raw, 'playmaker', 'W')
    expect(sniper.scoring).toBeGreaterThan(playmaker.scoring)
    expect(playmaker.playmaking).toBeGreaterThan(sniper.playmaking)
  })

  it('shutdown D defend better but score worse than offensive D', () => {
    const raw = flat(70)
    const shutdown = computeComposites(raw, 'shutdownD', 'D')
    const offensive = computeComposites(raw, 'offensiveD', 'D')
    expect(shutdown.defensiveZone).toBeGreaterThan(offensive.defensiveZone)
    expect(offensive.scoring).toBeGreaterThan(shutdown.scoring)
  })

  it('goalies get goaltending and ignore skater composites', () => {
    const raw: RawAttributes = {
      ...flat(50),
      goalie: { reflexes: 90, positioningG: 88, reboundControl: 85, glove: 86, blocker: 84, recovery: 87, puckHandlingG: 70 }
    }
    const g = computeComposites(raw, 'starter', 'G')
    expect(g.goaltending).toBeGreaterThan(80)
    expect(g.scoring).toBe(0)
  })

  it('discipline reduces penaltyProne', () => {
    const raw = flat(50)
    const disciplined = { ...raw, mental: { ...raw.mental, discipline: 90, aggression: 20 } }
    const reckless = { ...raw, mental: { ...raw.mental, discipline: 20, aggression: 90 } }
    const a = computeComposites(disciplined, 'twoWay', 'C')
    const b = computeComposites(reckless, 'twoWay', 'C')
    expect(b.penaltyProne).toBeGreaterThan(a.penaltyProne)
  })

  it('overall is position-aware and bounded', () => {
    const c = computeComposites(flat(75), 'sniper', 'W')
    const ov = overall(c, 'W')
    expect(ov).toBeGreaterThan(0)
    expect(ov).toBeLessThanOrEqual(100)
  })
})
