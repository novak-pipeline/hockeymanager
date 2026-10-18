/**
 * Physics-blended hit reactions (Rapier, WASM, visual only).
 *
 * When a hit lands, the man hit blends from his animation into a POWERED
 * ragdoll: one capsule rigid body per major bone, joined by ball joints, every
 * body driven toward the animated pose by velocity motors. The impact softens
 * those motors (harder hit = softer, longer) and kicks the torso along the
 * sim's own push direction, so the body gives the way the check went; the
 * motors then take him back (stays up / stumbles) or the clip the sim chose
 * takes him down (knockdown) and the ragdoll hands back to the get-up clip.
 * On the boards a fixed slab stands in for the dasher + glass: his chest stops
 * on it (pinned), and he slides off along it as the motors hand him back.
 *
 * Contract with the sim: the sim owns position and outcome. Physics only
 * bends the bones of a pose the animation already placed, plus a small hips
 * offset (≤ VISUAL_OFFSET_MAX_FT) that blends back to zero; the rig root is
 * never moved. Pure renderer state: a seek/replay drops every ragdoll.
 *
 * Budget: at most RAGDOLL_MAX active ragdolls, each in its own tiny world
 * (12 bodies + the ice + an optional boards slab) that is only stepped while
 * active; idle slots hold no bodies and cost nothing.
 *
 * The hitter gets a short follow-through (no physics): his hips and chest
 * drive on through the man along the push for half a second.
 */

import * as THREE from 'three'
import type * as RapierNS from '@dimforge/rapier3d-compat'
import type { AthleteRig, BoneName } from './athlete'
import { nearestBoards } from './rinkShape'

type Rapier = typeof RapierNS

export const RAGDOLL_MAX = 2
/** Physics substep rate (Hz of game time). */
export const RAGDOLL_HZ = 120
/** Most substeps per rendered frame (4× playback: the step grows instead). */
const MAX_SUBSTEPS = 8
/** The drawn hips may sit at most this far (ft) from where the animation put them. */
export const VISUAL_OFFSET_MAX_FT = 1.0
/** Blend into the ragdoll / back out to the animation (game s). */
const BLEND_IN_S = 0.05
const BLEND_OUT_S = 0.3
/** Hitter follow-through length (game s). */
const FOLLOW_S = 0.5
/** Fastest the physics' share of a bone's pose may change (rad/s game time): the
 *  body core stays under the motion probe's pop line (12 rad/s, VT4), limbs whip. */
const CORE_RATE = 6
const LIMB_RATE = 18
const CORE = new Set<BoneName>(['hips', 'spine', 'chest', 'head'])

const GRAVITY = -32.2 // ft/s²
/** Collision groups: ragdoll bodies hit the environment only (never each other). */
const G_BODY = (0x0001 << 16) | 0x0002
const G_ENV = (0x0002 << 16) | 0x0001

interface Seg {
  bone: BoneName
  /** Segment end: a child bone (its rest offset) or a fixed local vector. */
  end: BoneName | readonly [number, number, number]
  r: number
  /** Share of the impact the body takes (the torso takes the shoulder). */
  kick: number
}

/** Parents first (the write-back walks this order). */
const SEGS: readonly Seg[] = [
  { bone: 'hips', end: 'spine', r: 0.42, kick: 0.35 },
  { bone: 'spine', end: 'chest', r: 0.4, kick: 0.75 },
  { bone: 'chest', end: 'neck', r: 0.46, kick: 1 },
  { bone: 'head', end: [0, 0.55, 0], r: 0.34, kick: 1 },
  { bone: 'upperarm_L', end: 'forearm_L', r: 0.2, kick: 0.6 },
  { bone: 'forearm_L', end: 'hand_L', r: 0.18, kick: 0.4 },
  { bone: 'upperarm_R', end: 'forearm_R', r: 0.2, kick: 0.6 },
  { bone: 'forearm_R', end: 'hand_R', r: 0.18, kick: 0.4 },
  { bone: 'thigh_L', end: 'shin_L', r: 0.28, kick: 0.15 },
  { bone: 'shin_L', end: 'foot_L', r: 0.22, kick: 0.05 },
  { bone: 'thigh_R', end: 'shin_R', r: 0.28, kick: 0.15 },
  { bone: 'shin_R', end: 'foot_R', r: 0.22, kick: 0.05 },
]
const SEG_INDEX = new Map(SEGS.map((s, i) => [s.bone, i]))

