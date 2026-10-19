/**
 * W3 S7 — THE BROADCAST CAMERA, built from behaviours (W3-DESIGN item 7,
 * docs/fm-study/SPEC.md §7).
 *
 *  - FOCUS: the sim's published focus (FrameEvent.focus: the carrier's next
 *    stride, the pass target, the free puck's predicted spot, pulled toward the
 *    play's centre of gravity), or the puck led by its own travel when the
 *    stream has none (the classic engines). At a stoppage, the next faceoff.
 *  - RIG: the high sideline gantry. The body trucks along the boards with the
 *    play (60%) and pans for the rest; it frames one zone of ice across the
 *    screen (wider through the neutral zone). The BOOM raises the camera's
 *    angle when the play is on the near boards, and the frame then reaches past
 *    the boards (a pin and the glass flexing are in shot; the renderer softens
 *    the near dasher there, see `nearCut`).
 *  - FRAMING RULES: the puck inside the safe area, the carrier near the middle
 *    third. They clamp where the focus may put the frame; the focus picks the
 *    spot inside them. AUTO-ZOOM widens the lens when the play outruns the pan.
 *  - LIMITS: every axis (pan, tilt, lens, boom) is a limited follower
 *    (limits.ts): max speed, max acceleration, eased acceleration. No jerks,
 *    no cuts in live play. The only cut is the director's, at a stoppage.
 *
 * Pure (no THREE): the renderer and the offline VT9 harness drive the same code.
 */
import { axisAt, axisStep, type Axis, type AxisLimits } from './limits'
import { projectNdc, type CamPose } from './project'
import { nearBoardsPoint } from './nearBoards'

export const BROADCAST_RIG = {
  /** Pitch at rest and the extra the boom adds on the near boards (deg). */
  pitchDeg: 28,
  boomDeg: 11,
  /** Lens to look point distance (ft). */
  dist: 108,
  /** Ice across the frame (ft): in a zone, through the neutral zone. */
  widthZoneFt: 80,
  widthNeutralFt: 92,
  /** The widest auto-zoom goes (ft). */
  widthMaxFt: 124,
  minVfovDeg: 20,
  /** |look x| limit: the frame's far edge stops just past the end boards. */
  lookClampX: 76,
  /** How much the camera body trucks with the play (the rest is pan). */
  truck: 0.6,
  /** |look z| limit. */
  lookClampZ: 38,
  /**
   * The frame's bottom edge never lands nearer the camera than this (ft; the
   * near boards are at −42.5): just inside them at rest (more ice, less near
   * crowd), past them and the glass on the boom (board play in full).
   */
  nearEdgeZ: -38,
  nearEdgeBoomZ: -48,
} as const

/** The framing rules (NDC half-sizes: 1 = the screen edge). */
export const BROADCAST_FRAMING = {
  /** The puck is held inside this box (the safe area the pan works to). */
  puckX: 0.6,
  puckY: 0.55,
  /** The carrier is held inside this band (the middle third is ±1/3). */
  carrierX: 0.2,
  /** Where the puck will be (the stream's next moments) is held inside this box when it can be. */
  aheadX: 0.7,
  aheadY: 0.75,
  /** How far the aim moves from the sim's focus toward the puck 0.6 s ahead (0..1). */
  aimAhead: 0.5,
  /** Past this (at the drawn pose) the lens starts to widen. */
  zoomAt: 0.62,
  /** The boom engages as the play nears the near boards (ft from them): none at `from`, full at `to`. */
  boomFrom: 24,
  boomTo: 11,
} as const

/** Per-axis limits, in game seconds. VT9 judges the drawn pan against `pan.amax`. */
export const BROADCAST_LIMITS: Record<'pan' | 'tilt' | 'lens' | 'boom', AxisLimits> = {
  pan: { vmax: 80, amax: 120, jmax: 900, hl: 0.2 },
  tilt: { vmax: 45, amax: 90, jmax: 600, hl: 0.3 },
  lens: { vmax: 45, amax: 70, jmax: 350, hl: 0.4 },
  boom: { vmax: 3, amax: 12, jmax: 80, hl: 0.2 },
}

/** A stoppage target further than this from the frame is a director's cut (ft). */
export const STOPPAGE_CUT_FT = 50

export interface BroadcastInput {
  /** Game seconds since the last step (0 = paused). */
  dt: number
  aspect: number
  /** The drawn puck (world ft; y = height). */
  puck: { x: number; y: number; z: number }
  /** The drawn carrier (world ft), null when nobody has it. */
  carrier: { x: number; z: number } | null
  /** Where the play is about to be (world ft). */
  focus: { x: number; z: number }
  /**
   * Where the puck will be over the next moments (world ft; the stream is
   * known ahead of the picture): the frame starts moving before it gets there.
   */
  ahead?: ReadonlyArray<{ x: number; y: number; z: number }>
  /** The play is dead: frame the next faceoff here (null = live). */
  dead: { x: number; z: number } | null
}

