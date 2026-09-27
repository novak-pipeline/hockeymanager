/**
 * THE MATCH ANALYZER (M0 realism scorecard, docs/MATCH-ENGINE-PLAN.md).
 *
 *   analyzeGame(stream, meta) → GameMetrics      (one game, additive)
 *   aggregate(games[])        → GameMetrics      (element-wise sum)
 *   summarize / compare       → see metrics.ts / compare.ts
 *
 * Reads ONLY the frozen GameEvent contract, so it works on any engine that
 * emits it — the current director engine, the coming agent engine, a quick-sim
 * stream (sparse: count metrics only), or a real tracked sequence converted by
 * reference.ts. Everything it produces is ADDITIVE (counts, fixed-bin
 * histograms, grids) so many games aggregate by summation.
 *
 * Conventions:
 *   - Team membership is read from the positional frames (home/away lists);
 *     `meta.home` / `meta.away` cover frame-less streams.
 *   - Attack direction per team per period is inferred from where the goalie
 *     stands (he defends one end), falling back to shot targets, then to the
 *     engine's odd-period convention.
 *   - "Live" = between a faceoff and the next whistle/goal/period end.
 *   - Kinematics use finite differences of consecutive LIVE frames (the full
 *     engine emits 4 fps; any frame rate works).
 */
import type { GameEvent, GameStream, Position, XY } from '@domain'
import { addSample, mergeGrid, mergeHist, newGrid, newHist, type Grid, type Hist } from './hist'
import {
  BLUE_LINE_FT,
  FT_PER_S_PER_MPH,
  GOAL_LINE_FT,
  HALF_LENGTH_FT,
  HALF_WIDTH_FT,
  advFt,
  binIndex,
  boardDistFt,
  distFt,
  shotGeometry,
  thirdOf
} from './rink'
import { SHAPE_TEMPLATES, mergeShapeAccum, scoreShapes, type ShapeAccum, type ShapeTemplate } from './shapes'

type Side = 'home' | 'away'
type FrameEv = Extract<GameEvent, { type: 'frame' }>

export interface GameMeta {
  /** Optional label for reports. */
  label?: string
  /** Player position lookup (enables F/D splits, D-pair spacing, role metrics). */
  positions?: ReadonlyMap<string, Position> | Readonly<Record<string, Position>>
  /** Roster ids per side — only needed for frame-less (quick-sim) streams. */
  home?: readonly string[]
  away?: readonly string[]
  /** Shot-location bins (default: the NHL xG surface's edges). */
  distanceEdges?: readonly number[]
  angleEdges?: readonly number[]
  /** Shape templates to score (default SHAPE_TEMPLATES). */
  templates?: readonly ShapeTemplate[]
}

export interface GameMetrics {
  games: number
  /** Game minutes played (regulation + OT actually played). */
  minutes: number
  /** Minutes with positional frames (live + dead). */
  frameMinutes: number
  counts: Record<string, number>
  hists: Record<string, Hist>
  grids: Record<string, Grid>
  shapes: Record<string, ShapeAccum>
  /** Shot bin layout used for `grids['shot.distAngle']`. */
  shotBins: { distanceEdges: number[]; angleEdges: number[] }
}

export const DEFAULT_DISTANCE_EDGES = [0, 8, 15, 22, 30, 40, 55, 75, 100, 200]
export const DEFAULT_ANGLE_EDGES = [0, 15, 30, 45, 60, 90, 180]

/** Histogram layouts: key → [lo, hi, step]. Keep stable: merge requires equal layouts. */
export const HIST_SPECS: Record<string, [number, number, number]> = {
  'skate.speedMph': [0, 40, 0.25],
  'skate.speedMph.F': [0, 40, 0.25],
  'skate.speedMph.D': [0, 40, 0.25],
  'skate.accelFt': [0, 80, 0.5],
  'skate.tangAccelFt': [0, 80, 0.5],
  'skate.latAccelFt': [0, 120, 0.5],
  'skate.jerkFt': [0, 800, 2],
  'skate.radiusFt.10to15': [0, 400, 2],
  'skate.radiusFt.15to20': [0, 400, 2],
  'skate.radiusFt.20plus': [0, 400, 2],
  'skate.gameMaxMph': [0, 40, 0.25],
  'skate.milesPer60': [0, 30, 0.1],
  'skate.milesPer60.F': [0, 30, 0.1],
  'skate.milesPer60.D': [0, 30, 0.1],
  'shift.lenSec': [0, 240, 1],
  'shift.lenSec.F': [0, 240, 1],
  'shift.lenSec.D': [0, 240, 1],
  'shape.spacingAttFt': [0, 120, 0.5],
  'shape.spacingDefFt': [0, 120, 0.5],
  'shape.compactAttFt': [0, 80, 0.5],
  'shape.compactDefFt': [0, 80, 0.5],
  'shape.widthAttFt': [0, 90, 0.5],
  'shape.depthAttFt': [0, 200, 1],
  'shape.dPairDefFt': [0, 120, 0.5],
  'shape.dPairAttFt': [0, 120, 0.5],
  'shape.pressureFt': [0, 100, 0.5],
  'shape.gapFt': [0, 120, 0.5],
  'shape.attackersInOz': [0, 7, 1],
  'shape.defendersInDz': [0, 7, 1],
  'pass.lengthFt': [0, 200, 1],
  'pass.speedMph': [0, 150, 1],
  'shot.distFt': [0, 200, 1],
  'shot.danger': [0, 1, 0.01],
  'shot.speedMph': [0, 150, 1],
  'puck.freeSpeedMph': [0, 150, 1],
  'hit.boardDistFt': [0, 45, 0.5],
  'goalie.depthFt': [-20, 40, 0.25],
  'goalie.angleErrFt': [0, 40, 0.25],
  'goalie.latSpeedMph': [0, 40, 0.25],
  'flow.foGapSec': [0, 600, 1],
  'flow.possessionSec': [0, 120, 0.5]
}

