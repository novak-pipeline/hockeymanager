/**
 * kokoroVoice.ts — Kokoro-JS neural TTS, driven from a worker.
 *
 * Downloads ~86-330 MB of ONNX model weights (by fidelity) from Hugging Face on
 * first use. The download is kicked automatically in the background at startup —
 * neural voices are the default, not a button to find (see speak.ts) — and can be
 * opted out of in Settings. Transformers.js caches the model in the Cache API, which
 * is available under the packaged app's file:// origin, so later loads are instant.
 *
 * ── The main-thread problem, and the fix ──────────────────────────────────
 * onnxruntime-web's WASM inference is synchronous on its calling thread. While the
 * model lived in the renderer, every synthesised chunk hard-froze the UI for its
 * whole duration — chunking split one long freeze into several short ones but never
 * removed them, so a long meeting scene stuttered from start to finish.
 *
 * Synthesis now runs in src/renderer/lib/voice.worker.ts. This file is the client:
 * it chunks the text, queues the chunks, caches the PCM, plays it through WebAudio,
 * and owns cancellation and the never-silent fallback. The main thread's only cost
 * per chunk is copying the returned Float32Array into an AudioBuffer.
 *
 * Two further consequences worth knowing:
 *   - prewarm() no longer costs the UI anything, so scenes pre-synthesise the NEXT
 *     line while the current one plays (see speak.ts) instead of waiting for silence.
 *   - a worker that cannot start (or `hockey.voice.mainThreadSynth=true`, kept as the
 *     A/B control for measuring the freeze) falls back to in-process synthesis,
 *     which behaves exactly as the old build did.
 *
 * Integration contract (VoiceEngine):
 *   - speak(line): queue and play; drops importance-1 lines when busy.
 *   - prewarm(line): synthesise into the cache ahead of time, play nothing.
 *   - cancel(): stop playback, flush the queue, abandon queued synthesis.
 *   - ready: true when the model is loaded and playback-ready.
 *   - name: 'kokoro'
 *
 * kokoroState(): 'unloaded' | 'downloading' | 'ready' | 'failed'
 *   Exposed so the UI can show download progress / error state.
 */

import type { VoiceEngine, SpeakLine } from './announcer'
import { CAST_VOICES } from './voiceCast'
import { chunkForSpeech } from './speechChunks'
import type { VoiceDtype, VoiceWorkerRequest, VoiceWorkerResponse } from './voiceWorkerProtocol'

// Re-exported for the phone-call tests and any caller that reasons about
// delivery length; the implementation lives in speechChunks.ts.
export { chunkForSpeech }

// ── Minimal local type for RawAudio ────────────────────────────────────────

interface RawAudioLike {
  audio: Float32Array
  sampling_rate: number
}

interface KokoroTTSLike {
  generate(
    text: string,
    opts?: { voice?: string; speed?: number },
  ): Promise<RawAudioLike>
}

// ── State machine ──────────────────────────────────────────────────────────

export type KokoroLoadState = 'unloaded' | 'downloading' | 'ready' | 'failed'

// ── Fidelity setting ────────────────────────────────────────────────────────
export type VoiceQuality = 'standard' | 'high' | 'ultra'
const LS_QUALITY = 'hockeyVoiceQuality'
const QUALITY_DTYPE: Record<VoiceQuality, VoiceDtype> = {
  standard: 'q8',
  high: 'fp16',
  ultra: 'fp32',
}

export function readVoiceQuality(): VoiceQuality {
  try {
    const v = localStorage.getItem(LS_QUALITY)
    if (v === 'standard' || v === 'high' || v === 'ultra') return v
  } catch { /* ignore */ }
  return 'high'
}
export function setVoiceQuality(q: VoiceQuality): void {
  try { localStorage.setItem(LS_QUALITY, q) } catch { /* ignore */ }
}
function readVoiceDtype(): VoiceDtype {
  return QUALITY_DTYPE[readVoiceQuality()]
}

/** A/B control for the freeze measurement, and the escape hatch if a platform
 *  ever refuses to start the worker: synthesise on the main thread like the
 *  pre-worker build did. */
const LS_MAIN_THREAD = 'hockey.voice.mainThreadSynth'
export function isMainThreadSynth(): boolean {
  try { return localStorage.getItem(LS_MAIN_THREAD) === 'true' } catch { return false }
}

