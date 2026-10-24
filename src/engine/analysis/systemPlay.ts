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
import { SHAPE_TEMPLATES, assignShape, type RolePoint } from './shapes'

export interface SysFrame extends TPFrame {
  homeSystem?: string | undefined
  awaySystem?: string | undefined
}

export interface SysPass {
  t: number
  from: string
  /** The man it was for (W3 S8: the drop pass's receiver). */
  to?: string | undefined
  /** Release and target, rink feet. */
  a: { x: number; y: number }
  b: { x: number; y: number }
  completed: boolean
}

export type ForecheckClass = '2-1-2' | '1-2-2' | '1-3-1' | '1-4'
export type DZoneClass = 'zone' | 'man' | 'collapse'
export type BreakoutClass = 'up' | 'reverse' | 'wheel' | 'stretch' | 'rim' | 'carry'
/** W3 S8: the power-play set-up, entry; the kill's shape and its pressure. */
export type PpClass = 'umbrella' | '1-3-1' | 'overload'
export type PpEntryClass = 'drop' | 'carry' | 'dump'
export type PkClass = 'box' | 'diamond'
export type PkPressClass = 'aggressive' | 'passive'

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
  /** W3 S8: on the power play (this team 5 on 4, in their zone with the puck), the set-up its five stand in. */
  pp: SeqCase<PpClass>[]
  /** W3 S8: on the power play, how it got into their zone (the drop pass, the carry, the dump). */
  ppEntry: SeqCase<PpEntryClass>[]
  /** W3 S8: killing a penalty (4 on 5, in our zone), the shape its four stand in… */
  pk: SeqCase<PkClass>[]
  /** …and how hard its man on the puck plays a carrier on the perimeter. */
  pkPress: SeqCase<PkPressClass>[]
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
  /** W3 S8 special teams: a set-up is read once the puck has been in their zone this long (s), from at least this many frames. */
  stSettleS: 1,
  stMinFrames: 3,
  /** The zone (attack frame, ft): past their blue line by this much. */
  stZoneX: 28,
  /** The kill's pressure: each carrier on the perimeter (beyond this from the killers' net, ft), the closest any killer got to him while he had it; the median of those under `pressFt` is the aggressive kill. */
  perimeterFt: 32,
  pressFt: 9.5,
  /** …over carriers who held it at least this many frames out there (0.75 s at the sim's 4 Hz). */
  stintFrames: 3,
  /** A drop pass: from the neutral zone, gaining no more than this (ft) toward their net (back, or square to a man coming), within this long (s) of the entry. */
  dropGainFt: 3,
  dropS: 4,
}

/**
 * W3 S8: the textbook set-ups the special-teams classifier reads against (the
 * shapes.ts diagrams, in the power play's attack frame, mirrored to the puck
 * side): the umbrella, the 1-3-1 and the overload; the box and the diamond.
 */
const tpl = (id: string): { attack: readonly RolePoint[]; defend: readonly RolePoint[] } => {
  const t = SHAPE_TEMPLATES.find((q) => q.id === id)
  if (!t) throw new Error(`no shape template ${id}`)
  return t
}
export const PP_CLASS_TEMPLATES: Record<PpClass, readonly RolePoint[]> = { umbrella: tpl('ppUmbrella').attack, '1-3-1': tpl('pp131').attack, overload: tpl('ppOverload').attack }
export const PK_CLASS_TEMPLATES: Record<PkClass, readonly RolePoint[]> = { box: tpl('pp131').defend, diamond: tpl('ppUmbrella').defend }