export function emptyMetrics(meta: GameMeta = {}): GameMetrics {
  const hists: Record<string, Hist> = {}
  for (const [k, [lo, hi, step]] of Object.entries(HIST_SPECS)) hists[k] = newHist(lo, hi, step)
  const distanceEdges = [...(meta.distanceEdges ?? DEFAULT_DISTANCE_EDGES)]
  const angleEdges = [...(meta.angleEdges ?? DEFAULT_ANGLE_EDGES)]
  return {
    games: 0,
    minutes: 0,
    frameMinutes: 0,
    counts: {},
    hists,
    grids: {
      'shot.distAngle': newGrid(angleEdges.length - 1, distanceEdges.length - 1),
      // 10-ft cells over the sheet, skater positions in each skater's attack frame.
      'heat.skaters': newGrid(20, 9),
      'heat.hits': newGrid(20, 9),
      'heat.shots': newGrid(20, 9)
    },
    shapes: {},
    shotBins: { distanceEdges, angleEdges }
  }
}

/** Element-wise sum of per-game metrics. */
export function aggregate(games: readonly GameMetrics[]): GameMetrics {
  const out = emptyMetrics(
    games[0] ? { distanceEdges: games[0].shotBins.distanceEdges, angleEdges: games[0].shotBins.angleEdges } : {}
  )
  for (const g of games) {
    out.games += g.games
    out.minutes += g.minutes
    out.frameMinutes += g.frameMinutes
    for (const [k, v] of Object.entries(g.counts)) out.counts[k] = (out.counts[k] ?? 0) + v
    for (const [k, h] of Object.entries(g.hists)) {
      const into = out.hists[k]
      if (into) mergeHist(into, h)
    }
    for (const [k, gr] of Object.entries(g.grids)) {
      const into = out.grids[k]
      if (into) mergeGrid(into, gr)
    }
    for (const [k, s] of Object.entries(g.shapes)) {
      const into = out.shapes[k]
      if (into) mergeShapeAccum(into, s)
      else
        out.shapes[k] = {
          frames: s.frames,
          attackErrSum: s.attackErrSum,
          defendErrSum: s.defendErrSum,
          attackOffsets: s.attackOffsets.map((o) => ({ ...o })),
          defendOffsets: s.defendOffsets.map((o) => ({ ...o }))
        }
    }
  }
  return out
}

// ---------------------------------------------------------------------------

const MPH20 = 20 * FT_PER_S_PER_MPH
const MPH22 = 22 * FT_PER_S_PER_MPH
/** Faster than any human skater (~30.7 mph) — a position jump, not skating. */
const TELEPORT_FT_S = 45
/** A frame gap above this breaks a kinematic track / shift. */
const MAX_TRACK_GAP_S = 0.6
const SHIFT_GAP_S = 1.5
const OVERLAP_FT = 2.5

interface Track {
  t: number
  pos: XY
  vel: XY | null
  acc: XY | null
  speed: number
}

interface Shift {
  start: number
  last: number
}

function posOf(meta: GameMeta, id: string): Position | undefined {
  const p = meta.positions
  if (!p) return undefined
  if (p instanceof Map) return p.get(id)
  return (p as Readonly<Record<string, Position>>)[id]
}

function gridAdd(g: Grid, xFt: number, yFt: number): void {
  const c = Math.min(g.cols - 1, Math.max(0, Math.floor(((xFt + HALF_LENGTH_FT) / (2 * HALF_LENGTH_FT)) * g.cols)))
  const r = Math.min(g.rows - 1, Math.max(0, Math.floor(((yFt + HALF_WIDTH_FT) / (2 * HALF_WIDTH_FT)) * g.rows)))
  g.cells[r * g.cols + c]++
  g.n++
}

