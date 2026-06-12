/**
 * UI view models — the frozen contract between the Career (worker side) and the
 * React screens. Screens import ONLY these types (plus protocol.ts); the Career
 * builds them. Everything here must survive structured clone (no Maps, no class
 * instances, no functions).
 *
 * Date convention: the fictional season starts October 1 of its year; match day
 * `d` maps to `seasonStart + (d-1) * 2` calendar days. Use `dayToDateISO` so the
 * whole app agrees. This is presentation only — the engine still runs on
 * integer match days.
 */
import type {
  DraftPick,
  GameResult,
  Injury,
  NewsItem,
  PlayoffsState,
  Position,
  TeamTactics,
} from '@domain'
import type { ScoutAssignment, ScoutingState, ScoutTarget } from '@domain/scouting'
export type { ScoutTarget } from '@domain/scouting'
export type { StaffMember, AgmReport, AgmRankedPlayer } from '@engine/league/staff'
export type { TeamLeadersView, LeaderChip, TeamLeadersEntry } from '@engine/league/playerRating'
export type { TeamPracticeState, PracticeFocus } from '@engine/league/practice'
import type { ArcsState } from '@engine/story/arcs'
import type {
  AwardRecord,
  LegendRecord,
  RecordEntry,
  RecordsState,
  SeasonArchive,
} from '@engine/story/records'
import type { ExpectationsState } from '@engine/story/expectations'
import type { LockerRoomState } from '@engine/league/lockerRoom'
import type { ExecutedTradeSummary, TentpolesState } from '@engine/league/tentpoles'
import type { StaffMember, AgmReport } from '@engine/league/staff'
import type { TeamLeadersView } from '@engine/league/playerRating'
import type { TeamPracticeState, PracticeFocus } from '@engine/league/practice'
import type { BoardState, BoardSummaryView } from '@engine/league/board'
import type { RivalriesState } from '@engine/league/rivalries'
import type { SpecialTeamsEntries, TransactionLedger, TeamSpecialTeams, Transaction } from '@engine/league/leagueStats'
export type { BoardSummaryView } from '@engine/league/board'
export type { Rivalry, RivalriesState } from '@engine/league/rivalries'
export type { TeamSpecialTeams, Transaction, TransactionKind } from '@engine/league/leagueStats'

/* ────────────────────────── shared atoms ────────────────────────── */

export type CareerPhase = 'regularSeason' | 'playoffs' | 'offseason'

/** Archetype summary as shown in player badges and squad rows. */
export interface ArchetypeInfo {
  /** e.g. 'sniper', 'playmaker' */
  key: string
  /** Human label from ARCHETYPE_META, e.g. 'Sniper' */
  label: string
  /** Short trait descriptors, e.g. ['high-end shot', 'wheels'] */
  descriptors: string[]
}

/** Minimal player chip used anywhere a player is listed/linked. */
export interface PlayerBadge {
  playerId: string
  name: string
  position: Position
  age: number
  overall: number
  /** Present when this player is visible through the scouting fog. */
  scouted?: {
    knowledge: number
    overallLo: number
    overallHi: number
    /** True when knowledge >= 95 (exact data) */
    exact: boolean
  }
  /**
   * Archetype classification. Present on own-roster players always; on scouted
   * players only when knowledge >= 50 (scout's read). Omitted when fogged.
   */
  archetype?: ArchetypeInfo
}

export interface ContractView {
  /** Dollars per year. */
  salary: number
  yearsRemaining: number
  expiryYear: number
  noTradeClause: boolean
  twoWay: boolean
}

export interface SkaterSeasonLine {
  gamesPlayed: number
  goals: number
  assists: number
  points: number
  plusMinus: number
  penaltyMinutes: number
  shots: number
  /** Average time on ice per game, seconds. */
  toiPerGame: number
  ppGoals: number
  ppAssists: number
}

export interface GoalieSeasonLine {
  gamesPlayed: number
  wins: number
  losses: number
  savePct: number
  goalsAgainstAverage: number
  shutouts: number
  saves: number
  shotsAgainst: number
}

