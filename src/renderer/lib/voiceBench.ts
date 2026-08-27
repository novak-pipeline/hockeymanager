/**
 * voiceBench.ts — measure what a spoken line costs the UI.
 *
 * The TTS freeze was never going to be settled by opinion, so this is the ruler.
 * A timer that wants to fire every 10 ms can only be late if something is holding
 * the main thread; summing that lateness while a line is spoken gives the total
 * time the game was unresponsive, and the worst single gap gives the size of the
 * longest visible stutter.
 *
 * Reported per run:
 *   transport    'worker' | 'main-thread' — where synthesis actually ran
 *   spokenBy     which voice actually said it. 'system' with the neural engine
 *                selected means the model measured too slow and stood aside.
 *   firstAudioMs speak() → first sound out of the speakers (the felt latency)
 *   totalMs      speak() → the line finished
 *   blockedMs    total main-thread time stolen while the line played
 *   maxStallMs   the longest single freeze — anything over ~100 ms is visible
 *   stalls       how many separate freezes over the threshold
 *   synthMs      per-chunk synthesis cost, timed where the work happens
 *   realtime     seconds of speech produced per second of synthesis. Under 1.0
 *                the model cannot keep up with its own voice and long lines
 *                arrive late no matter how well they are pipelined.
 *
 * Run it from the app's devtools console:
 *   await window.hockeyVoiceBench()                  // default line
 *   await window.hockeyVoiceBench('some other text')
 *
 * To measure the OLD behaviour for comparison, put synthesis back on the main
 * thread and reload:
 *   localStorage.setItem('hockey.voice.mainThreadSynth', 'true')
 */
import { sharedAnnouncer } from './speak'
import { castFor, type VoiceRole } from './voiceCast'
import { clearVoiceClipCache, kokoroState, kokoroTransport, takeSynthTimings } from './kokoroVoice'

/** Lateness below this is scheduler noise, not a freeze the GM would notice. */
const STALL_FLOOR_MS = 40
const TICK_MS = 10

export interface VoiceBenchResult {
  transport: 'worker' | 'main-thread' | null
  engine: string
  spokenBy: 'neural' | 'system'
  chars: number
  firstAudioMs: number
  totalMs: number
  blockedMs: number
  maxStallMs: number
  stalls: number
  synthMs: number[]
  realtime: number
}

interface Monitor {
  stop(): { blockedMs: number; maxStallMs: number; stalls: number }
}

/** Watch the main thread for stalls until stopped. */
export function startStallMonitor(): Monitor {
  let last = performance.now()
  let blockedMs = 0
  let maxStallMs = 0
  let stalls = 0
  const timer = setInterval(() => {
    const now = performance.now()
    const late = now - last - TICK_MS
    last = now
    if (late >= STALL_FLOOR_MS) {
      blockedMs += late
      stalls++
      if (late > maxStallMs) maxStallMs = late
    }
  }, TICK_MS)
  return {
    stop() {
      clearInterval(timer)
      return { blockedMs: Math.round(blockedMs), maxStallMs: Math.round(maxStallMs), stalls }
    },
  }
}

/** A line long enough to need several chunks — the case that used to freeze. */
const DEFAULT_LINE =
  'We went through the tape from the road trip twice this morning, and the pattern is the same one you flagged in October. ' +
  'The forecheck is fine, the exits are not, and it is costing us a goal every other night. ' +
  'Give me two weeks of neutral-zone work and I think we claw most of it back.'

/**
 * Speak a line and report what it cost the UI. The clip cache is dropped first,
 * so a repeat run measures real synthesis instead of reporting a cached zero.
 */
export async function runVoiceBench(
  text: string = DEFAULT_LINE,
  role: VoiceRole = 'coach',
): Promise<VoiceBenchResult> {
  const ann = sharedAnnouncer()
  ann.cancel()
  clearVoiceClipCache()
  takeSynthTimings() // drop anything logged before this run
  // Fixed seed so every run casts the SAME voice and the numbers compare.
  const cast = castFor(role, 'bench')
  const t0 = performance.now()
  let firstAudioMs = -1
  const mon = startStallMonitor()
  await new Promise<void>((resolve) => {
    ann.speakLine({
      text,
      speech: text,
      importance: 3,
      voice: cast.voice,
      rate: cast.rate,
      onFirstAudio: () => { firstAudioMs = performance.now() - t0 },
      onDone: () => resolve(),
    })
  })
  const totalMs = performance.now() - t0
  const s = mon.stop()
  const timings = takeSynthTimings()
  const synthTotal = timings.reduce((a, t) => a + t.ms, 0)
  const audioTotal = timings.reduce((a, t) => a + t.audioSec, 0)
  const result: VoiceBenchResult = {
    transport: kokoroTransport(),
    engine: kokoroState() === 'ready' ? ann.activeEngineName : `${ann.activeEngineName} (kokoro ${kokoroState()})`,
    // No synthesis happened => nothing neural was produced for this line, so
    // whatever spoke it was the system voice.
    spokenBy: timings.length > 0 ? 'neural' : 'system',
    chars: text.length,
    firstAudioMs: Math.round(firstAudioMs),
    totalMs: Math.round(totalMs),
    ...s,
    synthMs: timings.map((t) => Math.round(t.ms)),
    realtime: synthTotal > 0 ? Math.round((audioTotal / (synthTotal / 1000)) * 100) / 100 : 0,
  }
  console.info('[voiceBench]', result)
  return result
}
