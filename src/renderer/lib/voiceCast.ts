/**
 * voiceCast.ts — maps a speaking ROLE (and optional character traits) to a specific
 * Kokoro voice + delivery rate, so the game casts distinct, consistent voices
 * instead of one global narrator: a British play-by-play man, a gruff head coach,
 * a calm physio, individual players/agents/GMs.
 *
 * Pure and dependency-free (no audio, no DOM) so it's unit-testable. The Kokoro
 * engine reads the resolved voice id + rate off each SpeakLine; the system
 * Web-Speech engine ignores them (one system voice), which is fine — Kokoro is
 * the HD path.
 *
 * QUALITY GATE — kokoro-js publishes a per-voice quality grade (A best … F worst)
 * from the Kokoro-82M model card. The playtest verdict on our old cast ("voices
 * are extremely off-putting") traced straight to D/F-grade voices in starring
 * roles (the rival GM was am_adam, graded F+). The cast below uses ONLY voices
 * graded C- or better; the D/F voices (am_adam, am_echo, am_eric, am_liam,
 * am_onyx, am_santa, bm_daniel, bm_lewis, af_jessica, af_river, bf_alice,
 * bf_lily) are never cast. That leaves few male voices, so individual
 * distinctness also comes from a per-character delivery RATE (seeded, stable).
 *
 * ── CASTING TABLE (who gets what, and why) ─────────────────────────────────
 *  Role     Voice        Grade  Why
 *  pbp      bm_george    C      British booth commentator — the signature call
 *  color    am_michael   C+     grounded American analyst next to him
 *  coach    am_fenrir    C+     deep, gruff bench boss
 *  physio   af_nicole    B-     calm, measured medical voice
 *  agm      am_michael   C+     sharp and businesslike (faster read than color)
 *  scout    bm_fable     C      well-travelled storyteller
 *  pundit   am_puck      C+     quick, energetic media voice
 *  gm       am_fenrir    C+     authoritative rival exec (varies per person)
 *  player   am_puck      C+     default player (varies per person, see below)
 *  agent    bm_fable     C      smooth operator (varies per person)
 *  owner    bm_george    C      oldest, most authoritative read (slow rate;
 *                               never shares a scene with the booth)
 *
 *  Individuals (players / staff with traits) are cast deterministically from:
 *   gender       — af_/bf_ female pools, am_/bm_ male pools
 *   nationality  — British Isles → bm_/bf_ voices (Kokoro only ships US+GB
 *                  English, so a Swede sounds North American, not Swedish)
 *   age          — 33+ or gruff → deep timbre (am_fenrir); ≤22 → bright
 *                  (am_puck); vets also read slower, kids faster
 *   position     — defencemen 28+ count as gruff (the old-school blueliner)
 *   demeanor     — fiery → am_fenrir/af_bella fast; calm → am_michael/af_nicole;
 *                  analytical → am_michael/af_sarah slow; motivator →
 *                  am_puck/af_heart; pragmatic → am_michael/af_kore
 *   name seed    — picks within the pool + jitters the rate ±3%, so two calm
 *                  coaches still don't sound like clones
 *  Same seed inputs ⇒ same voice + rate, forever.
 * ───────────────────────────────────────────────────────────────────────────
 */

export type VoiceRole =
  | 'pbp' //     play-by-play commentator
  | 'color' //   colour analyst
  | 'coach' //   head coach
  | 'physio' //  medical
  | 'agm' //     assistant GM
  | 'scout' //   scout
  | 'pundit' //  media pundit
  | 'gm' //      rival GM
  | 'player' //  a player
  | 'agent' //   a contract agent
  | 'owner' //   club owner

/** A resolved casting: which Kokoro voice speaks, and how fast. */
export interface VoiceCasting {
  voice: string
  /** Delivery rate multiplier (Kokoro `speed`), ~0.9 slow …1.2 quick. */
  rate: number
}

/** The signature voice for each role (used when there's no character to vary by). */
const ROLE_VOICE: Record<VoiceRole, string> = {
  pbp: 'bm_george',
  color: 'am_michael',
  coach: 'am_fenrir',
  physio: 'af_nicole',
  agm: 'am_michael',
  scout: 'bm_fable',
  pundit: 'am_puck',
  gm: 'am_fenrir',
  player: 'am_puck',
  agent: 'bm_fable',
  owner: 'bm_george',
}

/** Baseline delivery rate per role — the booth is quick, the owner takes his time. */
const ROLE_RATE: Record<VoiceRole, number> = {
  pbp: 1.12,
  color: 1.04,
  coach: 1.0,
  physio: 0.97,
  agm: 1.08,
  scout: 1.0,
  pundit: 1.12,
  gm: 1.02,
  player: 1.05,
  agent: 1.06,
  owner: 0.94,
}

/** Quality-gated voices to spread individual characters across (players/GMs/
 *  agents), so two different people don't sound identical. */
const CHARACTER_POOL = ['am_fenrir', 'am_michael', 'am_puck', 'bm_george', 'bm_fable']

/** Roles whose speaker is an individual worth giving a stable, varied voice. */
const VARIED_ROLES = new Set<VoiceRole>(['player', 'agent', 'gm', 'pundit'])

/** Every Kokoro v1.0 voice id (incl. the low-grade ones we never cast) — kept
 *  for validation and a possible Settings voice picker. */
export const ALL_KOKORO_VOICES: readonly string[] = [
  'af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica', 'af_kore',
  'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky',
  'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael',
  'am_onyx', 'am_puck', 'am_santa',
  'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily',
  'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis',
]

