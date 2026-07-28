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
export type { BoardMeetingScene, MeetingAgendaItem, MeetingLine, MeetingOption, MeetingSpeaker } from '@engine/career/boardMeeting'
import type { BoardMeetingScene } from '@engine/career/boardMeeting'
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
  MatchDayPreviewView,
  PostgameReceiptView,
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
  WaiverWireRowView,
  LeagueWireView,
  GMProfileView,
  GMJobMarketView,
  GMRelationshipsView,
  MentorshipView,
  ClubDirectionView,
  FanbaseView,
  SponsorsView,
  OwnerRequestView,
  PersonalityReadView,
  PersonalityTraitRead,
  PlayerAnalyticsRow,
  PlayerBioView,
  PlayerHonoursView,
  PlayerProfileView,
  PlayoffBracketView,
  PracticePlanView,
  PracticeView,
  ProfileContractView,
  RadarAxes,
  RadarView,
  RivalriesView,
  ScheduleView,
  ScoreboardView,
  ScoutingView,
  ScoutProfileView,
  SquadView,
  LeadershipView,
  MediaCircuitView,
  RoleBoardView,
  CompetitionsView,
  InternationalView,
  DraftRankingsView,
  StandingsView,
  StatsView,
  TacticsView,
  TeamAnalyticsRow,
  TentpoleView,
  TradeAssessmentView,
  TradeDraftView,
  TradeInterestView,
  TradeEvaluation,
  TradeProposal,
  TradesView,
  DeadlineDayView,
  TransactionsView,
  TeamLeadersView,
  TeamPlayerStatRow,
  TeamPlayerStatsView,
} from '@engine/career/views'
export type { PlayerInteractionView, InteractionOptionView } from '@engine/career/views'
export type { InterviewView, InterviewAnswerView } from '@engine/career/views'
export type { TeamLegendsView, ClubLegend } from '@engine/career/views'
import type { TeamLegendsView } from '@engine/career/views'
export type { TeamDynamicsView, DynamicsPlayerView, DynamicsBar, DynamicsSocialGroup } from '@engine/career/views'
import type { TeamDynamicsView } from '@engine/career/views'
export type { FeedView, FeedAuthor } from '@engine/career/views'
import type { FeedView } from '@engine/career/views'
export type { DevCampView, DevCampInvitesView, CampInvitesView, TrainingCampView, TrainingCampState } from '@engine/career/views'
import type { DevCampView, DevCampInvitesView, CampInvitesView, TrainingCampView } from '@engine/career/views'
export type { NegotiationView, NegotiationRoundView, ContractOffer, ClauseLevel } from '@engine/career/views'
import type { NegotiationView, ContractOffer } from '@engine/career/views'
// Renderer screens already import these from the protocol barrel, but they were
// never re-exported here — so those imports silently failed to resolve and the
// screens lost their view typing. Purely ADDITIVE re-exports (no existing shape
// is touched), which the frozen-contract rule allows.
export type {
  CalendarEntry,
  BoxScoreGoalieRow,
  BoxScoreSkaterRow,
  GoalLogRow,
  PenaltyLogRow,
  SeriesView,
  LeaderRowView,
  PayrollRowView,
} from '@engine/career/views'
export type { NewsItem } from '@domain'
export type { BoardSummaryView } from '@engine/league/board'

// These eleven were REFERENCED by response messages below but never imported —
// so those messages (waiver wire, league wire, GM profile/job market/relations,
// mentorship, owner requests, sponsors, fanbase, club direction, compare radar)
// were silently untyped and worker/renderer could drift apart unchecked.
import type {
  ClubDirectionView,
  CompareRadarView,
  FanbaseView,
  GMJobMarketView,
  GMProfileView,
  GMRelationshipsView,
  LeagueWireView,
  MentorshipView,
  OwnerRequestView,
  SponsorsView,
  WaiverWireRowView,
} from '@engine/career/views'

