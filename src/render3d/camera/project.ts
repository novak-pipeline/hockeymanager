/**
 * W3 S7: a camera pose and where a world point lands on its screen — the same
 * pinhole THREE.PerspectiveCamera.lookAt draws (up = +y), with no THREE, so
 * the framing rules and the offline VT9 harness can project without a scene.
 */

export interface CamPose {
  px: number
  py: number
  pz: number
  lx: number
  ly: number
  lz: number
  /** Vertical field of view, degrees. */
  fov: number
}

export interface Ndc {
  /** −1 … 1 across the screen (left → right); outside = off screen. */
  x: number
  /** −1 … 1 up the screen (bottom → top). */
  y: number
  /** In front of the camera. */
  front: boolean
}

/** Normalized device coordinates of world point (x, y, z) for `pose` at `aspect` (w/h). */
export function projectNdc(pose: CamPose, aspect: number, x: number, y: number, z: number): Ndc {
  let fx = pose.lx - pose.px
  let fy = pose.ly - pose.py
  let fz = pose.lz - pose.pz
  const fl = Math.hypot(fx, fy, fz) || 1
  fx /= fl
  fy /= fl
  fz /= fl
  // right = f × up(0,1,0)
  let rx = -fz
  let rz = fx
  const rl = Math.hypot(rx, rz) || 1
  rx /= rl
  rz /= rl
  // up' = r × f
  const ux = -rz * fy
  const uy = rz * fx - rx * fz
  const uz = rx * fy
  const dx = x - pose.px
  const dy = y - pose.py
  const dz = z - pose.pz
  const cz = dx * fx + dy * fy + dz * fz
  const cx = dx * rx + dz * rz
  const cy = dx * ux + dy * uy + dz * uz
  const tv = Math.tan((pose.fov * Math.PI) / 360)
  const th = tv * aspect
  if (cz <= 1e-6) return { x: Infinity, y: Infinity, front: false }
  return { x: cx / (cz * th), y: cy / (cz * tv), front: true }
}

/** Inside the centred box of half-size `m` (1 = the whole screen). */
export function inBox(n: Ndc, mx: number, my = mx): boolean {
  return n.front && Math.abs(n.x) <= mx && Math.abs(n.y) <= my
}
