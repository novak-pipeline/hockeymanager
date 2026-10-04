/**
 * Player → GM interactions (story-first core).
 *
 * Unhappy or ambitious players raise a concern addressed to the GM: a request
 * for reassurance, a contract-future talk, or — at the extreme — a trade demand.
 * The GM picks a response; the choice deterministically moves the player's morale
 * (and the room's mood) according to the player's personality. Professionals take
 * a firm message well; volatile, low-professionalism players sulk or escalate.
 *
 * This module is PURE and JSON-safe — no Maps, no Date, no Math.random. Every
 * stochastic decision flows through the caller's seeded Rng so league history
 * replays identically. The career layer owns the array of interactions, persists
 * it in CareerSnapshot (optional/additive), surfaces open ones in the inbox, and
 * applies the returned deltas to the live player/locker-room state.
 */

import type { Player } from '@domain'
import type { Rng } from '@engine/shared/rng'
import type { SceneSpeaker } from '@engine/story/decisionEvents'
import type { LockerRoomState, Relationship } from './lockerRoom'

export type { SceneSpeaker }

/* ─────────────────────────── public types ─────────────────────────── */

export type InteractionKind =
  | 'iceTime'      // wants a bigger role / more responsibility
  | 'future'       // contract/future uncertainty (deal running down)
  | 'unhappy'      // generally unsettled (low morale)
  | 'feud'         // friction with a teammate
  | 'tradeRequest' // formally wants out

export type ResponseTone = 'promise' | 'supportive' | 'firm' | 'dismissive'

export interface InteractionOption {
  id: string
  label: string
  tone: ResponseTone
}

/** A pending or resolved player concern. JSON-safe; lives in the save. */
export interface PlayerInteraction {
  id: string
  playerId: string
  teamId: string
  year: number
  day: number
  kind: InteractionKind
  severity: 'mild' | 'serious'
  /** What the player says to you, in plain English. */
  message: string
  /** True when `message` is an authored SCENE (narrated prose with dialogue set
   *  in it) rather than the player's own first-person words. The living phone
   *  reads this to know it must lift the dialogue out before voicing it — and to
   *  leave a scene with no dialogue in the office, where it belongs.
   *  Optional/additive: absent = a plain first-person concern. */
  scene?: true
  /** Whose voice speaks the dialogue in a `scene`. Absent = the player. */
  speaker?: SceneSpeaker
  options: InteractionOption[]
  status: 'open' | 'resolved'
  chosenOptionId?: string
  /** Prose result after responding. */
  outcome?: string
  /** Day the GM answered (for cooldown — a player you just spoke to stays quiet
   *  for the cooldown window measured from the CONVERSATION, not when he raised it). */
  resolvedDay?: number
}

/** Result of applying a GM response — caller mutates state from these. */
export interface InteractionResult {
  moraleDelta: number
  roomMoraleDelta: number
  /** True when a dismissed serious concern hardens into a trade demand. */
  escalateToTrade: boolean
  outcome: string
  /** Optional follow-up news the career layer pushes to the inbox. */
  news?: { headline: string; body: string }
}

/* ─────────────────────────── promises (LW5) ─────────────────────────── */

export type PromiseKind = 'iceTime' | 'newDeal' | 'exploreTrade'

/**
 * A promise the GM made to a player's face. JSON-safe; lives in the save.
 * Words are cheap the day you say them — the ledger makes them expensive later:
 * every promise has a measurable keep-condition and a due date, and a broken
 * one costs far more morale than the promise bought.
 */
export interface PlayerPromise {
  id: string
  playerId: string
  kind: PromiseKind
  /** Your words, quoted back to you when the bill comes due. */
  text: string
  year: number
  day: number
  /** In-season due day. Absent = evaluated at season rollover. */
  dueDay?: number
  /** iceTime baseline: games/TOI at the moment of the promise. */
  baselineGp?: number
  baselineToi?: number
  /** newDeal baseline: contract years remaining when promised. */
  baselineYears?: number
  /** One grace extension granted (injury/short sample). */
  extended?: boolean
  status: 'open' | 'kept' | 'broken'
}

/**
 * Turn a promise-tone response into a ledger entry. Returns null for kinds
 * where "promising" is just reassurance with nothing measurable behind it.
 */
