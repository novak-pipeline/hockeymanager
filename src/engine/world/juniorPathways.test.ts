import { describe, expect, it } from 'vitest'
import type { Competition, Player, PlayerId, Team, TeamId } from '@domain'
import { asPlayerId, asTeamId } from '@domain'
import { generateLeague } from '@data/generate'
import { Rng } from '@engine/shared/rng'
import { ratedOverall } from '@engine/ratings/composites'
import { runJuniorPathways } from './juniorPathways'

function comp(abbrev: string, nation: string, ids: TeamId[]): Competition {
  return { id: abbrev, name: abbrev, abbrev, nation, level: 1, reputation: 12, strength: 0.3, tier: 'simulated', teamIds: ids, schedule: [], standings: [] }
}

describe('junior pathways', () => {
  it('ages juniors out to college, a farm deal, a men\'s league — or out of the game', () => {
    const base = generateLeague({ seed: 3 })
    const pool = [...base.players.values()].sort((a, b) => ratedOverall(a) - ratedOverall(b))
    const players = new Map<PlayerId, Player>()
    const teams = new Map<TeamId, Team>()
    const mk = (id: string): Team => { const t = { id: asTeamId(id), name: id, abbreviation: id, roster: [] as PlayerId[] } as unknown as Team; teams.set(t.id, t); return t }
    const ohl = mk('ohl1'); const j20 = mk('j201'); const ncaa = mk('ncaa1'); const shl = mk('shl1'); const echl = mk('echl1')
    const nhl = mk('nhl1'); const ahl = mk('ahl1'); nhl.affiliateId = ahl.id
    let k = 0
    const take = (age: number, nat: string, from: 'weak' | 'mid' | 'strong'): Player => {
      const src = from === 'weak' ? pool[k] : from === 'mid' ? pool[Math.floor(pool.length / 2) + k] : pool[pool.length - 1 - k]
      k++
      const p = { ...src!, id: asPlayerId(`x${k}`), age, nationality: nat, nhlDrafted: false } as Player
      delete p.rightsTeamId
      players.set(p.id, p)
      return p
    }
    // A senior Swedish club full of mid players; an ECHL club of mid players.
    for (let i = 0; i < 18; i++) shl.roster.push(take(27, 'Sweden', 'mid').id)
    for (let i = 0; i < 18; i++) echl.roster.push(take(26, 'United States', 'weak').id)
    const star = take(21, 'Canada', 'strong'); ohl.roster.push(star.id)
    const swede = take(21, 'Sweden', 'mid'); j20.roster.push(swede.id)
    const dud = take(21, 'Finland', 'weak'); j20.roster.push(dud.id)
    const kid = take(18, 'Canada', 'mid'); ohl.roster.push(kid.id)
    const comps = [comp('OHL', 'Canada', [ohl.id]), comp('J20', 'Sweden', [j20.id]), comp('NCAA', 'United States', [ncaa.id]), comp('SHL', 'Sweden', [shl.id]), comp('ECHL', 'United States', [echl.id])]
    const { moves } = runJuniorPathways({ competitions: comps, teams, players, year: 2030, rng: new Rng(1), aiOrgIds: [nhl.id] })
    expect(ohl.roster).not.toContain(star.id)
    expect(j20.roster).not.toContain(swede.id)
    expect(ohl.roster).toContain(kid.id) // 18-year-old stays in junior
    const kindOf = (id: PlayerId): string | undefined => moves.find((m) => m.playerId === id)?.kind
    expect(['proFarm', 'college']).toContain(kindOf(star.id))
    expect(kindOf(swede.id)).toBe('senior')
    expect(shl.roster).toContain(swede.id)
    expect(kindOf(dud.id)).toBe('leftGame')
    expect(players.get(dud.id)!.retiredYear).toBe(2030)
  })
})