/** What the choreographer knows at contact (all world feet / game seconds). */
export interface HitImpact {
  /** Impact 0..1 (the sim's force, else read from the closing speed). */
  force: number
  /** Push direction over the ice (hitter → man hit), any length. */
  dirX: number
  dirZ: number
  /** The sim's contact point. */
  x: number
  z: number
  /** The sim put him down (the fall clip plays). */
  knockdown: boolean
  /** Pinned on the boards (the slab is placed at the nearest boards). */
  boards: boolean
  /** Seconds the ragdoll owns the body before it hands back to the clip. */
  holdS: number
  /** His velocity at contact (ft/s, game time). */
  vx: number
  vz: number
}

/** The motor strength schedule (0 = limp, 1 = the animation) at game time t into a reaction. */
export function motorStrength(t: number, imp: Pick<HitImpact, 'force' | 'knockdown' | 'boards' | 'holdS'>): { torso: number; hips: number } {
  const f = Math.min(1, Math.max(0, imp.force))
  // the harder the hit, the softer the body and the longer it stays soft
  const soft = imp.knockdown ? 0.1 : imp.boards ? 0.3 : 0.6 - 0.42 * f
  const recoverAt = imp.knockdown ? imp.holdS * 0.85 : 0.18 + 0.45 * f
  const u = smooth(0.06, Math.max(0.12, recoverAt), t)
  const torso = soft + (1 - soft) * u
  // the hips hold his feet unless he goes down
  const hipSoft = imp.knockdown ? 0.22 : imp.boards ? 0.55 : 0.75 - 0.25 * f
  return { torso, hips: hipSoft + (1 - hipSoft) * u }
}

