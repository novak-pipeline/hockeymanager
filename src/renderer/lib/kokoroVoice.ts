/**
 * kokoroVoice.ts — Kokoro-JS neural TTS voice engine.
 *
 * Downloads ~80-90 MB of ONNX model weights from Hugging Face on first use.
 * The download is NEVER triggered automatically: call loadKokoro() only after
 * the user explicitly opts in (e.g. by toggling "Enhanced voice" in the UI).
 * Transformers.js caches the model in the browser's Cache API / IndexedDB so
 * subsequent loads are instant.
 *
 * Integration contract (VoiceEngine):
 *   - speak(line): queue and play; drops importance-1 lines when busy.
 *   - cancel(): stop current playback and flush the queue.
 *   - ready: true when the model is loaded and playback-ready.
 *   - name: 'kokoro'
 *
 * kokoroState(): 'unloaded' | 'downloading' | 'ready' | 'failed'
 *   Exposed so the UI can show download progress / error state.
 */

import type { VoiceEngine, SpeakLine } from './announcer'

// ── Minimal local type for RawAudio ────────────────────────────────────────
// Avoids importing the full @huggingface/transformers type tree.

interface RawAudioLike {
  audio: Float32Array
  sampling_rate: number
}

// Minimal interface for the parts of KokoroTTS we actually use.
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
const QUALITY_DTYPE: Record<VoiceQuality, 'q8' | 'fp16' | 'fp32'> = {
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
function readVoiceDtype(): 'q8' | 'fp16' | 'fp32' {
  return QUALITY_DTYPE[readVoiceQuality()]
}

let _state: KokoroLoadState = 'unloaded'
let _engine: KokoroVoiceEngine | null = null
let _loadPromise: Promise<VoiceEngine> | null = null

export function kokoroState(): KokoroLoadState {
  return _state
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
  // Dynamic import keeps kokoro-js out of the initial bundle and away from
  // the Node test environment (Vitest will never reach this code path).
  const kokoro = await import('kokoro-js')
  const { KokoroTTS } = kokoro

  // Keep onnxruntime-web single-threaded and worker-free. The renderer runs under
  // file:// (not cross-origin isolated), so SharedArrayBuffer / real WASM threads
  // aren't available anyway; pinning numThreads=1 + proxy=false keeps ORT entirely
  // on the main thread and never spins up a Worker (whose script URL wouldn't
  // resolve under file://). NOTE: the renderer MUST run with the Chromium sandbox
  // ENABLED (webPreferences.sandbox: true in src/main/index.ts) — with the sandbox
  // OFF, ORT's WASM runtime access-violates the renderer on InferenceSession
  // creation (an uncatchable native crash). Best-effort + guarded so a config-shape
  // change can never throw and abort the load.
  try {
    const { env } = (await import('@huggingface/transformers')) as {
      env?: { backends?: { onnx?: { wasm?: { numThreads?: number; proxy?: boolean } } }; allowLocalModels?: boolean }
    }
    const wasm = env?.backends?.onnx?.wasm
    if (wasm) {
      wasm.numThreads = 1
      wasm.proxy = false
    }
    if (env && 'allowLocalModels' in env) env.allowLocalModels = false // don't probe file:// paths
  } catch {
    /* config is best-effort; if the shape changed, fall through and try anyway */
  }

  // progress_callback is optional; with exactOptionalPropertyTypes we must
  // not pass `undefined` for optional keys — spread it in only when present.
  type LoadOpts = NonNullable<Parameters<typeof KokoroTTS.from_pretrained>[1]>
  type ProgressCb = NonNullable<LoadOpts['progress_callback']>

  // Fidelity is user-selectable: standard=q8 (~86MB), high=fp16 (~160MB),
  // ultra=fp32 (~330MB, best quality). Default high. Chosen before download so
  // the right weights are fetched.
  const dtype = readVoiceDtype()
  const baseOpts = { dtype }
  const progressOpts: Pick<LoadOpts, 'progress_callback'> = onProgress
    ? { progress_callback: onProgress as ProgressCb }
    : {}

  // WASM only. Hardware acceleration is disabled app-wide (app.disableHardwareAcceleration
  // in src/main/index.ts), so a WebGPU device can never initialise — and *attempting* it
  // reaches Dawn/GPU init with no GPU process and access-violates the renderer (an
  // uncatchable native crash, not a JS error the try/catch can recover). So never ask for
  // WebGPU; go straight to the single-threaded WASM backend hardened above.
  const tts = (await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
    ...baseOpts,
    ...progressOpts,
    device: 'wasm',
  })) as KokoroTTSLike

  return new KokoroVoiceEngine(tts)
}

// ── KokoroVoiceEngine ──────────────────────────────────────────────────────

/**
 * Fallback voice when a line carries no explicit cast voice.
 * 'am_michael' is a male en-US voice with a grounded delivery.
 */
const SPORTS_VOICE = 'am_michael'

/** Small LRU cache of synthesised clips (raw PCM) keyed by voice+text, so stock
 *  phrases (goal calls, repeated meeting lines) don't pay synthesis twice. */
const CACHE_MAX = 64
const _clipCache = new Map<string, RawAudioLike>()
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

  private _tts: KokoroTTSLike
  private _ctx: AudioContext | null = null
  private _currentSource: AudioBufferSourceNode | null = null
  private _pending: SpeakLine | null = null // max 1 pending item
  private _busy = false

  constructor(tts: KokoroTTSLike) {
    this._tts = tts
  }

  speak(line: SpeakLine): void {
    if (this._busy) {
      // Drop low-importance lines when busy; keep the most important pending
      if (line.importance === 1) return
      if (this._pending && this._pending.importance >= line.importance) return
      this._pending = line
      return
    }
    void this._play(line)
  }

  cancel(): void {
    this._pending = null
    try { this._currentSource?.stop() } catch { /* already stopped */ }
    this._currentSource = null
    this._busy = false
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

  private async _play(line: SpeakLine): Promise<void> {
    this._busy = true
    try {
      const voice = line.voice ?? SPORTS_VOICE
      const key = `${voice}|${line.speech}`
      let raw = cacheGet(key)
      if (!raw) {
        raw = await this._tts.generate(line.speech, { voice, speed: 1.08 })
        cacheSet(key, raw)
      }

      const ctx = this._audioCtx()
      if (ctx.state === 'suspended') {
        try { await ctx.resume() } catch { /* ignore */ }
      }

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
    } catch (err) {
      console.warn('[kokoro] speak failed:', err)
    } finally {
      this._currentSource = null
      this._busy = false

      // Drain the single-item pending queue
      if (this._pending) {
        const next = this._pending
        this._pending = null
        void this._play(next)
      }
    }
  }
}
