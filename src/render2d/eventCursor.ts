/**
 * A monotonic read head over a GameStream.
 *
 * Every live consumer of the stream — the SFX cue map, the play-by-play feed,
 * the running box score — needs the same thing: "which events have I crossed
 * since the last frame?". Doing that by re-scanning the whole stream on every
 * rendered frame is what the watched game shipped with, and a full game's stream
 * is ~20k events (positional frames dominate), so that is a 20k-iteration walk
 * 60 times a second to find the two or three events that actually crossed.
 * See docs/perf/2d-match-cpu-profile.txt.
 *
 * The cursor indexes the stream once, on the SAME absolute clock MatchTimeline
 * uses (so overtime lines up — the old `(period-1)*1200` shortcut drifted in
 * multi-OT playoff games), then walks forward from wherever it last stopped.
 *
 * Pure and DOM-free: it computes nothing about hockey, it only slices the
 * keystone stream by time.
 */
import type { GameEvent, GameStream } from '@domain'
import { periodBases } from './timeline'

/** One stream event tagged with its absolute game-clock time. */
export interface TimedEvent {
  absT: number
  ev: GameEvent
}

export class EventCursor {
  /** Every non-`frame` event, ascending by absolute time. */
  private readonly timed: TimedEvent[] = []
  /** Index of the next event that has NOT been emitted yet. */
  private next = 0
  /** Clock the head currently sits at. */
  private at = 0

  /**
   * @param stream        the game stream
   * @param includeFrames keep positional `frame` events too. Off by default:
   *                      no live consumer wants them (they are the renderer's
   *                      business) and they are 90% of the stream.
   */
  constructor(stream: GameStream, includeFrames = false) {
    const bases = periodBases(stream)
    for (const ev of stream) {
      if (!includeFrames && ev.type === 'frame') continue
      const base = bases.get(ev.period) ?? (ev.period - 1) * 1200
      this.timed.push({ absT: base + ev.t, ev })
    }
    // The engine emits in time order per period and periods in order, so this is
    // already sorted; sort defensively rather than trusting it.
    this.timed.sort((a, b) => a.absT - b.absT)
  }

  /** Absolute clock of the read head. */
  get position(): number {
    return this.at
  }

  /** Total number of indexed events. */
  get length(): number {
    return this.timed.length
  }

  /** Every indexed event, in order (for consumers that want the whole game). */
  get all(): readonly TimedEvent[] {
    return this.timed
  }

  /**
   * Move the head to `absT` and return the events in (previous position, absT].
   * Moving backwards emits nothing — use `seek` for that.
   */
  advance(absT: number): TimedEvent[] {
    if (absT <= this.at) {
      this.at = absT
      return []
    }
    const out: TimedEvent[] = []
    while (this.next < this.timed.length && this.timed[this.next].absT <= absT) {
      out.push(this.timed[this.next])
      this.next++
    }
    this.at = absT
    return out
  }

  /**
   * Reposition the head without emitting — for scrubs, replays and jumps. After
   * a seek the next `advance` returns only events strictly after `absT`.
   */
  seek(absT: number): void {
    this.at = absT
    // Binary search for the first event strictly after absT.
    let lo = 0
    let hi = this.timed.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.timed[mid].absT <= absT) lo = mid + 1
      else hi = mid
    }
    this.next = lo
  }

  /** Every event at or before `absT`, from the start of the game. */
  upTo(absT: number): TimedEvent[] {
    const out: TimedEvent[] = []
    for (const t of this.timed) {
      if (t.absT > absT) break
      out.push(t)
    }
    return out
  }
}
