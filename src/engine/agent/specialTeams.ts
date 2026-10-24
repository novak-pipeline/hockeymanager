/**
 * W3 S8 — SPECIAL-TEAMS SYSTEMS AS DATA (docs/gameplan-2026-09-28/W3-DESIGN.md
 * item 3, slice S8).
 *
 * A team runs its playbook's power play and penalty kill (coachProfile.ts
 * playbookFor: the PP set-up and the kill's shape are the team's special-teams
 * tactics, which the coach writes from his system and the GM may change; the
 * entries and how hard it kills are the system's). Same conventions as
 * templates.ts / systems.ts: role tables in the attack frame (x′ toward the
 * net the team attacks, y′ toward the strong side), pure, no sim state.
 *
 *   power play  umbrella  three across the top: the quarterback at the point
 *                         and two flanks at the tops of the circles (the
 *                         weak one is the one-timer), the net-front screen
 *                         and a low man on the strong side;
 *               1-3-1     the quarterback up top, three across the middle -
 *                         the half-wall, the bumper in the slot, the weak-side
 *                         one-timer at the dot - and the net front;
 *               overload  the strong-side triangle (point, half-wall, goal
 *                         line), the net front, and a weak-side man at the
 *                         back door for the pass across.
 *               entries   the drop pass (the carrier leaves it for a man
 *                         coming with speed, who takes it over the line), the
 *                         carry, or dump it into the corner and retrieve
 *                         (both wide men go after it).
 *   penalty kill box       two up, two down, shaded to the puck;
 *               diamond   one up top, two on the sides, one in front;
 *               pressure  passive: the shape holds, the man in whose area the
 *                         puck is contains it from the inside and takes the
 *                         lane; aggressive: he goes at the carrier on the
 *                         perimeter, stick on the puck. Up ice the aggressive
 *                         kill sends a forechecker in; the passive one stands
 *                         up at its blue line.
 *               jobs      the high killer on the puck side takes the shooting
 *                         lane from the point, the weak-side man the seam to
 *                         the one-timer, the low man the net front (box-out);
 *                         clears are the carrier's (carrierTilt penaltyKill);
 *                         a killer with open ice in front of him goes.
 *
 * brain.ts picks the tables and turns them into jobs; agentSim writes the
 * side's label on the frame ("pp:umbrella", "ppentry:drop", "pk:box/passive").
 */
import type { PowerPlayFormation } from '@domain'
import { PK_PRESSURE_AGGRESSIVE, PP_ENTRY_PLANS, type PkShapePlan, type Playbook, type PpEntryPlan } from '@engine/league/coachProfile'
import type { RoleSpot } from './templates'

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

// ---------------------------------------------------------------------------
// Power play in their zone. The first role is the quarterback; the carrier
// stands in one of the five roles (brain.ts vacates the one nearest him).
// ---------------------------------------------------------------------------

export interface PpSystem {
  shape: RoleSpot[]
  /** The weak-side one-timer (the pass across the seam to him is the play; the overload's is at the back door). */
  oneTimer: string
  /** The net-front screen. */
  net: string
  /**
   * Puck movement: from a role, the roles the system moves it to next (the
   * carrier's pass to one of them carries a small tilt, brain.ts). The
   * one-timer feed across the seam is valued on its own (VAL.oneTimerV).
   */
  flow: Readonly<Record<string, readonly string[]>>
}

