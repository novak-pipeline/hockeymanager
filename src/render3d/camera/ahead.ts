/**
 * W3 S7: where the puck will be over the next moments, read off the stream
 * (a watched game's stream is complete before the picture starts). The
 * broadcast camera holds these inside its frame too, so a pass, a rim or a
 * clear starts the pan before the puck gets there. Stops at a stoppage: the
 * next piece of play is the director's cut, not a pan.
 */
import type { MatchTimeline } from '@render2d/timeline'
import { normXtoWorld, normYtoWorld } from '../math'
import type { DeadWindow } from './stoppages'

/** Look-ahead offsets, game seconds. */
export const CAMERA_AHEAD_S: readonly number[] = [0.2, 0.4, 0.6, 0.8, 1.0]

export function puckAhead(tl: MatchTimeline, dead: readonly DeadWindow[], t: number, offs: readonly number[] = CAMERA_AHEAD_S): Array<{ x: number; y: number; z: number }> {
  const out: Array<{ x: number; y: number; z: number }> = []
  // the next stoppage after t ends the look-ahead
  let stop = Infinity
  for (const d of dead) {
    if (d.from > t) {
      stop = d.from
      break
    }
  }
  for (const o of offs) {
    if (t + o >= stop || t + o > tl.duration) break
    const s = tl.sampleAt(t + o)
    if (!s) break
    out.push({ x: normXtoWorld(s.puck.x), y: s.puckZ ?? 0, z: normYtoWorld(s.puck.y) })
  }
  return out
}
