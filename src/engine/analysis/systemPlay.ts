/**
 * VT15 SYSTEM LEGIBILITY (W3-DESIGN item 3, slice S4): can you SEE the system
 * a team runs? Each team's forecheck, D-zone coverage and breakouts are
 * classified from POSITIONS (where the five men stand, where the puck goes),
 * never from what the sim says it is running, and compared with the play the
 * team declared (FrameEvent.homeSystem / awaySystem on the sim stream, or the
 * playbook the viewer was told). A system is legible when the classifier finds
 * it in most sequences.
 *
 *   forecheck   (their carrier deep in their own zone, the shape ≥ 0.75 s old)
 *               2-1-2: two of ours below the top of their circles;
 *               1-2-2: one;
 *               1-3-1: none, our deepest man still up at their circles and
 *                      three back at the red line;
 *               1-4:   nobody past their blue line but the one man.
 *   D zone      (their carrier in our zone ≥ 1 s) the collapse: our five
 *               packed in the house (mean distance to our net ≤ 26 ft) with
 *               their point men left alone; man: their point men ridden (a man
 *               within 10 ft); zone otherwise.
 *   breakouts   (stream only: needs the pass events) our possession that
 *               starts in our zone and leaves it: the reverse (a pass from
 *               the goal line across behind / beside the net), the stretch
 *               (a pass of ≥ 65 ft, or caught past the red line), up the wall
 *               (a pass to a man on the boards), the rim (it leaves our zone
 *               off a chip, nobody's pass), the wheel (the man who took it
 *               below the goal line carries it out himself).
 *
 * Pure geometry on teamPlay's neutral frames, like VT13/VT14/VT16.
 */
import { playAbsT } from '@domain'
import type { GameStream } from '@domain/events'
import { framesFromStream, type TPFrame } from './teamPlay'

export interface SysFrame extends TPFrame {
  homeSystem?: string | undefined
  awaySystem?: string | undefined
}

export interface SysPass {
  t: number
  from: string
  /** Release and target, rink feet. */
  a: { x: number; y: number }
  b: { x: number; y: number }
  completed: boolean
}

export type ForecheckClass = '2-1-2' | '1-2-2' | '1-3-1' | '1-4'
export type DZoneClass = 'zone' | 'man' | 'collapse'
export type BreakoutClass = 'up' | 'reverse' | 'wheel' | 'stretch' | 'rim' | 'carry'

export interface SeqCase<C> {
  t: number
  team: 'home' | 'away'
  declared: string | null
  classified: C
  /** Evidence: what the classifier read (forecheck: our five's x per settled frame). */
  detail?: string
}

export interface TeamSystems {
  forecheck: SeqCase<ForecheckClass>[]
  dzone: SeqCase<DZoneClass>[]
  breakout: SeqCase<BreakoutClass>[]
}

export interface SystemsReport {
  home: TeamSystems
  away: TeamSystems
}

/** Thresholds (design: read off the coaching diagrams, checked on contrasting sims). */
export const SYS = {
  blue: 25,
  /** A forecheck is judged with their puck this deep (attack frame, ft). */
  fcPuckX: 60,
  /** …once the shape is this old (s). */
  fcSettleS: 1,
  /** …and judged once it has run this much longer (s; 3 frames at the sim's 4 Hz). */
  fcMinS: 0.5,
  /** Below the top of their circles: a man in deep. */
  deepX: 60,
  /** Forecheck frames: F1 (our deepest man) gone in past this x… */
  f1InX: 59,
  /** …a 1-4 never past this; a 2-1-2 has its second man in deep too, or within f2InFt of their carrier. */
  f1PassiveX: 35,
  f2InFt: 24,
  /** A 1-3-1's F1 steers from up here (their circles); a 1-4's never gets this far. */
  trapF1X: 40,
  /** At the red line or back. */
  backX: 14,
  /** A D-zone sequence counts after this long (s). */
  dzSettleS: 1,
  /** The collapse: our five's mean distance to our net (ft) at most this… */
  collapseFt: 22,
  /** …their point men (≥ pointFt from our net) with nobody of ours within freeFt. */
  pointFt: 45,
  freeFt: 14,
  /** Man coverage: a point man with one of ours within this (ft). */
  riddenFt: 12,
  /** Inside our zone: within this many feet of our goal line along the rink (the blue line is 64 out). */
  zoneDepthFt: 66,
  /** Breakouts. */
  reverseX: 78,
  stretchFt: 65,
  wallY: 30,
}

