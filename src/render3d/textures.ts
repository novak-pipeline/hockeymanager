/**
 * Procedural canvas art for the 3D arena: dasher-board ads, LED ribbon, the
 * jersey atlas, net mesh, contact-shadow blob, jumbotron screen. DOM canvas
 * only (no THREE) — the renderer wraps these in CanvasTextures.
 *
 * Every brand below is invented (fictional-by-default DB, CLAUDE.md §5).
 */

import { css, type Kit } from './palette'
import { mulberry32 } from './rng'

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  return [c, ctx]
}

const BRANDS: Array<{ text: string; bg: string; fg: string }> = [
  { text: 'NORTHPEAK', bg: '#ffffff', fg: '#1b6fb3' },
  { text: 'GLACIER AIR', bg: '#b3261e', fg: '#ffffff' },
  { text: 'IRONWOOD BANK', bg: '#ffffff', fg: '#2d4a2b' },
  { text: 'MAPLEFIELD', bg: '#10223f', fg: '#f2c14e' },
  { text: 'RIDGELINE TRUCKS', bg: '#ffffff', fg: '#222222' },
  { text: 'KESTREL', bg: '#f28c28', fg: '#ffffff' },
  { text: 'HALCYON MOBILE', bg: '#ffffff', fg: '#6a2c91' },
  { text: 'SUMMIT & CO', bg: '#0b6e4f', fg: '#ffffff' },
]

/** Feet of boards one dasher texture period covers. */
export const DASHER_PERIOD_FT = 96

/**
 * Dasher boards: white boards, yellow kick plate, ad panels. Texture v = 0 is
 * ice level, v = 1 the top of the 42" boards.
 */
