/**
 * The arena: ice, boards/glass, nets, benches, seating bowl + crowd, ribbon
 * boards, center-hung video board, overhead light rig, and the image-based
 * lighting environment. All procedural (no model files).
 *
 * Draw-call budget (static): ~30. The crowd is 2 instanced draws.
 */

import * as THREE from 'three'
import { buildIceCanvas, buildIceRoughnessCanvas, RINK_CORNER_R, RINK_HALF_L, RINK_HALF_W } from './iceCanvas'
import { rinkOutline, stationsAlong, sweepProfile, type ProfilePoint } from './rinkShape'
import { buildBlobCanvas, buildDasherCanvas, buildNetCanvas, buildRibbonCanvas, DASHER_PERIOD_FT, paintJumbotron } from './textures'
import { mulberry32 } from './rng'
import { kitFor } from './palette'

export const BOARD_H = 3.5
export const GLASS_H = 6
export const NET_X = 89

const OUTLINE = rinkOutline(RINK_HALF_L, RINK_HALF_W, RINK_CORNER_R, 14)

function srgb(tex: THREE.Texture): THREE.Texture {
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function sweptMesh(profile: ProfilePoint[], mat: THREE.Material, offset = 0, uPeriod = 1): THREE.Mesh {
  const out = offset === 0 ? OUTLINE : rinkOutline(RINK_HALF_L + offset, RINK_HALF_W + offset, RINK_CORNER_R + offset, 14)
  const sw = sweepProfile(out, profile, uPeriod)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(sw.positions, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(sw.uvs, 2))
  g.setIndex(new THREE.BufferAttribute(sw.indices, 1))
  g.computeVertexNormals()
  return new THREE.Mesh(g, mat)
}

export interface ArenaState {
  homeScore: number
  awayScore: number
  period: number
  clock: string
  /** 0..1 crowd excitement (goal surge). */
  excite: number
  /** Seconds remaining of the GOAL flash on the video board (0 = none). */
  goalFlash: number
}

/** Objects on this layer are drawn into the ice's planar reflection. */
export const REFLECT_LAYER = 1

function reflective<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if (!c.userData.noReflect && !(c instanceof THREE.Mesh && c.material instanceof THREE.MeshStandardMaterial && c.material.alphaTest > 0)) {
      c.layers.enable(REFLECT_LAYER)
    }
  })
  return o
}

export class Arena {
  readonly group = new THREE.Group()
  /** Rig + video board: hidden for the top-down camera, which sits above them. */
  readonly ceiling = new THREE.Group()
  readonly reflectUniforms = {
    tReflect: { value: null as THREE.Texture | null },
    uReflectMatrix: { value: new THREE.Matrix4() },
    uReflectStrength: { value: 0.45 },
  }
  /** Goal-light housings behind each net: [-X end, +X end]. */
  readonly goalLamps: THREE.MeshStandardMaterial[] = []
  private readonly crowdUniforms = { uTime: { value: 0 }, uExcite: { value: 0 } }
  private ribbonTex: THREE.CanvasTexture | null = null
  private jumboCanvas: HTMLCanvasElement | null = null
  private jumboTex: THREE.CanvasTexture | null = null
  private jumboKey = ''
  private homeColor: number
  private awayColor: number
  private benchFans: THREE.InstancedMesh | null = null
  readonly blobTex: THREE.CanvasTexture
  private readonly envRT: THREE.WebGLRenderTarget

  constructor(private readonly renderer: THREE.WebGLRenderer, colors: { home: number; away: number }) {
    this.homeColor = colors.home
    this.awayColor = colors.away
    this.blobTex = srgb(new THREE.CanvasTexture(buildBlobCanvas())) as THREE.CanvasTexture
    this.envRT = this.buildEnvironment()
    this.buildIce()
    this.buildBoards()
    this.buildNets()
    this.buildBenches()
    this.buildBowl()
    this.buildRig()
    this.buildJumbotron()
    this.group.add(this.ceiling)
  }