/** Blend weight animation → ragdoll at t into a reaction of `holdS` seconds. */
export function ragdollWeight(t: number, holdS: number): number {
  if (t <= 0) return 0
  const inW = Math.min(1, t / BLEND_IN_S)
  const outW = 1 - Math.min(1, Math.max(0, (t - holdS) / BLEND_OUT_S))
  return Math.max(0, Math.min(inW, outW))
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

// ── scratch ───────────────────────────────────────────────────────────────
const _q = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _qp = new THREE.Quaternion()
const _v = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _m2 = new THREE.Matrix4()
const _s = new THREE.Vector3()
const Y = new THREE.Vector3(0, 1, 0)

interface Target {
  pos: THREE.Vector3
  rot: THREE.Quaternion
  prevPos: THREE.Vector3
  prevRot: THREE.Quaternion
}

interface Ragdoll {
  rig: AthleteRig
  playerId: string | null
  imp: HitImpact
  t: number
  bodies: RapierNS.RigidBody[]
  boardsBody: RapierNS.RigidBody | null
  targets: Target[]
  /** Tangent along the boards he slides off along (unit, world), when pinned. */
  slide: { x: number; z: number } | null
  slid: boolean
  /** Last applied visual hips offset (world). */
  offset: THREE.Vector3
  /** This frame's animated local rotations, and the physics' share over them (rate-limited). */
  animLocal: THREE.Quaternion[]
  delta: THREE.Quaternion[]
  /** Largest physics share left this frame (rad): the hand-back waits for it to reach 0. */
  residual: number
}

interface Slot {
  world: RapierNS.World
  rd: Ragdoll | null
}

interface Follow {
  rig: AthleteRig
  dirX: number
  dirZ: number
  force: number
  t: number
  offset: THREE.Vector3
}

let rapierP: Promise<Rapier | null> | null = null

/** Load + init Rapier once (WASM inlined in the compat build: no file fetch). */
export function loadRapier(): Promise<Rapier | null> {
  rapierP ??= import('@dimforge/rapier3d-compat')
    .then(async (m) => {
      const R = ((m as unknown as { default?: Rapier }).default ?? m) as Rapier
      await R.init()
      return R
    })
    .catch(() => null)
  return rapierP
}

export class HitPhysics {
  private readonly slots: Slot[] = []
  private readonly follows: Follow[] = []
  /** Game-seconds of physics stepped / wall ms spent (perf counters). */
  readonly stats = { begun: 0, skipped: 0, steps: 0, ms: 0, maxActive: 0 }

  private constructor(private readonly R: Rapier) {
    for (let i = 0; i < RAGDOLL_MAX; i++) {
      const world = new R.World({ x: 0, y: GRAVITY, z: 0 })
      // the ice: a slab whose top is y = 0
      const ice = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0))
      world.createCollider(R.ColliderDesc.cuboid(150, 0.5, 80).setFriction(0.05).setCollisionGroups(G_ENV), ice)
      this.slots.push({ world, rd: null })
    }
  }

  static async create(): Promise<HitPhysics | null> {
    const R = await loadRapier()
    return R ? new HitPhysics(R) : null
  }

  /** Ragdolls running right now. */
  get active(): number {
    return this.slots.filter((s) => s.rd !== null).length
  }

  isActive(rig: AthleteRig): boolean {
    return this.slots.some((s) => s.rd?.rig === rig)
  }

  /**
   * A hit landed on `rig` (posed this frame by its animation). Takes a free
   * slot, else the slot with the least of its reaction left when the new hit
   * is harder; otherwise the hit plays on its clip alone.
   */
  begin(rig: AthleteRig, playerId: string | null, imp: HitImpact): boolean {
    let slot = this.slots.find((s) => s.rd?.rig === rig) ?? this.slots.find((s) => s.rd === null)
    if (!slot) {
      const left = (s: Slot) => (s.rd ? s.rd.imp.holdS + BLEND_OUT_S - s.rd.t : 0)
      const weakest = [...this.slots].sort((a, b) => left(a) - left(b))[0]!
      if (weakest.rd && (imp.force <= weakest.rd.imp.force || weakest.rd.t < 0.25)) {
        this.stats.skipped++
        return false
      }
      slot = weakest
    }
    this.release(slot)
    slot.rd = this.build(slot.world, rig, playerId, imp)
    this.stats.begun++
    this.stats.maxActive = Math.max(this.stats.maxActive, this.active)
    return true
  }

  /** The hitter drives on through the man along the push (no physics). */
  followThrough(rig: AthleteRig, dirX: number, dirZ: number, force: number): void {
    const n = Math.hypot(dirX, dirZ)
    if (n < 1e-6) return
    const prev = this.follows.findIndex((f) => f.rig === rig)
    if (prev >= 0) this.follows.splice(prev, 1)
    this.follows.push({ rig, dirX: dirX / n, dirZ: dirZ / n, force: Math.min(1, Math.max(0, force)), t: 0, offset: new THREE.Vector3() })
  }

  /** Seek / load / replay cut: drop everything (the animation is the truth). */
  reset(): void {
    for (const s of this.slots) this.release(s)
    this.follows.length = 0
  }

  dispose(): void {
    this.reset()
    for (const s of this.slots) s.world.free()
    this.slots.length = 0
  }

  /** The drawn hips' current visual offset from the animation (world ft), for the probe. */
  offsetOf(rig: AthleteRig): { x: number; z: number } {
    let x = 0
    let z = 0
    for (const s of this.slots) if (s.rd?.rig === rig) { x += s.rd.offset.x; z += s.rd.offset.z }
    for (const f of this.follows) if (f.rig === rig) { x += f.offset.x; z += f.offset.z }
    return { x, z }
  }

  /**
   * Call right after `rig.apply()` (the animated pose for this frame): steps
   * this rig's ragdoll on game time and blends its bones over the pose.
   * `simDt` 0 = paused (hold the blend), `seek` = drop it.
   */
  afterApply(rig: AthleteRig, playerId: string | null, simDt: number, seek: boolean): void {
    const slot = this.slots.find((s) => s.rd?.rig === rig)
    const fi = this.follows.findIndex((f) => f.rig === rig)
    if (!slot && fi < 0) return
    if (seek || !rig.visible) {
      if (slot) this.release(slot)
      if (fi >= 0) this.follows.splice(fi, 1)
      return
    }
    if (slot) {
      const rd = slot.rd!
      if (rd.playerId !== playerId) this.release(slot)
      else {
        const t0 = performance.now()
        this.run(slot.world, rd, simDt)
        this.stats.ms += performance.now() - t0
        // handed back once the blend is out and the rate-limited share has settled (never a snap)
        if (rd.t >= rd.imp.holdS + BLEND_OUT_S && (rd.residual < 2e-3 || rd.t > rd.imp.holdS + BLEND_OUT_S + 1)) this.release(slot)
      }
    }
    if (fi >= 0) {
      const f = this.follows[fi]!
      f.t += simDt
      if (f.t >= FOLLOW_S) this.follows.splice(fi, 1)
      else this.applyFollow(f)
    }
  }

  // ── build / release ───────────────────────────────────────────────────────

  private build(world: RapierNS.World, rig: AthleteRig, playerId: string | null, imp: HitImpact): Ragdoll {
    const R = this.R
    rig.root.updateMatrixWorld(true)
    const B = rig.bones
    const bodies: RapierNS.RigidBody[] = []
    const targets: Target[] = []
    for (const seg of SEGS) {
      const bone = B[seg.bone]
      bone.matrixWorld.decompose(_v, _q, _s)
      const body = world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(_v.x, _v.y, _v.z)
          .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
          .setLinvel(imp.vx, 0, imp.vz)
          .setLinearDamping(0.4)
          .setAngularDamping(1.5)
          .setCanSleep(true)
      )
      // the capsule runs from the joint to the segment's end, in the bone's frame
      if (typeof seg.end === 'string') _v2.copy(B[seg.end].position)
      else _v2.set(seg.end[0], seg.end[1], seg.end[2])
      const len = Math.max(0.05, _v2.length())
      _q2.setFromUnitVectors(Y, _v2.clone().normalize())
      world.createCollider(
        R.ColliderDesc.capsule(Math.max(0.02, len / 2 - seg.r * 0.5), seg.r)
          .setTranslation(_v2.x / 2, _v2.y / 2, _v2.z / 2)
          .setRotation({ x: _q2.x, y: _q2.y, z: _q2.z, w: _q2.w })
          .setDensity(seg.bone === 'hips' || seg.bone === 'chest' ? 1.4 : 1)
          .setFriction(0.15)
          .setCollisionGroups(G_BODY),
        body
      )
      bodies.push(body)
      targets.push({ pos: _v.clone(), rot: _q.clone(), prevPos: _v.clone(), prevRot: _q.clone() })
    }
    // ball joints to the nearest simulated ancestor, anchored where the child's joint is NOW
    SEGS.forEach((seg, i) => {
      const pi = simParent(B, seg.bone)
      if (pi < 0) return
      const parentT = targets[pi]!
      const childT = targets[i]!
      _m.compose(parentT.pos, parentT.rot, _s.set(1, 1, 1)).invert()
      const a1 = childT.pos.clone().applyMatrix4(_m)
      world.createImpulseJoint(R.JointData.spherical({ x: a1.x, y: a1.y, z: a1.z }, { x: 0, y: 0, z: 0 }), bodies[pi]!, bodies[i]!, true)
    })
    // the impact: a velocity kick along the sim's push, the chest taking it at shoulder height
    const n = Math.hypot(imp.dirX, imp.dirZ) || 1
    const dx = imp.dirX / n
    const dz = imp.dirZ / n
    const f = Math.min(1, Math.max(0, imp.force))
    const dv = 2.5 + 9 * f
    SEGS.forEach((seg, i) => {
      const b = bodies[i]!
      const m = b.mass() * dv * seg.kick
      if (seg.bone === 'chest') {
        const p = b.translation()
        // struck on the near side, a little above the joint: the torso turns as it gives
        b.applyImpulseAtPoint({ x: dx * m, y: 0.15 * m, z: dz * m }, { x: p.x - dx * 0.4, y: p.y + 0.5, z: p.z - dz * 0.4 }, true)
      } else b.applyImpulse({ x: dx * m, y: 0, z: dz * m }, true)
    })
    let boardsBody: RapierNS.RigidBody | null = null
    let slide: { x: number; z: number } | null = null
    if (imp.boards) {
      const nb = nearestBoards(imp.x, imp.z)
      // the dasher + glass as one slab whose inner face is the boards line
      _q.setFromAxisAngle(Y, Math.atan2(nb.nx, nb.nz))
      boardsBody = world.createRigidBody(
        R.RigidBodyDesc.fixed()
          .setTranslation(nb.x + nb.nx * 0.5, 4.5, nb.z + nb.nz * 0.5)
          .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
      )
      world.createCollider(R.ColliderDesc.cuboid(10, 4.5, 0.5).setFriction(0.3).setCollisionGroups(G_ENV), boardsBody)
      // he slides off along the glass the way he was travelling (else the push's tangent)
      let tx = -nb.nz
      let tz = nb.nx
      const along = imp.vx * tx + imp.vz * tz
      const pushAlong = dx * tx + dz * tz
      if ((Math.abs(along) > 1 ? along : pushAlong) < 0) { tx = -tx; tz = -tz }
      slide = { x: tx, z: tz }
    }
    return {
      rig, playerId, imp, t: 0, bodies, boardsBody, targets, slide, slid: false, offset: new THREE.Vector3(),
      animLocal: SEGS.map(() => new THREE.Quaternion()), delta: SEGS.map(() => new THREE.Quaternion()), residual: 0,
    }
  }

  private release(slot: Slot): void {
    const rd = slot.rd
    if (!rd) return
    for (const b of rd.bodies) slot.world.removeRigidBody(b)
    if (rd.boardsBody) slot.world.removeRigidBody(rd.boardsBody)
    slot.rd = null
  }

  // ── per frame ─────────────────────────────────────────────────────────────

  private run(world: RapierNS.World, rd: Ragdoll, simDt: number): void {
    const rig = rd.rig
    const B = rig.bones
    rig.root.updateMatrixWorld(true)
    // this frame's animated pose = the motor targets
    SEGS.forEach((seg, i) => {
      const tg = rd.targets[i]!
      tg.prevPos.copy(tg.pos)
      tg.prevRot.copy(tg.rot)
      B[seg.bone].matrixWorld.decompose(tg.pos, tg.rot, _s)
      rd.animLocal[i]!.copy(B[seg.bone].quaternion)
    })
    // the grip hand's animated frame (the stick rides with it)
    const grip = gripHand(rig)
    const handBefore = grip ? grip.matrixWorld.clone() : null
    if (simDt > 0) {
      const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(simDt * RAGDOLL_HZ - 1e-6)))
      const h = simDt / n
      world.timestep = h
      for (let k = 0; k < n; k++) {
        const t = rd.t + h * (k + 1)
        const s = motorStrength(t, rd.imp)
        this.drive(rd, h, simDt, s, (k + 1) / n)
        // pinned: once the motors take him back he slides off along the glass
        if (rd.slide && !rd.slid && t >= rd.imp.holdS - 0.05) {
          rd.slid = true
          const v = 3 + 3 * rd.imp.force
          for (const b of rd.bodies) b.applyImpulse({ x: rd.slide.x * v * b.mass(), y: 0, z: rd.slide.z * v * b.mass() }, true)
        }
        world.step()
        this.stats.steps++
      }
      rd.t += simDt
    }
    this.writeBack(rd, handBefore, grip, simDt)
  }

  /** Velocity motors toward the animated pose (stable at any step). */
  private drive(rd: Ragdoll, h: number, frameDt: number, s: { torso: number; hips: number }, u: number): void {
    const KG = 70 // 1/s at full strength
    const TAU = 0.06 // s: position/orientation error → velocity
    SEGS.forEach((seg, i) => {
      const b = rd.bodies[i]!
      const tg = rd.targets[i]!
      const strength = seg.bone === 'hips' ? s.hips : s.torso
      const g = 1 - Math.exp(-KG * strength * h)
      // target pose this substep (the frame's motion, spread over the substeps)
      _v.lerpVectors(tg.prevPos, tg.pos, u)
      _qp.slerpQuaternions(tg.prevRot, tg.rot, u)
      // the animation's own velocity
      const inv = frameDt > 0 ? 1 / frameDt : 0
      const avx = (tg.pos.x - tg.prevPos.x) * inv
      const avy = (tg.pos.y - tg.prevPos.y) * inv
      const avz = (tg.pos.z - tg.prevPos.z) * inv
      _q2.copy(tg.rot).multiply(_q.copy(tg.prevRot).invert())
      const aw = quatToRotVec(_q2, _v2).multiplyScalar(inv)
      const awx = aw.x, awy = aw.y, awz = aw.z
      // angular: w → w_anim + err/τ
      const r = b.rotation()
      _q.set(r.x, r.y, r.z, r.w)
      _q2.copy(_qp).multiply(_q.invert())
      const e = quatToRotVec(_q2, _v2)
      const w = b.angvel()
      b.setAngvel(
        {
          x: w.x + (awx + e.x / TAU - w.x) * g,
          y: w.y + (awy + e.y / TAU - w.y) * g,
          z: w.z + (awz + e.z / TAU - w.z) * g,
        },
        true
      )
      // linear: the hips carry the body; the limbs get a light pull (shape keeping)
      const lg = seg.bone === 'hips' ? g : 1 - Math.exp(-KG * 0.3 * strength * h)
      const p = b.translation()
      const lv = b.linvel()
      b.setLinvel(
        {
          x: lv.x + (avx + (_v.x - p.x) / TAU - lv.x) * lg,
          y: lv.y + (avy + (_v.y - p.y) / TAU - lv.y) * lg,
          z: lv.z + (avz + (_v.z - p.z) / TAU - lv.z) * lg,
        },
        true
      )
    })
  }

  /** Blend the simulated bodies over the animated bones (parents first). */
  private writeBack(rd: Ragdoll, handBefore: THREE.Matrix4 | null, grip: THREE.Bone | null, simDt: number): void {
    const rig = rd.rig
    const B = rig.bones
    const W = ragdollWeight(rd.t, rd.imp.holdS)
    // the hips' visual offset: clamped, and only as much as the blend shows
    const hips = rd.bodies[0]!.translation()
    const hipsT = rd.targets[0]!.pos
    _v.set(hips.x - hipsT.x, hips.y - hipsT.y, hips.z - hipsT.z)
    const hz = Math.hypot(_v.x, _v.z)
    if (hz > VISUAL_OFFSET_MAX_FT) { _v.x *= VISUAL_OFFSET_MAX_FT / hz; _v.z *= VISUAL_OFFSET_MAX_FT / hz }
    _v.y = Math.max(-VISUAL_OFFSET_MAX_FT * 1.5, Math.min(VISUAL_OFFSET_MAX_FT * 0.5, _v.y))
    _v.multiplyScalar(W)
    rd.offset.set(_v.x, 0, _v.z)
    rd.residual = 0
    // keep the simulated body near the drawn one (a ragdoll never wanders off)
    if (hz > VISUAL_OFFSET_MAX_FT * 1.5) {
      const k = 1 - (VISUAL_OFFSET_MAX_FT * 1.5) / hz
      const sx = -(hips.x - hipsT.x) * k
      const sz = -(hips.z - hipsT.z) * k
      for (const b of rd.bodies) {
        const p = b.translation()
        b.setTranslation({ x: p.x + sx, y: p.y, z: p.z + sz }, false)
      }
    }
    const hipsBone = B.hips
    _v2.copy(hipsT).add(_v)
    hipsBone.parent!.updateWorldMatrix(true, false)
    hipsBone.position.copy(hipsBone.parent!.worldToLocal(_v2))
    for (let i = 0; i < SEGS.length; i++) {
      const seg = SEGS[i]!
      const bone = B[seg.bone]
      const r = rd.bodies[i]!.rotation()
      _q.set(r.x, r.y, r.z, r.w)
      // world rotation: animation → physics by the blend weight
      _q2.copy(rd.targets[i]!.rot).slerp(_q, W)
      bone.parent!.updateWorldMatrix(true, false)
      bone.parent!.getWorldQuaternion(_qp)
      bone.quaternion.copy(_qp.invert().multiply(_q2))
      // the physics' share of the pose (local, over the clip) changes no faster
      // than a body can turn: the core never "pops" (VT4), the limbs may whip
      const anim = rd.animLocal[i]!
      const delta = _q.copy(anim).invert().multiply(bone.quaternion)
      const prev = rd.delta[i]!
      const ang = prev.angleTo(delta)
      const max = (CORE.has(seg.bone) ? CORE_RATE : LIMB_RATE) * simDt
      if (ang > max) {
        _q2.copy(delta)
        delta.copy(prev).slerp(_q2, max / ang)
      }
      rd.residual = Math.max(rd.residual, 2 * Math.acos(Math.min(1, Math.abs(delta.w))))
      prev.copy(delta)
      bone.quaternion.copy(anim).multiply(delta)
    }
    // the stick rides with the hand that holds it
    if (handBefore && grip) {
      grip.updateWorldMatrix(true, false)
      _m.copy(grip.matrixWorld).multiply(_m2.copy(handBefore).invert())
      for (const sb of [B.stick, B.stick_blade]) {
        sb.updateWorldMatrix(true, false)
        const world = sb.matrixWorld.clone().premultiply(_m)
        sb.parent!.updateWorldMatrix(true, false)
        world.premultiply(_m2.copy(sb.parent!.matrixWorld).invert())
        world.decompose(sb.position, sb.quaternion, _s)
      }
    }
    rig.root.updateMatrixWorld(true)
  }

  private applyFollow(f: Follow): void {
    const rig = f.rig
    const B = rig.bones
    const u = f.t / FOLLOW_S
    // a quick drive that eases back: peak ~0.15 s after contact
    const bump = Math.sin(Math.PI * Math.min(1, u)) * Math.exp(-1.2 * u)
    const reach = (0.25 + 0.5 * f.force) * bump
    f.offset.set(f.dirX * reach, 0, f.dirZ * reach)
    rig.root.updateMatrixWorld(true)
    const hips = B.hips
    hips.getWorldPosition(_v).add(f.offset)
    hips.position.copy(hips.parent!.worldToLocal(_v))
    // the chest stays over the drive: lean into it about the axis across the push
    const ang = (0.12 + 0.22 * f.force) * bump
    _v2.set(f.dirZ, 0, -f.dirX) // up × dir
    _q.setFromAxisAngle(_v2.normalize(), ang)
    const sp = B.spine
    sp.parent!.updateWorldMatrix(true, false)
    sp.parent!.getWorldQuaternion(_qp)
    // world-space lean → the spine's local frame: local' = P⁻¹ · L · P · local
    _q2.copy(_qp).invert().multiply(_q).multiply(_qp)
    sp.quaternion.premultiply(_q2)
    rig.root.updateMatrixWorld(true)
  }
}

