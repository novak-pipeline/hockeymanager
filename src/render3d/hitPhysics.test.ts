import { describe, it, expect, beforeAll } from 'vitest'
import * as THREE from 'three'
import { AthleteRig } from './athlete'
import { skaterPose } from './pose'
import { HitPhysics, RAGDOLL_MAX, VISUAL_OFFSET_MAX_FT, motorStrength, ragdollWeight, type HitImpact } from './hitPhysics'
import { nearestBoards } from './rinkShape'

const DT = 1 / 60

function rigAt(x: number, z: number, heading = 0): AthleteRig {
  const rig = new AthleteRig(false, 0, new THREE.MeshStandardMaterial())
  rig.apply(x, z, heading, skaterPose(0, 0.3, 0), { mode: 'carry' })
  return rig
}

/** World quaternion of each bone. */
function snapshot(rig: AthleteRig): Map<string, THREE.Quaternion> {
  rig.root.updateMatrixWorld(true)
  const out = new Map<string, THREE.Quaternion>()
  for (const [n, b] of Object.entries(rig.bones)) out.set(n, b.getWorldQuaternion(new THREE.Quaternion()))
  return out
}

function chestWorld(rig: AthleteRig): THREE.Vector3 {
  rig.root.updateMatrixWorld(true)
  return rig.bones.chest.getWorldPosition(new THREE.Vector3())
}

const imp = (o: Partial<HitImpact> = {}): HitImpact => ({ force: 0.8, dirX: 1, dirZ: 0, x: 0, z: 0, knockdown: false, boards: false, holdS: 0.7, vx: 0, vz: 0, ...o })

/** Run `secs` of frames: animation pose first, then the ragdoll over it. */
function play(phys: HitPhysics, rig: AthleteRig, secs: number, each?: (t: number) => void): void {
  const pose = skaterPose(0, 0.3, 0)
  for (let t = 0; t < secs; t += DT) {
    rig.apply(rig.root.position.x, rig.root.position.z, rig.root.rotation.y, pose, { mode: 'carry' })
    phys.afterApply(rig, 'p1', DT, false)
    each?.(t)
  }
}

let phys: HitPhysics
beforeAll(async () => {
  const p = await HitPhysics.create()
  expect(p).not.toBeNull()
  phys = p!
})

