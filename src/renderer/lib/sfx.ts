/**
 * MatchSfx — procedural Web Audio sound effects for the match viewer.
 *
 * NO asset files: every sound is synthesised from oscillators, filtered noise,
 * and simple envelopes.  One AudioContext is shared across the class lifetime;
 * it is created lazily and kept SUSPENDED until resume() is called from a user
 * gesture (browser autoplay policy).
 *
 * Pure helper functions (envelope math, frequency tables) are exported
 * separately so they can be unit-tested without an AudioContext.
 */

// ── Pure helpers (no AudioContext — safe in Node / Vitest) ─────────────────

/**
 * Build a simple linear ADSR envelope value at time `t` (seconds).
 * Returns a gain multiplier in [0, 1].
 */
export function adsrValue(
  t: number,
  attack: number,
  decay: number,
  sustain: number,
  release: number,
  totalDuration: number,
): number {
  const releaseStart = totalDuration - release
  if (t < 0) return 0
  if (t < attack) return t / attack
  if (t < attack + decay) return 1 - ((t - attack) / decay) * (1 - sustain)
  if (t < releaseStart) return sustain
  if (t < totalDuration) return sustain * (1 - (t - releaseStart) / release)
  return 0
}

/**
 * Clamp a value to [lo, hi].
 */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Map a danger level (0..1) to a shot snap gain multiplier (0.4..1.0).
 * Pure — no AudioContext dependency.
 */
export function dangerToSnapGain(danger: number): number {
  return 0.4 + clamp(danger, 0, 1) * 0.6
}

/**
 * Map a danger level (0..1) to a shot whoosh gain (0..0.35).
 * Pure — no AudioContext dependency.
 */
export function dangerToWhooshGain(danger: number): number {
  return clamp(danger, 0, 1) * 0.35
}

/**
 * Map a crowd excitement level (0..1) to a bandpass centre frequency (Hz).
 * At level 0 → 300 Hz; at level 1 → 1200 Hz.
 * Pure.
 */
export function crowdFrequency(level: number): number {
  return 300 + clamp(level, 0, 1) * 900
}

// ── AudioContext guard ──────────────────────────────────────────────────────

/** Returns true when running in a browser with AudioContext available. */
function hasAudioContext(): boolean {
  return (
    typeof window !== 'undefined' &&
    (typeof AudioContext !== 'undefined' || typeof (window as unknown as Record<string, unknown>)['webkitAudioContext'] !== 'undefined')
  )
}

// ── MatchSfx ───────────────────────────────────────────────────────────────

export class MatchSfx {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private enabled: boolean = true
  private volume: number = 0.7

  // Crowd ambient state
  private crowdSource: AudioBufferSourceNode | null = null
  private crowdGain: GainNode | null = null
  private crowdFilter: BiquadFilterNode | null = null
  private crowdBuffer: AudioBuffer | null = null

  constructor() {
    // Lazily created — no AudioContext until resume()
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setEnabled(b: boolean): void {
    this.enabled = b
    if (!b) {
      this.masterGain?.gain.setValueAtTime(0, this._ctx()?.currentTime ?? 0)
      this._stopCrowd()
    } else {
      const ctx = this.ctx
      if (ctx && this.masterGain) {
        this.masterGain.gain.setValueAtTime(this.volume, ctx.currentTime)
      }
    }
  }

  setVolume(v: number): void {
    this.volume = clamp(v, 0, 1)
    const ctx = this.ctx
    if (ctx && this.masterGain && this.enabled) {
      this.masterGain.gain.setValueAtTime(this.volume, ctx.currentTime)
    }
  }

  /**
   * Must be called from a user-gesture handler (click, keydown, etc.) to
   * unlock the AudioContext for playback.
   */
  resume(): void {
    const ctx = this._ctx()
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume()
    }
  }

  /** Short wood-click puck pass: filtered noise burst ~30 ms. */
  pass(): void {
    const ctx = this._ready()
    if (!ctx) return

    const dur = 0.03
    const buf = this._whiteNoise(ctx, dur)

    const src = ctx.createBufferSource()
    src.buffer = buf

    // High-pass to give a woody click character
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 2400
    hp.Q.value = 1.2

    const env = ctx.createGain()
    const t = ctx.currentTime
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(0.6, t + 0.002)
    env.gain.exponentialRampToValueAtTime(0.001, t + dur)

    src.connect(hp)
    hp.connect(env)
    env.connect(this.masterGain!)
    src.start(t)
    src.stop(t + dur + 0.01)
  }

