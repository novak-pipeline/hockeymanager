/**
 * The feud arc (story audit 2026-10 §4, F6) — "a player has an issue with
 * another player", rebuilt.
 *
 * The old version was a phone call from a pair chosen at roster build by two
 * personality numbers and a coin flip. It named no cause, the same two men
 * called four times a season, and "address the room" changed nothing.
 *
 * Now:
 *  1. A real cause, from a sim fact, dated: the GM moved one man into the
 *     other's spot on the lines, signed a teammate for more money than a man
 *     out-producing him, gave the C to someone else, or singled one man out at
 *     the podium. The cause is stored on the arc and named in the first
 *     sentence of the scene.
 *  2. Raised in person by the head coach (never a phone call), as a scene the
 *     GM answers: split the lines, back one man, let the captain handle it,
 *     or put the aggrieved man on the trade block. Every choice does what it
 *     says to the sim (the lines change, morale memories are written, the
 *     captain's roll is real, the block is real).
 *  3. It runs as an arc over several weeks: split pairs cool off after games
 *     apart, an escalation (put back together) re-opens it and the next scene
 *     quotes the first, and every state change is written to the chronicle.
 *  4. At most two a season, spaced a month apart, and never the same pair
 *     twice unless it escalated.
 *
 * This file is pure: types, rate rules, cause detection over plain data, and
 * the words. The career layer (career.ts) owns the state and the effects.
 */
import { stableSeed } from '@engine/story/prose'

export type FeudCauseKind = 'roleTaken' | 'contractEnvy' | 'captaincy' | 'publicComment' | 'badNight'

/** A logged sim fact that put two men at odds. JSON-safe. */
export interface FeudCause {
  kind: FeudCauseKind
  /** The man with the grievance. */
  aId: string
  /** The man it is aimed at. */
  bId: string
  year: number
  day: number
  /** ISO date of the event. */
  date: string
  /** roleTaken: "first line" / "top pair". */
  slot?: string
  /** contractEnvy: B's new cap hit and A's, in prose ("$6.5 million"). */
  bMoney?: string
  aMoney?: string
  /** contractEnvy: points this season (or last, in the summer). */
  aPoints?: number
  bPoints?: number
  /** captaincy: A wore an A. */
  aWasAlternate?: boolean
  /** publicComment: the GM's words at the podium. */
  quote?: string
  /** badNight: each man's plus-minus, the score and the opponent. */
  aPlusMinus?: number
  bPlusMinus?: number
  score?: string
  opponent?: string
  /** badNight: forwards share a line, defencemen a pair. */
  unit?: 'line' | 'pair'
  /** Re-queued because an answered feud flared again: always raised (rate
   *  rules permitting), whatever the man's temperament. */
  escalation?: true
}

export type FeudChoice = 'split' | 'backA' | 'backB' | 'captain' | 'shop'

export type FeudStatus =
  | 'raised'     // the scene is on the desk
  | 'cooling'    // answered; playing out over the next weeks
  | 'resolved'   // over: cooled off, sorted out, or one of them left
  | 'escalated'  // flared again after an answer; may be raised a second time
  | 'lapsed'     // the scene was never answered

export interface FeudArc {
  id: string
  /** The interaction (scene) that raised it. */
  interactionId: string
  aId: string
  bId: string
  cause: FeudCause
  status: FeudStatus
  raisedYear: number
  raisedDay: number
  raisedDate: string
  choice?: FeudChoice
  decidedDate?: string
  /** Games the pair has played apart (split) / since the answer. */
  gamesApart: number
  /** Games needed for it to cool off. */
  gamesNeeded: number
  /** How many times it flared again after an answer. */
  escalations: number
  /** The date it escalated (quoted by the next scene). */
  escalatedDate?: string
  /** The previous arc for this pair, when this is a second scene. */
  previousArcId?: string
}

export interface FeudState {
  arcs: FeudArc[]
  /** Causes waiting for a quiet day (newest last). */
  pending: FeudCause[]
  /** Last observed EV tier per user skater: [id, tier]. */
  prevTiers: Array<[string, number]>
  counter: number
}

export function freshFeudState(): FeudState {
  return { arcs: [], pending: [], prevTiers: [], counter: 0 }
}

/* ───────────────────────────── rate rules ───────────────────────────── */

export const FEUD_MAX_PER_SEASON = 2
export const FEUD_SPACING_DAYS = 30
/** Games apart for a split pair to cool off. */
export const FEUD_COOL_GAMES = 8
/** Games for a backed / captain-handled feud to settle. */
export const FEUD_SETTLE_GAMES = 10

/** How long (days) a cause stays live before it is too old to raise. */
export const ESCALATION_SHELF_DAYS = 60
export const CAUSE_SHELF_DAYS: Record<FeudCauseKind, number> = {
  roleTaken: 21,
  publicComment: 21,
  badNight: 10,
  contractEnvy: 100,
  captaincy: 100,
}

