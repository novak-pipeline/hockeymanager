/**
 * Analyzer unit tests on HAND-BUILT synthetic streams with known answers.
 * Coordinates: normalized rink (x·100 ft, y·42.5 ft). Home goalie sits at
 * x = -0.87, so home attacks +x in every test stream.
 */
import { describe, expect, it } from 'vitest'
import type { FrameEvent, GameEvent, PlayerId, XY } from '@domain'
import {
  aggregate,
  analyzeGame,
  assignShape,
  compare,
  findSituationClip,
  histMean,
  histQuantile,
  SHAPE_TEMPLATES,
  templateSequence,
  trackingToStream,
  type MatchTargets
} from './index'

const P = (s: string): PlayerId => s as PlayerId
const DT = 0.25
const MPH = 5280 / 3600

function frame(t: number, home: [string, XY][], away: [string, XY][], puck: XY, carrier: string | null): FrameEvent {
  return {
    t,
    period: 1,
    type: 'frame',
    home: home.map(([id, pos]) => ({ player: P(id), pos })),
    away: away.map(([id, pos]) => ({ player: P(id), pos })),
    homeGoalie: { player: P('hg'), pos: { x: -0.87, y: 0 } },
    awayGoalie: { player: P('ag'), pos: { x: 0.87, y: 0 } },
    puck,
    puckCarrier: carrier === null ? null : P(carrier)
  }
}

const faceoff = (t = 0): GameEvent => ({ t, period: 1, type: 'faceoff', zone: 'neutral', winner: P('h1'), pos: { x: 0, y: 0 } })
const end = (t: number): GameEvent[] => [
  { t, period: 1, type: 'periodEnd' },
  { t, period: 1, type: 'gameEnd' }
]

describe('kinematics', () => {
  it('reads constant speed, zero accel, and distance skated from frames', () => {
    const s: GameEvent[] = [faceoff()]
    const v = 25 // ft/s
    for (let i = 0; i <= 16; i++) {
      const t = i * DT
      const x = -0.5 + (v * t) / 100
      s.push(frame(t, [['h1', { x, y: 0.2 }]], [['a1', { x: 0.3, y: -0.2 }]], { x, y: 0.2 }, 'h1'))
    }
    s.push(...end(4))
    const m = analyzeGame(s)
    const sp = m.hists['skate.speedMph']
    // h1 moves at 25 ft/s (17.05 mph); a1 stands still.
    expect(histQuantile(sp, 0.99)).toBeCloseTo(v / MPH, 0)
    expect(histMean(sp)).toBeCloseTo(v / MPH / 2, 0)
    expect(histQuantile(m.hists['skate.accelFt'], 0.99)).toBeLessThan(0.6)
    expect(m.counts['motion.teleportsLive'] ?? 0).toBe(0)
  })

  it('measures turn radius and lateral acceleration on a circle', () => {
    const s: GameEvent[] = [faceoff()]
    const r = 30 // ft
    const v = 25 // ft/s → a_lat = v²/r ≈ 20.8 ft/s²
    for (let i = 0; i <= 40; i++) {
      const th = (v / r) * i * DT
      const p = { x: (r * Math.cos(th)) / 100, y: (r * Math.sin(th)) / 42.5 }
      s.push(frame(i * DT, [['h1', p]], [['a1', { x: 0.6, y: 0.6 }]], p, 'h1'))
    }
    s.push(...end(10))
    const m = analyzeGame(s)
    const rad = m.hists['skate.radiusFt.15to20'] // 25 ft/s = 17 mph
    expect(rad.n).toBeGreaterThan(30)
    expect(histQuantile(rad, 0.5)).toBeGreaterThan(r * 0.9)
    expect(histQuantile(rad, 0.5)).toBeLessThan(r * 1.1)
    expect(histQuantile(m.hists['skate.latAccelFt'], 0.5)).toBeCloseTo((v * v) / r, -0.5)
  })

  it('flags a position teleport in live play and counts 20+ mph bursts', () => {
    const s: GameEvent[] = [faceoff()]
    let x = -0.6
    for (let i = 0; i <= 12; i++) {
      // 0-5: 10 ft/s, 6-11: 32 ft/s (burst ≥ 20 mph), frame 12: 30 ft jump.
      if (i > 0) x += i === 12 ? 0.3 : ((i <= 5 ? 10 : 32) * DT) / 100
      s.push(frame(i * DT, [['h1', { x, y: 0 }]], [['a1', { x: 0.8, y: 0.5 }]], { x, y: 0 }, 'h1'))
    }
    s.push(...end(3))
    const m = analyzeGame(s)
    expect(m.counts['motion.teleportsLive']).toBe(1)
    expect(m.counts['skate.bursts20']).toBe(1)
  })
})

describe('passing direction', () => {
  it('classifies forward / backward / lateral and breakaway passes', () => {
    const home: [string, XY][] = [['h1', { x: 0.5, y: 0 }], ['h2', { x: 0.3, y: 0 }]]
    const away: [string, XY][] = [['a1', { x: 0.2, y: 0.3 }], ['a2', { x: 0.1, y: -0.3 }]]
    const pass = (t: number, a: XY, b: XY): GameEvent => ({ t, period: 1, type: 'pass', from: P('h1'), to: P('h2'), a, b, completed: true })
    const s: GameEvent[] = [
      faceoff(),
      frame(0, home, away, { x: 0.5, y: 0 }, 'h1'),
      // Breakaway picture: h1 at x=0.5, every away skater behind him.
      pass(0.1, { x: 0.5, y: 0 }, { x: 0.3, y: 0 }), // backward 20 ft
      frame(0.25, home, away, { x: 0.3, y: 0 }, 'h2'),
      pass(0.3, { x: 0.5, y: 0 }, { x: 0.7, y: 0.05 }), // forward
      pass(0.4, { x: 0.5, y: 0 }, { x: 0.5, y: 0.6 }), // lateral (pure y)
      ...end(1)
    ]
    const m = analyzeGame(s)
    expect(m.counts['pass.n']).toBe(3)
    expect(m.counts['pass.back']).toBe(1)
    expect(m.counts['pass.fwd']).toBe(1)
    expect(m.counts['pass.lat']).toBe(1)
    // All three were thrown with no defender goal-side of h1 (x = 0.5).
    expect(m.counts['pass.breakaway.n']).toBe(3)
    expect(m.counts['pass.breakaway.back']).toBe(1)
    // And inside the 8 s rush window after the home team took possession.
    expect(m.counts['pass.rush.n']).toBe(3)
  })
})