export interface BroadcastState {
  lx: Axis
  lz: Axis
  width: Axis
  boom: Axis
}

/** The gantry's pose for a look point, a lens width and a boom (0..1). */
export function broadcastPose(lx: number, lz: number, width: number, boom: number, aspect: number): CamPose {
  const R = BROADCAST_RIG
  const pitch = ((R.pitchDeg + R.boomDeg * Math.max(0, Math.min(1, boom))) * Math.PI) / 180
  const px = lx * R.truck
  const py = R.dist * Math.sin(pitch)
  const back = R.dist * Math.cos(pitch)
  const D = Math.hypot(lx - px, py, back)
  const halfH = Math.atan(width / 2 / D)
  const fov = Math.max(R.minVfovDeg, (2 * Math.atan(Math.tan(halfH) / Math.max(0.5, aspect)) * 180) / Math.PI)
  return { px, py, pz: lz - back, lx, ly: 0, lz, fov }
}

/** The look z that keeps the frame's bottom edge at or inside `edgeZ`. */
function lzFloor(width: number, boom: number, aspect: number, edgeZ: number): number {
  const R = BROADCAST_RIG
  const pose = broadcastPose(0, 0, width, boom, aspect)
  const pitch = Math.atan2(pose.py, -pose.pz)
  const bottomRay = pitch + (pose.fov * Math.PI) / 360
  const back = -pose.pz
  void R
  return edgeZ + back - pose.py / Math.tan(bottomRay)
}

const smooth01 = (t: number): number => {
  const k = Math.max(0, Math.min(1, t))
  return k * k * (3 - 2 * k)
}

export function baseWidth(lookX: number): number {
  const R = BROADCAST_RIG
  const k = smooth01((Math.abs(lookX) - 25) / 20)
  return R.widthNeutralFt + (R.widthZoneFt - R.widthNeutralFt) * k
}

/** The look coordinate (x or z) at which `pt` lands at screen coordinate `u`. */
function solveLook(axis: 'x' | 'z', pose: CamPose, aspect: number, width: number, boom: number, pt: { x: number; y: number; z: number }, u: number): number {
  let l = axis === 'x' ? pose.lx : pose.lz
  const at = (v: number): number => {
    const p = axis === 'x' ? broadcastPose(v, pose.lz, width, boom, aspect) : broadcastPose(pose.lx, v, width, boom, aspect)
    const n = projectNdc(p, aspect, pt.x, pt.y, pt.z)
    return axis === 'x' ? n.x : n.y
  }
  for (let i = 0; i < 4; i++) {
    const f0 = at(l)
    if (!Number.isFinite(f0)) return l
    const d = (at(l + 0.5) - f0) / 0.5
    if (!Number.isFinite(d) || Math.abs(d) < 1e-6) return l
    const step = (u - f0) / d
    l += Math.max(-60, Math.min(60, step))
    if (Math.abs(step) < 0.05) break
  }
  return l
}

export class BroadcastCamera {
  s: BroadcastState = { lx: axisAt(0), lz: axisAt(0), width: axisAt(BROADCAST_RIG.widthNeutralFt), boom: axisAt(0) }
  /** True on a step that hard-cut (a stoppage cut or a snap); never in live play. */
  cut = false
  /** Near-boards softening wanted by the frame (0..1; follows the boom). */
  get nearCut(): number {
    return smooth01((this.s.boom.pos - 0.2) / 0.4)
  }

  pose(aspect: number): CamPose {
    return broadcastPose(this.s.lx.pos, this.s.lz.pos, this.s.width.pos, this.s.boom.pos, aspect)
  }

