/**
 * playerProjection.test.ts — roster-fit Suggested/Projected status + coach reports.
 */
import { describe, it, expect } from 'vitest'
import type { Player, Position, RawAttributes } from '@domain'
import { computeComposites } from '@engine/ratings/composites'
import { buildRosterProjection, buildCoachReports, type StaffLike, type SeasonForm } from './playerProjection'

function raw(v: number): RawAttributes {
  return {
    technical: { wristShot: v, slapShot: v, stickhandling: v, passing: v, deflections: v, faceoffs: v },
    physical: { speed: v, acceleration: v, strength: v, balance: v, stamina: v, agility: v, height: 50 },
    mental: { offensiveIQ: v, defensiveIQ: v, positioning: v, vision: v, aggression: v, composure: v, workRate: v, discipline: v, anticipation: v },
    defensive: { checking: v, shotBlocking: v, stickChecking: v, takeaway: v },
  }
}

function player(over: Partial<{ id: string; position: Position; cur: number; pot: number; age: number; det: number }>): Player {
  const cur = over.cur ?? 60
  const pot = over.pot ?? cur
  const pos = over.position ?? 'C'
  return {
    id: (over.id ?? 'p1') as unknown as Player['id'], name: 'Test Player', age: over.age ?? 24,
    position: pos, handedness: 'L', role: 'twoWay',
    ratings: raw(cur), potential: raw(pot), composites: computeComposites(raw(cur), 'twoWay', pos),
    personality: { ambition: 10, professionalism: 10, loyalty: 10, temperament: 10, determination: over.det ?? 10 },
    contract: { salary: 1, yearsRemaining: 3, expiryYear: 2030, noTradeClause: false, twoWay: false },
    stats: [], fatigue: 0, morale: 60, injuryStatus: null, form: 0,
  } as unknown as Player
}

const coach: StaffLike = { name: 'Coach Smith', role: 'headCoach', judgment: 70 }

describe('buildRosterProjection', () => {
  it('an elite forward on a weak club is NHL-ready and slots top-line', () => {
    const star = player({ id: 'star', cur: 90, pot: 92, position: 'C' })
    const roster = [star, ...Array.from({ length: 11 }, (_, i) => player({ id: `f${i}`, cur: 45, position: 'C' }))]
    const proj = buildRosterProjection({ player: star, teamName: 'Pittsburgh', clubRoster: roster, coachName: 'Coach Smith' })
    expect(proj.nhlReady).toBe(true)
    expect(proj.currentRole).toMatch(/first-line/)
    expect(proj.suggestedStatus).toContain('Pittsburgh')
    expect(proj.projectedStatus).toContain('Pittsburgh')
  })

  it('a weak forward buried behind a deep roster is not NHL-ready', () => {
    const weak = player({ id: 'weak', cur: 40, pot: 45, position: 'C', age: 26 })
    const roster = [weak, ...Array.from({ length: 13 }, (_, i) => player({ id: `f${i}`, cur: 70, position: 'C' }))]
    const proj = buildRosterProjection({ player: weak, teamName: 'Pittsburgh', clubRoster: roster, coachName: 'Coach Smith' })
    expect(proj.nhlReady).toBe(false)
    expect(proj.suggestedStatus.toLowerCase()).toMatch(/ahl|isn't ready/)
  })

  it('a young high-ceiling player gets a "future" projected status', () => {
    const kid = player({ id: 'kid', cur: 55, pot: 80, position: 'C', age: 19 })
    const roster = [kid, ...Array.from({ length: 12 }, (_, i) => player({ id: `f${i}`, cur: 65, position: 'C' }))]
    const proj = buildRosterProjection({ player: kid, teamName: 'Pittsburgh', clubRoster: roster, coachName: 'Coach Smith' })
    expect(proj.projectedStatus.toLowerCase()).toContain('future')
    expect(proj.ceilingRole.length).toBeGreaterThan(0)
  })
})

describe('buildCoachReports', () => {
  it('returns one deterministic report per coach', () => {
    const p = player({ id: 'rep', cur: 60, pot: 75, age: 20, det: 16 })
    const coaches: StaffLike[] = [
      coach,
      { name: 'Asst Jones', role: 'assistantCoach', judgment: 55 },
    ]
    const a = buildCoachReports(p, coaches)
    const b = buildCoachReports(p, coaches)
    expect(a).toHaveLength(2)
    expect(a[0]!.text.length).toBeGreaterThan(0)
    expect(a[0]!.coachRole).toBe('Head Coach')
    expect(a).toEqual(b) // deterministic
  })

  it('in-season form changes what the coaches say', () => {
    const p = player({ id: 'dyn', cur: 65, pot: 70, age: 26 })
    const hot: SeasonForm = { form: 4, morale: 80, injured: false, gamesPlayed: 20, points: 30, expectedPoints: 40 }
    const cold: SeasonForm = { form: -4, morale: 50, injured: false, gamesPlayed: 20, points: 5, expectedPoints: 40 }
    const hotText = buildCoachReports(p, [coach], hot)[0]!.text
    const coldText = buildCoachReports(p, [coach], cold)[0]!.text
    expect(hotText).not.toBe(coldText)
    expect(hotText.toLowerCase()).toMatch(/form|hot|reliable|outproduc|ahead/)
    expect(coldText.toLowerCase()).toMatch(/quiet|rut|dipped|lag|behind/)
  })

  it('injury is reflected in the report', () => {
    const p = player({ id: 'inj', cur: 70, pot: 72, age: 28 })
    const hurt: SeasonForm = { form: 0, morale: 60, injured: true, gamesPlayed: 5, points: 2, expectedPoints: 40 }
    const text = buildCoachReports(p, [coach], hurt)[0]!.text
    expect(text.toLowerCase()).toContain('injury')
  })
})
