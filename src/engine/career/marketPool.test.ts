/**
 * Gap #8 — the AI trade market only calls from clubs that can actually trade.
 *
 * `data.teams` is the whole hockey world, not the league. On the imported NHL
 * database that is 460 clubs: 32 NHL, 32 AHL affiliates, 396 junior and European
 * sides. The offer generator was handed all of them, so most "calls" came from a
 * club with no tradeable roster and no draft picks; the offer was assembled,
 * found wanting, and dropped. The phone never rang — which is what the autopilot
 * reported as 0 trades in two seasons.
 *
 * Measured on the imported league: 0.3% of days produced an offer before, 4.0%
 * after, and end-to-end a season went from 0 inbound offers to 8.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { leagueTeamsOnly } from './career'
import { asTeamId } from '@domain/ids'
import type { Team } from '@domain/team'

describe('leagueTeamsOnly', () => {
  it('returns exactly the league members, however much world sits beside them', () => {
    const data = generateLeague({ seed: 2029 })
    const leagueSize = data.league.teams.length

    // Pad the world the way a real import does — far more non-league clubs than
    // league ones. Under the old behaviour these were all valid trade partners.
    const template = data.teams.get(data.league.teams[0]!)!
    for (let i = 0; i < 400; i++) {
      const id = asTeamId(`world-pad-${i}`)
      data.teams.set(id, { ...template, id, tier: 'world' } as Team)
    }
    expect(data.teams.size).toBeGreaterThan(leagueSize * 10)

    const pool = leagueTeamsOnly(data)
    expect(pool.size).toBe(leagueSize)
    for (const tid of data.league.teams) expect(pool.has(tid)).toBe(true)
    for (const id of pool.keys()) expect(String(id).startsWith('world-pad-')).toBe(false)
  })

  it('skips ids the league lists but the team map has lost', () => {
    const data = generateLeague({ seed: 2029 })
    data.teams.delete(data.league.teams[0]!)
    // A dangling id must not become an undefined entry the generator then reads.
    const pool = leagueTeamsOnly(data)
    expect(pool.size).toBe(data.league.teams.length - 1)
    for (const t of pool.values()) expect(t).toBeDefined()
  })
})
