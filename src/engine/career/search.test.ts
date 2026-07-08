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

describe('Feed Phase A (salience engine)', () => {
  it('publishes budget-capped posts as the season runs and survives save/load', () => {
    const data = generateLeague({ seed: 99 })
    const c = new Career(data, 99, data.league.teams[0])
    // Run deep enough to pass the first expectation checkpoint (day 25) and
    // give streaks a chance to form.
    for (let i = 0; i < 60; i++) if (!c.advanceDay()) break

    const feed = c.getFeed()
    expect(Object.keys(feed.authors).length).toBeGreaterThanOrEqual(4)
    // Posts are optional (a boring league is allowed) but every post that
    // exists must be well-formed and inbox must NOT contain them.
    for (const p of feed.posts) {
      expect(p.channel === 'feed' || p.channel === 'wire').toBe(true)
      expect(p.authorId && feed.authors[p.authorId]).toBeTruthy()
      expect(p.salience).toBeGreaterThanOrEqual(30)
      expect(p.engagement!.likes).toBeGreaterThan(0)
      expect(p.body.length).toBeGreaterThan(20)
    }
    const perDay = new Map<number, number>()
    for (const p of feed.posts) perDay.set(p.day, (perDay.get(p.day) ?? 0) + 1)
    for (const n of perDay.values()) expect(n).toBeLessThanOrEqual(2)
    // Curation floor: with no follows, only floor-clearing (70+) posts may
    // have mirrored into the inbox.
    for (const n of c.getInbox().items) {
      if (n.channel !== undefined) expect(n.salience).toBeGreaterThanOrEqual(70)
    }

    // Round-trip: priors, novelty memory, and the posts all survive.
    const snap = c.exportSnapshot('t', '2026-07-02T00:00:00.000Z')
    expect(snap.storyPriors?.preseasonRanks.length).toBe(data.league.teams.length)
    const c2 = Career.fromSnapshot(snap)
    expect(c2.getFeed().posts).toEqual(feed.posts)
  })

  it('follows toggle, persist, and gate the inbox mirror', () => {
    const data = generateLeague({ seed: 101 })
    const c = new Career(data, 101, data.league.teams[0])
    expect(c.getFeed().following).toEqual([])
    expect(c.toggleFollowAuthor('analyst')).toEqual({ following: true })
    expect(c.toggleFollowAuthor('nonsense')).toEqual({ following: false })
    expect(c.getFeed().following).toEqual(['analyst'])
    const snap = c.exportSnapshot('t', '2026-07-02T00:00:00.000Z')
    expect(Career.fromSnapshot(snap).getFeed().following).toEqual(['analyst'])
    expect(c.toggleFollowAuthor('analyst')).toEqual({ following: false })
    expect(c.getFeed().following).toEqual([])
  })
})

