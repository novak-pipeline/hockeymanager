import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { AthleteRig, bladeAnchor } from './athlete'

// A carried puck sits on the DRAWN blade: the anchor is measured from the stick
// geometry (its lowest verts), in the frame of the bone that skins them.
describe('bladeAnchor', () => {
  const rig = new AthleteRig(false, 0, new THREE.MeshStandardMaterial())

  it('finds the blade on a skater rig, at the stick\'s low end', () => {
    expect(rig.blade).not.toBeNull()
    const w = rig.bladeWorld()!
    const P = rig.mesh.geometry.getAttribute('position')
    let minY = Infinity
    for (let i = 0; i < P.count; i++) minY = Math.min(minY, P.getY(i))
    // at bind, the anchor is on the stick's lowest edge, not up the shaft
    expect(w.y).toBeLessThan(minY + 0.35)
    expect(Number.isFinite(w.x) && Number.isFinite(w.z)).toBe(true)
  })

  it('follows the stick bone when the stick moves', () => {
    const before = rig.bladeWorld()!.clone()
    rig.blade!.bone.position.x += 1.5
    rig.root.updateMatrixWorld(true)
    const after = rig.bladeWorld()!
    expect(after.x - before.x).toBeCloseTo(1.5, 5)
    rig.blade!.bone.position.x -= 1.5
    rig.root.updateMatrixWorld(true)
  })

  it('is cached per geometry', () => {
    const a = bladeAnchor(rig.mesh)!
    const b = bladeAnchor(rig.mesh)!
    expect(a.local).toBe(b.local)
  })
})
