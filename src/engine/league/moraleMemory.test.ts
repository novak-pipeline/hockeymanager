/**
 * Morale memory (story audit 2026-10 F1): the big things a player remembers
 * move the level his morale settles at, fade slowly, show on his profile in
 * words, heal faster when the cause is fixed, and never push him into
 * trade-request territory on their own.
 */
import { describe, expect, it } from 'vitest'
import type { Lines, Personality, Player, PlayerId, Position, RawAttributes, Team, TeamColors } from '@domain'
import { asPlayerId, asTeamId } from '@domain'
import { computeComposites } from '@engine/ratings/composites'
import { Rng } from '@engine/shared/rng'
import { applyDeploymentMorale, tickRecovery } from './condition'
import {
  MEMORY_BASELINE_MIN,
  MEMORY_NOTES,
  easeMoraleMemory,
  moodFactorsView,
  moraleBaseline,
  rememberMorale,
} from './moraleMemory'

let nextId = 1
function rawAttrs(val: number): RawAttributes {
  return {
    technical: { wristShot: val, slapShot: val, stickhandling: val, passing: val, deflections: val, faceoffs: val },
    physical: { speed: val, acceleration: val, strength: val, balance: val, stamina: val, agility: val, height: val },
    mental: {
      offensiveIQ: val, defensiveIQ: val, positioning: val, vision: val, aggression: val,
      composure: val, workRate: val, discipline: val, anticipation: val,
    },
    defensive: { checking: val, shotBlocking: val, stickChecking: val, takeaway: val },
  }
}
const personality = (ambition: number): Personality => ({
  ambition, professionalism: 10, loyalty: 10, temperament: 10, determination: 10,
})
function makeSkater(position: Position, attr: number, ambition = 10): Player {
  const id = asPlayerId(`m${nextId++}`)
  const ratings = rawAttrs(attr)
  return {
    id, name: `Player ${id as string}`, age: 25, position, handedness: 'L', role: 'twoWay',
    ratings, potential: ratings, composites: computeComposites(ratings, 'twoWay', position),
    personality: personality(ambition),
    contract: { salary: 1e6, yearsRemaining: 2, expiryYear: 2026, noTradeClause: false, twoWay: false },
    stats: [], fatigue: 0, morale: 60, injuryStatus: null, form: 0,
  }
}

const AT = { year: 2026, day: 40, date: '2026-11-09' }
/** The GM's own call (scratch toggle / GM-run lines). */
const GM = { ...AT, scratchedByGm: (): boolean => true, linesByGm: true }
/** The coach's lineup on the user's club: stings, but nothing is remembered. */
const COACH = { ...AT, scratchedByGm: (): boolean => false, linesByGm: false }

/** Simulate `days` match days of nothing happening (nobody plays). */
function idle(p: Player, days: number, seed = 1): void {
  const rng = new Rng(seed)
  for (let d = 0; d < days; d++) tickRecovery({ players: [p], playedToday: new Set(), rng })
}

