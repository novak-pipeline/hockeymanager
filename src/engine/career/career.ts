/**
 * Career / session state — the manager loop (FM/EHM model, not a god-view
 * league simmer). The player IS one club's GM. The Career holds the live league
 * in memory and runs the full year cycle as a phase machine:
 *
 *   regularSeason ──(last match day)──▶ playoffs ──(champion)──▶ offseason
 *        ▲                                                            │
 *        └──────────────(preseason rollover: new schedule)────────────┘
 *
 * Background games quick-sim; the user's fixture can be intercepted by the
 * full-fidelity engine for watching (regular season AND playoffs). Every
 * mutation the UI can perform (lines, tactics, trades, contracts, draft picks)
 * goes through a method here; the worker is a thin dispatcher.
 *
 * Determinism: all randomness flows through seeded Rngs derived from the
 * career seed. Wall-clock time only ever appears in save metadata.
 */
import type { LeagueData } from '@data/generate'
import { buildSchedule } from '@data/generate'
import {
  asGameId,
  asPlayerId,
  asTeamId,
  type DraftPick,
  type GameResult,
  type GameStream,
  type NewsCategory,
  type NewsItem,
  type OffseasonState,
  type Player,
  type PlayerId,
  type PlayoffsState,
  type Position,
  type ScheduledGame,
  type SeriesGameResult,
  type Standing,
  type TeamId,
  type TeamTactics,
} from '@domain'
import { overall } from '@engine/ratings/composites'
import { quickSimGame } from '@engine/quick/quickSim'
import { fullSimGame } from '@engine/full/fullSim'
import type { GameOutcome, GamePlayerStat } from '@engine/shared/outcome'
import {
  applyGameResult as applyStandingsResult,
  gameSeed,
  mergePlayerStats,
  sortStandings,
} from '@engine/quick/season'
import { Rng, deriveSeed } from '@engine/shared/rng'
import {
  applyGameResult as applySeriesResult,
  pendingGames,
  seedBracket,
  seriesWinsNeeded,
} from '@engine/league/playoffs'
import {
  aiSelectProspect,
  buildDraftOrder,
  developPlayers,
  generateDraftClass,
  processRetirements,
} from '@engine/league/offseason'
import {
  aiFreeAgencyDay,
  aiResignDay,
  askTerms,
  initialPicks,
  offerAcceptable,
  processExpiries,
  signPlayer,
  releasePlayer as releaseFromTeam,
} from '@engine/league/contracts'
import {
  evaluateProposal,
  executeTrade,
  generateAiOffers,
  pickValue,
  playerValue,
  type StoredTradeOffer,
} from '@engine/league/trades'
import {
  applyResultMorale,
  effectiveResolve,
  rollInjuries,
  tickRecovery,
} from '@engine/league/condition'
import { repairLines } from '@engine/league/lineup'
import {
  assignScout,
  createInitialScouting,
  knowledgeOf,
  tickScouting,
} from '@engine/league/scouting'
import { deserializeLeagueData, deserializeMap, serializeLeagueData, serializeMap } from './serialize'
import { buildBoxScore } from './boxScore'
import {
  badge,
  buildFinanceView,
  buildPlayerProfile,
  buildScoutingView,
  buildScheduleView,
  buildSquadView,
  buildStandingsView,
  buildStatsView,
  buildTacticsView,
  potentialStars,
  standingRowView,
  type FogCtx,
  type ViewCtx,
} from './buildViews'
import {
  dayToDateISO,
  type BoxScoreView,
  type CareerPhase,
  type CareerSnapshot,
  type DashboardView,
  type DraftView,
  type FinanceView,
  type InboxView,
  type LinesUpdate,
  type OffseasonView,
  type PickAssetView,
  type PlayerProfileView,
  type PlayoffBracketView,
  type ScheduleView,
  type ScoutingView,
  type SeasonSummary,
  type SeriesView,
  type SquadView,
  type StandingsView,
  type StatsView,
  type TacticsView,
  type TradeEvaluation,
  type TradeOfferView,
  type TradeProposal,
  type TradeSideView,
  type TradesView,
} from './views'
import type { ScoutingState, ScoutTarget } from '@domain/scouting'

/* ────────────────────────── legacy v1 view types (kept for compat) ────────────────────────── */

export interface TeamInfo {
  teamId: string
  name: string
  abbreviation: string
  city: string
  conference: string
  division: string
  /** Mean overall of the projected top skaters, for the picker. */
  strength: number
  colors: { primary: number; secondary: number }
}

export interface StandingRow {
  teamId: string
  name: string
  abbreviation: string
  gamesPlayed: number
  wins: number
  losses: number
  overtimeLosses: number
  points: number
  goalsFor: number
  goalsAgainst: number
}

export interface RosterEntry {
  playerId: string
  name: string
  position: Position
  age: number
  overall: number
  gamesPlayed: number
  goals: number
  assists: number
  points: number
  savePct: number | null
}

export interface ResultLine {
  day: number
  homeAbbr: string
  awayAbbr: string
  homeGoals: number
  awayGoals: number
  decidedBy: GameResult['decidedBy']
  isUserGame: boolean
}

export interface NextGame {
  day: number
  opponentAbbr: string
  opponentName: string
  home: boolean
}

/** The user's watched fixture: render metadata + the positional event stream. */
export interface WatchedGame {
  homeName: string
  awayName: string
  homeAbbr: string
  awayAbbr: string
  userIsHome: boolean
  homePlayerIds: string[]
  homeColors: { primary: number; secondary: number }
  awayColors: { primary: number; secondary: number }
  playerNames: Record<string, string>
  stream: GameStream
}

export interface ManagerView {
  leagueName: string
  year: number
  day: number
  totalDays: number
  seasonComplete: boolean
  userTeam: {
    teamId: string
    name: string
    abbreviation: string
    rank: number
    standing: StandingRow
  }
  nextGame: NextGame | null
  lastResult: ResultLine | null
  standings: StandingRow[]
  roster: RosterEntry[]
  news: string[]
}

/** Team list for the club picker, built without starting a career. */
export function buildTeamList(data: LeagueData): TeamInfo[] {
  const divName = new Map(data.league.divisions.map((d) => [d.id, d.name]))
  const confName = new Map(data.league.conferences.map((c) => [c.id, c.name]))
  return data.league.teams.map((teamId) => {
    const team = data.teams.get(teamId)!
    const skaters = team.roster
      .map((id) => data.players.get(id)!)
      .filter((p) => p.position !== 'G')
      .map((p) => overall(p.composites, p.position))
      .sort((a, b) => b - a)
      .slice(0, 15)
    const strength = Math.round(skaters.reduce((s, v) => s + v, 0) / skaters.length)
    return {
      teamId,
      name: team.name,
      abbreviation: team.abbreviation,
      city: team.city,
      conference: confName.get(team.conferenceId) ?? '',
      division: divName.get(team.divisionId) ?? '',
      strength,
      colors: { ...team.colors },
    }
  })
}

function freshStanding(teamId: TeamId): Standing {
  return {
    teamId,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    overtimeLosses: 0,
    points: 0,
    goalsFor: 0,
    goalsAgainst: 0,
  }
}

const NEWS_LIMIT = 200
const ROUND_ROBINS = 4
const DRAFT_ROUNDS = 2
const DRAFT_CLASS_SIZE = 64
const PICK_YEARS_AHEAD = 3
const FA_WINDOW_DAYS = 8
const ROSTER_HARD_CAP = 26

type ResignStatus = 'pending' | 'signed' | 'walked'

export class Career {
  readonly data: LeagueData
  readonly seed: number
  readonly userTeamId: TeamId

  private currentDay = 0
  private phase: CareerPhase = 'regularSeason'
  private readonly standings = new Map<TeamId, Standing>()
  private readonly totals = new Map<PlayerId, GamePlayerStat>()
  private readonly gp = new Map<PlayerId, number>()
  private readonly goalieWins = new Map<PlayerId, number>()
  private readonly goalieLosses = new Map<PlayerId, number>()
  private readonly ppGoals = new Map<PlayerId, number>()
  private readonly ppAssists = new Map<PlayerId, number>()
  private news: NewsItem[] = []
  private newsCounter = 0
  private playoffs: PlayoffsState | null = null
  private offseason: OffseasonState | null = null
  private picks: DraftPick[] = []
  private tradeOffers: StoredTradeOffer[] = []
  private offerCounter = 0
  private history: SeasonSummary[] = []
  private lastBoxScore: BoxScoreView | null = null
  private readonly resignStatus = new Map<PlayerId, ResignStatus>()
  private faPool: PlayerId[] = []
  private matchDays: number[] = []
  private playerCounter = 0
  private scouting!: ScoutingState

  constructor(data: LeagueData, seed: number, userTeamId: TeamId, restored = false) {
    this.data = data
    this.seed = seed
    this.userTeamId = userTeamId
    this.refreshMatchDays()
    this.playerCounter = this.computePlayerCounter()
    if (!restored) {
      for (const teamId of data.league.teams) this.standings.set(teamId, freshStanding(teamId))
      this.picks = initialPicks({
        teamIds: [...data.league.teams],
        firstDraftYear: this.year + 1,
        yearsAhead: PICK_YEARS_AHEAD,
        rounds: DRAFT_ROUNDS,
      })
      this.scouting = createInitialScouting({
        userTeamId: userTeamId as string,
        teams: data.teams as Map<TeamId, { roster: PlayerId[] }>,
        players: data.players,
        rng: new Rng(deriveSeed(seed, 9001)),
        draftProspectIds: this.allDraftProspectIds(),
      })
      this.pushNews(
        'league',
        `${data.league.name} ${this.year}–${this.year + 1} season begins`,
        `You are the new general manager of the ${this.userTeam.name}. Set your lines, watch the cap, and bring home the cup.`
      )
    }
  }

