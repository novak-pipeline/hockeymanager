/**
 * commentaryAudio.ts — the booth's audio in the app: pre-rendered stems + name
 * clips, played through WebAudio on the director's cues.
 *
 *  - STEMS are files built offline by scripts/dev/render-commentary.mjs into
 *    src/renderer/public/commentary/ (gitignored audio + committed manifest).
 *    They're fetched + decoded once per session; nothing is synthesised live.
 *  - NAME CLIPS for tonight's two rosters are rendered in the BACKGROUND before
 *    puck drop by the same engine + voice as the stems (Kokoro on the voice
 *    worker — never the main thread), and cached in IndexedDB by
 *    nameClipKey(player, voice, form, style, pronunciationHash). The rest of the
 *    league trickles in during idle time. A name that isn't ready yet simply
 *    isn't said: the scheduler plays the line's bare clip.
 *  - There is NO system-voice fallback here, ever. If the booth voice can't
 *    render, commentary is silent (owner rule: no "Microsoft Sam").
 *
 * Commentary has its own switch (off by default until the owner signs off on the
 * sound), independent of the general voice toggle.
 */
import booth from '../../render2d/broadcast/booth.config.json'
import type { AudioSink, ClipLookup, ClipRef } from '../../render2d/broadcast/audioScheduler'
import type { ClipManifest, TtsAudio, TtsEngine, TtsRenderRequest } from '../../render2d/broadcast/clipManifest'
import { nameClipKey } from '../../render2d/broadcast/clipManifest'
import { NameRenderQueue, tonightNameJobs, type NameJob } from '../../render2d/broadcast/nameQueue'
import { spokenName, type NameInput, type PronunciationFile } from '../../render2d/broadcast/pronunciation'
import type { NameForm, NameStyle, Speaker } from '../../render2d/broadcast/types'
import { loadKokoro, renderClipPcm } from './kokoroVoice'

/* ─────────────────────────── settings ─────────────────────────── */

const LS_COMMENTARY = 'hockey.broadcast.commentary'
const LS_PRESENTATION = 'hockey.broadcast.presentation'

/** Commentary: OFF by default until the owner approves the booth's sound. */
export function isCommentaryEnabled(): boolean {
  try { return localStorage.getItem(LS_COMMENTARY) === 'true' } catch { return false }
}
export function setCommentaryEnabled(on: boolean): void {
  try { localStorage.setItem(LS_COMMENTARY, on ? 'true' : 'false') } catch { /* ignore */ }
}

export type PresentationSetting = 'full' | 'compact' | 'off'
export function readPresentation(): PresentationSetting {
  try {
    const v = localStorage.getItem(LS_PRESENTATION)
    if (v === 'full' || v === 'compact' || v === 'off') return v
  } catch { /* ignore */ }
  return 'full'
}
export function writePresentation(v: PresentationSetting): void {
  try { localStorage.setItem(LS_PRESENTATION, v) } catch { /* ignore */ }
}

/* ─────────────────────────── engine seam ─────────────────────────── */

type Style = keyof typeof booth.styles

/** Kokoro on the voice worker, as a {@link TtsEngine}. Style → punctuation +
 *  rate, exactly as the offline stem build applies it. */
export class KokoroWorkerTts implements TtsEngine {
  readonly id = 'kokoro'
  async render(req: TtsRenderRequest): Promise<TtsAudio> {
    const out = await renderClipPcm(req.text, req.voiceId, req.rate)
    if (!out) throw new Error('kokoro unavailable')
    return { pcm: out.pcm, sampleRate: out.sampleRate }
  }
}

/* ─────────────────────────── IndexedDB name cache ─────────────────────────── */

const DB_NAME = 'hockey-booth'
const STORE = 'names'

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
}

async function idbGet(db: IDBDatabase | null, key: string): Promise<TtsAudio | null> {
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      r.onsuccess = () => resolve((r.result as TtsAudio | undefined) ?? null)
      r.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
}

async function idbPut(db: IDBDatabase | null, key: string, val: TtsAudio): Promise<void> {
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(val, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch { resolve() }
  })
}

/* ─────────────────────────── the booth ─────────────────────────── */

export interface BoothPlayer extends NameInput {
  starter: boolean
}

/**
 * One per match screen. Implements the scheduler's sink + lookup over WebAudio.
 */
export class BoothAudio implements AudioSink, ClipLookup {
  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  private sources: AudioBufferSourceNode[] = []
  private readonly stems = new Map<string, AudioBuffer>()
  private readonly names = new Map<string, AudioBuffer>()
  /** playerId → spoken-name hash (for the lookup key). */
  private readonly hashes = new Map<string, string>()
  private readonly queue = new NameRenderQueue()
  private db: Promise<IDBDatabase | null> | null = null
  private working = false
  private disposed = false
  private readonly engine: TtsEngine = new KokoroWorkerTts()
  private onDuck: ((on: boolean) => void) | null = null
  private pronunciations: PronunciationFile | null = null

  setDuckHandler(fn: (on: boolean) => void): void { this.onDuck = fn }
  setPronunciations(file: PronunciationFile | null): void { this.pronunciations = file }

