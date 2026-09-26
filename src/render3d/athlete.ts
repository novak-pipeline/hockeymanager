/**
 * Procedural athletes — a jointed rig per player (plain Object3D nodes, never
 * rendered) + ONE InstancedMesh per body-part type shared by every player on
 * the ice. Each frame the rigs are posed from pose.ts, and each part's
 * instance matrix is copied from its rig node. ~20 draw calls for all 14
 * players (the old primitive skaters were ~15 meshes EACH).
 *
 * Team identity comes from two channels:
 *   - instanceColor (pants, helmet, gloves, pads) from the kit palette
 *   - a 4×4 jersey atlas (sweater, sleeves, socks, NUMBER) — one slot per rig,
 *     selected per instance by an `aAtlas` attribute injected into the shader.
 */

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RIG, solveTwoBone, type BodyPose, type V3 } from './pose'
import { ATLAS_GRID, ATLAS_REGIONS, atlasOffset } from './textures'
import type { Kit } from './palette'

// ── part catalogue ──────────────────────────────────────────────────────────

type PartKey =
  | 'pelvis' | 'torso' | 'thigh' | 'shin' | 'skate' | 'face' | 'helmet' | 'visor'
  | 'upperArm' | 'forearm' | 'glove' | 'shaft' | 'blade'
  | 'gPelvis' | 'gTorso' | 'gThigh' | 'gPad' | 'gMask' | 'gCage' | 'gCatcher' | 'gBlocker' | 'gShaft' | 'gBlade'

type ColorFrom = keyof Kit | 'skin' | 'stick' | 'pad' | 'mask' | null

interface PartDef {
  geo: THREE.BufferGeometry
  mat: THREE.Material
  atlas: boolean
  color: ColorFrom
  cast: boolean
}

/** Remap a geometry's UV v into [v0, v1] (atlas sub-region). */
function remapV(geo: THREE.BufferGeometry, v0: number, v1: number): THREE.BufferGeometry {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * (v1 - v0))
  uv.needsUpdate = true
  return geo
}

function lathe(profile: Array<[number, number]>, segs: number, depthScale: number): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs)
  g.scale(1, 1, depthScale)
  // Lathe v runs along the profile's point index; normalise to 0..1 by height
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const uv = g.getAttribute('uv') as THREE.BufferAttribute
  const ys = profile.map((p) => p[1])
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  for (let i = 0; i < uv.count; i++) uv.setY(i, (pos.getY(i) - y0) / (y1 - y0))
  return g
}

/** Cylinder hanging from its origin along −Y (length L). */
function limb(rTop: number, rBot: number, L: number, radial = 10): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, L, radial, 1, false)
  g.translate(0, -L / 2, 0)
  return g
}

function colored(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex)
  const n = g.getAttribute('position').count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return g
}

function nonIndexed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return g.index ? g.toNonIndexed() : g
}

function atlasMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.78, metalness: 0 })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aAtlas;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv = vMapUv * ${(1 / ATLAS_GRID).toFixed(4)} + aAtlas;\n#endif`
      )
  }
  m.customProgramCacheKey = () => 'jersey-atlas'
  return m
}

