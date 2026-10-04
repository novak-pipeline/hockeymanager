/**
 * Viewer-truth probe (docs/gameplan-2026-09-28 W1, ROOT-CAUSES §2.1).
 *
 * What the 3D match screen actually DREW on one rendered frame: every rig's
 * drawn root and screen projection next to the sim's position for the same
 * player, the drawn puck, the camera, the playback speed and the clocks. The
 * viewer-truth detectors (viewerTruth.ts) judge these frames, never the
 * stream — the stream can be right while the picture is wrong.
 *
 * DEV ONLY: the renderer builds frames only while a sink is attached, and
 * MatchViewer attaches one only when the main process enabled the probe
 * (`window.hockey.devViewerProbe`, never true in a packaged build).
 */

export interface ProbeRig {
  team: 'home' | 'away'
  goalie: boolean
  /** Player bound to the rig (null = an idle bench rig). */
  id: string | null
  /** 'play' | 'arriving' | 'departing' | 'idle' (goalies: 'play'). */
  mode: string
  visible: boolean
  /** Drawn root, world feet (x along the ice, z across). */
  x: number
  z: number
  /** Screen position (css px) of the chest (3 ft up); onScreen = inside the viewport. */
  sx: number
  sy: number
  onScreen: boolean
  /** The sim's position for this player at this clock (null = not on the sim's ice). */
  simX: number | null
  simZ: number | null
  /** Max body-core (hips…head) LOCAL bone angular speed this frame, rad/s of wall time. */
  boneW: number
}

export interface ProbeViewerState {
  phase: string
  mode: string
  /** Instant replay on screen. */
  replay: boolean
  /** A goal is between the horn and the replay (celebration wall timer running). */
  replayPending: boolean
  /** Fast-forward spin between highlights. */
  ff: boolean
  nudge: number
  /** Live score/clock the scorebug shows (held through a replay). */
  shownScore: string
}

export interface ProbeFrame {
  /** performance.now() / 1000 at the end of the frame. */
  wall: number
  /** Wall seconds since the previous frame. */
  dt: number
  /** Renderer game clock (absolute seconds). */
  clock: number
  speed: number
  playing: boolean
  /** The play is dead (whistle → drop) at this clock. */
  dead: boolean
  w: number
  h: number
  cam: { x: number; y: number; z: number; fov: number; preset: string }
  puck: { x: number; y: number; z: number; sx: number; sy: number; onScreen: boolean; simX: number; simZ: number }
  carrier: string | null
  /** The shooter / passer the renderer holds in a wind-up (choreo), if any. */
  windup: string | null
  /** Renderer goal-sequence phase (its own clock), null outside one. */
  goalSeq: string | null
  goalSeqT: number | null
  rigs: ProbeRig[]
  viewer?: ProbeViewerState
}

/** Static facts the detectors need about the renderer's geometry. */
export interface ProbeGeometry {
  rinkHalfL: number
  rinkHalfW: number
  benchGates: { home: { x: number; z: number }; away: { x: number; z: number } }
  /** Where a penalised man leaves the ice (optional: older probes). */
  penaltyBoxes?: { home: { x: number; z: number }; away: { x: number; z: number } }
}

export type ProbeSink = (frame: ProbeFrame) => void

/** True when the main process enabled the dev probe (never in a packaged build). */
export function viewerProbeEnabled(): boolean {
  try {
    return (window as unknown as { hockey?: { devViewerProbe?: boolean } }).hockey?.devViewerProbe === true
  } catch {
    return false
  }
}
