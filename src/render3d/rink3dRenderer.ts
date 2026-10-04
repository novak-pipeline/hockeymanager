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
import { absTime, type MatchTimeline, type PosSnapshot } from '@render2d/timeline'
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
  puckTrackStep,
  capLookYaw,
  broadcastFraming,
  followHeadingStep,
  type FollowHeading,
  type PuckTrack,
  softDeadzone,
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
import { AthleteBatch, AthleteRig, athleteMaterial, type PoseOverlay } from './athlete'
import type { ProbeGeometry, ProbeRig, ProbeSink } from './viewerProbe'
import { loadAthleteAssets, loadOwnerAssets, mergeClips, type AthleteAssets, type OwnerAssets, type OwnerTextures } from './gltfAthlete'
import { AtlasUploader, type Rect } from './atlasUpload'
import { OwnerKitPainter, buildOwnerAtlasCanvas, clothesMaterial, gearMaterial, loadTexture, visorMaterial } from './ownerKit'

/** A player's slot in a jersey atlas (canvas px, top-left origin). */
function slotRect(atlas: HTMLCanvasElement, slot: number): Rect {
  const S = atlas.width / ATLAS_GRID
  return { x: (slot % ATLAS_GRID) * S, y: Math.floor(slot / ATLAS_GRID) * S, w: S, h: S }
}

interface OwnerRoleTex {
  clothesN: THREE.Texture
  gearD: THREE.Texture
  gearN: THREE.Texture
}
import { ActionLayer } from './animLayer'
import { Choreographer, extractActionCues, FACEOFF_LEAD_S, type LocoMode } from './choreo'
import { kitFor, type Kit } from './palette'
import { ATLAS_GRID, buildAtlasCanvas, paintJerseySlot, paintOfficialSlot } from './textures'
import { RINK_HALF_W } from './iceCanvas'
import { approach, assignRigs, capStep, type RigMode } from './lineChange'
import { layoutLabels, type LabelRequest, type PlacedLabel } from '@render2d/labelLayout'
import { MOMENT_CHOREOGRAPHY, type MomentCue, type ShotCue } from '@render2d/broadcast/types'

// ── Name labels (screen space, E1 / F-18) ──────────────────────────────────
// Only the carrier and the players near the puck get a name — like FM — at a
// constant readable pixel size, de-conflicted so they never overlap.
const LABEL_NEAR_FT = 24
const LABEL_GOALIE_NEAR_FT = 28
const LABEL_MAX = 5

/** Bench gates on the far boards (home bench at x = -26, away at +26, matching arena.ts). */
/** Bench doors — the agent engine's own (agentSim BENCH_GATE: x ∓22 on the far boards). */
const BENCH_GATE = { home: { x: -22, z: RINK_HALF_W - 1.5 }, away: { x: 22, z: RINK_HALF_W - 1.5 } } as const
/** The bench floor behind the boards, where a changing man hops to / from. */
const BENCH_Z = RINK_HALF_W + 3
/** A change within this far of the door is drawn through it; farther, the sim moved him (seek, stoppage). */
const DOOR_NEAR_FT = 12
/** Skating through the hop over the boards (ft/s) and how high the root rises. */
const HOP_SPEED = 16
const HOP_RISE_FT = 2.2
/** Standing spots along each bench (arena.ts: 30 ft benches centred on the gates). */

/**
 * Athlete source: 'owner' = the owner-supplied rigged athletes imported by
 * `npm run import:owner-assets` (git-ignored; see gltfAthlete loadOwnerAssets),
 * with the Blender clips filling every action they lack; 'blender' = the rigged
 * glTF bodies + authored clips built by scripts/blender; 'procedural' =
 * athlete.ts's code-built bodies; 'auto' = owner if built locally, else
 * blender (each falls back to the next if loading fails). Locomotion: 'code' =
 * the integrated procedural stride, 'clip' = the authored cycles phase-locked
 * to the sim, 'hybrid' = code stride + authored crossovers / backward skating.
 * Owner athletes default to 'clip' (their own skating cycles).
 */
export interface Render3dOptions {
  athletes?: 'auto' | 'owner' | 'blender' | 'procedural'
  locomotion?: LocoMode
}
// Bake-off verdict (docs/graphics/BLENDER-PIPELINE.md): the Blender body wins;
// the code stride stays (locked to sim speed), authored cycles add crossovers +
// backward skating, authored actions ride on top. Procedural is the fallback.
export const RENDER3D_DEFAULTS: Required<Render3dOptions> = { athletes: 'auto', locomotion: 'hybrid' }

// Near regulation (3" across, 1" thick) — a touch big so it reads; the halo does the rest at distance.
const PUCK_R = 0.14
const PUCK_H = 0.09

// ── Spring half-lives ───────────────────────────────────────────────────────
const PLAYER_FOLLOW_HL = 0.08

// ── Camera follow tuning (calm broadcast) ───────────────────────────────────
// Pipeline: puck → soft dead-band → slow EMA → focus speed limit → critically
// damped spring. The broadcast shot is deliberately slow and heavy, like a
// real operator on a fluid head; the tighter presets stay more responsive.
const CAMERA_TUNING: Record<CameraPreset, { tauX: number; tauZ: number; maxFocusSpeed: number; springHL: number }> = {
  // tighter zone framing (D3) needs a little less lag than the old wide shot
  broadcast: { tauX: 0.4, tauZ: 1.0, maxFocusSpeed: 60, springHL: 0.45 },
  overhead: { tauX: 1.2, tauZ: 1.2, maxFocusSpeed: 30, springHL: 1.5 },
  endzone: { tauX: 0.6, tauZ: 0.6, maxFocusSpeed: 80, springHL: 0.5 },
  follow: { tauX: 0.45, tauZ: 0.45, maxFocusSpeed: 90, springHL: 0.45 },
}

// Hard cap on how fast each preset's view may yaw (rad/s). The follow cam
// peaked at 3,856°/s before (audit D1); a TV operator pans ≲ 30–60°/s.
const MAX_CAM_YAW_RATE: Record<CameraPreset, number> = {
  broadcast: (30 * Math.PI) / 180,
  overhead: Infinity,
  endzone: (60 * Math.PI) / 180,
  follow: (60 * Math.PI) / 180,
}

// Soft dead-band around the focus: puck motion inside it never moves the shot.
const PLAY_FOCUS_DEADZONE_X = 6.0   // ft on the long axis
const PLAY_FOCUS_DEADZONE_Z = 5.0   // ft on the width axis

// ── Orientation turn-rate clamp ─────────────────────────────────────────────
// Max body rotation speed: ~200°/s. Prevents whips on direction reversal and the
// twitch that the sim's constant micro-steering caused at 270°/s.
const MAX_TURN_RATE_RAD_PER_SEC = (Math.PI * 200) / 180
// Facing follows a SMOOTHED direction of travel, not the per-frame velocity.
const FACING_VEL_TAU = 0.3
// Action clips that are really locomotion: the stick stays on the ice through them (groundStick).
const GROUNDED_CLIPS = new Set(['hockey_stop', 'skate_start', 'stickhandle'])

const smoothstep01 = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

// ── Movement limits ─────────────────────────────────────────────────────────
// Nothing on the ice moves faster than an elite skater: a residual teleport in
// the stream (faceoff resets, a stoppage) becomes a skate, never a snap.
const MAX_RENDER_SPEED = 40   // ft/s
const DEPART_SPEED = 30       // heading off to the bench
const DEPART_TIMEOUT_S = 2.2  // a departing player is off the ice by this (a change is quick)
// Rigs per team: up to 6 skaters on the ice + 6 skating off during a full change.
const SKATER_RIGS_PER_TEAM = 12
// Body yaw eases toward its target on a critically damped spring (no chasing a
// wobbling target at the max turn rate), then the rate clamp still applies.
const FACING_HL = 0.16

// ── Animation smoothing ─────────────────────────────────────────────────────
const SPEED_TAU = 0.18        // stride-amplitude smoothing (s) — no leg flicker
const TURN_TAU = 0.25         // bank-into-turn smoothing (s)
const SHOT_SWING_S = 0.32     // stick swing duration on a shot cue
const GOAL_CUE_S = 4.2        // lifetime of the goal cue (celebration cam)
/** Post-goal sequence timing (s of game time from the goal). */
export const GOAL_SEQ = { celly: 1.1, bench: 4.6, crowd: 6.4, back: 8.0, end: 8.0 } as const
type GoalPhase = 'hold' | 'celly' | 'bench' | 'crowd' | 'done'
function goalPhaseAt(t: number): GoalPhase {
  return t < GOAL_SEQ.celly ? 'hold' : t < GOAL_SEQ.bench ? 'celly' : t < GOAL_SEQ.crowd ? 'bench' : t < GOAL_SEQ.back ? 'crowd' : 'done'
}

