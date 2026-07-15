/**
 * voiceCast.ts — maps a speaking ROLE (and optional character name) to a specific
 * Kokoro voice, so the game casts distinct, consistent voices instead of one
 * global narrator: a British play-by-play man, a grounded colour analyst, a gruff
 * head coach, a calm physio, individual players/agents/GMs.
 *
 * Pure and dependency-free (no audio, no DOM) so it's unit-testable. The Kokoro
 * engine reads the resolved voice id off each SpeakLine; the system Web-Speech
 * engine ignores it (one system voice), which is fine — Kokoro is the HD path.
 *
 * Kokoro-82M v1.0 voice ids: am_/af_ = American male/female, bm_/bf_ = British.
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

/** The signature voice for each role (used when there's no character to vary by). */
const ROLE_VOICE: Record<VoiceRole, string> = {
  pbp: 'bm_george', //   British commentator — matches the existing default preference
  color: 'am_michael', //grounded American colour man
  coach: 'am_fenrir', // strong, gruff bench boss
  physio: 'af_nicole', //calm, measured medical voice
  agm: 'am_eric', //     sharp, businesslike
  scout: 'bm_lewis', //  British scout
  pundit: 'am_onyx', //  broadcast pundit
  gm: 'am_adam', //      rival GM
  player: 'am_liam', //  default player
  agent: 'am_echo', //   smooth-talking agent
  owner: 'bm_daniel', // posh, authoritative
}

/** Distinct male voices to spread individual characters across (players/GMs/agents),
 *  so two different people don't sound identical. */
const CHARACTER_POOL = [
  'am_adam', 'am_liam', 'am_michael', 'am_eric', 'am_fenrir',
  'am_onyx', 'am_puck', 'am_echo', 'bm_lewis', 'bm_daniel', 'bm_fable',
]

/** Roles whose speaker is an individual worth giving a stable, varied voice. */
const VARIED_ROLES = new Set<VoiceRole>(['player', 'agent', 'gm', 'pundit'])

/** Every Kokoro v1.0 voice id — for a Settings voice picker / preview. */
export const ALL_KOKORO_VOICES: readonly string[] = [
  'af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica', 'af_kore',
  'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky',
  'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael',
  'am_onyx', 'am_puck', 'am_santa',
  'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily',
  'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis',
]

/** FNV-1a — stable across runs so a given name always maps to the same voice. */
function hash(s: string): number {
  let h = 0x811c9dc5 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/* ── attribute-matched pools ──
 * Kokoro-82M only ships English in American + British accents, so we can match a
 * person's GENDER and a British-Isles-vs-North-American ACCENT split, and pick a
 * TIMBRE by age/build — but we cannot literally give e.g. a Swede a Swedish
 * accent. Within each pool, a stable name hash keeps a person's voice fixed. */
const AM_YOUNG = ['am_liam', 'am_puck', 'am_echo']
const AM_DEEP = ['am_fenrir', 'am_onyx', 'am_eric', 'am_santa']
const AM_MID = ['am_michael', 'am_adam']
const AF_POOL = ['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_nova', 'af_kore', 'af_river']
const BM_POOL = ['bm_george', 'bm_lewis', 'bm_daniel', 'bm_fable']
const BF_POOL = ['bf_emma', 'bf_alice', 'bf_isabella', 'bf_lily']

/** Traits used to fit a voice to the actual person behind the role. */
export interface VoiceTraits {
  gender?: 'M' | 'F'
  /** Nationality string (e.g. "Canada", "Sweden", "England"). */
  nationality?: string
  age?: number
  /** Deeper, grittier delivery (older vet / enforcer / defenceman). */
  gruff?: boolean
}

const BRITISH_ISLES = /\b(england|great britain|united kingdom|uk|britain|scotland|wales|ireland|northern ireland|irish|scottish|welsh|british|english)\b/i

function pick<T>(pool: T[], seed: string): T {
  return pool[hash(seed) % pool.length]!
}

/** Pick a voice that fits a specific person's gender/accent/age. */
function personVoice(traits: VoiceTraits, seed: string): string {
  const british = traits.nationality ? BRITISH_ISLES.test(traits.nationality) : false
  if (traits.gender === 'F') return pick(british ? BF_POOL : AF_POOL, seed)
  if (british) return pick(BM_POOL, seed)
  // American male — the NHL default — split by timbre.
  if (traits.gruff || (traits.age ?? 0) >= 33) return pick(AM_DEEP, seed)
  if ((traits.age ?? 99) <= 22) return pick(AM_YOUNG, seed)
  return pick([...AM_MID, ...AM_DEEP, ...AM_YOUNG], seed)
}

/** Broadcast narrator roles keep their signature voice regardless of person. */
const BROADCAST = new Set<VoiceRole>(['pbp', 'color'])

/**
 * Resolve the voice for a role. When `traits` are given (a real person behind the
 * role), the voice is matched to their gender/accent/age; otherwise it varies by
 * a stable name seed, or falls back to the role's signature voice. Deterministic.
 */
export function voiceFor(role: VoiceRole, seedName?: string, traits?: VoiceTraits): string {
  if (traits && !BROADCAST.has(role)) {
    return personVoice(traits, seedName ?? role)
  }
  if (seedName && VARIED_ROLES.has(role)) {
    return CHARACTER_POOL[hash(seedName) % CHARACTER_POOL.length]!
  }
  return ROLE_VOICE[role]
}
