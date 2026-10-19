/**
 * W3 S7 — REPLAY ANGLES for a goal (W3-DESIGN item 7; SPEC §7 "director family").
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
 */
import { axisAt, axisStep, type Axis, type AxisLimits } from './limits'
import { projectNdc, type CamPose } from './project'

export type ReplayAngle = 'endZoneHigh' | 'behindNet'

export const REPLAY_CAM = {
  /** The finish is shown from behind the net from this long before the goal (game s). */
  behindNetS: 1.6,
  endZoneHigh: { x: 114, y: 36, z: 0, widthFt: 74, look: { y: 0 } },
  behindNet: { x: 101.5, y: 6.5, z: 0, widthFt: 40, look: { y: 1.5 } },
  minFov: 14,
  maxFov: 58,
} as const

/** Replay followers are quicker than the live camera (the picture runs at 0.6×). */
export const REPLAY_LIMITS: { look: AxisLimits; lens: AxisLimits } = {
  look: { vmax: 140, amax: 260, jmax: 1600, hl: 0.18 },
  lens: { vmax: 60, amax: 160, jmax: 900, hl: 0.3 },
}

export class ReplayCamera {
  private lx: Axis = axisAt(0)
  private lz: Axis = axisAt(0)
  private width: Axis = axisAt(REPLAY_CAM.endZoneHigh.widthFt)
  private angle: ReplayAngle | null = null
  /** True on the step that cut (the first frame, the switch to behind the net). */
  cut = false

  /** @param net which net the goal went into (+1 = +x end). */
  constructor(readonly goalAbsT: number, readonly net: 1 | -1) {}

  angleAt(clock: number): ReplayAngle {
    return clock >= this.goalAbsT - REPLAY_CAM.behindNetS ? 'behindNet' : 'endZoneHigh'
  }

  private poseFor(a: ReplayAngle, aspect: number): CamPose {
    const R = REPLAY_CAM[a]
    const px = this.net * R.x
    const D = Math.hypot(this.lx.pos - px, R.y - R.look.y, this.lz.pos - R.z)
    const halfW = Math.atan(this.width.pos / 2 / Math.max(1, D))
    const fov = Math.max(REPLAY_CAM.minFov, Math.min(REPLAY_CAM.maxFov, (2 * Math.atan(Math.tan(halfW) / Math.max(0.5, aspect)) * 180) / Math.PI))
    return { px, py: R.y, pz: R.z, lx: this.lx.pos, ly: R.look.y, lz: this.lz.pos, fov }
  }

  /**
   * One step. `puck` is the drawn puck; `ahead` where it will be shortly (the
   * look leads toward it, as the live camera does).
   */
  step(dt: number, clock: number, aspect: number, puck: { x: number; y: number; z: number }, ahead: ReadonlyArray<{ x: number; z: number }> = []): CamPose {
    const a = this.angleAt(clock)
    const R = REPLAY_CAM[a]
    // aim a little ahead of the puck, never past the net
    const lead = ahead.length ? ahead[Math.min(1, ahead.length - 1)]! : puck
    let ax = puck.x * 0.7 + lead.x * 0.3
    const az = puck.z * 0.7 + lead.z * 0.3
    if (a === 'behindNet') ax = this.net > 0 ? Math.min(ax, 86) : Math.max(ax, -86)
    // the shot is wide enough to hold the puck and the men around it
    const D = Math.hypot(ax - this.net * R.x, R.y, az - R.z)
    const w = Math.max(R.widthFt * Math.min(1.6, Math.max(0.6, D / 60)), 24)
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
