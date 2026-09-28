/**
 * The choreographer: turns the event stream into authored clips on the right
 * players at the right moment. It reads only the frozen GameStream (the
 * renderer contract is unchanged) and works with ANY clip source through the
 * per-player ActionLayer.
 *
 * Timing: every clip has a contact frame (release, impact, save). Because the
 * whole stream is known up front, a clip is started `contact` seconds BEFORE
 * its event, so the stick meets the puck / the shoulder meets the man exactly
 * at the event time. That is how the hitter "leads into" a check.
 *
 * Hits: the hitter's clip is picked ahead of time (a boards pin if the hit is
 * within BOARDS_PIN_FT of the boards). The target's reaction is decided AT
 * contact from the relative speed of the two bodies: stagger / stumble /
 * fall + get-up, or pinned against the glass. During the reaction the target
 * faces the hitter (so he is knocked away from him) and his root follows the
 * sim on a slower spring, then catches up smoothly — no snapping.
 */

import type { GameStream } from '@domain'
import { isEvent } from '@domain'
import { absTime } from '@render2d/timeline'
import { normXtoWorld, normYtoWorld, wrapAngle } from './math'
import { NET_X } from './arena'
import type { ActionLayer } from './animLayer'
import { blendClip } from './animLayer'
import type { BakedClip } from './gltfAthlete'
import {
  CLIPS,
  celebrationFor,
  distToBoards,
  goalieLocoWeights,
  hitPlan,
  locomotionWeights,
  saveClipFor,
  shotClipFor,
  wantsHockeyStop,
} from './animCatalog'
import type { BoneName, PoseOverlay } from './athlete'
import type * as THREE from 'three'

export type ActionKind = 'shot' | 'save' | 'goal' | 'hit' | 'pass' | 'faceoff' | 'deke'

export interface ActionCue {
  kind: ActionKind
  absT: number
  nx: number
  ny: number
  actorId: string
  /** hit: the player hit · pass: the receiver */
  targetId?: string
  /** goal: the assisting players */
  assists?: string[]
  /** save: the shot that produced it */
  shotFrom?: { x: number; y: number }
  shotTarget?: { x: number; y: number }
  rebound?: boolean
  /** hit (agent engine): impact 0..1 and where it happened */
  force?: number
  hitKind?: 'boards' | 'openIce' | 'finish' | 'battle'
  /** shot (agent engine): the release type */
  shotType?: string
  /** deke (agent engine): which move */
  dekeKind?: string
}

/** The deke clip for each move the engine names (additive 'deke' event). */
export const DEKE_CLIP: Readonly<Record<string, string>> = {
  forehandBackhand: 'deke_fb',
  toeDrag: 'deke_toedrag',
  shoulderFake: 'deke_fake',
  wide: 'deke_wide',
}

