/**
 * Broadcast package — the career builds tonight's pregame context BEFORE the
 * watched game is simmed, so counts are "before tonight", and every storyline it
 * hands the director is one the facts support.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from './career'

describe('Career — broadcast context', () => {
  it('builds a pregame context for the watched game with both dressed rosters', () => {
    const data = generateLeague({ seed: 4242 })
    const userId = data.league.teams[0]!
    const career = new Career(data, 4242, userId)
    expect(career.getBroadcastContext()).toBeNull()
    let game = career.watchNext()
    for (let i = 0; i < 20 && !game; i++) game = career.watchNext()
    expect(game).not.toBeNull()
    const ctx = career.getBroadcastContext()!
    expect(ctx).not.toBeNull()
    expect(ctx.homeAbbr).toBe(game!.homeAbbr)
    expect(ctx.awayAbbr).toBe(game!.awayAbbr)
    // Both benches dressed: 18 skaters + starting goalie a side (short OK).
    const home = Object.values(ctx.players).filter((p) => p.side === 'home')
    const away = Object.values(ctx.players).filter((p) => p.side === 'away')
    expect(home.length).toBeGreaterThanOrEqual(12)
    expect(away.length).toBeGreaterThanOrEqual(12)
    expect(ctx.home.goalieId).not.toBeNull()
    expect(ctx.players[ctx.home.goalieId!]!.position).toBe('G')
    // Starters are dressed players, and every stream skater is known by name.
    for (const id of [...ctx.home.starters, ...ctx.away.starters]) expect(ctx.players[id]).toBeDefined()
    // First game of the season: season lines are zero BEFORE tonight.
    for (const p of Object.values(ctx.players)) {
      expect(p.seasonGoals).toBe(0)
      expect(p.seasonAssists).toBe(0)
    }
    // Every storyline names a dressed player (or is the banner night).
    for (const s of ctx.storylines) {
      if (s.kind !== 'bannerNight') expect(ctx.players[s.playerId!]).toBeDefined()
    }
    // A generated league's record book seeds a plausible past, so banner night
    // may legitimately fire on opening night — but only for the HOME club.
    const banner = ctx.storylines.find((s) => s.kind === 'bannerNight')
    if (banner) expect(banner.side).toBe('home')
  })
})
