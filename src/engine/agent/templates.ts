/**
 * ROLE-POSITION TEMPLATES — where each role wants to be, per situation, as
 * DATA. This is the file the realism scorecard's measured "shape targets" (from
 * public tracking data, coaching-system diagrams) replace: every spot is an
 * offset in the team's ATTACK FRAME relative to the puck, so a measured table
 * can be dropped in without touching agent code.
 *
 * Attack frame: x′ = feet toward the net this team attacks (x′ = x·a, own goal
 * line at −89, attacked goal line at +89); y′ = feet toward the STRONG side
 * (the side the puck is on: y′ = y·side). The puck in that frame is (px′, py′).
 *
 *   target x′ = spot.x + spot.fx · px′     (fx = 0: an absolute spot; fx = 1:
 *   target y′ = spot.y + spot.fy · py′      a fixed offset that moves with the puck)
 *
 * then clamped to [minX, maxX]. Roles are listed in PRIORITY order: a unit with
 * fewer skaters (PK, 3v3) fills the first ones. `pos` biases who takes the role
 * (a D in a forward role costs extra, and vice versa) without forbidding it —
 * a pinching D covered by a forward rotation is real hockey.
 *
 * Attribute variation is applied by the agents (positioning → how precisely
 * and how quickly a player finds his spot), not here.
 */
import type { ForecheckSystem, PenaltyKillFormation, PowerPlayFormation } from '@domain'

export interface RoleSpot {
  role: string
  pos: 'F' | 'D' | 'any'
  x: number
  y: number
  fx: number
  fy: number
  minX?: number | undefined
  maxX?: number | undefined
  /** How hard to skate to hold it (0 drift … 1 sprint). */
  urgency: number
}

const S = (
  role: string,
  pos: RoleSpot['pos'],
  x: number,
  y: number,
  fx: number,
  fy: number,
  urgency: number,
  minX?: number,
  maxX?: number
): RoleSpot => ({ role, pos, x, y, fx, fy, urgency, minX, maxX })

// ---------------------------------------------------------------------------
// With the puck (the carrier is not in the template — these are his support).
// ---------------------------------------------------------------------------

/** Puck in our own zone: breakout support. */
export const BREAKOUT: RoleSpot[] = [
  S('C_LOW', 'F', -58, 8, 0.25, 0.35, 0.6),
  S('W_STRONG', 'F', -48, 36, 0.2, 0, 0.6),
  S('D_PARTNER', 'D', -80, -14, 0.1, 0.2, 0.45),
  S('W_WEAK', 'F', -30, -32, 0.25, 0, 0.55),
  S('D_HIGH', 'D', -60, -24, 0.2, 0, 0.45)
]

/** Puck in the neutral zone: fill three lanes, D trail. */
export const TRANSITION: RoleSpot[] = [
  S('LANE_STRONG', 'F', 12, 30, 1, 0, 0.75, -60, 23),
  S('LANE_WEAK', 'F', 14, -30, 1, 0, 0.75, -60, 23),
  S('LANE_MID', 'F', 4, -6, 1, 0, 0.7, -60, 23),
  S('D_TRAIL_S', 'D', -26, 16, 1, 0, 0.6, -80, 20),
  S('D_TRAIL_W', 'D', -28, -18, 1, 0, 0.6, -80, 20)
]

/** Just entered with speed: drive the net, fill the far lane, trail high. */
export const RUSH: RoleSpot[] = [
  S('NET_DRIVE', 'F', 80, -4, 0, 0, 0.95),
  S('WIDE_LANE', 'F', 62, -24, 0, 0, 0.9),
  S('TRAILER', 'F', 50, 6, 0, 0, 0.8),
  S('D_POINT_S', 'D', 33, 20, 0, 0, 0.7),
  S('D_POINT_W', 'D', 31, -20, 0, 0, 0.7)
]

/** Settled in the zone: low support, net-front, high slot, two points. */
export const CYCLE: RoleSpot[] = [
  S('LOW_SUPPORT', 'F', 50, 12, 0.4, 0.5, 0.55, 60, 96),
  S('NET_FRONT', 'F', 81, -2, 0, 0, 0.5),
  S('POINT_S', 'D', 34, 24, 0.05, 0.2, 0.45, 30, 50),
  S('HIGH_SLOT', 'F', 60, -12, 0, 0.1, 0.5),
  S('POINT_W', 'D', 34, -20, 0.05, 0, 0.45, 30, 50)
]

/** Power-play set-ups (absolute spots in the attack frame, y′ toward the strong side). */
export function powerPlay(f: PowerPlayFormation): RoleSpot[] {
  switch (f) {
    case 'umbrella':
      return [
        S('PP_BUMP', 'F', 82, -3, 0, 0, 0.5),
        S('PP_FLANK_S', 'F', 54, 25, 0, 0, 0.5),
        S('PP_TOP', 'D', 32, 0, 0, 0.15, 0.5),
        S('PP_FLANK_W', 'F', 54, -25, 0, 0, 0.5),
        S('PP_LOW', 'any', 76, 14, 0, 0, 0.5)
      ]
    case '1-3-1':
      return [
        S('PP_NET', 'F', 85, 1, 0, 0, 0.5),
        S('PP_BOLT_S', 'F', 58, 26, 0, 0, 0.5),
        S('PP_MID', 'F', 62, 1, 0, 0, 0.5),
        S('PP_BOLT_W', 'F', 58, -26, 0, 0, 0.5),
        S('PP_POINT', 'D', 32, 0, 0, 0.1, 0.5)
      ]
    default:
      return [
        S('PP_NET', 'F', 82, -6, 0, 0, 0.5),
        S('PP_WALL', 'F', 50, 29, 0, 0, 0.5),
        S('PP_LOW', 'F', 82, 21, 0, 0, 0.5),
        S('PP_POINT', 'D', 33, 9, 0, 0, 0.5),
        S('PP_BACKDOOR', 'any', 80, -12, 0, 0, 0.5)
      ]
  }
}