  /* ────────────────────────── small accessors ────────────────────────── */

  get year(): number {
    return this.data.league.season.year
  }

  private get userTeam() {
    return this.data.teams.get(this.userTeamId)!
  }

  get done(): boolean {
    return this.phase !== 'regularSeason'
  }

  private get deadlineDay(): number {
    const last = this.matchDays[this.matchDays.length - 1] ?? 0
    return Math.floor(last * 0.75)
  }

  private refreshMatchDays(): void {
    this.matchDays = [...new Set(this.data.league.schedule.map((g) => g.day))].sort((a, b) => a - b)
  }

  private computePlayerCounter(): number {
    let max = 0
    for (const id of this.data.players.keys()) {
      const m = /^p(\d+)$/.exec(id as string)
      if (m) max = Math.max(max, Number(m[1]))
    }
    return max + 1
  }

  private resolve = (id: PlayerId): Player => {
    const p = this.data.players.get(id)
    if (!p) throw new Error(`unknown player ${id}`)
    return p
  }

  private rngFor(...keys: number[]): Rng {
    return new Rng(deriveSeed(this.seed, this.year, ...keys))
  }

  /** Collect all prospect ids across all known draft classes. */
  private allDraftProspectIds(): Set<string> {
    const ids = new Set<string>()
    for (const cls of this.data.league.draftClasses) {
      for (const p of cls.prospects) ids.add(p.playerId as string)
    }
    return ids
  }

  /** Current free agent id set (players not on any roster). */
  private currentFaIds(): Set<string> {
    const rostered = new Set<string>()
    for (const t of this.data.teams.values()) for (const id of t.roster) rostered.add(id as string)
    const fa = new Set<string>()
    for (const id of this.faPool) if (!rostered.has(id as string)) fa.add(id as string)
    return fa
  }

  /** Fog context for view builders — uses current scouting state. */
  private fogCtx(): FogCtx {
    return { scouting: this.scouting }
  }

  private ctx(): ViewCtx {
    return {
      teams: this.data.teams,
      players: this.data.players,
      conferences: this.data.league.conferences,
      divisions: this.data.league.divisions,
      schedule: this.data.league.schedule,
      userTeamId: this.userTeamId,
      year: this.year,
      day: this.currentDay,
      totals: this.totals,
      gp: this.gp,
      goalieWins: this.goalieWins,
      goalieLosses: this.goalieLosses,
      ppGoals: this.ppGoals,
      ppAssists: this.ppAssists,
      standingsSorted: sortStandings([...this.standings.values()]),
    }
  }

  private pushNews(
    category: NewsCategory,
    headline: string,
    body: string,
    refs: { teamId?: string; playerId?: string } = {}
  ): void {
    const item: NewsItem = {
      id: `n${this.newsCounter++}`,
      day: this.currentDay,
      year: this.year,
      category,
      headline,
      body,
      read: false,
      ...(refs.teamId !== undefined ? { teamId: refs.teamId } : {}),
      ...(refs.playerId !== undefined ? { playerId: refs.playerId } : {}),
    }
    this.news.unshift(item)
    if (this.news.length > NEWS_LIMIT) this.news.length = NEWS_LIMIT
  }

  /* ────────────────────────── outcome bookkeeping ────────────────────────── */

  private creditExtraStats(res: GameOutcome): void {
    for (const ev of res.stream) {
      if (ev.type !== 'goal') continue
      if (ev.strength === 'pp') {
        this.ppGoals.set(ev.scorer, (this.ppGoals.get(ev.scorer) ?? 0) + 1)
        for (const a of ev.assists) this.ppAssists.set(a, (this.ppAssists.get(a) ?? 0) + 1)
      }
    }
    const homeWon = res.homeGoals > res.awayGoals
    const credit = (teamId: TeamId, won: boolean): void => {
      const team = this.data.teams.get(teamId)!
      let best: { id: PlayerId; toi: number } | null = null
      for (const id of team.roster) {
        const s = res.playerStats.get(id)
        if (!s || s.shotsAgainst <= 0) continue
        if (this.resolve(id).position !== 'G') continue
        if (!best || s.toi > best.toi) best = { id, toi: s.toi }
      }
      if (!best) return
      const map = won ? this.goalieWins : this.goalieLosses
      map.set(best.id, (map.get(best.id) ?? 0) + 1)
    }
    credit(res.homeTeamId, homeWon)
    credit(res.awayTeamId, !homeWon)
  }

  /** Apply a regular-season outcome to standings/totals/news — engine-agnostic. */
  private applyOutcome(game: ScheduledGame, res: GameOutcome): void {
    game.result = {
      homeGoals: res.homeGoals,
      awayGoals: res.awayGoals,
      decidedBy: res.decidedBy,
    }
    applyStandingsResult(this.standings, res)
    mergePlayerStats(this.totals, res.playerStats)
    for (const [pid, s] of res.playerStats) {
      if (s.toi > 0) this.gp.set(pid, (this.gp.get(pid) ?? 0) + 1)
    }
    this.creditExtraStats(res)
    if (game.homeTeamId === this.userTeamId || game.awayTeamId === this.userTeamId) {
      this.recordUserResultNews(game.day, res)
    }
  }

  private postGame(res: GameOutcome, dayRng: Rng): Set<PlayerId> {
    const played = new Set<PlayerId>()
    const participants: Array<{ player: Player; toi: number }> = []
    for (const [pid, s] of res.playerStats) {
      if (s.toi <= 0) continue
      played.add(pid)
      participants.push({ player: this.resolve(pid), toi: s.toi })
    }
    const injuries = rollInjuries({ participants, rng: dayRng })
    for (const inj of injuries) {
      const p = this.resolve(inj.playerId)
      const teamId = this.teamOf(inj.playerId)
      if (teamId === this.userTeamId) {
        const games = `${inj.injury.gamesRemaining} game${inj.injury.gamesRemaining === 1 ? '' : 's'}`
        this.pushNews(
          'injury',
          `${p.name} out ${games}`,
          `${p.name} suffered a ${inj.injury.description} and is expected to miss ${games}.`,
          { playerId: inj.playerId as string, teamId: teamId as string }
        )
      }
    }
    const home = this.data.teams.get(res.homeTeamId)!
    const away = this.data.teams.get(res.awayTeamId)!
    applyResultMorale({ team: home, players: this.data.players, won: res.homeGoals > res.awayGoals })
    applyResultMorale({ team: away, players: this.data.players, won: res.awayGoals > res.homeGoals })
    return played
  }

  private teamOf(id: PlayerId): TeamId | null {
    for (const t of this.data.teams.values()) if (t.roster.includes(id)) return t.id
    return null
  }

  private recordUserResultNews(day: number, res: GameOutcome): void {
    const home = this.data.teams.get(res.homeTeamId)!
    const away = this.data.teams.get(res.awayTeamId)!
    const userIsHome = res.homeTeamId === this.userTeamId
    const us = userIsHome ? res.homeGoals : res.awayGoals
    const them = userIsHome ? res.awayGoals : res.homeGoals
    const suffix =
      res.decidedBy === 'overtime' ? ' (OT)' : res.decidedBy === 'shootout' ? ' (SO)' : ''
    const outcome = us > them ? 'Win' : res.decidedBy === 'regulation' ? 'Loss' : 'OT loss'
    const opp = userIsHome ? away : home
    this.pushNews(
      'result',
      `Day ${day}: ${outcome} ${us}-${them}${suffix} ${userIsHome ? 'vs' : '@'} ${opp.abbreviation}`,
      `${away.name} ${res.awayGoals} @ ${home.name} ${res.homeGoals}${suffix}.`,
      { teamId: opp.id as string }
    )
  }

  /* ────────────────────────── regular-season day loop ────────────────────────── */

  private gameSeedFor(game: ScheduledGame): number {
    return gameSeed(this.seed, this.year, game.id)
  }

  private prepareTeamsForDay(): void {
    for (const team of this.data.teams.values()) repairLines(team, this.data.players)
  }

  private finishDay(day: number, played: Set<PlayerId>): void {
    const dayRng = this.rngFor(7001, day)
    tickRecovery({ players: this.data.players.values(), playedToday: played, rng: dayRng })
    tickScouting({
      state: this.scouting,
      userTeamId: this.userTeamId as string,
      teams: this.data.teams as Map<TeamId, { roster: PlayerId[]; divisionId?: string }>,
      players: this.data.players,
      draftProspectIds: this.allDraftProspectIds(),
      freeAgentIds: this.currentFaIds(),
      rng: this.rngFor(7008, day),
    })
    this.tradeOffers = this.tradeOffers.filter((o) => o.expiresOnDay > day)
    if (this.phase === 'regularSeason' && day <= this.deadlineDay) {
      const offers = generateAiOffers({
        day,
        userTeamId: this.userTeamId,
        teams: this.data.teams,
        players: this.data.players,
        picks: this.picks,
        rng: this.rngFor(7002, day),
        nextOfferId: () => `o${this.offerCounter++}`,
      })
      for (const o of offers) {
        this.tradeOffers.push(o)
        const partner = this.data.teams.get(o.partnerTeamId)!
        this.pushNews(
          'trade',
          `Trade offer from ${partner.abbreviation}`,
          o.message,
          { teamId: o.partnerTeamId as string }
        )
      }
    }
    this.currentDay = day
    if (this.phase === 'regularSeason' && day >= (this.matchDays[this.matchDays.length - 1] ?? 0)) {
      this.enterPlayoffs()
    }
  }

