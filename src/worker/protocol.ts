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
export type {
  BoxScoreView,
  CareerPhase,
  CareerSnapshot,
  DashboardView,
  DraftView,
  FinanceView,
  InboxView,
  LinesUpdate,
  OffseasonView,
  PlayerProfileView,
  PlayoffBracketView,
  ScheduleView,
  SquadView,
  StandingsView,
  StatsView,
  TacticsView,
  TradeEvaluation,
  TradeProposal,
  TradesView,
} from '@engine/career/views'
import type {
  BoxScoreView,
  CareerSnapshot,
  DashboardView,
  DraftView,
  FinanceView,
  InboxView,
  LinesUpdate,
  OffseasonView,
  PlayerProfileView,
  PlayoffBracketView,
  ScheduleView,
  SquadView,
  StandingsView,
  StatsView,
  TacticsView,
  TradeEvaluation,
  TradeProposal,
  TradesView,
} from '@engine/career/views'
import type { TeamTactics } from '@domain'

/** A request without its correlation id; the client stamps the id on send. */
export type WorkerRequestBody =
  /* ── session ── */
  | { type: 'ping' }
  | { type: 'version' }
  | { type: 'newLeague'; seed: number; teamCount?: number }
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
  | { type: 'getSchedule' }
  | { type: 'getStandings' }
  | { type: 'getStats' }
  | { type: 'getTrades' }
  | { type: 'getDraft' }
  | { type: 'getFinances' }
  | { type: 'getInbox' }
  | { type: 'getPlayoffs' }
  | { type: 'getOffseason' }
  /** Box score of the most recently played user game, if any. */
  | { type: 'getLastBoxScore' }
  /* ── mutations ── */
  | { type: 'setLines'; lines: LinesUpdate }
  | { type: 'setTactics'; tactics: TeamTactics }
  | { type: 'markNewsRead'; ids: string[] }
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
  | { type: 'schedule'; schedule: ScheduleView }
  | { type: 'standings'; standings: StandingsView }
  | { type: 'stats'; stats: StatsView }
  | { type: 'trades'; trades: TradesView }
  | { type: 'draft'; draft: DraftView }
  | { type: 'finances'; finances: FinanceView }
  | { type: 'inbox'; inbox: InboxView }
  | { type: 'playoffs'; playoffs: PlayoffBracketView | null }
  | { type: 'offseason'; offseason: OffseasonView | null }
  | { type: 'boxScore'; boxScore: BoxScoreView | null }
  /** Result of a trade proposal: AI verdict, possibly a counter-offer. */
  | { type: 'tradeEvaluation'; evaluation: TradeEvaluation }
  /** Generic acknowledgement for mutations; screens refetch what they need. */
  | { type: 'ok' }
  | { type: 'save'; snapshot: CareerSnapshot }
  | { type: 'error'; message: string }
)
