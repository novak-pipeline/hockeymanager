/**
 * The feud arc in the career (story audit 2026-10 §4): a dated cause raises an
 * in-person scene from the head coach (no phone call), the answer does what it
 * says (the lines change, memories are written), and the arc plays out over
 * the following weeks into the chronicle. The old generic feud call is gone.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from './career'
import type { FeudCause } from '@engine/league/feudArc'

/* eslint-disable @typescript-eslint/no-explicit-any */
function makeCareer(seed: number): { career: Career; c: any } {
  const data = generateLeague({ seed })
  const career = new Career(data, seed, data.league.teams[0]!)
  return { career, c: career as any }
}

/** Two forwards on the user's first line, as a role-taken cause. */
function firstLinePair(c: any): { aId: string; bId: string; cause: FeudCause } {
  const l1 = c.userTeam.lines.forwards[0].map((id: unknown) => id as string)
  const aId = l1[0], bId = l1[1]
  return {
    aId, bId,
    cause: { kind: 'roleTaken', aId, bId, year: c.year, day: 3, date: '2025-10-03', slot: 'first line' },
  }
}

function raise(c: any, cause: FeudCause, day = 5): any {
  c.raiseFeud(cause, day)
  return c.interactions.find((i: any) => i.status === 'open' && i.kind === 'feud')
}

describe('feud scene', () => {
  it('is raised in person by the head coach and names the dated cause first', () => {
    const { career, c } = makeCareer(901)
    const { cause } = firstLinePair(c)
    const it0 = raise(c, cause)
    expect(it0).toBeTruthy()
    expect(it0.inPerson).toBe(true)
    expect(it0.message).toMatch(/^On Oct 3 .+ took .+'s place on the first line\./)
    const coach = c.getTeamStaff(c.userTeamId).headCoach.name
    expect(it0.message).toContain(`${coach} shuts your door`)
    const view = career.getInbox().interactions!.find((i) => i.id === it0.id)!
    // The view carries the flag the living phone reads (phoneCalls.test.ts).
    expect(view.inPerson).toBe(true)
    // The friction is real in the room (chemistry, Dynamics).
    const lr = c.lockerRooms.get(c.userTeamId)
    expect(lr.relationships.some((r: any) => r.kind === 'feud' && [r.a, r.b].includes(cause.aId) && [r.a, r.b].includes(cause.bId))).toBe(true)
    // And the chronicle has the cause.
    expect(c.chronicle.events.some((e: any) => e.kind === 'feud' && /first line \(Oct 3\)/.test(e.headline))).toBe(true)
  })

  it('"split them up" changes the lines; after eight games apart it settles and the feud is gone', () => {
    const { career, c } = makeCareer(902)
    const { aId, bId, cause } = firstLinePair(c)
    const it0 = raise(c, cause)
    const res = career.respondToInteraction(it0.id, 'split')
    expect(res.ok).toBe(true)
    expect(res.message).toMatch(/won't share a shift/)
    expect(c.shareUserEvLine(aId, bId)).toBe(false)
    let guard = 0
    while (c.feud.arcs[0].status === 'cooling' && guard++ < 40) career.advance(1)
    expect(c.feud.arcs[0].status).toBe('resolved')
    const lr = c.lockerRooms.get(c.userTeamId)
    expect(lr.relationships.some((r: any) => r.kind === 'feud' && [r.a, r.b].includes(aId) && [r.a, r.b].includes(bId))).toBe(false)
    expect(c.news.some((n: any) => /it's settled/.test(n.headline) && /games on different lines since you split them/.test(n.body))).toBe(true)
    expect(c.chronicle.events.filter((e: any) => e.kind === 'feud').length).toBeGreaterThanOrEqual(3) // raised, split, settled
  }, 120_000)

  it('backing one man is remembered by both: trust for him, a grievance for the other', () => {
    const { career, c } = makeCareer(903)
    const { aId, bId, cause } = firstLinePair(c)
    const it0 = raise(c, cause)
    career.respondToInteraction(it0.id, 'backA')
    expect(c.data.players.get(aId).moraleMemory?.some((m: any) => m.kind === 'backed')).toBe(true)
    expect(c.data.players.get(bId).moraleMemory?.some((m: any) => m.kind === 'grievance')).toBe(true)
    expect(c.residueFlags.some((f: any) => f.playerId === bId && f.kind === 'wasDismissed')).toBe(true)
  })

  it('putting them back together before it cools makes it flare, and the next scene quotes the first', () => {
    const { career, c } = makeCareer(904)
    const { aId, bId, cause } = firstLinePair(c)
    const it0 = raise(c, cause)
    career.respondToInteraction(it0.id, 'split')
    career.setLineManagementMode('fillGaps') // the GM runs his own lines now
    // The GM puts them back on the same line.
    const lines = c.userTeam.lines.forwards
    const li = lines.findIndex((l: any[]) => l.includes(bId))
    const ai = lines.findIndex((l: any[]) => l.includes(aId))
    const bi = lines[li].indexOf(bId)
    const swapOut = lines[ai].find((x: string) => x !== aId)
    lines[li][bi] = swapOut
    lines[ai][lines[ai].indexOf(swapOut)] = bId
    expect(c.shareUserEvLine(aId, bId)).toBe(true)
    c.tickFeuds(12, true)
    expect(c.feud.arcs[0].status).toBe('escalated')
    expect(c.news.some((n: any) => /on the same line again/.test(n.headline))).toBe(true)
    // The second scene (rate rules permitting) opens by quoting the first.
    c.tickFeuds(45, false)
    const second = c.interactions.find((i: any) => i.status === 'open' && i.kind === 'feud')
    expect(second?.message).toMatch(/^You split them on \w{3} \d{1,2}\. They were back on the same line on \w{3} \d{1,2}\./)
  })

  it('an ignored feud scene lapses quietly: no agent, no morale cost to anyone', () => {
    const { c } = makeCareer(905)
    const { aId, cause } = firstLinePair(c)
    const it0 = raise(c, cause, 5)
    const m0 = c.data.players.get(aId).morale
    c.expireStaleInteractions(5 + Career.CONCERN_EXPIRY_DAYS)
    expect(it0.status).toBe('resolved')
    expect(c.feud.arcs[0].status).toBe('lapsed')
    expect(c.data.players.get(aId).morale).toBe(m0)
    expect(c.news.some((n: any) => /Nobody called him back/.test(n.headline) && n.playerId === aId)).toBe(false)
  })
})

describe('feuds over a season', () => {
  it('no generic feud phone calls, at most two feud scenes, never the same pair twice without an escalation', () => {
    const { career, c } = makeCareer(906)
    while (career.advanceDay()) {
      // A GM who answers every feud by splitting them (the autopilot's kind of answer).
      for (const i of c.interactions) {
        if (i.status === 'open' && i.kind === 'feud' && i.inPerson) career.respondToInteraction(i.id, 'split')
      }
    }
    const feudCalls = c.interactions.filter((i: any) => i.kind === 'feud' && !i.inPerson)
    expect(feudCalls).toHaveLength(0)
    const arcs = c.feud.arcs.filter((a: any) => a.raisedYear === c.year)
    expect(arcs.length).toBeLessThanOrEqual(2)
    const pairs = arcs.map((a: any) => [a.aId, a.bId].sort().join('|'))
    expect(new Set(pairs).size).toBe(pairs.length)
  }, 180_000)
})
