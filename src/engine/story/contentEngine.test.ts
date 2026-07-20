/**
 * Content Engine (Narrative Engine layer 1) — the Hades model:
 * most-specific eligible variant wins, nothing repeats verbatim within a
 * season, exhausted pools recycle least-recently-used rather than going
 * silent, and callback blocks render real history or vanish cleanly.
 */
import { describe, expect, it } from 'vitest'
import { Rng } from '@engine/shared/rng'
import {
  isEligible,
  markUsed,
  renderTemplate,
  selectVariant,
  type ContentUse,
  type ContentVariant,
} from './contentEngine'

const POOL: ContentVariant[] = [
  { id: 'generic', text: 'The team lost again.' },
  { id: 'streak', conditions: { minStreak: 4 }, text: 'Four straight now.' },
  { id: 'streak.fiery', conditions: { minStreak: 4, coach: 'fiery' }, text: 'The coach skipped the podium.' },
  { id: 'streak.calm', conditions: { minStreak: 4, coach: 'calm' }, text: 'Eleven quiet minutes on zone exits.' },
]

describe('contentEngine — matching & specificity', () => {
  it('min/max prefixes gate numerically; everything else is strict equality', () => {
    expect(isEligible({ id: 'a', conditions: { minStreak: 4 }, text: '' }, { streak: 5 })).toBe(true)
    expect(isEligible({ id: 'a', conditions: { minStreak: 4 }, text: '' }, { streak: 3 })).toBe(false)
    expect(isEligible({ id: 'a', conditions: { maxStreak: 2 }, text: '' }, { streak: 2 })).toBe(true)
    expect(isEligible({ id: 'a', conditions: { maxStreak: 2 }, text: '' }, { streak: 3 })).toBe(false)
    expect(isEligible({ id: 'a', conditions: { coach: 'fiery' }, text: '' }, { coach: 'calm' })).toBe(false)
  })

  it('the most specific eligible variant wins — generic only fires as a last resort', () => {
    const rng = new Rng(1)
    const v = selectVariant({ pool: POOL, ctx: { streak: 5, coach: 'fiery' }, rng, ledger: [], year: 2025 })
    expect(v?.id).toBe('streak.fiery')
    const v2 = selectVariant({ pool: POOL, ctx: { streak: 5, coach: 'stoic' }, rng, ledger: [], year: 2025 })
    expect(v2?.id).toBe('streak')
    const v3 = selectVariant({ pool: POOL, ctx: { streak: 1 }, rng, ledger: [], year: 2025 })
    expect(v3?.id).toBe('generic')
  })

  it('returns null only when nothing at all is eligible', () => {
    const strict: ContentVariant[] = [{ id: 'only', conditions: { minStreak: 9 }, text: 'x' }]
    expect(selectVariant({ pool: strict, ctx: { streak: 1 }, rng: new Rng(1), ledger: [], year: 2025 })).toBeNull()
  })
})

describe('contentEngine — the no-repeat ledger (B4.5)', () => {
  it('a variant used this season is skipped; the next-best fresh one serves', () => {
    const ledger: ContentUse[] = []
    const ctx = { streak: 5, coach: 'fiery' }
    const first = selectVariant({ pool: POOL, ctx, rng: new Rng(1), ledger, year: 2025 })!
    markUsed(ledger, first.id, 2025, 10)
    const second = selectVariant({ pool: POOL, ctx, rng: new Rng(1), ledger, year: 2025 })!
    expect(second.id).not.toBe(first.id)
    expect(second.id).toBe('streak') // the next most specific fresh variant
  })

  it('an exhausted pool recycles the least-recently-used instead of going silent', () => {
    const ledger: ContentUse[] = []
    const one: ContentVariant[] = [{ id: 'solo', text: 'only line' }]
    markUsed(ledger, 'solo', 2025, 3)
    const again = selectVariant({ pool: one, ctx: {}, rng: new Rng(1), ledger, year: 2025 })
    expect(again?.id).toBe('solo')
  })

  it('a new season clears eligibility (repeat allowed across years, not within)', () => {
    const ledger: ContentUse[] = []
    markUsed(ledger, 'streak.fiery', 2025, 40)
    const nextYear = selectVariant({ pool: POOL, ctx: { streak: 5, coach: 'fiery' }, rng: new Rng(1), ledger, year: 2026 })
    expect(nextYear?.id).toBe('streak.fiery')
  })
})

describe('contentEngine — rendering', () => {
  it('fills slots and preserves unknown braces for debuggability', () => {
    expect(renderTemplate('Hello {name}, age {age}.', { name: 'Sid', age: '38' })).toBe('Hello Sid, age 38.')
    expect(renderTemplate('{missing} slot', {})).toBe('{missing} slot')
  })

  it('callback blocks render history when present and vanish cleanly when not', () => {
    const t = 'He wore the letter here{callback:, dragged this team to the {cb.round} in {cb.year},} and the concourse was full of his jersey.'
    expect(renderTemplate(t, {}, { round: 'Conference Final', year: '2027' }))
      .toBe('He wore the letter here, dragged this team to the Conference Final in 2027, and the concourse was full of his jersey.')
    expect(renderTemplate(t, {}))
      .toBe('He wore the letter here and the concourse was full of his jersey.')
  })

  it('is deterministic for a given seed', () => {
    const pick = () => selectVariant({ pool: POOL, ctx: { streak: 5 }, rng: new Rng(7), ledger: [], year: 2025 })?.id
    expect(pick()).toBe(pick())
  })
})
