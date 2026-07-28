/**
 * Feed C (#149) — the local-AI writer layer, dependency-free by design.
 *
 * Every Feed post already ships with two things: `text` (a deterministic
 * template — the always-on FLOOR) and `facts: PostFacts` (the structured,
 * prose-free payload). This module turns those facts into a tight, GROUNDED
 * prompt and defines a pluggable writer so an opt-in local model can rewrite the
 * post in natural prose (the CEILING) — while the template stays the fallback.
 *
 * Crucially this file imports NOTHING native. The model runtime is injected as
 * an `infer(prompt) => Promise<string>` function, so the engine/tests stay pure
 * and the actual node-llama-cpp adapter lives in the main process (see
 * docs/THE-FEED.md for the Steam-ready runtime/model decision). Swap in a real
 * `infer` and the ceiling lights up with no changes here.
 */

import type { FeedAuthor, PostFacts } from './salience'
import { HUMAN_VOICE_RULES } from './humanVoice'

/** The minimal post shape the writer needs (a SalienceCandidate satisfies it). */
export interface WritablePost {
  authorId: string
  channel: 'feed' | 'wire'
  /** The deterministic template rendering — the floor + the rewrite seed. */
  text: string
  facts: PostFacts
}

export interface FeedPrompt {
  system: string
  user: string
  /** Hard word cap the caller should also enforce on the output. */
  maxWords: number
}

/** How each author voice should read, kept in one place. */
const VOICE: Record<FeedAuthor['kind'], string> = {
  insider: 'a terse, plugged-in insider breaking news — short, confident, no fluff',
  analyst: 'a columnist with a sharp take grounded in the numbers',
  stats: 'a numbers-forward analytics account — lead with the figure',
  wire: 'an official league wire — dry, factual, neutral',
  player: 'an NHL player posting on his own account — first person, casual, emoji welcome, never corporate',
  gm: 'a team general manager speaking for the front office — confident PR, measured, on the record',
}

const MAX_WORDS = 55

/** Render the fact payload into readable "receipts" lines for the prompt. */
function factLines(facts: PostFacts): string {
  const lines: string[] = []
  for (const [k, v] of Object.entries(facts.numbers)) lines.push(`- ${k}: ${v}`)
  if (facts.priorNote) lines.push(`- prior expectation (cite this): ${facts.priorNote}`)
  return lines.join('\n')
}

/**
 * Build a grounded prompt from a post's facts. The rules are ironclad (the same
 * spirit as the press personas): rewrite ONLY from the given facts + wire draft,
 * invent nothing, stay under the word cap. The template text is handed over as a
 * draft to make more natural — not a source of new claims.
 */
export function buildFeedPrompt(post: WritablePost, author: FeedAuthor): FeedPrompt {
  const voice = VOICE[author.kind]
  const system =
    `You are ${author.name} (@${author.handle}), ${voice}, posting to a hockey feed.\n` +
    `Rewrite the DRAFT below into one natural post in your voice.\n\n` +
    `IRONCLAD RULES — never break:\n` +
    `- Use ONLY the facts listed and the draft. Invent NO names, numbers, teams, injuries, quotes or results.\n` +
    `- Keep every number exactly as given. If a fact isn't listed, don't mention it.\n` +
    `- One post, at most ${MAX_WORDS} words. No hashtags, no emoji, no @-mentions, no line breaks.\n` +
    `- Plain declarative prose. Don't preface with "Here's" or restate the instructions.\n\n` +
    `HOW TO WRITE IT: ${HUMAN_VOICE_RULES}`
  const user =
    `FACTS:\n${factLines(post.facts)}\n\n` +
    `DRAFT (make this read naturally; keep the facts):\n${post.text}`
  return { system, user, maxWords: MAX_WORDS }
}

/** Clean a raw model completion into a safe, single-line post; empty ⇒ null so
 *  the caller can fall back to the template. Enforces the word cap and strips
 *  the things the rules forbade (line breaks, surrounding quotes, stray @/#). */
export function sanitizeModelOutput(raw: string, maxWords = MAX_WORDS): string | null {
  let t = (raw ?? '').replace(/\s+/g, ' ').trim()
  // Strip a wrapping pair of quotes some models add.
  t = t.replace(/^["'“”]+/, '').replace(/["'“”]+$/, '').trim()
  if (t.length < 3) return null
  const words = t.split(' ')
  if (words.length > maxWords) t = words.slice(0, maxWords).join(' ').replace(/[,;:]\s*$/, '') + '…'
  return t
}

export interface WriteResult {
  text: string
  /** Where the prose came from — lets the UI badge model-written posts if wanted. */
  source: 'model' | 'template'
}

export interface FeedWriter {
  write(post: WritablePost, author: FeedAuthor): Promise<WriteResult>
}

/** The floor: hand back the deterministic template text. Always available. */
export const templateFeedWriter: FeedWriter = {
  async write(post) {
    return { text: post.text, source: 'template' }
  },
}

/** A local-model writer built from an injected inference function. Falls back to
 *  the template on empty/garbage output or an inference error, so a flaky model
 *  can never blank the Feed. `infer` is provided by the main-process runtime
 *  adapter (node-llama-cpp) — this module never imports it. */
export function localModelFeedWriter(
  infer: (prompt: FeedPrompt) => Promise<string>,
): FeedWriter {
  return {
    async write(post, author) {
      try {
        const raw = await infer(buildFeedPrompt(post, author))
        const clean = sanitizeModelOutput(raw)
        if (clean) return { text: clean, source: 'model' }
      } catch {
        /* fall through to template */
      }
      return { text: post.text, source: 'template' }
    },
  }
}

export interface FeedWriterConfig {
  /** GM opted into the local writer AND the model is downloaded + ready. */
  localEnabled: boolean
  /** The runtime adapter, present only when a model is loaded. */
  infer?: (prompt: FeedPrompt) => Promise<string>
}

/** Pick the active writer: the local model when enabled + ready, else the
 *  template floor. Off by default — nothing changes until a runtime is wired. */
export function selectFeedWriter(config: FeedWriterConfig): FeedWriter {
  if (config.localEnabled && config.infer) return localModelFeedWriter(config.infer)
  return templateFeedWriter
}
