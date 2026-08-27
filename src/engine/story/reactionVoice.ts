/**
 * Voice a player's spoken reply to a GM meeting — an AUTHOR-around-a-resolved-
 * branch use of the personality layer.
 *
 * The interaction engine (`interactions.ts`) has ALREADY decided the outcome:
 * the morale delta, whether it escalated to a trade demand, and a deterministic
 * `outcome` line. This module turns that resolved `ReactionSpec` into one line of
 * in-character dialogue. The model never changes the delta or the escalation — it
 * only chooses the *words* for a reaction the engine already resolved, so two
 * players with identical deltas can sound completely different while the sim
 * stays byte-identical.
 *
 * Pure and dependency-free (type-import only). The renderer injects the inference
 * call; when the model is absent/errored, callers fall back to `spec.outcome`.
 */

import type { ReactionSpec } from '@engine/league/interactions'
import { HUMAN_VOICE_RULES } from './humanVoice'

/** What the concern was about, phrased for the prompt. */
const TOPIC: Record<ReactionSpec['kind'], string> = {
  iceTime: 'wanting a bigger role and more ice time',
  future: 'his contract and his future at the club',
  tradeRequest: 'wanting to be traded',
  feud: 'friction with a teammate',
  unhappy: 'feeling unsettled lately',
}

/** The mood the line must land, keyed to the engine-decided direction. */
const MOOD: Record<ReactionSpec['direction'], string> = {
  escalating: 'He is done talking and wants out — cold and final, the moment he decides to demand a trade.',
  pleased: 'Genuinely happy and reassured — warm, a little relieved.',
  reassured: 'Feels heard even though nothing was promised — measured, a bit more settled.',
  neutral: 'Takes it on board flatly — non-committal, keeping his cards close.',
  unsettled: 'Not thrilled but accepting it — a flicker of frustration held back.',
  angry: 'Clearly unhappy and letting it show — terse and sharp.',
}

function persona(spec: ReactionSpec): string {
  const bits: string[] = []
  bits.push(
    spec.professionalism >= 14
      ? 'a consummate professional who stays measured'
      : spec.professionalism <= 7
        ? 'not the most professional — quick to sulk'
        : 'fairly even-keeled',
  )
  if (spec.temperament >= 14) bits.push('volatile, wears his emotions openly')
  else if (spec.temperament <= 7) bits.push('unusually calm, hard to read')
  if (spec.ambition >= 15) bits.push('fiercely ambitious')
  return bits.join('; ')
}

export interface ReactionPrompt {
  system: string
  user: string
  maxTokens: number
}

export function buildReactionPrompt(spec: ReactionSpec): ReactionPrompt {
  const system = [
    "You voice a professional hockey player's spoken reaction to a private meeting with his GM.",
    'Write ONE short line of dialogue — at most 25 words, in his own voice.',
    'No quotation marks, no name label, no stage directions, no narration. Just the words he says.',
    'Match the mood exactly. Do not invent stats, trades, promises, or events — react only to how the conversation felt.',
    `HOW HE TALKS: ${HUMAN_VOICE_RULES}`,
  ].join('\n')
  const user = [
    `Player: ${spec.playerName}. Personality: ${persona(spec)}.`,
    `He came in about ${TOPIC[spec.kind]}. The GM's tone was ${spec.tone}.`,
    `His mood as he leaves: ${MOOD[spec.direction]}`,
    'His one-line reaction:',
  ].join('\n')
  return { system, user, maxTokens: 48 }
}

/**
 * Clean the model's line: drop code fences, a leading speaker label, and
 * wrapping quotes; keep a single line; cap the length. Returns '' when nothing
 * usable is left (the caller then shows the deterministic `outcome`).
 */
export function sanitizeReactionLine(raw: string, _playerName: string): string {
  let s = (raw ?? '').trim()
  if (!s) return ''
  s = s.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim()
  s = (s.split('\n').map((l) => l.trim()).find(Boolean)) ?? ''
  s = s.replace(/^[A-Za-z .'’-]{1,24}:\s+/, '') // strip a short "Name:" speaker label
  s = s.replace(/^["'“”]+|["'“”]+$/g, '').trim()
  if (s.length > 220) s = `${s.slice(0, 219).trimEnd()}…`
  return s
}

/* ────────────────────── the authored floor ──────────────────────────────
 *
 * `spec.outcome` is NARRATION — "Lizotte appreciated being heard, even if
 * nothing was promised." It belongs on a card, not in a mouth, and when the
 * local writer was unavailable the inbox used it as the player's own line and
 * spoke it aloud: the voice talked about the man standing in front of you, in
 * the third person. The rule is only ever to speak what is actually SAID, so
 * there has to be a deterministic first-person line for every branch the engine
 * can resolve — the model raises the ceiling, it is not the floor.
 *
 * Selection is seeded on the player and the topic, so the same man in the same
 * situation says the same thing twice, and two different men do not.
 */

/** Lines are written to work for any topic; the mood is what has to land. */
const FALLBACK_LINES: Record<ReactionSpec['direction'], readonly string[]> = {
  escalating: [
    "Then we're done talking. Get me out of here — I'll take the call from anyone.",
    "That's the answer, is it. Fine. Find me a team that wants me, because this one clearly doesn't.",
    "I've said my piece twice now. Next time you hear from me it'll be through my agent.",
    "No. I'm not doing another year of this. Move me.",
  ],
  pleased: [
    "That's all I wanted to hear. I'll go and earn it.",
    "Appreciate you being straight with me. You'll see it on the ice.",
    "Good. That's the conversation I came in for — thanks for taking it seriously.",
    "Honestly? That's a weight off. I'll be fine.",
  ],
  reassured: [
    "I hear you. Nothing promised, but I'd rather know where I stand than guess.",
    "Alright. I'll keep my head down and we'll talk again in a month.",
    "That's fair enough. I just needed someone to actually listen to it.",
    "Okay. I'm not going to make noise about it — but I'm not forgetting it either.",
  ],
  neutral: [
    "Right. I'll take that away and think on it.",
    "Understood. Nothing more from me for now.",
    "Sure. We'll see how it goes.",
    "Fine. You know where I am.",
  ],
  unsettled: [
    "Not what I was hoping for, but it's your call. I'll deal with it.",
    "I'll wear it. Doesn't mean I agree with it.",
    "Alright. I'd be lying if I said I was happy, though.",
    "Okay. I'll leave it there before I say something I regret.",
  ],
  angry: [
    "That's rubbish and you know it. I've earned better than that.",
    "So that's it? I come in here and get told to be patient. Great.",
    "Don't sell me that. I've been here long enough to tell when I'm being managed.",
    "Unbelievable. Ask me again in a month and see what mood I'm in.",
  ],
}

/** Small stable hash — same player, same topic, same line. */
function seedOf(spec: ReactionSpec): number {
  const key = `${spec.playerName}|${spec.kind}|${spec.tone}|${spec.direction}`
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * The player's own words for a resolved reaction, with no model involved.
 *
 * Always returns real first-person dialogue — never narration — so a caller can
 * quote it and speak it without checking which writer produced it.
 */
export function fallbackReactionLine(spec: ReactionSpec): string {
  const pool = FALLBACK_LINES[spec.direction]
  return pool[seedOf(spec) % pool.length]!
}
