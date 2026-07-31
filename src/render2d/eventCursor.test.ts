import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { GameStream, Player, PlayerId } from '@domain'
import { fullSimGame } from '@engine/full/fullSim'
import { EventCursor } from './eventCursor'
import { MatchTimeline } from './timeline'

/** A small hand-built stream: two periods, one OT, events at known clocks. */
function synthetic(): GameStream {
  return [
    { type: 'faceoff', period: 1, t: 0, zone: 'neutral', winner: 'p1' as PlayerId, pos: { x: 0, y: 0 } },
    { type: 'shot', period: 1, t: 10, shooter: 'p1' as PlayerId, from: { x: 0, y: 0 }, target: { x: 0.89, y: 0 }, danger: 0.4 },
    { type: 'goal', period: 1, t: 10.5, scorer: 'p1' as PlayerId, assists: [], strength: 'ev', pos: { x: 0.8, y: 0 } },
    { type: 'whistle', period: 2, t: 30, reason: 'icing' },
    { type: 'gameEnd', period: 4, t: 60 },
  ] as GameStream
}

describe('EventCursor', () => {
  it('emits only the events crossed since the last advance', () => {
    const c = new EventCursor(synthetic())
    expect(c.advance(5).map((e) => e.ev.type)).toEqual(['faceoff'])
    expect(c.advance(10).map((e) => e.ev.type)).toEqual(['shot'])
    expect(c.advance(11).map((e) => e.ev.type)).toEqual(['goal'])
    expect(c.advance(11).length).toBe(0) // no re-fire on a stationary clock
  })

  it('never re-emits an event, whatever the step size', () => {
    const stream = synthetic()
    const fine = new EventCursor(stream)
    const coarse = new EventCursor(stream)
    const seenFine: string[] = []
    for (let t = 0; t <= 5000; t += 0.5) for (const e of fine.advance(t)) seenFine.push(e.ev.type)
    const seenCoarse: string[] = []
    for (let t = 0; t <= 5000; t += 250) for (const e of coarse.advance(t)) seenCoarse.push(e.ev.type)
    expect(seenFine).toEqual(seenCoarse)
    expect(seenFine.length).toBe(stream.length)
  })

  it('seek repositions without emitting, and resumes from there', () => {
    const c = new EventCursor(synthetic())
    c.seek(20)
    expect(c.position).toBe(20)
    // The period-1 events are behind us and must not fire again.
    const rest = c.advance(5000).map((e) => e.ev.type)
    expect(rest).toEqual(['whistle', 'gameEnd'])
  })

  it('drops positional frames unless asked for them', () => {
    const withFrame: GameStream = [
      ...synthetic(),
      {
        type: 'frame', period: 1, t: 5,
        home: [], away: [],
        homeGoalie: { player: 'g1' as PlayerId, pos: { x: -0.9, y: 0 } },
        awayGoalie: { player: 'g2' as PlayerId, pos: { x: 0.9, y: 0 } },
        puck: { x: 0, y: 0 }, puckCarrier: null,
      },
    ] as GameStream
    expect(new EventCursor(withFrame).length).toBe(5)
    expect(new EventCursor(withFrame, true).length).toBe(6)
  })

  it('places events on the same clock MatchTimeline scrubs on', () => {
    const data = generateLeague({ seed: 7 })
    const resolve = (id: PlayerId): Player => data.players.get(id)!
    const [aId, bId] = data.league.teams
    const home = data.teams.get(aId)!
    const away = data.teams.get(bId)!
    const out = fullSimGame(home, away, resolve, { seed: 123 })
    const homeIds = new Set<string>(home.roster.map((id) => id as string))
    const timeline = new MatchTimeline(out.stream, (id) => homeIds.has(id as string))
    const cursor = new EventCursor(out.stream)

    // Every goal the cursor reports must be inside the game the timeline scrubs,
    // and the running score at that instant must already include it.
    const goals = cursor.all.filter((e) => e.ev.type === 'goal')
    expect(goals.length).toBeGreaterThan(0)
    for (const g of goals) {
      expect(g.absT).toBeGreaterThanOrEqual(0)
      expect(g.absT).toBeLessThanOrEqual(timeline.duration + 1)
    }
    const last = goals[goals.length - 1]
    const score = timeline.scoreAt(last.absT + 0.01)
    expect(score.home + score.away).toBe(goals.length)
  })
})
