/**
 * Team kits for OWNER-supplied athletes (gltfAthlete OwnerAssets).
 *
 * owner_textures.py bakes each sweater texture into a KIT MAP: per texel a
 * class (0 keep the owner's pixel, 1 jersey, 2 trim, 3 trim2, 4 breezers,
 * 5 socks) and a shade (fabric, folds, stitching). A team's sweater is the
 * kit colour of the texel's class × its shade — computed once per team — and
 * each player's atlas slot gets that sweater plus HIS number (back + both
 * shoulders), name bar and a crest, painted into the decal boxes the PSD
 * gave us. One atlas → one clothes material for every player.
 *
 * Gear (helmet, gloves, skates, pads, face) keeps the owner's texture; its
 * accent colour (the yellow / gold in the source art) is swapped for the team
 * colour in the shader (gearMaterial).
 */

import * as THREE from 'three'
import type { Kit } from './palette'
import type { OwnerKitLayout, OwnerTextures } from './gltfAthlete'
import { ATLAS_GRID } from './textures'

/** Pixels per player slot in the owner kit atlas (6×6 slots → 3072²). */
export const OWNER_SLOT_PX = 512

type Role = 'skater' | 'goalie'

interface Source {
  d: Uint8ClampedArray
  k: Uint8ClampedArray
  size: number
  layout: OwnerKitLayout
}

async function imageData(url: string): Promise<{ data: Uint8ClampedArray; size: number }> {
  const img = new Image()
  img.src = url
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  return { data: ctx.getImageData(0, 0, c.width, c.height).data, size: c.width }
}

const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`

export class OwnerKitPainter {
  private readonly teams = new Map<string, HTMLCanvasElement>()

  private constructor(private readonly src: Partial<Record<Role, Source>>) {}

  static async load(tex: { skater: OwnerTextures; goalie: OwnerTextures | null }, layout: { skater: OwnerKitLayout; goalie: OwnerKitLayout | null }): Promise<OwnerKitPainter> {
    const one = async (t: OwnerTextures, l: OwnerKitLayout): Promise<Source> => {
      const [d, k] = await Promise.all([imageData(t.clothesD), imageData(t.clothesK)])
      return { d: d.data, k: k.data, size: d.size, layout: l }
    }
    const src: Partial<Record<Role, Source>> = { skater: await one(tex.skater, layout.skater) }
    if (tex.goalie && layout.goalie) src.goalie = await one(tex.goalie, layout.goalie)
    return new OwnerKitPainter(src)
  }

  has(role: Role): boolean {
    return !!this.src[role]
  }

  /** The team's sweater (no number): kit colour per texel class × shade. Cached per kit. */
  team(role: Role, kit: Kit): HTMLCanvasElement {
    const key = `${role}:${kit.jersey}:${kit.trim}:${kit.trim2}:${kit.pants}:${kit.socks}`
    const hit = this.teams.get(key)
    if (hit) return hit
    const s = this.src[role] ?? this.src.skater!
    const c = document.createElement('canvas')
    c.width = c.height = s.size
    const ctx = c.getContext('2d')!
    const out = ctx.createImageData(s.size, s.size)
    const o = out.data
    const pal: number[][] = [[0, 0, 0], ...[kit.jersey, kit.trim, kit.trim2, kit.pants, kit.socks].map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255])]
    const { d, k } = s
    for (let i = 0; i < o.length; i += 4) {
      const cls = Math.round(k[i]! / 40)
      if (cls <= 0 || cls > 5) {
        o[i] = d[i]!
        o[i + 1] = d[i + 1]!
        o[i + 2] = d[i + 2]!
      } else {
        const sh = k[i + 1]! / 200
        const p = pal[cls]!
        o[i] = p[0]! * sh
        o[i + 1] = p[1]! * sh
        o[i + 2] = p[2]! * sh
      }
      o[i + 3] = 255
    }
    ctx.putImageData(out, 0, 0)
    if (this.teams.size > 8) this.teams.clear()
    this.teams.set(key, c)
    return c
  }

  /** Paint one player's sweater into his slot of the kit atlas. */
  paint(atlas: HTMLCanvasElement, slot: number, role: Role, kit: Kit, num: number, name: string): void {
    const ctx = atlas.getContext('2d')!
    const S = atlas.width / ATLAS_GRID
    const ox = (slot % ATLAS_GRID) * S
    const oy = Math.floor(slot / ATLAS_GRID) * S
    const src = this.src[role] ?? this.src.skater!
    ctx.save()
    ctx.beginPath()
    ctx.rect(ox, oy, S, S)
    ctx.clip()
    ctx.drawImage(this.team(role, kit), ox, oy, S, S)
    const L = src.layout
    const box = (k: keyof OwnerKitLayout['boxes']) => {
      const b = L.boxes[k]
      return b ? { x: ox + b[0] * S, y: oy + b[1] * S, w: (b[2] - b[0]) * S, h: (b[3] - b[1]) * S } : null
    }
    const text = (k: keyof OwnerKitLayout['boxes'], str: string, fill: number, outline: number, weight = 900) => {
      const b = box(k)
      if (!b) return
      const rot = ((L.rotation[k] ?? 0) * Math.PI) / 180
      const vertical = Math.abs(Math.sin(rot)) > 0.5
      const bw = vertical ? b.h : b.w
      const bh = vertical ? b.w : b.h
      ctx.save()
      ctx.translate(b.x + b.w / 2, b.y + b.h / 2)
      ctx.rotate(rot)
      const px = Math.max(6, Math.round(bh * 0.95))
      ctx.font = `${weight} ${px}px "Arial Black", Impact, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineJoin = 'round'
      ctx.lineWidth = Math.max(1.5, px * 0.1)
      ctx.strokeStyle = css(outline)
      ctx.strokeText(str, 0, px * 0.04, bw)
      ctx.fillStyle = css(fill)
      ctx.fillText(str, 0, px * 0.04, bw)
      ctx.restore()
    }
    const numStr = String(num)
    text('numberBack', numStr, kit.number, kit.numberOutline)
    text('numberLeft', numStr, kit.number, kit.numberOutline)
    text('numberRight', numStr, kit.number, kit.numberOutline)
    if (name) text('name', name.toUpperCase(), kit.number, kit.numberOutline, 800)
    // crests: the team roundel (front) and shoulder patches
    for (const k of ['crestFront', 'crestLeft', 'crestRight'] as const) {
      const b = box(k)
      if (!b) continue
      const r = Math.min(b.w, b.h) * 0.48
      const cx = b.x + b.w / 2
      const cy = b.y + b.h / 2
      ctx.fillStyle = css(kit.trim)
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = css(kit.jersey)
      ctx.beginPath()
      ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = css(kit.trim2)
      ctx.beginPath()
      ctx.arc(cx, cy, r * 0.38, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
}

/** The owner kit atlas: 6×6 player slots (same slot numbering as the procedural atlas). */
export function buildOwnerAtlasCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = OWNER_SLOT_PX * ATLAS_GRID
  return c
}

