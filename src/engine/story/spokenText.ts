/**
 * spokenText.ts — the "only speak what is actually SAID" smell test.
 *
 * The bug keeps coming back in new places. The inbox once voiced its own card
 * prose; later a player's reply fell back to the engine's narration and the
 * voice said, in his own casting, "Lizotte appreciated being heard, even if
 * nothing was promised." — a sentence *about* the man standing in the room.
 *
 * Every fix so far has been local to one screen. This is the general detector:
 * a line attributed to a named speaker that talks about that speaker in the
 * third person and never once says "I" is narration, not dialogue. speak.ts
 * runs it over every cast line in development and warns; it never silences
 * anything, because a false positive must not cost the GM a line.
 *
 * It lives in engine/story rather than renderer/lib so the authored content that
 * has to satisfy it can be tested next to the pools that produce it.
 *
 * Deliberately narrow. It only fires when the speaker's OWN name appears in
 * their own line with no first-person voice anywhere in it — a commentator
 * naming players, a coach talking about somebody else, or anyone saying "we"
 * all pass untouched.
 */

/** Any marker that the sentence is spoken from inside the speaker's head. */
const FIRST_PERSON = /\b(i|i'm|i've|i'd|i'll|me|my|mine|myself|we|we're|we've|we'd|we'll|us|our|ours)\b/i

/** Last whitespace-separated token of a name — "Blake Lizotte" → "Lizotte". */
function surnameOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1]! : ''
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * True when `text` reads as prose ABOUT `speakerName` rather than words spoken
 * BY them. Returns false for an empty speaker name (nothing to compare against).
 */
export function looksLikeNarration(text: string, speakerName: string | undefined): boolean {
  if (!speakerName) return false
  const surname = surnameOf(speakerName)
  if (surname.length < 3) return false // initials and one-letter tokens prove nothing
  const body = (text ?? '').trim()
  if (!body) return false
  // A leading "Name:" label is a speaker tag, not the speaker naming himself.
  const line = body.replace(new RegExp(`^\\s*${escapeRe(speakerName)}\\s*:\\s*`, 'i'), '')
  if (!new RegExp(`\\b${escapeRe(surname)}\\b`, 'i').test(line)) return false
  return !FIRST_PERSON.test(line)
}
