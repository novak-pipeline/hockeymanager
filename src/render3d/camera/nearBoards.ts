/**
 * W3 S7: the near boards (the broadcast camera's side) — where board play is
 * hidden by the dasher unless the camera frames it. Shared by the camera's
 * boom, the renderer's near-boards softening and VT9.
 */
/** NHL corner radius (ft). */
export const CORNER_R = 28
/**
 * The nearest point of the NEAR boards (the camera's side: the straight wall
 * and the two near corners) to (x, z), and how far it is; null past the
 * corners (the end boards are not near-boards play).
 */
export function nearBoardsPoint(x: number, z: number, halfL: number, halfW: number): { x: number; z: number; d: number } | null {
  if (z > 0) return null
  const sx = Math.abs(x)
  if (sx <= halfL - CORNER_R) return { x, z: -halfW, d: z + halfW }
  const cx = Math.sign(x) * (halfL - CORNER_R)
  const cz = -(halfW - CORNER_R)
  if (z > cz) return null
  const dx = x - cx
  const dz = z - cz
  const l = Math.hypot(dx, dz) || 1
  return { x: cx + (dx / l) * CORNER_R, z: cz + (dz / l) * CORNER_R, d: CORNER_R - l }
}

