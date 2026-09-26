/**
 * 3D rink renderer — implements MatchRenderer using three.js.
 *
 * Architecture:
 *   - Pure math/data helpers live in math.ts, pose.ts, palette.ts, rinkShape.ts
 *     (unit-testable, no THREE).
 *   - arena.ts builds the static world (ice, boards, bowl, crowd, video board, IBL).
 *   - athlete.ts owns the procedural player rigs + instanced body parts.
 *   - This file owns playback, the per-frame pose/puck/camera pipeline, event
 *     cues, lights and the post chain (MSAA → bloom → ACES output).
 *   - 1 unit = 1 foot; rink is 200ft × 85ft; y-up world.
 *   - Normalized domain positions mapped via normXtoWorld / normYtoWorld.
 *   - Wall-clock playback loop: setAnimationLoop drives clockPos forward.
 *   - MatchView emitted on every frame (matching 2D semantics exactly).
 */

import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import type { MatchTimeline } from '@render2d/timeline'
import type { MatchRenderer, MatchView, RinkColors, PlayerLabels } from '@render2d/rendererContract'
import type { GameStream, PlayerId } from '@domain'
import {
  normXtoWorld,
  normYtoWorld,
  springStep,
  snapSpring,
  clampTurnRate,
  jerseyNumber,
  extractCues,
  cameraTargetFor,
  endzoneChooseEnd,
  puckCarriedOffset,
  applyDeadzone,
  emaStep,
  clampSpeed,
  wrapAngle,
  cameraFovFor,
  celebrationTarget,
  type CameraPreset,
  type EventCue,
  type Spring1D,
} from './math'
import { advanceStridePhase, skaterPose, goaliePose, celebrationWeight, crowdExcitement, facingTarget } from './pose'
import { Arena, NET_X, REFLECT_LAYER } from './arena'
import { AthleteBatch, AthleteRig } from './athlete'
import { kitFor, type Kit } from './palette'
import { buildAtlasCanvas, paintJerseySlot } from './textures'

const PUCK_R = 0.36
const PUCK_H = 0.1

// ── Spring half-lives ───────────────────────────────────────────────────────
const PLAYER_FOLLOW_HL = 0.08
const CAMERA_FOLLOW_HL = 0.45   // broadcast/follow spring half-life (~0.45 s)
const CAMERA_OVERHEAD_HL = 1.5  // overhead: very heavy damping — stable wide shot

// ── Play-focus smoother ─────────────────────────────────────────────────────
// EMA time constant for the play-focus layer (seconds).
// ~0.45 s gives clearly visible tracking while remaining smooth.
const PLAY_FOCUS_TAU_X = 0.45  // long-axis (X) — main travel direction
const PLAY_FOCUS_TAU_Z = 0.3   // width (Z) — shorter travel, can be snappier

// Deadzone applied to the RAW puck position before EMA.
// ~5 ft = plausible micro-jitter band; anything larger is a real play shift.
const PLAY_FOCUS_DEADZONE_X = 5.0   // ft on the long axis
const PLAY_FOCUS_DEADZONE_Z = 3.0   // ft on the width axis

// Overhead camera: per-frame clamp on how far the target may move (ft).
const OVERHEAD_TARGET_MAX_DELTA_PER_FRAME = 1.0  // ft/frame (≈60 ft/s at 60fps)

// Max camera speed (ft/s) to cap frame-spike induced jumps.
const CAM_MAX_SPEED_FT_S = 60

// ── Orientation turn-rate clamp ─────────────────────────────────────────────
// Max body rotation speed: ~270°/s. Prevents 180° whips on direction reversal.
const MAX_TURN_RATE_RAD_PER_SEC = (Math.PI * 270) / 180

// ── Animation smoothing ─────────────────────────────────────────────────────
const SPEED_TAU = 0.18        // stride-amplitude smoothing (s) — no leg flicker
const TURN_TAU = 0.25         // bank-into-turn smoothing (s)
const SHOT_SWING_S = 0.32     // stick swing duration on a shot cue
const GOAL_CUE_S = 4.2        // lifetime of the goal cue (celebration cam)

// Atlas slots: 0-5 home skaters, 6-11 away skaters, 12 home G, 13 away G.
const HOME_G_SLOT = 12
const AWAY_G_SLOT = 13

interface PlayerPose {
  worldX: Spring1D
  worldZ: Spring1D
  angle: number            // current orientation (Y-axis, radians) — clamped not sprung
  prevWx: number
  prevWz: number
  speed: number            // raw 0..1 from spring velocity
  speedSm: number          // smoothed speed driving the stride amplitude
  turnSm: number           // smoothed turn rate (rad/s) driving the bank
  stridePhase: number
  animTime: number
  butterflyTimer: number
  butterfly: number        // smoothed 0..1 butterfly blend
  armsTimer: number        // scorer celebration
  staggerTimer: number     // hit reaction
  shotTimer: number        // stick swing
  playerId: PlayerId | null
  rig: AthleteRig
  team: 'home' | 'away'
  labelSprite: THREE.Sprite
}

interface ActiveCue {
  cue: EventCue
  elapsed: number
}

interface GoalLight {
  light: THREE.PointLight
  lamp: THREE.MeshStandardMaterial | undefined
  timer: number
  side: 'left' | 'right'
}