let _state: KokoroLoadState = 'unloaded'
let _engine: KokoroVoiceEngine | null = null
let _loadPromise: Promise<VoiceEngine> | null = null
/** Which transport ended up serving synthesis — reported by the bench and the
 *  Settings screen so "is it actually off the main thread?" is answerable. */
let _transportName: 'worker' | 'main-thread' | null = null

export function kokoroState(): KokoroLoadState {
  return _state
}

/** 'worker' | 'main-thread' | null (not loaded). */
export function kokoroTransport(): 'worker' | 'main-thread' | null {
  return _transportName
}

// ── Synthesis transports ───────────────────────────────────────────────────

/** Where synthesis actually happens. The engine above it doesn't care which. */
interface SynthTransport {
  readonly kind: 'worker' | 'main-thread'
  load(onProgress?: (info: unknown) => void): Promise<void>
  synth(text: string, voice: string, speed: number): Promise<RawAudioLike>
  /** Abandon queued work (worker only; a no-op in process). */
  cancelQueued(): void
}

class WorkerTransport implements SynthTransport {
  readonly kind = 'worker' as const
  private _w: Worker
  private _nextId = 1
  private _pending = new Map<number, { resolve: (r: RawAudioLike) => void; reject: (e: Error) => void }>()
  private _onProgress: ((info: unknown) => void) | null = null
  private _loadSettle: { resolve: () => void; reject: (e: Error) => void } | null = null

  constructor() {
    this._w = new Worker(new URL('./voice.worker.ts', import.meta.url), { type: 'module' })
    this._w.onmessage = (ev: MessageEvent<VoiceWorkerResponse>) => this._onMessage(ev.data)
    this._w.onerror = (e: ErrorEvent) => {
      const err = new Error(e.message || 'voice worker error')
      this._loadSettle?.reject(err)
      this._loadSettle = null
      for (const p of this._pending.values()) p.reject(err)
      this._pending.clear()
    }
  }

  private _onMessage(msg: VoiceWorkerResponse | undefined): void {
    if (!msg) return
    if (msg.type === 'progress') { this._onProgress?.(msg); return }
    if (msg.type === 'loaded') {
      this._loadSettle?.resolve()
      this._loadSettle = null
      return
    }
    if (msg.type === 'audio') {
      const p = this._pending.get(msg.id)
      this._pending.delete(msg.id)
      recordSynth(msg.synthMs, msg.pcm.length / msg.sampleRate)
      p?.resolve({ audio: msg.pcm, sampling_rate: msg.sampleRate })
      return
    }
    // error — either the load or one chunk
    const err = new Error(msg.message)
    if (this._loadSettle) { this._loadSettle.reject(err); this._loadSettle = null; return }
    const p = this._pending.get(msg.id)
    this._pending.delete(msg.id)
    p?.reject(err)
  }

  load(onProgress?: (info: unknown) => void): Promise<void> {
    this._onProgress = onProgress ?? null
    const id = this._nextId++
    return new Promise<void>((resolve, reject) => {
      this._loadSettle = { resolve, reject }
      this._send({ type: 'load', id, dtype: readVoiceDtype(), voices: CAST_VOICES })
    })
  }

  synth(text: string, voice: string, speed: number): Promise<RawAudioLike> {
    const id = this._nextId++
    return new Promise<RawAudioLike>((resolve, reject) => {
      this._pending.set(id, { resolve, reject })
      this._send({ type: 'synth', id, text, voice, speed })
    })
  }

  cancelQueued(): void {
    // Every id issued so far is abandoned; anything the worker has already
    // finished is either in the cache or ignored by the caller's epoch check.
    const upTo = this._nextId - 1
    for (const p of this._pending.values()) p.reject(new Error('cancelled'))
    this._pending.clear()
    this._send({ type: 'cancel', id: this._nextId++, upTo })
  }

  private _send(req: VoiceWorkerRequest): void {
    this._w.postMessage(req)
  }
}

/** The pre-worker behaviour, kept as a fallback and as the A/B control. */
class MainThreadTransport implements SynthTransport {
  readonly kind = 'main-thread' as const
  private _tts: KokoroTTSLike | null = null

