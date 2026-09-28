/**
 * The animation catalogue: runtime metadata for every Blender-authored clip
 * (scripts/blender/clips.py) and the PURE selection rules that decide which
 * clip an event cue plays. No THREE here, so all of it is unit-tested.
 *
 * Layering (see animLayer.ts):
 *   mask  'upper' — spine/chest/neck/head, shoulders, arms, stick: plays over
 *                   the code-driven skating legs (shots, passes, stickhandling)
 *         'lower' — hips + legs only (locomotion variants)
 *         'full'  — everything but the root (hits, falls, celebrations, goalie saves)
 *   hands 'stick' — the clip drives the STICK; both hands are re-solved onto it
 *                   with the renderer's IK every frame (hands never leave the
 *                   stick however the layers blend)
 *         'clip'  — the clip's own arm rotations (hands off the stick: fist
 *                   pumps, arms up, falls)
 */

export type ClipMask = 'upper' | 'lower' | 'full'
export type ClipHands = 'stick' | 'clip'

export interface ClipMeta {
  mask: ClipMask
  hands: ClipHands
  /** Loops (locomotion, idles) — sampled by phase or wrapped time. */
  loop?: boolean
  /** Seconds into the clip where the impact / release happens. */
  contact?: number
  /** Blend-in / blend-out seconds. */
  fadeIn: number
  fadeOut: number
  /** Hold the last frame until something else takes over (e.g. lying on the ice). */
  hold?: number
  /** Chain into this clip when finished (hit_fall → getup). */
  next?: string
  /**
   * Which hands hold the stick while this clip plays (hands 'stick' clips):
   * the renderer locks them onto the shaft (athlete.ts lockGrips). Default both.
   */
  grip?: 'both' | 'R'
  goalie?: boolean
  /**
   * Slot only an OWNER import fills (scripts/blender/import_owner_assets.py);
   * the Blender build doesn't author it. `fallback` plays instead when missing.
   */
  ownerOnly?: boolean
  fallback?: string
}

const f = (frame: number) => frame / 30

