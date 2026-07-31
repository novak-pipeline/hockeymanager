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

export interface ScoutBoardNoteArgs {
  /** Where OUR board has him (1 = best). */
  ourRank: number
  /** Where the public consensus has him. */
  consensusRank: number
  /** The verdict already computed from the rank gap. */
  verdict: ScoutVerdict
  /** Whether our staff has watched him enough to hold an opinion at all. */
  seen: boolean
  /** Our fog-aware ceiling read (0–100) and the analysts' perceived ceiling. */
  ourCeiling?: number
  analystCeiling?: number
  /** Signal components from {@link scoutSignalParts} — the reason clause. */
  intangibleAdj?: number
  twoWayAdj?: number
}

/**
 * One sentence saying, in words, what our staff thinks of a prospect RELATIVE to
 * the public board — and why.
 *
 * E2 (playtest 2026-07-31): a prospect showed 5★ potential and a staff recommend
 * on the same row as a bare "#38 ▼". Both readings were true and neither was
 * explained, so the row read as a bug rather than as drama. The two are different
 * axes — how good we think he is, versus how good we think he is compared to the
 * consensus — and a high ceiling with a low relative ranking is a real, common
 * scouting position ("we love the ceiling; we'd still take thirty-seven kids
 * first"). This says which it is out loud. Disagreement is the point; unexplained
 * contradiction is the bug.
 */
export function scoutBoardNote(a: ScoutBoardNoteArgs): string {
  const gap = a.consensusRank - a.ourRank // + = we're higher on him
  const spots = Math.abs(gap)
  const where = `we have him #${a.ourRank}, the board #${a.consensusRank}`
  if (!a.seen) {
    return `Light viewings so far — ${where}, but that ranking is a placeholder until our scouts get eyes on him.`
  }
  const reason = ((): string => {
    const int = a.intangibleAdj ?? 0
    const two = a.twoWayAdj ?? 0
    if (Math.abs(int) >= Math.abs(two)) {
      if (int >= 1.5) return 'he interviews well and the makeup checks out'
      if (int <= -1.5) return 'there are maturity and attitude questions'
    } else {
      if (two >= 1) return 'the underlying two-way game is better than his point totals suggest'
      if (two <= -1) return 'the game away from the puck lags behind the offensive flash'
    }
    return 'they read the whole package a little differently'
  })()
  // Does our own CEILING read agree with the board's? If we like the ceiling just
  // as much and are still lower, the disagreement is about the field, not the
  // player — which is exactly the case that read as a contradiction.
  const ceilingGap = (a.ourCeiling !== undefined && a.analystCeiling !== undefined)
    ? a.ourCeiling - a.analystCeiling
    : 0
  if (a.verdict === 'lower') {
    return ceilingGap >= -3
      ? `Our staff rate the ceiling as highly as anyone — they just have ${spots} other prospect${spots === 1 ? '' : 's'} they would take first (${where}).`
      : `Our staff are lower on him than the consensus — ${reason}. They would let him slide rather than reach (${where}).`
  }
  if (a.verdict === 'higher') {
    return `Our staff are higher on him than the consensus — ${reason}. They would take him ${spots} spot${spots === 1 ? '' : 's'} earlier than the board says (${where}).`
  }
  return `Our staff's board lines up with the consensus (${where}).`
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
  // sober scouting dept will often read a touch lower — but where the board has
  // UNDER-rated a prospect (a sleeper), our grounded read sits above it.
  const ceilingGap = (a.scoutsCeiling !== undefined && a.analystCeiling !== undefined)
    ? a.scoutsCeiling - a.analystCeiling
    : 0
  const intangible = rawDelta * chaos
  // The VERDICT direction must agree with the ceiling read we DISPLAY: if our
  // scouts grade his ceiling clearly higher than the board, we can't also be
  // "more cautious" — that's the contradiction we're avoiding. So a clear ceiling
  // gap (≥ a role's worth, ~4 pts) sets the direction; intangibles can only push
  // FURTHER in that same direction, never reverse it. When the ceilings are about
  // level, intangibles (maturity, makeup, two-way game) decide whether we'd reach
  // for him or let him slide at his rank.
  const NEAR_TIE = 4
  const delta = (Math.abs(ceilingGap) >= NEAR_TIE
    ? ceilingGap + (Math.sign(intangible) === Math.sign(ceilingGap) ? intangible * 0.5 : 0)
    : ceilingGap + intangible
  ) * knowledgeFactor

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

  // The verdict direction is ceiling-driven whenever the ceiling gap was decisive
  // (≥ a role's worth); only near-tie calls are settled on intangibles. Match the
  // language to that so the blurb never contradicts the displayed ceiling roles.
  const ceilingDriven = Math.abs(ceilingGap) >= NEAR_TIE
  const rolesDiffer = !!(a.scoutsRole && a.analystRole && a.scoutsRole !== a.analystRole)
  // A makeup/two-way note pointing AGAINST a ceiling-driven verdict — surfaced as
  // a caveat, not allowed to flip the call (e.g. "higher ceiling, but maturity
  // questions to monitor").
  const counterNote = (): string => {
    if (intangibleAdj <= -1.5) return ' — though there are some maturity and attitude questions to monitor'
    if (twoWayAdj <= -1) return ' — though the game away from the puck still needs work'
    if (intangibleAdj >= 1.5) return ', and the character and makeup only add to the appeal'
    return ''
  }

  let blurb: string
  if (verdict === 'higher') {
    if (ceilingDriven && rolesDiffer) {
      const caveat = intangible < 0 ? counterNote() : ''
      blurb = `Your scouts are higher on him than the consensus board — they grade his ceiling higher, a ${a.scoutsRole} where the board has him a ${a.analystRole}${caveat}. They'd take him earlier than his ranking suggests.`
    } else {
      blurb = `Your scouts are higher on him than the consensus board — ${reason()}. They'd take him earlier than his ranking suggests.`
    }
  } else if (verdict === 'lower') {
    if (ceilingDriven && rolesDiffer) {
      blurb = `Your staff is more cautious than the board — they project a ${a.scoutsRole}, not the ${a.analystRole} the board sees. They'd let him slide rather than reach.`
    } else {
      blurb = `Your staff is more cautious than the board — ${reason()}. They'd let him slide rather than reach.`
    }
  } else {
    blurb = `Your scouts' read lines up with the consensus${confidence === 'low' ? ', though they want more viewings to be sure' : ''}.`
  }

  return { verdict, delta: Math.round(delta * 10) / 10, confidence, blurb }
}