  setCeilingVisible(v: boolean): void {
    this.ceiling.visible = v
  }

  get environment(): THREE.Texture {
    return this.envRT.texture
  }

  // ── image-based lighting: an abstract arena (dark bowl, bright rig) ──────
  private buildEnvironment(): THREE.WebGLRenderTarget {
    const env = new THREE.Scene()
    env.background = new THREE.Color(0x06080c)
    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(260, 200, 140, 32, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.055, 0.07), side: THREE.BackSide })
    )
    bowl.position.y = 40
    env.add(bowl)
    // warm crowd band
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(190, 150, 30, 32, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.22, 0.18, 0.15), side: THREE.BackSide })
    )
    band.position.y = 22
    env.add(band)
    // overhead light rig: bright HDR panels
    const panelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 13.5, 13) })
    const panel = new THREE.PlaneGeometry(10, 3)
    for (let ix = -4; ix <= 4; ix++) {
      for (const iz of [-1.5, -0.5, 0.5, 1.5]) {
        const m = new THREE.Mesh(panel, panelMat)
        m.rotation.x = Math.PI / 2
        m.position.set(ix * 22, 85, iz * 26)
        env.add(m)
      }
    }
    // video board glow
    const jb = new THREE.Mesh(new THREE.BoxGeometry(26, 14, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.9, 1.1) }))
    jb.position.y = 58
    env.add(jb)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const rt = pmrem.fromScene(env, 0.035, 0.5, 600)
    pmrem.dispose()
    env.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose()
        ;(o.material as THREE.Material).dispose()
      }
    })
    return rt
  }

  // ── ice ──────────────────────────────────────────────────────────────────
  private buildIce(): void {
    const shape = new THREE.Shape()
    const r = RINK_CORNER_R
    const L = RINK_HALF_L
    const Wd = RINK_HALF_W
    shape.moveTo(-L + r, -Wd)
    shape.lineTo(L - r, -Wd)
    shape.absarc(L - r, -Wd + r, r, -Math.PI / 2, 0, false)
    shape.lineTo(L, Wd - r)
    shape.absarc(L - r, Wd - r, r, 0, Math.PI / 2, false)
    shape.lineTo(-L + r, Wd)
    shape.absarc(-L + r, Wd - r, r, Math.PI / 2, Math.PI, false)
    shape.lineTo(-L, -Wd + r)
    shape.absarc(-L + r, -Wd + r, r, Math.PI, Math.PI * 1.5, false)
    const geo = new THREE.ShapeGeometry(shape, 24)
    geo.rotateX(-Math.PI / 2)
    // UVs from final world coords: canvas x ↔ world x, canvas y ↔ world z
    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) + L) / (2 * L), 1 - (pos.getZ(i) + Wd) / (2 * Wd))
    }
    const aniso = this.renderer.capabilities.getMaxAnisotropy()
    const map = srgb(new THREE.CanvasTexture(buildIceCanvas()))
    map.anisotropy = aniso
    const rough = new THREE.CanvasTexture(buildIceRoughnessCanvas())
    rough.anisotropy = aniso
    const mat = new THREE.MeshPhysicalMaterial({
      map,
      roughness: 1,
      roughnessMap: rough,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.6,
      clearcoatRoughnessMap: rough,
      envMapIntensity: 0.85,
      specularIntensity: 0.6,
    })
    // Planar reflection: the renderer draws REFLECT_LAYER (players, puck,
    // boards, nets) from a mirrored camera into a half-res target; here it is
    // blurred a touch, faded by Fresnel and killed where the ice is scuffed.
    const u = this.reflectUniforms
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.tReflect = u.tReflect
      shader.uniforms.uReflectMatrix = u.uReflectMatrix
      shader.uniforms.uReflectStrength = u.uReflectStrength
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 uReflectMatrix;\nvarying vec4 vReflectUv;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\n\tvReflectUv = uReflectMatrix * (modelMatrix * vec4(transformed, 1.0));')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tReflect;\nuniform float uReflectStrength;\nvarying vec4 vReflectUv;')
        .replace(
          '#include <opaque_fragment>',
          `{
  vec2 ruv = vReflectUv.xy / vReflectUv.w;
  vec2 px = vec2(0.0016, 0.0032);
  vec3 refl = texture2D(tReflect, ruv).rgb * 0.36
    + texture2D(tReflect, ruv + vec2(px.x, px.y)).rgb * 0.16
    + texture2D(tReflect, ruv + vec2(-px.x, px.y)).rgb * 0.16
    + texture2D(tReflect, ruv + vec2(px.x, -px.y)).rgb * 0.16
    + texture2D(tReflect, ruv + vec2(-px.x, -px.y)).rgb * 0.16;
  float gloss = 1.0 - smoothstep(0.15, 0.55, roughnessFactor);
  float ndv = clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0);
  float fres = 0.25 + 0.75 * pow(1.0 - ndv, 3.0);
  outgoingLight = mix(outgoingLight, refl, clamp(uReflectStrength * gloss * fres, 0.0, 1.0) * step(0.001, dot(refl, vec3(1.0))));
}
#include <opaque_fragment>`
        )
    }
    mat.customProgramCacheKey = () => 'ice-reflect'
    const ice = new THREE.Mesh(geo, mat)
    ice.receiveShadow = true
    ice.name = 'ice'
    this.group.add(ice)

    // Concrete deck / floor beyond the boards (so nothing floats)
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(700, 500),
      new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.95 })
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.05
    this.group.add(floor)
  }

  // ── boards, glass, stanchions ──────────────────────────────────────────
  private buildBoards(): void {
    const dasher = srgb(new THREE.CanvasTexture(buildDasherCanvas()))
    dasher.wrapS = THREE.RepeatWrapping
    dasher.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    const faceMat = new THREE.MeshStandardMaterial({ map: dasher, roughness: 0.42, side: THREE.DoubleSide })
    // inner face (ice side) — v 0 at ice, 1 at top of boards
    this.group.add(reflective(sweptMesh([{ o: 0, y: 0 }, { o: 0, y: BOARD_H }], faceMat, 0, DASHER_PERIOD_FT)))
    // cap rail + outer skin
    const capMat = new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.5, side: THREE.DoubleSide })
    this.group.add(reflective(sweptMesh([{ o: 0, y: BOARD_H }, { o: 0, y: BOARD_H + 0.12 }, { o: 0.75, y: BOARD_H + 0.12 }, { o: 0.75, y: 0 }], capMat)))

    // glass: faint, reflective, with a bright top edge
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xdfeaf2,
      transparent: true,
      opacity: 0.1,
      // ≥0.15: sharper GGX lobes overflow the half-float buffer under the
      // key light and bloom turns the Inf pixel into a giant white blob
      roughness: 0.16,
      metalness: 0,
      envMapIntensity: 1.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const glass = sweptMesh([{ o: 0.35, y: BOARD_H + 0.12 }, { o: 0.35, y: BOARD_H + GLASS_H }], glassMat)
    glass.renderOrder = 2
    this.group.add(glass)
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xcfd8e0, roughness: 0.3, metalness: 0.4, side: THREE.DoubleSide })
    this.group.add(sweptMesh([{ o: 0.28, y: BOARD_H + GLASS_H }, { o: 0.42, y: BOARD_H + GLASS_H }, { o: 0.42, y: BOARD_H + GLASS_H - 0.1 }], edgeMat))

    // stanchions every ~8 ft (skip the bench doors on the far side)
    const st = stationsAlong(OUTLINE, 8, 2)
    const post = new THREE.BoxGeometry(0.16, GLASS_H, 0.16)
    post.translate(0, BOARD_H + GLASS_H / 2, 0)
    const posts = new THREE.InstancedMesh(post, new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: 0.35, metalness: 0.6 }), st.length)
    const m = new THREE.Matrix4()
    st.forEach((s, i) => {
      m.makeTranslation(s.x + s.nx * 0.35, 0, s.z + s.nz * 0.35)
      posts.setMatrixAt(i, m)
    })
    this.group.add(posts)
  }

  // ── nets ────────────────────────────────────────────────────────────────
  private buildNets(): void {
    const netTex = new THREE.CanvasTexture(buildNetCanvas())
    netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping
    const meshMat = new THREE.MeshStandardMaterial({ map: netTex, color: 0xffffff, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.9 })
    const skirtMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8, side: THREE.DoubleSide })
    const red = new THREE.MeshStandardMaterial({ color: 0xc81d25, roughness: 0.35, metalness: 0.25 })
    const white = new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.5, metalness: 0.2 })
    const H = 4
    const HW = 3
    const CELL = 0.33

    // frame curves in net-local space (x = depth behind the goal line, z = across)
    const topCurve = (t: number) => {
      const a = Math.PI * t
      return new THREE.Vector3(Math.sin(a) * 1.7, H, -Math.cos(a) * HW)
    }
    const baseCurve = (t: number) => {
      const a = Math.PI * t
      // flatter back than a semicircle — the NHL base frame is deep and wide
      const k = Math.sin(a)
      return new THREE.Vector3(Math.pow(k, 0.55) * 3.6, 0.05, -Math.cos(a) * (HW + 0.25 * k))
    }

    for (const sign of [-1, 1] as const) {
      const g = new THREE.Group()
      g.position.set(sign * NET_X, 0, 0)
      // net opens toward center ice: depth goes toward the end boards
      g.scale.set(sign, 1, 1)

      const N = 24
      const pos: number[] = []
      const uv: number[] = []
      const idx: number[] = []
      let arc = 0
      let prevB: THREE.Vector3 | null = null
      for (let i = 0; i <= N; i++) {
        const t = i / N
        const a = topCurve(t)
        const b = baseCurve(t)
        if (prevB) arc += b.distanceTo(prevB)
        prevB = b
        const hgt = a.distanceTo(b)
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z)
        uv.push(arc / CELL, hgt / CELL, arc / CELL, 0)
        if (i < N) {
          const k = i * 2
          idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
        }
      }
      const netGeo = new THREE.BufferGeometry()
      netGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      netGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      netGeo.setIndex(idx)
      netGeo.computeVertexNormals()
      const net = new THREE.Mesh(netGeo, meshMat)
      net.castShadow = true
      net.userData.noReflect = true // half-res alpha-tested netting moirés in the mirror
      g.add(net)

      // roof: crossbar line → top curve
      const rpos: number[] = []
      const ruv: number[] = []
      const ridx: number[] = []
      for (let i = 0; i <= N; i++) {
        const t = i / N
        const a = topCurve(t)
        const z = -Math.cos(Math.PI * t) * HW
        rpos.push(0, H, z, a.x, a.y, a.z)
        ruv.push((z + HW) / CELL, 0, (z + HW) / CELL, a.x / CELL)
        if (i < N) {
          const k = i * 2
          ridx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
        }
      }
      const roofGeo = new THREE.BufferGeometry()
      roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(rpos, 3))
      roofGeo.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2))
      roofGeo.setIndex(ridx)
      roofGeo.computeVertexNormals()
      g.add(new THREE.Mesh(roofGeo, meshMat))

      // white skirt along the base
      const spos: number[] = []
      const sidx: number[] = []
      for (let i = 0; i <= N; i++) {
        const t = i / N
        const a = topCurve(t)
        const b = baseCurve(t)
        const top = b.clone().lerp(a, 0.14)
        spos.push(b.x * 0.985, b.y, b.z * 0.985, top.x * 0.985, top.y, top.z * 0.985)
        if (i < N) {
          const k = i * 2
          sidx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
        }
      }
      const skirtGeo = new THREE.BufferGeometry()
      skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(spos, 3))
      skirtGeo.setIndex(sidx)
      skirtGeo.computeVertexNormals()
      g.add(new THREE.Mesh(skirtGeo, skirtMat))

      // posts + crossbar (red), frames
      for (const z of [-HW, HW]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, H, 12), red)
        p.position.set(0, H / 2, z)
        p.castShadow = true
        g.add(p)
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, HW * 2 + 0.2, 12), red)
      bar.rotation.x = Math.PI / 2
      bar.position.set(0, H, 0)
      bar.castShadow = true
      g.add(bar)
      const topFrame = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 13 }, (_, i) => topCurve(i / 12))), 24, 0.06, 6),
        red
      )
      g.add(topFrame)
      const baseFrame = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 13 }, (_, i) => baseCurve(i / 12))), 24, 0.07, 6),
        white
      )
      g.add(baseFrame)
      this.group.add(reflective(g))

      // goal lamp behind the glass
      const lampMat = new THREE.MeshStandardMaterial({ color: 0x400808, emissive: 0xff1a1a, emissiveIntensity: 0, roughness: 0.3 })
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 1.4, 16), lampMat)
      // up behind the glass in the end stands — clear of the endzone camera (x=±110, y=14)
      lamp.position.set(sign * (RINK_HALF_L + 14), 21, 0)
      this.group.add(reflective(lamp))
      this.goalLamps[sign < 0 ? 0 : 1] = lampMat
    }
  }

  // ── benches (far side, opposite the main camera) ─────────────────────────
  private buildBenches(): void {
    const z0 = RINK_HALF_W + 0.75
    const deck = new THREE.MeshStandardMaterial({ color: 0x23272f, roughness: 0.9 })
    const seat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.7 })
    const back = new THREE.MeshStandardMaterial({ color: 0x12161d, roughness: 0.8 })
    const fanGeo = this.fanGeometry(true)
    const count = 18
    const fans = new THREE.InstancedMesh(fanGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), count)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)
    let n = 0
    for (const [cx, color] of [[-26, this.homeColor], [26, this.awayColor]] as const) {
      const floor = new THREE.Mesh(new THREE.BoxGeometry(30, 0.6, 6), deck)
      floor.position.set(cx, 0.3, z0 + 3)
      this.group.add(floor)
      const bench = new THREE.Mesh(new THREE.BoxGeometry(30, 1.6, 1.6), seat)
      bench.position.set(cx, 1.4, z0 + 5)
      this.group.add(bench)
      const wall = new THREE.Mesh(new THREE.BoxGeometry(31, 5, 0.6), back)
      wall.position.set(cx, 2.5, z0 + 6.3)
      this.group.add(wall)
      const kit = kitFor(color, cx < 0 ? 'home' : 'away')
      for (let i = 0; i < 9; i++) {
        m.compose(new THREE.Vector3(cx - 12 + i * 3 + (i % 2) * 0.4, 1.6, z0 + 5), q, new THREE.Vector3(1.05, 1.05, 1.05))
        fans.setMatrixAt(n, m)
        fans.setColorAt(n, new THREE.Color(kit.jersey))
        n++
      }
    }
    fans.castShadow = true
    this.benchFans = fans
    this.group.add(fans)
  }

  /** Seated figure: torso block + head (head baked slightly darker via vertex colors). */
  private fanGeometry(player: boolean): THREE.BufferGeometry {
    const torso = new THREE.BoxGeometry(player ? 1.5 : 1.25, player ? 2.0 : 1.7, 0.9)
    torso.translate(0, player ? 1.0 : 0.85, 0)
    const head = new THREE.IcosahedronGeometry(player ? 0.42 : 0.36, 0)
    head.translate(0, player ? 2.35 : 2.0, 0.05)
    const t = torso.toNonIndexed()
    const h = head.index ? head.toNonIndexed() : head
    const colorize = (g: THREE.BufferGeometry, v: number) => {
      const n = g.getAttribute('position').count
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(v), 3))
    }
    colorize(t, 1)
    colorize(h, player ? 0.35 : 0.55)
    t.deleteAttribute('uv')
    h.deleteAttribute('uv')
    const merged = new THREE.BufferGeometry()
    const pos = new Float32Array(t.getAttribute('position').count * 3 + h.getAttribute('position').count * 3)
    pos.set(t.getAttribute('position').array as Float32Array, 0)
    pos.set(h.getAttribute('position').array as Float32Array, t.getAttribute('position').count * 3)
    const col = new Float32Array(pos.length)
    col.set(t.getAttribute('color').array as Float32Array, 0)
    col.set(h.getAttribute('color').array as Float32Array, t.getAttribute('position').count * 3)
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    merged.setAttribute('color', new THREE.BufferAttribute(col, 3))
    merged.computeVertexNormals()
    return merged
  }

  // ── seating bowl + crowd ────────────────────────────────────────────────
  private buildBowl(): void {
    const rng = mulberry32(0xc40d)
    const stepMat = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.92, side: THREE.DoubleSide })
    const tiers = [
      // Crowd sits in the spill of the rig, darker than the ice (broadcast look)
      { o0: 9, y0: 4.5, rows: 20, depth: 2.8, rise: 1.25, light: 0.5 },
      { o0: 73, y0: 39, rows: 14, depth: 2.9, rise: 1.9, light: 0.34 },
    ]
    const fans: Array<{ x: number; y: number; z: number; ry: number; light: number }> = []
    for (const t of tiers) {
      const prof: ProfilePoint[] = [{ o: t.o0 - 3, y: t.y0 - 1.2 }, { o: t.o0, y: t.y0 }]
      for (let r = 0; r < t.rows; r++) {
        const o = t.o0 + r * t.depth
        const y = t.y0 + r * t.rise
        prof.push({ o, y: y + t.rise }, { o: o + t.depth, y: y + t.rise })
        const row = rinkOutline(RINK_HALF_L + o + t.depth * 0.45, RINK_HALF_W + o + t.depth * 0.45, RINK_CORNER_R + o, 14)
        const seats = stationsAlong(row, 2.15, rng() * 2)
        seats.forEach((s, i) => {
          if (i % 15 === 7) return // aisle
          if (rng() < 0.06) return // empty seat
          fans.push({ x: s.x, y: y + t.rise, z: s.z, ry: Math.atan2(-s.nx, -s.nz), light: t.light * (1 - r * 0.012) })
        })
      }
      const stands = sweptMesh(prof, stepMat)
      this.group.add(stands)
    }
    // back wall of the lower bowl up to the ribbon
    const fasciaMat = new THREE.MeshStandardMaterial({ color: 0x0c0f14, roughness: 0.9, side: THREE.DoubleSide })
    this.group.add(sweptMesh([{ o: 65, y: 29.5 }, { o: 65, y: 33 }, { o: 71, y: 33 }, { o: 71, y: 38 }], fasciaMat))

    // LED ribbon on the club-level fascia (emissive, scrolls)
    const ribbonTex = srgb(new THREE.CanvasTexture(buildRibbonCanvas(this.homeColor))) as THREE.CanvasTexture
    ribbonTex.wrapS = THREE.RepeatWrapping
    this.ribbonTex = ribbonTex
    const ribbonMat = new THREE.MeshBasicMaterial({ map: ribbonTex, side: THREE.DoubleSide, toneMapped: true, color: new THREE.Color(1.6, 1.6, 1.6) })
    this.group.add(sweptMesh([{ o: 70.8, y: 34 }, { o: 70.8, y: 37.4 }], ribbonMat, 0, 64))

    // crowd: 2 instanced draws (bodies, heads) sharing one motion shader
    // Tapered 6-sided torso (shoulders narrower than a box, rounded silhouette)
    // + low-poly head: ~44 tris a fan, reads as people rather than blocks.
    const body = new THREE.CylinderGeometry(0.5, 0.64, 1.75, 6, 1)
    body.scale(1, 1, 0.72)
    body.rotateY(Math.PI / 6)
    body.translate(0, 0.88, 0.1)
    const head = new THREE.IcosahedronGeometry(0.33, 0)
    head.scale(0.9, 1.1, 0.95)
    head.translate(0, 2.05, 0.15)
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xffffff })
    const headMat = new THREE.MeshLambertMaterial({ color: 0xffffff })
    for (const mat of [bodyMat, headMat]) {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = this.crowdUniforms.uTime
        shader.uniforms.uExcite = this.crowdUniforms.uExcite
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uExcite;')
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec2 seat = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
  float h = fract(sin(dot(seat, vec2(12.9898, 78.233))) * 43758.5453);
  float sway = sin(uTime * (0.6 + h) + h * 6.2831) * 0.05;
  float jump = uExcite * max(0.0, sin(uTime * (7.0 + 3.0 * h) + h * 6.2831)) * (0.6 + 0.8 * h);
  float stand = uExcite * step(0.25, h) * 0.55;
  transformed.y += sway + jump + stand;
  transformed.x += sin(uTime * 0.4 + h * 20.0) * 0.04;
#endif`
          )
      }
      mat.customProgramCacheKey = () => 'crowd-motion'
    }
    const bodies = new THREE.InstancedMesh(body, bodyMat, fans.length)
    const heads = new THREE.InstancedMesh(head, headMat, fans.length)
    const shirts = [0x1c1f26, 0xeeeeee, 0x2b3a55, 0x6b6f76, 0x8b1e2d, 0x3d5a40, 0x1f2f4f, 0x7a5c3a, 0xb8b8b0]
    const hair = [0x2a1d14, 0x121212, 0x5a3b22, 0x8a6a45, 0xbfae95, 0x3b2a1f]
    const homeKit = kitFor(this.homeColor, 'home')
    const awayKit = kitFor(this.awayColor, 'away')
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const c = new THREE.Color()
    const grey = new THREE.Color()
    fans.forEach((f, i) => {
      q.setFromAxisAngle(up, f.ry)
      const s = 0.9 + rng() * 0.2
      m.compose(new THREE.Vector3(f.x, f.y, f.z), q, new THREE.Vector3(s, s, s))
      bodies.setMatrixAt(i, m)
      heads.setMatrixAt(i, m)
      const roll = rng()
      const shirt = roll < 0.3 ? homeKit.jersey : roll < 0.36 ? homeKit.trim : roll < 0.41 ? awayKit.trim : shirts[Math.floor(rng() * shirts.length)]!
      // desaturate a touch — a real crowd is a textured mid-tone, not a flag
      c.setHex(shirt).lerp(grey.setScalar(0.12), 0.3).multiplyScalar(f.light * (0.8 + rng() * 0.25))
      bodies.setColorAt(i, c)
      c.setHex(hair[Math.floor(rng() * hair.length)]!).multiplyScalar(f.light)
      heads.setColorAt(i, c)
    })
    bodies.frustumCulled = false
    heads.frustumCulled = false
    this.group.add(bodies, heads)

    // roof
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(700, 500), new THREE.MeshBasicMaterial({ color: 0x030406 }))
    roof.rotation.x = Math.PI / 2
    roof.position.y = 105
    this.group.add(roof)
    // outer wall behind the upper bowl
    this.group.add(sweptMesh([{ o: 120, y: 60 }, { o: 125, y: 105 }], new THREE.MeshBasicMaterial({ color: 0x05070a, side: THREE.DoubleSide })))
  }

  // ── overhead rig: trusses + light fixtures (emissive → bloom) ───────────
  private buildRig(): void {
    const truss = new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.7, metalness: 0.5 })
    for (const z of [-36, -12, 12, 36]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(230, 1.2, 1.2), truss)
      b.position.set(0, 86, z)
      this.ceiling.add(b)
    }
    const fixtures: THREE.Vector3[] = []
    for (const z of [-36, -12, 12, 36]) for (let x = -100; x <= 100; x += 12.5) fixtures.push(new THREE.Vector3(x, 85, z))
    const fx = new THREE.InstancedMesh(
      new THREE.BoxGeometry(2.2, 0.6, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff6e8, emissiveIntensity: 3.2 }),
      fixtures.length
    )
    const m = new THREE.Matrix4()
    fixtures.forEach((p, i) => fx.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)))
    this.ceiling.add(fx)
  }

  // ── center-hung video board ─────────────────────────────────────────────
  private buildJumbotron(): void {
    const g = new THREE.Group()
    g.position.set(0, 62, 0)
    const shell = new THREE.Mesh(new THREE.BoxGeometry(30, 16, 22), new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.6, metalness: 0.4 }))
    g.add(shell)
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 256
    this.jumboCanvas = c
    this.jumboTex = srgb(new THREE.CanvasTexture(c)) as THREE.CanvasTexture
    const screenMat = new THREE.MeshBasicMaterial({ map: this.jumboTex, color: new THREE.Color(1.4, 1.4, 1.4) })
    const faces: Array<[number, number, number, number, number]> = [
      // w, h, x, z, ry
      [28, 14, 0, 11.05, 0],
      [28, 14, 0, -11.05, Math.PI],
      [20, 10, 15.05, 0, Math.PI / 2],
      [20, 10, -15.05, 0, -Math.PI / 2],
    ]
    for (const [w, h, x, z, ry] of faces) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screenMat)
      s.position.set(x, 0, z)
      s.rotation.y = ry
      g.add(s)
    }
    // LED rings top/bottom in home color
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: this.homeColor, emissiveIntensity: 1.6 })
    for (const y of [-8.6, 8.6]) {
      const ring = new THREE.Mesh(new THREE.BoxGeometry(31, 1.2, 23), ringMat)
      ring.position.y = y
      g.add(ring)
    }
    // hanging cables
    const cable = new THREE.MeshBasicMaterial({ color: 0x111111 })
    for (const [x, z] of [[-12, -9], [12, -9], [-12, 9], [12, 9]] as const) {
      const cb = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 40, 4), cable)
      cb.position.set(x, 28, z)
      g.add(cb)
    }
    this.ceiling.add(g)
    this.updateJumbotron({ homeScore: 0, awayScore: 0, period: 1, clock: '20:00', excite: 0, goalFlash: 0 })
  }

  private updateJumbotron(s: ArenaState): void {
    if (!this.jumboCanvas || !this.jumboTex) return
    const flashStep = s.goalFlash > 0 ? Math.floor(s.goalFlash * 4) : -1
    const key = `${s.homeScore}|${s.awayScore}|${s.period}|${s.clock}|${flashStep}`
    if (key === this.jumboKey) return
    this.jumboKey = key
    paintJumbotron(this.jumboCanvas, { ...s, homeColor: this.homeColor, awayColor: this.awayColor })
    this.jumboTex.needsUpdate = true
  }

  /** Per-frame: crowd motion, ribbon scroll, video board. */
  update(time: number, s: ArenaState): void {
    this.crowdUniforms.uTime.value = time
    this.crowdUniforms.uExcite.value = s.excite
    if (this.ribbonTex) this.ribbonTex.offset.x = (time * 0.02) % 1
    this.updateJumbotron(s)
  }

  /** Recolor team-dependent art when a new game loads. */
  setColors(colors: { home: number; away: number }): void {
    if (colors.home === this.homeColor && colors.away === this.awayColor) return
    this.homeColor = colors.home
    this.awayColor = colors.away
    this.jumboKey = ''
    if (this.benchFans) {
      const hk = kitFor(colors.home, 'home')
      const ak = kitFor(colors.away, 'away')
      const c = new THREE.Color()
      for (let i = 0; i < this.benchFans.count; i++) this.benchFans.setColorAt(i, c.setHex(i < 9 ? hk.jersey : ak.jersey))
      if (this.benchFans.instanceColor) this.benchFans.instanceColor.needsUpdate = true
    }
  }

  dispose(): void {
    this.envRT.dispose()
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose()
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        for (const m of mats) {
          for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose()
          m.dispose()
        }
      }
    })
  }
}
