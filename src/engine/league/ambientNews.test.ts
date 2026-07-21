import { describe, it, expect } from 'vitest'
import { Rng } from '@engine/shared/rng'
import type { ContentUse } from '@engine/story/contentEngine'
import { streakMilestone } from './ambientNews'

describe('ambientNews — streakMilestone', () => {
  it('fires on a 6-game win streak and reads as hot', () => {
    const m = streakMilestone('Toronto', 6)
    expect(m).not.toBeNull()
    expect(m!.headline).toContain('6-game winning streak')
  })

  it('fires on a 6-game losing skid and reads as cold', () => {
    const m = streakMilestone('Boston', -6)
    expect(m).not.toBeNull()
    expect(m!.headline).toContain('6 straight losses')
  })

  it('does not fire below the threshold or on odd counts between milestones', () => {
    expect(streakMilestone('X', 5)).toBeNull()
    expect(streakMilestone('X', -5)).toBeNull()
    expect(streakMilestone('X', 7)).toBeNull() // only even milestones 6,8,10…
    expect(streakMilestone('X', 0)).toBeNull()
    expect(streakMilestone('X', 1)).toBeNull()
  })

  it('fires again at the next even milestone', () => {
    expect(streakMilestone('X', 8)).not.toBeNull()
    expect(streakMilestone('X', 10)).not.toBeNull()
    expect(streakMilestone('X', -12)).not.toBeNull()
  })

  it('with a ledger, one long run reads differently at 6, 8, and 10 games', () => {
    const ledger: ContentUse[] = []
    const at = (n: number, day: number) =>
      streakMilestone('Pittsburgh', n, { rng: new Rng(5), ledger, year: 2025, day })!
    const six = at(6, 10)
    const eight = at(8, 14)
    const ten = at(10, 18)
    // Three milestones on the same heater: three different stories…
    expect(new Set([six.headline, eight.headline, ten.headline]).size).toBe(3)
    // …and double digits always escalates to the history-chasing variant.
    expect(ten.headline).toContain('history')
    for (const m of [six, eight, ten]) expect(m.headline).not.toMatch(/\{[a-z]+\}/)
  })
})
