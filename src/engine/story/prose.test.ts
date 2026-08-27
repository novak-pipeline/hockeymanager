import { describe, expect, it } from 'vitest'
import type { ContentVariant } from './contentEngine'
import { oneSentence, pickStable, possessive, prosaicList, renderStable, stableSeed } from './prose'

describe('oneSentence — exactly one terminator', () => {
  it('adds a full stop when there is none', () => {
    expect(oneSentence('roster rules')).toBe('roster rules.')
  })

  it('does not double one that is already there', () => {
    // The bug: an authored reason string ends in a full stop, and the caller
    // appends its own — "…after this call-up..".
    expect(oneSentence('The AHL team would be short of F players after this call-up.'))
      .toBe('The AHL team would be short of F players after this call-up.')
    expect(oneSentence('done...')).toBe('done.')
  })

  it('keeps a question or an exclamation', () => {
    expect(oneSentence('really?')).toBe('really?')
    expect(oneSentence('go!')).toBe('go!')
  })

  it('is empty for empty input', () => {
    expect(oneSentence('   ')).toBe('')
  })
})

describe('prosaicList', () => {
  it('joins in the house voice', () => {
    expect(prosaicList([])).toBe('')
    expect(prosaicList(['the draft class'])).toBe('the draft class')
    expect(prosaicList(['the draft class', 'the AHL'])).toBe('the draft class and the AHL')
    expect(prosaicList(['a', 'b', 'c'])).toBe('a, b and c')
  })

  it('drops blanks rather than printing empty slots', () => {
    expect(prosaicList(['a', '', '  ', 'b'])).toBe('a and b')
  })
})

describe('possessive', () => {
  it("gives a name ending in s a bare apostrophe", () => {
    // Half the club names in hockey end in s — "the Stingrays's best player"
    // is the tell of a template with a hard-coded 's.
    expect(possessive('Crystal Bay Stingrays')).toBe("Crystal Bay Stingrays'")
    expect(possessive('Travis')).toBe("Travis'")
  })

  it('gives everything else the full form', () => {
    expect(possessive('Jonas Forsberg')).toBe("Jonas Forsberg's")
    expect(possessive('Harbor City Admirals')).not.toBe("Harbor City Admirals's")
  })

  it('is empty for empty input', () => {
    expect(possessive('  ')).toBe('')
  })
})

describe('pickStable — view-safe authored selection', () => {
  const pool: ContentVariant[] = [
    { id: 'a', text: 'generic one' },
    { id: 'b', text: 'generic two' },
    { id: 'c', text: 'generic three' },
    { id: 'd', conditions: { mood: 'angry' }, text: 'specific' },
    { id: 'e', conditions: { mood: 'angry', minHeat: 5 }, text: 'very specific' },
  ]

  it('most specific eligible variant wins', () => {
    expect(pickStable(pool, { mood: 'angry', heat: 9 }, 'k')?.id).toBe('e')
    expect(pickStable(pool, { mood: 'angry', heat: 1 }, 'k')?.id).toBe('d')
  })

  it('a generic line only serves when nothing specific applies', () => {
    const v = pickStable(pool, { mood: 'calm' }, 'k')
    expect(['a', 'b', 'c']).toContain(v?.id)
  })

  it('same key → same line, forever (a view rebuilds this every render)', () => {
    for (const key of ['p1', 'p2', 'p3']) {
      expect(pickStable(pool, { mood: 'calm' }, key)?.id).toBe(pickStable(pool, { mood: 'calm' }, key)?.id)
    }
  })

  it('different keys spread across the pool', () => {
    const ids = new Set(
      Array.from({ length: 40 }, (_, i) => pickStable(pool, { mood: 'calm' }, `k${i}`)?.id)
    )
    expect(ids.size).toBe(3)
  })

  it('returns null when nothing is eligible', () => {
    expect(pickStable([{ id: 'x', conditions: { mood: 'angry' }, text: 'x' }], { mood: 'calm' }, 'k')).toBeNull()
  })

  it('renderStable fills the slots, and yields empty on no match', () => {
    expect(renderStable([{ id: 'x', text: 'hello {who}' }], {}, 'k', { who: 'world' })).toBe('hello world')
    expect(renderStable([{ id: 'x', conditions: { a: 1 }, text: 'x' }], {}, 'k', {})).toBe('')
  })
})

describe('stableSeed', () => {
  it('is stable and well spread', () => {
    expect(stableSeed('abc')).toBe(stableSeed('abc'))
    expect(stableSeed('abc')).not.toBe(stableSeed('abd'))
    const mod = new Set(Array.from({ length: 200 }, (_, i) => stableSeed(`p${i}`) % 5))
    expect(mod.size).toBe(5)
  })
})
