import { describe, expect, it } from 'vitest'
import { buildIntentPrompt, parseIntentChoice, type IntentOption } from './interactionIntent'

/** The four-tone menu the engine offers for an iceTime concern. */
const ICE_TIME: IntentOption[] = [
  { id: 'promise', label: 'Promise a bigger role', tone: 'promise' },
  { id: 'supportive', label: 'Encourage him to keep pushing', tone: 'supportive' },
  { id: 'firm', label: 'Tell him to earn it', tone: 'firm' },
  { id: 'dismissive', label: 'Dismiss his concerns', tone: 'dismissive' },
]

/** feud/unhappy concerns have NO promise option. */
const UNHAPPY: IntentOption[] = [
  { id: 'supportive', label: 'Hear him out and reassure him', tone: 'supportive' },
  { id: 'firm', label: 'Challenge him to respond on the ice', tone: 'firm' },
  { id: 'dismissive', label: 'Tell him to get on with it', tone: 'dismissive' },
]

describe('buildIntentPrompt', () => {
  it('lists only the ids on offer and constrains the model to one word', () => {
    const p = buildIntentPrompt({
      playerMessage: 'I feel ready for a bigger role.',
      gmReply: "You've earned it — you'll be on the top line next week.",
      options: ICE_TIME,
    })
    expect(p.system).toContain('promise, supportive, firm, dismissive')
    expect(p.system.toLowerCase()).toContain('exactly one word')
    expect(p.user).toContain('bigger role')
    expect(p.user).toContain('top line')
    expect(p.maxTokens).toBeLessThanOrEqual(8)
  })

  it('omits the promise vocabulary when the interaction has no promise option', () => {
    const p = buildIntentPrompt({
      playerMessage: 'I just feel off lately.',
      gmReply: 'Get on with it.',
      options: UNHAPPY,
    })
    // Vocabulary line lists only the offered ids.
    expect(p.system).toContain('supportive, firm, dismissive')
    expect(p.system).not.toMatch(/one word from this list and nothing else: [^\n]*promise/)
  })

  it('clips very long inputs so the prompt stays small', () => {
    const p = buildIntentPrompt({
      playerMessage: 'x'.repeat(1000),
      gmReply: 'y'.repeat(1000),
      options: ICE_TIME,
    })
    expect(p.user.length).toBeLessThan(900)
  })
})

describe('parseIntentChoice', () => {
  it('matches a clean one-word answer', () => {
    expect(parseIntentChoice('promise', ICE_TIME)?.id).toBe('promise')
    expect(parseIntentChoice('firm', ICE_TIME)?.id).toBe('firm')
  })

  it('is robust to quotes, punctuation, capitalisation and trailing prose', () => {
    expect(parseIntentChoice('"Dismissive."', ICE_TIME)?.id).toBe('dismissive')
    expect(parseIntentChoice('Supportive — reassuring him.', ICE_TIME)?.id).toBe('supportive')
    expect(parseIntentChoice('The answer is: FIRM', ICE_TIME)?.id).toBe('firm')
  })

  it('takes the first offered id when the model rambles past it', () => {
    expect(parseIntentChoice('promise, though a bit firm', ICE_TIME)?.id).toBe('promise')
  })

  it('returns null when nothing on offer appears (never guesses)', () => {
    expect(parseIntentChoice('neutral', ICE_TIME)).toBeNull()
    expect(parseIntentChoice('', ICE_TIME)).toBeNull()
    expect(parseIntentChoice('I have no idea what you mean', ICE_TIME)).toBeNull()
  })

  it('cannot return an option that is not on offer (no accidental promise)', () => {
    // The model hallucinates "promise" for an unhappy concern that has no such option.
    expect(parseIntentChoice('promise', UNHAPPY)).toBeNull()
  })
})