  async load(onProgress?: (info: unknown) => void): Promise<void> {
    const { KokoroTTS } = await import('kokoro-js')
    try {
      const { env } = (await import('@huggingface/transformers')) as {
        env?: {
          backends?: { onnx?: { wasm?: { numThreads?: number; proxy?: boolean } } }
          allowLocalModels?: boolean
        }
      }
      const wasm = env?.backends?.onnx?.wasm
      if (wasm) { wasm.numThreads = 1; wasm.proxy = false }
      if (env && 'allowLocalModels' in env) env.allowLocalModels = false
    } catch { /* best-effort */ }
    type LoadOpts = NonNullable<Parameters<typeof KokoroTTS.from_pretrained>[1]>
    type ProgressCb = NonNullable<LoadOpts['progress_callback']>
    const progressOpts: Pick<LoadOpts, 'progress_callback'> = onProgress
      ? { progress_callback: onProgress as ProgressCb }
      : {}
    this._tts = (await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: readVoiceDtype(),
      ...progressOpts,
      device: 'wasm',
    })) as KokoroTTSLike
    void prefetchVoiceData()
  }

  async synth(text: string, voice: string, speed: number): Promise<RawAudioLike> {
    if (!this._tts) throw new Error('voice model not loaded')
    const t0 = performance.now()
    const raw = await this._tts.generate(text, { voice, speed })
    recordSynth(performance.now() - t0, raw.audio.length / raw.sampling_rate)
    return raw
  }

  cancelQueued(): void { /* nothing is queued: calls are made one at a time */ }
}

// ── Public loader ──────────────────────────────────────────────────────────

/**
 * Lazily load the Kokoro-82M ONNX model and return a VoiceEngine.
 * Calling this multiple times returns the same Promise (singleton).
 *
 * @param onProgress  Optional callback forwarded to transformers.js as
 *                    progress_callback; receives raw ProgressInfo objects.
 */
export function loadKokoro(
  onProgress?: (info: unknown) => void,
): Promise<VoiceEngine> {
  if (_loadPromise) return _loadPromise

  _state = 'downloading'
  _loadPromise = _doLoad(onProgress).then(
    (engine) => {
      _state = 'ready'
      _engine = engine as KokoroVoiceEngine
      return engine
    },
    (err: unknown) => {
      _state = 'failed'
      _loadPromise = null // allow retry
      _transportName = null
      throw err
    },
  )
  return _loadPromise
}

/** Return the already-loaded engine, or null if not yet ready. */
export function getKokoroEngine(): VoiceEngine | null {
  return _engine
}

// ── Internal loader ────────────────────────────────────────────────────────

async function _doLoad(onProgress?: (info: unknown) => void): Promise<VoiceEngine> {
  if (!isMainThreadSynth()) {
    try {
      const t = new WorkerTransport()
      await t.load(onProgress)
      _transportName = 'worker'
      return new KokoroVoiceEngine(t)
    } catch (err) {
      // A worker that won't start (or a model load that failed inside it) must
      // not cost the GM neural voices — retry in process, which is worse for the
      // UI but always available.
      console.warn(
        '[voice] worker synthesis unavailable — falling back to the main thread:',
        (err as Error)?.message ?? err,
      )
    }
  }
  const t = new MainThreadTransport()
  await t.load(onProgress)
  _transportName = 'main-thread'
  return new KokoroVoiceEngine(t)
}

// ── Voice-style prefetch ───────────────────────────────────────────────────

const VOICE_BIN_URL = (id: string): string =>
  `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/${id}.bin`

/** Fetch every castable voice's style file into kokoro-js's own 'kokoro-voices'
 *  cache so first utterances never depend on the network. Best-effort: failures
 *  only log — the speak-time fallback chain still guarantees audible lines.
 *  (The worker transport does this inside the worker; this copy serves the
 *  in-process fallback.) */
export async function prefetchVoiceData(voices: readonly string[] = CAST_VOICES): Promise<void> {
  let cache: Cache | null = null
  try {
    cache = await caches.open('kokoro-voices')
  } catch {
    return // Cache API unavailable — per-session in-memory caching still applies
  }
  for (const id of voices) {
    const url = VOICE_BIN_URL(id)
    try {
      if (await cache.match(url)) continue
      const res = await fetch(url)
      if (res.ok) await cache.put(url, res)
      else console.warn(`[voice] prefetch ${id}: HTTP ${res.status}`)
    } catch (e) {
      console.warn(`[voice] prefetch ${id} failed:`, (e as Error)?.message ?? e)
    }
  }
}

// ── Throughput accounting ──────────────────────────────────────────────────

/**
 * Per-chunk synthesis cost, newest last. Timed where the work happens (inside
 * the worker for the worker transport), so a busy or throttled main thread can't
 * distort it.
 *
 * The number that matters is the REALTIME RATIO — seconds of audio produced per
 * second of synthesis. Below 1.0 the model cannot keep up with its own speech,
 * so no amount of look-ahead stops a long line arriving late; above 1.0,
 * look-ahead hides the cost entirely. voiceBench.ts reports it.
 */
