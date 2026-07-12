/**
 * Playoff bracket logic — PURE. This module never simulates a game: the career
 * layer asks `pendingGames` what to play next, simulates each game itself
 * (with `rules: 'playoff'`, so results are 'regulation' | 'overtime' only) and
 * feeds every result back through `applyGameResult`, which keeps the bracket
 * consistent and advances rounds.
 *
 * Format: two conferences; the top 8 per conference qualify for a large league
 * (32-team → real 16-team NHL field), else the top 4 (legacy 8-team field).
 * Seeded by the regular-season standings order passed to `seedBracket` (this
 * module never re-sorts — it only filters by conference). Round 1 plays the
 * standard bracket pairings inside each conference (1v4/2v3, or 1v8/4v5/2v7/3v6),
 * later rounds pair adjacent winners up to the conference final, then the league
 * final. Series are best-of-`bestOf` with 2-2-1-1-1 home ice: the higher seed
 * hosts games 1, 2, 5 and 7.
 *
 * PlayoffsState stores no seed numbers, so home ice in later rounds is derived
 * from the bracket itself: a team's conference seed is recovered from where it
 * sits in round 1 (series 1v4 vs 2v3, high vs low slot), the better conference
 * seed gets home ice, and when both league finalists hold the same conference
 * seed the champion from the first conference block wins the tie. seedBracket
 * orders the round-1 blocks by the league-wide rank of each conference's top
 * seed, so that tie-break favours the conference with the better season.
 *
 * State is mutated in place and stays JSON-safe (plain objects and arrays
 * only) — it is serialized verbatim into saves. No randomness lives here.
 */
import type {
  PlayoffRound,
  PlayoffSeries,
  PlayoffsState,
  SeriesGameResult,
  TeamId
} from '@domain'

const CONFERENCE_COUNT = 2
const DEFAULT_BEST_OF = 7

/** Playoff qualifiers per conference: NHL-style 8 (a 16-team field) when the
 *  conference is large, otherwise 4 (the legacy 8-team field for small leagues).
 *  A 32-team league (16 per conference) gets the real 16-team playoff. */
function qualifiersFor(conferenceSize: number): 4 | 8 {
  return conferenceSize >= 12 ? 8 : 4
}

/** Flat seed order for a single-elimination bracket so that pairing consecutive
 *  series in each round feeds the tree correctly: 4 → [1,4,2,3];
 *  8 → [1,8,4,5,2,7,3,6]. */
function seedOrder(qual: number): number[] {
  let order = [1]
  for (let size = 2; size <= qual; size *= 2) {
    const next: number[] = []
    for (const s of order) {
      next.push(s)
      next.push(size + 1 - s)
    }
    order = next
  }
  return order
}

/** Round names for a `qual`-team conference field plus the cross-conference final. */
function roundNamesFor(qual: number): string[] {
  const confRounds = Math.round(Math.log2(qual)) // 2 for 4, 3 for 8
  const early = ['First Round', 'Second Round']
  const names: string[] = []
  for (let k = 0; k < confRounds - 2; k++) names.push(early[k] ?? `Round ${k + 1}`)
  names.push('Conference Semifinals', 'Conference Finals', 'League Final')
  return names
}

export interface SeedBracketArgs {
  year: number
  /** Series length; defaults to best-of-seven. Must be a positive odd integer. */
  bestOf?: number
  conferences: Array<{ name: string; teamIds: TeamId[] }>
  /** League-wide regular-season order, best first, already tie-broken. */
  standingsOrder: TeamId[]
}

/** One playable game, as handed to the career layer to simulate. */
export interface PendingSeriesGame {
  seriesId: string
  gameNumber: number
  homeTeamId: TeamId
  awayTeamId: TeamId
}

/**
 * Build the round-1 bracket from final regular-season standings. Rounds 2 and
 * 3 are created empty (named, for bracket display) and populated by
 * `applyGameResult` as earlier rounds finish.
 */