export function promiseFromResponse(args: {
  interaction: PlayerInteraction
  player: Player
  nextId: string
  deadlineDay: number
  seasonGp: number
  seasonToi: number
}): PlayerPromise | null {
  const { interaction: it, player: p } = args
  const base = { id: args.nextId, playerId: it.playerId, year: it.year, day: it.day, status: 'open' as const }
  switch (it.kind) {
    case 'iceTime':
      return {
        ...base, kind: 'iceTime',
        text: 'a bigger role and more ice time',
        dueDay: it.day + 35,
        baselineGp: args.seasonGp, baselineToi: args.seasonToi,
      }
    case 'future':
      return {
        ...base, kind: 'newDeal',
        text: 'a new contract is coming',
        baselineYears: p.contract.yearsRemaining,
      }
    case 'tradeRequest':
      return {
        ...base, kind: 'exploreTrade',
        text: 'we will work to find you a move',
        // Before the deadline the deadline IS the due date; after it, the
        // promise carries to season's end (evaluated at rollover).
        ...(it.day < args.deadlineDay ? { dueDay: args.deadlineDay } : {}),
      }
    default:
      return null
  }
}

/** Human label for when a promise comes due, for the ledger UI. */
export function promiseDueLabel(pr: PlayerPromise): string {
  if (pr.status === 'kept') return 'Kept'
  if (pr.status === 'broken') return 'Broken'
  return pr.dueDay !== undefined ? `Due day ${pr.dueDay}` : 'Due at season end'
}

/* ─────────────────────────── generation ─────────────────────────── */

/** Per-check probability that an eligible player actually speaks up. */
const SPEAK_CHANCE: Record<InteractionKind, number> = {
  tradeRequest: 0.45,
  unhappy: 0.30,
  future: 0.22,
  iceTime: 0.20,
  feud: 0.18,
}

/** Days a player stays quiet after any resolved/raised concern. */
export const INTERACTION_COOLDOWN_DAYS = 30

function firstFeud(lr: LockerRoomState | null, playerId: string): Relationship | null {
  if (!lr) return null
  return lr.relationships.find(
    (r) => r.kind === 'feud' && (r.a === playerId || r.b === playerId)
  ) ?? null
}

/** Decide which concern (if any) this player would raise today, by priority. */
function chooseKind(
  p: Player,
  lr: LockerRoomState | null
): { kind: InteractionKind; severity: 'mild' | 'serious' } | null {
  const ambition = p.personality.ambition
  const years = p.contract.yearsRemaining

  // Trade demand: deeply unhappy and ambitious.
  if (p.morale < 24 && ambition >= 14) {
    return { kind: 'tradeRequest', severity: 'serious' }
  }
  // Contract/future talk: deal running out, wants clarity.
  if (years <= 1 && ambition >= 12 && p.morale < 60) {
    return { kind: 'future', severity: p.morale < 40 ? 'serious' : 'mild' }
  }
  // Ice-time / bigger role: ambitious player who isn't thrilled.
  if (ambition >= 15 && p.morale < 52 && p.form <= 0) {
    return { kind: 'iceTime', severity: 'mild' }
  }
  // Teammate friction.
  if (firstFeud(lr, p.id as unknown as string) && p.personality.temperament >= 13) {
    return { kind: 'feud', severity: 'mild' }
  }
  // Generally unsettled.
  if (p.morale < 38) {
    return { kind: 'unhappy', severity: p.morale < 25 ? 'serious' : 'mild' }
  }
  return null
}

function messageFor(_p: Player, kind: InteractionKind, feudName: string | null): string {
  // First person — the player is speaking directly TO the GM (this is voiced on the
  // phone and read as his own words on the inbox card), not narrated in the third
  // person (#1).
  switch (kind) {
    case 'tradeRequest':
      return `I need to be straight with you — I'm not happy here. I think it's best for both of us if you move me. I want out.`
    case 'future':
      return `I wanted to talk about my future. My deal's winding down, and I need to know where I stand with you.`
    case 'iceTime':
      return `I feel like I'm ready for more out there — a bigger role, more responsibility. What's your plan for me?`
    case 'feud':
      return `I've got to be honest with you: there's friction in that room${feudName ? ` with ${feudName}` : ''}, and it's starting to get into my head on the ice.`
    case 'unhappy':
    default:
      return `Something's been off with me lately. Can we sit down and talk about where things are at?`
  }
}

