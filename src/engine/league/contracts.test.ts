import { describe, expect, it } from 'vitest'
import { generateLeague, type LeagueData } from '@data/generate'
import {
  asPlayerId,
  asTeamId,
  type Personality,
  type Player,
  type PlayerId,
  type Position,
  type RawAttributes,
  type Team
} from '@domain'
import { computeComposites, overall } from '@engine/ratings/composites'
import { Rng } from '@engine/shared/rng'
import {
  aiFreeAgencyDay,
  aiResignDay,
  askTerms,
  capSpace,
  capUsedFor,
  contractStatus,
  initialPicks,
  offerAcceptable,
  processExpiries,
  releasePlayer,
  signPlayer
} from './contracts'

/** Raw attributes with every field set to the same value, for control. */
function flat(value: number): RawAttributes {
  return {
    technical: { wristShot: value, slapShot: value, stickhandling: value, passing: value, deflections: value, faceoffs: value },
    physical: { speed: value, acceleration: value, strength: value, balance: value, stamina: value, agility: value, height: value },
    mental: { offensiveIQ: value, defensiveIQ: value, positioning: value, vision: value, aggression: value, composure: value, workRate: value, discipline: value, anticipation: value },
    defensive: { checking: value, shotBlocking: value, stickChecking: value, takeaway: value }
  }
}

/** Synthetic skater at a controlled ability level. */
function mkSkater(
  id: string,
  value: number,
  age: number,
  personality: Partial<Personality> = {}
): Player {
  const position: Position = 'C'
  const raw = flat(value)
  const composites = computeComposites(raw, 'twoWay', position)
  return {
    id: asPlayerId(id),
    name: `Test ${id}`,
    age,
    position,
    handedness: 'L',
    role: 'twoWay',
    ratings: raw,
    potential: raw,
    composites,
    personality: { ambition: 10, professionalism: 10, loyalty: 10, temperament: 10, determination: 10, ...personality },
    contract: { salary: 1_000_000, yearsRemaining: 2, expiryYear: 2028, noTradeClause: false, twoWay: false },
    stats: [],
    fatigue: 0,
    morale: 60,
    injuryStatus: null,
    form: 0
  }
}

const gen = (seed = 7): LeagueData => generateLeague({ seed, teamCount: 4 })

const teamAt = (data: LeagueData, i: number): Team => data.teams.get(data.league.teams[i])!

const rosterPlayers = (data: LeagueData, team: Team): Player[] =>
  team.roster.flatMap((id) => {
    const p = data.players.get(id)
    return p ? [p] : []
  })

const byOverallDesc = (a: Player, b: Player): number =>
  overall(b.composites, b.position) - overall(a.composites, a.position)

describe('capUsedFor / capSpace', () => {
  it('sums roster salaries and matches the generated cache', () => {
    const data = gen()
    const team = teamAt(data, 0)
    const expected = rosterPlayers(data, team).reduce((s, p) => s + p.contract.salary, 0)
    expect(capUsedFor(team, data.players)).toBe(expected)
    expect(capUsedFor(team, data.players)).toBe(team.finances.capUsed)
    expect(capSpace(team, data.players)).toBe(team.finances.salaryCap - expected)
  })
})

