import { describe, expect, it } from 'vitest'
import {
  asPlayerId,
  asTeamId,
  type DraftPick,
  type Player,
  type PlayerId,
  type PlayerRole,
  type Position,
  type RawAttributes,
  type Team,
  type TeamId
} from '@domain'
import { computeComposites, overall } from '@engine/ratings/composites'
import { Rng, deriveSeed } from '@engine/shared/rng'
import {
  buildTeamProfile,
  canRetain,
  evaluateProposal,
  executeTrade,
  generateAiOffers,
  perriPickValue,
  pickValue,
  playerValue,
  retentionCapSplit,
  teamPhilosophy,
  type StoredTradeOffer
} from './trades'

/* ────────────────────────── fixtures ────────────────────────── */

function rawAttrs(v: number, position: Position): RawAttributes {
  const raw: RawAttributes = {
    technical: { wristShot: v, slapShot: v, stickhandling: v, passing: v, deflections: v, faceoffs: v },
    physical: { speed: v, acceleration: v, strength: v, balance: v, stamina: v, agility: v, height: 50 },
    mental: {
      offensiveIQ: v,
      defensiveIQ: v,
      positioning: v,
      vision: v,
      aggression: 50,
      composure: v,
      workRate: v,
      discipline: 55,
      anticipation: v
    },
    defensive: { checking: v, shotBlocking: v, stickChecking: v, takeaway: v }
  }
  if (position === 'G') {
    raw.goalie = {
      reflexes: v,
      positioningG: v,
      reboundControl: v,
      glove: v,
      blocker: v,
      recovery: v,
      puckHandlingG: v
    }
  }
  return raw
}

interface PlayerOpts {
  age?: number
  position?: Position
  salary?: number
  years?: number
  ntc?: boolean
  potential?: number
  morale?: number
  injuryGames?: number
}

function makePlayer(id: string, v: number, opts: PlayerOpts = {}): Player {
  const position = opts.position ?? 'C'
  const role: PlayerRole = position === 'G' ? 'starter' : 'twoWay'
  const ratings = rawAttrs(v, position)
  const years = opts.years ?? 3
  return {
    id: asPlayerId(id),
    name: `Player ${id}`,
    age: opts.age ?? 25,
    position,
    handedness: 'L',
    role,
    ratings,
    potential: rawAttrs(opts.potential ?? v, position),
    composites: computeComposites(ratings, role, position),
    personality: { ambition: 10, professionalism: 10, loyalty: 10, temperament: 10, determination: 10 },
    contract: {
      salary: opts.salary ?? 3_000_000,
      yearsRemaining: years,
      expiryYear: 2026 + years,
      noTradeClause: opts.ntc ?? false,
      twoWay: false
    },
    stats: [],
    fatigue: 0,
    morale: opts.morale ?? 70,
    injuryStatus:
      opts.injuryGames !== undefined
        ? { kind: 'lowerBody', gamesRemaining: opts.injuryGames, description: 'test injury' }
        : null,
    form: 0
  }
}

function makeTeam(id: string, roster: Player[], opts: { capUsed?: number } = {}): Team {
  return {
    id: asTeamId(id),
    name: `Team ${id.toUpperCase()}`,
    abbreviation: id.toUpperCase().slice(0, 3),
    city: 'Test City',
    colors: { primary: 0x112233, secondary: 0xddeeff },
    conferenceId: 'c1',
    divisionId: 'd1',
    roster: roster.map((p) => p.id),
    lines: {
      forwards: [],
      defensePairs: [],
      goalies: [asPlayerId(`${id}-gx`), asPlayerId(`${id}-gy`)],
      powerPlayUnits: [],
      penaltyKillUnits: []
    },
    tactics: {
      forecheck: '1-2-2',
      dZoneCoverage: 'zone',
      tempo: { pace: 0.5, passRisk: 0.5, shotEagerness: 0.5, defensivePinch: 0.5 },
      specialTeams: { powerPlay: 'umbrella', penaltyKill: 'box' },
      lineMatching: false
    },
    finances: {
      budget: 90e6,
      salaryCap: 88e6,
      capUsed: opts.capUsed ?? roster.reduce((s, p) => s + p.contract.salary, 0),
      revenue: 0
    },
    staff: { headCoachId: null, assistantCoachIds: [], scoutIds: [] }
  }
}

const makePick = (year: number, round: number, original: string, owner = original): DraftPick => ({
  year,
  round,
  originalTeamId: asTeamId(original),
  ownerTeamId: asTeamId(owner)
})