  /** Advance to (and simulate) the next match day. Returns false if none left. */
  advanceDay(): boolean {
    if (this.phase !== 'regularSeason') return false
    const nextDay = this.matchDays.find((d) => d > this.currentDay)
    if (nextDay === undefined) return false
    this.prepareTeamsForDay()
    const played = new Set<PlayerId>()
    for (const game of this.data.league.schedule) {
      if (game.day !== nextDay) continue
      const home = this.data.teams.get(game.homeTeamId)!
      const away = this.data.teams.get(game.awayTeamId)!
      const res = quickSimGame(home, away, effectiveResolve(this.resolve), {
        seed: this.gameSeedFor(game),
      })
      this.applyOutcome(game, res)
      for (const pid of this.postGame(res, this.rngFor(7003, nextDay, game.id.length))) {
        played.add(pid)
      }
      if (game.homeTeamId === this.userTeamId || game.awayTeamId === this.userTeamId) {
        this.lastBoxScore = buildBoxScore(res, home, away, this.resolve)
      }
    }
    this.finishDay(nextDay, played)
    return true
  }

  /** Advance up to `days` match days (default 1). Returns days actually played. */
  advance(days = 1): number {
    let played = 0
    for (let i = 0; i < days; i++) {
      if (!this.step()) break
      played++
    }
    return played
  }

  /** One phase-aware step: a match day, a playoff day, or an offseason stage. */
  step(): boolean {
    if (this.phase === 'regularSeason') return this.advanceDay()
    if (this.phase === 'playoffs') return this.playPlayoffDay(false) !== undefined
    return this.advanceOffseason()
  }

  /** Advance until the user's next game has been played (or phase changes). */
  advanceToNextGame(): void {
    const before = this.userGamesPlayed()
    for (let guard = 0; guard < 200; guard++) {
      if (!this.step()) return
      if (this.userGamesPlayed() > before) return
      if (this.phase === 'offseason') return
    }
  }

  private userGamesPlayed(): number {
    let n = 0
    for (const g of this.data.league.schedule) {
      if (g.result && (g.homeTeamId === this.userTeamId || g.awayTeamId === this.userTeamId)) n++
    }
    if (this.playoffs) {
      for (const round of this.playoffs.rounds) {
        for (const s of round.series) {
          if (s.highSeedTeamId === this.userTeamId || s.lowSeedTeamId === this.userTeamId) {
            n += s.games.length
          }
        }
      }
    }
    return n
  }

  /**
   * Play the next day with the USER's fixture on the full-fidelity engine,
   * returning its positional stream. Works in the regular season and the
   * playoffs; null when there is nothing watchable (offseason, bye, done).
   */
  watchNext(): WatchedGame | null {
    if (this.phase === 'regularSeason') return this.watchRegularDay()
    if (this.phase === 'playoffs') return this.playPlayoffDay(true) ?? null
    return null
  }

  private buildWatched(home: TeamId, away: TeamId, stream: GameStream): WatchedGame {
    const h = this.data.teams.get(home)!
    const a = this.data.teams.get(away)!
    const playerNames: Record<string, string> = {}
    for (const id of [...h.roster, ...a.roster]) playerNames[id as string] = this.resolve(id).name
    return {
      homeName: h.name,
      awayName: a.name,
      homeAbbr: h.abbreviation,
      awayAbbr: a.abbreviation,
      userIsHome: home === this.userTeamId,
      homePlayerIds: h.roster.map((id) => id as string),
      homeColors: { ...h.colors },
      awayColors: { ...a.colors },
      playerNames,
      stream,
    }
  }

  private watchRegularDay(): WatchedGame | null {
    const nextDay = this.matchDays.find((d) => d > this.currentDay)
    if (nextDay === undefined) return null
    this.prepareTeamsForDay()
    let watched: WatchedGame | null = null
    const played = new Set<PlayerId>()
    for (const game of this.data.league.schedule) {
      if (game.day !== nextDay) continue
      const home = this.data.teams.get(game.homeTeamId)!
      const away = this.data.teams.get(game.awayTeamId)!
      const isUser = game.homeTeamId === this.userTeamId || game.awayTeamId === this.userTeamId
      const sim = isUser ? fullSimGame : quickSimGame
      const res = sim(home, away, effectiveResolve(this.resolve), {
        seed: this.gameSeedFor(game),
      })
      this.applyOutcome(game, res)
      for (const pid of this.postGame(res, this.rngFor(7003, nextDay, game.id.length))) {
        played.add(pid)
      }
      if (isUser) {
        watched = this.buildWatched(game.homeTeamId, game.awayTeamId, res.stream)
        this.lastBoxScore = buildBoxScore(res, home, away, this.resolve)
      }
    }
    this.finishDay(nextDay, played)
    return watched
  }

  /* ────────────────────────── playoffs ────────────────────────── */

  private enterPlayoffs(): void {
    const order = sortStandings([...this.standings.values()]).map((s) => s.teamId)
    const conferences = this.data.league.conferences.map((c) => ({
      name: c.name,
      teamIds: this.data.league.teams.filter(
        (tid) => this.data.teams.get(tid)!.conferenceId === c.id
      ),
    }))
    this.playoffs = seedBracket({ year: this.year, conferences, standingsOrder: order })
    this.phase = 'playoffs'
    const qualified = new Set<string>()
    for (const s of this.playoffs.rounds[0]?.series ?? []) {
      qualified.add(s.highSeedTeamId as string)
      qualified.add(s.lowSeedTeamId as string)
    }
    const made = qualified.has(this.userTeamId as string)
    this.pushNews(
      'playoffs',
      made ? 'Playoffs begin — you are in!' : 'Playoffs begin',
      made
        ? `The ${this.userTeam.name} qualified for the postseason. Best-of-${this.playoffs.bestOf} series, win ${seriesWinsNeeded(this.playoffs)} to advance.`
        : `The ${this.userTeam.name} missed the playoffs. The draft order smiles on the fallen.`
    )
  }

  /** One playoff "day": every unfinished series in the round plays one game. */
  private playPlayoffDay(watchUser: boolean): WatchedGame | null | undefined {
    const po = this.playoffs
    if (!po || po.championTeamId) return undefined
    const games = pendingGames(po)
    if (games.length === 0) return undefined
    this.prepareTeamsForDay()
    let watched: WatchedGame | null = null
    const played = new Set<PlayerId>()
    const day = this.currentDay + 1

    for (const g of games) {
      const home = this.data.teams.get(g.homeTeamId)!
      const away = this.data.teams.get(g.awayTeamId)!
      const isUser = g.homeTeamId === this.userTeamId || g.awayTeamId === this.userTeamId
      const seed = gameSeed(this.seed, this.year, `${g.seriesId}-g${g.gameNumber}`)
      const sim = isUser && watchUser ? fullSimGame : quickSimGame
      const res = sim(home, away, effectiveResolve(this.resolve), { seed, rules: 'playoff' })
      if (res.decidedBy === 'shootout') throw new Error('playoff game decided by shootout')
      const result: SeriesGameResult = {
        gameId: asGameId(`${g.seriesId}-g${g.gameNumber}`),
        gameNumber: g.gameNumber,
        homeTeamId: g.homeTeamId,
        awayTeamId: g.awayTeamId,
        homeGoals: res.homeGoals,
        awayGoals: res.awayGoals,
        decidedBy: res.decidedBy,
      }
      applySeriesResult(po, g.seriesId, result)
      for (const pid of this.postGame(res, this.rngFor(7004, day, g.gameNumber))) played.add(pid)
      if (isUser) {
        this.recordUserResultNews(day, res)
        this.lastBoxScore = buildBoxScore(res, home, away, this.resolve)
        if (watchUser) watched = this.buildWatched(g.homeTeamId, g.awayTeamId, res.stream)
      }
      const series = po.rounds.flatMap((r) => r.series).find((s) => s.id === g.seriesId)
      if (series?.winnerTeamId && isUser) {
        const won = series.winnerTeamId === this.userTeamId
        const opp = this.data.teams.get(
          series.highSeedTeamId === this.userTeamId ? series.lowSeedTeamId : series.highSeedTeamId
        )!
        this.pushNews(
          'playoffs',
          won ? `Series won vs ${opp.abbreviation}!` : `Eliminated by ${opp.abbreviation}`,
          won
            ? `The ${this.userTeam.name} take the series ${series.highSeedTeamId === this.userTeamId ? series.highSeedWins : series.lowSeedWins}–${series.highSeedTeamId === this.userTeamId ? series.lowSeedWins : series.highSeedWins} and advance.`
            : `The season ends. Time to build for next year.`,
          { teamId: opp.id as string }
        )
      }
    }

    const dayRng = this.rngFor(7005, day)
    tickRecovery({ players: this.data.players.values(), playedToday: played, rng: dayRng })
    this.currentDay = day

    if (po.championTeamId) {
      const champ = this.data.teams.get(po.championTeamId)!
      this.pushNews(
        'playoffs',
        `${champ.name} win the championship!`,
        po.championTeamId === this.userTeamId
          ? `YOUR ${champ.name} are the champions. The city is on fire (the good kind).`
          : `The ${champ.name} lift the cup. Next year it should be yours.`,
        { teamId: champ.id as string }
      )
      this.enterOffseason()
    }
    return watched
  }

