/**
 * Procedural athletes — ONE continuous skinned mesh per player on a clean,
 * named skeleton (no floating primitives, no visible joints).
 *
 * Skeleton (Bone names are the contract a future rigged glTF will match):
 *
 *   root ─ hips ─┬─ spine ─ chest ─┬─ neck ─ head
 *                │                 ├─ shoulder_L ─ upperarm_L ─ forearm_L ─ hand_L
 *                │                 └─ shoulder_R ─ upperarm_R ─ forearm_R ─ hand_R
 *                ├─ thigh_L ─ shin_L ─ foot_L
 *                └─ thigh_R ─ shin_R ─ foot_R
 *   root ─ stick            (shaft; +Y runs heel → knob)
 *   root ─ stick_blade      (+X along the blade, +Y up)
 *
 * Rest pose: standing straight, arms hanging, every limb bone pointing −Y.
 * Units are feet; +Z is the player's front, +X his LEFT.
 *
 * Geometry: equipment silhouette first — loose sweater wider than the torso
 * with a flared hem over bulky shoulder pads, padded breezers, taped stick,
 * big gloves, helmet + visor, striped socks, skates. Limbs are single tubes
 * that run THROUGH the joints with blended skin weights (thigh→shin,
 * upper-arm→forearm, hips→spine→chest), so bends are continuous.
 *
 * One shared material for everyone: the jersey atlas carries sweater, sleeve
 * and sock art per player; solid parts sample the atlas's white strip and take
 * colour from vertex colours; roughness is a per-vertex attribute (matte
 * cloth, satin breezers, glossy helmet). → 14 draw calls for all players.
 */

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RIG, legDrop, solveTwoBone, type BodyPose, type V3 } from './pose'
import { ATLAS_GRID, ATLAS_REGIONS, atlasOffset } from './textures'
import type { Kit } from './palette'
import type { AthleteTemplate } from './gltfAthlete'

export const BONE_NAMES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head',
  'shoulder_L', 'upperarm_L', 'forearm_L', 'hand_L',
  'shoulder_R', 'upperarm_R', 'forearm_R', 'hand_R',
  'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R',
  'stick', 'stick_blade',
] as const
export type BoneName = (typeof BONE_NAMES)[number]

/** Rest hip-joint height (legs straight). */
export const REST_HIP_Y = RIG.thigh + RIG.shin + RIG.skate
const H = REST_HIP_Y

// ── materials roles ─────────────────────────────────────────────────────────

type Role =
  | 'jersey' | 'pants' | 'helmet' | 'visor' | 'gloves' | 'skin' | 'boot' | 'steel'
  | 'stick' | 'tape' | 'tapeW' | 'pad' | 'padTrim' | 'cage' | 'mask'

const ROUGH: Record<Role, number> = {
  jersey: 0.92, pants: 0.5, helmet: 0.24, visor: 0.12, gloves: 0.72, skin: 0.6, boot: 0.36,
  steel: 0.22, stick: 0.42, tape: 0.95, tapeW: 0.9, pad: 0.55, padTrim: 0.55, cage: 0.4, mask: 0.26,
}

const SKIN_TONES = [0xe0b79a, 0xc99a7a, 0xf1c9a9, 0xa8795a, 0xd9a887, 0x8a5a3c]
const STICK_TONES = [0x16181b, 0x16181b, 0xe8e8e6, 0x3a3f46, 0x16181b, 0x9a1f24]

// ── geometry builder ────────────────────────────────────────────────────────

type Weights = Array<[BoneName, number]>

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

interface PartSpec {
  geo: THREE.BufferGeometry
  role: Role | ((p: THREE.Vector3) => Role)
  weights: (p: THREE.Vector3) => Weights
  /** Slot-local UV for atlas-painted parts; omitted → the white strip. */
  uv?: (p: THREE.Vector3, uvIn: THREE.Vector2) => [number, number] | null
}

class Builder {
  private readonly parts: THREE.BufferGeometry[] = []
  readonly roles: Role[] = []

  constructor(private readonly slot: number) {}

  add(spec: PartSpec): void {
    const g = spec.geo.index ? spec.geo.toNonIndexed() : spec.geo
    g.deleteAttribute('uv1')
    const pos = g.getAttribute('position') as THREE.BufferAttribute
    const uvIn = g.getAttribute('uv') as THREE.BufferAttribute | undefined
    const n = pos.count
    const uv = new Float32Array(n * 2)
    const skinIndex = new Uint16Array(n * 4)
    const skinWeight = new Float32Array(n * 4)
    const rough = new Float32Array(n)
    const [cu, cv] = atlasOffset(this.slot)
    const whiteV = (ATLAS_REGIONS.white[0] + ATLAS_REGIONS.white[1]) / 2
    const p = new THREE.Vector3()
    const t = new THREE.Vector2()
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i)
      if (uvIn) t.fromBufferAttribute(uvIn, i)
      else t.set(0, 0)
      const role = typeof spec.role === 'function' ? spec.role(p) : spec.role
      this.roles.push(role)
      rough[i] = ROUGH[role]
      const local = spec.uv ? spec.uv(p, t) : null
      const [lu, lv] = local ?? [0.5, whiteV]
      uv[i * 2] = cu + lu / ATLAS_GRID
      uv[i * 2 + 1] = cv + lv / ATLAS_GRID
      const w = spec.weights(p).filter(([, x]) => x > 1e-4)
      w.sort((a, b) => b[1] - a[1])
      const top = w.slice(0, 4)
      const sum = top.reduce((a, [, x]) => a + x, 0) || 1
      top.forEach(([bone, x], k) => {
        skinIndex[i * 4 + k] = BONE_NAMES.indexOf(bone)
        skinWeight[i * 4 + k] = x / sum
      })
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4))
    g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4))
    g.setAttribute('aRough', new THREE.BufferAttribute(rough, 1))
    this.parts.push(g)
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts)!
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 3), 3))
    for (const p of this.parts) p.dispose()
    return g
  }
}

/** Lathe from (radius, y) points listed bottom → top; optional depth scale. */
function lathe(profile: Array<[number, number]>, segs: number, depth = 1): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-3), y)), segs)
  if (depth !== 1) g.scale(1, 1, depth)
  return g
}

const only = (b: BoneName) => (): Weights => [[b, 1]]

/** 0..1 around a lathe (u) — LatheGeometry's own u, 0 = front (+Z). */
const aroundU = (_p: THREE.Vector3, t: THREE.Vector2) => t.x

// ── rest-pose skeleton layout ──────────────────────────────────────────────

interface Layout {
  shoulderX: number
  sleeve: [number, number, number] // radius at shoulder cap / elbow / cuff
}

function restBoneOffsets(goalie: boolean): Record<BoneName, [number, number, number]> {
  const sw = goalie ? 0.95 : RIG.shoulderHalfWidth
  return {
    root: [0, 0, 0],
    hips: [0, H, 0],
    spine: [0, 0.32, 0],
    chest: [0, 0.8, 0],
    neck: [0, 1.18, 0.02],
    head: [0, 0.15, 0.08],
    shoulder_L: [sw, 0.88, 0.02],
    upperarm_L: [0, 0, 0],
    forearm_L: [0, -RIG.upperArm, 0],
    hand_L: [0, -RIG.forearm, 0],
    shoulder_R: [-sw, 0.88, 0.02],
    upperarm_R: [0, 0, 0],
    forearm_R: [0, -RIG.upperArm, 0],
    hand_R: [0, -RIG.forearm, 0],
    thigh_L: [RIG.hipHalfWidth, 0, 0],
    shin_L: [0, -RIG.thigh, 0],
    foot_L: [0, -RIG.shin, 0],
    thigh_R: [-RIG.hipHalfWidth, 0, 0],
    shin_R: [0, -RIG.thigh, 0],
    foot_R: [0, -RIG.shin, 0],
    stick: [0, 0, 0],
    stick_blade: [0, 0, 0],
  }
}

