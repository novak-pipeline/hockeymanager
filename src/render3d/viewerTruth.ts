/**
 * Viewer-truth detectors VT1–VT11 (docs/gameplan-2026-09-28/ROOT-CAUSES.md §2.1)
 * plus the W3 team-play detectors VT13, VT14, VT16 (W3-DESIGN.md §2), and VT17 the
 * stick grip (gripTruth.ts: the one-handed "lance" after reel S1).
 *
 * Each detector judges what the real match screen DREW (viewerProbe frames,
 * recorded from the built app at the owner's settings), not the sim stream.
 * Pure functions: frames + a compact event list in, one red/green line each out.
 * A new visible bug class earns a detector here BEFORE its fix is written.
 */
import { LABEL_BOARDS_FT, type ProbeFrame, type ProbeGeometry, type ProbeRig } from './viewerProbe'
import { judgeTeamPlay, TP, type TPFrame, type TPReport } from '@engine/analysis/teamPlay'
import { judgeSystems, legibility, type SeqCase, type SysFrame } from '@engine/analysis/systemPlay'
import { judgeOffside, OFFSIDE } from '@engine/analysis/offside'
import { ACTION_FLOOR } from '@engine/agent/constraints'
import { DRAWN_DOTS, dotXY, type DotSpec } from '@engine/analysis/faceoffRule'
import { crossesMouth, GOAL_GEOM } from '@engine/analysis/goalGeometry'
import { judgePuckPlay, PUCK_PLAY_RULE, type PPEvent, type PPFrame, type PuckPlayReport } from '@engine/analysis/puckPlay'
import { PUCK_SPEED } from '@engine/agent/constraints'
import { BROADCAST_LIMITS } from './camera/broadcast'
import { projectNdc } from './camera/project'
import { nearBoardsPoint } from './camera/nearBoards'

/** A non-frame stream event on the absolute clock, positions in world feet. */
export interface VTEvent {
  type: string
  absT: number
  /** shooter / scorer / hitter / faceoff winner / goalie, when the event has one. */
  actor?: string
  /** goal scorer (goal events). */
  scorer?: string
  x?: number
  z?: number
  shotType?: string
  rebound?: boolean
  /** shots: world x of the net it was aimed at (±89). */
  netX?: number
  /** hits: the man hit; knockdown: the engine put him down. */
  target?: string
  knockdown?: boolean
  /** whistles: why play stopped (offside, icing...). */
  reason?: string
  /** poke checks: it took the puck. */
  success?: boolean
  /** shots: seconds the sim's shooter wound up (W2/W3 S2). */
  windupS?: number
  /** whistles: what exactly stopped play (StoppageDetail, W3 S3). */
  detail?: string
  /** faceoffs: the dot it belongs on by the stoppage before it (faceoffRule, NHL rule 76; W3 S3). The loser is `target`. */
  dot?: DotSpec
  /** fights (actor = home fighter, target = away): when they grabbed hold, were parted, were led off (absolute s). */
  fightGrab?: number
  fightSep?: number
  fightBox?: number
  /** shots: release speed, ft/s (W3 S6, VT20). */
  speed?: number
}

/** A spoken / captioned booth line as fired (channel 'commentary'). */
export interface VTCue {
  wall: number
  at: number
  moment: string
  text: string
  playerId?: string
}

/** A wall-clock timer MatchViewer started that governs game-time content. */
export interface VTTimer {
  wall: number
  clock: number
  name: string
  ms: number
}

/** A goal as the viewer detected it (score change). */
export interface VTGoal {
  wall: number
  goalAbsT: number
}

export interface VTInput {
  frames: readonly ProbeFrame[]
  geometry: ProbeGeometry
  events: readonly VTEvent[]
  cues: readonly VTCue[]
  timers: readonly VTTimer[]
  goals: readonly VTGoal[]
}

export type VTStatus = 'red' | 'green' | 'n/a'

export interface VTResult {
  id: string
  name: string
  status: VTStatus
  rule: string
  /** The headline number(s). */
  value: string
  /** Up to a handful of concrete instances (clock, what was seen). */
  evidence: string[]
}

const POP_RAD_S = 12          // motion-probe's body-core pop threshold
const DIVERGE_FT = 3
const NEAR_RINK_FT = 6        // the eye counts a body this close to the sheet as "on it"
const SNAP_FT_S = 45          // a drawn root faster than this (game time, ≥0.1 s window) is a snap
const SEEK_JUMP_S = 0.75      // a clock jump bigger than the frame's own advance = seek / cut

const pct = (xs: number[], p: number): number => {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]!
}
const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : '–')
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : '–')
const clk = (t: number): string => {
  const p = Math.min(4, Math.floor(t / 1200) + 1)
  const r = 1200 - (t - (p - 1) * 1200)
  return `P${p} ${Math.floor(r / 60)}:${String(Math.floor(r % 60)).padStart(2, '0')}`
}

const isLive = (f: ProbeFrame): boolean => f.playing && (!f.viewer || (f.viewer.phase === 'playing' && !f.viewer.ff))
const inReplay = (f: ProbeFrame): boolean => f.viewer?.replay === true
const skaters = (f: ProbeFrame): ProbeRig[] => f.rigs.filter((r) => !r.goalie)

/** Index of frames that follow a seek/cut (their motion is not motion). */
function seekBreaks(frames: readonly ProbeFrame[]): boolean[] {
  return frames.map((f, i) => {
    if (i === 0) return true
    const p = frames[i - 1]!
    const expected = p.playing ? f.dt * p.speed : 0
    return Math.abs(f.clock - p.clock - expected) > SEEK_JUMP_S || inReplay(f) !== inReplay(p)
  })
}

/* ── VT1 bodies on the ice per team, as the eye counts them ───────────────── */
export function vt1Bodies(inp: VTInput): VTResult {
  const g = inp.geometry
  let n = 0
  let bad = 0
  let worst = 0
  let benchShare = 0
  const ev: string[] = []
  for (const f of inp.frames) {
    // in a stoppage a change is legal with both units out (real hockey)
    if (!isLive(f) || f.dead) continue
    n++
    for (const team of ['home', 'away'] as const) {
      const mine = skaters(f).filter((r) => r.team === team)
      const seen = mine.filter((r) => r.visible && r.onScreen && Math.abs(r.x) <= g.rinkHalfL + NEAR_RINK_FT && Math.abs(r.z) <= g.rinkHalfW + NEAR_RINK_FT)
      const simSkaters = mine.filter((r) => r.simX !== null).length
      const allowed = (simSkaters >= 6 ? 7 : 6)
      if (seen.length > allowed) {
        bad++
        const idle = seen.filter((r) => r.id === null).length
        benchShare += idle
        if (seen.length > worst) worst = seen.length
        if (ev.length < 5 && !ev.some((e) => e.startsWith(`${clk(f.clock)} ${team}`))) ev.push(`${clk(f.clock)} ${team}: ${seen.length} bodies at/near the ice (${idle} idle bench rigs, ${seen.filter((r) => r.mode === 'departing').length} departing, sim has ${simSkaters})`)
      }
    }
  }
  const share = n ? bad / (2 * n) : 0
  return {
    id: 'VT1', name: 'Bodies on the ice per team (as rendered)',
    status: n === 0 ? 'n/a' : share <= 0.001 ? 'green' : 'red',
    rule: `visible + on screen + within ${NEAR_RINK_FT} ft of the sheet ≤ 6 per team (7 with an extra attacker) on 99.9% of live-play frames (stoppages excluded: changes)`,
    value: `${(share * 100).toFixed(1)}% of team-frames over; worst ${worst}; avg idle bench rigs in an over-count ${bad ? f1(benchShare / bad) : '0'}`,
    evidence: ev,
  }
}

/* ── VT2 drawn vs sim divergence ─────────────────────────────────────────── */
export function vt2Divergence(inp: VTInput): VTResult {
  const ds: number[] = []
  let inventedRigSec = 0
  let liveSec = 0
  const ev: string[] = []
  for (const f of inp.frames) {
    if (!isLive(f)) continue
    const declared = f.goalSeq !== null || inReplay(f)
    liveSec += f.dt
    for (const r of skaters(f)) {
      if (!r.visible) continue
      if (r.id === null || r.simX === null || r.simZ === null) {
        // a body the sim does not have on the ice: a bench rig or a renderer-choreographed change
        if (r.onScreen) inventedRigSec += f.dt
        continue
      }
      // declared: goal sequence / replay, and the few-feet hop through the bench door
      if (declared || r.mode === 'arriving' || r.mode === 'departing') continue
      const d = Math.hypot(r.x - r.simX, r.z - r.simZ)
      ds.push(d)
      if (d > 3 * DIVERGE_FT && ev.length < 5) ev.push(`${clk(f.clock)} ${r.team} ${r.id}: drawn ${f1(d)} ft from the sim (mode ${r.mode})`)
    }
  }
  const over = ds.filter((d) => d > DIVERGE_FT).length
  const share = ds.length ? over / ds.length : 0
  return {
    id: 'VT2', name: 'Drawn vs sim divergence',
    status: ds.length === 0 ? 'n/a' : share <= 0.01 ? 'green' : 'red',
    rule: `drawn root within ${DIVERGE_FT} ft of the sim on ≥99% of rig-frames outside declared windows (goal sequence, replay)`,
    value: `p50 ${f2(pct(ds, 0.5))} ft · p95 ${f2(pct(ds, 0.95))} · max ${f1(Math.max(0, ...ds))}; ${(share * 100).toFixed(1)}% > ${DIVERGE_FT} ft; invented bodies on screen ${f1(liveSec ? (inventedRigSec / liveSec) : 0)} rig-s per live s`,
    evidence: ev,
  }
}

