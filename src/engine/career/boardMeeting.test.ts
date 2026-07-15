import { describe, expect, it } from 'vitest'
import { Rng } from '@engine/shared/rng'
import type { BoardState } from '@engine/league/board'
import {
  buildBoardMeeting,
  buildSeasonReviewScene,
  defaultChoices,
  resolveBoardMeeting,
  resolveSeasonReview,
  type BoardMeetingFacts,
  type SeasonReviewFacts,
} from './boardMeeting'

function baseFacts(over: Partial<BoardMeetingFacts> = {}): BoardMeetingFacts {
  const board: BoardState = {
    mandate: 'makePlayoffs',
    mandateText: 'Make the playoffs.',
    targetRank: 12,
    confidence: 60,
    patience: 70,
    firedAtYear: null,
    warnings: 0,
  }
  return {
    year: 2027,
    teamName: 'Pittsburgh',
    board,
    owner: { id: 'own1', name: 'Marlene Brandt', demeanor: 'fiery' },
    coach: { id: 'hc1', name: 'Ray Solari', systemLabel: 'Heavy Forecheck' },
    agm: { id: 'agm1', name: 'Dev Okafor' },
    lastSeason: { predictedRank: 14, actualRank: 9, madePlayoffs: true, wonCup: false },
    capUsed: 82_000_000,
    salaryCap: 88_000_000,
    posture: 'retool',
    postureReason: 'mid-pack, keeping options open',
    coreAge: 27.5,
    fanInterest: 60,
    topProspects: ['Ben Kindel', 'Aatu Niemelä'],
    teamCount: 32,
    ...over,
  }
}

describe('buildBoardMeeting', () => {
  it('builds a deterministic scene with cast, opening and 3 agenda items', () => {
    const a = buildBoardMeeting(baseFacts(), new Rng(42))
    const b = buildBoardMeeting(baseFacts(), new Rng(42))
    expect(a).toEqual(b)
    expect(a.cast.map((c) => c.title)).toEqual(['Owner', 'Head Coach', 'Assistant GM'])
    expect(a.opening.length).toBeGreaterThanOrEqual(1)
    expect(a.agenda.length).toBe(3)
    expect(a.agenda[0]!.id).toBe('objective')
    expect(a.agenda[1]!.id).toBe('direction')
  })

  it('opening cites the actual finish vs the media pick', () => {
    const scene = buildBoardMeeting(baseFacts(), new Rng(1))
    const all = scene.opening.map((l) => l.text).join(' ')
    expect(all).toContain('14th') // predicted
    expect(all).toContain('9th')  // actual (exceeded)
  })

  it('owner demeanor changes the voice, facts stay the same', () => {
    const fiery = buildBoardMeeting(baseFacts(), new Rng(5))
    const calm = buildBoardMeeting(baseFacts({ owner: { id: 'own1', name: 'Marlene Brandt', demeanor: 'calm' } }), new Rng(5))
    expect(fiery.opening[0]!.text).not.toBe(calm.opening[0]!.text)
  })

  it('wildcard is condition-driven: payroll problem only when over the cap', () => {
    const healthy = buildBoardMeeting(baseFacts(), new Rng(7))
    expect(healthy.agenda[2]!.id).toBe('wc-invest')
    const overCap = buildBoardMeeting(baseFacts({ capUsed: 91_000_000 }), new Rng(7))
    expect(overCap.agenda[2]!.id).toBe('wc-payroll')
    expect(overCap.agenda[2]!.intro[0]!.text).toContain('$3.0M') // cites the real overage
    const oldCore = buildBoardMeeting(baseFacts({ coreAge: 31.2 }), new Rng(7))
    expect(oldCore.agenda[2]!.id).toBe('wc-rebuild')
    const emptySeats = buildBoardMeeting(baseFacts({ fanInterest: 38 }), new Rng(7))
    expect(emptySeats.agenda[2]!.id).toBe('wc-fans')
  })

  it('cupOrBust boards offer no softer path below contend… but developYouth has no softer option at all', () => {
    const dy = buildBoardMeeting(baseFacts({
      board: { ...baseFacts().board, mandate: 'developYouth', mandateText: 'Develop the young core.' },
    }), new Rng(3))
    expect(dy.agenda[0]!.options.map((o) => o.id)).not.toContain('askPatience')
  })
})

