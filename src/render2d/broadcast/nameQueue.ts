/**
 * NAME RENDER QUEUE — which player-name clips to render next, in the background.
 *
 * Names are first-class: the booth says them. Clips are rendered ahead of time
 * (never during a call) by the same engine + voice as the stems, cached to disk,
 * and keyed by nameClipKey(playerId, voice, form, style, pronunciationHash).
 *
 * Priority (lower runs first):
 *   0  tonight's starters + starting goalies — surname, 'excited' then 'neutral'
 *   1  the rest of tonight's two dressed rosters, and the FULL-name forms the
 *      pregame introductions use
 *   2  'rising' variants for tonight
 *   3  the rest of the league, trickled in idle time between games
 *
 * Pure bookkeeping; the renderer's commentaryAudio.ts does the rendering.
 */
import type { NameForm, NameStyle, Speaker } from './types'

export interface NameJob {
  key: string
  playerId: string
  speaker: Speaker
  form: NameForm
  style: NameStyle
  /** Engine text, e.g. "neh-chahs!". */
  text: string
  voiceId: string
  rate: number
  priority: number
}

export class NameRenderQueue {
  private readonly jobs = new Map<string, NameJob>()
  private readonly done = new Set<string>()
  private readonly failed = new Map<string, number>()
  private seq = 0
  private readonly order = new Map<string, number>()

  /** Add (or promote) a job. A lower priority number wins on re-add. */
  add(job: NameJob): void {
    if (this.done.has(job.key)) return
    const cur = this.jobs.get(job.key)
    if (cur && cur.priority <= job.priority) return
    this.jobs.set(job.key, job)
    if (!this.order.has(job.key)) this.order.set(job.key, this.seq++)
  }

  /** Mark a key as already cached (e.g. found on disk). */
  markDone(key: string): void {
    this.done.add(key)
    this.jobs.delete(key)
  }

  /** Record a failed render; after 2 failures the job is dropped for the session. */
  markFailed(key: string): void {
    const n = (this.failed.get(key) ?? 0) + 1
    this.failed.set(key, n)
    if (n >= 2) this.jobs.delete(key)
  }

  /** Highest-priority pending job (FIFO within a priority), without removing it. */
  peek(): NameJob | null {
    let best: NameJob | null = null
    for (const j of this.jobs.values()) {
      if (!best || j.priority < best.priority ||
        (j.priority === best.priority && this.order.get(j.key)! < this.order.get(best.key)!)) best = j
    }
    return best
  }

  isDone(key: string): boolean {
    return this.done.has(key)
  }

  get pending(): number {
    return this.jobs.size
  }

  /** Pending jobs at or below a priority (e.g. "is tonight ready?"). */
  pendingAtOrBelow(priority: number): number {
    let n = 0
    for (const j of this.jobs.values()) if (j.priority <= priority) n++
    return n
  }
}

/** Which name clips tonight needs, per the priority table above. */
export function tonightNameJobs(args: {
  players: Array<{ id: string; starter: boolean; spoken: { surname: string; full: string; hash: string } }>
  voices: Record<Speaker, { voiceId: string; rate: number }>
  styles: Record<NameStyle, { rateDelta: number; terminator: string }>
  keyOf: (a: { playerId: string; voiceId: string; form: NameForm; style: NameStyle; pronunciationHash: string }) => string
  league?: boolean
}): NameJob[] {
  const out: NameJob[] = []
  const mk = (p: (typeof args.players)[number], speaker: Speaker, form: NameForm, style: NameStyle, priority: number): void => {
    const v = args.voices[speaker]
    const st = args.styles[style]
    out.push({
      key: args.keyOf({ playerId: p.id, voiceId: v.voiceId, form, style, pronunciationHash: p.spoken.hash }),
      playerId: p.id,
      speaker,
      form,
      style,
      text: `${form === 'full' ? p.spoken.full : p.spoken.surname}${st.terminator}`,
      voiceId: v.voiceId,
      rate: Math.round((v.rate + st.rateDelta) * 100) / 100,
      priority,
    })
  }
  for (const p of args.players) {
    const base = args.league ? 3 : p.starter ? 0 : 1
    // Play-by-play carries almost every named call.
    mk(p, 'pbp', 'surname', 'excited', base)
    mk(p, 'pbp', 'surname', 'neutral', args.league ? 3 : base)
    mk(p, 'pbp', 'full', 'neutral', args.league ? 3 : 1)
    mk(p, 'pbp', 'full', 'excited', args.league ? 3 : 1)
    mk(p, 'color', 'full', 'neutral', args.league ? 3 : 1)
    mk(p, 'color', 'surname', 'neutral', args.league ? 3 : 1)
    mk(p, 'pbp', 'surname', 'rising', args.league ? 3 : 2)
  }
  return out
}
