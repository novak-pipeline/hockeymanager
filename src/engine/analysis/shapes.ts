/**
 * SHAPE TARGETS — role-position templates for the standard team systems, and
 * the shape-similarity measure the scorecard runs against them.
 *
 * Why templates and not tracking data: no frame-level hockey tracking dataset
 * is licensed for commercial use (Stathletes' Big Data Cup is research-only;
 * see docs/MATCH-DATA-SOURCES.md). The next-best legal ground truth for "what
 * hockey LOOKS like" is the coaching canon every team system is taught from.
 * These coordinates are OUR OWN diagrams of those systems (1-2-2 forecheck,
 * up-the-wall breakout, low cycle vs box+1, NZ regroup vs 1-2-2, 3-lane rush,
 * 1-3-1 / umbrella PP vs box / diamond PK). Concepts were checked against
 * public coaching resources (USA Hockey coaching-education team-play material,
 * Hockey Canada coach-development "team systems" material, and standard
 * coaching texts); no diagram, figure or text was copied.
 *
 * Coordinate frame (every template): feet, origin centre ice, +X toward the net
 * the POSSESSING team attacks (goal line x = 89, blue lines x = ±25), and the
 * puck side mirrored to +Y. Each template is a SNAPSHOT: "when the puck is
 * here, in this situation, the ten skaters stand about here".
 *
 * Similarity: a sim frame matches a template when the possessing team, the
 * strength (skater counts) and the puck location (within `radiusFt`) agree.
 * Skaters are assigned to template roles by optimal assignment (min total
 * distance, ≤ 6! permutations), and the mean assigned distance is the frame's
 * SHAPE ERROR in feet. Lower = closer to the textbook picture. Real NHL play
 * deviates from a textbook too, so the pass band is generous (see targets).
 */
import type { XY } from '@domain'

export type ShapeStrength = '5v5' | '5v4'

export interface RolePoint {
  role: string
  x: number
  y: number
}

export interface ShapeTemplate {
  id: string
  label: string
  /** The system(s) the two units are running. */
  system: string
  strength: ShapeStrength
  /** Puck location (ft, attack frame, puck side +Y). */
  puck: XY
  /** A frame matches when its puck is within this many feet of `puck`. */
  radiusFt: number
  /** The possessing team's skaters. */
  attack: RolePoint[]
  /** The defending team's skaters (same frame). */
  defend: RolePoint[]
}

