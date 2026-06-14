import { useState } from 'react'
import type { DashboardView } from '../../worker/protocol'
import { useNav, sectionOf, type ScreenId, type SectionId } from './NavContext'
import { useUserTeamId } from './UserTeamContext'

/**
 * FBM-style collapsible left navigation rail. Sections (Front Office / News /
 * Team / League) expand to reveal their sub-screens; standalone destinations
 * (Match / Calendar / Trades) sit below. A collapse toggle shrinks the rail to
 * icons only. The slim topbar (date / sim controls / Continue) lives in TopNav.
 */

interface SubTab {
  id: ScreenId
  label: string
}

interface Section {
  id: SectionId
  label: string
  icon: string
  defaultScreen: ScreenId
  subTabs: SubTab[]
}

function buildSections(phase: DashboardView['phase']): Section[] {
  const leagueExtra: SubTab[] = []
  if (phase === 'playoffs') leagueExtra.push({ id: 'playoffs', label: 'Playoffs' })
  if (phase === 'offseason') {
    leagueExtra.push({ id: 'draft', label: 'Draft' })
    leagueExtra.push({ id: 'offseason', label: 'Offseason' })
  }

  return [
    {
      id: 'frontOffice', label: 'Front Office', icon: '🏢', defaultScreen: 'dashboard',
      subTabs: [
        { id: 'dashboard', label: 'Overview' },
        { id: 'board', label: 'Owner / Board' },
        { id: 'staffMeeting', label: 'Staff Meeting' },
      ],
    },
    {
      id: 'news', label: 'News', icon: '✉', defaultScreen: 'inbox',
      subTabs: [{ id: 'inbox', label: 'Inbox' }],
    },
    {
      id: 'team', label: 'Team', icon: '🏒', defaultScreen: 'squad',
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
      id: 'league', label: 'League', icon: '🌐', defaultScreen: 'leagueOverview',
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

const STANDALONE: Array<{ id: ScreenId; label: string; icon: string }> = [
  { id: 'matchcenter', label: 'Match', icon: '⛸' },
  { id: 'calendar', label: 'Calendar', icon: '📅' },
  { id: 'trades', label: 'Trades', icon: '⇄' },
]

export function SideNav(props: { dashboard: DashboardView | null }): JSX.Element {
  const nav = useNav()
  const userTeamId = useUserTeamId()
  const [collapsed, setCollapsed] = useState(false)

  const phase = props.dashboard?.phase ?? 'regularSeason'
  const unread = props.dashboard?.unreadNews ?? 0
  const sections = buildSections(phase)
  const activeSection = sectionOf(nav.screen)

  const viewedTeamId = nav.params.teamId
  const isViewingOtherTeam =
    activeSection === 'team' && viewedTeamId !== undefined && viewedTeamId !== userTeamId

  function navToTab(screenId: ScreenId): void {
    if (isViewingOtherTeam && sectionOf(screenId) === 'team') {
      nav.navigate(screenId, { teamId: viewedTeamId })
    } else {
      nav.navigate(screenId)
    }
  }

  return (
    <nav className={collapsed ? 'sidenav collapsed' : 'sidenav'}>
      <button
        className="sidenav-collapse"
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? 'Expand' : 'Collapse'}
        aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
      >
        {collapsed ? '»' : '«'}
      </button>

      <div className="sidenav-scroll">
        {sections.map((section) => {
          const isActiveSection = activeSection === section.id
          return (
            <div key={section.id} className="sidenav-group">
              <button
                className={isActiveSection ? 'sidenav-section active' : 'sidenav-section'}
                onClick={() => nav.navigate(section.defaultScreen)}
                title={section.label}
              >
                <span className="sidenav-icon">{section.icon}</span>
                {!collapsed && <span className="sidenav-label">{section.label}</span>}
                {section.id === 'news' && unread > 0 && <span className="badge">{unread}</span>}
              </button>

              {/* Sub-tabs only when this section is active and rail expanded */}
              {!collapsed && isActiveSection && (
                <div className="sidenav-sub">
                  {section.subTabs.map((tab) => (
                    <button
                      key={tab.id}
                      className={nav.screen === tab.id ? 'sidenav-item active' : 'sidenav-item'}
                      onClick={() => navToTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        <div className="sidenav-divider" />

        {STANDALONE.map((item) => (
          <button
            key={item.id}
            className={nav.screen === item.id ? 'sidenav-section active' : 'sidenav-section'}
            onClick={() => nav.navigate(item.id)}
            title={item.label}
          >
            <span className="sidenav-icon">{item.icon}</span>
            {!collapsed && <span className="sidenav-label">{item.label}</span>}
          </button>
        ))}
      </div>
    </nav>
  )
}
