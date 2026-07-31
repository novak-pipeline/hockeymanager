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
import { castFor, type VoiceRole, type VoiceTraits } from './voiceCast'

let _ann: Announcer | null = null
let _neuralPreferred = false // switched the announcer over to neural once it's ready
let _autoLoadInFlight = false // a background download is running right now
let _autoLoadFailures = 0 // consecutive failures, for the retry backoff
let _autoRetryAt = 0 // epoch ms before which we don't try again

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
  if (on) {
    // Turning it back on must actually put the neural engine back: a caller that
    // opted out forced the announcer to 'system', and without clearing this the
    // one-time switch-over would never fire again this session.
    _neuralPreferred = false
    _autoRetryAt = 0
    warmNeuralVoices()
  }
}

/** Read the current neural-voice preference (for the Settings toggle UI). */
export function isAutoNeuralEnabled(): boolean {
  return autoNeuralEnabled()
}

/** Retry backoff after a failed background download: 30s, 2min, 8min, then every
 *  15min. A launch with no network must not cost the GM neural voices for the
 *  whole session — that latched failure is what left the enhanced voice off until
 *  somebody found the Settings button and pressed it by hand. */
const RETRY_DELAYS_MS = [30_000, 120_000, 480_000, 900_000]

/** Kick the neural download in the background — unless the GM opted out. Silent
 *  to the user: while it's in flight (or after a failure) the stable system voice
 *  keeps talking. Retried with backoff so a transient failure heals itself. Safe
 *  now that the renderer sandbox is enabled (see the note above and
 *  src/main/index.ts). */
