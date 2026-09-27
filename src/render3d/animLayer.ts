/**
 * Layered clip playback on top of the procedural athlete.
 *
 * Why not THREE.AnimationMixer: the base layer is CODE (the stride is
 * integrated from the sim's speed and the support skate is kept on the ice by
 * FK), and a mixer's leftover weight blends toward the bind pose, not toward
 * whatever the code just wrote. So each frame:
 *   1. AthleteRig.apply() writes the procedural pose;
 *   2. blendBody()  slerps masked bones toward the active clips;
 *   3. the rig places the stick, blendStick() pulls it toward the clip's stick;
 *   4. the rig re-solves both hands onto the stick with its IK;
 *   5. blendArms()  applies 'clip'-hands clips (fist pumps, falls) on top.
 * Sampling is two array reads + a slerp per bone (BakedClip is pre-resampled
 * at 30 fps and already retargeted), so a full team costs microseconds.
 */

import * as THREE from 'three'
import type { BakedClip } from './gltfAthlete'
import { CLIP_FPS } from './gltfAthlete'
import { CLIPS, envelope, maskWeight, isArmBone, type ClipMask, type ClipMeta } from './animCatalog'

type Bones = Record<string, THREE.Bone>

const _q = new THREE.Quaternion()
const _v = new THREE.Vector3()

function frameAt(clip: BakedClip, t: number, loop: boolean): [number, number, number] {
  const last = clip.samples - 1
  let x = t * CLIP_FPS
  if (loop) {
    x %= last
    if (x < 0) x += last
  } else x = Math.min(last, Math.max(0, x))
  const i0 = Math.floor(x)
  const i1 = loop ? (i0 + 1) % last : Math.min(last, i0 + 1)
  // loop: sample `last` equals sample 0, so wrapping to index 0 is seamless
  return [i0, i1 === 0 && loop ? 0 : i1, x - i0]
}

/** Sample a bone's retargeted local rotation at time t. False if the clip doesn't animate it. */
export function sampleRot(clip: BakedClip, bone: string, t: number, loop: boolean, out: THREE.Quaternion): boolean {
  return sampleInto(clip, bone, t, loop, out)
}

/** Sample a bone's local position at time t. */
export function samplePos(clip: BakedClip, bone: string, t: number, loop: boolean, out: THREE.Vector3): boolean {
  const arr = clip.pos[bone as keyof BakedClip['pos']]
  if (!arr) return false
  const [i0, i1, a] = frameAt(clip, t, loop)
  out.set(
    arr[i0 * 3]! + (arr[i1 * 3]! - arr[i0 * 3]!) * a,
    arr[i0 * 3 + 1]! + (arr[i1 * 3 + 1]! - arr[i0 * 3 + 1]!) * a,
    arr[i0 * 3 + 2]! + (arr[i1 * 3 + 2]! - arr[i0 * 3 + 2]!) * a
  )
  return true
}

const STICK = ['stick', 'stick_blade']
const flat = new Float32Array(4)

function sampleInto(clip: BakedClip, bone: string, t: number, loop: boolean, out: THREE.Quaternion): boolean {
  const arr = clip.rot[bone as keyof BakedClip['rot']]
  if (!arr) return false
  const [i0, i1, a] = frameAt(clip, t, loop)
  THREE.Quaternion.slerpFlat(flat as unknown as number[], 0, arr as unknown as number[], i0 * 4, arr as unknown as number[], i1 * 4, a)
  out.set(flat[0]!, flat[1]!, flat[2]!, flat[3]!)
  return true
}

/**
 * Blend one clip sample onto the bones (weight 0..1, masked).
 * `part` limits which bones are touched: body (no arms / stick), stick, or arms.
 */
export function blendClip(bones: Bones, clip: BakedClip, t: number, loop: boolean, weight: number, mask: ClipMask, part: 'body' | 'stick' | 'arms'): void {
  if (weight <= 0) return
  for (const name in bones) {
    const isStick = STICK.includes(name)
    const arm = isArmBone(name)
    if (part === 'body' && (isStick || arm)) continue
    if (part === 'stick' && !isStick) continue
    if (part === 'arms' && !arm) continue
    const w = weight * maskWeight(mask, name)
    if (w <= 0) continue
    const b = bones[name]!
    if (sampleInto(clip, name, t, loop, _q)) b.quaternion.slerp(_q, w)
    if ((name === 'hips' || isStick) && samplePos(clip, name, t, loop, _v)) b.position.lerp(_v, w)
  }
}

interface Active {
  name: string
  clip: BakedClip
  meta: ClipMeta
  t: number
  speed: number
  scale: number
  /** Set when superseded / stopped: fade out from this time on. */
  release: number | null
  chained: boolean
  /** A newer clip on the same body parts: this one keeps its weight UNDER it until that one is fully in. */
  supersededBy: Active | null
  /** Debug freeze-frames: full weight, no envelope. */
  fadeless: boolean
}

export class ActionLayer {
  private readonly active: Active[] = []

