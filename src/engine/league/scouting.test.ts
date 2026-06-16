import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Rng } from '@engine/shared/rng'
import {
  assignScout,
  createInitialScouting,
  knowledgeOf,
  maskAttribute,
  maskedOverall,
  tickScouting,
  generateScoutCandidates,
  hireScout,
  fireScout,
  DISCOVERY_THRESHOLD,
} from './scouting'

/* ────────────────────────── helpers ────────────────────────── */

function makeArgs(seed = 42) {
  const data = generateLeague({ seed })
  const userTeamId = data.league.teams[0] as string
  const rng = new Rng(seed)
  // Build a set of draft prospect ids (use players in the 2nd half as fake prospects)
  const allIds = [...data.players.keys()]
  const draftProspectIds = new Set(allIds.slice(Math.floor(allIds.length / 2)).map((id) => id as string))
  return { data, userTeamId, rng, draftProspectIds }
}

/* ────────────────────────── createInitialScouting ────────────────────────── */

describe('createInitialScouting', () => {
  it('creates 3 scouts with ratings in [45,92] and a default focus', () => {
    const { data, userTeamId, rng } = makeArgs(1)
    const state = createInitialScouting({
      userTeamId,
      teams: data.teams as Map<import('@domain').TeamId, { roster: import('@domain').PlayerId[] }>,
      players: data.players,
      rng,
    })
    expect(state.assignments).toHaveLength(3)
    for (const s of state.assignments) {
      expect(s.rating).toBeGreaterThanOrEqual(45)
      expect(s.rating).toBeLessThanOrEqual(92)
      expect(s.name).toBeTruthy()
      expect(s.scoutId).toBeTruthy()
      expect(s.focus).toBeTruthy()
    }
    // Youth-leaning default deployment (≥2 of 3 scouts on youth).
    expect(state.assignments.filter((s) => s.focus === 'youth').length).toBeGreaterThanOrEqual(2)
  })

  it('own roster gets knowledge 100', () => {
    const { data, userTeamId, rng } = makeArgs(2)
    const state = createInitialScouting({
      userTeamId,
      teams: data.teams as Map<import('@domain').TeamId, { roster: import('@domain').PlayerId[] }>,
      players: data.players,
      rng,
    })
    const userTeam = data.teams.get(userTeamId as import('@domain').TeamId)!
    for (const pid of userTeam.roster) {
      expect(knowledgeOf(state, pid as string)).toBe(100)
    }
  })

  it('other rostered players get renown-driven knowledge in [20,95]', () => {
    const { data, userTeamId, rng } = makeArgs(3)
    const state = createInitialScouting({
      userTeamId,
      teams: data.teams as Map<import('@domain').TeamId, { roster: import('@domain').PlayerId[] }>,
      players: data.players,
      rng,
    })
    const userTeam = data.teams.get(userTeamId as import('@domain').TeamId)!
    const userRosterSet = new Set(userTeam.roster.map((id) => id as string))

    let checked = 0
    for (const [tid, team] of data.teams) {
      if (tid as string === userTeamId) continue
      for (const pid of team.roster) {
        const k = knowledgeOf(state, pid as string)
        // Not own roster, not draft prospect: known in proportion to renown.
        if (!userRosterSet.has(pid as string)) {
          expect(k).toBeGreaterThanOrEqual(20)
          expect(k).toBeLessThanOrEqual(95)
          checked++
        }
      }
      if (checked > 20) break
    }
    expect(checked).toBeGreaterThan(10)
  })

  it('draft prospects get knowledge in [5,18]', () => {
    const { data, userTeamId, rng, draftProspectIds } = makeArgs(4)
    const state = createInitialScouting({
      userTeamId,
      teams: data.teams as Map<import('@domain').TeamId, { roster: import('@domain').PlayerId[] }>,
      players: data.players,
      rng,
      draftProspectIds,
    })
    let checked = 0
    for (const pid of draftProspectIds) {
      const userTeam = data.teams.get(userTeamId as import('@domain').TeamId)!
      if (userTeam.roster.some((id) => id as string === pid)) continue
      const k = knowledgeOf(state, pid)
      expect(k).toBeGreaterThanOrEqual(5)
      expect(k).toBeLessThanOrEqual(18)
      checked++
      if (checked > 10) break
    }
  })

  it('is deterministic — same seed produces identical state', () => {
    const { data, userTeamId } = makeArgs(99)
    const mk = () =>
      createInitialScouting({
        userTeamId,
        teams: data.teams as Map<import('@domain').TeamId, { roster: import('@domain').PlayerId[] }>,
        players: data.players,
        rng: new Rng(99),
      })
    const a = mk()
    const b = mk()
    expect(a.knowledge).toEqual(b.knowledge)
    expect(a.assignments.map((s) => s.rating)).toEqual(b.assignments.map((s) => s.rating))
  })
})