describe('askTerms', () => {
  it('prices a 90-overall star far above a 50-overall depth piece', () => {
    const depth = mkSkater('lo', 50, 26)
    const star = mkSkater('hi', 90, 26)
    const askLo = askTerms(depth, 2026)
    const askHi = askTerms(star, 2026)
    expect(askLo.salary).toBeGreaterThanOrEqual(750_000)
    expect(askLo.salary).toBeLessThan(1_500_000)
    expect(askHi.salary).toBeGreaterThan(8_000_000)
    expect(askHi.salary).toBeGreaterThan(askLo.salary * 5)
    for (const ask of [askLo, askHi]) {
      expect(ask.years).toBeGreaterThanOrEqual(1)
      expect(ask.years).toBeLessThanOrEqual(7)
    }
  })

  it('applies a prime-age premium and a veteran discount', () => {
    const young = askTerms(mkSkater('a', 90, 22), 2026)
    const prime = askTerms(mkSkater('a', 90, 26), 2026)
    const vet = askTerms(mkSkater('a', 90, 35), 2026)
    expect(prime.salary).toBeGreaterThan(young.salary)
    expect(vet.salary).toBeLessThan(prime.salary)
  })

  it('shapes years by age: young stars want term, old vets take short deals', () => {
    const youngStar = askTerms(mkSkater('ys', 90, 21), 2026)
    const oldStar = askTerms(mkSkater('os', 90, 35), 2026)
    expect(youngStar.years).toBeGreaterThanOrEqual(6)
    expect(oldStar.years).toBeLessThanOrEqual(3)
  })

  it('is deterministic per (player, year)', () => {
    const p = mkSkater('det', 75, 27)
    expect(askTerms(p, 2026)).toEqual(askTerms(p, 2026))
  })
})

describe('offerAcceptable', () => {
  it('always accepts a full-ask offer', () => {
    const p = mkSkater('p', 70, 26, { ambition: 20, loyalty: 1 })
    const ask = askTerms(p, 2026)
    for (let seed = 1; seed <= 8; seed++) {
      expect(offerAcceptable(p, ask, ask, new Rng(seed))).toBe(true)
    }
  })

  it('always rejects an 80%-salary lowball', () => {
    const p = mkSkater('p', 70, 26, { ambition: 1, loyalty: 20 })
    const ask = askTerms(p, 2026)
    const offer = { salary: Math.round(ask.salary * 0.8), years: ask.years }
    for (let seed = 1; seed <= 8; seed++) {
      expect(offerAcceptable(p, offer, ask, new Rng(seed))).toBe(false)
    }
  })

  it('loyalty settles for a marginal offer that ambition holds out on', () => {
    const loyal = mkSkater('l', 70, 26, { loyalty: 20, ambition: 1 })
    const ambitious = mkSkater('a', 70, 26, { loyalty: 1, ambition: 20 })
    const ask = { salary: 5_000_000, years: 4 }
    const marginal = { salary: Math.round(ask.salary * 0.93), years: ask.years }
    for (let seed = 1; seed <= 8; seed++) {
      expect(offerAcceptable(loyal, marginal, ask, new Rng(seed))).toBe(true)
      expect(offerAcceptable(ambitious, marginal, ask, new Rng(seed))).toBe(false)
    }
  })
})

/**
 * Give a team enough synthetic cap headroom for a test that needs to sign
 * players. generateLeague does NOT enforce the salary cap during roster
 * construction, so generated teams can start over the cap. Tests that exercise
 * signing logic must set a cap relative to the current payroll; tests that
 * exercise the cap-check itself set a tight cap explicitly.
 */
function giveHeadroom(team: Team, players: Map<PlayerId, Player>, extra: number): void {
  team.finances.salaryCap = capUsedFor(team, players) + extra
}

