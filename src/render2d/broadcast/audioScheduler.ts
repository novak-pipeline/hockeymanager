/**
 * COMMENTARY SCHEDULER — plays the booth's pre-rendered clips ON the moment.
 *
 * Pure policy, no audio: the host supplies an {@link AudioSink} (WebAudio in the
 * app, a fake in tests), a {@link ClipLookup} (the manifest + tonight's name
 * clips) and a clock. The host calls {@link CommentaryScheduler.trigger} the
 * instant a commentary cue's time is crossed, and {@link CommentaryScheduler.tick}
 * every frame.
 *
 * The rules:
 *  - A cue that can start, starts IN THE SAME CALL — zero added latency. "GOAL"
 *    lands at the goal, not behind a queue.
 *  - Priority 3 (goal calls, robberies, the final horn) BARGES IN over whatever
 *    is talking. Lower priorities wait in a one-deep queue (highest wins) and are
 *    DROPPED if they can't start within their `maxLatencyMs` — a stale line is
 *    worse than silence.
 *  - Stitching: a named line plays [name][stem] or [stem][name]. When tonight's
 *    name clip isn't rendered, the line's BARE clip (the same call without the
 *    name) plays instead — the cue never waits for a name.
 *  - Missing audio is SILENCE, never a fallback voice: no stem/bare clip → the
 *    cue is skipped (the ticker still shows the text).
 *  - The crowd/SFX bed is ducked while the booth talks.
 */
import type { CommentaryCue, NameForm, NameStyle } from './types'
import { bareClipId, stemClipId } from './commentaryLibrary'

export interface ClipRef {
  id: string
  durationMs: number
}

export interface ClipLookup {
  /** Pre-rendered clip by id (stem.* / bare.*), or null when absent. */
  clip(id: string): ClipRef | null
  /** Tonight's rendered name clip, or null when it isn't ready. */
  name(playerId: string, form: NameForm, style: NameStyle, speaker: CommentaryCue['speaker']): ClipRef | null
}

export interface AudioSink {
  /** Play the parts back-to-back, starting now. */
  play(parts: ClipRef[], speaker: CommentaryCue['speaker']): void
  /** Stop whatever is playing immediately. */
  stop(): void
  /** Lower (true) / restore (false) the crowd + SFX bed. */
  duck(on: boolean): void
}

export interface SchedulerStats {
  played: number
  withName: number
  bareFallback: number
  droppedStale: number
  droppedMissing: number
  bargedIn: number
}

interface Pending {
  cue: CommentaryCue
  triggeredAt: number
}

/** Gap left between two lines so they don't run into each other. */
const LINE_GAP_MS = 140

/** Resolve a cue to the clips it plays, or null when it has no audio. */
export function resolveParts(cue: CommentaryCue, lookup: ClipLookup): { parts: ClipRef[]; named: boolean } | null {
  const stem = lookup.clip(stemClipId(cue.lineId))
  if (cue.name) {
    const nm = lookup.name(cue.name.playerId, cue.name.form, cue.name.style, cue.speaker)
    if (nm && stem) {
      return { parts: cue.name.position === 'lead' ? [nm, stem] : [stem, nm], named: true }
    }
    const bare = lookup.clip(bareClipId(cue.lineId))
    return bare ? { parts: [bare], named: false } : null
  }
  return stem ? { parts: [stem], named: false } : null
}

export class CommentaryScheduler {
  private current: { cue: CommentaryCue; endsAt: number } | null = null
  private pending: Pending | null = null
  private enabled = true
  readonly stats: SchedulerStats = {
    played: 0, withName: 0, bareFallback: 0, droppedStale: 0, droppedMissing: 0, bargedIn: 0,
  }

  constructor(
    private readonly sink: AudioSink,
    private readonly lookup: ClipLookup,
    private readonly now: () => number,
  ) {}

  setEnabled(on: boolean): void {
    this.enabled = on
    if (!on) this.cancel()
  }

  get isTalking(): boolean {
    return this.current !== null && this.now() < this.current.endsAt
  }

  /** The cue's moment has been crossed — play it now, queue it, or drop it. */
  trigger(cue: CommentaryCue): void {
    if (!this.enabled) return
    const t = this.now()
    this.tick()
    if (!this.current) {
      this.start(cue)
      return
    }
    if (cue.priority === 3 && cue.priority >= this.current.cue.priority) {
      this.stats.bargedIn++
      this.sink.stop()
      this.current = null
      this.pending = null
      this.start(cue)
      return
    }
    if (!this.pending || cue.priority >= this.pending.cue.priority) {
      if (this.pending) this.stats.droppedStale++
      this.pending = { cue, triggeredAt: t }
    } else {
      this.stats.droppedStale++
    }
  }

  /** Advance: finish the current line, start (or drop) the pending one. */
  tick(): void {
    const t = this.now()
    if (this.current && t >= this.current.endsAt) {
      this.current = null
      this.sink.duck(false)
    }
    if (!this.current && this.pending) {
      const p = this.pending
      this.pending = null
      if (t - p.triggeredAt <= p.cue.maxLatencyMs) this.start(p.cue)
      else this.stats.droppedStale++
    }
  }

  /** Seek / pause / replay / leave: silence everything now. */
  cancel(): void {
    if (this.current) this.sink.stop()
    this.current = null
    this.pending = null
    this.sink.duck(false)
  }

  private start(cue: CommentaryCue): void {
    const r = resolveParts(cue, this.lookup)
    if (!r) {
      this.stats.droppedMissing++
      return
    }
    const dur = r.parts.reduce((s, p) => s + p.durationMs, 0)
    this.sink.duck(true)
    this.sink.play(r.parts, cue.speaker)
    this.current = { cue, endsAt: this.now() + dur + LINE_GAP_MS }
    this.stats.played++
    if (r.named) this.stats.withName++
    else if (cue.name) this.stats.bareFallback++
  }
}
