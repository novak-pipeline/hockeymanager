/**
 * W3 S7 camera behaviour: a limited follower (docs/fm-study/SPEC.md §7, W3-DESIGN item 7).
 *
 * One axis of a camera (look x, look z, lens width, boom angle…) chasing its
 * target the way an operator on a fluid head does: it eases into a move, never
 * goes faster than `vmax`, never accelerates or brakes harder than `amax`, and
 * the acceleration itself ramps (at most `jmax` per second), so a pan never
 * starts or stops with a jerk. Inside those limits it is a critically damped
 * spring (half-life `hl`): no overshoot from the spring, and the braking rule
 * (it starts slowing in time to stop at the target) keeps the limits from
 * adding one.
 *
 * Pure: no THREE, no clock of its own. The caller passes dt in GAME seconds
 * (a 2x playback is a sped-up broadcast, not a twitchier camera).
 */

export interface AxisLimits {
  /** Max speed, units/s. */
  vmax: number
  /** Max acceleration (and braking), units/s². */
  amax: number
  /** Max change of acceleration, units/s³ (the ease into and out of a move). */
  jmax: number
  /** Spring half-life inside the limits, s. */
  hl: number
}

export interface Axis {
  pos: number
  vel: number
  acc: number
}

export function axisAt(pos: number): Axis {
  return { pos, vel: 0, acc: 0 }
}

/** Longest single integration step (s). */
export const AXIS_SUBSTEP = 1 / 120

/** Root of (1+x)·e^(−x) = ½: half-life → ω for a critically damped spring. */
const CRIT = 1.6783469900166612

/**
 * One step toward `target`. Returns a new state; |acc| ≤ amax, |vel| ≤ vmax,
 * |Δacc| ≤ jmax·dt always hold.
 */
export function axisStep(s: Axis, target: number, dt: number, lim: AxisLimits): Axis {
  if (!(dt > 0) || !Number.isFinite(target)) return s
  // a long frame (a hitch) is integrated in short substeps: the path over it
  // is the one the limits allow, not one coarse Euler jump
  if (dt > AXIS_SUBSTEP) {
    const n = Math.ceil(dt / AXIS_SUBSTEP)
    let q = s
    for (let i = 0; i < n; i++) q = axisStep(q, target, dt / n, lim)
    return q
  }
  const w = CRIT / Math.max(1e-3, lim.hl)
  const e = target - s.pos
  // the spring's wish, then the limits
  let a = w * w * e - 2 * w * s.vel
  // braking: moving toward the target faster than amax can stop in time
  if (s.vel * e > 0) {
    const need = (s.vel * s.vel) / (2 * Math.max(1e-6, Math.abs(e)))
    // `need` is the deceleration that stops exactly on the target; once it
    // reaches ~amax, brake with it (eased in by the jerk limit below)
    if (need > lim.amax * 0.6) a = Math.min(a * Math.sign(e), -need) * Math.sign(e)
  }
  // a speed cap the spring respects (asks for no acceleration past it)
  const vNext = s.vel + a * dt
  if (Math.abs(vNext) > lim.vmax) a = (Math.sign(vNext) * lim.vmax - s.vel) / dt
  a = Math.max(-lim.amax, Math.min(lim.amax, a))
  const jd = lim.jmax * dt
  const acc = s.acc + Math.max(-jd, Math.min(jd, a - s.acc))
  let vel = s.vel + acc * dt
  vel = Math.max(-lim.vmax, Math.min(lim.vmax, vel))
  const pos = s.pos + vel * dt
  return { pos, vel, acc }
}
