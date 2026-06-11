import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import type { Player, PlayerId } from '@domain'
import { fullSimGame } from '@engine/full/fullSim'
import { MatchTimeline, absTime } from './timeline'

function buildTimeline(seed: number) {
  const data = generateLeague({ seed })
  const resolve = (id: PlayerId): Player => data.players.get(id)!
  const home = data.teams.get(data.league.teams[0])!
  const away = data.teams.get(data.league.teams[1])!
  const out = fullSimGame(home, away, resolve, { seed: seed * 7 })
  const homeIds = new Set<PlayerId>(home.roster)
  const tl = new MatchTimeline(out.stream, (id) => homeIds.has(id))
  return { tl, out }
}

describe('MatchTimeline', () => {
  it('final score matches the engine outcome', () => {
    const { tl, out } = buildTimeline(3)
    expect(tl.homeFinal).toBe(out.homeGoals)
    expect(tl.awayFinal).toBe(out.awayGoals)
  })

  it('samples interpolated positions within the rink at any time', () => {
    const { tl } = buildTimeline(3)
    for (const f of [0, 0.13, 0.5, 0.77, 1]) {
      const snap = tl.sampleAt(f * tl.duration)
      expect(snap).not.toBeNull()
      // Skater counts vary: 3v3 OT, 4v5/5v4 PP/PK, 5v5 EV, 6-skater goalie pull.
      expect(snap!.home.length).toBeGreaterThanOrEqual(3)
      expect(snap!.home.length).toBeLessThanOrEqual(6)
      expect(snap!.away.length).toBeGreaterThanOrEqual(3)
      expect(snap!.away.length).toBeLessThanOrEqual(6)
      for (const p of [...snap!.home, ...snap!.away, snap!.puck, snap!.homeGoalie]) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1.001)
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1.001)
      }
    }
  })

  it('score is monotonic and ends at the final score', () => {
    const { tl } = buildTimeline(3)
    let prev = 0
    for (let i = 0; i <= 20; i++) {
      const s = tl.scoreAt((i / 20) * tl.duration)
      expect(s.home + s.away).toBeGreaterThanOrEqual(prev)
      prev = s.home + s.away
    }
    const end = tl.scoreAt(tl.duration)
    expect(end.home).toBe(tl.homeFinal)
    expect(end.away).toBe(tl.awayFinal)
  })

  it('counts the period clock down from 20:00', () => {
    const { tl } = buildTimeline(3)
    expect(tl.clockAt(0)).toEqual({ period: 1, text: '20:00' })
    expect(tl.clockAt(absTime(1, 600)).text).toBe('10:00')
    expect(tl.clockAt(absTime(2, 0)).period).toBe(2)
  })
})
