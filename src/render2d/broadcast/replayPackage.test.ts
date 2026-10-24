import { describe, expect, it } from 'vitest'
import type { GameEvent, GameStream } from '@domain'
import { deadWindowsOf } from '../../render3d/camera/stoppages'
import { generateLeague } from '@data/generate'
import { fullSimGame } from '@engine/full/fullSim'
import {
  EXTRA_ANGLE, GOAL_REPLAY, REEL_MAX_CLIPS, STOPPAGE_REPLAY_DELAY_S, goalReplayPackage, periodReel, stoppageReplays,
} from './replayPackage'

const ev = (e: Record<string, unknown>): GameEvent => e as unknown as GameEvent
const P = { x: 0, y: 0 }
const shot = (period: number, t: number, shooter: string, danger: number, from = { x: 0.7, y: 0.4 }): GameEvent =>
  ev({ type: 'shot', period, t, shooter, from, target: { x: 0.89, y: 0 }, danger })
const save = (period: number, t: number): GameEvent => ev({ type: 'save', period, t, goalie: 'ag', rebound: false, pos: P })
const goal = (period: number, t: number, scorer: string, strength = 'ev'): GameEvent => ev({ type: 'goal', period, t, scorer, assists: ['h2'], strength, pos: { x: 0.89, y: 0 } })
const whistle = (period: number, t: number, reason = 'goalieFreeze'): GameEvent => ev({ type: 'whistle', period, t, reason })
const faceoff = (period: number, t: number): GameEvent => ev({ type: 'faceoff', period, t, pos: P, winner: 'h1', loser: 'a1', zone: 'neutral' })
const hit = (period: number, t: number, force: number, knockdown = false): GameEvent => ev({ type: 'hit', period, t, by: 'h3', on: 'a3', pos: { x: 0.2, y: -0.9 }, force, knockdown })
const end = (period: number): GameEvent => ev({ type: 'periodEnd', period, t: 1200 })

function stream(...evs: GameEvent[]): GameStream {
  return evs.map((e, i) => ({ e, i })).sort((a, b) => a.e.period - b.e.period || a.e.t - b.e.t || a.i - b.i).map((x) => x.e)
}

describe('replay package — goals', () => {
  const s = stream(faceoff(1, 0), shot(1, 300, 'h1', 0.5), goal(1, 300.4, 'h1'), whistle(1, 300.4, 'goal'), faceoff(1, 330), end(1))

  it('main replay plus behind the net and the shooter\'s side; every clip shows the puck going in', () => {
    const clips = goalReplayPackage(s, 300.4, { extraAngles: true })
    expect(clips.map((c) => c.angle)).toEqual(['auto', 'behindNet', 'shooterSide'])
    for (const c of clips) {
      expect(c.from).toBeLessThanOrEqual(c.at - 2)
      expect(c.to).toBeGreaterThan(c.at)
      expect(c.speed).toBeLessThanOrEqual(1)
    }
    expect(clips[0]!.to - clips[0]!.at).toBeCloseTo(GOAL_REPLAY.tail)
    expect(clips[1]!.at - clips[1]!.from).toBeCloseTo(EXTRA_ANGLE.lead)
    expect(clips[0]!.net).toBe(1)
    expect(clips[2]!.side).toBe(1)
  })

  it('the setting off = the main replay only; a shot from the slot gets no shooter\'s-side angle', () => {
    expect(goalReplayPackage(s, 300.4, { extraAngles: false })).toHaveLength(1)
    const slot = stream(shot(1, 300, 'h1', 0.5, { x: 0.7, y: 0.02 }), goal(1, 300.4, 'h1'))
    expect(goalReplayPackage(slot, 300.4, { extraAngles: true }).map((c) => c.angle)).toEqual(['auto', 'behindNet'])
  })

  it('an empty-net goal gets the main replay only', () => {
    const en = stream(shot(1, 300, 'h1', 0.2), goal(1, 300.4, 'h1', 'en'))
    expect(goalReplayPackage(en, 300.4, { extraAngles: true })).toHaveLength(1)
  })
})

