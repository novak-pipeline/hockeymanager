import { describe, expect, it } from 'vitest'
import type { Competition, Player, PlayerId, Team, TeamId } from '@domain'
import { asPlayerId, asTeamId } from '@domain'
import { Rng } from '@engine/shared/rng'
import { computeComposites, overall } from '@engine/ratings/composites'
import { FAMOUS_HOCKEY_SURNAMES } from '@data/nationNames'
import { runYouthIntake, LEAGUE_YOUTH } from './youthIntake'

/** Team counts per junior league in the reference world (the imported DB). */
const WORLD: Record<string, number> = {
  OHL: 20, WHL: 20, QMJHL: 16, USHL: 14, NTDP: 2, NAHL: 25, BCHL: 6, MHL: 38, J20: 20, U20SM: 17, CZEJR: 16, SVKJR: 11, DNL: 15,
}

function buildWorld(): { comps: Competition[]; teams: Map<TeamId, Team> } {
  const comps: Competition[] = []
  const teams = new Map<TeamId, Team>()
  for (const [abbrev, n] of Object.entries(WORLD)) {
    const ids: TeamId[] = []
    for (let i = 0; i < n; i++) {
      const id = asTeamId(`${abbrev}-${i}`)
      ids.push(id)
      teams.set(id, { id, roster: [] } as unknown as Team)
    }
    comps.push({ id: abbrev, name: abbrev, abbrev, nation: 'x', level: 1, reputation: 12, strength: 0.2, tier: 'simulated', teamIds: ids, schedule: [], standings: [] })
  }
  return { comps, teams }
}

function cohort(seed: number): Player[] {
  const { comps, teams } = buildWorld()
  const players = new Map<PlayerId, Player>()
  let n = 0
  // steady state: each club takes ~5 a year; empty the rosters to target-5
  for (const t of teams.values()) for (let i = 0; i < 19; i++) t.roster.push(asPlayerId(`x${i}`))
  const res = runYouthIntake({ competitions: comps, teams, players, year: 2030, rng: new Rng(seed), nextId: () => asPlayerId(`g${n++}`) })
  return res.created
}

describe('youth intake', () => {
  it('produces a nation mix at the top of the cohort near the real NHL draft', () => {
    const all: Player[] = []
    for (let s = 1; s <= 4; s++) all.push(...cohort(s))
    const pot = (p: Player): number => overall(computeComposites(p.potential, p.role, p.position), p.position)
    const top = [...all].sort((a, b) => pot(b) - pot(a)).slice(0, 224 * 4)
    const share = (nat: string): number => top.filter((p) => p.nationality === nat).length / top.length
    const report = ['Canada', 'United States', 'Sweden', 'Russia', 'Finland', 'Czechia', 'Slovakia', 'Germany']
      .map((n) => `${n}:${(share(n) * 100).toFixed(1)}`).join(' ')
    console.log('cohort', all.length / 4, report)
    expect(share('Canada')).toBeGreaterThan(0.28)
    expect(share('Canada')).toBeLessThan(0.48)
    expect(share('United States')).toBeGreaterThan(0.14)
    expect(share('United States')).toBeLessThan(0.3)
    expect(share('Sweden')).toBeGreaterThan(0.06)
    expect(share('Russia')).toBeGreaterThan(0.05)
    expect(share('Finland')).toBeGreaterThan(0.03)
    expect(share('Germany')).toBeLessThan(0.04)
  })

  it('gives newgens full bios with no famous NHL surnames', () => {
    const c = cohort(9)
    for (const p of c) {
      expect(p.nationality).toBeTruthy()
      expect(p.birthplace).toMatch(/, [A-Z]{2,3}$/)
      expect(p.heightCm).toBeGreaterThan(160)
      expect(p.age).toBeGreaterThanOrEqual(16)
      expect(p.age).toBeLessThanOrEqual(18)
      const last = p.name.split(' ').slice(1).join(' ')
      expect(FAMOUS_HOCKEY_SURNAMES.has(last)).toBe(false)
    }
    const names = new Set(c.map((p) => p.name))
    expect(names.size).toBe(c.length)
    const surnames = new Set(c.map((p) => p.name.split(' ').slice(1).join(' ')))
    expect(surnames.size).toBeGreaterThan(c.length * 0.4)
  })

  it('is deterministic for a seed', () => {
    expect(cohort(3).map((p) => p.name)).toEqual(cohort(3).map((p) => p.name))
  })

  it('covers every junior league in the profile table', () => {
    for (const k of Object.keys(WORLD)) expect(LEAGUE_YOUTH[k]).toBeDefined()
  })
})