/* ── VT3 shot readability in wall time ───────────────────────────────────── */
export function vt3Shots(inp: VTInput): VTResult {
  const frames = inp.frames
  const shots = inp.events.filter((e) => e.type === 'shot' || e.type === 'missedShot')
  const ev: string[] = []
  let judged = 0
  let failed = 0
  const setups: number[] = []
  const flights: number[] = []
  for (const s of shots) {
    // a tip is a deflection at the net: no set-up, no flight to see
    if (s.shotType === 'tip') continue
    // only shots the recording actually played through live (continuous, not a replay)
    const near = frames.filter((f) => f.clock >= s.absT - 3 && f.clock <= s.absT + 1.5 && isLive(f) && !inReplay(f))
    if (near.length < 10 || near[0]!.clock > s.absT - 1 || near[near.length - 1]!.clock < s.absT + 0.3) continue
    // set-up: the wind-up the renderer drew — or a deke by the shooter right
    // before (a deke-and-tuck's set-up IS the deke)
    const deke = inp.events.find((e) => e.type === 'deke' && e.actor === s.actor && e.absT >= s.absT - 1.5 && e.absT < s.absT)
    let setup = 0
    for (const f of near) if (f.clock <= s.absT && (f.windup === s.actor || (deke && f.clock >= deke.absT))) setup += f.dt
    // flight: rendered frames after the release on which the drawn puck is
    // travelling toward the net (closing, still > 3 ft out), within 1 game-s
    const netX = s.netX ?? 89
    const after = frames.filter((f) => f.clock >= s.absT && f.clock <= s.absT + 1 && isLive(f) && !inReplay(f))
    let flightWall = 0
    let prevD = Infinity
    let started = false
    for (const f of after) {
      const d = Math.hypot(f.puck.x - netX, f.puck.z)
      if (d <= 3) break
      if (d < prevD - 0.05) { started = true; flightWall += f.dt }
      else if (started) break
      prevD = d
    }
    // frames on a 60 Hz display (the off-screen probe window may render faster)
    const flight60 = flightWall * 60
    const need = s.shotType === 'slap' ? 0.6 : 0.3
    const catchRelease = s.shotType === 'oneTimer' || s.shotType === 'tip'
    judged++
    setups.push(setup)
    flights.push(flight60)
    const ok = (catchRelease || setup >= need) && flight60 >= 3
    if (!ok) {
      failed++
      if (ev.length < 6) ev.push(`${clk(s.absT)} ${s.shotType ?? 'shot'} by ${s.actor}: set-up ${f2(setup)} s wall (need ${need}), flight ${f2(flightWall)} s wall (${f1(flight60)} frames @60 Hz) at ${f2(near[0]!.speed)}×`)
    }
  }
  return {
    id: 'VT3', name: 'Shot readability (wall time)',
    status: judged === 0 ? 'n/a' : failed / judged <= 0.1 ? 'green' : 'red',
    rule: 'set-up ≥ 0.3 s wall (slap ≥ 0.6 s; one-timers exempt, tips not judged; a deke counts as set-up) and the drawn puck travelling to the net on ≥ 3 frames at 60 Hz, for ≥ 90% of shots',
    value: `${judged - failed}/${judged} shots readable; median set-up ${f2(pct(setups, 0.5))} s wall, median flight ${f1(pct(flights, 0.5))} frames @60 Hz`,
    evidence: ev,
  }
}

/* ── VT4 motion gates at the speed actually played ───────────────────────── */
export function vt4Motion(inp: VTInput): VTResult {
  const frames = inp.frames
  const brk = seekBreaks(frames)
  const by = new Map<string, { rigSec: number; pops: number; snaps: number }>()
  const live: number[] = []
  const ev: string[] = []
  frames.forEach((f, i) => {
    if (!isLive(f) || inReplay(f) || brk[i]) return
    const p = frames[i - 1]!
    const key = `${f2(f.speed)}×`
    const b = by.get(key) ?? { rigSec: 0, pops: 0, snaps: 0 }
    if (f.viewer && f.goalSeq === null) live.push(f.speed)
    f.rigs.forEach((r, k) => {
      const q = p.rigs[k]
      if (!r.visible || r.id === null || !q || q.id !== r.id || !q.visible) return
      b.rigSec += f.dt
      if (r.boneW > POP_RAD_S) b.pops++
      if (r.goalie) return
      // a snap: one rendered frame jumps > 3 ft, or the root averages faster than
      // SNAP_FT_S over the last ≥ 0.1 game-s (single 5 ms frames are too noisy)
      const jump = Math.hypot(r.x - q.x, r.z - q.z)
      let j = i - 1
      while (j > 0 && f.clock - frames[j]!.clock < 0.1 && !brk[j]) j--
      const o = frames[j]!.rigs[k]
      const win = f.clock - frames[j]!.clock
      const avg = o && o.id === r.id && win >= 0.1 ? Math.hypot(r.x - o.x, r.z - o.z) / win : 0
      if (jump > 3 || avg > SNAP_FT_S) {
        b.snaps++
        if (ev.length < 4) ev.push(`${clk(f.clock)} ${r.id}: drawn root ${jump > 3 ? `jumped ${f1(jump)} ft in one frame` : `averaged ${f1(avg)} ft/s over ${f2(win)} game-s`} (${r.mode}) at ${key}`)
      }
    })
    by.set(key, b)
  })
  const rows = [...by.entries()].filter(([, b]) => b.rigSec > 1).sort()
  const bad = rows.filter(([, b]) => b.pops / b.rigSec > 0.05 || b.snaps / b.rigSec > 0.05)
  const speeds = [...new Set(live.map((s) => f2(s)))].sort()
  return {
    id: 'VT4', name: 'Motion gates at the playback speed actually used',
    status: rows.length === 0 ? 'n/a' : bad.length === 0 ? 'green' : 'red',
    rule: `per speed: body-core pops (> ${POP_RAD_S} rad/s) ≤ 0.05 per rig-s and root snaps (> 3 ft in one frame, or > ${SNAP_FT_S} ft/s over 0.1 game-s) ≤ 0.05 per rig-s`,
    value: rows.map(([k, b]) => `${k}: pops ${f2(b.pops / b.rigSec)}/rig-s, snaps ${f2(b.snaps / b.rigSec)}/rig-s`).join(' · ') + ` · live-play speeds seen: ${speeds.join(', ')}`,
    evidence: ev,
  }
}

/* ── VT5 the replay contains the goal ────────────────────────────────────── */
export function vt5Replay(inp: VTInput): VTResult {
  const ev: string[] = []
  let judged = 0
  let bad = 0
  for (const g of inp.goals) {
    const rep = inp.frames.filter((f) => f.wall > g.wall && inReplay(f) && f.wall < g.wall + 30)
    if (rep.length === 0) {
      ev.push(`${clk(g.goalAbsT)} goal: no replay frames recorded`)
      continue
    }
    judged++
    const lo = Math.min(...rep.map((f) => f.clock))
    const hi = Math.max(...rep.map((f) => f.clock))
    const ok = lo <= g.goalAbsT - 2 && hi >= g.goalAbsT
    if (!ok) bad++
    ev.push(`${clk(g.goalAbsT)} goal at ${f1(g.goalAbsT)}: replay covered ${f1(lo)}–${f1(hi)} (${f1(hi - g.goalAbsT)} s vs the goal) ${ok ? 'OK' : 'ENDS BEFORE THE PUCK GOES IN'}`)
  }
  return {
    id: 'VT5', name: 'Replay contains the goal',
    status: judged === 0 ? 'n/a' : bad === 0 ? 'green' : 'red',
    rule: 'replay window covers [goal − 2 s, goal]',
    value: `${judged - bad}/${judged} replays show the goal`,
    evidence: ev.slice(0, 5),
  }
}