/** ISO date string for a given season year + match day (Oct 1 + (day-1)*2). */
export function dayToDateISO(year: number, day: number): string {
  const d = new Date(Date.UTC(year, 9, 1))
  d.setUTCDate(d.getUTCDate() + Math.max(0, day - 1) * 2)
  return d.toISOString().slice(0, 10)
}

/* ────────────────────────── dashboard ────────────────────────── */

export interface StandingRowView {
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
  /** 'W3', 'L1' style streak label. */
  streak: string
  /** Results of last five user-relevant games, newest last, 'W' | 'L' | 'O'. */
  lastFive: string
}

export interface NextGameView {
  day: number
  date: string
  opponentTeamId: string
  opponentName: string
  opponentAbbr: string
  home: boolean
  /** Opponent's league rank for the pre-match blurb. */
  opponentRank: number
  /** Non-null when this is a rivalry game (intensity >= 60). */
  rivalryLabel: string | null
}

export interface LastResultView {
  day: number
  date: string
  homeAbbr: string
  awayAbbr: string
  homeGoals: number
  awayGoals: number
  decidedBy: GameResult['decidedBy']
}

export interface DashboardView {
  leagueName: string
  year: number
  phase: CareerPhase
  /** Last completed match day (0 = season not started). */
  day: number
  totalDays: number
  date: string
  /** Label for the Continue button, e.g. "Continue to 12 Oct" or "Start draft". */
  continueLabel: string
  userTeam: {
    teamId: string
    name: string
    abbreviation: string
    rank: number
    conferenceRank: number
    standing: StandingRowView
  }
  nextGame: NextGameView | null
  lastResult: LastResultView | null
  /** Compact division table containing the user's club. */
  divisionStandings: StandingRowView[]
  divisionName: string
  unreadNews: number
  /** Top three team scorers for the sidebar. */
  topScorers: Array<PlayerBadge & { points: number; goals: number; assists: number }>
  injuries: Array<PlayerBadge & { injury: Injury }>
  capUsed: number
  salaryCap: number
  /** Champion banner once playoffs finish. */
  championTeamName: string | null
  /** Pundits' preseason projection for the user's club (1 = title favourite). */
  predictedRank?: number
  /** Highest-tension active storylines for the dashboard ticker (max 3). */
  topArcs: Array<{ kind: string; headline: string }>
  /** EHM right-rail: team leaders incl. average game rating. */
  teamLeaders?: TeamLeadersView
  /** EHM front-office panel: a rotating featured player with form badge. */
  playerFocus?: {
    playerId: string
    name: string
    position: Position
    overall: number
    seasonLine: string
    gameRatingForm: string
    avgRating: number
  }
  /** EHM front-office panel: budget/cap summary. */
  financesSummary?: {
    balance: number
    capUsed: number
    capSpace: number
    avgSalary: number
  }
  /** Board confidence chip: mandate text, confidence/patience meters, hot-seat status. */
  board?: BoardSummaryView
  /** True when the GM has been fired (board.firedAtYear is non-null). */
  gmFired?: boolean
}

/* ────────────────────────── squad / player ────────────────────────── */

export interface SquadRowView extends PlayerBadge {
  role: string
  handedness: 'L' | 'R'
  /** 0–100; 100 = fully fresh. */
  condition: number
  morale: number
  /** Hot/cold streak, roughly -5..5. */
  form: number
  injury: Injury | null
  contract: ContractView
  /** e.g. "L1", "D2", "G1", "—" for scratches; suffix "/PP1" when on a unit. */
  lineLabel: string
  skater: SkaterSeasonLine | null
  goalie: GoalieSeasonLine | null
  /** True if listed as a healthy scratch for the next game. */
  scratched: boolean
  /** EHM-style form string from last 5 game ratings, e.g. "BABCA" newest-first. */
  gameRatingForm: string
  /** Season average game rating (0 = no games played). */
  avgRating: number
}

export interface SquadView {
  teamName: string
  rows: SquadRowView[]
  /** Total roster size / currently dressed players. */
  rosterCount: number
  dressedCount: number
}