function buildParts(atlasTex: THREE.Texture): Record<PartKey, PartDef> {
  const jersey = atlasMaterial(atlasTex)
  const cloth = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72 })
  const shell = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0.05 })
  const skin = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62 })
  const visor = new THREE.MeshStandardMaterial({ color: 0x1b232c, roughness: 0.22, metalness: 0.2, transparent: true, opacity: 0.5 })
  const glove = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82 })
  const skateM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.35 })
  const stick = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 })
  const tape = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9 })
  const cage = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.45, metalness: 0.6 })

  const T = ATLAS_REGIONS

  // Skater torso: waist → shoulder pads → collar (front = +Z, u = 0).
  const torso = remapV(
    lathe(
      [[0.001, -0.18], [0.62, -0.18], [0.6, 0.25], [0.66, 0.75], [0.76, 1.25], [0.82, 1.55], [0.8, 1.78], [0.6, 1.95], [0.3, 2.04], [0.19, 2.08], [0.001, 2.1]],
      22,
      0.7
    ),
    T.torso[0],
    T.torso[1]
  )
  const gTorso = remapV(
    lathe(
      [[0.001, -0.25], [0.78, -0.25], [0.82, 0.3], [0.88, 0.85], [0.98, 1.3], [1.06, 1.6], [1.02, 1.82], [0.72, 1.98], [0.32, 2.06], [0.2, 2.1], [0.001, 2.12]],
      22,
      0.78
    ),
    T.torso[0],
    T.torso[1]
  )
  const pelvis = lathe([[0.001, 0.45], [0.6, 0.45], [0.68, 0.1], [0.72, -0.3], [0.66, -0.58], [0.001, -0.58]], 16, 0.82)
  const gPelvis = lathe([[0.001, 0.45], [0.72, 0.45], [0.8, 0.1], [0.84, -0.3], [0.78, -0.62], [0.001, -0.62]], 16, 0.85)

  const thigh = limb(0.3, 0.25, RIG.thigh)
  const gThigh = limb(0.36, 0.3, RIG.thigh)
  const shin = remapV(limb(0.19, 0.15, RIG.shin), T.sock[0], T.sock[1])
  // Goalie pad: tall block in front of the shin, knee roll on top.
  const padBody = new THREE.BoxGeometry(0.82, RIG.shin + 0.55, 0.5)
  padBody.translate(0, -RIG.shin / 2 + 0.2, 0.18)
  const kneeRoll = new THREE.CylinderGeometry(0.2, 0.2, 0.82, 10)
  kneeRoll.rotateZ(Math.PI / 2)
  kneeRoll.translate(0, 0.42, 0.34)
  const gPad = mergeGeometries([nonIndexed(padBody), nonIndexed(kneeRoll)])!

  // Skate: black boot + steel runner, bottom of blade at −RIG.skate.
  const boot = new THREE.BoxGeometry(0.34, 0.3, 0.9)
  boot.translate(0, -0.14, 0.16)
  const toe = new THREE.CylinderGeometry(0.17, 0.17, 0.3, 10, 1, false, 0, Math.PI)
  toe.translate(0, -0.14, 0.61)
  const runner = new THREE.BoxGeometry(0.035, 0.09, 1.02)
  runner.translate(0, -RIG.skate + 0.045, 0.15)
  const skate = mergeGeometries([
    colored(nonIndexed(boot), 0x16181c),
    colored(nonIndexed(toe), 0x16181c),
    colored(nonIndexed(runner), 0xc9ced6),
  ])!

  // Head (node origin = base of skull): face + helmet shell + visor.
  const face = new THREE.SphereGeometry(0.3, 14, 10)
  face.scale(0.92, 1.05, 1)
  face.translate(0, 0.3, 0.02)
  // Helmet: full crown + sides/back with the face left open (SphereGeometry
  // phi = π/2 is the +Z front), so a front-on player shows a face, not a ball.
  const crown = new THREE.SphereGeometry(0.36, 16, 5, 0, Math.PI * 2, 0, Math.PI * 0.3)
  const helmetBack = new THREE.SphereGeometry(0.36, 16, 6, Math.PI * 0.84, Math.PI * 1.32, Math.PI * 0.3, Math.PI * 0.32)
  const helmet = mergeGeometries([nonIndexed(crown), nonIndexed(helmetBack)])!
  helmet.scale(0.95, 0.95, 1.08)
  helmet.translate(0, 0.31, -0.02)
  const visorG = new THREE.CylinderGeometry(0.37, 0.37, 0.2, 14, 1, true, -Math.PI * 0.32, Math.PI * 0.64)
  visorG.scale(0.95, 1, 1.08)
  visorG.translate(0, 0.3, 0)
  const gMask = new THREE.SphereGeometry(0.38, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.72)
  gMask.scale(0.95, 1.05, 1.1)
  gMask.translate(0, 0.28, 0)
  // Cage window on the front of the mask (SphereGeometry: phi = π/2 is +Z).
  const gCage = new THREE.SphereGeometry(0.4, 12, 6, Math.PI * 0.22, Math.PI * 0.56, Math.PI * 0.38, Math.PI * 0.34)
  gCage.scale(0.95, 1.05, 1.1)
  gCage.translate(0, 0.28, 0.01)

  const upperArm = remapV(limb(0.2, 0.16, RIG.upperArm), T.upperArm[0], T.upperArm[1])
  const forearm = remapV(limb(0.17, 0.14, RIG.forearm), T.forearm[0], T.forearm[1])
  // Glove at the hand node, pointing along −Y (continuing the forearm).
  const gloveG = new THREE.BoxGeometry(0.3, 0.42, 0.34)
  gloveG.translate(0, -0.12, 0)
  const cuff = new THREE.CylinderGeometry(0.2, 0.17, 0.26, 10)
  cuff.translate(0, 0.12, 0)
  const gloveMerged = mergeGeometries([nonIndexed(gloveG), nonIndexed(cuff)])!
  // Catch glove: big pocket disc; blocker: flat board.
  const catcher = new THREE.CylinderGeometry(0.55, 0.5, 0.2, 16)
  catcher.rotateZ(Math.PI / 2)
  catcher.translate(0.05, -0.2, 0.1)
  const blocker = new THREE.BoxGeometry(0.1, 0.95, 0.6)
  blocker.translate(-0.12, -0.2, 0.05)

  // Stick shaft along +Y from the heel; blade along +X, upright.
  const shaft = new THREE.BoxGeometry(0.09, RIG.stickLen, 0.07)
  shaft.translate(0, RIG.stickLen / 2, 0)
  const blade = new THREE.BoxGeometry(1.0, 0.22, 0.05)
  blade.translate(0.46, 0.11, 0)
  const gShaft = mergeGeometries([
    nonIndexed((() => { const g = new THREE.BoxGeometry(0.09, 4.3, 0.07); g.translate(0, 2.6, 0); return g })()),
    nonIndexed((() => { const g = new THREE.BoxGeometry(0.2, 2.1, 0.08); g.translate(0, 1.05, 0); return g })()),
  ])!
  const gBlade = new THREE.BoxGeometry(1.5, 0.3, 0.06)
  gBlade.translate(0.7, 0.15, 0)

  return {
    pelvis: { geo: pelvis, mat: cloth, atlas: false, color: 'pants', cast: true },
    torso: { geo: torso, mat: jersey, atlas: true, color: null, cast: true },
    thigh: { geo: thigh, mat: cloth, atlas: false, color: 'pants', cast: true },
    shin: { geo: shin, mat: jersey, atlas: true, color: null, cast: true },
    skate: { geo: skate, mat: skateM, atlas: false, color: null, cast: true },
    face: { geo: face, mat: skin, atlas: false, color: 'skin', cast: false },
    helmet: { geo: helmet, mat: shell, atlas: false, color: 'helmet', cast: true },
    visor: { geo: visorG, mat: visor, atlas: false, color: null, cast: false },
    upperArm: { geo: upperArm, mat: jersey, atlas: true, color: null, cast: true },
    forearm: { geo: forearm, mat: jersey, atlas: true, color: null, cast: true },
    glove: { geo: gloveMerged, mat: glove, atlas: false, color: 'gloves', cast: true },
    shaft: { geo: shaft, mat: stick, atlas: false, color: 'stick', cast: true },
    blade: { geo: blade, mat: tape, atlas: false, color: null, cast: true },
    gPelvis: { geo: gPelvis, mat: cloth, atlas: false, color: 'pants', cast: true },
    gTorso: { geo: gTorso, mat: jersey, atlas: true, color: null, cast: true },
    gThigh: { geo: gThigh, mat: cloth, atlas: false, color: 'pants', cast: true },
    gPad: { geo: gPad, mat: cloth, atlas: false, color: 'pad', cast: true },
    gMask: { geo: gMask, mat: shell, atlas: false, color: 'mask', cast: true },
    gCage: { geo: gCage, mat: cage, atlas: false, color: null, cast: false },
    gCatcher: { geo: catcher, mat: glove, atlas: false, color: 'pad', cast: true },
    gBlocker: { geo: blocker, mat: glove, atlas: false, color: 'pad', cast: true },
    gShaft: { geo: gShaft, mat: stick, atlas: false, color: 'pad', cast: true },
    gBlade: { geo: gBlade, mat: stick, atlas: false, color: 'pad', cast: true },
  }
}

