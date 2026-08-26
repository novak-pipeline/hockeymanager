/**
 * Autopilot findings H1–H3 — a standing trade offer must never be a button that
 * throws, and the GM's own deals are bound by the ceiling like everyone else's.
 *
 *  H1  An offer names assets. Assets move. Expiry is not validity: an offer well
 *      inside its window is DEAD the moment the player it wants leaves the
 *      roster, and used to sit on the desk looking live until Accept threw
 *      "player p79 is not on Florida Panthers's roster".
 *  H2  A rival tabled a deal the club had no cap room to complete, and the UI
 *      still offered Accept. Filtered at generation now, and any offer that goes
 *      illegal afterwards carries a `blockedReason` that greys the button out.
 *  H3  Incoming offers were cap-guarded; the trades the GM PROPOSED HIMSELF ran
 *      through `executeUserTrade`, which checked nothing. That is the path that
 *      left a club $6.5M over the ceiling with the discretionary recall route
 *      (Gap #4) already closed.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from './career'
import { generateAiOffers, rosterCapUsed } from '@engine/league/trades'
import { Rng } from '@engine/shared/rng'
import { asPlayerId, asTeamId } from '@domain/ids'
import type { PlayerId, TeamId } from '@domain/ids'
import type { StoredTradeOffer } from '@engine/league/trades'

/** Reach into the Career's private market state — these are engine-internal by
 *  design, and the whole point of these tests is what the desk holds. */
interface Innards {
  tradeOffers: StoredTradeOffer[]
  offerCounter: number
}
const innards = (c: Career): Innards => c as unknown as Innards

function setup(seed: number): {
  career: Career
  data: ReturnType<typeof generateLeague>
  userId: TeamId
  partnerId: TeamId
} {
  const data = generateLeague({ seed })
  const userId = asTeamId(data.league.teams[0] as string)
  const partnerId = asTeamId(data.league.teams[1] as string)
  return { career: new Career(data, seed, userId), data, userId, partnerId }
}

/** Table an offer directly, exactly as the generators do. */
function tableOffer(
  career: Career,
  partnerId: TeamId,
  gives: PlayerId[],
  receives: PlayerId[],
): string {
  const offerId = `t${innards(career).offerCounter++}`
  innards(career).tradeOffers.push({
    offerId,
    partnerTeamId: partnerId,
    userReceivesPlayerIds: receives,
    userReceivesPicks: [],
    userGivesPlayerIds: gives,
    userGivesPicks: [],
    message: 'A deal.',
    expiresOnDay: 999,
  })
  return offerId
}

describe('H1 — an offer dies when its assets move', () => {
  it('is pulled off the desk, with a reason, once the player it wants is gone', () => {
    const { career, data, userId, partnerId } = setup(4101)
    const user = data.teams.get(userId)!
    const partner = data.teams.get(partnerId)!
    const mine = user.roster[0]!
    const theirs = partner.roster[0]!
    const offerId = tableOffer(career, partnerId, [mine], [theirs])

    expect(career.getTrades().incoming.map((o) => o.offerId)).toContain(offerId)

    // He is traded elsewhere / sent down — either way he's off the NHL roster.
    user.roster = user.roster.filter((id) => id !== mine)

    expect(career.getTrades().incoming.map((o) => o.offerId)).not.toContain(offerId)
    const news = career.getInbox().items
    expect(news.some((i) => /pull their offer/i.test(i.headline))).toBe(true)
  })

  it('accepting a dead offer reports it gone — no throw, no roster invariant', () => {
    const { career, data, userId, partnerId } = setup(4102)
    const partner = data.teams.get(partnerId)!
    const mine = data.teams.get(userId)!.roster[0]!
    const theirs = partner.roster[0]!
    const offerId = tableOffer(career, partnerId, [mine], [theirs])

    // This time it's THEIR man who moves on before you call back.
    partner.roster = partner.roster.filter((id) => id !== theirs)

    // The old failure mode was a raw invariant violation out of executeTrade
    // ("player p79 is not on Florida Panthers's roster"). Now it's an answer.
    let res: { ok: boolean; message?: string } | undefined
    expect(() => { res = career.acceptTrade(offerId) }).not.toThrow()
    expect(res?.ok).toBe(false)
    expect(res?.message).toMatch(/no longer on the table/i)
  })
})