const PARENT: Record<BoneName, BoneName | null> = {
  root: null, hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  shoulder_L: 'chest', upperarm_L: 'shoulder_L', forearm_L: 'upperarm_L', hand_L: 'forearm_L',
  shoulder_R: 'chest', upperarm_R: 'shoulder_R', forearm_R: 'upperarm_R', hand_R: 'forearm_R',
  thigh_L: 'hips', shin_L: 'thigh_L', foot_L: 'shin_L',
  thigh_R: 'hips', shin_R: 'thigh_R', foot_R: 'shin_R',
  stick: 'root', stick_blade: 'root',
}

/** Rest-pose world position of every bone (root at the origin). */
export function restBonePositions(goalie: boolean): Record<BoneName, THREE.Vector3> {
  const off = restBoneOffsets(goalie)
  const out = {} as Record<BoneName, THREE.Vector3>
  for (const name of BONE_NAMES) {
    const parent = PARENT[name]
    const o = off[name]
    out[name] = new THREE.Vector3(o[0], o[1], o[2]).add(parent ? out[parent] : new THREE.Vector3())
  }
  return out
}

// ── the body ───────────────────────────────────────────────────────────────

function buildBody(slot: number, goalie: boolean): { geo: THREE.BufferGeometry; roles: Role[] } {
  const b = new Builder(slot)
  const rest = restBonePositions(goalie)
  const R = ATLAS_REGIONS
  const layout: Layout = goalie
    ? { shoulderX: 0.95, sleeve: [0.33, 0.27, 0.23] }
    : { shoulderX: RIG.shoulderHalfWidth, sleeve: [0.29, 0.22, 0.19] }

  // ── sweater over shoulder pads: wider than the body, flared hem ──
  const torsoProfile: Array<[number, number]> = goalie
    ? [[0.92, -0.34], [0.88, -0.12], [0.86, 0.3], [0.94, 0.85], [1.04, 1.35], [1.12, 1.74], [1.06, 1.98], [0.72, 2.16], [0.34, 2.28], [0.001, 2.34]]
    : [[0.8, -0.34], [0.76, -0.14], [0.7, 0.28], [0.74, 0.8], [0.84, 1.34], [0.94, 1.76], [0.9, 1.98], [0.62, 2.16], [0.3, 2.28], [0.001, 2.33]]
  const tY0 = H + torsoProfile[0]![1]
  const tY1 = H + torsoProfile[torsoProfile.length - 1]![1]
  const torso = lathe(torsoProfile.map(([r, y]) => [r, H + y]), 28, goalie ? 0.8 : 0.74)
  b.add({
    geo: torso,
    role: 'jersey',
    weights: (p) => {
      const sp = smooth(H + 0.2, H + 0.7, p.y)
      const ch = smooth(H + 1.05, H + 1.55, p.y)
      return [['hips', 1 - sp], ['spine', sp * (1 - ch)], ['chest', sp * ch]]
    },
    uv: (p, t) => [aroundU(p, t), R.torso[0] + ((p.y - tY0) / (tY1 - tY0)) * (R.torso[1] - R.torso[0])],
  })

  // ── breezers (padded pants) around the pelvis ──
  const breezer = lathe(
    goalie
      ? [[0.001, H - 0.66], [0.8, H - 0.64], [0.88, H - 0.3], [0.84, H + 0.1], [0.74, H + 0.4]]
      : [[0.001, H - 0.62], [0.72, H - 0.6], [0.78, H - 0.3], [0.74, H + 0.08], [0.66, H + 0.36]],
    20,
    0.86
  )
  b.add({ geo: breezer, role: 'pants', weights: only('hips') })

  // ── legs: one tube hip → ankle; breezer leg, hem, knee, shin, striped sock ──
  for (const side of [1, -1] as const) {
    const sx = side * RIG.hipHalfWidth
    const L = side > 0 ? 'L' : 'R'
    const thigh = `thigh_${L}` as BoneName
    const shin = `shin_${L}` as BoneName
    const hem = H - 0.98
    const ankle = H - RIG.thigh - RIG.shin
    const legProfile: Array<[number, number]> = goalie
      ? [[0.17, ankle], [0.2, ankle + 0.5], [0.24, H - 1.5], [0.36, hem - 0.02], [0.42, hem], [0.46, H - 0.5], [0.44, H - 0.1], [0.34, H + 0.2]]
      : [[0.16, ankle], [0.17, ankle + 0.25], [0.2, ankle + 0.8], [0.23, H - 1.85], [0.27, H - 1.45], [0.25, H - 1.15], [0.29, hem - 0.02], [0.37, hem], [0.41, H - 0.55], [0.41, H - 0.15], [0.31, H + 0.18]]
    const leg = lathe(legProfile, 16)
    leg.translate(sx, 0, 0)
    b.add({
      geo: leg,
      role: (p) => (p.y > hem - 0.01 ? 'pants' : 'jersey'),
      weights: (p) => {
        const hipW = smooth(H - 0.25, H + 0.12, p.y)
        const k = 1 - smooth(H - 1.72, H - 1.28, p.y)
        return [['hips', hipW], [thigh, (1 - hipW) * (1 - k)], [shin, (1 - hipW) * k]]
      },
      uv: (p, t) => (p.y > hem - 0.01 ? null : [aroundU(p, t), R.sock[0] + ((p.y - ankle) / (hem - ankle)) * (R.sock[1] - R.sock[0])]),
    })

    // skate: boot, toe cap, blade holder, steel runner (foot bone at the ankle)
    const f = rest[`foot_${L}` as BoneName]
    const boot = new THREE.BoxGeometry(0.36, 0.42, 0.95, 1, 1, 2)
    boot.translate(f.x, f.y - 0.1, f.z + 0.14)
    const toe = new THREE.CylinderGeometry(0.18, 0.18, 0.3, 12, 1, false, -Math.PI / 2, Math.PI)
    toe.rotateX(0)
    toe.translate(f.x, f.y - 0.16, f.z + 0.6)
    const holder = new THREE.BoxGeometry(0.1, 0.07, 0.95)
    holder.translate(f.x, f.y - 0.31, f.z + 0.16)
    const runner = new THREE.BoxGeometry(0.035, 0.06, 1.06)
    runner.translate(f.x, f.y - RIG.skate + 0.03, f.z + 0.16)
    const fb = `foot_${L}` as BoneName
    b.add({ geo: boot, role: 'boot', weights: only(fb) })
    b.add({ geo: toe, role: 'boot', weights: only(fb) })
    b.add({ geo: holder, role: 'boot', weights: only(fb) })
    b.add({ geo: runner, role: 'steel', weights: only(fb) })

    if (goalie) {
      // leg pad: bends with the knee (thigh-rise above, shin below)
      const k = rest[shin]
      const pad = new THREE.BoxGeometry(0.88, 2.15, 0.52, 1, 6, 1)
      pad.translate(k.x + side * 0.02, k.y - 0.55, k.z + 0.22)
      const padW = (p: THREE.Vector3): Weights => {
        const s = 1 - smooth(k.y - 0.2, k.y + 0.2, p.y)
        return [[thigh, 1 - s], [shin, s]]
      }
      b.add({ geo: pad, role: 'pad', weights: padW })
      for (const dy of [0.15, -0.55, -1.25]) {
        const trim = new THREE.BoxGeometry(0.9, 0.12, 0.04)
        trim.translate(k.x + side * 0.02, k.y + dy, k.z + 0.49)
        b.add({ geo: trim, role: 'padTrim', weights: padW })
      }
      const roll = new THREE.CylinderGeometry(0.22, 0.22, 0.9, 12)
      roll.rotateZ(Math.PI / 2)
      roll.translate(k.x + side * 0.02, k.y + 0.52, k.z + 0.32)
      b.add({ geo: roll, role: 'pad', weights: only(thigh) })
    }
  }

  // ── arms: one sleeve tube shoulder → wrist through the elbow, + glove ──
  for (const side of [1, -1] as const) {
    const L = side > 0 ? 'L' : 'R'
    const sh = rest[`shoulder_${L}` as BoneName]
    const yS = sh.y
    const [r0, r1, r2] = layout.sleeve
    const top = yS + 0.14
    const wrist = yS - RIG.upperArm - RIG.forearm
    const sleeve = lathe(
      [[r2 * 0.95, wrist + 0.12], [r2, wrist + 0.3], [r1 * 0.95, yS - RIG.upperArm - 0.25], [r1, yS - RIG.upperArm], [r1 * 1.08, yS - 0.6], [r0, yS - 0.12], [r0 * 0.8, yS + 0.08], [0.001, top]],
      14
    )
    sleeve.translate(sh.x, 0, sh.z)
    const shoulderB = `shoulder_${L}` as BoneName
    const upper = `upperarm_${L}` as BoneName
    const fore = `forearm_${L}` as BoneName
    b.add({
      geo: sleeve,
      role: 'jersey',
      weights: (p) => {
        const c = 0.45 * smooth(yS - 0.3, yS + 0.08, p.y)
        const f = 1 - smooth(yS - 1.25, yS - 0.88, p.y)
        return [[shoulderB, c], [upper, (1 - c) * (1 - f)], [fore, (1 - c) * f]]
      },
      uv: (p, t) => [aroundU(p, t), R.sleeve[0] + ((p.y - (wrist + 0.12)) / (top - (wrist + 0.12))) * (R.sleeve[1] - R.sleeve[0])],
    })

    // glove at the hand (hand bone sits at the wrist)
    const hand = `hand_${L}` as BoneName
    const hp = rest[hand]
    if (goalie && side > 0) {
      // catching glove: big pocket + cuff
      const pocket = new THREE.CylinderGeometry(0.56, 0.5, 0.24, 20)
      pocket.rotateZ(Math.PI / 2)
      pocket.translate(hp.x + 0.08, hp.y - 0.22, hp.z + 0.05)
      const cuff = new THREE.CylinderGeometry(0.27, 0.25, 0.4, 12)
      cuff.translate(hp.x, hp.y + 0.05, hp.z)
      b.add({ geo: pocket, role: 'pad', weights: only(hand) })
      b.add({ geo: cuff, role: 'pad', weights: only(hand) })
    } else if (goalie) {
      // blocker: flat board on the back of the stick hand
      const board = new THREE.BoxGeometry(0.1, 0.95, 0.62)
      board.translate(hp.x - 0.18, hp.y - 0.2, hp.z + 0.04)
      const mitt = new THREE.BoxGeometry(0.34, 0.46, 0.4)
      mitt.translate(hp.x, hp.y - 0.18, hp.z)
      b.add({ geo: board, role: 'pad', weights: only(hand) })
      b.add({ geo: mitt, role: 'gloves', weights: only(hand) })
    } else {
      const mitt = new THREE.BoxGeometry(0.36, 0.5, 0.42, 1, 2, 1)
      mitt.translate(hp.x, hp.y - 0.2, hp.z + 0.02)
      const cuff = new THREE.CylinderGeometry(0.23, 0.2, 0.34, 12)
      cuff.translate(hp.x, hp.y + 0.1, hp.z)
      b.add({ geo: mitt, role: 'gloves', weights: only(hand) })
      b.add({ geo: cuff, role: 'gloves', weights: only(hand) })
    }
  }

  // ── neck + head: face, helmet with an open front, visor / goalie mask ──
  const nk = rest.neck
  const neck = new THREE.CylinderGeometry(0.19, 0.22, 0.42, 12)
  neck.translate(nk.x, nk.y + 0.12, nk.z)
  b.add({ geo: neck, role: 'skin', weights: (p) => [['chest', 1 - smooth(nk.y, nk.y + 0.25, p.y)], ['neck', smooth(nk.y, nk.y + 0.25, p.y)]] })
  const hd = rest.head
  const face = new THREE.SphereGeometry(0.27, 16, 12)
  face.scale(0.86, 1.04, 0.94)
  face.translate(hd.x, hd.y + 0.25, hd.z + 0.05)
  b.add({ geo: face, role: 'skin', weights: only('head') })
  if (goalie) {
    const mask = new THREE.SphereGeometry(0.4, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.74)
    mask.scale(0.95, 1.08, 1.12)
    mask.translate(hd.x, hd.y + 0.28, hd.z + 0.02)
    b.add({ geo: mask, role: 'mask', weights: only('head') })
    const cage = new THREE.SphereGeometry(0.415, 14, 8, Math.PI * 0.2, Math.PI * 0.6, Math.PI * 0.36, Math.PI * 0.36)
    cage.scale(0.95, 1.08, 1.12)
    cage.translate(hd.x, hd.y + 0.28, hd.z + 0.02)
    b.add({ geo: cage, role: 'cage', weights: only('head') })
  } else {
    const crown = new THREE.SphereGeometry(0.36, 18, 6, 0, Math.PI * 2, 0, Math.PI * 0.3)
    const backShell = new THREE.SphereGeometry(0.36, 18, 6, Math.PI * 0.73, Math.PI * 1.54, Math.PI * 0.3, Math.PI * 0.38)
    for (const g of [crown, backShell]) {
      g.scale(0.96, 0.96, 1.1)
      g.translate(hd.x, hd.y + 0.3, hd.z - 0.02)
      b.add({ geo: g, role: 'helmet', weights: only('head') })
    }
    const visor = new THREE.CylinderGeometry(0.37, 0.365, 0.15, 16, 1, true, -Math.PI * 0.26, Math.PI * 0.52)
    visor.scale(0.96, 1, 1.1)
    visor.translate(hd.x, hd.y + 0.28, hd.z - 0.02)
    b.add({ geo: visor, role: 'visor', weights: only('head') })
  }

  // ── stick (shaft on `stick`, blade on `stick_blade`) ──
  if (goalie) {
    const shaft = new THREE.BoxGeometry(0.09, 2.6, 0.07)
    shaft.translate(0, 2.2 + 1.3, 0)
    const paddle = new THREE.BoxGeometry(0.22, 2.2, 0.08)
    paddle.translate(0, 1.1, 0)
    b.add({ geo: shaft, role: 'stick', weights: only('stick') })
    b.add({ geo: paddle, role: 'stick', weights: only('stick') })
    const blade = new THREE.BoxGeometry(1.5, 0.3, 0.06)
    blade.translate(0.72, 0.15, 0)
    b.add({ geo: blade, role: 'stick', weights: only('stick_blade') })
  } else {
    const shaft = new THREE.BoxGeometry(0.09, RIG.stickLen, 0.07)
    shaft.translate(0, RIG.stickLen / 2, 0)
    const knob = new THREE.BoxGeometry(0.11, 0.3, 0.09)
    knob.translate(0, RIG.stickLen - 0.15, 0)
    b.add({ geo: shaft, role: 'stick', weights: only('stick') })
    b.add({ geo: knob, role: 'tapeW', weights: only('stick') })
    const blade = new THREE.BoxGeometry(1.0, 0.24, 0.05)
    blade.translate(0.46, 0.12, 0)
    b.add({ geo: blade, role: 'tape', weights: only('stick_blade') })
  }

  return { geo: b.build(), roles: b.roles }
}

