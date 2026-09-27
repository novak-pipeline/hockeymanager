// Gait lab (bake-off for LOCOMOTION): one skating cycle sampled at N evenly
// spaced phases, side view, one row per source — the same phase and speed for
// every row, so the only difference is who drives the legs.
//   http://localhost:5175/gait.html?speed=0.9&n=8&rows=proc,code,clip&clip=skate_stride
import * as THREE from 'three'
import { AthleteRig, athleteMaterial } from '@render3d/athlete'
import { skaterPose } from '@render3d/pose'
import { kitFor } from '@render3d/palette'
import { buildAtlasCanvas, paintJerseySlot } from '@render3d/textures'
import { loadAthleteAssets } from '@render3d/gltfAthlete'
import { blendClip } from '@render3d/animLayer'

const q = new URLSearchParams(location.search)
const speed = Number(q.get('speed') ?? 0.9)
const n = Number(q.get('n') ?? 8)
const rows = (q.get('rows') ?? 'proc,code,clip').split(',')
const clipName = q.get('clip') ?? 'skate_stride'
const turn = Number(q.get('turn') ?? 0)
const W = 1600
const H = 330 * rows.length
const lab = document.getElementById('lab')!
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(W, H)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.shadowMap.enabled = true
lab.appendChild(renderer.domElement)
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x1a1d22)
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x303540, 1.6))
const sun = new THREE.DirectionalLight(0xffffff, 2.2)
sun.position.set(-20, 60, 30)
sun.target.position.set(0, 0, 0)
sun.castShadow = true
sun.shadow.camera.left = -60
sun.shadow.camera.right = 60
sun.shadow.camera.top = 700
sun.shadow.camera.bottom = -700
sun.shadow.camera.far = 2000
sun.shadow.mapSize.set(2048, 2048)
scene.add(sun)
const ice = new THREE.Mesh(new THREE.PlaneGeometry(400, 2000), new THREE.MeshStandardMaterial({ color: 0xe8eef3, roughness: 0.35 }))
ice.rotation.x = -Math.PI / 2
ice.receiveShadow = true
scene.add(ice)

const atlas = buildAtlasCanvas()
const tex = new THREE.CanvasTexture(atlas)
tex.colorSpace = THREE.SRGBColorSpace
const mat = athleteMaterial(tex)
const assets = await loadAthleteAssets()
const kit = kitFor(0x1f4fbf, 'home')
const dx = 4.2
// view azimuth (deg): 0 = side, 60 = rear three-quarter (the push is sideways, so rear shows it)
const az = (Number(q.get('az') ?? 55) * Math.PI) / 180
const view = new THREE.Vector3(Math.sin(az), 0, Math.cos(az)) // camera direction from the players
const perp = new THREE.Vector3(view.z, 0, -view.x)
const rigs: Array<{ rig: AthleteRig; row: string; phase: number }> = []
rows.forEach((row, ri) => {
  for (let i = 0; i < n; i++) {
    const slot = ri * n + i
    const rig = new AthleteRig(false, slot % 36, mat, row === 'proc' ? null : assets?.skater)
    rig.kit = kit
    rig.recolor()
    paintJerseySlot(atlas, slot % 36, kit, 10 + i, false)
    rig.mesh.receiveShadow = true
    scene.add(rig.root)
    rigs.push({ rig, row, phase: (i / n) * Math.PI * 2 })
    const k = (i - (n - 1) / 2) * dx
    const x = perp.x * k
    const z = -ri * 300 + perp.z * k
    const pose = skaterPose((i / n) * Math.PI * 2, speed, turn)
    const clip = assets?.skater.clips.get(clipName)
    const overlay =
      row === 'clip' && clip
        ? {
            body: (B: Record<string, THREE.Bone>) => blendClip(B, clip, (i / n) * clip.duration, true, 1, 'lower', 'body'),
            stick: () => {},
            arms: () => {},
          }
        : null
    // skating toward screen-left (−X): heading −90°
    rig.apply(x, z, -Math.PI / 2, pose, { mode: 'carry' }, overlay as never)
  }
})
tex.needsUpdate = true
const rowH = H / rows.length
const cam = new THREE.PerspectiveCamera(Number(q.get('fov') ?? 6.5), W / rowH, 1, 500)
renderer.setScissorTest(true)
scene.updateMatrixWorld(true)
rows.forEach((_, ri) => {
  const z = -ri * 300
  cam.position.set(view.x * 95, 12, z + view.z * 95)
  cam.lookAt(0, 2.4, z)
  const y = H - (ri + 1) * rowH
  renderer.setViewport(0, y, W, rowH)
  renderer.setScissor(0, y, W, rowH)
  renderer.render(scene, cam)
})
rows.forEach((row, ri) => {
  const d = document.createElement('div')
  d.className = 'lbl'
  d.style.top = `${8 + ri * (H / rows.length)}px`
  d.textContent = { proc: 'procedural body + code stride', code: 'Blender body + code stride', clip: `Blender body + Blender ${clipName} (phase-locked)` }[row] ?? row
  lab.appendChild(d)
})
;(window as unknown as Record<string, unknown>).__r3d = true