export const SHAPE_TEMPLATES: readonly ShapeTemplate[] = [
  {
    id: 'breakoutWall',
    label: 'Breakout up the wall vs 1-2-2 forecheck',
    system: 'D retrieval, wall-side winger on the half-wall, C swinging low; forecheck 1-2-2',
    strength: '5v5',
    puck: { x: -84, y: 26 },
    radiusFt: 14,
    attack: [
      { role: 'D1 (puck)', x: -84, y: 26 },
      { role: 'D2 (net-side support)', x: -84, y: -10 },
      { role: 'strong W (half-wall)', x: -56, y: 37 },
      { role: 'C (low swing)', x: -70, y: 6 },
      { role: 'weak W (mid-lane stretch)', x: -38, y: -22 }
    ],
    defend: [
      { role: 'F1 (pressure)', x: -76, y: 21 },
      { role: 'F2 (strong-side wall)', x: -56, y: 27 },
      { role: 'F3 (high middle)', x: -44, y: -10 },
      { role: 'D strong (hold line)', x: -28, y: 26 },
      { role: 'D weak (hold line)', x: -24, y: -14 }
    ]
  },
  {
    id: 'ozLowCycle',
    label: 'Low cycle vs box+1 zone coverage',
    system: 'F1 on the wall low, F2 low support, F3 net-front, D at the points; box+1 D-zone',
    strength: '5v5',
    puck: { x: 80, y: 30 },
    radiusFt: 14,
    attack: [
      { role: 'F1 (puck, wall low)', x: 80, y: 30 },
      { role: 'F2 (low support)', x: 70, y: 14 },
      { role: 'F3 (net-front)', x: 82, y: -2 },
      { role: 'D strong (point)', x: 30, y: 32 },
      { role: 'D weak (point)', x: 30, y: -18 }
    ],
    defend: [
      { role: 'D strong (on puck)', x: 82, y: 24 },
      { role: 'D weak (net-front)', x: 80, y: -2 },
      { role: 'C (low strong side)', x: 70, y: 12 },
      { role: 'W strong (point lane)', x: 42, y: 28 },
      { role: 'W weak (high slot)', x: 52, y: -10 }
    ]
  },
  {
    id: 'ozPointShot',
    label: 'Point possession vs collapsing box',
    system: 'D walks the line, net-front screen, wall and weak-side low support; wingers take point lanes',
    strength: '5v5',
    puck: { x: 30, y: 28 },
    radiusFt: 12,
    attack: [
      { role: 'D strong (puck)', x: 30, y: 28 },
      { role: 'D weak (point)', x: 32, y: -12 },
      { role: 'F net-front', x: 84, y: 0 },
      { role: 'F strong wall', x: 60, y: 37 },
      { role: 'F weak low', x: 74, y: -22 }
    ],
    defend: [
      { role: 'W strong (pressure point)', x: 42, y: 24 },
      { role: 'W weak (lane)', x: 46, y: -14 },
      { role: 'C (slot)', x: 68, y: 4 },
      { role: 'D strong (low)', x: 78, y: 14 },
      { role: 'D weak (net-front)', x: 82, y: -6 }
    ]
  },
  {
    id: 'nzRegroup',
    label: 'Neutral-zone regroup vs 1-2-2',
    system: 'D-to-D regroup, forwards swinging with speed across the lanes; 1-2-2 neutral-zone forecheck',
    strength: '5v5',
    puck: { x: -20, y: 12 },
    radiusFt: 14,
    attack: [
      { role: 'D1 (puck)', x: -20, y: 12 },
      { role: 'D2 (partner)', x: -24, y: -18 },
      { role: 'W strong (swing wide)', x: 10, y: 32 },
      { role: 'C (middle)', x: 0, y: 2 },
      { role: 'W weak (swing wide)', x: 10, y: -30 }
    ],
    defend: [
      { role: 'F1 (steer)', x: 2, y: 8 },
      { role: 'F2 (strong lane)', x: 16, y: 25 },
      { role: 'F3 (weak lane)', x: 16, y: -25 },
      { role: 'D strong (gap)', x: 40, y: 14 },
      { role: 'D weak (gap)', x: 40, y: -14 }
    ]
  },
  {
    id: 'rushEntry',
    label: 'Three-lane rush entering vs 2 D + backcheck',
    system: 'Wide-lane carrier, middle-lane drive to the net, far-lane driver, trailer; D gap up, F backcheck',
    strength: '5v5',
    puck: { x: 24, y: 22 },
    radiusFt: 12,
    attack: [
      { role: 'F carrier (wide lane)', x: 24, y: 22 },
      { role: 'F middle-lane drive', x: 22, y: 0 },
      { role: 'F far-lane drive', x: 18, y: -26 },
      { role: 'D trailer', x: -6, y: 6 },
      { role: 'D back', x: -22, y: -10 }
    ],
    defend: [
      { role: 'D strong (gap)', x: 40, y: 16 },
      { role: 'D weak (middle)', x: 42, y: -6 },
      { role: 'F backcheck (middle)', x: 14, y: 6 },
      { role: 'F backcheck (weak)', x: 4, y: -18 },
      { role: 'F late (strong)', x: -8, y: 20 }
    ]
  },
  {
    id: 'pp131',
    label: 'Power play 1-3-1 vs PK box',
    system: 'Half-wall flank, top (Q), weak-side one-timer flank, bumper, net-front; 4-man box shading strong side',
    strength: '5v4',
    puck: { x: 62, y: 33 },
    radiusFt: 14,
    attack: [
      { role: 'flank (puck, half-wall)', x: 62, y: 33 },
      { role: 'Q (top)', x: 30, y: 2 },
      { role: 'flank weak (one-timer)', x: 62, y: -30 },
      { role: 'bumper (high slot)', x: 58, y: 0 },
      { role: 'net-front', x: 84, y: 0 }
    ],
    defend: [
      { role: 'F strong (pressure)', x: 52, y: 22 },
      { role: 'F weak (seam)', x: 46, y: -10 },
      { role: 'D strong (low)', x: 78, y: 12 },
      { role: 'D weak (net-front)', x: 80, y: -8 }
    ]
  },
  {
    id: 'ppUmbrella',
    label: 'Power play umbrella vs PK diamond',
    system: 'Three across the top (point + two flanks), net-front, low bumper; diamond PK',
    strength: '5v4',
    puck: { x: 32, y: 4 },
    radiusFt: 12,
    attack: [
      { role: 'point (puck)', x: 32, y: 4 },
      { role: 'flank strong', x: 40, y: 30 },
      { role: 'flank weak', x: 40, y: -30 },
      { role: 'net-front', x: 84, y: 0 },
      { role: 'low bumper', x: 72, y: 18 }
    ],
    defend: [
      { role: 'top of diamond', x: 45, y: 2 },
      { role: 'side strong', x: 64, y: 18 },
      { role: 'side weak', x: 64, y: -18 },
      { role: 'bottom (net-front)', x: 82, y: 0 }
    ]
  }
]

