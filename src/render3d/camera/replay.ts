/**
 * W3 S7 — REPLAY ANGLES (W3-DESIGN item 7; SPEC §7 "director family").
 *
 * The instant replay keeps W2's timing (MatchViewer: the build-up from goal −5 s
 * through goal +1.2 s at 0.6×, VT5). What changes is where it is seen from:
 *  - END-ZONE HIGH for the build-up: high over the end boards behind the net
 *    the goal went into, looking down the ice, so the rush, the passes and the
 *    shooter's lane read as a play;
 *  - BEHIND THE NET for the finish (from `behindNetS` before the goal): low,
 *    through the glass behind the cage, the shot coming at the camera and the
 *    puck crossing the line.
 * One cut between the two (a replay is presentation, not live play). Each
 * angle is a locked-off position that pans, tilts and zooms on the puck with
 * the same limited followers as the live camera (no whip).
 *
 * The replay package (render2d/broadcast/replayPackage.ts) adds single-angle
 * clips: the goal again from BEHIND THE NET or from the SHOOTER'S SIDE (low in
 * the corner on the side he shot from, looking across the crease), a big save
 * from behind the net, and a big hit TIGHT on the man it was done to, from
 * the broadcast side. `mode: 'auto'` is the two-angle main replay above.
 */
import { axisAt, axisStep, type Axis, type AxisLimits } from './limits'
import { projectNdc, type CamPose } from './project'

export type ReplayAngle = 'endZoneHigh' | 'behindNet' | 'shooterSide' | 'tight'
/** 'auto' = end-zone high for the build-up, then behind the net for the finish. */
export type ReplayMode = 'auto' | ReplayAngle

export const REPLAY_CAM = {
  /** The finish is shown from behind the net from this long before the goal (game s). */
  behindNetS: 1.6,
  endZoneHigh: { x: 114, y: 36, z: 0, widthFt: 74, look: { y: 0 } },
  behindNet: { x: 101.5, y: 6.5, z: 0, widthFt: 40, look: { y: 1.5 } },
  /** x toward the net's end, z toward the shooter's boards (signed per clip). */
  shooterSide: { x: 76, y: 7.5, z: 39, widthFt: 44, look: { y: 1.5 } },
  /** Off the subject: this far toward the broadcast side (−z), at this height. */
  tight: { x: 0, y: 9, z: 30, widthFt: 26, look: { y: 3 } },
  minFov: 14,
  maxFov: 58,
} as const

/** Replay followers are quicker than the live camera (the picture runs at 0.6×). */
export const REPLAY_LIMITS: { look: AxisLimits; lens: AxisLimits } = {
  look: { vmax: 140, amax: 260, jmax: 1600, hl: 0.18 },
  lens: { vmax: 60, amax: 160, jmax: 900, hl: 0.3 },
}

export interface ReplayCameraOptions {
  mode?: ReplayMode
  /** The shooter's side of the ice (world z sign) for 'shooterSide'. */
  side?: 1 | -1
}

export class ReplayCamera {
  private lx: Axis = axisAt(0)
  private lz: Axis = axisAt(0)
  private width: Axis = axisAt(REPLAY_CAM.endZoneHigh.widthFt)
  private angle: ReplayAngle | null = null
  /** Where the tight camera stands (set on its first frame, then locked off). */
  private anchor: { x: number; z: number } | null = null
  readonly mode: ReplayMode
  readonly side: 1 | -1
  /** True on the step that cut (the first frame, the switch to behind the net). */
  cut = false

  /**
   * @param goalAbsT the moment the replay is about (the goal, the save, the hit)
   * @param net which net is in play (+1 = +x end)
   */
  constructor(readonly goalAbsT: number, readonly net: 1 | -1, opts: ReplayCameraOptions = {}) {
    this.mode = opts.mode ?? 'auto'
    this.side = opts.side ?? 1
  }

  angleAt(clock: number): ReplayAngle {
    if (this.mode !== 'auto') return this.mode
    return clock >= this.goalAbsT - REPLAY_CAM.behindNetS ? 'behindNet' : 'endZoneHigh'
  }

  /** The camera's stand for an angle (world ft). */
  private stand(a: ReplayAngle): { x: number; y: number; z: number } {
    const R = REPLAY_CAM[a]
    if (a === 'shooterSide') return { x: this.net * R.x, y: R.y, z: this.side * R.z }
    if (a === 'tight') {
      const at = this.anchor ?? { x: 0, z: 0 }
      // from the broadcast side; a man on the near boards is shot from the ice side
      const z = at.z - R.z < -40 ? at.z + R.z * 0.8 : at.z - R.z
      return { x: Math.max(-92, Math.min(92, at.x - Math.sign(at.x || 1) * 6)), y: R.y, z }
    }
    return { x: this.net * R.x, y: R.y, z: R.z }
  }

  private poseFor(a: ReplayAngle, aspect: number): CamPose {
    const R = REPLAY_CAM[a]
    const s = this.stand(a)
    const D = Math.hypot(this.lx.pos - s.x, s.y - R.look.y, this.lz.pos - s.z)
    const halfW = Math.atan(this.width.pos / 2 / Math.max(1, D))
    const fov = Math.max(REPLAY_CAM.minFov, Math.min(REPLAY_CAM.maxFov, (2 * Math.atan(Math.tan(halfW) / Math.max(0.5, aspect)) * 180) / Math.PI))
    return { px: s.x, py: s.y, pz: s.z, lx: this.lx.pos, ly: R.look.y, lz: this.lz.pos, fov }
  }

  /**
   * One step. `puck` is the drawn puck (or, for a tight clip, the man it is
   * about); `ahead` where it will be shortly (the look leads toward it, as the
   * live camera does).
   */
  step(dt: number, clock: number, aspect: number, puck: { x: number; y: number; z: number }, ahead: ReadonlyArray<{ x: number; z: number }> = []): CamPose {
    const a = this.angleAt(clock)
    const R = REPLAY_CAM[a]
    // aim a little ahead of the puck, never past the net
    const lead = ahead.length ? ahead[Math.min(1, ahead.length - 1)]! : puck
    let ax = puck.x * 0.7 + lead.x * 0.3
    const az = puck.z * 0.7 + lead.z * 0.3
    if (a === 'behindNet' || a === 'shooterSide') ax = this.net > 0 ? Math.min(ax, 86) : Math.max(ax, -86)
    if (a === 'tight' && !this.anchor) this.anchor = { x: ax, z: az }
    // the shot is wide enough to hold the puck and the men around it
    const s = this.stand(a)
    const D = Math.hypot(ax - s.x, s.y, az - s.z)
    const w = Math.max(R.widthFt * Math.min(1.6, Math.max(0.6, D / 60)), a === 'tight' ? 18 : 24)
    this.cut = false
    if (this.angle !== a) {
      this.angle = a
      this.lx = axisAt(ax)
      this.lz = axisAt(az)
      this.width = axisAt(w)
      this.cut = true
      return this.poseFor(a, aspect)
    }
    const L = REPLAY_LIMITS
    this.lx = axisStep(this.lx, ax, dt, L.look)
    this.lz = axisStep(this.lz, az, dt, L.look)
    // widen when the puck runs toward the edge
    const n = projectNdc(this.poseFor(a, aspect), aspect, puck.x, puck.y, puck.z)
    const over = n.front ? Math.max(Math.abs(n.x), Math.abs(n.y)) / 0.6 : 2
    this.width = axisStep(this.width, over > 1 ? this.width.pos * Math.min(1.3, over) : w, dt, L.lens)
    return this.poseFor(a, aspect)
  }
}
