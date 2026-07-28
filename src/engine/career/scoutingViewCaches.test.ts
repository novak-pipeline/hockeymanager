/**
 * Determinism guards for the scouting-perf caches (playtest note #12).
 *
 * Three speed structures back the Scouting screens; none may ever change a
 * computed value, only how fast it's produced:
 *   1. the O(1) entry index behind knowledgeOf/judgmentOf (league/scouting.ts)
 *   2. the ratedPotential memo (ratings/composites.ts)
 *   3. the renderer's version-keyed reuse of a getScouting() response — valid
 *      only if identical engine state always yields an identical view.
 */
import { describe, expect, it } from 'vitest'
import type { ScoutingState } from '@domain/scouting'
import { generateLeague } from '@data/generate'
import { addKnowledge, knowledgeOf } from '@engine/league/scouting'
import {
  computeComposites,
  invalidatePotentialRating,
  overall,
  ratedPotential,
} from '@engine/ratings/composites'
import { Career } from './career'

function freshState(): ScoutingState {
  return { knowledge: [], assignments: [], judgment: [] }
}

describe('knowledgeOf entry index', () => {
  it('matches a naive scan through pushes, in-place updates, and array swaps', () => {
    const state = freshState()
    const naive = (pid: string): number => {
      for (const [id, k] of state.knowledge) if (id === pid) return k
      return 0
    }

    // Build up through the writer (primes the index).
    for (let i = 0; i < 50; i++) addKnowledge(state, `p${i}`, i)
    // Direct external push (the passive-reveal pattern in career.ts bypasses
    // setKnowledge) — the length check must pick it up.
    state.knowledge.push(['direct', 42])
    // In-place value mutation of an already-indexed entry.
    const entry = state.knowledge.find(([id]) => id === 'p10')!
    entry[1] = 99

    for (const pid of ['p0', 'p10', 'p49', 'direct', 'absent']) {
      expect(knowledgeOf(state, pid)).toBe(naive(pid))
    }

    // Wholesale replacement (save/load) — new array, new index.
    state.knowledge = [['only', 7]]
    expect(knowledgeOf(state, 'only')).toBe(7)
    expect(knowledgeOf(state, 'p0')).toBe(0)
  })
})

describe('ratedPotential memo', () => {
  it('hits return the recomputed value, and both stamp + explicit invalidation work', () => {
    const data = generateLeague({ seed: 5 })
    const p = [...data.players.values()].find((x) => x.position !== 'G' && x.age <= 22)!
    const recompute = (): number => {
      const computed = overall(computeComposites(p.potential, p.role, p.position), p.position)
      return p.basePotential === undefined ? computed : Math.round(0.7 * p.basePotential + 0.3 * computed)
    }

    expect(ratedPotential(p)).toBe(recompute())
    expect(ratedPotential(p)).toBe(recompute()) // memo hit

    // In-place potential mutation (the ceiling-drift pattern) + invalidation.
    p.potential.technical.wristShot = Math.min(99, p.potential.technical.wristShot + 10)
    invalidatePotentialRating(p.potential)
    expect(ratedPotential(p)).toBe(recompute())

    // basePotential change self-invalidates via the stamp (no explicit call).
    p.basePotential = (p.basePotential ?? 70) + 5
    expect(ratedPotential(p)).toBe(recompute())
  })
})

describe('getScouting view stability', () => {
  it('is byte-identical across consecutive calls, and reflects mutations immediately', () => {
    const data = generateLeague({ seed: 61 })
    const career = new Career(data, 61, data.league.teams[0]!)

    // Give the department a broad read so every branch of the view has data.
    const scouting = (career as unknown as { scouting: ScoutingState }).scouting
    let i = 0
    for (const p of data.players.values()) {
      addKnowledge(scouting, p.id as string, 15 + (i++ % 80))
    }

    const a = career.getScouting()
    const b = career.getScouting()
    // The renderer reuses a response for unchanged state — only sound if a
    // refetch would be byte-identical.
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))

    // A knowledge change must show up in the very next view (no stale caching).
    const target = a.scoutedPlayers[0]!
    addKnowledge(scouting, target.playerId, -5)
    const c = career.getScouting()
    const row = c.scoutedPlayers.find((r) => r.playerId === target.playerId)
    expect(row?.knowledge).toBe(target.knowledge - 5)

    // A scout reassignment shows up too.
    const scout = a.scouts[0]
    if (scout) {
      career.assignScoutTarget(scout.scoutId, { kind: 'team', teamId: data.league.teams[1] as unknown as string })
      const d = career.getScouting()
      expect(d.scouts.find((s) => s.scoutId === scout.scoutId)?.assignmentLabel)
        .not.toBe(scout.assignmentLabel)
    }
  })
})
