import { describe, expect, it } from 'vitest'
import { buildSeasonBio, type SeasonBioArgs } from './seasonBio'

const base: SeasonBioArgs = {
  firstName: 'Melvin',
  position: 'RW',
  age: 17,
  teamName: 'Örebro HK J20',
  league: 'J20 Nationell',
  gamesPlayed: 45,
  goals: 31,
  assists: 32,
  final: false,
}

describe('buildSeasonBio', () => {
  it('returns null before any games are played', () => {
    expect(buildSeasonBio({ ...base, gamesPlayed: 0 })).toBeNull()
  })

  it('writes a present-tense production line in-season', () => {
    const s = buildSeasonBio(base)!
    expect(s).toContain('has put up 63 points (31G, 32A) in 45 games')
    expect(s).toContain('Örebro HK J20')
    expect(s).toContain('J20 Nationell')
  })

  it('switches to past tense at the final report', () => {
    const s = buildSeasonBio({ ...base, final: true })!
    expect(s).toContain('put up 63 points')
    expect(s).not.toContain('has put up')
  })

  it('notes leading the league when ranked first', () => {
    const s = buildSeasonBio({ ...base, leagueScoringRank: 1 })!
    expect(s).toContain('leading the league in scoring')
  })

  it('uses an ordinal for a top-10 finish', () => {
    const s = buildSeasonBio({ ...base, leagueScoringRank: 3 })!
    expect(s).toContain('3rd-most points in the league')
  })

  it('flags outproducing expectations', () => {
    const s = buildSeasonBio({ ...base, expectedPoints: 30 })!
    expect(s).toMatch(/outproducing expectations/)
  })

  it('flags underproduction', () => {
    const s = buildSeasonBio({ ...base, goals: 5, assists: 5, expectedPoints: 40 })!
    expect(s).toMatch(/below his expected production/)
  })

  it('adds an international line for junior-age players with caps', () => {
    const s = buildSeasonBio({ ...base, intlApps: 7, nation: 'Sweden' })!
    expect(s).toContain('Sweden')
    expect(s).toMatch(/internationally/)
  })

  it('keeps goalie bios about workload', () => {
    const s = buildSeasonBio({ ...base, position: 'G', goals: 0, assists: 0, gamesPlayed: 30 })!
    expect(s).toContain('appeared in 30 games')
  })
})
