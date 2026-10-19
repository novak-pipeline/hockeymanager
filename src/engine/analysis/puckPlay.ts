/**
 * W3 S6 puck detectors (docs/gameplan-2026-09-28/W3-DESIGN.md items 5-6), one
 * judge for the sim stream (vitest gate, measure harness) and the drawn screen
 * (viewerTruth VT20 / VT21):
 *
 * VT20 PUCK SPEED AND CONTINUITY (owner: "puck is zipping around too fast").
 * Between two live frames the puck moves no faster than the action that sent
 * it can send a puck (constraints.ts PUCK_SPEED: a shot, a pass / rim / dump,
 * a carried puck); a free puck that nothing touched does not speed up; a
 * rebound off the goalie or a blocker leaves slower than the shot came in.
 *
 * VT21 THE LOOSE PUCK IS PLAYED (owner: "skate through the puck", "players
 * ignoring a puck right in front of them"). A skater's path does not pass
 * through a free puck that carries on as if he were not there; a slow free
 * puck within a stride of an uncontested man who is free to play it does not
 * sit there, or slide away from him, for a second while he skates off.
 *
 * Pure functions on a neutral frame (feet, playback seconds).
 */
import { playAbsT, streamPeriodBases } from '@domain'
import type { GameStream } from '@domain/events'
import { PUCK_SPEED } from '@engine/agent/constraints'

export interface PPSkater {
  id: string
  team: 'home' | 'away'
  x: number
  y: number
  /** Committed action (sim stream only). */
  act?: string | undefined
  /** His job (sim stream only): 'carry' = the puck is his (a reception still sliding onto the blade). */
  job?: string | undefined
}
export interface PPFrame {
  t: number
  live: boolean
  puck: { x: number; y: number; z: number }
  carrier: string | null
  skaters: PPSkater[]
  /** A delayed offside open against this side (sim stream): its men leave the puck alone on purpose. */
  hold?: 'home' | 'away' | undefined
}
export interface PPEvent {
  t: number
  type: string
  /** shots: release speed, ft/s. */
  speed?: number
}
export interface PPCase {
  t: number
  what: string
}
export interface PuckPlayReport {
  liveMin: number
  intervals: number
  /** VT20 */
  overCap: PPCase[]
  gained: PPCase[]
  reboundFast: PPCase[]
  /** VT21 */
  skateThrough: PPCase[]
  ignored: PPCase[]
  /** fastest interval speed seen, ft/s, by state */
  maxSpeed: { shot: number; free: number; carried: number }
}

/** Rule constants (design confidence; measured on the S5/S6 engines, W3-LOG S6). */
export const PUCK_PLAY_RULE = {
  /** position slack per interval, ft (the blade working, interpolation) */
  slackFt: 1.5,
  /** an interval this close to a shot-like event uses the shot cap (s) */
  shotWindowS: 1.2,
  /** apparent gain on a free, untouched puck that counts (ft/s), and the floor speed */
  gainFtS: 8,
  gainFloor: 20,
  /** stick reach from a body (ft): a man this close to the puck's path could have touched it */
  reachFt: 5,
  /** a puck released from a stick less than this long ago (s) is still being swept (it may speed up) */
  sweepS: 0.35,
  /** a rebound / block leaves no faster than this share of the shot plus slack (ft/s) */
  reboundShare: 0.5,
  reboundSlack: 5,
  /** skate-through: the man's skates within this of the puck's path (ft), the puck carrying on (speed within share, heading within deg) */
  throughFt: 1.0,
  throughKeep: 0.15,
  throughDeg: 15,
  /** ignored: a free puck slower than this (ft/s), the nearest man within this (ft), nobody of theirs within this (ft), sustained this long (s) */
  slowFtS: 15,
  nearFt: 6,
  contestFt: 6,
  ignoreS: 1.0,
  minDt: 0.04,
  substepS: 0.05,
  /** the goalie's puck: within this of the middle of the goal line, in front (he covers it) */
  creaseFt: 6,
} as const

