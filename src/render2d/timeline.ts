/**
 * Playback model for a watched game (build step #4, the renderer half).
 *
 * Pure + DOM-free so it can be unit-tested: it consumes a `GameStream` (the
 * keystone the engine emits) and turns it into something a renderer can scrub.
 * It indexes the dense `frame` events on an absolute game clock, interpolates
 * skater/puck positions between frames, and reconstructs the running score and
 * period clock at any instant. The renderer never computes hockey — it only
 * reads this.
 */
import type { FrameEvent, GameStream, PlayerId, XY } from '@domain'
import { isEvent } from '@domain'

const REGULATION_PERIOD_SECONDS = 1200

/**
 * Sorted list of absolute times at which play stops (whistle or faceoff).
 * Used by sampleAt() to snap the puck rather than lerp it across a stoppage.
 */
type StoppageMark = { absT: number }

/**
 * Absolute elapsed seconds from opening faceoff (periods laid end to end).
 *
 * For regulation periods (1–3) each is exactly 1200 s. For overtime periods
 * (4+) the caller should use the MatchTimeline.periodAbsBase() helper so that
 * the correct per-period length is derived from the stream; this bare function
 * is only accurate for regulation.
 */
export function absTime(period: number, t: number): number {
  return (period - 1) * REGULATION_PERIOD_SECONDS + t
}

/**
 * Absolute clock offset at which each period starts, derived from the stream.
 * Regulation periods are 1200 s each; an overtime period's length comes from
 * the latest event seen inside it, so 3v3 OT (~300 s) and a 20-minute playoff
 * OT both lay end to end correctly without hard-coding either.
 *
 * Shared so every consumer of the stream places an event on the SAME clock the
 * timeline scrubs on — MatchViewer used to assume 1200 s per period, which
 * drifts by minutes once a playoff game reaches a second overtime.
 */
export function periodBases(stream: GameStream): Map<number, number> {
  // Frames first — they define the period the way MatchTimeline sees it. Streams
  // with no positional frames (the quick sim, synthetic test streams) fall back
  // to their other events so the helper still places them.
  const maxT = new Map<number, number>()
  for (const ev of stream) {
    if (ev.type !== 'frame') continue
    const prev = maxT.get(ev.period) ?? 0
    if (ev.t > prev) maxT.set(ev.period, ev.t)
  }
  for (const ev of stream) {
    if (ev.type === 'frame' || maxT.has(ev.period)) continue
    const prev = maxT.get(ev.period) ?? 0
    if (ev.t > prev) maxT.set(ev.period, ev.t)
  }
  const bases = new Map<number, number>()
  let base = 0
  for (const p of [...maxT.keys()].sort((a, b) => a - b)) {
    bases.set(p, base)
    base += p <= 3 ? REGULATION_PERIOD_SECONDS : (maxT.get(p) ?? REGULATION_PERIOD_SECONDS)
  }
  if (!bases.has(1)) bases.set(1, 0)
  return bases
}

export interface PosSnapshot {
  home: XY[]
  away: XY[]
  homeGoalie: XY
  awayGoalie: XY
  puck: XY
  carrier: PlayerId | null
  /** Player IDs at each skater index — parallel to home[]. Undefined in snapshots from older code paths. */
  homeIds?: (PlayerId | undefined)[]
  /** Player IDs at each skater index — parallel to away[]. */
  awayIds?: (PlayerId | undefined)[]
  /** Goalie player ID (home side). */
  homeGoalieId?: PlayerId
  /** Goalie player ID (away side). */
  awayGoalieId?: PlayerId
}

export interface ClockLabel {
  period: number
  /** "MM:SS" counting down within the period. */
  text: string
}

interface Indexed {
  absT: number
  frame: FrameEvent
}

interface ScoreMark {
  absT: number
  home: boolean
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f
}

function lerpXY(a: XY, b: XY, f: number): XY {
  return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) }
}

/** Keep an interpolated point on the sheet (a spline may overshoot a corner). */
function clampRink(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v
}