// ── Blender-authored body (scripts/blender → gltfAthlete.ts) ────────────────

const ROLE_SET = new Set(Object.keys(ROUGH))
const roughCache = new WeakMap<AthleteTemplate, THREE.BufferAttribute>()

/**
 * A rig geometry that SHARES the template's vertex buffers (positions,
 * normals, skin indices/weights, roughness) — the GPU keeps one copy of the
 * body per kind — and owns only its UVs (its jersey-atlas slot) and colours.
 */
export function templateGeometry(t: AthleteTemplate, slot: number): { geo: THREE.BufferGeometry; roles: Role[] } {
  const n = t.position.count
  const roles = t.roles.map((r) => (ROLE_SET.has(r) ? (r as Role) : 'jersey'))
  let rough = roughCache.get(t)
  if (!rough) {
    const a = new Float32Array(n)
    for (let i = 0; i < n; i++) a[i] = ROUGH[roles[i]!]
    rough = new THREE.BufferAttribute(a, 1)
    roughCache.set(t, rough)
  }
  const [cu, cv] = atlasOffset(slot)
  const whiteV = (ATLAS_REGIONS.white[0] + ATLAS_REGIONS.white[1]) / 2
  const uv = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    const atlas = roles[i] === 'jersey'
    const lu = atlas ? Math.min(0.998, Math.max(0.002, t.uvLocal[i * 2]!)) : 0.5
    const lv = atlas ? Math.min(0.998, Math.max(0.002, t.uvLocal[i * 2 + 1]!)) : whiteV
    uv[i * 2] = cu + lu / ATLAS_GRID
    uv[i * 2 + 1] = cv + lv / ATLAS_GRID
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', t.position)
  g.setAttribute('normal', t.normal)
  g.setAttribute('skinIndex', t.skinIndex)
  g.setAttribute('skinWeight', t.skinWeight)
  g.setAttribute('aRough', rough)
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  return { geo: g, roles }
}

