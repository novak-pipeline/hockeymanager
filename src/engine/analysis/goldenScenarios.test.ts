import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { GameStream, Player, PlayerId } from '@domain'
import { fullSimGame } from '@engine/full/fullSim'
import { bestPerKind, findScenarios, periodBaseMap, streamFingerprint } from './goldenScenarios'

const P = (id: string): PlayerId => id as PlayerId

describe('golden scenario finder', () => {
  it('finds the hand-built moments on the absolute clock', () => {
    const stream = [
      { type: 'faceoff', t: 0, period: 1, zone: 'neutral', winner: P('h1'), pos: { x: 0, y: 0 } },
      { type: 'pass', t: 1.5, period: 1, from: P('h1'), to: P('h2'), a: { x: 0, y: 0 }, b: { x: 0.1, y: 0.1 }, completed: true },
      { type: 'shot', t: 6, period: 1, shooter: P('h2'), from: { x: 0.7, y: 0 }, target: { x: 0.89, y: 0 }, danger: 0.4, oddMan: { attackers: 1, defenders: 0 } },
      { type: 'save', t: 6.3, period: 1, goalie: P('ag'), rebound: true, pos: { x: 0.89, y: 0 } },
      { type: 'shot', t: 7.5, period: 1, shooter: P('h3'), from: { x: 0.8, y: 0.1 }, target: { x: 0.89, y: 0 }, danger: 0.5, oddMan: { attackers: 2, defenders: 1 } },
      { type: 'goal', t: 7.6, period: 1, scorer: P('h3'), assists: [], strength: 'ev', pos: { x: 0.89, y: 0 } },
      { type: 'hit', t: 30, period: 2, by: P('a1'), on: P('h1'), pos: { x: 0, y: 0.9 }, force: 0.9, knockdown: true },
      { type: 'lineChange', t: 50, period: 2, team: 'tH' as never, onIce: [P('h4')], onTheFly: true },
      { type: 'goal', t: 1150, period: 3, scorer: P('a2'), assists: [], strength: 'en', pos: { x: -0.89, y: 0 } },
    ] as unknown as GameStream
    const isHome = (id: string): boolean => id.startsWith('h')
    const best = bestPerKind(findScenarios(stream, isHome, 'home', 'tH'))
    expect(best.get('breakaway')?.absT).toBe(6)
    expect(best.get('twoOnOne')?.note).toContain('goal')
    expect(best.get('saveRebound')?.side).toBe('home')
    expect(best.get('faceoffWinPlay')?.absT).toBe(0)
    expect(best.get('bigHit')?.absT).toBe(1230)
    expect(best.get('lineChangeOnFly')?.side).toBe('home')
    expect(best.get('emptyNetLate')?.absT).toBe(2400 + 1150)
    expect(best.get('goalReplay')?.absT).toBe(7.6)
    expect(periodBaseMap(stream).get(3)).toBe(2400)
    expect(streamFingerprint(stream, isHome)).toBe('9·1-1')
  })

  it('finds most scenarios in a real classic-engine game, deterministically', () => {
    const data = generateLeague({ seed: 7 })
    const resolve = (id: PlayerId): Player => data.players.get(id)!
    const [aId, bId] = data.league.teams
    const home = data.teams.get(aId!)!
    const away = data.teams.get(bId!)!
    const a = fullSimGame(home, away, resolve, { seed: 11 })
    const b = fullSimGame(home, away, resolve, { seed: 11 })
    const homeIds = new Set(home.roster.map((x) => x as string))
    const isHome = (id: string): boolean => homeIds.has(id)
    expect(streamFingerprint(a.stream, isHome)).toBe(streamFingerprint(b.stream, isHome))
    const kinds = [...bestPerKind(findScenarios(a.stream, isHome, 'home')).keys()]
    // a full game reliably holds hits, faceoff plays, goals and changes
    expect(kinds).toEqual(expect.arrayContaining(['bigHit', 'faceoffWinPlay', 'lineChangeOnFly']))
  })
})
