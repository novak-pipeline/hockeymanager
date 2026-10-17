/**
 * W3 S4 — 5-ON-5 SYSTEMS AS DATA (docs/gameplan-2026-09-28/W3-DESIGN.md item 3).
 *
 * A team runs its coach's PLAYBOOK (engine/league/coachProfile.ts playbookFor:
 * the coach's system with the team's tactics on top). This module holds what
 * each play looks like on the ice, as role tables in the attack frame (the
 * same convention as templates.ts: x′ toward the net the team attacks, y′
 * toward the strong side, spots relative to the puck by fx / fy):
 *
 *   forecheck   2-1-2: F1 and F2 both in deep, F3 high, the strong-side D
 *               pinching down the wall as far as the playbook's pinch.
 *               1-2-2: F1 on the puck, F2 / F3 at the hash marks on the
 *               walls, both D at the blue line.
 *               1-3-1: the neutral-zone trap — F1 steers from the top of the
 *               circles (he does not chase behind the net), three across the
 *               red line, one D back.
 *               1-4: the shell — F1 at their blue line, four across ours.
 *   D zone      zone (box +1), man (the wingers ride their point men), the
 *               collapse (five men inside the house, the points left free).
 *   breakouts   up the strong-side wall, the reverse to the partner behind
 *               the net, the wheel (the D skates it round the net), the
 *               stretch pass to the far-side winger at the red line, the rim.
 *   regroup     controlled (the forwards swing back below the red line to
 *               come again with speed), the stretch (a man held at the far
 *               blue line), dump-and-change.
 *
 * Pure tables and helpers; brain.ts picks them and turns them into jobs.
 */
import type { BreakoutPlan, DZonePlan, ForecheckPlan, Playbook, RegroupPlan } from '@engine/league/coachProfile'
import { BREAKOUT_PLANS } from '@engine/league/coachProfile'
import { BREAKOUT, DZ_ZONE, TRANSITION, forecheck as forecheckSystem, type RoleSpot } from './templates'

const S = (role: string, pos: RoleSpot['pos'], x: number, y: number, fx: number, fy: number, urgency: number, minX?: number, maxX?: number): RoleSpot => ({
  role,
  pos,
  x,
  y,
  fx,
  fy,
  urgency,
  minX,
  maxX
})

const memo = <V>(f: (k: string) => V): ((k: string) => V) => {
  const m = new Map<string, V>()
  return (k: string): V => {
    let v = m.get(k)
    if (v === undefined) {
      v = f(k)
      m.set(k, v)
    }
    return v
  }
}

// ---------------------------------------------------------------------------
// Forecheck (the opponent breaking out of its zone, puck at x′ > 25 for us).
// The ON-PUCK man (F1) is assigned by brain.ts; these are the other four.
// ---------------------------------------------------------------------------

/** 1-4: one man at their blue line (F1, capped there), four across ours. */
const FORECHECK_14: RoleSpot[] = [
  S('P4_S', 'F', -16, 22, 0, 0, 0.6),
  S('P4_W', 'F', -16, -22, 0, 0, 0.6),
  S('D_STRONG', 'D', -36, 12, 0, 0.1, 0.5),
  S('D_WEAK', 'D', -36, -12, 0, 0, 0.5)
]

const forecheckRaw = memo((key: string): RoleSpot[] => {
  const [plan, p] = key.split('|') as [ForecheckPlan, string]
  const pinch = Number(p) / 4
  if (plan === '1-4') return FORECHECK_14
  if (plan === '1-3-1') return forecheckSystem('trap')
  if (plan === '1-2-2') return forecheckSystem('1-2-2')
  // 2-1-2: the strong-side D pinches down the wall, as far as the coach lets him.
  return [
    S('F2_DEEP', 'F', 76, -12, 0.1, 0.4, 0.95),
    S('F3_HIGH', 'F', 50, 0, 0.1, 0.4, 0.65),
    S('D_STRONG', 'D', 30 + pinch * 22, 26, 0, 0.3, 0.55),
    S('D_WEAK', 'D', 26, -12, 0, 0, 0.5)
  ]
})

/** The forecheck shape for a plan (memoized: tables compare by identity, a new one is a re-plan trigger). */
export function forecheckShape(pb: Playbook): RoleSpot[] {
  return forecheckRaw(`${pb.forecheck}|${Math.round(pb.pinch * 4)}`)
}

/**
 * How deep F1 chases the puck on this forecheck (x′ in our attack frame, the
 * goal line at 89). 2-1-2 / 1-2-2: anywhere. The trap's F1 steers from the
 * top of the circles; the shell's sits at their blue line.
 */
export const FORECHECK_CAP: Record<ForecheckPlan, number> = { '2-1-2': Infinity, '1-2-2': Infinity, '1-3-1': 56, '1-4': 27 }

// ---------------------------------------------------------------------------
// D-zone coverage.
// ---------------------------------------------------------------------------

