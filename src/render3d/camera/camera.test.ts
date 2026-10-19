/**
 * W3 S7 camera gates: the limited follower, the projection, and VT9 run
 * offline over agent-engine games (the same camera code the renderer runs).
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { generateLeague } from '@data/generate'
import type { GameStream, Player, PlayerId } from '@domain'
import { agentSimGame } from '@engine/agent/agentSim'
import { vt9Framing } from '../viewerTruth'
import { axisAt, axisStep } from './limits'
import { projectNdc } from './project'
import { broadcastProbeFrames } from './offline'
import { BROADCAST_LIMITS } from './broadcast'

describe('camera behaviours', () => {
  it('the limited follower never exceeds its speed, acceleration or jerk, and does not overshoot a step', () => {
    const lim = BROADCAST_LIMITS.pan
    let s = axisAt(0)
    let maxV = 0
    let maxA = 0
    let maxJ = 0
    let maxPos = 0
    const dt = 1 / 60
    for (let i = 0; i < 600; i++) {
      const target = i < 300 ? 120 : -40
      const n = axisStep(s, target, dt, lim)
      maxV = Math.max(maxV, Math.abs(n.vel))
      maxA = Math.max(maxA, Math.abs((n.vel - s.vel) / dt))
      maxJ = Math.max(maxJ, Math.abs((n.acc - s.acc) / dt))
      if (i < 300) maxPos = Math.max(maxPos, n.pos)
      s = n
    }
    expect(maxV).toBeLessThanOrEqual(lim.vmax + 1e-9)
    expect(maxA).toBeLessThanOrEqual(lim.amax + 1e-6)
    expect(maxJ).toBeLessThanOrEqual(lim.jmax + 1e-6)
    expect(maxPos).toBeLessThan(120 + 120 * 0.03)
    expect(Math.abs(s.pos + 40)).toBeLessThan(0.5)
  })

  it('projects a world point where THREE draws it', () => {
    const pose = { px: 20, py: 48, pz: -60, lx: 30, ly: 0, lz: 30, fov: 31 }
    const cam = new THREE.PerspectiveCamera(pose.fov, 16 / 9, 0.1, 1000)
    cam.position.set(pose.px, pose.py, pose.pz)
    cam.lookAt(pose.lx, pose.ly, pose.lz)
    cam.updateMatrixWorld()
    for (const [x, y, z] of [[30, 0, 30], [-10, 3, 0], [80, 0, -40], [55, 6, 41]] as const) {
      const v = new THREE.Vector3(x, y, z).project(cam)
      const n = projectNdc(pose, 16 / 9, x, y, z)
      expect(n.x).toBeCloseTo(v.x, 5)
      expect(n.y).toBeCloseTo(v.y, 5)
    }
  })
})

const data = generateLeague({ seed: 99 })
const resolve = (id: PlayerId): Player => {
  const p = data.players.get(id)
  if (!p) throw new Error(`unknown player ${id}`)
  return p
}
const teams = data.league.teams
const team = (i: number) => data.teams.get(teams[i % teams.length])!

function homeOf(stream: GameStream): (id: PlayerId) => boolean {
  const ids = new Set<string>()
  for (const e of stream) if (e.type === 'frame') { for (const s of e.home) ids.add(s.player as string); ids.add(e.homeGoalie.player as string) }
  return (id) => ids.has(id as string)
}

describe('VT9 offline (agent engine, the broadcast camera)', () => {
  const VERBOSE = process.env.CAM_VERBOSE === '1'
  it('frames every live frame: puck in the safe area, carrier mid-frame, no over-limit pan, no live cut, board play visible', () => {
    const games = Number(process.env.CAM_GAMES ?? 2)
    for (let g = 0; g < games; g++) {
      const game = agentSimGame(team(2 * g), team(2 * g + 1), resolve, { seed: 4200 + g })
      const stream = game.stream
      const frames = broadcastProbeFrames(stream, homeOf(stream), { from: 0, to: Number(process.env.CAM_SECONDS ?? 1300), w: Number(process.env.CAM_W ?? 1600), h: Number(process.env.CAM_H ?? 900) })
      const r = vt9Framing({ frames, geometry: { rinkHalfL: 100, rinkHalfW: 42.5, benchGates: { home: { x: -26, z: 41 }, away: { x: 26, z: 41 } } }, events: [], cues: [], timers: [], goals: [] })
      if (VERBOSE) {
        // eslint-disable-next-line no-console
        console.log(`game ${g}: ${r.status} ${r.value}\n  ${r.evidence.join('\n  ')}`)
        if (process.env.CAM_BEFORE === '1') {
          const b = vt9Framing({ frames: broadcastProbeFrames(stream, homeOf(stream), { from: 0, to: Number(process.env.CAM_SECONDS ?? 1300), noFocus: true }), geometry: { rinkHalfL: 100, rinkHalfW: 42.5, benchGates: { home: { x: -26, z: 41 }, away: { x: 26, z: 41 } } }, events: [], cues: [], timers: [], goals: [] })
          // eslint-disable-next-line no-console
          console.log(`  no sim focus: ${b.status} ${b.value}`)
        }
      }
      expect(r.status, r.value).toBe('green')
    }
  }, 600_000)
})

describe('VT9 strict rules', () => {
  const GEO = { rinkHalfL: 100, rinkHalfW: 42.5, benchGates: { home: { x: -26, z: 41 }, away: { x: 26, z: 41 } } }
  const fr = (i: number, extra: { cut?: boolean; lx?: number; puckZ?: number; nearCut?: number } = {}) => ({
    wall: i / 60, dt: 1 / 60, clock: 100 + i / 60, speed: 1, playing: true, dead: false, w: 1600, h: 900,
    cam: { x: 0, y: 50, z: -95, fov: 30, preset: 'broadcast', lx: extra.lx ?? 0, ly: 0, lz: 0, nearCut: extra.nearCut ?? 0, cut: extra.cut ?? false },
    puck: { x: 0, y: 0, z: extra.puckZ ?? 0, sx: 800, sy: 450, onScreen: true, simX: 0, simZ: 0 },
    carrier: null, windup: null, goalSeq: null, goalSeqT: null, rigs: [],
  })
  const judge = (frames: Array<ReturnType<typeof fr>>) => vt9Framing({ frames, geometry: GEO, events: [], cues: [], timers: [], goals: [] })
  it('is red on a cut in live play', () => {
    expect(judge([0, 1, 2, 3].map((i) => fr(i))).status).toBe('green')
    expect(judge([0, 1, 2, 3].map((i) => fr(i, { cut: i === 2 }))).status).toBe('red')
  })
  it('is red on a pan that accelerates past the limit', () => {
    // the look point goes from rest to 300 ft/s at once
    expect(judge(Array.from({ length: 40 }, (_, i) => fr(i, { lx: i < 20 ? 0 : (i - 20) * 5 }))).status).toBe('red')
  })
  it('is red when the puck is on the near boards and the dasher is not softened', () => {
    expect(judge([0, 1, 2].map((i) => fr(i, { puckZ: -39 }))).status).toBe('red')
  })
})