/** Chance a fresh cause actually becomes a feud (not every slight does). */
export const CAUSE_CHANCE: Record<FeudCauseKind, number> = {
  roleTaken: 0.35,
  publicComment: 0.4,
  badNight: 0.3,
  contractEnvy: 0.6,
  captaincy: 0.7,
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * May a scene for this pair be raised today? At most two a season, a month
 * apart, nothing while another feud scene is on the desk, and the same pair
 * only again when their last arc escalated.
 */
export function mayRaiseFeud(state: FeudState, aId: string, bId: string, year: number, day: number): boolean {
  const thisSeason = state.arcs.filter((a) => a.raisedYear === year)
  if (thisSeason.length >= FEUD_MAX_PER_SEASON) return false
  if (state.arcs.some((a) => a.status === 'raised')) return false
  const last = thisSeason.reduce((m, a) => Math.max(m, a.raisedDay), -999)
  if (day - last < FEUD_SPACING_DAYS) return false
  const key = pairKey(aId, bId)
  const prior = state.arcs.filter((a) => pairKey(a.aId, a.bId) === key)
  if (prior.length === 0) return true
  return prior[prior.length - 1]!.status === 'escalated'
}

/** A personality that takes a slight personally: ambitious or short-fused. */
export function takesItPersonally(p: { personality: { ambition: number; temperament: number } }): boolean {
  return p.personality.ambition >= 12 || p.personality.temperament <= 9
}

/* ─────────────────────────── cause detection ─────────────────────────── */

export const TIER_NAME = {
  F: ['first line', 'second line', 'third line', 'fourth line'],
  D: ['top pair', 'second pair', 'third pair'],
} as const

/**
 * Role taken: a man who was in the top two tiers dropped down, and a man of
 * the same group now sits in his old tier who was below it before. Returns
 * the (aggrieved, rival, slot) triples, aggrieved first.
 */
export function detectRoleTaken(
  prev: ReadonlyMap<string, number>,
  now: ReadonlyMap<string, number>,
  groupOf: (id: string) => 'F' | 'D' | null,
): Array<{ aId: string; bId: string; slot: string }> {
  const out: Array<{ aId: string; bId: string; slot: string }> = []
  for (const [aId, before] of prev) {
    const after = now.get(aId)
    const g = groupOf(aId)
    if (g === null || after === undefined || before > 2 || after <= before) continue
    for (const [bId, bNow] of now) {
      if (bId === aId || bNow !== before || groupOf(bId) !== g) continue
      const bBefore = prev.get(bId)
      if (bBefore === undefined || bBefore <= before) continue
      out.push({ aId, bId, slot: TIER_NAME[g][before - 1] ?? 'top six' })
      break
    }
  }
  return out
}

/* ───────────────────────────── the words ───────────────────────────── */

export interface FeudNames {
  a: string
  b: string
  coach: string
  captain?: string
}

const last = (name: string): string => name.split(' ').slice(-1)[0] ?? name

/** "Nov 12" from an ISO date. */
export function feudDate(iso: string): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const m = Number(iso.slice(5, 7))
  return `${MONTHS[m - 1] ?? ''} ${Number(iso.slice(8, 10))}`
}

/** The first sentence: the dated cause, as a fact. */
export function causeSentence(c: FeudCause, n: FeudNames): string {
  const when = feudDate(c.date)
  switch (c.kind) {
    case 'roleTaken':
      return `On ${when} ${n.b} took ${n.a}'s place on the ${c.slot ?? 'top six'}.`
    case 'contractEnvy':
      return `${n.b} signed for ${c.bMoney ?? 'more'} on ${when}. ${n.a} makes ${c.aMoney ?? 'less'} and has ` +
        `${c.aPoints ?? 0} points to ${last(n.b)}'s ${c.bPoints ?? 0}.`
    case 'captaincy':
      return c.aWasAlternate
        ? `You gave the C to ${n.b} on ${when}. ${n.a} wore an A and wanted it.`
        : `You gave the C to ${n.b} on ${when}. ${n.a} wanted it.`
    case 'publicComment':
      return `On ${when} you singled out ${n.b} at the podium: "${c.quote ?? ''}" ${n.a} plays the same spot.`
    case 'badNight':
      return `${n.a} finished ${pm(c.aPlusMinus ?? 0)} and ${n.b} ${pm(c.bPlusMinus ?? 0)} on the same ${c.unit ?? 'line'} in the ` +
        `${c.score ?? ''} loss to ${c.opponent ?? 'the opposition'} on ${when}.`
  }
}

/** "a 5–2" / "an 8–1": the article a score takes when said aloud. */
export function aScore(score: string): string {
  return /^(8|11|18)(?!\d)/.test(score) ? `an ${score}` : `a ${score}`
}

/** "minus-3" / "plus-1" / "even", as a broadcaster says it. */
function pm(n: number): string {
  return n < 0 ? `minus-${-n}` : n > 0 ? `plus-${n}` : 'even'
}

