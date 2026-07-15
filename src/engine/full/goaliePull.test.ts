/**
 * Goalie-pull timing. The old rule pulled only when down 1–2, always in the
 * last 90 seconds — every team, every situation, the same. Now the window
 * widens with the deficit (you gamble earlier the more you trail), down-3 teams
 * pull at all, down-4+ stay honest, and an aggressive bench pulls sooner. These
 * pin the decision curve and confirm it actually fires empty-net play in a real
 * simulated game.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { Player, PlayerId } from '@domain'
import { isEvent } from '@domain'
import { fullSimGame, goaliePullWindow } from './fullSim'

describe('goaliePullWindow — decision curve', () => {
  it('does not pull when tied or leading', () => {
    expect(goaliePullWindow(0, 0.5)).toBe(0)
    expect(goaliePullWindow(-2, 0.5)).toBe(0)
  })

  it('widens the window the more a team trails', () => {
    const d1 = goaliePullWindow(1, 0.5)
    const d2 = goaliePullWindow(2, 0.5)
    const d3 = goaliePullWindow(3, 0.5)
    expect(d1).toBeGreaterThan(60) // ~1:20 down one
    expect(d2).toBeGreaterThan(d1) // pull earlier down two
    expect(d3).toBeGreaterThan(d2) // earlier still down three
    expect(d3).toBeLessThan(300) // but not absurdly early
  })

  it('now pulls when down three (the old rule never did)', () => {
    expect(goaliePullWindow(3, 0.5)).toBeGreaterThan(0)
  })

  it('stays honest when down four or more', () => {
    expect(goaliePullWindow(4, 0.5)).toBe(0)
    expect(goaliePullWindow(6, 1)).toBe(0)
  })

  it('an aggressive bench pulls earlier than a passive one', () => {
    const passive = goaliePullWindow(1, 0)
    const neutral = goaliePullWindow(1, 0.5)
    const aggressive = goaliePullWindow(1, 1)
    expect(passive).toBeLessThan(neutral)
    expect(aggressive).toBeGreaterThan(neutral)
  })

  it('treats a missing aggressiveness slider as neutral', () => {
    expect(goaliePullWindow(2, undefined)).toBe(goaliePullWindow(2, 0.5))
  })
})

describe('goalie pull — fires empty-net play in real games', () => {
  it('a batch of games produces empty-net situations (goals-for or -against)', () => {
    const data = generateLeague({ seed: 77 })
    const resolve = (id: PlayerId): Player => {
      const p = data.players.get(id)
      if (!p) throw new Error(`unknown ${id}`)
      return p
    }
    const teams = data.league.teams
    // Count empty-net goals across a decent batch — close games late will pull.
    let enGoals = 0
    let games = 0
    for (let i = 0; i < 60; i++) {
      const home = data.teams.get(teams[i % teams.length])!
      const away = data.teams.get(teams[(i + 1) % teams.length])!
      const out = fullSimGame(home, away, resolve, { seed: 33000 + i })
      games++
      for (const ev of out.stream) if (isEvent(ev, 'goal') && ev.strength === 'en') enGoals++
    }
    // Empty-net goals are rare but real; across 60 games at least a few land.
    expect(games).toBe(60)
    expect(enGoals).toBeGreaterThan(0)
  })
})
