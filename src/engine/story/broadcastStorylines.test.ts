import { describe, expect, it } from 'vitest'
import { detectStorylines, type PlayerStoryFacts, type StorylineFacts } from './broadcastStorylines'

const base = (over: Partial<StorylineFacts> = {}): StorylineFacts => ({
  year: 2026,
  playoff: false,
  homeName: 'Harbour Kings',
  homeIsDefendingChampion: false,
  homeOpener: false,
  players: [],
  ...over,
})

const player = (over: Partial<PlayerStoryFacts> = {}): PlayerStoryFacts => ({
  id: 'p1',
  name: 'Ben Kindel',
  age: 19,
  position: 'C',
  side: 'home',
  career: { goals: 0, points: 0, gamesPlayed: 0 },
  careerKnown: true,
  ...over,
})

const kinds = (f: StorylineFacts): string[] => detectStorylines(f).map((s) => s.kind)

describe('broadcast storylines — only what is earned', () => {
  it('a quiet night yields nothing (no filler)', () => {
    const vet = player({ age: 29, career: { goals: 120, points: 310, gamesPlayed: 540 } })
    expect(detectStorylines(base({ players: [vet] }))).toEqual([])
  })

  it('debut fires for a known zero-game career, never for an unrecorded veteran', () => {
    expect(kinds(base({ players: [player()] }))).toEqual(['debut'])
    // 31-year-old import with an empty ledger and no history: we lost the file,
    // he is not a rookie.
    const lostFile = player({ age: 31, careerKnown: false })
    expect(kinds(base({ players: [lostFile] }))).toEqual([])
  })

  it('a backup goalie cannot debut (he is not playing)', () => {
    const backup = player({ position: 'G', isStartingGoalie: false })
    expect(kinds(base({ players: [backup] }))).toEqual([])
    const starter = player({ position: 'G', isStartingGoalie: true })
    expect(kinds(base({ players: [starter] }))).toEqual(['debut'])
  })

  it('banner night needs BOTH the home opener and a defending champion', () => {
    expect(kinds(base({ homeOpener: true }))).toEqual([])
    expect(kinds(base({ homeIsDefendingChampion: true }))).toEqual([])
    expect(kinds(base({ homeOpener: true, homeIsDefendingChampion: true, championshipYear: 2026 }))).toEqual(['bannerNight'])
    // Never in the playoffs.
    expect(kinds(base({ playoff: true, homeOpener: true, homeIsDefendingChampion: true }))).toEqual([])
  })

  it('milestone watch: within 3 points / 2 goals of a round number, never further', () => {
    const near = player({ age: 34, career: { goals: 399, points: 998, gamesPlayed: 1100 } })
    const s = detectStorylines(base({ players: [near] }))
    expect(s.map((x) => x.id).sort()).toEqual(['goals:p1:400', 'points:p1:1000'])
    expect(s.find((x) => x.id === 'points:p1:1000')!.detail).toContain('2 points from 1,000')
    const far = player({ age: 34, career: { goals: 396, points: 996, gamesPlayed: 1100 } })
    expect(kinds(base({ players: [far] }))).toEqual([])
  })

  it('milestone watch is regular-season only and needs a known career', () => {
    const near = player({ age: 34, career: { goals: 10, points: 999, gamesPlayed: 1100 } })
    expect(kinds(base({ playoff: true, players: [near] }))).toEqual([])
    expect(kinds(base({ players: [{ ...near, careerKnown: false }] }))).toEqual([])
  })

  it('games milestone fires exactly on the Nth game', () => {
    const n = player({ age: 33, career: { goals: 200, points: 450, gamesPlayed: 999 } })
    const s = detectStorylines(base({ players: [n] }))
    expect(s.map((x) => x.kind)).toEqual(['milestoneGame'])
    expect(s[0]!.detail).toContain('1,000th')
    const not = player({ age: 33, career: { goals: 200, points: 450, gamesPlayed: 998 } })
    expect(kinds(base({ players: [not] }))).toEqual([])
  })

  it('homecoming needs tenure, the old building, and the FIRST visit', () => {
    const fc = { teamName: 'Harbour Kings', isTonightsHome: true, isTonightsOpponent: true, tenureGames: 612, leftYear: 2026, firstVisitSinceLeaving: true, via: 'trade' as const }
    const vet = player({ age: 33, side: 'away', career: { goals: 150, points: 400, gamesPlayed: 700 }, formerClub: fc })
    expect(kinds(base({ players: [vet] }))).toEqual(['homecoming'])
    expect(kinds(base({ players: [{ ...vet, formerClub: { ...fc, firstVisitSinceLeaving: false } }] }))).toEqual([])
    // Short stint → a "first meeting" card, not a tribute.
    expect(kinds(base({ players: [{ ...vet, formerClub: { ...fc, tenureGames: 40 } }] }))).toEqual(['revenge'])
    // Old news (left three seasons ago) → nothing.
    expect(kinds(base({ players: [{ ...vet, formerClub: { ...fc, leftYear: 2023 } }] }))).toEqual([])
  })

  it('facing the old club on the road is revenge only when he was traded', () => {
    const fc = { teamName: 'Harbour Kings', isTonightsHome: false, isTonightsOpponent: true, tenureGames: 612, leftYear: 2026, firstVisitSinceLeaving: true, via: 'trade' as const }
    const p = player({ age: 30, side: 'home', career: { goals: 150, points: 400, gamesPlayed: 700 }, formerClub: fc })
    expect(kinds(base({ players: [p] }))).toEqual(['revenge'])
    expect(kinds(base({ players: [{ ...p, formerClub: { ...fc, via: 'signing' } }] }))).toEqual([])
  })

  it('orders by priority and is deterministic', () => {
    const f = base({
      homeOpener: true, homeIsDefendingChampion: true,
      players: [
        player({ id: 'a', age: 34, career: { goals: 10, points: 999, gamesPlayed: 1100 } }),
        player({ id: 'b' }),
      ],
    })
    const one = detectStorylines(f)
    expect(one.map((s) => s.kind)).toEqual(['bannerNight', 'debut', 'milestoneWatch'])
    expect(detectStorylines(f)).toEqual(one)
  })
})