export interface AttributeGroupView {
  /** "Technical" | "Physical" | "Mental" | "Defensive" | "Goaltending" */
  name: string
  /** Display label → 0–100 value, in stable display order. */
  attributes: Array<{
    label: string
    value: number
    /** Present when fog is active for this player. */
    lo?: number
    hi?: number
    masked?: boolean
  }>
}

export interface PlayerProfileView extends PlayerBadge {
  teamId: string | null
  teamName: string | null
  handedness: 'L' | 'R'
  role: string
  condition: number
  morale: number
  form: number
  injury: Injury | null
  contract: ContractView | null
  /** Scout's view of remaining upside: 1–5 stars. */
  potentialStars: number
  personality: Array<{ label: string; value: number }>
  attributeGroups: AttributeGroupView[]
  composites: Array<{ label: string; value: number }>
  /** Current season first, then history. */
  seasons: Array<{
    year: number
    teamAbbr: string
    skater: SkaterSeasonLine | null
    goalie: GoalieSeasonLine | null
  }>
}

/* ────────────────────────── tactics / lines ────────────────────────── */

export interface LineSlotView {
  /** 'LW' | 'C' | 'RW' | 'LD' | 'RD' | 'G' */
  slot: string
  player: PlayerBadge | null
}

export interface LinesView {
  forwards: LineSlotView[][]
  defensePairs: LineSlotView[][]
  goalies: LineSlotView[]
  powerPlayUnits: LineSlotView[][]
  penaltyKillUnits: LineSlotView[][]
  /** Healthy roster not currently in any even-strength line. */
  scratches: PlayerBadge[]
  /** Human-readable validation problems ("L3 has no centre", "injured player on PP1"). */
  issues: string[]
}

/** Synergy result for one forward line or defence pair. */
export interface LineSynergyView {
  /** 0–100 complementarity score. */
  score: number
  /** 0.97–1.03 multiplier that composes with chemistryModifier in the sim. */
  multiplier: number
  /** Human-readable explanations for the score. */
  notes: string[]
}

/** Coach-style suggestion payload on the Tactics screen. */
export interface CoachSuggestionView {
  styleLabel: string
  rationale: string[]
  /** The fields that would change if the user accepts the suggestion. */
  suggestedTactics: Partial<TeamTactics>
}

/** How well the current tactics fit the roster. */
export interface StyleFitView {
  /** 0–100 fit score. */
  fit: number
  /** Actionable advice to improve the match. */
  advice: string[]
}

export interface TacticsView {
  tactics: TeamTactics
  lines: LinesView
  /**
   * Per-forward-line synergy (parallel to lines.forwards).
   * Index i corresponds to lines.forwards[i].
   */
  lineSynergies: LineSynergyView[]
  /**
   * Per-defence-pair synergy (parallel to lines.defensePairs).
   * Index i corresponds to lines.defensePairs[i].
   */
  pairSynergies: LineSynergyView[]
  /** Style suggestion from teamStyleFit. */
  coachSuggestion: CoachSuggestionView
  /** How well the current tactics match the roster. */
  styleFit: StyleFitView
}

/** Sent UI → worker to apply the coach's tactical suggestion to the user team. */
export interface ApplyCoachSuggestionRequest {
  /** Fields from CoachSuggestionView.suggestedTactics — merged onto current tactics. */
  suggestedTactics: Partial<TeamTactics>
}

/** Sent UI → worker to overwrite even-strength + special-teams deployment. */
export interface LinesUpdate {
  forwards: string[][]
  defensePairs: string[][]
  goalies: string[]
  powerPlayUnits: string[][]
  penaltyKillUnits: string[][]
}

/* ────────────────────────── schedule / standings / stats ────────────────────────── */

export interface ScheduleEntryView {
  gameId: string
  day: number
  date: string
  opponentTeamId: string
  opponentName: string
  opponentAbbr: string
  home: boolean
  /** Null until played. */
  result: (GameResult & { won: boolean }) | null
  isNext: boolean
}

export interface ScheduleView {
  entries: ScheduleEntryView[]
}