/* ── VT6 one clock per moment ────────────────────────────────────────────── */
/** The renderer's on-ice goal sequence length, game seconds (rink3dRenderer GOAL_SEQ.end). */
const GOAL_SEQ_S = 8
export function vt6Clocks(inp: VTInput): VTResult {
  const ev: string[] = []
  let bad = 0
  for (const g of inp.goals) {
    const problems: string[] = []
    const timers = inp.timers.filter((t) => t.wall >= g.wall - 0.05 && t.wall <= g.wall + 30)
    for (const t of timers) problems.push(`wall setTimeout '${t.name}' ${t.ms} ms`)
    // the goal sequence must advance with the game clock (t = clock − goal), not wall time
    const live = inp.frames.filter((f) => f.wall >= g.wall && f.wall <= g.wall + 30 && !inReplay(f))
    let drift = 0
    for (const f of live) if (f.goalSeqT !== null && f.clock >= g.goalAbsT && f.clock <= g.goalAbsT + GOAL_SEQ_S) drift = Math.max(drift, Math.abs(f.goalSeqT - (f.clock - g.goalAbsT)))
    if (drift > 0.25) problems.push(`goal sequence drifts ${f2(drift)} s from the game clock`)
    // the replay must not cut the goal sequence short
    const firstRep = inp.frames.findIndex((f) => f.wall > g.wall && inReplay(f))
    if (firstRep > 0) {
      const before = inp.frames[firstRep - 1]!
      if (before.clock < g.goalAbsT + GOAL_SEQ_S - 0.1) problems.push(`replay cut in ${f1(before.clock - g.goalAbsT)} s after the goal (sequence is ${GOAL_SEQ_S} s)`)
    }
    if (problems.length) bad++
    ev.push(`${clk(g.goalAbsT)} goal: ${problems.length ? problems.join('; ') : 'one game clock'}`)
  }
  return {
    id: 'VT6', name: 'One clock per moment',
    status: inp.goals.length === 0 ? 'n/a' : bad === 0 ? 'green' : 'red',
    rule: 'a goal moment runs on the game clock: no wall-clock timers, the goal sequence tracks clock − goal (±0.25 s), the replay starts after the sequence ends',
    value: `${bad}/${inp.goals.length} goal moments off the one clock`,
    evidence: ev.slice(0, 5),
  }
}

/* ── VT7 faceoff set ─────────────────────────────────────────────────────── */
export function vt7Faceoffs(inp: VTInput): VTResult {
  const ev: string[] = []
  let judged = 0
  let bad = 0
  let offDot = 0
  const frames = inp.frames
  const brk = seekBreaks(frames)
  const g = inp.geometry.faceoffDots ?? DRAWN_DOTS
  // every painted dot (centre, 4 neutral, 4 end)
  const painted: Array<{ x: number; z: number; name: string }> = [{ x: 0, z: 0, name: 'centre' }]
  for (const xs of [-1, 1]) for (const ys of [-1, 1]) {
    painted.push({ x: xs * g.neutralX, z: ys * g.y, name: `neutral (${xs * g.neutralX}, ${ys * g.y})` })
    painted.push({ x: xs * g.endX, z: ys * g.y, name: `end (${xs * g.endX}, ${ys * g.y})` })
  }
  for (const fo of inp.events.filter((e) => e.type === 'faceoff')) {
    const idx = frames.map((f, i) => [f, i] as const).filter(([f, i]) => f.clock >= fo.absT - 0.5 && f.clock <= fo.absT && isLive(f) && !inReplay(f) && !brk[i])
    if (idx.length < 4) continue
    judged++
    let maxSp = 0
    for (const [f, i] of idx) {
      const p = frames[i - 1]!
      const gameDt = f.dt * f.speed
      f.rigs.forEach((r, k) => {
        const q = p.rigs[k]
        if (r.goalie || !r.visible || r.id === null || !q || q.id !== r.id || gameDt <= 0) return
        if (Math.abs(r.x) > 100 || Math.abs(r.z) > 42.5) return // on the bench
        maxSp = Math.max(maxSp, Math.hypot(r.x - q.x, r.z - q.z) / gameDt)
      })
    }
    const drop = idx[idx.length - 1]![0]
    // The dot it belongs on, in the PAINTED geometry: by the stoppage's rule
    // when the stream says what stopped play, else the painted dot nearest the
    // drawn puck (still: a puck dropped 9 ft off any painted dot is red).
    const want = fo.dot
      ? (() => { const d = dotXY(fo.dot, g); return { x: d.x, z: d.y, name: `${fo.dot.kind} (${d.x}, ${d.y})` } })()
      : painted.reduce((b, d) => (Math.hypot(drop.puck.x - d.x, drop.puck.z - d.z) < Math.hypot(drop.puck.x - b.x, drop.puck.z - b.z) ? d : b), painted[0]!)
    const puckOff = Math.hypot(drop.puck.x - want.x, drop.puck.z - want.z)
    const centres = [fo.actor, fo.target].filter((id): id is string => !!id)
    const centreOff = centres.map((id) => {
      const r = skaters(drop).find((q) => q.id === id && q.visible)
      return r ? Math.hypot(r.x - want.x, r.z - want.z) : NaN
    })
    const worstCentre = centreOff.length ? Math.max(...centreOff.map((d) => (Number.isFinite(d) ? d : 99))) : 0
    const inCircle = skaters(drop).filter((r) => r.visible && r.id !== null && Math.hypot(r.x - want.x, r.z - want.z) < 15).length
    const onDot = puckOff <= 2 && worstCentre <= 4
    if (!onDot) offDot++
    const ok = maxSp < 3 && inCircle <= 2 && onDot
    if (!ok) {
      bad++
      if (ev.length < 6) ev.push(`${clk(fo.absT)} faceoff for the ${want.name} dot: puck drawn ${f1(puckOff)} ft from it, centres ${centreOff.map(f1).join(' / ')} ft, ${inCircle} skaters inside the circle, fastest skater ${f1(maxSp)} ft/s in the last 0.5 s`)
    }
  }
  return {
    id: 'VT7', name: 'Faceoff set, on the right dot',
    status: judged === 0 ? 'n/a' : bad === 0 ? 'green' : 'red',
    rule: 'at the drop, on the PAINTED dot the stoppage calls for (NHL rule 76: zone and side): the drawn puck ≤ 2 ft from it and both centres ≤ 4 ft; ≤ 2 skaters inside its circle; every skater stationary (< 3 ft/s) for the last 0.5 s',
    value: `${judged - bad}/${judged} faceoffs set${offDot ? `, ${offDot} off the dot` : ''}`,
    evidence: ev,
  }
}

/* ── VT19 goal geometry ──────────────────────────────────────────────────── */
/**
 * Owner, reel S2 breakaway: "the puck went in from behind the net at
 * impossible angle". Every goal: the drawn puck crosses the goal line FROM IN
 * FRONT and BETWEEN THE POSTS on its way in (the engine's goalGeometry rule,
 * judged on what the screen drew).
 */
export function vt19GoalGeometry(inp: VTInput): VTResult {
  const ev: string[] = []
  let judged = 0
  let bad = 0
  for (const goal of inp.events.filter((e) => e.type === 'goal')) {
    const shot = [...inp.events].reverse().find((e) => e.type === 'shot' && e.absT <= goal.absT + 1e-6 && e.absT >= goal.absT - 3)
    if (!shot || shot.netX === undefined) continue
    const pts = inp.frames
      .filter((f) => f.clock >= shot.absT - 0.05 && f.clock <= goal.absT + 0.4 && f.playing && !inReplay(f))
      .map((f) => ({ t: f.clock, x: f.puck.x, y: f.puck.z }))
    if (pts.length < 3) continue
    judged++
    const r = crossesMouth(pts, shot.netX)
    if (!r.ok) {
      bad++
      if (ev.length < 5) ev.push(`${clk(goal.absT)} goal by ${goal.scorer ?? goal.actor}: the drawn puck ${r.why}`)
    }
  }
  return {
    id: 'VT19', name: 'Goals go in from the front, between the posts',
    status: judged === 0 ? 'n/a' : bad === 0 ? 'green' : 'red',
    rule: `every goal: the drawn puck crosses the goal line (x = ±${GOAL_GEOM.goalX}) from in front, within ${GOAL_GEOM.postY} ft of centre (+${GOAL_GEOM.postTolFt} ft)`,
    value: `${judged - bad}/${judged} goals in through the mouth`,
    evidence: ev,
  }
}

