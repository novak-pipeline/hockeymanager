import { describe, expect, it } from 'vitest'
import type { GameEvent, GameStream } from '@domain'
import { buildGameFlow, chancesBetween, momentumAt, shotsUpTo, MOMENTUM_HALF_LIFE_S } from './gameFlow'

const ev = (e: Record<string, unknown>): GameEvent => e as unknown as GameEvent
const isHome = (id: string): boolean => id.startsWith('h')
// Home attacks +x in periods 1 and 3, −x in 2.
const dir = (period: number, home: boolean): number => (period % 2 === 1 ? 1 : -1) * (home ? 1 : -1)
const shot = (period: number, t: number, who: string, danger: number, extra: Record<string, unknown> = {}): GameEvent => {
  const d = dir(period, isHome(who))
  return ev({ type: 'shot', period, t, shooter: who, from: { x: 0.7 * d, y: 0.1 }, target: { x: d, y: 0 }, danger, ...extra })
}
function stream(extra: GameEvent[]): GameStream {
  const out: GameEvent[] = []
  for (let p = 1; p <= 3; p++) out.push(ev({ type: 'periodEnd', period: p, t: 1200 }))
  return [...out, ...extra].sort((a, b) => a.period - b.period || a.t - b.t)
}

describe('game flow', () => {
  it('a home push tilts the bar home, and it fades', () => {
    const s = stream([shot(1, 300, 'h1', 0.5), shot(1, 305, 'h2', 0.7), shot(1, 312, 'h1', 0.6)])
    const f = buildGameFlow(s, isHome)
    expect(momentumAt(f, 290)).toBe(0)
    const peak = momentumAt(f, 314)
    expect(peak).toBeGreaterThan(0.5)
    const later = momentumAt(f, 314 + 2 * MOMENTUM_HALF_LIFE_S)
    expect(later).toBeGreaterThan(0)
    expect(later).toBeLessThan(peak)
    // An away answer swings it back.
    const s2 = stream([shot(1, 300, 'h1', 0.5), ...[400, 404, 409, 415].map((t) => shot(1, t, 'a1', 0.8))])
    expect(momentumAt(buildGameFlow(s2, isHome), 418)).toBeLessThan(0)
  })

  it('the map puts home shots at +x and away shots at −x in every period', () => {
    const s = stream([shot(1, 100, 'h1', 0.3), shot(2, 100, 'h1', 0.3), shot(2, 200, 'a1', 0.3), shot(3, 100, 'a1', 0.3)])
    const f = buildGameFlow(s, isHome)
    for (const sh of f.shots) {
      if (sh.side === 'home') expect(sh.x).toBeGreaterThan(0)
      else expect(sh.x).toBeLessThan(0)
    }
    expect(shotsUpTo(f, 1200 + 150).length).toBe(2)
  })

  it('marks goals, and a big chance only when it did not go in', () => {
    const s = stream([
      shot(1, 100, 'h1', 0.9),
      ev({ type: 'save', period: 1, t: 100.4, goalie: 'ag', rebound: false, pos: { x: 1, y: 0 } }),
      shot(1, 200, 'h2', 0.9),
      ev({ type: 'goal', period: 1, t: 200.5, scorer: 'h2', assists: [], strength: 'ev', pos: { x: 0.9, y: 0 } }),
      shot(1, 300, 'a1', 0.5, { oddMan: { attackers: 1, defenders: 0 } }),
      ev({ type: 'missedShot', period: 1, t: 400, shooter: 'a2', from: { x: -0.8, y: 0 }, target: { x: -1, y: 0 }, result: 'post' }),
      shot(1, 500, 'h3', 0.2),
    ])
    const f = buildGameFlow(s, isHome)
    expect(f.shots.find((x) => x.playerId === 'h2')!.result).toBe('goal')
    expect(f.shots.find((x) => x.playerId === 'h1')!.result).toBe('save')
    expect(f.chances.map((c) => c.label)).toEqual(['Grade-A chance', 'Breakaway', 'Off the post'])
    expect(f.chances.find((c) => c.playerId === 'h2')).toBeUndefined()
    expect(chancesBetween(f, 100, 400).map((c) => c.playerId)).toEqual(['a1', 'a2'])
  })
})
