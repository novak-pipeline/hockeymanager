/**
 * coachTactics.test.ts — staff-meeting suggestion evaluation.
 */
import { describe, it, expect } from 'vitest'
import type { Player, Position, RawAttributes, TeamTactics } from '@domain'
import { computeComposites } from '@engine/ratings/composites'
import type { StaffMember } from './staff'
import { COACH_SUGGESTIONS, evaluateCoachSuggestion } from './coachTactics'
import { buildCoachProfile } from './coachProfile'

function raw(v: number): RawAttributes {
  return {
    technical: { wristShot: v, slapShot: v, stickhandling: v, passing: v, deflections: v, faceoffs: v },
    physical: { speed: v, acceleration: v, strength: v, balance: v, stamina: v, agility: v, height: 50 },
    mental: { offensiveIQ: v, defensiveIQ: v, positioning: v, vision: v, aggression: v, composure: v, workRate: v, discipline: v, anticipation: v },
    defensive: { checking: v, shotBlocking: v, stickChecking: v, takeaway: v },
  }
}

let _id = 1
function player(position: Position, v: number): Player {
  const r = raw(v)
  return {
    id: `cp${_id++}` as unknown as Player['id'],
    name: `Player ${_id}`,
    age: 25, position, handedness: 'L', role: 'twoWay',
    ratings: r, potential: r, composites: computeComposites(r, 'twoWay', position),
    personality: { ambition: 10, professionalism: 10, loyalty: 10, temperament: 10, determination: 10 },
    contract: { salary: 1, yearsRemaining: 2, expiryYear: 2030, noTradeClause: false, twoWay: false },
    stats: [], fatigue: 0, morale: 60, injuryStatus: null, form: 0,
  } as unknown as Player
}

function roster(v: number): Player[] {
  return [
    player('C', v), player('W', v), player('W', v),
    player('C', v), player('W', v), player('W', v),
    player('D', v), player('D', v), player('D', v), player('D', v),
    player('G', v),
  ]
}

function coach(demeanor: string, rating = 65): StaffMember {
  return { id: 's1', name: 'Dan Muse', role: 'headCoach', rating, judgment: 70, demeanor } as StaffMember
}

const tactics: TeamTactics = {
  forecheck: '2-1-2', dZoneCoverage: 'zone',
  tempo: { pace: 0.5, passRisk: 0.4, shotEagerness: 0.5, defensivePinch: 0.4 },
  specialTeams: { powerPlay: 'umbrella', penaltyKill: 'box' },
  lineMatching: false,
}

describe('evaluateCoachSuggestion', () => {
  const r = roster(60)

  it('an open (analytical) coach adopts a play-to-strengths suggestion', () => {
    const res = evaluateCoachSuggestion({ coach: coach('analytical'), roster: r, tactics, direction: 'fitRoster' })
    expect(res.accepted).toBe(true)
    expect(res.newTactics).toBeDefined()
    expect(res.response.length).toBeGreaterThan(0)
  })

  it('accepted ⇒ newTactics present; declined ⇒ absent (all directions)', () => {
    for (const s of COACH_SUGGESTIONS) {
      const res = evaluateCoachSuggestion({ coach: coach('fiery'), roster: r, tactics, direction: s.id })
      if (res.accepted) expect(res.newTactics).toBeDefined()
      else expect(res.newTactics).toBeUndefined()
    }
  })

  it('an open coach is never less receptive than a stubborn one', () => {
    for (const s of COACH_SUGGESTIONS) {
      const open = evaluateCoachSuggestion({ coach: coach('analytical'), roster: r, tactics, direction: s.id })
      const stubborn = evaluateCoachSuggestion({ coach: coach('fiery'), roster: r, tactics, direction: s.id })
      // Not allowed: stubborn accepts while open rejects.
      expect(!(stubborn.accepted && !open.accepted)).toBe(true)
    }
  })

  it('a high-knowledge coach is never more accepting than a low-knowledge one', () => {
    // Same demeanor/rating; only tactical knowledge differs (via profile).
    const base = coach('analytical')
    const high = { ...base, profile: buildCoachProfile({ ...base, attributes: { tactics: 20 } }) }
    const low = { ...base, profile: buildCoachProfile({ ...base, attributes: { tactics: 1 } }) }
    for (const s of COACH_SUGGESTIONS) {
      const h = evaluateCoachSuggestion({ coach: high, roster: r, tactics, direction: s.id })
      const l = evaluateCoachSuggestion({ coach: low, roster: r, tactics, direction: s.id })
      // A skilled tactician trusting his read must never accept where a novice declines.
      expect(!(h.accepted && !l.accepted)).toBe(true)
    }
  })

  it('is deterministic', () => {
    const a = evaluateCoachSuggestion({ coach: coach('calm'), roster: r, tactics, direction: 'faster' })
    const b = evaluateCoachSuggestion({ coach: coach('calm'), roster: r, tactics, direction: 'faster' })
    expect(a).toEqual(b)
  })
})
