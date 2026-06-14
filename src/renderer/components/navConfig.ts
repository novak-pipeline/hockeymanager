import type { DashboardView } from '../../worker/protocol'
import type { ScreenId } from './NavContext'

/** Icon keys resolved to line-art SVGs by <NavIcon>. */
export type IconKey =
  | 'home' | 'inbox' | 'squad' | 'squadPlanner' | 'dynamics' | 'tactics'
  | 'dataHub' | 'staff' | 'training' | 'medical' | 'devCenter'
  | 'schedule' | 'competitions' | 'world' | 'scouting' | 'transfers'
  | 'clubInfo' | 'clubVision' | 'finances' | 'match'

export interface SubTab { id: ScreenId; label: string }

/** Sidebar grouping — a divider is drawn whenever the section changes. */
export type NavSection = 'overview' | 'team' | 'development' | 'competition' | 'club'

/** One top-level sidebar destination (FM-style flat list). */
export interface NavItem {
  id: string
  label: string
  icon: IconKey
  /** Grouping section (drives sidebar dividers). */
  section: NavSection
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
    { id: 'home', label: 'Home', icon: 'home', section: 'overview', screen: 'dashboard', match: ['dashboard', 'staffMeeting'],
      subTabs: [{ id: 'dashboard', label: 'Overview' }, { id: 'staffMeeting', label: 'Staff Meeting' }] },
    { id: 'inbox', label: 'Inbox', icon: 'inbox', section: 'overview', screen: 'inbox', match: ['inbox'], badge: 'unread' },
    { id: 'squad', label: 'Squad', icon: 'squad', section: 'team', screen: 'squad', match: ['squad', 'teamStats', 'report'],
      subTabs: [{ id: 'squad', label: 'Roster' }, { id: 'teamStats', label: 'Statistics' }, { id: 'report', label: 'Report' }] },
    { id: 'planner', label: 'Squad Planner', icon: 'squadPlanner', section: 'team', screen: 'teamPlanner', match: ['teamPlanner'] },
    { id: 'dynamics', label: 'Dynamics', icon: 'dynamics', section: 'team', screen: 'teamDynamics', match: ['teamDynamics'] },
    { id: 'tactics', label: 'Tactics', icon: 'tactics', section: 'team', screen: 'tactics', match: ['tactics'] },
    { id: 'dataHub', label: 'Data Hub', icon: 'dataHub', section: 'development', screen: 'teamDataHub', match: ['teamDataHub'] },
    { id: 'staff', label: 'Staff', icon: 'staff', section: 'development', screen: 'personnel', match: ['personnel'] },
    { id: 'training', label: 'Training', icon: 'training', section: 'development', screen: 'practice', match: ['practice'] },
    { id: 'medical', label: 'Medical Center', icon: 'medical', section: 'development', screen: 'teamMedical', match: ['teamMedical'] },
    { id: 'dev', label: 'Dev. Center', icon: 'devCenter', section: 'development', screen: 'teamDevelopment', match: ['teamDevelopment'] },
    { id: 'schedule', label: 'Schedule', icon: 'schedule', section: 'competition', screen: 'calendar', match: ['calendar', 'matchcenter'],
      subTabs: [{ id: 'calendar', label: 'Calendar' }, { id: 'matchcenter', label: 'Match' }] },
    { id: 'competitions', label: 'Competitions', icon: 'competitions', section: 'competition', screen: 'leagueOverview',
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
    { id: 'world', label: 'World', icon: 'world', section: 'competition', screen: 'world', match: ['world', 'worldInternational'],
      subTabs: [
        { id: 'world', label: 'Leagues' },
        { id: 'worldInternational', label: 'International' },
      ] },
    { id: 'scouting', label: 'Scouting', icon: 'scouting', section: 'competition', screen: 'scouting', match: ['scouting'] },
    { id: 'transfers', label: 'Transfers', icon: 'transfers', section: 'competition', screen: 'trades', match: ['trades'] },
    { id: 'clubInfo', label: 'Club Info', icon: 'clubInfo', section: 'club', screen: 'teamInfo', match: ['teamInfo', 'teamHistory'],
      subTabs: [{ id: 'teamInfo', label: 'Profile' }, { id: 'teamHistory', label: 'History' }] },
    { id: 'clubVision', label: 'Club Vision', icon: 'clubVision', section: 'club', screen: 'board', match: ['board'] },
    { id: 'finances', label: 'Finances', icon: 'finances', section: 'club', screen: 'finances', match: ['finances'] },
  ]
}