/* ── VT8 line changes through the door ───────────────────────────────────── */
export function vt8Changes(inp: VTInput): VTResult {
  const frames = inp.frames
  const brk = seekBreaks(frames)
  const gates = inp.geometry.benchGates
  const boxes = inp.geometry.penaltyBoxes
  const nearGate = (r: ProbeRig): boolean => {
    const g = gates[r.team]
    const b = boxes?.[r.team]
    return (Math.abs(r.x - g.x) <= 13 && Math.abs(r.z - g.z) <= 8) || (!!b && Math.abs(r.x - b.x) <= 8 && Math.abs(r.z - b.z) <= 8)
  }
  let changes = 0
  let bad = 0
  // W3 S4: a name plate on a man behind the boards (at the bench, hopping
  // over) floats above the dasher (reel S3 offsideCall: Hagens, Knies)
  let plates = 0
  let benchPlates = 0
  const ev: string[] = []
  frames.forEach((f, i) => {
    if (!isLive(f) || inReplay(f)) return
    for (const r of f.rigs) {
      if (!r.label || r.goalie) continue
      plates++
      if (Math.abs(r.z) > inp.geometry.rinkHalfW - LABEL_BOARDS_FT) {
        benchPlates++
        if (ev.length < 6 && benchPlates % 30 === 1) ev.push(`${clk(f.clock)} ${r.team} ${r.id}: name plate drawn on a man behind the boards (z ${f1(r.z)}, ${r.mode})`)
      }
    }
    if (i === 0 || brk[i]) return
    const p = frames[i - 1]!
    f.rigs.forEach((r, k) => {
      const q = p.rigs[k]
      if (r.goalie || !q) return
      // departure: the rig stops carrying a player
      if (q.id !== null && q.visible && r.id !== q.id) {
        changes++
        if (!nearGate(q)) {
          bad++
          if (ev.length < 6) ev.push(`${clk(f.clock)} ${q.team} ${q.id} vanished at (${f1(q.x)}, ${f1(q.z)}) — ${f1(Math.hypot(q.x - gates[q.team].x, q.z - gates[q.team].z))} ft from his door (was ${q.mode})`)
        }
      }
      // arrival: the rig starts carrying a player
      if (r.id !== null && r.visible && r.id !== q.id && (q.id === null || q.id !== r.id)) {
        changes++
        if (!nearGate(r) && Math.abs(r.z) <= 42.5) {
          bad++
          if (ev.length < 6) ev.push(`${clk(f.clock)} ${r.team} ${r.id} appeared at (${f1(r.x)}, ${f1(r.z)}) — not at his door`)
        }
      }
    })
  })
  return {
    id: 'VT8', name: 'Line changes through the door',
    status: changes === 0 && plates === 0 ? 'n/a' : bad === 0 && benchPlates === 0 ? 'green' : 'red',
    rule: `every departing / arriving man crosses within ~8 ft of his bench door (or the penalty box); none appear or vanish mid-ice; no name plate on a man behind the boards (|z| > half-width − ${LABEL_BOARDS_FT} ft)`,
    value: `${bad} violations in ${changes} rig hand-overs; ${benchPlates} of ${plates} name plates on men behind the boards`,
    evidence: ev,
  }
}

/* ── VT9 framing ─────────────────────────────────────────────────────────── */
/**
 * VT9 framing (W1; strict since W3 S7). On live broadcast frames:
 *  - the drawn puck inside the safe area (5% in from every screen edge) on ≥ 99%;
 *  - the carrier in the middle third on ≥ 90% of carried frames;
 *  - the pan never accelerates past the camera's limit (BROADCAST_LIMITS, +25%
 *    for the frame-timing noise of a finite difference): 0 samples over;
 *  - no cut in live play (a cut the renderer declares, or the look point
 *    jumping > 8 ft in one frame): 0;
 *  - board play is visible: with the puck within 7 ft of the near boards, the
 *    boards at the puck are in the frame and the near dasher is softened, ≥ 95%;
 *  - replays: the puck on screen on ≥ 95% of replay frames.
 * The acceleration, cut and board rules need the S7 probe fields (look point,
 * nearCut); older probes skip them.
 */
export const VT9_RULE = {
  safe: 0.05,
  puckSafe: 0.99,
  carrierMid: 0.9,
  panAmax: BROADCAST_LIMITS.pan.amax * 1.25,
  tiltAmax: BROADCAST_LIMITS.tilt.amax * 1.25,
  cutFt: 8,
  nearBoardsFt: 7,
  nearVisible: 0.95,
  replayOn: 0.95,
} as const

export function vt9Framing(inp: VTInput): VTResult {
  const R = VT9_RULE
  const half = inp.geometry.rinkHalfW
  let n = 0
  let puckSafe = 0
  let carried = 0
  let centred = 0
  let nearN = 0
  let nearOk = 0
  let replayN = 0
  let replayOn = 0
  let cuts = 0
  const ev: string[] = []
  // live broadcast runs (for the acceleration and the cuts)
  const runs: ProbeFrame[][] = []
  let run: ProbeFrame[] = []
  const endRun = (): void => {
    if (run.length) runs.push(run)
    run = []
  }
  for (const f of inp.frames) {
    if (inReplay(f) && f.playing) {
      replayN++
      if (f.puck.onScreen) replayOn++
    }
    if (!isLive(f) || inReplay(f) || f.cam.preset !== 'broadcast' || f.goalSeq !== null || f.dead) {
      endRun()
      continue
    }
    n++
    const mx = f.w * R.safe
    const my = f.h * R.safe
    if (f.puck.onScreen && f.puck.sx >= mx && f.puck.sx <= f.w - mx && f.puck.sy >= my && f.puck.sy <= f.h - my) puckSafe++
    else if (ev.length < 4) ev.push(`${clk(f.clock)} puck outside the safe area at (${f1(f.puck.x)}, ${f1(f.puck.z)}) → screen (${Math.round(f.puck.sx)}, ${Math.round(f.puck.sy)}) of ${f.w}×${f.h}`)
    const c = f.carrier ? f.rigs.find((r) => r.id === f.carrier && r.visible) : undefined
    if (c) {
      carried++
      if (c.onScreen && c.sx >= f.w / 3 && c.sx <= (2 * f.w) / 3) centred++
    }
    const cam = f.cam
    const nb = cam.lx !== undefined && cam.lz !== undefined ? nearBoardsPoint(f.puck.x, f.puck.z, inp.geometry.rinkHalfL, half) : null
    if (nb && nb.d <= R.nearBoardsFt) {
      nearN++
      const pose = { px: cam.x, py: cam.y, pz: cam.z, lx: cam.lx!, ly: cam.ly ?? 0, lz: cam.lz!, fov: cam.fov }
      const b = projectNdc(pose, f.w / f.h, nb.x, 0.3, nb.z)
      if (b.front && Math.abs(b.x) <= 1 && Math.abs(b.y) <= 1 && (cam.nearCut ?? 0) >= 0.5) nearOk++
      else if (ev.length < 8) ev.push(`${clk(f.clock)} board play at (${f1(f.puck.x)}, ${f1(f.puck.z)}): boards ${b.front && Math.abs(b.y) <= 1 ? 'in frame' : 'cropped'}, near boards softened ${f2(cam.nearCut ?? 0)}`)
    }
    if (run.length) {
      const p = run[run.length - 1]!
      const jumped = cam.lx !== undefined && p.cam.lx !== undefined && Math.hypot(cam.lx - p.cam.lx, (cam.lz ?? 0) - (p.cam.lz ?? 0)) > R.cutFt
      const seek = Math.abs(f.clock - p.clock) > SEEK_JUMP_S
      if (seek) endRun()
      else if (cam.cut || jumped) {
        cuts++
        if (ev.length < 8) ev.push(`${clk(f.clock)} camera cut in live play`)
        endRun()
      }
    }
    run.push(f)
  }
  endRun()
  // acceleration of the look point in game time, over ≥ 0.1 s windows
  let panMax = 0
  let tiltMax = 0
  let over = 0
  let accN = 0
  for (const r of runs) {
    if (r[0]!.cam.lx === undefined) continue
    const vs: Array<{ t: number; vx: number; vz: number }> = []
    let i = 0
    while (i < r.length) {
      let j = i + 1
      while (j < r.length && r[j]!.clock - r[i]!.clock < 0.1) j++
      if (j >= r.length) break
      const dtc = r[j]!.clock - r[i]!.clock
      vs.push({ t: (r[i]!.clock + r[j]!.clock) / 2, vx: (r[j]!.cam.lx! - r[i]!.cam.lx!) / dtc, vz: (r[j]!.cam.lz! - r[i]!.cam.lz!) / dtc })
      i = j
    }
    for (let k = 1; k < vs.length; k++) {
      const dtv = vs[k]!.t - vs[k - 1]!.t
      if (dtv <= 0) continue
      const ax = Math.abs(vs[k]!.vx - vs[k - 1]!.vx) / dtv
      const az = Math.abs(vs[k]!.vz - vs[k - 1]!.vz) / dtv
      accN++
      panMax = Math.max(panMax, ax)
      tiltMax = Math.max(tiltMax, az)
      if (ax > R.panAmax || az > R.tiltAmax) {
        over++
        if (ev.length < 8) ev.push(`${clk(vs[k]!.t)} pan ${f1(ax)} / tilt ${f1(az)} ft/s² (limit ${f1(R.panAmax)} / ${f1(R.tiltAmax)})`)
      }
    }
  }
  const pSafe = n ? puckSafe / n : 0
  const cMid = carried ? centred / carried : 1
  const nVis = nearN ? nearOk / nearN : 1
  const rOn = replayN ? replayOn / replayN : 1
  const ok = pSafe >= R.puckSafe && cMid >= R.carrierMid && over === 0 && cuts === 0 && nVis >= R.nearVisible && rOn >= R.replayOn
  return {
    id: 'VT9', name: 'Framing (broadcast camera)',
    status: n === 0 ? 'n/a' : ok ? 'green' : 'red',
    rule: `live broadcast frames: puck inside the safe area (${R.safe * 100}% margins) ≥ ${R.puckSafe * 100}%; carrier in the middle third ≥ ${R.carrierMid * 100}%; pan/tilt acceleration ≤ ${f1(R.panAmax)}/${f1(R.tiltAmax)} ft/s² (0 over); no cut in live play; board play (puck ≤ ${R.nearBoardsFt} ft from the near boards) framed with the boards in and softened ≥ ${R.nearVisible * 100}%; replays: puck on screen ≥ ${R.replayOn * 100}%`,
    value: `puck in the safe area ${(pSafe * 100).toFixed(1)}%; carrier in the middle third ${(cMid * 100).toFixed(1)}% (${carried} carried frames); max pan ${f1(panMax)} / tilt ${f1(tiltMax)} ft/s², ${over} of ${accN} over; ${cuts} live cuts; board play visible ${(nVis * 100).toFixed(1)}% (${nearN} frames); replay puck on screen ${(rOn * 100).toFixed(1)}% (${replayN} frames)`,
    evidence: ev,
  }
}