export interface StandingsView {
  /** League-wide table, best first. */
  overall: StandingRowView[]
  conferences: Array<{ name: string; rows: StandingRowView[] }>
  divisions: Array<{ name: string; conferenceName: string; rows: StandingRowView[] }>
}

export interface LeaderRowView extends PlayerBadge {
  teamAbbr: string
  gamesPlayed: number
  /** The stat being ranked, already rounded for display. */
  value: number
}

export interface StatsView {
  points: LeaderRowView[]
  goals: LeaderRowView[]
  assists: LeaderRowView[]
  /** Min-games-qualified goalie boards. */
  savePct: LeaderRowView[]
  goalsAgainstAvg: LeaderRowView[]
  wins: LeaderRowView[]
}

/* ────────────────────────── trades ────────────────────────── */

export interface PickAssetView {
  /** Stable key, e.g. "2026-r1-t3". */
  id: string
  year: number
  round: number
  originalTeamAbbr: string
  label: string
}

export interface TradeSideView {
  teamId: string
  teamName: string
  teamAbbr: string
  players: Array<PlayerBadge & { salary: number; yearsRemaining: number }>
  picks: PickAssetView[]
}

export interface TradeOfferView {
  offerId: string
  /** What the user receives / gives up. */
  receive: TradeSideView
  give: TradeSideView
  /** AI's one-line pitch. */
  message: string
  expiresOnDay: number
}

/** UI → worker proposal: asset ids only. */
export interface TradeProposal {
  partnerTeamId: string
  givePlayerIds: string[]
  givePickIds: string[]
  receivePlayerIds: string[]
  receivePickIds: string[]
}

export interface TradeEvaluation {
  verdict: 'accept' | 'reject' | 'counter'
  /** AI's reasoning, shown to the user. */
  message: string
  /** Present when verdict is 'counter'. */
  counter: TradeOfferView | null
}

export interface TradePartnerView {
  teamId: string
  teamName: string
  teamAbbr: string
  players: Array<PlayerBadge & { salary: number; yearsRemaining: number; noTradeClause: boolean }>
  picks: PickAssetView[]
}

export interface TradesView {
  /** Offers AI clubs have sent the user. */
  incoming: TradeOfferView[]
  /** Every other club's tradeable assets for the proposal builder. */
  partners: TradePartnerView[]
  myPlayers: Array<PlayerBadge & { salary: number; yearsRemaining: number; noTradeClause: boolean }>
  myPicks: PickAssetView[]
  /** Trades are frozen outside the regular season (and after the deadline day, if set). */
  deadlineDay: number | null
  tradingOpen: boolean
}

/* ────────────────────────── draft / offseason / finances ────────────────────────── */

export interface ProspectRowView extends PlayerBadge {
  /** Scouting consensus, 1 = best. */
  rank: number
  potentialStars: number
  drafted: boolean
}

export interface DraftPickRowView {
  overallPick: number
  round: number
  teamId: string
  teamAbbr: string
  /** Filled once selected. */
  selection: (PlayerBadge & { rank: number }) | null
  isUserPick: boolean
}

export interface DraftView {
  year: number
  rounds: number
  /** Full board in pick order. */
  board: DraftPickRowView[]
  /** Index into board of the next selection; -1 when complete. */
  onClockIndex: number
  userIsOnClock: boolean
  prospects: ProspectRowView[]
  complete: boolean
}

export interface ResignRowView extends PlayerBadge {
  currentSalary: number
  /** Agent's asking terms. */
  askSalary: number
  askYears: number
  morale: number
  /** Set when negotiations concluded. */
  status: 'pending' | 'signed' | 'walked'
}

export interface FreeAgentRowView extends PlayerBadge {
  askSalary: number
  askYears: number
  /** Days until this player will take the best standing offer. */
  decidesInDays: number
}

export interface OffseasonView {
  year: number
  stage: 'awards' | 'draft' | 'resign' | 'freeAgency' | 'preseason'
  stageLabel: string
  /** Awards stage: champion + league award winners. */
  awards: Array<{ award: string; winner: PlayerBadge & { teamAbbr: string } } > | null
  championTeamName: string | null
  /** Re-sign stage: the user's expiring contracts. */
  expiring: ResignRowView[]
  /** Free-agency stage. */
  freeAgents: FreeAgentRowView[]
  capUsed: number
  salaryCap: number
}

