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
import { askTerms } from './contracts'
import {
  agentFor,
  defaultOffer,
  evaluateRound,
  faAskDecay,
  findComparables,
  offerValue,
  openNegotiation,
  openingLines,
  priorityHints,
  priorityWeights,
  type Comparable,
  type ContractOffer,
  type NegotiationState,
} from './negotiation'

function flat(value: number): RawAttributes {
  return {
    technical: { wristShot: value, slapShot: value, stickhandling: value, passing: value, deflections: value, faceoffs: value },
    physical: { speed: value, acceleration: value, strength: value, balance: value, stamina: value, agility: value, height: value },
    mental: { offensiveIQ: value, defensiveIQ: value, positioning: value, vision: value, aggression: value, composure: value, workRate: value, discipline: value, anticipation: value },
    defensive: { checking: value, shotBlocking: value, stickChecking: value, takeaway: value }
  }
}

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
    contract: { salary: 1_000_000, yearsRemaining: 0, expiryYear: 2026, noTradeClause: false, twoWay: false },
    stats: [],
    fatigue: 0,
    morale: 60,
    injuryStatus: null,
    form: 0
  }
}

const runRound = (
  state: NegotiationState,
  player: Player,
  offer: ContractOffer,
  seed = 1,
  comparables: Comparable[] = []
): ReturnType<typeof evaluateRound> =>
  evaluateRound(state, player, offer, { rng: new Rng(seed), comparables })

/** Commit a round result back into the state, the way the career layer does. */
function commit(state: NegotiationState, r: ReturnType<typeof evaluateRound>): NegotiationState {
  return {
    ...state,
    rounds: [...state.rounds, r.round],
    ask: r.ask,
    patience: r.patience,
    status: r.status,
    revealedHints: r.revealedHints,
  }
}

describe('agents and priorities', () => {
  it('agent persona is deterministic per player and axes are in range', () => {
    const p = mkSkater('p-101', 80, 27)
    const a1 = agentFor(p)
    const a2 = agentFor(p)
    expect(a1).toEqual(a2)
    for (const k of ['combative', 'patient', 'leaker', 'comparableFocus'] as const) {
      expect(a1[k]).toBeGreaterThanOrEqual(0)
      expect(a1[k]).toBeLessThanOrEqual(1)
    }
    expect(a1.name).toMatch(/\S+ \S+/)
  })

  it('different players usually get different agents', () => {
    const names = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((s) => agentFor(mkSkater(`p-${s}`, 70, 25)).name)
    )
    expect(names.size).toBeGreaterThan(2)
  })

  it('priority weights sum to ~1 and respond to personality', () => {
    const greedy = priorityWeights(mkSkater('p-1', 75, 25, { ambition: 19, loyalty: 3 }))
    const loyal = priorityWeights(mkSkater('p-2', 75, 25, { ambition: 3, loyalty: 19 }))
    const sum = greedy.money + greedy.term + greedy.loyalty + greedy.clauses
    expect(sum).toBeCloseTo(1, 5)
    expect(greedy.money).toBeGreaterThan(loyal.money)
    expect(loyal.loyalty).toBeGreaterThan(greedy.loyalty)
  })

  it('older players weight security and clauses higher', () => {
    const young = priorityWeights(mkSkater('p-y', 75, 22))
    const old = priorityWeights(mkSkater('p-o', 75, 31))
    expect(old.term).toBeGreaterThan(young.term)
    expect(old.clauses).toBeGreaterThan(young.clauses)
  })

  it('priority hints are ordered by weight', () => {
    const hints = priorityHints(mkSkater('p-h', 75, 25, { ambition: 20, loyalty: 1 }))
    expect(hints[0]).toContain('paid')
  })
})

