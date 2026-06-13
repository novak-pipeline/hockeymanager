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
export type { RadarAxes, RadarView } from '@engine/ratings/radar'
export { RADAR_AXES } from '@engine/ratings/radar'
export type { PersonalityTraitRead, PersonalityReadView, PersonalityConfidence } from '@engine/career/personalityRead'
export type { ScoutReportView, ReportCard, ReportGrade, ProjectionTier, SeasonProjection } from '@engine/career/scoutReport'
export type { ScoutPanel, ScoutRead, NhlComp, BoomBustRisk, RiskBand } from '@engine/career/multiScout'
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
import type { PlayerInteraction } from '@engine/league/interactions'
export type { PlayerInteraction, InteractionKind } from '@engine/league/interactions'
import type { AgendaItem } from '@engine/league/staffMeeting'
export type { AgendaItem, AgendaTopic, AgendaTopicOption, DiscussionResult } from '@engine/league/staffMeeting'
import type { ExecutedTradeSummary, TentpolesState } from '@engine/league/tentpoles'
import type { StaffMember, AgmReport } from '@engine/league/staff'
import type { TeamLeadersView } from '@engine/league/playerRating'
import type { TeamPracticeState, PracticeFocus } from '@engine/league/practice'
import type { BoardState, BoardSummaryView } from '@engine/league/board'
import type { RivalriesState } from '@engine/league/rivalries'
import type { SpecialTeamsEntries, TransactionLedger, TeamSpecialTeams, Transaction } from '@engine/league/leagueStats'
export type { BoardSummaryView } from '@engine/league/board'
export type { MindsetView, MindsetTone } from '@engine/career/playerMindset'
export type { Rivalry, RivalriesState } from '@engine/league/rivalries'
export type { TeamSpecialTeams, Transaction, TransactionKind } from '@engine/league/leagueStats'

/* ────────────────────────── league team browser (task #31) ────────────────────────── */

/** One row in the team-nav dropdown: covers both NHL and AHL tiers. */
export interface LeagueTeamRow {
  teamId: string
  name: string
  abbreviation: string
  tier: 'nhl' | 'ahl'
  /** Points for NHL sort (standings order). AHL teams sorted alphabetically after NHL. */
  points: number
  /** NHL parent for AHL rows; AHL affiliate for NHL rows. */
  affiliateId?: string
  /** Jersey colors as 0xRRGGBB ints — used by the UI to tint team screens. */
  colors?: { primary: number; secondary: number }
}

export interface LeagueTeamsView {
  /** NHL teams in standings order (best first). */
  nhl: LeagueTeamRow[]
  /** AHL affiliates in alphabetical order. */
  ahl: LeagueTeamRow[]
}

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
  /** Facepack image key. Populated from Player.faceId when the mod provides one. */
  faceId?: string
  /** Present when this player belongs to an AHL-tier team. */
  tier?: 'nhl' | 'ahl'
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

/** Bio fields surfaced on the player profile. All optional (absent on fictional players). */
export interface PlayerBioView {
  nationality?: string
  birthplace?: string
  jerseyNumber?: number
  heightCm?: number
  weightKg?: number
}

/** International & career honours for the profile Honours tab. */
export interface PlayerHonoursView {
  intlApps: number
  intlGoals: number
  intlAssists: number
  stanleyCups: number
  /** 0–200 reputation values (absent = 0 for fictional players). */
  homeReputation: number
  currentReputation: number
  worldReputation: number
  /** True if currently eligible for the NHL entry draft. */
  nhlDraftEligible: boolean
  /** True if already drafted. */
  nhlDrafted: boolean
  /** Preferred development pathway string (e.g. "QMJHL"). */
  juniorPreference?: string
}

/** Contract block on the profile, with RFA/UFA derivation. */
export interface ProfileContractView extends ContractView {
  /** Cap-hit equivalent; equals salary for standard contracts. */
  capHit: number
  /**
   * For two-way contracts: the cap hit applied when the player is buried in
   * the minors (minor-league salary). Absent for one-way contracts.
   */
  buriedCapHit?: number
  /** 'RFA' | 'UFA' | null if under contract with years remaining. */
  freeAgentStatus: 'RFA' | 'UFA' | null
}

export interface PlayerProfileView extends PlayerBadge {
  teamId: string | null
  teamName: string | null
  /** Team jersey colors as 0xRRGGBB ints — absent when player is a free agent. */
  teamColors?: { primary: number; secondary: number }
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

