/**
 * The house style for anything the local model AUTHORS to look like it came from
 * a real person — a feed post, a player's spoken reply, a pundit's take.
 *
 * This is the GM's own directive, distilled into concrete, model-legible rules
 * (small local models follow imperatives, not abstract meta-instruction). It is
 * injected into the AUTHOR prompts (feed writer, reaction voice) — never the
 * PARSE prompts (intent/offer classification), which extract rather than write.
 *
 * The six directives it encodes:
 *   1. Real person   — rougher, more direct; cut the rehearsed, over-built,
 *                      trying-to-sound-impressive phrasing.
 *   2. Thought flow   — ideas move like a real mind: uneven, sometimes punchy,
 *                      sometimes trailing; vary the pace, don't march.
 *   3. Pattern break  — strip the AI tells; vary sentence shape and length; no
 *                      rigid, balanced, "on the one hand" scaffolding.
 *   4. Voice          — a clear point of view with actual opinions; allow a small
 *                      contradiction or a shift in tone; never flat and neutral.
 *   5. Make it land   — it should hit; cut anything flat, hedged or forgettable;
 *                      sound like someone who actually cares about this.
 *   6. Credibility    — distrust anything too clean. If a line sounds
 *                      constructed, overcorrected or too precise, say the looser
 *                      version a real person would say out loud without second-
 *                      guessing every word.
 */

/** Compact form for tight prompts (feed posts, one-liners). */
export const HUMAN_VOICE_RULES = [
  'Sound like a real person typing fast, not an AI being careful.',
  'Vary your sentence length — a punchy short one, then a longer one. No two-part balanced constructions.',
  'Have an actual opinion. A little edge, a little bias. Never flat or neutral.',
  'Cut anything that sounds rehearsed, over-built or written to impress. Say the plain version.',
  'It should land. If a line is forgettable, sharpen it or drop it.',
  'Distrust anything too clean. If a line sounds constructed or too precise, loosen it — say it the way someone would out loud.',
].join(' ')

/** Full form when there is room (multi-sentence replies, columns). */
export const HUMAN_VOICE_GUIDE = [
  'WRITE LIKE A REAL PERSON, not an AI:',
  '- Be rougher and more direct. Cut the rehearsed, over-built, trying-to-sound-smart phrasing — say the plain version instead.',
  '- Let the thought move like a real mind: uneven pace, a punchy fragment here, a longer thought there. Do not march in even, balanced sentences.',
  '- Strip the AI tells: no "moreover", no "that said", no tidy "on the one hand / on the other", no summarizing bow at the end.',
  '- Have a point of view. Real opinions, a bit of bias, maybe a small contradiction. Never sit on the fence, never sound neutral.',
  '- Make it hit. If a line is flat or forgettable, sharpen it or cut it. Sound like someone who actually cares.',
  '- The credibility test: read it back and distrust anything too clean. If a line sounds constructed, overcorrected or too precise, replace it with the looser version a real person would just say out loud — no second-guessing every word.',
].join('\n')
