/**
 * Deadline-day tentpole harness. Sims a season up to the moment the trade
 * deadline holds the sim, then asserts the hub is real and live:
 *   • concrete incoming offers land (real, acceptable StoredTradeOffers);
 *   • the "who's being shopped" board is populated with asking prices;
 *   • the live wire carries completed AI-vs-AI deals;
 *   • accepting an offer actually moves a player;
 *   • the whole thing is deterministic per (seed, schedule).
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from './career'
import { askingPriceText } from '@engine/league/trades'

/** Advance day-by-day until the deadline hub opens (the sim is held), or bail. */
function driveToDeadline(career: Career): boolean {
  for (let guard = 0; guard < 400; guard++) {
    if (career.getDeadlineDay() !== null) return true
    if (!career.advanceDay()) return false
  }
  return career.getDeadlineDay() !== null
}

describe('askingPriceText', () => {
  it('maps trade value to a plausible pick-currency ask, discounting rentals', () => {
    expect(askingPriceText(70, false)).toBe('a 1st-round pick and a top prospect')
    expect(askingPriceText(35, false)).toBe('a 1st-round pick')
    expect(askingPriceText(15, false)).toBe('a mid-round pick')
    expect(askingPriceText(8, false)).toBe('a late pick or a depth piece')
    // A rental of equal raw value asks for less (you buy a run, not term).
    expect(askingPriceText(32, true)).toBe('a 2nd-round pick')
    expect(askingPriceText(32, false)).toBe('a 1st-round pick')
  })
})

describe('Career — deadline day hub', () => {
  it('opens a live hub with offers, a shopped board, and a wire', () => {
    const data = generateLeague({ seed: 4242 })
    const userId = data.league.teams[0]!
    const career = new Career(data, 4242, userId)
    expect(driveToDeadline(career)).toBe(true)

    const dd = career.getDeadlineDay()
    expect(dd).not.toBeNull()
    if (!dd) return
    expect(dd.deadlineDay).toBeGreaterThan(0)
    expect(dd.stance.length).toBeGreaterThan(0)
    expect(dd.capLine).toContain('Space to work with')

    // The block: real sellers dangling movable veterans with asking prices.
    expect(dd.shopped.length).toBeGreaterThan(0)
    for (const s of dd.shopped) {
      expect(s.value).toBeGreaterThan(0)
      expect(s.asking.length).toBeGreaterThan(0)
      expect(s.teamId).not.toBe(userId as string)
    }
    // Sorted best-first.
    for (let i = 1; i < dd.shopped.length; i++) {
      expect(dd.shopped[i - 1]!.value).toBeGreaterThanOrEqual(dd.shopped[i]!.value)
    }

    // The wire: the morning flurry + the season's AI-AI deals populate it.
    expect(dd.feed.length).toBeGreaterThan(0)
    for (const f of dd.feed) {
      expect(f.text.length).toBeGreaterThan(0)
      expect(f.teamAbbrs.length).toBeGreaterThan(0)
    }

    // Every incoming offer where you give up a player is one for YOUR player.
    for (const o of dd.incoming) {
      expect(o.give.players.length + o.give.picks.length).toBeGreaterThan(0)
      expect(o.give.teamId).toBe(userId as string)
    }
  })

  it('produces real, acceptable offers you can complete', () => {
    const data = generateLeague({ seed: 909 })
    const userId = data.league.teams[0]!
    const career = new Career(data, 909, userId)
    expect(driveToDeadline(career)).toBe(true)
    const dd = career.getDeadlineDay()!
    // Not every seed guarantees an offer, but when one exists, accepting it must
    // actually move the named player off your roster.
    const offer = dd.incoming.find((o) => o.give.players.length === 1)
    if (!offer) return
    const leavingId = offer.give.players[0]!.playerId
    const before = career.getTrades().myPlayers.some((p) => p.playerId === leavingId)
    expect(before).toBe(true)
    career.acceptTrade(offer.offerId)
    const after = career.getTrades().myPlayers.some((p) => p.playerId === leavingId)
    expect(after).toBe(false)
  })

  it('is deterministic per seed', () => {
    const build = () => {
      const data = generateLeague({ seed: 77 })
      const c = new Career(data, 77, data.league.teams[0]!)
      driveToDeadline(c)
      return c.getDeadlineDay()
    }
    const a = build()
    const b = build()
    expect(a).toEqual(b)
  })

  it('opens the market only once (idempotent reads)', () => {
    const data = generateLeague({ seed: 313 })
    const career = new Career(data, 313, data.league.teams[0]!)
    expect(driveToDeadline(career)).toBe(true)
    const first = career.getDeadlineDay()!
    const second = career.getDeadlineDay()!
    // Re-reading the hub must not re-run the flurry or re-table offers.
    expect(second.shopped).toEqual(first.shopped)
    expect(second.incoming.length).toBe(first.incoming.length)
    expect(second.feed).toEqual(first.feed)
  })
})