describe('morale memory', () => {
  it('a broken promise is still felt two months later (without it, morale is back to normal in a month)', () => {
    const forgetful = makeSkater('C', 70)
    const remembers = makeSkater('C', 70)
    forgetful.morale = remembers.morale = 46 // the same shock to both
    rememberMorale(remembers, { kind: 'brokenPromise', ...AT, note: MEMORY_NOTES.brokenPromise('more minutes') })
    idle(forgetful, 60)
    idle(remembers, 60)
    // Before: the scalar drift erased the shock.
    expect(forgetful.morale).toBeGreaterThan(59)
    // After: he still sits clearly below neutral 60 days on.
    expect(remembers.morale).toBeLessThan(55)
    expect(remembers.moraleMemory?.[0]?.kind).toBe('brokenPromise')
  })

  it('everything fades: a season later the memory is gone and morale is neutral', () => {
    const p = makeSkater('C', 70)
    rememberMorale(p, { kind: 'brokenPromise', ...AT, note: MEMORY_NOTES.brokenPromise('more minutes') })
    idle(p, 600)
    expect(p.moraleMemory).toBeUndefined()
    expect(p.morale).toBeGreaterThan(59)
  })

  it('never a lockout: piled-up grievances settle above the trade-request bar', () => {
    const p = makeSkater('C', 70)
    for (const kind of ['brokenPromise', 'contractSnub', 'tradeRequestIgnored', 'grievance', 'scratched'] as const) {
      for (let i = 0; i < 4; i++) rememberMorale(p, { kind, ...AT, note: MEMORY_NOTES.contractSnub })
    }
    expect(moraleBaseline(p)).toBe(MEMORY_BASELINE_MIN)
    p.morale = 40
    idle(p, 40)
    expect(p.morale).toBeGreaterThan(24 + 15)
  })

  it('a repeat compounds and the note counts it, dated from when it started', () => {
    const p = makeSkater('C', 70)
    rememberMorale(p, { kind: 'scratched', ...AT, note: MEMORY_NOTES.scratched })
    rememberMorale(p, { kind: 'scratched', year: 2026, day: 44, date: '2026-11-13', note: MEMORY_NOTES.scratched })
    rememberMorale(p, { kind: 'scratched', year: 2026, day: 47, date: '2026-11-16', note: MEMORY_NOTES.scratched })
    expect(p.moraleMemory).toHaveLength(1)
    expect(p.moraleMemory![0]!.count).toBe(3)
    expect(p.moraleMemory![0]!.note).toBe('Healthy-scratched three times since Nov 9')
    expect(p.moraleMemory![0]!.weight).toBeGreaterThanOrEqual(-10)
  })

  it('fixing the cause heals faster than time alone', () => {
    const waited = makeSkater('C', 70)
    const fixed = makeSkater('C', 70)
    for (const p of [waited, fixed]) rememberMorale(p, { kind: 'scratched', ...AT, note: MEMORY_NOTES.scratched })
    for (let g = 0; g < 5; g++) easeMoraleMemory(fixed, ['scratched'], 0.85)
    idle(waited, 5)
    idle(fixed, 5)
    expect(Math.abs(fixed.moraleMemory?.[0]?.weight ?? 0)).toBeLessThan(Math.abs(waited.moraleMemory![0]!.weight) * 0.6)
  })

  it('the profile view speaks in words, never numbers beyond the date', () => {
    const p = makeSkater('C', 70)
    rememberMorale(p, { kind: 'brokenPromise', ...AT, note: MEMORY_NOTES.brokenPromise('a top-six role') })
    rememberMorale(p, { kind: 'newDeal', ...AT, note: MEMORY_NOTES.newDeal })
    const v = moodFactorsView(p)
    expect(v.map((f) => f.kind)).toEqual(['brokenPromise', 'newDeal'])
    expect(v[0]!.tone).toBe('negative')
    expect(v[0]!.strength).toBe('Still raw')
    expect(v[1]!.strength).toBe('Still glowing')
    for (const f of v) {
      // Only the day of the month may be a number.
      expect(f.note.replace(/Nov 9/g, '')).not.toMatch(/\d/)
      expect(f.note).not.toMatch(/\{|undefined/)
    }
    idle(p, 200)
    expect(moodFactorsView(p).find((f) => f.kind === 'brokenPromise')?.strength).toBe('Fading')
  })
})

/* ── deployment: a benched star remembers; AI clubs and normal lineups write nothing ── */

const teamColors: TeamColors = { primary: 0x003087, secondary: 0xffffff }
function setupTeam() {
  nextId = 100
  const star = makeSkater('C', 85, 14)
  const forwards = [star, ...Array.from({ length: 11 }, (_, i) => makeSkater('W', 62 - i * 2))]
  const defense = Array.from({ length: 6 }, (_, i) => makeSkater('D', 60 - i * 2))
  const players = new Map<PlayerId, Player>()
  for (const p of [...forwards, ...defense]) players.set(p.id, p)
  const others = forwards.slice(1)
  const mkTeam = (fwdLines: PlayerId[][]): Team => ({
    id: asTeamId('TT'), name: 'Test', abbreviation: 'TT', city: 'Test', colors: teamColors,
    conferenceId: 'E', divisionId: 'A',
    roster: [...players.keys()],
    lines: {
      forwards: fwdLines as Lines['forwards'],
      defensePairs: [
        [defense[0]!.id, defense[1]!.id], [defense[2]!.id, defense[3]!.id], [defense[4]!.id, defense[5]!.id],
      ] as Lines['defensePairs'],
      goalies: [asPlayerId(''), asPlayerId('')] as Lines['goalies'],
      powerPlayUnits: [], penaltyKillUnits: [],
    },
    tactics: { forecheck: 'aggressive', breakout: 'controlled', powerPlay: 'overload', penaltyKill: 'passive', lineMatching: false } as unknown as Team['tactics'],
    finances: { budget: 1e7, salaryCap: 8e7, capUsed: 0, revenue: 0 },
    staff: { headCoachId: null, assistantCoachIds: [], scoutIds: [] },
  })
  return { star, others, players, mkTeam }
}

describe('deployment memory', () => {
  it('a GM-ordered scratch of the star is remembered; the coach scratching him (or an AI club) is not', () => {
    const { star, others, players, mkTeam } = setupTeam()
    const team = mkTeam([
      [others[0]!.id, others[1]!.id, others[2]!.id],
      [others[3]!.id, others[4]!.id, others[5]!.id],
      [others[6]!.id, others[7]!.id, others[8]!.id],
      [others[9]!.id, others[10]!.id, others[10]!.id],
    ])
    const played = (id: PlayerId): boolean => id !== star.id
    applyDeploymentMorale({ team, resolve: (id) => players.get(id)!, played })
    expect(star.moraleMemory).toBeUndefined() // AI club: no memory
    applyDeploymentMorale({ team, resolve: (id) => players.get(id)!, played, memory: COACH })
    expect(star.moraleMemory).toBeUndefined() // the coach's call: stings, not remembered
    expect(star.morale).toBeLessThan(60)
    applyDeploymentMorale({ team, resolve: (id) => players.get(id)!, played, memory: GM })
    expect(star.moraleMemory?.[0]?.kind).toBe('scratched')
    expect(star.moraleMemory?.[0]?.note).toBe('Healthy-scratched on Nov 9')
  })

  it('a normal lineup (everyone in his slot) writes nothing, and playing the star again forgives him', () => {
    const { star, others, players, mkTeam } = setupTeam()
    const right = mkTeam([
      [star.id, others[0]!.id, others[1]!.id],
      [others[2]!.id, others[3]!.id, others[4]!.id],
      [others[5]!.id, others[6]!.id, others[7]!.id],
      [others[8]!.id, others[9]!.id, others[10]!.id],
    ])
    for (let g = 0; g < 10; g++) {
      applyDeploymentMorale({ team: right, resolve: (id) => players.get(id)!, played: () => true, memory: GM })
    }
    for (const p of players.values()) expect(p.moraleMemory).toBeUndefined()

    rememberMorale(star, { kind: 'scratched', ...AT, note: MEMORY_NOTES.scratched })
    const before = star.moraleMemory![0]!.weight
    for (let g = 0; g < 3; g++) {
      applyDeploymentMorale({ team: right, resolve: (id) => players.get(id)!, played: () => true, memory: GM })
    }
    expect(Math.abs(star.moraleMemory![0]!.weight)).toBeLessThan(Math.abs(before) * 0.65)
  })
})
