import type { DashboardView } from '../../worker/protocol'
import type { ScreenId, SectionId } from './NavContext'

/** Icon keys resolved to line-art SVGs by <NavIcon>. */
export type IconKey =
  | 'frontOffice' | 'news' | 'team' | 'league'
  | 'match' | 'calendar' | 'trades'

export interface SubTab { id: ScreenId; label: string }
export interface Section {
  id: SectionId
  label: string
  icon: IconKey
  defaultScreen: ScreenId
  subTabs: SubTab[]
}

/** Build the section tree. Phase adds contextual League sub-tabs (Draft/Offseason/Playoffs). */
export function buildSections(phase: DashboardView['phase']): Section[] {
  const leagueExtra: SubTab[] = []
  if (phase === 'playoffs') leagueExtra.push({ id: 'playoffs', label: 'Playoffs' })
  if (phase === 'offseason') {
    leagueExtra.push({ id: 'draft', label: 'Draft' })
    leagueExtra.push({ id: 'offseason', label: 'Offseason' })
  }
  return [
    {
      id: 'frontOffice', label: 'Front Office', icon: 'frontOffice', defaultScreen: 'dashboard',
      subTabs: [
        { id: 'dashboard', label: 'Overview' },
        { id: 'board', label: 'Owner / Board' },
        { id: 'staffMeeting', label: 'Staff Meeting' },
      ],
    },
    {
      id: 'news', label: 'News', icon: 'news', defaultScreen: 'inbox',
      subTabs: [{ id: 'inbox', label: 'Inbox' }],
    },
    {
      id: 'team', label: 'Team', icon: 'team', defaultScreen: 'squad',
      subTabs: [
        { id: 'squad', label: 'Roster' },
        { id: 'teamPlanner', label: 'Planner' },
        { id: 'teamStats', label: 'Statistics' },
        { id: 'teamDataHub', label: 'Analytics' },
        { id: 'teamDynamics', label: 'Dynamics' },
        { id: 'teamMedical', label: 'Medical' },
        { id: 'teamDevelopment', label: 'Development' },
        { id: 'report', label: 'Report' },
        { id: 'personnel', label: 'Personnel' },
        { id: 'practice', label: 'Practice' },
        { id: 'tactics', label: 'Tactics' },
        { id: 'finances', label: 'Finances' },
        { id: 'teamInfo', label: 'Club Info' },
        { id: 'teamHistory', label: 'History' },
      ],
    },
    {
      id: 'league', label: 'League', icon: 'league', defaultScreen: 'leagueOverview',
      subTabs: [
        { id: 'leagueOverview', label: 'Overview' },
        { id: 'standings', label: 'Standings' },
        { id: 'stats', label: 'Statistics' },
        { id: 'leagueLeaders', label: 'Leaders' },
        { id: 'leagueTeamStats', label: 'Team Stats' },
        { id: 'leagueTransactions', label: 'Transactions' },
        { id: 'leagueScoreboard', label: 'Scoreboard' },
        { id: 'leagueHistory', label: 'History' },
        { id: 'scouting', label: 'Scouting' },
        { id: 'dataHub', label: 'Analytics' },
        ...leagueExtra,
      ],
    },
  ]
}

/** Standalone destinations below the section icons (no sub-tabs). */
export const STANDALONE: Array<{ id: ScreenId; label: string; icon: IconKey }> = [
  { id: 'matchcenter', label: 'Match', icon: 'match' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'trades', label: 'Trades', icon: 'trades' },
]
