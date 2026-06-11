import { describe, expect, it } from 'vitest'
import { asPlayerId } from './ids'
import { isEvent, type GameEvent, type GameStream } from './events'

describe('GameEvent contract', () => {
  const scorer = asPlayerId('p1')
  const assist = asPlayerId('p2')
  const goalie = asPlayerId('g1')

  const stream: GameStream = [
    { t: 0, period: 1, type: 'faceoff', zone: 'neutral', winner: scorer, pos: { x: 0, y: 0 } },
    {
      t: 12.5,
      period: 1,
      type: 'shot',
      shooter: scorer,
      from: { x: 0.6, y: 0.1 },
      target: { x: 1, y: 0 },
      danger: 0.42
    },
    { t: 12.7, period: 1, type: 'save', goalie, rebound: true, pos: { x: 0.95, y: 0.05 } },
    {
      t: 13.1,
      period: 1,
      type: 'goal',
      scorer,
      assists: [assist],
      strength: 'ev',
      pos: { x: 0.97, y: 0 }
    }
  ]

  it('orders events by game clock within a period', () => {
    const times = stream.map((e) => e.t)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it('narrows variants with isEvent', () => {
    const goals = stream.filter((e): e is Extract<GameEvent, { type: 'goal' }> =>
      isEvent(e, 'goal')
    )
    expect(goals).toHaveLength(1)
    expect(goals[0].assists).toContain(assist)
    expect(goals[0].strength).toBe('ev')
  })

  it('exposes danger as a 0..1 quality on shots', () => {
    const shots = stream.filter((e) => isEvent(e, 'shot'))
    for (const s of shots) {
      expect(s.danger).toBeGreaterThanOrEqual(0)
      expect(s.danger).toBeLessThanOrEqual(1)
    }
  })
})
