import { describe, expect, it } from 'vitest'
import { projectProspect } from './prospectModel'

describe('projectProspect (NHLe projection model)', () => {
  it('an elite junior scorer projects as a near-lock star', () => {
    // 1.5 PPG forward in the CHL (0.30 NHLe), age 17.
    const r = projectProspect({ ppg: 1.5, leagueFactor: 0.30, age: 17, isD: false })
    expect(r.nhleNow).toBeGreaterThan(30)
    expect(r.projectedPeak).toBeGreaterThan(r.nhleNow) // age curve grows it
    expect(r.pNHLer).toBeGreaterThan(90)
    expect(r.pStar).toBeGreaterThan(50)
  })

  it('a depth junior forward is a long shot', () => {
    const r = projectProspect({ ppg: 0.4, leagueFactor: 0.30, age: 18, isD: false })
    expect(r.pNHLer).toBeLessThan(40)
    expect(r.pStar).toBeLessThan(15)
  })

  it('the same rate is worth more in a tougher league', () => {
    const chl = projectProspect({ ppg: 0.7, leagueFactor: 0.30, age: 18, isD: false })
    const shl = projectProspect({ ppg: 0.7, leagueFactor: 0.57, age: 18, isD: false })
    expect(shl.pNHLer).toBeGreaterThan(chl.pNHLer)
  })

  it('defencemen clear NHLer/star at lower point totals', () => {
    const d = projectProspect({ ppg: 0.8, leagueFactor: 0.30, age: 18, isD: true })
    const f = projectProspect({ ppg: 0.8, leagueFactor: 0.30, age: 18, isD: false })
    expect(d.pNHLer).toBeGreaterThan(f.pNHLer)
  })

  it('younger producers carry a larger projected-peak multiplier', () => {
    const y = projectProspect({ ppg: 1.0, leagueFactor: 0.30, age: 17, isD: false })
    const o = projectProspect({ ppg: 1.0, leagueFactor: 0.30, age: 20, isD: false })
    expect(y.projectedPeak).toBeGreaterThan(o.projectedPeak)
  })
})