/** The collapse (shell): five men inside the house; the wingers in the high slot, not out at the points. */
export const DZ_COLLAPSE: RoleSpot[] = [
  S('DZ_WD', 'D', -82, -2, 0, 0.1, 0.7),
  S('DZ_F1', 'F', -72, 0, 0, 0.3, 0.7),
  S('DZ_F2', 'F', -62, 12, 0, 0.15, 0.65),
  S('DZ_F3', 'F', -62, -11, 0, 0, 0.65),
  S('DZ_SD', 'D', -80, 0, 0, 0.6, 0.7)
]

/** D-zone shape per coverage (man coverage uses the zone spots as anchors; its marks ride the men). */
export function dZoneShape(plan: DZonePlan): RoleSpot[] {
  return plan === 'collapse' ? DZ_COLLAPSE : DZ_ZONE
}

/**
 * How a coverage man plays an attacker away from the net (beyond 30 ft): the
 * share of the extra distance he sits off him toward the house (PLAN.laneGapK
 * for zone), the cap on that gap (ft), and how far from our net (ft) a man
 * still takes him at all. The collapse leaves the point men and holds the
 * slot. (Man coverage riding the point men tight - gap 5 ft out to 72 ft -
 * was tried and cost 0.5 goals a team-game on the imported league: the slot
 * emptied. Man coverage is the S3 one: every man takes the nearest attacker
 * inside MAN_COVER.pointFt of our net, with the zone's lane gap.)
 */
export const DZ_GAP: Record<DZonePlan, { k: number; cap: number; reach: number }> = {
  zone: { k: 1, cap: 24, reach: Infinity },
  man: { k: 1, cap: 24, reach: Infinity },
  collapse: { k: 2.2, cap: 32, reach: 44 }
}

/** Man coverage: a man takes the nearest attacker inside this distance (ft) of our net, at this urgency. */
export const MAN_COVER = { pointFt: 42, urgency: 0.7 }

/** Every D-zone table (brain.ts: these are the coverage shapes). */
export const DZ_TABLES: ReadonlySet<readonly RoleSpot[]> = new Set([DZ_ZONE, DZ_COLLAPSE])

// ---------------------------------------------------------------------------
// Breakouts (puck in our zone, x′ < −25). Same role names as BREAKOUT (the
// fitted textbook up-the-wall): the D retrieving is the carrier, D_PARTNER is
// his partner (the first D role a short table keeps).
// ---------------------------------------------------------------------------

const BREAKOUTS: Record<BreakoutPlan, RoleSpot[]> = {
  up: BREAKOUT,
  // The reverse: the partner low on the far side beside the net, the centre
  // swinging low on the strong side, the strong winger up the wall.
  reverse: [
    S('C_LOW', 'F', -30, 18, 0.5, 0, 0.85),
    S('W_STRONG', 'F', -54, 37, 0, 0, 0.85),
    S('D_PARTNER', 'D', -84, -13, 0, 0, 0.75),
    S('W_WEAK', 'F', -44, -30, 0, 0, 0.85),
    S('D_HIGH', 'D', -60, -24, 0.2, 0, 0.45)
  ],
  // The wheel: the D skates it round the net and up the strong side; his
  // partner holds the front of the net, the centre high in the middle, both
  // wingers wide and high.
  wheel: [
    S('C_LOW', 'F', -44, 2, 0.4, 0, 0.85),
    S('W_STRONG', 'F', -38, 37, 0.2, 0, 0.85),
    S('D_PARTNER', 'D', -74, -3, 0, 0, 0.7),
    S('W_WEAK', 'F', -28, -30, 0.2, 0, 0.85),
    S('D_HIGH', 'D', -60, -24, 0.2, 0, 0.45)
  ],
  // The stretch: the far-side winger held at the red line (onside: never past
  // their blue line), the centre in the middle, the strong winger on the wall.
  stretch: [
    S('C_LOW', 'F', -28, 6, 0.4, 0, 0.85),
    S('W_STRONG', 'F', -52, 37, 0, 0, 0.85),
    S('D_PARTNER', 'D', -62, -12, 0.3, 0, 0.6),
    S('W_WEAK', 'F', 10, -30, 0, 0, 0.95, -60, 21),
    S('D_HIGH', 'D', -60, -24, 0.2, 0, 0.45)
  ],
  // The rim: the strong winger low on the wall to take it off the boards, the
  // centre high on that side, the weak winger across.
  rim: [
    S('C_LOW', 'F', -46, 22, 0.3, 0, 0.85),
    S('W_STRONG', 'F', -64, 39, 0, 0, 0.85),
    S('D_PARTNER', 'D', -70, -12, 0.2, 0, 0.6),
    S('W_WEAK', 'F', -34, -28, 0.2, 0, 0.85),
    S('D_HIGH', 'D', -60, -24, 0.2, 0, 0.45)
  ]
}

export function breakoutShape(plan: BreakoutPlan): RoleSpot[] {
  return BREAKOUTS[plan]
}

