/**
 * commentaryAudio.ts — the booth's audio in the app: PRE-RECORDED stems + name
 * clips, stitched and played through WebAudio on the director's cues.
 *
 *  - Nothing is synthesised while the game runs, ever. No TTS model is loaded
 *    by this module (the old live-Kokoro name renderer is gone: it spun up a
 *    neural model mid-game and the voice never matched the stems).
 *  - STEMS: src/renderer/public/commentary/<pair>/ (shipped), rendered offline
 *    by scripts/booth/render_stems.py.
 *  - NAMES: name banks rendered offline by scripts/booth/render_names.py —
 *    the fictional name pools' bank ships with the stems; a real-roster mod
 *    carries its own bank in mods/<mod>/commentary/<pair>/ (real names are mod
 *    data). Tonight's players' clips are read + decoded before puck drop
 *    (decodeAudioData runs off the main thread). A name that isn't in any bank
 *    simply isn't said: the scheduler plays the line's BARE clip.
 *  - STEMS-MISSING GUARD: if the chosen booth pair isn't installed, the other
 *    pair is used; if none is, the booth reports 'unavailable' so the UI can
 *    say so instead of sitting silent.
 *  - There is NO system-voice fallback (owner rule: no "Microsoft Sam").
 *
 * Commentary has its own switch (OFF by default until the owner approves the
 * sound), independent of the general voice toggle.
 */
import booth from '../../render2d/broadcast/booth.config.json'
import { STITCH_GAP_MS, type AudioSink, type ClipLookup, type ClipRef } from '../../render2d/broadcast/audioScheduler'
import type { ClipManifest } from '../../render2d/broadcast/clipManifest'
import { spokenName, type NameInput, type PronunciationFile } from '../../render2d/broadcast/pronunciation'
import type { NameForm, NameStyle, Speaker } from '../../render2d/broadcast/types'

/* ─────────────────────────── settings ─────────────────────────── */

const LS_COMMENTARY = 'hockey.broadcast.commentary'
const LS_PRESENTATION = 'hockey.broadcast.presentation'
const LS_VOLUME = 'hockey.broadcast.commentaryVolume'
const LS_PAIR = 'hockey.broadcast.boothPair'

export type BoothPair = keyof typeof booth.pairs
export const BOOTH_PAIRS = Object.keys(booth.pairs) as BoothPair[]

/** Commentary: OFF by default until the owner approves the booth's sound. */
export function isCommentaryEnabled(): boolean {
  try { return localStorage.getItem(LS_COMMENTARY) === 'true' } catch { return false }
}
export function setCommentaryEnabled(on: boolean): void {
  try { localStorage.setItem(LS_COMMENTARY, on ? 'true' : 'false') } catch { /* ignore */ }
}

/** Booth volume, 0..1 (default 0.9). */
export function readCommentaryVolume(): number {
  try {
    const v = Number(localStorage.getItem(LS_VOLUME))
    if (localStorage.getItem(LS_VOLUME) !== null && Number.isFinite(v)) return Math.min(1, Math.max(0, v))
  } catch { /* ignore */ }
  return 0.9
}
export function writeCommentaryVolume(v: number): void {
  try { localStorage.setItem(LS_VOLUME, String(Math.min(1, Math.max(0, v)))) } catch { /* ignore */ }
}

/** Which booth (voice pair) calls the game. Dia2 by default. */
export function readBoothPair(): BoothPair {
  try {
    const v = localStorage.getItem(LS_PAIR)
    if (v && v in booth.pairs) return v as BoothPair
  } catch { /* ignore */ }
  return booth.defaultPair as BoothPair
}
export function writeBoothPair(p: BoothPair): void {
  try { localStorage.setItem(LS_PAIR, p) } catch { /* ignore */ }
}

export type PresentationSetting = 'full' | 'compact' | 'off'
export function readPresentation(): PresentationSetting {
  try {
    const v = localStorage.getItem(LS_PRESENTATION)
    if (v === 'full' || v === 'compact' || v === 'off') return v
  } catch { /* ignore */ }
  return 'full'
}
export function writePresentation(v: PresentationSetting): void {
  try { localStorage.setItem(LS_PRESENTATION, v) } catch { /* ignore */ }
}

/* ─────────────────────────── file access ─────────────────────────── */

interface BoothBridge {
  manifest(pair: string): Promise<unknown>
  stem(pair: string, file: string): Promise<Uint8Array | null>
  nameBanks(pair: string): Promise<Array<{ source: string; entries: Record<string, string> }>>
  nameClip(pair: string, source: string, file: string): Promise<Uint8Array | null>
  pronunciations(): Promise<unknown>
}

