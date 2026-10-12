/**
 * Loop audit F18: the World Juniors used to resolve on Dec 26. The rounds are
 * now told over the window, each beat true to the bracket the result implies.
 */
import { describe, expect, it } from 'vitest'
import type { IntlEventRecord, IntlPlayerLine } from '@domain'
import { WJC_DAY } from './international'
import { INTL_LENGTH_DAYS, intlStageBeats } from './intlStages'

const NATIONS = ['Canada', 'Sweden', 'United States', 'Finland', 'Czechia', 'Slovakia', 'Switzerland', 'Germany', 'Latvia', 'Norway']

function record(): IntlEventRecord {
  return {
    kind: 'worldJuniors', year: 2026, name: 'World Juniors',
    gold: 'Canada', silver: 'Sweden', bronze: 'United States', standings: NATIONS,
    finalScore: '4–3', finalLine: 'Canada 4–3 Sweden', mvp: null, topScorer: null, bestGoalie: null,
    allStars: [], leaders: [], rosters: NATIONS.map((n) => [n, []]),
  }
}
const line = (name: string, nation: string): IntlPlayerLine =>
  ({ playerId: name, name, nation, position: 'C', gp: 5, g: 2, a: 3 } as IntlPlayerLine)

describe('World Juniors told round by round', () => {
  const yours = [line('Ty Kidd', 'Canada'), line('Oskar Berg', 'Finland'), line('Jan Novak', 'Czechia'), line('Aldis Ozols', 'Latvia')]
  const beats = intlStageBeats({ kind: 'worldJuniors', record: record(), eventLabel: '2027 World Juniors', startDay: WJC_DAY, yours })

  it('spreads the beats from the opening (Dec 26) to the eve of the final', () => {
    expect(beats.map((b) => b.day)).toEqual([WJC_DAY, WJC_DAY + 5, WJC_DAY + 7, WJC_DAY + INTL_LENGTH_DAYS.worldJuniors - 1])
    expect(beats.length).toBeGreaterThanOrEqual(3)
    // The gold is NOT among the early beats: the career publishes it on the final day.
    expect(beats.some((b) => /win .*gold/.test(b.headline))).toBe(false)
  })

  it('every round is true to the bracket and names your prospects', () => {
    const [open, qf, sf, final] = beats
    expect(open!.body).toMatch(/Your players there: Ty Kidd \(Canada\)/)
    expect(qf!.body).toMatch(/Eight nations go on: Canada, Sweden, United States, Finland, Czechia, Slovakia, Switzerland and Germany\./)
    expect(qf!.body).toMatch(/Latvia and Norway are out after the group stage/)
    expect(qf!.body).toMatch(/Heading home: Aldis Ozols \(Latvia\)/)
    expect(sf!.headline).toBe('2027 World Juniors: Canada, Sweden, United States and Finland reach the semi-finals')
    expect(sf!.body).toMatch(/Out in the quarters: Jan Novak \(Czechia\)/)
    expect(final!.headline).toBe('Canada and Sweden play for gold')
    expect(final!.body).toMatch(/United States and Finland play for bronze/)
    for (const b of beats) expect(`${b.headline} ${b.body}`).not.toMatch(/undefined|\{|\}/)
  })

  it('a Nations Cup is a round robin and a final', () => {
    const r = { ...record(), kind: 'nationsCup' as const, standings: NATIONS.slice(0, 4) }
    const b = intlStageBeats({ kind: 'nationsCup', record: r, eventLabel: '2029 Nations Cup', startDay: 131, yours: [] })
    expect(b.map((x) => x.headline)).toEqual(['The 2029 Nations Cup opens', 'Canada and Sweden meet for the Nations Cup'])
    expect(b[1]!.body).toMatch(/United States and Finland are out\./)
  })
})