describe('opening a negotiation', () => {
  it('anchors on askTerms and re-sign talks open slightly warmer', () => {
    const p = mkSkater('p-201', 78, 26)
    const base = askTerms(p, 2026)
    const fa = openNegotiation({ player: p, year: 2026, kind: 'freeAgent' })
    const re = openNegotiation({ player: p, year: 2026, kind: 'resign' })
    expect(Math.abs(fa.ask.salary - base.salary)).toBeLessThan(base.salary * 0.05)
    expect(re.ask.salary).toBeLessThan(fa.ask.salary)
    expect(fa.status).toBe('open')
    expect(fa.patience).toBeGreaterThan(40)
  })

  it('star veterans expect trade protection; kids do not', () => {
    const star = openNegotiation({ player: mkSkater('p-star', 92, 29), year: 2026, kind: 'freeAgent' })
    const kid = openNegotiation({ player: mkSkater('p-kid', 60, 21), year: 2026, kind: 'resign' })
    expect(star.ask.clause).not.toBe('none')
    expect(kid.ask.clause).toBe('none')
  })

  it('market heat raises the ask', () => {
    const p = mkSkater('p-hot', 80, 27)
    const cold = openNegotiation({ player: p, year: 2026, kind: 'freeAgent', marketHeat: 1 })
    const hot = openNegotiation({ player: p, year: 2026, kind: 'freeAgent', marketHeat: 1.12 })
    expect(hot.ask.salary).toBeGreaterThan(cold.ask.salary)
  })

  it('opening lines state the ask', () => {
    const p = mkSkater('p-ol', 75, 26)
    const s = openNegotiation({ player: p, year: 2026, kind: 'freeAgent' })
    const lines = openingLines(p, s, { comparables: [] })
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines.join(' ')).toContain('asking')
  })
})

describe('offer valuation', () => {
  it('meeting the full ask is worth ~1.0+', () => {
    const p = mkSkater('p-301', 75, 26)
    const s = openNegotiation({ player: p, year: 2026, kind: 'resign' })
    const v = offerValue(p, { ...s.ask }, s.ask)
    expect(v).toBeGreaterThanOrEqual(1.0)
  })

  it('clause-hungry veterans pay for protection', () => {
    const vet = mkSkater('p-vet', 84, 30, { loyalty: 18 })
    const s = openNegotiation({ player: vet, year: 2026, kind: 'resign' })
    const bare = offerValue(vet, { ...s.ask, clause: 'none' }, s.ask)
    const protectedOffer = offerValue(vet, { ...s.ask }, s.ask)
    expect(protectedOffer).toBeGreaterThan(bare)
  })

  it('a two-way offer insults an established player', () => {
    const p = mkSkater('p-tw', 78, 27)
    const s = openNegotiation({ player: p, year: 2026, kind: 'resign' })
    expect(offerValue(p, { ...s.ask, twoWay: true }, s.ask)).toBeLessThan(
      offerValue(p, { ...s.ask, twoWay: false }, s.ask)
    )
  })
})

