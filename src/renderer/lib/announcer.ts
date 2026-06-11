/**
 * announcer.ts — match commentary voice layer.
 *
 * Two-engine design:
 *
 *   Engine A "system" — Web Speech API (always available on desktop Electron).
 *     Improved voice selection: prefers Natural/Neural/Online names, then
 *     Microsoft Aria/Guy/Jenny/Ryan, then en-US Google, then any en-US, then
 *     system default.  Rate ~1.12, pitch ~0.95.
 *
 *   Engine B "kokoro" — kokoro-js neural TTS (loadKokoro() from kokoroVoice.ts).
 *     ~80-90 MB model, user-opt-in only; never auto-downloaded.
 *
 * The Announcer class is the public facade, API-compatible with the previous
 * single-engine Announcer used by MatchViewer (same speak/cancel/toggle/
 * enable/disable/isEnabled surface, plus new useEngine/speakLine methods).
 *
 * localStorage keys:
 *   hockeyAnnouncerEnabled   — boolean (default true)
 *   hockeyAnnouncerEngine    — 'system' | 'kokoro' (default 'system')
 */

// ── SpeakLine (shared with kokoroVoice) ────────────────────────────────────

/**
 * A single commentary line to speak.
 * `text`       — display text (shown in the ticker).
 * `speech`     — speech-optimised version (may differ from display text,
 *                e.g. numbers spelled out, pauses inserted).
 * `importance` — 1 routine | 2 notable | 3 goal/major event.
 */
export interface SpeakLine {
  text: string
  speech: string
  importance: 1 | 2 | 3
}

// ── VoiceEngine interface ───────────────────────────────────────────────────

export interface VoiceEngine {
  speak(line: SpeakLine): void
  cancel(): void
  readonly ready: boolean
  readonly name: string
}

// ── localStorage helpers ───────────────────────────────────────────────────

const LS_ENABLED = 'hockeyAnnouncerEnabled'
const LS_ENGINE = 'hockeyAnnouncerEngine'
const MAX_QUEUE = 2

function readEnabled(): boolean {
  try {
    return localStorage.getItem(LS_ENABLED) !== 'false'
  } catch {
    return true
  }
}

function writeEnabled(v: boolean): void {
  try { localStorage.setItem(LS_ENABLED, String(v)) } catch { /* ignore */ }
}

function readEngineKind(): 'system' | 'kokoro' {
  try {
    const v = localStorage.getItem(LS_ENGINE)
    if (v === 'kokoro') return 'kokoro'
  } catch { /* ignore */ }
  return 'system'
}

function writeEngineKind(v: 'system' | 'kokoro'): void {
  try { localStorage.setItem(LS_ENGINE, v) } catch { /* ignore */ }
}

// ── Voice selection for Web Speech API ────────────────────────────────────

/**
 * Rank and pick the best available voice for sports commentary.
 *
 * Priority (highest first):
 *  1. Name contains 'Natural', 'Neural', or 'Online' (OS/browser neural voices)
 *  2. Name contains 'Aria', 'Guy', 'Jenny', or 'Ryan' (Microsoft neural voices)
 *  3. Any en-US voice from Google
 *  4. Any en-US voice
 *  5. Any en-* voice
 *  6. System default
 */
function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null

  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'))

  // Tier 0 (preferred): a British male commentator voice. "George" is the
  // Windows UK English male voice; Daniel/Arthur are common alternatives.
  // Prefer a natural/neural UK voice first, then any en-GB, then SAPI George.
  const gb = en.filter((v) => v.lang.toLowerCase() === 'en-gb')
  const britFirst = [
    ...gb.filter((v) => /natural|neural|online/i.test(v.name)),
    ...gb.filter((v) => /george|daniel|arthur|ryan/i.test(v.name)),
    ...en.filter((v) => /george/i.test(v.name)),
    ...gb,
  ]
  if (britFirst.length > 0) return britFirst[0]

  // Tier 1: names suggestive of neural/natural quality
  const tier1Names = ['natural', 'neural', 'online']
  for (const pattern of tier1Names) {
    const match = en.find((v) => v.name.toLowerCase().includes(pattern))
    if (match) return match
  }

  // Tier 2: known high-quality Microsoft voices
  const tier2Names = ['aria', 'guy', 'jenny', 'ryan']
  for (const pattern of tier2Names) {
    const match = en.find((v) => v.name.toLowerCase().includes(pattern))
    if (match) return match
  }

  // Tier 3: en-US Google
  const googleUS = en.find(
    (v) => v.lang.toLowerCase() === 'en-us' && v.name.toLowerCase().includes('google'),
  )
  if (googleUS) return googleUS

  // Tier 4: any en-US
  const anyUS = en.find((v) => v.lang.toLowerCase() === 'en-us')
  if (anyUS) return anyUS

  // Tier 5: any en-*
  if (en.length > 0) return en[0]

  // Tier 6: default
  return voices.find((v) => v.default) ?? voices[0] ?? null
}

// ── SystemVoiceEngine ──────────────────────────────────────────────────────

class SystemVoiceEngine implements VoiceEngine {
  readonly name = 'system'

  private _voiceCache: SpeechSynthesisVoice | null = null
  private _voicesLoaded = false
  private _queue = 0
  private _available: boolean