/** Per-period attack sign of the HOME team (+1 attacks +x). */
function homeAttackSigns(stream: GameStream, teamOf: Map<string, Side>): Map<number, number> {
  const goalieSum = new Map<number, { s: number; n: number }>()
  const shotVote = new Map<number, number>()
  for (const ev of stream) {
    if (ev.type === 'frame') {
      const g = goalieSum.get(ev.period) ?? { s: 0, n: 0 }
      // Home goalie stands at the end home DEFENDS; away goalie at the other.
      g.s += ev.homeGoalie.pos.x - ev.awayGoalie.pos.x
      g.n++
      goalieSum.set(ev.period, g)
    } else if (ev.type === 'shot') {
      const side = teamOf.get(ev.shooter)
      if (!side) continue
      const s = Math.sign(ev.target.x) * (side === 'home' ? 1 : -1)
      shotVote.set(ev.period, (shotVote.get(ev.period) ?? 0) + s)
    }
  }
  const out = new Map<number, number>()
  const periods = new Set<number>()
  for (const ev of stream) periods.add(ev.period)
  for (const p of periods) {
    const g = goalieSum.get(p)
    if (g && g.n > 0 && Math.abs(g.s / g.n) > 0.2) out.set(p, g.s > 0 ? -1 : 1)
    else if ((shotVote.get(p) ?? 0) !== 0) out.set(p, Math.sign(shotVote.get(p)!))
    else out.set(p, p % 2 === 1 ? 1 : -1)
  }
  return out
}

function meanPairwise(pts: readonly XY[]): number {
  let s = 0
  let n = 0
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      s += Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)
      n++
    }
  return n > 0 ? s / n : NaN
}

function compactness(pts: readonly XY[]): number {
  if (pts.length === 0) return NaN
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
  return pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length
}

/** Attack-frame feet (+X toward the net `sign` attacks). */
function af(p: XY, sign: number): XY {
  return { x: p.x * HALF_LENGTH_FT * sign, y: p.y * HALF_WIDTH_FT * sign }
}