// ── rig ─────────────────────────────────────────────────────────────────────

interface Binding {
  rig: AthleteRig
  node: THREE.Object3D
}

const SKIN_TONES = [0xe0b79a, 0xc99a7a, 0xf1c9a9, 0xa8795a, 0xd9a887, 0x8a5a3c]
const STICK_TONES = [0x16181b, 0x16181b, 0xe8e8e6, 0x3a3f46, 0x16181b, 0x9a1f24]

const _v = new THREE.Vector3()
const _w = new THREE.Vector3()
const _inv = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const DOWN = new THREE.Vector3(0, -1, 0)
const toV3 = (v: THREE.Vector3): V3 => ({ x: v.x, y: v.y, z: v.z })

export class AthleteRig {
  readonly root = new THREE.Object3D()
  readonly hips = new THREE.Object3D()
  readonly torso = new THREE.Object3D()
  readonly head = new THREE.Object3D()
  readonly hipL = new THREE.Object3D()
  readonly hipR = new THREE.Object3D()
  readonly kneeL = new THREE.Object3D()
  readonly kneeR = new THREE.Object3D()
  readonly ankleL = new THREE.Object3D()
  readonly ankleR = new THREE.Object3D()
  readonly upperL = new THREE.Object3D()
  readonly upperR = new THREE.Object3D()
  readonly foreL = new THREE.Object3D()
  readonly foreR = new THREE.Object3D()
  readonly handL = new THREE.Object3D()
  readonly handR = new THREE.Object3D()
  readonly shaft = new THREE.Object3D()
  readonly blade = new THREE.Object3D()
  readonly shoulderL = new THREE.Object3D()
  readonly shoulderR = new THREE.Object3D()
  /** Hidden rigs write zero-scale instance matrices. */
  visible = true
  kit: Kit | null = null
  readonly skin: number
  readonly stickColor: number