/* ────────────────────────── playerValue ────────────────────────── */

describe('playerValue', () => {
  it('scales exponentially with overall — stars are disproportionately valuable', () => {
    const v70 = playerValue(makePlayer('a', 70))
    const v80 = playerValue(makePlayer('b', 80))
    const v90 = playerValue(makePlayer('c', 90))
    expect(v80).toBeGreaterThan(1.7 * v70)
    expect(v90).toBeGreaterThan(2.3 * v80)
    expect(v90).toBeGreaterThan(3 * playerValue(makePlayer('d', 75)))
  })

  it('peaks in the 23–27 prime and decays for veterans', () => {
    const at = (age: number): number => playerValue(makePlayer('p', 80, { age }))
    expect(at(25)).toBeGreaterThan(at(20))
    expect(at(25)).toBeGreaterThan(at(30))
    expect(at(30)).toBeGreaterThan(at(35))
    expect(at(23)).toBeCloseTo(at(27), 6)
  })

  it('prices in potential upside for U24 players only', () => {
    const prospect = playerValue(makePlayer('p', 65, { age: 19, potential: 90 }))
    const capped = playerValue(makePlayer('p', 65, { age: 19, potential: 65 }))
    expect(prospect).toBeGreaterThan(capped * 1.3)

    const vet = playerValue(makePlayer('p', 65, { age: 28, potential: 90 }))
    const vetCapped = playerValue(makePlayer('p', 65, { age: 28, potential: 65 }))
    expect(vet).toBeCloseTo(vetCapped, 6)
  })

  it('applies contract drag — cheap deals add value, overpays subtract', () => {
    const cheap = playerValue(makePlayer('p', 80, { salary: 1_000_000 }))
    const fair = playerValue(makePlayer('p', 80, { salary: 5_000_000 }))
    const overpaid = playerValue(makePlayer('p', 80, { salary: 12_000_000 }))
    expect(cheap).toBeGreaterThan(fair)
    expect(fair).toBeGreaterThan(overpaid)
  })

  it('discounts slightly for injury and poor morale', () => {
    const healthy = playerValue(makePlayer('p', 78))
    const injured = playerValue(makePlayer('p', 78, { injuryGames: 10 }))
    expect(injured).toBeLessThan(healthy)
    expect(injured).toBeGreaterThan(healthy * 0.75)

    const grumpy = playerValue(makePlayer('p', 78, { morale: 10 }))
    expect(grumpy).toBeLessThan(healthy)
    expect(grumpy).toBeGreaterThan(healthy * 0.9)
  })
})

/* ────────────────────────── pickValue ────────────────────────── */

describe('pickValue', () => {
  it('values round 1 above round 2 and later rounds', () => {
    const r1 = pickValue(makePick(2026, 1, 't1'), { year: 2026 })
    const r2 = pickValue(makePick(2026, 2, 't1'), { year: 2026 })
    const r4 = pickValue(makePick(2026, 4, 't1'), { year: 2026 })
    // Perri power-law: r1/r2 ≈ 1.66, r1/r4 ≈ 2.45 (gradual decay by round)
    expect(r1).toBeGreaterThan(r2)
    expect(r2).toBeGreaterThan(r4)
    expect(r1).toBeGreaterThan(r4 * 2)
  })

  it('discounts future years', () => {
    const now = pickValue(makePick(2026, 1, 't1'), { year: 2026 })
    const later = pickValue(makePick(2028, 1, 't1'), { year: 2026 })
    expect(later).toBeLessThan(0.75 * now)
  })

  it('boosts picks originating from weak teams, mostly in round 1', () => {
    const strong = pickValue(makePick(2026, 1, 't1'), { year: 2026, teamStrengthRank: 1 })
    const weak = pickValue(makePick(2026, 1, 't1'), { year: 2026, teamStrengthRank: 16 })
    expect(weak).toBeGreaterThan(strong)

    const strongR3 = pickValue(makePick(2026, 3, 't1'), { year: 2026, teamStrengthRank: 1 })
    const weakR3 = pickValue(makePick(2026, 3, 't1'), { year: 2026, teamStrengthRank: 16 })
    expect(weak / strong).toBeGreaterThan(weakR3 / strongR3)
  })
})

/* ────────────────────────── evaluateProposal ────────────────────────── */