/**
 * Catmull-Rom through p1 → p2, using p0 and p3 as tangent hints.
 *
 * WHY (playtest C2, "2× is laggy"): the engine emits one positional frame every
 * 0.25 s, and straight-line interpolation between consecutive frames means the
 * skaters change direction at every frame boundary. At 1× that's 4 kinks a
 * second across 15 rendered frames each and the eye never sees it; the 2× nudge
 * runs open play at 4× and whistle-to-faceoff dead time at 10×, which is 16–40
 * kinks a second over as little as 1.5 rendered frames per engine frame. The
 * profile (docs/perf/2d-match-cpu-profile.txt) shows the frame pipeline idle at
 * both speeds — the judder is the polyline, not the frame rate. A spline curves
 * through the same control points, so fast playback reads as motion instead of
 * a stutter, and it costs a few multiplies on a thread that is 84% idle.
 *
 * The curve passes exactly through p1 at f=0 and p2 at f=1, so every position
 * the engine actually stated is still rendered verbatim.
 */
function splineXY(p0: XY, p1: XY, p2: XY, p3: XY, f: number): XY {
  const f2 = f * f
  const f3 = f2 * f
  const c = (a: number, b: number, cc: number, d: number): number =>
    0.5 * (2 * b + (cc - a) * f + (2 * a - 5 * b + 4 * cc - d) * f2 + (3 * b - 3 * cc + d) * f3)
  return {
    x: clampRink(c(p0.x, p1.x, p2.x, p3.x)),
    y: clampRink(c(p0.y, p1.y, p2.y, p3.y)),
  }
}

export class MatchTimeline {
  private readonly frames: Indexed[] = []
  private readonly goals: ScoreMark[] = []
  /**
   * Sorted absolute times of whistle + faceoff events.
   * sampleAt() uses this to snap the puck instead of lerping it across a
   * stoppage, which would cause the puck to slide across the ice to the
   * faceoff dot.
   */
  private readonly stoppages: StoppageMark[] = []
  /**
   * Absolute clock offset at the start of each period (1-indexed).
   * Regulation periods are each 1200 s; OT periods (4+) derive their length
   * from the max `t` seen in that period's frames (so 3v3 OT is ~300 s and
   * playoff 20-min OT is ~1200 s, without any hard-coding).
   */
  private readonly periodBase: Map<number, number> = new Map()
  /**
   * Length in seconds of each period, derived from the max frame `t` seen.
   * Falls back to REGULATION_PERIOD_SECONDS for periods with no frames.
   */
  private readonly periodLength: Map<number, number> = new Map()
  readonly duration: number
  readonly homeFinal: number
  readonly awayFinal: number

  constructor(stream: GameStream, isHomePlayer: (id: PlayerId) => boolean) {
    // First pass: find the max frame.t per period to know each period's length.
    const maxT = new Map<number, number>()
    for (const ev of stream) {
      if (isEvent(ev, 'frame')) {
        const prev = maxT.get(ev.period) ?? 0
        if (ev.t > prev) maxT.set(ev.period, ev.t)
      }
    }

    // Build the absolute base offset for each period in ascending order.
    // Periods are guaranteed to be in 1, 2, 3[, 4[, 5...]] order.
    const allPeriods = [...maxT.keys()].sort((a, b) => a - b)
    let base = 0
    for (const p of allPeriods) {
      this.periodBase.set(p, base)
      const len = p <= 3 ? REGULATION_PERIOD_SECONDS : (maxT.get(p) ?? REGULATION_PERIOD_SECONDS)
      this.periodLength.set(p, len)
      base += len
    }

    // Second pass: index frames + goals + stoppages with their true absolute times.
    for (const ev of stream) {
      if (isEvent(ev, 'frame')) {
        const pBase = this.periodBase.get(ev.period) ?? (ev.period - 1) * REGULATION_PERIOD_SECONDS
        this.frames.push({ absT: pBase + ev.t, frame: ev })
      } else if (isEvent(ev, 'goal')) {
        const pBase = this.periodBase.get(ev.period) ?? (ev.period - 1) * REGULATION_PERIOD_SECONDS
        this.goals.push({ absT: pBase + ev.t, home: isHomePlayer(ev.scorer) })
      } else if (isEvent(ev, 'whistle') || isEvent(ev, 'faceoff')) {
        // Index stoppages so sampleAt() can snap the puck at stoppage boundaries
        // instead of lerping it across the ice to the new faceoff position.
        const pBase = this.periodBase.get(ev.period) ?? (ev.period - 1) * REGULATION_PERIOD_SECONDS
        this.stoppages.push({ absT: pBase + ev.t })
      }
    }
    // stoppages are already in stream order (ascending absT)
    this.duration = this.frames.length ? this.frames[this.frames.length - 1].absT : 0
    let h = 0
    let a = 0
    for (const g of this.goals) g.home ? h++ : a++
    this.homeFinal = h
    this.awayFinal = a
  }

