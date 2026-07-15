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

describe('voiceFor with attribute matching', () => {
  it('a female owner gets a female voice; a male gets a male voice', () => {
    expect(voiceFor('owner', 'Jane Doe', { gender: 'F' })).toMatch(/^[ab]f_/)
    expect(voiceFor('owner', 'John Doe', { gender: 'M' })).toMatch(/^[ab]m_/)
  })

  it('a British-Isles nationality gets a British voice; North American gets American', () => {
    expect(voiceFor('player', 'Liam Reid', { gender: 'M', nationality: 'England' })).toMatch(/^bm_/)
    expect(voiceFor('player', 'Connor Smith', { gender: 'M', nationality: 'Canada' })).toMatch(/^am_/)
    expect(voiceFor('player', 'Erik Karlsson', { gender: 'M', nationality: 'Sweden' })).toMatch(/^am_/)
  })

  it('an older/gruff player gets a deeper voice than a young one', () => {
    const oldVet = voiceFor('player', 'Old Vet', { gender: 'M', nationality: 'Canada', age: 37 })
    const rookie = voiceFor('player', 'Kid Rookie', { gender: 'M', nationality: 'Canada', age: 19 })
    expect(['am_fenrir', 'am_onyx', 'am_eric', 'am_santa']).toContain(oldVet)
    expect(['am_liam', 'am_puck', 'am_echo']).toContain(rookie)
  })

  it('is deterministic — same person always maps to the same voice', () => {
    const t = { gender: 'M' as const, nationality: 'Finland', age: 27 }
    expect(voiceFor('player', 'Mikko Rantanen', t)).toBe(voiceFor('player', 'Mikko Rantanen', t))
  })

  it('broadcast roles keep their signature voice even with traits', () => {
    expect(voiceFor('pbp', 'Whoever', { gender: 'F', nationality: 'Canada' })).toBe(voiceFor('pbp'))
  })
})
