import { describe, expect, it } from 'vitest'
import type { TeamId } from '@domain'
import { buildCompetitions, defaultTier, type RawCompetition } from './leagueWorld'

const tid = (s: string): TeamId => s as unknown as TeamId

/** A small hand-authored slice of the world: NHL + AHL + a junior + a Euro
 *  league + an obscure tier, so the builder can be proven before the real
 *  multi-league import lands. */
const COMPS: RawCompetition[] = [
  { id: 'nhl', name: 'National Hockey League', abbrev: 'NHL', nation: 'United States', level: 1, reputation: 20 },
  { id: 'ahl', name: 'American Hockey League', abbrev: 'AHL', nation: 'United States', level: 2, reputation: 15, parentId: 'nhl' },
  { id: 'ohl', name: 'Ontario Hockey League', abbrev: 'OHL', nation: 'Canada', level: 1, reputation: 12, upperAgeLimit: 20 },
  { id: 'shl', name: 'Swedish Hockey League', abbrev: 'SHL', nation: 'Sweden', level: 1, reputation: 17 },
  { id: 'obscure', name: 'Lower Bush League', abbrev: 'LBL', nation: 'Latvia', level: 3, reputation: 5 },
  { id: 'empty', name: 'Defunct League', abbrev: 'DEF', nation: 'France', level: 2, reputation: 8 },
]

function membershipOf(): Array<{ teamId: TeamId; competitionId: string }> {
  const m: Array<{ teamId: TeamId; competitionId: string }> = []
  const add = (comp: string, n: number): void => {
    for (let i = 0; i < n; i++) m.push({ teamId: tid(`${comp}-t${i}`), competitionId: comp })
  }
  add('nhl', 8)
  add('ahl', 8)
  add('ohl', 10)
  add('shl', 6)
  add('obscure', 6)
  // 'empty' gets no teams
  return m
}

describe('defaultTier', () => {
  it('marks the NHL active, recognised feeders/majors simulated, obscure leagues background', () => {
    expect(defaultTier(COMPS[0]!)).toBe('active')
    expect(defaultTier(COMPS[1]!)).toBe('simulated') // AHL
    expect(defaultTier(COMPS[2]!)).toBe('simulated') // OHL
    expect(defaultTier(COMPS[3]!)).toBe('simulated') // SHL
    expect(defaultTier(COMPS[4]!)).toBe('background') // obscure low-rep tier-3
  })

  it('simulates a strong unrecognised top division by reputation', () => {
    expect(defaultTier({ id: 'x', name: 'Big New League', abbrev: 'BNL', nation: 'Germany', level: 1, reputation: 15 })).toBe('simulated')
    expect(defaultTier({ id: 'y', name: 'Tiny League', abbrev: 'TNY', nation: 'Italy', level: 1, reputation: 8 })).toBe('background')
  })
})

describe('buildCompetitions', () => {
  const comps = buildCompetitions({ comps: COMPS, membership: membershipOf(), season: 2025 })
  const byId = new Map(comps.map((c) => [c.id, c]))

  it('drops competitions with no member teams', () => {
    expect(byId.has('empty')).toBe(false)
    expect(comps.length).toBe(5)
  })

  it('assigns NHLe strength ordered NHL > SHL > AHL > OHL > obscure', () => {
    expect(byId.get('nhl')!.strength).toBe(1)
    expect(byId.get('shl')!.strength).toBeGreaterThan(byId.get('ahl')!.strength)
    expect(byId.get('ahl')!.strength).toBeGreaterThan(byId.get('ohl')!.strength)
    expect(byId.get('ohl')!.strength).toBeGreaterThan(byId.get('obscure')!.strength)
  })

  it('wires teams, standings and parent/age-limit metadata', () => {
    const ahl = byId.get('ahl')!
    expect(ahl.teamIds).toHaveLength(8)
    expect(ahl.standings).toHaveLength(8)
    expect(ahl.parentId).toBe('nhl')
    expect(byId.get('ohl')!.upperAgeLimit).toBe(20)
  })

  it('schedules simulated leagues but not background ones', () => {
    expect(byId.get('ahl')!.schedule.length).toBeGreaterThan(0)
    expect(byId.get('ohl')!.schedule.length).toBeGreaterThan(0)
    expect(byId.get('obscure')!.schedule).toHaveLength(0) // background tier
  })

  it('never schedules a team twice on the same day within a competition', () => {
    for (const c of comps) {
      const perDay = new Map<number, Set<string>>()
      for (const g of c.schedule) {
        const s = perDay.get(g.day) ?? new Set<string>()
        expect(s.has(g.homeTeamId as string)).toBe(false)
        expect(s.has(g.awayTeamId as string)).toBe(false)
        s.add(g.homeTeamId as string); s.add(g.awayTeamId as string)
        perDay.set(g.day, s)
      }
    }
  })

  it('is deterministic', () => {
    const again = buildCompetitions({ comps: COMPS, membership: membershipOf(), season: 2025 })
    expect(again).toEqual(comps)
  })
})
