/**
 * Loop audit F18 in the career: a tournament opened on Dec 26 is told round by
 * round and only resolves (gold, medals, the record) on the day of the final,
 * and a save taken mid-tournament carries it.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { IntlEventRecord } from '@domain'
import { Career } from './career'
import { WJC_DAY } from '@engine/world/international'
import { INTL_LENGTH_DAYS, intlStageBeats } from '@engine/world/intlStages'

/* eslint-disable @typescript-eslint/no-explicit-any */
const NATIONS = ['Canada', 'Sweden', 'United States', 'Finland', 'Czechia', 'Slovakia', 'Switzerland', 'Germany', 'Latvia', 'Norway']

function pendingWjc(year: number): any {
  const record: IntlEventRecord = {
    kind: 'worldJuniors', year, name: 'World Juniors',
    gold: 'Canada', silver: 'Sweden', bronze: 'United States', standings: NATIONS,
    finalScore: '4–3', finalLine: 'Canada 4–3 Sweden', mvp: null, topScorer: null, bestGoalie: null,
    allStars: [], leaders: [], rosters: NATIONS.map((n) => [n, []]), lines: [],
  }
  const eventLabel = `${year + 1} World Juniors`
  return {
    kind: 'worldJuniors', year, finalDay: WJC_DAY + INTL_LENGTH_DAYS.worldJuniors, eventLabel, record,
    lines: [], injured: [], beats: intlStageBeats({ kind: 'worldJuniors', record, eventLabel, startDay: WJC_DAY, yours: [] }),
  }
}

describe('World Juniors over its window', () => {
  it('rounds are published on their days; gold only on the final day', () => {
    const data = generateLeague({ seed: 931 })
    const career = new Career(data, 931, data.league.teams[0]!)
    const c = career as any
    c.intlPending = pendingWjc(c.year)
    const gold = (): boolean => c.news.some((n: any) => /win .*World Juniors gold/.test(n.headline))
    const has = (re: RegExp): boolean => c.news.some((n: any) => re.test(n.headline))

    c.tickIntlPending(WJC_DAY)
    expect(has(/World Juniors open$/)).toBe(true)
    expect(has(/quarter-finals are set/)).toBe(false)
    expect(gold()).toBe(false)

    // A save mid-tournament carries the rest of it.
    const loaded = Career.fromSnapshot(career.exportSnapshot('t', '2026-12-27T00:00:00.000Z')) as any
    expect(loaded.intlPending?.beats.length).toBe(3)

    c.tickIntlPending(WJC_DAY + 5)
    expect(has(/quarter-finals are set/)).toBe(true)
    c.tickIntlPending(WJC_DAY + 7)
    expect(has(/reach the semi-finals/)).toBe(true)
    c.tickIntlPending(WJC_DAY + 9)
    expect(has(/^Canada and Sweden play for gold$/)).toBe(true)
    expect(gold()).toBe(false)
    expect(c.worldHist().international.some((e: any) => e.kind === 'worldJuniors')).toBe(false)

    c.tickIntlPending(WJC_DAY + 10) // Jan 5
    expect(gold()).toBe(true)
    expect(c.intlPending).toBeNull()
    expect(c.worldHist().international.some((e: any) => e.kind === 'worldJuniors' && e.gold === 'Canada')).toBe(true)
  })
})
