import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bankKey, resolveBankEntry } from './commentaryAudio'
import { spokenName } from '../../render2d/broadcast/pronunciation'

const bank = (keys: string[]): Map<string, { source: string; file: string }> =>
  new Map(keys.map((k, i) => [k, { source: 'fictional', file: `n${i}.ogg` }]))

describe('booth name banks', () => {
  it('finds a player by the exact text the game resolves for him', () => {
    const p = { id: '7', name: 'Martin Nečas', nationality: 'Czech Republic' }
    const text = spokenName(p).surname
    const hit = resolveBankEntry(bank([bankKey('pbp', 'excited', text)]), p, 'surname', 'excited', 'pbp', null)
    expect(hit?.key).toBe(`pbp|excited|${text}`)
  })

  it('keys by seat and inflection: a neutral clip never answers an excited slot', () => {
    const p = { id: '1', name: 'Owen Hollis' }
    const b = bank([bankKey('pbp', 'neutral', 'Hollis')])
    expect(resolveBankEntry(b, p, 'surname', 'excited', 'pbp', null)).toBeNull()
    expect(resolveBankEntry(b, p, 'surname', 'neutral', 'color', null)).toBeNull()
    expect(resolveBankEntry(b, p, 'surname', 'neutral', 'pbp', null)).not.toBeNull()
  })

  it('falls back to the nationality-free spelling (a regen the bank met without a nation)', () => {
    const p = { id: '2', name: 'Kasper Grönvall', nationality: 'Sweden' }
    const plain = spokenName({ id: '2', name: 'Kasper Grönvall' }).surname
    expect(plain).not.toBe(spokenName(p).surname)
    const hit = resolveBankEntry(bank([bankKey('pbp', 'excited', plain)]), p, 'surname', 'excited', 'pbp', null)
    expect(hit).not.toBeNull()
  })

  it('a name no bank has resolves to nothing (the line plays bare)', () => {
    expect(resolveBankEntry(bank([]), { id: '3', name: 'Nobody Special' }, 'surname', 'excited', 'pbp', null)).toBeNull()
  })

  it('a respelling in the mod pronunciation file changes the key the booth looks for', () => {
    const p = { id: '4', name: 'Adam Hronek', externalId: 'x-4' }
    const file = { version: 1 as const, byExternalId: { 'x-4': 'AH-dum HRAW-nek' } }
    const hit = resolveBankEntry(bank([bankKey('pbp', 'excited', 'hraw-nek')]), p, 'surname', 'excited', 'pbp', file)
    expect(hit).not.toBeNull()
  })
})

describe('booth never synthesises at runtime', () => {
  it('commentaryAudio.ts loads no TTS engine (no Kokoro, no worker renderer)', () => {
    const src = readFileSync(join(__dirname, 'commentaryAudio.ts'), 'utf8')
    const imports = src.split('\n').filter((l) => /^import /.test(l)).join('\n')
    expect(imports).not.toMatch(/kokoro|voice\.worker|\/speak'|announcer|transformers|onnx/i)
  })
})
