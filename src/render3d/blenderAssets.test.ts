/**
 * The Blender build outputs (src/render3d/assets/*.glb, from scripts/blender)
 * against the renderer's contracts:
 *   - joint names + rest positions match AthleteRig's skeleton exactly,
 *   - every catalogue clip exists in the file (and nothing unlisted),
 *   - the retarget reproduces the authored pose semantics (a thigh keyed at
 *     flex/abduct in clips.py comes out as the same bone-local rotation
 *     AthleteRig.apply() would write),
 *   - the body is sane (feet on the ice, height, budget).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { templateFromGltf, type AthleteTemplate } from './gltfAthlete'
import { BONE_NAMES, restBonePositions } from './athlete'
import { SKATER_CLIPS, GOALIE_CLIPS } from './animCatalog'
import { sampleRot, samplePos } from './animLayer'

async function load(name: string, goalie: boolean): Promise<AthleteTemplate> {
  const buf = readFileSync(fileURLToPath(new URL(`./assets/${name}`, import.meta.url)))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const gltf = await new GLTFLoader().parseAsync(ab as ArrayBuffer, '')
  return templateFromGltf(gltf, goalie)
}

let skater: AthleteTemplate
let goalie: AthleteTemplate
beforeAll(async () => {
  skater = await load('skater.glb', false)
  goalie = await load('goalie.glb', true)
})

describe('Blender athletes: skeleton contract', () => {
  it('has every renderer bone at the renderer rest position (skater + goalie)', () => {
    for (const [t, isGoalie] of [[skater, false], [goalie, true]] as const) {
      const rest = restBonePositions(isGoalie)
      for (const n of BONE_NAMES) {
        const j = t.joints[n]
        expect(j, n).toBeDefined()
        expect(j!.distanceTo(rest[n]), n).toBeLessThan(1e-3)
      }
    }
  })

  it('stays inside the bone budget and skins only to renderer bones', () => {
    expect(BONE_NAMES.length).toBeLessThanOrEqual(40)
    const idx = skater.skinIndex.array as Uint16Array
    for (let i = 0; i < idx.length; i++) expect(idx[i]!).toBeLessThan(BONE_NAMES.length)
  })
})

describe('Blender athletes: mesh', () => {
  it('stands on the ice at hockey height, and is cheap', () => {
    for (const t of [skater, goalie]) {
      const box = new THREE.Box3().setFromBufferAttribute(t.position)
      expect(box.min.y).toBeGreaterThan(-0.05)
      expect(box.min.y).toBeLessThan(0.05)
      expect(box.max.y).toBeGreaterThan(6.0) // skates + helmet ~6.4 ft
      expect(box.max.y).toBeLessThan(7.0)
      expect(t.triangles).toBeLessThan(12000)
    }
  })

  it('carries the jersey-atlas UVs inside one slot', () => {
    let jersey = 0
    for (let i = 0; i < skater.roles.length; i++) {
      if (skater.roles[i] !== 'jersey') continue
      jersey++
      const u = skater.uvLocal[i * 2]!
      const v = skater.uvLocal[i * 2 + 1]!
      expect(u).toBeGreaterThanOrEqual(-1e-3)
      expect(u).toBeLessThanOrEqual(1.001)
      expect(v).toBeGreaterThanOrEqual(0.09)
      expect(v).toBeLessThanOrEqual(1.001)
    }
    expect(jersey).toBeGreaterThan(1000)
    expect(new Set(skater.roles)).toEqual(new Set(['jersey', 'pants', 'helmet', 'visor', 'gloves', 'skin', 'boot', 'steel', 'stick', 'tape', 'tapeW']))
  })
})

describe('Blender athletes: clips', () => {
  it('contains exactly the catalogue', () => {
    expect([...skater.clips.keys()].sort()).toEqual([...SKATER_CLIPS].sort())
    expect([...goalie.clips.keys()].sort()).toEqual([...GOALIE_CLIPS].sort())
  })

  it('retargets onto the renderer convention (authored thigh flex/abduct round-trips)', () => {
    // clips.py: skate_stride frame 0, left leg = stride_leg(0) = leg(flex 0.78, abduct 0.16, knee 1.18)
    const clip = skater.clips.get('skate_stride')!
    const q = new THREE.Quaternion()
    expect(sampleRot(clip, 'thigh_L', 0, true, q)).toBe(true)
    const want = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.78, 0, 0.16, 'ZXY'))
    expect(Math.abs(q.dot(want))).toBeGreaterThan(0.9995)
    expect(sampleRot(clip, 'shin_L', 0, true, q)).toBe(true)
    const knee = new THREE.Quaternion().setFromEuler(new THREE.Euler(1.18, 0, 0, 'YXZ'))
    expect(Math.abs(q.dot(knee))).toBeGreaterThan(0.9995)
  })

  it('keeps a skate on the ice through the stride (hips height = auto FK contact)', () => {
    const clip = skater.clips.get('skate_stride')!
    const v = new THREE.Vector3()
    for (let t = 0; t < clip.duration; t += 1 / 30) {
      samplePos(clip, 'hips', t, true, v)
      expect(v.y).toBeGreaterThan(2.3)
      expect(v.y).toBeLessThan(3.3)
    }
  })

  it('puts the blade on the ice, heading where the shot was authored, at the release frame', () => {
    // clips.py shot_wrist frame 9: blade middle (1.0, 0.03, 2.9), blade yaw -0.4. The
    // blade then slides out along the ice until the top hand holds the knob (posekit).
    const clip = skater.clips.get('shot_wrist')!
    const v = new THREE.Vector3()
    samplePos(clip, 'stick_blade', 9 / 30, false, v)
    expect(Math.abs(v.y - 0.03)).toBeLessThan(0.02)
    expect(v.z).toBeGreaterThan(2.4)
    const q = new THREE.Quaternion()
    sampleRot(clip, 'stick_blade', 9 / 30, false, q)
    const toe = new THREE.Vector3(1, 0, 0).applyQuaternion(q)
    expect(toe.angleTo(new THREE.Vector3(Math.cos(-0.4), 0, -Math.sin(-0.4)))).toBeLessThan(0.05)
  })

  it('loops seamlessly (first sample == last sample)', () => {
    for (const name of ['skate_stride', 'skate_glide', 'skate_back', 'skate_crossover_L']) {
      const c = skater.clips.get(name)!
      const a = new THREE.Quaternion()
      const b = new THREE.Quaternion()
      for (const bone of ['thigh_L', 'shin_R', 'spine']) {
        sampleRot(c, bone, 0, false, a)
        sampleRot(c, bone, c.duration, false, b)
        expect(Math.abs(a.dot(b)), `${name}/${bone}`).toBeGreaterThan(0.9999)
      }
    }
  })
})
