/**
 * 3D rink renderer — implements MatchRenderer using three.js.
 *
 * Architecture:
 *   - Pure math/data helpers live in math.ts and iceCanvas.ts (unit-testable).
 *   - This file owns all THREE objects: scene, camera, lights, meshes.
 *   - 1 unit = 1 foot; rink is 200ft × 85ft; y-up world.
 *   - Normalized domain positions mapped via normXtoWorld / normYtoWorld.
 *   - Wall-clock playback loop: setAnimationLoop drives clockPos forward.
 *   - MatchView emitted on every frame (matching 2D semantics exactly).
 */

import * as THREE from 'three'
import type { MatchTimeline } from '@render2d/timeline'
import type { MatchRenderer, MatchView, RinkColors } from '@render2d/rendererContract'
import type { GameStream, PlayerId } from '@domain'
import {
  normXtoWorld,
  normYtoWorld,
  springStep,
  snapSpring,
  angleSpringStep,
  clampTurnRate,
  jerseyNumber,
  extractCues,
  cameraTargetFor,
  endzoneChooseEnd,
  puckCarriedOffset,
  skaterBob,
  legSwingAngle,
  type CameraPreset,
  type EventCue,
  type Spring1D,
} from './math'
import { buildIceCanvas } from './iceCanvas'

// ── Rink constants (feet) ────────────────────────────────────────────────────
const RINK_W = 200    // length along X
const RINK_D = 85     // width along Z
const BOARD_H = 3.5   // board wall height
const GLASS_H = 8     // glass panel height above boards
const NET_X = 89      // goal-line distance from center
const NET_W = 6       // net mouth width (Z)
const NET_H = 4       // net mouth height (Y)
const NET_D = 3.5     // net depth (X)
const PUCK_R = 0.5
const PUCK_H = 0.08

// ── Player geometry sizes ───────────────────────────────────────────────────
const TORSO_H = 3.2
const TORSO_W = 1.6
const HEAD_R = 0.55
const LEG_H = 2.6
const LEG_W = 0.5
const STICK_L = 5
const GOALIE_TORSO_W = 2.1

// ── Spring half-lives ───────────────────────────────────────────────────────
const PLAYER_FOLLOW_HL = 0.08
const CAMERA_FOLLOW_HL = 0.35
const CAMERA_OVERHEAD_HL = 0.6   // heavier damping for overhead x-follow
const ANGLE_FOLLOW_HL = 0.12

// ── Orientation turn-rate clamp ─────────────────────────────────────────────
// Max body rotation speed: ~270°/s. Prevents 180° whips on direction reversal.
const MAX_TURN_RATE_RAD_PER_SEC = (Math.PI * 270) / 180

interface PlayerPose {
  worldX: Spring1D
  worldZ: Spring1D
  angle: number            // current orientation (Y-axis, radians) — clamped not sprung
  angleVel: number         // not used for clamped path but kept for compat
  prevWx: number
  prevWz: number
  speed: number
  animTime: number
  // goalie butterfly timer
  butterflyTimer: number
  // scorer arms-up timer
  armsTimer: number
  // hit stagger timer
  staggerTimer: number
  // current PlayerId (snap detection)
  playerId: PlayerId | null
  mesh: THREE.Group
  jerseyNum: number
}

interface ActiveCue {
  cue: EventCue
  elapsed: number
}

// Goal-light flash object
interface GoalLight {
  light: THREE.PointLight
  timer: number
  side: 'left' | 'right'
}

export class Rink3dRenderer implements MatchRenderer {
  // ── THREE objects ──────────────────────────────────────────────────────────
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera

  // ── Playback state ─────────────────────────────────────────────────────────
  private timeline: MatchTimeline | null = null
  private clockPos = 0
  private playing = false
  private speed = 1
  private listener: ((v: MatchView) => void) | null = null

  // ── Colors ─────────────────────────────────────────────────────────────────
  private colors: RinkColors = { home: 0x4c9aff, away: 0xff6b6b }

  // ── Player meshes ──────────────────────────────────────────────────────────
  private homePoses: PlayerPose[] = []
  private awayPoses: PlayerPose[] = []
  private homeGoaliePose: PlayerPose | null = null
  private awayGoaliePose: PlayerPose | null = null

  // ── Puck ───────────────────────────────────────────────────────────────────
  private puckMesh!: THREE.Mesh
  private puckGlowRing!: THREE.Mesh
  // Smoothed puck render position (spring to actual puck or carrier-offset position)
  private puckRenderX: Spring1D = { pos: 0, vel: 0 }
  private puckRenderZ: Spring1D = { pos: 0, vel: 0 }