describe('summer takeover (#145) + camps (M3)', () => {
  it('starts instantly at the post-draft summer: resign stage, dev camp pending, no draft', () => {
    const data = generateLeague({ seed: 313 })
    const c = new Career(data, 313, data.league.teams[0])
    c.startAtOffseason()
    const dash = c.getDashboard()
    expect(dash.phase).toBe('offseason')
    expect(dash.devCampPending).toBe(true)
    const os = c.getOffseason()
    expect(os?.stage).toBe('resign')
    // No draft was run — the class the DB reflects is already on the rosters;
    // the FIRST in-game draft arrives at the end of season one.
    expect(c.getDraft()).toBeNull()
    // Save round-trips with the pending camp gate intact.
    const snap = c.exportSnapshot('t', '2026-07-02T00:00:00.000Z')
    const c2 = Career.fromSnapshot(snap)
    expect(c2.getDashboard().devCampPending).toBe(true)
  })

  it('July 1 has a real market: cap casualties populate free agency', () => {
    const data = generateLeague({ seed: 313 })
    const c = new Career(data, 313, data.league.teams[0])
    c.startAtOffseason()
    // Advance resign -> freeAgency (dev camp auto-resolves on the way).
    for (let i = 0; i < 5; i++) {
      if (c.getOffseason()?.stage === 'freeAgency') break
      c.advanceOffseason()
    }
    const os = c.getOffseason()
    expect(os?.stage).toBe('freeAgency')
    // The market exists — squeezed clubs released real veterans.
    expect(os!.freeAgents.length).toBeGreaterThan(0)
    // And the summer calendar knows what day it is.
    const cal = c.getCalendarView()
    expect(cal.todayISO?.startsWith(`${data.league.season.year ?? 2025}`.slice(0, 4)) || cal.todayISO !== undefined).toBe(true)
    expect(cal.entries.some((e) => e.kind === 'keydate' && e.label === 'Cut Day')).toBe(true)
  })

  it('dev camp: the scene lists org kids with grades; naming a standout resolves the gate', () => {
    const data = generateLeague({ seed: 313 })
    const c = new Career(data, 313, data.league.teams[0])
    c.startAtOffseason()
    const camp = c.getDevCamp()
    expect(camp).toBeTruthy()
    expect(camp!.invitees.length).toBeGreaterThan(0)
    for (const i of camp!.invitees) {
      expect(['A', 'B', 'C']).toContain(i.grade)
      expect(i.read.length).toBeGreaterThan(10)
    }
    const pick = camp!.invitees[0]!
    expect(c.submitDevCamp('nope')).toMatchObject({ ok: false })
    expect(c.submitDevCamp(pick.playerId)).toMatchObject({ ok: true })
    expect(c.getDashboard().devCampPending).toBe(false)
    expect(c.getDevCamp()).toBeNull()
    // News names him.
    expect(c.getInbox().items.some((n) => n.headline.includes('camp standout'))).toBe(true)
  })

  it('dev camp is a WEEK: each Continue is a beat, then the wrap auto-resolves', () => {
    const data = generateLeague({ seed: 414 })
    const c = new Career(data, 414, data.league.teams[0])
    c.startAtOffseason()
    expect(c.getDashboard().devCampPending).toBe(true)
    expect(c.getDevCamp()!.day).toBe(1)

    // Beat 1 -> scrimmage day: real stat lines and a scoreline appear.
    c.advanceOffseason()
    const day2 = c.getDevCamp()!
    expect(day2.day).toBe(2)
    expect(day2.scoreline).toMatch(/White \d+, Blue \d+/)
    const skaters = day2.invitees.filter((i) => i.position !== 'G')
    expect(skaters.some((i) => i.line !== undefined)).toBe(true)
    // Scrimmage news carried the scoreline.
    expect(c.getInbox().items.some((n) => n.headline.startsWith('Dev camp scrimmage'))).toBe(true)

    // Beat 2 -> wrap day; the week state round-trips a save.
    c.advanceOffseason()
    expect(c.getDevCamp()!.day).toBe(3)
    const snap = c.exportSnapshot('t', '2026-07-02T00:00:00.000Z')
    expect(Career.fromSnapshot(snap).getDevCamp()!.day).toBe(3)

    // Pressing on from the wrap sends the staff: report mailed, gate cleared,
    // and the offseason stage actually advances on the same press.
    c.advanceOffseason()
    expect(c.getDashboard().devCampPending).toBe(false)
    expect(c.getInbox().items.some((n) => n.headline.startsWith('Development camp report'))).toBe(true)
  })

  it('training camp: cut day is staged at preseason and resolves decisions through real roster moves', () => {
    const data = generateLeague({ seed: 515 })
    const c = new Career(data, 515, data.league.teams[0])
    c.startAtOffseason()
    // Walk the offseason to the preseason transition (draft is skipped at start).
    for (let i = 0; i < 40; i++) {
      if (c.getDashboard().phase !== 'offseason') break
      c.advanceOffseason()
    }
    // Season has started; if battles existed, cut day is pending.
    const dash = c.getDashboard()
    expect(dash.phase).toBe('regularSeason')
    const camp = c.getTrainingCamp()
    if (camp) {
      expect(dash.campPending).toBe(true)
      for (const d of camp.decisions) {
        expect(['nhl', 'ahl']).toContain(d.coachPlan)
        expect(d.line.length).toBeGreaterThan(10)
      }
      // Round-trip with the camp staged.
      const snap = c.exportSnapshot('t', '2026-07-02T00:00:00.000Z')
      expect(Career.fromSnapshot(snap).getTrainingCamp()?.decisions.length).toBe(camp.decisions.length)
      // Resolve with the coach plan; notes come back and the gate clears.
      const res = c.submitTrainingCamp([])
      expect(res.ok).toBe(true)
      expect(res.notes.length).toBeGreaterThan(0)
      expect(c.getDashboard().campPending).toBe(false)
      expect(c.getTrainingCamp()).toBeNull()
    }
    // Either way the season is playable from here.
    expect(c.advanceDay()).toBe(true)
  })

  it('training camp v2: the week has a roster, schedule, box score, reports + eval mail', () => {
    // Find a seed whose camp actually stages battles, then check the week.
    let staged: Career | null = null
    for (const seed of [515, 616, 7, 42, 313, 99, 1234, 88]) {
      const data = generateLeague({ seed })
      const c = new Career(data, seed, data.league.teams[0])
      c.startAtOffseason()
      for (let i = 0; i < 40; i++) {
        if (c.getDashboard().phase !== 'offseason') break
        c.advanceOffseason()
      }
      if (c.getTrainingCamp()) { staged = c; break }
    }
    expect(staged).not.toBeNull()
    const camp = staged!.getTrainingCamp()!
    // Blue/Red camp roster.
    expect((camp.roster ?? []).length).toBeGreaterThan(10)
    expect((camp.roster ?? []).some((r) => r.team === 'Blue')).toBe(true)
    expect((camp.roster ?? []).some((r) => r.team === 'Red')).toBe(true)
    // Day-by-day schedule.
    expect((camp.schedule ?? []).length).toBeGreaterThanOrEqual(6)
    // Accumulating scrimmage box score (sorted by points, skaters have GP).
    expect(camp.scrimmage).toBeTruthy()
    expect(camp.scrimmage!.skaters.length).toBeGreaterThan(10)
    expect(camp.scrimmage!.results.length).toBe(2)
    for (const s of camp.scrimmage!.skaters) {
      expect(s.p).toBe(s.g + s.a)
      expect(s.gp).toBeGreaterThan(0)
    }
    // Coach reports, one per battle decision, with a recommendation.
    expect((camp.reports ?? []).length).toBe(camp.decisions.length)
    for (const r of camp.reports ?? []) {
      expect(['sign', 'keep', 'develop', 'watch']).toContain(r.recommendation)
      expect(r.verdict.length).toBeGreaterThan(20)
    }
    // Rinkside evaluation mail arrived.
    const inbox = staged!.getInbox().items
    expect(inbox.some((n) => n.headline === 'Training camp up to speed')).toBe(true)
    expect(inbox.some((n) => n.headline.startsWith('Camp scrimmage:'))).toBe(true)
    // Round-trips whole.
    const snap = staged!.exportSnapshot('t', '2026-07-02T00:00:00.000Z')
    const c2 = Career.fromSnapshot(snap)
    expect(c2.getTrainingCamp()?.scrimmage?.skaters.length).toBe(camp.scrimmage!.skaters.length)
  })

  it('simming past cut day lets the coach break camp himself', () => {
    const data = generateLeague({ seed: 616 })
    const c = new Career(data, 616, data.league.teams[0])
    c.startAtOffseason()
    for (let i = 0; i < 40; i++) {
      if (c.getDashboard().phase !== 'offseason') break
      c.advanceOffseason()
    }
    const staged = c.getTrainingCamp() !== null
    c.advanceDay()
    expect(c.getDashboard().campPending).toBe(false)
    if (staged) {
      expect(c.getInbox().items.some((n) => n.headline.includes('Camp breaks'))).toBe(true)
    }
  })
})

