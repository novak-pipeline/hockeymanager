/**
 * speak.ts — one place any screen can voice a line in a cast voice.
 *
 * Wraps a shared Announcer, attaches the neural (Kokoro) engine when it's loaded
 * (without changing the user's selected engine or persisting anything), and casts
 * the voice from a role + optional person traits. Respects the user's voice
 * on/off and engine preference; a no-op when voice is disabled.
 */
import { Announcer } from './announcer'
import { getKokoroEngine, kokoroState } from './kokoroVoice'
import { voiceFor, type VoiceRole, type VoiceTraits } from './voiceCast'

let _ann: Announcer | null = null

function announcer(): Announcer {
  if (!_ann) _ann = new Announcer()
  // Make the neural engine available if the user downloaded it; the Announcer
  // only actually uses it when their selected engine is 'kokoro'.
  const eng = getKokoroEngine()
  if (eng && kokoroState() === 'ready') _ann.attachKokoro(eng)
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
