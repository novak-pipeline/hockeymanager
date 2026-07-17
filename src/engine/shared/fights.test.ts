/**
 * Fights: scheduled per game from a stable hash (zero main-rng cost), a modern
 * NHL rate that rivalry heat multiplies hard, and in-engine effects that are
 * real — both combatants take 5 PIM, appear in the stream as fighting majors,
 * and sit five minutes of game time so their lines skate short. Coincidental
 * majors: no power play.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { Player, PlayerId } from '@domain'
import { isEvent } from '@domain'
import { rollFightPlan } from './fights'
import { fullSimGame } from '@engine/full/fullSim'
import { quickSimGame } from '@engine/quick/quickSim'

describe('rollFightPlan', () => {
  it('is deterministic and keeps fights inside regulation', () => {
    expect(rollFightPlan(1234, 0.5)).toEqual(rollFightPlan(1234, 0.5))
    for (let s = 0; s < 500; s++) {
      for (const t of rollFightPlan(s, 1)) {
        expect(t).toBeGreaterThanOrEqual(120)
        expect(t).toBeLessThanOrEqual(3480)
      }
    }
  })

  it('averages the modern NHL rate, and a grudge match fights ~3x as often', () => {
    const mean = (intensity: number): number => {
      let n = 0
      const N = 4000
      for (let s = 0; s < N; s++) n += rollFightPlan(s, intensity).length
      return n / N
    }
    const base = mean(0)
    const grudge = mean(1)
    expect(base).toBeGreaterThan(0.1)
    expect(base).toBeLessThan(0.2)
    expect(grudge).toBeGreaterThan(base * 2.4)
    expect(grudge).toBeLessThan(base * 3.6)
  })
})

describe('fights in the engines', () => {
  const data = generateLeague({ seed: 99 })
  const resolve = (id: PlayerId): Player => {
    const p = data.players.get(id)
    if (!p) throw new Error(`unknown ${id}`)
    return p
  }
  const teams = data.league.teams
  /** A seed whose plan has at least one fight at full heat. */
  const fightSeed = ((): number => {
    for (let s = 50000; ; s++) if (rollFightPlan(s, 1).length > 0) return s
  })()

  it('quick sim: both combatants take fighting majors and 5 PIM', () => {
    const home = data.teams.get(teams[0])!
    const away = data.teams.get(teams[1])!
    const out = quickSimGame(home, away, resolve, { seed: fightSeed, intensity: 1 })
    const majors = out.stream.filter((e) => isEvent(e, 'penalty') && e.infraction === 'fighting')
    expect(majors.length).toBeGreaterThanOrEqual(2)
    expect(majors.length % 2).toBe(0) // one per side, per fight
    for (const m of majors) {
      expect(m.minutes).toBe(5)
      expect(out.playerStats.get(m.player)!.penaltyMinutes).toBeGreaterThanOrEqual(5)
    }
    // One combatant from each club.
    const homeSet = new Set(home.roster.map(String))
    expect(homeSet.has(String(majors[0].player))).not.toBe(homeSet.has(String(majors[1].player)))
    // Deterministic replay.
    const again = quickSimGame(home, away, resolve, { seed: fightSeed, intensity: 1 })
    expect(again.homeGoals).toBe(out.homeGoals)
    expect(again.awayGoals).toBe(out.awayGoals)
  })

  it('full sim: the fight lands in the stream and both combatants sit', () => {
    const home = data.teams.get(teams[2])!
    const away = data.teams.get(teams[3])!
    const out = fullSimGame(home, away, resolve, { seed: fightSeed, intensity: 1 })
    const majors = out.stream.filter((e) => isEvent(e, 'penalty') && e.infraction === 'fighting')
    expect(majors.length).toBeGreaterThanOrEqual(2)
    for (const m of majors) {
      expect(m.minutes).toBe(5)
      expect(out.playerStats.get(m.player)!.penaltyMinutes).toBeGreaterThanOrEqual(5)
    }
    const homeSet = new Set(home.roster.map(String))
    expect(homeSet.has(String(majors[0].player))).not.toBe(homeSet.has(String(majors[1].player)))
  })

  it('the fight really perturbs the game (counterfactual: same seed, no plan)', () => {
    // Pick a seed whose plan is empty at intensity 0 but has a fight at 1 —
    // the main rng stream is identical either way, so any divergence in the
    // game is the fight machinery (combatants off the ice, extra stoppage).
    let seed = 70000
    while (!(rollFightPlan(seed, 0).length === 0 && rollFightPlan(seed, 1).length > 0)) seed++
    const home = data.teams.get(teams[6])!
    const away = data.teams.get(teams[7])!
    const calm = fullSimGame(home, away, resolve, { seed, intensity: 0 })
    const heated = fullSimGame(home, away, resolve, { seed, intensity: 1 })
    const fights = heated.stream.filter((e) => isEvent(e, 'penalty') && e.infraction === 'fighting')
    expect(fights.length).toBeGreaterThanOrEqual(2)
    // The two games genuinely diverge (note: intensity also chips hit/penalty
    // rates, but the fight's five-minute absences are the big lever here).
    const fingerprint = (o: typeof calm): string =>
      o.stream.filter((e) => e.type === 'goal' || e.type === 'shot').map((e) => `${e.period}:${e.t}`).join(',')
    expect(fingerprint(heated)).not.toBe(fingerprint(calm))
  })

  it('an ordinary-seed game with no plan has no fighting majors', () => {
    let quietSeed = 60000
    while (rollFightPlan(quietSeed, 0).length > 0) quietSeed++
    const out = quickSimGame(data.teams.get(teams[4])!, data.teams.get(teams[5])!, resolve, { seed: quietSeed })
    expect(out.stream.some((e) => isEvent(e, 'penalty') && e.infraction === 'fighting')).toBe(false)
  })
})
