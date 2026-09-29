/**
 * CLIP MANIFEST + NAME-BANK INDEX — the formats the offline booth renderer
 * (scripts/booth/) writes and the app reads. No engine runs in the app: the
 * voice engines (Dia2, Chatterbox) live in the offline scripts only.
 *
 *   src/renderer/public/commentary/<pair>/manifest.json   stems  ({@link ClipManifest})
 *   src/renderer/public/commentary/<pair>/names/index.json  fictional name pools  ({@link NameBankIndex})
 *   mods/<mod>/commentary/<pair>/index.json                 a mod's real-roster names
 *
 * A missing file is silence (the line plays bare, or not at all).
 */
import type { Speaker } from './types'

export interface ClipManifestEntry {
  file: string
  durationMs: number
  speaker: Speaker
  /** The exact text the clip says, for auditing. */
  text: string
}

export interface ClipManifest {
  version: 1
  engine: string
  /** Voice id per seat at render time — a runtime booth.config mismatch
   *  means the stems are stale and must be re-rendered. */
  voices: Record<Speaker, string>
  sampleRate: number
  format: 'wav' | 'ogg' | 'mp3'
  clips: Record<string, ClipManifestEntry>
}

/**
 * A name bank: `entries` maps `"<seat>|<style>|<spoken text>"` (see
 * `bankKey` in the renderer) to a clip file next to the index. Keyed by the
 * spoken TEXT, not a player id, so every player who shares a surname (and every
 * generated player who draws it later) shares the clip.
 */
export interface NameBankIndex {
  version: 1
  pair: string
  voices: Record<Speaker, string>
  format: 'ogg'
  entries: Record<string, string>
}
