import { describe, expect, it } from 'vitest'
import {
  asGameId,
  asTeamId,
  type PlayoffsState,
  type SeriesGameResult,
  type TeamId
} from '@domain'
import {
  applyGameResult,
  pendingGames,
  seedBracket,
  seriesWinsNeeded,
  type PendingSeriesGame
} from './playoffs'

const T = (n: number): TeamId => asTeamId(`t${String(n).padStart(2, '0')}`)

const EAST = { name: 'East', teamIds: [1, 2, 3, 4, 5, 6, 7, 8].map(T) }
const WEST = { name: 'West', teamIds: [9, 10, 11, 12, 13, 14, 15, 16].map(T) }

/** League-wide order, best first, conferences interleaved; t1 is best overall. */
const ORDER = [1, 9, 2, 10, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15, 8, 16].map(T)

function freshBracket(bestOf?: number): PlayoffsState {
  return bestOf === undefined
    ? seedBracket({ year: 2026, conferences: [EAST, WEST], standingsOrder: ORDER })
    : seedBracket({ year: 2026, bestOf, conferences: [EAST, WEST], standingsOrder: ORDER })
}

function resultFor(
  game: PendingSeriesGame,
  winner: TeamId,
  decidedBy: 'regulation' | 'overtime' = 'regulation'
): SeriesGameResult {
  const homeWins = game.homeTeamId === winner
  return {
    gameId: asGameId(`g-${game.seriesId}-${game.gameNumber}`),
    gameNumber: game.gameNumber,
    homeTeamId: game.homeTeamId,
    awayTeamId: game.awayTeamId,
    homeGoals: homeWins ? 3 : 1,
    awayGoals: homeWins ? 1 : 3,
    decidedBy
  }
}

function pendingFor(state: PlayoffsState, seriesId: string): PendingSeriesGame {
  const game = pendingGames(state).find((g) => g.seriesId === seriesId)
  if (!game) throw new Error(`no pending game for ${seriesId}`)
  return game
}

function playNext(
  state: PlayoffsState,
  seriesId: string,
  winner: TeamId,
  decidedBy: 'regulation' | 'overtime' = 'regulation'
): void {
  applyGameResult(state, seriesId, resultFor(pendingFor(state, seriesId), winner, decidedBy))
}

function findSeries(state: PlayoffsState, seriesId: string) {
  for (const round of state.rounds) {
    const s = round.series.find((x) => x.id === seriesId)
    if (s) return s
  }
  throw new Error(`series ${seriesId} not found`)
}

/** Play a series to completion: the loser takes `loserGames` games, spread first. */
function winSeries(state: PlayoffsState, seriesId: string, winner: TeamId, loserGames = 0): void {
  const series = findSeries(state, seriesId)
  const loser = series.highSeedTeamId === winner ? series.lowSeedTeamId : series.highSeedTeamId
  let loserLeft = loserGames
  while (series.status !== 'finished') {
    if (loserLeft > 0) {
      loserLeft--
      playNext(state, seriesId, loser)
    } else {
      playNext(state, seriesId, winner)
    }
  }
}

function currentSeries(state: PlayoffsState) {
  return state.rounds[state.currentRound - 1].series
}