  /* ────────────────────────── offseason ────────────────────────── */

  private enterOffseason(): void {
    this.phase = 'offseason'
    this.offseason = { year: this.year, stage: 'awards', draft: null, faDay: 0 }
  }

  /** Move the offseason forward one stage (or one FA day). Returns true if it moved. */
  advanceOffseason(): boolean {
    const os = this.offseason
    if (!os) return false
    switch (os.stage) {
      case 'awards': {
        const rng = this.rngFor(8001)
        const dev = developPlayers({
          players: this.data.players,
          gamesPlayedById: (id) => this.gp.get(id) ?? 0,
          year: this.year,
          rng,
        })
        for (const seed of dev.newsSeeds) {
          const p = this.resolve(seed.playerId)
          this.pushNews(
            seed.kind === 'breakout' ? 'milestone' : 'league',
            seed.kind === 'breakout' ? `${p.name} is leveling up` : `${p.name} losing a step`,
            seed.kind === 'breakout'
              ? `Offseason training has transformed ${p.name} (${p.position}, ${p.age}).`
              : `Scouts report ${p.name} (${p.position}, ${p.age}) has visibly declined.`,
            { playerId: seed.playerId as string }
          )
        }
        const retired = processRetirements({
          players: this.data.players,
          teams: this.data.teams,
          year: this.year,
          rng,
        })
        for (const id of retired.retired.slice(0, 8)) {
          const p = this.resolve(id)
          this.pushNews('league', `${p.name} retires`, `${p.name} hangs up the skates at ${p.age}.`, {
            playerId: id as string,
          })
        }
        const draftYear = this.year + 1
        const cls = generateDraftClass({
          year: draftYear,
          count: DRAFT_CLASS_SIZE,
          rng: this.rngFor(8002),
          nextPlayerNumber: () => this.playerCounter++,
        })
        for (const p of cls.players) {
          this.data.players.set(p.id, p)
          this.data.league.players.push(p.id)
        }
        this.data.league.draftClasses.push(cls.draftClass)
        const worstFirst = sortStandings([...this.standings.values()])
          .map((s) => s.teamId)
          .reverse()
        os.draft = buildDraftOrder({
          year: draftYear,
          rounds: DRAFT_ROUNDS,
          picks: this.picks.filter((p) => p.year === draftYear),
          standingsWorstFirst: worstFirst,
        })
        os.stage = 'draft'
        this.pushNews(
          'draft',
          `The ${draftYear} entry draft is open`,
          `${cls.draftClass.prospects.length} prospects are on the board across ${DRAFT_ROUNDS} rounds.`
        )
        return true
      }
      case 'draft': {
        this.simDraftUntil(() => false)
        const rng = this.rngFor(8003)
        for (const team of this.data.teams.values()) repairLines(team, this.data.players)
        this.resignStatus.clear()
        for (const id of this.userTeam.roster) {
          if (this.resolve(id).contract.yearsRemaining === 0) this.resignStatus.set(id, 'pending')
        }
        const ai = aiResignDay({
          teams: this.data.teams,
          players: this.data.players,
          userTeamId: this.userTeamId,
          year: this.year,
          rng,
        })
        if (ai.signings.length > 0) {
          this.pushNews(
            'contract',
            `${ai.signings.length} re-signings around the league`,
            `Clubs locked up their expiring talent ahead of free agency.`
          )
        }
        os.stage = 'resign'
        return true
      }
      case 'resign': {
        const { expired } = processExpiries({
          teams: this.data.teams,
          players: this.data.players,
          year: this.year,
        })
        this.faPool = expired.map((e) => e.playerId)
        for (const e of expired) {
          if (e.teamId === this.userTeamId) {
            const p = this.resolve(e.playerId)
            this.pushNews(
              'contract',
              `${p.name} hits free agency`,
              `${p.name} (${p.position}, ${p.age}) left for the open market.`,
              { playerId: e.playerId as string }
            )
          }
        }
        for (const team of this.data.teams.values()) repairLines(team, this.data.players)
        os.stage = 'freeAgency'
        os.faDay = 0
        return true
      }
      case 'freeAgency': {
        os.faDay++
        const res = aiFreeAgencyDay({
          teams: this.data.teams,
          players: this.data.players,
          freeAgentIds: this.faPool,
          userTeamId: this.userTeamId,
          year: this.year,
          rng: this.rngFor(8004, os.faDay),
          faDay: os.faDay,
        })
        const signedIds = new Set(res.signings.map((s) => s.playerId as string))
        this.faPool = this.faPool.filter((id) => !signedIds.has(id as string))
        for (const s of res.signings.slice(0, 6)) {
          const p = this.resolve(s.playerId)
          const t = this.data.teams.get(s.teamId)!
          this.pushNews(
            'contract',
            `${p.name} signs with ${t.abbreviation}`,
            `${t.name} sign ${p.name} for $${(s.salary / 1e6).toFixed(2)}M × ${s.years} years.`,
            { playerId: s.playerId as string, teamId: s.teamId as string }
          )
        }
        for (const team of this.data.teams.values()) repairLines(team, this.data.players)
        if (os.faDay >= FA_WINDOW_DAYS) os.stage = 'preseason'
        return true
      }
      case 'preseason': {
        this.startNewSeason()
        return true
      }
    }
  }

  /* ────────────────────────── draft mechanics ────────────────────────── */

  private remainingProspects(): { playerId: PlayerId; rank: number }[] {
    const os = this.offseason
    if (!os?.draft) return []
    const cls = this.data.league.draftClasses.find((c) => c.year === os.draft!.year)
    if (!cls) return []
    const taken = new Set(os.draft.selections.map((s) => s.playerId as string))
    return cls.prospects.filter((p) => !taken.has(p.playerId as string))
  }

  private makeSelection(playerId: PlayerId): void {
    const os = this.offseason
    if (!os?.draft) throw new Error('no draft in progress')
    const d = os.draft
    const idx = d.selections.length
    const pick = d.order[idx]
    if (!pick) throw new Error('draft is complete')
    const team = this.data.teams.get(pick.ownerTeamId)!
    const player = this.resolve(playerId)
    d.selections.push({ overallPick: idx + 1, teamId: pick.ownerTeamId, playerId })
    if (team.roster.length < ROSTER_HARD_CAP) {
      team.roster.push(playerId)
      player.contract = {
        salary: 900000,
        yearsRemaining: 3,
        expiryYear: this.year + 1 + 3,
        noTradeClause: false,
        twoWay: true,
      }
    }
    if (pick.ownerTeamId === this.userTeamId) {
      this.pushNews(
        'draft',
        `Drafted ${player.name} at #${idx + 1}`,
        `${player.name} (${player.position}, ${player.age}) joins the organization.`,
        { playerId: playerId as string }
      )
    }
  }

  /** Sim AI picks until `stop()` says hold (e.g. user on the clock) or draft ends. */
  private simDraftUntil(stop: () => boolean): void {
    const os = this.offseason
    if (!os?.draft) return
    const d = os.draft
    const rng = this.rngFor(8005)
    while (d.selections.length < d.order.length) {
      const pick = d.order[d.selections.length]
      if (pick.ownerTeamId === this.userTeamId && stop()) return
      const remaining = this.remainingProspects()
      if (remaining.length === 0) return
      const choice =
        pick.ownerTeamId === this.userTeamId
          ? remaining[0]
          : aiSelectProspect({ remaining, rng })
      this.makeSelection(choice.playerId)
    }
  }

  /** UI: the user makes their selection while on the clock. */
  draftPlayer(playerId: string): void {
    const os = this.offseason
    if (!os?.draft) throw new Error('no draft in progress')
    const pick = os.draft.order[os.draft.selections.length]
    if (!pick || pick.ownerTeamId !== this.userTeamId) throw new Error('you are not on the clock')
    const remaining = this.remainingProspects()
    if (!remaining.some((p) => (p.playerId as string) === playerId)) {
      throw new Error('prospect already drafted')
    }
    this.makeSelection(asPlayerId(playerId))
  }

  /** UI: sim AI picks until the user is on the clock or the draft completes. */
  advanceDraft(): void {
    this.simDraftUntil(() => true)
  }

  /* ────────────────────────── season rollover ────────────────────────── */

