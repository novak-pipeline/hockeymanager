/**
 * VT12 action floor and the contact-pair check (W3 S2, W3-DESIGN.md item 1),
 * judged on the sim stream.
 *
 *  - Shots: every wind-up (`ShotEvent.windupS`) is at least its shot type's
 *    row; one-timers and tips are catch-and-release, a shot off a deke has the
 *    deke for its set-up.
 *  - Passes: every release (`PassEvent.releaseS`) is at least its kind's row.
 *  - Every other action written on the frames (`act` / `actT`): a run that ends
 *    in live play ended no sooner than its floor, unless something cut it (a
 *    check, a fall, a lifted stick, a tie-up) or the man lost the puck it was
 *    about. At 4 Hz the end is only known to the next frame, so a run is short
 *    only when even that upper bound is under the floor.
 *  - Contact pairs: at a hit, the two men are within contact range; at a
 *    tie-up (a battle with `holdS`) the two men are within battle range, on the
 *    frame nearest the event.
 */
import type { FrameEvent, GameStream, PassKind, ShotType } from '@domain'
import { ACT_FLOOR, ACTION_FLOOR, type ActName } from '@engine/agent/constraints'

export interface FloorCase {
  t: number
  what: string
}

export interface ActionFloorReport {
  shots: number
  passes: number
  runs: number
  short: FloorCase[]
  /** Runs per act name (what the frames showed). */
  byAct: Record<string, number>
}

export interface ContactReport {
  hits: number
  tieUps: number
  apart: FloorCase[]
}

/** Seconds of slack for the stream's 0.01-s rounding and a substep (0.05 s). */
const TOL = 0.06
/** Acts that legitimately cut another short (a contact landed on him). */
const CUTS = new Set<string>(['stagger', 'down', 'pinned', 'lifted', 'tieUp', 'hit', 'pin'])
/** Acts about the puck: over early when he lost it (no floor to meet). */
const PUCK_ACTS = new Set<string>(['windup', 'pass', 'receive', 'deke'])

function absBase(stream: GameStream): Map<number, number> {
  const maxT = new Map<number, number>()
  for (const e of stream) maxT.set(e.period, Math.max(maxT.get(e.period) ?? 0, e.t))
  const base = new Map<number, number>()
  let b = 0
  for (const p of [...maxT.keys()].sort((x, y) => x - y)) {
    base.set(p, b)
    b += p <= 3 ? 1200 : (maxT.get(p) ?? 1200)
  }
  return base
}

const clk = (t: number): string => {
  const p = Math.min(4, Math.floor(t / 1200) + 1)
  const r = 1200 - (t - (p - 1) * 1200)
  return `P${p} ${Math.floor(r / 60)}:${String(Math.floor(r % 60)).padStart(2, '0')}`
}