  constructor(private readonly clips: Map<string, BakedClip>) {}

  has(name: string): boolean {
    return this.clips.has(name)
  }

  /** Currently playing clip names (top-most last). */
  get playing(): string[] {
    return this.active.map((a) => a.name)
  }

  /**
   * Start a clip. `at` starts it part-way in (seconds) — used to line a
   * clip's contact frame up with the event time. Clips sharing body parts
   * with the new one are released (they fade out under it, no pop).
   */
  play(name: string, opts: { at?: number; speed?: number; weight?: number; fadeless?: boolean } = {}): boolean {
    // owner-only slots fall back to the Blender clip when the import lacks them
    if (!this.clips.has(name) && CLIPS[name]?.fallback) name = CLIPS[name]!.fallback!
    const clip = this.clips.get(name)
    const meta = CLIPS[name]
    if (!clip || !meta) return false
    const next: Active = { name, clip, meta, t: opts.at ?? 0, speed: opts.speed ?? 1, scale: opts.weight ?? 1, release: null, chained: false, supersededBy: null, fadeless: !!opts.fadeless }
    for (const a of this.active) {
      if (a.release === null && a.supersededBy === null && overlaps(a.meta.mask, meta.mask) && covers(meta.mask, a.meta.mask)) a.supersededBy = next
    }
    this.active.push(next)
    return true
  }

  /** Fade a clip (or every clip) out. */
  stop(name?: string): void {
    for (const a of this.active) if ((!name || a.name === name) && a.release === null) a.release = a.t
  }

  clear(): void {
    this.active.length = 0
  }

  /** Is a full-body clip (fall, pin, celebration…) currently owning the body? */
  bodyBusy(): number {
    let w = 0
    for (const a of this.active) if (a.meta.mask === 'full') w = Math.max(w, this.weight(a))
    return w
  }

  weight(a: Active): number {
    if (a.fadeless) return a.scale
    const m = a.meta
    // a superseded clip holds its pose (no fade-out) UNDER the clip replacing it
    // until that one is fully in — a crossfade that never dips to the base pose
    const fadeInOnly = m.loop || a.supersededBy !== null
    const env = fadeInOnly ? Math.min(1, m.fadeIn > 0 ? a.t / m.fadeIn : 1) : envelope(a.t, a.clip.duration, m.fadeIn, m.fadeOut, m.hold ?? 0)
    let w = env
    if (a.release !== null) w = Math.min(w, 1 - Math.min(1, (a.t - a.release) / Math.max(0.01, m.fadeOut)))
    return Math.max(0, w) * a.scale
  }

  update(dt: number): void {
    for (const a of this.active) a.t += dt * a.speed
    // chain (hit_fall → getup) as a CROSSFADE that starts while the first clip
    // still holds its end pose, so the body never dips back toward the base pose
    for (const a of [...this.active]) {
      const m = a.meta
      if (!m.next || a.chained || a.release !== null) continue
      const end = a.clip.duration + (m.hold ?? 0)
      if (a.t >= end - m.fadeOut) {
        a.chained = true
        this.play(m.next)
      }
    }
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i]!
      const m = a.meta
      const end = a.clip.duration + (m.hold ?? 0)
      const released = a.release !== null && a.t - a.release >= m.fadeOut
      const finished = !m.loop && a.t >= end && a.supersededBy === null
      const sup = a.supersededBy
      const covered = sup !== null && (!this.active.includes(sup) || this.weight(sup) >= 0.999)
      if (released || finished || covered) {
        this.active.splice(i, 1)
      }
    }
  }

  private time(a: Active): number {
    // hold the last frame during `hold`
    return a.meta.loop ? a.t : Math.min(a.t, a.clip.duration)
  }

  blendBody(bones: Bones): void {
    for (const a of this.active) blendClip(bones, a.clip, this.time(a), !!a.meta.loop, this.weight(a), a.meta.mask, 'body')
  }

  blendStick(bones: Bones): void {
    for (const a of this.active) blendClip(bones, a.clip, this.time(a), !!a.meta.loop, this.weight(a), a.meta.mask, 'stick')
  }

  blendArms(bones: Bones): void {
    for (const a of this.active) if (a.meta.hands === 'clip') blendClip(bones, a.clip, this.time(a), !!a.meta.loop, this.weight(a), a.meta.mask, 'arms')
  }

  /** Does any active clip drive the arms directly? (skip nothing — IK still runs first) */
  armsWeight(): number {
    let w = 0
    for (const a of this.active) if (a.meta.hands === 'clip' && a.meta.mask !== 'lower') w = Math.max(w, this.weight(a))
    return w
  }
}

/** Does a clip with mask `top` cover every bone of a clip with mask `under`? */
function covers(top: ClipMask, under: ClipMask): boolean {
  return top === 'full' || top === under
}

function overlaps(a: ClipMask, b: ClipMask): boolean {
  if (a === 'full' || b === 'full') return true
  return a === b
}