  /* ── Phase B additions (view-layer only, additive) ── */

  /** Six-axis radar model derived from composites. */
  radar: import('@engine/ratings/radar').RadarView
  /** Fog-aware personality and hidden-trait reads. */
  personalityReads: import('@engine/career/personalityRead').PersonalityReadView
  /** Bio fields (absent on fictional players). */
  bio: PlayerBioView
  /** Career honours block. */
  honours: PlayerHonoursView
  /** Extended contract block; null when player is a free agent. */
  profileContract: ProfileContractView | null
  /** Scout-generated prose report (fog-aware). */
  scoutReport: import('@engine/career/scoutReport').ScoutReportView
  /**
   * Multi-scout panel: per-scout reads, consensus, dissent, NHL comp, boom/bust risk.
   * Always present when PlayerProfileView is built.
   */
  scoutPanel: import('@engine/career/multiScout').ScoutPanel
  /**
   * Staff-gathered mindset: plain-English thoughts on this player's outlook.
   * Present for own players always; present for scouted opponents when knowledge ≥ 40.
   * Absent (omitted) when knowledge < 40 and isOwn = false.
   */
  mindset?: import('@engine/career/playerMindset').MindsetView
  /**
   * Headline personality archetype (e.g. "Born Leader"). Present for own players
   * always; for opponents only once personality knowledge is reliable (≥50).
   * Absent (omitted) otherwise.
   */
  personalityType?: { label: string; blurb: string }
  /**
   * FM-style Overall Report: recommendation + pros/cons + ability/potential
   * stars + best role. Present for own players / sufficiently scouted opponents.
   */
  scoutVerdict?: import('@engine/career/scoutVerdict').ScoutVerdict
  /**
   * Interview section: answered Q&A (deterministic from traits) + the questions
   * the GM hasn't asked yet. Present whenever the player can be interviewed.
   */
  interview?: InterviewView
  /**
   * How well the player fits his team's current tactical system. Skaters only
   * (absent for goalies and players without team tactics).
   */
  systemFit?: { score: number; label: string; reason: string; styleLabel: string }
}

/** A notable retiree recorded in a club's legends registry. */
export interface ClubLegend {
  playerId: string
  name: string
  faceId?: string
  position: string
  retiredYear: number
  /** Peak overall reached while a known player. */
  peakOverall: number
  /** One-line career summary. */
  blurb: string
  /** "Where are they now" — e.g. "Retired" or "Head Coach, <team>". */
  status: string
}

export interface TeamLegendsView {
  teamId: string
  teamName: string
  legends: ClubLegend[]
}

/** One answered interview question. */
export interface InterviewAnswerView {
  questionId: string
  prompt: string
  trait: string
  answer: string
  reveal: string
}

export interface InterviewView {
  answers: InterviewAnswerView[]
  available: { id: string; prompt: string }[]
}