function partnerFixture(opts: { capUsed?: number } = {}): {
  partnerTeam: Team
  partnerPlayers: Map<PlayerId, Player>
} {
  const roster: Player[] = []
  for (let i = 0; i < 8; i++) roster.push(makePlayer(`pp-f${i}`, 70, { position: i < 3 ? 'C' : 'W' }))
  for (let i = 0; i < 5; i++) roster.push(makePlayer(`pp-d${i}`, 68, { position: 'D' }))
  for (let i = 0; i < 2; i++) roster.push(makePlayer(`pp-g${i}`, 70, { position: 'G' }))
  const partnerTeam = makeTeam('pt', roster, opts.capUsed === undefined ? {} : { capUsed: opts.capUsed })
  return { partnerTeam, partnerPlayers: new Map(roster.map((p) => [p.id, p])) }
}

describe('evaluateProposal', () => {
  it('auto-rejects any deal containing a no-trade-clause player', () => {
    const { partnerTeam, partnerPlayers } = partnerFixture()
    const ntcPlayer = makePlayer('star', 90, { ntc: true })
    // Pure gift apart from the clause — value alone would be an easy accept.
    const result = evaluateProposal({
      give: { players: [ntcPlayer], picks: [makePick(2026, 1, 'u')] },
      receive: { players: [], picks: [] },
      partnerTeam,
      partnerPlayers,
      rng: new Rng(1)
    })
    expect(result.verdict).toBe('reject')
    expect(result.message).toMatch(/no-trade/i)
  })

  it('rejects when the swap would put the partner over the cap', () => {
    const { partnerTeam, partnerPlayers } = partnerFixture({ capUsed: 87_000_000 })
    const result = evaluateProposal({
      give: { players: [makePlayer('big', 85, { salary: 6_000_000 })], picks: [] },
      receive: { players: [], picks: [] },
      partnerTeam,
      partnerPlayers,
      rng: new Rng(1)
    })
    expect(result.verdict).toBe('reject')
    expect(result.message).toMatch(/cap/i)
  })

  it('accepts when the partner clearly gains value', () => {
    const { partnerTeam, partnerPlayers } = partnerFixture()
    for (let seed = 1; seed <= 20; seed++) {
      const result = evaluateProposal({
        give: { players: [], picks: [makePick(2026, 1, 'u'), makePick(2026, 2, 'u')] },
        receive: { players: [], picks: [makePick(2026, 1, 'pt')] },
        partnerTeam,
        partnerPlayers,
        rng: new Rng(seed)
      })
      expect(result.verdict).toBe('accept')
      expect(result.counterAskValue).toBe(0)
    }
  })

  it('counters when the offer is close but short', () => {
    const { partnerTeam, partnerPlayers } = partnerFixture()
    for (let seed = 1; seed <= 20; seed++) {
      // Perri curve + RebuildDraft philosophy (team 'pt' hashes to RebuildDraft, 1.25× pick bias):
      // gain_biased = r1 * 1.25 ≈ 34.9; loss = r1+r5 ≈ 38.1 → ratio ≈ 0.917
      // Counter zone: ratio in [threshold-0.15, threshold). 0.917 is in [0.84, 0.99) for all seeds.
      const result = evaluateProposal({
        give: { players: [], picks: [makePick(2026, 1, 'u')] },
        receive: { players: [], picks: [makePick(2026, 1, 'pt'), makePick(2026, 5, 'pt')] },
        partnerTeam,
        partnerPlayers,
        rng: new Rng(seed)
      })
      expect(result.verdict).toBe('counter')
      expect(result.counterAskValue).toBeGreaterThan(0)
      expect(result.message).toMatch(/%/)
    }
  })

  it('rejects lopsided offers with a message naming the gap', () => {
    const { partnerTeam, partnerPlayers } = partnerFixture()
    for (let seed = 1; seed <= 20; seed++) {
      const result = evaluateProposal({
        give: { players: [], picks: [makePick(2026, 2, 'u')] },
        receive: { players: [], picks: [makePick(2026, 1, 'pt')] },
        partnerTeam,
        partnerPlayers,
        rng: new Rng(seed)
      })
      expect(result.verdict).toBe('reject')
      expect(result.counterAskValue).toBeGreaterThan(0)
      expect(result.message).toMatch(/%/)
    }
  })

  it('is deterministic for a given seed', () => {
    const { partnerTeam, partnerPlayers } = partnerFixture()
    const run = (): unknown =>
      evaluateProposal({
        give: { players: [makePlayer('g1', 76)], picks: [makePick(2027, 2, 'u')] },
        receive: { players: [partnerPlayers.get(asPlayerId('pp-f0'))!], picks: [] },
        partnerTeam,
        partnerPlayers,
        rng: new Rng(42)
      })
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()))
  })
})

