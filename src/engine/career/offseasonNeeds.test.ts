import { describe, expect, it } from 'vitest'
import { buildNeeds, leagueBenchmark, needsFor, type DepthEntry, type NeedsCandidate } from './offseasonNeeds'
import { generateLeague } from '@data/generate'
import { Career } from './career'
import { askTerms, faClassDecisionDay, rankOffers, type FaMarketBid } from '@engine/league/contracts'
import type { TeamId } from '@domain'
import { overallToStars } from '@engine/ratings/composites'

const d = (id: string, group: 'F' | 'D' | 'G', ovr: number, over: Partial<DepthEntry> = {}): DepthEntry => ({
  playerId: id, name: id, position: group === 'F' ? 'C' : group, group, hand: 'L', ovr, salary: 1e6, age: 27, ...over,
})
const cand = (id: string, group: 'F' | 'D' | 'G', ovr: number, over: Partial<NeedsCandidate> = {}): NeedsCandidate => ({
  kind: 'fa', playerId: id, name: id, position: group === 'F' ? 'C' : group, group, age: 28, overall: ovr, hand: 'L',
  capHit: 2e6, years: 2, cost: 'x', assetValue: 10, assetTier: 'Depth', ...over,
})

/** A club at league par everywhere except where a test says otherwise. */
function parDepth(): DepthEntry[] {
  const out: DepthEntry[] = []
  for (let i = 0; i < 12; i++) out.push(d(`f${i}`, 'F', 80 - i * 1.5, { position: i % 3 === 1 ? 'C' : 'W' }))
  for (let i = 0; i < 6; i++) out.push(d(`d${i}`, 'D', 78 - i * 2, { hand: i % 2 === 0 ? 'L' : 'R' }))
  out.push(d('g0', 'G', 80), d('g1', 'G', 70))
  return out
}
const bench = leagueBenchmark([parDepth().map((x) => ({ group: x.group, ovr: x.ovr }))])

describe('needs builder', () => {
  it('a par roster has no needs', () => {
    const r = buildNeeds({ depth: parDepth(), benchmark: bench, capCeiling: 90e6, committed: 70e6, pool: [], moveable: [] })
    expect(r.needs).toHaveLength(0)
    expect(r.headline).toMatch(/No holes/)
  })

  it('names a weak backup and a pair with no left shot, in hockey words, with real answers', () => {
    const depth = parDepth()
      .map((x) => (x.playerId === 'g1' ? { ...x, ovr: 60 } : x))
      .map((x) => (x.playerId === 'd2' ? { ...x, hand: 'R' as const } : x))
    const pool = [
      cand('backup-fa', 'G', 69), cand('backup-trade', 'G', 72, { kind: 'trade', teamAbbr: 'SJS' }), cand('bad-g', 'G', 58),
      cand('lhd-fa', 'D', 76, { hand: 'L' }), cand('rhd-fa', 'D', 77, { hand: 'R' }),
    ]
    const r = buildNeeds({ depth, benchmark: bench, capCeiling: 90e6, committed: 70e6, pool, moveable: [] })
    const g = r.needs.find((n) => n.label === 'a backup G')!
    expect(g).toBeDefined()
    expect(g.candidates.map((c) => c.playerId).sort()).toEqual(['backup-fa', 'backup-trade'])
    expect(g.candidates.every((c) => c.fit.includes('over g1'))).toBe(true)
    const dNeed = r.needs.find((n) => /2nd-pair LHD/.test(n.label))!
    expect(dNeed).toBeDefined()
    expect(dNeed.candidates[0]!.playerId).toBe('lhd-fa') // the hand the pair lacks
    expect(r.headline).toContain('a backup G')
    // Each slot need carries its search criteria for "See more".
    // …in the stars the UI shows, never the hidden overall.
    expect(g.criteria).toEqual({ group: 'G', minStars: overallToStars(bench.G[1]!) })
    expect(dNeed.criteria).toMatchObject({ group: 'D', hand: 'L' })
  })

  it('a cap need appears when filling the holes would break the ceiling, with the contracts that clear it', () => {
    const depth = parDepth().map((x) => (x.playerId === 'g0' ? { ...x, ovr: 60 } : x))
    const pool = [cand('starter', 'G', 82, { capHit: 8e6 })]
    const moveable = [
      cand('big', 'F', 70, { kind: 'move', capHit: 7e6, assetValue: 5 }),
      cand('mid', 'D', 72, { kind: 'move', capHit: 3e6, assetValue: 10 }),
    ]
    const r = buildNeeds({ depth, benchmark: bench, capCeiling: 90e6, committed: 86e6, pool, moveable })
    const cap = r.needs.find((n) => n.kind === 'cap')!
    expect(cap.amount).toBe(4e6)
    expect(cap.label).toBe('$4.0M of cap space')
    expect(cap.candidates[0]!.playerId).toBe('big') // dearest per unit of value first
    expect(r.headline).toMatch(/^You need: a starting goalie, .*\$4\.0M of cap space$/)
  })

  it('at most five answers per need, and one man answers one need', () => {
    const depth = parDepth().map((x) => (x.group === 'F' && Number(x.playerId.slice(1)) >= 6 ? { ...x, ovr: 55 } : x))
    const pool = Array.from({ length: 12 }, (_, i) => cand(`fa${i}`, 'F', 70 + i))
    const r = buildNeeds({ depth, benchmark: bench, capCeiling: 90e6, committed: 60e6, pool, moveable: [] })
    const ids = r.needs.flatMap((n) => n.candidates.map((c) => c.playerId))
    expect(new Set(ids).size).toBe(ids.length)
    for (const n of r.needs) expect(n.candidates.length).toBeLessThanOrEqual(5)
  })
})