/** The role a breakout looks for first (the carrier's outlet bonus): none for the wheel, it is a carry. */
export const BREAKOUT_OUTLET: Record<BreakoutPlan, string | null> = { up: 'W_STRONG', reverse: 'D_PARTNER', wheel: null, stretch: 'W_WEAK', rim: 'W_STRONG' }

/** Every breakout table. */
export const BREAKOUT_TABLES: ReadonlySet<readonly RoleSpot[]> = new Set(Object.values(BREAKOUTS))

/**
 * The breakout a possession runs: drawn from the playbook's weights with a
 * deterministic hash of the possession (never the sim's RNG: picking a play
 * does not shift any other roll).
 */
export function pickBreakout(pb: Playbook, key: number): BreakoutPlan {
  let tot = 0
  for (const p of BREAKOUT_PLANS) tot += pb.breakout[p]
  if (tot <= 0) return 'up'
  let h = Math.imul((key * 2654435761) >>> 0, 0x9e3779b1) >>> 0
  h ^= h >>> 15
  let r = ((h >>> 0) / 4294967296) * tot
  for (const p of BREAKOUT_PLANS) {
    r -= pb.breakout[p]
    if (r < 0) return p
  }
  return 'up'
}

// ---------------------------------------------------------------------------
// Neutral zone with the puck (x′ in [−25, 25)).
// ---------------------------------------------------------------------------

/**
 * The controlled regroup: the D has it (or the carrier has turned back), and
 * the forwards swing back below the red line across the lanes so they come
 * again with speed; the partner gives him the D-to-D.
 */
export const REGROUP: RoleSpot[] = [
  S('LANE_MID', 'F', -8, 0, 0.3, 0, 0.9, -45, 12),
  S('LANE_WEAK', 'F', -4, -27, 0.2, 0, 0.9, -45, 12),
  S('LANE_STRONG', 'F', -4, 29, 0.2, 0, 0.9, -45, 12),
  S('D_TRAIL_S', 'D', -26, 14, 0.25, 0, 0.7, -70, 0),
  S('D_TRAIL_W', 'D', -30, -16, 0.25, 0, 0.7, -70, 0)
]

/** The stretch: the far-side forward held at their blue line for the long pass (onside). */
export const TRANSITION_STRETCH: RoleSpot[] = [
  S('LANE_MID', 'F', 10, 2, 0.5, 0, 0.9, -60, 23),
  S('LANE_WEAK', 'F', 21, -28, 0, 0, 0.95, -60, 22),
  S('LANE_STRONG', 'F', 14, 32, 0.2, 0, 0.9, -60, 23),
  S('D_TRAIL_S', 'D', -14, 8, 0.35, 0, 0.65, -80, 20),
  S('D_TRAIL_W', 'D', -26, -16, 0.2, 0, 0.65, -80, 20)
]

/** The neutral-zone table with the puck: the regroup when the play has turned back, else the lanes. */
export function transitionShape(plan: RegroupPlan, regrouping: boolean): RoleSpot[] {
  if (regrouping && plan === 'controlled') return REGROUP
  if (plan === 'stretch') return TRANSITION_STRETCH
  return TRANSITION
}

/**
 * The carrier's tilt toward his system (brain.ts decideCarrier). Small next
 * to the option values (a pass in our zone is worth ~0.004–0.009): the play
 * the system calls is preferred among options of about the same value, never
 * forced against a clearly better one. Calibrate.
 */
export const SYSTEM_TILT = {
  /** A pass to the breakout's outlet role. */
  outlet: 0.003,
  /** The wheel: a carry heading up ice out of our zone. */
  wheelCarry: 0.002,
  /** The rim: the chip off the boards up the strong-side wall. */
  rim: 0.003,
  /** Entry style: dump-in value × this (dump) / (carry); mixed = 1. */
  entryDump: 1.2,
  entryCarry: 0.85,
  /** Dump-and-change: dumps in the neutral zone worth this much more. */
  dumpChange: 1.15,
  /** The stretch: a pass to the stretch man (LANE_WEAK on the stretch table). */
  stretch: 0.0025
}

/**
 * Dev switches for the S4 calibration ablations (the measurement harness
 * turns one off at a time to see what it does to goals; never set in play).
 */
export const S4_DEV = { screen: true, boxOut: true, tilts: true, hunt: true, man: true, trapHold: true, tables: true }

/** The short label a frame carries for a side's phase and system (FrameEvent.homeSystem / awaySystem). */
export function systemLabel(table: readonly RoleSpot[] | null, pb: Playbook, breakout: BreakoutPlan | null): string | undefined {
  if (!table) return undefined
  if (BREAKOUT_TABLES.has(table)) return `breakout:${breakout ?? 'up'}`
  if (table === REGROUP) return 'regroup:controlled'
  if (table === TRANSITION_STRETCH) return 'regroup:stretch'
  if (table === TRANSITION) return `regroup:${pb.regroup === 'controlled' ? 'lanes' : pb.regroup}`
  if (DZ_TABLES.has(table)) return `dzone:${pb.dZone}`
  if (table === forecheckShape(pb)) return `forecheck:${pb.forecheck}`
  return undefined
}