/** The neutral frames plus each side's declared system, and the stream's passes on the same clock. */
export function systemFramesFromStream(stream: GameStream): { frames: SysFrame[]; passes: SysPass[] } {
  const tp = framesFromStream(stream)
  const frames: SysFrame[] = []
  let k = 0
  for (const e of stream) {
    if (e.type !== 'frame') continue
    const f = tp[k++]
    if (!f) break
    frames.push({ ...f, homeSystem: e.homeSystem, awaySystem: e.awaySystem })
  }
  // passes on the frames' absolute clock (the same per-period base)
  const REG = 1200
  const base = new Map<number, number>()
  {
    const maxT = new Map<number, number>()
    for (const e of stream) maxT.set(e.period, Math.max(maxT.get(e.period) ?? 0, e.t))
    let b = 0
    for (const p of [...maxT.keys()].sort((x, y) => x - y)) {
      base.set(p, b)
      b += p <= 3 ? REG : (maxT.get(p) ?? REG)
    }
  }
  const passes: SysPass[] = []
  for (const e of stream) {
    if (e.type !== 'pass') continue
    passes.push({ t: playAbsT(e, base), from: e.from as string, a: { x: e.a.x * 100, y: e.a.y * 42.5 }, b: { x: e.b.x * 100, y: e.b.y * 42.5 }, completed: e.completed })
  }
  return { frames, passes }
}

const mode = <C extends string>(xs: C[]): C | null => {
  const m = new Map<C, number>()
  let best: C | null = null
  let bn = 0
  for (const x of xs) {
    const n = (m.get(x) ?? 0) + 1
    m.set(x, n)
    if (n > bn) {
      bn = n
      best = x
    }
  }
  return best
}

/**
 * A team's forecheck over one sequence, read off where its five stood (each
 * frame: their x in its attack frame). The most men it ever had in deep at
 * once: two is a 2-1-2, one a 1-2-2; none, and the deepest man still up at
 * their circles with three back is the 1-3-1, never past their blue line the 1-4.
 */
export function classifyForecheck(frames: readonly { xs: readonly number[]; d: readonly number[] }[]): ForecheckClass {
  // the settled part of the sequence (the first is men still getting there, or back)
  const late = frames.slice(Math.floor(frames.length / 3))
  return mode(late.map(forecheckFrame)) ?? '1-2-2'
}

/**
 * One settled forecheck frame, from the distances (ft) of our two nearest men
 * to their carrier, nearest first: F1 standing off him (the trap steers from
 * the circles; the 1-4 waits at their blue line), or on him with a second man
 * in close (2-1-2) or holding his wall (1-2-2).
 */
export function forecheckFrame(f: { xs: readonly number[]; d: readonly number[] }): ForecheckClass {
  const xs = [...f.xs].sort((p, q) => q - p)
  const x1 = xs[0] ?? -Infinity
  const x2 = xs[1] ?? -Infinity
  if (x1 <= SYS.f1PassiveX) return '1-4'
  if (x1 <= SYS.f1InX) return '1-3-1'
  return x2 >= SYS.deepX ? '2-1-2' : '1-2-2'
}

/** One frame of a team's D-zone coverage: its five and their attackers, distances to its own net. */
export function classifyDZone(ours: readonly { x: number; y: number }[], theirs: readonly { x: number; y: number; id?: string }[], netX: number, carrier: string | null = null): DZoneClass | null {
  const { mean, points, free, ridden } = dzoneFeatures(ours, theirs, netX, carrier)
  if (mean <= SYS.collapseFt && free * 2 >= points) return 'collapse'
  // with nobody of theirs out high there is nothing to tell man from zone by
  if (points === 0) return null
  if (ridden * 2 > points) return 'man'
  return 'zone'
}