describe('H2 — an offer the club cannot afford', () => {
  it('carries a blockedReason instead of an Accept that throws', () => {
    const { career, data, userId, partnerId } = setup(4103)
    const user = data.teams.get(userId)!
    const partner = data.teams.get(partnerId)!
    const incoming = partner.roster
      .map((id) => data.players.get(id)!)
      .sort((a, b) => b.contract.salary - a.contract.salary)[0]!
    // Not a dollar of room: any salary coming in breaches the ceiling.
    user.finances.salaryCap = rosterCapUsed(user, data.players)
    const offerId = tableOffer(career, partnerId, [], [incoming.id])

    const view = career.getTrades().incoming.find((o) => o.offerId === offerId)!
    expect(view.blockedReason).toMatch(/over the cap/i)
    // Still on the desk — shed salary and the same deal becomes legal.
    expect(view.offerId).toBe(offerId)
  })

  it('is never generated in the first place when the user has no room', () => {
    const data = generateLeague({ seed: 4104 })
    const userId = asTeamId(data.league.teams[0] as string)
    const user = data.teams.get(userId)!
    user.finances.salaryCap = rosterCapUsed(user, data.players) // zero space
    for (const [, t] of data.teams) t.finances.capUsed = rosterCapUsed(t, data.players)

    let offers = 0
    for (let day = 1; day <= 400; day++) {
      const made = generateAiOffers({
        day,
        userTeamId: userId,
        teams: data.teams,
        players: data.players,
        picks: [],
        rng: new Rng(7002 * 1000 + day),
        nextOfferId: () => `o${day}`,
      })
      for (const o of made) {
        offers++
        const incoming = o.userReceivesPlayerIds.reduce(
          (s, id) => s + data.players.get(id)!.contract.salary,
          0,
        )
        const outgoing = o.userGivesPlayerIds.reduce(
          (s, id) => s + data.players.get(id)!.contract.salary,
          0,
        )
        // Every offer tabled must be one the GM could legally sign today.
        expect(incoming - outgoing).toBeLessThanOrEqual(0)
      }
    }
    // The generator still ran — this isn't passing on an empty market.
    expect(offers).toBeGreaterThan(0)
  })
})

describe('H3 — the GM\'s own trades obey the ceiling', () => {
  it('refuses to table a proposal the club could not complete', () => {
    const { career, data, userId, partnerId } = setup(4105)
    const user = data.teams.get(userId)!
    const partner = data.teams.get(partnerId)!
    const target = partner.roster.map((id) => data.players.get(id)!)[0]!
    target.contract.salary = 40_000_000
    user.finances.salaryCap = rosterCapUsed(user, data.players) + 1_000_000

    const res = career.proposeTrade({
      partnerTeamId: partnerId as string,
      givePlayerIds: [],
      givePickIds: [],
      receivePlayerIds: [target.id as string],
      receivePickIds: [],
    })
    expect(res.verdict).toBe('reject')
    expect(res.message).toMatch(/over the cap/i)
    expect(user.roster).not.toContain(target.id)
  })

  it('kills a deal that stopped fitting while the rival GM slept on it', () => {
    const { career, data, userId, partnerId } = setup(4108)
    const user = data.teams.get(userId)!
    const tv = career.getTrades()
    const partnerView = tv.partners.find((p) => p.teamId === (partnerId as string))!
    // Priced off the desk's own trade values, not raw overall — a gift they take.
    const myBest = [...tv.myPlayers]
      .filter((p) => p.position !== 'G' && !p.noTradeClause)
      .sort((a, b) => (b.tradeValue ?? 0) - (a.tradeValue ?? 0))[0]!
    const theirSpare = [...partnerView.players]
      .filter((p) => p.position !== 'G' && !p.noTradeClause)
      .sort((a, b) => (a.tradeValue ?? 0) - (b.tradeValue ?? 0))[0]!

    const res = career.proposeTrade({
      partnerTeamId: partnerId as string,
      givePlayerIds: [myBest.playerId],
      givePickIds: [],
      receivePlayerIds: [theirSpare.playerId],
      receivePickIds: [],
    })
    expect(res.verdict).toBe('pending') // taken under advisement, executes later

    // Overnight his cap hit balloons — the money changed between the handshake
    // and the paperwork, which is exactly the window `executeUserTrade` covers.
    data.players.get(asPlayerId(theirSpare.playerId))!.contract.salary = 60_000_000
    career.advance(4)

    // The deal died rather than dragging the club over the ceiling.
    expect(user.roster.map((id) => id as string)).not.toContain(theirSpare.playerId)
    expect(rosterCapUsed(user, data.players)).toBeLessThanOrEqual(user.finances.salaryCap)
    const fellThrough = career
      .getInbox()
      .items.find((i) => /fell through/i.test(i.headline))
    expect(fellThrough?.body ?? '').toMatch(/over the cap/i)
  })

  it('a full season of autopilot-style dealing never breaches the ceiling', () => {
    // The end-to-end shape of H3: whatever the market does to a club over a
    // season, the discretionary paths keep it legal. (The emergency recall pass
    // may still eat an overage to ice a lineup — that separation is pinned in
    // callUpCap.test.ts — so this allows the same 5% the autopilot allows.)
    const { career, data, userId } = setup(4107)
    const user = data.teams.get(userId)!
    let taken = 0
    for (let i = 0; i < 60; i++) {
      career.advance(3)
      for (const o of career.getTrades().incoming) {
        if (o.blockedReason) continue
        // A GM who deals away his goaltending can't ice a team; that shortfall is
        // a different guard's job, so this greedy stand-in leaves the crease be.
        if (o.give.players.some((p) => p.position === 'G')) continue
        career.acceptTrade(o.offerId) // must never throw
        taken++
        break
      }
      expect(rosterCapUsed(user, data.players)).toBeLessThanOrEqual(user.finances.salaryCap * 1.05)
    }
    expect(taken).toBeGreaterThan(0) // the market was live — this isn't a no-op
  })
})
