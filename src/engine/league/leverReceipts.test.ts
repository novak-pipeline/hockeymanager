/**
 * Lever receipts (#154): the numbers the Tactics screen puts in front of the GM.
 *
 * The bar these have to clear is not "plausible" but "responds correctly to the
 * decision the GM just made" — a receipt that does not move when you move a
 * player is worse than no receipt, because it teaches him the lever is fake.
 */
import { describe, expect, it } from 'vitest'
import type { PlayerId } from '@domain'
import { mirrorRink, stackLines, stackSpecialTeams, orderGoalies } from '@engine/audit/leverLab'
import { leverReceipts } from './leverReceipts'

function rink() {
  const r = mirrorRink(99)
  return { team: r.a, resolve: (id: PlayerId) => r.resolve(id), r }
}

describe('leverReceipts', () => {
  it('says nothing is on the table when every unit is optimal', () => {
    const { team, resolve, r } = rink()
    stackLines(team, r.resolve, 'best-first')
    stackSpecialTeams(team, r.resolve, 'pp', 'best')
    stackSpecialTeams(team, r.resolve, 'pk', 'best')
    orderGoalies(team, r.resolve, 'best')
    for (const id of team.roster) {
      const p = r.resolve(id)
      p.fatigue = 0
      p.morale = 85
    }
    const rec = leverReceipts(team, resolve)
    expect(rec.powerPlay.optimal).toBe(true)
    expect(rec.penaltyKill.optimal).toBe(true)
    expect(rec.goalie.optimal).toBe(true)
    expect(rec.condition.fatiguePointsLost).toBe(0)
    expect(rec.condition.moralePointsLost).toBe(0)
    expect(rec.totalPointsLost).toBeLessThan(2)
  })

  it('charges the GM for a deliberately bad power play', () => {
    const { team, resolve, r } = rink()
    stackSpecialTeams(team, r.resolve, 'pp', 'best')
    const good = leverReceipts(team, resolve)
    stackSpecialTeams(team, r.resolve, 'pp', 'worst')
    const bad = leverReceipts(team, resolve)
    expect(good.powerPlay.pointsLost).toBeLessThan(bad.powerPlay.pointsLost)
    // The worst PP1 available should cost most of the measured 6.5-point span.
    expect(bad.powerPlay.pointsLost).toBeGreaterThan(3)
    expect(bad.powerPlay.pointsLost).toBeLessThanOrEqual(6.5)
  })

  it('charges the GM for starting the wrong goalie', () => {
    const { team, resolve, r } = rink()
    orderGoalies(team, r.resolve, 'worst')
    const rec = leverReceipts(team, resolve)
    expect(rec.goalie.optimal).toBe(false)
    expect(rec.goalie.pointsLost).toBeGreaterThan(0)
    expect(rec.goalie.pointsLost).toBeLessThanOrEqual(4.3)
  })

  it('prices a tired roster, and stops charging below the neutral reference', () => {
    const { team, resolve, r } = rink()
    for (const id of team.roster) r.resolve(id).fatigue = 20
    const tired = leverReceipts(team, resolve)
    expect(tired.condition.fatiguePointsLost).toBeGreaterThan(30)
    for (const id of team.roster) r.resolve(id).fatigue = 1
    expect(leverReceipts(team, resolve).condition.fatiguePointsLost).toBe(0)
  })

  it('never reports a negative charge', () => {
    const { team, resolve, r } = rink()
    stackLines(team, r.resolve, 'worst-first')
    const rec = leverReceipts(team, resolve)
    for (const v of [
      rec.deployment.pointsLost,
      rec.powerPlay.pointsLost,
      rec.penaltyKill.pointsLost,
      rec.goalie.pointsLost,
      rec.condition.fatiguePointsLost,
      rec.condition.moralePointsLost,
      rec.totalPointsLost,
    ]) {
      expect(v).toBeGreaterThanOrEqual(0)
    }
  })

  it('survives a broken lineup without throwing', () => {
    const { team, resolve } = rink()
    team.lines.forwards = [] as unknown as typeof team.lines.forwards
    team.lines.defensePairs = [] as unknown as typeof team.lines.defensePairs
    team.lines.powerPlayUnits = []
    team.lines.penaltyKillUnits = []
    expect(() => leverReceipts(team, resolve)).not.toThrow()
  })
})
