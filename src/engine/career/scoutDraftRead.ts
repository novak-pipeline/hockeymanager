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
import type { ContentVariant } from '@engine/story/contentEngine'
import { renderTemplate } from '@engine/story/contentEngine'
import { pickStable } from '@engine/story/prose'

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

/* ───────────────────── the vocabulary of disagreement ─────────────────────
 * A4 (playtest 2026-08-26): "the board" was doing every job in the scouting
 * layer, and a prospect card could use the phrase three times in one
 * paragraph. The consensus is one idea with many real names in hockey —
 * Central Scouting, the published list, the services, the industry, the
 * rankings — and the way to get range is not to swap a noun at random but to
 * author whole sentences that each carry their own register. Selection is
 * most-specific-wins with a per-prospect stable tie-break, so a given kid
 * always reads the same way and two kids in the same list do not.
 *
 * Slots: {ourRank} {consensusRank} {spots} {plural} {reason} {ourRole}
 *        {theirRole} {caveat}
 */

/** Our staff would take him EARLIER than he is ranked. */
const BOARD_HIGHER_POOL: ContentVariant[] = [
  { id: 'sbn.hi.roles', conditions: { rolesDiffer: true },
    text: `Our department grades a {ourRole} where the published list sees a {theirRole} — {reason}. They would take him {spots} spot{plural} earlier than his ranking (we have him #{ourRank}, consensus #{consensusRank}).` },
  { id: 'sbn.hi.big', conditions: { minSpots: 12 },
    text: `This is the widest gap on our list: #{ourRank} for us against #{consensusRank} everywhere else, because {reason}. If he is still there in the middle rounds our staff will bang the table.` },
  { id: 'sbn.hi.big2', conditions: { minSpots: 12 },
    text: `A {spots}-spot chasm, and our department is on the right side of it — {reason}. #{ourRank} here, #{consensusRank} publicly, and they are not backing down from it.` },
  { id: 'sbn.hi.big3', conditions: { minSpots: 12 },
    text: `Nobody else is anywhere near our number on him. #{ourRank} against a consensus #{consensusRank}, because {reason}, and that is a bet our department has decided to make.` },
  { id: 'sbn.hi.makeup', conditions: { reasonKind: 'makeup' },
    text: `The interviews moved him. Our scouts came away convinced by the makeup and slid him up to #{ourRank}; Central Scouting still has him #{consensusRank}.` },
  { id: 'sbn.hi.makeup2', conditions: { reasonKind: 'makeup' },
    text: `You cannot grade character off video, which is roughly why he is #{ourRank} for a department that has met him and #{consensusRank} for everyone who has not.` },
  { id: 'sbn.hi.twoway', conditions: { reasonKind: 'twoWay' },
    text: `The scoresheet undersells him — {reason}. That is why our list has him #{ourRank} and the services have him #{consensusRank}.` },
  { id: 'sbn.hi.twoway2', conditions: { reasonKind: 'twoWay' },
    text: `Rankings built on points will always miss this profile: {reason}. #{ourRank} on a list that watches shifts, #{consensusRank} on one that reads box scores.` },
  { id: 'sbn.hi.a',
    text: `Our staff like him more than the industry does — {reason}. #{ourRank} for us, #{consensusRank} on the public rankings, and they would happily reach.` },
  { id: 'sbn.hi.b',
    text: `A {spots}-spot disagreement in his favour: {reason}. We have him #{ourRank}; the consensus does not get there until #{consensusRank}.` },
  { id: 'sbn.hi.c',
    text: `Our scouts have watched him more than most and come away higher — {reason}. #{ourRank} on our list against #{consensusRank} publicly.` },
]