describe('resolveBoardMeeting', () => {
  it('promiseMore records a raised-bar promise and buys patience', () => {
    const facts = baseFacts()
    const scene = buildBoardMeeting(facts, new Rng(11))
    const fx = resolveBoardMeeting(scene, facts, { objective: 'promiseMore', direction: 'balance', 'wc-invest': 'scouting' })
    expect(fx.patienceDelta).toBeGreaterThan(0)
    const p = fx.promises.find((x) => x.kind === 'finishAtLeast')!
    expect(p.value).toBe(9) // targetRank 12 - 3
    expect(p.dueYear).toBe(2027)
    expect(fx.summary).toContain('9th')
  })

  it('askPatience is granted when patience is healthy — with a youth receipt', () => {
    const facts = baseFacts()
    const scene = buildBoardMeeting(facts, new Rng(11))
    const fx = resolveBoardMeeting(scene, facts, { objective: 'askPatience', direction: 'balance', 'wc-invest': 'development' })
    expect(fx.mandateOverride?.mandate).toBe('competeRespectably')
    expect(fx.targetRankOverride).toBe(16)
    expect(fx.promises.some((p) => p.kind === 'youthGames' && p.count === 2 && p.value === 40)).toBe(true)
  })

  it('askPatience is REFUSED when patience is thin — and costs you for asking', () => {
    const facts = baseFacts({ board: { ...baseFacts().board, patience: 25 } })
    const scene = buildBoardMeeting(facts, new Rng(11))
    const fx = resolveBoardMeeting(scene, facts, { objective: 'askPatience', direction: 'balance', 'wc-invest': 'development' })
    expect(fx.mandateOverride).toBeUndefined()
    expect(fx.patienceDelta).toBeLessThan(0)
    expect(fx.summary).toContain('REFUSED')
  })

  it('win-now direction promises a playoff berth; youth direction promises minutes', () => {
    const facts = baseFacts()
    const scene = buildBoardMeeting(facts, new Rng(11))
    const now = resolveBoardMeeting(scene, facts, { objective: 'accept', direction: 'now', 'wc-invest': 'scouting' })
    expect(now.promises.some((p) => p.kind === 'playoffBerth')).toBe(true)
    expect(now.direction).toBe('compete')
    const youth = resolveBoardMeeting(scene, facts, { objective: 'accept', direction: 'youth', 'wc-invest': 'scouting' })
    expect(youth.promises.some((p) => p.kind === 'youthGames')).toBe(true)
    expect(youth.patienceDelta).toBeGreaterThan(0)
  })

  it('the rebuild wildcard can sanction a teardown', () => {
    const facts = baseFacts({ coreAge: 31.5 })
    const scene = buildBoardMeeting(facts, new Rng(11))
    expect(scene.agenda[2]!.id).toBe('wc-rebuild')
    const fx = resolveBoardMeeting(scene, facts, { objective: 'accept', direction: 'balance', 'wc-rebuild': 'sanction' })
    expect(fx.sanctionRebuild).toBe(true)
    expect(fx.direction).toBe('rebuild')
  })

  it('defaultChoices (the AGM path) resolves every agenda item safely', () => {
    const facts = baseFacts({ capUsed: 91_000_000 })
    const scene = buildBoardMeeting(facts, new Rng(11))
    const choices = defaultChoices(scene)
    expect(Object.keys(choices).sort()).toEqual(scene.agenda.map((a) => a.id).sort())
    const fx = resolveBoardMeeting(scene, facts, choices)
    expect(fx.summary.length).toBeGreaterThan(0)
  })

  it('round-trips through JSON', () => {
    const facts = baseFacts()
    const scene = buildBoardMeeting(facts, new Rng(2))
    expect(JSON.parse(JSON.stringify(scene))).toEqual(scene)
  })
})

/* ── End-of-Season Review (M4) ── */

function reviewFacts(over: Partial<SeasonReviewFacts> = {}): SeasonReviewFacts {
  return {
    year: 2027,
    teamName: 'Pittsburgh',
    owner: { id: 'own1', name: 'Marlene Brandt', demeanor: 'fiery' },
    coach: { id: 'hc1', name: 'Ray Solari' },
    agm: { id: 'agm1', name: 'Dev Okafor' },
    finalRank: 9,
    targetRank: 12,
    mandateText: 'Make the playoffs.',
    madePlayoffs: true,
    wonCup: false,
    verdict: 'met',
    fired: false,
    promises: [
      { text: 'Finish 9th or better — your own raised bar', resolved: 'met' },
      { text: 'Two U23 players play 40+ NHL games', resolved: 'missed' },
    ],
    confidence: 62,
    patience: 70,
    ...over,
  }
}

describe('buildSeasonReviewScene', () => {
  it('reads every promise back with its verdict, quoting the original words', () => {
    const scene = buildSeasonReviewScene(reviewFacts(), new Rng(9))
    const text = scene.opening.map((l) => l.text).join(' | ')
    expect(text).toContain('Finish 9th or better')
    expect(text).toContain('Delivered')
    expect(text).toContain('Two U23 players')
    expect(text).toContain("It didn't happen")
    expect(scene.agenda).toHaveLength(1)
  })

  it('options track the verdict: success offers leverage, failure offers accountability', () => {
    const good = buildSeasonReviewScene(reviewFacts({ verdict: 'exceeded' }), new Rng(9))
    expect(good.agenda[0]!.options.map((o) => o.id)).toContain('leverage')
    const bad = buildSeasonReviewScene(reviewFacts({ verdict: 'failed', finalRank: 26 }), new Rng(9))
    expect(bad.agenda[0]!.options.map((o) => o.id)).toContain('own')
    expect(bad.opening.map((l) => l.text).join(' ')).toContain('26th')
  })

  it('a firing is delivered across the table, not by press release', () => {
    const scene = buildSeasonReviewScene(reviewFacts({ verdict: 'failed', fired: true }), new Rng(9))
    expect(scene.opening.map((l) => l.text).join(' ')).toContain('paperwork')
  })
})

describe('resolveSeasonReview', () => {
  it('owning a bad year buys back a little trust; defending it depends on the owner', () => {
    const own = resolveSeasonReview(reviewFacts({ verdict: 'failed' }), 'own')
    expect(own.confidenceDelta).toBeGreaterThan(0)
    const defendFiery = resolveSeasonReview(reviewFacts({ verdict: 'failed' }), 'defend')
    expect(defendFiery.confidenceDelta).toBeLessThan(0)
    const defendCalm = resolveSeasonReview(
      reviewFacts({ verdict: 'failed', owner: { id: 'o', name: 'X', demeanor: 'analytical' } }), 'defend')
    expect(defendCalm.confidenceDelta).toBeGreaterThanOrEqual(0)
  })

  it('leverage after a great year trades a sliver of confidence for patience', () => {
    const r = resolveSeasonReview(reviewFacts({ verdict: 'exceeded' }), 'leverage')
    expect(r.patienceDelta).toBeGreaterThan(0)
    expect(r.confidenceDelta).toBeLessThan(1)
  })
})
