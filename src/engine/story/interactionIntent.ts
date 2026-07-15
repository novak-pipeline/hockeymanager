/**
 * Freeform GM reply → structured interaction intent.
 *
 * The player-interaction engine (`src/engine/league/interactions.ts`) offers the
 * GM a small menu of response *tones* (promise / supportive / firm / dismissive)
 * and resolves the chosen one deterministically. This module lets the GM instead
 * TYPE his reply in his own words; the local model classifies those words into
 * one of the SAME options the buttons already offer, and the existing
 * deterministic resolver does everything downstream.
 *
 * The boundary is airtight by construction:
 *   • The model's only job is to pick an option `id` from a fixed, per-interaction
 *     list. Its output is matched against that list and *nothing else* — it can
 *     never invent a tone, a number, a morale delta, or a promise. Anything it
 *     says that isn't one of the offered ids resolves to `null` (→ the UI keeps
 *     the buttons; we never guess a response, least of all a promise).
 *   • This module is PURE and dependency-free: `buildIntentPrompt` produces a
 *     `{system,user}` prompt, `parseIntentChoice` turns raw model text back into
 *     a validated option. The renderer injects the actual inference call between
 *     them (same pattern as feedWriter.ts). No engine/worker coupling, no I/O.
 */

/** The minimal option shape we classify against (a subset of InteractionOption). */
export interface IntentOption {
  id: string
  label: string
  tone: string
}

export interface IntentPrompt {
  system: string
  user: string
  maxTokens: number
}

/** Plain-English gloss of each tone, fed to the model so it classifies on meaning. */
const TONE_GLOSS: Record<string, string> = {
  promise:
    'commits to a concrete future action — a bigger role, more ice time, a new contract, or exploring a trade.',
  supportive: 'reassures and encourages him, but stops short of any firm commitment.',
  firm: 'tells him to earn it or that it depends on his form — no promises, but not a brush-off.',
  dismissive: 'brushes him off, shuts the conversation down, or tells him to just get on with it.',
}

/**
 * Build the classification prompt. Only the tones actually on offer for THIS
 * interaction are listed, so the model's vocabulary is constrained to valid ids.
 */
export function buildIntentPrompt(args: {
  /** What the player said to the GM (the concern message). */
  playerMessage: string
  /** The GM's freeform reply, in his own words. */
  gmReply: string
  /** The options available for this interaction. */
  options: IntentOption[]
}): IntentPrompt {
  const ids = args.options.map((o) => o.id)
  const menu = args.options
    .map((o) => `- ${o.id}: ${TONE_GLOSS[o.tone] ?? o.label.toLowerCase()}`)
    .join('\n')

  const system = [
    "You classify a hockey general manager's reply to one of his players.",
    'Read the reply and choose the single response style whose meaning best matches it.',
    `Answer with EXACTLY ONE word from this list and nothing else: ${ids.join(', ')}.`,
    'The styles mean:',
    menu,
    'If the reply is ambiguous, pick the closest style. Output only the one word.',
  ].join('\n')

  const user = [
    `The player said: "${clip(args.playerMessage, 240)}"`,
    `The GM replied: "${clip(args.gmReply, 400)}"`,
    'Which style is the GM using? One word:',
  ].join('\n')

  return { system, user, maxTokens: 6 }
}

/**
 * Turn raw model output into a validated option. Resilient to the small model
 * adding quotes, punctuation, or a stray sentence: we scan for the FIRST offered
 * option id that appears as a whole word. Returns `null` when nothing on offer is
 * found — the caller then falls back to the button menu rather than guessing.
 */
export function parseIntentChoice(raw: string, options: IntentOption[]): IntentOption | null {
  if (!raw) return null
  // Whole-word token stream, lowercased. `firm.` / `"promise"` / `Firm — ...`
  // all reduce to clean tokens.
  const tokens = raw.toLowerCase().match(/[a-z]+/g)
  if (!tokens) return null
  const byId = new Map(options.map((o) => [o.id.toLowerCase(), o]))
  for (const tok of tokens) {
    const hit = byId.get(tok)
    if (hit) return hit
  }
  return null
}

function clip(s: string, max: number): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}
