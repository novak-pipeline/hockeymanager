import { describe, expect, it } from 'vitest'
import { detectGameStory } from './gameStory'

describe('detectGameStory', () => {
  it('flags a comeback win (overcame a 2+ goal hole and won)', () => {
    // 0-2 down, then scored four straight to win 4-2.
    const beat = detectGameStory({
      goalByUser: [false, false, true, true, true, true],
      won: true,
      userShots: 30,
      oppShots: 28,
    })
    expect(beat?.kind).toBe('comeback')
    expect(beat?.headline).toContain('Down 2')
  })

  it('flags a blown lead (led by 2+ and lost)', () => {
    const beat = detectGameStory({
      goalByUser: [true, true, false, false, false],
      won: false,
      userShots: 30,
      oppShots: 30,
    })
    expect(beat?.kind).toBe('blownLead')
    expect(beat?.headline).toContain('2-goal lead')
  })

  it('flags a goalie robbery (won badly outshot behind a huge night)', () => {
    const beat = detectGameStory({
      goalByUser: [true, true],
      won: true,
      goalie: { name: 'Ivan Wall', saves: 41, shotsAgainst: 43, goalsAgainst: 2 },
      userShots: 22,
      oppShots: 43,
    })
    expect(beat?.kind).toBe('goalieRobbery')
    expect(beat?.headline).toContain('41 saves')
  })

  it('does not call a robbery when the goalie was not really tested', () => {
    const beat = detectGameStory({
      goalByUser: [true, true, true],
      won: true,
      goalie: { name: 'Ivan Wall', saves: 20, shotsAgainst: 21, goalsAgainst: 1 },
      userShots: 34,
      oppShots: 21,
    })
    expect(beat).toBeNull()
  })

  it('flags a goalie shelling on a loss', () => {
    const beat = detectGameStory({
      goalByUser: [true],
      won: false,
      goalie: { name: 'Ivan Wall', saves: 22, shotsAgainst: 28, goalsAgainst: 6 },
      userShots: 30,
      oppShots: 28,
    })
    expect(beat?.kind).toBe('goalieShelled')
  })

  it('a comeback outranks the goalie beats', () => {
    const beat = detectGameStory({
      goalByUser: [false, false, false, true, true, true, true],
      won: true,
      goalie: { name: 'g', saves: 40, shotsAgainst: 43, goalsAgainst: 3 },
      userShots: 20,
      oppShots: 43,
    })
    expect(beat?.kind).toBe('comeback')
  })

  it('an ordinary game earns no beat', () => {
    expect(
      detectGameStory({ goalByUser: [true, false, true], won: true, userShots: 30, oppShots: 29 })
    ).toBeNull()
  })
})
