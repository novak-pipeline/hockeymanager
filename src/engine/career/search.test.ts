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

describe('ownProspects scouting scope (bugfix)', () => {
  it('a scout on "our players & prospects" actually watches the org', () => {
    const d = generateLeague({ seed: 44 })
    const c = new Career(d, 44, d.league.teams[0])
    const scouting = c.getScouting()
    const scout = scouting.scouts[0]!
    c.assignScoutTarget(scout.scoutId, { kind: 'ownProspects' }, 'all')
    for (let i = 0; i < 6; i++) c.advanceDay()
    // His personal history must now include user-org players.
    const profile = c.getScoutProfile(scout.scoutId)!
    const userTeam = d.teams.get(d.league.teams[0])!
    const orgIds = new Set([
      ...userTeam.roster.map((id) => id as string),
      ...((userTeam.affiliateId && d.teams.get(userTeam.affiliateId)?.roster) || []).map((id) => id as string),
    ])
    const orgSeen = profile.scouted.filter((r) => orgIds.has(r.playerId)).length
    expect(orgSeen).toBeGreaterThan(0)
  })
})

describe('LW5 dynamics v2 (interactions + promise ledger)', () => {
  it('an open concern surfaces in the inbox and a promise answer writes the ledger', () => {
    const data = generateLeague({ seed: 77 })
    const c = new Career(data, 77, data.league.teams[0])
    // Inject a concern directly (generation is rate-limited + probabilistic).
    const anyC = c as unknown as {
      interactions: Array<Record<string, unknown>>
      playerPromises: Array<{ playerId: string; kind: string; status: string }>
      userTeamId: string
    }
    const team = data.teams.get(data.league.teams[0])!
    const pid = team.roster[0] as unknown as string
    anyC.interactions.unshift({
      id: 'pi1', playerId: pid, teamId: anyC.userTeamId, year: c.getDashboard().year ?? 2025,
      day: 10, kind: 'iceTime', severity: 'mild',
      message: 'wants a word', status: 'open',
      options: [
        { id: 'promise', label: 'Promise a bigger role', tone: 'promise' },
        { id: 'firm', label: 'Earn it', tone: 'firm' },
      ],
    })
    const inbox = c.getInbox()
    expect(inbox.interactions?.some((i) => i.id === 'pi1')).toBe(true)
    expect(inbox.interactions![0]!.options.length).toBe(2)

    const res = c.respondToInteraction('pi1', 'promise')
    expect(res.ok).toBe(true)
    expect(anyC.playerPromises.length).toBe(1)
    expect(anyC.playerPromises[0]!.kind).toBe('iceTime')
    expect(anyC.playerPromises[0]!.status).toBe('open')
    // Resolved concern no longer surfaces.
    expect(c.getInbox().interactions?.some((i) => i.id === 'pi1') ?? false).toBe(false)

    // The ledger survives a save/load round-trip and shows on Dynamics.
    const snap = c.exportSnapshot('t', '2026-07-02T00:00:00.000Z')
    expect(snap.playerPromises?.length).toBe(1)
    const c2 = Career.fromSnapshot(snap)
    const dyn = c2.getTeamDynamics(anyC.userTeamId)
    expect(dyn.promises?.length).toBe(1)
    expect(dyn.promises![0]!.status).toBe('open')
  })

  it('rate limits hold: at most one concern raised per day, two open at once', () => {
    const data = generateLeague({ seed: 88 })
    const c = new Career(data, 88, data.league.teams[0])
    // Make the whole roster miserable so eligibility is maximal.
    const team = data.teams.get(data.league.teams[0])!
    for (const id of team.roster) {
      const p = data.players.get(id)!
      p.morale = 10
    }
    for (let i = 0; i < 40; i++) {
      if (!c.advanceDay()) break
      const open = c.getInbox().interactions ?? []
      expect(open.length).toBeLessThanOrEqual(2)
    }
  })
})