  private archiveSeasonStats(): void {
    for (const [pid, t] of this.totals) {
      const games = this.gp.get(pid) ?? 0
      if (games <= 0) continue
      const p = this.data.players.get(pid)
      if (!p) continue
      const teamId = this.teamOf(pid)
      const ppG = this.ppGoals.get(pid) ?? 0
      const ppA = this.ppAssists.get(pid) ?? 0
      p.stats.push({
        season: this.year,
        teamId: (teamId as string) ?? 'FA',
        gamesPlayed: games,
        ev: {
          goals: Math.max(0, t.goals - ppG),
          assists: Math.max(0, t.assists - ppA),
          shots: t.shots,
          timeOnIce: t.toi,
        },
        pp: { goals: ppG, assists: ppA, shots: 0, timeOnIce: 0 },
        pk: { goals: 0, assists: 0, shots: 0, timeOnIce: 0 },
        plusMinus: 0,
        penaltyMinutes: t.penaltyMinutes,
        saves: t.saves,
        shotsAgainst: t.shotsAgainst,
        goalsAgainst: t.goalsAgainst,
        shutouts: 0,
      })
    }
  }

  private startNewSeason(): void {
    const champ = this.playoffs?.championTeamId
      ? this.data.teams.get(this.playoffs.championTeamId)!
      : null
    const sorted = sortStandings([...this.standings.values()])
    const leader = this.pointsLeader()
    this.history.push({
      year: this.year,
      championTeamId: (this.playoffs?.championTeamId as string) ?? null,
      championTeamName: champ?.name ?? null,
      userRank: sorted.findIndex((s) => s.teamId === this.userTeamId) + 1,
      pointsLeader: leader,
    })

    this.archiveSeasonStats()

    const newYear = this.year + 1
    this.data.league.season.year = newYear
    this.data.league.schedule = buildSchedule([...this.data.league.teams], ROUND_ROBINS, newYear)
    this.data.league.season.standings = this.data.league.teams.map(freshStanding)
    this.refreshMatchDays()

    this.standings.clear()
    for (const teamId of this.data.league.teams) this.standings.set(teamId, freshStanding(teamId))
    this.totals.clear()
    this.gp.clear()
    this.goalieWins.clear()
    this.goalieLosses.clear()
    this.ppGoals.clear()
    this.ppAssists.clear()
    this.tradeOffers = []
    this.lastBoxScore = null
    this.resignStatus.clear()
    this.faPool = []
    this.playoffs = null
    this.offseason = null
    this.currentDay = 0
    this.phase = 'regularSeason'

    // Keep three drafts of picks on the books; drop the consumed year.
    this.picks = this.picks.filter((p) => p.year > newYear)
    const lastYear = Math.max(...this.picks.map((p) => p.year), newYear)
    for (let y = lastYear + 1; y <= newYear + PICK_YEARS_AHEAD; y++) {
      this.picks.push(
        ...initialPicks({
          teamIds: [...this.data.league.teams],
          firstDraftYear: y,
          yearsAhead: 1,
          rounds: DRAFT_ROUNDS,
        })
      )
    }
    for (const team of this.data.teams.values()) repairLines(team, this.data.players)
    this.pushNews(
      'league',
      `${this.data.league.name} ${newYear}–${newYear + 1} season begins`,
      `A clean sheet of ice. ${this.matchDays.length} match days to the playoffs.`
    )
  }

  private pointsLeader(): { name: string; points: number } | null {
    let best: { name: string; points: number } | null = null
    for (const [pid, t] of this.totals) {
      const pts = t.goals + t.assists
      const p = this.data.players.get(pid)
      if (!p || p.position === 'G') continue
      if (!best || pts > best.points) best = { name: p.name, points: pts }
    }
    return best
  }

  /* ────────────────────────── user mutations ────────────────────────── */

  setLines(update: LinesUpdate): void {
    const team = this.userTeam
    const roster = new Set(team.roster.map((id) => id as string))
    const check = (ids: string[]): void => {
      for (const id of ids) {
        if (!roster.has(id)) throw new Error(`player ${id} is not on your roster`)
      }
    }
    update.forwards.forEach(check)
    update.defensePairs.forEach(check)
    check(update.goalies)
    update.powerPlayUnits.forEach(check)
    update.penaltyKillUnits.forEach(check)
    team.lines = {
      forwards: update.forwards.map(
        (l) => [asPlayerId(l[0]), asPlayerId(l[1]), asPlayerId(l[2])] as [PlayerId, PlayerId, PlayerId]
      ),
      defensePairs: update.defensePairs.map(
        (l) => [asPlayerId(l[0]), asPlayerId(l[1])] as [PlayerId, PlayerId]
      ),
      goalies: [asPlayerId(update.goalies[0]), asPlayerId(update.goalies[1])] as [PlayerId, PlayerId],
      powerPlayUnits: update.powerPlayUnits.map((u) => u.map(asPlayerId)),
      penaltyKillUnits: update.penaltyKillUnits.map((u) => u.map(asPlayerId)),
    }
  }

  setTactics(tactics: TeamTactics): void {
    this.userTeam.tactics = structuredClone(tactics)
  }

  markNewsRead(ids: string[]): void {
    const set = new Set(ids)
    for (const n of this.news) if (set.has(n.id)) n.read = true
  }

  releasePlayer(playerId: string): void {
    releaseFromTeam({
      team: this.userTeam,
      playerId: asPlayerId(playerId),
      players: this.data.players,
    })
    repairLines(this.userTeam, this.data.players)
    const p = this.resolve(asPlayerId(playerId))
    this.pushNews('contract', `${p.name} released`, `${p.name} was placed on waivers and released.`, {
      playerId,
    })
  }

  resignPlayer(playerId: string, salary: number, years: number): { signed: boolean; message: string } {
    const os = this.offseason
    if (!os || os.stage !== 'resign') throw new Error('re-signing window is closed')
    const id = asPlayerId(playerId)
    const status = this.resignStatus.get(id)
    if (status === 'signed') return { signed: true, message: 'Already signed.' }
    if (status === 'walked') return { signed: false, message: 'He has decided to test free agency.' }
    if (status === undefined) throw new Error('player is not in your re-sign list')
    const player = this.resolve(id)
    const ask = askTerms(player, this.year)
    const rng = this.rngFor(8006, Number((playerId.match(/\d+/) ?? ['0'])[0]))
    if (offerAcceptable(player, { salary, years }, ask, rng)) {
      signPlayer({
        team: this.userTeam,
        player,
        salary,
        years,
        year: this.year,
        players: this.data.players,
      })
      this.resignStatus.set(id, 'signed')
      this.pushNews(
        'contract',
        `${player.name} re-signs`,
        `${player.name} stays for $${(salary / 1e6).toFixed(2)}M × ${years} years.`,
        { playerId }
      )
      return { signed: true, message: `${player.name} signs for $${(salary / 1e6).toFixed(2)}M × ${years}.` }
    }
    if (salary < ask.salary * 0.8) {
      this.resignStatus.set(id, 'walked')
      return { signed: false, message: 'Insulted by the offer, he will test free agency.' }
    }
    return {
      signed: false,
      message: `Not enough. He is asking around $${(ask.salary / 1e6).toFixed(2)}M × ${ask.years}.`,
    }
  }

  signFreeAgent(playerId: string, salary: number, years: number): { signed: boolean; message: string } {
    const os = this.offseason
    if (!os || os.stage !== 'freeAgency') throw new Error('free agency is not open')
    const id = asPlayerId(playerId)
    if (!this.faPool.some((f) => (f as string) === playerId)) {
      throw new Error('player is not a free agent')
    }
    const player = this.resolve(id)
    const ask = askTerms(player, this.year)
    const rng = this.rngFor(8007, os.faDay, Number((playerId.match(/\d+/) ?? ['0'])[0]))
    if (!offerAcceptable(player, { salary, years }, ask, rng)) {
      return {
        signed: false,
        message: `He wants more — around $${(ask.salary / 1e6).toFixed(2)}M × ${ask.years}.`,
      }
    }
    signPlayer({
      team: this.userTeam,
      player,
      salary,
      years,
      year: this.year,
      players: this.data.players,
    })
    this.faPool = this.faPool.filter((f) => (f as string) !== playerId)
    repairLines(this.userTeam, this.data.players)
    this.pushNews(
      'contract',
      `${player.name} signs with ${this.userTeam.abbreviation}`,
      `Welcome aboard: $${(salary / 1e6).toFixed(2)}M × ${years} years.`,
      { playerId }
    )
    return { signed: true, message: `${player.name} is yours.` }
  }

  /* ────────────────────────── trades ────────────────────────── */

  private pickId(p: DraftPick): string {
    return `${p.year}-r${p.round}-${p.originalTeamId}`
  }

  private pickByIds(ids: string[]): DraftPick[] {
    return ids.map((id) => {
      const pick = this.picks.find((p) => this.pickId(p) === id)
      if (!pick) throw new Error(`unknown pick ${id}`)
      return pick
    })
  }