/** What the coach says when he shuts the door. Stable per arc, 3 per cause. */
const COACH_LINES: Record<FeudCauseKind, Array<(a: string, b: string) => string>> = {
  roleTaken: [
    (a, b) => `"${a} thinks that spot was his, and ${b} thinks he earned it. It's on the bench now. I want your call before it costs us a game."`,
    (a, b) => `"${a} hasn't taken it well, and ${b} isn't apologising for it. I can live with competition. I can't live with this."`,
    (a, b) => `"You can feel it in the room. ${a} and ${b} are at each other. Tell me how you want it handled."`,
  ],
  contractEnvy: [
    (a, b) => `"${a} has done the math and he's making sure the room hears it. ${b} is getting tired of hearing it."`,
    (a, b) => `"It's the number. ${a} keeps bringing it up, and ${b} has stopped laughing it off."`,
    (a, b) => `"Money talk in my room. ${a} thinks he's being disrespected, and he's taking it out on ${b}."`,
  ],
  captaincy: [
    (a, b) => `"${a} is taking it personally, and ${b} knows it. A captain can't have that in his room."`,
    (a, b) => `"${b} is trying to lead and ${a} won't follow him. That's a problem I can't coach my way out of."`,
    (a, b) => `"${a} won't say it to your face, but he says it to everybody else. ${b} has heard it."`,
  ],
  badNight: [
    (a, b) => `"${a} is blaming ${b} for it, loud enough for the whole room to hear. ${b} is giving it right back."`,
    (a, b) => `"They went at each other on the bench in the third. ${a} thinks ${b} hung him out to dry."`,
    (a, b) => `"${a} won't let it go. Every goal against, it was ${b}'s man. That's not how I want this room talking."`,
  ],
  publicComment: [
    (a, b) => `"${a} read it the next morning. He thinks you've picked your guy, and he's taking it out on ${b}."`,
    (a, b) => `"Your words were in every paper in town. ${a} took them as a verdict on him, and he's letting ${b} know it."`,
    (a, b) => `"${a} heard what you said about ${b}. He wants to know what that makes him."`,
  ],
}

/** The full scene, raised in person by the head coach. */
export function feudSceneText(arc: Pick<FeudArc, 'id' | 'cause' | 'escalatedDate' | 'previousArcId'>, n: FeudNames, previous?: FeudArc): string {
  const lines = COACH_LINES[arc.cause.kind]
  const coachLine = lines[stableSeed(`feud|${arc.id}`) % lines.length]!(last(n.a), last(n.b))
  const lede = previous?.choice === 'split' && arc.escalatedDate
    ? `You split them on ${feudDate(previous.decidedDate ?? previous.raisedDate)}. They were back on the same line on ${feudDate(arc.escalatedDate)}. `
    : previous
      ? `It's ${last(n.a)} and ${last(n.b)} again. `
      : ''
  return `${lede}${causeSentence(arc.cause, n)} ${n.coach} shuts your door behind him. ${coachLine}`
}

export function feudHeadline(n: FeudNames, second: boolean): string {
  return second
    ? `${n.coach} is back about ${last(n.a)} and ${last(n.b)}`
    : `${n.coach} wants a word about ${last(n.a)} and ${last(n.b)}`
}

export interface FeudOption { id: FeudChoice; label: string }

export function feudOptions(n: FeudNames, captainAvailable: boolean): FeudOption[] {
  const opts: FeudOption[] = [
    { id: 'split', label: 'Split them up: different lines' },
    { id: 'backA', label: `Back ${last(n.a)}` },
    { id: 'backB', label: `Back ${last(n.b)}` },
  ]
  if (captainAvailable && n.captain) opts.push({ id: 'captain', label: `Let ${last(n.captain)} handle it` })
  opts.push({ id: 'shop', label: `Put ${last(n.a)} on the trade block` })
  return opts
}

/** The receipt for the GM's answer. Every clause is something the career did. */
export function feudOutcome(choice: FeudChoice, n: FeudNames, captainWorked?: boolean): string {
  const a = last(n.a), b = last(n.b), coach = last(n.coach)
  switch (choice) {
    case 'split':
      return `${coach} redid the lines that afternoon: ${a} and ${b} won't share a shift. ` +
        `Both lose a linemate they knew. If they stay apart for ${FEUD_COOL_GAMES} games, this should cool off.`
    case 'backA':
      return `You told ${coach} you're with ${a}. ${b} knew by the next practice, and he won't forget it soon.`
    case 'backB':
      return `You told ${coach} you're with ${b}. ${a} knew by the next practice, and he won't forget it soon.`
    case 'captain':
      return captainWorked
        ? `${last(n.captain ?? 'The captain')} talked to both of them after practice, and it took. The room saw who sorted it out.`
        : `${last(n.captain ?? 'The captain')} tried, and it didn't take. ${a} and ${b} are still at odds. If it flares again, it's back on your desk.`
    case 'shop':
      return `${a} is on the trade block. He knows, and so does every GM who calls.`
  }
}