/* ── VT10 commentary truth ───────────────────────────────────────────────── */
const MOMENT_FACT: Array<[RegExp, string[]]> = [
  [/^goal/i, ['goal']],
  [/^(save|stop)/i, ['save']],
  [/^(shot|miss|post)/i, ['shot', 'missedShot', 'save', 'goal', 'blockedShot']],
  [/^hit/i, ['hit']],
  [/^penalt/i, ['penalty']],
  [/^faceoff/i, ['faceoff']],
]
export function vt10Commentary(inp: VTInput): VTResult {
  let judged = 0
  let bad = 0
  const ev: string[] = []
  for (const c of inp.cues) {
    const rule = MOMENT_FACT.find(([re]) => re.test(c.moment))
    if (!rule) continue
    judged++
    const facts = inp.events.filter((e) => rule[1].includes(e.type) && e.absT >= c.at - 4 && e.absT <= c.at + 1.5)
    let ok = facts.length > 0
    if (ok && /^goal/i.test(c.moment) && c.playerId) ok = facts.some((e) => e.scorer === c.playerId)
    if (!ok) {
      bad++
      if (ev.length < 6) ev.push(`${clk(c.at)} '${c.moment}': "${c.text.slice(0, 80)}" — no matching ${rule[1].join('/')} fact`)
    }
  }
  return {
    id: 'VT10', name: 'Commentary truth',
    status: judged === 0 ? 'n/a' : bad === 0 ? 'green' : 'red',
    rule: 'every fired booth line\'s claim (goal / save / shot / hit / penalty, and the named scorer) matches the stream within 4 s',
    value: `${bad} contradictions in ${judged} checkable lines`,
    evidence: ev,
  }
}

/* ── VT11 hits: visible contact, and the hit man moves with the hit ──────── */
export const VT11 = { chestGapFt: 4, meetFt: 3 } as const
export function vt11Hits(inp: VTInput): VTResult {
  const frames = inp.frames
  let judged = 0
  let bad = 0
  let chestJudged = 0
  const gaps: number[] = []
  const meets: number[] = []
  const ev: string[] = []
  for (const h of inp.events.filter((e) => e.type === 'hit' && e.actor && e.target)) {
    const at = frames.findIndex((f) => f.clock >= h.absT && isLive(f) && !inReplay(f))
    if (at < 1) continue
    const f = frames[at]!
    const hitter = f.rigs.find((r) => r.id === h.actor && r.visible)
    const tgt = f.rigs.find((r) => r.id === h.target && r.visible)
    if (!hitter || !tgt) continue
    // the drawn bodies at contact: shoulder to shoulder, not a man falling on his own
    const gap = Math.hypot(hitter.x - tgt.x, hitter.z - tgt.z)
    // after the hit: the hit man's drawn travel over 0.4 game-s must not keep
    // going INTO the hitter's push direction's opposite (sliding on through the check)
    const later = frames.find((g, j) => j > at && g.clock >= h.absT + 0.4)
    const tl = later?.rigs.find((r) => r.id === h.target)
    const hl = later?.rigs.find((r) => r.id === h.actor)
    let along = 0
    let rel = 0
    let simAlong = NaN
    if (tl) {
      const px = tgt.x - hitter.x
      const pz = tgt.z - hitter.z
      const n = Math.hypot(px, pz) || 1
      along = ((tl.x - tgt.x) * px + (tl.z - tgt.z) * pz) / n
      // (W3 S4) and relative to the hitter: a man rubbed out along the wall
      // travels WITH the man finishing the check; what reads wrong is closing on him
      rel = hl ? along - ((hl.x - hitter.x) * px + (hl.z - hitter.z) * pz) / n : along
      if (tl.simX !== null && tgt.simX !== null && tl.simZ !== null && tgt.simZ !== null) simAlong = ((tl.simX - tgt.simX) * px + (tl.simZ - tgt.simZ) * pz) / n
    }
    // (hit physics) the drawn BODIES meet at the sim's contact point: the two
    // chests close together, their midpoint on the engine's contact (optional
    // fields: older probes have no chests / contacts and skip this part)
    const con = f.contacts?.find((c) => c.by === h.actor && c.on === h.target && Math.abs(c.t - h.absT) < 0.05)
    let chestGap = NaN
    let meetOff = NaN
    if (con && hitter.chest && tgt.chest) {
      chestGap = Math.hypot(hitter.chest.x - tgt.chest.x, hitter.chest.z - tgt.chest.z)
      meetOff = Math.hypot((hitter.chest.x + tgt.chest.x) / 2 - con.x, (hitter.chest.z + tgt.chest.z) / 2 - con.z)
      chestJudged++
    }
    const bodiesMeet = !(chestGap > VT11.chestGapFt || meetOff > VT11.meetFt)
    judged++
    const ok = gap <= 4.5 && (along >= -0.5 || rel >= -0.5) && bodiesMeet
    if (!ok) {
      bad++
      if (ev.length < 5) ev.push(`${clk(h.absT)} ${h.actor} → ${h.target}${h.knockdown ? ' (knockdown)' : ''}: drawn ${f1(gap)} ft apart at contact (chests ${f1(chestGap)} ft, meeting ${f1(meetOff)} ft off the sim's contact); hit man moved ${f1(along)} ft along the push in 0.4 s (sim: ${f1(simAlong)})`)
    }
    if (Number.isFinite(chestGap)) { gaps.push(chestGap); meets.push(meetOff) }
  }
  return {
    id: 'VT11', name: 'Hits: visible contact, reaction with the push',
    status: judged === 0 ? 'n/a' : bad === 0 ? 'green' : 'red',
    rule: `at the hit the drawn hitter and target are ≤ 4.5 ft apart, their chests ≤ ${VT11.chestGapFt} ft apart and meeting ≤ ${VT11.meetFt} ft from the sim's contact point, and the target does not slide on against the push in the next 0.4 s (over the ice and toward the hitter both)`,
    value: `${judged - bad}/${judged} hits read; chests at contact p50 ${f2(pct(gaps, 0.5))} ft apart, meeting p50 ${f2(pct(meets, 0.5))} / max ${f2(meets.length ? Math.max(...meets) : NaN)} ft off the contact (${chestJudged} judged)`,
    evidence: ev,
  }
}

/* ── W3 team play: VT13 aimless, VT14 coverage, VT16 crease camping ──────── */
// The rules live in @engine/analysis/teamPlay (the same geometry judges the
// sim stream in the vitest gates); here they read what the screen DREW.

