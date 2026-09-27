/**
 * Paints the ice sheet — NHL markings at true scale plus the "lived-in" layer
 * (painted-under-ice softness, skate scuffs, snow at the boards) — to offscreen
 * canvases the 3D renderer uses as CanvasTextures. Pure DOM canvas ops, no THREE.
 *
 * Canvas ↔ world mapping (1 world unit = 1 ft, rink 200 × 85, 28 ft corners):
 *   canvas x = (worldX + 100) * PX     canvas y = (worldZ + 42.5) * PX
 * The ice mesh's UVs are built to match (see arena.ts), so canvas pixels are
 * SQUARE in world space — circles stay circles (the old 2048×1024 canvas
 * stretched every faceoff circle into an ellipse).
 *
 * All geometry below is NHL rulebook spec in feet.
 */

import { mulberry32 } from './rng'

/** Canvas pixels per foot. */
export const ICE_PX_PER_FT = 14
export const RINK_HALF_L = 100
export const RINK_HALF_W = 42.5
export const RINK_CORNER_R = 28

const PX = ICE_PX_PER_FT
const W = Math.round(RINK_HALF_L * 2 * PX)
const H = Math.round(RINK_HALF_W * 2 * PX)

const RED = '#c42b36'
const BLUE = '#1d4fa6'
const CREASE = 'rgba(96, 160, 226, 0.55)'
const INCH = 1 / 12

const X = (x: number) => (x + RINK_HALF_L) * PX
const Z = (z: number) => (z + RINK_HALF_W) * PX

function rinkPath(ctx: CanvasRenderingContext2D, inset = 0): void {
  ctx.beginPath()
  ctx.roundRect(inset * PX, inset * PX, W - inset * 2 * PX, H - inset * 2 * PX, (RINK_CORNER_R - inset) * PX)
}

function line(ctx: CanvasRenderingContext2D, x1: number, z1: number, x2: number, z2: number, widthFt: number, color: string): void {
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1.5, widthFt * PX)
  ctx.beginPath()
  ctx.moveTo(X(x1), Z(z1))
  ctx.lineTo(X(x2), Z(z2))
  ctx.stroke()
}

function circle(ctx: CanvasRenderingContext2D, x: number, z: number, r: number, widthFt: number, color: string): void {
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1.5, widthFt * PX)
  ctx.beginPath()
  ctx.arc(X(x), Z(z), r * PX, 0, Math.PI * 2)
  ctx.stroke()
}

function disc(ctx: CanvasRenderingContext2D, x: number, z: number, r: number, color: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(X(x), Z(z), r * PX, 0, Math.PI * 2)
  ctx.fill()
}

/** End-zone faceoff spot: circle, hash marks, L-marks, striped dot. */
function endZoneCircle(ctx: CanvasRenderingContext2D, x: number, z: number): void {
  const w = 2 * INCH
  circle(ctx, x, z, 15, w, RED)
  // Hash marks: 2 ft long, 5'11" apart, off the sides of the circle nearest
  // the boards and nearest the middle (where the wingers line up).
  for (const zs of [-1, 1]) {
    for (const dx of [-2.96, 2.96]) {
      const zEdge = z + zs * Math.sqrt(15 * 15 - dx * dx)
      line(ctx, x + dx, zEdge, x + dx, zEdge + zs * 2, w, RED)
    }
  }
  // L-marks around the dot (centers line up here).
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx0 = x + sx * 2
      const cz0 = z + sz * 0.75
      line(ctx, cx0, cz0, cx0 + sx * 4, cz0, w, RED)
      line(ctx, cx0, cz0, cx0, cz0 + sz * 3, w, RED)
    }
  }
  // 2 ft dot with the two white inner stripes
  disc(ctx, x, z, 1, RED)
  ctx.fillStyle = 'rgba(240,244,248,0.9)'
  for (const s of [-1, 1]) {
    ctx.fillRect(X(x - 0.8), Z(z + s * 0.42) - 0.12 * PX, 1.6 * PX, 0.24 * PX)
  }
}

function crease(ctx: CanvasRenderingContext2D, sign: 1 | -1): void {
  const gx = sign * 89
  const inward = -sign // toward center ice
  ctx.save()
  // straight 4.5 ft sides at ±4 ft, then the 6 ft arc
  ctx.beginPath()
  ctx.moveTo(X(gx), Z(-4))
  ctx.lineTo(X(gx + inward * 4.5), Z(-4))
  const a0 = Math.asin(4 / 6)
  const cxp = X(gx)
  const czp = Z(0)
  if (inward < 0) {
    ctx.arc(cxp, czp, 6 * PX, Math.PI + a0, Math.PI - a0, true)
  } else {
    ctx.arc(cxp, czp, 6 * PX, -a0, a0, false)
  }
  ctx.lineTo(X(gx + inward * 4.5), Z(4))
  ctx.lineTo(X(gx), Z(4))
  ctx.closePath()
  ctx.fillStyle = CREASE
  ctx.fill()
  ctx.strokeStyle = RED
  ctx.lineWidth = Math.max(1.5, 2 * INCH * PX)
  ctx.stroke()
  ctx.restore()
}