export const PP_SYSTEMS: Record<PowerPlayFormation, PpSystem> = {
  umbrella: {
    // (shapes.ts ppUmbrella: point 32,4; flanks 51,±29 at the tops of the
    // circles - three across the top - net 84,0; low 72,18)
    shape: [
      S('PP_QB', 'D', 34, 0, 0, 0.15, 0.6),
      S('PP_FLANK_S', 'F', 51, 28, 0, 0, 0.6),
      S('PP_FLANK_W', 'any', 53, -28, 0, 0, 0.6),
      S('PP_NET', 'F', 83, -1, 0, 0, 0.6),
      S('PP_LOW', 'F', 74, 16, 0, 0, 0.6)
    ],
    oneTimer: 'PP_FLANK_W',
    net: 'PP_NET',
    flow: { PP_QB: ['PP_FLANK_S', 'PP_FLANK_W'], PP_FLANK_S: ['PP_QB', 'PP_LOW', 'PP_FLANK_W'], PP_FLANK_W: ['PP_QB', 'PP_FLANK_S'], PP_LOW: ['PP_FLANK_S', 'PP_QB'] }
  },
  '1-3-1': {
    // (shapes.ts pp131: half-wall 62,33; Q 30,2; weak flank 62,-30; bumper 58,0; net 84,0)
    shape: [
      S('PP_QB', 'D', 32, 0, 0, 0.1, 0.6),
      S('PP_HALF', 'F', 64, 30, 0, 0, 0.6),
      S('PP_FLANK_W', 'any', 66, -26, 0, 0, 0.6),
      S('PP_BUMP', 'F', 60, 0, 0, 0.1, 0.6),
      S('PP_NET', 'F', 84, 0, 0, 0, 0.6)
    ],
    oneTimer: 'PP_FLANK_W',
    net: 'PP_NET',
    flow: { PP_QB: ['PP_HALF', 'PP_FLANK_W'], PP_HALF: ['PP_BUMP', 'PP_QB', 'PP_NET', 'PP_FLANK_W'], PP_FLANK_W: ['PP_QB', 'PP_BUMP'], PP_BUMP: ['PP_FLANK_W', 'PP_HALF'] }
  },
  overload: {
    // (shapes.ts ppOverload: point 36,20; half-wall 57,33; goal line 81,25; net 83,-3; back door 76,-15)
    shape: [
      S('PP_QB', 'D', 36, 18, 0, 0, 0.6),
      S('PP_HALF', 'F', 57, 33, 0, 0, 0.6),
      S('PP_LOW', 'F', 80, 25, 0, 0, 0.6),
      S('PP_NET', 'F', 83, -3, 0, 0, 0.6),
      S('PP_FLANK_W', 'any', 76, -15, 0, 0, 0.6)
    ],
    oneTimer: 'PP_FLANK_W',
    net: 'PP_NET',
    flow: { PP_QB: ['PP_HALF', 'PP_FLANK_W'], PP_HALF: ['PP_LOW', 'PP_QB', 'PP_NET'], PP_LOW: ['PP_HALF', 'PP_NET'], PP_FLANK_W: ['PP_QB'] }
  }
}

/** Every power-play zone table (brain.ts: the carrier vacates the nearest role of these). */
export const PP_TABLES: ReadonlySet<readonly RoleSpot[]> = new Set(Object.values(PP_SYSTEMS).map((s) => s.shape))

export function ppShape(f: PowerPlayFormation): RoleSpot[] {
  return (PP_SYSTEMS[f] ?? PP_SYSTEMS.umbrella).shape
}

/** The system a PP table belongs to. */
export function ppSystemOf(table: readonly RoleSpot[] | null): PpSystem | null {
  if (!table) return null
  for (const s of Object.values(PP_SYSTEMS)) if (s.shape === table) return s
  return null
}

// ---------------------------------------------------------------------------
// Power play up the ice (the puck outside their zone, ours): the entry.
// ---------------------------------------------------------------------------

/**
 * The drop: a forward trails the carrier a stride behind and to his side (he
 * takes the drop with speed and carries it over the line), both wide men at
 * the walls on their blue line, the D trailing. The carry: the middle man
 * drives with him instead. The dump: both wide men at the line, ready to go
 * in after it. Onside discipline (the wide men never over the line ahead of
 * the puck) is brain.ts's, as at 5-on-5.
 */
