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
  Lines,
  NewsItem,
  PlayoffsState,
  Position,
  TeamTactics,
} from '@domain'
export type { RadarAxes, RadarView } from '@engine/ratings/radar'
export { RADAR_AXES } from '@engine/ratings/radar'
export type { PersonalityTraitRead, PersonalityReadView, PersonalityConfidence } from '@engine/career/personalityRead'
export type { ScoutReportView, ReportCard, ReportGrade, ProjectionTier, SeasonProjection } from '@engine/career/scoutReport'
export type { PlayerTrait, TraitCategory, TraitRarity } from '@engine/career/playerTraits'
export type { ScoutPanel, ScoutRead, NhlComp, BoomBustRisk, RiskBand } from '@engine/career/multiScout'
export type { RosterProjection, CoachReport } from '@engine/career/playerProjection'
export type { OpinionSnapshot } from '@engine/career/opinionTracker'
import type { ScoutAssignment, ScoutingState } from '@domain/scouting'
export type { ScoutTarget } from '@domain/scouting'
export type { StaffMember, AgmReport, AgmRankedPlayer } from '@engine/league/staff'
import type { ValueDriver } from '@engine/league/trades'
export type { ValueDriver } from '@engine/league/trades'
export type { TeamLeadersView, LeaderChip, TeamLeadersEntry } from '@engine/league/playerRating'
export type { TeamPracticeState, PracticeFocus } from '@engine/league/practice'
import type { ArcsState } from '@engine/story/arcs'
import type { ChronicleState } from '@engine/story/chronicle'
import type { GmPersona } from '@engine/league/gmPersona'
import type { SeasonReviewFacts, MeetingSpeaker } from '@engine/career/boardMeeting'
import type {
  AwardRecord,
  LegendRecord,
  RecordEntry,
  RecordsState,
  SeasonArchive,
} from '@engine/story/records'
import type { ExpectationsState } from '@engine/story/expectations'
import type { LockerRoomState } from '@engine/league/lockerRoom'
import type { PlayerInteraction, PlayerPromise } from '@engine/league/interactions'
export type { PlayerInteraction, InteractionKind, PlayerPromise } from '@engine/league/interactions'
import type { FeedAuthor, StoryPriors } from '@engine/story/salience'
export type { FeedAuthor, FeedChannel, StoryPriors, PostFacts } from '@engine/story/salience'
import type { NegotiationState } from '@engine/league/negotiation'
import type { AgentRapportState } from '@engine/league/agentRapport'
export type { AgentRapportState } from '@engine/league/agentRapport'
export type {
  AgentPersona,
  ClauseLevel,
  Comparable,
  ContractOffer,
  NegotiationKind,
  NegotiationState,
  NegotiationStatus,
  RoundVerdict,
} from '@engine/league/negotiation'

/* ────────────────────────── camps (Season Rhythm M3) ────────────────────────── */

/** One cut-day roster call staged out of training camp. JSON-safe, persisted. */
/** One skater's accumulated line across the camp scrimmages. */
export interface CampSkaterLine {
  playerId: string
  name: string
  position: string
  faceId?: string
  team: 'Blue' | 'Red'
  gp: number
  g: number
  a: number
  p: number
  plusMinus: number
  pim: number
  sog: number
  /** Coach's average rating out of 10 (EHM "Av R"). */
  rating: number
}

/** One goalie's accumulated line across the camp scrimmages. */
export interface CampGoalieLine {
  playerId: string
  name: string
  faceId?: string
  team: 'Blue' | 'Red'
  gp: number
  mins: number
  ga: number
  saves: number
  gaa: number
  svPct: number
  rating: number
}

/** The coach's end-of-camp verdict on a camp player (EHM "files his report"). */
export interface CampReport {
  playerId: string
  name: string
  position: string
  faceId?: string
  /** sign = PTO worth a contract · keep = makes the roster · develop = farm ·
   *  watch = fringe/uncertain. Drives the tone. */
  recommendation: 'sign' | 'keep' | 'develop' | 'watch'
  /** Whether he was a try-out (PTO) invitee rather than a signed body. */
  tryout: boolean
  verdict: string
}

export interface TrainingCampState {
  decisions: Array<{
    playerId: string
    name: string
    position: string
    age: number
    faceId?: string
    /** Where he is right now. */
    current: 'nhl' | 'ahl'
    /** Where the coach wants him. */
    coachPlan: 'nhl' | 'ahl'
    /** Sending him down runs REAL waivers — he can be claimed for nothing. */
    waiverRequired: boolean
    /** The coach's one-line verdict. */
    line: string
    /** PTO invitee: unsigned, on a tryout. 'nhl' = sign him to a deal, 'ahl' =
     *  release him back to the market (there's no farm assignment for a tryout). */
    tryout?: boolean
  }>
  resolved: boolean
  /* ── Training Camp v2 (EHM-style), all additive/optional ── */
  /** Which day of the camp week we're on (1..8); 8 = final cuts. */
  campDay?: number
  /** Camp window, e.g. "Sep 12 – Sep 20". */
  startISO?: string
  endISO?: string
  /** The camp roster split into intra-squad teams (Overview tab). */
  roster?: Array<{
    playerId: string
    name: string
    position: string
    age: number
    faceId?: string
    team: 'Blue' | 'Red'
    /** "On Roster" | "Try-out" | "AHL invite". */
    status: string
  }>
  /** Day-by-day beats (Camp Schedule tab). */
  schedule?: Array<{ label: string; activity: string; info?: string }>
  /** Accumulated scrimmage box score (Scrimmage Stats tab). */
  scrimmage?: {
    skaters: CampSkaterLine[]
    goalies: CampGoalieLine[]
    /** "Team Blue 6, Team Red 2" per scrimmage played. */
    results: string[]
  }
  /** The coach's end-of-camp reports on notable camp players. */
  reports?: CampReport[]
}

export interface TrainingCampView {
  decisions: TrainingCampState['decisions']
  cast: Array<{ name: string; title: string; faceId?: string }>
  /** Which day of the camp week we're on (1..8); 8 = final cuts. */
  campDay?: number
  startISO?: string
  endISO?: string
  roster?: TrainingCampState['roster']
  schedule?: TrainingCampState['schedule']
  scrimmage?: TrainingCampState['scrimmage']
  reports?: CampReport[]
}

/** Dev camp is a WEEK, not a click: arrival -> scrimmage -> wrap. Persisted. */
export interface DevCampState {
  /** 1 = arrival, 2 = scrimmage day (lines exist), 3 = wrap (decision). */
  day: number
  /** [playerId, scrimmage line] accumulated on day 2. */
  lines: Array<[string, { g: number; a: number; sog: number; squad: 'white' | 'blue' }]>
  /** "White 4, Blue 3" once the scrimmage has been played. */
  scoreline?: string
}

/** The July development camp — the org's kids on the rink, live. */
export interface DevCampView {
  /** Which beat of the week we're on (1 arrival / 2 scrimmage / 3 wrap). */
  day: number
  scoreline?: string
  invitees: Array<{
    playerId: string
    name: string
    age: number
    position: string
    faceId?: string
    /** Drafted by you this summer. */
    drafted: boolean
    grade: 'A' | 'B' | 'C'
    read: string
    /** Scrimmage line, present from day 2. */
    line?: { g: number; a: number; sog: number; squad: 'white' | 'blue' }
  }>
  cast: Array<{ name: string; title: string; faceId?: string }>
  /** The COACHES' pick for camp standout (wrap day) — not the GM's. Additive. */
  coachStandout?: { playerId: string; name: string; reason: string }
}

/** #182: a prospect on the dev-camp invite editor. */
export interface DevCampInviteRow extends PlayerBadge {
  potential: number
  /** Already in the organisation (vs an external tryout invite). */
  org: boolean
}

/** #182: the dev-camp invite editor — who's coming, and who else you could bring. */
export interface DevCampInvitesView {
  /** True once camp is underway — invites are locked. */
  locked: boolean
  invited: DevCampInviteRow[]
  available: DevCampInviteRow[]
}

/** #182: one PTO (pro-tryout) candidate for training camp — an unsigned vet. */
export interface CampInviteRow extends PlayerBadge {
  /** Rated overall (0–100). */
  overall: number
}

/** #182: the training-camp PTO invite editor. Unsigned veterans the GM may bring
 *  to main camp on a tryout to fight for a contract. */
export interface CampInvitesView {
  /** True once camp has been built — the tryout list is locked. */
  locked: boolean
  invited: CampInviteRow[]
  available: CampInviteRow[]
}

/** The social feed (docs/THE-FEED.md): posts newest-first + author directory. */
export interface FeedView {
  posts: NewsItem[]
  authors: Record<string, FeedAuthor>
  /** Author ids the GM follows (Phase B curation). Optional/additive. */
  following?: string[]
}
import type { AgendaItem } from '@engine/league/staffMeeting'
export type { AgendaItem, AgendaTopic, AgendaTopicOption, DiscussionResult } from '@engine/league/staffMeeting'
import type { ExecutedTradeSummary, TentpolesState } from '@engine/league/tentpoles'
import type { StaffMember } from '@engine/league/staff'
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
  /**
   * Shooting/catching hand. Public info (never fogged) — powers the tactics
   * board's off-hand placement warning. Optional/additive for save compat.
   */
  handedness?: 'L' | 'R'
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
  /** #175: shorthanded goals/assists (the PK's scoring side). Optional/additive —
   *  absent on imported pre-career seasons and old saves; treated as 0. */
  shGoals?: number
  shAssists?: number
  /** #175: average power-play / penalty-kill time on ice per game (seconds).
   *  Optional/additive; absent on imported seasons and old saves. */
  ppToiPerGame?: number
  pkToiPerGame?: number
  /** Season average match rating (Avr). Absent for imported pre-career seasons. */
  avgRating?: number
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
  /** Season average match rating (Avr). Absent for imported pre-career seasons. */
  avgRating?: number
}

/** ISO date string for a given season year + match day (Oct 1 + (day-1) days),
 *  so a realistic ~184 match-day season spans Oct → early April. */
