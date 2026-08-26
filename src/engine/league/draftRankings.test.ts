import { describe, expect, it } from 'vitest'
import { analystProjection, analystRank, ceilingRole, draftEligibility, draftRoundLabel, perceivedCeiling, productionPremium, productionRankBonus, productionWeight, projectionHedge, type RankInput } from './draftRankings'

describe('draftRoundLabel', () => {
  it('maps a full-ordering rank to a round/standing', () => {
    expect(draftRoundLabel(1)).toBe('R1 · #1')
    expect(draftRoundLabel(33)).toBe('R2 · #33')
    expect(draftRoundLabel(96)).toBe('R3 · #96')
    expect(draftRoundLabel(300)).toBe('Undrafted proj.')
    expect(draftRoundLabel(undefined)).toBe('Unranked')
    expect(draftRoundLabel(20, 'radar')).toBe('Future class')
  })
})

describe('draftEligibility', () => {
  it('buckets by age and excludes drafted / out-of-range', () => {
    expect(draftEligibility(13, false)).toBeNull()
    expect(draftEligibility(14, false)).toBe('radar')
    expect(draftEligibility(16, false)).toBe('radar')
    expect(draftEligibility(17, false)).toBe('eligible')
    expect(draftEligibility(18, false)).toBe('eligible')
    expect(draftEligibility(19, false)).toBe('reentry')
    expect(draftEligibility(20, false)).toBe('reentry')
    expect(draftEligibility(21, false)).toBeNull()
    expect(draftEligibility(18, true)).toBeNull() // already drafted
  })
})

const pool: RankInput[] = Array.from({ length: 40 }, (_, i) => ({
  id: `p${i}`,
  ceiling: 50 + (i % 20) * 2, // spread of ceilings
  current: 40 + (i % 15),
}))

