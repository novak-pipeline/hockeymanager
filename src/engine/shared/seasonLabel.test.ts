/**
 * Loop audit F15: one way to name a season. The takeover summer of a 2026–27
 * database read "2025 season", "Owner sets the 2025 mandate" and "2025–2026
 * season begins".
 */
import { describe, expect, it } from 'vitest'
import { Rng } from '@engine/shared/rng'
import { setSeasonMandate } from '@engine/league/board'
import { buildPreseasonOdds } from '@engine/story/expectations'
import { managedSeasonLabel, seasonLabel } from './seasonLabel'

describe('season labels', () => {
  it('names a season "2026–27", and the summer by the season it builds toward', () => {
    expect(seasonLabel(2026)).toBe('2026–27')
    expect(seasonLabel(2099)).toBe('2099–00')
    expect(managedSeasonLabel(2026, 'regularSeason')).toBe('2026–27')
    expect(managedSeasonLabel(2026, 'playoffs')).toBe('2026–27')
    // June 2027, the summer after the 2026–27 season: the club is building for 2027–28.
    expect(managedSeasonLabel(2026, 'offseason')).toBe('2027–28')
  })

  it('the mandate and the power rankings speak the same label', () => {
    const m = setSeasonMandate({ teamStrengthRank: 5, teamsInLeague: 32, rng: new Rng(1), year: 2025, teamName: 'Pittsburgh', seasonLabel: '2026–27' })
    expect(m.newsSeed.headline).toMatch(/^Owner sets the 2026–27 mandate for Pittsburgh/)
    expect(m.newsSeed.body).not.toMatch(/\b2025\b/)
    const plain = setSeasonMandate({ teamStrengthRank: 5, teamsInLeague: 32, rng: new Rng(1), year: 2026, teamName: 'Pittsburgh' })
    expect(plain.newsSeed.headline).toMatch(/^Owner sets the 2026–27 mandate/)
    const teams = Array.from({ length: 8 }, (_, i) => ({ teamId: `t${i}`, name: `Team ${i}`, strength: 60 + i, lastYearRank: i + 1 }))
    const odds = buildPreseasonOdds({ teams: teams as never, year: 2025, rng: new Rng(2), seasonLabel: '2026–27' })
    expect(odds.newsSeeds.some((s) => s.headline.startsWith('2026–27 Power Rankings'))).toBe(true)
  })
})
