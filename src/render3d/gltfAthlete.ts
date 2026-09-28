/**
 * Blender-authored athletes: turns the glTF built by scripts/blender/
 * (skater.glb / goalie.glb) into
 *   - an AthleteTemplate: ONE shared set of vertex buffers (positions, normals,
 *     skin indices/weights) that every AthleteRig of that kind reuses; the
 *     per-player UVs (jersey-atlas slot) and vertex colours (kit) are the only
 *     per-rig attributes, so the GPU holds one copy of the body;
 *   - BakedClips: every authored action, RETARGETED onto the renderer's own
 *     skeleton convention (identity rest frames, see athlete.ts) and resampled
 *     at a fixed rate so runtime sampling is two array reads + a slerp.
 *
 * The glTF's own bones are never used at runtime. Its mesh is bound to the
 * AthleteRig's bones by NAME, which works because the Blender rig is built
 * from the same rest positions (a test checks the .glb against
 * restBonePositions()).
 *
 * Retarget maths (glTF rest local rotation R_j, rest world rotation of the
 * parent Wp, animated local A_j; renderer rest frames are identity):
 *   renderer local rotation  Q_j = Wp · A_j · R_j⁻¹ · Wp⁻¹
 *   renderer local position  p_j = Wp · T_j
 */

import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { BONE_NAMES, type BoneName } from './athlete'

export const CLIP_FPS = 30

export interface BakedClip {
  name: string
  /** Contact time (s) authored into the clip name (`slot@cN`, owner imports); else the catalogue's. */
  contact?: number
  /** Number of samples (frames + 1: the last sample is the end pose). */
  samples: number
  duration: number
  /** Renderer-space local rotations, 4 floats per sample, per animated bone. */
  rot: Partial<Record<BoneName, Float32Array>>
  /** Renderer-space local positions (hips / stick / stick_blade), 3 floats per sample. */
  pos: Partial<Record<BoneName, Float32Array>>
}

export interface AthleteTemplate {
  goalie: boolean
  position: THREE.BufferAttribute
  normal: THREE.BufferAttribute
  skinIndex: THREE.BufferAttribute
  skinWeight: THREE.BufferAttribute
  /** Slot-local UVs (0..1 inside one jersey-atlas cell). */
  uvLocal: Float32Array
  /** Material role per vertex ('jersey', 'pants', …) — from the Blender material names. */
  roles: string[]
  /** Rest world position of every joint found in the file (renderer space). */
  joints: Partial<Record<BoneName, THREE.Vector3>>
  clips: Map<string, BakedClip>
  triangles: number
  /**
   * Owner-supplied athlete (scripts/blender/import_owner_assets.py): the body is
   * drawn in material GROUPS (clothes → the per-player kit atlas, gear → the
   * shared gear atlas, visor) instead of one role-coloured atlas material, and
   * its UVs are the owner's own (uvLocal holds them).
   */
  groups?: Array<{ start: number; count: number; group: OwnerGroup }>
  /** Stick length (ft) — the grips slide along it. */
  stickLen?: number
  /**
   * Where each glove's PALM grips the shaft, in its hand bone's frame (owner
   * imports: measured from the owner's own idle, `<role>_grip.json`). Absent =
   * the wrist joint itself sits on the shaft (the Blender athletes).
   */
  grip?: Partial<Record<'L' | 'R', THREE.Vector3>>
}

export type OwnerGroup = 'clothes' | 'gear' | 'visor'
const OWNER_GROUPS: OwnerGroup[] = ['clothes', 'gear', 'visor']

const isBone = (n: string): n is BoneName => (BONE_NAMES as readonly string[]).includes(n)

/** Rest rotation of `obj` relative to `stop` (exclusive), from the loaded (rest) TRS. */
function restRotationUpTo(obj: THREE.Object3D, stop: THREE.Object3D | null): THREE.Quaternion {
  const chain: THREE.Object3D[] = []
  for (let o: THREE.Object3D | null = obj; o && o !== stop; o = o.parent) chain.push(o)
  const q = new THREE.Quaternion()
  for (let i = chain.length - 1; i >= 0; i--) q.multiply(chain[i]!.quaternion)
  return q
}