/** Every cue the choreographer can act on (a superset of math.extractCues). */
export function extractActionCues(stream: GameStream): ActionCue[] {
  const out: ActionCue[] = []
  let lastShot: { x: number; y: number; tx: number; ty: number } | null = null
  for (const ev of stream) {
    if (isEvent(ev, 'shot')) {
      lastShot = { x: ev.from.x, y: ev.from.y, tx: ev.target.x, ty: ev.target.y }
      out.push({ kind: 'shot', absT: absTime(ev.period, ev.t), nx: ev.from.x, ny: ev.from.y, actorId: ev.shooter, ...(ev.shotType ? { shotType: ev.shotType } : {}) })
    } else if (isEvent(ev, 'save')) {
      out.push({
        kind: 'save', absT: absTime(ev.period, ev.t), nx: ev.pos.x, ny: ev.pos.y, actorId: ev.goalie, rebound: ev.rebound,
        ...(lastShot ? { shotFrom: { x: lastShot.x, y: lastShot.y }, shotTarget: { x: lastShot.tx, y: lastShot.ty } } : {}),
      })
    } else if (isEvent(ev, 'goal')) {
      out.push({ kind: 'goal', absT: absTime(ev.period, ev.t), nx: ev.pos.x, ny: ev.pos.y, actorId: ev.scorer, assists: [...ev.assists] })
    } else if (isEvent(ev, 'hit')) {
      out.push({ kind: 'hit', absT: absTime(ev.period, ev.t), nx: ev.pos.x, ny: ev.pos.y, actorId: ev.by, targetId: ev.on, ...(ev.force !== undefined ? { force: ev.force } : {}), ...(ev.kind ? { hitKind: ev.kind } : {}) })
    } else if (isEvent(ev, 'pass') && ev.completed) {
      out.push({ kind: 'pass', absT: absTime(ev.period, ev.t), nx: ev.a.x, ny: ev.a.y, actorId: ev.from, targetId: ev.to })
    } else if ((ev as { type: string }).type === 'deke') {
      // additive agent-engine event: { by, on?, kind, success, pos } (tolerant read)
      const d = ev as unknown as { period: number; t: number; by: string; on?: string; kind?: string; pos?: { x: number; y: number } }
      out.push({ kind: 'deke', absT: absTime(d.period, d.t), nx: d.pos?.x ?? 0, ny: d.pos?.y ?? 0, actorId: d.by, ...(d.on ? { targetId: d.on } : {}), dekeKind: d.kind ?? 'forehandBackhand' })
    } else if (isEvent(ev, 'faceoff')) {
      out.push({ kind: 'faceoff', absT: absTime(ev.period, ev.t), nx: ev.pos.x, ny: ev.pos.y, actorId: ev.winner })
    }
  }
  return out.sort((a, b) => a.absT - b.absT)
}

/** Seconds the faceoff crouch starts before the drop. */
export const FACEOFF_LEAD_S = 1.1

export interface PlannedCue {
  cue: ActionCue
  /** Clip decided at plan time (shots, passes, checks). */
  clip: string | null
  /** Seconds before absT the clip starts. */
  lead: number
}

/**
 * Plan every cue: which clip and how early it must start (pure; tested).
 * `contactOf` overrides a clip's catalogue contact time (owner imports carry
 * their own, detected at import).
 */
export function planCues(cues: ActionCue[], contactOf: (clip: string) => number | undefined = () => undefined): PlannedCue[] {
  const contact = (clip: string) => contactOf(clip) ?? CLIPS[clip]?.contact ?? 0
  const lastPassTo = new Map<string, number>()
  const out: PlannedCue[] = []
  for (const cue of cues) {
    let clip: string | null = null
    let lead = 0
    if (cue.kind === 'pass') {
      clip = 'pass'
      if (cue.targetId) lastPassTo.set(cue.targetId, cue.absT)
    } else if (cue.kind === 'shot') {
      const wx = normXtoWorld(cue.nx)
      const wz = normYtoWorld(cue.ny)
      const dist = Math.hypot(wx - Math.sign(wx || 1) * NET_X, wz)
      const pt = lastPassTo.get(cue.actorId)
      clip = shotClipFor(dist, pt === undefined ? null : cue.absT - pt, undefined, cue.shotType, `${cue.actorId}@${cue.absT.toFixed(2)}`)
    } else if (cue.kind === 'hit') {
      clip = hitPlan(12, distToBoards(normXtoWorld(cue.nx), normYtoWorld(cue.ny)), cue.force, cue.hitKind).hitter
    } else if (cue.kind === 'deke') {
      clip = DEKE_CLIP[cue.dekeKind ?? ''] ?? 'deke_fb'
    } else if (cue.kind === 'faceoff') {
      clip = 'faceoff_crouch'
      lead = FACEOFF_LEAD_S
    } else if (cue.kind === 'save') {
      lead = contact('g_glove_save')
    }
    if (clip && cue.kind !== 'faceoff') lead = contact(clip)
    out.push({ cue, clip, lead })
  }
  return out
}

// ── actors ──────────────────────────────────────────────────────────────────