describe('signPlayer', () => {
  it('generated teams may start over the hard cap; capSpace can be negative', () => {
    // This is real: league generation fills rosters by salary curve without
    // enforcing the hard cap. The offseason / FA system must tolerate negative
    // cap space (teams shed contracts during the offseason). This test
    // documents that contract.ts never silently hides the overage.
    const data = gen()
    // Check all four teams — at least one will be over the cap with seed 7.
    const overCap = data.league.teams.some((id) => {
      const t = data.teams.get(id)!
      return capSpace(t, data.players) < 0
    })
    expect(overCap).toBe(true)
    // capSpace returns the raw value; it is the caller's responsibility to act
    // on a negative number (e.g. refuse new signings, trigger buyouts).
    const team = teamAt(data, 0)
    const space = capSpace(team, data.players)
    expect(typeof space).toBe('number')
    // capUsed is the true sum of roster salaries regardless of the cap ceiling.
    expect(capUsedFor(team, data.players)).toBe(team.finances.capUsed)
  })

  it('adds a free agent to the roster, sets the contract, updates capUsed', () => {
    const data = gen()
    const team = teamAt(data, 0)
    // Give the team enough room to sign the 2M player regardless of how the
    // random salary generator filled the roster (generated teams may start over
    // the cap, so we set a cap relative to the actual current payroll).
    giveHeadroom(team, data.players, 5_000_000)
    const before = capUsedFor(team, data.players)
    const p = mkSkater('x1', 60, 26)
    data.players.set(p.id, p)

    signPlayer({ team, player: p, salary: 2_000_000, years: 3, year: 2026, players: data.players })

    expect(team.roster).toContain(p.id)
    expect(p.contract).toEqual({
      salary: 2_000_000,
      yearsRemaining: 3,
      expiryYear: 2029,
      noTradeClause: false,
      twoWay: false
    })
    expect(team.finances.capUsed).toBe(before + 2_000_000)
    expect(team.finances.capUsed).toBe(capUsedFor(team, data.players))
  })

  it('marks sub-1.1M contracts as two-way', () => {
    const data = gen()
    const team = teamAt(data, 0)
    giveHeadroom(team, data.players, 2_000_000)
    const p = mkSkater('x2', 45, 22)
    data.players.set(p.id, p)
    signPlayer({ team, player: p, salary: 900_000, years: 1, year: 2026, players: data.players })
    expect(p.contract.twoWay).toBe(true)
  })

  it('replaces the old cap hit when re-signing a rostered player', () => {
    const data = gen()
    const team = teamAt(data, 0)
    // Need room for the +500K raise on the existing contract.
    giveHeadroom(team, data.players, 1_000_000)
    const p = data.players.get(team.roster[0])!
    const before = capUsedFor(team, data.players)
    const rosterSize = team.roster.length

    signPlayer({
      team,
      player: p,
      salary: p.contract.salary + 500_000,
      years: 2,
      year: 2026,
      players: data.players
    })

    expect(team.roster.length).toBe(rosterSize)
    expect(team.finances.capUsed).toBe(before + 500_000)
  })

  it('throws when the deal would exceed the cap', () => {
    const data = gen()
    const team = teamAt(data, 0)
    team.finances.salaryCap = capUsedFor(team, data.players) + 1_000_000
    const p = mkSkater('x3', 60, 26)
    data.players.set(p.id, p)
    expect(() =>
      signPlayer({ team, player: p, salary: 2_000_000, years: 2, year: 2026, players: data.players })
    ).toThrow(/cap/)
  })

  it('throws when the roster would exceed 26', () => {
    const data = gen()
    const team = teamAt(data, 0)
    // Generated roster is 23 (14F + 7D + 2G). Adding 3 fill players reaches 26.
    // Give enough room for those 3 × 800K = 2.4M so the roster-full check (not
    // the cap check) fires when we try the 27th player.
    giveHeadroom(team, data.players, 5_000_000)
    for (let i = 0; i < 3; i++) {
      const p = mkSkater(`fill${i}`, 40, 22)
      data.players.set(p.id, p)
      signPlayer({ team, player: p, salary: 800_000, years: 1, year: 2026, players: data.players })
    }
    expect(team.roster.length).toBe(26)
    const extra = mkSkater('x4', 40, 22)
    data.players.set(extra.id, extra)
    expect(() =>
      signPlayer({ team, player: extra, salary: 800_000, years: 1, year: 2026, players: data.players })
    ).toThrow(/roster/)
  })
})

describe('releasePlayer', () => {
  it('removes the player and the cap hit but leaves lines alone', () => {
    const data = gen()
    const team = teamAt(data, 0)
    const p = data.players.get(team.roster[0])!
    const before = capUsedFor(team, data.players)
    const linesBefore = JSON.stringify(team.lines)

    releasePlayer({ team, playerId: p.id, players: data.players })

    expect(team.roster).not.toContain(p.id)
    expect(team.finances.capUsed).toBe(before - p.contract.salary)
    expect(JSON.stringify(team.lines)).toBe(linesBefore)
  })
})

