/**
 * Viewer-truth detectors VT1–VT10 (docs/gameplan-2026-09-28/ROOT-CAUSES.md §2.1).
 *
 * Each detector judges what the real match screen DREW (viewerProbe frames,
 * recorded from the built app at the owner's settings), not the sim stream.
 * Pure functions: frames + a compact event list in, one red/green line each out.
 * A new visible bug class earns a detector here BEFORE its fix is written.
 */
import type { ProbeFrame, ProbeGeometry, ProbeRig } from './viewerProbe'

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
    if (!isLive(f)) continue
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
    rule: `visible + on screen + within ${NEAR_RINK_FT} ft of the sheet ≤ 6 per team (7 with an extra attacker) on 99.9% of live frames`,
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
      if (declared) continue
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
    // only shots the recording actually played through live (continuous, not a replay)
    const near = frames.filter((f) => f.clock >= s.absT - 3 && f.clock <= s.absT + 1.5 && isLive(f) && !inReplay(f))
    if (near.length < 10 || near[0]!.clock > s.absT - 1 || near[near.length - 1]!.clock < s.absT + 0.3) continue
    const arrival = inp.events.find((e) => e.absT >= s.absT && e.absT <= s.absT + 1.5 && (e.type === 'save' || e.type === 'goal' || e.type === 'blockedShot'))
    const arriveT = arrival ? arrival.absT : s.absT + 0.4
    let setup = 0
    for (const f of near) if (f.clock <= s.absT && f.windup === s.actor) setup += f.dt
    const flightFrames = near.filter((f) => f.clock >= s.absT && f.clock < arriveT)
    const flightWall = flightFrames.reduce((a, f) => a + f.dt, 0)
    // frames on a 60 Hz display (the off-screen probe window may render faster)
    const flight60 = flightWall * 60
    const need = s.shotType === 'slap' ? 0.6 : 0.3
    judged++
    setups.push(setup)
    flights.push(flight60)
    const ok = setup >= need && flight60 >= 3
    if (!ok) {
      failed++
      if (ev.length < 6) ev.push(`${clk(s.absT)} ${s.shotType ?? 'shot'} by ${s.actor}: set-up ${f2(setup)} s wall (need ${need}), flight ${f2(flightWall)} s wall (${f1(flight60)} frames @60 Hz) at ${f2(near[0]!.speed)}×`)
    }
  }
  return {
    id: 'VT3', name: 'Shot readability (wall time)',
    status: judged === 0 ? 'n/a' : failed / judged <= 0.1 ? 'green' : 'red',
    rule: 'set-up ≥ 0.3 s wall (slap ≥ 0.6 s) and puck in flight ≥ 3 frames at 60 Hz (0.05 s wall), for ≥ 90% of shots',
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
    for (const f of live) if (f.goalSeqT !== null && f.clock >= g.goalAbsT) drift = Math.max(drift, Math.abs(f.goalSeqT - (f.clock - g.goalAbsT)))
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
  const frames = inp.frames
  const brk = seekBreaks(frames)
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
    const inCircle = fo.x !== undefined && fo.z !== undefined
      ? skaters(drop).filter((r) => r.visible && r.id !== null && Math.hypot(r.x - fo.x!, r.z - fo.z!) < 15).length
      : 0
    const ok = maxSp < 3 && inCircle <= 2
    if (!ok) {
      bad++
      if (ev.length < 5) ev.push(`${clk(fo.absT)} faceoff: fastest skater ${f1(maxSp)} ft/s in the last 0.5 s, ${inCircle} skaters inside the circle at the drop`)
    }
  }
  return {
    id: 'VT7', name: 'Faceoff set',
    status: judged === 0 ? 'n/a' : bad === 0 ? 'green' : 'red',
    rule: 'at the drop ≤ 2 skaters inside the circle and every skater stationary (< 3 ft/s) for the last 0.5 s',
    value: `${judged - bad}/${judged} faceoffs set`,
    evidence: ev,
  }
}

/* ── VT8 line changes through the door ───────────────────────────────────── */
export function vt8Changes(inp: VTInput): VTResult {
  const frames = inp.frames
  const brk = seekBreaks(frames)
  const gates = inp.geometry.benchGates
  const nearGate = (r: ProbeRig): boolean => {
    const g = gates[r.team]
    return Math.abs(r.x - g.x) <= 13 && Math.abs(r.z - g.z) <= 8
  }
  let changes = 0
  let bad = 0
  const ev: string[] = []
  frames.forEach((f, i) => {
    if (i === 0 || brk[i] || !isLive(f) || inReplay(f)) return
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
    status: changes === 0 ? 'n/a' : bad === 0 ? 'green' : 'red',
    rule: 'every departing / arriving man crosses within ~8 ft of his bench door; none appear or vanish mid-ice',
    value: `${bad} violations in ${changes} rig hand-overs`,
    evidence: ev,
  }
}

/* ── VT9 framing ─────────────────────────────────────────────────────────── */
export function vt9Framing(inp: VTInput): VTResult {
  let n = 0
  let puckOn = 0
  let carried = 0
  let centred = 0
  for (const f of inp.frames) {
    if (!isLive(f) || inReplay(f) || f.cam.preset !== 'broadcast' || f.goalSeq !== null) continue
    n++
    if (f.puck.onScreen) puckOn++
    const c = f.carrier ? f.rigs.find((r) => r.id === f.carrier && r.visible) : undefined
    if (c) {
      carried++
      if (c.onScreen && c.sx >= f.w / 3 && c.sx <= (2 * f.w) / 3) centred++
    }
  }
  const pOn = n ? puckOn / n : 0
  const cMid = carried ? centred / carried : 1
  return {
    id: 'VT9', name: 'Framing (broadcast camera)',
    status: n === 0 ? 'n/a' : pOn >= 0.99 && cMid >= 0.9 ? 'green' : 'red',
    rule: 'puck on screen ≥ 99% of live broadcast frames; carrier in the middle third ≥ 90% of carried frames',
    value: `puck on screen ${(pOn * 100).toFixed(1)}%; carrier in the middle third ${(cMid * 100).toFixed(1)}% (${carried} carried frames)`,
    evidence: [],
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

export const DETECTORS = [vt1Bodies, vt2Divergence, vt3Shots, vt4Motion, vt5Replay, vt6Clocks, vt7Faceoffs, vt8Changes, vt9Framing, vt10Commentary] as const

export function runViewerTruth(inp: VTInput): VTResult[] {
  return DETECTORS.map((d) => d(inp))
}