/* ────────────────────────── tickScouting ────────────────────────── */

describe('tickScouting', () => {
  it('raises knowledge of target players after a tick', () => {
    const { data, userTeamId } = makeArgs(10)
    const state = createInitialScouting({
      userTeamId,
      teams: data.teams as Map<import('@domain').TeamId, { roster: import('@domain').PlayerId[] }>,
      players: data.players,
      rng: new Rng(10),
    })

    // Find a non-user player with low knowledge
    const otherTeamId = data.league.teams.find((t) => t as string !== userTeamId)!
    const otherTeam = data.teams.get(otherTeamId)!

    // Assign scout[0] to that team (all-ages focus so any roster player counts)
    state.assignments[0]!.target = { kind: 'team', teamId: otherTeamId as string }
    state.assignments[0]!.focus = 'all'

    const pid = otherTeam.roster[0]! as string
    const before = knowledgeOf(state, pid)

    // Tick many times so gains accumulate
    for (let i = 0; i < 20; i++) {
      tickScouting({
        state,
        userTeamId,
        teams: data.teams as Map<import('@domain').TeamId, { roster: import('@domain').PlayerId[]; divisionId?: string }>,
        players: data.players,
        draftProspectIds: new Set(),
        freeAgentIds: new Set(),
        rng: new Rng(i + 200),
      })
    }

    const after = knowledgeOf(state, pid)
    expect(after).toBeGreaterThan(before)
  })

  it('knowledge never exceeds 100', () => {
    const { data, userTeamId } = makeArgs(11)
    const state = createInitialScouting({
      userTeamId,
      teams: data.teams as Map<import('@domain').TeamId, { roster: import('@domain').PlayerId[] }>,
      players: data.players,
      rng: new Rng(11),
    })

    // Tick many times for user's own team (all 100 already)
    for (let i = 0; i < 50; i++) {
      tickScouting({
        state,
        userTeamId,
        teams: data.teams as Map<import('@domain').TeamId, { roster: import('@domain').PlayerId[]; divisionId?: string }>,
        players: data.players,
        draftProspectIds: new Set(),
        freeAgentIds: new Set(),
        rng: new Rng(i + 300),
      })
    }

    for (const [, k] of state.knowledge) {
      expect(k).toBeLessThanOrEqual(100)
    }
  })

  it('shows diminishing returns above 80 — progress slows visibly', () => {
    const { data, userTeamId } = makeArgs(12)
    const state = createInitialScouting({
      userTeamId,
      teams: data.teams as Map<import('@domain').TeamId, { roster: import('@domain').PlayerId[] }>,
      players: data.players,
      rng: new Rng(12),
    })

    // Force a player to exactly 79 knowledge
    const otherTeamId = data.league.teams.find((t) => t as string !== userTeamId)!
    const otherTeam = data.teams.get(otherTeamId)!
    const pid = otherTeam.roster[0]! as string
    state.assignments[0]!.target = { kind: 'team', teamId: otherTeamId as string }

    // Set knowledge to 79
    const existing = state.knowledge.find(([id]) => id === pid)
    if (existing) existing[1] = 79
    else state.knowledge.push([pid, 79])

    const gains79: number[] = []
    for (let i = 0; i < 5; i++) {
      const before = knowledgeOf(state, pid)
      tickScouting({
        state,
        userTeamId,
        teams: data.teams as Map<import('@domain').TeamId, { roster: import('@domain').PlayerId[]; divisionId?: string }>,
        players: data.players,
        draftProspectIds: new Set(),
        freeAgentIds: new Set(),
        rng: new Rng(i + 400),
      })
      gains79.push(knowledgeOf(state, pid) - before)
    }

    // Force to 85
    const entry85 = state.knowledge.find(([id]) => id === pid)
    if (entry85) entry85[1] = 85
    else state.knowledge.push([pid, 85])

    const gains85: number[] = []
    for (let i = 0; i < 5; i++) {
      const before = knowledgeOf(state, pid)
      tickScouting({
        state,
        userTeamId,
        teams: data.teams as Map<import('@domain').TeamId, { roster: import('@domain').PlayerId[]; divisionId?: string }>,
        players: data.players,
        draftProspectIds: new Set(),
        freeAgentIds: new Set(),
        rng: new Rng(i + 400), // same seeds
      })
      gains85.push(knowledgeOf(state, pid) - before)
    }

    const avg79 = gains79.reduce((s, v) => s + v, 0) / gains79.length
    const avg85 = gains85.reduce((s, v) => s + v, 0) / gains85.length
    // Progress above 80 should be slower (avg gain < avg gain at 79)
    expect(avg85).toBeLessThan(avg79 * 0.9)
  })

  it('draftClass target increases knowledge of draft prospects', () => {
    const { data, userTeamId, draftProspectIds } = makeArgs(13)
    const state = createInitialScouting({
      userTeamId,
      teams: data.teams as Map<import('@domain').TeamId, { roster: import('@domain').PlayerId[] }>,
      players: data.players,
      rng: new Rng(13),
      draftProspectIds,
    })

    state.assignments[0]!.target = { kind: 'draftClass' }
    state.assignments[0]!.focus = 'all'

    const sampleId = [...draftProspectIds][0]!
    const before = knowledgeOf(state, sampleId)

    for (let i = 0; i < 10; i++) {
      tickScouting({
        state,
        userTeamId,
        teams: data.teams as Map<import('@domain').TeamId, { roster: import('@domain').PlayerId[]; divisionId?: string }>,
        players: data.players,
        draftProspectIds,
        freeAgentIds: new Set(),
        rng: new Rng(i + 500),
      })
    }

    expect(knowledgeOf(state, sampleId)).toBeGreaterThan(before)
  })

  it('is deterministic: same seed → identical knowledge after ticks', () => {
    const { data, userTeamId } = makeArgs(20)
    const mk = () =>
      createInitialScouting({
        userTeamId,
        teams: data.teams as Map<import('@domain').TeamId, { roster: import('@domain').PlayerId[] }>,
        players: data.players,
        rng: new Rng(20),
      })

    const run = (state: ReturnType<typeof mk>) => {
      for (let i = 0; i < 5; i++) {
        tickScouting({
          state,
          userTeamId,
          teams: data.teams as Map<import('@domain').TeamId, { roster: import('@domain').PlayerId[]; divisionId?: string }>,
          players: data.players,
          draftProspectIds: new Set(),
          freeAgentIds: new Set(),
          rng: new Rng(i + 600),
        })
      }
    }

    const a = mk(); run(a)
    const b = mk(); run(b)
    expect(a.knowledge).toEqual(b.knowledge)
  })
})