function bridge(): BoothBridge | null {
  const h = (window as unknown as { hockey?: { booth?: BoothBridge } }).hockey
  return h?.booth ?? null
}

/** Public-folder base for the browser fallback: the app root in dev (so a
 *  harness page under /dev/ still finds it), relative in a built bundle. */
const BASE = `${import.meta.env.BASE_URL ?? './'}commentary/`

/** The Electron bridge when present (packaged file:// can't fetch), else plain
 *  fetch from the dev server's public folder (browser harness). */
async function readManifest(pair: string): Promise<ClipManifest | null> {
  const b = bridge()
  try {
    if (b) return ((await b.manifest(pair)) as ClipManifest | null) ?? null
    const res = await fetch(`${BASE}${pair}/manifest.json`)
    // A dev server answers unknown paths with index.html: only JSON counts.
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null
    return (await res.json()) as ClipManifest
  } catch { return null }
}

async function readStem(pair: string, file: string): Promise<ArrayBuffer | null> {
  const b = bridge()
  try {
    if (b) { const u = await b.stem(pair, file); return u ? toArrayBuffer(u) : null }
    const res = await fetch(`${BASE}${pair}/${file}`)
    return res.ok ? await res.arrayBuffer() : null
  } catch { return null }
}

async function readNameBanks(pair: string): Promise<Array<{ source: string; entries: Record<string, string> }>> {
  const b = bridge()
  try {
    if (b) return (await b.nameBanks(pair)) ?? []
    const res = await fetch(`${BASE}${pair}/names/index.json`)
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return []
    const idx = (await res.json()) as { entries?: Record<string, string> }
    return idx.entries ? [{ source: 'fictional', entries: idx.entries }] : []
  } catch { return [] }
}

async function readNameClip(pair: string, source: string, file: string): Promise<ArrayBuffer | null> {
  const b = bridge()
  try {
    if (b) { const u = await b.nameClip(pair, source, file); return u ? toArrayBuffer(u) : null }
    if (source !== 'fictional') return null
    const res = await fetch(`${BASE}${pair}/names/${file}`)
    return res.ok ? await res.arrayBuffer() : null
  } catch { return null }
}

/** Is this booth pair's audio installed? (Settings shows it next to the choice.) */
export async function boothPairInstalled(pair: BoothPair): Promise<boolean> {
  const m = await readManifest(pair)
  return !!m && Object.keys(m.clips).length > 0
}

/** Mods' pronunciations.json, merged (null when none). */
export async function readModPronunciations(): Promise<PronunciationFile | null> {
  try { return ((await bridge()?.pronunciations()) as PronunciationFile | null) ?? null } catch { return null }
}

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
}

/* ─────────────────────────── name lookup (pure) ─────────────────────────── */

export interface BoothPlayer extends NameInput {
  starter?: boolean
}

/** Name-bank key: the seat, the inflection and the exact text the engine said. */
export function bankKey(seat: Speaker, style: NameStyle, text: string): string {
  return `${seat}|${style}|${text}`
}

/**
 * Which bank entry a player's name clip comes from, or null. Tries the spoken
 * text the game resolves for him (pronunciation file, overrides, nationality
 * rules), then the nationality-free spelling (a generated player whose
 * nationality the bank didn't know). Pure: exported for tests.
 */
export function resolveBankEntry(
  banks: ReadonlyMap<string, { source: string; file: string }>,
  p: NameInput,
  form: NameForm,
  style: NameStyle,
  seat: Speaker,
  pron: PronunciationFile | null,
): { source: string; file: string; key: string } | null {
  const texts = new Set<string>()
  const a = spokenName(p, pron)
  texts.add(form === 'full' ? a.full : a.surname)
  if (p.nationality !== undefined) {
    const { nationality: _n, ...rest } = p
    const b = spokenName(rest, pron)
    texts.add(form === 'full' ? b.full : b.surname)
  }
  for (const t of texts) {
    const key = bankKey(seat, style, t)
    const hit = banks.get(key)
    if (hit) return { ...hit, key }
  }
  return null
}

/* ─────────────────────────── the booth ─────────────────────────── */

export type BoothStatus = 'loading' | 'ready' | 'unavailable'

export interface BoothLoadResult {
  status: BoothStatus
  /** The pair actually in use (may differ from the setting if it isn't installed). */
  pair: BoothPair | null
  clips: number
  missing: number
}

