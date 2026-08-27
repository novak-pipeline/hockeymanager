/// <reference lib="webworker" />
/**
 * voice.worker.ts — neural speech synthesis, off the UI thread.
 *
 * WHY THIS EXISTS. onnxruntime-web runs its WASM inference synchronously on
 * whatever thread calls it. Kokoro used to be loaded straight into the renderer,
 * so every synthesised chunk hard-blocked the main thread: the game stopped
 * painting, buttons stopped responding, and the freeze lasted as long as the
 * speech did (chunking split it into several short freezes instead of one long
 * one — it never removed them). Moving the model into a dedicated worker moves
 * that block onto a thread nobody is looking at. The main thread's only job is
 * to copy the returned PCM into an AudioBuffer and play it.
 *
 * The worker is deliberately dumb: it loads the model and answers 'synth'
 * requests one at a time, in arrival order. All the policy — chunking, queueing,
 * caching, cancellation, fallback to the system voice — stays in the client
 * (kokoroVoice.ts), which can change its mind without a round trip.
 *
 * Ordering matters: because requests are served FIFO, the client sends every
 * chunk of the line it is about to speak BEFORE any speculative pre-synthesis
 * of the next line, so look-ahead can never delay audio that is already playing.
 */
import type { VoiceWorkerRequest, VoiceWorkerResponse } from './voiceWorkerProtocol'

interface RawAudioLike {
  audio: Float32Array
  sampling_rate: number
}

interface KokoroTTSLike {
  generate(text: string, opts?: { voice?: string; speed?: number }): Promise<RawAudioLike>
}

const ctx = self as unknown as DedicatedWorkerGlobalScope

function post(msg: VoiceWorkerResponse, transfer?: Transferable[]): void {
  if (transfer) ctx.postMessage(msg, transfer)
  else ctx.postMessage(msg)
}

let _tts: KokoroTTSLike | null = null

/** Highest request id abandoned by a client cancel. Queued 'synth' requests at
 *  or below it are skipped without ever entering the model. */
let _dropUpTo = 0

/** Serialises every request: ORT is not re-entrant and two concurrent
 *  generate() calls would interleave inside the same WASM heap. */
let _chain: Promise<void> = Promise.resolve()

async function load(req: Extract<VoiceWorkerRequest, { type: 'load' }>): Promise<void> {
  const { KokoroTTS } = await import('kokoro-js')

  // Keep onnxruntime-web single-threaded and un-proxied. We are ALREADY on a
  // worker thread, so ORT's own proxy worker would just add a hop; and real
  // WASM threads need SharedArrayBuffer, which the renderer's file:// origin
  // (not cross-origin isolated) does not get. Best-effort and guarded so a
  // config-shape change in transformers.js can never abort the load.
  try {
    const { env } = (await import('@huggingface/transformers')) as {
      env?: {
        backends?: { onnx?: { wasm?: { numThreads?: number; proxy?: boolean } } }
        allowLocalModels?: boolean
      }
    }
    const wasm = env?.backends?.onnx?.wasm
    if (wasm) {
      wasm.numThreads = 1
      wasm.proxy = false
    }
    if (env && 'allowLocalModels' in env) env.allowLocalModels = false // don't probe file:// paths
  } catch {
    /* config is best-effort */
  }

  type LoadOpts = NonNullable<Parameters<typeof KokoroTTS.from_pretrained>[1]>
  type ProgressCb = NonNullable<LoadOpts['progress_callback']>
  const progress: ProgressCb = ((info: unknown) => {
    const i = (info ?? {}) as { status?: string; file?: string; loaded?: number; total?: number }
    post({
      type: 'progress',
      id: req.id,
      status: i.status ?? '',
      ...(i.file !== undefined ? { file: i.file } : {}),
      ...(i.loaded !== undefined ? { loaded: i.loaded } : {}),
      ...(i.total !== undefined ? { total: i.total } : {}),
    })
  }) as ProgressCb

  // WASM only. Hardware acceleration is disabled app-wide, so a WebGPU device
  // can never initialise — and *attempting* it reaches Dawn/GPU init with no GPU
  // process and access-violates the process (an uncatchable native crash, not a
  // JS error). So never ask for WebGPU.
  _tts = (await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
    dtype: req.dtype,
    device: 'wasm',
    progress_callback: progress,
  })) as KokoroTTSLike

  post({ type: 'loaded', id: req.id })
  void prefetchVoiceData(req.voices)
}

const VOICE_BIN_URL = (id: string): string =>
  `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/${id}.bin`

/** Fetch every castable voice's style file into kokoro-js's own cache so first
 *  utterances never depend on the network. Best-effort — a failure only means
 *  that voice is fetched on demand the first time it speaks. */
async function prefetchVoiceData(voices: readonly string[]): Promise<void> {
  let cache: Cache
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
    } catch {
      /* offline or blocked — the speak-time fallback chain still applies */
    }
  }
}

async function synth(req: Extract<VoiceWorkerRequest, { type: 'synth' }>): Promise<void> {
  if (req.id <= _dropUpTo) return // cancelled while it sat in the queue
  if (!_tts) throw new Error('voice model not loaded')
  const t0 = performance.now()
  const raw = await _tts.generate(req.text, { voice: req.voice, speed: req.speed })
  const synthMs = performance.now() - t0
  // Copy out of any pooled buffer, then TRANSFER: no structured-clone copy of
  // the PCM, and the main thread pays only the AudioBuffer write.
  const pcm = new Float32Array(raw.audio)
  post({ type: 'audio', id: req.id, pcm, sampleRate: raw.sampling_rate, synthMs }, [pcm.buffer])
}

ctx.onmessage = (ev: MessageEvent<VoiceWorkerRequest>): void => {
  const req = ev.data
  if (!req || typeof req.id !== 'number') return
  if (req.type === 'cancel') {
    // Handled outside the chain: it must take effect for work still QUEUED.
    _dropUpTo = Math.max(_dropUpTo, req.upTo)
    return
  }
  _chain = _chain.then(async () => {
    try {
      if (req.type === 'load') await load(req)
      else await synth(req)
    } catch (err) {
      post({ type: 'error', id: req.id, message: (err as Error)?.message ?? String(err) })
    }
  })
}