/* ────────────────────────── maskAttribute ────────────────────────── */

describe('maskAttribute', () => {
  it('returns exact value when knowledge >= 95', () => {
    for (const value of [30, 55, 75, 90]) {
      const { lo, hi } = maskAttribute(value, 95, 'p1', 'speed')
      expect(lo).toBe(value)
      expect(hi).toBe(value)
    }
    const { lo, hi } = maskAttribute(70, 100, 'p2', 'passing')
    expect(lo).toBe(70)
    expect(hi).toBe(70)
  })

  it('band width shrinks as knowledge increases', () => {
    const value = 65
    const pid = 'p999'
    const key = 'speed'
    const widthAt = (k: number) => {
      const { lo, hi } = maskAttribute(value, k, pid, key)
      return hi - lo
    }
    expect(widthAt(20)).toBeGreaterThan(widthAt(60))
    expect(widthAt(60)).toBeGreaterThan(widthAt(80))
    expect(widthAt(80)).toBeGreaterThanOrEqual(widthAt(94))
  })

  it('lo and hi are clamped to [1, 99]', () => {
    // Edge case: very low attribute value
    const { lo: lo1, hi: hi1 } = maskAttribute(1, 10, 'p-edge', 'someAttr')
    expect(lo1).toBeGreaterThanOrEqual(1)
    expect(hi1).toBeGreaterThanOrEqual(lo1)

    // Edge case: very high attribute value
    const { lo: lo2, hi: hi2 } = maskAttribute(99, 10, 'p-edge', 'someAttr')
    expect(hi2).toBeLessThanOrEqual(99)
    expect(lo2).toBeLessThanOrEqual(hi2)
  })

  it('is deterministic: same inputs → same outputs always', () => {
    for (let i = 0; i < 20; i++) {
      const a = maskAttribute(70, 50, `p${i}`, 'speed')
      const b = maskAttribute(70, 50, `p${i}`, 'speed')
      expect(a).toEqual(b)
    }
  })

  it('mask midpoint does NOT equal true value systematically', () => {
    // Across many player/attr combinations, midpoints should not center on the true value
    let exactMidpointCount = 0
    const value = 70
    const knowledge = 40
    const total = 50
    for (let i = 0; i < total; i++) {
      const { lo, hi } = maskAttribute(value, knowledge, `player${i}`, `attr${i}`)
      const mid = (lo + hi) / 2
      if (Math.abs(mid - value) < 1) exactMidpointCount++
    }
    // At most 30% of midpoints should be within 1 of the true value
    expect(exactMidpointCount).toBeLessThan(total * 0.3)
  })

  it('a sharper scout (higher accuracy) gives a tighter band', () => {
    const width = (acc: number): number => {
      const { lo, hi } = maskAttribute(65, 50, 'p-acc', 'speed', acc)
      return hi - lo
    }
    expect(width(0.9)).toBeLessThan(width(0.5))
    expect(width(0.5)).toBeLessThan(width(0.1))
  })

  it('maskedOverall delegates correctly', () => {
    const { lo, hi } = maskedOverall(75, 50, 'p-overall-test')
    expect(lo).toBeLessThanOrEqual(hi)
    expect(lo).toBeGreaterThanOrEqual(1)
    expect(hi).toBeLessThanOrEqual(99)
  })
})

