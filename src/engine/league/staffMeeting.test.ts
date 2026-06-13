/**
 * staffMeeting.test.ts — agenda discussion opinions.
 */
import { describe, it, expect } from 'vitest'
import type { Player, Position, RawAttributes } from '@domain'
import { computeComposites } from '@engine/ratings/composites'
import type { TeamStaff, StaffMember } from './staff'
import { discussPlayerTopic, PLAYER_TOPICS, agendaLabel } from './staffMeeting'

function raw(v: number): RawAttributes {
  return {
    technical: { wristShot: v, slapShot: v, stickhandling: v, passing: v, deflections: v, faceoffs: v },
    physical: { speed: v, acceleration: v, strength: v, balance: v, stamina: v, agility: v, height: 50 },
    mental: { offensiveIQ: v, defensiveIQ: v, positioning: v, vision: v, aggression: v, composure: v, workRate: v, discipline: v, anticipation: v },
    defensive: { checking: v, shotBlocking: v, stickChecking: v, takeaway: v },
  }
}

function player(over: Partial<{ position: Position; v: number; age: number; form: number; years: number }>): Player {
  const v = over.v ?? 60
  const r = raw(v)
  return {
    id: 'p1' as unknown as Player['id'], name: 'Test Player', age: over.age ?? 26,
    position: over.position ?? 'C', handedness: 'L', role: 'twoWay',
    ratings: r, potential: r, composites: computeComposites(r, 'twoWay', over.position ?? 'C'),
    personality: { ambition: 10, professionalism: 10, loyalty: 10, temperament: 10, determination: 10 },
    contract: { salary: 1, yearsRemaining: over.years ?? 3, expiryYear: 2030, noTradeClause: false, twoWay: false },
    stats: [], fatigue: 0, morale: 60, injuryStatus: null, form: over.form ?? 0,
  } as unknown as Player
}

function staffMember(name: string, role: StaffMember['role']): StaffMember {
  return { id: name, name, role, rating: 70, judgment: 70 } as StaffMember
}

const staff: TeamStaff = {
  headCoach: staffMember('Dan Coach', 'headCoach'),
  assistantCoaches: [],
  assistantGM: staffMember('Wes Manager', 'assistantGM'),
  scouts: [staffMember('Sam Scout', 'scout')],
  physios: [],
  owner: staffMember('Mario Owner', 'owner'),
}

describe('discussPlayerTopic', () => {
  it('the head coach addresses form', () => {
    const r = discussPlayerTopic({ player: player({ form: -6 }), topic: 'form', staff })
    expect(r.speakerRole).toBe('Head Coach')
    expect(r.opinion.length).toBeGreaterThan(0)
  })

  it('the AGM addresses trade value', () => {
    const r = discussPlayerTopic({ player: player({ v: 88 }), topic: 'tradeValue', staff })
    expect(r.speakerRole).toBe('Assistant GM')
    expect(r.opinion.toLowerCase()).toContain('premium')
  })

  it('a scout addresses development', () => {
    const r = discussPlayerTopic({ player: player({ age: 20, v: 78 }), topic: 'development', staff })
    expect(r.speakerRole).toBe('Scout')
  })

  it('is deterministic', () => {
    const p = player({ form: 5 })
    expect(discussPlayerTopic({ player: p, topic: 'form', staff }))
      .toEqual(discussPlayerTopic({ player: p, topic: 'form', staff }))
  })

  it('agendaLabel composes name and topic', () => {
    expect(agendaLabel('Sidney Crosby', 'form')).toContain('Sidney Crosby')
    expect(PLAYER_TOPICS.length).toBeGreaterThan(0)
  })
})
