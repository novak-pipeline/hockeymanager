/**
 * The living economy + AI GMs as characters (docs/LIVING-WORLD-ECONOMY-AND-AI.md):
 * the wage index, performance-sensitive asks, the live posture, the league
 * market's shapes, the FA market's player choice, the floor, persona re-signs.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { asTeamId, type DraftPick, type Player, type PlayerId, type Team, type TeamId } from '@domain'
import { Rng } from '@engine/shared/rng'
import { askTerms, aiFloorTopUp, CAP_GROWTH, aiFreeAgencyDay, aiResignDay, capFloorFor, capUsedFor, leagueMinSalary } from './contracts'
import { MAX_CONTRACT_SHARE, setAskModifier, setCeiling, setWageIndex, wageIndex } from './economy'
import { buildGmPersona, deriveLivePosture, scoutingDeptFor, type GmPersona, type PostureKind } from './gmPersona'
import { generateLeagueDeal, type MarketClub } from './aiMarket'
import { makePick, makePlayer, makeTeam } from './trades.test.fixtures'

afterEach(() => {
  setWageIndex(1)
  setCeiling(0)
  setAskModifier(null)
})

const persona = (teamId: string, over: Partial<GmPersona> = {}): GmPersona => ({
  ...buildGmPersona({ seed: 1, teamId, year: 2026 }),
  aggression: 0.5, patience: 0.5, riskTolerance: 0.5, pickHoarding: 0.5, loyalty: 0.5, capDiscipline: 0.5, analyticsLean: 0.5,
  ...over,
})

/** A full-ish roster: 13 F, 7 D, 2 G at a given quality and salary. */
function roster(prefix: string, v: number, salary: number, extra: Player[] = []): Player[] {
  const out: Player[] = []
  for (let i = 0; i < 13; i++) out.push(makePlayer(`${prefix}f${i}`, v - (i % 5), { position: i % 2 ? 'LW' as never : 'C', salary }))
  for (let i = 0; i < 7; i++) out.push(makePlayer(`${prefix}d${i}`, v - (i % 4), { position: 'D', salary }))
  for (let i = 0; i < 2; i++) out.push(makePlayer(`${prefix}g${i}`, v - i * 3, { position: 'G', salary }))
  return [...out, ...extra]
}

function world(teams: Team[], players: Player[]): { teams: Map<TeamId, Team>; players: Map<PlayerId, Player> } {
  return {
    teams: new Map(teams.map((t) => [t.id, t])),
    players: new Map(players.map((p) => [p.id, p])),
  }
}

describe('the wage index', () => {
  it('moves every ask, the minimum and the fair curve with the cap', () => {
    const star = makePlayer('s', 88, { age: 26 })
    const base = askTerms(star, 2030).salary
    const min0 = leagueMinSalary()
    setWageIndex(1.5)
    expect(wageIndex()).toBe(1.5)
    const grown = askTerms(star, 2030).salary
    expect(grown / base).toBeGreaterThan(1.45)
    expect(grown / base).toBeLessThan(1.55)
    expect(leagueMinSalary()).toBeGreaterThan(min0 * 1.45)
  })

  it('performance-sensitive asks: the installed modifier moves the price, bounded', () => {
    const p = makePlayer('p', 80, { age: 27 })
    const base = askTerms(p, 2030).salary
    setAskModifier(() => 1.2)
    expect(askTerms(p, 2030).salary).toBeGreaterThan(base * 1.15)
    setAskModifier(() => 9) // clamped to 1.35
    expect(askTerms(p, 2030).salary).toBeLessThanOrEqual(base * 1.36)
  })
})

describe('the cap binds for twenty seasons', () => {
  it('a star’s ask holds its share of the ceiling as the cap compounds; the max contract caps the elite', () => {
    const cap0 = 88e6
    const star = makePlayer('star', 86, { age: 26 })
    const elite = makePlayer('elite', 96, { age: 26 })
    const shares: number[] = []
    for (let y = 0; y <= 20; y++) {
      const cap = cap0 * CAP_GROWTH ** y
      setWageIndex(cap / cap0)
      setCeiling(cap)
      const share = askTerms(star, 2030).salary / cap
      shares.push(share)
      // A star (a top-line player, not the league's best) asks ~10–13% of the cap.
      expect(share).toBeGreaterThan(0.10)
      expect(share).toBeLessThan(0.13)
      // Nobody asks more than the NHL's individual maximum.
      expect(askTerms(elite, 2030).salary).toBeLessThanOrEqual(cap * MAX_CONTRACT_SHARE)
      // The minimum moves with the cap too.
      expect(leagueMinSalary() / cap).toBeGreaterThan(0.008)
      expect(leagueMinSalary() / cap).toBeLessThan(0.0095)
    }
    // No drift: year twenty prices the star like year one.
    expect(Math.abs(shares[20]! - shares[0]!)).toBeLessThan(0.004)
  })
})