interface SynthSample { ms: number; audioSec: number }
const _synthLog: SynthSample[] = []

/** Rolling throughput, kept separately from the bench's drainable log. */
let _synthMsTotal = 0
let _audioSecTotal = 0
let _samples = 0

function recordSynth(ms: number, audioSec: number): void {
  _synthLog.push({ ms, audioSec })
  if (_synthLog.length > 64) _synthLog.shift()
  // The first chunk after a load pays for compiling the WASM and materialising
  // the weights — seconds that have nothing to do with steady-state speed. It
  // would condemn a perfectly capable machine, so it is not counted.
  _samples++
  if (_samples === 1) return
  _synthMsTotal += ms
  _audioSecTotal += audioSec
  if (_samples >= MIN_SAMPLES) writeMeasuredRealtime(realtimeRatio())
}

/** Drain the synthesis log (the bench reads it after a run). */
export function takeSynthTimings(): SynthSample[] {
  return _synthLog.splice(0, _synthLog.length)
}

// ── "Can this machine actually keep up?" ───────────────────────────────────
//
// Moving synthesis to a worker stopped the game freezing, but it cannot make
// the model faster, and on a machine where onnxruntime's single-threaded WASM
// build produces speech more slowly than the speech is spoken, no amount of
// pipelining or look-ahead will ever catch up: every line arrives late, and the
// gap grows across a scene. Measured on the dev machine the ratio was ~0.6 —
// roughly ten seconds of compute for six seconds of talking.
//
// So the engine watches its own throughput and, below realtime, hands its lines
// to the system voice, which starts in well under a second. The verdict is
// remembered so the next session doesn't have to re-learn it the slow way, and
// the GM can override it in Settings.

/** Seconds of speech produced per second of synthesis, below which the neural
 *  voice cannot deliver a line on time. A little headroom over 1.0 because the
 *  look-ahead has to fit in the gaps between lines too. */
const MIN_REALTIME = 1.15
/** Chunks to hear from (after the warm-up one) before judging the machine. */
const MIN_SAMPLES = 4
const LS_MEASURED = 'hockey.voice.measuredRealtime'
/** GM override: 'true' keeps the neural voice no matter how slow it measures. */
const LS_FORCE_NEURAL = 'hockey.voice.forceNeural'

/** Seconds of speech per second of synthesis, over this session's samples.
 *  0 when nothing has been measured yet. */
export function realtimeRatio(): number {
  if (_synthMsTotal <= 0) return 0
  return _audioSecTotal / (_synthMsTotal / 1000)
}

function writeMeasuredRealtime(r: number): void {
  try { localStorage.setItem(LS_MEASURED, r.toFixed(3)) } catch { /* ignore */ }
}
function readMeasuredRealtime(): number {
  try {
    const v = Number(localStorage.getItem(LS_MEASURED))
    return Number.isFinite(v) && v > 0 ? v : 0
  } catch { return 0 }
}

/** Force the neural voice on despite a slow measurement (Settings toggle). */
export function setForceNeural(on: boolean): void {
  try { localStorage.setItem(LS_FORCE_NEURAL, on ? 'true' : 'false') } catch { /* ignore */ }
}
export function isForceNeural(): boolean {
  try { return localStorage.getItem(LS_FORCE_NEURAL) === 'true' } catch { return false }
}
/** Forget the verdict and measure this machine again (Settings). */
export function resetVoiceSpeedVerdict(): void {
  try { localStorage.removeItem(LS_MEASURED) } catch { /* ignore */ }
  _synthMsTotal = 0
  _audioSecTotal = 0
  _samples = 0
}

/**
 * True when the neural voice is known to be slower than the speech it produces
 * — this session's own samples if there are enough of them, otherwise the
 * verdict remembered from a previous session.
 */
export function neuralTooSlow(): boolean {
  if (isForceNeural()) return false
  const live = realtimeRatio()
  if (_samples > MIN_SAMPLES && live > 0) return live < MIN_REALTIME
  const remembered = readMeasuredRealtime()
  return remembered > 0 && remembered < MIN_REALTIME
}

// ── KokoroVoiceEngine ──────────────────────────────────────────────────────

