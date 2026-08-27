/**
 * Scouting should be WORK (playtest 2026-08-26, section C).
 *
 * The through-line of these tests is one rule: the game must not hand the GM an
 * answer his department has not earned. So they assert on the ABSENCE of free
 * information as hard as they assert on the presence of earned information —
 * an empty watch list, a dash where an unscouted ceiling used to be, a radar
 * list that contains only players somebody actually watched — plus the payoff
 * that makes the removal worth it: a pin genuinely redirects the department.
 */
import { describe, expect, it } from 'vitest'
import type { Player, PlayerId, TeamId } from '@domain'
import type { ScoutingState } from '@domain/scouting'
import { generateLeague } from '@data/generate'
import { buildCompetitions, type RawCompetition } from '@data/leagueWorld'
import { computeComposites } from '@engine/ratings/composites'
import {
  addKnowledge, knowledgeOf, tickScouting, MAX_WATCH_LIST, SCOUT_SEEN_THRESHOLD,
} from '@engine/league/scouting'
import { Rng } from '@engine/shared/rng'
import { Career } from './career'

function scoutingOf(c: Career): ScoutingState {
  return (c as unknown as { scouting: ScoutingState }).scouting
}

function newCareer(seed = 4242): Career {
  const data = generateLeague({ seed })
  return new Career(data, seed, data.league.teams[0]!)
}

/* ── C1: the watch list is the GM's, and it starts empty ─────────────────── */

