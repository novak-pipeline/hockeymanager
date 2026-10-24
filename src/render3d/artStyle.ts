/**
 * Art-direction look test (owner decision pending): the same rigs, clips and
 * broadcast camera drawn three ways, chosen per renderer instance.
 *
 *   'current'        — the semi-realistic PBR look (the default; nothing here runs).
 *   'cleanBroadcast' — soft two-tone ramp shading over flattened kits, a thin
 *                      constant-pixel outline + fresnel rim so players pop off the
 *                      ice, soft even arena light, PBR-neutral tone map, gentle grade.
 *   'cartoony'       — reference only: hard toon bands, thick ink outlines,
 *                      saturated grade, puffier gear. Same proportions (same rigs).
 *
 * Everything is runtime: material shader patches, an inverted-hull outline that
 * shares each rig's geometry + skeleton, light / tone-map / post settings. No
 * asset on disk is touched (the owner's licensed rigs are restyled in memory only).
 */
import * as THREE from 'three'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'

export type ArtStyle = 'current' | 'cleanBroadcast' | 'cartoony'
export const ART_STYLES: readonly ArtStyle[] = ['current', 'cleanBroadcast', 'cartoony']

export interface ArtStyleSpec {
  /** 0 = PBR lighting as is, 1 = pure ramp lighting. */
  toonMix: number
  /** Half-lambert threshold of the lit/shadow band and its softness. */
  toonEdge: number
  toonSoft: number
  /** Light multiplier in the shadow band / the lit band. */
  toonShadow: number
  toonLit: number
  /** Albedo saturation (1 = as authored). */
  albedoSat: number
  /** Texture mip bias: blurs fiddly texture detail (pores, stitching, fabric weave). */
  mapBias: number
  /** Normal-map strength kept (1 = as authored). */
  normalScale: number
  /** Fresnel rim (linear colour × strength) and falloff power. */
  rimColor: number
  rimStrength: number
  rimPower: number
  /** Inverted-hull outline: width in screen px, capped in world ft (close-ups), colour; 0 = none. */
  outlinePx: number
  outlineMaxFt: number
  outlineColor: number
  /** Gear inflation along the normal (ft) — chunkier pads / gloves / helmets (owner gear material). */
  gearPuffFt: number
  /** Kit painting: shading baked in the owner sweater texels flattened toward one tone (0..1); number size. */
  kitFlatten: number
  numberScale: number
  // ── lighting / post ──
  toneMapping: THREE.ToneMapping
  exposure: number
  hemi: { sky: number; ground: number; intensity: number }
  key: number
  keyShadowRadius: number
  rims: number
  envIntensity: number
  iceReflect: number
  /** Repaint the sheet without skate scuffs. */
  cleanIce: boolean
  bloom: number
  /** Display-space grade: saturation, contrast, vignette, warmth (+ = warm). */
  grade: { sat: number; contrast: number; vignette: number; warmth: number; lift: number }
}

const CLEAN: ArtStyleSpec = {
  toonMix: 0.82,
  toonEdge: 0.42,
  toonSoft: 0.2,
  toonShadow: 0.62,
  toonLit: 1.08,
  albedoSat: 1.05,
  mapBias: 1.6,
  normalScale: 0.25,
  rimColor: 0xdfe9ff,
  rimStrength: 0.32,
  rimPower: 3.2,
  outlinePx: 1.75,
  outlineMaxFt: 0.05,
  outlineColor: 0x14171d,
  gearPuffFt: 0.025,
  kitFlatten: 0.8,
  numberScale: 1.18,
  toneMapping: THREE.NeutralToneMapping,
  exposure: 0.98,
  hemi: { sky: 0xf2f5ff, ground: 0x4a4d55, intensity: 1.05 },
  key: 1.05,
  keyShadowRadius: 7,
  rims: 0.35,
  envIntensity: 0.9,
  iceReflect: 0.3,
  cleanIce: true,
  bloom: 0.22,
  grade: { sat: 1.06, contrast: 1.04, vignette: 0.12, warmth: 0.012, lift: 0.01 },
}