export interface PayrollRowView extends PlayerBadge {
  salary: number
  yearsRemaining: number
  expiryYear: number
  noTradeClause: boolean
  twoWay: boolean
}

export interface FinanceView {
  salaryCap: number
  capUsed: number
  capSpace: number
  budget: number
  payroll: PayrollRowView[]
  /** Contracts expiring at season end. */
  expiring: PayrollRowView[]
  /** League average payroll for context. */
  leagueAvgPayroll: number
}

/* ────────────────────────── playoffs ────────────────────────── */

export interface SeriesView {
  seriesId: string
  round: number
  highSeed: { teamId: string; name: string; abbr: string; seed: number; wins: number }
  lowSeed: { teamId: string; name: string; abbr: string; seed: number; wins: number }
  /** "BOS leads 3-2", "Series tied 1-1", "NYR wins 4-1". */
  statusLabel: string
  finished: boolean
  involvesUser: boolean
  games: Array<{
    gameNumber: number
    homeAbbr: string
    awayAbbr: string
    homeGoals: number
    awayGoals: number
    overtime: boolean
  }>
}

export interface PlayoffBracketView {
  year: number
  bestOf: number
  rounds: Array<{ round: number; name: string; series: SeriesView[] }>
  championTeamName: string | null
  /** Null once the user's club is eliminated (or never qualified). */
  userAlive: boolean
  userQualified: boolean
}

/* ────────────────────────── match center / box score ────────────────────────── */

export interface BoxScoreSkaterRow extends PlayerBadge {
  goals: number
  assists: number
  shots: number
  penaltyMinutes: number
  toi: number
}

export interface BoxScoreGoalieRow extends PlayerBadge {
  saves: number
  shotsAgainst: number
  goalsAgainst: number
}

export interface GoalLogRow {
  period: number
  /** "12:34" elapsed in period. */
  clock: string
  teamAbbr: string
  scorer: string
  assists: string[]
  strength: 'ev' | 'pp' | 'sh' | 'en'
  homeScore: number
  awayScore: number
}

export interface PenaltyLogRow {
  period: number
  clock: string
  teamAbbr: string
  player: string
  infraction: string
  minutes: number
}

export interface BoxScoreView {
  homeAbbr: string
  awayAbbr: string
  homeName: string
  awayName: string
  homeGoals: number
  awayGoals: number
  decidedBy: GameResult['decidedBy']
  /** Goals per period, index 0 = P1; OT periods appended. */
  homeByPeriod: number[]
  awayByPeriod: number[]
  homeShots: number
  awayShots: number
  goals: GoalLogRow[]
  penalties: PenaltyLogRow[]
  homeSkaters: BoxScoreSkaterRow[]
  awaySkaters: BoxScoreSkaterRow[]
  homeGoalies: BoxScoreGoalieRow[]
  awayGoalies: BoxScoreGoalieRow[]
}

/* ────────────────────────── inbox ────────────────────────── */

export interface InboxView {
  items: NewsItem[]
  unread: number
}

/* ────────────────────────── snapshot (save format) ────────────────────────── */

/**
 * Career snapshot — the entire save game, version-enveloped. Built by
 * Career.exportSnapshot(), restored by Career.fromSnapshot(). MUST stay
 * JSON-serializable: Maps are flattened to entry arrays.
 */
export interface SerializedLeagueData {
  league: unknown
  /** [teamId, Team][] */
  teams: Array<[string, unknown]>
  /** [playerId, Player][] */
  players: Array<[string, unknown]>
}

export interface SeasonSummary {
  year: number
  championTeamId: string | null
  championTeamName: string | null
  /** User club's final regular-season rank. */
  userRank: number
  pointsLeader: { name: string; points: number } | null
}