export interface ChoreoActor {
  playerId: string | null
  team: 'home' | 'away'
  rig: { goalie: boolean; visible: boolean }
  worldX: { pos: number }
  worldZ: { pos: number }
  /** Smoothed velocity (ft/s). */
  vx: number
  vz: number
  angle: number
  speedSm: number
  turnSm: number
  stridePhase: number
  layer: ActionLayer | null
  /** Face this way until `until` (sim seconds on the choreographer clock). */
  faceOverride: { angle: number; until: number } | null
  /** Root follow half-life (s): slower while knocked down so the body slides, then catches up. */
  followHL: number
  /** Last smoothed speed (ft/s) — for hockey-stop detection. */
  lastSpeedFt: number
  stopCooldown: number
  stopAccum: number
  stopFrom: number
  /** Goalie butterfly blend 0..1 (the code pose) — owner goalie locomotion yields to it. */
  butterfly?: number
  /** Animation clock (s), advancing with the game clock. */
  animTime?: number
  /** Smoothed locomotion state (choreo-owned; see smoothLoco). */
  loco?: LocoSmooth
}

/**
 * Per-actor locomotion smoothing. Every clip switch the velocity direction
 * drives (stride ↔ crossover L/R ↔ back, stance ↔ shuffle) is a CROSSFADE:
 * the target weights are low-passed (LOCO_TAU) and the velocity feeding them
 * is smoothed first (the sim's positions arrive in steps, so the raw velocity
 * direction flickers). Clip phases are integrated, never recomputed from a
 * time × speed product (that jumped whenever the speed changed).
 */
export interface LocoSmooth {
  t: number
  /** Smoothed speed (ft/s) and deceleration (ft/s², >= 0) — coasting reads as a glide. */
  sp?: number
  decel?: number
  w: Record<string, number>
  vx: number
  vz: number
  phase: number
  still: number
}
export const LOCO_TAU = 0.2
const VEL_TAU = 0.25

function locoState(a: ChoreoActor): { st: LocoSmooth; dt: number } {
  const now = a.animTime ?? 0
  let st = a.loco
  if (!st) {
    st = { t: now, w: {}, vx: a.vx, vz: a.vz, phase: 0, still: 0 }
    a.loco = st
  }
  const dt = Math.min(0.1, Math.max(0, now - st.t))
  st.t = now
  const kv = dt > 0 ? 1 - Math.exp(-dt / VEL_TAU) : 0
  st.vx += (a.vx - st.vx) * kv
  st.vz += (a.vz - st.vz) * kv
  if (dt > 0) {
    const sp = Math.hypot(st.vx, st.vz)
    const d = st.sp === undefined ? 0 : Math.max(0, (st.sp - sp) / dt)
    st.decel = (st.decel ?? 0) + (d - (st.decel ?? 0)) * (1 - Math.exp(-dt / 0.3))
    st.sp = sp
  }
  return { st, dt }
}

/** Low-pass the target weights into the actor's current weights (sum stays 1). */
export function smoothWeights(cur: Record<string, number>, target: Record<string, number>, dt: number, tau = LOCO_TAU): Record<string, number> {
  const first = Object.keys(cur).length === 0
  const k = first ? 1 : 1 - Math.exp(-dt / tau)
  let tot = 0
  for (const n of new Set([...Object.keys(cur), ...Object.keys(target)])) {
    const v = (cur[n] ?? 0) + ((target[n] ?? 0) - (cur[n] ?? 0)) * k
    cur[n] = v < 1e-4 ? 0 : v
    tot += cur[n]!
  }
  if (tot > 0) for (const n in cur) cur[n] = cur[n]! / tot
  return cur
}

export type LocoMode = 'code' | 'clip' | 'hybrid'

const NO_GRIP = { L: 0, R: 0 }

interface Pending {
  at: number
  run: () => void
}

export class Choreographer {
  private plans: PlannedCue[] = []
  private pending: Pending[] = []
  private faceoffCrouchers: ChoreoActor[] = []
  /** Choreographer clock (sim seconds). */
  clock = 0
  /** Lateral offset (ft, + = goalie's left) of the last save planned. */
  private lastLateral = 0

