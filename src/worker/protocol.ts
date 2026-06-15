/**
 * Message contract between the React UI thread and the sim Web Worker.
 *
 * The worker holds the live Career (the league + calendar position) so the UI
 * stays a thin view. Every message carries an `id` so the client can match a
 * response to the request that produced it. Error responses RESOLVE (callers
 * check `res.type === 'error'`).
 *
 * v2: full management surface — every screen has a `get*` request returning its
 * view model from @engine/career/views, plus mutations (lines, tactics, trades,
 * contracts, draft) and save/load via CareerSnapshot. Payloads must survive
 * structured clone.
 */
export type { ManagerView, TeamInfo, WatchedGame } from '@engine/career/career'
import type { ManagerView, TeamInfo, WatchedGame } from '@engine/career/career'
export type { PressJob, PressConferenceState, PressTone } from '@engine/story/factSheet'
import type { PressJob, PressConferenceState, PressTone } from '@engine/story/factSheet'
export type {
  AgmReportView,
  AhlSquadView,
  LeagueTeamRow,
  LeagueTeamsView,
  AhlStandingsView,
  BoardView,
  BoxScoreView,
  ClubInfoView,
  CalendarView,
  CareerPhase,
  CareerSnapshot,
  CompareRadarView,
  DataHubView,
  DataAnalystView,
  TeamDataHubView,
  TeamPlayerAnalyticsRow,
  GoalieAnalyticsRow,
  DashboardView,
  DraftView,
  FinanceView,
  HistoryView,
  InboxView,
  LeagueLeadersView,
  LeagueStatsView,
  LinesUpdate,
  LinesView,
  LockerRoomView,
  OffseasonView,
  PersonalityReadView,
  PersonalityTraitRead,
  PlayerAnalyticsRow,
  PlayerBioView,
  PlayerHonoursView,
  PlayerProfileView,
  PlayoffBracketView,
  PracticeView,
  ProfileContractView,
  RadarAxes,
  RadarView,
  RivalriesView,
  ScheduleView,
  ScoreboardView,
  ScoutingView,
  SquadView,
  CompetitionsView,
  InternationalView,
  DraftRankingsView,
  StandingsView,
  StatsView,
  TacticsView,
  TeamAnalyticsRow,
  TentpoleView,
  TradeEvaluation,
  TradeProposal,
  TradesView,
  TransactionsView,
  TeamLeadersView,
  TeamPlayerStatRow,
  TeamPlayerStatsView,
} from '@engine/career/views'
export type { PlayerInteractionView, InteractionOptionView } from '@engine/career/views'
export type { InterviewView, InterviewAnswerView } from '@engine/career/views'
export type { TeamLegendsView, ClubLegend } from '@engine/career/views'
import type { TeamLegendsView } from '@engine/career/views'
export type { TeamDynamicsView, DynamicsPlayerView, DynamicsBar } from '@engine/career/views'
import type { TeamDynamicsView } from '@engine/career/views'
export type { MedicalView, MedicalRow } from '@engine/career/views'
import type { MedicalView } from '@engine/career/views'
export type { DevelopmentCenterView, DevelopmentRow } from '@engine/career/views'
import type { DevelopmentCenterView } from '@engine/career/views'
export type { SquadPlannerView, PlannerPlayer, PositionDepth, CareerStage, PosGroup } from '@engine/career/views'
import type { SquadPlannerView } from '@engine/career/views'
export type { LeagueStatTableView, LeagueSkaterStatRow, LeagueGoalieStatRow } from '@engine/career/views'
import type { LeagueStatTableView } from '@engine/career/views'
export type { AgendaItem, AgendaTopic, AgendaTopicOption, DiscussionResult } from '@engine/career/views'
import type { AgendaItem, DiscussionResult } from '@engine/career/views'
export { RADAR_AXES } from '@engine/career/views'
import type {
  AgmReportView,
  AhlSquadView,
  AhlStandingsView,
  BoardView,
  BoxScoreView,
  ClubInfoView,
  CalendarView,
  CareerSnapshot,
  DataHubView,
  DataAnalystView,
  TeamDataHubView,
  DashboardView,
  DraftView,
  FinanceView,
  HistoryView,
  InboxView,
  LeagueLeadersView,
  LeagueStatsView,
  LinesUpdate,
  LinesView,
  LockerRoomView,
  OffseasonView,
  PlayerProfileView,
  PlayoffBracketView,
  PracticeView,
  LeagueTeamsView,
  RivalriesView,
  ScheduleView,
  ScoreboardView,
  ScoutingView,
  SquadView,
  CompetitionsView,
  InternationalView,
  DraftRankingsView,
  StandingsView,
  StatsView,
  TacticsView,
  TentpoleView,
  TradeEvaluation,
  TradeProposal,
  TradesView,
  TransactionsView,
  TeamPlayerStatsView,
} from '@engine/career/views'
import type { TeamTactics } from '@domain'
import type { ScoutTarget, ScoutFocus } from '@domain/scouting'
import type { TeamPracticeState, PracticeFocus } from '@engine/league/practice'
export type { TeamPracticeState, PracticeFocus } from '@engine/league/practice'
export type { ArchetypeInfo, LineSynergyView, CoachSuggestionView, StyleFitView, StaffView, StaffRowView } from '@engine/career/views'

