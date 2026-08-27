import { describe, expect, it } from 'vitest'
import { looksLikeNarration } from './spokenText'

/**
 * The regression this guards is a repeat offender: a line of card prose handed
 * to a character's voice, so the game says "Lizotte appreciated being heard"
 * *in Lizotte's own voice*. The detector has to catch that shape and stay quiet
 * on everything a person might legitimately say.
 */
describe('looksLikeNarration', () => {
  it('catches prose about the speaker in the third person', () => {
    expect(looksLikeNarration(
      'Lizotte appreciated being heard, even if nothing was promised.',
      'Blake Lizotte',
    )).toBe(true)
  })

  it('catches it through a leading speaker label', () => {
    expect(looksLikeNarration(
      'Blake Lizotte: Lizotte took the news badly and left without a word.',
      'Blake Lizotte',
    )).toBe(true)
  })

  it('passes real first-person dialogue', () => {
    expect(looksLikeNarration(
      "I hear you. Nothing promised, but I'd rather know where I stand.",
      'Blake Lizotte',
    )).toBe(false)
  })

  it('passes a man saying his own name inside his own sentence', () => {
    expect(looksLikeNarration(
      "Everyone in here calls me Lizotte. I'd rather they called me a first-liner.",
      'Blake Lizotte',
    )).toBe(false)
  })

  it('passes a speaker talking about somebody else', () => {
    expect(looksLikeNarration(
      'Nyberg has been our best forward for a month.',
      'Blake Lizotte',
    )).toBe(false)
  })

  it('passes a room speaking as "we"', () => {
    expect(looksLikeNarration(
      "We're higher on Lizotte than the rest of the league is.",
      'Wade Hollis',
    )).toBe(false)
  })

  it('says nothing when there is no named speaker to compare against', () => {
    expect(looksLikeNarration('Anything at all.', undefined)).toBe(false)
    expect(looksLikeNarration('Anything at all.', '')).toBe(false)
  })

  it('ignores speakers whose surname is too short to prove anything', () => {
    expect(looksLikeNarration('Wu was pleased with the meeting.', 'Ken Wu')).toBe(false)
  })
})