  /** Puck shot: sharp crack + brief whoosh scaled by danger (0..1). */
  shot(danger: number): void {
    const ctx = this._ready()
    if (!ctx) return

    const snapDur = 0.04
    const whooshDur = 0.18
    const t = ctx.currentTime

    // ── snap (transient click) ──
    const snapBuf = this._whiteNoise(ctx, snapDur)
    const snapSrc = ctx.createBufferSource()
    snapSrc.buffer = snapBuf

    const snapFilter = ctx.createBiquadFilter()
    snapFilter.type = 'bandpass'
    snapFilter.frequency.value = 3500
    snapFilter.Q.value = 0.8

    const snapEnv = ctx.createGain()
    const snapGain = dangerToSnapGain(danger)
    snapEnv.gain.setValueAtTime(0, t)
    snapEnv.gain.linearRampToValueAtTime(snapGain, t + 0.003)
    snapEnv.gain.exponentialRampToValueAtTime(0.001, t + snapDur)

    snapSrc.connect(snapFilter)
    snapFilter.connect(snapEnv)
    snapEnv.connect(this.masterGain!)
    snapSrc.start(t)
    snapSrc.stop(t + snapDur + 0.01)

    // ── whoosh (falling noise sweep) ──
    const whooshGainVal = dangerToWhooshGain(danger)
    if (whooshGainVal > 0.01) {
      const whooshBuf = this._whiteNoise(ctx, whooshDur)
      const whooshSrc = ctx.createBufferSource()
      whooshSrc.buffer = whooshBuf

      const whooshFilter = ctx.createBiquadFilter()
      whooshFilter.type = 'bandpass'
      whooshFilter.frequency.setValueAtTime(4000, t)
      whooshFilter.frequency.exponentialRampToValueAtTime(400, t + whooshDur)
      whooshFilter.Q.value = 2

      const whooshEnv = ctx.createGain()
      whooshEnv.gain.setValueAtTime(whooshGainVal, t + 0.005)
      whooshEnv.gain.exponentialRampToValueAtTime(0.001, t + whooshDur)

      whooshSrc.connect(whooshFilter)
      whooshFilter.connect(whooshEnv)
      whooshEnv.connect(this.masterGain!)
      whooshSrc.start(t + 0.005)
      whooshSrc.stop(t + whooshDur + 0.01)
    }
  }

  /** Goalie pad save: low thud. */
  save(): void {
    const ctx = this._ready()
    if (!ctx) return

    const dur = 0.08
    const t = ctx.currentTime

    const buf = this._whiteNoise(ctx, dur)
    const src = ctx.createBufferSource()
    src.buffer = buf

    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 350
    lp.Q.value = 0.7

    const env = ctx.createGain()
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(0.55, t + 0.008)
    env.gain.exponentialRampToValueAtTime(0.001, t + dur)

    src.connect(lp)
    lp.connect(env)
    env.connect(this.masterGain!)
    src.start(t)
    src.stop(t + dur + 0.01)
  }

  /**
   * Classic arena goal horn: two-tone sawtooth stack, ~1.5 s with decay,
   * followed by a crowd swell.
   */
  goalHorn(): void {
    const ctx = this._ready()
    if (!ctx) return

    const t = ctx.currentTime
    const hornDur = 1.5

    // Classic two-tone: Bb3 (~233 Hz) + F4 (~349 Hz) — a minor sixth interval
    const freqs = [233, 349]
    for (const freq of freqs) {
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = freq

      // Layer in a slightly-detuned second oscillator for fatness
      const osc2 = ctx.createOscillator()
      osc2.type = 'sawtooth'
      osc2.frequency.value = freq * 1.008

      const env = ctx.createGain()
      env.gain.setValueAtTime(0, t)
      env.gain.linearRampToValueAtTime(0.28, t + 0.06)
      env.gain.setValueAtTime(0.28, t + hornDur - 0.5)
      env.gain.exponentialRampToValueAtTime(0.001, t + hornDur)

      // Slight lowpass to round off the harsh sawtooth
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 1800

      osc.connect(lp)
      osc2.connect(lp)
      lp.connect(env)
      env.connect(this.masterGain!)

      osc.start(t)
      osc2.start(t)
      osc.stop(t + hornDur + 0.05)
      osc2.stop(t + hornDur + 0.05)
    }

    // Crowd swell after horn
    this.crowd(1.0)
    if (this.crowdGain) {
      const cg = this.crowdGain
      const ct = ctx.currentTime + hornDur
      cg.gain.setValueAtTime(cg.gain.value, ct)
      cg.gain.linearRampToValueAtTime(0.18, ct + 0.4)
      cg.gain.linearRampToValueAtTime(0.08, ct + 3.0)
    }
  }

