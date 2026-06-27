import { describe, it, expect } from 'vitest'
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
})
