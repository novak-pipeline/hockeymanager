/// <reference lib="webworker" />
/**
 * The sim worker owns the live Career and dispatches every protocol v2
 * message to it. It stays a thin switch: no game logic lives here. Errors
 * thrown by the Career surface as { type: 'error' } responses, which the UI
 * renders as notices/toasts.
 */
import { generateLeague, type LeagueData } from '@data/generate'
import { validateModDatabase, loadModDatabase } from '@data/modSchema'
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
    case 'newLeagueFromMod': {
      const db = validateModDatabase(req.mod)
      pendingData = loadModDatabase(db, { seed: req.seed })
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
    case 'getCalendar':
      return { id: req.id, type: 'calendar', calendar: must().getCalendarView() }
    case 'getSchedule':
      return { id: req.id, type: 'schedule', schedule: must().getSchedule() }
    case 'getStandings':
      return { id: req.id, type: 'standings', standings: must().getStandings() }
    case 'getCompetitions':
      return { id: req.id, type: 'competitions', competitions: must().getCompetitions() }
    case 'getInternational':
      return { id: req.id, type: 'international', international: must().getInternational() }
    case 'getDraftRankings':
      return { id: req.id, type: 'draftRankings', draftRankings: must().getDraftRankings() }
    case 'getDataAnalyst':
      return { id: req.id, type: 'dataAnalyst', dataAnalyst: must().getDataAnalyst() }
    case 'hireDataAnalyst': {
      const res = must().hireDataAnalyst(req.candidateId)
      if (!res.ok) throw new Error(res.message ?? 'Could not hire analyst.')
      return { id: req.id, type: 'dataAnalyst', dataAnalyst: must().getDataAnalyst() }
    }
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
    case 'getTeamLegends':
      return { id: req.id, type: 'teamLegends', legends: must().getTeamLegends(req.teamId) }
    case 'getTeamDynamics':
      return { id: req.id, type: 'teamDynamics', dynamics: must().getTeamDynamics(req.teamId) }
    case 'getMedical':
      return { id: req.id, type: 'medical', medical: must().getMedical() }
    case 'getDevelopment':
      return { id: req.id, type: 'development', development: must().getDevelopment() }
    case 'getSquadPlanner':
      return { id: req.id, type: 'squadPlanner', squadPlanner: must().getSquadPlanner() }
    case 'getLeagueStatTable':
      return { id: req.id, type: 'leagueStatTable', table: must().getLeagueStatTable(req.teamId) }
    case 'suggestToCoach': {
      const res = must().suggestToCoach(req.direction)
      return { id: req.id, type: 'coachResponse', accepted: res.accepted, response: res.response }
    }
    case 'getAgenda':
      return { id: req.id, type: 'agenda', items: must().getAgenda() }
    case 'markForMeeting': {
      const res = must().markForMeeting(req.playerId, req.topic)
      if (!res.ok) throw new Error(res.message ?? 'Could not mark for meeting.')
      return { id: req.id, type: 'ok' }
    }
    case 'discussAgendaItem': {
      const res = must().discussAgendaItem(req.itemId)
      if (!res.ok || !res.result) throw new Error(res.message ?? 'Could not discuss item.')
      return { id: req.id, type: 'discussion', result: res.result }
    }
    case 'respondToInteraction': {
      const res = must().respondToInteraction(req.interactionId, req.optionId)
      if (!res.ok) throw new Error(res.message ?? 'Could not respond.')
      return { id: req.id, type: 'ok' }
    }
    case 'requestInterview': {
      const res = must().requestInterview(req.playerId)
      if (!res.ok) throw new Error(res.message ?? 'Could not schedule interview.')
      return { id: req.id, type: 'ok' }
    }
    case 'requestCoachReport': {
      const res = must().requestCoachReports(req.playerId)
      if (!res.ok) throw new Error(res.message ?? 'Could not request coach reports.')
      return { id: req.id, type: 'ok' }
    }
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
    case 'getScoutProfile':
      return { id: req.id, type: 'scoutProfile', scoutProfile: must().getScoutProfile(req.scoutId) }
    case 'assignScout':
      must().assignScoutTarget(req.scoutId, req.target, req.focus, req.positionFilter, req.minPotentialStars)
      return { id: req.id, type: 'scouting', scouting: must().getScouting() }
    case 'hireScout': {
      const res = must().hireScoutFromMarket(req.candidateId)
      if (!res.ok) return { id: req.id, type: 'error', message: res.message ?? 'Could not hire scout' }
      return { id: req.id, type: 'scouting', scouting: must().getScouting() }
    }
    case 'fireScout': {
      const res = must().fireScoutFromStaff(req.scoutId)
      if (!res.ok) return { id: req.id, type: 'error', message: res.message ?? 'Could not release scout' }
      return { id: req.id, type: 'scouting', scouting: must().getScouting() }
    }

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
    case 'coachSetLines':
      return { id: req.id, type: 'coachLines', lines: must().coachSetLines() }

    /* ── franchise drama + League hub (Wave 4) ── */
    case 'getBoard':
      return { id: req.id, type: 'board', board: must().getBoard() }
    case 'getClubInfo':
      return { id: req.id, type: 'clubInfo', clubInfo: must().getClubInfo() }
    case 'getRivalries':
      return { id: req.id, type: 'rivalries', rivalries: must().getRivalries() }
    case 'getLeagueStats':
      return { id: req.id, type: 'leagueStats', stats: must().getLeagueStats() }
    case 'getTransactions':
      return { id: req.id, type: 'transactions', transactions: must().getTransactions(req.limit) }
    case 'getScoreboard':
      return { id: req.id, type: 'scoreboard', scoreboard: must().getScoreboard(req.day) }

    /* ── AHL farm system ── */
    case 'getAhlStandings':
      return { id: req.id, type: 'ahlStandings', standings: must().getAhlStandingsView() }
    case 'getAhlSquad':
      return { id: req.id, type: 'ahlSquad', squad: must().getAhlSquadView() }
    case 'callUp': {
      const res = must().callUp(req.playerId)
      if (!res.ok) throw new Error(res.reason)
      return { id: req.id, type: 'ok' }
    }
    case 'sendDown': {
      const res = must().sendDown(req.playerId)
      if (!res.ok) throw new Error(res.reason)
      return { id: req.id, type: 'ok' }
    }
    case 'setCoachRoster': {
      const res = must().applyCoachRoster()
      return { id: req.id, type: 'coachRosterSet', promoted: res.promoted, demoted: res.demoted }
    }

    /* ── Phase B: player profile view layer ── */
    case 'compareRadar':
      return { id: req.id, type: 'compareRadar', comparison: must().compareRadar(req.playerIdA, req.playerIdB) }

    /* ── Data Hub: xG analytics ── */
    case 'getDataHub':
      return { id: req.id, type: 'dataHub', dataHub: must().getDataHubView() }
    case 'getTeamDataHub':
      return { id: req.id, type: 'teamDataHub', teamDataHub: must().getTeamDataHubView(req.teamId) }

    /* ── Team browser (task #31) ── */
    case 'getLeagueTeams':
      return { id: req.id, type: 'leagueTeams', teams: must().getLeagueTeams() }
    case 'getTeamSquad':
      return { id: req.id, type: 'squad', squad: must().getSquadFor(req.teamId) }
    case 'getTeamSchedule':
      return { id: req.id, type: 'schedule', schedule: must().getScheduleFor(req.teamId) }
    case 'getTeamPlayerStats':
      return { id: req.id, type: 'teamPlayerStats', stats: must().getTeamPlayerStats(req.teamId) }
    case 'getTeamStaff':
      return { id: req.id, type: 'teamStaff', staff: must().getTeamStaffView(req.teamId) }
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
