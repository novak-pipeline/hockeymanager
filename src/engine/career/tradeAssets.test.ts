/**
 * Playtest 2026-07-31 — A4 (the asset market) and A5 (a trade has to make a noise).
 *
 * A4: only NHL-roster players were tradeable. AHL skaters, rights-held juniors
 * and draft picks are the futures half of a GM's market — without them you can
 * neither sell futures nor buy them, and every deal collapses onto the big club.
 *
 * A5: the user traded a franchise defenceman and the world said nothing. A
 * notable deal owes the GM three things — a headline on his desk, a reaction on
 * the Feed and a World Chronicle entry — and the volume has to scale with the
 * asset: a depth swap stays quiet, a star does not.
 */
import { describe, expect, it } from 'vitest'
import { asPlayerId, asTeamId, type Player, type PlayerId, type Team, type TeamId } from '@domain'
import { generateLeague } from '@data/generate'
import { Career } from './career'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Harness {
  career: Career
  userId: TeamId
  teams: Map<TeamId, Team>
  players: Map<PlayerId, Player>
  raw: any
}

function setup(seed: number): Harness {
  const data = generateLeague({ seed })
  const userId = data.league.teams[2]!
  const career = new Career(data, seed, userId)
  career.advance(6)
  const raw = career as any
  return { career, userId, teams: raw.data.teams, players: raw.data.players, raw }
}

const affiliateOf = (h: Harness, teamId: string): Team => {
  const nhl = h.teams.get(asTeamId(teamId))!
  return h.teams.get(nhl.affiliateId!)!
}

describe('A4 — the whole organisation is a trade asset', () => {
  it('lists AHL skaters and rights-held juniors alongside the NHL roster', () => {
    const h = setup(4401)
    // A junior whose rights we hold but who plays nowhere in our system: take an
    // affiliate skater off the AHL sheet and leave only the rights behind.
    const ahl = affiliateOf(h, h.userId as string)
    const juniorId = ahl.roster[ahl.roster.length - 1]!
    ahl.roster = ahl.roster.filter((id) => id !== juniorId)
    h.players.get(juniorId)!.rightsTeamId = h.userId

    const view = h.career.getTrades()
    const mine = view.myPlayers
    expect(mine.some((p) => (p.assetClass ?? 'nhl') === 'nhl')).toBe(true)
    // The two that used to be unreachable.
    expect(mine.filter((p) => p.assetClass === 'ahl').length).toBeGreaterThan(0)
    expect(mine.some((p) => p.playerId === (juniorId as string) && p.assetClass === 'junior')).toBe(true)
    // Every farm asset still carries a real, comparable trade value.
    for (const p of mine.filter((x) => (x.assetClass ?? 'nhl') !== 'nhl')) {
      expect(p.tradeValue).toBeGreaterThanOrEqual(0)
    }
    // A partner's system is visible too — you can buy futures, not just sell them.
    expect(view.partners[0]!.players.some((p) => p.assetClass === 'ahl')).toBe(true)
  })

  it('moves a prospect between organisations and flips pick ownership', () => {
    const h = setup(4402)
    const view = h.career.getTrades()
    const partnerId = view.partners[0]!.teamId
    const prospect = view.myPlayers.find((p) => p.assetClass === 'ahl')!
    expect(prospect).toBeTruthy()
    const myPick = view.myPicks[0]!
    const theirPick = view.partners[0]!.picks[0]!

    const res = h.raw.executeUserTrade({
      partnerTeamId: partnerId,
      givePlayerIds: [prospect.playerId],
      givePickIds: [myPick.id],
      receivePlayerIds: [],
      receivePickIds: [theirPick.id],
    })
    expect(res.ok).toBe(true)

    // He is out of our system and into theirs, rights and all.
    const pid = asPlayerId(prospect.playerId)
    expect(affiliateOf(h, h.userId as string).roster).not.toContain(pid)
    expect(affiliateOf(h, partnerId).roster).toContain(pid)
    expect(h.players.get(pid)!.rightsTeamId).toBe(asTeamId(partnerId))
    // He never lands on anybody's NHL roster on the way through.
    expect(h.teams.get(asTeamId(partnerId))!.roster).not.toContain(pid)

    // Picks move both directions (A4's "verify picks").
    const after = h.career.getTrades()
    expect(after.myPicks.some((p) => p.id === theirPick.id)).toBe(true)
    expect(after.myPicks.some((p) => p.id === myPick.id)).toBe(false)
  })

  it('a prospect costs the acquiring club no cap space', () => {
    const h = setup(4403)
    const view = h.career.getTrades()
    const partnerId = view.partners[0]!.teamId
    const prospect = view.myPlayers.find((p) => p.assetClass === 'ahl' && p.salary > 0)
    if (!prospect) return // nothing to prove on this seed
    const capBefore = h.teams.get(asTeamId(partnerId))!.finances.capUsed

    // The assistant GM's read must not claim a cap problem for a farm asset.
    const assess = h.career.assessTrade({
      partnerTeamId: partnerId,
      givePlayerIds: [prospect.playerId],
      givePickIds: [],
      receivePlayerIds: [],
      receivePickIds: [view.partners[0]!.picks[0]!.id],
    })
    expect(assess.tone).not.toBe('blocked')

    h.raw.executeUserTrade({
      partnerTeamId: partnerId,
      givePlayerIds: [prospect.playerId],
      givePickIds: [],
      receivePlayerIds: [],
      receivePickIds: [view.partners[0]!.picks[0]!.id],
    })
    expect(h.teams.get(asTeamId(partnerId))!.finances.capUsed).toBe(capBefore)
  })

  it('a fringe prospect on one side still gets a real read, not "put something in"', () => {
    const h = setup(4404)
    const view = h.career.getTrades()
    const partner = view.partners[0]!
    // The lowest-graded asset in the system — with the farm tradeable this is a
    // legitimate selection, so the desk must price it rather than call the side empty.
    const fringe = [...view.myPlayers].sort((a, b) => (a.tradeValue ?? 0) - (b.tradeValue ?? 0))[0]!
    const theirBest = [...partner.players].sort((a, b) => (b.tradeValue ?? 0) - (a.tradeValue ?? 0))[0]!
    const draft = h.career.evaluateTradeDraft({
      partnerTeamId: partner.teamId,
      givePlayerIds: [fringe.playerId],
      givePickIds: [],
      receivePlayerIds: [theirBest.playerId],
      receivePickIds: [],
    })
    expect(draft.marketVerdict).not.toBe('empty')
    expect(Number.isFinite(draft.marketPct ?? 0)).toBe(true)
    expect(h.career.assessTrade({
      partnerTeamId: partner.teamId,
      givePlayerIds: [fringe.playerId],
      givePickIds: [],
      receivePlayerIds: [theirBest.playerId],
      receivePickIds: [],
    }).tone).not.toBe('empty')
  })
})