  constructor(
    private readonly find: (id: string) => ChoreoActor | null,
    private readonly all: () => ChoreoActor[],
    private readonly goalieDefending: (side: 'left' | 'right') => ChoreoActor | null,
    readonly loco: LocoMode,
    private readonly locoClips: { skater: Map<string, BakedClip> | null; goalie?: Map<string, BakedClip> | null },
    private readonly baseFollowHL: number,
    /** Owner imports: the authored cycles drive the whole body (torso too), not just the legs. */
    private readonly ownerLoco = false
  ) {}

  setCues(cues: ActionCue[]): void {
    const sk = this.locoClips.skater
    const gk = this.locoClips.goalie
    this.plans = planCues(cues, (c) => (CLIPS[c]?.goalie ? gk : sk)?.get(c)?.contact)
    this.reset()
  }

  /** Seek / load: drop every running clip and override. */
  reset(): void {
    this.pending = []
    this.faceoffCrouchers = []
    for (const a of this.all()) {
      a.layer?.clear()
      a.faceOverride = null
      a.followHL = this.baseFollowHL
      a.stopCooldown = 0
    }
  }

  /**
   * Who is mid-swing at game time `t` — a shot or pass whose clip has started
   * (`lead` before the event) but whose stick hasn't met the puck yet. The
   * renderer keeps the puck on HIS blade until contact, so the wind-up visibly
   * carries the puck and the release lands on the swing (it used to leave first).
   */
  windupActor(t: number): string | null {
    const ps = this.plans
    let lo = 0
    let hi = ps.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (ps[mid]!.cue.absT < t) lo = mid + 1
      else hi = mid
    }
    for (let i = lo; i < ps.length; i++) {
      const p = ps[i]!
      if (p.cue.absT - 0.9 > t) break
      if ((p.cue.kind === 'shot' || p.cue.kind === 'pass') && p.clip && p.cue.absT - p.lead <= t) return p.cue.actorId
    }
    return null
  }

  /** Advance from game clock `prev` to `now` (seconds of game time). */
  tick(prev: number, now: number): void {
    if (now < prev) return
    this.clock = now
    for (const p of this.plans) {
      const start = p.cue.absT - p.lead
      if (p.lead > 0 && start > prev && start <= now) this.anticipate(p, now - start)
      if (p.cue.absT > prev && p.cue.absT <= now) this.contact(p)
    }
    if (this.pending.length) {
      const due = this.pending.filter((x) => x.at <= now)
      this.pending = this.pending.filter((x) => x.at > now)
      for (const d of due) d.run()
    }
  }

  private anticipate(p: PlannedCue, late: number): void {
    const c = p.cue
    if (c.kind === 'faceoff') {
      this.faceoffCrouchers = this.faceoffTakers(c)
      for (const a of this.faceoffCrouchers) a.layer?.play('faceoff_crouch')
      return
    }
    if (c.kind === 'save') {
      const g = this.find(c.actorId) ?? this.goalieDefending(c.nx < 0 ? 'left' : 'right')
      if (!g?.layer) return
      let clip = this.saveClip(g, c)
      if (clip === 'g_pad_save' && g.layer.has('g_pad_save_L')) clip = this.lastLateral > 0 ? 'g_pad_save_L' : 'g_pad_save_R'
      const ct = this.locoClips.goalie?.get(clip)?.contact ?? CLIPS[clip]?.contact ?? 0
      g.layer.play(clip, { at: Math.max(0, ct - p.lead + late) })
      return
    }
    const a = this.find(c.actorId)
    if (!a?.layer || !p.clip) return
    a.layer.play(p.clip, { at: late })
  }

  private contact(p: PlannedCue): void {
    const c = p.cue
    if (c.kind === 'faceoff') {
      const w = this.find(c.actorId)
      for (const a of this.faceoffCrouchers) {
        if (a === w) a.layer?.play('faceoff_draw', { at: CLIPS.faceoff_draw!.contact ?? 0 })
        else a.layer?.stop('faceoff_crouch')
      }
      this.faceoffCrouchers = []
      return
    }
    if (c.kind === 'hit') return this.resolveHit(c)
    if (c.kind === 'goal') return this.celebrate(c)
  }

  private resolveHit(c: ActionCue): void {
    const hitter = this.find(c.actorId)
    const target = c.targetId ? this.find(c.targetId) : null
    if (!target?.layer) return
    const rel = hitter ? Math.hypot(hitter.vx - target.vx, hitter.vz - target.vz) : 12
    const wx = normXtoWorld(c.nx)
    const wz = normYtoWorld(c.ny)
    // the engine's own impact + kind when it has them (agent engine), else read it from the closing speed
    const plan = hitPlan(rel, distToBoards(wx, wz), c.force, c.hitKind)
    target.layer.play(plan.target, { weight: plan.target === 'hit_stagger' ? 0.55 + 0.45 * plan.hardness : 1 })
    const meta = CLIPS[plan.target]!
    const len = (meta.hold ?? 0) + 1.2 + (meta.next ? 1.4 : 0)
    if (plan.pinned) {
      // chest to the glass: face the nearest boards (eased by the facing spring).
      // Open-ice reactions keep the sim's facing: overriding it made bodies swing
      // round and back — measurable yaw twitch (motion-probe gate).
      const face = Math.abs(wz) / 42.5 > Math.abs(wx) / 100 ? (wz > 0 ? 0 : Math.PI) : wx > 0 ? Math.PI / 2 : -Math.PI / 2
      target.faceOverride = { angle: wrapAngle(face), until: this.clock + len }
    }
    if (plan.target !== 'hit_stagger') {
      target.followHL = plan.target === 'hit_fall' ? 0.9 : 0.35
      this.pending.push({ at: this.clock + len, run: () => (target.followHL = this.baseFollowHL) })
    }
  }

  private celebrate(c: ActionCue): void {
    const scorer = this.find(c.actorId)
    if (scorer?.layer) {
      // the shot's follow-through ends here (its grip lock would hold the hands on the stick)
      for (const n of scorer.layer.playing) if (n.startsWith('shot_') || n === 'pass') scorer.layer.stop(n)
      // owner rigs play celebrations baked on their own skeleton (import_owner_assets.py)
      scorer.layer.play(celebrationFor(c.actorId))
    }
    if (scorer) {
      // linemates who are close join in for a hug a beat later
      for (const a of this.all()) {
        if (a === scorer || a.rig.goalie || !a.rig.visible || a.team !== scorer.team || !a.layer) continue
        const d = Math.hypot(a.worldX.pos - scorer.worldX.pos, a.worldZ.pos - scorer.worldZ.pos)
        if (d < 14) this.pending.push({ at: this.clock + 0.9 + d * 0.05, run: () => a.layer?.play('celly_hug') })
      }
    }
    const g = this.goalieDefending(c.nx < 0 ? 'left' : 'right')
    if (g?.layer) this.pending.push({ at: this.clock + 0.7, run: () => g.layer?.play('g_dejected') })
  }

  private saveClip(g: ChoreoActor, c: ActionCue): string {
    const tx = c.shotTarget ? normXtoWorld(c.shotTarget.x) : normXtoWorld(c.nx)
    const tz = c.shotTarget ? normYtoWorld(c.shotTarget.y) : normYtoWorld(c.ny)
    const dx = tx - g.worldX.pos
    const dz = tz - g.worldZ.pos
    // the goalie's left (catching glove) in world space
    const lateral = dx * Math.cos(g.angle) - dz * Math.sin(g.angle)
    const from = c.shotFrom ? Math.hypot(normXtoWorld(c.shotFrom.x) - g.worldX.pos, normYtoWorld(c.shotFrom.y) - g.worldZ.pos) : 25
    this.lastLateral = lateral
    return saveClipFor(lateral, from, `${c.actorId}@${c.absT.toFixed(2)}`, !!c.rebound)
  }

  private faceoffTakers(c: ActionCue): ChoreoActor[] {
    const fx = normXtoWorld(c.nx)
    const fz = normYtoWorld(c.ny)
    const pick = (team: 'home' | 'away') => {
      let best: ChoreoActor | null = null
      let bd = 16
      for (const a of this.all()) {
        if (a.team !== team || a.rig.goalie || !a.rig.visible || !a.layer) continue
        const d = Math.hypot(a.worldX.pos - fx, a.worldZ.pos - fz)
        if (d < bd) {
          bd = d
          best = a
        }
      }
      return best
    }
    return [pick('home'), pick('away')].filter((a): a is ChoreoActor => a !== null)
  }

  // ── per-frame locomotion + overlay ─────────────────────────────────────────

  /**
   * Hockey stops from the sim's own deceleration: the SMOOTHED speed must fall
   * hard for a sustained ~0.12 s from real skating speed (per-frame speed is
   * noisy — a raw threshold fired a stop every few frames).
   */
  locomotionEvents(actor: ChoreoActor, dt: number, playbackSpeed = 1): void {
    if (!actor.layer || actor.rig.goalie || dt <= 0) return
    actor.stopCooldown = Math.max(0, actor.stopCooldown - dt)
    // velocities are per wall-second; at 2×/4× playback bring them back to game speed
    const sp = Math.hypot(actor.vx, actor.vz) / Math.max(1, playbackSpeed)
    const decel = (actor.lastSpeedFt - sp) / dt
    const was = actor.lastSpeedFt
    actor.lastSpeedFt = sp
    void was
    // owner imports: a push-off clip when a skater gets going from a REAL
    // standstill (≥ 0.5 s below 2 ft/s on the smoothed speed — raw per-frame
    // speed spikes fired it every second or two)
    const ls = actor.loco
    if (ls) {
      const smooth = Math.hypot(ls.vx, ls.vz) / Math.max(1, playbackSpeed)
      if (smooth < 2) ls.still += dt
      else if (smooth > 6) {
        if (ls.still >= 0.5 && actor.stopCooldown === 0 && actor.layer.has('skate_start') && actor.layer.bodyBusy() === 0) {
          actor.layer.play('skate_start')
          actor.stopCooldown = 1.5
        }
        ls.still = 0
      }
    }
    if (decel > 30) {
      if (actor.stopAccum === 0) actor.stopFrom = sp + decel * dt
      actor.stopAccum += dt
    } else actor.stopAccum = 0
    if (actor.stopCooldown === 0 && actor.stopAccum >= 0.12 && wantsHockeyStop(actor.stopFrom, decel) && actor.layer.bodyBusy() === 0) {
      // a touch slower than authored: the Blender stop swings the hips ~19°/frame
      actor.layer.play('hockey_stop', { speed: 0.8 })
      actor.stopCooldown = 3
      actor.stopAccum = 0
    }
  }

  /** The PoseOverlay for one actor (built once; closes over the actor). */
  overlayFor(actor: ChoreoActor): PoseOverlay {
    const clips = this.locoClips.skater
    const gclips = this.locoClips.goalie
    const loco = this.loco
    const owner = this.ownerLoco
    // Owner imports: the authored skating / stance cycles carry their own arms
    // and stick handling (retargeted together from the source), so they drive
    // arms + stick too — the renderer's carry IK is only the fallback under
    // them. An action clip that re-grips the stick by IK (a Blender shot or
    // pass on an owner rig) takes the arms back in proportion to its weight.
    const skate = (B: Record<BoneName, THREE.Bone>, part: 'body' | 'stick' | 'arms', k = 1) => {
      if (clips && !actor.rig.goalie && loco !== 'code') blendLocomotion(B, clips, actor, loco, owner, part, k)
      if (gclips && actor.rig.goalie && gclips.has('g_stance')) blendGoalieLocomotion(B, gclips, actor, part, k)
    }
    return {
      body: (B) => {
        skate(B, 'body')
        actor.layer?.blendBody(B)
      },
      stick: (B) => {
        if (owner) skate(B, 'stick')
        actor.layer?.blendStick(B)
      },
      arms: (B) => {
        if (owner) skate(B, 'arms')
        actor.layer?.blendArms(B)
      },
      grip: () => actor.layer?.gripWeights() ?? NO_GRIP,
    }
  }
}

