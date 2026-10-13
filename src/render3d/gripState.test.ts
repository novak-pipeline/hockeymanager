import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { AthleteRig } from './athlete'
import { skaterPose } from './pose'
import { GRIP_STATES, blendGrip, chooseGrip, dominantGrip, gripBend, oneHot, squareBladeDir, type GripContext, type GripState } from './gripState'
import { isLance, isOneHanded, measureGrip } from './gripTruth'

const ctx = (o: Partial<GripContext> = {}): GripContext => ({ carrying: false, stickClip: false, faceoff: false, receiving: false, speedFt: 10, backward: 0, defending: false, ...o })

describe('chooseGrip — the grip from what the sim says he is doing', () => {
  it('two hands with the puck, in a swing and stickhandling — even at full speed', () => {
    expect(chooseGrip(ctx({ carrying: true, speedFt: 28 }))).toBe('carry')
    expect(chooseGrip(ctx({ stickClip: true, speedFt: 28 }))).toBe('carry')
  })
  it('a faceoff clip owns the grip; a pass in flight squares the blade', () => {
    expect(chooseGrip(ctx({ faceoff: true, carrying: true }))).toBe('faceoff')
    expect(chooseGrip(ctx({ receiving: true, speedFt: 25 }))).toBe('receive')
  })
  it('one hand only skating hard without the puck (sooner when chasing a loose puck), with hysteresis', () => {
    expect(chooseGrip(ctx({ speedFt: 17 }))).toBe('relaxed')
    expect(chooseGrip(ctx({ speedFt: 21 }))).toBe('oneHand')
    expect(chooseGrip(ctx({ speedFt: 14, job: 'chase' }))).toBe('oneHand')
    // eases out below 15 ft/s, not at the 19 ft/s it came in at
    expect(chooseGrip(ctx({ speedFt: 17 }), 'oneHand')).toBe('oneHand')
    expect(chooseGrip(ctx({ speedFt: 14 }), 'oneHand')).toBe('relaxed')
  })
  it('the ready stance for a D backing up against the rush and a man covering', () => {
    expect(chooseGrip(ctx({ backward: 0.9, speedFt: 12, defending: true }))).toBe('ready')
    expect(chooseGrip(ctx({ job: 'mark:p7', defending: true, speedFt: 8 }))).toBe('ready')
    expect(chooseGrip(ctx({ job: 'twoOnOne', defending: true, speedFt: 12 }))).toBe('ready')
    // the same job with his own team on the puck is not a defensive read
    expect(chooseGrip(ctx({ job: 'lane', defending: false, speedFt: 8 }))).toBe('relaxed')
  })
})

describe('blendGrip — transitions never pop', () => {
  it('eases toward the target (≈95% in 0.3 s) and keeps the weights summing to 1', () => {
    let w = oneHot('relaxed')
    const seen: number[] = []
    for (let i = 0; i < 18; i++) {
      w = blendGrip(w, 'carry', 1 / 60)
      seen.push(w.carry)
      expect(GRIP_STATES.reduce((a, s) => a + w[s], 0)).toBeCloseTo(1, 6)
    }
    // no frame jumps more than ~0.16 of the way, and it is mostly there after 0.3 s
    for (let i = 1; i < seen.length; i++) expect(seen[i]! - seen[i - 1]!).toBeLessThan(0.16)
    expect(seen.at(-1)!).toBeGreaterThan(0.9)
    expect(dominantGrip(w)).toBe('carry')
  })
  it('a seek (dt 0) snaps', () => {
    expect(blendGrip(oneHot('relaxed'), 'oneHand', 0).oneHand).toBe(1)
  })
  it('bends at the waist for the two-handed grips only', () => {
    expect(gripBend(oneHot('carry'))).toBeGreaterThan(0.3)
    expect(gripBend(oneHot('oneHand'))).toBe(0)
  })
  it('squares the blade to the incoming puck, toe out to the forehand', () => {
    const d = squareBladeDir({ x: 0, z: 1 })
    expect(d.x).toBeCloseTo(1, 6)
    expect(d.z).toBeCloseTo(0, 6)
    const e = squareBladeDir({ x: 0.6, z: 0.8 })
    expect(e.x * 0.6 + e.z * 0.8).toBeCloseTo(0, 6)
    expect(e.x).toBeGreaterThan(0)
  })
})

// The procedural rig in each grip: the lance never appears, two-handed grips
// keep both hands on the shaft with the blade on the ice, the one-hand grip
// lets the bottom hand go and holds the stick at his hip — and handedness mirrors.
describe('grip poses on the rig', () => {
  const posed = (s: GripState, right = false, speed = 0.6) => {
    const rig = new AthleteRig(false, 0, new THREE.MeshStandardMaterial())
    rig.rightHanded = right
    rig.mirrorW = right ? 1 : 0
    const w = oneHot(s)
    rig.apply(0, 0, 0, skaterPose(1.3, speed, 0), { mode: 'carry' }, null, { w, bend: gripBend(w), armSwing: 0.4, incoming: s === 'receive' ? { x: 0.5, z: 0.87 } : null })
    rig.root.updateMatrixWorld(true)
    return { rig, m: measureGrip(rig)! }
  }
  for (const right of [false, true]) {
    for (const s of GRIP_STATES) {
      it(`${s} (${right ? 'R' : 'L'} shot): no lance`, () => {
        const { m, rig } = posed(s, right)
        expect(isLance(m), JSON.stringify(m)).toBe(false)
        expect(rig.gripState).toBe(s)
      })
    }
    it(`two hands on the shaft, blade on the ice, in the carry (${right ? 'R' : 'L'})`, () => {
      for (const s of ['carry', 'relaxed', 'ready', 'receive'] as const) {
        const { m } = posed(s, right)
        expect(isOneHanded(m), `${s} ${JSON.stringify(m)}`).toBe(false)
        expect(m.bladeY, s).toBeLessThan(0.25)
      }
    })
    it(`one hand: the bottom hand off, the top hand at his hip, not reaching out (${right ? 'R' : 'L'})`, () => {
      const { m } = posed('oneHand', right, 0.95)
      expect(isOneHanded(m)).toBe(true)
      expect(m.topFwd).toBeLessThan(0.6)
      expect(m.topY).toBeLessThan(3.6)
    })
  }
  // (`incoming` is in the AUTHORED left-handed frame: the renderer mirrors it for a right shot,
  // so the same authored input is a pass from the mirrored side)
  it('the right-handed grip is the mirror of the left', () => {
    for (const s of GRIP_STATES) {
      const a = posed(s, false).rig.bladeWorld()!.clone()
      const b = posed(s, true).rig.bladeWorld()!.clone()
      expect(b.x, s).toBeCloseTo(-a.x, 3)
      expect(b.z, s).toBeCloseTo(a.z, 3)
    }
  })
})