describe('analystRank', () => {
  it('ranks higher-ceiling prospects near the top', () => {
    const order = analystRank(pool, 'final')
    const top = order.slice(0, 5).map((id) => pool.find((p) => p.id === id)!.ceiling)
    const bottom = order.slice(-5).map((id) => pool.find((p) => p.id === id)!.ceiling)
    const avg = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length
    expect(avg(top)).toBeGreaterThan(avg(bottom))
  })

  it('is deterministic within a phase', () => {
    expect(analystRank(pool, 'midseason')).toEqual(analystRank(pool, 'midseason'))
  })

  it('shuffles between phases (the board evolves)', () => {
    const prelim = analystRank(pool, 'preliminary')
    const final = analystRank(pool, 'final')
    expect(prelim).not.toEqual(final)
  })

  it('returns every prospect exactly once', () => {
    const order = analystRank(pool, 'preliminary')
    expect(new Set(order).size).toBe(pool.length)
  })

  it('fades goalies below an equal-ceiling skater', () => {
    const inputs: RankInput[] = [
      { id: 'g', ceiling: 90, current: 70, position: 'G' },
      { id: 'f', ceiling: 90, current: 70, position: 'C' },
    ]
    // Across phases the skater should consistently rank ahead of the goalie.
    for (const ph of ['preliminary', 'midseason', 'final'] as const) {
      expect(analystRank(inputs, ph).indexOf('f')).toBeLessThan(analystRank(inputs, ph).indexOf('g'))
    }
  })

  it('productionPremium rewards producers and dings non-producers', () => {
    // Strong junior producer (1.3 PPG forward in a 0.30-strength league) → real lift.
    expect(productionPremium(1.3, false, 0.30)).toBeGreaterThanOrEqual(6)
    // A defenceman needs less scoring to impress.
    expect(productionPremium(0.9, true, 0.30)).toBeGreaterThan(productionPremium(0.9, false, 0.30))
    // Low producer → negative.
    expect(productionPremium(0.3, false, 0.30)).toBeLessThan(0)
    // Same rate in a tougher league is worth more.
    expect(productionPremium(0.6, false, 0.50)).toBeGreaterThan(productionPremium(0.6, false, 0.25))
    // No sample → neutral.
    expect(productionPremium(0, false, 0.30)).toBe(0)
    // Bounded — production is a strong driver but still can't fully override pedigree.
    expect(productionPremium(3, false, 1)).toBeLessThanOrEqual(28)
  })
  it('productionPremium keeps separating prospects past 2.5x par (no saturation)', () => {
    // The old linear curve flattened at its cap around 2.5x par, so a historic
    // season read the same as a merely very good one — which is how a 141-point
    // 18-year-old came out ranked #60. Each further doubling must still register.
    const good = productionPremium(0.55, false, 0.30) // ~0.75x par
    const great = productionPremium(1.10, false, 0.30) // ~1.5x par
    const historic = productionPremium(2.20, false, 0.30) // ~3x par
    expect(great).toBeGreaterThan(good + 5)
    expect(historic).toBeGreaterThan(great + 5)
  })
  it('productionPremium is age-adjusted — a younger producer gets more credit', () => {
    // Same NHLe-translated output: a 17-year-old is rated above a passed-over 20yo.
    const young = productionPremium(1.2, false, 0.30, 17)
    const older = productionPremium(1.2, false, 0.30, 20)
    expect(young).toBeGreaterThan(older)
    // A young no-show isn't penalised harder than an older one (it's a project).
    expect(productionPremium(0.2, false, 0.30, 17)).toBe(productionPremium(0.2, false, 0.30, 20))
  })

  it('production feeds the perceived ceiling', () => {
    expect(perceivedCeiling(70, 18, 8)).toBe(perceivedCeiling(70, 18, 0) + 8)
  })

  it('perceivedCeiling adds an optimism premium that fades with age', () => {
    // Younger prospects carry more hype above their true ceiling.
    expect(perceivedCeiling(70, 17)).toBeGreaterThan(perceivedCeiling(70, 20))
    expect(perceivedCeiling(70, 17)).toBeGreaterThan(70) // always optimistic vs truth
    expect(perceivedCeiling(99, 17)).toBeLessThanOrEqual(99)        // clamped
    expect(perceivedCeiling(99, 17)).toBeGreaterThanOrEqual(88)     // an elite ceiling still reads top-tier
  })

  it('keeps FRANCHISE (5★) projections rare — hype does not push the whole top to elite', () => {
    // A solid-but-not-elite ceiling (true ~78, a 4★) with full youth hype should
    // NOT read as a 5★ (88+) franchise projection — it compresses into the 4–4.5★ band.
    expect(perceivedCeiling(78, 17)).toBeLessThan(88)
    // Only a genuinely elite true ceiling reaches the top.
    expect(perceivedCeiling(95, 18)).toBeGreaterThanOrEqual(88)
  })

  // E1 (playtest 2026-07-31): the board ignored production. A draft-eligible kid
  // with a 141-point season was ranked #60 behind prospects who had done nothing,
  // because the score was tools-only. Production is now a first-class ranking term.
  describe('production drives the board', () => {
    /** 64 tools-ranked prospects; `elite` sits in the BOTTOM THIRD on tools. */
    const field = (eliteProduction: number): RankInput[] => [
      ...Array.from({ length: 64 }, (_, i) => ({
        id: `p${i}`,
        ceiling: 88 - i * 0.5, // p0 best tools … p63 worst
        current: 66 - i * 0.3,
        position: 'C',
        production: 0,
      })),
      { id: 'elite', ceiling: 66, current: 48, position: 'C', production: eliteProduction },
    ]

    it('an elite producer cannot rank outside the top 25', () => {
      // productionRankBonus for a 2x-par 18-year-old — the Fyodorov case.
      const bonus = productionRankBonus(2.2, false, 0.24, 18)
      expect(bonus).toBeGreaterThan(14)
      for (const phase of ['preliminary', 'midseason', 'final'] as const) {
        const rank = analystRank(field(bonus), phase).indexOf('elite') + 1
        expect(rank).toBeGreaterThan(0)
        expect(rank).toBeLessThanOrEqual(25)
      }
      // …and with production ignored (the old behaviour) the same prospect sinks
      // deep into the board, which is exactly the bug.
      expect(analystRank(field(0), 'final').indexOf('elite') + 1).toBeGreaterThan(40)
    })

    it('a no-show slides below an equal-tools prospect who produced', () => {
      const inputs: RankInput[] = [
        { id: 'quiet', ceiling: 80, current: 60, position: 'C', production: productionRankBonus(0.3, false, 0.30, 18) },
        { id: 'loud', ceiling: 80, current: 60, position: 'C', production: productionRankBonus(1.3, false, 0.30, 18) },
      ]
      for (const phase of ['preliminary', 'midseason', 'final'] as const) {
        expect(analystRank(inputs, phase).indexOf('loud')).toBeLessThan(analystRank(inputs, phase).indexOf('quiet'))
      }
    })

    it('weights production more heavily as the body of work grows', () => {
      expect(productionWeight('preliminary')).toBeLessThan(productionWeight('midseason'))
      expect(productionWeight('midseason')).toBeLessThan(productionWeight('final'))
    })

    it('tools still matter — production alone does not reorder the whole board', () => {
      // Equal (strong) production, very different tools: the better prospect wins.
      const prod = productionRankBonus(1.4, false, 0.30, 18)
      const inputs: RankInput[] = [
        { id: 'tools', ceiling: 88, current: 68, position: 'C', production: prod },
        { id: 'raw', ceiling: 58, current: 42, position: 'C', production: prod },
      ]
      for (const phase of ['preliminary', 'midseason', 'final'] as const) {
        expect(analystRank(inputs, phase).indexOf('tools')).toBeLessThan(analystRank(inputs, phase).indexOf('raw'))
      }
    })
  })

  describe('productionRankBonus', () => {
    it('is 0 for no sample, so goalies sit at par rather than being penalised', () => {
      expect(productionRankBonus(0, false, 0.30)).toBe(0)
    })
    it('is league-strength translated — the same rate is worth more in a tougher league', () => {
      expect(productionRankBonus(1.2, false, 0.40)).toBeGreaterThan(productionRankBonus(1.2, false, 0.20))
    })
    it('scales by doublings of the NHLe rate, not linearly', () => {
      const par = productionRankBonus(0.22 / 0.30, false, 0.30)
      const twice = productionRankBonus(0.44 / 0.30, false, 0.30)
      const fourTimes = productionRankBonus(0.88 / 0.30, false, 0.30)
      expect(Math.abs(par)).toBeLessThan(1) // par ⇒ neutral
      expect(twice - par).toBeGreaterThan(12)
      // A second doubling is worth about the same again (log-scaled, not saturating).
      expect(fourTimes - twice).toBeGreaterThan(12)
    })
    it('credits a younger producer more and does not punish a young no-show harder', () => {
      expect(productionRankBonus(1.2, false, 0.30, 17)).toBeGreaterThan(productionRankBonus(1.2, false, 0.30, 20))
      expect(productionRankBonus(0.25, false, 0.30, 17)).toBe(productionRankBonus(0.25, false, 0.30, 20))
    })
    it('rewards a defenceman for less scoring than a forward', () => {
      expect(productionRankBonus(0.9, true, 0.30)).toBeGreaterThan(productionRankBonus(0.9, false, 0.30))
    })
  })

  it('docks re-entry prospects vs equal first-time-eligible ones', () => {
    const inputs: RankInput[] = [
      { id: 're', ceiling: 85, current: 70, position: 'C', eligibility: 'reentry' },
      { id: 'el', ceiling: 85, current: 70, position: 'C', eligibility: 'eligible' },
    ]
    expect(analystRank(inputs, 'final').indexOf('el')).toBeLessThan(analystRank(inputs, 'final').indexOf('re'))
  })
})

