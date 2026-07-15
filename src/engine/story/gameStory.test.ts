import { describe, expect, it } from 'vitest'
import { detectGameStory, detectPlayerStory, type PlayerGameLine } from './gameStory'

const line = (over: Partial<PlayerGameLine>): PlayerGameLine => ({
  playerId: 'p', name: 'Player', isGoalie: false,
  goals: 0, assists: 0, saves: 0, shotsAgainst: 0, goalsAgainst: 0, ...over,
})

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

describe('detectPlayerStory', () => {
  it('flags a hat trick, mentioning points when there are more', () => {
    const beat = detectPlayerStory([
      line({ name: 'Sniper', goals: 3, assists: 1, playerId: 's' }),
      line({ name: 'Depth', goals: 1 }),
    ])
    expect(beat?.kind).toBe('hatTrick')
    expect(beat?.playerId).toBe('s')
    expect(beat?.headline).toContain('hat trick')
    expect(beat?.body).toContain('4 points')
  })

  it('calls out a 4+ goal explosion distinctly', () => {
    const beat = detectPlayerStory([line({ name: 'Sniper', goals: 4 })])
    expect(beat?.headline).toContain('4-goal night')
  })

  it('flags a big multi-point night without a hat trick', () => {
    const beat = detectPlayerStory([line({ name: 'Playmaker', goals: 1, assists: 3 })])
    expect(beat?.kind).toBe('bigNight')
    expect(beat?.headline).toContain('4-point night')
  })

  it('flags a goalie shutout with a real workload', () => {
    const beat = detectPlayerStory([line({ name: 'Wall', isGoalie: true, saves: 31, shotsAgainst: 31, goalsAgainst: 0 })])
    expect(beat?.kind).toBe('shutout')
    expect(beat?.headline).toContain('31-save')
  })

  it('a hat trick outranks a big points night and a shutout', () => {
    const beat = detectPlayerStory([
      line({ name: 'Passer', goals: 0, assists: 5 }),
      line({ name: 'Sniper', goals: 3 }),
      line({ name: 'Wall', isGoalie: true, saves: 25, shotsAgainst: 25, goalsAgainst: 0 }),
    ])
    expect(beat?.kind).toBe('hatTrick')
  })

  it('an ordinary line-up earns no individual beat', () => {
    expect(detectPlayerStory([line({ goals: 1, assists: 1 }), line({ goals: 0, assists: 2 })])).toBeNull()
  })

  it('does not call a shutout on a token cameo in net', () => {
    expect(detectPlayerStory([line({ isGoalie: true, saves: 5, shotsAgainst: 5, goalsAgainst: 0 })])).toBeNull()
  })
})