/** A request without its correlation id; the client stamps the id on send. */
export type WorkerRequestBody =
  /* ── session ── */
  | { type: 'ping' }
  | { type: 'version' }
  | { type: 'newLeague'; seed: number; teamCount?: number }
  /** Load a real-roster mod database (parsed JSON from the mod bridge). */
  | { type: 'newLeagueFromMod'; mod: unknown; seed: number }
  | { type: 'startCareer'; teamId: string }
  /* ── calendar ── */
  | { type: 'advance'; days?: number }
  /** Advance through match days until the user's next fixture has been played. */
  | { type: 'advanceToNextGame' }
  /** Smart continue: next meaningful stop (game day, playoff game, offseason stage). */
  | { type: 'continue' }
  /** Play the user's next fixture with the full engine and return its stream. */
  | { type: 'watch' }
  /* ── screens ── */
  | { type: 'getDashboard' }
  | { type: 'getSquad' }
  | { type: 'getPlayer'; playerId: string }
  | { type: 'getTactics' }
  | { type: 'getCalendar' }
  | { type: 'getSchedule' }
  | { type: 'getStandings' }
  | { type: 'getCompetitions' }
  | { type: 'getInternational' }
  | { type: 'getDraftRankings' }
  | { type: 'getDataAnalyst' }
  | { type: 'hireDataAnalyst'; candidateId: string }
  | { type: 'getStats' }
  | { type: 'getTrades' }
  | { type: 'getDraft' }
  | { type: 'getFinances' }
  | { type: 'getInbox' }
  | { type: 'getTeamLegends'; teamId: string }
  | { type: 'getTeamDynamics'; teamId: string }
  | { type: 'getMedical' }
  | { type: 'getDevelopment' }
  | { type: 'getSquadPlanner' }
  | { type: 'getLeagueStatTable'; teamId?: string }
  | { type: 'getAgenda' }
  | { type: 'markForMeeting'; playerId: string; topic: string }
  | { type: 'discussAgendaItem'; itemId: string }
  | { type: 'getPlayoffs' }
  | { type: 'getOffseason' }
  /** Box score of the most recently played user game, if any. */
  | { type: 'getLastBoxScore' }
  /* ── mutations ── */
  | { type: 'setLines'; lines: LinesUpdate }
  | { type: 'setTactics'; tactics: TeamTactics }
  | { type: 'markNewsRead'; ids: string[] }
  | { type: 'respondToInteraction'; interactionId: string; optionId: string }
  | { type: 'requestInterview'; playerId: string }
  | { type: 'requestCoachReport'; playerId: string }
  | { type: 'suggestToCoach'; direction: string }
  | { type: 'proposeTrade'; proposal: TradeProposal }
  | { type: 'acceptTrade'; offerId: string }
  | { type: 'rejectTrade'; offerId: string }
  | { type: 'resignPlayer'; playerId: string; salary: number; years: number }
  | { type: 'releasePlayer'; playerId: string }
  | { type: 'signFreeAgent'; playerId: string; salary: number; years: number }
  /** User makes their selection while on the clock. */
  | { type: 'draftPlayer'; playerId: string }
  /** Sim AI picks until the user is on the clock or the draft ends. */
  | { type: 'advanceDraft' }
  /** Move the offseason to its next stage (awards → draft → resign → FA → preseason). */
  | { type: 'advanceOffseason' }
  /* ── persistence ── */
  | { type: 'exportSave'; saveName: string }
  | { type: 'importSave'; snapshot: CareerSnapshot }
  /* ── scouting ── */
  | { type: 'getScouting' }
  | { type: 'assignScout'; scoutId: string; target: ScoutTarget; focus?: ScoutFocus }
  | { type: 'hireScout'; candidateId: string }
  | { type: 'fireScout'; scoutId: string }
  /* ── story layer ── */
  /** All-time record boards, season archive, awards, legends/Hall of Fame. */
  | { type: 'getHistory' }
  /** The user club's locker room: captaincy, influence, relationships, familiarity. */
  | { type: 'getLockerRoom' }
  /** Season tentpoles: trade rumors, deadline recap, lottery, combine, tournament. */
  | { type: 'getTentpoles' }
  /* ── press corps ── */
  /** Poll for the pending press writing job, if any. */
  | { type: 'getPressJob' }
  /** Submit a finished article (LLM or wire report) to the career inbox. */
  | { type: 'submitPressArticle'; jobId: string; headline: string; body: string; byline: string; model: string }
  /** Discard the pending job (feature toggled off or skip). */
  | { type: 'skipPressJob'; jobId: string }
  /** Poll for a pending press-conference question, if any. */
  | { type: 'getPresser' }
  /** Submit the user's press-conference answer. */
  | { type: 'answerPresser'; answer: string; tone: PressTone }
  /* ── EHM plumbing modules (Wave 3) ── */
  /** AGM depth chart and category bests (EHM Team > Report tab). */
  | { type: 'getReport' }
  /** Practice state + auto-suggestion. */
  | { type: 'getPractice' }
  /** Overwrite the team practice state. */
  | { type: 'setPractice'; state: TeamPracticeState }
  /** Toggle a player's healthy-scratch status. */
  | { type: 'toggleScratch'; playerId: string }
  /** Set (or clear) a per-player individual focus override (null = revert to team focus). */
  | { type: 'setPlayerFocusDrill'; playerId: string; focus: PracticeFocus | null }
  /** League-wide top-N leaderboards for the League hub. */
  | { type: 'getLeagueLeaders'; topN?: number }
  /** Team leaders panel (goals/assists/points/+-/AvR/GAA/SV%). */
  | { type: 'getTeamLeaders' }
  /**
   * Apply the coach's style suggestion: merge Partial<TeamTactics> onto the
   * user team's current tactics (additive — only supplied fields are changed).
   */
  | { type: 'applyCoachSuggestion'; suggestedTactics: Partial<TeamTactics> }
  /**
   * Ask the head coach to build the full lineup (who dresses, who sits,
   * line ordering). Returns a LinesView for the UI draft — does NOT persist.
   */
  | { type: 'coachSetLines' }
  /* ── franchise drama + League hub (Wave 4) ── */
  /** Owner/board mandate, confidence, patience, hot-seat status. */
  | { type: 'getBoard' }
  | { type: 'getClubInfo' }
  /** All current rivalries sorted by intensity. */
  | { type: 'getRivalries' }
  /** Team special-teams table (PP% / PK%). */
  | { type: 'getLeagueStats' }
  /** Recent transactions, most recent first. */
  | { type: 'getTransactions'; limit?: number }
  /** Scoreboard for a given day (defaults to current day). */
  | { type: 'getScoreboard'; day?: number }
  /* ── AHL farm system ── */
  /** League-wide AHL standings. */
  | { type: 'getAhlStandings' }
  /** User's AHL affiliate roster. */
  | { type: 'getAhlSquad' }
  /** Recall an AHL player to the user's NHL roster. */
  | { type: 'callUp'; playerId: string }
  /** Assign an NHL player to the user's AHL affiliate. */
  | { type: 'sendDown'; playerId: string }
  /* ── Phase B: player profile view layer ── */
  /** Six-axis radar comparison for two players (Phase C compare UI). */
  | { type: 'compareRadar'; playerIdA: string; playerIdB: string }
  /* ── Data Hub: xG analytics ── */
  /** League-wide xG model analytics: per-team rates + percentiles, player leaders. */
  | { type: 'getDataHub' }
  /** Team-focused Data Hub with category breakdowns (Offense/Defence/PP/PK/Goaltending). */
  | { type: 'getTeamDataHub'; teamId: string }
  /* ── Team browser (EHM team-nav arrows, task #31) ── */
  /** Full list of NHL teams + AHL affiliates for the team-nav dropdown. */
  | { type: 'getLeagueTeams' }
  /** Squad view for an arbitrary team (read-only; falls back to user team when teamId absent). */
  | { type: 'getTeamSquad'; teamId: string }
  /** Schedule view for an arbitrary team. */
  | { type: 'getTeamSchedule'; teamId: string }
  /** Per-player season stats for a specific team (Team > Statistics tab). */
  | { type: 'getTeamPlayerStats'; teamId: string }
  /** Full staff complement for a team (own team when teamId absent). */
  | { type: 'getTeamStaff'; teamId?: string }