/** Compare-radar response: both players' RadarViews plus key stats. */
export interface CompareRadarView {
  playerA: {
    playerId: string
    name: string
    position: Position
    overall: number
    radar: import('@engine/ratings/radar').RadarView
    skater: SkaterSeasonLine | null
    goalie: GoalieSeasonLine | null
  }
  playerB: {
    playerId: string
    name: string
    position: Position
    overall: number
    radar: import('@engine/ratings/radar').RadarView
    skater: SkaterSeasonLine | null
    goalie: GoalieSeasonLine | null
  }
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

/* ──── full league statistics table (sortable/filterable) ──── */

export interface LeagueSkaterStatRow {
  playerId: string
  name: string
  teamAbbr: string
  position: Position
  age: number
  rookie: boolean
  gp: number
  goals: number
  assists: number
  points: number
  plusMinus: number
  pim: number
  shots: number
  /** Shooting % (0–1). */
  shootingPct: number
  /** Average time on ice per game, seconds. */
  atoi: number
  ppGoals: number
  ppAssists: number
  ppPoints: number
  hits: number
  blocks: number
  takeaways: number
  giveaways: number
  /** Mean game rating (1–10), or null if never rated. */
  avgRating: number | null
}

export interface LeagueGoalieStatRow {
  playerId: string
  name: string
  teamAbbr: string
  age: number
  rookie: boolean
  gp: number
  wins: number
  losses: number
  savePct: number
  gaa: number
  shutouts: number
  saves: number
  shotsAgainst: number
  avgRating: number | null
}

/** Response to 'getLeagueStatTable' — every NHL player's season line. */
export interface LeagueStatTableView {
  skaters: LeagueSkaterStatRow[]
  goalies: LeagueGoalieStatRow[]
  /** The user club's abbreviation (for the "My club" filter). */
  userTeamAbbr: string
}

/* ────────────────────────── team player stats ────────────────────────── */

/** One row in the Team > Statistics tab — one rostered player's season line. */
export interface TeamPlayerStatRow {
  playerId: string
  name: string
  position: Position
  age: number
  /** Skater season line (null for goalies). */
  skater: SkaterSeasonLine | null
  /** Goalie season line (null for skaters). */
  goalie: GoalieSeasonLine | null
}

export interface TeamPlayerStatsView {
  teamName: string
  skaters: TeamPlayerStatRow[]
  goalies: TeamPlayerStatRow[]
}

/* ────────────────────────── trades ────────────────────────── */

export interface PickAssetView {
  /** Stable key, e.g. "2026-r1-t3". */
  id: string
  year: number
  round: number
  originalTeamAbbr: string
  label: string
  /** Perri-curve value on the 0–100 scale (rounded to 1 decimal). */
  value: number
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
  /** Roster cap space ($). Positive = room available. */
  capSpace: number
  /** Position groups the partner is thin on (below target depth). */
  needs: string[]
  /** Philosophy label shown in the UI. */
  philosophy: string
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
  /** User team's current cap space. */
  myCapSpace: number
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

/* ────────────────────────── AHL farm system views ────────────────────────── */

/**
 * AHL standings for the league-wide affiliate league.
 * Response to 'getAhlStandings'.
 */
export interface AhlStandingsView {
  /** Sorted best-first. */
  rows: StandingRowView[]
}

/**
 * AHL affiliate roster for the user's organisation.
 * Reuses SquadRowView; the teamName is the affiliate's name.
 * Response to 'getAhlSquad'.
 */
export interface AhlSquadView {
  /** AHL affiliate team name, e.g. "Springfield Falcons AHL". */
  teamName: string
  /** AHL team id. */
  teamId: string
  rows: SquadRowView[]
  rosterCount: number
  /** True when the user's NHL team has an AHL affiliate configured. */
  hasAffiliate: boolean
}

/* ────────────────────────── inbox ────────────────────────── */

/** One response choice the GM can pick for a player concern. */
export interface InteractionOptionView {
  id: string
  label: string
}

/** An open player→GM concern surfaced in the inbox for a response. */
export interface PlayerInteractionView {
  id: string
  playerId: string
  playerName: string
  faceId?: string
  kind: string
  severity: 'mild' | 'serious'
  message: string
  day: number
  year: number
  options: InteractionOptionView[]
}

export interface InboxView {
  items: NewsItem[]
  unread: number
  /**
   * Open player→GM concerns awaiting a response. Optional/additive for save
   * compat (absent = no interactions surfaced).
   */
  interactions?: PlayerInteractionView[]
  /**
   * Minimal player info keyed by playerId for items that reference a player.
   * Enables the inbox to show PlayerFace thumbnails and link to profiles.
   * Optional for backward compat (absent = no thumbnails).
   */
  playerInfo?: Record<string, { name: string; faceId?: string }>
  /**
   * Minimal team info keyed by teamId for items that reference a team.
   * Optional for backward compat.
   */
  teamInfo?: Record<string, { abbreviation: string; primaryColor: number }>
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
  /** Player→GM concerns (open + recently resolved). Optional/additive. */
  interactions?: PlayerInteraction[]
  interactionCounter?: number
  /** [playerId, askedQuestionIds][] — interview questions asked. Optional/additive. */
  interviews?: Array<[string, string[]]>
  /** [teamId, ClubLegend[]][] — per-club legends registry. Optional/additive. */
  legends?: Array<[string, ClubLegend[]]>
  /** Staff-meeting agenda items. Optional/additive. */
  agenda?: AgendaItem[]
  agendaCounter?: number
  tentpoles?: TentpolesState
  /** Small story-layer counters not derivable from the states above. */
  storyMisc?: {
    /** [playerId, consecutive games with a point]. */
    pointStreaks: Array<[string, number]>
    /** [playerId, consecutive scoreless games] (forwards). */
    scorelessStreaks: Array<[string, number]>
    /** [teamId, current losing streak]. */
    losingStreaks: Array<[string, number]>
    /** User team current consecutive wins (for coach win-streak quotes). Optional; older saves default to 0. */
    userWinStreak?: number
    lastDeadlineRecap: ExecutedTradeSummary[] | null
    lastLottery: {
      orderAbbrs: string[]
      movedUp: { teamAbbr: string; from: number; to: number } | null
    } | null
    /** Persisted press schedule state (Task #39); optional for older saves. */
    pressSchedule?: import('@engine/story/pressSchedule').PressScheduleState
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
   * Per-team full staff complements — [teamId, TeamStaff][] entry array.
   * Optional for backward compat; older saves regenerate on load.
   * Includes every NHL-tier team; AHL teams share/skip.
   */
  teamStaff?: Array<[string, import('@engine/league/staff').TeamStaff]>
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
  /**
   * AHL standings — [teamId, Standing][] entry array. Optional for backward compat
   * (old saves re-initialize from league.ahlTeams on load).
   */
  ahlStandings?: Array<[string, unknown]>
  /**
   * AHL player games-played counters — [playerId, number][] entry array.
   * Optional for backward compat.
   */
  ahlGp?: Array<[string, number]>
  /** AHL season totals, kept separate from NHL playerTotals. Optional. */
  ahlTotals?: Array<[string, unknown]>
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

export type { TeamDynamicsView, DynamicsPlayerView, DynamicsBar } from '@engine/career/dynamics'

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

/* ────────────────────────── staff / personnel view ────────────────────────── */

/** One row in the Personnel screen — a single staff member. */
export interface StaffRowView {
  id: string
  name: string
  /** Human-readable role label, e.g. "Head Coach", "Assistant Coach". */
  roleLabel: string
  /** 40–90 quality rating. */
  rating: number
  /** 0–100 scouting/evaluation accuracy. */
  judgment: number
  /** Optional specialty, e.g. "Power Play", "Prospects". */
  specialty?: string
  /** Demeanor tag for the UI, e.g. "Analytical", "Fiery". */
  demeanorLabel?: string
  /** Facepack image key (faces/<faceId>.png). Absent when no facepack. */
  faceId?: string
}

/**
 * Full staff complement for one team, grouped by role.
 * Response to 'getTeamStaff'.
 */
export interface StaffView {
  teamName: string
  headCoach: StaffRowView
  assistantCoaches: StaffRowView[]
  assistantGM: StaffRowView
  scouts: StaffRowView[]
  physios: StaffRowView[]
  owner: StaffRowView
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
  /** Where the player currently plays (prospect rows), e.g. "NHL" / "AHL". */
  location?: string
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

/* ────────────────────────── calendar view ────────────────────────── */

/**
 * A single entry on the calendar grid.
 * - 'game': user-club fixture (scheduled or played).
 * - 'keydate': notable season milestone (deadline, playoffs start, draft, etc.).
 */
export type CalendarEntry =
  | {
      kind: 'game'
      dateISO: string
      day: number
      gameId: string
      opponentAbbr: string
      opponentName: string
      /** True = home, false = away. */
      home: boolean
      /** Null when game not yet played. */
      result: {
        homeGoals: number
        awayGoals: number
        won: boolean
        decidedBy: GameResult['decidedBy']
      } | null
      /** True when this is the user's next unplayed fixture. */
      isNext: boolean
    }
  | {
      kind: 'keydate'
      dateISO: string
      /** Human-readable label, e.g. 'Trade Deadline', 'Playoffs Begin'. */
      label: string
    }

/**
 * Season laid out for calendar rendering.
 * Response to 'getCalendar'.
 */
export interface CalendarView {
  year: number
  entries: CalendarEntry[]
}

/* ────────────────────────── data hub (xG analytics) ────────────────────────── */

/**
 * Per-team analytics row for the Data Hub.
 * All rates are per-60 minutes of ice time (TOI-adjusted) unless noted.
 * Percentile fields are 0–100, where 100 = best in league.
 */
export interface TeamAnalyticsRow {
  teamId: string
  teamName: string
  teamAbbr: string
  gamesPlayed: number
  /** Goals for per 60 minutes (GF/60). */
  gfPer60: number
  /** Goals against per 60 minutes (GA/60). */
  gaPer60: number
  /** Expected goals for per 60 minutes (xGF/60). */
  xgfPer60: number
  /** Expected goals against per 60 minutes (xGA/60). */
  xgaPer60: number
  /** Shots on goal for per 60 minutes. */
  shotsPer60: number
  /** Shots on goal against per 60 minutes. */
  shotsAgainstPer60: number
  /** Power-play percentage (0–1). */
  ppPct: number
  /** Penalty-kill percentage (0–1). */
  pkPct: number
  /** GF/60 league percentile (100 = highest GF/60 in the NHL tier). */
  gfPctile: number
  /** GA/60 league percentile (100 = lowest GA/60 — best defence). */
  gaPctile: number
  /** xGF/60 percentile. */
  xgfPctile: number
  /** xGA/60 percentile (100 = lowest xGA/60). */
  xgaPctile: number
  /** Shot volume percentile. */
  shotsPctile: number
  /** Shot suppression percentile (100 = fewest shots allowed). */
  shotsAgainstPctile: number
  /** PP% percentile. */
  ppPctile: number
  /** PK% percentile. */
  pkPctile: number
}

/**
 * Per-player analytics row (skaters only) for the Data Hub leaders tables.
 */
export interface PlayerAnalyticsRow {
  playerId: string
  name: string
  teamAbbr: string
  position: Position
  gamesPlayed: number
  /** xG generated as shooter per 60 minutes. */
  xgPer60: number
  /** xA generated as primary assister per 60 minutes. */
  xAPer60: number
  /** Actual goals per 60 minutes. */
  goalsPer60: number
  /** Shooting % (goals / shots on goal). */
  shootingPct: number
  /** Finishing: goals – xG (positive = over-performing). */
  finishing: number
}

/**
 * Data Hub view — SciSports/StatsCentre-style analytics for the user team
 * plus league-wide context.
 *
 * Response to 'getDataHub'. NHL-tier only (AHL excluded).
 */
export interface DataHubView {
  /** Analytics row for the user's team (NHL tier). */
  userTeam: TeamAnalyticsRow
  /** All NHL-tier teams sorted by xGF/60 descending. */
  allTeams: TeamAnalyticsRow[]
  /**
   * Top-20 skaters by xG/60 (minimum 5 GP filter to exclude cameo appearances).
   * Sorted xG/60 descending.
   */
  xgLeaders: PlayerAnalyticsRow[]
  /**
   * Top-20 skaters by finishing (goals – xG), sorted descending.
   * Identifies over/under-performers vs their shot quality.
   */
  finishingLeaders: PlayerAnalyticsRow[]
}

/**
 * Extended player analytics row including special-teams and plus/minus.
 * Used by the Team Data Hub category views.
 */
export interface TeamPlayerAnalyticsRow extends PlayerAnalyticsRow {
  /** Plus/minus (raw count, not per-60). */
  plusMinus: number
  /** Power-play goals. */
  ppGoals: number
  /** Power-play assists. */
  ppAssists: number
  /** Power-play points (ppGoals + ppAssists). */
  ppPoints: number
  /** Blocked shots. */
  blockedShots: number
  /** Takeaways. */
  takeaways: number
}

/**
 * Goalie analytics row for the team Data Hub.
 */
export interface GoalieAnalyticsRow {
  playerId: string
  name: string
  teamAbbr: string
  gamesPlayed: number
  wins: number
  losses: number
  /** Save percentage (0–1). */
  savePct: number
  /** Goals-against average (per 60 min). */
  gaa: number
  /** Total saves. */
  saves: number
  /** Shots against. */
  shotsAgainst: number
}

/**
 * Team Data Hub — deep-dive analytics for one club with category breakdown.
 *
 * Response to 'getTeamDataHub'. Covers Offense/Defence/PP/PK/Goaltending.
 */
export interface TeamDataHubView {
  /** The team being profiled. */
  team: TeamAnalyticsRow
  /** Special-teams raw data for this team. */
  specialTeams: {
    ppGoals: number
    ppOpportunities: number
    ppPct: number
    pkKills: number
    timesShorthanded: number
    pkPct: number
    /** League rank for PP% (1 = best). */
    ppRank: number
    /** League rank for PK% (1 = best). */
    pkRank: number
  }
  /** All players on this team with extended stats (skaters only, min 1 GP). */
  players: TeamPlayerAnalyticsRow[]
  /** Goalie rows for this team (min 1 GP). */
  goalies: GoalieAnalyticsRow[]
  /**
   * All NHL-tier team rows (with percentiles) for league-rank context.
   * Same as DataHubView.allTeams but included here so the UI can show
   * rank columns without a second request.
   */
  allTeams: TeamAnalyticsRow[]
  /** All goalies across the league (for goalie rank context). */
  allGoalies: GoalieAnalyticsRow[]
}
