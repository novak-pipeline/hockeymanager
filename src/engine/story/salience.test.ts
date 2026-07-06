/**
 * salience.test.ts — the noticing engine: detectors, novelty dampening, budget.
 */
import { describe, expect, it } from 'vitest'
import { Rng } from '@engine/shared/rng'
import {
  DAILY_POST_BUDGET,
  detectBreakoutSkater,
  detectExpectationGap,
  detectGoalieHeater,
  detectStreakOutlier,
  engagementFor,
  noveltyClassOf,
  selectPosts,
  shouldReachInbox,
  type SalienceCandidate,
  type SalienceCtx,
} from './salience'

function ctxWith(overrides: Partial<SalienceCtx>): SalienceCtx {
  return {
    day: 25,
    year: 2026,
    currentRanks: new Map(),
    preseasonRanks: new Map(),
    streaks: new Map(),
    teams: new Map([
      ['t1', { name: 'Halifax Mariners', abbreviation: 'HFX' }],
      ['t2', { name: 'Reno Rattlers', abbreviation: 'RNO' }],
    ]),
    userTeamId: 't9',
    teamsInLeague: 32,
    ...overrides,
  }
}

describe('detectExpectationGap', () => {
  it('fires both directions when the gap is 10+ spots, silent otherwise', () => {
    const ctx = ctxWith({
      currentRanks: new Map([['t1', 3], ['t2', 29]]),
      preseasonRanks: new Map([['t1', 25], ['t2', 8]]),
    })
    const hits = detectExpectationGap(ctx)
    expect(hits).toHaveLength(2)
    const up = hits.find((h) => h.key.startsWith('expgap-up'))!
    const down = hits.find((h) => h.key.startsWith('expgap-down'))!
    expect(up.facts.numbers['gap']).toBe(22)
    expect(up.text).toContain('Halifax Mariners')
    expect(up.facts.priorNote).toContain('25')
    expect(down.facts.numbers['gap']).toBe(-21)

    // Small gap: silence.
    const quiet = detectExpectationGap(ctxWith({
      currentRanks: new Map([['t1', 10]]),
      preseasonRanks: new Map([['t1', 14]]),
    }))
    expect(quiet).toHaveLength(0)
  })

  it('only reads at checkpoint days', () => {
    const ctx = ctxWith({
      day: 26,
      currentRanks: new Map([['t1', 3]]),
      preseasonRanks: new Map([['t1', 25]]),
    })
    expect(detectExpectationGap(ctx)).toHaveLength(0)
  })
})

describe('detectStreakOutlier', () => {
  it('fires at 6+ either way with band keys, silent below', () => {
    const ctx = ctxWith({ streaks: new Map([['t1', 8], ['t2', -6]]) })
    const hits = detectStreakOutlier(ctx)
    expect(hits).toHaveLength(2)
    expect(hits[0]!.key).toContain('-8')
    expect(hits[1]!.text).toContain('the wrong kind')
    expect(detectStreakOutlier(ctxWith({ streaks: new Map([['t1', 4]]) }))).toHaveLength(0)
  })
})

describe('detectBreakoutSkater', () => {
  const filler = Array.from({ length: 60 }, (_, i) => ({
    playerId: `f${i}`, name: `Filler ${i}`, teamId: 't2',
    gp: 15, points: 8, ratedOverall: 80, age: 27,
  }))

  it('flags a low-rated player on a star pace; ignores stars doing star things', () => {
    const ctx = ctxWith({
      day: 30,
      skaters: [
        { playerId: 'p1', name: 'Cinderella Story', teamId: 't1', gp: 15, points: 24, ratedOverall: 71, age: 22 },
        { playerId: 'p2', name: 'Known Superstar', teamId: 't1', gp: 15, points: 26, ratedOverall: 93, age: 28 },
        ...filler,
      ],
    })
    const hits = detectBreakoutSkater(ctx)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.playerId).toBe('p1')
    expect(hits[0]!.facts.priorNote).toContain('71')
    expect(hits[0]!.text).toContain('Cinderella Story')
  })

  it('stays silent off checkpoint days and on thin samples', () => {
    const hot = { playerId: 'p1', name: 'X', teamId: 't1', gp: 15, points: 24, ratedOverall: 70, age: 22 }
    expect(detectBreakoutSkater(ctxWith({ day: 31, skaters: [hot, ...filler] }))).toHaveLength(0)
    expect(detectBreakoutSkater(ctxWith({ day: 30, skaters: [hot] }))).toHaveLength(0)
  })
})

