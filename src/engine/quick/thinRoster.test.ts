/**
 * Thin-roster survival. The 10-season autopilot gate died twice on the same
 * class of bug: the quick sim read `.id` off a skater picked out of an EMPTY
 * array. It only ever bit in the world/junior leagues, where rosters are thin
 * and lines are sparse, so the NHL-shaped tests never saw it — the crash
 * surfaced mid-career (season 2028, day 38) and abandoned the season.
 *
 * These assert the player-facing claim: a game between under-manned clubs
 * still SIMS. It may be a bad game of hockey; it may not be a crash.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { Player, PlayerId, Team } from '@domain'
import { quickSimGame } from './quickSim'

/** A club whose line sheet is blank — nobody is deployed anywhere. */
function stripLines(t: Team): Team {
  return {
    ...t,
    lines: {
      forwards: [[], [], [], []] as unknown as Team['lines']['forwards'],
      defensePairs: [[], [], []] as unknown as Team['lines']['defensePairs'],
      goalies: t.lines.goalies,
      powerPlayUnits: [],
      penaltyKillUnits: [],
    },
  }
}

function league(seed: number) {
  const data = generateLeague({ seed })
  const [a, b] = data.league.teams
  const resolve = (id: PlayerId): Player => data.players.get(id)!
  return { home: data.teams.get(a!)!, away: data.teams.get(b!)!, resolve }
}

describe('quick sim survives thin/under-manned rosters', () => {
  it('sims a game where neither club has any lines set', () => {
    const { home, away, resolve } = league(4242)
    const res = quickSimGame(stripLines(home), stripLines(away), resolve, {
      seed: 7,
      leagueAvg: 70,
    })
    expect(res.homeGoals).toBeGreaterThanOrEqual(0)
    expect(res.awayGoals).toBeGreaterThanOrEqual(0)
    // A winner is still decided — the game is played to a conclusion.
    expect(res.homeGoals).not.toBe(res.awayGoals)
  })

  it('sims a game where one club is blank and the other is whole', () => {
    const { home, away, resolve } = league(818)
    expect(() =>
      quickSimGame(stripLines(home), away, resolve, { seed: 11, leagueAvg: 70 }),
    ).not.toThrow()
  })

  it('sims a club stripped to a skeleton roster (2 skaters)', () => {
    const { home, away, resolve } = league(1301)
    const skeleton: Team = { ...stripLines(home), roster: home.roster.slice(0, 2) }
    expect(() =>
      quickSimGame(skeleton, away, resolve, { seed: 3, leagueAvg: 70 }),
    ).not.toThrow()
  })

  // The actual autopilot crash: NOBODY is available to skate, so every
  // pick-a-skater path (shot, empty-net, penalty) gets an empty array. Anything
  // with a roster left has a fallback; this is the true floor.
  it('sims a club with no skaters at all — only goalies dressed', () => {
    const { home, away, resolve } = league(555)
    const goaliesOnly: Team = {
      ...stripLines(home),
      roster: home.roster.filter((id) => resolve(id).position === 'G'),
    }
    expect(goaliesOnly.roster.length).toBeGreaterThan(0)
    expect(() =>
      quickSimGame(goaliesOnly, away, resolve, { seed: 9, leagueAvg: 70 }),
    ).not.toThrow()
  })
})
