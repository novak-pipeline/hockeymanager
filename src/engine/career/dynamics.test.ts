/**
 * dynamics.test.ts — team dynamics view builder.
 */
import { describe, it, expect } from 'vitest'
import type { Lines, Player, Position } from '@domain'
import type { LockerRoomState } from '@engine/league/lockerRoom'
import { buildTeamDynamics } from './dynamics'

function player(over: Partial<{ id: string; pos: Position; morale: number; nat: string; leadership: number; age: number; draftYear: number }>): Player {
  return {
    id: (over.id ?? 'p1') as unknown as Player['id'],
    name: `Player ${over.id ?? 'p1'}`,
    age: over.age ?? 26, position: over.pos ?? 'C', handedness: 'L', role: 'twoWay',
    personality: { ambition: 10, professionalism: 10, loyalty: 10, temperament: 10, determination: 10 },
    contract: { salary: 1, yearsRemaining: 2, expiryYear: 2030, noTradeClause: false, twoWay: false },
    stats: [], fatigue: 0, morale: over.morale ?? 60, injuryStatus: null, form: 0,
    ...(over.nat !== undefined ? { nationality: over.nat } : {}),
    ...(over.leadership !== undefined ? { leadership: over.leadership } : {}),
    ...(over.draftYear !== undefined ? { draftYear: over.draftYear } : {}),
  } as unknown as Player
}