describe('C1 — the watch list is built by hand', () => {
  it('starts empty on a fresh career', () => {
    const career = newCareer()
    expect(career.getScouting().watchList).toEqual([])
  })

  it('only ever fills by an explicit act, and toggling takes him off again', () => {
    const career = newCareer()
    const target = career.getScouting().recommendations[0]?.playerId
      ?? [...(career as unknown as { data: { players: Map<PlayerId, Player> } }).data.players.keys()][40] as unknown as string

    const added = career.toggleWatchPlayer(target)
    expect(added.watching).toBe(true)
    const list = career.getScouting().watchList
    expect(list.map((w) => w.playerId)).toEqual([target])
    expect(list[0]!.addedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    const removed = career.toggleWatchPlayer(target)
    expect(removed.watching).toBe(false)
    expect(career.getScouting().watchList).toEqual([])
  })

  it('records the knowledge at the moment of pinning, so the panel can show the gain', () => {
    const career = newCareer()
    const st = scoutingOf(career)
    const pid = st.knowledge.find(([, k]) => k > 10 && k < 60)?.[0]
    expect(pid).toBeDefined()
    const before = Math.round(knowledgeOf(st, pid!))
    career.watchPlayer(pid!)
    expect(career.getScouting().watchList[0]!.knowledgeAtAdd).toBe(before)
  })

  it('caps the list — scout days are finite, so the pin has to cost something', () => {
    const career = newCareer()
    const ids = [...(career as unknown as { data: { players: Map<PlayerId, Player> } }).data.players.keys()]
      .slice(0, MAX_WATCH_LIST + 5)
      .map((id) => id as unknown as string)
    for (const id of ids.slice(0, MAX_WATCH_LIST)) expect(career.watchPlayer(id).ok).toBe(true)
    const overflow = career.watchPlayer(ids[MAX_WATCH_LIST]!)
    expect(overflow.ok).toBe(false)
    expect(overflow.message).toMatch(/full/i)
    expect(career.getScouting().watchList).toHaveLength(MAX_WATCH_LIST)
  })

  it('carries the GM note, and clears it when set to empty', () => {
    const career = newCareer()
    const pid = scoutingOf(career).knowledge[10]![0]
    career.watchPlayer(pid)
    career.setWatchNote(pid, 'PP quarterback if he adds a step')
    expect(career.getScouting().watchList[0]!.note).toBe('PP quarterback if he adds a step')
    career.setWatchNote(pid, '   ')
    expect(career.getScouting().watchList[0]!.note).toBeUndefined()
  })
})

describe('C1 — a pin is an instruction to the department, not a bookmark', () => {
  /** Two identical worlds; in one, a single out-of-scope player is pinned. */
  function runTick(pinned: string | null, days = 12): ScoutingState {
    const data = generateLeague({ seed: 909 })
    const teams = data.teams as Map<TeamId, { roster: PlayerId[]; divisionId?: string }>
    const userTeamId = data.league.teams[0]! as unknown as string
    const state: ScoutingState = {
      knowledge: [],
      assignments: [{
        scoutId: 's1', name: 'Scout', rating: 70, judgment: 70,
        // A brief that is deliberately NOT where the pinned player is.
        target: { kind: 'team', teamId: data.league.teams[1]! as unknown as string }, focus: 'all',
      }],
      watchList: pinned ? [{ playerId: pinned, addedDate: '2026-10-01', knowledgeAtAdd: 0 }] : [],
    }
    for (const p of data.players.values()) state.knowledge.push([p.id as string, 0])
    for (let d = 0; d < days; d++) {
      tickScouting({
        state, userTeamId, teams, players: data.players,
        draftProspectIds: new Set(), freeAgentIds: new Set(),
        rng: new Rng(500 + d),
      })
    }
    return state
  }

  it('gives a pinned out-of-scope player a read his unpinned twin never gets', () => {
    const data = generateLeague({ seed: 909 })
    // Somebody on a club nobody is briefed to watch.
    const otherTeam = data.teams.get(data.league.teams[5]!)!
    const victim = otherTeam.roster[0]! as unknown as string

    const without = runTick(null)
    const with_ = runTick(victim)

    expect(knowledgeOf(without, victim)).toBe(0)
    expect(knowledgeOf(with_, victim)).toBeGreaterThan(10)
  })

  it('shields a watched player from knowledge decay', () => {
    const data = generateLeague({ seed: 77 })
    const teams = data.teams as Map<TeamId, { roster: PlayerId[]; divisionId?: string }>
    const someone = data.teams.get(data.league.teams[6]!)!.roster[1]! as unknown as string
    const twin = data.teams.get(data.league.teams[6]!)!.roster[2]! as unknown as string

    const state: ScoutingState = {
      knowledge: [[someone, 90], [twin, 90]],
      assignments: [],
      watchList: [{ playerId: someone, addedDate: '2026-10-01', knowledgeAtAdd: 90 }],
    }
    for (let d = 0; d < 40; d++) {
      tickScouting({
        state, userTeamId: data.league.teams[0]! as unknown as string, teams, players: data.players,
        draftProspectIds: new Set(), freeAgentIds: new Set(), rng: new Rng(d),
      })
    }
    expect(knowledgeOf(state, someone)).toBe(90)
    expect(knowledgeOf(state, twin)).toBeLessThan(90)
  })
})

/* ── C3: the search is a tool, and it cannot see through fog ─────────────── */

describe('C3 — whole-database player search', () => {
  it('never publishes an ability read on a player nobody has watched', () => {
    const career = newCareer()
    const st = scoutingOf(career)
    // Force a player right down to unscouted.
    const pid = st.knowledge[25]![0]
    addKnowledge(st, pid, -100)

    const res = career.searchPlayers({ text: career.getPlayer(pid).name, limit: 30 })
    const row = res.rows.find((r) => r.playerId === pid)
    expect(row).toBeDefined()
    expect(row!.read).toBe('unscouted')
    expect(row!.readLabel).toBe('Unscouted')
    expect(row!.currentStars).toBeNull()
    expect(row!.potentialStars).toBeNull()
    expect(row!.value).toBeNull()
    // Public facts still come through — the card back is not a scouting product.
    expect(row!.age).toBeGreaterThan(0)
    expect(row!.position.length).toBeGreaterThan(0)
  })

  it('cannot be used to sneak past the fog with a star floor', () => {
    const career = newCareer()
    const st = scoutingOf(career)
    for (const entry of st.knowledge) entry[1] = 0
    const res = career.searchPlayers({ minPotentialStars: 1, limit: 50, excludeOwn: true })
    // Every single player is unreadable, so a star floor matches nobody.
    expect(res.rows).toHaveLength(0)
    expect(res.total).toBe(0)
  })

  it('says out loud how much of a result set the department can actually judge', () => {
    const career = newCareer()
    const res = career.searchPlayers({ excludeOwn: true, limit: 20 })
    expect(res.scoutedCount).toBeLessThanOrEqual(res.total)
    expect(res.fogNote.length).toBeGreaterThan(10)
  })

  it('filters on the public facts a GM would actually query', () => {
    const career = newCareer()
    const byPos = career.searchPlayers({ positions: ['G'], limit: 200 })
    expect(byPos.rows.length).toBeGreaterThan(0)
    expect(byPos.rows.every((r) => r.position === 'G')).toBe(true)

    const byAge = career.searchPlayers({ ageMin: 22, ageMax: 24, limit: 200 })
    expect(byAge.rows.every((r) => r.age >= 22 && r.age <= 24)).toBe(true)

    const byHand = career.searchPlayers({ handedness: 'R', limit: 200 })
    expect(byHand.rows.every((r) => r.handedness === 'R')).toBe(true)

    const named = career.searchPlayers({ text: byPos.rows[0]!.name, limit: 20 })
    expect(named.rows.some((r) => r.playerId === byPos.rows[0]!.playerId)).toBe(true)
  })

  it('excludes your own org on request, and marks watch-listed players', () => {
    const career = newCareer()
    const mine = career.getSquad().rows[0]!.playerId
    expect(career.searchPlayers({ excludeOwn: true, limit: 500, text: career.getPlayer(mine).name }).rows
      .some((r) => r.playerId === mine)).toBe(false)

    career.watchPlayer(mine)
    const watched = career.searchPlayers({ watchedOnly: true, limit: 50 })
    expect(watched.rows.map((r) => r.playerId)).toContain(mine)
    expect(watched.rows.find((r) => r.playerId === mine)!.watched).toBe(true)
  })

  it('pages without losing or duplicating rows', () => {
    const career = newCareer()
    const p1 = career.searchPlayers({ sort: 'name', desc: false, limit: 20, offset: 0 })
    const p2 = career.searchPlayers({ sort: 'name', desc: false, limit: 20, offset: 20 })
    const ids = new Set([...p1.rows, ...p2.rows].map((r) => r.playerId))
    expect(ids.size).toBe(p1.rows.length + p2.rows.length)
    expect(p1.total).toBe(p2.total)
  })
})

/* ── C5: prospect rankings have to be earned ─────────────────────────────── */

/**
 * A world with a real amateur class to rank. The vanilla generator ships no
 * feeder competitions, so a draft-board test written against it asserts nothing
 * at all — every board comes back empty and every loop body is skipped. This
 * plants one junior league of draft-eligible skaters plus a cohort of 15-year-olds
 * for the radar, which is the minimum world in which "did the department earn
 * this grade?" is even a question.
 */
function juniorWorld(seed = 2029): { career: Career; eligibleIds: string[]; radarIds: string[] } {
  const data = generateLeague({ seed })
  const teamIds = data.league.teams.slice(0, 8)
  const comps: RawCompetition[] = [
    { id: 'mhl', name: 'Junior League', abbrev: 'MHL', nation: 'Russia', level: 1, reputation: 11 },
  ]
  data.league.competitions = buildCompetitions({
    comps,
    membership: teamIds.map((teamId) => ({ teamId, competitionId: 'mhl' })),
    season: 2025,
  })
  const eligibleIds: string[] = []
  const radarIds: string[] = []
  let i = 0
  for (const tid of teamIds) {
    const t = data.teams.get(tid)!
    for (const pid of t.roster) {
      const p = data.players.get(pid)!
      p.nhlDrafted = false
      // Two thirds draft-eligible (17–18), the rest on the U17 radar (15–16).
      const radar = i % 3 === 2
      p.age = radar ? 15 + (i % 2) : 17 + (i % 2)
      i++
      for (const grp of [p.ratings.technical, p.ratings.physical, p.ratings.mental, p.ratings.goalie]) {
        if (!grp) continue
        const g = grp as unknown as Record<string, number>
        for (const k of Object.keys(g)) { if (k !== 'height') g[k] = Math.max(8, Math.round(g[k] * 0.62)) }
      }
      p.composites = computeComposites(p.ratings, p.role, p.position)
      ;(radar ? radarIds : eligibleIds).push(p.id as string)
    }
  }
  // The user's club must NOT be one of the junior sides, or his own roster's
  // knowledge-100 would count as "class coverage" he never earned.
  const career = new Career(data, seed, data.league.teams[data.league.teams.length - 1]!)
  return { career, eligibleIds, radarIds }
}

describe('C5 — you do not get a ceiling grade you did not earn', () => {
  it('builds a class worth testing', () => {
    const { career, eligibleIds, radarIds } = juniorWorld()
    expect(eligibleIds.length).toBeGreaterThan(50)
    expect(radarIds.length).toBeGreaterThan(20)
    expect(career.getDraftRankings().rankings.length).toBeGreaterThan(20)
  })

  it('shows no read on your own board for prospects nobody has watched', () => {
    const { career } = juniorWorld()
    const board = career.getDraftRankings().scoutBoard
    expect(board.length).toBeGreaterThan(20)
    const unseen = board.filter((r) => !r.seen)
    // A fresh career has watched none of them, so this is the whole board.
    expect(unseen.length).toBeGreaterThan(0)
    for (const row of unseen) expect(row.potentialStars).toBe(0)
  })

  it('turns the dash back into a grade once the department does the work', () => {
    const { career } = juniorWorld()
    const st = scoutingOf(career)
    const board = career.getDraftRankings().scoutBoard
    const target = board.find((r) => !r.seen)!
    expect(target.potentialStars).toBe(0)

    // Put real eyes on him — the only thing that buys a ceiling grade.
    addKnowledge(st, target.playerId, 100)
    // The board memoises per (year, day, phase, staff, interviews); a knowledge
    // change alone must not be served stale, so re-read through a new career day.
    const after = juniorWorld().career
    const st2 = scoutingOf(after)
    addKnowledge(st2, target.playerId, 100)
    const row = after.getDraftRankings().scoutBoard.find((r) => r.playerId === target.playerId)!
    expect(row.seen).toBe(true)
    expect(row.potentialStars).toBeGreaterThan(0)
  })

  it('only puts U17s your staff has actually watched on the radar', () => {
    const { career } = juniorWorld()
    const st = scoutingOf(career)
    const view = career.getDraftRankings()
    // Nobody has been watched, so the radar is empty and the backlog is real.
    expect(view.radar).toEqual([])
    expect(view.radarUnseen).toBeGreaterThan(20)
    for (const row of view.radar) {
      expect(knowledgeOf(st, row.playerId)).toBeGreaterThanOrEqual(SCOUT_SEEN_THRESHOLD)
    }
  })

  it('lets a watched U17 onto the radar, and only him', () => {
    const { career, radarIds } = juniorWorld()
    const st = scoutingOf(career)
    addKnowledge(st, radarIds[0]!, 100)
    const view = career.getDraftRankings()
    expect(view.radar.map((r) => r.playerId)).toEqual([radarIds[0]])
    expect(view.radarUnseen).toBe(radarIds.length - 1)
  })

  it('reports honest class coverage', () => {
    const { career, eligibleIds } = juniorWorld()
    expect(career.getDraftRankings().classCoverage.filed).toBe(0)

    const seeded = juniorWorld()
    const st = scoutingOf(seeded.career)
    for (const id of eligibleIds.slice(0, 10)) addKnowledge(st, id, 100)
    const cov = seeded.career.getDraftRankings().classCoverage
    expect(cov.filed).toBe(10)
    expect(cov.total).toBeGreaterThan(10)
    expect(cov.pct).toBe(Math.round((cov.filed / cov.total) * 100))
  })

  it('publishes the public board as a rank and a role, never as a hidden grade', () => {
    const { career } = juniorWorld()
    const rankings = career.getDraftRankings().rankings
    expect(rankings.length).toBeGreaterThan(0)
    for (const r of rankings) expect(r.analystRole).toBeTruthy()
  })
})

/* ── C2: the Centre briefing is derived, not decorative ──────────────────── */

describe('C2 — the department briefing', () => {
  it('reports bandwidth, class coverage and position coverage from real state', () => {
    const career = newCareer()
    const b = career.getScouting().briefing
    expect(b.headline).toMatch(/scout/i)
    expect(b.strain.length).toBeGreaterThan(10)
    expect(b.classCoverage.filed).toBeLessThanOrEqual(b.classCoverage.total)
    expect(b.needCoverage.map((n) => n.group).sort()).toEqual(['Centre', 'Defense', 'Goaltending', 'Wing'])
  })

  it('has no month-over-month claims before a snapshot exists', () => {
    const career = newCareer()
    const b = career.getScouting().briefing
    if (!b.since) expect(b.changes).toEqual([])
  })

  it('only calls a pool a blind spot when nobody is assigned to it', () => {
    const career = newCareer()
    const view = career.getScouting()
    const assigned = new Set(view.leagueCoverage.filter((r) => r.scoutNames.length > 0).map((r) => r.id))
    for (const spot of view.briefing.blindSpots) expect(assigned.has(spot.id)).toBe(false)
  })
})

/* ── persistence ─────────────────────────────────────────────────────────── */

describe('the watch list and the coverage log survive a save/load', () => {
  it('round-trips through a career snapshot', () => {
    const career = newCareer(31)
    const pid = scoutingOf(career).knowledge[7]![0]
    career.watchPlayer(pid, 'keep an eye on the skating')
    const snap = career.exportSnapshot('watchlist-test', '2026-11-01T00:00:00.000Z')
    const restored = Career.fromSnapshot(snap)
    const list = restored.getScouting().watchList
    expect(list.map((w) => w.playerId)).toEqual([pid])
    expect(list[0]!.note).toBe('keep an eye on the skating')
    expect(restored.isWatched(pid)).toBe(true)
  })
})
