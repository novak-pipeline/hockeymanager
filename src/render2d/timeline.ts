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

export interface PosSnapshot {
  home: XY[]
  away: XY[]
  homeGoalie: XY
  awayGoalie: XY
  puck: XY
  carrier: PlayerId | null
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

export class MatchTimeline {
  private readonly frames: Indexed[] = []
  private readonly goals: ScoreMark[] = []
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

    // Second pass: index frames with their true absolute times.
    for (const ev of stream) {
      if (isEvent(ev, 'frame')) {
        const pBase = this.periodBase.get(ev.period) ?? (ev.period - 1) * REGULATION_PERIOD_SECONDS
        this.frames.push({ absT: pBase + ev.t, frame: ev })
      } else if (isEvent(ev, 'goal')) {
        const pBase = this.periodBase.get(ev.period) ?? (ev.period - 1) * REGULATION_PERIOD_SECONDS
        this.goals.push({ absT: pBase + ev.t, home: isHomePlayer(ev.scorer) })
      }
    }
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
    const span = next.absT - this.frames[i].absT
    const f = span > 0 ? (absT - this.frames[i].absT) / span : 0
    return {
      home: blend(a.home, b.home, f),
      away: blend(a.away, b.away, f),
      homeGoalie: blendOne(a.homeGoalie, b.homeGoalie, f),
      awayGoalie: blendOne(a.awayGoalie, b.awayGoalie, f),
      puck: lerpXY(a.puck, b.puck, f),
      carrier: f < 0.5 ? a.puckCarrier : b.puckCarrier
    }
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
    carrier: frame.puckCarrier
  }
}

/**
 * Lerp positions index-by-index, but snap to the later frame when the skater at
 * that index changed (a line change) so we don't blend two different players.
 */
function blend(
  a: { player: PlayerId; pos: XY }[],
  b: { player: PlayerId; pos: XY }[],
  f: number
): XY[] {
  return b.map((bs, i) => {
    const as = a[i]
    return as && as.player === bs.player ? lerpXY(as.pos, bs.pos, f) : { ...bs.pos }
  })
}

function blendOne(
  a: { player: PlayerId; pos: XY },
  b: { player: PlayerId; pos: XY },
  f: number
): XY {
  return a.player === b.player ? lerpXY(a.pos, b.pos, f) : { ...b.pos }
}
