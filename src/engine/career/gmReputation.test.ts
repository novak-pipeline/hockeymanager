/**
 * GM reputation — the anti-cheese laws, pinned: free up to the line, a warning
 * AT the line (no cost), a cost only past it; a pattern across clubs travels;
 * the standing heals; the floor is a floor.
 */
import { describe, expect, it } from 'vitest'
import {
  FREE_PER_WEEK,
  adjustStanding,
  createGmReputation,
  driftStanding,
  recordContact,
  standingTilt,
} from './gmReputation'

describe('recordContact', () => {
  it('is free up to the line, warns once at it, and costs only past it', () => {
    const s = createGmReputation()
    const verdicts = Array.from({ length: FREE_PER_WEEK.offer + 2 }, () =>
      recordContact(s, { teamId: 'A', kind: 'offer', year: 2026, day: 10 }).kind)
    expect(verdicts.slice(0, FREE_PER_WEEK.offer - 1).every((v) => v === 'ok')).toBe(true)
    expect(verdicts[FREE_PER_WEEK.offer - 1]).toBe('warn')
    expect(verdicts.slice(FREE_PER_WEEK.offer)).toEqual(['strike', 'strike'])
  })

  it('the week rolls: the same volume a week later is free again', () => {
    const s = createGmReputation()
    for (let i = 0; i < FREE_PER_WEEK.gauge; i++) recordContact(s, { teamId: 'A', kind: 'gauge', year: 2026, day: 10 })
    expect(recordContact(s, { teamId: 'A', kind: 'gauge', year: 2026, day: 18 }).kind).toBe('ok')
  })

  it('calls spread across clubs are normal work, never a cost', () => {
    const s = createGmReputation()
    for (const t of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
      for (let i = 0; i < FREE_PER_WEEK.offer - 1; i++) {
        expect(recordContact(s, { teamId: t, kind: 'offer', year: 2026, day: 20 }).kind).toBe('ok')
      }
    }
    expect(s.standing).toBe(50)
  })

  it('a pattern across three clubs travels league-wide, once a month', () => {
    const s = createGmReputation()
    const spam = (t: string): string[] =>
      Array.from({ length: FREE_PER_WEEK.gauge + 1 }, () => recordContact(s, { teamId: t, kind: 'gauge', year: 2026, day: 30 }))
        .map((v) => (v.kind === 'strike' && v.wordGetsAround ? 'word' : v.kind))
    spam('A'); spam('B')
    expect(s.standing).toBe(50)
    expect(spam('C')).toContain('word')
    expect(s.standing).toBeLessThan(50)
    const after = s.standing
    spam('D')
    expect(s.standing).toBe(after)
  })
})

describe('standing', () => {
  it('heals toward neutral each week and never leaves [10, 90]', () => {
    const s = createGmReputation()
    adjustStanding(s, -100, 2026, 1, 'test')
    expect(s.standing).toBe(10)
    driftStanding(s, 2026, 1)
    driftStanding(s, 2026, 1 + 7 * 5)
    expect(s.standing).toBe(15)
    adjustStanding(s, 200, 2026, 40, 'test')
    expect(s.standing).toBe(90)
  })

  it('the tilt is small and symmetric', () => {
    expect(standingTilt(50)).toBe(0)
    expect(standingTilt(90)).toBe(8)
    expect(standingTilt(10)).toBe(-8)
  })
})

/* ───────────────────────── career wiring ───────────────────────── */

import { generateLeague } from '@data/generate'
import { Career } from './career'

describe('GM reputation in the career', () => {
  function setup(): { c: Career; partner: string; proposal: Parameters<Career['gaugeTradeInterest']>[0] } {
    const data = generateLeague({ seed: 5 })
    const c = new Career(data, 5, data.league.teams[0]!)
    for (let i = 0; i < 200 && c.getDashboard().phase === 'regularSeason' && c.getDashboard().day === 0; i++) {
      if (c.getDashboard().captainsPending) c.nameCaptainByCoach()
      c.step()
    }
    const partner = data.league.teams[1]! as string
    const mine = data.teams.get(data.league.teams[0]!)!.roster
    const theirs = data.teams.get(data.league.teams[1]!)!.roster
    return { c, partner, proposal: { partnerTeamId: partner, givePlayerIds: [mine[5] as string], givePickIds: [], receivePlayerIds: [theirs[5] as string], receivePickIds: [] } }
  }

  it('telegraphs in the builder, warns at the line, and only then goes vague and costs goodwill', () => {
    const { c, partner, proposal } = setup()
    const rel = (): number => c.getGMRelationships().rows.length >= 0 ? (c as unknown as { relationshipWith(t: string): number }).relationshipWith(partner) : 0
    const before = rel()
    const lines: string[] = []
    for (let i = 0; i < FREE_PER_WEEK.gauge; i++) lines.push(c.gaugeTradeInterest(proposal).line)
    // The builder says so before anything costs.
    expect(c.evaluateTradeDraft(proposal).callsNear).toBe(true)
    expect(rel()).toBe(before)
    expect(lines[FREE_PER_WEEK.gauge - 1]).toMatch(/a few calls this week/)
    expect(c.getInbox().items.some((n) => /noticed the phone ringing/.test(n.headline))).toBe(true)
    // Past the line: a stock answer, and a point of goodwill.
    const past = c.gaugeTradeInterest(proposal)
    expect(past.line).toMatch(/Put a real offer on the table/)
    expect(rel()).toBe(before - 1)
    // Never a lockout: a formal offer is still answered.
    expect(() => c.proposeTrade(proposal)).not.toThrow()
  })

  it('reads spread across the league cost nothing', () => {
    const { c, proposal } = setup()
    const data = (c as unknown as { data: { league: { teams: string[] } } }).data
    for (const t of data.league.teams.slice(1, 12)) {
      c.gaugeTradeInterest({ ...proposal, partnerTeamId: t })
      c.gaugeTradeInterest({ ...proposal, partnerTeamId: t })
    }
    const rep = c.getGMRelationships().reputation!
    expect(rep.strikes30).toBe(0)
    expect(rep.standing).toBe(50)
  })
})