const CARTOONY: ArtStyleSpec = {
  toonMix: 1,
  toonEdge: 0.5,
  toonSoft: 0.035,
  toonShadow: 0.58,
  toonLit: 1.12,
  albedoSat: 1.2,
  mapBias: 2.6,
  normalScale: 0,
  rimColor: 0xffffff,
  rimStrength: 0.45,
  rimPower: 4,
  outlinePx: 2.8,
  outlineMaxFt: 0.11,
  outlineColor: 0x07080b,
  gearPuffFt: 0.06,
  kitFlatten: 1,
  numberScale: 1.3,
  toneMapping: THREE.NeutralToneMapping,
  exposure: 1.04,
  hemi: { sky: 0xffffff, ground: 0x50545e, intensity: 1.15 },
  key: 1.15,
  keyShadowRadius: 2,
  rims: 0.25,
  envIntensity: 0.75,
  iceReflect: 0.2,
  cleanIce: true,
  bloom: 0.18,
  grade: { sat: 1.15, contrast: 1.1, vignette: 0.08, warmth: 0.02, lift: 0.0 },
}

export function artStyleSpec(style: ArtStyle): ArtStyleSpec | null {
  return style === 'cleanBroadcast' ? CLEAN : style === 'cartoony' ? CARTOONY : null
}

/** Shared per-frame uniforms: every restyled material reads the same objects. */
export class ArtStyleRuntime {
  readonly keyDirV = { value: new THREE.Vector3(0, 1, 0) }
  readonly upV = { value: new THREE.Vector3(0, 1, 0) }
  readonly pxToFt = { value: 0.001 }
  private readonly keyWorld = new THREE.Vector3()
  private readonly m3 = new THREE.Matrix3()
  private readonly hidden = new THREE.MeshBasicMaterial({ visible: false })

  constructor(readonly spec: ArtStyleSpec, keyDirWorld: THREE.Vector3) {
    this.keyWorld.copy(keyDirWorld).normalize()
  }