describe('A5 — a notable trade makes a noise', () => {
  /** Turn the best skater on the user's roster into a genuine franchise player. */
  const makeStar = (h: Harness, overall: number): Player => {
    const roster = h.teams.get(h.userId)!.roster.map((id) => h.players.get(id)!)
    const star = roster
      .filter((p) => p.position !== 'G')
      .sort((a, b) => (b.baseOverall ?? 0) - (a.baseOverall ?? 0))[0]!
    star.baseOverall = overall
    star.contract.noTradeClause = false
    return star
  }

  it('a franchise player changing teams breaks on the wire, the Feed and the chronicle', () => {
    const h = setup(4501)
    const star = makeStar(h, 92)
    const partner = h.career.getTrades().partners[0]!

    h.raw.executeUserTrade({
      partnerTeamId: partner.teamId,
      givePlayerIds: [star.id as string],
      givePickIds: [],
      receivePlayerIds: [],
      receivePickIds: [partner.picks[0]!.id],
    })

    // 1. A headline on the GM's desk that NAMES him.
    const items = h.career.getInbox().items.filter((n) => n.category === 'trade')
    const head = items.find((n) => n.headline.startsWith('BLOCKBUSTER'))
    expect(head, 'a franchise trade must break as a headline, not a one-line receipt').toBeTruthy()
    expect(head!.headline).toContain(star.name)
    expect(head!.headline).toContain(partner.teamName)
    expect(head!.salience ?? 0).toBeGreaterThanOrEqual(90)
    // It is OUR club's business — the inbox curation keys off that.
    expect(head!.teamId).toBe(h.userId as string)
    expect(head!.playerId).toBe(star.id as string)

    // 2. It breaks on the Feed the same day — not a day later, and not subject
    //    to the ambient one-post-per-author quiet gate.
    const feed = h.career.getFeed().posts
    expect(
      feed.some((p) => p.body.includes(star.name) && p.day === h.career.getDay()),
      'a blockbuster must break on the Feed immediately',
    ).toBe(true)

    // 3. The World Chronicle remembers it.
    const chron = h.raw.chronicle.events.filter((e: any) => e.kind === 'trade')
    expect(chron.length).toBeGreaterThan(0)
    expect(chron.some((e: any) => (e.playerIds ?? []).includes(star.id as string))).toBe(true)
  })

  it('a depth swap stays quiet — no breaking headline, no wire break', () => {
    const h = setup(4502)
    const roster = h.teams.get(h.userId)!.roster.map((id) => h.players.get(id)!)
    const scrub = roster
      .filter((p) => p.position !== 'G' && !p.contract.noTradeClause)
      .sort((a, b) => (a.baseOverall ?? 100) - (b.baseOverall ?? 100))[0]!
    scrub.baseOverall = 60
    const partner = h.career.getTrades().partners[0]!
    const latePick = [...partner.picks].sort((a, b) => b.round - a.round)[0]!

    const feedBefore = h.career.getFeed().posts.length
    h.raw.executeUserTrade({
      partnerTeamId: partner.teamId,
      givePlayerIds: [scrub.id as string],
      givePickIds: [],
      receivePlayerIds: [],
      receivePickIds: [latePick.id],
    })

    const items = h.career.getInbox().items.filter((n) => n.category === 'trade')
    expect(items.some((n) => n.headline.includes('BLOCKBUSTER'))).toBe(false)
    const line = items[0]!
    expect(line.salience ?? 0).toBeLessThan(40)
    // Depth moves do not break on the wire.
    expect(h.career.getFeed().posts.length).toBe(feedBefore)
    // But the chronicle still has the receipt — the ledger forgets nothing.
    expect(h.raw.chronicle.events.filter((e: any) => e.kind === 'trade').length).toBeGreaterThan(0)
  })

  it('a prospect traded away still reaches the chronicle', () => {
    const h = setup(4503)
    const view = h.career.getTrades()
    const partner = view.partners[0]!
    const prospect = view.myPlayers.find((p) => p.assetClass === 'ahl')!
    h.raw.executeUserTrade({
      partnerTeamId: partner.teamId,
      givePlayerIds: [prospect.playerId],
      givePickIds: [],
      receivePlayerIds: [],
      receivePickIds: [partner.picks[0]!.id],
    })
    const chron = h.raw.chronicle.events.filter((e: any) => e.kind === 'trade')
    expect(chron.some((e: any) => (e.playerIds ?? []).includes(prospect.playerId))).toBe(true)
  })
})