describe('replay package — stoppage replays', () => {
  it('a big save is replayed at the whistle after it, inside the dead window', () => {
    const s = stream(faceoff(1, 0), shot(1, 100, 'h1', 0.8), save(1, 100.3), whistle(1, 101), faceoff(1, 130), end(1))
    const r = stoppageReplays(s)
    expect(r).toHaveLength(1)
    expect(r[0]!.clip.kind).toBe('bigSave')
    expect(r[0]!.startAt).toBeCloseTo(101 + STOPPAGE_REPLAY_DELAY_S)
    const dead = deadWindowsOf(s)
    expect(dead.some((w) => r[0]!.startAt >= w.from && r[0]!.startAt < w.to)).toBe(true)
  })

  it('a routine save, a bump, or a goal before the whistle: no stoppage replay', () => {
    const s = stream(
      faceoff(1, 0), shot(1, 100, 'h1', 0.3), save(1, 100.3), whistle(1, 101), faceoff(1, 130),
      hit(1, 200, 0.4), whistle(1, 205), faceoff(1, 230),
      shot(1, 300, 'h1', 0.9), save(1, 300.2), shot(1, 303, 'h2', 0.4), goal(1, 303.3, 'h2'), whistle(1, 303.3, 'goal'), faceoff(1, 330),
      end(1),
    )
    expect(stoppageReplays(s)).toEqual([])
  })

  it('a big hit that puts a man down is replayed tight on him; one replay per whistle', () => {
    const s = stream(faceoff(1, 0), hit(1, 50, 0.9, true), shot(1, 52, 'h1', 0.85), save(1, 52.2), whistle(1, 53), faceoff(1, 80), end(1))
    const r = stoppageReplays(s)
    expect(r).toHaveLength(1)
    // the better of the two at this stoppage
    expect(['bigHit', 'bigSave']).toContain(r[0]!.clip.kind)
    const hitOnly = stoppageReplays(stream(faceoff(1, 0), hit(1, 50, 0.9, true), whistle(1, 60), faceoff(1, 80), end(1)))
    expect(hitOnly[0]!.clip.angle).toBe('tight')
    expect(hitOnly[0]!.clip.subject).toBe('a3')
  })
})

describe('replay package — the intermission reel', () => {
  it('goals first, then the rest by kind; never two clips over the same seconds; capped', () => {
    const evs: GameEvent[] = [faceoff(1, 0)]
    for (let k = 0; k < 12; k++) evs.push(shot(1, 60 + k * 80, 'h1', 0.85), save(1, 60.3 + k * 80), whistle(1, 61 + k * 80), faceoff(1, 90 + k * 80))
    evs.push(hit(1, 1050, 0.95, true), shot(1, 1100, 'a1', 0.5), goal(1, 1100.4, 'a1'), whistle(1, 1100.4, 'goal'), faceoff(1, 1130), end(1))
    evs.push(shot(2, 100, 'h1', 0.5), goal(2, 100.4, 'h1'), end(2))
    const reel = periodReel(stream(...evs), 1)
    expect(reel.length).toBeLessThanOrEqual(REEL_MAX_CLIPS)
    expect(reel[0]!.kind).toBe('goal')
    expect(reel.filter((c) => c.kind === 'goal')).toHaveLength(1) // the second-period goal isn't in the first's reel
    const order = { goal: 0, bigSave: 1, bigHit: 2, fight: 3, chance: 4 }
    for (let i = 1; i < reel.length; i++) expect(order[reel[i]!.kind]).toBeGreaterThanOrEqual(order[reel[i - 1]!.kind])
    for (let i = 0; i < reel.length; i++) for (let j = i + 1; j < reel.length; j++) {
      expect(reel[i]!.to <= reel[j]!.from || reel[j]!.to <= reel[i]!.from).toBe(true)
    }
    expect(reel.some((c) => c.kind === 'bigHit')).toBe(true)
  })

  it('a quiet period has nothing to show', () => {
    expect(periodReel(stream(faceoff(1, 0), whistle(1, 40), faceoff(1, 60), end(1)), 1)).toEqual([])
  })

  it('a simulated game: every goal of the period is in its reel, and stoppage replays sit in dead time', () => {
    const data = generateLeague({ seed: 7 })
    const [hId, aId] = data.league.teams
    const g = fullSimGame(data.teams.get(hId!)!, data.teams.get(aId!)!, (id) => data.players.get(id)!, { seed: 11 })
    const dead = deadWindowsOf(g.stream)
    for (const r of stoppageReplays(g.stream)) expect(dead.some((w) => r.startAt >= w.from && r.startAt < w.to)).toBe(true)
    for (const period of [1, 2]) {
      const goals = g.stream.filter((e) => e.type === 'goal' && e.period === period).length
      const reel = periodReel(g.stream, period)
      expect(reel.filter((c) => c.kind === 'goal')).toHaveLength(goals)
      for (const c of reel) expect(c.from).toBeLessThan(c.to)
    }
  })
})