/** Nearest simulated ancestor's index (−1 for the hips). */
function simParent(B: Record<BoneName, THREE.Bone>, bone: BoneName): number {
  let p = B[bone].parent
  while (p) {
    const i = SEG_INDEX.get(p.name as BoneName)
    if (i !== undefined) return i
    p = p.parent
  }
  return -1
}

/** q → rotation vector (axis · angle), shortest way round. */
function quatToRotVec(q: THREE.Quaternion, out: THREE.Vector3): THREE.Vector3 {
  let { x, y, z, w } = q
  if (w < 0) { x = -x; y = -y; z = -z; w = -w }
  const s = Math.sqrt(x * x + y * y + z * z)
  if (s < 1e-6) return out.set(2 * x, 2 * y, 2 * z)
  const a = 2 * Math.atan2(s, w)
  return out.set((x / s) * a, (y / s) * a, (z / s) * a)
}

/** The hand nearer the stick's shaft (the one that keeps it). */
function gripHand(rig: AthleteRig): THREE.Bone | null {
  const B = rig.bones
  if (!B.stick || B.stick.scale.x < 0.01) return null
  B.stick.getWorldPosition(_v)
  B.stick.getWorldQuaternion(_q)
  const dir = _v2.set(0, 1, 0).applyQuaternion(_q)
  const len = rig.dims.stickLen
  const d = (hand: THREE.Bone): number => {
    const p = hand.getWorldPosition(new THREE.Vector3()).sub(_v)
    const t = Math.max(0, Math.min(len, p.dot(dir)))
    return p.addScaledVector(dir, -t).length()
  }
  return d(B.hand_L) <= d(B.hand_R) ? B.hand_L : B.hand_R
}