describe('processExpiries', () => {
  it('moves yearsRemaining-0 players off rosters and recomputes the cap', () => {
    const data = gen()
    const teamA = teamAt(data, 1)
    const teamB = teamAt(data, 2)
    const a = data.players.get(teamA.roster[0])!
    const b = data.players.get(teamB.roster[3])!
    a.contract.yearsRemaining = 0
    b.contract.yearsRemaining = 0
    const survivor = data.players.get(teamA.roster[1])!
    const survivorYears = survivor.contract.yearsRemaining

    const { expired } = processExpiries({ teams: data.teams, players: data.players, year: 2026 })

    expect(expired).toContainEqual({ playerId: a.id, teamId: teamA.id })
    expect(expired).toContainEqual({ playerId: b.id, teamId: teamB.id })
    expect(expired).toHaveLength(2)
    expect(teamA.roster).not.toContain(a.id)
    expect(teamB.roster).not.toContain(b.id)
    expect(teamA.finances.capUsed).toBe(capUsedFor(teamA, data.players))
    // No decrement happens here — that is the career layer's season-rollover job.
    expect(survivor.contract.yearsRemaining).toBe(survivorYears)
  })
})

describe('aiResignDay', () => {
  it('re-signs an AI club\'s expiring keeper at the ask', () => {
    const data = gen()
    const userTeamId = data.league.teams[0]
    const team = teamAt(data, 1)
    const top = rosterPlayers(data, team).sort(byOverallDesc)[0]
    expect(overall(top.composites, top.position)).toBeGreaterThanOrEqual(55)
    top.contract.yearsRemaining = 0
    const ask = askTerms(top, 2026)

    const { signings } = aiResignDay({
      teams: data.teams,
      players: data.players,
      userTeamId,
      year: 2026,
      rng: new Rng(5)
    })

    expect(signings).toContainEqual({
      playerId: top.id,
      teamId: team.id,
      salary: ask.salary,
      years: ask.years
    })
    expect(top.contract.yearsRemaining).toBe(ask.years)
    expect(top.contract.expiryYear).toBe(2026 + ask.years)
    expect(team.roster).toContain(top.id)
  })

  it('never re-signs for the user club', () => {
    const data = gen()
    const userTeamId = data.league.teams[0]
    const userTeam = teamAt(data, 0)
    const top = rosterPlayers(data, userTeam).sort(byOverallDesc)[0]
    top.contract.yearsRemaining = 0

    const { signings } = aiResignDay({
      teams: data.teams,
      players: data.players,
      userTeamId,
      year: 2026,
      rng: new Rng(5)
    })

    expect(signings.find((s) => s.playerId === top.id)).toBeUndefined()
    expect(top.contract.yearsRemaining).toBe(0)
  })

  it('lets a keeper walk when the new deal does not fit under the cap', () => {
    const data = gen()
    const userTeamId = data.league.teams[0]
    const team = teamAt(data, 1)
    const top = rosterPlayers(data, team).sort(byOverallDesc)[0]
    top.contract.yearsRemaining = 0
    const ask = askTerms(top, 2026)
    team.finances.salaryCap = capUsedFor(team, data.players) - top.contract.salary + ask.salary - 1

    const { signings } = aiResignDay({
      teams: data.teams,
      players: data.players,
      userTeamId,
      year: 2026,
      rng: new Rng(5)
    })

    expect(signings.find((s) => s.playerId === top.id)).toBeUndefined()
    expect(top.contract.yearsRemaining).toBe(0)
  })
})

describe('contractStatus', () => {
  it('classifies by age and pro service (ELC / RFA / UFA)', () => {
    expect(contractStatus(mkSkater('a', 60, 21))).toBe('ELC') // young, no pro record
    expect(contractStatus(mkSkater('b', 60, 25))).toBe('RFA') // under 27
    expect(contractStatus(mkSkater('c', 60, 28))).toBe('UFA') // 27+
    // 7+ pro seasons makes a sub-27 player a UFA on service.
    const veteranYoung = mkSkater('d', 60, 25)
    ;(veteranYoung as unknown as { stats: unknown[] }).stats = new Array(8).fill({})
    expect(contractStatus(veteranYoung)).toBe('UFA')
  })
})

