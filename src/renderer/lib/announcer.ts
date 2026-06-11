/**
 * Thin wrapper around window.speechSynthesis for live match commentary.
 *
 * Design constraints:
 *  - Feature-detected: no-op + available:false when speechSynthesis is absent.
 *  - Queue depth limited to 2 pending utterances; importance-1 lines dropped
 *    when the queue is full.
 *  - cancel() called on pause / seek / close so stale lines don't blurt later.
 *  - Rate ~1.15 (slightly brisk but natural).
 *  - Prefers an en-US "natural" voice when available (heuristic on voice.name).
 *  - enabled flag persisted in localStorage so the toggle survives page reloads.
 *
 * Future upgrade path (documented here, not installed):
 *   kokoro-js (Apache-2.0) is a local neural TTS library that runs in-browser
 *   via WebAssembly with no server round-trip. When we want broadcast-quality
 *   voices without a cloud dependency, drop it in and route speech through
 *   kokoro instead of Web Speech API. The Announcer interface stays the same —
 *   only the speak() internals change.
 */

const LS_KEY = 'hockeyAnnouncerEnabled'
const MAX_QUEUE = 2

function readEnabled(): boolean {
  try {
    const v = localStorage.getItem(LS_KEY)
    return v !== 'false' // default on
  } catch {
    return true
  }
}

function writeEnabled(v: boolean): void {
  try {
    localStorage.setItem(LS_KEY, String(v))
  } catch {
    // ignore
  }
}

/** Heuristic: prefer a voice that sounds like a real en-US voice. */
function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null

  // Prefer natural/neural voices first, then any en-US
  const naturalPatterns = ['natural', 'neural', 'enhanced', 'premium', 'samantha', 'alex', 'zira', 'david']
  const enUS = voices.filter((v) => v.lang.toLowerCase().startsWith('en'))

  for (const pattern of naturalPatterns) {
    const match = enUS.find((v) => v.name.toLowerCase().includes(pattern))
    if (match) return match
  }

  // Fallback: first en-US voice
  if (enUS.length > 0) return enUS[0]

  // Last resort: default voice
  return voices.find((v) => v.default) ?? voices[0] ?? null
}

export class Announcer {
  readonly available: boolean
  private enabled: boolean
  private queue: number = 0 // number of utterances pending
  private voiceCache: SpeechSynthesisVoice | null = null
  private voicesLoaded = false

  constructor() {
    this.available = typeof window !== 'undefined' && 'speechSynthesis' in window
    this.enabled = this.available ? readEnabled() : false

    if (this.available) {
      // Pre-load voices (Chrome loads them async)
      const load = () => {
        const voices = window.speechSynthesis.getVoices()
        if (voices.length > 0) {
          this.voiceCache = pickVoice(voices)
          this.voicesLoaded = true
        }
      }
      load()
      window.speechSynthesis.addEventListener('voiceschanged', load)
    }
  }

  get isEnabled(): boolean {
    return this.enabled
  }

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
   * Speak a line.
   *
   * @param text       The speech-friendly text to speak.
   * @param importance 1|2|3. Importance-1 lines are dropped if queue >= MAX_QUEUE.
   */
  speak(text: string, importance: 1 | 2 | 3): void {
    if (!this.available || !this.enabled) return
    if (this.queue >= MAX_QUEUE && importance === 1) return

    this.queue++

    if (!this.voicesLoaded) {
      const voices = window.speechSynthesis.getVoices()
      if (voices.length > 0) {
        this.voiceCache = pickVoice(voices)
        this.voicesLoaded = true
      }
    }

    const utt = new SpeechSynthesisUtterance(text)
    utt.rate = 1.15
    utt.lang = 'en-US'
    if (this.voiceCache) utt.voice = this.voiceCache

    utt.onend = () => {
      this.queue = Math.max(0, this.queue - 1)
    }
    utt.onerror = () => {
      this.queue = Math.max(0, this.queue - 1)
    }

    window.speechSynthesis.speak(utt)
  }

  /** Cancel all pending speech immediately (call on pause / seek / close). */
  cancel(): void {
    if (!this.available) return
    window.speechSynthesis.cancel()
    this.queue = 0
  }
}
