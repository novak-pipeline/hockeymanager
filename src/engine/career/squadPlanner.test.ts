/**
 * squadPlanner.test.ts — the Depth Report shows its work (playtest #16).
 *
 * "Verdict: Thin" alone was unexplained. The verdict now carries its inputs —
 * how many NHL-calibre bodies you have at the position, who anchors it, and the
 * league median — and a plain-English detail line derived from them.
 */

import { describe, it, expect } from 'vitest'
import type { Player } from '@domain'
import { buildSquadPlanner } from './squadPlanner'

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

function composites(base: number) {
  return {
    scoring: base, playmaking: base, puckControl: base, faceoffWin: base,
    hitting: base, blocking: base, takeaway: base, penaltyProne: 30,
    goaltending: 0, skating: base, defensiveZone: base,
    offensiveIQ: base, defensiveIQ: base, vision: base, passing: base,
  }
}

function mk(id: string, opts: {
  name?: string
  position?: 'C' | 'W' | 'D' | 'G'
  handedness?: 'L' | 'R'
  overall?: number
  age?: number
}): Player {
  const base = opts.overall ?? 70
  return {
    id,
    name: opts.name ?? id,
    age: opts.age ?? 25,
    position: opts.position ?? 'C',
    handedness: opts.handedness ?? 'R',
    role: 'Top-six forward',
    baseOverall: base,
    ratings: ratings(base),
    potential: ratings(base),
    composites: composites(base),
    personality: { ambition: 12, professionalism: 10, loyalty: 10, temperament: 12, determination: 10 },
    contract: { salary: 1_000_000, yearsRemaining: 2, expiryYear: 2028, noTradeClause: false, twoWay: false },
    stats: [],
    fatigue: 0,
    morale: 70,
    injuryStatus: null,
    form: 0,
  } as unknown as Player
}

/** A full-ish roster with exactly `calibreCs` centers above the NHL bar. */
function rosterWith(tag: string, calibreCs: number): Player[] {
  const roster: Player[] = []
  for (let i = 0; i < 4; i++) {
    roster.push(mk(`${tag}-c${i}`, {
      name: `${tag} Center${i}`, position: 'C',
      overall: i < calibreCs ? 72 : 48, // 72 clears the 60 bar; 48 does not
    }))
  }
  // Round out other groups so the planner has bodies everywhere.
  for (let i = 0; i < 3; i++) {
    roster.push(mk(`${tag}-lw${i}`, { name: `${tag} LW${i}`, position: 'W', handedness: 'L', overall: 65 }))
    roster.push(mk(`${tag}-rw${i}`, { name: `${tag} RW${i}`, position: 'W', handedness: 'R', overall: 65 }))
    roster.push(mk(`${tag}-ld${i}`, { name: `${tag} LD${i}`, position: 'D', handedness: 'L', overall: 65 }))
    roster.push(mk(`${tag}-rd${i}`, { name: `${tag} RD${i}`, position: 'D', handedness: 'R', overall: 65 }))
  }
  roster.push(mk(`${tag}-g0`, { name: `${tag} Goalie0`, position: 'G', overall: 65 }))
  roster.push(mk(`${tag}-g1`, { name: `${tag} Goalie1`, position: 'G', overall: 62 }))
  return roster
}

describe('Depth Report shows its work (#16)', () => {
  it('a weak group carries its inputs: calibre count, league median, anchor name, detail', () => {
    // My club: 1 NHL-calibre center. Seven rivals: 4 calibre centers each.
    const mine = rosterWith('My', 1)
    const rivals = Array.from({ length: 7 }, (_, i) => rosterWith(`R${i}`, 4))
    const view = buildSquadPlanner({ teamName: 'Mine', roster: mine, leagueRosters: [mine, ...rivals] })

    const c = view.depth.find((d) => d.group === 'C')!
    // Dead last at center → a bad verdict, with the derivation attached.
    expect(['Thin', 'Critical']).toContain(c.verdict)
    expect(c.nhlCalibre).toBe(1)
    expect(c.leagueMedian).toBe(4)
    expect(c.topName).toBe('My Center0')
    expect(c.detail).toBeTruthy()
    // The detail line names the anchor and the league standard — the WHY.
    expect(c.detail).toContain('My Center0')
    expect(c.detail).toContain('league median is 4')
  })

  it('a zero-calibre group says so in plain English', () => {
    const mine = rosterWith('My', 0)
    const rivals = Array.from({ length: 7 }, (_, i) => rosterWith(`R${i}`, 3))
    const view = buildSquadPlanner({ teamName: 'Mine', roster: mine, leagueRosters: [mine, ...rivals] })
    const c = view.depth.find((d) => d.group === 'C')!
    expect(c.nhlCalibre).toBe(0)
    expect(c.detail).toMatch(/^No NHL-calibre/)
  })

  it('without league context the detail still derives from the headcount target', () => {
    const mine = rosterWith('My', 2)
    const view = buildSquadPlanner({ teamName: 'Mine', roster: mine })
    const c = view.depth.find((d) => d.group === 'C')!
    expect(c.nhlCalibre).toBe(2)
    expect(c.leagueMedian).toBeUndefined()
    expect(c.detail).toContain('2 NHL-calibre')
    expect(c.detail).toContain('target')
  })

  it('the strong side of the ledger explains itself too', () => {
    // My club is the stacked one: 4 calibre centers vs rivals' 1.
    const mine = rosterWith('My', 4)
    const rivals = Array.from({ length: 7 }, (_, i) => rosterWith(`R${i}`, 1))
    const view = buildSquadPlanner({ teamName: 'Mine', roster: mine, leagueRosters: [mine, ...rivals] })
    const c = view.depth.find((d) => d.group === 'C')!
    expect(c.verdict).toBe('Strong')
    expect(c.nhlCalibre).toBe(4)
    expect(c.detail).toContain('4 NHL-calibre')
  })
})