/**
 * The home club's logo at centre ice (a mod logo pack), painted under the ice:
 * fits a ~26 ft circle, slightly faded, oriented to read from the main
 * (-Z) broadcast side.
 */
function clubCenterLogo(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }): void {
  const cx0 = X(0)
  const cz0 = Z(0)
  const box = 26 * PX
  const k = Math.min(box / img.width, box / img.height)
  const w = img.width * k
  const h = img.height * k
  ctx.save()
  ctx.globalAlpha = 0.88
  ctx.translate(cx0, cz0)
  ctx.rotate(Math.PI)
  ctx.drawImage(img, -w / 2, -h / 2, w, h)
  ctx.restore()
}

/** Fictional center-ice league roundel — shipped DB is fictional by default. */
function centerLogo(ctx: CanvasRenderingContext2D): void {
  const cx0 = X(0)
  const cz0 = Z(0)
  const R = 10.5 * PX
  ctx.save()
  ctx.globalAlpha = 0.86
  const g = ctx.createRadialGradient(cx0, cz0 - R * 0.3, R * 0.1, cx0, cz0, R)
  g.addColorStop(0, '#20355f')
  g.addColorStop(1, '#0f1e3d')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx0, cz0, R, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = 0.55 * PX
  ctx.strokeStyle = '#c9d3e0'
  ctx.beginPath()
  ctx.arc(cx0, cz0, R - 0.8 * PX, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 0.18 * PX
  ctx.strokeStyle = '#b8323c'
  ctx.beginPath()
  ctx.arc(cx0, cz0, R - 1.6 * PX, 0, Math.PI * 2)
  ctx.stroke()
  // Text reads correctly from the main (−Z) broadcast side: that camera sees
  // this canvas rotated 180° (screen-right = world −X, screen-up = world +Z).
  ctx.translate(cx0, cz0)
  ctx.rotate(Math.PI)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#e9eef5'
  ctx.font = `italic 900 ${5.4 * PX}px "Arial Black", Impact, sans-serif`
  ctx.fillText('SHOW', 0, 0.5 * PX)
  ctx.font = `700 ${1.7 * PX}px Arial, sans-serif`
  ctx.fillText('T H E', 0, -4.1 * PX)
  ctx.fillStyle = '#b8323c'
  ctx.fillText('HOCKEY', 0, 4.9 * PX)
  ctx.restore()
}

/** Fictional ice ads (painted under the surface, so faded). */
function iceAds(ctx: CanvasRenderingContext2D): void {
  const ads: Array<{ x: number; text: string; color: string }> = [
    { x: -12.5, text: 'NORTHPEAK', color: '#1b6fb3' },
    { x: 12.5, text: 'GLACIER AIR', color: '#b3261e' },
  ]
  for (const ad of ads) {
    for (const z of [-31, 31]) {
      ctx.save()
      ctx.translate(X(ad.x), Z(z))
      ctx.rotate(Math.PI) // read from the broadcast side
      ctx.globalAlpha = 0.3
      ctx.fillStyle = ad.color
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `italic 900 ${2.4 * PX}px "Arial Black", Impact, sans-serif`
      ctx.fillText(ad.text, 0, 0, 19 * PX)
      ctx.restore()
    }
  }
}

/** Skate-mark arcs clustered where play actually happens. */
function scuffs(ctx: CanvasRenderingContext2D, rng: () => number, forRoughness: boolean): void {
  const hot: Array<[number, number, number, number]> = [
    // x, z, radius, weight
    [0, 0, 18, 1.2],
    [-69, -22, 16, 1.4], [-69, 22, 16, 1.4], [69, -22, 16, 1.4], [69, 22, 16, 1.4],
    [-80, 0, 14, 2.2], [80, 0, 14, 2.2],
    [-20, -22, 9, 0.7], [-20, 22, 9, 0.7], [20, -22, 9, 0.7], [20, 22, 9, 0.7],
    [-45, 0, 40, 1.6], [45, 0, 40, 1.6],
  ]
  const total = hot.reduce((a, h) => a + h[3], 0)
  ctx.save()
  ctx.lineCap = 'round'
  for (let i = 0; i < 2600; i++) {
    let pick = rng() * total
    let h = hot[0]!
    for (const c of hot) {
      pick -= c[3]
      if (pick <= 0) { h = c; break }
    }
    const ang = rng() * Math.PI * 2
    const rr = Math.sqrt(rng()) * h[2]
    const x = h[0] + Math.cos(ang) * rr
    const z = h[1] + Math.sin(ang) * rr * 0.8
    const arcR = (4 + rng() * 22) * PX
    const a0 = rng() * Math.PI * 2
    const sweep = (0.08 + rng() * 0.35) * (rng() < 0.5 ? -1 : 1)
    if (forRoughness) {
      ctx.strokeStyle = `rgba(255,255,255,${0.12 + rng() * 0.2})`
      ctx.lineWidth = 0.18 * PX + rng() * 0.25 * PX
    } else {
      ctx.strokeStyle = rng() < 0.7 ? `rgba(255,255,255,${0.08 + rng() * 0.16})` : `rgba(150,165,180,${0.05 + rng() * 0.08})`
      ctx.lineWidth = 0.06 * PX + rng() * 0.12 * PX
    }
    ctx.beginPath()
    ctx.arc(X(x) - Math.cos(a0) * arcR, Z(z) - Math.sin(a0) * arcR, arcR, a0, a0 + sweep, sweep < 0)
    ctx.stroke()
  }
  ctx.restore()
}

/** Snow / shaved ice piled against the boards. */
function boardSnow(ctx: CanvasRenderingContext2D, alpha: number): void {
  ctx.save()
  rinkPath(ctx, 0)
  ctx.clip()
  for (let i = 0; i < 6; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${alpha * (1 - i / 6)})`
    ctx.lineWidth = (0.6 + i * 0.9) * PX
    rinkPath(ctx, 0)
    ctx.stroke()
  }
  ctx.restore()
}

/** Paint the full rink color texture. */
export function buildIceCanvas(opts: { centerLogo?: (CanvasImageSource & { width: number; height: number }) | null } = {}): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get 2D context for ice canvas')
  const rng = mulberry32(0x1ce)

  // ── base: cool white with faint cloudiness (ice depth variation) ─────────
  ctx.fillStyle = '#e9eef3'
  ctx.fillRect(0, 0, W, H)
  for (let i = 0; i < 90; i++) {
    const x = rng() * W
    const y = rng() * H
    const r = (10 + rng() * 40) * PX
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    const tint = rng() < 0.5 ? '255,255,255' : '205,220,235'
    g.addColorStop(0, `rgba(${tint},${0.05 + rng() * 0.08})`)
    g.addColorStop(1, `rgba(${tint},0)`)
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }

  ctx.save()
  rinkPath(ctx)
  ctx.clip()

  // ── lines ────────────────────────────────────────────────────────────────
  // Centre red line: 12", with the rulebook's white interruptions.
  line(ctx, 0, -RINK_HALF_W, 0, RINK_HALF_W, 1, RED)
  ctx.fillStyle = 'rgba(238,243,247,0.95)'
  for (let z = -RINK_HALF_W + 1; z < RINK_HALF_W; z += 2.5) {
    ctx.fillRect(X(-0.1), Z(z), 0.2 * PX, 0.9 * PX)
  }
  for (const bx of [-25, 25]) line(ctx, bx, -RINK_HALF_W, bx, RINK_HALF_W, 1, BLUE)
  for (const gx of [-89, 89]) line(ctx, gx, -RINK_HALF_W, gx, RINK_HALF_W, 2 * INCH, RED)

  if (opts.centerLogo && opts.centerLogo.width > 0) clubCenterLogo(ctx, opts.centerLogo)
  else centerLogo(ctx)
  circle(ctx, 0, 0, 15, 2 * INCH, BLUE)
  disc(ctx, 0, 0, 0.5, BLUE)

  for (const ex of [-69, 69]) for (const ez of [-22, 22]) endZoneCircle(ctx, ex, ez)
  for (const nx of [-20, 20]) for (const nz of [-22, 22]) disc(ctx, nx, nz, 1, RED)

  crease(ctx, -1)
  crease(ctx, 1)

  // Trapezoid behind each net: 22 ft at the goal line → 28 ft at the boards.
  for (const s of [-1, 1] as const) {
    line(ctx, s * 89, -11, s * 100, -14, 2 * INCH, RED)
    line(ctx, s * 89, 11, s * 100, 14, 2 * INCH, RED)
  }
  // Referee's crease (10 ft semicircle) on the broadcast-side boards.
  ctx.strokeStyle = RED
  ctx.lineWidth = Math.max(1.5, 2 * INCH * PX)
  ctx.beginPath()
  ctx.arc(X(0), Z(-RINK_HALF_W), 10 * PX, 0, Math.PI)
  ctx.stroke()

  iceAds(ctx)

  // ── "painted under the ice": a thin frost veil softens all paint ─────────
  ctx.fillStyle = 'rgba(236,242,247,0.14)'
  ctx.fillRect(0, 0, W, H)

  scuffs(ctx, rng, false)
  boardSnow(ctx, 0.22)
  ctx.restore()

  return canvas
}

/**
 * Roughness map (green channel read by three.js): polished ice is dark (glossy),
 * skate-worn areas and board snow are lighter (rougher), which breaks up the
 * overhead-light reflections exactly where the ice gets chewed up.
 */
export function buildIceRoughnessCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get 2D context for ice roughness')
  const rng = mulberry32(0x1ce)
  ctx.fillStyle = 'rgb(60,60,60)'
  ctx.fillRect(0, 0, W, H)
  scuffs(ctx, rng, true)
  boardSnow(ctx, 0.5)
  return canvas
}