describe('rounds', () => {
  it('a full-ask offer is accepted and the session signs', () => {
    const p = mkSkater('p-401', 76, 27)
    const s = openNegotiation({ player: p, year: 2026, kind: 'resign' })
    const r = runRound(s, p, { ...s.ask })
    expect(r.round.verdict).toBe('accept')
    expect(r.status).toBe('signed')
    expect(r.round.agentLines.length).toBeGreaterThan(0)
  })

  it('a near-miss offer draws a counter with a softened ask', () => {
    const p = mkSkater('p-402', 76, 27)
    const s = openNegotiation({ player: p, year: 2026, kind: 'resign' })
    const offer = { ...s.ask, salary: Math.round(s.ask.salary * 0.9) }
    const r = runRound(s, p, offer)
    expect(r.round.verdict).toBe('close')
    expect(r.status).toBe('open')
    expect(r.ask.salary).toBeLessThan(s.ask.salary)
    expect(r.ask.salary).toBeGreaterThan(offer.salary)
  })

  it('haggling upward from a fair start converges to a signing', () => {
    const p = mkSkater('p-403', 76, 27)
    let s = openNegotiation({ player: p, year: 2026, kind: 'resign' })
    const opening = s.ask.salary
    let signed = false
    for (let i = 0; i < 10 && !signed; i++) {
      // The GM raises his number 2% a round while the agent's ask softens —
      // the two meet in the middle, like a real table.
      const offer = {
        ...s.ask,
        salary: Math.round((opening * (0.9 + 0.02 * i)) / 25_000) * 25_000,
      }
      const r = runRound(s, p, offer, 100 + i)
      s = commit(s, r)
      signed = s.status === 'signed'
    }
    expect(signed).toBe(true)
  })

  it('lowballs burn patience and repeated lowballs end the talks', () => {
    const p = mkSkater('p-404', 80, 28)
    let s = openNegotiation({ player: p, year: 2026, kind: 'freeAgent' })
    const lowball = { ...defaultOffer(Math.round(s.ask.salary * 0.5), 1) }
    let ended = false
    for (let i = 0; i < 6 && !ended; i++) {
      const r = runRound(s, p, lowball, 200 + i)
      expect(r.patience).toBeLessThan(s.patience)
      s = commit(s, r)
      ended = s.status !== 'open'
    }
    expect(ended).toBe(true)
    expect(['walked', 'paused']).toContain(s.status)
  })

  it('a lowballed re-sign pauses rather than walks (rights retained)', () => {
    const p = mkSkater('p-405', 70, 24)
    let s = openNegotiation({ player: p, year: 2026, kind: 'resign' })
    // 0.65×ask: a bad offer but not quite an insult — burns patience to pause.
    const grind = { ...defaultOffer(Math.round(s.ask.salary * 0.65), s.ask.years) }
    for (let i = 0; i < 8 && s.status === 'open'; i++) {
      s = commit(s, runRound(s, p, grind, 300 + i))
    }
    expect(s.status).toBe('paused')
  })

  it('comparables get cited by comparable-focused agents', () => {
    // Find a player whose hash-derived agent argues from comparables.
    let p: Player | null = null
    for (let i = 0; i < 60 && !p; i++) {
      const cand = mkSkater(`p-cmp-${i}`, 78, 27)
      if (agentFor(cand).comparableFocus > 0.6) p = cand
    }
    expect(p).not.toBeNull()
    const s = openNegotiation({ player: p!, year: 2026, kind: 'freeAgent' })
    const comps: Comparable[] = [
      { name: 'Rich Deal', teamAbbr: 'RIC', overall: 78, age: 27, salary: 7_000_000, years: 6 },
    ]
    const offer = { ...s.ask, salary: Math.round(s.ask.salary * 0.88) }
    const r = evaluateRound(s, p!, offer, { rng: new Rng(5), comparables: comps })
    expect(r.round.agentLines.join(' ')).toContain('Rich Deal')
  })

  it('barter moves reveal priorities', () => {
    const vet = mkSkater('p-406', 85, 29, { loyalty: 19 })
    const s = openNegotiation({ player: vet, year: 2026, kind: 'resign' })
    expect(s.ask.clause).not.toBe('none')
    const offer = { ...s.ask, clause: 'none' as const, salary: Math.round(s.ask.salary * 0.95) }
    const r = runRound(s, vet, offer)
    expect(r.round.verdict).toBe('close')
    expect(r.revealedHints.length).toBeGreaterThan(0)
  })
})

describe('findComparables', () => {
  it('returns nearest-overall players, richer deals first on ties', () => {
    const p = mkSkater('p-501', 75, 26)
    const pool: Comparable[] = [
      { name: 'Close Cheap', teamAbbr: 'A', overall: 75, age: 26, salary: 4_000_000, years: 4 },
      { name: 'Close Rich', teamAbbr: 'B', overall: 75, age: 27, salary: 6_000_000, years: 5 },
      { name: 'Far', teamAbbr: 'C', overall: 88, age: 26, salary: 9_000_000, years: 8 },
      { name: 'Old', teamAbbr: 'D', overall: 75, age: 35, salary: 5_000_000, years: 2 },
    ]
    const comps = findComparables(p, pool)
    expect(comps.map((c) => c.name)).toEqual(['Close Rich', 'Close Cheap'])
  })
})

describe('faAskDecay', () => {
  it('is neutral on day 0 and softens the ask the longer a FA waits, to an 82% floor', () => {
    expect(faAskDecay(0)).toBe(1)
    expect(faAskDecay(5)).toBeCloseTo(0.9, 5)
    expect(faAskDecay(9)).toBeCloseTo(0.82, 5)
    expect(faAskDecay(30)).toBe(0.82) // floored
    expect(faAskDecay(-3)).toBe(1) // guards negative
  })
})
