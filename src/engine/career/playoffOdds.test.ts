/**
 * Playoff-odds forecast (playtest #19b): the number has to answer to the season.
 *
 * The reported bug was a club stuck at 4% through an 8-4 start. The cause was
 * structural, not a bad constant: the Monte Carlo projected the remaining
 * schedule from roster strength alone, so results reached the forecast only as
 * banked points and a hot start could not move the projection. The model now
 * blends the roster prior with observed points% and carries rating uncertainty
 * between simulations.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from './career'

/** Walk a fresh career to roughly `target` games played and return the odds
 *  before and after, so a test can ask what the season changed. */
function oddsBeforeAndAfter(target: number): {
  before: Map<string, { pct: number; proj: number }>
  after: ReturnType<Career['getPlayoffOdds']>
} {
  const data = generateLeague({ seed: 2029 })
  const career = new Career(data, 2029, data.league.teams[3]!)
  const first = career.getPlayoffOdds()
  const before = new Map(first.rows.map((r) => [r.teamId, { pct: r.playoffPct, proj: r.projectedPoints }]))
  for (let d = 0; d < 90; d++) {
    if (!career.advanceDay()) break
    if ((career.getPlayoffOdds().rows[0]?.gamesPlayed ?? 0) >= target) break
  }
  return { before, after: career.getPlayoffOdds() }
}

describe('playoff odds — the forecast answers to results', () => {
  it('is available in the regular season with a row per club', () => {
    const data = generateLeague({ seed: 2029 })
    const odds = new Career(data, 2029, data.league.teams[3]!).getPlayoffOdds()
    expect(odds.available).toBe(true)
    expect(odds.rows).toHaveLength(data.league.teams.length)
    expect(odds.rows.some((r) => r.isUser)).toBe(true)
  })

  it('raises the leader and drops the laggard once records diverge', () => {
    const { before, after } = oddsBeforeAndAfter(15)
    expect(after.rows[0]!.gamesPlayed).toBeGreaterThanOrEqual(15)

    const byPoints = [...after.rows].sort((a, b) => b.points - a.points)
    const leader = byPoints[0]!
    // The leader is winning; the forecast has to notice.
    expect(leader.playoffPct).toBeGreaterThan(before.get(leader.teamId)!.pct + 5)

    // The club that has over-performed its opening projection by the widest
    // margin must have gained ground, and the worst under-performer must have
    // lost it.
    const paceDelta = after.rows.map((r) => {
      const b = before.get(r.teamId)!
      const projectedPace = b.proj / Math.max(1, r.gamesPlayed + r.gamesRemaining)
      return { r, b, delta: r.points / Math.max(1, r.gamesPlayed) - projectedPace }
    })
    paceDelta.sort((x, y) => y.delta - x.delta)
    const over = paceDelta[0]!, under = paceDelta[paceDelta.length - 1]!
    expect(over.r.playoffPct).toBeGreaterThanOrEqual(over.b.pct)
    expect(under.r.playoffPct).toBeLessThanOrEqual(under.b.pct)
  })

  it('projects season points inside a believable band', () => {
    const data = generateLeague({ seed: 2029 })
    const odds = new Career(data, 2029, data.league.teams[3]!).getPlayoffOdds()
    const games = odds.rows[0]!.gamesPlayed + odds.rows[0]!.gamesRemaining
    const pace = odds.rows.map((r) => r.projectedPoints / (2 * games))
    // Points percentage, so 0.5 is .500 hockey. Real NHL seasons land inside
    // roughly .30–.75; a model that let a club project past those bounds on day
    // one was overstating how decisive a roster edge is.
    expect(Math.max(...pace)).toBeLessThan(0.78)
    expect(Math.min(...pace)).toBeGreaterThan(0.25)
  })

  it('is stable for a given day — the same call twice gives the same number', () => {
    const data = generateLeague({ seed: 2029 })
    const career = new Career(data, 2029, data.league.teams[3]!)
    expect(career.getPlayoffOdds().rows.map((r) => r.playoffPct))
      .toEqual(career.getPlayoffOdds().rows.map((r) => r.playoffPct))
  })
})