function lr(captainId: string | null, influence: Array<[string, number]>, over: Partial<LockerRoomState> = {}): LockerRoomState {
  return {
    captainId, alternateIds: [], influence, relationships: [],
    familiarity: [['a|b', 60]], roomMorale: 70, ...over,
  }
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

  /* ── playtest #20: the bars explain themselves ── */

  it('a high-turnover roster yields a turnover driver on cohesion', () => {
    const r = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => player({ id }))
    const state = lr('a', r.map((p) => [p.id as unknown as string, 50] as [string, number]), {
      arrivals: [['b', 2026], ['c', 2026], ['d', 2026], ['e', 2026]],
      familiarity: [['a|b', 10]],
    })
    const v = buildTeamDynamics({
      teamId: 't', teamName: 'T', roster: r, lockerRoom: state, headCoachName: 'C',
      facts: { year: 2026 },
    })
    expect(v.cohesion.drivers?.some((d) => d.includes('4 new faces'))).toBe(true)
  })

  it('a slumping captain shows up as an atmosphere driver; a losing streak too', () => {
    const r = [player({ id: 'cap', morale: 30, leadership: 90 }), player({ id: 'x' }), player({ id: 'y' })]
    const state = lr('cap', [['cap', 80], ['x', 50], ['y', 50]])
    const v = buildTeamDynamics({
      teamId: 't', teamName: 'T', roster: r, lockerRoom: state, headCoachName: 'C',
      facts: { teamStreak: -5 },
    })
    const drivers = v.atmosphere.drivers ?? []
    expect(drivers.some((d) => d.includes('cap') && d.includes('30'))).toBe(true)
    expect(drivers.some((d) => d.includes('5 games without a win'))).toBe(true)
  })

  it('no captain reads as a leadership vacuum', () => {
    const r = [player({ id: 'x' }), player({ id: 'y' })]
    const v = buildTeamDynamics({
      teamId: 't', teamName: 'T', roster: r,
      lockerRoom: lr(null, [['x', 50], ['y', 45]]),
      headCoachName: 'C',
    })
    expect(v.leadership.drivers?.some((d) => d.toLowerCase().includes('vacuum'))).toBe(true)
  })

  it('every bar always carries at least one driver', () => {
    for (const bar of [view.cohesion, view.atmosphere, view.leadership]) {
      expect((bar.drivers ?? []).length).toBeGreaterThan(0)
      expect((bar.drivers ?? []).length).toBeLessThanOrEqual(3)
    }
  })

  /* ── playtest #20: real social groups ── */

  function diverseRoster(): Player[] {
    return [
      // leadership core
      player({ id: 'cap', leadership: 92, age: 30 }),
      player({ id: 'alt', leadership: 85, age: 31 }),
      // kids
      player({ id: 'k1', age: 20 }), player({ id: 'k2', age: 21 }), player({ id: 'k3', age: 22 }),
      // old guard
      player({ id: 'v1', age: 34 }), player({ id: 'v2', age: 35 }), player({ id: 'v3', age: 33 }),
      // Swedish bloc
      player({ id: 's1', nat: 'Sweden' }), player({ id: 's2', nat: 'Sweden' }), player({ id: 's3', nat: 'Sweden' }),
      // draft classmates
      player({ id: 'd1', draftYear: 2020 }), player({ id: 'd2', draftYear: 2020 }), player({ id: 'd3', draftYear: 2020 }),
      // fringe
      player({ id: 'f1' }), player({ id: 'f2' }),
    ]
  }

  function diverseState(): LockerRoomState {
    const ids: Array<[string, number]> = [
      ['cap', 90], ['alt', 80], ['k1', 40], ['k2', 38], ['k3', 35],
      ['v1', 60], ['v2', 58], ['v3', 55], ['s1', 50], ['s2', 48], ['s3', 46],
      ['d1', 45], ['d2', 44], ['d3', 43], ['f1', 15], ['f2', 12],
    ]
    const state = lr('cap', ids, {
      relationships: [
        { a: 'v1', b: 'k1', kind: 'mentorship', strength: 60, sinceYear: 2025 },
      ],
    })
    state.alternateIds = ['alt']
    return state
  }

  it('social groups are a real partition, not just core/country', () => {
    const v = buildTeamDynamics({
      teamId: 't', teamName: 'T', roster: diverseRoster(), lockerRoom: diverseState(), headCoachName: 'C',
    })
    const groups = v.socialGroups.groups ?? []
    const keys = groups.map((g) => g.key)
    // Multiple distinct group kinds beyond a single blob
    expect(groups.length).toBeGreaterThanOrEqual(4)
    expect(keys).toContain('core')
    expect(keys).toContain('kids')
    expect(keys).toContain('oldGuard')
    expect(keys.some((k) => k.startsWith('draft-'))).toBe(true)
    expect(keys.some((k) => k.startsWith('nat-'))).toBe(true)
    // Partition: every roster player appears exactly once
    const seen = new Map<string, number>()
    for (const g of groups) for (const m of g.members) seen.set(m.playerId, (seen.get(m.playerId) ?? 0) + 1)
    for (const p of diverseRoster()) {
      expect(seen.get(p.id as unknown as string)).toBe(1)
    }
  })

  it('every group card names its standing and its effect', () => {
    const v = buildTeamDynamics({
      teamId: 't', teamName: 'T', roster: diverseRoster(), lockerRoom: diverseState(), headCoachName: 'C',
    })
    for (const g of v.socialGroups.groups ?? []) {
      expect(g.note.length).toBeGreaterThan(0)
      expect(g.effect.length).toBeGreaterThan(0)
    }
    const core = (v.socialGroups.groups ?? []).find((g) => g.key === 'core')!
    expect(core.note).toMatch(/runs the room/i)
    expect(core.effect).toMatch(/captain/i)
    // The mentored kids cite the mentorship, either in the note or the effect
    const kids = (v.socialGroups.groups ?? []).find((g) => g.key === 'kids')!
    expect(`${kids.note} ${kids.effect}`).toMatch(/wing|mentorship/i)
  })

  it('a line that has played together forms a line-cell group with a chemistry effect', () => {
    const r = [
      player({ id: 'l1', pos: 'W' }), player({ id: 'l2', pos: 'C' }), player({ id: 'l3', pos: 'W' }),
      player({ id: 'x1' }), player({ id: 'x2' }),
    ]
    const state = lr(null, r.map((p) => [p.id as unknown as string, 50] as [string, number]), {
      familiarity: [['l1|l2', 80], ['l1|l3', 80], ['l2|l3', 80]],
    })
    const lines = {
      forwards: [['l1', 'l2', 'l3']], defensePairs: [], goalies: ['x1', 'x2'],
      powerPlayUnits: [], penaltyKillUnits: [],
    } as unknown as Lines
    const v = buildTeamDynamics({
      teamId: 't', teamName: 'T', roster: r, lockerRoom: state, headCoachName: 'C',
      facts: { lines },
    })
    const unit = (v.socialGroups.groups ?? []).find((g) => g.key.startsWith('unit-'))
    expect(unit).toBeDefined()
    expect(unit!.members.map((m) => m.playerId).sort()).toEqual(['l1', 'l2', 'l3'])
    expect(unit!.effect).toMatch(/chemistry/i)
    expect(unit!.effect).toMatch(/40 games/)
  })

  it('the view is deterministic — identical inputs, identical output', () => {
    const build = (): unknown => buildTeamDynamics({
      teamId: 't', teamName: 'T', roster: diverseRoster(), lockerRoom: diverseState(), headCoachName: 'C',
      facts: { year: 2026, teamStreak: 2 },
    })
    expect(build()).toEqual(build())
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