/**
 * Geometry for an OWNER-supplied body (gltfAthlete OwnerAssets): shares the
 * template's buffers like templateGeometry, draws in material groups
 * (0 clothes, 1 gear, 2 visor). uv = the clothes vertices moved into this
 * player's kit-atlas slot (numbers/name are painted per slot), everything else
 * the owner's own UVs; uv1 = the owner's UVs everywhere (normal maps).
 */
export function ownerGeometry(t: AthleteTemplate, slot: number): THREE.BufferGeometry {
  const n = t.position.count
  const [cu, cv] = atlasOffset(slot)
  const uv = new Float32Array(t.uvLocal)
  for (const g of t.groups ?? []) {
    if (g.group !== 'clothes') continue
    for (let i = g.start; i < g.start + g.count; i++) {
      uv[i * 2] = cu + Math.min(0.998, Math.max(0.002, t.uvLocal[i * 2]!)) / ATLAS_GRID
      uv[i * 2 + 1] = cv + Math.min(0.998, Math.max(0.002, t.uvLocal[i * 2 + 1]!)) / ATLAS_GRID
    }
  }
  let uv1 = ownerUv1.get(t)
  if (!uv1) {
    uv1 = new THREE.BufferAttribute(t.uvLocal, 2)
    ownerUv1.set(t, uv1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', t.position)
  g.setAttribute('normal', t.normal)
  g.setAttribute('skinIndex', t.skinIndex)
  g.setAttribute('skinWeight', t.skinWeight)
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setAttribute('uv1', uv1)
  const order = ['clothes', 'gear', 'visor']
  for (const gr of t.groups ?? []) g.addGroup(gr.start, gr.count, order.indexOf(gr.group))
  void n
  return g
}
const ownerUv1 = new WeakMap<AthleteTemplate, THREE.BufferAttribute>()

/** Blade centre in the carry, root space (ft): forehand side (+X = his left), out front. Matches math.puckCarriedOffset. */
export const CARRY_BLADE = { x: 1.0, z: 4.1 }

/** Segment lengths the pose / IK maths uses (the owner's rig keeps its own proportions). */
export interface RigDims {
  upperArm: number
  forearm: number
  thigh: number
  shin: number
  /** Ankle-joint height above the ice at rest. */
  skate: number
  stickLen: number
}
const RIG_DIMS: RigDims = { upperArm: RIG.upperArm, forearm: RIG.forearm, thigh: RIG.thigh, shin: RIG.shin, skate: RIG.skate, stickLen: RIG.stickLen }

/** Rest offsets from a template's joints (every bone present), else null. */
function offsetsFromJoints(t: AthleteTemplate): Record<BoneName, [number, number, number]> | null {
  const j = t.joints
  if (!BONE_NAMES.every((b) => j[b])) return null
  const out = {} as Record<BoneName, [number, number, number]>
  for (const b of BONE_NAMES) {
    const p = PARENT[b]
    const v = j[b]!
    const q = p ? j[p]! : new THREE.Vector3()
    out[b] = [v.x - q.x, v.y - q.y, v.z - q.z]
  }
  return out
}

/**
 * Hooks a clip layer (animLayer.ts) uses to blend authored motion into the
 * procedural pose at the right points of AthleteRig.apply().
 */
export interface PoseOverlay {
  /** After the procedural body pose (torso, legs, hips) is written. */
  body(bones: Record<BoneName, THREE.Bone>): void
  /** After the procedural stick is placed, before the hands are solved onto it. */
  stick(bones: Record<BoneName, THREE.Bone>): void
  /** After the IK: the clips' own (baked) arm motion. */
  arms(bones: Record<BoneName, THREE.Bone>): void
  /** How strongly each hand must then be locked onto the shaft (0..1). */
  grip?(): { L: number; R: number }
}

// ── rig ─────────────────────────────────────────────────────────────────────

const _v = new THREE.Vector3()
const _w = new THREE.Vector3()
const _q0 = new THREE.Quaternion()
const _q1 = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _q3 = new THREE.Quaternion()
const HALF_TURN_Y = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)
const MIRROR_CENTRE = ['hips', 'spine', 'chest', 'neck', 'head'] as const
const MIRROR_PAIRS = (['shoulder', 'upperarm', 'forearm', 'hand', 'thigh', 'shin', 'foot'] as const).map((n) => [`${n}_L`, `${n}_R`] as [BoneName, BoneName])
const _u = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _inv = new THREE.Matrix4()
const UP = new THREE.Vector3(0, 1, 0)
const toV3 = (v: THREE.Vector3): V3 => ({ x: v.x, y: v.y, z: v.z })

const bladeCache = new WeakMap<THREE.BufferGeometry, { boneIndex: number; local: THREE.Vector3 } | null>()

/**
 * The blade's centre in the local frame of the bone that skins it, from the
 * bind pose: the stick's verts (weighted > 0.6 to `stick` / `stick_blade`)
 * within 0.3 ft of the stick's lowest point. Cached per geometry.
 */
export function bladeAnchor(mesh: THREE.SkinnedMesh): { bone: THREE.Bone; local: THREE.Vector3 } | null {
  const geo = mesh.geometry
  let hit = bladeCache.get(geo)
  if (hit === undefined) {
    hit = null
    const bones = mesh.skeleton.bones
    const stickIdx = new Set(bones.map((b, i) => (b.name === 'stick' || b.name === 'stick_blade' ? i : -1)).filter((i) => i >= 0))
    const P = geo.getAttribute('position')
    const J = geo.getAttribute('skinIndex')
    const W = geo.getAttribute('skinWeight')
    if (stickIdx.size && P && J && W) {
      const verts: Array<{ i: number; bone: number }> = []
      let minY = Infinity
      for (let i = 0; i < P.count; i++) {
        for (let c = 0; c < 4; c++) {
          const b = J.getComponent(i, c)
          if (stickIdx.has(b) && W.getComponent(i, c) > 0.6) {
            verts.push({ i, bone: b })
            // bind space = mesh space at bind; the blade is the stick's low end
            const y = new THREE.Vector3().fromBufferAttribute(P, i).applyMatrix4(mesh.bindMatrix).y
            if (y < minY) minY = y
            break
          }
        }
      }
      const v = new THREE.Vector3()
      const sum = new Map<number, { x: number; y: number; z: number; n: number }>()
      for (const { i, bone } of verts) {
        v.fromBufferAttribute(P, i).applyMatrix4(mesh.bindMatrix)
        if (v.y > minY + 0.3) continue
        const s = sum.get(bone) ?? { x: 0, y: 0, z: 0, n: 0 }
        s.x += v.x; s.y += v.y; s.z += v.z; s.n++
        sum.set(bone, s)
      }
      // the bone carrying most of the blade
      let best: [number, { x: number; y: number; z: number; n: number }] | null = null
      for (const e of sum) if (!best || e[1].n > best[1].n) best = e
      if (best && best[1].n > 0) {
        const [bi, s] = best
        // skinned world = bone.matrixWorld · boneInverse · bindMatrix · v  →  bone-local = boneInverse · (bindMatrix · v)
        const local = new THREE.Vector3(s.x / s.n, minY, s.z / s.n).applyMatrix4(mesh.skeleton.boneInverses[bi]!)
        hit = { boneIndex: bi, local }
      }
    }
    bladeCache.set(geo, hit)
  }
  return hit ? { bone: mesh.skeleton.bones[hit.boneIndex]!, local: hit.local } : null
}

export class AthleteRig {
  /** World placement (position, heading, bank). The skeleton hangs below. */
  readonly root = new THREE.Group()
  readonly bones = {} as Record<BoneName, THREE.Bone>
  readonly mesh: THREE.SkinnedMesh
  kit: Kit | null = null
  readonly skin: number
  readonly stickColor: number
  private readonly roles: Role[]

  /** True when the body is the Blender-authored mesh (template), false = procedural. */
  readonly authored: boolean

  /** Segment lengths for the IK / hip-height maths (the RIG constants unless the body is an owner import). */
  readonly dims: RigDims

  /** Where each glove's palm holds the shaft, in its hand bone's frame (zero = the wrist joint). */
  readonly gripPalm: Record<'L' | 'R', THREE.Vector3>

  constructor(readonly goalie: boolean, readonly slot: number, material: THREE.Material | THREE.Material[], template?: AthleteTemplate | null) {
    this.skin = SKIN_TONES[slot % SKIN_TONES.length]!
    this.stickColor = STICK_TONES[(slot * 7) % STICK_TONES.length]!
    // An owner body keeps its own proportions: rest offsets + segment lengths
    // come from its joints. (Blender/procedural bodies are built on RIG.)
    const ownOff = template?.groups ? offsetsFromJoints(template) : null
    const off = ownOff ?? restBoneOffsets(goalie)
    const len = (b: BoneName) => Math.hypot(...off[b])
    this.dims = ownOff
      ? { upperArm: len('forearm_L'), forearm: len('hand_L'), thigh: len('shin_L'), shin: len('foot_L'), skate: template!.joints.foot_L!.y, stickLen: template!.stickLen ?? RIG.stickLen }
      : RIG_DIMS
    this.gripPalm = { L: template?.grip?.L?.clone() ?? new THREE.Vector3(), R: template?.grip?.R?.clone() ?? new THREE.Vector3() }
    for (const name of BONE_NAMES) {
      const bone = new THREE.Bone()
      bone.name = name
      const o = off[name]
      bone.position.set(o[0], o[1], o[2])
      this.bones[name] = bone
    }
    for (const name of BONE_NAMES) {
      const parent = PARENT[name]
      if (parent) this.bones[parent].add(this.bones[name])
    }
    for (const n of ['thigh_L', 'thigh_R'] as const) this.bones[n].rotation.order = 'ZXY'
    for (const n of ['shin_L', 'shin_R'] as const) this.bones[n].rotation.order = 'YXZ'

    const { geo, roles } = template?.groups ? { geo: ownerGeometry(template, slot), roles: [] as Role[] } : template ? templateGeometry(template, slot) : buildBody(slot, goalie)
    this.authored = !!template
    this.roles = roles
    this.mesh = new THREE.SkinnedMesh(geo, material)
    this.mesh.name = goalie ? 'goalie' : 'skater'
    this.mesh.add(this.bones.root)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = false
    this.mesh.frustumCulled = false
    // A fixed bound (root space). Left null, three CPU-skins every vertex the
    // first time a rig is drawn (render-list sorting calls computeBoundingSphere):
    // 30–100 ms hitches whenever a line change brings a fresh rig on.
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3.2, 0), 6.5)
    this.mesh.boundingBox = new THREE.Box3(new THREE.Vector3(-6, -1, -6), new THREE.Vector3(6, 8, 6))
    this.root.add(this.mesh)
    this.root.updateMatrixWorld(true)
    this.mesh.bind(new THREE.Skeleton(BONE_NAMES.map((n) => this.bones[n])))
    this.root.rotation.order = 'YXZ'
    this.blade = bladeAnchor(this.mesh)
  }

  /**
   * Where the blade's middle really is, in the local frame of the bone that
   * skins it — measured once from the stick geometry (its lowest verts at bind),
   * so a carried puck can sit on the DRAWN blade whatever the rig's bone layout
   * (owner sticks skin the blade to `stick`, not `stick_blade`).
   */
  readonly blade: { bone: THREE.Bone; local: THREE.Vector3 } | null

  private readonly bladeTmp = new THREE.Vector3()
  /** The drawn blade's centre in world space (null if the rig has no stick). */
  bladeWorld(): THREE.Vector3 | null {
    if (!this.blade) return null
    this.blade.bone.updateWorldMatrix(true, false)
    return this.bladeTmp.copy(this.blade.local).applyMatrix4(this.blade.bone.matrixWorld)
  }

  get visible(): boolean {
    return this.root.visible
  }
  set visible(v: boolean) {
    this.root.visible = v
  }

  /** Write the kit into the vertex colours. */
  recolor(): void {
    const kit = this.kit
    const col = this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined
    if (!col) return // owner bodies: kit colours live in the textures
    const c = new THREE.Color()
    const padBase = 0xf2f2ee
    for (let i = 0; i < this.roles.length; i++) {
      const role = this.roles[i]!
      let hex = 0xffffff
      switch (role) {
        case 'jersey': hex = 0xffffff; break
        case 'pants': hex = kit ? kit.pants : 0x222222; break
        case 'helmet': hex = kit ? kit.helmet : 0x222222; break
        case 'gloves': hex = kit ? kit.gloves : 0x222222; break
        case 'visor': hex = 0x1a2128; break
        case 'skin': hex = this.skin; break
        case 'boot': hex = 0x15171a; break
        case 'steel': hex = 0xc9ced6; break
        case 'stick': hex = this.goalie ? 0xe6e6e2 : this.stickColor; break
        case 'tape': hex = 0x141517; break
        case 'tapeW': hex = 0xeeeeee; break
        case 'pad': hex = padBase; break
        case 'padTrim': hex = kit ? (kit.jersey === 0xf4f4f2 ? kit.trim : kit.jersey) : 0x444444; break
        case 'cage': hex = 0x2a2d33; break
        case 'mask': hex = kit ? new THREE.Color(kit.helmet).lerp(new THREE.Color(0xffffff), 0.35).getHex() : 0xffffff; break
      }
      c.setHex(hex)
      col.setXYZ(i, c.r, c.g, c.b)
    }
    col.needsUpdate = true
  }

  /**
   * Pose the skeleton.
   * @param wx,wz   world position   @param heading  yaw (rad)
   * @param stick   'carry' (blade on the ice at the puck spot), 'shoot'
   *                (0..1 swing progress), 'raise' (celebration)
   */
  apply(wx: number, wz: number, heading: number, pose: BodyPose, stick: { mode: 'carry' | 'shoot' | 'raise'; t?: number }, overlay?: PoseOverlay | null): void {
    const B = this.bones
    const r = this.root
    r.position.set(wx, 0, wz)
    r.rotation.set(0, heading, -pose.bodyRoll)
    // the pose's hip height assumes RIG leg lengths; re-solve it for this body's
    let hipY = pose.hipHeight
    const d = this.dims
    if (d !== RIG_DIMS) {
      const rig = Math.max(legDrop(pose.left), legDrop(pose.right)) + RIG.skate
      const own = Math.max(legDrop(pose.left, d.thigh, d.shin), legDrop(pose.right, d.thigh, d.shin)) + d.skate
      hipY += own - rig
    }
    B.hips.position.set(0, hipY, 0)
    // bones only clips rotate: back to rest every frame (the code never sets them)
    B.hips.quaternion.identity()
    B.shoulder_L.quaternion.identity()
    B.shoulder_R.quaternion.identity()
    B.hand_L.quaternion.identity()
    B.hand_R.quaternion.identity()
    B.spine.rotation.set(pose.lean * 0.8, pose.torsoYaw * 0.6, -pose.torsoRoll)
    B.chest.rotation.set(pose.lean * 0.2, pose.torsoYaw * 0.4, 0)
    B.neck.rotation.set(-pose.lean * 0.45, -pose.torsoYaw * 0.4, 0)
    B.head.rotation.set(-pose.lean * 0.35, -pose.torsoYaw * 0.3, 0)
    const legs: Array<[THREE.Bone, THREE.Bone, THREE.Bone, BodyPose['left'], 1 | -1]> = [
      [B.thigh_L, B.shin_L, B.foot_L, pose.left, 1],
      [B.thigh_R, B.shin_R, B.foot_R, pose.right, -1],
    ]
    for (const [thigh, shin, foot, leg, side] of legs) {
      thigh.rotation.set(-leg.flex, 0, side * leg.abduct)
      shin.rotation.set(leg.knee, -side * leg.splay, 0)
      foot.rotation.set(-leg.ankle, 0, 0)
    }
    overlay?.body(B)
    r.updateMatrixWorld(true)
    // ── hands & stick, solved in root space ──
    _inv.copy(r.matrixWorld).invert()
    // the arm chain starts at the upper-arm joint (== the shoulder bone on RIG bodies)
    const shL = toV3(B.upperarm_L.getWorldPosition(_v).applyMatrix4(_inv))
    const shR = toV3(B.upperarm_R.getWorldPosition(_w).applyMatrix4(_inv))

    let heel: V3
    let shaftDir: V3
    let bladeDir: V3
    let topGrip: number
    let lowGrip: number
    let handL: V3
    let handR: V3
    if (this.goalie) {
      heel = { x: -0.62, y: 0.02, z: 1.6 }
      bladeDir = { x: 1, y: 0, z: 0.05 }
      const top = { x: -1.0, y: hipY + 0.45, z: 1.25 }
      shaftDir = norm(sub3(top, heel))
      topGrip = Math.min(len3(sub3(top, heel)), 3.9)
      lowGrip = topGrip
      handR = add3(heel, scale3(shaftDir, topGrip))
      handL = { x: 1.2, y: hipY + 0.7, z: 1.25 } // catcher open at the side
    } else if (stick.mode === 'raise') {
      const top = { x: shR.x - 0.1, y: shR.y + 1.3, z: shR.z + 0.5 }
      shaftDir = norm({ x: -0.25, y: -1, z: -0.3 })
      heel = add3(top, scale3(shaftDir, -3.9))
      bladeDir = { x: 1, y: 0, z: 0 }
      topGrip = 3.9
      lowGrip = 3.1
      handR = add3(heel, scale3(shaftDir, topGrip))
      handL = add3(heel, scale3(shaftDir, lowGrip))
    } else {
      // carry / shoot: blade centred on the puck spot (math.puckCarriedOffset):
      // a real carry — blade flat on the ice ~3.7 ft out front on the forehand
      // side, stick at a ~45° lie, top hand at the hip/waist out in front,
      // bottom hand a third of the way down the shaft, arms reaching forward
      let bz = CARRY_BLADE.z
      let by = 0.02
      const t = stick.mode === 'shoot' ? (stick.t ?? 0) : -1
      if (t >= 0) {
        if (t < 0.45) {
          const k = t / 0.45
          bz = CARRY_BLADE.z - 2.9 * k
          by = 0.02 + 0.9 * k
        } else {
          const k = (t - 0.45) / 0.55
          bz = 0.8 + 4.0 * k
          by = 0.92 + 0.6 * k
        }
      }
      bladeDir = norm({ x: 1, y: 0, z: 0.28 })
      const mid = { x: CARRY_BLADE.x + pose.stickSway, y: by, z: bz }
      heel = add3(mid, scale3(bladeDir, -0.45))
      // top hand in front of the right hip (he shoots left), ahead of the
      // chest; if the bottom hand (a third of the way down) can't reach the
      // shaft from there, the top hand eases up / forward / toward the middle
      // just enough (bisection → continuous, no pops) — both hands stay on
      const reachL = (this.dims.upperArm + this.dims.forearm) * 0.97
      const T0 = { x: shR.x * 0.6, y: hipY + 0.2, z: Math.max(1.0, shR.z + 0.7) }
      const T1 = { x: shR.x * 0.3, y: hipY + 0.45, z: Math.max(1.3, shR.z + 1.2) }
      const lowOk = (k: number): boolean => {
        const t = add3(T0, scale3(sub3(T1, T0), k))
        const dd = sub3(t, heel)
        const g = Math.min(len3(dd), this.dims.stickLen - 0.25) * 0.66
        // (the bottom hand may also slide up to ~⅕ below the top: gripOnShaft)
        const g2 = Math.min(len3(dd), this.dims.stickLen - 0.25) * 0.82
        return len3(sub3(add3(heel, scale3(norm(dd), g)), shL)) <= reachL || len3(sub3(add3(heel, scale3(norm(dd), g2)), shL)) <= reachL
      }
      let kk = 0
      if (!lowOk(0)) {
        let lo = 0
        let hi = 1
        for (let it = 0; it < 10; it++) {
          const m = (lo + hi) / 2
          if (lowOk(m)) hi = m
          else lo = m
        }
        kk = hi
      }
      const top = add3(T0, scale3(sub3(T1, T0), kk))
      // the top hand holds the KNOB (no stick poking up past the hand like a
      // cane): slide the blade out along the ice until the shaft is full length
      const full = this.dims.stickLen - 0.25
      {
        const dd = sub3(top, heel)
        const hx = heel.x - top.x
        const hz = heel.z - top.z
        const hl = Math.hypot(hx, hz)
        if (len3(dd) < full && hl > 1e-3 && full > Math.abs(dd.y)) {
          const want = Math.sqrt(full * full - dd.y * dd.y)
          heel = { x: top.x + (hx / hl) * want, y: heel.y, z: top.z + (hz / hl) * want }
        }
      }
      const d = sub3(top, heel)
      shaftDir = norm(d)
      topGrip = Math.min(len3(d), this.dims.stickLen - 0.25)
      lowGrip = topGrip * 0.66
      handR = add3(heel, scale3(shaftDir, topGrip))
      handL = add3(heel, scale3(shaftDir, lowGrip))
    }

    B.stick.position.set(heel.x, heel.y, heel.z)
    B.stick.quaternion.setFromUnitVectors(UP, _v.set(shaftDir.x, shaftDir.y, shaftDir.z))
    B.stick_blade.position.set(heel.x, heel.y, heel.z)
    B.stick_blade.rotation.set(0, Math.atan2(-bladeDir.z, bladeDir.x), 0)
    if (overlay) {
      // a clip may move the stick: re-derive the grips along wherever it now is
      overlay.stick(B)
      heel = toV3(B.stick.position)
      shaftDir = toV3(_v.copy(UP).applyQuaternion(B.stick.quaternion))
      handR = add3(heel, scale3(shaftDir, topGrip))
      if (!this.goalie) handL = add3(heel, scale3(shaftDir, lowGrip))
    }
    // Keep both hands ON the shaft: a grip the arm can't reach (short owner
    // arms, a clip moving the stick) slides along the shaft to the nearest
    // reachable point; if the shaft is out of reach altogether the stick comes
    // to the top hand (never the hand off the stick).
    const reach = (this.dims.upperArm + this.dims.forearm) * 0.985
    const top = gripOnShaft(heel, shaftDir, shR, topGrip, reach, topGrip * 0.7, topGrip)
    if (top.shift) {
      heel = add3(heel, top.shift)
      B.stick.position.set(heel.x, heel.y, heel.z)
      B.stick_blade.position.add(_v.set(top.shift.x, top.shift.y, top.shift.z))
    }
    handR = add3(heel, scale3(shaftDir, top.t))
    if (!this.goalie) {
      const low = gripOnShaft(heel, shaftDir, shL, lowGrip, reach, lowGrip * 0.8, top.t - 0.25)
      handL = add3(heel, scale3(shaftDir, low.t))
    }
    B.stick.updateMatrixWorld(true)
    B.stick_blade.updateMatrixWorld(true)

    this.placeArm(shL, handL, B.upperarm_L, B.forearm_L, 1)
    this.placeArm(shR, handR, B.upperarm_R, B.forearm_R, -1)
    if (overlay) {
      overlay.arms(B)
      r.updateMatrixWorld(true)
      const g = !this.goalie && overlay.grip ? overlay.grip() : null
      if (g && (g.L > 0.001 || g.R > 0.001)) this.lockGrips(g)
    }
    if (this.rightHanded) {
      this.mirrorPose()
      r.updateMatrixWorld(true)
    }
  }

  /**
   * Shoots RIGHT (player handedness 'R'): every clip and the code pose are
   * authored left-handed, so the finished pose is MIRRORED across his own
   * sagittal plane — never the mesh (scale.x = −1 would mirror the jersey
   * numbers and flip the winding). With rest frames that are identity and a
   * symmetric skeleton, the mirror of a local rotation (x, y, z, w) is
   * (x, −y, −z, w) on the partner bone; the stick turns a half-turn about its
   * own shaft as well, so the blade's toe points out on the right. Top hand =
   * hand_L, blade on his right.
   */
  private mirrorPose(): void {
    const B = this.bones
    const mq = (q: THREE.Quaternion) => q.set(q.x, -q.y, -q.z, q.w)
    for (const n of MIRROR_CENTRE) mq(B[n].quaternion)
    for (const [a, b] of MIRROR_PAIRS) {
      _q0.copy(B[a].quaternion)
      B[a].quaternion.copy(B[b].quaternion)
      mq(B[a].quaternion)
      B[b].quaternion.copy(_q0)
      mq(B[b].quaternion)
    }
    B.hips.position.x = -B.hips.position.x
    for (const n of ['stick', 'stick_blade'] as const) {
      mq(B[n].quaternion).multiply(HALF_TURN_Y)
      B[n].position.x = -B[n].position.x
    }
  }

  /** Right-handed shooter: the pose is mirrored (see mirrorPose). */
  rightHanded = false

  /** The hand at the top of the stick (the grip the stick pivots about). */
  get topHand(): THREE.Bone {
    return this.rightHanded ? this.bones.hand_L : this.bones.hand_R
  }

  /** +1 when the blade is on his left (shoots left), −1 on his right. */
  get bladeSide(): 1 | -1 {
    return this.rightHanded ? -1 : 1
  }

  /**
   * Lock the gripping hands onto the shaft: each clip's baked arms were solved
   * with the hands on ITS stick, but the body under them (skating hips, a
   * blended torso) moves the shoulders a little. The palm point is projected
   * onto the shaft and the arm re-solved to reach it, with the clip's own elbow
   * as the pole (the bend stays the clip's), blended by the clip's weight.
   */
  private lockGrips(w: { L: number; R: number }): void {
    const B = this.bones
    const r = this.root
    _inv.copy(r.matrixWorld).invert()
    const heel = B.stick.getWorldPosition(new THREE.Vector3()).applyMatrix4(_inv)
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(B.stick.quaternion).normalize()
    const len = this.dims.stickLen
    for (const h of ['R', 'L'] as const) {
      const k = w[h]
      if (k <= 0.001) continue
      const upper = B[`upperarm_${h}`]
      const fore = B[`forearm_${h}`]
      const hand = B[`hand_${h}`]
      for (let it = 0; it < 3; it++) {
        const S = upper.getWorldPosition(new THREE.Vector3()).applyMatrix4(_inv)
        const E = fore.getWorldPosition(new THREE.Vector3()).applyMatrix4(_inv)
        const Wr = hand.getWorldPosition(new THREE.Vector3()).applyMatrix4(_inv)
        const P = hand.localToWorld(_v.copy(this.gripPalm[h])).applyMatrix4(_inv)
        // the nearest point of the shaft to the palm — or, when the body under
        // the clip has moved the shoulder out of reach of it, the nearest point
        // that shoulder CAN reach (the hand slides along the shaft)
        const want = Math.min(len - 0.1, Math.max(0.3, _w.copy(P).sub(heel).dot(dir)))
        // (the palm sits past the wrist, but not along the arm: count the arm alone)
        const palmReach = (this.dims.upperArm + this.dims.forearm) * 0.95
        const g = gripOnShaft(toV3(heel), toV3(dir), toV3(S), want, palmReach, 0.3, len - 0.1)
        const t = g.t
        const G = heel.clone().addScaledVector(dir, t)
        const delta = G.sub(P)
        if (delta.lengthSq() < 1e-4) break
        const target = Wr.addScaledVector(delta, k)
        const { elbow, hand: hp } = solveTwoBone(toV3(S), toV3(target), this.dims.upperArm, this.dims.forearm, toV3(E))
        this.aimArm(upper, fore, toV3(S), elbow, hp, toV3(E))
      }
    }
  }

  /** Two-bone IK → bone-local rotations (bones keep their fixed lengths). */
  private placeArm(sh: V3, target: V3, upper: THREE.Bone, fore: THREE.Bone, side: 1 | -1): void {
    // elbows out and down, not tucked back: the arms reach forward to the stick
    const pole = { x: sh.x + side * 1.5, y: sh.y - 1.3, z: sh.z + 0.2 }
    const { elbow, hand } = solveTwoBone(sh, target, this.dims.upperArm, this.dims.forearm, pole)
    this.aimArm(upper, fore, sh, elbow, hand, pole)
  }

  /**
   * Upper arm + forearm as a HINGE (posekit.arm_frames, same maths): each
   * bone's −Y runs along it, the elbow bends about their shared local X and the
   * forearm swings toward local +Z — where the elbow crease faces at rest. A
   * shortest-arc aim gives the upper arm an arbitrary twist, so the skinned
   * elbow bent sideways or backwards.
   */
  private aimArm(upper: THREE.Bone, fore: THREE.Bone, sh: V3, elbow: V3, hand: V3, pole: V3): void {
    const u = norm(sub3(elbow, sh))
    const f = norm(sub3(hand, elbow))
    let z = sub3(f, scale3(u, dot3(f, u)))
    if (len3(z) < 1e-3) {
      const pv = sub3(pole, sh)
      z = scale3(sub3(pv, scale3(u, dot3(pv, u))), -1)
      if (len3(z) < 1e-6) z = sub3({ x: 0, y: 0, z: 1 }, scale3(u, u.z))
    }
    z = norm(z)
    const y = scale3(u, -1)
    const x = norm(cross3(y, z))
    const y2 = scale3(f, -1)
    const z2 = norm(cross3(x, y2))
    const Wu = _q0.setFromRotationMatrix(_m.makeBasis(_v.set(x.x, x.y, x.z), _w.set(y.x, y.y, y.z), _u.set(z.x, z.y, z.z)))
    const Wf = _q1.setFromRotationMatrix(_m.makeBasis(_v.set(x.x, x.y, x.z), _w.set(y2.x, y2.y, y2.z), _u.set(z2.x, z2.y, z2.z)))
    // shoulder orientation in root space
    const rootQ = this.root.getWorldQuaternion(_q2).invert()
    const parentRoot = rootQ.multiply(upper.parent!.getWorldQuaternion(_q3))
    upper.quaternion.copy(parentRoot.invert().multiply(Wu))
    fore.quaternion.copy(Wu.invert().multiply(Wf))
    upper.updateMatrixWorld(true)
  }
}

