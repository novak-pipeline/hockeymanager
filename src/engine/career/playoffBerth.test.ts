/**
 * Mathematical playoff clinch / elimination. During the stretch run a GM lives
 * on the question "am I in?" — and CLINCHED / eliminated are headline moments
 * the game never surfaced (only a probabilistic odds %). These pin the sound,
 * conservative math (the shared divisional qualifier logic) and confirm the
 * once-per-season beat fires and latches.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { asTeamId } from '@domain'
import type { TeamId } from '@domain'
import { Career, qualifiersInConference } from './career'

describe('qualifiersInConference — the shared "who is in" rule', () => {
  const ids = (n: number): TeamId[] => Array.from({ length: n }, (_, i) => asTeamId(`t${i}`))

  it('non-divisional: takes the top N by the given order', () => {
    const members = ids(8)
    const field = qualifiersInConference(members, () => 'D', 4, false)
    expect(field).toEqual(members.slice(0, 4))
  })

  it('divisional: top 3 per division plus wildcards, honouring weak-division guarantees', () => {
    // Conference sorted best→worst by points. Divisions: A = t0,t1,t2,t3,t4,t5 (strong),
    // B = t6,t7,t8 (weak). Top-3-per-division guarantees B's three even though A's
    // 4th/5th (t3,t4) outrank them; the 2 wildcards then go to t3,t4.
    const order = ids(9) // already best→worst
    const div = (t: TeamId): string => (['t0', 't1', 't2', 't3', 't4', 't5'].includes(t as string) ? 'A' : 'B')
    const field = new Set(qualifiersInConference(order, div, 8, true).map((t) => t as string))
    // A's top 3 + wildcards t3,t4; B's three guaranteed.
    expect(field).toEqual(new Set(['t0', 't1', 't2', 't3', 't4', 't6', 't7', 't8']))
    // t5 (A's 6th) is squeezed out by the weak-division guarantee — the whole point.
    expect(field.has('t5')).toBe(false)
  })
})

describe('userPlayoffBerthStatus + clinch/elimination beat', () => {
  function freshCareer(): Career {
    const data = generateLeague({ seed: 5 })
    return new Career(data, 5, data.league.teams[0])
  }
  // Reach the private status/format via a narrow cast (test-only).
  const status = (c: Career): string => (c as unknown as { userPlayoffBerthStatus(): string }).userPlayoffBerthStatus()

  it('is "alive" at the start of the season with a full schedule ahead', () => {
    expect(status(freshCareer())).toBe('alive')
  })

  it('reports "clinched" when the user is safely in with no games left to lose', () => {
    const c = freshCareer()
    const inner = c as unknown as { currentDay: number; userTeamId: TeamId; standings: Map<TeamId, { points: number }>; data: { league: { teams: TeamId[] } } }
    inner.currentDay = 100000 // past the schedule → 0 games remaining for everyone
    for (const t of inner.data.league.teams) inner.standings.get(t)!.points = 40
    inner.standings.get(inner.userTeamId)!.points = 200 // runaway leader
    expect(status(c)).toBe('clinched')
  })

  it('reports "eliminated" when the user cannot crack the field even winning out', () => {
    const c = freshCareer()
    const inner = c as unknown as { currentDay: number; userTeamId: TeamId; standings: Map<TeamId, { points: number }>; data: { league: { teams: TeamId[] } } }
    inner.currentDay = 100000
    for (const t of inner.data.league.teams) inner.standings.get(t)!.points = 100
    inner.standings.get(inner.userTeamId)!.points = 0 // dead last, nothing left to play
    expect(status(c)).toBe('eliminated')
  })

  it('fires the clinch headline exactly once (latched)', () => {
    const c = freshCareer()
    const inner = c as unknown as {
      currentDay: number; userTeamId: TeamId; standings: Map<TeamId, { points: number }>
      data: { league: { teams: TeamId[] }; teams: Map<TeamId, { name: string }> }
      checkPlayoffBerth(): void
    }
    inner.currentDay = 100000
    for (const t of inner.data.league.teams) inner.standings.get(t)!.points = 40
    inner.standings.get(inner.userTeamId)!.points = 200
    inner.checkPlayoffBerth()
    inner.checkPlayoffBerth() // second call must be a no-op (latch)
    const clinch = c.getInbox().items.filter((n) => n.category === 'playoffs' && /clinch/i.test(n.headline))
    expect(clinch).toHaveLength(1)
  })
})
