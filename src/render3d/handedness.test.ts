import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { AthleteRig, BONE_NAMES } from './athlete'
import { skaterPose } from './pose'

// Right-handed shooters are the MIRROR of the left-handed pose (athlete.ts
// mirrorPose): every joint lands at its partner's position with x negated, the
// blade is on his right and the top hand is hand_L.
describe('handedness', () => {
  // (no turn: the bank into a turn is a world roll of the root, not part of the mirrored pose)
  const pose = skaterPose(1.3, 0.6, 0)
  const posed = (right: boolean) => {
    const rig = new AthleteRig(false, 0, new THREE.MeshStandardMaterial())
    rig.rightHanded = right
    rig.apply(0, 0, 0, pose, { mode: 'carry' })
    rig.root.updateMatrixWorld(true)
    const at: Record<string, THREE.Vector3> = {}
    for (const n of BONE_NAMES) at[n] = rig.bones[n].getWorldPosition(new THREE.Vector3())
    return { rig, at }
  }
  const L = posed(false)
  const R = posed(true)
  const partner = (n: string) => (n.endsWith('_L') ? n.slice(0, -1) + 'R' : n.endsWith('_R') ? n.slice(0, -1) + 'L' : n)

  it('puts every joint at its partner\'s mirrored position', () => {
    for (const n of BONE_NAMES) {
      const a = L.at[partner(n)]!
      const b = R.at[n]!
      expect(b.x, n).toBeCloseTo(-a.x, 4)
      expect(b.y, n).toBeCloseTo(a.y, 4)
      expect(b.z, n).toBeCloseTo(a.z, 4)
    }
  })

  it('carries the blade on the other side, with the top hand on the knob', () => {
    const bl = L.rig.bladeWorld()!.clone()
    const br = R.rig.bladeWorld()!.clone()
    expect(bl.x).toBeGreaterThan(0.3)
    expect(br.x).toBeCloseTo(-bl.x, 3)
    expect(br.z).toBeCloseTo(bl.z, 3)
    expect(R.rig.topHand.name).toBe('hand_L')
    expect(R.rig.bladeSide).toBe(-1)
  })

  it('keeps the shaft on the mirrored line (the blade turns a half-turn about it)', () => {
    const shaft = (rig: AthleteRig) => new THREE.Vector3(0, 1, 0).applyQuaternion(rig.bones.stick.getWorldQuaternion(new THREE.Quaternion()))
    const toe = (rig: AthleteRig) => new THREE.Vector3(1, 0, 0).applyQuaternion(rig.bones.stick_blade.getWorldQuaternion(new THREE.Quaternion()))
    const sl = shaft(L.rig), sr = shaft(R.rig)
    expect(sr.x).toBeCloseTo(-sl.x, 4)
    expect(sr.y).toBeCloseTo(sl.y, 4)
    const tl = toe(L.rig), tr = toe(R.rig)
    expect(tr.x).toBeCloseTo(-tl.x, 4)
    expect(tr.z).toBeCloseTo(tl.z, 4)
  })
})
