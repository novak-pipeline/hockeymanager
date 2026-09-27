import { describe, expect, it } from 'vitest'
import { generateLeague, DEFAULT_TACTICS } from '@data/generate'
import type { Player } from '@domain'
import { runNationsCup, runOlympics, runWorldJuniors, selectSquads, seniorEventFor } from './international'

const NATIONS = ['Canada', 'United States', 'Sweden', 'Finland', 'Russia', 'Czechia', 'Slovakia', 'Switzerland', 'Germany', 'Latvia', 'Denmark', 'Norway']

function world(): { players: Map<Player['id'], Player> } {
  const data = generateLeague({ seed: 11 })
  // Spread the generated league's players over twelve nations.
  let i = 0
  for (const p of data.players.values()) { p.nationality = NATIONS[i++ % NATIONS.length]; p.injuryStatus = null }
  return { players: data.players }
}

describe('international tournaments', () => {
  it('schedules the Olympics in 2026/2030 seasons and the Nations Cup between', () => {
    expect(seniorEventFor(2025)).toBe('olympics')
    expect(seniorEventFor(2027)).toBe('nationsCup')
    expect(seniorEventFor(2026)).toBeNull()
    expect(seniorEventFor(2029)).toBe('olympics')
  })

  it('plays the World Juniors format to a full medal table', () => {
    const { players } = world()
    const squads = selectSquads({ pool: players.values(), players, fieldSize: 10, tactics: DEFAULT_TACTICS, tag: 't' })
    expect(squads.length).toBeGreaterThanOrEqual(8)
    const r = runWorldJuniors({ squads, players, year: 2025, seed: 5 })!
    expect(r.record.gold).toBeTruthy()
    expect(new Set([r.record.gold, r.record.silver, r.record.bronze]).size).toBe(3)
    expect(r.record.standings).toHaveLength(squads.length)
    expect(r.record.allStars.length).toBeGreaterThanOrEqual(5)
    expect(r.record.topScorer).not.toBeNull()
    // every roster player's line is recorded; no double-counted games (≤ 7 games)
    for (const l of r.lines) expect(l.gp).toBeLessThanOrEqual(7)
  })

  it('is deterministic for a seed', () => {
    const a = world(); const b = world()
    const sa = selectSquads({ pool: a.players.values(), players: a.players, fieldSize: 12, tactics: DEFAULT_TACTICS, tag: 't' })
    const sb = selectSquads({ pool: b.players.values(), players: b.players, fieldSize: 12, tactics: DEFAULT_TACTICS, tag: 't' })
    expect(runOlympics({ squads: sa, players: a.players, year: 2025, seed: 9 })!.record.standings)
      .toEqual(runOlympics({ squads: sb, players: b.players, year: 2025, seed: 9 })!.record.standings)
  })

  it('Nations Cup: four nations, a final, no bronze', () => {
    const { players } = world()
    const squads = selectSquads({ pool: players.values(), players, fieldSize: 4, tactics: DEFAULT_TACTICS, tag: 'n' })
    const r = runNationsCup({ squads, players, year: 2027, seed: 3 })!
    expect(r.record.standings).toHaveLength(4)
    expect(r.record.bronze).toBeNull()
    expect(r.record.finalLine).toContain(r.record.gold!)
  })
})
