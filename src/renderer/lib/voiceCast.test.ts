import { describe, expect, it } from 'vitest'
import { castFor, voiceFor, ALL_KOKORO_VOICES, CAST_VOICES, type VoiceRole, type VoiceTraits } from './voiceCast'

const ROLES: VoiceRole[] = ['pbp', 'color', 'coach', 'physio', 'agm', 'scout', 'pundit', 'gm', 'player', 'agent', 'owner']

/** kokoro-js model-card grades D/F — never cast (the "off-putting voices" fix). */
const LOW_GRADE = [
  'am_adam', 'am_echo', 'am_eric', 'am_liam', 'am_onyx', 'am_santa',
  'bm_daniel', 'bm_lewis', 'af_jessica', 'af_river', 'bf_alice', 'bf_lily',
]

describe('voiceFor', () => {
  it('gives every role a real Kokoro voice id', () => {
    for (const r of ROLES) {
      const v = voiceFor(r)
      expect(ALL_KOKORO_VOICES).toContain(v)
    }
  })

  it('casts distinct signature voices for the staff-room roles', () => {
    const staff = ['coach', 'physio', 'agm', 'scout'] as const
    const voices = staff.map((r) => voiceFor(r))
    expect(new Set(voices).size).toBe(staff.length) // all different in one scene
  })

  it('varies an individual (player) voice by a stable name seed', () => {
    const a = voiceFor('player', 'Alex Nyberg')
    const b = voiceFor('player', 'Tomas Larsson')
    expect(ALL_KOKORO_VOICES).toContain(a)
    expect(ALL_KOKORO_VOICES).toContain(b)
    // Same name → same voice (deterministic); different names usually differ.
    expect(voiceFor('player', 'Alex Nyberg')).toBe(a)
  })

  it('a fixed-voice role ignores the seed for voice (physio always sounds the same)', () => {
    expect(voiceFor('physio', 'Whoever')).toBe(voiceFor('physio'))
  })

  it('spreads a batch of players across more than one voice', () => {
    const names = Array.from({ length: 12 }, (_, i) => `Player ${i} Xyz`)
    const voices = new Set(names.map((n) => voiceFor('player', n)))
    expect(voices.size).toBeGreaterThan(1)
  })
})

describe('quality gate', () => {
  it('never casts a D/F-grade voice, for any role, seed, or traits', () => {
    const traitSets: Array<VoiceTraits | undefined> = [
      undefined,
      { gender: 'M', age: 19 },
      { gender: 'M', age: 37, gruff: true },
      { gender: 'M', nationality: 'England' },
      { gender: 'F', nationality: 'Scotland' },
      { gender: 'F', demeanor: 'fiery' },
      { gender: 'M', demeanor: 'analytical' },
      { gender: 'M', position: 'D', age: 30 },
    ]
    for (const role of ROLES) {
      for (let i = 0; i < 25; i++) {
        for (const traits of traitSets) {
          const v = voiceFor(role, `Seed Person ${i}`, traits)
          expect(LOW_GRADE).not.toContain(v)
          expect(ALL_KOKORO_VOICES).toContain(v)
        }
      }
    }
  })

  it('CAST_VOICES covers every voice the caster can produce, and none are low-grade', () => {
    for (const v of CAST_VOICES) {
      expect(ALL_KOKORO_VOICES).toContain(v)
      expect(LOW_GRADE).not.toContain(v)
    }
    // Everything castFor can return is in the prefetch list.
    for (const role of ROLES) {
      for (let i = 0; i < 25; i++) {
        expect(CAST_VOICES).toContain(voiceFor(role, `P${i}`, { gender: i % 2 ? 'M' : 'F', age: 18 + i }))
      }
    }
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

  it('an older/gruff player gets a deeper voice; a young one gets a bright voice', () => {
    const oldVet = voiceFor('player', 'Old Vet', { gender: 'M', nationality: 'Canada', age: 37 })
    const rookie = voiceFor('player', 'Kid Rookie', { gender: 'M', nationality: 'Canada', age: 19 })
    expect(['am_fenrir', 'am_michael']).toContain(oldVet)
    expect(['am_puck', 'am_michael']).toContain(rookie)
  })

  it('an older defenceman counts as gruff', () => {
    const d = voiceFor('player', 'Stay At Home', { gender: 'M', position: 'D', age: 29 })
    expect(['am_fenrir', 'am_michael']).toContain(d)
  })

  it('demeanor drives the casting (fiery vs calm)', () => {
    expect(voiceFor('coach', 'Hot Head', { gender: 'M', demeanor: 'fiery' })).toBe('am_fenrir')
    expect(voiceFor('physio', 'Cool Head', { gender: 'F', demeanor: 'calm' })).toBe('af_nicole')
  })

  it('is deterministic — same person always maps to the same voice and rate', () => {
    const t: VoiceTraits = { gender: 'M', nationality: 'Finland', age: 27 }
    expect(castFor('player', 'Mikko Rantanen', t)).toEqual(castFor('player', 'Mikko Rantanen', t))
  })

  it('broadcast roles keep their signature voice and rate even with traits', () => {
    expect(castFor('pbp', 'Whoever', { gender: 'F', nationality: 'Canada' })).toEqual(castFor('pbp'))
  })
})

describe('delivery rate', () => {
  it('stays within sane bounds for any casting', () => {
    for (const role of ROLES) {
      for (let i = 0; i < 20; i++) {
        const { rate } = castFor(role, `Rate Seed ${i}`, { gender: 'M', age: 18 + (i % 25), demeanor: i % 2 ? 'fiery' : 'analytical' })
        expect(rate).toBeGreaterThanOrEqual(0.9)
        expect(rate).toBeLessThanOrEqual(1.2)
      }
    }
  })

  it('differentiates two same-voice characters by rate (seeded jitter)', () => {
    const names = Array.from({ length: 12 }, (_, i) => `Clone ${i}`)
    const rates = new Set(names.map((n) => castFor('coach', n, { gender: 'M', demeanor: 'fiery' }).rate))
    expect(rates.size).toBeGreaterThan(1)
  })

  it('the owner reads slower than the pundit', () => {
    expect(castFor('owner').rate).toBeLessThan(castFor('pundit').rate)
  })
})