  constructor(readonly goalie: boolean, readonly slot: number) {
    const r = this.root
    r.rotation.order = 'YXZ'
    r.add(this.hips, this.upperL, this.upperR, this.foreL, this.foreR, this.handL, this.handR, this.shaft, this.blade)
    this.hips.add(this.torso, this.hipL, this.hipR)
    this.torso.position.y = 0.32
    this.torso.add(this.head, this.shoulderL, this.shoulderR)
    this.head.position.set(0, 2.0 + RIG.neck, 0.1)
    const sw = goalie ? 0.95 : RIG.shoulderHalfWidth
    this.shoulderL.position.set(sw, 1.68, 0.02)
    this.shoulderR.position.set(-sw, 1.68, 0.02)
    this.hipL.position.set(RIG.hipHalfWidth, -0.12, 0)
    this.hipR.position.set(-RIG.hipHalfWidth, -0.12, 0)
    for (const h of [this.hipL, this.hipR]) h.rotation.order = 'ZXY'
    this.hipL.add(this.kneeL)
    this.hipR.add(this.kneeR)
    for (const k of [this.kneeL, this.kneeR]) {
      k.position.y = -RIG.thigh
      k.rotation.order = 'YXZ'
    }
    this.kneeL.add(this.ankleL)
    this.kneeR.add(this.ankleR)
    this.ankleL.position.y = -RIG.shin
    this.ankleR.position.y = -RIG.shin
    this.torso.rotation.order = 'XYZ'
    this.skin = SKIN_TONES[slot % SKIN_TONES.length]!
    this.stickColor = STICK_TONES[(slot * 7) % STICK_TONES.length]!
  }