  proposeTrade(proposal: TradeProposal): TradeEvaluation {
    if (!this.tradingOpen()) throw new Error('the trade market is closed')
    const partnerId = asTeamId(proposal.partnerTeamId)
    const partner = this.data.teams.get(partnerId)
    if (!partner) throw new Error('unknown partner team')
    const give = {
      players: proposal.givePlayerIds.map((id) => this.resolve(asPlayerId(id))),
      picks: this.pickByIds(proposal.givePickIds),
    }
    const receive = {
      players: proposal.receivePlayerIds.map((id) => this.resolve(asPlayerId(id))),
      picks: this.pickByIds(proposal.receivePickIds),
    }
    const rng = this.rngFor(7006, this.currentDay, this.offerCounter)
    const evaln = evaluateProposal({
      give,
      receive,
      partnerTeam: partner,
      partnerPlayers: this.data.players,
      rng,
    })
    if (evaln.verdict === 'accept') {
      executeTrade({
        teams: this.data.teams,
        players: this.data.players,
        teamA: this.userTeamId,
        teamB: partnerId,
        aGivesPlayerIds: give.players.map((p) => p.id),
        aGivesPicks: give.picks,
        bGivesPlayerIds: receive.players.map((p) => p.id),
        bGivesPicks: receive.picks,
        allPicks: this.picks,
      })
      repairLines(this.userTeam, this.data.players)
      repairLines(partner, this.data.players)
      this.pushNews(
        'trade',
        `Trade completed with ${partner.abbreviation}`,
        `${give.players.map((p) => p.name).join(', ') || 'Picks'} for ${receive.players.map((p) => p.name).join(', ') || 'picks'}.`,
        { teamId: partnerId as string }
      )
    }
    return { verdict: evaln.verdict, message: evaln.message, counter: null }
  }

  acceptTrade(offerId: string): void {
    const offer = this.tradeOffers.find((o) => o.offerId === offerId)
    if (!offer) throw new Error('offer no longer available')
    const partner = this.data.teams.get(offer.partnerTeamId)!
    executeTrade({
      teams: this.data.teams,
      players: this.data.players,
      teamA: this.userTeamId,
      teamB: offer.partnerTeamId,
      aGivesPlayerIds: offer.userGivesPlayerIds,
      aGivesPicks: offer.userGivesPicks,
      bGivesPlayerIds: offer.userReceivesPlayerIds,
      bGivesPicks: offer.userReceivesPicks,
      allPicks: this.picks,
    })
    repairLines(this.userTeam, this.data.players)
    repairLines(partner, this.data.players)
    this.tradeOffers = this.tradeOffers.filter((o) => o.offerId !== offerId)
    this.pushNews('trade', `Trade completed with ${partner.abbreviation}`, `The deal is done.`, {
      teamId: offer.partnerTeamId as string,
    })
  }

  rejectTrade(offerId: string): void {
    this.tradeOffers = this.tradeOffers.filter((o) => o.offerId !== offerId)
  }

  private tradingOpen(): boolean {
    return this.phase === 'regularSeason' && this.currentDay <= this.deadlineDay
  }

  /* ────────────────────────── view builders ────────────────────────── */

  getDashboard(): DashboardView {
    const ctx = this.ctx()
    const sorted = ctx.standingsSorted
    const rank = sorted.findIndex((s) => s.teamId === this.userTeamId) + 1
    const team = this.userTeam
    const conferenceTeams = sorted.filter(
      (s) => this.data.teams.get(s.teamId)!.conferenceId === team.conferenceId
    )
    const conferenceRank = conferenceTeams.findIndex((s) => s.teamId === this.userTeamId) + 1
    const division = this.data.league.divisions.find((d) => d.id === team.divisionId)
    const divisionRows = sorted
      .filter((s) => this.data.teams.get(s.teamId)!.divisionId === team.divisionId)
      .map((s) => standingRowView(ctx, s))

    const nextSched = this.data.league.schedule.find(
      (g) => !g.result && (g.homeTeamId === this.userTeamId || g.awayTeamId === this.userTeamId)
    )
    let nextGame: DashboardView['nextGame'] = null
    if (this.phase === 'regularSeason' && nextSched) {
      const home = nextSched.homeTeamId === this.userTeamId
      const opp = this.data.teams.get(home ? nextSched.awayTeamId : nextSched.homeTeamId)!
      nextGame = {
        day: nextSched.day,
        date: dayToDateISO(this.year, nextSched.day),
        opponentTeamId: opp.id as string,
        opponentName: opp.name,
        opponentAbbr: opp.abbreviation,
        home,
        opponentRank: sorted.findIndex((s) => s.teamId === opp.id) + 1,
      }
    } else if (this.phase === 'playoffs' && this.playoffs) {
      const pending = pendingGames(this.playoffs).find(
        (g) => g.homeTeamId === this.userTeamId || g.awayTeamId === this.userTeamId
      )
      if (pending) {
        const home = pending.homeTeamId === this.userTeamId
        const opp = this.data.teams.get(home ? pending.awayTeamId : pending.homeTeamId)!
        nextGame = {
          day: this.currentDay + 1,
          date: dayToDateISO(this.year, this.currentDay + 1),
          opponentTeamId: opp.id as string,
          opponentName: opp.name,
          opponentAbbr: opp.abbreviation,
          home,
          opponentRank: sorted.findIndex((s) => s.teamId === opp.id) + 1,
        }
      }
    }

    let lastResult: DashboardView['lastResult'] = null
    let last: ScheduledGame | null = null
    for (const g of this.data.league.schedule) {
      if (!g.result) continue
      if (g.homeTeamId === this.userTeamId || g.awayTeamId === this.userTeamId) last = g
    }
    if (last?.result) {
      lastResult = {
        day: last.day,
        date: dayToDateISO(this.year, last.day),
        homeAbbr: this.data.teams.get(last.homeTeamId)!.abbreviation,
        awayAbbr: this.data.teams.get(last.awayTeamId)!.abbreviation,
        homeGoals: last.result.homeGoals,
        awayGoals: last.result.awayGoals,
        decidedBy: last.result.decidedBy,
      }
    }

    const continueLabel = (() => {
      if (this.phase === 'regularSeason') {
        const next = this.matchDays.find((d) => d > this.currentDay)
        return next !== undefined ? `Continue — sim day ${next}` : 'Continue to playoffs'
      }
      if (this.phase === 'playoffs') return 'Continue — next playoff games'
      const stage = this.offseason?.stage ?? 'awards'
      const labels: Record<string, string> = {
        awards: 'Continue — season awards & development',
        draft: 'Continue — finish the draft',
        resign: 'Continue — open free agency',
        freeAgency: `Continue — free agency day ${(this.offseason?.faDay ?? 0) + 1}`,
        preseason: 'Continue — start the new season',
      }
      return labels[stage]
    })()

    const scorers = [...this.totals.entries()]
      .map(([id, t]) => ({ id, pts: t.goals + t.assists, g: t.goals, a: t.assists }))
      .filter(({ id }) => team.roster.includes(id))
      .sort((x, y) => y.pts - x.pts)
      .slice(0, 3)

    const roster = team.roster.map((id) => this.resolve(id))
    const capUsed = roster.reduce((s, p) => s + p.contract.salary, 0)
    const champ = this.playoffs?.championTeamId
      ? this.data.teams.get(this.playoffs.championTeamId)!.name
      : null

    return {
      leagueName: this.data.league.name,
      year: this.year,
      phase: this.phase,
      day: this.currentDay,
      totalDays: this.matchDays[this.matchDays.length - 1] ?? 0,
      date: dayToDateISO(this.year, Math.max(1, this.currentDay)),
      continueLabel,
      userTeam: {
        teamId: this.userTeamId as string,
        name: team.name,
        abbreviation: team.abbreviation,
        rank,
        conferenceRank,
        standing: standingRowView(ctx, this.standings.get(this.userTeamId)!),
      },
      nextGame,
      lastResult,
      divisionStandings: divisionRows,
      divisionName: division?.name ?? '',
      unreadNews: this.news.filter((n) => !n.read).length,
      topScorers: scorers.map(({ id, pts, g, a }) => ({
        ...badge(this.resolve(id)),
        points: pts,
        goals: g,
        assists: a,
      })),
      injuries: roster
        .filter((p) => p.injuryStatus !== null)
        .map((p) => ({ ...badge(p), injury: p.injuryStatus! })),
      capUsed,
      salaryCap: team.finances.salaryCap,
      championTeamName: champ,
    }
  }

  getSquad(): SquadView {
    return buildSquadView(this.ctx())
  }

  getPlayer(playerId: string): PlayerProfileView {
    const pid = asPlayerId(playerId)
    // Apply fog for players not on user's own roster
    const isOwnPlayer = this.userTeam.roster.includes(pid)
    const fog = isOwnPlayer ? undefined : this.fogCtx()
    return buildPlayerProfile(this.ctx(), pid, fog)
  }

  getScouting(): ScoutingView {
    return buildScoutingView({
      ...this.ctx(),
      scouting: this.scouting,
      draftProspectIds: this.allDraftProspectIds(),
    })
  }

  assignScoutTarget(scoutId: string, target: ScoutTarget): void {
    assignScout(this.scouting, scoutId, target)
  }

  getTactics(): TacticsView {
    return buildTacticsView(this.ctx())
  }

  getSchedule(): ScheduleView {
    return buildScheduleView(this.ctx())
  }

  getStandings(): StandingsView {
    return buildStandingsView(this.ctx())
  }

  getStats(): StatsView {
    return buildStatsView(this.ctx())
  }

  getFinances(): FinanceView {
    return buildFinanceView(this.ctx())
  }

  getInbox(): InboxView {
    return { items: [...this.news], unread: this.news.filter((n) => !n.read).length }
  }

  getLastBoxScore(): BoxScoreView | null {
    return this.lastBoxScore
  }

  private pickAsset(p: DraftPick): PickAssetView {
    return {
      id: this.pickId(p),
      year: p.year,
      round: p.round,
      originalTeamAbbr: this.data.teams.get(p.originalTeamId)!.abbreviation,
      label: `${p.year} R${p.round} (${this.data.teams.get(p.originalTeamId)!.abbreviation})`,
    }
  }