describe('needs board — each desk shows its own kind of answer', () => {
  // A weak backup (answers from both markets), a D pair with only trade
  // answers, and a cap need (answers are contracts to move).
  function mixed() {
    const depth = parDepth()
      .map((x) => (x.playerId === 'g1' ? { ...x, ovr: 60 } : x))
      .map((x) => (x.playerId === 'd4' ? { ...x, ovr: 60 } : x))
    const pool = [
      cand('g-fa', 'G', 68), cand('g-own', 'G', 66, { kind: 'resign' }), cand('g-tr', 'G', 72, { kind: 'trade', teamAbbr: 'DAL' }),
      cand('d-tr1', 'D', 76, { kind: 'trade', teamAbbr: 'EDM' }), cand('d-tr2', 'D', 74, { kind: 'trade', teamAbbr: 'SJS' }),
    ]
    const moveable = [cand('big', 'F', 70, { kind: 'move', capHit: 9e6, assetValue: 5 })]
    return buildNeeds({ depth, benchmark: bench, capCeiling: 90e6, committed: 89e6, pool, moveable }).needs
  }

  it('the Free Agents desk: free agents and your own re-sign candidates only — never a trade target', () => {
    const view = needsFor(mixed(), 'fa')
    for (const n of view) {
      for (const g of n.groups) for (const c of g.candidates) expect(['fa', 'resign']).toContain(c.kind)
    }
    const g = view.find((n) => n.label === 'a backup G')!
    expect(g.groups[0]!.candidates.map((c) => c.playerId).sort()).toEqual(['g-fa', 'g-own'])
    // A need with no free-agent answer is KEPT, with a pointer to the other desk.
    const d = view.find((n) => n.group === 'D')!
    expect(d.groups[0]!.candidates).toHaveLength(0)
    expect(d.elsewhere).toEqual({ text: 'No free agents fit — see the Trade Centre.', screen: 'trades' })
    const cap = view.find((n) => n.kind === 'cap')!
    expect(cap.elsewhere?.screen).toBe('trades')
  })

  it('the Trade Centre: trade targets, and for a cap need the contracts that would clear it', () => {
    const view = needsFor(mixed(), 'trade')
    for (const n of view) {
      for (const gr of n.groups) for (const c of gr.candidates) expect(['trade', 'move']).toContain(c.kind)
    }
    expect(view.find((n) => n.label === 'a backup G')!.groups[0]!.candidates.map((c) => c.playerId)).toEqual(['g-tr'])
    const cap = view.find((n) => n.kind === 'cap')!
    expect(cap.groups[0]!.title).toBe('Contracts that would clear it')
    expect(cap.groups[0]!.candidates.map((c) => c.playerId)).toEqual(['big'])
    expect(cap.elsewhere).toBeUndefined()
  })

  it('the offseason overview: both, grouped as "Free agents" and "Trade targets"', () => {
    const view = needsFor(mixed(), 'all')
    const g = view.find((n) => n.label === 'a backup G')!
    expect(g.groups.map((x) => x.title)).toEqual(['Free agents', 'Trade targets'])
    expect(view.every((n) => n.groups.length > 0 || n.elsewhere)).toBe(true)
  })

  it('each market keeps up to five answers of its own even when the other has more', () => {
    const depth = parDepth().map((x) => (x.playerId === 'g1' ? { ...x, ovr: 55 } : x))
    const pool = [
      ...Array.from({ length: 7 }, (_, i) => cand(`t${i}`, 'G', 75 + i, { kind: 'trade' })),
      cand('only-fa', 'G', 60),
    ]
    const n = buildNeeds({ depth, benchmark: bench, capCeiling: 90e6, committed: 60e6, pool, moveable: [] }).needs[0]!
    expect(needsFor([n], 'fa')[0]!.groups[0]!.candidates.map((c) => c.playerId)).toEqual(['only-fa'])
    expect(needsFor([n], 'trade')[0]!.groups[0]!.candidates).toHaveLength(5)
  })
})