describe('hits, entries, shots', () => {
  it('splits hits boards vs open ice, detects a carried entry, bins a slot shot', () => {
    const s: GameEvent[] = [faceoff()]
    const away: [string, XY][] = [['a1', { x: 0.6, y: 0.3 }]]
    // Carrier skates from x = 0.1 (inside the NZ) over the blue line (0.25).
    for (let i = 0; i <= 6; i++) {
      const x = 0.1 + i * 0.05
      s.push(frame(i * DT, [['h1', { x, y: 0 }]], away, { x, y: 0 }, 'h1'))
    }
    s.push({ t: 1.6, period: 1, type: 'hit', by: P('a1'), on: P('h1'), pos: { x: 0.4, y: 0.98 } }) // on the boards
    s.push({ t: 1.7, period: 1, type: 'hit', by: P('a1'), on: P('h1'), pos: { x: 0.0, y: 0.0 } }) // open ice
    s.push({ t: 1.8, period: 1, type: 'shot', shooter: P('h1'), from: { x: 0.79, y: 0 }, target: { x: 1, y: 0 }, danger: 0.3 })
    s.push(...end(2))
    const m = analyzeGame(s)
    expect(m.counts['hit.n']).toBe(2)
    expect(m.counts['hit.boards']).toBe(1)
    expect(m.counts['entry.n']).toBe(1)
    expect(m.counts['entry.carry']).toBe(1)
    // 10 ft straight out → distance bin 1 (8–15 ft), angle bin 0.
    const g = m.grids['shot.distAngle']
    expect(g.cells[1 * g.cols + 0]).toBe(1)
  })
})

describe('aggregate + compare', () => {
  it('sums games and grades against bands with a trend', () => {
    const one: GameEvent[] = [
      faceoff(),
      { t: 1, period: 1, type: 'hit', by: P('h1'), on: P('a1'), pos: { x: 0, y: 0.99 } },
      ...end(2)
    ]
    const meta = { home: ['h1'], away: ['a1'] }
    const agg = aggregate([analyzeGame(one, meta), analyzeGame(one, meta)])
    expect(agg.games).toBe(2)
    expect(agg.counts['hit.n']).toBe(2)
    const targets: MatchTargets = {
      meta: { generated: 'test', note: '' },
      sources: {},
      metrics: {
        'physical.hitsPerTeamGame': { value: 0.5, band: [0.4, 0.6], source: 't', confidence: 'measured' },
        'physical.hitBoardsShare': { value: 0.5, band: [0.4, 0.6], source: 't', confidence: 'measured' }
      }
    }
    const sc = compare(agg, targets, { rows: [{ id: 'physical.hitBoardsShare', ours: 0.2 }] })
    const hits = sc.rows.find((r) => r.id === 'physical.hitsPerTeamGame')!
    expect(hits.ours).toBeCloseTo(0.5) // 2 hits / 4 team-games
    expect(hits.verdict).toBe('pass')
    const boards = sc.rows.find((r) => r.id === 'physical.hitBoardsShare')!
    expect(boards.ours).toBe(1)
    expect(boards.verdict).toBe('fail')
    expect(boards.trend).toBe(-1) // 0.2 → 1.0 moved further from [0.4, 0.6]
  })
})

describe('shapes + reference replay', () => {
  it('optimal assignment recovers a permuted template exactly', () => {
    const t = SHAPE_TEMPLATES[0]
    const pts = [...t.attack].reverse().map((r) => ({ x: r.x, y: r.y }))
    const res = assignShape(pts, t.attack)!
    expect(res.meanFt).toBeCloseTo(0)
  })

  it('a textbook sequence round-trips through the frame format and scores ~0 shape error', () => {
    const seq = templateSequence(['ozLowCycle'], { holdS: 2 })
    const stream = trackingToStream(seq)
    expect(stream.filter((e) => e.type === 'frame').length).toBe(20)
    const m = analyzeGame(stream)
    const acc = m.shapes['ozLowCycle']
    expect(acc.frames).toBe(20)
    expect(acc.attackErrSum / acc.frames).toBeLessThan(0.01)
    expect(acc.defendErrSum / acc.frames).toBeLessThan(0.01)
  })

  it('findSituationClip cuts a re-based window around the matching frame', () => {
    const stream = trackingToStream(templateSequence(['breakoutWall', 'nzRegroup'], { holdS: 1, moveS: 2 }))
    const clip = findSituationClip(stream, SHAPE_TEMPLATES.find((t) => t.id === 'nzRegroup')!, { beforeS: 1, afterS: 1 })
    expect(clip).not.toBeNull()
    expect(clip!.stream[0].t).toBe(0)
    expect(clip!.stream.some((e) => e.type === 'frame')).toBe(true)
  })
})