export function seedBracket(args: SeedBracketArgs): PlayoffsState {
  const bestOf = args.bestOf ?? DEFAULT_BEST_OF
  if (!Number.isInteger(bestOf) || bestOf < 1 || bestOf % 2 === 0) {
    throw new Error(`bestOf must be a positive odd integer, got ${bestOf}`)
  }
  if (args.conferences.length !== CONFERENCE_COUNT) {
    throw new Error(`expected ${CONFERENCE_COUNT} conferences, got ${args.conferences.length}`)
  }

  const perConf = args.conferences.map((c) => {
    const members = new Set<TeamId>(c.teamIds)
    return args.standingsOrder.filter((id) => members.has(id))
  })
  const qual = qualifiersFor(Math.min(...perConf.map((q) => q.length)))
  const order = seedOrder(qual)

  const blocks = args.conferences.map((conference, ci) => {
    const qualifiers = perConf[ci]
    if (qualifiers.length < qual) {
      throw new Error(
        `conference ${conference.name} places ${qualifiers.length} teams in the standings, ` +
          `needs at least ${qual}`
      )
    }
    return {
      seeds: qualifiers.slice(0, qual),
      topRank: args.standingsOrder.indexOf(qualifiers[0])
    }
  })
  blocks.sort((a, b) => a.topRank - b.topRank)

  // Openers per conference in bracket order (1v4/2v3, or 1v8/4v5/2v7/3v6), so
  // pairing consecutive series each round advances the tree correctly.
  const openers: PlayoffSeries[] = []
  for (const block of blocks) {
    for (let j = 0; j < qual / 2; j++) {
      const high = block.seeds[order[2 * j] - 1]
      const low = block.seeds[order[2 * j + 1] - 1]
      openers.push(makeSeries(args.year, 1, openers.length + 1, high, low))
    }
  }

  const rounds: PlayoffRound[] = roundNamesFor(qual).map((name, i) => ({
    round: i + 1,
    name,
    series: i === 0 ? openers : []
  }))

  return { year: args.year, bestOf, rounds, currentRound: 1, championTeamId: null }
}

/** Wins required to take a series, e.g. 4 for best-of-seven. */
export function seriesWinsNeeded(state: PlayoffsState): number {
  return Math.floor(state.bestOf / 2) + 1
}

/**
 * The next unplayed game of every unfinished series in the current round —
 * one per series, so all series advance in lockstep (one game per playoff
 * match day). Empty once the champion is decided.
 */
export function pendingGames(state: PlayoffsState): PendingSeriesGame[] {
  const round = state.rounds[state.currentRound - 1]
  if (!round) return []
  const out: PendingSeriesGame[] = []
  for (const series of round.series) {
    if (series.status === 'finished') continue
    const gameNumber = series.games.length + 1
    const highHome = highSeedHosts(gameNumber)
    out.push({
      seriesId: series.id,
      gameNumber,
      homeTeamId: highHome ? series.highSeedTeamId : series.lowSeedTeamId,
      awayTeamId: highHome ? series.lowSeedTeamId : series.highSeedTeamId
    })
  }
  return out
}

/**
 * Record one simulated game into its series. Throws if the series is unknown
 * or already decided, if the game number is not the series' next game, if the
 * home/away teams disagree with the 2-2-1-1-1 pattern, or if the score is not
 * a playoff-legal decision (no ties, no shootouts). When the result decides
 * the round's last series, the next round is populated — or, after the league
 * final, `championTeamId` is set.
 */
export function applyGameResult(
  state: PlayoffsState,
  seriesId: string,
  result: SeriesGameResult
): void {
  const series = findSeries(state, seriesId)
  if (!series) throw new Error(`unknown series ${seriesId}`)
  if (series.status === 'finished') throw new Error(`series ${seriesId} is already decided`)

  const expectedGame = series.games.length + 1
  if (result.gameNumber !== expectedGame) {
    throw new Error(`series ${seriesId} expects game ${expectedGame}, got game ${result.gameNumber}`)
  }
  if ((result.decidedBy as string) === 'shootout') {
    throw new Error('playoff games cannot end in a shootout')
  }
  if (result.homeGoals === result.awayGoals) {
    throw new Error('playoff games cannot end tied')
  }
  const highHome = highSeedHosts(result.gameNumber)
  const expectedHome = highHome ? series.highSeedTeamId : series.lowSeedTeamId
  const expectedAway = highHome ? series.lowSeedTeamId : series.highSeedTeamId
  if (result.homeTeamId !== expectedHome || result.awayTeamId !== expectedAway) {
    throw new Error(
      `series ${seriesId} game ${result.gameNumber} should be ${expectedAway} at ${expectedHome}`
    )
  }

  series.games.push(result)
  const winner = result.homeGoals > result.awayGoals ? result.homeTeamId : result.awayTeamId
  if (winner === series.highSeedTeamId) series.highSeedWins++
  else series.lowSeedWins++

  const needed = seriesWinsNeeded(state)
  if (series.highSeedWins === needed || series.lowSeedWins === needed) {
    series.status = 'finished'
    series.winnerTeamId = winner
    advanceIfRoundComplete(state)
  } else {
    series.status = 'inProgress'
  }
}