/* ────────────────────────── executeTrade ────────────────────────── */

describe('executeTrade', () => {
  function tradeFixture(): {
    teams: Map<TeamId, Team>
    players: Map<PlayerId, Player>
    allPicks: DraftPick[]
    a1: Player
    b1: Player
  } {
    const a1 = makePlayer('a1', 80, { salary: 7_000_000 })
    const a2 = makePlayer('a2', 70, { salary: 3_000_000 })
    const b1 = makePlayer('b1', 75, { salary: 5_000_000 })
    const b2 = makePlayer('b2', 65, { salary: 2_000_000 })
    const teamA = makeTeam('ta', [a1, a2])
    const teamB = makeTeam('tb', [b1, b2])
    const teams = new Map<TeamId, Team>([
      [teamA.id, teamA],
      [teamB.id, teamB]
    ])
    const players = new Map<PlayerId, Player>([a1, a2, b1, b2].map((p) => [p.id, p]))
    const allPicks = [makePick(2026, 1, 'ta'), makePick(2026, 1, 'tb'), makePick(2027, 2, 'ta')]
    return { teams, players, allPicks, a1, b1 }
  }

  it('moves players, reassigns pick ownership, and recomputes both caps', () => {
    const { teams, players, allPicks, a1, b1 } = tradeFixture()
    const teamA = teams.get(asTeamId('ta'))!
    const teamB = teams.get(asTeamId('tb'))!
    const linesBefore = JSON.stringify([teamA.lines, teamB.lines])

    executeTrade({
      teams,
      players,
      teamA: teamA.id,
      teamB: teamB.id,
      aGivesPlayerIds: [a1.id],
      // Pass a structural copy: matching must not rely on object identity.
      aGivesPicks: [{ ...allPicks[0] }],
      bGivesPlayerIds: [b1.id],
      bGivesPicks: [],
      allPicks
    })

    expect(teamA.roster).not.toContain(a1.id)
    expect(teamA.roster).toContain(b1.id)
    expect(teamB.roster).not.toContain(b1.id)
    expect(teamB.roster).toContain(a1.id)

    expect(allPicks[0].ownerTeamId).toBe(teamB.id)
    expect(allPicks[1].ownerTeamId).toBe(teamB.id)
    expect(allPicks[2].ownerTeamId).toBe(teamA.id)

    // a2 (3M) + b1 (5M) and b2 (2M) + a1 (7M).
    expect(teamA.finances.capUsed).toBe(8_000_000)
    expect(teamB.finances.capUsed).toBe(9_000_000)

    expect(JSON.stringify([teamA.lines, teamB.lines])).toBe(linesBefore)
  })

  it('throws when a player is not on the stated roster, mutating nothing', () => {
    const { teams, players, allPicks, b1 } = tradeFixture()
    const before = JSON.stringify([...teams.values()].map((t) => t.roster))
    expect(() =>
      executeTrade({
        teams,
        players,
        teamA: asTeamId('ta'),
        teamB: asTeamId('tb'),
        aGivesPlayerIds: [asPlayerId('not-here')],
        aGivesPicks: [],
        bGivesPlayerIds: [b1.id],
        bGivesPicks: [],
        allPicks
      })
    ).toThrow(/roster/)
    expect(JSON.stringify([...teams.values()].map((t) => t.roster))).toBe(before)
  })

  it('throws when a team trades a pick it does not own', () => {
    const { teams, players, allPicks, a1, b1 } = tradeFixture()
    expect(() =>
      executeTrade({
        teams,
        players,
        teamA: asTeamId('ta'),
        teamB: asTeamId('tb'),
        aGivesPlayerIds: [a1.id],
        aGivesPicks: [makePick(2026, 1, 'tb')], // owned by B, not A
        bGivesPlayerIds: [b1.id],
        bGivesPicks: [],
        allPicks
      })
    ).toThrow(/own/)
  })
})

/* ────────────────────────── generateAiOffers ────────────────────────── */