/** The name variants a line can ask for (form × inflection), per seat. */
const NAME_VARIANTS: ReadonlyArray<[Speaker, NameForm, NameStyle]> = [
  ['pbp', 'surname', 'excited'], ['pbp', 'surname', 'neutral'],
  ['pbp', 'full', 'excited'], ['pbp', 'full', 'neutral'],
  ['color', 'surname', 'neutral'], ['color', 'full', 'neutral'],
  ['pbp', 'surname', 'rising'],
]

/**
 * One per match screen. Implements the scheduler's sink + lookup over WebAudio.
 */
export class BoothAudio implements AudioSink, ClipLookup {
  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  private sources: AudioBufferSourceNode[] = []
  private readonly stems = new Map<string, AudioBuffer>()
  /** bank key -> decoded clip */
  private readonly nameBuffers = new Map<string, AudioBuffer>()
  /** `${playerId}|${seat}|${form}|${style}` -> bank key */
  private readonly resolved = new Map<string, string>()
  private banks = new Map<string, { source: string; file: string }>()
  private pendingLoads = 0
  private disposed = false
  private onDuck: ((on: boolean) => void) | null = null
  private pronunciations: PronunciationFile | null = null
  private volume = readCommentaryVolume()
  private pairInUse: BoothPair | null = null

  constructor(private readonly wantedPair: BoothPair = readBoothPair()) {}