function optionsFor(kind: InteractionKind): InteractionOption[] {
  switch (kind) {
    case 'tradeRequest':
      return [
        { id: 'promise',    label: 'Promise to explore his options',    tone: 'promise' },
        { id: 'supportive', label: 'Tell him he’s central to your plans', tone: 'supportive' },
        { id: 'firm',       label: 'Make clear he’s going nowhere',  tone: 'firm' },
        { id: 'dismissive', label: 'Tell him to honour his contract',    tone: 'dismissive' },
      ]
    case 'future':
      return [
        { id: 'promise',    label: 'Promise a new deal is coming',       tone: 'promise' },
        { id: 'supportive', label: 'Reassure him he’s valued',      tone: 'supportive' },
        { id: 'firm',       label: 'Say it depends on his form',         tone: 'firm' },
        { id: 'dismissive', label: 'Brush off the conversation',         tone: 'dismissive' },
      ]
    case 'iceTime':
      return [
        { id: 'promise',    label: 'Promise a bigger role',              tone: 'promise' },
        { id: 'supportive', label: 'Encourage him to keep pushing',      tone: 'supportive' },
        { id: 'firm',       label: 'Tell him to earn it',                tone: 'firm' },
        { id: 'dismissive', label: 'Dismiss his concerns',              tone: 'dismissive' },
      ]
    case 'feud':
      return [
        // E3 audit: this used to PROMISE to address the room — an action the
        // game had no way to perform or check. Choosing it now does it.
        { id: 'supportive', label: 'Step in and address the room',      tone: 'supportive' },
        { id: 'firm',       label: 'Tell him to sort it out himself',    tone: 'firm' },
        { id: 'dismissive', label: 'Tell him to focus on hockey',        tone: 'dismissive' },
      ]
    case 'unhappy':
    default:
      return [
        { id: 'supportive', label: 'Hear him out and reassure him',      tone: 'supportive' },
        { id: 'firm',       label: 'Challenge him to respond on the ice', tone: 'firm' },
        { id: 'dismissive', label: 'Tell him to get on with it',        tone: 'dismissive' },
      ]
  }
}

/**
 * Maybe raise a concern for this player today. Returns null if the player has
 * nothing to say or stays quiet on the dice roll. `nextId` supplies the unique
 * id; `feudName` is the display name of any feuding teammate (for the message).
 */
export function maybeRaiseInteraction(args: {
  player: Player
  lockerRoom: LockerRoomState | null
  feudName: string | null
  year: number
  day: number
  rng: Rng
  nextId: string
}): PlayerInteraction | null {
  const chosen = chooseKind(args.player, args.lockerRoom)
  if (!chosen) return null
  if (!args.rng.chance(SPEAK_CHANCE[chosen.kind])) return null

  return {
    id: args.nextId,
    playerId: args.player.id as unknown as string,
    teamId: '',
    year: args.year,
    day: args.day,
    kind: chosen.kind,
    severity: chosen.severity,
    message: messageFor(args.player, chosen.kind, args.feudName),
    options: optionsFor(chosen.kind),
    status: 'open',
  }
}

/* ─────────────────────────── response effects ─────────────────────────── */

/** Base morale swing per tone, before personality and history. */
const TONE_BASE: Record<ResponseTone, number> = {
  promise: 12,
  supportive: 8,
  firm: 2,
  dismissive: -10,
}

function clampDelta(v: number): number {
  return Math.round(Math.max(-40, Math.min(40, v)))
}

/**
 * What this man has already heard from you — the HISTORY half of the tone
 * model. Built by the career layer from the resolved interactions and the
 * promise ledger. All optional: absent = a first conversation.
 */
export interface InteractionHistory {
  /** Times he has already been answered with warm words (supportive), this
   *  season or last. Reassurance with nothing behind it wears out. */
  supportiveBefore?: number
  /** Promises you made him that you BROKE. A promise from you is worth less. */
  brokenPromises?: number
  /** Promises you made him that you KEPT. Your word carries. */
  keptPromises?: number
}