function leagueFixture(): {
  teams: Map<TeamId, Team>
  players: Map<PlayerId, Player>
  picks: DraftPick[]
  userTeamId: TeamId
} {
  const teams = new Map<TeamId, Team>()
  const players = new Map<PlayerId, Player>()
  const picks: DraftPick[] = []
  const salaryFor = (v: number): number => 1_000_000 + Math.max(0, v - 50) * 200_000

  // Per-group offsets give each AI club a distinct weakness; the user club
  // (t1) is strongest everywhere so AI clubs covet its players.
  const specs = [
    { id: 't1', f: 0, d: 0, g: 0 },
    { id: 't2', f: -2, d: -10, g: -2 },
    { id: 't3', f: -12, d: -4, g: -4 },
    { id: 't4', f: -6, d: -6, g: -14 }
  ]
  const F_BASE = [78, 74, 70, 67, 64, 60]
  const D_BASE = [75, 70, 66, 62]
  const G_BASE = [72, 65]

  for (const spec of specs) {
    const roster: Player[] = []
    F_BASE.forEach((v, i) =>
      roster.push(
        makePlayer(`${spec.id}f${i}`, v + spec.f, {
          position: i < 2 ? 'C' : 'W',
          salary: salaryFor(v + spec.f)
        })
      )
    )
    D_BASE.forEach((v, i) =>
      roster.push(makePlayer(`${spec.id}d${i}`, v + spec.d, { position: 'D', salary: salaryFor(v + spec.d) }))
    )
    G_BASE.forEach((v, i) =>
      roster.push(makePlayer(`${spec.id}g${i}`, v + spec.g, { position: 'G', salary: salaryFor(v + spec.g) }))
    )
    for (const p of roster) players.set(p.id, p)
    teams.set(asTeamId(spec.id), makeTeam(spec.id, roster))
    for (const year of [2026, 2027]) {
      for (const round of [1, 2, 3]) picks.push(makePick(year, round, spec.id))
    }
  }
  return { teams, players, picks, userTeamId: asTeamId('t1') }
}

/** Mirror of the engine's strength ranking so pick values can be recomputed exactly. */
function strengthRanks(teams: Map<TeamId, Team>, players: Map<PlayerId, Player>): Map<TeamId, number> {
  const means: Array<[TeamId, number]> = []
  for (const t of teams.values()) {
    const ovrs = t.roster.map((id) => players.get(id)!).map((p) => overall(p.composites, p.position))
    means.push([t.id, ovrs.reduce((a, b) => a + b, 0) / ovrs.length])
  }
  means.sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
  return new Map(means.map(([id], i) => [id, i + 1]))
}

function collectOffers(days: number, baseSeed: number): StoredTradeOffer[] {
  const { teams, players, picks, userTeamId } = leagueFixture()
  const offers: StoredTradeOffer[] = []
  let counter = 0
  for (let day = 1; day <= days; day++) {
    const got = generateAiOffers({
      day,
      userTeamId,
      teams,
      players,
      picks,
      rng: new Rng(deriveSeed(baseSeed, day)),
      nextOfferId: () => `offer-${++counter}`
    })
    expect(got.length).toBeLessThanOrEqual(1)
    offers.push(...got)
  }
  return offers
}