export function dayToDateISO(year: number, day: number): string {
  const d = new Date(Date.UTC(year, 9, 1))
  d.setUTCDate(d.getUTCDate() + Math.max(0, day - 1))
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
  /** Opponent record, e.g. "24-12-4". */
  opponentRecord: string
  /** Opponent head coach's named system, e.g. "Heavy Forecheck". */
  opponentSystem: string
  /** Non-null when this is a rivalry game (intensity >= 60). */
  rivalryLabel: string | null
  /** All-time series line vs this opponent from the World Chronicle
   *  ("You lead all-time 12–5 · playoff series 1–1"). Optional/additive. */
  allTime?: string | null
  /** Pre-game storyline (revenge game etc.) from the chronicle. Optional/additive. */
  storyline?: string | null
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
  /** True on draft day: the offseason is parked on an unfinished entry draft.
   *  The UI must route the GM into the Draft screen — Continue can't sim past it. */
  draftPending?: boolean
  /** True in the preseason until the GM names a captain — the season can't open
   *  first. The UI routes to the Leadership screen; a hard gate like the draft. */
  captainsPending?: boolean
  /** True when the preseason board meeting awaits (Season Rhythm M1). Simming
   *  past it sends the AGM in your place — a soft gate, not a hard one. */
  boardMeetingPending?: boolean
  /** A convened bi-weekly staff meeting is waiting (blocking gate). Optional/additive. */
  staffMeetingDue?: boolean
  /** A convened recurring scout meeting is waiting (blocking gate). Optional/additive. */
  scoutMeetingDue?: boolean
  /** Playtest #10: the weekly scout digest holds the day until the GM triages
   *  its prospect cards (or delegates to the scouts). Soft gate. Optional/additive. */
  scoutDigestPending?: boolean
  /** Inbox id of the gating digest, for deep-linking Continue → inbox. */
  scoutDigestNewsId?: string
  /** Offseason: human stage label for headers ('Free agency — day 3'). Optional/additive. */
  offseasonStageLabel?: string
  /** M3: development camp is on the calendar — Continue walks you in. Optional/additive. */
  devCampPending?: boolean
  /** M3: cut day — training camp decisions await before opening night. Optional/additive. */
  campPending?: boolean
  /** True when the End-of-Season Review is staged (Season Rhythm M4). */
  reviewPending?: boolean
  /** True while the sim is held on deadline day (last chance to trade). */
  deadlinePending?: boolean
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
  /** Players currently claimable on the in-season waiver wire (badge for a nudge). */
  waiverClaimsAvailable?: number
  /** True when the owner has a pending directive awaiting the GM's response. */
  ownerRequestPending?: boolean
}

/* ────────────────────────── squad / player ────────────────────────── */

export interface SquadRowView extends PlayerBadge {
  role: string
  handedness: 'L' | 'R'
  /** Positions the player can fill, natural first, e.g. "C, LW, RW" or "LD, RD". */
  positions: string
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
  /** True if sending him to the AHL means clearing waivers (claimable for
   *  nothing) — the training-camp trap, surfaced EHM-style. Optional/additive. */
  waiverRequired?: boolean
  /** EHM-style form string from last 5 game ratings, e.g. "BABCA" newest-first. */
  gameRatingForm: string
  /** Season average game rating (0 = no games played). */
  avgRating: number
  /** #188: the GM's declared squad status (key player, core, prospect, …), when set. */
  squadStatus?: import('@domain/player').SquadStatus
  /** #188: the GM's trade posture, when set (untouchable / available / listed). */
  tradeStatus?: import('@domain/player').TradeStatus
}

export interface SquadView {
  teamName: string
  rows: SquadRowView[]
  /** Total roster size / currently dressed players. */
  rosterCount: number
  dressedCount: number
  /** Summed roster salary and the club's cap ceiling (for the header cap chip). */
  capUsed: number
  salaryCap: number
}

/** #189: one roster player as a captaincy candidate + jersey number. */
export interface LeadershipRowView {
  playerId: string
  name: string
  faceId?: string
  position: string
  age: number
  /** Current letter worn: 'C', 'A', or null. */
  letter: 'C' | 'A' | null
  /** Leadership rating on a 0–99 display scale (DB rating or a personality proxy). */
  leadership: number
  /** Room influence 0–100 (from the locker-room model). */
  influence: number
  /** Eligible to wear the C (standing gate — age/leadership). */
  captainEligible: boolean
  /** Current jersey number, if assigned. */
  jerseyNumber?: number
}

/** #188/roles-tab: one org player as a role-assignment row. */
export interface RoleBoardRow extends PlayerBadge {
  /** True when he's on the NHL roster (vs the AHL affiliate). */
  onNhl: boolean
  /** The GM's currently-set squad status, if any. */
  squadStatus?: import('@domain/player').SquadStatus
  /** The engine's recommended status from his ability/age/depth — what
   *  "Auto-assign" would apply. */
  suggested: import('@domain/player').SquadStatus
}

/** #188/roles-tab: bulk squad-role board for the user's whole organisation, so
 *  roles can be set without right-clicking each player. */
export interface RoleBoardView {
  rows: RoleBoardRow[]
  /** Display labels for each squad status (for the dropdowns/legend). */
  labels: Record<import('@domain/player').SquadStatus, string>
  /** How many org players still have no role set. */
  unassigned: number
}

/** #189: captains + jersey-number management for the user's club. */
export interface LeadershipView {
  teamName: string
  captainId: string | null
  alternateIds: string[]
  /** Max alternates allowed given the current captain state (2 with a C, else 3). */
  maxAlternates: number
  /** Retired numbers at this club (unavailable for assignment). */
  retiredNumbers: number[]
  rows: LeadershipRowView[]
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
  /** Entry-draft record from the source DB (absent = undrafted/unknown). */
  draftYear?: number
  draftRound?: number
  draftOverall?: number
  draftClub?: string
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
  /** Rights status he'll carry at contract's end: ELC/RFA (club retains rights) or
   *  UFA (free to leave). Present whenever he's on a club. */
  rightsStatus?: 'ELC' | 'RFA' | 'UFA'
  /** True when the player skates in a non-pro loop (junior/college/Europe) and so
   *  carries no NHL contract — the salary/term fields are not a pro deal. */
  amateur?: boolean
}

/** EHM-style position proficiency for one position. */
export interface PositionProficiencyView {
  pos: string
  level: 'Natural' | 'Accomplished' | 'Competent' | 'Unproved'
}