/**
 * Fallback voice when a line carries no explicit cast voice.
 * 'am_michael' is a male en-US voice with a grounded delivery.
 */
const SPORTS_VOICE = 'am_michael'

/** LRU cache of synthesised clips (raw PCM) keyed by voice+rate+text, so stock
 *  phrases (goal calls, repeated meeting lines) don't pay synthesis twice — and
 *  so speculative look-ahead has somewhere to land. */
const CACHE_MAX = 128
const _clipCache = new Map<string, RawAudioLike>()
/** In-flight synthesis, so a prewarm and the line that follows it share one
 *  request instead of racing to synthesise the same chunk twice. */
const _inflight = new Map<string, Promise<RawAudioLike | null>>()

/** Drop every cached clip. Only the bench needs this — it must measure real
 *  synthesis, not a cache hit from the previous run. */
export function clearVoiceClipCache(): void {
  _clipCache.clear()
}

function cacheGet(key: string): RawAudioLike | undefined {
  const hit = _clipCache.get(key)
  if (hit) {
    // Refresh recency.
    _clipCache.delete(key)
    _clipCache.set(key, hit)
  }
  return hit
}
function cacheSet(key: string, val: RawAudioLike): void {
  _clipCache.set(key, val)
  if (_clipCache.size > CACHE_MAX) {
    const oldest = _clipCache.keys().next().value
    if (oldest !== undefined) _clipCache.delete(oldest)
  }
}

class KokoroVoiceEngine implements VoiceEngine {
  readonly name = 'kokoro'
  readonly ready = true

  private _t: SynthTransport
  private _ctx: AudioContext | null = null
  private _currentSource: AudioBufferSourceNode | null = null
  private _pending: SpeakLine | null = null // max 1 pending item
  private _busy = false
  /** Bumped on cancel() — a synthesis already in flight checks it before
   *  playback, so a cancelled line can never start speaking late (overlap). */
  private _epoch = 0
  private _fallback: VoiceEngine | null = null

  constructor(transport: SynthTransport) {
    this._t = transport
  }

  /** Engine to hand a line to when neural synthesis fails (never-silent). */
  setFallback(engine: VoiceEngine | null): void {
    this._fallback = engine
  }

  speak(line: SpeakLine): void {
    if (this._busy) {
      // Drop low-importance lines when busy; keep the most important pending
      if (line.importance === 1) { line.onDone?.(); return }
      if (this._pending && this._pending.importance >= line.importance) { line.onDone?.(); return }
      this._pending?.onDone?.() // the replaced line is finished as far as callers care
      this._pending = line
      return
    }
    void this._play(line)
  }