describe('the July market — real bids, a July 1 frenzy', () => {
  it('the frenzy: the top of the class decides on day 1, then six a day', () => {
    expect(faClassDecisionDay(0, 100, 0)).toBe(1)
    expect(faClassDecisionDay(24, 100, 0)).toBe(1)
    expect(faClassDecisionDay(25, 100, 0)).toBe(2)
    expect(faClassDecisionDay(31, 100, 0)).toBe(3)
    expect(faClassDecisionDay(-1, 100, 4)).toBe(4) // joined late: decides when asked
    expect(faClassDecisionDay(11, 20, 0)).toBe(1) // a small class still gets a frenzy
  })

  it("the reason he gives is what sets an offer apart, not the money every offer shares", () => {
    const data = generateLeague({ seed: 515 })
    const p = [...data.players.values()].find((x) => x.position !== 'G' && x.age >= 30)!
    const ask = askTerms(p, 2026)
    const bids: FaMarketBid[] = [
      { teamId: 'rich' as TeamId, salary: Math.round(ask.salary * 1.15), years: ask.years, upgrade: 3, want: 3 },
      { teamId: 'champ' as TeamId, salary: ask.salary, years: ask.years, upgrade: 3, want: 3 },
    ]
    const ranks: Record<string, number> = { rich: 30, champ: 1 }
    const out = rankOffers({ player: p, bids, year: 2026, strengthRankOf: (t) => ranks[t as string] ?? 16, nTeams: 32 })
    expect(out.find((c) => c.bid.teamId === 'champ')!.reason).toBe('a chance to win')
    expect(out.find((c) => c.bid.teamId === 'rich')!.reason).toBe('the money')
  })

  function julyCareer(): Career {
    for (const seed of [515, 616, 7, 42]) {
      const data = generateLeague({ seed })
      const c = new Career(data, seed, data.league.teams[0])
      c.startAtOffseason()
      for (let i = 0; i < 20 && c.getOffseason()?.stage !== 'freeAgency'; i++) c.advanceOffseason()
      const hub = c.getFaHub()
      if (c.getOffseason()?.stage === 'freeAgency' && hub.rows.some((r) => (r.bids ?? []).length >= 2 && r.decidesInDays <= 1)) return c
    }
    throw new Error('no seed opened July with a contested free agent')
  }

  it('the hub shows REAL bids, and the man signs with one of the clubs shown', () => {
    const c = julyCareer()
    const hub = c.getFaHub()
    expect(hub.faDay).toBe(0)
    const row = hub.rows.find((r) => (r.bids ?? []).length >= 2 && r.decidesInDays <= 1)!
    const shown = new Set(row.bids!.map((b) => b.teamId))
    expect(row.bids![0]!.leading).toBe(true)
    expect(row.lean).toMatch(/^Leaning [A-Z]{2,4}: /)
    // The frenzy is July 1 itself: press once and the market moves.
    c.advanceOffseason()
    expect(c.getInbox().items.some((n) => n.headline.startsWith('FRENZY'))).toBe(true)
    // ...and the July wire carries it, dated July 1, with the bidding behind it.
    const wire = c.getOffseason()!.faWire ?? []
    expect(wire.length).toBeGreaterThan(0)
    expect(wire.every((w) => w.day === 1)).toBe(true)
    expect(wire.some((w) => (w.suitors ?? 0) >= 1 && !!w.reason)).toBe(true)
    const after = c.getFaHub().rows.find((r) => r.playerId === row.playerId)
    if (!after) {
      const signedWith = [...(c as unknown as { data: { teams: Map<string, { id: string; roster: string[] }> } }).data.teams.values()]
        .find((t) => t.roster.includes(row.playerId))
      expect(signedWith).toBeDefined()
      expect(shown.has(signedWith!.id)).toBe(true)
    }
  }, 60_000)

  it('a standing offer competes with the real bids: lead the field and he signs, lowball and he holds out', () => {
    const c = julyCareer()
    const hub = c.getFaHub()
    // Raise the money until the read says we lead the REAL field.
    let rich: (typeof hub.rows)[number] | undefined
    for (const r of hub.rows.filter((x) => (x.bids ?? []).length >= 1 && x.decidesInDays <= 1)) {
      for (const mult of [1.2, 1.6, 2.2, 3]) {
        const salary = Math.round((r.askSalary * mult) / 25000) * 25000
        if (salary > hub.capSpace) break
        c.submitFaOffer(r.playerId, salary, r.askYears)
        if (c.getFaHub().rows.find((x) => x.playerId === r.playerId)!.pendingOffer!.standing === 'leading') { rich = r; break }
      }
      if (rich) break
    }
    expect(rich).toBeDefined()
    const note = c.getFaHub().rows.find((x) => x.playerId === rich!.playerId)!.pendingOffer!.standingNote
    expect(note).toMatch(/he'd pick you today/)
    const low = hub.rows.find((r) => r.playerId !== rich!.playerId && r.decidesInDays <= 1)
    if (low) expect(c.submitFaOffer(low.playerId, Math.round(low.askSalary * 0.5 / 25000) * 25000, low.askYears).ok).toBe(true)
    c.advanceOffseason()
    const inbox = c.getInbox().items
    const won = inbox.find((n) => n.headline === `${rich!.name} signs with you!`)
    expect(won).toBeDefined()
    if (low) expect(inbox.some((n) => n.headline === `${low.name} passes on your offer` && /holding out/.test(n.body))).toBe(true)
  }, 60_000)

  it('losing a man names the club that won him, its money and his reason — in YOUR inbox', () => {
    const c = julyCareer()
    const hub = c.getFaHub()
    let target: (typeof hub.rows)[number] | undefined
    for (const r of hub.rows.filter((x) => (x.bids ?? []).length >= 2 && x.decidesInDays <= 1 && x.askSalary < hub.capSpace)) {
      c.submitFaOffer(r.playerId, r.askSalary, r.askYears)
      if (c.getFaHub().rows.find((x) => x.playerId === r.playerId)!.pendingOffer!.standing === 'trailing') { target = r; break }
    }
    if (!target) return // every contested man would pick us today: nothing to lose
    c.advanceOffseason()
    const inbox = c.getInbox().items
    const loss = inbox.find((n) => n.headline.startsWith(`You lose ${target!.name} to `))
    const won = inbox.find((n) => n.headline === `${target!.name} signs with you!`)
    expect(loss ?? won).toBeDefined()
    if (loss) expect(loss.body).toMatch(/against your \$[\d.]+M × \d+\. His camp says it came down to (the money|the term|a chance to win|the role)\./)
  }, 60_000)
})