/**
 * Phase-locked locomotion from the authored cycles: the clip time is the
 * code's stride phase, so cadence stays locked to the sim's speed.
 *   'clip'   — every locomotion cycle (stride, glide, crossovers, backward)
 *   'hybrid' — the code keeps the forward stride/glide; the clips add
 *              crossovers and backward skating on top.
 */
export function blendLocomotion(
  B: Record<BoneName, THREE.Bone>,
  clips: Map<string, BakedClip>,
  a: ChoreoActor,
  mode: LocoMode,
  owner = false,
  part: 'body' | 'stick' | 'arms' = 'body',
  scale = 1
): void {
  if (scale <= 0.001) return
  const facing = a.angle
  const { st, dt } = locoState(a)
  const vAng = Math.atan2(st.vx, st.vz)
  const sp = Math.hypot(st.vx, st.vz)
  const back = sp > 1 ? Math.max(0, -Math.cos(wrapAngle(vAng - facing))) : 0
  // + = toward the player's left (his +X = (cos θ, −sin θ) in world X/Z)
  const lateral = owner && sp > 1 ? Math.sin(wrapAngle(vAng - facing)) : 0
  const w = locomotionWeights({ speed: a.speedSm, turnRate: a.turnSm, backward: back, decel: st.decel ?? 0, lateral }) as Record<string, number>
  if (owner && clips.has('skate_idle')) {
    // an owner rig idles in its own stance instead of the Blender glide
    w['skate_idle'] = w['skate_glide']!
    w['skate_glide'] = 0
  }
  smoothWeights(st.w, w, dt)
  const ws = st.w as typeof w
  const mask = owner ? 'full' : 'lower'
  const phase01 = a.stridePhase / (2 * Math.PI)
  // Sequential slerps as a normalised weighted average: each clip gets
  // w_i / (W + w_i) where W is the weight already in the blend. In 'hybrid'
  // the code's own stride/glide is the starting W; in 'clip' it is 0 (fully replaced).
  let W = mode === 'hybrid' ? (ws.skate_stride ?? 0) + (ws.skate_glide ?? 0) : 0
  for (const [name, weight] of Object.entries(ws) as Array<[string, number]>) {
    if (mode === 'hybrid' && (name === 'skate_stride' || name === 'skate_glide')) continue
    const clip = clips.get(name)
    if (!clip || weight <= 0.001) continue
    const f = weight / (W + weight)
    W += weight
    blendClip(B as unknown as Record<string, THREE.Bone>, clip, phase01 * clip.duration, true, f * scale, mask, part)
  }
}