/**
 * The A4/A5 merge resolution. Two cap models nearly shipped side by side — the
 * crash-fix chip's `userTradeOverage` (which knew nothing about the farm) and
 * A4's own parallel arithmetic (which did). There is now ONE authority, and it
 * is the one that knows: `userTradeOverage`, told who the partner is. These two
 * tests are the fence around it — the farm is free, and the ceiling is real.
 */
describe('the cap has one authority, and the farm sits outside it', () => {
  /** Cap actually charged to a club's NHL sheet. */
  const nhlCapOf = (h: Harness, teamId: TeamId): number => {
    let sum = 0
    for (const id of h.teams.get(teamId)!.roster) {
      const p = h.players.get(id)
      if (p) sum += p.contract.salary - (p.contract.retainedByOthers ?? 0)
    }
    return sum
  }

  it('a trade of only farm assets moves zero cap in either direction', () => {
    const h = setup(4601)
    const view = h.career.getTrades()
    const partner = view.partners[0]!
    const partnerId = asTeamId(partner.teamId)
    const mine = view.myPlayers.find((p) => p.assetClass === 'ahl')!
    const theirs = partner.players.find((p) => p.assetClass === 'ahl')!
    expect(mine).toBeTruthy()
    expect(theirs).toBeTruthy()

    // Put real NHL money on both farm assets. A cap model that counted them
    // would be off by millions in BOTH directions, so nothing here can pass by
    // the numbers happening to be small.
    const mineId = asPlayerId(mine.playerId)
    const theirsId = asPlayerId(theirs.playerId)
    h.players.get(mineId)!.contract.salary = 4_000_000
    h.players.get(theirsId)!.contract.salary = 7_500_000

    // The one authority: a farm-only package reads exactly like an empty one.
    const empty = h.raw.userTradeOverage([], [], partnerId)
    const farmOnly = h.raw.userTradeOverage([theirsId], [mineId], partnerId)
    expect(farmOnly).toBe(empty)
    // ... and it is not simply blind — an NHL contract on the same side moves it.
    const nhlRow = partner.players.find((p) => (p.assetClass ?? 'nhl') === 'nhl' && p.salary > 0)!
    expect(h.raw.userTradeOverage([asPlayerId(nhlRow.playerId)], [], partnerId)).toBeGreaterThan(empty)

    // Nobody is blocked, and the AGM does not invent a cap problem either.
    expect(h.raw.userTradeBlockReason([theirsId], [mineId], partnerId)).toBe(null)
    const proposal = {
      partnerTeamId: partner.teamId,
      givePlayerIds: [mine.playerId],
      givePickIds: [],
      receivePlayerIds: [theirs.playerId],
      receivePickIds: [],
    }
    expect(h.career.assessTrade(proposal).tone).not.toBe('blocked')

    const userCapBefore = nhlCapOf(h, h.userId)
    const partnerCapBefore = nhlCapOf(h, partnerId)
    expect(h.raw.executeUserTrade(proposal).ok).toBe(true)

    // Both men changed organisations — and neither NHL sheet noticed.
    expect(affiliateOf(h, partner.teamId).roster).toContain(mineId)
    expect(affiliateOf(h, h.userId as string).roster).toContain(theirsId)
    expect(nhlCapOf(h, h.userId)).toBe(userCapBefore)
    expect(nhlCapOf(h, partnerId)).toBe(partnerCapBefore)
  })

  it('a trade the club cannot afford is still refused', () => {
    const h = setup(4602)
    const view = h.career.getTrades()
    const partner = view.partners[0]!
    const partnerId = asTeamId(partner.teamId)
    const target = partner.players
      .filter((p) => (p.assetClass ?? 'nhl') === 'nhl' && p.salary > 0 && !p.noTradeClause)
      .sort((a, b) => b.salary - a.salary)[0]!
    expect(target).toBeTruthy()

    // Leave the club $2.0M short of the money coming back. It is legal today and
    // illegal the moment he arrives — which is the whole point of the guard.
    const us = h.teams.get(h.userId)!
    us.finances.salaryCap = h.raw.userCapUsed() + h.raw.userDeadCap + target.salary - 2_000_000

    const proposal = {
      partnerTeamId: partner.teamId,
      givePlayerIds: [],
      givePickIds: [view.myPicks[0]!.id],
      receivePlayerIds: [target.playerId],
      receivePickIds: [],
    }
    // The AGM says it, the offer card would say it, and the engine enforces it —
    // all three off the same arithmetic.
    expect(h.raw.userTradeOverage([asPlayerId(target.playerId)], [], partnerId)).toBeCloseTo(2_000_000, -3)
    expect(h.career.assessTrade(proposal).tone).toBe('blocked')
    const res = h.raw.executeUserTrade(proposal)
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/over the cap/)
    // And he did not move. A refused deal is refused, not half-done.
    expect(h.teams.get(partnerId)!.roster).toContain(asPlayerId(target.playerId))
    expect(us.roster).not.toContain(asPlayerId(target.playerId))
  })

  it('the same money as a farm asset is affordable when as an NHL contract it is not', () => {
    const h = setup(4603)
    const view = h.career.getTrades()
    const partner = view.partners[0]!
    const partnerId = asTeamId(partner.teamId)
    const farm = partner.players.find((p) => p.assetClass === 'ahl')!
    const nhl = partner.players
      .filter((p) => (p.assetClass ?? 'nhl') === 'nhl' && p.salary > 0)
      .sort((a, b) => b.salary - a.salary)[0]!

    // Identical contracts; the ONLY difference is which sheet each man is on.
    const money = 9_000_000
    h.players.get(asPlayerId(farm.playerId))!.contract.salary = money
    h.players.get(asPlayerId(nhl.playerId))!.contract.salary = money
    h.teams.get(h.userId)!.finances.salaryCap =
      h.raw.userCapUsed() + h.raw.userDeadCap + money - 3_000_000

    expect(h.raw.userTradeBlockReason([asPlayerId(nhl.playerId)], [], partnerId)).toMatch(/over the cap/)
    expect(h.raw.userTradeBlockReason([asPlayerId(farm.playerId)], [], partnerId)).toBe(null)
  })
})
