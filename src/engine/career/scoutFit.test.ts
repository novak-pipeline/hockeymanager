/**
 * scoutFit.test.ts — squad-weighted scouting notes (playtest #17).
 *
 * The player-facing claims under test:
 *  - a position stacked with better/younger/signed players produces a FRICTION
 *    note ("he'd sit"), naming our own players and their contract horizon;
 *  - an open position produces a RUNWAY note (real minutes);
 *  - a blocked-today-but-expiring group produces a neutral "path opens" note;
 *  - a notable coach-system (mis)fit adds a second note;
 *  - everything is deterministic and speaks in roles/depth, never hidden numbers.
 */

import { describe, it, expect } from 'vitest'
import type { Player, TeamTactics } from '@domain'
import { buildSquadFitNotes } from './scoutFit'
import { reportProsCons } from './scoutReport'

const YEAR = 2026

function ratings(base: number) {
  return {
    technical: { wristShot: base, slapShot: base, stickhandling: base, passing: base, deflections: base, faceoffs: base },
    physical: { speed: base, acceleration: base, strength: base, balance: base, stamina: base, agility: base, height: base },
    mental: {
      offensiveIQ: base, defensiveIQ: base, positioning: base, vision: base, aggression: 10,
      composure: base, workRate: base, discipline: base, anticipation: base,
    },
    defensive: { checking: base, shotBlocking: base, stickChecking: base, takeaway: base },
  }
}

function composites(base: number, over: Partial<Record<string, number>> = {}) {
  return {
    scoring: base, playmaking: base, puckControl: base, faceoffWin: base,
    hitting: base, blocking: base, takeaway: base, penaltyProne: 30,
    goaltending: 0, skating: base, defensiveZone: base,
    offensiveIQ: base, defensiveIQ: base, vision: base, passing: base,
    ...over,
  }
}

function mk(opts: {
  id: string
  name?: string
  age?: number
  position?: 'C' | 'W' | 'D' | 'G'
  handedness?: 'L' | 'R'
  overall?: number
  expiryYear?: number
  comp?: Partial<Record<string, number>>
}): Player {
  const base = opts.overall ?? 70
  return {
    id: opts.id,
    name: opts.name ?? opts.id,
    age: opts.age ?? 25,
    position: opts.position ?? 'W',
    handedness: opts.handedness ?? 'L',
    role: 'Top-six forward',
    baseOverall: base,
    ratings: ratings(base),
    potential: ratings(base + 5),
    composites: composites(base, opts.comp),
    personality: { ambition: 12, professionalism: 10, loyalty: 10, temperament: 12, determination: 10 },
    contract: {
      salary: 3_000_000,
      yearsRemaining: Math.max(1, (opts.expiryYear ?? YEAR + 3) - YEAR),
      expiryYear: opts.expiryYear ?? YEAR + 3,
      noTradeClause: false,
      twoWay: false,
    },
    stats: [],
    fatigue: 0,
    morale: 70,
    injuryStatus: null,
    form: 0,
  } as unknown as Player
}

const FAST_TACTICS: TeamTactics = {
  forecheck: '1-2-2',
  dZoneCoverage: 'hybrid',
  tempo: { pace: 0.8, passRisk: 0.6, shotEagerness: 0.6, defensivePinch: 0.5 },
  specialTeams: { powerPlay: '1-3-1', penaltyKill: 'diamond' },
  lineMatching: false,
} as TeamTactics

/** A left-wing prospect with a 3.5★ scouted ceiling. */
const prospect = (comp: Partial<Record<string, number>> = {}): Player =>
  mk({ id: 'prospect', name: 'The Kid', age: 18, position: 'W', handedness: 'L', overall: 55, comp })

