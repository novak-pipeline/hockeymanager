/**
 * E1 (playtest 2026-07-31) — production reaches the real draft board.
 *
 * The bug: an 18-year-old with 96-45-141 in 64 MHL games was ranked #60. The
 * ranking formula was tools-only (perceived ceiling + current ability + noise),
 * so the loudest fact about a prospect — what he actually did on the ice — could
 * not move him. `draftRankings.test.ts` pins the pure scoring; this pins the
 * WIRING end-to-end, because a `RankInput.production` that nobody populates would
 * pass every pure test and still ship the bug.
 *
 * Each case builds the world TWICE — the board is memoised per (year, day, phase),
 * so a stat line has to be in place before the Career is constructed.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { buildCompetitions, type RawCompetition } from '@data/leagueWorld'
import { agedPotential, computeComposites } from '@engine/ratings/composites'
import type { CareerSeasonRecord, Player } from '@domain'
import { Career } from './career'

const SEED = 2029

const line = (gp: number, g: number, a: number, club: string): CareerSeasonRecord => ({
  year: 2025, club, league: 'MHL', gamesPlayed: gp, goals: g, assists: a,
  penaltyMinutes: 0, plusMinus: 0, minutes: 0, goalsAgainst: 0, shutouts: 0,
  wins: 0, losses: 0, otLosses: 0, saves: 0,
})

/**
 * A generated league with one junior competition (MHL) whose players are all
 * draft-eligible, each carrying an ordinary ~0.55 ppg season — the `careerHistory`
 * line the pre-draft board reads before a new campaign accrues games. `plant` runs
 * over the cohort before the Career is built, to hand out the lines under test.
 */
function juniorWorld(plant?: (skaters: Player[]) => void): { career: Career; skaters: Player[] } {
  const data = generateLeague({ seed: SEED })
  const teamIds = data.league.teams.slice(0, 8)
  const comps: RawCompetition[] = [
    { id: 'mhl', name: 'Molodyozhnaya Hockey League', abbrev: 'MHL', nation: 'Russia', level: 1, reputation: 11 },
  ]
  data.league.competitions = buildCompetitions({
    comps,
    membership: teamIds.map((teamId) => ({ teamId, competitionId: 'mhl' })),
    season: 2025,
  })
  const skaters: Player[] = []
  let i = 0
  for (const tid of teamIds) {
    const t = data.teams.get(tid)!
    for (const pid of t.roster) {
      const p = data.players.get(pid)!
      p.age = 17 + (i++ % 2)
      p.nhlDrafted = false
      // Real prospect headroom: current ability well below (unchanged) potential.
      for (const grp of [p.ratings.technical, p.ratings.physical, p.ratings.mental, p.ratings.goalie]) {
        if (!grp) continue
        const g = grp as unknown as Record<string, number>
        for (const k of Object.keys(g)) { if (k !== 'height') g[k] = Math.max(8, Math.round(g[k] * 0.62)) }
      }
      p.composites = computeComposites(p.ratings, p.role, p.position)
      if (p.position !== 'G') {
        p.careerHistory = [line(64, 14, 21, t.name)]
        skaters.push(p)
      }
    }
  }
  // Stable order (worst true potential first) so "an unremarkable prospect" is the
  // same player in both worlds.
  skaters.sort((a, b) => agedPotential(a) - agedPotential(b) || (a.id as string).localeCompare(b.id as string))
  plant?.(skaters)
  return { career: new Career(data, SEED, data.league.teams[20] ?? data.league.teams[0]!), skaters }
}

describe('draft board production (E1)', () => {
  it('a historic producer lands in the top 25 of both the consensus and our own board', () => {
    // A prospect in the bottom tenth of the cohort on hidden tools, so nothing but
    // production can carry him up the board.
    const pick = (skaters: Player[]): Player => skaters[Math.floor(skaters.length * 0.1)]!

    const quiet = juniorWorld()
    const target = pick(quiet.skaters).id as string
    const before = quiet.career.getDraftRankings().fullRankById[target]!
    expect(before).toBeGreaterThan(40) // he starts deep in the class

    // Same world, same player — now with the playtest's line: 96-45-141 in 64.
    const loud = juniorWorld((skaters) => {
      const p = pick(skaters)
      p.age = 18
      p.careerHistory = [line(64, 96, 45, 'Junior Club')]
    })
    expect(pick(loud.skaters).id as string).toBe(target)
    const view = loud.career.getDraftRankings()
    const rank = view.fullRankById[target]!
    expect(rank).toBeLessThanOrEqual(25)
    expect(rank).toBeLessThan(before)

    // Our own scouts' board must move too — production is not fog-of-war, so a
    // board that ignored it would read a monster producer as a nobody and then
    // flag the public consensus as being "too high" on him.
    const ours = view.scoutBoard.find((r) => r.playerId === target)
    expect(ours).toBeDefined()
    expect(ours!.rank).toBeLessThanOrEqual(25)
  })

  it('a prospect who did nothing slides below a comparable prospect who produced', () => {
    // Two prospects adjacent in true potential — the board should split them on
    // what they did, not on a hash.
    const pairOf = (skaters: Player[]): [Player, Player] => {
      const mid = Math.floor(skaters.length * 0.6)
      const a = skaters[mid]!
      const b = skaters.slice(mid + 1).find((p) => p.position === a.position && Math.abs(agedPotential(p) - agedPotential(a)) <= 1)!
      return [a, b]
    }
    const { career, skaters } = juniorWorld((s) => {
      const [a, b] = pairOf(s)
      a.age = 18; b.age = 18
      a.careerHistory = [line(64, 3, 5, 'Junior Club')]   // 8 points in a full season
      b.careerHistory = [line(64, 34, 44, 'Junior Club')] // 78 points — a real scorer
    })
    const [noShow, scorer] = pairOf(skaters)
    const ranks = career.getDraftRankings().fullRankById
    expect(ranks[scorer.id as string]!).toBeLessThan(ranks[noShow.id as string]!)
  })
})