/** Our staff would let him slide — the ceilings AGREE, so it is about the field. */
const BOARD_LOWER_FIELD_POOL: ContentVariant[] = [
  { id: 'sbn.lo.field.a',
    text: `Nothing wrong with the player — our staff rate the ceiling as highly as anyone. They simply have {spots} other prospect{plural} they would call first (#{ourRank} for us, #{consensusRank} on the consensus).` },
  { id: 'sbn.lo.field.b',
    text: `This is a disagreement about the field, not about him. The ceiling read matches the industry's; the queue in front of him does not (#{ourRank} vs #{consensusRank}).` },
  { id: 'sbn.lo.field.c',
    text: `We like him. We like {spots} other name{plural} more. That is the whole story of the #{ourRank} beside a public #{consensusRank}.` },
  { id: 'sbn.lo.field.d',
    text: `Our grade on him is not the problem — our grade on the {spots} prospect{plural} ahead of him is why he sits #{ourRank} where the published list has #{consensusRank}.` },
]

/** Our staff are genuinely cooler on the player than the consensus is. */
const BOARD_LOWER_POOL: ContentVariant[] = [
  { id: 'sbn.lo.roles', conditions: { rolesDiffer: true },
    text: `Our scouts project a {ourRole}; the industry is selling a {theirRole}. They would let him slide rather than pay the consensus price (#{ourRank} vs #{consensusRank}).` },
  { id: 'sbn.lo.makeupBad', conditions: { reasonKind: 'makeupBad' },
    text: `The viewings were fine; the interviews were not. {reason} — enough that our staff dropped him to #{ourRank} against a public #{consensusRank}.` },
  { id: 'sbn.lo.makeupBad2', conditions: { reasonKind: 'makeupBad' },
    text: `On tools alone he is a #{consensusRank}. Our scouts do not draft tools alone, and {reason}, so he sits #{ourRank}.` },
  { id: 'sbn.lo.twoWayBad', conditions: { reasonKind: 'twoWayBad' },
    text: `The flash is real and so is the hole in his game: {reason}. We have him #{ourRank}, the services #{consensusRank}, and our staff would not reach.` },
  { id: 'sbn.lo.twoWayBad2', conditions: { reasonKind: 'twoWayBad' },
    text: `Everything he does well happens with the puck. {reason} — which is the whole distance between our #{ourRank} and a published #{consensusRank}.` },
  { id: 'sbn.lo.a',
    text: `Our department is cooler on him than the consensus — {reason}. #{ourRank} on our list, #{consensusRank} on theirs.` },
  { id: 'sbn.lo.b',
    text: `A {spots}-spot fade: {reason}. He would have to fall to #{ourRank} before our staff spent a pick on him.` },
  { id: 'sbn.lo.c',
    text: `The industry is higher on him than we are. {reason}, and our scouts would rather let someone else take the swing (#{ourRank} vs #{consensusRank}).` },
]

/** Our board and the public one agree. */
const BOARD_INLINE_POOL: ContentVariant[] = [
  { id: 'sbn.in.a',
    text: `Our board and the public one are within a rounding error of each other on him (#{ourRank} vs #{consensusRank}).` },
  { id: 'sbn.in.b',
    text: `Our scouts see what everyone else sees: #{ourRank} for us, #{consensusRank} publicly, and no appetite to argue about the difference.` },
  { id: 'sbn.in.c',
    text: `A consensus prospect in the literal sense — our read tracks the industry's almost exactly (#{ourRank} / #{consensusRank}).` },
]

/** We have not watched him enough to hold an opinion. */
const BOARD_UNSEEN_POOL: ContentVariant[] = [
  { id: 'sbn.un.a',
    text: `Light viewings so far. He sits #{ourRank} on our list only because the consensus has him #{consensusRank} — that is a placeholder until a scout files on him.` },
  { id: 'sbn.un.b',
    text: `We are carrying the industry's number on him — #{consensusRank} — for want of one of our own, which is the only reason he sits #{ourRank} here. Assign a scout and it will move.` },
  { id: 'sbn.un.c',
    text: `Nobody in our department has seen enough of him to disagree with anyone. The #{ourRank} here is borrowed from a published #{consensusRank}, not earned.` },
  { id: 'sbn.un.d',
    text: `Unwatched. The #{ourRank} beside his name is the consensus (#{consensusRank}) talking, not our staff.` },
]

