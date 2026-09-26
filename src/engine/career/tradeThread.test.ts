/**
 * Negotiation threads: the memory that makes a second call a second call.
 */
import { describe, expect, it } from 'vitest'
import {
  advanceThread,
  classifyMovement,
  coolOffDays,
  gapBand,
  inCoolOff,
  openThread,
  patienceRoundsFor,
  pruneThreads,
  threadKey,
  threadStage,
  walkThread,
} from './tradeThread'

const PERSONA = { aggression: 0.4, patience: 0.5 }

function fresh(over: Partial<Parameters<typeof openThread>[0]> = {}) {
  return openThread({
    key: 'TOR|p1',
    partnerTeamId: 'TOR',
    day: 10,
    year: 2030,
    targetValue: 100,
    persona: PERSONA,
    ...over,
  })
}

describe('thread identity', () => {
  it('keys on who you are talking to AND what you are chasing', () => {
    expect(threadKey('TOR', ['p1'], [])).toBe(threadKey('TOR', ['p1'], []))
    expect(threadKey('TOR', ['p1'], [])).not.toBe(threadKey('TOR', ['p2'], []))
    expect(threadKey('TOR', ['p1'], [])).not.toBe(threadKey('BOS', ['p1'], []))
  })

  it('is order-independent — the same pursuit is the same conversation', () => {
    expect(threadKey('TOR', ['p2', 'p1'], [])).toBe(threadKey('TOR', ['p1', 'p2'], []))
  })
})

describe('movement — a concession has to be a real one', () => {
  it('reads the first round as an opening, not a hold', () => {
    expect(classifyMovement(-1, 40)).toBe('opening')
  })

  it('calls a genuine drop a concession', () => {
    expect(classifyMovement(40, 30)).toBe('conceded')
  })

  it('refuses to call a 2% shave generosity', () => {
    expect(classifyMovement(40, 39.2)).toBe('held')
  })

  it('notices when the price went the other way', () => {
    expect(classifyMovement(40, 55)).toBe('hardened')
  })
})

describe('gap bands are measured against what is being chased', () => {
  it('scales with the target, not an absolute number', () => {
    expect(gapBand(10, 100)).toBe('slim')
    expect(gapBand(25, 100)).toBe('real')
    expect(gapBand(60, 100)).toBe('wide')
    // The same 25 units is wide when chasing a cheap piece.
    expect(gapBand(25, 30)).toBe('wide')
  })
})

describe('the arc', () => {
  it('counts rounds and concessions as they happen', () => {
    let t = fresh()
    let r = advanceThread(t, { gap: 40, giveValue: 60, day: 11, year: 2030 })
    expect(r.moved).toBe('opening')
    expect(r.thread.round).toBe(1)
    t = r.thread

    r = advanceThread(t, { gap: 25, giveValue: 75, day: 14, year: 2030 })
    expect(r.moved).toBe('conceded')
    expect(r.thread.concessions).toBe(1)
    expect(r.thread.stalls).toBe(0)
    expect(r.thread.round).toBe(2)
  })

  it('charges patience for sending the same package back', () => {
    let t = fresh()
    t = advanceThread(t, { gap: 40, giveValue: 60, day: 11, year: 2030 }).thread
    const r = advanceThread(t, { gap: 40, giveValue: 60, day: 14, year: 2030 })
    expect(r.moved).toBe('held')
    expect(r.thread.stalls).toBe(1)
  })

  it('reaches a final offer and then a walk', () => {
    let t = fresh()
    // patienceRounds for {0.4, 0.5} is 3 + round(1.5) = 5.
    expect(t.patienceRounds).toBe(5)
    const stages: string[] = []
    for (let i = 0; i < 6; i++) {
      // Always improving, so no stall penalty — pure round count.
      t = advanceThread(t, { gap: 40 - i, giveValue: 60 + i * 10, day: 11 + i * 3, year: 2030 }).thread
      stages.push(threadStage(t))
    }
    expect(stages).toEqual(['counter', 'counter', 'counter', 'counter', 'final', 'walk'])
  })

  it('never hangs up in round two, however badly it is going', () => {
    let t = fresh({ persona: { aggression: 0.95, patience: 0.05 } })
    for (let i = 0; i < 2; i++) {
      t = advanceThread(t, { gap: 99, giveValue: 1, day: 11 + i, year: 2030 }).thread
      expect(threadStage(t)).toBe('counter')
    }
  })

  it('walks SOONER on a GM who is being wasted than one being haggled with', () => {
    let haggled = fresh()
    let stalled = fresh()
    for (let i = 0; i < 4; i++) {
      haggled = advanceThread(haggled, { gap: 40 - i * 5, giveValue: 60 + i * 20, day: 11 + i, year: 2030 }).thread
      stalled = advanceThread(stalled, { gap: 40, giveValue: 60, day: 11 + i, year: 2030 }).thread
    }
    expect(threadStage(haggled)).toBe('counter')
    expect(threadStage(stalled)).toBe('walk')
  })

  it('gives a shark less rope than a patient man', () => {
    expect(patienceRoundsFor({ aggression: 0.9, patience: 0.1 })).toBeLessThan(
      patienceRoundsFor({ aggression: 0.2, patience: 0.9 }),
    )
  })
})

describe('walking away means something', () => {
  it('stops him picking up for a real stretch', () => {
    const t = walkThread(fresh(), 20, false)
    expect(t.walkedOnDay).toBe(20)
    expect(inCoolOff(t, 21)).toBe(true)
    expect(inCoolOff(t, 33)).toBe(true)
    expect(inCoolOff(t, 34)).toBe(false)
  })

  it('forgets faster when the deadline is the loudest thing in the room', () => {
    expect(coolOffDays(true)).toBeLessThan(coolOffDays(false))
    const t = walkThread(fresh(), 20, true)
    expect(inCoolOff(t, 25)).toBe(false)
  })

  it('a live thread is never in cool-off', () => {
    expect(inCoolOff(fresh(), 999)).toBe(false)
  })
})

describe('state stays bounded', () => {
  it('drops last season and long-dead talks, keeps a live cool-off', () => {
    const stale = { ...fresh(), lastDay: 1 }
    const oldYear = { ...fresh(), key: 'BOS|p9', year: 2029, lastDay: 100 }
    const live = { ...fresh(), key: 'MTL|p3', lastDay: 95 }
    // Walked long enough ago to be "stale", but he is still refusing to pick
    // up — that has to be remembered or the walk-away means nothing.
    const walked = walkThread({ ...fresh(), key: 'OTT|p4' }, 30, false)
    walked.reopenDay = 105
    const expired = walkThread({ ...fresh(), key: 'BUF|p7' }, 2, false)
    const kept = pruneThreads([stale, oldYear, live, walked, expired], { day: 100, year: 2030 })
    expect(kept.map((t) => t.key).sort()).toEqual(['MTL|p3', 'OTT|p4'])
  })

  it('caps the list', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...fresh(), key: `k${i}`, lastDay: 100 }))
    expect(pruneThreads(many, { day: 100, year: 2030 }).length).toBe(40)
  })
})
