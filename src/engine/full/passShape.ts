/**
 * Pass-direction analyzer over a GameEvent stream — engine-agnostic (works on
 * the director engine and the agent engine alike, and on any recorded stream).
 *
 * Each team's attack direction per period is read from the frames (the side a
 * goalie stands in front of is the side his team defends), passer team from
 * frame membership. A pass is "backward" per isBackwardPass (toward the
 * passer's own net, backward component dominant). "Offensive half" = the puck
 * was past the red line from the passer's perspective when the pass left.
 */
import type { GameEvent, PlayerId } from '@domain'
import { isBackwardPass } from './types'

export interface PassShape {
  passes: number
  backward: number
  ozPasses: number
  ozBackward: number
  /** ozBackward / ozPasses (0 when no OZ passes). */
  ozBackShare: number
  /** backward / passes. */
  backShare: number
}

export function passShape(stream: readonly GameEvent[]): PassShape {
  const homeIds = new Set<PlayerId>()
  const awayIds = new Set<PlayerId>()
  /** period → home attack sign. */
  const homeAttack = new Map<number, number>()
  for (const e of stream) {
    if (e.type !== 'frame') continue
    for (const s of e.home) homeIds.add(s.player)
    for (const s of e.away) awayIds.add(s.player)
    if (!homeAttack.has(e.period) && Math.abs(e.homeGoalie.pos.x) > 0.5) {
      homeAttack.set(e.period, e.homeGoalie.pos.x > 0 ? -1 : 1)
    }
  }
  const out: PassShape = { passes: 0, backward: 0, ozPasses: 0, ozBackward: 0, ozBackShare: 0, backShare: 0 }
  for (const e of stream) {
    if (e.type !== 'pass') continue
    const ha = homeAttack.get(e.period)
    if (ha === undefined) continue
    const a = homeIds.has(e.from) ? ha : awayIds.has(e.from) ? -ha : 0
    if (a === 0) continue
    const back = isBackwardPass(e.a, e.b, a)
    out.passes++
    if (back) out.backward++
    if (e.a.x * a > 0) {
      out.ozPasses++
      if (back) out.ozBackward++
    }
  }
  out.ozBackShare = out.ozPasses > 0 ? out.ozBackward / out.ozPasses : 0
  out.backShare = out.passes > 0 ? out.backward / out.passes : 0
  return out
}
