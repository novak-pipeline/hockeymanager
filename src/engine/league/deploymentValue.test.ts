/**
 * Deployment value (#154): the receipt behind the biggest lever in the game.
 *
 * The interesting test here is the last one — it RE-DERIVES the constant
 * `POINTS_PER_WEIGHTED_RATING` from the sim instead of trusting it. If somebody
 * changes the sim's deployment weights or the conversion, the number the GM sees
 * on his line board stops matching what the engine actually does, and that is
 * the "receipt that lies" failure mode. This catches it.
 */
import { describe, expect, it } from 'vitest'
import type { Player, PlayerId, Team } from '@domain'
import { mirrorRink, runSeries, gdToSeasonPoints, stackLines, summarize } from '@engine/audit/leverLab'
import { deploymentValue, POINTS_PER_WEIGHTED_RATING } from './deploymentValue'

function weightedOf(team: Team, resolve: (id: PlayerId) => Player): number {
  return deploymentValue(team, resolve).weighted
}

describe('deploymentValue', () => {
  it('rises when the best players move up the board', () => {
    const rink = mirrorRink(99)
    stackLines(rink.b, rink.resolve, 'worst-first')
    stackLines(rink.a, rink.resolve, 'best-first')
    expect(weightedOf(rink.a, rink.resolve)).toBeGreaterThan(weightedOf(rink.b, rink.resolve))
  })

  it('reports a full-efficiency board as leaving nothing on the table', () => {
    const rink = mirrorRink(99)
    stackLines(rink.a, rink.resolve, 'best-first')
    const v = deploymentValue(rink.a, rink.resolve)
    // Not exactly 1: stackLines sorts forwards on offence while the receipt
    // grades on overall, so a best-first board is near-optimal, not optimal.
    expect(v.efficiency).toBeGreaterThan(0.94)
    expect(v.pointsLost).toBeLessThan(1.5)
  })

  it('reports the worst board as giving away a large, specific number of points', () => {
    const rink = mirrorRink(99)
    stackLines(rink.a, rink.resolve, 'worst-first')
    const v = deploymentValue(rink.a, rink.resolve)
    expect(v.efficiency).toBeLessThan(0.08)
    // Smaller than the audit's ~24-point line-assembly span, and correctly so:
    // that span also changes WHO dresses (best 18 vs worst 18), while the
    // receipt only grades the ORDER of the men the GM has already dressed.
    expect(v.pointsLost).toBeGreaterThan(6)
    expect(v.pointsLost).toBeLessThan(25)
  })

  it('re-derives POINTS_PER_WEIGHTED_RATING from the sim itself', () => {
    const rink = mirrorRink(99)
    stackLines(rink.a, rink.resolve, 'best-first')
    stackLines(rink.b, rink.resolve, 'worst-first')
    const ratingGap = weightedOf(rink.a, rink.resolve) - weightedOf(rink.b, rink.resolve)
    expect(ratingGap).toBeGreaterThan(1) // the arrangements really do differ

    const stat = summarize(runSeries(rink, 'quick', 6_000, 771_000))
    const measured = gdToSeasonPoints(stat.gdPerGame) / ratingGap
    // Wide band: this is a 6k-game estimate of a coefficient calibrated at 40k.
    // It catches the constant drifting away from the engine, not sampling noise.
    expect(
      measured,
      `the sim now pays ${measured.toFixed(2)} standings points per point of weighted lineup ` +
        `rating, but deploymentValue tells the GM ${POINTS_PER_WEIGHTED_RATING}. ` +
        `The line board's receipt no longer matches the engine — re-run the lever ` +
        `harness and update the constant and docs/LEVER-AUDIT.md.`,
    ).toBeGreaterThan(POINTS_PER_WEIGHTED_RATING * 0.6)
    expect(measured).toBeLessThan(POINTS_PER_WEIGHTED_RATING * 1.6)
  })
})