export function analyzeGame(stream: GameStream, meta: GameMeta = {}): GameMetrics {
  const m = emptyMetrics(meta)
  m.games = 1
  const C = m.counts
  const inc = (k: string, v = 1): void => {
    C[k] = (C[k] ?? 0) + v
  }
  const H = m.hists
  const templates = meta.templates ?? SHAPE_TEMPLATES
  const { distanceEdges, angleEdges } = m.shotBins

  // --- Pre-pass: membership + directions + period lengths -------------------
  const teamOf = new Map<string, Side>()
  for (const id of meta.home ?? []) teamOf.set(id, 'home')
  for (const id of meta.away ?? []) teamOf.set(id, 'away')
  const periodMaxT = new Map<number, number>()
  let frameCount = 0
  for (const ev of stream) {
    periodMaxT.set(ev.period, Math.max(periodMaxT.get(ev.period) ?? 0, ev.t))
    if (ev.type !== 'frame') continue
    frameCount++
    for (const s of ev.home) teamOf.set(s.player, 'home')
    for (const s of ev.away) teamOf.set(s.player, 'away')
    teamOf.set(ev.homeGoalie.player, 'home')
    teamOf.set(ev.awayGoalie.player, 'away')
  }
  const homeSign = homeAttackSigns(stream, teamOf)
  const signOf = (side: Side, period: number): number => {
    const h = homeSign.get(period) ?? (period % 2 === 1 ? 1 : -1)
    return side === 'home' ? h : -h
  }
  const other = (s: Side): Side => (s === 'home' ? 'away' : 'home')
  const isD = (id: string): boolean => posOf(meta, id) === 'D'
  const fdTag = (id: string): 'F' | 'D' | null => {
    const p = posOf(meta, id)
    return p === 'D' ? 'D' : p === 'C' || p === 'W' ? 'F' : null
  }

  // Game length: regulation periods count 20 min; OT counts what was played.
  let minutes = 0
  for (const [p, maxT] of periodMaxT) minutes += p <= 3 ? 20 : Math.min(20, maxT / 60)
  m.minutes = minutes
  // Period bases on an absolute clock.
  const periodBase = new Map<number, number>()
  {
    let base = 0
    for (const p of [...periodMaxT.keys()].sort((a, b) => a - b)) {
      periodBase.set(p, base)
      base += p <= 3 ? 1200 : Math.max(periodMaxT.get(p) ?? 0, 1)
    }
  }
  const abs = (ev: { period: number; t: number }): number => (periodBase.get(ev.period) ?? 0) + ev.t

  // --- Running state ----------------------------------------------------------
  let live = false
  let lastFrame: FrameEv | null = null
  let lastFrameAbs = -1
  let stoppedSinceFrame = true
  const tracks = new Map<string, Track>()
  const goalieTracks = new Map<string, { t: number; pos: XY }>()
  const shifts = new Map<string, Shift>()
  const onIceSec = new Map<string, number>()
  const distFtBy = new Map<string, number>()
  const maxSpeedBy = new Map<string, number>()
  let puckPrev: { t: number; pos: XY } | null = null
  let possTeam: Side | null = null
  let possStart = 0
  const entryArmed: Record<Side, boolean> = { home: false, away: false }
  const lastCompletedPass: Record<Side, { t: number; bAdv: number } | null> = { home: null, away: null }
  let pendingShot: { t: number; from: XY; max: number } | null = null
  let pendingPass: { t: number; from: XY; max: number } | null = null
  let pendingFo: { t: number; side: Side } | null = null
  let lastFoAbs = -1
  // Event-proxy state (NHL-comparable; mirrors src/calibrate/importNhl.ts).
  const px = {
    prevAbs: -1,
    prevPeriod: -1,
    prevZone: 'nz' as 'oz' | 'nz' | 'dz',
    state: { home: 'outside', away: 'outside' } as Record<Side, 'outside' | 'inside'>,
    entryAt: { home: 0, away: 0 } as Record<Side, number>,
    lastShotAt: { home: -999, away: -999 } as Record<Side, number>
  }

  const closeShift = (id: string, sh: Shift, frameDt: number): void => {
    const len = sh.last - sh.start + frameDt
    if (len <= 0) return
    addSample(H['shift.lenSec'], len)
    const tag = fdTag(id)
    if (tag) addSample(H[`shift.lenSec.${tag}`], len)
    inc('shift.n')
  }

  const proxyEvent = (ev: GameEvent, actor: string, pos: XY): void => {
    if (ev.period > 3) return
    const side = teamOf.get(actor)
    if (!side) return
    const a = signOf(side, ev.period)
    const zone = thirdOf(pos, a)
    const t = abs(ev)
    if (px.prevPeriod === ev.period && px.prevAbs >= 0) {
      const gap = Math.min(Math.max(t - px.prevAbs, 0), 40)
      inc(`proxy.zone.${px.prevZone}`, gap)
    }
    px.prevAbs = t
    px.prevPeriod = ev.period
    px.prevZone = zone
    const unblocked = ev.type === 'shot'
    if (zone === 'oz') {
      if (px.state[side] === 'outside') {
        px.state[side] = 'inside'
        px.entryAt[side] = t
        inc('proxy.entries')
      }
      if (unblocked) {
        inc('proxy.shots')
        if (t - px.entryAt[side] <= 6) inc('proxy.rushShots')
        if (t - px.lastShotAt[side] <= 3) inc('proxy.reboundShots')
        px.lastShotAt[side] = t
      }
    } else if (px.state[side] === 'inside') px.state[side] = 'outside'
  }
  const proxyReset = (): void => {
    px.state.home = 'outside'
    px.state.away = 'outside'
  }

  const onStop = (): void => {
    live = false
    stoppedSinceFrame = true
    tracks.clear()
    goalieTracks.clear()
    puckPrev = null
    pendingShot = null
    pendingPass = null
  }

  const skatersOf = (f: FrameEv, side: Side) => (side === 'home' ? f.home : f.away)

  // --- Frame handler ---------------------------------------------------------
  const onFrame = (f: FrameEv): void => {
    const t = abs(f)
    const dt = lastFrame && lastFrame.period === f.period ? t - lastFrameAbs : 0
    const frameDt = dt > 0 && dt <= MAX_TRACK_GAP_S ? dt : 0.25
    inc('frame.n')
    inc('frame.sec', frameDt)
    if (live) inc('frame.liveSec', frameDt)

    // Shifts / on-ice time (skaters only).
    const present = new Set<string>()
    for (const s of [...f.home, ...f.away]) {
      present.add(s.player)
      const sh = shifts.get(s.player)
      if (sh && t - sh.last <= SHIFT_GAP_S) sh.last = t
      else {
        if (sh) closeShift(s.player, sh, frameDt)
        shifts.set(s.player, { start: t, last: t })
      }
      onIceSec.set(s.player, (onIceSec.get(s.player) ?? 0) + frameDt)
    }

    const continuous = !stoppedSinceFrame && dt > 0 && dt <= MAX_TRACK_GAP_S && live
    // Kinematics.
    for (const side of ['home', 'away'] as const) {
      for (const s of skatersOf(f, side)) {
        const prev = tracks.get(s.player)
        const posFt = { x: s.pos.x * HALF_LENGTH_FT, y: s.pos.y * HALF_WIDTH_FT }
        if (!continuous || !prev || t - prev.t > MAX_TRACK_GAP_S || t - prev.t <= 0) {
          if (prev && dt > 0 && t - prev.t > 0 && t - prev.t <= MAX_TRACK_GAP_S && !live) {
            // Dead-puck jump check (faceoff staging): not skating, but visible.
            const v = Math.hypot(posFt.x - prev.pos.x, posFt.y - prev.pos.y) / (t - prev.t)
            if (v > TELEPORT_FT_S) inc('motion.teleportsDead')
          }
          tracks.set(s.player, { t, pos: posFt, vel: null, acc: null, speed: 0 })
          continue
        }
        const h = t - prev.t
        const vel = { x: (posFt.x - prev.pos.x) / h, y: (posFt.y - prev.pos.y) / h }
        const speed = Math.hypot(vel.x, vel.y)
        if (speed > TELEPORT_FT_S) {
          inc('motion.teleportsLive')
          tracks.set(s.player, { t, pos: posFt, vel: null, acc: null, speed: 0 })
          continue
        }
        const mph = speed / FT_PER_S_PER_MPH
        addSample(H['skate.speedMph'], mph)
        const tag = fdTag(s.player)
        if (tag) addSample(H[`skate.speedMph.${tag}`], mph)
        inc('skate.samples')
        distFtBy.set(s.player, (distFtBy.get(s.player) ?? 0) + speed * h)
        if (mph > (maxSpeedBy.get(s.player) ?? 0)) maxSpeedBy.set(s.player, mph)
        let acc: XY | null = null
        if (prev.vel) {
          if (speed >= MPH20 && prev.speed < MPH20) inc('skate.bursts20')
          if (speed >= MPH22 && prev.speed < MPH22) inc('skate.bursts22')
          acc = { x: (vel.x - prev.vel.x) / h, y: (vel.y - prev.vel.y) / h }
          addSample(H['skate.accelFt'], Math.hypot(acc.x, acc.y))
          addSample(H['skate.tangAccelFt'], Math.abs(speed - prev.speed) / h)
          const vm = { x: (vel.x + prev.vel.x) / 2, y: (vel.y + prev.vel.y) / 2 }
          const vmS = Math.hypot(vm.x, vm.y)
          if (vmS >= 10 * FT_PER_S_PER_MPH) {
            const lat = Math.abs(vm.x * acc.y - vm.y * acc.x) / vmS
            addSample(H['skate.latAccelFt'], lat)
            if (lat > 0.5) {
              const r = (vmS * vmS) / lat
              const vmMph = vmS / FT_PER_S_PER_MPH
              const key = vmMph >= 20 ? 'skate.radiusFt.20plus' : vmMph >= 15 ? 'skate.radiusFt.15to20' : 'skate.radiusFt.10to15'
              addSample(H[key], r)
            }
          }
          if (prev.acc) addSample(H['skate.jerkFt'], Math.hypot(acc.x - prev.acc.x, acc.y - prev.acc.y) / h)
        }
        tracks.set(s.player, { t, pos: posFt, vel, acc, speed })
      }
    }
    // Drop tracks of skaters who left.
    for (const id of [...tracks.keys()]) if (!present.has(id)) tracks.delete(id)

    // Goalies: lateral speed + depth/angle.
    for (const side of ['home', 'away'] as const) {
      const g = side === 'home' ? f.homeGoalie : f.awayGoalie
      const gFt = { x: g.pos.x * HALF_LENGTH_FT, y: g.pos.y * HALF_WIDTH_FT }
      const prev = goalieTracks.get(g.player)
      if (continuous && prev && t - prev.t > 0) {
        addSample(H['goalie.latSpeedMph'], Math.abs(gFt.y - prev.pos.y) / (t - prev.t) / FT_PER_S_PER_MPH)
      }
      goalieTracks.set(g.player, { t, pos: gFt })
      if (!live) continue
      const a = signOf(side, f.period)
      // In the goalie's own attack frame his net is at x = -89.
      const gA = af(g.pos, a)
      const pA = af(f.puck, a)
      if (pA.x < -BLUE_LINE_FT && pA.x > -GOAL_LINE_FT && Math.abs(gA.x) > 60) {
        const depth = gA.x + GOAL_LINE_FT // ft out from the goal line
        addSample(H['goalie.depthFt'], depth)
        // Perpendicular distance from goalie to the puck→net-centre line.
        const nx = -GOAL_LINE_FT
        const dx = nx - pA.x
        const dy = 0 - pA.y
        const len = Math.hypot(dx, dy)
        if (len > 1) addSample(H['goalie.angleErrFt'], Math.abs(dx * (gA.y - pA.y) - dy * (gA.x - pA.x)) / len)
      }
    }

    // Puck in flight (no carrier): speed samples + shot/pass speed capture.
    if (continuous && puckPrev && f.puckCarrier === null && t - puckPrev.t > 0) {
      const v = distFt(f.puck, puckPrev.pos) / (t - puckPrev.t) / FT_PER_S_PER_MPH
      addSample(H['puck.freeSpeedMph'], v)
      if (pendingShot && t - pendingShot.t <= 0.75) pendingShot.max = Math.max(pendingShot.max, v)
      if (pendingPass && t - pendingPass.t <= 1.5) pendingPass.max = Math.max(pendingPass.max, v)
    }
    if (pendingShot && t - pendingShot.t > 0.75) {
      if (pendingShot.max > 0) addSample(H['shot.speedMph'], pendingShot.max)
      pendingShot = null
    }
    if (pendingPass && (t - pendingPass.t > 1.5 || f.puckCarrier !== null)) {
      if (pendingPass.max > 0) addSample(H['pass.speedMph'], pendingPass.max)
      pendingPass = null
    }
    puckPrev = { t, pos: f.puck }

    // Possession.
    const carrierSide = f.puckCarrier ? teamOf.get(f.puckCarrier) ?? null : null
    if (carrierSide && carrierSide !== possTeam) {
      if (possTeam && live) addSample(H['flow.possessionSec'], t - possStart)
      possTeam = carrierSide
      possStart = t
      inc('poss.changes')
    }

    if (live && possTeam) {
      const a = signOf(possTeam, f.period)
      const adv = advFt(f.puck, a)
      // Frame-based zone time (possessing team's perspective).
      inc(`zone.${thirdOf(f.puck, a)}`, frameDt)
      // Zone entries across the offensive blue line.
      if (adv < BLUE_LINE_FT - 10) entryArmed[possTeam] = true
      const prevAdv = lastFrame ? advFt(lastFrame.puck, a) : adv
      if (continuous && entryArmed[possTeam] && prevAdv < BLUE_LINE_FT && adv >= BLUE_LINE_FT) {
        entryArmed[possTeam] = false
        const lp = lastCompletedPass[possTeam]
        const kind =
          carrierSide === possTeam
            ? 'carry'
            : lp && t - lp.t <= 2.5 && lp.bAdv >= BLUE_LINE_FT - 5
              ? 'pass'
              : 'dump'
        inc('entry.n')
        inc(`entry.${kind}`)
        // Odd-man: attackers level with/ahead of the puck vs defenders goal-side.
        const atk = skatersOf(f, possTeam).filter((s) => advFt(s.pos, a) >= adv - 10).length
        const def = skatersOf(f, other(possTeam)).filter((s) => advFt(s.pos, a) > adv).length
        if (t - possStart <= 8 && atk > def) inc('entry.oddMan')
      }
    }

    // Team shape (live, both units at 5, a settled carrier).
    if (live && possTeam && carrierSide === possTeam && f.home.length === 5 && f.away.length === 5) {
      const a = signOf(possTeam, f.period)
      const att = skatersOf(f, possTeam)
      const def = skatersOf(f, other(possTeam))
      const attP = att.map((s) => af(s.pos, a))
      const defP = def.map((s) => af(s.pos, a))
      addSample(H['shape.spacingAttFt'], meanPairwise(attP))
      addSample(H['shape.spacingDefFt'], meanPairwise(defP))
      addSample(H['shape.compactAttFt'], compactness(attP))
      addSample(H['shape.compactDefFt'], compactness(defP))
      addSample(H['shape.widthAttFt'], Math.max(...attP.map((p) => p.y)) - Math.min(...attP.map((p) => p.y)))
      addSample(H['shape.depthAttFt'], Math.max(...attP.map((p) => p.x)) - Math.min(...attP.map((p) => p.x)))
      const dAtt = att.filter((s) => isD(s.player))
      const dDef = def.filter((s) => isD(s.player))
      if (dAtt.length === 2) addSample(H['shape.dPairAttFt'], distFt(dAtt[0].pos, dAtt[1].pos))
      if (dDef.length === 2) addSample(H['shape.dPairDefFt'], distFt(dDef[0].pos, dDef[1].pos))
      const carrier = att.find((s) => s.player === f.puckCarrier)
      if (carrier) {
        const cA = af(carrier.pos, a)
        let nearest = Infinity
        let nearestGoalSide = Infinity
        for (const p of defP) {
          const d = Math.hypot(p.x - cA.x, p.y - cA.y)
          nearest = Math.min(nearest, d)
          if (p.x > cA.x) nearestGoalSide = Math.min(nearestGoalSide, d)
        }
        addSample(H['shape.pressureFt'], nearest)
        const tr = tracks.get(carrier.player)
        const vxA = tr?.vel ? tr.vel.x * a : 0
        if (Math.abs(cA.x) <= BLUE_LINE_FT && vxA > 10 && Number.isFinite(nearestGoalSide)) {
          addSample(H['shape.gapFt'], nearestGoalSide)
        }
      }
      const pA = af(f.puck, a)
      if (pA.x > BLUE_LINE_FT) {
        addSample(H['shape.attackersInOz'], attP.filter((p) => p.x > BLUE_LINE_FT).length)
        addSample(H['shape.defendersInDz'], defP.filter((p) => p.x > BLUE_LINE_FT).length)
      }
    }

    // Shape templates (live, settled carrier).
    if (live && possTeam && carrierSide === possTeam) {
      const a = signOf(possTeam, f.period)
      scoreShapes(
        af(f.puck, a),
        skatersOf(f, possTeam).map((s) => af(s.pos, a)),
        skatersOf(f, other(possTeam)).map((s) => af(s.pos, a)),
        m.shapes,
        templates
      )
    }

    // Heat map + overlaps (live).
    if (live) {
      const all = [...f.home, ...f.away]
      for (const side of ['home', 'away'] as const) {
        const a = signOf(side, f.period)
        for (const s of skatersOf(f, side)) {
          const p = af(s.pos, a)
          gridAdd(m.grids['heat.skaters'], p.x, p.y)
        }
      }
      let overl = 0
      for (let i = 0; i < all.length; i++)
        for (let j = i + 1; j < all.length; j++) if (distFt(all[i].pos, all[j].pos) < OVERLAP_FT) overl++
      inc('motion.overlapPairs', overl)
      inc('motion.liveFrames')
    }

    lastFrame = f
    lastFrameAbs = t
    stoppedSinceFrame = false
  }

  // --- Event loop ---------------------------------------------------------------
  const sideOf = (id: string): Side | null => teamOf.get(id) ?? null
  const strengthOf = (side: Side): 'pp' | 'sh' | 'ev' => {
    if (!lastFrame) return 'ev'
    const mine = skatersOf(lastFrame, side).length
    const theirs = skatersOf(lastFrame, other(side)).length
    return mine > theirs ? 'pp' : mine < theirs ? 'sh' : 'ev'
  }
  const posInFrame = (id: string): XY | null => {
    if (!lastFrame) return null
    for (const s of [...lastFrame.home, ...lastFrame.away]) if (s.player === id) return s.pos
    return null
  }

  for (const ev of stream) {
    switch (ev.type) {
      case 'frame':
        onFrame(ev)
        break
      case 'faceoff': {
        const t = abs(ev)
        inc('fo.n')
        if (lastFoAbs >= 0 && t > lastFoAbs) addSample(H['flow.foGapSec'], t - lastFoAbs)
        lastFoAbs = t
        const hz = thirdOf(ev.pos, signOf('home', ev.period))
        inc(`fo.home.${hz}`)
        const side = sideOf(ev.winner)
        pendingFo = side ? { t, side } : null
        if (side && possTeam !== side) {
          possTeam = side
          possStart = t
        }
        live = true
        stoppedSinceFrame = true
        proxyEvent(ev, ev.winner, ev.pos)
        proxyReset()
        break
      }
      case 'pass': {
        const side = sideOf(ev.from)
        if (!side) break
        const t = abs(ev)
        const a = signOf(side, ev.period)
        const dxA = (ev.b.x - ev.a.x) * HALF_LENGTH_FT * a
        const dyA = (ev.b.y - ev.a.y) * HALF_WIDTH_FT
        const len = Math.hypot(dxA, dyA)
        addSample(H['pass.lengthFt'], len)
        // Direction relative to the attack: forward within ±70°, backward beyond ±110°.
        const ang = (Math.atan2(Math.abs(dyA), dxA) * 180) / Math.PI
        const dir = len < 3 ? 'lat' : ang <= 70 ? 'fwd' : ang >= 110 ? 'back' : 'lat'
        const zone = thirdOf(ev.a, a)
        const buckets = ['pass', `pass.${zone}`]
        const passerPos = posInFrame(ev.from) ?? ev.a
        const passerAdv = advFt(passerPos, a)
        const inRush = t - possStart <= 8 && passerAdv > -BLUE_LINE_FT
        const f = lastFrame
        let goalSideDef = 99
        let atkAhead = 0
        if (f) {
          goalSideDef = skatersOf(f, other(side)).filter((s) => advFt(s.pos, a) > passerAdv).length
          atkAhead = skatersOf(f, side).filter((s) => advFt(s.pos, a) >= passerAdv - 10).length
        }
        if (inRush) buckets.push('pass.rush')
        if (inRush && atkAhead > goalSideDef) buckets.push('pass.oddMan')
        if (f && goalSideDef === 0 && passerAdv > 0) buckets.push('pass.breakaway')
        const st = strengthOf(side)
        if (st !== 'ev') buckets.push(`pass.${st}`)
        if (!inRush && zone === 'oz') buckets.push('pass.ozSetup')
        for (const b of buckets) {
          inc(`${b}.n`)
          inc(`${b}.${dir}`)
          if (ev.completed) inc(`${b}.completed`)
        }
        if (ev.completed) lastCompletedPass[side] = { t, bAdv: advFt(ev.b, a) }
        pendingPass = { t, from: ev.a, max: 0 }
        break
      }
      case 'shot': {
        const side = sideOf(ev.shooter)
        if (!side) break
        const a = signOf(side, ev.period)
        const t = abs(ev)
        inc('shot.sog')
        inc(`shot.sog.${side}`)
        const g = shotGeometry(ev.from, a)
        addSample(H['shot.distFt'], g.dist)
        addSample(H['shot.danger'], ev.danger)
        const grid = m.grids['shot.distAngle']
        const di = binIndex(distanceEdges, g.dist)
        const ai = binIndex(angleEdges, g.angle)
        grid.cells[di * grid.cols + ai]++
        grid.n++
        const p = af(ev.from, a)
        gridAdd(m.grids['heat.shots'], p.x, p.y)
        if (t - possStart <= 8) inc('shot.inRushWindow')
        if (pendingFo && pendingFo.side === side && t - pendingFo.t <= 10) {
          inc('fo.followShot10')
          pendingFo = null
        }
        pendingShot = { t, from: ev.from, max: 0 }
        proxyEvent(ev, ev.shooter, ev.from)
        break
      }
      case 'blockedShot': {
        // (Faceoff follow-up counts UNBLOCKED attempts only, as the NHL aggregate does.)
        inc('shot.blocked')
        proxyEvent(ev, ev.shooter, ev.pos)
        break
      }
      case 'save':
        inc('save.n')
        if (ev.rebound) inc('save.rebound')
        else inc('save.freeze')
        break
      case 'goal':
        inc('goal.n')
        inc(`goal.${ev.strength}`)
        proxyEvent(ev, ev.scorer, ev.pos)
        break
      case 'hit': {
        inc('hit.n')
        const bd = boardDistFt(ev.pos)
        addSample(H['hit.boardDistFt'], bd)
        if (bd <= 10) inc('hit.boards')
        const side = sideOf(ev.by)
        if (side) {
          const a = signOf(side, ev.period)
          inc(`hit.${thirdOf(ev.pos, a)}`)
          const p = af(ev.pos, a)
          gridAdd(m.grids['heat.hits'], p.x, p.y)
        }
        const tag = fdTag(ev.by)
        if (tag) inc(`hit.by${tag}`)
        if (lastFrame && lastFrame.puckCarrier === ev.on) inc('hit.onCarrier')
        proxyEvent(ev, ev.by, ev.pos)
        break
      }
      case 'penalty':
        inc('pen.n')
        inc(`pen.type.${ev.infraction}`)
        inc('pen.minutes', ev.minutes)
        break
      case 'takeaway':
        inc('takeaway.n')
        proxyEvent(ev, ev.by, ev.pos)
        break
      case 'giveaway':
        inc('giveaway.n')
        proxyEvent(ev, ev.player, ev.pos)
        break
      case 'lineChange':
        inc('lc.n')
        if (live) inc('lc.onFly')
        break
      case 'carry':
        inc('carry.n')
        break
      case 'whistle':
        inc('whistle.n')
        inc(`whistle.reason.${ev.reason ?? 'none'}`)
        if (possTeam && live) addSample(H['flow.possessionSec'], abs(ev) - possStart)
        onStop()
        proxyReset()
        break
      case 'periodEnd':
      case 'gameEnd':
        if (possTeam && live) addSample(H['flow.possessionSec'], abs(ev) - possStart)
        onStop()
        proxyReset()
        possTeam = null
        lastFrame = null
        break
    }
  }

  // Close shifts & per-skater game totals.
  for (const [id, sh] of shifts) closeShift(id, sh, 0.25)
  for (const [id, sec] of onIceSec) {
    if (sec < 120) continue // ignore cameo skaters (< 2 min)
    const miles = (distFtBy.get(id) ?? 0) / 5280
    const per60 = (miles / sec) * 3600
    addSample(H['skate.milesPer60'], per60)
    const tag = fdTag(id)
    if (tag) addSample(H[`skate.milesPer60.${tag}`], per60)
    addSample(H['skate.gameMaxMph'], maxSpeedBy.get(id) ?? 0)
    inc('skate.skaterGames')
  }
  m.frameMinutes = (C['frame.sec'] ?? 0) / 60
  if (frameCount === 0) inc('stream.noFrames')
  return m
}