  private tradeSide(teamId: TeamId, playerIds: PlayerId[], picks: DraftPick[]): TradeSideView {
    const team = this.data.teams.get(teamId)!
    return {
      teamId: teamId as string,
      teamName: team.name,
      teamAbbr: team.abbreviation,
      players: playerIds.map((id) => {
        const p = this.resolve(id)
        return { ...badge(p), salary: p.contract.salary, yearsRemaining: p.contract.yearsRemaining }
      }),
      picks: picks.map((p) => this.pickAsset(p)),
    }
  }

  private offerView(o: StoredTradeOffer): TradeOfferView {
    return {
      offerId: o.offerId,
      receive: this.tradeSide(o.partnerTeamId, o.userReceivesPlayerIds, o.userReceivesPicks),
      give: this.tradeSide(this.userTeamId, o.userGivesPlayerIds, o.userGivesPicks),
      message: o.message,
      expiresOnDay: o.expiresOnDay,
    }
  }

  getTrades(): TradesView {
    const fog = this.fogCtx()
    const tradable = (teamId: TeamId) => {
      const team = this.data.teams.get(teamId)!
      const isUserTeam = teamId === this.userTeamId
      return team.roster.map((id) => {
        const p = this.resolve(id)
        const playerFog = isUserTeam ? undefined : fog
        return {
          ...badge(p, playerFog),
          salary: p.contract.salary,
          yearsRemaining: p.contract.yearsRemaining,
          noTradeClause: p.contract.noTradeClause,
        }
      })
    }
    return {
      incoming: this.tradeOffers.map((o) => this.offerView(o)),
      partners: this.data.league.teams
        .filter((tid) => tid !== this.userTeamId)
        .map((tid) => {
          const team = this.data.teams.get(tid)!
          return {
            teamId: tid as string,
            teamName: team.name,
            teamAbbr: team.abbreviation,
            players: tradable(tid),
            picks: this.picks.filter((p) => p.ownerTeamId === tid).map((p) => this.pickAsset(p)),
          }
        }),
      myPlayers: tradable(this.userTeamId),
      myPicks: this.picks
        .filter((p) => p.ownerTeamId === this.userTeamId)
        .map((p) => this.pickAsset(p)),
      deadlineDay: this.deadlineDay,
      tradingOpen: this.tradingOpen(),
    }
  }

  getDraft(): DraftView | null {
    const os = this.offseason
    if (!os?.draft) return null
    const d = os.draft
    const cls = this.data.league.draftClasses.find((c) => c.year === d.year)
    const rankOf = new Map(cls?.prospects.map((p) => [p.playerId as string, p.rank]) ?? [])
    const taken = new Set(d.selections.map((s) => s.playerId as string))
    const onClockIndex = d.selections.length < d.order.length ? d.selections.length : -1
    return {
      year: d.year,
      rounds: DRAFT_ROUNDS,
      board: d.order.map((pick, i) => {
        const sel = d.selections[i]
        const team = this.data.teams.get(pick.ownerTeamId)!
        return {
          overallPick: i + 1,
          round: pick.round,
          teamId: pick.ownerTeamId as string,
          teamAbbr: team.abbreviation,
          selection: sel
            ? {
                ...badge(this.resolve(sel.playerId)),
                rank: rankOf.get(sel.playerId as string) ?? 0,
              }
            : null,
          isUserPick: pick.ownerTeamId === this.userTeamId,
        }
      }),
      onClockIndex,
      userIsOnClock:
        onClockIndex >= 0 && d.order[onClockIndex].ownerTeamId === this.userTeamId,
      prospects: (cls?.prospects ?? []).map((pr) => {
        const p = this.resolve(pr.playerId)
        return {
          ...badge(p),
          rank: pr.rank,
          potentialStars: potentialStars(p),
          drafted: taken.has(pr.playerId as string),
        }
      }),
      complete: d.selections.length >= d.order.length,
    }
  }

  getOffseason(): OffseasonView | null {
    const os = this.offseason
    if (!os) return null
    const stageLabels: Record<OffseasonState['stage'], string> = {
      awards: 'Season awards',
      draft: 'Entry draft',
      resign: 'Re-sign your players',
      freeAgency: `Free agency — day ${os.faDay}`,
      preseason: 'Preseason',
    }
    const team = this.userTeam
    const roster = team.roster.map((id) => this.resolve(id))
    const capUsed = roster.reduce((s, p) => s + p.contract.salary, 0)
    const awards =
      os.stage === 'awards' || os.stage === 'draft' ? this.computeAwards() : null
    return {
      year: os.year,
      stage: os.stage,
      stageLabel: stageLabels[os.stage],
      awards,
      championTeamName: this.playoffs?.championTeamId
        ? this.data.teams.get(this.playoffs.championTeamId)!.name
        : null,
      expiring: [...this.resignStatus.entries()].map(([id, status]) => {
        const p = this.resolve(id)
        const ask = askTerms(p, this.year)
        return {
          ...badge(p),
          currentSalary: p.contract.salary,
          askSalary: ask.salary,
          askYears: ask.years,
          morale: Math.round(p.morale),
          status,
        }
      }),
      freeAgents: this.faPool
        .map((id) => this.resolve(id))
        .sort((a, b) => overall(b.composites, b.position) - overall(a.composites, a.position))
        .slice(0, 60)
        .map((p) => {
          const ask = askTerms(p, this.year)
          const rank = overall(p.composites, p.position)
          return {
            ...badge(p),
            askSalary: ask.salary,
            askYears: ask.years,
            decidesInDays: Math.max(1, Math.round((90 - rank) / 10)),
          }
        }),
      capUsed,
      salaryCap: team.finances.salaryCap,
    }
  }

  private computeAwards(): Array<{ award: string; winner: ReturnType<typeof badge> & { teamAbbr: string } }> {
    const out: Array<{ award: string; winner: ReturnType<typeof badge> & { teamAbbr: string } }> = []
    const abbrOf = (id: PlayerId): string => {
      const t = this.teamOf(id)
      return t ? this.data.teams.get(t)!.abbreviation : 'FA'
    }
    const top = (
      award: string,
      score: (t: GamePlayerStat, id: PlayerId) => number,
      filter: (p: Player) => boolean
    ): void => {
      let bestId: PlayerId | null = null
      let bestVal = -Infinity
      for (const [id, t] of this.totals) {
        const p = this.data.players.get(id)
        if (!p || !filter(p)) continue
        const v = score(t, id)
        if (v > bestVal) {
          bestVal = v
          bestId = id
        }
      }
      if (bestId) {
        out.push({ award, winner: { ...badge(this.resolve(bestId)), teamAbbr: abbrOf(bestId) } })
      }
    }
    top('Most Valuable Player', (t) => t.goals + t.assists, (p) => p.position !== 'G')
    top('Top Goal Scorer', (t) => t.goals, (p) => p.position !== 'G')
    top('Best Playmaker', (t) => t.assists, (p) => p.position !== 'G')
    top(
      'Best Goaltender',
      (t) => (t.shotsAgainst >= 300 ? t.saves / Math.max(1, t.shotsAgainst) : -1),
      (p) => p.position === 'G'
    )
    return out
  }

  getPlayoffs(): PlayoffBracketView | null {
    const po = this.playoffs
    if (!po) return null
    const seedOf = new Map<string, number>()
    for (const s of po.rounds[0]?.series ?? []) {
      const round1Index = po.rounds[0].series.indexOf(s) % 2
      seedOf.set(s.highSeedTeamId as string, round1Index === 0 ? 1 : 2)
      seedOf.set(s.lowSeedTeamId as string, round1Index === 0 ? 4 : 3)
    }
    const need = seriesWinsNeeded(po)
    const userId = this.userTeamId as string
    let userAlive = false
    let userQualified = false
    for (const s of po.rounds.flatMap((r) => r.series)) {
      const inSeries = (s.highSeedTeamId as string) === userId || (s.lowSeedTeamId as string) === userId
      if (inSeries) {
        userQualified = true
        if (s.status !== 'finished' || s.winnerTeamId === this.userTeamId) userAlive = true
        if (s.status === 'finished' && s.winnerTeamId !== this.userTeamId) userAlive = false
      }
    }
    const seriesView = (s: PlayoffsState['rounds'][number]['series'][number]): SeriesView => {
      const high = this.data.teams.get(s.highSeedTeamId)!
      const low = this.data.teams.get(s.lowSeedTeamId)!
      const lead =
        s.highSeedWins === s.lowSeedWins
          ? `Series tied ${s.highSeedWins}-${s.lowSeedWins}`
          : s.winnerTeamId
            ? `${this.data.teams.get(s.winnerTeamId)!.abbreviation} win ${Math.max(s.highSeedWins, s.lowSeedWins)}-${Math.min(s.highSeedWins, s.lowSeedWins)}`
            : `${(s.highSeedWins > s.lowSeedWins ? high : low).abbreviation} lead ${Math.max(s.highSeedWins, s.lowSeedWins)}-${Math.min(s.highSeedWins, s.lowSeedWins)}`
      return {
        seriesId: s.id,
        round: s.round,
        highSeed: {
          teamId: s.highSeedTeamId as string,
          name: high.name,
          abbr: high.abbreviation,
          seed: seedOf.get(s.highSeedTeamId as string) ?? 0,
          wins: s.highSeedWins,
        },
        lowSeed: {
          teamId: s.lowSeedTeamId as string,
          name: low.name,
          abbr: low.abbreviation,
          seed: seedOf.get(s.lowSeedTeamId as string) ?? 0,
          wins: s.lowSeedWins,
        },
        statusLabel: lead,
        finished: s.status === 'finished',
        involvesUser:
          (s.highSeedTeamId as string) === userId || (s.lowSeedTeamId as string) === userId,
        games: s.games.map((g) => ({
          gameNumber: g.gameNumber,
          homeAbbr: this.data.teams.get(g.homeTeamId)!.abbreviation,
          awayAbbr: this.data.teams.get(g.awayTeamId)!.abbreviation,
          homeGoals: g.homeGoals,
          awayGoals: g.awayGoals,
          overtime: g.decidedBy === 'overtime',
        })),
      }
    }
    return {
      year: po.year,
      bestOf: need * 2 - 1,
      rounds: po.rounds.map((r) => ({
        round: r.round,
        name: r.name,
        series: r.series.map(seriesView),
      })),
      championTeamName: po.championTeamId
        ? this.data.teams.get(po.championTeamId)!.name
        : null,
      userAlive,
      userQualified,
    }
  }

