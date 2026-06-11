/// <reference lib="webworker" />
/**
 * The sim worker owns the live Career and dispatches every protocol v2
 * message to it. It stays a thin switch: no game logic lives here. Errors
 * thrown by the Career surface as { type: 'error' } responses, which the UI
 * renders as notices/toasts.
 */
import { generateLeague, type LeagueData } from '@data/generate'
import { Career, buildTeamList } from '@engine/career/career'
import { validateSnapshot } from '@engine/career/serialize'
import { asTeamId } from '@domain'
import type { WorkerRequest, WorkerResponse } from './protocol'

const ENGINE_VERSION = '0.2.0'

// The worker owns the live session state across messages.
let pendingData: LeagueData | null = null
let pendingSeed = 0
let career: Career | null = null

function must(): Career {
  if (!career) throw new Error('no career in progress; call startCareer first')
  return career
}

function dashboard(id: number): WorkerResponse {
  return { id, type: 'dashboard', dashboard: must().getDashboard() }
}

function handle(req: WorkerRequest): WorkerResponse {
  switch (req.type) {
    case 'ping':
      return { id: req.id, type: 'pong', at: Date.now() }
    case 'version':
      return { id: req.id, type: 'version', engine: ENGINE_VERSION }
    case 'newLeague': {
      pendingData = generateLeague(
        req.teamCount ? { seed: req.seed, teamCount: req.teamCount } : { seed: req.seed }
      )
      pendingSeed = req.seed
      career = null
      return { id: req.id, type: 'teamList', teams: buildTeamList(pendingData) }
    }
    case 'startCareer': {
      if (!pendingData) throw new Error('no league generated; call newLeague first')
      career = new Career(pendingData, pendingSeed, asTeamId(req.teamId))
      return { id: req.id, type: 'view', view: career.view() }
    }

    /* ── calendar ── */
    case 'advance':
      must().advance(req.days ?? 1)
      return dashboard(req.id)
    case 'advanceToNextGame':
      must().advanceToNextGame()
      return dashboard(req.id)
    case 'continue':
      must().step()
      return dashboard(req.id)
    case 'watch': {
      const c = must()
      const game = c.watchNext()
      return { id: req.id, type: 'watch', view: c.view(), game }
    }

    /* ── screens ── */
    case 'getDashboard':
      return dashboard(req.id)
    case 'getSquad':
      return { id: req.id, type: 'squad', squad: must().getSquad() }
    case 'getPlayer':
      return { id: req.id, type: 'player', player: must().getPlayer(req.playerId) }
    case 'getTactics':
      return { id: req.id, type: 'tactics', tactics: must().getTactics() }
    case 'getSchedule':
      return { id: req.id, type: 'schedule', schedule: must().getSchedule() }
    case 'getStandings':
      return { id: req.id, type: 'standings', standings: must().getStandings() }
    case 'getStats':
      return { id: req.id, type: 'stats', stats: must().getStats() }
    case 'getTrades':
      return { id: req.id, type: 'trades', trades: must().getTrades() }
    case 'getDraft': {
      const draft = must().getDraft()
      if (!draft) throw new Error('no draft in progress')
      return { id: req.id, type: 'draft', draft }
    }
    case 'getFinances':
      return { id: req.id, type: 'finances', finances: must().getFinances() }
    case 'getInbox':
      return { id: req.id, type: 'inbox', inbox: must().getInbox() }
    case 'getPlayoffs':
      return { id: req.id, type: 'playoffs', playoffs: must().getPlayoffs() }
    case 'getOffseason':
      return { id: req.id, type: 'offseason', offseason: must().getOffseason() }
    case 'getLastBoxScore':
      return { id: req.id, type: 'boxScore', boxScore: must().getLastBoxScore() }

    /* ── mutations ── */
    case 'setLines':
      must().setLines(req.lines)
      return { id: req.id, type: 'ok' }
    case 'setTactics':
      must().setTactics(req.tactics)
      return { id: req.id, type: 'ok' }
    case 'markNewsRead':
      must().markNewsRead(req.ids)
      return { id: req.id, type: 'ok' }
    case 'proposeTrade':
      return { id: req.id, type: 'tradeEvaluation', evaluation: must().proposeTrade(req.proposal) }
    case 'acceptTrade':
      must().acceptTrade(req.offerId)
      return { id: req.id, type: 'ok' }
    case 'rejectTrade':
      must().rejectTrade(req.offerId)
      return { id: req.id, type: 'ok' }
    case 'resignPlayer': {
      const res = must().resignPlayer(req.playerId, req.salary, req.years)
      if (!res.signed) throw new Error(res.message)
      return { id: req.id, type: 'ok' }
    }
    case 'releasePlayer':
      must().releasePlayer(req.playerId)
      return { id: req.id, type: 'ok' }
    case 'signFreeAgent': {
      const res = must().signFreeAgent(req.playerId, req.salary, req.years)
      if (!res.signed) throw new Error(res.message)
      return { id: req.id, type: 'ok' }
    }
    case 'draftPlayer':
      must().draftPlayer(req.playerId)
      return { id: req.id, type: 'ok' }
    case 'advanceDraft':
      must().advanceDraft()
      return { id: req.id, type: 'ok' }
    case 'advanceOffseason':
      must().advanceOffseason()
      return { id: req.id, type: 'ok' }

    /* ── persistence ── */
    case 'exportSave': {
      // Wall-clock is allowed here: it only ever lands in save metadata.
      const snapshot = must().exportSnapshot(req.saveName, new Date().toISOString())
      return { id: req.id, type: 'save', snapshot }
    }
    case 'importSave': {
      const snap = validateSnapshot(req.snapshot)
      career = Career.fromSnapshot(snap)
      pendingData = career.data
      pendingSeed = career.seed
      return dashboard(req.id)
    }

    /* ── scouting ── */
    case 'getScouting':
      return { id: req.id, type: 'scouting', scouting: must().getScouting() }
    case 'assignScout':
      must().assignScoutTarget(req.scoutId, req.target)
      return { id: req.id, type: 'ok' }

    /* ── story layer ── */
    case 'getHistory':
      return { id: req.id, type: 'history', history: must().getHistory() }
    case 'getLockerRoom':
      return { id: req.id, type: 'lockerRoom', lockerRoom: must().getLockerRoom() }
    case 'getTentpoles':
      return { id: req.id, type: 'tentpoles', tentpoles: must().getTentpoles() }

    /* ── press corps ── */
    case 'getPressJob':
      return { id: req.id, type: 'pressJob', pressJob: must().getPressJob() }
    case 'submitPressArticle':
      must().submitPressArticle({
        jobId: req.jobId,
        headline: req.headline,
        body: req.body,
        byline: req.byline,
        model: req.model,
      })
      return { id: req.id, type: 'ok' }
    case 'skipPressJob':
      must().skipPressJob(req.jobId)
      return { id: req.id, type: 'ok' }
    case 'getPresser':
      return { id: req.id, type: 'presser', presser: must().getPressConference() }
    case 'answerPresser':
      must().answerPressConference(req.answer, req.tone)
      return { id: req.id, type: 'ok' }

    /* ── EHM plumbing modules (Wave 3) ── */
    case 'getReport':
      return { id: req.id, type: 'report', report: must().getReport() }
    case 'getPractice':
      return { id: req.id, type: 'practice', practice: must().getPractice() }
    case 'setPractice':
      must().setPractice(req.state)
      return { id: req.id, type: 'ok' }
    case 'toggleScratch':
      must().toggleScratchPlayer(req.playerId)
      return { id: req.id, type: 'ok' }
    case 'setPlayerFocusDrill':
      must().setPlayerFocusDrill(req.playerId, req.focus)
      return { id: req.id, type: 'ok' }
    case 'getLeagueLeaders':
      return { id: req.id, type: 'leagueLeaders', leaders: must().getLeagueLeaders(req.topN) }
    case 'getTeamLeaders': {
      const dash = must().getDashboard()
      return { id: req.id, type: 'teamLeaders', leaders: dash.teamLeaders! }
    }
    case 'applyCoachSuggestion':
      must().applyCoachSuggestion(req.suggestedTactics)
      return { id: req.id, type: 'ok' }
  }
}

self.onmessage = (ev: MessageEvent<WorkerRequest>): void => {
  try {
    self.postMessage(handle(ev.data))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    self.postMessage({ id: ev.data.id, type: 'error', message } satisfies WorkerResponse)
  }
}