export const CLIPS: Record<string, ClipMeta> = {
  // ── locomotion (phase-locked to the sim's speed; lower body) ──
  skate_stride: { mask: 'lower', hands: 'stick', loop: true, fadeIn: 0.2, fadeOut: 0.2 },
  skate_glide: { mask: 'lower', hands: 'stick', loop: true, fadeIn: 0.25, fadeOut: 0.25 },
  skate_crossover_L: { mask: 'lower', hands: 'stick', loop: true, fadeIn: 0.2, fadeOut: 0.25 },
  skate_crossover_R: { mask: 'lower', hands: 'stick', loop: true, fadeIn: 0.2, fadeOut: 0.25 },
  skate_back: { mask: 'lower', hands: 'stick', loop: true, fadeIn: 0.25, fadeOut: 0.25 },
  // (owner imports fill these with one-handed skating clips: only the top hand is locked)
  hockey_stop: { mask: 'full', hands: 'stick', grip: 'R', fadeIn: 0.2, fadeOut: 0.25 },
  stickhandle: { mask: 'upper', hands: 'stick', loop: true, fadeIn: 0.2, fadeOut: 0.2 },
  // ── puck skills ──
  // shots: two variants per release type (shotClipFor); film study item 12
  shot_wrist: { mask: 'upper', hands: 'stick', contact: f(9), fadeIn: 0.12, fadeOut: 0.2 },
  shot_wrist_b: { mask: 'upper', hands: 'stick', contact: f(8), fadeIn: 0.12, fadeOut: 0.2 },
  shot_snap: { mask: 'upper', hands: 'stick', contact: f(5), fadeIn: 0.08, fadeOut: 0.18 },
  shot_snap_b: { mask: 'upper', hands: 'stick', contact: f(5), fadeIn: 0.08, fadeOut: 0.18 },
  shot_slap: { mask: 'full', hands: 'stick', contact: f(19), fadeIn: 0.1, fadeOut: 0.22 },
  shot_slap_b: { mask: 'full', hands: 'stick', contact: f(20), fadeIn: 0.1, fadeOut: 0.22 },
  shot_onetimer: { mask: 'upper', hands: 'stick', contact: f(7), fadeIn: 0.12, fadeOut: 0.2 },
  shot_onetimer_knee: { mask: 'full', hands: 'stick', contact: f(8), fadeIn: 0.12, fadeOut: 0.3 },
  shot_backhand: { mask: 'upper', hands: 'stick', contact: f(8), fadeIn: 0.1, fadeOut: 0.2 },
  shot_tip: { mask: 'upper', hands: 'stick', contact: f(4), fadeIn: 0.08, fadeOut: 0.18 },
  pass: { mask: 'upper', hands: 'stick', contact: f(6), fadeIn: 0.15, fadeOut: 0.18 },
  // one-handed lunge with the stick at full reach (film P2)
  poke: { mask: 'full', hands: 'stick', grip: 'R', contact: f(6), fadeIn: 0.08, fadeOut: 0.25 },
  // dekes — `contact` = the moment the blade crosses the man (the move "beats" him there)
  deke_fb: { mask: 'upper', hands: 'stick', contact: f(9), fadeIn: 0.1, fadeOut: 0.2 },
  deke_toedrag: { mask: 'upper', hands: 'stick', contact: f(10), fadeIn: 0.1, fadeOut: 0.2 },
  deke_fake: { mask: 'upper', hands: 'stick', contact: f(10), fadeIn: 0.1, fadeOut: 0.2 },
  deke_wide: { mask: 'upper', hands: 'stick', contact: f(5), fadeIn: 0.12, fadeOut: 0.2 },
  faceoff_crouch: { mask: 'full', hands: 'stick', loop: true, fadeIn: 0.3, fadeOut: 0.15 },
  faceoff_draw: { mask: 'full', hands: 'stick', contact: f(4), fadeIn: 0.1, fadeOut: 0.2 },
  faceoff_tieup: { mask: 'full', hands: 'stick', contact: f(4), fadeIn: 0.1, fadeOut: 0.2 },
  faceoff_wing: { mask: 'full', hands: 'stick', loop: true, fadeIn: 0.35, fadeOut: 0.2 },
  // ── hitting ──
  check: { mask: 'full', hands: 'stick', contact: f(8), fadeIn: 0.1, fadeOut: 0.2 },
  check_boards: { mask: 'full', hands: 'clip', contact: f(8), fadeIn: 0.1, fadeOut: 0.3 },
  hit_stagger: { mask: 'upper', hands: 'stick', contact: 0, fadeIn: 0.04, fadeOut: 0.2 },
  hit_stumble: { mask: 'full', hands: 'clip', contact: 0, fadeIn: 0.05, fadeOut: 0.3 },
  hit_fall: { mask: 'full', hands: 'clip', contact: 0, fadeIn: 0.05, fadeOut: 0.1, hold: 0.8, next: 'getup' },
  getup: { mask: 'full', hands: 'clip', fadeIn: 0.1, fadeOut: 0.4 },
  pinned_boards: { mask: 'full', hands: 'clip', contact: 0, fadeIn: 0.05, fadeOut: 0.3 },
  // ── celebrations & broadcast moments ──
  celly_fistpump: { mask: 'upper', hands: 'clip', fadeIn: 0.15, fadeOut: 0.3 },
  celly_armsup: { mask: 'full', hands: 'clip', fadeIn: 0.15, fadeOut: 0.35 },
  celly_hug: { mask: 'full', hands: 'clip', fadeIn: 0.25, fadeOut: 0.35 },
  rookie_lap: { mask: 'full', hands: 'clip', loop: true, fadeIn: 0.3, fadeOut: 0.3 },
  salute: { mask: 'upper', hands: 'clip', fadeIn: 0.3, fadeOut: 0.4 },
  bench_standup: { mask: 'full', hands: 'clip', fadeIn: 0.05, fadeOut: 0.3 },
  // ── goalie ──
  g_stance: { mask: 'full', hands: 'clip', loop: true, fadeIn: 0.3, fadeOut: 0.3, goalie: true },
  g_butterfly: { mask: 'full', hands: 'clip', contact: f(4), fadeIn: 0.05, fadeOut: 0.25, goalie: true },
  g_glove_save: { mask: 'full', hands: 'clip', contact: f(4), fadeIn: 0.05, fadeOut: 0.25, goalie: true },
  g_blocker_save: { mask: 'full', hands: 'clip', contact: f(4), fadeIn: 0.05, fadeOut: 0.25, goalie: true },
  g_pad_save: { mask: 'full', hands: 'clip', contact: f(4), fadeIn: 0.05, fadeOut: 0.3, goalie: true },
  g_scramble: { mask: 'full', hands: 'clip', contact: f(8), fadeIn: 0.08, fadeOut: 0.3, goalie: true },
  g_dejected: { mask: 'full', hands: 'clip', fadeIn: 0.4, fadeOut: 0.5, hold: 1.5, goalie: true },

  // owner-import slots (the Blender fallback covers them otherwise)
  skate_idle: { mask: 'lower', hands: 'stick', loop: true, fadeIn: 0.3, fadeOut: 0.3, ownerOnly: true, fallback: 'skate_glide' },
  skate_start: { mask: 'full', hands: 'stick', grip: 'R', fadeIn: 0.2, fadeOut: 0.3, ownerOnly: true },
  g_pad_save_L: { mask: 'full', hands: 'clip', contact: f(4), fadeIn: 0.05, fadeOut: 0.3, goalie: true, ownerOnly: true, fallback: 'g_pad_save' },
  g_pad_save_R: { mask: 'full', hands: 'clip', contact: f(4), fadeIn: 0.05, fadeOut: 0.3, goalie: true, ownerOnly: true, fallback: 'g_pad_save' },
  g_skate_fwd: { mask: 'lower', hands: 'clip', loop: true, fadeIn: 0.3, fadeOut: 0.3, goalie: true, ownerOnly: true },
  g_skate_back: { mask: 'lower', hands: 'clip', loop: true, fadeIn: 0.3, fadeOut: 0.3, goalie: true, ownerOnly: true },
  g_shuffle_L: { mask: 'lower', hands: 'clip', loop: true, fadeIn: 0.25, fadeOut: 0.25, goalie: true, ownerOnly: true },
  g_shuffle_R: { mask: 'lower', hands: 'clip', loop: true, fadeIn: 0.25, fadeOut: 0.25, goalie: true, ownerOnly: true },
}

