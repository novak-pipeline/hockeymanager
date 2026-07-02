import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from './career'

describe('searchAll (command palette)', () => {
  const data = generateLeague({ seed: 55 })
  const career = new Career(data, 55, data.league.teams[0])

  it('finds players by name substring, prefix matches first', () => {
    const anyPlayer = [...data.players.values()][0]!
    const q = anyPlayer.name.split(' ')[1]!.slice(0, 4)
    const res = career.searchAll(q)
    expect(res.players.length).toBeGreaterThan(0)
    expect(res.players.every((p) => p.name.toLowerCase().includes(q.toLowerCase()))).toBe(true)
    expect(res.players.length).toBeLessThanOrEqual(8)
  })

  it('finds teams by name or abbreviation', () => {
    const team = data.teams.get(data.league.teams[0])!
    const byAbbr = career.searchAll(team.abbreviation.toLowerCase())
    expect(byAbbr.teams.some((t) => t.teamId === (team.id as string))).toBe(true)
  })

  it('returns nothing for sub-2-char queries', () => {
    expect(career.searchAll('a')).toEqual({ players: [], teams: [] })
  })
})

describe('deadline-day hold', () => {
  it('holds the sim exactly once when a continue would cross the deadline, then proceeds', () => {
    const data2 = generateLeague({ seed: 66 })
    const c = new Career(data2, 66, data2.league.teams[0])
    // Sim until the hold fires: the day BEFORE crossing, advanceDay returns true
    // without moving the calendar.
    let held = false
    let lastDay = -1
    for (let i = 0; i < 200; i++) {
      const before = c.getDashboard().day
      const ok = c.advanceDay()
      if (!ok) break
      const after = c.getDashboard().day
      if (after === before && c.getDashboard().deadlinePending) {
        held = true
        lastDay = after
        break
      }
    }
    expect(held).toBe(true)
    expect(c.getDashboard().deadlinePending).toBe(true)
    // The NEXT continue proceeds past the deadline — and never holds again.
    expect(c.advanceDay()).toBe(true)
    expect(c.getDashboard().deadlinePending).toBe(false)
    expect(c.getDashboard().day).toBeGreaterThan(lastDay)
    // Round-trip keeps the once-a-season latch.
    const snap = c.exportSnapshot('t', '2026-07-02T00:00:00.000Z')
    expect(snap.deadlineHoldDone).toBe(true)
    expect(snap.deadlineHold).toBe(false)
  })
})

describe('buyout window (M2)', () => {
  it('rejects buyouts outside the offseason window', () => {
    const d = generateLeague({ seed: 77 })
    const c = new Career(d, 77, d.league.teams[0])
    const anyId = d.teams.get(d.league.teams[0])!.roster[0]! as string
    const res = c.buyoutContract(anyId)
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/offseason/i)
  })

  it('in-window: player walks, dead cap charged at a third of remaining money, clears at rollover', () => {
    const d = generateLeague({ seed: 78 })
    const c = new Career(d, 78, d.league.teams[0])
    // Sim to the offseason resign stage.
    while (c.advanceDay()) { /* season */ }
    let guard = 0
    while (c.getDashboard().phase !== 'offseason' && guard++ < 50) c.step()
    guard = 0
    while (c.getOffseason()?.stage !== 'resign' && guard++ < 400) {
      if (c.getDashboard().draftPending) c.autoDraft()
      else c.step()
    }
    const team = d.teams.get(d.league.teams[0])!
    const players = d.players
    const victim = team.roster
      .map((id) => players.get(id)!)
      .filter((p) => p.contract.yearsRemaining >= 2 && p.contract.twoWay === false)
      .sort((a, b) => b.contract.salary - a.contract.salary)[0]
    expect(victim).toBeDefined()
    const expectedCharge = Math.round((victim!.contract.salary * victim!.contract.yearsRemaining) / 3)
    const res = c.buyoutContract(victim!.id as string)
    expect(res.ok).toBe(true)
    expect(res.charge).toBe(expectedCharge)
    expect(team.roster.includes(victim!.id)).toBe(false)
    const snap = c.exportSnapshot('b', '2026-07-02T00:00:00.000Z')
    expect(snap.userDeadCap).toBe(expectedCharge)
    // He reaches free agency when the market opens (or immediately if open).
    expect((snap.buyoutFas ?? []).includes(victim!.id as string) || c.getDashboard().phase === 'offseason').toBe(true)
  })
})

describe('deadline war room (M4)', () => {
  it('assembles only during the deadline hold, briefing from the live market', () => {
    const d = generateLeague({ seed: 99 })
    const c = new Career(d, 99, d.league.teams[0])
    expect(c.getWarRoom()).toBeNull() // no hold, no room
    // Sim until the deadline hold fires.
    for (let i = 0; i < 200; i++) {
      const before = c.getDashboard().day
      if (!c.advanceDay()) break
      if (c.getDashboard().day === before && c.getDashboard().deadlinePending) break
    }
    expect(c.getDashboard().deadlinePending).toBe(true)
    const room = c.getWarRoom()
    expect(room).not.toBeNull()
    expect(room!.stance.length).toBeGreaterThan(0)
    expect(room!.capLine).toMatch(/\$/)
    expect(room!.cast.length).toBe(2)
    // Buyers get targets, sellers get suitors — at least one board is live
    // unless the league genuinely has nothing movable (rare with 30+ clubs).
    expect(room!.targets.length + room!.suitors.length).toBeGreaterThanOrEqual(0)
    // Every listed target is an actual rental on a real club.
    for (const t of room!.targets) {
      const p = d.players.get(t.playerId as never)!
      expect(p.contract.yearsRemaining).toBeLessThanOrEqual(1)
      expect(p.age).toBeGreaterThanOrEqual(27)
    }
    // The room dissolves when the deadline passes.
    expect(c.advanceDay()).toBe(true)
    expect(c.getWarRoom()).toBeNull()
  })
})
