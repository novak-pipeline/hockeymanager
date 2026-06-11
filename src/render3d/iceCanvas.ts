/**
 * Paints NHL rink markings to an offscreen 2048×1024 canvas so the 3D renderer
 * can use it as a CanvasTexture. Pure DOM canvas ops — no THREE dependency.
 *
 * Canvas coordinate system:
 *   left   = away-goal side   (normalized x = -1, world x = -100 ft)
 *   right  = home-goal side   (normalized x = +1, world x = +100 ft)
 *   top    = one boards side  (normalized y = -1)
 *   bottom = other boards     (normalized y = +1)
 */

const W = 2048
const H = 1024

/** Map normalized rink x to canvas px. */
function cx(nx: number): number {
  return ((nx + 1) / 2) * W
}
/** Map normalized rink y to canvas py. */
function cy(ny: number): number {
  return ((ny + 1) / 2) * H
}
/** Scale a normalized length (fraction of rink half-length) to canvas pixels. */
function sw(nw: number): number {
  return nw * W
}
/** Scale a normalized length (fraction of rink half-width) to canvas pixels. */
function sh(nw: number): number {
  return nw * H
}

/**
 * Draw a faceoff dot with four hash marks.
 *
 * @param ctx   2D rendering context
 * @param nx    normalized rink x
 * @param ny    normalized rink y
 * @param r     dot radius in canvas px
 */
function faceoffDot(ctx: CanvasRenderingContext2D, nx: number, ny: number, r: number): void {
  const x = cx(nx)
  const y = cy(ny)
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  // L-shaped hash marks (4 per dot, rotated 90° each)
  const hl = r * 2.5
  const hoff = r * 1.5
  ctx.save()
  ctx.translate(x, y)
  for (let q = 0; q < 4; q++) {
    ctx.save()
    ctx.rotate((q * Math.PI) / 2)
    ctx.beginPath()
    ctx.moveTo(hoff, 0)
    ctx.lineTo(hoff + hl, 0)
    ctx.moveTo(hoff, 0)
    ctx.lineTo(hoff, hl)
    ctx.stroke()
    ctx.restore()
  }
  ctx.restore()
}

/** Paint a full NHL-spec rink texture to an offscreen canvas and return it. */
export function buildIceCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get 2D context for ice canvas')

  // ── background: near-white ice ──────────────────────────────────────────
  ctx.fillStyle = '#f0f4f8'
  ctx.fillRect(0, 0, W, H)

  // ── rounded rect rink outline ────────────────────────────────────────────
  const r = sh(0.28) // corner radius (28/85 of rink width)
  ctx.strokeStyle = '#9fb0c3'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.roundRect(4, 4, W - 8, H - 8, r)
  ctx.stroke()

  // ── center red line ──────────────────────────────────────────────────────
  ctx.strokeStyle = '#d33b3b'
  ctx.lineWidth = sw(0.012)
  ctx.beginPath()
  ctx.moveTo(cx(0), 0)
  ctx.lineTo(cx(0), H)
  ctx.stroke()

  // ── blue lines (±0.25 of half-length) ───────────────────────────────────
  ctx.strokeStyle = '#2f6fd8'
  ctx.lineWidth = sw(0.012)
  for (const bx of [-0.25, 0.25]) {
    ctx.beginPath()
    ctx.moveTo(cx(bx), 0)
    ctx.lineTo(cx(bx), H)
    ctx.stroke()
  }

  // ── goal lines (±0.89) ───────────────────────────────────────────────────
  ctx.strokeStyle = '#d33b3b'
  ctx.lineWidth = sw(0.006)
  for (const gx of [-0.89, 0.89]) {
    ctx.beginPath()
    ctx.moveTo(cx(gx), cy(-0.88))
    ctx.lineTo(cx(gx), cy(0.88))
    ctx.stroke()
  }

  // ── center circle (r = 15ft, so 15/100 of half-length = 0.15 normalized) ─
  const centerR = sw(0.075) // 15ft radius, 200ft total, so 15/200 * W/2
  ctx.strokeStyle = '#2f6fd8'
  ctx.lineWidth = sw(0.008)
  ctx.beginPath()
  ctx.arc(cx(0), cy(0), centerR, 0, Math.PI * 2)
  ctx.stroke()
  // center faceoff dot
  ctx.fillStyle = '#2f6fd8'
  ctx.beginPath()
  ctx.arc(cx(0), cy(0), sw(0.008), 0, Math.PI * 2)
  ctx.fill()

  // ── end-zone faceoff circles (r = 15ft at ±0.69 x, ±0.48 y) ─────────────
  ctx.strokeStyle = '#d33b3b'
  ctx.lineWidth = sw(0.006)
  ctx.fillStyle = '#d33b3b'
  const ezR = sw(0.075)
  for (const ex of [-0.69, 0.69]) {
    for (const ey of [-0.48, 0.48]) {
      ctx.beginPath()
      ctx.arc(cx(ex), cy(ey), ezR, 0, Math.PI * 2)
      ctx.stroke()
      faceoffDot(ctx, ex, ey, sw(0.01))
    }
  }

  // ── neutral-zone faceoff dots (±0.2 x, ±0.48 y) ─────────────────────────
  for (const nx of [-0.2, 0.2]) {
    for (const ny of [-0.48, 0.48]) {
      faceoffDot(ctx, nx, ny, sw(0.01))
    }
  }

  // ── creases (6ft radius semicircle in front of each goal line) ───────────
  const creaseR = sw(0.03) // 6ft radius
  ctx.fillStyle = 'rgba(47, 111, 216, 0.22)'
  ctx.strokeStyle = '#2f6fd8'
  ctx.lineWidth = sw(0.004)
  for (const sign of [-1, 1] as const) {
    const gx = cx(sign * 0.89)
    const gy = cy(0)
    ctx.beginPath()
    // semicircle facing center ice
    ctx.arc(gx, gy, creaseR, sign < 0 ? -Math.PI / 2 : (Math.PI * 3) / 2, sign < 0 ? Math.PI / 2 : Math.PI / 2, sign < 0)
    ctx.lineTo(gx, gy + creaseR)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }

  // ── trapezoids ───────────────────────────────────────────────────────────
  // NHL trapezoid: goal line to end boards; base = 28ft (±0.165 y), top = 22ft (±0.129 y)
  ctx.strokeStyle = '#d33b3b'
  ctx.lineWidth = sw(0.004)
  for (const sign of [-1, 1] as const) {
    const glx = cx(sign * 0.89)
    const endx = sign < 0 ? 0 : W
    ctx.beginPath()
    ctx.moveTo(glx, cy(-0.165))
    ctx.lineTo(endx, cy(-0.129))
    ctx.moveTo(glx, cy(0.165))
    ctx.lineTo(endx, cy(0.129))
    ctx.stroke()
  }

  return canvas
}
