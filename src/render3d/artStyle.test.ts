import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ART_STYLES, ArtStyleRuntime, artStyleSpec } from './artStyle'
import { RENDER3D_DEFAULTS } from './rink3dRenderer'

describe('art-style look test', () => {
  it('the default look is untouched: current is the default and has no spec', () => {
    expect(RENDER3D_DEFAULTS.artStyle).toBe('current')
    expect(artStyleSpec('current')).toBeNull()
    expect(ART_STYLES).toEqual(['current', 'cleanBroadcast', 'cartoony'])
  })

  it('the stylised looks keep the outline subtle in clean and bold in cartoony', () => {
    const clean = artStyleSpec('cleanBroadcast')!
    const toon = artStyleSpec('cartoony')!
    expect(clean.outlinePx).toBeLessThan(toon.outlinePx)
    expect(clean.toonMix).toBeLessThan(toon.toonMix)
    expect(clean.toonSoft).toBeGreaterThan(toon.toonSoft)
  })

  it('the shader tokens the patches hook still exist in three', () => {
    expect(THREE.ShaderChunk.map_fragment).toContain('texture2D( map, vMapUv )')
    expect(THREE.ShaderLib.physical.fragmentShader).toContain('#include <opaque_fragment>')
    expect(THREE.ShaderLib.physical.vertexShader).toContain('#include <skinning_vertex>')
    expect(THREE.ShaderLib.basic.vertexShader).toContain('#include <project_vertex>')
  })

  it('patches a material in place, once, and keys its program apart from the default', () => {
    const rt = new ArtStyleRuntime(artStyleSpec('cleanBroadcast')!, new THREE.Vector3(0, 1, 0))
    const m = new THREE.MeshStandardMaterial()
    const before = m.customProgramCacheKey()
    rt.stylize(m, true)
    const key = m.customProgramCacheKey()
    expect(key).not.toBe(before)
    rt.stylize(m, true)
    expect(m.customProgramCacheKey()).toBe(key)
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms
    m.onBeforeCompile(shader, {} as THREE.WebGLRenderer)
    expect(shader.fragmentShader).toContain('uToonLit')
    expect(shader.vertexShader).toContain('uPuff')
    expect(Object.keys(shader.uniforms)).toContain('uRim')
  })
})