describe('aiResignDay — restricted free agents', () => {
  it('retains an expiring RFA the club would otherwise let walk as a UFA', () => {
    const data = gen()
    const userTeamId = data.league.teams[0]
    const team = teamAt(data, 1)
    team.finances.salaryCap = capUsedFor(team, data.players) + 10_000_000 // headroom

    // ovr ~52: below the UFA keeper bar (55) and not in the young-keeper branch
    // (age > 23), so as a UFA he'd walk — but as a 25-year-old he's an RFA.
    const rfa = mkSkater('rfa-keep', 52, 25)
    rfa.contract.yearsRemaining = 0
    expect(contractStatus(rfa)).toBe('RFA')
    team.roster.push(rfa.id)
    data.players.set(rfa.id, rfa)

    aiResignDay({ teams: data.teams, players: data.players, userTeamId, year: 2026, rng: new Rng(5) })

    expect(rfa.contract.yearsRemaining).toBeGreaterThan(0)
    expect(team.roster).toContain(rfa.id)
  })

  it('still lets a comparable UFA walk', () => {
    const data = gen()
    const userTeamId = data.league.teams[0]
    const team = teamAt(data, 1)
    team.finances.salaryCap = capUsedFor(team, data.players) + 10_000_000

    const ufa = mkSkater('ufa-walk', 52, 30) // same ovr, but 30 → UFA, not a keeper
    ufa.contract.yearsRemaining = 0
    expect(contractStatus(ufa)).toBe('UFA')
    team.roster.push(ufa.id)
    data.players.set(ufa.id, ufa)

    aiResignDay({ teams: data.teams, players: data.players, userTeamId, year: 2026, rng: new Rng(5) })

    expect(ufa.contract.yearsRemaining).toBe(0)
  })
})

