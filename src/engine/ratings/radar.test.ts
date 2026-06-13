import { describe, expect, it } from 'vitest'
import type { RawAttributes } from '@domain'
import { computeComposites } from './composites'
import { computeRadar, RADAR_AXES } from './radar'

/** Build raw attributes with every field set to the same value. */
function flat(value: number): RawAttributes {
  return {
    technical: { wristShot: value, slapShot: value, stickhandling: value, passing: value, deflections: value, faceoffs: value },
    physical: { speed: value, acceleration: value, strength: value, balance: value, stamina: value, agility: value, height: value },
    mental: { offensiveIQ: value, defensiveIQ: value, positioning: value, vision: value, aggression: value, composure: value, workRate: value, discipline: value, anticipation: value },
    defensive: { checking: value, shotBlocking: value, stickChecking: value, takeaway: value },
  }
}

describe('computeRadar', () => {
  it('all axes are in 0–99 for any input', () => {
    for (const v of [0, 1, 50, 99, 100]) {
      const raw = flat(v)
      const composites = computeComposites(raw, 'twoWay', 'C')
      const radar = computeRadar(raw, composites)
      for (const axis of RADAR_AXES) {
        expect(radar[axis]).toBeGreaterThanOrEqual(0)
        expect(radar[axis]).toBeLessThanOrEqual(99)
        expect(Number.isInteger(radar[axis])).toBe(true)
      }
    }
  })

  it('elite player (90s) has high values on all axes', () => {
    const raw = flat(90)
    const composites = computeComposites(raw, 'sniper', 'W')
    const radar = computeRadar(raw, composites)
    for (const axis of RADAR_AXES) {
      expect(radar[axis]).toBeGreaterThan(60)
    }
  })

  it('grinder (35) has low values on all axes', () => {
    const raw = flat(35)
    const composites = computeComposites(raw, 'enforcer', 'W')
    const radar = computeRadar(raw, composites)
    for (const axis of RADAR_AXES) {
      expect(radar[axis]).toBeLessThan(70)
    }
  })

  it('sniper has higher shot and offensiveZone than shutdown D with same base', () => {
    const raw = flat(70)
    const sniperComp = computeComposites(raw, 'sniper', 'W')
    const shutdownComp = computeComposites(raw, 'shutdownD', 'D')
    const sniperRadar = computeRadar(raw, sniperComp)
    const shutdownRadar = computeRadar(raw, shutdownComp)
    expect(sniperRadar.shot).toBeGreaterThan(shutdownRadar.shot)
    expect(sniperRadar.offensiveZone).toBeGreaterThan(shutdownRadar.offensiveZone)
  })

  it('shutdown D has higher defensiveZone than sniper with same base', () => {
    const raw = flat(70)
    const sniperComp = computeComposites(raw, 'sniper', 'W')
    const shutdownComp = computeComposites(raw, 'shutdownD', 'D')
    const sniperRadar = computeRadar(raw, sniperComp)
    const shutdownRadar = computeRadar(raw, shutdownComp)
    expect(shutdownRadar.defensiveZone).toBeGreaterThan(sniperRadar.defensiveZone)
  })

  it('enforcer has higher physicality than playmaker with same base', () => {
    const raw = flat(70)
    const enforcerComp = computeComposites(raw, 'enforcer', 'W')
    const playmakerComp = computeComposites(raw, 'playmaker', 'C')
    const enforcerRadar = computeRadar(raw, enforcerComp)
    const playmakerRadar = computeRadar(raw, playmakerComp)
    expect(enforcerRadar.physicality).toBeGreaterThan(playmakerRadar.physicality)
  })

  it('RADAR_AXES covers all six expected axes', () => {
    expect(RADAR_AXES).toHaveLength(6)
    expect(RADAR_AXES).toContain('hockeyIQ')
    expect(RADAR_AXES).toContain('skating')
    expect(RADAR_AXES).toContain('shot')
    expect(RADAR_AXES).toContain('offensiveZone')
    expect(RADAR_AXES).toContain('defensiveZone')
    expect(RADAR_AXES).toContain('physicality')
  })

  it('goalie still gets a valid (mostly low) radar', () => {
    const raw: RawAttributes = {
      ...flat(50),
      goalie: { reflexes: 90, positioningG: 88, reboundControl: 85, glove: 86, blocker: 84, recovery: 87, puckHandlingG: 70 },
    }
    const composites = computeComposites(raw, 'starter', 'G')
    const radar = computeRadar(raw, composites)
    // Skating is defined for goalies (scaled 0.6 in composites)
    expect(radar.skating).toBeGreaterThanOrEqual(0)
    expect(radar.skating).toBeLessThanOrEqual(99)
    // All axes must still be in range
    for (const axis of RADAR_AXES) {
      expect(radar[axis]).toBeGreaterThanOrEqual(0)
      expect(radar[axis]).toBeLessThanOrEqual(99)
    }
  })

  it('is deterministic — same input always produces same output', () => {
    const raw = flat(75)
    const composites = computeComposites(raw, 'twoWay', 'C')
    const r1 = computeRadar(raw, composites)
    const r2 = computeRadar(raw, composites)
    for (const axis of RADAR_AXES) {
      expect(r1[axis]).toBe(r2[axis])
    }
  })
})