/**
 * Owner goalies: stance loop / forward / backward / lateral shuffle by the
 * direction of travel relative to his facing; yields to the code butterfly.
 */
export function blendGoalieLocomotion(
  B: Record<BoneName, THREE.Bone>,
  clips: Map<string, BakedClip>,
  a: ChoreoActor,
  part: 'body' | 'stick' | 'arms' = 'body',
  scale = 1
): void {
  if (scale <= 0.001) return
  const { st, dt } = locoState(a)
  const sp = Math.hypot(st.vx, st.vz)
  const vAng = Math.atan2(st.vx, st.vz)
  const fwd = sp > 0.5 ? Math.cos(wrapAngle(vAng - a.angle)) : 0
  const lat = sp > 0.5 ? Math.sin(wrapAngle(vAng - a.angle)) : 0
  const w = smoothWeights(st.w, goalieLocoWeights(sp, fwd, lat), dt)
  // one integrated cycle phase (s) for the travel clips — cadence follows speed
  st.phase += dt * Math.min(1.5, Math.max(0.6, sp / 8))
  const k = (1 - (a.butterfly ?? 0)) * scale
  if (k <= 0.001) return
  let W = 0
  for (const [name, weight] of Object.entries(w) as Array<[string, number]>) {
    const clip = clips.get(name)
    if (!clip || weight <= 0.001) continue
    const f = weight / (W + weight)
    W += weight
    // animTime only runs while the game clock does (a paused game is a frozen frame)
    const t = name === 'g_stance' ? (a.animTime ?? 0) : st.phase
    blendClip(B as unknown as Record<string, THREE.Bone>, clip, t, true, f * k, 'full', part)
  }
}
