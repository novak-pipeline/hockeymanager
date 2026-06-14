import type { DashboardView } from '../../worker/protocol'
import type { ScreenId } from './NavContext'

/** Icon keys resolved to line-art SVGs by <NavIcon>. */
export type IconKey =
  | 'home' | 'inbox' | 'squad' | 'squadPlanner' | 'dynamics' | 'tactics'
  | 'dataHub' | 'staff' | 'training' | 'medical' | 'devCenter'
  | 'schedule' | 'competitions' | 'scouting' | 'transfers'
  | 'clubInfo' | 'clubVision' | 'finances' | 'match'

export interface SubTab { id: ScreenId; label: string }

/** One top-level sidebar destination (FM-style flat list). */
export interface NavItem {
  id: string
  label: string
  icon: IconKey
  /** Primary screen this item opens. */
  screen: ScreenId
  /** All screens that count as "inside" this item (drives active state + sub-tabs). */
  match: ScreenId[]
  /** Optional in-page tabs shown under the topbar. */
  subTabs?: SubTab[]
  /** Render an unread badge from dashboard.unreadNews. */
  badge?: 'unread'
}

/** Build the full FM-style sidebar (phase adds Draft/Offseason/Playoffs to Competitions). */
export function buildNav(phase: DashboardView['phase']): NavItem[] {
  const compExtra: SubTab[] = []
  if (phase === 'playoffs') compExtra.push({ id: 'playoffs', label: 'Playoffs' })
  if (phase === 'offseason') {
    compExtra.push({ id: 'draft', label: 'Draft' })
    compExtra.push({ id: 'offseason', label: 'Offseason' })
  }
  return [
    { id: 'home', label: 'Home', icon: 'home', screen: 'dashboard', match: ['dashboard', 'staffMeeting'],
      subTabs: [{ id: 'dashboard', label: 'Overview' }, { id: 'staffMeeting', label: 'Staff Meeting' }] },
    { id: 'inbox', label: 'Inbox', icon: 'inbox', screen: 'inbox', match: ['inbox'], badge: 'unread' },
    { id: 'squad', label: 'Squad', icon: 'squad', screen: 'squad', match: ['squad', 'teamStats', 'report'],
      subTabs: [{ id: 'squad', label: 'Roster' }, { id: 'teamStats', label: 'Statistics' }, { id: 'report', label: 'Report' }] },
    { id: 'planner', label: 'Squad Planner', icon: 'squadPlanner', screen: 'teamPlanner', match: ['teamPlanner'] },
    { id: 'dynamics', label: 'Dynamics', icon: 'dynamics', screen: 'teamDynamics', match: ['teamDynamics'] },
    { id: 'tactics', label: 'Tactics', icon: 'tactics', screen: 'tactics', match: ['tactics'] },
    { id: 'dataHub', label: 'Data Hub', icon: 'dataHub', screen: 'teamDataHub', match: ['teamDataHub'] },
    { id: 'staff', label: 'Staff', icon: 'staff', screen: 'personnel', match: ['personnel'] },
    { id: 'training', label: 'Training', icon: 'training', screen: 'practice', match: ['practice'] },
    { id: 'medical', label: 'Medical Center', icon: 'medical', screen: 'teamMedical', match: ['teamMedical'] },
    { id: 'dev', label: 'Dev. Center', icon: 'devCenter', screen: 'teamDevelopment', match: ['teamDevelopment'] },
    { id: 'schedule', label: 'Schedule', icon: 'schedule', screen: 'calendar', match: ['calendar', 'matchcenter'],
      subTabs: [{ id: 'calendar', label: 'Calendar' }, { id: 'matchcenter', label: 'Match' }] },
    { id: 'competitions', label: 'Competitions', icon: 'competitions', screen: 'leagueOverview',
      match: ['leagueOverview', 'standings', 'stats', 'leagueLeaders', 'leagueTeamStats', 'leagueTransactions', 'leagueScoreboard', 'leagueHistory', 'dataHub', 'leagueSchedule', 'draft', 'offseason', 'playoffs'],
      subTabs: [
        { id: 'leagueOverview', label: 'Overview' },
        { id: 'standings', label: 'Standings' },
        { id: 'stats', label: 'Statistics' },
        { id: 'leagueLeaders', label: 'Leaders' },
        { id: 'leagueTeamStats', label: 'Team Stats' },
        { id: 'leagueTransactions', label: 'Transactions' },
        { id: 'leagueScoreboard', label: 'Scoreboard' },
        { id: 'leagueHistory', label: 'History' },
        ...compExtra,
      ] },
    { id: 'scouting', label: 'Scouting', icon: 'scouting', screen: 'scouting', match: ['scouting'] },
    { id: 'transfers', label: 'Transfers', icon: 'transfers', screen: 'trades', match: ['trades'] },
    { id: 'clubInfo', label: 'Club Info', icon: 'clubInfo', screen: 'teamInfo', match: ['teamInfo', 'teamHistory'],
      subTabs: [{ id: 'teamInfo', label: 'Profile' }, { id: 'teamHistory', label: 'History' }] },
    { id: 'clubVision', label: 'Club Vision', icon: 'clubVision', screen: 'board', match: ['board'] },
    { id: 'finances', label: 'Finances', icon: 'finances', screen: 'finances', match: ['finances'] },
  ]
}