export interface CareerSnapshot {
  version: 1
  savedAt: string
  saveName: string
  seed: number
  userTeamId: string
  phase: CareerPhase
  currentDay: number
  year: number
  leagueData: SerializedLeagueData
  standings: Array<[string, unknown]>
  playerTotals: Array<[string, unknown]>
  gamesPlayed: Array<[string, number]>
  news: NewsItem[]
  newsCounter: number
  playoffs: PlayoffsState | null
  offseason: import('@domain').OffseasonState | null
  picks: DraftPick[]
  history: SeasonSummary[]
  /**
   * Season counters not derivable from playerTotals (added after v1 froze;
   * optional so older saves load with empty counters).
   */
  extraStats?: {
    goalieWins: Array<[string, number]>
    goalieLosses: Array<[string, number]>
    ppGoals: Array<[string, number]>
    ppAssists: Array<[string, number]>
  }
  /**
   * Scouting fog-of-war state (added after v1 froze; optional so older saves
   * load and get createInitialScouting applied as a fallback).
   */
  scouting?: ScoutingState
  /**
   * Story-layer states (all added after v1 froze; every field is optional and
   * additive so older saves load with sensible re-initialized fallbacks).
   */
  arcs?: ArcsState
  records?: RecordsState
  expectations?: ExpectationsState
  /** [teamId, LockerRoomState][] — one per club. */
  lockerRooms?: Array<[string, LockerRoomState]>
  tentpoles?: TentpolesState
  /** Small story-layer counters not derivable from the states above. */
  storyMisc?: {
    /** [playerId, consecutive games with a point]. */
    pointStreaks: Array<[string, number]>
    /** [playerId, consecutive scoreless games] (forwards). */
    scorelessStreaks: Array<[string, number]>
    /** [teamId, current losing streak]. */
    losingStreaks: Array<[string, number]>
    lastDeadlineRecap: ExecutedTradeSummary[] | null
    lastLottery: {
      orderAbbrs: string[]
      movedUp: { teamAbbr: string; from: number; to: number } | null
    } | null
  }
  /**
   * Press corps state (added after v1 froze; optional for save compat).
   * Stores the rolling saga, pending job, press conference, and counters.
   */
  pressState?: {
    sagaSoFar: string
    pressCounter: number
    pressJob: import('@engine/story/factSheet').PressJob | null
    pressConference: import('@engine/story/factSheet').PressConferenceState | null
  }
  /**
   * Staff (head coach + AGM) for the user's team.
   * Optional for backward compat; older saves re-generate on load.
   */
  staff?: {
    headCoach: StaffMember
    assistantGM: StaffMember
  }
  /**
   * Per-player rolling game ratings (last up to 10 per player).
   * [playerId, number[]][] — JSON-safe entry array.
   */
  playerRatings?: Array<[string, number[]]>
  /**
   * Team practice state for the user's team.
   * Optional for backward compat; defaults to balanced on load.
   */
  practiceState?: TeamPracticeState
  /**
   * Hireable retired player pool — ids of retired players eligible for staff roles.
   * Optional for backward compat.
   */
  hireableStaff?: string[]
  /**
   * Owner/board expectations state (franchise drama). Optional for backward compat.
   */
  boardState?: BoardState
  /**
   * Rivalries state — pair-wise intensity. Optional for backward compat.
   */
  rivalriesState?: RivalriesState
  /**
   * Special-teams accumulator. JSON-safe entry array. Optional for backward compat.
   */
  specialTeams?: SpecialTeamsEntries
  /**
   * Transactions ledger. Optional for backward compat.
   */
  transactionLedger?: TransactionLedger
}

export interface SaveSlotInfo {
  slot: string
  saveName: string
  savedAt: string
  teamName: string
  year: number
  phase: CareerPhase
}

/* ────────────────────────── scouting view ────────────────────────── */

export interface ScoutCardView {
  scoutId: string
  name: string
  rating: number
  /** Human-readable label for current assignment. */
  assignmentLabel: string
  target: ScoutAssignment['target']
}

/** Per-team knowledge summary for the scouting overview panel. */
export interface TeamKnowledgeSummary {
  teamId: string
  teamName: string
  teamAbbr: string
  /** Mean knowledge across that team's roster, 0–100. */
  avgKnowledge: number
}

/**
 * Full scouting hub view — scout cards, assignment options, knowledge summaries.
 * Carried as the response to a 'getScouting' request.
 */
