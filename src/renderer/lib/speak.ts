/**
 * speak.ts — one place any screen can voice a line in a cast voice.
 *
 * Wraps a shared Announcer, attaches the neural (Kokoro) engine when it's loaded
 * (without changing the user's selected engine or persisting anything), and casts
 * the voice from a role + optional person traits. Respects the user's voice
 * on/off and engine preference; a no-op when voice is disabled.
 */
import { Announcer } from './announcer'
import { getKokoroEngine, kokoroState, loadKokoro } from './kokoroVoice'
import { voiceFor, type VoiceRole, type VoiceTraits } from './voiceCast'

let _ann: Announcer | null = null
let _neuralPreferred = false // switched the announcer over to neural once it's ready
let _autoLoadKicked = false // fired the one-time background download

/** GM opt-IN to the neural-voice download (default: OFF).
 *  The neural (Kokoro) engine runs on onnxruntime-web, whose bundled WASM runtime
 *  is the *threaded* build — it declares shared memory and aborts instantiation in
 *  Electron's file:// renderer (no SharedArrayBuffer / cross-origin isolation),
 *  taking the whole renderer process down as an UNCATCHABLE crash (not a JS error
 *  a try/catch can stop). That fired on the first voice of a match or a trade call
 *  and reset the app to the menu. Until the packaged neural path is proven
 *  crash-free (see the follow-up: force the non-threaded ORT runtime + verify in
 *  the real build), the model only loads when the GM explicitly opts in on the
 *  Settings → AI Voices panel. The stable system voice covers everything else. */
const LS_AUTO = 'hockey.voice.autoNeural'
function autoNeuralEnabled(): boolean {
  try { return localStorage.getItem(LS_AUTO) === 'true' } catch { return false }
}

/** Kick the neural download once, in the background — ONLY if the GM opted in.
 *  Silent: a failure just leaves the system voice in place. Off by default so a
 *  trade call / match start can never trigger the onnxruntime renderer crash. */
function maybeAutoLoadNeural(): void {
  if (_autoLoadKicked || !autoNeuralEnabled()) return
  if (kokoroState() !== 'unloaded') return
  _autoLoadKicked = true
  void loadKokoro().catch(() => { /* stay on the system voice */ })
}

function announcer(): Announcer {
  if (!_ann) _ann = new Announcer()
  const eng = getKokoroEngine()
  if (eng && kokoroState() === 'ready') {
    _ann.attachKokoro(eng)
    // The GM asked for the neural voices to just work — once they're loaded,
    // switch to them (once; useEngine cancels in-flight speech, so never per-call).
    if (!_neuralPreferred) {
      _ann.useEngine('kokoro', eng)
      _neuralPreferred = true
    }
  } else {
    maybeAutoLoadNeural()
  }
  return _ann
}

/** Speak `text` in the voice cast for `role` (matched to the person via traits). */
export function speakAs(
  role: VoiceRole,
  text: string,
  opts?: { seed?: string; traits?: VoiceTraits; importance?: 1 | 2 | 3 },
): void {
  const a = announcer()
  if (!a.isEnabled) return
  a.speakLine({
    text,
    speech: text,
    importance: opts?.importance ?? 2,
    voice: voiceFor(role, opts?.seed, opts?.traits),
  })
}

/** Stop any in-progress speech (call on unmount / when leaving a scene). */
export function cancelSpeech(): void {
  _ann?.cancel()
}

/** Warm the neural voices in the background on app start, so they're already
 *  downloaded and ready before the GM hears the first line — "downloaded by
 *  default" rather than on-first-use. Opt-out and one-time; a failure silently
 *  leaves the system voice in place. Safe post-crash-fix (single-threaded WASM). */
export function warmNeuralVoices(): void {
  maybeAutoLoadNeural()
}