/** Optimal assignment of `pts` onto `roles` (≤ 6 each). Returns mean distance and per-role offsets. */
export function assignShape(
  pts: readonly XY[],
  roles: readonly RolePoint[]
): { meanFt: number; offsets: XY[] } | null {
  const n = roles.length
  if (pts.length !== n || n === 0 || n > 6) return null
  const cost: number[][] = pts.map((p) => roles.map((r) => Math.hypot(p.x - r.x, p.y - r.y)))
  let best = Infinity
  let bestPerm: number[] = []
  const perm: number[] = []
  const used = new Array<boolean>(n).fill(false)
  const rec = (i: number, acc: number): void => {
    if (acc >= best) return
    if (i === n) {
      best = acc
      bestPerm = perm.slice()
      return
    }
    for (let j = 0; j < n; j++) {
      if (used[j]) continue
      used[j] = true
      perm.push(j)
      rec(i + 1, acc + cost[i][j])
      perm.pop()
      used[j] = false
    }
  }
  rec(0, 0)
  // offsets[roleIdx] = sim point - template point
  const offsets: XY[] = roles.map(() => ({ x: 0, y: 0 }))
  bestPerm.forEach((roleIdx, ptIdx) => {
    offsets[roleIdx] = { x: pts[ptIdx].x - roles[roleIdx].x, y: pts[ptIdx].y - roles[roleIdx].y }
  })
  return { meanFt: best / n, offsets }
}

/** Accumulated similarity for one template (additive across games). */
export interface ShapeAccum {
  frames: number
  attackErrSum: number
  defendErrSum: number
  /** Per-role summed offsets (sim − template), attack roles then defend roles. */
  attackOffsets: XY[]
  defendOffsets: XY[]
}

export function emptyShapeAccum(t: ShapeTemplate): ShapeAccum {
  return {
    frames: 0,
    attackErrSum: 0,
    defendErrSum: 0,
    attackOffsets: t.attack.map(() => ({ x: 0, y: 0 })),
    defendOffsets: t.defend.map(() => ({ x: 0, y: 0 }))
  }
}

export function mergeShapeAccum(into: ShapeAccum, from: ShapeAccum): void {
  into.frames += from.frames
  into.attackErrSum += from.attackErrSum
  into.defendErrSum += from.defendErrSum
  from.attackOffsets.forEach((o, i) => {
    into.attackOffsets[i].x += o.x
    into.attackOffsets[i].y += o.y
  })
  from.defendOffsets.forEach((o, i) => {
    into.defendOffsets[i].x += o.x
    into.defendOffsets[i].y += o.y
  })
}

/**
 * Score one situation snapshot against every matching template. Inputs are in
 * the possessing team's attack frame (feet), NOT yet mirrored; the puck side is
 * mirrored to +Y here.
 */
export function scoreShapes(
  puck: XY,
  attack: readonly XY[],
  defend: readonly XY[],
  accums: Record<string, ShapeAccum>,
  templates: readonly ShapeTemplate[] = SHAPE_TEMPLATES
): void {
  const flip = puck.y < 0 ? -1 : 1
  const pk = { x: puck.x, y: puck.y * flip }
  const strength: ShapeStrength | null =
    attack.length === 5 && defend.length === 5 ? '5v5' : attack.length === 5 && defend.length === 4 ? '5v4' : null
  if (!strength) return
  for (const t of templates) {
    if (t.strength !== strength) continue
    if (Math.hypot(pk.x - t.puck.x, pk.y - t.puck.y) > t.radiusFt) continue
    const a = attack.map((p) => ({ x: p.x, y: p.y * flip }))
    const d = defend.map((p) => ({ x: p.x, y: p.y * flip }))
    const ra = assignShape(a, t.attack)
    const rd = assignShape(d, t.defend)
    if (!ra || !rd) continue
    const acc = (accums[t.id] ??= emptyShapeAccum(t))
    acc.frames++
    acc.attackErrSum += ra.meanFt
    acc.defendErrSum += rd.meanFt
    ra.offsets.forEach((o, i) => {
      acc.attackOffsets[i].x += o.x
      acc.attackOffsets[i].y += o.y
    })
    rd.offsets.forEach((o, i) => {
      acc.defendOffsets[i].x += o.x
      acc.defendOffsets[i].y += o.y
    })
  }
}
