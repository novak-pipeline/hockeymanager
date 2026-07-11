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