  /**
   * Referee whistle: shrill dual-tone at ~2.2 kHz, ~400 ms.
   */
  whistle(): void {
    const ctx = this._ready()
    if (!ctx) return

    const t = ctx.currentTime
    const dur = 0.4

    // Two close frequencies for that characteristic whistle warble
    for (const freq of [2180, 2260]) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq

      const env = ctx.createGain()
      env.gain.setValueAtTime(0, t)
      env.gain.linearRampToValueAtTime(0.22, t + 0.015)
      env.gain.setValueAtTime(0.22, t + dur - 0.06)
      env.gain.linearRampToValueAtTime(0, t + dur)

      osc.connect(env)
      env.connect(this.masterGain!)
      osc.start(t)
      osc.stop(t + dur + 0.01)
    }
  }

  /** Puck drop: tiny hard tick. */
  puckDrop(): void {
    const ctx = this._ready()
    if (!ctx) return

    const dur = 0.015
    const t = ctx.currentTime

    const buf = this._whiteNoise(ctx, dur)
    const src = ctx.createBufferSource()
    src.buffer = buf

    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 5000
    bp.Q.value = 3

    const env = ctx.createGain()
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(0.45, t + 0.002)
    env.gain.exponentialRampToValueAtTime(0.001, t + dur)

    src.connect(bp)
    bp.connect(env)
    env.connect(this.masterGain!)
    src.start(t)
    src.stop(t + dur + 0.01)
  }

  /**
   * Ambient crowd loop: looped brown-noise bed through bandpass.
   * `level` 0..1 controls gain and bandpass centre frequency.
   * Calling again updates the existing loop smoothly.
   */
  crowd(level: number): void {
    const ctx = this._ready()
    if (!ctx) return

    const targetGain = clamp(level, 0, 1) * 0.12
    const targetFreq = crowdFrequency(level)

    if (!this.crowdSource) {
      // Start the crowd loop for the first time
      this.crowdBuffer ??= this._brownNoise(ctx, 4.0)

      const src = ctx.createBufferSource()
      src.buffer = this.crowdBuffer
      src.loop = true

      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = targetFreq
      filter.Q.value = 0.5

      const gainNode = ctx.createGain()
      gainNode.gain.setValueAtTime(0, ctx.currentTime)
      gainNode.gain.linearRampToValueAtTime(targetGain, ctx.currentTime + 0.5)

      src.connect(filter)
      filter.connect(gainNode)
      gainNode.connect(this.masterGain!)
      src.start()

      this.crowdSource = src
      this.crowdGain = gainNode
      this.crowdFilter = filter
    } else {
      // Smooth-transition existing loop
      const now = ctx.currentTime
      this.crowdGain!.gain.linearRampToValueAtTime(targetGain, now + 0.8)
      this.crowdFilter!.frequency.linearRampToValueAtTime(targetFreq, now + 0.8)
    }
  }

  dispose(): void {
    this._stopCrowd()
    if (this.ctx) {
      void this.ctx.close()
      this.ctx = null
      this.masterGain = null
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Lazily create (or return) the AudioContext. */
  private _ctx(): AudioContext | null {
    if (!hasAudioContext()) return null
    if (!this.ctx) {
      const Ctor =
        (typeof AudioContext !== 'undefined'
          ? AudioContext
          : (window as unknown as Record<string, unknown>)['webkitAudioContext']) as typeof AudioContext
      this.ctx = new Ctor()

      const master = this.ctx.createGain()
      master.gain.setValueAtTime(this.volume, this.ctx.currentTime)
      master.connect(this.ctx.destination)
      this.masterGain = master
    }
    return this.ctx
  }

  /**
   * Return the AudioContext if it is running (not suspended), or null.
   * Silently skips playback when the context is suspended (pre-gesture).
   */
  private _ready(): AudioContext | null {
    if (!this.enabled) return null
    const ctx = this._ctx()
    if (!ctx) return null
    if (ctx.state === 'suspended') return null
    return ctx
  }

  /** Create a short white-noise buffer of the given duration (seconds). */
  private _whiteNoise(ctx: AudioContext, durationSec: number): AudioBuffer {
    const sr = ctx.sampleRate
    const len = Math.ceil(sr * durationSec)
    const buf = ctx.createBuffer(1, len, sr)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1
    }
    return buf
  }

  /**
   * Create a loopable brown-noise buffer.
   * Brown noise = integrated white noise, good for crowd rumble.
   */
  private _brownNoise(ctx: AudioContext, durationSec: number): AudioBuffer {
    const sr = ctx.sampleRate
    const len = Math.ceil(sr * durationSec)
    const buf = ctx.createBuffer(1, len, sr)
    const data = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1
      last = (last + 0.02 * white) / 1.02
      data[i] = last * 3.5 // normalise amplitude
    }
    return buf
  }

  private _stopCrowd(): void {
    try { this.crowdSource?.stop() } catch { /* already stopped */ }
    this.crowdSource = null
    this.crowdGain = null
    this.crowdFilter = null
  }
}
