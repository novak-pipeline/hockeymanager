/**
 * speechChunks.ts — split a line of dialogue into speakable chunks.
 *
 * Synthesis cost is roughly linear in characters, so a long message synthesised
 * whole means a long wait before ANY sound. Chunked at sentence boundaries,
 * playback starts after the first chunk and the rest are produced while it plays.
 *
 * Lives apart from the engine so the pure text logic can be unit-tested (and
 * imported by the phone-call tests) without dragging in kokoro-js or WebAudio.
 */

/** Target and hard-cap chunk sizes, in characters. Small enough that the first
 *  chunk synthesises quickly, large enough that the delivery still phrases like
 *  a person talking rather than a list of sentences. */
const CHUNK_TARGET = 110
const CHUNK_MAX = 220

/** The OPENING chunk is held shorter than the rest. Nothing can be heard until
 *  it is finished, so its length alone sets the silence between the click and
 *  the first word; every later chunk is produced while the previous one plays
 *  and can afford to be long enough to phrase well. */
const FIRST_CHUNK_TARGET = 60

/**
 * Split a line into speakable chunks at sentence boundaries.
 *
 * Sentences shorter than the target are merged so delivery doesn't turn choppy;
 * a single sentence longer than CHUNK_MAX is broken at a clause boundary, and
 * failing that at a word boundary — never mid-word.
 */
export function chunkForSpeech(text: string): string[] {
  const clean = text.trim()
  // A line that is one chunk anyway is left whole — splitting it would only add
  // a seam in the middle of a single sentence for no latency gain.
  if (clean.length <= CHUNK_TARGET) return clean ? [clean] : []
  const sentences = clean.split(/(?<=[.!?…])\s+/).filter((s) => s.trim().length > 0)
  const out: string[] = []
  let buf = ''
  const flush = (): void => { if (buf.trim()) out.push(buf.trim()); buf = '' }
  for (const s of sentences) {
    for (const piece of splitLong(s)) {
      const target = out.length === 0 ? FIRST_CHUNK_TARGET : CHUNK_TARGET
      if (buf && (buf.length + 1 + piece.length) > target) flush()
      buf = buf ? `${buf} ${piece}` : piece
    }
  }
  flush()
  return out
}

/** Break one over-long sentence at a clause boundary, else at word boundaries. */
function splitLong(sentence: string): string[] {
  if (sentence.length <= CHUNK_MAX) return [sentence]
  const clauses = sentence.split(/(?<=[,;:—])\s+/)
  const out: string[] = []
  for (const c of clauses) {
    if (c.length <= CHUNK_MAX) { out.push(c); continue }
    let line = ''
    for (const word of c.split(/\s+/)) {
      if (line && (line.length + 1 + word.length) > CHUNK_MAX) { out.push(line); line = '' }
      line = line ? `${line} ${word}` : word
    }
    if (line) out.push(line)
  }
  return out
}
