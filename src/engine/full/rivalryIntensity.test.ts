/**
 * Rivalry intensity: a grudge match should be visibly chippier — more hits and
 * more trips to the penalty box — while an ordinary game (intensity 0, the
 * default everywhere except a real rivalry) plays exactly as before. Goals stay
 * roughly flat, so it's a chippier game, not a higher-scoring one.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { Player, PlayerId } from '@domain'
import { fullSimGame } from './fullSim'
import { quickSimGame } from '@engine/quick/quickSim'

function rates(sim: typeof fullSimGame | typeof quickSimGame, intensity: number, games = 40) {
  const data = generateLeague({ seed: 99 })
  const resolve = (id: PlayerId): Player => data.players.get(id)!
  const teams = [...data.league.teams]
  let hits = 0
  let pens = 0
  let goals = 0
  for (let i = 0; i < games; i++) {
    const home = data.teams.get(teams[i % teams.length])!
    const away = data.teams.get(teams[(i + 1) % teams.length])!
    const out = sim(home, away, resolve, { seed: 5000 + i, intensity })
    for (const e of out.stream) {
      if (e.type === 'hit') hits++
      else if (e.type === 'penalty') pens++
      else if (e.type === 'goal') goals++
    }
  }
  return { hits: hits / games, pens: pens / games, goals: goals / games }
}

describe('rivalry intensity in the full sim', () => {
  it('a grudge match brings more hits and penalties, roughly flat scoring', () => {
    const calm = rates(fullSimGame, 0)
    const heated = rates(fullSimGame, 1)
    expect(heated.hits).toBeGreaterThan(calm.hits * 1.1) // clearly more bodychecks
    expect(heated.pens).toBeGreaterThan(calm.pens * 1.1) // clearly more penalties
    // Scoring barely moves — the extra penalties feed some PP but it's a chippier
    // game, not a track meet.
    expect(heated.goals).toBeGreaterThan(calm.goals * 0.9)
    expect(heated.goals).toBeLessThan(calm.goals * 1.15)
  }, 60000)
})

describe('rivalry intensity in the quick sim', () => {
  it('a grudge match draws more penalties', () => {
    const calm = rates(quickSimGame, 0)
    const heated = rates(quickSimGame, 1)
    expect(heated.pens).toBeGreaterThan(calm.pens * 1.1)
  }, 30000)
})