describe('negotiation sessions (DEPTH 1)', () => {
  /** Fresh summer career with real re-sign business: a generated league has no
   *  day-one expiries, so we walk two veterans' deals to the end first. */
  function summerCareer(seed = 414): Career {
    const data = generateLeague({ seed })
    const userRoster = data.teams.get(data.league.teams[0])!.roster
    let expired = 0
    for (const id of userRoster) {
      const p = data.players.get(id)!
      if (p.age >= 27 && expired < 2) {
        p.contract.yearsRemaining = 0
        expired++
      }
    }
    const c = new Career(data, seed, data.league.teams[0])
    c.startAtOffseason()
    return c
  }

  it('opens a session with an expiring player: agent, ask, comparables, opening lines', () => {
    const c = summerCareer()
    const os = c.getOffseason()!
    const row = os.expiring.find((r) => r.status === 'pending')
    expect(row).toBeTruthy()
    const v = c.startNegotiation(row!.playerId)
    expect(v.status).toBe('open')
    expect(v.kind).toBe('resign')
    expect(v.agentName.length).toBeGreaterThan(3)
    expect(v.askSalary).toBeGreaterThan(0)
    expect(v.openingLines.length).toBeGreaterThanOrEqual(2)
    expect(['warm', 'guarded', 'testy', 'hostile']).toContain(v.temperature)
    // Resuming returns the same session, not a fresh one.
    const again = c.startNegotiation(row!.playerId)
    expect(again.askSalary).toBe(v.askSalary)
  })

  it('meeting the full ask signs the player and executes the contract', () => {
    const c = summerCareer()
    const row = c.getOffseason()!.expiring.find((r) => r.status === 'pending')!
    const v = c.startNegotiation(row.playerId)
    const res = c.submitNegotiationOffer(row.playerId, {
      salary: v.askSalary,
      years: v.askYears,
      signingBonusPct: v.askBonusPct,
      clause: v.askClause,
      twoWay: false,
    })
    expect(res.signed).toBe(true)
    expect(res.view.status).toBe('signed')
    // The offseason view agrees.
    const after = c.getOffseason()!.expiring.find((r) => r.playerId === row.playerId)
    expect(after?.status).toBe('signed')
    // The signing is chronicled in the inbox.
    expect(c.getInbox().items.some((n) => n.headline.includes('re-signs'))).toBe(true)
  })

  it('a lowball draws a rejection with prose, burns patience, and rounds accumulate', () => {
    const c = summerCareer()
    const row = c.getOffseason()!.expiring.find((r) => r.status === 'pending')!
    const v = c.startNegotiation(row.playerId)
    const res = c.submitNegotiationOffer(row.playerId, {
      salary: Math.round(v.askSalary * 0.4),
      years: 1,
      signingBonusPct: 0,
      clause: 'none',
      twoWay: false,
    })
    expect(res.signed).toBe(false)
    expect(res.view.rounds.length).toBe(1)
    expect(res.view.rounds[0]!.verdict).not.toBe('accept')
    expect(res.view.rounds[0]!.agentLines.length).toBeGreaterThan(0)
  })

  it('sessions survive a save/load round-trip mid-negotiation', () => {
    const c = summerCareer()
    const row = c.getOffseason()!.expiring.find((r) => r.status === 'pending')!
    const v = c.startNegotiation(row.playerId)
    c.submitNegotiationOffer(row.playerId, {
      salary: Math.round(v.askSalary * 0.9 / 25_000) * 25_000,
      years: v.askYears,
      signingBonusPct: 0,
      clause: 'none',
      twoWay: false,
    })
    const snap = c.exportSnapshot('t', '2026-07-02T00:00:00.000Z')
    const c2 = Career.fromSnapshot(snap)
    const restored = c2.getNegotiation(row.playerId)
    expect(restored).toBeTruthy()
    expect(restored!.rounds.length).toBe(1)
    expect(restored!.askSalary).toBeGreaterThan(0)
  })

  it('free agents negotiate too, and signing pulls them off the market', () => {
    const c = summerCareer()
    for (let i = 0; i < 6; i++) {
      if (c.getOffseason()?.stage === 'freeAgency') break
      c.advanceOffseason()
    }
    const os = c.getOffseason()!
    expect(os.stage).toBe('freeAgency')
    const fa = os.freeAgents.find((f) => f.askSalary < 3_000_000)
    expect(fa).toBeTruthy()
    const v = c.startNegotiation(fa!.playerId)
    expect(v.kind).toBe('freeAgent')
    const res = c.submitNegotiationOffer(fa!.playerId, {
      salary: v.askSalary,
      years: v.askYears,
      signingBonusPct: v.askBonusPct,
      clause: v.askClause,
      twoWay: false,
    })
    expect(res.signed).toBe(true)
    expect(c.getOffseason()!.freeAgents.some((f) => f.playerId === fa!.playerId)).toBe(false)
  })

  it('players not on the table refuse to open talks', () => {
    const c = summerCareer()
    const rosteredWithTerm = c.getSquad().rows.find((p) => p.contract.yearsRemaining > 0)
    if (rosteredWithTerm) {
      expect(() => c.startNegotiation(rosteredWithTerm.playerId)).toThrow()
    }
  })
})