// ---------------------------------------------------------------------------
// Without the puck. The ON-PUCK role (the man pressuring the carrier) is
// assigned dynamically by the agents; these are everyone else.
// ---------------------------------------------------------------------------

/**
 * Forecheck: the opponent is breaking out of ITS zone (puck at x′ > 25 in our
 * frame). F1 is the on-puck role.
 */
export function forecheck(sys: ForecheckSystem): RoleSpot[] {
  switch (sys) {
    case '2-1-2':
      return [
        S('F2_DEEP', 'F', 76, -12, 0.1, 0.4, 0.8),
        S('F3_HIGH', 'F', 52, 0, 0.1, 0.4, 0.6),
        S('D_STRONG', 'D', 30, 20, 0, 0.2, 0.5),
        S('D_WEAK', 'D', 28, -18, 0, 0, 0.5)
      ]
    case 'trap':
      return [
        S('T_STRONG', 'F', 8, 26, 0, 0, 0.55),
        S('T_MID', 'F', 12, 0, 0, 0.3, 0.55),
        S('T_WEAK', 'F', 6, -26, 0, 0, 0.55),
        S('D_STRONG', 'D', -20, 14, 0, 0.2, 0.5),
        S('D_WEAK', 'D', -22, -14, 0, 0, 0.5)
      ]
    default:
      // 1-2-2
      return [
        S('F2_STRONG', 'F', 60, 26, 0, 0.3, 0.65),
        S('F3_WEAK', 'F', 54, -20, 0, 0.2, 0.6),
        S('D_STRONG', 'D', 30, 18, 0, 0.25, 0.5),
        S('D_WEAK', 'D', 27, -18, 0, 0, 0.5)
      ]
  }
}

/** Opponent carrying through the neutral zone: backcheck lanes + D gap (gap set by agents). */
export const NZ_DEFENSE: RoleSpot[] = [
  S('BC_STRONG', 'F', -8, 24, 0.6, 0, 0.8, -70, 60),
  S('BC_WEAK', 'F', -12, -22, 0.6, 0, 0.8, -70, 60),
  S('D_GAP_S', 'D', -30, 12, 0.55, 0.3, 0.7, -80, 20),
  S('D_GAP_W', 'D', -34, -12, 0.55, 0, 0.7, -80, 20),
  S('BC_MID', 'F', -20, 0, 0.6, 0.2, 0.8, -70, 60)
]

/** Defending our zone, zone coverage (box + 1). */
export const DZ_ZONE: RoleSpot[] = [
  S('D_NET', 'D', -80, -2, 0, 0.15, 0.6),
  S('C_LOW', 'F', -70, 8, 0.1, 0.4, 0.6),
  S('W_STRONG', 'F', -55, 26, 0.05, 0.35, 0.55),
  S('W_WEAK', 'F', -58, -12, 0.05, 0.1, 0.55),
  S('D_STRONG', 'D', -76, 18, 0.1, 0.5, 0.6)
]

/** Penalty kill shapes (4 men; the 3-man kill takes the first three). */
export function penaltyKill(f: PenaltyKillFormation): RoleSpot[] {
  if (f === 'diamond') {
    return [
      S('PK_NET', 'D', -80, 0, 0, 0.1, 0.55),
      S('PK_TOP', 'F', -56, 0, 0, 0.35, 0.55),
      S('PK_SIDE_S', 'any', -70, 18, 0, 0.3, 0.55),
      S('PK_SIDE_W', 'any', -70, -18, 0, 0.1, 0.55)
    ]
  }
  return [
    S('PK_LOW_S', 'D', -78, 10, 0, 0.3, 0.55),
    S('PK_LOW_W', 'D', -78, -10, 0, 0.1, 0.55),
    S('PK_HIGH_S', 'F', -58, 14, 0, 0.35, 0.55),
    S('PK_HIGH_W', 'F', -58, -14, 0, 0.1, 0.55)
  ]
}

/** 3-on-3 overtime: possession game, one high safety. */
export const OT_ATTACK: RoleSpot[] = [
  S('OT_LOW', 'any', 70, -14, 0.2, 0, 0.6),
  S('OT_HIGH', 'any', 30, 0, 0.3, 0.2, 0.55)
]
export const OT_DEFEND: RoleSpot[] = [
  S('OT_SLOT', 'any', -72, 0, 0.1, 0.3, 0.7),
  S('OT_HIGH', 'any', -40, -8, 0.3, 0.2, 0.7)
]

/** Where a role's spot lands on the rink (ft) given the puck and frame. */
export function spotTarget(s: RoleSpot, a: number, side: number, puckX: number, puckY: number): { x: number; y: number } {
  const px = puckX * a
  const py = puckY * side
  let tx = s.x + s.fx * px
  const ty = s.y + s.fy * py
  if (s.minX !== undefined && tx < s.minX) tx = s.minX
  if (s.maxX !== undefined && tx > s.maxX) tx = s.maxX
  return { x: a * tx, y: side * ty }
}
