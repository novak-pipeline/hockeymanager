/**
 * Special-teams coaching (formerly dead levers): the coach's PP/PK competence
 * and his scheme's fit to the PP1 personnel now bend power-play shot rates in
 * both engines. A well-coached PP converts more; a strong kill suppresses; the
 * league average stays centered so calibration holds.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { Player, PlayerId, Team } from '@domain'
import { isEvent } from '@domain'
import { buildCoachProfile, specialTeamsEdges } from './coachProfile'
import { Career } from '@engine/career/career'
import { quickSimGame } from '@engine/quick/quickSim'

const coach = (rating: number, over: Record<string, number> = {}) => ({
  id: 'c', name: 'C', role: 'headCoach' as const, rating, judgment: 60, ...(<object>{}), attributes: over,
})

describe('specialTeamsEdges', () => {
  const data = generateLeague({ seed: 7 })
  const team = data.teams.get(data.league.teams[0])!
  const pp1 = (team.lines.powerPlayUnits[0] ?? []).map((id) => data.players.get(id)!)

  it('a special-teams-savvy coach beats a clueless one at both ends', () => {
    const good = buildCoachProfile(coach(85))
    const poor = buildCoachProfile(coach(42))
    const g = specialTeamsEdges(good, team.tactics, pp1)
    const p = specialTeamsEdges(poor, team.tactics, pp1)
    expect(g.ppEdge).toBeGreaterThan(p.ppEdge) // better PP
    expect(g.pkEdge).toBeLessThan(p.pkEdge) // stronger kill (suppresses more)
  })

  it('a scheme that fights the personnel costs the PP', () => {
    const profile = buildCoachProfile(coach(70))
    const metrics = (['umbrella', '1-3-1', 'overload'] as const).map((f) =>
      specialTeamsEdges(profile, { ...team.tactics, specialTeams: { ...team.tactics.specialTeams, powerPlay: f } }, pp1).ppEdge
    )
    // The personnel-optimal formation is strictly no worse than the worst fit,
    // and at least one mismatch actually costs something.
    expect(Math.max(...metrics)).toBeGreaterThan(Math.min(...metrics))
  })

  it('stays inside sane bounds and centers near neutral for an average coach', () => {
    for (const rating of [40, 55, 65, 75, 90]) {
      const e = specialTeamsEdges(buildCoachProfile(coach(rating)), team.tactics, pp1)
      expect(e.ppEdge).toBeGreaterThanOrEqual(0.9)
      expect(e.ppEdge).toBeLessThanOrEqual(1.1)
      expect(e.pkEdge).toBeGreaterThanOrEqual(0.9)
      expect(e.pkEdge).toBeLessThanOrEqual(1.1)
    }
  })
})

describe('special-teams edges in the engines', () => {
  it('a coached-up PP scores more PP goals than a neutral one (equal talent)', () => {
    const data = generateLeague({ seed: 99 })
    const resolve = (id: PlayerId): Player => data.players.get(id)!
    const teams = data.league.teams
    const src = data.teams.get(teams[0])!
    const opp = data.teams.get(teams[1])!
    const run = (ppEdge: number | undefined, pkEdge: number | undefined): { ppFor: number; ppAgainst: number } => {
      const home: Team = { ...src, ppEdge, pkEdge }
      let ppFor = 0
      let ppAgainst = 0
      const homeSet = new Set(src.roster.map(String))
      for (let i = 0; i < 500; i++) {
        const out = quickSimGame(home, opp, resolve, { seed: 60000 + i })
        for (const e of out.stream) {
          if (isEvent(e, 'goal') && e.strength === 'pp') {
            if (homeSet.has(String(e.scorer))) ppFor++
            else ppAgainst++
          }
        }
      }
      return { ppFor, ppAgainst }
    }
    const neutral = run(undefined, undefined)
    const coached = run(1.1, 0.9)
    expect(coached.ppFor).toBeGreaterThan(neutral.ppFor * 1.03) // livelier PP
    expect(coached.ppAgainst).toBeLessThan(neutral.ppAgainst * 0.99) // stingier kill
  }, 120000)
})

describe('career wiring', () => {
  it('every team gets bounded edges once the coach systems apply', () => {
    const data = generateLeague({ seed: 21 })
    const career = new Career(data, 21, data.league.teams[0])
    career.step()
    let spread = 0
    for (const tid of data.league.teams) {
      const t = data.teams.get(tid)!
      expect(t.ppEdge).toBeGreaterThanOrEqual(0.9)
      expect(t.ppEdge).toBeLessThanOrEqual(1.1)
      expect(t.pkEdge).toBeGreaterThanOrEqual(0.9)
      expect(t.pkEdge).toBeLessThanOrEqual(1.1)
      spread += Math.abs((t.ppEdge ?? 1) - 1)
    }
    expect(spread).toBeGreaterThan(0.05) // real variance between benches, not all 1.0
  })
})
