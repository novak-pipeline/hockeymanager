/**
 * Per-game goalie variance — the "hot goalie steals it" / "off night" lever.
 * The unit tests pin the multiplier's shape (mean 1, symmetric, deterministic,
 * clamped); the integration test drives real full-sim games between two IDENTICAL
 * teams (so the only thing separating them is the goalie's night) and confirms a
 * hot netminder wins materially more than a cold one — with league scoring
 * unchanged on average.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { Player, PlayerId, Team } from '@domain'
import { asPlayerId, asTeamId } from '@domain'
import { goalieNightFactor } from './goalieNight'
import { fullSimGame } from '@engine/full/fullSim'

describe('goalieNightFactor', () => {
  it('is deterministic for a given game + goalie', () => {
    expect(goalieNightFactor(1234, 'g1')).toBe(goalieNightFactor(1234, 'g1'))
  })

  it('varies by game and by goalie', () => {
    expect(goalieNightFactor(1, 'g1')).not.toBe(goalieNightFactor(2, 'g1'))
    expect(goalieNightFactor(1, 'g1')).not.toBe(goalieNightFactor(1, 'g2'))
  })

  it('centers on 1.0 across many games (mean-neutral → calibration-safe)', () => {
    let sum = 0
    const N = 4000
    for (let i = 0; i < N; i++) sum += goalieNightFactor(i, 'goalie-x')
    expect(sum / N).toBeGreaterThan(0.99)
    expect(sum / N).toBeLessThan(1.01)
  })

  it('produces both hot nights (<1) and off nights (>1), always clamped sane', () => {
    let hot = 0
    let cold = 0
    for (let i = 0; i < 2000; i++) {
      const f = goalieNightFactor(i, 'g')
      if (f < 0.95) hot++
      if (f > 1.05) cold++
      expect(f).toBeGreaterThan(0.6) // clamp floor (1 - CAP)
      expect(f).toBeLessThan(1.4) // clamp ceiling (1 + CAP)
    }
    expect(hot).toBeGreaterThan(100)
    expect(cold).toBeGreaterThan(100)
  })
})

describe('goalie variance in real games (equal-strength mirror)', () => {
  it('a hot goalie steals games a cold one loses', () => {
    const data = generateLeague({ seed: 99 })
    const src = data.teams.get(data.league.teams[0])!
    const clones = new Map<PlayerId, Player>()
    const remap = (ids: PlayerId[]): PlayerId[] => ids.map((i) => asPlayerId(`${i}_B`))
    for (const id of src.roster) clones.set(asPlayerId(`${id}_B`), { ...data.players.get(id)!, id: asPlayerId(`${id}_B`) })
    const teamB: Team = {
      ...src,
      id: asTeamId('MIRROR'),
      abbreviation: 'MIR',
      roster: remap(src.roster),
      lines: {
        forwards: src.lines.forwards.map(remap) as Team['lines']['forwards'],
        defensePairs: src.lines.defensePairs.map(remap) as Team['lines']['defensePairs'],
        goalies: remap(src.lines.goalies) as Team['lines']['goalies'],
        powerPlayUnits: src.lines.powerPlayUnits.map(remap),
        penaltyKillUnits: src.lines.penaltyKillUnits.map(remap),
      },
    }
    const resolve = (id: PlayerId): Player => data.players.get(id) ?? clones.get(id)!
    let hotWins = 0
    let hotN = 0
    let coldWins = 0
    let coldN = 0
    for (let i = 0; i < 400; i++) {
      const seed = 30000 + i
      const out = fullSimGame(src, teamB, resolve, { seed })
      if (out.homeGoals === out.awayGoals) continue
      const homeGoalieNight = goalieNightFactor(seed, src.lines.goalies[0] as string)
      const homeWon = out.homeGoals > out.awayGoals
      if (homeGoalieNight <= 0.96) { hotN++; if (homeWon) hotWins++ }
      else if (homeGoalieNight >= 1.04) { coldN++; if (homeWon) coldWins++ }
    }
    // Between equal teams, the home goalie's night should clearly swing results.
    expect(hotN).toBeGreaterThan(50)
    expect(coldN).toBeGreaterThan(50)
    expect(hotWins / hotN).toBeGreaterThan(coldWins / coldN + 0.06)
  }, 120000)
})
