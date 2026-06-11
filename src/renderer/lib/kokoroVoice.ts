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

  // progress_callback is optional; with exactOptionalPropertyTypes we must
  // not pass `undefined` for optional keys — spread it in only when present.
  type LoadOpts = NonNullable<Parameters<typeof KokoroTTS.from_pretrained>[1]>
  type ProgressCb = NonNullable<LoadOpts['progress_callback']>

  const baseOpts = { dtype: 'q8' as const }
  const progressOpts: Pick<LoadOpts, 'progress_callback'> = onProgress
    ? { progress_callback: onProgress as ProgressCb }
    : {}

  // Try WebGPU first for hardware acceleration; fall back to WASM.
  let tts: KokoroTTSLike
  try {
    tts = (await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      ...baseOpts,
      ...progressOpts,
      device: 'webgpu',
    })) as KokoroTTSLike
  } catch {
    // WebGPU unavailable — fall back to WASM
    tts = (await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      ...baseOpts,
      ...progressOpts,
      device: 'wasm',
    })) as KokoroTTSLike
  }

  return new KokoroVoiceEngine(tts)
}

// ── KokoroVoiceEngine ──────────────────────────────────────────────────────

/**
 * Voice to use for sports commentary.
 * 'am_michael' is a male en-US voice with a grounded delivery.
 */
const SPORTS_VOICE = 'am_michael'

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
      const raw = await this._tts.generate(line.speech, {
        voice: SPORTS_VOICE,
        speed: 1.08,
      })

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
