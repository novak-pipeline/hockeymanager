/**
 * Per-club valuation — the playtest's headline epic (docs/PLAYTEST-2026-07-31 §A).
 *
 * A1 — value is read as a meter, not a decimal.
 * A2 — THE KEYSTONE: there is no one true value. A rebuilder and a contender
 *      price the same player differently; a club thin at right defence pays a
 *      premium for right defence; a cap-strapped club discounts term.
 * A3 — trades are hard. Quantity does not buy quality and a cornerstone does
 *      not move for a package.
 *
 * Every test here FAILS against the pre-lens engine: before this, `playerValue`
 * was global, `evaluateProposal` priced the partner's OWN players at flat market,
 * and the "best asset" rule only bit at star level.
 */
import { describe, expect, it } from 'vitest'
import { Rng } from '@engine/shared/rng'
import type { Player, PlayerId, Team } from '@domain'
import {
  assetValueTier,
  clubDepthOf,
  clubPickValue,
  clubPlayerValue,
  contractLensMultiplier,
  evaluateProposal,
  playerValue,
  positionalFitMultiplier,
  type ClubLens,
  type ClubPostureKind,
} from './trades'
import { makePlayer, makeTeam, makePick } from './trades.test.fixtures'

/** A realistic NHL club: 12 F, 3L + 3R on the blue line, 2 G. */
function club(
  extra: Player[] = [],
  opts: { lefties?: number; righties?: number; capUsed?: number } = {},
): { team: Team; players: Map<PlayerId, Player> } {
  const roster: Player[] = []
  for (let i = 0; i < 12; i++) {
    roster.push(makePlayer(`f${i}`, 72 - (i % 5), { position: i % 3 === 0 ? 'C' : 'W', age: 26 + (i % 6) }))
  }
  for (let i = 0; i < (opts.lefties ?? 3); i++) {
    const p = makePlayer(`dl${i}`, 73 - i, { position: 'D', age: 26 })
    p.handedness = 'L'
    roster.push(p)
  }
  for (let i = 0; i < (opts.righties ?? 3); i++) {
    const p = makePlayer(`dr${i}`, 73 - i, { position: 'D', age: 26 })
    p.handedness = 'R'
    roster.push(p)
  }
  roster.push(makePlayer('g0', 77, { position: 'G', age: 28 }), makePlayer('g1', 68, { position: 'G', age: 26 }))
  roster.push(...extra)
  const team = makeTeam('club', roster, opts.capUsed === undefined ? {} : { capUsed: opts.capUsed })
  return { team, players: new Map(roster.map((p) => [p.id, p])) }
}

function lensOf(
  c: { team: Team; players: Map<PlayerId, Player> },
  posture: ClubPostureKind,
  over: Partial<ClubLens> = {},
): ClubLens {
  return {
    philosophy: 'Balanced',
    posture,
    depth: clubDepthOf(c.team, c.players),
    capSpace: c.team.finances.salaryCap - [...c.players.values()].reduce((s, p) => s + p.contract.salary, 0),
    deadlineProximity: 0.5,
    ...over,
  }
}

/** Sweep the mood distribution — a verdict that holds on one seed proves little. */
function sweep(args: {
  give: Player[]
  receivePlayers: Player[]
  c: { team: Team; players: Map<PlayerId, Player> }
  posture?: ClubPostureKind
}): { accept: number; counter: number; reject: number } {
  const out = { accept: 0, counter: 0, reject: 0 }
  for (let seed = 1; seed <= 20; seed++) {
    const r = evaluateProposal({
      give: { players: args.give, picks: [] },
      receive: { players: args.receivePlayers, picks: [] },
      partnerTeam: args.c.team,
      partnerPlayers: args.c.players,
      rng: new Rng(seed),
      ...(args.posture ? { context: { posture: args.posture, deadlineProximity: 0.5 } } : {}),
    })
    out[r.verdict === 'accept' ? 'accept' : r.verdict === 'counter' ? 'counter' : 'reject']++
  }
  return out
}

/* ───────────────────────── A2: no one true value ───────────────────────── */