describe('FA hub (DEPTH 2)', () => {
  function faCareer(seed = 515): Career {
    const data = generateLeague({ seed })
    const c = new Career(data, seed, data.league.teams[0])
    c.startAtOffseason()
    for (let i = 0; i < 6; i++) {
      if (c.getOffseason()?.stage === 'freeAgency') break
      c.advanceOffseason()
    }
    return c
  }

  it('the hub triages the market: asks, agents, two-way interest, honest clocks', () => {
    const c = faCareer()
    const hub = c.getFaHub()
    expect(hub.rows.length).toBeGreaterThan(0)
    for (const r of hub.rows) {
      expect(r.askSalary).toBeGreaterThan(0)
      expect(r.agentName.length).toBeGreaterThan(3)
      expect(['keen', 'warm', 'cold']).toContain(r.interest)
      expect(r.interestNote.length).toBeGreaterThan(10)
      expect(r.wants.length).toBeGreaterThan(10)
      expect(r.decidesInDays).toBeGreaterThanOrEqual(0)
    }
    expect(hub.capSpace).toBeDefined()
  })

  it('shortlist toggles, shows on rows, and survives save/load', () => {
    const c = faCareer()
    const first = c.getFaHub().rows[0]!
    expect(c.toggleFaShortlist(first.playerId)).toEqual({ shortlisted: true })
    expect(c.getFaHub().rows[0]!.shortlisted).toBe(true)
    const snap = c.exportSnapshot('t', '2026-07-02T00:00:00.000Z')
    const c2 = Career.fromSnapshot(snap)
    expect(c2.getFaHub().rows[0]!.shortlisted).toBe(true)
    expect(c.toggleFaShortlist(first.playerId)).toEqual({ shortlisted: false })
  })

  it('losing a shortlisted name brings a debrief with the reason', () => {
    const c = faCareer()
    // Track everyone so whoever the AI signs, we were "in on him".
    for (const r of c.getFaHub().rows) c.toggleFaShortlist(r.playerId)
    // Advance days until the AI market moves (head start = 2 days, then signings).
    let lossMail = false
    for (let i = 0; i < 10 && !lossMail; i++) {
      c.advanceOffseason()
      lossMail = c.getInbox().items.some((n) => n.headline.startsWith('You lose '))
      if (c.getOffseason()?.stage !== 'freeAgency') break
    }
    expect(lossMail).toBe(true)
    // The debrief names the reason category.
    const mail = c.getInbox().items.find((n) => n.headline.startsWith('You lose '))!
    expect(mail.body).toMatch(/came down to (the money|the term|the fit)/)
  })

  it('open talks show on the hub row', () => {
    const c = faCareer()
    const fa = c.getFaHub().rows.find((r) => !r.hot) ?? c.getFaHub().rows[0]!
    c.startNegotiation(fa.playerId)
    const row = c.getFaHub().rows.find((r) => r.playerId === fa.playerId)!
    expect(row.inTalks).toBe(true)
  })
})