/* ────────────────────────── assignScout ────────────────────────── */

describe('assignScout', () => {
  it('changes the target for the named scout', () => {
    const { data, userTeamId } = makeArgs(5)
    const state = createInitialScouting({
      userTeamId,
      teams: data.teams as Map<import('@domain').TeamId, { roster: import('@domain').PlayerId[] }>,
      players: data.players,
      rng: new Rng(5),
    })
    const scoutId = state.assignments[0]!.scoutId
    assignScout(state, scoutId, { kind: 'draftClass' })
    expect(state.assignments[0]!.target.kind).toBe('draftClass')
  })

  it('throws for an unknown scout id', () => {
    const { data, userTeamId } = makeArgs(6)
    const state = createInitialScouting({
      userTeamId,
      teams: data.teams as Map<import('@domain').TeamId, { roster: import('@domain').PlayerId[] }>,
      players: data.players,
      rng: new Rng(6),
    })
    expect(() => assignScout(state, 'nonexistent-scout', { kind: 'draftClass' })).toThrow()
  })
})

/* ────────────────────────── scopes + focus + market (redesign) ────────────────────────── */

describe('scout scopes, focus and market', () => {
  const teamsMap = (data: ReturnType<typeof makeArgs>['data']) =>
    data.teams as Map<import('@domain').TeamId, { roster: import('@domain').PlayerId[]; divisionId?: string }>

  it('competition scope raises knowledge of that league\'s rosters', () => {
    const { data, userTeamId } = makeArgs(60)
    const state = createInitialScouting({ userTeamId, teams: teamsMap(data), players: data.players, rng: new Rng(60) })
    const compTeamId = data.league.teams.find((t) => t as string !== userTeamId)! as string
    const competitions = [{ id: 'testlge', nation: 'Testland', teamIds: [compTeamId] }]
    state.assignments[0]!.target = { kind: 'competition', competitionId: 'testlge' }
    state.assignments[0]!.focus = 'all'
    const pid = data.teams.get(compTeamId as import('@domain').TeamId)!.roster[0]! as string
    const before = knowledgeOf(state, pid)
    for (let i = 0; i < 15; i++) {
      tickScouting({ state, userTeamId, teams: teamsMap(data), players: data.players, draftProspectIds: new Set(), freeAgentIds: new Set(), competitions, nextOpponentId: null, rng: new Rng(i + 700) })
    }
    expect(knowledgeOf(state, pid)).toBeGreaterThan(before)
  })

  it('nation scope covers every league hosted by that nation', () => {
    const { data, userTeamId } = makeArgs(61)
    const state = createInitialScouting({ userTeamId, teams: teamsMap(data), players: data.players, rng: new Rng(61) })
    const tid = data.league.teams.find((t) => t as string !== userTeamId)! as string
    const competitions = [{ id: 'l1', nation: 'Eastland', teamIds: [tid] }]
    state.assignments[0]!.target = { kind: 'nation', nation: 'Eastland' }
    state.assignments[0]!.focus = 'all'
    const pid = data.teams.get(tid as import('@domain').TeamId)!.roster[0]! as string
    const before = knowledgeOf(state, pid)
    for (let i = 0; i < 15; i++) {
      tickScouting({ state, userTeamId, teams: teamsMap(data), players: data.players, draftProspectIds: new Set(), freeAgentIds: new Set(), competitions, nextOpponentId: null, rng: new Rng(i + 720) })
    }
    expect(knowledgeOf(state, pid)).toBeGreaterThan(before)
  })

  it('nextOpponent scope follows the supplied opponent id', () => {
    const { data, userTeamId } = makeArgs(62)
    const state = createInitialScouting({ userTeamId, teams: teamsMap(data), players: data.players, rng: new Rng(62) })
    const oppId = data.league.teams.find((t) => t as string !== userTeamId)! as string
    state.assignments[0]!.target = { kind: 'nextOpponent' }
    state.assignments[0]!.focus = 'all'
    const pid = data.teams.get(oppId as import('@domain').TeamId)!.roster[0]! as string
    const before = knowledgeOf(state, pid)
    for (let i = 0; i < 15; i++) {
      tickScouting({ state, userTeamId, teams: teamsMap(data), players: data.players, draftProspectIds: new Set(), freeAgentIds: new Set(), competitions: [], nextOpponentId: oppId, rng: new Rng(i + 740) })
    }
    expect(knowledgeOf(state, pid)).toBeGreaterThan(before)
  })

  it('youth focus skips senior players in scope', () => {
    const { data, userTeamId, draftProspectIds } = makeArgs(63)
    const state = createInitialScouting({ userTeamId, teams: teamsMap(data), players: data.players, rng: new Rng(63), draftProspectIds })
    const ids = [...draftProspectIds]
    const youth = ids.find((id) => (data.players.get(id as import('@domain').PlayerId)?.age ?? 99) <= 23)
    const senior = ids.find((id) => (data.players.get(id as import('@domain').PlayerId)?.age ?? 0) >= 24)
    expect(youth).toBeTruthy(); expect(senior).toBeTruthy()
    state.assignments.forEach((s) => { s.target = { kind: 'draftClass' }; s.focus = 'youth' })
    const yBefore = knowledgeOf(state, youth!)
    const sBefore = knowledgeOf(state, senior!)
    for (let i = 0; i < 12; i++) {
      tickScouting({ state, userTeamId, teams: teamsMap(data), players: data.players, draftProspectIds, freeAgentIds: new Set(), competitions: [], nextOpponentId: null, rng: new Rng(i + 760) })
    }
    expect(knowledgeOf(state, youth!)).toBeGreaterThan(yBefore)
    expect(knowledgeOf(state, senior!)).toBeLessThanOrEqual(sBefore) // senior not built under youth focus (may gently decay)
  })

  it('specialty nation gives a knowledge bonus over a generalist', () => {
    const { data, userTeamId, draftProspectIds } = makeArgs(64)
    const probe = createInitialScouting({ userTeamId, teams: teamsMap(data), players: data.players, rng: new Rng(64), draftProspectIds })
    // A low-knowledge prospect; give him a known nationality so the bonus applies.
    const pid = [...draftProspectIds].find((id) => knowledgeOf(probe, id) < 40)!
    const nat = 'Canada'
    ;(data.players.get(pid as import('@domain').PlayerId) as { nationality?: string }).nationality = nat
    const run = (specialty?: string): number => {
      const state = createInitialScouting({ userTeamId, teams: teamsMap(data), players: data.players, rng: new Rng(64), draftProspectIds })
      const s = state.assignments[0]!
      s.target = { kind: 'draftClass' }; s.focus = 'all'; s.rating = 55
      if (specialty) s.specialtyNation = specialty; else delete s.specialtyNation
      state.assignments = [s] // isolate: only this scout scouts the prospect
      const before = knowledgeOf(state, pid)
      for (let i = 0; i < 4; i++) {
        tickScouting({ state, userTeamId, teams: teamsMap(data), players: data.players, draftProspectIds, freeAgentIds: new Set(), competitions: [], nextOpponentId: null, rng: new Rng(i + 780) })
      }
      return knowledgeOf(state, pid) - before
    }
    expect(run(nat)).toBeGreaterThan(run(undefined))
  })

  it('Scouting Centre starts empty and seeds known players as already-processed', () => {
    const { data, userTeamId, draftProspectIds } = makeArgs(70)
    const state = createInitialScouting({ userTeamId, teams: teamsMap(data), players: data.players, rng: new Rng(70), draftProspectIds })
    // No recommendations at career start.
    expect(state.recommendations).toEqual([])
    // Foggy draft prospects are NOT pre-seeded as seen (they're left to be discovered).
    const seen = new Set(state.seen ?? [])
    const unseenProspect = [...draftProspectIds].some((id) => !seen.has(id))
    expect(unseenProspect).toBe(true)
    // Every seeded id is genuinely well-known already (>= threshold).
    for (const id of state.seen ?? []) {
      expect(knowledgeOf(state, id)).toBeGreaterThanOrEqual(DISCOVERY_THRESHOLD)
    }
  })

  it('a narrow brief reads a player faster than a sprawling one (bandwidth)', () => {
    const { data, userTeamId, draftProspectIds } = makeArgs(80)
    const pid = [...draftProspectIds][0]!
    const gainFor = (target: import('@domain/scouting').ScoutTarget): number => {
      const state = createInitialScouting({ userTeamId, teams: teamsMap(data), players: data.players, rng: new Rng(80), draftProspectIds })
      const s = state.assignments[0]!
      s.target = target; s.focus = 'all'; s.rating = 70
      state.assignments = [s]
      const before = knowledgeOf(state, pid)
      tickScouting({ state, userTeamId, teams: teamsMap(data), players: data.players, draftProspectIds, freeAgentIds: new Set(), competitions: [], nextOpponentId: null, rng: new Rng(900) })
      return knowledgeOf(state, pid) - before
    }
    const narrow = gainFor({ kind: 'player', playerId: pid })       // 1 player → full speed
    const broad = gainFor({ kind: 'draftClass' })                    // whole class → spread thin
    expect(narrow).toBeGreaterThan(broad)
  })

  it('position filter restricts which players a scout watches', () => {
    const { data, userTeamId } = makeArgs(81)
    const tid = data.league.teams.find((t) => t as string !== userTeamId)! as string
    const roster = data.teams.get(tid as import('@domain').TeamId)!.roster.map((id) => id as string)
    const aD = roster.find((id) => data.players.get(id as import('@domain').PlayerId)?.position === 'D')!
    const aF = roster.find((id) => { const p = data.players.get(id as import('@domain').PlayerId); return p && p.position !== 'D' && p.position !== 'G' })!
    const state = createInitialScouting({ userTeamId, teams: teamsMap(data), players: data.players, rng: new Rng(81) })
    const s = state.assignments[0]!
    s.target = { kind: 'team', teamId: tid }; s.focus = 'all'; s.positionFilter = 'D'
    state.assignments = [s]
    const dBefore = knowledgeOf(state, aD), fBefore = knowledgeOf(state, aF)
    for (let i = 0; i < 10; i++) {
      tickScouting({ state, userTeamId, teams: teamsMap(data), players: data.players, draftProspectIds: new Set(), freeAgentIds: new Set(), competitions: [], nextOpponentId: null, rng: new Rng(i + 950) })
    }
    expect(knowledgeOf(state, aD)).toBeGreaterThan(dBefore)       // D watched
    expect(knowledgeOf(state, aF)).toBeLessThanOrEqual(fBefore)   // forward ignored (not built; may gently decay)
  })

  it('a read goes stale: unwatched knowledge decays toward the renown floor', () => {
    const { data, userTeamId, draftProspectIds } = makeArgs(82)
    const pid = [...draftProspectIds][0]!
    const state = createInitialScouting({ userTeamId, teams: teamsMap(data), players: data.players, rng: new Rng(82), draftProspectIds })
    state.assignments = [] // nobody scouting
    // Seed a high read on a prospect, then let it idle.
    const existing = state.knowledge.find(([id]) => id === pid)
    if (existing) existing[1] = 85; else state.knowledge.push([pid, 85])
    const before = knowledgeOf(state, pid)
    for (let i = 0; i < 30; i++) {
      tickScouting({ state, userTeamId, teams: teamsMap(data), players: data.players, draftProspectIds, freeAgentIds: new Set(), competitions: [], nextOpponentId: null, rng: new Rng(i + 1000) })
    }
    expect(knowledgeOf(state, pid)).toBeLessThan(before) // faded
    // Protected players (your own org) never decay.
    const state2 = createInitialScouting({ userTeamId, teams: teamsMap(data), players: data.players, rng: new Rng(82), draftProspectIds })
    state2.assignments = []
    const e2 = state2.knowledge.find(([id]) => id === pid); if (e2) e2[1] = 85
    tickScouting({ state: state2, userTeamId, teams: teamsMap(data), players: data.players, draftProspectIds, freeAgentIds: new Set(), competitions: [], nextOpponentId: null, protectedIds: new Set([pid]), rng: new Rng(1) })
    expect(knowledgeOf(state2, pid)).toBe(85)
  })

  it('market generates distinct candidates; hire adds and fire removes', () => {
    const { data, userTeamId } = makeArgs(65)
    const state = createInitialScouting({ userTeamId, teams: teamsMap(data), players: data.players, rng: new Rng(65) })
    const market = generateScoutCandidates(new Rng(7720), 6)
    expect(market).toHaveLength(6)
    expect(new Set(market.map((c) => c.name)).size).toBeGreaterThan(1) // names vary
    const n0 = state.assignments.length
    hireScout(state, market[0]!)
    expect(state.assignments).toHaveLength(n0 + 1)
    expect(state.assignments.some((s) => s.scoutId === market[0]!.id)).toBe(true)
    hireScout(state, market[0]!) // idempotent — no duplicate
    expect(state.assignments).toHaveLength(n0 + 1)
    fireScout(state, market[0]!.id)
    expect(state.assignments.some((s) => s.scoutId === market[0]!.id)).toBe(false)
  })
})