describe('aiFreeAgencyDay', () => {
  it('fills a positional hole: the only team missing a goalie signs the FA goalie', () => {
    const data = gen()
    const userTeamId = data.league.teams[0]
    const team = teamAt(data, 1)
    const backup = rosterPlayers(data, team)
      .filter((p) => p.position === 'G')
      .sort(byOverallDesc)[1]
    releasePlayer({ team, playerId: backup.id, players: data.players })

    const { signings } = aiFreeAgencyDay({
      teams: data.teams,
      players: data.players,
      freeAgentIds: [backup.id],
      userTeamId,
      year: 2026,
      rng: new Rng(9),
      faDay: 1
    })

    expect(signings).toHaveLength(1)
    expect(signings[0].playerId).toBe(backup.id)
    expect(signings[0].teamId).toBe(team.id)
    expect(team.roster).toContain(backup.id)
    expect(team.finances.capUsed).toBe(capUsedFor(team, data.players))
    expect(team.finances.capUsed).toBeLessThanOrEqual(team.finances.salaryCap)
  })

  it('signs nobody when the needing club has no cap space', () => {
    const data = gen()
    const userTeamId = data.league.teams[0]
    const team = teamAt(data, 1)
    const backup = rosterPlayers(data, team)
      .filter((p) => p.position === 'G')
      .sort(byOverallDesc)[1]
    releasePlayer({ team, playerId: backup.id, players: data.players })
    team.finances.salaryCap = capUsedFor(team, data.players) + 100

    const { signings } = aiFreeAgencyDay({
      teams: data.teams,
      players: data.players,
      freeAgentIds: [backup.id],
      userTeamId,
      year: 2026,
      rng: new Rng(9),
      faDay: 1
    })

    expect(signings).toHaveLength(0)
    expect(team.roster).not.toContain(backup.id)
  })

  it('signs better players earlier and only to clubs with a deficit', () => {
    const data = gen()
    const userTeamId = data.league.teams[0]
    const t1 = teamAt(data, 1)
    const t2 = teamAt(data, 2)
    // Open four forward slots: two on t1, two on t2.
    for (const team of [t1, t2]) {
      const fwds = rosterPlayers(data, team)
        .filter((p) => p.position !== 'D' && p.position !== 'G')
        .sort(byOverallDesc)
      releasePlayer({ team, playerId: fwds[fwds.length - 1].id, players: data.players })
      releasePlayer({ team, playerId: fwds[fwds.length - 2].id, players: data.players })
    }
    const pool = [88, 82, 76, 70, 64].map((v, i) => {
      const p = mkSkater(`fa${i + 1}`, v, 26)
      data.players.set(p.id, p)
      return p.id
    })

    const day1 = aiFreeAgencyDay({
      teams: data.teams,
      players: data.players,
      freeAgentIds: pool,
      userTeamId,
      year: 2026,
      rng: new Rng(21),
      faDay: 1
    })

    // Three decisions per day: the three best names come off the board first,
    // even though four forward slots are open league-wide.
    expect(day1.signings.map((s) => s.playerId).sort()).toEqual(['fa1', 'fa2', 'fa3'])
    expect(day1.signings[0].playerId).toBe(asPlayerId('fa1'))
    for (const s of day1.signings) {
      expect([t1.id, t2.id]).toContain(s.teamId)
    }

    const day2 = aiFreeAgencyDay({
      teams: data.teams,
      players: data.players,
      freeAgentIds: pool,
      userTeamId,
      year: 2026,
      rng: new Rng(22),
      faDay: 2
    })

    // One forward slot was left league-wide; the better leftover takes it.
    expect(day2.signings).toHaveLength(1)
    expect(day2.signings[0].playerId).toBe(asPlayerId('fa4'))
    const fa5 = data.players.get(asPlayerId('fa5'))!
    expect([t1.roster, t2.roster].some((r) => r.includes(fa5.id))).toBe(false)
  })

  it('is deterministic: same seeds produce the same signings', () => {
    const run = (): string => {
      const data = gen(11)
      const userTeamId = data.league.teams[0]
      const t1 = teamAt(data, 1)
      const t2 = teamAt(data, 2)
      const backup = rosterPlayers(data, t1)
        .filter((p) => p.position === 'G')
        .sort(byOverallDesc)[1]
      releasePlayer({ team: t1, playerId: backup.id, players: data.players })
      const fwds = rosterPlayers(data, t2)
        .filter((p) => p.position !== 'D' && p.position !== 'G')
        .sort(byOverallDesc)
      const cut = [fwds[fwds.length - 1].id, fwds[fwds.length - 2].id]
      for (const id of cut) releasePlayer({ team: t2, playerId: id, players: data.players })

      const pool = [backup.id, ...cut]
      const all = [
        ...aiFreeAgencyDay({ teams: data.teams, players: data.players, freeAgentIds: pool, userTeamId, year: 2026, rng: new Rng(99), faDay: 1 }).signings,
        ...aiFreeAgencyDay({ teams: data.teams, players: data.players, freeAgentIds: pool, userTeamId, year: 2026, rng: new Rng(100), faDay: 2 }).signings
      ]
      return JSON.stringify(all)
    }
    expect(run()).toBe(run())
  })
})

describe('initialPicks', () => {
  it('gives every club its own picks for 3 drafts, 2 rounds by default', () => {
    const teamIds = [asTeamId('t0'), asTeamId('t1')]
    const picks = initialPicks({ teamIds, firstDraftYear: 2027 })
    expect(picks).toHaveLength(2 * 3 * 2)
    for (const pick of picks) {
      expect(pick.ownerTeamId).toBe(pick.originalTeamId)
      expect([2027, 2028, 2029]).toContain(pick.year)
      expect([1, 2]).toContain(pick.round)
    }
    for (const id of teamIds) {
      for (const year of [2027, 2028, 2029]) {
        expect(picks.filter((p) => p.ownerTeamId === id && p.year === year)).toHaveLength(2)
      }
    }
  })

  it('honors yearsAhead and rounds overrides', () => {
    const picks = initialPicks({
      teamIds: [asTeamId('t0')],
      firstDraftYear: 2027,
      yearsAhead: 1,
      rounds: 3
    })
    expect(picks).toHaveLength(3)
    expect(picks.map((p) => p.round)).toEqual([1, 2, 3])
    expect(picks.every((p) => p.year === 2027)).toBe(true)
  })
})