/**
 * The grip parameter (ft along the shaft from the heel) nearest `want` that a
 * shoulder at `sh` can reach, clamped to [lo, hi]. When no point of the shaft
 * is in reach, `shift` moves the stick perpendicular to itself just into reach.
 */
export function gripOnShaft(heel: V3, dir: V3, sh: V3, want: number, reach: number, lo: number, hi: number): { t: number; shift: V3 | null } {
  const d = sub3(sh, heel)
  const tc = d.x * dir.x + d.y * dir.y + d.z * dir.z
  const perp = sub3(d, scale3(dir, tc))
  const dist = len3(perp)
  const clamp = (x: number) => Math.min(hi, Math.max(lo, x))
  if (dist >= reach) {
    // no point of the shaft is in reach: bring the grip point to the shoulder
    const t = clamp(tc)
    const toSh = sub3(sh, add3(heel, scale3(dir, t)))
    const L = len3(toSh)
    return { t, shift: scale3(toSh, (L - reach * 0.98) / (L || 1)) }
  }
  const half = Math.sqrt(reach * reach - dist * dist)
  const t = Math.min(tc + half, Math.max(tc - half, want))
  const tt = clamp(t)
  if (Math.abs(tt - tc) <= half + 1e-6) return { t: tt, shift: null }
  // the clamp pushed the grip out of reach again: bring that point of the
  // shaft to the edge of the reach sphere (straight toward the shoulder)
  const p = add3(heel, scale3(dir, tt))
  const toSh = sub3(sh, p)
  const L = len3(toSh)
  return { t: tt, shift: scale3(toSh, (L - reach * 0.98) / (L || 1)) }
}