export class Rink3dRenderer implements MatchRenderer {
  // ── THREE objects ──────────────────────────────────────────────────────────
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private composer!: EffectComposer
  private bloom!: UnrealBloomPass
  private arena!: Arena
  private batch!: AthleteBatch
  private atlasCanvas!: HTMLCanvasElement
  private atlasTex!: THREE.CanvasTexture
  private atlasDirty = false
  private blobs!: THREE.InstancedMesh
  private reflectRT!: THREE.WebGLRenderTarget
  private readonly reflectCam = new THREE.PerspectiveCamera()
  private static readonly BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)

  // ── Playback state ─────────────────────────────────────────────────────────
  private timeline: MatchTimeline | null = null
  private clockPos = 0
  private playing = false
  private speed = 1
  private listener: ((v: MatchView) => void) | null = null

  // ── Colors ─────────────────────────────────────────────────────────────────
  private colors: RinkColors = { home: 0x4c9aff, away: 0xff6b6b }
  private homeKit: Kit = kitFor(0x4c9aff, 'home')
  private awayKit: Kit = kitFor(0xff6b6b, 'away')

  // ── Player labels ──────────────────────────────────────────────────────────
  private labels: PlayerLabels = {}

  // ── Players ────────────────────────────────────────────────────────────────
  private homePoses: PlayerPose[] = []
  private awayPoses: PlayerPose[] = []
  private homeGoaliePose: PlayerPose | null = null
  private awayGoaliePose: PlayerPose | null = null

  // ── Puck ───────────────────────────────────────────────────────────────────
  private puckMesh!: THREE.Mesh
  private puckGlowRing!: THREE.Mesh
  private puckRenderX: Spring1D = { pos: 0, vel: 0 }
  private puckRenderZ: Spring1D = { pos: 0, vel: 0 }

  // ── Goal lights ────────────────────────────────────────────────────────────
  private goalLights: GoalLight[] = []

  // ── Event cues ─────────────────────────────────────────────────────────────
  private cues: EventCue[] = []
  private lastEvaluatedClock = -1
  private activeCues: ActiveCue[] = []
  private sinceGoal = Infinity
  private celebration: { elapsed: number; actorId: string } | null = null

  // ── Play-focus smoother ────────────────────────────────────────────────────
  // Two-layer approach: raw puck → play-focus EMA (long tau, deadzone) → camera spring.
  private playFocusX = 0
  private playFocusZ = 0

  // ── Camera spring ──────────────────────────────────────────────────────────
  private camX: Spring1D = { pos: 0, vel: 0 }
  private camY: Spring1D = { pos: 40, vel: 0 }
  private camZ: Spring1D = { pos: -75, vel: 0 }
  private lookX: Spring1D = { pos: 0, vel: 0 }
  private lookY: Spring1D = { pos: 0, vel: 0 }
  private lookZ: Spring1D = { pos: 0, vel: 0 }
  private fov: Spring1D = { pos: 30, vel: 0 }
  private camPreset: CameraPreset = 'broadcast'
  private endzoneActiveSide: 1 | -1 = -1

  // ── Wall clock for animation ───────────────────────────────────────────────
  private lastFrameTime = 0
  private wallTime = 0
  private cpuMsAvg = 0

  // ── Carrier tracking for follow camera ────────────────────────────────────
  private carrierAngle = 0
  private carrierWx = 0
  private carrierWz = 0
  private lastCarrier: PlayerId | null = null

  private constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 1400)
    this.camera.position.set(0, 44, -108)
    this.camera.lookAt(0, 0, 0)
  }

  static async create(parent: HTMLElement, colors?: RinkColors): Promise<Rink3dRenderer> {
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.92
    renderer.info.autoReset = false // composer renders several passes; reset per frame
    renderer.outputColorSpace = THREE.SRGBColorSpace

    const w = parent.clientWidth || 900
    const h = parent.clientHeight || Math.round(w / 2.35)
    renderer.setSize(w, h)
    parent.appendChild(renderer.domElement)

    const inst = new Rink3dRenderer(renderer)
    if (colors) inst.setKits(colors)

    inst.camera.aspect = w / h
    inst.camera.updateProjectionMatrix()

    inst.buildScene()
    inst.buildPost(w, h)
    renderer.setAnimationLoop((time) => inst.animLoop(time))
    return inst
  }

  private setKits(colors: RinkColors): void {
    this.colors = colors
    this.homeKit = kitFor(colors.home, 'home')
    this.awayKit = kitFor(colors.away, 'away')
  }

  // ── Scene construction ────────────────────────────────────────────────────

  private buildScene(): void {
    this.scene.background = new THREE.Color(0x05070a)
    this.scene.fog = new THREE.Fog(0x05070a, 240, 560)

    this.arena = new Arena(this.renderer, this.colors)
    this.scene.add(this.arena.group)
    this.scene.environment = this.arena.environment
    this.scene.environmentIntensity = 0.8

    this.buildLighting()
    this.buildPuck()
    this.buildAthletes()
    this.batch.group.traverse((o) => o.layers.enable(REFLECT_LAYER))
    this.puckMesh.layers.enable(REFLECT_LAYER)
    // lights must be on the reflection layer or the mirrored pass is unlit
    this.scene.traverse((o) => {
      if (o instanceof THREE.Light) o.layers.enable(REFLECT_LAYER)
    })
    this.reflectCam.layers.set(REFLECT_LAYER)
  }

  /**
   * Planar ice reflection: mirror the game camera through the ice plane and
   * draw only REFLECT_LAYER into a half-res target the ice shader samples.
   */
  private renderReflection(): void {
    const cam = this.camera
    const rc = this.reflectCam
    rc.fov = cam.fov
    rc.aspect = cam.aspect
    rc.near = cam.near
    rc.far = cam.far
    rc.updateProjectionMatrix()
    const p = cam.position
    const dir = cam.getWorldDirection(new THREE.Vector3())
    rc.position.set(p.x, -p.y, p.z)
    rc.up.set(0, -1, 0)
    rc.lookAt(p.x + dir.x * 100, -(p.y + dir.y * 100), p.z + dir.z * 100)
    rc.updateMatrixWorld()
    this.arena.reflectUniforms.uReflectMatrix.value
      .copy(Rink3dRenderer.BIAS)
      .multiply(rc.projectionMatrix)
      .multiply(rc.matrixWorldInverse)

    const bg = this.scene.background
    this.scene.background = null
    const prevTarget = this.renderer.getRenderTarget()
    const prevClear = this.renderer.getClearAlpha()
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setRenderTarget(this.reflectRT)
    this.renderer.clear()
    // reuse last frame's shadow maps — don't pay for a second shadow pass
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.render(this.scene, rc)
    this.renderer.shadowMap.autoUpdate = true
    this.renderer.setRenderTarget(prevTarget)
    this.renderer.setClearColor(0x000000, prevClear)
    this.scene.background = bg
  }

  private buildLighting(): void {
    // Arena lighting reads as a big overhead rig: a strong near-vertical key
    // (short, soft shadows under the players), a cool sky fill, and two low
    // rim lights from the ends so the athletes separate from the white ice.
    const hemi = new THREE.HemisphereLight(0xe4ecff, 0x2a2e36, 0.55)
    this.scene.add(hemi)

    const key = new THREE.DirectionalLight(0xfff7ee, 2.1)
    key.position.set(18, 160, -42)
    key.target.position.set(0, 0, 0)
    key.castShadow = true
    key.shadow.mapSize.setScalar(2048)
    key.shadow.camera.left = -112
    key.shadow.camera.right = 112
    key.shadow.camera.top = 60
    key.shadow.camera.bottom = -60
    key.shadow.camera.near = 60
    key.shadow.camera.far = 260
    key.shadow.bias = -0.0004
    key.shadow.normalBias = 0.03
    key.shadow.radius = 3
    this.scene.add(key, key.target)

    for (const x of [-1, 1]) {
      const rim = new THREE.DirectionalLight(0xcfe0ff, 0.55)
      // High enough that their mirror glint on the glossy ice never faces a
      // game camera (a low rim light made a blinding ice glare).
      rim.position.set(x * 110, 95, x * 20)
      this.scene.add(rim)
    }
  }

  private buildPost(w: number, h: number): void {
    const pr = this.renderer.getPixelRatio()
    this.reflectRT = new THREE.WebGLRenderTarget(Math.round(w * 0.5), Math.round(h * 0.5), { type: THREE.HalfFloatType })
    this.arena.reflectUniforms.tReflect.value = this.reflectRT.texture
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: 4 })
    this.composer = new EffectComposer(this.renderer, rt)
    this.composer.setPixelRatio(pr)
    this.composer.setSize(w, h)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    // Subtle: only the rig fixtures, video board, goal lamps and hot ice
    // specular cross the threshold — broadcast glow, not a music video.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.3, 0.5, 1.35)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
  }

  private buildPuck(): void {
    const puckGeo = new THREE.CylinderGeometry(PUCK_R, PUCK_R, PUCK_H, 20)
    const puckMat = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.55, metalness: 0.1 })
    this.puckMesh = new THREE.Mesh(puckGeo, puckMat)
    this.puckMesh.castShadow = true
    this.scene.add(this.puckMesh)

    // Carrier ring: a thin broadcast-style halo so the puck stays readable
    const ringGeo = new THREE.TorusGeometry(PUCK_R + 0.75, 0.07, 6, 40)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.7, depthWrite: false })
    this.puckGlowRing = new THREE.Mesh(ringGeo, ringMat)
    this.puckGlowRing.rotation.x = Math.PI / 2
    this.puckGlowRing.visible = false
    this.scene.add(this.puckGlowRing)
  }

  private buildAthletes(): void {
    this.atlasCanvas = buildAtlasCanvas()
    this.atlasTex = new THREE.CanvasTexture(this.atlasCanvas)
    this.atlasTex.colorSpace = THREE.SRGBColorSpace
    this.atlasTex.anisotropy = 4

    const rigs: AthleteRig[] = []
    const mk = (team: 'home' | 'away', goalie: boolean, slot: number, wx: number, wz: number): PlayerPose => {
      const rig = new AthleteRig(goalie, slot)
      rig.kit = team === 'home' ? this.homeKit : this.awayKit
      rigs.push(rig)
      return {
        worldX: snapSpring(wx),
        worldZ: snapSpring(wz),
        angle: team === 'home' ? Math.PI / 2 : -Math.PI / 2,
        prevWx: wx,
        prevWz: wz,
        speed: 0,
        speedSm: 0,
        turnSm: 0,
        stridePhase: (slot * 1.7) % (Math.PI * 2),
        animTime: 0,
        butterflyTimer: 0,
        butterfly: 0,
        armsTimer: 0,
        staggerTimer: 0,
        shotTimer: -1,
        playerId: null,
        rig,
        team,
        labelSprite: this.makeLabelSprite(),
      }
    }
    for (let i = 0; i < 6; i++) {
      this.homePoses.push(mk('home', false, i, -10, (i - 2.5) * 8))
      this.awayPoses.push(mk('away', false, 6 + i, 10, (i - 2.5) * 8))
    }
    this.homeGoaliePose = mk('home', true, HOME_G_SLOT, -NET_X + 4, 0)
    this.awayGoaliePose = mk('away', true, AWAY_G_SLOT, NET_X - 4, 0)
    for (const p of this.allPoses()) {
      this.paintSlot(p)
      this.scene.add(p.labelSprite)
    }

    this.batch = new AthleteBatch(rigs, this.atlasTex)
    this.batch.applyColors()
    this.scene.add(this.batch.group)

    // Contact shadows: one soft blob per player + the puck (grounding at any
    // shadow-map resolution, and they read from the overhead camera too).
    const blobGeo = new THREE.PlaneGeometry(1, 1)
    blobGeo.rotateX(-Math.PI / 2)
    this.blobs = new THREE.InstancedMesh(
      blobGeo,
      new THREE.MeshBasicMaterial({ map: this.arena.blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      rigs.length + 1
    )
    this.blobs.frustumCulled = false
    this.blobs.renderOrder = 1
    this.scene.add(this.blobs)
  }

  private allPoses(): PlayerPose[] {
    return [
      ...this.homePoses,
      ...this.awayPoses,
      ...(this.homeGoaliePose ? [this.homeGoaliePose] : []),
      ...(this.awayGoaliePose ? [this.awayGoaliePose] : []),
    ]
  }

  private paintSlot(p: PlayerPose): void {
    const kit = p.team === 'home' ? this.homeKit : this.awayKit
    const num = p.playerId ? (this.labels[p.playerId]?.number ?? jerseyNumber(p.playerId)) : p.rig.goalie ? 30 : 10 + p.rig.slot
    paintJerseySlot(this.atlasCanvas, p.rig.slot, kit, num, p.rig.goalie)
    this.atlasDirty = true
  }

  private makeLabelSprite(): THREE.Sprite {
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 64
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(4.4, 1.1, 1)
    sprite.visible = false
    sprite.renderOrder = 10
    return sprite
  }

  private drawLabel(sprite: THREE.Sprite, text: string, team: 'home' | 'away'): void {
    const mat = sprite.material as THREE.SpriteMaterial
    const tex = mat.map as THREE.CanvasTexture
    const c = tex.image as HTMLCanvasElement
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, 256, 64)
    ctx.fillStyle = 'rgba(8,10,14,0.62)'
    ctx.beginPath()
    ctx.roundRect(4, 10, 248, 44, 7)
    ctx.fill()
    const kit = team === 'home' ? this.homeKit : this.awayKit
    ctx.fillStyle = `#${(team === 'home' ? kit.jersey : kit.trim).toString(16).padStart(6, '0')}`
    ctx.fillRect(4, 10, 8, 44)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 28px Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 132, 33, 232)
    tex.needsUpdate = true
  }

  /**
   * Update the label + jersey slot whenever the player in this slot changes
   * (or on first population). Reuses the existing sprite — no allocation.
   */
  private updatePoseLabelForPlayer(pose: PlayerPose, newId: PlayerId | undefined | null): void {
    const id = newId ?? null
    if (id === pose.playerId) return
    pose.playerId = id
    if (id) this.paintSlot(pose)
    const info = id ? this.labels[id] : undefined
    if (!id || !info) {
      pose.labelSprite.visible = false
      pose.labelSprite.userData.hasLabel = false
      return
    }
    const labelText = info.number !== undefined ? `${info.number} ${info.lastName}` : info.lastName
    this.drawLabel(pose.labelSprite, labelText, pose.team)
    pose.labelSprite.userData.hasLabel = true
    pose.labelSprite.visible = true
  }

  // ── MatchRenderer interface ───────────────────────────────────────────────

  load(timeline: MatchTimeline, colors?: RinkColors, labels?: PlayerLabels): void {
    if (colors) {
      this.setKits(colors)
      this.arena.setColors(colors)
      for (const p of this.allPoses()) p.rig.kit = p.team === 'home' ? this.homeKit : this.awayKit
      this.batch.applyColors()
    }
    if (labels) this.labels = labels
    this.timeline = timeline
    this.clockPos = 0
    this.playing = false
    this.lastEvaluatedClock = -1
    this.activeCues = []
    this.celebration = null
    this.sinceGoal = Infinity

    // Reset per-slot state so jerseys/labels repaint for the new game
    for (const p of this.allPoses()) {
      p.playerId = null
      p.labelSprite.visible = false
      p.butterflyTimer = p.armsTimer = p.staggerTimer = 0
      p.butterfly = 0
      p.shotTimer = -1
      this.paintSlot(p)
    }

    // Goal lights (hidden until triggered)
    for (const glData of this.goalLights) this.scene.remove(glData.light)
    this.goalLights = []
    for (const side of ['left', 'right'] as const) {
      const light = new THREE.PointLight(0xff2222, 0, 60, 1.6)
      light.position.set(side === 'left' ? -NET_X - 6 : NET_X + 6, 12, 0)
      this.scene.add(light)
      this.goalLights.push({ light, lamp: this.arena.goalLamps[side === 'left' ? 0 : 1], timer: 0, side })
    }

    this.renderAt(0)
    // Snap play-focus to initial puck position so there is no EMA warmup lag
    this.playFocusX = this.puckMesh.position.x
    this.playFocusZ = this.puckMesh.position.z
    this.snapAllSprings()
    // Snap the camera to the correct broadcast pose for the opening puck position
    // so there is zero fly-in / settle wobble on the first frame.
    this.snapCameraToTarget()
    this.emit()
  }

  onUpdate(cb: (v: MatchView) => void): void {
    this.listener = cb
    this.emit()
  }

  play(): void {
    if (!this.timeline) return
    if (this.clockPos >= this.timeline.duration) this.clockPos = 0
    this.playing = true
    this.emit()
  }

  pause(): void {
    this.playing = false
    this.emit()
  }

  toggle(): void {
    this.playing ? this.pause() : this.play()
  }

  setSpeed(x: number): void {
    this.speed = x
  }

  seekFraction(f: number): void {
    if (!this.timeline) return
    this.clockPos = Math.max(0, Math.min(1, f)) * this.timeline.duration
    // On seek: bump stale cues, reset spring state so no rubber-band flight
    this.lastEvaluatedClock = this.clockPos
    this.activeCues = []
    this.celebration = null
    this.sinceGoal = Infinity
    for (const p of this.allPoses()) {
      p.butterflyTimer = p.armsTimer = p.staggerTimer = 0
      p.shotTimer = -1
    }

    this.renderAt(this.clockPos)
    this.playFocusX = this.puckMesh.position.x
    this.playFocusZ = this.puckMesh.position.z
    this.snapAllSprings()
    this.snapCameraToTarget()
    this.emit()
  }

  /** Hard-snap all position springs (after seek / camera switch). */
  private snapAllSprings(): void {
    for (const p of this.allPoses()) {
      p.worldX = snapSpring(p.worldX.pos)
      p.worldZ = snapSpring(p.worldZ.pos)
    }
    this.puckRenderX = snapSpring(this.puckMesh.position.x)
    this.puckRenderZ = snapSpring(this.puckMesh.position.z)
  }

  private currentTarget() {
    return cameraTargetFor(this.camPreset, this.playFocusX, {
      endzoneActiveSide: this.endzoneActiveSide,
      carrierAngle: this.carrierAngle,
      carrierWx: this.carrierWx,
      carrierWz: this.carrierWz,
      puckWz: this.playFocusZ,
    })
  }

  /**
   * Hard-snap the camera spring state to the correct target for the current
   * preset + play-focus position (after load / seek) — zero fly-in.
   */
  private snapCameraToTarget(): void {
    this.endzoneActiveSide = endzoneChooseEnd(this.endzoneActiveSide, this.playFocusX)
    const target = this.currentTarget()
    this.camX = snapSpring(target.px)
    this.camY = snapSpring(target.py)
    this.camZ = snapSpring(target.pz)
    this.lookX = snapSpring(target.lx)
    this.lookY = snapSpring(target.ly)
    this.lookZ = snapSpring(target.lz)
    this.fov = snapSpring(cameraFovFor(this.camPreset))
    this.applyFov(this.fov.pos)
    this.camera.position.set(target.px, target.py, target.pz)
    this.camera.lookAt(target.lx, target.ly, target.lz)
  }

  private applyFov(f: number): void {
    if (Math.abs(this.camera.fov - f) > 1e-3) {
      this.camera.fov = f
      this.camera.updateProjectionMatrix()
    }
  }

  resize(): void {
    const canvas = this.renderer.domElement
    const parent = canvas.parentElement
    if (!parent) return
    const w = parent.clientWidth || 900
    const h = parent.clientHeight || Math.round(w / 2.35)
    this.renderer.setSize(w, h)
    this.composer.setSize(w, h)
    this.reflectRT.setSize(Math.round(w * 0.5), Math.round(h * 0.5))
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  destroy(): void {
    this.renderer.setAnimationLoop(null)
    this.batch.dispose()
    this.arena.dispose()
    this.atlasTex.dispose()
    for (const p of this.allPoses()) {
      ;(p.labelSprite.material as THREE.SpriteMaterial).map?.dispose()
      p.labelSprite.material.dispose()
    }
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
        else obj.material.dispose()
      }
    })
    this.composer.dispose()
    this.reflectRT.dispose()
    this.renderer.dispose()
    this.renderer.domElement.parentElement?.removeChild(this.renderer.domElement)
  }

  // ── Event stream ──────────────────────────────────────────────────────────

  setEventStream(stream: GameStream): void {
    this.cues = extractCues(stream)
  }

  /**
   * Switch camera preset.
   * Hard-resets ALL camera spring state and snaps to the new pose immediately
   * so there is no bounce/transition from the old position.
   */
  setCamera(preset: CameraPreset): void {
    this.camPreset = preset
    const puckWx = this.puckMesh.position.x
    const puckWz = this.puckMesh.position.z
    this.endzoneActiveSide = endzoneChooseEnd(this.endzoneActiveSide, puckWx)
    this.playFocusX = puckWx
    this.playFocusZ = puckWz
    this.celebration = null
    this.snapCameraToTarget()
  }

  /** Dev harness only: pin the camera to a fixed pose (null = normal presets). */
  setDebugCamera(pose: { px: number; py: number; pz: number; lx: number; ly: number; lz: number; fov?: number } | null): void {
    this.debugCam = pose
  }
  private debugCam: { px: number; py: number; pz: number; lx: number; ly: number; lz: number; fov?: number } | null = null

  /** Dev/perf probe: draw calls, triangles, CPU ms per frame (EMA). */
  debugInfo(): { calls: number; triangles: number; cpuMs: number; athleteDraws: number } {
    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      cpuMs: +this.cpuMsAvg.toFixed(2),
      athleteDraws: this.batch.drawCalls,
    }
  }

  // ── Animation loop ────────────────────────────────────────────────────────

  private animLoop(time: number): void {
    const t0 = performance.now()
    const dtMs = this.lastFrameTime === 0 ? 16 : time - this.lastFrameTime
    this.lastFrameTime = time
    const dt = Math.min(dtMs / 1000, 0.1) // cap at 100ms to avoid spiral-of-death
    this.wallTime += dt

    if (this.playing && this.timeline) {
      this.clockPos += dt * this.speed
      if (this.clockPos >= this.timeline.duration) {
        this.clockPos = this.timeline.duration
        this.playing = false
      }
    }

    // Animation time only advances while the game clock does — a paused game
    // is a frozen frame (crowd keeps breathing via wallTime).
    const simDt = this.playing ? dt * Math.min(this.speed, 4) : 0
    this.renderAt(this.clockPos, dt, simDt)
    this.updateCues(this.clockPos, dt)
    this.updateCamera(dt)
    this.updateArena(dt)
    this.emit()
    if (this.atlasDirty) {
      this.atlasTex.needsUpdate = true
      this.atlasDirty = false
    }
    this.renderer.info.reset()
    this.renderReflection()
    this.composer.render(dt)
    const cpu = performance.now() - t0
    this.cpuMsAvg = this.cpuMsAvg === 0 ? cpu : this.cpuMsAvg + (cpu - this.cpuMsAvg) * 0.05
  }

  private updateArena(dt: number): void {
    if (!this.timeline) return
    const score = this.timeline.scoreAt(this.clockPos)
    const clock = this.timeline.clockAt(this.clockPos)
    if (this.playing) this.sinceGoal += dt
    const goalFlash = this.sinceGoal < 3.5 ? 3.5 - this.sinceGoal : 0
    this.arena.update(this.wallTime, {
      homeScore: score.home,
      awayScore: score.away,
      period: clock.period,
      clock: clock.text,
      excite: crowdExcitement(this.sinceGoal),
      goalFlash,
    })
  }

  // ── Render frame ──────────────────────────────────────────────────────────

  /**
   * @param dt    wall-clock frame delta (drives position springs; 0 = seek snap)
   * @param simDt animation delta — 0 while paused so limbs freeze with the play
   */
  private renderAt(absT: number, dt = 0, simDt = dt): void {
    const tl = this.timeline
    if (!tl) return
    const snap = tl.sampleAt(absT)
    if (!snap) return
    this.lastCarrier = snap.carrier
    const puckWx = normXtoWorld(snap.puck.x)
    const puckWz = normYtoWorld(snap.puck.y)

    // Home skaters
    for (let i = 0; i < this.homePoses.length; i++) {
      const pose = this.homePoses[i]!
      if (i < snap.home.length) {
        pose.rig.visible = true
        this.updatePoseLabelForPlayer(pose, snap.homeIds?.[i])
        this.updatePose(pose, snap.home[i]?.x ?? 0, snap.home[i]?.y ?? 0, dt, simDt, puckWx, puckWz)
      } else {
        pose.rig.visible = false
        pose.labelSprite.visible = false
      }
    }
    // Away skaters
    for (let i = 0; i < this.awayPoses.length; i++) {
      const pose = this.awayPoses[i]!
      if (i < snap.away.length) {
        pose.rig.visible = true
        this.updatePoseLabelForPlayer(pose, snap.awayIds?.[i])
        this.updatePose(pose, snap.away[i]?.x ?? 0, snap.away[i]?.y ?? 0, dt, simDt, puckWx, puckWz)
      } else {
        pose.rig.visible = false
        pose.labelSprite.visible = false
      }
    }

    // Goalies
    if (this.homeGoaliePose) {
      this.updatePoseLabelForPlayer(this.homeGoaliePose, snap.homeGoalieId)
      this.updateGoaliePose(this.homeGoaliePose, snap.homeGoalie.x, snap.homeGoalie.y, snap.puck, dt, simDt)
    }
    if (this.awayGoaliePose) {
      this.updatePoseLabelForPlayer(this.awayGoaliePose, snap.awayGoalieId)
      this.updateGoaliePose(this.awayGoaliePose, snap.awayGoalie.x, snap.awayGoalie.y, snap.puck, dt, simDt)
    }

    // Carrier pose (resolved AFTER the slots updated their ids this frame)
    let carrierPose: PlayerPose | null = null
    if (snap.carrier !== null) {
      carrierPose = this.allPoses().find((p) => p.playerId === snap.carrier && p.rig.visible) ?? null
    }

    // Puck position: if carried, sits on the carrier's blade
    let pTargetX: number
    let pTargetZ: number
    if (carrierPose !== null) {
      const offset = puckCarriedOffset(carrierPose.angle)
      pTargetX = carrierPose.worldX.pos + offset.dx
      pTargetZ = carrierPose.worldZ.pos + offset.dz
      this.carrierAngle = carrierPose.angle
      this.carrierWx = carrierPose.worldX.pos
      this.carrierWz = carrierPose.worldZ.pos
    } else {
      pTargetX = normXtoWorld(snap.puck.x)
      pTargetZ = normYtoWorld(snap.puck.y)
      this.carrierWx = pTargetX
      this.carrierWz = pTargetZ
    }

    // Smooth puck position with a tight spring (not teleport-snappy but responsive)
    if (dt > 0) {
      this.puckRenderX = springStep(this.puckRenderX, pTargetX, dt, PLAYER_FOLLOW_HL)
      this.puckRenderZ = springStep(this.puckRenderZ, pTargetZ, dt, PLAYER_FOLLOW_HL)
    } else {
      this.puckRenderX = snapSpring(pTargetX)
      this.puckRenderZ = snapSpring(pTargetZ)
    }

    this.puckMesh.position.set(this.puckRenderX.pos, PUCK_H / 2, this.puckRenderZ.pos)
    this.puckGlowRing.position.set(this.puckRenderX.pos, 0.06, this.puckRenderZ.pos)
    this.puckGlowRing.visible = snap.carrier !== null

    this.batch.sync()
    this.syncBlobs()
  }

  private syncBlobs(): void {
    const m = new THREE.Matrix4()
    const poses = this.allPoses()
    poses.forEach((p, i) => {
      if (!p.rig.visible) {
        m.makeScale(0, 0, 0)
      } else {
        const s = p.rig.goalie ? 5.2 + p.butterfly * 1.5 : 3.6
        m.makeScale(s, 1, s * 0.9).setPosition(p.worldX.pos, 0.04, p.worldZ.pos)
      }
      this.blobs.setMatrixAt(i, m)
    })
    m.makeScale(1.1, 1, 1.1).setPosition(this.puckRenderX.pos, 0.035, this.puckRenderZ.pos)
    this.blobs.setMatrixAt(poses.length, m)
    this.blobs.instanceMatrix.needsUpdate = true
  }

  private updatePose(pose: PlayerPose, nx: number, ny: number, dt: number, simDt: number, puckWx: number, puckWz: number): void {
    const wx = normXtoWorld(nx)
    const wz = normYtoWorld(ny)

    if (dt > 0) {
      pose.worldX = springStep(pose.worldX, wx, dt, PLAYER_FOLLOW_HL)
      pose.worldZ = springStep(pose.worldZ, wz, dt, PLAYER_FOLLOW_HL)
    } else {
      // dt === 0 is a seek/scrub/replay jump — snap directly to the sampled
      // position (zero velocity) so the player doesn't fly in from his old spot
      // and overshoot. Sync prev* so no fake velocity spike is computed.
      pose.worldX = snapSpring(wx)
      pose.worldZ = snapSpring(wz)
      pose.prevWx = wx
      pose.prevWz = wz
      pose.speed = 0
    }

    // Velocity-based speed
    const vx = pose.worldX.pos - pose.prevWx
    const vz = pose.worldZ.pos - pose.prevWz
    const distSq = vx * vx + vz * vz
    const speedFt = dt > 0 ? Math.sqrt(distSq) / dt : 0
    pose.speed = Math.min(1, speedFt / 22)
    pose.prevWx = pose.worldX.pos
    pose.prevWz = pose.worldZ.pos

    // Orientation — clamped turn rate to prevent body whips. Skaters face
    // where they skate, except when gliding slowly or backing up against the
    // play, where (like real players) they square up to the puck.
    const prevAngle = pose.angle
    if (dt > 0) {
      const target = facingTarget(Math.atan2(vx, vz), speedFt, Math.atan2(puckWx - pose.worldX.pos, puckWz - pose.worldZ.pos), pose.playerId !== null && pose.playerId === this.lastCarrier)
      if (target !== null) pose.angle = clampTurnRate(pose.angle, target, dt, MAX_TURN_RATE_RAD_PER_SEC)
    } else {
      // seek/load: no velocity yet — start squared up to the puck
      pose.angle = Math.atan2(puckWx - wx, puckWz - wz)
    }
    const turnRate = dt > 0 ? wrapAngle(pose.angle - prevAngle) / dt : 0

    if (dt === 0) {
      pose.speedSm = 0
      pose.turnSm = 0
    } else if (simDt > 0) {
      pose.speedSm = emaStep(pose.speedSm, pose.speed, simDt, SPEED_TAU)
      pose.turnSm = emaStep(pose.turnSm, turnRate, simDt, TURN_TAU)
    }
    pose.animTime += simDt
    pose.stridePhase = advanceStridePhase(pose.stridePhase, pose.speedSm, simDt)

    const body = skaterPose(pose.stridePhase, pose.speedSm, pose.turnSm)
    // Hit reaction: a decaying stagger in the torso (no positional shake)
    if (pose.staggerTimer > 0) {
      const k = pose.staggerTimer / 0.5
      body.torsoRoll += Math.sin(pose.animTime * 18) * 0.28 * k
      body.lean += 0.25 * k
      pose.staggerTimer = Math.max(0, pose.staggerTimer - simDt)
    }
    let stick: { mode: 'carry' | 'shoot' | 'raise'; t?: number } = { mode: 'carry' }
    if (pose.armsTimer > 0) {
      stick = { mode: 'raise' }
      body.lean = Math.max(0.05, body.lean - 0.3)
      pose.armsTimer = Math.max(0, pose.armsTimer - simDt)
    } else if (pose.shotTimer >= 0) {
      stick = { mode: 'shoot', t: pose.shotTimer / SHOT_SWING_S }
      body.torsoYaw += Math.sin((pose.shotTimer / SHOT_SWING_S) * Math.PI) * 0.35
      pose.shotTimer += simDt
      if (pose.shotTimer > SHOT_SWING_S) pose.shotTimer = -1
    }
    pose.rig.apply(pose.worldX.pos, pose.worldZ.pos, pose.angle, body, stick)

    pose.labelSprite.position.set(pose.worldX.pos, body.hipHeight + 4.4, pose.worldZ.pos)
    pose.labelSprite.visible = pose.rig.visible && pose.labelSprite.userData.hasLabel === true
  }

  private updateGoaliePose(
    pose: PlayerPose,
    nx: number,
    ny: number,
    puck: { x: number; y: number },
    dt: number,
    simDt: number
  ): void {
    const wx = normXtoWorld(nx)
    const wz = normYtoWorld(ny)
    if (dt > 0) {
      pose.worldX = springStep(pose.worldX, wx, dt, PLAYER_FOLLOW_HL)
      pose.worldZ = springStep(pose.worldZ, wz, dt, PLAYER_FOLLOW_HL)
    } else {
      pose.worldX = snapSpring(wx)
      pose.worldZ = snapSpring(wz)
    }
    // A pulled goalie sits at the bench position — hide him (the extra
    // attacker is already in the skater array).
    pose.rig.visible = Math.abs(wx) > 45

    // Face puck — clamped turn rate (goalies can turn faster than skaters)
    const pWx = normXtoWorld(puck.x)
    const pWz = normYtoWorld(puck.y)
    const dx = pWx - pose.worldX.pos
    const dz = pWz - pose.worldZ.pos
    if (dx * dx + dz * dz > 0.1 && dt > 0) {
      const targetAngle = Math.atan2(dx, dz)
      pose.angle = clampTurnRate(pose.angle, targetAngle, dt, MAX_TURN_RATE_RAD_PER_SEC * 1.5)
    } else if (dt === 0) {
      pose.angle = Math.atan2(dx, dz)
    }

    pose.animTime += simDt
    const wantDown = pose.butterflyTimer > 0 ? 1 : 0
    pose.butterflyTimer = Math.max(0, pose.butterflyTimer - simDt)
    // drop fast, recover slower
    if (dt === 0) pose.butterfly = wantDown
    else if (simDt > 0) pose.butterfly = emaStep(pose.butterfly, wantDown, simDt, wantDown ? 0.06 : 0.22)

    const body = goaliePose(pose.butterfly)
    pose.rig.apply(pose.worldX.pos, pose.worldZ.pos, pose.angle, body, { mode: 'carry' })

    pose.labelSprite.position.set(pose.worldX.pos, body.hipHeight + 4.6, pose.worldZ.pos)
    pose.labelSprite.visible = pose.rig.visible && pose.labelSprite.userData.hasLabel === true
  }

  // ── Event cues ────────────────────────────────────────────────────────────

  private updateCues(absT: number, dt: number): void {
    if (absT > this.lastEvaluatedClock) {
      for (const cue of this.cues) {
        if (cue.absT > this.lastEvaluatedClock && cue.absT <= absT) this.activateCue(cue)
      }
    }
    this.lastEvaluatedClock = absT

    const cueDt = this.playing ? dt : 0
    this.activeCues = this.activeCues.filter((ac) => {
      ac.elapsed += cueDt
      return ac.elapsed < this.cueLifetime(ac.cue.kind)
    })
    if (this.celebration) {
      this.celebration.elapsed += cueDt
      if (this.celebration.elapsed >= GOAL_CUE_S) this.celebration = null
    }

    // Goal lights: red wash + lamp strobe
    for (const gl of this.goalLights) {
      if (gl.timer > 0) {
        gl.timer -= cueDt
        const k = Math.max(0, gl.timer / 3)
        const strobe = 0.6 + 0.4 * Math.sin(this.wallTime * 14)
        gl.light.intensity = k * 900 * strobe
        if (gl.lamp) gl.lamp.emissiveIntensity = k > 0 ? 7 * strobe : 0
      } else {
        gl.light.intensity = 0
        if (gl.lamp) gl.lamp.emissiveIntensity = 0
      }
    }
  }

  private cueLifetime(kind: string): number {
    switch (kind) {
      case 'goal': return GOAL_CUE_S
      case 'save': return 0.6
      case 'hit': return 0.5
      default: return 0.35
    }
  }

  private activateCue(cue: EventCue): void {
    this.activeCues.push({ cue, elapsed: 0 })

    if (cue.kind === 'goal') {
      // cue.nx < 0 → left net, nx > 0 → right net
      const side = cue.nx < 0 ? 'left' : 'right'
      const gl = this.goalLights.find((g) => g.side === side)
      if (gl) gl.timer = 3
      this.setPoseEffect(cue.actorId, 'arms', 2.4)
      this.sinceGoal = 0
      this.celebration = { elapsed: 0, actorId: cue.actorId }
    } else if (cue.kind === 'save') {
      this.setGoalieEffect(cue.actorId, cue.nx, 0.55)
    } else if (cue.kind === 'hit') {
      this.setPoseEffect(cue.actorId, 'stagger', 0.5)
    } else if (cue.kind === 'shot') {
      this.setPoseEffect(cue.actorId, 'shot', 0)
    }
  }

  private setPoseEffect(actorId: string, kind: 'arms' | 'stagger' | 'shot', duration: number): void {
    for (const p of [...this.homePoses, ...this.awayPoses]) {
      if (p.playerId === actorId) {
        if (kind === 'arms') p.armsTimer = duration
        else if (kind === 'stagger') p.staggerTimer = duration
        else p.shotTimer = 0
        return
      }
    }
  }

  private setGoalieEffect(actorId: string, nx: number, duration: number): void {
    for (const p of [this.homeGoaliePose, this.awayGoaliePose]) {
      if (p && p.playerId === actorId) {
        p.butterflyTimer = duration
        return
      }
    }
    // Fallback: the goalie in the net nearest the save position
    const g = nx < 0 ? this.homeGoaliePose : this.awayGoaliePose
    const other = g === this.homeGoaliePose ? this.awayGoaliePose : this.homeGoaliePose
    const pick = g && Math.sign(g.worldX.pos) === Math.sign(nx) ? g : other
    if (pick) pick.butterflyTimer = duration
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  private updateCamera(dt: number): void {
    // ── Layer 1: deadzone on raw puck input ──────────────────────────────────
    const rawX = this.puckRenderX.pos
    const rawZ = this.puckRenderZ.pos
    const committedX = applyDeadzone(rawX, this.playFocusX, PLAY_FOCUS_DEADZONE_X)
    const committedZ = applyDeadzone(rawZ, this.playFocusZ, PLAY_FOCUS_DEADZONE_Z)

    // ── Layer 2: EMA smoothing toward the committed target ───────────────────
    const tauX = this.camPreset === 'overhead' ? PLAY_FOCUS_TAU_X * 1.6 : PLAY_FOCUS_TAU_X
    const tauZ = this.camPreset === 'overhead' ? PLAY_FOCUS_TAU_Z * 1.6 : PLAY_FOCUS_TAU_Z
    let newFocusX = emaStep(this.playFocusX, committedX, dt, tauX)
    let newFocusZ = emaStep(this.playFocusZ, committedZ, dt, tauZ)

    // ── Layer 3: per-frame clamp for overhead ────────────────────────────────
    if (this.camPreset === 'overhead') {
      const maxDX = OVERHEAD_TARGET_MAX_DELTA_PER_FRAME
      newFocusX = Math.max(this.playFocusX - maxDX, Math.min(this.playFocusX + maxDX, newFocusX))
      newFocusZ = Math.max(this.playFocusZ - maxDX, Math.min(this.playFocusZ + maxDX, newFocusZ))
    }
    this.playFocusX = Number.isFinite(newFocusX) ? newFocusX : this.playFocusX
    this.playFocusZ = Number.isFinite(newFocusZ) ? newFocusZ : this.playFocusZ

    this.endzoneActiveSide = endzoneChooseEnd(this.endzoneActiveSide, this.playFocusX)
    const target = this.currentTarget()
    let fovTarget = cameraFovFor(this.camPreset)

    // Goal celebration: the broadcast cam eases in on the scorer, holds, and
    // eases back out. Blended target → the same springs → no cut, no shake.
    if (this.celebration && this.camPreset === 'broadcast') {
      const w = celebrationWeight(this.celebration.elapsed, GOAL_CUE_S)
      if (w > 0) {
        const scorer = [...this.homePoses, ...this.awayPoses].find((p) => p.playerId === this.celebration!.actorId && p.rig.visible)
        const sx = scorer ? scorer.worldX.pos : this.puckRenderX.pos
        const sz = scorer ? scorer.worldZ.pos : this.puckRenderZ.pos
        const c = celebrationTarget(sx, sz)
        target.px += (c.px - target.px) * w
        target.py += (c.py - target.py) * w
        target.pz += (c.pz - target.pz) * w
        target.lx += (c.lx - target.lx) * w
        target.ly += (c.ly - target.ly) * w
        target.lz += (c.lz - target.lz) * w
        fovTarget += (c.fov - fovTarget) * w
      }
    }

    const safeTarget = {
      px: Number.isFinite(target.px) ? target.px : this.camX.pos,
      py: Number.isFinite(target.py) ? target.py : this.camY.pos,
      pz: Number.isFinite(target.pz) ? target.pz : this.camZ.pos,
      lx: Number.isFinite(target.lx) ? target.lx : this.lookX.pos,
      ly: Number.isFinite(target.ly) ? target.ly : this.lookY.pos,
      lz: Number.isFinite(target.lz) ? target.lz : this.lookZ.pos,
    }

    // ── Layer 4: camera spring (critically damped) ───────────────────────────
    const hl = this.camPreset === 'overhead' ? CAMERA_OVERHEAD_HL : CAMERA_FOLLOW_HL
    const prevCamX = this.camX.pos
    const prevCamZ = this.camZ.pos
    this.camX = springStep(this.camX, safeTarget.px, dt, hl)
    this.camY = springStep(this.camY, safeTarget.py, dt, CAMERA_FOLLOW_HL)
    this.camZ = springStep(this.camZ, safeTarget.pz, dt, CAMERA_FOLLOW_HL)
    this.lookX = springStep(this.lookX, safeTarget.lx, dt, hl)
    this.lookY = springStep(this.lookY, safeTarget.ly, dt, CAMERA_FOLLOW_HL)
    this.lookZ = springStep(this.lookZ, safeTarget.lz, dt, CAMERA_FOLLOW_HL)
    this.fov = springStep(this.fov, fovTarget, dt, 0.6)

    // ── Layer 5: max-speed clamp ─────────────────────────────────────────────
    this.camX = { pos: clampSpeed(prevCamX, this.camX.pos, dt, CAM_MAX_SPEED_FT_S), vel: this.camX.vel }
    this.camZ = { pos: clampSpeed(prevCamZ, this.camZ.pos, dt, CAM_MAX_SPEED_FT_S), vel: this.camZ.vel }

    this.applyFov(this.fov.pos)
    this.camera.position.set(this.camX.pos, this.camY.pos, this.camZ.pos)
    this.camera.lookAt(this.lookX.pos, this.lookY.pos, this.lookZ.pos)
    if (this.debugCam) {
      const d = this.debugCam
      this.applyFov(d.fov ?? 35)
      this.camera.position.set(d.px, d.py, d.pz)
      this.camera.lookAt(d.lx, d.ly, d.lz)
    }
  }

  // ── Emit ──────────────────────────────────────────────────────────────────

  private emit(): void {
    if (!this.listener || !this.timeline) return
    const score = this.timeline.scoreAt(this.clockPos)
    const clock = this.timeline.clockAt(this.clockPos)
    const ended = this.clockPos >= this.timeline.duration
    this.listener({
      period: clock.period,
      clock: clock.text,
      homeScore: ended ? this.timeline.homeFinal : score.home,
      awayScore: ended ? this.timeline.awayFinal : score.away,
      playing: this.playing,
      progress: this.timeline.duration > 0 ? this.clockPos / this.timeline.duration : 0,
      ended,
    })
  }
}