/** Clips the Blender build authors (owner-only slots excluded). */
export const SKATER_CLIPS = Object.keys(CLIPS).filter((k) => !CLIPS[k]!.goalie && !CLIPS[k]!.ownerOnly)
export const GOALIE_CLIPS = Object.keys(CLIPS).filter((k) => CLIPS[k]!.goalie && !CLIPS[k]!.ownerOnly)

// ── masks ───────────────────────────────────────────────────────────────────

const UPPER = new Set([
  'spine', 'chest', 'neck', 'head',
  'shoulder_L', 'upperarm_L', 'forearm_L', 'hand_L',
  'shoulder_R', 'upperarm_R', 'forearm_R', 'hand_R',
  'stick', 'stick_blade',
])
const LOWER = new Set(['hips', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R'])
const ARMS = new Set(['shoulder_L', 'upperarm_L', 'forearm_L', 'hand_L', 'shoulder_R', 'upperarm_R', 'forearm_R', 'hand_R'])

/** How much of a clip with this mask reaches `bone` (0..1). */
export function maskWeight(mask: ClipMask, bone: string): number {
  if (bone === 'root') return 0
  if (mask === 'full') return 1
  if (mask === 'upper') return UPPER.has(bone) ? 1 : 0
  return LOWER.has(bone) ? 1 : 0
}

export const isArmBone = (bone: string) => ARMS.has(bone)

/** Blend weight of a one-shot clip at time t (fade in, hold, fade out). */
export function envelope(t: number, duration: number, fadeIn: number, fadeOut: number, hold = 0): number {
  if (t < 0) return 0
  const end = duration + hold
  if (t >= end) return 0
  const a = fadeIn > 0 ? Math.min(1, t / fadeIn) : 1
  const b = fadeOut > 0 ? Math.min(1, (end - t) / fadeOut) : 1
  const w = Math.min(a, b)
  return w * w * (3 - 2 * w)
}

// ── selection rules (event cue → clip) ──────────────────────────────────────

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** Stable 0..1 hash of an id (variety without randomness — replays look identical). */
export function hash01(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10007) / 10007
}

export type ShotClip =
  | 'shot_wrist' | 'shot_wrist_b' | 'shot_snap' | 'shot_snap_b' | 'shot_slap' | 'shot_slap_b'
  | 'shot_onetimer' | 'shot_onetimer_knee' | 'shot_backhand' | 'shot_tip'

/** The clip variants for each release type the agent engine names (shot.shotType). */
export const SHOT_VARIANTS: Readonly<Record<string, readonly ShotClip[]>> = {
  wrist: ['shot_wrist', 'shot_wrist_b'],
  snap: ['shot_snap', 'shot_snap_b'],
  slap: ['shot_slap', 'shot_slap_b'],
  oneTimer: ['shot_onetimer', 'shot_onetimer_knee'],
  backhand: ['shot_backhand'],
  tip: ['shot_tip'],
}

/**
 * The shot clip. The agent engine names the release type (`shotType`); the
 * classic engine doesn't, so it is inferred: a pass that arrives within
 * `oneTimerWindow` seconds before the shot is a one-timer, from the point
 * (>= 45 ft out) a slapshot, a quick release in close a snap, else a wrist shot.
 * `key` (player + shot) picks a variant deterministically — replays look the same.
 */
export function shotClipFor(distToNetFt: number, sincePassS: number | null, oneTimerWindow = 0.8, shotType?: string, key = ''): ShotClip {
  let type = shotType && SHOT_VARIANTS[shotType] ? shotType : undefined
  if (!type) {
    if (shotType === 'deflection') type = 'tip'
    else if (sincePassS !== null && sincePassS >= 0 && sincePassS <= oneTimerWindow) type = 'oneTimer'
    else if (distToNetFt >= 45) type = 'slap'
    else if (key && distToNetFt < 25 && hash01(key + '#snap') < 0.4) type = 'snap'
    else type = 'wrist'
  }
  const v = SHOT_VARIANTS[type]!
  // the second variant is the rarer one (a one-knee one-timer, a point slapper's big wind-up)
  return v.length > 1 && key && hash01(key + '#v') < 0.35 ? v[1]! : v[0]!
}

/**
 * Save type from where the shot arrives relative to the goalie: `lateral` is
 * the puck's offset to the goalie's LEFT (catching-glove side) in feet. High vs
 * low isn't in the stream, so it comes from the shooter's distance (point shots
 * come in higher) and a stable hash for variety.
 */
export function saveClipFor(lateralFt: number, shotDistFt: number, id: string, rebound: boolean): string {
  const h = hash01(id)
  if (rebound && Math.abs(lateralFt) > 2.5 && h < 0.5) return 'g_scramble'
  const high = h + smooth(20, 55, shotDistFt) * 0.4 > 0.72
  if (Math.abs(lateralFt) < 0.8) return high ? 'g_glove_save' : 'g_butterfly'
  if (high) return lateralFt > 0 ? 'g_glove_save' : 'g_blocker_save'
  return 'g_pad_save'
}

/** Distance (ft) from a world point to the boards of the 200×85 rink with 28 ft corners (negative = outside). */
export function distToBoards(wx: number, wz: number): number {
  const r = 28
  const qx = Math.abs(wx) - (100 - r)
  const qz = Math.abs(wz) - (42.5 - r)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0))
  const inside = Math.min(Math.max(qx, qz), 0)
  return -(outside + inside - r)
}

