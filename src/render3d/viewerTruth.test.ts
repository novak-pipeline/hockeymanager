import { describe, expect, it } from 'vitest'
import type { ProbeFrame, ProbeGeometry, ProbeRig } from './viewerProbe'
import { runViewerTruth, vt1Bodies, vt5Replay, vt6Clocks, vt8Changes, type VTInput } from './viewerTruth'

const GEO: ProbeGeometry = { rinkHalfL: 100, rinkHalfW: 42.5, benchGates: { home: { x: -26, z: 41 }, away: { x: 26, z: 41 } } }

function rig(team: 'home' | 'away', id: string | null, x: number, z: number, extra: Partial<ProbeRig> = {}): ProbeRig {
  return { team, goalie: false, id, mode: id ? 'play' : 'idle', visible: true, x, z, sx: 500, sy: 300, onScreen: true, simX: id ? x : null, simZ: id ? z : null, boneW: 0, ...extra }
}

function frame(i: number, rigs: ProbeRig[], extra: Partial<ProbeFrame> = {}): ProbeFrame {
  return {
    wall: i / 60, dt: 1 / 60, clock: 100 + i / 30, speed: 2, playing: true, dead: false, w: 1600, h: 900,
    cam: { x: 0, y: 40, z: -75, fov: 30, preset: 'broadcast' },
    puck: { x: 0, y: 0, z: 0, sx: 800, sy: 450, onScreen: true, simX: 0, simZ: 0 },
    carrier: null, windup: null, goalSeq: null, goalSeqT: null, rigs,
    viewer: { phase: 'playing', mode: 'full', replay: false, replayPending: false, ff: false, nudge: 1, shownScore: '0-0' },
    ...extra,
  }
}

const five = (team: 'home' | 'away'): ProbeRig[] => [0, 1, 2, 3, 4].map((k) => rig(team, `${team[0]}${k}`, k * 10 - 20, k * 5 - 10))
const input = (frames: ProbeFrame[], extra: Partial<VTInput> = {}): VTInput => ({ frames, geometry: GEO, events: [], cues: [], timers: [], goals: [], ...extra })

describe('viewer-truth detectors', () => {
  it('VT1 counts idle bench rigs standing just past the boards as bodies on the ice', () => {
    const bench = [0, 1, 2, 3].map((k) => rig('home', null, -38 + k * 3, 42.5 + 4.9))
    const red = vt1Bodies(input([0, 1, 2].map((i) => frame(i, [...five('home'), ...bench, ...five('away')]))))
    expect(red.status).toBe('red')
    expect(red.evidence[0]).toContain('idle bench rigs')
    // the same bench, hidden: green
    const hidden = bench.map((r) => ({ ...r, visible: false }))
    expect(vt1Bodies(input([0, 1].map((i) => frame(i, [...five('home'), ...hidden, ...five('away')])))).status).toBe('green')
  })

  it('VT5 flags a replay that stops short of the goal', () => {
    const goalAbsT = 500
    // replay seeks goal − 8 and plays 0.6× for 8 s wall → ends at goal − 3.2
    const frames = Array.from({ length: 480 }, (_, i) => frame(i, five('home'), {
      wall: 10 + i / 60, clock: goalAbsT - 8 + (i / 60) * 0.6, speed: 0.6,
      viewer: { phase: 'playing', mode: 'full', replay: true, replayPending: false, ff: false, nudge: 1, shownScore: '1-0' },
    }))
    const r = vt5Replay(input(frames, { goals: [{ wall: 5, goalAbsT }] }))
    expect(r.status).toBe('red')
    expect(r.evidence[0]).toContain('ENDS BEFORE')
    const ok = frames.map((f, i) => ({ ...f, clock: goalAbsT - 4 + i / 60 }))
    expect(vt5Replay(input(ok, { goals: [{ wall: 5, goalAbsT }] })).status).toBe('green')
  })

  it('VT6 is red while wall-clock timers govern a goal moment', () => {
    const r = vt6Clocks(input([frame(0, [])], { goals: [{ wall: 0, goalAbsT: 10 }], timers: [{ wall: 0, clock: 10, name: 'celebration → replay cut', ms: 4500 }] }))
    expect(r.status).toBe('red')
  })

  it('VT8 flags a skater who vanishes mid-ice and passes one who leaves at his door', () => {
    const before = [rig('home', 'h9', 0, 0), rig('home', 'h8', -26, 38)]
    const after = [rig('home', null, -30, 47.4), rig('home', null, -27, 47.4)]
    const r = vt8Changes(input([frame(0, before), frame(1, after)]))
    expect(r.status).toBe('red')
    expect(r.value).toMatch(/^1 violations/)
  })

  it('runs all ten and reports n/a with nothing to judge', () => {
    const res = runViewerTruth(input([]))
    expect(res.map((r) => r.id)).toEqual(['VT1', 'VT2', 'VT3', 'VT4', 'VT5', 'VT6', 'VT7', 'VT8', 'VT9', 'VT10', 'VT11'])
    expect(res.every((r) => r.status === 'n/a')).toBe(true)
  })
})