  private audio(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.out = this.ctx.createGain()
      this.out.gain.value = 0.95
      this.out.connect(this.ctx.destination)
    }
    return this.ctx
  }

  /** Call from a user gesture (Drop the puck) so the context can start. */
  resume(): void {
    const c = this.audio()
    if (c.state === 'suspended') void c.resume().catch(() => undefined)
  }

  /** Fetch + decode the stem manifest and every stem clip. Missing → silent. */
  async loadStems(base = './commentary/'): Promise<{ clips: number; missing: number }> {
    let manifest: ClipManifest | null = null
    try {
      const res = await fetch(`${base}manifest.json`)
      if (res.ok) manifest = (await res.json()) as ClipManifest
    } catch { /* no manifest → silent booth */ }
    if (!manifest) return { clips: 0, missing: 0 }
    // A manifest rendered with other voices than the booth config is stale.
    if (manifest.voices.pbp !== booth.speakers.pbp.voiceId || manifest.voices.color !== booth.speakers.color.voiceId) {
      console.warn('[booth] stems were rendered with different voices than booth.config.json — re-run render-commentary')
    }
    const ctx = this.audio()
    let missing = 0
    await Promise.all(Object.entries(manifest.clips).map(async ([id, entry]) => {
      try {
        const res = await fetch(`${base}${entry.file}`)
        if (!res.ok) { missing++; return }
        const buf = await ctx.decodeAudioData(await res.arrayBuffer())
        if (!this.disposed) this.stems.set(id, buf)
      } catch { missing++ }
    }))
    return { clips: this.stems.size, missing }
  }

  /* ── ClipLookup ── */

  clip(id: string): ClipRef | null {
    const b = this.stems.get(id)
    return b ? { id, durationMs: b.duration * 1000 } : null
  }

  name(playerId: string, form: NameForm, style: NameStyle, speaker: Speaker): ClipRef | null {
    const hash = this.hashes.get(playerId)
    if (!hash) return null
    const key = nameClipKey({ playerId, voiceId: booth.speakers[speaker].voiceId, form, style, pronunciationHash: hash })
    const b = this.names.get(key)
    return b ? { id: key, durationMs: b.duration * 1000 } : null
  }

  /* ── AudioSink ── */

  play(parts: ClipRef[]): void {
    const ctx = this.audio()
    let t = ctx.currentTime + 0.01
    for (const p of parts) {
      const buf = this.stems.get(p.id) ?? this.names.get(p.id)
      if (!buf) continue
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(this.out!)
      src.start(t)
      t += buf.duration
      this.sources.push(src)
      src.onended = () => { this.sources = this.sources.filter((s) => s !== src) }
    }
  }

  stop(): void {
    for (const s of this.sources) { try { s.stop() } catch { /* already stopped */ } }
    this.sources = []
  }

  duck(on: boolean): void {
    this.onDuck?.(on)
  }

  /* ── names ── */

  /**
   * Queue tonight's name clips (priority) — or, with `league`, the idle-time
   * trickle — and start the background worker if it isn't running. Resolves
   * immediately; rendering continues in the background.
   */
  queueNames(players: BoothPlayer[], opts: { league?: boolean } = {}): void {
    const withSpoken = players.map((p) => {
      const s = spokenName(p, this.pronunciations)
      this.hashes.set(p.id, s.hash)
      return { id: p.id, starter: p.starter, spoken: s }
    })
    const jobs = tonightNameJobs({
      players: withSpoken,
      voices: {
        pbp: { voiceId: booth.speakers.pbp.voiceId, rate: booth.speakers.pbp.rate },
        color: { voiceId: booth.speakers.color.voiceId, rate: booth.speakers.color.rate },
      },
      styles: booth.styles as Record<Style, { rateDelta: number; terminator: string }>,
      keyOf: nameClipKey,
      ...(opts.league ? { league: true } : {}),
    })
    for (const j of jobs) this.queue.add(j)
    void this.pump()
  }

  /** Tonight's names still rendering (priority ≤ 1). */
  get tonightPending(): number {
    return this.queue.pendingAtOrBelow(1)
  }

  private async pump(): Promise<void> {
    if (this.working) return
    this.working = true
    try {
      this.db ??= openDb()
      const db = await this.db
      // The engine loads lazily; if the model can't load, the booth simply
      // speaks every line bare. No fallback voice.
      try { await loadKokoro() } catch { return }
      for (;;) {
        if (this.disposed) return
        const job: NameJob | null = this.queue.peek()
        if (!job) return
        const cached = await idbGet(db, job.key)
        let audio: TtsAudio | null = cached
        if (!audio) {
          try {
            audio = await this.engine.render({ text: job.text, voiceId: job.voiceId, rate: job.rate, style: job.style })
            await idbPut(db, job.key, audio)
          } catch {
            this.queue.markFailed(job.key)
            continue
          }
        }
        this.names.set(job.key, this.toBuffer(audio))
        this.queue.markDone(job.key)
      }
    } finally {
      this.working = false
    }
  }

  private toBuffer(a: TtsAudio): AudioBuffer {
    const ctx = this.audio()
    const buf = ctx.createBuffer(1, a.pcm.length, a.sampleRate)
    buf.getChannelData(0).set(a.pcm)
    return buf
  }

  dispose(): void {
    this.disposed = true
    this.stop()
    this.onDuck?.(false)
    void this.ctx?.close().catch(() => undefined)
    this.ctx = null
  }
}
