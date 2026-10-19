/**
 * W3 S7 — THE PLAY'S FOCUS (docs/gameplan-2026-09-28/W3-DESIGN.md item 7).
 *
 * Where the play is about to be, published on every live frame for the
 * camera (FrameEvent.focus). The sim knows things the picture cannot: the man
 * a pass is going to, where a rim or a dump will come off the boards (the S6
 * puck path), which way the carrier is skating. A camera that leads with this
 * point starts its pan before the puck arrives and never has to whip after it.
 *
 * The point is the lead of the puck (the carrier's next stride, the pass
 * target, or the free puck's predicted spot) pulled a little toward the
 * play's centre of gravity (the skaters near the puck), so a cycle along one
 * wall still frames the men coming to it.
 *
 * Read-only: it never touches the sim's state or its random numbers (the
 * predictor steps a COPY of the puck; the physics' last-contact note is put
 * back), so the stream is the same with or without it apart from the field.
 */
import { stepPuck, lastPuckContact, type Puck } from './physics'
import { HALF_X, HALF_Y } from './rink'

export const FOCUS = {
  /** How far ahead the carrier is led (s of his own skating). */
  carryLeadS: 0.6,
  /** A free puck: where the predictor puts it this far ahead (s). */
  freeLeadS: 0.6,
  /** A pass: the receiver led this far along his skating (s). */
  passLeadS: 0.3,
  /** Weight of the play's centre of gravity in the focus. */
  centroidW: 0.2,
  /** Skaters this far from the lead point count fully toward the centroid (ft, gaussian sigma). */
  centroidSigma: 35,
  /** The focus stays this far inside the boards (ft). */
  inset: 4,
} as const

interface Mover { x: number; y: number; vx: number; vy: number }

export interface FocusInput {
  puck: Readonly<Pick<Puck, 'x' | 'y' | 'z' | 'vx' | 'vy' | 'vz'>>
  /** The man with the puck (null = free or in flight). */
  carrier: Mover | null
  /** The man a pass in flight is going to. */
  passTo: Mover | null
  /** Every skater on the ice (both sides). */
  skaters: readonly Mover[]
}

/** The free puck `t` seconds ahead (a copy stepped by the sim's own physics). */
function freeAhead(p: FocusInput['puck'], t: number): { x: number; y: number } {
  const saved = lastPuckContact.c
  const q: Puck = { x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, carrier: null }
  const dt = 0.05
  for (let s = dt; s <= t + 1e-9; s += dt) {
    if (stepPuck(q, dt) === 'outOfPlay') break
  }
  lastPuckContact.c = saved
  return { x: q.x, y: q.y }
}

/** The focus point in rink feet (x along the ice, y across). */
export function playFocus(inp: FocusInput): { x: number; y: number } {
  let lead: { x: number; y: number }
  if (inp.carrier) {
    const c = inp.carrier
    lead = { x: c.x + c.vx * FOCUS.carryLeadS, y: c.y + c.vy * FOCUS.carryLeadS }
  } else if (inp.passTo) {
    const r = inp.passTo
    lead = { x: r.x + r.vx * FOCUS.passLeadS, y: r.y + r.vy * FOCUS.passLeadS }
  } else {
    lead = freeAhead(inp.puck, FOCUS.freeLeadS)
  }
  let sw = 0
  let gx = 0
  let gy = 0
  for (const s of inp.skaters) {
    const d2 = (s.x - lead.x) ** 2 + (s.y - lead.y) ** 2
    const w = Math.exp(-d2 / (2 * FOCUS.centroidSigma ** 2))
    sw += w
    gx += s.x * w
    gy += s.y * w
  }
  const k = sw > 1e-6 ? FOCUS.centroidW : 0
  const x = sw > 1e-6 ? lead.x * (1 - k) + (gx / sw) * k : lead.x
  const y = sw > 1e-6 ? lead.y * (1 - k) + (gy / sw) * k : lead.y
  const mx = HALF_X - FOCUS.inset
  const my = HALF_Y - FOCUS.inset
  return { x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) }
}