export interface ScoutBoardNoteArgs {
  /** Stable per-prospect key — picks WHICH authored frame he gets, so the same
   *  kid always reads the same way and two kids in a list do not. */
  playerId?: string
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
  /** Role labels for the two ceiling reads ("top-six F", "middle-six F"), when
   *  they differ — the most concrete way to state a disagreement. */
  ourRole?: string
  theirRole?: string
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
  const key = `${a.playerId ?? ''}|${a.verdict}|${a.ourRank}`
  const slots: Record<string, string> = {
    ourRank: String(a.ourRank),
    consensusRank: String(a.consensusRank),
    spots: String(spots),
    plural: spots === 1 ? '' : 's',
    reason: '',
    ourRole: a.ourRole ?? '',
    theirRole: a.theirRole ?? '',
  }
  if (!a.seen) return renderPool(BOARD_UNSEEN_POOL, { verdict: a.verdict }, key, slots)

  const int = a.intangibleAdj ?? 0
  const two = a.twoWayAdj ?? 0
  const reasonKind: string =
    Math.abs(int) >= Math.abs(two)
      ? int >= 1.5 ? 'makeup' : int <= -1.5 ? 'makeupBad' : 'none'
      : two >= 1 ? 'twoWay' : two <= -1 ? 'twoWayBad' : 'none'
  slots.reason = REASON_CLAUSE[reasonKind] ?? REASON_CLAUSE['none']!

  // Does our own CEILING read agree with the consensus? If we like the ceiling
  // just as much and are still lower, the disagreement is about the field, not
  // the player — exactly the case that used to read as a contradiction.
  const ceilingGap = (a.ourCeiling !== undefined && a.analystCeiling !== undefined)
    ? a.ourCeiling - a.analystCeiling
    : 0
  const rolesDiffer = !!(a.ourRole && a.theirRole && a.ourRole !== a.theirRole)
  const ctx = { verdict: a.verdict, reasonKind, rolesDiffer, spots }

  if (a.verdict === 'lower') {
    const pool = ceilingGap >= -3 ? BOARD_LOWER_FIELD_POOL : BOARD_LOWER_POOL
    return renderPool(pool, ctx, key, slots)
  }
  if (a.verdict === 'higher') return renderPool(BOARD_HIGHER_POOL, ctx, key, slots)
  return renderPool(BOARD_INLINE_POOL, ctx, key, slots)
}

/** Why our read differs, as a clause that drops into the authored frames. */
const REASON_CLAUSE: Record<string, string> = {
  makeup: 'he interviews well and the makeup checks out',
  makeupBad: 'there are maturity and attitude questions',
  twoWay: 'the underlying two-way game is better than his point totals suggest',
  twoWayBad: 'the game away from the puck lags behind the offensive flash',
  none: 'they read the whole package a little differently',
}

/** Most-specific authored frame for this state, stable per prospect. */
function renderPool(
  pool: ContentVariant[],
  ctx: Record<string, string | number | boolean>,
  key: string,
  slots: Record<string, string>
): string {
  const v = pickStable(pool, ctx, key) ?? pool[0]!
  return renderTemplate(v.text, slots)
}

/* ── The scout-report blurb (the long-form cousin of scoutBoardNote) ──
 * Same rule: authored frames, most specific wins, stable per prospect.
 * Slots: {ourRole} {theirRole} {reason} {caveat}
 */

