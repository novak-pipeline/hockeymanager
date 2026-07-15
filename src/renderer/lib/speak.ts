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

/** Neural-voice auto-download — default: ON (opt-OUT).
 *
 *  History: the neural (Kokoro) engine runs onnxruntime-web's WASM runtime in the
 *  renderer. The renderer used to run with the Chromium sandbox OFF
 *  (webPreferences.sandbox: false), and with the sandbox off ORT access-violates the
 *  renderer the moment it creates an InferenceSession — an UNCATCHABLE native crash
 *  (not a JS error a try/catch can stop). That fired on the first voice of a match or a
 *  trade call and reset the app to the menu, so the auto-load was defaulted OFF as a
 *  stopgap.
 *
 *  Fixed by turning the Chromium renderer sandbox back ON (sandbox: true in
 *  src/main/index.ts) — with the sandbox on, ORT instantiates cleanly and synthesises
 *  without crashing. See also kokoroVoice.ts (WASM kept single-threaded, WebGPU never
 *  attempted). With that in place the neural voices are downloaded and used by default;
 *  set localStorage 'hockey.voice.autoNeural' to 'false' to opt out. */
const LS_AUTO = 'hockey.voice.autoNeural'
function autoNeuralEnabled(): boolean {
  try { return localStorage.getItem(LS_AUTO) !== 'false' } catch { return true }
}

/** Persist the GM's neural-voice preference (Settings toggle). */
export function setAutoNeuralEnabled(on: boolean): void {
  try { localStorage.setItem(LS_AUTO, on ? 'true' : 'false') } catch { /* ignore */ }
  if (on) warmNeuralVoices()
}

/** Read the current neural-voice preference (for the Settings toggle UI). */
export function isAutoNeuralEnabled(): boolean {
  return autoNeuralEnabled()
}

/** Kick the neural download once, in the background — unless the GM opted out.
 *  Silent to the user: on failure the stable system voice stays in place. Safe now
 *  that the renderer sandbox is enabled (see the note above and src/main/index.ts). */
function maybeAutoLoadNeural(): void {
  if (_autoLoadKicked || !autoNeuralEnabled()) return
  if (kokoroState() !== 'unloaded') return
  _autoLoadKicked = true
  void loadKokoro().then(
    () => console.info('[voice] neural voices ready'),
    (e) => console.warn('[voice] neural voices unavailable — using system voice:', (e as Error)?.message ?? e),
  )
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
