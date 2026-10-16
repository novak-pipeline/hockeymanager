/**
 * Goal geometry truth (W3 S3; owner, reel S2 breakaway: "the puck went in from
 * behind the net at impossible angle").
 *
 * A goal is legal only when the puck crosses the goal line FROM IN FRONT,
 * BETWEEN THE POSTS. Judged two ways, on the same rule:
 *  - the release: the scorer's shot left from in front of the goal line, at an
 *    angle that can see the mouth (`SHOT_ANGLE_MAX`, the sim's own limit);
 *  - the path: the puck positions around the goal (sim frames, or what the 3D
 *    screen drew) cross the goal line between the posts, travelling into the net.
 *
 * Rink feet: goal lines at x = ±89, posts at y = ±3.
 */
import type { GameStream } from '@domain'
import { playAbsT, streamPeriodBases } from '@domain'

export const GOAL_GEOM = {
  goalX: 89,
  postY: 3,
  /** The drawn puck may cross this far outside the post's centre (the puck's radius and the post's, plus sampling). */
  postTolFt: 0.6,
  /** Most extreme release angle that can see the mouth (deg off straight-on, to the near post's inside edge). */
  maxAngleDeg: 78,
} as const

export interface PuckPoint { t: number; x: number; y: number }

export interface GoalCase { t: number; what: string }

/** Did the puck enter the net at `netX` (±89) from in front between the posts? Points are sorted by t. */
export function crossesMouth(pts: readonly PuckPoint[], netX: number): { ok: boolean; why: string } {
  const a = Math.sign(netX)
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]!
    const q = pts[i]!
    const pa = p.x * a
    const qa = q.x * a
    if (pa < GOAL_GEOM.goalX && qa >= GOAL_GEOM.goalX) {
      const u = (GOAL_GEOM.goalX - pa) / Math.max(qa - pa, 1e-9)
      const y = p.y + (q.y - p.y) * u
      if (Math.abs(y) <= GOAL_GEOM.postY + GOAL_GEOM.postTolFt) return { ok: true, why: `crossed at y ${y.toFixed(1)}` }
      return { ok: false, why: `crossed the goal line ${y.toFixed(1)} ft from centre, outside the post` }
    }
  }
  const behind = pts.find((p) => p.x * a > GOAL_GEOM.goalX && Math.abs(p.y) > GOAL_GEOM.postY + GOAL_GEOM.postTolFt)
  return { ok: false, why: behind ? `came in from behind the goal line (${behind.x.toFixed(0)}, ${behind.y.toFixed(0)})` : 'never seen crossing the goal line' }
}

/** Release angle to the near post's inside edge (deg; 90 = on or behind the goal line). */
export function releaseAngle(x: number, y: number, netX: number): number {
  const a = Math.sign(netX)
  const dx = GOAL_GEOM.goalX - x * a
  if (dx <= 0.5) return 90
  return (Math.atan2(Math.max(0, Math.abs(y) - (GOAL_GEOM.postY - 0.4)), dx) * 180) / Math.PI
}

/**
 * Every goal in a sim stream: released from in front at a seeable angle, and
 * the puck (frames, and the keyframe the engine writes when a shot meets the
 * net) crossing the line between the posts. Shootout / nominal goals (no
 * frames around them) are skipped.
 */
export function judgeGoalGeometry(stream: GameStream): { goals: number; bad: GoalCase[] } {
  const bases = streamPeriodBases(stream)
  const frames: PuckPoint[] = []
  for (const e of stream) if (e.type === 'frame') frames.push({ t: playAbsT(e, bases), x: e.puck.x * 100, y: e.puck.y * 42.5 })
  let goals = 0
  const bad: GoalCase[] = []
  let lastShot: { shooter: string; x: number; y: number; netX: number; t: number } | null = null
  for (const e of stream) {
    if (e.type === 'shot') lastShot = { shooter: e.shooter as string, x: e.from.x * 100, y: e.from.y * 42.5, netX: Math.sign(e.target.x || 1) * GOAL_GEOM.goalX, t: playAbsT(e, bases) }
    if (e.type !== 'goal') continue
    const t = playAbsT(e, bases)
    // a shootout winner (the game shell's nominal goal at centre ice, no shot before it)
    if (!lastShot || t - lastShot.t > 3 || (e.pos.x === 0 && e.pos.y === 0 && e.assists.length === 0)) continue
    // the flight: from the release (its point is the shot's `from`) to just past the goal
    const near = [{ t: lastShot.t, x: lastShot.x, y: lastShot.y }, ...frames.filter((f) => f.t > lastShot!.t + 1e-6 && f.t <= t + 0.3)]
    if (near.length < 2) continue
    goals++
    const clk = `P${e.period} ${Math.floor(Math.max(0, 1200 - e.t) / 60)}:${String(Math.floor(Math.max(0, 1200 - e.t) % 60)).padStart(2, '0')}`
    const ang = releaseAngle(lastShot.x, lastShot.y, lastShot.netX)
    if (ang >= GOAL_GEOM.maxAngleDeg) {
      bad.push({ t, what: `${clk} goal by ${e.scorer}: released at (${lastShot.x.toFixed(0)}, ${lastShot.y.toFixed(0)}), ${ang >= 90 ? 'on or behind the goal line' : `${ang.toFixed(0)}° off straight-on`}` })
      continue
    }
    const path = crossesMouth(near, lastShot.netX)
    if (!path.ok) bad.push({ t, what: `${clk} goal by ${e.scorer}: ${path.why}` })
  }
  return { goals, bad }
}