/** What the D-zone classifier reads: the mean distance (ft) of our four nearest our net, and their point men (free / ridden). */
export function dzoneFeatures(ours: readonly { x: number; y: number }[], theirs: readonly { x: number; y: number; id?: string }[], netX: number, carrier: string | null = null): { mean: number; points: number; free: number; ridden: number } {
  const dn = (p: { x: number; y: number }): number => Math.hypot(p.x - netX, p.y)
  // the four nearest our net (the fifth is on the puck, wherever it is)
  const ds = ours.map(dn).sort((p, q) => p - q).slice(0, 4)
  const mean = ds.reduce((s, d) => s + d, 0) / Math.max(1, ds.length)
  // their point men without the puck
  const points = theirs.filter((p) => dn(p) >= SYS.pointFt && Math.abs(p.x - netX) <= SYS.zoneDepthFt && p.id !== carrier)
  const near = (p: { x: number; y: number }): number => Math.min(...ours.map((q) => Math.hypot(q.x - p.x, q.y - p.y)))
  return { mean, points: points.length, free: points.filter((p) => near(p) >= SYS.freeFt).length, ridden: points.filter((p) => near(p) <= SYS.riddenFt).length }
}

/** VT15 on the stream (or on drawn frames, without breakouts). */
export function judgeSystems(frames: readonly SysFrame[], passes: readonly SysPass[] = []): SystemsReport {
  const rep: SystemsReport = { home: { forecheck: [], dzone: [], breakout: [] }, away: { forecheck: [], dzone: [], breakout: [] } }
  for (const team of ['home', 'away'] as const) {
    const ids = new Set<string>()
    for (const f of frames) for (const s of f[team]) ids.add(s.id)
    const theirs = team === 'home' ? 'away' : 'home'
    // per-team sequence state
    let fc: { start: number; last: number; xs: { xs: number[]; d: number[] }[]; dec: string[] } | null = null
    let dz: { start: number; cls: DZoneClass[]; dec: string[]; feat: string[] } | null = null
    let bo: { start: number; dec: string | null; lowCarrier: string | null; passFrom: number } | null = null
    const closeFc = (): void => {
      // (long enough for the forecheckers to have got there)
      if (fc && fc.xs.length > 0 && fc.last - fc.start - SYS.fcSettleS >= SYS.fcMinS) rep[team].forecheck.push({ t: fc.start, team, declared: mode(fc.dec)?.split(':')[1] ?? null, classified: classifyForecheck(fc.xs), detail: fc.xs.slice(Math.floor(fc.xs.length / 3)).map((q) => [...q.xs].sort((p, r) => r - p).map((x) => Math.round(x)).join(",")).join(" / ") })
      fc = null
    }
    const closeDz = (): void => {
      if (dz && dz.cls.length >= 2) {
        const c = mode(dz.cls)
        if (c) rep[team].dzone.push({ t: dz.start, team, declared: mode(dz.dec)?.split(":")[1] ?? null, classified: c, detail: dz.feat.slice(-4).join(" ") })
      }
      dz = null
    }
    for (const f of frames) {
      const fiveOnFive = f.home.length === 5 && f.away.length === 5
      if (!f.live || !fiveOnFive || f.homeNetX === 0) {
        closeFc()
        closeDz()
        bo = null
        continue
      }
      const ownNet = team === 'home' ? f.homeNetX : -f.homeNetX
      const a = ownNet > 0 ? -1 : 1
      const decl = team === 'home' ? f.homeSystem : f.awaySystem
      const px = f.puck.x * a
      const theyHaveIt = f.carrier !== null && !ids.has(f.carrier) && f[theirs].some((s) => s.id === f.carrier)
      const weHaveIt = f.carrier !== null && ids.has(f.carrier)
      // forecheck: their carrier deep in their end
      // (a change on the fly is not a forecheck: the men are going to the bench)
      const changing = f[team].some((s) => s.job === 'change')
      if (theyHaveIt && px >= SYS.fcPuckX && !changing) {
        if (!fc) fc = { start: f.t, last: f.t, xs: [], dec: [] }
        fc.last = f.t
        if (f.t - fc.start >= SYS.fcSettleS) {
          const cx = f[theirs].find((s) => s.id === f.carrier)!
          fc.xs.push({ xs: f[team].map((s) => s.x * a), d: f[team].map((s) => Math.hypot(s.x - cx.x, s.y - cx.y)).sort((p, q) => p - q) })
          if (decl?.startsWith('forecheck:')) fc.dec.push(decl)
        }
      } else if (weHaveIt || px < SYS.blue || changing) closeFc() // (a pass of theirs in flight does not end it)
      // D zone: their carrier in our end
      if (theyHaveIt && px <= -SYS.blue - 5) {
        if (!dz) dz = { start: f.t, cls: [], dec: [], feat: [] }
        if (f.t - dz.start >= SYS.dzSettleS) {
          const dc = classifyDZone(f[team], f[theirs], ownNet, f.carrier)
          if (dc) dz.cls.push(dc)
          const ft = dzoneFeatures(f[team], f[theirs], ownNet, f.carrier)
          dz.feat.push(`${Math.round(ft.mean)}/${ft.points}/${ft.free}/${ft.ridden}`)
          if (decl?.startsWith('dzone:')) dz.dec.push(decl)
        }
      } else if (weHaveIt || px > -SYS.blue) closeDz() // (nor here)
      // breakouts: our possession from our end out of it
      if (!bo && weHaveIt && px <= -SYS.blue) bo = { start: f.t, dec: null, lowCarrier: null, passFrom: f.t }
      if (bo && weHaveIt && px <= -SYS.blue) {
        if (!bo.dec && decl?.startsWith('breakout:')) bo.dec = decl.split(':')[1] ?? null
        const c = f[team].find((s) => s.id === f.carrier)
        if (c && c.x * a <= -SYS.reverseX && !bo.lowCarrier) bo.lowCarrier = c.id
      } else if (bo && theyHaveIt) bo = null
      else if (bo && px > -SYS.blue + 2) {
        if (passes.length > 0) {
          // it left our zone: how?
          const ours = passes.filter((p) => p.t >= bo!.start - 0.05 && p.t <= f.t + 0.05 && ids.has(p.from) && p.completed)
          let cls: BreakoutClass
          const first = ours[0]
          if (first) {
            const ax = first.a.x * a
            const bx = first.b.x * a
            const len = Math.hypot(first.b.x - first.a.x, first.b.y - first.a.y)
            if (ax <= -SYS.reverseX && Math.sign(first.a.y) !== Math.sign(first.b.y) && Math.abs(first.b.y - first.a.y) >= 15) cls = 'reverse'
            else if (len >= SYS.stretchFt || bx >= 0) cls = 'stretch'
            else if (Math.abs(first.b.y) >= SYS.wallY) cls = 'up'
            else cls = 'carry'
          } else if (f.carrier === null) cls = 'rim'
          else if (bo.lowCarrier !== null && f.carrier === bo.lowCarrier) cls = 'wheel'
          else cls = 'carry'
          rep[team].breakout.push({ t: bo.start, team, declared: bo.dec, classified: cls })
        }
        bo = null
      }
    }
    closeFc()
    closeDz()
  }
  return rep
}

