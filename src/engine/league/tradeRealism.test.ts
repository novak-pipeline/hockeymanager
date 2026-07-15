/**
 * LW3 realism overhaul — "if you wouldn't accept it in real life, the AI GM
 * won't either." Each test is a real-world trade scenario.
 */
import { describe, expect, it } from 'vitest'
import { Rng } from '@engine/shared/rng'
import type { Player, PlayerId, Team } from '@domain'
import { evaluateProposal, playerValue } from './trades'
import { makePlayer, makeTeam, makePick } from './trades.test.fixtures'

function bigClub(): { partnerTeam: Team; partnerPlayers: Map<PlayerId, Player> } {
  // A realistic roster: 13 F, 7 D, 2 G.
  const roster: Player[] = []
  for (let i = 0; i < 13; i++) roster.push(makePlayer(`f${i}`, i === 0 ? 88 : 72 - i, { position: i % 3 === 0 ? 'C' : 'W', age: 26 + (i % 6) }))
  for (let i = 0; i < 7; i++) roster.push(makePlayer(`d${i}`, 74 - i, { position: 'D', age: 25 + i }))
  roster.push(makePlayer('g0', 78, { position: 'G', age: 28 }))
  roster.push(makePlayer('g1', 68, { position: 'G', age: 25 }))
  const partnerTeam = makeTeam('club', roster)
  return { partnerTeam, partnerPlayers: new Map(roster.map((p) => [p.id, p])) }
}

describe('real-GM rules', () => {
  it('FLEECE-PROOF: four depth pieces never buy a star, no matter the point total', () => {
    const { partnerTeam, partnerPlayers } = bigClub()
    const star = partnerPlayers.get('f0' as PlayerId)! // 88 ovr
    const depth = [
      makePlayer('u1', 68, { age: 26 }), makePlayer('u2', 67, { age: 27 }),
      makePlayer('u3', 66, { age: 25 }), makePlayer('u4', 66, { age: 28 }),
    ]
    // Raw sum of depth values can exceed the star's — a naive model accepts.
    for (let seed = 1; seed <= 10; seed++) {
      const res = evaluateProposal({
        give: { players: depth, picks: [] },
        receive: { players: [star], picks: [] },
        partnerTeam, partnerPlayers, rng: new Rng(seed),
      })
      expect(res.verdict).toBe('reject')
      expect(res.message).toMatch(/best asset|quantity/i)
    }
  })

  it('DEPTH GUARD: nobody trades their only backup goalie for skaters', () => {
    const { partnerTeam, partnerPlayers } = bigClub()
    const backup = partnerPlayers.get('g1' as PlayerId)!
    const res = evaluateProposal({
      give: { players: [makePlayer('sweet', 74, { age: 25 })], picks: [makePick(2026, 2, 'u')] },
      receive: { players: [backup], picks: [] },
      partnerTeam, partnerPlayers, rng: new Rng(3),
    })
    expect(res.verdict).toBe('reject')
    expect(res.message).toMatch(/crease/i)
  })

  it('ENDOWMENT: a dead-even swap is not enough — GMs overvalue their own', () => {
    const { partnerTeam, partnerPlayers } = bigClub()
    const theirGuy = partnerPlayers.get('f5' as PlayerId)!
    // Clone-grade equivalent player (same overall/age/position family).
    const myGuy = makePlayer('mine', 67, { position: 'W', age: 31 }) // mirror f5's age
    // Values within a whisker of each other.
    expect(Math.abs(playerValue(myGuy) - playerValue(theirGuy)) / playerValue(theirGuy)).toBeLessThan(0.12)
    let accepts = 0
    for (let seed = 1; seed <= 20; seed++) {
      const res = evaluateProposal({
        give: { players: [myGuy], picks: [] },
        receive: { players: [theirGuy], picks: [] },
        partnerTeam, partnerPlayers, rng: new Rng(seed),
      })
      if (res.verdict === 'accept') accepts++
    }
    // A perfectly "fair" offer should essentially never clear the endowment bar.
    expect(accepts).toBeLessThanOrEqual(2)
  })

  it('UNTOUCHABLE: a 22-year-old star takes a massive overpay to move', () => {
    const roster: Player[] = []
    for (let i = 0; i < 12; i++) roster.push(makePlayer(`ff${i}`, 70, { position: 'W', age: 27 }))
    const wonder = makePlayer('wonder', 84, { position: 'C', age: 22 })
    roster.push(wonder)
    for (let i = 0; i < 6; i++) roster.push(makePlayer(`dd${i}`, 70, { position: 'D', age: 27 }))
    roster.push(makePlayer('gg0', 74, { position: 'G', age: 27 }), makePlayer('gg1', 68, { position: 'G', age: 26 }))
    const partnerTeam = makeTeam('yc', roster)
    const partnerPlayers = new Map(roster.map((p) => [p.id, p]))
    // A merely-fair headline star + change: rejected. (~115% of value!)
    const fairStar = makePlayer('fair', 84, { position: 'C', age: 27 })
    const res = evaluateProposal({
      give: { players: [fairStar, makePlayer('chg', 66, { age: 25 })], picks: [] },
      receive: { players: [wonder], picks: [] },
      partnerTeam, partnerPlayers, rng: new Rng(7),
    })
    expect(res.verdict).not.toBe('accept')
  })

  it('RENTALS: a contender at the deadline pays for an expiring vet; a rebuilder will not', () => {
    const { partnerTeam, partnerPlayers } = bigClub()
    const rental = makePlayer('rental', 78, { position: 'W', age: 30, years: 1 })
    const offer = (posture: 'contend' | 'rebuild', proximity: number) =>
      evaluateProposal({
        give: { players: [rental], picks: [] },
        receive: { players: [], picks: [makePick(2026, 1, 'club'), makePick(2026, 3, 'club')] },
        partnerTeam, partnerPlayers, rng: new Rng(11),
        context: { posture, deadlineProximity: proximity },
      })
    const rank = (v: string): number => (v === 'accept' ? 2 : v === 'counter' ? 1 : 0)
    const contender = offer('contend', 1)
    const rebuilder = offer('rebuild', 1)
    // The same rental package reads very differently across the table.
    expect(rank(contender.verdict)).toBeGreaterThanOrEqual(rank(rebuilder.verdict))
    expect(
      contender.verdict !== rebuilder.verdict ||
      contender.counterAskValue !== rebuilder.counterAskValue
    ).toBe(true)
  })

  it('REBUILDERS discount 32-year-olds even on multi-year deals', () => {
    const { partnerTeam, partnerPlayers } = bigClub()
    const agingVet = makePlayer('vet', 79, { position: 'C', age: 32, years: 3 })
    const evalFor = (posture: 'contend' | 'rebuild') =>
      evaluateProposal({
        give: { players: [agingVet], picks: [] },
        receive: { players: [], picks: [makePick(2026, 1, 'club'), makePick(2026, 2, 'club')] },
        partnerTeam, partnerPlayers, rng: new Rng(13),
        context: { posture, deadlineProximity: 0.5 },
      })
    const rank = (v: string): number => (v === 'accept' ? 2 : v === 'counter' ? 1 : 0)
    expect(rank(evalFor('contend').verdict)).toBeGreaterThanOrEqual(rank(evalFor('rebuild').verdict))
  })
})