/** Drawn frames → the neutral team-play snapshot (world feet: x along the rink, z across). */
export function teamPlayFrames(inp: VTInput): TPFrame[] {
  const out: TPFrame[] = []
  let homeNetX = 0
  for (const f of inp.frames) {
    const hg = f.rigs.find((r) => r.goalie && r.team === 'home' && r.visible)
    if (hg && Math.abs(hg.x) > 60) homeNetX = hg.x > 0 ? 89 : -89
    const on = (r: ProbeRig): boolean => !r.goalie && r.id !== null && r.visible && Math.abs(r.x) <= inp.geometry.rinkHalfL && Math.abs(r.z) <= inp.geometry.rinkHalfW
    const sk = (team: 'home' | 'away') => f.rigs.filter((r) => r.team === team && on(r)).map((r) => ({ id: r.id!, x: r.x, y: r.z }))
    out.push({
      t: f.clock,
      live: isLive(f) && !inReplay(f) && !f.dead && f.goalSeq === null,
      home: sk('home'),
      away: sk('away'),
      homeNetX,
      puck: { x: f.puck.x, y: f.puck.z },
      carrier: f.carrier,
    })
  }
  return out
}

const tpCache = new WeakMap<VTInput, TPReport>()
function teamPlayOf(inp: VTInput): TPReport {
  let r = tpCache.get(inp)
  if (!r) {
    const g = inp.geometry.benchGates
    r = judgeTeamPlay(teamPlayFrames(inp), { gates: [{ x: g.home.x, y: g.home.z }, { x: g.away.x, y: g.away.z }] })
    tpCache.set(inp, r)
  }
  return r
}

/** Per-clip limits (cases per live minute on screen); design confidence, set from the W3 S1 stream runs. */
export const VT_TEAMPLAY = { aimlessPerMin: 0.5, coveragePerMin: 0.1, campingPerMin: 0 }

export function vt13Aimless(inp: VTInput): VTResult {
  const r = teamPlayOf(inp)
  const rate = r.liveMin > 0 ? r.aimless.length / r.liveMin : 0
  return {
    id: 'VT13', name: 'Aimless: standing still in a dangerous area',
    status: r.liveMin < 1 / 60 ? 'n/a' : rate <= VT_TEAMPLAY.aimlessPerMin ? 'green' : 'red',
    rule: `live 5v5: a non-carrier standing (within ${TP.stillR} ft) ≥ ${TP.stillS} s inside a home plate, no opponent within ${TP.engagedFt} ft, the puck ≥ ${TP.puckNearFt} ft away, not screening, not the net-front guard (a defender within ${TP.netGuardFt} ft of his own net), not a defender in the lane of an attacker within ${TP.laneManFt} ft — ≤ ${VT_TEAMPLAY.aimlessPerMin} per live minute`,
    value: `${r.aimless.length} cases in ${f1(r.liveMin * 60)} live s (${f2(rate)}/min; ${r.aimlessOwn} in front of his own net)`,
    evidence: r.aimless.slice(0, 5).map((c) => c.what),
  }
}

export function vt14Coverage(inp: VTInput): VTResult {
  const r = teamPlayOf(inp)
  const n = r.doubles.length + r.farSide.length + r.ignored.length
  const rate = r.liveMin > 0 ? n / r.liveMin : 0
  return {
    id: 'VT14', name: 'Coverage: one man per attacker, nobody out of the play',
    status: r.liveMin < 1 / 60 ? 'n/a' : rate <= VT_TEAMPLAY.coveragePerMin ? 'green' : 'red',
    rule: `defending, sustained: two men within ${TP.doubleFt} ft of the carrier while a slot attacker is open (≥ ${TP.sustainS} s); a defender on the far boards ≥ ${TP.farPuckFt} ft from the puck with nobody to cover (≥ 1 s); the closest man within ${TP.ignoreFt} ft of the carrier, not goal-side of him and not closing (≥ ${TP.ignoreS} s) — ≤ ${VT_TEAMPLAY.coveragePerMin} per live minute`,
    value: `doubles ${r.doubles.length} · far side ${r.farSide.length} · ignored carrier ${r.ignored.length} in ${f1(r.liveMin * 60)} live s`,
    evidence: [...r.doubles, ...r.farSide, ...r.ignored].slice(0, 5).map((c) => c.what),
  }
}

export function vt16Camping(inp: VTInput): VTResult {
  const r = teamPlayOf(inp)
  return {
    id: 'VT16', name: 'Crease camping (carrier)',
    status: r.liveMin < 1 / 60 ? 'n/a' : r.camping.length <= VT_TEAMPLAY.campingPerMin * r.liveMin ? 'green' : 'red',
    rule: `no carrier holds the puck inside the inner home plate (out to the dots) for more than ${TP.creaseCampS} s`,
    value: `${r.camping.length} cases in ${f1(r.liveMin * 60)} live s`,
    evidence: r.camping.slice(0, 5).map((c) => c.what),
  }
}

/* ── VT15 system legibility (W3 S4) ───────────────────────────────────────── */
// The same classifier as the stream gate (@engine/analysis/systemPlay), run on
// what the screen DREW: each team's forecheck and D-zone coverage read off the
// drawn bodies, against the play the sim declared (the frames' homeSystem /
// awaySystem, handed to the probe as 'system' events). Breakouts need the pass
// events, so they are judged on the stream only.
export const VT15 = { familyShare: 0.6, minSeq: 2 } as const
export function vt15Systems(inp: VTInput): VTResult {
  const labels = inp.events.filter((e) => e.type === 'system' && (e.actor === 'home' || e.actor === 'away') && e.detail)
  const at = (team: 'home' | 'away', t: number): string | undefined => {
    let cur: string | undefined
    for (const e of labels) {
      if (e.absT > t + 1e-6) break
      if (e.actor === team) cur = e.detail === '-' ? undefined : e.detail
    }
    return cur
  }
  const frames: SysFrame[] = teamPlayFrames(inp).map((f) => ({ ...f, homeSystem: at('home', f.t), awaySystem: at('away', f.t) }))
  const rep = judgeSystems(frames)
  const ev: string[] = []
  const vals: string[] = []
  let judged = 0
  let red = false
  for (const team of ['home', 'away'] as const) {
    for (const k of ['forecheck', 'dzone'] as const) {
      const l = legibility(rep[team][k] as SeqCase<string>[])
      if (l.judged === 0) continue
      vals.push(`${team} ${k} ${l.matched}/${l.judged} ${Object.keys(l.table).join('/')}`)
      if (l.judged < VT15.minSeq) continue
      judged++
      if (l.share < VT15.familyShare) {
        red = true
        if (ev.length < 5) ev.push(`${team} declared ${Object.keys(l.table).join('/')} but the picture reads ${JSON.stringify(Object.values(l.table)[0])}`)
      }
    }
  }
  return {
    id: 'VT15', name: 'System legibility: the drawn forecheck and D-zone match the declared system',
    status: labels.length === 0 || judged === 0 ? 'n/a' : red ? 'red' : 'green',
    rule: `per team, the forecheck (2-1-2 / 1-2-2 pressure vs 1-3-1 / 1-4 sitting back, read off the drawn bodies) and the D-zone coverage (zone / man / collapse) match the play the sim declared on ≥ ${VT15.familyShare * 100}% of sequences (judged with ≥ ${VT15.minSeq})`,
    value: vals.join('; ') || 'no sequences',
    evidence: ev,
  }
}

/* ── VT17 stick grip: no lance, the carrier's blade on the ice ────────────── */
/** Limits (share of skater-frames on live play, outside swing clips). */
/**
 * W3 S4 adds the carried puck's truth: drawn within `puckSimFt` of the sim's
 * puck on `puckSimShare` of carried frames (it rode the drawn blade 2.5-3.8 ft
 * off it on reel S3, VT18), and the carrier's blade within `bladeGapFt` of the
 * drawn puck on `bladeGapShare` of his frames (the blade bends to the puck).
 * Measured on reel S4: 71-89% (it was 31-39% before the blade bent to it). What
 * is left: the sim carries the puck 2.3 ft ahead of the body, nearer than the
 * owner rigs' 5.6 ft stick reaches with both hands on it, and the blend after
 * a reception. The bound is the measured floor, not a target.
 */