const STICK_EVENTS = new Set(['shot', 'missedShot', 'blockedShot', 'goal', 'pass', 'save', 'hit', 'battle', 'pokeCheck', 'takeaway', 'giveaway', 'faceoff', 'deke', 'stickLift'])
const SHOT_EVENTS = new Set(['shot', 'missedShot', 'blockedShot', 'goal', 'save'])
/** acts that mean a stick is on the puck or just sent it (a dump or a chip has no event: the act shows it) */
const STICK_ACTS = new Set(['windup', 'release', 'pass', 'receive', 'deke', 'poke', 'lifted', 'tieUp', 'save'])
/** acts during which a man cannot play a loose puck (committed or down) */
const BUSY = new Set(['windup', 'release', 'pass', 'deke', 'poke', 'lifted', 'hit', 'stagger', 'down', 'pin', 'pinned', 'tieUp', 'set', 'save', 'boxedOut'])

const clk = (t: number): string => {
  const p = Math.min(4, Math.floor(t / 1200) + 1)
  const r = Math.max(0, 1200 - (t - (p - 1) * 1200))
  return `P${p} ${Math.floor(r / 60)}:${String(Math.floor(r % 60)).padStart(2, '0')}`
}

function segDist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const L2 = dx * dx + dy * dy
  const t = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2))
  return Math.hypot(ax + dx * t, ay + dy * t)
}

