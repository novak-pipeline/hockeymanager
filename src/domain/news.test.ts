import { describe, expect, it } from 'vitest'
import { BREAKING_SALIENCE, isBreakingNews } from './news'

/**
 * Playtest #13: the BREAKING predicate — big (salience at/above the bar) or
 * rare (first-ever story pattern) inbox items get the breaking treatment;
 * everything below the threshold stays ordinary mail.
 */
describe('isBreakingNews (#13)', () => {
  it('fires only at/above the salience threshold', () => {
    expect(isBreakingNews({ salience: BREAKING_SALIENCE })).toBe(true)
    expect(isBreakingNews({ salience: BREAKING_SALIENCE - 1 })).toBe(false)
    expect(isBreakingNews({ salience: 95 })).toBe(true)
  })

  it('never fires on items without a salience score', () => {
    expect(isBreakingNews({})).toBe(false)
  })

  it('a rare (first-ever pattern) story is breaking even below the bar', () => {
    expect(isBreakingNews({ salience: 45, rare: true })).toBe(true)
    expect(isBreakingNews({ rare: true })).toBe(true)
    expect(isBreakingNews({ salience: 45, rare: false })).toBe(false)
  })

  it('the threshold sits above the inbox floor (70) and below the big beats (85+)', () => {
    // The curation floor lets 70+ feed stories into the inbox; only the top of
    // that band may read as BREAKING, and the hardcoded tentpoles (blockbuster
    // trade column 85, clinch 90, record break 95) always qualify.
    expect(BREAKING_SALIENCE).toBeGreaterThan(70)
    expect(BREAKING_SALIENCE).toBeLessThanOrEqual(85)
  })
})