  /** Index of the last frame at or before `absT` (binary search). */
  private frameIndexAt(absT: number): number {
    const f = this.frames
    if (f.length === 0) return -1
    let lo = 0
    let hi = f.length - 1
    if (absT <= f[0].absT) return 0
    if (absT >= f[hi].absT) return hi
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (f[mid].absT <= absT) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  /** Interpolated positions at an absolute time. */
  sampleAt(absT: number): PosSnapshot | null {
    const i = this.frameIndexAt(absT)
    if (i < 0) return null
    const a = this.frames[i].frame
    const next = this.frames[i + 1]
    if (!next) return snapshotOf(a)
    const b = next.frame
    const frameAT = this.frames[i].absT
    const frameBT = next.absT
    const span = frameBT - frameAT
    const f = span > 0 ? (absT - frameAT) / span : 0

    // Puck snap: if a whistle or faceoff falls strictly between the two
    // bracketing frames, the puck has been reset to a new faceoff position.
    // Instead of lerping it across the ice (visible slide), we use frame A's
    // puck position for absT before the stoppage, and frame B's position after.
    // Skaters continue to ease normally — only the puck snaps.
    const stoppageT = this.firstStoppageBetween(frameAT, frameBT)

    // Tangent frames for the spline. A stoppage anywhere in the four-frame
    // window means the positions on the far side belong to a different piece of
    // play (the teams are skating to a faceoff dot), so we fall back to the
    // straight line there rather than curving between two unrelated states.
    const prev = this.frames[i - 1]?.frame
    const after = this.frames[i + 2]?.frame
    const smooth =
      prev !== undefined &&
      after !== undefined &&
      stoppageT === null &&
      this.firstStoppageBetween(this.frames[i - 1].absT, frameAT) === null &&
      this.firstStoppageBetween(frameBT, this.frames[i + 2].absT) === null

    const puck = stoppageT !== null
      ? (absT < stoppageT ? { ...a.puck } : { ...b.puck })
      : smooth
        ? splineXY(prev!.puck, a.puck, b.puck, after!.puck, f)
        : lerpXY(a.puck, b.puck, f)

    // For player IDs use the dominant frame (same side-selection as carrier/blendOne)
    const dom = f < 0.5 ? a : b
    return {
      home: blend(a.home, b.home, f, smooth ? prev!.home : undefined, smooth ? after!.home : undefined),
      away: blend(a.away, b.away, f, smooth ? prev!.away : undefined, smooth ? after!.away : undefined),
      homeGoalie: blendOne(a.homeGoalie, b.homeGoalie, f, smooth ? prev!.homeGoalie : undefined, smooth ? after!.homeGoalie : undefined),
      awayGoalie: blendOne(a.awayGoalie, b.awayGoalie, f, smooth ? prev!.awayGoalie : undefined, smooth ? after!.awayGoalie : undefined),
      puck,
      carrier: dom.puckCarrier,
      homeIds: dom.home.map((s) => s.player),
      awayIds: dom.away.map((s) => s.player),
      homeGoalieId: dom.homeGoalie.player,
      awayGoalieId: dom.awayGoalie.player,
    }
  }

  /**
   * Returns the absolute time of the first stoppage strictly between frameAT
   * (exclusive) and frameBT (inclusive), or null if none exists.
   */
  private firstStoppageBetween(frameAT: number, frameBT: number): number | null {
    // Binary search — stoppages are indexed in ascending order, and sampleAt
    // asks this three times per rendered frame.
    const s = this.stoppages
    let lo = 0
    let hi = s.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (s[mid].absT <= frameAT) lo = mid + 1
      else hi = mid
    }
    const first = s[lo]
    return first !== undefined && first.absT <= frameBT ? first.absT : null
  }