export function judgePuckPlay(frames: readonly PPFrame[], events: readonly PPEvent[]): PuckPlayReport {
  const R = PUCK_PLAY_RULE
  const rep: PuckPlayReport = { liveMin: 0, intervals: 0, overCap: [], gained: [], reboundFast: [], skateThrough: [], ignored: [], maxSpeed: { shot: 0, free: 0, carried: 0 } }
  const ev = [...events].sort((a, b) => a.t - b.t)
  const evIn = (t0: number, t1: number, set: Set<string>): PPEvent | undefined => ev.find((e) => e.t > t0 - 0.02 && e.t <= t1 + 0.02 && set.has(e.type))
  const lastBefore = (t: number, set: Set<string>): PPEvent | undefined => {
    let r: PPEvent | undefined
    for (const e of ev) {
      if (e.t > t + 0.02) break
      if (set.has(e.type)) r = e
    }
    return r
  }
  // per-interval speeds
  const vel: ({ vx: number; vy: number; v: number; dt: number } | null)[] = frames.map(() => null)
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!
    const b = frames[i]!
    const dt = b.t - a.t
    if (!a.live || !b.live || dt < R.minDt || dt > 0.6) continue
    const dx = b.puck.x - a.puck.x
    const dy = b.puck.y - a.puck.y
    vel[i] = { vx: dx / dt, vy: dy / dt, v: Math.hypot(dx, dy) / dt, dt }
  }
  let ignoreRun: { id: string; t0: number; reported: boolean } | null = null
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!
    const b = frames[i]!
    if (a.live && b.live) rep.liveMin += Math.max(0, b.t - a.t) / 60
    const vi = vel[i]
    if (!vi) {
      ignoreRun = null
      continue
    }
    rep.intervals++
    const dist = vi.v * vi.dt
    // a shot in flight: its event is at the release (shot, miss) or at the end of the flight (a block, a save)
    const inShot = (a.carrier === null || b.carrier === null) &&
      (evIn(a.t - R.shotWindowS, b.t + R.shotWindowS, SHOT_EVENTS) !== undefined || [...a.skaters, ...b.skaters].some((q) => q.act === 'windup' || q.act === 'release'))
    const carried = a.carrier !== null && b.carrier !== null && a.carrier === b.carrier
    const cap = inShot ? PUCK_SPEED.shot : carried ? PUCK_SPEED.carried : PUCK_SPEED.pass
    if (inShot) rep.maxSpeed.shot = Math.max(rep.maxSpeed.shot, vi.v)
    else if (carried) rep.maxSpeed.carried = Math.max(rep.maxSpeed.carried, vi.v)
    else rep.maxSpeed.free = Math.max(rep.maxSpeed.free, vi.v)
    // (+ one sim substep: a keyframe's time and its puck can sit a substep apart)
    if (dist > cap * (vi.dt + R.substepS) + R.slackFt) rep.overCap.push({ t: b.t, what: `${clk(b.t)} puck moved ${dist.toFixed(1)} ft in ${vi.dt.toFixed(2)} s (${vi.v.toFixed(0)} ft/s; ${inShot ? 'shot' : carried ? 'carried' : 'pass/loose'} cap ${cap})` })
    // a free, untouched puck does not speed up
    const p = vel[i - 1]
    // (a stick sweeping the puck away accelerates it: judged once it has been free a beat)
    let lastHeld = -Infinity
    for (let k = i; k >= 0 && frames[i]!.t - frames[k]!.t < 1; k--) if (frames[k]!.carrier !== null) {
      lastHeld = frames[k]!.t
      break
    }
    if (p && i >= 2 && !inShot && a.t - lastHeld >= R.sweepS) {
      const z = frames[i - 2]!
      // a stick or a skate could have touched it: a man within stick reach of its path (a fumble, a kick)
      // (over this interval or the one before: a release inside the earlier interval shows up as
      // a gain in this one - the frames sample the puck, not the stick)
      const near = (f0: PPFrame, f1: PPFrame): boolean => f1.skaters.some((q) => {
        const q0 = f0.skaters.find((r) => r.id === q.id)
        return q0 !== undefined && segDist(f0.puck.x - q0.x, f0.puck.y - q0.y, f1.puck.x - q.x, f1.puck.y - q.y) < R.reachFt
      })
      const reach = near(a, b) || near(z, a)
      const stick = reach || [...z.skaters, ...a.skaters, ...b.skaters].some((q) => q.act !== undefined && STICK_ACTS.has(q.act))
      if (z.carrier === null && a.carrier === null && b.carrier === null && !stick && !evIn(z.t, b.t, STICK_EVENTS) && vi.v > p.v + R.gainFtS && vi.v > R.gainFloor) {
        rep.gained.push({ t: b.t, what: `${clk(b.t)} free puck sped up ${p.v.toFixed(0)} → ${vi.v.toFixed(0)} ft/s with no stick on it` })
      }
    }
    // rebound / block slower than the shot: the first free interval that starts after the save or block
    // (the first interval from the save / block on, before any stick is on it again)
    const sv = ev.find((e) => (e.type === 'save' || e.type === 'blockedShot') && e.t >= a.t - 0.07 && e.t <= a.t + 0.02)
    const stickNow = [...a.skaters, ...b.skaters].some((q) => q.act !== undefined && STICK_ACTS.has(q.act) && q.act !== 'save')
    if (sv && a.carrier === null && b.carrier === null && !stickNow) {
      const shot = lastBefore(sv.t, new Set(['shot', 'blockedShot']))
      const sp = shot?.speed ?? sv.speed
      if (sp !== undefined && vi.v > sp * R.reboundShare + R.reboundSlack) {
        rep.reboundFast.push({ t: b.t, what: `${clk(b.t)} ${sv.type === 'save' ? 'rebound' : 'block'} left at ${vi.v.toFixed(0)} ft/s off a ${sp.toFixed(0)} ft/s shot` })
      }
    }
    // VT21: skate-through
    const n = vel[i + 1]
    const pz = i >= 2 ? frames[i - 2]! : null
    const played = evIn(a.t - 0.5, b.t, STICK_EVENTS) !== undefined
    if (a.carrier === null && b.carrier === null && n && frames[i + 1]!.carrier === null && vi.v > 4 && !inShot && !played) {
      const keep = Math.abs(n.v - vi.v) <= vi.v * R.throughKeep && (vi.vx * n.vx + vi.vy * n.vy) / Math.max(vi.v * n.v, 1e-9) >= Math.cos((R.throughDeg * Math.PI) / 180)
      if (keep) {
        for (const s of b.skaters) {
          const s0 = a.skaters.find((q) => q.id === s.id)
          if (!s0) continue
          // the man who just sent it, or whose stick is on it, is not going through it
          if (pz?.carrier === s.id || s.job === 'carry' || s0.job === 'carry' || (s.act !== undefined && STICK_ACTS.has(s.act)) || (s0.act !== undefined && STICK_ACTS.has(s0.act))) continue
          const d = segDist(a.puck.x - s0.x, a.puck.y - s0.y, b.puck.x - s.x, b.puck.y - s.y)
          if (d < R.throughFt && a.puck.z <= 1.5 && b.puck.z <= 1.5) {
            rep.skateThrough.push({ t: b.t, what: `${clk(b.t)} ${s.id} went through the puck (${d.toFixed(2)} ft off its path at ${vi.v.toFixed(0)} ft/s) and it carried on` })
            break
          }
        }
      }
    }
    // VT21: ignored
    let who: string | null = null
    const inCrease = Math.abs(b.puck.y) < R.creaseFt && Math.abs(b.puck.x) > 89 - R.creaseFt && Math.abs(b.puck.x) < 89.5
    if (b.carrier === null && a.carrier === null && vi.v < R.slowFtS && b.puck.z <= 1 && !inCrease) {
      let best: PPSkater | null = null
      let bd = Infinity
      for (const s of b.skaters) {
        const d = Math.hypot(s.x - b.puck.x, s.y - b.puck.y)
        if (d < bd) {
          bd = d
          best = s
        }
      }
      if (best && bd <= R.nearFt && !(best.act && BUSY.has(best.act)) && best.team !== b.hold && best.team !== a.hold) {
        const contested = b.skaters.some((s) => s.team !== best!.team && Math.hypot(s.x - b.puck.x, s.y - b.puck.y) < R.contestFt)
        const s0 = a.skaters.find((q) => q.id === best!.id)
        const closing = s0 ? Math.hypot(s0.x - a.puck.x, s0.y - a.puck.y) - bd : 0
        if (!contested && closing <= 0.25) who = best.id
      }
    }
    if (who === null) ignoreRun = null
    else if (!ignoreRun || ignoreRun.id !== who) ignoreRun = { id: who, t0: a.t, reported: false }
    else if (!ignoreRun.reported && b.t - ignoreRun.t0 >= R.ignoreS) {
      ignoreRun.reported = true
      rep.ignored.push({ t: b.t, what: `${clk(b.t)} ${who} left a free puck at his feet for ${(b.t - ignoreRun.t0).toFixed(1)} s (nobody of theirs within ${R.contestFt} ft)` })
    }
  }
  return rep
}

