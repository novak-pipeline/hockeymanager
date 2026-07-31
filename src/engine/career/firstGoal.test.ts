/**
 * "His first NHL goal" — the claim the game is only sometimes entitled to make
 * (playtest C3). The recap called a 39-year-old franchise legend a first-time
 * scorer because the detector read his IN-SIM stat ledger, which is empty for
 * every player who existed before the save did.
 *
 * These tests drive the real career engine and assert the claim is never made
 * about a man who plainly has a career behind him.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { CareerSeasonRecord } from '@domain/player'
import { Career } from './career'
import { DEBUT_PLAUSIBLE_MAX_AGE } from '@engine/story/careerLedger'

const FIRST_GOAL = /first NHL goal/i

/** Sim a regular season, returning every "first NHL goal" beat that fired. */
function firstGoalNews(career: Career, days = 400): Array<{ headline: string; playerId?: string }> {
  for (let i = 0; i < days; i++) {
    if (!career.advanceDay()) break
  }
  return career
    .exportSnapshot('t', '2026-01-01')
    .news.filter((n) => FIRST_GOAL.test(n.headline) || FIRST_GOAL.test(n.body))
    .map((n) => ({ headline: n.headline, ...(n.playerId ? { playerId: n.playerId } : {}) }))
}

describe('first NHL goal — who may be called a debutant', () => {
  it('never awards a first NHL goal to a player old enough to have a career we never saw', () => {
    // A generated league carries NO imported histories: EVERY player starts with
    // an empty stat ledger, veterans included. That is exactly the state that
    // produced the Malkin recap, so nobody over debut age may be named.
    const data = generateLeague({ seed: 4242 })
    const career = new Career(data, 4242, data.league.teams[0]!)
    const news = firstGoalNews(career)

    for (const n of news) {
      const p = n.playerId ? data.players.get(n.playerId as never) : undefined
      expect(p, `news names a player not in the league: ${n.headline}`).toBeDefined()
      expect(p!.age, `"${n.headline}" — he is ${p!.age}`).toBeLessThanOrEqual(DEBUT_PLAUSIBLE_MAX_AGE)
    }
  })

  it('never awards a first NHL goal to an imported veteran with real goals on his record', () => {
    const data = generateLeague({ seed: 909 })
    const userId = data.league.teams[0]!
    const clubName = (id: string): string => data.teams.get(id as never)!.name

    // Give every club's men a REAL imported career in a league whose clubs are
    // ours — the shape a roster mod ships. Veterans get goals on the record;
    // the kids get junior seasons only, so their first goal is still theirs.
    const LEAGUE = 'National Hockey League'
    const scorers = new Set<string>()
    for (const teamId of data.league.teams) {
      for (const pid of data.teams.get(teamId as never)!.roster) {
        const p = data.players.get(pid)!
        const rows: CareerSeasonRecord[] = []
        const veteran = p.age >= 25
        rows.push({
          year: 2024,
          club: veteran ? clubName(teamId as unknown as string) : 'London Knights',
          league: veteran ? LEAGUE : 'Ontario Hockey League',
          gamesPlayed: 82,
          goals: veteran ? 18 : 30,
          assists: 20,
          penaltyMinutes: 20,
          plusMinus: 0,
          minutes: 0,
          goalsAgainst: 0,
          shutouts: 0,
          wins: 0,
          losses: 0,
          otLosses: 0,
          saves: 0,
        })
        p.careerHistory = rows
        if (veteran) scorers.add(pid as unknown as string)
      }
    }

    const career = new Career(data, 909, userId)
    const news = firstGoalNews(career)
    for (const n of news) {
      expect(scorers.has(n.playerId ?? ''), `"${n.headline}" — he already had 18 imported goals`).toBe(false)
    }
  })

  it('still tells the story when a genuine debutant scores', () => {
    // The fix must not silence the beat itself: a young man with an empty
    // record who scores is still front-page news on his club.
    const data = generateLeague({ seed: 4242 })
    const career = new Career(data, 4242, data.league.teams[0]!)
    const news = firstGoalNews(career)
    expect(news.length).toBeGreaterThan(0)
  })
})
