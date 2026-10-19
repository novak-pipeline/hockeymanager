/**
 * Dead-puck windows for the camera: a goal or a whistle until the faceoff that
 * ends it, with that faceoff's spot (world ft). During the dead time the game
 * camera frames the NEXT faceoff, and the director may cut (W3 S7: cuts only
 * at stoppages).
 */
import { playAbsT, type GameStream } from '@domain'
import { normXtoWorld, normYtoWorld } from '../math'

export interface DeadWindow {
  from: number
  to: number
  x: number
  z: number
}

/**
 * `periodEnds`: a period's end opens a window too (the camera's view: the next
 * period opens with a faceoff, and the frame cuts there rather than panning).
 */
export function deadWindowsOf(stream: GameStream, opts: { periodEnds?: boolean } = {}): DeadWindow[] {
  const out: DeadWindow[] = []
  let pending: number | null = null
  for (const ev of stream) {
    const e = ev as { type: string; period?: number; t?: number; pos?: { x: number; y: number } }
    if (e.period === undefined || e.t === undefined) continue
    const at = playAbsT(ev)
    if (e.type === 'goal' || e.type === 'whistle' || (opts.periodEnds && e.type === 'periodEnd')) pending ??= at
    else if (e.type === 'faceoff' && pending !== null && e.pos) {
      out.push({ from: pending, to: at, x: normXtoWorld(e.pos.x), z: normYtoWorld(e.pos.y) })
      pending = null
    }
  }
  return out
}

/** The dead window covering absolute time `t`, or null while the puck is live. */
export function deadWindowAt(d: readonly DeadWindow[], t: number): DeadWindow | null {
  let lo = 0
  let hi = d.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (d[mid]!.from <= t) lo = mid + 1
    else hi = mid
  }
  const w = d[lo - 1]
  return w && t < w.to ? w : null
}
