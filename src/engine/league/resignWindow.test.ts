/**
 * The June re-signing window (docs/PLAYTEST-2026-07-31.md §B).
 *
 * The failing-without-the-fix cases here are the four findings:
 *   §B4 — the ask AAV over MORE years used to be an automatic yes.
 *   §B1 — an offer used to be answered on the spot; now it is weighed, and the
 *          camp can come back with a NUMBER instead of a shrug.
 *   §B2 — qualifying offers did not exist at all.
 */
import { describe, expect, it } from 'vitest'
import {
  asPlayerId,
  type Personality,
  type Player,
  type Position,
  type RawAttributes,
} from '@domain'
import { computeComposites } from '@engine/ratings/composites'
import { Rng } from '@engine/shared/rng'
import {
  askTerms,
  offerAcceptable,
  qualifyingOffer,
  termPriceMultiplier,
  termSecurityScore,
} from './contracts'
import { defaultOffer, offerValue } from './negotiation'
import {
  acceptsQualifyingOffer,
  counterTerms,
  evaluateResignOffer,
  RESIGN_WINDOW_DAYS,
} from './resignWindow'

function flat(value: number): RawAttributes {
  return {
    technical: { wristShot: value, slapShot: value, stickhandling: value, passing: value, deflections: value, faceoffs: value },
    physical: { speed: value, acceleration: value, strength: value, balance: value, stamina: value, agility: value, height: value },
    mental: { offensiveIQ: value, defensiveIQ: value, positioning: value, vision: value, aggression: value, composure: value, workRate: value, discipline: value, anticipation: value },
    defensive: { checking: value, shotBlocking: value, stickChecking: value, takeaway: value },
  }
}

function mkSkater(
  id: string,
  value: number,
  age: number,
  personality: Partial<Personality> = {},
  salary = 1_000_000,
): Player {
  const position: Position = 'C'
  const raw = flat(value)
  return {
    id: asPlayerId(id),
    name: `Test ${id}`,
    age,
    position,
    handedness: 'L',
    role: 'twoWay',
    ratings: raw,
    potential: raw,
    composites: computeComposites(raw, 'twoWay', position),
    personality: { ambition: 10, professionalism: 10, loyalty: 10, temperament: 10, determination: 10, ...personality },
    contract: { salary, yearsRemaining: 0, expiryYear: 2026, noTradeClause: false, twoWay: false },
    stats: [],
    fatigue: 0,
    morale: 60,
    injuryStatus: null,
    form: 0,
  }
}

/* ────────────────────────── §B4: term costs money ────────────────────────── */

describe('§B4 — term is a concession the club buys, not free value', () => {
  it('prices every extra year above the ask, and never below 1.0', () => {
    const p = mkSkater('t1', 70, 26)
    expect(termPriceMultiplier(p, 3, 3)).toBe(1)
    expect(termPriceMultiplier(p, 3, 4)).toBeGreaterThan(1)
    expect(termPriceMultiplier(p, 3, 7)).toBeGreaterThan(termPriceMultiplier(p, 3, 4))
  })

  it('charges more for years bought on the wrong side of 30', () => {
    const kid = mkSkater('kid', 70, 22)
    const vet = mkSkater('vet', 70, 33)
    // Same three extra years — the 33-year-old's decline years cost more.
    expect(termPriceMultiplier(vet, 2, 5)).toBeGreaterThan(termPriceMultiplier(kid, 2, 5))
  })

  it('THE BUG: the asking AAV over more years is no longer an automatic yes', () => {
    // A 26-year-old asking $6M × 3. The club wants the same money over 7 years —
    // pure cost certainty for the club, three bought UFA years for him.
    const p = mkSkater('b4', 74, 26, { ambition: 10, loyalty: 10 })
    const ask = { salary: 6_000_000, years: 3 }
    const padded = { salary: ask.salary, years: 7 }
    for (let seed = 1; seed <= 10; seed++) {
      expect(offerAcceptable(p, ask, ask, new Rng(seed))).toBe(true)
      expect(offerAcceptable(p, padded, ask, new Rng(seed))).toBe(false)
    }
  })

  it('paying the priced number for the longer term DOES get it done', () => {
    const p = mkSkater('b4b', 74, 26, { ambition: 10, loyalty: 10 })
    const ask = { salary: 6_000_000, years: 3 }
    const priced = {
      salary: Math.ceil(ask.salary * termPriceMultiplier(p, ask.years, 7)),
      years: 7,
    }
    let yes = 0
    for (let seed = 1; seed <= 10; seed++) {
      if (offerAcceptable(p, priced, ask, new Rng(seed))) yes++
    }
    expect(yes).toBe(10)
  })

  it('the same rule binds the live negotiation table, not just the queue', () => {
    const p = mkSkater('b4c', 74, 26)
    const ask = defaultOffer(6_000_000, 3)
    const padded = { ...ask, years: 7 }
    expect(offerValue(p, ask, ask)).toBeCloseTo(1, 5)
    expect(offerValue(p, padded, ask)).toBeLessThan(1)
  })

  it('a short deal loses him the security he asked for', () => {
    const vet = mkSkater('sec', 70, 33, { loyalty: 16 })
    expect(termSecurityScore(vet, 4, 4)).toBe(1)
    expect(termSecurityScore(vet, 4, 1)).toBeLessThan(0.5)
  })
})