const READ_HIGHER_POOL: ContentVariant[] = [
  { id: 'sdr.hi.roles', conditions: { ceilingDriven: true, rolesDiffer: true },
    text: `Your scouts grade the ceiling above the industry read — a {ourRole} where the published rankings see a {theirRole}{caveat}. They would take him earlier than his number suggests.` },
  { id: 'sdr.hi.makeup', conditions: { reasonKind: 'makeup' },
    text: `The interviews did it. {reason}, and a department that has sat across a table from him is comfortably ahead of a consensus built on video.` },
  { id: 'sdr.hi.twoway', conditions: { reasonKind: 'twoWay' },
    text: `Production-weighted lists are missing this one: {reason}. Your staff would call his name before the rankings say they have to.` },
  { id: 'sdr.hi.a',
    text: `Your department is higher on him than the consensus — {reason}. They would rather reach than watch someone else take him.` },
  { id: 'sdr.hi.b',
    text: `A genuine departmental disagreement, in his favour: {reason}. Your scouts have him graded above where the industry will let him go.` },
  { id: 'sdr.hi.c',
    text: `Your staff have seen more of him than most rooms have, and they came away sold — {reason}.` },
]

const READ_LOWER_POOL: ContentVariant[] = [
  { id: 'sdr.lo.roles', conditions: { ceilingDriven: true, rolesDiffer: true },
    text: `Your staff project a {ourRole}, not the {theirRole} the industry is selling. They would let him slide rather than pay the consensus price.` },
  { id: 'sdr.lo.makeupBad', conditions: { reasonKind: 'makeupBad' },
    text: `The tools are not the question. {reason}, and a department that has met him is more cautious than a list that has only watched him.` },
  { id: 'sdr.lo.twoWayBad', conditions: { reasonKind: 'twoWayBad' },
    text: `The highlights flatter him: {reason}. Your scouts would let another club take that swing.` },
  { id: 'sdr.lo.a',
    text: `Your department is cooler on him than the published rankings — {reason}. No appetite to reach.` },
  { id: 'sdr.lo.b',
    text: `A quiet fade on your board: {reason}. He would have to fall a long way before your staff spent a pick.` },
  { id: 'sdr.lo.c',
    text: `Your scouts have questions the consensus does not: {reason}. They would rather be a year late on him than a round early.` },
]

const READ_INLINE_POOL: ContentVariant[] = [
  { id: 'sdr.in.low', conditions: { confidence: 'low' },
    text: `Your scouts land roughly where the industry does, though they want more viewings before they will stand behind it.` },
  { id: 'sdr.in.a',
    text: `Your department's read tracks the consensus. Nobody upstairs is arguing about this one.` },
  { id: 'sdr.in.b',
    text: `No edge here either way — your staff and the published rankings tell the same story about him.` },
  { id: 'sdr.in.c',
    text: `Your scouts see him the way the rest of the industry does. That is not always a bad thing.` },
]

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

  // A4: one authored frame per state, chosen most-specific-first and tie-broken
  // by the prospect's own id — so the same kid always reads the same way, and a
  // page of prospects does not repeat one sentence with the names swapped.
  const ctx = {
    verdict, confidence, ceilingDriven, rolesDiffer,
    reasonKind:
      Math.abs(intangibleAdj) >= Math.abs(twoWayAdj)
        ? intangibleAdj >= 1.5 ? 'makeup' : intangibleAdj <= -1.5 ? 'makeupBad' : 'none'
        : twoWayAdj >= 1 ? 'twoWay' : twoWayAdj <= -1 ? 'twoWayBad' : 'none',
  }
  const slots = {
    ourRole: a.scoutsRole ?? '',
    theirRole: a.analystRole ?? '',
    reason: reason(),
    caveat: verdict === 'higher' && intangible < 0 ? counterNote() : '',
  }
  const pool = verdict === 'higher' ? READ_HIGHER_POOL : verdict === 'lower' ? READ_LOWER_POOL : READ_INLINE_POOL
  const variant = pickStable(pool, ctx, `${player.id as string}|${verdict}`) ?? pool[0]!
  const blurb = renderTemplate(variant.text, slots)

  return { verdict, delta: Math.round(delta * 10) / 10, confidence, blurb }
}