const PP_ENTRY: Record<PpEntryPlan, RoleSpot[]> = {
  drop: [
    S('PPE_DROP', 'F', -9, -5, 1, 0.5, 0.95, -60, 18),
    S('PPE_WIDE_S', 'F', 17, 31, 0.1, 0, 0.9, -40, 21),
    S('PPE_WIDE_W', 'F', 17, -30, 0.1, 0, 0.9, -40, 21),
    S('PPE_TRAIL', 'D', -24, -8, 0.6, 0, 0.7, -80, 10)
  ],
  carry: [
    S('PPE_MID', 'F', 6, -7, 0.4, 0, 0.9, -40, 21),
    S('PPE_WIDE_S', 'F', 17, 31, 0.1, 0, 0.9, -40, 21),
    S('PPE_WIDE_W', 'F', 17, -30, 0.1, 0, 0.9, -40, 21),
    S('PPE_TRAIL', 'D', -24, -8, 0.6, 0, 0.7, -80, 10)
  ],
  dump: [
    S('PPE_WIDE_S', 'F', 19, 33, 0.1, 0, 0.95, -40, 21),
    S('PPE_WIDE_W', 'F', 19, -30, 0.1, 0, 0.95, -40, 21),
    S('PPE_MID', 'F', 10, 2, 0.4, 0, 0.9, -40, 21),
    S('PPE_TRAIL', 'D', -24, -8, 0.6, 0, 0.7, -80, 10)
  ]
}

export function ppEntryShape(e: PpEntryPlan): RoleSpot[] {
  return PP_ENTRY[e]
}

export const PP_ENTRY_TABLES: ReadonlySet<readonly RoleSpot[]> = new Set(Object.values(PP_ENTRY))

/** The entry a power-play rush runs: drawn from the playbook's weights with a hash of the possession (never the sim's RNG). */
export function pickPpEntry(pb: Playbook, key: number): PpEntryPlan {
  let tot = 0
  for (const p of PP_ENTRY_PLANS) tot += pb.ppEntry[p]
  if (tot <= 0) return 'carry'
  let h = Math.imul((key * 2246822519) >>> 0, 0x85ebca6b) >>> 0
  h ^= h >>> 13
  let r = ((h >>> 0) / 4294967296) * tot
  for (const p of PP_ENTRY_PLANS) {
    r -= pb.ppEntry[p]
    if (r < 0) return p
  }
  return 'carry'
}

// ---------------------------------------------------------------------------
// Penalty kill in our zone (4 men; the 5-on-3 kill keeps templates.ts PK_TRIANGLE).
// ---------------------------------------------------------------------------

export interface PkSystem {
  shape: RoleSpot[]
  /** The man whose job is the shooting lane from the point (the high man on the puck side). */
  lane: string
  /** The man on the seam to their one-timer (the weak-side high man). */
  seam: string
}

export const PK_SYSTEMS: Record<PkShapePlan, PkSystem> = {
  // (shapes.ts pp131 defend: F strong 52,22; F weak 46,-10; D strong low 78,12; D weak net 80,-8)
  box: {
    shape: [
      S('PK_LOW_W', 'D', -80, -7, 0, 0.1, 0.65),
      S('PK_LOW_S', 'D', -78, 9, 0, 0.25, 0.65),
      S('PK_HIGH_S', 'F', -55, 15, 0, 0.3, 0.65),
      S('PK_HIGH_W', 'F', -51, -10, 0, 0.15, 0.65)
    ],
    lane: 'PK_HIGH_S',
    seam: 'PK_HIGH_W'
  },
  // (shapes.ts ppUmbrella defend: top 45,2; sides 64,±18; bottom 82,0)
  diamond: {
    shape: [
      S('PK_NET', 'D', -82, 0, 0, 0.1, 0.65),
      S('PK_SIDE_S', 'any', -64, 18, 0, 0.2, 0.65),
      S('PK_TOP', 'F', -46, 1, 0, 0.3, 0.65),
      S('PK_SIDE_W', 'any', -64, -18, 0, 0.1, 0.65)
    ],
    lane: 'PK_TOP',
    seam: 'PK_SIDE_W'
  }
}

export const PK_TABLES: ReadonlySet<readonly RoleSpot[]> = new Set(Object.values(PK_SYSTEMS).map((s) => s.shape))

export function pkShape(p: PkShapePlan): RoleSpot[] {
  return PK_SYSTEMS[p].shape
}

export function pkSystemOf(table: readonly RoleSpot[] | null): PkSystem | null {
  if (!table) return null
  for (const s of Object.values(PK_SYSTEMS)) if (s.shape === table) return s
  return null
}

