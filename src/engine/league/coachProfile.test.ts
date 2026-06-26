import { describe, expect, it } from 'vitest'
import { Rng } from '@engine/shared/rng'
import type { StaffMember } from './staff'
import {
  buildCoachProfile,
  deriveProfileFromAttributes,
  deriveSyntheticProfile,
  deriveSystem,
  SYSTEM_META,
  SYSTEM_TO_STYLE_KIND,
  type CoachProfile,
  type CoachSystemId,
} from './coachProfile'

function coach(over: Partial<StaffMember> = {}): StaffMember {
  return {
    id: 'coach-1',
    name: 'Test Coach',
    role: 'headCoach',
    rating: 70,
    judgment: 60,
    demeanor: 'calm',
    ...over,
  }
}

const ALL_AXES: (keyof CoachProfile)[] = [
  'aggression', 'tempo', 'offence', 'structure', 'forecheckDepth',
  'riskTolerance', 'ppCompetence', 'pkCompetence', 'tacticsKnowledge',
]

function axesInRange(p: CoachProfile): void {
  for (const k of ALL_AXES) {
    const v = p[k] as number
    expect(v, `${k}`).toBeGreaterThanOrEqual(0)
    expect(v, `${k}`).toBeLessThanOrEqual(1)
  }
}

describe('coachProfile — derivation', () => {
  it('synthesises a valid profile for a coach with no attributes', () => {
    const p = buildCoachProfile(coach())
    axesInRange(p)
    expect(SYSTEM_META[p.system].id).toBe(p.system)
    expect(p.philosophy.length).toBeGreaterThan(0)
    expect(p.meta).toBe(SYSTEM_META[p.system])
  })

  it('derives from EHM attributes when present (attack-minded → attacking profile)', () => {
    const attacky = buildCoachProfile(coach({
      attributes: { attacking: 19, directness: 16, freeRoles: 16, physical: 8, tactics: 16, powerplay: 18 },
    }))
    const defensive = buildCoachProfile(coach({
      id: 'coach-2',
      attributes: { attacking: 3, directness: 4, freeRoles: 4, physical: 10, tactics: 14, penaltyKill: 18 },
    }))
    axesInRange(attacky)
    axesInRange(defensive)
    expect(attacky.offence).toBeGreaterThan(defensive.offence)
    expect(attacky.tempo).toBeGreaterThan(defensive.tempo)
    // structure is the inverse of freeRoles: the high-freeRoles coach is less structured
    expect(attacky.structure).toBeLessThan(defensive.structure)
  })

  it('uses the attribute path only when a tactical attribute is present', () => {
    const fromAttr = buildCoachProfile(coach({ attributes: { attacking: 18 } }))
    const synthetic = buildCoachProfile(coach({ attributes: { physiotherapy: 12 } }))
    // physiotherapy is not a tactical tendency → synthetic path (neutral-ish)
    expect(fromAttr.offence).toBeGreaterThan(0.7)
    expect(synthetic.offence).toBeLessThan(0.7)
  })

  it('is deterministic — same coach yields the same profile', () => {
    const a = buildCoachProfile(coach({ id: 'abc' }), new Rng(1))
    const b = buildCoachProfile(coach({ id: 'abc' }), new Rng(999))
    expect(a).toEqual(b)
  })

  it('synthetic profiles diverge by id (stable jitter)', () => {
    const a = deriveSyntheticProfile(coach({ id: 'alpha' }))
    const b = deriveSyntheticProfile(coach({ id: 'omega' }))
    // Different ids should not produce identical axis vectors.
    const same = ALL_AXES.every((k) => a[k] === b[k])
    expect(same).toBe(false)
  })

  it('survives a JSON round-trip', () => {
    const p = buildCoachProfile(coach({ attributes: { attacking: 12, tactics: 15 } }))
    expect(JSON.parse(JSON.stringify(p))).toEqual(p)
  })
})

describe('coachProfile — deriveSystem', () => {
  const base = {
    aggression: 0.5, tempo: 0.5, offence: 0.5, structure: 0.5,
    forecheckDepth: 0.5, riskTolerance: 0.5,
  }
  const cases: Array<[string, Partial<typeof base>, CoachSystemId]> = [
    ['low-event trap', { tempo: 0.2, offence: 0.3, structure: 0.7 }, 'lowEventTrap'],
    ['run-and-gun', { offence: 0.85, riskTolerance: 0.8, tempo: 0.8 }, 'runAndGun'],
    ['speed transition', { tempo: 0.75, riskTolerance: 0.7 }, 'speedTransition'],
    ['aggressive forecheck', { aggression: 0.8, forecheckDepth: 0.8 }, 'aggressiveForecheck'],
    ['cycle possession', { offence: 0.65, tempo: 0.45, structure: 0.6 }, 'cyclePossession'],
    ['defensive shell', { offence: 0.2, structure: 0.75 }, 'defensiveShell'],
    ['structured two-way (default)', {}, 'structuredTwoWay'],
  ]
  for (const [name, over, expected] of cases) {
    it(`reaches ${name}`, () => {
      expect(deriveSystem({ ...base, ...over })).toBe(expected)
    })
  }

  it('every system maps to a style kind and has metadata', () => {
    for (const id of Object.keys(SYSTEM_META) as CoachSystemId[]) {
      expect(SYSTEM_TO_STYLE_KIND[id]).toBeTruthy()
      expect(SYSTEM_META[id].label.length).toBeGreaterThan(0)
    }
  })
})

describe('coachProfile — attribute derivation edge cases', () => {
  it('falls back to rating for tacticsKnowledge when tactics attr absent', () => {
    const hi = deriveProfileFromAttributes(coach({ rating: 90, attributes: { attacking: 10 } }))
    const lo = deriveProfileFromAttributes(coach({ id: 'c2', rating: 45, attributes: { attacking: 10 } }))
    expect(hi.tacticsKnowledge).toBeGreaterThan(lo.tacticsKnowledge)
  })
})