  /** The frame the camera wants for this input (no limits; a snap goes straight here). */
  target(inp: BroadcastInput): { lx: number; lz: number; width: number; boom: number } {
    const R = BROADCAST_RIG
    const F = BROADCAST_FRAMING
    // live: the sim's focus, pulled toward where the stream says the puck will be
    const fut = inp.ahead && inp.ahead.length ? inp.ahead[Math.min(2, inp.ahead.length - 1)]! : null
    const aim = inp.dead ?? (fut ? { x: inp.focus.x + (fut.x - inp.focus.x) * F.aimAhead, z: inp.focus.z + (fut.z - inp.focus.z) * F.aimAhead } : inp.focus)
    const dOf = (p: { x: number; z: number }): number => nearBoardsPoint(p.x, p.z, 100, 42.5)?.d ?? Infinity
    const near = inp.dead ? dOf(aim) : Math.min(dOf(inp.puck), dOf(inp.focus), ...(inp.ahead ?? []).map(dOf))
    const boom = smooth01((F.boomFrom - near) / (F.boomFrom - F.boomTo))
    let lx = Math.max(-R.lookClampX, Math.min(R.lookClampX, aim.x))
    const width0 = baseWidth(lx)
    const boomNow = this.s.boom.pos
    const edge = R.nearEdgeZ + (R.nearEdgeBoomZ - R.nearEdgeZ) * Math.max(boom, boomNow)
    let lz = Math.max(lzFloor(width0, boomNow, inp.aspect, edge), Math.max(-R.lookClampZ, Math.min(R.lookClampZ, aim.z)))
    let width = width0
    if (!inp.dead) {
      // framing rules, solved at the camera's present lens and boom
      const cur = this.pose(inp.aspect)
      const wNow = this.s.width.pos
      const pk = inp.puck
      const box = (axis: 'x' | 'z', pt: { x: number; y: number; z: number }, u: number): [number, number] => {
        const a = solveLook(axis, cur, inp.aspect, wNow, boomNow, pt, u)
        const b = solveLook(axis, cur, inp.aspect, wNow, boomNow, pt, -u)
        return [Math.min(a, b), Math.max(a, b)]
      }
      // the puck now is the hard rule; where it will be (the stream's next
      // moments) and the carrier narrow it when they can
      const within = (first: [number, number], more: Array<[number, number]>): [number, number] => {
        let [lo, hi] = first
        for (const iv of more) {
          const lo2 = Math.max(lo, iv[0])
          const hi2 = Math.min(hi, iv[1])
          if (lo2 <= hi2) {
            lo = lo2
            hi = hi2
          }
        }
        return [lo, hi]
      }
      const ahead = inp.ahead ?? []
      const xs: Array<[number, number]> = ahead.map((q) => box('x', q, F.aheadX))
      if (inp.carrier) xs.push(box('x', { x: inp.carrier.x, y: 3, z: inp.carrier.z }, F.carrierX))
      const [xlo, xhi] = within(box('x', pk, F.puckX), xs)
      lx = Math.max(xlo, Math.min(xhi, lx))
      lx = Math.max(-R.lookClampX - 12, Math.min(R.lookClampX + 12, lx))
      const [zlo, zhi] = within(box('z', pk, F.puckY), ahead.map((q) => box('z', q, F.aheadY)))
      lz = Math.max(zlo, Math.min(zhi, lz))
      // auto-zoom: the play is outrunning the pan (judged where the camera is now)
      let over = 0
      for (const [q, k] of [[pk, 1], ...ahead.map((q) => [q, F.aheadX / F.puckX] as const)] as Array<readonly [{ x: number; y: number; z: number }, number]>) {
        const n = projectNdc(cur, inp.aspect, q.x, q.y, q.z)
        over = Math.max(over, n.front ? Math.max(Math.abs(n.x) / (F.zoomAt * k), Math.abs(n.y) / (F.zoomAt * 1.1 * k)) : 2)
      }
      if (over > 1) width = Math.min(R.widthMaxFt, wNow * Math.min(1.25, over))
      width = Math.max(width0, Math.min(R.widthMaxFt, width))
    }
    return { lx, lz, width, boom }
  }

  /** Jump straight to the frame for `inp` (a seek, a load, a director's cut). */
  snap(inp: BroadcastInput): void {
    // twice: the framing rules are solved at the present lens/boom
    for (let i = 0; i < 2; i++) {
      const t = this.target(inp)
      this.s = { lx: axisAt(t.lx), lz: axisAt(t.lz), width: axisAt(t.width), boom: axisAt(t.boom) }
    }
    this.cut = true
  }

  step(inp: BroadcastInput): CamPose {
    this.cut = false
    const t = this.target(inp)
    if (inp.dead && Math.hypot(t.lx - this.s.lx.pos, t.lz - this.s.lz.pos) > STOPPAGE_CUT_FT) {
      // a stoppage: the director cuts to the next faceoff (never in live play)
      this.snap(inp)
      return this.pose(inp.aspect)
    }
    const L = BROADCAST_LIMITS
    this.s = {
      lx: axisStep(this.s.lx, t.lx, inp.dt, L.pan),
      lz: axisStep(this.s.lz, t.lz, inp.dt, L.tilt),
      width: axisStep(this.s.width, t.width, inp.dt, L.lens),
      boom: axisStep(this.s.boom, t.boom, inp.dt, L.boom),
    }
    return this.pose(inp.aspect)
  }
}

/**
 * The fallback focus for a stream without one (classic engines, older saves):
 * the puck led by its own smoothed travel.
 */
export function fallbackFocus(puck: { x: number; z: number }, vel: { x: number; z: number }, leadS = 0.5): { x: number; z: number } {
  const lx = Math.max(-30, Math.min(30, vel.x * leadS))
  const lz = Math.max(-15, Math.min(15, vel.z * leadS))
  return { x: puck.x + lx, z: puck.z + lz }
}