/** The plays that read as each other's on a picture: the pressure forechecks (2-1-2 / 1-2-2), the sitting-back ones (1-3-1 / 1-4); the box coverages (zone / man) against the collapse. */
const FAMILY: Record<string, string> = { '2-1-2': 'pressure', '1-2-2': 'pressure', '1-3-1': 'back', '1-4': 'back', zone: 'box', man: 'box', collapse: 'collapse' }

export interface Legibility {
  /** Sequences with a declared play. */
  judged: number
  /** …whose classified play is the declared one (or its family). */
  matched: number
  share: number
  /** …whose classified play is exactly the declared one. */
  exact: number
  exactShare: number
  /** Classified plays per declared play. */
  table: Record<string, Record<string, number>>
}

/** How often what you see is what the team declared. */
export function legibility<C extends string>(cases: readonly SeqCase<C>[]): Legibility {
  const table: Record<string, Record<string, number>> = {}
  let judged = 0
  let matched = 0
  let exact = 0
  for (const c of cases) {
    if (!c.declared) continue
    judged++
    const row = (table[c.declared] ??= {})
    row[c.classified] = (row[c.classified] ?? 0) + 1
    if (c.classified === c.declared) exact++
    if (c.classified === c.declared || (FAMILY[c.classified] !== undefined && FAMILY[c.classified] === FAMILY[c.declared])) matched++
  }
  return { judged, matched, share: judged ? matched / judged : 0, exact, exactShare: judged ? exact / judged : 0, table }
}