/**
 * Up ice (their power play has it in its own zone or the neutral zone). The
 * aggressive kill sends its forechecker in (the presser, brain.ts) with the
 * second forward high in the middle; the passive kill stands up at its blue
 * line: both forwards across it, both D behind them.
 */
export const PK_UP_PRESS: RoleSpot[] = [
  S('PKU_F1', 'F', 40, 0, 0.5, 0.5, 0.8, -40, 80),
  S('PKU_D_S', 'D', -32, 13, 0, 0.2, 0.7, -80, 0),
  S('PKU_D_W', 'D', -34, -12, 0, 0.1, 0.7, -80, 0),
  S('PKU_F2', 'F', 6, 0, 0.25, 0.4, 0.75, -40, 40)
]
export const PK_UP_STACK: RoleSpot[] = [
  S('PKU_D_S', 'D', -40, 11, 0, 0.2, 0.7, -80, -20),
  S('PKU_D_W', 'D', -42, -11, 0, 0.1, 0.7, -80, -20),
  S('PKU_F_S', 'F', -22, 19, 0, 0.25, 0.75, -60, -10),
  S('PKU_F_W', 'F', -22, -19, 0, 0.1, 0.75, -60, -10)
]
export const PK_UP_TABLES: ReadonlySet<readonly RoleSpot[]> = new Set([PK_UP_PRESS, PK_UP_STACK])

/** The kill's presser: how far up ice (x′ in our attack frame) he goes after their carrier - the aggressive kill anywhere, the passive one to the red line. */
export function pkPresserCap(pb: Playbook): number {
  return pb.pkPressure >= PK_PRESSURE_AGGRESSIVE ? Infinity : 0
}

/**
 * How the kill's man on the puck plays a carrier in our zone (brain.ts): the
 * gap he keeps from the inside (ft) on a carrier on the perimeter (more than
 * `perimeterFt` from our net) by pressure, and how close he closes on one
 * who is vulnerable or inside it. The passive kill only goes at the puck in
 * his own area (`areaFt` from his role spot); otherwise the shape holds.
 */
export const PK_PLAY = { perimeterFt: 32, gapPassive: 13, gapAggressive: 3.4, close: 3.2, areaFt: 18, areaAggressiveFt: 32, laneK: 0.38, seamK: 0.5, seamMinX: 45 }

/** The label a frame carries for a side on special teams (FrameEvent.homeSystem / awaySystem). */
export function specialLabel(table: readonly RoleSpot[] | null, pb: Playbook, entry: PpEntryPlan | null): string | undefined {
  if (!table) return undefined
  if (PP_TABLES.has(table)) return `pp:${pb.pp}`
  if (PP_ENTRY_TABLES.has(table)) return `ppentry:${entry ?? 'carry'}`
  if (PK_TABLES.has(table) || PK_UP_TABLES.has(table)) return `pk:${pb.pk}/${pb.pkPressure >= PK_PRESSURE_AGGRESSIVE ? 'aggressive' : 'passive'}`
  return undefined
}

/**
 * The carrier's tilt toward his special-teams play (brain.ts decideCarrier),
 * small next to the option values like systems.ts SYSTEM_TILT: preferred
 * among options of about the same value, never forced against a clearly
 * better one. Calibrate.
 */
export const ST_TILT = {
  /** A pass to the role the PP's puck movement goes to next. */
  flow: 0.003,
  /** The drop: the pass to the trailing man in the neutral zone. */
  drop: 0.01,
  /** The dump entry: its dump-in value × this; the other entries / this. */
  dump: 2.2,
  /** The carry entry (and the drop man once he has it): carries × this. */
  carry: 1.15,
  /** A killer with open ice ahead of him (one of theirs or none goal-side): the kill's carry / shot cut is lifted by this share. */
  shOpen: 1
}

/**
 * Dev switches for the S8 ablations (teamPlay.measure TP_ABLATE=s8 turns them
 * all off; never set in play). `glide` is the reel S7 VT18 fix (agentSim
 * checkOffside: a man the puck is still sliding to is not yet its carrier).
 */
export const S8_DEV = { pp: true, entry: true, pk: true, pkUp: true, flow: true, lanes: true, shRush: true, glide: true }