  /** Parts this rig contributes, as (partKey, node) pairs. */
  parts(): Array<[PartKey, THREE.Object3D]> {
    const common: Array<[PartKey, THREE.Object3D]> = [
      ['skate', this.ankleL], ['skate', this.ankleR],
      ['upperArm', this.upperL], ['upperArm', this.upperR],
      ['forearm', this.foreL], ['forearm', this.foreR],
    ]
    if (this.goalie) {
      return [
        ...common,
        ['gPelvis', this.hips], ['gTorso', this.torso],
        ['gThigh', this.hipL], ['gThigh', this.hipR],
        ['gPad', this.kneeL], ['gPad', this.kneeR],
        ['gMask', this.head], ['gCage', this.head], ['face', this.head],
        ['gCatcher', this.handL], ['gBlocker', this.handR],
        ['gShaft', this.shaft], ['gBlade', this.blade],
      ]
    }
    return [
      ...common,
      ['pelvis', this.hips], ['torso', this.torso],
      ['thigh', this.hipL], ['thigh', this.hipR],
      ['shin', this.kneeL], ['shin', this.kneeR],
      ['face', this.head], ['helmet', this.head], ['visor', this.head],
      ['glove', this.handL], ['glove', this.handR],
      ['shaft', this.shaft], ['blade', this.blade],
    ]
  }

