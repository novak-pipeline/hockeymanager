/**
 * voiceWorkerProtocol.ts — the message contract between the renderer's voice
 * client (kokoroVoice.ts) and the synthesis worker (voice.worker.ts).
 *
 * Types only: importing this file must never pull kokoro-js, onnxruntime-web or
 * the worker module itself into the main bundle.
 *
 * Shape: one request id per call, one terminal response per id ('loaded' |
 * 'audio' | 'error'); 'progress' may arrive any number of times before the
 * terminal message for a 'load'. Audio comes back as a transferable Float32Array
 * so no PCM is ever copied across the thread boundary.
 */

export type VoiceDtype = 'q8' | 'fp16' | 'fp32'

export type VoiceWorkerRequest =
  /** Download (or read from the Cache API) the model weights and open a session. */
  | { type: 'load'; id: number; dtype: VoiceDtype; voices: readonly string[] }
  /** Synthesise one chunk. Requests are served strictly in arrival order. */
  | { type: 'synth'; id: number; text: string; voice: string; speed: number }
  /** Abandon every queued 'synth' whose id is <= `upTo` (ids are monotonic).
   *  Sent on cancel so a dead scene's backlog can't delay the next line. */
  | { type: 'cancel'; id: number; upTo: number }

export type VoiceWorkerResponse =
  | { type: 'progress'; id: number; status: string; file?: string; loaded?: number; total?: number }
  | { type: 'loaded'; id: number }
  /** `synthMs` is measured on the WORKER's clock, so it reports true synthesis
   *  cost even when the main thread is busy or its timers are throttled. */
  | { type: 'audio'; id: number; pcm: Float32Array; sampleRate: number; synthMs: number }
  | { type: 'error'; id: number; message: string }