/** Build the template (geometry + retargeted clips) from a parsed glTF. */
export function templateFromGltf(gltf: GLTF, goalie: boolean): AthleteTemplate {
  const meshes: THREE.SkinnedMesh[] = []
  gltf.scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh)
  })
  if (meshes.length === 0) throw new Error('athlete glTF: no skinned mesh')
  const skeleton = meshes[0]!.skeleton
  const rootBone = skeleton.bones.find((b) => b.name === 'root')
  if (!rootBone) throw new Error('athlete glTF: no root joint')
  const armatureNode = rootBone.parent // the Blender armature object (frame of the renderer's root space)

  // ── rest joints (renderer space = the armature node's local frame) ──
  gltf.scene.updateMatrixWorld(true)
  const toArm = new THREE.Matrix4().copy(armatureNode ? armatureNode.matrixWorld : new THREE.Matrix4()).invert()
  const joints: Partial<Record<BoneName, THREE.Vector3>> = {}
  for (const b of skeleton.bones) {
    if (isBone(b.name)) joints[b.name] = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(toArm)
  }

  // ── merge every primitive into one geometry, remapping joints by name ──
  let count = 0
  for (const m of meshes) count += m.geometry.getAttribute('position').count
  const pos = new Float32Array(count * 3)
  const nor = new Float32Array(count * 3)
  const uv = new Float32Array(count * 2)
  const si = new Uint16Array(count * 4)
  const sw = new Float32Array(count * 4)
  const roles: string[] = new Array(count)
  const indices: number[] = []
  let base = 0
  const meshToArm = new THREE.Matrix4()
  const nrm = new THREE.Matrix3()
  const v = new THREE.Vector3()
  for (const m of meshes) {
    const g = m.geometry
    const P = g.getAttribute('position')
    const N = g.getAttribute('normal')
    const T = g.getAttribute('uv')
    const J = g.getAttribute('skinIndex')
    const W = g.getAttribute('skinWeight')
    meshToArm.copy(toArm).multiply(m.matrixWorld)
    nrm.getNormalMatrix(meshToArm)
    const mat = Array.isArray(m.material) ? m.material[0] : m.material
    const role = (mat?.name ?? '').replace(/^role:/, '') || 'jersey'
    const remap = m.skeleton.bones.map((b) => (isBone(b.name) ? BONE_NAMES.indexOf(b.name) : 0))
    for (let i = 0; i < P.count; i++) {
      const k = base + i
      v.fromBufferAttribute(P, i).applyMatrix4(meshToArm)
      pos.set([v.x, v.y, v.z], k * 3)
      if (N) {
        v.fromBufferAttribute(N, i).applyMatrix3(nrm).normalize()
        nor.set([v.x, v.y, v.z], k * 3)
      }
      if (T) uv.set([T.getX(i), 1 - T.getY(i)], k * 2) // GLTFLoader flips V; undo → Blender's UV space
      for (let c = 0; c < 4; c++) {
        si[k * 4 + c] = remap[J.getComponent(i, c)] ?? 0
        sw[k * 4 + c] = W.getComponent(i, c)
      }
      roles[k] = role
    }
    const idx = g.getIndex()
    if (idx) for (let i = 0; i < idx.count; i++) indices.push(base + idx.getX(i))
    else for (let i = 0; i < P.count; i++) indices.push(base + i)
    base += P.count
  }
  // owner bodies: order the triangles by material group so each group is one draw range
  const owner = roles.some((r) => r.startsWith('own:'))
  let groups: AthleteTemplate['groups']
  if (owner) {
    const tri = indices.length / 3
    const byGroup: number[][] = OWNER_GROUPS.map(() => [])
    for (let t = 0; t < tri; t++) {
      const g = OWNER_GROUPS.indexOf(roles[indices[t * 3]!]!.slice(4) as OwnerGroup)
      byGroup[g < 0 ? 1 : g]!.push(indices[t * 3]!, indices[t * 3 + 1]!, indices[t * 3 + 2]!)
    }
    indices.length = 0
    groups = []
    for (let g = 0; g < OWNER_GROUPS.length; g++) {
      if (byGroup[g]!.length === 0) continue
      groups.push({ start: indices.length, count: byGroup[g]!.length, group: OWNER_GROUPS[g]! })
      for (const i of byGroup[g]!) indices.push(i)
    }
  }
  // de-index: the rig geometry is non-indexed (matches the procedural path)
  const n = indices.length
  const dp = new Float32Array(n * 3)
  const dn = new Float32Array(n * 3)
  const du = new Float32Array(n * 2)
  const di = new Uint16Array(n * 4)
  const dw = new Float32Array(n * 4)
  const dr: string[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const s = indices[i]!
    dp.set(pos.subarray(s * 3, s * 3 + 3), i * 3)
    dn.set(nor.subarray(s * 3, s * 3 + 3), i * 3)
    du.set(uv.subarray(s * 2, s * 2 + 2), i * 2)
    di.set(si.subarray(s * 4, s * 4 + 4), i * 4)
    dw.set(sw.subarray(s * 4, s * 4 + 4), i * 4)
    dr[i] = roles[s]!
  }

  return {
    goalie,
    position: new THREE.BufferAttribute(dp, 3),
    normal: new THREE.BufferAttribute(dn, 3),
    skinIndex: new THREE.Uint16BufferAttribute(di, 4),
    skinWeight: new THREE.BufferAttribute(dw, 4),
    uvLocal: du,
    roles: dr,
    joints,
    clips: bakeClips(gltf.animations, skeleton, armatureNode),
    triangles: n / 3,
    ...(groups ? { groups } : {}),
    ...withStick(stickLength(dp, di, dw)),
  }
}

