/**
 * W3 S4: a coach's system as the playbook the watched-game engine runs, with
 * the team's tactics on top where they are set (owner-approved).
 */
import { describe, expect, it } from 'vitest'
import type { TeamTactics } from '@domain'
import { BREAKOUT_PLANS, SYSTEM_META, SYSTEM_PLAYBOOK, buildCoachProfile, playbookFor, systemPlaybook, tacticsForSystem, type CoachSystemId } from './coachProfile'
import { Rng } from '@engine/shared/rng'

const BASE: TeamTactics = {
  forecheck: '1-2-2',
  dZoneCoverage: 'zone',
  tempo: { pace: 0.5, passRisk: 0.5, shotEagerness: 0.5, defensivePinch: 0.4 },
  specialTeams: { powerPlay: 'umbrella', penaltyKill: 'box' },
  lineMatching: false,
}
const SYSTEMS = Object.keys(SYSTEM_META) as CoachSystemId[]

describe('coach playbooks (W3 S4)', () => {
  it('every system has a playbook with a breakout to run', () => {
    for (const s of SYSTEMS) {
      const pb = SYSTEM_PLAYBOOK[s]
      expect(BREAKOUT_PLANS.reduce((t, p) => t + pb.breakout[p], 0), s).toBeGreaterThan(0)
    }
  })

  it('a system with its own tactics runs its own playbook, no overrides', () => {
    for (const s of SYSTEMS) {
      const pb = playbookFor(s, tacticsForSystem(s, BASE))
      expect(pb.system).toBe(s)
      expect(pb.forecheck, s).toBe(SYSTEM_PLAYBOOK[s].forecheck)
      expect(pb.dZone, s).toBe(SYSTEM_PLAYBOOK[s].dZone)
      expect(pb.breakout).toEqual(SYSTEM_PLAYBOOK[s].breakout)
      expect(pb.overrides).toEqual([])
    }
  })

  it('the systems differ where it shows: the trap and the shell sit back, the heavy forecheck goes two deep', () => {
    expect(playbookFor('lowEventTrap', tacticsForSystem('lowEventTrap', BASE)).forecheck).toBe('1-3-1')
    expect(playbookFor('defensiveShell', tacticsForSystem('defensiveShell', BASE)).forecheck).toBe('1-4')
    expect(playbookFor('defensiveShell', tacticsForSystem('defensiveShell', BASE)).dZone).toBe('collapse')
    expect(playbookFor('aggressiveForecheck', tacticsForSystem('aggressiveForecheck', BASE)).forecheck).toBe('2-1-2')
    expect(playbookFor('aggressiveForecheck', tacticsForSystem('aggressiveForecheck', BASE)).dZone).toBe('man')
    expect(playbookFor('speedTransition', tacticsForSystem('speedTransition', BASE)).regroup).toBe('stretch')
  })

  it("the GM's tactics override the coach where set", () => {
    // the forecheck: a trap coach whose GM asks for a 2-1-2
    const fc = playbookFor('lowEventTrap', { ...tacticsForSystem('lowEventTrap', BASE), forecheck: '2-1-2' })
    expect(fc.forecheck).toBe('2-1-2')
    expect(fc.overrides).toContain('forecheck')
    // man coverage over a zone system
    expect(playbookFor('structuredTwoWay', { ...BASE, dZoneCoverage: 'man' }).dZone).toBe('man')
    // the D-zone structure, breakout, regroup and entry only when the tactics carry them
    const set = playbookFor('speedTransition', { ...tacticsForSystem('speedTransition', BASE), dZoneStructure: 'collapse', breakout: 'reverse', nzOffensive: 'controlled', ozEntry: 'dump' })
    expect(set.dZone).toBe('collapse')
    expect(set.breakout.reverse).toBe(1)
    expect(set.breakout.stretch).toBe(0)
    expect(set.regroup).toBe('controlled')
    expect(set.entry).toBe('dump')
    expect([...set.overrides].sort()).toEqual(['breakout', 'dZone', 'entry', 'regroup'])
  })

  it('no coach system: read off the tactics alone', () => {
    const pb = playbookFor(undefined, { ...BASE, forecheck: 'trap' })
    expect(pb.system).toBeNull()
    expect(pb.forecheck).toBe('1-3-1')
    expect(pb.dZone).toBe('zone')
    expect(pb.overrides).toEqual([])
  })

  it("systemPlaybook reads a coach's profile", () => {
    for (let i = 0; i < 20; i++) {
      const p = buildCoachProfile({ id: `c${i}`, name: 'C', role: 'headCoach', rating: 40 + i * 2, judgment: 50, demeanor: 'calm' }, new Rng(i))
      const pb = systemPlaybook(p)
      expect(pb.system).toBe(p.system)
      expect(pb.pinch).toBeGreaterThanOrEqual(0)
      expect(pb.pinch).toBeLessThanOrEqual(1)
    }
  })
})