describe('A2 — value is per-club, not global', () => {
  it('a rebuilder and a contender price the same 33-year-old differently', () => {
    const vet = makePlayer('vet', 80, { position: 'C', age: 33, salary: 7_000_000, years: 3 })
    const c = club([vet])
    const contend = clubPlayerValue(vet, lensOf(c, 'contend'))
    const rebuild = clubPlayerValue(vet, lensOf(c, 'rebuild'))
    // Not a rounding difference — a rebuilder writes a 33-year-old down hard.
    expect(rebuild).toBeLessThan(contend * 0.7)
    // And the market sits between the two extremes, not at one of them.
    expect(playerValue(vet)).toBeGreaterThan(rebuild)
  })

  it('…and the ordering INVERTS for a blue-chip 22-year-old', () => {
    const kid = makePlayer('kid', 77, { position: 'W', age: 22, potential: 89, salary: 950_000, years: 2 })
    const c = club([kid])
    const contend = clubPlayerValue(kid, lensOf(c, 'contend'))
    const rebuild = clubPlayerValue(kid, lensOf(c, 'rebuild'))
    expect(rebuild).toBeGreaterThan(contend * 1.25)
    // A rebuilder prices the ceiling the market only half-pays for.
    expect(rebuild).toBeGreaterThan(playerValue(kid) * 1.4)
  })

  it('a club thin at RIGHT defence pays a premium for a right-shot defenceman', () => {
    const rd = makePlayer('rd', 76, { position: 'D', age: 26 })
    rd.handedness = 'R'
    const deep = lensOf(club([], { lefties: 3, righties: 4 }), 'contend')
    const thin = lensOf(club([], { lefties: 5, righties: 1 }), 'contend')
    expect(clubPlayerValue(rd, thin)).toBeGreaterThan(clubPlayerValue(rd, deep) * 1.1)
    // The premium is about the SIDE, not the position: a lefty of identical
    // ability draws no such bump from the club with five of them.
    const ld = makePlayer('ld', 76, { position: 'D', age: 26 })
    ld.handedness = 'L'
    expect(clubPlayerValue(ld, thin)).toBeLessThan(clubPlayerValue(rd, thin))
    expect(positionalFitMultiplier(rd, thin)).toBeGreaterThan(positionalFitMultiplier(ld, thin))
  })

  it('a cap-strapped club discounts term and money', () => {
    const big = makePlayer('big', 80, { position: 'C', age: 28, salary: 9_000_000, years: 5 })
    const rich = lensOf(club(), 'contend', { capSpace: 40e6 })
    const strapped = lensOf(club(), 'contend', { capSpace: 2e6 })
    expect(contractLensMultiplier(big, strapped)).toBeLessThan(contractLensMultiplier(big, rich))
    expect(clubPlayerValue(big, strapped)).toBeLessThan(clubPlayerValue(big, rich) * 0.92)
  })

  it('picks are worth more to a seller than to a buyer', () => {
    const pick = makePick(2026, 1, 'u')
    const c = club()
    const rebuild = clubPickValue(pick, lensOf(c, 'rebuild'), { year: 2026 })
    const contend = clubPickValue(pick, lensOf(c, 'contend'), { year: 2026 })
    expect(rebuild).toBeGreaterThan(contend * 1.2)
  })

  it('the ASKING PRICE differs across the table for the same veteran', () => {
    const vet = makePlayer('vet', 80, { position: 'C', age: 33, salary: 7_000_000, years: 3 })
    const c = club([vet])
    const firstsToBuy = (posture: ClubPostureKind): number => {
      for (let n = 1; n <= 6; n++) {
        const r = evaluateProposal({
          give: { players: [], picks: Array.from({ length: n }, () => makePick(2026, 1, 'u')) },
          receive: { players: [vet], picks: [] },
          partnerTeam: c.team, partnerPlayers: c.players, rng: new Rng(4),
          context: { posture, deadlineProximity: 0.5 },
        })
        if (r.verdict === 'accept') return n
      }
      return 99
    }
    // The rebuilder is a willing seller; the contender wants his season's worth.
    expect(firstsToBuy('rebuild')).toBeLessThan(firstsToBuy('contend'))
  })

  it('the lens is applied SYMMETRICALLY — a club sells what it does not value', () => {
    // A rebuilder holding a 33-year-old is a seller: the SAME belief that makes
    // him cheap to acquire makes the club willing to move him. Before the lens,
    // the club valued its own player at flat market and this was impossible.
    const vet = makePlayer('vet', 79, { position: 'C', age: 33, salary: 6_000_000, years: 2 })
    const c = club([vet])
    const offer = makePlayer('young', 72, { position: 'C', age: 23, salary: 2_000_000, years: 3 })
    const rebuilder = sweep({ give: [offer], receivePlayers: [vet], c, posture: 'rebuild' })
    const contender = sweep({ give: [offer], receivePlayers: [vet], c, posture: 'contend' })
    expect(rebuilder.accept).toBeGreaterThan(0)
    expect(rebuilder.accept).toBeGreaterThan(contender.accept)
  })
})

/* ───────────────────── A3: trades are supposed to be hard ───────────────── */