  cancel(): void {
    this._epoch++
    this._pending = null
    try { this._currentSource?.stop() } catch { /* already stopped */ }
    this._currentSource = null
    this._busy = false
    this._t.cancelQueued()
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _audioCtx(): AudioContext {
    if (!this._ctx) {
      const Ctor =
        typeof AudioContext !== 'undefined'
          ? AudioContext
          : (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext
      this._ctx = new Ctor()
    }
    return this._ctx
  }

  /**
   * Synthesise a line ahead of time into the clip cache, playing nothing.
   *
   * With synthesis on a worker this costs the UI nothing, so callers use it
   * generously: the phone prewarms while the handset rings, and a scene prewarms
   * the NEXT speaker's line while the current one is still talking. Requests are
   * served in arrival order, so look-ahead always queues BEHIND the chunks of
   * the line being spoken and can never delay it.
   *
   * Best-effort and silent: a failure just means the line is synthesised the
   * normal way when its turn comes.
   */
  async prewarm(line: Pick<SpeakLine, 'speech' | 'voice' | 'rate'>): Promise<void> {
    if (neuralTooSlow()) return // this line will be spoken by the system voice
    const voice = line.voice ?? SPORTS_VOICE
    const rate = line.rate ?? 1.08
    const chunks = chunkForSpeech(line.speech)
    if (this._t.kind !== 'worker') {
      // In process, synthesis blocks the UI, so only the opening is worth it —
      // that is the pause the caller is trying to fill — and never while a line
      // is actually speaking.
      if (this._busy) return
      const first = chunks[0]
      if (first) await this._synth(first, voice, rate)
      return
    }
    for (const c of chunks) await this._synth(c, voice, rate)
  }

  /** Synthesise one chunk, falling back to the default voice if the cast voice
   *  can't be produced. Returns null when neural synthesis is truly down. */
  private async _synthWithFallback(
    speech: string, voice: string, rate: number,
  ): Promise<RawAudioLike | null> {
    const raw = await this._synth(speech, voice, rate)
    if (raw || voice === SPORTS_VOICE) return raw
    console.warn(`[kokoro] voice "${voice}" failed — retrying with ${SPORTS_VOICE}`)
    return this._synth(speech, SPORTS_VOICE, rate)
  }

  private async _play(line: SpeakLine): Promise<void> {
    // Known too slow for this machine: don't make the GM wait for a line the
    // system voice can start speaking inside a second.
    if (neuralTooSlow() && this._fallback) {
      this._fallback.speak(line)
      return
    }
    this._busy = true
    const epoch = this._epoch
    let handedOff = false
    let spoke = false
    try {
      const rate = line.rate ?? 1.08
      const voice = line.voice ?? SPORTS_VOICE
      const chunks = chunkForSpeech(line.speech)
      if (chunks.length === 0) return

      // Queue EVERY chunk up front. The worker serves requests in order, so by
      // the time chunk i finishes playing, chunk i+1 is usually already done —
      // and any speculative look-ahead queued afterwards sits behind all of them.
      // In process this degrades to the old one-chunk-ahead pipeline, because
      // each call blocks the caller anyway.
      const queued: Array<Promise<RawAudioLike | null>> =
        this._t.kind === 'worker'
          ? chunks.map((c) => this._synthWithFallback(c, voice, rate))
          : []
      let ahead: Promise<RawAudioLike | null> | null =
        queued.length > 0 ? null : this._synthWithFallback(chunks[0]!, voice, rate)

      for (let i = 0; i < chunks.length; i++) {
        const raw = await (queued.length > 0 ? queued[i]! : ahead!)
        if (this._epoch !== epoch) return // cancelled while synthesising — stay quiet
        if (queued.length === 0) {
          ahead = i + 1 < chunks.length
            ? this._synthWithFallback(chunks[i + 1]!, voice, rate)
            : Promise.resolve(null)
        }
        if (!raw) {
          // Never-silent: if the very first chunk can't be produced, neural is
          // down — hand the WHOLE line to the system voice rather than speaking
          // a fragment of it. A later chunk failing just drops that fragment.
          if (i === 0 && this._fallback) {
            console.warn('[kokoro] synthesis failed — falling back to system voice')
            handedOff = true
            this._fallback.speak(line)
            return
          }
          continue
        }
        if (!spoke) { spoke = true; line.onFirstAudio?.() }
        await this._playBuffer(raw, epoch)
        if (this._epoch !== epoch) return
      }
    } catch (err) {
      console.warn('[kokoro] speak failed:', err)
    } finally {
      this._currentSource = null
      this._busy = false
      if (!handedOff) line.onDone?.() // the fallback engine reports completion itself

      // Drain the single-item pending queue
      if (this._pending) {
        const next = this._pending
        this._pending = null
        void this._play(next)
      }
    }
  }

  /** Play one synthesised clip to completion (or until cancelled). */
  private async _playBuffer(raw: RawAudioLike, epoch: number): Promise<void> {
    const ctx = this._audioCtx()
    if (ctx.state === 'suspended') {
      try { await ctx.resume() } catch { /* ignore */ }
    }
    if (this._epoch !== epoch) return

    const audioBuf = ctx.createBuffer(1, raw.audio.length, raw.sampling_rate)
    audioBuf.getChannelData(0).set(raw.audio)

    const src = ctx.createBufferSource()
    src.buffer = audioBuf
    src.connect(ctx.destination)
    this._currentSource = src

    await new Promise<void>((resolve) => {
      src.onended = () => resolve()
      src.start()
    })
    this._currentSource = null
  }

  /** Synthesise (cache-first, de-duplicated); returns null instead of throwing. */
  private async _synth(speech: string, voice: string, rate: number): Promise<RawAudioLike | null> {
    const key = `${voice}|${rate}|${speech}`
    const hit = cacheGet(key)
    if (hit) return hit
    const live = _inflight.get(key)
    if (live) return live
    const p = this._t.synth(speech, voice, rate).then(
      (raw) => { cacheSet(key, raw); _inflight.delete(key); return raw },
      (err: unknown) => {
        _inflight.delete(key)
        const msg = (err as Error)?.message ?? err
        if (msg !== 'cancelled') console.warn(`[kokoro] synth failed (${voice}):`, msg)
        return null
      },
    )
    _inflight.set(key, p)
    return p
  }
}