/**
 * The morale swing of one tone for one man, before severity and the clamp.
 *
 * PHASE 0 (depth audit 2026-09): the old table was promise +12, supportive +8,
 * firm +2, dismissive −10 with only professionalism nudging firm — so
 * "supportive" beat "firm" for every player below professionalism 20 and a
 * rational GM clicked it every time. Now the RIGHT answer depends on who he is
 * and what you have already told him (all on the real 1–20 scale):
 *
 *  - supportive lands with the insecure and the unambitious; an ambitious pro
 *    hears it as a pat on the head, and the same reassurance twice is noise.
 *  - firm lands with professionals and the driven; it bruises the fragile.
 *  - a promise is worth what your word is worth — broken ones cost you here,
 *    and the ledger judges the new one later.
 *  - dismissive is almost always wrong, but a pro with no ambition shrugs.
 *
 * LOW temperament is the short fuse (EHM's convention, and the Living
 * Ledger's): it amplifies the swing either way.
 */
export function toneDelta(
  tone: ResponseTone,
  personality: Player['personality'],
  history: InteractionHistory = {}
): number {
  const amb = personality.ambition - 10
  const pro = personality.professionalism - 10
  const det = personality.determination - 10
  let delta = TONE_BASE[tone]
  switch (tone) {
    case 'supportive':
      delta += -0.7 * amb - 0.5 * pro - 5 * Math.min(2, history.supportiveBefore ?? 0)
      break
    case 'firm':
      delta += 0.7 * pro + 0.4 * det - 0.3 * amb
      break
    case 'promise':
      delta += 0.3 * amb - 6 * Math.min(2, history.brokenPromises ?? 0) + 2 * Math.min(2, history.keptPromises ?? 0)
      break
    case 'dismissive':
      delta += 0.5 * pro - 0.3 * amb
      break
  }
  const volatility = 1 + Math.max(0, 10 - personality.temperament) * 0.05
  return delta * volatility
}

/**
 * Apply a GM response. Pure — returns the deltas + prose; the caller mutates the
 * player's morale and the room mood and may push the follow-up news.
 * The swing itself is {@link toneDelta}: personality × history.
 */
export function applyInteractionResponse(args: {
  interaction: PlayerInteraction
  option: InteractionOption
  player: Player
  history?: InteractionHistory
}): InteractionResult {
  const { option, player, interaction } = args

  let delta = toneDelta(option.tone, player.personality, args.history)

  // Serious concerns need more than words or a shrug.
  if (interaction.severity === 'serious' && (option.tone === 'firm' || option.tone === 'dismissive')) {
    delta -= 4
  }
  if (interaction.severity === 'serious' && option.tone === 'supportive') delta -= 2

  const moraleDelta = clampDelta(delta)

  // A dismissed serious trade request / unhappiness hardens into a demand.
  const escalateToTrade =
    (interaction.kind === 'tradeRequest' || interaction.severity === 'serious') &&
    option.tone === 'dismissive' &&
    moraleDelta < 0

  // The captain-adjacent ripple: strong reactions nudge the room a touch.
  const roomMoraleDelta = clampDelta(moraleDelta * 0.15)

  const name = player.name.split(' ').pop() ?? player.name
  let outcome: string
  let news: { headline: string; body: string } | undefined

  if (escalateToTrade) {
    outcome = `${player.name} took the conversation badly and has now formally requested a trade.`
    news = {
      headline: `${player.name} requests a trade`,
      body: `Unhappy with how his concerns were handled, ${player.name} has asked to be moved.`,
    }
  } else {
    outcome = outcomeLine(interaction.kind, option.tone, moraleDelta, name)
  }

  const result: InteractionResult = { moraleDelta, roomMoraleDelta, escalateToTrade, outcome }
  if (news) result.news = news
  return result
}

/**
 * The receipt for a resolved concern. It must agree with BOTH the button the GM
 * pressed and how the player took it: "Tell him to sort it out himself" can land
 * well with a pro, but it can never read "appreciated being heard" (audit F7).
 * Keyed on tone first, then the size of the swing the engine already decided.
 */
