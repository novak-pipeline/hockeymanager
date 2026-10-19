/**
 * W3 S7: the broadcast camera run offline over a stream, as probe frames VT9
 * can judge — the same camera code the renderer runs, on the sim's positions
 * (no drawn smoothing), at a fixed frame rate. Tunes and gates the camera in
 * vitest without launching the app; the reel judges the drawn picture.
 */
import type { GameStream, PlayerId } from '@domain'
import { MatchTimeline } from '@render2d/timeline'
import { normXtoWorld, normYtoWorld } from '../math'
import type { ProbeFrame, ProbeRig } from '../viewerProbe'
import { BroadcastCamera, fallbackFocus } from './broadcast'
import { projectNdc } from './project'
import { deadWindowAt, deadWindowsOf } from './stoppages'
import { CAMERA_AHEAD_S, puckAhead } from './ahead'

export interface OfflineOpts {
  from?: number
  to?: number
  hz?: number
  w?: number
  h?: number
  /** Ignore the stream's focus (the fallback camera, for the before/after). */
  noFocus?: boolean
  /** Look-ahead offsets (game s) of the puck the frame must also hold. */
  aheadS?: readonly number[]
}

export function broadcastProbeFrames(stream: GameStream, isHome: (id: PlayerId) => boolean, opts: OfflineOpts = {}): ProbeFrame[] {
  const tl = new MatchTimeline(stream, isHome)
  const dead = deadWindowsOf(stream, { periodEnds: true })
  const hz = opts.hz ?? 60
  const w = opts.w ?? 1600
  const h = opts.h ?? 900
  const aspect = w / h
  const from = opts.from ?? 0
  const to = Math.min(tl.duration, opts.to ?? tl.duration)
  const dt = 1 / hz
  const cam = new BroadcastCamera()
  const out: ProbeFrame[] = []
  let prev: { x: number; z: number } | null = null
  let vel = { x: 0, z: 0 }
  let first = true
  for (let t = from; t <= to; t += dt) {
    const s = tl.sampleAt(t)
    if (!s) continue
    const puck = { x: normXtoWorld(s.puck.x), y: s.puckZ ?? 0, z: normYtoWorld(s.puck.y) }
    if (prev) {
      const k = 1 - Math.exp(-dt / 0.5)
      vel = { x: vel.x + ((puck.x - prev.x) / dt - vel.x) * k, z: vel.z + ((puck.z - prev.z) / dt - vel.z) * k }
    }
    prev = { x: puck.x, z: puck.z }
    let carrier: { x: number; z: number; id: string } | null = null
    if (s.carrier) {
      const hi = s.homeIds?.indexOf(s.carrier) ?? -1
      const ai = s.awayIds?.indexOf(s.carrier) ?? -1
      const p = hi >= 0 ? s.home[hi] : ai >= 0 ? s.away[ai] : undefined
      if (p) carrier = { x: normXtoWorld(p.x), z: normYtoWorld(p.y), id: s.carrier as string }
    }
    const dw = deadWindowAt(dead, t)
    const focus = !opts.noFocus && s.focus ? { x: normXtoWorld(s.focus.x), z: normYtoWorld(s.focus.y) } : fallbackFocus(puck, vel)
    const ahead = dw ? [] : puckAhead(tl, dead, t, opts.aheadS ?? CAMERA_AHEAD_S)
    const inp = { dt, aspect, puck, carrier, focus, ahead, dead: dw ? { x: dw.x, z: dw.z } : null }
    if (first) {
      cam.snap(inp)
      first = false
    }
    const pose = cam.step(inp)
    const pn = projectNdc(pose, aspect, puck.x, puck.y, puck.z)
    const scr = (n: { x: number; y: number; front: boolean }) => ({
      sx: ((n.x + 1) / 2) * w,
      sy: ((1 - n.y) / 2) * h,
      onScreen: n.front && Math.abs(n.x) <= 1 && Math.abs(n.y) <= 1,
    })
    const rigs: ProbeRig[] = []
    if (carrier) {
      const cn = scr(projectNdc(pose, aspect, carrier.x, 3, carrier.z))
      rigs.push({ team: 'home', goalie: false, id: carrier.id, mode: 'play', visible: true, x: carrier.x, z: carrier.z, ...cn, simX: carrier.x, simZ: carrier.z, boneW: 0 })
    }
    out.push({
      wall: t, dt, clock: t, speed: 1, playing: true, dead: dw !== null, w, h,
      cam: { x: pose.px, y: pose.py, z: pose.pz, fov: pose.fov, preset: 'broadcast', lx: pose.lx, ly: pose.ly, lz: pose.lz, nearCut: cam.nearCut, cut: cam.cut },
      puck: { ...puck, ...scr(pn), simX: puck.x, simZ: puck.z },
      carrier: carrier?.id ?? null, windup: null, goalSeq: null, goalSeqT: null, rigs,
    })
  }
  return out
}