  setDuckHandler(fn: (on: boolean) => void): void { this.onDuck = fn }
  setPronunciations(file: PronunciationFile | null): void { this.pronunciations = file }
  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v))
    if (this.out) this.out.gain.value = this.volume
  }
  get pair(): BoothPair | null { return this.pairInUse }

  private audio(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.out = this.ctx.createGain()
      this.out.gain.value = this.volume
      this.out.connect(this.ctx.destination)
    }
    return this.ctx
  }

  /** Call from a user gesture (Drop the puck) so the context can start. */
  resume(): void {
    const c = this.audio()
    if (c.state === 'suspended') void c.resume().catch(() => undefined)
  }

  /**
   * Load the stems of the chosen pair — or, if that pair isn't installed, the
   * first pair that is (the stems-missing guard). Then index the name banks
   * for that pair. Never loads a TTS model.
   */
  load(): Promise<BoothLoadResult> {
    this.loading ??= this.doLoad()
    return this.loading
  }
  private loading: Promise<BoothLoadResult> | null = null

  private async doLoad(): Promise<BoothLoadResult> {
    const order = [this.wantedPair, ...BOOTH_PAIRS.filter((p) => p !== this.wantedPair)]
    for (const pair of order) {
      const manifest = await readManifest(pair)
      if (!manifest || this.disposed) continue
      const expect = booth.pairs[pair].speakers
      if (manifest.voices.pbp !== expect.pbp.voiceId || manifest.voices.color !== expect.color.voiceId) {
        console.warn(`[booth] ${pair} stems were rendered with other voices than booth.config.json — re-render them (scripts/booth/render_stems.py)`)
      }
      const ctx = this.audio()
      let missing = 0
      await Promise.all(Object.entries(manifest.clips).map(async ([id, entry]) => {
        const bytes = await readStem(pair, entry.file)
        if (!bytes) { missing++; return }
        try {
          const buf = await ctx.decodeAudioData(bytes)
          if (!this.disposed) this.stems.set(id, buf)
        } catch { missing++ }
      }))
      if (this.stems.size === 0) continue
      this.pairInUse = pair
      const listing = await readNameBanks(pair)
      const merged = new Map<string, { source: string; file: string }>()
      // Mod banks first: a mod's own recording of a name wins over the pool bank.
      for (const bank of [...listing].sort((a, b) => (a.source === 'fictional' ? 1 : 0) - (b.source === 'fictional' ? 1 : 0))) {
        for (const [k, file] of Object.entries(bank.entries)) if (!merged.has(k)) merged.set(k, { source: bank.source, file })
      }
      this.banks = merged
      if (pair !== this.wantedPair) console.warn(`[booth] ${this.wantedPair} booth isn't installed; using ${pair}`)
      return { status: 'ready', pair, clips: this.stems.size, missing }
    }
    return { status: 'unavailable', pair: null, clips: 0, missing: 0 }
  }

  /** Number of name clips in the loaded banks. */
  get bankSize(): number { return this.banks.size }

  /**
   * Resolve + decode tonight's name clips (both dressed rosters) in the
   * background. Resolves immediately; a clip not decoded by the time its line
   * fires just means the bare line plays. Call after {@link load}.
   */
  prepareNames(players: BoothPlayer[]): void {
    const pair = this.pairInUse
    if (!pair) return
    const want = new Map<string, { source: string; file: string }>()
    for (const p of players) {
      for (const [seat, form, style] of NAME_VARIANTS) {
        const hit = resolveBankEntry(this.banks, p, form, style, seat, this.pronunciations)
        if (!hit) continue
        this.resolved.set(`${p.id}|${seat}|${form}|${style}`, hit.key)
        if (!this.nameBuffers.has(hit.key)) want.set(hit.key, hit)
      }
    }
    const jobs = [...want.entries()]
    this.pendingLoads += jobs.length
    const ctx = this.audio()
    // A few at a time: IPC + decode are cheap, but there's no reason to burst.
    let i = 0
    const next = async (): Promise<void> => {
      while (i < jobs.length && !this.disposed) {
        const [key, { source, file }] = jobs[i++]!
        try {
          const bytes = await readNameClip(pair, source, file)
          if (bytes && !this.disposed) this.nameBuffers.set(key, await ctx.decodeAudioData(bytes))
        } catch { /* a broken clip is just an unsaid name */ }
        this.pendingLoads--
      }
    }
    for (let k = 0; k < 4; k++) void next()
  }

  /** Tonight's name clips still loading. */
  get namesPending(): number { return Math.max(0, this.pendingLoads) }

  /**
   * Settings' "hear the booth": one stitched goal call with a name from the
   * bank (or the bare call when no bank is installed). Resolves false when no
   * commentary audio is installed at all.
   */
  async playSample(): Promise<boolean> {
    const r = await this.load()
    if (r.status !== 'ready' || !r.pair) return false
    const pick = [...this.banks.entries()].find(([k]) => k.startsWith('pbp|excited|'))
    let parts: ClipRef[] = []
    const stem = this.clip('stem.goal.2')
    if (pick && stem) {
      const [key, { source, file }] = pick
      const bytes = await readNameClip(r.pair, source, file)
      if (bytes) {
        try {
          this.nameBuffers.set(key, await this.audio().decodeAudioData(bytes))
          parts = [stem, { id: `name:${key}`, durationMs: 0 }]
        } catch { /* fall through to bare */ }
      }
    }
    if (!parts.length) {
      const bare = this.clip('bare.goal.2') ?? this.clip('stem.goal.color.1')
      if (!bare) return false
      parts = [bare]
    }
    this.resume()
    this.play(parts)
    return true
  }

  /* ── ClipLookup ── */

  clip(id: string): ClipRef | null {
    const b = this.stems.get(id)
    return b ? { id, durationMs: b.duration * 1000 } : null
  }

  name(playerId: string, form: NameForm, style: NameStyle, speaker: Speaker): ClipRef | null {
    // Exact variant, then the surname for a full-name slot (booths say the
    // surname all the time), then a neutral read for a rising one.
    const tries: Array<[NameForm, NameStyle]> = [[form, style]]
    if (form === 'full') tries.push(['surname', style])
    if (style === 'rising') tries.push([form, 'neutral'])
    for (const [f, s] of tries) {
      const key = this.resolved.get(`${playerId}|${speaker}|${f}|${s}`)
      const b = key ? this.nameBuffers.get(key) : undefined
      if (key && b) return { id: `name:${key}`, durationMs: b.duration * 1000 }
    }
    return null
  }

  /* ── AudioSink ── */

  play(parts: ClipRef[]): void {
    const ctx = this.audio()
    // One voice at a time, always: whatever is still sounding stops first.
    this.stop()
    let t = ctx.currentTime + 0.01
    for (const p of parts) {
      const buf = p.id.startsWith('name:') ? this.nameBuffers.get(p.id.slice(5)) : this.stems.get(p.id)
      if (!buf) continue
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(this.out!)
      src.start(t)
      t += buf.duration + STITCH_GAP_MS / 1000
      this.sources.push(src)
      src.onended = () => { this.sources = this.sources.filter((s) => s !== src) }
    }
  }

  stop(): void {
    for (const s of this.sources) { try { s.stop() } catch { /* already stopped */ } }
    this.sources = []
  }

  duck(on: boolean): void {
    this.onDuck?.(on)
  }

  dispose(): void {
    this.disposed = true
    this.stop()
    this.onDuck?.(false)
    void this.ctx?.close().catch(() => undefined)
    this.ctx = null
  }
}