export function outcomeLine(kind: InteractionKind, tone: ResponseTone, delta: number, last: string): string {
  const band = delta >= 8 ? 'good' : delta > 0 ? 'ok' : delta === 0 ? 'flat' : delta > -8 ? 'sour' : 'bad'
  if (kind === 'feud') {
    if (tone === 'supportive') {
      return band === 'good' || band === 'ok'
        ? `${last} said that was all he wanted: somebody above the coaches to know.`
        : `${last} wanted it kept between the two of them. He did not want it taken to the whole room.`
    }
    if (tone === 'firm') {
      return band === 'good' || band === 'ok'
        ? `${last} said fine, he'd deal with it himself. He seemed glad to be trusted with it.`
        : band === 'flat'
          ? `${last} said he'd handle it. Whether he does is between him and the other guy now.`
          : `${last} said he'd handle it, in a tone that suggested he'd tried that already.`
    }
    return band === 'good' || band === 'ok' || band === 'flat'
      ? `${last} shrugged and went back to the room. The problem went with him.`
      : `${last} left without saying much. He came to you with a problem and is leaving with the same one.`
  }
  switch (tone) {
    case 'promise':
      return band === 'good'
        ? `${last} shook your hand on it. He will remember exactly what you said.`
        : band === 'ok' || band === 'flat'
          ? `${last} took the promise. He has heard promises in this business before.`
          : `${last} heard the promise and didn't look like he believed it.`
    case 'supportive':
      return band === 'good'
        ? `${last} left lighter than he came in.`
        : band === 'ok'
          ? `${last} appreciated being heard, even if nothing was promised.`
          : band === 'flat'
            ? `${last} listened politely. It was the same thing he heard last time.`
            : `${last} wanted something concrete and got a pat on the back. It showed.`
    case 'firm':
      return band === 'good' || band === 'ok'
        ? `${last} nodded. He came for a straight answer and got one.`
        : band === 'flat'
          ? `${last} took it without much reaction.`
          : band === 'sour'
            ? `${last} didn't like the answer, but he took it.`
            : `${last} walked out stiff. He wanted help and got a lecture.`
    case 'dismissive':
    default:
      return band === 'good' || band === 'ok' || band === 'flat'
        ? `${last} shrugged it off. He has been around long enough not to take it personally.`
        : band === 'sour'
          ? `${last} heard the brush-off and kept his mouth shut. He won't bring it to you again soon.`
          : `${last} was clearly unhappy with how that went.`
  }
}

/* ─────────────────────── reaction descriptor (RP voice) ─────────────────────── */

/** How the player took the answer — derived ONLY from the engine's resolution. */
export type ReactionDirection =
  | 'escalating' // dismissed → hardened into a trade demand
  | 'pleased' //     clearly happier
  | 'reassured' //   heard, a bit more settled
  | 'neutral' //     took it flatly
  | 'unsettled' //   not thrilled but accepted it
  | 'angry' //       clearly unhappy

/**
 * A JSON-safe summary of a *resolved* interaction, for the personality layer to
 * voice the player's spoken reply. It carries the direction the ENGINE already
 * decided plus personality context; the model turns it into one line of dialogue
 * and never changes the underlying morale/escalation. `outcome` is the
 * deterministic prose shown when no model is available.
 */
export interface ReactionSpec {
  playerName: string
  firstName: string
  kind: InteractionKind
  tone: ResponseTone
  direction: ReactionDirection
  professionalism: number // 1–20
  temperament: number // 1–20
  ambition: number // 1–20
  outcome: string
}

/** Build the reaction descriptor from the already-resolved response. Pure. */
export function reactionSpec(args: {
  interaction: PlayerInteraction
  option: InteractionOption
  player: Player
  result: InteractionResult
}): ReactionSpec {
  const { player, option, interaction, result } = args
  const direction: ReactionDirection = result.escalateToTrade
    ? 'escalating'
    : result.moraleDelta >= 8
      ? 'pleased'
      : result.moraleDelta > 0
        ? 'reassured'
        : result.moraleDelta === 0
          ? 'neutral'
          : result.moraleDelta > -8
            ? 'unsettled'
            : 'angry'
  return {
    playerName: player.name,
    firstName: player.name.split(' ')[0] ?? player.name,
    kind: interaction.kind,
    tone: option.tone,
    direction,
    professionalism: player.personality.professionalism,
    temperament: player.personality.temperament,
    ambition: player.personality.ambition,
    outcome: result.outcome,
  }
}