/** The nearest set-up (least mean distance over the best assignment) for points already in the attack frame, puck side mirrored to +y. */
export function nearestSetup<C extends string>(pts: readonly { x: number; y: number }[], set: Record<C, readonly RolePoint[]>): { cls: C; meanFt: number } | null {
  let best: { cls: C; meanFt: number } | null = null
  for (const cls of Object.keys(set) as C[]) {
    const r = assignShape(pts, set[cls])
    if (r && (!best || r.meanFt < best.meanFt)) best = { cls, meanFt: r.meanFt }
  }
  return best
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
    passes.push({ t: playAbsT(e, base), from: e.from as string, to: e.to as string, a: { x: e.a.x * 100, y: e.a.y * 42.5 }, b: { x: e.b.x * 100, y: e.b.y * 42.5 }, completed: e.completed })
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
  const rep: SystemsReport = { home: { forecheck: [], dzone: [], breakout: [], pp: [], ppEntry: [], pk: [], pkPress: [] }, away: { forecheck: [], dzone: [], breakout: [], pp: [], ppEntry: [], pk: [], pkPress: [] } }
  judgeSpecialTeams(frames, passes, rep)
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

/**
 * W3 S8 (VT15 for special teams): each power play's set-up, entry, and the
 * kill against it, read off the positions. A sequence is the power play (5 on
 * 4) holding the puck in their zone; it is judged once settled (`stSettleS`),
 * frame by frame against the textbook set-ups (nearestSetup), and its
 * classification is the most frequent read. The kill's pressure is the median
 * gap of its nearest man to a carrier out on the perimeter. An entry is the
 * puck crossing their blue line under the power play's control: carried in
 * (the carrier took it from a drop pass, a pass back to him from the neutral
 * zone a moment before: the drop), or put in with nobody carrying it (the dump).
 */
function judgeSpecialTeams(frames: readonly SysFrame[], passes: readonly SysPass[], rep: SystemsReport): void {
  for (const team of ['home', 'away'] as const) {
    const ids = new Set<string>()
    for (const f of frames) for (const s of f[team]) ids.add(s.id)
    const theirs = team === 'home' ? 'away' : 'home'
    let seq: { start: number; pp: PpClass[]; pk: PkClass[]; gaps: number[]; decPp: string[]; decPk: string[]; stint: { id: string; min: number; n: number } | null } | null = null
    let lastAdv = -Infinity
    let lastCarrier: string | null = null
    let entryDecl: string | null = null
    const endStint = (): void => {
      // (a carrier who had it long enough for the kill to get to him - a one-timer is no read of the pressure)
      if (seq?.stint && seq.stint.n >= SYS.stintFrames) seq.gaps.push(seq.stint.min)
      if (seq) seq.stint = null
    }
    const close = (): void => {
      endStint()
      if (seq && seq.pp.length >= SYS.stMinFrames) {
        const pp = mode(seq.pp)
        const pk = mode(seq.pk)
        const dPk = mode(seq.decPk)?.split(':')[1] ?? null
        if (pp) rep[team].pp.push({ t: seq.start, team, declared: mode(seq.decPp)?.split(':')[1] ?? null, classified: pp })
        if (pk) rep[theirs].pk.push({ t: seq.start, team: theirs, declared: dPk?.split('/')[0] ?? null, classified: pk })
        if (seq.gaps.length >= 1) {
          const g = [...seq.gaps].sort((p, q) => p - q)[Math.floor(seq.gaps.length / 2)]!
          rep[theirs].pkPress.push({ t: seq.start, team: theirs, declared: dPk?.split('/')[1] ?? null, classified: g < SYS.pressFt ? 'aggressive' : 'passive', detail: `median gap ${g.toFixed(1)} ft` })
        }
      }
      seq = null
    }
    for (const f of frames) {
      const onPp = f.live && f.homeNetX !== 0 && f[team].length === 5 && f[theirs].length === 4
      if (!onPp) {
        close()
        lastAdv = -Infinity
        lastCarrier = null
        continue
      }
      const ownNet = team === 'home' ? f.homeNetX : -f.homeNetX
      const a = ownNet > 0 ? -1 : 1
      const px = f.puck.x * a
      const weHaveIt = f.carrier !== null && ids.has(f.carrier)
      const theyHaveIt = f.carrier !== null && !weHaveIt
      const ours = weHaveIt || (f.carrier === null && lastCarrier !== null && ids.has(lastCarrier))
      const decl = team === 'home' ? f.homeSystem : f.awaySystem
      const declPk = team === 'home' ? f.awaySystem : f.homeSystem
      if (decl?.startsWith('ppentry:')) entryDecl = decl.split(':')[1] ?? null
      // the entry: the puck over their blue line, the power play's (carried, or off our stick with nobody on it)
      if (px >= SYS.blue + 0.7 && lastAdv < SYS.blue + 0.7 && lastAdv > -Infinity && ours) {
        let cls: PpEntryClass = weHaveIt ? 'carry' : 'dump'
        if (weHaveIt) {
          const drop = passes.find((p) => p.completed && p.to === f.carrier && ids.has(p.from) && p.t <= f.t && p.t >= f.t - SYS.dropS && (p.b.x - p.a.x) * a <= SYS.dropGainFt && p.a.x * a < SYS.blue && p.a.x * a > -SYS.blue)
          if (drop) cls = 'drop'
        }
        rep[team].ppEntry.push({ t: f.t, team, declared: entryDecl, classified: cls })
        entryDecl = null
      }
      lastAdv = px
      if (f.carrier !== null) lastCarrier = f.carrier
      // the set-up: in their zone with the puck (a pass of ours in flight included)
      if (px >= SYS.stZoneX && ours) {
        if (!seq) seq = { start: f.t, pp: [], pk: [], gaps: [], decPp: [], decPk: [], stint: null }
        if (f.t - seq.start < SYS.stSettleS) continue
        const side = f.puck.y >= 0 ? 1 : -1
        const toFrame = (q: { x: number; y: number }): { x: number; y: number } => ({ x: q.x * a, y: q.y * side })
        const pp = nearestSetup(f[team].map(toFrame), PP_CLASS_TEMPLATES)
        const pk = nearestSetup(f[theirs].map(toFrame), PK_CLASS_TEMPLATES)
        if (pp) seq.pp.push(pp.cls)
        if (pk) seq.pk.push(pk.cls)
        if (decl?.startsWith('pp:')) seq.decPp.push(decl)
        if (declPk?.startsWith('pk:')) seq.decPk.push(declPk)
        const c = weHaveIt ? f[team].find((q) => q.id === f.carrier) : undefined
        if (c && Math.hypot(c.x * a - 89, c.y) > SYS.perimeterFt) {
          const g = Math.min(...f[theirs].map((q) => Math.hypot(q.x - c.x, q.y - c.y)))
          if (seq.stint && seq.stint.id !== c.id) endStint()
          if (Number.isFinite(g)) seq.stint = { id: c.id, min: Math.min(seq.stint?.min ?? Infinity, g), n: (seq.stint?.n ?? 0) + 1 }
        } else endStint()
      } else if (theyHaveIt || px < SYS.blue) close()
    }
    close()
  }
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
