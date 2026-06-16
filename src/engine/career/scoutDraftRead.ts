/**
 * Your scouts' OWN read on a draft prospect — which can and should differ from
 * the analyst/media consensus. The classic case: a kid the public board ranks
 * lower, but your scouts love what they've seen (mature in interviews, a
 * two-way game the scoresheet hides) so they'd reach for him earlier — and it
 * pans out. Conversely, your staff can have concerns the board doesn't.
 *
 * Three principles, all from the user's design:
 *  1. Scouts differ from analysts — driven by intangibles (interviews,
 *     character) and by reading the underlying game, not just production.
 *  2. The divergence GROWS the deeper you go. At the very top everyone agrees
 *     (you don't out-scout the consensus on a generational #1); lower down,
 *     "anything can happen" and a good scouting dept gains real edge.
 *  3. You need eyes on him — knowledge gates how strong an independent opinion
 *     your staff can hold (assign scouts → sharper, more divergent reads).
 *
 * Pure: deterministic from the player + knowledge + rank + interview count.
 */
import type { Player } from '@domain'

export type ScoutVerdict = 'higher' | 'inline' | 'lower'

export interface ScoutDraftRead {
  verdict: ScoutVerdict
  /** Signed divergence from consensus, in 0–100 value points (after damping). */
  delta: number
  /** How sure your staff is of their own read (from knowledge + interviews). */
  confidence: 'low' | 'medium' | 'high'
  /** Plain-English explanation, contrasting your scouts with the board. */
  blurb: string
}

export interface ScoutDraftReadArgs {
  player: Player
  /** Scouting knowledge 0–100 — how much your staff has actually seen. */
  knowledge: number
  /** Consensus board rank (1 = top). Undefined = off the public board. */
  analystRank?: number
  /** Interview questions your staff has put to him (intangible read). */
  interviews: number
  /** Your scouts' grounded ceiling estimate (0–100) and its role label. */
  scoutsCeiling?: number
  scoutsRole?: string
  /** The analysts' (hype-inflated) ceiling estimate (0–100) and role label. */
  analystCeiling?: number
  analystRole?: string
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * The components of your scouts' independent signal on a player, BEFORE any
 * rank/knowledge damping:
 *  - intangibleAdj: maturity / drive / character (lifted by interviews).
 *  - twoWayAdj: an underlying two-way/IQ game the production-weighted board
 *    underrates.
 * Shared by the per-player read and the scout-built board so they stay
 * consistent. Units are 0–100 value points.
 */
export function scoutSignalParts(player: Player, interviews = 0): {
  intangibleAdj: number; twoWayAdj: number; raw: number
} {
  const p = player.personality
  const character = ((p.professionalism - 50) + (p.determination - 50) + (p.ambition - 50)) / 3
  const temperamentPenalty = p.temperament < 40 ? (40 - p.temperament) * 0.15 : 0
  const interviewBoost = Math.min(3, interviews)
  const intangibleAdj = clamp(
    character * 0.14 + Math.sign(character) * interviewBoost * 0.4 - temperamentPenalty,
    -7, 7,
  )
  const c = player.composites as unknown as Record<string, number>
  const m = player.ratings.mental as unknown as Record<string, number>
  const iq = ((m['offensiveIQ'] ?? 50) + (m['defensiveIQ'] ?? 50)) / 2
  const twoWay = ((c['defensiveZone'] ?? 50) + (c['takeaway'] ?? 50) + iq) / 3
  const scoring = c['scoring'] ?? 50
  const twoWayAdj = clamp((twoWay - scoring) * 0.06, -3, 4)
  return { intangibleAdj, twoWayAdj, raw: intangibleAdj + twoWayAdj }
}

/**
 * Build your scouts' draft read, or null if they haven't seen enough of him to
 * hold an independent opinion (assign a scout to change that).
 */
export function buildScoutDraftRead(a: ScoutDraftReadArgs): ScoutDraftRead | null {
  const { player, knowledge } = a
  if (knowledge < 35) return null

  const { intangibleAdj, twoWayAdj, raw: rawDelta } = scoutSignalParts(player, a.interviews)

  // ── Damping: agreement at the top, divergence deep; and you must have watched.
  const rank = a.analystRank ?? 70
  const chaos = 0.3 + 0.7 * clamp((rank - 1) / 40, 0, 1)
  const knowledgeFactor = clamp(knowledge / 100, 0, 1)
  // Ceiling gap: how far our grounded read sits from the (optimistic) board, in
  // value points. The board systematically over-projects via draft hype, so a
  // sober scouting dept will often read a touch lower — strong intangibles can
  // pull them back level or above.
  const ceilingGap = (a.scoutsCeiling !== undefined && a.analystCeiling !== undefined)
    ? a.scoutsCeiling - a.analystCeiling
    : 0
  const delta = (rawDelta * chaos + ceilingGap * 0.4) * knowledgeFactor

  const confidence: ScoutDraftRead['confidence'] =
    knowledge >= 70 ? 'high' : knowledge >= 50 ? 'medium' : 'low'

  const reason = (): string => {
    if (Math.abs(intangibleAdj) >= Math.abs(twoWayAdj)) {
      if (intangibleAdj >= 1.5) return 'he interviews well — mature, driven, and the character checks out'
      if (intangibleAdj <= -1.5) return 'there are maturity and attitude questions that give the staff pause'
    } else {
      if (twoWayAdj >= 1) return 'the underlying two-way game is better than his point totals suggest'
      if (twoWayAdj <= -1) return 'the game away from the puck lags behind the offensive flash'
    }
    return 'the overall package'
  }
  const THRESH = 2.2
  let verdict: ScoutVerdict = 'inline'
  if (delta >= THRESH) verdict = 'higher'
  else if (delta <= -THRESH) verdict = 'lower'

  // Is the disagreement driven by a different CEILING read, or by intangibles?
  // Pick the language to match, so the blurb never contradicts the displayed roles.
  const ceilingDriven = Math.abs(ceilingGap * 0.4) >= Math.abs(rawDelta * chaos)
  const rolesDiffer = !!(a.scoutsRole && a.analystRole && a.scoutsRole !== a.analystRole)

  let blurb: string
  if (verdict === 'higher') {
    const why = ceilingDriven && rolesDiffer
      ? `they grade his ceiling higher — a ${a.scoutsRole} where the board has him a ${a.analystRole}`
      : reason()
    blurb = `Your scouts are higher on him than the consensus board — ${why}. They'd take him earlier than his ranking suggests.`
  } else if (verdict === 'lower') {
    const why = ceilingDriven && rolesDiffer
      ? `they project a ${a.scoutsRole}, not the ${a.analystRole} the board sees`
      : reason()
    blurb = `Your staff is more cautious than the board — ${why}. They'd let him slide rather than reach.`
  } else {
    blurb = `Your scouts' read lines up with the consensus${confidence === 'low' ? ', though they want more viewings to be sure' : ''}.`
  }

  return { verdict, delta: Math.round(delta * 10) / 10, confidence, blurb }
}