export type { ReactionSpec } from '@engine/league/interactions'
import type { ReactionSpec } from '@engine/league/interactions'
export type { FaHubView, FaHubRowView, RfaBoardView, RfaTargetView } from '@engine/career/views'
import type { FaHubView, RfaBoardView } from '@engine/career/views'
export type { MedicalView, MedicalRow } from '@engine/career/views'
import type { MedicalView } from '@engine/career/views'
export type { DevelopmentCenterView, DevelopmentRow } from '@engine/career/views'
import type { DevelopmentCenterView } from '@engine/career/views'
export type { SquadPlannerView, PlannerPlayer, PositionDepth, CareerStage, PosGroup } from '@engine/career/views'
import type { SquadPlannerView } from '@engine/career/views'
export type { LeagueComparisonView, LeagueComparisonCard } from '@engine/career/views'
import type { LeagueComparisonView } from '@engine/career/views'
export type { StaffMeetingSummaryView, StaffMeetingFlaggedPlayer } from '@engine/career/views'
import type { StaffMeetingSummaryView } from '@engine/career/views'
export type { StaffMeetingView, StaffMeetingProposalView, StaffMeetingOptionView } from '@engine/career/views'
import type { StaffMeetingView } from '@engine/career/views'
export type { ScoutMeetingView, ScoutBoardLineView } from '@engine/career/views'
import type { ScoutMeetingView } from '@engine/career/views'
export type { CoachMarketView, CoachMarketCandidateView } from '@engine/career/views'
import type { CoachMarketView } from '@engine/career/views'
export type { PlayoffOddsView, PlayoffOddsRow } from '@engine/career/views'
import type { PlayoffOddsView } from '@engine/career/views'
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
  MatchDayPreviewView,
  PostgameReceiptView,
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
  ScoutProfileView,
  SquadView,
  LeadershipView,
  MediaCircuitView,
  RoleBoardView,
  CompetitionsView,
  InternationalView,
  DraftRankingsView,
  StandingsView,
  StatsView,
  TacticsView,
  TentpoleView,
  TradeAssessmentView,
  TradeDraftView,
  TradeInterestView,
  TradeEvaluation,
  TradeProposal,
  TradesView,
  DeadlineDayView,
  TransactionsView,
  TeamPlayerStatsView,
} from '@engine/career/views'
export type { ShoppedPlayerView, DeadlineFeedItemView } from '@engine/career/views'
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
  | { type: 'startCareer'; teamId: string; startAt?: 'seasonStart' | 'offseason' }
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
  /** #173: set the club's ticket-pricing lever. */
  | { type: 'setTicketPricing'; tier: 'value' | 'standard' | 'premium' }
  | { type: 'getInbox' }
  | { type: 'getTeamLegends'; teamId: string }
  | { type: 'getTeamDynamics'; teamId: string }
  | { type: 'getDevCamp' }
  | { type: 'getDevCampInvites' }
  | { type: 'toggleDevCampInvite'; playerId: string }
  | { type: 'getCampInvites' }
  | { type: 'toggleCampInvite'; playerId: string }
  | { type: 'submitDevCamp'; standoutId?: string }
  | { type: 'skipDevCamp' }
  | { type: 'getTrainingCamp' }
  | { type: 'submitTrainingCamp'; placements: Array<{ playerId: string; place: 'nhl' | 'ahl' }> }
  | { type: 'getFeed' }
  | { type: 'toggleFollowAuthor'; authorId: string }
  | { type: 'getNegotiation'; playerId: string }
  | { type: 'startNegotiation'; playerId: string }
  | { type: 'submitNegotiationOffer'; playerId: string; offer: ContractOffer }
  | { type: 'getFaHub' }
  | { type: 'toggleFaShortlist'; playerId: string }
  | { type: 'askFaAgent'; playerId: string }
  | { type: 'submitFaOffer'; playerId: string; salary: number; years: number }
  | { type: 'getRfaBoard' }
  | { type: 'submitOfferSheet'; playerId: string; salary: number; years: number }
  /** #188: GM sets a player's squad status / trade posture (null clears). */
  | { type: 'setSquadStatus'; playerId: string; status: import('@domain/player').SquadStatus | null }
  | { type: 'setTradeStatus'; playerId: string; status: import('@domain/player').TradeStatus | null }
  /** #188 roles tab: bulk role board + auto-assign. */
  | { type: 'getRoleBoard' }
  | { type: 'autoAssignSquadRoles'; overwrite?: boolean }
  /** #171 load management: toggle a healthy player's rest directive. */
  | { type: 'restPlayer'; playerId: string }
  | { type: 'placeOnLtir'; playerId: string }
  | { type: 'activateFromLtir'; playerId: string }
  /** #189: captains + jersey numbers for the user's club. */
  | { type: 'getLeadership' }
  | { type: 'getMediaCircuit' }
  | { type: 'setCaptain'; playerId: string | null }
  | { type: 'toggleAlternate'; playerId: string }
  | { type: 'setJerseyNumber'; playerId: string; number: number | null }
  /** #186: no-trade-clause waive negotiation. */
  | { type: 'askAgentWaiveNtc'; playerId: string }
  | { type: 'askPlayerTradeList'; playerId: string }
  | { type: 'getMedical' }
  | { type: 'getDevelopment' }
  | { type: 'getSquadPlanner' }
  | { type: 'getLeagueComparison' }
  | { type: 'getPlayoffOdds' }
  | { type: 'getStaffMeetingSummary' }
  | { type: 'getStaffMeeting' }
  | { type: 'submitStaffMeeting'; choices: Record<string, string> }
  | { type: 'delegateStaffMeeting' }
  | { type: 'getScoutMeeting' }
  | { type: 'submitScoutMeeting'; choices: Record<string, string> }
  | { type: 'delegateScoutMeeting' }
  | { type: 'getCoachMarket' }
  | { type: 'fireCoach' }
  | { type: 'hireCoach'; coachId: string }
  | { type: 'getLeagueStatTable'; teamId?: string }
  | { type: 'getAgenda' }
  | { type: 'markForMeeting'; playerId: string; topic: string }
  | { type: 'discussAgendaItem'; itemId: string }
  | { type: 'getPlayoffs' }
  | { type: 'getOffseason' }
  /** Box score of the most recently played user game, if any. */
  | { type: 'getLastBoxScore' }
  /** B6.1: the compact match-day frame when the next day to sim has a user game. */
  | { type: 'getMatchDayPreview' }
  /** B6.2: postgame receipts for the latest user game (score, stars, turning point). */
  | { type: 'getPostgameReceipt' }
  /* ── mutations ── */
  | { type: 'setLines'; lines: LinesUpdate }
  | { type: 'setTactics'; tactics: TeamTactics }
  | { type: 'saveLineSetup'; name: string }
  | { type: 'applyLineSetup'; name: string }
  | { type: 'deleteLineSetup'; name: string }
  | { type: 'setLineManagementMode'; mode: 'coach' | 'fillGaps' }
  | { type: 'markNewsRead'; ids: string[] }
  | { type: 'respondToInteraction'; interactionId: string; optionId: string }
  | { type: 'requestInterview'; playerId: string }
  | { type: 'requestCoachReport'; playerId: string }
  | { type: 'suggestToCoach'; direction: string }
  | { type: 'proposeTrade'; proposal: TradeProposal }
  | { type: 'assessTrade'; proposal: TradeProposal }
  | { type: 'evaluateTradeDraft'; proposal: TradeProposal }
  | { type: 'gaugeTradeInterest'; proposal: TradeProposal }
  | { type: 'shopPlayer'; playerId: string }
  | { type: 'acceptTrade'; offerId: string }
  | { type: 'rejectTrade'; offerId: string }
  | { type: 'resignPlayer'; playerId: string; salary: number; years: number }
  | { type: 'releasePlayer'; playerId: string }
  | { type: 'signFreeAgent'; playerId: string; salary: number; years: number }
  /** Match a rival offer sheet on one of your RFAs (re-sign at the offered terms). */
  | { type: 'matchOfferSheet'; playerId: string }
  /** Let an offer-sheeted RFA walk and take the draft-pick compensation. */
  | { type: 'declineOfferSheet'; playerId: string }
  /** Read the live in-season waiver wire (AI castoffs claimable by the user). */
  | { type: 'getWaiverWire' }
  /** Read the leaguewide ticker feed (recent transactions + notable streaks). */
  | { type: 'getLeagueWire' }
  /** Read the user's GM profile (identity, reputation, career record). */
  | { type: 'getGMProfile' }
  /** Read open GM vacancies (populated when the user is fired). */
  | { type: 'getGMJobMarket' }
  /** Read the user GM's standing with rival clubs. */
  | { type: 'getGMRelationships' }
  /** Read veteran/rookie mentorships + eligible players. */
  | { type: 'getMentorships' }
  /** Pair a veteran mentor with a young mentee. */
  | { type: 'assignMentor'; menteeId: string; mentorId: string }
  /** Dissolve a mentorship. */
  | { type: 'clearMentor'; menteeId: string }
  /** Read the GM's competitive stance + whether a rebuild can be sanctioned. */
  | { type: 'getClubDirection' }
  /** Set the GM's competitive stance (compete / retool / rebuild). */
  | { type: 'setClubDirection'; direction: 'compete' | 'retool' | 'rebuild' }
  /** Read fan engagement + its effect on the owner budget. */
  | { type: 'getFanbase' }
  /** Read the club's sponsorship deals + revenue. */
  | { type: 'getSponsors' }
  /** Accept a GM vacancy and move clubs. */
  | { type: 'acceptGMJob'; teamId: string }
  /** Read the pending owner directive, if any. */
  | { type: 'getOwnerRequest' }
  /** Respond to the pending owner directive. */
  | { type: 'respondOwnerRequest'; accept: boolean }
  /** Claim a player off the in-season waiver wire onto the user's roster. */
  | { type: 'claimWaiver'; playerId: string }
  /** User makes their selection while on the clock. */
  | { type: 'draftPlayer'; playerId: string }
  /** Sim exactly one AI pick (pick-by-pick stepping). */
  | { type: 'simNextPick' }
  /** Sim AI picks until the user is on the clock or the draft ends. */
  | { type: 'advanceDraft' }
  /** Sim the ENTIRE remaining draft, auto-picking best-available for the user. */
  | { type: 'autoDraft' }
  /** Move the offseason to its next stage (awards → draft → resign → FA → preseason). */
  | { type: 'advanceOffseason' }
  /* ── persistence ── */
  | { type: 'exportSave'; saveName: string }
  | { type: 'importSave'; snapshot: CareerSnapshot }
  /* ── scouting ── */
  | { type: 'getScouting' }
  | { type: 'getScoutProfile'; scoutId: string }
  | { type: 'assignScout'; scoutId: string; target: ScoutTarget; focus?: ScoutFocus; positionFilter?: 'any' | 'F' | 'D' | 'G'; minPotentialStars?: number }
  | { type: 'autoAssignScouts' }
  | { type: 'hireScout'; candidateId: string }
  | { type: 'fireScout'; scoutId: string }
  /** Scouting Centre triage (FM-style): track / un-track / pass / re-scout a find. */
  | { type: 'shortlistProspect'; playerId: string }
  | { type: 'unshortlistProspect'; playerId: string }
  | { type: 'dismissProspect'; playerId: string }
  | { type: 'rescoutProspect'; playerId: string }
  /** Playtest #10: release the scout-digest hold (GM interacted or delegated). */
  | { type: 'resolveScoutDigest' }
  /** Global search for the command palette (players + teams by name). */
  | { type: 'searchAll'; query: string }
  /** [id, name] index of every player, for linkifying names in prose. */
  | { type: 'getNameIndex' }
  /** Buy out a contract during the offseason window (M2). */
  | { type: 'buyoutPlayer'; playerId: string }
  /** Arbitration ultimatum: accept the award or walk away (M2). */
  | { type: 'acceptArbitration'; playerId: string }
  | { type: 'walkArbitration'; playerId: string }
  /** Box score of a specific played user game (calendar/schedule click-through). */
  | { type: 'getBoxScoreFor'; gameId: string }
  /* ── season rhythm: meetings (M1) ── */
  /** The pending preseason board-meeting scene (null once attended). */
  | { type: 'getBoardMeeting' }
  /** Attend the meeting with your chosen answers per agenda item. */
  | { type: 'submitBoardMeeting'; choices: Record<string, string> }
  /** The deadline war-room briefing (only while the deadline hold is active). */
  | { type: 'getWarRoom' }
  /** The deadline-day hub — offers, block, live wire (only during the hold). */
  | { type: 'getDeadlineDay' }
  /** The staged End-of-Season Review scene (M4), or null. */
  | { type: 'getSeasonReview' }
  /** Answer for the season (single 'answer' agenda choice). */
  | { type: 'submitSeasonReview'; choice: string }
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
  /** Auto-assign each roster player a focus targeting his weakest area. */
  | { type: 'recommendPlayerFocuses' }
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
  /** Auto-apply the coach's recommended NHL roster (call-ups + send-downs). */
  | { type: 'setCoachRoster' }
  /** Revert the most recent coach roster auto-set. */
  | { type: 'undoCoachRoster' }
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
  | { type: 'leadership'; leadership: LeadershipView; ok?: boolean; message?: string }
  | { type: 'mediaCircuit'; mediaCircuit: MediaCircuitView }
  | { type: 'roleBoard'; roleBoard: RoleBoardView; assigned?: number }
  | { type: 'player'; player: PlayerProfileView }
  /** #186: result of a no-trade-clause waive negotiation + the refreshed player. */
  | { type: 'ntcNegotiation'; player: PlayerProfileView; ok: boolean; message: string
      verdict?: 'granted' | 'conditional' | 'refused'
      teams?: Array<{ teamId: string; name: string }> }
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
  | { type: 'waiverWire'; waiverWire: WaiverWireRowView[] }
  | { type: 'leagueWire'; leagueWire: LeagueWireView }
  | { type: 'gmProfile'; gmProfile: GMProfileView }
  | { type: 'gmJobMarket'; gmJobMarket: GMJobMarketView }
  | { type: 'gmRelationships'; gmRelationships: GMRelationshipsView }
  | { type: 'mentorships'; mentorships: MentorshipView }
  | { type: 'clubDirection'; clubDirection: ClubDirectionView }
  | { type: 'fanbase'; fanbase: FanbaseView }
  | { type: 'sponsors'; sponsors: SponsorsView }
  | { type: 'ownerRequest'; ownerRequest: OwnerRequestView | null }
  | { type: 'inbox'; inbox: InboxView }
  | { type: 'teamLegends'; legends: TeamLegendsView }
  | { type: 'teamDynamics'; dynamics: TeamDynamicsView }
  | { type: 'feed'; feed: FeedView }
  | { type: 'negotiation'; negotiation: NegotiationView | null; signed?: boolean; message?: string }
  | { type: 'faHub'; faHub: FaHubView }
  | { type: 'devCamp'; devCamp: DevCampView | null }
  | { type: 'devCampInvites'; invites: DevCampInvitesView }
  | { type: 'devCampInviteResult'; ok: boolean; invited: boolean; message?: string; invites: DevCampInvitesView }
  | { type: 'campInvites'; invites: CampInvitesView }
  | { type: 'campInviteResult'; ok: boolean; invited: boolean; message?: string; invites: CampInvitesView }
  | { type: 'trainingCamp'; camp: TrainingCampView | null; notes?: string[] }
  | { type: 'medical'; medical: MedicalView; ok?: boolean; message?: string }
  | { type: 'development'; development: DevelopmentCenterView }
  | { type: 'squadPlanner'; squadPlanner: SquadPlannerView }
  | { type: 'leagueComparison'; comparison: LeagueComparisonView }
  | { type: 'playoffOdds'; odds: PlayoffOddsView }
  | { type: 'staffMeetingSummary'; summary: StaffMeetingSummaryView }
  | { type: 'staffMeeting'; staffMeeting: StaffMeetingView | null }
  | { type: 'staffMeetingResult'; applied: string[]; summary: string }
  | { type: 'scoutMeeting'; scoutMeeting: ScoutMeetingView | null }
  | { type: 'scoutMeetingResult'; applied: string[]; summary: string }
  | { type: 'coachMarket'; market: CoachMarketView }
  | { type: 'coachHireResult'; ok: boolean; message: string }
  | { type: 'leagueStatTable'; table: LeagueStatTableView }
  | { type: 'coachResponse'; accepted: boolean; response: string }
  | { type: 'agenda'; items: AgendaItem[] }
  | { type: 'discussion'; result: DiscussionResult }
  | { type: 'playoffs'; playoffs: PlayoffBracketView | null }
  | { type: 'offseason'; offseason: OffseasonView | null }
  | { type: 'boxScore'; boxScore: BoxScoreView | null }
  /** B6.1: null when the next day to sim has no user game. */
  | { type: 'matchDayPreview'; preview: MatchDayPreviewView | null }
  /** B6.2: null when the latest advance didn't play a user game. */
  | { type: 'postgameReceipt'; receipt: PostgameReceiptView | null }
  /** Result of a trade proposal: AI verdict, possibly a counter-offer. */
  | { type: 'tradeEvaluation'; evaluation: TradeEvaluation }
  /** Your assistant GM's live read as you build a package (advice, not an answer). */
  | { type: 'tradeAssessment'; assessment: TradeAssessmentView }
  /** Live per-asset value breakdown + verdicts for the trade builder. */
  | { type: 'tradeDraft'; draft: TradeDraftView }
  /** The partner GM's NON-BINDING interest read (gauge interest before proposing). */
  | { type: 'tradeInterestRead'; read: TradeInterestView }
  /** Result of shopping a player: how many offers came in + a summary line. */
  | { type: 'shopResult'; count: number; message: string }
  /** A free agent's agent's read on the market (may deflect). */
  | { type: 'agentRead'; text: string }
  /** Result of tabling a standing offer to a free agent. */
  | { type: 'faOfferResult'; ok: boolean; message: string; faHub: FaHubView }
  /** Rival RFAs available to offer-sheet. */
  | { type: 'rfaBoard'; board: RfaBoardView }
  /** Result of an offer sheet: matched (kept) or landed (yours). */
  | { type: 'offerSheetResult'; ok: boolean; matched: boolean; pending?: boolean; message: string; board: RfaBoardView }
  /** Generic acknowledgement for mutations; screens refetch what they need. */
  | { type: 'ok'; note?: string; reaction?: ReactionSpec }
  /** Result of an auto-applied coach roster: the player names moved each way. */
  | { type: 'coachRosterSet'; promoted: string[]; demoted: string[] }
  | { type: 'save'; snapshot: CareerSnapshot }
  | { type: 'scouting'; scouting: ScoutingView }
  | { type: 'scoutProfile'; scoutProfile: ScoutProfileView | null }
  | {
      type: 'searchResults'
      results: {
        players: Array<{ playerId: string; name: string; position: string; age: number; teamAbbr: string; faceId?: string }>
        teams: Array<{ teamId: string; name: string; abbr: string }>
      }
    }
  | { type: 'nameIndex'; entries: Array<[string, string]> }
  | {
      type: 'warRoom'
      warRoom: {
        stance: string
        capLine: string
        coachLine: string
        agmLine: string
        targets: Array<{ playerId: string; name: string; position: string; age: number; teamAbbr: string; gmName: string; gmStyle: string }>
        suitors: Array<{ teamAbbr: string; gmName: string; gmStyle: string; wantsName: string }>
        cast: Array<{ id: string; name: string; title: string; faceId?: string }>
      } | null
    }
  | { type: 'deadlineDay'; deadlineDay: DeadlineDayView | null }
  /* ── season rhythm: meetings (M1) ── */
  | { type: 'boardMeeting'; scene: BoardMeetingScene | null }
  | { type: 'boardMeetingResult'; ok: boolean; lines: Array<{ speakerId: string; text: string }>; summary: string }
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