/* ────────────────────────── knowledge distribution sanity ────────────────────────── */

describe('knowledge distribution', () => {
  it('has correct high-knowledge share for own roster vs others', () => {
    const { data, userTeamId } = makeArgs(50)
    const state = createInitialScouting({
      userTeamId,
      teams: data.teams as Map<import('@domain').TeamId, { roster: import('@domain').PlayerId[] }>,
      players: data.players,
      rng: new Rng(50),
    })

    const userTeam = data.teams.get(userTeamId as import('@domain').TeamId)!
    const ownRosterIds = new Set(userTeam.roster.map((id) => id as string))

    const ownKnowledge = state.knowledge
      .filter(([id]) => ownRosterIds.has(id))
      .map(([, k]) => k)

    const othersKnowledge = state.knowledge
      .filter(([id]) => !ownRosterIds.has(id))
      .map(([, k]) => k)

    // All own players should be at 100
    expect(ownKnowledge.every((k) => k === 100)).toBe(true)

    // Others should average below 50
    const avgOthers = othersKnowledge.reduce((s, k) => s + k, 0) / othersKnowledge.length
    expect(avgOthers).toBeLessThan(50)
  })

  it('all knowledge values are in [0, 100]', () => {
    const { data, userTeamId } = makeArgs(51)
    const state = createInitialScouting({
      userTeamId,
      teams: data.teams as Map<import('@domain').TeamId, { roster: import('@domain').PlayerId[] }>,
      players: data.players,
      rng: new Rng(51),
    })
    for (const [, k] of state.knowledge) {
      expect(k).toBeGreaterThanOrEqual(0)
      expect(k).toBeLessThanOrEqual(100)
    }
  })
})
