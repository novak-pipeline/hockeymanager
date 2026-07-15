/**
 * Playoff scoring tightening: postseason games must score meaningfully less than
 * the regular season (both engines), while regular-season play is left exactly as
 * it was.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { Player, PlayerId } from '@domain'
import { playoffScoringMult } from './rules'
import { fullSimGame } from '@engine/full/fullSim'
import { quickSimGame } from '@engine/quick/quickSim'

describe('playoffScoringMult', () => {
  it('tightens the postseason and leaves the regular season alone', () => {
    expect(playoffScoringMult('regularSeason')).toBe(1)
    expect(playoffScoringMult('playoff')).toBeGreaterThan(0.8)
    expect(playoffScoringMult('playoff')).toBeLessThan(1)
  })
})

describe('playoff games score less than the regular season', () => {
  const data = generateLeague({ seed: 99 })
  const resolve = (id: PlayerId): Player => {
    const p = data.players.get(id)
    if (!p) throw new Error(`unknown ${id}`)
    return p
  }
  const teams = data.league.teams
  const totalGoals = (sim: typeof fullSimGame, rules?: 'playoff'): number => {
    let g = 0
    for (let i = 0; i < 60; i++) {
      const home = data.teams.get(teams[i % teams.length])!
      const away = data.teams.get(teams[(i + 1) % teams.length])!
      const out = sim(home, away, resolve, { seed: 5000 + i, rules })
      g += out.homeGoals + out.awayGoals
    }
    return g
  }

  it('full sim: postseason is tighter, regular season unchanged', () => {
    const reg = totalGoals(fullSimGame)
    const regExplicit = totalGoals(fullSimGame, undefined) // default === regularSeason
    const po = totalGoals(fullSimGame, 'playoff')
    expect(reg).toBe(regExplicit) // regular-season path untouched
    expect(po).toBeLessThan(reg * 0.98) // clearly fewer goals in the playoffs
  }, 60000)

  it('quick sim: postseason is tighter', () => {
    const reg = totalGoals(quickSimGame)
    const po = totalGoals(quickSimGame, 'playoff')
    expect(po).toBeLessThan(reg * 0.97)
  }, 30000)
})