export const BOARDS_PIN_FT = 6

export interface HitPlan {
  hitter: string
  target: string
  /** 0..1 — how hard the contact is. */
  hardness: number
  pinned: boolean
}

/**
 * A hit from the relative speed at contact (ft/s) and where it happens.
 * Near the boards the hitter PINS (check_boards / pinned_boards); in open ice
 * the target staggers (light), stumbles (medium) or goes down and gets up (hard).
 */
export function hitPlan(relSpeedFtS: number, boardsDistFt: number, force?: number, kind?: 'boards' | 'openIce' | 'finish' | 'battle'): HitPlan {
  const hardness = force !== undefined ? Math.min(1, Math.max(0, force)) : Math.min(1, Math.max(0, (relSpeedFtS - 4) / 22))
  // a battle is two bodies leaning on each other: a shove, never a knockdown
  if (kind === 'battle') return { hitter: 'check', target: 'hit_stagger', hardness: Math.min(hardness, 0.4), pinned: false }
  const onBoards = kind ? kind === 'boards' : boardsDistFt <= BOARDS_PIN_FT
  if (onBoards) return { hitter: 'check_boards', target: 'pinned_boards', hardness, pinned: true }
  const target = hardness < 0.35 ? 'hit_stagger' : hardness < 0.7 ? 'hit_stumble' : 'hit_fall'
  return { hitter: 'check', target, hardness, pinned: false }
}