describe('the live posture', () => {
  it('without table or persona it reads roughly as strength thirds', () => {
    const at = (rank: number): PostureKind => deriveLivePosture({ coreAge: 27, strengthRank: rank, teamCount: 32, year: 2030 }).posture
    expect(at(1)).toBe('contend')
    expect(at(16)).toBe('retool')
    expect(at(32)).toBe('rebuild')
  })

  it('the table overrides the paper: a weak roster clear of the line at 60 GP buys', () => {
    const live = deriveLivePosture({
      coreAge: 27, strengthRank: 24, teamCount: 32, year: 2030,
      table: { gamesPlayed: 60, paceGap: 14, leaderGap: 4 },
    })
    expect(live.posture).toBe('contend')
  })

  it('an aggressive GM on the bubble goes all in against the champion; a cautious one does not', () => {
    const args = { coreAge: 27, strengthRank: 13, teamCount: 32, year: 2030, championInConference: true }
    expect(deriveLivePosture({ ...args, persona: persona('a', { aggression: 0.9 }) }).personaDriven).toBe('allIn')
    expect(deriveLivePosture({ ...args, persona: persona('b', { aggression: 0.1 }) }).posture).not.toBe('contend')
  })

  it('a patient GM stays the course on a rebuild; an impatient one bails', () => {
    const args = { coreAge: 25, strengthRank: 14, teamCount: 32, year: 2031, memory: { posture: 'rebuild' as const, since: 2030 } }
    expect(deriveLivePosture({ ...args, persona: persona('p', { patience: 0.9 }) }).posture).toBe('rebuild')
    expect(deriveLivePosture({ ...args, persona: persona('q', { patience: 0.1 }) }).posture).toBe('retool')
  })
})

describe('AI scouting departments', () => {
  it('are deterministic per club and bounded', () => {
    const a = scoutingDeptFor(7, 'tor')
    expect(scoutingDeptFor(7, 'tor')).toEqual(a)
    expect(a.quality).toBeGreaterThanOrEqual(0.3)
    expect(a.quality).toBeLessThanOrEqual(0.95)
    expect(a.blindSpot.length).toBeGreaterThan(0)
  })
})

describe('the floor binds', () => {
  it('an AI club under the floor signs its way there before camp', () => {
    const cheap = roster('c', 60, 1_000_000)
    const team = makeTeam('cheap', cheap)
    const fas = [makePlayer('fa1', 75, { age: 29, salary: 0 }), makePlayer('fa2', 72, { age: 30, salary: 0 })]
    const w = world([team], [...cheap, ...fas])
    const before = capUsedFor(team, w.players)
    expect(before).toBeLessThan(capFloorFor(team.finances.salaryCap))
    const res = aiFloorTopUp({ ...w, freeAgentIds: fas.map((p) => p.id), userTeamId: asTeamId('user'), year: 2030, floorOf: (t) => capFloorFor(t.finances.salaryCap) })
    expect(res.signings.length).toBeGreaterThan(0)
    expect(capUsedFor(team, w.players)).toBeGreaterThan(before)
  })

  it('a club far under with only a few seats left spreads the shortfall over them (one-year overpays)', () => {
    // 22 cheap bodies + one free seat before 25... two seats in all.
    const cheap = [...roster('c', 60, 1_000_000), makePlayer('cx', 58, { salary: 1_000_000 })]
    const team = makeTeam('cheap', cheap)
    const fas = [makePlayer('fa1', 74, { age: 29, salary: 0 }), makePlayer('fa2', 73, { age: 30, salary: 0 })]
    const w = world([team], [...cheap, ...fas])
    const floor = capFloorFor(team.finances.salaryCap)
    const short = floor - capUsedFor(team, w.players)
    expect(short).toBeGreaterThan(0)
    const res = aiFloorTopUp({ ...w, freeAgentIds: fas.map((p) => p.id), userTeamId: asTeamId('user'), year: 2030, floorOf: () => floor })
    expect(res.signings.length).toBe(2)
    // Each seat carries at least half of the gap (capped at 3x the ask): the club
    // closes most of the distance instead of signing two 1.5x-ask depth deals.
    const paid = res.signings.reduce((a, s) => a + s.salary, 0)
    const asks = fas.reduce((a, p) => a + askTerms(p, 2030).salary, 0)
    expect(paid).toBeGreaterThanOrEqual(Math.min(short, asks * 3) * 0.95)
  })
})