export interface PlayerProfileView extends PlayerBadge {
  teamId: string | null
  teamName: string | null
  /** Positions the player can play, with proficiency (natural first). */
  positions: PositionProficiencyView[]
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
    /** Current team id when the club resolves to a team in the world (NHL,
     *  affiliate, or any competition) — makes the row clickable. Absent for
     *  defunct/unmatched historical clubs. */
    teamId?: string
    /** Present on farm (AHL) season lines so the table can tag them. Absent = NHL. */
    league?: 'ahl'
    skater: SkaterSeasonLine | null
    goalie: GoalieSeasonLine | null
  }>

  /** Career honours — pre-career honours imported from the source DB (no year)
   *  plus trophies won during this career (with a year). Shown as trophy badges
   *  on the History tab. Absent when none. */
  awards?: Array<{ award: string; year?: number }>

  /** Round-number career milestones reached (e.g. "500 goals", "1,000 games",
   *  "50 shutouts") — the highest tier passed per category. FM-style career
   *  highlights. Absent when he hasn't reached a notable one. */
  careerAchievements?: string[]

  /** This season's average match rating (EHM "Avr", 0–10). Absent before he's
   *  played a game this season. */
  avgRating?: number

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
   * NHL analyst/pundit draft projection — the consensus board read on a
   * draft-relevant prospect (rank + projected ceiling role). Present only for
   * draft-eligible / on-the-radar young players; omitted for everyone else.
   */
  analystProjection?: string
  /** Analyst FULL-ordering draft rank (1-based, past the published board too).
   *  Present only for draft-eligible / re-entry prospects. */
  analystRank?: number
  /** Compact draft-standing label, e.g. "R1 · #11" or "R3 · #96" / "Undrafted proj.".
   *  Present only for draft-eligible / re-entry prospects. */
  analystDraftLabel?: string
  /**
   * The NHL draft analysts' PERCEIVED potential (1–5 stars) — the hype-inflated
   * consensus ceiling that drives the public draft board, kept separate from
   * `potentialStars` (your own scouts' grounded read). Lets the profile show
   * both reads side by side. Present only for draft-relevant prospects.
   */
  analystPotentialStars?: number
  /**
   * Your scouts' projected ceiling ROLE in plain hockey terms (e.g. "Top-pair D",
   * "Middle-six F", "Starter") from their grounded read — replaces the vague
   * "Prospect" projection label. Always present.
   */
  scoutsCeilingRole?: string
  /**
   * Your scouts' OWN draft read — can differ from the analyst consensus. Present
   * for draft-relevant prospects once your staff has seen enough of him.
   */
  scoutDraftRead?: { verdict: 'higher' | 'inline' | 'lower'; confidence: 'low' | 'medium' | 'high'; blurb: string }
  /**
   * "Shades of …" player comparison — closest established comparable in the DB
   * plus an auto-generated differentiator. Omitted at low knowledge or when no
   * suitable comparable exists.
   */
  scoutComp?: { names: string[]; ids: string[]; differentiator: string; summary: string }
  /**
   * Season bio write-up — narrative recap of what the player did this season.
   * Omitted before he has played a game.
   */
  seasonBio?: string
  /**
   * Living scouting report — the synthesized, always-present write-up that deepens
   * and shifts its verdict as our scouts' collective read sharpens. Replaces the
   * thin one-liner prose.
   */
  scoutSummary?: { paragraphs: string[]; confidence: 'low' | 'medium' | 'high' }
  /**
   * Composite prospect grade — weighs talent, our team's need + system fit,
   * position scarcity, risk and value into one letter (A+…F) with the pros/cons
   * the scouts weighed. Present for draft-relevant / scouted prospects.
   */
  prospectGrade?: {
    grade: 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D' | 'F'
    score: number
    pros: string[]
    cons: string[]
  }
  /**
   * Formal end-of-season pre-draft edition of the report — present only for
   * draft-eligible prospects once the class is set (final ranking / offseason).
   */
  preDraftSummary?: { paragraphs: string[]; confidence: 'low' | 'medium' | 'high' }
  /**
   * Multi-scout panel: per-scout reads, consensus, dissent, NHL comp, boom/bust risk.
   * Only the scouts who have actually watched this player are included; omitted
   * entirely when no scout has seen an opponent (nothing to report).
   */
  scoutPanel?: import('@engine/career/multiScout').ScoutPanel
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
   * #73: EHM-style deployment read — how the coach should USE this skater
   * (role-suitability stars per bucket + a usage note), distinct from his innate
   * archetype. Present for own players / reliably scouted skaters; absent for
   * goalies and low-knowledge opponents.
   */
  deployment?: import('@engine/league/deployment').DeploymentProfile
  /**
   * Interview section: answered Q&A (deterministic from traits) + the questions
   * the GM hasn't asked yet. Present whenever the player can be interviewed.
   */
  interview?: InterviewView
  /** ISO date a sit-down interview is scheduled for (pending resolution). */
  interviewScheduled?: string
  /**
   * How well the player fits his team's current tactical system. Skaters only
   * (absent for goalies and players without team tactics).
   */
  systemFit?: { score: number; label: string; reason: string; styleLabel: string }
  /**
   * EHM-style roster projection: where he slots on his NHL club now (Suggested
   * status) + his ceiling in roster terms (Projected status). Present for own
   * players / sufficiently scouted players whose club is known.
   */
  rosterProjection?: import('@engine/career/playerProjection').RosterProjection
  /**
   * How the read on this player has moved over time (rating/stars/knowledge
   * snapshots). Present when any history has accrued.
   */
  opinionTimeline?: import('@engine/career/opinionTracker').OpinionSnapshot[]
  /** FM-style trend of current ability after the last development pass. */
  overallTrend: 'up' | 'down' | 'steady'
  /** Trend of his projected ceiling (boom/bust drift). */
  potentialTrend: 'up' | 'down' | 'steady'
  /** Optimism band on the ceiling in stars [lo, hi] — wide for unproven youth,
   *  narrowing to a point as he ages/proves out. */
  potentialBand: { lo: number; hi: number }
  /**
   * #188: true when this player is on the user's own NHL club/org — gates the
   * GM-only role/trade-status controls on the profile.
   */
  isOwn: boolean
  /**
   * #188: the GM's declared squad status (key player, core, prospect, …) and a
   * plain-English label for it. Absent = unassigned. Only meaningful/settable for
   * own players.
   */
  squadStatus?: import('@domain/player').SquadStatus
  squadStatusLabel?: string
  /** #188: the GM's trade posture — untouchable / available / listed. Absent = default. */
  tradeStatus?: import('@domain/player').TradeStatus
  /**
   * #186: no-trade-clause state for the GM's own player. `hasNtc` when the
   * contract carries a clause; `ntcWaived` once his agent has signed off on a
   * move anywhere; `tradeAcceptTeams` the specific clubs he'd accept (a partial
   * waive). Present only for own players who hold a clause.
   */
  hasNtc?: boolean
  ntcWaived?: boolean
  tradeAcceptTeams?: Array<{ teamId: string; name: string }>
  /**
   * #188: leadership read for captaincy decisions — his leadership rating and
   * whether he currently wears a letter (C / A). Present for own players.
   */
  leadershipRating?: number
  captaincy?: 'C' | 'A' | null
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
  /** Names of the GM's saved line-board presets (for the load dropdown). */
  lineSetups?: string[]
  /** Current line-management mode for the user's club. */
  lineManagementMode?: 'coach' | 'fillGaps'
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

/* ──── wider-world competitions (#95) ──── */

export interface CompetitionStandingRowView {
  teamId: string
  abbreviation: string
  name: string
  gamesPlayed: number
  wins: number
  losses: number
  overtimeLosses: number
  points: number
  goalsFor: number
  goalsAgainst: number
  colors: { primary: number; secondary: number }
}

export interface CompetitionScorerRowView {
  playerId: string
  name: string
  teamId: string
  teamAbbr: string
  gamesPlayed: number
  goals: number
  assists: number
  points: number
}

/** A notable player or prospect playing in a competition (scout-flavoured). */
export interface CompetitionNotableView {
  playerId: string
  name: string
  teamId: string
  teamAbbr: string
  position: string
  age: number
  /** Current ability stars (0.5–5). */
  currentStars: number
  /** Projected ceiling stars (0.5–5). */
  potentialStars: number
}

export interface CompetitionView {
  id: string
  name: string
  abbrev: string
  nation: string
  tier: 'active' | 'simulated' | 'background'
  /** NHL-equivalency strength factor (0–1; NHL = 1). */
  strength: number
  /** 1 = strongest of the world competitions (by NHLe strength). */
  strengthRank: number
  teamCount: number
  playerCount: number
  standings: CompetitionStandingRowView[]
  /** Top scorers (simulated tier only; empty for background leagues). */
  scorers: CompetitionScorerRowView[]
  /** Best established players by current ability. */
  notables: CompetitionNotableView[]
  /** Top young prospects (U23) by projected ceiling. */
  prospects: CompetitionNotableView[]
}

export interface CompetitionsView {
  competitions: CompetitionView[]
}

/* ──── international (national-team power rankings) ──── */

export interface NationView {
  nation: string
  /** Power ranking, 1 = strongest national pool. */
  rank: number
  /** 0–100 strength rating (avg current ability of the best ~23). */
  rating: number
  /** Total players of this nationality across the world DB. */
  playerCount: number
  /** Nation-page profile fields. */
  capital: string
  continent: string
  languages: string[]
  /** Leagues based in this nation (its competitions), strongest first. */
  topLeagues: Array<{ id: string; abbrev: string; name: string; level: number; strength: number }>
  /** Notable clubs based in this nation. */
  majorClubs: Array<{ teamId: string; abbreviation: string; name: string; leagueAbbr: string }>
  /** Best players of this nation (reuses the scout-flavoured notable row). */
  topPlayers: CompetitionNotableView[]
  /** Best youth players (U18) of this nation. */
  topYouth: CompetitionNotableView[]
  /** Selected senior national team (best available, 14F/7D/2G). */
  seniorSquad: CompetitionNotableView[]
  /** Selected U20 (World Juniors) team. */
  u20Squad: CompetitionNotableView[]
}

export interface WorldJuniorsStandoutView {
  playerId: string
  name: string
  nation: string
  teamAbbr: string
  position: string
  stars: number
  /** #48/P5: this standout is one of YOUR org's prospects (rights held / on a
   *  farm roster) — the story hook that makes the tournament yours to follow. */
  isYours?: boolean
}

export interface WorldJuniorsView {
  gold: string | null
  silver: string | null
  bronze: string | null
  /** Projected final placings (rank order), with pool strength. */
  standings: Array<{ nation: string; rating: number; finish: number }>
  allStars: WorldJuniorsStandoutView[]
  /** #48/P5: your org's own prospects on the all-tournament team (subset of
   *  allStars, for the "your prospects on show" callout). */
  yours?: WorldJuniorsStandoutView[]
}

export interface InternationalView {
  nations: NationView[]
  /** Projected World Juniors (U20) medal table + all-stars, or null if the pool
   *  is too thin to contest. */
  worldJuniors: WorldJuniorsView | null
}

/* ──── NHL analyst draft rankings (the season's evolving consensus board) ──── */

export interface DraftRankRowView {
  rank: number
  playerId: string
  name: string
  teamId: string
  teamAbbr: string
  /** Full club name (e.g. "Penn State Nittany Lions") for a readable label. */
  teamName?: string
  leagueAbbr: string
  nation: string
  position: string
  age: number
  /** 'eligible' (17–18) | 'reentry' (19–20 undrafted) | 'radar' (14–16 watch). */
  eligibility: 'eligible' | 'reentry' | 'radar'
  currentStars: number
  potentialStars: number
  /** Analyst rank movement vs the previous phase's board (+ rose, − slid).
   *  Present on the analyst rankings from mid-season on; omitted at preliminary. */
  movement?: number
  /** NHLe projection: probability (0–100) he becomes a regular NHLer. Skaters only. */
  pNHLer?: number
  /** NHLe projection: probability (0–100) he becomes an impact/"star" player. Skaters only. */
  pStar?: number
  /** Raw perceived ceiling (0–100) behind the analyst stars — used to derive the
   *  analysts' projected role consistently with their ranking. */
  perceivedCeiling?: number
}

/** A row on YOUR scouts' board — the consensus rank vs your staff's rank. */
export interface ScoutBoardRowView extends DraftRankRowView {
  /** Where the analyst/media consensus has him. */
  consensusRank: number
  /** Rank movement on your board (consensusRank − yourRank; + = you're higher). */
  movement: number
  /** 'higher' | 'inline' | 'lower' relative to the consensus board. */
  verdict: 'higher' | 'inline' | 'lower'
  /** Whether your staff has actually seen enough of him to hold an opinion. */
  seen: boolean
}

export interface DraftRankingsView {
  /** preliminary | midseason | final. */
  phase: 'preliminary' | 'midseason' | 'final'
  /** Human label, e.g. "Mid-season ranking". */
  phaseLabel: string
  /** Draft year these prospects are eligible for. */
  draftYear: number
  /** The draft board proper — draft-eligible + re-entry, analyst-ranked. */
  rankings: DraftRankRowView[]
  /** Younger talent (14–16) on the radar but not yet draft-eligible. */
  radar: DraftRankRowView[]
  /** YOUR scouts' own board — the staff consensus, re-ranked by what they've seen. */
  scoutBoard: ScoutBoardRowView[]
  /** Per-scout boards — each individual scout's ranking (their own bias/variance). */
  scoutBoards: { scoutId: string; scoutName: string; rows: ScoutBoardRowView[] }[]
  /** Analyst FULL-ordering rank (1-based) for every eligible prospect — past the
   *  published top board too, so off-board prospects get a concrete "Nth-round"
   *  projection. playerId → rank. */
  fullRankById: Record<string, number>
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
  /** #175: shorthanded points (goals + assists). Optional/additive. */
  shPoints?: number
  /** #175: PP / PK time on ice per game (seconds). Optional/additive. */
  ppToiPerGame?: number
  pkToiPerGame?: number
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
  /** Provenance: the ORIGINAL team's abbr when this pick was acquired via trade
   *  (mirrors the draft board's "VAN 1st (via MTL)"). Absent for own picks. */
  viaAbbr?: string
  /** True when the pick still belongs to its original team (not acquired). */
  isOwnPick?: boolean
  /** Human-readable factors behind `value`, for the builder's hover breakdown. */
  drivers?: ValueDriver[]
}

