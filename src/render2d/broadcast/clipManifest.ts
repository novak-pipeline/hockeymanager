/**
 * CLIP MANIFEST + TTS ENGINE CONTRACT.
 *
 * The manifest (public/commentary/manifest.json, written by
 * scripts/dev/render-commentary.mjs) maps a clip id to its file and duration.
 * The audio files themselves are generated at build time and gitignored; only
 * the manifest and the script are committed. A missing file is silence.
 *
 * {@link TtsEngine} is the seam for swapping the booth's voice engine: Kokoro
 * today; a local voice-cloning engine (Chatterbox/Orpheus-class) later. Stems
 * (offline) and name clips (runtime, before puck drop) MUST go through the same
 * engine + voice + style so a stitched name matches the booth.
 */
import type { NameForm, NameStyle, Speaker } from './types'

export interface ClipManifestEntry {
  file: string
  durationMs: number
  speaker: Speaker
  /** The exact text rendered, for auditing. */
  text: string
}

export interface ClipManifest {
  version: 1
  engine: string
  /** Voice id per speaker at render time — a runtime booth.config mismatch
   *  means the stems are stale and must be re-rendered. */
  voices: Record<Speaker, string>
  sampleRate: number
  format: 'wav' | 'ogg' | 'mp3'
  clips: Record<string, ClipManifestEntry>
  /** Proof-of-concept name clips rendered with the stems (not used at runtime). */
  sampleNames?: Array<{ playerName: string; spoken: string; files: Record<string, string> }>
}

/** Style of a spoken utterance; engines without style control approximate it
 *  (Kokoro: terminator punctuation + a small rate change). */
export type TtsStyle = NameStyle

export interface TtsRenderRequest {
  text: string
  voiceId: string
  rate: number
  style: TtsStyle
}

export interface TtsAudio {
  pcm: Float32Array
  sampleRate: number
}

/**
 * The engine interface both the build script and the runtime name renderer use.
 * An implementation must be deterministic for a given (text, voice, style), run
 * off the UI thread, and return mono PCM.
 */
export interface TtsEngine {
  readonly id: string
  render(req: TtsRenderRequest): Promise<TtsAudio>
}

/** Cache key for a player's name clip. Changing the pronunciation, voice or
 *  style re-renders exactly that clip. */
export function nameClipKey(args: {
  playerId: string
  voiceId: string
  form: NameForm
  style: NameStyle
  pronunciationHash: string
}): string {
  return `name|${args.voiceId}|${args.playerId}|${args.form}|${args.style}|${args.pronunciationHash}`
}

/** The text handed to the engine for a name clip in a given style. */
export function nameUtterance(spoken: string, style: NameStyle, terminators: Record<NameStyle, string>): string {
  return `${spoken}${terminators[style]}`
}