describe('hit physics (Rapier powered ragdoll)', () => {
  it('motor schedule: a harder hit is softer and recovers later; the blend fades in and back out', () => {
    const soft = motorStrength(0.1, { force: 0.2, knockdown: false, boards: false, holdS: 0.7 })
    const hard = motorStrength(0.1, { force: 0.9, knockdown: false, boards: false, holdS: 0.7 })
    expect(hard.torso).toBeLessThan(soft.torso)
    expect(motorStrength(5, { force: 0.9, knockdown: false, boards: false, holdS: 0.7 }).torso).toBeCloseTo(1, 5)
    expect(motorStrength(0.1, { force: 0.9, knockdown: true, boards: false, holdS: 1.4 }).hips).toBeLessThan(hard.hips)
    expect(ragdollWeight(0, 0.7)).toBe(0)
    expect(ragdollWeight(0.3, 0.7)).toBe(1)
    expect(ragdollWeight(1.2, 0.7)).toBe(0)
  })

  it('the torso gives along the push, the hips stay within the visual cap, the root never moves', () => {
    phys.reset()
    const rig = rigAt(10, 5)
    const before = chestWorld(rig)
    expect(phys.begin(rig, 'p1', imp({ force: 1, dirX: 1, dirZ: 0, holdS: 0.8 }))).toBe(true)
    let maxAlong = 0
    let maxOff = 0
    play(phys, rig, 0.4, () => {
      maxAlong = Math.max(maxAlong, chestWorld(rig).x - before.x)
      const o = phys.offsetOf(rig)
      maxOff = Math.max(maxOff, Math.hypot(o.x, o.z))
      expect(rig.root.position.x).toBe(10)
      expect(rig.root.position.z).toBe(5)
    })
    expect(maxAlong).toBeGreaterThan(0.3)
    expect(maxOff).toBeLessThanOrEqual(VISUAL_OFFSET_MAX_FT + 1e-6)
  })

  it('hands back to the animation exactly: after the reaction the bones are the clip pose again', () => {
    phys.reset()
    const rig = rigAt(0, 0)
    const anim = snapshot(rig)
    phys.begin(rig, 'p1', imp({ force: 0.9, holdS: 0.6 }))
    play(phys, rig, 0.3)
    const mid = snapshot(rig)
    const bent = Math.max(...[...mid].map(([n, q]) => q.angleTo(anim.get(n)!)))
    expect(bent).toBeGreaterThan(0.1)
    play(phys, rig, 1.0)
    expect(phys.isActive(rig)).toBe(false)
    const end = snapshot(rig)
    for (const [n, q] of end) expect(q.angleTo(anim.get(n)!)).toBeLessThan(1e-4)
  })

  it('no pops: a full-force knockdown never turns a core bone faster than the motion probe allows (VT4)', () => {
    phys.reset()
    const rig = rigAt(0, 0)
    phys.begin(rig, 'p1', imp({ force: 1, knockdown: true, holdS: 1.2 }))
    const core = ['hips', 'spine', 'chest', 'head'] as const
    let prev = core.map((n) => rig.bones[n].quaternion.clone())
    let worst = 0
    play(phys, rig, 2, () => {
      const cur = core.map((n) => rig.bones[n].quaternion.clone())
      cur.forEach((q, i) => (worst = Math.max(worst, q.angleTo(prev[i]!) / DT)))
      prev = cur
    })
    expect(worst).toBeLessThan(12)
    expect(phys.isActive(rig)).toBe(false)
  })

  it('pinned on the boards: the chest stops at the glass, never through it', () => {
    phys.reset()
    // a man 2 ft off the far boards (z = 42.5), driven straight into them
    const rig = rigAt(0, 40.5, 0)
    phys.begin(rig, 'p1', imp({ force: 1, dirX: 0, dirZ: 1, x: 0, z: 41.5, boards: true, holdS: 1.0 }))
    let maxZ = -Infinity
    play(phys, rig, 0.8, () => {
      rig.root.updateMatrixWorld(true)
      for (const n of ['chest', 'head', 'spine'] as const) maxZ = Math.max(maxZ, rig.bones[n].getWorldPosition(new THREE.Vector3()).z)
    })
    // joints stay inside the boards line (capsule radius keeps them ~0.3 ft off it)
    expect(maxZ).toBeLessThan(42.5)
    expect(maxZ).toBeGreaterThan(40.5)
  })

  it('at most RAGDOLL_MAX at once: a weaker extra hit plays on its clip alone', () => {
    phys.reset()
    const rigs = [rigAt(-30, 0), rigAt(0, 0), rigAt(30, 0)]
    expect(phys.begin(rigs[0]!, 'a', imp({ force: 0.9 }))).toBe(true)
    expect(phys.begin(rigs[1]!, 'b', imp({ force: 0.9 }))).toBe(true)
    expect(phys.begin(rigs[2]!, 'c', imp({ force: 0.3 }))).toBe(false)
    expect(phys.active).toBe(RAGDOLL_MAX)
    phys.reset()
    expect(phys.active).toBe(0)
  })

  it('a seek drops the ragdoll; a different player on the rig drops it too', () => {
    phys.reset()
    const rig = rigAt(0, 0)
    phys.begin(rig, 'p1', imp())
    phys.afterApply(rig, 'p1', 0, true)
    expect(phys.isActive(rig)).toBe(false)
    phys.begin(rig, 'p1', imp())
    phys.afterApply(rig, 'someone else', DT, false)
    expect(phys.isActive(rig)).toBe(false)
  })

  it('the hitter drives on through: hips forward along the push, then back', () => {
    phys.reset()
    const rig = rigAt(0, 0)
    phys.followThrough(rig, 0, 1, 1)
    let peak = 0
    play(phys, rig, 0.6, () => (peak = Math.max(peak, phys.offsetOf(rig).z)))
    expect(peak).toBeGreaterThan(0.3)
    expect(peak).toBeLessThanOrEqual(VISUAL_OFFSET_MAX_FT)
    expect(phys.offsetOf(rig).z).toBe(0)
  })

  it('budget: two ragdolls cost well under a frame', () => {
    phys.reset()
    const a = rigAt(-20, 0)
    const b = rigAt(20, 0)
    phys.begin(a, 'p1', imp({ force: 1, knockdown: true, holdS: 1.5 }))
    phys.begin(b, 'p1', imp({ force: 0.6, holdS: 0.8 }))
    const pose = skaterPose(0, 0.3, 0)
    const t0 = performance.now()
    let frames = 0
    for (let t = 0; t < 1.2; t += DT) {
      for (const r of [a, b]) {
        r.apply(r.root.position.x, r.root.position.z, 0, pose, { mode: 'carry' })
        phys.afterApply(r, 'p1', DT, false)
      }
      frames++
    }
    const msPerFrame = (performance.now() - t0) / frames
    // generous for a cold JIT under a parallel test runner; the renderer measures it live
    expect(msPerFrame).toBeLessThan(4)
  })
})

describe('nearestBoards', () => {
  it('straights and corners', () => {
    expect(nearestBoards(0, 40)).toMatchObject({ x: 0, z: 42.5, nx: 0, nz: 1 })
    expect(nearestBoards(95, 0)).toMatchObject({ x: 100, z: 0, nx: 1, nz: 0 })
    const c = nearestBoards(90, 35)
    expect(Math.hypot(c.x - 72, c.z - 14.5)).toBeCloseTo(28, 6)
    expect(c.dist).toBeGreaterThan(0)
  })
})