/** The scorer's celebration (stable per player: a guy has "his" celebration). */
export function celebrationFor(playerId: string): 'celly_fistpump' | 'celly_armsup' {
  return hash01(playerId + '#celly') < 0.55 ? 'celly_fistpump' : 'celly_armsup'
}

export interface LocoState {
  /** -1..1 sideways share of the velocity relative to facing (+ = toward the player's left). */
  lateral?: number
  /** 0..1 normalised speed. */
  speed: number
  /** Heading change rate (rad/s, + = turning left). */
  turnRate: number
  /** 0..1 how much the skater is backing up (facing away from his velocity). */
  backward: number
  /** Deceleration (ft/s², >= 0) — above ~2 the skater coasts into a glide. */
  decel: number
}

/**
 * Lower-body locomotion weights for the Blender clips (sum = 1). Continuous in
 * every input so nothing pops at a threshold.
 */
export function locomotionWeights(s: LocoState): Record<'skate_stride' | 'skate_glide' | 'skate_crossover_L' | 'skate_crossover_R' | 'skate_back', number> {
  const moving = smooth(0.08, 0.35, s.speed)
  const back = s.backward * smooth(0.05, 0.2, s.speed)
  const lat = s.lateral ?? 0
  const turnMag = Math.max(smooth(0.9, 1.8, Math.abs(s.turnRate)), smooth(0.35, 0.75, Math.abs(lat)))
  const turnLeft = Math.abs(lat) > smooth(0.9, 1.8, Math.abs(s.turnRate)) ? lat > 0 : s.turnRate > 0
  const turn = turnMag * smooth(0.2, 0.45, s.speed) * (1 - back)
  const fwd = 1 - back - turn
  // coasting (slowing down, not pushing): the skates glide instead of striding (film S6)
  const coast = smooth(2, 6, s.decel)
  const stride = fwd * moving * (1 - coast)
  const glide = fwd * (1 - moving * (1 - coast))
  return {
    skate_stride: stride,
    skate_glide: glide,
    skate_crossover_L: turnLeft ? turn : 0,
    skate_crossover_R: turnLeft ? 0 : turn,
    skate_back: back,
  }
}

/** A hard stop: decelerating fast from speed. */
export function wantsHockeyStop(speedFtS: number, decelFtS2: number): boolean {
  return speedFtS > 16 && decelFtS2 > 30
}

/**
 * Goalie locomotion weights for owner imports (sum = 1): the stance loop at
 * rest, forward / backward skating or a lateral shuffle by the direction of
 * the velocity relative to his facing. `fwd`/`lat` are -1..1 shares.
 */
export function goalieLocoWeights(speedFtS: number, fwd: number, lat: number): Record<'g_stance' | 'g_skate_fwd' | 'g_skate_back' | 'g_shuffle_L' | 'g_shuffle_R', number> {
  const moving = smooth(1.5, 5, speedFtS)
  const f = Math.max(0, fwd)
  const b = Math.max(0, -fwd)
  const l = Math.max(0, lat)
  const r = Math.max(0, -lat)
  const tot = f + b + l + r || 1
  return {
    g_stance: 1 - moving,
    g_skate_fwd: (moving * f) / tot,
    g_skate_back: (moving * b) / tot,
    g_shuffle_L: (moving * l) / tot,
    g_shuffle_R: (moving * r) / tot,
  }
}
