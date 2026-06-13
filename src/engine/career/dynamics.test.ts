/**
 * dynamics.test.ts — team dynamics view builder.
 */
import { describe, it, expect } from 'vitest'
import type { Player, Position } from '@domain'
import type { LockerRoomState } from '@engine/league/lockerRoom'
import { buildTeamDynamics } from './dynamics'

function player(over: Partial<{ id: string; pos: Position; morale: number; nat: string; leadership: number }>): Player {
  return {
    id: (over.id ?? 'p1') as unknown as Player['id'],
    name: `Player ${over.id ?? 'p1'}`,
    age: 26, position: over.pos ?? 'C', handedness: 'L', role: 'twoWay',
    personality: { ambition: 10, professionalism: 10, loyalty: 10, temperament: 10, determination: 10 },
    contract: { salary: 1, yearsRemaining: 2, expiryYear: 2030, noTradeClause: false, twoWay: false },
    stats: [], fatigue: 0, morale: over.morale ?? 60, injuryStatus: null, form: 0,
    ...(over.nat !== undefined ? { nationality: over.nat } : {}),
    ...(over.leadership !== undefined ? { leadership: over.leadership } : {}),
  } as unknown as Player
}

function lr(captainId: string, influence: Array<[string, number]>): LockerRoomState {
  return { captainId, alternateIds: [], influence, relationships: [], familiarity: [['a|b', 60]], roomMorale: 70 }
}

describe('buildTeamDynamics', () => {
  const roster = [
    player({ id: 'cap', morale: 85, leadership: 90 }),
    player({ id: 'hi', morale: 70 }),
    player({ id: 'mid', morale: 55 }),
    player({ id: 'fringe', morale: 30 }),
  ]
  const state = lr('cap', [['cap', 90], ['hi', 75], ['mid', 55], ['fringe', 20]])
  const view = buildTeamDynamics({ teamId: 't1', teamName: 'Test', roster, lockerRoom: state, headCoachName: 'Coach' })

  it('captain is a Team Leader', () => {
    expect(view.hierarchy.leaders.some((p) => p.playerId === 'cap')).toBe(true)
  })

  it('high-influence player is highly influential', () => {
    expect(view.hierarchy.highlyInfluential.some((p) => p.playerId === 'hi')).toBe(true)
  })

  it('low-influence player falls into Others social group', () => {
    expect(view.socialGroups.other.some((p) => p.playerId === 'fringe')).toBe(true)
  })

  it('happiness labels reflect morale', () => {
    const cap = view.happinessRows.find((p) => p.playerId === 'cap')!
    expect(cap.happiness).toBe('Delighted')
  })

  it('produces summary bars with labels', () => {
    expect(view.atmosphere.value).toBe(70)
    expect(view.cohesion.label.length).toBeGreaterThan(0)
    expect(view.topInfluencers[0]?.playerId).toBe('cap')
  })

  it('detects a secondary nationality group of 3+', () => {
    const r2 = [
      player({ id: 'a', nat: 'Canada' }), player({ id: 'b', nat: 'Canada' }), player({ id: 'c', nat: 'Canada' }),
      player({ id: 'd', nat: 'Sweden' }), player({ id: 'e', nat: 'Sweden' }), player({ id: 'f', nat: 'Sweden' }),
    ]
    const v2 = buildTeamDynamics({
      teamId: 't', teamName: 'T', roster: r2,
      lockerRoom: lr('a', r2.map((p) => [p.id as unknown as string, 50] as [string, number])),
      headCoachName: 'C',
    })
    expect(v2.socialGroups.secondaryLabel).not.toBeNull()
    expect(v2.socialGroups.secondary.length).toBe(3)
  })
})
