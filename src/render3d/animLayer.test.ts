/**
 * ActionLayer: clip layering over the procedural pose — masking, fades,
 * supersede without a dip back to the base pose, chained crossfades, loops.
 */
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { ActionLayer, blendClip, sampleRot } from './animLayer'
import type { BakedClip } from './gltfAthlete'

/** A synthetic clip: every listed bone rotated `angle` about X for the whole clip. */
function constClip(name: string, bones: string[], angle: number, seconds: number): BakedClip {
  const samples = Math.round(seconds * 30) + 1
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle)
  const rot: BakedClip['rot'] = {}
  for (const b of bones) {
    const a = new Float32Array(samples * 4)
    for (let s = 0; s < samples; s++) a.set([q.x, q.y, q.z, q.w], s * 4)
    ;(rot as Record<string, Float32Array>)[b] = a
  }
  return { name, samples, duration: (samples - 1) / 30, rot, pos: {} }
}

function bones(): Record<string, THREE.Bone> {
  const out: Record<string, THREE.Bone> = {}
  for (const n of ['hips', 'spine', 'chest', 'thigh_L', 'upperarm_R', 'stick']) out[n] = new THREE.Bone()
  return out
}

const angleX = (b: THREE.Bone) => 2 * Math.atan2(b.quaternion.x, b.quaternion.w)

describe('blendClip', () => {
  it('upper mask moves the spine but never the legs; body pass skips arms and stick', () => {
    const B = bones()
    const c = constClip('shot_wrist', ['spine', 'thigh_L', 'upperarm_R', 'stick'], 1, 1)
    blendClip(B, c, 0.5, false, 1, 'upper', 'body')
    expect(angleX(B.spine!)).toBeCloseTo(1)
    expect(angleX(B.thigh_L!)).toBeCloseTo(0)
    expect(angleX(B.upperarm_R!)).toBeCloseTo(0)
    expect(angleX(B.stick!)).toBeCloseTo(0)
    blendClip(B, c, 0.5, false, 1, 'upper', 'stick')
    expect(angleX(B.stick!)).toBeCloseTo(1)
  })
  it('weight is a slerp from the procedural value', () => {
    const B = bones()
    B.spine!.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.2)
    blendClip(B, constClip('x', ['spine'], 1, 1), 0, false, 0.5, 'full', 'body')
    expect(angleX(B.spine!)).toBeCloseTo(0.6)
  })
})

describe('sampling', () => {
  it('interpolates between samples and wraps loops', () => {
    const c = constClip('loop', ['spine'], 0, 1)
    const arr = c.rot.spine!
    // make sample k rotate k·0.1 rad (last == first for the loop)
    for (let s = 0; s < c.samples; s++) {
      const a = s === c.samples - 1 ? 0 : s * 0.1
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a)
      arr.set([q.x, q.y, q.z, q.w], s * 4)
    }
    const q = new THREE.Quaternion()
    sampleRot(c, 'spine', 1.5 / 30, false, q)
    expect(2 * Math.atan2(q.x, q.w)).toBeCloseTo(0.15)
    sampleRot(c, 'spine', c.duration + 1.5 / 30, true, q)
    expect(2 * Math.atan2(q.x, q.w)).toBeCloseTo(0.15)
  })
})

describe('ActionLayer', () => {
  const lib = new Map<string, BakedClip>([
    ['shot_wrist', constClip('shot_wrist', ['spine'], 1, 0.6)],
    ['check', constClip('check', ['spine', 'thigh_L'], 1, 0.6)],
    ['hit_fall', constClip('hit_fall', ['spine', 'hips'], 1, 1)],
    ['getup', constClip('getup', ['spine', 'hips'], 1, 1.2)],
  ])

  it('fades a one-shot in and out and then drops it', () => {
    const L = new ActionLayer(lib)
    expect(L.play('shot_wrist')).toBe(true)
    const B = bones()
    L.blendBody(B)
    expect(angleX(B.spine!)).toBeCloseTo(0) // t = 0 → weight 0
    L.update(0.3)
    const B2 = bones()
    L.blendBody(B2)
    expect(angleX(B2.spine!)).toBeCloseTo(1)
    L.update(1)
    expect(L.playing).toHaveLength(0)
  })

  it('unknown clips are refused (procedural fallback keeps working)', () => {
    expect(new ActionLayer(lib).play('nope')).toBe(false)
  })

  it('a newer clip on the same body parts takes over WITHOUT a dip back to the base pose', () => {
    const L = new ActionLayer(lib)
    L.play('shot_wrist')
    L.update(0.3) // shot fully in
    L.play('check') // full-body clip supersedes the upper-body one
    for (let i = 0; i < 12; i++) {
      L.update(0.01)
      const B = bones()
      L.blendBody(B)
      // both clips hold the spine at 1 rad: any dip toward 0 would show here
      expect(angleX(B.spine!)).toBeGreaterThan(0.97)
    }
    L.update(0.2)
    expect(L.playing).toEqual(['check'])
  })

  it('hit_fall chains into getup as a crossfade (the body never pops up mid-way)', () => {
    const L = new ActionLayer(lib)
    L.play('hit_fall')
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      L.update(1 / 60)
      L.playing.forEach((n) => seen.add(n))
      const B = bones()
      L.blendBody(B)
      const w = angleX(B.spine!)
      if (i > 5 && L.playing.length > 0 && seen.has('getup') && L.playing.includes('hit_fall')) expect(w).toBeGreaterThan(0.97)
    }
    expect(seen.has('getup')).toBe(true)
  })

  it('reports a busy body while a full-body clip plays', () => {
    const L = new ActionLayer(lib)
    L.play('hit_fall')
    L.update(0.2)
    expect(L.bodyBusy()).toBeGreaterThan(0.9)
    L.clear()
    expect(L.bodyBusy()).toBe(0)
  })
})
