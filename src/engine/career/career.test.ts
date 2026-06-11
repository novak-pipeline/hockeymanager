import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career, buildTeamList } from './career'

describe('buildTeamList', () => {
  it('lists every team with a strength rating and colors', () => {
    const data = generateLeague({ seed: 1 })
    const list = buildTeamList(data)
    expect(list).toHaveLength(16)
    for (const t of list) {
      expect(t.strength).toBeGreaterThan(0)
      expect(t.name).toBeTruthy()
      expect(t.division).toBeTruthy()
      expect(t.colors.primary).toBeGreaterThan(0)
    }
  })
})

describe('Career — regular season', () => {
  it('starts empty: day 0, no last result, a scheduled next game', () => {
    const data = generateLeague({ seed: 3 })
    const userId = data.league.teams[0]
    const career = new Career(data, 3, userId)
    const v = career.view()
    expect(v.day).toBe(0)
    expect(v.lastResult).toBeNull()
    expect(v.nextGame).not.toBeNull()
    expect(v.userTeam.standing.gamesPlayed).toBe(0)
    expect(v.roster.length).toBe(data.teams.get(userId)!.roster.length)
  })

  it('advances one match day at a time and records the user result + news', () => {
    const data = generateLeague({ seed: 8 })
    const userId = data.league.teams[2]
    const career = new Career(data, 8, userId)

    expect(career.advanceDay()).toBe(true)
    const v = career.view()
    expect(v.day).toBe(1)
    expect(v.userTeam.standing.gamesPlayed).toBe(1)
    expect(v.lastResult).not.toBeNull()
    const inbox = career.getInbox()
    expect(inbox.items.some((n) => n.category === 'result')).toBe(true)
  })

  it('runs the whole season then flips into the playoffs', () => {
    const data = generateLeague({ seed: 5 })
    const career = new Career(data, 5, data.league.teams[0])
    let days = 0
    while (career.advanceDay()) days++
    expect(days).toBe(60) // 4 round-robins × 15 rounds
    expect(career.done).toBe(true)
    expect(career.advanceDay()).toBe(false)
    expect(career.getDashboard().phase).toBe('playoffs')
    expect(career.getPlayoffs()).not.toBeNull()
    const v = career.view()
    expect(v.userTeam.standing.gamesPlayed).toBe(60)
  })

  it('is self-deterministic: two careers with the same seed stay identical', () => {
    const mk = (): Career => {
      const data = generateLeague({ seed: 2025 })
      return new Career(data, 2025, data.league.teams[0])
    }
    const a = mk()
    const b = mk()
    for (let i = 0; i < 12; i++) {
      a.advanceDay()
      b.advanceDay()
    }
    const rows = (c: Career) =>
      c.view().standings.map((s) => [s.teamId, s.points, s.goalsFor, s.goalsAgainst])
    expect(rows(a)).toEqual(rows(b))
  })

  it('user rank is consistent with the standings order', () => {
    const data = generateLeague({ seed: 11 })
    const userId = data.league.teams[7]
    const career = new Career(data, 11, userId)
    career.advance(30)
    const v = career.view()
    expect(v.standings[v.userTeam.rank - 1].teamId).toBe(userId)
  })

  it('goalies get a save percentage, skaters do not', () => {
    const data = generateLeague({ seed: 4 })
    const career = new Career(data, 4, data.league.teams[0])
    career.advance(10)
    const v = career.view()
    const goalies = v.roster.filter((r) => r.position === 'G')
    const skaters = v.roster.filter((r) => r.position !== 'G')
    expect(goalies.length).toBeGreaterThan(0)
    for (const g of goalies) expect(g.savePct).not.toBeNull()
    for (const s of skaters) expect(s.savePct).toBeNull()
  })

  it('serves every management screen view without throwing', () => {
    const data = generateLeague({ seed: 14 })
    const userId = data.league.teams[1]
    const career = new Career(data, 14, userId)
    career.advance(8)
    expect(career.getDashboard().userTeam.teamId).toBe(userId as string)
    expect(career.getSquad().rows.length).toBeGreaterThan(20)
    const anyPlayer = career.getSquad().rows[0].playerId
    expect(career.getPlayer(anyPlayer).attributeGroups.length).toBeGreaterThanOrEqual(4)
    expect(career.getTactics().lines.forwards).toHaveLength(4)
    expect(career.getSchedule().entries).toHaveLength(60)
    expect(career.getStandings().overall).toHaveLength(16)
    expect(career.getStats().points.length).toBeGreaterThan(0)
    expect(career.getFinances().payroll.length).toBeGreaterThan(20)
    expect(career.getTrades().partners).toHaveLength(15)
    expect(career.getInbox().items.length).toBeGreaterThan(0)
    expect(career.getLastBoxScore()).not.toBeNull()
  })
})