const withStick = (len: number | undefined) => (len === undefined ? {} : { stickLen: len })

/** Longest reach (ft) of the vertices bound to the stick bone, along its rest shaft (+Y). */
function stickLength(pos: Float32Array, si: Uint16Array, sw: Float32Array): number | undefined {
  const stick = BONE_NAMES.indexOf('stick')
  let top = 0
  for (let v = 0; v < pos.length / 3; v++) {
    for (let c = 0; c < 4; c++) if (si[v * 4 + c] === stick && sw[v * 4 + c]! > 0.5) top = Math.max(top, pos[v * 3 + 1]!)
  }
  return top > 1 ? top : undefined
}

/** Retarget + resample every glTF animation onto the renderer's rig convention. */
export function bakeClips(anims: THREE.AnimationClip[], skeleton: THREE.Skeleton, armatureNode: THREE.Object3D | null): Map<string, BakedClip> {
  const byName = new Map<string, THREE.Bone>()
  for (const b of skeleton.bones) byName.set(b.name, b)
  const restLocal = new Map<string, THREE.Quaternion>()
  const parentWorld = new Map<string, THREE.Quaternion>()
  for (const b of skeleton.bones) {
    restLocal.set(b.name, b.quaternion.clone())
    parentWorld.set(b.name, b.parent && b.parent !== armatureNode ? restRotationUpTo(b.parent, armatureNode) : new THREE.Quaternion())
  }
  const out = new Map<string, BakedClip>()
  const a = new THREE.Quaternion()
  const t3 = new THREE.Vector3()
  for (const clip of anims) {
    const samples = Math.max(2, Math.round(clip.duration * CLIP_FPS) + 1)
    // owner imports carry their contact frame in the name: `shot_wrist@c22`
    const [base, ...tags] = clip.name.split('@')
    const ct = tags.find((x) => /^c\d+$/.test(x))
    const baked: BakedClip = { name: base!, samples, duration: (samples - 1) / CLIP_FPS, rot: {}, pos: {}, ...(ct ? { contact: Number(ct.slice(1)) / CLIP_FPS } : {}) }
    for (const track of clip.tracks) {
      const dot = track.name.lastIndexOf('.')
      const node = track.name.slice(0, dot)
      const prop = track.name.slice(dot + 1)
      if (!isBone(node) || node === 'root') continue
      const Wp = parentWorld.get(node)
      const R = restLocal.get(node)
      if (!Wp || !R) continue
      const interp = (track as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant()
      if (prop === 'quaternion') {
        const WpInv = Wp.clone().invert()
        const Rinv = R.clone().invert()
        const arr = new Float32Array(samples * 4)
        for (let s = 0; s < samples; s++) {
          const r = interp.evaluate(Math.min(clip.duration, s / CLIP_FPS)) as ArrayLike<number>
          a.set(r[0]!, r[1]!, r[2]!, r[3]!)
          const q = Wp.clone().multiply(a).multiply(Rinv).multiply(WpInv)
          arr.set([q.x, q.y, q.z, q.w], s * 4)
        }
        baked.rot[node] = arr
      } else if (prop === 'position' && (node === 'hips' || node === 'stick' || node === 'stick_blade')) {
        const arr = new Float32Array(samples * 3)
        for (let s = 0; s < samples; s++) {
          const r = interp.evaluate(Math.min(clip.duration, s / CLIP_FPS)) as ArrayLike<number>
          t3.set(r[0]!, r[1]!, r[2]!).applyQuaternion(Wp)
          arr.set([t3.x, t3.y, t3.z], s * 3)
        }
        baked.pos[node] = arr
      }
    }
    // bones the exporter optimised away (constant) still need their rest-relative value
    for (const name of BONE_NAMES) {
      if (name === 'root' || baked.rot[name]) continue
      const b = byName.get(name)
      if (!b) continue
      const Wp = parentWorld.get(name)!
      const q = Wp.clone().multiply(b.quaternion).multiply(restLocal.get(name)!.clone().invert()).multiply(Wp.clone().invert())
      const arr = new Float32Array(samples * 4)
      for (let s = 0; s < samples; s++) arr.set([q.x, q.y, q.z, q.w], s * 4)
      baked.rot[name] = arr
    }
    for (const name of ['hips', 'stick', 'stick_blade'] as const) {
      const b = byName.get(name)
      if (baked.pos[name] || !b) continue
      t3.copy(b.position).applyQuaternion(parentWorld.get(name)!)
      const arr = new Float32Array(samples * 3)
      for (let s = 0; s < samples; s++) arr.set([t3.x, t3.y, t3.z], s * 3)
      baked.pos[name] = arr
    }
    out.set(baked.name, baked)
  }
  return out
}

// ── loading ─────────────────────────────────────────────────────────────────

export interface AthleteAssets {
  skater: AthleteTemplate
  goalie: AthleteTemplate
}

let cached: Promise<AthleteAssets | null> | null = null

/**
 * Load both athlete .glb files (inlined as data: URLs by Vite so they load
 * the same from the dev server, file:// in the packaged app and the harness).
 * Resolves null (→ procedural athletes) if anything fails.
 */
export function loadAthleteAssets(): Promise<AthleteAssets | null> {
  if (!cached) {
    cached = (async () => {
      try {
        const [{ GLTFLoader }, sk, gk] = await Promise.all([
          import('three/examples/jsm/loaders/GLTFLoader.js'),
          import('./assets/skater.glb?inline'),
          import('./assets/goalie.glb?inline'),
        ])
        const loader = new GLTFLoader()
        const parse = async (url: string): Promise<GLTF> => {
          const buf = await (await fetch(url)).arrayBuffer()
          return loader.parseAsync(buf, '')
        }
        const [s, g] = await Promise.all([parse(sk.default), parse(gk.default)])
        return { skater: templateFromGltf(s, false), goalie: templateFromGltf(g, true) }
      } catch (e) {
        console.warn('[render3d] Blender athletes unavailable, using procedural bodies', e)
        return null
      }
    })()
  }
  return cached
}

// ── owner-supplied athletes ─────────────────────────────────────────────────
//
// Built locally by `npm run import:owner-assets` into src/render3d/assets/owner/
// (git-ignored: the owner's licence allows shipping them in the game but not
// redistributing them, and the repo is public). Absent → Blender athletes.

export interface OwnerTextures {
  clothesD: string
  clothesK: string
  clothesN: string
  gearD: string
  gearN: string
}

/** Sweater decal boxes (image fractions, top-left origin) + text rotation (deg). */
export interface OwnerKitLayout {
  boxes: Partial<Record<'numberBack' | 'numberLeft' | 'numberRight' | 'name' | 'crestFront' | 'crestLeft' | 'crestRight', [number, number, number, number]>>
  rotation: Partial<Record<string, number>>
}

export interface OwnerAssets {
  skater: AthleteTemplate
  goalie: AthleteTemplate | null
  tex: { skater: OwnerTextures; goalie: OwnerTextures | null }
  layout: { skater: OwnerKitLayout; goalie: OwnerKitLayout | null }
}

// A glob, not an import: the folder is optional (a fresh clone has none).
const OWNER_FILES = import.meta.glob('./assets/owner/*.{glb,jpg,png,json}', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>

export function ownerAssetsPresent(): boolean {
  return './assets/owner/skater.glb' in OWNER_FILES
}

let ownerCached: Promise<OwnerAssets | null> | null = null

/** Load the owner athletes if they were built locally; null otherwise (or on any failure). */
export function loadOwnerAssets(): Promise<OwnerAssets | null> {
  if (!ownerCached) {
    ownerCached = (async () => {
      if (!ownerAssetsPresent()) return null
      try {
        const url = async (f: string): Promise<string | null> => (OWNER_FILES[`./assets/owner/${f}`] ? await OWNER_FILES[`./assets/owner/${f}`]!() : null)
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
        const loader = new GLTFLoader()
        const parse = async (u: string): Promise<GLTF> => loader.parseAsync(await (await fetch(u)).arrayBuffer(), '')
        const texFor = async (role: 'skater' | 'goalie'): Promise<OwnerTextures | null> => {
          const [clothesD, clothesK, clothesN, gearD, gearN] = await Promise.all(
            ['clothes_d.jpg', 'clothes_k.png', 'clothes_n.jpg', 'gear_d.jpg', 'gear_n.jpg'].map((f) => url(`${role}_${f}`))
          )
          return clothesD && clothesK && clothesN && gearD && gearN ? { clothesD, clothesK, clothesN, gearD, gearN } : null
        }
        const layoutUrl = await url('owner_layout.json')
        const layout = layoutUrl ? ((await (await fetch(layoutUrl)).json()) as Record<string, OwnerKitLayout>) : {}
        const sk = await url('skater.glb')
        const gk = await url('goalie.glb')
        const [s, g, ts, tg] = await Promise.all([parse(sk!), gk ? parse(gk) : Promise.resolve(null), texFor('skater'), texFor('goalie')])
        if (!ts || !layout['skater']) throw new Error('owner skater textures / layout missing — rerun npm run import:owner-assets')
        const goalieOk = g && tg && layout['goalie']
        const gripUrl = await url('skater_grip.json')
        const gripJson = gripUrl ? ((await (await fetch(gripUrl)).json()) as Record<'L' | 'R', { palm: [number, number, number] } | null>) : null
        const own = (t: AthleteTemplate, role: 'skater' | 'goalie') => {
          if (role === 'skater' && gripJson) {
            t.grip = {}
            for (const h of ['L', 'R'] as const) {
              const g = gripJson[h]
              if (g) t.grip[h] = new THREE.Vector3(...g.palm)
            }
          }
          return t
        }
        return {
          skater: own(templateFromGltf(s, false), 'skater'),
          goalie: goalieOk ? own(templateFromGltf(g, true), 'goalie') : null,
          tex: { skater: ts, goalie: goalieOk ? tg : null },
          layout: { skater: layout['skater']!, goalie: goalieOk ? layout['goalie']! : null },
        }
      } catch (e) {
        console.warn('[render3d] owner athletes unavailable, using the Blender athletes', e)
        return null
      }
    })()
  }
  return ownerCached
}

/** A template's clips with every slot it lacks filled from `fallback` (owner clip wins). */
export function mergeClips(own: Map<string, BakedClip>, fallback: Map<string, BakedClip> | null | undefined): Map<string, BakedClip> {
  const out = new Map(fallback ?? [])
  for (const [k, v] of own) out.set(k, v)
  return out
}