describe('buildSquadFitNotes — roster friction vs runway', () => {
  it('a stacked position (better, young, signed) produces a friction note that names the wall', () => {
    // Three 4★+ left wings (ovr ≥ 82 ⇒ 4.5★), age 24–26, signed 4 more years:
    // at or above the kid's 3.5★ ceiling ⇒ he'd sit.
    const wall = [
      mk({ id: 'lw1', name: 'Ada Wall', age: 24, overall: 86, expiryYear: YEAR + 4 }),
      mk({ id: 'lw2', name: 'Ben Wall', age: 25, overall: 84, expiryYear: YEAR + 5 }),
      mk({ id: 'lw3', name: 'Cyr Wall', age: 26, overall: 83, expiryYear: YEAR + 4 }),
    ]
    const notes = buildSquadFitNotes({
      prospect: prospect(), potentialStars: 3.5, userRoster: wall, currentYear: YEAR,
    })
    expect(notes.length).toBeGreaterThan(0)
    const depthNote = notes[0]!
    expect(depthNote.tone).toBe('minus')
    expect(depthNote.text).toContain("He'd sit")
    expect(depthNote.text).toContain('Ada Wall')
    expect(depthNote.text).toContain('signed through')
    // Contract horizon = the earliest year the wall cracks, a real year.
    expect(depthNote.text).toMatch(/20\d\d/)
  })

  it('an open position produces a runway note in role words', () => {
    // Roster has no left wings at all.
    const roster = [mk({ id: 'c1', position: 'C', overall: 80 })]
    const notes = buildSquadFitNotes({
      prospect: prospect(), potentialStars: 3.5, userRoster: roster, currentYear: YEAR,
    })
    expect(notes[0]!.tone).toBe('plus')
    expect(notes[0]!.text).toContain('real minutes')
    expect(notes[0]!.text).toContain('top-six')
  })

  it('blocked today but not walled off → a neutral note pointing at the expiring deal', () => {
    // Three LWs currently ahead of a modest 2.5★ ceiling, but old/expiring —
    // not "blockers" (a wall needs young + signed), so it reads as a wait.
    const roster = [
      mk({ id: 'lw1', name: 'Old Guard', age: 33, overall: 78, expiryYear: YEAR + 1 }),
      mk({ id: 'lw2', name: 'Mid Vet', age: 31, overall: 72, expiryYear: YEAR + 2 }),
      mk({ id: 'lw3', name: 'Third Liner', age: 30, overall: 68, expiryYear: YEAR + 2 }),
    ]
    const notes = buildSquadFitNotes({
      prospect: prospect(), potentialStars: 2.5, userRoster: roster, currentYear: YEAR,
    })
    expect(notes[0]!.tone).toBe('note')
    expect(notes[0]!.text).toContain('path opens')
    expect(notes[0]!.text).toContain('Old Guard')
  })

  it('never leaks hidden numbers — notes carry no star values or ratings', () => {
    const roster = [mk({ id: 'lw1', name: 'Big Star', overall: 85, age: 24, expiryYear: YEAR + 4 })]
    const notes = buildSquadFitNotes({
      prospect: prospect(), potentialStars: 3.5, userRoster: roster, currentYear: YEAR,
      tactics: FAST_TACTICS,
    })
    for (const n of notes) {
      // The only digits allowed are contract years (20xx).
      const digits = n.text.match(/\d+/g) ?? []
      for (const d of digits) expect(d).toMatch(/^20\d\d$/)
    }
  })

  it('is deterministic', () => {
    const roster = [
      mk({ id: 'lw1', name: 'Ada Wall', age: 24, overall: 86, expiryYear: YEAR + 4 }),
      mk({ id: 'lw2', name: 'Ben Wall', age: 25, overall: 84, expiryYear: YEAR + 5 }),
      mk({ id: 'lw3', name: 'Cyr Wall', age: 26, overall: 83, expiryYear: YEAR + 4 }),
    ]
    const args = { prospect: prospect(), potentialStars: 3.5, userRoster: roster, currentYear: YEAR, tactics: FAST_TACTICS }
    expect(buildSquadFitNotes(args)).toEqual(buildSquadFitNotes(args))
  })
})

describe('buildSquadFitNotes — coach-system fit', () => {
  it('a skilled, fast prospect earns a system-fit plus under an up-tempo coach', () => {
    // High skating + scoring ⇒ sniper/playmaker archetype ⇒ thrives at pace 0.8.
    const kid = prospect({ skating: 85, scoring: 85, playmaking: 80 })
    const notes = buildSquadFitNotes({
      prospect: kid, potentialStars: 3.5, userRoster: [], currentYear: YEAR, tactics: FAST_TACTICS,
    })
    const system = notes.find((n) => n.text.startsWith('Made for how we play'))
    expect(system).toBeTruthy()
    expect(system!.tone).toBe('plus')
    // The lead-in must not stutter the style name the reason already carries.
    expect(system!.text.toLowerCase().match(/speed & skill/g)?.length).toBe(1)
  })

  it('goalies never get a skater system-fit note', () => {
    const g = mk({ id: 'g1', position: 'G', age: 18, overall: 55 })
    const notes = buildSquadFitNotes({
      prospect: g, potentialStars: 3.5, userRoster: [], currentYear: YEAR, tactics: FAST_TACTICS,
    })
    // Only the depth note — playerStyleFit returns null for goalies.
    expect(notes.length).toBe(1)
  })
})

describe('reportProsCons — the WHY behind the letter grade', () => {
  it('a skilled-but-soft-defensively player gets scoring pros and a defensive con at full knowledge', () => {
    const p = mk({
      id: 'skilled', overall: 70,
      comp: { scoring: 80, skating: 78, defensiveZone: 30 },
    })
    const { pros, cons } = reportProsCons(p, 100)
    expect(pros.length).toBeGreaterThan(0)
    expect(pros.length).toBeLessThanOrEqual(3)
    expect(cons.length).toBeGreaterThan(0)
    expect(cons.length).toBeLessThanOrEqual(2)
  })

  it('low knowledge hides the sharp negative reads (fog-aware)', () => {
    const p = mk({
      id: 'foggy', overall: 55,
      comp: { scoring: 55, skating: 55, defensiveZone: 30 },
    })
    // The defensive-zone con needs high knowledge; at 20 it must not appear.
    const { cons } = reportProsCons(p, 20)
    expect(cons.length).toBe(0)
  })

  it('per-scout seed varies the voice deterministically, not the verdict', () => {
    const p = mk({ id: 'voiced', overall: 75, comp: { skating: 80, scoring: 80 } })
    const a1 = reportProsCons(p, 100, 'scout-a')
    const a2 = reportProsCons(p, 100, 'scout-a')
    const b = reportProsCons(p, 100, 'scout-b')
    expect(a1).toEqual(a2) // deterministic per scout
    expect(b.pros.length).toBe(a1.pros.length) // same observations…
    expect(b.cons.length).toBe(a1.cons.length) // …possibly different phrasing
  })
})