  /**
   * Apply a body pose + stick/hand targets.
   * @param wx,wz   world position   @param heading  yaw (rad)
   * @param stick   'carry' (blade on the ice at the puck spot), 'shoot'
   *                (0..1 swing progress), 'raise' (celebration)
   */
  apply(wx: number, wz: number, heading: number, pose: BodyPose, stick: { mode: 'carry' | 'shoot' | 'raise'; t?: number }, groundY = 0): void {
    const r = this.root
    r.position.set(wx, groundY, wz)
    r.rotation.set(0, heading, -pose.bodyRoll)
    this.hips.position.set(0, pose.hipHeight, 0)
    this.torso.rotation.set(pose.lean, pose.torsoYaw, -pose.torsoRoll)
    this.head.rotation.set(-pose.lean * 0.75, -pose.torsoYaw * 0.6, 0)
    const legs: Array<[THREE.Object3D, THREE.Object3D, THREE.Object3D, BodyPose['left'], 1 | -1]> = [
      [this.hipL, this.kneeL, this.ankleL, pose.left, 1],
      [this.hipR, this.kneeR, this.ankleR, pose.right, -1],
    ]
    for (const [hip, knee, ankle, leg, side] of legs) {
      hip.rotation.set(-leg.flex, 0, side * leg.abduct)
      knee.rotation.set(leg.knee, -side * leg.splay, 0)
      ankle.rotation.set(-leg.ankle, 0, 0)
    }
    r.updateMatrixWorld(true)

    // ── hands & stick, solved in root space ──
    _inv.copy(r.matrixWorld).invert()
    const sL = this.shoulderL.getWorldPosition(_v).applyMatrix4(_inv)
    const shL = toV3(sL)
    const shR = toV3(this.shoulderR.getWorldPosition(_w).applyMatrix4(_inv))
    const hipY = pose.hipHeight

    let heel: V3
    let shaftDir: V3
    let bladeDir: V3
    let topGrip: number
    let lowGrip: number
    if (this.goalie) {
      heel = { x: -0.55, y: 0.02, z: 1.55 }
      bladeDir = { x: 1, y: 0, z: 0.05 }
      const top = { x: -1.05, y: hipY + 0.55, z: 1.15 }
      shaftDir = norm(sub3(top, heel))
      topGrip = Math.min(len3(sub3(top, heel)), 4.2)
      lowGrip = topGrip
    } else if (stick.mode === 'raise') {
      const top = { x: shR.x - 0.1, y: shR.y + 1.3, z: shR.z + 0.5 }
      shaftDir = norm({ x: -0.25, y: -1, z: -0.3 }) // knob hangs below the raised hands
      heel = add3(top, scale3(shaftDir, -3.9))
      bladeDir = { x: 1, y: 0, z: 0 }
      // for 'raise' the grips count from the heel toward the knob
      topGrip = 3.9
      lowGrip = 3.1
    } else {
      // carry / shoot: blade centred on the puck spot (math.puckCarriedOffset)
      let bz = 3.0
      let by = 0.02
      const t = stick.mode === 'shoot' ? (stick.t ?? 0) : -1
      if (t >= 0) {
        if (t < 0.45) {
          const k = t / 0.45
          bz = 3.0 - 2.2 * k
          by = 0.02 + 0.9 * k
        } else {
          const k = (t - 0.45) / 0.55
          bz = 0.8 + 4.0 * k
          by = 0.92 + 0.6 * k
        }
      }
      bladeDir = norm({ x: 1, y: 0, z: 0.28 })
      const mid = { x: 1.2 + pose.stickSway, y: by, z: bz }
      heel = add3(mid, scale3(bladeDir, -0.45))
      // top hand out in front of the hip (not tucked at the side)
      const top = { x: shR.x + 0.5, y: hipY + 0.55, z: 1.0 }
      const d = sub3(top, heel)
      shaftDir = norm(d)
      topGrip = Math.min(len3(d), RIG.stickLen - 0.25)
      lowGrip = topGrip * 0.52
    }

    // shaft node: origin at heel, +Y along the shaft
    this.shaft.position.set(heel.x, heel.y, heel.z)
    _q.setFromUnitVectors(_v.set(0, 1, 0), _w.set(shaftDir.x, shaftDir.y, shaftDir.z))
    this.shaft.quaternion.copy(_q)
    // blade node: origin at heel, +X along the blade, +Y up
    this.blade.position.set(heel.x, heel.y, heel.z)
    this.blade.rotation.set(0, Math.atan2(-bladeDir.z, bladeDir.x), 0)

    const gripTop = add3(heel, scale3(shaftDir, topGrip))
    const gripLow = add3(heel, scale3(shaftDir, lowGrip))
    let handTargetL: V3
    let handTargetR: V3
    if (this.goalie) {
      handTargetR = gripTop
      // catching glove held open, out to the side
      handTargetL = { x: 1.25, y: hipY + 0.75, z: 1.15 }
    } else {
      handTargetR = gripTop // top hand (left-shot stick: right hand on top)
      handTargetL = gripLow
    }
    this.placeArm(shL, handTargetL, this.upperL, this.foreL, this.handL, 1)
    this.placeArm(shR, handTargetR, this.upperR, this.foreR, this.handR, -1)
    for (const n of [this.upperL, this.upperR, this.foreL, this.foreR, this.handL, this.handR, this.shaft, this.blade]) {
      n.updateMatrixWorld(true)
    }
  }

  private placeArm(sh: V3, target: V3, upper: THREE.Object3D, fore: THREE.Object3D, hand: THREE.Object3D, side: 1 | -1): void {
    const pole = { x: sh.x + side * 1.6, y: sh.y - 1.2, z: sh.z - 0.8 }
    const { elbow, hand: h } = solveTwoBone(sh, target, RIG.upperArm, RIG.forearm, pole)
    upper.position.set(sh.x, sh.y, sh.z)
    upper.quaternion.setFromUnitVectors(DOWN, _v.set(elbow.x - sh.x, elbow.y - sh.y, elbow.z - sh.z).normalize())
    fore.position.set(elbow.x, elbow.y, elbow.z)
    fore.quaternion.setFromUnitVectors(DOWN, _v.set(h.x - elbow.x, h.y - elbow.y, h.z - elbow.z).normalize())
    hand.position.set(h.x, h.y, h.z)
    hand.quaternion.copy(fore.quaternion)
  }
}