export function judgeActionFloor(stream: GameStream): ActionFloorReport {
  const base = absBase(stream)
  const rep: ActionFloorReport = { shots: 0, passes: 0, runs: 0, short: [], byAct: {} }
  const abs = (period: number, t: number): number => (base.get(period) ?? (period - 1) * 1200) + t
  // Event floors.
  for (const e of stream) {
    if (e.type === 'shot' || e.type === 'missedShot') {
      if (e.windupS === undefined || e.shotType === undefined) continue
      rep.shots++
      const need = ACTION_FLOOR.shot.windup[e.shotType as ShotType]
      if (e.windupS < need - TOL) rep.short.push({ t: abs(e.period, e.t), what: `${clk(abs(e.period, e.t))} ${e.shotType} by ${e.shooter}: wound up ${e.windupS.toFixed(2)} s, the row is ${need} s` })
    } else if (e.type === 'pass' && e.releaseS !== undefined) {
      rep.passes++
      const need = ACTION_FLOOR.pass.release[(e.kind ?? 'tape') as PassKind]
      if (e.releaseS < need - TOL) rep.short.push({ t: abs(e.period, e.t), what: `${clk(abs(e.period, e.t))} ${e.kind ?? 'tape'} pass by ${e.from}: released after ${e.releaseS.toFixed(2)} s, the row is ${need} s` })
    }
  }
  // Contacts on each man (a hit, a poke, a battle): a run they cut short is not a floor breach.
  const touched = new Map<string, number[]>()
  const touch = (id: string, t: number): void => {
    const l = touched.get(id)
    if (l) l.push(t)
    else touched.set(id, [t])
  }
  for (const e of stream) {
    const t = abs(e.period, e.t)
    if (e.type === 'hit') { touch(e.by as string, t); touch(e.on as string, t) }
    else if (e.type === 'pokeCheck') { touch(e.by as string, t); touch(e.on as string, t) }
    else if (e.type === 'battle') for (const p of e.players) touch(p as string, t)
    else if (e.type === 'blockedShot') touch(e.blocker as string, t)
  }
  // Frame runs.
  const runs = new Map<string, { act: string; start: number; live: boolean; carried: boolean }>()
  let live = false
  for (const e of stream) {
    if (e.type === 'faceoff') live = true
    else if (e.type === 'whistle' || e.type === 'periodEnd' || e.type === 'gameEnd' || e.type === 'goal') {
      live = false
      runs.clear()
    } else if (e.type === 'frame') {
      const t = abs(e.period, e.t)
      const seen = new Set<string>()
      for (const s of [...e.home, ...e.away, e.homeGoalie, e.awayGoalie]) {
        const id = s.player as string
        seen.add(id)
        const run = runs.get(id)
        const start = s.act !== undefined ? t - (s.actT ?? 0) : NaN
        if (run && s.act === run.act && Math.abs(start - run.start) < TOL) {
          run.live = run.live && live
          if (e.puckCarrier === id) run.carried = true
          continue
        }
        if (run) closeRun(id, run, t, s.act, e.puckCarrier === id)
        if (s.act !== undefined) {
          runs.set(id, { act: s.act, start, live, carried: e.puckCarrier === id })
          rep.runs++
          rep.byAct[s.act] = (rep.byAct[s.act] ?? 0) + 1
        } else runs.delete(id)
      }
      for (const id of [...runs.keys()]) if (!seen.has(id)) runs.delete(id) // off the ice: a change
    }
  }
  function closeRun(id: string, run: { act: string; start: number; live: boolean; carried: boolean }, t: number, next: string | undefined, hasPuckNow: boolean): void {
    if (!run.live || !live) return
    const floor = ACT_FLOOR[run.act as ActName]
    if (floor === undefined) return
    if (t - run.start >= floor - TOL) return
    if (next !== undefined && CUTS.has(next)) return
    if ((touched.get(id) ?? []).some((x) => x >= run.start - TOL && x <= t + TOL)) return
    // the shot / pass act ends at its release (judged exactly on the event above)
    if (run.act === 'windup' || run.act === 'pass') return
    if (PUCK_ACTS.has(run.act) && !hasPuckNow) return
    // catch and shoot / catch and move it: the load or the sweep starts while
    // the puck settles; the sim releases it no sooner than both (checked on the event)
    if (run.act === 'receive' && (next === 'windup' || next === 'pass' || next === 'deke')) return
    rep.short.push({ t, what: `${clk(t)} ${id} ${run.act} lasted under ${(t - run.start).toFixed(2)} s (floor ${floor} s)${next ? `, then ${next}` : ''}` })
  }
  return rep
}

/**
 * Contact pairs on the stream: at a hit the two men, at a tie-up the two men,
 * were within contact range AT the event. The 4 Hz frames bracket the moment,
 * so each man is carried from the last frame before it at his own velocity.
 */
export function judgeContacts(stream: GameStream): ContactReport {
  const rep: ContactReport = { hits: 0, tieUps: 0, apart: [] }
  const base = absBase(stream)
  const abs = (period: number, t: number): number => (base.get(period) ?? (period - 1) * 1200) + t
  const frames: FrameEvent[] = []
  const times: number[] = []
  for (const e of stream) if (e.type === 'frame') { frames.push(e); times.push(abs(e.period, e.t)) }
  const before = (t: number): number => {
    let lo = 0
    let hi = times.length - 1
    if (hi < 0 || times[0]! > t) return -1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (times[mid]! <= t + 1e-6) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  const at = (t: number, id: string): { x: number; y: number } | null => {
    const i = before(t)
    if (i < 0) return null
    const f = frames[i]!
    const s = [...f.home, ...f.away].find((q) => q.player === id)
    if (!s) return null
    let x = s.pos.x * 100
    let y = s.pos.y * 42.5
    const g = frames[i - 1]
    const dt = i > 0 ? times[i]! - times[i - 1]! : 0
    const q = g ? [...g.home, ...g.away].find((r) => r.player === id) : undefined
    if (q && dt > 0 && dt < 0.3) {
      x += ((s.pos.x - q.pos.x) * 100 / dt) * (t - times[i]!)
      y += ((s.pos.y - q.pos.y) * 42.5 / dt) * (t - times[i]!)
    }
    return { x, y }
  }
  const slack = 1.5
  for (const e of stream) {
    if (e.type === 'hit') {
      const t = abs(e.period, e.t)
      const a = at(t, e.by as string)
      const b = at(t, e.on as string)
      if (!a || !b) continue
      rep.hits++
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (d > ACTION_FLOOR.contact.hitFt + slack) rep.apart.push({ t, what: `${clk(t)} hit ${e.by} on ${e.on}: ${d.toFixed(1)} ft apart at contact` })
    } else if (e.type === 'battle' && e.holdS !== undefined && e.players.length === 2) {
      const t = abs(e.period, e.t)
      const a = at(t, e.players[0] as string)
      const b = at(t, e.players[1] as string)
      if (!a || !b) continue
      rep.tieUps++
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (d > ACTION_FLOOR.contact.battleFt + slack) rep.apart.push({ t, what: `${clk(t)} tie-up ${e.players.join(' / ')}: ${d.toFixed(1)} ft apart` })
    }
  }
  return rep
}
