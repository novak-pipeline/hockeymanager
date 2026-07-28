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
  isEvent,
  type DraftPick,
  type GameResult,
  type GameStream,
  type NewsCategory,
  type NewsItem,
  type GameEvent,
  type OffseasonState,
  type Player,
  type PlayerId,
  type PlayoffsState,
  type Position,
  type ScheduledGame,
  type SquadStatus,
  type TradeStatus,
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
  createOrEscalateRelationshipArc,
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
  provenanceOf as chronicleProvenanceOf,
  eventsForPlayer as chronicleEventsForPlayer,
  type ChronicleState,
} from '@engine/story/chronicle'
import {
  DETECTORS,
  FEED_AUTHORS,
  engagementFor,
  noveltyClassOf,
  selectPosts,
  shouldReachInbox,
  PLAYER_CHECKPOINT_DAYS,
  type SalienceCtx,
  type StoryPriors,
} from '@engine/story/salience'
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
  type MeetingSpeaker,
  type SeasonReviewFacts,
} from './boardMeeting'
import {
  buildStaffMeetingScene,
  delegatedChoices,
  type StaffAction,
  type StaffCast,
  type StaffFinding,
  type StaffMeetingScene,
} from './staffMeetingScene'
import {
  buildScoutMeetingScene,
  delegatedScoutChoices,
  scoutMeetingHasContent,
  type ScoutMeetingAction,
  type ScoutMeetingInput,
  type ScoutMeetingScene,
  type ScoutBoardLine,
  type TrackableFind,
  type RefocusCandidate,
} from './scoutMeeting'
import {
  archiveSeason,
  emptyRecords,
  inductHallOfFame,
  recordWatch,
  registerRetirements,
  seedRecordsHistory,
  seedRecordsFromHistory,
  type RecordsState,
  type SeasonLine,
} from '@engine/story/records'
import { detectGameStory, detectPlayerStory, type PlayerGameLine } from '@engine/story/gameStory'
import { FIRST_NAMES, LAST_NAMES } from '@data/names'
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
  seedPundits,
  normalizePundits,
  applyPunditAnswer,
  punditStanding,
  punditRead,
  toneVerb,
  mediaStandingSummary,
  type PunditState,
} from '@engine/story/pundits'
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
import { coachQuote, coachHeadline, type CoachSituation, type CoachQuoteFacts } from '@engine/story/coachQuotes'
import {
  chemistryModifier,
  developmentModifier,
  electCaptain,
  initLockerRoom,
  leadershipScore,
  isCaptainEligible,
  onPlayerArrived,
  onPlayerDeparted,
  tickLockerRoom,
  type LockerRoomState,
} from '@engine/league/lockerRoom'
import {
  applyInteractionResponse,
  maybeRaiseInteraction,
  promiseFromResponse,
  reactionSpec,
  INTERACTION_COOLDOWN_DAYS,
  type PlayerInteraction,
  type PlayerPromise,
  type ReactionSpec,
} from '@engine/league/interactions'
import {
  scheduleReactions,
  reactionCopy,
  grudgeContext,
  type WorldAction,
  type WorldActionKind,
  type PendingLedgerReaction,
  type ResidueFlag,
} from './livingLedger'
import { markUsed, renderTemplate, type ContentCtx, type ContentUse } from '@engine/story/contentEngine'
import { DECISION_EVENTS, decisionSlots, pickDecisionEvent, type DecisionEffects } from '@engine/story/decisionEvents'
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
  capUsedFor,
  contractStatus,
  initialPicks,
  MAX_ROSTER_SIZE,
  offerAcceptable,
  processExpiries,
  signPlayer,
  releasePlayer as releaseFromTeam,
} from '@engine/league/contracts'
import {
  agentFor,
  evaluateRound,
  faAskDecay,
  findComparables,
  openNegotiation,
  openingLines,
  priorityHints,
  priorityWeights,
  type Comparable,
  type ContractOffer,
  type NegotiationState,
} from '@engine/league/negotiation'
import {
  seedAgentRapport,
  normalizeAgentRapport,
  relationOf,
  standingOf,
  rapportTilt,
  agentRapportNote,
  applyDealOutcome,
  type AgentRapportState,
} from '@engine/league/agentRapport'
import {
  buildTeamProfile,
  describePickValue,
  describePlayerValue,
  evaluateProposal,
  executeTrade,
  generateAiOffers,
  generateAiAiTrade,
  pickValue,
  playerValue,
  rosterCapUsed,
  solicitOffersForPlayer,
  askingPriceText,
  MIN_SHOP_VALUE,
  type StoredTradeOffer,
  type AiAiTradeResult,
} from '@engine/league/trades'
import {
  applyDeploymentMorale,
  applyResultMorale,
  effectiveResolve,
  formDeltaFromGame,
  injureNow,
  rollInjuries,
  tickRecovery,
} from '@engine/league/condition'
import { repairLines, coachSetLineup, coachAdjustedScore } from '@engine/league/lineup'
import { buildCoachProfile, profileToTactics, coachFit, nudgeProfileForDirection, specialTeamsEdges, SYSTEM_FAVORS } from '@engine/league/coachProfile'
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
  selectNeedWeighted,
  scoutPosGroup,
  type ScoutPosGroup,
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
  tickPractice,
  UNTARGETED_FOCUS_DRAG,
  type TeamPracticeState,
  type PracticeFocus,
} from '@engine/league/practice'
import { deserializeLeagueData, serializeLeagueData, serializeMap } from './serialize'
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
  type FeedView,
  type DevCampView,
  type DevCampInvitesView,
  type CampInvitesView,
  type CampInviteRow,
  type DevCampInviteRow,
  type DevCampState,
  type TrainingCampState,
  type TrainingCampView,
  type CampReport,
  type MedicalView,
  type MedicalRow,
  type LeagueStatTableView,
  type LeagueSkaterStatRow,
  type LeagueGoalieStatRow,
  type LeagueLeadersView,
  type LeagueComparisonView,
  type LeagueComparisonCard,
  type StaffMeetingSummaryView,
  type StaffMeetingView,
  type ScoutMeetingView,
  type CoachMarketView,
  type CoachMarketEntry,
  type PlayoffOddsView,
  type PlayoffOddsRow,
  type LeagueStatsView,
  type LeagueTeamsView,
  type LinesUpdate,
  type LockerRoomView,
  type OffseasonView,
  type NegotiationView,
  type FaHubView,
  type RfaBoardView,
  type RfaTargetView,
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
  type RoleBoardView,
  type RoleBoardRow,
  type LeadershipView,
  type LeadershipRowView,
  type StandingsView,
  type StatsView,
  type TacticsView,
  type TentpoleView,
  type TradeAssessmentView,
  type TradeDraftView,
  type TradeDraftAsset,
  type TradeInterestView,
  type TradeEvaluation,
  type TradeOfferView,
  type TradeProposal,
  type TradeSideView,
  type TradesView,
  type DeadlineDayView,
  type ShoppedPlayerView,
  type DeadlineFeedItemView,
  type TransactionsView,
  type TeamPlayerStatRow,
  type TeamPlayerStatsView,
  type StaffView,
  type StaffRowView,
  type MediaCircuitView,
  type MediaCircuitRowView,
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
    regulationOtWins: 0,
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
/** #188: readable label for each declared squad status (used in role grievances). */
const SQUAD_STATUS_LABEL: Record<SquadStatus, string> = {
  keyPlayer: 'key player',
  coreStarter: 'core starter',
  rotation: 'rotation regular',
  topProspect: 'top prospect',
  prospect: 'developing prospect',
  surplus: 'surplus',
}
const DRAFT_ROUNDS = 7
/** Floor for the prospect board; the actual class scales to cover all 7 rounds
 *  of every team (+ a margin of undrafted prospects). See draft-class generation. */
const DRAFT_CLASS_SIZE = 64
const PICK_YEARS_AHEAD = 3
/** #157: minimum games-remaining on an injury to qualify for Long-Term IR
 *  (the NHL rule is 10 games / 24 days; we key off the games estimate). */
const LTIR_MIN_GAMES = 10
const FA_WINDOW_DAYS = 8
/** Inclusive integer range [a..b] — used for jersey-number preference pools. */
function range(a: number, b: number): number[] {
  const out: number[] = []
  for (let n = a; n <= b; n++) out.push(n)
  return out
}

/** Active NHL roster ceiling. Real NHL: 23 in-season (20 dressed + up to 3
 *  healthy scratches); the rest of the org plays in the AHL. */
const ROSTER_HARD_CAP = 23
/** Max Standard Player Contracts an organization may hold at once (NHL + AHL +
 *  signed junior prospects). The real NHL's 50-contract reserve-list limit. */
const ORG_CONTRACT_LIMIT = 50
/** CBA contract-length ceilings: a club can offer its OWN player one more year
 *  than an outside team can offer a UFA (8 vs 7). */
const MAX_TERM_RESIGN = 8
const MAX_TERM_UFA = 7
/** Entry-level contract ceilings: base salary is capped (~$950K) and the term
 *  runs at most 3 years. Bonuses (not modeled here) top it up in the real CBA. */
const ELC_MAX_SALARY = 950_000
const ELC_MAX_TERM = 3
/** Rolling per-game ratings window (last N games stored). */
const RATINGS_WINDOW = 10
/** Calendar days between recurring staff-meeting prompts. */
const STAFF_MEETING_INTERVAL = 14
/** Calendar days between recurring scout-meeting prompts (monthly, rarer than staff). */
const SCOUT_MEETING_INTERVAL = 28
/** Phase offset so scout-meeting boundaries (7, 35, 63…) never land on a staff-
 *  meeting day (every multiple of 14) — otherwise the two convened meetings would
 *  collide on the same Continue and the scout one would be perpetually skipped. */
const SCOUT_MEETING_OFFSET = 7

type ResignStatus = 'pending' | 'signed' | 'walked'

/**
 * Teams from ONE conference that qualify for the playoffs, given its members
 * already sorted best→worst by points. NHL-style top-3-per-division + wildcards
 * up to `qual` when the conference is divisional; otherwise the top `qual`.
 * Shared by the Monte-Carlo odds and the mathematical clinch check so the two
 * views of "who's in" can never drift apart.
 */
export function qualifiersInConference(
  sortedMembers: TeamId[],
  divOf: (t: TeamId) => string,
  qual: number,
  useDivisional: boolean
): TeamId[] {
  if (!useDivisional) return sortedMembers.slice(0, qual)
  const byDiv = new Map<string, TeamId[]>()
  for (const t of sortedMembers) {
    const d = divOf(t)
    if (!byDiv.has(d)) byDiv.set(d, [])
    byDiv.get(d)!.push(t)
  }
  const seeded = new Set<TeamId>()
  for (const d of byDiv.values()) for (const t of d.slice(0, 3)) seeded.add(t) // top 3 per division
  for (const t of sortedMembers) { // wildcards = next best in the conference
    if (seeded.size >= qual) break
    if (!seeded.has(t)) seeded.add(t)
  }
  return [...seeded]
}

export class Career {
  readonly data: LeagueData
  readonly seed: number
  userTeamId: TeamId

  private currentDay = 0
  private phase: CareerPhase = 'regularSeason'
  /** The current phase — for harnesses/telemetry. Read-only. */
  get seasonPhase(): CareerPhase {
    return this.phase
  }
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
  /** Per-season shutouts, credited to the winning goalie who allowed 0 goals
   *  (one per game). Accumulated per game like goalieWins; cleared at rollover. */
  private readonly shutouts = new Map<PlayerId, number>()
  private readonly ppGoals = new Map<PlayerId, number>()
  private readonly ppAssists = new Map<PlayerId, number>()
  /** #175: shorthanded goals/assists — the PK's scoring side, credited from the
   *  event stream's `strength:'sh'` goals (previously dropped). */
  private readonly shGoals = new Map<PlayerId, number>()
  private readonly shAssists = new Map<PlayerId, number>()
  private news: NewsItem[] = []
  private newsCounter = 0
  /** Player→GM concerns (open + recently resolved). Story-first core. */
  private interactions: PlayerInteraction[] = []
  private interactionCounter = 0
  /** LW5 promise ledger: every promise-tone answer becomes a tracked debt. */
  private playerPromises: PlayerPromise[] = []
  /** Living Ledger (Narrative Engine layer 0): actions have witnesses. */
  private worldActions: WorldAction[] = []
  private ledgerReactions: PendingLedgerReaction[] = []
  private residueFlags: ResidueFlag[] = []
  private ledgerCounter = 0
  /** Content Engine no-repeat ledger (B4.5): nothing repeats verbatim in a season. */
  private contentLedger: ContentUse[] = []
  /** Feed Phase A: priors ledger + save-wide novelty memory (THE-FEED.md). */
  private storyPriors: StoryPriors | null = null
  /** The social feed — separate from inbox news so posts never crowd the
   *  GM's mailbox (curation lands in Phase B). Bounded, newest first. */
  private feedPosts: NewsItem[] = []
  private feedCounter = 0
  /** Phase B curation: accounts the GM follows — their posts reach the inbox
   *  (as do any posts above the importance floor, follows or not). */
  private followedFeedAuthors: string[] = []
  /** DEPTH 1: live contract-negotiation sessions, keyed by playerId. Sessions
   *  are per-offseason; stale ones are dropped when eligibility lapses. */
  private negotiations = new Map<string, NegotiationState>()
  /** DEPTH 2: free agents the GM is tracking — shortlisted names get loss
   *  mail with a reason when a rival signs them. */
  private faShortlist = new Set<string>()
  /** #167: standing offers the GM has tabled to free agents. They don't sign
   *  on the spot — each decides on his own day, weighing your money against the
   *  rival field. faDay-relative decision day. Offseason FA-window only. */
  private faPendingOffers: Array<{ playerId: string; salary: number; years: number; decideDay: number }> = []
  /** #183: tendered offer sheets awaiting the owner's decision. Real NHL rule:
   *  once the RFA signs, his club has a 7-day match window to match or let him
   *  walk for pick compensation. We model that clock in faDays. */
  private pendingOfferSheets: Array<{ playerId: string; ownerTeamId: string; salary: number; years: number; decideDay: number }> = []
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
  /** #184: trade proposals the AI GM has taken "under advisement" — real GMs
   *  don't answer serious offers on the spot. Each resolves after a short
   *  deliberation (accept → execute, or counter), delivered by inbox. */
  private pendingTrades: Array<{ proposal: TradeProposal; verdict: 'accept' | 'counter'; counterAskValue: number; daysLeft: number }> = []
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
  /** Career counting milestones already announced (`${pid}:g:500` …). Seeded from
   *  current totals on first tick so we never announce an already-reached one;
   *  transient (re-seeds after load, which is correct — nothing to re-announce). */
  private milestonesFired = new Set<string>()
  private milestonesSeeded = false
  /** In-season all-time single-season record chase/break news already fired
   *  (`${pid}:points:break:${year}` …). Seeded on first tick so a mid-season load
   *  never re-announces; transient (re-seeds after load, which is correct). */
  private recordWatchFired = new Set<string>()
  private recordWatchSeeded = false
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
  /** M3 dev camp: soft gate — the first Continue after the draft (or at a new
   *  summer-start career) walks you onto the rink. */
  private devCampPending = false
  /** #182: the GM's explicit dev-camp invite list. Undefined ⇒ use the auto pool;
   *  once the GM edits invites it holds the exact set (add tryout kids, cut some). */
  private devCampRoster: string[] | undefined = undefined
  /** #182: the GM's explicit training-camp PTO (pro-tryout) invite list. Undefined
   *  ⇒ the AGM auto-picks; once edited it holds the exact set of unsigned vets the
   *  GM brings to main camp. Consumed when the camp week is built at preseason. */
  private campPtoInvites: string[] | undefined = undefined
  /** Dev-camp week progress: null until camp opens; day 1..3 while running. */
  private devCampState: DevCampState | null = null
  /** M3 training camp: cut-day decisions staged at the preseason stage;
   *  resolved (by you or the coach) before opening night. */
  private trainingCamp: TrainingCampState | null = null
  /** Last season's story, for the owner's opening lines at the board meeting. */
  private lastSeasonMeta: { predictedRank: number; actualRank: number; madePlayoffs: boolean; wonCup: boolean } | null = null
  /** Owner-investment perk chosen at the board meeting ('scouting' | 'development'). */
  private ownerPerk: string | null = null
  /** Staged End-of-Season Review facts (M4); null once attended or lapsed. */
  private reviewFacts: SeasonReviewFacts | null = null
  /** Dead-cap charge from buyouts counted against the currently-managed season's
   *  cap. Derived from `deadCapSchedule` — the slice for the season being built
   *  (offseason) or played (regular season). */
  private userDeadCap = 0
  /** Full buyout dead-cap tail: one entry per season a buyout charge applies to.
   *  A buyout spreads over TWICE the contract's remaining years (real CBA), so a
   *  4-year contract bought out leaves 8 seasons of dead cap. */
  private deadCapSchedule: Array<{ year: number; amount: number }> = []
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
  /** Once-per-season latch so the mathematical clinch / elimination headline
   *  fires exactly once. Reset at each season rollover; persisted in saves. */
  private playoffBerthAnnounced: 'clinched' | 'eliminated' | null = null
  /** Yesterday's league ranks for standings-delta arcs. Transient (rebuilt daily). */
  private readonly prevRanks = new Map<string, number>()
  /* ── press corps (Wave 2) ── */
  /** Rolling factual career summary fed to the press as long-term memory. */
  private sagaSoFar = ''
  /** Pending writing assignment for the renderer-side press pump. */
  private pressJob: PressJob | null = null
  /** Pending press-conference question awaiting the user's answer. */
  private pressConference: PressConferenceState | null = null
  /** #90: the GM's persistent standing with each named pundit. Serialized in the
   *  snapshot; old saves lazily seed neutral relationships on load. */
  private punditState: PunditState = seedPundits()
  /** The GM's persistent standing with each contract agent (keyed by agent name).
   *  Serialized in the snapshot; old saves lazily seed an empty state on load.
   *  Neutral/absent ⇒ zero effect on negotiations. */
  private agentRapport: AgentRapportState = seedAgentRapport()
  /** The convened bi-weekly staff meeting awaiting the GM (blocking, with a
   *  delegate-to-AGM escape). Null when none is pending. JSON-safe → serialized. */
  private staffMeetingScene: StaffMeetingScene | null = null
  /** The convened recurring scout meeting awaiting the GM (blocking, with a
   *  delegate-to-Head-of-Scouting escape). Null when none is pending. Serialized. */
  private scoutMeetingScene: ScoutMeetingScene | null = null
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
  /** #173: the GM's ticket-pricing lever. `value` fills the building and grows the
   *  fanbase but earns less per seat; `premium` earns more per seat but nudges
   *  fans away over time. Serialized additively; defaults to 'standard'. */
  private ticketPricing: 'value' | 'standard' | 'premium' = 'standard'
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
    this.normalizeContracts() // #185: strip illegal NTCs (runs for new + loaded)
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
      // Seed a plausible franchise past so the record book + banner rafters
      // aren't empty on day one (P1 story history). Deterministic per seed.
      {
        const seedTeams = this.data.league.teams.map((id) => {
          const t = this.data.teams.get(id)!
          return { id: id as string, abbreviation: t.abbreviation, name: t.name }
        })
        // An imported DB carries REAL history — actual Stanley Cup champions and
        // franchise records (Gretzky's 215, and so on). Seed the record book
        // from it so records-chase news and the history screens cite the truth.
        // Generated leagues (no imported history) fabricate a plausible past.
        if (this.data.importedHistory) {
          this.recordsState = seedRecordsFromHistory({
            history: this.data.importedHistory,
            teams: seedTeams,
            currentYear: this.year,
          })
        } else {
          const histRng = new Rng(deriveSeed(seed, 9500))
          const makeName = (): string =>
            `${FIRST_NAMES[Math.floor(histRng.next() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(histRng.next() * LAST_NAMES.length)]}`
          this.recordsState = seedRecordsHistory({
            teams: seedTeams,
            currentYear: this.year,
            rand: () => histRng.next(),
            makeName,
          })
        }
      }
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
    // Every real hockey player wears a number — generated players start without one,
    // so back-fill unique numbers per club (imported DBs keep whatever they shipped).
    this.ensureJerseyNumbers()
  }

  /** Give every rostered player who lacks a jersey number a club-unique one. Only
   *  fills gaps (a player who already has a number — e.g. from an imported DB or a
   *  previous assignment — keeps it), so it's idempotent and save-safe. A stable
   *  per-player preference spreads the numbers out instead of a 1,2,3… run. */
  private ensureJerseyNumbers(): void {
    for (const team of this.data.teams.values()) {
      if (team.tier === 'ahl' || team.tier === 'world') continue
      const used = new Set<number>()
      for (const id of team.roster) {
        const n = this.data.players.get(id)?.jerseyNumber
        if (n !== undefined) used.add(n)
      }
      for (const id of team.roster) {
        const p = this.data.players.get(id)
        if (!p || p.jerseyNumber !== undefined) continue
        // Stable hash of the id → a preferred number, biased by position so the
        // numbers read like real hockey (goalies in the 30s/1/60s+; skaters take
        // the 2–29 and 40–98 range). Falls through to the next free number.
        let h = 2166136261
        for (let i = 0; i < (id as string).length; i++) { h ^= (id as string).charCodeAt(i); h = Math.imul(h, 16777619) }
        const hv = h >>> 0
        const pool = p.position === 'G'
          ? [...range(30, 39), 1, 35, ...range(60, 79), ...range(40, 49)]
          : [...range(2, 29), ...range(40, 98)]
        let num = pool[hv % pool.length]!
        let guard = 0
        // Walk the pool from the preferred slot until a free number turns up;
        // if the whole preferred pool is taken, fall back to any free 1–98.
        while (used.has(num) && guard < pool.length) { guard++; num = pool[(hv + guard) % pool.length]! }
        for (let n = 1; used.has(num) && n <= 98; n++) if (!used.has(n)) num = n
        p.jerseyNumber = num
        used.add(num)
      }
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
    return buildAhlSquadView(this.ahlViewCtx(), this.ahlGp, this.ahlTotals)
  }

  private get deadlineDay(): number {
    const last = this.matchDays[this.matchDays.length - 1] ?? 0
    return Math.floor(last * 0.75)
  }

  private refreshMatchDays(): void {
    this.matchDays = [...new Set(this.data.league.schedule.map((g) => g.day))].sort((a, b) => a - b)
  }

  /**
   * #185: no-trade clauses are a veteran perk. A player only earns one once he
   * has UFA leverage; the CBA outright forbids clauses on an entry-level deal.
   * Random generation/import used to hand them to anyone rated 80+, so young
   * studs (an 18-year-old on his ELC) ended up "protected" for no reason. Strip
   * any clause off a non-UFA player. Runs on every construct — new AND loaded —
   * so imported real rosters and existing saves are corrected too. Genuine
   * UFA-eligible vets keep their (ideally DB-sourced) clause untouched.
   */
  private normalizeContracts(): void {
    for (const p of this.data.players.values()) {
      if (p.contract.noTradeClause && contractStatus(p) !== 'UFA') {
        p.contract.noTradeClause = false
        if (p.contract.clause && p.contract.clause !== 'none') p.contract.clause = 'none'
      }
    }
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
      pos === 'G' ? 'G' : pos === 'D' ? 'D' : 'F'
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
      shGoals: this.shGoals,
      shAssists: this.shAssists,
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
      channel?: 'feed' | 'wire'
      authorId?: string
      salience?: number
      engagement?: { likes: number; reposts: number }
    } = {}
  ): void {
    const item: NewsItem = {
      id: `n${this.newsCounter++}`,
      day: this.currentDay,
      year: this.year,
      ...(this.phase === 'offseason' ? { dateISO: this.offseasonDateISO() } : {}),
      category,
      headline,
      body,
      read: false,
      ...(refs.teamId !== undefined ? { teamId: refs.teamId } : {}),
      ...(refs.playerId !== undefined ? { playerId: refs.playerId } : {}),
      ...(refs.press !== undefined ? { press: refs.press } : {}),
      ...(refs.speaker !== undefined ? { speaker: refs.speaker } : {}),
      ...(refs.speakerFaceId !== undefined ? { speakerFaceId: refs.speakerFaceId } : {}),
      ...(refs.channel !== undefined ? { channel: refs.channel } : {}),
      ...(refs.authorId !== undefined ? { authorId: refs.authorId } : {}),
      ...(refs.salience !== undefined ? { salience: refs.salience } : {}),
      ...(refs.engagement !== undefined ? { engagement: refs.engagement } : {}),
    }
    this.news.unshift(item)
    if (this.news.length > NEWS_LIMIT) this.news.length = NEWS_LIMIT
  }

  /**
   * Drop rich, per-player "Scout report" cards into the inbox as the department
   * files them — the skippable cards the Scouting Centre queues, delivered to the
   * inbox too (task #85). Two sources feed the pool: the prospects our scouts
   * FLAG (Scouting Centre finds) and any notable non-prospect a scout gets a full
   * read on (knowledge ≥ 80). Capped at 2/day so the feed never floods.
   *
   * The daily batch is **position-diverse and need-weighted**: candidates are
   * bucketed by position group and drawn round-robin, ordering the groups your
   * roster is thin at first. So the reports never collapse to a single position
   * (the "only goaltenders" bug) even when the club is desperate at one spot —
   * a thin group is surfaced first, but the batch still spans other positions.
   *
   * On the first call (incl. after load) it seeds from existing intel without
   * reporting, so loading a save never spams reports for already-known players.
   */
  private emitScoutReports(): void {
    const KNOWN = 80
    if (!this.scoutReportSeeded) {
      for (const [pid, k] of this.scouting.knowledge) {
        if (k >= KNOWN) this.scoutReported.add(pid as string)
      }
      // Finds already surfaced at seed time are "known" — don't retro-report them.
      for (const r of this.scouting.recommendations ?? []) this.scoutReported.add(r.playerId)
      this.scoutReportSeeded = true
      return
    }
    const orgIds = this.ownOrgIds()

    type Cand = { id: string; p: Player; group: ScoutPosGroup; potStars: number; reason: string }
    const cands: Cand[] = []
    const seenCand = new Set<string>()

    // Source 1: freshly-flagged Scouting Centre finds (prospects our scouts rate).
    // These carry the scout's own grade + reason. We report them (in addition to
    // the weekly digest) so a genuine find lands as its own inbox card.
    for (const r of this.scouting.recommendations ?? []) {
      const id = r.playerId
      if (this.scoutReported.has(id) || seenCand.has(id) || orgIds.has(id)) continue
      const p = this.data.players.get(asPlayerId(id))
      if (!p) continue
      seenCand.add(id)
      cands.push({ id, p, group: scoutPosGroup(p.position), potStars: overallToStars(this.scoutedCeilingOf(p)), reason: r.reason })
    }

    // Source 2: notable non-prospects a scout has now got a full read on. A player
    // that never clears the notability bar is marked reported so we never re-scan
    // him (parity with the old sweep); a notable one that isn't picked today stays
    // eligible for a later day's batch.
    for (const [pid, k] of this.scouting.knowledge) {
      if (k < KNOWN) continue
      const id = pid as string
      if (this.scoutReported.has(id) || seenCand.has(id) || orgIds.has(id)) continue
      const p = this.data.players.get(pid as PlayerId)
      if (!p) { this.scoutReported.add(id); continue }
      const potStars = overallToStars(this.scoutedCeilingOf(p))
      const ovr = ratedOverall(p)
      if (potStars < 4 && ovr < 78) { this.scoutReported.add(id); continue } // never reportable
      seenCand.add(id)
      const cur = overallToStars(ratedOverall(p))
      const v = buildScoutVerdict(p, cur, potStars)
      const pro = v.pros[0] ? ` ${v.pros[0]}.` : ''
      cands.push({ id, p, group: scoutPosGroup(p.position), potStars, reason: `${v.recommendation}${pro} Best deployed as ${v.bestRole}.` })
    }
    if (cands.length === 0) return

    // Draw a position-diverse, need-weighted batch (thinnest roster group first,
    // round-robin so it never collapses to a single position — see #1).
    const picked = selectNeedWeighted<Cand>(
      cands, (c) => c.group, (c) => c.potStars, (g) => this.positionNeedRank(g), 2,
    )

    for (const f of picked) {
      this.scoutReported.add(f.id)
      this.pushNews(
        'scouting',
        `Scout report: ${f.p.name}`,
        `Our scouts have filed a full report on ${f.p.name} (${f.p.position}, age ${f.p.age}). ${f.reason}`,
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
    seed: number
  ): void {
    const coach = this.getTeamStaff(this.userTeamId as string).headCoach
    // Both headline and body rotate through their pools via the content-engine
    // no-repeat ledger: within a season the coach never says the same thing
    // twice at the podium (EXCELLENCE.md B4.5).
    const noRepeat = { ledger: this.contentLedger, year: this.year, day: this.currentDay }
    const headline = coachHeadline(coach, situation, facts, seed, noRepeat)
    const quote = coachQuote(coach, situation, facts, seed, noRepeat)
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

  /** LW6 (#140): append the persistent all-time head-to-head record to rivalry
   *  news so the beat cites a specific fact. No-op when the pairing has no
   *  recorded history yet (returns the seeds unchanged). */
  private groundRivalryNews(
    seeds: Array<{ category: NewsCategory; headline: string; body: string; playerId?: string; teamId?: string }>,
    teamAId: string,
    teamBId: string,
  ): typeof seeds {
    const h2h = chronicleHeadToHead(this.chronicle, teamAId, teamBId)
    if (!h2h) return seeds
    const total = h2h.wins + h2h.losses
    if (total < 3) return seeds // too little history to be worth citing
    const abbrA = this.data.teams.get(teamAId as TeamId)?.abbreviation ?? teamAId
    const abbrB = this.data.teams.get(teamBId as TeamId)?.abbreviation ?? teamBId
    const seriesPart =
      h2h.seriesWins + h2h.seriesLosses > 0
        ? ` They've met ${h2h.seriesWins + h2h.seriesLosses} time${h2h.seriesWins + h2h.seriesLosses === 1 ? '' : 's'} in the playoffs (${abbrA} ${h2h.seriesWins}–${h2h.seriesLosses}).`
        : ''
    const line = ` All-time, the series stands ${abbrA} ${h2h.wins}–${h2h.losses} ${abbrB}.${seriesPart}`
    return seeds.map((s) => ({ ...s, body: s.body + line }))
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
      // The bench's matchup habit (home last change): an imported coach with a
      // real Line Matching skill runs it; otherwise structured tacticians do.
      // Read by both sims — a matching HOME bench counters the opposing top line
      // with its checking line.
      const lmSkill = ts.headCoach.attributes?.lineMatching
      team.tactics.lineMatching =
        lmSkill !== undefined ? lmSkill >= 12 : profile.structure >= 0.55 && profile.tacticsKnowledge >= 0.5
      // Special-teams coaching: PP/PK competence + formation-personnel fit →
      // small shot-rate edges both sims read on the power play.
      const pp1 = (team.lines.powerPlayUnits[0] ?? []).map((id) => this.resolve(id))
      const stEdges = specialTeamsEdges(profile, team.tactics, pp1)
      team.ppEdge = stEdges.ppEdge
      team.pkEdge = stEdges.pkEdge
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
      // #189: re-apply any GM-declared captain/alternates over the auto-picked room
      // so the choice survives a season re-init / roster churn.
      this.syncCaptainOverride(teamId)
    })
  }

  /**
   * #189: fold the team's GM-declared captain/alternates (Team.captainId /
   * alternateCaptainIds) into the live locker-room state so the dynamics model
   * honours the GM's choice. Silently drops any letter-wearer no longer on the
   * roster. No-op when the GM hasn't overridden (auto-pick stands).
   */
  private syncCaptainOverride(teamId: TeamId): void {
    const team = this.data.teams.get(teamId)
    const lr = this.lockerRooms.get(teamId)
    if (!team || !lr) return
    const onRoster = new Set(team.roster.map((id) => id as string))
    const hasOverride = team.captainId !== undefined || (team.alternateCaptainIds?.length ?? 0) > 0
    if (!hasOverride) return
    const capId = team.captainId && onRoster.has(team.captainId as string) ? (team.captainId as string) : null
    lr.captainId = capId
    const maxAlts = capId ? 2 : 3
    lr.alternateIds = (team.alternateCaptainIds ?? [])
      .map((id) => id as string)
      .filter((id) => onRoster.has(id) && id !== capId)
      .slice(0, maxAlts)
  }

  /** All-time totals (archived seasons + current season counters). */
  private careerTotalsOf(pid: PlayerId): {
    goals: number
    assists: number
    points: number
    gamesPlayed: number
    shutouts: number
  } {
    let goals = 0
    let assists = 0
    let gamesPlayed = 0
    let shutouts = 0
    const p = this.data.players.get(pid)
    if (p) {
      for (const s of p.stats) {
        if (s.league === 'ahl') continue // NHL career totals only — the farm line is separate
        goals += s.ev.goals + s.pp.goals + s.pk.goals
        assists += s.ev.assists + s.pp.assists + s.pk.assists
        gamesPlayed += s.gamesPlayed
        shutouts += s.shutouts
      }
    }
    const t = this.totals.get(pid)
    if (t) {
      goals += t.goals
      assists += t.assists
    }
    gamesPlayed += this.gp.get(pid) ?? 0
    shutouts += this.shutouts.get(pid) ?? 0
    return { goals, assists, points: goals + assists, gamesPlayed, shutouts }
  }

  /* ─────────────────────── career counting milestones ─────────────────────── */

  private static readonly GOAL_MILES = [100, 200, 300, 400, 500, 600, 700, 800]
  private static readonly POINT_MILES = [500, 1000, 1250, 1500, 1750, 2000]
  private static readonly GAME_MILES = [500, 1000, 1500]
  private static readonly SHUTOUT_MILES = [25, 50, 75, 100]

  /** The milestone keys a player's career totals currently satisfy. */
  private milestoneKeysFor(pid: string, t: { goals: number; points: number; gamesPlayed: number; shutouts: number }): string[] {
    const keys: string[] = []
    for (const g of Career.GOAL_MILES) if (t.goals >= g) keys.push(`${pid}:g:${g}`)
    for (const p of Career.POINT_MILES) if (t.points >= p) keys.push(`${pid}:p:${p}`)
    for (const gp of Career.GAME_MILES) if (t.gamesPlayed >= gp) keys.push(`${pid}:gp:${gp}`)
    for (const so of Career.SHUTOUT_MILES) if (t.shutouts >= so) keys.push(`${pid}:so:${so}`)
    return keys
  }

  /**
   * Fire a news headline when a player crosses a round career milestone (goals,
   * points, games). Your own org's players make news at every tier; the rest of
   * the league only for the truly historic ones (500 goals, 1000 points/games) —
   * emergent multi-decade colour without spamming the inbox.
   */
  private emitCareerMilestones(outcomes: GameOutcome[]): void {
    // Seed once (also after load) so already-reached milestones never re-announce.
    if (!this.milestonesSeeded) {
      for (const p of this.data.players.values()) {
        for (const k of this.milestoneKeysFor(p.id as string, this.careerTotalsOf(p.id))) this.milestonesFired.add(k)
      }
      this.milestonesSeeded = true
      return
    }
    const played = new Set<string>()
    for (const res of outcomes) for (const [pid] of res.playerStats) played.add(pid as string)
    if (played.size === 0) return
    const orgIds = this.ownOrgIds()
    for (const pid of played) {
      const p = this.data.players.get(asPlayerId(pid))
      if (!p) continue
      const totals = this.careerTotalsOf(asPlayerId(pid))
      for (const k of this.milestoneKeysFor(pid, totals)) {
        if (this.milestonesFired.has(k)) continue
        this.milestonesFired.add(k)
        const [, kind, nStr] = k.split(':')
        const n = Number(nStr)
        const isOwn = orgIds.has(pid)
        const isMajor =
          (kind === 'g' && n >= 500) || (kind === 'p' && n >= 1000) ||
          (kind === 'gp' && n >= 1000) || (kind === 'so' && n >= 50)
        if (!isOwn && !isMajor) continue
        const teamAbbr = this.data.teams.get(this.teamOf(asPlayerId(pid)) ?? this.userTeamId)?.abbreviation ?? ''
        const noun = kind === 'g' ? 'career goal' : kind === 'p' ? 'career point' : kind === 'so' ? 'career shutout' : 'NHL game'
        const headline =
          kind === 'gp' ? `${p.name} plays his ${n.toLocaleString()}th NHL game`
          : `${p.name} reaches ${n.toLocaleString()} ${noun}s`
        const flavour = isMajor ? ' A milestone that puts him in rare company.' : ''
        this.pushNews('milestone',
          headline,
          `${p.name} (${p.position}${teamAbbr ? `, ${teamAbbr}` : ''}) hit ${n.toLocaleString()} ${noun}s for his career.${flavour}`,
          { playerId: pid })
        // Your own player crossing a MAJOR line gets the coach at the podium —
        // an authored pool that sat dark until now. Minor milestones stay news-only.
        if (isOwn && isMajor) {
          this.pushCoachQuote('milestone', { playerName: p.name }, this.seed ^ Career.pidNum(pid) ^ (n * 17))
        }
      }
    }
  }

  /**
   * The moment a player actually BREAKS the all-time single-season points or
   * goals record. The existing pace-watch already flags who's ON TRACK; this is
   * the discrete "the record is gone" beat (for anyone in the league), which a
   * projection can't give. Seeds already-broken keys on the first tick so a
   * mid-season load can't re-announce. Fires from storyTickDay.
   */
  private emitRecordWatch(_day: number, outcomes: GameOutcome[]): void {
    const ptsRec = this.recordsState.singleSeason.points[0]
    const gRec = this.recordsState.singleSeason.goals[0]
    if (!ptsRec && !gRec) return
    const y = this.year

    // Seed already-broken thresholds silently (covers a mid-season load).
    if (!this.recordWatchSeeded) {
      for (const [pid, t] of this.totals) {
        const key = pid as string
        if (ptsRec && t.goals + t.assists > ptsRec.value) this.recordWatchFired.add(`${key}:points:${y}`)
        if (gRec && t.goals > gRec.value) this.recordWatchFired.add(`${key}:goals:${y}`)
      }
      this.recordWatchSeeded = true
      return
    }

    const played = new Set<string>()
    for (const res of outcomes) for (const [pid] of res.playerStats) played.add(pid as string)
    for (const pid of played) {
      const p = this.data.players.get(asPlayerId(pid))
      const t = this.totals.get(asPlayerId(pid))
      if (!p || !t) continue
      if (ptsRec) this.checkRecordBreak(pid, p, 'points', t.goals + t.assists, ptsRec)
      if (gRec) this.checkRecordBreak(pid, p, 'goals', t.goals, gRec)
    }
  }

  private checkRecordBreak(
    pid: string, p: Player, kind: 'points' | 'goals', seasonTotal: number,
    rec: { value: number; playerName: string; year: number },
  ): void {
    const key = `${pid}:${kind}:${this.year}`
    if (seasonTotal <= rec.value || this.recordWatchFired.has(key)) return
    this.recordWatchFired.add(key)
    const label = kind === 'points' ? 'point' : 'goal'
    this.pushNews('milestone',
      `${p.name} breaks the all-time single-season ${kind} record`,
      `${p.name} is up to ${seasonTotal} ${label}s — passing ${rec.playerName}'s ${rec.value} from ${rec.year} for the most in a single season in league history. A record that stood for years, gone. History, made.`,
      { playerId: pid })
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
        shutouts: this.shutouts.get(pid) ?? 0,
      })
    }
    return lines
  }

  /** Award winners with display values, for the records archive. */
  /**
   * Canonical end-of-season individual award winners, computed once from the live
   * season accumulators (this.totals / this.gp) so the permanent archive and the
   * offseason display can never drift apart. Six trophies modelled on the NHL:
   *
   *   Hart (MVP)     — most valuable: points weighted by team success, so it isn't
   *                    mechanically the raw scoring leader; a dominant workhorse
   *                    goalie can win in a down year for the forwards.
   *   Art Ross       — the actual scoring title (points leader among skaters).
   *   Rocket Richard — most goals (labelled "Top Goal Scorer").
   *   Best Playmaker — most assists (flavour; not a real NHL trophy).
   *   Norris         — best defenceman (points among D at a starter's workload).
   *   Calder         — rookie of the year (a genuine first-year player).
   *   Vezina         — best save % among true starters, not a hot-backup sample.
   *
   * Workload floors are relative to the league's own busiest player that season,
   * so they self-calibrate to a 60- or 82-game schedule without hard-coding either.
   */
  private seasonAwardWinners(): Array<{ award: string; playerId: PlayerId; value: string }> {
    const winners: Array<{ award: string; playerId: PlayerId; value: string }> = []
    const gpOf = (id: PlayerId): number => this.gp.get(id) ?? 0
    const pts = (t: GamePlayerStat): number => t.goals + t.assists
    const svPct = (t: GamePlayerStat): number => t.saves / Math.max(1, t.shotsAgainst)

    // Busiest skater / goalie this season → self-calibrating workload floors.
    let maxSkaterGp = 1
    let maxGoalieGp = 1
    for (const [id] of this.totals) {
      const p = this.data.players.get(id)
      if (!p) continue
      if (p.position === 'G') maxGoalieGp = Math.max(maxGoalieGp, gpOf(id))
      else maxSkaterGp = Math.max(maxSkaterGp, gpOf(id))
    }
    // League-average goalie save rate (starters only) → the Hart goalie metric.
    let svSaves = 0
    let svShots = 0
    for (const [id, t] of this.totals) {
      const p = this.data.players.get(id)
      if (p?.position === 'G' && gpOf(id) >= 0.5 * maxGoalieGp) {
        svSaves += t.saves
        svShots += t.shotsAgainst
      }
    }
    const leagueSv = svShots > 0 ? svSaves / svShots : 0.9
    // Team-success factor for the Hart (0.8 poorest club … 1.2 best in the league).
    let maxTeamPts = 1
    for (const s of this.standings.values()) maxTeamPts = Math.max(maxTeamPts, s.points)
    const teamFactor = (id: PlayerId): number => {
      const tid = this.teamOf(id)
      const p = tid ? this.standings.get(tid)?.points ?? 0 : 0
      return 0.8 + 0.4 * (p / maxTeamPts)
    }
    // Rookie: a genuine first-year pro (no archived season) young enough to qualify.
    const isRookieSeason = (p: Player): boolean => p.stats.length === 0 && p.age <= 24

    const pick = (
      award: string,
      score: (t: GamePlayerStat, p: Player, id: PlayerId) => number,
      fmt: (t: GamePlayerStat, p: Player) => string
    ): void => {
      let bestId: PlayerId | null = null
      let bestVal = -Infinity
      for (const [id, t] of this.totals) {
        const p = this.data.players.get(id)
        if (!p) continue
        const v = score(t, p, id)
        if (v > bestVal) {
          bestVal = v
          bestId = id
        }
      }
      if (bestId && bestVal > -Infinity) {
        winners.push({ award, playerId: bestId, value: fmt(this.totals.get(bestId)!, this.resolve(bestId)) })
      }
    }

    // Hart — value, not raw points: a skater gets points × team-success; a starter
    // goalie is scored on save rate above league average × the volume he faced, so
    // the trophy occasionally lands with a goalie the way the real Hart does.
    pick(
      'Most Valuable Player',
      (t, p, id) => {
        if (p.position === 'G') {
          if (gpOf(id) < 0.6 * maxGoalieGp) return -Infinity
          return (svPct(t) - leagueSv) * t.shotsAgainst * 3.0 * teamFactor(id)
        }
        return pts(t) * teamFactor(id)
      },
      (t, p) => (p.position === 'G' ? `.${Math.round(svPct(t) * 1000)} SV%` : `${pts(t)} PTS`)
    )
    pick('Art Ross Trophy', (t, p) => (p.position === 'G' ? -Infinity : pts(t)), (t) => `${pts(t)} PTS`)
    pick('Top Goal Scorer', (t, p) => (p.position === 'G' ? -Infinity : t.goals), (t) => `${t.goals} G`)
    pick('Best Playmaker', (t, p) => (p.position === 'G' ? -Infinity : t.assists), (t) => `${t.assists} A`)
    pick(
      'Best Defenseman',
      (t, p, id) => (p.position === 'D' && gpOf(id) >= 0.5 * maxSkaterGp ? pts(t) : -Infinity),
      (t) => `${pts(t)} PTS`
    )
    pick(
      'Rookie of the Year',
      (t, p, id) => (isRookieSeason(p) && gpOf(id) >= 0.3 * maxSkaterGp ? pts(t) : -Infinity),
      (t) => `${pts(t)} PTS`
    )
    pick(
      'Best Goaltender',
      (t, p, id) => (p.position === 'G' && gpOf(id) >= 0.6 * maxGoalieGp ? svPct(t) : -Infinity),
      (t) => `.${Math.round(svPct(t) * 1000)}`
    )
    return winners
  }

  private awardsForArchive(): Array<{
    award: string
    playerId: string
    name: string
    teamAbbr: string
    value: string
  }> {
    const abbrOf = (id: PlayerId): string => {
      const t = this.teamOf(id)
      return t ? this.data.teams.get(t)!.abbreviation : 'FA'
    }
    return this.seasonAwardWinners().map((w) => ({
      award: w.award,
      playerId: w.playerId as string,
      name: this.resolve(w.playerId).name,
      teamAbbr: abbrOf(w.playerId),
      value: w.value,
    }))
  }

  /**
   * Season-end payoff: announce each individual trophy winner by name so the
   * season-long award races (rookie/scoring/goalie …) actually RESOLVE in the
   * feed. Before this the winners existed only as a silent badge + the offseason
   * awards screen, so a race the feed hyped all year just stopped. Fired once, on
   * entering the offseason, while this.totals still holds the season's stats.
   */
  private announceSeasonAwards(): void {
    const winners = this.seasonAwardWinners()
    if (winners.length === 0) return
    const byAward = new Map(winners.map((w) => [w.award, w]))
    const line = (award: string): string => {
      const w = byAward.get(award)
      if (!w) return ''
      const tid = this.teamOf(w.playerId)
      const abbr = tid ? this.data.teams.get(tid)!.abbreviation : 'FA'
      return `${this.resolve(w.playerId).name} (${abbr}, ${w.value})`
    }
    const roundup: Array<[string, string]> = [
      ['Hart Trophy (MVP)', 'Most Valuable Player'],
      ['Art Ross (scoring)', 'Art Ross Trophy'],
      ['Rocket Richard (goals)', 'Top Goal Scorer'],
      ['Norris (top D)', 'Best Defenseman'],
      ['Calder (rookie)', 'Rookie of the Year'],
      ['Vezina (goalie)', 'Best Goaltender'],
    ]
    const bodyParts = roundup
      .map(([label, award]) => (line(award) ? `${label}: ${line(award)}` : ''))
      .filter(Boolean)
    const hart = byAward.get('Most Valuable Player')
    this.pushNews(
      'award',
      hart
        ? `${this.year} awards: ${this.resolve(hart.playerId).name} takes MVP honours`
        : `${this.year} league awards announced`,
      `The votes are in. ${bodyParts.join(' · ')}.`,
      hart ? { playerId: hart.playerId as string } : {}
    )
    // Dedicated items for the Calder and Norris — the two races that had no
    // announcement channel at all before, so those threads finally pay off.
    const spotlight: Array<[string, string, string]> = [
      ['Rookie of the Year', 'Calder Trophy (Rookie of the Year)', 'top rookie'],
      ['Best Defenseman', 'Norris Trophy (Best Defenceman)', 'top defenceman'],
    ]
    for (const [award, trophy, role] of spotlight) {
      const w = byAward.get(award)
      if (!w) continue
      const p = this.resolve(w.playerId)
      this.pushNews(
        'award',
        `${p.name} wins the ${trophy}`,
        `${p.name} is voted the league's ${role} for ${this.year} (${w.value}).`,
        { playerId: w.playerId as string }
      )
    }
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
    const out = onPlayerDeparted(lr, playerId as string, rng, this.data.players.get(playerId)?.name)
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
      if (a.kind === 'feud' || a.kind === 'mentorship') {
        // Relationship arcs dedupe on the player set: a recurring flare-up
        // intensifies the existing saga instead of spawning parallel copies.
        createOrEscalateRelationshipArc(
          this.arcsState,
          a.kind,
          a.playerIds,
          [teamId as string],
          a.summary,
          day,
          this.year
        )
      } else {
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
  }

  /* ────────────────────── player → GM interactions ────────────────────── */

  private static readonly INTERACTION_NS = 7110
  private static readonly CONSISTENCY_NS = 9311
  private static readonly LEDGER_NS = 7180

  /* ─────────────── Living Ledger: actions have witnesses ─────────────── */

  /** Record a GM action against a player and schedule the world's in-character
   *  response (leaks, confrontations, agent calls, room ripples) plus residue.
   *  Layer 0 of the Narrative Engine — see docs/NARRATIVE-ENGINE.md. */
  private recordWorldAction(kind: WorldActionKind, playerId: string, visibility: 'quiet' | 'open' = 'quiet'): void {
    const player = this.data.players.get(asPlayerId(playerId))
    if (!player) return
    const action: WorldAction = {
      id: `wa${this.ledgerCounter++}`,
      kind,
      year: this.year,
      day: this.currentDay,
      playerId,
      playerName: player.name,
      visibility,
    }
    this.worldActions.push(action)
    const openThreads = this.ledgerReactions.filter(
      (r) => r.kind === 'confrontation' || r.kind === 'agentNote'
    ).length
    const { reactions, residue } = scheduleReactions({
      action,
      player,
      rng: new Rng(deriveSeed(this.seed, Career.LEDGER_NS, this.year, this.currentDay, Career.pidNum(playerId))),
      priorResidue: this.residueFlags.filter((f) => f.playerId === playerId),
      openThreads,
      nextId: () => `lr${this.ledgerCounter++}`,
    })
    this.ledgerReactions.push(...reactions)
    this.residueFlags.push(...residue)
    // Bounded histories — the chronicle keeps the long past; the ledger only
    // needs enough to drive callbacks and compounding.
    if (this.worldActions.length > 200) this.worldActions = this.worldActions.slice(-150)
    if (this.residueFlags.length > 300) this.residueFlags = this.residueFlags.slice(-200)
  }

  /** How YOU came to own this player, as a citable phrase ("the man you
   *  traded for in 2024") — the chronicle-callback slot for ledger copy.
   *  Null when there's no history worth citing; the template block vanishes. */
  private provenancePhraseFor(playerId: string): string | null {
    const prov = chronicleProvenanceOf(this.chronicle, playerId)
    if (!prov) return null
    const mine = [...prov.acquisitions].reverse().find((a) => a.teamId === (this.userTeamId as string))
    if (mine) {
      if (mine.via === 'trade') return `the man you traded for in ${mine.year}`
      if (mine.via === 'signing') return `your ${mine.year} free-agent signing`
      if (mine.via === 'waiver') return `the waiver claim you fought for in ${mine.year}`
      if (mine.via === 'draft') return `a name this organisation called at the ${mine.year} draft`
    }
    if (prov.draftedBy === (this.userTeamId as string) && prov.draftYear !== undefined) {
      return `a name this organisation called at the ${prov.draftYear} draft`
    }
    return null
  }

  /** Fire the reactions that come due today. Each lands with explicit
   *  "because you…" attribution: a leak becomes a story HE also reads, a
   *  confrontation walks into your office as a real interaction, an agent
   *  note arrives as mail, a room ripple nicks his friends' morale. */
  private processLedgerReactions(day: number): void {
    if (this.ledgerReactions.length === 0) return
    const due = this.ledgerReactions.filter((r) => r.dueDay <= day)
    if (due.length === 0) return
    this.ledgerReactions = this.ledgerReactions.filter((r) => r.dueDay > day)
    for (const r of due) {
      const action = this.worldActions.find((a) => a.id === r.actionId)
      const player = this.data.players.get(asPlayerId(r.playerId))
      if (!action || !player) continue
      // Chronicle callback: how did YOU come to own this man? Citing it in the
      // leak ("the man you traded a rival for in 2024") is the signature move —
      // and it costs nothing when there's no history, the block just vanishes.
      const cb = this.provenancePhraseFor(r.playerId)
      const copy = reactionCopy({
        kind: r.kind, action, player, escalation: r.escalation,
        rng: new Rng(deriveSeed(this.seed, Career.LEDGER_NS, this.year, day, Career.pidNum(r.playerId) + 1)),
        ledger: this.contentLedger, year: this.year, day,
        ...(cb ? { callback: { phrase: cb } } : {}),
      })
      switch (r.kind) {
        case 'mediaLeak': {
          // The story breaks — and now HE knows. Mark residue as known.
          this.pushNews('trade', copy.headline, copy.body, { playerId: r.playerId, teamId: this.userTeamId as string })
          for (const f of this.residueFlags) if (f.actionId === action.id) f.known = true
          player.morale = Math.max(0, player.morale - 4)
          break
        }
        case 'confrontation': {
          // He's in your office. Delivered as a real interaction so the
          // existing response/promise machinery (and its costs) apply.
          // If he already has an open concern, don't stack scenes — the
          // grievance folds into residue instead (conservation of drama).
          if (this.interactions.some((i) => i.playerId === r.playerId && i.status === 'open')) break
          this.interactions.unshift({
            id: `i${this.interactionCounter++}`,
            playerId: r.playerId,
            teamId: this.userTeamId as string,
            year: this.year,
            day,
            kind: r.escalation > 0 ? 'tradeRequest' : 'unhappy',
            severity: 'serious',
            message: copy.message ?? copy.body,
            options: copy.options ?? [],
            status: 'open',
          })
          this.pushNews('contract', copy.headline, copy.body, { playerId: r.playerId, teamId: this.userTeamId as string })
          break
        }
        case 'agentNote': {
          this.pushNews('contract', copy.headline, copy.body, { playerId: r.playerId, teamId: this.userTeamId as string })
          player.morale = Math.max(0, player.morale - 2)
          break
        }
        case 'roomRipple': {
          // The departed man's peers notice how it was done: same-position
          // veterans and countrymen take the small hit — the room's memory.
          this.pushNews('contract', copy.headline, copy.body, { playerId: r.playerId, teamId: this.userTeamId as string })
          for (const id of this.userTeam.roster) {
            const mate = this.data.players.get(id)
            if (!mate) continue
            if ((player.nationality !== undefined && mate.nationality === player.nationality) || (mate.age >= 28 && mate.position === player.position)) {
              mate.morale = Math.max(0, mate.morale - 2)
            }
          }
          break
        }
      }
    }
  }

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
    const m = streakMilestone(team.name, next, {
      rng: new Rng(deriveSeed(this.seed, 9285, this.year, this.currentDay, Math.abs(next))),
      ledger: this.contentLedger, year: this.year, day: this.currentDay,
    })
    if (m) this.pushNews('league', m.headline, m.body, { teamId })
  }

  /* ──────────────── decision events (Narrative Engine layer 2) ──────────────── */

  private static readonly DECISION_NS = 7190
  /** Quiet days between dilemmas — a crossroads should feel like an occasion. */
  private static readonly DECISION_COOLDOWN_DAYS = 21
  private lastDecisionDay = -999

  /**
   * Scan for an authored dilemma worth raising today and deliver it through the
   * interaction machinery (docs/NARRATIVE-ENGINE.md). Rate-limited hard: one
   * per three weeks, never stacked on an open concern, and silent when nothing
   * genuinely applies — a crossroads that fires on a quiet Tuesday is noise.
   */
  private maybeRaiseDecisionEvent(day: number): void {
    if (this.phase !== 'regularSeason') return
    if (day - this.lastDecisionDay < Career.DECISION_COOLDOWN_DAYS) return
    if (this.interactions.some((i) => i.status === 'open')) return

    // Scan the NHL club AND the farm: a prospect's call-up dilemma only exists
    // for a man who is currently in the minors.
    const nhlIds = this.userTeam.roster
    const ahlId = this.userTeam.affiliateId
    const ahlIds = ahlId ? (this.data.teams.get(ahlId)?.roster ?? []) : []
    const roster: Array<{ p: Player; inMinors: boolean }> = [
      ...nhlIds.map((id) => ({ p: this.data.players.get(id), inMinors: false })),
      ...ahlIds.map((id) => ({ p: this.data.players.get(id), inMinors: true })),
    ].filter((r): r is { p: Player; inMinors: boolean } => !!r.p)
    if (roster.length === 0) return

    const lr = this.lockerRooms.get(this.userTeamId)
    const roomTension = lr ? 100 - lr.roomMorale : 40
    const losingStreak = Math.abs(Math.min(0, this.teamStreaks.get(this.userTeamId as string) ?? 0))
    const captainId = this.userTeam.captainId as string | undefined
    const rng = new Rng(deriveSeed(this.seed, Career.DECISION_NS, this.year, day))

    // Evaluate candidates subject-first: the event library's conditions read a
    // per-PLAYER context, so each roster man is a possible protagonist. Stable
    // order (roster order) keeps this deterministic.
    const deadlineWeek = this.deadlineDay > 0 && day >= this.deadlineDay - 7 && day <= this.deadlineDay
    for (const { p, inMinors } of roster) {
      const careerGp = p.stats.reduce((n, s) => n + s.gamesPlayed, 0)
      const gt = this.totals.get(p.id)
      const ctx: ContentCtx = {
        age: p.age,
        gamesPlayed: careerGp,
        scratched: this.isScratchedFor(p.id as string),
        isLeader: (p.id as string) === captainId,
        roomTension,
        losingStreak,
        mediaHeat: Math.min(100, losingStreak * 14),
        nursingInjury: p.injuryStatus !== null,
        importance: ratedOverall(p),
        contractYearsRemaining: p.contract.yearsRemaining,
        position: p.position,
        potential: ratedPotential(p),
        inMinors,
        // "He knows he was shopped" — the Living Ledger's memory is a trigger.
        formerlyShopped: this.residueFlags.some(
          (f) => f.playerId === (p.id as string) && f.kind === 'wasShopped' && f.known
        ),
        // A leader you waved off once will approach differently the next time.
        formerlyDismissed: this.residueFlags.some(
          (f) => f.playerId === (p.id as string) && f.kind === 'wasDismissed' && f.known
        ),
        deadlineWeek,
        // Season save % as a whole number; non-goalies sit at 100 so the
        // crease dilemma can never latch onto a skater.
        savePct: gt && gt.shotsAgainst > 0 ? Math.round((gt.saves / gt.shotsAgainst) * 100) : 100,
      }
      const ev = pickDecisionEvent({
        ctx, rng,
        used: this.contentLedger.map((u) => ({ variantId: u.variantId, year: u.year })),
        year: this.year,
      })
      if (!ev) continue

      const slots = decisionSlots(p, careerGp, this.userTeam.name)
      this.interactions.unshift({
        id: `i${this.interactionCounter++}`,
        playerId: p.id as string,
        teamId: this.userTeamId as string,
        year: this.year,
        day,
        kind: 'unhappy',
        severity: 'serious',
        message: renderTemplate(ev.scene, slots),
        options: ev.options.map((o) => ({ id: o.id, label: o.label, tone: 'firm' as const })),
        status: 'open',
      })
      this.decisionEventFor.set(`i${this.interactionCounter - 1}`, ev.id)
      markUsed(this.contentLedger, ev.id, this.year, day)
      this.lastDecisionDay = day
      this.pushNews('contract', `${p.name} is waiting in your office`,
        renderTemplate(ev.scene, slots), { playerId: p.id as string, teamId: this.userTeamId as string })
      return // one dilemma at a time
    }
  }

  /** interactionId → decision-event id, so the response applies authored effects. */
  private decisionEventFor = new Map<string, string>()
  /** Playtest #14: prospects the GM has told the AGM to leave in the minors, keyed
   *  to the season he said it. A "no, leave him down" holds for the rest of that
   *  season instead of the staff re-pitching the same kid every fortnight. Next
   *  season it's fair game again — the case may genuinely have changed. */
  private declinedCallups = new Map<string, number>()

  /** Apply an authored option's effects: morale, the room, promises, residue,
   *  and the leak roll. Every one is a lever the sim already honours. */
  private applyDecisionEffects(
    interaction: PlayerInteraction,
    player: Player,
    chosen: { id: string; outcome: string; effects: DecisionEffects }
  ): void {
    const e = chosen.effects
    const day = this.currentDay
    if (e.morale) player.morale = Math.max(0, Math.min(100, player.morale + e.morale))
    const lr = this.lockerRooms.get(this.userTeamId)
    if (lr && (e.roomMorale || e.roomRespect)) {
      lr.roomMorale = Math.max(0, Math.min(100, lr.roomMorale + (e.roomMorale ?? 0) + (e.roomRespect ?? 0) * 0.5))
    }
    if (e.promise) {
      const cur = player.stats.find((s) => s.season === this.year)
      this.playerPromises.push({
        id: `pp${this.interactionCounter++}`,
        playerId: player.id as string,
        kind: e.promise,
        text: chosen.outcome,
        year: this.year,
        day,
        ...(cur ? { baselineGp: cur.gamesPlayed } : {}),
        baselineYears: player.contract.yearsRemaining,
        status: 'open',
      })
    }
    if (e.residue) {
      this.residueFlags.push({
        playerId: player.id as string, kind: e.residue,
        year: this.year, day, actionId: `dec:${chosen.id}`, known: true,
      })
    }
    if (e.leakChance && new Rng(deriveSeed(this.seed, Career.DECISION_NS, this.year, day, 7)).chance(e.leakChance)) {
      this.pushNews('contract', `Word gets out about ${player.name}'s meeting`,
        `What was said behind your office door did not stay there. ${chosen.outcome}`,
        { playerId: player.id as string, teamId: this.userTeamId as string })
    }
    interaction.status = 'resolved'
    interaction.chosenOptionId = chosen.id
    interaction.outcome = chosen.outcome
    interaction.resolvedDay = day
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
  /** Master switch for the player→GM concern system (LW5: back on, with hard
   *  rate limits so it reads as a living room, never a chore). */
  private static readonly INTERACTIONS_ENABLED: boolean = true
  /** Keep at most this many open concerns at once, and this many total stored. */
  private static readonly MAX_OPEN_INTERACTIONS = 2
  private static readonly INTERACTION_HISTORY_LIMIT = 40
  /** A player speaks up at most this many times per season. */
  private static readonly MAX_INTERACTIONS_PER_PLAYER_SEASON = 2
  /** Minimum quiet days between ANY two concerns being raised. */
  private static readonly INTERACTION_GLOBAL_SPACING_DAYS = 14

  /** Scan the user roster after a match day and maybe raise new concerns.
   *  LW5 game-theory rules: at most one new concern per day, none within 6
   *  days of the last one, at most 2 open at once, and a player gets at most
   *  2 conversations a season — a request should feel like an event. */
  private maybeRaiseInteractions(day: number): void {
    if (Career.INTERACTIONS_ENABLED === false) return
    const open = this.interactions.filter((i) => i.status === 'open')
    if (open.length >= Career.MAX_OPEN_INTERACTIONS) return

    // Global pacing + per-player season quota, derived from history (no new state).
    const seasonCount = new Map<string, number>()
    let lastRaisedDay = -99
    for (const i of this.interactions) {
      if (i.year !== this.year) continue
      seasonCount.set(i.playerId, (seasonCount.get(i.playerId) ?? 0) + 1)
      if (i.day > lastRaisedDay) lastRaisedDay = i.day
    }
    if (day - lastRaisedDay < Career.INTERACTION_GLOBAL_SPACING_DAYS) return

    const team = this.data.teams.get(this.userTeamId)
    if (!team) return
    const lr = this.lockerRooms.get(this.userTeamId) ?? null

    // Players who already have an open concern or a recent one stay quiet.
    const busy = new Set<string>()
    for (const i of this.interactions) {
      if (i.status === 'open') busy.add(i.playerId)
      // Cooldown runs from the CONVERSATION (resolvedDay), not from when the player
      // raised it — so answering a concern actually buys you quiet, and a player you
      // just talked to won't be back the same week (#9).
      else if (day - (i.resolvedDay ?? i.day) < INTERACTION_COOLDOWN_DAYS) busy.add(i.playerId)
    }

    for (const pid of team.roster) {
      const pidStr = pid as unknown as string
      if (busy.has(pidStr)) continue
      if ((seasonCount.get(pidStr) ?? 0) >= Career.MAX_INTERACTIONS_PER_PLAYER_SEASON) continue
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
      // One per day, max — the interaction surfaces as a card at the top of
      // the inbox (see getInbox); no separate news item crowds the feed.
      break
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
  respondToInteraction(
    interactionId: string,
    optionId: string
  ): { ok: boolean; message?: string; reaction?: ReactionSpec } {
    const interaction = this.interactions.find((i) => i.id === interactionId)
    if (!interaction) return { ok: false, message: 'That conversation is no longer available.' }
    if (interaction.status !== 'open') return { ok: false, message: 'You have already responded.' }
    const option = interaction.options.find((o) => o.id === optionId)
    if (!option) return { ok: false, message: 'Unknown response.' }

    const player = this.data.players.get(asPlayerId(interaction.playerId))
    if (!player) return { ok: false, message: 'Player not found.' }

    // Authored dilemma? Its options carry hand-written effects and a receipt,
    // so they bypass the generic tone model entirely (Narrative Engine L2).
    const decisionId = this.decisionEventFor.get(interactionId)
    if (decisionId) {
      const ev = DECISION_EVENTS.find((e) => e.id === decisionId)
      const chosen = ev?.options.find((o) => o.id === optionId)
      if (ev && chosen) {
        this.applyDecisionEffects(interaction, player, chosen)
        this.decisionEventFor.delete(interactionId)
        return { ok: true, message: chosen.outcome }
      }
    }

    const result = applyInteractionResponse({ interaction, option, player })
    // A JSON-safe descriptor of the resolution so the renderer can voice the
    // player's spoken reply (the model never alters the delta below).
    const reaction = reactionSpec({ interaction, option, player, result })

    // Apply morale to the player.
    player.morale = Math.max(0, Math.min(100, player.morale + result.moraleDelta))

    // Ripple to the room mood.
    const lr = this.lockerRooms.get(asTeamId(interaction.teamId))
    if (lr) lr.roomMorale = Math.max(0, Math.min(100, lr.roomMorale + result.roomMoraleDelta))

    interaction.status = 'resolved'
    interaction.chosenOptionId = optionId
    interaction.outcome = result.outcome
    interaction.resolvedDay = this.currentDay

    // LW5: a promise-tone answer is written into the ledger — measurable
    // keep-condition, due date, and your exact words for later quoting.
    if (option.tone === 'promise') {
      const cur = player.stats.find((s) => s.season === this.year)
      const promise = promiseFromResponse({
        interaction,
        player,
        nextId: `pp${this.interactionCounter++}`,
        deadlineDay: this.deadlineDay,
        seasonGp: cur?.gamesPlayed ?? 0,
        seasonToi: cur ? cur.ev.timeOnIce + cur.pp.timeOnIce + cur.pk.timeOnIce : 0,
      })
      if (promise) {
        this.playerPromises.push(promise)
        interaction.outcome = `${result.outcome} Your words — “${promise.text}” — went in the book.`
      }
    }

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

    return { ok: true, message: interaction.outcome ?? 'Message delivered.', reaction }
  }

  /* ────────────────────── the salience engine (THE-FEED.md) ────────────────────── */

  /** Capture the priors ledger for this season if missing (new season, new
   *  save, or legacy save loading in mid-year — the one-time mid-season
   *  capture is slightly stale but honest thereafter). Novelty memory
   *  carries across seasons: surprise is save-wide, not season-wide. */
  private ensureStoryPriors(): StoryPriors {
    if (this.storyPriors && this.storyPriors.year === this.year) return this.storyPriors
    const carried = this.storyPriors?.noveltyCounts ?? []
    this.storyPriors = {
      year: this.year,
      preseasonRanks: [...this.strengthRanks().entries()],
      noveltyCounts: carried,
    }
    return this.storyPriors
  }

  /** Run the detector library over today's league state, apply novelty
   *  dampening + the daily budget, and publish the survivors as feed posts. */
  private runSalience(day: number): void {
    const priors = this.ensureStoryPriors()
    const standings = sortStandings([...this.standings.values()])
    const currentRanks = new Map<string, number>()
    standings.forEach((s, i) => currentRanks.set(s.teamId as string, i + 1))
    const teams = new Map<string, { name: string; abbreviation: string }>()
    for (const t of this.data.teams.values()) {
      teams.set(t.id as string, { name: t.name, abbreviation: t.abbreviation })
    }
    // Team-level facts for the playoff-race detector (cheap — one per club).
    const teamPoints = new Map<string, number>()
    const teamConference = new Map<string, string>()
    const teamGamesLeft = new Map<string, number>()
    const totalGames = this.matchDays.length
    for (const s of standings) {
      teamPoints.set(s.teamId as string, s.points)
      teamGamesLeft.set(s.teamId as string, Math.max(0, totalGames - s.gamesPlayed))
      const team = this.data.teams.get(s.teamId)
      if (team) teamConference.set(s.teamId as string, team.conferenceId)
    }
    const ctx: SalienceCtx = {
      day,
      year: this.year,
      currentRanks,
      preseasonRanks: new Map(priors.preseasonRanks),
      streaks: this.teamStreaks,
      teams,
      userTeamId: this.userTeamId as string,
      teamsInLeague: this.data.league.teams.length,
      teamPoints,
      teamConference,
      teamGamesLeft,
    }
    // Player-level readings only on checkpoint days. Read the LIVE accumulators
    // (this.totals / this.gp) — the per-season p.stats line isn't written until
    // the season-rollover archive, so mid-season it's empty. (Before this the
    // skater/goalie detectors never fired at all — they read the empty archive.)
    if (PLAYER_CHECKPOINT_DAYS.includes(day)) {
      const skaters: NonNullable<SalienceCtx['skaters']> = []
      const goalies: NonNullable<SalienceCtx['goalies']> = []
      for (const [pid, t] of this.totals) {
        const games = this.gp.get(pid) ?? 0
        if (games <= 0) continue
        const p = this.data.players.get(pid)
        if (!p) continue
        const teamId = this.teamOf(pid)
        if (!teamId) continue
        if (p.position === 'G') {
          goalies.push({
            playerId: pid as string,
            name: p.name,
            teamId: teamId as string,
            saves: t.saves,
            shotsAgainst: t.shotsAgainst,
            ratedOverall: ratedOverall(p),
          })
        } else {
          skaters.push({
            playerId: pid as string,
            name: p.name,
            teamId: teamId as string,
            gp: games,
            points: t.goals + t.assists,
            goals: t.goals,
            ratedOverall: ratedOverall(p),
            age: p.age,
          })
        }
      }
      ctx.skaters = skaters
      ctx.goalies = goalies
    }
    const candidates = DETECTORS.flatMap((d) => d(ctx))
    if (candidates.length === 0) return
    const counts = new Map(priors.noveltyCounts)
    const rng = this.rngFor(9800, day)
    const selected = selectPosts(candidates, counts, rng)
    for (const post of selected) {
      counts.set(post.key, (counts.get(post.key) ?? 0) + 1)
      const cls = noveltyClassOf(post.key)
      counts.set(cls, (counts.get(cls) ?? 0) + 1)
      const author = FEED_AUTHORS[post.authorId]
      this.feedPosts.unshift({
        id: `fp${this.feedCounter++}`,
        day,
        year: this.year,
        category: 'league',
        headline: `@${author?.handle ?? post.authorId}`,
        body: post.text,
        read: true, // the feed has no unread obligation — it's a browse surface
        ...(post.teamId !== undefined ? { teamId: post.teamId } : {}),
        ...(post.playerId !== undefined ? { playerId: post.playerId } : {}),
        channel: post.channel,
        authorId: post.authorId,
        salience: Math.round(post.score),
        engagement: engagementFor(post.score, rng),
      })
    }
    if (this.feedPosts.length > 400) this.feedPosts.length = 400
    // Phase B curation: followed authors and floor-clearing stories ALSO
    // reach the inbox — the feed is browseable, the inbox is guaranteed.
    for (const post of selected) {
      if (!shouldReachInbox(post, this.followedFeedAuthors)) continue
      const author = FEED_AUTHORS[post.authorId]
      this.pushNews('league', `@${author?.handle ?? post.authorId}`, post.text, {
        ...(post.teamId !== undefined ? { teamId: post.teamId } : {}),
        ...(post.playerId !== undefined ? { playerId: post.playerId } : {}),
        channel: post.channel,
        authorId: post.authorId,
        salience: Math.round(post.score),
      })
    }
    priors.noveltyCounts = [...counts.entries()]
  }

  /** Follow/unfollow a feed account. Followed posts land in the inbox. */
  toggleFollowAuthor(authorId: string): { following: boolean } {
    if (!FEED_AUTHORS[authorId]) return { following: false }
    const i = this.followedFeedAuthors.indexOf(authorId)
    if (i >= 0) {
      this.followedFeedAuthors.splice(i, 1)
      return { following: false }
    }
    this.followedFeedAuthors.push(authorId)
    return { following: true }
  }

  /** The social feed, newest first, plus the author directory. */
  getFeed(): FeedView {
    return {
      posts: this.feedPosts.map((p) => ({ ...p })),
      authors: FEED_AUTHORS,
      following: [...this.followedFeedAuthors],
    }
  }

  /** LW5: settle promise debts that have come due. In-season kinds (ice time,
   *  explore-trade) are checked daily; newDeal promises settle at rollover.
   *  Kept word buys a little trust; a broken one costs double and can turn a
   *  simmering player into a formal trade request. */
  private evaluatePlayerPromises(day: number): void {
    const team = this.data.teams.get(this.userTeamId)
    for (const pr of this.playerPromises) {
      if (pr.status !== 'open' || pr.year !== this.year) continue
      if (pr.dueDay === undefined || day < pr.dueDay) continue
      const p = this.data.players.get(asPlayerId(pr.playerId))
      const onRoster = !!team && team.roster.some((id) => (id as string) === pr.playerId)

      if (pr.kind === 'exploreTrade') {
        if (!onRoster) {
          // He got his move — word kept, and the room noticed.
          pr.status = 'kept'
          if (p) {
            this.pushNews('trade', `A promise kept`, `You told ${p.name} “${pr.text}” — and you delivered. The room takes note of a GM whose word holds.`, { playerId: pr.playerId })
          }
        } else {
          pr.status = 'broken'
          if (p) {
            p.morale = Math.max(0, p.morale - 16)
            this.pushNews('trade', `${p.name}'s camp goes public`, `On ${dayToDateISO(pr.year, pr.day)} you told ${p.name} “${pr.text}”. The deadline has passed and he is still here. His agent has let the press know exactly what was said.`, { playerId: pr.playerId })
            createArc(this.arcsState, 'tradeRumor', { playerIds: [pr.playerId], teamIds: [this.userTeamId as string] }, `${p.name}'s trade request went unanswered`, day, this.year)
          }
        }
        this.chroniclePromise(pr, day)
        continue
      }

      if (pr.kind === 'iceTime') {
        if (!p || !onRoster) { pr.status = 'broken'; continue } // moved on — the trade story covers it
        const cur = p.stats.find((s) => s.season === this.year)
        const gpNow = cur?.gamesPlayed ?? 0
        const toiNow = cur ? cur.ev.timeOnIce + cur.pp.timeOnIce + cur.pk.timeOnIce : 0
        const dGp = gpNow - (pr.baselineGp ?? 0)
        // Short sample (injury, scratch run)? One grace extension.
        if (dGp < 5 && !pr.extended) { pr.extended = true; pr.dueDay = day + 20; continue }
        const perBefore = (pr.baselineGp ?? 0) > 0 ? (pr.baselineToi ?? 0) / (pr.baselineGp ?? 1) : 0
        const perAfter = dGp > 0 ? (toiNow - (pr.baselineToi ?? 0)) / dGp : 0
        const kept = perBefore <= 0 ? perAfter > 0 : perAfter >= perBefore * 1.05
        if (kept) {
          pr.status = 'kept'
          p.morale = Math.min(100, p.morale + 8)
          this.pushNews('league', `${p.name} responding to a bigger role`, `You promised him “${pr.text}” — his minutes are up since that conversation, and he knows you made it happen.`, { playerId: pr.playerId })
        } else {
          pr.status = 'broken'
          p.morale = Math.max(0, p.morale - 14)
          this.pushNews('league', `${p.name} feels misled`, `On ${dayToDateISO(pr.year, pr.day)} you promised him “${pr.text}”. His ice time hasn't moved. Players talk — and so do agents.`, { playerId: pr.playerId })
          if (p.personality.ambition >= 14 && p.morale < 40) {
            // The broken promise hardens into a formal request, on the spot.
            this.interactionCounter++
            this.interactions.unshift({
              id: `pi${this.interactionCounter}`,
              playerId: pr.playerId,
              teamId: this.userTeamId as string,
              year: this.year,
              day,
              kind: 'tradeRequest',
              severity: 'serious',
              message: `${p.name} hasn't forgotten what you promised him. The role never came — and now he wants out.`,
              options: [
                { id: 'promise', label: 'Promise to explore his options', tone: 'promise' },
                { id: 'supportive', label: 'Ask for one more chance to fix it', tone: 'supportive' },
                { id: 'firm', label: 'Make clear he’s going nowhere', tone: 'firm' },
              ],
              status: 'open',
            })
          }
        }
        this.chroniclePromise(pr, day)
      }
    }
  }

  /** Write a settled promise into the permanent chronicle. */
  private chroniclePromise(pr: PlayerPromise, day: number): void {
    const p = this.data.players.get(asPlayerId(pr.playerId))
    chronicleEvent(this.chronicle, {
      year: this.year,
      day,
      kind: 'promise',
      teamIds: [this.userTeamId as string],
      playerIds: [pr.playerId],
      headline: `${pr.status === 'kept' ? 'Kept' : 'Broken'}: you promised ${p?.name ?? 'a player'} ${pr.text}`,
      details: { resolved: pr.status === 'kept' ? 1 : 0 },
      userInvolved: true,
    })
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
      nhlTeamIds: new Set(this.data.league.teams.map((id) => id as string)),
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
          // Rookie definition matches the Calder pick in seasonAwardWinners
          // (first-year pro, age ≤ 24) so the race the feed hypes and the trophy
          // it eventually hands out agree on who's eligible.
          isRookie: p.age <= 24 && p.stats.length === 0,
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
    this.maybeRaiseDecisionEvent(day)
    this.evaluatePlayerPromises(day)
    // Living Ledger: leaks break, confrontations walk in, agents call — the
    // world responding to what the GM did (docs/NARRATIVE-ENGINE.md layer 0).
    this.processLedgerReactions(day)

    /* ── the salience engine: publish today's genuinely interesting stories ── */
    this.runSalience(day)

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
      this.pushCoachQuote('winStreak', { streakCount: this.userWinStreak }, quoteSeed)
    }

    /* ── Coach quote: losing streak milestones (3, 5, 7) ── */
    const LOSING_STREAK_THRESHOLDS = [3, 5, 7]
    const userLoss = this.losingStreaks.get(this.userTeamId as string) ?? 0
    if (LOSING_STREAK_THRESHOLDS.includes(userLoss)) {
      const quoteSeed = this.seed ^ (day * 113)
      this.pushCoachQuote('losingStreak', { streakCount: userLoss }, quoteSeed)
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
      this.pushCoachQuote('slumpingStar', { playerName: p.name, streakCount: line.scorelessStreak }, quoteSeed)
    }

    // Career counting milestones (500 goals, 1000 points, 1000 games …).
    this.emitCareerMilestones(outcomes)
    // In-season chase/break of the all-time single-season record.
    this.emitRecordWatch(day, outcomes)
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
  private scheduledReportArgs(_kind: PressSheetKind): ScheduledReportArgs {
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
      awardName: l.stat === 'points' ? 'Art Ross' : l.stat === 'goals' ? 'Rocket Richard' : l.stat === 'assists' ? 'Assists leader' : 'Leading scorer',
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

    // Month label from the REAL calendar date of the current match day — the
    // same source as the header ("23 Dec 2026"). The old `currentDay / 14`
    // heuristic counted match days, not calendar months, so a December game
    // could be labelled "April".
    const MONTH_FULL = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ]
    const monthNum = parseInt(dayToDateISO(this.year, this.currentDay).split('-')[1] ?? '1', 10)
    const monthLabel = MONTH_FULL[monthNum - 1] ?? ''

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
    // Attribute the question to a specific pundit — the answer builds or sours a
    // lasting relationship with THAT person (see answerPressConference / #90).
    const personaId =
      Career.PRESS_PERSONA_ROTATION[this.pressCounter % Career.PRESS_PERSONA_ROTATION.length]!
    this.pressConference = {
      id: `pc${this.pressCounter++}`,
      question,
      context,
      day: this.currentDay,
      year: this.year,
      personaId,
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
          createOrEscalateRelationshipArc(
            this.arcsState,
            'feud',
            [a.id as string, b.id as string],
            [this.userTeamId as string],
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

    // #90: the exchange lands with the specific pundit who asked, shifting a
    // lasting relationship. Older pending pressers with no persona default to the
    // beat reporter.
    const personaId = pc.personaId ?? 'beat'
    const persona = PRESS_PERSONA_NAMES[personaId]
    const shift = applyPunditAnswer(this.punditState, personaId, tone, this.currentDay)

    this.pushNews(
      'league',
      `GM faces the press`,
      `Asked by ${persona.name} (${persona.outlet}): "${pc.question}"\n\n` +
        `In ${toneLabel[tone]} exchange, the ${this.userTeam.name} GM said: "${quote}"`,
      {
        teamId: this.userTeamId as string,
        press: { byline: `${persona.name} — ${persona.outlet}`, kind: 'presser' },
      }
    )

    // When the answer tips the relationship across a standing boundary, surface a
    // short beat so the player feels the consequence. Only for the meaningful
    // moves (into an alliance or into open hostility).
    if (shift.crossedBoundary) {
      if (shift.standingAfter === 'Ally' || shift.standingAfter === 'Feud') {
        const warming = shift.standingAfter === 'Ally'
        this.pushNews(
          'league',
          warming ? `${persona.name} is now an ally` : `${persona.name} turns on the GM`,
          warming
            ? `${persona.name} of ${persona.outlet} has become a reliable friend of the ${this.userTeam.name} front office — ` +
                `his columns will now give the GM the benefit of the doubt.`
            : `${persona.name} of ${persona.outlet} has soured completely on the ${this.userTeam.name} GM — ` +
                `expect every misstep to become a headline.`,
          { teamId: this.userTeamId as string }
        )
        // The homer is the fanbase's voice on the radio: a full break with him
        // nudges fan engagement, an alliance lifts it. Small and clamped.
        if (personaId === 'homer') {
          const before = this.fanInterest
          this.fanInterest = Math.max(0, Math.min(100, this.fanInterest + (warming ? 3 : -3)))
          void before
        }
      }
    }

    this.appendSaga(
      `Y${this.year} D${this.currentDay}: GM presser (${tone}) with ${persona.name} — ` +
        `now ${punditStanding(shift.rapportAfter).toLowerCase()}.`
    )
  }

  /**
   * #90: the Media Circuit — the GM's standing with each named pundit, plus the
   * strongest ally / chief critic. Read-only; drives the Media Circuit screen.
   */
  getMediaCircuit(): MediaCircuitView {
    const summary = mediaStandingSummary(this.punditState)
    const rows: MediaCircuitRowView[] = this.punditState.pundits.map((rel) => {
      const meta = PRESS_PERSONA_NAMES[rel.personaId]
      return {
        personaId: rel.personaId,
        name: meta.name,
        outlet: meta.outlet,
        rapport: rel.rapport,
        standing: punditStanding(rel.rapport),
        read: punditRead(rel),
        interactions: rel.interactions,
        lastExchange: rel.lastTone ? toneVerb(rel.lastTone) : undefined,
      }
    })
    return {
      teamName: this.userTeam.name,
      rows,
      allyName: summary.ally ? PRESS_PERSONA_NAMES[summary.ally].name : undefined,
      criticName: summary.critic ? PRESS_PERSONA_NAMES[summary.critic].name : undefined,
    }
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
      } else if (ev.strength === 'sh') {
        this.shGoals.set(ev.scorer, (this.shGoals.get(ev.scorer) ?? 0) + 1)
        for (const a of ev.assists) this.shAssists.set(a, (this.shAssists.get(a) ?? 0) + 1)
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
      // Shutout: the winning goalie allowed no goals (NHL convention — one per
      // game, credited to the winner). Empty-net goals go for his team, not
      // against him, so a clean-sheet win is a genuine shutout.
      if (won) {
        const bs = res.playerStats.get(best.id)
        if (bs && bs.goalsAgainst === 0) {
          this.shutouts.set(best.id, (this.shutouts.get(best.id) ?? 0) + 1)
        }
      }
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
      nameA: this.data.teams.get(res.homeTeamId)?.abbreviation,
      nameB: this.data.teams.get(res.awayTeamId)?.abbreviation,
      goalsA: res.homeGoals,
      goalsB: res.awayGoals,
      penaltyMinutesA: homePim,
      penaltyMinutesB: awayPim,
      wasPlayoff: false,
      year: this.year,
      rng: this.rngFor(7200, game.day, game.id.length),
    })
    if (rivalResult.newsSeeds.length > 0) {
      // LW6 (#140): ground the rivalry beat in the persistent all-time series so
      // the story cites a specific fact, not just "they don't like each other".
      this.pushSeeds(this.groundRivalryNews(rivalResult.newsSeeds, res.homeTeamId as string, res.awayTeamId as string))
    }

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
      const player = this.resolve(pid)
      participants.push({ player, toi: s.toi })
      // Earned form: tonight's box score heats up hot hands and cools quiet
      // stars. Deterministic (no Rng), so it doesn't perturb the injury roll.
      player.form = Math.max(-5, Math.min(5, player.form + formDeltaFromGame(player, s)))
      // In-game departure: the sim saw him go down — the injury is guaranteed
      // (rollInjuries then skips him, so aggregate volume barely moves).
      if (s.leftGame && player.injuryStatus === null) {
        const injury = injureNow(player, dayRng)
        const teamId = this.teamOf(pid)
        if (teamId === this.userTeamId) {
          const games = `${injury.gamesRemaining} game${injury.gamesRemaining === 1 ? '' : 's'}`
          this.pushNews(
            'injury',
            `${player.name} leaves the game — out ${games}`,
            `${player.name} went down during the game and didn't return: a ${injury.description}. He's expected to miss ${games}.`,
            { playerId: pid as string, teamId: teamId as string }
          )
        }
      }
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
    // Role vs. talent: a star buried down the lineup (or healthy-scratched)
    // sours; a depth player handed a big role gets a lift. Deterministic.
    for (const t of [home, away]) {
      applyDeploymentMorale({ team: t, resolve: (id) => this.resolve(id), played: (id) => played.has(id) })
    }
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

    /* ── Story beat: surface how the game actually went (comeback, blown lead,
     *    a goalie robbery or shelling) — the drama behind the final score. ── */
    const userRoster = new Set(this.userTeam.roster.map((id) => id as unknown as string))
    const goalByUser: boolean[] = []
    let userShots = 0
    let oppShots = 0
    let goalie: { name: string; saves: number; shotsAgainst: number; goalsAgainst: number } | undefined
    for (const ev of res.stream) {
      if (ev.type === 'goal') goalByUser.push(userRoster.has(ev.scorer as unknown as string))
    }
    for (const [pid, s] of res.playerStats) {
      const mine = userRoster.has(pid as unknown as string)
      if (mine) userShots += s.shots
      else oppShots += s.shots
      if (mine && s.shotsAgainst > 0 && this.resolve(pid).position === 'G' && (!goalie || s.shotsAgainst > goalie.shotsAgainst)) {
        goalie = { name: this.resolve(pid).name, saves: s.saves, shotsAgainst: s.shotsAgainst, goalsAgainst: s.goalsAgainst }
      }
    }
    const beat = detectGameStory({ goalByUser, won: us > them, goalie, userShots, oppShots })
    if (beat) this.pushNews('result', beat.headline, beat.body, { teamId: opp.id as string })

    /* ── Individual heroics: a hat trick, a big multi-point night, a shutout. ── */
    const userLines: PlayerGameLine[] = []
    for (const [pid, s] of res.playerStats) {
      if (!userRoster.has(pid as unknown as string) || s.toi <= 0) continue
      const p = this.resolve(pid)
      userLines.push({
        playerId: pid as unknown as string,
        name: p.name,
        isGoalie: p.position === 'G',
        goals: s.goals,
        assists: s.assists,
        saves: s.saves,
        shotsAgainst: s.shotsAgainst,
        goalsAgainst: s.goalsAgainst,
      })
    }
    const solo = detectPlayerStory(userLines)
    if (solo) this.pushNews('result', solo.headline, solo.body, { playerId: solo.playerId, teamId: this.userTeamId as string })

    /* ── Gloves off: a fight in your game makes the recap. ── */
    // The `&&` collapses isEvent's type predicate back to boolean, so annotate
    // the callback to keep the narrowing — otherwise `.player` below is untyped.
    const combatants = res.stream.filter(
      (e): e is Extract<GameEvent, { type: 'penalty' }> =>
        isEvent(e, 'penalty') && e.infraction === 'fighting'
    )
    if (combatants.length >= 2) {
      const first = this.resolve(combatants[0].player)
      const second = this.resolve(combatants[1].player)
      const ours = userRoster.has(combatants[0].player as unknown as string) ? first : second
      const theirs = ours === first ? second : first
      this.pushNews(
        'result',
        `Gloves off: ${ours.name} answers the bell`,
        `Tempers boiled over against ${opp.name} — ${ours.name} and ${theirs.name} dropped the gloves and took fighting majors.`,
        { playerId: ours.id as string, teamId: opp.id as string }
      )
    }

    /* ── Coach quote: big win (≥3 goal margin, regulation) or bad loss (≥3 goal margin) ── */
    const diff = us - them
    const quoteSeed = this.seed ^ (day * 31)
    if (diff >= 3 && res.decidedBy === 'regulation') {
      // Big win — coach speaks
      this.userWinStreak++
      this.pushCoachQuote('postBigWin', { opponentAbbr: opp.abbreviation, score: `${us}-${them}`, goalDiff: diff }, quoteSeed)
    } else if (diff <= -3 && res.decidedBy === 'regulation') {
      // Bad loss — coach speaks
      this.userWinStreak = 0
      this.pushCoachQuote('postBadLoss', { opponentAbbr: opp.abbreviation, score: `${them}-${us}`, goalDiff: Math.abs(diff) }, quoteSeed)
    } else if (diff > 0) {
      this.userWinStreak++
    } else {
      this.userWinStreak = 0
    }
  }

  /* ────────────────────────── regular-season day loop ────────────────────────── */

  private gameSeedFor(game: ScheduledGame): number {
    return gameSeed(this.seed, this.year, game.id)
  }

  private prepareTeamsForDay(): void {
    this.emergencyRecalls()
    // Keep every club's cap hit in sync with its actual roster. The stored field
    // otherwise drifts across the offseason (retirements, departures, ELCs,
    // graduations) and a stale value corrupts cap checks and the finances screen.
    for (const team of this.data.teams.values()) {
      if (team.tier === 'ahl' || team.tier === 'world') continue
      team.finances.capUsed = capUsedFor(team, this.data.players)
    }
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
    const isDef = (p: Player): boolean => p.position === 'D'

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
      p.position === 'G' ? 'G' : p.position === 'D' ? 'D' : 'F'

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
          const pool = ahl.roster
            .map((id) => this.data.players.get(id))
            .filter((p): p is Player => !!p && p.injuryStatus === null && grpOf(p) === grp)
            .sort((a, b) => ratedOverall(b) - ratedOverall(a) || (a.id < b.id ? -1 : 1))
          // Cap-aware recall (B7.3): this used to take the BEST body regardless
          // of price, so injury runs stacked salary with no ceiling at all.
          // Prefer the best man who actually FITS the cap; if nobody fits, take
          // the cheapest and eat the overage — icing a legal lineup outranks the
          // cap sheet, which is how emergency conditions work in the real NHL.
          const capRoom = nhl.finances.salaryCap - capUsedFor(nhl, this.data.players)
          const cand =
            pool.find((p) => p.contract.salary <= capRoom) ??
            [...pool].sort(
              (a, b) => a.contract.salary - b.contract.salary || (a.id < b.id ? -1 : 1)
            )[0]
          if (!cand) break // no healthy AHL body at this position — repairLines copes
          ahl.roster = ahl.roster.filter((id) => id !== cand.id)
          nhl.roster.push(cand.id)
        }
      }

      // ── conform back to the 23-man limit ──────────────────────────────────
      // Injury recalls that were never sent back down ratchet the roster over the
      // cap. Trim the lowest-rated HEALTHY, WAIVER-EXEMPT extras (the young call-ups
      // that inflated it — no waiver exposure) back to AHL, so long as the NHL club
      // keeps its healthy minimums. Waiver-requiring vets are left for the GM.
      while (nhl.roster.length > 23) {
        const demotable = nhl.roster
          .map((id) => this.data.players.get(id))
          .filter((p): p is Player => !!p && p.injuryStatus === null && !this.requiresWaivers(p))
          .filter((p) => healthyCount(nhl.roster, grpOf(p)) > NEED[grpOf(p)])
          .sort((a, b) => ratedOverall(a) - ratedOverall(b) || (a.id < b.id ? -1 : 1))
        const send = demotable[0]
        if (!send) break // only waiver-requiring/needed bodies remain — GM must act
        nhl.roster = nhl.roster.filter((id) => id !== send.id)
        ahl.roster.push(send.id)
      }

      // The loop above only moves WAIVER-EXEMPT bodies, so a club whose surplus
      // is all veterans just sits over the limit — and an AI club has no GM to
      // act, so it ratchets there permanently (the autopilot flags it as
      // "roster size 28 outside 18-26"). Above the LEGAL maximum that is not a
      // judgement call, so AI clubs conform even if it costs waiver exposure.
      // The user's club is left alone: silently exposing his veteran to waivers
      // is his decision, and userLineupShortfall() already prompts him.
      // (Root cause is the missing IR model — injured players still count
      // against the roster here; see the LTIR/CBA epic.)
      if (nhlId !== this.userTeamId) {
        while (nhl.roster.length > MAX_ROSTER_SIZE) {
          const send = nhl.roster
            .map((id) => this.data.players.get(id))
            .filter((p): p is Player => !!p && p.injuryStatus === null)
            .filter((p) => healthyCount(nhl.roster, grpOf(p)) > NEED[grpOf(p)])
            .sort((a, b) => ratedOverall(a) - ratedOverall(b) || (a.id < b.id ? -1 : 1))[0]
          if (!send) break // genuinely can't conform — every healthy body is needed
          nhl.roster = nhl.roster.filter((id) => id !== send.id)
          ahl.roster.push(send.id)
        }
      }
    }
    // Number any mid-season arrivals (recalls, trade/waiver adds) who lack a
    // jersey — construction/rollover only cover the roster at those moments.
    this.ensureJerseyNumbers()
  }

  /** If the user's club cannot ice a legal lineup (12 healthy F / 6 D / 2 G)
   *  even after pulling every healthy AHL body up, return a plain-English,
   *  actionable message; otherwise null. Counts the AHL as available depth
   *  because {@link emergencyRecalls} will pull those bodies up before puck drop. */
  private userLineupShortfall(): string | null {
    const grpOf = (p: Player): 'F' | 'D' | 'G' =>
      p.position === 'G' ? 'G' : p.position === 'D' ? 'D' : 'F'
    const nhl = this.userTeam
    const ahl = nhl.affiliateId ? this.data.teams.get(nhl.affiliateId) : undefined
    const healthy = (roster: PlayerId[], grp: 'F' | 'D' | 'G'): number =>
      roster.reduce((n, id) => {
        const p = this.data.players.get(id)
        return p && p.injuryStatus === null && grpOf(p) === grp ? n + 1 : n
      }, 0)
    const avail = (grp: 'F' | 'D' | 'G'): number => healthy(nhl.roster, grp) + (ahl ? healthy(ahl.roster, grp) : 0)
    const need: Record<'F' | 'D' | 'G', number> = { F: 12, D: 6, G: 2 }
    const label: Record<'F' | 'D' | 'G', string> = { F: 'forward', D: 'defenceman', G: 'goalie' }
    const missing: string[] = []
    for (const grp of ['F', 'D', 'G'] as const) {
      const gap = need[grp] - avail(grp)
      if (gap > 0) missing.push(`${gap} more ${label[grp]}${gap > 1 ? 's' : ''}`)
    }
    if (missing.length === 0) return null
    return (
      `Your club can't ice a legal lineup — you're short ${missing.join(', ')}. ` +
      `A game needs 12 healthy forwards, 6 defencemen and 2 goalies (AHL call-ups counted). ` +
      `Sign a free agent, swing a trade, or recall from the AHL before the next game.`
    )
  }

  private finishDay(day: number, played: Set<PlayerId>, outcomes: GameOutcome[]): void {
    const dayRng = this.rngFor(7001, day)
    const recovery = tickRecovery({ players: this.data.players.values(), playedToday: played, rng: dayRng })
    // A cleared injury on your club: note the return, and flag if he'll be
    // shaking off rust for a few games (a long layoff carries match rust).
    for (const ret of recovery.returns) {
      if (this.teamOf(ret.id) !== this.userTeamId) continue
      const p = this.data.players.get(ret.id)
      if (!p) continue
      this.pushNews(
        'injury',
        `${p.name} returns to the lineup`,
        `${p.name} is cleared and available for selection. He's been out a while, so expect him to need ${ret.rustGames} game${ret.rustGames === 1 ? '' : 's'} to shake off the rust and round back into form.`,
        { playerId: ret.id as string, teamId: this.userTeamId as string }
      )
    }
    // #171: load management — a rested player who's back to full freshness comes
    // off the shelf automatically, with a note to the GM's desk.
    for (const id of this.userTeam.roster) {
      const p = this.data.players.get(id)
      if (p?.resting && p.fatigue <= 8) {
        p.resting = false
        this.pushNews('injury', `${p.name} rested and ready`,
          `${p.name} has been given his legs back after a spell of load management — he's fresh and available for selection.`,
          { playerId: id as string, teamId: this.userTeamId as string })
      }
    }
    // Stretch-run drama: the day your club mathematically clinches a playoff
    // spot — or gets eliminated — gets its own headline (once per season).
    this.checkPlayoffBerth()
    // #184: AI GMs answer any trade proposals whose deliberation has elapsed.
    this.resolvePendingTrades()
    // #170 weekly practice: the user's regimen shifts fatigue. A hard focus tires
    // the roster (the price of sharper development); a recovery week freshens
    // legs at the cost of growth. Only the user's club runs a chosen regimen.
    if (day % 7 === 0) {
      const roster = this.userTeam.roster
        .map((id) => this.data.players.get(id))
        .filter((p): p is Player => p !== undefined)
      const ticks = tickPractice({ players: roster, state: this.practiceState, rng: this.rngFor(7106, day) })
      const byId = new Map(roster.map((p) => [p.id as string, p]))
      for (const t of ticks) {
        const p = byId.get(t.playerId)
        if (p) p.fatigue = Math.max(0, Math.min(100, p.fatigue + t.fatigueDelta))
      }
      // #188: honour (or break) the promises implied by each player's status.
      this.tickSquadPromises()
    }
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
    // Weekly scouting digest: one briefing a week rather than a per-find drip.
    if (day > 0 && day % 7 === 0) this.emitScoutDigest(day)
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
        attributeBias: (id) => this.practiceAttributeBias(id),
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
      // The league lives without you: AI clubs deal with each other, and the
      // volume ramps toward the deadline into a real flurry (multiple deals can
      // land in a single day). Each attempt re-reads the updated rosters, so a
      // vet isn't traded twice and the market thins as pieces move.
      const dl = this.deadlineDay - day
      const aiTradeAttempts = dl === 0 ? 12 : dl >= 0 && dl <= 5 ? 7 : dl >= 0 && dl <= 20 ? 4 : 2
      for (let attempt = 0; attempt < aiTradeAttempts; attempt++) {
        const aiDeal = generateAiAiTrade({
          day,
          deadlineDay: this.deadlineDay,
          userTeamId: this.userTeamId,
          teams: this.data.teams,
          players: this.data.players,
          picks: this.picks,
          rng: this.rngFor(7012, day, attempt),
          postureOf,
        })
        if (!aiDeal) continue
        this.executeAiAiDeal(aiDeal, day)
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
    // Season Rhythm M3: camp plays out beat by beat. Each Continue before cut
    // day walks the camp one day forward (a scrimmage or a practice note) — no
    // game is simmed until camp resolves. On cut day, simming past hands the
    // coach the clipboard (his plan applied, waiver exposure and all).
    if (this.trainingCamp && !this.trainingCamp.resolved) {
      if ((this.trainingCamp.campDay ?? 8) < 8) {
        this.advanceTrainingCampDay()
        return true
      }
      this.autoResolveTrainingCamp()
    }
    // Season Rhythm M1: simming past the preseason board meeting sends the AGM
    // in your place (safe defaults, a news item, and the meeting is gone).
    if (this.boardMeetingYear !== null) this.autoResolveBoardMeeting()
    // Same for a pending staff meeting simmed past (non-gated auto-sim): the AGM
    // applies the safe defaults. (A meeting created THIS pass is created below,
    // after this guard, so it survives to be shown by the App gate next Continue.)
    if (this.staffMeetingScene !== null) this.autoDelegateStaffMeeting()
    // Same for a pending scout meeting simmed past: the Head of Scouting runs it.
    if (this.scoutMeetingScene !== null) this.autoDelegateScoutMeeting()
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
      // The market comes alive the instant we hold: concrete offers on your desk
      // and a morning flurry of AI-to-AI deals on the wire (runs once).
      this.openDeadlineDay()
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
    // Roster gate: if the user plays on the next match day but can't dress a
    // legal lineup even with AHL call-ups, hold the sim with a clear, actionable
    // message rather than grinding on an impossible lineup (which used to lock up).
    const userPlaysNext = this.data.league.schedule.some(
      (g) => g.day === nextDay && (g.homeTeamId === this.userTeamId || g.awayTeamId === this.userTeamId)
    )
    if (userPlaysNext && this.userLineupShortfall()) {
      // Before blocking, let the coach do his job: auto-recall AHL depth and
      // repair the lines (the same fix the GM would otherwise apply by hand).
      // Only hold the sim if a legal lineup is STILL impossible after that —
      // a genuine roster hole the GM must solve with a signing or trade.
      this.emergencyRecalls()
      repairLines(this.userTeam, this.data.players)
      const shortfall = this.userLineupShortfall()
      if (shortfall) throw new Error(shortfall)
    }
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
        intensity: gameIntensity(this.rivalriesState, game.homeTeamId as string, game.awayTeamId as string).factor,
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
    // ── recurring staff meeting: convene the war-room roughly every two weeks ──
    // The coaching staff read the live roster and table proposals the GM acts on
    // (a real line move, a rest, a call-up, a tactical shift). Blocking, with a
    // delegate-to-AGM escape. Only convenes when there's something worth raising.
    if (
      this.staffMeetingScene === null &&
      Math.floor(nextDay / STAFF_MEETING_INTERVAL) > Math.floor(this.currentDay / STAFF_MEETING_INTERVAL)
    ) {
      const findings = this.buildStaffFindings()
      if (findings.length > 0) {
        this.staffMeetingScene = buildStaffMeetingScene({
          findings,
          cast: this.staffCast(),
          day: nextDay,
          year: this.year,
          record: this.userRecordTriple(),
        })
      }
    }
    // ── recurring scout meeting: the recruitment desk convenes roughly monthly ──
    // The Head of Scouting walks the board — risers/fallers vs consensus, flagged
    // prospects awaiting a call, and coverage gaps — and the GM acts. Blocking,
    // with a delegate-to-Head-of-Scouting escape. Only convenes with content.
    if (
      this.scoutMeetingScene === null &&
      this.staffMeetingScene === null && // don't stack two convened meetings on one Continue
      Math.floor((nextDay - SCOUT_MEETING_OFFSET) / SCOUT_MEETING_INTERVAL) >
        Math.floor((this.currentDay - SCOUT_MEETING_OFFSET) / SCOUT_MEETING_INTERVAL)
    ) {
      const input = this.buildScoutMeetingInput(nextDay)
      if (input && scoutMeetingHasContent(input)) {
        this.scoutMeetingScene = buildScoutMeetingScene(input)
      }
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
      const domestic = s.competitionNation === 'canada' || s.competitionNation === 'usa'
      this.pushNews(
        'contract',
        domestic
          ? `${p.name} signs on with the ${s.competitionName}`
          : `${p.name} heads overseas to the ${s.competitionName}`,
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

  /** Summer takeover (#145): the game begins the day AFTER the draft that the
   *  database already reflects — every roster exactly as imported, no fake
   *  season simulated. Your first acts as GM: re-signings and arbitration,
   *  July 1 free agency, development camp, then training camp and the roster
   *  cuts before opening night. Your first draft comes at the end of your
   *  first season — with the class the real world is waiting on. */
  startAtOffseason(): void {
    if (this.phase !== 'regularSeason' || this.currentDay > 0) return
    this.phase = 'offseason'
    this.offseason = { year: this.year, stage: 'resign', draft: null, faDay: 0 }
    // The resign-stage prep that normally runs at the draft→resign transition.
    this.resignStatus.clear()
    for (const id of this.userTeam.roster) {
      if (this.resolve(id).contract.yearsRemaining === 0) this.resignStatus.set(id, 'pending')
    }
    this.generateOfferSheets()
    // Stock the open market from day one — the FA desk should never be empty
    // when the user arrives at July 1.
    this.stockFreeAgentMarket()
    const ai = aiResignDay({
      teams: this.data.teams,
      players: this.data.players,
      userTeamId: this.userTeamId,
      year: this.year,
      rng: this.rngFor(8003),
    })
    if (ai.signings.length > 0) {
      this.pushNews(
        'contract',
        `${ai.signings.length} re-signings around the league`,
        `Clubs locked up their expiring talent ahead of free agency.`
      )
      // The biggest of those deals hit the transaction ledger too, so the
      // July board opens with real paper instead of an empty wire.
      const notable = [...ai.signings].sort((a, b) => b.salary - a.salary).slice(0, 20)
      for (const s of notable) {
        const p = this.resolve(s.playerId)
        const t = this.data.teams.get(s.teamId)!
        const txResult = recordTransaction(this.transactionLedger, {
          day: this.currentDay,
          year: this.year,
          kind: 'signing',
          teamIds: [s.teamId as string],
          summary: `${t.abbreviation} re-sign ${p.position} ${p.name} ($${(s.salary / 1e6).toFixed(2)}M × ${s.years}y).`,
        })
        this.transactionLedger = txResult.ledger
      }
    }
    // Construction-era mail (welcome, mandate, season-begins) was stamped
    // before the phase flip — it all belongs to July 1 of the start summer.
    for (const n of this.news) if (!n.dateISO) n.dateISO = `${this.year}-07-01`
    // Development camp opens in early July — your first beat as GM.
    // (Only armed when the org actually has kids to skate.)
    this.devCampPending = this.devCampInvitees().invitees.length > 0
    this.pushNews(
      'league',
      `Welcome to the ${this.userTeam.name} front office`,
      `The draft is behind the league and the summer is yours: settle your expiring contracts, work July 1, ` +
      `run development camp, and pick your 23 out of training camp. The season will judge all of it.`,
      { teamId: this.userTeamId as string }
    )
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
        intensity: gameIntensity(this.rivalriesState, game.homeTeamId as string, game.awayTeamId as string).factor,
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
    // Division of each NHL team → enables the real NHL divisional playoff format
    // (top 3 per division + 2 wildcards) when the league has divisions.
    const teamDivision = new Map<TeamId, string>()
    for (const tid of this.data.league.teams) {
      const div = this.data.teams.get(tid)?.divisionId
      if (div) teamDivision.set(tid, div)
    }
    this.playoffs = seedBracket({ year: this.year, conferences, standingsOrder: order, teamDivision })
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
      const res = sim(home, away, this.storyResolve(), {
        seed,
        rules: 'playoff',
        intensity: gameIntensity(this.rivalriesState, g.homeTeamId as string, g.awayTeamId as string).factor,
      })
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
          nameA: this.data.teams.get(g.homeTeamId)?.abbreviation,
          nameB: this.data.teams.get(g.awayTeamId)?.abbreviation,
          goalsA: res.homeGoals,
          goalsB: res.awayGoals,
          penaltyMinutesA: homePim,
          penaltyMinutesB: awayPim,
          wasPlayoff: true,
          year: this.year,
          rng: this.rngFor(7201, day, g.gameNumber),
        })
        if (rivalResult.newsSeeds.length > 0) {
          this.pushSeeds(this.groundRivalryNews(rivalResult.newsSeeds, g.homeTeamId as string, g.awayTeamId as string))
        }
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
    // The summer's spending is managed against NEXT season's cap — advance the
    // buyout dead-cap tail to that season's slice (0 once a buyout runs its course).
    const priorDeadCap = this.userDeadCap
    this.refreshDeadCap(this.year + 1)
    if (priorDeadCap > 0 && this.userDeadCap === 0) {
      this.pushNews(
        'contract',
        'Buyout charges come off the books',
        `The last of the buyout dead cap has cleared. The ledger is clean heading into free agency.`,
        { teamId: this.userTeamId as string }
      )
    }
    // Fire awards night report on entering the offseason (once per season).
    for (const kind of checkAwardsStage(this.pressScheduleState)) {
      this.queueScheduledReport(kind as Parameters<typeof this.queueScheduledReport>[0])
    }
    // Announce the actual trophy winners by name — the payoff for the season's
    // award races. Runs while this.totals still holds the season's stats.
    this.announceSeasonAwards()
  }

  /** Move the offseason forward one stage (or one FA day). Returns true if it moved. */
  advanceOffseason(): boolean {
    // #184: the trade market keeps moving through the summer — any proposal a GM
    // is sitting on gets its answer as the offseason days tick by.
    this.resolvePendingTrades()
    // Dev camp is a WEEK (Offseason 2.0): while it runs, each Continue is the
    // next camp day — arrival, the scrimmage, the wrap. Pressing on from the
    // wrap without naming a standout sends the staff and mails the report.
    if (this.devCampPending) {
      if ((this.devCampState?.day ?? 0) < 3) {
        this.advanceDevCampDay()
        return true
      }
      this.autoResolveDevCamp()
    }
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

          // LW4 ripple: the REDRAFT — one year on, the press re-ranks last
          // year's draft class by how the players actually developed. Steals
          // get their flowers; slides get named. Your picks are flagged.
          {
            const classEvents = this.chronicle.events.filter(
              (e) => e.kind === 'draftPick' && e.year === this.year - 1 && (e.details?.overallPick ?? 999) <= 64
            )
            if (classEvents.length >= 10) {
              const ranked = classEvents
                .map((e) => {
                  const p = this.data.players.get(asPlayerId(e.playerIds[0] ?? ''))
                  return p ? { e, p, now: ratedOverall(p) + 0.4 * Math.max(0, overall(p.potential, p.position) - ratedOverall(p)) } : null
                })
                .filter((x): x is NonNullable<typeof x> => x !== null)
                .sort((a, b) => b.now - a.now)
              const top5 = ranked.slice(0, 5).map((x, i) => {
                const orig = x.e.details?.overallPick ?? 0
                const yours = x.e.userInvolved ? ' (YOUR pick)' : ''
                return `${i + 1}. ${x.p.name} — drafted #${orig} by ${x.e.teamIds[0] ? this.data.teams.get(asTeamId(x.e.teamIds[0]))?.abbreviation ?? '?' : '?'}${yours}`
              })
              const steal = ranked.slice(0, 8).reduce((best, x) =>
                (x.e.details?.overallPick ?? 0) > (best?.e.details?.overallPick ?? 0) ? x : best, ranked[0])
              const slide = ranked
                .filter((x) => (x.e.details?.overallPick ?? 99) <= 5)
                .sort((a, b) => ranked.indexOf(b) - ranked.indexOf(a))[0]
              const slideIdx = slide ? ranked.indexOf(slide) + 1 : 0
              this.pushNews(
                'draft',
                `The ${this.year - 1} redraft — one year later`,
                `Twelve months of development later, the press re-ranks the ${this.year - 1} class:\n\n${top5.join('\n')}\n\n` +
                (steal && (steal.e.details?.overallPick ?? 0) > 10
                  ? `Steal of the class: ${steal.p.name}, taken #${steal.e.details?.overallPick}. Somebody's scout earned his miles.\n`
                  : '') +
                (slide && slideIdx > 10
                  ? `Hardest slide: ${slide.p.name} went #${slide.e.details?.overallPick} and re-ranks ${slideIdx}th today. It's early — but the whispers have started.`
                  : ''),
                {}
              )
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
          // #173: ticket pricing nudges it too — value pricing grows the base a
          // touch each year, premium pricing quietly costs you goodwill.
          const pricingDrift = this.ticketPricing === 'value' ? 2 : this.ticketPricing === 'premium' ? -2 : 0
          const fanDelta = fanInterestDelta({
            finalRank: userFinalRank,
            n: this.data.league.teams.length,
            madePlayoffs,
            wonCup,
            rebuilding: this.clubDirection === 'rebuild' || this.boardState.rebuildSanctioned === true,
          }) + pricingDrift
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
            // Owner-investment perk: a funded development-staff upgrade gives
            // the user's own organisation a modest tailwind this season.
            const perkMod = this.ownerPerk === 'development' && tid === this.userTeamId ? 1.15 : 1
            return lockerMod * this.mentorshipDevBonus(id as string) * perkMod
          },
          // #170: the practice focus reallocates the summer pass toward its
          // targeted attributes (scaled by the head coach's dev competence).
          attributeBias: (id) => this.practiceAttributeBias(id),
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
          // LW6: notable careers get a legacy article grounded in chronicle
          // facts — where he was drafted, the clubs he wore, the cups he won —
          // instead of a one-line goodbye. Journeymen keep the short send-off.
          const ovr = overall(p.composites, p.position)
          const seasons = p.stats.length
          if (ovr >= 76 || seasons >= 12) {
            const prov = chronicleProvenanceOf(this.chronicle, id as string)
            const events = chronicleEventsForPlayer(this.chronicle, id as string, 50)
            const cups = events.filter((e) => e.kind === 'championship').map((e) => e.year)
            const clubs = [...new Set((prov?.acquisitions ?? []).map((a) => a.teamId))]
              .map((tid) => this.data.teams.get(asTeamId(tid))?.abbreviation)
              .filter((x): x is string => !!x)
            const tradedTimes = events.filter((e) => e.kind === 'trade').length
            let gp = 0, g = 0, a = 0, so = 0
            for (const s of p.stats) {
              if (s.league === 'ahl') continue // the send-off tallies his NHL career
              gp += s.gamesPlayed
              g += s.ev.goals + s.pp.goals + s.pk.goals
              a += s.ev.assists + s.pp.assists + s.pk.assists
              so += s.shutouts
            }
            const statLine = p.position === 'G'
              ? `${gp} games and ${so} shutouts`
              : `${gp} games, ${g} goals and ${g + a} points`
            const lines = [
              `${p.name} retires at ${p.age} after ${seasons} seasons — ${statLine}.`,
              prov?.draftedBy
                ? `It began in ${prov.draftYear}, when ${this.data.teams.get(asTeamId(prov.draftedBy))?.abbreviation ?? 'a club'} called his name ${prov.overallPick ? `at #${prov.overallPick}` : `in round ${prov.round ?? '?'}`}.`
                : '',
              clubs.length > 1 ? `He wore ${clubs.length} sweaters: ${clubs.join(', ')}.` : '',
              tradedTimes > 0 ? `Moved at the deadline and in the summer — traded ${tradedTimes} time${tradedTimes > 1 ? 's' : ''} along the way.` : '',
              cups.length > 0
                ? `He leaves with ${cups.length === 1 ? 'a championship ring' : `${cups.length} championship rings`} (${cups.join(', ')}).`
                : `The one line missing from the résumé: a championship.`,
            ].filter(Boolean)
            this.pushNews('league', `End of an era: ${p.name} retires`, lines.join(' '), {
              playerId: id as string,
            })
          } else {
            this.pushNews('league', `${p.name} retires`, `${p.name} hangs up the skates at ${p.age}.`, {
              playerId: id as string,
            })
          }
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
        // Season Rhythm M3: development camp opens right after the draft — a
        // live beat. The next Continue walks you onto the rink; simming past
        // sends the staff and mails the report instead.
        this.devCampPending = this.devCampInvitees().invitees.length > 0
        // Stock the open market so the resign stage (July 1) already has a
        // deep board — the FA desk is never empty.
        this.stockFreeAgentMarket()
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
        // Expiries + buyouts JOIN the standing market (which was stocked when
        // the resign stage opened) — they don't replace it.
        for (const e of expired) {
          const id = e.playerId as string
          if (!arbFiled.has(id) && !this.faPool.some((f) => (f as string) === id)) this.faPool.push(e.playerId)
        }
        for (const id of this.buyoutFas) if (!this.faPool.some((f) => (f as string) === (id as string))) this.faPool.push(id)
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
        // July 1: the market is already stocked (stocked when resign opened);
        // a light top-up plus the expiries make it a full frenzy. Announce it.
        this.stockFreeAgentMarket()
        {
          const poolNames = this.faPool
            .slice(0, 6)
            .map((id) => {
              const p = this.data.players.get(asPlayerId(id as string))
              return p ? `${p.name} (${p.position}, ${p.age})` : ''
            })
            .filter(Boolean)
          if (this.faPool.length > 0) {
            this.pushNews(
              'contract',
              `Free agency is open: ${this.faPool.length} on the market`,
              `The window is open and the board is deep — unsigned veterans, cap casualties and expiring deals all on offer. ` +
              `Names to know: ${poolNames.join(', ')}${this.faPool.length > poolNames.length ? `, and ${this.faPool.length - poolNames.length} more` : ''}. ` +
              `The Free Agents desk has the whole market.`,
              {}
            )
          }
        }
        // Repair every club's lines for July 1 — but never let one malformed
        // team (e.g. a quirk in an imported roster) throw and dead-end the
        // GM's Continue. A team that can't be repaired is simply left as-is.
        for (const team of this.data.teams.values()) {
          try { repairLines(team, this.data.players) } catch { /* skip a bad team */ }
        }
        os.stage = 'freeAgency'
        os.faDay = 0
        return true
      }
      case 'freeAgency': {
        os.faDay++
        // #167: resolve the GM's standing offers first — his money gets first
        // look each day before the AI market moves.
        this.resolveFaOffers()
        // #183: offer sheets whose 7-day match window has elapsed resolve here.
        this.resolveOfferSheets()
        // AI clubs work the phones a beat behind the user: released veterans
        // don't all sign within 24 hours, and the GM you play gets the same
        // first-mover window a real front office fights for. (Cadence law —
        // the market should be a week of decisions, not one press.)
        const faRanks = this.strengthRanks()
        const res = aiFreeAgencyDay({
          teams: this.data.teams,
          players: this.data.players,
          freeAgentIds: this.faPool,
          userTeamId: this.userTeamId,
          year: this.year,
          rng: this.rngFor(8004, os.faDay),
          faDay: Math.max(0, os.faDay - 2),
          // Competitive window shapes the market: rebuilders sign youth/stopgaps,
          // contenders chase the difference-makers.
          postureOf: (tid) => this.clubPostureFor(tid, faRanks).posture,
        })
        const signedIds = new Set(res.signings.map((s) => s.playerId as string))
        this.faPool = this.faPool.filter((id) => !signedIds.has(id as string))
        for (const s of res.signings) this.lockerArrival(s.teamId, s.playerId)
        // World Chronicle: every signing writes provenance (future "he walked on
        // us in free agency" callbacks); notable ones get a chronicle event.
        // Every deal ALSO hits the transaction ledger — the July market is the
        // league's paper trail, not just headlines.
        for (const s of res.signings) {
          const p = this.resolve(s.playerId)
          {
            const t = this.data.teams.get(s.teamId)!
            const txResult = recordTransaction(this.transactionLedger, {
              day: this.currentDay,
              year: this.year,
              kind: 'signing',
              teamIds: [s.teamId as string],
              summary: `${t.abbreviation} sign ${p.position} ${p.name} ($${(s.salary / 1e6).toFixed(2)}M × ${s.years}y).`,
            })
            this.transactionLedger = txResult.ledger
          }
          recordAcquisition(this.chronicle, {
            playerId: s.playerId as string, teamId: s.teamId as string,
            year: this.year, via: 'signing',
          })
          if (ratedOverall(p) >= 75) {
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
        // Season Rhythm M2 — July 1 is a FRENZY, not a queue. The AI market
        // runs two beats behind the user (the head start above), so the
        // roundup keys on the EFFECTIVE market day: the first day AI money
        // actually moves gets the full story, the next day the recap.
        const marketDay = Math.max(0, os.faDay - 2)
        if (marketDay === 1 && res.signings.length > 0) {
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
        } else if (marketDay === 2 && res.signings.length > 0) {
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
          const t = this.data.teams.get(s.teamId)!
          if (ratedOverall(p) >= 78) {
            // Marquee UFA — a real headline that belongs in the front-office mail,
            // not just the ticker. Deliberately worded "land" (not "signs with"):
            // the inbox curation strips generic depth-signing noise, and a summer's
            // big ticket landing elsewhere is exactly the league news you want.
            this.pushNews(
              'contract',
              `${t.name} land ${p.name}`,
              `${t.name} have signed ${p.name} (${p.position}, ${p.age}) to a $${(s.salary / 1e6).toFixed(2)}M × ${s.years}-year deal — one of the summer's marquee names is off the board.`,
              { playerId: s.playerId as string, teamId: s.teamId as string }
            )
            continue
          }
          // Mid-tier depth: keep the churny format (surfaces in the Feed/ticker,
          // filtered out of the inbox so it doesn't bury the real headlines).
          if (ratedOverall(p) < 72 && marketDay > 2) continue
          if (marketDay <= 2 && ratedOverall(p) < 70) continue
          this.pushNews(
            'contract',
            `${p.name} signs with ${t.abbreviation}`,
            `${t.name} sign ${p.name} for $${(s.salary / 1e6).toFixed(2)}M × ${s.years} years.`,
            { playerId: s.playerId as string, teamId: s.teamId as string }
          )
        }
        // Losses teach: a name YOU were tracking (shortlist or open talks)
        // signing elsewhere gets a personal debrief with the WHY.
        for (const s of res.signings) {
          const pid = s.playerId as string
          const tracked = this.faShortlist.has(pid)
          const session = this.negotiations.get(pid)
          const inTalks = session !== undefined && session.year === this.year &&
            (session.status === 'open' || session.status === 'paused')
          if (!tracked && !inTalks) continue
          const p = this.resolve(s.playerId)
          const t = this.data.teams.get(s.teamId)!
          const w = priorityWeights(p)
          const reason =
            w.money >= 0.35
              ? `the money — $${(s.salary / 1e6).toFixed(2)}M a year was the market, and someone paid it`
              : w.term >= 0.3
                ? `the term — ${s.years} guaranteed years bought the security his camp wanted`
                : `the fit — ${t.name} offered the role his agent kept asking about`
          this.pushNews(
            'contract',
            `You lose ${p.name} to ${t.abbreviation}`,
            `${p.name} was on your board, but he signs with ${t.name} ` +
            `($${(s.salary / 1e6).toFixed(2)}M × ${s.years}). His agent's read: it came down to ${reason}.`,
            { playerId: pid, teamId: s.teamId as string }
          )
          this.faShortlist.delete(pid)
          if (session && session.status !== 'signed') session.status = 'walked'
        }
        for (const team of this.data.teams.values()) repairLines(team, this.data.players)
        if (os.faDay >= FA_WINDOW_DAYS) {
          // Unanswered arbitration awards bind the club (cap permitting).
          for (const c of [...this.arbitrationCases]) this.acceptArbitration(c.playerId)
          for (const c of [...this.arbitrationCases]) this.walkAwayArbitration(c.playerId) // cap-blocked leftovers walk
          this.runWorldFreeAgency()
          // The window's shut; unresolved standing offers lapse. Any offer sheet
          // still pending gets its final verdict now rather than vanishing.
          this.faPendingOffers = []
          for (const s of [...this.pendingOfferSheets]) this.resolveOneOfferSheet(s)
          this.pendingOfferSheets = []
          os.stage = 'preseason'
          // Dev camp (early July) is over by the time we reach preseason/training
          // camp. Clear its pending flag defensively so a dev camp the GM skipped
          // without opening the screen can't light up the "Development camp is on
          // the ice" banner during September's training camp.
          this.devCampPending = false
        }
        return true
      }
      case 'preseason': {
        // Leadership gate: the season shouldn't open until the GM has named a
        // captain. This is enforced in the RENDERER (the captainsPending dash
        // flag blocks Continue and routes to the Leadership screen) rather than
        // by halting the engine here — a headless advance (tests, quick-sim)
        // must still be able to roll a season without UI interaction.
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
      pos === 'G' ? 'G' : pos === 'D' ? 'D' : 'F'
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

  /** The preseason leadership gate: you must name a captain before the season
   *  opens (sweater numbers are auto-assigned but editable, and alternates are
   *  optional, so naming the C is the one required call). Fails OPEN when there's
   *  no eligible skater or the captain is already set + still rostered, so it can
   *  never soft-lock and never nags a club whose C hasn't changed. */
  private captainsSetupComplete(): boolean {
    const roster = this.userTeam.roster
    const eligible = roster.filter((id) => this.data.players.get(id)?.position !== 'G')
    if (eligible.length === 0) return true // fail open — nothing to captain
    const cap = this.userTeam.captainId
    return cap !== undefined && roster.includes(cap)
  }

  /** True while the season can't open because the user hasn't named a captain. */
  captainsPending(): boolean {
    return this.offseason?.stage === 'preseason' && !this.captainsSetupComplete()
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
      const shG = this.shGoals.get(pid) ?? 0
      const shA = this.shAssists.get(pid) ?? 0
      const ratingAcc = this.seasonRatingTotals.get(pid as string)
      p.stats.push({
        season: this.year,
        teamId: (teamId as string) ?? 'FA',
        gamesPlayed: games,
        ev: {
          // Even-strength = everything that wasn't on the PP or shorthanded.
          goals: Math.max(0, t.goals - ppG - shG),
          assists: Math.max(0, t.assists - ppA - shA),
          shots: t.shots,
          // #175: even-strength TOI is the total minus the special-teams split.
          timeOnIce: Math.max(0, t.toi - (t.ppToi ?? 0) - (t.pkToi ?? 0)),
        },
        pp: { goals: ppG, assists: ppA, shots: 0, timeOnIce: Math.round(t.ppToi ?? 0) },
        // #175: shorthanded points ARE the PK's scoring output (was a placeholder 0);
        // pk.timeOnIce is now the real penalty-kill ice time.
        pk: { goals: shG, assists: shA, shots: 0, timeOnIce: Math.round(t.pkToi ?? 0) },
        plusMinus: t.plusMinus,
        penaltyMinutes: t.penaltyMinutes,
        saves: t.saves,
        shotsAgainst: t.shotsAgainst,
        goalsAgainst: t.goalsAgainst,
        shutouts: this.shutouts.get(pid) ?? 0,
        ...(ratingAcc && ratingAcc.n > 0 ? { avgRating: Math.round((ratingAcc.sum / ratingAcc.n) * 100) / 100 } : {}),
      })
    }
    // Farm production is history too: a prospect who spent the year in the AHL
    // gets his own season line (league:'ahl'), so his development shows up on his
    // career page instead of a blank year. PP/PK aren't split at the farm level,
    // so everything lands in the even-strength bucket.
    for (const [pid, t] of this.ahlTotals) {
      const games = this.ahlGp.get(pid) ?? 0
      if (games <= 0) continue
      const p = this.data.players.get(pid)
      if (!p) continue
      // Record the AHL line under the FARM club, not whatever roster he's on now.
      // A called-up prospect sits on the NHL team at rollover; his AHL line still
      // belongs to that club's affiliate (and mustn't collide with his NHL line).
      const cur = this.teamOf(pid)
      let ahlTeamId = cur
      if (cur) {
        const curTeam = this.data.teams.get(cur)
        if (curTeam && curTeam.tier !== 'ahl' && curTeam.affiliateId) ahlTeamId = curTeam.affiliateId
      }
      p.stats.push({
        season: this.year,
        teamId: (ahlTeamId as string) ?? 'FA',
        league: 'ahl',
        gamesPlayed: games,
        ev: { goals: t.goals, assists: t.assists, shots: t.shots, timeOnIce: Math.round(t.toi) },
        pp: { goals: 0, assists: 0, shots: 0, timeOnIce: 0 },
        pk: { goals: 0, assists: 0, shots: 0, timeOnIce: 0 },
        plusMinus: t.plusMinus,
        penaltyMinutes: t.penaltyMinutes,
        saves: t.saves,
        shotsAgainst: t.shotsAgainst,
        goalsAgainst: t.goalsAgainst,
        shutouts: 0,
      })
    }
  }

  /**
   * Career totals for a send-off: the player's simmed NHL career plus any real
   * imported pre-sim history (careerHistory). Used only for retirement copy and
   * the records/HOF ledger — never by the sim itself.
   */
  private realCareerTotalsOf(p: Player): {
    gp: number; goals: number; assists: number; points: number; shutouts: number
  } {
    const sim = this.careerTotalsOf(p.id)
    let gp = sim.gamesPlayed, goals = sim.goals, assists = sim.assists, shutouts = sim.shutouts
    for (const h of p.careerHistory ?? []) {
      if (/ahl|american hockey/i.test(h.league)) continue // NHL/senior career line only
      gp += h.gamesPlayed
      goals += h.goals
      assists += h.assists
      shutouts += h.shutouts
    }
    return { gp, goals, assists, points: goals + assists, shutouts }
  }

  /**
   * Reconcile every player against the rosters so nobody is left in limbo.
   *
   * A player under contract who is on no roster — the classic "Crosby vanished"
   * bug, where a star drops off his club with no trade, no signing, no news — is
   * invisible: he appears on no screen and no transaction ever explained the
   * exit. So is a washed-up veteran lingering in the players map with no club
   * and no free-agent listing. This sweep guarantees the invariant that every
   * NHL-ecosystem player is in exactly one *visible* state — rostered, a listed
   * free agent, or an announced retiree — and heals saves that already broke it.
   *
   * Runs at every rollover (so a fresh drop is caught the same summer) and once
   * on load (so an existing broken save is healed). Deterministic: every choice
   * is a threshold on age/ability, no randomness.
   */
  private reconcileOrphans(silent = false): void {
    // Everyone already accounted for: on a roster, a listed free agent, or a
    // current draft-eligible prospect. Anyone else in the map is an orphan.
    const rostered = new Set<string>()
    for (const t of this.data.teams.values()) for (const id of t.roster) rostered.add(id as string)
    const listed = new Set<string>(this.faPool.map((id) => id as string))
    const prospectIds = new Set<string>()
    for (const c of this.data.league.draftClasses) for (const pr of c.prospects) prospectIds.add(pr.playerId as string)
    const nhlPool = new Set<string>(this.data.league.players.map((id) => id as string))

    // Pro clubs a dropped player can legitimately be re-homed to (NHL + AHL).
    const proTeams = new Set<string>([
      ...this.data.league.teams.map((id) => id as string),
      ...(this.data.league.ahlTeams ?? []).map((id) => id as string),
    ])
    // The player's most recent NHL/AHL club — where a dropped contract belongs.
    const lastProTeamOf = (p: Player): TeamId | null => {
      let best: { season: number; teamId: string } | null = null
      for (const s of p.stats) {
        if (!s.teamId || !proTeams.has(s.teamId)) continue
        if (!best || s.season >= best.season) best = { season: s.season, teamId: s.teamId }
      }
      return best ? asTeamId(best.teamId) : null
    }

    // Part of the NHL ecosystem (vs an imported world/junior body that was never
    // on a pro roster)? Only these are swept — an unattached KHL grinder in the
    // source DB is not our vanished star and stays out of the NHL market.
    const isNhlUniverse = (p: Player): boolean => {
      if (nhlPool.has(p.id as string)) return true
      if (p.contract.yearsRemaining > 0) return true
      for (const s of p.stats) if ((s.league ?? 'nhl') === 'nhl' || s.league === 'ahl') return true
      return false
    }

    const restored: Player[] = []
    const retirees: Player[] = []

    for (const p of this.data.players.values()) {
      const id = p.id as string
      if (rostered.has(id) || listed.has(id) || prospectIds.has(id)) continue
      if (p.retiredYear !== undefined) continue
      if (!isNhlUniverse(p)) continue

      if (p.contract.yearsRemaining > 0) {
        // Under contract → he must be on a roster. Restore him where he last
        // played; only if that club is gone do we fall through to retire/list.
        const home = lastProTeamOf(p)
        if (home) {
          this.data.teams.get(home)!.roster.push(p.id)
          rostered.add(id)
          restored.push(p)
          continue
        }
      }

      // Expired (or a contract with no resolvable club): retire the ones whose
      // careers are plainly finished; list everyone else as a free agent so the
      // GM can actually sign them.
      const ovr = ratedOverall(p)
      const done = p.age >= 37 || (p.age >= 34 && ovr < 74) || (p.age >= 31 && ovr < 58)
      if (done) {
        p.retiredYear = this.year
        retirees.push(p)
      } else {
        this.faPool.push(p.id)
        listed.add(id)
      }
    }

    // Announce retirements. Genuine legends (registerRetirements' own bar) get a
    // proper retrospective; everyone else is gathered into a single digest so a
    // backlog heal (an old save with dozens of lingering veterans) never floods
    // the inbox. Every retiree hits the transactions ledger either way — a paper
    // trail, never a silent exit.
    if (retirees.length > 0) {
      const entries = retirees.map((p) => {
        const tot = this.realCareerTotalsOf(p)
        return { p, tot }
      })
      entries.sort((a, b) => b.tot.points - a.tot.points)
      const rr = registerRetirements({
        state: this.recordsState,
        retirees: entries.map(({ p, tot }) => ({
          playerId: p.id as string,
          name: p.name,
          careerGoals: tot.goals,
          careerAssists: tot.assists,
          careerPoints: tot.points,
          careerGames: tot.gp,
        })),
        year: this.year,
      })
      // When healing a save on LOAD (silent), record the retirement to the
      // records/HoF ledger — the paper trail must exist — but do NOT push it as
      // fresh inbox news: these players didn't retire "today" (a mid-season
      // date), they were already gone; announcing it on Nov 11 was the bug.
      // At rollover (offseason), announce as usual.
      if (!silent) {
        this.pushSeeds(rr.newsSeeds)
        const announced = new Set(rr.newsSeeds.map((s) => s.playerId).filter((x): x is string => !!x))
        const rest = entries.filter(({ p }) => !announced.has(p.id as string))
        if (rest.length > 0) {
          const names = rest.slice(0, 6).map(({ p }) => p.name)
          this.pushNews(
            'league',
            `${rest.length} veteran${rest.length > 1 ? 's' : ''} call it a career`,
            `${names.join(', ')}${rest.length > names.length ? `, and ${rest.length - names.length} others` : ''} have retired from professional hockey.`,
          )
        }
      }
      for (const { p } of entries) {
        const home = lastProTeamOf(p)
        const tx = recordTransaction(this.transactionLedger, {
          day: this.currentDay,
          year: this.year,
          kind: 'retire',
          teamIds: home ? [home as string] : [],
          summary: `${p.name} (${p.position}, ${p.age}) retires`,
        })
        this.transactionLedger = tx.ledger
      }
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

    // Retained-salary slots (#157) come off the books when the contract expires.
    // Drop any that have run their course and clear the player's retention tag.
    for (const team of this.data.teams.values()) {
      if (!team.finances.retained?.length) continue
      const expired = team.finances.retained.filter((s) => s.expiryYear <= newYear)
      if (expired.length === 0) continue
      for (const slot of expired) {
        const p = this.data.players.get(asPlayerId(slot.playerId))
        if (p && p.contract.retainedByOthers) delete p.contract.retainedByOthers
      }
      team.finances.retained = team.finances.retained.filter((s) => s.expiryYear > newYear)
    }

    // Cap escalation: the NHL ceiling climbs ~4–5% a year with revenue. A cap
    // frozen at its opening value forever is deeply un-NHL — salaries inflate
    // (ELCs expire, RFAs get raises) while the ceiling stays put, and within a
    // few seasons the whole league is jammed against a wall it should have
    // grown past. Bump every NHL club's ceiling in lockstep (it's league-wide),
    // rounded to the nearest $100k. Surfaces naturally on the Finances screen.
    {
      const CAP_GROWTH = 1.045
      for (const teamId of this.data.league.teams) {
        const t = this.data.teams.get(teamId)
        if (!t) continue
        t.finances.salaryCap = Math.round((t.finances.salaryCap * CAP_GROWTH) / 100_000) * 100_000
      }
    }
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
    this.shutouts.clear()
    this.ppGoals.clear()
    this.ppAssists.clear()
    this.shGoals.clear()
    this.shAssists.clear()
    this.tradeOffers = []
    this.lastBoxScore = null
    this.resignStatus.clear()
    // Unsigned players stay unsigned into the new season — the market never
    // resets to empty. Drop only those who found a roster; keep the rest.
    {
      const rostered = new Set<string>()
      for (const t of this.data.teams.values()) for (const id of t.roster) rostered.add(id as string)
      this.faPool = this.faPool.filter((id) => !rostered.has(id as string))
    }
    this.playoffs = null
    this.offseason = null
    this.currentDay = 0
    this.phase = 'regularSeason'
    // Keep the market open + deep in-season (persists across seasons + AI shops it).
    this.stockFreeAgentMarket()
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
    // Number this year's new arrivals (draft picks, signings) who lack a jersey.
    this.ensureJerseyNumbers()
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
    this.playoffBerthAnnounced = null
    /* ── plumbing module rollover ── */
    this.playerRatings.clear()
    this.seasonRatingTotals.clear()
    this.hireableStaff = []
    this.coachMarket = null // fresh slate of available coaches each offseason
    // Keep practiceState team focus across seasons (intentional persistence)
    // Season-scoped arcs close at year's end. A career milestone chase genuinely
    // spans seasons, so it carries over with a continuity beat; a feud or
    // mentorship that somehow survived a whole season has run its course by now
    // (the in-season tick resolves the rest) — close it rather than let it linger
    // forever with an annual generic beat.
    for (const arc of this.arcsState.arcs) {
      if (arc.status === 'resolved') continue
      if (arc.kind === 'milestoneWatch') {
        arc.beats.push({ day: 0, year: newYear, summary: `The chase carries into the ${newYear} season.` })
        continue
      }
      if (arc.kind === 'feud') {
        resolveArc(this.arcsState, arc.id, 'A summer apart cooled whatever was left of it.', 0, newYear)
        continue
      }
      if (arc.kind === 'mentorship') {
        resolveArc(this.arcsState, arc.id, 'The mentorship ran its course over the year.', 0, newYear)
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
      // LW5: settle the season's remaining promise debts before the page turns.
      for (const pr of this.playerPromises) {
        if (pr.status !== 'open') continue
        const p = this.data.players.get(asPlayerId(pr.playerId))
        const onOrg = p ? this.ownOrgIds().has(pr.playerId as string) : false
        if (pr.kind === 'newDeal') {
          // Kept if he's still in the organization (the deal came, or he chose
          // to stay); broken if he walked or you shipped him after promising.
          pr.status = onOrg ? 'kept' : 'broken'
          if (pr.status === 'kept' && p) {
            p.morale = Math.min(100, p.morale + 6)
          } else if (p) {
            this.pushNews('contract', `A promise that never came`, `Last season you told ${p.name} “${pr.text}”. He never saw the deal — and he has left the organization. Agents remember these things.`, { playerId: pr.playerId })
          }
        } else {
          // In-season promises that never came due (season ended first) — the
          // explore-trade ones settle here: gone = kept, still here = broken.
          pr.status = onOrg && pr.kind === 'exploreTrade' ? 'broken' : 'kept'
          if (pr.status === 'broken' && p) {
            p.morale = Math.max(0, p.morale - 12)
            this.pushNews('trade', `${p.name} still waiting on your word`, `You told him “${pr.text}” and the season ended with him still here. The conversation this summer will not be warm.`, { playerId: pr.playerId })
          }
        }
        this.chroniclePromise(pr, 0)
      }
      // Only the settled history of the past year matters; drop older entries.
      this.playerPromises = this.playerPromises.filter((pr) => pr.year >= this.year)

      // Buyout dead cap follows the CBA tail: the slice for the season now
      // beginning stays on the books; past-season slices drop off. (The tail
      // is advanced season-to-season, not wiped after a single year.)
      this.refreshDeadCap(newYear)
    }
    decayIntensity(this.rivalriesState, newYear)
    // Reset special-teams for the new season.
    this.specialTeams = []
    // Reset hot/cold streak tracking for the new season.
    this.teamStreaks.clear()

    // Safety net: no player leaves the league unseen. Any contracted player who
    // fell off a roster is restored; any washed-up veteran still lingering in
    // the map retires (announced) or is listed as a free agent. Runs last, after
    // every roster op for the new season has settled.
    this.reconcileOrphans()

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

  /** Recompute `userDeadCap` as the buyout tail slice for a given season, and
   *  drop slices for seasons already in the past. Called whenever the season the
   *  GM is managing changes (offseason opens for the next year; a new season
   *  begins). */
  private refreshDeadCap(managedYear: number): void {
    this.deadCapSchedule = this.deadCapSchedule.filter((e) => e.year >= managedYear)
    this.userDeadCap = this.deadCapSchedule
      .filter((e) => e.year === managedYear)
      .reduce((sum, e) => sum + e.amount, 0)
  }

  /** Season Rhythm M2: the buyout window. During the offseason (re-sign and
   *  free-agency stages) a club can eat a bad contract. Following the real CBA:
   *  the cost is 2/3 of the remaining money (1/3 if the player is under 26),
   *  spread as dead cap over TWICE the contract's remaining years. He becomes an
   *  unrestricted free agent immediately. */
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
    const years = p.contract.yearsRemaining
    // Real CBA: 2/3 of the remaining money (1/3 if he's under 26), spread over
    // twice the remaining years.
    const factor = p.age >= 26 ? 2 / 3 : 1 / 3
    const spreadYears = years * 2
    const perYear = Math.round((remaining * factor) / spreadYears)
    // The tail lands on the seasons still to come: the upcoming season first.
    const firstYear = this.year + 1
    for (let i = 0; i < spreadYears; i++) {
      this.deadCapSchedule.push({ year: firstYear + i, amount: perYear })
    }
    // The player walks: off the roster, contract terminated, into free agency.
    releaseFromTeam({ team: this.userTeam, playerId: pid, players: this.data.players })
    this.lockerDeparture(this.userTeamId, pid)
    repairLines(this.userTeam, this.data.players)
    p.contract.yearsRemaining = 0
    if (os.stage === 'freeAgency') this.faPool.push(pid)
    else this.buyoutFas.push(pid)
    // The immediate season's slice is what constrains this summer's spending.
    this.refreshDeadCap(firstYear)
    const charge = perYear
    this.pushNews(
      'contract',
      `${p.name} bought out`,
      `The club has bought out the remainder of ${p.name}'s contract. He becomes an unrestricted free agent; ` +
      `$${(perYear / 1e6).toFixed(2)}M in dead cap sticks to the books for each of the next ${spreadYears} seasons ` +
      `(two-thirds of what he was owed, stretched over twice the term). Expensive freedom — but freedom.`,
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
    const capUsed = this.userCapUsed()
    if (capUsed + this.userDeadCap + c.salary > this.userTeam.finances.salaryCap) {
      return { ok: false, message: 'The award does not fit under your cap — clear space or walk away.' }
    }
    // Cap space isn't the only limit signPlayer enforces. Without this the
    // automatic "unanswered awards bind the club" pass throws on a full roster
    // and abandons the offseason. Refusing here is already handled: the caller
    // walks any award it couldn't accept.
    if (!this.userTeam.roster.includes(asPlayerId(playerId)) && this.userTeam.roster.length >= MAX_ROSTER_SIZE) {
      return { ok: false, message: `Your roster is full at ${MAX_ROSTER_SIZE} — clear a spot or walk away.` }
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
    // Living Ledger: cutting an established veteran ripples through his
    // friends in the room — record BEFORE release while he's still resolvable
    // as a roster player. Fringe bodies come and go without a wake.
    {
      const p = this.data.players.get(asPlayerId(playerId))
      if (p && p.age >= 27 && ratedOverall(p) >= 68) {
        this.recordWorldAction('released', playerId, 'open')
      }
    }
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
    return pos === 'G' ? 'G' : pos === 'D' ? 'D' : 'F'
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
            let dest = nhlReady ? org : ahl
            // A full NHL roster can't absorb him no matter how good he looks —
            // this push bypasses signPlayer's limit, and an over-size roster
            // (28 of a legal 26) is what the autopilot flags at d0. Bump him to
            // the farm instead. Deliberately NOT stranding him in junior when
            // the farm is also full: an over-size AHL roster is harmless, but a
            // graduating GOALIE left in junior can't be recalled, and the club
            // is then unable to ice a legal lineup at all.
            if (dest === org && org.roster.length >= MAX_ROSTER_SIZE) dest = ahl
            if (!dest) { stay.push(pid); continue }
            p.contract = elc()
            dest.roster.push(pid)
            if (dest === org) touchedNhl.add(org.id)
            else touchedAhl.add(dest.id)
            if (p.rightsTeamId === this.userTeamId) {
              this.pushNews(
                'contract',
                // Key the story off where he ACTUALLY reported, not off whether
                // he looked ready — a prospect bumped to the farm by a full
                // roster must not get a "makes the NHL" headline.
                dest === org ? `${p.name} makes the NHL out of camp` : `${p.name} turns pro`,
                dest === org
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
  /** The dev-camp roster: this year's draftees first, then rights-held and
   *  farm prospects, U23 only, best potential first (top 8). */
  private devCampInvitees(): { invitees: Player[]; draftedIds: Set<string> } {
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
    // #182: once the GM has curated the invite list, honour it exactly (drafted
    // ids still recognised for the read). Otherwise use the auto pool.
    if (this.devCampRoster !== undefined) {
      const invitees = this.devCampRoster
        .map((id) => this.data.players.get(asPlayerId(id)))
        .filter((p): p is Player => !!p)
      return { invitees, draftedIds }
    }
    const invitees = [...orgYoung.values()]
      .sort((a, b) => {
        const da = draftedIds.has(a.id as string) ? 1 : 0
        const db = draftedIds.has(b.id as string) ? 1 : 0
        return db - da || ratedPotential(b) - ratedPotential(a)
      })
      // A real development camp is the WHOLE prospect pool, not a handful —
      // every drafted/rights-held/young signed player in the org gets a look.
      .slice(0, 60)
    return { invitees, draftedIds }
  }

  /** #182: young players the GM MAY invite to development camp — only those his
   *  org holds RIGHTS to (drafted, rights-held, on the NHL/AHL roster) plus
   *  genuine unsigned free agents nobody controls (a real tryout invite). You
   *  can't invite another club's prospect or a draft-eligible kid you don't own.
   *  Age ≤ 23; deterministic order. (#185 fix — the old pool leaked rights-held
   *  prospects and top draft-eligible players.) */
  private devCampEligible(): Player[] {
    const draftedIds = new Set(
      this.chronicle.events
        .filter((e) => e.kind === 'draftPick' && e.year === this.year && e.teamIds[0] === (this.userTeamId as string))
        .flatMap((e) => e.playerIds)
    )
    const affiliate = this.userTeam.affiliateId ? this.data.teams.get(this.userTeam.affiliateId) : undefined
    const faSet = new Set(this.faPool.map((id) => id as string))
    const pool = new Map<string, Player>()
    for (const [pid, p] of this.data.players) {
      const id = pid as string
      if (p.age > 23) continue
      const rights = p.rightsTeamId as string | undefined
      const inOrg =
        draftedIds.has(id) ||
        rights === (this.userTeamId as string) ||
        this.userTeam.roster.includes(pid) ||
        (affiliate?.roster.includes(pid) ?? false)
      // A real tryout invite is a genuine unsigned free agent whose rights NOBODY
      // holds — not a draft-eligible prospect or another club's property.
      const freeTryout = faSet.has(id) && (rights === undefined || rights === null)
      if (inOrg || freeTryout) pool.set(id, p)
    }
    return [...pool.values()].sort(
      (a, b) => (draftedIds.has(b.id as string) ? 1 : 0) - (draftedIds.has(a.id as string) ? 1 : 0) || ratedPotential(b) - ratedPotential(a)
    )
  }

  /** #182: the invite editor — who's in, and who else you could bring in. */
  getDevCampInvites(): DevCampInvitesView {
    const invited = new Set(this.devCampInvitees().invitees.map((p) => p.id as string))
    const eligible = this.devCampEligible()
    const badgeOf = (p: Player): DevCampInviteRow => ({
      ...badge(p, this.fogCtx()),
      potential: ratedPotential(p),
      org: this.userTeam.roster.includes(p.id) || (this.userTeam.affiliateId ? this.data.teams.get(this.userTeam.affiliateId)?.roster.includes(p.id) ?? false : false) || (p.rightsTeamId as string | undefined) === (this.userTeamId as string),
    })
    return {
      locked: this.devCampState !== null, // camp already underway — invites are set
      invited: [...invited].map((id) => this.data.players.get(asPlayerId(id))).filter((p): p is Player => !!p).map(badgeOf),
      available: eligible.filter((p) => !invited.has(p.id as string)).slice(0, 80).map(badgeOf),
    }
  }

  /** #182: add or remove a dev-camp invite. Seeds the explicit list from the
   *  auto pool on first edit, then flips the player's membership. */
  toggleDevCampInvite(playerId: string): { ok: boolean; invited: boolean; message?: string } {
    if (this.devCampState !== null) return { ok: false, invited: true, message: 'Camp is already underway — invites are locked.' }
    if (this.devCampRoster === undefined) {
      this.devCampRoster = this.devCampInvitees().invitees.map((p) => p.id as string)
    }
    const i = this.devCampRoster.indexOf(playerId)
    if (i >= 0) {
      this.devCampRoster.splice(i, 1)
      return { ok: true, invited: false }
    }
    // Only allow inviting an eligible young player.
    if (!this.devCampEligible().some((p) => (p.id as string) === playerId)) {
      return { ok: false, invited: false, message: 'Only prospects and young tryout invites are eligible for development camp.' }
    }
    this.devCampRoster.push(playerId)
    return { ok: true, invited: true }
  }

  /* ─────────────── #182 training-camp PTO invites ─────────────── */

  /** #182: unsigned veterans the GM may bring to main camp on a pro tryout —
   *  aging depth on the open market (nobody holds their rights). A broader pool
   *  than the AGM auto-pick so there's a real choice. Deterministic order. */
  private campPtoEligible(): Player[] {
    this.stockFreeAgentMarket()
    const faSet = new Set(this.faPool.map((id) => id as string))
    const out: Player[] = []
    for (const id of faSet) {
      const p = this.data.players.get(asPlayerId(id))
      if (!p) continue
      const rights = p.rightsTeamId as string | undefined
      if (rights !== undefined && rights !== null) continue
      const ovr = ratedOverall(p)
      if (p.age >= 28 && ovr >= 62 && ovr <= 82) out.push(p)
    }
    return out.sort((a, b) => ratedOverall(b) - ratedOverall(a) || Career.pidNum(a.id as string) - Career.pidNum(b.id as string))
  }

  /** #182: the AGM's default PTO shortlist (used when the GM hasn't curated one). */
  private defaultCampPtoInvites(): string[] {
    const ptoRng = this.rngFor(9604, this.year)
    return this.campPtoEligible()
      .filter((p) => ratedOverall(p) >= 66 && ratedOverall(p) <= 79)
      .sort((a, b) => ratedOverall(b) - ratedOverall(a) + ptoRng.float(-2, 2))
      .slice(0, 3)
      .map((p) => p.id as string)
  }

  /** #182: the training-camp PTO invite editor — who you're bringing on a tryout,
   *  and the other unsigned vets you could add. Locked once camp is built. */
  getCampInvites(): CampInvitesView {
    const locked = this.trainingCamp !== null
    const invitedIds = new Set(this.campPtoInvites ?? this.defaultCampPtoInvites())
    const eligible = this.campPtoEligible()
    const row = (p: Player): CampInviteRow => ({ ...badge(p, this.fogCtx()), overall: ratedOverall(p) })
    return {
      locked,
      invited: [...invitedIds]
        .map((id) => this.data.players.get(asPlayerId(id)))
        .filter((p): p is Player => !!p)
        .map(row),
      available: eligible.filter((p) => !invitedIds.has(p.id as string)).slice(0, 60).map(row),
    }
  }

  /** #182: add or drop a training-camp PTO invite. Seeds the explicit list from
   *  the AGM shortlist on first edit, then flips membership. Locked once camp is
   *  built. */
  toggleCampInvite(playerId: string): { ok: boolean; invited: boolean; message?: string } {
    if (this.trainingCamp !== null) return { ok: false, invited: true, message: 'Camp is set — the tryout list is locked.' }
    if (this.campPtoInvites === undefined) this.campPtoInvites = this.defaultCampPtoInvites()
    const i = this.campPtoInvites.indexOf(playerId)
    if (i >= 0) { this.campPtoInvites.splice(i, 1); return { ok: true, invited: false } }
    if (!this.campPtoEligible().some((p) => (p.id as string) === playerId)) {
      return { ok: false, invited: false, message: 'Only unsigned veteran free agents are eligible for a pro tryout.' }
    }
    this.campPtoInvites.push(playerId)
    return { ok: true, invited: true }
  }

  /** The coach's pick for camp standout: the best week (highest read roll),
   *  drafted players edging ties. Deterministic — the same across every call. */
  private devCampStandout(): { player: Player; reason: string } | null {
    const { invitees, draftedIds } = this.devCampInvitees()
    if (invitees.length === 0) return null
    let best: Player | null = null
    let bestScore = -Infinity
    for (const p of invitees) {
      const { z } = this.devCampRead(p)
      const score = z + (draftedIds.has(p.id as string) ? 0.05 : 0)
      if (score > bestScore) { bestScore = score; best = p }
    }
    if (!best) return null
    const reason = best.position === 'G'
      ? 'tracked pucks like a veteran all week and stood tallest in the scrimmage'
      : 'brought the best pace and compete of the group, and the scrimmage sheet backed it up'
    return { player: best, reason }
  }

  /** Deterministic camp read for an invitee — the same roll the report uses,
   *  so the live scene and the mailed report never disagree. */
  private devCampRead(p: Player): { grade: 'A' | 'B' | 'C'; z: number } {
    const z = this.rngFor(9501, this.year, Career.pidNum(p.id as string)).float(-1, 1)
    return { grade: z > 0.5 ? 'A' : z < -0.5 ? 'C' : 'B', z }
  }

  /** Advance the camp week one beat. Day 2 plays the intra-squad scrimmage:
   *  deterministic stat lines weighted by talent, an actual scoreline, and
   *  fuel for the wrap-day grades. */
  advanceDevCampDay(): void {
    // Arrival (day 1) is on display from the moment camp opens — the first
    // press plays the scrimmage, the second files the final reads.
    const day = (this.devCampState?.day ?? 1) + 1
    if (day > 3) return
    if (day === 2) {
      const { invitees } = this.devCampInvitees()
      const lines: DevCampState['lines'] = []
      let white = 0
      let blue = 0
      invitees.forEach((p, i) => {
        const squad: 'white' | 'blue' = i % 2 === 0 ? 'white' : 'blue'
        const rng = this.rngFor(9503, this.year, Career.pidNum(p.id as string))
        const talent = (ratedPotential(p) + ratedOverall(p)) / 2
        const sog = p.position === 'G' ? 0 : Math.max(0, Math.round(rng.float(0, 2) + talent / 30))
        const g = p.position === 'G' ? 0 : (rng.chance(Math.min(0.6, 0.08 + talent / 200)) ? 1 : 0) + (rng.chance(talent / 400) ? 1 : 0)
        const a = p.position === 'G' ? 0 : rng.chance(0.35 + talent / 300) ? 1 : 0
        if (squad === 'white') white += g
        else blue += g
        lines.push([p.id as string, { g, a, sog, squad }])
      })
      // Filler goals so the scoreline reads like a real scrimmage.
      const rng = this.rngFor(9504, this.year)
      white += rng.range(0, 2)
      blue += rng.range(0, 2)
      this.devCampState = { day: 2, lines, scoreline: `White ${white}, Blue ${blue}` }
      const top = [...lines].sort((a, b) => (b[1].g * 2 + b[1].a) - (a[1].g * 2 + a[1].a))[0]
      const topName = top ? this.data.players.get(asPlayerId(top[0]))?.name : undefined
      this.pushNews(
        'scouting',
        `Dev camp scrimmage: ${this.devCampState.scoreline}`,
        `The kids played a full intra-squad game today.${topName ? ` ${topName} was the best player on the ice.` : ''} ` +
        `The staff file their final reads tomorrow, and name their camp standout.`,
        { teamId: this.userTeamId as string }
      )
      return
    }
    this.devCampState = { ...(this.devCampState ?? { lines: [] }), day: 3 }
  }
  /** The live development camp (M3): the rink, the kids, the staff's reads —
   *  and one call that is yours: name the camp standout. */
  getDevCamp(): DevCampView | null {
    if (!this.devCampPending) return null
    const staff = this.getTeamStaff(this.userTeamId as string)
    const { invitees, draftedIds } = this.devCampInvitees()
    if (invitees.length === 0) return null
    const cast: DevCampView['cast'] = []
    if (staff.headCoach) cast.push({ name: staff.headCoach.name, title: 'Head Coach', ...(staff.headCoach.faceId !== undefined ? { faceId: staff.headCoach.faceId } : {}) })
    if (staff.assistantGM) cast.push({ name: staff.assistantGM.name, title: 'Assistant GM', ...(staff.assistantGM.faceId !== undefined ? { faceId: staff.assistantGM.faceId } : {}) })
    const day = this.devCampState?.day ?? 1
    const lineOf = new Map(this.devCampState?.lines ?? [])
    // Bucket-appropriate read variants, picked deterministically per player so
    // a 40-kid pool reads with variety instead of three sentences on a loop.
    const RISER_SK = [
      'Quicker release and better pace than the book had.',
      'Looked a level up — dictated shifts and won his battles.',
      'Real pop in his game; the compete showed every drill.',
      'Made plays at a pace the group couldn\'t match.',
      'Skating and hands both ahead of schedule.',
      'Drove play whenever he was on the ice.',
    ]
    const RISER_G = [
      'Tracked pucks like a veteran all week.',
      'Calm and square in the net; nothing rattled him.',
      'Swallowed rebounds and stole the scrimmage.',
      'Read plays early and beat the shooters to the spot.',
    ]
    const ONTRACK = [
      'Solid, unspectacular week — right where his age should be.',
      'Did his job quietly; no red flags, no fireworks.',
      'Blended in with the group — steady if unspectacular.',
      'Competent all week; tools there to build on.',
      'Held his own without forcing the staff\'s eye.',
      'Fine week — nothing that moves the needle either way.',
    ]
    const BEHIND = [
      'A step behind the group — the summer homework list is long.',
      'Overwhelmed by the pace; plenty to clean up.',
      'Looked raw next to his peers — patience required.',
      'Chasing the play too often; the gap to close is real.',
      'Not ready — the details need a full year of work.',
      'Struggled to keep up; a project for now.',
    ]
    const pickRead = (arr: string[], p: Player): string => arr[Career.pidNum(p.id as string) % arr.length]!
    return {
      day,
      ...(this.devCampState?.scoreline ? { scoreline: this.devCampState.scoreline } : {}),
      invitees: invitees.map((p) => {
        const { grade: baseGrade, z } = this.devCampRead(p)
        // Wrap-day grades argue from the scrimmage: production can lift a
        // read one notch; an invisible night can drop one.
        const ln = lineOf.get(p.id as string)
        const pts = ln ? ln.g * 2 + ln.a : 0
        const grade: 'A' | 'B' | 'C' =
          day >= 2 && ln
            ? pts >= 3
              ? 'A'
              : pts === 0 && ln.sog === 0 && baseGrade !== 'A'
                ? 'C'
                : baseGrade
            : baseGrade
        const drafted = draftedIds.has(p.id as string)
        // Keep the read consistent with what's SHOWN: once the scrimmage has
        // (re)graded a kid, his read follows the final grade rather than the
        // stale pre-camp baseline — no "A" next to "struggled to keep up".
        const bucket: 'riser' | 'ontrack' | 'behind' =
          day >= 2 && ln
            ? grade === 'A' ? 'riser' : grade === 'C' ? 'behind' : 'ontrack'
            : z > 0.5 ? 'riser' : z < -0.5 ? 'behind' : 'ontrack'
        const read =
          bucket === 'riser'
            ? pickRead(p.position === 'G' ? RISER_G : RISER_SK, p)
            : bucket === 'behind'
              ? pickRead(BEHIND, p)
              : pickRead(ONTRACK, p)
        return {
          playerId: p.id as string,
          name: p.name,
          age: p.age,
          position: p.position,
          drafted,
          grade,
          read,
          ...(lineOf.has(p.id as string) ? { line: lineOf.get(p.id as string)! } : {}),
          ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
        }
      }),
      cast,
      // On wrap day, surface the COACHES' standout pick (read-only) — it's
      // their read, not the GM's call.
      ...(day >= 3
        ? (() => {
            const s = this.devCampStandout()
            return s ? { coachStandout: { playerId: s.player.id as string, name: s.player.name, reason: s.reason } } : {}
          })()
        : {}),
    }
  }

  /** Close the book on camp — the STAFF name the standout and file the report.
   *  (Arg kept for protocol back-compat; ignored — the coaches decide now.) */
  submitDevCamp(_standoutId?: string): { ok: boolean; message?: string } {
    if (!this.devCampPending) return { ok: false, message: 'Development camp is over.' }
    this.devCampPending = false
    this.devCampState = null
    this.devCampRoster = undefined // next summer's camp starts from the auto pool
    this.pushDevCampReport()
    return { ok: true }
  }

  /** Simming past dev camp: the staff run it and mail the report. Same path
   *  as closing it yourself — the coaches always name the standout. */
  autoResolveDevCamp(): void {
    if (!this.devCampPending) return
    this.devCampPending = false
    this.devCampState = null
    this.devCampRoster = undefined // next summer's camp starts from the auto pool
    this.pushDevCampReport()
  }

  private pushDevCampReport(): void {
    const staff = this.getTeamStaff(this.userTeamId as string)
    const coachName = staff.headCoach?.name ?? 'The coaching staff'
    const { invitees, draftedIds } = this.devCampInvitees()
    if (invitees.length === 0) return

    // The coaches name their standout — his summer program is built around it.
    const standout = this.devCampStandout()
    const standoutId = standout ? (standout.player.id as string) : null
    if (standout) {
      standout.player.morale = Math.min(100, standout.player.morale + 6)
      chronicleEvent(this.chronicle, {
        year: this.year, day: 0, kind: 'award',
        teamIds: [this.userTeamId as string],
        playerIds: [standoutId as string],
        headline: `${standout.player.name} named ${this.userTeam.name} development-camp standout`,
        userInvolved: true,
      })
    }

    const lines: string[] = []
    for (const p of invitees) {
      // Deterministic camp read; watching him closes a sliver of the fog.
      const { z } = this.devCampRead(p)
      const drafted = draftedIds.has(p.id as string)
      const isStandout = (p.id as string) === standoutId
      const tag = `${drafted ? " (this year's pick)" : ''}${isStandout ? ' ★ CAMP STANDOUT' : ''}`
      if (z > 0.5) {
        lines.push(`${p.name}${tag} — turned heads all week. ${p.position === 'G' ? 'Tracked pucks like a veteran' : 'Quicker release and better pace than the book had'}; the staff want him back for main camp.`)
      } else if (z < -0.5) {
        lines.push(`${p.name}${tag} — a step behind the group. Nothing alarming at his age, but the summer homework list is long.`)
      } else {
        lines.push(`${p.name}${tag} — solid, unspectacular week. Exactly where a kid his age should be.`)
      }
      // Knowledge bump: you watched him for a week (standout a little more).
      const gain = isStandout ? 9 : 4
      const entry = this.scouting.knowledge.find(([id]) => id === (p.id as string))
      if (entry) entry[1] = Math.min(100, entry[1] + gain)
      else this.scouting.knowledge.push([p.id as string, gain + 4])
    }
    this.pushNews(
      'scouting',
      `Development camp report — ${coachName}`,
      `Development camp wrapped this week: ${invitees.length} of the organisation's young players on the ice, ` +
      `this year's draft class included.` +
      `${standout ? ` The staff named ${standout.player.name} the camp standout — he ${standout.reason}.` : ''}` +
      `\n\nThe reads:\n\n• ${lines.join('\n• ')}`,
      { teamId: this.userTeamId as string, ...(standoutId ? { playerId: standoutId } : {}) }
    )
  }

  /** The live training camp (M3): cut day. The coach's verdicts, your calls. */
  getTrainingCamp(): TrainingCampView | null {
    if (!this.trainingCamp || this.trainingCamp.resolved) return null
    const staff = this.getTeamStaff(this.userTeamId as string)
    const cast: TrainingCampView['cast'] = []
    if (staff.headCoach) cast.push({ name: staff.headCoach.name, title: 'Head Coach', ...(staff.headCoach.faceId !== undefined ? { faceId: staff.headCoach.faceId } : {}) })
    if (staff.assistantGM) cast.push({ name: staff.assistantGM.name, title: 'Assistant GM', ...(staff.assistantGM.faceId !== undefined ? { faceId: staff.assistantGM.faceId } : {}) })
    const c = this.trainingCamp
    return {
      decisions: c.decisions.map((d) => ({ ...d })),
      cast,
      ...(c.campDay !== undefined ? { campDay: c.campDay } : {}),
      ...(c.startISO ? { startISO: c.startISO } : {}),
      ...(c.endISO ? { endISO: c.endISO } : {}),
      ...(c.roster ? { roster: c.roster.map((r) => ({ ...r })) } : {}),
      ...(c.schedule ? { schedule: c.schedule.map((s) => ({ ...s })) } : {}),
      ...(c.scrimmage ? { scrimmage: structuredClone(c.scrimmage) } : {}),
      ...(c.reports ? { reports: c.reports.map((r) => ({ ...r })) } : {}),
    }
  }

  /** Open the EHM-style camp week: the camp roster split Blue/Red and the
   *  day-by-day schedule. The scrimmage box score and coach reports start
   *  EMPTY — the week plays out beat by beat via {@link advanceTrainingCampDay}
   *  (each Continue on the camp screen walks one day forward), so camp READS
   *  like a week rather than resolving as one button. */
  private buildTrainingCampWeek(decisions: TrainingCampState['decisions']): void {
    const camp = this.trainingCamp
    if (!camp) return
    const year = this.year
    camp.startISO = `${year}-09-15`
    camp.endISO = `${year}-09-23`
    camp.campDay = 1

    // Camp roster = the NHL group + the AHL bodies fighting for a spot.
    const nhlIds = [...this.userTeam.roster]
    const ahlBattleIds = decisions.filter((d) => d.current === 'ahl').map((d) => d.playerId)
    const seen = new Set<string>()
    const bodies: Player[] = []
    for (const id of [...nhlIds.map((x) => x as string), ...ahlBattleIds]) {
      if (seen.has(id)) continue
      seen.add(id)
      const p = this.data.players.get(asPlayerId(id))
      if (p) bodies.push(p)
    }
    // Split into balanced Blue/Red teams within each position group.
    const teamOf = new Map<string, 'Blue' | 'Red'>()
    for (const grp of ['G', 'D', 'F'] as const) {
      const inGrp = bodies.filter((p) => (p.position === 'G' ? 'G' : p.position === 'D' ? 'D' : 'F') === grp)
      inGrp.forEach((p, i) => teamOf.set(p.id as string, i % 2 === 0 ? 'Blue' : 'Red'))
    }
    const ahlSet = new Set(ahlBattleIds)
    const ptoSet = new Set(decisions.filter((d) => d.tryout).map((d) => d.playerId))
    camp.roster = bodies.map((p) => ({
      playerId: p.id as string,
      name: p.name,
      position: p.position,
      age: p.age,
      team: teamOf.get(p.id as string) ?? 'Blue',
      status: ptoSet.has(p.id as string) ? 'PTO' : ahlSet.has(p.id as string) ? 'AHL invite' : 'On Roster',
      ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
    }))

    // The box score starts empty and fills scrimmage by scrimmage; reports are
    // filed on the final practice day, not before.
    camp.scrimmage = { skaters: [], goalies: [], results: [] }
    delete camp.reports

    // Day-by-day schedule; scrimmage results fill in as each is played.
    camp.schedule = [
      { label: 'Day 1', activity: 'Fitness Tests & Camp Meeting', info: 'Physical evaluations of all players' },
      { label: 'Day 2', activity: 'Intra-squad Scrimmage', info: 'Blue vs Red — first look' },
      { label: 'Day 3', activity: 'Skating Drills · Staff Meeting' },
      { label: 'Day 4', activity: 'Intra-squad Scrimmage', info: 'Blue vs Red — second look' },
      { label: 'Day 5', activity: 'Video Sessions · Dryland' },
      { label: 'Day 6', activity: 'Morning Skate · General Practice' },
      { label: 'Day 7', activity: 'Final Practice — coaches file reports' },
      { label: 'Day 8', activity: 'Final Cuts — the roster is set' },
    ]

    // ── Day 1: camp opens. Headcount + who arrived sharp in fitness testing. ──
    const fitRng = this.rngFor(9603, year)
    const fitness = bodies
      .filter((p) => p.position !== 'G')
      .map((p) => [p.name, ratedOverall(p) + fitRng.range(-8, 8)] as const)
      .sort((a, b) => b[1] - a[1])
    const sharp = fitness.slice(0, 2).map(([name]) => name)
    const question = fitness.length > 0 ? fitness[fitness.length - 1][0] : undefined
    this.pushNews(
      'scouting',
      'Training camp opens',
      `${bodies.length} players reported for camp today — the NHL group plus the AHL bodies fighting for a spot. ` +
      `Day one was physical testing and a camp meeting.` +
      `${sharp.length > 0 ? ` ${sharp.join(' and ')} ${sharp.length > 1 ? 'were' : 'was'} sharpest in the fitness drills.` : ''}` +
      `${question ? ` ${question} has some questions to answer this week.` : ''} ` +
      `Two intra-squad scrimmages and the coaches' final reads come before cut day.`,
      { teamId: this.userTeamId as string }
    )
  }

  /** Play ONE intra-squad scrimmage and ACCUMULATE it into the camp box score
   *  (deterministic from talent). Merges each player's line with any prior
   *  scrimmage so the totals grow across the week. */
  private playCampScrimmage(scrimNo: number): void {
    const camp = this.trainingCamp
    if (!camp?.roster || !camp.scrimmage) return
    const year = this.year
    const bySk = new Map(camp.scrimmage.skaters.map((s) => [s.playerId, s] as const))
    const byG = new Map(camp.scrimmage.goalies.map((g) => [g.playerId, g] as const))
    let blueGoals = 0
    let redGoals = 0
    for (const r of camp.roster) {
      const p = this.data.players.get(asPlayerId(r.playerId))
      if (!p) continue
      const talent = (ratedPotential(p) + ratedOverall(p)) / 2
      const rng = this.rngFor(9601, year, scrimNo, Career.pidNum(r.playerId))
      if (p.position === 'G') {
        const mins = 20 + rng.range(0, 20)
        const shots = Math.round(mins * rng.float(0.9, 1.3))
        const svBase = Math.min(0.945, 0.86 + talent / 700)
        const saves = Math.round(shots * rng.float(svBase - 0.05, svBase + 0.03))
        const ga = Math.max(0, shots - saves)
        const prev = byG.get(r.playerId)
        const gp = (prev?.gp ?? 0) + 1
        const tMins = (prev?.mins ?? 0) + mins
        const tGa = (prev?.ga ?? 0) + ga
        const tSaves = (prev?.saves ?? 0) + Math.max(saves, 0)
        const tShots = tSaves + tGa
        byG.set(r.playerId, {
          playerId: r.playerId, name: p.name, team: r.team,
          gp, mins: tMins, ga: tGa, saves: tSaves,
          gaa: Math.round((tGa * 60 / Math.max(1, tMins)) * 100) / 100,
          svPct: tShots > 0 ? Math.round((tSaves / tShots) * 1000) / 1000 : 0,
          rating: Math.round((5.5 + (tShots > 0 ? (tSaves / tShots - 0.86) * 40 : 0)) * 10) / 10,
          ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
        })
        continue
      }
      const g = (rng.chance(Math.min(0.55, 0.06 + talent / 220)) ? 1 : 0) + (rng.chance(talent / 500) ? 1 : 0)
      const a = rng.chance(0.3 + talent / 320) ? 1 : 0
      const sog = Math.max(0, Math.round(rng.float(0, 3) + talent / 28))
      const pim = rng.chance(0.12) ? 2 : 0
      const pm = rng.range(-2, 2)
      if (r.team === 'Blue') blueGoals += g
      else redGoals += g
      const prev = bySk.get(r.playerId)
      const gp = (prev?.gp ?? 0) + 1
      const G = (prev?.g ?? 0) + g
      const A = (prev?.a ?? 0) + a
      const SOG = (prev?.sog ?? 0) + sog
      const PIM = (prev?.pim ?? 0) + pim
      const PM = (prev?.plusMinus ?? 0) + pm
      const gameRating = 6.5 + (g * 2 + a) * 0.5 + (talent - 70) / 25
      const rating = Math.round((prev ? (prev.rating * (gp - 1) + gameRating) / gp : gameRating) * 10) / 10
      bySk.set(r.playerId, {
        playerId: r.playerId, name: p.name, position: p.position, team: r.team,
        gp, g: G, a: A, p: G + A, plusMinus: PM, pim: PIM, sog: SOG, rating,
        ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
      })
    }
    // Filler goals so a scoreline never reads 0–0 when chances were had.
    const fill = this.rngFor(9602, year, scrimNo)
    blueGoals += fill.range(1, 3)
    redGoals += fill.range(1, 3)
    camp.scrimmage.skaters = [...bySk.values()].sort((x, y) => y.p - x.p || y.rating - x.rating || y.sog - x.sog)
    camp.scrimmage.goalies = [...byG.values()]
    camp.scrimmage.results.push(`Team Blue ${blueGoals}, Team Red ${redGoals}`)
  }

  /** File the coaches' per-player reports at the end of camp (EHM "files his
   *  report"), reading off the accumulated scrimmage box score. */
  private fileCampReports(): void {
    const camp = this.trainingCamp
    if (!camp?.decisions) return
    const coachName = this.getTeamStaff(this.userTeamId as string).headCoach?.name ?? 'The head coach'
    const ratingOf = new Map((camp.scrimmage?.skaters ?? []).map((s) => [s.playerId, s.rating] as const))
    camp.reports = camp.decisions.map((d) => {
      const p = this.resolve(asPlayerId(d.playerId))
      const rating = ratingOf.get(d.playerId) ?? 6.5
      const rec: CampReport['recommendation'] = d.tryout
        ? (d.coachPlan === 'nhl' ? 'sign' : 'watch')
        : d.coachPlan === 'nhl' ? 'keep' : 'develop'
      const verdict = d.tryout
        ? d.coachPlan === 'nhl'
          ? `${coachName} likes the tryout — ${p.name} looked the part (avg ${rating.toFixed(1)}) and earned a contract offer. Worth a league-minimum deal.`
          : `${coachName} has seen enough of ${p.name} on his tryout. A fine camp body, but not worth a contract — let him walk.`
        : d.coachPlan === 'nhl'
          ? `${coachName} was impressed — ${p.name} pushed hard at camp (avg ${rating.toFixed(1)}) and has earned an NHL look. He recommends keeping him up.`
          : p.age >= 30
            // A 30+ pro isn't "developing" — if he's on the outs it's a depth
            // call or the end of the road, never a trip to junior hockey. #181
            ? `${coachName} feels ${p.name}'s (${p.age}) camp didn't turn heads. He's a depth option at best now — carry him as insurance or move on.`
            : rating >= 7
              ? `${coachName} liked what he saw from ${p.name}, but feels another year of development in the AHL serves him best.`
              : `${coachName} feels ${p.name} still has work to do and belongs in the AHL to start the year.`
      return {
        playerId: d.playerId,
        name: d.name,
        position: d.position,
        recommendation: rec,
        tryout: d.tryout ?? false,
        verdict,
        ...(d.faceId !== undefined ? { faceId: d.faceId } : {}),
      }
    })
  }

  /** Advance the camp one day — plays that day's beat (a scrimmage or a
   *  practice note), pushes the rinkside coach message, and on the final
   *  practice files the coaches' per-player reports. Each Continue on the camp
   *  screen walks one day forward; cut day (8) holds for the GM's verdict. */
  advanceTrainingCampDay(): void {
    const camp = this.trainingCamp
    if (!camp || camp.resolved) return
    const CUT_DAY = 8
    const day = Math.min(CUT_DAY, (camp.campDay ?? 1) + 1)
    camp.campDay = day
    const teamId = this.userTeamId as string
    switch (day) {
      case 2:
      case 4: {
        const scrimNo = day === 2 ? 1 : 2
        this.playCampScrimmage(scrimNo)
        const res = camp.scrimmage?.results[scrimNo - 1] ?? ''
        if (camp.schedule?.[day - 1]) camp.schedule[day - 1].info = res
        const best = camp.scrimmage?.skaters[0]
        this.pushNews(
          'scouting',
          `Camp scrimmage ${scrimNo}: ${res}`,
          `The camp roster split Blue vs Red for scrimmage ${scrimNo}.` +
          `${best ? ` The staff had ${best.name} (${best.g}G ${best.a}A) as the best skater on the ice.` : ''} ` +
          (scrimNo < 2
            ? `Another look to come before the coaches file their reads.`
            : `The coaches take these reads into their final evaluations now.`),
          { teamId }
        )
        break
      }
      case 3:
        this.pushNews(
          'scouting',
          'Camp: skating drills & systems work',
          `A lighter day on the ice — edgework, systems installs, and a staff meeting to compare notes on the early standouts. No scrimmage today.`,
          { teamId }
        )
        break
      case 5:
        this.pushNews(
          'scouting',
          'Camp: video & dryland',
          `Off-ice today: video breaking down the two scrimmages and a dryland conditioning block. The bubble players know the reports are being written.`,
          { teamId }
        )
        break
      case 6:
        this.pushNews(
          'scouting',
          'Camp: full-team practice',
          `A crisp full practice as the coaches firm up their lines. The picture at the bottom of the roster is coming into focus ahead of cuts.`,
          { teamId }
        )
        break
      case 7:
        this.fileCampReports()
        this.pushNews(
          'scouting',
          'Camp winds down — coaches file their reports',
          `Final practice is done and the staff have filed their per-player reads. Cut day is next; the roster gets set before opening night.`,
          { teamId }
        )
        break
      case CUT_DAY:
        // Cut day: the decision screen is now live and the gate holds for the GM.
        break
    }
  }

  /** Resolve cut day. `placements` overrides the coach's plan per player;
   *  anyone not mentioned follows the plan. Send-downs run REAL waivers —
   *  a claimed player is gone for nothing, and the notes say so. */
  submitTrainingCamp(placements: Array<{ playerId: string; place: 'nhl' | 'ahl' }>): { ok: boolean; notes: string[] } {
    const camp = this.trainingCamp
    if (!camp || camp.resolved) return { ok: false, notes: ['Camp has already broken.'] }
    const notes: string[] = []
    // Adds before cuts: the plan is valid as a set, but applying send-downs
    // first can transiently trip the NHL roster minimums and refuse moves.
    const ordered = [...camp.decisions].sort((a, b) => {
      const wa = placements.find((pl) => pl.playerId === a.playerId)?.place ?? a.coachPlan
      const wb = placements.find((pl) => pl.playerId === b.playerId)?.place ?? b.coachPlan
      return (wa === 'nhl' ? 0 : 1) - (wb === 'nhl' ? 0 : 1)
    })
    for (const d of ordered) {
      const want = placements.find((pl) => pl.playerId === d.playerId)?.place ?? d.coachPlan
      // PTO invitees: 'nhl' signs him to a league-minimum deal, anything else
      // ends the tryout and returns him to the open market.
      if (d.tryout) {
        if (want === 'nhl') {
          const res = this.signTryout(d.playerId)
          notes.push(res.ok
            ? `${d.name} earns a contract out of his tryout — he makes the team on a league-minimum deal.`
            : `${d.name}'s tryout ends without a deal: ${res.message ?? 'no room'}.`)
        } else {
          notes.push(`${d.name}'s tryout ends without a contract — he returns to the open market.`)
        }
        continue
      }
      if (want === d.current) {
        if (want === 'nhl' && d.coachPlan === 'ahl') notes.push(`${d.name} stays on the NHL roster — you overruled the coach.`)
        continue
      }
      if (want === 'nhl') {
        const res = this.callUp(d.playerId)
        notes.push(res.ok ? `${d.name} makes the team out of camp.` : `${d.name} could not be recalled: ${res.message ?? 'roster rules'}.`)
      } else {
        const res = this.sendDown(d.playerId)
        if (!res.ok) notes.push(`${d.name} could not be sent down: ${res.message ?? 'roster rules'}.`)
        else if (res.note) notes.push(res.note)
        else notes.push(`${d.name} is assigned to the farm.`)
      }
    }
    camp.resolved = true
    const team = this.data.teams.get(this.userTeamId)
    const ahl = team?.affiliateId ? this.data.teams.get(team.affiliateId) : undefined
    if (team) repairLines(team, this.data.players)
    if (ahl) repairLines(ahl, this.data.players)
    this.pushNews(
      'contract',
      'Camp breaks — the roster is set',
      `Cut day is done:\n\n• ${notes.join('\n• ')}\n\nOpening night is next. This is your team now.`,
      { teamId: this.userTeamId as string }
    )
    return { ok: true, notes }
  }

  /** Sign a PTO invitee to a one-year, league-minimum deal out of camp. Returns
   *  a failure note (no cap room / roster full) rather than throwing. */
  private signTryout(playerId: string): { ok: boolean; message?: string } {
    const id = asPlayerId(playerId)
    if (!this.faPool.some((f) => (f as string) === playerId)) return { ok: false, message: 'he is no longer available' }
    const player = this.data.players.get(id)
    if (!player) return { ok: false, message: 'unknown player' }
    const salary = 750_000
    const capUsedNow = this.userCapUsed()
    if (capUsedNow + this.userDeadCap + salary > this.userTeam.finances.salaryCap) {
      return { ok: false, message: 'no cap room for even a minimum deal' }
    }
    try {
      signPlayer({ team: this.userTeam, player, salary, years: 1, year: this.year, players: this.data.players })
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'roster rules' }
    }
    this.faPool = this.faPool.filter((f) => (f as string) !== playerId)
    this.lockerArrival(this.userTeamId, id)
    recordAcquisition(this.chronicle, { playerId, teamId: this.userTeamId as string, year: this.year, via: 'signing' })
    return { ok: true }
  }

  /** Simming past cut day: fast-forward any camp days still unplayed (so the
   *  scrimmages and reports exist), then the coach applies his own plan —
   *  waivers and all. */
  autoResolveTrainingCamp(): void {
    if (!this.trainingCamp || this.trainingCamp.resolved) return
    let guard = 0
    while ((this.trainingCamp.campDay ?? 8) < 8 && guard++ < 16) this.advanceTrainingCampDay()
    this.submitTrainingCamp([])
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
        // Season Rhythm M3: camp's battle verdicts become CUT DAY — a staged
        // set of keep/send decisions the GM resolves on the camp screen
        // before opening night. Simming past hands the coach the clipboard.
        const decisions: TrainingCampState['decisions'] = []
        for (const id of split.promoted.slice(0, 6)) {
          const p = this.data.players.get(id)
          if (!p) continue
          decisions.push({
            playerId: id as string,
            name: p.name,
            position: p.position,
            age: p.age,
            current: 'ahl',
            coachPlan: 'nhl',
            waiverRequired: false,
            line: "Won his camp battle — he's making it impossible to send him down.",
            ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
          })
        }
        for (const id of split.demoted.slice(0, 6)) {
          const p = this.data.players.get(id)
          if (!p) continue
          const waiver = this.requiresWaivers(p)
          decisions.push({
            playerId: id as string,
            name: p.name,
            position: p.position,
            age: p.age,
            current: 'nhl',
            coachPlan: 'ahl',
            waiverRequired: waiver,
            line: waiver
              ? 'Lost the numbers game — but he NEEDS WAIVERS to go down. Any club can claim him for nothing.'
              : 'Lost the numbers game. Waiver-exempt — he can develop in the AHL and be recalled any time.',
            ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
          })
        }
        // PTOs (professional tryouts): unsigned veterans brought to camp on
        // tryout deals — depth bodies who must earn a contract. The GM may curate
        // the list (#182); absent a curated list the AGM auto-picks. Only genuine
        // still-available FAs make it (a curated invitee since signed drops out).
        this.stockFreeAgentMarket()
        const faStill = new Set(this.faPool.map((id) => id as string))
        const inviteIds = (this.campPtoInvites ?? this.defaultCampPtoInvites()).filter((id) => faStill.has(id))
        const invitees = inviteIds
          .map((id) => this.data.players.get(asPlayerId(id)))
          .filter((p): p is Player => !!p)
        this.campPtoInvites = undefined // consumed — next offseason starts fresh
        for (const p of invitees) {
          const ovr = ratedOverall(p)
          const worthNhl = ovr >= 73
          decisions.push({
            playerId: p.id as string,
            name: p.name,
            position: p.position,
            age: p.age,
            current: 'ahl', // not on the club — a tryout body fighting for a deal
            coachPlan: worthNhl ? 'nhl' : 'ahl',
            waiverRequired: false,
            tryout: true,
            line: worthNhl
              ? 'In on a tryout and turning heads — the staff think he can still play a role. Worth a contract.'
              : 'In on a tryout as a look. Fine body for camp, but not pushing for a roster spot.',
            ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
          })
        }

        if (decisions.length > 0) {
          this.trainingCamp = { decisions, resolved: false }
          // Training Camp v2: flesh out the week (roster, schedule, box score,
          // reports) + push the rinkside evaluation mail.
          this.buildTrainingCampWeek(decisions)
          this.pushNews(
            'contract',
            'Cut day — camp verdicts are in',
            'Training camp is over and the battles have verdicts. The final roster calls are yours — ' +
            'make them before the opener, or the coach makes them for you.',
            { teamId: this.userTeamId as string }
          )
        }
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
    if (p.age < 24) return 0 // young one-way deals are usually still waiver-exempt
    // Established one-way pros aren't stashed in the AHL over a small ability dip.
    // Experience, cap commitment and what they bring to the room keep them on the
    // big club unless they're genuinely finished — so their camp/roster score sits
    // above a technically-cleaner prospect. Grows with age (harder to move, more
    // to lose) and salary (a core piece, not a tweener). Deliberately large enough
    // that a productive vet outranks a youngster who's only better on paper. #181
    let bonus = 16
    if (p.age >= 28) bonus += 6
    if (p.age >= 32) bonus += 8
    if (p.age >= 35) bonus += 6
    if (p.contract.salary >= 3_000_000) bonus += 6
    if (p.contract.salary >= 6_000_000) bonus += 6
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
      const capUsed = capUsedFor(team, this.data.players)
      if (capUsed + p.contract.salary > team.finances.salaryCap) continue
      // Claim only if he'd be a regular (or close) on this club — bad teams, with
      // the lowest bars and the highest priority, scoop up useful vets first.
      if (ovr < this.orgNhlBar(team, grp) - 2) continue
      // A club at the 23-man limit can still claim, but must conform: send its
      // weakest skater down to the AHL to open a spot (real "claim then conform").
      if (team.roster.length >= ROSTER_HARD_CAP) {
        const ahl = team.affiliateId ? this.data.teams.get(team.affiliateId) : undefined
        if (!ahl) continue // nowhere to demote → can't make room, pass
        const weakest = [...team.roster]
          .map((id) => this.data.players.get(id))
          .filter((pl): pl is Player => !!pl && pl.position !== 'G')
          .sort((a, b) => ratedOverall(a) - ratedOverall(b))[0]
        if (!weakest) continue
        team.roster = team.roster.filter((id) => (id as string) !== (weakest.id as string))
        ahl.roster.push(weakest.id)
      }
      team.roster.push(p.id)
      repairLines(team, this.data.players)
      return team
    }
    return null
  }

  applyCoachRoster(): { promoted: string[]; demoted: string[] } {
    const nhl = this.data.teams.get(this.userTeamId)
    const ahlId = this.userTeam.affiliateId
    const ahl = ahlId ? this.data.teams.get(ahlId as TeamId) : undefined
    if (!nhl || !ahl) return { promoted: [], demoted: [] }

    const grp = (p: Player): 'F' | 'D' | 'G' =>
      p.position === 'G' ? 'G' : p.position === 'D' ? 'D' : 'F'
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
        // Losing a body to a waiver claim can drop the NHL club below the 12F/6D/2G
        // minimum. Backfill from the AHL immediately (only fires when actually short)
        // so the GM is never soft-locked into a manual "ask the coach to set the
        // roster" just to advance past a claim they didn't choose.
        this.emergencyRecalls()
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
    // Living Ledger: demoting a waiver-requiring veteran is a public statement
    // about his standing — his camp responds. (Exempt kids ride the shuttle
    // without drama; that's the job.)
    if (isUser && cleared) this.recordWorldAction('sentDown', playerId, 'open')
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
    const capUsed = this.userCapUsed()
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
    const capUsed = this.userCapUsed()
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

  /** Human label for a compensation pick bundle, e.g. [1,3] -> "a 1st + a 3rd". */
  private compLabel(rounds: number[]): string {
    if (rounds.length === 0) return 'no picks'
    const ord = (r: number): string => (r === 1 ? '1st' : r === 2 ? '2nd' : r === 3 ? '3rd' : `${r}th`)
    return rounds.map((r) => `a ${ord(r)}`).join(' + ')
  }

  /** #168: rival clubs' restricted free agents you can offer-sheet during the
   *  offseason. A one-click overpay is suggested per player, with the pick
   *  compensation you'd owe if his club declines to match. */
  getRfaBoard(): RfaBoardView {
    const os = this.offseason
    // Real NHL: offer sheets can only be tendered once free agency opens (July 1).
    const windowOpen = os?.stage === 'freeAgency'
    const faDay = os?.faDay ?? 0
    const pendingByPid = new Map(this.pendingOfferSheets.map((s) => [s.playerId, s]))
    const rows: RfaTargetView[] = []
    if (windowOpen) {
      for (const tid of this.data.league.teams) {
        if (tid === this.userTeamId) continue
        const team = this.data.teams.get(tid)
        if (!team) continue
        for (const pid of team.roster) {
          const p = this.data.players.get(pid)
          if (!p || contractStatus(p) !== 'RFA' || p.contract.yearsRemaining > 1) continue
          if (ratedOverall(p) < 66) continue
          const ask = askTerms(p, this.year)
          const offerSalary = Math.round(ask.salary * 1.2) // overpay to pry him loose
          const offerYears = Math.max(ask.years, 4)
          const pend = pendingByPid.get(pid as string)
          rows.push({
            ...badge(p, this.fogCtx()),
            teamAbbr: team.abbreviation,
            teamId: tid as string,
            askSalary: ask.salary,
            askYears: ask.years,
            offerSalary,
            offerYears,
            compLabel: this.compLabel(this.offerSheetComp(offerSalary)),
            ...(pend ? { pending: { salary: pend.salary, years: pend.years, daysLeft: Math.max(0, pend.decideDay - faDay) } } : {}),
          })
        }
      }
      rows.sort((a, b) => (b.pending ? 1 : 0) - (a.pending ? 1 : 0) || b.offerSalary - a.offerSalary)
    }
    return { windowOpen, rows: rows.slice(0, 40) }
  }

  /** #183: resolve a compensation round-bundle into concrete draft-pick slots.
   *  Multiple picks of the SAME round come from CONSECUTIVE future drafts — you
   *  can only own one of your own first-rounders per draft, so "two 1sts" means
   *  your 1st next year AND the year after (the real NHL rule). e.g. [1,1,2,3] ->
   *  {y+1,1st} {y+2,1st} {y+1,2nd} {y+1,3rd}. */
  private offerSheetCompSlots(salary: number): Array<{ year: number; round: number }> {
    const seenPerRound = new Map<number, number>()
    const slots: Array<{ year: number; round: number }> = []
    for (const r of this.offerSheetComp(salary)) {
      const k = seenPerRound.get(r) ?? 0
      seenPerRound.set(r, k + 1)
      slots.push({ year: this.year + 1 + k, round: r })
    }
    return slots
  }

  /** #183: which of the compensation picks you don't OWN. Real rule: offer-sheet
   *  compensation must be the offering team's own picks, one per consecutive draft
   *  for repeated rounds — a sheet you can't cover is null and void. Returns the
   *  missing rounds (empty = you own everything needed). */
  private offerSheetOwnPicksMissing(salary: number): number[] {
    const slots = this.offerSheetCompSlots(salary)
    const held = new Map<string, number>() // "year:round" -> count of own picks still held
    for (const pk of this.picks) {
      if ((pk.originalTeamId as string) === (this.userTeamId as string) && (pk.ownerTeamId as string) === (this.userTeamId as string)) {
        const key = `${pk.year}:${pk.round}`
        held.set(key, (held.get(key) ?? 0) + 1)
      }
    }
    const missing: number[] = []
    for (const slot of slots) {
      const key = `${slot.year}:${slot.round}`
      const n = held.get(key) ?? 0
      if (n <= 0) missing.push(slot.round)
      else held.set(key, n - 1)
    }
    return missing
  }

  /** #183: tender an offer sheet to a rival's RFA. Unlike the old instant
   *  resolution, the owner now gets a real match WINDOW (7 days) to decide —
   *  the sheet sits pending and resolves on a later day (resolveOfferSheets),
   *  the same async cadence as a real NHL front office. Offer sheets are a July
   *  (free-agency stage) move. */
  private static readonly OFFER_SHEET_WINDOW = 5 // faDays ≈ the real 7-day match window, compressed
  submitOfferSheet(playerId: string, salary: number, years: number): { ok: boolean; matched: boolean; pending: boolean; message: string } {
    const os = this.offseason
    if (os?.stage !== 'freeAgency') {
      return { ok: false, matched: false, pending: false, message: 'Offer sheets can only be tendered once free agency opens.' }
    }
    const id = asPlayerId(playerId)
    const player = this.data.players.get(id)
    if (!player) return { ok: false, matched: false, pending: false, message: 'Unknown player.' }
    if (contractStatus(player) !== 'RFA') return { ok: false, matched: false, pending: false, message: `${player.name} isn't a restricted free agent.` }
    if (this.pendingOfferSheets.some((s) => s.playerId === playerId)) {
      return { ok: false, matched: false, pending: false, message: `You already have an offer sheet out for ${player.name}.` }
    }
    const owner = [...this.data.teams.values()].find(
      (t) => (t.id as string) !== (this.userTeamId as string) && t.roster.includes(id)
    )
    if (!owner) return { ok: false, matched: false, pending: false, message: 'He is not on a rival roster.' }
    const capUsedNow = this.userCapUsed()
    if (capUsedNow + this.userDeadCap + salary > this.userTeam.finances.salaryCap) {
      return { ok: false, matched: false, pending: false, message: `That offer doesn't fit under your cap.` }
    }
    // Own-picks-only rule: you must hold the compensation picks yourself.
    const missing = this.offerSheetOwnPicksMissing(salary)
    if (missing.length > 0) {
      return { ok: false, matched: false, pending: false, message: `Void — you no longer own ${this.compLabel(missing)} to hand over as compensation.` }
    }
    const decideDay = (os.faDay ?? 0) + Career.OFFER_SHEET_WINDOW
    this.pendingOfferSheets.push({ playerId, ownerTeamId: owner.id as string, salary, years, decideDay })
    this.pushNews(
      'contract',
      `Offer sheet tendered to ${player.name}`,
      `${player.name} has signed your $${(salary / 1e6).toFixed(2)}M × ${years} offer sheet. ${owner.name} now have the ` +
      `7-day match window to match it or let him walk for ${this.compLabel(this.offerSheetComp(salary)) || 'no'} compensation. ` +
      `The clock is ticking.`,
      { playerId, teamId: owner.id as string }
    )
    return { ok: true, matched: false, pending: true, message: `Offer sheet tendered — ${owner.abbreviation} have the match window to decide.` }
  }

  /** #183: resolve any offer sheets whose match window has elapsed. Called on the
   *  free-agency tick. The owner matches (keeps him, you drove the price up) or
   *  declines (he's yours; your own comp picks go to them). Cap-crunched clubs
   *  are forced to fold — realistic: non-matches cluster on teams that can't fit. */
  private resolveOfferSheets(): void {
    const os = this.offseason
    if (os?.stage !== 'freeAgency') { this.pendingOfferSheets = []; return }
    const due = this.pendingOfferSheets.filter((s) => s.decideDay <= os.faDay)
    this.pendingOfferSheets = this.pendingOfferSheets.filter((s) => s.decideDay > os.faDay)
    for (const sheet of due) this.resolveOneOfferSheet(sheet)
  }

  private resolveOneOfferSheet(sheet: { playerId: string; ownerTeamId: string; salary: number; years: number }): void {
    const { playerId, salary, years } = sheet
    const id = asPlayerId(playerId)
    const player = this.data.players.get(id)
    const owner = this.data.teams.get(asTeamId(sheet.ownerTeamId))
    if (!player || !owner || !owner.roster.includes(id)) return // player moved/signed; sheet moot
    const ask = askTerms(player, this.year)
    const ovr = ratedOverall(player)
    const overpay = salary / Math.max(1, ask.salary)
    const ownerCapUsed = owner.roster.reduce((s, rid) => s + (this.data.players.get(rid)?.contract.salary ?? 0), 0)
    const ownerCanFit = ownerCapUsed - player.contract.salary + salary <= owner.finances.salaryCap
    const rng = this.rngFor(8024, this.offseason?.faDay ?? 0, Career.pidNum(playerId))
    // Real-life bias: cap-healthy clubs almost always match a good young player;
    // a steep overpay or a can't-fit cap sheet is what pries him loose.
    let matchProb = 0.6 + (ovr - 70) * 0.03 - (overpay - 1) * 0.7
    if (!ownerCanFit) matchProb -= 0.5
    matchProb = Math.max(0.05, Math.min(0.94, matchProb))
    let matched = ownerCanFit && rng.chance(matchProb)

    if (matched) {
      try {
        signPlayer({ team: owner, player, salary, years, year: this.year, players: this.data.players })
        repairLines(owner, this.data.players)
        this.adjustRelationship(owner.id as string, -3)
        this.pushNews(
          'contract',
          `${owner.abbreviation} match your offer sheet for ${player.name}`,
          `${owner.name} used the full window and matched your $${(salary / 1e6).toFixed(2)}M × ${years} offer sheet. ` +
          `${player.name} stays put — and can't be traded for a year — but you made them pay up.`,
          { playerId, teamId: owner.id as string }
        )
        return
      } catch {
        matched = false // couldn't fit it after all — forced to let him walk
      }
    }

    // Declined (or couldn't match): he joins you; your OWN comp picks go to them.
    owner.roster = owner.roster.filter((x) => x !== id)
    repairLines(owner, this.data.players)
    try {
      signPlayer({ team: this.userTeam, player, salary, years, year: this.year, players: this.data.players })
    } catch {
      owner.roster.push(id) // roll back — cap changed; treat as a match by default
      repairLines(owner, this.data.players)
      this.pushNews('contract', `Offer sheet for ${player.name} lapses`,
        `Your cap sheet shifted while the window ran and the deal no longer fits — ${player.name} stays with ${owner.abbreviation}.`,
        { playerId, teamId: owner.id as string })
      return
    }
    this.lockerArrival(this.userTeamId, id)
    repairLines(this.userTeam, this.data.players)
    const slots = this.offerSheetCompSlots(salary)
    const rounds = slots.map((s) => s.round)
    for (const slot of slots) {
      const own = this.picks.find(
        (pk) => pk.year === slot.year && pk.round === slot.round && (pk.originalTeamId as string) === (this.userTeamId as string) && (pk.ownerTeamId as string) === (this.userTeamId as string)
      )
      if (own) own.ownerTeamId = owner.id
      else this.picks.push({ year: slot.year, round: slot.round, originalTeamId: this.userTeamId, ownerTeamId: owner.id })
    }
    this.adjustRelationship(owner.id as string, -8)
    recordAcquisition(this.chronicle, { playerId, teamId: this.userTeamId as string, year: this.year, via: 'signing' })
    this.pushNews(
      'contract',
      `${player.name} signs your offer sheet!`,
      `${owner.name} declined to match — ${player.name} is yours at $${(salary / 1e6).toFixed(2)}M × ${years}. ` +
      `${rounds.length ? `You surrender ${this.compLabel(rounds)} to ${owner.abbreviation}.` : 'No compensation owed.'}`,
      { playerId, teamId: this.userTeamId as string }
    )
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
        const capUsed = capUsedFor(t, this.data.players)
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
    // The suitor must fit the cap hit AND a roster spot before he can sign — a full
    // or cap-tight club conforms by farming its weakest bodies. This is guarded so
    // signPlayer can never throw over-cap out of step(): if the suitor genuinely
    // can't fit him (cap moved since the sheet was tabled — the crash the user's
    // real save hit at rollover), the sheet is VOIDED and he stays your RFA rather
    // than taking down the whole offseason.
    const suitorFits = (): boolean =>
      suitor.roster.length < ROSTER_HARD_CAP &&
      capUsedFor(suitor, this.data.players) + sheet.salary <= suitor.finances.salaryCap
    for (let guard = 0; !suitorFits() && suitor.affiliateId && guard < 30; guard++) {
      const ahl = this.data.teams.get(suitor.affiliateId)
      if (!ahl) break
      const weakest = [...suitor.roster]
        .map((id) => this.resolve(id))
        .filter((p) => p.position !== 'G')
        .sort((a, b) => ratedOverall(a) - ratedOverall(b))[0]
      if (!weakest) break
      suitor.roster = suitor.roster.filter((id) => (id as string) !== (weakest.id as string))
      ahl.roster.push(weakest.id)
      repairLines(ahl, this.data.players)
    }
    if (!suitorFits()) {
      this.offerSheets = this.offerSheets.filter((s) => s.playerId !== playerId)
      this.pushNews('contract', `${player.name} offer sheet voided`,
        `${suitor.name} could not fit ${player.name} under the cap — the offer sheet is void and he remains your RFA to re-sign.`, { playerId })
      return { ok: false, message: `${suitor.name} couldn't fit ${player.name} under the cap — the sheet is void; he stays your RFA.` }
    }
    // Player leaves the user's org for the rival.
    this.userTeam.roster = this.userTeam.roster.filter((id) => (id as string) !== playerId)
    repairLines(this.userTeam, this.data.players)
    signPlayer({ team: suitor, player, salary: sheet.salary, years: sheet.years, year: this.year, players: this.data.players })
    // Compensation: the rival's own picks come to you — one per consecutive draft
    // for repeated rounds (a club has only one of its own 1st per year).
    const slots = this.offerSheetCompSlots(sheet.salary)
    for (const slot of slots) {
      this.picks.push({ year: slot.year, round: slot.round, originalTeamId: suitor.id, ownerTeamId: this.userTeamId })
    }
    this.resignStatus.delete(asPlayerId(playerId))
    this.offerSheets = this.offerSheets.filter((s) => s.playerId !== playerId)
    // Letting a rival poach your RFA sours the relationship with that front office.
    this.adjustRelationship(suitor.id as string, -12)
    const compStr = slots.length ? slots.map((s) => `R${s.round} (${s.year})`).join(' + ') : 'no compensation (below threshold)'
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
    if (status === undefined) {
      // #15: honor any out-of-contract roster player the snapshot missed, so the
      // re-sign window shown by getOffseason is always actionable.
      const onRoster = this.userTeam.roster.some((r) => (r as string) === playerId)
      if (onRoster && this.resolve(id).contract.yearsRemaining === 0) {
        this.resignStatus.set(id, 'pending')
      } else {
        throw new Error('player is not in your re-sign list')
      }
    }
    const player = this.resolve(id)
    // CBA term ceiling: a club may re-sign its OWN player to 8 years (one more
    // than an outside club could offer).
    if (!Number.isInteger(years) || years < 1 || years > MAX_TERM_RESIGN) {
      return { signed: false, message: `A contract runs 1–${MAX_TERM_RESIGN} years when you re-sign your own player.` }
    }
    const elcReject = this.elcTermRejection(player, salary, years)
    if (elcReject) return elcReject
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

  /**
   * Move a prospect (AHL player or rights-held junior) from one org to another
   * as part of a trade. An AHL affiliate player relocates to the acquiring org's
   * affiliate; a junior whose rights were held just has his rights re-assigned
   * (he keeps playing where he is). Rights always follow the player.
   */
  private moveProspectBetweenOrgs(pid: PlayerId, fromTeamId: TeamId, toTeamId: TeamId): void {
    const p = this.data.players.get(pid)
    if (!p) return
    const from = this.data.teams.get(fromTeamId)
    const to = this.data.teams.get(toTeamId)
    const fromAhl = from?.affiliateId ? this.data.teams.get(from.affiliateId) : undefined
    const wasOnFromAhl = fromAhl?.roster.some((id) => (id as string) === (pid as string)) ?? false
    // Pull him off the buyer's NHL + AHL rosters if he sits on either.
    if (from) from.roster = from.roster.filter((id) => (id as string) !== (pid as string))
    if (fromAhl) fromAhl.roster = fromAhl.roster.filter((id) => (id as string) !== (pid as string))
    // An affiliate player relocates to the acquiring org's affiliate (or NHL if
    // it somehow has none); a rights-only junior keeps his junior club.
    if (wasOnFromAhl) {
      const toAhl = to?.affiliateId ? this.data.teams.get(to.affiliateId) : undefined
      if (toAhl) toAhl.roster.push(pid)
      else if (to) to.roster.push(pid)
    }
    p.rightsTeamId = toTeamId
  }

  /** Entry-level ceiling check shared by the sign/re-sign paths: an ELC-eligible
   *  player can't be given more than the ELC base salary or 3 years. Returns a
   *  rejection when the offer breaks the CBA, else null. */
  private elcTermRejection(
    player: Player,
    salary: number,
    years: number,
  ): { signed: false; message: string } | null {
    if (contractStatus(player) !== 'ELC') return null
    if (salary > ELC_MAX_SALARY) {
      return { signed: false, message: `Entry-level contracts are capped at $${(ELC_MAX_SALARY / 1e6).toFixed(2)}M base salary.` }
    }
    if (years > ELC_MAX_TERM) {
      return { signed: false, message: `An entry-level contract runs at most ${ELC_MAX_TERM} years.` }
    }
    return null
  }

  /** Standard Player Contracts an organization currently holds — NHL roster +
   *  AHL affiliate + any signed prospects whose rights it holds (juniors, etc.).
   *  The real NHL caps this at 50 (ORG_CONTRACT_LIMIT). */
  private orgContractCount(teamId: TeamId): number {
    const team = this.data.teams.get(teamId)
    if (!team) return 0
    const ids = new Set<string>()
    for (const pid of team.roster) ids.add(pid as string)
    if (team.affiliateId) {
      for (const pid of this.data.teams.get(team.affiliateId)?.roster ?? []) ids.add(pid as string)
    }
    for (const p of this.data.players.values()) {
      if ((p.rightsTeamId as string | undefined) === (teamId as string) && p.contract.yearsRemaining > 0) {
        ids.add(p.id as string)
      }
    }
    return ids.size
  }

  signFreeAgent(playerId: string, salary: number, years: number): { signed: boolean; message: string } {
    // The market is open year-round; the roster only freezes in the playoffs.
    if (this.phase === 'playoffs') throw new Error('the roster is frozen during the playoffs')
    const os = this.offseason
    const id = asPlayerId(playerId)
    if (!this.faPool.some((f) => (f as string) === playerId)) {
      throw new Error('player is not a free agent')
    }
    const player = this.resolve(id)
    // 50-contract reserve list: a NEW contract can't push the org past the limit.
    // (Re-signing your own player doesn't add one — that path isn't gated.)
    if (this.orgContractCount(this.userTeamId) >= ORG_CONTRACT_LIMIT) {
      return {
        signed: false,
        message: `Your organization is at the ${ORG_CONTRACT_LIMIT}-contract limit. Move or release a contract before you can sign another player.`,
      }
    }
    // CBA term ceiling: an outside UFA can be signed for at most 7 years (only
    // his own club could have gone to 8).
    if (!Number.isInteger(years) || years < 1 || years > MAX_TERM_UFA) {
      return {
        signed: false,
        message: `A free-agent deal runs 1–${MAX_TERM_UFA} years — only a player's own club can offer the ${MAX_TERM_RESIGN}th year.`,
      }
    }
    const elcReject = this.elcTermRejection(this.resolve(id), salary, years)
    if (elcReject) return elcReject
    // Dead cap from buyouts is real: the signing must fit under ceiling MINUS
    // the dead charge, or the buyout was free money.
    const capUsedNow = this.userCapUsed()
    if (capUsedNow + this.userDeadCap + salary > this.userTeam.finances.salaryCap) {
      return {
        signed: false,
        message: `That contract doesn't fit under the cap once your $${(this.userDeadCap / 1e6).toFixed(2)}M in buyout dead cap is counted.`,
      }
    }
    const ask = askTerms(player, this.year)
    const rng = this.rngFor(8007, os?.faDay ?? this.currentDay, Number((playerId.match(/\d+/) ?? ['0'])[0]))
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
    // A signing the fanbase actually notices gets the coach on record (the
    // 'signing' pool sat authored-but-dark). Depth adds stay news-only.
    if (ratedOverall(player) >= 74 || salary >= 3_000_000) {
      this.pushCoachQuote('signing', { playerName: player.name }, this.seed ^ Career.pidNum(playerId) ^ (this.year * 7))
    }
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

  /* ───────────────────── free-agency hub (DEPTH 2) ─────────────────────── */

  /**
   * Keep a standing pool of unsigned players on the market at all times. In a
   * real NHL summer ~10-15% of the league turns over, and there's always a
   * pool of unsigned journeymen through the season — but the imported DB has
   * everyone signed with no natural expiries. So we source the class honestly
   * from rosters: every AI club sheds surplus depth (bodies beyond a healthy
   * 23) plus aging one-way non-tenders it wouldn't re-sign, topping the pool up
   * to a floor. Stars are never dumped; no club is gutted below 20. Idempotent
   * (already-released players are skipped), so it's safe to call repeatedly.
   */
  private stockFreeAgentMarket(): number {
    const KEEP = 23 // healthy NHL roster; bodies beyond this are surplus
    const FLOOR = 20 // never strip a club below this
    const POOL_FLOOR = 45 // aim for a market of at least this many names
    const inPool = new Set(this.faPool.map((id) => id as string))
    let added = 0
    // Weakest-first across the league so the floor is filled with true depth.
    const clubs = [...this.data.teams.values()].filter(
      (t) => t.tier !== 'ahl' && t.tier !== 'world' && t.id !== this.userTeamId
    )
    const release = (team: Team, cut: Player): void => {
      team.roster = team.roster.filter((id) => id !== cut.id)
      cut.contract.yearsRemaining = 0
      this.faPool.push(cut.id)
      inPool.add(cut.id as string)
      added++
      this.lockerDeparture(team.id, cut.id)
      chronicleEvent(this.chronicle, {
        year: this.year, day: 0, kind: 'release',
        teamIds: [team.id as string], playerIds: [cut.id as string],
        headline: `${team.abbreviation} release ${cut.name} into free agency`,
      })
    }
    // 1) Bloated rosters shed their SURPLUS (bodies beyond a healthy 23) — this
    //    handles imported DBs carrying 26-30 per club; it's 0 for tight rosters.
    for (const team of clubs) {
      const surplus = Math.max(0, team.roster.length - KEEP)
      if (surplus <= 0) continue
      const sheddable = team.roster
        .map((id) => this.data.players.get(id))
        .filter((p): p is Player => !!p && p.contract.twoWay === false && p.age >= 27 && ratedOverall(p) < 80 && !inPool.has(p.id as string))
        .sort((a, b) => ratedOverall(a) - ratedOverall(b))
      for (let i = 0; i < surplus && i < sheddable.length; i++) {
        if (team.roster.length <= FLOOR) break
        release(team, sheddable[i]!)
      }
    }
    // 2) Floor-fill: if the market is still thin, shed the weakest aging one-way
    //    depth across the league until it reaches the floor (never below FLOOR
    //    per club). Guarantees a deep board even when nobody's contract expires.
    if (this.faPool.length < POOL_FLOOR) {
      const extra = clubs
        .flatMap((t) => t.roster.map((id) => ({ t, p: this.data.players.get(id) })))
        .filter((x): x is { t: Team; p: Player } => !!x.p && x.p.contract.twoWay === false && x.p.age >= 28 && ratedOverall(x.p) < 74 && !inPool.has(x.p.id as string))
        .sort((a, b) => ratedOverall(a.p) - ratedOverall(b.p))
      for (const { t, p } of extra) {
        if (this.faPool.length >= POOL_FLOOR) break
        if (t.roster.length <= FLOOR) continue
        release(t, p)
      }
    }
    return added
  }

  toggleFaShortlist(playerId: string): { shortlisted: boolean } {
    if (this.faShortlist.has(playerId)) {
      this.faShortlist.delete(playerId)
      return { shortlisted: false }
    }
    this.faShortlist.add(playerId)
    return { shortlisted: true }
  }

  /** A free agent's interest in YOUR club — the market is two-way. Derived
   *  from real state (roster hole, cap fit, contender status) plus a stable
   *  per-player lean, so a fourth-liner returns your call and a star on a
   *  contender-chaser's list doesn't. */
  private faInterestFor(p: Player): { interest: 'keen' | 'warm' | 'cold'; note: string } {
    const ask = askTerms(p, this.year)
    const grp = p.position === 'G' ? 'G' : p.position === 'D' ? 'D' : 'F'
    const targets: Record<string, number> = { F: 14, D: 7, G: 2 }
    let secure = 0
    for (const id of this.userTeam.roster) {
      const r = this.data.players.get(id)
      if (!r || r.contract.yearsRemaining <= 0) continue
      const g = r.position === 'G' ? 'G' : r.position === 'D' ? 'D' : 'F'
      if (g === grp) secure++
    }
    const holeAtPosition = secure < targets[grp]!
    const capUsedNow = this.userCapUsed()
    const capFits = capUsedNow + this.userDeadCap + ask.salary <= this.userTeam.finances.salaryCap
    const contender = (expectedRankOf(this.expectationsState, this.userTeamId as string) ?? 16) <= 8
    const w = priorityWeights(p)

    let score = 25
    if (holeAtPosition) score += 30
    if (capFits) score += 20
    else score -= 25
    if (contender) score += 15
    // Stable personal lean (family/geography flavor the fog never fully explains).
    score += Math.round((Number((p.id.match(/\d+/) ?? ['0'])[0]) % 31) - 15)

    const interest = score >= 60 ? 'keen' : score >= 35 ? 'warm' : 'cold'
    const note = !capFits
      ? 'His agent knows your cap sheet — the money is not there today.'
      : holeAtPosition
        ? `He sees the open ${grp === 'G' ? 'crease' : grp === 'D' ? 'pairing' : 'forward slot'} — a real role is on offer.`
        : contender && w.money < 0.35
          ? 'A contender pick — winning moves him more than the last dollar.'
          : interest === 'cold'
            ? 'His camp is listening elsewhere first.'
            : 'Open to the conversation if the terms respect the market.'
    return { interest, note }
  }

  /** The market, triaged: everything a GM filters and decides by. */
  /** Each NHL rival club's positional depth + cap room — the inputs for who
   *  circles a free agent. league.teams IS the NHL set (AHL/junior/European
   *  teams live in competitions), so membership is the reliable filter. */
  private faAiCtx(): Array<{ abbr: string; idNum: number; capRoom: number; counts: Record<'F' | 'D' | 'G', number> }> {
    const grpOf = (p: Player): 'F' | 'D' | 'G' => (p.position === 'G' ? 'G' : p.position === 'D' ? 'D' : 'F')
    return this.data.league.teams
      .filter((tid) => tid !== this.userTeamId)
      .map((tid) => this.data.teams.get(tid))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map((t) => {
        const capRoom = t.finances.salaryCap - t.roster.reduce((s, id) => s + (this.data.players.get(id)?.contract.salary ?? 0), 0)
        const counts: Record<'F' | 'D' | 'G', number> = { F: 0, D: 0, G: 0 }
        for (const id of t.roster) {
          const r = this.data.players.get(id)
          if (r && r.contract.yearsRemaining > 0) counts[grpOf(r)]++
        }
        return { abbr: t.abbreviation, idNum: Career.pidNum(t.id as string), capRoom, counts }
      })
  }

  /** The rival clubs circling a free agent (abbreviations). Suitor appetite
   *  scales with talent — a star draws most of the league, a depth body a
   *  handful; cap room only orders the list (AI payrolls aren't yet cap-real, #176). */
  private faRivalClubs(p: Player, aiCtx = this.faAiCtx()): string[] {
    const rivalTargets: Record<'F' | 'D' | 'G', number> = { F: 13, D: 7, G: 2 }
    const g: 'F' | 'D' | 'G' = p.position === 'G' ? 'G' : p.position === 'D' ? 'D' : 'F'
    const ovr = ratedOverall(p)
    const appetite = ovr >= 80 ? 7 : ovr >= 74 ? 4 : ovr >= 68 ? 3 : 2 // out of 12
    return aiCtx
      .filter((c) => (Career.pidNum(p.id as string) ^ c.idNum) % 12 < appetite)
      .sort(
        (a, b) =>
          (a.counts[g] >= rivalTargets[g] ? 1 : 0) - (b.counts[g] >= rivalTargets[g] ? 1 : 0) ||
          b.capRoom - a.capRoom
      )
      .map((c) => c.abbr)
  }

  /** Ask a free agent's agent what the market looks like. The agent talks about
   *  60% of the time (deterministic per player + market day) and plays it close
   *  the rest — you can't always get a straight answer. Read-only intel. */
  askFaAgent(playerId: string): { text: string } {
    if (!this.faPool.some((f) => (f as string) === playerId)) {
      return { text: "He's not on the open market." }
    }
    const p = this.resolve(asPlayerId(playerId))
    const agent = agentFor(p)
    const faDay = this.offseason?.faDay ?? this.currentDay
    // Deterministic "will he talk?" — same player + market day = same answer.
    const rng = this.rngFor(8021, faDay, Career.pidNum(playerId))
    if (rng.chance(0.4)) {
      const deflections = [
        `${agent.name} plays it close: "My client's talking to a few people. I'm not going to tell you who — that's how this works."`,
        `${agent.name} smiles: "You know I can't get into who else has called. Put your best number on the table and we'll talk."`,
        `${agent.name} won't bite: "There's interest. Real interest. That's all you're getting from me today."`,
      ]
      return { text: rng.pick(deflections) }
    }
    const rivals = this.faRivalClubs(p)
    const { interest } = this.faInterestFor(p)
    const leverage =
      interest === 'keen'
        ? 'Between us, he likes your room — a fair offer gets it done.'
        : interest === 'warm'
          ? "He's listening, but the terms have to respect the market."
          : "I'll be honest, he's leaning elsewhere — you'd have to overpay to turn his head."
    if (rivals.length === 0) {
      return { text: `${agent.name}: "Quiet so far — nobody else is really pushing. ${leverage}"` }
    }
    const shown = rivals.slice(0, 4).join(', ')
    const more = rivals.length > 4 ? ` and ${rivals.length - 4} more` : ''
    return {
      text: `${agent.name}, off the record: "${rivals.length} club${rivals.length > 1 ? 's have' : ' has'} called — ${shown}${more}. ${leverage}"`,
    }
  }

  /** #167: table a standing offer to a free agent. He does NOT sign on the
   *  spot — he decides on his own day (a few out), weighing your money against
   *  the rival field. Free-agency-window only; in-season, open talks to sign now. */
  submitFaOffer(playerId: string, salary: number, years: number): { ok: boolean; message: string } {
    const os = this.offseason
    if (os?.stage !== 'freeAgency') {
      return { ok: false, message: 'Standing offers are a free-agency thing — open talks to sign him directly.' }
    }
    if (!this.faPool.some((f) => (f as string) === playerId)) {
      return { ok: false, message: 'He is not a free agent.' }
    }
    const player = this.resolve(asPlayerId(playerId))
    const capUsedNow = this.userCapUsed()
    if (capUsedNow + this.userDeadCap + salary > this.userTeam.finances.salaryCap) {
      return { ok: false, message: `That doesn't fit under the cap once your $${(this.userDeadCap / 1e6).toFixed(2)}M in dead cap is counted.` }
    }
    const rivals = this.faRivalClubs(player).length
    const rng = this.rngFor(8022, os.faDay, Career.pidNum(playerId))
    const decideDay = os.faDay + 2 + rng.range(0, 2) // he sleeps on it a few days
    this.faPendingOffers = this.faPendingOffers.filter((o) => o.playerId !== playerId)
    this.faPendingOffers.push({ playerId, salary, years, decideDay })
    const agent = agentFor(player)
    this.pushNews(
      'contract',
      `Offer tabled to ${player.name}`,
      `You've put $${(salary / 1e6).toFixed(2)}M × ${years} on the table for ${player.name}. ` +
      `${agent.name} says his client will weigh it${rivals > 0 ? ` against ${rivals} other club${rivals > 1 ? 's' : ''}` : ''} and get back to you.`,
      { playerId, teamId: this.userTeamId as string }
    )
    return { ok: true, message: `Offer tabled — ${player.name}'s camp decides by free-agency day ${decideDay}.` }
  }

  /** Resolve any standing offers whose decision day has arrived: the player
   *  signs with you, gets sniped by a rival, or passes for more. Runs each
   *  free-agency day BEFORE the AI market so your offers get first look. */
  private resolveFaOffers(): void {
    const os = this.offseason
    if (os?.stage !== 'freeAgency') { this.faPendingOffers = []; return }
    const due = this.faPendingOffers.filter((o) => o.decideDay <= os.faDay)
    this.faPendingOffers = this.faPendingOffers.filter((o) => o.decideDay > os.faDay)
    for (const offer of due) {
      const pid = offer.playerId
      if (!this.faPool.some((f) => (f as string) === pid)) {
        const gone = this.data.players.get(asPlayerId(pid))
        this.pushNews(
          'contract',
          `Missed on ${gone?.name ?? 'a target'}`,
          `While your offer sat on his desk, ${gone?.name ?? 'he'} signed elsewhere. The market doesn't wait.`,
          gone ? { playerId: pid } : {}
        )
        continue
      }
      const player = this.resolve(asPlayerId(pid))
      const ask = askTerms(player, this.year)
      const rng = this.rngFor(8023, os.faDay, Career.pidNum(pid))
      const acceptable = offerAcceptable(player, { salary: offer.salary, years: offer.years }, ask, rng)
      const rivals = this.faRivalClubs(player).length
      const generosity = offer.salary / Math.max(1, ask.salary)
      // Even a fair offer can lose to a hot market — unless you paid up.
      const sniped = acceptable && rng.chance(Math.max(0, Math.min(0.5, rivals * 0.07 - (generosity - 1) * 0.6)))
      if (acceptable && !sniped) {
        const capUsedNow = this.userCapUsed()
        if (capUsedNow + this.userDeadCap + offer.salary > this.userTeam.finances.salaryCap) {
          this.pushNews('contract', `${player.name} would sign — but the cap won't fit it now`,
            `${player.name} was ready to take your offer, but your cap sheet no longer fits the deal, so it lapses.`, { playerId: pid })
          continue
        }
        // Cap space isn't the only limit — signPlayer also refuses a full roster,
        // and an unguarded throw here abandons the whole offseason. Lapse the
        // offer the same way a cap squeeze does.
        if (!this.userTeam.roster.includes(asPlayerId(pid)) && this.userTeam.roster.length >= MAX_ROSTER_SIZE) {
          this.pushNews('contract', `${player.name} would sign — but you have no roster spot`,
            `${player.name} was ready to take your offer, but your roster is full at ${MAX_ROSTER_SIZE}. The offer lapses unless you clear a spot.`, { playerId: pid })
          continue
        }
        signPlayer({ team: this.userTeam, player, salary: offer.salary, years: offer.years, year: this.year, players: this.data.players })
        this.faPool = this.faPool.filter((f) => (f as string) !== pid)
        this.lockerArrival(this.userTeamId, asPlayerId(pid))
        repairLines(this.userTeam, this.data.players)
        recordAcquisition(this.chronicle, { playerId: pid, teamId: this.userTeamId as string, year: this.year, via: 'signing' })
        this.faShortlist.delete(pid)
        this.pushNews('contract', `${player.name} signs with you!`,
          `He took your offer — $${(offer.salary / 1e6).toFixed(2)}M × ${offer.years} years. Welcome aboard.`,
          { playerId: pid, teamId: this.userTeamId as string })
      } else {
        const reason = sniped
          ? 'a rival matched your money and he preferred their fit'
          : `he's holding out for more — around $${(ask.salary / 1e6).toFixed(2)}M × ${ask.years}`
        this.pushNews('contract', `${player.name} passes on your offer`,
          `${player.name}'s camp came back: ${reason}. He's still on the market — sweeten it or move on.`,
          { playerId: pid, teamId: this.userTeamId as string })
      }
    }
  }

  /** #164: where a standing offer sits vs the field — mirrors the same factors
   *  resolveFaOffers weighs (his ask, your generosity, the rival count). Honest,
   *  not fabricated rival bids: 'leading' = clear front-runner, 'competitive' =
   *  fair money a hot market could still snipe, 'trailing' = below his ask. */
  private faOfferStanding(
    _player: Player,
    offer: { salary: number; years: number },
    ask: { salary: number; years: number },
    rivalCount: number,
  ): { standing: 'leading' | 'competitive' | 'trailing'; note: string } {
    const generosity = offer.salary / Math.max(1, ask.salary)
    const snipeRisk = Math.max(0, Math.min(0.5, rivalCount * 0.07 - (generosity - 1) * 0.6))
    if (generosity < 0.95) {
      return {
        standing: 'trailing',
        note: rivalCount > 0
          ? `Below his ask, with ${rivalCount} rival${rivalCount > 1 ? 's' : ''} circling — he'll likely hold out for more.`
          : `Below his ask — he may wait for a stronger number.`,
      }
    }
    if (snipeRisk >= 0.25) {
      return {
        standing: 'competitive',
        note: `Fair money, but ${rivalCount} club${rivalCount > 1 ? 's are' : ' is'} pushing — a rival could still match and win the fit.`,
      }
    }
    return {
      standing: 'leading',
      note: rivalCount > 0
        ? `You're out in front — strong money against a ${rivalCount}-club field.`
        : `You're the clear front-runner; nobody else is really pushing.`,
    }
  }

  getFaHub(): FaHubView {
    const os = this.offseason
    const faDay = os?.faDay ?? 0
    const capUsedNow = this.userCapUsed()

    // The honest clock: aiFreeAgencyDay signs rank r on effective day 1+r/3,
    // and the AI runs 2 days behind the user (the head start).
    const pool = this.faPool
      .map((id) => this.resolve(id))
      .sort((a, b) => ratedOverall(b) - ratedOverall(a) || ((a.id as string) < (b.id as string) ? -1 : 1))

    const aiCtx = this.faAiCtx()

    // Unsigned free agents soften their demands as the summer drags on — the same
    // decay the negotiation engine applies, surfaced so the market visibly cools
    // (and the displayed ask matches what he'll actually take).
    const decay = faAskDecay(faDay)
    const rows = pool.map((p, rank) => {
      const rawAsk = askTerms(p, this.year)
      const ask = { salary: Math.round((rawAsk.salary * decay) / 25000) * 25000, years: rawAsk.years }
      const agent = agentFor(p)
      const { interest, note } = this.faInterestFor(p)
      const decideDay = 3 + Math.floor(rank / 3) // AI delay (2) + decision day (1 + rank/3)
      const session = this.negotiations.get(p.id as string)
      const rivals = this.faRivalClubs(p, aiCtx)
      const pending = this.faPendingOffers.find((o) => o.playerId === (p.id as string))
      const pendingStanding = pending ? this.faOfferStanding(p, pending, ask, rivals.length) : undefined
      return {
        ...badge(p),
        ...(pending && pendingStanding
          ? { pendingOffer: { salary: pending.salary, years: pending.years, decidesInDays: Math.max(0, pending.decideDay - faDay), standing: pendingStanding.standing, standingNote: pendingStanding.note } }
          : {}),
        askSalary: ask.salary,
        askYears: ask.years,
        ...(decay < 0.97 ? { askSoftened: true } : {}),
        decidesInDays: Math.max(0, decideDay - faDay),
        agentName: agent.name,
        interest,
        interestNote: note,
        wants: priorityHints(p)[0] ?? '',
        hot: this.marketHeatFor(p) > 0.35 || rivals.length >= 3,
        shortlisted: this.faShortlist.has(p.id as string),
        inTalks: session !== undefined && session.year === this.year && session.status !== 'signed' && session.status !== 'walked',
        ...(rivals.length > 0 ? { rivals } : {}),
      }
    })

    return {
      rows,
      faDay,
      capSpace: this.userTeam.finances.salaryCap - capUsedNow - this.userDeadCap,
      windowOpen: os?.stage === 'freeAgency',
    }
  }

  /* ─────────────── contract negotiation sessions (DEPTH 1) ─────────────── */

  /** Can talks be held with this player right now, and in what capacity? */
  private negotiationKindFor(playerId: string): 'resign' | 'freeAgent' | null {
    // The FA market is open year-round: any club-less player can be signed
    // whenever the roster isn't frozen (offseason, or regular season). Re-sign
    // talks with your own expiring RFAs are the offseason resign stage.
    const os = this.offseason
    if (os?.stage === 'resign' && this.resignStatus.get(asPlayerId(playerId)) === 'pending') return 'resign'
    if (this.phase !== 'playoffs' && this.faPool.some((f) => (f as string) === playerId)) return 'freeAgent'
    return null
  }

  /** Signed NHL contracts the agent can argue from — real deals, never invented. */
  private comparablePool(): Comparable[] {
    const pool: Comparable[] = []
    for (const team of this.data.teams.values()) {
      if (team.tier === 'ahl') continue
      for (const id of team.roster) {
        const p = this.data.players.get(id)
        if (!p || p.contract.yearsRemaining <= 0 || p.contract.salary < 900_000) continue
        pool.push({
          name: p.name,
          teamAbbr: team.abbreviation,
          overall: ratedOverall(p),
          age: p.age,
          salary: p.contract.salary,
          years: p.contract.yearsRemaining,
        })
      }
    }
    return pool
  }

  /** Rival appetite for a free agent, 0–1 — hot names negotiate from strength. */
  private marketHeatFor(player: Player): number {
    const ovr = ratedOverall(player)
    return Math.max(0, Math.min(1, (ovr - 74) / 18))
  }

  private buildNegotiationView(state: NegotiationState): NegotiationView {
    const player = this.resolve(asPlayerId(state.playerId))
    const agent = agentFor(player)
    const comps = findComparables(player, this.comparablePool())
    const hints = priorityHints(player)
    const capUsedNow = this.userCapUsed()
    const temperature =
      state.patience > 65 ? 'warm' : state.patience > 40 ? 'guarded' : state.patience > 15 ? 'testy' : 'hostile'
    const agentRel = relationOf(this.agentRapport, agent.name)
    return {
      player: badge(player),
      kind: state.kind,
      status: state.status,
      rightsLabel: contractStatus(player),
      currentSalary: player.contract.salary,
      agentName: agent.name,
      agentStyle: agent.style,
      agentStanding: standingOf(agentRel.rapport),
      agentRapportNote: agentRapportNote(agentRel),
      agentDeals: agentRel.deals,
      askSalary: state.ask.salary,
      askYears: state.ask.years,
      askBonusPct: state.ask.signingBonusPct,
      askClause: state.ask.clause,
      temperature,
      openingLines: openingLines(player, state, { comparables: comps }),
      rounds: state.rounds.map((r) => ({
        offerSalary: r.offer.salary,
        offerYears: r.offer.years,
        offerBonusPct: r.offer.signingBonusPct,
        offerClause: r.offer.clause,
        verdict: r.verdict,
        agentLines: r.agentLines,
      })),
      comparables: comps,
      revealedHints: state.revealedHints.map((i) => hints[i]).filter((h): h is string => !!h),
      capSpace: this.userTeam.finances.salaryCap - capUsedNow - this.userDeadCap,
      ...(state.status === 'paused'
        ? { pausedNote: 'His camp has pulled out of talks. They are not returning your calls this window.' }
        : {}),
    }
  }

  /** Open (or resume) a negotiation session with an eligible player. */
  startNegotiation(playerId: string): NegotiationView {
    const kind = this.negotiationKindFor(playerId)
    const existing = this.negotiations.get(playerId)
    // Stale sessions from another year or another capacity are discarded.
    if (existing && (existing.year !== this.year || (kind && existing.kind !== kind && existing.status !== 'open'))) {
      this.negotiations.delete(playerId)
    }
    const live = this.negotiations.get(playerId)
    if (live && live.kind === (kind ?? live.kind)) return this.buildNegotiationView(live)
    if (!kind) throw new Error('this player is not available for contract talks right now')

    const player = this.resolve(asPlayerId(playerId))
    const heat = kind === 'freeAgent' ? this.marketHeatFor(player) : 0
    // A free agent still on the market softens his ask the longer he waits, so a
    // GM can hold out on a player who is overpricing himself. Only in the FA window.
    const faDecay = kind === 'freeAgent' ? faAskDecay(this.offseason?.faDay ?? 0) : 1
    // Living Ledger: what you did to this man follows him to the table. Known
    // residue (shopped/scratched/demoted, this year or last) hardens the ask,
    // shortens patience, and the agent SAYS why — the receipt is explicit.
    const grudge = grudgeContext(this.residueFlags, playerId, this.year)
    const state = openNegotiation({
      player,
      year: this.year,
      kind,
      marketHeat: (1 + heat * 0.08) * faDecay * grudge.askMult,
      rapportTilt: rapportTilt(this.agentRapport, agentFor(player).name),
    })
    if (grudge.patienceHit > 0) {
      state.patience = Math.max(15, state.patience - grudge.patienceHit)
      state.revealedHints.push(...grudge.lines)
    }
    // A camp burned earlier this summer (paused/walked re-sign talks) opens colder.
    if (existing && (existing.status === 'paused' || existing.status === 'walked')) {
      state.patience = Math.max(20, state.patience - 20)
    }
    this.negotiations.set(playerId, state)
    return this.buildNegotiationView(state)
  }

  getNegotiation(playerId: string): NegotiationView | null {
    const state = this.negotiations.get(playerId)
    if (!state || state.year !== this.year) return null
    return this.buildNegotiationView(state)
  }

  /** One round at the table. On acceptance the contract is executed here. */
  submitNegotiationOffer(
    playerId: string,
    offer: ContractOffer
  ): { view: NegotiationView; signed: boolean; message: string } {
    const state = this.negotiations.get(playerId)
    if (!state || state.year !== this.year) throw new Error('no open negotiation with this player')
    if (state.status !== 'open') {
      return {
        view: this.buildNegotiationView(state),
        signed: state.status === 'signed',
        message:
          state.status === 'signed'
            ? 'The deal is already done.'
            : 'Talks are off — his camp is not at the table.',
      }
    }
    const kind = this.negotiationKindFor(playerId)
    if (!kind) {
      // The market moved while you deliberated (AI signing, stage change).
      state.status = 'walked'
      return {
        view: this.buildNegotiationView(state),
        signed: false,
        message: 'He is off the board — the market moved while you deliberated.',
      }
    }

    // Cap sanity BEFORE the round: an offer you cannot execute is not an offer.
    const player = this.resolve(asPlayerId(playerId))
    const capUsedNow = this.userCapUsed()
    const replacing = kind === 'resign' ? player.contract.salary : 0
    if (capUsedNow - replacing + this.userDeadCap + offer.salary > this.userTeam.finances.salaryCap) {
      return {
        view: this.buildNegotiationView(state),
        signed: false,
        message: 'That offer does not fit under your cap — clear space before you table it.',
      }
    }

    const rng = this.rngFor(8020, state.rounds.length, Career.pidNum(playerId))
    const comps = findComparables(player, this.comparablePool())
    const agentName = agentFor(player).name
    const result = evaluateRound(state, player, offer, {
      rng,
      comparables: comps,
      marketHeat: kind === 'freeAgent' ? this.marketHeatFor(player) : 0,
      teamName: this.userTeam.name,
      rapportTilt: rapportTilt(this.agentRapport, agentName),
    })
    state.rounds.push(result.round)
    state.ask = result.ask
    state.patience = result.patience
    state.status = result.status
    state.revealedHints = result.revealedHints

    // A leaker's jab becomes a real feed post — the conversation touches the world.
    if (result.round.agentLines.some((l) => l.startsWith('(Within the hour'))) {
      const author = FEED_AUTHORS['insider']
      this.feedPosts.unshift({
        id: `fp${this.feedCounter++}`,
        day: Math.max(0, this.currentDay),
        year: this.year,
        category: 'league',
        headline: `@${author?.handle ?? 'insider'}`,
        body: `Talks between ${this.userTeam.abbreviation} and ${player.name}'s camp are "not close," per a source. The ask: north of $${(state.ask.salary / 1e6).toFixed(1)}M a year.`,
        read: true,
        playerId,
        channel: 'feed',
        authorId: 'insider',
        salience: 62,
      })
    }

    if (result.status === 'signed') {
      // Getting a deal done builds trust with the agent (a fair deal more than a
      // lowball); this rapport shapes future negotiations with all his clients.
      applyDealOutcome(
        this.agentRapport,
        agentName,
        { kind: 'signed', askSalary: state.openingAsk.salary, finalSalary: offer.salary },
        this.year
      )
      this.commitNegotiatedContract(player, offer, kind)
      return {
        view: this.buildNegotiationView(state),
        signed: true,
        message: `${player.name} signs — $${(offer.salary / 1e6).toFixed(2)}M × ${offer.years} years.`,
      }
    }
    if (result.status === 'walked') {
      applyDealOutcome(this.agentRapport, agentName, { kind: 'walked' }, this.year)
      if (kind === 'resign') this.resignStatus.set(asPlayerId(playerId), 'walked')
      return {
        view: this.buildNegotiationView(state),
        signed: false,
        message: `${player.name}'s camp has walked away from the table.`,
      }
    }
    if (result.status === 'paused') {
      applyDealOutcome(this.agentRapport, agentName, { kind: 'paused' }, this.year)
      return {
        view: this.buildNegotiationView(state),
        signed: false,
        message: 'His agent has pulled out of talks for now.',
      }
    }
    return { view: this.buildNegotiationView(state), signed: false, message: 'The talks continue.' }
  }

  /** Execute a negotiated deal: sign, stamp clause/bonus structure, tell the world. */
  private commitNegotiatedContract(player: Player, offer: ContractOffer, kind: 'resign' | 'freeAgent'): void {
    const playerId = player.id as string
    signPlayer({
      team: this.userTeam,
      player,
      salary: offer.salary,
      years: offer.years,
      year: this.year,
      players: this.data.players,
    })
    // Structure the deal beyond salary×years (additive contract fields).
    player.contract.noTradeClause = offer.clause !== 'none'
    player.contract.clause = offer.clause
    if (offer.signingBonusPct > 0) player.contract.signingBonusPct = offer.signingBonusPct
    if (offer.twoWay) player.contract.twoWay = true

    const structure: string[] = []
    if (offer.signingBonusPct > 0) structure.push(`${offer.signingBonusPct}% signing bonus`)
    if (offer.clause === 'full') structure.push('full no-move clause')
    if (offer.clause === 'modified') structure.push('modified no-trade clause')
    const structureStr = structure.length > 0 ? ` Structure: ${structure.join(', ')}.` : ''

    if (kind === 'resign') {
      this.resignStatus.set(asPlayerId(playerId), 'signed')
      this.pushNews(
        'contract',
        `${player.name} re-signs`,
        `${player.name} stays for $${(offer.salary / 1e6).toFixed(2)}M × ${offer.years} years, negotiated across ${(this.negotiations.get(playerId)?.rounds.length ?? 1)} rounds with ${agentFor(player).name}.${structureStr}`,
        { playerId }
      )
    } else {
      this.faPool = this.faPool.filter((f) => (f as string) !== playerId)
      this.lockerArrival(this.userTeamId, asPlayerId(playerId))
      repairLines(this.userTeam, this.data.players)
      recordAcquisition(this.chronicle, {
        playerId, teamId: this.userTeamId as string, year: this.year, via: 'signing',
      })
      chronicleEvent(this.chronicle, {
        year: this.year, day: 0, kind: 'signing',
        teamIds: [this.userTeamId as string], playerIds: [playerId],
        headline: `${this.userTeam.abbreviation} sign ${player.position} ${player.name} ($${(offer.salary / 1e6).toFixed(1)}M × ${offer.years}y)`,
        details: { salary: offer.salary, years: offer.years },
        userInvolved: true,
      })
      this.pushNews(
        'contract',
        `${player.name} signs with ${this.userTeam.abbreviation}`,
        `Deal done at the table: $${(offer.salary / 1e6).toFixed(2)}M × ${offer.years} years.${structureStr}`,
        { playerId }
      )
    }
    const txResult = recordTransaction(this.transactionLedger, {
      day: this.currentDay,
      year: this.year,
      kind: 'signing',
      teamIds: [this.userTeamId as string],
      summary: `${this.userTeam.abbreviation} ${kind === 'resign' ? 're-signs' : 'signs FA'} ${player.name} ($${(offer.salary / 1e6).toFixed(1)}M × ${offer.years}).`,
    })
    this.transactionLedger = txResult.ledger
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

  /**
   * Your OWN assistant GM's live read as you build a package (EHM-style). Advice
   * from your side of the table — is this good value for us, plus practical flags
   * (a mover with an unwaived NTC, a deal we can't cap-fit). Uses the same
   * `playerValue`/`pickValue` the sim weighs. Deterministic; no RNG. This is your
   * staff talking, NOT the other club's answer.
   */
  assessTrade(proposal: TradeProposal): TradeAssessmentView {
    const staff = this.getTeamStaff(this.userTeamId as string)
    const agmName = staff.assistantGM?.name ?? 'Assistant GM'
    const year = this.year
    const givePlayers = proposal.givePlayerIds.map((id) => this.resolve(asPlayerId(id)))
    const receivePlayers = proposal.receivePlayerIds.map((id) => this.resolve(asPlayerId(id)))
    const giveValue =
      givePlayers.reduce((s, p) => s + playerValue(p), 0) +
      this.pickByIds(proposal.givePickIds).reduce((s, p) => s + pickValue(p, { year }), 0)
    const receiveValue =
      receivePlayers.reduce((s, p) => s + playerValue(p), 0) +
      this.pickByIds(proposal.receivePickIds).reduce((s, p) => s + pickValue(p, { year }), 0)

    if (giveValue <= 0 || receiveValue <= 0) {
      return { agmName, tone: 'empty', line: 'Put players or picks on both sides and I’ll give you my read.' }
    }

    // Practical flag: a player we’re moving still holds his no-trade clause.
    const heldNtc = givePlayers.find(
      (p) => p.contract.noTradeClause && !this.playerWaivesTo(p, asTeamId(proposal.partnerTeamId)),
    )
    if (heldNtc) {
      return {
        agmName, tone: 'blocked',
        line: `Before we go further — ${heldNtc.name} has a no-trade clause. He’d have to sign off, or you ask his camp which clubs he’d accept.`,
      }
    }

    // Practical flag: can WE fit the money coming back?
    const incoming = receivePlayers.reduce((s, p) => s + p.contract.salary, 0)
    const outgoing = givePlayers.reduce((s, p) => s + p.contract.salary, 0)
    const capAfter = rosterCapUsed(this.userTeam, this.data.players) + incoming - outgoing
    if (capAfter > this.userTeam.finances.salaryCap) {
      const over = capAfter - this.userTeam.finances.salaryCap
      return {
        agmName, tone: 'blocked',
        line: `The hockey’s one thing, but this puts us about $${(over / 1e6).toFixed(1)}M over the cap. We’d have to shed salary first.`,
      }
    }

    const rel = (receiveValue - giveValue) / Math.max(giveValue, receiveValue)
    const total = giveValue + receiveValue
    const shares = { giveShare: giveValue / total, receiveShare: receiveValue / total }
    if (rel > 0.30) return { agmName, tone: 'love', line: 'If they say yes to this, we’re fleecing them. I’d send it before they think twice.', ...shares }
    if (rel > 0.12) return { agmName, tone: 'good', line: 'Good value on our end. I like this one.', ...shares }
    if (rel >= -0.12) return { agmName, tone: 'fair', line: 'Fair hockey trade — it comes down to whether he fits our room.', ...shares }
    if (rel >= -0.30) return { agmName, tone: 'caution', line: 'We’d be paying a premium here. Defensible if you really want him, but don’t expect a bargain.', ...shares }
    return { agmName, tone: 'lopsided', line: 'That’s a steep overpay, boss. I’d pull back before we regret it.', ...shares }
  }

  /**
   * Live per-asset value breakdown for the trade builder. Every number comes
   * from the SAME `describePlayerValue`/`describePickValue` (i.e. `playerValue`/
   * `pickValue`) the AI accepts/rejects with, so the builder's math matches the
   * engine's. Your own assets read exactly; an unscouted opponent's player is
   * valued off your scouts' fogged overall (flagged `estimated`). The
   * `marketVerdict` is a pure who-wins-on-paper read; the `partnerVerdict` is a
   * side-effect-free dry-run of the real `evaluateProposal`. Deterministic.
   */
  evaluateTradeDraft(proposal: TradeProposal): TradeDraftView {
    const year = this.year
    const fog = this.fogCtx()
    const r1 = (v: number): number => Math.round(v * 10) / 10

    const playerAsset = (p: Player, useFog: boolean): TradeDraftAsset => {
      const b = badge(p, useFog ? fog : undefined)
      const estimated = !!b.scouted && !b.scouted.exact
      const { value, drivers } = describePlayerValue(p, estimated ? b.overall : undefined)
      return {
        key: p.id as string,
        name: p.name,
        kind: 'player',
        ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
        value: r1(value),
        estimated,
        drivers,
      }
    }
    const pickAssetDraft = (pk: DraftPick): TradeDraftAsset => {
      const { value, drivers } = describePickValue(pk, { year })
      const via = pk.originalTeamId !== pk.ownerTeamId
        ? this.data.teams.get(pk.originalTeamId)?.abbreviation
        : undefined
      const ord = pk.round === 1 ? '1st' : pk.round === 2 ? '2nd' : pk.round === 3 ? '3rd' : `${pk.round}th`
      return {
        key: this.pickId(pk),
        name: `${pk.year} ${ord}`,
        kind: 'pick',
        ...(via ? { viaAbbr: via } : {}),
        value: r1(value),
        drivers,
      }
    }

    const give: TradeDraftAsset[] = [
      ...proposal.givePlayerIds.map((id) => playerAsset(this.resolve(asPlayerId(id)), false)),
      ...this.pickByIds(proposal.givePickIds).map(pickAssetDraft),
    ]
    const receive: TradeDraftAsset[] = [
      ...proposal.receivePlayerIds.map((id) => playerAsset(this.resolve(asPlayerId(id)), true)),
      ...this.pickByIds(proposal.receivePickIds).map(pickAssetDraft),
    ]

    const giveTotal = r1(give.reduce((s, a) => s + a.value, 0))
    const receiveTotal = r1(receive.reduce((s, a) => s + a.value, 0))
    const net = r1(receiveTotal - giveTotal)

    let marketVerdict: TradeDraftView['marketVerdict'] = 'empty'
    let marketLine = 'Add players or picks to both sides to see the balance.'
    let marketPct: number | undefined
    if (giveTotal > 0 && receiveTotal > 0) {
      const rel = (receiveTotal - giveTotal) / Math.max(giveTotal, receiveTotal)
      if (Math.abs(rel) <= 0.1) {
        marketVerdict = 'fair'
        marketLine = 'Even value on paper.'
      } else if (rel < 0) {
        marketVerdict = 'overpay'
        marketPct = Math.round(((giveTotal - receiveTotal) / receiveTotal) * 100)
        marketLine = `You're overpaying by ~${marketPct}% on paper.`
      } else {
        marketVerdict = 'fleece'
        marketPct = Math.round(((receiveTotal - giveTotal) / giveTotal) * 100)
        marketLine = `You come out ~${marketPct}% ahead on paper.`
      }
    }

    // Reuse the assistant-GM read verbatim so the two panels never disagree.
    const agm = this.assessTrade(proposal)
    const { partnerVerdict, partnerLine } = this.partnerDraftVerdict(proposal, give.length > 0, receive.length > 0)

    return {
      give,
      receive,
      giveTotal,
      receiveTotal,
      net,
      marketVerdict,
      marketLine,
      ...(marketPct !== undefined ? { marketPct } : {}),
      agmName: agm.agmName,
      agmLine: agm.line,
      agmTone: agm.tone,
      partnerVerdict,
      partnerLine,
    }
  }

  /**
   * The partner's projected answer to a draft package — a side-effect-free
   * dry-run of the REAL `evaluateProposal` on a STABLE package-seeded RNG (never
   * touches the live proposal counter, so a later real offer is unchanged). This
   * is a projection: a formally proposed deal still gets slept on for a day or two.
   */
  private partnerDraftVerdict(
    proposal: TradeProposal,
    hasGive: boolean,
    hasReceive: boolean,
  ): { partnerVerdict: TradeDraftView['partnerVerdict']; partnerLine: string } {
    const partnerId = asTeamId(proposal.partnerTeamId)
    const partner = this.data.teams.get(partnerId)
    const name = partner?.name ?? 'The club'
    if (!partner) return { partnerVerdict: 'empty', partnerLine: 'That front office is unreachable right now.' }
    if (!this.tradingOpen()) return { partnerVerdict: 'empty', partnerLine: 'The trade market is closed.' }
    if (!hasGive || !hasReceive) return { partnerVerdict: 'empty', partnerLine: 'Put something on both sides to gauge their answer.' }

    const give = {
      players: proposal.givePlayerIds.map((id) => this.resolve(asPlayerId(id))),
      picks: this.pickByIds(proposal.givePickIds),
    }
    const receive = {
      players: proposal.receivePlayerIds.map((id) => this.resolve(asPlayerId(id))),
      picks: this.pickByIds(proposal.receivePickIds),
    }
    const waivedNtcIds = new Set(
      give.players.filter((p) => p.contract.noTradeClause).map((p) => p.id as string),
    )
    const charSum = (s: string): number => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h }
    const stableKey = [...proposal.givePlayerIds, ...proposal.givePickIds, ...proposal.receivePlayerIds, ...proposal.receivePickIds]
      .reduce((h, s) => (h * 31 + charSum(s)) | 0, 11)
    const rng = this.rngFor(7011, this.currentDay, stableKey)
    const posture = this.clubPostureFor(partnerId)
    const evaln = evaluateProposal({
      give, receive, partnerTeam: partner, partnerPlayers: this.data.players, rng, waivedNtcIds,
      relationship: this.relationshipWith(partnerId as string),
      philosophy: personaPhilosophy(this.gmPersonaFor(partnerId), posture.posture),
      context: {
        posture: posture.posture,
        deadlineProximity: Math.max(0, Math.min(1, 1 - Math.max(0, this.deadlineDay - this.currentDay) / 45)),
      },
    })
    if (evaln.verdict === 'accept') return { partnerVerdict: 'accept', partnerLine: `${name} would likely accept this.` }
    if (evaln.verdict === 'counter') return { partnerVerdict: 'counter', partnerLine: `${name} would want a bit more before saying yes.` }
    if (evaln.verdict === 'reject' && evaln.counterAskValue <= 0) return { partnerVerdict: 'blocked', partnerLine: evaln.message }
    return { partnerVerdict: 'reject', partnerLine: `${name} would reject this — the return falls short.` }
  }

  /**
   * NON-BINDING interest read from the partner GM when you "gauge interest"
   * before officially proposing (EHM-style). Runs the same `evaluateProposal`
   * the club would use, but on a STABLE gauge RNG (seeded from the package, not
   * the live offer counter) so it doesn’t consume proposal randomness or change
   * a later real offer — and it does NOT push a pending trade. A warm read is a
   * read, not a handshake; the actual offer still gets slept on.
   */
  gaugeTradeInterest(proposal: TradeProposal): TradeInterestView {
    const partnerId = asTeamId(proposal.partnerTeamId)
    const partner = this.data.teams.get(partnerId)
    const gmName = this.gmPersonaFor(partnerId)?.name ?? `${partner?.name ?? 'The club'}’s GM`
    if (!partner) return { gmName, lean: 'cool', line: 'We can’t reach that front office right now.' }
    if (!this.tradingOpen()) return { gmName, lean: 'cool', line: 'The trade market is closed — come find me when it reopens.' }

    const give = {
      players: proposal.givePlayerIds.map((id) => this.resolve(asPlayerId(id))),
      picks: this.pickByIds(proposal.givePickIds),
    }
    const receive = {
      players: proposal.receivePlayerIds.map((id) => this.resolve(asPlayerId(id))),
      picks: this.pickByIds(proposal.receivePickIds),
    }
    if (give.players.length + give.picks.length === 0 || receive.players.length + receive.picks.length === 0) {
      return { gmName, lean: 'cool', line: 'There’s nothing here for me to react to yet — put something on both sides.' }
    }
    const waivedNtcIds = new Set(
      give.players.filter((p) => p.contract.noTradeClause).map((p) => p.id as string),
    )
    // Stable gauge RNG: derived from the package so repeated gauges match and it
    // never touches the live proposal counter.
    const charSum = (s: string): number => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h }
    const stableKey = [...proposal.givePlayerIds, ...proposal.givePickIds, ...proposal.receivePlayerIds, ...proposal.receivePickIds]
      .reduce((h, s) => (h * 31 + charSum(s)) | 0, 7)
    const rng = this.rngFor(7010, this.currentDay, stableKey)
    const evaln = evaluateProposal({
      give, receive, partnerTeam: partner, partnerPlayers: this.data.players, rng, waivedNtcIds,
      relationship: this.relationshipWith(partnerId as string),
      philosophy: personaPhilosophy(this.gmPersonaFor(partnerId), this.clubPostureFor(partnerId).posture),
      context: {
        posture: this.clubPostureFor(partnerId).posture,
        deadlineProximity: Math.max(0, Math.min(1, 1 - Math.max(0, this.deadlineDay - this.currentDay) / 45)),
      },
    })

    // Map the verdict to a NON-BINDING interest phrasing. Even "accept" reads as
    // "worth a serious look", never a promise.
    if (evaln.verdict === 'reject' && evaln.counterAskValue <= 0) {
      // Hard dealbreaker (NTC / cap / roster-gutting) — surface the concrete reason.
      return { gmName, lean: 'blocked', line: `${gmName}: "${evaln.message}"` }
    }
    if (evaln.verdict === 'accept') {
      return { gmName, lean: 'warm', line: `${gmName}: "This definitely deserves a look — put it in front of me and I’ll give it real thought."` }
    }
    if (evaln.verdict === 'counter') {
      return { gmName, lean: 'tepid', line: `${gmName}: "There might be something here, but you’d have to sweeten it — send it and I’ll tell you what I’d need."` }
    }
    return { gmName, lean: 'cool', line: `${gmName}: "We’re not close on this one. It’d take a lot more coming back before I’d bite."` }
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
    // #186: a give-side no-trade clause only blocks the deal if the player hasn't
    // waived it (agent sign-off) or agreed to this destination. If he still holds
    // it, reject early with a nudge to talk to him first.
    const blockingNtc = give.players.find(
      (p) => p.contract.noTradeClause && !this.playerWaivesTo(p, partnerId),
    )
    if (blockingNtc) {
      return {
        verdict: 'reject',
        message: `${blockingNtc.name} holds a no-trade clause. Talk to his camp about waiving it — or ask him which clubs he'd accept — before shopping him to ${partner.abbreviation}.`,
        counter: null,
      }
    }
    const waivedNtcIds = new Set(
      give.players.filter((p) => p.contract.noTradeClause).map((p) => p.id as string),
    )
    const rng = this.rngFor(7006, this.currentDay, this.offerCounter)
    const evaln = evaluateProposal({
      give,
      receive,
      partnerTeam: partner,
      partnerPlayers: this.data.players,
      rng,
      waivedNtcIds,
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
    // #184 fast-no: a clear non-starter (NTC / cap-impossible / lowball with no
    // counter to be had) bounces back on the spot — real GMs say no to those
    // instantly.
    if (evaln.verdict === 'reject' || (evaln.verdict === 'counter' && evaln.counterAskValue <= 0)) {
      return { verdict: 'reject', message: evaln.message, counter: null }
    }
    // #14: on the trade DEADLINE itself and at the DRAFT table, GMs answer on the
    // spot — no sleeping on it. Resolve inline (execute or counter) instead of
    // queuing for a day. The completed deal / counter lands in the inbox + trade
    // offers immediately.
    if (this.isInstantTradeWindow()) {
      if (evaln.verdict === 'accept') {
        const done = this.executeUserTrade(proposal)
        return done.ok
          ? { verdict: 'accept', message: 'Deal struck — it is official.', counter: null }
          : { verdict: 'reject', message: done.message ?? 'The deal fell through under the cap.', counter: null }
      }
      this.deliverPendingTrade({ proposal, verdict: 'counter', counterAskValue: evaln.counterAskValue })
      return { verdict: 'counter', message: 'They came right back — check your trade offers.', counter: null }
    }
    // Deliberate-yes: a serious offer (would accept, or a workable counter) is
    // taken UNDER ADVISEMENT — no instant handshake. The GM sleeps on it and the
    // real answer (completed / counter / fell-through) arrives by inbox after a
    // day or two, quicker as the deadline nears.
    const days = this.tradeDeliberationDays(partnerId)
    this.pendingTrades.push({
      proposal,
      verdict: evaln.verdict === 'accept' ? 'accept' : 'counter',
      counterAskValue: evaln.counterAskValue,
      daysLeft: days,
    })
    const gmName = this.gmPersonaFor(partnerId)?.name ?? `${partner.name}'s GM`
    this.pushNews(
      'trade',
      `${partner.abbreviation} are weighing your offer`,
      `${gmName} took your proposal under advisement — he'll get back to you in a day or two.`,
      { teamId: partnerId as string }
    )
    return {
      verdict: 'pending',
      message: `${gmName} is considering it — expect an answer in about ${days} day${days === 1 ? '' : 's'}.`,
      counter: null,
    }
  }

  /** #184: how long the partner GM sits on a serious offer before answering.
   *  Deadline urgency compresses it; the quiet offseason drags it out; a friendly
   *  front office answers a touch quicker. */
  /** #14: windows where a rival GM answers a trade on the spot rather than sleeping
   *  on it — the trade deadline day itself, and the draft table. */
  private isInstantTradeWindow(): boolean {
    if (this.phase === 'regularSeason' && this.currentDay === this.deadlineDay) return true
    if (this.phase === 'offseason' && this.offseason?.stage === 'draft') return true
    return false
  }

  private tradeDeliberationDays(partnerId: TeamId): number {
    const proximity = Math.max(0, Math.min(1, 1 - Math.max(0, this.deadlineDay - this.currentDay) / 45))
    let d = this.phase === 'offseason' ? 3 : 2
    if (proximity > 0.7) d = 1 // deadline crunch — decisions in hours
    if (this.relationshipWith(partnerId as string) >= 65) d = Math.max(1, d - 1)
    return d
  }

  /** #184: tick down pending trade proposals; deliver any that are due. Called on
   *  every day advance (in-season and offseason). */
  private resolvePendingTrades(): void {
    if (this.pendingTrades.length === 0) return
    const carry: typeof this.pendingTrades = []
    for (const pt of this.pendingTrades) {
      pt.daysLeft -= 1
      if (pt.daysLeft > 0) { carry.push(pt); continue }
      this.deliverPendingTrade(pt)
    }
    this.pendingTrades = carry
  }

  private deliverPendingTrade(pt: { proposal: TradeProposal; verdict: 'accept' | 'counter'; counterAskValue: number }): void {
    const partnerId = asTeamId(pt.proposal.partnerTeamId)
    const partner = this.data.teams.get(partnerId)
    if (!partner || !this.tradingOpen()) {
      if (partner) this.pushNews('trade', `Talks with ${partner.abbreviation} lapse`,
        `The window closed before ${partner.name} came back on your proposal.`, { teamId: partnerId as string })
      return
    }
    // Re-validate the assets are still where they were — rosters may have shifted.
    const stillHave = pt.proposal.givePlayerIds.every((id) => this.userTeam.roster.includes(asPlayerId(id)))
    const stillTheirs = pt.proposal.receivePlayerIds.every((id) => partner.roster.includes(asPlayerId(id)))
    if (!stillHave || !stillTheirs) {
      this.pushNews('trade', `The deal with ${partner.abbreviation} fell through`,
        `By the time ${partner.name} came back, the pieces had moved — the proposal is dead.`, { teamId: partnerId as string })
      return
    }
    if (pt.verdict === 'accept') {
      const done = this.executeUserTrade(pt.proposal)
      if (!done.ok) {
        this.pushNews('trade', `The deal with ${partner.abbreviation} fell through`,
          done.message || `${partner.name} came back ready — but the deal no longer fits under the cap.`, { teamId: partnerId as string })
      }
      return
    }
    // Counter: name the extra the GM wants and table it as a real, acceptable offer.
    const give = { players: pt.proposal.givePlayerIds.map((id) => this.resolve(asPlayerId(id))), picks: this.pickByIds(pt.proposal.givePickIds) }
    const receive = { players: pt.proposal.receivePlayerIds.map((id) => this.resolve(asPlayerId(id))), picks: this.pickByIds(pt.proposal.receivePickIds) }
    const counter = this.buildCounterOffer(partnerId, give, receive, pt.counterAskValue)
    if (counter) {
      this.tradeOffers.push(counter)
      this.pushNews('trade', `${partner.abbreviation} counter your offer`, counter.message, { teamId: partnerId as string })
    } else {
      this.pushNews('trade', `${partner.abbreviation} pass on your offer`,
        `${partner.name} slept on it and came back a no — nothing on your side bridged the gap.`, { teamId: partnerId as string })
    }
  }

  /** Execute an agreed user trade now (the completed-deal path, extracted so the
   *  deferred #184 resolution can run it after deliberation). */
  private executeUserTrade(proposal: TradeProposal): { ok: boolean; message?: string } {
    const partnerId = asTeamId(proposal.partnerTeamId)
    const partner = this.data.teams.get(partnerId)
    if (!partner) return { ok: false }
    const give = { players: proposal.givePlayerIds.map((id) => this.resolve(asPlayerId(id))), picks: this.pickByIds(proposal.givePickIds) }
    const receive = { players: proposal.receivePlayerIds.map((id) => this.resolve(asPlayerId(id))), picks: this.pickByIds(proposal.receivePickIds) }
    try {
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
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : undefined }
    }
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
    this.tradeWriteup(receive.players.map((p) => p.id), give.players.map((p) => p.id), partnerId)
    this.adjustRelationship(partnerId as string, 6)
    return { ok: true }
  }

  /** DEPTH 3: turn the partner's residual "wants this much more" into a concrete
   *  counter — the smallest user asset that covers the gap (or the two biggest
   *  if none does), tabled as a real, acceptable {@link StoredTradeOffer}. */
  private buildCounterOffer(
    partnerId: TeamId,
    give: { players: Player[]; picks: DraftPick[] },
    receive: { players: Player[]; picks: DraftPick[] },
    gap: number
  ): StoredTradeOffer | null {
    const inGivePlayers = new Set(give.players.map((p) => p.id as string))
    const inGivePicks = new Set(give.picks.map((pk) => this.pickId(pk)))
    const assets: Array<{ value: number; player?: Player; pick?: DraftPick }> = []
    for (const id of this.userTeam.roster) {
      const p = this.data.players.get(id)
      if (!p || inGivePlayers.has(p.id as string) || p.contract.noTradeClause) continue
      assets.push({ value: playerValue(p), player: p })
    }
    for (const pk of this.picks) {
      if (pk.ownerTeamId !== this.userTeamId || inGivePicks.has(this.pickId(pk))) continue
      assets.push({ value: pickValue(pk, { year: this.year }), pick: pk })
    }
    if (assets.length === 0) return null

    // Prefer the least-overpaying single asset that covers the gap; failing
    // that, the two most valuable pieces — but only if together they get there.
    const covering = assets.filter((a) => a.value >= gap).sort((a, b) => a.value - b.value)
    let chosen: Array<{ value: number; player?: Player; pick?: DraftPick }>
    if (covering.length > 0) {
      chosen = [covering[0]]
    } else {
      const top = [...assets].sort((a, b) => b.value - a.value).slice(0, 2)
      if (top.reduce((s, a) => s + a.value, 0) < gap * 0.9) return null
      chosen = top
    }

    const addPlayers = chosen.filter((a) => a.player).map((a) => a.player!)
    const addPicks = chosen.filter((a) => a.pick).map((a) => a.pick!)
    const gm = this.gmPersonaFor(partnerId)
    const names = [
      ...addPlayers.map((p) => p.name),
      ...addPicks.map((pk) => `a ${pk.year} round-${pk.round} pick`),
    ]
    const nameList =
      names.length <= 1 ? (names[0] ?? 'a sweetener')
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    return {
      offerId: `c${this.offerCounter++}`,
      partnerTeamId: partnerId,
      userReceivesPlayerIds: receive.players.map((p) => p.id),
      userReceivesPicks: [...receive.picks],
      userGivesPlayerIds: [...give.players.map((p) => p.id), ...addPlayers.map((p) => p.id)],
      userGivesPicks: [...give.picks, ...addPicks],
      message: `${gm.name}: We're close. Add ${nameList} and you've got a deal.`,
      expiresOnDay: this.currentDay + 3,
    }
  }

  /** DEPTH 3: actively shop a player. Every AI club thin at his position group
   *  tables its best package; the strongest few land in the trade centre as
   *  real incoming offers. Replaces any earlier offers for the same player. */
  shopPlayer(playerId: string): { count: number; message: string } {
    if (!this.tradingOpen()) throw new Error('the trade market is closed')
    const id = asPlayerId(playerId)
    if (!this.userTeam.roster.includes(id)) throw new Error('that player is not on your roster')
    const player = this.resolve(id)
    // #186: a no-trade clause blocks shopping unless he's granted a full waive.
    // A partial (acceptable-teams) waive doesn't open the whole market — propose
    // to those clubs directly.
    if (player.contract.noTradeClause && !player.ntcWaived) {
      return { count: 0, message: `${player.name} holds a no-trade clause — get his agent to waive it (or ask which clubs he'd accept) before shopping him.` }
    }
    // Clear stale offers that were shopping THIS player before re-soliciting.
    this.tradeOffers = this.tradeOffers.filter(
      (o) => !(o.userGivesPlayerIds.length === 1 && (o.userGivesPlayerIds[0] as string) === playerId)
    )
    const offers = solicitOffersForPlayer({
      target: player,
      userTeamId: this.userTeamId,
      teams: this.data.teams,
      players: this.data.players,
      picks: this.picks,
      rng: this.rngFor(7009, this.currentDay, Career.pidNum(playerId)),
      nextOfferId: () => `s${this.offerCounter++}`,
      expiresOnDay: this.currentDay + 4,
      aggressionOf: (tid) => this.gmPersonaFor(tid).aggression,
      maxOffers: 4,
    })
    for (const o of offers) this.tradeOffers.push(o)
    // Living Ledger: his name is in other GMs' mouths now. Quiet feelers can
    // leak — and if they do, expect him in your office (docs/NARRATIVE-ENGINE.md).
    this.recordWorldAction('shopped', playerId, 'quiet')
    if (offers.length === 0) {
      this.pushNews(
        'trade',
        `No takers for ${player.name}`,
        `You put out feelers on ${player.name}, but no club tabled an offer worth relaying. Try again closer to the deadline, or shop someone else.`,
        { teamId: this.userTeamId as string }
      )
      return { count: 0, message: `No club tabled an offer for ${player.name}.` }
    }
    this.pushNews(
      'trade',
      `${offers.length} club${offers.length > 1 ? 's inquire' : ' inquires'} on ${player.name}`,
      `You shopped ${player.name}. ${offers.length} offer${offers.length > 1 ? 's are' : ' is'} on your desk — review ${offers.length > 1 ? 'them' : 'it'} in the trade centre.`,
      { teamId: this.userTeamId as string }
    )
    return { count: offers.length, message: `${offers.length} offer${offers.length > 1 ? 's' : ''} came in for ${player.name}.` }
  }

  /* ─────────────────────── #186 no-trade-clause negotiation ─────────────────────── */

  /** #186: may this player be moved to destTeamId given his no-trade clause? */
  private playerWaivesTo(p: Player, destTeamId: TeamId): boolean {
    if (!p.contract.noTradeClause) return true
    if (p.ntcWaived) return true
    return (p.tradeAcceptTeams ?? []).some((id) => (id as string) === (destTeamId as string))
  }

  /** Rough club desirability (0–100-ish) for a player weighing a move — roster
   *  strength + market size. Deterministic. */
  private clubDesirability(teamId: TeamId): number {
    const team = this.data.teams.get(teamId)
    if (!team) return 0
    const ovrs = team.roster
      .map((id) => this.data.players.get(id))
      .filter((p): p is Player => !!p)
      .map((p) => overall(p.composites, p.position))
      .sort((a, b) => b - a)
      .slice(0, 12)
    const strength = ovrs.length ? ovrs.reduce((s, v) => s + v, 0) / ovrs.length : 50
    const market = ((team.arenaCapacity ?? 18000) - 16000) / 200 // ~±10
    return strength + Math.max(-8, Math.min(10, market))
  }

  /**
   * #186: the GM asks a player's agent about waiving his no-trade clause outright.
   * The agent weighs loyalty, how happy the player is, his role, age and form. A
   * granted waive opens him to any destination; otherwise the agent points you to
   * asking the player directly for the clubs he'd accept.
   */
  askAgentWaiveNtc(playerId: string):
    { ok: boolean; verdict: 'granted' | 'conditional' | 'refused'; message: string } {
    const p = this.data.players.get(asPlayerId(playerId))
    if (!p || !this.userTeam.roster.includes(asPlayerId(playerId))) {
      return { ok: false, verdict: 'refused', message: 'Not on your roster.' }
    }
    if (!p.contract.noTradeClause) {
      return { ok: false, verdict: 'granted', message: `${p.name} has no no-trade protection to waive.` }
    }
    if (p.ntcWaived) {
      return { ok: true, verdict: 'granted', message: `${p.name} has already agreed to waive his clause.` }
    }
    // Willingness 0–1: unhappy / fringe / older players lean yes; loyal, happy
    // core men lean no.
    let w = 0.4
    w += (50 - p.morale) / 100 * 0.6
    w += p.personality.loyalty <= 8 ? 0.2 : p.personality.loyalty >= 15 ? -0.25 : 0
    w += p.age >= 34 ? 0.15 : 0
    w += p.form < -2 ? 0.1 : 0
    w += p.squadStatus === 'surplus' ? 0.2 : p.squadStatus === 'keyPlayer' ? -0.2 : 0
    const roll = this.rngFor(7031, this.currentDay, Career.pidNum(playerId)).float(-0.12, 0.12)
    const score = w + roll
    if (score >= 0.55) {
      p.ntcWaived = true
      this.pushNews('contract', `${p.name} agrees to waive his no-trade clause`,
        `After a call from his camp, ${p.name}'s agent says he's open to a move — he'll waive the clause for the right situation. You're free to shop him.`,
        { playerId, teamId: this.userTeamId as string })
      return { ok: true, verdict: 'granted', message: `${p.name}'s agent will waive the clause — he's open to a move.` }
    }
    if (score >= 0.32) {
      return { ok: true, verdict: 'conditional',
        message: `${p.name}'s agent won't sign a blanket waiver, but says he'd consider certain clubs. Ask ${p.name} directly which teams he'd accept.` }
    }
    return { ok: true, verdict: 'refused',
      message: `${p.name} intends to honour his no-trade clause. His agent politely shut the door.` }
  }

  /**
   * #186: the GM asks the player himself which clubs he'd accept a trade to. He
   * names a handful of desirable destinations (a partial waive); a deal to any of
   * them clears his clause. Returns the list (also stored on the player).
   */
  askPlayerTradeList(playerId: string):
    { ok: boolean; teams: Array<{ teamId: string; name: string }>; message: string } {
    const p = this.data.players.get(asPlayerId(playerId))
    if (!p || !this.userTeam.roster.includes(asPlayerId(playerId))) {
      return { ok: false, teams: [], message: 'Not on your roster.' }
    }
    if (!p.contract.noTradeClause) {
      return { ok: false, teams: [], message: `${p.name} has no no-trade clause — he can be dealt anywhere.` }
    }
    const rng = this.rngFor(7032, this.currentDay, Career.pidNum(playerId))
    // How many clubs he'll name: happier/loyal players give a short list; unhappy
    // ones open the door wider.
    const base = p.morale < 40 ? 8 : p.morale < 60 ? 6 : 4
    const count = Math.max(3, Math.min(10, base + rng.range(-1, 1)))
    const ranked = this.data.league.teams
      .filter((tid) => (tid as string) !== (this.userTeamId as string))
      .map((tid) => ({ tid, score: this.clubDesirability(tid) + rng.float(-6, 6) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, count)
    p.tradeAcceptTeams = ranked.map((r) => r.tid)
    const teams = ranked.map((r) => ({ teamId: r.tid as string, name: this.data.teams.get(r.tid)?.name ?? (r.tid as string) }))
    this.pushNews('contract', `${p.name} submits a trade list`,
      `${p.name} would accept a trade to: ${teams.map((t) => t.name).join(', ')}. A deal to any of them clears his no-trade clause.`,
      { playerId, teamId: this.userTeamId as string })
    return { ok: true, teams, message: `${p.name} would waive his clause for ${teams.length} clubs.` }
  }

  acceptTrade(offerId: string): void {
    const offer = this.tradeOffers.find((o) => o.offerId === offerId)
    if (!offer) throw new Error('offer no longer available')
    const partner = this.data.teams.get(offer.partnerTeamId)!
    // Cap guard: you can't complete a deal that puts you over the ceiling — the
    // same check the AGM shows in his read. Salary in minus salary out, netted
    // against a former club's retained share.
    const salOf = (id: string): number => {
      const p = this.data.players.get(asPlayerId(id))
      return p ? p.contract.salary - (p.contract.retainedByOthers ?? 0) : 0
    }
    const incoming = offer.userReceivesPlayerIds.reduce((s, id) => s + salOf(id as string), 0)
    const outgoing = offer.userGivesPlayerIds.reduce((s, id) => s + salOf(id as string), 0)
    const capAfter = rosterCapUsed(this.userTeam, this.data.players) + incoming - outgoing
    if (capAfter > this.userTeam.finances.salaryCap) {
      const over = capAfter - this.userTeam.finances.salaryCap
      throw new Error(`Accepting would put you $${(over / 1e6).toFixed(1)}M over the cap — shed salary or move a contract first.`)
    }
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
    // Spell out the deal — who and what moved each way — so the inbox reads like
    // real news, not a bare "the deal is done".
    const roundOrd = (r: number): string => (r === 1 ? '1st' : r === 2 ? '2nd' : r === 3 ? '3rd' : `${r}th`)
    const nameList = (ids: readonly string[], picks: readonly { round: number; year: number }[]): string => {
      const names = ids.map((id) => this.data.players.get(asPlayerId(id))?.name).filter(Boolean) as string[]
      const pickBits = picks.map((p) => `${p.year} ${roundOrd(p.round)}-round pick`)
      const all = [...names, ...pickBits]
      return all.length ? all.join(', ') : 'future considerations'
    }
    const acquired = nameList(offer.userReceivesPlayerIds, offer.userReceivesPicks)
    const sent = nameList(offer.userGivesPlayerIds, offer.userGivesPicks)
    this.pushNews(
      'trade',
      `${this.userTeam.abbreviation} acquire ${acquired} from ${partner.name}`,
      `${this.userTeam.name} have completed a trade with the ${partner.name}: ${this.userTeam.abbreviation} receive ${acquired} in exchange for ${sent}.`,
      { teamId: offer.partnerTeamId as string }
    )
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
    this.tradeWriteup(offer.userReceivesPlayerIds, offer.userGivesPlayerIds, offer.partnerTeamId)
  }

  rejectTrade(offerId: string): void {
    this.tradeOffers = this.tradeOffers.filter((o) => o.offerId !== offerId)
  }

  private tradingOpen(): boolean {
    // Open all season until the deadline, closed through the playoffs, and
    // OPEN again all summer — July trades are half the fun of an offseason.
    if (this.phase === 'offseason') return true
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
      .sort((a, b) => ratedOverall(b) - ratedOverall(a))
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
    const top6 = team.roster.map((id) => this.resolve(id)).sort((a, b) => ratedOverall(b) - ratedOverall(a)).slice(0, 6)
    const coreAge = top6.length > 0 ? top6.reduce((s, p) => s + p.age, 0) / top6.length : 27
    // Best U23s across the org (NHL + farm + rights-held), for the AGM's pitch.
    const affiliate = team.affiliateId ? this.data.teams.get(team.affiliateId) : undefined
    const youngIds = [...team.roster, ...(affiliate?.roster ?? [])]
    const prospects = youngIds
      .map((id) => this.resolve(id))
      .filter((p) => p.age <= 23)
      .sort((a, b) => (b.potential ? 1 : 0) - (a.potential ? 1 : 0) || ratedOverall(b) - ratedOverall(a))
      .slice(0, 3)
      .map((p) => p.name)
    const coachProfile = staff.headCoach?.profile
    // Defensive: some generated staffs miss a member — the meeting still holds.
    const owner = staff.owner ?? { id: 'owner', name: 'The Owner' }
    const coach = staff.headCoach ?? { id: 'coach', name: 'The Head Coach' }
    const agm = staff.assistantGM ?? { id: 'agm', name: 'Your Assistant GM' }
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

  /**
   * Execute one AI-to-AI deal: move the assets, apply retention/prospects,
   * repair both lineups, record it to the ledger + chronicle, and — for a
   * genuine roster piece — put it on your inbox. Shared by the daily rumour tick
   * and the deadline-day morning flurry so both read identically.
   */
  private executeAiAiDeal(aiDeal: AiAiTradeResult, day: number): void {
    // Value of the piece changing hands — gates whether this reaches your inbox.
    const movedValue = Math.max(
      0,
      ...aiDeal.playerIds.map((id) => playerValue(this.resolve(asPlayerId(id as string)))),
    )
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
    // Retained salary (#157): the seller keeps paying part of the vet's hit so
    // the cap-tight buyer fits. The player carries `retainedByOthers` (so his
    // new club counts only the balance), and the seller books a retention slot
    // that draws against its cap until the contract expires.
    if (aiDeal.retainedAmount && aiDeal.retainedAmount > 0) {
      const vetId = asPlayerId(aiDeal.playerIds[0] as string)
      const vet = this.data.players.get(vetId)
      const seller = this.data.teams.get(aiDeal.sellerTeamId)
      const buyer = this.data.teams.get(aiDeal.buyerTeamId)
      if (vet && seller && buyer) {
        vet.contract.retainedByOthers = aiDeal.retainedAmount
        seller.finances.retained = [
          ...(seller.finances.retained ?? []),
          { playerId: vetId as string, amount: aiDeal.retainedAmount, expiryYear: vet.contract.expiryYear },
        ]
        seller.finances.capUsed = rosterCapUsed(seller, this.data.players)
        buyer.finances.capUsed = rosterCapUsed(buyer, this.data.players)
      }
    }
    // Prospects (AHL / rights) the buyer sends back move into the SELLER's
    // system: out of the buyer's affiliate (or off his rights), into the
    // seller's affiliate, with rights following the player.
    for (const pid of aiDeal.prospectIds) {
      this.moveProspectBetweenOrgs(pid, aiDeal.buyerTeamId, aiDeal.sellerTeamId)
    }
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
    // Every deal is on the transactions ledger + ticker; only NOTABLE ones
    // (a genuine roster piece changing hands) reach your inbox, so the
    // deadline hums without burying your mail in depth-for-a-7th swaps.
    if (movedValue >= 35) {
      const sellerGm = this.gmPersonaFor(aiDeal.sellerTeamId)
      const buyerGm = this.gmPersonaFor(aiDeal.buyerTeamId)
      // Deterministic framing variety so deadline day doesn't read like one
      // template on repeat — same house voice, different angle each time.
      const takes = [
        `${buyerGm.name} adds a piece for the run; ${sellerGm.name} banks the return.`,
        `A win-now club and a seller found each other. ${buyerGm.name} pays up; ${sellerGm.name} restocks.`,
        `${sellerGm.name} cashed in. Whether ${buyerGm.name} got value is the question the standings will answer.`,
        `${buyerGm.name} went and got their guy. ${sellerGm.name} took the futures and moved on.`,
      ]
      const pick = (Career.pidNum(aiDeal.sellerTeamId as string) + Career.pidNum(aiDeal.buyerTeamId as string) + day) % takes.length
      this.pushNews(
        'trade',
        `Trade: ${aiDeal.summary.split('.')[0]}`,
        `${aiDeal.summary} ${takes[pick]}`,
        { teamId: aiDeal.buyerTeamId as string }
      )
    }
  }

  /**
   * Deadline-day tentpole: the moment the sim is held on deadline day, the
   * market comes alive. Runs exactly once per season. Two things happen up
   * front so the war room isn't a static briefing:
   *   (A) rival GMs table CONCRETE offers for your most movable players — real,
   *       acceptable {@link StoredTradeOffer}s that show on your desk and ring
   *       the phone; and
   *   (B) a morning flurry of AI-to-AI deals lands on the wire before you've
   *       made a call, so the league is visibly moving without you.
   * Fully deterministic (seeded Rng), additive to the existing hold.
   */
  private openDeadlineDay(): void {
    const key = `deadline-open-${this.year}`
    if (this.tentpoles.emittedKeys.includes(key)) return
    this.tentpoles.emittedKeys.push(key)
    const day = this.currentDay

    /* (A) Concrete incoming offers for your movable players. */
    const alreadyShopping = new Set(
      this.tradeOffers
        .filter((o) => o.userGivesPlayerIds.length === 1)
        .map((o) => o.userGivesPlayerIds[0] as string),
    )
    const movable = this.userTeam.roster
      .map((id) => this.resolve(id))
      .filter(
        (p) =>
          p.injuryStatus === null &&
          (!p.contract.noTradeClause || p.ntcWaived) &&
          !alreadyShopping.has(p.id as string) &&
          playerValue(p) >= 15,
      )
      .sort((a, b) => playerValue(b) - playerValue(a) || (a.id < b.id ? -1 : 1))
      .slice(0, 4)
    let tabled = 0
    for (const target of movable) {
      if (tabled >= 6) break
      const offers = solicitOffersForPlayer({
        target,
        userTeamId: this.userTeamId,
        teams: this.data.teams,
        players: this.data.players,
        picks: this.picks,
        rng: this.rngFor(7113, day, Career.pidNum(target.id as string)),
        nextOfferId: () => `d${this.offerCounter++}`,
        expiresOnDay: this.deadlineDay + 1,
        aggressionOf: (tid) => this.gmPersonaFor(tid).aggression,
        maxOffers: 2,
      })
      for (const o of offers) {
        if (tabled >= 6) break
        this.tradeOffers.push(o)
        tabled++
        const partner = this.data.teams.get(o.partnerTeamId)!
        const gm = this.gmPersonaFor(o.partnerTeamId)
        this.pushNews(
          'trade',
          `Deadline call from ${partner.abbreviation}`,
          `${gm.name} (${gm.styleLabel}) is on the line. ${o.message}`,
          { teamId: o.partnerTeamId as string },
        )
      }
    }

    /* (B) Morning AI-to-AI flurry — populates the live wire immediately. */
    const ranks = this.strengthRanks()
    const postureOf = (tid: TeamId): 'contend' | 'retool' | 'rebuild' =>
      this.clubPostureFor(tid, ranks).posture
    for (let attempt = 0; attempt < 10; attempt++) {
      const aiDeal = generateAiAiTrade({
        day,
        deadlineDay: this.deadlineDay,
        userTeamId: this.userTeamId,
        teams: this.data.teams,
        players: this.data.players,
        picks: this.picks,
        rng: this.rngFor(7112, attempt),
        postureOf,
      })
      if (!aiDeal) continue
      this.executeAiAiDeal(aiDeal, day)
    }
  }

  /** The league-wide "who's being shopped" board: every selling/retooling club's
   *  movable veterans, with a plain-English asking price on the Perri scale. Fog
   *  applies (you see them as your scouts do). Best value first, capped. */
  private buildShoppedBoard(ranks: Map<string, number>): ShoppedPlayerView[] {
    const fog = this.fogCtx()
    const out: ShoppedPlayerView[] = []
    for (const [tid, team] of this.data.teams) {
      if (tid === this.userTeamId || team.tier === 'ahl' || team.tier === 'world') continue
      // Contenders aren't selling their roster — only sellers put names out.
      if (this.clubPostureFor(tid, ranks).posture === 'contend') continue
      const gm = this.gmPersonaFor(tid)
      for (const pid of team.roster) {
        const p = this.data.players.get(pid)
        if (!p || p.injuryStatus !== null || p.contract.noTradeClause) continue
        // What a selling club actually dangles: a movable veteran, not a scrub.
        if (p.age < 26 || p.position === 'G') continue
        const value = playerValue(p)
        const rental = p.contract.yearsRemaining <= 1
        out.push({
          ...badge(p, fog),
          salary: p.contract.salary,
          yearsRemaining: p.contract.yearsRemaining,
          teamId: tid as string,
          teamAbbr: team.abbreviation,
          teamName: team.name,
          gmName: gm.name,
          rental,
          value: Math.round(value * 10) / 10,
          asking: askingPriceText(value, rental),
        })
      }
    }
    out.sort((a, b) => b.value - a.value || (a.playerId < b.playerId ? -1 : 1))
    // Prefer the shared "real trade value" bar (≈ a depth NHLer on the unified
    // Perri scale), but never let the board go empty: a weak league (or an early
    // rebuild) may not field anyone above the bar, so fall back to the best
    // movable veterans on the market. Real imported rosters clear the bar easily;
    // this keeps the deadline hub alive everywhere.
    const eligible = out.filter((s) => s.value >= MIN_SHOP_VALUE)
    return (eligible.length >= 8 ? eligible : out).slice(0, 16)
  }

  /** The live deadline wire: recent completed trades (AI-to-AI + your own),
   *  newest first, read straight off the transaction ledger. */
  private buildDeadlineFeed(): DeadlineFeedItemView[] {
    const abbrOf = (tid: string): string => this.data.teams.get(asTeamId(tid))?.abbreviation ?? tid
    return this.transactionLedger.items
      .filter((t) => t.kind === 'trade' && t.year === this.year)
      .slice(-14)
      .reverse()
      .map((t) => {
        const ago = this.currentDay - t.day
        return {
          text: t.summary,
          teamAbbrs: t.teamIds.map(abbrOf),
          when: ago <= 0 ? 'today' : `${ago}d ago`,
          accent: true,
        }
      })
  }

  /** The deadline-day hub (Season Rhythm M4). Non-null only while the sim is held
   *  on deadline day; everything is read live from the market. */
  getDeadlineDay(): DeadlineDayView | null {
    if (!this.deadlineHold) return null
    const staff = this.getTeamStaff(this.userTeamId as string)
    const ranks = this.strengthRanks()
    const myPosture = this.clubPostureFor(this.userTeamId, ranks)
    const buying = myPosture.posture === 'contend'
    const space = this.userTeam.finances.salaryCap - this.userCapUsed() - this.userDeadCap
    const counts = this.rosterCounts(this.userTeam)
    const need = counts.d <= 6 ? 'the blue line' : counts.g < 2 ? 'the crease' : 'scoring depth'
    return {
      dateISO: dayToDateISO(this.year, this.currentDay),
      deadlineDay: this.deadlineDay,
      stance: buying
        ? `We're contenders — ${myPosture.reason}. Today we buy, or we explain why we didn't.`
        : myPosture.posture === 'rebuild'
          ? `We're selling — ${myPosture.reason}. Every expiring veteran is a draft pick wearing skates.`
          : `We're on the fence — ${myPosture.reason}. Pick a side before the phones decide for you.`,
      capLine: this.userDeadCap > 0
        ? `Space to work with: $${(space / 1e6).toFixed(2)}M after $${(this.userDeadCap / 1e6).toFixed(2)}M in dead cap.`
        : `Space to work with: $${(space / 1e6).toFixed(2)}M.`,
      coachLine: `If we add anywhere, add to ${need}. Don't bring me a project — bring me someone who plays TONIGHT.`,
      agmName: staff.assistantGM?.name ?? 'Your Assistant GM',
      buying,
      // Only offers where you'd move one of YOUR players — the real "calls".
      incoming: this.tradeOffers.filter((o) => o.userGivesPlayerIds.length > 0).map((o) => this.offerView(o)),
      shopped: this.buildShoppedBoard(ranks),
      feed: this.buildDeadlineFeed(),
    }
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
    const capUsed = this.userCapUsed()
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
        { id: 'agm', name: staff.assistantGM?.name ?? 'Your Assistant GM', title: 'Assistant GM', ...(staff.assistantGM?.faceId ? { faceId: staff.assistantGM.faceId } : {}) },
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
                return p !== undefined && ratedOverall(p) >= 80
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
    // The coach weighs in when YOUR trade lands a real player (the 'tradeAdd'
    // pool sat authored-but-dark). Quote once, on the best incoming piece —
    // pick-only deals and depth swaps pass in silence.
    if (userInvolved) {
      const incomingIds =
        (args.teamAId as string) === (this.userTeamId as string) ? args.bGivesPlayerIds : args.aGivesPlayerIds
      const best = incomingIds
        .map((pid) => this.data.players.get(asPlayerId(pid as string)))
        .filter((p): p is Player => !!p && ratedOverall(p) >= 74)
        .sort((a, b) => ratedOverall(b) - ratedOverall(a))[0]
      if (best) {
        this.pushCoachQuote('tradeAdd', { playerName: best.name }, this.seed ^ Career.pidNum(best.id as string) ^ (this.year * 11))
      }
    }
  }

  /**
   * A proper press column on a trade the user just made — the kind of deal that
   * earns a write-up, not a one-line transaction blurb. Only fires when a real
   * piece changes hands (someone rating ≥76) so routine depth swaps don't spam
   * the news. Grounded and opinionated per the house voice; no rating numbers in
   * the prose. Call AFTER the assets have moved.
   */
  private tradeWriteup(incomingIds: PlayerId[], outgoingIds: PlayerId[], partnerId: TeamId): void {
    const resolve = (ids: PlayerId[]): Player[] =>
      ids.map((id) => this.data.players.get(id)).filter((p): p is Player => !!p)
    const incoming = resolve(incomingIds)
    const outgoing = resolve(outgoingIds)
    const byOvr = (ps: Player[]): Player[] => [...ps].sort((a, b) => ratedOverall(b) - ratedOverall(a))
    const headliner = byOvr([...incoming, ...outgoing])[0]
    if (!headliner || ratedOverall(headliner) < 76) return // routine deal — no column
    const partner = this.data.teams.get(partnerId)
    if (!partner) return

    const inBest = byOvr(incoming)[0]
    const outBest = byOvr(outgoing)[0]
    const us = this.userTeam
    const caliber = (p: Player): string => {
      const ov = ratedOverall(p)
      const g = p.position === 'G'
      if (ov >= 86) return g ? 'a franchise goaltender' : 'a bona fide star'
      if (ov >= 81) return g ? 'a proven starter' : p.position === 'D' ? 'a top-pairing defenceman' : 'a top-six forward'
      if (ov >= 76) return g ? 'a capable NHL starter' : p.position === 'D' ? 'a top-four defenceman' : 'a middle-six regular'
      return 'a depth piece'
    }
    const outNames = outgoing.map((p) => p.name).join(', ')

    const headline = inBest
      ? `${us.name} land ${inBest.name}`
      : `${us.name} ship ${outBest?.name ?? 'a veteran'} to ${partner.abbreviation}`

    // Rougher, has a take, uneven rhythm — the house voice, not a wire blurb.
    const lead = inBest && (!outBest || ratedOverall(inBest) >= ratedOverall(outBest))
      ? `${us.abbreviation} got their guy. ${inBest.name} — ${caliber(inBest)} — walks straight into the top of the lineup.`
      : outBest
        ? `${us.abbreviation} cashed in ${outBest.name}. ${caliber(outBest)}, and you can see the plan behind moving him.`
        : `${us.abbreviation} reshuffled the deck.`
    const cost = outNames ? ` The price going the other way: ${outNames}.` : ` It cost them draft capital.`
    const kicker = ` Good deal? ${partner.abbreviation} think they won it too. That's usually how the interesting ones look.`
    const body = `${lead}${cost}${kicker}`

    const persona =
      PRESS_PERSONA_NAMES[Career.PRESS_PERSONA_ROTATION[this.pressCounter++ % Career.PRESS_PERSONA_ROTATION.length]]
    this.pushNews('trade', headline, body, {
      teamId: partnerId as string,
      ...(inBest ? { playerId: inBest.id as string } : {}),
      press: { byline: `${persona.name} — ${persona.outlet}`, kind: 'tradeColumn' },
      salience: 85,
    })
  }

  /* ────────────────────────── view builders ────────────────────────── */

  /** The summer calendar: offseason stages map to real dates. July 1 is the
   *  anchor — free agency opens exactly there, day by day. */
  private offseasonDateISO(): string {
    const os = this.offseason
    const summerYear = this.currentDay === 0 ? this.year : this.year + 1
    if (!os) return `${summerYear}-07-01`
    switch (os.stage) {
      case 'awards': return `${summerYear}-06-18`
      case 'draft': return `${summerYear}-06-27`
      case 'resign': return `${summerYear}-07-01`
      case 'freeAgency': return `${summerYear}-07-${String(Math.min(31, 1 + os.faDay)).padStart(2, '0')}`
      case 'preseason': return `${summerYear}-09-15`
    }
  }

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
        if (next === undefined) return 'Continue to playoffs'
        const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        const [, m, d] = dayToDateISO(this.year, next).split('-')
        return `Continue to ${MONTHS[parseInt(m ?? '1', 10) - 1]} ${parseInt(d ?? '1', 10)}`
      }
      if (this.phase === 'playoffs') return 'Continue — next playoff games'
      // Dev camp is gated ahead of the market: while it's pending, the first
      // Continue walks you into camp (not free agency), so say so — otherwise the
      // button reads "open free agency" but routes to the rink.
      if (this.devCampPending && this.phase === 'offseason') return 'Continue — development camp'
      const stage = this.offseason?.stage ?? 'awards'
      const labels: Record<string, string> = {
        awards: 'Continue — season awards & development',
        draft: this.draftPending() ? 'Go to the entry draft' : 'Continue — open free agency',
        resign: 'Continue — open free agency',
        freeAgency: `Continue — free agency day ${(this.offseason?.faDay ?? 0) + 1}`,
        preseason: this.captainsPending() ? 'Name your captain to start the season' : 'Continue — start the new season',
      }
      return labels[stage]
    })()

    const scorers = [...this.totals.entries()]
      .map(([id, t]) => ({ id, pts: t.goals + t.assists, g: t.goals, a: t.assists }))
      .filter(({ id }) => team.roster.includes(id))
      .sort((x, y) => y.pts - x.pts)
      .slice(0, 3)

    const roster = team.roster.map((id) => this.resolve(id))
    const capUsed = capUsedFor(team, this.data.players)
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
        plusMinus: t?.plusMinus ?? 0,
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
      date: this.phase === 'offseason' ? this.offseasonDateISO() : dayToDateISO(this.year, Math.max(1, this.currentDay)),
      continueLabel,
      draftPending: this.draftPending(),
      captainsPending: this.captainsPending(),
      boardMeetingPending: this.boardMeetingYear !== null && this.phase === 'regularSeason',
      staffMeetingDue: this.staffMeetingScene !== null && this.phase === 'regularSeason',
      scoutMeetingDue: this.scoutMeetingScene !== null && this.phase === 'regularSeason',
      devCampPending: this.devCampPending && this.phase === 'offseason' && this.offseason?.stage !== 'preseason',
      ...(this.phase === 'offseason' && this.offseason
        ? {
            offseasonStageLabel: (
              {
                awards: 'Season awards',
                draft: 'Entry draft',
                resign: 'Re-signing window',
                freeAgency: `Free agency — day ${this.offseason.faDay + 1}`,
                preseason: 'Training camp',
              } as Record<string, string>
            )[this.offseason.stage],
          }
        : {}),
      campPending: this.trainingCamp !== null && !this.trainingCamp.resolved,
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
      unreadNews: this.curatedInboxNews().filter((n) => !n.read).length,
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
          plusMinus: t?.plusMinus ?? 0,
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

    // #188: GM role/trade-status + leadership read. "Own" = anyone in the org
    // (NHL roster + AHL affiliate) or a rights-held prospect the club controls —
    // those are the players the GM can set expectations for.
    const ownOrg = this.ownOrgIds().has(pid as string)
    const rightsHeld = playerForLeague?.rightsTeamId === this.userTeamId
    profile.isOwn = ownOrg || rightsHeld
    if (playerForLeague) {
      if (playerForLeague.squadStatus) {
        profile.squadStatus = playerForLeague.squadStatus
        profile.squadStatusLabel = SQUAD_STATUS_LABEL[playerForLeague.squadStatus]
      }
      if (playerForLeague.tradeStatus) profile.tradeStatus = playerForLeague.tradeStatus
      // #186: no-trade-clause + waive state (own players who hold a clause).
      if (profile.isOwn && playerForLeague.contract.noTradeClause) {
        profile.hasNtc = true
        if (playerForLeague.ntcWaived) profile.ntcWaived = true
        if (playerForLeague.tradeAcceptTeams && playerForLeague.tradeAcceptTeams.length > 0) {
          profile.tradeAcceptTeams = playerForLeague.tradeAcceptTeams.map((tid) => ({
            teamId: tid as string,
            name: this.data.teams.get(tid)?.name ?? (tid as string),
          }))
        }
      }
      // Leadership read for captaincy decisions (own players) + the letter he
      // currently wears (#189).
      if (profile.isOwn) {
        if (playerForLeague.leadership !== undefined) profile.leadershipRating = playerForLeague.leadership
        const lr = playerTeamId ? this.lockerRooms.get(playerTeamId) : undefined
        if (lr) {
          profile.captaincy = lr.captainId === (pid as string) ? 'C'
            : lr.alternateIds.includes(pid as string) ? 'A' : null
        }
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

  /* ────────────────────── convened bi-weekly staff meeting ────────────────────── */

  /** The user team's W-L-OTL for the meeting's opening line. */
  private userRecordTriple(): { w: number; l: number; otl: number } {
    const s = this.standings.get(this.userTeamId)
    return { w: s?.wins ?? 0, l: s?.losses ?? 0, otl: s?.overtimeLosses ?? 0 }
  }

  /** The staff voices for the meeting, from real hired staff (fallback names). */
  private staffCast(): StaffCast {
    const ts = this.getTeamStaff(this.userTeamId as string)
    const sp = (m: StaffMember | undefined, id: string, title: string): MeetingSpeaker => ({
      id,
      name: m?.name ?? title,
      title,
      ...(m?.faceId !== undefined ? { faceId: m.faceId } : {}),
      ...(m?.demeanor !== undefined ? { demeanor: m.demeanor } : {}),
    })
    return {
      headCoach: sp(ts.headCoach, 'hc', 'Head Coach'),
      asstCoach: sp(ts.assistantCoaches[0], 'ac', 'Assistant Coach'),
      physio: sp(ts.physios[0], 'py', 'Head Physio'),
      asstGM: sp(ts.assistantGM, 'agm', 'Assistant GM'),
    }
  }

  /** Read the live roster and produce the observations worth raising. Ordered by
   *  the scene builder; deduped so a player isn't flagged twice. */
  private buildStaffFindings(): StaffFinding[] {
    const team = this.data.teams.get(this.userTeamId)
    if (!team) return []
    const roster = team.roster.map((id) => this.resolve(id))
    const used = new Set<string>()
    const findings: StaffFinding[] = []

    const lineIdxOf = new Map<string, number>()
    team.lines?.forwards.forEach((line, idx) => {
      for (const id of line) lineIdxOf.set(id as string, idx)
    })

    // Injury risk (healthy but fragile/worn) — the physio's first concern.
    for (const p of roster) {
      if (p.injuryStatus !== null) continue
      const fatigue = Math.max(0, Math.min(100, p.fatigue))
      const risk = Math.round(Math.max(0, Math.min(100, (p.injuryProneness ?? 30) * 0.55 + fatigue * 0.45)))
      if (risk >= 55 && !used.has(p.id as string)) {
        used.add(p.id as string)
        findings.push({ kind: 'injuryRisk', playerId: p.id as string, name: p.name, risk, ltirEligible: this.ltirEligible(p) })
      }
    }
    // Worn down (condition) — distinct from injury risk.
    for (const p of roster) {
      if (p.injuryStatus !== null || used.has(p.id as string)) continue
      const condition = Math.round(100 - Math.max(0, Math.min(100, p.fatigue)))
      if (condition < 40) {
        used.add(p.id as string)
        findings.push({ kind: 'fatigued', playerId: p.id as string, name: p.name, condition })
      }
    }
    // Cold top-six forward — the assistant coach wants a line change.
    for (const p of roster) {
      if (p.injuryStatus !== null || used.has(p.id as string)) continue
      if (p.position !== 'C' && p.position !== 'W') continue
      const idx = lineIdxOf.get(p.id as string)
      if (idx === undefined || idx > 1) continue // top six only
      if (p.form <= -2) {
        used.add(p.id as string)
        findings.push({ kind: 'coldTopSix', playerId: p.id as string, name: p.name, lineIdx: idx, form: p.form })
      }
    }
    // Hot depth forward — earned a look on a scoring line.
    for (const p of roster) {
      if (p.injuryStatus !== null || used.has(p.id as string)) continue
      if (p.position !== 'C' && p.position !== 'W') continue
      const idx = lineIdxOf.get(p.id as string)
      if (idx === undefined || idx < 2) continue // depth lines only (3rd/4th)
      if (p.form >= 3) {
        used.add(p.id as string)
        findings.push({ kind: 'hotDepth', playerId: p.id as string, name: p.name, lineIdx: idx, form: p.form })
      }
    }
    // Prospect ready — the AGM pushes for a call-up.
    const prospect = this.readyProspectFinding(team, used)
    if (prospect) findings.push(prospect)
    // A prospect with no development plan — the assistant coach wants one set.
    const devPlan = this.devFocusFinding(team, used)
    if (devPlan) findings.push(devPlan)
    // Tactical misfit — the head coach wants to adjust to the personnel.
    const fit = Math.round(styleMatch(roster, team.tactics).fit)
    if (fit < 55) findings.push({ kind: 'tacticMisfit', coachFit: fit, direction: 'fitRoster' })

    // ── INFO briefings: staff report real numbers, no decision. The team-form
    //    briefing always opens; the rest ride along only when they have something
    //    to say (injuries present, a genuinely hard stretch, a real slump). ──
    findings.push(this.teamFormFinding())
    const injuryOutlook = this.injuryOutlookFinding(roster)
    if (injuryOutlook) findings.push(injuryOutlook)
    const toughStretch = this.toughStretchFinding()
    if (toughStretch) findings.push(toughStretch)
    const chemistry = this.lineChemistryFinding(team)
    if (chemistry) findings.push(chemistry)
    findings.push(this.capRosterFinding(team))
    const slump = this.slumpingStarFinding(roster, used)
    if (slump) findings.push(slump)

    return findings
  }

  /* ── INFO-briefing composers: each reads live state and returns pre-computed
   *    display numbers, so staffMeetingScene.ts stays pure. ── */

  /** State-of-the-team briefing: record, last-10, goals-for/against per game. */
  private teamFormFinding(): StaffFinding {
    const s = this.standings.get(this.userTeamId)
    const gp = Math.max(1, s?.gamesPlayed ?? 0)
    const w = s?.wins ?? 0, l = s?.losses ?? 0, otl = s?.overtimeLosses ?? 0
    // Last-10 record and current streak from the user's played games.
    const results: Array<'W' | 'L' | 'O'> = []
    for (const g of this.data.league.schedule) {
      if (!g.result) continue
      const home = g.homeTeamId === this.userTeamId
      if (!home && g.awayTeamId !== this.userTeamId) continue
      const us = home ? g.result.homeGoals : g.result.awayGoals
      const them = home ? g.result.awayGoals : g.result.homeGoals
      results.push(us > them ? 'W' : g.result.decidedBy === 'regulation' ? 'L' : 'O')
    }
    const last10 = results.slice(-10)
    const t10 = { w: last10.filter((r) => r === 'W').length, l: last10.filter((r) => r === 'L').length, o: last10.filter((r) => r === 'O').length }
    // Current streak text.
    let streakText = 'even of late'
    if (results.length > 0) {
      const last = results[results.length - 1]!
      let n = 0
      for (let i = results.length - 1; i >= 0 && results[i] === last; i--) n++
      streakText = last === 'W' ? `won ${n} straight` : last === 'L' ? `lost ${n} straight` : `${n} without a regulation win`
    }
    const trend: 'up' | 'down' | 'flat' = t10.w >= t10.l + 2 ? 'up' : t10.l >= t10.w + 2 ? 'down' : 'flat'
    return {
      kind: 'teamFormInfo',
      record: `${w}-${l}-${otl}`,
      points: s?.points ?? 0,
      lastTen: `${t10.w}-${t10.l}-${t10.o}`,
      gfPer: (s?.goalsFor ?? 0) / gp,
      gaPer: (s?.goalsAgainst ?? 0) / gp,
      streakText,
      trend,
    }
  }

  /** Injury-outlook briefing: who's hurt and roughly how long, worst first. */
  private injuryOutlookFinding(roster: Player[]): StaffFinding | null {
    const hurt = roster
      .filter((p) => p.injuryStatus !== null)
      .sort((a, b) => (b.injuryStatus!.gamesRemaining) - (a.injuryStatus!.gamesRemaining))
    if (hurt.length === 0) return null
    // ~3.5 NHL games per week → convert games-remaining to a weeks estimate.
    const items = hurt.slice(0, 4).map((p) => ({
      name: p.name,
      weeks: Math.round((p.injuryStatus!.gamesRemaining) / 3.5),
      desc: p.injuryStatus!.description,
    }))
    return { kind: 'injuryOutlookInfo', count: hurt.length, items }
  }

  /** Tough-stretch briefing: the next four opponents, flagged only when at least
   *  two of them are top-10 clubs by roster strength. */
  private toughStretchFinding(): StaffFinding | null {
    const descriptors = this.teamDescriptors().sort((a, b) => b.strength - a.strength)
    const total = descriptors.length
    const rankOf = new Map(descriptors.map((d, i) => [d.teamId, i + 1]))
    const upcoming = this.data.league.schedule
      .filter((g) => g.day > this.currentDay && (g.homeTeamId === this.userTeamId || g.awayTeamId === this.userTeamId))
      .sort((a, b) => a.day - b.day)
      .slice(0, 4)
    if (upcoming.length < 3) return null
    const opps = upcoming.map((g) => (g.homeTeamId === this.userTeamId ? g.awayTeamId : g.homeTeamId))
    const ranks = opps.map((id) => rankOf.get(id as string) ?? Math.ceil(total / 2))
    const toughCount = ranks.filter((r) => r <= 10).length
    if (toughCount < 2) return null
    const oppNames = opps.map((id) => this.data.teams.get(id)?.abbreviation ?? this.data.teams.get(id)?.name ?? '—')
    const avgRank = Math.round(ranks.reduce((a, b) => a + b, 0) / ranks.length)
    return { kind: 'toughStretchInfo', games: upcoming.length, oppNames, toughCount, avgRank, totalTeams: total }
  }

  /** Line-chemistry briefing: best & worst forward line by complementarity. */
  private lineChemistryFinding(team: Team): StaffFinding | null {
    const lines = team.lines?.forwards
    if (!lines || lines.length === 0) return null
    const rated = lines
      .map((line, idx) => {
        const players = line.map((id) => this.data.players.get(id as PlayerId)).filter((p): p is Player => !!p)
        if (players.length !== 3) return null
        const syn = lineSynergy(players)
        return { idx, score: Math.round(syn.score), reason: syn.notes[0] ?? 'balanced group' }
      })
      .filter((r): r is { idx: number; score: number; reason: string } => r !== null)
    if (rated.length < 2) return null
    const best = rated.reduce((a, b) => (b.score > a.score ? b : a))
    const worst = rated.reduce((a, b) => (b.score < a.score ? b : a))
    if (best.idx === worst.idx || best.score - worst.score < 8) return null // nothing worth noting
    const lineNm = (i: number): string => (i === 0 ? 'Top line' : i === 1 ? '2nd line' : i === 2 ? '3rd line' : '4th line')
    return {
      kind: 'lineChemistryInfo',
      bestLine: lineNm(best.idx), bestScore: best.score, bestReason: best.reason,
      worstLine: lineNm(worst.idx), worstScore: worst.score, worstReason: worst.reason,
    }
  }

  /** Cap & roster briefing: space, usage, active roster size. Always available. */
  private capRosterFinding(team: Team): StaffFinding {
    const cap = this.userTeam.finances.salaryCap
    const used = this.userCapUsed() + this.userDeadCap
    const space = Math.max(0, cap - used)
    return {
      kind: 'capRosterInfo',
      capSpaceM: space / 1_000_000,
      usedPct: cap > 0 ? Math.round((used / cap) * 100) : 0,
      rosterSize: team.roster.length,
    }
  }

  /** Slumping-key-player briefing: a top-line/pair skater whose season points
   *  pace is well below what his rating tier should produce. Info only. */
  private slumpingStarFinding(roster: Player[], used: Set<string>): StaffFinding | null {
    let worst: { p: Player; ppg: number; expected: number; behind: number; games: number } | null = null
    for (const p of roster) {
      if (p.position === 'G' || p.injuryStatus !== null || used.has(p.id as string)) continue
      const ovr = ratedOverall(p)
      if (ovr < 75) continue // only players we lean on
      const games = this.gp.get(p.id as PlayerId) ?? 0
      if (games < 12) continue // need a real sample before calling a slump
      const t = this.totals.get(p.id as PlayerId)
      const points = (t?.goals ?? 0) + (t?.assists ?? 0)
      const ppg = points / games
      // Expected pace from rating tier (calibrated to typical NHL scoring bands).
      const expected = ovr >= 88 ? 1.0 : ovr >= 83 ? 0.75 : ovr >= 78 ? 0.55 : 0.42
      if (ppg >= expected * 0.7) continue // producing acceptably
      const behind = Math.round((expected - ppg) * games)
      if (behind < 3) continue
      if (!worst || behind > worst.behind) worst = { p, ppg, expected, behind, games }
    }
    if (!worst) return null
    used.add(worst.p.id as string)
    return { kind: 'slumpingStarInfo', name: worst.p.name, ppg: worst.ppg, expectedPpg: worst.expected, games: worst.games, pointsBehind: worst.behind }
  }

  /** A young, high-upside org player (NHL or AHL) with NO individual development
   *  plan set — the assistant coach flags him so the GM points his practice
   *  somewhere. Returns the highest-ceiling such player, or null. */
  private devFocusFinding(team: Team, used: Set<string>): StaffFinding | null {
    const focusSet = new Set(this.practiceState.perPlayerFocus.map(([pid]) => pid))
    const ahlId = team.affiliateId
    const ahlRoster = ahlId ? (this.data.teams.get(ahlId)?.roster ?? []) : []
    const pool: Array<{ p: Player; where: string }> = [
      ...team.roster.map((id) => ({ p: this.resolve(id), where: 'on the NHL roster' })),
      ...ahlRoster.map((id) => this.data.players.get(id)).filter((p): p is Player => !!p).map((p) => ({ p, where: 'down in the AHL' })),
    ]
    const label: Record<string, string> = {
      offense: 'his offence', defense: 'his defensive game', skating: 'his skating',
      physical: 'his physical game', goaltending: 'his goaltending',
    }
    let best: { p: Player; where: string; focus: string; ceil: number } | null = null
    for (const { p, where } of pool) {
      if (used.has(p.id as string) || focusSet.has(p.id as string)) continue
      if (p.age > 23) continue // development plans are for the young ones
      const ceil = this.scoutedCeilingOf(p)
      if (ceil < 74) continue // only genuine upside is worth a plan
      const focus = suggestPlayerFocus(p)
      if (!label[focus]) continue // 'balanced'/'recovery' — nothing pointed to pitch
      if (!best || ceil > best.ceil) best = { p, where, focus, ceil }
    }
    if (!best) return null
    used.add(best.p.id as string)
    return {
      kind: 'devFocusUnset',
      playerId: best.p.id as string,
      name: best.p.name,
      potential: Math.round(best.ceil),
      suggested: label[best.focus]!,
      where: best.where,
    }
  }

  /** Best AHL skater clearly better than the weakest NHL regular — a call-up case. */
  private readyProspectFinding(team: Team, used: Set<string>): StaffFinding | null {
    const ahlId = team.affiliateId
    if (!ahlId) return null
    const ahl = this.data.teams.get(ahlId)
    if (!ahl) return null
    const nhlSkaters = team.roster.map((id) => this.resolve(id)).filter((p) => p.position !== 'G')
    if (nhlSkaters.length < 12) return null
    let weakest = nhlSkaters[0]!
    for (const p of nhlSkaters) if (ratedOverall(p) < ratedOverall(weakest)) weakest = p
    const bar = ratedOverall(weakest)
    let best: Player | null = null
    for (const id of ahl.roster) {
      const p = this.data.players.get(id)
      if (!p || p.position === 'G' || used.has(p.id as string)) continue
      // Playtest #14: a prospect the GM already declined to promote this season
      // stays off the agenda — no re-pitching the same kid every meeting.
      if (this.declinedCallups.get(p.id as string) === this.year) continue
      if (best === null || ratedOverall(p) > ratedOverall(best)) best = p
    }
    if (best && ratedOverall(best) >= bar + 3) {
      used.add(best.id as string)
      return { kind: 'prospectReady', playerId: best.id as string, name: best.name, overall: Math.round(ratedOverall(best)), weakestName: weakest.name }
    }
    return null
  }

  /** The pending staff meeting as a render-ready view (or null if none). */
  getStaffMeeting(): StaffMeetingView | null {
    const scene = this.staffMeetingScene
    if (!scene) return null
    const speakerById = new Map(scene.cast.map((c) => [c.id, c]))
    return {
      day: scene.day,
      year: scene.year,
      opening: scene.opening.map((l) => l.text).join(' '),
      proposals: scene.proposals.map((p) => ({
        id: p.id,
        speaker: speakerById.get(p.speakerId) ?? { id: p.speakerId, name: 'Staff', title: '' },
        title: p.title,
        intro: p.intro.map((l) => l.text),
        options: p.options.map((o) => ({ id: o.id, label: o.label, detail: o.detail })),
        defaultOptionId: p.defaultOptionId,
        ...(p.info ? { info: true } : {}),
        ...(p.facts ? { facts: p.facts } : {}),
      })),
    }
  }

  /** Resolve the meeting with the GM's picks; each accepted option mutates the sim. */
  submitStaffMeeting(choices: Record<string, string>): { applied: string[]; summary: string } {
    const scene = this.staffMeetingScene
    if (!scene) return { applied: [], summary: 'No staff meeting is in session.' }
    const applied = this.applyStaffChoices(scene, choices)
    this.staffMeetingScene = null
    this.pushNews(
      'league',
      'Staff meeting wrapped',
      applied.length ? applied.join(' ') : 'You heard the staff out and left things as they are.',
      { teamId: this.userTeamId as string }
    )
    return {
      applied,
      summary: applied.length
        ? `${applied.length} decision${applied.length === 1 ? '' : 's'} actioned.`
        : 'No changes made.',
    }
  }

  /** Hand the meeting to the AGM — each item resolves to its safe default. */
  delegateStaffMeeting(): { applied: string[]; summary: string } {
    const scene = this.staffMeetingScene
    if (!scene) return { applied: [], summary: 'No staff meeting is in session.' }
    const applied = this.applyStaffChoices(scene, delegatedChoices(scene))
    this.staffMeetingScene = null
    this.pushNews(
      'league',
      'You left it to the staff',
      applied.length ? `Your AGM ran the meeting: ${applied.join(' ')}` : 'Your AGM ran the meeting; nothing needed doing.',
      { teamId: this.userTeamId as string }
    )
    return { applied, summary: `Delegated — ${applied.length} decision${applied.length === 1 ? '' : 's'} handled by staff.` }
  }

  /** Auto-resolve a pending meeting with safe defaults (non-gated auto-sim past it). */
  private autoDelegateStaffMeeting(): void {
    const scene = this.staffMeetingScene
    if (!scene) return
    this.applyStaffChoices(scene, delegatedChoices(scene))
    this.staffMeetingScene = null
  }

  /* ────────────────────────── scout meeting ────────────────────────── */

  /** The pending scout meeting as a render-ready view (or null if none). */
  getScoutMeeting(): ScoutMeetingView | null {
    const scene = this.scoutMeetingScene
    if (!scene) return null
    const speakerById = new Map(scene.cast.map((c) => [c.id, c]))
    const host = speakerById.get(scene.hostId) ?? scene.cast[0] ?? { id: scene.hostId, name: 'Head of Scouting', title: 'Head of Scouting' }
    return {
      day: scene.day,
      year: scene.year,
      host,
      opening: scene.opening.map((l) => l.text).join(' '),
      risers: scene.risers,
      fallers: scene.fallers,
      gaps: scene.gaps,
      proposals: scene.proposals.map((p) => ({
        id: p.id,
        speaker: speakerById.get(p.speakerId) ?? host,
        title: p.title,
        intro: p.intro.map((l) => l.text),
        options: p.options.map((o) => ({ id: o.id, label: o.label, detail: o.detail })),
        defaultOptionId: p.defaultOptionId,
      })),
    }
  }

  /** Resolve the scout meeting with the GM's picks; each accepted option mutates the sim. */
  submitScoutMeeting(choices: Record<string, string>): { applied: string[]; summary: string } {
    const scene = this.scoutMeetingScene
    if (!scene) return { applied: [], summary: 'No scout meeting is in session.' }
    const applied = this.applyScoutChoices(scene, choices)
    this.scoutMeetingScene = null
    this.pushNews(
      'scouting',
      'Scout meeting wrapped',
      applied.length ? applied.join(' ') : 'You heard the recruitment staff out and left things as they are.',
      { press: { byline: 'Head of Scouting — Recruitment', kind: 'scoutMeeting' } },
    )
    return {
      applied,
      summary: applied.length
        ? `${applied.length} decision${applied.length === 1 ? '' : 's'} actioned.`
        : 'No changes made.',
    }
  }

  /** Hand the scout meeting to the Head of Scouting — each item to its safe default. */
  delegateScoutMeeting(): { applied: string[]; summary: string } {
    const scene = this.scoutMeetingScene
    if (!scene) return { applied: [], summary: 'No scout meeting is in session.' }
    const applied = this.applyScoutChoices(scene, delegatedScoutChoices(scene))
    this.scoutMeetingScene = null
    this.pushNews(
      'scouting',
      'You left the board to the staff',
      applied.length ? `Your Head of Scouting ran the meeting: ${applied.join(' ')}` : 'Your Head of Scouting ran the meeting; nothing needed doing.',
      { press: { byline: 'Head of Scouting — Recruitment', kind: 'scoutMeeting' } },
    )
    return { applied, summary: `Delegated — ${applied.length} decision${applied.length === 1 ? '' : 's'} handled by the staff.` }
  }

  /** Auto-resolve a pending scout meeting with safe defaults (non-gated auto-sim past it). */
  private autoDelegateScoutMeeting(): void {
    const scene = this.scoutMeetingScene
    if (!scene) return
    this.applyScoutChoices(scene, delegatedScoutChoices(scene))
    this.scoutMeetingScene = null
  }

  private applyScoutChoices(scene: ScoutMeetingScene, choices: Record<string, string>): string[] {
    const receipts: string[] = []
    for (const p of scene.proposals) {
      const optId = choices[p.id] ?? p.defaultOptionId
      const opt = p.options.find((o) => o.id === optId)
      if (!opt) continue
      const r = this.applyScoutMeetingAction(opt.action)
      if (r) receipts.push(r)
    }
    return receipts
  }

  /** Dispatch a single accepted scout-meeting proposal to the real mutation API. */
  private applyScoutMeetingAction(action: ScoutMeetingAction): string | null {
    switch (action.type) {
      case 'none':
        return null
      case 'track': {
        const name = this.data.players.get(asPlayerId(action.playerId))?.name ?? 'A prospect'
        const r = this.shortlistProspect(action.playerId)
        return r.ok ? `${name} added to the shortlist.` : null
      }
      case 'refocus': {
        const scout = this.scouting.assignments.find((s) => s.scoutId === action.scoutId)
        const who = scout?.name ?? 'A scout'
        this.assignScoutTarget(action.scoutId, action.target, action.focus)
        return `${who} re-aimed to close a coverage gap.`
      }
    }
  }

  /** The scout-meeting cast: the club's scouts, hosted by the top-rated one. */
  private scoutMeetingCast(): { cast: MeetingSpeaker[]; hostId: string } {
    const scouts = [...this.getTeamStaff(this.userTeamId as string).scouts]
      .sort((a, b) => b.rating - a.rating)
    const cast: MeetingSpeaker[] = scouts.slice(0, 4).map((s, i) => ({
      id: i === 0 ? 'hs' : `sc${i}`,
      name: s.name,
      title: i === 0 ? 'Head of Scouting' : 'Scout',
      ...(s.faceId !== undefined ? { faceId: s.faceId } : {}),
      ...(s.demeanor !== undefined ? { demeanor: s.demeanor } : {}),
    }))
    if (cast.length === 0) cast.push({ id: 'hs', name: 'Head of Scouting', title: 'Head of Scouting' })
    return { cast, hostId: cast[0]!.id }
  }

  /** Digest the live scouting state into the scout-meeting input (or null). */
  private buildScoutMeetingInput(day: number): ScoutMeetingInput | null {
    const { cast, hostId } = this.scoutMeetingCast()
    const view = this.getScouting()

    // Risers / fallers: where OUR board (getDraftRankings scoutBoard) sits above or
    // below the public consensus, restricted to prospects our staff has actually
    // seen (so it's a real opinion, not fog).
    const board = this.getDraftRankings().scoutBoard
    const toLine = (r: typeof board[number]): ScoutBoardLine => ({
      playerId: r.playerId,
      name: r.name,
      position: r.position,
      note: `${r.movement > 0 ? '+' : ''}${r.movement} vs consensus`,
    })
    const risers = board.filter((r) => r.seen && r.verdict === 'higher').slice(0, 4).map(toLine)
    const fallers = board.filter((r) => r.seen && r.verdict === 'lower').slice(0, 3).map(toLine)

    // Coverage gaps: position groups the roster is thin at, plus any region with no
    // scout on it (a nation we know nothing about).
    const gaps: string[] = []
    for (const need of view.rosterNeeds) gaps.push(`thin at ${need}`)
    const uncovered = view.nationCoverage
      .filter((n) => n.avgKnowledge < 12 && n.playerCount >= 8)
      .sort((a, b) => a.avgKnowledge - b.avgKnowledge)
    for (const n of uncovered.slice(0, 2)) gaps.push(`no eyes in ${n.label}`)

    // Trackable finds: flagged prospects the GM hasn't shortlisted yet, best first.
    const shortlisted = new Set(this.scouting.shortlist ?? [])
    const trackable: TrackableFind[] = view.recommendations
      .filter((r) => !shortlisted.has(r.playerId))
      .slice(0, 4)
      .map((r) => ({ playerId: r.playerId, name: r.name, position: r.position, grade: r.grade, reason: r.reason }))

    // Refocus: aim a generalist scout (idle/utility, no specialty) at the biggest
    // gap — an uncovered region if there is one, else the draft class.
    let refocus: RefocusCandidate | null = null
    const generalists = view.scouts.filter((s) => !s.specialtyNation)
    const pickScout = generalists[0] ?? view.scouts[0]
    if (pickScout) {
      const region = uncovered[0]
      if (region && region.nation) {
        refocus = {
          scoutId: pickScout.scoutId, scoutName: pickScout.name,
          target: { kind: 'nation', nation: region.nation }, focus: 'all',
          label: region.label, why: `we've barely any read on ${region.label}`,
        }
      } else if (view.hasDraftClass && pickScout.target.kind !== 'draftClass') {
        refocus = {
          scoutId: pickScout.scoutId, scoutName: pickScout.name,
          target: { kind: 'draftClass' }, focus: 'youth',
          label: 'the draft class', why: `we're light on this year's draft class`,
        }
      }
    }

    return { cast, hostId, day, year: this.year, risers, fallers, gaps, trackable, refocus }
  }

  private applyStaffChoices(scene: StaffMeetingScene, choices: Record<string, string>): string[] {
    const receipts: string[] = []
    for (const p of scene.proposals) {
      const optId = choices[p.id] ?? p.defaultOptionId
      const opt = p.options.find((o) => o.id === optId)
      if (!opt) continue
      // Playtest #14: if this proposal offered a call-up and the GM picked
      // something other than it, remember the "no" so the staff stops
      // re-pitching the same prospect for the rest of the season.
      const callUpOpt = p.options.find((o) => o.action.type === 'callUp')
      if (callUpOpt && opt.action.type !== 'callUp' && callUpOpt.action.type === 'callUp') {
        this.declinedCallups.set(callUpOpt.action.playerId, this.year)
      }
      const r = this.applyStaffAction(opt.action)
      if (r) receipts.push(r)
    }
    return receipts
  }

  /** Dispatch a single accepted proposal to the real mutation API. */
  private applyStaffAction(action: StaffAction): string | null {
    const nameOf = (id: string): string => this.data.players.get(asPlayerId(id))?.name ?? 'A player'
    switch (action.type) {
      case 'none':
        return null
      case 'rest': {
        const r = this.restPlayer(action.playerId)
        return r.ok && r.resting ? `${nameOf(action.playerId)} is being rested.` : null
      }
      case 'scratch': {
        this.toggleScratchPlayer(action.playerId)
        return `${nameOf(action.playerId)} is a healthy scratch.`
      }
      case 'ltir': {
        const r = this.placeOnLtir(action.playerId)
        return r.ok ? `${nameOf(action.playerId)} placed on LTIR.` : null
      }
      case 'callUp': {
        const r = this.callUp(action.playerId)
        return r.ok ? `${nameOf(action.playerId)} recalled to the NHL.` : null
      }
      case 'tactic': {
        const r = this.suggestToCoach(action.direction)
        return r.accepted ? 'The system was adjusted toward the roster.' : 'The coach pushed back on the tactical change.'
      }
      case 'setDevFocus': {
        const p = this.data.players.get(asPlayerId(action.playerId))
        if (!p) return null
        this.practiceState = setPlayerFocus(this.practiceState, action.playerId, suggestPlayerFocus(p))
        return `${nameOf(action.playerId)} now has a development plan.`
      }
      case 'moveLine': {
        const moved = this.moveForwardToLine(action.playerId, action.toLine)
        const where = action.toLine === 2 ? 'third' : action.toLine === 3 ? 'fourth' : action.toLine === 1 ? 'second' : 'top'
        return moved ? `${nameOf(action.playerId)} moved to the ${where} line.` : null
      }
    }
  }

  /** Move a forward to another line, swapping same-slot to keep C/W positioning. */
  private moveForwardToLine(playerId: string, toLine: number): boolean {
    const cur = this.userTeam.lines
    if (!cur || cur.forwards.length <= toLine) return false
    let from = -1
    let slot = -1
    cur.forwards.forEach((line, li) => {
      line.forEach((id, si) => {
        if ((id as string) === playerId) { from = li; slot = si }
      })
    })
    if (from < 0 || from === toLine) return false
    const upd: LinesUpdate = {
      forwards: cur.forwards.map((l) => [l[0] as string, l[1] as string, l[2] as string]),
      defensePairs: cur.defensePairs.map((p) => [p[0] as string, p[1] as string]),
      goalies: [cur.goalies[0] as string, cur.goalies[1] as string],
      powerPlayUnits: cur.powerPlayUnits.map((u) => u.map((id) => id as string)),
      penaltyKillUnits: cur.penaltyKillUnits.map((u) => u.map((id) => id as string)),
    }
    const tmp = upd.forwards[toLine]![slot]!
    upd.forwards[toLine]![slot] = upd.forwards[from]![slot]!
    upd.forwards[from]![slot] = tmp
    this.setLines(upd)
    return true
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
    // Name the specific player the owner means, so it isn't an anonymous "a
    // beloved veteran". Pick an expiring, long-in-the-tooth fan favourite.
    if (req.kind === 'extendFanFavourite') {
      const vet = this.fanFavouriteVeteran()
      if (vet) {
        const last = vet.name.split(' ').pop() ?? vet.name
        req.body = `${vet.name} — a beloved veteran — is up for a new deal, and the owner does not want to read the backlash if he walks: "${last} stays, figure it out." Keeping him is good PR; letting him go is a fight with the boss.`
      }
    }
    this.ownerRequest = req
    this.pushNews('league', req.title, `${req.body}\n\nHead to Club Vision to respond to the owner.`, {
      teamId: this.userTeamId as string,
    })
  }

  /** An expiring, long-serving veteran the owner would fight to keep. */
  private fanFavouriteVeteran(): Player | undefined {
    const team = this.data.teams.get(this.userTeamId)
    if (!team) return undefined
    return team.roster
      .map((id) => this.resolve(id))
      .filter((p) => p.age >= 30 && p.contract.yearsRemaining <= 1 && ratedOverall(p) >= 68)
      .sort((a, b) => b.age + ratedOverall(b) - (a.age + ratedOverall(a)))[0]
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
      const capUsed = capUsedFor(team, this.data.players)
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
    const view = buildTeamDynamics({
      teamId,
      teamName: team?.name ?? teamId,
      roster,
      lockerRoom: lr,
      headCoachName: coach.name,
      ...(coach.faceId !== undefined ? { headCoachFaceId: coach.faceId } : {}),
    })
    // LW5: the user club's dynamics page carries the promise ledger — your
    // word, in writing, with the receipts.
    if (teamId === (this.userTeamId as string)) view.isUserClub = true
    if (teamId === (this.userTeamId as string) && this.playerPromises.length > 0) {
      view.promises = [...this.playerPromises]
        .sort((a, b) => (b.year - a.year) || (b.day - a.day))
        .slice(0, 12)
        .map((pr) => {
          const p = this.data.players.get(asPlayerId(pr.playerId))
          return {
            playerId: pr.playerId,
            playerName: p?.name ?? 'Former player',
            ...(p?.faceId !== undefined ? { faceId: p.faceId } : {}),
            text: pr.text,
            madeLabel: dayToDateISO(pr.year, Math.max(1, pr.day)),
            dueLabel: pr.status === 'open'
              ? (pr.dueDay !== undefined ? dayToDateISO(pr.year, pr.dueDay) : 'season end')
              : (pr.status === 'kept' ? 'kept' : 'broken'),
            status: pr.status,
          }
        })
    }
    return view
  }

  /** #171: the user club's future game days, soonest first (for injury timelines). */
  private userUpcomingGameDays(): number[] {
    const uid = this.userTeamId as string
    return this.data.league.schedule
      .filter((g) => (g.homeTeamId as string) === uid || (g.awayTeamId as string) === uid)
      .map((g) => g.day)
      .filter((d) => d >= this.currentDay)
      .sort((a, b) => a - b)
  }

  /** #157: total cap relief the user's club is getting from players on LTIR —
   *  the sum of the cap hits of rostered players who are on LTIR AND still hurt. */
  private userLtirRelief(): number {
    let relief = 0
    for (const id of this.userTeam.roster) {
      const p = this.data.players.get(id)
      if (p?.ltir && p.injuryStatus) relief += p.contract.salary
    }
    return relief
  }

  /** The user's cap hit AFTER LTIR relief — the number every user-facing cap
   *  gate and cap-space display should use. */
  private userCapUsed(): number {
    // capUsedFor already nets out any salary a former club retained on a player
    // the user now rosters, and adds salary the user retained on players he moved.
    return capUsedFor(this.userTeam, this.data.players) - this.userLtirRelief()
  }

  /** #157: is this rostered player eligible to be placed on LTIR right now? */
  private ltirEligible(p: Player): boolean {
    return !p.ltir && p.injuryStatus !== null && p.injuryStatus.gamesRemaining >= LTIR_MIN_GAMES
  }

  /** #157: place a long-term-injured player on LTIR, freeing his cap hit so a
   *  replacement can be signed over the ceiling until he returns. */
  placeOnLtir(playerId: string): { ok: boolean; message: string } {
    const id = asPlayerId(playerId)
    if (!this.userTeam.roster.includes(id)) return { ok: false, message: 'He is not on your roster.' }
    const p = this.data.players.get(id)
    if (!p) return { ok: false, message: 'Unknown player.' }
    if (p.ltir) return { ok: false, message: `${p.name} is already on LTIR.` }
    if (!p.injuryStatus || p.injuryStatus.gamesRemaining < LTIR_MIN_GAMES) {
      return { ok: false, message: `LTIR needs a long-term injury (${LTIR_MIN_GAMES}+ games out). ${p.name} doesn't qualify.` }
    }
    p.ltir = true
    this.pushNews('contract', `${p.name} placed on LTIR`,
      `${p.name} goes on Long-Term Injured Reserve. His $${(p.contract.salary / 1e6).toFixed(2)}M cap hit is relieved while he's out — you can now sign a replacement over the ceiling. He comes off LTIR automatically when he's fit.`,
      { playerId, teamId: this.userTeamId as string })
    return { ok: true, message: `${p.name} on LTIR — $${(p.contract.salary / 1e6).toFixed(2)}M in cap relief.` }
  }

  /** #157: take a player off LTIR early (his cap hit counts again immediately). */
  activateFromLtir(playerId: string): { ok: boolean; message: string } {
    const id = asPlayerId(playerId)
    const p = this.data.players.get(id)
    if (!p) return { ok: false, message: 'Unknown player.' }
    if (!p.ltir) return { ok: false, message: `${p.name} isn't on LTIR.` }
    p.ltir = false
    this.pushNews('contract', `${p.name} activated off LTIR`,
      `${p.name} is back on the active cap sheet — his $${(p.contract.salary / 1e6).toFixed(2)}M hit counts again.`,
      { playerId, teamId: this.userTeamId as string })
    return { ok: true, message: `${p.name} activated — cap relief removed.` }
  }

  /** Medical Center: condition / fatigue / injury / injury-risk for the user roster. */
  getMedical(): MedicalView {
    const team = this.data.teams.get(this.userTeamId)
    const rows: MedicalRow[] = []
    let injuredCount = 0
    let gamesToReturnTotal = 0
    // #171: map "games remaining" → an estimated return DATE off the real schedule.
    const futureDays = this.userUpcomingGameDays()
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
      let timeline: { estReturn?: string; severity?: MedicalRow['severity'] } = {}
      if (p.injuryStatus) {
        const gr = p.injuryStatus.gamesRemaining
        gamesToReturnTotal += gr
        // He sits out `gr` games and returns for the next one — futureDays[gr].
        const returnDay = futureDays[gr]
        const severity: MedicalRow['severity'] = gr <= 2 ? 'day-to-day' : gr <= 8 ? 'weeks' : 'long-term'
        timeline = { severity, ...(returnDay !== undefined ? { estReturn: dayToDateISO(this.year, returnDay) } : {}) }
      }
      const row: MedicalRow = {
        playerId: id as unknown as string,
        name: p.name,
        position: p.position,
        condition,
        fatigue,
        riskLabel,
        risk,
        ...timeline,
        ...(p.resting ? { resting: true } : {}),
        ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
        ...(p.injuryStatus ? { injuryDescription: p.injuryStatus.description, injuryGamesRemaining: p.injuryStatus.gamesRemaining, injuryKind: p.injuryStatus.kind } : {}),
        // #157: LTIR status + eligibility + cap hit (for the relief lever).
        ...(p.ltir ? { ltir: true } : {}),
        ...(this.ltirEligible(p) ? { ltirEligible: true } : {}),
        ...(p.injuryStatus ? { capHit: p.contract.salary } : {}),
      }
      rows.push(row)
    }
    // Most at-risk / injured first.
    rows.sort((a, b) => b.risk - a.risk)
    // #171: the head physio (best-rated) — the staff behind the recoveries.
    const physio = [...this.getTeamStaff(this.userTeamId as string).physios]
      .sort((a, b) => (b.physiotherapy ?? b.rating) - (a.physiotherapy ?? a.rating))[0]
    return {
      teamName: team?.name ?? 'Team',
      injuredCount,
      gamesToReturnTotal,
      ...(physio ? { physioName: physio.name, physioRating: physio.physiotherapy ?? physio.rating } : {}),
      // #157: total LTIR cap relief currently in effect.
      ltirRelief: this.userLtirRelief(),
      rows,
    }
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

    const view = buildDevelopmentCenter({
      teamName: team?.name ?? 'Team',
      roster,
      affiliate,
      stars,
      rosterAdvice: { callUps, sendDowns },
      systemElsewhere,
    })
    // #174: surface each prospect's individual development focus so the Dev Center
    // can set it right where you evaluate him.
    const focusOf = new Map(this.practiceState.perPlayerFocus)
    const annotate = (r: DevelopmentRow): void => { const f = focusOf.get(r.playerId); if (f) r.focus = f }
    view.rows.forEach(annotate)
    view.systemElsewhere.forEach(annotate)
    return view
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
    const teamIds = [...this.data.league.teams]

    const strength = new Map<TeamId, number>()
    const basePts = new Map<TeamId, number>()
    const gamesPlayed = new Map<TeamId, number>()
    const gamesRemaining = new Map<TeamId, number>()
    const confOf = new Map<TeamId, string>()
    const divOf = new Map<TeamId, string>()
    for (const t of teamIds) {
      const team = this.data.teams.get(t)
      strength.set(t, teamStrengthRating((team?.roster ?? []).map((id) => this.resolve(id))))
      const st = this.standings.get(t)
      basePts.set(t, st?.points ?? 0)
      gamesPlayed.set(t, st?.gamesPlayed ?? 0)
      gamesRemaining.set(t, 0)
      confOf.set(t, team?.conferenceId ?? '')
      divOf.set(t, team?.divisionId ?? '')
    }

    const remaining = this.data.league.schedule.filter((g) => g.day > this.currentDay)
    for (const g of remaining) {
      gamesRemaining.set(g.homeTeamId, (gamesRemaining.get(g.homeTeamId) ?? 0) + 1)
      gamesRemaining.set(g.awayTeamId, (gamesRemaining.get(g.awayTeamId) ?? 0) + 1)
    }

    const confs = [...new Set(teamIds.map((t) => confOf.get(t)!))]
    // Qualifiers per conference — matches seedBracket: 8 for a large league
    // (32-team → 16-team playoff), else 4. This is why a mid-pack team in a big
    // league now shows real odds instead of a near-zero top-4 chance.
    const minConfSize = Math.min(...confs.map((c) => teamIds.filter((t) => confOf.get(t) === c).length))
    const QUAL = minConfSize >= 12 ? 8 : 4
    // Mirror seedBracket: when the field is 8 and each conference splits into ≥2
    // divisions, qualify the NHL way (top 3 per division + 2 wildcards) so the
    // odds screen agrees with the bracket a mid-division team actually faces.
    const useDivisional =
      QUAL === 8 &&
      confs.every((c) => new Set(teamIds.filter((t) => confOf.get(t) === c).map((t) => divOf.get(t))).size >= 2)
    /** Teams from one conference that make the playoffs under the current `pts`. */
    const qualifiersInConf = (members: TeamId[]): TeamId[] =>
      qualifiersInConference(members, (t) => divOf.get(t) ?? '', QUAL, useDivisional)
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
        for (const t of qualifiersInConf(members)) {
          playoffCount.set(t, playoffCount.get(t)! + 1)
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
    return { available: true, simulations: N, userTeamId: userId, qualifiers: QUAL, rows }
  }

  /**
   * The user's *mathematical* playoff-berth status right now: 'clinched' (in no
   * matter how the season plays out), 'eliminated' (out no matter what), or
   * 'alive'. Sound and conservative: for clinch the user loses out while every
   * rival wins out (ties broken against the user); for elimination the user wins
   * out while rivals lose out (ties broken for the user). It ignores that rivals
   * play each other, so it can trail the true clinch by a day or two — but it
   * never declares a clinch or elimination that isn't real. Reuses the same
   * divisional qualifier logic as the odds screen.
   */
  private userPlayoffBerthStatus(): 'clinched' | 'eliminated' | 'alive' {
    if (this.phase !== 'regularSeason') return 'alive'
    const teamIds = [...this.data.league.teams]
    const user = this.userTeamId
    const confOf = new Map<TeamId, string>()
    const divOf = new Map<TeamId, string>()
    const basePts = new Map<TeamId, number>()
    const gr = new Map<TeamId, number>()
    for (const t of teamIds) {
      const team = this.data.teams.get(t)
      confOf.set(t, team?.conferenceId ?? '')
      divOf.set(t, team?.divisionId ?? '')
      basePts.set(t, this.standings.get(t)?.points ?? 0)
      gr.set(t, 0)
    }
    for (const g of this.data.league.schedule) {
      if (g.day <= this.currentDay) continue
      gr.set(g.homeTeamId, (gr.get(g.homeTeamId) ?? 0) + 1)
      gr.set(g.awayTeamId, (gr.get(g.awayTeamId) ?? 0) + 1)
    }
    const confs = [...new Set(teamIds.map((t) => confOf.get(t)!))]
    const minConfSize = Math.min(...confs.map((c) => teamIds.filter((t) => confOf.get(t) === c).length))
    const qual = minConfSize >= 12 ? 8 : 4
    const useDivisional =
      qual === 8 &&
      confs.every((c) => new Set(teamIds.filter((t) => confOf.get(t) === c).map((t) => divOf.get(t))).size >= 2)
    const userConf = confOf.get(user)!
    const members = teamIds.filter((t) => confOf.get(t) === userConf)

    // Does the user land in the field under a given final-points scenario?
    const userQualifies = (ptsOf: (t: TeamId) => number): boolean => {
      const sorted = [...members].sort((a, b) => ptsOf(b) - ptsOf(a) || (a < b ? -1 : 1))
      return qualifiersInConference(sorted, (t) => divOf.get(t) ?? '', qual, useDivisional).includes(user)
    }

    // Clinch: user loses every remaining game (and every tie), rivals win out.
    const clinchPts = (t: TeamId): number =>
      t === user ? basePts.get(t)! - 0.5 : basePts.get(t)! + 2 * gr.get(t)!
    if (userQualifies(clinchPts)) return 'clinched'

    // Elimination: user wins every remaining game (and every tie), rivals lose out.
    const elimPts = (t: TeamId): number =>
      t === user ? basePts.get(t)! + 2 * gr.get(t)! + 0.5 : basePts.get(t)!
    if (!userQualifies(elimPts)) return 'eliminated'

    return 'alive'
  }

  /** Fire a one-time headline the day the user mathematically clinches a
   *  playoff berth or is eliminated from contention. */
  private checkPlayoffBerth(): void {
    if (this.phase !== 'regularSeason' || this.playoffBerthAnnounced) return
    const status = this.userPlayoffBerthStatus()
    if (status === 'alive') return
    const team = this.userTeam
    this.playoffBerthAnnounced = status
    if (status === 'clinched') {
      this.pushNews(
        'playoffs',
        `${team.name} clinch a playoff spot`,
        `It's official — the ${team.name} have mathematically secured a place in the playoffs. The regular-season job is done; now the real tournament begins.`,
        { teamId: this.userTeamId as string, salience: 90 }
      )
    } else {
      this.pushNews(
        'playoffs',
        `${team.name} eliminated from playoff contention`,
        `The ${team.name} can no longer reach the playoffs — mathematically out with the season still running. Attention turns to pride, development, and the draft lottery.`,
        { teamId: this.userTeamId as string, salience: 85 }
      )
    }
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
    const dismissed = new Set(st.dismissed ?? [])
    const recIds = new Set(st.recommendations.map((r) => r.playerId))
    const own = this.ownOrgIds()
    let added = false
    for (const [pid, k] of st.knowledge) {
      if (k < DISCOVERY_THRESHOLD || seen.has(pid) || recIds.has(pid) || dismissed.has(pid)) continue
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

  /* ─────────────────── Scouting Centre triage (FM-style) ─────────────────── */

  /** TRACK a flagged prospect — pin him to the shortlist so he isn't lost in the
   *  queue. Idempotent; a tracked prospect stays in `recommendations` too. */
  shortlistProspect(playerId: string): { ok: boolean } {
    const st = this.scouting
    const list = new Set(st.shortlist ?? [])
    list.add(playerId)
    st.shortlist = [...list]
    // A tracked prospect is never "passed".
    if (st.dismissed) st.dismissed = st.dismissed.filter((id) => id !== playerId)
    return { ok: true }
  }

  /** Un-track a prospect (remove from the shortlist; he returns to the queue). */
  unshortlistProspect(playerId: string): { ok: boolean } {
    const st = this.scouting
    if (st.shortlist) st.shortlist = st.shortlist.filter((id) => id !== playerId)
    return { ok: true }
  }

  /** PASS on a prospect — drop him from the queue and don't re-surface him. */
  dismissProspect(playerId: string): { ok: boolean } {
    const st = this.scouting
    const dis = new Set(st.dismissed ?? [])
    dis.add(playerId)
    st.dismissed = [...dis]
    if (st.recommendations) st.recommendations = st.recommendations.filter((r) => r.playerId !== playerId)
    if (st.shortlist) st.shortlist = st.shortlist.filter((id) => id !== playerId)
    return { ok: true }
  }

  /** "Take another look" — put the best-fit scout (a nation specialist first,
   *  else the sharpest) on this player for a deeper read. Keeps him in the queue;
   *  returns which scout took the assignment. */
  rescoutProspect(playerId: string): { ok: boolean; scoutName?: string } {
    const p = this.data.players.get(asPlayerId(playerId))
    if (!p) return { ok: false }
    const scouts = this.getScouting().scouts
    if (scouts.length === 0) return { ok: false }
    const ranked = [...scouts].sort((a, b) => {
      const aSpec = a.specialtyNation && p.nationality === a.specialtyNation ? 1 : 0
      const bSpec = b.specialtyNation && p.nationality === b.specialtyNation ? 1 : 0
      if (aSpec !== bSpec) return bSpec - aSpec
      return b.rating - a.rating
    })
    const scout = ranked[0]!
    this.assignScoutTarget(scout.scoutId, { kind: 'player', playerId }, 'all')
    return { ok: true, scoutName: scout.name }
  }

  /** Weekly scout digest: one inbox summary of what the department worked on and
   *  who it flagged this week — so finds arrive as a briefing, not a per-player
   *  news drip. Fires on the weekly cadence from the daily advance pass. */
  private emitScoutDigest(day: number): void {
    const st = this.scouting
    const recs = st.recommendations ?? []
    const scouts = this.getScouting().scouts
    if (recs.length === 0 && scouts.length === 0) return
    // "This week" = finds whose foundDate lands in the last 7 sim days.
    const weekAgoISO = dayToDateISO(this.year, Math.max(1, day - 6))
    const fresh = recs.filter((r) => r.foundDate >= weekAgoISO)
    const nameOf = (pid: string): string => this.data.players.get(asPlayerId(pid))?.name ?? 'a prospect'
    const gradeRank = { 'A+': 0, A: 1, B: 2, C: 3 } as const
    const top = [...fresh].sort((a, b) => gradeRank[a.grade] - gradeRank[b.grade]).slice(0, 5)
    const flagged = top.length
      ? `New this week: ${top.map((r) => `${nameOf(r.playerId)} (${r.grade})`).join(', ')}.`
      : `No new names crossed the threshold this week.`
    // Where the department is deployed — the distinct assignment labels.
    const labels = [...new Set(scouts.map((s) => s.assignmentLabel).filter(Boolean))].slice(0, 3)
    const working = labels.length ? ` The department is out on ${labels.join(', ')}.` : ''
    const untriaged = recs.filter((r) => !(st.shortlist ?? []).includes(r.playerId)).length
    const body = `${flagged}${working} ${untriaged} flagged prospect${untriaged === 1 ? '' : 's'} await${untriaged === 1 ? 's' : ''} your call in the Scouting Centre.`
    this.pushNews('scouting', `Weekly scouting digest`, body, { press: { byline: 'Head of Scouting — Recruitment', kind: 'scoutDigest' } })
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
    // No per-find inbox ping — finds are batched into the weekly scouting digest
    // (emitScoutDigest) so the inbox reads as a briefing, not a per-player drip.
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
  /** Compact [id, name] index of every player in the world, for linkifying
   *  names wherever they appear in prose (news, reports, tickers). Fetched once
   *  and cached by the renderer. */
  getNameIndex(): Array<[string, string]> {
    const out: Array<[string, string]> = []
    for (const p of this.data.players.values()) out.push([p.id as string, p.name])
    // Playtest #22: teams too, so club names in inbox/news prose become links.
    // Tagged with a `team:` id prefix (the tuple shape is unchanged) so the
    // renderer can route them to TeamLink instead of PlayerLink.
    for (const t of this.data.teams.values()) out.push([`team:${t.id as string}`, t.name])
    return out
  }

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
      // Today, dated — anchors the "you are here" highlight on the calendar in
      // every phase (regular season maps the day index to its date; the summer
      // uses the offseason clock).
      ...(this.phase === 'offseason'
        ? {
            todayISO: this.offseasonDateISO(),
            extraKeyDates: (() => {
              const y = this.currentDay === 0 ? this.year : this.year + 1
              return [
                { dateISO: `${y}-07-01`, label: 'Free Agency Opens' },
                { dateISO: `${y}-07-08`, label: 'Development Camp' },
                { dateISO: `${y}-09-15`, label: 'Training Camp Opens' },
                { dateISO: `${y}-09-28`, label: 'Cut Day' },
              ]
            })(),
          }
        : {
            todayISO: dayToDateISO(this.year, this.currentDay),
            // Mark the recurring bi-weekly staff meetings so the GM sees them coming.
            extraKeyDates: (() => {
              const out: Array<{ dateISO: string; label: string }> = []
              for (let d = STAFF_MEETING_INTERVAL; d <= lastMatchDay; d += STAFF_MEETING_INTERVAL) {
                out.push({ dateISO: dayToDateISO(this.year, d), label: 'Staff Meeting' })
              }
              return out
            })(),
          }),
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
    // #48/P5: mark the all-tournament standouts your org controls (rights held or
    // on a farm roster) — the story hook that makes the WJC yours to follow.
    const yourOrgIds = new Set<string>()
    for (const pid of this.userTeam.roster) yourOrgIds.add(pid as string)
    const affId = this.userTeam.affiliateId
    if (affId) for (const pid of (this.data.teams.get(affId as TeamId)?.roster ?? [])) yourOrgIds.add(pid as string)
    for (const p of this.data.players.values()) {
      if ((p.rightsTeamId as string | undefined) === (this.userTeamId as string)) yourOrgIds.add(p.id as string)
    }
    const markedAllStars = wj.allStars.map((s) =>
      yourOrgIds.has(s.playerId) ? { ...s, isYours: true } : s)
    const yours = markedAllStars.filter((s) => s.isYours)
    const worldJuniors = wj.contested === 0 ? null : {
      gold: wj.gold,
      silver: wj.silver,
      bronze: wj.bronze,
      standings: wj.standings,
      allStars: markedAllStars,
      ...(yours.length > 0 ? { yours } : {}),
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
      const g = p.position === 'G' ? 'G' : (p.position === 'D') ? 'D' : p.position === 'C' ? 'C' : 'W'
      if (g === group) quality++
    }
    if (quality < target - 1) return 'urgent'
    if (quality < target) return 'need'
    if (quality > target + 2) return 'surplus'
    return 'ok'
  }

  /** Roster need for a whole position GROUP as a numeric weight (higher = thinner),
   *  for the position-diverse scout-report selector. */
  private positionNeedRank(group: ScoutPosGroup): number {
    const repr = group === 'G' ? 'G' : group === 'D' ? 'D' : group === 'C' ? 'C' : 'LW'
    const need = this.positionNeed(repr)
    return need === 'urgent' ? 3 : need === 'need' ? 2 : need === 'surplus' ? 0 : 1
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
            shPoints: (s.shGoals ?? 0) + (s.shAssists ?? 0),
            ppToiPerGame: s.ppToiPerGame ?? 0, pkToiPerGame: s.pkToiPerGame ?? 0,
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
    // #157: LTIR relief lowers the cap hit (but not cash payroll) — show it and
    // widen cap space so the GM can see the room a long-term injury bought him.
    const ltirRelief = this.userLtirRelief()
    if (ltirRelief > 0) {
      view.ltirRelief = ltirRelief
      view.capUsed = Math.max(0, view.capUsed - ltirRelief)
      view.capSpace = Math.max(0, view.salaryCap - view.capUsed)
    }
    // #173: revenue cadence — gate + merchandise now respond to how the season is
    // going. A winning, popular club fills the building; the GM's ticket-pricing
    // lever trades attendance for per-seat take. Broadcast + sponsorship are
    // contract/market-driven and stay put.
    if (view.revenue) {
      const fi = this.fanInterest
      // Attendance: ~72% of the barn at rock-bottom interest, ~104% (sellouts +
      // standing room) when the whole town's engaged.
      const attendance = 0.72 + (fi / 100) * 0.32
      const priceMult = this.ticketPricing === 'premium' ? 1.16 : this.ticketPricing === 'value' ? 0.88 : 1
      const scaleGate = attendance * priceMult
      const rebuild = (_source: string, amount: number): number => Math.round(amount * scaleGate)
      let est = 0
      view.revenue.lines = view.revenue.lines.map((l) => {
        // Gate + merch move with the building; broadcast + sponsorship are fixed.
        const amt = l.source === 'Gate receipts' || l.source === 'Merchandise' ? rebuild(l.source, l.amount) : l.amount
        est += amt
        return { source: l.source, amount: amt }
      })
      view.revenue.estimatedRevenue = est
      view.revenue.fanInterest = Math.round(fi)
      view.revenue.fanInterestLabel = fanInterestLabel(fi)
      view.revenue.attendancePct = Math.round(attendance * priceMult * 100)
      view.revenue.ticketPricing = this.ticketPricing
      const payroll = this.userTeam.roster.reduce((s, id) => s + (this.data.players.get(id)?.contract.salary ?? 0), 0)
      view.revenue.operatingResult = est - payroll
    }
    return view
  }

  /** #173: set the club's ticket-pricing strategy — a live revenue/fanbase lever. */
  setTicketPricing(tier: 'value' | 'standard' | 'premium'): { ok: boolean } {
    this.ticketPricing = tier
    return { ok: true }
  }

  /** The curated inbox: your team's business + genuine headlines, minus the
   *  league-wide ambient colour (every player's point streak/drought, rival
   *  standings takes, trade-rumour chatter about other clubs, and feed posts).
   *  Anything touching your club or a player of yours always stays. Shared by
   *  {@link getInbox} and the dashboard unread badge so the two never disagree. */
  private curatedInboxNews(): NewsItem[] {
    const userTid = this.userTeamId as string
    const userRoster = new Set(this.userTeam.roster.map((id) => id as string))
    const involvesUser = (n: NewsItem): boolean =>
      n.teamId === userTid || (n.playerId !== undefined && userRoster.has(n.playerId))
    const AMBIENT_NOISE =
      /point streak|point drought|heater hits|\bon fire\b|streak snapped|What went wrong|gap widens|struggling to meet|lagging|Trade talk heats up/i
    // League-wide roster churn that has nothing to do with your club: prospects
    // turning pro elsewhere, depth guys heading to Europe or signing minor deals
    // with other teams. It's Feed/ticker colour, not front-office mail. (Anything
    // involving YOUR team already returns true above and is kept.)
    const ROSTER_CHURN =
      /turns pro|makes the NHL out of camp|heads overseas|signs with|clears waivers|is loaned|reassigned to|re-signings around the league/i
    return this.news.filter((n) => {
      if (n.channel === 'feed') return false // feed posts belong to the Feed
      if (involvesUser(n)) return true
      if ((n.category === 'league' || n.category === 'trade') && AMBIENT_NOISE.test(n.headline)) return false
      if ((n.category === 'contract' || n.category === 'league' || n.category === 'trade') && ROSTER_CHURN.test(n.headline)) return false
      return true
    })
  }

  getInbox(): InboxView {
    const items = this.curatedInboxNews()
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

    // LW5: open player→GM concerns surface as response cards atop the inbox.
    const openConcerns = this.interactions.filter((i) => i.status === 'open')
    const interactions = openConcerns.map((i) => {
      const p = this.data.players.get(asPlayerId(i.playerId))
      return {
        id: i.id,
        playerId: i.playerId,
        playerName: p?.name ?? 'Unknown',
        ...(p?.faceId !== undefined ? { faceId: p.faceId } : {}),
        kind: i.kind,
        severity: i.severity,
        message: i.message,
        day: i.day,
        year: i.year,
        options: i.options.map((o) => ({ id: o.id, label: o.label })),
      }
    })
    return { items, unread, playerInfo, teamInfo, ...(interactions.length > 0 ? { interactions } : {}) }
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
    const { value, drivers } = describePickValue(p, { year: this.year })
    const origAbbr = this.data.teams.get(p.originalTeamId)!.abbreviation
    // #13-style provenance: surface the ORIGINAL club when the pick was acquired
    // via trade, so "2026 1st (via MTL)" tells you which slot it really is.
    const via = p.originalTeamId !== p.ownerTeamId ? origAbbr : undefined
    const ord = p.round === 1 ? '1st' : p.round === 2 ? '2nd' : p.round === 3 ? '3rd' : `${p.round}th`
    return {
      id: this.pickId(p),
      year: p.year,
      round: p.round,
      originalTeamAbbr: origAbbr,
      label: `${p.year} ${ord}`,
      value: Math.round(value * 10) / 10,
      ...(via ? { viaAbbr: via } : {}),
      isOwnPick: p.originalTeamId === p.ownerTeamId,
      drivers,
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
        return {
          ...badge(p),
          salary: p.contract.salary,
          yearsRemaining: p.contract.yearsRemaining,
          value: Math.round(playerValue(p) * 10) / 10,
        }
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
        const b = badge(p, playerFog)
        // Your own players read exactly; an unscouted opponent's value is your
        // staff's estimate from the fogged (mid-range) overall, so a plain number
        // never leaks his true rating.
        const estimated = !!b.scouted && !b.scouted.exact
        const { value, drivers } = describePlayerValue(p, estimated ? b.overall : undefined)
        return {
          ...b,
          salary: p.contract.salary,
          yearsRemaining: p.contract.yearsRemaining,
          noTradeClause: p.contract.noTradeClause,
          tradeValue: Math.round(value * 10) / 10,
          valueEstimated: estimated,
          valueDrivers: drivers,
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
        // #13: pick provenance — if this slot is a pick the owner acquired via trade,
        // surface the ORIGINAL team so "VAN (via MTL)" tells you which pick it is.
        const via = pick.originalTeamId !== pick.ownerTeamId
          ? this.data.teams.get(pick.originalTeamId)?.abbreviation
          : undefined
        return {
          overallPick: i + 1,
          round: pick.round,
          teamId: pick.ownerTeamId as string,
          teamAbbr: team.abbreviation,
          ...(via ? { viaAbbr: via } : {}),
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
    const capUsed = capUsedFor(team, this.data.players) + this.userDeadCap
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
      expiring: (() => {
        // The re-sign list is the resignStatus snapshot UNIONED with any roster
        // player who is currently out of contract (yearsRemaining 0) — RFA or UFA.
        // The snapshot is taken once at the draft→resign transition and is skipped
        // entirely on a summer takeover, so an out-of-contract player (e.g. an
        // imported RFA) could silently miss the window (#15). This guarantees every
        // expiring roster player appears, with their real re-sign status.
        const rows = new Map(this.resignStatus)
        for (const id of team.roster) {
          if (this.resolve(id).contract.yearsRemaining === 0 && !rows.has(id)) rows.set(id, 'pending')
        }
        return [...rows.entries()].map(([id, status]) => {
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
        })
      })(),
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
    const abbrOf = (id: PlayerId): string => {
      const t = this.teamOf(id)
      return t ? this.data.teams.get(t)!.abbreviation : 'FA'
    }
    return this.seasonAwardWinners().map((w) => ({
      award: w.award,
      winner: { ...badge(this.resolve(w.playerId)), teamAbbr: abbrOf(w.playerId) },
    }))
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
  /**
   * #170: how effective the user's head coach is at delivering a given practice
   * focus for a player of this position — the multiplier applied to the focus's
   * attribute bias. Prefers the EHM "developing youngsters" attribute, falls back
   * to the position-appropriate coaching discipline, then to the coach's overall
   * rating for fictional staff with no per-discipline attributes. A weak bench
   * boss blunts your focus; an elite developer amplifies it.
   */
  private coachDevMult(focus: PracticeFocus, position: Position): number {
    const coach = this.getTeamStaff(this.userTeamId as string).headCoach
    const a = coach?.attributes
    let raw: number | undefined
    if (a) {
      const posAttr =
        position === 'G' || focus === 'goaltending'
          ? a.coachingGoaltenders
          : position === 'D'
            ? a.coachingDefensemen
            : a.coachingForwards
      raw = a.developingYoungsters ?? posAttr
    }
    const mult =
      raw !== undefined
        ? 0.6 + (raw / 20) * 0.7 // EHM 1–20 → ~0.64..1.30
        : 0.6 + Math.max(0, Math.min(1, ((coach?.rating ?? 60) - 40) / 50)) * 0.7 // rating 40..90
    return Math.max(0.55, Math.min(1.35, mult))
  }

  /**
   * #170: the per-player practice-focus attribute bias fed into the development
   * engine. Only the user's own club has a practice regimen; everyone else
   * develops neutrally (undefined). Balanced focus is the neutral baseline
   * (undefined too). Recovery returns {} on purpose so every attribute drags —
   * rest trades growth for freshness. The targeted biases are scaled by the head
   * coach's development competence.
   */
  private practiceAttributeBias(id: PlayerId): Partial<Record<string, number>> | undefined {
    const p = this.data.players.get(id)
    if (!p) return undefined
    // #174: an explicit individual development plan follows the prospect wherever
    // he plays (AHL / junior), so a Dev-Center focus actually shapes his growth.
    // The TEAM practice regimen still only touches the NHL club.
    const explicit = this.practiceState.perPlayerFocus.find(([pid]) => pid === (id as string))?.[1]
    if (!explicit && this.teamOf(id) !== this.userTeamId) return undefined
    const focus = explicit ?? effectiveFocus(this.practiceState, id as string)
    if (focus === 'balanced') return undefined // neutral baseline — byte-identical
    const { attributeBias } = practiceDevModifier(focus, p)
    // A non-recovery focus returning {} is a position mismatch (e.g. a goalie
    // under an 'offense' team focus) — leave him neutral rather than dragging him.
    if (focus !== 'recovery' && Object.keys(attributeBias).length === 0) return undefined
    const mult = this.coachDevMult(focus, p.position)
    const scaled: Record<string, number> = {}
    for (const [k, v] of Object.entries(attributeBias)) scaled[k] = (v as number) * mult
    return scaled
  }

  /** #188: declare a player's squad status (his role/promise). null clears it. */
  setSquadStatus(playerId: string, status: SquadStatus | null): { ok: boolean } {
    const p = this.data.players.get(asPlayerId(playerId))
    if (!p) return { ok: false }
    if (status === null) delete p.squadStatus
    else p.squadStatus = status
    return { ok: true }
  }

  /** #188: set a player's trade posture (untouchable / available / listed). */
  setTradeStatus(playerId: string, status: TradeStatus | null): { ok: boolean } {
    const p = this.data.players.get(asPlayerId(playerId))
    if (!p) return { ok: false }
    if (status === null) delete p.tradeStatus
    else p.tradeStatus = status
    return { ok: true }
  }

  /**
   * #171 load management: toggle a healthy player's rest directive. A resting
   * player is held out of the coach's lineup so his condition recovers; he
   * auto-returns once fresh. Can't rest an injured player (already out) or one
   * off the user's NHL roster.
   */
  restPlayer(playerId: string): { ok: boolean; resting: boolean; message?: string } {
    const p = this.data.players.get(asPlayerId(playerId))
    if (!p || !this.userTeam.roster.includes(asPlayerId(playerId))) {
      return { ok: false, resting: false, message: 'Not on your NHL roster.' }
    }
    if (p.injuryStatus) return { ok: false, resting: false, message: `${p.name} is already injured.` }
    p.resting = !p.resting
    if (!p.resting) delete p.resting
    return { ok: true, resting: p.resting === true }
  }

  /**
   * #188 roles tab: recommend a squad status for every org player — RELATIVE to
   * the roster's depth chart, so the club always has a realistic spread (a couple
   * of key men, a core, and depth) rather than everyone clustering at one tier by
   * absolute overall. NHL forwards are ranked within the group (top-6 = core,
   * the best 1–2 = key), D within the top-4, and the starter is core; young
   * players off the top group map to prospect tiers; older farm bodies to surplus.
   * Pure.
   */
  private orgRoleSuggestions(): Map<string, SquadStatus> {
    // Rank the NHL roster within each position group by ability.
    const nhl = this.userTeam.roster
      .map((id) => this.data.players.get(id))
      .filter((p): p is Player => !!p)
    const groupOf = (p: Player): 'F' | 'D' | 'G' => (p.position === 'G' ? 'G' : p.position === 'D' ? 'D' : 'F')
    const rank = new Map<string, number>()
    for (const g of ['F', 'D', 'G'] as const) {
      nhl.filter((p) => groupOf(p) === g)
        .sort((a, b) => ratedOverall(b) - ratedOverall(a) || Career.pidNum(a.id as string) - Career.pidNum(b.id as string))
        .forEach((p, i) => rank.set(p.id as string, i))
    }
    const classify = (p: Player, onNhl: boolean): SquadStatus => {
      const ovr = ratedOverall(p)
      const pot = ratedPotential(p)
      const young = p.age <= 23
      const g = groupOf(p)
      if (onNhl) {
        const r = rank.get(p.id as string) ?? 99
        const isKey = ovr >= 85 || (g !== 'G' && r <= 1 && ovr >= 78)
        const isCore = g === 'F' ? r < 6 : g === 'D' ? r < 4 : r < 1
        if (isKey) return young && ovr < 80 ? 'coreStarter' : 'keyPlayer'
        if (isCore) return 'coreStarter'
        // On the NHL roster but outside the regular top group.
        return young ? (pot >= 78 ? 'topProspect' : 'prospect') : 'rotation'
      }
      // Farm: young players develop; older bodies are depth or surplus.
      if (young) return pot >= 78 ? 'topProspect' : 'prospect'
      return ovr >= 72 ? 'rotation' : 'surplus'
    }
    const out = new Map<string, SquadStatus>()
    for (const { p, onNhl } of this.orgPlayersWithTier()) out.set(p.id as string, classify(p, onNhl))
    return out
  }

  /** The user's whole organisation (NHL roster + AHL affiliate) as Player objects,
   *  each flagged with whether he's on the NHL club. */
  private orgPlayersWithTier(): Array<{ p: Player; onNhl: boolean }> {
    const out: Array<{ p: Player; onNhl: boolean }> = []
    for (const id of this.userTeam.roster) {
      const p = this.data.players.get(id)
      if (p) out.push({ p, onNhl: true })
    }
    const ahl = this.userTeam.affiliateId ? this.data.teams.get(this.userTeam.affiliateId) : undefined
    for (const id of ahl?.roster ?? []) {
      const p = this.data.players.get(id)
      if (p) out.push({ p, onNhl: false })
    }
    return out
  }

  /**
   * #188 roles tab: the bulk squad-role board — every org player with his current
   * role and the engine's recommendation, so the GM sets roles without
   * right-clicking each name.
   */
  getRoleBoard(): RoleBoardView {
    const fog = this.fogCtx()
    const suggestions = this.orgRoleSuggestions()
    const rows: RoleBoardRow[] = this.orgPlayersWithTier().map(({ p, onNhl }) => ({
      ...badge(p, onNhl ? undefined : fog),
      onNhl,
      ...(p.squadStatus ? { squadStatus: p.squadStatus } : {}),
      suggested: suggestions.get(p.id as string) ?? 'rotation',
    }))
    rows.sort((a, b) => Number(b.onNhl) - Number(a.onNhl) || b.overall - a.overall)
    return {
      rows,
      labels: { ...SQUAD_STATUS_LABEL },
      unassigned: rows.filter((r) => r.squadStatus === undefined).length,
    }
  }

  /**
   * #188 roles tab: auto-assign squad roles from the recommendation. By default
   * only fills players who have NO role yet (respecting the GM's manual picks);
   * `overwrite` re-suggests the whole org. Returns how many were set.
   */
  autoAssignSquadRoles(overwrite = false): { assigned: number } {
    const suggestions = this.orgRoleSuggestions()
    let assigned = 0
    for (const { p } of this.orgPlayersWithTier()) {
      if (!overwrite && p.squadStatus !== undefined) continue
      p.squadStatus = suggestions.get(p.id as string) ?? 'rotation'
      assigned++
    }
    return { assigned }
  }

  /* ─────────────────────── #189 captains + jersey numbers ─────────────────────── */

  /** Normalise a raw leadership score (~0–60) onto a 0–99 display scale. */
  private leadershipDisplay(p: Player): number {
    if (p.leadership !== undefined) return Math.round(p.leadership)
    return Math.max(1, Math.min(99, Math.round(leadershipScore(p) * 1.6)))
  }

  /**
   * #189: captaincy + jersey-number board for the user's NHL club. Rows are the
   * skaters sorted by leadership (goalies last), each with the letter he wears now,
   * his leadership + room influence, captain eligibility, and jersey number.
   */
  getLeadership(): LeadershipView {
    const team = this.userTeam
    const lr = this.lockerRooms.get(this.userTeamId)
    const influenceOf = (id: string): number => {
      if (!lr) return 0
      for (const [pid, v] of lr.influence) if (pid === id) return Math.round(v)
      return 0
    }
    const capId = lr?.captainId ?? null
    const altSet = new Set(lr?.alternateIds ?? [])
    const rows: LeadershipRowView[] = team.roster
      .map((id) => {
        const p = this.data.players.get(id)!
        const sid = id as string
        const letter: 'C' | 'A' | null = capId === sid ? 'C' : altSet.has(sid) ? 'A' : null
        return {
          playerId: sid,
          name: p.name,
          ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
          position: p.position,
          age: p.age,
          letter,
          leadership: this.leadershipDisplay(p),
          influence: influenceOf(sid),
          captainEligible: isCaptainEligible(p),
          ...(p.jerseyNumber !== undefined ? { jerseyNumber: p.jerseyNumber } : {}),
        }
      })
      .sort((a, b) => {
        const ga = a.position === 'G' ? 1 : 0
        const gb = b.position === 'G' ? 1 : 0
        return ga - gb || b.leadership - a.leadership
      })
    const retiredNumbers = (team.retiredNumbers ?? []).map((r) => r.number)
    return {
      teamName: team.name,
      captainId: capId,
      alternateIds: lr?.alternateIds ?? [],
      maxAlternates: capId ? 2 : 3,
      retiredNumbers,
      rows,
    }
  }

  /**
   * #189: name (or clear, with null) the club captain. Must be a skater on the
   * user's NHL roster. Promoting an alternate to captain vacates his A. Writes the
   * GM override onto the team and syncs the locker room so dynamics honour it; the
   * new captain gets a small morale lift and the room hears about it.
   */
  setCaptain(playerId: string | null): { ok: boolean; message?: string } {
    const team = this.userTeam
    const lr = this.lockerRooms.get(this.userTeamId)
    if (playerId === null) {
      team.captainId = undefined
      if (lr) lr.captainId = null
      this.syncCaptainOverride(this.userTeamId)
      return { ok: true }
    }
    const p = this.data.players.get(asPlayerId(playerId))
    if (!p || !team.roster.includes(asPlayerId(playerId))) return { ok: false, message: 'Not on your roster.' }
    if (p.position === 'G') return { ok: false, message: 'A goaltender cannot wear the C.' }
    team.captainId = asPlayerId(playerId)
    // A new captain vacates his old alternate slot; keep ≤2 alternates with a C.
    team.alternateCaptainIds = (team.alternateCaptainIds ?? [])
      .filter((id) => (id as string) !== playerId)
      .slice(0, 2)
    this.syncCaptainOverride(this.userTeamId)
    p.morale = Math.max(0, Math.min(100, p.morale + 5))
    this.pushNews('league', `${p.name} named captain`,
      `${p.name} will wear the C for the ${team.name}. A vote of confidence from the front office.`,
      { playerId, teamId: this.userTeamId as string })
    return { ok: true }
  }

  /**
   * #189: toggle a player's alternate-captain (A) status. Enforces the NHL letter
   * cap (2 alternates with a captain, 3 without) and never lets the captain also
   * hold an A. Returns a message when the request can't be honoured.
   */
  toggleAlternate(playerId: string): { ok: boolean; message?: string } {
    const team = this.userTeam
    if (!team.roster.includes(asPlayerId(playerId))) return { ok: false, message: 'Not on your roster.' }
    const p = this.data.players.get(asPlayerId(playerId))
    if (!p) return { ok: false }
    if (p.position === 'G') return { ok: false, message: 'A goaltender cannot wear a letter.' }
    if ((team.captainId as string) === playerId) return { ok: false, message: 'He already wears the C.' }
    const current = new Set((team.alternateCaptainIds ?? []).map((id) => id as string))
    if (current.has(playerId)) {
      current.delete(playerId)
    } else {
      const cap = team.captainId ? 2 : 3
      if (current.size >= cap) return { ok: false, message: `Only ${cap} alternates allowed${team.captainId ? ' with a captain' : ''}.` }
      current.add(playerId)
    }
    team.alternateCaptainIds = [...current].map((id) => asPlayerId(id))
    this.syncCaptainOverride(this.userTeamId)
    return { ok: true }
  }

  /**
   * #189: set (or clear, with null) a player's jersey number. Must be on the user's
   * NHL roster or AHL affiliate. Rejects out-of-range, retired, and already-worn
   * numbers so the sweater map stays consistent.
   */
  setJerseyNumber(playerId: string, number: number | null): { ok: boolean; message?: string } {
    const p = this.data.players.get(asPlayerId(playerId))
    if (!p) return { ok: false }
    if (!this.ownOrgIds().has(playerId)) return { ok: false, message: 'Not in your organisation.' }
    if (number === null) { delete p.jerseyNumber; return { ok: true } }
    if (!Number.isInteger(number) || number < 1 || number > 98) {
      return { ok: false, message: 'Pick a number from 1 to 98.' }
    }
    const team = this.userTeam
    if ((team.retiredNumbers ?? []).some((r) => r.number === number)) {
      return { ok: false, message: `#${number} is retired by the club.` }
    }
    // No collision within the same roster the player belongs to.
    const ahl = team.affiliateId ? this.data.teams.get(team.affiliateId) : undefined
    const rosterOf = team.roster.includes(asPlayerId(playerId)) ? team.roster : (ahl?.roster ?? [])
    for (const id of rosterOf) {
      if ((id as string) === playerId) continue
      if (this.data.players.get(id)?.jerseyNumber === number) {
        return { ok: false, message: `#${number} is already worn by ${this.data.players.get(id)?.name}.` }
      }
    }
    p.jerseyNumber = number
    return { ok: true }
  }

  /**
   * #188: keep the promises implied by squad status. Once a week, compare each of
   * your players' declared roles against how the club is actually using them and
   * nudge morale — a "key player" buried in the AHL or scratched sours; a
   * "prospect" developing patiently is content. Broken promises to core men can
   * spill into the room (surfaced as the odd inbox grumble). Gentle by design.
   */
  private tickSquadPromises(): void {
    const ahl = this.userTeam.affiliateId ? this.data.teams.get(this.userTeam.affiliateId) : undefined
    const scratched = new Set(this.practiceState.scratched)
    for (const id of this.userTeam.roster.concat(ahl?.roster ?? [])) {
      const p = this.data.players.get(id)
      if (!p?.squadStatus) continue
      const onNhl = this.userTeam.roster.includes(id)
      const isScratched = scratched.has(id as string)
      let delta = 0
      let grievance = ''
      switch (p.squadStatus) {
        case 'keyPlayer':
          if (!onNhl) { delta = -4; grievance = 'a franchise player left in the minors' }
          else if (isScratched) { delta = -3; grievance = 'a key man in the press box' }
          else delta = 1
          break
        case 'coreStarter':
          if (!onNhl) { delta = -3; grievance = 'a core player buried on the farm' }
          else if (isScratched) delta = -1.5
          else delta = 0.5
          break
        case 'rotation':
          if (!onNhl) delta = -1.5
          break
        case 'topProspect':
          delta = onNhl ? 1 : 0.5 // patient track — a look up top is a boost
          break
        case 'prospect':
          delta = 0.5 // developing as promised
          break
        case 'surplus':
          delta = 0
          break
      }
      if (delta !== 0) p.morale = Math.max(0, Math.min(100, p.morale + delta))
      // A badly-broken promise to a core/key man occasionally reaches your desk.
      if (grievance && p.morale < 45 && this.rngFor(9611, this.currentDay, Career.pidNum(id as string)).chance(0.15)) {
        this.pushNews('contract', `${p.name} unhappy with his role`,
          `Word from the room: ${p.name} feels he's ${grievance}. You told him he was a ${SQUAD_STATUS_LABEL[p.squadStatus]} — live up to it or move him.`,
          { playerId: id as string, teamId: this.userTeamId as string })
      }
    }
  }

  getPractice(): PracticeView {
    const roster = this.userTeam.roster.map((id) => this.resolve(id))
    return {
      state: structuredClone(this.practiceState),
      suggestion: suggestFocus(roster),
      plan: this.buildPracticePlan(),
    }
  }

  /**
   * #170: the effect preview for the active team focus — the tradeoff the GM is
   * choosing, made visible. Names the top targeted attributes, the head coach's
   * effectiveness at delivering the focus, and the weekly fatigue swing.
   */
  private buildPracticePlan(): PracticeView['plan'] {
    const focus = this.practiceState.teamFocus
    // A representative skater and goalie so the preview reflects both benches.
    const skater = this.userTeam.roster.map((id) => this.resolve(id)).find((p) => p.position !== 'G')
    const probe = skater ?? this.resolve(this.userTeam.roster[0]!)
    const { attributeBias, fatigueMod } = practiceDevModifier(focus, probe)
    const coachMult = this.coachDevMult(focus, probe.position)
    const coach = this.getTeamStaff(this.userTeamId as string).headCoach
    // Balanced is the neutral baseline (the engine applies no bias for it), so
    // present it honestly as even development rather than a per-attribute boost.
    const targeted =
      focus === 'balanced'
        ? []
        : Object.entries(attributeBias)
            .sort((a, b) => (b[1] as number) - (a[1] as number))
            .slice(0, 6)
            .map(([attr, boost]) => ({ attr, boost: Math.round((boost as number) * coachMult * 100) }))
    const coachTier =
      coachMult >= 1.15 ? 'elite' : coachMult >= 1.0 ? 'strong' : coachMult >= 0.85 ? 'adequate' : 'weak'
    return {
      focus,
      targeted,
      fatiguePerWeek: fatigueMod,
      coachName: coach?.name ?? 'The head coach',
      coachMult: Math.round(coachMult * 100),
      coachTier,
      opportunityCostPct: focus === 'balanced' ? 0 : Math.round(UNTARGETED_FOCUS_DRAG * 100),
    }
  }

  /** Update the team practice focus and/or per-player overrides. */
  setPractice(state: TeamPracticeState): void {
    this.practiceState = structuredClone(state)
  }

  /** Toggle a player's healthy-scratch status for the next game. */
  toggleScratchPlayer(playerId: string): void {
    this.practiceState = toggleScratch(this.practiceState, playerId)
    // Living Ledger: a healthy scratch of an established veteran is a message,
    // and he receives it. (Only on scratch-ON; un-scratching mends nothing.)
    if (this.isScratchedFor(playerId)) {
      const p = this.data.players.get(asPlayerId(playerId))
      if (p && p.injuryStatus === null && p.age >= 28 && ratedOverall(p) >= 72) {
        this.recordWorldAction('scratched', playerId, 'open')
      }
    }
  }

  /** Set (or clear) a per-player individual focus override. */
  setPlayerFocusDrill(playerId: string, focus: PracticeFocus | null): void {
    this.practiceState = setPlayerFocus(this.practiceState, playerId, focus)
  }

  /** Assign each roster player an individual training focus targeting his weakest
   *  area (goalies → goaltending). One click to development-optimise the squad. */
  recommendPlayerFocuses(): { ok: true; count: number } {
    // Cover the WHOLE organisation, not just the NHL club: the AHL affiliate and
    // the rights-held prospects in junior/Europe are exactly who a development
    // plan is for, and an individual focus follows a prospect wherever he plays.
    const affiliateId = this.userTeam.affiliateId
    const ahlRoster = affiliateId ? (this.data.teams.get(affiliateId as TeamId)?.roster ?? []) : []
    const ids = new Set<PlayerId>([...this.userTeam.roster, ...ahlRoster])
    for (const p of this.data.players.values()) {
      if (p.rightsTeamId === this.userTeamId) ids.add(p.id)
    }
    let count = 0
    for (const id of ids) {
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
        plusMinus: t.plusMinus,
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
        shutouts: [...(r.singleSeason.shutouts ?? [])],
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
      franchises: this.buildFranchiseHistory(),
    }
  }

  /** Per-club championship pedigree drawn from the season archive (seeded past +
   *  every season simmed since), most titles first. */
  private buildFranchiseHistory(): import('./views').FranchiseHistoryView[] {
    const yearsByTeam = new Map<string, number[]>()
    for (const s of this.recordsState.seasons) {
      if (!s.championTeamId) continue
      const arr = yearsByTeam.get(s.championTeamId) ?? []
      arr.push(s.year)
      yearsByTeam.set(s.championTeamId, arr)
    }
    const userTid = this.userTeamId as string
    return this.data.league.teams
      .map((tid) => {
        const team = this.data.teams.get(tid)!
        const years = (yearsByTeam.get(tid as string) ?? []).sort((a, b) => b - a)
        return {
          teamId: tid as string,
          name: team.name,
          abbreviation: team.abbreviation,
          championships: years.length,
          championYears: years,
          isUser: (tid as string) === userTid,
        }
      })
      .sort((a, b) => b.championships - a.championships || (a.name < b.name ? -1 : 1))
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
      // The trade block only lists NHL players — AHL/junior/European bodies
      // aren't trade chips that matter to the GM. NHL clubs are exactly the
      // league.teams set (the `tier` field is null in base leagues, so we can't
      // rely on it); anyone outside that set is a non-NHL body.
      rumors: (() => {
        const nhlTeams = new Set(this.data.league.teams.map((t) => t as string))
        return tp.rumors
          .filter((r) => nhlTeams.has(r.teamId as string))
          .map((r) => {
          const p = this.data.players.get(asPlayerId(r.playerId))
          return {
            playerId: r.playerId,
            playerName: p?.name ?? r.playerId,
            teamId: r.teamId,
            teamAbbr: abbrFor(r.teamId),
            heat: Math.round(r.heat),
            sinceDay: r.sinceDay,
            ...(p ? { position: p.position, age: p.age } : {}),
            ...(p?.faceId !== undefined ? { faceId: p.faceId } : {}),
          }
        })
      })(),
      deadlineDay: this.deadlineDay,
      deadlinePassed: this.phase === 'playoffs' || (this.phase === 'regularSeason' && this.currentDay >= this.deadlineDay),
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
      ticketPricing: this.ticketPricing,
      baseBudget: this.baseBudget,
      history: [...this.history],
      extraStats: {
        goalieWins: serializeMap(this.goalieWins as unknown as Map<string, number>),
        goalieLosses: serializeMap(this.goalieLosses as unknown as Map<string, number>),
        shutouts: serializeMap(this.shutouts as unknown as Map<string, number>),
        ppGoals: serializeMap(this.ppGoals as unknown as Map<string, number>),
        ppAssists: serializeMap(this.ppAssists as unknown as Map<string, number>),
        shGoals: serializeMap(this.shGoals as unknown as Map<string, number>),
        shAssists: serializeMap(this.shAssists as unknown as Map<string, number>),
      },
      scouting: {
        knowledge: [...this.scouting.knowledge],
        assignments: [...this.scouting.assignments],
        recommendations: [...(this.scouting.recommendations ?? [])],
        seen: [...(this.scouting.seen ?? [])],
        judgment: [...(this.scouting.judgment ?? [])],
        scoutHistory: (this.scouting.scoutHistory ?? []).map(([sid, pids]) => [sid, [...pids]] as [string, string[]]),
        shortlist: [...(this.scouting.shortlist ?? [])],
        dismissed: [...(this.scouting.dismissed ?? [])],
      },
      arcs: structuredClone(this.arcsState),
      chronicle: structuredClone(this.chronicle),
      gmPersonas: structuredClone(this.gmPersonas),
      boardMeetingYear: this.boardMeetingYear,
      devCampPending: this.devCampPending,
      devCampRoster: this.devCampRoster ? [...this.devCampRoster] : undefined,
      campPtoInvites: this.campPtoInvites ? [...this.campPtoInvites] : undefined,
      devCampState: this.devCampState ? structuredClone(this.devCampState) : null,
      trainingCamp: this.trainingCamp ? structuredClone(this.trainingCamp) : null,
      lastSeasonMeta: this.lastSeasonMeta ? { ...this.lastSeasonMeta } : null,
      ownerPerk: this.ownerPerk,
      reviewFacts: this.reviewFacts ? structuredClone(this.reviewFacts) : null,
      deadlineHold: this.deadlineHold,
      deadlineHoldDone: this.deadlineHoldDone,
      userDeadCap: this.userDeadCap,
      deadCapSchedule: this.deadCapSchedule.map((e) => ({ ...e })),
      buyoutFas: this.buyoutFas.map((id) => id as string),
      arbitrationCases: this.arbitrationCases.map((c) => ({ ...c })),
      boxScoreHistory: structuredClone(this.boxScoreHistory),
      records: structuredClone(this.recordsState),
      expectations: structuredClone(this.expectationsState),
      lockerRooms: [...this.lockerRooms.entries()].map(
        ([k, v]) => [k as string, structuredClone(v)] as [string, LockerRoomState]
      ),
      interactions: this.interactions.map((i) => structuredClone(i)),
      worldActions: this.worldActions.map((a) => structuredClone(a)),
      ledgerReactions: this.ledgerReactions.map((r) => structuredClone(r)),
      residueFlags: this.residueFlags.map((f) => structuredClone(f)),
      ledgerCounter: this.ledgerCounter,
      contentLedger: this.contentLedger.map((u) => ({ ...u })),
      decisionEventFor: [...this.decisionEventFor.entries()],
      declinedCallups: [...this.declinedCallups.entries()],
      lastDecisionDay: this.lastDecisionDay,
      interactionCounter: this.interactionCounter,
      playerPromises: this.playerPromises.map((pr) => ({ ...pr })),
      ...(this.storyPriors ? { storyPriors: structuredClone(this.storyPriors) } : {}),
      feedPosts: this.feedPosts.map((p) => ({ ...p })),
      feedCounter: this.feedCounter,
      followedFeedAuthors: [...this.followedFeedAuthors],
      negotiations: [...this.negotiations.entries()].map(
        ([k, v]) => [k, structuredClone(v)] as [string, NegotiationState]
      ),
      agentRapport: structuredClone(this.agentRapport),
      ...(this.staffMeetingScene ? { staffMeetingScene: structuredClone(this.staffMeetingScene) } : {}),
      ...(this.scoutMeetingScene ? { scoutMeetingScene: structuredClone(this.scoutMeetingScene) } : {}),
      faShortlist: [...this.faShortlist],
      faPendingOffers: this.faPendingOffers.map((o) => ({ ...o })),
      pendingOfferSheets: this.pendingOfferSheets.map((o) => ({ ...o })),
      pendingTrades: this.pendingTrades.map((o) => ({ ...o, proposal: { ...o.proposal } })),
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
        playoffBerthAnnounced: this.playoffBerthAnnounced,
        lastDeadlineRecap: this.lastDeadlineRecap ? structuredClone(this.lastDeadlineRecap) : null,
        lastLottery: this.lastLottery ? structuredClone(this.lastLottery) : null,
        pressSchedule: structuredClone(this.pressScheduleState),
      },
      pressState: {
        sagaSoFar: this.sagaSoFar,
        pressCounter: this.pressCounter,
        pressJob: this.pressJob ? structuredClone(this.pressJob) : null,
        pressConference: this.pressConference ? structuredClone(this.pressConference) : null,
        pundits: structuredClone(this.punditState),
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
      // Backfill any newly-added Standing fields (e.g. regulationOtWins) so a
      // save from before they existed doesn't leave them undefined (→ NaN sorts).
      career.standings.set(asTeamId(k), { ...freshStanding(asTeamId(k)), ...(v as Standing) })
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
    career.ticketPricing = snapshot.ticketPricing ?? 'standard'
    career.baseBudget = snapshot.baseBudget ?? 0
    career.history = [...snapshot.history]
    if (snapshot.extraStats) {
      for (const [k, v] of snapshot.extraStats.goalieWins) career.goalieWins.set(asPlayerId(k), v)
      for (const [k, v] of snapshot.extraStats.goalieLosses) {
        career.goalieLosses.set(asPlayerId(k), v)
      }
      for (const [k, v] of snapshot.extraStats.ppGoals) career.ppGoals.set(asPlayerId(k), v)
      for (const [k, v] of snapshot.extraStats.ppAssists) career.ppAssists.set(asPlayerId(k), v)
      // #175: shorthanded splits (absent on pre-#175 saves — start empty).
      for (const [k, v] of snapshot.extraStats.shGoals ?? []) career.shGoals.set(asPlayerId(k), v)
      for (const [k, v] of snapshot.extraStats.shAssists ?? []) career.shAssists.set(asPlayerId(k), v)
      // Shutouts (absent on older saves — start empty).
      for (const [k, v] of snapshot.extraStats.shutouts ?? []) career.shutouts.set(asPlayerId(k), v)
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
        shortlist: [...(snapshot.scouting.shortlist ?? [])],
        dismissed: [...(snapshot.scouting.dismissed ?? [])],
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
    career.devCampPending = snapshot.devCampPending ?? false
    career.devCampRoster = snapshot.devCampRoster ? [...snapshot.devCampRoster] : undefined
    career.campPtoInvites = snapshot.campPtoInvites ? [...snapshot.campPtoInvites] : undefined
    career.devCampState = snapshot.devCampState ? structuredClone(snapshot.devCampState) : null
    career.trainingCamp = snapshot.trainingCamp ? structuredClone(snapshot.trainingCamp) : null
    career.lastSeasonMeta = snapshot.lastSeasonMeta ? { ...snapshot.lastSeasonMeta } : null
    career.ownerPerk = snapshot.ownerPerk ?? null
    career.reviewFacts = snapshot.reviewFacts ? structuredClone(snapshot.reviewFacts) : null
    career.deadlineHold = snapshot.deadlineHold ?? false
    career.deadlineHoldDone = snapshot.deadlineHoldDone ?? false
    career.userDeadCap = snapshot.userDeadCap ?? 0
    career.deadCapSchedule = (snapshot.deadCapSchedule ?? []).map((e) => ({ ...e }))
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
    if (snapshot.playerPromises) career.playerPromises = snapshot.playerPromises.map((pr) => ({ ...pr }))
    if (snapshot.worldActions) career.worldActions = snapshot.worldActions.map((a) => ({ ...a }))
    if (snapshot.ledgerReactions) career.ledgerReactions = snapshot.ledgerReactions.map((r) => ({ ...r }))
    if (snapshot.residueFlags) career.residueFlags = snapshot.residueFlags.map((f) => ({ ...f }))
    career.ledgerCounter = snapshot.ledgerCounter ?? 0
    if (snapshot.contentLedger) career.contentLedger = snapshot.contentLedger.map((u) => ({ ...u }))
    if (snapshot.decisionEventFor) career.decisionEventFor = new Map(snapshot.decisionEventFor)
    if (snapshot.declinedCallups) career.declinedCallups = new Map(snapshot.declinedCallups)
    career.lastDecisionDay = snapshot.lastDecisionDay ?? -999
    if (snapshot.storyPriors) career.storyPriors = structuredClone(snapshot.storyPriors)
    if (snapshot.feedPosts) career.feedPosts = snapshot.feedPosts.map((p) => ({ ...p }))
    career.feedCounter = snapshot.feedCounter ?? 0
    if (snapshot.followedFeedAuthors) career.followedFeedAuthors = [...snapshot.followedFeedAuthors]
    if (snapshot.negotiations) {
      career.negotiations = new Map(
        snapshot.negotiations.map(([k, v]) => [k, structuredClone(v)])
      )
    }
    career.agentRapport = normalizeAgentRapport(snapshot.agentRapport)
    if (snapshot.staffMeetingScene) career.staffMeetingScene = snapshot.staffMeetingScene as StaffMeetingScene
    if (snapshot.scoutMeetingScene) career.scoutMeetingScene = snapshot.scoutMeetingScene as ScoutMeetingScene
    if (snapshot.faShortlist) career.faShortlist = new Set(snapshot.faShortlist)
    if (snapshot.faPendingOffers) career.faPendingOffers = snapshot.faPendingOffers.map((o) => ({ ...o }))
    if (snapshot.pendingOfferSheets) career.pendingOfferSheets = snapshot.pendingOfferSheets.map((o) => ({ ...o }))
    if (snapshot.pendingTrades) career.pendingTrades = snapshot.pendingTrades.map((o: typeof career.pendingTrades[number]) => ({ ...o, proposal: { ...o.proposal } }))
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
      career.playoffBerthAnnounced = snapshot.storyMisc.playoffBerthAnnounced ?? null
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
      // #90: pundit relationships — old saves seed neutral, and normalize
      // backfills any persona a stored state is missing.
      career.punditState = normalizePundits(snapshot.pressState.pundits)
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
        // Keep every unsigned, un-retired player on the board — including old
        // veterans (the age<38 cut used to hide 39/40-year-olds like a lingering
        // Crosby entirely). reconcileOrphans below settles who retires.
        return !!p && p.retiredYear === undefined
      })
    }
    // Ensure every staff scout is deployable (adds any not yet in the roster).
    career.syncScoutRoster()
    // Heal any save that already lost a player to limbo: restore dropped
    // contracts to their clubs, retire (announced) the plainly-finished, and
    // list the rest as free agents. Idempotent on a healthy save (a no-op).
    // Silent: any retirement here is reconciliation of a pre-existing orphan,
    // not an event that happened on the save's current (mid-season) date.
    career.reconcileOrphans(true)
    return career
  }
}
