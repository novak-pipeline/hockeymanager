/**
 * Grip truth: how a DRAWN skater is holding his stick, measured from the posed
 * bones (never from what the code meant to do). Feeds the VT17 viewer-truth
 * detector and the grip harness.
 *
 * The owner's note after reel S1: "every player looks kind of weird and
 * unnatural holding the stick with one hand out in front of them". That pose
 * is the LANCE, measured on the owner's S1 rigs: the bottom hand off the
 * shaft, the top hand at the hip-to-chest band, and the stick thrust STRAIGHT
 * OUT in front of him (blade ~4.7 ft ahead of the hand, barely to the side).
 * Real carriers hold the stick in two hands; a one-handed skater holds it
 * across his body at the hip, the blade low to the side.
 * * All measures are in the player's own frame (root space): +Z his front,
 * +Y up, feet.
 */

import * as THREE from 'three'
import type { AthleteRig } from './athlete'

export interface GripSample {
  /** Perpendicular distance (ft) of the bottom hand's palm from the shaft. */
  bottomOff: number
  /** Top hand's palm: height above the ice, and how far in front of its own shoulder (ft; an arm hanging = ~0, reaching forward > 0). */
  topY: number
  topFwd: number
  /** How far the blade is in front of the top hand (ft; > 0 = the stick points forward). */
  bladeAhead: number
  /** How far the blade is to the side of the top hand (ft, either side). */
  bladeSide: number
  /** Height of the blade's low edge above the ice (ft). */
  bladeY: number
}

/** The thresholds the lance test uses (documented in VT17's rule). */
export const LANCE = {
  /** A hand further than this from the shaft is off the stick. */
  offShaftFt: 0.5,
  /** The top hand from the hip to the chest … */
  topYMin: 2.0,
  topYMax: 5.2,
  /** … the blade at least this far out in front of it … */
  bladeAheadFt: 2.5,
  /** … and the stick pointing straight ahead: ahead ≥ this × to the side (within ~34° of his heading). */
  straightRatio: 1.5,
} as const
/** A blade low edge higher than this is off the ice (3 in). */
export const BLADE_OFF_ICE_FT = 0.25

export const isOneHanded = (s: GripSample): boolean => s.bottomOff > LANCE.offShaftFt

/** The lance pose: one hand, the stick thrust straight out in front from the hip-to-chest band. */
export function isLance(s: GripSample): boolean {
  return isOneHanded(s) && s.topY >= LANCE.topYMin && s.topY <= LANCE.topYMax && s.bladeAhead >= LANCE.bladeAheadFt && s.bladeAhead >= LANCE.straightRatio * s.bladeSide
}

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _h = new THREE.Vector3()
const _d = new THREE.Vector3()
const _c = new THREE.Vector3()
const _inv = new THREE.Matrix4()
const _q = new THREE.Quaternion()

/** Measure a posed skater rig (call after apply(); bones' world matrices current). Null for goalies / stick-less rigs. */
export function measureGrip(rig: AthleteRig): GripSample | null {
  if (rig.goalie) return null
  const B = rig.bones
  rig.root.updateMatrixWorld(true)
  _inv.copy(rig.root.matrixWorld).invert()
  const topSide: 'L' | 'R' = rig.topHand === B.hand_L ? 'L' : 'R'
  const lowSide: 'L' | 'R' = topSide === 'L' ? 'R' : 'L'
  const topW = B[`hand_${topSide}`].localToWorld(_a.copy(rig.gripPalm[topSide]))
  const topWorldY = topW.y
  const top = topW.applyMatrix4(_inv)
  const low = B[`hand_${lowSide}`].localToWorld(_b.copy(rig.gripPalm[lowSide])).applyMatrix4(_inv)
  // the shaft: heel at the stick bone, +Y along it (the rig contract, see AthleteRig.apply)
  const heel = B.stick.getWorldPosition(_h).applyMatrix4(_inv)
  const rootQi = rig.root.getWorldQuaternion(_q).invert()
  const dir = _d.set(0, 1, 0).applyQuaternion(B.stick.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(rootQi).normalize()
  const tLow = Math.min(rig.dims.stickLen, Math.max(0, low.clone().sub(heel).dot(dir)))
  const bottomOff = low.distanceTo(heel.clone().addScaledVector(dir, tLow))
  const shoulder = B[`upperarm_${topSide}`].getWorldPosition(_c).applyMatrix4(_inv)
  const bw = rig.bladeWorld()
  const blade = bw ? bw.clone().applyMatrix4(_inv) : heel.clone()
  return {
    bottomOff,
    topY: topWorldY,
    topFwd: top.z - shoulder.z,
    bladeAhead: blade.z - top.z,
    bladeSide: Math.abs(blade.x - top.x),
    bladeY: bw ? bw.y : heel.y,
  }
}
