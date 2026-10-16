/**
 * Where an event sits on the PLAYBACK timeline (W3 S3).
 *
 * Streams without `playT` (the director engine, the quick sim, older saves)
 * lay periods end to end: regulation periods are 1200 s each, an overtime
 * period is as long as the latest event in it. The agent engine stops the
 * period clock (`t`) at every whistle, so its periods run longer than 20
 * minutes on screen; every event then carries `playT`, the absolute playback
 * second, and that is its place. One helper for every consumer, so a renderer,
 * a replay and a detector can never disagree about when something happened.
 */
import type { GameEvent, GameStream } from './events'

const REG = 1200

/** Absolute playback seconds at which each period starts. */
export function streamPeriodBases(stream: GameStream): Map<number, number> {
  // With playT: the period starts at min(playT − t) (exact at t = 0, and
  // playT − t only grows as stoppages pile up dead time).
  const hasPlay = new Map<number, number>()
  // Without: frames define a period's length (the timeline's rule), other
  // events only for periods with no frames.
  const maxT = new Map<number, number>()
  const framed = new Set<number>()
  for (const ev of stream) if (ev.type === 'frame') framed.add(ev.period)
  for (const ev of stream) {
    if (ev.playT !== undefined) hasPlay.set(ev.period, Math.min(hasPlay.get(ev.period) ?? Infinity, ev.playT - ev.t))
    if (framed.has(ev.period) && ev.type !== 'frame') continue
    maxT.set(ev.period, Math.max(maxT.get(ev.period) ?? 0, ev.t))
  }
  const bases = new Map<number, number>()
  let base = 0
  for (const p of [...new Set([...maxT.keys(), ...hasPlay.keys()])].sort((a, b) => a - b)) {
    const pb = hasPlay.get(p)
    if (pb !== undefined) base = pb
    bases.set(p, base)
    base += p <= 3 ? REG : (maxT.get(p) ?? REG)
  }
  if (!bases.has(1)) bases.set(1, 0)
  return bases
}

/** The event's absolute playback second: `playT`, else its period base + t. */
export function playAbsT(ev: Pick<GameEvent, 't' | 'period' | 'playT'>, bases?: Map<number, number>): number {
  if (ev.playT !== undefined) return ev.playT
  return (bases?.get(ev.period) ?? (ev.period - 1) * REG) + ev.t
}

/**
 * Playback length of each period: from its base to the next period's base
 * (the last period: to its latest event). Without `playT` this is the classic
 * 1200 s / OT-from-the-stream rule.
 */
export function streamPeriodLengths(stream: GameStream, bases = streamPeriodBases(stream)): Map<number, number> {
  const end = new Map<number, number>()
  for (const ev of stream) {
    const a = playAbsT(ev, bases)
    end.set(ev.period, Math.max(end.get(ev.period) ?? 0, a))
  }
  const ps = [...bases.keys()].sort((a, b) => a - b)
  const out = new Map<number, number>()
  ps.forEach((p, i) => {
    const b = bases.get(p)!
    const next = ps[i + 1]
    const anyPlay = stream.some((e) => e.period === p && e.playT !== undefined)
    if (!anyPlay) out.set(p, p <= 3 ? REG : Math.max(1, (end.get(p) ?? b + REG) - b))
    else out.set(p, next !== undefined ? bases.get(next)! - b : Math.max(1, (end.get(p) ?? b) - b))
  })
  return out
}
