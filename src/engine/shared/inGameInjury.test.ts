/**
 * In-game injuries: some injuries now happen ON the ice — the victim goes down,
 * is done for the night (his bench plays short), his box line carries
 * `leftGame`, and the career layer turns the departure into a guaranteed
 * injury. Schedule is hash-derived (zero main-rng cost): games without one
 * replay byte-for-byte.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { Player, PlayerId } from '@domain'
import { rollInGameInjury, fragilityWeight } from './inGameInjury'
import { quickSimGame } from '@engine/quick/quickSim'
import { fullSimGame } from '@engine/full/fullSim'

describe('rollInGameInjury', () => {
  it('is deterministic, ~1 game in 5, inside regulation', () => {
    expect(rollInGameInjury(42)).toEqual(rollInGameInjury(42))
    let n = 0
    const N = 4000
    for (let s = 0; s < N; s++) {
      const plan = rollInGameInjury(s)
      if (!plan) continue
      n++
      expect(plan.atSecond).toBeGreaterThanOrEqual(60)
      expect(plan.atSecond).toBeLessThanOrEqual(3540)
    }
    expect(n / N).toBeGreaterThan(0.16)
    expect(n / N).toBeLessThan(0.24)
  })

  it('fragile players carry more risk than sturdy ones', () => {
    expect(fragilityWeight(30)).toBeGreaterThan(fragilityWeight(70) * 1.8)
    expect(fragilityWeight(90)).toBe(1)
  })
})

describe('in-game injuries in the engines', () => {
  const data = generateLeague({ seed: 99 })
  const resolve = (id: PlayerId): Player => {
    const p = data.players.get(id)
    if (!p) throw new Error(`unknown ${id}`)
    return p
  }
  const teams = data.league.teams
  /** A seed whose plan lands EARLY, so the victim visibly misses most of the game. */
  const earlySeed = ((): number => {
    for (let s = 90000; ; s++) {
      const p = rollInGameInjury(s)
      if (p && p.atSecond < 900) return s
    }
  })()

  it('quick sim: exactly one victim leaves and his night is clearly cut short', () => {
    const home = data.teams.get(teams[0])!
    const away = data.teams.get(teams[1])!
    const out = quickSimGame(home, away, resolve, { seed: earlySeed })
    const left = [...out.playerStats.values()].filter((s) => s.leftGame === true)
    expect(left.length).toBe(1)
    // He went down inside the first 15 minutes — his TOI must be a fraction of
    // a regular shift-share (a full night at his slot would be 12+ minutes).
    expect(left[0].toi).toBeLessThan(6 * 60)
    // Deterministic replay.
    const again = quickSimGame(home, away, resolve, { seed: earlySeed })
    expect([...again.playerStats.values()].filter((s) => s.leftGame).length).toBe(1)
    expect(again.homeGoals).toBe(out.homeGoals)
  })

  it('full sim: the victim is flagged and sidelined', () => {
    const home = data.teams.get(teams[2])!
    const away = data.teams.get(teams[3])!
    const out = fullSimGame(home, away, resolve, { seed: earlySeed })
    const left = [...out.playerStats.values()].filter((s) => s.leftGame === true)
    expect(left.length).toBe(1)
    expect(left[0].toi).toBeLessThan(8 * 60) // went down early, sat the rest
  })

  it('a no-plan seed produces no departures', () => {
    let quiet = 95000
    while (rollInGameInjury(quiet) !== null) quiet++
    const out = quickSimGame(data.teams.get(teams[4])!, data.teams.get(teams[5])!, resolve, { seed: quiet })
    expect([...out.playerStats.values()].some((s) => s.leftGame)).toBe(false)
  })
})