const sub3 = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const add3 = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const scale3 = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k })
const len3 = (a: V3) => Math.hypot(a.x, a.y, a.z)
const dot3 = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z
const cross3 = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
const norm = (a: V3): V3 => {
  const l = len3(a) || 1
  return { x: a.x / l, y: a.y / l, z: a.z / l }
}

// ── the set of on-ice players ───────────────────────────────────────────────

/** One shared material: atlas × vertex colour, per-vertex roughness. */
export function athleteMaterial(atlasTex: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: atlasTex, vertexColors: true, roughness: 1, metalness: 0 })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRough;\nvarying float vRough;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvRough = aRough;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRough;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n\troughnessFactor *= vRough;')
  }
  m.customProgramCacheKey = () => 'athlete-v2'
  return m
}

/** Owns every rig; kept API-compatible with the renderer (group/applyColors/sync). */
export class AthleteBatch {
  readonly group = new THREE.Group()
  readonly material: THREE.MeshStandardMaterial

  constructor(readonly rigs: AthleteRig[], material: THREE.MeshStandardMaterial) {
    this.material = material
    for (const r of rigs) this.group.add(r.root)
  }

  /** (Re)apply kit colours to every player. Call after kits change. */
  applyColors(): void {
    for (const r of this.rigs) r.recolor()
  }

  /** Skinned meshes update from their bones at render time — nothing to copy. */
  sync(): void {}

  /** Draw calls this set issues per pass (one per player). */
  get drawCalls(): number {
    return this.rigs.length
  }

  dispose(): void {
    for (const r of this.rigs) {
      r.mesh.geometry.dispose()
      r.mesh.skeleton.dispose()
    }
    this.material.dispose()
  }
}
