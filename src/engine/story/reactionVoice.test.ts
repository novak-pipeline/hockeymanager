import { describe, expect, it } from 'vitest'
import type { ReactionSpec } from '@engine/league/interactions'
import { buildReactionPrompt, sanitizeReactionLine } from './reactionVoice'

const BASE: ReactionSpec = {
  playerName: 'Alex Nyberg',
  firstName: 'Alex',
  kind: 'iceTime',
  tone: 'promise',
  direction: 'pleased',
  professionalism: 15,
  temperament: 8,
  ambition: 16,
  outcome: 'Nyberg left the meeting reassured and in good spirits.',
}

describe('buildReactionPrompt', () => {
  it('includes the player, the topic, the tone, and the resolved mood', () => {
    const p = buildReactionPrompt(BASE)
    expect(p.system).toContain('ONE short line')
    expect(p.system.toLowerCase()).toContain('do not invent')
    expect(p.user).toContain('Alex Nyberg')
    expect(p.user).toContain('bigger role')
    expect(p.user).toContain('promise')
    expect(p.user.toLowerCase()).toContain('happy')
    expect(p.maxTokens).toBeLessThanOrEqual(64)
  })

  it('reflects an escalating (trade-demand) mood distinctly from a pleased one', () => {
    const esc = buildReactionPrompt({ ...BASE, direction: 'escalating' })
    expect(esc.user.toLowerCase()).toContain('wants out')
    expect(esc.user).not.toEqual(buildReactionPrompt(BASE).user)
  })

  it('describes personality from the trait numbers', () => {
    const proud = buildReactionPrompt({ ...BASE, professionalism: 4, temperament: 18 })
    expect(proud.user.toLowerCase()).toContain('sulk')
    expect(proud.user.toLowerCase()).toContain('volatile')
  })
})

describe('sanitizeReactionLine', () => {
  it('passes a clean line through', () => {
    expect(sanitizeReactionLine('Appreciate you hearing me out, coach.', 'Alex Nyberg'))
      .toBe('Appreciate you hearing me out, coach.')
  })

  it('strips wrapping quotes, a speaker label, and code fences', () => {
    expect(sanitizeReactionLine('"Thanks for the honesty."', 'Alex Nyberg')).toBe('Thanks for the honesty.')
    expect(sanitizeReactionLine('Nyberg: I hear you, but I want more.', 'Alex Nyberg')).toBe('I hear you, but I want more.')
    expect(sanitizeReactionLine('```\nFine. We’ll see.\n```', 'Alex Nyberg')).toBe('Fine. We’ll see.')
  })

  it('keeps only the first line', () => {
    expect(sanitizeReactionLine('Whatever you say.\n(he shrugs)', 'Alex Nyberg')).toBe('Whatever you say.')
  })

  it('returns empty on blank input (caller falls back to engine prose)', () => {
    expect(sanitizeReactionLine('', 'Alex Nyberg')).toBe('')
    expect(sanitizeReactionLine('   ', 'Alex Nyberg')).toBe('')
  })

  it('caps an over-long ramble', () => {
    const long = sanitizeReactionLine('x'.repeat(400), 'Alex Nyberg')
    expect(long.length).toBeLessThanOrEqual(220)
    expect(long.endsWith('…')).toBe(true)
  })
})
