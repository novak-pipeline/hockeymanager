/**
 * W3 slice S1 — INTENT AND COVERAGE (docs/gameplan-2026-09-28/W3-DESIGN.md §2 item 2).
 *
 * Every skater holds a PLAN: a role in the team's current shape and the JOB he
 * executes in it ("puck": on the carrier; "chase": racing a loose puck;
 * "mark": covering one attacker; "twoOnOne": the one man back on an odd-man
 * rush, playing the pass; "lane": stepping into a shooting lane; "support":
 * getting open for the carrier; "screen": the net-front man; "spot": holding
 * a zone spot; "change": skating to the bench).
 *
 * The 0.25 s think no longer re-decides everything. It checks TRIGGERS — the
 * possession side, the puck crossing a line (with a few feet of hysteresis),
 * the carrier/receiver changing, the men in the pool changing (a line change,
 * a man taking the puck), a man lost far from his job — and only then
 * re-assigns roles. Between triggers a man keeps his role and executes his job
 * (whose target follows the puck and his mark continuously).
 *
 * Jobs are CLAIMED: the carrier belongs to one man (the presser); every other
 * attacker to at most one man. A mark is only replaced by a better one (by
 * PLAN.markMargin ft) after it has been held PLAN.markHoldS seconds.
 *
 * Only decides what a man is doing; brain.ts turns it into a target.
 */
import type { Body } from './physics'
import type { RoleSpot } from './templates'
import type { BreakoutPlan } from '@engine/league/coachProfile'

export type JobKind = 'puck' | 'chase' | 'mark' | 'lane' | 'twoOnOne' | 'support' | 'screen' | 'spot' | 'change' | 'carry'

export interface Plan {
  role: string
  job: JobKind
  /** The attacker he covers (job "mark"). */
  mark: Body | null
  /** When this job (and mark) began. */
  since: number
  /** Support: the get-open offset he is skating to (ft, rink frame) and when it was picked. */
  open: { dx: number; dy: number; at: number } | null
  /** Exit test: since when he has been far from his job's target (-1: he is not). */
  lostSince: number
  /** Idle test: where and since when he has been standing (support men). */
  stillX: number
  stillY: number
  stillSince: number
}

/** One side's shape state: what was planned, and the sticky decisions. */
export interface TeamPlan {
  /** Trigger key of the last re-plan (possession · shape · carrier · pool). */
  key: string
  /** The strong side (sign of the puck's y), sticky across the middle. */
  strong: number
  /** The shape table in use (sticky across line thresholds). */
  table: readonly RoleSpot[] | null
  /** Clock time of the last re-plan. */
  at: number
  /** Force a re-plan at the next think (an exit test failed). */
  force: boolean
  /** The man racing the loose puck (kept unless another man is clearly first). */
  chaser: Body | null
  /** W3 S4: the breakout this possession runs (systems.ts), drawn once per possession. */
  breakout: { plan: BreakoutPlan; poss: number } | null
}

/** Tunables (design; tuned on the target-flips metric and the VT13/VT14 detectors). */
export const PLAN = {
  /** The strong side flips only once the puck is this far (ft) across the middle. */
  strongFlipFt: 6,
  /** A shape threshold (blue line, red line, top of the circles) must be passed by this much (ft). */
  lineHyst: 3,
  /** A new mark must be this much cheaper (ft)… */
  markMargin: 8,
  /** …and the current one held this long (s). */
  markHoldS: 1,
  /** Zone coverage: a role covers attackers this close (ft) to its spot. */
  zoneArea: 24,
  /** The net-front role's area is the whole house. */
  netArea: 28,
  /** The man closest to their carrier, inside this range (ft), takes the puck. */
  engageFt: 10,
  /** Exit test: this far (ft) from his job's target for this long (s) → re-plan. */
  lostFt: 35,
  lostS: 1.5,
  /** Support get-open: candidate step (ft), switch margin (score), minimum hold (s). */
  openStep: 7,
  openMargin: 2,
  openHoldS: 1.2,
  /** Support: a man standing this long (s) moves on to his next-best open ice. */
  supportIdleS: 0.8,
  /** Support: skating to new open ice at least this urgently (0..1; ≥ 0.85 skips the shape-lag smoothing). */
  supportUrgency: 0.9,
  /** Coverage: a spare man standing this long (s) in front of his net picks up a free attacker. */
  idleS: 1,
  /** Zone coverage: a man covering an attacker beyond 30 ft of our net sits this share of the extra distance off him, in his lane toward the house. */
  laneGapK: 0.6,
  /** Idle exit: a defender standing in front of his net picks up a free attacker this close (ft). */
  pickUpFt: 25,
  /** A man keeps his mark this far (ft) past the radius he would take him at (exit > entry). */
  areaExitFt: 8,
  /** Zone coverage: an attacker this close (ft) to the man stays his, wherever his area is. */
  onManFt: 12,
  /** A loose-puck chaser keeps the race unless another man is first by this much (s). */
  chaseKeepS: 0.25,
  /** Their pass: a man who gets there within this much (s) of their receiver still contests it; later than that he plays the man. */
  contestS: 0.35
}

export function newTeamPlan(): TeamPlan {
  return { key: '', strong: 1, table: null, at: -99, force: false, chaser: null, breakout: null }
}

/** The plan for `b` (created on first use: a new man has no plan → a trigger). */
export function planOf(plans: Map<Body, Plan>, b: Body, t: number): Plan {
  let p = plans.get(b)
  if (!p) {
    p = { role: '', job: 'spot', mark: null, since: t, open: null, lostSince: -1, stillX: b.x, stillY: b.y, stillSince: t }
    plans.set(b, p)
  }
  return p
}

/** Set a man's job; the clock restarts only when the job or the mark changes. */
export function setJob(plans: Map<Body, Plan>, b: Body, t: number, job: JobKind, mark: Body | null = null, role?: string): Plan {
  const p = planOf(plans, b, t)
  if (p.job !== job || p.mark !== mark) {
    p.job = job
    p.mark = mark
    p.since = t
    if (job !== 'support') p.open = null
  }
  if (role !== undefined) p.role = role
  return p
}

/** The short job name the frame carries ("mark:<id>" names the man covered). */
export function jobName(p: Plan): string {
  return p.job === 'mark' && p.mark ? `mark:${p.mark.player.id}` : p.job
}