describe('A3 — genuine reluctance', () => {
  it('quantity does not buy a top-four defenceman', () => {
    // MEASURED REGRESSION: this exact package was accepted 20/20 before the
    // lens landed — 45.5 market points of depth pieces for a 38.7-point
    // top-four D. No GM in the league makes that trade.
    const target = makePlayer('td', 76, { position: 'D', age: 27 })
    const c = club([target])
    const depth = [
      makePlayer('u1', 70, { age: 26 }), makePlayer('u2', 70, { age: 27 }),
      makePlayer('u3', 69, { age: 25 }), makePlayer('u4', 68, { age: 28 }),
    ]
    // The offer is a clear surplus on paper — and still gets a no.
    expect(depth.reduce((s, p) => s + playerValue(p), 0)).toBeGreaterThan(playerValue(target))
    const res = sweep({ give: depth, receivePlayers: [target], c })
    expect(res.accept).toBe(0)
    expect(res.reject).toBe(20)
  })

  it('a cornerstone does not move without a comparable player coming back', () => {
    const kid = makePlayer('kid', 80, { position: 'C', age: 23, potential: 90, salary: 950_000, years: 3 })
    const c = club([kid])
    const pile = [
      makePlayer('v1', 74, { position: 'W', age: 29 }),
      makePlayer('v2', 73, { position: 'W', age: 30 }),
      makePlayer('v3', 72, { position: 'D', age: 28 }),
    ]
    const res = evaluateProposal({
      give: { players: pile, picks: [makePick(2026, 1, 'u'), makePick(2027, 1, 'u')] },
      receive: { players: [kid], picks: [] },
      partnerTeam: c.team, partnerPlayers: c.players, rng: new Rng(3),
      context: { posture: 'rebuild', deadlineProximity: 0.5 },
    })
    expect(res.verdict).toBe('reject')
    expect(res.message).toMatch(/build around|not a package/i)
    // The club still names its price rather than just saying no.
    expect(res.counterAskValue).toBeGreaterThan(0)
  })

  it('the playtest trade: a blue-chip 22-year-old is not a 28-year-old winger', () => {
    // "a 22-year-old at 4★ current / 5★ potential offered straight up for Bryan
    // Rust (28, $5.13M×3) — no real GM makes that."
    const kid = makePlayer('kid', 77, { position: 'W', age: 22, potential: 89, salary: 950_000, years: 2 })
    const rust = makePlayer('rust', 77, { position: 'W', age: 28, salary: 5_130_000, years: 3 })
    const c = club([kid])
    for (const posture of ['contend', 'retool', 'rebuild'] as const) {
      const res = sweep({ give: [rust], receivePlayers: [kid], c, posture })
      expect(res.accept).toBe(0)
      expect(res.counter).toBe(0)
    }
  })

  it('a club will not swallow money it has no room for without being paid', () => {
    // Same hockey, two cap sheets. `rosterCapUsed` reads the live roster, so the
    // difference has to live in the actual contracts.
    const arriving = makePlayer('arrive', 78, { position: 'C', age: 27, salary: 7_000_000, years: 4 })
    const build = (perPlayer: number) => {
      const leaving = makePlayer('leave', 76, { position: 'C', age: 27, salary: 1_500_000, years: 3 })
      const c = club([leaving])
      for (const p of c.players.values()) if (p.id !== leaving.id) p.contract.salary = perPlayer
      return c
    }
    const roomy = build(3_000_000) // ≈ $60M committed, $28M of room
    const tight = build(4_000_000) // ≈ $80M committed, $6M of room
    const rank = (r: { accept: number; counter: number }): number => r.accept * 2 + r.counter
    expect(rank(sweep({ give: [arriving], receivePlayers: [tight.players.get(makePlayer('leave', 1).id)!], c: tight })))
      .toBeLessThan(rank(sweep({ give: [arriving], receivePlayers: [roomy.players.get(makePlayer('leave', 1).id)!], c: roomy })))
  })
})

/* ─────────────────────── A1: a meter, not a decimal ─────────────────────── */

describe('A1 — trade value reads as a tier and a meter', () => {
  it('tiers rise with value and every asset lands in a named band', () => {
    const samples = [2, 7, 13, 22, 36, 58, 110, 200]
    const tiers = samples.map((v) => assetValueTier(v).tier)
    for (let i = 1; i < tiers.length; i++) expect(tiers[i]!).toBeGreaterThanOrEqual(tiers[i - 1]!)
    expect(assetValueTier(2).label).toBe('Fringe')
    expect(assetValueTier(9).label).toBe('Depth')
    expect(assetValueTier(28).label).toBe('Core piece')
    expect(assetValueTier(150).label).toBe('Franchise')
  })

  it('the meter fill is bounded and monotone', () => {
    let prev = -1
    for (const v of [0, 1, 3, 10, 30, 90, 150, 400]) {
      const { fill } = assetValueTier(v)
      expect(fill).toBeGreaterThanOrEqual(0)
      expect(fill).toBeLessThanOrEqual(1)
      expect(fill).toBeGreaterThanOrEqual(prev)
      prev = fill
    }
  })

  it('a 1st-round pick and a middling roster player read as different tiers', () => {
    // The point of a tier word: it distinguishes what a decimal blurs.
    expect(assetValueTier(27.9).label).not.toBe(assetValueTier(9.5).label)
  })
})
