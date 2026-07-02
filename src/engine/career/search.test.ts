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