export interface ScoutingView {
  scouts: ScoutCardView[]
  /** All teams as assignment options. */
  teams: Array<{ teamId: string; teamName: string; teamAbbr: string }>
  /** All divisions as assignment options. */
  divisions: Array<{ divisionId: string; divisionName: string }>
  /** Whether draft-class assignment is currently meaningful (draft class exists). */
  hasDraftClass: boolean
  /** Per-team knowledge summary. */
  teamKnowledge: TeamKnowledgeSummary[]
  /** Recently improved players (highest delta-knowledge), for watch-list panel. */
  topGains: Array<PlayerBadge & { knowledge: number }>
}

/* ────────────────────────── story layer: history / locker room / tentpoles ────────────────────────── */

/**
 * League history hub — all-time record boards, archived seasons, award history
 * and retired legends / Hall of Fame. Response to 'getHistory'.
 */
export interface HistoryView {
  /** Top-10 single-season boards (value descending). */
  singleSeason: {
    goals: RecordEntry[]
    assists: RecordEntry[]
    points: RecordEntry[]
    wins: RecordEntry[]
    savePct: RecordEntry[]
  }
  /** Top-10 career boards. */
  career: {
    goals: RecordEntry[]
    assists: RecordEntry[]
    points: RecordEntry[]
    gamesPlayed: RecordEntry[]
  }
  /** One archive per completed season, oldest first. */
  seasons: SeasonArchive[]
  /** Every award handed out, newest season last. */
  awards: AwardRecord[]
  /** Retired greats; hallOfFame=true once inducted. */
  legends: LegendRecord[]
}

export interface RelationshipView {
  a: PlayerBadge
  b: PlayerBadge
  kind: 'friendship' | 'mentorship' | 'feud'
  /** 0–100. */
  strength: number
  /** Human label, e.g. "Close friends", "Mentoring", "Bad blood". */
  label: string
}

/** The user club's locker room. Response to 'getLockerRoom'. */
export interface LockerRoomView {
  /** Captain badge, null during a leadership vacancy. */
  captain: PlayerBadge | null
  alternates: PlayerBadge[]
  /** 0–100 room mood. */
  roomMorale: number
  /** Most influential players first (top 8). */
  influence: Array<PlayerBadge & { influence: number }>
  relationships: RelationshipView[]
  /** Mean familiarity (0–100) of each current EV unit. */
  lineFamiliarity: Array<{ label: string; players: string[]; familiarity: number }>
}

export interface TradeRumorView {
  playerId: string
  playerName: string
  teamId: string
  teamAbbr: string
  /** 0–100 rumor heat. */
  heat: number
  sinceDay: number
}

export interface CombineRowView {
  playerId: string
  name: string
  position: string
  /** Pre-combine scouting rank. */
  rank: number
  sprint: number
  agility: number
  strength: number
  interview: 'impressive' | 'solid' | 'concerning'
  riser: boolean
  faller: boolean
}

/** Season tentpole events: rumor mill, deadline recap, lottery, combine, worlds. */
export interface TentpoleView {
  rumors: TradeRumorView[]
  deadlineDay: number
  deadlinePassed: boolean
  /** AI-AI deadline-day trades (team abbreviations + asset names), once run. */
  lastDeadlineRecap: Array<{
    teamAAbbr: string
    teamBAbbr: string
    aGave: string[]
    bGave: string[]
  }> | null
  /** Draft lottery result, once drawn (offseason). */
  lottery: {
    /** First overall at index 0 (team abbreviations). */
    orderAbbrs: string[]
    movedUp: { teamAbbr: string; from: number; to: number } | null
  } | null
  /** Pre-draft combine results, once run. */
  combine: CombineRowView[] | null
  /** Post-season world tournament summary, once run. */
  tournament: {
    year: number
    teamA: string
    teamB: string
    medalResult: 'teamA' | 'teamB' | 'draw'
    /** User-club players selected. */
    userSelected: string[]
    /** User-club players snubbed. */
    userSnubbed: string[]
    returnEffects: Array<{ playerName: string; effect: 'inspired' | 'fatigued' | 'injured' }>
  } | null
}

