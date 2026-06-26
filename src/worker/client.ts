import type {
  CareerSnapshot,
  LinesUpdate,
  PressTone,
  TeamPracticeState,
  PracticeFocus,
  TradeProposal,
  WorkerRequest,
  WorkerRequestBody,
  WorkerResponse,
} from './protocol'
import type { TeamTactics } from '@domain'
import type { ScoutTarget, ScoutFocus } from '@domain/scouting'

/**
 * Minimal worker surface the client needs; lets tests inject a fake without a
 * browser Worker global.
 */
export interface WorkerLike {
  postMessage(message: unknown): void
  terminate(): void
  onmessage: ((ev: MessageEvent<WorkerResponse>) => void) | null
}

interface Pending {
  resolve: (res: WorkerResponse) => void
  timer: ReturnType<typeof setTimeout>
}

/** Per-request deadline; expiry resolves `{ type: 'error', message: 'timeout' }`. */
const REQUEST_TIMEOUT_MS = 20_000

/**
 * Promise-based wrapper around the sim worker — one typed method per
 * `WorkerRequestBody` variant. Owns the worker instance and resolves each
 * request against its matching response by `id`. Requests NEVER reject:
 * timeouts and disposal resolve to `{ type: 'error' }` responses so callers
 * have a single failure path (`res.type === 'error'`).
 */
export class SimClient {
  private readonly worker: WorkerLike
  private readonly pending = new Map<number, Pending>()
  private nextId = 1

  constructor(worker?: WorkerLike) {
    this.worker =
      worker ??
      (new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' }) as WorkerLike)
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const data: WorkerResponse | undefined = ev.data
      if (!data || typeof data.id !== 'number') return
      const entry = this.pending.get(data.id)
      if (entry) {
        clearTimeout(entry.timer)
        this.pending.delete(data.id)
        entry.resolve(data)
      }
    }
  }