const sub3 = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const add3 = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const scale3 = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k })
const len3 = (a: V3) => Math.hypot(a.x, a.y, a.z)
const norm = (a: V3): V3 => {
  const l = len3(a) || 1
  return { x: a.x / l, y: a.y / l, z: a.z / l }
}

// ── batch renderer ──────────────────────────────────────────────────────────

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0)

/** Owns the instanced meshes for every rig; call sync() once per frame. */
export class AthleteBatch {
  readonly group = new THREE.Group()
  private readonly parts: Record<PartKey, PartDef>
  private readonly meshes = new Map<PartKey, THREE.InstancedMesh>()
  private readonly bindings = new Map<PartKey, Binding[]>()

  constructor(readonly rigs: AthleteRig[], atlasTex: THREE.Texture) {
    this.parts = buildParts(atlasTex)
    for (const rig of rigs) {
      for (const [key, node] of rig.parts()) {
        let list = this.bindings.get(key)
        if (!list) this.bindings.set(key, (list = []))
        list.push({ rig, node })
      }
    }
    for (const [key, list] of this.bindings) {
      const def = this.parts[key]
      const mesh = new THREE.InstancedMesh(def.geo, def.mat, list.length)
      mesh.castShadow = def.cast
      mesh.receiveShadow = false
      mesh.frustumCulled = false
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      if (def.atlas) {
        const arr = new Float32Array(list.length * 2)
        list.forEach((b, i) => {
          const [u, v] = atlasOffset(b.rig.slot)
          arr[i * 2] = u
          arr[i * 2 + 1] = v
        })
        def.geo.setAttribute('aAtlas', new THREE.InstancedBufferAttribute(arr, 2))
      }
      this.meshes.set(key, mesh)
      this.group.add(mesh)
    }
  }

  /** (Re)apply kit colors to every instance. Call after kits change. */
  applyColors(): void {
    const c = new THREE.Color()
    for (const [key, list] of this.bindings) {
      const col = this.parts[key].color
      if (!col) continue
      const mesh = this.meshes.get(key)!
      list.forEach((b, i) => {
        const kit = b.rig.kit
        let hex = 0xffffff
        if (col === 'skin') hex = b.rig.skin
        else if (col === 'stick') hex = b.rig.stickColor
        else if (col === 'pad') hex = kit ? mixHex(0xf2f2ee, kit.trim === 0xf4f4f2 ? kit.jersey : kit.trim, 0.18) : 0xf2f2ee
        else if (col === 'mask') hex = kit ? mixHex(kit.helmet, 0xffffff, 0.35) : 0xffffff
        else if (kit) hex = kit[col]
        mesh.setColorAt(i, c.setHex(hex))
      })
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  sync(): void {
    for (const [key, list] of this.bindings) {
      const mesh = this.meshes.get(key)!
      for (let i = 0; i < list.length; i++) {
        const b = list[i]!
        mesh.setMatrixAt(i, b.rig.visible ? b.node.matrixWorld : ZERO)
      }
      mesh.instanceMatrix.needsUpdate = true
    }
  }

  /** Draw calls this batch issues (for perf reporting). */
  get drawCalls(): number {
    return this.meshes.size
  }

  dispose(): void {
    const mats = new Set<THREE.Material>()
    for (const def of Object.values(this.parts)) {
      def.geo.dispose()
      mats.add(def.mat)
    }
    for (const m of mats) m.dispose()
    for (const mesh of this.meshes.values()) mesh.dispose()
  }
}

function mixHex(a: number, b: number, t: number): number {
  const ca = new THREE.Color(a)
  const cb = new THREE.Color(b)
  return ca.lerp(cb, t).getHex()
}