export const VT17 = { carrierLance: 0.01, allLance: 0.02, carrierBladeOff: 0.05, bladeOffFt: 0.25, puckSimFt: 1, puckSimShare: 0.95, bladeGapFt: 1, bladeGapShare: 0.65 } as const
export function vt17Grip(inp: VTInput): VTResult {
  let carrier = 0
  let carrierLance = 0
  let carrierOff = 0
  let all = 0
  let allLance = 0
  let carried = 0
  let puckOff = 0
  let gapped = 0
  let gapOff = 0
  const puckD: number[] = []
  const ev: string[] = []
  for (const f of inp.frames) {
    if (!isLive(f) || f.dead || inReplay(f)) continue
    if (f.carrier && !f.windup && f.goalSeq === null && Number.isFinite(f.puck.simX)) {
      const d = Math.hypot(f.puck.x - f.puck.simX, f.puck.z - f.puck.simZ)
      carried++
      puckD.push(d)
      if (d > VT17.puckSimFt) {
        puckOff++
        if (ev.length < 5 && puckOff % 25 === 1) ev.push(`${clk(f.clock)} ${f.carrier}: carried puck drawn ${f2(d)} ft from the sim's`)
      }
    }
    for (const r of skaters(f)) {
      if (r.grip?.carrying && r.grip.puckGap !== undefined && Number.isFinite(r.grip.puckGap) && !r.grip.swing && r.visible && r.mode === 'play') {
        gapped++
        if (r.grip.puckGap > VT17.bladeGapFt) gapOff++
      }
      const g = r.grip
      if (!g || !r.visible || !r.onScreen || r.mode !== 'play' || g.swing) continue
      all++
      if (g.lance) allLance++
      if (g.carrying) {
        carrier++
        if (g.lance) carrierLance++
        if (g.bladeY > VT17.bladeOffFt) carrierOff++
      }
      if ((g.lance || (g.carrying && g.bladeY > VT17.bladeOffFt)) && ev.length < 5 && !ev.some((e) => e.startsWith(`${clk(f.clock)} ${r.id}`))) {
        ev.push(`${clk(f.clock)} ${r.id}: ${g.lance ? 'lance (one hand, stick thrust out in front)' : `blade ${f2(g.bladeY)} ft off the ice`}${g.carrying ? ' with the puck' : ''} [grip ${g.state}]`)
      }
    }
  }
  const s = (a: number, b: number) => (b ? a / b : 0)
  const red =
    s(carrierLance, carrier) > VT17.carrierLance ||
    s(allLance, all) > VT17.allLance ||
    s(carrierOff, carrier) > VT17.carrierBladeOff ||
    (carried > 0 && 1 - s(puckOff, carried) < VT17.puckSimShare) ||
    (gapped > 0 && 1 - s(gapOff, gapped) < VT17.bladeGapShare)
  return {
    id: 'VT17', name: 'Stick grip: no lance, the carried puck on a blade on the ice',
    status: all === 0 ? 'n/a' : red ? 'red' : 'green',
    rule: `outside action clips (shot, pass, deke, poke, the draw, checks and hit reactions, celebrations): the lance pose (bottom hand > 0.5 ft off the shaft, top hand 2–5.2 ft high, the stick straight out in front: blade ≥ 2.5 ft ahead of the hand and ≥ 1.5× as far ahead as to the side) on ≤ ${VT17.carrierLance * 100}% of carrier frames and ≤ ${VT17.allLance * 100}% of all skater frames; the carrier's blade > ${VT17.bladeOffFt} ft off the ice on ≤ ${VT17.carrierBladeOff * 100}% of his frames; the carried puck drawn within ${VT17.puckSimFt} ft of the sim's on ≥ ${VT17.puckSimShare * 100}% of carried frames, and the carrier's blade within ${VT17.bladeGapFt} ft of it on ≥ ${VT17.bladeGapShare * 100}% of his frames`,
    value: `carrier ${carrier} fr: lance ${(s(carrierLance, carrier) * 100).toFixed(1)}%, blade off ice ${(s(carrierOff, carrier) * 100).toFixed(1)}%; all skaters ${all} fr: lance ${(s(allLance, all) * 100).toFixed(1)}%; carried puck vs sim p50 ${f2(pct(puckD, 0.5))} ft, ${(s(carried - puckOff, carried) * 100).toFixed(1)}% within ${VT17.puckSimFt} ft; blade on the puck ${gapped ? (s(gapped - gapOff, gapped) * 100).toFixed(1) : '-'}% within ${VT17.bladeGapFt} ft`,
    evidence: ev,
  }
}

/* ── VT12 action floor: the drawn wind-up is the sim's (W3 S2) ───────────── */
// Every shot the sim wound up (windupS, constraints.ts) is drawn winding up for
// at least its shot type's row of GAME time - the renderer may not shorten the
// set the defence had to close on. (The stream half of VT12 - every act on the
// frames held to its floor, every contact pair in range - is gated in
// agentSim.test via @engine/analysis/actions.)
export function vt12ActionFloor(inp: VTInput): VTResult {
  const frames = inp.frames
  const ev: string[] = []
  let judged = 0
  let bad = 0
  const drawn: number[] = []
  for (const s of inp.events) {
    if ((s.type !== 'shot' && s.type !== 'missedShot') || s.windupS === undefined || !s.actor) continue
    const type = (s.shotType ?? 'wrist') as keyof typeof ACTION_FLOOR.shot.windup
    const need = ACTION_FLOOR.shot.windup[type] ?? 0
    if (need <= 0) continue
    const near = frames.filter((f) => f.clock >= s.absT - 1.5 && f.clock <= s.absT + 0.05 && isLive(f) && !inReplay(f))
    // only shots the recording played through live from before the wind-up
    if (near.length < 10 || near[0]!.clock > s.absT - need - 0.2) continue
    let game = 0
    for (const f of near) if (f.clock <= s.absT + 1e-6 && f.windup === s.actor) game += f.dt * f.speed
    judged++
    drawn.push(game)
    // one drawn frame of slack at the playback speed
    if (game < need - 0.05) {
      bad++
      if (ev.length < 6) ev.push(`${clk(s.absT)} ${s.shotType ?? 'shot'} by ${s.actor}: drawn wind-up ${f2(game)} game-s, the sim wound up ${f2(s.windupS)} s (row ${need} s)`)
    }
  }
  return {
    id: 'VT12', name: 'Action floor (drawn wind-up)',
    status: judged === 0 ? 'n/a' : bad === 0 ? 'green' : 'red',
    rule: 'every shot the sim wound up is drawn winding up (puck on the blade, the set) for at least the row for its shot type in constraints.ts, in game time',
    value: `${judged - bad}/${judged} wind-ups drawn in full; median ${f2(pct(drawn, 0.5))} game-s`,
    evidence: ev,
  }
}

/* ── VT18 offside: an attacker over the line ahead of the puck, no whistle ── */
// Owner, reel S1 ozCycleShot: "he was offside". Judged on the DRAWN blue line
// (1 ft wide on ±25 ft), drawn bodies and the drawn puck; the rules live in
// @engine/analysis/offside (the same judge gates the sim stream).
export function vt18Offside(inp: VTInput): VTResult {
  const whistles = inp.events.filter((e) => e.type === 'whistle').map((e) => ({ t: e.absT, ...(e.reason ? { reason: e.reason } : {}) }))
  // touches the frames can't show: a poke, a block, a save, a tie-up won (the defenders put it in: nobody offside)
  const goalieTeam = new Map<string, 'home' | 'away'>()
  for (const f of inp.frames) for (const r of f.rigs) if (r.goalie && r.id !== null) goalieTeam.set(r.id, r.team)
  const touches = inp.events
    .filter((e) => e.actor !== undefined && ((e.type === 'pokeCheck' && e.success) || e.type === 'blockedShot' || e.type === 'save' || e.type === 'battle' || e.type === 'puckTouch'))
    .map((e) => {
      const team = goalieTeam.get(e.actor!)
      return team ? { t: e.absT, team } : { t: e.absT, id: e.actor! }
    })
  const r = judgeOffside(teamPlayFrames(inp), whistles, touches)
  return {
    id: 'VT18', name: 'Offside: no attacker enters ahead of the puck unwhistled',
    status: r.entries === 0 ? 'n/a' : r.missed.length === 0 ? 'green' : 'red',
    rule: `a zone entry the attackers propelled, with a team-mate's body > ${OFFSIDE.manOverFt} ft past the line's centre when the puck completely crossed: carried in → a whistle within ${OFFSIDE.whistleS} s; passed / shot / chipped in → no attacker touches it in the zone before every attacker tags up, without a whistle`,
    value: `${r.missed.length} missed calls in ${r.entries} entries (${r.offsideEntries} with a man offside, ${r.whistles} offside whistles)`,
    evidence: r.missed.slice(0, 5).map((c) => c.what),
  }
}