  // ── Goal lights ────────────────────────────────────────────────────────────
  private goalLights: GoalLight[] = []

  // ── Event cues ─────────────────────────────────────────────────────────────
  private cues: EventCue[] = []
  private lastEvaluatedClock = -1
  private activeCues: ActiveCue[] = []

  // ── Camera spring ──────────────────────────────────────────────────────────
  private camX: Spring1D = { pos: 0, vel: 0 }
  private camY: Spring1D = { pos: 40, vel: 0 }
  private camZ: Spring1D = { pos: -75, vel: 0 }
  private lookX: Spring1D = { pos: 0, vel: 0 }
  private lookY: Spring1D = { pos: 0, vel: 0 }
  private lookZ: Spring1D = { pos: 0, vel: 0 }
  private camPreset: CameraPreset = 'broadcast'

  // ── Endzone camera state ───────────────────────────────────────────────────
  // Which net end the endzone camera is currently behind (+1 = positive-X end, -1 = negative-X end)
  private endzoneActiveSide: 1 | -1 = -1

  // ── Wall clock for animation ───────────────────────────────────────────────
  private lastFrameTime = 0

  // ── Carrier tracking for follow camera ────────────────────────────────────
  private carrierAngle = 0
  private carrierWx = 0
  private carrierWz = 0