describe('generateAiOffers', () => {
  it('produces offers at roughly a 1-in-8 match-day rate', () => {
    const offers = collectOffers(400, 9001)
    expect(offers.length).toBeGreaterThanOrEqual(20)
    expect(offers.length).toBeLessThanOrEqual(90)
  })

  it('offers are structurally valid and value-rational', () => {
    const { teams, players, picks, userTeamId } = leagueFixture()
    const ranks = strengthRanks(teams, players)
    const user = teams.get(userTeamId)!
    const offers: StoredTradeOffer[] = []
    let counter = 0
    for (let day = 1; day <= 400; day++) {
      offers.push(
        ...generateAiOffers({
          day,
          userTeamId,
          teams,
          players,
          picks,
          rng: new Rng(deriveSeed(7, day)),
          nextOfferId: () => `offer-${++counter}`
        }).map((o) => ({ ...o, day }) as StoredTradeOffer & { day: number })
      )
    }
    expect(offers.length).toBeGreaterThan(0)

    for (const offer of offers as Array<StoredTradeOffer & { day: number }>) {
      expect(offer.partnerTeamId).not.toBe(userTeamId)
      const partner = teams.get(offer.partnerTeamId)!

      expect(offer.userGivesPlayerIds.length).toBeGreaterThan(0)
      for (const id of offer.userGivesPlayerIds) {
        expect(user.roster).toContain(id)
        expect(players.get(id)!.contract.noTradeClause).toBe(false)
      }
      for (const id of offer.userReceivesPlayerIds) expect(partner.roster).toContain(id)
      for (const pick of offer.userReceivesPicks) expect(pick.ownerTeamId).toBe(partner.id)

      expect(offer.expiresOnDay - offer.day).toBeGreaterThanOrEqual(6)
      expect(offer.expiresOnDay - offer.day).toBeLessThanOrEqual(8)
      expect(offer.message.length).toBeGreaterThan(0)

      const giveValue = offer.userGivesPlayerIds.reduce(
        (s, id) => s + playerValue(players.get(id)!),
        0
      )
      const receiveValue =
        offer.userReceivesPlayerIds.reduce((s, id) => s + playerValue(players.get(id)!), 0) +
        offer.userReceivesPicks.reduce(
          (s, p) =>
            s + pickValue(p, { year: 2026, teamStrengthRank: ranks.get(p.originalTeamId)! }),
          0
        )
      expect(receiveValue).toBeGreaterThanOrEqual(0.8 * giveValue)
      expect(receiveValue).toBeLessThanOrEqual(1.45 * giveValue)
    }
  })

  it('targets players at the partner club\'s weakest position group', () => {
    const { teams, players, picks, userTeamId } = leagueFixture()
    // t2 is thin on the blue line, t3 up front, t4 in the crease.
    const expectedNeed: Record<string, 'F' | 'D' | 'G'> = { t2: 'D', t3: 'F', t4: 'G' }
    let checked = 0
    let counter = 0
    for (let day = 1; day <= 400; day++) {
      for (const offer of generateAiOffers({
        day,
        userTeamId,
        teams,
        players,
        picks,
        rng: new Rng(deriveSeed(31, day)),
        nextOfferId: () => `offer-${++counter}`
      })) {
        const target = players.get(offer.userGivesPlayerIds[0])!
        const group = target.position === 'G' ? 'G' : target.position === 'D' ? 'D' : 'F'
        expect(group).toBe(expectedNeed[offer.partnerTeamId as string])
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('is deterministic: same seeds produce identical offers', () => {
    const a = collectOffers(200, 555)
    const b = collectOffers(200, 555)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

/* ────────────────────────── perriPickValue ────────────────────────── */

describe('perriPickValue', () => {
  it('anchors #1=100 and #2 ≈ 72.69', () => {
    expect(perriPickValue(1)).toBeCloseTo(100, 4)
    expect(perriPickValue(2)).toBeCloseTo(72.69, 0)
  })

  it('is strictly monotone decreasing over 1–224', () => {
    for (let i = 1; i < 224; i++) {
      expect(perriPickValue(i)).toBeGreaterThan(perriPickValue(i + 1))
    }
  })

  it('clamps at 1 and 224', () => {
    expect(perriPickValue(0)).toBe(perriPickValue(1))
    expect(perriPickValue(999)).toBe(perriPickValue(224))
  })

  it('produces a steep early decay and a long flat tail', () => {
    const gap1to2 = perriPickValue(1) - perriPickValue(2)
    const gap31to32 = perriPickValue(31) - perriPickValue(32)
    expect(gap1to2).toBeGreaterThan(gap31to32 * 3)
    // tail is indeed flat (picks 100–110 differ by less than 2 total)
    expect(perriPickValue(100) - perriPickValue(110)).toBeLessThan(2)
  })

  it('maintains the Perri #1 vs #2 ratio of ~1.376', () => {
    expect(perriPickValue(1) / perriPickValue(2)).toBeCloseTo(1.376, 1)
  })
})

/* ────────────────────────── pickValue uses Perri curve ────────────────────────── */

describe('pickValue (Perri-backed)', () => {
  it('round-1 from weakest team is worth significantly more than from strongest', () => {
    const weak = pickValue(makePick(2026, 1, 't1'), { year: 2026, teamStrengthRank: 32 })
    const strong = pickValue(makePick(2026, 1, 't1'), { year: 2026, teamStrengthRank: 1 })
    expect(weak).toBeGreaterThan(strong * 1.5)
  })

  it('round-1 is worth significantly more than round-4', () => {
    const r1 = pickValue(makePick(2026, 1, 't1'), { year: 2026 })
    const r4 = pickValue(makePick(2026, 4, 't1'), { year: 2026 })
    // Perri power-law gives r1/r4 ≈ 2.45 when no rank info (midpoint slot assumed)
    expect(r1).toBeGreaterThan(r4 * 2)
  })
})

/* ────────────────────────── retained salary ────────────────────────── */

describe('retentionCapSplit', () => {
  it('splits cap hit correctly', () => {
    const p = makePlayer('p', 80, { salary: 8_000_000, years: 3 })
    const { receiverHit, retainerHit } = retentionCapSplit(p, 4_000_000)
    expect(receiverHit).toBe(4_000_000)
    expect(retainerHit).toBe(4_000_000)
    expect(receiverHit + retainerHit).toBe(p.contract.salary)
  })

  it('supports partial retention', () => {
    const p = makePlayer('p', 80, { salary: 6_000_000, years: 2 })
    const { receiverHit, retainerHit } = retentionCapSplit(p, 1_500_000)
    expect(retainerHit).toBe(1_500_000)
    expect(receiverHit).toBe(4_500_000)
  })
})

describe('canRetain', () => {
  it('allows valid retention', () => {
    const p = makePlayer('p', 80, { salary: 8_000_000 })
    expect(canRetain(p, 0.50, [], 0)).toBeNull()
  })

  it('blocks retention over 50%', () => {
    const p = makePlayer('p', 80, { salary: 8_000_000 })
    expect(canRetain(p, 0.51, [], 0)).not.toBeNull()
    expect(canRetain(p, 0, [], 0)).not.toBeNull()
  })

  it('blocks when team already has MAX_RETAIN_SLOTS (3) other retained slots', () => {
    const p = makePlayer('p', 80, { salary: 8_000_000 })
    const existing: import('./trades').RetainedSalarySlot[] = [
      { playerId: asPlayerId('a'), retainedAmount: 1e6, expiryYear: 2027, retentionCount: 1 },
      { playerId: asPlayerId('b'), retainedAmount: 1e6, expiryYear: 2027, retentionCount: 1 },
      { playerId: asPlayerId('c'), retainedAmount: 1e6, expiryYear: 2027, retentionCount: 1 },
    ]
    expect(canRetain(p, 0.25, existing, 0)).not.toBeNull()
  })

  it('allows new slot for same player that replaces the existing slot (count < max)', () => {
    const p = makePlayer('p', 80, { salary: 8_000_000 })
    // 3 slots but one is for this player itself → effectively 2 others
    const existing: import('./trades').RetainedSalarySlot[] = [
      { playerId: p.id, retainedAmount: 2e6, expiryYear: 2027, retentionCount: 1 },
      { playerId: asPlayerId('b'), retainedAmount: 1e6, expiryYear: 2027, retentionCount: 1 },
      { playerId: asPlayerId('c'), retainedAmount: 1e6, expiryYear: 2027, retentionCount: 1 },
    ]
    // retentionCount 1 < MAX_RETAIN_TIMES(2) — should be allowed
    expect(canRetain(p, 0.25, existing, 1)).toBeNull()
  })

  it('blocks a contract already retained MAX_RETAIN_TIMES (2) times', () => {
    const p = makePlayer('p', 80, { salary: 8_000_000 })
    expect(canRetain(p, 0.25, [], 2)).not.toBeNull()
  })
})

/* ────────────────────────── team philosophy & needs ────────────────────────── */

describe('teamPhilosophy', () => {
  it('returns a valid philosophy for any team id', () => {
    const valid = new Set(['WinNow', 'FavorYoung', 'RebuildProspects', 'RebuildDraft', 'Balanced'])
    for (const id of ['team-1', 'team-2', 'nhl-team-10', 'abc', 'xyz']) {
      expect(valid.has(teamPhilosophy(asTeamId(id)))).toBe(true)
    }
  })

  it('is deterministic — same id always gives the same philosophy', () => {
    const id = asTeamId('stable-id')
    expect(teamPhilosophy(id)).toBe(teamPhilosophy(id))
  })
})

describe('buildTeamProfile', () => {
  it('detects needs when a group is below target', () => {
    // Team with only 5 forwards (target 12) and enough D/G
    const fwds = Array.from({ length: 5 }, (_, i) => makePlayer(`f${i}`, 70, { position: i < 3 ? 'C' : 'W' }))
    const defs = Array.from({ length: 6 }, (_, i) => makePlayer(`d${i}`, 68, { position: 'D' }))
    const goalies = Array.from({ length: 2 }, (_, i) => makePlayer(`g${i}`, 70, { position: 'G' }))
    const team = makeTeam('tn', [...fwds, ...defs, ...goalies])
    const players = new Map([...fwds, ...defs, ...goalies].map((p) => [p.id, p]))
    const profile = buildTeamProfile(team, players)
    expect(profile.needs).toContain('F')
    expect(profile.needs).not.toContain('D')
    expect(profile.needs).not.toContain('G')
  })

  it('reports no needs when roster is full', () => {
    const fwds = Array.from({ length: 12 }, (_, i) => makePlayer(`f${i}`, 70, { position: i < 6 ? 'C' : 'W' }))
    const defs = Array.from({ length: 6 }, (_, i) => makePlayer(`d${i}`, 68, { position: 'D' }))
    const goalies = Array.from({ length: 2 }, (_, i) => makePlayer(`g${i}`, 70, { position: 'G' }))
    const team = makeTeam('full', [...fwds, ...defs, ...goalies])
    const players = new Map([...fwds, ...defs, ...goalies].map((p) => [p.id, p]))
    const profile = buildTeamProfile(team, players)
    expect(profile.needs).toHaveLength(0)
  })
})

/* ────────────────────────── philosophy biases AI acceptance ────────────────────────── */

describe('evaluateProposal philosophy bias', () => {
  it('RebuildDraft partner values picks more — accepts a pick-heavy offer', () => {
    // Build a RebuildDraft team by brute-forcing a matching team id
    // teamPhilosophy uses char-code hash % 5; RebuildDraft = index 3.
    // Find an id that hashes to 3 by trying ids.
    let rebuildDraftId = ''
    for (let i = 0; i < 200; i++) {
      const tid = asTeamId(`rd-${i}`)
      if (teamPhilosophy(tid) === 'RebuildDraft') { rebuildDraftId = `rd-${i}`; break }
    }
    expect(rebuildDraftId).not.toBe('')

    const roster: Player[] = []
    for (let i = 0; i < 8; i++) roster.push(makePlayer(`r-f${i}`, 70, { position: i < 4 ? 'C' : 'W' }))
    for (let i = 0; i < 6; i++) roster.push(makePlayer(`r-d${i}`, 68, { position: 'D' }))
    for (let i = 0; i < 2; i++) roster.push(makePlayer(`r-g${i}`, 70, { position: 'G' }))
    const partnerTeam = makeTeam(rebuildDraftId, roster)
    const partnerPlayers = new Map(roster.map((p) => [p.id, p]))

    // Give one 1st + one 2nd; receive one 1st.
    // A balanced team would likely reject; a RebuildDraft team should be more favourable.
    const result = evaluateProposal({
      give: { players: [], picks: [makePick(2026, 1, 'u'), makePick(2026, 2, 'u')] },
      receive: { players: [], picks: [makePick(2026, 1, rebuildDraftId)] },
      partnerTeam,
      partnerPlayers,
      rng: new Rng(1)
    })
    // With RebuildDraft bias the incoming picks are valued 25% more — deal should accept
    expect(result.verdict).toBe('accept')
  })

  it('retained salary reduces cap hit counted against the partner', () => {
    const roster: Player[] = []
    for (let i = 0; i < 8; i++) roster.push(makePlayer(`rs-f${i}`, 70, { position: i < 4 ? 'C' : 'W' }))
    for (let i = 0; i < 5; i++) roster.push(makePlayer(`rs-d${i}`, 68, { position: 'D' }))
    for (let i = 0; i < 2; i++) roster.push(makePlayer(`rs-g${i}`, 70, { position: 'G' }))
    // Partner is near the cap
    const partnerTeam = makeTeam('rs', roster, { capUsed: 85_000_000 })
    partnerTeam.finances.salaryCap = 88_000_000
    const partnerPlayers = new Map(roster.map((p) => [p.id, p]))

    const expensivePlayer = makePlayer('star', 85, { salary: 4_000_000 })

    // Without retention: 85M + 4M = 89M > 88M cap → should reject
    const noRetain = evaluateProposal({
      give: { players: [expensivePlayer], picks: [] },
      receive: { players: [], picks: [] },
      partnerTeam,
      partnerPlayers,
      rng: new Rng(1)
    })
    expect(noRetain.verdict).toBe('reject')
    expect(noRetain.message).toMatch(/cap/i)

    // With 50% retention: incoming cap hit = 2M → 85M + 2M = 87M < 88M → passes cap check
    const withRetain = evaluateProposal({
      give: { players: [expensivePlayer], picks: [], retainedAmounts: new Map([[(expensivePlayer.id as string), 2_000_000]]) },
      receive: { players: [], picks: [] },
      partnerTeam,
      partnerPlayers,
      rng: new Rng(1)
    })
    // Cap check should pass now
    expect(withRetain.verdict).not.toBe('reject')
  })
})