/* ── VT22 fights: the pair drawn together, everyone else off them, the camera in ── */
/** A fight on screen (fight.ts / fightChoreo.ts): locked-on men within this of each other … */
export const VT_FIGHT = { pairFt: 5, clearFt: 6, camFt: 45, badShare: 0.1 }
export function vt22Fights(inp: VTInput): VTResult {
  let judged = 0
  let bad = 0
  let camIn = 0
  let camN = 0
  const ev: string[] = []
  for (const e of inp.events) {
    if (e.type !== 'fight' || !e.actor || !e.target || e.fightGrab === undefined || e.fightSep === undefined) continue
    for (const f of inp.frames) {
      if (inReplay(f) || f.clock < e.fightGrab + 1 || f.clock > e.fightSep) continue
      const h = f.rigs.find((r) => r.id === e.actor && r.visible)
      const a = f.rigs.find((r) => r.id === e.target && r.visible)
      if (!h || !a) continue
      judged++
      const gap = Math.hypot(h.x - a.x, h.z - a.z)
      const mx = (h.x + a.x) / 2
      const mz = (h.z + a.z) / 2
      const crowd = f.rigs.filter((r) => !r.goalie && r.visible && r.id !== null && r !== h && r !== a && Math.hypot(r.x - mx, r.z - mz) < VT_FIGHT.clearFt)
      if (f.cam.preset === 'broadcast') {
        camN++
        if (Math.hypot(f.cam.x - mx, f.cam.z - mz) <= VT_FIGHT.camFt) camIn++
      }
      if (gap > VT_FIGHT.pairFt || crowd.length > 0) {
        bad++
        if (ev.length < 5) ev.push(`${clk(f.clock)} fighters drawn ${f1(gap)} ft apart${crowd.length ? `, ${crowd.length} other skater(s) within ${VT_FIGHT.clearFt} ft` : ''}`)
      }
    }
  }
  const camOk = camN === 0 || camIn / camN >= 0.8
  if (!camOk && ev.length < 5) ev.push(`camera within ${VT_FIGHT.camFt} ft of the fight on ${camIn}/${camN} broadcast frames`)
  return {
    id: 'VT22', name: 'Fights: the pair together, the rest off them, the camera in',
    status: judged === 0 ? 'n/a' : bad / judged <= VT_FIGHT.badShare && camOk ? 'green' : 'red',
    rule: `from a second after the grab until the linesmen part them, the two fighters are drawn ≤ ${VT_FIGHT.pairFt} ft apart with no other skater within ${VT_FIGHT.clearFt} ft (≤ ${VT_FIGHT.badShare * 100}% of frames off), and the broadcast camera sits within ${VT_FIGHT.camFt} ft of them on ≥ 80% of frames`,
    value: `${judged - bad}/${judged} frames held; camera in ${camIn}/${camN}`,
    evidence: ev,
  }
}

/* ── W3 S6: VT20 puck speed and continuity, VT21 the loose puck is played ── */
// Owner: "puck is zipping around too fast", "skate through the puck",
// "players ignoring a puck right in front of them". The rules live in
// @engine/analysis/puckPlay (the same judge gates the sim stream); here they
// read the DRAWN puck and bodies, resampled to >= 0.1 s of game time.
// (outsideFt: the sim keeps the puck's centre 0.3 ft inside the boards and the drawn puck
// rides the kickplate; past 1 ft it is drawn through the boards)
export const VT_PUCK = { stepS: 0.1, cornerR: 28, outsideFt: 1 } as const
function puckPlayInput(inp: VTInput): { frames: PPFrame[]; events: PPEvent[]; outside: string[] } {
  const brk = seekBreaks(inp.frames)
  const frames: PPFrame[] = []
  const outside: string[] = []
  const L = inp.geometry.rinkHalfL
  const W = inp.geometry.rinkHalfW
  let last = -Infinity
  inp.frames.forEach((f, i) => {
    const live = isLive(f) && !inReplay(f) && !f.dead && f.goalSeq === null
    if (live) {
      // the drawn puck inside the boards (a rounded rectangle)
      const ax = Math.abs(f.puck.x)
      const az = Math.abs(f.puck.z)
      const cx = L - VT_PUCK.cornerR
      const cz = W - VT_PUCK.cornerR
      const out = ax > cx && az > cz ? Math.hypot(ax - cx, az - cz) - VT_PUCK.cornerR : Math.max(ax - L, az - W)
      if (out > VT_PUCK.outsideFt && outside.length < 5) outside.push(`${clk(f.clock)} puck drawn ${f1(out)} ft outside the boards at (${f1(f.puck.x)}, ${f1(f.puck.z)})`)
    }
    if (brk[i]) last = -Infinity
    if (f.clock - last < VT_PUCK.stepS && !brk[i]) return
    last = f.clock
    frames.push({
      t: f.clock,
      live: live && !brk[i],
      puck: { x: f.puck.x, y: f.puck.z, z: f.puck.y },
      carrier: f.carrier,
      // (the drawn stick: a swing playing is a stick on the puck - a pass, a dump or a rim has no
      // event of its own - and a man drawn carrying has it on his blade)
      skaters: f.rigs.filter((r) => !r.goalie && r.visible && r.id !== null && r.mode === 'play').map((r) => ({ id: r.id!, team: r.team, x: r.x, y: r.z, ...(r.grip?.swing ? { act: 'pass' } : {}), ...(r.grip?.carrying ? { job: 'carry' } : {}) })),
    })
  })
  const events: PPEvent[] = inp.events.map((e) => ({ t: e.absT, type: e.type, ...(e.speed !== undefined ? { speed: e.speed } : {}) }))
  return { frames, events, outside }
}
const ppCache = new WeakMap<VTInput, { r: PuckPlayReport; outside: string[] }>()
function puckPlayOf(inp: VTInput): { r: PuckPlayReport; outside: string[] } {
  let c = ppCache.get(inp)
  if (!c) {
    const pi = puckPlayInput(inp)
    c = { r: judgePuckPlay(pi.frames, pi.events), outside: pi.outside }
    ppCache.set(inp, c)
  }
  return c
}
export function vt20PuckSpeed(inp: VTInput): VTResult {
  const { r, outside } = puckPlayOf(inp)
  const n = r.overCap.length + r.gained.length + r.reboundFast.length + outside.length
  return {
    id: 'VT20', name: 'Puck speed and continuity (drawn)',
    status: r.intervals === 0 ? 'n/a' : n === 0 ? 'green' : 'red',
    rule: `between drawn frames (≥ ${VT_PUCK.stepS} s game time) the puck moves no faster than the action that sent it (shot ≤ ${PUCK_SPEED.shot}, pass / rim / loose ≤ ${PUCK_SPEED.pass}, carried ≤ ${PUCK_SPEED.carried} ft/s, + ${PUCK_PLAY_RULE.slackFt} ft); a free puck with no stick on it never speeds up (> ${PUCK_PLAY_RULE.gainFtS} ft/s); a rebound or a block leaves at ≤ ${PUCK_PLAY_RULE.reboundShare} × the shot + ${PUCK_PLAY_RULE.reboundSlack} ft/s; the drawn puck never outside the boards`,
    value: `${r.overCap.length} over the cap, ${r.gained.length} sped up, ${r.reboundFast.length} rebounds too fast, ${outside.length} outside the boards in ${r.intervals} intervals; fastest free ${f1(r.maxSpeed.free)}, shot ${f1(r.maxSpeed.shot)}, carried ${f1(r.maxSpeed.carried)} ft/s`,
    evidence: [...r.overCap, ...r.gained, ...r.reboundFast].slice(0, 5).map((c) => c.what).concat(outside).slice(0, 6),
  }
}
export function vt21LoosePuck(inp: VTInput): VTResult {
  const { r } = puckPlayOf(inp)
  return {
    id: 'VT21', name: 'The loose puck is played (drawn)',
    status: r.intervals === 0 ? 'n/a' : r.skateThrough.length + r.ignored.length === 0 ? 'green' : 'red',
    rule: `no drawn skater passes within ${PUCK_PLAY_RULE.throughFt} ft of a free puck's path while it carries on unchanged; no slow (< ${PUCK_PLAY_RULE.slowFtS} ft/s) free puck sits within ${PUCK_PLAY_RULE.nearFt} ft of the nearest man, uncontested (nobody of theirs within ${PUCK_PLAY_RULE.contestFt} ft) and not closing on it, for ≥ ${PUCK_PLAY_RULE.ignoreS} s`,
    value: `${r.skateThrough.length} skated through, ${r.ignored.length} ignored in ${f1(r.liveMin * 60)} live s`,
    evidence: [...r.skateThrough, ...r.ignored].slice(0, 5).map((c) => c.what),
  }
}

export const DETECTORS = [vt1Bodies, vt2Divergence, vt3Shots, vt4Motion, vt5Replay, vt6Clocks, vt7Faceoffs, vt8Changes, vt9Framing, vt10Commentary, vt11Hits, vt12ActionFloor, vt13Aimless, vt14Coverage, vt15Systems, vt16Camping, vt17Grip, vt18Offside, vt19GoalGeometry, vt20PuckSpeed, vt21LoosePuck, vt22Fights] as const


export function runViewerTruth(inp: VTInput): VTResult[] {
  return DETECTORS.map((d) => d(inp))
}
