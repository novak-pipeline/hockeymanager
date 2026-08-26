import type {
  CareerSnapshot,
  ContractOffer,
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
import type { SquadStatus, TradeStatus } from '@domain/player'
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

  private send(req: WorkerRequestBody, timeoutMs = REQUEST_TIMEOUT_MS): Promise<WorkerResponse> {
    const id = this.nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) resolve({ id, type: 'error', message: 'timeout' })
      }, timeoutMs)
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

  startCareer(teamId: string, startAt?: 'seasonStart' | 'offseason'): Promise<WorkerResponse> {
    // The offseason takeover simulates the club's entire year zero inside the
    // worker — give it minutes, not the default request deadline.
    return this.send({ type: 'startCareer', teamId, ...(startAt ? { startAt } : {}) }, 300_000)
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

  setTicketPricing(tier: 'value' | 'standard' | 'premium'): Promise<WorkerResponse> {
    return this.send({ type: 'setTicketPricing', tier })
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

  getMatchDayPreview(): Promise<WorkerResponse> {
    return this.send({ type: 'getMatchDayPreview' })
  }

  getPostgameReceipt(): Promise<WorkerResponse> {
    return this.send({ type: 'getPostgameReceipt' })
  }

  /* ── mutations ── */

  setLines(lines: LinesUpdate): Promise<WorkerResponse> {
    return this.send({ type: 'setLines', lines })
  }

  setTactics(tactics: TeamTactics): Promise<WorkerResponse> {
    return this.send({ type: 'setTactics', tactics })
  }

  saveLineSetup(name: string): Promise<WorkerResponse> {
    return this.send({ type: 'saveLineSetup', name })
  }

  applyLineSetup(name: string): Promise<WorkerResponse> {
    return this.send({ type: 'applyLineSetup', name })
  }

  deleteLineSetup(name: string): Promise<WorkerResponse> {
    return this.send({ type: 'deleteLineSetup', name })
  }

  setLineManagementMode(mode: 'coach' | 'fillGaps'): Promise<WorkerResponse> {
    return this.send({ type: 'setLineManagementMode', mode })
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

  getDevCamp(): Promise<WorkerResponse> {
    return this.send({ type: 'getDevCamp' })
  }

  getDevCampInvites(): Promise<WorkerResponse> {
    return this.send({ type: 'getDevCampInvites' })
  }

  toggleDevCampInvite(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'toggleDevCampInvite', playerId })
  }

  getCampInvites(): Promise<WorkerResponse> {
    return this.send({ type: 'getCampInvites' })
  }

  toggleCampInvite(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'toggleCampInvite', playerId })
  }

  submitDevCamp(standoutId?: string): Promise<WorkerResponse> {
    return this.send({ type: 'submitDevCamp', ...(standoutId !== undefined ? { standoutId } : {}) })
  }

  skipDevCamp(): Promise<WorkerResponse> {
    return this.send({ type: 'skipDevCamp' })
  }

  getTrainingCamp(): Promise<WorkerResponse> {
    return this.send({ type: 'getTrainingCamp' })
  }

  submitTrainingCamp(placements: Array<{ playerId: string; place: 'nhl' | 'ahl' }>): Promise<WorkerResponse> {
    return this.send({ type: 'submitTrainingCamp', placements })
  }

  getFeed(): Promise<WorkerResponse> {
    return this.send({ type: 'getFeed' })
  }

  toggleFollowAuthor(authorId: string): Promise<WorkerResponse> {
    return this.send({ type: 'toggleFollowAuthor', authorId })
  }

  getNegotiation(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'getNegotiation', playerId })
  }

  startNegotiation(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'startNegotiation', playerId })
  }

  submitNegotiationOffer(playerId: string, offer: ContractOffer): Promise<WorkerResponse> {
    return this.send({ type: 'submitNegotiationOffer', playerId, offer })
  }

  getFaHub(): Promise<WorkerResponse> {
    return this.send({ type: 'getFaHub' })
  }

  toggleFaShortlist(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'toggleFaShortlist', playerId })
  }

  askFaAgent(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'askFaAgent', playerId })
  }

  submitFaOffer(playerId: string, salary: number, years: number): Promise<WorkerResponse> {
    return this.send({ type: 'submitFaOffer', playerId, salary, years })
  }

  getRfaBoard(): Promise<WorkerResponse> {
    return this.send({ type: 'getRfaBoard' })
  }

  submitOfferSheet(playerId: string, salary: number, years: number): Promise<WorkerResponse> {
    return this.send({ type: 'submitOfferSheet', playerId, salary, years })
  }

  setSquadStatus(playerId: string, status: SquadStatus | null): Promise<WorkerResponse> {
    return this.send({ type: 'setSquadStatus', playerId, status })
  }

  getRoleBoard(): Promise<WorkerResponse> {
    return this.send({ type: 'getRoleBoard' })
  }

  autoAssignSquadRoles(overwrite = false): Promise<WorkerResponse> {
    return this.send({ type: 'autoAssignSquadRoles', overwrite })
  }

  setTradeStatus(playerId: string, status: TradeStatus | null): Promise<WorkerResponse> {
    return this.send({ type: 'setTradeStatus', playerId, status })
  }

  getLeadership(): Promise<WorkerResponse> {
    return this.send({ type: 'getLeadership' })
  }

  /** #90: the GM's media-circuit standing with each named pundit. */
  getMediaCircuit(): Promise<WorkerResponse> {
    return this.send({ type: 'getMediaCircuit' })
  }

  setCaptain(playerId: string | null): Promise<WorkerResponse> {
    return this.send({ type: 'setCaptain', playerId })
  }

  /** Beat-gate escape: let the head coach name the captain (B2.2). */
  nameCaptainByCoach(): Promise<WorkerResponse> {
    return this.send({ type: 'nameCaptainByCoach' })
  }

  toggleAlternate(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'toggleAlternate', playerId })
  }

  setJerseyNumber(playerId: string, number: number | null): Promise<WorkerResponse> {
    return this.send({ type: 'setJerseyNumber', playerId, number })
  }

  askAgentWaiveNtc(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'askAgentWaiveNtc', playerId })
  }

  askPlayerTradeList(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'askPlayerTradeList', playerId })
  }

  getTeamDynamics(teamId: string): Promise<WorkerResponse> {
    return this.send({ type: 'getTeamDynamics', teamId })
  }

  getMedical(): Promise<WorkerResponse> {
    return this.send({ type: 'getMedical' })
  }

  restPlayer(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'restPlayer', playerId })
  }

  /** #157: place a long-term-injured player on LTIR (cap relief) / activate off it. */
  placeOnLtir(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'placeOnLtir', playerId })
  }

  activateFromLtir(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'activateFromLtir', playerId })
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

  getPlayoffOdds(): Promise<WorkerResponse> {
    return this.send({ type: 'getPlayoffOdds' })
  }

  getStaffMeetingSummary(): Promise<WorkerResponse> {
    return this.send({ type: 'getStaffMeetingSummary' })
  }

  getStaffMeeting(): Promise<WorkerResponse> {
    return this.send({ type: 'getStaffMeeting' })
  }

  submitStaffMeeting(choices: Record<string, string>): Promise<WorkerResponse> {
    return this.send({ type: 'submitStaffMeeting', choices })
  }

  delegateStaffMeeting(): Promise<WorkerResponse> {
    return this.send({ type: 'delegateStaffMeeting' })
  }

  getScoutMeeting(): Promise<WorkerResponse> {
    return this.send({ type: 'getScoutMeeting' })
  }

  submitScoutMeeting(choices: Record<string, string>): Promise<WorkerResponse> {
    return this.send({ type: 'submitScoutMeeting', choices })
  }

  delegateScoutMeeting(): Promise<WorkerResponse> {
    return this.send({ type: 'delegateScoutMeeting' })
  }

  getCoachMarket(): Promise<WorkerResponse> {
    return this.send({ type: 'getCoachMarket' })
  }

  fireCoach(): Promise<WorkerResponse> {
    return this.send({ type: 'fireCoach' })
  }

  hireCoach(coachId: string): Promise<WorkerResponse> {
    return this.send({ type: 'hireCoach', coachId })
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

  assessTrade(proposal: TradeProposal): Promise<WorkerResponse> {
    return this.send({ type: 'assessTrade', proposal })
  }

  evaluateTradeDraft(proposal: TradeProposal): Promise<WorkerResponse> {
    return this.send({ type: 'evaluateTradeDraft', proposal })
  }

  gaugeTradeInterest(proposal: TradeProposal): Promise<WorkerResponse> {
    return this.send({ type: 'gaugeTradeInterest', proposal })
  }

  shopPlayer(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'shopPlayer', playerId })
  }

  acceptTrade(offerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'acceptTrade', offerId })
  }

  rejectTrade(offerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'rejectTrade', offerId })
  }

  /** A6 escape hatch: the AGM passes on every standing offer in one click. */
  declineAllTradeOffers(): Promise<WorkerResponse> {
    return this.send({ type: 'declineAllTradeOffers' })
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

  matchOfferSheet(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'matchOfferSheet', playerId })
  }

  declineOfferSheet(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'declineOfferSheet', playerId })
  }

  submitResignOffer(playerId: string, salary: number, years: number): Promise<WorkerResponse> {
    return this.send({ type: 'submitResignOffer', playerId, salary, years })
  }

  acceptResignCounter(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'acceptResignCounter', playerId })
  }

  tenderQualifyingOffer(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'tenderQualifyingOffer', playerId })
  }

  declineQualifyingOffer(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'declineQualifyingOffer', playerId })
  }

  getWaiverWire(): Promise<WorkerResponse> {
    return this.send({ type: 'getWaiverWire' })
  }

  getLeagueWire(): Promise<WorkerResponse> {
    return this.send({ type: 'getLeagueWire' })
  }

  getGMProfile(): Promise<WorkerResponse> {
    return this.send({ type: 'getGMProfile' })
  }

  getGMJobMarket(): Promise<WorkerResponse> {
    return this.send({ type: 'getGMJobMarket' })
  }

  getGMRelationships(): Promise<WorkerResponse> {
    return this.send({ type: 'getGMRelationships' })
  }

  getMentorships(): Promise<WorkerResponse> {
    return this.send({ type: 'getMentorships' })
  }

  assignMentor(menteeId: string, mentorId: string): Promise<WorkerResponse> {
    return this.send({ type: 'assignMentor', menteeId, mentorId })
  }

  clearMentor(menteeId: string): Promise<WorkerResponse> {
    return this.send({ type: 'clearMentor', menteeId })
  }

  getClubDirection(): Promise<WorkerResponse> {
    return this.send({ type: 'getClubDirection' })
  }

  setClubDirection(direction: 'compete' | 'retool' | 'rebuild'): Promise<WorkerResponse> {
    return this.send({ type: 'setClubDirection', direction })
  }

  getFanbase(): Promise<WorkerResponse> {
    return this.send({ type: 'getFanbase' })
  }

  getSponsors(): Promise<WorkerResponse> {
    return this.send({ type: 'getSponsors' })
  }

  acceptGMJob(teamId: string): Promise<WorkerResponse> {
    return this.send({ type: 'acceptGMJob', teamId })
  }

  getOwnerRequest(): Promise<WorkerResponse> {
    return this.send({ type: 'getOwnerRequest' })
  }

  respondOwnerRequest(accept: boolean): Promise<WorkerResponse> {
    return this.send({ type: 'respondOwnerRequest', accept })
  }

  claimWaiver(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'claimWaiver', playerId })
  }

  simNextPick(): Promise<WorkerResponse> {
    return this.send({ type: 'simNextPick' })
  }

  advanceDraft(): Promise<WorkerResponse> {
    return this.send({ type: 'advanceDraft' })
  }

  autoDraft(): Promise<WorkerResponse> {
    return this.send({ type: 'autoDraft' })
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

  getBoxScoreFor(gameId: string): Promise<WorkerResponse> {
    return this.send({ type: 'getBoxScoreFor', gameId })
  }

  acceptArbitration(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'acceptArbitration', playerId })
  }

  walkArbitration(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'walkArbitration', playerId })
  }

  buyoutPlayer(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'buyoutPlayer', playerId })
  }

  searchAll(query: string): Promise<WorkerResponse> {
    return this.send({ type: 'searchAll', query })
  }

  getNameIndex(): Promise<WorkerResponse> {
    return this.send({ type: 'getNameIndex' })
  }

  getWarRoom(): Promise<WorkerResponse> {
    return this.send({ type: 'getWarRoom' })
  }

  getDeadlineDay(): Promise<WorkerResponse> {
    return this.send({ type: 'getDeadlineDay' })
  }

  getSeasonReview(): Promise<WorkerResponse> {
    return this.send({ type: 'getSeasonReview' })
  }

  submitSeasonReview(choice: string): Promise<WorkerResponse> {
    return this.send({ type: 'submitSeasonReview', choice })
  }

  getBoardMeeting(): Promise<WorkerResponse> {
    return this.send({ type: 'getBoardMeeting' })
  }

  submitBoardMeeting(choices: Record<string, string>): Promise<WorkerResponse> {
    return this.send({ type: 'submitBoardMeeting', choices })
  }

  autoAssignScouts(): Promise<WorkerResponse> {
    return this.send({ type: 'autoAssignScouts' })
  }

  hireScout(candidateId: string): Promise<WorkerResponse> {
    return this.send({ type: 'hireScout', candidateId })
  }

  fireScout(scoutId: string): Promise<WorkerResponse> {
    return this.send({ type: 'fireScout', scoutId })
  }

  shortlistProspect(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'shortlistProspect', playerId })
  }
  unshortlistProspect(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'unshortlistProspect', playerId })
  }
  dismissProspect(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'dismissProspect', playerId })
  }
  rescoutProspect(playerId: string): Promise<WorkerResponse> {
    return this.send({ type: 'rescoutProspect', playerId })
  }
  /** Playtest #10: release the scout-digest hold (interacted or delegated). */
  resolveScoutDigest(): Promise<WorkerResponse> {
    return this.send({ type: 'resolveScoutDigest' })
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
  recommendPlayerFocuses(): Promise<WorkerResponse> {
    return this.send({ type: 'recommendPlayerFocuses' })
  }

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
  /** Bar B2.2: the AGM signs league-minimum cover for a lineup that cannot
   *  legally be dressed — the one-click way out of the lineup gate. */
  signEmergencyCover(): Promise<WorkerResponse> {
    return this.send({ type: 'signEmergencyCover' })
  }

  setCoachRoster(): Promise<WorkerResponse> {
    return this.send({ type: 'setCoachRoster' })
  }

  undoCoachRoster(): Promise<WorkerResponse> {
    return this.send({ type: 'undoCoachRoster' })
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