  /** Per frame, after the camera moved: view-space light / up vectors and px→ft at distance 1. */
  frame(camera: THREE.PerspectiveCamera, heightPx: number): void {
    camera.updateMatrixWorld()
    this.m3.setFromMatrix4(camera.matrixWorldInverse)
    this.keyDirV.value.copy(this.keyWorld).applyMatrix3(this.m3).normalize()
    this.upV.value.set(0, 1, 0).applyMatrix3(this.m3).normalize()
    this.pxToFt.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, heightPx)
  }

  /** Patch a lit athlete material (chains any existing onBeforeCompile). */
  stylize(m: THREE.MeshStandardMaterial, gear: boolean): void {
    const s = this.spec
    if (m.userData.artStyled) return
    m.userData.artStyled = true
    if (m.normalMap) m.normalScale.setScalar(s.normalScale)
    if (m.transparent) return // visor: leave the glass alone
    const prev = m.onBeforeCompile.bind(m)
    const prevKey = m.customProgramCacheKey.bind(m)
    const lin = (hex: number) => new THREE.Color(hex)
    const u = {
      uKeyDirV: this.keyDirV,
      uUpV: this.upV,
      uToon: { value: new THREE.Vector4(s.toonMix, s.toonEdge, s.toonSoft, s.toonShadow) },
      uToonLit: { value: s.toonLit },
      uAlbedoSat: { value: s.albedoSat },
      // gear (helmet, gloves, pads, face) loses its fiddly detail; kit atlases stay crisp (numbers)
      uMapBias: { value: gear ? s.mapBias : 0 },
      uRim: { value: new THREE.Vector4(...lin(s.rimColor).multiplyScalar(s.rimStrength).toArray(), s.rimPower) },
      uPuff: { value: gear ? s.gearPuffFt : 0 },
      uSkinCalm: { value: gear ? 1 : 0 },
    }
    m.onBeforeCompile = (shader, r) => {
      prev(shader, r)
      Object.assign(shader.uniforms, u)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uPuff;')
        .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n\ttransformed += normalize(objectNormal) * uPuff;')
      const mapChunk = THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', 'texture( map, vMapUv, uMapBias )')
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform vec3 uKeyDirV;\nuniform vec3 uUpV;\nuniform vec4 uToon;\nuniform float uToonLit;\nuniform float uAlbedoSat;\nuniform float uMapBias;\nuniform vec4 uRim;\nuniform float uSkinCalm;'
        )
        .replace('#include <map_fragment>', mapChunk)
        .replace(
          '#include <opaque_fragment>',
          `{
  vec3 base = diffuseColor.rgb;
  float lb = dot(base, vec3(0.2126, 0.7152, 0.0722));
  // skin texels (linear: red-led, green ~38-68% of red, blue ~20-55%): calmer, neutral faces
  float rr = max(base.r, 1e-4);
  float skin = uSkinCalm * smoothstep(0.3, 0.38, base.g / rr) * (1.0 - smoothstep(0.68, 0.76, base.g / rr)) * smoothstep(0.13, 0.2, base.b / rr) * (1.0 - smoothstep(0.55, 0.65, base.b / rr));
  base = max(mix(vec3(lb), base, mix(uAlbedoSat, 0.42, skin)), 0.0);
  float ndl = dot(normal, uKeyDirV) * 0.5 + 0.5;
  float band = smoothstep(uToon.y - uToon.z, uToon.y + uToon.z, ndl);
  float sky = dot(normal, uUpV) * 0.5 + 0.5;
  float lit = mix(uToon.w, uToonLit, band) * mix(0.86, 1.04, sky);
  outgoingLight = mix(outgoingLight * mix(1.0, uAlbedoSat, 0.5), base * lit, uToon.x);
  float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  outgoingLight += uRim.rgb * pow(1.0 - ndv, uRim.w) * (0.3 + 0.7 * sky);
}
#include <opaque_fragment>`
        )
    }
    m.customProgramCacheKey = () => `${prevKey()}|art:${s.toonMix}:${gear ? 1 : 0}`
    m.needsUpdate = true
  }

  /** Inverted-hull outline material (skinned, back faces pushed out a constant screen width). */
  outlineMaterial(): THREE.MeshBasicMaterial | null {
    const s = this.spec
    if (s.outlinePx <= 0) return null
    const m = new THREE.MeshBasicMaterial({ color: s.outlineColor, side: THREE.BackSide })
    const u = { uOutlinePx: { value: s.outlinePx }, uOutlineMax: { value: s.outlineMaxFt }, uPxToFt: this.pxToFt, uPuff: { value: s.gearPuffFt * 0.5 } }
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uOutlinePx;\nuniform float uOutlineMax;\nuniform float uPxToFt;\nuniform float uPuff;')
        .replace(
          '#include <project_vertex>',
          `transformed += normalize(objectNormal) * uPuff;
#include <project_vertex>
{
  vec3 nV = normalize(normalMatrix * objectNormal);
  float w = min(uOutlinePx * (-mvPosition.z) * uPxToFt, uOutlineMax);
  mvPosition.xyz += nV * w;
  gl_Position = projectionMatrix * mvPosition;
}`
        )
    }
    m.customProgramCacheKey = () => 'art-outline'
    return m
  }

  /** Add an outline hull to a rig's skinned mesh (shares geometry + skeleton; no shadow, no reflection). */
  addHull(mesh: THREE.SkinnedMesh, mat: THREE.Material): THREE.SkinnedMesh {
    // multi-material rigs: no hull behind see-through parts (a dark shell showed through the visor)
    const hullMat = Array.isArray(mesh.material) ? mesh.material.map((m) => (m.transparent ? this.hidden : mat)) : mat
    const hull = new THREE.SkinnedMesh(mesh.geometry, hullMat)
    hull.name = 'art-outline'
    hull.bind(mesh.skeleton, mesh.bindMatrix)
    hull.castShadow = false
    hull.receiveShadow = false
    hull.frustumCulled = false
    hull.boundingSphere = mesh.boundingSphere?.clone() ?? null
    hull.boundingBox = mesh.boundingBox?.clone() ?? null
    hull.layers.set(0)
    mesh.add(hull)
    return hull
  }

  /** Display-space grade (after OutputPass): saturation, contrast, warmth, lift, vignette. */
  gradePass(): ShaderPass {
    const g = this.spec.grade
    return new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uGrade: { value: new THREE.Vector4(g.sat, g.contrast, g.vignette, g.warmth) },
        uLift: { value: g.lift },
      },
      vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse;
uniform vec4 uGrade;
uniform float uLift;
varying vec2 vUv;
void main() {
  vec3 x = texture2D(tDiffuse, vUv).rgb;
  float l = dot(x, vec3(0.2126, 0.7152, 0.0722));
  x = mix(vec3(l), x, uGrade.x);
  x = (x - 0.5) * uGrade.y + 0.5;
  x += vec3(uGrade.w, uGrade.w * 0.35, -uGrade.w);
  x = x + uLift * (1.0 - x);
  vec2 d = vUv - 0.5;
  x *= 1.0 - uGrade.z * dot(d, d) * 2.2;
  gl_FragColor = vec4(clamp(x, 0.0, 1.0), 1.0);
}`,
    })
  }
}