/** 2-2-1-1-1: the higher seed hosts games 1 and 2, then every odd game from 5. */
function highSeedHosts(gameNumber: number): boolean {
  if (gameNumber <= 2) return true
  if (gameNumber <= 4) return false
  return gameNumber % 2 === 1
}

function makeSeries(
  year: number,
  round: number,
  slot: number,
  highSeedTeamId: TeamId,
  lowSeedTeamId: TeamId
): PlayoffSeries {
  return {
    id: `po-${year}-r${round}-s${slot}`,
    round,
    highSeedTeamId,
    lowSeedTeamId,
    highSeedWins: 0,
    lowSeedWins: 0,
    games: [],
    status: 'scheduled',
    winnerTeamId: null
  }
}

function findSeries(state: PlayoffsState, seriesId: string): PlayoffSeries | null {
  for (const round of state.rounds) {
    for (const series of round.series) {
      if (series.id === seriesId) return series
    }
  }
  return null
}

function advanceIfRoundComplete(state: PlayoffsState): void {
  const round = state.rounds[state.currentRound - 1]
  if (round.series.length === 0 || round.series.some((s) => s.status !== 'finished')) return
  if (state.currentRound === state.rounds.length) {
    state.championTeamId = round.series[0].winnerTeamId
    return
  }
  const next = state.rounds[state.currentRound]
  next.series = buildNextRound(state, round, next.round)
  state.currentRound = next.round
}

/** Pair winners of adjacent series; the better bracket seed takes home ice. */
function buildNextRound(
  state: PlayoffsState,
  finished: PlayoffRound,
  round: number
): PlayoffSeries[] {
  const next: PlayoffSeries[] = []
  for (let i = 0; i + 1 < finished.series.length; i += 2) {
    const a = finished.series[i].winnerTeamId
    const b = finished.series[i + 1].winnerTeamId
    if (!a || !b) throw new Error('cannot build a round from undecided series')
    const aHigh = outranks(bracketSeedOf(state, a), bracketSeedOf(state, b))
    next.push(makeSeries(state.year, round, next.length + 1, aHigh ? a : b, aHigh ? b : a))
  }
  return next
}

interface BracketSeed {
  /** Original conference seed (1–4 or 1–8), recovered from the round-1 pairings. */
  seed: number
  /** Conference block index in round 1 (0 = conference with the league-best top seed). */
  block: number
}

function bracketSeedOf(state: PlayoffsState, teamId: TeamId): BracketSeed {
  const openers = state.rounds[0].series
  const seriesPerBlock = openers.length / CONFERENCE_COUNT // qual / 2
  const order = seedOrder(seriesPerBlock * 2)
  for (let i = 0; i < openers.length; i++) {
    const series = openers[i]
    const isHigh = series.highSeedTeamId === teamId
    if (!isHigh && series.lowSeedTeamId !== teamId) continue
    const j = i % seriesPerBlock // series index within the conference block
    return { seed: isHigh ? order[2 * j] : order[2 * j + 1], block: Math.floor(i / seriesPerBlock) }
  }
  throw new Error(`team ${teamId} is not in the bracket`)
}

function outranks(a: BracketSeed, b: BracketSeed): boolean {
  return a.seed !== b.seed ? a.seed < b.seed : a.block < b.block
}
