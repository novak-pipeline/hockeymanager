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
import { buildSchedule, buildWeightedSchedule } from '@data/generate'
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
import { overall, ratedOverall, overallToStars, agedPotential } from '@engine/ratings/composites'
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
  expectedPointsFor,
  generateDraftClass,
  processRetirements,
} from '@engine/league/offseason'
import { tickInSeasonDevelopment } from '@engine/league/inSeasonDevelopment'
import {
  combinedDevProduction,
  initWorldSimState,
  resetWorldSim,
  simWorldDay,
  type WorldSimState,
} from '@engine/league/worldSim'
import { worldFreeAgencySweep } from '@engine/league/worldFreeAgency'
import { runWorldJuniors } from '@engine/league/worldJuniors'
import { analystProjection, analystRank, ceilingRoleShort, draftEligibility, perceivedCeiling, positionFactor, productionPremium, reentryPenalty, type DraftRankPhase, type RankInput } from '@engine/league/draftRankings'
import { buildPlayerComp } from '@engine/career/playerComp'
import { buildSeasonBio } from '@engine/career/seasonBio'
import { buildScoutDraftRead, scoutSignalParts } from '@engine/career/scoutDraftRead'
import { buildOppositionReport } from '@engine/career/oppositionReport'
import { buildDraftClassArticle } from '@engine/career/draftClassArticle'
import { projectProspect, hashSigned, type ProspectProjection } from '@engine/career/prospectModel'
import { nhleFactorByAbbrev, isProLeagueAbbrev } from '@engine/league/leagueStrength'
import { scoutDraftBias } from '@engine/career/multiScout'
import { selectNationalTeam, nationInfo } from '@engine/league/nationalTeam'
import {
  createArc,
  createInitialArcsState,
  resolveArc,
  tickArcs,
  type Arc,
  type ArcInputs,
  type ArcsState,
} from '@engine/story/arcs'
import {
  archiveSeason,
  emptyRecords,
  inductHallOfFame,
  recordWatch,
  registerRetirements,
  type RecordsState,
  type SeasonLine,
} from '@engine/story/records'
import {
  buildPreseasonOdds,
  checkExpectations,
  expectedRankOf,
  seasonVerdict,
  type ExpectationsState,
  type TeamDescriptor,
} from '@engine/story/expectations'
import {
  appendSagaLine,
  buildPresserFactSheet,
  buildScheduledReportFactSheet,
  buildTentpoleFactSheet,
  buildWeeklyFactSheet,
  PRESS_PERSONA_NAMES,
  type PressConferenceState,
  type PressFactArgs,
  type PressJob,
  type PressPersonaId,
  type PressSheetKind,
  type PressTone,
  type ScheduledReportArgs,
} from '@engine/story/factSheet'
import { renderFallback } from '@engine/story/pressFallback'
import {
  checkAwardsStage,
  checkDraftStage,
  checkPlayoffEntry,
  checkPreseasonStage,
  checkRegularSeasonReports,
  hydratePressScheduleState,
  initialPressScheduleState,
  type PressScheduleState,
} from '@engine/story/pressSchedule'
import { coachQuote, type CoachSituation, type CoachQuoteFacts } from '@engine/story/coachQuotes'
import {
  chemistryModifier,
  developmentModifier,
  electCaptain,
  initLockerRoom,
  onPlayerArrived,
  onPlayerDeparted,
  tickLockerRoom,
  type LockerRoomState,
} from '@engine/league/lockerRoom'
import {
  applyInteractionResponse,
  maybeRaiseInteraction,
  INTERACTION_COOLDOWN_DAYS,
  type PlayerInteraction,
} from '@engine/league/interactions'
import { lineSynergy, pairSynergy, playerStyleFit } from '@engine/league/archetypes'
import { evaluateCoachSuggestion, type SuggestionDirection } from '@engine/league/coachTactics'
import {
  discussPlayerTopic,
  agendaLabel,
  PLAYER_TOPICS,
  type AgendaItem,
  type AgendaTopic,
  type DiscussionResult,
} from '@engine/league/staffMeeting'
import {
  createInitialTentpolesState,
  runCombine,
  runDeadlineDay,
  runLottery,
  runTournament,
  tickRumors,
  type ExecutedTradeSummary,
  type TentpolesState,
} from '@engine/league/tentpoles'
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
  buildTeamProfile,
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
import { repairLines, coachSetLineup } from '@engine/league/lineup'
import {
  addKnowledge,
  assignScout,
  createInitialScouting,
  knowledgeOf,
  accuracyOf,
  maskedCeiling,
  playersSeenByScout,
  tickScouting,
  generateScoutCandidates,
  syncAssignmentsToScouts,
  scoutSalary,
  SCOUT_SPECIALTY_NATIONS,
  DISCOVERY_THRESHOLD,
  YOUTH_MAX_AGE,
  type ScoutingCompetition,
} from '@engine/league/scouting'
import { answerInterviewQuestion, INTERVIEW_QUESTIONS } from '@engine/career/interview'
import { buildTeamDynamics } from '@engine/career/dynamics'
import {
  generateStaff,
  generateTeamStaff,
  generateDataAnalysts,
  buildAgmReport,
  hireRetiredPlayer,
  type StaffMember,
  type TeamStaff,
} from '@engine/league/staff'
import {
  boardSummary,
  seasonReview,
  setSeasonMandate,
  updateConfidence,
  type BoardState,
} from '@engine/league/board'
import {
  decayIntensity,
  gameIntensity,
  registerGame,
  seedRivalries,
  type RivalriesState,
} from '@engine/league/rivalries'
import {
  accumulateSpecialTeams,
  buildScoreboard,
  emptyLedger,
  finalizeSpecialTeams,
  recordTransaction,
  type SpecialTeamsEntries,
  type TransactionLedger,
} from '@engine/league/leagueStats'
import {
  gameRating,
  goalieGameRating,
  formString,
  seasonAvgRating,
  teamLeaders,
  type TeamLeadersView,
} from '@engine/league/playerRating'
import {
  createInitialPracticeState,
  practiceDevModifier,
  effectiveFocus,
  suggestFocus,
  toggleScratch,
  setPlayerFocus,
  isScratchedFor,
  type TeamPracticeState,
  type PracticeFocus,
} from '@engine/league/practice'
import { deserializeLeagueData, deserializeMap, serializeLeagueData, serializeMap } from './serialize'
import { buildBoxScore } from './boxScore'
import { buildDevelopmentCenter, type DevelopmentCenterView } from './developmentCenter'
import { buildScoutVerdict } from './scoutVerdict'
import { buildRosterProjection, buildCoachReports, type SeasonForm } from './playerProjection'
import { recordOpinions, shiftHeadline, type OpinionSnapshot } from './opinionTracker'
import { buildSquadPlanner, type SquadPlannerView } from './squadPlanner'
import {
  badge,
  buildAhlSquadView,
  buildAhlStandingsView,
  buildCalendarView,
  buildCompareRadar,
  buildDataHubView,
  buildTeamDataHubView,
  buildFinanceView,
  buildPlayerProfile,
  type MindsetBuildCtx,
  buildScoutingView,
  buildScheduleView,
  buildSquadView,
  buildStandingsView,
  buildStatsView,
  buildTacticsView,
  potentialStars,
  standingRowView,
  type AhlViewCtx,
  type CalendarCtx,
  type FogCtx,
  type ViewCtx,
} from './buildViews'
import {
  dayToDateISO,
  type AgmReportView,
  type AgmRankedPlayerView,
  type DataHubView,
  type AhlSquadView,
  type AhlStandingsView,
  type BoardView,
  type BoxScoreView,
  type CalendarView,
  type ClubInfoView,
  type CareerPhase,
  type CareerSnapshot,
  type CompareRadarView,
  type CompetitionsView,
  type CompetitionView,
  type CompetitionStandingRowView,
  type CompetitionScorerRowView,
  type CompetitionNotableView,
  type InternationalView,
  type NationView,
  type DraftRankingsView,
  type DraftRankRowView,
  type ScoutBoardRowView,
  type DashboardView,
  type DraftView,
  type FinanceView,
  type HistoryView,
  type InboxView,
  type PlayerInteractionView,
  type ClubLegend,
  type TeamLegendsView,
  type TeamDynamicsView,
  type MedicalView,
  type MedicalRow,
  type LeagueStatTableView,
  type LeagueSkaterStatRow,
  type LeagueGoalieStatRow,
  type LeagueLeadersView,
  type LeagueStatsView,
  type LeagueTeamsView,
  type LinesUpdate,
  type LockerRoomView,
  type OffseasonView,
  type PickAssetView,
  type PlayerProfileView,
  type PlayoffBracketView,
  type PracticeView,
  type RivalriesView,
  type ScheduleView,
  type ScoreboardView,
  type ScoutingView,
  type SeasonSummary,
  type SeriesView,
  type SquadView,
  type StandingsView,
  type StatsView,
  type TacticsView,
  type TentpoleView,
  type TradeEvaluation,
  type TradeOfferView,
  type TradeProposal,
  type TradeSideView,
  type TradesView,
  type TransactionsView,
  type TeamPlayerStatRow,
  type TeamPlayerStatsView,
  type StaffView,
  type StaffRowView,
} from './views'
import type { ScoutingState, ScoutTarget, ScoutFocus, ScoutRecommendation } from '@domain/scouting'

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
/** Rolling per-game ratings window (last N games stored). */
const RATINGS_WINDOW = 10

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
  /** AHL standings — keyed by AHL team id. */
  private readonly ahlStandings = new Map<TeamId, Standing>()
  /** AHL games-played counters for AHL-tier players. */
  private readonly ahlGp = new Map<PlayerId, number>()
  /** AHL season totals — kept separate from NHL totals so the two never mix
   *  in leaders/standings/profile, but still feed prospect development. */
  private readonly ahlTotals = new Map<PlayerId, GamePlayerStat>()
  /** Wider-world quick-sim state (other leagues' standings + player stats).
   *  Empty for the generated league / mods without competitions. */
  private worldSim: WorldSimState = { standings: new Map(), gp: new Map(), totals: new Map() }
  private readonly goalieWins = new Map<PlayerId, number>()
  private readonly goalieLosses = new Map<PlayerId, number>()
  private readonly ppGoals = new Map<PlayerId, number>()
  private readonly ppAssists = new Map<PlayerId, number>()
  private news: NewsItem[] = []
  private newsCounter = 0
  /** Player→GM concerns (open + recently resolved). Story-first core. */
  private interactions: PlayerInteraction[] = []
  private interactionCounter = 0
  /** Interview questions asked, per playerId. Answers are recomputed deterministically. */
  private interviews = new Map<string, string[]>()
  /** Scheduled interviews awaiting their calendar date. */
  private pendingInterviews: Array<{ playerId: string; dueDay: number; year: number }> = []
  /** The analyst draft board rank per prospect as of the PREVIOUS phase — the
   *  baseline the mid-season / final rankings show movement arrows against. */
  private prevDraftBoard = new Map<string, number>()
  /** The draft-rank phase last observed (to detect phase transitions). */
  private draftPhaseSeen: DraftRankPhase | null = null
  /** The data analyst the GM has hired (unlocks the Data Hub). Null until hired. */
  private dataAnalyst: import('@engine/league/staff').StaffMember | null = null
  /** Per-club legends registry — notable retirees, "where are they now". */
  private legends = new Map<TeamId, ClubLegend[]>()
  /** Staff-meeting agenda — topics the GM marked for discussion. */
  private agenda: AgendaItem[] = []
  private agendaCounter = 0
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
  /** Players already reported on in the inbox (avoids re-reporting). Seeded lazily. */
  private scoutReported = new Set<string>()
  private scoutReportSeeded = false
  /** `${oppId}:${gameDay}` matchups already given an advance-scout report (transient). */
  private oppReported = new Set<string>()
  /** Per-player opinion timeline (rating/stars/knowledge over the season). */
  private opinionHistory = new Map<string, OpinionSnapshot[]>()

  /* ── story layer (Wave 1) ── */
  private arcsState!: ArcsState
  private recordsState!: RecordsState
  private expectationsState!: ExpectationsState
  private readonly lockerRooms = new Map<TeamId, LockerRoomState>()
  private tentpoles!: TentpolesState
  /** Per-player consecutive games-with-a-point / scoreless counters (skaters). */
  private readonly pointStreaks = new Map<string, number>()
  private readonly scorelessStreaks = new Map<string, number>()
  /** Per-team consecutive losses (for locker-room ticks). */
  private readonly losingStreaks = new Map<string, number>()
  /** User team consecutive wins (for coach win-streak quotes). */
  private userWinStreak = 0
  /** Yesterday's league ranks for standings-delta arcs. Transient (rebuilt daily). */
  private readonly prevRanks = new Map<string, number>()
  /* ── press corps (Wave 2) ── */
  /** Rolling factual career summary fed to the press as long-term memory. */
  private sagaSoFar = ''
  /** Pending writing assignment for the renderer-side press pump. */
  private pressJob: PressJob | null = null
  /** Pending press-conference question awaiting the user's answer. */
  private pressConference: PressConferenceState | null = null
  private pressCounter = 0
  /** Season-long schedule of recurring media reports (Task #39). */
  private pressScheduleState: PressScheduleState = initialPressScheduleState()

  private lastDeadlineRecap: ExecutedTradeSummary[] | null = null
  private lastLottery: {
    orderAbbrs: string[]
    movedUp: { teamAbbr: string; from: number; to: number } | null
  } | null = null

  /* ── franchise drama + League hub (Wave 4) ── */
  /** Owner/board expectations for the user's team. */
  private boardState!: BoardState
  /** League-wide rivalry pairs. */
  private rivalriesState!: RivalriesState
  /** Per-team special-teams accumulators (JSON-safe entry array). */
  private specialTeams: SpecialTeamsEntries = []
  /** League-wide transactions ledger. */
  private transactionLedger: TransactionLedger = emptyLedger()

  /* ── new plumbing modules (Wave 3: EHM screens) ── */
  /** Head coach and AGM for the user's team. */
  private staff: { headCoach: StaffMember; assistantGM: StaffMember } | null = null
  /**
   * Rolling per-game ratings. Map key = playerId; value = last N ratings
   * (newest at end, capped at RATINGS_WINDOW).
   */
  private readonly playerRatings = new Map<string, number[]>()
  /** Practice / scratch state for the user's team. */
  private practiceState: TeamPracticeState = createInitialPracticeState()
  /**
   * Retired players eligible for staff hire.
   * Populated by processRetirements — cleared each season rollover.
   */
  private hireableStaff: string[] = []
  /**
   * Per-team full staff complements (NHL-tier teams only).
   * Keyed by TeamId string; built at career construction, persisted in snapshots.
   */
  private readonly teamStaffMap = new Map<string, TeamStaff>()

  constructor(data: LeagueData, seed: number, userTeamId: TeamId, restored = false) {
    this.data = data
    this.seed = seed
    this.userTeamId = userTeamId
    this.refreshMatchDays()
    // Wider-world quick-sim: standings reference the (fresh or restored) Standing
    // objects on each competition; player gp/totals are restored from the
    // snapshot below for loaded careers.
    this.worldSim = initWorldSimState(this.data.league.competitions ?? [])
    this.playerCounter = this.computePlayerCounter()
    if (!restored) {
      for (const teamId of data.league.teams) this.standings.set(teamId, freshStanding(teamId))
      // Initialize AHL standings from the AHL schedule's team ids.
      for (const teamId of data.league.ahlTeams ?? []) this.ahlStandings.set(teamId, freshStanding(teamId))
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
      this.arcsState = createInitialArcsState()
      this.recordsState = emptyRecords()
      this.tentpoles = createInitialTentpolesState()
      this.initLockerRooms()
      this.pushNews(
        'league',
        `${data.league.name} ${this.year}–${this.year + 1} season begins`,
        `You are the new general manager of the ${this.userTeam.name}. Set your lines, watch the cap, and bring home the cup.`
      )
      this.appendSaga(`Y${this.year}: a new GM takes over the ${this.userTeam.name}.`)

      /* ── generate staff for the user team ── */
      this.staff = generateStaff({ rng: new Rng(deriveSeed(seed, 9200)) })

      /* ── generate full staff complement for every NHL team ── */
      // Uses a SEPARATE Rng namespace (9201) so existing player/team/AHL Rng draws
      // are byte-identical. The user team's full staff is seeded at idx=0 within
      // that namespace; the existing this.staff (headCoach + agm) continues to be
      // the user-facing accessor for backward compat.
      this.generateAllTeamStaff()
      // Make every staff scout deployable (replaces the placeholder scout roster).
      this.syncScoutRoster()

      const odds = buildPreseasonOdds({
        teams: this.teamDescriptors(),
        year: this.year,
        rng: this.rngFor(9101),
      })
      this.expectationsState = odds.state
      this.pushSeeds(odds.newsSeeds)

      /* ── Wave 4: board mandate + rivalries ── */
      const boardResult = setSeasonMandate({
        teamStrengthRank: this.userStrengthRank(),
        teamsInLeague: data.league.teams.length,
        rng: this.rngFor(9301),
        year: this.year,
        teamId: this.userTeamId as string,
        teamName: this.userTeam.name,
      })
      this.boardState = boardResult.state
      this.pushSeeds([boardResult.newsSeed])

      this.rivalriesState = seedRivalries({
        teams: [...data.league.teams].map((tid) => {
          const t = data.teams.get(tid)!
          return { teamId: tid as string, divisionId: t.divisionId as string, conferenceId: t.conferenceId as string }
        }),
        rng: this.rngFor(9302),
      })
      this.specialTeams = []
      this.transactionLedger = emptyLedger()
    }
    // AI auto-assignment: ensure every NHL roster is legal and AHL affiliates hold the rest.
    // Only called for fresh careers (not restored saves, where the user controls their roster).
    if (!restored) {
      this.assignRosters()
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

  /**
   * Current AHL standings, sorted by points descending.
   * Returns an empty array when the league has no AHL affiliates.
   */
  getAhlStandings(): Standing[] {
    return sortStandings([...this.ahlStandings.values()])
  }

  /** Context slice for AHL view builders. */
  private ahlViewCtx(): AhlViewCtx {
    const nhlTeam = this.userTeam
    const userAhlTeamId: TeamId | null = nhlTeam.affiliateId
      ? (nhlTeam.affiliateId as TeamId)
      : null
    return {
      teams: this.data.teams,
      players: this.data.players,
      ahlSchedule: this.data.league.ahlSchedule ?? [],
      ahlStandingsSorted: sortStandings([...this.ahlStandings.values()]),
      userAhlTeamId,
    }
  }

  /** League-wide AHL standings view model. */
  getAhlStandingsView(): AhlStandingsView {
    return buildAhlStandingsView(this.ahlViewCtx())
  }

  /** User's AHL affiliate roster view model. */
  getAhlSquadView(): AhlSquadView {
    return buildAhlSquadView(this.ahlViewCtx(), this.ahlGp)
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
  /**
   * The draft class scouts can target — every draft-eligible / re-entry player
   * across the NHL, AHL and feeder/junior leagues (the same pool the analyst
   * board ranks), plus any formal offseason draft classes. This is what makes
   * the "Draft Class" scope cover the real class year-round, not just at the
   * offseason when `league.draftClasses` is populated.
   */
  private allDraftProspectIds(): Set<string> {
    const ids = new Set<string>()
    const consider = (teamIds: readonly TeamId[]): void => {
      for (const tid of teamIds) {
        const t = this.data.teams.get(tid)
        if (!t) continue
        for (const pid of t.roster) {
          const p = this.data.players.get(pid)
          if (!p) continue
          const elig = draftEligibility(p.age, !!p.nhlDrafted)
          if (elig && elig !== 'radar') ids.add(pid as string)
        }
      }
    }
    // Draft prospects are AMATEURS only — players in junior/college/European feeder
    // leagues. A player on an NHL or AHL roster is a signed pro and is NOT in the
    // draft pool (you can't draft someone already under a pro contract). So we scan
    // the wider-world competitions, EXCLUDING the pro tiers (NHL/AHL), plus any
    // generated draft classes — never the NHL roster or the AHL farm.
    for (const c of this.data.league.competitions ?? []) {
      if (isProLeagueAbbrev(c.abbrev)) continue
      consider(c.teamIds as readonly TeamId[])
    }
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
    refs: {
      teamId?: string
      playerId?: string
      press?: { byline: string; kind: string }
      speaker?: string
      speakerFaceId?: string
    } = {}
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
      ...(refs.press !== undefined ? { press: refs.press } : {}),
      ...(refs.speaker !== undefined ? { speaker: refs.speaker } : {}),
      ...(refs.speakerFaceId !== undefined ? { speakerFaceId: refs.speakerFaceId } : {}),
    }
    this.news.unshift(item)
    if (this.news.length > NEWS_LIMIT) this.news.length = NEWS_LIMIT
  }

  /**
   * When a scout's work makes a notable player well-known (knowledge ≥ 80 for
   * the first time), drop a short scout report into the inbox. Capped at 2/day
   * to avoid flooding; only notable players (high ceiling/ability) qualify.
   * On the first call (incl. after load) it seeds from existing intel without
   * reporting, so loading a save never spams reports for already-known players.
   */
  private emitScoutReports(): void {
    const KNOWN = 80
    if (!this.scoutReportSeeded) {
      for (const [pid, k] of this.scouting.knowledge) {
        if (k >= KNOWN) this.scoutReported.add(pid as string)
      }
      this.scoutReportSeeded = true
      return
    }
    const orgIds = this.ownOrgIds()
    const surfaced = new Set((this.scouting.recommendations ?? []).map((r) => r.playerId))
    const fresh: Array<{ id: string; p: Player; pot: number }> = []
    for (const [pid, k] of this.scouting.knowledge) {
      if (k < KNOWN) continue
      const id = pid as string
      if (this.scoutReported.has(id)) continue
      this.scoutReported.add(id) // mark regardless so we never re-scan
      const p = this.data.players.get(pid as PlayerId)
      if (!p) continue
      // Don't report our own org's players (this is acquisition intel), and don't
      // double-report a prospect the Scouting Centre already surfaced as a find.
      if (orgIds.has(id) || surfaced.has(id)) continue
      const pot = overallToStars(this.scoutedCeilingOf(p))
      const ovr = ratedOverall(p)
      if (pot >= 4 || ovr >= 78) fresh.push({ id, p, pot })
    }
    if (fresh.length === 0) return
    fresh.sort((a, b) => b.pot - a.pot)
    for (const f of fresh.slice(0, 2)) {
      const cur = overallToStars(ratedOverall(f.p))
      const v = buildScoutVerdict(f.p, cur, f.pot)
      const pro = v.pros[0] ? ` ${v.pros[0]}.` : ''
      this.pushNews(
        'scouting',
        `Scout report: ${f.p.name}`,
        `Our scouts have filed a full report on ${f.p.name} (${f.p.position}, age ${f.p.age}). ${v.recommendation}${pro} Best deployed as ${v.bestRole}.`,
        { playerId: f.id },
      )
    }
  }

  /**
   * If a scout is advance-scouting the next opponent, file a pre-match opposition
   * report to the inbox when the game is within two days — once per matchup.
   */
  private emitOppositionReport(day: number): void {
    const advanceScout = this.scouting.assignments.find((s) => s.target.kind === 'nextOpponent')
    if (!advanceScout || this.phase !== 'regularSeason') return
    const nextSched = this.data.league.schedule.find(
      (g) => !g.result && (g.homeTeamId === this.userTeamId || g.awayTeamId === this.userTeamId),
    )
    if (!nextSched) return
    const daysUntil = nextSched.day - day
    if (daysUntil < 0 || daysUntil > 2) return
    const oppId = (nextSched.homeTeamId === this.userTeamId ? nextSched.awayTeamId : nextSched.homeTeamId) as string
    const key = `${oppId}:${nextSched.day}`
    if (this.oppReported.has(key)) return
    this.oppReported.add(key)

    const opp = this.data.teams.get(oppId as TeamId)
    if (!opp) return
    const standing = this.standings.get(oppId as TeamId)
    const stx = finalizeSpecialTeams(this.specialTeams).find((t) => t.teamId === oppId)
    const keyPlayers = opp.roster
      .map((pid) => {
        const p = this.data.players.get(pid)
        const t = this.totals.get(pid)
        const goals = t?.goals ?? 0, assists = t?.assists ?? 0
        return p ? { name: p.name, goals, assists, points: goals + assists } : null
      })
      .filter((x): x is { name: string; goals: number; assists: number; points: number } => !!x && x.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 3)

    const { headline, body } = buildOppositionReport({
      opponentName: opp.name,
      opponentAbbr: opp.abbreviation,
      scoutName: advanceScout.name,
      record: {
        wins: standing?.wins ?? 0, losses: standing?.losses ?? 0, otl: standing?.overtimeLosses ?? 0,
        goalsFor: standing?.goalsFor ?? 0, goalsAgainst: standing?.goalsAgainst ?? 0, gamesPlayed: standing?.gamesPlayed ?? 0,
      },
      keyPlayers,
      ppPct: stx?.ppPct ?? 0,
      pkPct: stx?.pkPct ?? 0,
    })
    this.pushNews('scouting', headline, body, { teamId: oppId })
  }

  /**
   * Push a coach-quote news item for the user team's head coach.
   * Deterministic: quote line is picked from the stable-hash of seed+situation.
   */
  private pushCoachQuote(
    situation: CoachSituation,
    facts: CoachQuoteFacts,
    seed: number,
    headline: string
  ): void {
    const coach = this.getTeamStaff(this.userTeamId as string).headCoach
    const quote = coachQuote(coach, situation, facts, seed)
    this.pushNews('result', headline, quote, {
      teamId: this.userTeamId as string,
      speaker: coach.name,
      ...(coach.faceId !== undefined ? { speakerFaceId: coach.faceId } : {}),
    })
  }

  /* ────────────────────────── story layer plumbing ────────────────────────── */

  /** Convert module news seeds into inbox items (the modules never push). */
  private pushSeeds(
    seeds: Array<{
      category: NewsCategory
      headline: string
      body: string
      playerId?: string
      teamId?: string
    }>
  ): void {
    for (const s of seeds) {
      this.pushNews(s.category, s.headline, s.body, {
        ...(s.teamId !== undefined ? { teamId: s.teamId } : {}),
        ...(s.playerId !== undefined ? { playerId: s.playerId } : {}),
      })
    }
  }

  private static pidNum(id: string): number {
    return Number((id.match(/\d+/) ?? ['0'])[0])
  }

  /** Compute the user team's projected strength rank (1 = best) among all teams. */
  private userStrengthRank(): number {
    const descriptors = this.teamDescriptors()
    const sorted = [...descriptors].sort((a, b) => b.strength - a.strength)
    const idx = sorted.findIndex((d) => d.teamId === (this.userTeamId as string))
    return idx >= 0 ? idx + 1 : Math.ceil(descriptors.length / 2)
  }

  /** TeamDescriptors for preseason odds (same strength formula as buildTeamList). */
  private teamDescriptors(lastRanks?: Map<string, number>): TeamDescriptor[] {
    return [...this.data.league.teams].map((teamId) => {
      const team = this.data.teams.get(teamId)!
      const skaters = team.roster
        .map((id) => this.resolve(id))
        .filter((p) => p.position !== 'G')
        .map((p) => overall(p.composites, p.position))
        .sort((a, b) => b - a)
        .slice(0, 15)
      const strength =
        skaters.length > 0
          ? Math.round(skaters.reduce((s, v) => s + v, 0) / skaters.length)
          : 50
      const last = lastRanks?.get(teamId as string)
      return {
        teamId: teamId as string,
        name: team.name,
        abbr: team.abbreviation,
        strength,
        ...(last !== undefined ? { lastYearRank: last } : {}),
      }
    })
  }

  /**
   * Rng seed namespace for per-team staff generation.
   * Must not clash with any other deriveSeed(seed, NAMESPACE, ...) call.
   * Existing namespace 9200 = user-team headCoach/AGM via generateStaff.
   * Existing namespace 9201 = hireRetiredPlayer (uses 3-key: seed,9201,year).
   * We use 9260 which is used nowhere else in the codebase.
   */
  private static readonly TEAM_STAFF_NS = 9260

  /**
   * Generate a full TeamStaff for every NHL-tier team.
   * Called once at career construction; NOT called on restore (loaded from snapshot).
   * The shared name-set is local to this call — staff names won't duplicate within
   * the staff pool itself (but may overlap with player names, which is acceptable).
   */
  private generateAllTeamStaff(): void {
    const existingNames = new Set<string>()
    this.data.league.teams.forEach((teamId, idx) => {
      // Prefer real staff from a mod import when available.
      const modStaff = this.data.staffByTeam?.get(teamId)
      if (modStaff !== undefined) {
        for (const m of [modStaff.headCoach, modStaff.assistantGM, modStaff.owner]) existingNames.add(m.name)
        for (const ac of modStaff.assistantCoaches) existingNames.add(ac.name)
        for (const s of modStaff.scouts) existingNames.add(s.name)
        for (const p of modStaff.physios) existingNames.add(p.name)
        this.teamStaffMap.set(teamId as string, modStaff)
        return
      }
      const teamRng = new Rng(deriveSeed(this.seed, Career.TEAM_STAFF_NS, idx))
      const ts = generateTeamStaff(teamRng, { existingNames })
      existingNames.add(ts.headCoach.name)
      for (const ac of ts.assistantCoaches) existingNames.add(ac.name)
      existingNames.add(ts.assistantGM.name)
      for (const s of ts.scouts) existingNames.add(s.name)
      for (const p of ts.physios) existingNames.add(p.name)
      existingNames.add(ts.owner.name)
      this.teamStaffMap.set(teamId as string, ts)
    })
  }

  /**
   * Return the full staff complement for a given NHL-tier team.
   * If the map has no entry (defensive: should never happen after construction or
   * restore), regenerates deterministically from the career seed so callers never throw.
   */
  getTeamStaff(teamId: string): TeamStaff {
    const existing = this.teamStaffMap.get(teamId)
    if (existing) return existing
    const idx = this.data.league.teams.indexOf(teamId as unknown as typeof this.data.league.teams[number])
    const teamRng = new Rng(deriveSeed(this.seed, Career.TEAM_STAFF_NS, Math.max(0, idx)))
    const ts = generateTeamStaff(teamRng)
    this.teamStaffMap.set(teamId, ts)
    return ts
  }

  private initLockerRooms(): void {
    this.lockerRooms.clear()
    this.data.league.teams.forEach((teamId, idx) => {
      const team = this.data.teams.get(teamId)!
      this.lockerRooms.set(
        teamId,
        initLockerRoom({
          roster: team.roster.map((id) => this.resolve(id)),
          year: this.year,
          rng: this.rngFor(9102, idx),
        })
      )
    })
  }

  /** All-time totals (archived seasons + current season counters). */
  private careerTotalsOf(pid: PlayerId): {
    goals: number
    assists: number
    points: number
    gamesPlayed: number
  } {
    let goals = 0
    let assists = 0
    let gamesPlayed = 0
    const p = this.data.players.get(pid)
    if (p) {
      for (const s of p.stats) {
        goals += s.ev.goals + s.pp.goals + s.pk.goals
        assists += s.ev.assists + s.pp.assists + s.pk.assists
        gamesPlayed += s.gamesPlayed
      }
    }
    const t = this.totals.get(pid)
    if (t) {
      goals += t.goals
      assists += t.assists
    }
    gamesPlayed += this.gp.get(pid) ?? 0
    return { goals, assists, points: goals + assists, gamesPlayed }
  }

  /** Current-season per-player lines for the records module. */
  private buildSeasonLines(): SeasonLine[] {
    const lines: SeasonLine[] = []
    for (const [pid, t] of this.totals) {
      const games = this.gp.get(pid) ?? 0
      if (games <= 0) continue
      const p = this.data.players.get(pid)
      if (!p) continue
      const teamId = this.teamOf(pid)
      lines.push({
        playerId: pid as string,
        name: p.name,
        teamAbbr: teamId ? this.data.teams.get(teamId)!.abbreviation : 'FA',
        position: p.position,
        goals: t.goals,
        assists: t.assists,
        points: t.goals + t.assists,
        gamesPlayed: games,
        goalieWins: this.goalieWins.get(pid) ?? 0,
        savePct: t.shotsAgainst > 0 ? t.saves / t.shotsAgainst : 0,
        shotsAgainst: t.shotsAgainst,
      })
    }
    return lines
  }

  /** Award winners with display values, for the records archive. */
  private awardsForArchive(): Array<{
    award: string
    playerId: string
    name: string
    teamAbbr: string
    value: string
  }> {
    const out: Array<{ award: string; playerId: string; name: string; teamAbbr: string; value: string }> = []
    const abbrOf = (id: PlayerId): string => {
      const t = this.teamOf(id)
      return t ? this.data.teams.get(t)!.abbreviation : 'FA'
    }
    const top = (
      award: string,
      score: (t: GamePlayerStat) => number,
      filter: (p: Player) => boolean,
      fmt: (v: number) => string
    ): void => {
      let bestId: PlayerId | null = null
      let bestVal = -Infinity
      for (const [id, t] of this.totals) {
        const p = this.data.players.get(id)
        if (!p || !filter(p)) continue
        const v = score(t)
        if (v > bestVal) {
          bestVal = v
          bestId = id
        }
      }
      if (bestId && bestVal > -Infinity) {
        const p = this.resolve(bestId)
        out.push({
          award,
          playerId: bestId as string,
          name: p.name,
          teamAbbr: abbrOf(bestId),
          value: fmt(bestVal),
        })
      }
    }
    top('Most Valuable Player', (t) => t.goals + t.assists, (p) => p.position !== 'G', (v) => `${v} PTS`)
    top('Top Goal Scorer', (t) => t.goals, (p) => p.position !== 'G', (v) => `${v} G`)
    top('Best Playmaker', (t) => t.assists, (p) => p.position !== 'G', (v) => `${v} A`)
    top(
      'Best Goaltender',
      (t) => (t.shotsAgainst >= 300 ? t.saves / Math.max(1, t.shotsAgainst) : -1),
      (p) => p.position === 'G',
      (v) => (v < 0 ? '—' : `.${Math.round(v * 1000)}`)
    )
    return out
  }

  /**
   * Sim resolver seam: condition (fatigue/morale/form via effectiveResolve)
   * composes with locker-room chemistry AND line synergy. effectiveResolve
   * already produces per-game cached condition-scaled copies; this wraps it and
   * additionally scales each player's composites by two multiplicative factors:
   *
   *   1. chemistryModifier(lockerRoom, unit) — 0.97–1.03 (locker-room familiarity)
   *   2. lineSynergy(forwardLine).multiplier  — 0.97–1.03 (archetype complementarity)
   *      or pairSynergy(defensePair).multiplier for D pairings.
   *
   * Both factors are applied multiplicatively (combined = chem × synergy) and
   * clamped to [0.97, 1.03] so the combined effect never exceeds ±6% from 1.0
   * (same tolerance band as chemistry alone, keeping calibration within range).
   * Players outside any EV unit (goalies, scratches) keep ×1. The resolver is
   * rebuilt fresh each game — matching effectiveResolve's cache semantics.
   */
  private storyResolve(): (id: PlayerId) => Player {
    const base = effectiveResolve(this.resolve)
    type UnitKind = 'forward' | 'defense'
    const unitOf = new Map<string, { unit: string[]; teamId: TeamId; kind: UnitKind }>()
    for (const team of this.data.teams.values()) {
      if (!this.lockerRooms.has(team.id)) continue
      for (const line of team.lines.forwards) {
        const ids = line.map((x) => x as string)
        for (const id of ids) unitOf.set(id, { unit: ids, teamId: team.id, kind: 'forward' })
      }
      for (const pair of team.lines.defensePairs) {
        const ids = pair.map((x) => x as string)
        for (const id of ids) unitOf.set(id, { unit: ids, teamId: team.id, kind: 'defense' })
      }
    }

    // Pre-compute per-unit synergy multipliers once (deterministic, no Rng).
    // Synergy is applied ONLY for the user's team; it represents the coaching
    // layer (the user's tactical line-building decisions). Applying it to all
    // AI teams would alter AI-vs-AI quick-sim seeds, breaking existing tests.
    // Chemistry is still applied universally as before.
    const synergyCache = new Map<string, number>()
    const synergyFor = (ids: string[], kind: UnitKind, teamId: TeamId): number => {
      if (teamId !== this.userTeamId) return 1
      const key = [...ids].sort().join('|')
      const hit = synergyCache.get(key)
      if (hit !== undefined) return hit
      const players = ids.map((id) => this.data.players.get(id as PlayerId)).filter((p): p is Player => p !== undefined)
      let mult: number
      if (kind === 'forward') {
        mult = lineSynergy(players).multiplier
      } else {
        mult = pairSynergy(players).multiplier
      }
      synergyCache.set(key, mult)
      return mult
    }

    const clamp = (v: number, lo: number, hi: number): number => v < lo ? lo : v > hi ? hi : v

    const cache = new Map<PlayerId, Player>()
    return (id: PlayerId): Player => {
      const hit = cache.get(id)
      if (hit) return hit
      const p = base(id)
      const slot = unitOf.get(id as string)
      const lr = slot ? this.lockerRooms.get(slot.teamId) : undefined
      if (!slot || !lr) {
        cache.set(id, p)
        return p
      }
      const chemMult = chemistryModifier(lr, slot.unit)
      const synMult = synergyFor(slot.unit, slot.kind, slot.teamId)
      // Compose multiplicatively, clamp to [0.97, 1.03] to stay within calibration band.
      const combined = clamp(chemMult * synMult, 0.97, 1.03)
      if (combined === 1) {
        cache.set(id, p)
        return p
      }
      const composites = { ...p.composites } as unknown as Record<string, number>
      for (const key of Object.keys(composites)) {
        composites[key] = Math.max(1, Math.min(99, Math.round(composites[key] * combined)))
      }
      const copy: Player = { ...p, composites: composites as unknown as Player['composites'] }
      cache.set(id, copy)
      return copy
    }
  }

  /** Locker-room bookkeeping when a player leaves a club (any path). */
  private lockerDeparture(teamId: TeamId | null, playerId: PlayerId): void {
    if (!teamId) return
    const lr = this.lockerRooms.get(teamId)
    if (!lr) return
    const rng = this.rngFor(7107, this.currentDay, Career.pidNum(playerId as string))
    const out = onPlayerDeparted(lr, playerId as string, rng)
    if (teamId === this.userTeamId) {
      this.pushSeeds(out.newsSeeds.map((s) => ({ ...s, teamId: teamId as string })))
    }
    if (out.leadershipCrisis) {
      const team = this.data.teams.get(teamId)!
      const seeds = electCaptain(lr, team.roster.map((id) => this.resolve(id)), rng)
      if (teamId === this.userTeamId) {
        this.pushSeeds(seeds.map((s) => ({ ...s, teamId: teamId as string })))
      }
    }
  }

  /** Locker-room bookkeeping when a player joins a club (any path). */
  private lockerArrival(teamId: TeamId | null, playerId: PlayerId): void {
    if (!teamId) return
    const lr = this.lockerRooms.get(teamId)
    if (!lr) return
    const p = this.data.players.get(playerId)
    if (!p) return
    onPlayerArrived(lr, p, this.rngFor(7108, this.currentDay, Career.pidNum(playerId as string)))
  }

  /** Tick one team's locker room after a match day. */
  private tickTeamLockerRoom(teamId: TeamId, day: number, won: boolean | undefined): void {
    const lr = this.lockerRooms.get(teamId)
    if (!lr) return
    const team = this.data.teams.get(teamId)!
    const idx = this.data.league.teams.indexOf(teamId)
    const out = tickLockerRoom({
      state: lr,
      roster: team.roster.map((id) => this.resolve(id)),
      lines: team.lines,
      playedToday: true,
      ...(won !== undefined ? { won } : {}),
      rng: this.rngFor(7105, day, idx),
      day,
      year: this.year,
      losingStreak: this.losingStreaks.get(teamId as string) ?? 0,
    })
    // Only the user's room makes the inbox; every room feeds the arc engine.
    if (teamId === this.userTeamId) {
      this.pushSeeds(out.newsSeeds.map((s) => ({ ...s, teamId: teamId as string })))
    }
    for (const a of out.arcSeeds) {
      createArc(
        this.arcsState,
        a.kind,
        { playerIds: a.playerIds, teamIds: [teamId as string] },
        a.summary,
        day,
        this.year
      )
    }
  }

  /* ────────────────────── player → GM interactions ────────────────────── */

  private static readonly INTERACTION_NS = 7110
  /** Keep at most this many open concerns at once, and this many total stored. */
  private static readonly MAX_OPEN_INTERACTIONS = 3
  private static readonly INTERACTION_HISTORY_LIMIT = 40

  /** Scan the user roster after a match day and maybe raise new concerns. */
  private maybeRaiseInteractions(day: number): void {
    const open = this.interactions.filter((i) => i.status === 'open')
    if (open.length >= Career.MAX_OPEN_INTERACTIONS) return

    const team = this.data.teams.get(this.userTeamId)
    if (!team) return
    const lr = this.lockerRooms.get(this.userTeamId) ?? null

    // Players who already have an open concern or a recent one stay quiet.
    const busy = new Set<string>()
    for (const i of this.interactions) {
      if (i.status === 'open') busy.add(i.playerId)
      else if (day - i.day < INTERACTION_COOLDOWN_DAYS) busy.add(i.playerId)
    }

    let slots = Career.MAX_OPEN_INTERACTIONS - open.length
    for (const pid of team.roster) {
      if (slots <= 0) break
      const pidStr = pid as unknown as string
      if (busy.has(pidStr)) continue
      const p = this.data.players.get(pid)
      if (!p) continue

      // Name of any feuding teammate, for the message text.
      let feudName: string | null = null
      if (lr) {
        const feud = lr.relationships.find(
          (r) => r.kind === 'feud' && (r.a === pidStr || r.b === pidStr)
        )
        if (feud) {
          const otherId = feud.a === pidStr ? feud.b : feud.a
          feudName = this.data.players.get(asPlayerId(otherId))?.name ?? null
        }
      }

      const interaction = maybeRaiseInteraction({
        player: p,
        lockerRoom: lr,
        feudName,
        year: this.year,
        day,
        rng: this.rngFor(Career.INTERACTION_NS, day, Career.pidNum(pidStr)),
        nextId: `pi${this.interactionCounter}`,
      })
      if (!interaction) continue

      interaction.teamId = this.userTeamId as string
      this.interactionCounter++
      this.interactions.unshift(interaction)
      slots--
      // The interaction surfaces as a card at the top of the inbox (see
      // getInbox); no separate news item is pushed so it doesn't crowd the feed.
    }

    // Trim resolved history so the save doesn't grow unbounded.
    if (this.interactions.length > Career.INTERACTION_HISTORY_LIMIT) {
      const keep: PlayerInteraction[] = []
      for (const i of this.interactions) {
        if (i.status === 'open' || keep.length < Career.INTERACTION_HISTORY_LIMIT) keep.push(i)
      }
      this.interactions = keep.slice(0, Career.INTERACTION_HISTORY_LIMIT)
    }
  }

  /** GM responds to an open concern; applies morale/room effects deterministically. */
  respondToInteraction(interactionId: string, optionId: string): { ok: boolean; message?: string } {
    const interaction = this.interactions.find((i) => i.id === interactionId)
    if (!interaction) return { ok: false, message: 'That conversation is no longer available.' }
    if (interaction.status !== 'open') return { ok: false, message: 'You have already responded.' }
    const option = interaction.options.find((o) => o.id === optionId)
    if (!option) return { ok: false, message: 'Unknown response.' }

    const player = this.data.players.get(asPlayerId(interaction.playerId))
    if (!player) return { ok: false, message: 'Player not found.' }

    const result = applyInteractionResponse({ interaction, option, player })

    // Apply morale to the player.
    player.morale = Math.max(0, Math.min(100, player.morale + result.moraleDelta))

    // Ripple to the room mood.
    const lr = this.lockerRooms.get(asTeamId(interaction.teamId))
    if (lr) lr.roomMorale = Math.max(0, Math.min(100, lr.roomMorale + result.roomMoraleDelta))

    interaction.status = 'resolved'
    interaction.chosenOptionId = optionId
    interaction.outcome = result.outcome

    if (result.news) {
      this.pushNews('league', result.news.headline, result.news.body, {
        teamId: interaction.teamId,
        playerId: interaction.playerId,
      })
      // A formal trade demand becomes a story arc.
      createArc(
        this.arcsState,
        'tradeRumor',
        { playerIds: [interaction.playerId], teamIds: [interaction.teamId] },
        `${player.name} has requested a trade`,
        this.currentDay,
        this.year
      )
    }

    return { ok: true }
  }

  /** AI-AI deadline-day flurry, exactly once per season when the deadline is reached. */
  private runDeadlineIfDue(day: number): void {
    if (day < this.deadlineDay) return
    const key = `deadline-run-${this.year}`
    if (this.tentpoles.emittedKeys.includes(key)) return
    this.tentpoles.emittedKeys.push(key)

    const before = new Map<string, string>()
    for (const t of this.data.teams.values()) {
      for (const id of t.roster) before.set(id as string, t.id as string)
    }
    const res = runDeadlineDay({
      teams: this.data.teams,
      players: this.data.players,
      picks: this.picks,
      userTeamId: this.userTeamId as string,
      year: this.year,
      rng: this.rngFor(7106),
    })
    this.lastDeadlineRecap = res.trades
    this.pushSeeds(res.newsSeeds)
    for (const team of this.data.teams.values()) repairLines(team, this.data.players)

    // Queue a deadline tentpole press job.
    const specialLines: string[] = res.trades.slice(0, 4).map(
      (t) => `${t.aGave.join(', ') || 'picks'} to ${t.teamB} for ${t.bGave.join(', ') || 'picks'} (${t.teamA})`
    )
    this.queuePressJob('deadline', specialLines)

    // Diff rosters to drive captaincy/familiarity bookkeeping for AI-AI moves.
    for (const t of this.data.teams.values()) {
      for (const id of t.roster) {
        const prev = before.get(id as string)
        if (prev !== undefined && prev !== (t.id as string)) {
          this.lockerDeparture(asTeamId(prev), id)
          this.lockerArrival(t.id, id)
        }
      }
    }
    // The deadline resolves every open trade-rumor arc.
    for (const arc of this.arcsState.arcs) {
      if (arc.kind === 'tradeRumor' && arc.status !== 'resolved') {
        resolveArc(this.arcsState, arc.id, 'The trade deadline has passed.', day, this.year)
      }
    }
  }

  /** Per-match-day story tick: arcs, expectations, record pace, rooms, rumors. */
  private storyTickDay(day: number, outcomes: GameOutcome[]): void {
    const year = this.year

    /* ── per-team result facts + losing streaks ── */
    const results: ArcInputs['results'] = []
    const wonByTeam = new Map<string, boolean>()
    for (const res of outcomes) {
      const homeWon = res.homeGoals > res.awayGoals
      results.push({
        teamId: res.homeTeamId as string,
        oppId: res.awayTeamId as string,
        won: homeWon,
        goalsFor: res.homeGoals,
        goalsAgainst: res.awayGoals,
      })
      results.push({
        teamId: res.awayTeamId as string,
        oppId: res.homeTeamId as string,
        won: !homeWon,
        goalsFor: res.awayGoals,
        goalsAgainst: res.homeGoals,
      })
      wonByTeam.set(res.homeTeamId as string, homeWon)
      wonByTeam.set(res.awayTeamId as string, !homeWon)
    }
    for (const [teamId, won] of wonByTeam) {
      this.losingStreaks.set(teamId, won ? 0 : (this.losingStreaks.get(teamId) ?? 0) + 1)
    }

    /* ── player lines + point/scoreless streaks (skaters) ── */
    const playerLines: ArcInputs['playerLines'] = []
    for (const res of outcomes) {
      for (const [pid, s] of res.playerStats) {
        if (s.toi <= 0) continue
        const p = this.data.players.get(pid)
        if (!p || p.position === 'G') continue
        const id = pid as string
        const points = s.goals + s.assists
        if (points > 0) {
          this.pointStreaks.set(id, (this.pointStreaks.get(id) ?? 0) + 1)
          this.scorelessStreaks.set(id, 0)
        } else {
          this.pointStreaks.set(id, 0)
          this.scorelessStreaks.set(id, (this.scorelessStreaks.get(id) ?? 0) + 1)
        }
        const teamId = this.teamOf(pid)
        playerLines.push({
          playerId: id,
          teamId: (teamId as string) ?? '',
          goals: s.goals,
          assists: s.assists,
          points,
          isForward: p.position !== 'D',
          isRookie: p.age <= 22 && p.stats.length === 0,
          consecutivePointGames: this.pointStreaks.get(id) ?? 0,
          scorelessStreak: this.scorelessStreaks.get(id) ?? 0,
        })
      }
    }

    /* ── standings delta vs yesterday, with preseason expectation ── */
    const sorted = sortStandings([...this.standings.values()])
    const standingsDelta: ArcInputs['standingsDelta'] = sorted.map((s, i) => {
      const teamId = s.teamId as string
      const rank = i + 1
      const exp = expectedRankOf(this.expectationsState, teamId)
      return {
        teamId,
        rank,
        prevRank: this.prevRanks.get(teamId) ?? rank,
        ...(exp !== undefined ? { expectedRank: exp } : {}),
      }
    })

    const inputs: ArcInputs = {
      day,
      year,
      seasonLength: this.matchDays.length,
      results,
      playerLines,
      standingsDelta,
      seasonTotals: (pid) => {
        const t = this.totals.get(asPlayerId(pid))
        return {
          goals: t?.goals ?? 0,
          assists: t?.assists ?? 0,
          points: (t?.goals ?? 0) + (t?.assists ?? 0),
          gamesPlayed: this.gp.get(asPlayerId(pid)) ?? 0,
        }
      },
      careerTotals: (pid) => this.careerTotalsOf(asPlayerId(pid)),
      expectedPoints: (pid) => {
        const p = this.data.players.get(asPlayerId(pid))
        return p ? expectedPointsFor(overall(p.composites, p.position), p.position, p.role) : undefined
      },
      playerName: (pid) => this.data.players.get(asPlayerId(pid))?.name ?? pid,
      teamName: (tid) => this.data.teams.get(asTeamId(tid))?.name ?? tid,
    }
    this.pushSeeds(tickArcs({ state: this.arcsState, inputs, rng: this.rngFor(7102, day) }).newsSeeds)

    /* ── expectation checkpoints (quarter/half/3-quarter GP crossings) ── */
    this.pushSeeds(
      checkExpectations({
        state: this.expectationsState,
        standings: sorted.map((s, i) => {
          const team = this.data.teams.get(s.teamId)!
          return {
            teamId: s.teamId as string,
            name: team.name,
            abbr: team.abbreviation,
            rank: i + 1,
            gamesPlayed: s.gamesPlayed,
          }
        }),
        day,
        year,
        rng: this.rngFor(7103, day),
      }).newsSeeds
    )

    /* ── Wave 4: board confidence update every ~10 match days ── */
    const boardDayIdx = this.matchDays.indexOf(day)
    if (boardDayIdx >= 0 && boardDayIdx % 10 === 9) {
      const userStanding = this.standings.get(this.userTeamId)
      const currentRank = sorted.findIndex((s) => s.teamId === this.userTeamId) + 1
      const totalGames = this.matchDays.length
      const gamesPlayed = userStanding?.gamesPlayed ?? 0
      const confResult = updateConfidence({
        state: this.boardState,
        currentRank,
        gamesPlayed,
        totalGames,
        teamsInLeague: this.data.league.teams.length,
      })
      this.pushSeeds(confResult.newsSeeds.map((s) => ({ ...s, teamId: this.userTeamId as string })))
    }

    /* ── all-time record pace watch every ~5 match days ── */
    const dayIdx = this.matchDays.indexOf(day)
    if (dayIdx >= 0 && dayIdx % 5 === 4) {
      this.pushSeeds(
        recordWatch({
          state: this.recordsState,
          seasonLines: this.buildSeasonLines(),
          year,
          teamGamesPlayed: this.standings.get(this.userTeamId)?.gamesPlayed ?? 0,
          totalSeasonGames: this.matchDays.length,
        }).newsSeeds
      )
    }

    /* ── locker rooms for every team that played ── */
    for (const teamId of this.data.league.teams) {
      const won = wonByTeam.get(teamId as string)
      if (won === undefined) continue
      this.tickTeamLockerRoom(teamId, day, won)
    }

    /* ── player→GM concerns for the user club (story-first core) ── */
    this.maybeRaiseInteractions(day)

    /* ── trade rumor mill + the deadline-day flurry ── */
    if (day <= this.deadlineDay) {
      const r = tickRumors({
        state: this.tentpoles,
        teams: this.data.teams,
        players: this.data.players,
        userTeamId: this.userTeamId as string,
        deadlineDay: this.deadlineDay,
        day,
        year,
        rng: this.rngFor(7104, day),
      })
      this.pushSeeds(r.newsSeeds)
      for (const seed of r.arcSeeds) {
        createArc(
          this.arcsState,
          seed.kind,
          { playerIds: seed.playerIds, teamIds: seed.teamIds },
          seed.summary,
          day,
          year
        )
      }
    }
    this.runDeadlineIfDue(day)

    /* ── remember today's ranks for tomorrow's delta ── */
    this.prevRanks.clear()
    sorted.forEach((s, i) => this.prevRanks.set(s.teamId as string, i + 1))

    /* ── press corps: weekly column every 7th match day index ── */
    const pressIdx = this.matchDays.indexOf(day)
    // Weekly column fires every 7th match day (regardless of any pending job,
    // since the deterministic fallback is pushed to the inbox immediately and the
    // pressJob field just enables an optional LLM upgrade).
    if (pressIdx >= 0 && (pressIdx + 1) % 7 === 0) {
      this.queuePressJob('weekly', [])
    }

    /* ── scheduled media reports (Task #39) ── */
    if (pressIdx >= 0) {
      const scheduled = checkRegularSeasonReports(pressIdx, this.pressScheduleState)
      for (const kind of scheduled) {
        this.queueScheduledReport(kind as Parameters<typeof this.queueScheduledReport>[0])
      }
    }

    /* ── press conference: after a notable 4+ goal defeat ── */
    for (const res of outcomes) {
      const userIsHome = res.homeTeamId === this.userTeamId
      const userIsAway = res.awayTeamId === this.userTeamId
      if (!userIsHome && !userIsAway) continue
      const us = userIsHome ? res.homeGoals : res.awayGoals
      const them = userIsHome ? res.awayGoals : res.homeGoals
      if (them - us >= 4 && this.pressConference === null) {
        const opp = this.data.teams.get(userIsHome ? res.awayTeamId : res.homeTeamId)
        this.queuePressConference(
          `Your team just lost ${us}-${them}. What went wrong tonight?`,
          `After a heavy ${them - us}-goal defeat against ${opp?.abbreviation ?? 'the opposition'} (day ${day}).`
        )
      }
    }

    /* ── Coach quote: win streak milestones (5, 10, 15) ── */
    const WIN_STREAK_THRESHOLDS = [5, 10, 15]
    if (WIN_STREAK_THRESHOLDS.includes(this.userWinStreak)) {
      const quoteSeed = this.seed ^ (day * 97)
      this.pushCoachQuote(
        'winStreak',
        { streakCount: this.userWinStreak },
        quoteSeed,
        `${this.userWinStreak}-game win streak — Coach speaks`
      )
    }

    /* ── Coach quote: losing streak milestones (3, 5, 7) ── */
    const LOSING_STREAK_THRESHOLDS = [3, 5, 7]
    const userLoss = this.losingStreaks.get(this.userTeamId as string) ?? 0
    if (LOSING_STREAK_THRESHOLDS.includes(userLoss)) {
      const quoteSeed = this.seed ^ (day * 113)
      this.pushCoachQuote(
        'losingStreak',
        { streakCount: userLoss },
        quoteSeed,
        `${userLoss} in a row — Coach addresses the slump`
      )
    }

    /* ── Coach quote: slumping star (user team skater with 5+ scoreless) ── */
    // Fire once per player when they cross the 5-game threshold.
    const SLUMP_THRESHOLD = 5
    for (const line of playerLines) {
      if (line.teamId !== (this.userTeamId as string)) continue
      if (line.scorelessStreak !== SLUMP_THRESHOLD) continue // only on exactly crossing
      const p = this.data.players.get(asPlayerId(line.playerId))
      if (!p || p.position === 'G') continue
      const quoteSeed = this.seed ^ Career.pidNum(line.playerId) ^ (day * 7)
      this.pushCoachQuote(
        'slumpingStar',
        { playerName: p.name, streakCount: line.scorelessStreak },
        quoteSeed,
        `${p.name} slump (${line.scorelessStreak} games) — Coach speaks`
      )
    }
  }

  /** Dashboard ticker line for an arc: actor name + latest beat. */
  private arcHeadline(arc: Arc): string {
    const pid = arc.actors.playerIds[0]
    const tid = arc.actors.teamIds[0]
    const who = pid
      ? this.data.players.get(asPlayerId(pid))?.name
      : tid
        ? this.data.teams.get(asTeamId(tid))?.name
        : undefined
    const beat = arc.beats[arc.beats.length - 1]?.summary ?? ''
    return who ? `${who} — ${beat}` : beat
  }

  /* ────────────────────────── press corps (Wave 2) ────────────────────────── */

  private static readonly PRESS_PERSONA_ROTATION: PressPersonaId[] = ['beat', 'national', 'homer']

  /** Append one factual line to the rolling saga (oldest lines trimmed). */
  private appendSaga(line: string): void {
    this.sagaSoFar = appendSagaLine(this.sagaSoFar, line)
  }

  /** Assemble the verifiable fact bundle for the press from current state. */
  private pressFactArgs(): PressFactArgs {
    const sorted = sortStandings([...this.standings.values()])
    const rank = sorted.findIndex((s) => s.teamId === this.userTeamId) + 1
    const standing = this.standings.get(this.userTeamId)!
    const team = this.userTeam

    const lastResults: PressFactArgs['lastResults'] = []
    for (const g of this.data.league.schedule) {
      if (!g.result) continue
      if (g.homeTeamId !== this.userTeamId && g.awayTeamId !== this.userTeamId) continue
      const home = g.homeTeamId === this.userTeamId
      const opp = this.data.teams.get(home ? g.awayTeamId : g.homeTeamId)!
      lastResults.push({
        day: g.day,
        opponentAbbr: opp.abbreviation,
        home,
        goalsFor: home ? g.result.homeGoals : g.result.awayGoals,
        goalsAgainst: home ? g.result.awayGoals : g.result.homeGoals,
        decidedBy: g.result.decidedBy,
      })
    }

    const topArcs = [...this.arcsState.arcs]
      .filter((a) => a.status !== 'resolved')
      .sort((a, b) => b.tension - a.tension)
      .slice(0, 3)
      .map((a) => ({ kind: a.kind as string, summary: this.arcHeadline(a), tension: a.tension }))

    const lr = this.lockerRooms.get(this.userTeamId)
    const nameOf = (id: string): string => this.data.players.get(asPlayerId(id))?.name ?? id
    const onRoster = new Set(team.roster.map((id) => id as string))
    const feuds: string[] = []
    const mentorships: string[] = []
    if (lr) {
      for (const rel of lr.relationships) {
        if (!onRoster.has(rel.a) || !onRoster.has(rel.b)) continue
        if (rel.kind === 'feud') feuds.push(`${nameOf(rel.a)} vs ${nameOf(rel.b)}`)
        if (rel.kind === 'mentorship') mentorships.push(`${nameOf(rel.a)} mentoring ${nameOf(rel.b)}`)
      }
    }

    const rumors = this.tentpoles.rumors.map((r) => ({
      playerName: nameOf(r.playerId),
      teamAbbr: this.data.teams.get(asTeamId(r.teamId))?.abbreviation ?? r.teamId,
      heat: r.heat,
    }))

    const recordsWatch: string[] = []
    const pts = this.recordsState.singleSeason.points[0]
    if (pts) {
      recordsWatch.push(
        `All-time single-season points record: ${pts.value} by ${pts.playerName} (${pts.year}).`
      )
    }
    const gls = this.recordsState.singleSeason.goals[0]
    if (gls) {
      recordsWatch.push(
        `All-time single-season goals record: ${gls.value} by ${gls.playerName} (${gls.year}).`
      )
    }

    const upcoming: string[] = []
    for (const g of this.data.league.schedule) {
      if (g.result) continue
      if (g.homeTeamId !== this.userTeamId && g.awayTeamId !== this.userTeamId) continue
      const home = g.homeTeamId === this.userTeamId
      const opp = this.data.teams.get(home ? g.awayTeamId : g.homeTeamId)!
      upcoming.push(`${home ? 'vs' : '@'} ${opp.abbreviation} (day ${g.day})`)
      if (upcoming.length >= 3) break
    }

    const leagueLeaders = [...this.totals.entries()]
      .map(([id, t]) => ({ id, points: t.goals + t.assists }))
      .filter(({ id }) => this.data.players.get(id)?.position !== 'G')
      .sort((a, b) => b.points - a.points)
      .slice(0, 3)
      .map(({ id, points }) => {
        const p = this.resolve(id)
        const tid = this.teamOf(id)
        return {
          name: p.name,
          teamAbbr: tid ? this.data.teams.get(tid)!.abbreviation : 'FA',
          stat: 'points',
          value: points,
        }
      })

    const expectedRank = expectedRankOf(this.expectationsState, this.userTeamId as string)
    return {
      year: this.year,
      day: this.currentDay,
      team: {
        name: team.name,
        abbr: team.abbreviation,
        wins: standing.wins,
        losses: standing.losses,
        otLosses: standing.overtimeLosses,
        points: standing.points,
        rank,
        teamsInLeague: this.data.league.teams.length,
        ...(expectedRank !== undefined ? { expectedRank } : {}),
      },
      lastResults,
      topArcs,
      lockerRoom: {
        roomMorale: lr ? Math.round(lr.roomMorale) : 50,
        captainName: lr?.captainId ? nameOf(lr.captainId) : null,
        feuds,
        mentorships,
      },
      rumors,
      recordsWatch,
      upcomingOpponents: upcoming,
      leagueLeaders,
      sagaSoFar: this.sagaSoFar,
    }
  }

  /** Build the extended scheduled-report fact args from current league state. */
  private scheduledReportArgs(kind: PressSheetKind): ScheduledReportArgs {
    const base = this.pressFactArgs()
    const sorted = sortStandings([...this.standings.values()])

    // Power rankings: ordered by points descending.
    const powerRankings = sorted.map((s, i) => {
      const t = this.data.teams.get(s.teamId)!
      return {
        rank: i + 1,
        teamAbbr: t.abbreviation,
        teamName: t.name,
        points: s.points,
        wins: s.wins,
        losses: s.losses,
        otLosses: s.overtimeLosses,
      }
    })

    // Preseason favorites: top-3 expected teams (by predictedRank ascending).
    const preseasonFavorites: string[] = []
    if (this.expectationsState) {
      const sorted3 = [...this.expectationsState.preseason]
        .sort((a, b) => a.predictedRank - b.predictedRank)
        .slice(0, 3)
      for (const entry of sorted3) {
        const t = this.data.teams.get(asTeamId(entry.teamId))
        if (t) preseasonFavorites.push(t.name)
      }
    }

    // Monthly highlights: top arcs + league leaders summary.
    const monthlyHighlights: string[] = [
      ...base.topArcs.slice(0, 2).map((a) => a.summary),
      ...base.leagueLeaders.slice(0, 2).map(
        (l) => `${l.name} (${l.teamAbbr}) leads with ${l.value} ${l.stat}.`
      ),
    ]

    // Playoff matchups.
    const playoffMatchups = this.playoffs
      ? (this.playoffs.rounds[0]?.series ?? []).map((s) => {
          const high = this.data.teams.get(s.highSeedTeamId)
          const low = this.data.teams.get(s.lowSeedTeamId)
          return {
            highSeed: high?.abbreviation ?? '?',
            lowSeed: low?.abbreviation ?? '?',
            highSeedWins: s.highSeedWins,
            lowSeedWins: s.lowSeedWins,
            round: 1,
          }
        })
      : []

    // Award front-runners from league leaders.
    const awardFrontrunners = base.leagueLeaders.map((l) => ({
      awardName: l.stat === 'points' ? 'Hart Trophy' : l.stat === 'goals' ? 'Rocket Richard' : l.stat === 'assists' ? 'Assists leader' : 'Leading scorer',
      leaderName: l.name,
      leaderTeamAbbr: l.teamAbbr,
      statLine: `${l.value} ${l.stat}`,
    }))

    // Season champion from playoffs.
    const seasonChampion = this.playoffs?.championTeamId
      ? (this.data.teams.get(this.playoffs.championTeamId)?.name ?? '')
      : ''

    // Top prospects from draft class.
    const draftYear = this.year + 1
    const draftClass = this.data.league.draftClasses.find((c) => c.year === draftYear)
    const topProspects = draftClass
      ? draftClass.prospects
          .slice(0, 10)
          .map((pr) => this.data.players.get(pr.playerId)?.name ?? '')
          .filter(Boolean)
      : []

    // Month label from current match day.
    const monthNames = ['October', 'November', 'December', 'January', 'February', 'March', 'April']
    const monthIdx = Math.floor(this.currentDay / 14) % monthNames.length
    const monthLabel = monthNames[monthIdx] ?? ''

    // Playoff round label.
    let playoffRound = 'Playoffs'
    if (this.playoffs) {
      const completedRounds = this.playoffs.rounds.filter((r) =>
        r.series.every((s) => s.winnerTeamId !== null)
      ).length
      const roundLabels = ['First Round', 'Second Round', 'Conference Finals', 'Stanley Cup Finals']
      playoffRound = roundLabels[completedRounds] ?? 'Playoffs'
    }

    return {
      ...base,
      powerRankings,
      preseasonFavorites,
      monthlyHighlights,
      playoffMatchups,
      awardFrontrunners,
      seasonChampion,
      topProspects,
      monthLabel,
      playoffRound,
    }
  }

  /** Queue a scheduled recurring report to the inbox. */
  private queueScheduledReport(
    kind: Extract<PressSheetKind, 'powerRankings' | 'seasonPreview' | 'monthlyReport' | 'playoffPreview' | 'awardsNight' | 'draftPreview' | 'seasonReview'>
  ): void {
    const personaId =
      Career.PRESS_PERSONA_ROTATION[this.pressCounter % Career.PRESS_PERSONA_ROTATION.length]
    const args = this.scheduledReportArgs(kind)
    const factSheet = buildScheduledReportFactSheet(kind, args)
    const job: PressJob = { id: `pj${this.pressCounter++}`, kind, personaId, factSheet }

    const article = renderFallback(job)
    const persona = PRESS_PERSONA_NAMES[personaId]
    const byline = `${persona.name} — ${persona.outlet}`
    this.pushNews('league', article.headline, article.body, {
      teamId: this.userTeamId as string,
      press: { byline, kind },
    })
    this.appendSaga(`Y${this.year} D${this.currentDay}: press — "${article.headline}".`)
    this.pressJob = job
  }

  /** Queue a press job AND immediately push a deterministic fallback article to the inbox.
   *
   * The fallback is always generated and pushed — no API key required — so the
   * inbox is always populated with real editorial content. The pressJob field is
   * additionally set so the renderer-side press pump can optionally rewrite the
   * article with an LLM when a key is present (the LLM article appears as a
   * second, richer version after the wire report).
   */
  private queuePressJob(kind: PressSheetKind, special: string[]): void {
    const personaId =
      Career.PRESS_PERSONA_ROTATION[this.pressCounter % Career.PRESS_PERSONA_ROTATION.length]
    const args = this.pressFactArgs()
    const factSheet =
      kind === 'weekly'
        ? buildWeeklyFactSheet(args)
        : kind === 'presser'
          ? buildPresserFactSheet(args, special)
          : buildTentpoleFactSheet(kind, args, special)
    const job: PressJob = { id: `pj${this.pressCounter++}`, kind, personaId, factSheet }

    // Always render + push the deterministic wire report immediately.
    const article = renderFallback(job)
    const persona = PRESS_PERSONA_NAMES[personaId]
    const byline = `${persona.name} — ${persona.outlet}`
    this.pushNews('league', article.headline, article.body, {
      teamId: this.userTeamId as string,
      press: { byline, kind },
    })
    this.appendSaga(`Y${this.year} D${this.currentDay}: press — "${article.headline}".`)

    // Keep the job pending for an optional LLM upgrade from the renderer pump.
    this.pressJob = job
  }

  /** Queue (replace) a pending press-conference question for the user. */
  private queuePressConference(question: string, context: string): void {
    this.pressConference = {
      id: `pc${this.pressCounter++}`,
      question,
      context,
      day: this.currentDay,
      year: this.year,
    }
  }

  /** The pending writing assignment, if any (renderer press pump polls this). */
  getPressJob(): PressJob | null {
    return this.pressJob ? structuredClone(this.pressJob) : null
  }

  /** Renderer hands back the finished article (LLM or fallback) for the inbox. */
  submitPressArticle(input: {
    jobId: string
    headline: string
    body: string
    byline: string
    model: string
  }): void {
    const job = this.pressJob
    if (!job || job.id !== input.jobId) throw new Error('press job no longer pending')
    this.pressJob = null
    this.pushNews('league', input.headline, input.body, {
      teamId: this.userTeamId as string,
      press: { byline: input.byline, kind: job.kind },
    })
    this.appendSaga(`Y${this.year} D${this.currentDay}: press — "${input.headline}".`)
  }

  /** Discard the pending job without an article (feature toggled off). */
  skipPressJob(jobId: string): void {
    if (this.pressJob && this.pressJob.id === jobId) this.pressJob = null
  }

  /** The pending press-conference question, if any. */
  getPressConference(): PressConferenceState | null {
    return this.pressConference ? { ...this.pressConference } : null
  }

  /**
   * Apply the user's press-conference answer. The tone is either LLM-graded
   * (typed answers) or picked from buttons (no key). Effects are deterministic:
   * a fiery rant rallies the room (+2 morale) but risks sparking a feud;
   * public praise nudges the room up one.
   */
  answerPressConference(answer: string, tone: PressTone): void {
    const pc = this.pressConference
    if (!pc) throw new Error('no press conference pending')
    this.pressConference = null
    const lr = this.lockerRooms.get(this.userTeamId)
    if (lr) {
      if (tone === 'fiery') lr.roomMorale = Math.min(100, lr.roomMorale + 2)
      if (tone === 'praise') lr.roomMorale = Math.min(100, lr.roomMorale + 1)
    }
    if (tone === 'fiery') {
      const rng = this.rngFor(7301, this.currentDay, this.pressCounter)
      if (rng.next() < 0.3) {
        const skaters = this.userTeam.roster
          .map((id) => this.resolve(id))
          .filter((p) => p.position !== 'G')
        if (skaters.length >= 2) {
          const a = skaters[Math.floor(rng.next() * skaters.length)]
          let b = skaters[Math.floor(rng.next() * skaters.length)]
          if (b.id === a.id) b = skaters[(skaters.indexOf(a) + 1) % skaters.length]
          createArc(
            this.arcsState,
            'feud',
            { playerIds: [a.id as string, b.id as string], teamIds: [this.userTeamId as string] },
            `Tempers simmer between ${a.name} and ${b.name} after the manager's fiery press conference.`,
            this.currentDay,
            this.year
          )
        }
      }
    }
    const quote = answer.trim().length > 0 ? answer.trim().slice(0, 240) : 'No comment.'
    const toneLabel: Record<PressTone, string> = {
      measured: 'a measured',
      fiery: 'a fiery',
      deflecting: 'an evasive',
      praise: 'a complimentary',
    }
    this.pushNews(
      'league',
      `GM faces the press`,
      `Asked: "${pc.question}"\n\nIn ${toneLabel[tone]} exchange, the ${this.userTeam.name} GM said: "${quote}"`,
      {
        teamId: this.userTeamId as string,
        press: { byline: 'Press room pool report', kind: 'presser' },
      }
    )
    this.appendSaga(`Y${this.year} D${this.currentDay}: GM presser (${tone}): "${quote.slice(0, 80)}".`)
  }

  /* ────────────────────────── outcome bookkeeping ────────────────────────── */

  /**
   * Accumulate hits/blockedShots/takeaways/giveaways from the event stream
   * into the per-player stat totals (both the current game's playerStats map
   * and the career totals). Also computes and stores per-game ratings.
   */
  private creditPhysicalStats(res: GameOutcome): void {
    // Accumulate physical events into a per-player delta for THIS game
    const gameCounts = new Map<string, { hits: number; blocks: number; takes: number; gives: number }>()
    const ensureEntry = (pid: string) => {
      if (!gameCounts.has(pid)) {
        gameCounts.set(pid, { hits: 0, blocks: 0, takes: 0, gives: 0 })
      }
      return gameCounts.get(pid)!
    }

    for (const ev of res.stream) {
      if (ev.type === 'hit') {
        ensureEntry(ev.by as string).hits++
      } else if (ev.type === 'blockedShot') {
        ensureEntry(ev.blocker as string).blocks++
      } else if (ev.type === 'takeaway') {
        ensureEntry(ev.by as string).takes++
      } else if (ev.type === 'giveaway') {
        ensureEntry(ev.player as string).gives++
      }
    }

    // Apply deltas to the outcome's playerStats (for career merging) and to totals
    for (const [pid, counts] of gameCounts) {
      const pId = asPlayerId(pid)
      const gameStat = res.playerStats.get(pId)
      if (gameStat) {
        gameStat.hits += counts.hits
        gameStat.blockedShots += counts.blocks
        gameStat.takeaways += counts.takes
        gameStat.giveaways += counts.gives
      }
      // Also directly accumulate into career totals
      const t = this.totals.get(pId)
      if (t) {
        t.hits += counts.hits
        t.blockedShots += counts.blocks
        t.takeaways += counts.takes
        t.giveaways += counts.gives
      }
    }

    // Compute per-game ratings for participants and store in rolling window
    for (const [pid, s] of res.playerStats) {
      if (s.toi <= 0) continue
      const p = this.data.players.get(pid)
      if (!p) continue
      const pid_str = pid as string

      let rating: number
      if (p.position === 'G') {
        rating = goalieGameRating({
          saves: s.saves,
          shotsAgainst: s.shotsAgainst,
          goalsAgainst: s.goalsAgainst,
          toi: s.toi,
        })
      } else {
        rating = gameRating({
          position: p.position,
          goals: s.goals,
          assists: s.assists,
          shots: s.shots,
          hits: s.hits,
          blockedShots: s.blockedShots,
          takeaways: s.takeaways,
          giveaways: s.giveaways,
          plusMinus: 0, // plus/minus is a placeholder per CLAUDE.md
          toi: s.toi,
        })
      }

      const existing = this.playerRatings.get(pid_str) ?? []
      existing.push(rating)
      if (existing.length > RATINGS_WINDOW) existing.shift()
      this.playerRatings.set(pid_str, existing)
    }
  }

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
    // Accumulate physical events into stats and compute per-game ratings
    // before merging into totals (so totals pick up the physical counts too).
    this.creditPhysicalStats(res)
    applyStandingsResult(this.standings, res)
    mergePlayerStats(this.totals, res.playerStats)
    for (const [pid, s] of res.playerStats) {
      if (s.toi > 0) this.gp.set(pid, (this.gp.get(pid) ?? 0) + 1)
    }
    this.creditExtraStats(res)
    if (game.homeTeamId === this.userTeamId || game.awayTeamId === this.userTeamId) {
      this.recordUserResultNews(game.day, res)
    }

    /* ── Wave 4: special teams accumulation ── */
    this.specialTeams = accumulateSpecialTeams({
      existing: this.specialTeams,
      outcome: res,
      homeTeamId: res.homeTeamId as string,
      awayTeamId: res.awayTeamId as string,
    })

    /* ── Wave 4: rivalry registration (league-wide) ── */
    const homePim = [...res.playerStats.entries()]
      .filter(([id]) => this.data.teams.get(res.homeTeamId)?.roster.includes(id))
      .reduce((s, [, st]) => s + st.penaltyMinutes, 0)
    const awayPim = [...res.playerStats.entries()]
      .filter(([id]) => this.data.teams.get(res.awayTeamId)?.roster.includes(id))
      .reduce((s, [, st]) => s + st.penaltyMinutes, 0)
    const rivalResult = registerGame({
      state: this.rivalriesState,
      teamA: res.homeTeamId as string,
      teamB: res.awayTeamId as string,
      goalsA: res.homeGoals,
      goalsB: res.awayGoals,
      penaltyMinutesA: homePim,
      penaltyMinutesB: awayPim,
      wasPlayoff: false,
      year: this.year,
      rng: this.rngFor(7200, game.day, game.id.length),
    })
    if (rivalResult.newsSeeds.length > 0) this.pushSeeds(rivalResult.newsSeeds)

    /* ── Wave 4: user-game rivalry morale swing ── */
    if (game.homeTeamId === this.userTeamId || game.awayTeamId === this.userTeamId) {
      const oppId = game.homeTeamId === this.userTeamId ? game.awayTeamId : game.homeTeamId
      const gi = gameIntensity(this.rivalriesState, this.userTeamId as string, oppId as string)
      if (gi.factor > 0) {
        const lr = this.lockerRooms.get(this.userTeamId)
        if (lr) {
          const userIsHome = game.homeTeamId === this.userTeamId
          const userWon = userIsHome ? res.homeGoals > res.awayGoals : res.awayGoals > res.homeGoals
          const moraleSwing = Math.round(gi.factor * 3) * (userWon ? 1 : -1)
          lr.roomMorale = Math.max(0, Math.min(100, lr.roomMorale + moraleSwing))
        }
      }
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

    /* ── Coach quote: big win (≥3 goal margin, regulation) or bad loss (≥3 goal margin) ── */
    const diff = us - them
    const quoteSeed = this.seed ^ (day * 31)
    if (diff >= 3 && res.decidedBy === 'regulation') {
      // Big win — coach speaks
      this.userWinStreak++
      this.pushCoachQuote(
        'postBigWin',
        { opponentAbbr: opp.abbreviation, score: `${us}-${them}`, goalDiff: diff },
        quoteSeed,
        `${opp.abbreviation}: "${this.coachQuoteHeadline('postBigWin', diff)}"`
      )
    } else if (diff <= -3 && res.decidedBy === 'regulation') {
      // Bad loss — coach speaks
      this.userWinStreak = 0
      this.pushCoachQuote(
        'postBadLoss',
        { opponentAbbr: opp.abbreviation, score: `${them}-${us}`, goalDiff: Math.abs(diff) },
        quoteSeed,
        `${opp.abbreviation}: "${this.coachQuoteHeadline('postBadLoss', Math.abs(diff))}"`
      )
    } else if (diff > 0) {
      this.userWinStreak++
    } else {
      this.userWinStreak = 0
    }
  }

  /** One-line headline for a coach quote item. */
  private coachQuoteHeadline(situation: CoachSituation, diff: number): string {
    const coach = this.getTeamStaff(this.userTeamId as string).headCoach
    const demeanor = coach.demeanor ?? 'calm'
    if (situation === 'postBigWin') {
      if (demeanor === 'fiery') return `We were ruthless — Coach after ${diff}-goal win`
      if (demeanor === 'analytical') return `Underlying numbers looked excellent — Coach postgame`
      if (demeanor === 'motivator') return `Proud of the group — Coach postgame`
      if (demeanor === 'pragmatic') return `Two points is all that matters — Coach postgame`
      return `A pleasing performance — Coach postgame`
    }
    if (situation === 'postBadLoss') {
      if (demeanor === 'fiery') return `Not acceptable — Coach after ${diff}-goal loss`
      if (demeanor === 'analytical') return `Structural issues to address — Coach postgame`
      if (demeanor === 'motivator') return `We'll respond — Coach postgame`
      if (demeanor === 'pragmatic') return `We assess and move on — Coach postgame`
      return `We'll fix it — Coach postgame`
    }
    if (situation === 'winStreak') return `Streak at ${diff} — Coach speaks`
    if (situation === 'losingStreak') return `Coach addresses losing streak`
    return `Coach speaks`
  }

  /* ────────────────────────── regular-season day loop ────────────────────────── */

  private gameSeedFor(game: ScheduledGame): number {
    return gameSeed(this.seed, this.year, game.id)
  }

  private prepareTeamsForDay(): void {
    for (const team of this.data.teams.values()) repairLines(team, this.data.players)
  }

  private finishDay(day: number, played: Set<PlayerId>, outcomes: GameOutcome[]): void {
    const dayRng = this.rngFor(7001, day)
    tickRecovery({ players: this.data.players.values(), playedToday: played, rng: dayRng })
    this.syncScoutRoster()
    tickScouting({
      state: this.scouting,
      userTeamId: this.userTeamId as string,
      teams: this.data.teams as Map<TeamId, { roster: PlayerId[]; divisionId?: string }>,
      players: this.data.players,
      draftProspectIds: this.allDraftProspectIds(),
      freeAgentIds: this.currentFaIds(),
      competitions: this.scoutingCompetitions(),
      nextOpponentId: this.nextOpponentTeamId(),
      protectedIds: this.ownOrgIds(),
      rng: this.rngFor(7008, day),
    })
    // Games reveal players: anyone who suits up becomes better known, so the
    // league's read sharpens as the season is played. Own-org players clear all
    // the way (you know your guys); the rest of the league climbs to "well known"
    // but stops just short of full clarity — getting an exact read still takes a
    // scout assignment (which is also what keeps the inbox from filling with a
    // scout report for every league player who crosses the reporting threshold).
    // Draft prospects don't play in the league, so they stay foggy — that's where
    // scouting truly lives.
    const orgIds = this.ownOrgIds()
    const PASSIVE_CAP = 79 // just below the scout-report threshold (80)
    for (const pid of played) {
      const id = pid as string
      const own = orgIds.has(id)
      const cap = own ? 100 : PASSIVE_CAP
      const cur = knowledgeOf(this.scouting, id)
      if (cur < cap) addKnowledge(this.scouting, id, Math.min(own ? 6 : 1, cap - cur))
    }
    this.surfaceScoutFinds(day)
    this.emitOppositionReport(day)
    this.emitScoutReports()
    this.resolveDueInterviews(day)
    // Snapshot the analyst draft board at each phase boundary so the mid-season
    // and final rankings can show movement arrows vs the previous phase.
    const dph = this.draftRankPhase()
    if (this.draftPhaseSeen === null) {
      this.draftPhaseSeen = dph
      if (dph === 'preliminary') this.publishDraftClassArticle()
    } else if (dph !== this.draftPhaseSeen) {
      this.prevDraftBoard = this.analystRankMap(this.draftPhaseSeen)
      this.draftPhaseSeen = dph
      // A fresh class each season → a new breakdown when the preliminary board opens.
      if (dph === 'preliminary') this.publishDraftClassArticle()
    }
    // In-season development: a continuous bi-weekly micro-pass so current ability
    // and ceilings (and the profile's live trend arrows) drift through the season
    // rather than only jumping at the offseason. Bounded by a per-season budget;
    // the offseason pass scales its growth down to keep annual totals calibrated.
    if (this.phase === 'regularSeason' && day > 0 && day % 14 === 0) {
      const developIds = new Set<PlayerId>()
      for (const t of this.data.teams.values()) for (const id of t.roster) developIds.add(id)
      const inSeasonWorldStrength = this.worldStrengthByPlayer()
      tickInSeasonDevelopment({
        players: this.data.players,
        developIds,
        gamesPlayedById: (id) => this.combinedDevGames(id),
        rng: this.rngFor(7009, day),
        performance: (id) => this.combinedDevPerformance(id, inSeasonWorldStrength),
        expectations: (id) => {
          const p = this.data.players.get(id)!
          return expectedPointsFor(overall(p.composites, p.position), p.position, p.role)
        },
        devModifier: (id) => {
          const tid = this.teamOf(id)
          const lr = tid ? this.lockerRooms.get(tid) : undefined
          return lr ? developmentModifier(lr, id as string) : 1
        },
      })
    }
    // Snapshot opinions on a roughly bi-weekly cadence so the timeline stays compact.
    if (day % 15 === 0) {
      const shifts = recordOpinions({
        history: this.opinionHistory,
        players: this.data.players,
        scouting: this.scouting,
        ownOrgIds: this.ownOrgIds(),
        day,
        year: this.year,
      })
      // Surface a few meaningful shifts to the inbox (own players first; only
      // well-scouted league players qualify, and cap to avoid flooding).
      const ordered = shifts
        .filter((s) => s.ownOrg || knowledgeOf(this.scouting, s.playerId) >= 60)
        .sort((a, b) => Number(b.ownOrg) - Number(a.ownOrg))
        .slice(0, 3)
      for (const s of ordered) {
        const p = this.data.players.get(asPlayerId(s.playerId))
        if (!p) continue
        const { headline, body } = shiftHeadline(p.name, s)
        this.pushNews('scouting', headline, body, { playerId: s.playerId })
      }
    }
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
    if (this.phase === 'regularSeason') this.storyTickDay(day, outcomes)
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
    const outcomes: GameOutcome[] = []
    for (const game of this.data.league.schedule) {
      if (game.day !== nextDay) continue
      const home = this.data.teams.get(game.homeTeamId)!
      const away = this.data.teams.get(game.awayTeamId)!
      const res = quickSimGame(home, away, this.storyResolve(), {
        seed: this.gameSeedFor(game),
      })
      this.applyOutcome(game, res)
      outcomes.push(res)
      for (const pid of this.postGame(res, this.rngFor(7003, nextDay, game.id.length))) {
        played.add(pid)
      }
      if (game.homeTeamId === this.userTeamId || game.awayTeamId === this.userTeamId) {
        this.lastBoxScore = buildBoxScore(res, home, away, this.resolve)
      }
    }
    // ── AHL day: sim any AHL games scheduled on the same match day ──────
    // Uses a distinct seed namespace (AHL_SEED_OFFSET added to the season seed)
    // so NHL game seeds are byte-identical to before. Only applies standings +
    // player gp/totals; no morale/injury/story side-effects for AHL games.
    if (this.data.league.ahlSchedule && this.data.league.ahlSchedule.length > 0) {
      for (const game of this.data.league.ahlSchedule) {
        if (game.day !== nextDay) continue
        const home = this.data.teams.get(game.homeTeamId)
        const away = this.data.teams.get(game.awayTeamId)
        if (!home || !away) continue
        const ahlRes = quickSimGame(home, away, this.resolve, {
          seed: gameSeed(this.seed ^ 0xabcd1234, this.year, game.id),
        })
        game.result = {
          homeGoals: ahlRes.homeGoals,
          awayGoals: ahlRes.awayGoals,
          decidedBy: ahlRes.decidedBy,
        }
        applyStandingsResult(this.ahlStandings, ahlRes)
        mergePlayerStats(this.ahlTotals, ahlRes.playerStats)
        for (const [pid, s] of ahlRes.playerStats) {
          if (s.toi > 0) {
            // AHL gp tracked separately; this.gp is NHL-only
            this.ahlGp.set(pid, (this.ahlGp.get(pid) ?? 0) + 1)
          }
        }
        // AHL players (incl. prospects on the farm) can be injured too.
        rollInjuries({
          participants: [...ahlRes.playerStats]
            .filter(([, s]) => s.toi > 0)
            .map(([pid, s]) => ({ player: this.resolve(pid), toi: s.toi })),
          rng: this.rngFor(7402, this.year, game.id.length),
        })
      }
    }
    // ── wider world: sim other leagues' games on this match day ──────────
    this.tickWorld(nextDay)
    // ────────────────────────────────────────────────────────────────────
    this.finishDay(nextDay, played, outcomes)
    return true
  }

  /** Global free-agent market: after NHL free agency, the wider world signs the
   *  leftovers — aging vets land in Europe, fringe players drop to other leagues.
   *  No-op without competitions. Mutates rosters/contracts and pushes a few
   *  notable signings to the inbox. */
  private runWorldFreeAgency(): void {
    const comps = this.data.league.competitions
    if (!comps || comps.length === 0) return
    const res = worldFreeAgencySweep({
      competitions: comps,
      teams: this.data.teams,
      players: this.data.players,
      faPool: this.faPool,
      year: this.year,
      rng: this.rngFor(8006),
    })
    this.faPool = res.remaining
    const notable = res.signings.filter((s) => s.notable).slice(0, 6)
    for (const s of notable) {
      const p = this.data.players.get(s.playerId)
      if (!p) continue
      this.pushNews(
        'contract',
        `${p.name} heads overseas to the ${s.competitionName}`,
        `${p.name} (${p.age}) — unsigned in the NHL — has joined ${this.data.teams.get(s.teamId)?.name ?? 'a club'} in the ${s.competitionName} on a ${s.years}-year deal.`,
        { playerId: s.playerId as string, teamId: s.teamId as string }
      )
    }
  }

  /** Quick-sim the wider world's (other leagues') games scheduled on `day`.
   *  No-op when the league has no competitions (generated league / plain mods). */
  private tickWorld(day: number): void {
    const comps = this.data.league.competitions
    if (!comps || comps.length === 0) return
    simWorldDay({
      competitions: comps,
      day,
      teams: this.data.teams,
      resolve: this.resolve,
      state: this.worldSim,
      seedBase: this.seed ^ 0x5eed0001,
      year: this.year,
      rng: this.rngFor(7401, day), // prospects in other leagues can be injured too
    })
  }

  /** playerId → NHLe strength of the simulated competition he plays in (for
   *  translating his production to an NHL-equivalent rate in development). Built
   *  per dev pass; empty when the league has no competitions. */
  private worldStrengthByPlayer(): Map<string, number> {
    const m = new Map<string, number>()
    for (const comp of this.data.league.competitions ?? []) {
      if (comp.tier !== 'simulated') continue
      for (const tid of comp.teamIds) {
        const team = this.data.teams.get(tid)
        if (!team) continue
        for (const pid of team.roster) m.set(pid as string, comp.strength)
      }
    }
    return m
  }

  /**
   * A player's season production for development, combining every tier he played
   * — NHL, AHL, and the wider world — with wider-world points translated to an
   * NHL-equivalent rate by that league's strength, so dominating a strong league
   * means more than padding stats in a weak one. NHL/AHL keep their existing
   * weighting (1:1) to preserve calibration; only the new world tiers are scaled.
   */
  private combinedDevPerformance(
    id: PlayerId,
    worldStrength: Map<string, number>
  ): { points: number; gamesPlayed: number; position: Position; savePct?: number } {
    const p = this.data.players.get(id)!
    const args: Parameters<typeof combinedDevProduction>[0] = {
      nhlGp: this.gp.get(id) ?? 0,
      ahlGp: this.ahlGp.get(id) ?? 0,
      worldGp: this.worldSim.gp.get(id) ?? 0,
      worldStrength: worldStrength.get(id as string) ?? 1,
      position: p.position,
    }
    const t = this.totals.get(id)
    const at = this.ahlTotals.get(id)
    const wt = this.worldSim.totals.get(id)
    if (t) args.nhl = t
    if (at) args.ahl = at
    if (wt) args.world = wt
    return combinedDevProduction(args)
  }

  /** Combined games played across NHL + AHL + wider world (ice-time for dev). */
  private combinedDevGames(id: PlayerId): number {
    return (this.gp.get(id) ?? 0) + (this.ahlGp.get(id) ?? 0) + (this.worldSim.gp.get(id) ?? 0)
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
    const outcomes: GameOutcome[] = []
    for (const game of this.data.league.schedule) {
      if (game.day !== nextDay) continue
      const home = this.data.teams.get(game.homeTeamId)!
      const away = this.data.teams.get(game.awayTeamId)!
      const isUser = game.homeTeamId === this.userTeamId || game.awayTeamId === this.userTeamId
      const sim = isUser ? fullSimGame : quickSimGame
      const res = sim(home, away, this.storyResolve(), {
        seed: this.gameSeedFor(game),
      })
      this.applyOutcome(game, res)
      outcomes.push(res)
      for (const pid of this.postGame(res, this.rngFor(7003, nextDay, game.id.length))) {
        played.add(pid)
      }
      if (isUser) {
        watched = this.buildWatched(game.homeTeamId, game.awayTeamId, res.stream)
        this.lastBoxScore = buildBoxScore(res, home, away, this.resolve)
      }
    }
    // ── AHL day (same logic as advanceDay) ────────────────────────────
    if (this.data.league.ahlSchedule && this.data.league.ahlSchedule.length > 0) {
      for (const game of this.data.league.ahlSchedule) {
        if (game.day !== nextDay) continue
        const ahlHome = this.data.teams.get(game.homeTeamId)
        const ahlAway = this.data.teams.get(game.awayTeamId)
        if (!ahlHome || !ahlAway) continue
        const ahlRes = quickSimGame(ahlHome, ahlAway, this.resolve, {
          seed: gameSeed(this.seed ^ 0xabcd1234, this.year, game.id),
        })
        game.result = {
          homeGoals: ahlRes.homeGoals,
          awayGoals: ahlRes.awayGoals,
          decidedBy: ahlRes.decidedBy,
        }
        applyStandingsResult(this.ahlStandings, ahlRes)
        mergePlayerStats(this.ahlTotals, ahlRes.playerStats)
        for (const [pid, s] of ahlRes.playerStats) {
          if (s.toi > 0) {
            // AHL gp tracked separately; this.gp is NHL-only
            this.ahlGp.set(pid, (this.ahlGp.get(pid) ?? 0) + 1)
          }
        }
        // AHL players (incl. prospects on the farm) can be injured too.
        rollInjuries({
          participants: [...ahlRes.playerStats]
            .filter(([, s]) => s.toi > 0)
            .map(([pid, s]) => ({ player: this.resolve(pid), toi: s.toi })),
          rng: this.rngFor(7402, this.year, game.id.length),
        })
      }
    }
    // ── wider world ────────────────────────────────────────────────────
    this.tickWorld(nextDay)
    // ─────────────────────────────────────────────────────────────────
    this.finishDay(nextDay, played, outcomes)
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
    // Fire playoff preview report (once per season).
    for (const kind of checkPlayoffEntry(this.pressScheduleState)) {
      this.queueScheduledReport(kind as Parameters<typeof this.queueScheduledReport>[0])
    }
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
      const res = sim(home, away, this.storyResolve(), { seed, rules: 'playoff' })
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
      this.creditPhysicalStats(res)
      applySeriesResult(po, g.seriesId, result)
      for (const pid of this.postGame(res, this.rngFor(7004, day, g.gameNumber))) played.add(pid)

      /* ── Wave 4: rivalry registration for playoff games ── */
      {
        const homePim = [...res.playerStats.entries()]
          .filter(([id]) => this.data.teams.get(g.homeTeamId)?.roster.includes(id))
          .reduce((s, [, st]) => s + st.penaltyMinutes, 0)
        const awayPim = [...res.playerStats.entries()]
          .filter(([id]) => this.data.teams.get(g.awayTeamId)?.roster.includes(id))
          .reduce((s, [, st]) => s + st.penaltyMinutes, 0)
        const rivalResult = registerGame({
          state: this.rivalriesState,
          teamA: g.homeTeamId as string,
          teamB: g.awayTeamId as string,
          goalsA: res.homeGoals,
          goalsB: res.awayGoals,
          penaltyMinutesA: homePim,
          penaltyMinutesB: awayPim,
          wasPlayoff: true,
          year: this.year,
          rng: this.rngFor(7201, day, g.gameNumber),
        })
        if (rivalResult.newsSeeds.length > 0) this.pushSeeds(rivalResult.newsSeeds)
      }
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

    // Locker rooms still tick through the playoffs (wins/losses move the room).
    const playoffWon = new Map<string, boolean>()
    for (const g of games) {
      const series = po.rounds.flatMap((r) => r.series).find((s) => s.id === g.seriesId)
      const last = series?.games[series.games.length - 1]
      if (!last) continue
      const homeWon = last.homeGoals > last.awayGoals
      playoffWon.set(last.homeTeamId as string, homeWon)
      playoffWon.set(last.awayTeamId as string, !homeWon)
    }
    for (const [teamId, won] of playoffWon) {
      this.losingStreaks.set(teamId, won ? 0 : (this.losingStreaks.get(teamId) ?? 0) + 1)
      this.tickTeamLockerRoom(asTeamId(teamId), day, won)
    }

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
      // Queue a champion tentpole press job.
      const champSpecial: string[] = [
        `${champ.name} are the champions of year ${this.year}.`,
        po.championTeamId === this.userTeamId ? 'This is a historic moment for your franchise.' : '',
      ].filter(Boolean)
      this.queuePressJob('champion', champSpecial)
      // Press conference: playoff elimination or championship
      if (po.championTeamId !== this.userTeamId) {
        const userSeries = po.rounds.flatMap((r) => r.series).find(
          (s) =>
            ((s.highSeedTeamId as string) === (this.userTeamId as string) ||
              (s.lowSeedTeamId as string) === (this.userTeamId as string)) &&
            s.status === 'finished' &&
            s.winnerTeamId !== this.userTeamId
        )
        if (userSeries && this.pressConference === null) {
          const oppId = (userSeries.highSeedTeamId === this.userTeamId) ? userSeries.lowSeedTeamId : userSeries.highSeedTeamId
          const opp = this.data.teams.get(oppId)
          this.queuePressConference(
            'Your season is over. What are your thoughts looking back?',
            `Eliminated by ${opp?.name ?? 'the opposition'} in the playoffs.`
          )
        }
      }
      this.enterOffseason()
    }
    return watched
  }

  /* ────────────────────────── offseason ────────────────────────── */

  private enterOffseason(): void {
    this.phase = 'offseason'
    this.offseason = { year: this.year, stage: 'awards', draft: null, faDay: 0 }
    // Fire awards night report on entering the offseason (once per season).
    for (const kind of checkAwardsStage(this.pressScheduleState)) {
      this.queueScheduledReport(kind as Parameters<typeof this.queueScheduledReport>[0])
    }
  }

  /** Move the offseason forward one stage (or one FA day). Returns true if it moved. */
  advanceOffseason(): boolean {
    const os = this.offseason
    if (!os) return false
    switch (os.stage) {
      case 'awards': {
        const rng = this.rngFor(8001)
        const sorted = sortStandings([...this.standings.values()])
        const championId = this.playoffs?.championTeamId ?? null

        /* ── season verdict vs preseason expectations ── */
        if (championId) {
          this.pushSeeds(
            seasonVerdict({
              state: this.expectationsState,
              finalStandings: sorted.map((s, i) => {
                const t = this.data.teams.get(s.teamId)!
                return { teamId: s.teamId as string, name: t.name, abbr: t.abbreviation, rank: i + 1 }
              }),
              championTeamId: championId as string,
              year: this.year,
              rng: this.rngFor(8008),
            }).newsSeeds
          )
        }

        /* ── Wave 4: board season review ── */
        {
          const userFinalRank = sorted.findIndex((s) => s.teamId === this.userTeamId) + 1
          const madePlayoffs = this.playoffs
            ? (this.playoffs.rounds[0]?.series ?? []).some(
                (s) =>
                  (s.highSeedTeamId as string) === (this.userTeamId as string) ||
                  (s.lowSeedTeamId as string) === (this.userTeamId as string)
              )
            : false
          const wonCup =
            (this.playoffs?.championTeamId as string | null) === (this.userTeamId as string)
          const reviewResult = seasonReview({
            state: this.boardState,
            finalRank: userFinalRank,
            madePlayoffs,
            wonCup,
            year: this.year,
            teamId: this.userTeamId as string,
            teamName: this.userTeam.name,
          })
          this.pushSeeds(reviewResult.newsSeeds.map((s) => ({ ...s, teamId: this.userTeamId as string })))
          if (reviewResult.fired) {
            // Record the firing but don't hard-crash — expose as a UI state.
            // The user can continue playing; further seasons just note the new GM context.
          }
        }

        /* ── fold the season into the all-time records ── */
        const champTeam = championId ? this.data.teams.get(championId)! : null
        this.pushSeeds(
          archiveSeason({
            state: this.recordsState,
            year: this.year,
            champion: champTeam ? { teamId: champTeam.id as string, name: champTeam.name } : null,
            presidentsName: sorted[0] ? this.data.teams.get(sorted[0].teamId)!.name : null,
            userRank: sorted.findIndex((s) => s.teamId === this.userTeamId) + 1,
            seasonLines: this.buildSeasonLines(),
            awards: this.awardsForArchive(),
          }).newsSeeds
        )

        /* ── world tournament for everyone whose season is over ── */
        const eligible: Array<{ player: Player; teamId: TeamId }> = []
        for (const team of this.data.teams.values()) {
          if (championId && team.id === championId) continue
          for (const id of team.roster) eligible.push({ player: this.resolve(id), teamId: team.id })
        }
        const tour = runTournament({
          eligible,
          userTeamId: this.userTeamId as string,
          rng: this.rngFor(8011),
          year: this.year,
        })
        this.tentpoles.tournament = tour.tournament
        this.pushSeeds(tour.newsSeeds)

        /* ── development: performance-relative, chemistry-aware, AHL-aware ── */
        // Ice-time weighting: combine NHL + AHL games played so a prospect
        // playing heavy AHL minutes develops at full rate, while a scratched
        // player (0 NHL + 0 AHL) stagnates. The gamesPlayedById callback feeds
        // developPlayers' internal gamesFactor curve (0 GP → 0.6, 60+ GP → 1.0).
        // Development judges a player on his production across EVERY tier he
        // played — NHL, AHL, and the wider world — so a prospect lighting up the
        // AHL or a junior/Euro league still develops. Wider-world points are
        // translated to an NHL-equivalent rate by league strength (see
        // combinedDevPerformance); ice-time (gamesPlayed) combines all tiers, so
        // a scratched player (0 games anywhere) stagnates.
        const offseasonWorldStrength = this.worldStrengthByPlayer()
        const dev = developPlayers({
          players: this.data.players,
          gamesPlayedById: (id) => this.combinedDevGames(id),
          year: this.year,
          rng,
          // In-season development already delivered part of this year's growth
          // continuously; the summer pass takes the remaining share so annual
          // totals stay calibrated. See inSeasonDevelopment.ts.
          growthScale: 0.65,
          performance: (id) => this.combinedDevPerformance(id, offseasonWorldStrength),
          expectations: (id) => {
            const p = this.data.players.get(id)!
            return expectedPointsFor(overall(p.composites, p.position), p.position, p.role)
          },
          devModifier: (id) => {
            const tid = this.teamOf(id)
            const lr = tid ? this.lockerRooms.get(tid) : undefined
            const lockerMod = lr ? developmentModifier(lr, id as string) : 1

            // Layer practice modifier on top of locker-room modifier for the
            // user's team. Other teams use only the locker-room modifier.
            if (tid === this.userTeamId) {
              const p = this.data.players.get(id)
              if (p) {
                const focus = effectiveFocus(this.practiceState, id as string)
                const { fatigueMod: _fm } = practiceDevModifier(focus, p)
                // For the dev loop we return lockerMod unchanged (bias is applied
                // per-attribute below via the practice route); the multiplier here
                // is just the locker-room factor so we don't double-count.
              }
            }
            return lockerMod
          },
        })
        for (const seed of dev.newsSeeds) {
          const p = this.resolve(seed.playerId)
          const texts: Record<typeof seed.kind, [NewsCategory, string, string]> = {
            breakout: [
              'milestone',
              `${p.name} is leveling up`,
              `Offseason training has transformed ${p.name} (${p.position}, ${p.age}).`,
            ],
            decline: [
              'league',
              `${p.name} losing a step`,
              `Scouts report ${p.name} (${p.position}, ${p.age}) has visibly declined.`,
            ],
            confidenceBoost: [
              'milestone',
              `${p.name} riding high`,
              `A season well above expectations has ${p.name} brimming with confidence.`,
            ],
            crisisOfConfidence: [
              'league',
              `${p.name} shaken`,
              `A season far below expectations has dented ${p.name}'s confidence.`,
            ],
          }
          const [cat, headline, body] = texts[seed.kind]
          this.pushNews(cat, headline, body, { playerId: seed.playerId as string })
        }

        /* ── retirements → legends ledger → Hall of Fame ── */
        const rosterTeamOf = new Map<string, TeamId>()
        for (const t of this.data.teams.values()) {
          for (const id of t.roster) rosterTeamOf.set(id as string, t.id)
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

        /* ── notable retirees → club legends registry ("where are they now") ── */
        for (const id of retired.retired) {
          const p = this.data.players.get(id)
          if (!p) continue
          const teamId = rosterTeamOf.get(id as string)
          if (!teamId) continue
          const ovr = overall(p.composites, p.position)
          const seasonsPlayed = p.stats.length
          // Notable = a genuine top player or a long-serving veteran.
          if (ovr < 78 && seasonsPlayed < 12) continue
          this.recordLegend(teamId, p, ovr, seasonsPlayed)
        }

        /* ── add notable retirees to hireable pool; auto-fill empty staff slot ── */
        const retiredIds = retired.retired.map((id) => id as string)
        // Add to hireable pool (for UI to display)
        this.hireableStaff = retiredIds.slice(0, 10)
        // Auto-fill: if the user team has no AGM yet, promote the most notable retiree
        if (!this.staff) {
          this.staff = generateStaff({ rng: new Rng(deriveSeed(this.seed, 9200)) })
        } else if (retiredIds.length > 0) {
          // Occasionally (1 in 3 seasons) auto-convert a notable retiree to staff
          if (rng.next() < 0.33) {
            const candidateId = retiredIds[0]
            const candidate = this.data.players.get(asPlayerId(candidateId))
            if (candidate) {
              const newStaff = hireRetiredPlayer({
                player: candidate,
                role: rng.next() < 0.5 ? 'headCoach' : 'assistantGM',
                rng: new Rng(deriveSeed(this.seed, 9201, this.year)),
              })
              if (newStaff.role === 'headCoach') {
                this.staff.headCoach = newStaff
              } else {
                this.staff.assistantGM = newStaff
              }
              const roleLabel = newStaff.role === 'headCoach' ? 'Head Coach' : 'Assistant GM'
              const userTeamName = this.data.teams.get(this.userTeamId)?.name ?? 'the club'
              this.updateLegendStatus(candidateId, `${roleLabel}, ${userTeamName}`)
              this.pushNews(
                'league',
                `${newStaff.name} joins coaching staff`,
                `The retired ${candidate.name} transitions to ${newStaff.role === 'headCoach' ? 'head coach' : 'assistant GM'}.`,
                { playerId: candidateId }
              )
            }
          }
        }
        this.pushSeeds(
          registerRetirements({
            state: this.recordsState,
            retirees: retired.retired.map((id) => {
              const c = this.careerTotalsOf(id)
              const p = this.resolve(id)
              return {
                playerId: id as string,
                name: p.name,
                careerGoals: c.goals,
                careerAssists: c.assists,
                careerPoints: c.points,
                careerGames: c.gamesPlayed,
              }
            }),
            year: this.year,
          }).newsSeeds
        )
        for (const id of retired.retired) {
          this.lockerDeparture(rosterTeamOf.get(id as string) ?? null, id)
        }
        this.pushSeeds(inductHallOfFame(this.recordsState, this.year))

        /* ── draft class ── */
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

        /* ── draft lottery (non-playoff teams) BEFORE the order is built ── */
        const qualified = new Set<string>()
        for (const s of this.playoffs?.rounds[0]?.series ?? []) {
          qualified.add(s.highSeedTeamId as string)
          qualified.add(s.lowSeedTeamId as string)
        }
        const standingsOrder = sorted.map((s) => s.teamId)
        const nonPlayoffWorstFirst = standingsOrder
          .filter((t) => !qualified.has(t as string))
          .reverse()
        const playoffWorstFirst = standingsOrder
          .filter((t) => qualified.has(t as string))
          .reverse()
        const lottery = runLottery({
          nonPlayoffTeamIds: nonPlayoffWorstFirst,
          rng: this.rngFor(8010),
          year: draftYear,
        })
        this.tentpoles.lotteryDone = true
        this.pushSeeds(lottery.newsSeeds)
        const abbrOfTeam = (id: TeamId): string => this.data.teams.get(id)?.abbreviation ?? (id as string)
        this.lastLottery = {
          orderAbbrs: lottery.order.map(abbrOfTeam),
          movedUp: lottery.movedUp
            ? {
                teamAbbr: abbrOfTeam(lottery.movedUp.teamId),
                from: lottery.movedUp.from,
                to: lottery.movedUp.to,
              }
            : null,
        }
        const worstFirst =
          lottery.order.length > 0
            ? [...lottery.order, ...playoffWorstFirst]
            : [...standingsOrder].reverse()
        os.draft = buildDraftOrder({
          year: draftYear,
          rounds: DRAFT_ROUNDS,
          picks: this.picks.filter((p) => p.year === draftYear),
          standingsWorstFirst: worstFirst,
        })

        /* ── scouting combine on the new class ── */
        const combine = runCombine({
          prospects: cls.draftClass.prospects.map((pr) => {
            const p = this.resolve(pr.playerId)
            return { playerId: pr.playerId as string, name: p.name, position: p.position, rank: pr.rank }
          }),
          players: this.data.players,
          rng: this.rngFor(8012),
          year: draftYear,
        })
        this.tentpoles.combine = combine.combine
        this.pushSeeds(combine.newsSeeds)
        const knowledge = new Map(this.scouting.knowledge)
        for (const [pid, boost] of combine.knowledgeBoosts) {
          knowledge.set(pid, Math.min(100, (knowledge.get(pid) ?? 0) + boost))
        }
        this.scouting.knowledge = [...knowledge.entries()]

        os.stage = 'draft'
        this.pushNews(
          'draft',
          `The ${draftYear} entry draft is open`,
          `${cls.draftClass.prospects.length} prospects are on the board across ${DRAFT_ROUNDS} rounds.`
        )
        // Fire draft preview report (once per season).
        for (const kind of checkDraftStage(this.pressScheduleState)) {
          this.queueScheduledReport(kind as Parameters<typeof this.queueScheduledReport>[0])
        }
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
        for (const e of expired) this.lockerDeparture(e.teamId, e.playerId)
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
        for (const s of res.signings) this.lockerArrival(s.teamId, s.playerId)
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
        if (os.faDay >= FA_WINDOW_DAYS) {
          this.runWorldFreeAgency()
          os.stage = 'preseason'
        }
        return true
      }
      case 'preseason': {
        // Fire season review report before rolling over (once per season).
        for (const kind of checkPreseasonStage(this.pressScheduleState)) {
          this.queueScheduledReport(kind as Parameters<typeof this.queueScheduledReport>[0])
        }
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
      this.lockerArrival(pick.ownerTeamId, playerId)
    }
    if (pick.ownerTeamId === this.userTeamId) {
      this.pushNews(
        'draft',
        `Drafted ${player.name} at #${idx + 1}`,
        `${player.name} (${player.position}, ${player.age}) joins the organization.`,
        { playerId: playerId as string }
      )
      /* ── Wave 4: record draft transaction ── */
      const txResult = recordTransaction(this.transactionLedger, {
        day: this.currentDay,
        year: this.year,
        kind: 'draft',
        teamIds: [this.userTeamId as string],
        summary: `${this.userTeam.abbreviation} selects ${player.name} (${player.position}) at #${idx + 1}.`,
      })
      this.transactionLedger = txResult.ledger
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

    // Final ranks feed next season's preseason odds (30% of the blend).
    const finalRanks = new Map<string, number>(
      sorted.map((s, i) => [s.teamId as string, i + 1])
    )

    const newYear = this.year + 1
    this.data.league.season.year = newYear
    // Rebuild next season's schedule, preserving the weighted NHL format when the
    // league has a conference/division structure (else flat round-robins).
    const schedTeams = this.data.league.teams
      .map((id) => this.data.teams.get(id))
      .filter((t): t is NonNullable<typeof t> => t !== undefined)
      .map((t) => ({ id: t.id, conferenceId: t.conferenceId, divisionId: t.divisionId }))
    const structured = new Set(schedTeams.map((t) => t.divisionId)).size >= 2 && schedTeams.length >= 24
    this.data.league.schedule = structured
      ? buildWeightedSchedule(schedTeams, newYear)
      : buildSchedule([...this.data.league.teams], ROUND_ROBINS, newYear)
    this.data.league.season.standings = this.data.league.teams.map(freshStanding)
    this.refreshMatchDays()

    this.standings.clear()
    for (const teamId of this.data.league.teams) this.standings.set(teamId, freshStanding(teamId))

    // Reset AHL standings and schedule results for the new season.
    // A new AHL schedule is rebuilt alongside the NHL one (buildSchedule already called above).
    // We clear results on the existing ahlSchedule entries in-place.
    this.ahlStandings.clear()
    for (const teamId of this.data.league.ahlTeams ?? []) {
      this.ahlStandings.set(teamId, freshStanding(teamId))
    }
    if (this.data.league.ahlSchedule) {
      for (const g of this.data.league.ahlSchedule) g.result = null
    }
    this.ahlGp.clear()
    this.ahlTotals.clear()

    // Reset the wider world for the new season (standings, stats, game results).
    if (this.data.league.competitions) {
      resetWorldSim(this.worldSim, this.data.league.competitions)
    }

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
    // Reset press schedule for the new season.
    this.pressScheduleState = initialPressScheduleState()

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
    // Re-balance rosters across NHL/AHL pairs for the new season.
    this.assignRosters()

    /* ── story layer rollover ── */
    this.tentpoles = createInitialTentpolesState()
    this.lastDeadlineRecap = null
    this.lastLottery = null
    this.pointStreaks.clear()
    this.scorelessStreaks.clear()
    this.losingStreaks.clear()
    this.prevRanks.clear()
    /* ── plumbing module rollover ── */
    this.playerRatings.clear()
    this.hireableStaff = []
    // Keep practiceState team focus across seasons (intentional persistence)
    // Season-scoped arcs close; feuds/mentorships/milestone chases carry over.
    for (const arc of this.arcsState.arcs) {
      if (arc.status === 'resolved') continue
      if (arc.kind === 'feud' || arc.kind === 'mentorship' || arc.kind === 'milestoneWatch') continue
      resolveArc(this.arcsState, arc.id, 'The season came to an end.', 0, newYear)
    }
    const odds = buildPreseasonOdds({
      teams: this.teamDescriptors(finalRanks),
      year: newYear,
      rng: this.rngFor(9101),
    })
    this.expectationsState = odds.state

    /* ── Wave 4: board mandate rollover + rivalry decay ── */
    {
      const boardResult = setSeasonMandate({
        teamStrengthRank: this.userStrengthRank(),
        teamsInLeague: this.data.league.teams.length,
        lastYearRank: finalRanks.get(this.userTeamId as string),
        wonCupLastYear:
          (this.playoffs?.championTeamId as string | null) === (this.userTeamId as string),
        rng: this.rngFor(9301),
        year: newYear,
        teamId: this.userTeamId as string,
        teamName: this.userTeam.name,
      })
      this.boardState = boardResult.state
      this.pushSeeds([boardResult.newsSeed])
    }
    decayIntensity(this.rivalriesState, newYear)
    // Reset special-teams for the new season.
    this.specialTeams = []

    this.pushNews(
      'league',
      `${this.data.league.name} ${newYear}–${newYear + 1} season begins`,
      `A clean sheet of ice. ${this.matchDays.length} match days to the playoffs.`
    )
    this.pushSeeds(odds.newsSeeds)
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

  /**
   * Merge the coach's suggested tactic fields onto the current tactics.
   * Only the fields present in `suggestedTactics` are overwritten; other
   * fields remain unchanged. This lets the UI apply a partial suggestion
   * (e.g. only forecheck, or only tempo) without blowing away the rest.
   */
  applyCoachSuggestion(suggestedTactics: Partial<TeamTactics>): void {
    const current = this.userTeam.tactics
    const merged: TeamTactics = {
      ...current,
      ...suggestedTactics,
      // Deep-merge tempo: if suggestedTactics.tempo is partial, keep current fields
      tempo: suggestedTactics.tempo !== undefined
        ? { ...current.tempo, ...suggestedTactics.tempo }
        : current.tempo,
    }
    this.userTeam.tactics = merged
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
    this.lockerDeparture(this.userTeamId, asPlayerId(playerId))
    repairLines(this.userTeam, this.data.players)
    const p = this.resolve(asPlayerId(playerId))
    this.pushNews('contract', `${p.name} released`, `${p.name} was placed on waivers and released.`, {
      playerId,
    })
    /* ── Wave 4: record transaction ── */
    {
      const txResult = recordTransaction(this.transactionLedger, {
        day: this.currentDay,
        year: this.year,
        kind: 'release',
        teamIds: [this.userTeamId as string],
        summary: `${this.userTeam.abbreviation} releases ${p.name}.`,
      })
      this.transactionLedger = txResult.ledger
    }
  }

  /* ────────────────────────── farm system ────────────────────────── */

  /**
   * Minimum roster position counts required for a team to ice full lines.
   * A team that drops below any of these after a removal would be illegal.
   */
  private static readonly ROSTER_MIN_F = 12
  private static readonly ROSTER_MIN_D = 6
  private static readonly ROSTER_MIN_G = 2

  /**
   * Count healthy players of each broad position on a team's roster.
   * Returns { f, d, g } counts (F = C + W, D = D, G = G).
   */
  private rosterCounts(team: { roster: PlayerId[] }): { f: number; d: number; g: number } {
    let f = 0
    let d = 0
    let g = 0
    for (const id of team.roster) {
      const p = this.data.players.get(id)
      if (!p) continue
      if (p.position === 'D') d++
      else if (p.position === 'G') g++
      else f++
    }
    return { f, d, g }
  }

  /**
   * Call up a player from the AHL to their parent NHL team.
   *
   * The player must be on an AHL team whose parentTeamId points to an NHL team.
   * The source AHL team must retain at least 12F + 6D + 2G after removal.
   * Returns `{ ok: false, reason }` rather than throwing if any pre-condition fails.
   * On success, pushes a news item and transaction ledger entry for the user's org.
   */
  callUp(playerId: string): { ok: true } | { ok: false; reason: string } {
    const pid = asPlayerId(playerId)
    const ahlTeam = [...this.data.teams.values()].find(
      (t) => t.tier === 'ahl' && t.roster.includes(pid)
    )
    if (!ahlTeam) {
      return { ok: false, reason: 'Player is not on any AHL roster.' }
    }
    const nhlTeam = ahlTeam.parentTeamId ? this.data.teams.get(ahlTeam.parentTeamId) : undefined
    if (!nhlTeam) {
      return { ok: false, reason: 'AHL team has no parent NHL team.' }
    }

    // Validate source AHL team retains minimums after removal.
    const p = this.data.players.get(pid)
    if (!p) return { ok: false, reason: 'Player not found.' }
    const counts = this.rosterCounts(ahlTeam)
    const posKey = p.position === 'D' ? 'd' : p.position === 'G' ? 'g' : 'f'
    const mins = { f: Career.ROSTER_MIN_F, d: Career.ROSTER_MIN_D, g: Career.ROSTER_MIN_G }
    if (counts[posKey] - 1 < mins[posKey]) {
      return {
        ok: false,
        reason: `The AHL team would be short of ${posKey.toUpperCase()} players after this call-up.`,
      }
    }

    // Move the player.
    ahlTeam.roster = ahlTeam.roster.filter((id) => id !== pid)
    nhlTeam.roster.push(pid)
    repairLines(ahlTeam, this.data.players)
    repairLines(nhlTeam, this.data.players)

    // News + transaction for the user's org only.
    if (nhlTeam.id === this.userTeamId || ahlTeam.parentTeamId === this.userTeamId) {
      this.pushNews(
        'contract',
        `${p.name} recalled from ${ahlTeam.abbreviation}`,
        `${p.name} (${p.position}, ${p.age}) has been recalled from the AHL affiliate.`,
        { playerId: playerId, teamId: nhlTeam.id as string }
      )
      const txResult = recordTransaction(this.transactionLedger, {
        day: this.currentDay,
        year: this.year,
        kind: 'signing',
        teamIds: [nhlTeam.id as string],
        summary: `${nhlTeam.abbreviation} recalls ${p.name} from ${ahlTeam.abbreviation}.`,
      })
      this.transactionLedger = txResult.ledger
    }

    return { ok: true }
  }

  /**
   * Send down a player from an NHL team to its AHL affiliate.
   *
   * The player must be on an NHL team that has an affiliateId.
   * The source NHL team must retain at least 12F + 6D + 2G after removal.
   * Returns `{ ok: false, reason }` rather than throwing if any pre-condition fails.
   * On success, pushes a news item and transaction ledger entry for the user's org.
   */
  sendDown(playerId: string): { ok: true } | { ok: false; reason: string } {
    const pid = asPlayerId(playerId)
    // Find the NHL team that holds this player (skip AHL teams).
    const nhlTeam = [...this.data.teams.values()].find(
      (t) => t.tier !== 'ahl' && t.roster.includes(pid)
    )
    if (!nhlTeam) {
      return { ok: false, reason: 'Player is not on any NHL roster.' }
    }
    const ahlTeam = nhlTeam.affiliateId ? this.data.teams.get(nhlTeam.affiliateId) : undefined
    if (!ahlTeam) {
      return { ok: false, reason: 'This NHL team has no AHL affiliate.' }
    }

    // Validate source NHL team retains minimums after removal.
    const p = this.data.players.get(pid)
    if (!p) return { ok: false, reason: 'Player not found.' }
    const counts = this.rosterCounts(nhlTeam)
    const posKey = p.position === 'D' ? 'd' : p.position === 'G' ? 'g' : 'f'
    const mins = { f: Career.ROSTER_MIN_F, d: Career.ROSTER_MIN_D, g: Career.ROSTER_MIN_G }
    if (counts[posKey] - 1 < mins[posKey]) {
      return {
        ok: false,
        reason: `The NHL team would be short of ${posKey.toUpperCase()} players after this assignment.`,
      }
    }

    // Move the player.
    nhlTeam.roster = nhlTeam.roster.filter((id) => id !== pid)
    ahlTeam.roster.push(pid)
    repairLines(nhlTeam, this.data.players)
    repairLines(ahlTeam, this.data.players)

    // News + transaction for the user's org only.
    if (nhlTeam.id === this.userTeamId) {
      this.pushNews(
        'contract',
        `${p.name} assigned to ${ahlTeam.abbreviation}`,
        `${p.name} (${p.position}, ${p.age}) has been assigned to the AHL affiliate.`,
        { playerId: playerId, teamId: ahlTeam.id as string }
      )
      const txResult = recordTransaction(this.transactionLedger, {
        day: this.currentDay,
        year: this.year,
        kind: 'release',
        teamIds: [nhlTeam.id as string],
        summary: `${nhlTeam.abbreviation} assigns ${p.name} to ${ahlTeam.abbreviation}.`,
      })
      this.transactionLedger = txResult.ledger
    }

    return { ok: true }
  }

  /**
   * AI auto-assignment: for every NHL team, keep roughly the best 23 players on
   * the NHL roster and send extras to the AHL affiliate. The process is additive
   * and preserves existing NHL players — it only moves excess NHL players DOWN
   * (trimming rosters > NHL_TARGET), and pulls AHL players UP only when the NHL
   * team is below position minimums (12F + 6D + 2G). The user's team is included
   * so it is never left in an illegal state after injury waves.
   *
   * Deterministic — no Rng; pure ranking by overall.
   */
  assignRosters(): void {
    const NHL_TARGET = 23
    for (const nhlTeamId of this.data.league.teams) {
      const nhlTeam = this.data.teams.get(nhlTeamId)
      if (!nhlTeam) continue
      const ahlTeam = nhlTeam.affiliateId ? this.data.teams.get(nhlTeam.affiliateId) : undefined
      if (!ahlTeam) continue // no affiliate — skip

      // ── Step 1: send excess NHL players to AHL ───────────────────────────
      if (nhlTeam.roster.length > NHL_TARGET) {
        const nhlPlayers = nhlTeam.roster.map((id) => {
          const p = this.data.players.get(id)
          return p ? { id, ovr: overall(p.composites, p.position) } : null
        }).filter((x): x is { id: PlayerId; ovr: number } => x !== null)

        // Sort worst-first so we send the lowest-rated extras to AHL.
        nhlPlayers.sort((a, b) => a.ovr - b.ovr || (a.id < b.id ? -1 : 1))
        const excess = nhlTeam.roster.length - NHL_TARGET
        const toSend = nhlPlayers.slice(0, excess).map((p) => p.id)
        const toSendSet = new Set(toSend)
        nhlTeam.roster = nhlTeam.roster.filter((id) => !toSendSet.has(id))
        for (const id of toSend) ahlTeam.roster.push(id)
      }

      // ── Step 2: pull AHL players up if NHL team below position minimums ──
      // This handles post-offseason scenarios where contract expiries left gaps.
      const nhlCounts = this.rosterCounts(nhlTeam)
      const deficit = {
        G: Math.max(0, Career.ROSTER_MIN_G - nhlCounts.g),
        D: Math.max(0, Career.ROSTER_MIN_D - nhlCounts.d),
        F: Math.max(0, Career.ROSTER_MIN_F - nhlCounts.f),
      }
      const totalDeficit = deficit.G + deficit.D + deficit.F
      if (totalDeficit > 0) {
        // Pull the best available AHL players of the needed positions.
        const posNeed = (pos: Position): boolean =>
          (pos === 'G' && deficit.G > 0) ||
          (pos === 'D' && deficit.D > 0) ||
          ((pos === 'C' || pos === 'W') && deficit.F > 0)

        const candidates = ahlTeam.roster
          .map((id) => {
            const p = this.data.players.get(id)
            return p ? { id, ovr: overall(p.composites, p.position), pos: p.position } : null
          })
          .filter((x): x is { id: PlayerId; ovr: number; pos: Position } => x !== null && posNeed(x.pos))
          .sort((a, b) => b.ovr - a.ovr || (a.id < b.id ? -1 : 1))

        for (const cand of candidates) {
          if (!posNeed(cand.pos)) continue
          nhlTeam.roster.push(cand.id)
          ahlTeam.roster = ahlTeam.roster.filter((id) => id !== cand.id)
          const bucket = cand.pos === 'G' ? 'G' : cand.pos === 'D' ? 'D' : 'F'
          deficit[bucket] = Math.max(0, deficit[bucket] - 1)
          if (deficit.G === 0 && deficit.D === 0 && deficit.F === 0) break
        }
      }

      repairLines(nhlTeam, this.data.players)
      repairLines(ahlTeam, this.data.players)
    }
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
      /* ── Wave 4: record transaction ── */
      {
        const txResult = recordTransaction(this.transactionLedger, {
          day: this.currentDay,
          year: this.year,
          kind: 'signing',
          teamIds: [this.userTeamId as string],
          summary: `${this.userTeam.abbreviation} re-signs ${player.name} ($${(salary / 1e6).toFixed(1)}M × ${years}).`,
        })
        this.transactionLedger = txResult.ledger
      }
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
    this.lockerArrival(this.userTeamId, id)
    repairLines(this.userTeam, this.data.players)
    this.pushNews(
      'contract',
      `${player.name} signs with ${this.userTeam.abbreviation}`,
      `Welcome aboard: $${(salary / 1e6).toFixed(2)}M × ${years} years.`,
      { playerId }
    )
    /* ── Coach quote: signing welcome ── */
    {
      const quoteSeed = this.seed ^ Career.pidNum(playerId)
      this.pushCoachQuote(
        'signing',
        { playerName: player.name },
        quoteSeed,
        `${player.name} signing — Coach's reaction`
      )
    }
    /* ── Wave 4: record transaction ── */
    {
      const txResult = recordTransaction(this.transactionLedger, {
        day: this.currentDay,
        year: this.year,
        kind: 'signing',
        teamIds: [this.userTeamId as string],
        summary: `${this.userTeam.abbreviation} signs FA ${player.name} ($${(salary / 1e6).toFixed(1)}M × ${years}).`,
      })
      this.transactionLedger = txResult.ledger
    }
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
      for (const p of give.players) {
        this.lockerDeparture(this.userTeamId, p.id)
        this.lockerArrival(partnerId, p.id)
      }
      for (const p of receive.players) {
        this.lockerDeparture(partnerId, p.id)
        this.lockerArrival(this.userTeamId, p.id)
      }
      this.pushNews(
        'trade',
        `Trade completed with ${partner.abbreviation}`,
        `${give.players.map((p) => p.name).join(', ') || 'Picks'} for ${receive.players.map((p) => p.name).join(', ') || 'picks'}.`,
        { teamId: partnerId as string }
      )
      /* ── Wave 4: record transaction ── */
      const txResult = recordTransaction(this.transactionLedger, {
        day: this.currentDay,
        year: this.year,
        kind: 'trade',
        teamIds: [this.userTeamId as string, partnerId as string],
        summary: `${this.userTeam.abbreviation} trades ${give.players.map((p) => p.name).join(', ') || 'picks'} to ${partner.abbreviation} for ${receive.players.map((p) => p.name).join(', ') || 'picks'}.`,
      })
      this.transactionLedger = txResult.ledger
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
    for (const id of offer.userGivesPlayerIds) {
      this.lockerDeparture(this.userTeamId, id)
      this.lockerArrival(offer.partnerTeamId, id)
    }
    for (const id of offer.userReceivesPlayerIds) {
      this.lockerDeparture(offer.partnerTeamId, id)
      this.lockerArrival(this.userTeamId, id)
    }
    this.tradeOffers = this.tradeOffers.filter((o) => o.offerId !== offerId)
    this.pushNews('trade', `Trade completed with ${partner.abbreviation}`, `The deal is done.`, {
      teamId: offer.partnerTeamId as string,
    })
    /* ── Coach quote: trade-add reaction (if at least one player received) ── */
    if (offer.userReceivesPlayerIds.length > 0) {
      const firstReceived = offer.userReceivesPlayerIds[0]!
      const receivedPlayer = this.data.players.get(asPlayerId(firstReceived))
      if (receivedPlayer) {
        const quoteSeed = this.seed ^ Career.pidNum(firstReceived)
        this.pushCoachQuote(
          'tradeAdd',
          { playerName: receivedPlayer.name, opponentAbbr: partner.abbreviation },
          quoteSeed,
          `Trade with ${partner.abbreviation} — Coach's reaction`
        )
      }
    }
    /* ── Wave 4: record transaction ── */
    {
      const txResult = recordTransaction(this.transactionLedger, {
        day: this.currentDay,
        year: this.year,
        kind: 'trade',
        teamIds: [this.userTeamId as string, offer.partnerTeamId as string],
        summary: `${this.userTeam.abbreviation} accepts trade with ${partner.abbreviation}.`,
      })
      this.transactionLedger = txResult.ledger
    }
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
      const gi = gameIntensity(this.rivalriesState, this.userTeamId as string, opp.id as string)
      nextGame = {
        day: nextSched.day,
        date: dayToDateISO(this.year, nextSched.day),
        opponentTeamId: opp.id as string,
        opponentName: opp.name,
        opponentAbbr: opp.abbreviation,
        home,
        opponentRank: sorted.findIndex((s) => s.teamId === opp.id) + 1,
        rivalryLabel: gi.label,
      }
    } else if (this.phase === 'playoffs' && this.playoffs) {
      const pending = pendingGames(this.playoffs).find(
        (g) => g.homeTeamId === this.userTeamId || g.awayTeamId === this.userTeamId
      )
      if (pending) {
        const home = pending.homeTeamId === this.userTeamId
        const opp = this.data.teams.get(home ? pending.awayTeamId : pending.homeTeamId)!
        const gi = gameIntensity(this.rivalriesState, this.userTeamId as string, opp.id as string)
        nextGame = {
          day: this.currentDay + 1,
          date: dayToDateISO(this.year, this.currentDay + 1),
          opponentTeamId: opp.id as string,
          opponentName: opp.name,
          opponentAbbr: opp.abbreviation,
          home,
          opponentRank: sorted.findIndex((s) => s.teamId === opp.id) + 1,
          rivalryLabel: gi.label,
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

    /* ── team leaders (EHM right-rail) ── */
    const leadersEntries = team.roster.map((id) => {
      const p = this.resolve(id)
      const t = this.totals.get(id)
      const gp = this.gp.get(id) ?? 0
      const sa = t?.shotsAgainst ?? 0
      const toi = t?.toi ?? 0
      const ratings = this.playerRatings.get(id as string) ?? []
      return {
        playerId: id as string,
        name: p.name,
        teamAbbr: team.abbreviation,
        position: p.position,
        goals: t?.goals ?? 0,
        assists: t?.assists ?? 0,
        points: (t?.goals ?? 0) + (t?.assists ?? 0),
        plusMinus: 0,
        gamesPlayed: gp,
        avgRating: seasonAvgRating(ratings),
        savePct: sa > 0 ? t!.saves / sa : undefined,
        goalsAgainst: t?.goalsAgainst,
        toi,
      }
    })
    const tl: TeamLeadersView = teamLeaders({ entries: leadersEntries })

    /* ── playerFocus: rotating featured player (deterministic by day) ── */
    const rosterArr = team.roster
    let playerFocusField: DashboardView['playerFocus'] = undefined
    if (rosterArr.length > 0) {
      const featuredId = rosterArr[this.currentDay % rosterArr.length]
      const fp = this.resolve(featuredId)
      const fpt = this.totals.get(featuredId)
      const fpGp = this.gp.get(featuredId) ?? 0
      const fpRatings = this.playerRatings.get(featuredId as string) ?? []
      const seasonLine =
        fp.position === 'G'
          ? `${fpGp} GP, ${fpt?.saves ?? 0} SVS`
          : `${fpGp} GP, ${fpt?.goals ?? 0}G ${fpt?.assists ?? 0}A`
      playerFocusField = {
        playerId: featuredId as string,
        name: fp.name,
        position: fp.position,
        overall: ratedOverall(fp),
        seasonLine,
        gameRatingForm: formString(fpRatings),
        avgRating: seasonAvgRating(fpRatings),
      }
    }

    /* ── financesSummary ── */
    const avgSalary = roster.length > 0 ? Math.round(capUsed / roster.length) : 0
    const financesSummary: DashboardView['financesSummary'] = {
      balance: team.finances.budget - capUsed,
      capUsed,
      capSpace: Math.max(0, team.finances.salaryCap - capUsed),
      avgSalary,
    }

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
      ...(expectedRankOf(this.expectationsState, this.userTeamId as string) !== undefined
        ? { predictedRank: expectedRankOf(this.expectationsState, this.userTeamId as string)! }
        : {}),
      topArcs: [...this.arcsState.arcs]
        .filter((a) => a.status !== 'resolved')
        .sort((a, b) => b.tension - a.tension)
        .slice(0, 3)
        .map((a) => ({ kind: a.kind, headline: this.arcHeadline(a) })),
      teamLeaders: tl,
      playerFocus: playerFocusField,
      financesSummary,
      board: boardSummary(this.boardState),
      gmFired: this.boardState.firedAtYear !== null,
    }
  }

  getSquad(): SquadView {
    const scratchedSet = new Set(this.practiceState.scratched)
    return buildSquadView(this.ctx(), {
      playerRatings: this.playerRatings,
      scratched: scratchedSet,
    })
  }

  getPlayer(playerId: string): PlayerProfileView {
    const pid = asPlayerId(playerId)
    // Apply fog for players not on user's own roster
    const isOwnPlayer = this.userTeam.roster.includes(pid)
    const fog = isOwnPlayer ? undefined : this.fogCtx()

    // Find which team this player is on to pull locker room
    let playerTeamId: TeamId | undefined
    for (const [tid, team] of this.data.teams) {
      if (team.roster.includes(pid)) { playerTeamId = tid; break }
    }
    const lockerRoom = playerTeamId ? (this.lockerRooms.get(playerTeamId) ?? null) : null

    const mindsetCtx: MindsetBuildCtx = {
      lockerRoom,
      getPlayerName: (id) => this.data.players.get(asPlayerId(id))?.name ?? null,
      isOwn: isOwnPlayer,
    }

    const userScouts = this.getTeamStaff(this.userTeamId as string).scouts
    const playerForLeague = this.data.players.get(pid)
    const leagueAbbrev = playerForLeague ? this.leagueAbbrevForPlayer(playerForLeague) : 'NHL'
    const profile = buildPlayerProfile(this.ctx(), pid, fog, mindsetCtx, userScouts, {
      factor: nhleFactorByAbbrev(leagueAbbrev),
      name: leagueAbbrev,
    })

    // Current-season line fix: buildPlayerProfile reads NHL totals only, so an
    // AHL or wider-world player shows 0 GP even though his league is simulated.
    // Re-point the current season at the totals for the league he actually plays
    // in (AHL affiliate or a world competition).
    const curTeam = playerTeamId ? this.data.teams.get(playerTeamId) : undefined
    const curTier = curTeam?.tier
    if ((curTier === 'ahl' || curTier === 'world') && profile.seasons[0]) {
      const totals = curTier === 'ahl' ? this.ahlTotals : this.worldSim.totals
      const gpMap = curTier === 'ahl' ? this.ahlGp : this.worldSim.gp
      const t = totals.get(pid)
      const g = gpMap.get(pid) ?? 0
      const p = this.data.players.get(pid)!
      if (p.position === 'G') {
        const sa = t?.shotsAgainst ?? 0
        profile.seasons[0].goalie = {
          gamesPlayed: g, wins: 0, losses: 0,
          savePct: sa > 0 ? (t?.saves ?? 0) / sa : 0,
          goalsAgainstAverage: g > 0 ? (t?.goalsAgainst ?? 0) / g : 0,
          shutouts: t?.shutouts ?? 0, saves: t?.saves ?? 0, shotsAgainst: sa,
        }
        profile.seasons[0].skater = null
      } else {
        profile.seasons[0].skater = {
          gamesPlayed: g,
          goals: t?.goals ?? 0,
          assists: t?.assists ?? 0,
          points: (t?.goals ?? 0) + (t?.assists ?? 0),
          plusMinus: 0,
          penaltyMinutes: t?.penaltyMinutes ?? 0,
          shots: t?.shots ?? 0,
          toiPerGame: g > 0 ? Math.round((t?.toi ?? 0) / g) : 0,
          ppGoals: 0, ppAssists: 0,
        }
        profile.seasons[0].goalie = null
      }
    }

    // Interview section: answered Q&A (deterministic from traits) + remaining questions.
    const player = this.data.players.get(pid)
    if (player) {
      const asked = this.interviews.get(playerId) ?? []
      const answers = asked
        .map((qid) => answerInterviewQuestion(player, qid))
        .filter((a): a is NonNullable<typeof a> => a !== null)
      const available = INTERVIEW_QUESTIONS
        .filter((q) => !asked.includes(q.id))
        .map((q) => ({ id: q.id, prompt: q.prompt }))
      profile.interview = { answers, available }
      const pendingInt = this.pendingInterviews.find((i) => i.playerId === playerId)
      if (pendingInt) profile.interviewScheduled = dayToDateISO(pendingInt.year, pendingInt.dueDay)

      // System fit vs the player's team's current tactics (skaters only).
      const team = playerTeamId ? this.data.teams.get(playerTeamId) : undefined
      if (team?.tactics) {
        const fit = playerStyleFit(player, team.tactics)
        if (fit) profile.systemFit = fit
      }

      // EHM-style roster projection + per-coach reports. Same gate as the scout
      // verdict (own player / reliably scouted). Prospects on an AHL affiliate
      // are measured against the parent NHL club, as EHM does.
      if (profile.scoutVerdict) {
        let clubId = playerTeamId
        if (team?.tier === 'ahl') {
          for (const [tid, t] of this.data.teams) {
            if (t.affiliateId === playerTeamId) { clubId = tid; break }
          }
        }
        const club = clubId ? this.data.teams.get(clubId) : undefined
        if (club) {
          const clubRoster = club.roster
            .map((id) => this.data.players.get(id))
            .filter((pl): pl is Player => pl !== undefined)
          const staff = this.getTeamStaff(clubId as string)
          profile.rosterProjection = buildRosterProjection({
            player,
            teamName: club.name,
            clubRoster,
            coachName: staff.headCoach.name,
            season: this.seasonFormOf(player),
          })
          // Coach reports are no longer inline — request them (delivered to inbox).
        }
      }

      // Opinion timeline — how the read on him has moved this/last season.
      const timeline = this.opinionHistory.get(playerId)
      if (timeline && timeline.length > 0) profile.opinionTimeline = timeline.map((s) => ({ ...s }))

      // Analyst draft projection — the pundit consensus read for draft-relevant
      // prospects (rank + projected ceiling role), shown under the scout report.
      // Our scouts' projected ceiling role (fog-aware read) — a real role label
      // ("Top-pair D", "Middle-six F", "Starter"), never a vague "Prospect". Uses
      // the same fogged ceiling as the POTENTIAL stars/grade, so they agree.
      const scoutedCeil = this.scoutedCeilingOf(player)
      profile.scoutsCeilingRole = ceilingRoleShort(scoutedCeil, player.position)

      const elig = draftEligibility(player.age, !!player.nhlDrafted)
      if (elig) {
        const board = this.getDraftRankings()
        // The analysts' published row (eligible board, else the radar list) — its
        // potentialStars is the hype-inflated PERCEIVED ceiling, kept distinct
        // from the profile's grounded `potentialStars` (our scouts' read).
        const analystRow = board.rankings.find((r) => r.playerId === playerId)
          ?? board.radar.find((r) => r.playerId === playerId)
        const rank = analystRow?.eligibility === 'radar' ? undefined : analystRow?.rank
        if (analystRow) profile.analystPotentialStars = analystRow.potentialStars
        // Off the published board, the analysts rate him as an unranked longshot —
        // a LOW ceiling, not his true upside. So a prospect your scouts like reads
        // as you being HIGHER than the board (a sleeper), not "more cautious".
        const ourCeiling = scoutedCeil
        const theirCeiling = analystRow?.perceivedCeiling ?? Math.min(62, ourCeiling - 4)
        const proj = analystProjection({
          name: player.name,
          position: player.position,
          ceiling: theirCeiling,
          eligibility: elig,
          ...(rank !== undefined ? { rank } : {}),
          phaseLabel: board.phaseLabel,
          draftYear: board.draftYear,
        })
        if (proj) profile.analystProjection = proj

        // Your scouts' own read — can diverge from the consensus (more so the
        // deeper the prospect is ranked), driven by intangibles + underlying game
        // + how their grounded ceiling read compares to the board's optimism.
        const read = buildScoutDraftRead({
          player,
          knowledge: profile.scoutReport.knowledge,
          ...(rank !== undefined ? { analystRank: rank } : {}),
          interviews: (this.interviews.get(playerId) ?? []).length,
          scoutsCeiling: ourCeiling,
          scoutsRole: ceilingRoleShort(ourCeiling, player.position),
          analystCeiling: theirCeiling,
          analystRole: ceilingRoleShort(theirCeiling, player.position),
        })
        if (read) profile.scoutDraftRead = { verdict: read.verdict, confidence: read.confidence, blurb: read.blurb }
      }

      // "Shades of …" comp — closest established comparable in the DB.
      const comp = buildPlayerComp({
        prospect: player,
        pool: [...this.data.players.values()],
        knowledge: profile.scoutReport.knowledge,
      })
      if (comp) profile.scoutComp = { names: comp.names, ids: comp.ids, differentiator: comp.differentiator, summary: comp.summary }

      // Season bio write-up — what he's done this season.
      const totals = this.totals.get(pid)
      const sf = this.seasonFormOf(player)
      if (sf.gamesPlayed > 0) {
        const teamName = playerTeamId ? (this.data.teams.get(playerTeamId)?.name ?? '') : ''
        const { leagueLabel, teamIds } = this.leagueContextOf(playerTeamId)
        const finalPhase = this.phase === 'offseason' || this.phase === 'playoffs' || this.draftRankPhase() === 'final'
        const rank = player.position !== 'G' && teamIds.length > 0
          ? this.scoringRankOf(pid, teamIds)
          : undefined
        const bio = buildSeasonBio({
          firstName: player.name.split(' ')[0] ?? player.name,
          position: player.position,
          age: player.age,
          teamName,
          league: leagueLabel,
          gamesPlayed: sf.gamesPlayed,
          goals: totals?.goals ?? 0,
          assists: totals?.assists ?? 0,
          ...(sf.expectedPoints !== undefined ? { expectedPoints: sf.expectedPoints } : {}),
          ...(rank !== undefined ? { leagueScoringRank: rank } : {}),
          ...(player.intlApps !== undefined ? { intlApps: player.intlApps } : {}),
          ...(player.nationality !== undefined ? { nation: player.nationality } : {}),
          final: finalPhase,
        })
        if (bio) profile.seasonBio = bio
      }
    }

    return profile
  }

  /** League label + the set of team ids that make up the player's league
   *  (for season-bio context and same-league scoring ranks). */
  private leagueContextOf(teamId?: TeamId): { leagueLabel: string; teamIds: string[] } {
    if (!teamId) return { leagueLabel: '', teamIds: [] }
    const team = this.data.teams.get(teamId)
    if (!team) return { leagueLabel: '', teamIds: [] }
    for (const c of this.data.league.competitions ?? []) {
      if (c.teamIds.includes(teamId)) {
        return { leagueLabel: c.name || c.abbrev, teamIds: c.teamIds.map((t) => t as string) }
      }
    }
    if (team.tier === 'ahl') {
      const ahl = [...this.data.teams.values()].filter((t) => t.tier === 'ahl').map((t) => t.id as string)
      return { leagueLabel: 'AHL', teamIds: ahl }
    }
    return { leagueLabel: 'NHL', teamIds: this.data.league.teams.map((t) => t as string) }
  }

  /** 1-based points rank of a skater among all rostered skaters in a league. */
  private scoringRankOf(pid: PlayerId, teamIds: string[]): number {
    const idSet = new Set(teamIds)
    const pointsOf = (id: PlayerId): number => {
      const t = this.totals.get(id)
      return (t?.goals ?? 0) + (t?.assists ?? 0)
    }
    const mine = pointsOf(pid)
    let greater = 0
    for (const [tid, team] of this.data.teams) {
      if (!idSet.has(tid as string)) continue
      for (const rid of team.roster) {
        const pl = this.data.players.get(rid)
        if (!pl || pl.position === 'G') continue
        if (pointsOf(rid) > mine) greater++
      }
    }
    return greater + 1
  }

  /** GM asks a player one interview question; records it and sharpens knowledge. */
  /**
   * Schedule a sit-down interview with a player a few days out. It lands on the
   * calendar and resolves into an inbox report (revealing intangibles +
   * sharpening the read) when the day arrives. Returns the scheduled date.
   */
  requestInterview(playerId: string): { ok: boolean; message?: string; dueDate?: string } {
    const pid = asPlayerId(playerId)
    const player = this.data.players.get(pid)
    if (!player) return { ok: false, message: 'Player not found.' }
    if (this.pendingInterviews.some((i) => i.playerId === playerId)) {
      return { ok: false, message: 'An interview with this player is already scheduled.' }
    }
    const asked = this.interviews.get(playerId) ?? []
    if (asked.length >= INTERVIEW_QUESTIONS.length) {
      return { ok: false, message: 'Your staff have already interviewed him thoroughly.' }
    }
    const dueDay = this.currentDay + 4
    this.pendingInterviews.push({ playerId, dueDay, year: this.year })
    return { ok: true, dueDate: dayToDateISO(this.year, dueDay) }
  }

  /** Resolve any interviews whose scheduled day has arrived (called per day). */
  private resolveDueInterviews(day: number): void {
    if (this.pendingInterviews.length === 0) return
    const due = this.pendingInterviews.filter((i) => i.year < this.year || (i.year === this.year && i.dueDay <= day))
    if (due.length === 0) return
    this.pendingInterviews = this.pendingInterviews.filter((i) => !due.includes(i))
    for (const item of due) {
      const pid = asPlayerId(item.playerId)
      const player = this.data.players.get(pid)
      if (!player) continue
      // Ask up to three previously-unasked questions in this sit-down.
      const asked = this.interviews.get(item.playerId) ?? []
      const fresh = INTERVIEW_QUESTIONS.filter((q) => !asked.includes(q.id)).slice(0, 3)
      const answers = fresh
        .map((q) => answerInterviewQuestion(player, q.id))
        .filter((a): a is NonNullable<typeof a> => a !== null)
      for (const q of fresh) asked.push(q.id)
      this.interviews.set(item.playerId, asked)
      addKnowledge(this.scouting, item.playerId, 10)

      const first = player.name.split(' ')[0] ?? player.name
      const reveals = answers.map((a) => a.reveal)
      const summary = reveals.length > 0
        ? `Reads: ${reveals.join(', ')}.`
        : 'Little new ground — the staff already had a strong read.'
      const qa = answers.map((a) => `“${a.prompt}” — ${a.answer} (${a.reveal})`).join('\n\n')
      const body = `Our staff sat down with ${player.name} (${player.position}, age ${player.age}).\n\n${qa}\n\n${summary} The interview sharpens our read and informs where our scouts have him.`
      this.pushNews('scouting', `Interview: ${player.name}`, body, { playerId: item.playerId })
    }
  }

  /** NHL roster + AHL-affiliate player ids (the user's whole organisation). */
  private ownOrgIds(): Set<string> {
    const ids = new Set<string>(this.userTeam.roster.map((id) => id as string))
    const affId = this.userTeam.affiliateId
    const ahl = affId !== undefined ? this.data.teams.get(affId) : undefined
    if (ahl) for (const id of ahl.roster) ids.add(id as string)
    return ids
  }

  /** In-season signals (form/morale/injury/production) for staff opinion. */
  private seasonFormOf(player: Player): SeasonForm {
    const pid = player.id as PlayerId
    const t = this.totals.get(pid)
    const points = (t?.goals ?? 0) + (t?.assists ?? 0)
    const gp = this.gp.get(pid) ?? 0
    const expected = player.position !== 'G'
      ? expectedPointsFor(overall(player.composites, player.position), player.position, player.role)
      : undefined
    return {
      form: player.form,
      morale: player.morale,
      injured: player.injuryStatus !== null,
      gamesPlayed: gp,
      points,
      ...(expected !== undefined ? { expectedPoints: expected } : {}),
    }
  }

  /**
   * GM requests written reports from the coaching staff on one of his players.
   * Each coach (head coach + assistants) files a report into the inbox, with a
   * take that reflects the player's current form and production this season.
   */
  requestCoachReports(playerId: string): { ok: boolean; message?: string } {
    const pid = asPlayerId(playerId)
    const player = this.data.players.get(pid)
    if (!player) return { ok: false, message: 'Player not found.' }

    // Coaches only assess players in your own organisation (NHL + AHL affiliate).
    const affId = this.userTeam.affiliateId
    const inOrg = this.userTeam.roster.includes(pid) ||
      (affId !== undefined && (this.data.teams.get(affId)?.roster.includes(pid) ?? false))
    if (!inOrg) {
      return { ok: false, message: 'Your coaches only report on players in your organisation.' }
    }

    const staff = this.getTeamStaff(this.userTeamId as string)
    const coachList = [staff.headCoach, ...staff.assistantCoaches.slice(0, 2)]
    const reports = buildCoachReports(
      player,
      coachList.map((c) => ({
        name: c.name,
        role: c.role,
        judgment: c.judgment,
        ...(c.faceId !== undefined ? { faceId: c.faceId } : {}),
        ...(c.demeanor !== undefined ? { demeanor: c.demeanor } : {}),
      })),
      this.seasonFormOf(player),
    )

    const lastName = player.name.split(' ').slice(-1)[0] ?? player.name
    for (const r of reports) {
      this.pushNews('scouting', `${r.coachName} files his report on ${lastName}`, r.text, {
        playerId,
        speaker: r.coachName,
        ...(r.faceId !== undefined ? { speakerFaceId: r.faceId } : {}),
      })
    }
    return { ok: true }
  }

  /* ────────────────────── club legends ("where are they now") ────────────────────── */

  private static readonly LEGENDS_PER_CLUB = 30

  /** Record a notable retiree into his last club's legends registry. */
  private recordLegend(teamId: TeamId, p: Player, ovr: number, seasonsPlayed: number): void {
    const list = this.legends.get(teamId) ?? []
    if (list.some((l) => l.playerId === (p.id as unknown as string))) return
    const tier = ovr >= 88 ? 'franchise icon' : ovr >= 82 ? 'star' : seasonsPlayed >= 12 ? 'long-serving veteran' : 'fan favourite'
    const blurb = `A ${tier} — ${seasonsPlayed} season${seasonsPlayed === 1 ? '' : 's'}, peak rating ${ovr}.`
    const legend: ClubLegend = {
      playerId: p.id as unknown as string,
      name: p.name,
      position: p.position,
      retiredYear: this.year,
      peakOverall: ovr,
      blurb,
      status: 'Retired',
      ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
    }
    list.unshift(legend)
    if (list.length > Career.LEGENDS_PER_CLUB) list.length = Career.LEGENDS_PER_CLUB
    this.legends.set(teamId, list)
  }

  /** Update a legend's "where are they now" status (e.g. moved into staff). */
  private updateLegendStatus(playerId: string, status: string): void {
    for (const list of this.legends.values()) {
      const entry = list.find((l) => l.playerId === playerId)
      if (entry) { entry.status = status; return }
    }
  }

  /**
   * GM suggests a tactical direction to the head coach in a staff meeting. The
   * coach decides (by knowledge/demeanour + roster fit) whether to adopt it.
   * Tactics only change when the coach accepts — keeps default sims unchanged.
   */
  suggestToCoach(direction: string): { accepted: boolean; response: string } {
    const team = this.data.teams.get(this.userTeamId)
    if (!team) return { accepted: false, response: 'No team.' }
    const coach = this.getTeamStaff(this.userTeamId as string).headCoach
    const roster = team.roster.map((id) => this.resolve(id))
    const evalResult = evaluateCoachSuggestion({
      coach,
      roster,
      tactics: team.tactics,
      direction: direction as SuggestionDirection,
    })
    if (evalResult.accepted && evalResult.newTactics) {
      team.tactics = evalResult.newTactics
    }
    return { accepted: evalResult.accepted, response: evalResult.response }
  }

  /* ────────────────────── staff-meeting agenda ────────────────────── */

  /** Mark a player topic for discussion at the next staff meeting. */
  markForMeeting(playerId: string, topic: string): { ok: boolean; message?: string } {
    const p = this.data.players.get(asPlayerId(playerId))
    if (!p) return { ok: false, message: 'Player not found.' }
    if (!PLAYER_TOPICS.some((t) => t.id === topic)) return { ok: false, message: 'Unknown topic.' }
    const t = topic as AgendaTopic
    if (this.agenda.some((a) => a.playerId === playerId && a.topic === t)) {
      return { ok: false, message: 'Already on the agenda.' }
    }
    this.agenda.push({
      id: `ag${this.agendaCounter++}`,
      playerId,
      playerName: p.name,
      topic: t,
      label: agendaLabel(p.name, t),
      day: this.currentDay,
      year: this.year,
    })
    return { ok: true }
  }

  /** Current staff-meeting agenda. */
  getAgenda(): AgendaItem[] {
    return this.agenda.map((a) => ({ ...a }))
  }

  /** Discuss an agenda item: the relevant staff member gives an opinion; item is cleared. */
  discussAgendaItem(itemId: string): { ok: boolean; message?: string; result?: DiscussionResult } {
    const idx = this.agenda.findIndex((a) => a.id === itemId)
    if (idx < 0) return { ok: false, message: 'That item is no longer on the agenda.' }
    const item = this.agenda[idx]!
    const p = this.data.players.get(asPlayerId(item.playerId))
    if (!p) { this.agenda.splice(idx, 1); return { ok: false, message: 'Player no longer available.' } }
    const result = discussPlayerTopic({
      player: p,
      topic: item.topic,
      staff: this.getTeamStaff(this.userTeamId as string),
    })
    this.agenda.splice(idx, 1)
    return { ok: true, result }
  }

  /** FM-style squad-dynamics view for a club (hierarchy / social groups / happiness). */
  getTeamDynamics(teamId: string): TeamDynamicsView {
    const tid = asTeamId(teamId)
    const team = this.data.teams.get(tid)
    const roster = team ? team.roster.map((id) => this.resolve(id)) : []
    const lr = this.lockerRooms.get(tid) ?? null
    const coach = this.getTeamStaff(teamId).headCoach
    return buildTeamDynamics({
      teamId,
      teamName: team?.name ?? teamId,
      roster,
      lockerRoom: lr,
      headCoachName: coach.name,
      ...(coach.faceId !== undefined ? { headCoachFaceId: coach.faceId } : {}),
    })
  }

  /** Medical Center: condition / fatigue / injury / injury-risk for the user roster. */
  getMedical(): MedicalView {
    const team = this.data.teams.get(this.userTeamId)
    const rows: MedicalRow[] = []
    let injuredCount = 0
    for (const id of team?.roster ?? []) {
      const p = this.data.players.get(id)
      if (!p) continue
      const fatigue = Math.round(Math.max(0, Math.min(100, p.fatigue)))
      const condition = 100 - fatigue
      const proneness = p.injuryProneness ?? 30
      // Risk blends durability tendency with current fatigue; injured = max.
      const injured = p.injuryStatus !== null
      if (injured) injuredCount++
      const risk = injured ? 100 : Math.round(Math.max(0, Math.min(100, proneness * 0.55 + fatigue * 0.45)))
      const riskLabel: MedicalRow['riskLabel'] = risk >= 60 ? 'High' : risk >= 33 ? 'Increased' : 'Low'
      const row: MedicalRow = {
        playerId: id as unknown as string,
        name: p.name,
        position: p.position,
        condition,
        fatigue,
        riskLabel,
        risk,
        ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
        ...(p.injuryStatus ? { injuryDescription: p.injuryStatus.description, injuryGamesRemaining: p.injuryStatus.gamesRemaining, injuryKind: p.injuryStatus.kind } : {}),
      }
      rows.push(row)
    }
    // Most at-risk / injured first.
    rows.sort((a, b) => b.risk - a.risk)
    return { teamName: team?.name ?? 'Team', injuredCount, rows }
  }

  /** Development Center: the org's young / high-upside players (NHL + AHL). */
  getDevelopment(): DevelopmentCenterView {
    const team = this.data.teams.get(this.userTeamId)
    const roster = (team?.roster ?? []).map((id) => this.resolve(id))
    const affiliateId = this.userTeam.affiliateId
    const ahlTeam = affiliateId ? this.data.teams.get(affiliateId as TeamId) : undefined
    const affiliate = (ahlTeam?.roster ?? [])
      .map((id) => this.data.players.get(id))
      .filter((p): p is Player => p !== undefined)
    const stars = (p: Player): [number, number] => [
      overallToStars(ratedOverall(p)),
      potentialStars(p),
    ]
    return buildDevelopmentCenter({
      teamName: team?.name ?? 'Team',
      roster,
      affiliate,
      stars,
    })
  }

  /** Squad Planner: experience matrix + depth/age/contract report for the user club. */
  getSquadPlanner(): SquadPlannerView {
    const team = this.data.teams.get(this.userTeamId)
    const roster = (team?.roster ?? []).map((id) => this.resolve(id))
    return buildSquadPlanner({ teamName: team?.name ?? 'Team', roster })
  }

  /** Legends registry for a club, most recent first. */
  getTeamLegends(teamId: string): TeamLegendsView {
    const tid = asTeamId(teamId)
    const team = this.data.teams.get(tid)
    return {
      teamId,
      teamName: team?.name ?? teamId,
      legends: (this.legends.get(tid) ?? []).map((l) => structuredClone(l)),
    }
  }

  /** Radar comparison view for two players (used by the Phase C compare UI). */
  compareRadar(playerIdA: string, playerIdB: string): CompareRadarView {
    return buildCompareRadar(this.ctx(), playerIdA, playerIdB)
  }

  /** Leagues the scouting engine can target — synthetic NHL + AHL + every
   *  feeder/international competition, each with its host nation and teams. */
  private scoutingCompetitions(): ScoutingCompetition[] {
    const out: ScoutingCompetition[] = []
    out.push({ id: 'nhl', nation: 'North America', teamIds: this.data.league.teams.map((id) => id as string) })
    const comps = this.data.league.competitions ?? []
    const hasAhlComp = comps.some((c) => c.abbrev === 'AHL')
    if (!hasAhlComp && this.data.league.ahlTeams?.length) {
      out.push({ id: 'ahl', nation: 'North America', teamIds: this.data.league.ahlTeams.map((id) => id as string) })
    }
    for (const c of comps) {
      out.push({ id: c.id, nation: c.nation, teamIds: c.teamIds.map((id) => id as string) })
    }
    return out
  }

  /** The user's next scheduled opponent (regular season or playoffs), or null. */
  private nextOpponentTeamId(): string | null {
    const sched = this.data.league.schedule.find(
      (g) => !g.result && (g.homeTeamId === this.userTeamId || g.awayTeamId === this.userTeamId)
    )
    if (!sched) return null
    return (sched.homeTeamId === this.userTeamId ? sched.awayTeamId : sched.homeTeamId) as string
  }

  /** Daily pass: surface newly-discovered prospects into the Scouting Centre.
   *  A player is evaluated once, the first time his knowledge crosses the
   *  discovery threshold during play — so the list starts empty and fills up. */
  private surfaceScoutFinds(day: number): void {
    const st = this.scouting
    if (!st.recommendations) st.recommendations = []
    if (!st.seen) st.seen = []
    // `seen` = players we will NOT surface (known at start, our own org, or
    // evaluated-and-rejected). Players we ACCEPT live in `recommendations`, not
    // `seen`, so the cap below can never permanently bury an accepted find.
    const seen = new Set(st.seen)
    const recIds = new Set(st.recommendations.map((r) => r.playerId))
    const own = this.ownOrgIds()
    let added = false
    for (const [pid, k] of st.knowledge) {
      if (k < DISCOVERY_THRESHOLD || seen.has(pid) || recIds.has(pid)) continue
      if (own.has(pid)) { seen.add(pid); continue } // don't "discover" our own org
      const p = this.data.players.get(asPlayerId(pid))
      if (!p) { seen.add(pid); continue }
      const rec = this.evaluateForRecommendation(p, day)
      if (rec) { st.recommendations.push(rec); recIds.add(pid); added = true }
      else seen.add(pid)
    }
    if (added) {
      const rank = { 'A+': 0, A: 1, B: 2, C: 3 } as const
      st.recommendations.sort((a, b) => rank[a.grade] - rank[b.grade])
      // Cap generously; dropped finds are NOT marked seen, so they can return.
      if (st.recommendations.length > 120) st.recommendations.length = 120
    }
    st.seen = [...seen]
  }

  /** Decide whether a freshly-known player is worth flagging — primarily youth
   *  prospects with real upside, plus clearly-undervalued young players. Returns
   *  the recommendation (and fires an inbox note) or null. */
  private evaluateForRecommendation(p: Player, day: number): ScoutRecommendation | null {
    if (p.age > YOUTH_MAX_AGE) return null
    const elig = draftEligibility(p.age, !!p.nhlDrafted)
    const evalRes = this.prospectEval(p, this.leagueAbbrevForPlayer(p), this.analystProjectionNoise())
    // Grade the find on OUR scouts' (fog-aware) ceiling read — the same number the
    // profile/grade and the find card show — so a flagged player is one our staff
    // actually rates, and the grade can't contradict his displayed potential.
    const ourCeiling = this.scoutedCeilingOf(p)
    const potStars = overallToStars(ourCeiling)
    // The public board's read, to spot genuine sleepers (we see more than the book).
    const analystPerceived = perceivedCeiling(agedPotential(p), p.age, evalRes.premium)
    // Absolute quality floor: only flag prospects who project as a genuine NHL
    // player (≥3★ = bottom-six / 3rd-pair regular). An AHL/fringe ceiling is never
    // "one to watch", no matter how he's trending.
    if (potStars < 3) return null
    const highCeiling = potStars >= 3.5                 // middle-six / 2nd-pair and up
    const sleeper = ourCeiling - analystPerceived >= 5  // our read sits above the book
    if (!highCeiling && !sleeper) return null

    // Respect the covering scout's recruitment-focus bar — he won't bother
    // flagging a prospect below the minimum potential the GM set for him.
    const scout = this.scoutCovering(p)
    if (scout && potStars < scout.minPotentialStars) return null

    const role = ceilingRoleShort(ourCeiling, p.position)
    const grade: ScoutRecommendation['grade'] = potStars >= 4.5 ? 'A+' : potStars >= 4 ? 'A' : potStars >= 3 ? 'B' : 'C'
    const reason =
      sleeper ? `Undervalued — our scout sees a ${role} ceiling the book is missing.`
      : `${elig ? 'High-upside draft prospect' : 'High-upside prospect'} — projects as a ${role}.`
    const scoutName = scout?.name ?? 'Your scouts'
    const foundDate = dayToDateISO(this.year, day)

    this.pushNews('scouting', `Scout report: ${p.name}`,
      `${scoutName} flagged ${p.name} (${p.age}, ${p.position}) as one to watch — ${reason} Open the Scouting Centre for the full report.`,
      { playerId: p.id as string })
    return { playerId: p.id as string, ...(scout ? { scoutId: scout.scoutId } : {}), scoutName, foundDate, reason, grade }
  }

  /** The scout whose current assignment scope+focus+position covers this player. */
  private scoutCovering(p: Player): { scoutId: string; name: string; minPotentialStars: number } | null {
    const comps = this.scoutingCompetitions()
    const pid = p.id as string
    const teamOfPlayer = [...this.data.teams.values()].find((t) => t.roster.includes(p.id as PlayerId))
    const tid = teamOfPlayer ? (teamOfPlayer.id as string) : null
    const nationOf = (cid: string): string | undefined => comps.find((c) => c.id === cid)?.nation
    const oppId = this.nextOpponentTeamId()
    const faIds = this.currentFaIds()
    const matchesFocus = (focus: ScoutFocus | undefined): boolean => {
      if (!focus || focus === 'all') return true
      const youth = p.age <= YOUTH_MAX_AGE
      return focus === 'youth' ? youth : !youth
    }
    const pos = p.position as string
    const isG = pos === 'G', isD = pos === 'D' || pos === 'LD' || pos === 'RD'
    const matchesPosition = (f: 'any' | 'F' | 'D' | 'G' | undefined): boolean =>
      !f || f === 'any' ? true : f === 'G' ? isG : f === 'D' ? isD : (!isG && !isD)
    for (const s of this.scouting.assignments) {
      const t = s.target
      let inScope = false
      if (t.kind === 'player') inScope = t.playerId === pid
      else if (t.kind === 'draftClass') inScope = !!draftEligibility(p.age, !!p.nhlDrafted)
      else if (t.kind === 'freeAgents') inScope = faIds.has(pid)
      else if (t.kind === 'nextOpponent') inScope = !!tid && tid === oppId
      else if (tid && t.kind === 'team') inScope = t.teamId === tid
      else if (tid && t.kind === 'competition') { const c = comps.find((x) => x.id === t.competitionId); inScope = !!c?.teamIds.includes(tid) }
      else if (tid && t.kind === 'nation') { const c = comps.find((x) => x.teamIds.includes(tid)); inScope = !!c && nationOf(c.id) === t.nation }
      if (inScope && matchesFocus(s.focus) && matchesPosition(s.positionFilter)) {
        return { scoutId: s.scoutId, name: s.name, minPotentialStars: s.minPotentialStars ?? 0 }
      }
    }
    return null
  }

  /** Best-guess league abbreviation for a player, for NHLe-based projection. */
  private leagueAbbrevForPlayer(p: Player): string {
    const team = [...this.data.teams.values()].find((t) => t.roster.includes(p.id as PlayerId))
    if (!team) return 'NHL'
    const tid = team.id as string
    if (this.data.league.teams.some((id) => id as string === tid)) return 'NHL'
    const comp = (this.data.league.competitions ?? []).find((c) => c.teamIds.some((id) => id as string === tid))
    return comp?.abbrev ?? 'NHL'
  }

  /** Max scouts the club will carry (soft cap for the Job Market). */
  private maxScouts(): number {
    return Math.max(12, this.userScoutStaff().length)
  }

  /** The user club's staff scouts — the deployable scouting roster. */
  private userScoutStaff(): StaffMember[] {
    return this.getTeamStaff(this.userTeamId as string).scouts
  }

  /** Keep the deployable assignment roster in lock-step with the staff scouts,
   *  so every hired scout (incl. imported ones) is assignable. */
  private syncScoutRoster(): void {
    const nations = SCOUT_SPECIALTY_NATIONS as readonly string[]
    syncAssignmentsToScouts(this.scouting, this.userScoutStaff().map((s) => ({
      id: s.id,
      name: s.name,
      rating: s.rating,
      judgment: s.judgment,
      ...(s.specialty && nations.includes(s.specialty) ? { specialtyNation: s.specialty } : {}),
      salary: scoutSalary(s.rating),
    })))
  }

  getScouting(): ScoutingView {
    this.syncScoutRoster()
    return buildScoutingView({
      ...this.ctx(),
      scouting: this.scouting,
      draftProspectIds: this.allDraftProspectIds(),
      competitions: this.scoutingCompetitions(),
      competitionMeta: (this.data.league.competitions ?? []).map((c) => ({ id: c.id, name: c.name, abbrev: c.abbrev, nation: c.nation })),
      nextOpponentId: this.nextOpponentTeamId(),
      maxScouts: this.maxScouts(),
      scoutMarket: generateScoutCandidates(this.rngFor(7720), 6).filter(
        (c) => !this.scouting.assignments.some((s) => s.scoutId === c.id)
      ),
    })
  }

  assignScoutTarget(
    scoutId: string, target: ScoutTarget, focus?: ScoutFocus,
    positionFilter?: 'any' | 'F' | 'D' | 'G', minPotentialStars?: number,
  ): void {
    assignScout(this.scouting, scoutId, target, focus, {
      ...(positionFilter !== undefined ? { positionFilter } : {}),
      ...(minPotentialStars !== undefined ? { minPotentialStars } : {}),
    })
  }

  /** Hire a scout from the market — joins the club's staff and becomes deployable. */
  hireScoutFromMarket(candidateId: string): { ok: boolean; message?: string } {
    if (this.userScoutStaff().length >= this.maxScouts()) {
      return { ok: false, message: `Your scouting department is full (max ${this.maxScouts()} scouts).` }
    }
    const cand = generateScoutCandidates(this.rngFor(7720), 6).find((c) => c.id === candidateId)
    if (!cand || this.userScoutStaff().some((s) => s.id === candidateId)) {
      return { ok: false, message: 'That scout is no longer available.' }
    }
    this.userScoutStaff().push({
      id: cand.id,
      name: cand.name,
      role: 'scout',
      rating: cand.rating,
      judgment: cand.judgment,
      ...(cand.specialtyNation ? { specialty: cand.specialtyNation } : {}),
      demeanor: 'analytical',
    })
    this.syncScoutRoster()
    this.pushNews('scouting', `Hired ${cand.name} as a scout`,
      `${cand.name} joins the scouting department${cand.specialtyNation ? ` (specialises in ${cand.specialtyNation})` : ''}. Assign him a region or league from the Scouting screen.`,
      {})
    return { ok: true }
  }

  /** Resolve a scout's assignment scope to the player ids it covers. */
  private resolveScopeIds(target: ScoutTarget): string[] {
    const comps = this.scoutingCompetitions()
    const rostersOf = (teamIds: Iterable<string>): string[] => {
      const out: string[] = []
      for (const tid of teamIds) { const t = this.data.teams.get(tid as TeamId); if (t) for (const id of t.roster) out.push(id as string) }
      return out
    }
    switch (target.kind) {
      case 'team': return rostersOf([target.teamId])
      case 'division': {
        const ids: string[] = []
        for (const [tid, t] of this.data.teams) if ((t as { divisionId?: string }).divisionId === target.divisionId) ids.push(...rostersOf([tid as string]))
        return ids
      }
      case 'competition': { const c = comps.find((x) => x.id === target.competitionId); return c ? rostersOf(c.teamIds) : [] }
      case 'nation': { const set = new Set<string>(); for (const c of comps) if (c.nation === target.nation) for (const t of c.teamIds) set.add(t); return rostersOf(set) }
      case 'player': return [target.playerId]
      case 'nextOpponent': { const opp = this.nextOpponentTeamId(); return opp ? rostersOf([opp]) : [] }
      case 'draftClass': return [...this.allDraftProspectIds()]
      case 'freeAgents': return [...this.currentFaIds()]
      default: return []
    }
  }

  /** Full profile for one of the club's scouts (attributes, assignment, intel). */
  getScoutProfile(scoutId: string): import('./views').ScoutProfileView | null {
    this.syncScoutRoster()
    const staff = this.userScoutStaff().find((s) => s.id === scoutId)
    const asg = this.scouting.assignments.find((a) => a.scoutId === scoutId)
    if (!staff || !asg) return null
    const card = this.getScouting().scouts.find((s) => s.scoutId === scoutId)

    const a = staff.attributes ?? {}
    const ATTR: Array<[keyof typeof a, string]> = [
      ['judgingPlayers', 'Judging Ability'], ['judgingPotential', 'Judging Potential'],
      ['tactics', 'Tactical Knowledge'], ['developingYoungsters', 'Working w/ Youth'],
      ['patience', 'Patience'], ['discipline', 'Discipline'],
      ['manManagement', 'Man Management'], ['motivating', 'Determination'],
    ]
    const attributes = ATTR
      .filter(([k]) => typeof a[k] === 'number')
      .map(([k, label]) => ({ label, value: a[k] as number }))

    // The full, real history of every player THIS scout has personally watched —
    // not the current-scope aggregate (which made one in-scope name show up on
    // every scout's list). The client filters/sorts this list.
    const teamByPlayer = new Map<string, { abbr: string }>()
    for (const t of this.data.teams.values()) for (const id of t.roster) teamByPlayer.set(id as string, { abbr: t.abbreviation })
    const scouted = playersSeenByScout(this.scouting, scoutId)
      .map((id) => ({ id, k: knowledgeOf(this.scouting, id) }))
      .sort((x, y) => y.k - x.k)
      .map(({ id, k }) => {
        const p = this.data.players.get(asPlayerId(id))
        if (!p) return null
        return {
          playerId: id, name: p.name, position: p.position, age: p.age,
          teamAbbr: teamByPlayer.get(id)?.abbr ?? 'FA',
          ...(p.nationality !== undefined ? { nationality: p.nationality } : {}),
          knowledge: Math.round(k),
          currentStars: overallToStars(ratedOverall(p)),
          potentialStars: overallToStars(this.scoutedCeilingOf(p)),
          ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)

    const finds = (this.scouting.recommendations ?? [])
      .filter((r) => (r.scoutId ? r.scoutId === scoutId : r.scoutName === staff.name))
      .map((r) => ({ playerId: r.playerId, name: this.data.players.get(asPlayerId(r.playerId))?.name ?? '—', grade: r.grade, reason: r.reason, foundDate: r.foundDate }))

    return {
      scoutId,
      name: staff.name,
      ...(staff.faceId !== undefined ? { faceId: staff.faceId } : {}),
      rating: staff.rating,
      judgment: staff.judgment,
      ...(asg.specialtyNation ? { specialtyNation: asg.specialtyNation } : {}),
      ...(asg.salary !== undefined ? { salary: asg.salary } : {}),
      ...(staff.demeanor ? { demeanor: staff.demeanor } : {}),
      attributes,
      assignmentLabel: card?.assignmentLabel ?? '—',
      focusLabel: card?.focusLabel ?? 'All players',
      coverage: card?.coverage ?? scopeIds.length,
      scouted,
      finds,
    }
  }

  /** Release a scout from the club's staff. */
  fireScoutFromStaff(scoutId: string): { ok: boolean; message?: string } {
    const staff = this.userScoutStaff()
    if (staff.length <= 1) return { ok: false, message: 'You must keep at least one scout.' }
    const i = staff.findIndex((s) => s.id === scoutId)
    if (i < 0) return { ok: false, message: 'No such scout.' }
    staff.splice(i, 1)
    this.scouting.assignments = this.scouting.assignments.filter((s) => s.scoutId !== scoutId)
    this.syncScoutRoster()
    return { ok: true }
  }

  getTactics(): TacticsView {
    return buildTacticsView(this.ctx())
  }

  /**
   * Ask the head coach to set the full lineup.
   * Returns a LinesView shaped exactly like getTactics().lines but built by
   * the coach (not the saved team.lines). The result is NOT persisted — the
   * caller (UI) loads it into the editable draft.
   */
  coachSetLines(): TacticsView['lines'] {
    if (!this.staff) {
      this.staff = generateStaff({ rng: new Rng(deriveSeed(this.seed, 9200)) })
    }
    const coach = this.staff.headCoach
    const roster = this.userTeam.roster.map((id) => this.resolve(id))
    // Use a seed derived from the career seed + coach id + current year so the
    // result is stable within a save but changes when the coach changes.
    const coachSeed = deriveSeed(this.seed, 7700, this.year)
    const rng = new Rng(coachSeed)
    const result = coachSetLineup({ roster, coach, rng })

    // Snapshot the temp lines into the view via buildTacticsView on a temporary
    // Team shell — reuse the existing view builder (handles slot labels, badges,
    // scratches, issues, synergies etc.)
    const tempTeam = { ...this.userTeam, lines: result.lines }
    const ctx = { ...this.ctx(), teams: new Map(this.ctx().teams).set(this.userTeamId, tempTeam as typeof this.userTeam) }
    return buildTacticsView(ctx).lines
  }

  getSchedule(): ScheduleView {
    return buildScheduleView(this.ctx())
  }

  /* ── Team-browser getters (task #31: EHM-style team-nav arrows) ── */

  /** All NHL teams (standings order) + their AHL affiliates. */
  getLeagueTeams(): LeagueTeamsView {
    const standingsSorted = sortStandings([...this.standings.values()])
    const nhlRows = standingsSorted.map((s) => {
      const t = this.data.teams.get(s.teamId)!
      return {
        teamId: t.id as string,
        name: t.name,
        abbreviation: t.abbreviation,
        tier: ('nhl' as const),
        points: s.points,
        colors: t.colors,
        ...(t.affiliateId ? { affiliateId: t.affiliateId as string } : {}),
      }
    })
    const ahlTeams = (this.data.league.ahlTeams ?? [])
      .map((id) => this.data.teams.get(id))
      .filter((t): t is NonNullable<typeof t> => t !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name))
    const ahlRows = ahlTeams.map((t) => ({
      teamId: t.id as string,
      name: t.name,
      abbreviation: t.abbreviation,
      tier: ('ahl' as const),
      points: 0,
      colors: t.colors,
      ...(t.parentTeamId ? { affiliateId: t.parentTeamId as string } : {}),
    }))
    return { nhl: nhlRows, ahl: ahlRows }
  }

  /** Squad for any team (read-only; no scratches/ratings for non-user teams). */
  getSquadFor(teamId: string): SquadView {
    const tid = asTeamId(teamId)
    const isUserTeam = tid === this.userTeamId
    if (isUserTeam) return this.getSquad()
    // For other teams: build a ctx with the target team as "user" so buildSquadView works.
    const ctx = { ...this.ctx(), userTeamId: tid }
    return buildSquadView(ctx)
  }

  /** Schedule for any team. */
  getScheduleFor(teamId: string): ScheduleView {
    const tid = asTeamId(teamId)
    if (tid === this.userTeamId) return this.getSchedule()
    // Use AHL schedule if the team is an AHL affiliate.
    const team = this.data.teams.get(tid)
    const schedule =
      team?.tier === 'ahl' && this.data.league.ahlSchedule
        ? this.data.league.ahlSchedule
        : this.data.league.schedule
    const ctx = { ...this.ctx(), userTeamId: tid, schedule }
    return buildScheduleView(ctx)
  }

  getCalendarView(): CalendarView {
    const lastMatchDay = this.matchDays[this.matchDays.length - 1] ?? 0
    // Playoffs begin the day after the regular season ends (same convention as
    // the career phase machine, which flips to 'playoffs' after the last match day).
    const playoffsStartDay = this.phase !== 'regularSeason' || lastMatchDay > 0
      ? lastMatchDay + 1
      : null
    const ctx: CalendarCtx = {
      ...this.ctx(),
      deadlineDay: this.deadlineDay,
      playoffsStartDay,
      interviewDates: this.pendingInterviews.map((i) => ({
        dateISO: dayToDateISO(i.year, i.dueDay),
        label: `Interview: ${this.data.players.get(asPlayerId(i.playerId))?.name ?? 'Player'}`,
      })),
    }
    return buildCalendarView(ctx)
  }

  getStandings(): StandingsView {
    return buildStandingsView(this.ctx())
  }

  /** The wider-world competitions: standings, leaders, strength ranking, and
   *  notable players + prospects per league (#95). */
  getCompetitions(): CompetitionsView {
    const comps = this.data.league.competitions ?? []
    // Strength ranking across all world competitions (1 = strongest).
    const rankById = new Map<string, number>()
    ;[...comps]
      .sort((a, b) => b.strength - a.strength)
      .forEach((c, i) => rankById.set(c.id, i + 1))
    const out: CompetitionView[] = comps.map((c) => {
      // playerId -> { teamId, abbreviation }, for scorer/notable rows.
      const teamAbbrByPlayer = new Map<string, string>()
      const teamIdByPlayer = new Map<string, string>()
      for (const tid of c.teamIds) {
        const t = this.data.teams.get(tid)
        if (!t) continue
        for (const pid of t.roster) {
          teamAbbrByPlayer.set(pid as string, t.abbreviation)
          teamIdByPlayer.set(pid as string, t.id as string)
        }
      }
      const standings: CompetitionStandingRowView[] = sortStandings([...c.standings]).map((s) => {
        const t = this.data.teams.get(s.teamId)
        return {
          teamId: s.teamId as string,
          abbreviation: t?.abbreviation ?? '?',
          name: t?.name ?? '?',
          gamesPlayed: s.gamesPlayed,
          wins: s.wins,
          losses: s.losses,
          overtimeLosses: s.overtimeLosses,
          points: s.points,
          goalsFor: s.goalsFor,
          goalsAgainst: s.goalsAgainst,
          colors: t?.colors ?? { primary: 0x888888, secondary: 0xcccccc },
        }
      })
      const scorers: CompetitionScorerRowView[] = [...this.worldSim.totals.entries()]
        .filter(([pid]) => teamAbbrByPlayer.has(pid as string))
        .map(([pid, st]) => {
          const p = this.data.players.get(pid)
          return {
            playerId: pid as string,
            name: p?.name ?? '?',
            teamId: teamIdByPlayer.get(pid as string) ?? '',
            teamAbbr: teamAbbrByPlayer.get(pid as string) ?? '?',
            gamesPlayed: this.worldSim.gp.get(pid) ?? 0,
            goals: st.goals,
            assists: st.assists,
            points: st.goals + st.assists,
          }
        })
        .sort((a, b) => b.points - a.points || b.goals - a.goals)
        .slice(0, 10)
      // Notable players + prospects from the league's rosters.
      const pool: Player[] = []
      for (const tid of c.teamIds) {
        const t = this.data.teams.get(tid)
        if (!t) continue
        for (const pid of t.roster) {
          const p = this.data.players.get(pid)
          if (p) pool.push(p)
        }
      }
      const toNotable = (p: Player): CompetitionNotableView => ({
        playerId: p.id as string,
        name: p.name,
        teamId: teamIdByPlayer.get(p.id as string) ?? '',
        teamAbbr: teamAbbrByPlayer.get(p.id as string) ?? '?',
        position: p.position,
        age: p.age,
        currentStars: overallToStars(ratedOverall(p)),
        potentialStars: overallToStars(this.scoutedCeilingOf(p)),
      })
      const notables = [...pool]
        .sort((a, b) => ratedOverall(b) - ratedOverall(a))
        .slice(0, 8)
        .map(toNotable)
      const prospects = pool
        .filter((p) => p.age <= 22)
        .sort((a, b) => agedPotential(b) - agedPotential(a))
        .slice(0, 8)
        .map(toNotable)
      return {
        id: c.id,
        name: c.name,
        abbrev: c.abbrev,
        nation: c.nation,
        tier: c.tier,
        strength: c.strength,
        strengthRank: rankById.get(c.id) ?? 0,
        teamCount: c.teamIds.length,
        playerCount: pool.length,
        standings,
        scorers,
        notables,
        prospects,
      }
    })
    return { competitions: out }
  }

  /** International: national-team power rankings + best players per nation (#95).
   *  Pools every player by nationality across the whole world DB. */
  getInternational(): InternationalView {
    const MIN_PLAYERS = 12 // a "hockey nation" needs a real player pool
    const ROSTER = 23 // national-team size for the strength rating
    const comps = this.data.league.competitions ?? []

    // playerId -> team for the notable rows.
    const teamOfPlayer = new Map<string, { teamId: string; abbr: string }>()
    for (const t of this.data.teams.values()) {
      for (const pid of t.roster) teamOfPlayer.set(pid as string, { teamId: t.id as string, abbr: t.abbreviation })
    }

    const byNation = new Map<string, Player[]>()
    for (const p of this.data.players.values()) {
      const nat = (p.nationality ?? '').trim()
      if (!nat || nat === '[None]') continue
      let list = byNation.get(nat)
      if (!list) { list = []; byNation.set(nat, list) }
      list.push(p)
    }

    // Competitions grouped by host nation (for the nation page's leagues/clubs).
    const compsByNation = new Map<string, typeof comps>()
    for (const c of comps) {
      let arr = compsByNation.get(c.nation)
      if (!arr) { arr = []; compsByNation.set(c.nation, arr) }
      arr.push(c)
    }

    const toNotable = (p: Player): CompetitionNotableView => {
      const tm = teamOfPlayer.get(p.id as string)
      return {
        playerId: p.id as string,
        name: p.name,
        teamId: tm?.teamId ?? '',
        teamAbbr: tm?.abbr ?? 'FA',
        position: p.position,
        age: p.age,
        currentStars: overallToStars(ratedOverall(p)),
        potentialStars: overallToStars(this.scoutedCeilingOf(p)),
      }
    }

    const nations: NationView[] = []
    for (const [nation, players] of byNation) {
      if (players.length < MIN_PLAYERS) continue
      const sorted = [...players].sort((a, b) => ratedOverall(b) - ratedOverall(a))
      const best = sorted.slice(0, ROSTER)
      const rating = Math.round(best.reduce((s, p) => s + ratedOverall(p), 0) / best.length)
      const topPlayers = sorted.slice(0, 10).map(toNotable)
      const topYouth = sorted
        .filter((p) => p.age <= 18)
        .sort((a, b) => agedPotential(b) - agedPotential(a))
        .slice(0, 8)
        .map(toNotable)
      const seniorSquad = selectNationalTeam(players).map((pick) => toNotable(pick.player))
      const u20Squad = selectNationalTeam(players, { maxAge: 19 }).map((pick) => toNotable(pick.player))
      const info = nationInfo(nation)
      const nationComps = [...(compsByNation.get(nation) ?? [])].sort((a, b) => b.strength - a.strength)
      const topLeagues = nationComps.map((c) => ({
        id: c.id, abbrev: c.abbrev, name: c.name, level: c.level, strength: c.strength,
      }))
      const majorClubs = nationComps
        .flatMap((c) => c.teamIds.map((tid) => ({ tid, leagueAbbr: c.abbrev })))
        .map(({ tid, leagueAbbr }) => {
          const t = this.data.teams.get(tid)
          return t ? { teamId: t.id as string, abbreviation: t.abbreviation, name: t.name, leagueAbbr } : null
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .slice(0, 10)
      nations.push({
        nation, rank: 0, rating, playerCount: players.length,
        capital: info.capital, continent: info.continent, languages: info.languages,
        topLeagues, majorClubs, topPlayers, topYouth, seniorSquad, u20Squad,
      })
    }
    nations.sort((a, b) => b.rating - a.rating)
    nations.forEach((n, i) => { n.rank = i + 1 })

    // Projected World Juniors (U20) — deterministic per season.
    const wj = runWorldJuniors({
      players: this.data.players,
      rng: this.rngFor(8020, this.year),
      teamAbbrOf: (id) => teamOfPlayer.get(id as string)?.abbr ?? 'FA',
    })
    const worldJuniors = wj.contested === 0 ? null : {
      gold: wj.gold,
      silver: wj.silver,
      bronze: wj.bronze,
      standings: wj.standings,
      allStars: wj.allStars,
    }
    return { nations, worldJuniors }
  }

  /** Which point in the analyst-ranking cycle the season is at. */
  private draftRankPhase(): DraftRankPhase {
    if (this.phase === 'offseason' || this.phase === 'playoffs') return 'final'
    const last = this.matchDays[this.matchDays.length - 1] ?? 1
    const frac = this.currentDay / Math.max(1, last)
    if (frac < 0.35) return 'preliminary'
    if (frac < 0.8) return 'midseason'
    return 'final'
  }

  /** Drop an EP-style "Breaking down the {year} Draft class" feature into the
   *  inbox — generated from the current analyst board. Fires once per class. */
  private publishDraftClassArticle(): void {
    const board = this.getDraftRankings()
    const article = buildDraftClassArticle(board.rankings, board.draftYear)
    if (!article) return
    this.pushNews('scouting', article.headline, article.body, { press: { byline: 'EP Scouting', kind: 'draftGuide' } })
  }

  /** NHL analyst draft rankings: the consensus board of the draft-eligible class
   *  (under-19, undrafted) across the world's leagues, weighted and shuffled per
   *  the current phase (preliminary / mid-season / final). */
  /** NHLe-based prospect evaluation: blend this season's scoring pace (live
   *  world-sim stats) with last season's from the historical record, translate
   *  to an NHL-equivalent rate via the league's NHLe factor, and run it through
   *  the projection model. Returns the analyst production premium plus the
   *  outcome projection (P(NHLer) / P(star)). Early in the year it leans on last
   *  season (so the preliminary board already reflects production); it shifts to
   *  the current campaign as games accrue. */
  /** Our scouts' fog-aware read of a player's ceiling (overall pts). Exact for
   *  own/fully-scouted players; a biased, knowledge+judgment-narrowed estimate
   *  otherwise — the same read the profile's POTENTIAL stars and grade show, so
   *  the ceiling role and draft verdict never reveal the hidden true potential. */
  private scoutedCeilingOf(p: Player): number {
    const pid = p.id as string
    const ceiling = agedPotential(p)
    if (this.userTeam.roster.includes(asPlayerId(pid))) return ceiling
    const k = knowledgeOf(this.scouting, pid)
    if (k >= 95) return ceiling
    const { lo, hi } = maskedCeiling(ceiling, k, pid, accuracyOf(this.scouting, pid))
    return Math.round((lo + hi) / 2)
  }

  private prospectEval(p: Player, abbrev: string, noise: number): { premium: number; projection: ProspectProjection } {
    const pid = p.id as PlayerId
    const liveGp = this.worldSim.gp.get(pid) ?? 0
    const liveT = this.worldSim.totals.get(pid)
    const livePpg = liveGp > 0 ? ((liveT?.goals ?? 0) + (liveT?.assists ?? 0)) / liveGp : 0
    const hist = (p.careerHistory ?? []).filter((h) => h.gamesPlayed > 0)
    const last = hist.length > 0 ? hist.reduce((a, b) => (b.year > a.year ? b : a)) : null
    const lastPpg = last ? (last.goals + last.assists) / last.gamesPlayed : 0
    const w = Math.min(1, liveGp / 30) // ramp from last-season to this-season over ~30 GP
    const ppg = livePpg * w + lastPpg * (1 - w)
    const isD = p.position === 'D'
    const leagueFactor = nhleFactorByAbbrev(abbrev)
    return {
      premium: productionPremium(ppg, isD, leagueFactor),
      projection: projectProspect({ ppg, leagueFactor, age: p.age, isD, noise, seed: pid as string }),
    }
  }

  /** Estimation noise for the projection model (projected-peak points), set by
   *  the hired Data Analyst's quality. No analyst → projections stay hidden. */
  private analystProjectionNoise(): number {
    const a = this.dataAnalyst
    if (!a) return 0
    const acc = (a.rating * 0.5 + a.judgment * 0.5) / 100 // ~0.45–0.95
    return (1 - acc) * 14 // elite ≈ ±1.4 pts, weak ≈ ±7 pts
  }

  /** Gather the draft-eligible cohort (candidates + radar rows). Shared by the
   *  rankings view and the phase-transition movement snapshot. */
  private buildDraftBoard(): {
    board: Map<string, { row: Omit<DraftRankRowView, 'rank'>; input: RankInput; player: Player }>
    radarRows: Array<Omit<DraftRankRowView, 'rank'>>
  } {
    const board = new Map<string, { row: Omit<DraftRankRowView, 'rank'>; input: RankInput; player: Player }>()
    const radarRows: Array<Omit<DraftRankRowView, 'rank'>> = []
    const hasAnalyst = this.hasDataAnalyst()
    const analystNoise = this.analystProjectionNoise()
    // The board ranks the AMATEUR draft pool only — junior / college / European
    // feeder leagues. Players on NHL or AHL rosters are signed pros and are not in
    // the draft (you can't draft a contracted player), so the pro tiers are never
    // scanned. This matches the pool the scouts surface from (allDraftProspectIds).
    const compsRaw = this.data.league.competitions ?? []
    const boardLeagues: Array<{ abbrev: string; teamIds: readonly TeamId[] }> =
      compsRaw
        .filter((c) => !isProLeagueAbbrev(c.abbrev))
        .map((c) => ({ abbrev: c.abbrev, teamIds: c.teamIds }))
    for (const c of boardLeagues) {
      for (const tid of c.teamIds) {
        const t = this.data.teams.get(tid)
        if (!t) continue
        for (const pid of t.roster) {
          const p = this.data.players.get(pid)
          if (!p) continue
          const elig = draftEligibility(p.age, !!p.nhlDrafted)
          if (elig === null) continue
          const id = p.id as string
          // Perceived ceiling = hidden true ceiling + pre-draft analyst optimism
          // + a production premium (analysts rank on what he's DONE when the book
          // is generic). Production blends this season's pace with last season's
          // from the historical record, converted to an NHL-equivalent rate. The
          // true ceiling stays hidden and is what development pays out.
          // Currently-injured prospects take a small availability/durability
          // ding (missed viewings + health questions) — injuries move the board.
          const injuryDing = p.injuryStatus ? 4 : 0
          const evalRes = this.prospectEval(p, c.abbrev, analystNoise)
          // Consensus scouting error: even the aggregate board misreads talent —
          // a persistent per-player miss (±~16 ceiling pts) that, with development
          // variance, brings draft-rank↔outcome down to the real ~0.45 range.
          const consensusError = hashSigned(id + ':consensus') * 16
          const perceived = perceivedCeiling(agedPotential(p), p.age, evalRes.premium - injuryDing + consensusError)
          // Projection probabilities are the Data Analyst's product — shown only
          // when one is on staff, and noisier the weaker the analyst.
          const isSkater = p.position !== 'G' && hasAnalyst
          const row: Omit<DraftRankRowView, 'rank'> = {
            playerId: id,
            name: p.name,
            teamId: t.id as string,
            teamAbbr: t.abbreviation,
            leagueAbbr: c.abbrev,
            nation: p.nationality ?? '',
            position: p.position,
            age: p.age,
            eligibility: elig,
            currentStars: overallToStars(ratedOverall(p)),
            potentialStars: overallToStars(perceived),
            perceivedCeiling: Math.round(perceived),
            ...(isSkater ? { pNHLer: evalRes.projection.pNHLer, pStar: evalRes.projection.pStar } : {}),
          }
          if (elig === 'radar') radarRows.push(row)
          else board.set(id, { input: { id, ceiling: perceived, current: ratedOverall(p), position: p.position, eligibility: elig }, row, player: p })
        }
      }
    }
    return { board, radarRows }
  }

  /** id → analyst rank for a given phase, with the cohort's CURRENT ratings.
   *  Used to snapshot the board at a phase boundary for movement arrows. */
  private analystRankMap(phase: DraftRankPhase): Map<string, number> {
    const { board } = this.buildDraftBoard()
    const ordered = analystRank([...board.values()].map((c) => c.input), phase)
    const m = new Map<string, number>()
    ordered.forEach((id, i) => m.set(id, i + 1))
    return m
  }

  getDraftRankings(): DraftRankingsView {
    const phase = this.draftRankPhase()
    type Cand = { row: Omit<DraftRankRowView, 'rank'>; input: RankInput; player: Player }
    const { board, radarRows } = this.buildDraftBoard()
    const ordered = analystRank([...board.values()].map((c) => c.input), phase)
    // Movement vs the previous phase's published board (▲ rose / ▼ slid).
    const prev = this.prevDraftBoard
    const rankings: DraftRankRowView[] = ordered.slice(0, 64).map((id, i) => {
      const rank = i + 1
      const wasRanked = prev.get(id)
      const movement = wasRanked !== undefined ? wasRanked - rank : 0
      return { rank, movement, ...board.get(id)!.row }
    })
    // Radar: youngest standouts by projected ceiling — they're "on the radar".
    const radar: DraftRankRowView[] = radarRows
      .sort((a, b) => b.potentialStars - a.potentialStars || b.currentStars - a.currentStars)
      .slice(0, 20)
      .map((row, i) => ({ rank: i + 1, ...row }))
    const phaseLabel =
      phase === 'preliminary' ? 'Preliminary ranking'
      : phase === 'midseason' ? 'Mid-season ranking'
      : 'Final pre-draft ranking'

    // ── Your scouts' own board ──────────────────────────────────────────────
    // The public CONSENSUS value (analyst perceived ceiling) is only the baseline
    // we measure AGAINST — the movement arrows show how far our staff moves a
    // prospect off the public board. Our own board ranks on the GROUNDED value:
    // the hidden TRUE ceiling where we've put eyes on him, deferring to the public
    // read only where we haven't scouted. This is the same grounded ceiling that
    // drives his prospect grade and the per-player "Your scouts" verdict, so the
    // board can never contradict them — a prospect we grade a depth player can't
    // sit above one we grade a franchise talent just because the book is high on
    // him. Each scout then layers their own specialty bias + judgment-scaled noise
    // on top → distinct boards, but always anchored to what our staff has seen.
    const cands = [...board.values()]
    const groundedValueOf = (c: Cand): number => {
      const kw = Math.max(0, Math.min(1, (meta.get(c.row.playerId)?.knowledge ?? 0) / 100))
      // Fog blend: true ceiling once we've watched him, public ceiling when we haven't.
      const groundedCeiling = agedPotential(c.player) * kw + c.input.ceiling * (1 - kw)
      // Apply the SAME positional fade + re-entry dock the analyst board uses, so
      // hard-to-project positions (a tandem-ceiling goalie) and passed-over re-
      // entries don't crack the top of our board either — goalies almost never go
      // top-10 in reality, and our scouts know it.
      const base = groundedCeiling * 0.74 + c.input.current * 0.26
      return base * positionFactor(c.input.position) - reentryPenalty(c.input.eligibility)
    }
    const meta = new Map<string, { knowledge: number; deptRaw: number; composites: Record<string, number> }>()
    for (const c of cands) {
      const id = c.row.playerId
      const isOwn = this.userTeam.roster.includes(asPlayerId(id))
      const knowledge = isOwn ? 100 : knowledgeOf(this.scouting, id)
      const deptRaw = scoutSignalParts(c.player, (this.interviews.get(id) ?? []).length).raw
      meta.set(id, { knowledge, deptRaw, composites: c.player.composites as unknown as Record<string, number> })
    }
    // The "Cons." column = the ACTUAL analyst board order (same `ordered` the
    // published rankings use), so the movement arrows compare our board against
    // the exact consensus the user sees on the Analyst tab — not a parallel
    // re-derivation that could disagree.
    const consensusRankOf = new Map<string, number>()
    ordered.forEach((id, i) => consensusRankOf.set(id, i + 1))

    // Build a board (top 64) from a per-candidate value function.
    const buildBoard = (valueOf: (c: Cand) => number): ScoutBoardRowView[] =>
      [...cands]
        .sort((a, b) => valueOf(b) - valueOf(a))
        .slice(0, 64)
        .map((c, i) => {
          const id = c.row.playerId
          const yourRank = i + 1
          const consensusRank = consensusRankOf.get(id) ?? yourRank
          const movement = consensusRank - yourRank
          const verdict: ScoutBoardRowView['verdict'] = movement >= 3 ? 'higher' : movement <= -3 ? 'lower' : 'inline'
          // The Potential column on OUR board shows OUR fog-aware read (c.row's is
          // the analyst's perceived ceiling) — so it agrees with the ▲/▼ verdict.
          return { rank: yourRank, ...c.row, potentialStars: overallToStars(this.scoutedCeilingOf(c.player)), consensusRank, movement, verdict, seen: (meta.get(id)?.knowledge ?? 0) >= 35 }
        })

    // Staff consensus board: grounded value + department signal, knowledge-scaled.
    const scoutBoard = buildBoard((c) => {
      const m = meta.get(c.row.playerId)!
      return groundedValueOf(c) + m.deptRaw * (m.knowledge / 100)
    })

    // Per-scout boards: each scout adds their own bias + judgment-scaled noise.
    const scouts = this.getTeamStaff(this.userTeamId as string).scouts
    const scoutBoards = scouts.map((s) => ({
      scoutId: s.id as string,
      scoutName: s.name,
      rows: buildBoard((c) => {
        const m = meta.get(c.row.playerId)!
        const bias = scoutDraftBias(s, c.player, m.composites)
        return groundedValueOf(c) + (m.deptRaw + bias) * (m.knowledge / 100)
      }),
    }))

    return { phase, phaseLabel, draftYear: this.year + 1, rankings, radar, scoutBoard, scoutBoards }
  }

  getStats(): StatsView {
    return buildStatsView(this.ctx())
  }

  /** Per-player season stats for a specific team (Team > Statistics tab). */
  getTeamPlayerStats(teamId: string): TeamPlayerStatsView {
    const squad = this.getSquadFor(teamId)
    const skaters: TeamPlayerStatsView['skaters'] = []
    const goalies: TeamPlayerStatsView['goalies'] = []
    for (const row of squad.rows) {
      const entry: TeamPlayerStatRow = {
        playerId: row.playerId,
        name: row.name,
        position: row.position,
        age: row.age,
        skater: row.skater,
        goalie: row.goalie,
      }
      if (row.position === 'G') goalies.push(entry)
      else skaters.push(entry)
    }
    return { teamName: squad.teamName, skaters, goalies }
  }

  /**
   * Statistics table: every NHL player's season line, flat. When `onlyTeamId`
   * is given, scoped to that one club (used by the Team → Statistics tab).
   */
  getLeagueStatTable(onlyTeamId?: string): LeagueStatTableView {
    const skaters: LeagueSkaterStatRow[] = []
    const goalies: LeagueGoalieStatRow[] = []

    const avgRatingOf = (pid: string): number | null => {
      const arr = this.playerRatings.get(asPlayerId(pid))
      if (!arr || arr.length === 0) return null
      return Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 100) / 100
    }

    for (const teamId of this.data.league.teams) {
      if (onlyTeamId && (teamId as string) !== onlyTeamId) continue
      const team = this.data.teams.get(teamId)
      if (!team) continue
      const abbr = team.abbreviation
      const squad = this.getTeamPlayerStats(teamId as string)
      for (const r of [...squad.skaters, ...squad.goalies]) {
        const rookie = r.age <= 21
        if (r.goalie) {
          const g = r.goalie
          goalies.push({
            playerId: r.playerId, name: r.name, teamAbbr: abbr, age: r.age, rookie,
            gp: g.gamesPlayed, wins: g.wins, losses: g.losses, savePct: g.savePct,
            gaa: g.goalsAgainstAverage, shutouts: g.shutouts, saves: g.saves,
            shotsAgainst: g.shotsAgainst, avgRating: avgRatingOf(r.playerId),
          })
        } else if (r.skater) {
          const s = r.skater
          const tot = this.totals.get(asPlayerId(r.playerId))
          skaters.push({
            playerId: r.playerId, name: r.name, teamAbbr: abbr, position: r.position, age: r.age, rookie,
            gp: s.gamesPlayed, goals: s.goals, assists: s.assists, points: s.points,
            plusMinus: s.plusMinus, pim: s.penaltyMinutes, shots: s.shots,
            shootingPct: s.shots > 0 ? s.goals / s.shots : 0,
            atoi: s.toiPerGame, ppGoals: s.ppGoals, ppAssists: s.ppAssists,
            ppPoints: s.ppGoals + s.ppAssists,
            hits: tot?.hits ?? 0, blocks: tot?.blockedShots ?? 0,
            takeaways: tot?.takeaways ?? 0, giveaways: tot?.giveaways ?? 0,
            avgRating: avgRatingOf(r.playerId),
          })
        }
      }
    }
    const userTeamAbbr = this.data.teams.get(this.userTeamId)?.abbreviation ?? ''
    return { skaters, goalies, userTeamAbbr }
  }

  /** Full staff view for any team (or user team when teamId is absent). */
  getTeamStaffView(teamId?: string): StaffView {
    const tid = teamId ? asTeamId(teamId) : this.userTeamId
    const team = this.data.teams.get(tid)
    const teamName = team?.name ?? 'Unknown Team'
    const ts = this.getTeamStaff(tid as string)

    const DEMEANOR_LABELS: Record<NonNullable<import('@engine/league/staff').StaffMember['demeanor']>, string> = {
      fiery:      'Fiery',
      calm:       'Calm',
      analytical: 'Analytical',
      motivator:  'Motivator',
      pragmatic:  'Pragmatic',
    }

    const ROLE_LABELS: Record<import('@engine/league/staff').StaffMember['role'], string> = {
      headCoach:      'Head Coach',
      assistantCoach: 'Assistant Coach',
      assistantGM:    'Assistant GM',
      scout:          'Scout',
      physio:         'Physio',
      owner:          'Owner',
      dataAnalyst:    'Data Analyst',
    }

    function toRow(m: import('@engine/league/staff').StaffMember): StaffRowView {
      const row: StaffRowView = {
        id:        m.id,
        name:      m.name,
        roleLabel: ROLE_LABELS[m.role],
        rating:    m.rating,
        judgment:  m.judgment,
      }
      if (m.specialty !== undefined) row.specialty = m.specialty
      if (m.demeanor !== undefined) row.demeanorLabel = DEMEANOR_LABELS[m.demeanor]
      if (m.faceId !== undefined) row.faceId = m.faceId
      if (m.attributes !== undefined) row.attributes = m.attributes
      return row
    }

    return {
      teamName,
      headCoach:       toRow(ts.headCoach),
      assistantCoaches: ts.assistantCoaches.map(toRow),
      assistantGM:     toRow(ts.assistantGM),
      scouts:          ts.scouts.map(toRow),
      physios:         ts.physios.map(toRow),
      owner:           toRow(ts.owner),
    }
  }

  /** Estimated annual salary for an analyst of a given quality (flavour). */
  private analystSalary(rating: number): number {
    return Math.round((250_000 + Math.max(0, rating - 45) * 28_000) / 1000) * 1000
  }

  /** The data-analyst hire screen: who you've hired (if anyone) + the market. */
  getDataAnalyst(): import('./views').DataAnalystView {
    const hired = this.dataAnalyst
    const candidates = generateDataAnalysts(this.rngFor(7700), 5)
      .filter((c) => c.id !== hired?.id)
      .map((c) => ({
        id: c.id,
        name: c.name,
        rating: c.rating,
        judgment: c.judgment,
        specialty: c.specialty ?? 'Analytics',
        salary: this.analystSalary(c.rating),
      }))
    return {
      hired: hired
        ? { id: hired.id, name: hired.name, rating: hired.rating, judgment: hired.judgment, specialty: hired.specialty ?? 'Analytics' }
        : null,
      candidates,
    }
  }

  /** Hire a data analyst from the market, unlocking the Data Hub. */
  hireDataAnalyst(candidateId: string): { ok: boolean; message?: string } {
    const cand = generateDataAnalysts(this.rngFor(7700), 5).find((c) => c.id === candidateId)
    if (!cand) return { ok: false, message: 'That analyst is no longer available.' }
    this.dataAnalyst = cand
    this.pushNews('frontOffice', `Hired ${cand.name} as Data Analyst`,
      `${cand.name} joins the front office as our Data Analyst (${cand.specialty}). The analytics Data Hub — models, charts and projections — is now available to inform our decisions.`,
      {})
    return { ok: true }
  }

  /** Whether the GM has unlocked the analytics Data Hub. */
  hasDataAnalyst(): boolean {
    return this.dataAnalyst !== null
  }

  getDataHubView(): DataHubView {
    const nhlTeamIds = new Set(this.data.league.teams.map((id) => id as string))
    return buildDataHubView(this.ctx(), this.specialTeams, nhlTeamIds)
  }

  getTeamDataHubView(teamId: string): import('./views').TeamDataHubView {
    const nhlTeamIds = new Set(this.data.league.teams.map((id) => id as string))
    return buildTeamDataHubView(this.ctx(), this.specialTeams, nhlTeamIds, teamId)
  }

  getFinances(): FinanceView {
    return buildFinanceView(this.ctx())
  }

  getInbox(): InboxView {
    const items = [...this.news]
    const unread = items.filter((n) => !n.read).length

    // Collect unique player/team ids referenced by news items.
    const playerIds = new Set<string>()
    const teamIds = new Set<string>()
    for (const item of items) {
      if (item.playerId) playerIds.add(item.playerId)
      if (item.teamId) teamIds.add(item.teamId)
    }

    const playerInfo: Record<string, { name: string; faceId?: string }> = {}
    for (const pid of playerIds) {
      const p = this.data.players.get(asPlayerId(pid))
      if (p) {
        const entry: { name: string; faceId?: string } = { name: p.name }
        if (p.faceId !== undefined) entry.faceId = p.faceId
        playerInfo[pid] = entry
      }
    }

    const teamInfo: Record<string, { abbreviation: string; primaryColor: number }> = {}
    for (const tid of teamIds) {
      const t = this.data.teams.get(asTeamId(tid))
      if (t) teamInfo[tid] = { abbreviation: t.abbreviation, primaryColor: t.colors.primary }
    }

    // Coach-quote items carry speakerFaceId directly on the item — no extra lookup needed.
    // The InboxScreen reads item.speaker and item.speakerFaceId to render the quote card.

    // Open player→GM concerns, newest first.
    const interactions: PlayerInteractionView[] = []
    for (const i of this.interactions) {
      if (i.status !== 'open') continue
      const p = this.data.players.get(asPlayerId(i.playerId))
      const view: PlayerInteractionView = {
        id: i.id,
        playerId: i.playerId,
        playerName: p?.name ?? 'Player',
        kind: i.kind,
        severity: i.severity,
        message: i.message,
        day: i.day,
        year: i.year,
        options: i.options.map((o) => ({ id: o.id, label: o.label })),
      }
      if (p?.faceId !== undefined) view.faceId = p.faceId
      interactions.push(view)
    }

    return { items, unread, playerInfo, teamInfo, ...(interactions.length > 0 ? { interactions } : {}) }
  }

  getLastBoxScore(): BoxScoreView | null {
    return this.lastBoxScore
  }

  private pickAsset(p: DraftPick): PickAssetView {
    const pv = pickValue(p, { year: this.year })
    return {
      id: this.pickId(p),
      year: p.year,
      round: p.round,
      originalTeamAbbr: this.data.teams.get(p.originalTeamId)!.abbreviation,
      label: `${p.year} R${p.round} (${this.data.teams.get(p.originalTeamId)!.abbreviation})`,
      value: Math.round(pv * 10) / 10,
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
    const userTeam = this.userTeam
    const myCapSpace = userTeam.finances.salaryCap - userTeam.finances.capUsed
    return {
      incoming: this.tradeOffers.map((o) => this.offerView(o)),
      partners: this.data.league.teams
        .filter((tid) => tid !== this.userTeamId)
        .map((tid) => {
          const team = this.data.teams.get(tid)!
          const profile = buildTeamProfile(team, this.data.players)
          const needLabels: Record<string, string> = { F: 'Forwards', D: 'Defence', G: 'Goaltending' }
          return {
            teamId: tid as string,
            teamName: team.name,
            teamAbbr: team.abbreviation,
            players: tradable(tid),
            picks: this.picks.filter((p) => p.ownerTeamId === tid).map((p) => this.pickAsset(p)),
            capSpace: profile.capSpace,
            needs: profile.needs.map((g) => needLabels[g] ?? g),
            philosophy: profile.philosophy,
          }
        }),
      myPlayers: tradable(this.userTeamId),
      myPicks: this.picks
        .filter((p) => p.ownerTeamId === this.userTeamId)
        .map((p) => this.pickAsset(p)),
      deadlineDay: this.deadlineDay,
      tradingOpen: this.tradingOpen(),
      myCapSpace,
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
        const pid = pr.playerId as string
        // Fog-gate potential by YOUR scouting: a prospect you watched all year
        // reads sharply; one you ignored is a guess. Makes scouting matter at the draft.
        const know = knowledgeOf(this.scouting, pid)
        const band = maskedCeiling(agedPotential(p), know, pid, accuracyOf(this.scouting, pid))
        return {
          ...badge(p),
          rank: pr.rank,
          potentialStars: overallToStars(Math.round((band.lo + band.hi) / 2)),
          knowledge: Math.round(know),
          drafted: taken.has(pid),
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

  /* ────────────────────────── plumbing module views (Wave 3) ────────────────────────── */

  /** EHM Team > Report tab: the AGM's depth chart and category bests. */
  getReport(): AgmReportView {
    if (!this.staff) {
      this.staff = generateStaff({ rng: new Rng(deriveSeed(this.seed, 9200)) })
    }
    // Use the user club's actual AGM (real name/face from the team staff), not the
    // generic generated one — falls back to the generic staff if unset.
    const agm = this.getTeamStaff(this.userTeamId as string).assistantGM ?? this.staff.assistantGM
    const roster = this.userTeam.roster.map((id) => this.resolve(id))
    // Fold AHL-affiliate young players into the prospect pool so the report shows
    // the whole org's prospects and where each currently plays.
    const prospectPool: Array<{ player: Player; location: string }> = []
    const affiliateId = this.userTeam.affiliateId
    const ahlTeam = affiliateId ? this.data.teams.get(affiliateId as TeamId) : undefined
    if (ahlTeam) {
      for (const id of ahlTeam.roster) {
        const p = this.data.players.get(id)
        if (p) prospectPool.push({ player: p, location: 'AHL' })
      }
    }
    const report = buildAgmReport({
      roster,
      players: this.data.players,
      agm,
      rng: new Rng(deriveSeed(this.seed, 9202, this.currentDay)),
      prospectPool,
    })

    const colorTier = (judgedOverall: number): AgmRankedPlayerView['colorTier'] => {
      if (judgedOverall >= 82) return 'elite'
      if (judgedOverall >= 70) return 'good'
      if (judgedOverall >= 60) return 'solid'
      return 'fringe'
    }

    const toView = (r: import('@engine/league/staff').AgmRankedPlayer): AgmRankedPlayerView => ({
      playerId: r.playerId,
      name: r.name,
      position: r.position,
      age: r.age,
      judgedOverall: r.judgedOverall,
      judgedPotential: r.judgedPotential,
      tier: r.tier,
      colorTier: colorTier(r.judgedOverall),
      ...(r.location !== undefined ? { location: r.location } : {}),
    })

    return {
      agmName: agm.name,
      agmRating: agm.rating,
      agmJudgment: agm.judgment,
      agmSpecialty: agm.specialty,
      depthChart: {
        goalies: report.depthChart.goalies.map(toView),
        defensemen: report.depthChart.defensemen.map(toView),
        leftWings: report.depthChart.leftWings.map(toView),
        centers: report.depthChart.centers.map(toView),
        rightWings: report.depthChart.rightWings.map(toView),
      },
      categoryBests: report.categoryBests.map((c) => ({ ...c })),
      topProspects: report.topProspects.map(toView),
    }
  }

  /** EHM Practice screen: current state + auto-suggestion. */
  getPractice(): PracticeView {
    const roster = this.userTeam.roster.map((id) => this.resolve(id))
    return {
      state: structuredClone(this.practiceState),
      suggestion: suggestFocus(roster),
    }
  }

  /** Update the team practice focus and/or per-player overrides. */
  setPractice(state: TeamPracticeState): void {
    this.practiceState = structuredClone(state)
  }

  /** Toggle a player's healthy-scratch status for the next game. */
  toggleScratchPlayer(playerId: string): void {
    this.practiceState = toggleScratch(this.practiceState, playerId)
  }

  /** Set (or clear) a per-player individual focus override. */
  setPlayerFocusDrill(playerId: string, focus: PracticeFocus | null): void {
    this.practiceState = setPlayerFocus(this.practiceState, playerId, focus)
  }

  /** Whether a given player is scratched. */
  isScratchedFor(playerId: string): boolean {
    return isScratchedFor(this.practiceState, playerId)
  }

  /** League-wide top-N leaderboards for the League hub. */
  getLeagueLeaders(topN = 10): LeagueLeadersView {
    interface Entry {
      playerId: string
      name: string
      teamAbbr: string
      position: import('@domain').Position
      gamesPlayed: number
      goals: number
      assists: number
      points: number
      plusMinus: number
      savePct: number
      toi: number
      goalsAgainst: number
      wins: number
    }
    const entries: Entry[] = []
    for (const [pid, t] of this.totals) {
      const p = this.data.players.get(pid)
      if (!p) continue
      const gp = this.gp.get(pid) ?? 0
      if (gp === 0) continue
      const teamId = this.teamOf(pid)
      const teamAbbr = teamId ? this.data.teams.get(teamId)!.abbreviation : 'FA'
      const sa = t.shotsAgainst
      entries.push({
        playerId: pid as string,
        name: p.name,
        teamAbbr,
        position: p.position,
        gamesPlayed: gp,
        goals: t.goals,
        assists: t.assists,
        points: t.goals + t.assists,
        plusMinus: 0,
        savePct: sa > 0 ? t.saves / sa : 0,
        toi: t.toi,
        goalsAgainst: t.goalsAgainst,
        wins: this.goalieWins.get(pid) ?? 0,
      })
    }

    const skaters = entries.filter((e) => e.position !== 'G')
    const goalies = entries.filter((e) => e.position === 'G' && e.gamesPlayed >= 10)

    const topSkaters = (
      score: (e: Entry) => number,
      source = skaters
    ): import('./views').LeagueLeaderEntry[] =>
      [...source]
        .sort((a, b) => score(b) - score(a))
        .slice(0, topN)
        .map((e) => ({
          playerId: e.playerId,
          name: e.name,
          teamAbbr: e.teamAbbr,
          position: e.position,
          gamesPlayed: e.gamesPlayed,
          value: Math.round(score(e) * 100) / 100,
        }))

    return {
      points: topSkaters((e) => e.points),
      goals: topSkaters((e) => e.goals),
      assists: topSkaters((e) => e.assists),
      plusMinus: topSkaters((e) => e.plusMinus),
      savePct: topSkaters((e) => e.savePct, goalies).map((e) => ({
        ...e,
        value: Math.round(e.value * 1000) / 1000,
      })),
      goalsAgainstAvg: [...goalies]
        .filter((e) => e.toi > 0)
        .sort((a, b) => a.goalsAgainst / a.toi - b.goalsAgainst / b.toi)
        .slice(0, topN)
        .map((e) => ({
          playerId: e.playerId,
          name: e.name,
          teamAbbr: e.teamAbbr,
          position: e.position,
          gamesPlayed: e.gamesPlayed,
          value: Math.round((e.goalsAgainst / (e.toi / 3600)) * 100) / 100,
        })),
      wins: topSkaters((e) => e.wins, goalies),
    }
  }

  /* ────────────────────────── story layer views ────────────────────────── */

  getHistory(): HistoryView {
    const r = this.recordsState
    return {
      singleSeason: {
        goals: [...r.singleSeason.goals],
        assists: [...r.singleSeason.assists],
        points: [...r.singleSeason.points],
        wins: [...r.singleSeason.wins],
        savePct: [...r.singleSeason.savePct],
      },
      career: {
        goals: [...r.career.goals],
        assists: [...r.career.assists],
        points: [...r.career.points],
        gamesPlayed: [...r.career.gamesPlayed],
      },
      seasons: [...r.seasons],
      awards: [...r.awards],
      legends: [...r.retiredLegends],
    }
  }

  getLockerRoom(): LockerRoomView {
    const lr = this.lockerRooms.get(this.userTeamId)
    const team = this.userTeam
    if (!lr) {
      return {
        captain: null,
        alternates: [],
        roomMorale: 50,
        influence: [],
        relationships: [],
        lineFamiliarity: [],
      }
    }
    const onRoster = new Set(team.roster.map((id) => id as string))
    const badgeOf = (id: string) => {
      const p = this.data.players.get(asPlayerId(id))
      return p ? badge(p) : null
    }
    const famMap = new Map(lr.familiarity)
    const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)
    const unitFamiliarity = (ids: string[]): number => {
      let sum = 0
      let n = 0
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          sum += famMap.get(pairKey(ids[i], ids[j])) ?? 0
          n++
        }
      }
      return n > 0 ? Math.round(sum / n) : 0
    }
    const relLabel = (kind: string, strength: number): string => {
      if (kind === 'mentorship') return 'Mentor & protégé'
      if (kind === 'feud') return strength >= 70 ? 'Bitter feud' : 'Friction'
      return strength >= 70 ? 'Close friends' : 'Friends'
    }
    const lineFamiliarity: LockerRoomView['lineFamiliarity'] = []
    team.lines.forwards.forEach((line, i) => {
      const ids = line.map((x) => x as string)
      lineFamiliarity.push({
        label: `Line ${i + 1}`,
        players: ids.map((id) => this.data.players.get(asPlayerId(id))?.name ?? id),
        familiarity: unitFamiliarity(ids),
      })
    })
    team.lines.defensePairs.forEach((pair, i) => {
      const ids = pair.map((x) => x as string)
      lineFamiliarity.push({
        label: `Pair ${i + 1}`,
        players: ids.map((id) => this.data.players.get(asPlayerId(id))?.name ?? id),
        familiarity: unitFamiliarity(ids),
      })
    })
    return {
      captain: lr.captainId && onRoster.has(lr.captainId) ? badgeOf(lr.captainId) : null,
      alternates: lr.alternateIds
        .filter((id) => onRoster.has(id))
        .map(badgeOf)
        .filter((b): b is NonNullable<typeof b> => b !== null),
      roomMorale: Math.round(lr.roomMorale),
      influence: [...lr.influence]
        .filter(([id]) => onRoster.has(id))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([id, inf]) => {
          const b = badgeOf(id)!
          return { ...b, influence: Math.round(inf) }
        }),
      relationships: lr.relationships
        .filter((rel) => onRoster.has(rel.a) && onRoster.has(rel.b))
        .map((rel) => ({
          a: badgeOf(rel.a)!,
          b: badgeOf(rel.b)!,
          kind: rel.kind,
          strength: Math.round(rel.strength),
          label: relLabel(rel.kind, rel.strength),
        })),
      lineFamiliarity,
    }
  }

  getTentpoles(): TentpoleView {
    const tp = this.tentpoles
    const abbrFor = (raw: string): string =>
      this.data.teams.get(asTeamId(raw))?.abbreviation ?? raw
    // Combine ranks come from the upcoming draft class (year + 1 of the season
    // the combine ran in); fall back to the latest class.
    const cls = this.data.league.draftClasses[this.data.league.draftClasses.length - 1]
    const rankOf = new Map(cls?.prospects.map((p) => [p.playerId as string, p.rank]) ?? [])
    return {
      rumors: tp.rumors.map((r) => ({
        playerId: r.playerId,
        playerName: this.data.players.get(asPlayerId(r.playerId))?.name ?? r.playerId,
        teamId: r.teamId,
        teamAbbr: abbrFor(r.teamId),
        heat: Math.round(r.heat),
        sinceDay: r.sinceDay,
      })),
      deadlineDay: this.deadlineDay,
      deadlinePassed: this.phase !== 'regularSeason' || this.currentDay >= this.deadlineDay,
      lastDeadlineRecap: this.lastDeadlineRecap
        ? this.lastDeadlineRecap.map((t) => ({
            teamAAbbr: abbrFor(t.teamA),
            teamBAbbr: abbrFor(t.teamB),
            aGave: [...t.aGave],
            bGave: [...t.bGave],
          }))
        : null,
      lottery: this.lastLottery
        ? {
            orderAbbrs: [...this.lastLottery.orderAbbrs],
            movedUp: this.lastLottery.movedUp ? { ...this.lastLottery.movedUp } : null,
          }
        : null,
      combine: tp.combine
        ? tp.combine.rows.map((row) => {
            const p = this.data.players.get(asPlayerId(row.playerId))
            return {
              playerId: row.playerId,
              name: p?.name ?? row.playerId,
              position: p?.position ?? '?',
              rank: rankOf.get(row.playerId) ?? 0,
              sprint: row.sprint,
              agility: row.agility,
              strength: row.strength,
              interview: row.interview,
              riser: row.riser,
              faller: row.faller,
            }
          })
        : null,
      tournament: tp.tournament
        ? {
            year: tp.tournament.year,
            teamA: tp.tournament.teamA,
            teamB: tp.tournament.teamB,
            medalResult: tp.tournament.medalResult,
            userSelected: tp.tournament.selectedPlayerIds
              .filter((id) => this.userTeam.roster.some((r) => (r as string) === id))
              .map((id) => this.data.players.get(asPlayerId(id))?.name ?? id),
            userSnubbed: tp.tournament.snubbedPlayerIds
              .filter((id) => this.userTeam.roster.some((r) => (r as string) === id))
              .map((id) => this.data.players.get(asPlayerId(id))?.name ?? id),
            returnEffects: tp.tournament.returnEffects.map((e) => ({
              playerName: this.data.players.get(asPlayerId(e.playerId))?.name ?? e.playerId,
              effect: e.effect,
            })),
          }
        : null,
    }
  }

  /* ────────────────────────── Wave 4: franchise drama + League hub ────────────────────────── */

  getBoard(): BoardView {
    const summary = boardSummary(this.boardState)
    const sorted = sortStandings([...this.standings.values()])
    const currentRank = sorted.findIndex((s) => s.teamId === this.userTeamId) + 1
    return {
      ...summary,
      currentRank,
      fired: this.boardState.firedAtYear !== null,
    }
  }

  /** FM-style Club Info: profile + board vision + rivals for the user club. */
  getClubInfo(): ClubInfoView {
    const team = this.data.teams.get(this.userTeamId)!
    const sorted = sortStandings([...this.standings.values()])
    const leagueRank = sorted.findIndex((s) => s.teamId === this.userTeamId) + 1
    const divName = new Map(this.data.league.divisions.map((d) => [d.id, d.name]))
    const confName = new Map(this.data.league.conferences.map((c) => [c.id, c.name]))
    // Division rank: standings order restricted to division-mates.
    const divisionRank =
      sorted.filter((s) => this.data.teams.get(s.teamId)?.divisionId === team.divisionId)
        .findIndex((s) => s.teamId === this.userTeamId) + 1
    const st = this.standings.get(this.userTeamId)
    const affiliateTeam = team.affiliateId ? this.data.teams.get(team.affiliateId) : undefined
    const board = this.getBoard()
    const rivals = this.getRivalries().rivalries
      .filter((r) => r.teamAId === (this.userTeamId as unknown as string) || r.teamBId === (this.userTeamId as unknown as string))
      .slice(0, 3)
      .map((r) => {
        const isA = r.teamAId === (this.userTeamId as unknown as string)
        return { teamId: isA ? r.teamBId : r.teamAId, abbreviation: isA ? r.teamBAbbr : r.teamAAbbr, label: r.label }
      })
    return {
      teamId: this.userTeamId as unknown as string,
      name: team.name,
      abbreviation: team.abbreviation,
      city: team.city,
      conferenceName: confName.get(team.conferenceId) ?? '—',
      divisionName: divName.get(team.divisionId) ?? '—',
      leagueRank,
      divisionRank,
      record: {
        wins: st?.wins ?? 0,
        losses: st?.losses ?? 0,
        overtimeLosses: st?.overtimeLosses ?? 0,
        points: st?.points ?? 0,
        gamesPlayed: st?.gamesPlayed ?? 0,
      },
      affiliate: affiliateTeam
        ? { teamId: affiliateTeam.id as unknown as string, name: affiliateTeam.name, abbreviation: affiliateTeam.abbreviation }
        : null,
      mandate: board.mandate,
      mandateText: board.mandateText,
      targetRank: board.targetRank,
      confidenceLabel: board.confidenceLabel,
      rivals,
      ...(team.arena !== undefined ? { arena: team.arena } : {}),
      ...(team.arenaCapacity !== undefined ? { arenaCapacity: team.arenaCapacity } : {}),
      ...(team.retiredNumbers !== undefined ? { retiredNumbers: team.retiredNumbers } : {}),
    }
  }

  getRivalries(): RivalriesView {
    const sorted = [...this.rivalriesState.rivalries].sort((a, b) => b.intensity - a.intensity)
    const abbrOf = (tid: string): string =>
      this.data.teams.get(asTeamId(tid))?.abbreviation ?? tid
    return {
      rivalries: sorted.map((r) => ({
        teamAId: r.teamA,
        teamAAbbr: abbrOf(r.teamA),
        teamBId: r.teamB,
        teamBAbbr: abbrOf(r.teamB),
        intensity: r.intensity,
        reasons: [...r.reasons],
        meetings: r.meetings,
        label: r.intensity >= 80 ? 'Grudge Match' : r.intensity >= 60 ? 'Rivalry Night' : 'Heating Up',
      })),
    }
  }

  getLeagueStats(): LeagueStatsView {
    const finalized = finalizeSpecialTeams(this.specialTeams)
    return {
      specialTeams: finalized.map((ts) => {
        const team = this.data.teams.get(asTeamId(ts.teamId))
        return {
          ...ts,
          teamName: team?.name ?? ts.teamId,
          teamAbbr: team?.abbreviation ?? ts.teamId,
        }
      }),
    }
  }

  getTransactions(limit = 50): TransactionsView {
    const items = [...this.transactionLedger.items]
      .reverse()
      .slice(0, limit)
      .map((tx) => ({
        ...tx,
        teamNames: tx.teamIds.map(
          (tid) => this.data.teams.get(asTeamId(tid))?.name ?? tid
        ),
      }))
    return { items }
  }

  getScoreboard(day?: number): ScoreboardView {
    const targetDay = day ?? this.currentDay
    const entries = buildScoreboard({
      schedule: this.data.league.schedule,
      day: targetDay,
      teamName: (id) => this.data.teams.get(asTeamId(id))?.name ?? id,
      teamAbbr: (id) => this.data.teams.get(asTeamId(id))?.abbreviation ?? id,
    })
    return { day: targetDay, entries }
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
            overall: ratedOverall(p),
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
        recommendations: [...(this.scouting.recommendations ?? [])],
        seen: [...(this.scouting.seen ?? [])],
        judgment: [...(this.scouting.judgment ?? [])],
        scoutHistory: (this.scouting.scoutHistory ?? []).map(([sid, pids]) => [sid, [...pids]] as [string, string[]]),
      },
      arcs: structuredClone(this.arcsState),
      records: structuredClone(this.recordsState),
      expectations: structuredClone(this.expectationsState),
      lockerRooms: [...this.lockerRooms.entries()].map(
        ([k, v]) => [k as string, structuredClone(v)] as [string, LockerRoomState]
      ),
      interactions: this.interactions.map((i) => structuredClone(i)),
      interactionCounter: this.interactionCounter,
      interviews: [...this.interviews.entries()].map(([k, v]) => [k, [...v]] as [string, string[]]),
      pendingInterviews: this.pendingInterviews.map((i) => ({ ...i })),
      prevDraftBoard: [...this.prevDraftBoard.entries()],
      ...(this.draftPhaseSeen !== null ? { draftPhaseSeen: this.draftPhaseSeen } : {}),
      dataAnalyst: this.dataAnalyst ? { ...this.dataAnalyst } : null,
      legends: [...this.legends.entries()].map(([k, v]) => [k as string, v.map((l) => structuredClone(l))] as [string, ClubLegend[]]),
      agenda: this.agenda.map((a) => ({ ...a })),
      agendaCounter: this.agendaCounter,
      tentpoles: structuredClone(this.tentpoles),
      storyMisc: {
        pointStreaks: [...this.pointStreaks],
        scorelessStreaks: [...this.scorelessStreaks],
        losingStreaks: [...this.losingStreaks],
        userWinStreak: this.userWinStreak,
        lastDeadlineRecap: this.lastDeadlineRecap ? structuredClone(this.lastDeadlineRecap) : null,
        lastLottery: this.lastLottery ? structuredClone(this.lastLottery) : null,
        pressSchedule: structuredClone(this.pressScheduleState),
      },
      pressState: {
        sagaSoFar: this.sagaSoFar,
        pressCounter: this.pressCounter,
        pressJob: this.pressJob ? structuredClone(this.pressJob) : null,
        pressConference: this.pressConference ? structuredClone(this.pressConference) : null,
      },
      staff: this.staff ? structuredClone(this.staff) : undefined,
      teamStaff: this.teamStaffMap.size > 0
        ? [...this.teamStaffMap.entries()].map(([k, v]) => [k, structuredClone(v)] as [string, TeamStaff])
        : undefined,
      playerRatings: [...this.playerRatings.entries()].map(([k, v]) => [k, [...v]] as [string, number[]]),
      practiceState: structuredClone(this.practiceState),
      hireableStaff: [...this.hireableStaff],
      boardState: structuredClone(this.boardState),
      rivalriesState: structuredClone(this.rivalriesState),
      specialTeams: structuredClone(this.specialTeams),
      transactionLedger: structuredClone(this.transactionLedger),
      ahlStandings: serializeMap(this.ahlStandings as unknown as Map<string, unknown>),
      ahlGp: serializeMap(this.ahlGp as unknown as Map<string, number>),
      ahlTotals: serializeMap(this.ahlTotals as unknown as Map<string, unknown>),
      // Wider-world player stats (standings persist on league.competitions).
      worldGp: serializeMap(this.worldSim.gp as unknown as Map<string, number>),
      worldTotals: serializeMap(this.worldSim.totals as unknown as Map<string, unknown>),
      opinionHistory: [...this.opinionHistory.entries()].map(([k, v]) => [k, v.map((s) => ({ ...s }))] as [string, OpinionSnapshot[]]),
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
        recommendations: [...(snapshot.scouting.recommendations ?? [])],
        seen: [...(snapshot.scouting.seen ?? [])],
        judgment: [...(snapshot.scouting.judgment ?? [])],
        scoutHistory: [...(snapshot.scouting.scoutHistory ?? [])],
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

    // Restore the story layer; older saves fall back to fresh initial states.
    career.arcsState = snapshot.arcs ? structuredClone(snapshot.arcs) : createInitialArcsState()
    career.recordsState = snapshot.records ? structuredClone(snapshot.records) : emptyRecords()
    career.tentpoles = snapshot.tentpoles
      ? structuredClone(snapshot.tentpoles)
      : createInitialTentpolesState()
    if (snapshot.lockerRooms) {
      career.lockerRooms.clear()
      for (const [k, v] of snapshot.lockerRooms) {
        career.lockerRooms.set(asTeamId(k), structuredClone(v))
      }
    } else {
      career.initLockerRooms()
    }
    // Player→GM concerns (optional/additive; old saves start with none).
    if (snapshot.interactions) {
      career.interactions = snapshot.interactions.map((i) => structuredClone(i))
    }
    career.interactionCounter = snapshot.interactionCounter ?? 0
    if (snapshot.interviews) {
      career.interviews = new Map(snapshot.interviews.map(([k, v]) => [k, [...v]]))
    }
    if (snapshot.pendingInterviews) {
      career.pendingInterviews = snapshot.pendingInterviews.map((i) => ({ ...i }))
    }
    if (snapshot.prevDraftBoard) career.prevDraftBoard = new Map(snapshot.prevDraftBoard)
    if (snapshot.draftPhaseSeen) career.draftPhaseSeen = snapshot.draftPhaseSeen
    if (snapshot.dataAnalyst) career.dataAnalyst = { ...snapshot.dataAnalyst } as import('@engine/league/staff').StaffMember
    if (snapshot.legends) {
      career.legends = new Map(snapshot.legends.map(([k, v]) => [asTeamId(k), v.map((l) => structuredClone(l))]))
    }
    if (snapshot.agenda) career.agenda = snapshot.agenda.map((a) => ({ ...a }))
    career.agendaCounter = snapshot.agendaCounter ?? 0
    if (snapshot.expectations) {
      career.expectationsState = structuredClone(snapshot.expectations)
    } else {
      // Old save: rebuild plausible odds silently (no news pushed).
      career.expectationsState = buildPreseasonOdds({
        teams: career.teamDescriptors(),
        year: career.year,
        rng: career.rngFor(9101),
      }).state
    }
    if (snapshot.storyMisc) {
      for (const [k, v] of snapshot.storyMisc.pointStreaks) career.pointStreaks.set(k, v)
      for (const [k, v] of snapshot.storyMisc.scorelessStreaks) career.scorelessStreaks.set(k, v)
      for (const [k, v] of snapshot.storyMisc.losingStreaks) career.losingStreaks.set(k, v)
      career.userWinStreak = snapshot.storyMisc.userWinStreak ?? 0
      career.lastDeadlineRecap = snapshot.storyMisc.lastDeadlineRecap
        ? structuredClone(snapshot.storyMisc.lastDeadlineRecap)
        : null
      career.lastLottery = snapshot.storyMisc.lastLottery
        ? structuredClone(snapshot.storyMisc.lastLottery)
        : null
      career.pressScheduleState = hydratePressScheduleState(snapshot.storyMisc.pressSchedule)
    }

    // Restore press state; old saves fall back to empty defaults.
    if (snapshot.pressState) {
      career.sagaSoFar = snapshot.pressState.sagaSoFar ?? ''
      career.pressCounter = snapshot.pressState.pressCounter ?? 0
      career.pressJob = snapshot.pressState.pressJob
        ? structuredClone(snapshot.pressState.pressJob)
        : null
      career.pressConference = snapshot.pressState.pressConference
        ? structuredClone(snapshot.pressState.pressConference)
        : null
    }

    // Restore plumbing module state (all optional for backward compat).
    if (snapshot.staff) {
      career.staff = structuredClone(snapshot.staff)
    } else {
      career.staff = generateStaff({ rng: new Rng(deriveSeed(snapshot.seed, 9200)) })
    }
    // Restore per-team staff or regenerate from the career seed.
    if (snapshot.teamStaff && snapshot.teamStaff.length > 0) {
      for (const [k, v] of snapshot.teamStaff) {
        career.teamStaffMap.set(k, structuredClone(v))
      }
    } else {
      career.generateAllTeamStaff()
    }
    if (snapshot.playerRatings) {
      for (const [k, v] of snapshot.playerRatings) {
        career.playerRatings.set(k, [...v])
      }
    }
    if (snapshot.practiceState) {
      career.practiceState = structuredClone(snapshot.practiceState)
    }
    if (snapshot.hireableStaff) {
      career.hireableStaff = [...snapshot.hireableStaff]
    }

    // Restore Wave 4 franchise drama + league hub state (all optional for backward compat).
    if (snapshot.boardState) {
      career.boardState = structuredClone(snapshot.boardState)
    } else {
      const boardResult = setSeasonMandate({
        teamStrengthRank: career.userStrengthRank(),
        teamsInLeague: data.league.teams.length,
        rng: career.rngFor(9301),
        year: career.year,
        teamId: snapshot.userTeamId,
        teamName: data.teams.get(asTeamId(snapshot.userTeamId))?.name ?? 'the team',
      })
      career.boardState = boardResult.state
    }
    if (snapshot.rivalriesState) {
      career.rivalriesState = structuredClone(snapshot.rivalriesState)
    } else {
      career.rivalriesState = seedRivalries({
        teams: [...data.league.teams].map((tid) => {
          const t = data.teams.get(tid)!
          return { teamId: tid as string, divisionId: t.divisionId as string, conferenceId: t.conferenceId as string }
        }),
        rng: career.rngFor(9302),
      })
    }
    if (snapshot.specialTeams) {
      career.specialTeams = structuredClone(snapshot.specialTeams)
    }
    if (snapshot.transactionLedger) {
      career.transactionLedger = structuredClone(snapshot.transactionLedger)
    }

    // Restore AHL standings; if absent (older saves) initialize from ahlTeams.
    if (snapshot.ahlStandings && snapshot.ahlStandings.length > 0) {
      career.ahlStandings.clear()
      for (const [k, v] of snapshot.ahlStandings) {
        career.ahlStandings.set(asTeamId(k), v as Standing)
      }
    } else {
      career.ahlStandings.clear()
      for (const teamId of data.league.ahlTeams ?? []) {
        career.ahlStandings.set(teamId, freshStanding(teamId))
      }
    }
    if (snapshot.ahlGp) {
      for (const [k, v] of snapshot.ahlGp) career.ahlGp.set(asPlayerId(k), v)
    }
    if (snapshot.ahlTotals) {
      for (const [k, v] of snapshot.ahlTotals) {
        career.ahlTotals.set(asPlayerId(k), v as GamePlayerStat)
      }
    }
    // Wider-world player stats (standings already rebuilt from league.competitions
    // by the constructor's initWorldSimState).
    if (snapshot.worldGp) {
      for (const [k, v] of snapshot.worldGp) career.worldSim.gp.set(asPlayerId(k), v)
    }
    if (snapshot.worldTotals) {
      for (const [k, v] of snapshot.worldTotals) career.worldSim.totals.set(asPlayerId(k), v as GamePlayerStat)
    }
    if (snapshot.opinionHistory) {
      for (const [k, v] of snapshot.opinionHistory) {
        career.opinionHistory.set(k, v.map((s) => ({ ...s })))
      }
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
    // Ensure every staff scout is deployable (adds any not yet in the roster).
    career.syncScoutRoster()
    return career
  }
}
