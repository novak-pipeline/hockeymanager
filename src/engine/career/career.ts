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
import { overall, ratedOverall, ratedPotential, overallToStars, agedPotential } from '@engine/ratings/composites'
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
  buildDraftClassFromPlayers,
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
import { applyConsistency } from '@engine/league/consistency'
import { streakMilestone } from '@engine/league/ambientNews'
import { generateOwnerRequest, type OwnerRequest } from '@engine/league/ownerMeddling'
import { fanInterestDelta, budgetFactor, fanInterestLabel } from '@engine/league/fanbase'
import { buildSponsors, sponsorTotal, sponsorKindLabel } from '@engine/league/sponsors'
import {
  createGMState,
  recordSeasonResult,
  reputationTier,
  endStint,
  startStint,
  currentStint,
  buildGMJobMarket,
  type GMState,
  type GMJobOpening,
} from '@engine/league/gmCareer'
import { runWorldJuniors } from '@engine/league/worldJuniors'
import { analystEdge, analystProjection, analystRank, ceilingRoleShort, draftEligibility, draftRoundLabel, perceivedCeiling, positionFactor, productionPremium, reentryPenalty, type DraftRankPhase, type RankInput } from '@engine/league/draftRankings'
import { buildPlayerComp } from '@engine/career/playerComp'
import { buildSeasonBio } from '@engine/career/seasonBio'
import { buildScoutSummary } from '@engine/career/scoutSummary'
import { buildProspectGrade, type NeedLevel } from '@engine/career/prospectGrade'
import { buildScoutDraftRead, scoutSignalParts } from '@engine/career/scoutDraftRead'
import { farmSplit } from '@engine/career/farmReassign'
import { buildOppositionReport } from '@engine/career/oppositionReport'
import { buildDraftClassArticle } from '@engine/career/draftClassArticle'
import { projectProspect, hashSigned, type ProspectProjection } from '@engine/career/prospectModel'
import { nhleFactorByAbbrev, isProLeagueAbbrev } from '@engine/league/leagueStrength'
import { scoutDraftBias, buildNhlComp } from '@engine/career/multiScout'
import { selectNationalTeam, nationInfo, runWorldChampionship } from '@engine/league/nationalTeam'
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
  emptyChronicle,
  recordEvent as chronicleEvent,
  recordMeeting as chronicleMeeting,
  recordSeries as chronicleSeries,
  recordDraftProvenance,
  recordAcquisition,
  headToHead as chronicleHeadToHead,
  anniversaries as chronicleAnniversaries,
  type ChronicleState,
} from '@engine/story/chronicle'
import {
  buildGmPersona,
  deriveClubPosture,
  personaPhilosophy,
  type ClubPosture,
  type GmPersona,
} from '@engine/league/gmPersona'
import {
  buildBoardMeeting,
  buildSeasonReviewScene,
  defaultChoices as boardMeetingDefaults,
  resolveBoardMeeting,
  resolveSeasonReview,
  type BoardMeetingFacts,
  type BoardMeetingScene,
  type MeetingEffects,
  type SeasonReviewFacts,
} from './boardMeeting'
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
import { lineSynergy, pairSynergy, playerStyleFit, styleMatch } from '@engine/league/archetypes'
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
  requiresWaivers as requiresWaiversRule,
  aiFreeAgencyDay,
  aiResignDay,
  askTerms,
  contractStatus,
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
  generateAiAiTrade,
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
import { repairLines, coachSetLineup, coachAdjustedScore } from '@engine/league/lineup'
import { buildCoachProfile, profileToTactics, coachFit, nudgeProfileForDirection, SYSTEM_FAVORS } from '@engine/league/coachProfile'
import {
  addKnowledge,
  assignScout,
  createInitialScouting,
  knowledgeOf,
  accuracyOf,
  maskedCeiling,
  scoutFormBias,
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
  suggestPlayerFocus,
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
  type DraftAdviceView,
  type ProspectRowView,
  type FinanceView,
  type HistoryView,
  type InboxView,
  type ClubLegend,
  type TeamLegendsView,
  type TeamDynamicsView,
  type MedicalView,
  type MedicalRow,
  type LeagueStatTableView,
  type LeagueSkaterStatRow,
  type LeagueGoalieStatRow,
  type LeagueLeadersView,
  type LeagueComparisonView,
  type LeagueComparisonCard,
  type StaffMeetingSummaryView,
  type CoachMarketView,
  type CoachMarketEntry,
  type PlayoffOddsView,
  type PlayoffOddsRow,
  type LeagueStatsView,
  type LeagueTeamsView,
  type LinesUpdate,
  type LockerRoomView,
  type OffseasonView,
  type WaiverWireRowView,
  type LeagueWireView,
  type GMProfileView,
  type GMJobMarketView,
  type GMRelationshipsView,
  type MentorshipView,
  type ClubDirectionView,
  type FanbaseView,
  type SponsorsView,
  type OwnerRequestView,
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
/**
 * Team strength rating (~0–100) for the club picker and preseason odds.
 *
 * A flat average of the top-15 skaters (the old formula) ignored goaltending
 * entirely and treated a fourth-liner the same as a franchise centre, so a
 * top-heavy-but-thin, weakly-goaltended club could float up the table. This
 * weights the best players more heavily and folds goaltending in at ~a quarter,
 * which is roughly its real influence on results.
 */
export function teamStrengthRating(roster: Player[]): number {
  const skaters = roster
    .filter((p) => p.position !== 'G')
    .map((p) => overall(p.composites, p.position))
    .sort((a, b) => b - a)
  const goalies = roster
    .filter((p) => p.position === 'G')
    .map((p) => overall(p.composites, p.position))
    .sort((a, b) => b - a)
  const mean = (xs: number[], fallback: number): number =>
    xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : fallback
  const core = mean(skaters.slice(0, 9), 50) // top ~3 lines + top pair
  const depth = mean(skaters.slice(9, 18), core) // bottom six + depth D
  const starter = goalies[0] ?? 50
  const backup = goalies[1] ?? starter
  const goalie = starter * 0.7 + backup * 0.3
  return Math.round(0.55 * core + 0.2 * depth + 0.25 * goalie)
}

export function buildTeamList(data: LeagueData): TeamInfo[] {
  const divName = new Map(data.league.divisions.map((d) => [d.id, d.name]))
  const confName = new Map(data.league.conferences.map((c) => [c.id, c.name]))
  return data.league.teams.map((teamId) => {
    const team = data.teams.get(teamId)!
    const strength = teamStrengthRating(team.roster.map((id) => data.players.get(id)!))
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

// Keep a full season's worth of history so scheduled digests (monthly reports,
// power rankings, season review) and ambient news aren't evicted before the
// year is out. The inbox UI sorts unread-first and greys read items, so a
// deeper backlog stays readable.
const NEWS_LIMIT = 600
const ROUND_ROBINS = 4
const DRAFT_ROUNDS = 7
/** Floor for the prospect board; the actual class scales to cover all 7 rounds
 *  of every team (+ a margin of undrafted prospects). See draft-class generation. */
const DRAFT_CLASS_SIZE = 64
const PICK_YEARS_AHEAD = 3
const FA_WINDOW_DAYS = 8
const ROSTER_HARD_CAP = 26
/** Rolling per-game ratings window (last N games stored). */
const RATINGS_WINDOW = 10
/** Calendar days between recurring staff-meeting prompts. */
const STAFF_MEETING_INTERVAL = 14

type ResignStatus = 'pending' | 'signed' | 'walked'

export class Career {
  readonly data: LeagueData
  readonly seed: number
  userTeamId: TeamId

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
  private worldSim: WorldSimState = { standings: new Map(), gp: new Map(), totals: new Map(), leagueAvg: new Map() }
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
  /** Box scores for every played user game this season (calendar click-through). */
  private boxScoreHistory: Array<[string, BoxScoreView]> = []
  private readonly resignStatus = new Map<PlayerId, ResignStatus>()
  /** Per-team signed current streak (+wins / −winless), for ambient league news.
   *  NHL games only; reset each season. Serialized additively. */
  private teamStreaks = new Map<string, number>()
  /** Rival offer sheets tendered to the user's RFAs in the re-sign window. */
  private offerSheets: Array<{ playerId: string; fromTeamId: string; salary: number; years: number }> = []
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
  /** World Chronicle — permanent event memory (Living World LW1). */
  private chronicle: ChronicleState = emptyChronicle()
  /** Named AI GM personas per club (Living World LW2). Lazily built, persisted. */
  private gmPersonas: Array<[string, GmPersona]> = []
  /** Year of the pending preseason board meeting, or null when attended (M1). */
  private boardMeetingYear: number | null = null
  /** Last season's story, for the owner's opening lines at the board meeting. */
  private lastSeasonMeta: { predictedRank: number; actualRank: number; madePlayoffs: boolean; wonCup: boolean } | null = null
  /** Owner-investment perk chosen at the board meeting ('scouting' | 'development'). */
  private ownerPerk: string | null = null
  /** Staged End-of-Season Review facts (M4); null once attended or lapsed. */
  private reviewFacts: SeasonReviewFacts | null = null
  /** Dead-cap charge from buyouts, counted against next season's cap (M2). */
  private userDeadCap = 0
  /** Players bought out during the resign stage — they join the FA pool when
   *  free agency opens (the transition rebuilds faPool from expiries). */
  private buyoutFas: PlayerId[] = []
  /** Pending arbitration awards for the user's unsigned RFAs (M2). Each is an
   *  ultimatum: accept the award or walk away and lose him to the open market. */
  private arbitrationCases: Array<{ playerId: string; salary: number; years: number }> = []
  /** True while the sim is held on deadline day (one continue's grace). */
  private deadlineHold = false
  /** The deadline hold already happened this season. */
  private deadlineHoldDone = false
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
  /**
   * Cumulative season match-rating accumulator (sum + games), from game one of the
   * current season — the true season "Avr". Unlike playerRatings (a rolling 10-game
   * form window), this never drops games. Cleared each season rollover, so a player
   * has NO Avr before the season's first game (and imported pre-career seasons none).
   */
  private readonly seasonRatingTotals = new Map<string, { sum: number; n: number }>()
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
  /**
   * Available head coaches the GM can hire. Lazily generated per (seed, year),
   * persisted so a hire removes the entry across saves. Null = regenerate.
   */
  private coachMarket: CoachMarketEntry[] | null = null

  /** The user's GM identity + reputation + job history. Lazily created (so old
   *  saves restore cleanly), serialized additively. */
  private gmStateInternal: GMState | null = null
  /** Open GM vacancies the user can take (set when fired / courted). Null = none. */
  private gmJobMarket: GMJobOpening[] | null = null

  /** Pending owner directive awaiting the GM's response. Null = none. Serialized. */
  private ownerRequest: OwnerRequest | null = null

  /** The user GM's standing with each rival club (teamId → 0–100, 50 = neutral).
   *  Warms on completed trades, cools when you poach their RFA. Nudges how willing
   *  that club is to deal with you. Lazily defaulted; serialized additively. */
  private gmRelationships = new Map<string, number>()

  /** Veteran→rookie mentorships on the user's club (menteeId → mentorId). A valid
   *  pairing gives the mentee a development-rate boost. Serialized additively. */
  private mentorships = new Map<string, string>()

  /** The GM's declared competitive stance. A board-sanctioned 'rebuild' shields a
   *  losing season from getting you fired (you sell veterans for futures and chase
   *  draft position) — but ownership only sanctions it if they aren't expecting a
   *  contender. Serialized additively; defaults to 'compete'. */
  private clubDirection: 'compete' | 'retool' | 'rebuild' = 'compete'

  /** Fan engagement for the user's club (0–100). Rises with success, erodes with
   *  losing — and feeds the owner's budget, so a long tank quietly shrinks your war
   *  chest. Serialized additively; defaults to 60. */
  private fanInterest = 60
  /** The club's baseline owner budget, captured once so fan interest scales it
   *  each season without compounding drift. 0 = not yet captured. */
  private baseBudget = 0

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
      // The coach owns the system: derive each NHL team's tactics from its head
      // coach's tactical profile, adapted to that roster.
      this.applyCoachSystems()

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
      // Season Rhythm M1: the preseason board meeting awaits before the opener.
      this.boardMeetingYear = this.year

      // The user's GM identity (name generated; reputation starts unproven).
      this.gmStateInternal = createGMState(
        generateTeamStaff(new Rng(deriveSeed(this.seed, 9330))).headCoach.name,
        this.year,
        this.userTeamId as string,
        this.userTeam.abbreviation,
        this.userTeam.name
      )

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

  /**
   * Is this amateur in THIS year's entry-draft class? Undrafted and in the
   * first/second-year window (18–19). The offseason ages everyone +1 before the
   * draft is built, so 18 = the cohort that just turned 18 (first-year eligible)
   * and 19 = a re-entry passed over last year. We deliberately exclude 20+: in an
   * imported world those are career junior/European pros (the EHM `nhlDraftEligible`
   * flag is true for every undrafted player up to age 40, so it can't gate a draft
   * class) — including them put established men in the draft. 17-and-under wait for
   * next season, when they age into the window.
   */
  private isEntryDraftEligible(p: Player): boolean {
    return !p.nhlDrafted && p.age >= 18 && p.age <= 19
  }

  /**
   * The real draft-eligible amateurs for this year's class: undrafted 18–19yos
   * (see isEntryDraftEligible) who live on a wider-world amateur team (junior /
   * college / European feeder), never the NHL or its AHL farm. Empty for the
   * generated league / mods without competitions — callers then fall back to a
   * synthetic class.
   */
  private realDraftEligibles(): Player[] {
    const out: Player[] = []
    for (const c of this.data.league.competitions ?? []) {
      if (isProLeagueAbbrev(c.abbrev)) continue
      for (const tid of c.teamIds) {
        const t = this.data.teams.get(tid as TeamId)
        if (!t) continue
        for (const pid of t.roster) {
          const p = this.data.players.get(pid)
          if (p && this.isEntryDraftEligible(p)) out.push(p)
        }
      }
    }
    return out
  }

  /** True when `playerId` sits on a wider-world amateur (non-pro) team — i.e. a
   *  junior/college/European prospect, not a signed pro on an NHL/AHL roster. */
  private isAmateurWorldPlayer(playerId: PlayerId): boolean {
    for (const c of this.data.league.competitions ?? []) {
      if (isProLeagueAbbrev(c.abbrev)) continue
      for (const tid of c.teamIds) {
        const t = this.data.teams.get(tid as TeamId)
        if (t && t.roster.includes(playerId)) return true
      }
    }
    return false
  }

  /** Map every wider-world player to his league abbrev + club (for the draft board). */
  private worldClubInfoByPid(): Map<string, { leagueAbbr: string; club: string }> {
    const out = new Map<string, { leagueAbbr: string; club: string }>()
    for (const c of this.data.league.competitions ?? []) {
      for (const tid of c.teamIds) {
        const t = this.data.teams.get(tid as TeamId)
        if (!t) continue
        for (const pid of t.roster) out.set(pid as string, { leagueAbbr: c.abbrev, club: t.name })
      }
    }
    return out
  }

  /** A prospect's scoring line: live this-season world production if he's played,
   *  otherwise his most recent imported season. Undefined if neither exists. */
  private prospectSeasonLine(
    p: Player
  ): { gp: number; g: number; a: number; pts: number; isHistory: boolean } | undefined {
    const gp = this.worldSim.gp.get(p.id) ?? 0
    if (gp > 0) {
      const t = this.worldSim.totals.get(p.id)
      const g = t?.goals ?? 0
      const a = t?.assists ?? 0
      return { gp, g, a, pts: g + a, isHistory: false }
    }
    const h = p.careerHistory?.[0]
    if (h && h.gamesPlayed > 0) {
      return { gp: h.gamesPlayed, g: h.goals, a: h.assists, pts: h.goals + h.assists, isHistory: true }
    }
    return undefined
  }

  /**
   * Your key staff's draft recommendations while you're on the clock. Each
   * advisor argues from a different lens — best-available, team need, system
   * fit, highest ceiling — so they often disagree, exactly as a real war room
   * does. Reasons are data-driven (rank, position, the hole they'd fill).
   */
  private draftAdvice(ranks: ReturnType<Career['getDraftRankings']>): DraftAdviceView[] {
    const remaining = this.remainingProspects() // consensus-rank-sorted DraftProspect[]
    if (remaining.length === 0) return []
    const staff = this.getTeamStaff(this.userTeamId as string)
    const P = (dp: DraftProspect): Player => this.resolve(dp.playerId)
    const grpOf = (pos: Position): 'F' | 'D' | 'G' =>
      pos === 'G' ? 'G' : pos === 'D' || pos === 'LD' || pos === 'RD' ? 'D' : 'F'
    const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

    // Advice is driven by YOUR SCOUTS' read, not the public consensus, so it can
    // never contradict the Scout Report. Each advisor scores the SAME grounded
    // value and then tilts it through his own lens (need / fit / ceiling) + his
    // personal bias. Because value is the dominant term, a prospect who is clearly
    // best wins across every lens (a true consensus); only when it's close does
    // the lens decide — exactly how a real war room behaves.
    const sbRow = new Map<string, ScoutBoardRowView>()
    for (const r of ranks.scoutBoard) sbRow.set(r.playerId, r)
    const BIG = 100000
    const scoutRankOf = (pid: string): number => sbRow.get(pid)?.rank ?? BIG
    const isOwn = (pid: string): boolean => this.userTeam.roster.includes(asPlayerId(pid))
    const knowOf = (pid: string): number => (isOwn(pid) ? 100 : knowledgeOf(this.scouting, pid))
    const clubInfo = this.worldClubInfoByPid()

    // Candidate pool: the top of our scouts' board (a war room debates a shortlist).
    const pool = [...remaining]
      .sort((a, b) => scoutRankOf(a.playerId as string) - scoutRankOf(b.playerId as string) || a.rank - b.rank)
      .slice(0, 24)
    if (pool.length === 0) return []

    // Grounded value (value-points) — our fog-aware ceiling, weighted with current.
    const ceilOf = (p: Player): number => this.scoutedCeilingOf(p)
    const valueById = new Map<string, number>()
    for (const dp of pool) valueById.set(dp.playerId as string, ceilOf(P(dp)) * 0.74 + ratedOverall(P(dp)) * 0.26)
    const valueOf = (pid: string): number => valueById.get(pid) ?? 0
    const ceils = pool.map((dp) => ceilOf(P(dp))).sort((a, b) => a - b)
    const medianCeil = ceils[Math.floor(ceils.length / 2)] ?? 50
    // The pure best-player-available (value leader) — used to flag consensus picks.
    const bpaId = pool.reduce((b, dp) => (valueOf(dp.playerId as string) > valueOf(b.playerId as string) ? dp : b), pool[0]).playerId as string

    // Team need: thinnest position group (NHL + AHL) → a value-point bonus.
    const team = this.userTeam
    const ids = [...team.roster]
    if (team.affiliateId) ids.push(...(this.data.teams.get(team.affiliateId)?.roster ?? []))
    const count: Record<'F' | 'D' | 'G', number> = { F: 0, D: 0, G: 0 }
    for (const id of ids) { const pl = this.data.players.get(id); if (pl) count[grpOf(pl.position)]++ }
    const target: Record<'F' | 'D' | 'G', number> = { F: 16, D: 9, G: 4 }
    const needGroup = (['F', 'D', 'G'] as const).slice().sort((a, b) => target[b] - count[b] - (target[a] - count[a]))[0]
    const needPts = clamp(Math.max(0, target[needGroup] - count[needGroup]) * 1.4, 0, 8)
    const profile = staff.headCoach.profile
    const wantD = profile ? profile.structure > profile.offence : false

    // Lens tilts (value-points). Small vs the value spread, so they only decide
    // close calls — never override a prospect who is genuinely a tier above.
    const needBonus = (p: Player): number =>
      grpOf(p.position) === needGroup ? needPts : grpOf(p.position) === 'G' && needGroup !== 'G' ? -1.5 : 0
    const fitBonus = (p: Player): number => {
      const g = grpOf(p.position)
      // The coach leans his roster toward his system: a structured/defensive coach
      // covets mobile D, an attacking coach covets skill up front.
      return wantD ? (g === 'D' ? 5 : g === 'G' ? 0 : -1) : g === 'F' ? 4 : g === 'G' ? -1 : 0
    }
    const ceilingBonus = (p: Player): number => clamp((ceilOf(p) - medianCeil) * 0.55, 0, 8)

    // ── reason-builder helpers (all data-driven, never generic) ─────────────
    const grpWord = (g: 'F' | 'D' | 'G'): string => (g === 'G' ? 'in goal' : g === 'D' ? 'on the blue line' : 'up front')
    const posWord = (pos: Position): string => (grpOf(pos) === 'G' ? 'goaltender' : grpOf(pos) === 'D' ? 'defenceman' : 'forward')
    const roleOf = (p: Player): string => ceilingRoleShort(ceilOf(p), p.position)
    const seasonStr = (p: Player): string => {
      const l = this.prospectSeasonLine(p)
      if (!l || l.gp <= 0) return ''
      const lg = clubInfo.get(p.id as string)?.leagueAbbr
      return p.position === 'G'
        ? `${l.gp} games in the ${lg ?? 'his league'}${l.seasonIsHistory ? ' last year' : ''}`
        : `${l.g}-${l.a}-${l.pts} in ${l.gp} ${lg ? lg + ' ' : ''}games${l.seasonIsHistory ? ' last year' : ''}`
    }
    const compStr = (p: Player): string => {
      const c = buildNhlComp(p, knowOf(p.id as string))
      return c ? `shades of ${c.name} — ${c.blurb}` : ''
    }
    const verdictNote = (pid: string): string => {
      const r = sbRow.get(pid)
      if (!r) return ''
      if (!r.seen) return ' Mind you, light viewings so far — call it an early read.'
      if (r.verdict === 'lower') return ` The media are higher on him (consensus #${r.consensusRank}); our read is more measured.`
      if (r.verdict === 'higher') return ` We're higher on him than the board has him (#${r.consensusRank}) — a value pick.`
      return ''
    }
    const lead = (lens: Lens, p: Player): string => {
      const nm = p.name
      switch (lens) {
        case 'value': return `${nm} is, flat out, the best player left on our board.`
        case 'need': return `We're thin ${grpWord(needGroup)} — and ${nm} is the best ${posWord(p.position)} on the board.`
        case 'fit': return wantD
          ? `${nm} is the mobile, two-way defenceman my system is built around.`
          : `${nm} has the pace and skill to drive our attack.`
        case 'ceiling': return `Nobody left here has ${nm}'s upside.`
      }
    }

    type Lens = 'value' | 'need' | 'fit' | 'ceiling'
    const angleFor: Record<Lens, { kind: DraftAdviceView['kind']; angle: string }> = {
      value: { kind: 'bpa', angle: 'Best available' },
      need: { kind: 'need', angle: 'Team need' },
      fit: { kind: 'fit', angle: 'System fit' },
      ceiling: { kind: 'ceiling', angle: 'Highest ceiling' },
    }

    interface Advisor { m: StaffMember | undefined; role: string; lens: Lens; isScout: boolean }
    const advisors: Advisor[] = [
      { m: staff.scouts[0], role: 'Head Scout', lens: 'value', isScout: true },
      { m: staff.assistantGM, role: 'Assistant GM', lens: 'need', isScout: false },
      { m: staff.headCoach, role: 'Head Coach', lens: 'fit', isScout: false },
    ]
    // Extra scouts each take a lens (alternating ceiling/value) and carry their own
    // specialty bias — so a scout who's high on a specific player breaks from the room.
    staff.scouts.slice(1).forEach((s, i) => {
      advisors.push({ m: s, role: s.specialty ? `${s.specialty} Scout` : 'Scout', lens: i % 2 === 0 ? 'ceiling' : 'value', isScout: true })
    })

    const advice: DraftAdviceView[] = []
    for (const adv of advisors) {
      const m = adv.m
      if (!m) continue
      // Score the shortlist from this advisor's perspective and take his favourite.
      let bestDp = pool[0]
      let bestScore = -Infinity
      for (const dp of pool) {
        const p = P(dp)
        const pid = dp.playerId as string
        let s = valueOf(pid)
        if (adv.lens === 'need') s += needBonus(p)
        else if (adv.lens === 'fit') s += fitBonus(p)
        else if (adv.lens === 'ceiling') s += ceilingBonus(p)
        if (adv.isScout) s += scoutDraftBias(m, p, p.composites as unknown as Record<string, number>) * (knowOf(pid) / 100)
        if (s > bestScore) { bestScore = s; bestDp = dp }
      }
      const p = P(bestDp)
      const pid = bestDp.playerId as string
      const isConsensus = pid === bpaId
      const meta = angleFor[adv.lens]

      // Build a specific, non-generic reason: lens lead + evidence + conviction.
      const evidenceBits: string[] = []
      const prod = seasonStr(p)
      if (prod) evidenceBits.push(`He's put up ${prod}`)
      evidenceBits.push(`projects as ${roleOf(p)}`)
      const comp = compStr(p)
      if (comp) evidenceBits.push(comp)
      let reason = `${lead(adv.lens, p)} ${evidenceBits.join(', ')}.`
      reason += verdictNote(pid)
      if (isConsensus && adv.lens !== 'value') reason += ' He also grades out as the best player available, so this is an easy one.'
      else if (!isConsensus && adv.lens === 'need') reason += ` Not the very top of the board, but the fit at ${posWord(p.position)} is too clean to pass up.`

      const v: DraftAdviceView = {
        staffId: m.id, staffName: m.name, role: adv.role, kind: meta.kind, angle: meta.angle,
        playerId: pid, playerName: p.name, position: p.position, rank: bestDp.rank, reason,
        confidence: Math.round(m.judgment * (0.55 + 0.45 * (knowOf(pid) / 100))),
        isConsensus,
      }
      if (m.faceId) v.faceId = m.faceId
      advice.push(v)
    }

    return advice
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
      const strength = teamStrengthRating(team.roster.map((id) => this.resolve(id)))
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

  /** Rng namespace for lazy head-coach tactical-profile synthesis. Unused elsewhere. */
  private static readonly COACH_PROFILE_NS = 9261

  /** Rng namespace for the coach hiring market. Unused elsewhere. */
  private static readonly COACH_MARKET_NS = 9262
  /** How many available coaches to surface in the hiring market. */
  private static readonly COACH_MARKET_SIZE = 16

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
    if (existing) {
      this.ensureCoachProfile(teamId, existing)
      return existing
    }
    const idx = this.data.league.teams.indexOf(teamId as unknown as typeof this.data.league.teams[number])
    const teamRng = new Rng(deriveSeed(this.seed, Career.TEAM_STAFF_NS, Math.max(0, idx)))
    const ts = generateTeamStaff(teamRng)
    this.ensureCoachProfile(teamId, ts)
    this.teamStaffMap.set(teamId, ts)
    return ts
  }

  /**
   * Guarantee a head coach carries a tactical profile, regenerating it
   * deterministically when absent (old saves, mod-imported staff). Idempotent.
   */
  private ensureCoachProfile(teamId: string, ts: TeamStaff): void {
    if (ts.headCoach.profile) return
    const idx = Math.max(0, this.data.league.teams.indexOf(teamId as unknown as typeof this.data.league.teams[number]))
    const rng = new Rng(deriveSeed(this.seed, Career.COACH_PROFILE_NS, idx))
    ts.headCoach.profile = buildCoachProfile(ts.headCoach, rng)
  }

  /**
   * The coach owns the system: set every NHL team's tactics from its head coach's
   * tactical profile, adapted to that roster. Run at career start and each season
   * rollover (NOT on restore — saved/influenced tactics are preserved there).
   */
  private applyCoachSystems(): void {
    for (const teamId of this.data.league.teams) {
      const team = this.data.teams.get(teamId)
      if (!team) continue
      const ts = this.getTeamStaff(teamId as string)
      const profile = ts.headCoach.profile
      if (!profile) continue
      const roster = team.roster.map((id) => this.resolve(id))
      team.tactics = profileToTactics(profile, roster, team.tactics)
      // How well the coach's system suits this roster → small on-ice edge in the sim.
      team.coachFit = coachFit(profile, roster)
    }
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
  private static readonly CONSISTENCY_NS = 9311

  /** Deterministic per-(player, game) uniform draw in [0,1) for the hidden
   *  consistency rating adjustment. Stable across save/load: it depends only on
   *  the career seed, year, current day and a hash of the player id (no shared
   *  RNG-stream order), so a replay reproduces the same game ratings. */
  private consistencyNoise(pid: string): number {
    let h = 2166136261
    for (let i = 0; i < pid.length; i++) {
      h ^= pid.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return new Rng(deriveSeed(this.seed, Career.CONSISTENCY_NS, this.year, this.currentDay, (h >>> 0) % 2147483647)).next()
  }

  /** Update a team's hot/cold streak after an NHL result and emit ambient league
   *  news when it hits a notable threshold (6, 8, 10, …). Story flavour only. */
  private updateStreak(teamId: string, won: boolean): void {
    const prev = this.teamStreaks.get(teamId) ?? 0
    const next = won ? (prev > 0 ? prev + 1 : 1) : prev < 0 ? prev - 1 : -1
    this.teamStreaks.set(teamId, next)
    // Surface only the USER's club streak to the inbox (club voice) — pushing every
    // team's run would flood the capped news feed. All streaks are still tracked,
    // ready for a future leaguewide ticker feed.
    if (teamId !== (this.userTeamId as string)) return
    const team = this.data.teams.get(asTeamId(teamId))
    if (!team) return
    const m = streakMilestone(team.name, next)
    if (m) this.pushNews('league', m.headline, m.body, { teamId })
  }

  /** The user's GM state, lazily created for old saves that predate the GM career. */
  private ensureGM(): GMState {
    if (!this.gmStateInternal) {
      const name = generateTeamStaff(new Rng(deriveSeed(this.seed, 9330))).headCoach.name
      const t = this.userTeam
      this.gmStateInternal = createGMState(name, this.year, this.userTeamId as string, t.abbreviation, t.name)
    }
    return this.gmStateInternal
  }
  /** Master switch for the player→GM concern system. Off for now (morale/
   *  dynamics rework pending); flip to true to bring the prompts back. */
  private static readonly INTERACTIONS_ENABLED: boolean = false
  /** Keep at most this many open concerns at once, and this many total stored. */
  private static readonly MAX_OPEN_INTERACTIONS = 3
  private static readonly INTERACTION_HISTORY_LIMIT = 40

  /** Scan the user roster after a match day and maybe raise new concerns.
   *  Temporarily disabled while the morale/dynamics layer is reworked — the GM
   *  shouldn't be pestered by player complaints until that system returns. */
  private maybeRaiseInteractions(day: number): void {
    if (Career.INTERACTIONS_ENABLED === false) return
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
          plusMinus: s.plusMinus,
          toi: s.toi,
        })
      }

      // Hidden consistency reshapes the spread of his game ratings (no-op when absent).
      rating = applyConsistency(rating, p.consistency, this.consistencyNoise(pid_str))

      const existing = this.playerRatings.get(pid_str) ?? []
      existing.push(rating)
      if (existing.length > RATINGS_WINDOW) existing.shift()
      this.playerRatings.set(pid_str, existing)
      // Cumulative season Avr (never windowed).
      const acc = this.seasonRatingTotals.get(pid_str) ?? { sum: 0, n: 0 }
      acc.sum += rating
      acc.n += 1
      this.seasonRatingTotals.set(pid_str, acc)
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
    // World Chronicle: all-time head-to-head record for this matchup (pure observer).
    chronicleMeeting(this.chronicle, {
      homeTeamId: res.homeTeamId as string,
      awayTeamId: res.awayTeamId as string,
      homeGoals: res.homeGoals,
      awayGoals: res.awayGoals,
      overtime: res.decidedBy !== 'regulation',
      year: this.year,
    })
    // Hot/cold streak tracking → ambient league news (a tie is impossible in hockey).
    this.updateStreak(res.homeTeamId as string, res.homeGoals > res.awayGoals)
    this.updateStreak(res.awayTeamId as string, res.awayGoals > res.homeGoals)
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
    this.emergencyRecalls()
    for (const team of this.data.teams.values()) repairLines(team, this.data.players)
    // Keep every club's lineup logical: a player who filled in for an injury
    // shouldn't keep the slot once a clearly-better regular is healthy again.
    // Applies to ALL teams. The user's team honours the line-management setting:
    // 'coach' (auto-adjust, the default) upgrades; 'fillGaps' leaves the board
    // as the GM set it (repairLines already filled any holes above).
    for (const teamId of this.data.league.teams) {
      const team = this.data.teams.get(teamId)
      if (!team) continue
      const isUser = (teamId as string) === (this.userTeamId as string)
      if (isUser && this.lineManagementMode === 'fillGaps') continue
      this.autoUpgradeLines(team)
    }
    this.refreshCoachFit()
  }

  /** How the user's lines are managed each matchday: 'coach' auto-adjusts to
   *  dress the best available; 'fillGaps' only fills holes (GM keeps control). */
  private lineManagementMode: 'coach' | 'fillGaps' = 'coach'
  getLineManagementMode(): 'coach' | 'fillGaps' { return this.lineManagementMode }
  setLineManagementMode(mode: 'coach' | 'fillGaps'): void { this.lineManagementMode = mode }

  /** Ensure a team's NHL lineup dresses the best available healthy skaters:
   *  swap a dressed player for a benched one who is clearly better (by a margin,
   *  so it self-heals injury fill-ins without churning near-equal choices).
   *  Position groups are respected; lines are repaired for legality after. */
  private autoUpgradeLines(team: Team): void {
    const THRESH = 3 // ratedOverall points — a meaningful gap, not a coin-flip
    const ovrOf = (id: PlayerId): number => {
      const p = this.data.players.get(id)
      return p ? ratedOverall(p) : -1
    }
    const isFwd = (p: Player): boolean => p.position === 'C' || p.position === 'W'
    const isDef = (p: Player): boolean => p.position === 'D' || p.position === 'LD' || p.position === 'RD'

    const dressed = new Set<string>()
    for (const line of team.lines.forwards) for (const id of line) if (id) dressed.add(id as string)
    for (const pair of team.lines.defensePairs) for (const id of pair) if (id) dressed.add(id as string)

    const upgrade = (slots: PlayerId[][], pred: (p: Player) => boolean): void => {
      // Healthy, on-roster, group-matching players currently NOT dressed.
      const bench = team.roster
        .map((id) => this.data.players.get(id))
        .filter((p): p is Player => !!p && p.injuryStatus === null && pred(p) && !dressed.has(p.id as string))
        .sort((a, b) => ratedOverall(b) - ratedOverall(a))
      if (bench.length === 0) return
      // Dressed slots of this group, weakest occupant first.
      const cells: Array<[number, number]> = []
      slots.forEach((row, r) => row.forEach((id, c) => {
        const p = id ? this.data.players.get(id) : undefined
        if (p && p.injuryStatus === null && pred(p)) cells.push([r, c])
      }))
      cells.sort((a, b) => ovrOf(slots[a[0]]![a[1]]!) - ovrOf(slots[b[0]]![b[1]]!))
      let bi = 0
      for (const [r, c] of cells) {
        if (bi >= bench.length) break
        const curId = slots[r]![c]!
        const best = bench[bi]!
        if (ratedOverall(best) > ovrOf(curId) + THRESH) {
          slots[r]![c] = best.id
          dressed.add(best.id as string)
          dressed.delete(curId as string)
          bi++
        } else break // weakest-first: once the gap is too small, no more upgrades
      }
    }

    upgrade(team.lines.forwards, isFwd)
    upgrade(team.lines.defensePairs, isDef)
    repairLines(team, this.data.players)
  }

  /**
   * Keep every NHL team's coach roster-fit current as rosters evolve (trades,
   * call-ups, injuries) so the small on-ice coach-fit edge tracks reality rather
   * than the season-opening snapshot. Measures the tactics actually in use.
   */
  private refreshCoachFit(): void {
    for (const teamId of this.data.league.teams) {
      const team = this.data.teams.get(teamId)
      if (!team) continue
      const roster = team.roster.map((id) => this.resolve(id))
      if (roster.length === 0) continue
      team.coachFit = styleMatch(roster, team.tactics).fit
    }
  }

  /**
   * Re-optimise every AI club's lines from its head coach's read (skill + form +
   * morale + condition), so combinations evolve through the season. Runs weekly;
   * never touches the user's lineup (the GM owns that). Deterministic per (seed, day).
   */
  private reoptimizeAiLines(day: number): void {
    this.data.league.teams.forEach((teamId, idx) => {
      if ((teamId as string) === (this.userTeamId as string)) return
      const team = this.data.teams.get(teamId)
      if (!team) return
      const coach = this.getTeamStaff(teamId as string).headCoach
      const roster = team.roster.map((id) => this.resolve(id))
      if (roster.length < 18) return // too thin to bother; repairLines will cope
      const res = coachSetLineup({ roster, coach, rng: new Rng(deriveSeed(this.seed, 9271, day * 100 + idx)) })
      team.lines = res.lines
    })
  }

  /**
   * Emergency call-ups: when injuries drop a club below the HEALTHY bodies needed
   * to dress full lines (12F + 6D + 2G), pull up the best healthy AHL players of
   * the short position so the coach never has to ice a defenceman at wing. Bounded
   * by a roster ceiling so it can't balloon; healthy depth is restored at the
   * season rollover via assignRosters. Silent (no inbox spam) and deterministic.
   */
  private emergencyRecalls(): void {
    const NEED: Record<'F' | 'D' | 'G', number> = { F: 12, D: 6, G: 2 }
    const CEILING = 28
    const grpOf = (p: Player): 'F' | 'D' | 'G' =>
      p.position === 'G' ? 'G' : p.position === 'D' || p.position === 'LD' || p.position === 'RD' ? 'D' : 'F'

    for (const nhlId of this.data.league.teams) {
      const nhl = this.data.teams.get(nhlId)
      const ahl = nhl?.affiliateId ? this.data.teams.get(nhl.affiliateId) : undefined
      if (!nhl || !ahl) continue

      const healthyCount = (roster: PlayerId[], grp: 'F' | 'D' | 'G'): number =>
        roster.reduce((n, id) => {
          const p = this.data.players.get(id)
          return p && p.injuryStatus === null && grpOf(p) === grp ? n + 1 : n
        }, 0)

      for (const grp of ['G', 'D', 'F'] as const) {
        while (healthyCount(nhl.roster, grp) < NEED[grp] && nhl.roster.length < CEILING) {
          const cand = ahl.roster
            .map((id) => this.data.players.get(id))
            .filter((p): p is Player => !!p && p.injuryStatus === null && grpOf(p) === grp)
            .sort((a, b) => ratedOverall(b) - ratedOverall(a) || (a.id < b.id ? -1 : 1))[0]
          if (!cand) break // no healthy AHL body at this position — repairLines copes
          ahl.roster = ahl.roster.filter((id) => id !== cand.id)
          nhl.roster.push(cand.id)
        }
      }
    }
  }

  private finishDay(day: number, played: Set<PlayerId>, outcomes: GameOutcome[]): void {
    const dayRng = this.rngFor(7001, day)
    tickRecovery({ players: this.data.players.values(), playedToday: played, rng: dayRng })
    // LW6: anniversary callbacks — the world remembers its own history. At most
    // one per day, exact-day matches only, and only your club's durable moments.
    {
      const hits = chronicleAnniversaries(this.chronicle, this.year, day, { dayTolerance: 0 })
        .filter((e) => e.userInvolved || e.kind === 'championship')
      const hit = hits[0]
      if (hit) {
        const yearsAgo = this.year - hit.year
        this.pushNews(
          'league',
          `${yearsAgo} year${yearsAgo === 1 ? '' : 's'} ago today`,
          `${hit.headline}. ${hit.kind === 'championship' ? 'Banners are forever.' : 'The chronicle keeps the receipts.'}`,
          hit.teamIds[0] ? { teamId: hit.teamIds[0] } : {}
        )
      }
    }
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
      ownProspectIds: [...this.ownOrgIds()],
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
          const base = lr ? developmentModifier(lr, id as string) : 1
          return base * this.mentorshipDevBonus(id as string)
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
      // Living World LW3: postures + GM personas drive who calls and how hard,
      // and the offer rate ramps toward the deadline. Ranks computed once.
      const ranks = this.strengthRanks()
      const postureOf = (tid: TeamId): 'contend' | 'retool' | 'rebuild' =>
        this.clubPostureFor(tid, ranks).posture
      const offers = generateAiOffers({
        day,
        userTeamId: this.userTeamId,
        teams: this.data.teams,
        players: this.data.players,
        picks: this.picks,
        rng: this.rngFor(7002, day),
        nextOfferId: () => `o${this.offerCounter++}`,
        deadlineDay: this.deadlineDay,
        postureOf,
        aggressionOf: (tid) => this.gmPersonaFor(tid).aggression,
      })
      for (const o of offers) {
        this.tradeOffers.push(o)
        const partner = this.data.teams.get(o.partnerTeamId)!
        const gm = this.gmPersonaFor(o.partnerTeamId)
        this.pushNews(
          'trade',
          `Trade offer from ${partner.abbreviation}`,
          `${gm.name} (${gm.styleLabel}) is on the phone. ${o.message}`,
          { teamId: o.partnerTeamId as string }
        )
      }
      // The league lives without you: AI clubs deal with each other — rentals
      // flow from rebuilders to contenders, ramping toward the deadline.
      const aiDeal = generateAiAiTrade({
        day,
        deadlineDay: this.deadlineDay,
        userTeamId: this.userTeamId,
        teams: this.data.teams,
        players: this.data.players,
        picks: this.picks,
        rng: this.rngFor(7012, day),
        postureOf,
      })
      if (aiDeal) {
        executeTrade({
          teams: this.data.teams,
          players: this.data.players,
          teamA: aiDeal.sellerTeamId,
          teamB: aiDeal.buyerTeamId,
          aGivesPlayerIds: aiDeal.playerIds,
          aGivesPicks: [],
          bGivesPlayerIds: [],
          bGivesPicks: aiDeal.picks,
          allPicks: this.picks,
        })
        repairLines(this.data.teams.get(aiDeal.sellerTeamId)!, this.data.players)
        repairLines(this.data.teams.get(aiDeal.buyerTeamId)!, this.data.players)
        const txResult = recordTransaction(this.transactionLedger, {
          day,
          year: this.year,
          kind: 'trade',
          teamIds: [aiDeal.sellerTeamId as string, aiDeal.buyerTeamId as string],
          summary: aiDeal.summary,
        })
        this.transactionLedger = txResult.ledger
        this.chronicleTrade({
          teamAId: aiDeal.sellerTeamId,
          teamBId: aiDeal.buyerTeamId,
          aGivesPlayerIds: aiDeal.playerIds,
          aGivesPicks: [],
          bGivesPlayerIds: [],
          bGivesPicks: aiDeal.picks,
        })
        const sellerGm = this.gmPersonaFor(aiDeal.sellerTeamId)
        const buyerGm = this.gmPersonaFor(aiDeal.buyerTeamId)
        this.pushNews(
          'trade',
          `Trade: ${aiDeal.summary.split('.')[0]}`,
          `${aiDeal.summary} ${buyerGm.name} adds a piece for the run; ${sellerGm.name} keeps stockpiling futures.`,
          { teamId: aiDeal.buyerTeamId as string }
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
    // Season Rhythm M1: simming past the preseason board meeting sends the AGM
    // in your place (safe defaults, a news item, and the meeting is gone).
    if (this.boardMeetingYear !== null) this.autoResolveBoardMeeting()
    const nextDay = this.matchDays.find((d) => d > this.currentDay)
    // Deadline day pauses the sim like draft day: the FIRST continue that would
    // cross the deadline is held — one last chance to work the phones — and the
    // next one proceeds. One press, once a season.
    if (this.deadlineHold) {
      this.deadlineHold = false // the GM has had his day; the window closes
    } else if (
      !this.deadlineHoldDone &&
      nextDay !== undefined &&
      this.currentDay <= this.deadlineDay &&
      nextDay > this.deadlineDay
    ) {
      this.deadlineHold = true
      this.deadlineHoldDone = true
      this.pushNews(
        'trade',
        'DEADLINE DAY — the window closes tonight',
        'This is it: the last hours of the trade window. Every GM in the league is on the phone. ' +
        'Make your calls — when you continue, the deadline passes and the roster you have is the roster you ride.',
        { teamId: this.userTeamId as string }
      )
      return true
    }
    if (nextDay === undefined) return false
    // Resolve any waiver-wire claims whose window has elapsed before today's games.
    this.resolveExpiredWaivers(nextDay)
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
        this.recordBoxScore(game.id as string, this.lastBoxScore)
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
    // ── AI coaches re-jig their lines weekly so combinations evolve with form,
    //    morale and health (the user's own lines are never touched). ───────────
    if (Math.floor(nextDay / 7) > Math.floor(this.currentDay / 7)) {
      this.reoptimizeAiLines(nextDay)
      this.generateWaiverPlacements(nextDay)
    }
    // ── owner meddling: occasionally (~every 6 weeks, and not always), the owner
    //    leans on the GM — kept infrequent so it's flavour, not a nag. ──────
    if (Math.floor(nextDay / 45) > Math.floor(this.currentDay / 45)) {
      this.maybeGenerateOwnerRequest(nextDay)
    }
    // ── recurring staff meeting: nudge the GM roughly every two weeks ──────
    if (Math.floor(nextDay / STAFF_MEETING_INTERVAL) > Math.floor(this.currentDay / STAFF_MEETING_INTERVAL)) {
      this.pushNews(
        'league',
        'Staff meeting: time to review how we play',
        'Two weeks on, your coaching staff are ready to sit down. Review the head coach’s system and roster fit, push for tactical changes, and flag any players whose form or morale needs addressing.',
        { teamId: this.userTeamId as string }
      )
    }
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
        this.recordBoxScore(game.id as string, this.lastBoxScore)
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
        this.recordBoxScore(`${g.seriesId}-g${g.gameNumber}`, this.lastBoxScore)
        if (watchUser) watched = this.buildWatched(g.homeTeamId, g.awayTeamId, res.stream)
      }
      // World Chronicle: playoff meetings count toward the all-time matchup record.
      chronicleMeeting(this.chronicle, {
        homeTeamId: g.homeTeamId as string,
        awayTeamId: g.awayTeamId as string,
        homeGoals: res.homeGoals,
        awayGoals: res.awayGoals,
        overtime: res.decidedBy !== 'regulation',
        year: this.year,
      })
      const series = po.rounds.flatMap((r) => r.series).find((s) => s.id === g.seriesId)
      if (series?.winnerTeamId) {
        // Series decided today (one game per series per day → fires exactly once).
        const loserTeamId =
          series.winnerTeamId === series.highSeedTeamId ? series.lowSeedTeamId : series.highSeedTeamId
        const winAbbr = this.data.teams.get(series.winnerTeamId)?.abbreviation ?? '???'
        const loseAbbr = this.data.teams.get(loserTeamId)?.abbreviation ?? '???'
        const winGames = series.winnerTeamId === series.highSeedTeamId ? series.highSeedWins : series.lowSeedWins
        const loseGames = series.winnerTeamId === series.highSeedTeamId ? series.lowSeedWins : series.highSeedWins
        chronicleSeries(this.chronicle, {
          winnerTeamId: series.winnerTeamId as string,
          loserTeamId: loserTeamId as string,
          year: this.year,
        })
        chronicleEvent(this.chronicle, {
          year: this.year,
          day,
          kind: 'playoffSeries',
          teamIds: [series.winnerTeamId as string, loserTeamId as string],
          headline: `${winAbbr} defeat ${loseAbbr} ${winGames}–${loseGames}`,
          details: { result: `${winAbbr} ${winGames}–${loseGames} ${loseAbbr}` },
          userInvolved:
            series.winnerTeamId === this.userTeamId || loserTeamId === this.userTeamId,
        })
      }
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
      // World Chronicle: the championship is forever.
      chronicleEvent(this.chronicle, {
        year: this.year,
        day,
        kind: 'championship',
        teamIds: [po.championTeamId as string],
        headline: `${champ.name} win the ${this.year} championship`,
        userInvolved: po.championTeamId === this.userTeamId,
      })
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
    // M4: continuing past a staged season review lets it lapse — the owner
    // notices you didn't show.
    if (this.reviewFacts) {
      this.reviewFacts = null
      this.pushNews(
        'league',
        'You skipped the season review',
        'The board met to close the book on the season; you sent regrets. The minutes note your absence.',
        { teamId: this.userTeamId as string }
      )
    }
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
          // Season Rhythm M1: judge the board-room promises FIRST, so broken
          // commitments already weigh on confidence/patience when the board
          // renders its season verdict.
          this.evaluateBoardPromises(userFinalRank, madePlayoffs)
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

          // ── Fold the season into the GM's career + reputation. ──
          const userStanding = this.standings.get(this.userTeamId)
          const gm = this.ensureGM()
          recordSeasonResult(gm, {
            wins: userStanding?.wins ?? 0,
            losses: (userStanding?.losses ?? 0) + (userStanding?.overtimeLosses ?? 0),
            madePlayoffs,
            wonCup,
            wonPresidents: userFinalRank === 1,
            finalRank: userFinalRank,
            n: this.data.league.teams.length,
          })
          if (reviewResult.fired) {
            // The board has fired the GM. Close his stint and open the job market so
            // he can catch on elsewhere (the user keeps playing — see acceptGMJob).
            endStint(gm, this.year, 'fired')
            this.gmJobMarket = this.buildGMOpenings(sorted)
          }

          // Season Rhythm M4: stage the End-of-Season Review — same boardroom,
          // same people, your September promises read back with verdicts.
          {
            const facts = this.boardMeetingFacts()
            const promises = this.chronicle.events
              .filter((e) => e.kind === 'promise' && e.userInvolved && e.details?.dueYear === this.year && e.details.resolved)
              .map((e) => ({
                text: e.headline.replace('Board-room promise: ', ''),
                resolved: e.details!.resolved as 'met' | 'missed',
              }))
            this.reviewFacts = {
              year: this.year,
              teamName: this.userTeam.name,
              owner: facts.owner,
              coach: { id: facts.coach.id, name: facts.coach.name, ...(facts.coach.faceId ? { faceId: facts.coach.faceId } : {}) },
              agm: facts.agm,
              finalRank: userFinalRank,
              targetRank: this.boardState.targetRank,
              mandateText: this.boardState.mandateText,
              madePlayoffs,
              wonCup,
              verdict: reviewResult.verdict,
              fired: reviewResult.fired,
              promises,
              confidence: this.boardState.confidence,
              patience: this.boardState.patience,
            }
          }

          // LW4 ripple: one year later, the press re-grades your trades. For
          // each deal you made LAST season, compare what the players actually
          // produced this season — decisions echo, in print.
          {
            const lastYearTrades = this.chronicle.events.filter(
              (e) => e.kind === 'trade' && e.userInvolved && e.year === this.year - 1 &&
                e.teamIds[0] === (this.userTeamId as string)
            )
            const pts = (pid: string): number => {
              const s = this.totals.get(asPlayerId(pid))
              return s ? s.goals + s.assists : 0
            }
            for (const trade of lastYearTrades.slice(0, 2)) {
              const gavePlayers = (trade.details?.assetsOut ?? []).filter((a) => a.kind === 'player' && a.playerId)
              const gotPlayers = (trade.details?.assetsIn ?? []).filter((a) => a.kind === 'player' && a.playerId)
              if (gavePlayers.length === 0 && gotPlayers.length === 0) continue
              const gavePts = gavePlayers.reduce((s, a) => s + pts(a.playerId!), 0)
              const gotPts = gotPlayers.reduce((s, a) => s + pts(a.playerId!), 0)
              const verdictLine =
                gotPts > gavePts + 10 ? 'A year on, the ledger reads clearly in your favour.'
                : gavePts > gotPts + 10 ? 'A year on, the other side of the deal is aging better — the papers noticed.'
                : 'A year on, the deal reads about even. Time may still pick a winner.'
              this.pushNews(
                'trade',
                `One year later: re-grading the ${trade.year} trade`,
                `${trade.headline}. This season the players you acquired produced ${gotPts} points; ` +
                `the ones you gave up produced ${gavePts}. ${verdictLine}`,
                { teamId: this.userTeamId as string }
              )
            }
          }

          // ── Fanbase: the season's result moves the needle on fan engagement. ──
          const fanDelta = fanInterestDelta({
            finalRank: userFinalRank,
            n: this.data.league.teams.length,
            madePlayoffs,
            wonCup,
            rebuilding: this.clubDirection === 'rebuild' || this.boardState.rebuildSanctioned === true,
          })
          if (fanDelta !== 0) {
            const before = this.fanInterest
            this.fanInterest = Math.max(0, Math.min(100, this.fanInterest + fanDelta))
            if (Math.abs(this.fanInterest - before) >= 6) {
              this.pushNews(
                'league',
                fanDelta > 0 ? 'The fans are buying in' : 'The fans are drifting away',
                `${fanInterestLabel(this.fanInterest)}. ${fanDelta > 0 ? 'Engagement is up' : 'Engagement is down'} after this season — and that shapes what ownership puts on the table next year.`,
                { teamId: this.userTeamId as string }
              )
            }
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

        // Stanley Cup honours: every player on the champion's roster gets a Cup
        // award for this season, so it shows as a trophy badge on his profile and
        // counts toward his career haul.
        if (champTeam) {
          for (const id of champTeam.roster) {
            const pl = this.data.players.get(id)
            if (!pl) continue
            this.recordsState.awards.push({
              year: this.year,
              award: 'Stanley Cup',
              playerId: id as string,
              playerName: pl.name,
              teamAbbr: champTeam.abbreviation,
              value: 'Champion',
            })
          }
        }

        // International honours: an annual World Championship hands Gold/Silver/
        // Bronze to the three strongest nations; every player on a medal roster
        // earns a medal (→ medal badge on his profile). No-ops on single-nation DBs.
        // The marquee senior international event: an Olympics every fourth year
        // (best-on-best, far bigger prize), the World Championship otherwise.
        const isOlympicYear = this.year % 4 === 0
        const intlEvent = isOlympicYear ? 'Olympics' : 'World Championship'
        const worlds = runWorldChampionship({ players: this.data.players.values(), rng: this.rngFor(8013) })
        for (const m of worlds.medals) {
          for (const id of m.playerIds) {
            const pl = this.data.players.get(id)
            if (!pl) continue
            this.recordsState.awards.push({
              year: this.year,
              award: `${isOlympicYear ? 'Olympic' : 'World Championship'} ${m.medal}`,
              playerId: id as string,
              playerName: pl.name,
              teamAbbr: m.nation,
              value: `${m.medal} medal`,
            })
          }
        }
        const goldNation = worlds.medals.find((m) => m.medal === 'Gold')
        if (goldNation) {
          this.pushNews(
            'league',
            isOlympicYear ? `${goldNation.nation} win Olympic gold` : `${goldNation.nation} win World Championship gold`,
            `${isOlympicYear ? 'On the sport\'s biggest stage, ' : ''}${goldNation.nation} top the ${intlEvent} podium, with ${worlds.medals.find((m) => m.medal === 'Silver')?.nation ?? '—'} taking silver and ${worlds.medals.find((m) => m.medal === 'Bronze')?.nation ?? '—'} bronze.`,
          )
        }

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
            // Owner-investment perk: a funded development-staff upgrade gives
            // the user's own organisation a modest tailwind this season.
            const perkMod = this.ownerPerk === 'development' && tid === this.userTeamId ? 1.15 : 1
            return lockerMod * this.mentorshipDevBonus(id as string) * perkMod
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
        const classCount = Math.max(
          DRAFT_CLASS_SIZE,
          this.data.league.teams.length * DRAFT_ROUNDS + 30
        )
        // Prefer REAL eligibles from the imported junior/college/European world.
        // Only when the world can't field a deep enough class (the generated
        // league, or a thin mod) do we synthesize fictional prospects — keeping
        // the generated-league path byte-identical.
        const realEligibles = this.realDraftEligibles()
        const neededPicks = this.data.league.teams.length * DRAFT_ROUNDS
        let draftClass: DraftClass
        if (realEligibles.length >= neededPicks) {
          draftClass = buildDraftClassFromPlayers({
            year: draftYear,
            eligible: realEligibles,
            count: classCount,
            rng: this.rngFor(8002),
          })
        } else {
          const cls = generateDraftClass({
            year: draftYear,
            // Enough prospects for all 7 rounds of every team, plus a margin who go
            // undrafted (realistic — not every eligible is picked).
            count: classCount,
            rng: this.rngFor(8002),
            nextPlayerNumber: () => this.playerCounter++,
          })
          for (const p of cls.players) {
            this.data.players.set(p.id, p)
            this.data.league.players.push(p.id)
          }
          draftClass = cls.draftClass
        }
        this.data.league.draftClasses.push(draftClass)

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
          prospects: draftClass.prospects.map((pr) => {
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
          `${draftClass.prospects.length} prospects are on the board across ${DRAFT_ROUNDS} rounds.`
        )
        // Fire draft preview report (once per season).
        for (const kind of checkDraftStage(this.pressScheduleState)) {
          this.queueScheduledReport(kind as Parameters<typeof this.queueScheduledReport>[0])
        }
        return true
      }
      case 'draft': {
        // The entry draft must be conducted from the Draft screen — Continue
        // cannot sim past it. The user sims to their picks, drafts a prospect,
        // or auto-drafts the rest there; only once every pick is in does the
        // offseason resume. Returning false halts advance() / step() cleanly.
        if (os.draft && os.draft.selections.length < os.draft.order.length) return false
        this.pushDraftRecap()
        const rng = this.rngFor(8003)
        for (const team of this.data.teams.values()) repairLines(team, this.data.players)
        this.resignStatus.clear()
        for (const id of this.userTeam.roster) {
          if (this.resolve(id).contract.yearsRemaining === 0) this.resignStatus.set(id, 'pending')
        }
        this.generateOfferSheets()
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
        // Season Rhythm M3: development camp opens right after the draft — the
        // coaches' first live look at the class, delivered as a report.
        this.pushDevCampReport()
        os.stage = 'resign'
        return true
      }
      case 'resign': {
        // Any offer sheet the GM ignored resolves as a walk — the RFA signs with
        // the suitor and the compensation comes back. (Decline mutates the list.)
        for (const sheet of [...this.offerSheets]) this.declineOfferSheet(sheet.playerId)
        const { expired } = processExpiries({
          teams: this.data.teams,
          players: this.data.players,
          year: this.year,
        })
        // Season Rhythm M2 — ARBITRATION: the user's unsigned RFAs don't just
        // walk to the open market; they file. An arbitrator sets a one-year
        // award near their ask, and the club faces the classic ultimatum:
        // accept the number, or walk away and lose him for nothing.
        const arbFiled = new Set<string>()
        for (const e of expired) {
          if (e.teamId !== this.userTeamId) continue
          const p = this.data.players.get(e.playerId)
          if (!p || contractStatus(p) !== 'RFA' || ratedOverall(p) < 60) continue
          // Arbitration is RARE in real life: only established RFAs are
          // eligible (past the entry-level years), and filing is a choice —
          // the confident, high-value ones go to a hearing; the rest simply
          // reach the market unsigned. Expect 0-2 cases in a normal summer.
          if (p.age < 23) continue
          const fileChance = ratedOverall(p) >= 70 ? 0.65 : 0.3
          if (!this.rngFor(8010, Career.pidNum(e.playerId as string)).chance(fileChance)) continue
          const ask = askTerms(p, this.year)
          const award = Math.round(ask.salary * this.rngFor(8009, Career.pidNum(e.playerId as string)).float(0.98, 1.12) / 25000) * 25000
          this.arbitrationCases.push({ playerId: e.playerId as string, salary: award, years: 1 })
          arbFiled.add(e.playerId as string)
          this.pushNews(
            'contract',
            `${p.name} files for arbitration`,
            `Unsigned and restricted, ${p.name} has taken the club to arbitration. The arbitrator's award: ` +
            `$${(award / 1e6).toFixed(2)}M × 1 year. Accept it and he's signed at that number — or walk away and he ` +
            `becomes an unrestricted free agent. Decide before free agency closes; an unanswered award binds the club.`,
            { playerId: e.playerId as string }
          )
        }
        this.faPool = [...expired.map((e) => e.playerId).filter((id) => !arbFiled.has(id as string)), ...this.buyoutFas]
        this.buyoutFas = []
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
        // World Chronicle: every signing writes provenance (future "he walked on
        // us in free agency" callbacks); notable ones get a chronicle event.
        for (const s of res.signings) {
          const p = this.resolve(s.playerId)
          recordAcquisition(this.chronicle, {
            playerId: s.playerId as string, teamId: s.teamId as string,
            year: this.year, via: 'signing',
          })
          if (p.overall >= 75) {
            const t = this.data.teams.get(s.teamId)!
            chronicleEvent(this.chronicle, {
              year: this.year, day: 0, kind: 'signing',
              teamIds: [s.teamId as string], playerIds: [s.playerId as string],
              headline: `${t.abbreviation} sign ${p.position} ${p.name} ($${(s.salary / 1e6).toFixed(1)}M × ${s.years}y)`,
              details: { salary: s.salary, years: s.years },
              userInvolved: s.teamId === this.userTeamId,
            })
          }
        }
        // Season Rhythm M2 — July 1 is a FRENZY, not a queue. Day one gets the
        // full roundup with real money; day two a recap; later days only names
        // that matter (the August lull is authentic — let it be quiet).
        if (os.faDay === 1 && res.signings.length > 0) {
          const total = res.signings.reduce((sum, s) => sum + s.salary * s.years, 0)
          const top = [...res.signings]
            .sort((a, b) => b.salary - a.salary)
            .slice(0, 5)
            .map((s) => {
              const p = this.resolve(s.playerId)
              const t = this.data.teams.get(s.teamId)!
              return `${p.name} → ${t.abbreviation} ($${(s.salary / 1e6).toFixed(2)}M × ${s.years}y)`
            })
          const spendByTeam = new Map<string, number>()
          for (const s of res.signings) {
            spendByTeam.set(s.teamId as string, (spendByTeam.get(s.teamId as string) ?? 0) + s.salary * s.years)
          }
          const [bigSpenderId, bigSpend] = [...spendByTeam.entries()].sort((a, b) => b[1] - a[1])[0]!
          const spender = this.data.teams.get(asTeamId(bigSpenderId))!
          const spenderGm = bigSpenderId === (this.userTeamId as string) ? null : this.gmPersonaFor(asTeamId(bigSpenderId))
          this.pushNews(
            'contract',
            `FRENZY: $${(total / 1e6).toFixed(0)}M committed as free agency opens`,
            `The market opened at noon and the money moved fast — ${res.signings.length} signings on day one, ` +
            `$${(total / 1e6).toFixed(0)}M in total commitments. The big tickets: ${top.join('; ')}. ` +
            `Biggest spender: ${spender.name} at $${(bigSpend / 1e6).toFixed(0)}M${spenderGm ? ` — ${spenderGm.name} (${spenderGm.styleLabel}) came to shop` : ''}.`,
            { teamId: bigSpenderId }
          )
        } else if (os.faDay === 2 && res.signings.length > 0) {
          const names = res.signings.slice(0, 4).map((s) => this.resolve(s.playerId).name)
          this.pushNews(
            'contract',
            'Frenzy, day two: the second wave signs',
            `The market kept moving: ${names.join(', ')} all found homes as clubs filled the holes day one left open.`,
            {}
          )
        }
        // Individual signing items: notable names only (no firehose of depth deals).
        for (const s of res.signings) {
          const p = this.resolve(s.playerId)
          if (p.overall < 72 && os.faDay > 2) continue
          if (os.faDay <= 2 && p.overall < 70) continue
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
          // Unanswered arbitration awards bind the club (cap permitting).
          for (const c of [...this.arbitrationCases]) this.acceptArbitration(c.playerId)
          for (const c of [...this.arbitrationCases]) this.walkAwayArbitration(c.playerId) // cap-blocked leftovers walk
          this.runWorldFreeAgency()
          os.stage = 'preseason'
        }
        return true
      }
      case 'preseason': {
        // Graduate rights-held junior/college prospects who have turned pro
        // (aged out of junior) into their org's farm BEFORE the farm sort runs,
        // so a club actually reaps its draft picks instead of leaving them to
        // age out in junior forever.
        this.graduateProspects()
        // Development gate: sort each club's NHL roster vs its AHL affiliate by
        // ability so the best players are up and the rest develop down. AI clubs
        // apply it automatically; the user's club gets a SUGGESTION (he keeps
        // manual control of his own call-ups/send-downs).
        this.reassignFarmSystems()
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
    this.draftRankCache = null // the board changes as prospects come off it
    const d = os.draft
    const idx = d.selections.length
    const pick = d.order[idx]
    if (!pick) throw new Error('draft is complete')
    const team = this.data.teams.get(pick.ownerTeamId)!
    const player = this.resolve(playerId)
    d.selections.push({ overallPick: idx + 1, teamId: pick.ownerTeamId, playerId })
    // Record the rights + draft pedigree on the player so his profile reflects how
    // he entered the league (previously only imported players carried this) and so
    // the org that drafted him holds his rights wherever he plays.
    player.rightsTeamId = pick.ownerTeamId
    player.nhlDrafted = true
    player.nhlDraftEligible = false
    player.draftYear = d.year
    player.draftRound = pick.round
    player.draftOverall = idx + 1
    player.draftClub = team.name
    // A REAL prospect drafted out of a junior/college/European league keeps
    // developing there — the club just holds his rights (no ELC, no roster move,
    // no double-rostering). He graduates into the org later, via the dev gates /
    // farm reassignment, once he turns pro. A GENERATED prospect has no club, so
    // he must join the org now (NHL roster if there's room, else the AHL farm).
    if (this.isAmateurWorldPlayer(playerId)) {
      // rights-only: leave him on his amateur team, untouched contract.
    } else {
      const elc = {
        salary: 900000,
        yearsRemaining: 3,
        expiryYear: this.year + 1 + 3,
        noTradeClause: false,
        twoWay: true,
      }
      if (team.roster.length < ROSTER_HARD_CAP) {
        team.roster.push(playerId)
        player.contract = elc
        this.lockerArrival(pick.ownerTeamId, playerId)
      } else {
        // NHL roster is full — a drafted teenager belongs in the system, not in
        // limbo. Assign him to the club's AHL affiliate (where the offseason farm
        // sort will place him correctly). Without this he was drafted with no team
        // and no contract — an orphaned record.
        const affiliate = team.affiliateId ? this.data.teams.get(team.affiliateId) : undefined
        if (affiliate) {
          affiliate.roster.push(playerId)
          player.contract = elc
          repairLines(affiliate, this.data.players)
        }
      }
    }
    /* ── World Chronicle: every selection, with provenance + trade lineage ── */
    {
      // If this pick changed hands, link the selection to the trade that moved it
      // (so "the 2nd you gave up became X" is answerable later).
      const pickRef = `${d.year}-R${pick.round}-${pick.originalTeamId as string}`
      let viaTradeEventId: string | undefined
      if (pick.ownerTeamId !== pick.originalTeamId) {
        for (let i = this.chronicle.events.length - 1; i >= 0; i--) {
          const e = this.chronicle.events[i]!
          if (e.kind !== 'trade') continue
          const assets = [...(e.details?.assetsOut ?? []), ...(e.details?.assetsIn ?? [])]
          if (assets.some((a) => a.kind === 'pick' && a.pickRef === pickRef)) {
            viaTradeEventId = e.id
            break
          }
        }
      }
      const ev = chronicleEvent(this.chronicle, {
        year: this.year,
        day: 0,
        kind: 'draftPick',
        teamIds: [pick.ownerTeamId as string],
        playerIds: [playerId as string],
        headline: `${team.abbreviation} select ${player.position} ${player.name} (R${pick.round}, #${idx + 1})`,
        details: {
          round: pick.round,
          overallPick: idx + 1,
          ...(viaTradeEventId ? { viaTradeEventId } : {}),
        },
        userInvolved: pick.ownerTeamId === this.userTeamId,
      })
      recordDraftProvenance(this.chronicle, {
        playerId: playerId as string,
        teamId: pick.ownerTeamId as string,
        year: d.year,
        round: pick.round,
        overallPick: idx + 1,
        eventId: ev.id,
      })
      // LW4 ripple: if this pick moved through one of YOUR trades, the game
      // tells you what it became — the moment the name is called.
      if (viaTradeEventId) {
        const trade = this.chronicle.events.find((e) => e.id === viaTradeEventId)
        if (trade?.userInvolved) {
          const youGaveIt = (trade.details?.assetsOut ?? []).some(
            (a) => a.kind === 'pick' && a.pickRef === pickRef
          )
          this.pushNews(
            'draft',
            youGaveIt
              ? `The pick you traded away just became ${player.name}`
              : `The pick you acquired just became ${player.name}`,
            `With the ${d.year} R${pick.round} pick that changed hands in ${trade.year} ` +
            `(${trade.headline}), ${team.name} select ${player.position} ${player.name} at #${idx + 1}. ` +
            (youGaveIt
              ? `Every deal has a long tail — this is that pick's face now. Watch his career with interest.`
              : `That's your return maturing. The scouts' book on him starts today.`),
            { playerId: playerId as string }
          )
        }
      }
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

  /** Sim AI picks until `stop()` says hold (e.g. user on the clock) or draft ends.
   *  Each pick is seeded by its own slot index so the AI's choice is identical
   *  no matter how the GM steps the draft (pick-by-pick, to-my-pick, or all). */
  private simDraftUntil(stop: () => boolean): void {
    const os = this.offseason
    if (!os?.draft) return
    const d = os.draft
    while (d.selections.length < d.order.length) {
      const pick = d.order[d.selections.length]
      if (pick.ownerTeamId === this.userTeamId && stop()) return
      const remaining = this.remainingProspects()
      if (remaining.length === 0) return
      const choice =
        pick.ownerTeamId === this.userTeamId
          ? remaining[0]
          : aiSelectProspect({
              remaining,
              rng: this.rngFor(8005, d.selections.length),
              needBonus: (p) => this.draftNeedBonus(pick.ownerTeamId, p),
              boardBias: (p) => this.teamDraftBias(pick.ownerTeamId, p),
            })
      this.makeSelection(choice.playerId)
    }
  }

  /** UI: sim exactly ONE pick. No-op if YOU are on the clock (you pick yourself)
   *  or the draft is done — so it steps through AI selections one at a time. */
  simNextPick(): void {
    const os = this.offseason
    if (!os?.draft) return
    const d = os.draft
    if (d.selections.length >= d.order.length) return
    const pick = d.order[d.selections.length]
    if (pick.ownerTeamId === this.userTeamId) return
    const remaining = this.remainingProspects()
    if (remaining.length === 0) return
    const choice = aiSelectProspect({
      remaining,
      rng: this.rngFor(8005, d.selections.length),
      needBonus: (p) => this.draftNeedBonus(pick.ownerTeamId, p),
      boardBias: (p) => this.teamDraftBias(pick.ownerTeamId, p),
    })
    this.makeSelection(choice.playerId)
  }

  /** A club's private board variance on a prospect: a small, deterministic rank
   *  nudge (±~2.5) per (team, prospect) so different AI orgs value the same kid
   *  slightly differently instead of all sharing the public consensus board. */
  private teamDraftBias(teamId: TeamId, p: DraftProspect): number {
    let h = 2166136261
    const s = `${teamId as string}:${p.playerId as string}`
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
    return (((h >>> 0) % 100000) / 100000 - 0.5) * 5
  }

  /**
   * How much an AI club wants a prospect for positional need (0+). Counts org
   * depth (NHL + AHL) at the prospect's position group against a target; the
   * thinner the group, the bigger the nudge, capped so it never trumps a clearly
   * better player. Deterministic.
   */
  private draftNeedBonus(teamId: TeamId, prospect: DraftProspect): number {
    const p = this.data.players.get(asPlayerId(prospect.playerId as string))
    if (!p) return 0
    const grpOf = (pos: Position): 'F' | 'D' | 'G' =>
      pos === 'G' ? 'G' : pos === 'D' || pos === 'LD' || pos === 'RD' ? 'D' : 'F'
    const team = this.data.teams.get(teamId)
    if (!team) return 0
    const ids = [...team.roster]
    if (team.affiliateId) ids.push(...(this.data.teams.get(team.affiliateId)?.roster ?? []))
    const count: Record<'F' | 'D' | 'G', number> = { F: 0, D: 0, G: 0 }
    for (const id of ids) {
      const pl = this.data.players.get(id)
      if (pl) count[grpOf(pl.position)]++
    }
    const target: Record<'F' | 'D' | 'G', number> = { F: 16, D: 9, G: 4 }
    const grp = grpOf(p.position)
    const scarcity = Math.max(0, target[grp] - count[grp])
    return Math.min(6, scarcity * 1.5)
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

  /** UI: sim the ENTIRE remaining draft, auto-picking best-available for the
   *  user's own picks. Used by the "Sim entire draft" button. */
  autoDraft(): void {
    this.simDraftUntil(() => false)
  }

  /** True once every pick in the current draft has been made (or no draft). */
  private draftComplete(): boolean {
    const d = this.offseason?.draft
    return !d || d.selections.length >= d.order.length
  }

  /** True when the offseason is sitting on an unfinished draft — Continue is
   *  blocked and the UI should route the GM into the Draft screen. */
  draftPending(): boolean {
    return this.offseason?.stage === 'draft' && !this.draftComplete()
  }

  /** Drop a post-draft recap into the inbox: your haul, with the best value
   *  (slid furthest past the consensus board) and any notable reach called out. */
  private pushDraftRecap(): void {
    const os = this.offseason
    if (!os?.draft) return
    const d = os.draft
    const cls = this.data.league.draftClasses.find((c) => c.year === d.year)
    const rankOf = new Map(cls?.prospects.map((p) => [p.playerId as string, p.rank]) ?? [])
    const mine = d.selections.filter((s) => s.teamId === this.userTeamId)
    if (mine.length === 0) return
    const picks = mine.map((s) => {
      const p = this.resolve(s.playerId)
      const cons = rankOf.get(s.playerId as string) ?? s.overallPick
      return { name: p.name, pos: p.position, overall: s.overallPick, cons, delta: s.overallPick - cons }
    })
    const haul = picks.map((p) => `#${p.overall} ${p.name} (${p.pos})`).join(', ')
    const lines = [`Your haul: ${haul}.`]
    const steal = [...picks].sort((a, b) => b.delta - a.delta)[0]
    if (steal && steal.delta >= 6) {
      lines.push(`Best value: ${steal.name} slid to #${steal.overall} with the consensus board on him at #${steal.cons}.`)
    }
    const reach = [...picks].sort((a, b) => a.delta - b.delta)[0]
    if (reach && reach.delta <= -10 && reach !== steal) {
      lines.push(`A swing: we went early on ${reach.name} (#${reach.overall}; board #${reach.cons}) — our scouts liked him more than the room.`)
    }
    this.pushNews('draft', `${d.year} Draft recap — ${this.userTeam.abbreviation}`, lines.join(' '), {
      playerId: mine[0].playerId as string,
    })
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
      const ratingAcc = this.seasonRatingTotals.get(pid as string)
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
        plusMinus: t.plusMinus,
        penaltyMinutes: t.penaltyMinutes,
        saves: t.saves,
        shotsAgainst: t.shotsAgainst,
        goalsAgainst: t.goalsAgainst,
        shutouts: 0,
        ...(ratingAcc && ratingAcc.n > 0 ? { avgRating: Math.round((ratingAcc.sum / ratingAcc.n) * 100) / 100 } : {}),
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

    // Fanbase → owner budget: an engaged fanbase fills the building and the owner
    // opens the chequebook; an empty barn tightens it. Scales a captured baseline
    // so it never compounds. (Capture lazily on the first rollover.)
    {
      const fin = this.userTeam.finances
      if (this.baseBudget === 0) this.baseBudget = fin.budget
      fin.budget = Math.round(this.baseBudget * budgetFactor(this.fanInterest))
    }

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
    // Re-derive each team's system from its head coach for the new roster.
    this.applyCoachSystems()

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
    this.seasonRatingTotals.clear()
    this.hireableStaff = []
    this.coachMarket = null // fresh slate of available coaches each offseason
    // Keep practiceState team focus across seasons (intentional persistence)
    // Season-scoped arcs close; feuds/mentorships/milestone chases carry over.
    for (const arc of this.arcsState.arcs) {
      if (arc.status === 'resolved') continue
      if (arc.kind === 'feud' || arc.kind === 'mentorship' || arc.kind === 'milestoneWatch') {
        // Durable arcs live on — stamp a continuity beat so the saga reads across years.
        arc.beats.push({ day: 0, year: newYear, summary: `The story carries into the ${newYear} season.` })
        continue
      }
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
      // Capture last season's story BEFORE the mandate rolls over — the owner
      // opens next year's board meeting with these exact numbers.
      const wonCupLastYear =
        (this.playoffs?.championTeamId as string | null) === (this.userTeamId as string)
      const actualRank = finalRanks.get(this.userTeamId as string)
      if (actualRank !== undefined) {
        this.lastSeasonMeta = {
          predictedRank: this.boardState.targetRank,
          actualRank,
          madePlayoffs: actualRank <= 16,
          wonCup: wonCupLastYear,
        }
      }
      const boardResult = setSeasonMandate({
        teamStrengthRank: this.userStrengthRank(),
        teamsInLeague: this.data.league.teams.length,
        lastYearRank: finalRanks.get(this.userTeamId as string),
        wonCupLastYear,
        rng: this.rngFor(9301),
        year: newYear,
        teamId: this.userTeamId as string,
        teamName: this.userTeam.name,
      })
      this.boardState = boardResult.state
      this.pushSeeds([boardResult.newsSeed])
      // Season Rhythm M1: schedule next preseason's board meeting; perks lapse.
      this.boardMeetingYear = newYear
      this.ownerPerk = null
      // M4: an unattended season review lapses quietly (its news already ran).
      this.reviewFacts = null
      // Deadline-day hold re-arms for the new season.
      this.deadlineHold = false
      this.deadlineHoldDone = false
      // Last season's box scores don't need to survive the summer.
      this.boxScoreHistory = []
      // Buyout dead cap is a one-season penance — the books clear.
      if (this.userDeadCap > 0) {
        this.pushNews(
          'contract',
          'Buyout charges come off the books',
          `The dead cap from last summer's buyouts ($${(this.userDeadCap / 1e6).toFixed(2)}M) has cleared. The ledger is clean.`,
          { teamId: this.userTeamId as string }
        )
        this.userDeadCap = 0
      }
    }
    decayIntensity(this.rivalriesState, newYear)
    // Reset special-teams for the new season.
    this.specialTeams = []
    // Reset hot/cold streak tracking for the new season.
    this.teamStreaks.clear()

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

  /* ── saved line setups (named depth-chart presets) ───────────────────────── */
  /** Named snapshots of the user's line board, so the GM can keep e.g. an
   *  "Even strength" and a "Shut-down" setup and swap between them. */
  private lineSetups: Array<{ name: string; lines: Lines }> = []

  /** Save the current line board under a name (overwrites a same-named preset). */
  saveLineSetup(name: string): { ok: boolean } {
    const trimmed = name.trim().slice(0, 40)
    if (!trimmed) return { ok: false }
    const lines = structuredClone(this.userTeam.lines)
    const existing = this.lineSetups.findIndex((s) => s.name.toLowerCase() === trimmed.toLowerCase())
    if (existing >= 0) this.lineSetups[existing] = { name: trimmed, lines }
    else this.lineSetups.push({ name: trimmed, lines })
    return { ok: true }
  }

  /** Apply a saved preset to the user's line board (repaired for legality, so a
   *  since-traded or injured player is swapped out rather than breaking it). */
  applyLineSetup(name: string): { ok: boolean } {
    const setup = this.lineSetups.find((s) => s.name.toLowerCase() === name.trim().toLowerCase())
    if (!setup) return { ok: false }
    this.userTeam.lines = structuredClone(setup.lines)
    repairLines(this.userTeam, this.data.players)
    return { ok: true }
  }

  deleteLineSetup(name: string): { ok: boolean } {
    const i = this.lineSetups.findIndex((s) => s.name.toLowerCase() === name.trim().toLowerCase())
    if (i < 0) return { ok: false }
    this.lineSetups.splice(i, 1)
    return { ok: true }
  }

  /** Names of the saved line presets, in save order. */
  getLineSetupNames(): string[] {
    return this.lineSetups.map((s) => s.name)
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

  /** Season Rhythm M2: the buyout window. During the offseason (re-sign and
   *  free-agency stages) a club can eat a bad contract: the player becomes a
   *  free agent and ONE-THIRD of his remaining money sticks to next season's
   *  cap as a dead charge (simplified from the NHL's 2/3-over-2x-years rule —
   *  one painful season instead of a long tail). */
  buyoutContract(playerId: string): { ok: boolean; message: string; charge?: number } {
    const os = this.offseason
    if (this.phase !== 'offseason' || !os || (os.stage !== 'resign' && os.stage !== 'freeAgency')) {
      return { ok: false, message: 'The buyout window is only open during the offseason (before the season starts).' }
    }
    const pid = asPlayerId(playerId)
    if (!this.userTeam.roster.includes(pid)) {
      return { ok: false, message: 'He is not on your NHL roster.' }
    }
    const p = this.resolve(pid)
    if (p.contract.yearsRemaining < 1) {
      return { ok: false, message: 'His contract is already expiring — let him walk for free instead.' }
    }
    const remaining = p.contract.salary * p.contract.yearsRemaining
    const charge = Math.round(remaining / 3)
    // The player walks: off the roster, contract terminated, into free agency.
    releaseFromTeam({ team: this.userTeam, playerId: pid, players: this.data.players })
    this.lockerDeparture(this.userTeamId, pid)
    repairLines(this.userTeam, this.data.players)
    p.contract.yearsRemaining = 0
    if (os.stage === 'freeAgency') this.faPool.push(pid)
    else this.buyoutFas.push(pid)
    this.userDeadCap += charge
    this.pushNews(
      'contract',
      `${p.name} bought out`,
      `The club has bought out the remainder of ${p.name}'s contract. He becomes an unrestricted free agent; ` +
      `$${(charge / 1e6).toFixed(2)}M in dead cap stays on next season's books. Expensive freedom — but freedom.`,
      { playerId }
    )
    chronicleEvent(this.chronicle, {
      year: this.year, day: 0, kind: 'release',
      teamIds: [this.userTeamId as string], playerIds: [playerId],
      headline: `${this.userTeam.abbreviation} buy out ${p.position} ${p.name} ($${(charge / 1e6).toFixed(2)}M dead cap)`,
      details: { salary: p.contract.salary },
      userInvolved: true,
    })
    const txResult = recordTransaction(this.transactionLedger, {
      day: this.currentDay, year: this.year, kind: 'release',
      teamIds: [this.userTeamId as string],
      summary: `${this.userTeam.abbreviation} buy out ${p.name}.`,
    })
    this.transactionLedger = txResult.ledger
    return { ok: true, message: `${p.name} bought out — $${(charge / 1e6).toFixed(2)}M dead cap next season.`, charge }
  }

  /** Pending arbitration cases (for the offseason screen). */
  getArbitrationCases(): Array<{ playerId: string; name: string; position: string; age: number; salary: number; years: number }> {
    return this.arbitrationCases.map((c) => {
      const p = this.data.players.get(asPlayerId(c.playerId))
      return {
        playerId: c.playerId, name: p?.name ?? '—', position: p?.position ?? '?',
        age: p?.age ?? 0, salary: c.salary, years: c.years,
      }
    })
  }

  /** Accept the arbitrator's award: he signs at that number, like it or not. */
  acceptArbitration(playerId: string): { ok: boolean; message: string } {
    const c = this.arbitrationCases.find((x) => x.playerId === playerId)
    if (!c) return { ok: false, message: 'No arbitration case for that player.' }
    const p = this.data.players.get(asPlayerId(playerId))
    if (!p) return { ok: false, message: 'Player not found.' }
    const capUsed = this.userTeam.roster.reduce(
      (sum, rid) => sum + (this.data.players.get(rid)?.contract.salary ?? 0), 0)
    if (capUsed + this.userDeadCap + c.salary > this.userTeam.finances.salaryCap) {
      return { ok: false, message: 'The award does not fit under your cap — clear space or walk away.' }
    }
    signPlayer({ team: this.userTeam, player: p, salary: c.salary, years: c.years, year: this.year, players: this.data.players })
    this.faPool = this.faPool.filter((id) => (id as string) !== playerId)
    this.arbitrationCases = this.arbitrationCases.filter((x) => x.playerId !== playerId)
    this.lockerArrival(this.userTeamId, asPlayerId(playerId))
    repairLines(this.userTeam, this.data.players)
    this.pushNews(
      'contract',
      `${p.name} signs his arbitration award`,
      `The club accepts the arbitrator's number: $${(c.salary / 1e6).toFixed(2)}M × ${c.years} year. Nobody hugged.`,
      { playerId }
    )
    return { ok: true, message: `${p.name} signed at the award: $${(c.salary / 1e6).toFixed(2)}M.` }
  }

  /** Walk away from the award: he becomes a UFA and the market gets him. */
  walkAwayArbitration(playerId: string): { ok: boolean; message: string } {
    const c = this.arbitrationCases.find((x) => x.playerId === playerId)
    if (!c) return { ok: false, message: 'No arbitration case for that player.' }
    const p = this.data.players.get(asPlayerId(playerId))
    this.arbitrationCases = this.arbitrationCases.filter((x) => x.playerId !== playerId)
    if (!this.faPool.some((id) => (id as string) === playerId)) this.faPool.push(asPlayerId(playerId))
    if (p) {
      this.pushNews(
        'contract',
        `Club walks away from ${p.name}'s award`,
        `The arbitrator said $${(c.salary / 1e6).toFixed(2)}M; the club said no. ${p.name} is now an unrestricted free agent — and the league knows exactly what he costs.`,
        { playerId }
      )
    }
    return { ok: true, message: p ? `Walked away — ${p.name} hits the open market.` : 'Walked away.' }
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
   * Offseason development gate: for every NHL club with an AHL affiliate, sort the
   * combined NHL+AHL pool by current ability so the best players are on the NHL
   * roster and the rest develop in the AHL. AI clubs apply it; the user's club
   * gets a SUGGESTION in the inbox instead (he keeps manual roster control).
   */
  private posGroup(pos: Position): 'F' | 'D' | 'G' {
    return pos === 'G' ? 'G' : pos === 'D' || pos === 'LD' || pos === 'RD' ? 'D' : 'F'
  }

  /** The overall of the org's weakest NHL regular at a position group — the bar a
   *  teenager must clear to make the jump straight to the NHL out of camp. */
  private orgNhlBar(org: Team, grp: 'F' | 'D' | 'G'): number {
    const slot = grp === 'F' ? 12 : grp === 'D' ? 6 : 2
    const ovrs = org.roster
      .map((id) => this.data.players.get(id))
      .filter((p): p is Player => !!p && this.posGroup(p.position) === grp)
      .map((p) => ratedOverall(p))
      .sort((a, b) => b - a)
    return ovrs[slot - 1] ?? 0
  }

  /**
   * Sign and promote rights-held amateurs who have turned pro. A drafted junior
   * keeps developing in his league with the club holding his rights; then:
   *  - an ELITE 18/19yo who'd be an NHL regular jumps STRAIGHT to the NHL roster
   *    out of camp (juniors can't be assigned to the AHL before 20), and
   *  - once he ages out of junior (20+) he signs his ELC and joins the org's AHL
   *    affiliate (the subsequent farm sort then elevates the NHL-ready ones).
   * Without this a club would draft prospects who never actually arrive.
   * No-op for the generated league / mods without wider-world competitions.
   */
  private graduateProspects(): void {
    const comps = this.data.league.competitions
    if (!comps || comps.length === 0) return
    const elc = (): Player['contract'] => ({
      salary: 900000, yearsRemaining: 3, expiryYear: this.year + 1 + 3, noTradeClause: false, twoWay: true,
    })
    const touchedAhl = new Set<TeamId>()
    const touchedNhl = new Set<TeamId>()
    for (const c of comps) {
      if (isProLeagueAbbrev(c.abbrev)) continue
      for (const tid of c.teamIds) {
        const wt = this.data.teams.get(tid as TeamId)
        if (!wt) continue
        const stay: PlayerId[] = []
        for (const pid of wt.roster) {
          const p = this.data.players.get(pid)
          if (!p || !p.nhlDrafted || !p.rightsTeamId) { stay.push(pid); continue }
          const org = this.data.teams.get(p.rightsTeamId)
          if (!org) { stay.push(pid); continue }
          const grp = this.posGroup(p.position)
          const ovr = ratedOverall(p)
          // Elite teenager who'd crack the NHL lineup → straight to the NHL.
          const nhlReady = p.age < 20 && ovr >= 72 && ovr >= this.orgNhlBar(org, grp)
          if (p.age >= 20 || nhlReady) {
            const ahl = org.affiliateId ? this.data.teams.get(org.affiliateId) : undefined
            const dest = nhlReady ? org : ahl
            if (!dest) { stay.push(pid); continue }
            p.contract = elc()
            dest.roster.push(pid)
            if (dest === org) touchedNhl.add(org.id)
            else touchedAhl.add(dest.id)
            if (p.rightsTeamId === this.userTeamId) {
              this.pushNews(
                'contract',
                nhlReady ? `${p.name} makes the NHL out of camp` : `${p.name} turns pro`,
                nhlReady
                  ? `${p.name} (${p.position}, ${p.age}) was too good to send back to junior — he's signed his entry-level deal and cracked the NHL roster.`
                  : `${p.name} (${p.position}, ${p.age}) has signed his entry-level contract and reports to ${dest.name}.`,
                { playerId: pid as string }
              )
            }
          } else {
            stay.push(pid)
          }
        }
        if (stay.length !== wt.roster.length) {
          wt.roster = stay
          repairLines(wt, this.data.players)
        }
      }
    }
    for (const aid of touchedAhl) { const t = this.data.teams.get(aid); if (t) repairLines(t, this.data.players) }
    for (const nid of touchedNhl) { const t = this.data.teams.get(nid); if (t) repairLines(t, this.data.players) }
  }

  /** Season Rhythm M3: the July development-camp report — the staff's first
   *  live look at the draft class and the org's young prospects. Fog-aware
   *  prose (no numbers), deterministic reads, and a small scouting-knowledge
   *  bump: watching your own kids skate for a week genuinely teaches you. */
  private pushDevCampReport(): void {
    const staff = this.getTeamStaff(this.userTeamId as string)
    const coachName = staff.headCoach?.name ?? 'The coaching staff'
    // The org's young guns: this year's draftees first, then rights-held and
    // farm prospects, U23 only, best potential first.
    const draftedIds = new Set(
      this.chronicle.events
        .filter((e) => e.kind === 'draftPick' && e.year === this.year && e.teamIds[0] === (this.userTeamId as string))
        .flatMap((e) => e.playerIds)
    )
    const affiliate = this.userTeam.affiliateId ? this.data.teams.get(this.userTeam.affiliateId) : undefined
    const orgYoung = new Map<string, Player>()
    for (const [pid, p] of this.data.players) {
      const id = pid as string
      if (p.age > 23) continue
      const inOrg =
        draftedIds.has(id) ||
        (p.rightsTeamId as string | undefined) === (this.userTeamId as string) ||
        this.userTeam.roster.includes(pid) ||
        (affiliate?.roster.includes(pid) ?? false)
      if (inOrg) orgYoung.set(id, p)
    }
    if (orgYoung.size === 0) return
    const invitees = [...orgYoung.values()]
      .sort((a, b) => {
        const da = draftedIds.has(a.id as string) ? 1 : 0
        const db = draftedIds.has(b.id as string) ? 1 : 0
        return db - da || overall(b.potential, b.position) - overall(a.potential, a.position)
      })
      .slice(0, 8)

    const lines: string[] = []
    for (const p of invitees) {
      // Deterministic camp read; watching him closes a sliver of the fog.
      const z = this.rngFor(9501, this.year, Career.pidNum(p.id as string)).float(-1, 1)
      const drafted = draftedIds.has(p.id as string)
      const tag = drafted ? ' (this year\'s pick)' : ''
      if (z > 0.5) {
        lines.push(`${p.name}${tag} — turned heads all week. ${p.position === 'G' ? 'Tracked pucks like a veteran' : 'Quicker release and better pace than the book had'}; the staff want him back for main camp.`)
      } else if (z < -0.5) {
        lines.push(`${p.name}${tag} — a step behind the group. Nothing alarming at his age, but the summer homework list is long.`)
      } else {
        lines.push(`${p.name}${tag} — solid, unspectacular week. Exactly where a kid his age should be.`)
      }
      // Knowledge bump: you watched him for a week.
      const entry = this.scouting.knowledge.find(([id]) => id === (p.id as string))
      if (entry) entry[1] = Math.min(100, entry[1] + 4)
      else this.scouting.knowledge.push([p.id as string, 8])
    }
    this.pushNews(
      'scouting',
      `Development camp report — ${coachName}`,
      `Development camp wrapped this week: ${invitees.length} of the organisation's young players on the ice, ` +
      `this year's draft class included. The staff's reads:\n\n• ${lines.join('\n• ')}`,
      { teamId: this.userTeamId as string }
    )
  }

  private reassignFarmSystems(): void {
    // Waiver-required veterans aren't dumped to the farm over a small ability dip.
    const scorer = (p: Player): number => overall(p.composites, p.position) + this.waiverProtection(p)
    for (const team of this.data.teams.values()) {
      if (team.tier === 'ahl' || team.tier === 'world') continue
      const ahlId = team.affiliateId
      const ahl = ahlId ? this.data.teams.get(ahlId) : undefined
      if (!ahl) continue

      const split = farmSplit({
        nhlRoster: team.roster,
        ahlRoster: ahl.roster,
        resolve: (id) => this.data.players.get(id),
        score: scorer,
      })
      if (split.promoted.length === 0 && split.demoted.length === 0) continue

      if (team.id === this.userTeamId) {
        // Season Rhythm M3: suggest, don't apply — but frame it as what it IS:
        // training camp's position battles, with the waiver trap flagged in
        // red. The best 23 is not always the safest 23.
        const staff = this.getTeamStaff(this.userTeamId as string)
        const coachName = staff.headCoach?.name ?? 'The coaching staff'
        const battleLines: string[] = []
        for (const id of split.promoted.slice(0, 5)) {
          const p = this.data.players.get(id)
          if (!p) continue
          battleLines.push(`▲ ${p.name} (${p.position}) won his camp battle — he's making it impossible to send him down. Recommend he starts in the NHL.`)
        }
        for (const id of split.demoted.slice(0, 5)) {
          const p = this.data.players.get(id)
          if (!p) continue
          if (this.requiresWaivers(p)) {
            battleLines.push(`▼ ${p.name} (${p.position}) lost the numbers game — but ⚠ HE NEEDS WAIVERS to go down. Send him to the farm and any club can claim him for nothing. The best 23 isn't always the safest 23.`)
          } else {
            battleLines.push(`▼ ${p.name} (${p.position}) lost the numbers game. Waiver-exempt — he can develop in the AHL and be recalled any time.`)
          }
        }
        this.pushNews(
          'contract',
          `Training camp report — ${coachName} on the battles`,
          `Camp is over and the battles have verdicts. The staff's recommendations:\n\n${battleLines.join('\n')}\n\n` +
          `(These are recommendations — make the calls yourself on the squad and farm screens.)`,
          { teamId: this.userTeamId as string }
        )
        continue
      }

      // AI club: apply the split and rebuild both rosters' lines.
      team.roster = split.nhl
      ahl.roster = split.ahl
      repairLines(team, this.data.players)
      repairLines(ahl, this.data.players)
    }
  }

  /**
   * "Ask the coach to set the roster" — auto-applies the coach's recommended NHL
   * roster for the USER's club: the best players by ability (regardless of contract
   * type) fill a standard 14F/7D/2G NHL roster, the rest develop in the AHL. Returns
   * the player NAMES moved each way so the screen can report exactly what he did.
   */
  /**
   * Roster-keep protection for waiver-required players. A one-way veteran can't be
   * sent to the AHL without clearing waivers (risking losing him for nothing), so
   * the auto-roster must have a VERY good reason — a big ability gap — before it
   * demotes him. Two-way contracts and young (often waiver-exempt) players carry
   * no protection. Bigger contracts and older vets are protected more.
   */
  private waiverProtection(p: Player): number {
    if (p.contract.twoWay !== false) return 0 // two-way → free to move
    if (p.age < 23) return 0 // young one-way deals are usually still waiver-exempt
    let bonus = 10
    if (p.contract.salary >= 4_000_000) bonus += 4
    if (p.age >= 32) bonus += 3
    return bonus
  }

  /** A one-way veteran must clear waivers to go to the AHL; young/two-way players
   *  are exempt. Shared rule lives in contracts.ts (also drives the squad UI). */
  private requiresWaivers(p: Player): boolean {
    return requiresWaiversRule(p)
  }

  /**
   * Run a waiver-required player through the wire on a send-down. Other clubs get
   * a shot in worst-record-first priority; the first one for whom he'd be a roster
   * upgrade (and who has the cap + roster room) claims him for free — his contract
   * goes with him. Returns the claiming team, or null if he clears. On a claim the
   * player is moved onto the claimant's roster (caller removes him from the source).
   */
  private processWaivers(p: Player, fromTeamId: TeamId, skipTeamId?: TeamId): Team | null {
    const grp = this.posGroup(p.position)
    const ovr = ratedOverall(p)
    const order = sortStandings([...this.standings.values()]).map((s) => s.teamId).reverse()
    for (const tid of order) {
      if (tid === fromTeamId) continue
      if (skipTeamId && tid === skipTeamId) continue
      const team = this.data.teams.get(tid)
      if (!team || team.tier === 'ahl' || team.tier === 'world') continue
      if (team.roster.length >= ROSTER_HARD_CAP) continue
      const capUsed = team.roster.reduce((s, id) => s + (this.data.players.get(id)?.contract.salary ?? 0), 0)
      if (capUsed + p.contract.salary > team.finances.salaryCap) continue
      // Claim if he'd be a regular (or close) on this club — bad teams, with the
      // lowest bars and the highest priority, scoop up useful vets first.
      if (ovr >= this.orgNhlBar(team, grp) - 2) {
        team.roster.push(p.id)
        repairLines(team, this.data.players)
        return team
      }
    }
    return null
  }

  applyCoachRoster(): { promoted: string[]; demoted: string[] } {
    const nhl = this.data.teams.get(this.userTeamId)
    const ahlId = this.userTeam.affiliateId
    const ahl = ahlId ? this.data.teams.get(ahlId as TeamId) : undefined
    if (!nhl || !ahl) return { promoted: [], demoted: [] }

    const grp = (p: Player): 'F' | 'D' | 'G' =>
      p.position === 'G' ? 'G' : p.position === 'D' || p.position === 'LD' || p.position === 'RD' ? 'D' : 'F'
    const resolveAll = (ids: PlayerId[]): Player[] =>
      ids.map((id) => this.data.players.get(id)).filter((p): p is Player => p !== undefined)

    const wasNhl = new Set(nhl.roster.map((id) => id as string))

    // The user's head coach weighs form/morale/condition alongside skill, so a
    // hot AHL player can earn a call-up over a cold NHL regular within a band.
    const coach = this.getTeamStaff(this.userTeamId as string).headCoach
    const targets: Record<'F' | 'D' | 'G', number> = { F: 14, D: 7, G: 2 }
    const byGroup: Record<'F' | 'D' | 'G', Player[]> = { F: [], D: [], G: [] }
    for (const p of [...resolveAll(nhl.roster), ...resolveAll(ahl.roster)]) byGroup[grp(p)].push(p)
    const keep = (p: Player): number => coachAdjustedScore(p, coach) + this.waiverProtection(p)
    for (const key of ['F', 'D', 'G'] as const) byGroup[key].sort((a, b) => keep(b) - keep(a))

    const newNhl: PlayerId[] = []
    const newAhl: PlayerId[] = []
    for (const key of ['F', 'D', 'G'] as const) {
      byGroup[key].forEach((p, i) => (i < targets[key] ? newNhl : newAhl).push(p.id))
    }

    // Snapshot the pre-set split so the GM can one-click Undo the coach's moves.
    this.coachRosterUndo = { nhl: [...nhl.roster], ahl: [...ahl.roster] }

    nhl.roster = newNhl
    ahl.roster = newAhl
    repairLines(nhl, this.data.players)
    repairLines(ahl, this.data.players)

    const nameOf = (id: PlayerId): string => this.data.players.get(id)?.name ?? ''
    return {
      promoted: newNhl.filter((id) => !wasNhl.has(id as string)).map(nameOf).filter(Boolean),
      demoted: newAhl.filter((id) => wasNhl.has(id as string)).map(nameOf).filter(Boolean),
    }
  }

  /** Snapshot of the NHL/AHL rosters before the last coach auto-set, for Undo.
   *  In-memory only (no persistence) — a within-session convenience. */
  private coachRosterUndo: { nhl: PlayerId[]; ahl: PlayerId[] } | null = null

  /** Revert the most recent "ask coach to set roster" — restores the exact
   *  NHL/AHL split that was in place beforehand. No-op if nothing to undo. */
  undoCoachRoster(): { ok: boolean } {
    const snap = this.coachRosterUndo
    if (!snap) return { ok: false }
    const nhl = this.data.teams.get(this.userTeamId)
    const ahlId = this.userTeam.affiliateId
    const ahl = ahlId ? this.data.teams.get(ahlId as TeamId) : undefined
    if (!nhl || !ahl) return { ok: false }
    nhl.roster = [...snap.nhl]
    ahl.roster = [...snap.ahl]
    repairLines(nhl, this.data.players)
    repairLines(ahl, this.data.players)
    this.coachRosterUndo = null
    return { ok: true }
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
  sendDown(playerId: string): { ok: true; note?: string } | { ok: false; reason: string } {
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

    const isUser = nhlTeam.id === this.userTeamId

    // Waiver wire: a one-way veteran must clear waivers to be assigned. If a club
    // claims him, he's gone — his contract goes with him.
    if (this.requiresWaivers(p)) {
      const claimant = this.processWaivers(p, nhlTeam.id)
      if (claimant) {
        nhlTeam.roster = nhlTeam.roster.filter((id) => id !== pid)
        repairLines(nhlTeam, this.data.players)
        if (isUser) {
          this.pushNews(
            'contract',
            `${p.name} CLAIMED off waivers by ${claimant.abbreviation}`,
            `You tried to send ${p.name} (${p.position}, ${p.age}) to the AHL, but he required waivers — ${claimant.name} claimed him and his contract. He's gone for nothing.`,
            { playerId, teamId: claimant.id as string }
          )
          const tx = recordTransaction(this.transactionLedger, {
            day: this.currentDay, year: this.year, kind: 'release', teamIds: [nhlTeam.id as string, claimant.id as string],
            summary: `${claimant.abbreviation} claims ${p.name} off waivers from ${nhlTeam.abbreviation}.`,
          })
          this.transactionLedger = tx.ledger
        }
        return { ok: true, note: `${p.name} was claimed off waivers by ${claimant.name}.` }
      }
    }

    // Cleared (or exempt) → assign to the AHL affiliate.
    nhlTeam.roster = nhlTeam.roster.filter((id) => id !== pid)
    ahlTeam.roster.push(pid)
    repairLines(nhlTeam, this.data.players)
    repairLines(ahlTeam, this.data.players)

    const cleared = this.requiresWaivers(p)
    if (isUser) {
      this.pushNews(
        'contract',
        `${p.name} assigned to ${ahlTeam.abbreviation}`,
        `${p.name} (${p.position}, ${p.age})${cleared ? ' cleared waivers and' : ' has been'} assigned to the AHL affiliate.`,
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

    return cleared ? { ok: true, note: `${p.name} cleared waivers.` } : { ok: true }
  }

  // ──────────────────────── in-season waiver wire ────────────────────────
  /** Calendar-day window a player sits on the wire before claims resolve. With
   *  NHL match days ~2–3 days apart this gives the GM one "Continue" to decide. */
  private static readonly WAIVER_WINDOW_DAYS = 2

  /** Players AI clubs have exposed on the in-season waiver wire. While an entry is
   *  live the USER may claim the player (cap + roster permitting); when it expires
   *  AI clubs get a worst-first crack, else he reports to the placing club's AHL.
   *  The player STAYS on his club's roster while exposed — he only moves on a claim
   *  or at resolution, so no roster minimum is ever breached mid-window. */
  private waiverWire: Array<{ playerId: string; fromTeamId: string; placedDay: number }> = []

  /** Weekly: AI clubs put a clearly-surplus one-way veteran (sitting below their
   *  NHL bar, blocking nobody useful) on waivers. Bounded to ~2 leaguewide per pass
   *  so the wire never floods, and never more than one body per club at a time. */
  private generateWaiverPlacements(day: number): void {
    const rng = new Rng(deriveSeed(this.seed, 9281, day))
    let placed = 0
    for (const tid of this.data.league.teams) {
      if (placed >= 2) break
      if ((tid as string) === (this.userTeamId as string)) continue
      if (this.waiverWire.some((w) => w.fromTeamId === (tid as string))) continue
      const team = this.data.teams.get(tid)
      if (!team || team.tier === 'ahl' || team.tier === 'world') continue
      if (!team.affiliateId) continue // need an AHL to send the clearer to
      const cand = team.roster
        .map((id) => this.data.players.get(id))
        .filter((p): p is Player => !!p && p.injuryStatus === null && this.requiresWaivers(p))
        .filter((p) => ratedOverall(p) < this.orgNhlBar(team, this.posGroup(p.position)) - 3)
        .sort((a, b) => ratedOverall(a) - ratedOverall(b))[0]
      if (!cand) continue
      if (!rng.chance(0.5)) continue // not every eligible club, every week
      this.waiverWire.push({ playerId: cand.id as string, fromTeamId: tid as string, placedDay: day })
      placed++
      this.pushNews(
        'contract',
        `${cand.name} placed on waivers by ${team.abbreviation}`,
        `${team.name} have placed ${cand.name} (${cand.position}, ${cand.age}, $${(cand.contract.salary / 1_000_000).toFixed(2)}M) on waivers. ` +
          `You have until the wire clears to claim him and his contract — head to the Waiver Wire to put in a claim.`,
        { playerId: cand.id as string, teamId: tid as string }
      )
    }
  }

  /** Resolve any wire entries whose window has elapsed. The user already had their
   *  claim window, so only AI clubs (worst-first) are offered the player here; if
   *  none bite he reports to the placing club's AHL affiliate. */
  private resolveExpiredWaivers(nextDay: number): void {
    if (this.waiverWire.length === 0) return
    const remaining: typeof this.waiverWire = []
    for (const w of this.waiverWire) {
      if (nextDay - w.placedDay < Career.WAIVER_WINDOW_DAYS) {
        remaining.push(w)
        continue
      }
      const fromId = asTeamId(w.fromTeamId)
      const from = this.data.teams.get(fromId)
      const p = this.data.players.get(asPlayerId(w.playerId))
      if (!from || !p || !from.roster.includes(p.id)) continue // traded/gone — drop it
      const claimant = this.processWaivers(p, fromId, this.userTeamId)
      if (claimant) {
        from.roster = from.roster.filter((id) => id !== p.id)
        repairLines(from, this.data.players)
        const tx = recordTransaction(this.transactionLedger, {
          day: nextDay, year: this.year, kind: 'release', teamIds: [fromId as string, claimant.id as string],
          summary: `${claimant.abbreviation} claims ${p.name} off waivers from ${from.abbreviation}.`,
        })
        this.transactionLedger = tx.ledger
      } else {
        const ahl = from.affiliateId ? this.data.teams.get(from.affiliateId) : undefined
        if (ahl) {
          from.roster = from.roster.filter((id) => id !== p.id)
          ahl.roster.push(p.id)
          repairLines(from, this.data.players)
          repairLines(ahl, this.data.players)
        }
      }
    }
    this.waiverWire = remaining
  }

  /** Players currently claimable on the in-season waiver wire (user-facing view). */
  getWaiverWire(): WaiverWireRowView[] {
    const user = this.data.teams.get(this.userTeamId)
    if (!user) return []
    const capUsed = user.roster.reduce((s, id) => s + (this.data.players.get(id)?.contract.salary ?? 0), 0)
    const capSpace = user.finances.salaryCap - capUsed
    return this.waiverWire.map((w) => {
      const p = this.resolve(asPlayerId(w.playerId))
      const from = this.data.teams.get(asTeamId(w.fromTeamId))
      const rosterFull = user.roster.length >= ROSTER_HARD_CAP
      const overCap = p.contract.salary > capSpace
      const canClaim = !rosterFull && !overCap
      return {
        ...badge(p),
        fromTeamAbbr: from?.abbreviation ?? '???',
        fromTeamName: from?.name ?? 'Unknown',
        salary: p.contract.salary,
        yearsRemaining: p.contract.yearsRemaining,
        twoWay: p.contract.twoWay !== false,
        claimDeadlineInDays: Math.max(0, w.placedDay + Career.WAIVER_WINDOW_DAYS - this.currentDay),
        canClaim,
        ...(canClaim ? {} : { blockReason: rosterFull ? 'Roster full (26)' : 'No cap space' }),
      }
    })
  }

  /** Claim a player off the in-season waiver wire onto the user's NHL roster. His
   *  contract comes with him. Fails (without throwing) on cap/roster constraints. */
  claimWaiver(playerId: string): { ok: true; note: string } | { ok: false; reason: string } {
    const w = this.waiverWire.find((x) => x.playerId === playerId)
    if (!w) return { ok: false, reason: 'That player is no longer on the waiver wire.' }
    const p = this.data.players.get(asPlayerId(playerId))
    const from = this.data.teams.get(asTeamId(w.fromTeamId))
    const user = this.data.teams.get(this.userTeamId)
    if (!p || !from || !user) return { ok: false, reason: 'Player not found.' }
    if (!from.roster.includes(p.id)) {
      this.waiverWire = this.waiverWire.filter((x) => x.playerId !== playerId)
      return { ok: false, reason: 'That player is no longer available.' }
    }
    if (user.roster.length >= ROSTER_HARD_CAP) {
      return { ok: false, reason: 'Your roster is full (26 players). Make room before claiming.' }
    }
    const capUsed = user.roster.reduce((s, id) => s + (this.data.players.get(id)?.contract.salary ?? 0), 0)
    if (capUsed + p.contract.salary > user.finances.salaryCap) {
      return { ok: false, reason: 'Claiming him would put you over the salary cap.' }
    }
    from.roster = from.roster.filter((id) => id !== p.id)
    user.roster.push(p.id)
    repairLines(from, this.data.players)
    repairLines(user, this.data.players)
    this.waiverWire = this.waiverWire.filter((x) => x.playerId !== playerId)
    this.pushNews(
      'contract',
      `Claimed ${p.name} off waivers`,
      `You claimed ${p.name} (${p.position}, ${p.age}) off waivers from ${from.name}. His contract ` +
        `($${(p.contract.salary / 1_000_000).toFixed(2)}M, ${p.contract.yearsRemaining}yr) is now on your books.`,
      { playerId, teamId: this.userTeamId as string }
    )
    const tx = recordTransaction(this.transactionLedger, {
      day: this.currentDay, year: this.year, kind: 'signing', teamIds: [this.userTeamId as string, from.id as string],
      summary: `${user.abbreviation} claims ${p.name} off waivers from ${from.abbreviation}.`,
    })
    this.transactionLedger = tx.ledger
    return { ok: true, note: `${p.name} claimed off waivers.` }
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

  /** Draft-pick compensation owed for letting an offer-sheeted RFA walk, by AAV
   *  (NHL CBA tiers scaled to the $88M cap). Returns the rounds to surrender. */
  private offerSheetComp(salary: number): number[] {
    if (salary <= 1_500_000) return []
    if (salary <= 2_400_000) return [3]
    if (salary <= 4_800_000) return [2]
    if (salary <= 7_200_000) return [1, 3]
    if (salary <= 9_600_000) return [1, 2, 3]
    return [1, 1, 2, 3]
  }

  /** Rival GMs tender offer sheets to the user's best RFAs during the re-sign
   *  window — you must match the price or let him walk for pick compensation. */
  private generateOfferSheets(): void {
    this.offerSheets = []
    const rng = this.rngFor(8009)
    const rivals = this.data.league.teams
      .filter((t) => t !== this.userTeamId)
      .map((t) => this.data.teams.get(t)!)
      .filter((t) => t && t.tier !== 'ahl')
    for (const [id, status] of this.resignStatus) {
      if (status !== 'pending') continue
      const p = this.resolve(id)
      if (contractStatus(p) !== 'RFA') continue
      const ovr = ratedOverall(p)
      if (ovr < 68) continue
      // Better players are likelier to draw a sheet; a 78+ stud always does.
      const chance = Math.min(0.95, (ovr - 64) / 16)
      if (ovr < 78 && !rng.chance(chance)) continue
      const ask = askTerms(p, this.year)
      const salary = Math.round(ask.salary * 1.1) // rivals overpay to pry him loose
      // A rival with the cap room to carry the deal (a full roster just clears a
      // spot for him — handled on decline).
      const suitor = rivals.find((t) => {
        const capUsed = t.roster.reduce((s, x) => s + (this.data.players.get(x)?.contract.salary ?? 0), 0)
        return capUsed + salary <= t.finances.salaryCap
      })
      if (!suitor) continue
      this.offerSheets.push({ playerId: id as string, fromTeamId: suitor.id as string, salary, years: Math.max(ask.years, 4) })
      this.pushNews(
        'contract',
        `${suitor.abbreviation} tenders an offer sheet to ${p.name}`,
        `${suitor.name} has tabled a ${p.contract ? '' : ''}$${(salary / 1e6).toFixed(2)}M × ${Math.max(ask.years, 4)} offer sheet for your RFA ${p.name}. Match it to keep him, or let him walk for draft-pick compensation.`,
        { playerId: id as string, teamId: suitor.id as string }
      )
    }
  }

  /** Match a rival offer sheet — re-sign your RFA at the offered terms. */
  matchOfferSheet(playerId: string): { ok: boolean; message: string } {
    const os = this.offseason
    if (!os || os.stage !== 'resign') return { ok: false, message: 'The re-sign window is closed.' }
    const sheet = this.offerSheets.find((s) => s.playerId === playerId)
    if (!sheet) return { ok: false, message: 'No offer sheet for this player.' }
    const player = this.resolve(asPlayerId(playerId))
    try {
      signPlayer({ team: this.userTeam, player, salary: sheet.salary, years: sheet.years, year: this.year, players: this.data.players })
    } catch {
      return { ok: false, message: `You can't fit the $${(sheet.salary / 1e6).toFixed(2)}M cap hit — he walks unless you clear space.` }
    }
    this.resignStatus.set(asPlayerId(playerId), 'signed')
    this.offerSheets = this.offerSheets.filter((s) => s.playerId !== playerId)
    this.pushNews('contract', `${player.name} matched & retained`, `You matched the offer sheet — ${player.name} stays at $${(sheet.salary / 1e6).toFixed(2)}M × ${sheet.years}.`, { playerId })
    return { ok: true, message: `Matched. ${player.name} stays.` }
  }

  /** Let an offer-sheeted RFA walk — he joins the rival and you collect the
   *  draft-pick compensation. */
  declineOfferSheet(playerId: string): { ok: boolean; message: string } {
    const os = this.offseason
    if (!os || os.stage !== 'resign') return { ok: false, message: 'The re-sign window is closed.' }
    const sheet = this.offerSheets.find((s) => s.playerId === playerId)
    if (!sheet) return { ok: false, message: 'No offer sheet for this player.' }
    const player = this.resolve(asPlayerId(playerId))
    const suitor = this.data.teams.get(asTeamId(sheet.fromTeamId))!
    // Player leaves the user's org for the rival.
    this.userTeam.roster = this.userTeam.roster.filter((id) => (id as string) !== playerId)
    repairLines(this.userTeam, this.data.players)
    // A full suitor clears a spot — its weakest body goes to the farm.
    if (suitor.roster.length >= ROSTER_HARD_CAP && suitor.affiliateId) {
      const ahl = this.data.teams.get(suitor.affiliateId)
      if (ahl) {
        const weakest = [...suitor.roster].sort((a, b) => ratedOverall(this.resolve(a)) - ratedOverall(this.resolve(b)))[0]
        if (weakest) {
          suitor.roster = suitor.roster.filter((id) => id !== weakest)
          ahl.roster.push(weakest)
          repairLines(ahl, this.data.players)
        }
      }
    }
    signPlayer({ team: suitor, player, salary: sheet.salary, years: sheet.years, year: this.year, players: this.data.players })
    // Compensation: the rival's picks (their slot) for the next draft go to you.
    const compYear = this.year + 1
    const rounds = this.offerSheetComp(sheet.salary)
    for (const round of rounds) {
      this.picks.push({ year: compYear, round, originalTeamId: suitor.id, ownerTeamId: this.userTeamId })
    }
    this.resignStatus.delete(asPlayerId(playerId))
    this.offerSheets = this.offerSheets.filter((s) => s.playerId !== playerId)
    // Letting a rival poach your RFA sours the relationship with that front office.
    this.adjustRelationship(suitor.id as string, -12)
    const compStr = rounds.length ? rounds.map((r) => `R${r}`).join(' + ') + ` (${compYear})` : 'no compensation (below threshold)'
    this.pushNews('contract', `${player.name} leaves on an offer sheet`, `${player.name} signs with ${suitor.name}. Compensation: ${compStr}.`, { playerId, teamId: suitor.id as string })
    return { ok: true, message: `${player.name} walks; you receive ${compStr}.` }
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
    // Dead cap from buyouts is real: the signing must fit under ceiling MINUS
    // the dead charge, or the buyout was free money.
    const capUsedNow = this.userTeam.roster.reduce(
      (sum, rid) => sum + (this.data.players.get(rid)?.contract.salary ?? 0), 0)
    if (capUsedNow + this.userDeadCap + salary > this.userTeam.finances.salaryCap) {
      return {
        signed: false,
        message: `That contract doesn't fit under the cap once your $${(this.userDeadCap / 1e6).toFixed(2)}M in buyout dead cap is counted.`,
      }
    }
    const ask = askTerms(player, this.year)
    const rng = this.rngFor(8007, os.faDay, Number((playerId.match(/\d+/) ?? ['0'])[0]))
    if (!offerAcceptable(player, { salary, years }, ask, rng)) {
      return {
        signed: false,
        message: `He wants more — around $${(ask.salary / 1e6).toFixed(2)}M × ${ask.years}.`,
      }
    }
    // ── Bidding war: a sought-after UFA fields competing offers. A fair-but-not-
    // generous bid can lose to a cap-capable rival; overpaying suppresses interest. ──
    const ovr = ratedOverall(player)
    if (ovr >= 78) {
      const generosity = salary / Math.max(1, ask.salary)
      const rivalChance = Math.max(0, Math.min(0.6, (ovr - 76) / 40 - (generosity - 1) * 0.8))
      if (rng.chance(rivalChance)) {
        const suitor = this.findOutbiddingRival(ask.salary)
        if (suitor) {
          signPlayer({ team: suitor, player, salary: ask.salary, years: Math.max(years, ask.years), year: this.year, players: this.data.players })
          this.faPool = this.faPool.filter((f) => (f as string) !== playerId)
          this.lockerArrival(suitor.id, id)
          repairLines(suitor, this.data.players)
          this.adjustRelationship(suitor.id as string, -4) // beaten to a target stings a little
          this.pushNews(
            'contract',
            `${player.name} spurns your offer, signs with ${suitor.abbreviation}`,
            `You were in on ${player.name}, but ${suitor.name} swooped in with a stronger package. He's off the board.`,
            { playerId, teamId: suitor.id as string }
          )
          return { signed: false, message: `${suitor.name} outbid you for ${player.name}. Move fast or pay up next time.` }
        }
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
    // World Chronicle: your signings are part of your permanent record.
    recordAcquisition(this.chronicle, {
      playerId, teamId: this.userTeamId as string, year: this.year, via: 'signing',
    })
    chronicleEvent(this.chronicle, {
      year: this.year, day: 0, kind: 'signing',
      teamIds: [this.userTeamId as string], playerIds: [playerId],
      headline: `${this.userTeam.abbreviation} sign ${player.position} ${player.name} ($${(salary / 1e6).toFixed(1)}M × ${years}y)`,
      details: { salary, years },
      userInvolved: true,
    })
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
      relationship: this.relationshipWith(partnerId as string),
      // Living World LW3: the partner's stance flows from his GM's persona +
      // the club's live posture, not a static hash.
      philosophy: personaPhilosophy(this.gmPersonaFor(partnerId), this.clubPostureFor(partnerId).posture),
      // LW3 realism: what THIS club would pay, in THIS moment of the season —
      // rentals to contenders near the deadline, futures to sellers.
      context: {
        posture: this.clubPostureFor(partnerId).posture,
        deadlineProximity: Math.max(0, Math.min(1, 1 - Math.max(0, this.deadlineDay - this.currentDay) / 45)),
      },
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
      this.chronicleTrade({
        teamAId: this.userTeamId,
        teamBId: partnerId,
        aGivesPlayerIds: give.players.map((p) => p.id),
        aGivesPicks: give.picks,
        bGivesPlayerIds: receive.players.map((p) => p.id),
        bGivesPicks: receive.picks,
      })
      // A completed deal builds rapport with that front office.
      this.adjustRelationship(partnerId as string, 6)
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
    this.chronicleTrade({
      teamAId: this.userTeamId,
      teamBId: offer.partnerTeamId,
      aGivesPlayerIds: offer.userGivesPlayerIds,
      aGivesPicks: offer.userGivesPicks,
      bGivesPlayerIds: offer.userReceivesPlayerIds,
      bGivesPicks: offer.userReceivesPicks,
    })
  }

  rejectTrade(offerId: string): void {
    this.tradeOffers = this.tradeOffers.filter((o) => o.offerId !== offerId)
  }

  private tradingOpen(): boolean {
    return this.phase === 'regularSeason' && this.currentDay <= this.deadlineDay
  }

  /** The named GM running an AI club (Living World LW2). Lazily built once per
   *  club, deterministic per (seed, teamId), persisted so he never changes name
   *  mid-save. */
  gmPersonaFor(teamId: TeamId): GmPersona {
    const key = teamId as string
    const existing = this.gmPersonas.find(([id]) => id === key)?.[1]
    if (existing) return existing
    const taken = new Set(this.gmPersonas.map(([, p]) => p.name))
    const persona = buildGmPersona({ seed: this.seed, teamId: key, year: this.year, takenNames: taken })
    this.gmPersonas.push([key, persona])
    return persona
  }

  /** League-wide roster-strength ranks (1 = strongest), computed once per call site. */
  private strengthRanks(): Map<string, number> {
    const teams = this.data.league.teams
    const strengths = teams.map((tid) => {
      const t = this.data.teams.get(tid)!
      return { tid: tid as string, s: teamStrengthRating(t.roster.map((id) => this.resolve(id))) }
    }).sort((a, b) => b.s - a.s)
    return new Map(strengths.map((e, i) => [e.tid, i + 1]))
  }

  /** A club's competitive stance, derived live from roster shape + league rank. */
  clubPostureFor(teamId: TeamId, ranks?: Map<string, number>): ClubPosture {
    const teams = this.data.league.teams
    const strengthRank = (ranks ?? this.strengthRanks()).get(teamId as string) ?? Math.ceil(teams.length / 2)
    const team = this.data.teams.get(teamId)!
    const top6 = team.roster
      .map((id) => this.resolve(id))
      .sort((a, b) => b.overall - a.overall)
      .slice(0, 6)
    const coreAge = top6.length > 0 ? top6.reduce((s, p) => s + p.age, 0) / top6.length : 27
    return deriveClubPosture({ coreAge, strengthRank, teamCount: teams.length })
  }

  /* ────────────────────────── preseason board meeting (M1) ────────────────────────── */

  /** Assemble the live facts the board-meeting scene is built from. */
  private boardMeetingFacts(): BoardMeetingFacts {
    const staff = this.getTeamStaff(this.userTeamId as string)
    const posture = this.clubPostureFor(this.userTeamId)
    const team = this.userTeam
    const top6 = team.roster.map((id) => this.resolve(id)).sort((a, b) => b.overall - a.overall).slice(0, 6)
    const coreAge = top6.length > 0 ? top6.reduce((s, p) => s + p.age, 0) / top6.length : 27
    // Best U23s across the org (NHL + farm + rights-held), for the AGM's pitch.
    const affiliate = team.affiliateId ? this.data.teams.get(team.affiliateId) : undefined
    const youngIds = [...team.roster, ...(affiliate?.roster ?? [])]
    const prospects = youngIds
      .map((id) => this.resolve(id))
      .filter((p) => p.age <= 23)
      .sort((a, b) => (b.potential ? 1 : 0) - (a.potential ? 1 : 0) || b.overall - a.overall)
      .slice(0, 3)
      .map((p) => p.name)
    const coachProfile = staff.headCoach?.profile
    // Defensive: some generated staffs miss a member — the meeting still holds.
    const owner = staff.owner ?? { id: 'owner', name: 'The Owner' }
    const coach = staff.headCoach ?? { id: 'coach', name: 'The Head Coach' }
    const agm = staff.agm ?? { id: 'agm', name: 'Your Assistant GM' }
    return {
      year: this.year,
      teamName: team.name,
      board: this.boardState,
      owner: {
        id: owner.id, name: owner.name,
        ...(owner.faceId !== undefined ? { faceId: owner.faceId } : {}),
        ...(owner.demeanor !== undefined ? { demeanor: owner.demeanor } : {}),
      },
      coach: {
        id: coach.id, name: coach.name,
        ...(coach.faceId !== undefined ? { faceId: coach.faceId } : {}),
        systemLabel: coachProfile?.meta.label ?? 'his system',
      },
      agm: {
        id: agm.id, name: agm.name,
        ...(agm.faceId !== undefined ? { faceId: agm.faceId } : {}),
      },
      ...(this.lastSeasonMeta ? { lastSeason: this.lastSeasonMeta } : {}),
      capUsed: team.finances.capUsed,
      salaryCap: team.finances.salaryCap,
      posture: posture.posture,
      postureReason: posture.reason,
      coreAge,
      fanInterest: this.fanInterest,
      topProspects: prospects,
      teamCount: this.data.league.teams.length,
    }
  }

  /** The pending preseason board meeting scene, or null if already attended. */
  getBoardMeeting(): BoardMeetingScene | null {
    if (this.boardMeetingYear === null || this.phase !== 'regularSeason') return null
    return buildBoardMeeting(this.boardMeetingFacts(), this.rngFor(9401, this.boardMeetingYear))
  }

  /** Attend the meeting: apply the chosen answers with all their teeth. */
  submitBoardMeeting(choices: Record<string, string>): { ok: boolean; lines: Array<{ speakerId: string; text: string }>; summary: string } {
    const scene = this.getBoardMeeting()
    if (!scene) return { ok: false, lines: [], summary: 'No board meeting is scheduled.' }
    const facts = this.boardMeetingFacts()
    const fx = resolveBoardMeeting(scene, facts, choices)
    this.applyBoardMeetingEffects(fx, choices)
    this.boardMeetingYear = null
    return { ok: true, lines: fx.closingLines, summary: fx.summary }
  }

  private applyBoardMeetingEffects(fx: MeetingEffects, choices: Record<string, string>): void {
    const clamp = (v: number): number => Math.max(0, Math.min(100, v))
    this.boardState.confidence = clamp(this.boardState.confidence + fx.confidenceDelta)
    this.boardState.patience = clamp(this.boardState.patience + fx.patienceDelta)
    if (fx.mandateOverride) {
      this.boardState.mandate = fx.mandateOverride.mandate
      this.boardState.mandateText = fx.mandateOverride.text
    }
    if (fx.targetRankOverride !== undefined) this.boardState.targetRank = fx.targetRankOverride
    if (fx.sanctionRebuild) {
      const res = this.setClubDirection('rebuild')
      if (!res.ok) this.clubDirection = 'retool' // board wouldn't sanction after all
    } else if (fx.direction) {
      this.clubDirection = fx.direction
      if (fx.direction === 'compete') this.boardState.rebuildSanctioned = false
    }
    // Owner-investment perk (season-scoped).
    if (choices['wc-invest']) this.ownerPerk = choices['wc-invest']
    // Every commitment becomes a chronicle promise — the receipts.
    for (const p of fx.promises) {
      chronicleEvent(this.chronicle, {
        year: this.year,
        day: 0,
        kind: 'promise',
        teamIds: [this.userTeamId as string],
        headline: `Board-room promise: ${p.text}`,
        details: {
          promiseKind: p.kind,
          dueYear: p.dueYear,
          value: p.value,
          ...(p.count !== undefined ? { count: p.count } : {}),
        },
        userInvolved: true,
      })
    }
    const receipts = fx.promises.length > 0
      ? ` Commitments on the record: ${fx.promises.map((p) => p.text).join('; ')}.`
      : ''
    this.pushNews(
      'league',
      'Preseason board meeting concluded',
      `${fx.summary}${receipts}`,
      { teamId: this.userTeamId as string }
    )
  }

  /** Season Rhythm M4: the deadline war-room briefing — staged while the sim
   *  is held on deadline day. Everything in it is read from the LIVE market:
   *  postures, personas, expiring contracts, your cap sheet. */
  getWarRoom(): {
    stance: string
    capLine: string
    coachLine: string
    agmLine: string
    targets: Array<{ playerId: string; name: string; position: string; age: number; teamAbbr: string; gmName: string; gmStyle: string }>
    suitors: Array<{ teamAbbr: string; gmName: string; gmStyle: string; wantsName: string }>
    cast: Array<{ id: string; name: string; title: string; faceId?: string }>
  } | null {
    if (!this.deadlineHold) return null
    const staff = this.getTeamStaff(this.userTeamId as string)
    const ranks = this.strengthRanks()
    const myPosture = this.clubPostureFor(this.userTeamId, ranks)
    const buying = myPosture.posture === 'contend'
    const capUsed = this.userTeam.roster.reduce(
      (sum, rid) => sum + (this.data.players.get(rid)?.contract.salary ?? 0), 0)
    const space = this.userTeam.finances.salaryCap - capUsed - this.userDeadCap
    const weakest = this.rosterCounts(this.userTeam)
    const need = weakest.d <= 6 ? 'the blue line' : weakest.g < 2 ? 'the crease' : 'scoring depth'

    // Rentals on selling clubs — what a buyer would actually call about.
    const targets: Array<{ playerId: string; name: string; position: string; age: number; teamAbbr: string; gmName: string; gmStyle: string }> = []
    for (const [tid, team] of this.data.teams) {
      if (targets.length >= 4) break
      if (tid === this.userTeamId || team.tier === 'ahl' || team.tier === 'world') continue
      const posture = this.clubPostureFor(tid, ranks).posture
      if (posture === 'contend') continue // contenders aren't selling
      const gm = this.gmPersonaFor(tid)
      for (const pid of team.roster) {
        if (targets.length >= 4) break
        const p = this.data.players.get(pid)
        if (!p || p.contract.noTradeClause || p.injuryStatus) continue
        if (p.contract.yearsRemaining > 1 || p.age < 27) continue // rentals only
        const value = ratedOverall(p)
        if (value < 74 || p.contract.salary > space) continue
        targets.push({
          playerId: pid as string, name: p.name, position: p.position, age: p.age,
          teamAbbr: team.abbreviation, gmName: gm.name, gmStyle: gm.styleLabel,
        })
      }
    }

    // If we're the seller: which contending GMs are hungriest, and for whom.
    const suitors: Array<{ teamAbbr: string; gmName: string; gmStyle: string; wantsName: string }> = []
    if (!buying) {
      const myRentals = this.userTeam.roster
        .map((id) => this.data.players.get(id))
        .filter((p): p is Player => !!p && p.contract.yearsRemaining <= 1 && p.age >= 27 && !p.contract.noTradeClause)
        .sort((a, b) => ratedOverall(b) - ratedOverall(a))
        .slice(0, 2)
      const contenders = [...this.data.teams.values()]
        .filter((t) => t.id !== this.userTeamId && t.tier !== 'ahl' && t.tier !== 'world' &&
          this.clubPostureFor(t.id, ranks).posture === 'contend')
        .map((t) => ({ t, gm: this.gmPersonaFor(t.id) }))
        .sort((a, b) => b.gm.aggression - a.gm.aggression)
        .slice(0, 3)
      for (let i = 0; i < contenders.length && i < myRentals.length * 2; i++) {
        const c = contenders[i]!
        const want = myRentals[i % Math.max(1, myRentals.length)]
        if (!want) break
        suitors.push({ teamAbbr: c.t.abbreviation, gmName: c.gm.name, gmStyle: c.gm.styleLabel, wantsName: want.name })
      }
    }

    return {
      stance: buying
        ? `We're contenders — ${myPosture.reason}. Today we buy, or we explain to the room why we didn't.`
        : myPosture.posture === 'rebuild'
          ? `We're selling — ${myPosture.reason}. Every expiring veteran is a draft pick wearing skates.`
          : `We're on the fence — ${myPosture.reason}. Pick a side before the phones decide for you.`,
      capLine: this.userDeadCap > 0
        ? `Space to work with: $${(space / 1e6).toFixed(2)}M after $${(this.userDeadCap / 1e6).toFixed(2)}M in dead cap.`
        : `Space to work with: $${(space / 1e6).toFixed(2)}M.`,
      coachLine: `If we add anywhere, add to ${need}. Don't bring me another project — bring me someone who plays TONIGHT.`,
      agmLine: buying
        ? `The sellers' boards are up. These names are realistic — expiring deals we can actually fit.`
        : `The phones started at seven this morning. These are the clubs hungriest for what we have.`,
      targets,
      suitors,
      cast: [
        { id: 'agm', name: staff.agm?.name ?? 'Your Assistant GM', title: 'Assistant GM', ...(staff.agm?.faceId ? { faceId: staff.agm.faceId } : {}) },
        { id: 'coach', name: staff.headCoach?.name ?? 'The Head Coach', title: 'Head Coach', ...(staff.headCoach?.faceId ? { faceId: staff.headCoach.faceId } : {}) },
      ],
    }
  }

  /** The GM skipped the meeting (simmed past it) — the AGM attends instead. */
  private autoResolveBoardMeeting(): void {
    const scene = this.getBoardMeeting()
    if (!scene) { this.boardMeetingYear = null; return }
    const facts = this.boardMeetingFacts()
    const fx = resolveBoardMeeting(scene, facts, boardMeetingDefaults(scene))
    this.applyBoardMeetingEffects(fx, boardMeetingDefaults(scene))
    this.boardMeetingYear = null
    this.pushNews(
      'league',
      `${facts.agm.name} handled the board meeting`,
      `You sent your assistant GM to the preseason board meeting. He played it safe — accepted the objective, made no waves. ${fx.summary}`,
      { teamId: this.userTeamId as string }
    )
  }

  /** The staged End-of-Season Review scene (M4), or null. */
  getSeasonReview(): BoardMeetingScene | null {
    if (!this.reviewFacts) return null
    return buildSeasonReviewScene(this.reviewFacts, this.rngFor(9402, this.reviewFacts.year))
  }

  /** Answer for the season. Applies the small trust effects and closes the scene. */
  submitSeasonReview(choice: string): { ok: boolean; lines: Array<{ speakerId: string; text: string }>; summary: string } {
    if (!this.reviewFacts) return { ok: false, lines: [], summary: 'No review is staged.' }
    const outcome = resolveSeasonReview(this.reviewFacts, choice)
    const clamp = (v: number): number => Math.max(0, Math.min(100, v))
    this.boardState.confidence = clamp(this.boardState.confidence + outcome.confidenceDelta)
    this.boardState.patience = clamp(this.boardState.patience + outcome.patienceDelta)
    if (outcome.summary) {
      this.pushNews('league', 'Season review: the year, answered for', outcome.summary, {
        teamId: this.userTeamId as string,
      })
    }
    this.reviewFacts = null
    return { ok: true, lines: outcome.closingLines, summary: outcome.summary }
  }

  /** Judge this season's board-room promises — the receipts, read back. */
  private evaluateBoardPromises(finalRank: number, madePlayoffs: boolean): void {
    const clamp = (v: number): number => Math.max(0, Math.min(100, v))
    for (const ev of this.chronicle.events) {
      if (ev.kind !== 'promise' || !ev.userInvolved) continue
      if (ev.details?.dueYear !== this.year || ev.details.resolved) continue
      let met: boolean | null = null
      switch (ev.details.promiseKind) {
        case 'finishAtLeast':
          met = finalRank <= (ev.details.value ?? 1)
          break
        case 'playoffBerth':
          met = madePlayoffs
          break
        case 'youthGames': {
          const threshold = ev.details.value ?? 40
          const need = ev.details.count ?? 2
          const youngWithGames = this.userTeam.roster
            .map((id) => this.resolve(id))
            .filter((p) => p.age <= 23 && (this.gp.get(p.id) ?? 0) >= threshold)
          met = youngWithGames.length >= need
          break
        }
        case 'shedSalary':
          met = this.userTeam.finances.capUsed <= this.userTeam.finances.salaryCap
          break
        case 'marqueeName': {
          // Did the user land a big name this season? (chronicled trades)
          met = this.chronicle.events.some(
            (t) =>
              t.kind === 'trade' && t.year === this.year && t.userInvolved &&
              t.teamIds[0] === (this.userTeamId as string) &&
              (t.details?.assetsIn ?? []).some((a) => {
                if (a.kind !== 'player' || !a.playerId) return false
                const p = this.data.players.get(asPlayerId(a.playerId))
                return p !== undefined && p.overall >= 80
              })
          )
          break
        }
      }
      if (met === null) continue
      ev.details.resolved = met ? 'met' : 'missed'
      const promiseText = ev.headline.replace('Board-room promise: ', '')
      if (met) {
        this.boardState.confidence = clamp(this.boardState.confidence + 6)
        this.pushNews(
          'league',
          'A promise kept',
          `At the preseason board meeting you committed to this: "${promiseText}". You delivered. The owner remembers that too.`,
          { teamId: this.userTeamId as string }
        )
      } else {
        this.boardState.confidence = clamp(this.boardState.confidence - 8)
        this.boardState.patience = clamp(this.boardState.patience - 6)
        this.pushNews(
          'league',
          'A promise broken',
          `At the preseason board meeting you committed to this: "${promiseText}". It didn't happen — and the board's trust takes the hit.`,
          { teamId: this.userTeamId as string }
        )
      }
    }
  }

  /** World Chronicle: record a completed trade with full asset lists + player
   *  provenance, so future news can cite the deal ("the 2nd you gave up
   *  became…"). Pure observer — call AFTER executeTrade has moved the assets. */
  private chronicleTrade(args: {
    teamAId: TeamId
    teamBId: TeamId
    aGivesPlayerIds: PlayerId[]
    aGivesPicks: DraftPick[]
    bGivesPlayerIds: PlayerId[]
    bGivesPicks: DraftPick[]
  }): void {
    const abbr = (id: TeamId): string => this.data.teams.get(id)?.abbreviation ?? '???'
    const playerAsset = (pid: PlayerId): { kind: 'player'; playerId: string; label: string } => {
      const p = this.data.players.get(pid)
      return { kind: 'player', playerId: pid as string, label: p ? `${p.position} ${p.name}` : 'a player' }
    }
    const pickAsset = (pk: DraftPick): { kind: 'pick'; pickRef: string; label: string } => ({
      kind: 'pick',
      pickRef: `${pk.year}-R${pk.round}-${pk.originalTeamId as string}`,
      label: `${pk.year} R${pk.round} (${abbr(pk.originalTeamId)})`,
    })
    const assetsOut = [...args.aGivesPlayerIds.map(playerAsset), ...args.aGivesPicks.map(pickAsset)]
    const assetsIn = [...args.bGivesPlayerIds.map(playerAsset), ...args.bGivesPicks.map(pickAsset)]
    const sideLabel = (assets: Array<{ label: string }>): string =>
      assets.map((a) => a.label).join(', ') || 'future considerations'
    const userInvolved = args.teamAId === this.userTeamId || args.teamBId === this.userTeamId
    const ev = chronicleEvent(this.chronicle, {
      year: this.year,
      day: this.phase === 'regularSeason' ? this.currentDay : 0,
      kind: 'trade',
      teamIds: [args.teamAId as string, args.teamBId as string],
      playerIds: [...args.aGivesPlayerIds, ...args.bGivesPlayerIds].map((id) => id as string),
      headline: `${abbr(args.teamAId)} trade ${sideLabel(assetsOut)} to ${abbr(args.teamBId)} for ${sideLabel(assetsIn)}`,
      details: { assetsOut, assetsIn },
      userInvolved,
    })
    // Provenance: every moved player changed organisations via this deal.
    for (const pid of args.aGivesPlayerIds) {
      recordAcquisition(this.chronicle, {
        playerId: pid as string, teamId: args.teamBId as string, year: this.year,
        via: 'trade', fromTeamId: args.teamAId as string, eventId: ev.id,
      })
    }
    for (const pid of args.bGivesPlayerIds) {
      recordAcquisition(this.chronicle, {
        playerId: pid as string, teamId: args.teamAId as string, year: this.year,
        via: 'trade', fromTeamId: args.teamBId as string, eventId: ev.id,
      })
    }
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
    // LW4 ripple: a revenge-game storyline — someone on the other bench used to
    // be yours (traded away or walked in free agency, within the last 3 years).
    const revengeLine = (oppId: TeamId): string | null => {
      const opp = this.data.teams.get(oppId)
      if (!opp) return null
      for (const pid of opp.roster) {
        const prov = this.chronicle.provenance.find(([id]) => id === (pid as string))?.[1]
        if (!prov) continue
        // Find the move that took him OUT of your organisation.
        for (let i = prov.acquisitions.length - 1; i >= 0; i--) {
          const a = prov.acquisitions[i]!
          if (this.year - a.year > 3) break
          const cameFromUs = a.fromTeamId === (this.userTeamId as string)
          const leftUsInFa = a.via === 'signing' && i > 0 && prov.acquisitions[i - 1]!.teamId === (this.userTeamId as string)
          if (cameFromUs || leftUsInFa) {
            const p = this.data.players.get(pid)
            if (!p) break
            return cameFromUs
              ? `📖 ${p.name} faces the club that traded him ${a.year === this.year ? 'this season' : `in ${a.year}`}.`
              : `📖 ${p.name} returns — he walked from your organisation in ${a.year} free agency.`
          }
        }
      }
      return null
    }
    // World Chronicle: the all-time series line vs an opponent ("Leads 12–5 · 1–1 in playoffs").
    const allTimeVs = (oppId: TeamId): string | null => {
      const h = chronicleHeadToHead(this.chronicle, this.userTeamId as string, oppId as string)
      if (!h || h.wins + h.losses === 0) return null
      const lead = h.wins > h.losses ? 'You lead' : h.wins < h.losses ? 'They lead' : 'Series tied'
      const nums = h.wins > h.losses ? `${h.wins}–${h.losses}` : `${h.losses}–${h.wins}`
      const series = h.seriesWins + h.seriesLosses > 0 ? ` · playoff series ${h.seriesWins}–${h.seriesLosses}` : ''
      return `${lead} all-time ${h.wins === h.losses ? `${h.wins}–${h.losses}` : nums}${series}`
    }
    let nextGame: DashboardView['nextGame'] = null
    if (this.phase === 'regularSeason' && nextSched) {
      const home = nextSched.homeTeamId === this.userTeamId
      const opp = this.data.teams.get(home ? nextSched.awayTeamId : nextSched.homeTeamId)!
      const gi = gameIntensity(this.rivalriesState, this.userTeamId as string, opp.id as string)
      const os = this.standings.get(opp.id)
      const oppCoach = this.getTeamStaff(opp.id as string).headCoach
      nextGame = {
        day: nextSched.day,
        date: dayToDateISO(this.year, nextSched.day),
        opponentTeamId: opp.id as string,
        opponentName: opp.name,
        opponentAbbr: opp.abbreviation,
        home,
        opponentRank: sorted.findIndex((s) => s.teamId === opp.id) + 1,
        opponentRecord: os ? `${os.wins}-${os.losses}-${os.overtimeLosses}` : '0-0-0',
        opponentSystem: oppCoach.profile?.meta.label ?? '—',
        rivalryLabel: gi.label,
        allTime: allTimeVs(opp.id),
        storyline: revengeLine(opp.id),
      }
    } else if (this.phase === 'playoffs' && this.playoffs) {
      const pending = pendingGames(this.playoffs).find(
        (g) => g.homeTeamId === this.userTeamId || g.awayTeamId === this.userTeamId
      )
      if (pending) {
        const home = pending.homeTeamId === this.userTeamId
        const opp = this.data.teams.get(home ? pending.awayTeamId : pending.homeTeamId)!
        const gi = gameIntensity(this.rivalriesState, this.userTeamId as string, opp.id as string)
        const os = this.standings.get(opp.id)
        const oppCoach = this.getTeamStaff(opp.id as string).headCoach
        nextGame = {
          day: this.currentDay + 1,
          date: dayToDateISO(this.year, this.currentDay + 1),
          opponentTeamId: opp.id as string,
          opponentName: opp.name,
          opponentAbbr: opp.abbreviation,
          home,
          opponentRank: sorted.findIndex((s) => s.teamId === opp.id) + 1,
          opponentRecord: os ? `${os.wins}-${os.losses}-${os.overtimeLosses}` : '0-0-0',
          opponentSystem: oppCoach.profile?.meta.label ?? '—',
          rivalryLabel: gi.label,
          allTime: allTimeVs(opp.id),
          storyline: revengeLine(opp.id),
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
        draft: this.draftPending() ? 'Go to the entry draft' : 'Continue — open free agency',
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
      draftPending: this.draftPending(),
      boardMeetingPending: this.boardMeetingYear !== null && this.phase === 'regularSeason',
      reviewPending: this.reviewFacts !== null,
      deadlinePending: this.deadlineHold,
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
      ...(this.waiverWire.length > 0 ? { waiverClaimsAvailable: this.waiverWire.length } : {}),
      ...(this.ownerRequest ? { ownerRequestPending: true } : {}),
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
    // Scoring pace from the league he ACTUALLY plays in (world/AHL prospects keep
    // their stats in the world/AHL sim, not the user-league totals) — feeds the
    // scouts' "what I saw in a recent viewing" line on the profile.
    const paceTier = (playerTeamId ? this.data.teams.get(playerTeamId) : undefined)?.tier
    const paceTotals = paceTier === 'ahl' ? this.ahlTotals : paceTier === 'world' ? this.worldSim.totals : this.totals
    const paceGpMap = paceTier === 'ahl' ? this.ahlGp : paceTier === 'world' ? this.worldSim.gp : this.gp
    const paceGp = paceGpMap.get(pid) ?? 0
    const paceTot = paceTotals.get(pid)
    const observedPace = paceGp > 0 ? ((paceTot?.goals ?? 0) + (paceTot?.assists ?? 0)) / paceGp : undefined
    const profile = buildPlayerProfile(this.ctx(), pid, fog, mindsetCtx, userScouts, {
      factor: nhleFactorByAbbrev(leagueAbbrev),
      name: leagueAbbrev,
    }, observedPace)

    // Career honours — trophies won during this career (Hart, Cup, medals, etc.),
    // shown as badges on the History tab, plus pre-career honours imported from the
    // source DB. In-career awards carry their year; imported ones are a count only.
    const playerAwards: Array<{ award: string; year?: number }> = this.recordsState.awards
      .filter((a) => a.playerId === (pid as string))
      .sort((a, b) => b.year - a.year)
      .map((a) => ({ award: a.award, year: a.year }))
    const priorCups = this.data.players.get(pid)?.stanleyCups ?? 0
    for (let i = 0; i < priorCups; i++) playerAwards.push({ award: 'Stanley Cup' })
    if (playerAwards.length > 0) profile.awards = playerAwards

    // This season's average match rating (EHM "Avr") — cumulative from game one,
    // so there's no Avr before the season's first game.
    const seasonRating = this.seasonRatingTotals.get(pid as string)
    if (seasonRating && seasonRating.n > 0) {
      profile.avgRating = Math.round((seasonRating.sum / seasonRating.n) * 100) / 100
    }

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

      // Composite prospect grade — weighs talent + OUR team's need, system fit,
      // position scarcity, risk and value into one verdict + pros/cons (FM-style).
      // Only meaningful for prospects/young developmentals — a "PROSPECT GRADE" on a
      // 30-year-old veteran reads wrong, so gate it to draft-age-and-developmental.
      if (player.age <= 23) {
        const ourFit = player.position !== 'G' && this.userTeam.tactics ? playerStyleFit(player, this.userTeam.tactics) : null
        profile.prospectGrade = buildProspectGrade({
          potentialStars: profile.potentialStars,
          currentStars: overallToStars(profile.overall),
          position: player.position,
          age: player.age,
          ...(profile.scoutPanel?.risk?.band !== undefined ? { riskBand: profile.scoutPanel.risk.band } : {}),
          need: this.positionNeed(player.position),
          ...(ourFit ? { styleFitScore: ourFit.score, styleLabel: ourFit.styleLabel } : {}),
        })
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
        // The analyst's FULL-ordering rank (past the published top-64) — lets an
        // off-board prospect read as a concrete "projected Nth-round pick" and shows
        // his draft standing in the profile/info + list views.
        const fullRank = board.fullRankById[playerId]
        if (elig !== 'radar' && fullRank !== undefined) {
          profile.analystRank = fullRank
          profile.analystDraftLabel = draftRoundLabel(fullRank, elig)
        }
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
          ...(fullRank !== undefined ? { fullRank } : {}),
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

      // Living scouting report — the synthesized, always-present write-up that
      // deepens + shifts as our scouts' collective read sharpens. Production comes
      // from the league he actually plays in (pace* computed above).
      const { leagueLabel: sumLeague, teamIds: sumTeamIds } = this.leagueContextOf(playerTeamId)
      const sumRank = player.position !== 'G' && sumTeamIds.length > 0 ? this.scoringRankOf(pid, sumTeamIds) : undefined
      const summaryArgs = {
        player,
        knowledge: profile.scoutReport.knowledge,
        gamesPlayed: paceGp,
        goals: paceTot?.goals ?? 0,
        assists: paceTot?.assists ?? 0,
        leagueName: sumLeague || leagueAbbrev,
        ...(sumRank !== undefined ? { leagueScoringRank: sumRank } : {}),
        ...(profile.scoutsCeilingRole !== undefined ? { ceilingRole: profile.scoutsCeilingRole } : {}),
        ...(profile.scoutPanel?.risk?.band !== undefined ? { riskBand: profile.scoutPanel.risk.band } : {}),
        ...(profile.scoutComp?.names !== undefined ? { compNames: profile.scoutComp.names } : {}),
        ...(elig ? { eligibility: elig } : {}),
        ...(profile.analystDraftLabel !== undefined ? { draftLabel: profile.analystDraftLabel } : {}),
        draftYear: this.year + 1,
      }
      profile.scoutSummary = buildScoutSummary(summaryArgs)
      // A formal end-of-season pre-draft edition for draft-eligible prospects.
      const seasonEnd = this.phase === 'offseason' || this.phase === 'playoffs' || this.draftRankPhase() === 'final'
      if (seasonEnd && elig && elig !== 'radar') {
        profile.preDraftSummary = buildScoutSummary({ ...summaryArgs, preDraft: true })
      }
    }

    // Show the running Avr on the in-progress season's row too (completed seasons
    // already carry it from SeasonStats; the current season isn't archived yet).
    if (profile.avgRating !== undefined) {
      const cur = profile.seasons[0]
      if (cur && cur.year === this.year) {
        if (cur.skater) cur.skater.avgRating = profile.avgRating
        if (cur.goalie) cur.goalie.avgRating = profile.avgRating
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
      // The coach's beliefs shift gradually toward what he agreed to, so the
      // influence persists into future seasons — and his roster-fit edge updates.
      const ts = this.getTeamStaff(this.userTeamId as string)
      if (ts.headCoach.profile) {
        ts.headCoach.profile = nudgeProfileForDirection(ts.headCoach.profile, direction)
      }
      team.coachFit = styleMatch(roster, team.tactics).fit
    }
    return { accepted: evalResult.accepted, response: evalResult.response }
  }

  /**
   * Staff-meeting summary: the head coach's tactical identity, how well his system
   * fits the roster, and the players whose form/morale the coach (and GM) should
   * address. Drives the Staff Meeting screen's overview.
   */
  getStaffMeetingSummary(): StaffMeetingSummaryView {
    const team = this.data.teams.get(this.userTeamId)!
    const ts = this.getTeamStaff(this.userTeamId as string)
    const coach = ts.headCoach
    const profile = coach.profile ?? buildCoachProfile(coach)
    const roster = team.roster.map((id) => this.resolve(id))
    const sm = styleMatch(roster, team.tactics)
    const fit = Math.round(sm.fit)
    const fitLabel = fit >= 78 ? 'Strong' : fit >= 66 ? 'Good' : fit >= 55 ? 'Adequate' : 'Poor'
    const m = profile.meta

    const flagged: StaffMeetingSummaryView['flagged'] = []
    for (const p of roster) {
      if (p.injuryStatus !== null) continue
      const condition = Math.round(100 - p.fatigue)
      let issue: 'slumping' | 'unhappy' | 'tired' | null = null
      let detail = ''
      if (condition < 40) { issue = 'tired'; detail = `Worn down — condition ${condition}` }
      else if (p.morale < 30) { issue = 'unhappy'; detail = 'Unhappy with his role or situation' }
      else if (p.form <= -3) { issue = 'slumping'; detail = 'Cold stretch — production has dried up' }
      if (issue) {
        flagged.push({
          playerId: p.id as unknown as string,
          name: p.name,
          issue,
          detail,
          ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
        })
      }
    }
    flagged.sort((a, b) => (a.issue === 'tired' ? -1 : 0) - (b.issue === 'tired' ? -1 : 0))

    return {
      coachName: coach.name,
      ...(coach.faceId !== undefined ? { coachFaceId: coach.faceId } : {}),
      systemLabel: m.label,
      systemBlurb: m.blurb,
      systemFavors: SYSTEM_FAVORS[profile.system],
      philosophy: profile.philosophy,
      forecheckName: m.forecheckName,
      breakoutName: m.breakoutName,
      nzName: m.nzName,
      dZoneName: m.dZoneName,
      ppName: m.ppName,
      pkName: m.pkName,
      paceName: m.paceName,
      rosterFit: fit,
      fitLabel,
      fitAdvice: sm.advice,
      flagged: flagged.slice(0, 8),
    }
  }

  /* ────────────────────── coach hiring market ────────────────────── */

  /** Lazily build the available-coach pool for the current season. Deterministic. */
  private ensureCoachMarket(): CoachMarketEntry[] {
    if (this.coachMarket) return this.coachMarket
    const taken = new Set<string>()
    // Avoid duplicating the user's current head coach's name.
    taken.add(this.getTeamStaff(this.userTeamId as string).headCoach.name)
    const list: CoachMarketEntry[] = []
    for (let i = 0; i < Career.COACH_MARKET_SIZE; i++) {
      const rng = new Rng(deriveSeed(this.seed, Career.COACH_MARKET_NS, this.year * 100 + i))
      const coach = generateTeamStaff(rng, { existingNames: taken }).headCoach
      coach.id = `mktcoach-${this.year}-${i}`
      coach.profile = buildCoachProfile(coach, new Rng(deriveSeed(this.seed, Career.COACH_PROFILE_NS, 5000 + i)))
      list.push({ coach, askingRating: coach.rating })
    }
    this.coachMarket = list
    return list
  }

  /** The coach hiring market, with each candidate's fit against the user roster. */
  getCoachMarket(): CoachMarketView {
    const team = this.data.teams.get(this.userTeamId)!
    const roster = team.roster.map((id) => this.resolve(id))
    const current = this.getTeamStaff(this.userTeamId as string).headCoach
    const currentProfile = current.profile ?? buildCoachProfile(current)
    const fitLabelOf = (f: number): string => (f >= 78 ? 'Strong' : f >= 66 ? 'Good' : f >= 55 ? 'Adequate' : 'Poor')
    const fitBlurbOf = (f: number, label: string): string =>
      f >= 78 ? `${label} fit — his system suits this roster`
        : f >= 66 ? `${label} fit — workable with this group`
        : f >= 55 ? `${label} fit — some friction with the personnel`
        : `${label} fit — his style clashes with this roster`

    const entries = this.ensureCoachMarket().map((e) => {
      const profile = e.coach.profile ?? buildCoachProfile(e.coach)
      const fit = Math.round(coachFit(profile, roster))
      const label = fitLabelOf(fit)
      return {
        coachId: e.coach.id,
        name: e.coach.name,
        ...(e.coach.faceId !== undefined ? { faceId: e.coach.faceId } : {}),
        rating: e.coach.rating,
        demeanor: e.coach.demeanor ?? 'calm',
        systemLabel: profile.meta.label,
        philosophy: profile.philosophy,
        rosterFit: fit,
        fitLabel: label,
        fitBlurb: fitBlurbOf(fit, label),
      }
    }).sort((a, b) => b.rosterFit - a.rosterFit)

    return {
      currentCoachName: current.name,
      currentSystemLabel: currentProfile.meta.label,
      currentRosterFit: Math.round(coachFit(currentProfile, roster)),
      entries,
    }
  }

  /**
   * Hire a coach from the market. Installs him as the user's head coach, re-derives
   * the team's system + roster fit, removes him from the market, and logs it.
   */
  hireCoach(coachId: string): { ok: boolean; message: string } {
    const market = this.ensureCoachMarket()
    const idx = market.findIndex((e) => e.coach.id === coachId)
    if (idx < 0) return { ok: false, message: 'That coach is no longer available.' }
    const entry = market[idx]!
    const team = this.data.teams.get(this.userTeamId)
    if (!team) return { ok: false, message: 'No team.' }

    const ts = this.getTeamStaff(this.userTeamId as string)
    const outgoing = ts.headCoach.name
    ts.headCoach = entry.coach
    if (!ts.headCoach.profile) ts.headCoach.profile = buildCoachProfile(ts.headCoach)
    market.splice(idx, 1)

    const roster = team.roster.map((id) => this.resolve(id))
    team.tactics = profileToTactics(ts.headCoach.profile, roster, team.tactics)
    team.coachFit = styleMatch(roster, team.tactics).fit

    this.pushNews(
      'contract',
      `${team.name} hire ${entry.coach.name} as head coach`,
      `${entry.coach.name} takes over from ${outgoing}, bringing a ${ts.headCoach.profile.meta.label.toLowerCase()} approach.`,
      { teamId: this.userTeamId as string }
    )
    const tx = recordTransaction(this.transactionLedger, {
      day: this.currentDay,
      year: this.year,
      kind: 'signing',
      teamIds: [this.userTeamId as string],
      summary: `${team.abbreviation} hire ${entry.coach.name} as head coach.`,
    })
    this.transactionLedger = tx.ledger
    return { ok: true, message: `${entry.coach.name} hired as head coach.` }
  }

  /**
   * Fire the user's head coach. A caretaker takes over until the GM hires a
   * replacement from the market. The team's system re-derives to the caretaker's.
   */
  fireCoach(): { ok: boolean; message: string } {
    const team = this.data.teams.get(this.userTeamId)
    if (!team) return { ok: false, message: 'No team.' }
    const ts = this.getTeamStaff(this.userTeamId as string)
    const outgoing = ts.headCoach.name

    // Caretaker: a modest interim coach, deterministically generated.
    const rng = new Rng(deriveSeed(this.seed, Career.COACH_MARKET_NS, this.year * 100 + 9000 + this.currentDay))
    const caretaker = generateTeamStaff(rng).headCoach
    caretaker.id = `caretaker-${this.year}-${this.currentDay}`
    caretaker.rating = Math.max(40, caretaker.rating - 8) // interim discount
    caretaker.profile = buildCoachProfile(caretaker, rng)
    ts.headCoach = caretaker

    const roster = team.roster.map((id) => this.resolve(id))
    team.tactics = profileToTactics(caretaker.profile, roster, team.tactics)
    team.coachFit = styleMatch(roster, team.tactics).fit

    this.pushNews(
      'contract',
      `${team.name} part ways with head coach ${outgoing}`,
      `${outgoing} has been relieved of his duties. ${caretaker.name} steps in as interim bench boss while the club searches for a permanent hire.`,
      { teamId: this.userTeamId as string }
    )
    const tx = recordTransaction(this.transactionLedger, {
      day: this.currentDay,
      year: this.year,
      kind: 'signing',
      teamIds: [this.userTeamId as string],
      summary: `${team.abbreviation} fire head coach ${outgoing}; ${caretaker.name} takes over on an interim basis.`,
    })
    this.transactionLedger = tx.ledger
    return { ok: true, message: `${outgoing} fired. ${caretaker.name} is interim head coach — hire a replacement from the market.` }
  }

  /* ────────────────────────── GM career ────────────────────────── */

  /** Build the rival GM vacancy list. The weakest non-playoff clubs (plus a little
   *  deterministic churn) are treated as having an opening; the user's reputation
   *  decides how keenly each would hire him. `sorted` is worst-last standings. */
  private buildGMOpenings(sorted: ReturnType<typeof sortStandings>): GMJobOpening[] {
    const gm = this.ensureGM()
    const n = this.data.league.teams.length
    const rankOf = new Map<string, number>()
    sorted.forEach((s, i) => rankOf.set(s.teamId as string, i + 1))
    const rng = new Rng(deriveSeed(this.seed, 9331, this.year))
    const openings: Array<{ teamId: string; teamName: string; teamAbbr: string; marketSize: number; projectedRank: number }> = []
    for (const tid of this.data.league.teams) {
      if ((tid as string) === (this.userTeamId as string)) continue
      const team = this.data.teams.get(tid)
      if (!team || team.tier === 'ahl' || team.tier === 'world') continue
      const rank = rankOf.get(tid as string) ?? n
      // Bottom third of the league is most likely to make a change; a little churn
      // higher up keeps the carousel alive.
      const bottomThird = rank > Math.ceil(n * 0.66)
      const fires = bottomThird ? rng.chance(0.5) : rng.chance(0.08)
      if (!fires) continue
      openings.push({
        teamId: tid as string,
        teamName: team.name,
        teamAbbr: team.abbreviation,
        marketSize: 3,
        projectedRank: rank,
      })
    }
    return buildGMJobMarket({ openings, userTeamId: this.userTeamId as string, reputation: gm.reputation, n })
  }

  /** The user's GM profile (identity, reputation, career record, job history). */
  getGMProfile(): GMProfileView {
    const gm = this.ensureGM()
    const cur = currentStint(gm)
    return {
      name: gm.name,
      reputation: gm.reputation,
      tier: reputationTier(gm.reputation),
      seasons: gm.seasons,
      wins: gm.wins,
      losses: gm.losses,
      playoffApps: gm.playoffApps,
      cupWins: gm.cupWins,
      presidentsTrophies: gm.presidentsTrophies,
      currentClub: cur ? cur.teamName : null,
      fired: this.boardState.firedAtYear !== null,
      stints: gm.stints.map((s) => ({
        teamAbbr: s.teamAbbr,
        teamName: s.teamName,
        fromYear: s.fromYear,
        toYear: s.toYear,
        seasons: s.seasons,
        record: `${s.wins}-${s.losses}`,
        cupWins: s.cupWins,
        endReason: s.endReason ?? null,
      })),
    }
  }

  /** Open GM vacancies the user can take (populated when he's fired). */
  getGMJobMarket(): GMJobMarketView {
    const gm = this.ensureGM()
    return {
      reputation: gm.reputation,
      tier: reputationTier(gm.reputation),
      available: this.boardState.firedAtYear !== null,
      openings: (this.gmJobMarket ?? []).map((o) => ({
        teamId: o.teamId,
        teamName: o.teamName,
        teamAbbr: o.teamAbbr,
        projectedRank: o.projectedRank,
        interest: o.interest,
        blurb: o.blurb,
      })),
    }
  }

  /**
   * Accept a GM vacancy and move clubs. Re-points the user's club, rebuilds the
   * board mandate for the new team, ensures its locker room exists, records the new
   * stint, clears the fired flag, and announces the hire. Only permitted while
   * between jobs (fired). Most club-scoped state is keyed by team or leaguewide, so
   * it follows the new userTeamId automatically.
   */
  acceptGMJob(teamId: string): { ok: boolean; message: string } {
    if (this.boardState.firedAtYear === null) {
      return { ok: false, message: 'You can only take a new job while between jobs.' }
    }
    const opening = (this.gmJobMarket ?? []).find((o) => o.teamId === teamId)
    if (!opening) return { ok: false, message: 'That job is no longer on the market.' }
    if (opening.interest === 'longshot') {
      return { ok: false, message: `${opening.teamName} need more convincing — build your reputation first.` }
    }
    const newTeam = this.data.teams.get(asTeamId(teamId))
    if (!newTeam) return { ok: false, message: 'Club not found.' }

    const gm = this.ensureGM()
    // Switch the user's club.
    this.userTeamId = asTeamId(teamId)
    startStint(gm, this.year, teamId, newTeam.abbreviation, newTeam.name)

    // Rebuild the board mandate for the new club; clears firedAtYear via fresh state.
    const boardResult = setSeasonMandate({
      teamStrengthRank: this.userStrengthRank(),
      teamsInLeague: this.data.league.teams.length,
      rng: this.rngFor(9301, this.year),
      year: this.year,
      teamId: teamId,
      teamName: newTeam.name,
    })
    this.boardState = boardResult.state
    // (Every NHL club already has a locker room from initLockerRooms — no rebuild needed.)

    this.gmJobMarket = null
    this.pushNews(
      'contract',
      `You've been hired as GM of ${newTeam.name}`,
      `${gm.name} is back in the game — ${newTeam.name} have handed you the keys. ${boardResult.state.mandateText}`,
      { teamId }
    )
    const tx = recordTransaction(this.transactionLedger, {
      day: this.currentDay, year: this.year, kind: 'signing', teamIds: [teamId],
      summary: `${newTeam.abbreviation} hire ${gm.name} as general manager.`,
    })
    this.transactionLedger = tx.ledger
    return { ok: true, message: `Hired as GM of ${newTeam.name}.` }
  }

  /* ────────────────────────── owner meddling ────────────────────────── */

  /** Possibly raise a new owner directive (skips when one is already pending). */
  private maybeGenerateOwnerRequest(day: number): void {
    if (this.ownerRequest) return
    if (this.boardState.firedAtYear !== null) return // no owner to please between jobs
    const req = generateOwnerRequest({
      mandate: this.boardState.mandate,
      year: this.year,
      day,
      rng: new Rng(deriveSeed(this.seed, 9340, this.year, day)),
    })
    if (!req) return
    this.ownerRequest = req
    this.pushNews('league', req.title, `${req.body}\n\nHead to Club Vision to respond to the owner.`, {
      teamId: this.userTeamId as string,
    })
  }

  /** The pending owner directive, if any. */
  getOwnerRequest(): OwnerRequestView | null {
    const r = this.ownerRequest
    if (!r) return null
    const sign = (n: number): string => (n >= 0 ? `+${n}` : `${n}`)
    return {
      kind: r.kind,
      title: r.title,
      body: r.body,
      acceptHint: `Go along with it (board confidence ${sign(r.acceptConfidence)})`,
      declineHint: `Push back (board confidence ${sign(r.declineConfidence)})`,
    }
  }

  /** Respond to the pending owner directive; swings board confidence + patience. */
  respondToOwnerRequest(accept: boolean): { ok: boolean; message: string } {
    const r = this.ownerRequest
    if (!r) return { ok: false, message: 'There is no owner request right now.' }
    const dC = accept ? r.acceptConfidence : r.declineConfidence
    const dP = accept ? r.acceptPatience : r.declinePatience
    this.boardState.confidence = Math.max(0, Math.min(100, this.boardState.confidence + dC))
    this.boardState.patience = Math.max(0, Math.min(100, this.boardState.patience + dP))
    this.ownerRequest = null
    const msg = accept
      ? 'You assured the owner you would deliver. He is pleased.'
      : 'You pushed back and backed your own plan. The owner is not thrilled.'
    this.pushNews('league', accept ? 'GM backs the owner' : 'GM pushes back on ownership', msg, {
      teamId: this.userTeamId as string,
    })
    return { ok: true, message: msg }
  }

  /* ────────────────────── rival-GM relationships ────────────────────── */

  /** The user GM's standing with a rival club (0–100, 50 = neutral by default). */
  private relationshipWith(teamId: string): number {
    return this.gmRelationships.get(teamId) ?? 50
  }

  /** Nudge the relationship with a club, clamped to [0,100]. */
  private adjustRelationship(teamId: string, delta: number): void {
    const next = Math.max(0, Math.min(100, this.relationshipWith(teamId) + delta))
    this.gmRelationships.set(teamId, next)
  }

  /** A contending rival with the cap + roster room to outbid the user for a UFA
   *  asking `askSalary`. Best record first; undefined if none can fit him. */
  private findOutbiddingRival(askSalary: number): Team | undefined {
    const order = sortStandings([...this.standings.values()]).map((s) => s.teamId)
    for (const tid of order) {
      if ((tid as string) === (this.userTeamId as string)) continue
      const team = this.data.teams.get(tid)
      if (!team || team.tier === 'ahl' || team.tier === 'world') continue
      if (team.roster.length >= ROSTER_HARD_CAP) continue
      const capUsed = team.roster.reduce((s, id) => s + (this.data.players.get(id)?.contract.salary ?? 0), 0)
      if (capUsed + askSalary > team.finances.salaryCap) continue
      return team
    }
    return undefined
  }

  /** Rival-GM standings for the GM Career screen (most → least friendly). */
  getGMRelationships(): GMRelationshipsView {
    const label = (v: number): string =>
      v >= 75 ? 'Friendly' : v >= 60 ? 'Warm' : v >= 40 ? 'Cordial' : v >= 25 ? 'Frosty' : 'Hostile'
    const rows = this.data.league.teams
      .filter((t) => (t as string) !== (this.userTeamId as string))
      .map((t) => {
        const team = this.data.teams.get(t)
        const standing = this.relationshipWith(t as string)
        return { teamAbbr: team?.abbreviation ?? '???', teamName: team?.name ?? '', standing, label: label(standing) }
      })
      .filter((r) => r.teamName)
      .sort((a, b) => b.standing - a.standing)
    return { rows }
  }

  /* ────────────────────────── mentorship ────────────────────────── */

  private static readonly MENTOR_MIN_AGE = 29
  private static readonly MENTEE_MAX_AGE = 23
  private static readonly MENTOR_DEV_BONUS = 1.08

  /** A mentee under a valid mentorship develops a little faster. Validity requires
   *  the mentor still on the same NHL roster as the mentee. */
  private mentorshipDevBonus(menteeId: string): number {
    const mentorId = this.mentorships.get(menteeId)
    if (!mentorId) return 1
    const menteeTeam = this.teamOf(asPlayerId(menteeId))
    const mentorTeam = this.teamOf(asPlayerId(mentorId))
    if (!menteeTeam || menteeTeam !== mentorTeam) return 1
    return Career.MENTOR_DEV_BONUS
  }

  /** Eligible as a mentor: a established veteran on the user's NHL roster. */
  private isMentorEligible(p: Player): boolean {
    return p.age >= Career.MENTOR_MIN_AGE || (p.leadership ?? 0) >= 75
  }

  /** Current mentorships + eligible mentors/mentees for the Development Center. */
  getMentorships(): MentorshipView {
    const roster = this.userTeam.roster.map((id) => this.resolve(id))
    const byId = new Map(roster.map((p) => [p.id as string, p]))
    const badgeOf = (id: string): { playerId: string; name: string; position: Position; age: number } => {
      const p = byId.get(id)
      return { playerId: id, name: p?.name ?? '?', position: p?.position ?? 'C', age: p?.age ?? 0 }
    }
    // Prune stale pairs (player moved/retired) lazily on read.
    for (const [menteeId, mentorId] of [...this.mentorships]) {
      if (!byId.has(menteeId) || !byId.has(mentorId)) this.mentorships.delete(menteeId)
    }
    const pairs = [...this.mentorships].map(([menteeId, mentorId]) => ({
      mentee: badgeOf(menteeId),
      mentor: badgeOf(mentorId),
    }))
    const mentoredIds = new Set(this.mentorships.keys())
    const mentors = roster.filter((p) => this.isMentorEligible(p)).map((p) => badgeOf(p.id as string))
    const mentees = roster
      .filter((p) => p.age <= Career.MENTEE_MAX_AGE && !mentoredIds.has(p.id as string))
      .map((p) => badgeOf(p.id as string))
    return { pairs, eligibleMentors: mentors, eligibleMentees: mentees }
  }

  /** Pair a veteran mentor with a young mentee on the user's roster. */
  assignMentor(menteeId: string, mentorId: string): { ok: boolean; message: string } {
    if (menteeId === mentorId) return { ok: false, message: 'A player cannot mentor himself.' }
    const mentee = this.data.players.get(asPlayerId(menteeId))
    const mentor = this.data.players.get(asPlayerId(mentorId))
    if (!mentee || !mentor) return { ok: false, message: 'Player not found.' }
    const onRoster = (id: string): boolean => this.userTeam.roster.some((r) => (r as string) === id)
    if (!onRoster(menteeId) || !onRoster(mentorId)) {
      return { ok: false, message: 'Both players must be on your NHL roster.' }
    }
    if (mentee.age > Career.MENTEE_MAX_AGE) {
      return { ok: false, message: `${mentee.name} is too established to need a mentor.` }
    }
    if (!this.isMentorEligible(mentor)) {
      return { ok: false, message: `${mentor.name} isn't a seasoned enough veteran to mentor.` }
    }
    // A mentor can guide at most two mentees.
    const load = [...this.mentorships.values()].filter((m) => m === mentorId).length
    if (load >= 2) return { ok: false, message: `${mentor.name} already has his hands full with two mentees.` }
    this.mentorships.set(menteeId, mentorId)
    return { ok: true, message: `${mentor.name} will take ${mentee.name} under his wing.` }
  }

  /** Dissolve a mentorship. */
  clearMentor(menteeId: string): { ok: boolean; message: string } {
    if (!this.mentorships.has(menteeId)) return { ok: false, message: 'No mentorship to clear.' }
    this.mentorships.delete(menteeId)
    return { ok: true, message: 'Mentorship dissolved.' }
  }

  /* ────────────────────── club direction / rebuild ────────────────────── */

  /** Win-now mandates the board won't let you tear down without consequence. */
  private static readonly WIN_NOW_MANDATES = new Set(['cupOrBust', 'contend'])

  /** The GM's current declared stance + whether a rebuild can be sanctioned. */
  getClubDirection(): ClubDirectionView {
    const winNow = Career.WIN_NOW_MANDATES.has(this.boardState.mandate)
    return {
      direction: this.clubDirection,
      rebuildSanctioned: this.boardState.rebuildSanctioned === true,
      // Ownership only signs off on a rebuild when they aren't expecting a contender.
      canRebuild: !winNow,
      mandateText: this.boardState.mandateText,
    }
  }

  /**
   * Set the GM's competitive stance. 'rebuild' is the sanctioned-tank path: sell
   * veterans for picks and youth and chase draft position, shielded from a firing
   * for the losing that follows — but ONLY if ownership isn't expecting a contender
   * (you can't quietly throw a season the owner sold to the fans as a Cup run).
   * 'retool' and 'compete' are always available.
   */
  setClubDirection(direction: 'compete' | 'retool' | 'rebuild'): { ok: boolean; message: string } {
    if (direction === 'rebuild') {
      if (Career.WIN_NOW_MANDATES.has(this.boardState.mandate)) {
        return {
          ok: false,
          message: 'Ownership expects this team to compete — they will not sanction a teardown. Lower their expectations first, or win them over.',
        }
      }
      this.clubDirection = 'rebuild'
      this.boardState.rebuildSanctioned = true
      this.boardState.patience = Math.min(100, this.boardState.patience + 15)
      this.pushNews(
        'league',
        'Ownership signs off on a rebuild',
        'The board has blessed a reset: move veterans for picks and prospects, lean on youth, and build through the draft. A losing season is the price of the plan — they will not hold it against you this year.',
        { teamId: this.userTeamId as string }
      )
      return { ok: true, message: 'Rebuild sanctioned — sell veterans for futures and chase draft position.' }
    }
    this.clubDirection = direction
    if (direction === 'compete') this.boardState.rebuildSanctioned = false
    this.pushNews(
      'league',
      direction === 'retool' ? 'Club sets a retool course' : 'Club commits to competing',
      direction === 'retool'
        ? 'The plan: stay competitive while refreshing the roster on the fly — no full teardown.'
        : 'The directive is clear: this team is here to win now.',
      { teamId: this.userTeamId as string }
    )
    return { ok: true, message: `Club direction set to ${direction}.` }
  }

  /** Club sponsorship deals (title / jersey / arena) + total annual revenue. Deals
   *  scale with roster stature and fan interest — winning and a full barn are worth
   *  more to sponsors. Also refreshes the finances revenue line. */
  getSponsors(): SponsorsView {
    const team = this.userTeam
    const roster = team.roster.map((id) => this.resolve(id))
    const stature = roster.length
      ? Math.round(roster.reduce((s, p) => s + ratedOverall(p), 0) / roster.length)
      : 55
    const deals = buildSponsors({ teamKey: team.abbreviation, stature, fanInterest: this.fanInterest })
    const total = sponsorTotal(deals)
    team.finances.revenue = total
    return {
      total,
      deals: deals.map((d) => ({
        kind: d.kind,
        kindLabel: sponsorKindLabel(d.kind),
        sponsor: d.sponsor,
        value: d.value,
        yearsLeft: d.yearsLeft,
      })),
    }
  }

  /** Fan engagement + its current pull on the owner budget. */
  getFanbase(): FanbaseView {
    return {
      interest: this.fanInterest,
      label: fanInterestLabel(this.fanInterest),
      budgetFactorPct: Math.round(budgetFactor(this.fanInterest) * 100),
    }
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

    // Coach's "set the roster" recommendation: ability-sort the combined NHL+AHL
    // pool and surface the call-ups/send-downs that would optimise the NHL roster.
    const split = ahlTeam
      ? farmSplit({
          nhlRoster: team?.roster ?? [],
          ahlRoster: ahlTeam.roster,
          resolve: (id) => this.data.players.get(id),
          // Match applyCoachRoster: protect waiver-required veterans from demotion.
          score: (p) => ratedOverall(p) + this.waiverProtection(p),
        })
      : { promoted: [], demoted: [] }
    const adviceMove = (id: PlayerId, kind: 'callup' | 'senddown'): import('./developmentCenter').RosterAdviceMove | null => {
      const p = this.data.players.get(id)
      if (!p) return null
      return {
        playerId: id as string,
        name: p.name,
        position: p.position,
        currentStars: overallToStars(ratedOverall(p)),
        kind,
        reason: kind === 'callup'
          ? 'Outrates current NHL depth at his position.'
          : 'Bettered by NHL options — more value developing in the AHL.',
        ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
      }
    }
    const callUps = split.promoted.map((id) => adviceMove(id, 'callup')).filter((m): m is import('./developmentCenter').RosterAdviceMove => m !== null)
    const sendDowns = split.demoted.map((id) => adviceMove(id, 'senddown')).filter((m): m is import('./developmentCenter').RosterAdviceMove => m !== null)

    // Rights-held prospects playing outside the NHL/AHL (e.g. juniors we drafted).
    const onFarm = new Set<string>([...(team?.roster ?? []), ...(ahlTeam?.roster ?? [])].map((id) => id as string))
    const worldInfo = this.worldClubInfoByPid()
    const systemElsewhere: Array<{ player: Player; clubAbbrev: string; leagueAbbr?: string }> = []
    for (const p of this.data.players.values()) {
      if (p.rightsTeamId !== this.userTeamId) continue
      if (onFarm.has(p.id as string)) continue
      let clubAbbrev = '—'
      for (const t of this.data.teams.values()) {
        if (t.roster.includes(p.id)) { clubAbbrev = t.abbreviation; break }
      }
      const leagueAbbr = worldInfo.get(p.id as string)?.leagueAbbr
      systemElsewhere.push({ player: p, clubAbbrev, ...(leagueAbbr ? { leagueAbbr } : {}) })
    }

    return buildDevelopmentCenter({
      teamName: team?.name ?? 'Team',
      roster,
      affiliate,
      stars,
      rosterAdvice: { callUps, sendDowns },
      systemElsewhere,
    })
  }

  /**
   * Monte-Carlo playoff odds: simulate the remaining schedule many times from a
   * lightweight strength-based win model and report each club's chance of making
   * the playoffs (top 4 per conference, matching the bracket) plus its projected
   * final points. Deterministic per (seed, day) so the number is stable until the
   * next game is played.
   */
  getPlayoffOdds(): PlayoffOddsView {
    const userId = this.userTeamId as string
    if (this.phase !== 'regularSeason') {
      return { available: false, simulations: 0, userTeamId: userId, rows: [] }
    }
    const N = 600
    const QUAL = 4 // matches QUALIFIERS_PER_CONFERENCE in seedBracket
    const teamIds = [...this.data.league.teams]

    const strength = new Map<TeamId, number>()
    const basePts = new Map<TeamId, number>()
    const gamesPlayed = new Map<TeamId, number>()
    const gamesRemaining = new Map<TeamId, number>()
    const confOf = new Map<TeamId, string>()
    for (const t of teamIds) {
      const team = this.data.teams.get(t)
      strength.set(t, teamStrengthRating((team?.roster ?? []).map((id) => this.resolve(id))))
      const st = this.standings.get(t)
      basePts.set(t, st?.points ?? 0)
      gamesPlayed.set(t, st?.gamesPlayed ?? 0)
      gamesRemaining.set(t, 0)
      confOf.set(t, team?.conferenceId ?? '')
    }

    const remaining = this.data.league.schedule.filter((g) => g.day > this.currentDay)
    for (const g of remaining) {
      gamesRemaining.set(g.homeTeamId, (gamesRemaining.get(g.homeTeamId) ?? 0) + 1)
      gamesRemaining.set(g.awayTeamId, (gamesRemaining.get(g.awayTeamId) ?? 0) + 1)
    }

    const confs = [...new Set(teamIds.map((t) => confOf.get(t)!))]
    const sig = (x: number): number => 1 / (1 + Math.exp(-x))
    const rng = new Rng(deriveSeed(this.seed, 9270, this.currentDay))

    const playoffCount = new Map<TeamId, number>(teamIds.map((t) => [t, 0]))
    const ptsTotal = new Map<TeamId, number>(teamIds.map((t) => [t, 0]))

    for (let s = 0; s < N; s++) {
      const pts = new Map<TeamId, number>(basePts)
      for (const g of remaining) {
        const sh = strength.get(g.homeTeamId) ?? 55
        const sa = strength.get(g.awayTeamId) ?? 55
        const pHome = sig((sh - sa) / 8 + 0.18) // home-ice edge
        const otGame = rng.chance(0.23) // ~NHL share of games past regulation
        if (rng.chance(pHome)) {
          pts.set(g.homeTeamId, (pts.get(g.homeTeamId) ?? 0) + 2)
          if (otGame) pts.set(g.awayTeamId, (pts.get(g.awayTeamId) ?? 0) + 1)
        } else {
          pts.set(g.awayTeamId, (pts.get(g.awayTeamId) ?? 0) + 2)
          if (otGame) pts.set(g.homeTeamId, (pts.get(g.homeTeamId) ?? 0) + 1)
        }
      }
      for (const t of teamIds) ptsTotal.set(t, (ptsTotal.get(t) ?? 0) + (pts.get(t) ?? 0))
      for (const c of confs) {
        const members = teamIds.filter((t) => confOf.get(t) === c)
        members.sort((a, b) =>
          (pts.get(b)! - pts.get(a)!) || (strength.get(b)! - strength.get(a)!) || (a < b ? -1 : 1)
        )
        for (let i = 0; i < QUAL && i < members.length; i++) {
          playoffCount.set(members[i]!, playoffCount.get(members[i]!)! + 1)
        }
      }
    }

    const rows: PlayoffOddsRow[] = teamIds.map((t) => {
      const team = this.data.teams.get(t)!
      const confName = this.data.league.conferences.find((c) => c.id === confOf.get(t))?.name ?? ''
      return {
        teamId: t as string,
        name: team.name,
        abbreviation: team.abbreviation,
        conference: confName,
        points: basePts.get(t) ?? 0,
        gamesPlayed: gamesPlayed.get(t) ?? 0,
        gamesRemaining: gamesRemaining.get(t) ?? 0,
        projectedPoints: Math.round((ptsTotal.get(t) ?? 0) / N),
        playoffPct: Math.round(((playoffCount.get(t) ?? 0) / N) * 100),
        isUser: (t as string) === userId,
      }
    })
    rows.sort((a, b) => b.projectedPoints - a.projectedPoints || b.playoffPct - a.playoffPct)
    return { available: true, simulations: N, userTeamId: userId, rows }
  }

  /** Squad Planner: experience matrix + depth/age/contract report for the user club. */
  getSquadPlanner(): SquadPlannerView {
    const team = this.data.teams.get(this.userTeamId)
    const roster = (team?.roster ?? []).map((id) => this.resolve(id))
    // Every NHL team's roster, so the depth report can judge each position group
    // RELATIVE to the rest of the league rather than by absolute headcount.
    const leagueRosters = this.data.league.teams.map((tid) =>
      (this.data.teams.get(tid)?.roster ?? []).map((id) => this.resolve(id))
    )
    return buildSquadPlanner({ teamName: team?.name ?? 'Team', roster, leagueRosters })
  }

  /**
   * "How your club stacks up" — ranks the user's NHL team against every other
   * NHL club across a spread of dimensions (on-ice quality, pipeline, staff,
   * money, arena, physical traits). Powers the dashboard comparison card.
   */
  getLeagueComparison(): LeagueComparisonView {
    const teamIds = [...this.data.league.teams]
    const outOf = teamIds.length

    const nhlRoster = (tid: TeamId): Player[] =>
      (this.data.teams.get(tid)?.roster ?? []).map((id) => this.resolve(id))

    // Prospects = under-24 players across the NHL roster + AHL affiliate.
    const prospectsOf = (tid: TeamId): Player[] => {
      const team = this.data.teams.get(tid)
      const ids = [...(team?.roster ?? [])]
      const aff = team?.affiliateId
      if (aff) ids.push(...(this.data.teams.get(aff)?.roster ?? []))
      return ids.map((id) => this.resolve(id)).filter((p) => p.age <= 23)
    }

    const skatersOf = (tid: TeamId): Player[] => nhlRoster(tid).filter((p) => p.position !== 'G')
    const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0)
    const heightCm = (p: Player): number => p.heightCm ?? 165 + p.ratings.physical.height * 0.35
    const weightKg = (p: Player): number => p.weightKg ?? 75 + p.ratings.physical.strength * 0.25
    const speedOf = (p: Player): number => (p.ratings.physical.speed + p.ratings.physical.acceleration) / 2

    const staffQuality = (ts: TeamStaff): number => {
      const avg = (xs: StaffMember[]): number => (xs.length ? mean(xs.map((s) => s.rating)) : 0)
      const ac = avg(ts.assistantCoaches)
      const sc = avg(ts.scouts)
      const ph = avg(ts.physios)
      return (
        ts.headCoach.rating * 0.34 +
        (ac || ts.headCoach.rating) * 0.18 +
        (sc || 50) * 0.2 +
        ts.assistantGM.rating * 0.16 +
        (ph || 50) * 0.12
      )
    }

    const money = (v: number): string =>
      v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${Math.round(v / 1000)}K`
    const ftIn = (cm: number): string => {
      const totalIn = Math.round(cm / 2.54)
      return `${Math.floor(totalIn / 12)}'${totalIn % 12}"`
    }

    interface Metric {
      key: string
      label: string
      blurb: string
      better: 'high' | 'low'
      value: (tid: TeamId) => number
      fmt: (v: number) => string
    }

    const metrics: Metric[] = [
      { key: 'squad', label: 'Squad rating', blurb: 'Overall on-ice quality, star-weighted and including goaltending.', better: 'high',
        value: (tid) => teamStrengthRating(nhlRoster(tid)), fmt: (v) => String(Math.round(v)) },
      { key: 'prospects', label: 'Prospect pipeline', blurb: 'Ceiling of your best under-24 talent (NHL roster + AHL affiliate).', better: 'high',
        value: (tid) => mean(prospectsOf(tid).map((p) => ratedPotential(p)).sort((a, b) => b - a).slice(0, 8)), fmt: (v) => String(Math.round(v)) },
      { key: 'staff', label: 'Coaching & scouting', blurb: 'Combined quality of your coaches, scouts, AGM and medical staff.', better: 'high',
        value: (tid) => staffQuality(this.getTeamStaff(tid as string)), fmt: (v) => String(Math.round(v)) },
      { key: 'capspace', label: 'Cap space', blurb: 'Room left under the salary cap to add or extend players.', better: 'high',
        value: (tid) => { const f = this.data.teams.get(tid)!.finances; return f.salaryCap - f.capUsed }, fmt: money },
      { key: 'revenue', label: 'Revenue', blurb: 'Annual club revenue — your financial muscle in the market.', better: 'high',
        value: (tid) => this.data.teams.get(tid)?.finances.revenue ?? 0, fmt: money },
      { key: 'arena', label: 'Arena capacity', blurb: 'Home-rink seats — a proxy for the size of your fanbase.', better: 'high',
        value: (tid) => this.data.teams.get(tid)?.arenaCapacity ?? 0, fmt: (v) => v > 0 ? Math.round(v).toLocaleString() : '—' },
      { key: 'tallest', label: 'Biggest team', blurb: 'Average height of your skaters.', better: 'high',
        value: (tid) => mean(skatersOf(tid).map(heightCm)), fmt: ftIn },
      { key: 'fastest', label: 'Fastest skaters', blurb: 'Average skating speed + acceleration across your skaters.', better: 'high',
        value: (tid) => mean(skatersOf(tid).map(speedOf)), fmt: (v) => String(Math.round(v)) },
      { key: 'heaviest', label: 'Heaviest team', blurb: 'Average weight of your skaters.', better: 'high',
        value: (tid) => mean(skatersOf(tid).map(weightKg)), fmt: (v) => v > 0 ? `${Math.round(v)} kg` : '—' },
      { key: 'youngest', label: 'Youngest roster', blurb: 'Average age — rank 1 is the youngest, most up-and-coming roster.', better: 'low',
        value: (tid) => mean(nhlRoster(tid).map((p) => p.age)), fmt: (v) => `${v.toFixed(1)}y` },
    ]

    const cards: LeagueComparisonCard[] = metrics.map((m) => {
      const all = teamIds.map((tid) => ({ tid, v: m.value(tid) }))
      const sorted = [...all].sort((a, b) => (m.better === 'high' ? b.v - a.v : a.v - b.v))
      const rank = sorted.findIndex((x) => x.tid === this.userTeamId) + 1
      const leader = sorted[0]!
      const leaderTeam = this.data.teams.get(leader.tid)!
      const mine = all.find((x) => x.tid === this.userTeamId)!.v
      const percentile = outOf > 1 ? (outOf - rank) / (outOf - 1) : 1
      return {
        key: m.key,
        label: m.label,
        blurb: m.blurb,
        rank: rank > 0 ? rank : outOf,
        outOf,
        percentile,
        display: m.fmt(mine),
        leaderTeamId: leader.tid as string,
        leaderAbbr: leaderTeam.abbreviation,
        leaderDisplay: m.fmt(leader.v),
        isUserLeader: leader.tid === this.userTeamId,
      }
    })

    return { teamName: this.userTeam.name, cards }
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
      else if (t.kind === 'ownProspects') {
        const u = this.userTeamId as string
        const ahl = this.userTeam.affiliateId as string | undefined
        inScope = tid === u || (!!ahl && tid === ahl) || (p.rightsTeamId as unknown as string | undefined) === u
      }
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

  /** Chief Scout auto-assigns the whole department by fit, so the GM doesn't
   *  micromanage every scout: nation specialists go to their region; generalists
   *  cover the utility briefs (next opponent, free agents, our prospects) with the
   *  rest on the draft class. Deterministic. */
  autoAssignScouts(): { ok: true; count: number } {
    this.syncScoutRoster()
    const scouts = [...this.scouting.assignments].sort((a, b) => (a.scoutId < b.scoutId ? -1 : 1))
    const generalists: typeof scouts = []
    for (const s of scouts) {
      if (s.specialtyNation) {
        assignScout(this.scouting, s.scoutId, { kind: 'nation', nation: s.specialtyNation }, 'all')
      } else {
        generalists.push(s)
      }
    }
    // Utility briefs first (one each), then the rest scout the draft class.
    const utility: Array<{ target: ScoutTarget; focus: ScoutFocus }> = [
      { target: { kind: 'nextOpponent' }, focus: 'all' },
      { target: { kind: 'freeAgents' }, focus: 'senior' },
      { target: { kind: 'ownProspects' }, focus: 'all' },
      { target: { kind: 'ownProspects' }, focus: 'all' },
    ]
    generalists.forEach((s, i) => {
      const brief = i < utility.length ? utility[i]! : { target: { kind: 'draftClass' as const }, focus: 'youth' as ScoutFocus }
      assignScout(this.scouting, s.scoutId, brief.target, brief.focus)
    })
    return { ok: true, count: scouts.length }
  }

  /** Max scouts the club will carry (soft cap for the Job Market). */
  private maxScouts(): number {
    // Owner-investment perk from the board meeting funds two extra positions.
    const perkBonus = this.ownerPerk === 'scouting' ? 2 : 0
    return Math.max(12, this.userScoutStaff().length) + perkBonus
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

  /** Global search for the Ctrl+K palette: players and teams by name substring.
   *  Read-only, cheap (single linear pass), fog-of-war safe (names only). */
  searchAll(query: string, limit = 8): {
    players: Array<{ playerId: string; name: string; position: string; age: number; teamAbbr: string; faceId?: string }>
    teams: Array<{ teamId: string; name: string; abbr: string }>
  } {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return { players: [], teams: [] }
    const players: Array<{ playerId: string; name: string; position: string; age: number; teamAbbr: string; faceId?: string }> = []
    const teams: Array<{ teamId: string; name: string; abbr: string }> = []
    for (const t of this.data.teams.values()) {
      if (teams.length < limit && (t.name.toLowerCase().includes(q) || t.abbreviation.toLowerCase().includes(q))) {
        teams.push({ teamId: t.id as string, name: t.name, abbr: t.abbreviation })
      }
    }
    // Prefer prefix matches so "cro" surfaces Crosby before someone mid-name.
    const prefix: typeof players = []
    const contains: typeof players = []
    for (const p of this.data.players.values()) {
      if (prefix.length >= limit) break
      const name = p.name.toLowerCase()
      if (!name.includes(q)) continue
      const teamId = this.teamOf(p.id)
      const abbr = teamId ? (this.data.teams.get(teamId)?.abbreviation ?? '—') : 'FA'
      const row = {
        playerId: p.id as string, name: p.name, position: p.position, age: p.age,
        teamAbbr: abbr, ...(p.faceId ? { faceId: p.faceId } : {}),
      }
      if (name.startsWith(q) || name.includes(` ${q}`)) prefix.push(row)
      else if (contains.length < limit) contains.push(row)
    }
    return { players: [...prefix, ...contains].slice(0, limit), teams }
  }

  getScouting(): ScoutingView {
    this.syncScoutRoster()
    return buildScoutingView({
      ...this.ctx(),
      scouting: this.scouting,
      draftProspectIds: this.allDraftProspectIds(),
      draftRankById: this.getDraftRankings().fullRankById,
      competitions: this.scoutingCompetitions(),
      competitionMeta: (this.data.league.competitions ?? []).map((c) => ({ id: c.id, name: c.name, abbrev: c.abbrev, nation: c.nation })),
      nextOpponentId: this.nextOpponentTeamId(),
      maxScouts: this.maxScouts(),
      scoutMarket: generateScoutCandidates(this.rngFor(7720), 20).filter(
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
    const cand = generateScoutCandidates(this.rngFor(7720), 20).find((c) => c.id === candidateId)
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
      case 'ownProspects': {
        const u = this.userTeamId as string
        const ahl = this.userTeam.affiliateId as string | undefined
        const ids = new Set<string>(rostersOf(ahl ? [u, ahl] : [u]))
        for (const p of this.data.players.values()) {
          if ((p.rightsTeamId as unknown as string | undefined) === u) ids.add(p.id as string)
        }
        return [...ids]
      }
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
      coverage: card?.coverage ?? 0,
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
    return { ...buildTacticsView(this.ctx()), lineSetups: this.getLineSetupNames(), lineManagementMode: this.lineManagementMode }
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
    if (this.userTeam.roster.includes(asPlayerId(pid))) return agedPotential(p)
    return this.scoutedCeilingWith(p, knowledgeOf(this.scouting, pid), accuracyOf(this.scouting, pid))
  }

  /** How badly the user's roster needs a position group — quality bodies (overall
   *  ≥ 68) at that group vs a target depth, for the prospect-grade need term. */
  private positionNeed(position: string): NeedLevel {
    const group: 'C' | 'W' | 'D' | 'G' =
      position === 'G' ? 'G' : (position === 'D' || position === 'LD' || position === 'RD') ? 'D' : position === 'C' ? 'C' : 'W'
    const target = group === 'C' ? 3 : group === 'W' ? 5 : group === 'D' ? 5 : 2
    let quality = 0
    for (const id of this.userTeam.roster) {
      const p = this.data.players.get(id)
      if (!p || ratedOverall(p) < 68) continue
      const g = p.position === 'G' ? 'G' : (p.position === 'D' || p.position === 'LD' || p.position === 'RD') ? 'D' : p.position === 'C' ? 'C' : 'W'
      if (g === group) quality++
    }
    if (quality < target - 1) return 'urgent'
    if (quality < target) return 'need'
    if (quality > target + 2) return 'surplus'
    return 'ok'
  }

  /** scoutedCeilingOf when knowledge + accuracy are already in hand — avoids the
   *  O(n) knowledgeOf/accuracyOf linear scans in hot loops (e.g. the draft board). */
  private scoutedCeilingWith(p: Player, knowledge: number, accuracy: number): number {
    const ceiling = agedPotential(p)
    if (knowledge >= 95) return ceiling
    const { lo, hi } = maskedCeiling(ceiling, knowledge, p.id as string, accuracy)
    const biased = (lo + hi) / 2 + scoutFormBias(p.form ?? 0, knowledge, accuracy)
    return Math.max(1, Math.min(99, Math.round(biased)))
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
      premium: productionPremium(ppg, isD, leagueFactor, p.age),
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
          // How the public board deviates from a prospect's raw tools. It is NOT all
          // noise: part is a real "analyst edge" — a stable factor the market reads
          // that actually pays out in development (see driftYouthCeiling) — so the
          // analysts legitimately beat your scouts on some prospects and whiff on
          // others, rather than being a uniformly over-hyped wrong version. The rest
          // is genuine misread. Both shrink the louder a prospect's production is
          // (analysts aren't blind to a monster season).
          const errorScale = Math.max(0.4, 1 - Math.max(0, evalRes.premium) / 24 * 0.6)
          const consensusError = (analystEdge(id) * 6 + hashSigned(id + ':consensus') * 13) * errorScale
          const perceived = perceivedCeiling(agedPotential(p), p.age, evalRes.premium - injuryDing + consensusError)
          // Projection probabilities are the Data Analyst's product — shown only
          // when one is on staff, and noisier the weaker the analyst.
          const isSkater = p.position !== 'G' && hasAnalyst
          const row: Omit<DraftRankRowView, 'rank'> = {
            playerId: id,
            name: p.name,
            teamId: t.id as string,
            teamAbbr: t.abbreviation,
            teamName: t.name,
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

  /** Memo for the (expensive) draft board — it only changes as scouting
   *  knowledge accrues during the daily sim, so it's stable within a day. Keyed
   *  by year+day+phase+scout-count; assignment/UI round-trips reuse it instead of
   *  rebuilding the whole 5000-prospect board (which was hanging the Scouting UI). */
  private draftRankCache: { key: string; view: DraftRankingsView } | null = null

  getDraftRankings(): DraftRankingsView {
    const cacheKey = `${this.year}:${this.currentDay}:${this.draftRankPhase()}:${this.userScoutStaff().length}:${this.interviews.size}`
    if (this.draftRankCache && this.draftRankCache.key === cacheKey) return this.draftRankCache.view
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
    // PERF: precompute knowledge + ceiling + VALUE once per candidate (the O(n)
    // knowledgeOf/accuracyOf scans run n times here, never inside the sort). The
    // sort + every board then read O(1) map lookups — without this, the comparator
    // recomputed scoutedCeilingOf (→ knowledgeOf linear scan) ~n·log n × boards,
    // which is what made the rankings + every player profile crawl.
    const ownIds = new Set(this.userTeam.roster.map((x) => x as string))
    const meta = new Map<string, { knowledge: number; deptRaw: number; composites: Record<string, number> }>()
    const ceilingById = new Map<string, number>()
    const valueById = new Map<string, number>()
    for (const c of cands) {
      const id = c.row.playerId
      const isOwn = ownIds.has(id)
      const knowledge = isOwn ? 100 : knowledgeOf(this.scouting, id)
      const accuracy = isOwn ? 1 : accuracyOf(this.scouting, id)
      // The Potential column shows OUR fog-aware read.
      const ceil = isOwn || knowledge >= 95 ? agedPotential(c.player) : this.scoutedCeilingWith(c.player, knowledge, accuracy)
      ceilingById.set(id, ceil)
      // VALUE (the sort key) blends our read toward the PUBLIC consensus ceiling by
      // how much we've actually seen him: a well-scouted prospect is ranked on our
      // own read (so he moves off the board), but a prospect nobody has watched
      // sits at consensus — your staff has no independent reason to move him. This
      // is what keeps the board from flinging unseen names 100+ spots. Faded for
      // goalies + docked for re-entries like a real board; current ability folded in.
      const kw = isOwn ? 1 : Math.max(0, Math.min(1, knowledge / 100))
      const valueCeil = ceil * kw + c.input.ceiling * (1 - kw)
      const base = valueCeil * 0.74 + c.input.current * 0.26
      valueById.set(id, base * positionFactor(c.input.position) - reentryPenalty(c.input.eligibility))
      const deptRaw = scoutSignalParts(c.player, (this.interviews.get(id) ?? []).length).raw
      meta.set(id, { knowledge, deptRaw, composites: c.player.composites as unknown as Record<string, number> })
    }
    const valueOf = (c: Cand): number => valueById.get(c.row.playerId) ?? 0
    // The "Cons." column = the ACTUAL analyst board order (same `ordered` the
    // published rankings use), so the movement arrows compare our board against
    // the exact consensus the user sees on the Analyst tab — not a parallel
    // re-derivation that could disagree.
    const consensusRankOf = new Map<string, number>()
    ordered.forEach((id, i) => consensusRankOf.set(id, i + 1))

    // Build a board (top 64): VALUE first (guarantees the monotonicity rule), then
    // the scout signal as a tie-breaker for near-equal prospects only.
    const buildBoard = (signalOf: (c: Cand) => number): ScoutBoardRowView[] =>
      [...cands]
        .sort((a, b) => valueOf(b) - valueOf(a) || signalOf(b) - signalOf(a))
        .slice(0, 64)
        .map((c, i) => {
          const id = c.row.playerId
          const yourRank = i + 1
          const consensusRank = consensusRankOf.get(id) ?? yourRank
          const movement = consensusRank - yourRank
          const verdict: ScoutBoardRowView['verdict'] = movement >= 3 ? 'higher' : movement <= -3 ? 'lower' : 'inline'
          // The Potential column on OUR board shows OUR fog-aware read (c.row's is
          // the analyst's perceived ceiling) — so it agrees with the ▲/▼ verdict.
          return { rank: yourRank, ...c.row, potentialStars: overallToStars(ceilingById.get(id) ?? agedPotential(c.player)), consensusRank, movement, verdict, seen: (meta.get(id)?.knowledge ?? 0) >= 35 }
        })

    // Staff consensus board: department signal breaks ties between equal-value
    // prospects (intangibles + underlying game), knowledge-scaled.
    const scoutBoard = buildBoard((c) => {
      const m = meta.get(c.row.playerId)!
      return m.deptRaw * (m.knowledge / 100)
    })

    // Per-scout boards: each scout's own bias + judgment-scaled noise as the tie-break.
    const scouts = this.getTeamStaff(this.userTeamId as string).scouts
    const scoutBoards = scouts.map((s) => ({
      scoutId: s.id as string,
      scoutName: s.name,
      rows: buildBoard((c) => {
        const m = meta.get(c.row.playerId)!
        const bias = scoutDraftBias(s, c.player, m.composites)
        return (m.deptRaw + bias) * (m.knowledge / 100)
      }),
    }))

    const fullRankById: Record<string, number> = {}
    ordered.forEach((id, i) => { fullRankById[id] = i + 1 })
    const view = { phase, phaseLabel, draftYear: this.year + 1, rankings, radar, scoutBoard, scoutBoards, fullRankById }
    this.draftRankCache = { key: cacheKey, view }
    return view
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
    const view = buildFinanceView(this.ctx())
    if (this.userDeadCap > 0) {
      // Buyout dead cap is real money against the ceiling — show it and count it.
      view.deadCap = this.userDeadCap
      view.capUsed += this.userDeadCap
      view.capSpace = Math.max(0, view.salaryCap - view.capUsed)
    }
    return view
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

    // Player→GM concerns are suppressed for now (the morale/dynamics layer is
    // being reworked) — the inbox no longer surfaces these prompt cards.
    return { items, unread, playerInfo, teamInfo }
  }

  /** Record a played user game's box score for later viewing (bounded). */
  private recordBoxScore(gameId: string, bs: BoxScoreView): void {
    this.boxScoreHistory = this.boxScoreHistory.filter(([id]) => id !== gameId)
    this.boxScoreHistory.push([gameId, bs])
    if (this.boxScoreHistory.length > 130) this.boxScoreHistory.shift()
  }

  /** Box score of a specific played user game, or null if not recorded. */
  getBoxScoreFor(gameId: string): BoxScoreView | null {
    return this.boxScoreHistory.find(([id]) => id === gameId)?.[1] ?? null
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
      partners: (() => { const ranks = this.strengthRanks(); return this.data.league.teams
        .filter((tid) => tid !== this.userTeamId)
        .map((tid) => {
          const team = this.data.teams.get(tid)!
          const gm = this.gmPersonaFor(tid)
          const posture = this.clubPostureFor(tid, ranks)
          const profile = buildTeamProfile(team, this.data.players, personaPhilosophy(gm, posture.posture))
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
            gmName: gm.name,
            gmStyle: gm.styleLabel,
            posture: posture.posture,
            postureReason: posture.reason,
          }
        }) })(),
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
    const clubInfo = this.worldClubInfoByPid()
    // Your scouts' own board (fog-aware) — so the board can show where your staff
    // diverge from the public consensus, and the war room agrees with the Scout
    // Report. Computed once here and shared with draftAdvice().
    const ranks = this.getDraftRankings()
    const sbByPid = new Map<string, ScoutBoardRowView>()
    for (const r of ranks.scoutBoard) sbByPid.set(r.playerId, r)
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
      onClockTeamAbbr:
        onClockIndex >= 0
          ? this.data.teams.get(d.order[onClockIndex].ownerTeamId)?.abbreviation
          : undefined,
      prospects: (cls?.prospects ?? []).map((pr) => {
        const p = this.resolve(pr.playerId)
        const pid = pr.playerId as string
        // Fog-gate potential by YOUR scouting: a prospect you watched all year
        // reads sharply; one you ignored is a guess. Makes scouting matter at the draft.
        const know = knowledgeOf(this.scouting, pid)
        const band = maskedCeiling(agedPotential(p), know, pid, accuracyOf(this.scouting, pid))
        const where = clubInfo.get(pid)
        const line = this.prospectSeasonLine(p)
        const row: ProspectRowView = {
          ...badge(p),
          rank: pr.rank,
          potentialStars: overallToStars(Math.round((band.lo + band.hi) / 2)),
          knowledge: Math.round(know),
          drafted: taken.has(pid),
          shoots: p.handedness,
        }
        if (p.heightCm !== undefined) row.heightCm = p.heightCm
        if (p.weightKg !== undefined) row.weightKg = p.weightKg
        if (p.nationality !== undefined) row.nationality = p.nationality
        if (where) { row.leagueAbbr = where.leagueAbbr; row.club = where.club }
        if (line) {
          row.seasonGp = line.gp; row.seasonG = line.g; row.seasonA = line.a
          row.seasonPts = line.pts; row.seasonIsHistory = line.isHistory
        }
        const sb = sbByPid.get(pid)
        if (sb) { row.scoutRank = sb.rank; row.scoutVerdict = sb.verdict }
        return row
      }),
      complete: d.selections.length >= d.order.length,
      ...(onClockIndex >= 0 && d.order[onClockIndex].ownerTeamId === this.userTeamId
        ? { advice: this.draftAdvice(ranks) }
        : {}),
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
    const capUsed = roster.reduce((s, p) => s + p.contract.salary, 0) + this.userDeadCap
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
      arbitration: this.getArbitrationCases(),
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
      offerSheets: this.offerSheets.map((s) => {
        const p = this.resolve(asPlayerId(s.playerId))
        const suitor = this.data.teams.get(asTeamId(s.fromTeamId))
        return {
          ...badge(p),
          fromTeamAbbr: suitor?.abbreviation ?? '???',
          salary: s.salary,
          years: s.years,
          compRounds: this.offerSheetComp(s.salary),
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
    const pooled = new Set<string>(this.userTeam.roster.map((id) => id as string))
    if (ahlTeam) {
      for (const id of ahlTeam.roster) {
        const p = this.data.players.get(id)
        if (p) { prospectPool.push({ player: p, location: 'AHL' }); pooled.add(id as string) }
      }
    }
    // Rights-held prospects skating in junior/college/Europe belong in the
    // prospect report too — ranked by scout value alongside the AHL group, tagged
    // with the league they're in (OHL/NCAA/SHL…) so "Based" reads usefully.
    {
      const worldInfo = this.worldClubInfoByPid()
      for (const p of this.data.players.values()) {
        if (p.rightsTeamId !== this.userTeamId) continue
        if (pooled.has(p.id as string)) continue
        const league = worldInfo.get(p.id as string)?.leagueAbbr ?? 'JR'
        prospectPool.push({ player: p, location: league })
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

  /** Assign each roster player an individual training focus targeting his weakest
   *  area (goalies → goaltending). One click to development-optimise the squad. */
  recommendPlayerFocuses(): { ok: true; count: number } {
    let count = 0
    for (const id of this.userTeam.roster) {
      const p = this.data.players.get(id)
      if (!p) continue
      this.practiceState = setPlayerFocus(this.practiceState, id as string, suggestPlayerFocus(p))
      count++
    }
    return { ok: true, count }
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
      faceId?: string
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
        ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
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
          ...(e.faceId !== undefined ? { faceId: e.faceId } : {}),
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
          ...(e.faceId !== undefined ? { faceId: e.faceId } : {}),
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

  /** Leaguewide ticker feed: recent transactions interleaved with current notable
   *  hot/cold team streaks (|streak| ≥ 5). The league's voice for the bottom ticker
   *  — read-only, derived from the ledger + streak tracking. */
  getLeagueWire(): LeagueWireView {
    const items: LeagueWireView['items'] = []
    // Recent transactions (most recent first).
    for (const tx of [...this.transactionLedger.items].reverse().slice(0, 25)) {
      items.push({ kind: 'transaction', text: tx.summary, accent: tx.kind === 'trade' })
    }
    // Current notable streaks across the whole league.
    for (const [teamId, streak] of this.teamStreaks) {
      if (Math.abs(streak) < 5) continue
      const team = this.data.teams.get(asTeamId(teamId))
      if (!team) continue
      const text =
        streak > 0
          ? `${team.abbreviation} have won ${streak} straight`
          : `${team.abbreviation} winless in ${Math.abs(streak)}`
      items.push({ kind: 'streak', text, teamAbbr: team.abbreviation, accent: Math.abs(streak) >= 8 })
    }
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
      offerSheets: [...this.offerSheets],
      waiverWire: this.waiverWire.map((w) => ({ ...w })),
      teamStreaks: [...this.teamStreaks.entries()],
      gmState: this.gmStateInternal ? structuredClone(this.gmStateInternal) : undefined,
      gmJobMarket: this.gmJobMarket ? this.gmJobMarket.map((o) => ({ ...o })) : undefined,
      ownerRequest: this.ownerRequest ? { ...this.ownerRequest } : undefined,
      gmRelationships: [...this.gmRelationships.entries()],
      mentorships: [...this.mentorships.entries()],
      clubDirection: this.clubDirection,
      fanInterest: this.fanInterest,
      baseBudget: this.baseBudget,
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
      chronicle: structuredClone(this.chronicle),
      gmPersonas: structuredClone(this.gmPersonas),
      boardMeetingYear: this.boardMeetingYear,
      lastSeasonMeta: this.lastSeasonMeta ? { ...this.lastSeasonMeta } : null,
      ownerPerk: this.ownerPerk,
      reviewFacts: this.reviewFacts ? structuredClone(this.reviewFacts) : null,
      deadlineHold: this.deadlineHold,
      deadlineHoldDone: this.deadlineHoldDone,
      userDeadCap: this.userDeadCap,
      buyoutFas: this.buyoutFas.map((id) => id as string),
      arbitrationCases: this.arbitrationCases.map((c) => ({ ...c })),
      boxScoreHistory: structuredClone(this.boxScoreHistory),
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
      seasonRatingTotals: [...this.seasonRatingTotals.entries()].map(([k, v]) => [k, { ...v }] as [string, { sum: number; n: number }]),
      practiceState: structuredClone(this.practiceState),
      hireableStaff: [...this.hireableStaff],
      lineManagementMode: this.lineManagementMode,
      ...(this.lineSetups.length > 0 ? { lineSetups: structuredClone(this.lineSetups) } : {}),
      ...(this.coachMarket ? { coachMarket: structuredClone(this.coachMarket) } : {}),
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
    career.offerSheets = snapshot.offerSheets ? snapshot.offerSheets.map((s) => ({ ...s })) : []
    career.waiverWire = snapshot.waiverWire ? snapshot.waiverWire.map((w) => ({ ...w })) : []
    career.teamStreaks = new Map(snapshot.teamStreaks ?? [])
    career.gmStateInternal = snapshot.gmState ? structuredClone(snapshot.gmState) : null
    career.gmJobMarket = snapshot.gmJobMarket ? snapshot.gmJobMarket.map((o) => ({ ...o })) : null
    career.ownerRequest = snapshot.ownerRequest ? { ...snapshot.ownerRequest } : null
    career.gmRelationships = new Map(snapshot.gmRelationships ?? [])
    career.mentorships = new Map(snapshot.mentorships ?? [])
    career.clubDirection = snapshot.clubDirection ?? 'compete'
    career.fanInterest = snapshot.fanInterest ?? 60
    career.baseBudget = snapshot.baseBudget ?? 0
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
    career.chronicle = snapshot.chronicle ? structuredClone(snapshot.chronicle) : emptyChronicle()
    career.gmPersonas = snapshot.gmPersonas ? structuredClone(snapshot.gmPersonas) : []
    // Old saves: no pending meeting (they're mid-flow) rather than surprising one.
    career.boardMeetingYear = snapshot.boardMeetingYear ?? null
    career.lastSeasonMeta = snapshot.lastSeasonMeta ? { ...snapshot.lastSeasonMeta } : null
    career.ownerPerk = snapshot.ownerPerk ?? null
    career.reviewFacts = snapshot.reviewFacts ? structuredClone(snapshot.reviewFacts) : null
    career.deadlineHold = snapshot.deadlineHold ?? false
    career.deadlineHoldDone = snapshot.deadlineHoldDone ?? false
    career.userDeadCap = snapshot.userDeadCap ?? 0
    career.buyoutFas = (snapshot.buyoutFas ?? []).map((id) => asPlayerId(id))
    career.arbitrationCases = (snapshot.arbitrationCases ?? []).map((c) => ({ ...c }))
    career.boxScoreHistory = snapshot.boxScoreHistory ? structuredClone(snapshot.boxScoreHistory) : []
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
    if (snapshot.seasonRatingTotals) {
      for (const [k, v] of snapshot.seasonRatingTotals) {
        career.seasonRatingTotals.set(k, { ...v })
      }
    }
    if (snapshot.practiceState) {
      career.practiceState = structuredClone(snapshot.practiceState)
    }
    if (snapshot.hireableStaff) {
      career.hireableStaff = [...snapshot.hireableStaff]
    }
    if (snapshot.lineSetups) {
      career.lineSetups = structuredClone(snapshot.lineSetups) as typeof career.lineSetups
    }
    if (snapshot.lineManagementMode === 'coach' || snapshot.lineManagementMode === 'fillGaps') {
      career.lineManagementMode = snapshot.lineManagementMode
    }
    if (snapshot.coachMarket) {
      career.coachMarket = structuredClone(snapshot.coachMarket)
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