describe('the free-agent market', () => {
  it('clubs bid and the player chooses; the winner and the why come back', () => {
    const a = makeTeam('aaa', roster('a', 70, 2_500_000))
    const b = makeTeam('bbb', roster('b', 64, 2_500_000))
    const star = makePlayer('ufa', 84, { age: 28, salary: 0 })
    const w = world([a, b], [...roster('a', 70, 2_500_000), ...roster('b', 64, 2_500_000), star])
    const res = aiFreeAgencyDay({
      ...w, freeAgentIds: [star.id], userTeamId: asTeamId('user'), year: 2030, rng: new Rng(3), faDay: 1,
      market: {
        personaOf: (tid) => persona(tid as string),
        postureOf: (tid) => ((tid as string) === 'aaa' ? 'contend' : 'retool'),
        strengthRankOf: (tid) => ((tid as string) === 'aaa' ? 1 : 2),
        floorOf: (t) => capFloorFor(t.finances.salaryCap),
      },
    })
    expect(res.signings).toHaveLength(1)
    expect(res.signings[0]!.suitors).toBe(2)
    expect(res.signings[0]!.reason).toBeTruthy()
  })
})

describe('persona re-signing', () => {
  it('a rebuilding GM lets his 31-year-old walk unless he is loyal to a fault', () => {
    const make = (): { team: Team; players: Map<PlayerId, Player>; vet: Player } => {
      const rs = roster('r', 70, 2_000_000)
      const vet = makePlayer('vet', 74, { age: 31, years: 0, salary: 4_000_000 })
      vet.stats = new Array(9).fill(null).map(() => ({}) as never) // UFA by service
      const team = makeTeam('reb', [...rs, vet])
      return { team, players: new Map([...rs, vet].map((p) => [p.id, p])), vet }
    }
    const cold = make()
    aiResignDay({ teams: new Map([[cold.team.id, cold.team]]), players: cold.players, userTeamId: asTeamId('user'), year: 2030, rng: new Rng(1),
      personaOf: () => ({ loyalty: 0.1, capDiscipline: 0.5 }), postureOf: () => 'rebuild' })
    expect(cold.vet.contract.yearsRemaining).toBe(0)
    const warm = make()
    aiResignDay({ teams: new Map([[warm.team.id, warm.team]]), players: warm.players, userTeamId: asTeamId('user'), year: 2030, rng: new Rng(1),
      personaOf: () => ({ loyalty: 0.95, capDiscipline: 0.1 }), postureOf: () => 'rebuild' })
    expect(warm.vet.contract.yearsRemaining).toBeGreaterThan(0)
  })
})

