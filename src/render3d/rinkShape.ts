/**
 * Rounded-rink outline + profile sweeping — pure geometry (no THREE) used to
 * build the boards, glass, seating bowl and LED ribbons as single meshes that
 * follow the real 28 ft corner radius (the old boards were a square box).
 */

export interface OutlinePoint {
  x: number
  z: number
  /** Outward unit normal. */
  nx: number
  nz: number
  /** Cumulative arc length from the first point (ft). */
  s: number
}

/**
 * Closed rounded-rectangle outline (first point NOT repeated at the end).
 * Corners are sampled with `segsPerCorner` segments; straights are implicit
 * between consecutive corners. Points run counter-clockwise seen from +Y
 * (from the +X side toward +Z).
 */
export function rinkOutline(halfL: number, halfW: number, r: number, segsPerCorner = 12): OutlinePoint[] {
  const rr = Math.max(0, Math.min(r, halfL, halfW))
  const centers: Array<[number, number]> = [
    [halfL - rr, halfW - rr],
    [-(halfL - rr), halfW - rr],
    [-(halfL - rr), -(halfW - rr)],
    [halfL - rr, -(halfW - rr)],
  ]
  const pts: OutlinePoint[] = []
  for (let c = 0; c < 4; c++) {
    const [cx, cz] = centers[c]!
    for (let i = 0; i <= segsPerCorner; i++) {
      const a = (c * Math.PI) / 2 + (i / segsPerCorner) * (Math.PI / 2)
      const nx = Math.cos(a)
      const nz = Math.sin(a)
      pts.push({ x: cx + rr * nx, z: cz + rr * nz, nx, nz, s: 0 })
    }
  }
  let s = 0
  for (let i = 1; i < pts.length; i++) {
    s += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z)
    pts[i]!.s = s
  }
  return pts
}

/** Total closed perimeter length of an outline. */
export function outlineLength(pts: OutlinePoint[]): number {
  const last = pts[pts.length - 1]!
  const first = pts[0]!
  return last.s + Math.hypot(first.x - last.x, first.z - last.z)
}

/** Analytic perimeter of a rounded rectangle (for tests / sanity). */
export function roundedRectPerimeter(halfL: number, halfW: number, r: number): number {
  return 4 * (halfL - r) + 4 * (halfW - r) + 2 * Math.PI * r
}

export interface ProfilePoint {
  /** Offset along the outward normal (ft). */
  o: number
  y: number
}

export interface SweptGeometry {
  positions: Float32Array
  uvs: Float32Array
  indices: Uint32Array
}

/**
 * Sweep a 2D profile (in outward-offset / height space) around a closed
 * outline. Each profile segment gets its own vertex strip so profile corners
 * stay hard-edged (steps, cap rails). u = arc length / uPeriod, v runs 0..1
 * along each profile segment. Triangles face the side the profile turns
 * toward: walking the profile with increasing y (or decreasing o) faces inward.
 */
export function sweepProfile(outline: OutlinePoint[], profile: ProfilePoint[], uPeriod = 1): SweptGeometry {
  const n = outline.length + 1 // repeat first point to close the loop with its own u
  const total = outlineLength(outline)
  const segs = profile.length - 1
  const positions = new Float32Array(segs * n * 2 * 3)
  const uvs = new Float32Array(segs * n * 2 * 2)
  const indices = new Uint32Array(segs * (n - 1) * 6)
  let vi = 0
  let ii = 0
  for (let k = 0; k < segs; k++) {
    const p0 = profile[k]!
    const p1 = profile[k + 1]!
    const base = k * n * 2
    for (let i = 0; i < n; i++) {
      const op = outline[i % outline.length]!
      const s = i === outline.length ? total : op.s
      for (const [p, v] of [[p0, 0], [p1, 1]] as const) {
        positions[vi * 3] = op.x + op.nx * p.o
        positions[vi * 3 + 1] = p.y
        positions[vi * 3 + 2] = op.z + op.nz * p.o
        uvs[vi * 2] = s / uPeriod
        uvs[vi * 2 + 1] = v
        vi++
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2
      const b = a + 1
      const c = a + 2
      const d = a + 3
      indices[ii++] = a
      indices[ii++] = b
      indices[ii++] = c
      indices[ii++] = b
      indices[ii++] = d
      indices[ii++] = c
    }
  }
  return { positions, uvs, indices }
}

/**
 * Evenly spaced stations along an outline (e.g. glass stanchions, seats).
 * Returns positions + outward normals; `phase` shifts the first station.
 */
export function stationsAlong(outline: OutlinePoint[], spacing: number, phase = 0): Array<{ x: number; z: number; nx: number; nz: number; s: number }> {
  const total = outlineLength(outline)
  const out: Array<{ x: number; z: number; nx: number; nz: number; s: number }> = []
  let seg = 0
  for (let s = phase; s < total - 1e-6; s += spacing) {
    while (seg < outline.length - 1 && outline[seg + 1]!.s < s) seg++
    const a = outline[seg]!
    const b = seg + 1 < outline.length ? outline[seg + 1]! : { ...outline[0]!, s: total }
    const span = b.s - a.s
    const t = span > 1e-9 ? (s - a.s) / span : 0
    let nx = a.nx + (b.nx - a.nx) * t
    let nz = a.nz + (b.nz - a.nz) * t
    const nl = Math.hypot(nx, nz) || 1
    nx /= nl
    nz /= nl
    out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, nx, nz, s })
  }
  return out
}