// Atlas cells (6×6): home rigs 0-11 + G 12, away rigs 13-24 + G 25, 26-35 spare
// — same-team neighbours, so mip bleed between cells rarely mixes teams.
const HOME_G_SLOT = 12
const AWAY_G_SLOT = 25
// the linesman: a spare atlas cell, white / black stripes, black breezers + socks
const OFFICIAL_SLOT = 26
const OFFICIAL_KIT: Kit = { jersey: 0xf2f2ee, trim: 0x121212, trim2: 0x121212, number: 0x121212, numberOutline: 0xf2f2ee, pants: 0x121212, helmet: 0x121212, gloves: 0x121212, socks: 0x121212 }
/** He waits along the far boards (the benches are on +Z). */
const LINESMAN_BOARDS_Z = 38

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
  /** Line-change state: 'play' follows the sim; 'arriving'/'departing' skate to/from the bench gate. */
  mode: RigMode
  departT: number          // seconds spent skating off (departing only)
  departSeq: number        // when he started departing (oldest is reused first)
  velSmX: number           // smoothed velocity (ft/s) — drives facing
  velSmZ: number
  angVel: number           // body-yaw spring velocity (rad/s)
  rig: AthleteRig
  team: 'home' | 'away'
  /** Name label ("59 Garrity"), drawn in SCREEN space by drawLabels(); null = none. */
  labelText: string | null
  /** False while he skates off to the bench (no label for a departing player). */
  labelOn: boolean
  /** Label anchor height (ft) above the ice — just over the helmet. */
  labelY: number
  // authored-clip state (Blender athletes; see choreo.ts)
  vx: number
  vz: number
  layer: ActionLayer | null
  overlay: PoseOverlay | null
  faceOverride: { angle: number; until: number } | null
  followHL: number
  lastSpeedFt: number
  stopCooldown: number
  stopAccum: number
  stopFrom: number
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
  /** Ring on the ice under the puck carrier's skates (FM-style ball-carrier mark). */
  private carrierRing!: THREE.Mesh
  private carrierMarkPose: PlayerPose | null = null
  private labelCanvas!: HTMLCanvasElement
  /** The labels placed last frame (CSS px) — read by the dev probes. */
  labelRects: PlacedLabel[] = []
  private puck: PuckTrack = { x: 0, z: 0, cx: 0, cz: 0, key: '' }

  // ── Goal lights ────────────────────────────────────────────────────────────
  private goalLights: GoalLight[] = []

  // ── Event cues ─────────────────────────────────────────────────────────────
  private cues: EventCue[] = []
  private lastEvaluatedClock = -1
  private activeCues: ActiveCue[] = []
  private sinceGoal = Infinity
  private celebration: { elapsed: number; x: number; z: number } | null = null
  /**
   * The post-goal TV sequence (broadcast camera, when no director shot is
   * running): hold on the goal → cut to the scorer's celebration → the
   * scoring bench → the crowd → cut back to the game. Every change is a CUT.
   */
  private deadTimes: Array<{ from: number; to: number; x: number; z: number }> = []
  /** Every faceoff (drop time, set time, dot) — the linesman's schedule. */
  private faceoffs: Array<{ t: number; set: number; x: number; z: number }> = []
  /** The linesman: a stick-less skater rig in stripes who drops the puck (null without authored athletes). */
  private linesman: PlayerPose | null = null
  private linesmanDropped = -1
  /** The faceoff that ends the stoppage in progress at time t (null in live play). */
  private deadAt(t: number): { x: number; z: number } | null {
    const d = this.deadTimes
    let lo = 0
    let hi = d.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (d[mid]!.from <= t) lo = mid + 1
      else hi = mid
    }
    const w = d[lo - 1]
    return w && t < w.to ? w : null
  }
  /** The goal sequence runs on the GAME clock: t = clock − at (W2 one clock; VT6). */
  private goalSeq: { t: number; at: number; scorer: string; side: 'home' | 'away'; phase: GoalPhase } | null = null

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
  /** Follow cam: the smoothed, rate-limited heading of play (never body facing). */
  private followHead: FollowHeading = { yaw: Math.PI / 2, reversedFor: 0 }
  private puckVelSmX = 0
  private puckVelSmZ = 0
  private prevPuckX: number | null = null
  /** Broadcast: a small, slow lead in the direction of play (ft). */
  private leadX = 0
  private prevPuckZ = 0
  /** Last rendered look yaw (null after a cut) — for the angular-speed cap. */
  private lastCamYaw: number | null = null

  // ── Wall clock for animation ───────────────────────────────────────────────
  private lastFrameTime = 0
  private wallTime = 0
  private cpuMsAvg = 0

  // ── Carrier tracking for follow camera ────────────────────────────────────
  private carrierWx = 0
  private carrierWz = 0
  private lastCarrier: PlayerId | null = null

  private constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 1400)
    this.camera.position.set(0, 44, -108)
    this.camera.lookAt(0, 0, 0)
  }

  private assets: AthleteAssets | null = null
  /** Owner-supplied athletes (+ their kit painter / materials) when in use. */
  private owner: OwnerAssets | null = null
  private ownerPainter: OwnerKitPainter | null = null
  private ownerTex: { skater: OwnerRoleTex; goalie: OwnerRoleTex | null } | null = null
  private ownerAtlas: HTMLCanvasElement | null = null
  private ownerAtlasTex: THREE.CanvasTexture | null = null
  private ownerAtlasDirty = false
  private atlasUp: AtlasUploader | null = null
  private ownerAtlasUp: AtlasUploader | null = null
  private ownerGearMats: THREE.MeshStandardMaterial[] = []
  private locoMode: LocoMode = 'code'
  private choreo: Choreographer | null = null
  private choreoClock = 0

  static async create(parent: HTMLElement, colors?: RinkColors, opts: Render3dOptions = {}): Promise<Rink3dRenderer> {
    const o = { ...RENDER3D_DEFAULTS, ...opts }
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
    // name labels: a 2D canvas over the GL canvas (never in the 3D scene)
    const lc = document.createElement('canvas')
    lc.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none'
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative'
    parent.appendChild(lc)
    inst.labelCanvas = lc
    if (colors) inst.setKits(colors)
    if (o.athletes === 'owner' || o.athletes === 'auto') await inst.loadOwner()
    inst.assets = o.athletes !== 'procedural' ? await loadAthleteAssets() : null
    inst.locoMode = inst.owner && !opts.locomotion ? 'clip' : o.locomotion

    inst.camera.aspect = w / h
    inst.camera.updateProjectionMatrix()

    inst.buildScene()
    inst.buildPost(w, h)
    // Compile every program now, so the first line change / goal never hitches
    // on a shader compile mid-game. compile() skips INVISIBLE objects (bench
    // rigs start hidden) and never builds the shadow-depth / reflection-pass
    // variants, so: show every rig and render one real frame of every pass.
    inst.prewarm()
    renderer.setAnimationLoop((time) => inst.animLoop(time))
    return inst
  }

  private setKits(colors: RinkColors): void {
    this.colors = colors
    this.homeKit = kitFor(colors.home, 'home')
    this.awayKit = kitFor(colors.away, 'away')
    this.updateOwnerAccents()
  }

  /** Render one full frame (reflection, shadows, post) with every rig shown — builds every program up front. */
  private prewarm(): void {
    const rigs = this.allPoses().map((p) => [p.rig, p.rig.visible] as const)
    for (const [r] of rigs) r.visible = true
    // no frustum culling for the warm-up: an object the camera (or the mirrored
    // reflection camera) doesn't see now would compile its variant mid-game —
    // e.g. the goal net's clipped reflection variant cost a 110–130 ms frame
    const culled: THREE.Object3D[] = []
    this.scene.traverse((o) => {
      if (o.frustumCulled) {
        o.frustumCulled = false
        culled.push(o)
      }
    })
    this.renderer.compile(this.scene, this.camera)
    this.scene.updateMatrixWorld()
    this.renderReflection()
    this.composer.render(0)
    this.renderer.info.reset()
    for (const o of culled) o.frustumCulled = true
    for (const [r, v] of rigs) r.visible = v
  }

  /** Owner athletes: meshes, textures, kit painter. Leaves `owner` null on any failure. */
  private async loadOwner(): Promise<void> {
    const own = await loadOwnerAssets()
    if (!own) return
    try {
      const role = async (t: OwnerTextures): Promise<OwnerRoleTex> => {
        const [clothesN, gearD, gearN] = await Promise.all([loadTexture(t.clothesN, false), loadTexture(t.gearD, true), loadTexture(t.gearN, false)])
        return { clothesN, gearD, gearN }
      }
      const [painter, sk, gk] = await Promise.all([
        OwnerKitPainter.load(own.tex, own.layout),
        role(own.tex.skater),
        own.tex.goalie ? role(own.tex.goalie) : Promise.resolve(null),
      ])
      this.ownerPainter = painter
      this.ownerTex = { skater: sk, goalie: gk }
      this.owner = own
    } catch (e) {
      console.warn('[render3d] owner athlete textures failed, using the Blender athletes', e)
      this.owner = null
    }
  }

  /** The gear accent (yellow in the owner's art) → each team's colour. */
  private updateOwnerAccents(): void {
    for (const m of this.ownerGearMats) {
      const kit = m.userData.team === 'home' ? this.homeKit : this.awayKit
      const accent = kit.jersey === 0xf4f4f2 ? kit.trim : kit.jersey
      ;(m.userData.uAccent as { value: THREE.Color }).value.setHex(accent)
    }
  }

  // ── Scene construction ────────────────────────────────────────────────────

  private buildScene(): void {
    this.scene.background = new THREE.Color(0x05070a)
    this.scene.fog = new THREE.Fog(0x05070a, 240, 560)

    this.arena = new Arena(this.renderer, this.colors)
    this.scene.add(this.arena.group)
    // the arena never moves: bake its matrices once
    this.arena.group.updateMatrixWorld(true)
    this.arena.group.traverse((o) => {
      o.matrixAutoUpdate = false
      o.matrixWorldAutoUpdate = false
    })
    this.scene.matrixWorldAutoUpdate = false
    this.scene.environment = this.arena.environment
    this.scene.environmentIntensity = 1.15

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
    const hemi = new THREE.HemisphereLight(0xe4ecff, 0x2a2e36, 0.75)
    this.scene.add(hemi)

    const key = new THREE.DirectionalLight(0xfff7ee, 1.35)
    // Tilted toward the broadcast side just enough (|z/y| > 0.4) that its mirror
    // glint on the glossy ice lands off the sheet for the overhead AND the
    // broadcast camera, while shadows stay short and soft under the players.
    key.position.set(20, 160, -72)
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

    // Goal lights: red wash behind each net, dark until a goal.
    for (const side of ['left', 'right'] as const) {
      const light = new THREE.PointLight(0xff2222, 0, 60, 1.6)
      light.position.set(side === 'left' ? -NET_X - 6 : NET_X + 6, 12, 0)
      this.scene.add(light)
      this.goalLights.push({ light, lamp: this.arena.goalLamps[side === 'left' ? 0 : 1], timer: 0, side })
    }

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

    // Readability at broadcast distance (F-17): the real puck is ~3 px there.
    // A subtle gold halo on the ice around the puck, kept at a minimum SCREEN
    // size (updateMarkers), plus a clearer ring under the carrier's skates.
    const flat = (inner: number): THREE.RingGeometry => {
      const g = new THREE.RingGeometry(inner, 1, 48)
      g.rotateX(-Math.PI / 2)
      return g
    }
    const markMat = (opacity: number): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({
        color: 0xffd24a, transparent: true, opacity, depthWrite: false, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -3,
      })
    this.puckGlowRing = new THREE.Mesh(flat(0.58), markMat(0.75))
    this.puckGlowRing.renderOrder = 2
    this.scene.add(this.puckGlowRing)
    this.carrierRing = new THREE.Mesh(flat(0.8), markMat(0.85))
    ;(this.carrierRing.material as THREE.MeshBasicMaterial).color.setHex(0xffbf1f)
    this.carrierRing.renderOrder = 2
    this.carrierRing.visible = false
    this.scene.add(this.carrierRing)
  }

  /**
   * Name labels in SCREEN space: a constant, readable pixel size at every
   * camera (they were 4.4 ft world sprites with no depth test — huge up close,
   * ~7 px at broadcast distance, overlapping in 77% of frames). The carrier
   * always, plus the few players nearest the puck; de-conflicted (a label
   * that can't find a free spot is dropped, never stacked).
   */
  private drawLabels(): void {
    const c = this.labelCanvas
    const W = c.clientWidth
    const H = c.clientHeight
    if (W === 0 || H === 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr)
      c.height = Math.round(H * dpr)
    }
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    this.labelRects = []
    // TV shows no name plates on a replay or a cut-in (the overlays carry names)
    if (!this.timeline || this.shot || (this.goalSeq && this.goalSeq.phase !== 'hold')) return

    const carrier = this.carrierMarkPose
    const cands: Array<{ p: PlayerPose; pri: number }> = []
    for (const p of this.allPoses()) {
      if (!p.labelOn || !p.labelText || !p.rig.visible) continue
      const d = Math.hypot(p.worldX.pos - this.puck.x, p.worldZ.pos - this.puck.z)
      if (p === carrier) cands.push({ p, pri: 100 })
      else if (!p.rig.goalie && d < LABEL_NEAR_FT) cands.push({ p, pri: 50 - d })
      else if (p.rig.goalie && d < LABEL_GOALIE_NEAR_FT) cands.push({ p, pri: 40 - d })
    }
    cands.sort((a, b) => b.pri - a.pri)
    const v = new THREE.Vector3()
    const reqs: LabelRequest[] = []
    const info = new Map<string, { p: PlayerPose; ax: number; ay: number; carrier: boolean }>()
    for (const { p, pri } of cands.slice(0, LABEL_MAX)) {
      v.set(p.worldX.pos, p.labelY, p.worldZ.pos).project(this.camera)
      if (v.z > 1 || Math.abs(v.x) > 1.02 || Math.abs(v.y) > 1.02) continue // behind the camera / off screen
      const ax = ((v.x + 1) / 2) * W
      const ay = ((1 - v.y) / 2) * H
      const isC = p === carrier
      ctx.font = isC ? '700 13px Arial, sans-serif' : '600 12px Arial, sans-serif'
      const w = Math.ceil(ctx.measureText(p.labelText!).width) + 16
      const h = isC ? 20 : 18
      const key = `${p.team}:${p.rig.slot}`
      reqs.push({ key, x: ax, y: ay - 3, w, h, priority: pri })
      info.set(key, { p, ax, ay, carrier: isC })
    }
    const placed = layoutLabels(reqs, { w: W, h: H })
    this.labelRects = placed
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    for (const r of placed) {
      const it = info.get(r.key)!
      const kit = it.p.team === 'home' ? this.homeKit : this.awayKit
      // nudged off its default spot: a hairline back to the player
      if (Math.abs(r.dx) > 1 || Math.abs(r.dy) > 1) {
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(it.ax, it.ay)
        ctx.lineTo(Math.max(r.left, Math.min(r.left + r.w, it.ax)), r.top + r.h)
        ctx.stroke()
      }
      ctx.fillStyle = it.carrier ? 'rgba(10,12,16,0.86)' : 'rgba(10,12,16,0.7)'
      ctx.beginPath()
      ctx.roundRect(r.left, r.top, r.w, r.h, 4)
      ctx.fill()
      if (it.carrier) {
        ctx.strokeStyle = '#ffbf1f'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      ctx.fillStyle = `#${(it.p.team === 'home' ? kit.jersey : kit.trim).toString(16).padStart(6, '0')}`
      ctx.fillRect(r.left + 2, r.top + 3, 4, r.h - 6)
      ctx.fillStyle = '#ffffff'
      ctx.font = it.carrier ? '700 13px Arial, sans-serif' : '600 12px Arial, sans-serif'
      ctx.fillText(it.p.labelText!, r.left + 10, r.top + r.h / 2 + 0.5)
    }
  }

  /**
   * Size the puck halo / carrier ring for the CURRENT camera: never smaller
   * on screen than a readable minimum (px), never smaller than real scale.
   * Runs after the camera moved this frame.
   */
  private updateMarkers(): void {
    const H = this.renderer.domElement.clientHeight || 400
    const tanHalf = Math.tan((this.camera.fov * Math.PI) / 360)
    const wpp = (x: number, z: number): number => (2 * this.camera.position.distanceTo(new THREE.Vector3(x, 0, z)) * tanHalf) / H
    const px = this.puck.x
    const pz = this.puck.z
    const carried = this.carrierMarkPose !== null
    // halo: ≥ 7 px radius; quieter while the carrier ring already marks the play
    const w = wpp(px, pz)
    const haloR = Math.max(PUCK_R + 0.45, 8 * w)
    this.puckGlowRing.position.set(px, 0.05, pz)
    this.puckGlowRing.scale.setScalar(haloR)
    ;(this.puckGlowRing.material as THREE.MeshBasicMaterial).opacity = carried ? 0.45 : 0.75
    // the puck itself never shrinks below ~3.5 px radius on screen (real size up close)
    const ps = Math.max(1, (3.5 * w) / PUCK_R)
    this.puckMesh.scale.set(ps, Math.min(ps, 2), ps)
    const c = this.carrierMarkPose
    this.carrierRing.visible = c !== null && c.rig.visible
    if (c) {
      const cx = c.worldX.pos
      const cz = c.worldZ.pos
      this.carrierRing.position.set(cx, 0.045, cz)
      this.carrierRing.scale.setScalar(Math.max(2.4, 15 * wpp(cx, cz)))
    }
  }

  private buildAthletes(): void {
    this.atlasCanvas = buildAtlasCanvas()
    this.atlasTex = new THREE.CanvasTexture(this.atlasCanvas)
    this.atlasTex.colorSpace = THREE.SRGBColorSpace
    this.atlasTex.anisotropy = 4
    this.atlasUp = new AtlasUploader(this.renderer, this.atlasTex, this.atlasCanvas)

    const rigs: AthleteRig[] = []
    const material = athleteMaterial(this.atlasTex)
    // owner athletes: kit atlas + clothes / gear / visor materials (gear per team & role)
    const own = this.owner
    let ownerMats: ((team: 'home' | 'away', goalie: boolean) => THREE.Material[]) | null = null
    if (own && this.ownerTex) {
      this.ownerAtlas = buildOwnerAtlasCanvas()
      this.ownerAtlasTex = new THREE.CanvasTexture(this.ownerAtlas)
      this.ownerAtlasTex.colorSpace = THREE.SRGBColorSpace
      this.ownerAtlasTex.anisotropy = 8
      this.ownerAtlasUp = new AtlasUploader(this.renderer, this.ownerAtlasTex, this.ownerAtlas)
      const visor = visorMaterial()
      const T = this.ownerTex
      const clothes = {
        skater: clothesMaterial(this.ownerAtlasTex, T.skater.clothesN),
        goalie: clothesMaterial(this.ownerAtlasTex, (T.goalie ?? T.skater).clothesN),
      }
      const gear: Record<string, THREE.MeshStandardMaterial> = {}
      for (const team of ['home', 'away'] as const) {
        for (const role of ['skater', 'goalie'] as const) {
          const t = role === 'goalie' && T.goalie ? T.goalie : T.skater
          const m = gearMaterial(t.gearD, t.gearN, 0xffffff)
          m.userData.team = team
          gear[`${team}:${role}`] = m
          this.ownerGearMats.push(m)
        }
      }
      this.updateOwnerAccents()
      ownerMats = (team, goalie) => [clothes[goalie ? 'goalie' : 'skater'], gear[`${team}:${goalie ? 'goalie' : 'skater'}`]!, visor]
    }
    const blenderClips = { skater: this.assets?.skater.clips ?? null, goalie: this.assets?.goalie.clips ?? null }
    const ownClips = own
      ? {
          skater: mergeClips(own.skater.clips, blenderClips.skater),
          goalie: own.goalie ? mergeClips(own.goalie.clips, blenderClips.goalie) : blenderClips.goalie,
        }
      : null
    const mk = (team: 'home' | 'away', goalie: boolean, slot: number, wx: number, wz: number): PlayerPose => {
      const ownT = own ? (goalie ? own.goalie : own.skater) : null
      const template = ownT ?? (this.assets ? (goalie ? this.assets.goalie : this.assets.skater) : null)
      const rig = new AthleteRig(goalie, slot, ownT && ownerMats ? ownerMats(team, goalie) : material, template)
      const clips = ownT && ownClips ? (goalie ? ownClips.goalie : ownClips.skater) : (template?.clips ?? null)
      rig.kit = team === 'home' ? this.homeKit : this.awayKit
      rigs.push(rig)
      return {
        worldX: snapSpring(wx),
        worldZ: snapSpring(wz),
        angle: team === 'home' ? Math.PI / 2 : -Math.PI / 2,
        angVel: 0,
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
        mode: 'idle' as RigMode,
        departT: 0,
        departSeq: 0,
        velSmX: 0,
        velSmZ: 0,
        rig,
        team,
        labelText: null,
        labelOn: false,
        labelY: 6.6,
        vx: 0,
        vz: 0,
        layer: clips ? new ActionLayer(clips) : null,
        overlay: null,
        faceOverride: null,
        followHL: PLAYER_FOLLOW_HL,
        lastSpeedFt: 0,
        stopCooldown: 0,
        stopAccum: 0,
        stopFrom: 0,
      }
    }
    for (let i = 0; i < SKATER_RIGS_PER_TEAM; i++) {
      const h = mk('home', false, i, BENCH_GATE.home.x, BENCH_GATE.home.z)
      const a = mk('away', false, 13 + i, BENCH_GATE.away.x, BENCH_GATE.away.z)
      h.rig.visible = false
      a.rig.visible = false
      this.homePoses.push(h)
      this.awayPoses.push(a)
    }
    this.homeGoaliePose = mk('home', true, HOME_G_SLOT, -NET_X + 4, 0)
    this.awayGoaliePose = mk('away', true, AWAY_G_SLOT, NET_X - 4, 0)
    for (const p of this.allPoses()) this.paintSlot(p)
    if (this.assets) {
      // the linesman: a skater rig variant (spare atlas cell, stripes, no stick)
      const l = mk('home', false, OFFICIAL_SLOT, 0, -LINESMAN_BOARDS_Z)
      l.mode = 'play'
      l.rig.bones.stick.scale.setScalar(1e-4)
      l.rig.bones.stick_blade.scale.setScalar(1e-4)
      this.linesman = l
      this.paintOfficial()
    }

    if (this.assets) {
      const all = () => this.allPoses()
      this.choreo = new Choreographer(
        (id) => all().find((p) => p.playerId === id && p.rig.visible) ?? null,
        all,
        // the left net is defended by whichever goalie stands on the left
        (side) => [this.homeGoaliePose, this.awayGoaliePose].find((g) => g !== null && (side === 'left') === g.worldX.pos < 0) ?? null,
        this.locoMode,
        ownClips ? { skater: ownClips.skater, goalie: own?.goalie ? ownClips.goalie : null } : { skater: this.assets.skater.clips },
        PLAYER_FOLLOW_HL,
        !!own
      )
      for (const p of all()) p.overlay = this.choreo.overlayFor(p)
      if (this.linesman) this.linesman.overlay = this.choreo.overlayFor(this.linesman)
    }

    this.batch = new AthleteBatch(rigs, material)
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

  /** The linesman's stripes (his own atlas cell; repainted with the kits). */
  private paintOfficial(): void {
    const l = this.linesman
    if (!l) return
    if (this.ownerPainter && this.ownerAtlas && this.owner) {
      this.ownerPainter.paintOfficial(this.ownerAtlas, l.rig.slot, OFFICIAL_KIT)
      this.ownerAtlasUp?.mark(slotRect(this.ownerAtlas, l.rig.slot))
      this.ownerAtlasDirty = true
      return
    }
    l.rig.kit = OFFICIAL_KIT
    l.rig.recolor()
    paintOfficialSlot(this.atlasCanvas, l.rig.slot, OFFICIAL_KIT)
    this.atlasUp?.mark(slotRect(this.atlasCanvas, l.rig.slot))
    this.atlasDirty = true
  }

  /**
   * The linesman works the faceoffs (film T1): he skates in to the dot as the
   * set begins, squares up beside it, bends and drops the puck on the drop,
   * backs out ~6 ft, then drifts to the far boards and follows the play along
   * them until the next faceoff. Skated through updatePose (springs, stride,
   * skate heading) so he moves like everyone else.
   */
  private updateLinesman(absT: number, dt: number, simDt: number, puckWx: number, puckWz: number): void {
    const l = this.linesman
    if (!l) return
    // a seek / load (dt 0): drop whatever he was doing (a paused drop would resume at the new time)
    if (dt === 0 && l.layer) {
      l.layer.clear()
      this.linesmanDropped = -1
    }
    // (arms at rest whenever nothing else is playing — never on top of the drop)
    if (l.layer && l.layer.playing.length === 0) l.layer.play('official_arms')
    // the faceoff he is working: the next drop within its set window, or the one just dropped
    let f: (typeof this.faceoffs)[number] | null = null
    for (const x of this.faceoffs) {
      if (x.t + 1.6 < absT) continue
      if (x.set - 2.2 <= absT) f = x
      break
    }
    let tx: number
    let tz: number
    let face: number | undefined
    if (f) {
      const s = f.z >= 0 ? 1 : -1 // stand on the dot's boards side
      const off = absT <= f.t ? 3.4 : 9
      tx = f.x
      tz = f.z + s * off
      face = Math.atan2(f.x - l.worldX.pos, f.z - l.worldZ.pos)
      const dropAt = f.t - 8 / 30
      if (l.layer && absT >= dropAt && absT < f.t + 0.2 && this.linesmanDropped !== f.t) {
        l.layer.play('official_drop', { at: Math.max(0, absT - dropAt) })
        this.linesmanDropped = f.t
      }
    } else {
      tx = Math.max(-80, Math.min(80, puckWx * 0.8))
      tz = -LINESMAN_BOARDS_Z
      face = Math.atan2(puckWx - l.worldX.pos, puckWz - l.worldZ.pos)
    }
    this.updatePose(l, tx, tz, dt, simDt, puckWx, puckWz, 24, face)
    this.skateHeading(l, dt, simDt)
  }

  private paintSlot(p: PlayerPose): void {
    const kit = p.team === 'home' ? this.homeKit : this.awayKit
    const num = p.playerId ? (this.labels[p.playerId]?.number ?? jerseyNumber(p.playerId)) : p.rig.goalie ? 30 : 10 + p.rig.slot
    if (this.ownerPainter && this.ownerAtlas && this.owner && (!p.rig.goalie || this.owner.goalie)) {
      const name = p.playerId ? (this.labels[p.playerId]?.lastName ?? '') : ''
      this.ownerPainter.paint(this.ownerAtlas, p.rig.slot, p.rig.goalie ? 'goalie' : 'skater', kit, num, name)
      this.ownerAtlasUp?.mark(slotRect(this.ownerAtlas, p.rig.slot))
      this.ownerAtlasDirty = true
      return
    }
    paintJerseySlot(this.atlasCanvas, p.rig.slot, kit, num, p.rig.goalie)
    this.atlasUp?.mark(slotRect(this.atlasCanvas, p.rig.slot))
    this.atlasDirty = true
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
    // a right-handed shooter's pose is mirrored (athlete.ts mirrorPose); goalies keep theirs
    pose.rig.rightHanded = !pose.rig.goalie && info?.handedness === 'R'
    if (!id || !info) {
      pose.labelText = null
      return
    }
    pose.labelText = info.number !== undefined ? `${info.number} ${info.lastName}` : info.lastName
    pose.labelOn = true
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
    this.goalSeq = null
    this.sinceGoal = Infinity

    this.choreo?.reset()
    this.choreoClock = 0
    // Reset per-slot state so jerseys/labels repaint for the new game
    for (const p of this.allPoses()) {
      p.playerId = null
      p.labelText = null
      p.labelOn = false
      p.butterflyTimer = p.armsTimer = p.staggerTimer = 0
      p.butterfly = 0
      p.shotTimer = -1
      this.paintSlot(p)
    }

    // Goal lights off (they live for the renderer's lifetime — re-adding
    // lights would change the light set and recompile every material)
    for (const gl of this.goalLights) gl.timer = 0

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
    this.goalSeq = null
    this.sinceGoal = Infinity
    for (const p of this.allPoses()) {
      p.butterflyTimer = p.armsTimer = p.staggerTimer = 0
      p.shotTimer = -1
    }
    this.choreo?.reset()
    this.choreoClock = this.clockPos

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
    this.puck = { x: this.puckMesh.position.x, z: this.puckMesh.position.z, cx: 0, cz: 0, key: this.puck.key }
  }

  private currentTarget(): ReturnType<typeof broadcastFraming> {
    if (this.shot) {
      const t = this.shotTarget(this.shot.cue)
      if (t) return t
    }
    const gs = this.goalSeq && this.camPreset === 'broadcast' ? this.goalSeqTarget() : null
    if (gs) return gs
    if (this.camPreset === 'broadcast') return broadcastFraming(this.playFocusX, this.playFocusZ, this.leadX, this.camera.aspect)
    const t = cameraTargetFor(this.camPreset, this.playFocusX, {
      endzoneActiveSide: this.endzoneActiveSide,
      carrierAngle: this.followHead.yaw,
      carrierWx: this.carrierWx,
      carrierWz: this.carrierWz,
      puckWz: this.playFocusZ,
    })
    return { ...t, fov: cameraFovFor(this.camPreset) }
  }

  /**
   * Hard-snap the camera spring state to the correct target for the current
   * preset + play-focus position (after load / seek) — zero fly-in.
   */
  private snapCameraToTarget(): void {
    this.endzoneActiveSide = endzoneChooseEnd(this.endzoneActiveSide, this.playFocusX)
    // follow: start behind the play, looking toward the end it is in
    this.followHead = { yaw: this.playFocusX >= 0 ? Math.PI / 2 : -Math.PI / 2, reversedFor: 0 }
    this.puckVelSmX = this.puckVelSmZ = 0
    this.prevPuckX = null
    this.leadX = 0
    this.lastCamYaw = null
    this.snapCameraSprings()
  }

  /** Hard-cut the camera to the current preset's target (a cut, never a fly-through). */
  private snapCameraSprings(): void {
    this.lastCamYaw = null
    const target = this.currentTarget()
    this.camX = snapSpring(target.px)
    this.camY = snapSpring(target.py)
    this.camZ = snapSpring(target.pz)
    this.lookX = snapSpring(target.lx)
    this.lookY = snapSpring(target.ly)
    this.lookZ = snapSpring(target.lz)
    this.fov = snapSpring(target.fov)
    this.arena.setCeilingVisible(this.camPreset !== 'overhead')
    this.applyFov(this.fov.pos)
    this.camera.position.set(target.px, target.py, target.pz)
    // top-down: screen-up = far boards (+Z), matching the broadcast orientation
    this.camera.up.set(0, this.camPreset === 'overhead' ? 0 : 1, this.camPreset === 'overhead' ? 1 : 0)
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
    this.ownerAtlasTex?.dispose()
    for (const t of [this.ownerTex?.skater, this.ownerTex?.goalie]) if (t) for (const x of Object.values(t)) x.dispose()
    this.labelCanvas.remove()
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
    // stoppages (goal / whistle) and the faceoffs that end them: during the dead
    // time the game camera frames the NEXT faceoff, not the dead puck in the net
    this.deadTimes = []
    let pending: number | null = null
    for (const ev of stream) {
      const e = ev as { type: string; period?: number; t?: number; pos?: { x: number; y: number } }
      if (e.period === undefined || e.t === undefined) continue
      const at = absTime(e.period, e.t)
      if (e.type === 'goal' || e.type === 'whistle') pending ??= at
      else if (e.type === 'faceoff' && pending !== null && e.pos) {
        this.deadTimes.push({ from: pending, to: at, x: normXtoWorld(e.pos.x), z: normYtoWorld(e.pos.y) })
        pending = null
      }
    }
    const cues = extractActionCues(stream)
    this.faceoffs = cues
      .filter((c) => c.kind === 'faceoff')
      .map((c) => ({ t: c.absT, set: c.setT ?? c.absT - FACEOFF_LEAD_S, x: normXtoWorld(c.nx), z: normYtoWorld(c.ny) }))
    this.linesmanDropped = -1
    this.choreo?.setCues(cues)
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
    this.goalSeq = null
    this.snapCameraToTarget()
  }

  // ── Broadcast hand-off (render2d/broadcast/types: BroadcastShotConsumer + BroadcastProjector) ──
  // The director's camera requests. Every shot is a CUT in and a cut back out,
  // then a locked-off (steady) frame — impact comes from the overlays, never shake.
  private shot: { cue: ShotCue; until: number } | null = null
  private readonly projTmp = new THREE.Vector3()

  requestShot(cue: ShotCue): boolean {
    if (cue.shot === 'broadcast') {
      if (this.shot) {
        this.shot = null
        this.snapCameraSprings()
      }
      return true
    }
    if (!this.shotTarget(cue)) return false
    this.shot = { cue, until: performance.now() + cue.holdMs }
    this.snapCameraSprings()
    return true
  }

  private moment: { until: number; crowd: number } | null = null
  /**
   * Ceremonies through the arena: the crowd rises (standing ovation, banner,
   * tribute) or cheers, and the honoured player raises his stick. The rookie
   * lap needs a skated path — declined for now (the caption overlay runs).
   */
  playMoment(cue: MomentCue): boolean {
    const ch = MOMENT_CHOREOGRAPHY[cue.moment]
    if (!ch || cue.moment === 'rookieLap') return false
    this.moment = { until: performance.now() + cue.holdMs, crowd: ch.crowd === 'standing' ? 0.8 : ch.crowd === 'cheer' ? 0.5 : 0 }
    if (cue.playerId && ch.poses.includes('stickRaise')) {
      const p = this.allPoses().find((q) => q.playerId === cue.playerId && q.rig.visible)
      if (p) p.armsTimer = Math.max(p.armsTimer, Math.min(6, cue.holdMs / 1000))
    }
    return true
  }

  /** A player's head in CSS px on the host (for the on-ice goal / assist tag); null when off the ice or off camera. */
  projectPlayer(playerId: string): { x: number; y: number } | null {
    const p = this.allPoses().find((q) => q.playerId === playerId && q.rig.visible && q.mode !== 'idle')
    if (!p) return null
    const v = this.projTmp.set(p.worldX.pos, p.labelY || 6.5, p.worldZ.pos).project(this.camera)
    if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return null
    const el = this.renderer.domElement
    return { x: ((v.x + 1) / 2) * el.clientWidth, y: ((1 - v.y) / 2) * el.clientHeight }
  }

  /** Where each director shot stands (world ft; +z = the benches' side, the main camera looks toward +z). */
  private shotTarget(cue: ShotCue): { px: number; py: number; pz: number; lx: number; ly: number; lz: number; fov: number } | null {
    const end = this.playFocusX >= 0 ? 1 : -1
    const side = cue.side ?? 'home'
    switch (cue.shot) {
      case 'goalReplay':
        // high in the corner behind the goal line, looking out at the play
        return { px: end * 96, py: 12, pz: -16, lx: end * 72, ly: 1, lz: this.playFocusZ * 0.5, fov: 34 }
      case 'saveReplay': {
        // the goalie at the end the play is in
        const gs = [this.homeGoaliePose, this.awayGoaliePose].filter((q): q is PlayerPose => !!q && q.rig.visible)
        const g = gs.sort((a, b) => Math.abs(a.worldX.pos - this.playFocusX) - Math.abs(b.worldX.pos - this.playFocusX))[0]
        const gx = g?.worldX.pos ?? end * 86
        const gz = g?.worldZ.pos ?? 0
        const ge = gx >= 0 ? 1 : -1
        return { px: gx - ge * 26, py: 7, pz: gz - 12, lx: gx, ly: 2.2, lz: gz, fov: 26 }
      }
      case 'benchReaction':
      case 'coachCloseup': {
        const bx = BENCH_GATE[side].x
        const coach = cue.shot === 'coachCloseup'
        return { px: bx + (coach ? 4 : 0), py: coach ? 6.5 : 7, pz: RINK_HALF_W - 22, lx: bx, ly: coach ? 5.8 : 4.6, lz: RINK_HALF_W + (coach ? 6.5 : 4.9), fov: coach ? 14 : 24 }
      }
      case 'crowd':
        return { px: this.playFocusX * 0.3, py: 10, pz: -4, lx: this.playFocusX * 0.3 + (side === 'home' ? -18 : 18), ly: 22, lz: RINK_HALF_W + 40, fov: 30 }
      case 'jumbotron':
        return { px: 0, py: 42, pz: -78, lx: 0, ly: 60, lz: 0, fov: 20 }
      case 'faceoffClose':
        return { px: 0, py: 5.5, pz: -21, lx: 0, ly: 1.4, lz: 0, fov: 22 }
      case 'lineups':
      case 'anthem': {
        const bl = side === 'home' ? -25 : 25
        return { px: bl, py: 6, pz: -36, lx: bl, ly: 3.2, lz: 6, fov: cue.shot === 'anthem' ? 35 : 28 }
      }
      case 'establishing':
        return { px: 0, py: 78, pz: -150, lx: 0, ly: 4, lz: 0, fov: 55 }
      case 'penaltyBox':
        // the arena has no penalty-box set yet: decline, the host keeps the game camera
        return null
      default:
        return null
    }
  }

  /** Camera for the current post-goal phase (null = the normal game camera). */
  private goalSeqTarget(): ReturnType<typeof broadcastFraming> | null {
    const g = this.goalSeq!
    switch (goalPhaseAt(g.t)) {
      case 'celly': {
        // tight on the scorer, from the centre-ice side (boards and glass behind him), following him
        const p = this.allPoses().find((q) => q.playerId === g.scorer && q.rig.visible)
        if (!p) return null
        const ax = -Math.sign(p.worldX.pos || 1)
        const len = Math.hypot(ax * 0.85, -0.5)
        const dx = (ax * 0.85) / len
        const dz = -0.5 / len
        return { px: p.worldX.pos + dx * 17, py: 5.5, pz: p.worldZ.pos + dz * 17, lx: p.worldX.pos, ly: 3.4, lz: p.worldZ.pos, fov: 30 }
      }
      case 'bench':
        return this.shotTarget({ channel: 'shot', id: 'goal-bench', clock: 'game', at: 0, holdMs: 0, shot: 'benchReaction', side: g.side })
      case 'crowd':
        return this.shotTarget({ channel: 'shot', id: 'goal-crowd', clock: 'game', at: 0, holdMs: 0, shot: 'crowd', side: g.side })
      default:
        return null
    }
  }

  /**
   * Club branding in the arena (image URLs / data URLs from the mod logo
   * pack): the HOME logo at centre ice, on dasher panels, the ribbon board and
   * behind the benches; home AND away on the video board's matchup. A key left
   * out is unchanged; null clears it (the league roundel / plain boards).
   * Resolves once the images have loaded (a failed image counts as none).
   */
  async setTeamLogos(logos: { home?: string | null; away?: string | null }): Promise<void> {
    const load = async (url: string | null | undefined): Promise<HTMLImageElement | null> => {
      if (!url) return null
      const img = new Image()
      img.decoding = 'async'
      img.src = url
      try {
        await img.decode()
        return img
      } catch {
        return null
      }
    }
    const [home, away] = await Promise.all([load(logos.home), load(logos.away)])
    this.arena.setLogos({
      ...(logos.home !== undefined ? { home } : {}),
      ...(logos.away !== undefined ? { away } : {}),
    })
  }

  /** Dev harness only: pin the camera to a fixed pose (null = normal presets). */
  setDebugCamera(pose: { px: number; py: number; pz: number; lx: number; ly: number; lz: number; fov?: number } | null): void {
    this.debugCam = pose
  }
  private debugCam: { px: number; py: number; pz: number; lx: number; ly: number; lz: number; fov?: number } | null = null

  /** Dev/perf probe: draw calls, triangles, CPU ms per frame (EMA). */
  /**
   * Dev harness only: play a clip on one player (team slot index; goalie =
   * index 99), optionally frozen at time `at` (speed 0) for close-ups.
   */
  debugClip(team: 'home' | 'away', index: number, name: string, at = 0, freeze = false): boolean {
    const p = index === 99 ? (team === 'home' ? this.homeGoaliePose : this.awayGoaliePose) : (team === 'home' ? this.homePoses : this.awayPoses)[index]
    if (!p?.layer) return false
    p.layer.clear()
    return p.layer.play(name, { at, speed: freeze ? 0 : 1, fadeless: freeze })
  }

  debugInfo(): { calls: number; triangles: number; cpuMs: number; athleteDraws: number; quality: number; athletes: string } {
    return {
      athletes: this.owner ? `owner/${this.locoMode}` : this.assets ? `blender/${this.locoMode}` : 'procedural',
      quality: this.quality,
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      cpuMs: +this.cpuMsAvg.toFixed(2),
      athleteDraws: this.batch.drawCalls,
    }
  }

  // ── Animation loop ────────────────────────────────────────────────────────

  // ── DEV viewer-truth probe (viewerProbe.ts) ─────────────────────────────
  private lastSnap: PosSnapshot | null = null
  private probeSink: ProbeSink | null = null
  private readonly probePrevQ = new WeakMap<AthleteRig, THREE.Quaternion[]>()
  private readonly probeV = new THREE.Vector3()

  /** DEV ONLY: receive what was DRAWN after every rendered frame (null detaches). */
  setProbeSink(sink: ProbeSink | null): void {
    this.probeSink = sink
  }

  /** DEV ONLY: the geometry the viewer-truth detectors judge against. */
  probeGeometry(): ProbeGeometry {
    return { rinkHalfL: 100, rinkHalfW: RINK_HALF_W, benchGates: { home: { ...BENCH_GATE.home }, away: { ...BENCH_GATE.away } } }
  }

  private emitProbe(dt: number): void {
    const sink = this.probeSink
    if (!sink) return
    const canvas = this.renderer.domElement
    const w = canvas.clientWidth || 1
    const h = canvas.clientHeight || 1
    const v = this.probeV
    const project = (x: number, y: number, z: number): { sx: number; sy: number; onScreen: boolean } => {
      v.set(x, y, z).project(this.camera)
      return { sx: ((v.x + 1) / 2) * w, sy: ((1 - v.y) / 2) * h, onScreen: v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 }
    }
    const sim = new Map<string, { x: number; z: number }>()
    const snap = this.lastSnap
    if (snap) {
      snap.home.forEach((p, k) => { const id = snap.homeIds?.[k]; if (id) sim.set(id as string, { x: normXtoWorld(p.x), z: normYtoWorld(p.y) }) })
      snap.away.forEach((p, k) => { const id = snap.awayIds?.[k]; if (id) sim.set(id as string, { x: normXtoWorld(p.x), z: normYtoWorld(p.y) }) })
      if (snap.homeGoalieId) sim.set(snap.homeGoalieId as string, { x: normXtoWorld(snap.homeGoalie.x), z: normYtoWorld(snap.homeGoalie.y) })
      if (snap.awayGoalieId) sim.set(snap.awayGoalieId as string, { x: normXtoWorld(snap.awayGoalie.x), z: normYtoWorld(snap.awayGoalie.y) })
    }
    const CORE = ['hips', 'spine', 'chest', 'neck', 'head'] as const
    const rigs: ProbeRig[] = []
    const goalies = [this.homeGoaliePose, this.awayGoaliePose]
    for (const p of this.allPoses()) {
      const goalie = goalies.includes(p)
      const rig = p.rig
      const pr = project(p.worldX.pos, 3, p.worldZ.pos)
      const id = (p.playerId as string | null) ?? null
      const sp = id ? sim.get(id) : undefined
      // body-core bone angular speed (the motion-probe "pop" measure), per wall second
      let boneW = 0
      const bones = rig.bones as unknown as Record<string, THREE.Bone | undefined>
      const prev = this.probePrevQ.get(rig)
      const cur: THREE.Quaternion[] = []
      CORE.forEach((n, i) => {
        const b = bones[n]
        const q = b ? b.quaternion.clone() : new THREE.Quaternion()
        cur.push(q)
        const pq = prev?.[i]
        if (pq && dt > 0 && rig.root.visible !== false) boneW = Math.max(boneW, pq.angleTo(q) / dt)
      })
      this.probePrevQ.set(rig, cur)
      rigs.push({
        team: p.team, goalie, id, mode: goalie ? 'play' : p.mode, visible: rig.visible,
        x: p.worldX.pos, z: p.worldZ.pos, sx: pr.sx, sy: pr.sy, onScreen: pr.onScreen,
        simX: sp ? sp.x : null, simZ: sp ? sp.z : null, boneW,
      })
    }
    const pm = this.puckMesh.position
    const pp = project(pm.x, pm.y, pm.z)
    sink({
      wall: performance.now() / 1000, dt, clock: this.clockPos, speed: this.speed, playing: this.playing, dead: this.deadAt(this.clockPos) !== null, w, h,
      cam: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z, fov: this.camera.fov, preset: this.camPreset },
      puck: { x: pm.x, y: pm.y, z: pm.z, sx: pp.sx, sy: pp.sy, onScreen: pp.onScreen, simX: snap ? normXtoWorld(snap.puck.x) : NaN, simZ: snap ? normYtoWorld(snap.puck.y) : NaN },
      carrier: (snap?.carrier as string | null | undefined) ?? null,
      windup: this.choreo?.windupActor(this.clockPos) ?? null,
      goalSeq: this.goalSeq ? this.goalSeq.phase : null,
      goalSeqT: this.goalSeq ? this.goalSeq.t : null,
      rigs,
    })
  }

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
    if (this.choreo) {
      if (this.clockPos > this.choreoClock) this.choreo.tick(this.choreoClock, this.clockPos)
      this.choreoClock = this.clockPos
    }
    this.renderAt(this.clockPos, dt, simDt)
    this.updateCues(this.clockPos, dt)
    this.updateCamera(dt)
    this.updateMarkers()
    this.drawLabels()
    this.updateArena(dt)
    this.emit()
    // repainted jersey slots go up as sub-images (a full re-upload of the
    // atlas hitched 58–100 ms on every line change)
    if (this.atlasDirty) {
      this.atlasUp?.flush()
      this.atlasDirty = false
    }
    if (this.ownerAtlasDirty) {
      this.ownerAtlasUp?.flush()
      this.ownerAtlasDirty = false
    }
    this.adaptQuality(dtMs / 1000)
    this.renderer.info.reset()
    // one world-matrix pass per frame (not one per render call: reflection,
    // shadow and main passes each used to re-traverse the whole scene)
    this.scene.updateMatrixWorld()
    if (this.quality < 2) this.renderReflection()
    this.composer.render(dt)
    if (this.probeSink) this.emitProbe(dt)
    const cpu = performance.now() - t0
    this.cpuMsAvg = this.cpuMsAvg === 0 ? cpu : this.cpuMsAvg + (cpu - this.cpuMsAvg) * 0.05
  }

  /**
   * Graceful degradation for weak GPUs: if frames stay slower than ~40 fps for
   * 3 s, step quality down once (never back up — no oscillation):
   *   1 → pixel ratio 1   2 → no ice reflection   3 → no bloom, 1k shadows.
   */
  private adaptQuality(rawDt: number): void {
    if (rawDt <= 0 || rawDt > 0.25 || this.quality >= 3) return // tab switches etc.
    this.frameEma = emaStep(this.frameEma, rawDt, rawDt, 1.0)
    this.slowFor = this.frameEma > 1 / 40 ? this.slowFor + rawDt : 0
    if (this.slowFor < 3) return
    this.slowFor = 0
    this.frameEma = 1 / 60
    this.quality++
    if (this.quality === 1 && this.renderer.getPixelRatio() > 1) {
      this.renderer.setPixelRatio(1)
      this.composer.setPixelRatio(1)
      this.resize()
    } else if (this.quality === 3) {
      this.bloom.enabled = false
      this.scene.traverse((o) => {
        if (o instanceof THREE.DirectionalLight && o.castShadow) {
          o.shadow.mapSize.setScalar(1024)
          o.shadow.map?.dispose()
          o.shadow.map = null
        }
      })
    }
  }
  private quality = 0
  private frameEma = 1 / 60
  private slowFor = 0

  /**
   * Hold the in-arena video board on its current score/clock (an instant
   * replay rewinds the picture; the board keeps the live score). Not part of
   * the MatchRenderer contract — MatchViewer calls it on the 3D renderer.
   */
  setBoardHold(on: boolean): void {
    if (!on || !this.timeline) {
      this.boardHold = null
      return
    }
    const s = this.timeline.scoreAt(this.clockPos)
    this.boardHold = { score: { home: s.home, away: s.away }, clock: this.timeline.displayClockAt(this.clockPos) }
  }
  private boardHold: { score: { home: number; away: number }; clock: { period: number; text: string } } | null = null

  private updateArena(dt: number): void {
    if (!this.timeline) return
    const score = this.boardHold?.score ?? this.timeline.scoreAt(this.clockPos)
    const clock = this.boardHold?.clock ?? this.timeline.displayClockAt(this.clockPos)
    if (this.playing) this.sinceGoal += dt
    const goalFlash = this.sinceGoal < 3.5 ? 3.5 - this.sinceGoal : 0
    this.arena.update(this.wallTime, {
      homeScore: score.home,
      awayScore: score.away,
      period: clock.period,
      clock: clock.text,
      excite: Math.max(crowdExcitement(this.sinceGoal), this.moment && performance.now() < this.moment.until ? this.moment.crowd : 0),
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
    this.lastSnap = snap
    this.lastCarrier = snap.carrier
    const puckWx = normXtoWorld(snap.puck.x)
    const puckWz = normYtoWorld(snap.puck.y)

    // Skaters: rigs are bound to PLAYERS, not timeline slots (see lineChange.ts)
    this.syncSide('home', this.homePoses, snap.home, snap.homeIds, dt, simDt, puckWx, puckWz, snap.homeFacing)
    this.syncSide('away', this.awayPoses, snap.away, snap.awayIds, dt, simDt, puckWx, puckWz, snap.awayFacing)

    // Goalies
    if (this.homeGoaliePose) {
      this.updatePoseLabelForPlayer(this.homeGoaliePose, snap.homeGoalieId)
      this.updateGoaliePose(this.homeGoaliePose, snap.homeGoalie.x, snap.homeGoalie.y, snap.puck, dt, simDt)
    }
    if (this.awayGoaliePose) {
      this.updatePoseLabelForPlayer(this.awayGoaliePose, snap.awayGoalieId)
      this.updateGoaliePose(this.awayGoaliePose, snap.awayGoalie.x, snap.awayGoalie.y, snap.puck, dt, simDt)
    }

    this.updateLinesman(absT, dt, simDt, puckWx, puckWz)

    // Sticks on the ice: skating poses float the blade (up to ~0.6 ft on the
    // owner clips), which puts a carried puck visibly off the blade
    for (const p of this.homePoses) this.groundStick(p, dt)
    for (const p of this.awayPoses) this.groundStick(p, dt)
    for (const p of this.homePoses) this.skateHeading(p, dt, simDt)
    for (const p of this.awayPoses) this.skateHeading(p, dt, simDt)

    // Carrier pose (resolved AFTER the slots updated their ids this frame)
    let carrierPose: PlayerPose | null = null
    // a shooter / passer mid-swing keeps the puck on his blade until contact
    const carrierId = this.choreo?.windupActor(absT) ?? snap.carrier
    if (carrierId !== null) {
      carrierPose = this.allPoses().find((p) => p.playerId === carrierId && p.rig.visible) ?? null
    }

    this.updateStickhandling(carrierPose, carrierId === snap.carrier)

    // Puck position: if carried, sits on the carrier's blade
    let pTargetX: number
    let pTargetZ: number
    const blade = carrierPose !== null ? this.bladePoint(carrierPose) : null
    if (carrierPose !== null && blade) {
      // on the posed blade (C3): wherever the clip / IK actually put the stick
      pTargetX = blade.x
      pTargetZ = blade.z
      this.carrierWx = carrierPose.worldX.pos
      this.carrierWz = carrierPose.worldZ.pos
    } else if (carrierPose !== null && carrierId !== snap.carrier) {
      // wind-up with the blade in the air: the puck waits on the ice where the
      // stick will come down on it (it doesn't jump to a body offset)
      pTargetX = this.puck.x
      pTargetZ = this.puck.z
      this.carrierWx = carrierPose.worldX.pos
      this.carrierWz = carrierPose.worldZ.pos
    } else if (carrierPose !== null) {
      const offset = puckCarriedOffset(carrierPose.angle, carrierPose.rig.bladeSide)
      pTargetX = carrierPose.worldX.pos + offset.dx
      pTargetZ = carrierPose.worldZ.pos + offset.dz
      this.carrierWx = carrierPose.worldX.pos
      this.carrierWz = carrierPose.worldZ.pos
    } else {
      pTargetX = normXtoWorld(snap.puck.x)
      pTargetZ = normYtoWorld(snap.puck.y)
      this.carrierWx = pTargetX
      this.carrierWz = pTargetZ
    }

    // The drawn puck TRACKS the stream (loose) or the blade (carried); only a
    // carried↔loose handoff blends, over a few frames (math.ts puckTrackStep).
    this.puck = puckTrackStep(this.puck, pTargetX, pTargetZ, carrierPose?.playerId ?? '', dt)

    // a loose puck rides the engine's height (agent engine: chips, saucers, clears; absent = on the ice)
    const puckY = carrierPose === null ? Math.max(0, snap.puckZ ?? 0) : 0
    this.puckMesh.position.set(this.puck.x, PUCK_H / 2 + puckY, this.puck.z)
    this.carrierMarkPose = carrierPose

    this.batch.sync()
    this.syncBlobs()
  }

  /** Per skater, per foot: last ankle position (world) and the eased blade-heading offset (rad). */
  private readonly skates = new Map<PlayerPose, { L: { x: number; z: number; off: number } | null; R: { x: number; z: number; off: number } | null }>()
  private readonly sQ = new THREE.Quaternion()
  private readonly sQ2 = new THREE.Quaternion()
  private static readonly UP = new THREE.Vector3(0, 1, 0)

  /**
   * A skate on the ice can only run along its blade. The skating cycle is
   * phase-locked to the body's speed, but the body also turns, drifts and
   * pushes sideways — so a skate pointing straight ahead while it travelled
   * sideways SKIDDED across the ice (motion-probe footSlip.skid). Each skate on
   * the ice turns (±0.85 rad, eased) toward the way it is actually travelling:
   * pushes toe out, crossovers toe in, as real strides do. Game-time eased;
   * a skate in the air keeps the clip's heading.
   */
  private skateHeading(pose: PlayerPose, dt: number, simDt: number): void {
    const rig = pose.rig
    if (!rig.visible || rig.goalie || pose.mode === 'idle' || dt <= 0 || simDt <= 0) {
      this.skates.delete(pose)
      return
    }
    let st = this.skates.get(pose)
    if (!st) {
      st = { L: null, R: null }
      this.skates.set(pose, st)
    }
    const rest = rig.dims.skate
    const k = 1 - Math.exp(-simDt / 0.05)
    for (const side of ['L', 'R'] as const) {
      const foot = rig.bones[`foot_${side}`]
      foot.updateWorldMatrix(true, false)
      const e = foot.matrixWorld.elements
      const x = e[12]!
      const y = e[13]!
      const z = e[14]!
      const prev = st[side]
      const cur = { x, z, off: prev?.off ?? 0 }
      st[side] = cur
      if (!prev) continue
      // game-time velocity of the ankle over the ice
      const vx = (x - prev.x) / simDt
      const vz = (z - prev.z) / simDt
      const v = Math.hypot(vx, vz)
      const onIce = 1 - smoothstep01(rest + 0.05, rest + 0.25, y)
      let want = 0
      if (v > 2.5 && onIce > 0) {
        const hx = e[8]!
        const hz = e[10]!
        // the blade runs both ways: fold the angle into ±90° (backward skating runs heel-first)
        // (the matrix is the clip's own heading: apply() re-poses the foot every frame)
        let d = wrapAngle(Math.atan2(vx, vz) - Math.atan2(hx, hz))
        if (d > Math.PI / 2) d -= Math.PI
        else if (d < -Math.PI / 2) d += Math.PI
        want = Math.max(-0.85, Math.min(0.85, d)) * onIce * Math.min(1, (v - 2.5) / 3)
      }
      cur.off = prev.off + (want - prev.off) * k
      if (Math.abs(cur.off) < 1e-4) continue
      // turn the foot about world up at the ankle: local' = parentWorld⁻¹ · R_y · world
      foot.getWorldQuaternion(this.sQ)
      this.sQ.premultiply(this.sQ2.setFromAxisAngle(Rink3dRenderer.UP, cur.off))
      foot.parent!.getWorldQuaternion(this.sQ2).invert()
      foot.quaternion.copy(this.sQ2.multiply(this.sQ))
      foot.updateMatrixWorld(true)
    }
  }

  private readonly gPivot = new THREE.Vector3()
  private readonly gV = new THREE.Vector3()
  private readonly gAxis = new THREE.Vector3()
  private readonly gQ = new THREE.Quaternion()
  private readonly gM = new THREE.Matrix4()
  private readonly gM2 = new THREE.Matrix4()
  private readonly gM3 = new THREE.Matrix4()
  /**
   * Swing a skater's stick about his top hand until the blade's low edge sits on
   * the ice. Only for a blade hovering a little (≤ 0.8 ft, full correction up to
   * 0.6) and no action clip playing — a shot, pass or hit lifts it on purpose.
   */
  /** Who is stickhandling now (at most one: the carrier). */
  private handler: PlayerPose | null = null
  /**
   * The puck carrier handles the puck (the looping stickhandle clip) while a
   * checker closes within ~11 ft, and settles back to the carry when he's in
   * open ice — the puck rides the blade through it. Never over an action clip.
   */
  private updateStickhandling(carrier: PlayerPose | null, carrying: boolean): void {
    let want: PlayerPose | null = null
    if (carrier && carrying && carrier.layer && !carrier.rig.goalie) {
      const mine = this.homePoses.includes(carrier) ? this.awayPoses : this.homePoses
      let near = Infinity
      for (const o of mine) {
        if (!o.rig.visible || o.mode === 'idle') continue
        near = Math.min(near, Math.hypot(o.worldX.pos - carrier.worldX.pos, o.worldZ.pos - carrier.worldZ.pos))
      }
      const busy = carrier.layer.playing.some((n) => n !== 'stickhandle' && n !== 'hockey_stop' && n !== 'skate_start')
      // hysteresis: start inside 11 ft, keep going until 15 ft
      const range = this.handler === carrier ? 15 : 11
      if (near < range && !busy) want = carrier
    }
    if (this.handler && this.handler !== want) this.handler.layer?.stop('stickhandle')
    if (want && this.handler !== want) want.layer?.play('stickhandle')
    this.handler = want
  }

  private readonly groundW = new WeakMap<PlayerPose, number>()
  private groundStick(pose: PlayerPose, dt: number): void {
    const rig = pose.rig
    // (not on the bench: his stick would go through the dasher)
    if (!rig.visible || rig.goalie || pose.mode === 'idle') { this.groundW.delete(pose); return }
    const w = rig.bladeWorld()
    if (!w) return
    const lift = w.y - 0.02
    const playing = pose.layer?.playing
    // the puck carrier keeps his blade down harder (the puck rides it)
    const full = pose.playerId !== null && pose.playerId === this.lastCarrier ? 1.1 : 0.6
    const eligible = !(playing && playing.some((n) => !GROUNDED_CLIPS.has(n))) && lift <= full + 0.2
    // eased in / out (~0.1 s half-life) so a clip starting or ending doesn't pop the stick
    const prev = this.groundW.get(pose) ?? (eligible ? 1 : 0)
    const k = dt > 0 ? 1 - Math.pow(0.5, dt / 0.1) : 0
    const gw = prev + ((eligible ? (lift <= full ? 1 : 1 - (lift - full) / 0.2) : 0) - prev) * k
    this.groundW.set(pose, gw)
    if (gw < 0.01 || lift < 0.02) return
    const weight = gw
    const hand = rig.topHand
    hand.updateWorldMatrix(true, false)
    this.gPivot.setFromMatrixPosition(hand.matrixWorld)
    const v = this.gV.copy(w).sub(this.gPivot)
    const r = v.length()
    const hLen = Math.hypot(v.x, v.z)
    if (r < 1 || hLen < 0.2) return
    const want = (0.02 - this.gPivot.y) / r
    if (want < -1 || want > 1) return
    // elevation change (negative = down); positive rotation about (h × up) raises h
    const delta = (Math.asin(want) - Math.asin(v.y / r)) * weight
    this.gAxis.set(-v.z / hLen, 0, v.x / hLen) // h × up
    this.gQ.setFromAxisAngle(this.gAxis, delta)
    // world' = T(pivot) · R · T(−pivot) · world
    this.gM.makeTranslation(this.gPivot.x, this.gPivot.y, this.gPivot.z).multiply(this.gM2.makeRotationFromQuaternion(this.gQ)).multiply(this.gM2.makeTranslation(-this.gPivot.x, -this.gPivot.y, -this.gPivot.z))
    for (const b of [rig.bones.stick, rig.bones.stick_blade]) {
      b.updateWorldMatrix(true, false)
      const world = this.gM2.multiplyMatrices(this.gM, b.matrixWorld)
      const local = world.premultiply(this.gM3.copy(b.parent!.matrixWorld).invert())
      local.decompose(b.position, b.quaternion, b.scale)
      b.updateMatrixWorld(true)
    }
  }

  private readonly bladeTmp = new THREE.Vector3()
  private readonly bladeDir = new THREE.Vector3()
  /**
   * Where a carried puck sits: on the carrier's POSED blade (audit C3 — a
   * fixed body offset left the drawn puck > 1.5 ft off the blade in 32% of
   * carried frames with the owner athletes, whose clips/IK move the stick
   * elsewhere). The blade bone's origin, a few inches along the blade, on the
   * ice. Null (→ the body offset) if the rig has no blade or it's implausibly
   * far from the body (a clip mid-swing, a missing bone binding).
   */
  private bladePoint(pose: PlayerPose): { x: number; z: number } | null {
    // the drawn blade's centre, measured from the stick geometry (athlete.ts bladeAnchor)
    const w = pose.rig.bladeWorld?.()
    if (w) {
      const d = Math.hypot(w.x - pose.worldX.pos, w.z - pose.worldZ.pos)
      // blade lifted (a shot follow-through) or implausibly far: fall through
      if (Number.isFinite(d) && d <= 7 && w.y < 0.6) return { x: w.x, z: w.z }
      if (Number.isFinite(d) && d <= 7) return null
    }
    const b = pose.rig.bones?.stick_blade
    if (!b) return null
    b.updateWorldMatrix(true, false)
    const e = b.matrixWorld.elements
    this.bladeDir.setFromMatrixColumn(b.matrixWorld, 0)
    const len = Math.hypot(this.bladeDir.x, this.bladeDir.z)
    const along = len > 1e-6 ? 0.35 / len : 0
    this.bladeTmp.set(e[12]! + this.bladeDir.x * along, 0, e[14]! + this.bladeDir.z * along)
    const d = Math.hypot(this.bladeTmp.x - pose.worldX.pos, this.bladeTmp.z - pose.worldZ.pos)
    if (!Number.isFinite(d) || d > 6.5) return null
    return { x: this.bladeTmp.x, z: this.bladeTmp.z }
  }

  private syncBlobs(): void {
    const m = new THREE.Matrix4()
    const poses = this.linesman ? [...this.allPoses(), this.linesman] : this.allPoses()
    poses.forEach((p, i) => {
      if (!p.rig.visible) {
        m.makeScale(0, 0, 0)
      } else {
        const s = p.rig.goalie ? 5.2 + p.butterfly * 1.5 : 3.6
        m.makeScale(s, 1, s * 0.9).setPosition(p.worldX.pos, 0.04, p.worldZ.pos)
      }
      this.blobs.setMatrixAt(i, m)
    })
    m.makeScale(1.1, 1, 1.1).setPosition(this.puck.x, 0.035, this.puck.z)
    this.blobs.setMatrixAt(poses.length, m)
    this.blobs.instanceMatrix.needsUpdate = true
  }

  private departSeq = 0

  /**
   * Bind one team's on-ice skaters to rigs and move every rig — from the
   * ENGINE's facts (W2). The agent engine changes through the bench door: a
   * man coming on appears at his door, a man going off has skated to it. So
   * the renderer only draws the step through the door (a hop over the boards),
   * and invents nothing on the ice:
   *  - no idle bench rigs standing at the boards (the owner's "too many men");
   *  - a man the sim took off FAR from his door (a stoppage change) walks to it
   *    only while the play is dead, and is gone the instant play is live;
   *  - never more drawn on the ice than the sim has there.
   * On a seek (dt 0) everything snaps and nobody is mid-change.
   */
  private syncSide(
    team: 'home' | 'away',
    poses: PlayerPose[],
    pos: ReadonlyArray<{ x: number; y: number } | undefined>,
    ids: ReadonlyArray<PlayerId | undefined> | undefined,
    dt: number, simDt: number, puckWx: number, puckWz: number,
    facing?: ReadonlyArray<number | undefined>,
  ): void {
    const gate = BENCH_GATE[team]
    const dead = this.deadAt(this.clockPos) !== null
    const idList = (ids ?? []).map((id) => (id as string | undefined))
    const slots = poses.map((p) => ({ id: p.playerId as string | null, mode: p.mode }))
    const { follow, entered, left } = assignRigs(slots, idList, poses.map((p) => p.departSeq))
    for (const r of left) {
      poses[r]!.departT = 0
      poses[r]!.departSeq = ++this.departSeq
      poses[r]!.labelOn = false
    }
    poses.forEach((pose, r) => {
      const slot = slots[r]!
      pose.mode = slot.mode
      if (slot.id !== (pose.playerId as string | null)) this.updatePoseLabelForPlayer(pose, slot.id as PlayerId | null)
      const k = follow[r]!
      if (pose.mode === 'idle' || (pose.mode === 'departing' && dt === 0)) {
        // on the bench: not drawn (the arena's bench is the bench)
        pose.mode = 'idle'
        pose.playerId = null
        pose.labelOn = false
        pose.rig.visible = false
        return
      }
      if (pose.mode === 'departing') {
        pose.departT += dt
        const door = Math.hypot(pose.worldX.pos - gate.x, pose.worldZ.pos - gate.z)
        // far from his door in live play: the sim has him off — so is the picture
        if (door > DOOR_NEAR_FT && !dead) {
          pose.mode = 'idle'
          pose.playerId = null
          pose.rig.visible = false
          return
        }
        pose.rig.visible = true
        const exitX = gate.x + ((pose.departSeq % 3) - 1) * 3
        if (door > 2.5 && pose.worldZ.pos < gate.z) {
          this.updatePose(pose, exitX, gate.z, dt, simDt, puckWx, puckWz, DEPART_SPEED)
        } else {
          // over the boards and down onto the bench
          this.moveDirect(pose, exitX, BENCH_Z, dt, simDt, puckWx, puckWz)
          this.hopOver(pose)
          if (pose.worldZ.pos >= BENCH_Z - 0.5 || pose.departT > DEPART_TIMEOUT_S) {
            pose.mode = 'idle'
            pose.playerId = null
            pose.rig.visible = false
          }
        }
        return
      }
      pose.rig.visible = true
      const p = pos[k]
      const tx = normXtoWorld(p?.x ?? 0)
      const tz = normYtoWorld(p?.y ?? 0)
      if (entered.includes(r)) {
        const nearDoor = Math.hypot(tx - gate.x, tz - gate.z) < DOOR_NEAR_FT
        if (dt === 0 || !nearDoor) {
          // a seek, or a man the sim put straight onto the ice: draw him where he is
          pose.mode = 'play'
          pose.worldX = snapSpring(tx)
          pose.worldZ = snapSpring(tz)
          pose.prevWx = tx
          pose.prevWz = tz
          pose.velSmX = 0
          pose.velSmZ = 0
        } else {
          // over the boards from the bench, right behind his door
          pose.worldX = snapSpring(tx)
          pose.worldZ = snapSpring(BENCH_Z)
          pose.prevWx = tx
          pose.prevWz = BENCH_Z
          pose.velSmX = 0
          pose.velSmZ = 0
          pose.angle = Math.PI
        }
      }
      if (pose.mode === 'arriving') {
        this.moveDirect(pose, tx, tz, dt, simDt, puckWx, puckWz)
        this.hopOver(pose)
        if (Math.hypot(pose.worldX.pos - tx, pose.worldZ.pos - tz) < 1.5) pose.mode = 'play'
        return
      }
      this.updatePose(pose, tx, tz, dt, simDt, puckWx, puckWz, MAX_RENDER_SPEED, facing?.[k])
    })
    // Never too many men: in live play at most one departing skater (inside
    // ~10 ft of his door) may still be drawn alongside the sim's full unit.
    if (dead) return
    const onIce = poses.filter((p) => p.rig.visible && (p.mode === 'play' || p.mode === 'arriving')).length
    const leaving = poses
      .filter((p) => p.rig.visible && p.mode === 'departing')
      .sort((a, b) => Math.hypot(a.worldX.pos - gate.x, a.worldZ.pos - gate.z) - Math.hypot(b.worldX.pos - gate.x, b.worldZ.pos - gate.z))
    const allowed = Math.max(0, Math.min(1, 6 - onIce))
    for (const p of leaving.slice(allowed)) {
      p.mode = 'idle'
      p.playerId = null
      p.labelOn = false
      p.rig.visible = false
    }
  }

  /** Move a rig at the hop's own pace (no position spring lag): a change is a
   *  few feet through the door, not a chase across the ice. */
  private moveDirect(pose: PlayerPose, tx: number, tz: number, dt: number, simDt: number, puckWx: number, puckWz: number): void {
    const step = approach(pose.worldX.pos, pose.worldZ.pos, tx, tz, simDt, HOP_SPEED, 0.2)
    pose.worldX = snapSpring(step.x)
    pose.worldZ = snapSpring(step.z)
    this.updatePose(pose, step.x, step.z, dt, simDt, puckWx, puckWz, HOP_SPEED)
  }

  /** The hop over the bench boards: the root rises over the boards line (W2;
   *  code-only until W5's animation data). */
  private hopOver(pose: PlayerPose): void {
    const u = (pose.worldZ.pos - (RINK_HALF_W - 1.2)) / (BENCH_Z - (RINK_HALF_W - 1.2))
    if (u <= 0 || u >= 1) return
    pose.rig.root.position.y = Math.sin(Math.PI * u) * HOP_RISE_FT
  }

  private updatePose(pose: PlayerPose, wx: number, wz: number, dt: number, simDt: number, puckWx: number, puckWz: number, maxSpeed = MAX_RENDER_SPEED, simFacing?: number): void {
    // the engine's own body facing (agent engine: backward-skating D, pivots) → renderer yaw
    const simAngle = simFacing !== undefined ? Math.atan2(Math.cos(simFacing), Math.sin(simFacing)) : null
    if (dt > 0) {
      const px = pose.worldX.pos
      const pz = pose.worldZ.pos
      // followHL: slower while a player is knocked down (choreo.ts), so his
      // body slides and then catches up on the spring instead of snapping
      pose.worldX = springStep(pose.worldX, wx, dt, pose.followHL)
      pose.worldZ = springStep(pose.worldZ, wz, dt, pose.followHL)
      // Nothing skates faster than a skater: a jump in the stream becomes a skate.
      const c = capStep(px, pz, pose.worldX.pos, pose.worldZ.pos, dt, maxSpeed)
      if (c.capped) {
        pose.worldX = { pos: c.x, vel: (c.x - px) / dt }
        pose.worldZ = { pos: c.z, vel: (c.z - pz) / dt }
      }
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

    // Velocity-based speed — in GAME ft/s: at 2×/4× playback the positions move
    // 2×/4× per wall second, and reading that as skating speed cycled the legs
    // 4×–16× too fast (a faster cadence for the doubled "speed", on top of the
    // doubled animation clock). `pb` is the playback rate (simDt / dt).
    const pb = dt > 0 && simDt > 0 ? simDt / dt : 1
    const vx = pose.worldX.pos - pose.prevWx
    const vz = pose.worldZ.pos - pose.prevWz
    const distSq = vx * vx + vz * vz
    const speedFt = dt > 0 ? Math.sqrt(distSq) / dt / pb : 0
    pose.speed = Math.min(1, speedFt / 22)
    if (dt > 0) {
      pose.vx = emaStep(pose.vx, vx / dt / pb, dt, 0.12)
      pose.vz = emaStep(pose.vz, vz / dt / pb, dt, 0.12)
    } else pose.vx = pose.vz = 0
    pose.prevWx = pose.worldX.pos
    pose.prevWz = pose.worldZ.pos

    // Orientation — clamped turn rate to prevent body whips. Skaters face
    // where they skate, except when gliding slowly or backing up against the
    // play, where (like real players) they square up to the puck.
    const prevAngle = pose.angle
    if (dt > 0) {
      // Face along a SMOOTHED direction of travel: the sim steers continuously,
      // and the raw per-frame velocity made bodies twitch side to side.
      pose.velSmX = emaStep(pose.velSmX, vx / dt, dt, FACING_VEL_TAU)
      pose.velSmZ = emaStep(pose.velSmZ, vz / dt, dt, FACING_VEL_TAU)
      const smSpeed = Math.hypot(pose.velSmX, pose.velSmZ)
      let target = simAngle ?? facingTarget(Math.atan2(pose.velSmX, pose.velSmZ), smSpeed, Math.atan2(puckWx - pose.worldX.pos, puckWz - pose.worldZ.pos), pose.playerId !== null && pose.playerId === this.lastCarrier)
      // a hit reaction / check faces the other man (choreo.ts) — through the same spring, never a snap
      const fo = pose.faceOverride
      if (fo && this.choreo && this.choreo.clock < fo.until) target = fo.angle
      else pose.faceOverride = null
      if (target !== null) {
        // spring toward the nearest equivalent of the target angle, then clamp the rate
        const goal = pose.angle + wrapAngle(target - pose.angle)
        const sp = springStep({ pos: pose.angle, vel: pose.angVel }, goal, dt, FACING_HL)
        pose.angle = clampTurnRate(pose.angle, sp.pos, dt, MAX_TURN_RATE_RAD_PER_SEC)
        pose.angVel = (pose.angle - prevAngle) / dt
      }
    } else {
      // seek/load: no velocity yet — start squared up to the puck
      pose.angle = simAngle ?? Math.atan2(puckWx - wx, puckWz - wz)
      pose.angVel = 0
      pose.velSmX = 0
      pose.velSmZ = 0
    }
    const turnRate = dt > 0 ? wrapAngle(pose.angle - prevAngle) / dt / pb : 0

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
    if (pose.layer) {
      pose.layer.update(simDt)
      // (velocities are already game ft/s: game-time dt, no playback correction)
      this.choreo?.locomotionEvents(pose, simDt, 1)
    }
    // handedness: a rig handed to a player who shoots the other way eases into the mirror
    const mw = pose.rig.rightHanded ? 1 : 0
    pose.rig.mirrorW = dt === 0 ? mw : pose.rig.mirrorW + (mw - pose.rig.mirrorW) * (1 - Math.exp(-dt / 0.08))
    pose.rig.apply(pose.worldX.pos, pose.worldZ.pos, pose.angle, body, stick, pose.overlay)

    pose.labelY = body.hipHeight + 3.4
    if (pose.mode === 'play' || pose.mode === 'arriving') pose.labelOn = true
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
      // goalie locomotion (owner imports) reads the travel direction and speed (game ft/s)
      const pb = simDt > 0 ? simDt / dt : 1
      pose.vx = pose.worldX.vel / pb
      pose.vz = pose.worldZ.vel / pb
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
    pose.layer?.update(simDt)
    pose.rig.apply(pose.worldX.pos, pose.worldZ.pos, pose.angle, body, { mode: 'carry' }, pose.overlay)

    pose.labelY = body.hipHeight + 3.6
    pose.labelOn = true
  }

  // ── Event cues ────────────────────────────────────────────────────────────

  private updateCues(absT: number, dt: number): void {
    if (absT > this.lastEvaluatedClock) {
      for (const cue of this.cues) {
        if (cue.absT > this.lastEvaluatedClock && cue.absT <= absT) this.activateCue(cue)
      }
    }
    this.lastEvaluatedClock = absT

    // cue lifetimes are GAME seconds (a replay at 0.6× plays them slower, like the picture)
    const cueDt = this.playing ? dt * this.speed : 0
    this.activeCues = this.activeCues.filter((ac) => {
      ac.elapsed += cueDt
      return ac.elapsed < this.cueLifetime(ac.cue.kind)
    })
    if (this.goalSeq) {
      this.goalSeq.t = absT - this.goalSeq.at
      if (this.goalSeq.t >= GOAL_SEQ.end || this.goalSeq.t < 0) this.goalSeq = null
    }
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
      if (!this.choreo) this.setPoseEffect(cue.actorId, 'arms', 2.4)
      this.sinceGoal = 0
      // Frame the spot the goal went in from, pulled toward the slot so the
      // net and the celebration both stay in shot. Fixed for the whole cue.
      const gx = normXtoWorld(cue.nx)
      const gz = normYtoWorld(cue.ny)
      const netX = Math.sign(gx || 1) * NET_X
      this.celebration = { elapsed: 0, x: gx + (netX - gx) * 0.35, z: gz * 0.6 }
      const scorer = this.allPoses().find((p) => p.playerId === cue.actorId)
      if (scorer) this.goalSeq = { t: 0, at: cue.absT, scorer: cue.actorId, side: this.homePoses.includes(scorer) ? 'home' : 'away', phase: 'hold' }
    } else if (this.choreo) {
      // authored clips (shots, saves, hits) are started by the choreographer
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
    // a director's shot ran its course: CUT back to the game camera (never fly)
    if (this.shot && performance.now() >= this.shot.until) {
      this.shot = null
      this.snapCameraSprings()
    }
    // A calm TV follow. Every layer only SMOOTHS; nothing here can add wobble.
    const tune = CAMERA_TUNING[this.camPreset]

    // ── Layer 1: soft dead-band on the puck ──────────────────────────────────
    // The focus trails the puck by up to a few feet, so stick-handling and
    // rebounds don't move the shot, and a real rush eases the pan in from zero
    // (the old hard deadzone stepped the target → stop/start pans).
    // a stoppage: frame where the next faceoff will be (players gather there);
    // after a goal, only once the celebration sequence has run
    const dead = this.goalSeq && goalPhaseAt(this.goalSeq.t) !== 'done' ? null : this.deadAt(this.clockPos)
    const rawX = dead ? dead.x : this.puck.x
    const rawZ = dead ? dead.z : this.puck.z
    // the zone-framed broadcast shot keeps a tighter band (its frame is ~80 ft)
    const committedX = softDeadzone(rawX, this.playFocusX, this.camPreset === 'broadcast' ? 4 : PLAY_FOCUS_DEADZONE_X)
    const committedZ = softDeadzone(rawZ, this.playFocusZ, PLAY_FOCUS_DEADZONE_Z)

    // ── Layer 2: slow EMA toward the committed point ─────────────────────────
    let newFocusX = emaStep(this.playFocusX, committedX, dt, tune.tauX)
    let newFocusZ = emaStep(this.playFocusZ, committedZ, dt, tune.tauZ)

    // ── Layer 3: focus speed limit (ft/s, frame-rate independent) ────────────
    // Applied to the TARGET, not the camera: a goal/faceoff puck teleport
    // becomes a slow, even pan. (Replaces the old per-frame overhead clamp and
    // the camera max-speed clamp, which kept the spring's velocity while
    // clipping its position — that mismatch was a bounce source.)
    newFocusX = clampSpeed(this.playFocusX, newFocusX, dt, tune.maxFocusSpeed)
    newFocusZ = clampSpeed(this.playFocusZ, newFocusZ, dt, tune.maxFocusSpeed)
    this.playFocusX = Number.isFinite(newFocusX) ? newFocusX : this.playFocusX
    this.playFocusZ = Number.isFinite(newFocusZ) ? newFocusZ : this.playFocusZ

    // Heading of play for the follow cam: the puck's smoothed direction of
    // travel, turned toward at ≤ 35°/s; a sustained reversal is a CUT.
    let cut = false
    if (dt > 0) {
      if (this.prevPuckX !== null) {
        const vx = (rawX - this.prevPuckX) / dt
        const vz = (rawZ - this.prevPuckZ) / dt
        // A puck teleport (the stoppage reset to the next faceoff dot) is a CUT
        // to the new faceoff, like TV — not a long pan across empty ice.
        if (Math.hypot(rawX - this.prevPuckX, rawZ - this.prevPuckZ) > 25 && this.camPreset !== 'overhead') {
          this.playFocusX = rawX
          this.playFocusZ = rawZ
          this.puckVelSmX = this.puckVelSmZ = 0
          this.leadX = 0
          cut = true
        } else if (Math.hypot(vx, vz) < 200) {
          this.puckVelSmX = emaStep(this.puckVelSmX, vx, dt, 0.5)
          this.puckVelSmZ = emaStep(this.puckVelSmZ, vz, dt, 0.5)
        }
      }
      this.prevPuckX = rawX
      this.prevPuckZ = rawZ
    }
    // Broadcast lead: the focus → spring chain trails steady play by ~0.9 s,
    // so aim that far ahead along the play's SMOOTHED velocity (≤ 24 ft). In
    // steady play this cancels the lag (the carrier stays mid-frame); when play
    // stops the lead bleeds off over ~1 s — an easy settle, never a snap.
    this.leadX = emaStep(this.leadX, Math.max(-24, Math.min(24, this.puckVelSmX * 0.9)), dt, 0.6)
    if (this.camPreset === 'follow') {
      const sp = Math.hypot(this.puckVelSmX, this.puckVelSmZ)
      const h = followHeadingStep(this.followHead, sp > 10 ? Math.atan2(this.puckVelSmX, this.puckVelSmZ) : null, dt)
      this.followHead = { yaw: h.yaw, reversedFor: h.reversedFor }
      cut ||= h.cut
    }
    const prevSide = this.endzoneActiveSide
    this.endzoneActiveSide = endzoneChooseEnd(this.endzoneActiveSide, this.playFocusX)
    // endzone: the play changed ends → CUT to the other end (it used to fly
    // ~220 ft through the rink at head height, audit D2)
    if (this.camPreset === 'endzone' && this.endzoneActiveSide !== prevSide) cut = true
    if (this.goalSeq && this.camPreset === 'broadcast' && !this.shot) {
      const ph = goalPhaseAt(this.goalSeq.t)
      if (ph !== this.goalSeq.phase) {
        this.goalSeq.phase = ph
        cut = true
        const fo = ph === 'done' ? this.deadAt(this.clockPos) : null
        if (fo) {
          this.playFocusX = fo.x
          this.playFocusZ = fo.z
        }
      }
    }
    if (cut) this.snapCameraSprings()
    const target = this.currentTarget()
    let fovTarget = target.fov

    // Goal: a slow push-in toward where the goal was scored, held, then eased
    // back. The framing point is FIXED at the moment of the goal (it does not
    // chase the celebrating scorer — that tracking was a wobble source).
    if (this.celebration && this.camPreset === 'broadcast' && !this.goalSeq) {
      const w = celebrationWeight(this.celebration.elapsed, GOAL_CUE_S)
      if (w > 0) {
        const c = celebrationTarget(this.celebration.x, this.celebration.z)
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

    // ── Layer 4: critically-damped springs (no overshoot by construction) ────
    const hl = tune.springHL
    this.camX = springStep(this.camX, safeTarget.px, dt, hl)
    this.camY = springStep(this.camY, safeTarget.py, dt, hl)
    this.camZ = springStep(this.camZ, safeTarget.pz, dt, hl)
    this.lookX = springStep(this.lookX, safeTarget.lx, dt, hl)
    this.lookY = springStep(this.lookY, safeTarget.ly, dt, hl)
    this.lookZ = springStep(this.lookZ, safeTarget.lz, dt, hl)
    this.fov = springStep(this.fov, fovTarget, dt, 0.9)

    this.applyFov(this.fov.pos)
    this.camera.position.set(this.camX.pos, this.camY.pos, this.camZ.pos)
    // Angular-speed guard: no preset may swing its view faster than this.
    let lx = this.lookX.pos
    let lz = this.lookZ.pos
    if (this.camPreset !== 'overhead') {
      const cap = capLookYaw({ x: this.camX.pos, z: this.camZ.pos }, { x: lx, z: lz }, this.lastCamYaw, dt, MAX_CAM_YAW_RATE[this.camPreset])
      lx = cap.x
      lz = cap.z
      this.lastCamYaw = cap.yaw
    }
    this.camera.lookAt(lx, this.lookY.pos, lz)
    if (this.debugCam) {
      const d = this.debugCam
      this.applyFov(d.fov ?? 35)
      this.camera.up.set(0, 1, 0)
      this.camera.position.set(d.px, d.py, d.pz)
      this.camera.lookAt(d.lx, d.ly, d.lz)
    }
  }

  // ── Emit ──────────────────────────────────────────────────────────────────

  private emit(): void {
    if (!this.listener || !this.timeline) return
    const score = this.timeline.scoreAt(this.clockPos)
    const clock = this.timeline.displayClockAt(this.clockPos)
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