  private send(req: WorkerRequestBody): Promise<WorkerResponse> {
    const id = this.nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) resolve({ id, type: 'error', message: 'timeout' })
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, timer })
      this.worker.postMessage({ ...req, id } as WorkerRequest)
    })
  }

  /* ── session ── */

  ping(): Promise<WorkerResponse> {
    return this.send({ type: 'ping' })
  }

  version(): Promise<WorkerResponse> {
    return this.send({ type: 'version' })
  }

  newLeague(seed: number, teamCount?: number): Promise<WorkerResponse> {
    return this.send(
      teamCount === undefined ? { type: 'newLeague', seed } : { type: 'newLeague', seed, teamCount }
    )
  }

  /** Load a real-roster mod database parsed from the IPC bridge. */
  newLeagueFromMod(mod: unknown, seed: number): Promise<WorkerResponse> {
    return this.send({ type: 'newLeagueFromMod', mod, seed })
  }

  startCareer(teamId: string): Promise<WorkerResponse> {
    return this.send({ type: 'startCareer', teamId })
  }

  /* ── calendar ── */

  advance(days?: number): Promise<WorkerResponse> {
    return this.send(days === undefined ? { type: 'advance' } : { type: 'advance', days })
  }

  advanceToNextGame(): Promise<WorkerResponse> {
    return this.send({ type: 'advanceToNextGame' })
  }

  /** Smart continue: next meaningful stop ('continue' message). */
  continueGame(): Promise<WorkerResponse> {
    return this.send({ type: 'continue' })
  }

  watch(): Promise<WorkerResponse> {
    return this.send({ type: 'watch' })
  }

  /* ── screens ── */

  getDashboard(): Promise<WorkerResponse> {
    return this.send({ type: 'getDashboard' })
  }

  getSquad(): Promise<WorkerResponse> {
    return this.send({ type: 'getSquad' })
  }

  getPlayer(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'getPlayer', playerId })
  }

  getTactics(): Promise<WorkerResponse> {
    return this.send({ type: 'getTactics' })
  }

  getCalendar(): Promise<WorkerResponse> {
    return this.send({ type: 'getCalendar' })
  }

  getSchedule(): Promise<WorkerResponse> {
    return this.send({ type: 'getSchedule' })
  }

  getStandings(): Promise<WorkerResponse> {
    return this.send({ type: 'getStandings' })
  }

  getCompetitions(): Promise<WorkerResponse> {
    return this.send({ type: 'getCompetitions' })
  }

  getInternational(): Promise<WorkerResponse> {
    return this.send({ type: 'getInternational' })
  }

  getDraftRankings(): Promise<WorkerResponse> {
    return this.send({ type: 'getDraftRankings' })
  }

  getDataAnalyst(): Promise<WorkerResponse> {
    return this.send({ type: 'getDataAnalyst' })
  }

  hireDataAnalyst(candidateId: string): Promise<WorkerResponse> {
    return this.send({ type: 'hireDataAnalyst', candidateId })
  }

  getStats(): Promise<WorkerResponse> {
    return this.send({ type: 'getStats' })
  }

  getTrades(): Promise<WorkerResponse> {
    return this.send({ type: 'getTrades' })
  }

  getDraft(): Promise<WorkerResponse> {
    return this.send({ type: 'getDraft' })
  }

  getFinances(): Promise<WorkerResponse> {
    return this.send({ type: 'getFinances' })
  }

  getInbox(): Promise<WorkerResponse> {
    return this.send({ type: 'getInbox' })
  }

  getPlayoffs(): Promise<WorkerResponse> {
    return this.send({ type: 'getPlayoffs' })
  }

  getOffseason(): Promise<WorkerResponse> {
    return this.send({ type: 'getOffseason' })
  }

  getLastBoxScore(): Promise<WorkerResponse> {
    return this.send({ type: 'getLastBoxScore' })
  }

  /* ── mutations ── */

  setLines(lines: LinesUpdate): Promise<WorkerResponse> {
    return this.send({ type: 'setLines', lines })
  }

  setTactics(tactics: TeamTactics): Promise<WorkerResponse> {
    return this.send({ type: 'setTactics', tactics })
  }

  markNewsRead(ids: string[]): Promise<WorkerResponse> {
    return this.send({ type: 'markNewsRead', ids })
  }

  respondToInteraction(interactionId: string, optionId: string): Promise<WorkerResponse> {
    return this.send({ type: 'respondToInteraction', interactionId, optionId })
  }

  requestInterview(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'requestInterview', playerId })
  }

  requestCoachReport(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'requestCoachReport', playerId })
  }

  getTeamLegends(teamId: string): Promise<WorkerResponse> {
    return this.send({ type: 'getTeamLegends', teamId })
  }

  getTeamDynamics(teamId: string): Promise<WorkerResponse> {
    return this.send({ type: 'getTeamDynamics', teamId })
  }

  getMedical(): Promise<WorkerResponse> {
    return this.send({ type: 'getMedical' })
  }

  getDevelopment(): Promise<WorkerResponse> {
    return this.send({ type: 'getDevelopment' })
  }

  getSquadPlanner(): Promise<WorkerResponse> {
    return this.send({ type: 'getSquadPlanner' })
  }

  getLeagueComparison(): Promise<WorkerResponse> {
    return this.send({ type: 'getLeagueComparison' })
  }

  getClubInfo(): Promise<WorkerResponse> {
    return this.send({ type: 'getClubInfo' })
  }

  getLeagueStatTable(teamId?: string): Promise<WorkerResponse> {
    return this.send(teamId ? { type: 'getLeagueStatTable', teamId } : { type: 'getLeagueStatTable' })
  }

  suggestToCoach(direction: string): Promise<WorkerResponse> {
    return this.send({ type: 'suggestToCoach', direction })
  }

  getAgenda(): Promise<WorkerResponse> {
    return this.send({ type: 'getAgenda' })
  }

  markForMeeting(playerId: string, topic: string): Promise<WorkerResponse> {
    return this.send({ type: 'markForMeeting', playerId, topic })
  }

  discussAgendaItem(itemId: string): Promise<WorkerResponse> {
    return this.send({ type: 'discussAgendaItem', itemId })
  }

  proposeTrade(proposal: TradeProposal): Promise<WorkerResponse> {
    return this.send({ type: 'proposeTrade', proposal })
  }

  acceptTrade(offerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'acceptTrade', offerId })
  }

  rejectTrade(offerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'rejectTrade', offerId })
  }

  resignPlayer(playerId: string, salary: number, years: number): Promise<WorkerResponse> {
    return this.send({ type: 'resignPlayer', playerId, salary, years })
  }

  releasePlayer(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'releasePlayer', playerId })
  }

  signFreeAgent(playerId: string, salary: number, years: number): Promise<WorkerResponse> {
    return this.send({ type: 'signFreeAgent', playerId, salary, years })
  }

  draftPlayer(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'draftPlayer', playerId })
  }

  advanceDraft(): Promise<WorkerResponse> {
    return this.send({ type: 'advanceDraft' })
  }

  advanceOffseason(): Promise<WorkerResponse> {
    return this.send({ type: 'advanceOffseason' })
  }

  /* ── persistence ── */

  exportSave(saveName: string): Promise<WorkerResponse> {
    return this.send({ type: 'exportSave', saveName })
  }

  importSave(snapshot: CareerSnapshot): Promise<WorkerResponse> {
    return this.send({ type: 'importSave', snapshot })
  }

  /* ── scouting ── */

  getScouting(): Promise<WorkerResponse> {
    return this.send({ type: 'getScouting' })
  }

  getScoutProfile(scoutId: string): Promise<WorkerResponse> {
    return this.send({ type: 'getScoutProfile', scoutId })
  }

  assignScout(
    scoutId: string, target: ScoutTarget, focus?: ScoutFocus,
    positionFilter?: 'any' | 'F' | 'D' | 'G', minPotentialStars?: number,
  ): Promise<WorkerResponse> {
    return this.send({
      type: 'assignScout', scoutId, target,
      ...(focus ? { focus } : {}),
      ...(positionFilter !== undefined ? { positionFilter } : {}),
      ...(minPotentialStars !== undefined ? { minPotentialStars } : {}),
    })
  }

  hireScout(candidateId: string): Promise<WorkerResponse> {
    return this.send({ type: 'hireScout', candidateId })
  }

  fireScout(scoutId: string): Promise<WorkerResponse> {
    return this.send({ type: 'fireScout', scoutId })
  }

  /* ── story layer ── */

  getHistory(): Promise<WorkerResponse> {
    return this.send({ type: 'getHistory' })
  }

  getLockerRoom(): Promise<WorkerResponse> {
    return this.send({ type: 'getLockerRoom' })
  }

  getTentpoles(): Promise<WorkerResponse> {
    return this.send({ type: 'getTentpoles' })
  }

  /* ── press corps ── */

  getPressJob(): Promise<WorkerResponse> {
    return this.send({ type: 'getPressJob' })
  }

  submitPressArticle(args: {
    jobId: string
    headline: string
    body: string
    byline: string
    model: string
  }): Promise<WorkerResponse> {
    return this.send({ type: 'submitPressArticle', ...args })
  }

  skipPressJob(jobId: string): Promise<WorkerResponse> {
    return this.send({ type: 'skipPressJob', jobId })
  }

  getPresser(): Promise<WorkerResponse> {
    return this.send({ type: 'getPresser' })
  }

  answerPresser(answer: string, tone: PressTone): Promise<WorkerResponse> {
    return this.send({ type: 'answerPresser', answer, tone })
  }

  /* ── EHM plumbing modules (Wave 3) ── */

  /** AGM depth chart and category bests. */
  getReport(): Promise<WorkerResponse> {
    return this.send({ type: 'getReport' })
  }

  /** Practice state + auto-suggestion. */
  getPractice(): Promise<WorkerResponse> {
    return this.send({ type: 'getPractice' })
  }

  /** Overwrite the team practice state. */
  setPractice(state: TeamPracticeState): Promise<WorkerResponse> {
    return this.send({ type: 'setPractice', state })
  }

  /** Toggle a player's healthy-scratch status. */
  toggleScratch(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'toggleScratch', playerId })
  }

  /** Set (or clear) a per-player individual focus override. */
  setPlayerFocusDrill(playerId: string, focus: PracticeFocus | null): Promise<WorkerResponse> {
    return this.send({ type: 'setPlayerFocusDrill', playerId, focus })
  }

  /** League-wide top-N leaderboards. */
  getLeagueLeaders(topN?: number): Promise<WorkerResponse> {
    return topN !== undefined
      ? this.send({ type: 'getLeagueLeaders', topN })
      : this.send({ type: 'getLeagueLeaders' })
  }

  /** Team leaders right-rail panel. */
  getTeamLeaders(): Promise<WorkerResponse> {
    return this.send({ type: 'getTeamLeaders' })
  }

  /**
   * Apply the coach's style suggestion to the user team's current tactics.
   * Only fields present in `suggestedTactics` are overwritten (additive merge).
   */
  applyCoachSuggestion(suggestedTactics: Partial<TeamTactics>): Promise<WorkerResponse> {
    return this.send({ type: 'applyCoachSuggestion', suggestedTactics })
  }

  /** Ask the head coach to build the full lineup. Returns a LinesView for the UI draft. */
  coachSetLines(): Promise<WorkerResponse> {
    return this.send({ type: 'coachSetLines' })
  }

  /* ── franchise drama + League hub (Wave 4) ── */

  /** Owner/board mandate, confidence, patience, hot-seat status. */
  getBoard(): Promise<WorkerResponse> {
    return this.send({ type: 'getBoard' })
  }

  /** All current rivalries sorted by intensity. */
  getRivalries(): Promise<WorkerResponse> {
    return this.send({ type: 'getRivalries' })
  }

  /** Team special-teams table (PP% / PK%). */
  getLeagueStats(): Promise<WorkerResponse> {
    return this.send({ type: 'getLeagueStats' })
  }

  /** Recent transactions, most recent first. */
  getTransactions(limit?: number): Promise<WorkerResponse> {
    return limit !== undefined
      ? this.send({ type: 'getTransactions', limit })
      : this.send({ type: 'getTransactions' })
  }

  /** Scoreboard for a given day (defaults to current day). */
  getScoreboard(day?: number): Promise<WorkerResponse> {
    return day !== undefined
      ? this.send({ type: 'getScoreboard', day })
      : this.send({ type: 'getScoreboard' })
  }

  /* ── AHL farm system ── */

  /** League-wide AHL standings. */
  getAhlStandings(): Promise<WorkerResponse> {
    return this.send({ type: 'getAhlStandings' })
  }

  /** User's AHL affiliate roster. */
  getAhlSquad(): Promise<WorkerResponse> {
    return this.send({ type: 'getAhlSquad' })
  }

  /** Recall an AHL player to the user's NHL roster. */
  callUp(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'callUp', playerId })
  }

  /** Assign an NHL player to the user's AHL affiliate. */
  sendDown(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'sendDown', playerId })
  }

  /** Auto-apply the coach's recommended NHL roster (call-ups + send-downs). */
  setCoachRoster(): Promise<WorkerResponse> {
    return this.send({ type: 'setCoachRoster' })
  }

  /** Six-axis radar comparison for two players (Phase C compare UI). */
  compareRadar(playerIdA: string, playerIdB: string): Promise<WorkerResponse> {
    return this.send({ type: 'compareRadar', playerIdA, playerIdB })
  }

  /** Data Hub: xG model analytics (per-team rates + percentiles, player leaders). */
  getDataHub(): Promise<WorkerResponse> {
    return this.send({ type: 'getDataHub' })
  }

  /** Team Data Hub: category-level analytics for one club. */
  getTeamDataHub(teamId: string): Promise<WorkerResponse> {
    return this.send({ type: 'getTeamDataHub', teamId })
  }

  /* ── Team browser (task #31: EHM team-nav arrows) ── */

  /** All NHL teams + AHL affiliates for the team-nav dropdown. */
  getLeagueTeams(): Promise<WorkerResponse> {
    return this.send({ type: 'getLeagueTeams' })
  }

  /** Squad for any team (read-only). */
  getTeamSquad(teamId: string): Promise<WorkerResponse> {
    return this.send({ type: 'getTeamSquad', teamId })
  }

  /** Schedule for any team. */
  getTeamSchedule(teamId: string): Promise<WorkerResponse> {
    return this.send({ type: 'getTeamSchedule', teamId })
  }

  /** Per-player season stats for a specific team (Team > Statistics tab). */
  getTeamPlayerStats(teamId: string): Promise<WorkerResponse> {
    return this.send({ type: 'getTeamPlayerStats', teamId })
  }

  /** Full staff complement for a team (own team when teamId absent). */
  getTeamStaff(teamId?: string): Promise<WorkerResponse> {
    return teamId !== undefined
      ? this.send({ type: 'getTeamStaff', teamId })
      : this.send({ type: 'getTeamStaff' })
  }

  /** Terminates the worker; in-flight requests resolve `{ type: 'error' }`. */
  dispose(): void {
    this.worker.terminate()
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.resolve({ id, type: 'error', message: 'disposed' })
    }
    this.pending.clear()
  }
}
