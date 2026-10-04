/**
 * The search's new filters: production, contract, status, build, archetype,
 * "fills a need" (anyOf) and the attribute builder — and the rule that every
 * ability filter reads OUR scouts' view, never the truth.
 */
import { describe, expect, it } from 'vitest'
import type { Player, PlayerId, Team, TeamId } from '@domain'
import type { ScoutingState } from '@domain/scouting'
import { makePlayer, makeTeam } from '@engine/league/trades.test.fixtures'
import { searchPlayers, readAttribute, attributeValue, type PlayerSearchCtx } from './playerSearch'
import type { PlayerSearchQuery } from './views'
import { to20 } from './profileAttributes'
import { overallToStars, ratedOverall } from '@engine/ratings/composites'

function world(players: Player[], opts: { known?: Record<string, number>; own?: string[]; available?: string[] } = {}): PlayerSearchCtx {
  const team = makeTeam('aaa', players)
  const scouting: ScoutingState = {
    knowledge: Object.entries(opts.known ?? {}).map(([id, k]) => [id, k]),
    assignments: [],
  } as ScoutingState
  return {
    players: new Map(players.map((p) => [p.id, p] as [PlayerId, Player])),
    teams: new Map<TeamId, Team>([[team.id, team]]),
    scouting,
    leagueOfTeam: new Map([['aaa', { id: 'nhl', abbrev: 'NHL', name: 'NHL', nation: 'NA' }]]),
    draftProspectIds: new Set(),
    ownIds: new Set(opts.own ?? []),
    ...(opts.available ? { tradeAvailableIds: new Set(opts.available) } : {}),
    careerKey: '7-aaa',
  }
}

const ids = (ctx: PlayerSearchCtx, q: PlayerSearchQuery): string[] => searchPlayers(ctx, { limit: 200, ...q }).rows.map((r) => r.playerId).sort()

describe('player search — new filters', () => {
  const a = makePlayer('a', 80, { age: 24, years: 1 })
  const b = makePlayer('b', 60, { age: 31, years: 5, injuryGames: 4 })
  const c = makePlayer('c', 70, { age: 22, position: 'D', years: 2 })
  a.heightCm = 190; a.weightKg = 95
  b.heightCm = 178
  c.handedness = 'R'
  const all = { known: { a: 100, b: 100, c: 100 } }

  it('contract years left, health, height and weight', () => {
    const ctx = world([a, b, c], all)
    expect(ids(ctx, { yearsLeftMax: 2 })).toEqual(['a', 'c'])
    expect(ids(ctx, { health: 'injured' })).toEqual(['b'])
    expect(ids(ctx, { health: 'healthy' })).toEqual(['a', 'c'])
    expect(ids(ctx, { heightMin: 185 })).toEqual(['a'])
    // A player without the field never passes a build filter.
    expect(ids(ctx, { weightMax: 120 })).toEqual(['a'])
  })

  it('RFA / UFA at expiry, waiver exemption and trade availability', () => {
    const ctx = world([a, b, c], { ...all, available: ['b'] })
    expect(ids(ctx, { expiryStatus: 'UFA' })).toEqual(['b'])
    expect(ids(ctx, { expiryStatus: 'RFA' })).toEqual(['a', 'c'])
    // makePlayer signs one-way deals: only the under-25s are exempt.
    expect(ids(ctx, { waiverExemptOnly: true })).toEqual(['a', 'c'])
    expect(ids(ctx, { tradeAvailable: true })).toEqual(['b'])
  })

  it('games played and points come from the live line', () => {
    const ctx = { ...world([a, b, c], all), liveLine: (pid: string) => (pid === 'a' ? { gp: 40, goals: 20, assists: 15, points: 35 } : { gp: 10, goals: 1, assists: 1, points: 2 }) }
    expect(ids(ctx, { gpMin: 20 })).toEqual(['a'])
    expect(ids(ctx, { pointsMax: 5 })).toEqual(['b', 'c'])
  })

  it('"fills a need" keeps a player who answers ANY need: position, shot and bar', () => {
    const ctx = world([a, b, c], all)
    const stars = (p: Player): number => overallToStars(ratedOverall(p))
    expect(ids(ctx, { anyOf: [{ positions: ['D'], handedness: 'R', minCurrentStars: stars(c) }] })).toEqual(['c'])
    expect(ids(ctx, { anyOf: [{ positions: ['D'], handedness: 'R', minCurrentStars: stars(c) + 0.5 }] })).toEqual([])
    expect(ids(ctx, { anyOf: [{ positions: ['D'], handedness: 'L' }, { positions: ['C'], minCurrentStars: stars(a) }] })).toEqual(['a'])
  })

  it('the overall floor and the attribute builder read the scouts, and the unscouted fall out', () => {
    const ctx = world([a, b, c], { known: { a: 100, c: 100 } }) // nobody has seen b
    const strong = attributeValue(a, 'speed')!
    expect(strong).toBeGreaterThan(0)
    const view = searchPlayers(ctx, { attributes: [{ key: 'speed', op: 'gte', value: 1 }], limit: 50 })
    expect(view.rows.map((r) => r.playerId).sort()).toEqual(['a', 'c'])
    expect(view.attrUnread).toBe(1)
    // The filtered attribute rides on the row as a column.
    // …on the profile's 1–20 scale.
    expect(view.rows.find((r) => r.playerId === 'a')!.attrs!.speed).toBe(to20(Math.round(strong)))
    expect(ids(ctx, { minCurrentStars: 0.5 })).toEqual(['a', 'c'])
    // Combined conditions are ANDed.
    const sa = to20(Math.round(attributeValue(a, 'speed')!)), sc = to20(Math.round(attributeValue(c, 'speed')!))
    expect(sa).not.toBe(sc)
    const hi = sa > sc ? 'a' : 'c'
    expect(ids(ctx, { attributes: [{ key: 'speed', op: 'gte', value: Math.max(sa, sc) }, { key: 'speed', op: 'lte', value: 20 }] })).toEqual([hi])
    // A skater has no goalie ratings: a goalie attribute never passes him.
    expect(ids(ctx, { attributes: [{ key: 'reflexes', op: 'gte', value: 1 }] })).toEqual([])
  })

  it('a partial read filters on the starred estimate the profile shows, not the true rating', () => {
    const p = makePlayer('x', 70)
    const truth = to20(Math.round(attributeValue(p, 'speed')!))
    const read = readAttribute(p, 'speed', 40, 0.5, false)!
    const ctx = world([p], { known: { x: 40 } })
    // Whatever the read is, the filter agrees with it and not with the truth.
    expect(ids(ctx, { attributes: [{ key: 'speed', op: 'gte', value: read }] })).toEqual(['x'])
    expect(ids(ctx, { attributes: [{ key: 'speed', op: 'gte', value: read + 1 }] })).toEqual([])
    expect(readAttribute(p, 'speed', 100, 0.5, false)).toBe(truth)
  })

  it('archetype filter needs a real read, and the view carries the career key', () => {
    const ctx = world([a, c], { known: { a: 100, c: 20 } })
    const view = searchPlayers(ctx, { limit: 10 })
    expect(view.careerKey).toBe('7-aaa')
    const typeA = view.rows.find((r) => r.playerId === 'a')!.archetype
    expect(typeA).toBeTruthy()
    expect(view.rows.find((r) => r.playerId === 'c')!.archetype).toBeUndefined()
  })
})