/* ──────────────────── §B1: offers are weighed, not obeyed ─────────────────── */

describe('§B1 — the camp answers with accept / counter / refuse', () => {
  const p = mkSkater('b1', 72, 27, { ambition: 10, loyalty: 10 })
  const ask = askTerms(p, 2026)

  it('takes the full ask', () => {
    const r = evaluateResignOffer({ player: p, offer: ask, ask, patience: 80, rng: new Rng(3) })
    expect(r.verdict).toBe('accept')
  })

  it('counters a near-miss with a real number, never below what you offered', () => {
    const offer = { salary: Math.round(ask.salary * 0.9), years: ask.years }
    const r = evaluateResignOffer({ player: p, offer, ask, patience: 80, rng: new Rng(3) })
    expect(r.verdict).toBe('counter')
    expect(r.counter).toBeDefined()
    expect(r.counter!.salary).toBeGreaterThanOrEqual(offer.salary)
    expect(r.counter!.years).toBe(offer.years)
    expect(r.lines.join(' ')).toContain('$')
    // A counter costs the camp patience — talks are not free.
    expect(r.patienceAfter).toBeLessThan(80)
  })

  it('a counter on padded term is priced above the bare ask', () => {
    const offer = { salary: ask.salary, years: ask.years + 3 }
    const c = counterTerms(p, offer, ask)
    expect(c.salary).toBeGreaterThan(ask.salary)
    expect(c.years).toBe(offer.years)
  })

  it('a lowball burns real patience and an empty camp walks', () => {
    const offer = { salary: Math.round(ask.salary * 0.6), years: ask.years }
    const soft = evaluateResignOffer({ player: p, offer, ask, patience: 80, rng: new Rng(3) })
    expect(soft.verdict).toBe('refuse')
    expect(soft.patienceAfter).toBeLessThan(70)

    const spent = evaluateResignOffer({ player: p, offer, ask, patience: 5, rng: new Rng(3) })
    expect(spent.verdict).toBe('walk')
    expect(spent.patienceAfter).toBe(0)
  })

  it('an unqualified RFA drives a harder bargain than a qualified one', () => {
    const marginal = { salary: Math.round(ask.salary * 0.99), years: ask.years }
    const qualified = evaluateResignOffer({ player: p, offer: marginal, ask, patience: 80, rng: new Rng(7), qualified: true })
    const walkedAway = evaluateResignOffer({ player: p, offer: marginal, ask, patience: 80, rng: new Rng(7), qualified: false })
    // Same offer, same seed: losing his restricted status can only cost you.
    expect(['accept', 'counter']).toContain(qualified.verdict)
    if (qualified.verdict === 'accept') expect(walkedAway.verdict).not.toBe('accept')
  })

  it('the window is a handful of days, not one press', () => {
    expect(RESIGN_WINDOW_DAYS).toBeGreaterThan(1)
  })
})

/* ───────────────────────── §B2: qualifying offers ────────────────────────── */

describe('§B2 — qualifying offers', () => {
  it('follows the CBA ladder off prior salary', () => {
    expect(qualifyingOffer(mkSkater('q1', 60, 24, {}, 800_000))).toBe(875_000) // 110%, rounded to 25k
    expect(qualifyingOffer(mkSkater('q2', 60, 24, {}, 1_500_000))).toBe(1_575_000)
    expect(qualifyingOffer(mkSkater('q3', 60, 24, {}, 5_000_000))).toBe(5_000_000)
  })

  it('never dips under the league minimum', () => {
    expect(qualifyingOffer(mkSkater('q4', 40, 20, {}, 100_000))).toBeGreaterThanOrEqual(750_000)
  })

  it('a depth RFA pockets a QO that meets his market; a star does not', () => {
    // Prior salary near his ask → the QO is real money to him.
    const depth = mkSkater('qd', 52, 24, { ambition: 6 }, 900_000)
    const depthAsk = askTerms(depth, 2026)
    const depthYes = Array.from({ length: 20 }, (_, i) => acceptsQualifyingOffer(depth, depthAsk, new Rng(i + 1))).filter(Boolean).length

    // A star coming off an entry-level number: the QO is a fraction of his ask.
    const star = mkSkater('qs', 84, 24, { ambition: 18 }, 925_000)
    const starAsk = askTerms(star, 2026)
    const starYes = Array.from({ length: 20 }, (_, i) => acceptsQualifyingOffer(star, starAsk, new Rng(i + 1))).filter(Boolean).length

    expect(depthYes).toBeGreaterThan(starYes)
    expect(starYes).toBeLessThan(5)
  })
})