describe('seedBracket', () => {
  it('builds three named rounds with round 1 seeded 1v4 and 2v3 per conference', () => {
    const state = freshBracket()
    expect(state.year).toBe(2026)
    expect(state.bestOf).toBe(7)
    expect(state.currentRound).toBe(1)
    expect(state.championTeamId).toBeNull()
    expect(state.rounds.map((r) => r.name)).toEqual([
      'Conference Semifinals',
      'Conference Finals',
      'League Final'
    ])
    expect(state.rounds.map((r) => r.round)).toEqual([1, 2, 3])

    const r1 = state.rounds[0].series
    expect(r1).toHaveLength(4)
    expect(r1.map((s) => [s.highSeedTeamId, s.lowSeedTeamId])).toEqual([
      [T(1), T(4)],
      [T(2), T(3)],
      [T(9), T(12)],
      [T(10), T(11)]
    ])
    for (const s of r1) {
      expect(s.status).toBe('scheduled')
      expect(s.highSeedWins).toBe(0)
      expect(s.lowSeedWins).toBe(0)
      expect(s.games).toEqual([])
      expect(s.winnerTeamId).toBeNull()
      expect(s.round).toBe(1)
    }
    expect(state.rounds[1].series).toEqual([])
    expect(state.rounds[2].series).toEqual([])
  })

  it('orders the conference blocks by the league rank of each top seed', () => {
    const westFirst = [9, 1, 10, 2, 11, 3, 12, 4, 13, 5, 14, 6, 15, 7, 16, 8].map(T)
    const state = seedBracket({ year: 2026, conferences: [EAST, WEST], standingsOrder: westFirst })
    expect(state.rounds[0].series[0].highSeedTeamId).toBe(T(9))
    expect(state.rounds[0].series[2].highSeedTeamId).toBe(T(1))
  })

  it('uses the given standings order without re-sorting', () => {
    const reversed = [16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(T)
    const state = seedBracket({ year: 2026, conferences: [EAST, WEST], standingsOrder: reversed })
    expect(state.rounds[0].series.map((s) => [s.highSeedTeamId, s.lowSeedTeamId])).toEqual([
      [T(16), T(13)],
      [T(15), T(14)],
      [T(8), T(5)],
      [T(7), T(6)]
    ])
  })

  it('rejects malformed input', () => {
    expect(() =>
      seedBracket({ year: 2026, conferences: [EAST], standingsOrder: ORDER })
    ).toThrow(/2 conferences/)
    expect(() =>
      seedBracket({
        year: 2026,
        conferences: [EAST, WEST],
        standingsOrder: [T(1), T(2), T(3), ...WEST.teamIds]
      })
    ).toThrow(/East/)
    expect(() =>
      seedBracket({ year: 2026, bestOf: 6, conferences: [EAST, WEST], standingsOrder: ORDER })
    ).toThrow(/odd/)
    expect(() =>
      seedBracket({ year: 2026, bestOf: 0, conferences: [EAST, WEST], standingsOrder: ORDER })
    ).toThrow(/odd/)
  })
})

describe('pendingGames and home ice', () => {
  it('offers game 1 of every series with the high seed at home', () => {
    const state = freshBracket()
    const pending = pendingGames(state)
    expect(pending).toHaveLength(4)
    expect(pending.map((g) => g.gameNumber)).toEqual([1, 1, 1, 1])
    expect(pending.map((g) => [g.homeTeamId, g.awayTeamId])).toEqual([
      [T(1), T(4)],
      [T(2), T(3)],
      [T(9), T(12)],
      [T(10), T(11)]
    ])
  })

  it('follows the 2-2-1-1-1 pattern through a seven-game series', () => {
    const state = freshBracket()
    const seriesId = 'po-2026-r1-s1'
    const homes: TeamId[] = []
    const winners = [T(1), T(4), T(1), T(4), T(1), T(4), T(1)]
    for (const winner of winners) {
      homes.push(pendingFor(state, seriesId).homeTeamId)
      playNext(state, seriesId, winner)
    }
    expect(homes).toEqual([T(1), T(1), T(4), T(4), T(1), T(4), T(1)])

    const series = findSeries(state, seriesId)
    expect(series.status).toBe('finished')
    expect(series.winnerTeamId).toBe(T(1))
    expect(series.highSeedWins).toBe(4)
    expect(series.lowSeedWins).toBe(3)
    expect(series.games.map((g) => g.gameNumber)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('tracks series status and wins as games are recorded', () => {
    const state = freshBracket()
    const seriesId = 'po-2026-r1-s2'
    playNext(state, seriesId, T(3), 'overtime')
    const series = findSeries(state, seriesId)
    expect(series.status).toBe('inProgress')
    expect(series.highSeedWins).toBe(0)
    expect(series.lowSeedWins).toBe(1)
    expect(series.games[0].decidedBy).toBe('overtime')
    expect(series.winnerTeamId).toBeNull()
  })

  it('drops a finished series from pending while the rest of the round continues', () => {
    const state = freshBracket()
    winSeries(state, 'po-2026-r1-s1', T(1))
    const pending = pendingGames(state)
    expect(pending.map((g) => g.seriesId)).toEqual([
      'po-2026-r1-s2',
      'po-2026-r1-s3',
      'po-2026-r1-s4'
    ])
    expect(pending.every((g) => g.gameNumber === 1)).toBe(true)
  })
})

describe('applyGameResult validation', () => {
  it('throws for an unknown series', () => {
    const state = freshBracket()
    const game = pendingGames(state)[0]
    expect(() => applyGameResult(state, 'po-2026-r9-s9', resultFor(game, T(1)))).toThrow(
      /unknown series/
    )
  })

  it('throws on the wrong game number', () => {
    const state = freshBracket()
    const seriesId = 'po-2026-r1-s1'
    const game1 = pendingFor(state, seriesId)
    applyGameResult(state, seriesId, resultFor(game1, T(1)))
    expect(() => applyGameResult(state, seriesId, resultFor(game1, T(1)))).toThrow(
      /expects game 2/
    )
    const skipped = { ...resultFor(game1, T(1)), gameNumber: 5 }
    expect(() => applyGameResult(state, seriesId, skipped)).toThrow(/expects game 2/)
  })

  it('throws on a result for a finished series', () => {
    const state = freshBracket()
    winSeries(state, 'po-2026-r1-s1', T(1))
    const fake: SeriesGameResult = {
      gameId: asGameId('g-extra'),
      gameNumber: 5,
      homeTeamId: T(1),
      awayTeamId: T(4),
      homeGoals: 2,
      awayGoals: 1,
      decidedBy: 'regulation'
    }
    expect(() => applyGameResult(state, 'po-2026-r1-s1', fake)).toThrow(/already decided/)
  })

  it('throws on a tied score', () => {
    const state = freshBracket()
    const game = pendingFor(state, 'po-2026-r1-s1')
    const tied = { ...resultFor(game, T(1)), homeGoals: 2, awayGoals: 2 }
    expect(() => applyGameResult(state, 'po-2026-r1-s1', tied)).toThrow(/tied/)
  })

  it('throws on a shootout decision', () => {
    const state = freshBracket()
    const game = pendingFor(state, 'po-2026-r1-s1')
    const bad = {
      ...resultFor(game, T(1)),
      decidedBy: 'shootout'
    } as unknown as SeriesGameResult
    expect(() => applyGameResult(state, 'po-2026-r1-s1', bad)).toThrow(/shootout/)
  })

  it('throws when home and away disagree with the 2-2-1-1-1 slot', () => {
    const state = freshBracket()
    const game = pendingFor(state, 'po-2026-r1-s1')
    const swapped: SeriesGameResult = {
      ...resultFor(game, T(1)),
      homeTeamId: game.awayTeamId,
      awayTeamId: game.homeTeamId
    }
    expect(() => applyGameResult(state, 'po-2026-r1-s1', swapped)).toThrow(/should be/)
  })
})

describe('round advancement', () => {
  it('populates the conference finals from round-1 winners with re-seeded home ice', () => {
    const state = freshBracket()
    winSeries(state, 'po-2026-r1-s1', T(1))
    winSeries(state, 'po-2026-r1-s2', T(3), 2)
    winSeries(state, 'po-2026-r1-s3', T(12), 3)
    winSeries(state, 'po-2026-r1-s4', T(10), 1)

    expect(state.currentRound).toBe(2)
    const finals = state.rounds[1].series
    expect(finals).toHaveLength(2)
    expect(finals[0].highSeedTeamId).toBe(T(1))
    expect(finals[0].lowSeedTeamId).toBe(T(3))
    expect(finals[1].highSeedTeamId).toBe(T(10))
    expect(finals[1].lowSeedTeamId).toBe(T(12))
    for (const s of finals) {
      expect(s.round).toBe(2)
      expect(s.status).toBe('scheduled')
      expect(s.games).toEqual([])
    }
    expect(pendingGames(state).map((g) => g.seriesId)).toEqual(finals.map((s) => s.id))
  })

  it('gives league-final home ice to the better conference seed', () => {
    const state = freshBracket()
    winSeries(state, 'po-2026-r1-s1', T(1))
    winSeries(state, 'po-2026-r1-s2', T(2))
    winSeries(state, 'po-2026-r1-s3', T(9))
    winSeries(state, 'po-2026-r1-s4', T(10))
    const [eastFinal, westFinal] = state.rounds[1].series
    winSeries(state, eastFinal.id, T(2), 1)
    winSeries(state, westFinal.id, T(9), 1)

    expect(state.currentRound).toBe(3)
    const final = state.rounds[2].series[0]
    expect(final.highSeedTeamId).toBe(T(9))
    expect(final.lowSeedTeamId).toBe(T(2))
  })

  it('breaks an equal-seed league final toward the conference with the league-best team', () => {
    const state = freshBracket()
    for (const id of currentSeries(state).map((s) => s.id)) {
      winSeries(state, id, findSeries(state, id).highSeedTeamId)
    }
    for (const id of currentSeries(state).map((s) => s.id)) {
      winSeries(state, id, findSeries(state, id).highSeedTeamId)
    }
    const final = state.rounds[2].series[0]
    expect(final.highSeedTeamId).toBe(T(1))
    expect(final.lowSeedTeamId).toBe(T(9))
  })

  it('crowns a champion after a full run of sweeps, upsets and game sevens', () => {
    const state = freshBracket()
    winSeries(state, 'po-2026-r1-s1', T(1))
    winSeries(state, 'po-2026-r1-s2', T(2), 3)
    winSeries(state, 'po-2026-r1-s3', T(12), 2)
    winSeries(state, 'po-2026-r1-s4', T(10), 1)

    const [eastFinal, westFinal] = state.rounds[1].series
    expect([eastFinal.highSeedTeamId, eastFinal.lowSeedTeamId]).toEqual([T(1), T(2)])
    expect([westFinal.highSeedTeamId, westFinal.lowSeedTeamId]).toEqual([T(10), T(12)])
    winSeries(state, eastFinal.id, T(1), 2)
    winSeries(state, westFinal.id, T(12), 3)

    const final = state.rounds[2].series[0]
    expect([final.highSeedTeamId, final.lowSeedTeamId]).toEqual([T(1), T(12)])
    winSeries(state, final.id, T(12), 3)

    expect(state.championTeamId).toBe(T(12))
    expect(state.currentRound).toBe(3)
    expect(pendingGames(state)).toEqual([])
    const totalGames = state.rounds.reduce(
      (sum, r) => sum + r.series.reduce((s, x) => s + x.games.length, 0),
      0
    )
    expect(totalGames).toBe(4 + 7 + 6 + 5 + 6 + 7 + 7)
    for (const round of state.rounds) {
      for (const series of round.series) expect(series.status).toBe('finished')
    }
  })
})

describe('series length variants', () => {
  it('seriesWinsNeeded reflects bestOf', () => {
    expect(seriesWinsNeeded(freshBracket())).toBe(4)
    expect(seriesWinsNeeded(freshBracket(5))).toBe(3)
    expect(seriesWinsNeeded(freshBracket(1))).toBe(1)
  })

  it('a best-of-5 series ends at three wins with 2-2-1 home ice', () => {
    const state = freshBracket(5)
    const seriesId = 'po-2026-r1-s1'
    const homes: TeamId[] = []
    for (const winner of [T(1), T(4), T(1), T(4), T(1)]) {
      homes.push(pendingFor(state, seriesId).homeTeamId)
      playNext(state, seriesId, winner)
    }
    expect(homes).toEqual([T(1), T(1), T(4), T(4), T(1)])
    const series = findSeries(state, seriesId)
    expect(series.status).toBe('finished')
    expect(series.winnerTeamId).toBe(T(1))
  })
})

describe('serialization', () => {
  it('state survives a JSON round-trip mid-bracket and keeps working', () => {
    const state = freshBracket()
    winSeries(state, 'po-2026-r1-s1', T(1))
    playNext(state, 'po-2026-r1-s2', T(2))

    const revived = JSON.parse(JSON.stringify(state)) as PlayoffsState
    expect(revived).toEqual(state)

    winSeries(revived, 'po-2026-r1-s2', T(2), 1)
    winSeries(revived, 'po-2026-r1-s3', T(9))
    winSeries(revived, 'po-2026-r1-s4', T(11), 2)
    expect(revived.currentRound).toBe(2)
    expect(revived.rounds[1].series.map((s) => [s.highSeedTeamId, s.lowSeedTeamId])).toEqual([
      [T(1), T(2)],
      [T(9), T(11)]
    ])
  })
})
