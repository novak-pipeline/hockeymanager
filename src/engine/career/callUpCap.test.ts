/**
 * Gap #4 — in-season cap compliance on the GM's own recalls.
 *
 * `callUp` used to check only that the AHL club kept its positional minimums.
 * Nothing stopped a GM recalling body after body straight past the 23-man limit
 * and through the salary ceiling, which made both limits decorative in-season.
 *
 * The counterpart matters as much: the emergency-recall pass must STILL be able
 * to eat an overage, because icing a legal lineup outranks the cap sheet. It does
 * its own roster work rather than coming through `callUp`, and the last test here
 * pins that separation — a previous attempt at this area broke a club's ability
 * to dress a goaltender.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { LeagueData } from '@data/generate'
import { Career } from './career'
import { MAX_ROSTER_SIZE } from '@engine/league/contracts'
import type { Team } from '@domain/team'

function setup(): { data: LeagueData; career: Career; nhl: Team; ahl: Team } {
  const data = generateLeague({ seed: 2029 })
  const userId = data.league.teams[3]!
  const career = new Career(data, 2029, userId)
  const nhl = data.teams.get(userId)!
  const ahl = data.teams.get(nhl.affiliateId!)!
  // Stock the farm deeply from other clubs' affiliates. `callUp` also refuses
  // when the AHL side would drop under its positional minimums, and that check
  // runs first — without this padding it, not the cap, is what these tests would
  // actually be exercising.
  for (const otherId of data.league.teams) {
    if (otherId === userId) continue
    const other = data.teams.get(otherId)!
    const farm = other.affiliateId ? data.teams.get(other.affiliateId) : undefined
    if (!farm) continue
    for (const id of farm.roster) if (!ahl.roster.includes(id)) ahl.roster.push(id)
  }
  return { data, career, nhl, ahl }
}

/** Fill the NHL roster to the limit WITHOUT draining the farm we call up from. */
function fillNhlRoster(data: LeagueData, nhl: Team, ahl: Team): void {
  const donors = data.league.teams
    .filter((t) => t !== nhl.id)
    .flatMap((t) => data.teams.get(t)!.roster)
    .filter((id) => !nhl.roster.includes(id) && !ahl.roster.includes(id))
  while (nhl.roster.length < MAX_ROSTER_SIZE && donors.length > 0) nhl.roster.push(donors.shift()!)
}

describe('callUp respects the in-season roster limit and cap', () => {
  it('refuses once the NHL roster is full, and says so', () => {
    const { data, career, nhl, ahl } = setup()
    // Plenty of cap room; the roster limit is the only thing that should bite.
    nhl.finances.salaryCap = 500_000_000
    fillNhlRoster(data, nhl, ahl)

    const target = ahl.roster.find((id) => data.players.get(id)!.position !== 'G')!
    const res = career.callUp(target as string)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toContain('full')
    expect(nhl.roster).not.toContain(target)
  })

  it('refuses a recall that would breach the cap, naming the shortfall', () => {
    const { data, career, nhl, ahl } = setup()
    // Room on the roster, none on the cap.
    while (nhl.roster.length >= MAX_ROSTER_SIZE) ahl.roster.push(nhl.roster.pop()!)
    const target = ahl.roster.find((id) => {
      const p = data.players.get(id)!
      return p.position !== 'G' && p.contract.salary > 0
    })!
    const salary = data.players.get(target)!.contract.salary
    const used = nhl.roster.reduce((s, id) => s + data.players.get(id)!.contract.salary, 0)
    nhl.finances.salaryCap = used + Math.floor(salary / 2) // half the room he needs

    const res = career.callUp(target as string)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toContain('cap room')
    expect(nhl.roster).not.toContain(target)
  })

  it('still allows a recall that fits both limits', () => {
    const { data, career, nhl, ahl } = setup()
    while (nhl.roster.length >= MAX_ROSTER_SIZE) ahl.roster.push(nhl.roster.pop()!)
    nhl.finances.salaryCap = 500_000_000
    const target = ahl.roster.find((id) => data.players.get(id)!.position !== 'G')!
    const res = career.callUp(target as string)
    expect(res.ok).toBe(true)
    expect(nhl.roster).toContain(target)
  })

  it('the emergency pass can still ice a team when the cap says no', () => {
    // The guard above governs DISCRETIONARY recalls only. Strip the NHL club to
    // nothing and pin the cap at zero: the advance-time emergency pass has to
    // rebuild a legal lineup anyway, overage and all. If this ever fails, the
    // cap guard has leaked into the path that keeps clubs playable.
    const { data, career, nhl, ahl } = setup()
    for (const id of [...nhl.roster]) ahl.roster.push(id)
    nhl.roster = []
    nhl.finances.salaryCap = 0

    career.advanceDay()

    const healthySkaters = nhl.roster.filter((id) => data.players.get(id)!.position !== 'G')
    const goalies = nhl.roster.filter((id) => data.players.get(id)!.position === 'G')
    expect(healthySkaters.length).toBeGreaterThan(0)
    expect(goalies.length).toBeGreaterThan(0)
  })
})