  /* ────────────────────────── legacy v1 view ────────────────────────── */

  private standingRow(s: Standing): StandingRow {
    const team = this.data.teams.get(s.teamId)!
    return {
      teamId: s.teamId,
      name: team.name,
      abbreviation: team.abbreviation,
      gamesPlayed: s.gamesPlayed,
      wins: s.wins,
      losses: s.losses,
      overtimeLosses: s.overtimeLosses,
      points: s.points,
      goalsFor: s.goalsFor,
      goalsAgainst: s.goalsAgainst,
    }
  }

  view(): ManagerView {
    const sorted = sortStandings([...this.standings.values()])
    const rank = sorted.findIndex((s) => s.teamId === this.userTeamId) + 1
    const team = this.userTeam
    const nextSched = this.data.league.schedule.find(
      (g) => !g.result && (g.homeTeamId === this.userTeamId || g.awayTeamId === this.userTeamId)
    )
    let next: NextGame | null = null
    if (nextSched) {
      const home = nextSched.homeTeamId === this.userTeamId
      const opp = this.data.teams.get(home ? nextSched.awayTeamId : nextSched.homeTeamId)!
      next = { day: nextSched.day, opponentAbbr: opp.abbreviation, opponentName: opp.name, home }
    }
    let lastResult: ResultLine | null = null
    let last: ScheduledGame | null = null
    for (const g of this.data.league.schedule) {
      if (!g.result) continue
      if (g.homeTeamId === this.userTeamId || g.awayTeamId === this.userTeamId) last = g
    }
    if (last?.result) {
      lastResult = {
        day: last.day,
        homeAbbr: this.data.teams.get(last.homeTeamId)!.abbreviation,
        awayAbbr: this.data.teams.get(last.awayTeamId)!.abbreviation,
        homeGoals: last.result.homeGoals,
        awayGoals: last.result.awayGoals,
        decidedBy: last.result.decidedBy,
        isUserGame: true,
      }
    }
    return {
      leagueName: this.data.league.name,
      year: this.year,
      day: this.currentDay,
      totalDays: this.matchDays[this.matchDays.length - 1] ?? 0,
      seasonComplete: this.phase !== 'regularSeason',
      userTeam: {
        teamId: this.userTeamId,
        name: team.name,
        abbreviation: team.abbreviation,
        rank,
        standing: this.standingRow(this.standings.get(this.userTeamId)!),
      },
      nextGame: next,
      lastResult,
      standings: sorted.map((s) => this.standingRow(s)),
      roster: team.roster
        .map((id) => {
          const p = this.resolve(id)
          const t = this.totals.get(id)
          const savePct =
            p.position === 'G'
              ? t && t.shotsAgainst > 0
                ? t.saves / t.shotsAgainst
                : 0
              : null
          return {
            playerId: id as string,
            name: p.name,
            position: p.position,
            age: p.age,
            overall: overall(p.composites, p.position),
            gamesPlayed: this.gp.get(id) ?? 0,
            goals: t?.goals ?? 0,
            assists: t?.assists ?? 0,
            points: (t?.goals ?? 0) + (t?.assists ?? 0),
            savePct,
          }
        })
        .sort((a, b) => {
          const order: Record<Position, number> = { C: 0, W: 1, D: 2, G: 3 }
          if (order[a.position] !== order[b.position]) return order[a.position] - order[b.position]
          return b.overall - a.overall
        }),
      news: this.news.map((n) => n.headline),
    }
  }

  /* ────────────────────────── persistence ────────────────────────── */

  exportSnapshot(saveName: string, savedAt: string): CareerSnapshot {
    return {
      version: 1,
      savedAt,
      saveName,
      seed: this.seed,
      userTeamId: this.userTeamId as string,
      phase: this.phase,
      currentDay: this.currentDay,
      year: this.year,
      leagueData: serializeLeagueData(this.data),
      standings: serializeMap(this.standings as unknown as Map<string, unknown>),
      playerTotals: serializeMap(this.totals as unknown as Map<string, unknown>),
      gamesPlayed: serializeMap(this.gp as unknown as Map<string, number>),
      news: [...this.news],
      newsCounter: this.newsCounter,
      playoffs: this.playoffs,
      offseason: this.offseason,
      picks: [...this.picks],
      history: [...this.history],
      extraStats: {
        goalieWins: serializeMap(this.goalieWins as unknown as Map<string, number>),
        goalieLosses: serializeMap(this.goalieLosses as unknown as Map<string, number>),
        ppGoals: serializeMap(this.ppGoals as unknown as Map<string, number>),
        ppAssists: serializeMap(this.ppAssists as unknown as Map<string, number>),
      },
      scouting: {
        knowledge: [...this.scouting.knowledge],
        assignments: [...this.scouting.assignments],
      },
    }
  }

  static fromSnapshot(snapshot: CareerSnapshot): Career {
    const data = deserializeLeagueData(snapshot.leagueData)
    const career = new Career(data, snapshot.seed, asTeamId(snapshot.userTeamId), true)
    career.phase = snapshot.phase
    career.currentDay = snapshot.currentDay
    for (const [k, v] of snapshot.standings) {
      career.standings.set(asTeamId(k), v as Standing)
    }
    for (const [k, v] of snapshot.playerTotals) {
      career.totals.set(asPlayerId(k), v as GamePlayerStat)
    }
    for (const [k, v] of snapshot.gamesPlayed) career.gp.set(asPlayerId(k), v)
    career.news = [...snapshot.news]
    career.newsCounter = snapshot.newsCounter
    career.playoffs = snapshot.playoffs
    career.offseason = snapshot.offseason
    career.picks = snapshot.picks.map((p) => ({
      ...p,
      originalTeamId: asTeamId(p.originalTeamId as unknown as string),
      ownerTeamId: asTeamId(p.ownerTeamId as unknown as string),
    }))
    career.history = [...snapshot.history]
    if (snapshot.extraStats) {
      for (const [k, v] of snapshot.extraStats.goalieWins) career.goalieWins.set(asPlayerId(k), v)
      for (const [k, v] of snapshot.extraStats.goalieLosses) {
        career.goalieLosses.set(asPlayerId(k), v)
      }
      for (const [k, v] of snapshot.extraStats.ppGoals) career.ppGoals.set(asPlayerId(k), v)
      for (const [k, v] of snapshot.extraStats.ppAssists) career.ppAssists.set(asPlayerId(k), v)
    }
    // Restore scouting state, or create fresh if old save lacks it.
    if (snapshot.scouting) {
      career.scouting = {
        knowledge: [...snapshot.scouting.knowledge],
        assignments: [...snapshot.scouting.assignments],
      }
    } else {
      career.scouting = createInitialScouting({
        userTeamId: snapshot.userTeamId,
        teams: data.teams as Map<TeamId, { roster: PlayerId[] }>,
        players: data.players,
        rng: new Rng(deriveSeed(snapshot.seed, 9001)),
        draftProspectIds: career.allDraftProspectIds(),
      })
    }

    // Rebuild transient state that deliberately isn't saved.
    if (career.phase === 'offseason' && career.offseason?.stage === 'resign') {
      for (const id of career.userTeam.roster) {
        if (career.resolve(id).contract.yearsRemaining === 0) {
          career.resignStatus.set(id, 'pending')
        }
      }
    }
    if (career.phase === 'offseason' && career.offseason?.stage === 'freeAgency') {
      const rostered = new Set<string>()
      for (const t of career.data.teams.values()) {
        for (const id of t.roster) rostered.add(id as string)
      }
      const draftedYears = new Set(career.data.league.draftClasses.map((c) => c.year))
      const prospectIds = new Set<string>()
      for (const c of career.data.league.draftClasses) {
        if (draftedYears.has(c.year)) {
          for (const p of c.prospects) prospectIds.add(p.playerId as string)
        }
      }
      career.faPool = career.data.league.players.filter((id) => {
        if (rostered.has(id as string) || prospectIds.has(id as string)) return false
        const p = career.data.players.get(id)
        return !!p && p.age < 38
      })
    }
    return career
  }
}