function maybeAutoLoadNeural(): void {
  if (_autoLoadInFlight || !autoNeuralEnabled()) return
  if (kokoroState() === 'ready' || kokoroState() === 'downloading') return
  if (Date.now() < _autoRetryAt) return
  _autoLoadInFlight = true
  void loadKokoro().then(
    () => {
      _autoLoadInFlight = false
      _autoLoadFailures = 0
      console.info('[voice] neural voices ready')
    },
    (e) => {
      _autoLoadInFlight = false
      const wait = RETRY_DELAYS_MS[Math.min(_autoLoadFailures, RETRY_DELAYS_MS.length - 1)]!
      _autoLoadFailures++
      _autoRetryAt = Date.now() + wait
      console.warn(
        `[voice] neural voices unavailable — using system voice, retrying in ${Math.round(wait / 1000)}s:`,
        (e as Error)?.message ?? e,
      )
      window.setTimeout(() => maybeAutoLoadNeural(), wait + 50)
    },
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

/** Autoplay scene dialogue (meetings, calls, replies) — default: ON. The GM
 *  asked for the room to just talk, not for a speaker button to hunt down. */
const LS_AUTOPLAY = 'hockey.voice.autoplay'
export function isAutoplayEnabled(): boolean {
  try { return localStorage.getItem(LS_AUTOPLAY) !== 'false' } catch { return true }
}
export function setAutoplayEnabled(on: boolean): void {
  try { localStorage.setItem(LS_AUTOPLAY, on ? 'true' : 'false') } catch { /* ignore */ }
  if (!on) cancelSpeech()
}

/**
 * The ONE Announcer the whole app speaks through.
 *
 * Every caller must go through this rather than constructing its own: the neural
 * engine is attached to (and switched on for) this instance the moment the
 * background download finishes, so a private `new Announcer()` is permanently
 * stuck on the robotic system voice no matter what the GM has set. That is
 * exactly what happened to match commentary — the loudest voice in the game —
 * until you found the match screen's own "Enhanced voice" button and pressed it.
 *
 * Call it per use, not once at module scope: each call is also what performs the
 * upgrade-to-neural check.
 */
export function sharedAnnouncer(): Announcer {
  return announcer()
}

/** Master voice switch (persisted by the Announcer) — for the Settings toggle. */
export function isVoiceEnabled(): boolean {
  return announcer().isEnabled
}
export function setVoiceEnabled(on: boolean): void {
  const a = announcer()
  if (on) a.enable()
  else a.disable()
}

/** Speak `text` in the voice cast for `role` (matched to the person via traits).
 *  Interrupts anything already speaking — a click means "this line, now" — so
 *  utterances never overlap. */
export function speakAs(
  role: VoiceRole,
  text: string,
  opts?: { seed?: string; traits?: VoiceTraits; importance?: 1 | 2 | 3 },
): void {
  const a = announcer()
  if (!a.isEnabled) return
  _sceneEpoch++ // a manual line supersedes any running scene
  a.cancel()
  const cast = castFor(role, opts?.seed, opts?.traits)
  a.speakLine({
    text,
    speech: text,
    importance: opts?.importance ?? 2,
    voice: cast.voice,
    rate: cast.rate,
  })
}

/** One line of an autoplayed scene (a meeting, a call, a briefing). */
export interface SceneLine {
  role: VoiceRole
  text: string
  seed?: string
  traits?: VoiceTraits
  importance?: 1 | 2 | 3
}

let _sceneEpoch = 0
/** Pause between speakers so a meeting reads as turns, not a wall of sound. */
const SCENE_GAP_MS = 400

/**
 * Autoplay a scene: speak each line in its speaker's cast voice, strictly one
 * at a time (the next line starts only when the previous finishes — never
 * overlapping). A later scene, a manual speakAs() click, or cancelSpeech()
 * supersedes the rest of the sequence. No-op when voice or autoplay is off.
 */
export function speakScene(lines: SceneLine[]): void {
  const a = announcer()
  if (!a.isEnabled || !isAutoplayEnabled() || lines.length === 0) return
  const epoch = ++_sceneEpoch
  a.cancel()
  const playNext = (i: number): void => {
    if (epoch !== _sceneEpoch || i >= lines.length) return
    const l = lines[i]!
    const cast = castFor(l.role, l.seed, l.traits)
    a.speakLine({
      text: l.text,
      speech: l.text,
      importance: l.importance ?? 2,
      voice: cast.voice,
      rate: cast.rate,
      onDone: () => {
        if (epoch !== _sceneEpoch) return
        window.setTimeout(() => playNext(i + 1), SCENE_GAP_MS)
      },
    })
  }
  playNext(0)
}

/**
 * Synthesise the opening of a line ahead of time so speaking it later starts
 * without a wait — and play nothing now.
 *
 * The neural engine runs its WASM inference on the renderer's main thread, so a
 * long line costs seconds between the click and the first sound. Anything with a
 * natural pause before the GM commits (the phone ringing, a scene fading in) can
 * spend that pause here instead. No-op when voice is off or neural isn't ready.
 */
export function prewarmSpeech(
  role: VoiceRole,
  text: string,
  opts?: { seed?: string; traits?: VoiceTraits },
): void {
  const a = announcer()
  if (!a.isEnabled) return
  const eng = getKokoroEngine()
  if (!eng?.prewarm || kokoroState() !== 'ready') return
  const cast = castFor(role, opts?.seed, opts?.traits)
  void eng.prewarm({ speech: text, voice: cast.voice, rate: cast.rate }).catch(() => {
    /* best-effort — the line is simply synthesised the normal way */
  })
}

/** Stop any in-progress speech (call on unmount / when leaving a scene). */
export function cancelSpeech(): void {
  _sceneEpoch++
  _ann?.cancel()
}

/** Warm the neural voices in the background on app start, so they're already
 *  downloaded and ready before the GM hears the first line — "downloaded by
 *  default" rather than on-first-use. Opt-out and one-time; a failure silently
 *  leaves the system voice in place. Safe post-crash-fix (single-threaded WASM). */
export function warmNeuralVoices(): void {
  maybeAutoLoadNeural()
}