/** Value fields attached to a tradeable player row (additive to PlayerBadge). */
export interface TradeValued {
  /** This player's trade value in the same points the AI weighs (rounded 1dp).
   *  For unscouted opponents it's your staff's estimate — see `valueEstimated`. */
  tradeValue?: number
  /** True when `tradeValue` is a fog-of-war estimate, not exact. */
  valueEstimated?: boolean
  /** Human-readable factors behind `tradeValue`, for the builder's hover. */
  valueDrivers?: ValueDriver[]
}

export interface TradeSideView {
  teamId: string
  teamName: string
  teamAbbr: string
  players: Array<PlayerBadge & TradeValued & { salary: number; yearsRemaining: number }>
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
  /** #184: 'pending' — the GM took it under advisement; the real answer (accept /
   *  counter / fell-through) arrives by inbox after a day or two of deliberation.
   *  Only a clear non-starter (NTC / cap / lowball) still returns 'reject' instantly. */
  verdict: 'accept' | 'reject' | 'counter' | 'pending'
  /** AI's reasoning, shown to the user. */
  message: string
  /** Present when verdict is 'counter'. */
  counter: TradeOfferView | null
}

/** Your OWN assistant GM's live read as you build a package (EHM-style). Advice
 *  from your side of the table — is this good value for us, any practical flags.
 *  Not the other club's answer; just your staff talking. */
export interface TradeAssessmentView {
  /** Your assistant GM's name (falls back to "Assistant GM"). */
  agmName: string
  /** One line of in-character advice. */
  line: string
  /** Sentiment bucket for styling. */
  tone: 'love' | 'good' | 'fair' | 'caution' | 'lopsided' | 'blocked' | 'empty'
  /** 0–1 share of the total value your side GIVES UP — for a balance gauge.
   *  Present only when both sides carry value (omitted when empty/blocked). */
  giveShare?: number
  /** 0–1 share your side RECEIVES (giveShare + receiveShare ≈ 1). */
  receiveShare?: number
}

/** The partner GM's NON-BINDING reaction when you "gauge interest" before
 *  officially proposing. A warm read is NOT an acceptance — a real offer still
 *  gets slept on for a few days and may come back as accept / counter / no. */
export interface TradeInterestView {
  /** The responding club's GM (named when known). */
  gmName: string
  /** His in-character read of the package. */
  line: string
  /** warm = worth pursuing, tepid = wants more, cool = far off, blocked = dealbreaker. */
  lean: 'warm' | 'tepid' | 'cool' | 'blocked'
}

export interface TradePartnerView {
  teamId: string
  teamName: string
  teamAbbr: string
  players: Array<PlayerBadge & TradeValued & { salary: number; yearsRemaining: number; noTradeClause: boolean }>
  picks: PickAssetView[]
  /** Roster cap space ($). Positive = room available. */
  capSpace: number
  /** Position groups the partner is thin on (below target depth). */
  needs: string[]
  /** Philosophy label shown in the UI. */
  philosophy: string
  /** The club's named GM (Living World LW2). Optional/additive. */
  gmName?: string
  /** His public reputation ("aggressive dealer, analytics believer"). */
  gmStyle?: string
  /** Seasonal stance: 'contend' | 'retool' | 'rebuild'. */
  posture?: string
  /** One factual line explaining the posture read. */
  postureReason?: string
}

export interface TradesView {
  /** Offers AI clubs have sent the user. */
  incoming: TradeOfferView[]
  /** Every other club's tradeable assets for the proposal builder. */
  partners: TradePartnerView[]
  myPlayers: Array<PlayerBadge & TradeValued & { salary: number; yearsRemaining: number; noTradeClause: boolean }>
  myPicks: PickAssetView[]
  /** Trades are frozen outside the regular season (and after the deadline day, if set). */
  deadlineDay: number | null
  tradingOpen: boolean
  /** User team's current cap space. */
  myCapSpace: number
}

/** One asset (player or pick) in the live trade-builder balance breakdown. */
export interface TradeDraftAsset {
  /** playerId or pick id. */
  key: string
  /** Player name or pick label (e.g. "2026 1st"). */
  name: string
  kind: 'player' | 'pick'
  faceId?: string
  /** Provenance for acquired picks — "(via MTL)". */
  viaAbbr?: string
  /** Value in the AI's own trade points (rounded 1dp). */
  value: number
  /** True when this is a fog-of-war estimate (unscouted opponent). */
  estimated?: boolean
  drivers: ValueDriver[]
}

/**
 * Live read of the package being built (worker → UI). Every number is sourced
 * from the SAME `playerValue`/`pickValue` the AI accepts/rejects with, so the
 * builder's breakdown matches the engine's own math. The `marketVerdict` is a
 * pure who-wins-on-paper read from your side's totals; `partnerVerdict` is a
 * side-effect-free dry-run of the real `evaluateProposal` — the club's actual
 * answer (still slept on for a day or two once formally proposed).
 */
export interface TradeDraftView {
  /** What you give up (your assets, exact values). */
  give: TradeDraftAsset[]
  /** What you get back (opponent assets; player values may be fogged). */
  receive: TradeDraftAsset[]
  giveTotal: number
  receiveTotal: number
  /** receiveTotal − giveTotal, from your perspective (rounded 1dp). */
  net: number
  /** Pure market read from the totals you see. */
  marketVerdict: 'fair' | 'overpay' | 'fleece' | 'empty'
  /** Plain line, e.g. "Even value on paper." / "You're overpaying by ~24%." */
  marketLine: string
  /** Magnitude of the imbalance as a percent (present for overpay/fleece). */
  marketPct?: number
  /** Your assistant GM's one-line take + tone (mirrors the trade desk read). */
  agmName: string
  agmLine: string
  agmTone: TradeAssessmentView['tone']
  /** The partner's projected answer from an `evaluateProposal` dry-run. */
  partnerVerdict: 'accept' | 'counter' | 'reject' | 'blocked' | 'empty'
  /** Plain projection, e.g. "Vancouver would likely reject this." or the
   *  concrete blocker (NTC / over the cap). */
  partnerLine: string
}

/* ────────────────────────── deadline day hub ────────────────────────── */

/** A player an AI club is actively dangling on the deadline market. */
export interface ShoppedPlayerView extends PlayerBadge {
  salary: number
  yearsRemaining: number
  /** Owning club (deep-link + accenting). */
  teamId: string
  teamAbbr: string
  teamName: string
  /** The GM you'd be calling about him. */
  gmName: string
  /** True for an expiring-deal rental — the classic deadline chip. */
  rental: boolean
  /** Perri-scale trade value (rounded), for sorting + a value chip. */
  value: number
  /** Plain-English asking price ("a 1st-round pick and a mid-round pick"). */
  asking: string
}

/** One completed AI-vs-AI (or user) deal on the live deadline wire. */
export interface DeadlineFeedItemView {
  /** Compact summary ("BUF send C X to COL for a 2027 1st-round pick"). */
  text: string
  /** Clubs involved, for accenting / crests. */
  teamAbbrs: string[]
  /** How long ago, in days ("today", "1d ago"). */
  when: string
  /** True for a marquee move (a genuine roster piece changed hands). */
  accent: boolean
}

/**
 * The deadline-day hub (Season Rhythm). Non-null only while the sim is held on
 * deadline day. Everything is read live from the market: your posture and cap,
 * the concrete offers on your desk, the league-wide block, and the wire of
 * deals already done today.
 */
export interface DeadlineDayView {
  dateISO: string
  deadlineDay: number
  /** Buying / selling / on-the-fence stance line. */
  stance: string
  /** "Space to work with: $X.XM." */
  capLine: string
  /** Your head coach's one-line marching order. */
  coachLine: string
  /** Your assistant GM (named). */
  agmName: string
  /** Whether your club is buying (contender) — colours the framing. */
  buying: boolean
  /** Real, concrete offers on your desk right now (each gives up a player of yours). */
  incoming: TradeOfferView[]
  /** League-wide board of players being shopped, best first. */
  shopped: ShoppedPlayerView[]
  /** Live wire of deals done today / recently, newest first. */
  feed: DeadlineFeedItemView[]
}

/* ────────────────────────── draft / offseason / finances ────────────────────────── */

export interface ProspectRowView extends PlayerBadge {
  /** Scouting consensus, 1 = best. */
  rank: number
  /** Fog-aware potential (your scouts' read) — uncertain for prospects you
   *  haven't scouted, sharp for ones you have. */
  potentialStars: number
  /** 0–100 how well YOUR scouts know him (gates how trustworthy potentialStars is). */
  knowledge: number
  drafted: boolean
  /* ── EHM-style scouting depth (additive; present for real imported prospects) ── */
  /** Shooting/catching hand. */
  shoots?: 'L' | 'R'
  heightCm?: number
  weightKg?: number
  nationality?: string
  /** The league he's playing in now (OHL, USHL, NTDP, MHL, …). */
  leagueAbbr?: string
  /** His current club. */
  club?: string
  /** This-season scoring line in his league (or most recent imported season). */
  seasonGp?: number
  seasonG?: number
  seasonA?: number
  seasonPts?: number
  /** Whether the season line is live (this sim season) or imported history. */
  seasonIsHistory?: boolean
  /** Where YOUR scouts rank him on their own board (differs from the public
   *  `rank` when your staff is higher/lower than the media consensus). */
  scoutRank?: number
  /** Your scouts' read vs the public board: 'higher' = they like him more. */
  scoutVerdict?: 'higher' | 'inline' | 'lower'
}