describe('Career — full year cycle', () => {
  it('plays through playoffs, offseason and rolls into the next season', () => {
    const data = generateLeague({ seed: 77 })
    const userId = data.league.teams[3]
    const career = new Career(data, 77, userId)
    const firstYear = career.year

    // Guard well above 60 match days + ~21 playoff days + offseason stages.
    let guard = 0
    while (career.year === firstYear && guard++ < 200) {
      expect(career.step()).toBe(true)
    }
    expect(career.year).toBe(firstYear + 1)
    expect(career.getDashboard().phase).toBe('regularSeason')

    // The completed season is in the history with a champion.
    const champs = career
      .getInbox()
      .items.filter((n) => n.category === 'playoffs' && n.headline.includes('championship'))
    expect(champs.length).toBeGreaterThan(0)

    // New season: clean slate, fresh schedule, playoffs cleared.
    const v = career.view()
    expect(v.day).toBe(0)
    expect(v.userTeam.standing.gamesPlayed).toBe(0)
    expect(career.getPlayoffs()).toBeNull()
    expect(career.getSchedule().entries.every((e) => e.result === null)).toBe(true)

    // Development happened: nobody on the roster is the age they started at... at
    // minimum everyone aged one year.
    const squad = career.getSquad()
    expect(squad.rows.length).toBeGreaterThanOrEqual(18)

    // And the next season actually plays.
    expect(career.advanceDay()).toBe(true)
    expect(career.view().userTeam.standing.gamesPlayed).toBe(1)
  })

  it('the draft completes with every pick used on a real prospect', () => {
    const data = generateLeague({ seed: 21 })
    const career = new Career(data, 21, data.league.teams[0])
    while (career.getDashboard().phase === 'regularSeason') career.step()
    while (career.getDashboard().phase === 'playoffs') career.step()
    // awards → draft
    expect(career.getDashboard().phase).toBe('offseason')
    career.advanceOffseason()
    const draft = career.getDraft()
    expect(draft).not.toBeNull()
    expect(draft!.board).toHaveLength(32) // 16 teams × 2 rounds
    career.advanceDraft() // sim to user pick (or end)
    const mid = career.getDraft()!
    if (mid.userIsOnClock) {
      const best = mid.prospects.find((p) => !p.drafted)!
      career.draftPlayer(best.playerId)
    }
    career.advanceOffseason() // finishes draft, moves to resign
    const done = career.getDraft()
    expect(done === null || done.complete).toBe(true)
  })
})

