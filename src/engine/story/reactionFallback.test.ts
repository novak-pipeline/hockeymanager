import { describe, expect, it } from 'vitest'
import type { ReactionSpec } from '@engine/league/interactions'
import { fallbackReactionLine } from './reactionVoice'
import { looksLikeNarration } from './spokenText'

const DIRECTIONS: ReactionSpec['direction'][] = [
  'escalating', 'pleased', 'reassured', 'neutral', 'unsettled', 'angry',
]
const KINDS: ReactionSpec['kind'][] = ['iceTime', 'future', 'tradeRequest', 'feud', 'unhappy']

function spec(over: Partial<ReactionSpec> = {}): ReactionSpec {
  return {
    playerName: 'Blake Lizotte',
    firstName: 'Blake',
    kind: 'iceTime',
    tone: 'supportive',
    direction: 'reassured',
    professionalism: 12,
    temperament: 10,
    ambition: 12,
    outcome: 'Lizotte appreciated being heard, even if nothing was promised.',
    ...over,
  }
}

/**
 * The authored floor. Without it the inbox fell back to `spec.outcome` — the
 * engine's narration — and both quoted it and spoke it as the player's own
 * words. Every branch the engine can resolve must have a line he could actually
 * say out loud.
 */
describe('fallbackReactionLine', () => {
  it('covers every resolved direction with a non-empty line', () => {
    for (const direction of DIRECTIONS) {
      const line = fallbackReactionLine(spec({ direction }))
      expect(line.length, direction).toBeGreaterThan(0)
    }
  })

  it('never returns narration about the player', () => {
    for (const direction of DIRECTIONS) {
      for (const kind of KINDS) {
        const s = spec({ direction, kind })
        const line = fallbackReactionLine(s)
        expect(looksLikeNarration(line, s.playerName), `${direction}/${kind}: ${line}`).toBe(false)
        expect(line, `${direction}/${kind}`).not.toContain('Lizotte')
      }
    }
  })

  it('speaks in the first person', () => {
    for (const direction of DIRECTIONS) {
      const line = fallbackReactionLine(spec({ direction }))
      expect(line, direction).toMatch(/\b(I|I'm|I've|I'd|I'll|me|my)\b/)
    }
  })

  it('is deterministic — the same man in the same spot says the same thing', () => {
    const a = fallbackReactionLine(spec())
    const b = fallbackReactionLine(spec())
    expect(a).toBe(b)
  })

  it('does not give every player the same line', () => {
    const heard = new Set(
      ['Blake Lizotte', 'Alex Nyberg', 'Sam Rautio', 'Teemu Kallio', 'Jon Ward', 'Milan Drozd']
        .map((playerName) => fallbackReactionLine(spec({ playerName }))),
    )
    expect(heard.size).toBeGreaterThan(1)
  })
})