const loader = new THREE.TextureLoader()

export async function loadTexture(url: string, srgb: boolean): Promise<THREE.Texture> {
  const t = await loader.loadAsync(url)
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.anisotropy = 8
  return t
}

/**
 * The gear material (helmet, gloves, skates, pads, face): the owner's texture,
 * with its accent colour (yellow / gold texels) swapped for `accent`.
 */
export function gearMaterial(map: THREE.Texture, normal: THREE.Texture, accent: number): THREE.MeshStandardMaterial {
  const n = normal.clone()
  n.channel = 1
  const m = new THREE.MeshStandardMaterial({ map, normalMap: n, roughness: 0.62, metalness: 0 })
  const uAccent = { value: new THREE.Color(accent) }
  m.userData.uAccent = uAccent
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uAccent = uAccent
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uAccent;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  {
    vec3 c = diffuseColor.rgb;
    float r = max(c.r, 1e-4);
    // yellow / gold: red-led, green 30-85% of red, almost no blue
    float k = smoothstep(0.08, 0.16, c.r) * smoothstep(0.25, 0.35, c.g / r) * (1.0 - smoothstep(0.8, 0.92, c.g / r)) * (1.0 - smoothstep(0.12, 0.25, c.b / r));
    vec3 tint = uAccent * clamp(c.r / 0.9, 0.0, 1.2);
    diffuseColor.rgb = mix(c, tint, k);
  }`
      )
  }
  m.customProgramCacheKey = () => 'owner-gear-v1'
  return m
}

export function clothesMaterial(atlas: THREE.Texture, normal: THREE.Texture): THREE.MeshStandardMaterial {
  const n = normal.clone()
  n.channel = 1
  return new THREE.MeshStandardMaterial({ map: atlas, normalMap: n, roughness: 0.82, metalness: 0 })
}

export function visorMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x9fb2c4, transparent: true, opacity: 0.3, roughness: 0.06, metalness: 0.3, depthWrite: false })
}
