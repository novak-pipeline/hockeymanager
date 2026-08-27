import { describe, expect, it } from 'vitest'
import type { Player, PlayerId } from '@domain'
import { generateLeague } from '@data/generate'
import { quickSimGame } from '@engine/quick/quickSim'
import { fullSimGame } from '@engine/full/fullSim'
import { creditPlusMinus, emptyStat, mergePlayerStats, type GamePlayerStat } from './outcome'

const pid = (s: string): PlayerId => s as unknown as PlayerId

/** Tiny stat table standing in for an engine's per-game map. */
function table(): { stat: (id: PlayerId) => GamePlayerStat; map: Map<PlayerId, GamePlayerStat> } {
  const map = new Map<PlayerId, GamePlayerStat>()
  const stat = (id: PlayerId): GamePlayerStat => {
    let s = map.get(id)
    if (!s) {
      s = emptyStat(id)
      map.set(id, s)
    }
    return s
  }
  return { stat, map }
}

const SCORING = ['a1', 'a2', 'a3', 'a4', 'a5'].map(pid)
const CONCEDING = ['b1', 'b2', 'b3', 'b4', 'b5'].map(pid)

describe('creditPlusMinus — NHL scoring rules', () => {
  it('credits +1 to the scoring side and −1 to the conceding side at even strength', () => {
    const { stat, map } = table()
    creditPlusMinus('ev', SCORING, CONCEDING, stat)
    for (const id of SCORING) expect(map.get(id)!.plusMinus).toBe(1)
    for (const id of CONCEDING) expect(map.get(id)!.plusMinus).toBe(-1)
  })

  it('awards nothing at all on a power-play goal', () => {
    const { stat, map } = table()
    creditPlusMinus('pp', SCORING, CONCEDING, stat)
    expect(map.size).toBe(0)
  })

  it('counts shorthanded goals — the four killers go +1, the five on the PP go −1', () => {
    const { stat, map } = table()
    const killers = SCORING.slice(0, 4)
    creditPlusMinus('sh', killers, CONCEDING, stat)
    for (const id of killers) expect(map.get(id)!.plusMinus).toBe(1)
    for (const id of CONCEDING) expect(map.get(id)!.plusMinus).toBe(-1)
    expect(map.get(SCORING[4])).toBeUndefined()
  })

  it('counts empty-net goals', () => {
    const { stat, map } = table()
    creditPlusMinus('en', SCORING, CONCEDING, stat)
    expect(map.get(SCORING[0])!.plusMinus).toBe(1)
    expect(map.get(CONCEDING[0])!.plusMinus).toBe(-1)
  })

  it('accumulates across goals, netting plus and minus for the same skater', () => {
    const { stat, map } = table()
    creditPlusMinus('ev', SCORING, CONCEDING, stat)
    creditPlusMinus('ev', CONCEDING, SCORING, stat)
    creditPlusMinus('ev', SCORING, CONCEDING, stat)
    expect(map.get(SCORING[0])!.plusMinus).toBe(1)
    expect(map.get(CONCEDING[0])!.plusMinus).toBe(-1)
  })

  it('sums into season totals through mergePlayerStats', () => {
    const totals = new Map<PlayerId, GamePlayerStat>()
    for (let game = 0; game < 3; game++) {
      const { stat, map } = table()
      creditPlusMinus('ev', SCORING, CONCEDING, stat)
      mergePlayerStats(totals, map)
    }
    expect(totals.get(SCORING[0])!.plusMinus).toBe(3)
    expect(totals.get(CONCEDING[0])!.plusMinus).toBe(-3)
  })

  it('treats a stat line serialized before the field existed as zero', () => {
    const totals = new Map<PlayerId, GamePlayerStat>()
    const legacy = emptyStat(SCORING[0])
    delete legacy.plusMinus
    mergePlayerStats(totals, new Map([[SCORING[0], legacy]]))
    expect(totals.get(SCORING[0])!.plusMinus).toBe(0)
  })
})

describe('plus/minus in the sim engines', () => {
  const data = generateLeague({ seed: 2026 })
  const ids = [...data.teams.keys()]
  const resolve = (id: PlayerId): Player => data.players.get(id)!

  it('quick-sim records a non-trivial plus/minus that never exceeds the goals scored', () => {
    const r = quickSimGame(data.teams.get(ids[0])!, data.teams.get(ids[1])!, resolve, { seed: 77 })
    const totalGoals = r.homeGoals + r.awayGoals
    let nonZero = 0
    for (const [id, s] of r.playerStats) {
      const pm = s.plusMinus ?? 0
      if (resolve(id).position === 'G') {
        expect(pm).toBe(0) // goalies do not carry +/-
        continue
      }
      expect(Math.abs(pm)).toBeLessThanOrEqual(totalGoals)
      if (pm !== 0) nonZero++
    }
    expect(nonZero).toBeGreaterThan(0)
  })

  it('full-sim records a non-trivial plus/minus and leaves goalies at zero', () => {
    const r = fullSimGame(data.teams.get(ids[2])!, data.teams.get(ids[3])!, resolve, { seed: 404 })
    const totalGoals = r.homeGoals + r.awayGoals
    let nonZero = 0
    for (const [id, s] of r.playerStats) {
      const pm = s.plusMinus ?? 0
      if (resolve(id).position === 'G') {
        expect(pm).toBe(0)
        continue
      }
      expect(Math.abs(pm)).toBeLessThanOrEqual(totalGoals)
      if (pm !== 0) nonZero++
    }
    expect(nonZero).toBeGreaterThan(0)
  })

  it('a shootout win never moves anyone\'s plus/minus', () => {
    // Shootout goals are not player goals; find one and check the swing matches
    // only the goals that actually happened in play.
    let found = false
    for (let seed = 0; seed < 60 && !found; seed++) {
      const r = quickSimGame(data.teams.get(ids[4])!, data.teams.get(ids[5])!, resolve, { seed })
      if (r.decidedBy !== 'shootout') continue
      found = true
      const inPlayGoals = r.stream.filter((e) => e.type === 'goal').length
      for (const [id, s] of r.playerStats) {
        if (resolve(id).position === 'G') continue
        expect(Math.abs(s.plusMinus ?? 0)).toBeLessThanOrEqual(inPlayGoals)
      }
    }
    expect(found).toBe(true)
  })

  it('separates a strong roster from a weak one over a long series', () => {
    // Rank teams by mean skater overall, then run the best against the worst.
    const meanOverall = (teamId: (typeof ids)[number]): number => {
      const roster = data.teams.get(teamId)!.roster.map(resolve).filter((p) => p.position !== 'G')
      return roster.reduce((s, p) => s + p.composites.scoring + p.composites.defense, 0) / roster.length
    }
    const ranked = [...ids].sort((a, b) => meanOverall(b) - meanOverall(a))
    const best = data.teams.get(ranked[0])!
    const worst = data.teams.get(ranked[ranked.length - 1])!

    let bestPm = 0
    let worstPm = 0
    for (let seed = 0; seed < 82; seed++) {
      const r = quickSimGame(best, worst, resolve, { seed: 5000 + seed })
      for (const [id, s] of r.playerStats) {
        if (resolve(id).position === 'G') continue
        if (best.roster.includes(id)) bestPm += s.plusMinus ?? 0
        else worstPm += s.plusMinus ?? 0
      }
    }
    expect(bestPm).toBeGreaterThan(0)
    expect(worstPm).toBeLessThan(0)
  })
})
