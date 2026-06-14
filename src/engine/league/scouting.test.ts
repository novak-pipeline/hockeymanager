import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Rng } from '@engine/shared/rng'
import { overall } from '@engine/ratings/composites'
import {
  assignScout,
  createInitialScouting,
  knowledgeOf,
  maskAttribute,
  maskedOverall,
  tickScouting,
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
  it('creates 3 scouts with ratings in [55,75]', () => {
    const { data, userTeamId, rng } = makeArgs(1)
    const state = createInitialScouting({
      userTeamId,
      teams: data.teams as Map<import('@domain').TeamId, { roster: import('@domain').PlayerId[] }>,
      players: data.players,
      rng,
    })
    expect(state.assignments).toHaveLength(3)
    for (const s of state.assignments) {
      expect(s.rating).toBeGreaterThanOrEqual(55)
      expect(s.rating).toBeLessThanOrEqual(75)
      expect(s.name).toBeTruthy()
      expect(s.scoutId).toBeTruthy()
    }
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

    // Assign scout[0] to that team
    state.assignments[0]!.target = { kind: 'team', teamId: otherTeamId as string }

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