describe('ceilingRole', () => {
  it('escalates the forward role with ceiling', () => {
    expect(ceilingRole(95, 'C')).toMatch(/franchise/)
    expect(ceilingRole(83, 'LW')).toMatch(/first-line/)
    expect(ceilingRole(72, 'RW')).toMatch(/middle-six/)
    expect(ceilingRole(50, 'C')).toMatch(/AHL|depth/)
  })
  it('uses position-specific language for D and G', () => {
    expect(ceilingRole(90, 'D')).toMatch(/#1 defenceman/)
    expect(ceilingRole(82, 'D')).toMatch(/top-pairing/)
    expect(ceilingRole(86, 'G')).toMatch(/franchise starting goaltender/)
    expect(ceilingRole(50, 'G')).toMatch(/goaltender/)
  })
})

describe('analystProjection', () => {
  const base = { name: 'Test Prospect', position: 'C', ceiling: 90, phaseLabel: 'Mid-season ranking', draftYear: 2027 }
  it('frames a radar (too-young) prospect without a board rank', () => {
    const s = analystProjection({ ...base, eligibility: 'radar' })
    expect(s).toMatch(/radar/)
    expect(s).toMatch(/franchise/)
  })
  it('cites the board rank for an eligible prospect', () => {
    const s = analystProjection({ ...base, eligibility: 'eligible', rank: 1 })
    expect(s).toMatch(/#1 in the 2027 class/)
    expect(s).toMatch(/franchise/)
  })
  it('flags a re-entry prospect as passed over', () => {
    const s = analystProjection({ ...base, eligibility: 'reentry', rank: 40 })
    expect(s).toMatch(/[Pp]assed over/)
  })
  it('reads an off-published-board prospect as a concrete projected round', () => {
    // Ranked ~#96 overall → a third-round projection, not a vague "off the board".
    const s = analystProjection({ ...base, eligibility: 'eligible', fullRank: 96 })
    expect(s).toMatch(/third-round pick/)
    expect(s).toMatch(/#96/)
  })
  it('handles an eligible prospect with no draftable projection at all', () => {
    const s = analystProjection({ ...base, eligibility: 'eligible' })
    expect(s).toMatch(/draftable prospect/)
  })

  it('hedges harder the deeper the projection', () => {
    expect(analystProjection({ ...base, eligibility: 'eligible', rank: 2 })).toMatch(/high-confidence/)
    expect(analystProjection({ ...base, eligibility: 'eligible', rank: 50 })).toMatch(/wide range of outcomes/)
  })
})

describe('projectionHedge', () => {
  it('is confident at the top and murky at the bottom', () => {
    expect(projectionHedge(1)).toMatch(/high-confidence/)
    expect(projectionHedge(20)).toMatch(/first-round/)
    expect(projectionHedge(50)).toMatch(/wide range/)
    expect(projectionHedge(120)).toMatch(/best guess/)
    expect(projectionHedge(undefined)).toMatch(/enormous/)
  })
})