  constructor() {
    this._available =
      typeof window !== 'undefined' && 'speechSynthesis' in window

    if (this._available) {
      const load = () => {
        const vs = window.speechSynthesis.getVoices()
        if (vs.length > 0) {
          this._voiceCache = pickVoice(vs)
          this._voicesLoaded = true
        }
      }
      load()
      window.speechSynthesis.addEventListener('voiceschanged', load)
    }
  }

  get ready(): boolean {
    return this._available
  }

  speak(line: SpeakLine): void {
    if (!this._available) return
    if (this._queue >= MAX_QUEUE && line.importance === 1) return

    this._queue++

    if (!this._voicesLoaded) {
      const vs = window.speechSynthesis.getVoices()
      if (vs.length > 0) {
        this._voiceCache = pickVoice(vs)
        this._voicesLoaded = true
      }
    }

    const utt = new SpeechSynthesisUtterance(line.speech)
    utt.rate = 1.12
    utt.pitch = 0.95
    // Match the chosen voice's locale (e.g. en-GB for George) so the engine
    // doesn't substitute a US voice; fall back to en-US when none is cached.
    utt.lang = this._voiceCache?.lang ?? 'en-US'
    if (this._voiceCache) utt.voice = this._voiceCache

    const decrement = () => {
      this._queue = Math.max(0, this._queue - 1)
    }
    utt.onend = decrement
    utt.onerror = decrement

    window.speechSynthesis.speak(utt)
  }

  cancel(): void {
    if (!this._available) return
    window.speechSynthesis.cancel()
    this._queue = 0
  }

  /** Return a snapshot of available voices for a settings picker. */
  listVoices(): SpeechSynthesisVoice[] {
    if (!this._available) return []
    return window.speechSynthesis.getVoices()
  }
}

// ── Announcer facade ───────────────────────────────────────────────────────

/**
 * Public facade used by MatchViewer (and future settings UI).
 *
 * Drop-in replacement for the original single-engine Announcer:
 *   - .available      — true when at least the system engine is usable
 *   - .isEnabled      — persisted toggle
 *   - .toggle()       — flip enabled state
 *   - .enable()       — enable + persist
 *   - .disable()      — disable + cancel + persist
 *   - .speak(text, importance)  — legacy 2-arg form (MatchViewer compat)
 *   - .speakLine(line)          — new typed form preferred by new callers
 *   - .cancel()
 *   - .useEngine(kind)          — switch between 'system' and 'kokoro'
 */
export class Announcer {
  readonly available: boolean

  private enabled: boolean
  private engineKind: 'system' | 'kokoro'
  private systemEngine: SystemVoiceEngine
  private kokoroEngine: VoiceEngine | null = null

  constructor() {
    this.systemEngine = new SystemVoiceEngine()
    this.available = this.systemEngine.ready

    this.enabled = this.available ? readEnabled() : false
    this.engineKind = readEngineKind()
  }

  // ── State queries ────────────────────────────────────────────────────────

  get isEnabled(): boolean {
    return this.enabled
  }

  get activeEngineName(): string {
    return this._activeEngine().name
  }

  // ── Control ──────────────────────────────────────────────────────────────

  toggle(): void {
    this.enabled = !this.enabled
    writeEnabled(this.enabled)
    if (!this.enabled) this.cancel()
  }

  enable(): void {
    this.enabled = true
    writeEnabled(true)
  }

  disable(): void {
    this.enabled = false
    writeEnabled(false)
    this.cancel()
  }

  /**
   * Switch the active voice engine.
   * When switching to 'kokoro', you must supply a pre-loaded VoiceEngine
   * (from loadKokoro()) — this method does NOT trigger a download.
   */
  useEngine(kind: 'system' | 'kokoro', engine?: VoiceEngine): void {
    if (kind === 'kokoro') {
      if (engine) {
        this.kokoroEngine = engine
      } else if (!this.kokoroEngine) {
        // No engine provided and none cached; stay on system
        return
      }
    }
    this.cancel()
    this.engineKind = kind
    writeEngineKind(kind)
  }

  // ── Speaking ─────────────────────────────────────────────────────────────

  /**
   * Speak a line (new typed form).
   */
  speakLine(line: SpeakLine): void {
    if (!this.available || !this.enabled) return
    this._activeEngine().speak(line)
  }

  /**
   * Speak text — legacy 2-argument form kept for MatchViewer source-compat.
   * Converts to a SpeakLine and delegates to speakLine().
   */
  speak(text: string, importance: 1 | 2 | 3): void {
    this.speakLine({ text, speech: text, importance })
  }

  cancel(): void {
    this.systemEngine.cancel()
    this.kokoroEngine?.cancel()
  }

  // ── Voice picker helper ───────────────────────────────────────────────────

  /**
   * Return all available Web Speech voices (for a settings UI picker).
   */
  listVoices(): SpeechSynthesisVoice[] {
    return this.systemEngine.listVoices()
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private _activeEngine(): VoiceEngine {
    if (this.engineKind === 'kokoro' && this.kokoroEngine?.ready) {
      return this.kokoroEngine
    }
    return this.systemEngine
  }
}