/** The sim stream → neutral frames and events. */
export function puckPlayFromStream(stream: GameStream): { frames: PPFrame[]; events: PPEvent[] } {
  const base = streamPeriodBases(stream)
  const frames: PPFrame[] = []
  const events: PPEvent[] = []
  let live = false
  for (const e of stream) {
    const t = playAbsT(e, base)
    if (e.type === 'faceoff') live = true
    else if (e.type === 'whistle' || e.type === 'periodEnd' || e.type === 'gameEnd' || e.type === 'goal') live = false
    if (e.type === 'frame') {
      const sk = (team: 'home' | 'away') => (s: { player: string; pos: { x: number; y: number }; act?: string | undefined; job?: string | undefined }): PPSkater => ({ id: s.player as string, team, x: s.pos.x * 100, y: s.pos.y * 42.5, act: s.act, job: s.job })
      frames.push({ t, live, puck: { x: e.puck.x * 100, y: e.puck.y * 42.5, z: e.puckZ ?? 0 }, carrier: (e.puckCarrier as string | null) ?? null, skaters: [...e.home.map(sk('home')), ...e.away.map(sk('away'))], hold: e.delayedOffside })
    } else {
      const sp = (e as { speedMph?: number }).speedMph
      events.push({ t, type: e.type, ...(sp !== undefined ? { speed: sp / 0.6818 } : {}) })
    }
  }
  return { frames, events }
}

export function judgePuckPlayStream(stream: GameStream): PuckPlayReport {
  const { frames, events } = puckPlayFromStream(stream)
  return judgePuckPlay(frames, events)
}

/** One harness line (per 60 live minutes). */
export function puckPlayLine(r: { liveMin: number; overCap: number; gained: number; reboundFast: number; skateThrough: number; ignored: number; intervals: number }): string {
  const p = (n: number): string => ((n / Math.max(r.liveMin, 1e-9)) * 60).toFixed(3)
  return `S6 puck per 60 live min: VT20 overCap ${p(r.overCap)} gained ${p(r.gained)} reboundFast ${p(r.reboundFast)} - VT21 skateThrough ${p(r.skateThrough)} ignored ${p(r.ignored)} (intervals ${r.intervals})`
}