export function buildDasherCanvas(): HTMLCanvasElement {
  const pxPerFt = 32
  const [c, ctx] = canvas(DASHER_PERIOD_FT * pxPerFt, Math.round(3.5 * pxPerFt))
  const H = c.height
  ctx.fillStyle = '#f3f4f2'
  ctx.fillRect(0, 0, c.width, H)
  // kick plate (bottom ~9")
  const kick = Math.round(0.75 * pxPerFt)
  ctx.fillStyle = '#e9b820'
  ctx.fillRect(0, H - kick, c.width, kick)
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.fillRect(0, H - kick, c.width, 2)
  // puck marks on the kick plate & boards
  const rnd = mulberry32(0xb0a2d)
  for (let i = 0; i < 160; i++) {
    const x = rnd() * c.width
    const y = H - kick * (0.2 + rnd() * 1.9)
    ctx.fillStyle = `rgba(20,20,20,${0.05 + rnd() * 0.18})`
    ctx.beginPath()
    ctx.ellipse(x, y, 2 + rnd() * 6, 1 + rnd() * 2, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  // ad panels
  const panelW = 12 * pxPerFt
  const top = Math.round(0.25 * pxPerFt)
  const ph = H - kick - top - 6
  for (let i = 0; i * panelW < c.width; i++) {
    const b = BRANDS[i % BRANDS.length]!
    const x = i * panelW + 8
    ctx.fillStyle = b.bg
    ctx.fillRect(x, top, panelW - 16, ph)
    ctx.fillStyle = b.fg
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `italic 900 ${Math.round(ph * 0.52)}px "Arial Black", Impact, sans-serif`
    ctx.fillText(b.text, x + (panelW - 16) / 2, top + ph / 2 + 2, panelW - 40)
  }
  return c
}

/** LED ribbon board (fascia between bowls) — emissive, scrolls in the shader via offset. */
export function buildRibbonCanvas(homeColor: number): HTMLCanvasElement {
  const [c, ctx] = canvas(2048, 64)
  ctx.fillStyle = '#05070b'
  ctx.fillRect(0, 0, c.width, c.height)
  const seg = 256
  for (let i = 0; i < c.width / seg; i++) {
    const x = i * seg
    if (i % 4 === 0) {
      const g = ctx.createLinearGradient(x, 0, x + seg, 0)
      g.addColorStop(0, css(homeColor))
      g.addColorStop(1, '#0a0f18')
      ctx.fillStyle = g
      ctx.fillRect(x + 2, 6, seg - 4, 52)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'italic 900 34px "Arial Black", Impact, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('THE SHOW', x + seg / 2, 33)
    } else {
      const b = BRANDS[(i * 3) % BRANDS.length]!
      ctx.fillStyle = b.bg === '#ffffff' ? '#0d1522' : b.bg
      ctx.fillRect(x + 2, 6, seg - 4, 52)
      ctx.fillStyle = b.bg === '#ffffff' ? b.fg : b.fg
      ctx.font = 'italic 900 26px "Arial Black", Impact, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(b.text, x + seg / 2, 33, seg - 20)
    }
  }
  return c
}

// ── jersey atlas ─────────────────────────────────────────────────────────────

/** Atlas: 6×6 slots of 256 px; one slot per rig (skaters on the ice, players
 *  skating off during a line change, and the goalies). */
export const ATLAS_GRID = 6
export const ATLAS_SLOT_PX = 256

/**
 * UV v-ranges inside one slot (0 = bottom). Geometry UVs are remapped into
 * these. `white` is a plain strip: solid-colour parts (breezers, helmet,
 * gloves, skin, skates, stick) sample it and take their colour from vertex
 * colours, so one material draws the whole player.
 */
export const ATLAS_REGIONS = {
  torso: [0.42, 1.0],
  sleeve: [0.26, 0.41],
  sock: [0.1, 0.25],
  white: [0.0, 0.08],
} as const

/** Fraction along the sleeve (0 = wrist, 1 = shoulder) of the elbow stripe band. */
export const SLEEVE_STRIPE_T = [0.27, 0.4] as const
/** Fraction along the sock (0 = ankle, 1 = breezer hem) of the sock stripe band. */
export const SOCK_STRIPE_T = [0.45, 0.68] as const

export function buildAtlasCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = ATLAS_GRID * ATLAS_SLOT_PX
  // CPU-backed: it is uploaded to WebGL on every repaint, and a GPU canvas
  // makes each upload a synchronous readback (a frame stall on line changes)
  c.getContext('2d', { willReadFrequently: true })
  return c
}

/** Atlas UV offset (bottom-left of the slot, UV space) for slot index. */
export function atlasOffset(slot: number): [number, number] {
  const col = slot % ATLAS_GRID
  const row = Math.floor(slot / ATLAS_GRID)
  // canvas row 0 is at the TOP of the image → UV v = 1 - (row+1)/grid
  return [col / ATLAS_GRID, 1 - (row + 1) / ATLAS_GRID]
}

function stripes(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, kit: Kit): void {
  // [trim2 thin][trim wide][trim2 thin] band
  const t = h / 5
  ctx.fillStyle = css(kit.trim2)
  ctx.fillRect(x, y, w, t)
  ctx.fillStyle = css(kit.trim)
  ctx.fillRect(x, y + t, w, t * 3)
  ctx.fillStyle = css(kit.trim2)
  ctx.fillRect(x, y + t * 4, w, t)
}

/** Paint one player's sweater/sleeves/socks into his atlas slot. */
export function paintJerseySlot(atlas: HTMLCanvasElement, slot: number, kit: Kit, num: number, goalie: boolean): void {
  const ctx = atlas.getContext('2d')!
  const S = ATLAS_SLOT_PX
  const ox = (slot % ATLAS_GRID) * S
  const oy = Math.floor(slot / ATLAS_GRID) * S
  const y = (v: number) => oy + (1 - v) * S // UV v → canvas y
  ctx.save()
  ctx.beginPath()
  ctx.rect(ox, oy, S, S)
  ctx.clip()
  ctx.fillStyle = css(kit.jersey)
  ctx.fillRect(ox, oy, S, S)

  // ── torso ──
  const [t0, t1] = ATLAS_REGIONS.torso
  const tH = (t1 - t0) * S
  // hem stripes
  stripes(ctx, ox, y(t0 + 0.2 * (t1 - t0)), S, tH * 0.13, kit)
  // shoulder yoke: a stripe across the shoulder caps (the very top stays
  // sweater-colored so the shoulders don't read as a white lid)
  ctx.fillStyle = css(kit.trim)
  ctx.fillRect(ox, y(t0 + 0.9 * (t1 - t0)), S, tH * 0.035)
  // back number (u = 0.5)
  const numStr = String(num)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  const fontPx = Math.round(tH * (goalie ? 0.36 : 0.42))
  ctx.font = `900 ${fontPx}px "Arial Black", Impact, sans-serif`
  const backY = y(t0 + 0.62 * (t1 - t0))
  ctx.lineWidth = Math.max(3, fontPx * 0.12)
  ctx.strokeStyle = css(kit.numberOutline)
  ctx.strokeText(numStr, ox + S * 0.5, backY, S * 0.3)
  ctx.fillStyle = css(kit.number)
  ctx.fillText(numStr, ox + S * 0.5, backY, S * 0.3)
  // front crest at u = 0 / 1 (wraps the lathe seam)
  const crestY = y(t0 + 0.6 * (t1 - t0))
  const cr = tH * 0.14
  for (const cx0 of [ox, ox + S]) {
    ctx.fillStyle = css(kit.trim)
    ctx.beginPath()
    ctx.arc(cx0, crestY, cr, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = css(kit.trim2)
    ctx.beginPath()
    ctx.arc(cx0, crestY, cr * 0.72, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = css(kit.trim)
    ctx.beginPath()
    // simple chevron emblem
    ctx.moveTo(cx0 - cr * 0.45, crestY + cr * 0.25)
    ctx.lineTo(cx0, crestY - cr * 0.4)
    ctx.lineTo(cx0 + cr * 0.45, crestY + cr * 0.25)
    ctx.lineTo(cx0 + cr * 0.25, crestY + cr * 0.35)
    ctx.lineTo(cx0, crestY - cr * 0.05)
    ctx.lineTo(cx0 - cr * 0.25, crestY + cr * 0.35)
    ctx.closePath()
    ctx.fill()
  }
  // small shoulder numbers at u = 0.25 / 0.75
  ctx.font = `900 ${Math.round(tH * 0.12)}px "Arial Black", Impact, sans-serif`
  for (const u of [0.25, 0.75]) {
    ctx.fillStyle = css(kit.number)
    ctx.fillText(numStr, ox + S * u, y(t0 + 0.86 * (t1 - t0)))
  }

  // ── sleeves: plain, with the classic stripe band just below the elbow ──
  const [f0, f1] = ATLAS_REGIONS.sleeve
  const fv = (t: number) => f0 + t * (f1 - f0)
  stripes(ctx, ox, y(fv(SLEEVE_STRIPE_T[1])), S, (fv(SLEEVE_STRIPE_T[1]) - fv(SLEEVE_STRIPE_T[0])) * S, kit)

  // ── socks ──
  const [s0, s1] = ATLAS_REGIONS.sock
  const sv = (t: number) => s0 + t * (s1 - s0)
  ctx.fillStyle = css(kit.socks)
  ctx.fillRect(ox, y(s1), S, (s1 - s0) * S)
  stripes(ctx, ox, y(sv(SOCK_STRIPE_T[1])), S, (sv(SOCK_STRIPE_T[1]) - sv(SOCK_STRIPE_T[0])) * S, kit)

  // ── knit texture: faint vertical ribs over all cloth (matte fabric read) ──
  ctx.globalAlpha = 0.05
  ctx.fillStyle = '#000000'
  for (let x = 0; x < S; x += 3) ctx.fillRect(ox + x, y(1), 1, (1 - s0) * S)
  ctx.globalAlpha = 1

  // ── white strip for vertex-coloured parts ──
  const [w0, w1] = ATLAS_REGIONS.white
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(ox, y(w1), S, (w1 - w0) * S)
  ctx.restore()
}

// ── small utility textures ──────────────────────────────────────────────────

/** Soft radial contact shadow (alpha in the red channel is NOT used — full RGBA). */
export function buildBlobCanvas(): HTMLCanvasElement {
  const [c, ctx] = canvas(128, 128)
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(0,0,0,0.55)')
  g.addColorStop(0.45, 'rgba(0,0,0,0.3)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  return c
}

/** Goal-net mesh: white diamond netting on transparent. Tile with RepeatWrapping. */
export function buildNetCanvas(): HTMLCanvasElement {
  const [c, ctx] = canvas(64, 64)
  ctx.clearRect(0, 0, 64, 64)
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(64, 64)
  ctx.moveTo(64, 0)
  ctx.lineTo(0, 64)
  ctx.stroke()
  return c
}

/** Center-hung video board face. Redrawn only when the displayed state changes. */
export function paintJumbotron(
  c: HTMLCanvasElement,
  s: { homeScore: number; awayScore: number; period: number; clock: string; homeColor: number; awayColor: number; goalFlash: number }
): void {
  const ctx = c.getContext('2d')!
  const W = c.width
  const H = c.height
  ctx.fillStyle = '#04060a'
  ctx.fillRect(0, 0, W, H)
  if (s.goalFlash > 0) {
    const on = Math.floor(s.goalFlash * 4) % 2 === 0
    ctx.fillStyle = on ? '#d61f2c' : '#10151f'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#ffffff'
    ctx.font = `italic 900 ${Math.round(H * 0.55)}px "Arial Black", Impact, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('GOAL!', W / 2, H / 2)
    return
  }
  const half = W / 2
  for (const [i, col, score] of [[0, s.homeColor, s.homeScore], [1, s.awayColor, s.awayScore]] as const) {
    const x = i * half
    const g = ctx.createLinearGradient(x, 0, x, H)
    g.addColorStop(0, css(col))
    g.addColorStop(1, '#05080e')
    ctx.fillStyle = g
    ctx.fillRect(x + 6, 6, half - 12, H * 0.62)
    ctx.fillStyle = '#ffffff'
    ctx.font = `900 ${Math.round(H * 0.5)}px "Arial Black", Impact, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(score), x + half / 2, H * 0.34)
    ctx.font = `700 ${Math.round(H * 0.11)}px Arial, sans-serif`
    ctx.fillText(i === 0 ? 'HOME' : 'AWAY', x + half / 2, H * 0.72)
  }
  ctx.fillStyle = '#f2c14e'
  ctx.font = `700 ${Math.round(H * 0.14)}px "Courier New", monospace`
  ctx.textAlign = 'center'
  const per = s.period <= 3 ? `P${s.period}` : s.period === 4 ? 'OT' : `${s.period - 3}OT`
  ctx.fillText(`${per}  ${s.clock}`, W / 2, H * 0.9)
}

/** An official's sweater in a procedural / Blender atlas slot: white with vertical black stripes, black socks. */
export function paintOfficialSlot(atlas: HTMLCanvasElement, slot: number, kit: Kit): void {
  paintJerseySlot(atlas, slot, kit, 0, false)
  const ctx = atlas.getContext('2d')!
  const S = atlas.width / ATLAS_GRID
  const [cu, cv] = atlasOffset(slot)
  const x0 = cu * atlas.width
  // atlas V runs bottom-up (UV space); canvas y top-down
  const band = (v0: number, v1: number) => [atlas.height - (cv + v1 / ATLAS_GRID) * atlas.height, (v1 - v0) * S] as const
  ctx.fillStyle = '#121212'
  for (const r of [ATLAS_REGIONS.torso, ATLAS_REGIONS.sleeve] as const) {
    const [y, h] = band(r[0], r[1])
    for (let k = 1; k < 16; k += 2) ctx.fillRect(x0 + (k / 16) * S, y, S / 16, h)
  }
  const [ys, hs] = band(ATLAS_REGIONS.sock[0], ATLAS_REGIONS.sock[1])
  ctx.fillRect(x0, ys, S, hs)
}
