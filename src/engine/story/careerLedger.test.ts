import { describe, expect, it } from 'vitest'
import type { CareerSeasonRecord, Player } from '@domain/player'
import {
  canClaimFirstGoal,
  detectHistoryLeagueLabel,
  hasImportedHistory,
  importedCareerIn,
  isTrueRookieSeason,
} from './careerLedger'

const NHL = 'National Hockey League'

function histRow(o: Partial<CareerSeasonRecord> & { league: string; club: string }): CareerSeasonRecord {
  return {
    year: o.year ?? 2020,
    club: o.club,
    league: o.league,
    gamesPlayed: o.gamesPlayed ?? 82,
    goals: o.goals ?? 0,
    assists: o.assists ?? 0,
    penaltyMinutes: 0,
    plusMinus: 0,
    minutes: 0,
    goalsAgainst: 0,
    shutouts: o.shutouts ?? 0,
    wins: 0,
    losses: 0,
    otLosses: 0,
    saves: 0,
  }
}

/** A player carrying only the fields this module reads. */
function player(o: { age: number; careerHistory?: CareerSeasonRecord[] }): Player {
  return { age: o.age, ...(o.careerHistory ? { careerHistory: o.careerHistory } : {}) } as unknown as Player
}

/** The reported bug: a 39-year-old franchise legend, imported mid-career, whose
 *  in-sim stat ledger is empty because the save is young. */
const malkin = player({
  age: 39,
  careerHistory: [
    histRow({ league: NHL, club: 'Pittsburgh Penguins', year: 2024, goals: 27, assists: 40 }),
    histRow({ league: NHL, club: 'Pittsburgh Penguins', year: 2023, goals: 24, assists: 43 }),
    histRow({ league: 'Kontinental Hockey League', club: 'Metallurg Magnitogorsk', year: 2012, goals: 23, assists: 19 }),
  ],
})

describe('detectHistoryLeagueLabel', () => {
  it('finds our league by CLUB overlap, not by name', () => {
    const clubs = ['Pittsburgh Penguins', 'Boston Bruins', 'Calgary Flames']
    const players = [
      malkin,
      player({ age: 30, careerHistory: [histRow({ league: NHL, club: 'Boston Bruins' })] }),
      player({ age: 28, careerHistory: [histRow({ league: NHL, club: 'Calgary Flames' })] }),
    ]
    expect(detectHistoryLeagueLabel(players, clubs)).toBe(NHL)
  })

  it('returns null when no history league covers our clubs (fictional league)', () => {
    const players = [player({ age: 25 }), player({ age: 31 })]
    expect(detectHistoryLeagueLabel(players, ['Riverside Rapids', 'Halifax Hurricanes'])).toBeNull()
  })

  it('needs more than one shared club — a coincidental name match is not our league', () => {
    const players = [player({ age: 30, careerHistory: [histRow({ league: 'Swedish Hockey League', club: 'Boston Bruins' })] })]
    expect(detectHistoryLeagueLabel(players, ['Boston Bruins', 'Calgary Flames', 'Ottawa Senators'])).toBeNull()
  })
})

describe('importedCareerIn', () => {
  it('counts only the league we play — a KHL goal is not an NHL goal', () => {
    const c = importedCareerIn(malkin, NHL)
    expect(c.seasons).toBe(2)
    expect(c.goals).toBe(51)
    expect(c.points).toBe(134)
    expect(c.gamesPlayed).toBe(164)
  })

  it('is empty when the league label is unknown', () => {
    expect(importedCareerIn(malkin, null).goals).toBe(0)
  })

  it('knows whether the database recorded anything at all', () => {
    expect(hasImportedHistory(malkin)).toBe(true)
    expect(hasImportedHistory(player({ age: 22 }))).toBe(false)
  })
})

describe('canClaimFirstGoal', () => {
  it('REFUSES to call a 39-year-old legend a first-time scorer (playtest C3)', () => {
    expect(canClaimFirstGoal({
      age: 39,
      knownGoalsBefore: 0, // the save is young: the sim has watched him score nothing yet
      imported: importedCareerIn(malkin, NHL),
    })).toBe(false)
  })

  it('allows a genuine rookie whose imported record holds no league goals', () => {
    const kid = player({
      age: 19,
      careerHistory: [histRow({ league: 'Ontario Hockey League', club: 'London Knights', goals: 41, assists: 55 })],
    })
    expect(canClaimFirstGoal({ age: 19, knownGoalsBefore: 0, imported: importedCareerIn(kid, NHL) })).toBe(true)
  })

  it('allows the grinder who finally scores: real games on record, no goals', () => {
    const grinder = player({
      age: 27,
      careerHistory: [histRow({ league: NHL, club: 'Boston Bruins', gamesPlayed: 143, goals: 0, assists: 9 })],
    })
    expect(canClaimFirstGoal({ age: 27, knownGoalsBefore: 0, imported: importedCareerIn(grinder, NHL) })).toBe(true)
  })

  it('never fires once the sim itself has watched him score', () => {
    expect(canClaimFirstGoal({ age: 21, knownGoalsBefore: 1, imported: null })).toBe(false)
  })

  it('with NO record either way, believes a debutant and doubts a veteran', () => {
    expect(canClaimFirstGoal({ age: 22, knownGoalsBefore: 0, imported: null })).toBe(true)
    expect(canClaimFirstGoal({ age: 33, knownGoalsBefore: 0, imported: null })).toBe(false)
  })
})

describe('isTrueRookieSeason', () => {
  it('denies Calder eligibility to an import with real league games behind him', () => {
    const vet = player({
      age: 24,
      careerHistory: [histRow({ league: NHL, club: 'Boston Bruins', gamesPlayed: 200, goals: 40 })],
    })
    expect(isTrueRookieSeason({ age: 24, simSeasons: 0, imported: importedCareerIn(vet, NHL) })).toBe(false)
  })

  it('accepts a young player with no league games on any record', () => {
    expect(isTrueRookieSeason({ age: 20, simSeasons: 0, imported: null })).toBe(true)
    expect(isTrueRookieSeason({ age: 20, simSeasons: 1, imported: null })).toBe(false)
    expect(isTrueRookieSeason({ age: 29, simSeasons: 0, imported: null })).toBe(false)
  })
})
