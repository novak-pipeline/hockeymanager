import { describe, expect, it } from 'vitest'
import { voiceFor, ALL_KOKORO_VOICES, type VoiceRole } from './voiceCast'

const ROLES: VoiceRole[] = ['pbp', 'color', 'coach', 'physio', 'agm', 'scout', 'pundit', 'gm', 'player', 'agent', 'owner']

describe('voiceFor', () => {
  it('gives every role a real Kokoro voice id', () => {
    for (const r of ROLES) {
      const v = voiceFor(r)
      expect(ALL_KOKORO_VOICES).toContain(v)
    }
  })

  it('casts distinct signature voices for distinct staff roles', () => {
    const staff = ['coach', 'physio', 'agm', 'pbp'] as const
    const voices = staff.map((r) => voiceFor(r))
    expect(new Set(voices).size).toBe(staff.length) // all different
  })

  it('varies an individual (player) voice by a stable name seed', () => {
    const a = voiceFor('player', 'Alex Nyberg')
    const b = voiceFor('player', 'Tomas Larsson')
    expect(ALL_KOKORO_VOICES).toContain(a)
    expect(ALL_KOKORO_VOICES).toContain(b)
    // Same name → same voice (deterministic); different names usually differ.
    expect(voiceFor('player', 'Alex Nyberg')).toBe(a)
  })

  it('a fixed-voice role ignores the seed (physio always sounds the same)', () => {
    expect(voiceFor('physio', 'Whoever')).toBe(voiceFor('physio'))
  })

  it('spreads a batch of players across more than one voice', () => {
    const names = Array.from({ length: 12 }, (_, i) => `Player ${i} Xyz`)
    const voices = new Set(names.map((n) => voiceFor('player', n)))
    expect(voices.size).toBeGreaterThan(1)
  })
})
