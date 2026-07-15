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
import type { LockerRoomState, Relationship } from './lockerRoom'

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

function messageFor(p: Player, kind: InteractionKind, feudName: string | null): string {
  const name = p.name.split(' ').pop() ?? p.name
  switch (kind) {
    case 'tradeRequest':
      return `${p.name} has asked to speak with you privately. He's unhappy with his situation and wants a move away from the club.`
    case 'future':
      return `${p.name} wants to talk about his future. With his contract winding down, he's looking for clarity on where he stands.`
    case 'iceTime':
      return `${p.name} feels he's ready for a bigger role and more responsibility on the ice. He wants to know your plans for him.`
    case 'feud':
      return `${p.name} has come to you about friction in the room${feudName ? ` with ${feudName}` : ''}. It's starting to affect his game.`
    case 'unhappy':
    default:
      return `${name} seems unsettled lately. He's asked for a word about how things are going.`
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
        { id: 'supportive', label: 'Promise to address the room',        tone: 'supportive' },
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

/** Base morale swing per tone, before personality scaling. */
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
 * Apply a GM response. Pure — returns the deltas + prose; the caller mutates the
 * player's morale and the room mood and may push the follow-up news.
 *
 * Personality scaling:
 *  - High professionalism players respect a firm message and shrug off being told
 *    no; low-professionalism players sulk.
 *  - Volatile (high temperament) players swing harder in both directions.
 *  - Empty promises (promise tone) feel great now but the career layer can later
 *    punish a broken promise — for v1 we just bank the morale.
 */
export function applyInteractionResponse(args: {
  interaction: PlayerInteraction
  option: InteractionOption
  player: Player
}): InteractionResult {
  const { option, player, interaction } = args
  const pro = player.personality.professionalism // 1–20
  const temperament = player.personality.temperament // 1–20

  let delta = TONE_BASE[option.tone]

  // Professionals reward firmness, take dismissal in stride; flakier players don't.
  if (option.tone === 'firm') delta += (pro - 10) * 0.6
  if (option.tone === 'dismissive') delta += (pro - 10) * 0.5

  // Volatility amplifies the swing.
  const volatility = 1 + Math.max(0, temperament - 10) * 0.05
  delta *= volatility

  // Serious concerns need more than a shrug — firm/dismissive sting more.
  if (interaction.severity === 'serious' && (option.tone === 'firm' || option.tone === 'dismissive')) {
    delta -= 4
  }

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
  } else if (moraleDelta >= 8) {
    outcome = `${name} left the meeting reassured and in good spirits.`
  } else if (moraleDelta > 0) {
    outcome = `${name} appreciated being heard, even if nothing was promised.`
  } else if (moraleDelta === 0) {
    outcome = `${name} took the message on board without much reaction.`
  } else if (moraleDelta > -8) {
    outcome = `${name} wasn't thrilled with the answer but accepted it.`
  } else {
    outcome = `${name} was clearly unhappy with how the conversation went.`
  }

  const result: InteractionResult = { moraleDelta, roomMoraleDelta, escalateToTrade, outcome }
  if (news) result.news = news
  return result
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