  scoreAt(absT: number): { home: number; away: number } {
    let home = 0
    let away = 0
    for (const g of this.goals) {
      if (g.absT > absT) break
      g.home ? home++ : away++
    }
    return { home, away }
  }

  clockAt(absT: number): ClockLabel {
    // Walk periods in ascending order, find which one this absT falls in.
    const sortedPeriods = [...this.periodBase.keys()].sort((a, b) => a - b)
    let period = 1
    let periodStart = 0
    let periodLen = REGULATION_PERIOD_SECONDS
    for (const p of sortedPeriods) {
      const base = this.periodBase.get(p)!
      const len = this.periodLength.get(p) ?? REGULATION_PERIOD_SECONDS
      if (absT >= base && absT < base + len) {
        period = p
        periodStart = base
        periodLen = len
        break
      }
      // If absT is past all known periods (game end), use the last one.
      if (absT >= base) {
        period = p
        periodStart = base
        periodLen = len
      }
    }
    // Fall back for streams with no frames (pure regulation).
    if (sortedPeriods.length === 0) {
      period = Math.min(3, Math.floor(absT / REGULATION_PERIOD_SECONDS) + 1)
      periodStart = (period - 1) * REGULATION_PERIOD_SECONDS
      periodLen = REGULATION_PERIOD_SECONDS
    }
    const elapsed = absT - periodStart
    const remaining = Math.max(0, periodLen - elapsed)
    const r = Math.ceil(remaining)
    const mm = Math.floor(r / 60)
    const ss = r % 60
    return { period, text: `${mm}:${ss.toString().padStart(2, '0')}` }
  }
}

function snapshotOf(frame: FrameEvent): PosSnapshot {
  return {
    home: frame.home.map((s) => ({ ...s.pos })),
    away: frame.away.map((s) => ({ ...s.pos })),
    homeGoalie: { ...frame.homeGoalie.pos },
    awayGoalie: { ...frame.awayGoalie.pos },
    puck: { ...frame.puck },
    carrier: frame.puckCarrier,
    homeIds: frame.home.map((s) => s.player),
    awayIds: frame.away.map((s) => s.player),
    homeGoalieId: frame.homeGoalie.player,
    awayGoalieId: frame.awayGoalie.player,
  }
}

type Slot = { player: PlayerId; pos: XY }

/**
 * Interpolate positions index-by-index, but snap to the later frame when the
 * skater at that index changed (a line change) so we don't blend two different
 * players. `p` and `n` are the neighbouring frames: when the SAME player holds
 * the slot across all four, the path is splined instead of straight-lined (see
 * splineXY), which is what keeps fast playback readable.
 */
function blend(a: Slot[], b: Slot[], f: number, p?: Slot[], n?: Slot[]): XY[] {
  return b.map((bs, i) => {
    const as = a[i]
    if (!as || as.player !== bs.player) return { ...bs.pos }
    const ps = p?.[i]
    const ns = n?.[i]
    if (ps && ns && ps.player === as.player && ns.player === bs.player) {
      return splineXY(ps.pos, as.pos, bs.pos, ns.pos, f)
    }
    return lerpXY(as.pos, bs.pos, f)
  })
}

function blendOne(a: Slot, b: Slot, f: number, p?: Slot, n?: Slot): XY {
  if (a.player !== b.player) return { ...b.pos }
  if (p && n && p.player === a.player && n.player === b.player) {
    return splineXY(p.pos, a.pos, b.pos, n.pos, f)
  }
  return lerpXY(a.pos, b.pos, f)
}
