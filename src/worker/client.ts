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
import type { ScoutTarget } from '@domain/scouting'

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

  getSchedule(): Promise<WorkerResponse> {
    return this.send({ type: 'getSchedule' })
  }

  getStandings(): Promise<WorkerResponse> {
    return this.send({ type: 'getStandings' })
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

  assignScout(scoutId: string, target: ScoutTarget): Promise<WorkerResponse> {
    return this.send({ type: 'assignScout', scoutId, target })
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
