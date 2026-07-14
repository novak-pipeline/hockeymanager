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

/** GM opt-OUT of the automatic neural-voice download (default: auto-download on).
 *  The neural voices are the intended shipped sound — curated per character — so
 *  they fetch themselves the first time a voice is actually needed, with no button
 *  to hunt for. Only an explicit opt-out stops that. */
const LS_AUTO = 'hockey.voice.autoNeural'
function autoNeuralEnabled(): boolean {
  try { return localStorage.getItem(LS_AUTO) !== 'false' } catch { return true }
}

/** Kick the neural download exactly once, in the background, the first time a
 *  voice is genuinely requested (entering a match, answering the phone). Silent:
 *  a failure just leaves the system voice in place. Now safe to auto-run because
 *  the onnxruntime WASM backend is pinned single-threaded (see kokoroVoice.ts),
 *  so it can no longer crash the renderer. */
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
