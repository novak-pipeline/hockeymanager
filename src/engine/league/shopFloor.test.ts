/**
 * Gap #8, second cause — the trade market on a weak league.
 *
 * `MIN_SHOP_VALUE` is an absolute bar (8, ≈ a depth NHLer). On the vanilla
 * generated league that sits ABOVE the 90th percentile of player value: median
 * 1.0, p90 7.1, and a typical roster peaking near 2.7. Target selection returned
 * empty on every single call, so the AI never asked about anyone and the market
 * was silent — 0 inbound offers across 90 days.
 *
 * Real GMs still trade in a weak league; they trade its best players. The floor
 * is now the league's own when nobody clears the absolute one, with a
 * replacement-level cutoff so a roster of nobodies still draws no calls.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from '@engine/career/career'
import { playerValue, MIN_SHOP_VALUE } from './trades'

describe('the shop floor adapts to a weak league', () => {
  it('vanilla rosters really are below the absolute floor (the premise)', () => {
    // If this ever stops being true the fallback is untested by the case below,
    // so assert the premise rather than assume it.
    const data = generateLeague({ seed: 2029 })
    const user = data.teams.get(data.league.teams[3]!)!
    const best = Math.max(...user.roster.map((id) => playerValue(data.players.get(id)!)))
    expect(best).toBeLessThan(MIN_SHOP_VALUE)
  })

  it('the phone rings on a vanilla league', () => {
    const data = generateLeague({ seed: 2029 })
    const career = new Career(data, 2029, data.league.teams[3]!)
    const ids = new Set<string>()
    for (let d = 0; d < 90; d++) {
      if (!career.advanceDay()) break
      for (const o of career.getTrades().incoming ?? []) ids.add(o.offerId)
    }
    expect(ids.size).toBeGreaterThan(0)
  })

  it('every inbound offer comes from a club in the league, not the wider world', () => {
    // The calling club is on the `receive` side — the offer view has no
    // `partnerTeamId`, which cost me a wrong assertion before I checked.
    const data = generateLeague({ seed: 2029 })
    const league = new Set(data.league.teams.map((t) => t as string))
    const career = new Career(data, 2029, data.league.teams[3]!)
    let checked = 0
    for (let d = 0; d < 90; d++) {
      if (!career.advanceDay()) break
      for (const o of career.getTrades().incoming ?? []) {
        expect(league.has(o.receive.teamId)).toBe(true)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})