describe('the league market', () => {
  it('a rebuilder sells a veteran to a contender who needs him, both lenses agreeing', () => {
    const sellerPlayers = roster('s', 66, 2_000_000)
    const vet = makePlayer('svet', 82, { age: 30, years: 1, salary: 3_000_000 })
    const seller = makeTeam('sel', [...sellerPlayers, vet])
    const buyerPlayers = roster('b', 72, 2_000_000)
    const buyer = makeTeam('buy', buyerPlayers)
    const w = world([seller, buyer], [...sellerPlayers, vet, ...buyerPlayers])
    const picks: DraftPick[] = [makePick(2031, 1, 'buy'), makePick(2031, 2, 'buy'), makePick(2032, 2, 'buy'), makePick(2031, 1, 'sel')]
    const clubs: MarketClub[] = [
      { team: seller, persona: persona('sel', { aggression: 0.8 }), posture: 'rebuild', strengthRank: 2 },
      { team: buyer, persona: persona('buy', { aggression: 0.8 }), posture: 'contend', strengthRank: 1 },
    ]
    let found = 0
    for (let i = 0; i < 40; i++) {
      const d = generateLeagueDeal({
        window: 'deadline', deadlineProximity: 1, ...w, clubs, picks, rng: new Rng(i),
        floorOf: () => 0, prospectsOf: () => [],
      })
      if (d && d.playerIds.includes(vet.id)) {
        found++
        expect(d.sellerTeamId).toBe(seller.id)
        expect(d.buyerTeamId).toBe(buyer.id)
        expect(d.rationale.buyer.length).toBeGreaterThan(10)
      }
    }
    expect(found).toBeGreaterThan(0)
  })

  it('candidates before the choice: the one seller with a buyer is found, not lost to a bad draw', () => {
    // Two rebuilders. The eager one (aggression 1) only has a veteran nobody can
    // use; the quiet one has the piece the contender needs. A one-draw market
    // picked the eager seller most days and came back empty.
    const eagerPlayers = roster('e', 60, 2_000_000)
    const dud = makePlayer('dud', 62, { age: 31, years: 1, salary: 2_000_000 })
    const eager = makeTeam('eag', [...eagerPlayers, dud])
    const quietPlayers = roster('q', 66, 2_000_000)
    const vet = makePlayer('qvet', 82, { age: 30, years: 1, salary: 3_000_000 })
    const quiet = makeTeam('qui', [...quietPlayers, vet])
    const buyerPlayers = roster('b', 72, 2_000_000)
    const buyer = makeTeam('buy', buyerPlayers)
    const w = world([eager, quiet, buyer], [...eagerPlayers, dud, ...quietPlayers, vet, ...buyerPlayers])
    const picks: DraftPick[] = [makePick(2031, 1, 'buy'), makePick(2031, 2, 'buy'), makePick(2032, 2, 'buy')]
    const clubs: MarketClub[] = [
      { team: eager, persona: persona('eag', { aggression: 1 }), posture: 'rebuild', strengthRank: 3 },
      { team: quiet, persona: persona('qui', { aggression: 0.1 }), posture: 'rebuild', strengthRank: 2 },
      { team: buyer, persona: persona('buy', { aggression: 0.8 }), posture: 'contend', strengthRank: 1 },
    ]
    let found = 0
    for (let i = 0; i < 20; i++) {
      const d = generateLeagueDeal({ window: 'deadline', deadlineProximity: 1, ...w, clubs, picks, rng: new Rng(i), floorOf: () => 0, prospectsOf: () => [] })
      if (d?.playerIds.includes(vet.id)) found++
      expect(d?.playerIds.includes(dud.id) ?? false).toBe(false)
    }
    expect(found).toBeGreaterThanOrEqual(15)
  })

  it('a loyal GM does not move his own draftee', () => {
    const sellerPlayers = roster('s', 66, 2_000_000)
    const vet = makePlayer('own', 82, { age: 30, years: 1, salary: 3_000_000 })
    const seller = makeTeam('sel', [...sellerPlayers, vet])
    vet.nhlDrafted = true
    vet.draftClub = seller.name
    // Every other seller veteran is too cheap to shop, so HE is the only candidate.
    for (const p of sellerPlayers) p.age = 22
    const buyerPlayers = roster('b', 72, 2_000_000)
    const buyer = makeTeam('buy', buyerPlayers)
    const w = world([seller, buyer], [...sellerPlayers, vet, ...buyerPlayers])
    const picks: DraftPick[] = [makePick(2031, 1, 'buy'), makePick(2031, 2, 'buy')]
    const clubs: MarketClub[] = [
      { team: seller, persona: persona('sel', { loyalty: 0.9 }), posture: 'rebuild', strengthRank: 2 },
      { team: buyer, persona: persona('buy', { aggression: 0.8 }), posture: 'contend', strengthRank: 1 },
    ]
    for (let i = 0; i < 30; i++) {
      const d = generateLeagueDeal({ window: 'deadline', deadlineProximity: 1, ...w, clubs, picks, rng: new Rng(i), floorOf: () => 0, prospectsOf: () => [] })
      expect(d?.playerIds.includes(vet.id) ?? false).toBe(false)
    }
  })
})