/* ── attribute-matched pools (quality-gated, grade C- or better) ── */
const M_DEEP = ['am_fenrir', 'am_michael']
const M_YOUNG = ['am_puck', 'am_michael']
const M_MID = ['am_michael', 'am_puck', 'am_fenrir']
const AF_POOL = ['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_aoede', 'af_kore', 'af_nova']
const BM_POOL = ['bm_george', 'bm_fable']
const BF_POOL = ['bf_emma', 'bf_isabella']

/** The distinct voices the game can actually cast — prefetch/warm exactly these. */
export const CAST_VOICES: readonly string[] = [...new Set([
  ...Object.values(ROLE_VOICE), ...CHARACTER_POOL,
  ...M_DEEP, ...M_YOUNG, ...M_MID, ...AF_POOL, ...BM_POOL, ...BF_POOL,
])]

export type Demeanor = 'fiery' | 'calm' | 'analytical' | 'motivator' | 'pragmatic'

/** Traits used to fit a voice to the actual person behind the role. */
export interface VoiceTraits {
  gender?: 'M' | 'F'
  /** Nationality string (e.g. "Canada", "Sweden", "England"). */
  nationality?: string
  age?: number
  /** Deeper, grittier delivery (older vet / enforcer / defenceman). */
  gruff?: boolean
  /** Playing position — an older defenceman reads as gruff. */
  position?: string
  /** Personality hint (StaffMember.demeanor / player personality). */
  demeanor?: Demeanor
}

const BRITISH_ISLES = /\b(england|great britain|united kingdom|uk|britain|scotland|wales|ireland|northern ireland|irish|scottish|welsh|british|english)\b/i

/** Demeanor-preferred pools + rate shifts — a fiery coach barks, an analyst measures. */
const DEMEANOR_MALE: Record<Demeanor, string[]> = {
  fiery: ['am_fenrir'],
  calm: ['am_michael', 'am_fenrir'],
  analytical: ['am_michael'],
  motivator: ['am_puck', 'am_fenrir'],
  pragmatic: ['am_michael', 'am_fenrir'],
}
const DEMEANOR_FEMALE: Record<Demeanor, string[]> = {
  fiery: ['af_bella'],
  calm: ['af_nicole'],
  analytical: ['af_sarah'],
  motivator: ['af_heart'],
  pragmatic: ['af_kore'],
}
const DEMEANOR_RATE: Record<Demeanor, number> = {
  fiery: 0.06,
  calm: -0.03,
  analytical: -0.04,
  motivator: 0.04,
  pragmatic: -0.01,
}

/** FNV-1a — stable across runs so a given name always maps to the same voice. */
function hash(s: string): number {
  let h = 0x811c9dc5 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function pick<T>(pool: T[], seed: string): T {
  return pool[hash(seed) % pool.length]!
}

function isGruff(traits: VoiceTraits): boolean {
  if (traits.gruff) return true
  const age = traits.age ?? 0
  if (age >= 33) return true
  return traits.position === 'D' && age >= 28
}

/** Pick a voice that fits a specific person's gender/accent/age/personality. */
function personVoice(traits: VoiceTraits, seed: string): string {
  const british = traits.nationality ? BRITISH_ISLES.test(traits.nationality) : false
  if (traits.gender === 'F') {
    if (traits.demeanor && !british) return pick(DEMEANOR_FEMALE[traits.demeanor], seed)
    return pick(british ? BF_POOL : AF_POOL, seed)
  }
  if (british) return pick(BM_POOL, seed)
  // North-American male — the NHL default — timbre by personality, then age.
  if (traits.demeanor) return pick(DEMEANOR_MALE[traits.demeanor], seed)
  if (isGruff(traits)) return pick(M_DEEP, seed)
  if ((traits.age ?? 99) <= 22) return pick(M_YOUNG, seed)
  return pick(M_MID, seed)
}

/** Broadcast narrator roles keep their signature voice regardless of person. */
const BROADCAST = new Set<VoiceRole>(['pbp', 'color'])

/**
 * Resolve the full casting (voice + delivery rate) for a role. When `traits`
 * are given (a real person behind the role), the voice is matched to their
 * gender/accent/age/personality; otherwise it varies by a stable name seed, or
 * falls back to the role's signature voice. Deterministic: same inputs ⇒ same
 * casting, forever.
 */
export function castFor(role: VoiceRole, seedName?: string, traits?: VoiceTraits): VoiceCasting {
  let voice: string
  if (traits && !BROADCAST.has(role)) {
    voice = personVoice(traits, seedName ?? role)
  } else if (seedName && VARIED_ROLES.has(role)) {
    voice = CHARACTER_POOL[hash(seedName) % CHARACTER_POOL.length]!
  } else {
    voice = ROLE_VOICE[role]
  }

  let rate = ROLE_RATE[role]
  if (traits && !BROADCAST.has(role)) {
    if (traits.demeanor) rate += DEMEANOR_RATE[traits.demeanor]
    const age = traits.age ?? 0
    if (age >= 35) rate -= 0.03
    else if (age > 0 && age <= 21) rate += 0.03
  }
  // Seeded jitter so same-voice individuals still read differently. Broadcast
  // roles stay fixed — the booth must sound identical every night.
  if (seedName && !BROADCAST.has(role)) {
    rate += ((hash(`rate:${seedName}`) % 7) - 3) * 0.01
  }
  return { voice, rate: Math.min(1.2, Math.max(0.9, Math.round(rate * 100) / 100)) }
}

/** Resolve just the voice id (compat shim over castFor). */
export function voiceFor(role: VoiceRole, seedName?: string, traits?: VoiceTraits): string {
  return castFor(role, seedName, traits).voice
}