  private constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 1200)
    this.camera.position.set(0, 40, -75)
    this.camera.lookAt(0, 0, 0)
  }

  static async create(parent: HTMLElement, colors?: RinkColors): Promise<Rink3dRenderer> {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1

    const w = parent.clientWidth || 900
    const h = parent.clientHeight || Math.round(w / 2.35)
    renderer.setSize(w, h)
    parent.appendChild(renderer.domElement)

    const inst = new Rink3dRenderer(renderer)
    if (colors) inst.colors = colors

    inst.camera.aspect = w / h
    inst.camera.updateProjectionMatrix()

    inst.buildScene()
    renderer.setAnimationLoop((time) => inst.animLoop(time))
    return inst
  }

  // ── Scene construction ────────────────────────────────────────────────────

  private buildScene(): void {
    // Background / fog
    this.scene.background = new THREE.Color(0x080c12)
    this.scene.fog = new THREE.Fog(0x080c12, 150, 400)

    this.buildLighting()
    this.buildIce()
    this.buildBoards()
    this.buildNets()
    this.buildStands()
    this.buildPuck()

    // Skaters allocated lazily in load()
  }

  private buildLighting(): void {
    // Hemisphere (sky/ground)
    const hemi = new THREE.HemisphereLight(0xe8f0ff, 0x101830, 0.7)
    this.scene.add(hemi)

    // Key directional with ONE shadow map
    const key = new THREE.DirectionalLight(0xfff8f0, 1.2)
    key.position.set(30, 80, -30)
    key.castShadow = true
    key.shadow.mapSize.setScalar(1024)
    key.shadow.camera.left = -130
    key.shadow.camera.right = 130
    key.shadow.camera.top = 60
    key.shadow.camera.bottom = -60
    key.shadow.camera.near = 10
    key.shadow.camera.far = 250
    this.scene.add(key)

    // Fill
    const fill = new THREE.DirectionalLight(0xc0d8ff, 0.5)
    fill.position.set(-50, 30, 50)
    this.scene.add(fill)
  }

  private buildIce(): void {
    // Build ice canvas texture
    const canvas = buildIceCanvas()
    const tex = new THREE.CanvasTexture(canvas)
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy()

    const geo = new THREE.PlaneGeometry(RINK_W, RINK_D, 1, 1)
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.12,
      metalness: 0.0,
      envMapIntensity: 0.4,
    })
    const ice = new THREE.Mesh(geo, mat)
    ice.rotation.x = -Math.PI / 2
    ice.receiveShadow = true
    this.scene.add(ice)
  }

  private buildBoards(): void {
    // White board wall ring
    const boardMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.9 })
    const kickMat = new THREE.MeshStandardMaterial({ color: 0xf0c000, roughness: 0.8 })
    const capMat = new THREE.MeshStandardMaterial({ color: 0xd33b3b, roughness: 0.7 })
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xaac8e8,
      transparent: true,
      opacity: 0.18,
      roughness: 0.05,
      metalness: 0.1,
    })

    // Simplified as 4 wall segments (long sides + short ends)
    const segments: Array<{ w: number; d: number; x: number; z: number; ry: number }> = [
      // long boards (Z sides)
      { w: RINK_W, d: 1, x: 0, z: RINK_D / 2 + 0.5, ry: 0 },
      { w: RINK_W, d: 1, x: 0, z: -(RINK_D / 2 + 0.5), ry: 0 },
      // end boards (X sides)
      { w: 1, d: RINK_D, x: RINK_W / 2 + 0.5, z: 0, ry: 0 },
      { w: 1, d: RINK_D, x: -(RINK_W / 2 + 0.5), z: 0, ry: 0 },
    ]

    for (const seg of segments) {
      // Kickplate (bottom 0.8ft, yellow)
      const kick = new THREE.Mesh(new THREE.BoxGeometry(seg.w, 0.8, seg.d), kickMat)
      kick.position.set(seg.x, 0.4, seg.z)
      kick.rotation.y = seg.ry
      this.scene.add(kick)

      // Board body
      const board = new THREE.Mesh(new THREE.BoxGeometry(seg.w, BOARD_H - 0.8, seg.d), boardMat)
      board.position.set(seg.x, 0.8 + (BOARD_H - 0.8) / 2, seg.z)
      board.rotation.y = seg.ry
      board.receiveShadow = true
      this.scene.add(board)

      // Red cap strip
      const cap = new THREE.Mesh(new THREE.BoxGeometry(seg.w, 0.15, seg.d + 0.2), capMat)
      cap.position.set(seg.x, BOARD_H + 0.075, seg.z)
      cap.rotation.y = seg.ry
      this.scene.add(cap)

      // Glass above boards (taller behind goals ±89ft)
      const behind = Math.abs(seg.x) > 85
      const glassH = behind ? 10 : GLASS_H
      const glass = new THREE.Mesh(new THREE.BoxGeometry(seg.w, glassH, seg.d), glassMat)
      glass.position.set(seg.x, BOARD_H + glassH / 2, seg.z)
      glass.rotation.y = seg.ry
      this.scene.add(glass)
    }
  }

  private buildNets(): void {
    const postMat = new THREE.MeshStandardMaterial({ color: 0xee2222, roughness: 0.6, metalness: 0.3 })
    const netMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      roughness: 0.9,
      side: THREE.DoubleSide,
    })

    for (const sign of [-1, 1] as const) {
      const gx = sign * NET_X
      const group = new THREE.Group()
      group.position.set(gx, 0, 0)

      // Back-board of net faces center (sign < 0 → right side faces positive X)
      const facing = sign < 0 ? 1 : -1

      // Posts: left + right uprights
      for (const zOff of [-NET_W / 2, NET_W / 2]) {
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1, 0.1, NET_H, 8),
          postMat
        )
        post.position.set(0, NET_H / 2, zOff)
        group.add(post)
      }

      // Crossbar
      const crossbar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, NET_W + 0.2, 8),
        postMat
      )
      crossbar.rotation.z = Math.PI / 2
      crossbar.rotation.y = Math.PI / 2
      crossbar.position.set(0, NET_H, 0)
      group.add(crossbar)

      // Net back wall (semi-transparent)
      const backWall = new THREE.Mesh(
        new THREE.PlaneGeometry(NET_W, NET_H),
        netMat
      )
      backWall.position.set(facing * NET_D, NET_H / 2, 0)
      backWall.rotation.y = sign < 0 ? 0 : Math.PI
      group.add(backWall)

      // Net top
      const topNet = new THREE.Mesh(new THREE.PlaneGeometry(NET_D, NET_W), netMat)
      topNet.rotation.x = Math.PI / 2
      topNet.rotation.z = Math.PI / 2
      topNet.position.set((facing * NET_D) / 2, NET_H, 0)
      group.add(topNet)

      // Net side panels
      for (const zOff of [-NET_W / 2, NET_W / 2]) {
        const sideNet = new THREE.Mesh(new THREE.PlaneGeometry(NET_D, NET_H), netMat)
        sideNet.rotation.y = Math.PI / 2
        sideNet.position.set((facing * NET_D) / 2, NET_H / 2, zOff)
        group.add(sideNet)
      }

      this.scene.add(group)
    }
  }

  private buildStands(): void {
    // Dark tiered stands — simple boxes around the perimeter so the rink doesn't float
    const standMat = new THREE.MeshStandardMaterial({ color: 0x101820, roughness: 1.0 })
    const tiers = 4
    for (let t = 0; t < tiers; t++) {
      const offset = 10 + t * 12
      const rise = BOARD_H + t * 6
      const depth = 12
      // Long sides
      for (const zSign of [-1, 1] as const) {
        const stand = new THREE.Mesh(
          new THREE.BoxGeometry(RINK_W + offset * 2, 3, depth),
          standMat
        )
        stand.position.set(0, rise, zSign * (RINK_D / 2 + offset + depth / 2))
        this.scene.add(stand)
      }
      // End sides
      for (const xSign of [-1, 1] as const) {
        const stand = new THREE.Mesh(
          new THREE.BoxGeometry(depth, 3, RINK_D + offset * 2),
          standMat
        )
        stand.position.set(xSign * (RINK_W / 2 + offset + depth / 2), rise, 0)
        this.scene.add(stand)
      }
    }
    // Ceiling / arena structure (just a very dark plane above)
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 400),
      new THREE.MeshStandardMaterial({ color: 0x050810, roughness: 1 })
    )
    ceiling.rotation.x = Math.PI / 2
    ceiling.position.set(0, 80, 0)
    this.scene.add(ceiling)
  }

  private buildPuck(): void {
    const puckGeo = new THREE.CylinderGeometry(PUCK_R, PUCK_R, PUCK_H, 16)
    const puckMat = new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.8, metalness: 0.1 })
    this.puckMesh = new THREE.Mesh(puckGeo, puckMat)
    this.puckMesh.castShadow = true
    this.scene.add(this.puckMesh)

    // Carrier glow ring (torus flat on ice)
    const ringGeo = new THREE.TorusGeometry(PUCK_R + 0.6, 0.12, 8, 32)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.85 })
    this.puckGlowRing = new THREE.Mesh(ringGeo, ringMat)
    this.puckGlowRing.rotation.x = Math.PI / 2
    this.puckGlowRing.visible = false
    this.scene.add(this.puckGlowRing)
  }

  // ── Player mesh factory ───────────────────────────────────────────────────

  private makePlayerMesh(color: number, isGoalie: boolean): THREE.Group {
    const group = new THREE.Group()

    const jerseyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 })
    const pantsMat = new THREE.MeshStandardMaterial({ color: Math.round(color * 0.35) | 0x0a0a0a, roughness: 0.9 })
    const helmetMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.6, metalness: 0.2 })
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 })
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.8 })
    const stickMat = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.9 })

    const tW = isGoalie ? GOALIE_TORSO_W : TORSO_W

    // Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(tW, TORSO_H, tW * 0.7), jerseyMat)
    torso.position.y = LEG_H + TORSO_H / 2
    torso.castShadow = true
    group.add(torso)

    // Legs (two boxes side-by-side)
    for (const side of [-1, 1] as const) {
      const legMat = isGoalie ? whiteMat : pantsMat
      const leg = new THREE.Mesh(new THREE.BoxGeometry(LEG_W, LEG_H, LEG_W), legMat)
      leg.position.set(side * LEG_W * 0.6, LEG_H / 2, 0)
      leg.castShadow = true
      group.add(leg)
    }

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 8, 8), helmetMat)
    head.position.y = LEG_H + TORSO_H + HEAD_R * 0.9
    head.castShadow = true
    group.add(head)

    if (isGoalie) {
      // Blocker (right arm, boxy)
      const blocker = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 1.4), jerseyMat)
      blocker.position.set(tW * 0.6, LEG_H + TORSO_H * 0.5, 0.4)
      group.add(blocker)
      // Glove (left arm, smaller)
      const glove = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), blackMat)
      glove.position.set(-(tW * 0.6), LEG_H + TORSO_H * 0.7, 0)
      group.add(glove)
      // Goalie mask (extra half-sphere in front of head)
      const mask = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R + 0.12, 8, 6, 0, Math.PI), whiteMat)
      mask.rotation.y = Math.PI / 2
      mask.position.y = LEG_H + TORSO_H + HEAD_R * 0.9
      mask.position.z = 0.1
      group.add(mask)
    } else {
      // Stick
      const stick = new THREE.Group()
      // shaft
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, STICK_L * 0.8, 6), stickMat)
      shaft.position.set(0, STICK_L * 0.3, 0)
      shaft.rotation.z = 0.18 // slight lean
      stick.add(shaft)
      // blade
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 1.6), blackMat)
      blade.position.set(0, 0.3, 0.8)
      stick.add(blade)
      stick.position.set(tW * 0.6, LEG_H, 0.4)
      group.add(stick)
    }

    // Skate hints (thin dark boxes at foot level)
    for (const side of [-1, 1] as const) {
      const skate = new THREE.Mesh(new THREE.BoxGeometry(LEG_W * 0.8, 0.25, LEG_W * 1.8), blackMat)
      skate.position.set(side * LEG_W * 0.6, 0.125, 0.3)
      group.add(skate)
    }

    return group
  }

  /** Build a jersey-number canvas texture (back decal). */
  private makeJerseyNumberTexture(num: number, color: number): THREE.CanvasTexture {
    const c = document.createElement('canvas')
    c.width = 128
    c.height = 128
    const ctx = c.getContext('2d')!
    const hex = `#${color.toString(16).padStart(6, '0')}`
    ctx.fillStyle = hex
    ctx.fillRect(0, 0, 128, 128)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 72px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(num), 64, 64)
    return new THREE.CanvasTexture(c)
  }

  private makePose(
    color: number,
    isGoalie: boolean,
    playerId: PlayerId | null,
    startWx: number,
    startWz: number
  ): PlayerPose {
    const mesh = this.makePlayerMesh(color, isGoalie)
    const num = playerId ? jerseyNumber(playerId) : 99

    // Add number texture as a decal on the torso back (MeshBasicMaterial plane)
    const numTex = this.makeJerseyNumberTexture(num, color)
    const numPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(TORSO_W * 0.6, TORSO_H * 0.4),
      new THREE.MeshBasicMaterial({ map: numTex, transparent: true })
    )
    numPlane.position.set(0, LEG_H + TORSO_H * 0.6, -(TORSO_W * 0.36))
    mesh.add(numPlane)

    mesh.position.set(startWx, 0, startWz)
    this.scene.add(mesh)

    return {
      worldX: { pos: startWx, vel: 0 },
      worldZ: { pos: startWz, vel: 0 },
      angle: 0,
      angleVel: 0,
      prevWx: startWx,
      prevWz: startWz,
      speed: 0,
      animTime: 0,
      butterflyTimer: 0,
      armsTimer: 0,
      staggerTimer: 0,
      playerId,
      mesh,
      jerseyNum: num,
    }
  }

  // ── MatchRenderer interface ───────────────────────────────────────────────

  load(timeline: MatchTimeline, colors?: RinkColors): void {
    if (colors) this.colors = colors
    this.timeline = timeline
    this.clockPos = 0
    this.playing = false
    this.lastEvaluatedClock = -1
    this.activeCues = []

    // Remove old player meshes
    this.disposePoses()

    // Allocate 6 home skaters + 1 goalie
    for (let i = 0; i < 6; i++) {
      this.homePoses.push(this.makePose(this.colors.home, false, null, 0, (i - 2.5) * 8))
      this.awayPoses.push(this.makePose(this.colors.away, false, null, 0, (i - 2.5) * 8))
    }
    this.homeGoaliePose = this.makePose(this.colors.home, true, null, -NET_X, 0)
    this.awayGoaliePose = this.makePose(this.colors.away, true, null, NET_X, 0)

    // Goal lights (hidden until triggered)
    for (const glData of this.goalLights) this.scene.remove(glData.light)
    this.goalLights = []
    for (const side of ['left', 'right'] as const) {
      const light = new THREE.PointLight(0xff2222, 0, 30)
      light.position.set(side === 'left' ? -NET_X : NET_X, 6, 0)
      this.scene.add(light)
      this.goalLights.push({ light, timer: 0, side })
    }

    this.renderAt(0)
    this.emit()
  }

  private disposePoses(): void {
    const all = [
      ...this.homePoses,
      ...this.awayPoses,
      ...(this.homeGoaliePose ? [this.homeGoaliePose] : []),
      ...(this.awayGoaliePose ? [this.awayGoaliePose] : []),
    ]
    for (const p of all) {
      this.scene.remove(p.mesh)
      p.mesh.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose())
          } else {
            obj.material.dispose()
          }
        }
      })
    }
    this.homePoses = []
    this.awayPoses = []
    this.homeGoaliePose = null
    this.awayGoaliePose = null
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

    // Render once to get new positions, then snap all springs to those positions
    this.renderAt(this.clockPos)
    this.snapAllSprings()
    this.emit()
  }

  /**
   * Hard-snap all position/rotation springs to their current mesh positions.
   * Called after seek and after camera-mode switch.
   */
  private snapAllSprings(): void {
    // Snap player pose springs
    const allPoses = [
      ...this.homePoses,
      ...this.awayPoses,
      ...(this.homeGoaliePose ? [this.homeGoaliePose] : []),
      ...(this.awayGoaliePose ? [this.awayGoaliePose] : []),
    ]
    for (const p of allPoses) {
      p.worldX = snapSpring(p.mesh.position.x)
      p.worldZ = snapSpring(p.mesh.position.z)
      // angle is already set directly by renderAt
    }

    // Snap puck render springs
    this.puckRenderX = snapSpring(this.puckMesh.position.x)
    this.puckRenderZ = snapSpring(this.puckMesh.position.z)
  }

  resize(): void {
    const canvas = this.renderer.domElement
    const parent = canvas.parentElement
    if (!parent) return
    const w = parent.clientWidth || 900
    const h = parent.clientHeight || Math.round(w / 2.35)
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  destroy(): void {
    this.renderer.setAnimationLoop(null)
    this.disposePoses()
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose())
        } else {
          obj.material.dispose()
        }
      }
    })
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

    // Update endzone side based on current puck position before snapping
    const puckWx = this.puckMesh.position.x
    this.endzoneActiveSide = endzoneChooseEnd(this.endzoneActiveSide, puckWx)

    const target = cameraTargetFor(preset, puckWx, {
      endzoneActiveSide: this.endzoneActiveSide,
      carrierAngle: this.carrierAngle,
      carrierWx: this.carrierWx,
      carrierWz: this.carrierWz,
    })

    // Hard-snap all six springs — zero velocity, position at the target
    this.camX = snapSpring(target.px)
    this.camY = snapSpring(target.py)
    this.camZ = snapSpring(target.pz)
    this.lookX = snapSpring(target.lx)
    this.lookY = snapSpring(target.ly)
    this.lookZ = snapSpring(target.lz)

    // Apply immediately so the first rendered frame is correct
    this.camera.position.set(target.px, target.py, target.pz)
    this.camera.lookAt(target.lx, target.ly, target.lz)
  }

  // ── Animation loop ────────────────────────────────────────────────────────

  private animLoop(time: number): void {
    const dtMs = this.lastFrameTime === 0 ? 16 : time - this.lastFrameTime
    this.lastFrameTime = time
    const dt = Math.min(dtMs / 1000, 0.1) // cap at 100ms to avoid spiral-of-death

    if (this.playing && this.timeline) {
      this.clockPos += dt * this.speed
      if (this.clockPos >= this.timeline.duration) {
        this.clockPos = this.timeline.duration
        this.playing = false
      }
    }

    this.renderAt(this.clockPos, dt)
    this.updateCues(this.clockPos, dt)
    this.updateCamera(dt)
    this.emit()
    this.renderer.render(this.scene, this.camera)
  }

  // ── Render frame ──────────────────────────────────────────────────────────

  private renderAt(absT: number, dt = 0): void {
    const tl = this.timeline
    if (!tl) return
    const snap = tl.sampleAt(absT)
    if (!snap) return

    // Determine carrier pose for puck offset
    let carrierPose: PlayerPose | null = null
    if (snap.carrier !== null) {
      const all = [...this.homePoses, ...this.awayPoses,
        ...(this.homeGoaliePose ? [this.homeGoaliePose] : []),
        ...(this.awayGoaliePose ? [this.awayGoaliePose] : [])]
      carrierPose = all.find((p) => p.playerId === snap.carrier) ?? null
    }

    // Home skaters
    for (let i = 0; i < snap.home.length && i < this.homePoses.length; i++) {
      this.homePoses[i].mesh.visible = true
      this.updatePose(this.homePoses[i], snap.home[i]?.x ?? 0, snap.home[i]?.y ?? 0, dt)
    }
    // Hide extras
    for (let i = snap.home.length; i < this.homePoses.length; i++) {
      this.homePoses[i].mesh.visible = false
    }

    // Away skaters
    for (let i = 0; i < snap.away.length && i < this.awayPoses.length; i++) {
      this.awayPoses[i].mesh.visible = true
      this.updatePose(this.awayPoses[i], snap.away[i]?.x ?? 0, snap.away[i]?.y ?? 0, dt)
    }
    for (let i = snap.away.length; i < this.awayPoses.length; i++) {
      this.awayPoses[i].mesh.visible = false
    }

    // Goalies
    if (this.homeGoaliePose) {
      this.updateGoaliePose(this.homeGoaliePose, snap.homeGoalie.x, snap.homeGoalie.y, snap.puck, dt)
    }
    if (this.awayGoaliePose) {
      this.updateGoaliePose(this.awayGoaliePose, snap.awayGoalie.x, snap.awayGoalie.y, snap.puck, dt)
    }

    // Puck position: if carried, offset to stick-blade side of carrier
    let pTargetX: number
    let pTargetZ: number
    if (carrierPose !== null) {
      const offset = puckCarriedOffset(carrierPose.angle)
      pTargetX = carrierPose.worldX.pos + offset.dx
      pTargetZ = carrierPose.worldZ.pos + offset.dz
      // Track carrier for follow camera
      this.carrierAngle = carrierPose.angle
      this.carrierWx = carrierPose.worldX.pos
      this.carrierWz = carrierPose.worldZ.pos
    } else {
      pTargetX = normXtoWorld(snap.puck.x)
      pTargetZ = normYtoWorld(snap.puck.y)
      // When loose, update carrier tracking to puck position
      this.carrierWx = pTargetX
      this.carrierWz = pTargetZ
    }

    // Smooth puck position with a tight spring (not teleport-snappy but responsive)
    if (dt > 0) {
      this.puckRenderX = springStep(this.puckRenderX, pTargetX, dt, PLAYER_FOLLOW_HL)
      this.puckRenderZ = springStep(this.puckRenderZ, pTargetZ, dt, PLAYER_FOLLOW_HL)
    } else {
      // dt=0 means a seek — snap directly
      this.puckRenderX = snapSpring(pTargetX)
      this.puckRenderZ = snapSpring(pTargetZ)
    }

    this.puckMesh.position.set(this.puckRenderX.pos, PUCK_H / 2, this.puckRenderZ.pos)
    this.puckGlowRing.position.set(this.puckRenderX.pos, PUCK_H + 0.05, this.puckRenderZ.pos)
    this.puckGlowRing.visible = snap.carrier !== null
  }

  private updatePose(pose: PlayerPose, nx: number, ny: number, dt: number): void {
    const wx = normXtoWorld(nx)
    const wz = normYtoWorld(ny)

    pose.worldX = springStep(pose.worldX, wx, dt, PLAYER_FOLLOW_HL)
    pose.worldZ = springStep(pose.worldZ, wz, dt, PLAYER_FOLLOW_HL)

    // Velocity-based speed
    const vx = pose.worldX.pos - pose.prevWx
    const vz = pose.worldZ.pos - pose.prevWz
    const distSq = vx * vx + vz * vz
    const speedFt = dt > 0 ? Math.sqrt(distSq) / dt : 0
    pose.speed = Math.min(1, speedFt / 20) // normalize to 0..1 (20 ft/s ≈ full speed)
    pose.prevWx = pose.worldX.pos
    pose.prevWz = pose.worldZ.pos

    // Orientation toward velocity — clamped turn rate to prevent body whips
    if (distSq > 0.001 && dt > 0) {
      const targetAngle = Math.atan2(vx, vz)
      pose.angle = clampTurnRate(pose.angle, targetAngle, dt, MAX_TURN_RATE_RAD_PER_SEC)
    }

    pose.animTime += dt

    // Stagger animation
    const staggerOffset = pose.staggerTimer > 0 ? Math.sin(pose.animTime * 30) * 0.4 : 0
    pose.staggerTimer = Math.max(0, pose.staggerTimer - dt)

    // Arms-up animation
    const armsUp = pose.armsTimer > 0
    pose.armsTimer = Math.max(0, pose.armsTimer - dt)

    // Bob only when actually moving (speed > 0 check in skaterBob)
    const bob = skaterBob(pose.animTime, pose.speed)
    pose.mesh.position.set(pose.worldX.pos + staggerOffset, bob, pose.worldZ.pos)
    pose.mesh.rotation.y = pose.angle

    // Leg swing (apply to leg children index 1,2)
    const legAngle = legSwingAngle(pose.animTime, pose.speed)
    const children = pose.mesh.children
    if (children[1]) children[1].rotation.x = legAngle
    if (children[2]) children[2].rotation.x = -legAngle

    // Arms up: tilt torso back
    if (children[0]) children[0].rotation.x = armsUp ? -0.5 : 0
  }

  private updateGoaliePose(
    pose: PlayerPose,
    nx: number,
    ny: number,
    puck: { x: number; y: number },
    dt: number
  ): void {
    const wx = normXtoWorld(nx)
    const wz = normYtoWorld(ny)
    pose.worldX = springStep(pose.worldX, wx, dt, PLAYER_FOLLOW_HL)
    pose.worldZ = springStep(pose.worldZ, wz, dt, PLAYER_FOLLOW_HL)

    // Face puck — clamped turn rate (goalies can turn faster than skaters)
    const pWx = normXtoWorld(puck.x)
    const pWz = normYtoWorld(puck.y)
    const dx = pWx - pose.worldX.pos
    const dz = pWz - pose.worldZ.pos
    if (dx * dx + dz * dz > 0.1 && dt > 0) {
      const targetAngle = Math.atan2(dx, dz)
      pose.angle = clampTurnRate(pose.angle, targetAngle, dt, MAX_TURN_RATE_RAD_PER_SEC * 1.5)
    }

    pose.animTime += dt
    const butterfly = pose.butterflyTimer > 0
    pose.butterflyTimer = Math.max(0, pose.butterflyTimer - dt)

    pose.mesh.position.set(pose.worldX.pos, butterfly ? -0.4 : 0, pose.worldZ.pos)
    pose.mesh.rotation.y = pose.angle
    pose.mesh.rotation.z = butterfly ? 0.3 : 0
  }

  // ── Event cues ────────────────────────────────────────────────────────────

  private updateCues(absT: number, dt: number): void {
    // Trigger new cues that just crossed the playback position
    if (absT > this.lastEvaluatedClock) {
      for (const cue of this.cues) {
        if (cue.absT > this.lastEvaluatedClock && cue.absT <= absT) {
          this.activateCue(cue)
        }
      }
    }
    this.lastEvaluatedClock = absT

    // Update active cues
    this.activeCues = this.activeCues.filter((ac) => {
      ac.elapsed += dt
      this.tickActiveCue(ac)
      return ac.elapsed < this.cueLifetime(ac.cue.kind)
    })

    // Goal lights
    for (const gl of this.goalLights) {
      if (gl.timer > 0) {
        gl.timer -= dt
        gl.light.intensity = Math.max(0, gl.timer / 2) * 8
      } else {
        gl.light.intensity = 0
      }
    }
  }

  private cueLifetime(kind: string): number {
    switch (kind) {
      case 'goal': return 2.5
      case 'save': return 0.6
      case 'hit': return 0.4
      default: return 0.3
    }
  }

  private activateCue(cue: EventCue): void {
    this.activeCues.push({ cue, elapsed: 0 })

    if (cue.kind === 'goal') {
      // Flash the goal light for the net that was scored on
      // cue.nx < 0 → left net (away goalie end), nx > 0 → right net (home goalie end)
      const side = cue.nx < 0 ? 'left' : 'right'
      const gl = this.goalLights.find((g) => g.side === side)
      if (gl) gl.timer = 2.5

      // Find scorer pose and set arms-up
      this.setPoseEffect(cue.actorId, 'arms', 2.0)
    } else if (cue.kind === 'save') {
      // Butterfly the goalie
      this.setGoalieEffect(cue.actorId, 0.5)
    } else if (cue.kind === 'hit') {
      // Stagger both participants
      this.setPoseEffect(cue.actorId, 'stagger', 0.4)
    }
  }

  private tickActiveCue(_ac: ActiveCue): void {
    // Most effects are timer-driven in the poses themselves
  }

  private setPoseEffect(actorId: string, kind: 'arms' | 'stagger', duration: number): void {
    const all = [...this.homePoses, ...this.awayPoses]
    for (const p of all) {
      if (p.playerId === actorId) {
        if (kind === 'arms') p.armsTimer = duration
        else p.staggerTimer = duration
        return
      }
    }
  }

  private setGoalieEffect(actorId: string, duration: number): void {
    for (const p of [this.homeGoaliePose, this.awayGoaliePose]) {
      if (p && p.playerId === actorId) {
        p.butterflyTimer = duration
        return
      }
    }
    // Fallback: trigger on the nearest goalie to the cue position
    if (this.homeGoaliePose) this.homeGoaliePose.butterflyTimer = duration
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  private updateCamera(dt: number): void {
    const puckWx = this.puckRenderX.pos  // use smoothed puck position

    // Update endzone active side with hysteresis (only flips outside ±15ft of center)
    this.endzoneActiveSide = endzoneChooseEnd(this.endzoneActiveSide, puckWx)

    const target = cameraTargetFor(this.camPreset, puckWx, {
      endzoneActiveSide: this.endzoneActiveSide,
      carrierAngle: this.carrierAngle,
      carrierWx: this.carrierWx,
      carrierWz: this.carrierWz,
    })

    // Overhead uses heavier damping on X so it doesn't slide around too much
    const hl = this.camPreset === 'overhead' ? CAMERA_OVERHEAD_HL : CAMERA_FOLLOW_HL

    this.camX = springStep(this.camX, target.px, dt, hl)
    this.camY = springStep(this.camY, target.py, dt, CAMERA_FOLLOW_HL)
    this.camZ = springStep(this.camZ, target.pz, dt, CAMERA_FOLLOW_HL)
    this.lookX = springStep(this.lookX, target.lx, dt, hl)
    this.lookY = springStep(this.lookY, target.ly, dt, CAMERA_FOLLOW_HL)
    this.lookZ = springStep(this.lookZ, target.lz, dt, CAMERA_FOLLOW_HL)

    this.camera.position.set(this.camX.pos, this.camY.pos, this.camZ.pos)
    this.camera.lookAt(this.lookX.pos, this.lookY.pos, this.lookZ.pos)
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