describe('detectGoalieHeater', () => {
  it('needs a real workload and a real number; unheralded names score higher', () => {
    const ctx = ctxWith({
      day: 60,
      goalies: [
        { playerId: 'g1', name: 'Unknown Wall', teamId: 't1', saves: 290, shotsAgainst: 310, ratedOverall: 72 },
        { playerId: 'g2', name: 'Famous Wall', teamId: 't2', saves: 290, shotsAgainst: 310, ratedOverall: 90 },
        { playerId: 'g3', name: 'Small Sample', teamId: 't1', saves: 96, shotsAgainst: 100, ratedOverall: 70 },
        { playerId: 'g4', name: 'Ordinary', teamId: 't2', saves: 270, shotsAgainst: 300, ratedOverall: 75 },
      ],
    })
    const hits = detectGoalieHeater(ctx)
    expect(hits.map((h) => h.playerId).sort()).toEqual(['g1', 'g2'])
    const known = hits.find((h) => h.playerId === 'g2')!
    const unknown = hits.find((h) => h.playerId === 'g1')!
    expect(unknown.score).toBeGreaterThan(known.score)
    expect(unknown.text).toContain('.935')
  })
})

describe('selectPosts — novelty + budget', () => {
  const cand = (key: string, score: number): SalienceCandidate => ({
    key, score, channel: 'feed', authorId: 'analyst', text: 'x',
    facts: { kind: 'test', numbers: {} },
  })

  it('caps at the daily budget, highest scores first', () => {
    const picked = selectPosts(
      [cand('a-1-x', 50), cand('b-1-y', 80), cand('c-1-z', 65)],
      new Map(),
      new Rng(1)
    )
    expect(picked).toHaveLength(DAILY_POST_BUDGET)
    expect(picked[0]!.key).toBe('b-1-y')
  })

  it('an exact key that already fired never fires again', () => {
    const counts = new Map([['a-1-x', 1]])
    const picked = selectPosts([cand('a-1-x', 90)], counts, new Rng(1))
    expect(picked).toHaveLength(0)
  })

  it('novelty class dampening: a pattern that fired often loses to a fresh one', () => {
    // Same class 'expgap-up' fired 8 times before → heavy dampening.
    const counts = new Map([[noveltyClassOf('expgap-up-t9'), 8]])
    const picked = selectPosts(
      [cand('expgap-up-t1', 70), cand('streak-w-t2-2026-6', 46)],
      counts,
      new Rng(1)
    )
    expect(picked[0]!.key).toBe('streak-w-t2-2026-6')
  })

  it('drops candidates below the publish floor', () => {
    expect(selectPosts([cand('a-1-x', 10)], new Map(), new Rng(1))).toHaveLength(0)
  })
})

describe('shouldReachInbox — the curation floor', () => {
  it('followed authors always reach the inbox; strangers need the floor', () => {
    const low = { score: 45, authorId: 'analyst' }
    const big = { score: 82, authorId: 'insider' }
    expect(shouldReachInbox(low, [])).toBe(false)
    expect(shouldReachInbox(low, ['analyst'])).toBe(true)
    expect(shouldReachInbox(big, [])).toBe(true)
    expect(shouldReachInbox(low, ['insider'])).toBe(false)
  })
})

describe('engagement', () => {
  it('is deterministic per rng seed and scales with salience', () => {
    const a = engagementFor(80, new Rng(7))
    const b = engagementFor(80, new Rng(7))
    expect(a).toEqual(b)
    expect(a.likes).toBeGreaterThan(engagementFor(30, new Rng(7)).likes)
    expect(a.reposts).toBeLessThan(a.likes)
  })
})
