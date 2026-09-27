/**
 * Partial uploads for the jersey atlases.
 *
 * A line change repaints a few player slots. Flagging the whole CanvasTexture
 * `needsUpdate` re-uploads the ENTIRE atlas (1536² procedural/Blender, 3072²
 * owner) and rebuilds its mip chain on the main thread — measured as 58–100 ms
 * frame hitches in the middle of play. Instead only the dirty slots go up
 * (texSubImage2D of a slot-sized crop), then the mips are regenerated on the
 * GPU. Falls back to a full upload until the texture has been uploaded once.
 */

import * as THREE from 'three'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export class AtlasUploader {
  private readonly dirty = new Map<string, Rect>()
  private scratch: HTMLCanvasElement | null = null

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly tex: THREE.Texture,
    private readonly canvas: HTMLCanvasElement
  ) {}

  /** Mark a canvas region (top-left origin, px) for upload. */
  mark(r: Rect): void {
    this.dirty.set(`${r.x},${r.y},${r.w},${r.h}`, r)
  }

  get pending(): boolean {
    return this.dirty.size > 0
  }

  /** Upload what's dirty. Returns true if it went up as sub-images. */
  flush(): boolean {
    if (this.dirty.size === 0) return false
    const props = this.renderer.properties.get(this.tex) as { __webglTexture?: WebGLTexture; __version?: number }
    const gl = this.renderer.getContext() as WebGL2RenderingContext
    const uploaded = !!props.__webglTexture && props.__version === this.tex.version
    // many slots (a new game) → one full upload is cheaper than many sub-images
    if (!uploaded || this.dirty.size > 12) {
      this.dirty.clear()
      this.tex.needsUpdate = true
      return false
    }
    const state = this.renderer.state
    state.activeTexture(gl.TEXTURE0)
    state.bindTexture(gl.TEXTURE_2D, props.__webglTexture!)
    // through three's state cache (its typings omit pixelStorei; raw gl calls
    // would desync the cache and corrupt later uploads)
    const cached = state as unknown as { pixelStorei?: (p: number, v: number | boolean) => void }
    const store = cached.pixelStorei ? cached.pixelStorei.bind(state) : null
    if (!store) {
      this.dirty.clear()
      this.tex.needsUpdate = true
      return false
    }
    store(gl.UNPACK_FLIP_Y_WEBGL, this.tex.flipY)
    store(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, this.tex.premultiplyAlpha)
    store(gl.UNPACK_ALIGNMENT, 4)
    const H = this.canvas.height
    for (const r of this.dirty.values()) {
      const s = this.crop(r)
      // flipY: GL row 0 is the canvas bottom
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, this.tex.flipY ? H - (r.y + r.h) : r.y, gl.RGBA, gl.UNSIGNED_BYTE, s)
    }
    if (this.tex.generateMipmaps && this.tex.minFilter !== THREE.LinearFilter && this.tex.minFilter !== THREE.NearestFilter) gl.generateMipmap(gl.TEXTURE_2D)
    this.dirty.clear()
    return true
  }

  private crop(r: Rect): HTMLCanvasElement {
    if (!this.scratch || this.scratch.width !== r.w || this.scratch.height !== r.h) {
      this.scratch = document.createElement('canvas')
      this.scratch.width = r.w
      this.scratch.height = r.h
    }
    const ctx = this.scratch.getContext('2d', { willReadFrequently: true })!
    ctx.clearRect(0, 0, r.w, r.h)
    ctx.drawImage(this.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
    return this.scratch
  }
}