/** Intersecting with the union distributes, preserving the discriminants. */
export type WorkerRequest = WorkerRequestBody & { id: number }

export type WorkerResponse = { id: number } & (
  | { type: 'pong'; at: number }
  | { type: 'version'; engine: string }
  | { type: 'teamList'; teams: TeamInfo[] }
  /** Legacy v1 view — kept while the old hub still exists. */
  | { type: 'view'; view: ManagerView }
  | { type: 'watch'; view: ManagerView; game: WatchedGame | null }
  /* ── v2 screens ── */
  | { type: 'dashboard'; dashboard: DashboardView }
  | { type: 'squad'; squad: SquadView }
  | { type: 'player'; player: PlayerProfileView }
  | { type: 'tactics'; tactics: TacticsView }
  | { type: 'calendar'; calendar: CalendarView }
  | { type: 'schedule'; schedule: ScheduleView }
  | { type: 'standings'; standings: StandingsView }
  | { type: 'competitions'; competitions: CompetitionsView }
  | { type: 'international'; international: InternationalView }
  | { type: 'draftRankings'; draftRankings: DraftRankingsView }
  | { type: 'dataAnalyst'; dataAnalyst: DataAnalystView }
  | { type: 'stats'; stats: StatsView }
  | { type: 'trades'; trades: TradesView }
  | { type: 'draft'; draft: DraftView }
  | { type: 'finances'; finances: FinanceView }
  | { type: 'inbox'; inbox: InboxView }
  | { type: 'teamLegends'; legends: TeamLegendsView }
  | { type: 'teamDynamics'; dynamics: TeamDynamicsView }
  | { type: 'medical'; medical: MedicalView }
  | { type: 'development'; development: DevelopmentCenterView }
  | { type: 'squadPlanner'; squadPlanner: SquadPlannerView }
  | { type: 'leagueStatTable'; table: LeagueStatTableView }
  | { type: 'coachResponse'; accepted: boolean; response: string }
  | { type: 'agenda'; items: AgendaItem[] }
  | { type: 'discussion'; result: DiscussionResult }
  | { type: 'playoffs'; playoffs: PlayoffBracketView | null }
  | { type: 'offseason'; offseason: OffseasonView | null }
  | { type: 'boxScore'; boxScore: BoxScoreView | null }
  /** Result of a trade proposal: AI verdict, possibly a counter-offer. */
  | { type: 'tradeEvaluation'; evaluation: TradeEvaluation }
  /** Generic acknowledgement for mutations; screens refetch what they need. */
  | { type: 'ok' }
  | { type: 'save'; snapshot: CareerSnapshot }
  | { type: 'scouting'; scouting: ScoutingView }
  /* ── story layer ── */
  | { type: 'history'; history: HistoryView }
  | { type: 'lockerRoom'; lockerRoom: LockerRoomView }
  | { type: 'tentpoles'; tentpoles: TentpoleView }
  /* ── press corps ── */
  | { type: 'pressJob'; pressJob: PressJob | null }
  | { type: 'presser'; presser: PressConferenceState | null }
  /* ── EHM plumbing modules (Wave 3) ── */
  | { type: 'report'; report: AgmReportView }
  | { type: 'practice'; practice: PracticeView }
  | { type: 'leagueLeaders'; leaders: LeagueLeadersView }
  | { type: 'teamLeaders'; leaders: import('@engine/league/playerRating').TeamLeadersView }
  /* ── franchise drama + League hub (Wave 4) ── */
  | { type: 'board'; board: BoardView }
  | { type: 'clubInfo'; clubInfo: ClubInfoView }
  | { type: 'rivalries'; rivalries: RivalriesView }
  | { type: 'leagueStats'; stats: LeagueStatsView }
  | { type: 'transactions'; transactions: TransactionsView }
  | { type: 'scoreboard'; scoreboard: ScoreboardView }
  /** Coach-built lineup ready to load into the UI draft. */
  | { type: 'coachLines'; lines: LinesView }
  /* ── AHL farm system ── */
  | { type: 'ahlStandings'; standings: AhlStandingsView }
  | { type: 'ahlSquad'; squad: AhlSquadView }
  /* ── Phase B: player profile view layer ── */
  | { type: 'compareRadar'; comparison: CompareRadarView }
  /* ── Data Hub: xG analytics ── */
  | { type: 'dataHub'; dataHub: DataHubView }
  | { type: 'teamDataHub'; teamDataHub: TeamDataHubView }
  /* ── Team browser (task #31) ── */
  | { type: 'leagueTeams'; teams: LeagueTeamsView }
  | { type: 'teamPlayerStats'; stats: TeamPlayerStatsView }
  | { type: 'teamStaff'; staff: import('@engine/career/views').StaffView }
  | { type: 'error'; message: string }
)