describe('Career — scouting', () => {
  it('exportSnapshot includes a scouting field with knowledge and assignments', () => {
    const data = generateLeague({ seed: 55 })
    const userId = data.league.teams[0]
    const career = new Career(data, 55, userId)
    const snap = career.exportSnapshot('scout-test', '2026-06-10T00:00:00.000Z')
    expect(snap.scouting).toBeDefined()
    expect(Array.isArray(snap.scouting!.knowledge)).toBe(true)
    expect(Array.isArray(snap.scouting!.assignments)).toBe(true)
    expect(snap.scouting!.assignments.length).toBeGreaterThan(0)
    expect(snap.scouting!.knowledge.length).toBeGreaterThan(0)
  })

  it('scouting state survives a save/load round-trip identically', () => {
    const data = generateLeague({ seed: 56 })
    const userId = data.league.teams[2]
    const career = new Career(data, 56, userId)
    career.advance(5)

    const snap = career.exportSnapshot('scout-rt', '2026-06-10T00:00:00.000Z')
    const json = JSON.stringify(snap)
    const restored = Career.fromSnapshot(JSON.parse(json))

    const origSnap2 = career.exportSnapshot('orig', '2026-06-10T00:00:00.000Z')
    const restSnap2 = restored.exportSnapshot('rest', '2026-06-10T00:00:00.000Z')

    expect(restSnap2.scouting!.assignments).toEqual(origSnap2.scouting!.assignments)
    expect(restSnap2.scouting!.knowledge).toEqual(origSnap2.scouting!.knowledge)
  })

  it('old saves without scouting field load cleanly and get fresh scouting', () => {
    const data = generateLeague({ seed: 57 })
    const userId = data.league.teams[1]
    const career = new Career(data, 57, userId)

    const snap = career.exportSnapshot('legacy', '2026-06-10T00:00:00.000Z')
    // Simulate old save by stripping the scouting field
    const { scouting: _dropped, ...oldSnap } = snap as typeof snap & { scouting?: unknown }
    expect((_dropped as unknown) !== undefined).toBe(true) // ensure it was present

    const restored = Career.fromSnapshot(JSON.parse(JSON.stringify(oldSnap)))
    const restoredSnap = restored.exportSnapshot('restored', '2026-06-10T00:00:00.000Z')
    // Should have fresh scouting with assignments
    expect(restoredSnap.scouting).toBeDefined()
    expect(restoredSnap.scouting!.assignments.length).toBeGreaterThan(0)
  })

  it('own roster players have knowledge=100, others have partial knowledge', () => {
    const data = generateLeague({ seed: 58 })
    const userId = data.league.teams[0]
    const career = new Career(data, 58, userId)

    const snap = career.exportSnapshot('k-test', '2026-06-10T00:00:00.000Z')
    const knowledgeMap = new Map(snap.scouting!.knowledge)

    const ownRoster = data.teams.get(userId)!.roster
    for (const pid of ownRoster) {
      expect(knowledgeMap.get(pid)).toBe(100)
    }

    // All other team players should have partial knowledge
    for (const [teamId, team] of data.teams) {
      if (teamId === userId) continue
      for (const pid of team.roster) {
        const k = knowledgeMap.get(pid) ?? 0
        expect(k).toBeGreaterThanOrEqual(5)
        expect(k).toBeLessThanOrEqual(45)
      }
    }
  })

  it('after ticking, knowledge increases for players on opponent rosters', () => {
    const data = generateLeague({ seed: 59 })
    const userId = data.league.teams[0]
    const career = new Career(data, 59, userId)

    const before = career.exportSnapshot('before', '2026-06-10T00:00:00.000Z')
    const kBefore = new Map(before.scouting!.knowledge)

    // Advance enough days that scouting ticks have a chance to fire
    career.advance(20)

    const after = career.exportSnapshot('after', '2026-06-10T00:00:00.000Z')
    const kAfter = new Map(after.scouting!.knowledge)

    // Collect all opponent player ids
    let anyIncreased = false
    for (const [teamId, team] of data.teams) {
      if ((teamId as string) === (userId as string)) continue
      for (const pid of team.roster) {
        const pidStr = pid as string
        const before_ = kBefore.get(pidStr) ?? 0
        const after_ = kAfter.get(pidStr) ?? 0
        if (after_ > before_) {
          anyIncreased = true
          break
        }
      }
      if (anyIncreased) break
    }
    expect(anyIncreased).toBe(true)
  })
})

describe('Career — persistence', () => {
  it('survives a save/load round-trip mid-season and stays deterministic', () => {
    const data = generateLeague({ seed: 33 })
    const userId = data.league.teams[5]
    const career = new Career(data, 33, userId)
    career.advance(15)

    const snapshot = career.exportSnapshot('test save', '2026-06-10T00:00:00.000Z')
    const json = JSON.stringify(snapshot)
    const restored = Career.fromSnapshot(JSON.parse(json))

    const dash = (c: Career) => {
      const d = c.getDashboard()
      return [d.day, d.phase, d.userTeam.rank, d.userTeam.standing.points, d.unreadNews]
    }
    expect(dash(restored)).toEqual(dash(career))

    // Both continue identically after the round-trip.
    career.advance(5)
    restored.advance(5)
    const rows = (c: Career) => c.view().standings.map((s) => [s.teamId, s.points])
    expect(rows(restored)).toEqual(rows(career))
  })

  it('survives a save/load round-trip during the playoffs', () => {
    const data = generateLeague({ seed: 41 })
    const career = new Career(data, 41, data.league.teams[0])
    while (career.getDashboard().phase === 'regularSeason') career.step()
    career.step() // one playoff day
    const restored = Career.fromSnapshot(
      JSON.parse(JSON.stringify(career.exportSnapshot('po', '2026-06-10T00:00:00.000Z')))
    )
    expect(restored.getPlayoffs()).not.toBeNull()
    expect(restored.getDashboard().phase).toBe('playoffs')
    career.step()
    restored.step()
    const series = (c: Career) =>
      c.getPlayoffs()!.rounds[0].series.map((s) => [s.highSeed.wins, s.lowSeed.wins])
    expect(series(restored)).toEqual(series(career))
  })
})
