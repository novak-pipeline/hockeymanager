import { describe, expect, it } from 'vitest'
import { buildProspectGrade } from './prospectGrade'

describe('buildProspectGrade', () => {
  it('an elite, system-fitting need-filler grades near the top', () => {
    const r = buildProspectGrade({
      potentialStars: 5, currentStars: 4, position: 'C', age: 18,
      riskBand: 'Low', need: 'urgent', styleFitScore: 85, styleLabel: 'Speed & Skill',
    })
    expect(r.grade === 'A+' || r.grade === 'A').toBe(true)
    expect(r.pros.length).toBeGreaterThan(2)
  })

  it('a low-ceiling, surplus-position, poor-fit prospect grades low', () => {
    const r = buildProspectGrade({
      potentialStars: 2, currentStars: 1.5, position: 'W', age: 20,
      riskBand: 'High', need: 'surplus', styleFitScore: 40,
    })
    expect(['C', 'C-', 'D', 'F']).toContain(r.grade)
    expect(r.cons.length).toBeGreaterThan(2)
  })

  it('team context moves the grade — same talent grades higher when it fills a need + fits', () => {
    const talent = { potentialStars: 3.5, currentStars: 2.5, position: 'D' as const, age: 18 }
    const wanted = buildProspectGrade({ ...talent, need: 'urgent', styleFitScore: 82 })
    const surplus = buildProspectGrade({ ...talent, need: 'surplus', styleFitScore: 42 })
    expect(wanted.score).toBeGreaterThan(surplus.score)
  })

  it('spreads across the scale (not just A+/B)', () => {
    const grades = new Set<string>()
    for (let pot = 1; pot <= 5; pot += 0.5) {
      for (const need of ['urgent', 'ok', 'surplus'] as const) {
        grades.add(buildProspectGrade({ potentialStars: pot, currentStars: pot - 1, position: 'W', age: 18, need, styleFitScore: 60 }).grade)
      }
    }
    expect(grades.size).toBeGreaterThanOrEqual(6)
  })

  it('goaltenders carry a projection discount', () => {
    const base = { potentialStars: 4, currentStars: 2.5, age: 18, need: 'ok' as const }
    const g = buildProspectGrade({ ...base, position: 'G' })
    const skater = buildProspectGrade({ ...base, position: 'C', styleFitScore: 65 })
    expect(g.score).toBeLessThan(skater.score)
  })
})