/* ────────────────────────── AGM report view ────────────────────────── */

/** A player entry in the AGM depth chart with display colour tier. */
export interface AgmRankedPlayerView {
  playerId: string
  name: string
  position: string
  age: number
  judgedOverall: number
  judgedPotential: number
  tier: 'nhl' | 'reserve' | 'prospect'
  /** Colour band for the UI: 'elite' ≥82, 'good' ≥70, 'solid' ≥60, 'fringe' else. */
  colorTier: 'elite' | 'good' | 'solid' | 'fringe'
}

/**
 * The AGM Report — EHM Team > Report tab equivalent.
 * Response to 'getReport'.
 */
export interface AgmReportView {
  agmName: string
  agmRating: number
  agmJudgment: number
  agmSpecialty: string | undefined
  depthChart: {
    goalies: AgmRankedPlayerView[]
    defensemen: AgmRankedPlayerView[]
    leftWings: AgmRankedPlayerView[]
    centers: AgmRankedPlayerView[]
    rightWings: AgmRankedPlayerView[]
  }
  categoryBests: Array<{ category: string; playerId: string; playerName: string }>
  topProspects: AgmRankedPlayerView[]
}

/* ────────────────────────── practice view ────────────────────────── */

/**
 * Practice + scratches hub. Response to 'getPractice'.
 */
export interface PracticeView {
  state: TeamPracticeState
  /** AGM-style coaching suggestion for team focus. */
  suggestion: { teamFocus: PracticeFocus; rationale: string }
}

/* ────────────────────────── league leaders view ────────────────────────── */

export interface LeagueLeaderEntry {
  playerId: string
  name: string
  teamAbbr: string
  position: Position
  gamesPlayed: number
  /** The ranked stat value. */
  value: number
}

/**
 * Top-N league-wide leaderboards.
 * Response to 'getLeagueLeaders'.
 */
export interface LeagueLeadersView {
  points: LeagueLeaderEntry[]
  goals: LeagueLeaderEntry[]
  assists: LeagueLeaderEntry[]
  plusMinus: LeagueLeaderEntry[]
  savePct: LeagueLeaderEntry[]
  goalsAgainstAvg: LeagueLeaderEntry[]
  wins: LeagueLeaderEntry[]
}

/* ────────────────────────── board (owner expectations) view ────────────────────────── */

/**
 * Full owner/board view for the GM Status screen.
 * Response to 'getBoard'.
 */
export interface BoardView {
  mandate: string
  mandateText: string
  targetRank: number
  confidence: number
  confidenceLabel: string
  patience: number
  warnings: number
  firedAtYear: number | null
  statusLabel: string
  /** Current league rank of the user team. */
  currentRank: number
  /** True when the GM has been fired. */
  fired: boolean
}

/* ────────────────────────── rivalries view ────────────────────────── */

export interface RivalryView {
  teamAId: string
  teamAAbbr: string
  teamBId: string
  teamBAbbr: string
  /** 0–100 intensity. */
  intensity: number
  reasons: string[]
  meetings: number
  /** Human label at this intensity level. */
  label: string
}

/**
 * All current rivalries, sorted by intensity descending.
 * Response to 'getRivalries'.
 */
export interface RivalriesView {
  rivalries: RivalryView[]
}

/* ────────────────────────── league stats views ────────────────────────── */

/**
 * Team special-teams table — PP% / PK% — for the League hub.
 * Response to 'getLeagueStats'.
 */
export interface LeagueStatsView {
  specialTeams: (TeamSpecialTeams & { teamName: string; teamAbbr: string })[]
}

/**
 * Recent transactions (most recent first).
 * Response to 'getTransactions'.
 */
export interface TransactionsView {
  items: (Transaction & { teamNames: string[] })[]
}

/**
 * Daily scoreboard.
 * Response to 'getScoreboard'.
 */
export interface ScoreboardView {
  day: number
  entries: Array<{
    gameId: string
    homeAbbr: string
    awayAbbr: string
    homeGoals: number
    awayGoals: number
    final: boolean
  }>
}
