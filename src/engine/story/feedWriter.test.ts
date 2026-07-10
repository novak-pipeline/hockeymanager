import { describe, it, expect } from 'vitest'
import {
  buildFeedPrompt,
  sanitizeModelOutput,
  templateFeedWriter,
  localModelFeedWriter,
  selectFeedWriter,
  type WritablePost,
} from './feedWriter'
import { FEED_AUTHORS } from './salience'

const post: WritablePost = {
  authorId: 'analyst',
  channel: 'feed',
  text: 'Riverside sit 4th despite a preseason 11th-place book. That gap is real.',
  facts: {
    kind: 'overperform',
    teamIds: ['t1'],
    numbers: { rank: 4, preseasonRank: 11, gap: 7 },
    priorNote: 'picked 11th before the season',
  },
}
const author = FEED_AUTHORS.analyst!

describe('feedWriter — prompt building', () => {
  it('embeds every fact and the grounding rules', () => {
    const p = buildFeedPrompt(post, author)
    expect(p.user).toContain('rank: 4')
    expect(p.user).toContain('preseasonRank: 11')
    expect(p.user).toContain('gap: 7')
    expect(p.user).toContain('picked 11th before the season')
    // The draft is handed over as the rewrite seed.
    expect(p.user).toContain(post.text)
    // Ironclad rules present.
    expect(p.system.toLowerCase()).toContain('invent no')
    expect(p.system).toContain(String(p.maxWords))
    // Author voice carried through.
    expect(p.system).toContain(author.name)
  })
})

describe('feedWriter — output sanitising', () => {
  it('collapses whitespace, strips wrapping quotes, keeps normal text', () => {
    expect(sanitizeModelOutput('  "Riverside are for real."  ')).toBe('Riverside are for real.')
  })
  it('enforces the word cap with an ellipsis', () => {
    const long = Array.from({ length: 80 }, (_, i) => `w${i}`).join(' ')
    const out = sanitizeModelOutput(long, 10)!
    expect(out.split(' ').length).toBeLessThanOrEqual(11) // 10 words + trailing …
    expect(out.endsWith('…')).toBe(true)
  })
  it('returns null on empty/garbage so the caller can fall back', () => {
    expect(sanitizeModelOutput('   ')).toBeNull()
    expect(sanitizeModelOutput('')).toBeNull()
  })
})

describe('feedWriter — writers + selection', () => {
  it('the template writer returns the deterministic text', async () => {
    const r = await templateFeedWriter.write(post, author)
    expect(r).toEqual({ text: post.text, source: 'template' })
  })

  it('the local writer uses model output when good', async () => {
    const writer = localModelFeedWriter(async () => 'Riverside keep proving the book wrong.')
    const r = await writer.write(post, author)
    expect(r.source).toBe('model')
    expect(r.text).toContain('Riverside')
  })

  it('the local writer falls back to template on empty output or error', async () => {
    const empty = localModelFeedWriter(async () => '   ')
    expect((await empty.write(post, author))).toEqual({ text: post.text, source: 'template' })
    const boom = localModelFeedWriter(async () => { throw new Error('model died') })
    expect((await boom.write(post, author))).toEqual({ text: post.text, source: 'template' })
  })

  it('selection is off by default — template unless enabled AND a runtime is present', () => {
    expect(selectFeedWriter({ localEnabled: false })).toBe(templateFeedWriter)
    expect(selectFeedWriter({ localEnabled: true })).toBe(templateFeedWriter) // enabled but no infer
    expect(selectFeedWriter({ localEnabled: true, infer: async () => 'x' })).not.toBe(templateFeedWriter)
  })
})