/** One key staff member's draft recommendation while the GM is on the clock.
 *  Advisors weigh the board differently (best-available vs need vs fit vs
 *  ceiling), so they don't always agree — that's the point. */
export interface DraftAdviceView {
  staffId: string
  staffName: string
  /** "Head Scout", "Head Coach", "Assistant GM", "Scout". */
  role: string
  faceId?: string
  /** The angle this advisor argues from. */
  kind: 'bpa' | 'need' | 'fit' | 'ceiling' | 'safe'
  /** Short tag for the chip, e.g. "Best available", "Team need", "System fit". */
  angle: string
  /** The prospect he's pushing for. */
  playerId: string
  playerName: string
  position: Position
  rank: number
  /** One- or two-sentence rationale in the advisor's voice. */
  reason: string
  /** 0–100 the advisor's evaluation accuracy (how much to trust him). */
  confidence: number
  /** True when this advisor's pick is ALSO the best player available — i.e. his
   *  lens and pure value agree (a clear-cut, consensus pick). */
  isConsensus?: boolean
}

export interface DraftPickRowView {
  overallPick: number
  round: number
  teamId: string
  teamAbbr: string
  /** #13: abbreviation of the pick's ORIGINAL team when it was acquired via trade
   *  (owner ≠ origin) — so "VAN (via MTL)" makes clear this slot is MTL's pick, not
   *  Vancouver's own. Absent for a team's own pick. */
  viaAbbr?: string
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
  /** Abbreviation of the team currently on the clock (for the controls strip). */
  onClockTeamAbbr?: string
  /** Your key staff's recommendations — populated only while YOU are on the clock. */
  advice?: DraftAdviceView[]
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

/* ───────────────────────── free-agency hub (DEPTH 2) ───────────────────────── */

/** One name on the open market, with everything a GM triages by. */
export interface FaHubRowView extends PlayerBadge {
  askSalary: number
  askYears: number
  /** Honest market clock: days before AI clubs can sign him out from under you. */
  decidesInDays: number
  agentName: string
  /** HIS read on YOUR club — the market is two-way. */
  interest: 'keen' | 'warm' | 'cold'
  interestNote: string
  /** What his camp leads with (top priority hint). */
  wants: string
  /** Rival appetite — hot names negotiate from strength. */
  hot: boolean
  /** True once his camp has started dropping the ask as the summer drags on. */
  askSoftened?: boolean
  shortlisted: boolean
  /** An open/paused negotiation session exists with this player. */
  inTalks: boolean
  /** Rival clubs known to be circling (abbreviations) — the competition you're
   *  bidding against. Fog-limited to a handful; longer lists read as "+N more". */
  rivals?: string[]
  /** #167/#164: a standing offer you've tabled him, awaiting his decision, with
   *  an honest read on where it sits vs the rival field. */
  pendingOffer?: {
    salary: number
    years: number
    decidesInDays: number
    /** 'leading' = clear front-runner · 'competitive' = fair but sniper-able · 'trailing' = below his ask. */
    standing: 'leading' | 'competitive' | 'trailing'
    standingNote: string
  }
}

export interface FaHubView {
  rows: FaHubRowView[]
  faDay: number
  capSpace: number
  /** True during the offseason free-agency window, where you can table standing
   *  offers (they resolve over days). Outside it, sign directly via talks. */
  windowOpen?: boolean
}

/** #168: a rival club's restricted free agent you could offer-sheet. */
export interface RfaTargetView extends PlayerBadge {
  teamAbbr: string
  teamId: string
  /** His camp's asking AAV and term. */
  askSalary: number
  askYears: number
  /** A one-click offer-sheet suggestion (an overpay to pry him loose). */
  offerSalary: number
  offerYears: number
  /** Draft-pick compensation you'd surrender if his club declines to match. */
  compLabel: string
  /** #183: present when you've already tendered a sheet awaiting the owner's
   *  decision — the terms and how many days remain in the match window. */
  pending?: { salary: number; years: number; daysLeft: number }
}

export interface RfaBoardView {
  /** True in the offseason re-sign / free-agency window (when sheets are legal). */
  windowOpen: boolean
  rows: RfaTargetView[]
}

/* ───────────────────── contract negotiation (DEPTH 1) ───────────────────── */

/** One committed round as the UI sees it. */
export interface NegotiationRoundView {
  offerSalary: number
  offerYears: number
  offerBonusPct: number
  offerClause: 'none' | 'modified' | 'full'
  verdict: 'accept' | 'close' | 'reject' | 'walk'
  agentLines: string[]
}

/** A live negotiation session — the NegotiationScreen's whole world. */
export interface NegotiationView {
  player: PlayerBadge
  kind: 'resign' | 'freeAgent' | 'extension'
  status: 'open' | 'signed' | 'paused' | 'walked'
  /** ELC / RFA / UFA. */
  rightsLabel: string
  currentSalary: number
  agentName: string
  /** One-line persona read ("a hard-line anchor, talks to the press"). */
  agentStyle: string
  /** Persistent GM↔agent standing (agents recur across a career). Optional/additive. */
  agentStanding?: 'Trusted' | 'Cordial' | 'Neutral' | 'Wary' | 'Burned'
  /** One-line read of your history with this agent. Optional/additive. */
  agentRapportNote?: string
  /** How many of this agent's clients you've signed. Optional/additive. */
  agentDeals?: number
  /** The agent's current position. */
  askSalary: number
  askYears: number
  askBonusPct: number
  askClause: 'none' | 'modified' | 'full'
  /** Mood band, not the raw meter — negotiations keep their fog. */
  temperature: 'warm' | 'guarded' | 'testy' | 'hostile'
  openingLines: string[]
  rounds: NegotiationRoundView[]
  /** Real signed contracts the agent argues from. */
  comparables: Array<{
    name: string
    teamAbbr: string
    overall: number
    age: number
    salary: number
    years: number
  }>
  /** What you've learned about his priorities so far. */
  revealedHints: string[]
  /** Your cap room right now (offers are validated against it). */
  capSpace: number
  /** When paused: the label the UI shows ("talks resume in a few days"). */
  pausedNote?: string
}

/* ── Convened staff meeting (bi-weekly war-room). Action stays engine-side; the
 *    view carries only what the screen renders. Optional/additive. ── */
export interface StaffMeetingOptionView {
  id: string
  label: string
  /** The receipt preview — what accepting commits you to. */
  detail: string
}
export interface StaffMeetingProposalView {
  id: string
  /** Who is pitching. */
  speaker: MeetingSpeaker
  title: string
  /** The pitch, incl. the "why". */
  intro: string[]
  options: StaffMeetingOptionView[]
  /** Option the AGM applies if you delegate. */
  defaultOptionId: string
  /** True for an INFO briefing (real numbers, no decision). Optional/additive. */
  info?: boolean
  /** Cited data bullets shown under an INFO briefing. Optional/additive. */
  facts?: string[]
}
export interface StaffMeetingView {
  day: number
  year: number
  /** Head coach's opening line. */
  opening: string
  proposals: StaffMeetingProposalView[]
}

/* ── Convened scout meeting (recurring recruitment briefing). Additive/optional. ── */
/** One prospect on the meeting's board summary. */
export interface ScoutBoardLineView {
  playerId: string
  name: string
  position: string
  note: string
}
export interface ScoutMeetingView {
  day: number
  year: number
  /** Who's hosting (top scout / Head of Scouting). */
  host: MeetingSpeaker
  /** Host's opening line. */
  opening: string
  /** Prospects your board rates above the public consensus. */
  risers: ScoutBoardLineView[]
  /** Prospects your board rates below the consensus. */
  fallers: ScoutBoardLineView[]
  /** Coverage gaps (positions/regions you're thin on), human-readable. */
  gaps: string[]
  /** Decisions — reuses the staff-meeting proposal/option shapes. */
  proposals: StaffMeetingProposalView[]
}

export interface OfferSheetRowView extends PlayerBadge {
  /** Rival club that tendered the sheet. */
  fromTeamAbbr: string
  salary: number
  years: number
  /** Compensation rounds you'd receive if you let him walk (e.g. [1,3]). */
  compRounds: number[]
}

/** A player an AI club has exposed on the in-season waiver wire, claimable by the
 *  user until the window closes (after which AI clubs get a worst-first crack). */
export interface WaiverWireRowView extends PlayerBadge {
  /** Club that placed him on waivers. */
  fromTeamAbbr: string
  fromTeamName: string
  salary: number
  yearsRemaining: number
  twoWay: boolean
  /** Match days left before the claim window closes. 0 = closes on the next sim. */
  claimDeadlineInDays: number
  /** False when claiming him would breach the cap or the 26-man roster. */
  canClaim: boolean
  /** Why the claim is blocked (when canClaim is false). */
  blockReason?: string
}

/** A pending owner directive awaiting the GM's response. Response to 'getOwnerRequest'. */
export interface OwnerRequestView {
  kind: string
  title: string
  body: string
  /** Human hint for the accept choice incl. the board-confidence consequence. */
  acceptHint: string
  declineHint: string
}

/** Club sponsorship deals + total annual revenue. Response to 'getSponsors'. */
export interface SponsorsView {
  total: number
  deals: Array<{
    kind: 'title' | 'jersey' | 'arena'
    kindLabel: string
    sponsor: string
    value: number
    yearsLeft: number
  }>
}

/** Fan engagement + its effect on the owner budget. Response to 'getFanbase'. */
export interface FanbaseView {
  interest: number
  label: string
  /** Owner-budget multiplier from fan interest, as a percentage (e.g. 105 = 1.05×). */
  budgetFactorPct: number
}

/** The GM's competitive stance + whether a rebuild can be sanctioned. Response to 'getClubDirection'. */
export interface ClubDirectionView {
  direction: 'compete' | 'retool' | 'rebuild'
  /** True when ownership has signed off on a rebuild this season. */
  rebuildSanctioned: boolean
  /** False when the board expects a contender and won't sanction a teardown. */
  canRebuild: boolean
  mandateText: string
}

/** Veteran→rookie mentorships + eligible players. Response to 'getMentorships'. */
export interface MentorshipView {
  pairs: Array<{ mentee: MentorBadge; mentor: MentorBadge }>
  eligibleMentors: MentorBadge[]
  eligibleMentees: MentorBadge[]
}
export interface MentorBadge {
  playerId: string
  name: string
  position: Position
  age: number
}

/** The user GM's standing with each rival club. Response to 'getGMRelationships'. */
export interface GMRelationshipsView {
  rows: Array<{ teamAbbr: string; teamName: string; standing: number; label: string }>
}

/** The user's GM identity, reputation, and career record. Response to 'getGMProfile'. */
export interface GMProfileView {
  name: string
  reputation: number
  tier: string
  seasons: number
  wins: number
  losses: number
  playoffApps: number
  cupWins: number
  presidentsTrophies: number
  /** Current club name, or null when between jobs (fired). */
  currentClub: string | null
  fired: boolean
  stints: Array<{
    teamAbbr: string
    teamName: string
    fromYear: number
    toYear: number | null
    seasons: number
    record: string
    cupWins: number
    endReason: 'fired' | 'moved' | null
  }>
}

/** Open GM vacancies the user can take. Response to 'getGMJobMarket'. */
export interface GMJobMarketView {
  reputation: number
  tier: string
  /** True when the user is between jobs and may accept an opening. */
  available: boolean
  openings: Array<{
    teamId: string
    teamName: string
    teamAbbr: string
    projectedRank: number
    interest: 'courting' | 'open' | 'longshot'
    blurb: string
  }>
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
  /** Re-sign stage: rival offer sheets on your RFAs — match or take compensation. */
  offerSheets?: OfferSheetRowView[]
  /** Free-agency stage. */
  freeAgents: FreeAgentRowView[]
  /** Pending arbitration awards — accept or walk (M2). Optional/additive. */
  arbitration?: Array<{ playerId: string; name: string; position: string; age: number; salary: number; years: number }>
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
  /** Buyout dead-cap charge counted against this club's cap (M2). Optional/additive. */
  deadCap?: number
  /** #157: LTIR cap relief currently in effect — lowers capUsed while a long-term
   *  injured player is on IR. Absent (0) when nobody is on LTIR. */
  ltirRelief?: number
  /** League salary floor (minimum payroll). */
  salaryFloor?: number
  /** True when this club's payroll sits below the floor. */
  underFloor?: boolean
  budget: number
  payroll: PayrollRowView[]
  /** Contracts expiring at season end. */
  expiring: PayrollRowView[]
  /** League average payroll for context. */
  leagueAvgPayroll: number
  /** Salary split by position group (Forwards / Defense / Goaltending). */
  byPosition?: Array<{ group: string; total: number; count: number }>
  /** Committed cap hit for the current season and the next few years. */
  commitments?: Array<{ year: number; committed: number; players: number }>
  /** Estimated revenue / sponsorship picture (market-derived, deterministic). */
  revenue?: {
    marketSizeLabel: string
    estimatedRevenue: number
    lines: Array<{ source: string; amount: number }>
    /** #173: live cadence — gate + merch now scale with fan interest (a winning,
     *  popular club fills the building) and the GM's ticket-pricing lever. */
    fanInterest?: number
    fanInterestLabel?: string
    /** Estimated attendance as a % of capacity (0–100+). */
    attendancePct?: number
    ticketPricing?: 'value' | 'standard' | 'premium'
    /** Season operating result estimate = revenue − payroll. */
    operatingResult?: number
  }
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

/** Data-analyst hire screen: who's hired + the hiring market. */
export interface DataAnalystView {
  hired: { id: string; name: string; rating: number; judgment: number; specialty: string } | null
  candidates: Array<{ id: string; name: string; rating: number; judgment: number; specialty: string; salary: number }>
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
  /**
   * Playtest #10: the GM's current prospect-triage state, so digest cards can
   * reflect tracked/passed status when re-read. Present only when some item
   * carries embedded prospect cards. Optional/additive.
   */
  prospectTriage?: { shortlisted: string[]; dismissed: string[] }
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
  /** Rival offer sheets pending on the user's RFAs (re-sign window). Additive;
   *  absent on pre-offer-sheet saves → restored as empty. */
  offerSheets?: Array<{ playerId: string; fromTeamId: string; salary: number; years: number }>
  /** Live in-season waiver-wire entries. Additive; absent on old saves → empty. */
  waiverWire?: Array<{ playerId: string; fromTeamId: string; placedDay: number }>
  /** Per-team hot/cold streak counters for ambient news. Additive; absent → empty. */
  teamStreaks?: Array<[string, number]>
  /** The user's GM identity + reputation + job history. Additive; absent → lazily created. */
  gmState?: import('@engine/league/gmCareer').GMState
  /** Open GM vacancies when the user is between jobs. Additive; absent → none. */
  gmJobMarket?: Array<import('@engine/league/gmCareer').GMJobOpening>
  /** Pending owner directive. Additive; absent → none. */
  ownerRequest?: import('@engine/league/ownerMeddling').OwnerRequest
  /** User GM's standing with each rival club (teamId → 0–100). Additive; absent → neutral. */
  gmRelationships?: Array<[string, number]>
  /** Veteran→rookie mentorships (menteeId → mentorId). Additive; absent → none. */
  mentorships?: Array<[string, string]>
  /** GM's declared competitive stance. Additive; absent → 'compete'. */
  clubDirection?: 'compete' | 'retool' | 'rebuild'
  /** Fan engagement (0–100). Additive; absent → 60. */
  fanInterest?: number
  /** #173: ticket-pricing lever. Additive; absent → 'standard'. */
  ticketPricing?: 'value' | 'standard' | 'premium'
  /** Captured baseline owner budget for fan-scaling. Additive; absent → 0 (recapture). */
  baseBudget?: number
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
    /** #175: shorthanded splits — optional so pre-#175 saves load (absent → empty). */
    shGoals?: Array<[string, number]>
    shAssists?: Array<[string, number]>
    /** Per-season goalie shutouts — optional so older saves load (absent → empty). */
    shutouts?: Array<[string, number]>
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
  /** World Chronicle — permanent event memory (Living World LW1). Optional/additive. */
  chronicle?: ChronicleState
  /** Named AI GM personas per club (Living World LW2). Optional/additive. */
  gmPersonas?: Array<[string, GmPersona]>
  /** Pending preseason board-meeting year (Season Rhythm M1). Optional/additive. */
  boardMeetingYear?: number | null
  /** M3 dev camp soft gate. Optional/additive. */
  devCampPending?: boolean
  /** #182: the GM's curated dev-camp invite list (undefined ⇒ auto). Additive. */
  devCampRoster?: string[]
  /** #182: the GM's curated training-camp PTO invite list (undefined ⇒ AGM auto). Additive. */
  campPtoInvites?: string[]
  /** Dev-camp week progress (day + scrimmage lines). Optional/additive. */
  devCampState?: DevCampState | null
  /** M3 training-camp cut day (staged decisions). Optional/additive. */
  trainingCamp?: TrainingCampState | null
  /** Last season's story for the owner's meeting opener. Optional/additive. */
  lastSeasonMeta?: { predictedRank: number; actualRank: number; madePlayoffs: boolean; wonCup: boolean } | null
  /** Owner-investment perk in force this season. Optional/additive. */
  ownerPerk?: string | null
  /** Staged End-of-Season Review facts (Season Rhythm M4). Optional/additive. */
  reviewFacts?: SeasonReviewFacts | null
  /** Per-game box scores for the user's played games this season. Optional/additive. */
  boxScoreHistory?: Array<[string, BoxScoreView]>
  /** Pending arbitration awards for the user's RFAs (M2). Optional/additive. */
  arbitrationCases?: Array<{ playerId: string; salary: number; years: number }>
  /** Deadline-day hold state. Optional/additive. */
  deadlineHold?: boolean
  deadlineHoldDone?: boolean
  /** Buyout dead-cap charge on next season's books (M2). Optional/additive. */
  userDeadCap?: number
  /** Full buyout dead-cap tail (2× term): season → dead-cap slice. Optional/additive. */
  deadCapSchedule?: Array<{ year: number; amount: number }>
  /** Players bought out mid-resign-stage, pending the FA pool. Optional/additive. */
  buyoutFas?: string[]
  /** [teamId, LockerRoomState][] — one per club. */
  lockerRooms?: Array<[string, LockerRoomState]>
  /** Player→GM concerns (open + recently resolved). Optional/additive. */
  interactions?: PlayerInteraction[]
  interactionCounter?: number
  /** LW5 promise ledger — tracked debts from promise-tone answers. Optional/additive. */
  playerPromises?: PlayerPromise[]
  /** Living Ledger (Narrative Engine layer 0): recorded GM actions, scheduled
   *  in-character reactions, and permanent residue. All optional/additive. */
  worldActions?: import('./livingLedger').WorldAction[]
  ledgerReactions?: import('./livingLedger').PendingLedgerReaction[]
  residueFlags?: import('./livingLedger').ResidueFlag[]
  ledgerCounter?: number
  /** Content Engine no-repeat ledger (B4.5). Optional/additive. */
  contentLedger?: import('@engine/story/contentEngine').ContentUse[]
  /** Open decision events: interactionId → event id, so a dilemma saved
   *  mid-scene still applies its AUTHORED effects on load rather than
   *  silently falling back to the generic tone model. Optional/additive. */
  decisionEventFor?: Array<[string, string]>
  /** Playtest #14: prospect call-ups the GM declined, keyed to the season he
   *  said it, so staff stop re-pitching the same kid. Optional/additive. */
  declinedCallups?: Array<[string, number]>
  lastDecisionDay?: number
  /** Feed Phase A: priors ledger + novelty memory. Optional/additive. */
  storyPriors?: StoryPriors
  /** Social-feed posts (separate from inbox news). Optional/additive. */
  feedPosts?: NewsItem[]
  feedCounter?: number
  /** Followed feed accounts (Phase B curation). Optional/additive. */
  followedFeedAuthors?: string[]
  /** DEPTH 1: open/paused contract negotiation sessions by playerId. Optional/additive. */
  negotiations?: Array<[string, NegotiationState]>
  /** Persistent GM↔contract-agent rapport (keyed by agent name). Optional/additive. */
  agentRapport?: AgentRapportState
  /** A pending convened staff meeting (JSON-safe scene). Optional/additive. */
  staffMeetingScene?: unknown
  /** A pending convened scout meeting (JSON-safe scene). Optional/additive. */
  scoutMeetingScene?: unknown
  /** Playtest #10: the weekly scout digest is holding the day. Optional/additive. */
  scoutDigestPending?: boolean
  /** Inbox id of the gating digest (deep-link target). Optional/additive. */
  scoutDigestNewsId?: string
  /** Prospects already presented in a gated digest (no weekly re-nag). Optional/additive. */
  scoutDigestShown?: string[]
  /** DEPTH 2: free agents the GM is tracking. Optional/additive. */
  faShortlist?: string[]
  /** [playerId, askedQuestionIds][] — interview questions asked. Optional/additive. */
  interviews?: Array<[string, string[]]>
  /** Scheduled (not-yet-resolved) interviews. Optional/additive. */
  pendingInterviews?: Array<{ playerId: string; dueDay: number; year: number }>
  /** Previous-phase analyst draft board ranks (for movement arrows). Optional/additive. */
  prevDraftBoard?: Array<[string, number]>
  /** Draft-rank phase last observed. Optional/additive. */
  draftPhaseSeen?: 'preliminary' | 'midseason' | 'final'
  /** Hired data analyst (unlocks the Data Hub). Optional/additive. */
  dataAnalyst?: { id: string; name: string; role: string; rating: number; judgment: number; specialty?: string; demeanor?: string } | null
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
    /** Latch so the mathematical playoff clinch / elimination headline fires
     *  once per season. Optional; older saves default to null (may re-announce
     *  once after loading a stretch-run save, which is harmless). */
    playoffBerthAnnounced?: 'clinched' | 'eliminated' | null
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
    /** #90: the GM's persistent pundit relationships (optional — old saves seed neutral). */
    pundits?: import('@engine/story/pundits').PunditState
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
  /** Cumulative season match-rating accumulator (true season Avr). JSON-safe. */
  seasonRatingTotals?: Array<[string, { sum: number; n: number }]>
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
  /** Saved named line-board presets for the user club. Optional (back-compat). */
  lineSetups?: Array<{ name: string; lines: Lines }>
  /** How the user's lines are managed each matchday. Optional (back-compat). */
  lineManagementMode?: 'coach' | 'fillGaps'
  /**
   * Coach hiring market — available head coaches with profiles. Optional for
   * backward compat; regenerated deterministically when absent.
   */
  coachMarket?: CoachMarketEntry[]
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
  /** Wider-world (other leagues') player games-played counters. Optional;
   *  standings persist on leagueData.league.competitions. */
  worldGp?: Array<[string, number]>
  /** Wider-world player season totals. Optional. */
  worldTotals?: Array<[string, unknown]>
  /** Per-player opinion timeline (rating/stars/knowledge over time). Optional. */
  opinionHistory?: Array<[string, import('@engine/career/opinionTracker').OpinionSnapshot[]]>
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
  /** 0–100 judgment of the qualitative read. */
  judgment?: number
  /** Nation the scout knows best. */
  specialtyNation?: string
  /** Annual salary. */
  salary?: number
  /** Human-readable label for current assignment scope. */
  assignmentLabel: string
  /** Human-readable focus ('Youth' / 'Senior' / 'All players'). */
  focusLabel: string
  target: ScoutAssignment['target']
  focus: 'youth' | 'senior' | 'all'
  /** Position brief: 'any' | 'F' | 'D' | 'G'. */
  positionFilter: 'any' | 'F' | 'D' | 'G'
  /** Only surface prospects projecting ≥ this many stars (0 = any). */
  minPotentialStars: number
  /** How many players currently fall under his assignment (post-focus+position). */
  coverage: number
  /** Read speed given the scope size — Fast (focused) / Steady / Thin (spread). */
  readSpeed: 'Fast' | 'Steady' | 'Thin'
  /** Nation his scope maps to (for the map + flag), or null if global/unassigned. */
  focusNation: string | null
}

/** A surfaced prospect/target in the Scouting Centre (fills over the career). */
export interface ScoutFindView {
  playerId: string
  name: string
  age: number
  position: string
  teamAbbr: string
  nationality?: string
  faceId?: string
  currentStars: number
  potentialStars: number
  knowledge: number
  grade: 'A+' | 'A' | 'B' | 'C'
  reason: string
  scoutName: string
  foundDate: string
  /** True if he plays a position your roster is currently thin at. */
  fitsNeed: boolean
  /** True if he's a current-class draft-eligible amateur (for filtering). */
  draftEligible: boolean
  /** Compact analyst draft standing, e.g. "R1 · #11"; absent if not on the board. */
  draftLabel?: string
  /** True when the GM has tracked him — he sits on the shortlist, not the queue. */
  shortlisted?: boolean
}

/** A scope option for the assignment dropdowns. */
export interface ScoutScopeOption {
  /** 'nation' | 'competition' | 'team' | 'nextOpponent' | 'draftClass' | 'freeAgents' */
  kind: string
  /** Stable id (nation name, competition id, team id) — empty for singletons. */
  id: string
  label: string
}

/** Average scouting knowledge across a league/nation, with a youth split. */
export interface ScoutCoverageRow {
  id: string
  label: string
  nation?: string
  avgKnowledge: number
  youthAvgKnowledge: number
  playerCount: number
}

/** A hireable scout in the job market. */
export interface ScoutMarketRow {
  id: string
  name: string
  rating: number
  judgment: number
  specialtyNation?: string
  salary: number
}

/** Full scout profile — attributes, current assignment, and who he's watching. */
export interface ScoutProfileView {
  scoutId: string
  name: string
  faceId?: string
  rating: number
  judgment: number
  specialtyNation?: string
  salary?: number
  demeanor?: string
  /** Discipline attributes (label/value out of 20), display-only. */
  attributes: Array<{ label: string; value: number }>
  assignmentLabel: string
  focusLabel: string
  /** Players currently in his scope (post-focus). */
  coverage: number
  /** Players he has real intel on (in his scope), most-known first. */
  scouted: Array<{
    playerId: string; name: string; position: string; age: number
    teamAbbr: string; nationality?: string; knowledge: number
    currentStars: number; potentialStars: number; faceId?: string
  }>
  /** Prospects he has surfaced to the Scouting Centre. */
  finds: Array<{ playerId: string; name: string; grade: string; reason: string; foundDate: string }>
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
/** One row in the scouted-players recommendations table. */
export interface ScoutedPlayerRow {
  playerId: string
  name: string
  position: string
  age: number
  teamAbbr: string
  nationality?: string
  /** Fog-aware current ability, 0–5 stars. */
  currentStars: number
  /** Fog-aware potential, 0–5 stars. */
  potentialStars: number
  /** 0–100 scouting knowledge. */
  knowledge: number
  /** Recommendation grade — a TARGET grade (youth + upside + acquirability),
   *  not raw quality. An ageing star you can't pry loose grades low. */
  rec: 'A+' | 'A' | 'B' | 'C' | 'D'
  /** Acquisition-target score backing the grade; sorts the list. */
  targetScore: number
  /** Current salary (≈ transfer/asset value proxy). */
  salary: number
  /** Trade/market value — the same asset-value currency the trade AI evaluates
   *  with (fog-aware: youth + upside + acquirability, discounted for age/contract).
   *  0 for a player we know too little about to value. */
  tradeValue: number
  faceId?: string
  /** True if he's a current-class draft-eligible amateur (for filtering). */
  draftEligible: boolean
  /** Compact analyst draft standing, e.g. "R1 · #11"; absent if not on the board. */
  draftLabel?: string
}

export interface ScoutingView {
  scouts: ScoutCardView[]
  /** Scouted players with recommendation grades (most recommendable first). */
  scoutedPlayers: ScoutedPlayerRow[]
  /** All teams as assignment options. */
  teams: Array<{ teamId: string; teamName: string; teamAbbr: string }>
  /** All divisions as assignment options. */
  divisions: Array<{ divisionId: string; divisionName: string }>
  /** Nations (regions) you can assign a scout to cover. */
  nations: ScoutScopeOption[]
  /** Leagues/competitions you can assign a scout to (incl. NHL/AHL). */
  competitions: ScoutScopeOption[]
  /** The user's next opponent's name (for the Next Opponent scope label), or null. */
  nextOpponentName: string | null
  /** Nations currently covered by at least one scout (for the world map). */
  scoutedNations: string[]
  /** Average knowledge across all non-trivially-known players, 0–100. */
  worldKnowledge: number
  /** Scouts currently on a concrete assignment (vs idle). */
  activeScouts: number
  /** Scouts the surfaced recommendations came from + the finds themselves. */
  recommendations: ScoutFindView[]
  /** Position groups your roster is currently thin at (e.g. ['Defense','Centre']). */
  rosterNeeds: string[]
  /** Whether draft-class assignment is currently meaningful (draft class exists). */
  hasDraftClass: boolean
  /** Knowledge coverage by league (avg + youth split). */
  leagueCoverage: ScoutCoverageRow[]
  /** Knowledge coverage by nation (avg + youth split). */
  nationCoverage: ScoutCoverageRow[]
  /** Per-team knowledge summary. */
  teamKnowledge: TeamKnowledgeSummary[]
  /** Recently improved players (highest delta-knowledge), for watch-list panel. */
  topGains: Array<PlayerBadge & { knowledge: number }>
  /** Hireable scouts on the market. */
  scoutMarket: ScoutMarketRow[]
  /** Cap on active scouts. */
  maxScouts: number
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
    /** Optional so older view consumers ignore it; absent → treat as empty. */
    shutouts?: RecordEntry[]
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
  /** Per-franchise championship pedigree (banner rafters), most titles first. */
  franchises: FranchiseHistoryView[]
}

/** One NHL club's all-time championship record for the History screen. */
export interface FranchiseHistoryView {
  teamId: string
  name: string
  abbreviation: string
  championships: number
  /** Years the banner was raised, newest first. */
  championYears: number[]
  isUser: boolean
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

/** One row in the Medical Center risk table. */
export interface MedicalRow {
  playerId: string
  name: string
  faceId?: string
  position: string
  /** 0–100 condition (higher = fresher). */
  condition: number
  /** 0–100 fatigue. */
  fatigue: number
  /** Injury description if currently injured. */
  injuryDescription?: string
  injuryGamesRemaining?: number
  /** Injury body region, for the medical body diagram. */
  injuryKind?: 'upperBody' | 'lowerBody' | 'concussion' | 'illness'
  /** #171: estimated return date (ISO) — the date of the next club game he can
   *  play after sitting out his remaining games. Absent if not injured or no
   *  scheduled game far enough out. */
  estReturn?: string
  /** #171: severity band from the timeline. */
  severity?: 'day-to-day' | 'weeks' | 'long-term'
  /** #171: GM has this healthy player on load-management rest. */
  resting?: boolean
  /** Injury-risk band + 0–100 score. */
  riskLabel: 'Low' | 'Increased' | 'High'
  risk: number
  /** #157: currently on Long-Term Injured Reserve (cap hit relieved). */
  ltir?: boolean
  /** #157: eligible to be placed on LTIR right now (long-term injury, not yet on IR). */
  ltirEligible?: boolean
  /** #157: his cap hit — the relief amount if placed on LTIR. Present when injured. */
  capHit?: number
}

/** Response to 'getMedical' — the user club's medical/risk picture. */
export interface MedicalView {
  teamName: string
  injuredCount: number
  /** #171: total club games still to be missed across all current injuries. */
  gamesToReturnTotal: number
  /** #171: head physio (name + 0–100 quality) — better staff shorten recoveries. */
  physioName?: string
  physioRating?: number
  /** #157: total LTIR cap relief in effect (0 when nobody is on LTIR). */
  ltirRelief?: number
  rows: MedicalRow[]
}

/** Development Center re-exports (builder owns the shapes). Response to 'getDevelopment'. */
export type { DevelopmentRow, DevelopmentCenterView } from './developmentCenter'

/** Squad Planner re-exports (builder owns the shapes). Response to 'getSquadPlanner'. */
export type {
  SquadPlannerView,
  PlannerPlayer,
  PositionDepth,
  CareerStage,
  PosGroup,
} from './squadPlanner'

/** One league-wide leaderboard the user's club is ranked within. */
export interface LeagueComparisonCard {
  key: string
  label: string
  /** Plain-English explanation of what the metric measures. */
  blurb: string
  /** User club's rank, 1 = best. */
  rank: number
  /** League size ranked against. */
  outOf: number
  /** 0–1 fraction of the league the user outranks (1 = top). */
  percentile: number
  /** User club's value, preformatted for display. */
  display: string
  /** League leader for this metric. */
  leaderTeamId: string
  leaderAbbr: string
  leaderDisplay: string
  /** True when the user's club is itself the leader. */
  isUserLeader: boolean
}

/** "How your club stacks up" — dashboard comparison card. Response to 'getLeagueComparison'. */
export interface LeagueComparisonView {
  teamName: string
  cards: LeagueComparisonCard[]
}

/** A player the coach is likely to act on (form/morale/condition) — staff meeting. */
export interface StaffMeetingFlaggedPlayer {
  playerId: string
  name: string
  faceId?: string
  issue: 'slumping' | 'unhappy' | 'tired'
  detail: string
}

/** Head-coach tactical identity + roster fit + flagged players. Response to 'getStaffMeetingSummary'. */
export interface StaffMeetingSummaryView {
  coachName: string
  coachFaceId?: string
  /** Named system, e.g. "Low-Event Trap". */
  systemLabel: string
  /** One-line description of how the system plays. */
  systemBlurb: string
  /** What roster composition the system favours. */
  systemFavors: string
  philosophy: string
  forecheckName: string
  breakoutName: string
  nzName: string
  dZoneName: string
  ppName: string
  pkName: string
  paceName: string
  /** 0–100 roster fit (styleMatch). */
  rosterFit: number
  fitLabel: string
  fitAdvice: string[]
  flagged: StaffMeetingFlaggedPlayer[]
}

/** A stored available coach in the hiring market (snapshot-serialised). */
export interface CoachMarketEntry {
  coach: StaffMember
  /** Quality the coach is asking to be measured by (~rating). */
  askingRating: number
}

/** One candidate row in the coach hiring market. */
export interface CoachMarketCandidateView {
  coachId: string
  name: string
  faceId?: string
  rating: number
  /** Demeanour label, e.g. "analytical". */
  demeanor: string
  systemLabel: string
  philosophy: string
  /** Roster fit vs the USER's current roster (0–100). */
  rosterFit: number
  fitLabel: string
  fitBlurb: string
}

/** Coach hiring market. Response to 'getCoachMarket'. */
export interface CoachMarketView {
  currentCoachName: string
  currentSystemLabel: string
  currentRosterFit: number
  entries: CoachMarketCandidateView[]
}

/** One team's Monte-Carlo playoff projection. */
export interface PlayoffOddsRow {
  teamId: string
  name: string
  abbreviation: string
  conference: string
  /** Current standings points. */
  points: number
  gamesPlayed: number
  gamesRemaining: number
  /** Mean simulated final points. */
  projectedPoints: number
  /** 0–100 chance of making the playoffs. */
  playoffPct: number
  isUser: boolean
}

/** Monte-Carlo playoff odds for the league. Response to 'getPlayoffOdds'. */
export interface PlayoffOddsView {
  /** False outside the regular season (no projection to make). */
  available: boolean
  /** Number of season simulations run. */
  simulations: number
  userTeamId: string
  /** Playoff qualifiers per conference (the cut line): 8 (big league) or 4. */
  qualifiers?: number
  /** All teams, best projected points first. */
  rows: PlayoffOddsRow[]
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
  /* additive display fields for the trade block */
  position?: string
  age?: number
  faceId?: string
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
  /** Per-discipline attributes (EHM 1–20) from the source DB. */
  attributes?: import('@engine/league/staff').StaffAttributes
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
  /** #170: the effect preview for the active team focus — the tradeoff made
   *  visible (which attributes it grows, how well the coach delivers it, and the
   *  weekly fatigue swing). Optional so old snapshots/view builders stay valid. */
  plan?: PracticePlanView
}

/** #170: what a practice focus actually does, for the Training screen. */
export interface PracticePlanView {
  focus: PracticeFocus
  /** Top targeted attributes with their coach-scaled growth boost (as a %). */
  targeted: Array<{ attr: string; boost: number }>
  /** Signed fatigue points per practice week (negative = recovery). */
  fatiguePerWeek: number
  coachName: string
  /** Coach's delivery effectiveness as a % (100 = neutral). */
  coachMult: number
  coachTier: 'elite' | 'strong' | 'adequate' | 'weak'
  /** How much slower non-targeted attributes develop (opportunity cost, %). */
  opportunityCostPct: number
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
  /** Facepack image key (for the headshot on the League Overview leader cards). */
  faceId?: string
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

/* ────────────────────────── club info view ────────────────────────── */

/**
 * FM-style Club Info: profile (city, conference/division, affiliate) plus the
 * board's vision/mandate and the club's fiercest rivals. Response to 'getClubInfo'.
 */
export interface ClubInfoView {
  teamId: string
  name: string
  abbreviation: string
  city: string
  conferenceName: string
  divisionName: string
  /** Overall league rank (1 = first). */
  leagueRank: number
  /** Rank within the team's division (1 = first). */
  divisionRank: number
  record: { wins: number; losses: number; overtimeLosses: number; points: number; gamesPlayed: number }
  affiliate: { teamId: string; name: string; abbreviation: string } | null
  /** Board vision / objectives. */
  mandate: string
  mandateText: string
  targetRank: number
  confidenceLabel: string
  /** Top rivals (most intense first). */
  rivals: Array<{ teamId: string; abbreviation: string; label: string }>
  /** Home arena (from the source DB). */
  arena?: string
  arenaCapacity?: number
  /** Retired jersey numbers (from the source DB). */
  retiredNumbers?: Array<{ number: number; player: string }>
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
 * Leaguewide "wire" feed for the ticker — recent transactions plus current
 * notable hot/cold team streaks. The LEAGUE's voice (distinct from the club
 * inbox). Response to 'getLeagueWire'.
 */
export interface LeagueWireView {
  items: Array<{
    kind: 'transaction' | 'streak'
    text: string
    /** Team this item is about, for deep-linking / accenting. */
    teamAbbr?: string
    /** True for marquee items (trades, long streaks) — the ticker can highlight. */
    accent?: boolean
  }>
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
  /** Current in-world date (offseason-aware). Optional/additive. */
  todayISO?: string
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

/* ────────────────────────── media circuit (#90) ────────────────────────── */

/** The GM's standing with one named pundit, for the Media Circuit screen. */
export interface MediaCircuitRowView {
  personaId: 'beat' | 'national' | 'homer'
  name: string
  outlet: string
  /** -100 (feud) … +100 (ally). */
  rapport: number
  standing: 'Ally' | 'Friendly' | 'Neutral' | 'Critic' | 'Feud'
  /** One-line human read on the relationship. */
  read: string
  /** Number of press exchanges with this pundit. */
  interactions: number
  /** Short verb for the most recent exchange (e.g. "came out swinging"). */
  lastExchange?: string
}

/** The GM's press relationships plus who leads for/against him. */
export interface MediaCircuitView {
  teamName: string
  rows: MediaCircuitRowView[]
  /** Strongest ally's display name, when any pundit is friendly or better. */
  allyName?: string
  /** Chief critic's display name, when any pundit is a critic or worse. */
  criticName?: string
}
